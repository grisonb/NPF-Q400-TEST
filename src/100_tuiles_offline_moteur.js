/*
 * v17.26 — auto-réparation ciblée des trous de tuiles pendant un suivi GPS long.
 *
 * Le DIAG réel v17.25 après ~1 h 30 de vol montre que les packs contiennent bien
 * les tuiles (36 trouvées / 0 absente à l'export), mais que des trous ponctuels
 * peuvent rester visibles après des milliers de recentrages GPS. Le zoom possède
 * déjà un filet de sécurité ; le moveend GPS quittait jusqu'ici avant tout contrôle.
 *
 * Contraintes :
 * - aucun changement de concurrence IndexedDB, scheduler, keepBuffer ou timeouts ;
 * - contrôle au maximum toutes les 5 s ;
 * - aucune action tant que des lectures NPF sont encore actives/en file ;
 * - suppression/recréation uniquement des tuiles visibles réellement bloquées ;
 * - les placeholders correspondant à une vraie absence mémorisée ne sont pas
 *   retentés en boucle ;
 * - redraw complet uniquement en dernier secours, avec cooldown de 20 s.
 */
const NPF_GPS_TILE_REPAIR_MIN_INTERVAL_MS = 5000;
const NPF_GPS_TILE_REPAIR_INITIAL_DELAY_MS = 650;
const NPF_GPS_TILE_REPAIR_VERIFY_DELAY_MS = 1200;
const NPF_GPS_TILE_REPAIR_FALLBACK_REDRAW_COOLDOWN_MS = 20000;
let npfGpsTileRepairTimer = null;
let npfGpsTileRepairLastCheckAt = 0;
let npfGpsTileRepairLastFallbackRedrawAt = 0;
let npfGpsTileRepairCheckCount = 0;
let npfGpsTileRepairTriggeredCount = 0;
let npfGpsTileRepairRecoveredCount = 0;
let npfGpsTileRepairFallbackRedrawCount = 0;

function getNpfExpectedVisibleTileCountForCurrentZoom(targetZoom = null) {
    if (!map || !baseTileLayer) return 0;
    try {
        const zoom = Number.isFinite(Number(targetZoom))
            ? Number(targetZoom)
            : Number(baseTileLayer._tileZoom);
        const mapZoom = Number(map.getZoom?.());
        if (
            !Number.isFinite(zoom)
            || !Number.isFinite(mapZoom)
            || Math.abs(zoom - mapZoom) > 0.001
        ) {
            return 0;
        }

        const pixelBounds = map.getPixelBounds?.();
        const tileSizePoint = baseTileLayer.getTileSize?.();
        const tileSize = Number(tileSizePoint?.x || tileSizePoint?.y || 256);
        if (!pixelBounds?.min || !pixelBounds?.max || !Number.isFinite(tileSize) || tileSize <= 0) {
            return 0;
        }

        const minX = Math.floor(Number(pixelBounds.min.x) / tileSize);
        const minY = Math.floor(Number(pixelBounds.min.y) / tileSize);
        const maxX = Math.floor((Number(pixelBounds.max.x) - 1) / tileSize);
        const maxY = Math.floor((Number(pixelBounds.max.y) - 1) / tileSize);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return 0;

        let total = 0;
        for (let y = minY; y <= maxY; y += 1) {
            for (let x = minX; x <= maxX; x += 1) {
                const coords = { x, y, z: zoom };
                if (
                    typeof baseTileLayer._isValidTile === 'function'
                    && !baseTileLayer._isValidTile(coords)
                ) {
                    continue;
                }
                total += 1;
            }
        }
        return total;
    } catch (_) {
        return 0;
    }
}

function collectNpfVisibleTileRepairState() {
    const empty = {
        zoom: null,
        expected: 0,
        totalEntries: 0,
        healthy: 0,
        knownMissPlaceholders: 0,
        repairable: [],
        missingSlots: 0
    };
    if (!map || !baseTileLayer) return empty;

    try {
        const mapContainer = map.getContainer?.();
        const mapRect = mapContainer?.getBoundingClientRect?.();
        const tiles = baseTileLayer._tiles || {};
        const layerZoom = Number(baseTileLayer._tileZoom);
        const mapZoom = Number(map.getZoom?.());
        const targetZoom = Number.isFinite(layerZoom)
            ? Math.round(layerZoom)
            : Math.round(mapZoom);
        if (!mapRect || !Number.isFinite(targetZoom)) return empty;

        const state = {
            ...empty,
            zoom: targetZoom,
            expected: getNpfExpectedVisibleTileCountForCurrentZoom(targetZoom)
        };

        Object.entries(tiles).forEach(([key, entry]) => {
            const coords = entry?.coords;
            const tile = entry?.el;
            if (!coords || !tile || Number(coords.z) !== targetZoom) return;
            if (tile.style?.display === 'none') return;

            const rect = tile.getBoundingClientRect?.();
            if (
                !rect
                || rect.width <= 1
                || rect.height <= 1
                || rect.right <= mapRect.left
                || rect.left >= mapRect.right
                || rect.bottom <= mapRect.top
                || rect.top >= mapRect.bottom
            ) {
                return;
            }

            state.totalEntries += 1;
            const loaded = !!(
                tile.classList?.contains('leaflet-tile-loaded')
                || (tile.complete && Number(tile.naturalWidth) > 0)
            );
            const placeholder = tile.__npfPlaceholder === true;
            const retryablePlaceholder = placeholder && tile.__npfPlaceholderRetryable === true;

            if (placeholder && !retryablePlaceholder) {
                state.knownMissPlaceholders += 1;
                return;
            }

            if (loaded && !placeholder) {
                state.healthy += 1;
                return;
            }

            if (!loaded || retryablePlaceholder) {
                state.repairable.push({ key, coords, tile });
            }
        });

        state.missingSlots = Math.max(
            0,
            Number(state.expected || 0) - Number(state.totalEntries || 0)
        );
        return state;
    } catch (_) {
        return empty;
    }
}

function countNpfVisibleTileRepairProblems(state) {
    if (!state) return 0;
    return Math.max(0, Number(state.repairable?.length || 0))
        + Math.max(0, Number(state.missingSlots || 0));
}

function runNpfGpsTileCoverageRepair(reason = 'gps-moveend') {
    if (
        !map
        || !baseTileLayer
        || !offlineTilesMode
        || !isNpfOfflinePackSelection()
    ) {
        return false;
    }

    const layerZoom = Number(baseTileLayer._tileZoom);
    const mapZoom = Number(map.getZoom?.());
    if (
        Number.isFinite(layerZoom)
        && Number.isFinite(mapZoom)
        && Math.abs(layerZoom - mapZoom) > 0.001
    ) {
        return false;
    }

    if (
        Number(directOfflineNpfActiveReads || 0) > 0
        || Number(directOfflineNpfReadQueue?.length || 0) > 0
    ) {
        return false;
    }

    npfGpsTileRepairLastCheckAt = Date.now();
    npfGpsTileRepairCheckCount += 1;

    const before = collectNpfVisibleTileRepairState();
    const beforeProblems = countNpfVisibleTileRepairProblems(before);
    if (beforeProblems <= 0) return false;

    let removed = 0;
    for (const candidate of before.repairable) {
        try {
            if (typeof baseTileLayer._removeTile === 'function') {
                baseTileLayer._removeTile(candidate.key);
                removed += 1;
            }
        } catch (_) {}
    }

    let updateRequested = false;
    try {
        if (typeof baseTileLayer._update === 'function') {
            baseTileLayer._update(map.getCenter?.());
            updateRequested = true;
        }
    } catch (_) {}

    if (!updateRequested && removed > 0) {
        try {
            baseTileLayer.redraw?.();
            updateRequested = true;
            npfGpsTileRepairFallbackRedrawCount += 1;
            npfGpsTileRepairLastFallbackRedrawAt = Date.now();
        } catch (_) {}
    }
    if (!updateRequested) return false;

    npfGpsTileRepairTriggeredCount += 1;
    npfDiagSiaInteraction(
        'TUILES GPS REPAIR',
        `ciblée · ${reason} · z${before.zoom ?? '—'} · problèmes=${beforeProblems}`,
        {
            totalMs: 0,
            expected: Number(before.expected || 0),
            visibleEntries: Number(before.totalEntries || 0),
            healthy: Number(before.healthy || 0),
            repairable: Number(before.repairable?.length || 0),
            missingSlots: Number(before.missingSlots || 0),
            knownMissPlaceholders: Number(before.knownMissPlaceholders || 0),
            removed,
            npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
            npfReadsActive: Number(directOfflineNpfActiveReads || 0)
        }
    );

    const repairZoom = before.zoom;
    setTimeout(() => {
        if (!map || !baseTileLayer) return;
        const currentZoom = Math.round(Number(map.getZoom?.()));
        if (Number.isFinite(Number(repairZoom)) && currentZoom !== Number(repairZoom)) return;

        const after = collectNpfVisibleTileRepairState();
        const afterProblems = countNpfVisibleTileRepairProblems(after);
        const recovered = Math.max(0, beforeProblems - afterProblems);
        if (recovered > 0) npfGpsTileRepairRecoveredCount += recovered;

        npfDiagSiaInteraction(
            'TUILES GPS REPAIR',
            `vérification · ${reason} · z${after.zoom ?? '—'} · reste=${afterProblems}`,
            {
                totalMs: NPF_GPS_TILE_REPAIR_VERIFY_DELAY_MS,
                expected: Number(after.expected || 0),
                visibleEntries: Number(after.totalEntries || 0),
                healthy: Number(after.healthy || 0),
                repairable: Number(after.repairable?.length || 0),
                missingSlots: Number(after.missingSlots || 0),
                knownMissPlaceholders: Number(after.knownMissPlaceholders || 0),
                recovered,
                npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
                npfReadsActive: Number(directOfflineNpfActiveReads || 0)
            }
        );

        if (
            afterProblems > 0
            && Number(directOfflineNpfActiveReads || 0) === 0
            && Number(directOfflineNpfReadQueue?.length || 0) === 0
            && Date.now() - npfGpsTileRepairLastFallbackRedrawAt
                >= NPF_GPS_TILE_REPAIR_FALLBACK_REDRAW_COOLDOWN_MS
        ) {
            try {
                npfGpsTileRepairLastFallbackRedrawAt = Date.now();
                npfGpsTileRepairFallbackRedrawCount += 1;
                baseTileLayer.redraw?.();
                npfDiagSiaInteraction(
                    'TUILES GPS REPAIR',
                    `redraw secours · ${reason} · z${after.zoom ?? '—'} · reste=${afterProblems}`,
                    {
                        totalMs: 0,
                        repairable: Number(after.repairable?.length || 0),
                        missingSlots: Number(after.missingSlots || 0),
                        npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
                        npfReadsActive: Number(directOfflineNpfActiveReads || 0)
                    }
                );
            } catch (_) {}
        }
    }, NPF_GPS_TILE_REPAIR_VERIFY_DELAY_MS);

    return true;
}

function scheduleNpfGpsTileCoverageRepair(reason = 'gps-moveend') {
    if (
        !map
        || !baseTileLayer
        || !offlineTilesMode
        || !isNpfOfflinePackSelection()
    ) {
        return;
    }
    if (npfGpsTileRepairTimer) return;

    const elapsed = Date.now() - Number(npfGpsTileRepairLastCheckAt || 0);
    const delay = Math.max(
        NPF_GPS_TILE_REPAIR_INITIAL_DELAY_MS,
        NPF_GPS_TILE_REPAIR_MIN_INTERVAL_MS - elapsed
    );

    npfGpsTileRepairTimer = setTimeout(() => {
        npfGpsTileRepairTimer = null;
        runNpfGpsTileCoverageRepair(reason);
    }, delay);
}

function scheduleBaseMapStabilityRefresh(reason = 'map-stability') {
    if (!map || !baseTileLayer) return;
    const token = ++baseMapStabilityRefreshToken;

    /*
     * v15.37 — ne plus redessiner systématiquement toutes les tuiles après
     * chaque zoom. Leaflet a déjà demandé le nouveau niveau de zoom.
     *
     * Le redraw forcé v15.00 provoquait une seconde vague de lectures
     * IndexedDB sur la carte NPF. On conserve uniquement un filet de sécurité :
     * si aucune tuile chargée n'est réellement visible après stabilisation,
     * on déclenche alors un redraw unique.
     */
    const passes = [
        { delay: 260, rescueRedraw: true },
        { delay: 760, rescueRedraw: true }
    ];

    passes.forEach((pass, index) => {
        setTimeout(() => {
            if (token !== baseMapStabilityRefreshToken) return;
            if (!map || !baseTileLayer) return;

            try {
                if (!map.hasLayer(baseTileLayer)) {
                    baseTileLayer.addTo(map);
                }

                if (offlineTilesMode) {
                    enforceOfflineZoomLimit();
                }

                const visibleLoaded = countVisibleLoadedBaseTiles({ currentLevelOnly: true });

                const npfTileReadsBusy = !!(
                    offlineTilesMode
                    && typeof isNpfOfflinePackSelection === 'function'
                    && isNpfOfflinePackSelection()
                    && (
                        Number(directOfflineNpfActiveReads || 0) > 0
                        || Number(directOfflineNpfReadQueue?.length || 0) > 0
                    )
                );

                if (
                    pass.rescueRedraw
                    && visibleLoaded === 0
                    && !npfTileReadsBusy
                    && typeof baseTileLayer.redraw === 'function'
                ) {
                    /*
                     * Premier secours à 260 ms ; le second ne s'exécute que si
                     * la carte est toujours réellement vide à 760 ms.
                     */
                    if (index === 0) {
                        map.invalidateSize?.({
                            animate: false,
                            pan: false
                        });
                    }
                    baseTileLayer.redraw();
                }
            } catch (error) {
                console.warn(
                    'Stabilisation fond de carte impossible:',
                    reason,
                    error
                );
            }
        }, pass.delay);
    });
}

function enforceOfflineZoomLimit() {
    if (!map || !offlineTilesMode) return;

    const activeOfflineMaxZoomLimit = getOfflinePackMaxNativeZoomLimitForPacks(activeOfflinePacks);
    const safeNativeMaxZoom = Math.max(
        GLOBAL_MIN_ZOOM,
        Math.min(
            GLOBAL_MAX_ZOOM,
            activeOfflineMaxZoomLimit,
            Number.isFinite(baseTileMaxNativeZoom) ? baseTileMaxNativeZoom : activeOfflineMaxZoomLimit
        )
    );
    const safeMaxZoom = getOfflinePackMaxDisplayZoomForPacks(
        activeOfflinePacks,
        safeNativeMaxZoom
    );

    map.options.maxZoom = safeMaxZoom;

    if (map.getMaxZoom && map.getMaxZoom() !== safeMaxZoom) {
        map.setMaxZoom(safeMaxZoom);
    }

    if (map.getZoom() > safeMaxZoom) {
        map.setView(map.getCenter(), safeMaxZoom, { animate: false });
    }
}


function normalizeOfflineTileHostPrefix(packName) {
    /*
     * v12.15 — host logique stable par groupe.
     *
     * Un pack découpé en plusieurs ZIP doit utiliser le même host fictif :
     * IGN_01 / IGN_02 / IGN_03 => ign.tile.openstreetmap.org
     *
     * Sinon Leaflet ne demande les tuiles que sur le host du premier pack actif,
     * et IndexedDB doit chercher dans des clés incohérentes.
     */
    const raw = String(packName || '').trim();
    const groupName = typeof getOfflinePackGroupName === 'function'
        ? getOfflinePackGroupName(raw)
        : raw;

    const simplified = String(groupName || raw || '')
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, '');

    if (!simplified || /open\s*street|openstreet|\bosm\b/.test(simplified)) {
        return 'a';
    }

    if (/\bign\b|scan25|scan\s*25|oaci\s*ign/.test(simplified)) {
        return 'ign';
    }

    if (/oaci|carte\s*oaci/.test(simplified)) {
        return 'oaci';
    }

    const compact = simplified.replace(/[^a-z0-9]+/g, '').slice(0, 20);
    return compact || 'pack';
}


function isOpenStreetOfflinePackName(packName) {
    const simplified = String(packName || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, '');
    return /open\s*street|openstreet|\bosm\b/.test(simplified);
}

function isIgnOfflinePackName(packName) {
    const simplified = String(packName || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, '');
    return /\bign\b|scan25|scan\s*25|oaci\s*ign/.test(simplified);
}

function isOaciOfflinePackName(packName) {
    const simplified = String(packName || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, '');
    return /\boaci\b|carte\s*oaci/.test(simplified);
}

function getOfflinePackMaxNativeZoomLimitForPacks(packs = activeOfflinePacks) {
    /*
     * v13.58 — plafond plus strict pour les packs OACI/IGN.
     * Dans certains imports, la carte OACI peut être groupée ou nommée comme IGN ;
     * on limite donc aussi les packs reconnus IGN/Scan pour éviter que Leaflet
     * demande des z11/z12/z13 absents et laisse un écran vide.
     */
    const packList = Array.isArray(packs) ? packs.filter(Boolean) : [];
    const hasOaciOrIgnPack = packList.some(name => {
        const simplified = String(name || '').normalize("NFD").replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return isOaciOfflinePackName(name)
            || isIgnOfflinePackName(name)
            || /oaci|sia|scan\s*oaci|carte\s*oaci|\bign\b|scan\s*25|scan25/.test(simplified);
    });
    if (hasOaciOrIgnPack) {
        return Math.min(OFFLINE_HARD_MAX_NATIVE_ZOOM, OACI_OFFLINE_MAX_NATIVE_ZOOM);
    }
    return OFFLINE_HARD_MAX_NATIVE_ZOOM;
}

function getOfflinePackMaxDisplayZoomForPacks(
    packs = activeOfflinePacks,
    nativeMaxZoom = getOfflinePackMaxNativeZoomLimitForPacks(packs)
) {
    const safeNativeMax = Math.max(
        GLOBAL_MIN_ZOOM,
        Math.min(GLOBAL_MAX_ZOOM, Number(nativeMaxZoom))
    );
    const packList = Array.isArray(packs) ? packs.filter(Boolean) : [];
    const hasOaciPack = packList.some(name => {
        const simplified = String(name || '')
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        return isOaciOfflinePackName(name)
            || /\boaci\b|carte\s*oaci|scan\s*oaci|\bsia\b/.test(simplified);
    });

    if (!hasOaciPack) return safeNativeMax;

    /*
     * v15.43 — un seul niveau entier au-dessus de la dernière tuile native.
     * Avec la carte OACI z10, l'affichage peut donc atteindre z11 (~2 NM).
     */
    return Math.min(
        GLOBAL_MAX_ZOOM,
        OACI_OFFLINE_MAX_DISPLAY_ZOOM,
        safeNativeMax + 1
    );
}

function buildOfflineTileUrlForPack(tilePath, packName, isLargeZip = false) {
    /*
     * v12.14 — correction IGN multi-ZIP.
     *
     * Avant, tous les gros ZIP forçaient le host "a.tile.openstreetmap.org".
     * Résultat : OpenStreet et IGN pouvaient partager le même tileUrl z/x/y,
     * ce qui ralentissait fortement la recherche et pouvait provoquer des collisions.
     *
     * Maintenant :
     * - OpenStreet/OSM reste sur "a" ;
     * - IGN obtient son propre host fictif "ign" ;
     * - les autres packs gardent un host dérivé de leur nom.
     *
     * Le service worker intercepte *.tile.openstreetmap.org, donc ce host fictif
     * sert seulement de clé logique locale.
     */
    const hostPrefix = normalizeOfflineTileHostPrefix(packName);
    return `https://${hostPrefix}.tile.openstreetmap.org/${tilePath}`;
}


function scheduleOfflineTileWake(reason = 'startup') {
    const token = ++offlineTileWakeToken;

    OFFLINE_TILE_WAKE_DELAYS_MS.forEach((delay, index) => {
        setTimeout(() => {
            if (token !== offlineTileWakeToken) return;
            try {
                if (!map || !baseTileLayer) return;

                if (typeof map.invalidateSize === 'function') {
                    map.invalidateSize({ animate: false, pan: false });
                }

                if (typeof baseTileLayer.redraw === 'function' && index <= 2) {
                    baseTileLayer.redraw();
                }

                if (index === OFFLINE_TILE_WAKE_DELAYS_MS.length - 1 && typeof enforceOfflineZoomLimit === 'function') {
                    enforceOfflineZoomLimit();
                }
            } catch (error) {
                console.warn('Réveil carte offline impossible:', reason, error);
            }
        }, delay);
    });
}


/*
 * v14.69 — restauration fiable de la carte Offline mémorisée.
 *
 * Les v14.66/v14.67 reconstruisaient plusieurs fois la couche Leaflet, mais avec
 * les mêmes informations de pack déjà présentes en mémoire. Sur Safari/iPadOS,
 * les bases IndexedDB isolées peuvent ne devenir réellement lisibles que
 * plusieurs secondes après l'ouverture. Dans ce cas, les premières lectures
 * échouaient, Leaflet conservait les tuiles neutres et l'utilisateur devait
 * sélectionner une autre carte puis revenir sur la carte voulue.
 *
 * Cette version reproduit complètement la sélection manuelle :
 * - relit la liste des packs installés depuis localStorage ;
 * - réconcilie le groupe mémorisé avec tous ses fichiers réellement installés ;
 * - recalcule bases et alias ;
 * - attend qu'au moins une base de tuiles contienne effectivement des données ;
 * - ferme les connexions de lecture périmées puis recrée la couche une seule fois
 *   lorsque IndexedDB est prêt.
 */
function reconcileRememberedOfflinePacksWithInstalledMetadata() {
    if (!Array.isArray(activeOfflinePacks) || !activeOfflinePacks.length) {
        return false;
    }

    const installed = getInstalledMapPacksSafe();
    if (!installed.length) return false;

    const rememberedGroup = getOfflinePackGroupName(activeOfflinePacks[0]);
    const installedGroupPacks = installed
        .filter(pack => (
            pack
            && getOfflinePackGroupName(pack.name) === rememberedGroup
        ))
        .map(pack => String(pack.name || '').trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(
            right,
            'fr',
            { numeric: true, sensitivity: 'base' }
        ));

    if (!installedGroupPacks.length) return false;

    const current = [...activeOfflinePacks]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(
            right,
            'fr',
            { numeric: true, sensitivity: 'base' }
        ));

    if (JSON.stringify(current) !== JSON.stringify(installedGroupPacks)) {
        activeOfflinePacks = installedGroupPacks;
        try {
            localStorage.setItem(
                OFFLINE_ACTIVE_PACKS_KEY,
                JSON.stringify(activeOfflinePacks)
            );
        } catch (_) {}
    }

    refreshRememberedOfflinePackRuntimeMetadata();
    return true;
}

function refreshRememberedOfflinePackRuntimeMetadata() {
    if (!Array.isArray(activeOfflinePacks)) activeOfflinePacks = [];

    activeOfflinePackDatabases =
        getOfflineActivePackDatabasesForPacks(activeOfflinePacks);
    activeOfflinePackAliases =
        getOfflineActivePackAliasesForPacks(activeOfflinePacks);

    try {
        localStorage.setItem(
            OFFLINE_ACTIVE_PACK_DATABASES_KEY,
            JSON.stringify(activeOfflinePackDatabases)
        );
        localStorage.setItem(
            OFFLINE_ACTIVE_PACK_ALIASES_KEY,
            JSON.stringify(activeOfflinePackAliases)
        );
    } catch (_) {}
}

function closeDirectOfflineDatabaseConnectionsForStartupRetry() {
    try {
        directOfflineDbPromises.forEach(promise => {
            Promise.resolve(promise)
                .then(openedDb => {
                    try { openedDb?.close(); } catch (_) {}
                })
                .catch(() => {});
        });
        directOfflineDbPromises.clear();
    } catch (_) {}
}

function countDirectOfflineTilesInDatabase(openedDb) {
    return new Promise((resolve, reject) => {
        let transaction;
        let request;
        try {
            transaction = openedDb.transaction('tiles', 'readonly');
            request = transaction.objectStore('tiles').count();
        } catch (error) {
            reject(error);
            return;
        }
        request.onsuccess = () => resolve(Number(request.result) || 0);
        request.onerror = () => reject(
            request.error || new Error('Comptage des tuiles impossible')
        );
        transaction.onabort = () => reject(
            transaction.error || new Error('Comptage des tuiles annulé')
        );
    });
}

function databaseHasTileForActiveOfflineSelection(openedDb) {
    return new Promise((resolve, reject) => {
        let tx;
        let store;
        try {
            tx = openedDb.transaction('tiles', 'readonly');
            store = tx.objectStore('tiles');
        } catch (error) {
            reject(error);
            return;
        }

        const aliases = [];
        const addAlias = value => {
            const clean = String(value || '').replace(/\.zip$/i, '').trim();
            if (clean && !aliases.includes(clean)) aliases.push(clean);
        };
        (Array.isArray(activeOfflinePacks) ? activeOfflinePacks : []).forEach(addAlias);
        (Array.isArray(activeOfflinePackAliases) ? activeOfflinePackAliases : []).forEach(addAlias);

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            resolve(!!value);
        };
        const fail = error => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        let aliasIndex = 0;
        const tryAlias = () => {
            if (settled) return;
            if (!store.indexNames.contains('packName') || aliasIndex >= aliases.length) {
                let cursorRequest;
                try { cursorRequest = store.openCursor(); } catch (error) { fail(error); return; }
                let inspected = 0;
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor || inspected >= 120) { finish(false); return; }
                    inspected += 1;
                    if (isDirectOfflineTileRecordAllowed(cursor.value || {})) { finish(true); return; }
                    cursor.continue();
                };
                cursorRequest.onerror = () => fail(cursorRequest.error || new Error('Sondage tuiles impossible'));
                return;
            }

            const alias = aliases[aliasIndex++];
            let request;
            try {
                request = store.index('packName').openKeyCursor(IDBKeyRange.only(alias));
            } catch (error) {
                fail(error);
                return;
            }
            request.onsuccess = () => {
                if (request.result) { finish(true); return; }
                tryAlias();
            };
            request.onerror = tryAlias;
        };

        tx.onerror = () => fail(tx.error || new Error('Sondage IndexedDB échoué'));
        tx.onabort = () => fail(tx.error || new Error('Sondage IndexedDB annulé'));
        tryAlias();
    });
}

function getPreferredStartupOfflineDatabaseCandidates() {
    const allCandidates = getDirectOfflineDatabaseCandidates();
    if (!isNpfOfflinePackSelection()) return allCandidates;

    const activeGroups = new Set(
        (Array.isArray(activeOfflinePacks) ? activeOfflinePacks : [])
            .map(name => getOfflinePackGroupName(name))
            .filter(Boolean)
    );
    const explicitDatabases = getInstalledMapPacksSafe()
        .filter(pack => (
            pack
            && pack.dbName
            && activeGroups.has(getOfflinePackGroupName(pack.name))
        ))
        .map(pack => String(pack.dbName || '').trim())
        .filter(Boolean);

    if (!explicitDatabases.length) return allCandidates;
    return [...new Set(explicitDatabases)];
}

async function waitForRememberedOfflineTileDatabaseReady() {
    const databaseNames = getPreferredStartupOfflineDatabaseCandidates();
    const isNpf = isNpfOfflinePackSelection();

    for (const dbName of databaseNames) {
        try {
            const openedDb = await withTimeout(
                openDirectOfflineTileDatabase(dbName),
                isNpf ? 7500 : 3000,
                `Timeout ouverture ${dbName}`
            );
            const hasActiveTile = await withTimeout(
                databaseHasTileForActiveOfflineSelection(openedDb),
                isNpf ? 6500 : 2600,
                `Timeout sondage ${dbName}`
            );
            if (hasActiveTile) {
                return { dbName, tileCount: 1 };
            }
        } catch (_) {
            /* La tentative suivante rouvrira la base avec une connexion fraîche. */
        }
    }

    return null;
}

function rebuildRememberedOfflineMapAfterDatabaseReady(reason, readyDatabase) {
    if (mapSourceMode !== 'offline' || !map) return false;

    directOfflineTileBlobCache.clear();
    clearDirectOfflineNpfZoomReturnCache();
    directOfflineTileMissCache.clear();
    directOfflineTileHitCount = 0;
    directOfflineTileMissCount = 0;
    directOfflineNpfMainRamHitCount = 0;
    directOfflineNpfIndexedDbLookupCount = 0;
    offlineTilesMode = true;
    applyImmediateBaseTileZoomForMapSource('offline');

    try {
        setupBaseTileLayer();
        map.invalidateSize?.({ animate: false, pan: false });
        baseTileLayer?.redraw?.();
        scheduleOfflineTileWake(`db-ready:${reason}`);
        setOfflineMapSwitchBusy(
            `Mode OFFLINE — carte locale prête (${readyDatabase.dbName}).`
        );
        return true;
    } catch (error) {
        console.warn(
            '[Offline] Reconstruction après disponibilité IndexedDB impossible:',
            reason,
            error
        );
        return false;
    }
}

function scheduleRememberedOfflineMapStartupRecovery(
    reason = 'startup-remembered-offline-map'
) {
    const token = ++offlineStartupLayerRecoveryToken;

    if (
        mapSourceMode !== 'offline'
        || !Array.isArray(activeOfflinePacks)
        || !activeOfflinePacks.length
    ) {
        return false;
    }

    reconcileRememberedOfflinePacksWithInstalledMetadata();
    refreshRememberedOfflinePackRuntimeMetadata();

    try {
        localStorage.removeItem(OFFLINE_TILES_MIN_ZOOM_KEY);
        localStorage.removeItem(OFFLINE_TILES_MAX_ZOOM_KEY);
    } catch (_) {}

    offlineTilesMode = true;
    applyImmediateBaseTileZoomForMapSource('offline');

    const rememberedGroup = getOfflinePackGroupName(activeOfflinePacks[0]);
    /*
     * v14.69 — tentatives strictement séquentielles.
     * Les anciens setTimeout parallèles pouvaient se chevaucher sur la grosse
     * base NPF : une tentative fermait la connexion pendant qu'une autre lisait.
     */
    const retryWaits = [80, 450, 900, 1600, 2800, 4500, 7000];

    const runAttempt = async index => {
        if (token !== offlineStartupLayerRecoveryToken) return;
        if (mapSourceMode !== 'offline' || !map) return;
        if (directOfflineTileHitCount > 0) return;

        const currentGroup = getOfflinePackGroupName(
            activeOfflinePacks?.[0] || ''
        );
        if (currentGroup !== rememberedGroup) return;

        reconcileRememberedOfflinePacksWithInstalledMetadata();
        refreshRememberedOfflinePackRuntimeMetadata();
        if (
            index > 0
            && directOfflineNpfActiveReads === 0
            && directOfflineNpfReadQueue.length === 0
        ) {
            closeDirectOfflineDatabaseConnectionsForStartupRetry();
        }

        const readyDatabase = await waitForRememberedOfflineTileDatabaseReady();
        if (token !== offlineStartupLayerRecoveryToken) return;
        if (mapSourceMode !== 'offline') return;

        if (readyDatabase) {
            rebuildRememberedOfflineMapAfterDatabaseReady(
                `${reason}:attempt-${index + 1}`,
                readyDatabase
            );
        }

        if (directOfflineTileHitCount > 0) return;
        const nextIndex = index + 1;
        if (nextIndex >= retryWaits.length) {
            setOfflineMapSwitchBusy(
                readyDatabase
                    ? 'Mode OFFLINE actif — carte NPF en cours de réveil.'
                    : 'Mode OFFLINE actif — stockage local encore indisponible.'
            );
            return;
        }

        setTimeout(
            () => runAttempt(nextIndex),
            readyDatabase ? Math.max(3000, retryWaits[nextIndex]) : retryWaits[nextIndex]
        );
    };

    setTimeout(() => runAttempt(0), retryWaits[0]);
    return true;
}

(function setupRememberedOfflineMapResumeRecovery() {
    if (window.__npfRememberedOfflineMapResumeRecoveryInstalled) return;
    window.__npfRememberedOfflineMapResumeRecoveryInstalled = true;

    window.addEventListener('pageshow', () => {
        setTimeout(() => {
            if (mapSourceMode === 'offline' && directOfflineTileHitCount === 0) {
                scheduleRememberedOfflineMapStartupRecovery('pageshow-v14.69');
            }
        }, 180);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        setTimeout(() => {
            if (mapSourceMode === 'offline' && directOfflineTileHitCount === 0) {
                scheduleRememberedOfflineMapStartupRecovery('visibility-v14.69');
            }
        }, 250);
    }, { passive: true });
})();

function scheduleStartupAuxiliaryLayers() {
    /*
     * v13.58 — iPad : on ne charge plus les couches annexes en même temps que les
     * premières tuiles offline. Safari/IndexedDB devient très lent si la carte,
     * les lignes HT, les communes et les départements démarrent simultanément.
     */
    recordNpfStartupDiagnosticOverlaySnapshot('état mémorisé au démarrage');
    const baseDelay = offlineTilesMode ? OFFLINE_AUX_LAYER_START_DELAY_MS : 900;

    if (areDepartmentsVisible) {
        setTimeout(() => {
            npfStartupDiagMark('layer_departments_start', 'Calque départements — début');
            try { toggleDepartmentsLayer(true); } finally {
                npfStartupDiagMark('layer_departments_called', 'Calque départements — commande terminée');
            }
        }, baseDelay + 600);
    }

    areCommunesVisible = localStorage.getItem(SHOW_COMMUNES_LAYER_KEY) === 'true';
    if (areCommunesVisible) {
        setTimeout(() => {
            npfStartupDiagMark('layer_communes_start', 'Calque communes — début');
            try { toggleCommunesLayer(true); } finally {
                npfStartupDiagMark('layer_communes_called', 'Calque communes — commande terminée');
            }
        }, baseDelay + 1400);
    }

    if (showHighVoltageLinesLayer && isHighVoltageLayerEffectiveAtCurrentScale()) {
        setTimeout(() => {
            npfStartupDiagMark('layer_ht_start', 'Lignes HT — début');
            try {
                toggleHighVoltageLinesLayer(true, { silent: true, retry: true, source: 'startup' });
            } finally {
                npfStartupDiagMark('layer_ht_called', 'Lignes HT — commande terminée');
            }
        }, baseDelay + 2200);
    } else if (showHighVoltageLinesLayer) {
        npfStartupDiagMark(
            'layer_ht_scale_deferred',
            'Lignes HT — différées',
            'échelle 50 NM ou plus'
        );
    }

    if (showRoadOverlayLayer) {
        setTimeout(() => {
            npfStartupDiagMark('layer_routes_start', 'Calque routes — début');
            try {
                toggleRoadOverlayLayer(true, { silent: true, source: 'startup' });
            } finally {
                npfStartupDiagMark('layer_routes_called', 'Calque routes — commande terminée');
            }
        }, baseDelay + 2800);
    }

    if (showTrafficLayer) {
        setTimeout(() => {
            npfStartupDiagMark('layer_traffic_start', 'Trafic — début');
            try { toggleTrafficLayer(true); } finally {
                npfStartupDiagMark('layer_traffic_called', 'Trafic — commande terminée');
            }
        }, baseDelay + 3600);
    }
}

function setOfflineMapSwitchBusy(message = 'Changement de carte offline...') {
    try {
        const statusMessage = document.getElementById('import-status-message');
        if (statusMessage) statusMessage.textContent = message;
    } catch (_) {}
}

function closeOfflineMapModalSoon(delay = 120) {
    setTimeout(() => {
        try {
            const modal = document.getElementById('offline-map-modal');
            if (modal) modal.style.display = 'none';
        } catch (_) {}
    }, delay);
}

function rebuildBaseTileLayerAfterOfflineSwitch(reason = 'offline-switch') {
    try {
        if (map) {
            setupBaseTileLayer();
            scheduleOfflineTileWake(reason);
        }
    } catch (error) {
        console.warn('Reconstruction carte offline impossible:', reason, error);
    }
}


/*
 * v14.63 — lecture directe des tuiles Offline depuis IndexedDB.
 *
 * La carte ne dépend plus du service worker pour afficher les packs téléchargés.
 * Safari peut conserver une page sans contrôleur SW après une mise à jour : dans
 * ce cas l'ancien système envoyait les requêtes vers un host fictif et la carte
 * restait vide. Cette couche Leaflet lit maintenant directement les blobs dans
 * les bases IndexedDB existantes. Le service worker reste utilisé pour le cache
 * applicatif et comme chemin de compatibilité secondaire.
 */
const DIRECT_OFFLINE_TILE_CACHE_MAX = 256;
const DIRECT_OFFLINE_NPF_TILE_CACHE_MAX = 160;
/*
 * v17.21/v17.22 — cache de retour de zoom NPF, séparé du LRU principal.
 * Le cache historique reste strictement à 160 entrées ; ce cache conserve des
 * références Blob des derniers niveaux déjà peints pour accélérer un zoom OUT
 * vers une échelle récemment affichée sans relecture IndexedDB.
 */
const DIRECT_OFFLINE_NPF_ZOOM_RETURN_CACHE_MAX = 128;
/*
 * v17.23/v17.24 — les niveaux opérationnels 50 NM (z7), 20 NM (z8) et
 * 10 NM (z9) restent protégés dans le cache retour pendant toute la session.
 * Ils ne comptent pas dans les 4 niveaux récents ordinaires et sont évincés en
 * dernier recours seulement si, à eux seuls, ils dépassaient la limite globale
 * de 128 blobs.
 */
const DIRECT_OFFLINE_NPF_ZOOM_RETURN_LEVELS = 4;
const DIRECT_OFFLINE_NPF_ZOOM_RETURN_PROTECTED_LEVELS = new Set([7, 8, 9]);
const DIRECT_OFFLINE_TILE_MISS_CACHE_MAX = 512;
const DIRECT_OFFLINE_TILE_MISS_CACHE_TTL_MS = 30000;
const directOfflineTileBlobCache = new Map();
const directOfflineNpfZoomReturnBlobCache = new Map();
const directOfflineNpfZoomReturnLevelKeys = new Map();
const directOfflineNpfZoomReturnLevelOrder = [];
let directOfflineNpfMainRamHitCount = 0;
let directOfflineNpfZoomReturnCacheHitCount = 0;
let directOfflineNpfIndexedDbLookupCount = 0;
const directOfflineTileMissCache = new Map();
const directOfflineDbPromises = new Map();
let directOfflineTileHitCount = 0;
let directOfflineTileMissCount = 0;

/*
 * v14.87 — récupération automatique après panne temporaire d'IndexedDB.
 * Safari peut invalider une connexion pendant un usage long ou sous pression
 * mémoire. Les erreurs techniques ne doivent plus être assimilées à des tuiles
 * réellement absentes.
 */
const DIRECT_OFFLINE_READ_ERROR_THRESHOLD = 4;
const DIRECT_OFFLINE_RECOVERY_COOLDOWN_MS = 12000;
let directOfflineConsecutiveReadErrors = 0;
let directOfflineRecoveryInProgress = false;
let directOfflineLastRecoveryAt = 0;
let directOfflineRecoveryCount = 0;
let directOfflineLastRecoveryReason = '';

/*
 * v14.69 — lecture NPF à froid stabilisée.
 *
 * La carte NPF est nettement plus volumineuse que la carte OACI. Safari peut
 * mettre plusieurs secondes à ouvrir son index IndexedDB et supporte mal une
 * rafale de transactions parallèles au premier affichage. On limite donc la
 * concurrence uniquement pour le groupe NPF ; OACI conserve son chemin rapide.
 */
/*
 * v16.71 — retour ciblé au comportement de carte de v16.50 :
 * 5 lectures IndexedDB simultanées fixes.
 */
const DIRECT_OFFLINE_NPF_MAX_CONCURRENT_READS = 5;

/*
 * v16.89 — base v16.88.
 * Version essentiellement DIAGNOSTIC :
 * - distingue la durée du geste de la vraie saccade (gaps >100/150/250 ms) ;
 * - corrèle les gaps aux blocages JS et aux activités Routes/HT/SIA/tuiles/GPS ;
 * - photographie les couches Leaflet et les files de tuiles au début/à la fin.
 * Aucun moteur de rendu Routes/HT/SIA ni moteur de tuiles n'est optimisé ici.
 * Le moteur de tuiles v16.75 reste strictement inchangé.
 */
const DIRECT_OFFLINE_NPF_MAX_QUEUED_READS = 160;

function getDirectOfflineNpfMaxConcurrentReads() {
    return DIRECT_OFFLINE_NPF_MAX_CONCURRENT_READS;
}
const DIRECT_OFFLINE_TILE_ABORTED = Symbol('direct-offline-tile-aborted');
let directOfflineNpfActiveReads = 0;
const directOfflineNpfReadQueue = [];
const directOfflineNpfInflightReads = new Map();
let directOfflineTileReadGeneration = 0;
let directOfflineTileViewPriorityEpoch = 0;
let directOfflineNpfAbortedReadCount = 0;
let directOfflineNpfQueuedDiscardCount = 0;
let directOfflineNpfTileRetryCount = 0;
const directOfflineTileLookupHints = new Map();
const DIRECT_OFFLINE_TILE_LOOKUP_HINT_MAX = 256;
const DIRECT_OFFLINE_TILE_LOOKUP_PARENT_ZOOM = 8;
let directOfflineNpfLastSuccessfulLookup = null;

function markDirectOfflineNpfViewportPriority(reason = 'view-change') {
    directOfflineTileViewPriorityEpoch += 1;
    return directOfflineTileViewPriorityEpoch;
}

function buildDirectOfflineTileBlobCacheKey(coords) {
    const z = Number(coords?.z);
    const x = Number(coords?.x);
    const y = Number(coords?.y);
    if (![z, x, y].every(Number.isFinite)) return '';
    return [
        z,
        x,
        y,
        ...(Array.isArray(activeOfflinePacks) ? activeOfflinePacks : [])
    ].join('|');
}

function getDirectOfflineNpfQueueTileKey(coords) {
    if (!coords) return '';
    try {
        if (baseTileLayer && typeof baseTileLayer._tileCoordsToKey === 'function') {
            return String(baseTileLayer._tileCoordsToKey(coords));
        }
    } catch (_) {}
    const x = Number(coords?.x);
    const y = Number(coords?.y);
    const z = Number(coords?.z);
    if (![x, y, z].every(Number.isFinite)) return '';
    return `${x}:${y}:${z}`;
}

function pruneDirectOfflineNpfQueueForCurrentView(reason = 'view-end') {
    if (!directOfflineNpfReadQueue.length || !baseTileLayer || !map) return 0;

    const retainedTiles = baseTileLayer._tiles || {};
    const currentZoom = Math.round(Number(map.getZoom?.()));
    const retainedKeys = new Set(Object.keys(retainedTiles));
    const kept = [];
    const removed = [];

    for (const item of directOfflineNpfReadQueue) {
        const coords = item?.coords || null;
        const z = Number(coords?.z);
        const tileKey = String(item?.tileKey || getDirectOfflineNpfQueueTileKey(coords));
        const sameGeneration = item?.hardGeneration === directOfflineTileReadGeneration;
        const sameZoom = Number.isFinite(currentZoom) && Number.isFinite(z) && z === currentZoom;
        const retained = !!tileKey && retainedKeys.has(tileKey);
        const latestViewport = (Number(item?.viewEpoch) || 0) === directOfflineTileViewPriorityEpoch;

        /*
         * Toujours conserver les demandes créées pour le viewport courant,
         * même si Leaflet n'a pas encore inscrit la tuile dans _tiles au même
         * instant. Pour les anciens epochs, ne garder que les tuiles encore
         * réellement retenues par la GridLayer.
         */
        if (sameGeneration && sameZoom && (latestViewport || retained)) {
            kept.push(item);
        } else {
            removed.push(item);
        }
    }

    if (!removed.length) return 0;

    directOfflineNpfReadQueue.length = 0;
    directOfflineNpfReadQueue.push(...kept);

    for (const item of removed) {
        directOfflineNpfQueuedDiscardCount += 1;
        try { item.resolve(DIRECT_OFFLINE_TILE_ABORTED); } catch (_) {}
    }

    return removed.length;
}

function resetPendingDirectOfflineNpfReads() {
    /*
     * Reset DUR : réservé aux changements de source/base et aux récupérations
     * IndexedDB. Les gestes de carte n'appellent plus cette fonction en v16.46.
     */
    directOfflineTileReadGeneration += 1;
    directOfflineTileViewPriorityEpoch += 1;
    while (directOfflineNpfReadQueue.length) {
        const pending = directOfflineNpfReadQueue.shift();
        directOfflineNpfQueuedDiscardCount += 1;
        try { pending.resolve(DIRECT_OFFLINE_TILE_ABORTED); } catch (_) {}
    }
}

function isNpfOfflinePackSelection(packs = activeOfflinePacks) {
    return (Array.isArray(packs) ? packs : []).some(name => {
        const simplified = String(
            typeof getOfflinePackGroupName === 'function'
                ? getOfflinePackGroupName(name)
                : name || ''
        ).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return /(^|[^a-z0-9])npf([^a-z0-9]|$)|npf[_\s-]*france|carte[_\s-]*npf/.test(simplified);
    });
}

function runNextDirectOfflineNpfRead() {
    while (
        directOfflineNpfActiveReads < getDirectOfflineNpfMaxConcurrentReads()
        && directOfflineNpfReadQueue.length
    ) {
        /*
         * v17.14 — conserver la priorité d'epoch v17.12, mais ne plus traiter
         * en FIFO aveugle les tuiles du même geste. Lors d'un pan long, les
         * premières demandes de l'epoch peuvent être déjà loin du viewport
         * final alors que les tuiles actuellement visibles attendent derrière.
         *
         * Ordre de choix dans le meilleur epoch :
         * 1) zoom actuellement rendu par la GridLayer ;
         * 2) tuile la plus proche du centre courant du viewport ;
         * 3) FIFO seulement en dernier départage.
         *
         * Les lectures déjà actives ne sont jamais annulées et le nombre de
         * lectures simultanées reste strictement inchangé.
         */
        let bestEpoch = -Infinity;
        for (const queued of directOfflineNpfReadQueue) {
            bestEpoch = Math.max(bestEpoch, Number(queued?.viewEpoch) || 0);
        }

        let targetZoom = Number(baseTileLayer?._tileZoom);
        if (!Number.isFinite(targetZoom)) {
            targetZoom = Math.round(Number(map?.getZoom?.()));
        }

        let mapCenter = null;
        try { mapCenter = map?.getCenter?.() || null; } catch (_) {}
        const tileSize = (() => {
            try {
                const size = baseTileLayer?.getTileSize?.();
                const value = Number(size?.x || size?.y);
                if (Number.isFinite(value) && value > 0) return value;
            } catch (_) {}
            return 256;
        })();
        const centerByZoom = new Map();
        const getCenterTileAtZoom = (zoom) => {
            const z = Number(zoom);
            if (!Number.isFinite(z) || !mapCenter || !map) return null;
            if (centerByZoom.has(z)) return centerByZoom.get(z);
            try {
                const projected = map.project(mapCenter, z);
                const centerTile = {
                    x: Number(projected?.x) / tileSize,
                    y: Number(projected?.y) / tileSize
                };
                if (Number.isFinite(centerTile.x) && Number.isFinite(centerTile.y)) {
                    centerByZoom.set(z, centerTile);
                    return centerTile;
                }
            } catch (_) {}
            centerByZoom.set(z, null);
            return null;
        };

        let itemIndex = -1;
        let bestZoomDelta = Infinity;
        let bestCenterDistance = Infinity;

        for (let i = 0; i < directOfflineNpfReadQueue.length; i += 1) {
            const queued = directOfflineNpfReadQueue[i];
            if ((Number(queued?.viewEpoch) || 0) !== bestEpoch) continue;

            const coords = queued?.coords || null;
            const z = Number(coords?.z);
            const x = Number(coords?.x);
            const y = Number(coords?.y);
            const zoomDelta = Number.isFinite(targetZoom) && Number.isFinite(z)
                ? Math.abs(z - targetZoom)
                : 0;

            let centerDistance = Infinity;
            if ([x, y, z].every(Number.isFinite)) {
                const centerTile = getCenterTileAtZoom(z);
                if (centerTile) {
                    const dx = (x + 0.5) - centerTile.x;
                    const dy = (y + 0.5) - centerTile.y;
                    centerDistance = dx * dx + dy * dy;
                }
            }

            if (
                itemIndex < 0
                || zoomDelta < bestZoomDelta
                || (zoomDelta === bestZoomDelta && centerDistance < bestCenterDistance)
            ) {
                itemIndex = i;
                bestZoomDelta = zoomDelta;
                bestCenterDistance = centerDistance;
            }
        }

        if (itemIndex < 0) itemIndex = 0;
        const item = directOfflineNpfReadQueue.splice(itemIndex, 1)[0];

        if (item?.hardGeneration !== directOfflineTileReadGeneration) {
            directOfflineNpfQueuedDiscardCount += 1;
            try { item.resolve(DIRECT_OFFLINE_TILE_ABORTED); } catch (_) {}
            continue;
        }

        directOfflineNpfActiveReads += 1;
        Promise.resolve()
            .then(item.task)
            .then(item.resolve, item.reject)
            .finally(() => {
                directOfflineNpfActiveReads = Math.max(0, directOfflineNpfActiveReads - 1);
                runNextDirectOfflineNpfRead();
            });
    }
}

function enqueueDirectOfflineNpfRead(task, options = {}) {
    return new Promise((resolve, reject) => {
        const coords = options?.coords
            ? { x: Number(options.coords.x), y: Number(options.coords.y), z: Number(options.coords.z) }
            : null;
        const item = {
            task,
            resolve,
            reject,
            hardGeneration: Number.isFinite(Number(options.hardGeneration))
                ? Number(options.hardGeneration)
                : directOfflineTileReadGeneration,
            viewEpoch: Number.isFinite(Number(options.viewEpoch))
                ? Number(options.viewEpoch)
                : directOfflineTileViewPriorityEpoch,
            coords,
            tileKey: getDirectOfflineNpfQueueTileKey(coords)
        };
        directOfflineNpfReadQueue.push(item);

        /*
         * v16.49 — la file ne doit jamais conserver des dizaines de tuiles
         * appartenant à d'anciens zooms/pans. Si elle grossit, on purge
         * uniquement les demandes que la GridLayer courante ne retient plus.
         */
        if (directOfflineNpfReadQueue.length > DIRECT_OFFLINE_NPF_MAX_QUEUED_READS) {
            try { pruneDirectOfflineNpfQueueForCurrentView('queue-limit'); } catch (_) {}
        }
        runNextDirectOfflineNpfRead();
    });
}

function getOfflinePackLegacyGroupNameForDirectRead(packName) {
    const name = String(packName || '')
        .replace(/\.zip$/i, '')
        .trim();
    const cleaned = name
        .replace(/\s*\(\d+\)\s*$/i, '')
        .replace(/\s+(copy|copie)\s*$/i, '')
        .trim();
    const match = cleaned.match(
        /^(.+?)(?:[\s_-]*(?:part|partie|zip)?[\s_-]*)(\d{1,3})$/i
    );
    if (match && match[1].trim().length >= 2) {
        return match[1].replace(/[\s_-]+$/g, '').trim();
    }
    return cleaned;
}

function normalizeOfflineTileHostPrefixForDirectRead(packName, { legacy = false } = {}) {
    const raw = String(packName || '').trim();
    const groupName = legacy
        ? getOfflinePackLegacyGroupNameForDirectRead(raw)
        : (typeof getOfflinePackGroupName === 'function'
            ? getOfflinePackGroupName(raw)
            : raw);
    const simplified = String(groupName || raw || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (!simplified || /open\s*street|openstreet|\bosm\b/.test(simplified)) return 'a';
    if (/\bign\b|scan25|scan\s*25|oaci\s*ign/.test(simplified)) return 'ign';
    if (/oaci|carte\s*oaci/.test(simplified)) return 'oaci';
    return simplified.replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'pack';
}

function getDirectOfflineTileUrlCandidates(coords) {
    const aliases = [
        ...(Array.isArray(activeOfflinePacks) ? activeOfflinePacks : []),
        ...(typeof getOfflineActivePackAliasesForPacks === 'function'
            ? getOfflineActivePackAliasesForPacks(activeOfflinePacks)
            : []),
        ...(Array.isArray(activeOfflinePackAliases) ? activeOfflinePackAliases : [])
    ];
    const prefixes = [];
    const addPrefix = value => {
        const clean = String(value || '').trim();
        if (clean && !prefixes.includes(clean)) prefixes.push(clean);
    };
    aliases.forEach(alias => {
        addPrefix(normalizeOfflineTileHostPrefixForDirectRead(alias));
        addPrefix(normalizeOfflineTileHostPrefixForDirectRead(alias, { legacy: true }));
    });
    if (!prefixes.length) addPrefix('a');
    const strictNpfIsolatedLookup = (
        isNpfOfflinePackSelection()
        && activeOfflineSelectionUsesCompleteIsolatedStorage()
    );
    if (!strictNpfIsolatedLookup) {
        ['a', 'ign', 'oaci'].forEach(addPrefix);
    }

    const urls = [];
    const addUrl = value => {
        const clean = String(value || '').trim();
        if (clean && !urls.includes(clean)) urls.push(clean);
    };
    prefixes.forEach(prefix => {
        ['png', 'jpg', 'jpeg'].forEach(extension => {
            addUrl(`https://${prefix}.tile.openstreetmap.org/${coords.z}/${coords.x}/${coords.y}.${extension}`);
        });
    });
    return urls;
}

function activeOfflineSelectionUsesCompleteIsolatedStorage() {
    const packs = Array.isArray(activeOfflinePacks)
        ? activeOfflinePacks.filter(Boolean)
        : [];
    if (!packs.length || typeof getInstalledMapPacksSafe !== 'function') return false;

    const installed = getInstalledMapPacksSafe();
    if (!Array.isArray(installed) || !installed.length) return false;

    return packs.every(packName => {
        const canonical = typeof normalizeOfflinePackName === 'function'
            ? normalizeOfflinePackName(packName)
            : String(packName || '').trim();
        const record = installed.find(pack => {
            if (!pack) return false;
            const installedCanonical = typeof normalizeOfflinePackName === 'function'
                ? normalizeOfflinePackName(pack.name)
                : String(pack.name || '').trim();
            return installedCanonical === canonical;
        });
        if (!record) return false;
        const dbName = String(record.dbName || '').trim();
        const storageMode = String(record.storageMode || '').trim().toLowerCase();
        return !!dbName
            && dbName !== String(OFFLINE_DB_NAME || '')
            && storageMode.startsWith('isolated-');
    });
}

function getDirectOfflineDatabaseCandidates() {
    const names = [];
    const skipLegacyCommonDb = activeOfflineSelectionUsesCompleteIsolatedStorage();
    const addName = value => {
        const clean = String(value || '').trim();
        if (!clean) return;
        if (skipLegacyCommonDb && clean === String(OFFLINE_DB_NAME || '')) return;
        if (!names.includes(clean)) names.push(clean);
    };
    (Array.isArray(activeOfflinePackDatabases) ? activeOfflinePackDatabases : [])
        .forEach(addName);
    if (typeof getOfflineActivePackDatabasesForPacks === 'function') {
        getOfflineActivePackDatabasesForPacks(activeOfflinePacks).forEach(addName);
    }
    if (!skipLegacyCommonDb || !names.length) addName(OFFLINE_DB_NAME);
    return names;
}

function getDirectOfflineTileSelectionSignature() {
    return (Array.isArray(activeOfflinePacks) ? activeOfflinePacks : [])
        .map(name => (
            typeof normalizeOfflinePackName === 'function'
                ? normalizeOfflinePackName(name)
                : String(name || '').trim()
        ))
        .filter(Boolean)
        .sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true }))
        .join('|');
}

function getDirectOfflineTileLookupHintKey(coords) {
    const z = Math.max(0, Number(coords?.z) || 0);
    const x = Math.max(0, Number(coords?.x) || 0);
    const y = Math.max(0, Number(coords?.y) || 0);
    const parentZoom = Math.min(z, DIRECT_OFFLINE_TILE_LOOKUP_PARENT_ZOOM);
    const divisor = Math.pow(2, Math.max(0, z - parentZoom));

    return [
        getDirectOfflineTileSelectionSignature(),
        parentZoom,
        Math.floor(x / divisor),
        Math.floor(y / divisor)
    ].join('|');
}

function getDirectOfflineTileUrlTemplate(tileUrl) {
    const match = String(tileUrl || '').match(/^(https:\/\/[^/]+)\/\d+\/\d+\/\d+\.(png|jpe?g)(?:\?.*)?$/i);
    if (!match) return null;
    return { origin: match[1], extension: match[2].toLowerCase() };
}

function buildDirectOfflineTileUrlFromTemplate(template, coords) {
    if (!template?.origin || !template?.extension) return '';
    return `${template.origin}/${coords.z}/${coords.x}/${coords.y}.${template.extension}`;
}

function rememberDirectOfflineTileLookupHint(coords, dbName, tileUrl) {
    const key = getDirectOfflineTileLookupHintKey(coords);
    const template = getDirectOfflineTileUrlTemplate(tileUrl);
    const hint = {
        dbName: String(dbName || ''),
        template
    };
    directOfflineTileLookupHints.delete(key);
    directOfflineTileLookupHints.set(key, hint);
    if (isNpfOfflinePackSelection() && hint.dbName) {
        directOfflineNpfLastSuccessfulLookup = hint;
    }
    while (directOfflineTileLookupHints.size > DIRECT_OFFLINE_TILE_LOOKUP_HINT_MAX) {
        const oldestKey = directOfflineTileLookupHints.keys().next().value;
        directOfflineTileLookupHints.delete(oldestKey);
    }
}

function getDirectOfflineTileLookupHint(coords) {
    const spatialHint = directOfflineTileLookupHints.get(
        getDirectOfflineTileLookupHintKey(coords)
    );
    if (spatialHint) return spatialHint;
    if (isNpfOfflinePackSelection() && directOfflineNpfLastSuccessfulLookup?.dbName) {
        return directOfflineNpfLastSuccessfulLookup;
    }
    return null;
}

function promoteDirectOfflineLookupCandidate(list, preferred) {
    const safeList = Array.isArray(list) ? [...list] : [];
    const clean = String(preferred || '').trim();
    if (!clean) return safeList;
    const index = safeList.indexOf(clean);
    if (index > 0) {
        safeList.splice(index, 1);
        safeList.unshift(clean);
    } else if (index < 0) {
        safeList.unshift(clean);
    }
    return safeList;
}

function openDirectOfflineTileDatabase(dbName) {
    const safeName = String(dbName || OFFLINE_DB_NAME);
    if (directOfflineDbPromises.has(safeName)) {
        return directOfflineDbPromises.get(safeName);
    }
    const promise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }
        const request = indexedDB.open(safeName);
        let databaseDidNotExist = false;
        request.onupgradeneeded = event => {
            /* Ne pas créer silencieusement une base vide lors d'une simple lecture. */
            databaseDidNotExist = true;
            try { event.target.transaction.abort(); } catch (_) {}
        };
        request.onsuccess = event => {
            const openedDb = event.target.result;
            if (databaseDidNotExist || !openedDb.objectStoreNames.contains('tiles')) {
                try { openedDb.close(); } catch (_) {}
                reject(new Error(`Base de tuiles absente : ${safeName}`));
                return;
            }
            try {
                openedDb.onversionchange = () => {
                    try { openedDb.close(); } catch (_) {}
                    directOfflineDbPromises.delete(safeName);
                };
            } catch (_) {}
            resolve(openedDb);
        };
        request.onerror = () => reject(request.error || new Error(`Ouverture impossible : ${safeName}`));
        request.onblocked = () => reject(new Error(`Base bloquée : ${safeName}`));
    }).catch(error => {
        directOfflineDbPromises.delete(safeName);
        throw error;
    });
    directOfflineDbPromises.set(safeName, promise);
    return promise;
}

function isDirectOfflineTileRecordAllowed(record) {
    const activeNames = new Set([
        ...(Array.isArray(activeOfflinePacks) ? activeOfflinePacks : []),
        ...(typeof getOfflineActivePackAliasesForPacks === 'function'
            ? getOfflineActivePackAliasesForPacks(activeOfflinePacks)
            : []),
        ...(Array.isArray(activeOfflinePackAliases) ? activeOfflinePackAliases : [])
    ].filter(Boolean));
    if (!activeNames.size) return true;
    const recordPack = String(record?.packName || '').trim();
    if (!recordPack) return true; // anciennes bases sans champ packName
    if (activeNames.has(recordPack)) return true;
    const recordCanonical = typeof normalizeOfflinePackName === 'function'
        ? normalizeOfflinePackName(recordPack)
        : recordPack;
    const recordGroup = typeof getOfflinePackGroupName === 'function'
        ? getOfflinePackGroupName(recordPack)
        : recordPack;
    for (const activeName of activeNames) {
        if (typeof normalizeOfflinePackName === 'function'
            && normalizeOfflinePackName(activeName) === recordCanonical) return true;
        if (typeof getOfflinePackGroupName === 'function'
            && getOfflinePackGroupName(activeName) === recordGroup) return true;
    }
    return false;
}

function getDirectOfflineStoredKeyCandidates(tileUrl) {
    const packNames = [];
    const addPack = value => {
        const clean = String(value || '').replace(/\.zip$/i, '').trim();
        if (clean && !packNames.includes(clean)) packNames.push(clean);
    };

    (Array.isArray(activeOfflinePacks) ? activeOfflinePacks : []).forEach(addPack);
    (Array.isArray(activeOfflinePackAliases) ? activeOfflinePackAliases : []).forEach(addPack);
    if (typeof getOfflineActivePackAliasesForPacks === 'function') {
        getOfflineActivePackAliasesForPacks(activeOfflinePacks).forEach(addPack);
    }

    const keys = [];
    const addKey = value => {
        const clean = String(value || '').trim();
        if (clean && !keys.includes(clean)) keys.push(clean);
    };

    /* Clés pack-scopées utilisées par NPF/OACI depuis les imports récents. */
    packNames.forEach(packName => addKey(buildStoredTileKey(tileUrl, packName)));
    /* Compatibilité avec les anciens packs à clé URL simple. */
    addKey(tileUrl);
    return keys;
}

function readDirectOfflineTileRecord(db, tileUrl, options = {}) {
    const allowLegacyFallback = options.allowLegacyFallback !== false;

    return new Promise((resolve, reject) => {
        let tx;
        let store;
        try {
            tx = db.transaction('tiles', 'readonly');
            store = tx.objectStore('tiles');
        } catch (error) {
            reject(error);
            return;
        }

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const fail = error => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        const readByTileUrlIndex = () => {
            if (settled) return;
            if (!store.indexNames.contains('tileUrl')) {
                if (allowLegacyFallback) {
                    readByLegacyKeys();
                } else {
                    finish(null);
                }
                return;
            }

            let request;
            try {
                request = store.index('tileUrl').openCursor(IDBKeyRange.only(tileUrl));
            } catch (error) {
                fail(error);
                return;
            }

            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    if (allowLegacyFallback) {
                        readByLegacyKeys();
                    } else {
                        finish(null);
                    }
                    return;
                }
                const record = cursor.value || {};
                if (isDirectOfflineTileRecordAllowed(record)) {
                    finish(record);
                    return;
                }
                cursor.continue();
            };
            request.onerror = () => fail(request.error || new Error('Erreur lecture index tileUrl'));
        };

        const exactKeys = allowLegacyFallback
            ? getDirectOfflineStoredKeyCandidates(tileUrl)
            : [];
        let keyIndex = 0;

        const readByLegacyCursor = () => {
            if (settled) return;
            let request;
            try {
                request = store.openCursor();
            } catch (error) {
                fail(error);
                return;
            }
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    finish(null);
                    return;
                }
                const record = cursor.value || {};
                const storedTileUrl = record.tileUrl || getTileUrlFromStoredKey(record.url);
                if (storedTileUrl === tileUrl && isDirectOfflineTileRecordAllowed(record)) {
                    finish(record);
                    return;
                }
                cursor.continue();
            };
            request.onerror = () => fail(request.error || new Error('Erreur lecture legacy tuile'));
        };

        const readByLegacyKeys = () => {
            if (settled) return;
            if (!allowLegacyFallback) {
                finish(null);
                return;
            }
            if (keyIndex >= exactKeys.length) {
                readByLegacyCursor();
                return;
            }
            const key = exactKeys[keyIndex++];
            let request;
            try {
                request = store.get(key);
            } catch (error) {
                fail(error);
                return;
            }
            request.onsuccess = () => {
                const record = request.result || null;
                if (record && isDirectOfflineTileRecordAllowed(record)) {
                    finish(record);
                    return;
                }
                readByLegacyKeys();
            };
            request.onerror = readByLegacyKeys;
        };

        tx.onerror = () => fail(tx.error || new Error('Erreur transaction tuile'));
        tx.onabort = () => fail(tx.error || new Error('Transaction tuile annulée'));

        /*
         * v14.95 — les imports modernes possèdent un index `tileUrl` : une seule
         * recherche indexée remplace les dizaines de `store.get()` essayées avant.
         * Le chemin historique n'est conservé que lorsque la base peut réellement
         * contenir d'anciens enregistrements sans champ `tileUrl`.
         */
        readByTileUrlIndex();
    });
}

function getDirectOfflineTileBlobCacheLimit() {
    return isNpfOfflinePackSelection()
        ? DIRECT_OFFLINE_NPF_TILE_CACHE_MAX
        : DIRECT_OFFLINE_TILE_CACHE_MAX;
}

function trimDirectOfflineTileBlobCache(maxEntries = getDirectOfflineTileBlobCacheLimit()) {
    const safeMax = Math.max(0, Number(maxEntries) || 0);
    while (directOfflineTileBlobCache.size > safeMax) {
        const oldestKey = directOfflineTileBlobCache.keys().next().value;
        directOfflineTileBlobCache.delete(oldestKey);
    }
}

function rememberDirectOfflineTileBlob(cacheKey, blob) {
    if (!blob) return;
    directOfflineTileBlobCache.delete(cacheKey);
    directOfflineTileBlobCache.set(cacheKey, blob);
    trimDirectOfflineTileBlobCache();
}

/*
 * v17.22 — FAST-PATH RAM AVANT LE SCHEDULER INDEXEDDB.
 * Une tuile déjà présente en mémoire ne doit pas attendre derrière les 5 lectures
 * IndexedDB. Le cache principal est prioritaire ; le cache retour zoom intervient
 * uniquement si la tuile a quitté le LRU principal.
 */
function getDirectOfflineCachedTileBlob(coords) {
    const cacheKey = buildDirectOfflineTileBlobCacheKey(coords);
    if (!cacheKey) return null;
    const trackNpf = isNpfOfflinePackSelection();

    if (directOfflineTileBlobCache.has(cacheKey)) {
        const cachedBlob = directOfflineTileBlobCache.get(cacheKey);
        directOfflineTileBlobCache.delete(cacheKey);
        directOfflineTileBlobCache.set(cacheKey, cachedBlob);
        if (trackNpf) directOfflineNpfMainRamHitCount += 1;
        resetDirectOfflineReadErrorCounter();
        return cachedBlob;
    }

    if (directOfflineNpfZoomReturnBlobCache.has(cacheKey)) {
        const cachedBlob = directOfflineNpfZoomReturnBlobCache.get(cacheKey);
        directOfflineNpfZoomReturnBlobCache.delete(cacheKey);
        directOfflineNpfZoomReturnBlobCache.set(cacheKey, cachedBlob);
        if (trackNpf) directOfflineNpfZoomReturnCacheHitCount += 1;
        rememberDirectOfflineTileBlob(cacheKey, cachedBlob);
        resetDirectOfflineReadErrorCounter();
        return cachedBlob;
    }

    return null;
}

function clearDirectOfflineNpfZoomReturnCache() {
    directOfflineNpfZoomReturnBlobCache.clear();
    directOfflineNpfZoomReturnLevelKeys.clear();
    directOfflineNpfZoomReturnLevelOrder.length = 0;
    directOfflineNpfMainRamHitCount = 0;
    directOfflineNpfZoomReturnCacheHitCount = 0;
    directOfflineNpfIndexedDbLookupCount = 0;
}

function trimDirectOfflineNpfZoomReturnCache() {
    /*
     * v17.23/v17.24 — z7 (50 NM), z8 (20 NM) et z9 (10 NM) sont des niveaux
     * de retour opérationnels : ils restent protégés même lorsque quatre niveaux
     * plus rapprochés ont été visités ensuite.
     */
    const recentOrdinaryLevels = directOfflineNpfZoomReturnLevelOrder.filter(zoom =>
        !DIRECT_OFFLINE_NPF_ZOOM_RETURN_PROTECTED_LEVELS.has(Number(zoom))
    );

    while (recentOrdinaryLevels.length > DIRECT_OFFLINE_NPF_ZOOM_RETURN_LEVELS) {
        const oldZoom = recentOrdinaryLevels.shift();
        const oldKeys = directOfflineNpfZoomReturnLevelKeys.get(oldZoom);
        if (oldKeys) {
            for (const key of oldKeys) directOfflineNpfZoomReturnBlobCache.delete(key);
        }
        directOfflineNpfZoomReturnLevelKeys.delete(oldZoom);
        const orderIndex = directOfflineNpfZoomReturnLevelOrder.indexOf(oldZoom);
        if (orderIndex >= 0) directOfflineNpfZoomReturnLevelOrder.splice(orderIndex, 1);
    }

    while (directOfflineNpfZoomReturnBlobCache.size > DIRECT_OFFLINE_NPF_ZOOM_RETURN_CACHE_MAX) {
        let evictKey = null;

        /* Évacuer d'abord une tuile d'un niveau ordinaire. */
        for (const key of directOfflineNpfZoomReturnBlobCache.keys()) {
            let keyZoom = null;
            for (const [zoom, keys] of directOfflineNpfZoomReturnLevelKeys.entries()) {
                if (keys.has(key)) {
                    keyZoom = Number(zoom);
                    break;
                }
            }
            if (!DIRECT_OFFLINE_NPF_ZOOM_RETURN_PROTECTED_LEVELS.has(keyZoom)) {
                evictKey = key;
                break;
            }
        }

        /* Secours borné : respecter malgré tout la limite absolue de 128. */
        if (!evictKey) evictKey = directOfflineNpfZoomReturnBlobCache.keys().next().value;
        if (!evictKey) break;

        directOfflineNpfZoomReturnBlobCache.delete(evictKey);
        for (const [zoom, keys] of directOfflineNpfZoomReturnLevelKeys.entries()) {
            if (!keys.delete(evictKey)) continue;
            if (!keys.size) {
                directOfflineNpfZoomReturnLevelKeys.delete(zoom);
                const orderIndex = directOfflineNpfZoomReturnLevelOrder.indexOf(zoom);
                if (orderIndex >= 0) directOfflineNpfZoomReturnLevelOrder.splice(orderIndex, 1);
            }
            break;
        }
    }
}

function rememberCurrentNpfZoomLevelForFastReturn(reason = 'grid-ready') {
    if (
        !baseTileLayer
        || !map
        || !offlineTilesMode
        || !isNpfOfflinePackSelection()
    ) return 0;

    const tileZoom = Number(baseTileLayer?._tileZoom);
    if (!Number.isFinite(tileZoom)) return 0;

    const nextKeys = new Set();
    const entries = Object.values(baseTileLayer?._tiles || {});
    for (const entry of entries) {
        const coords = entry?.coords;
        const tile = entry?.el;
        if (!coords || Number(coords.z) !== tileZoom || !tile) continue;
        const loaded = tile.classList?.contains('leaflet-tile-loaded')
            || (tile.complete && Number(tile.naturalWidth) > 0);
        if (!loaded) continue;

        const cacheKey = buildDirectOfflineTileBlobCacheKey(coords);
        if (!cacheKey) continue;
        const blob = directOfflineTileBlobCache.get(cacheKey)
            || directOfflineNpfZoomReturnBlobCache.get(cacheKey);
        if (!blob) continue;

        directOfflineNpfZoomReturnBlobCache.delete(cacheKey);
        directOfflineNpfZoomReturnBlobCache.set(cacheKey, blob);
        nextKeys.add(cacheKey);
    }

    if (!nextKeys.size) return 0;

    const previousKeys = directOfflineNpfZoomReturnLevelKeys.get(tileZoom);
    if (previousKeys) {
        for (const key of previousKeys) {
            if (!nextKeys.has(key)) directOfflineNpfZoomReturnBlobCache.delete(key);
        }
    }
    directOfflineNpfZoomReturnLevelKeys.set(tileZoom, nextKeys);

    const previousOrderIndex = directOfflineNpfZoomReturnLevelOrder.indexOf(tileZoom);
    if (previousOrderIndex >= 0) directOfflineNpfZoomReturnLevelOrder.splice(previousOrderIndex, 1);
    directOfflineNpfZoomReturnLevelOrder.push(tileZoom);
    trimDirectOfflineNpfZoomReturnCache();
    return nextKeys.size;
}

function rememberDirectOfflineTileMiss(cacheKey) {
    if (!cacheKey) return;
    directOfflineTileMissCache.delete(cacheKey);
    directOfflineTileMissCache.set(cacheKey, Date.now());
    while (directOfflineTileMissCache.size > DIRECT_OFFLINE_TILE_MISS_CACHE_MAX) {
        const oldestKey = directOfflineTileMissCache.keys().next().value;
        directOfflineTileMissCache.delete(oldestKey);
    }
}

function isPrimaryDirectOfflineDatabaseCandidate(dbName) {
    const activeNames = Array.isArray(activeOfflinePackDatabases)
        ? activeOfflinePackDatabases.filter(Boolean).map(String)
        : [];

    if (activeNames.length) {
        return activeNames.includes(String(dbName || ''));
    }

    return String(dbName || '') === String(OFFLINE_DB_NAME || '');
}

function isRecoverableDirectOfflineReadError(error) {
    const message = String(error?.message || error || '');
    if (!message) return false;

    /*
     * Une base candidate inexistante est normale pour certaines anciennes
     * configurations. Elle ne doit pas déclencher de récupération.
     */
    if (
        /Base de tuiles absente/i.test(message)
        || /object store.*absent/i.test(message)
        || /NotFoundError/i.test(message)
    ) {
        return false;
    }

    return /timeout|bloqu|blocked|transaction|annul|abort|InvalidState|DatabaseClosed|closing|inactive|unknownerror|operationerror/i.test(
        message
    );
}

function resetDirectOfflineReadErrorCounter() {
    directOfflineConsecutiveReadErrors = 0;
}

async function recoverDirectOfflineTileReader(reason = 'read-error') {
    if (
        directOfflineRecoveryInProgress
        || mapSourceMode !== 'offline'
        || !Array.isArray(activeOfflinePacks)
        || !activeOfflinePacks.length
    ) {
        return false;
    }

    const now = Date.now();
    if (
        now - directOfflineLastRecoveryAt
        < DIRECT_OFFLINE_RECOVERY_COOLDOWN_MS
    ) {
        return false;
    }

    directOfflineRecoveryInProgress = true;
    directOfflineLastRecoveryAt = now;
    directOfflineLastRecoveryReason = String(reason || 'read-error');
    directOfflineRecoveryCount += 1;

    try {
        setOfflineMapSwitchBusy(
            'Mode OFFLINE — réouverture automatique du stockage local…'
        );

        resetPendingDirectOfflineNpfReads();
        closeDirectOfflineDatabaseConnectionsForStartupRetry();
        directOfflineTileBlobCache.clear();
        clearDirectOfflineNpfZoomReturnCache();
        directOfflineTileMissCache.clear();
        directOfflineTileLookupHints.clear();
        directOfflineNpfLastSuccessfulLookup = null;
        directOfflineTileMissCount = 0;

        await new Promise(resolve => setTimeout(resolve, 180));

        reconcileRememberedOfflinePacksWithInstalledMetadata();
        refreshRememberedOfflinePackRuntimeMetadata();

        const readyDatabase =
            await waitForRememberedOfflineTileDatabaseReady();

        if (readyDatabase) {
            const rebuilt = rebuildRememberedOfflineMapAfterDatabaseReady(
                `automatic-read-recovery:${directOfflineLastRecoveryReason}`,
                readyDatabase
            );
            if (rebuilt) {
                setOfflineMapSwitchBusy(
                    'Mode OFFLINE — accès aux cartes locales rétabli.'
                );
                return true;
            }
        }

        /*
         * Chemin de secours : reconstruire quand même la couche ; les tentatives
         * de réveil déjà présentes poursuivront l'ouverture de la base.
         */
        if (map && mapSourceMode === 'offline') {
            setupBaseTileLayer();
            scheduleOfflineTileWake('automatic-read-recovery-fallback');
            scheduleRememberedOfflineMapStartupRecovery(
                'automatic-read-recovery-fallback'
            );
        }
        return false;
    } catch (error) {
        console.warn(
            '[Offline] Récupération automatique IndexedDB impossible:',
            error
        );
        return false;
    } finally {
        directOfflineConsecutiveReadErrors = 0;
        directOfflineRecoveryInProgress = false;
    }
}

function registerDirectOfflineReadError(error, context = '') {
    if (
        mapSourceMode !== 'offline'
        || !isRecoverableDirectOfflineReadError(error)
    ) {
        return false;
    }

    directOfflineConsecutiveReadErrors += 1;
    console.warn(
        '[Offline] Erreur lecture tuile locale:',
        context,
        error
    );

    if (
        directOfflineConsecutiveReadErrors
        >= DIRECT_OFFLINE_READ_ERROR_THRESHOLD
        && !directOfflineRecoveryInProgress
    ) {
        /*
         * Décaler la fermeture des connexions pour laisser la transaction
         * courante sortir proprement de sa pile d'exécution.
         */
        setTimeout(() => {
            recoverDirectOfflineTileReader(
                context || 'consecutive-read-errors'
            ).catch(() => {});
        }, 120);
    }

    return true;
}

window.getNpfOfflineRecoveryStatus = function getNpfOfflineRecoveryStatus() {
    return {
        consecutiveReadErrors: directOfflineConsecutiveReadErrors,
        recoveryInProgress: directOfflineRecoveryInProgress,
        recoveryCount: directOfflineRecoveryCount,
        lastRecoveryAt: directOfflineLastRecoveryAt,
        lastRecoveryReason: directOfflineLastRecoveryReason
    };
};


/*
 * v16.93 — instrumentation PASSIVE des lectures de tuiles.
 * Aucun événement UI n'est généré à chaque lecture : on garde uniquement
 * de petits buffers en mémoire, résumés ensuite par TUILES ZOOM PASSIF.
 */
const DIRECT_OFFLINE_TILE_IO_DIAG_LIMIT = 240;
let directOfflineTileIdbDiagSeq = 0;
let directOfflineTileLookupDiagSeq = 0;
const directOfflineTileIdbDiagEvents = [];
const directOfflineTileLookupDiagEvents = [];

function directOfflineTileDiagNow() {
    try {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
    } catch (_) {}
    return Date.now();
}

function pushDirectOfflineTileDiagEvent(buffer, event) {
    buffer.push(event);
    if (buffer.length > DIRECT_OFFLINE_TILE_IO_DIAG_LIMIT) {
        buffer.splice(0, buffer.length - DIRECT_OFFLINE_TILE_IO_DIAG_LIMIT);
    }
}

function recordDirectOfflineTileIdbDiagEvent(event = {}) {
    directOfflineTileIdbDiagSeq += 1;
    pushDirectOfflineTileDiagEvent(directOfflineTileIdbDiagEvents, {
        seq: directOfflineTileIdbDiagSeq,
        ...event
    });
}

function recordDirectOfflineTileLookupDiagEvent(event = {}) {
    directOfflineTileLookupDiagSeq += 1;
    pushDirectOfflineTileDiagEvent(directOfflineTileLookupDiagEvents, {
        seq: directOfflineTileLookupDiagSeq,
        ...event
    });
}

function getDirectOfflineTileIdbDiagEventsSince(seq) {
    const minSeq = Math.max(0, Number(seq) || 0);
    return directOfflineTileIdbDiagEvents.filter(event => Number(event?.seq) > minSeq);
}

function getDirectOfflineTileLookupDiagEventsSince(seq) {
    const minSeq = Math.max(0, Number(seq) || 0);
    return directOfflineTileLookupDiagEvents.filter(event => Number(event?.seq) > minSeq);
}

function summarizeDirectOfflineTileIdbDiagEvents(events = []) {
    const safe = Array.isArray(events) ? events : [];
    const durations = safe.map(event => Math.max(0, Number(event?.durationMs) || 0));
    const totalMs = durations.reduce((sum, value) => sum + value, 0);
    const maxMs = durations.length ? Math.max(...durations) : 0;

    return {
        count: safe.length,
        found: safe.filter(event => event?.outcome === 'hit').length,
        miss: safe.filter(event => event?.outcome === 'miss').length,
        errors: safe.filter(event => event?.outcome === 'error').length,
        avgMs: safe.length ? Math.round(totalMs / safe.length) : 0,
        maxMs: Math.round(maxMs),
        ge500: durations.filter(value => value >= 500).length,
        ge1000: durations.filter(value => value >= 1000).length,
        indexGets: safe.reduce(
            (sum, event) => sum + Math.max(0, Number(event?.indexGets) || 0),
            0
        ),
        indexDirectHits: safe.reduce(
            (sum, event) => sum + Math.max(0, Number(event?.indexDirectHits) || 0),
            0
        ),
        indexCursorFallbacks: safe.reduce(
            (sum, event) => sum + Math.max(0, Number(event?.indexCursorFallbacks) || 0),
            0
        ),
        indexCursorMax: safe.length
            ? Math.max(...safe.map(event => Math.max(0, Number(event?.indexCursorSteps) || 0)))
            : 0,
        legacyReads: safe.filter(
            event => Number(event?.legacyGets) > 0 || Number(event?.legacyCursorSteps) > 0
        ).length
    };
}

function summarizeDirectOfflineTileLookupDiagEvents(events = []) {
    const safe = Array.isArray(events) ? events : [];
    const durations = safe.map(event => Math.max(0, Number(event?.durationMs) || 0));
    const totalMs = durations.reduce((sum, value) => sum + value, 0);
    const slowest = safe.reduce((best, event) => {
        if (!best) return event;
        return (Number(event?.durationMs) || 0) > (Number(best?.durationMs) || 0)
            ? event
            : best;
    }, null);

    return {
        count: safe.length,
        cacheHits: safe.filter(event => event?.outcome === 'cache-hit').length,
        idbLookups: safe.filter(
            event => !['cache-hit', 'miss-cache'].includes(String(event?.outcome || ''))
        ).length,
        avgMs: safe.length ? Math.round(totalMs / safe.length) : 0,
        maxMs: safe.length
            ? Math.round(Math.max(...durations))
            : 0,
        dbAttempts: safe.reduce(
            (sum, event) => sum + Math.max(0, Number(event?.dbAttempts) || 0),
            0
        ),
        urlAttempts: safe.reduce(
            (sum, event) => sum + Math.max(0, Number(event?.urlAttempts) || 0),
            0
        ),
        openMs: Math.round(safe.reduce(
            (sum, event) => sum + Math.max(0, Number(event?.openMs) || 0),
            0
        )),
        readMs: Math.round(safe.reduce(
            (sum, event) => sum + Math.max(0, Number(event?.readMs) || 0),
            0
        )),
        readTimeouts: safe.reduce(
            (sum, event) => sum + Math.max(0, Number(event?.readTimeouts) || 0),
            0
        ),
        slowestCoords: slowest?.coords
            ? `${slowest.coords.z}/${slowest.coords.x}/${slowest.coords.y}`
            : ''
    };
}

/*
 * v15.37 TEST — diagnostic léger, accessible uniquement depuis la console.
 * Permet de vérifier si un ralentissement vient encore de la file IndexedDB.
 */
window.getNpfTilePerformanceStatus = function getNpfTilePerformanceStatus() {
    return {
        npfSelected: isNpfOfflinePackSelection(),
        activeReads: directOfflineNpfActiveReads,
        queuedReads: directOfflineNpfReadQueue.length,
        maxConcurrentReads: DIRECT_OFFLINE_NPF_MAX_CONCURRENT_READS,
        schedulerMode: 'v16.50-priority-immediate',
        viewPriorityEpoch: directOfflineTileViewPriorityEpoch,
        abortedReads: directOfflineNpfAbortedReadCount,
        tileRetries: directOfflineNpfTileRetryCount,
        lookupHints: directOfflineTileLookupHints.size,
        blobCacheSize: directOfflineTileBlobCache.size,
        blobCacheMax: getDirectOfflineTileBlobCacheLimit(),
        mainRamHits: directOfflineNpfMainRamHitCount,
        zoomReturnCacheSize: directOfflineNpfZoomReturnBlobCache.size,
        zoomReturnCacheMax: DIRECT_OFFLINE_NPF_ZOOM_RETURN_CACHE_MAX,
        zoomReturnCacheHits: directOfflineNpfZoomReturnCacheHitCount,
        indexedDbLookups: directOfflineNpfIndexedDbLookupCount,
        gpsTileRepairChecks: npfGpsTileRepairCheckCount,
        gpsTileRepairTriggers: npfGpsTileRepairTriggeredCount,
        gpsTileRepairRecovered: npfGpsTileRepairRecoveredCount,
        gpsTileRepairFallbackRedraws: npfGpsTileRepairFallbackRedrawCount,
        tileHits: directOfflineTileHitCount,
        tileMisses: directOfflineTileMissCount,
        visibleLoadedTiles: countVisibleLoadedBaseTiles()
    };
};

async function findDirectOfflineTileBlobUnqueued(coords) {
    const cacheKey = buildDirectOfflineTileBlobCacheKey(coords);

    const cachedBlob = getDirectOfflineCachedTileBlob(coords);
    if (cachedBlob) return cachedBlob;

    if (directOfflineTileMissCache.has(cacheKey)) {
        const cachedMissAt = Number(directOfflineTileMissCache.get(cacheKey)) || 0;
        if (Date.now() - cachedMissAt <= DIRECT_OFFLINE_TILE_MISS_CACHE_TTL_MS) {
            directOfflineTileMissCache.delete(cacheKey);
            directOfflineTileMissCache.set(cacheKey, cachedMissAt);
            return null;
        }
        directOfflineTileMissCache.delete(cacheKey);
    }

    if (isNpfOfflinePackSelection()) {
        directOfflineNpfIndexedDbLookupCount += 1;
    }

    const lookupHint = getDirectOfflineTileLookupHint(coords);
    let dbNames = getDirectOfflineDatabaseCandidates();
    let tileUrls = getDirectOfflineTileUrlCandidates(coords);
    if (lookupHint?.dbName) {
        dbNames = promoteDirectOfflineLookupCandidate(dbNames, lookupHint.dbName);
    }
    const hintedTileUrl = buildDirectOfflineTileUrlFromTemplate(lookupHint?.template, coords);
    if (hintedTileUrl) {
        tileUrls = promoteDirectOfflineLookupCandidate(tileUrls, hintedTileUrl);
    }
    let hadRecoverableTechnicalError = false;

    for (const dbName of dbNames) {
        let tileDb;
        try {
            const openTimeoutMs = isNpfOfflinePackSelection() ? 7000 : 2200;
            tileDb = await withTimeout(
                openDirectOfflineTileDatabase(dbName),
                openTimeoutMs,
                `Timeout ouverture ${dbName}`
            );
        } catch (error) {
            if (
                isPrimaryDirectOfflineDatabaseCandidate(dbName)
                && registerDirectOfflineReadError(
                    error,
                    `ouverture ${dbName}`
                )
            ) {
                hadRecoverableTechnicalError = true;
            }
            continue;
        }

        for (const tileUrl of tileUrls) {
            try {
                const readTimeoutMs = isNpfOfflinePackSelection() ? 5200 : 1800;
                const allowLegacyFallback = String(dbName || '') === String(OFFLINE_DB_NAME || '');
                const record = await withTimeout(
                    readDirectOfflineTileRecord(tileDb, tileUrl, { allowLegacyFallback }),
                    readTimeoutMs,
                    'Timeout lecture tuile'
                );
                if (!record?.tile) continue;

                const blob = record.tile instanceof Blob
                    ? record.tile
                    : new Blob([record.tile], {
                        type: /\.(jpg|jpeg)(?:\?.*)?$/i.test(tileUrl)
                            ? 'image/jpeg'
                            : 'image/png'
                    });

                rememberDirectOfflineTileBlob(cacheKey, blob);
                rememberDirectOfflineTileLookupHint(coords, dbName, tileUrl);
                resetDirectOfflineReadErrorCounter();
                directOfflineTileHitCount += 1;

                if (directOfflineTileHitCount === 1) {
                    setOfflineMapSwitchBusy(
                        'Mode OFFLINE — tuiles locales chargées.'
                    );
                }
                return blob;
            } catch (error) {
                if (
                    isPrimaryDirectOfflineDatabaseCandidate(dbName)
                    && registerDirectOfflineReadError(
                        error,
                        `lecture ${dbName}`
                    )
                ) {
                    hadRecoverableTechnicalError = true;
                }
            }
        }
    }

    /*
     * Ne pas annoncer une tuile absente lorsque la lecture a échoué pour une
     * raison technique : la récupération automatique est déjà en cours.
     */
    if (hadRecoverableTechnicalError) {
        return null;
    }

    rememberDirectOfflineTileMiss(cacheKey);
    directOfflineTileMissCount += 1;
    if (
        directOfflineTileHitCount === 0
        && directOfflineTileMissCount === 6
    ) {
        setOfflineMapSwitchBusy(
            'Mode OFFLINE actif — aucune tuile trouvée ici à ce niveau de zoom.'
        );
    }
    return null;
}

async function findDirectOfflineTileBlob(coords) {
    if (!isNpfOfflinePackSelection()) {
        return findDirectOfflineTileBlobUnqueued(coords);
    }

    /*
     * v17.22 — RAM avant file : si le Blob existe déjà, ne créer ni élément
     * de queue ni créneau parmi les 5 lectures IndexedDB.
     */
    const cachedBlob = getDirectOfflineCachedTileBlob(coords);
    if (cachedBlob) return cachedBlob;

    const hardGeneration = directOfflineTileReadGeneration;
    const viewEpoch = directOfflineTileViewPriorityEpoch;
    const inflightKey = [
        hardGeneration,
        coords?.z,
        coords?.x,
        coords?.y,
        ...(Array.isArray(activeOfflinePacks) ? activeOfflinePacks : [])
    ].join('|');

    const existing = directOfflineNpfInflightReads.get(inflightKey);
    if (existing) return existing;

    const pending = enqueueDirectOfflineNpfRead(async () => {
        if (hardGeneration !== directOfflineTileReadGeneration) {
            directOfflineNpfAbortedReadCount += 1;
            return DIRECT_OFFLINE_TILE_ABORTED;
        }
        const blob = await findDirectOfflineTileBlobUnqueued(coords);
        if (hardGeneration !== directOfflineTileReadGeneration) {
            directOfflineNpfAbortedReadCount += 1;
            return DIRECT_OFFLINE_TILE_ABORTED;
        }
        return blob;
    }, { hardGeneration, viewEpoch, coords });

    directOfflineNpfInflightReads.set(inflightKey, pending);
    pending.finally(() => {
        if (directOfflineNpfInflightReads.get(inflightKey) === pending) {
            directOfflineNpfInflightReads.delete(inflightKey);
        }
    });

    return pending;
}

function buildDirectOfflineLeafletLayer(options = {}) {
    const DirectOfflineGridLayer = L.GridLayer.extend({
        createTile(coords, done) {
            const tile = document.createElement('img');
            tile.alt = '';
            tile.setAttribute('role', 'presentation');
            tile.decoding = 'async';
            tile.style.width = '100%';
            tile.style.height = '100%';
            tile.__npfDisposed = false;
            tile.__npfDone = false;
            tile.__npfBlobUrl = '';
            tile.__npfPlaceholder = false;
            tile.__npfPlaceholderRetryable = false;

            const revokeBlobUrl = () => {
                const blobUrl = String(tile.__npfBlobUrl || '');
                tile.__npfBlobUrl = '';
                if (blobUrl) {
                    try { URL.revokeObjectURL(blobUrl); } catch (_) {}
                }
            };
            const finish = (error = null) => {
                if (tile.__npfDone) return;
                tile.__npfDone = true;
                revokeBlobUrl();
                try { done(error, tile); } catch (_) {}
            };
            tile.__npfFinish = finish;
            tile.__npfDispose = () => {
                if (tile.__npfDisposed) return;
                tile.__npfDisposed = true;
                tile.onload = null;
                tile.onerror = null;
                revokeBlobUrl();
                try { tile.removeAttribute('src'); } catch (_) {}
                finish(null);
            };

            tile.__npfReadRetryCount = 0;

            const requestTileBlob = () => {
                if (tile.__npfDisposed || tile.__npfDone) {
                    finish(null);
                    return;
                }

                findDirectOfflineTileBlob(coords).then(blob => {
                    if (tile.__npfDisposed) {
                        finish(null);
                        return;
                    }

                    if (blob === DIRECT_OFFLINE_TILE_ABORTED) {
                        /*
                         * v16.49 — une demande retirée d'une ancienne vue ne
                         * doit pas se réinjecter dans la file. On ne retente que
                         * si cette tuile appartient encore réellement à la
                         * GridLayer et au zoom courant.
                         */
                        let stillNeeded = false;
                        try {
                            const tileKey = typeof this._tileCoordsToKey === 'function'
                                ? this._tileCoordsToKey(coords)
                                : `${coords.x}:${coords.y}:${coords.z}`;
                            const retained = this._tiles?.[tileKey];
                            stillNeeded = (
                                !tile.__npfDisposed
                                && Number(coords.z) === Math.round(Number(map?.getZoom?.()))
                                && !!retained
                                && (!retained.el || retained.el === tile)
                            );
                        } catch (_) {}

                        if (!stillNeeded) {
                            finish(null);
                            return;
                        }

                        tile.__npfReadRetryCount += 1;
                        directOfflineNpfTileRetryCount += 1;
                        const retryDelay = Math.min(
                            450,
                            45 + tile.__npfReadRetryCount * 45
                        );
                        setTimeout(requestTileBlob, retryDelay);
                        return;
                    }

                    if (!blob) {
                        const cacheKey = buildDirectOfflineTileBlobCacheKey(coords);
                        const cachedMissAt = Number(directOfflineTileMissCache.get(cacheKey)) || 0;
                        const knownMiss = cachedMissAt > 0
                            && Date.now() - cachedMissAt <= DIRECT_OFFLINE_TILE_MISS_CACHE_TTL_MS;
                        tile.__npfPlaceholder = true;
                        /* Une vraie absence connue ne doit pas être retentée en boucle. */
                        tile.__npfPlaceholderRetryable = !knownMiss;
                        tile.onload = () => finish(null);
                        tile.onerror = error => finish(error || new Error('Tuile absente'));
                        tile.src = OFFLINE_TILE_PLACEHOLDER_DATA_URL;
                        return;
                    }

                    tile.__npfPlaceholder = false;
                    tile.__npfPlaceholderRetryable = false;
                    const blobUrl = URL.createObjectURL(blob);
                    tile.__npfBlobUrl = blobUrl;
                    tile.onload = () => finish(null);
                    tile.onerror = error => finish(error || new Error('Décodage tuile impossible'));
                    if (tile.__npfDisposed) {
                        finish(null);
                        return;
                    }
                    tile.src = blobUrl;
                }).catch(error => {
                    if (tile.__npfDisposed) {
                        finish(null);
                        return;
                    }
                    tile.__npfPlaceholder = true;
                    tile.__npfPlaceholderRetryable = true;
                    tile.onload = () => finish(null);
                    tile.onerror = () => finish(error);
                    tile.src = OFFLINE_TILE_PLACEHOLDER_DATA_URL;
                });
            };

            requestTileBlob();
            return tile;
        }
    });

    const layer = new DirectOfflineGridLayer(options);
    layer.on('tileunload', event => {
        const tile = event?.tile;
        try { tile?.__npfDispose?.(); } catch (_) {}
    });
    return layer;
}

function setupBaseTileLayer() {
    if (!map) return;
    /* v17.15 — une reconstruction de source/base invalide tout snapshot visuel. */
    clearNpfBaseTileZoomVisualSnapshot('base-layer-rebuild');
    /*
     * v16.47 — une reconstruction visuelle de GridLayer n'est pas un changement
     * de source. Ne pas invalider ici les lectures IndexedDB déjà engagées :
     * la nouvelle couche peut réutiliser les mêmes promesses inflight/cache.
     * Les vrais changements de carte et récupérations appellent explicitement
     * resetPendingDirectOfflineNpfReads() avant d'arriver ici.
     */
    if (baseTileLayer) {
        map.removeLayer(baseTileLayer);
    }

    /*
     * Mode offline ultra stable :
     * - pas de zoom fractionnaire ;
     * - un seul sur-zoom entier autorisé pour OACI (z10 natif -> z11 affiché) ;
     * - pas de fallback parent hors mécanisme natif de sur-zoom Leaflet ;
     * - plafond natif strict pour éviter les lectures de tuiles inexistantes ;
     * - animations désactivées pour éviter le flash blanc pendant le rafraîchissement.
     */
    const activeOfflineMaxZoomLimit = getOfflinePackMaxNativeZoomLimitForPacks(activeOfflinePacks);
    const offlineNativeMaxZoom = Math.max(
        GLOBAL_MIN_ZOOM,
        Math.min(
            GLOBAL_MAX_ZOOM,
            activeOfflineMaxZoomLimit,
            Number.isFinite(baseTileMaxNativeZoom) ? baseTileMaxNativeZoom : activeOfflineMaxZoomLimit
        )
    );

    const effectiveMinZoom = offlineTilesMode
        ? Math.max(GLOBAL_MIN_ZOOM, Math.min(baseTileMinNativeZoom, offlineNativeMaxZoom))
        : GLOBAL_MIN_ZOOM;

    const offlineDisplayMaxZoom = offlineTilesMode
        ? getOfflinePackMaxDisplayZoomForPacks(
            activeOfflinePacks,
            offlineNativeMaxZoom
        )
        : offlineNativeMaxZoom;

    const effectiveMaxZoom = offlineTilesMode
        ? offlineDisplayMaxZoom
        : Math.min(GLOBAL_MAX_ZOOM, baseTileMaxNativeZoom + 2);

    map.options.minZoom = effectiveMinZoom;
    map.options.maxZoom = effectiveMaxZoom;
    map.setMinZoom(effectiveMinZoom);
    map.setMaxZoom(effectiveMaxZoom);

    if (map.getZoom() > effectiveMaxZoom) {
        map.setView(map.getCenter(), effectiveMaxZoom, { animate: false });
    } else if (offlineTilesMode && map.getZoom() < effectiveMinZoom) {
        map.setView(map.getCenter(), effectiveMinZoom, { animate: false });
    }

    const activeTilePackName = Array.isArray(activeOfflinePacks) && activeOfflinePacks.length ? activeOfflinePacks[0] : '';
    const tileHostPrefix = offlineTilesMode ? normalizeOfflineTileHostPrefix(activeTilePackName) : 'a';
    const tileLayerUrl = `https://${tileHostPrefix}.tile.openstreetmap.org/{z}/{x}/{y}.png`;

    const isNpfDirectOfflineLayer =
        offlineTilesMode
        && isNpfOfflinePackSelection();

    const tileLayerOptions = {
        minNativeZoom: effectiveMinZoom,
        maxNativeZoom: offlineTilesMode ? offlineNativeMaxZoom : effectiveMaxZoom,
        minZoom: effectiveMinZoom,
        maxZoom: effectiveMaxZoom,
        attribution: '© OpenStreetMap',
        keepBuffer: isNpfDirectOfflineLayer ? NPF_OFFLINE_TILE_KEEP_BUFFER : OFFLINE_TILE_KEEP_BUFFER,
        updateWhenZooming: false,

        /*
         * v15.37 — NPF uniquement : commencer à charger les nouvelles tuiles
         * pendant le déplacement, au lieu d'attendre obligatoirement moveend.
         * Les autres packs conservent le comportement précédent.
         */
        /*
         * v16.72 — restauration du comportement v16.50 pour la carte NPF :
         * les tuiles utiles sont demandées pendant le déplacement au lieu
         * d'attendre systématiquement la fin du geste.
         *
         * Le scheduling v16.71 reste en place :
         * - 5 lectures IndexedDB fixes ;
         * - priorité immédiate au viewport courant ;
         * - purge ciblée à zoomend/moveend.
         */
        updateWhenIdle: !isNpfDirectOfflineLayer,
        updateInterval: isNpfDirectOfflineLayer
            ? 60
            : OFFLINE_TILE_UPDATE_INTERVAL_MS,
        noWrap: true,
        errorTileUrl: OFFLINE_TILE_PLACEHOLDER_DATA_URL
    };

    baseTileLayer = offlineTilesMode
        ? buildDirectOfflineLeafletLayer(tileLayerOptions)
        : L.tileLayer(tileLayerUrl, tileLayerOptions);

    if (isNpfDirectOfflineLayer) {
        baseTileLayer.on('load', () => {
            try { rememberCurrentNpfZoomLevelForFastReturn('grid-load'); } catch (_) {}
        });
    }

    if (!npfStartupDiagHasMark('first_tile')) {
        try {
            baseTileLayer.once('tileload', () => {
                npfStartupDiagMark('first_tile', 'Première tuile affichée');
                try { window.dispatchEvent(new CustomEvent('npf-startup-first-tile')); } catch (_) {}
                try { window.markNpfAppReady?.(); } catch (_) {}
            });
            baseTileLayer.once('load', () => {
                npfStartupDiagMark('base_tiles_loaded', 'Fond de carte visible chargé');
            });
        } catch (_) {}
    }
    baseTileLayer.addTo(map);
    npfStartupDiagMark(
        'base_layer_added',
        'Fond de carte ajouté',
        offlineTilesMode ? 'OFFLINE' : 'ONLINE'
    );

    enforceOfflineZoomLimit();


    applyMapNoBackgroundStyle();
    scheduleOfflineTileWake('setupBaseTileLayer');
}

function clearCurrentSelection(options = {}) {
    const preserveMapView = !!options.preserveMapView;
    resetNpfFirePelicAutoCycle();
    selectedAirportDestination = null;
    selectedPelicanOACI = null;
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search');
    searchInput.value = '';
    document.getElementById('results-list').style.display = 'none';
    clearSearchBtn.style.display = 'none';
    routesLayer.clearLayers();
    if (waterPointsLayer) drawWaterPointMarkersForCommune(null);
    userToTargetLayer.clearLayers();
    lftwRouteLayer.clearLayers();
    drawPermanentAirportMarkers();
    currentCommune = null;
    drawFireHistoryMarkers();
    localStorage.removeItem('currentCommune');
    updateBaseLabels();
    updateCalculatorData();
    masterRecalculate();
    updateCommuneDisplay(null);
    document.getElementById('bingo-map-display').style.display = 'none';
    if (!preserveMapView) {
        centerMapOnGpsOverviewAfterClear();
    }
}


let searchInputClearRefocusTimer = null;

function keepKeyboardAfterSearchClear() {
    /*
     * v11.99 — iPad : lorsque l'utilisateur efface la commune saisie
     * avec le X de la barre de recherche, Safari peut retirer le focus.
     * On réapplique le focus tant que la recherche est ouverte.
     */
    const searchInput = document.getElementById('search-input');
    const searchContainer = document.getElementById('search-container');
    if (!searchInput) return;
    if (searchInput.value !== '') return;
    if (searchContainer && searchContainer.style.display === 'none') return;

    clearTimeout(searchInputClearRefocusTimer);
    searchInputClearRefocusTimer = setTimeout(() => {
        try {
            searchInput.focus({ preventScroll: true });
            searchInput.setSelectionRange(0, 0);
        } catch (_) {
            searchInput.focus();
        }
    }, 80);
}

/*
 * v15.80 — moteur communes partagé entre la recherche principale et GAAR.
 * Une seule implémentation conserve le scoring, les alias et le filtre département.
 */
function searchCommunesWithSharedEngine(rawSearch, limit = 10) {
    const {
        departmentFilter,
        searchTerm
    } = parseSearchDepartmentFilter(rawSearch);
    const simplifiedSearch = simplifyString(searchTerm);
    if (simplifiedSearch.length < 2) {
        return {
            departmentFilter,
            searchTerm,
            simplifiedSearch,
            searchWords: [],
            results: []
        };
    }

    const searchWords = simplifiedSearch.split(' ').filter(Boolean);
    const searchCompact = searchWords.join('');
    const communesToSearch = departmentFilter
        ? allCommunes.filter(c => c.dep_code === departmentFilter)
        : allCommunes;

    const scoredResults = communesToSearch
        .filter(c => shouldSearchCandidate(c, searchWords, searchCompact, departmentFilter))
        .map(c => ({ ...c, score: scoreCommuneSearchCandidate(c, searchWords, departmentFilter) }))
        .filter(c => c.score < 999);

    const aliasResults = searchAliasCommunes(searchWords, departmentFilter);
    /*
     * v16.56 — les équivalences connues (dont Lapradelle) font partie du
     * moteur principal et sont donc visibles immédiatement, avant l'ouverture
     * asynchrone de l'archive nationale des localités.
     */
    const knownLocalityResults = searchNpfKnownLocalityEquivalents(searchTerm, departmentFilter);
    knownLocalityResults.forEach(candidate => scoredResults.push(candidate));

    const seenResultKeys = new Set(
        scoredResults.map(c => `${c.locality_match ? 'locality' : 'commune'}:${c.code_insee}:${simplifyString(c.nom_standard)}`)
    );

    aliasResults.forEach((alias) => {
        const key = `alias:${alias.alias_target_code_insee}:${simplifyString(alias.nom_standard)}`;
        const sameVisibleNameAlreadyPresent = seenResultKeys.has(
            `commune:${alias.code_insee}:${simplifyString(alias.nom_standard)}`
        );
        if (!seenResultKeys.has(key) && !sameVisibleNameAlreadyPresent) {
            seenResultKeys.add(key);
            scoredResults.push(alias);
        }
    });

    scoredResults.sort((a, b) =>
        Number(Boolean(b.search_exact_locality))
            - Number(Boolean(a.search_exact_locality))
        || a.score - b.score
        || a.nom_standard.length - b.nom_standard.length
    );

    const immediateResults = scoredResults.slice(
        0,
        Math.max(1, Number(limit) || 10)
    );

    recordNpfLocalitySearchDiagnostic(
        'immédiat',
        `requête="${simplifiedSearch}" · dept=${departmentFilter || '—'} · communes+alias=${immediateResults.length} · équivalences=${knownLocalityResults.length}`,
        {
            query: simplifiedSearch,
            department: departmentFilter || '',
            immediate: immediateResults.length,
            known: knownLocalityResults.length,
            top: formatNpfSearchResultNames(immediateResults)
        }
    );

    return {
        departmentFilter,
        searchTerm,
        simplifiedSearch,
        searchWords,
        results: immediateResults
    };
}

