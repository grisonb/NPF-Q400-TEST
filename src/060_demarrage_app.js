// =========================================================================
// LOGIQUE PRINCIPALE DE L'APPLICATION
// =========================================================================

/*
 * v17.20 — porte de priorité du fond de carte au démarrage.
 * Objectif : laisser Safari/IndexedDB produire d'abord une carte utile avant
 * le parsing des communes et avant les enrichissements non indispensables.
 * Aucun paramètre du moteur de tuiles (concurrence, file, keepBuffer, timeout)
 * n'est modifié ici.
 */
let npfStartupMapPriorityPromise = null;

function getNpfStartupTilePriorityState() {
    let total = 0;
    let loaded = 0;
    let visible = 0;
    try {
        const coverage = getNpfCurrentZoomVisibleTileCoverage();
        total = Math.max(0, Number(coverage?.total) || 0);
        loaded = Math.max(0, Number(coverage?.loaded) || 0);
    } catch (_) {}
    try { visible = Math.max(0, Number(countVisibleLoadedBaseTiles()) || 0); } catch (_) {}

    return {
        total,
        loaded,
        visible,
        active: Math.max(0, Number(directOfflineNpfActiveReads) || 0),
        queued: Math.max(0, Number(directOfflineNpfReadQueue?.length) || 0)
    };
}

function waitForNpfStartupFirstTile(timeoutMs = 4500) {
    try {
        if (npfStartupDiagHasMark('first_tile') || countVisibleLoadedBaseTiles() > 0) {
            return Promise.resolve(true);
        }
    } catch (_) {}

    return new Promise(resolve => {
        let settled = false;
        let pollTimer = null;
        let safetyTimer = null;
        const finish = value => {
            if (settled) return;
            settled = true;
            if (pollTimer) clearTimeout(pollTimer);
            if (safetyTimer) clearTimeout(safetyTimer);
            try { window.removeEventListener('npf-startup-first-tile', onFirstTile); } catch (_) {}
            resolve(value);
        };
        const onFirstTile = () => finish(true);
        const poll = () => {
            if (settled) return;
            try {
                if (npfStartupDiagHasMark('first_tile') || countVisibleLoadedBaseTiles() > 0) {
                    finish(true);
                    return;
                }
            } catch (_) {}
            pollTimer = setTimeout(poll, 100);
        };
        try { window.addEventListener('npf-startup-first-tile', onFirstTile, { once: true }); } catch (_) {}
        safetyTimer = setTimeout(() => finish(false), Math.max(500, Number(timeoutMs) || 4500));
        pollTimer = setTimeout(poll, 100);
    });
}

function waitForNpfStartupMapPriorityRelease({ timeoutMs = 8000, minCoverageRatio = 0.80 } = {}) {
    if (npfStartupMapPriorityPromise) return npfStartupMapPriorityPromise;

    npfStartupMapPriorityPromise = new Promise(resolve => {
        const startedAt = Date.now();
        let pollTimer = null;
        let settled = false;
        const finish = (reason, state) => {
            if (settled) return;
            settled = true;
            if (pollTimer) clearTimeout(pollTimer);
            npfStartupDiagMark(
                'startup_map_priority_release',
                'Priorité fond de carte libérée',
                `${reason} · ${state.loaded}/${state.total} couverture · ${state.visible} visibles · file ${state.active}/${state.queued}`
            );
            resolve({ reason, ...state });
        };
        const check = () => {
            if (settled) return;
            const state = getNpfStartupTilePriorityState();
            const coverageRatio = state.total > 0 ? state.loaded / state.total : 0;
            const schedulerIdle = state.visible > 0 && state.active === 0 && state.queued === 0;
            const coverageReady = state.total > 0 && coverageRatio >= minCoverageRatio;
            if (schedulerIdle || coverageReady) {
                finish(schedulerIdle ? 'scheduler-idle' : 'coverage-80%', state);
                return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
                finish('timeout', state);
                return;
            }
            pollTimer = setTimeout(check, 140);
        };
        check();
    });

    return npfStartupMapPriorityPromise;
}

function runNpfStartupMeasuredSync(key, label, callback) {
    const startedAt = typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    npfStartupDiagMark(`${key}_start`, `${label} — début`);
    try {
        return callback();
    } finally {
        const endedAt = typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        npfStartupDiagMark(
            `${key}_ready`,
            `${label} — terminé`,
            `${Math.max(0, Math.round(endedAt - startedAt))} ms`
        );
    }
}

async function initializeApp() {
    npfStartupDiagMark('init_start', 'Initialisation NPF');
    const statusMessage = document.getElementById('status-message');
    const searchSection = document.getElementById('search-section');

    try {
        loadState();
        npfStartupDiagMark('state_loaded', 'État local chargé');
    } catch (stateError) {
        console.error('État local invalide, réinitialisation.', stateError);
        localStorage.removeItem('disabled_airports');
        localStorage.removeItem('water_airports');
        localStorage.removeItem('selected_base_oaci');
    }

    /*
     * v17.19 — préparer le contexte feu AVANT la création de Leaflet.
     * Si un feu était sélectionné à la fermeture précédente, initMap() peut ainsi
     * calculer directement le cadrage final avant d'ajouter la couche de tuiles,
     * au lieu de charger d'abord une vue provisoire puis de la jeter.
     */
    let savedCommuneJSON = null;
    let startupSavedCommuneRestoredBeforeMap = false;
    try {
        savedCommuneJSON = localStorage.getItem('currentCommune');
        if (savedCommuneJSON) {
            const parsedSavedCommune = JSON.parse(savedCommuneJSON);
            const savedFireLat = Number(parsedSavedCommune?.latitude_mairie);
            const savedFireLon = Number(parsedSavedCommune?.longitude_mairie);
            if (Number.isFinite(savedFireLat) && Number.isFinite(savedFireLon)) {
                currentCommune = parsedSavedCommune;
                startupSavedCommuneRestoredBeforeMap = true;
            }
        }
    } catch (_) {
        savedCommuneJSON = null;
        startupSavedCommuneRestoredBeforeMap = false;
    }

    // v12.67 — le bouton Route BASE a été retiré de l'interface, mais la route base reste active.
    showLftwRoute = true;
    localStorage.setItem('showLftwRoute', 'true');

    // v15.98 — restaurer les choix cartographiques au lieu de forcer Départements à OFF.
    try {
        areDepartmentsVisible = localStorage.getItem(SHOW_DEPARTMENTS_LAYER_KEY) === 'true';
        areCommunesVisible = localStorage.getItem(SHOW_COMMUNES_LAYER_KEY) === 'true';

        // GAAR : une ancienne installation sans préférence conserve son comportement historique.
        const storedGaarVisibility = localStorage.getItem(GAAR_LAYER_VISIBLE_KEY);
        if (storedGaarVisibility === 'true' || storedGaarVisibility === 'false') {
            isGaarMode = storedGaarVisibility === 'true';
        }
    } catch (_) {}

    const savedGaarJSON = localStorage.getItem('gaarCircuits');
    if (savedGaarJSON) {
        try {
            const parsedGaar = JSON.parse(savedGaarJSON);
            gaarCircuits = Array.isArray(parsedGaar) ? parsedGaar : [];
        } catch (gaarError) {
            console.error('Données GAAR invalides, réinitialisation.', gaarError);
            gaarCircuits = [];
            localStorage.removeItem('gaarCircuits');
        }
    }

    /*
     * v15.96 — PRIORITÉ 1 : déterminer uniquement la source de fond depuis
     * localStorage, puis créer Leaflet immédiatement. Aucune ouverture IndexedDB,
     * base communes, alias, SIA ou trafic ne peut précéder les premières tuiles.
     */
    if (!FORCE_DISPLAY_MODE) {
        activeOfflinePacks = JSON.parse(localStorage.getItem(OFFLINE_ACTIVE_PACKS_KEY) || '[]');
        if (!Array.isArray(activeOfflinePacks)) activeOfflinePacks = [];

        activeOfflinePackDatabases = JSON.parse(
            localStorage.getItem(OFFLINE_ACTIVE_PACK_DATABASES_KEY) || '[]'
        );
        if (!Array.isArray(activeOfflinePackDatabases) || !activeOfflinePackDatabases.length) {
            activeOfflinePackDatabases = getOfflineActivePackDatabasesForPacks(activeOfflinePacks);
        }

        activeOfflinePackAliases = JSON.parse(
            localStorage.getItem(OFFLINE_ACTIVE_PACK_ALIASES_KEY) || '[]'
        );
        if (!Array.isArray(activeOfflinePackAliases) || !activeOfflinePackAliases.length) {
            activeOfflinePackAliases = getOfflineActivePackAliasesForPacks(activeOfflinePacks);
        }

        const savedMapSourceMode = localStorage.getItem(MAP_SOURCE_MODE_KEY);
        mapSourceMode = savedMapSourceMode === 'offline'
            ? 'offline'
            : DEFAULT_MAP_SOURCE_MODE;

        /*
         * Valeur immédiate nécessaire à setupBaseTileLayer().
         * initializeOfflineTilePreference() viendra ensuite consolider l'état
         * sans bloquer le premier rendu.
         */
        offlineTilesMode = mapSourceMode === 'offline';

        offlineOnlineFallbackMode = localStorage.getItem(OFFLINE_ONLINE_FALLBACK_KEY) === null
            ? DEFAULT_OFFLINE_ONLINE_FALLBACK
            : localStorage.getItem(OFFLINE_ONLINE_FALLBACK_KEY) === 'true';
    } else {
        mapSourceMode = DEFAULT_MAP_SOURCE_MODE;
        offlineTilesMode = DEFAULT_OFFLINE_TILES_ENABLED;
        offlineOnlineFallbackMode = DEFAULT_OFFLINE_ONLINE_FALLBACK;
        activeOfflinePacks = [];
        activeOfflinePackDatabases = [];
        activeOfflinePackAliases = [];

        try {
            const cleanedUrl = new URL(window.location.href);
            cleanedUrl.searchParams.delete('force_display');
            cleanedUrl.searchParams.delete('ts');
            window.history.replaceState({}, '', cleanedUrl.toString());
        } catch (_) {}
    }

    if (statusMessage) statusMessage.style.display = 'none';
    if (searchSection) searchSection.style.display = 'none';

    npfStartupDiagMark('map_init_start', 'Création carte — début');
    initMap();
    npfStartupDiagMark('map_init_ready', 'Carte Leaflet créée');
    scheduleRememberedOfflineMapStartupRecovery(
        'initializeApp-v15.96-map-first'
    );

    /*
     * Laisser WebKit peindre Leaflet et lancer les requêtes de tuiles avant
     * tout parsing/indexage de la base communes.
     */
    await new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });

    /*
     * IndexedDB reste utile au mode offline, mais son ouverture est désormais
     * non bloquante pour la carte et pour la recherche communes/alias.
     */
    npfStartupDiagMark('idb_start', 'IndexedDB — ouverture');
    const startupDbPromise = initDB()
        .then((result) => {
            npfStartupDiagMark('idb_ready', 'IndexedDB prête');
            return result;
        })
        .catch((startupError) => {
            npfStartupDiagMark('idb_error', 'IndexedDB en erreur', startupError?.message || startupError);
            console.warn('Initialisation IndexedDB différée indisponible:', startupError);
            return null;
        });

    startupDbPromise.then(() => {
        if (!FORCE_DISPLAY_MODE) {
            initializeOfflineTilePreference().catch(error => {
                console.warn('[Offline] Initialisation différée:', error);
            });

            withTimeout(
                updateBaseTileNativeZoomFromAvailability({
                    forceScan: false,
                    rebuildLayer: false
                }),
                2200,
                'Timeout analyse initiale des cartes offline'
            ).then((zoomRangeChanged) => {
                /*
                 * v17.19 — ne pas reconstruire le GridLayer si la plage native
                 * réellement utilisée n'a pas changé. La v17.18 pouvait refaire
                 * deux fois la même couche et abandonner des tuiles déjà demandées.
                 */
                if (map && zoomRangeChanged) {
                    rebuildBaseTileLayerAfterOfflineSwitch('startup-zoom-ready-v17.19');
                }
            }).catch(error => {
                console.warn('[Offline] Plage de zoom initiale conservée:', error);
            });
        }

        try { displayInstalledMaps(); } catch (_) {}
    });

    /*
     * v17.20 — PRIORITÉ 2 : la base communes ne concurrence plus la toute
     * première tuile. La recherche devient disponible juste après le premier
     * rendu cartographique, avec un timeout de secours si aucune tuile n'existe.
     */
    npfStartupDiagMark('communes_wait_first_tile', 'Communes — attente première tuile');
    const startupFirstTileReady = await waitForNpfStartupFirstTile(4500);
    npfStartupDiagMark(
        'communes_first_tile_gate',
        'Communes — priorité carte libérée',
        startupFirstTileReady ? 'première tuile affichée' : 'timeout sécurité'
    );

    let communesLoadError = null;
    npfStartupDiagMark('communes_start', 'Communes — chargement');
    try {
        let data = null;

        if (FORCE_DISPLAY_MODE) {
            const cachedData = localStorage.getItem(COMMUNES_CACHE_KEY);
            if (cachedData) {
                try {
                    const parsed = JSON.parse(cachedData);
                    if (parsed && Array.isArray(parsed.data)) data = parsed;
                } catch (_) {}
            }
        }

        if (!data) data = await loadCommunesData();
        npfStartupDiagMark('communes_data_ready', 'Communes — données prêtes', `${Array.isArray(data?.data) ? data.data.length : 0} communes`);

        allCommunes = data.data.map(c => {
            const normalizedName = simplifyString(c.nom_standard);
            const searchParts = normalizedName.split(' ').filter(Boolean);
            return {
                ...c,
                normalized_name: normalizedName,
                search_parts: searchParts,
                search_compact: searchParts.join(''),
                soundex_parts: searchParts.map(part => soundex(part))
            };
        });

        npfStartupDiagMark('communes_index_ready', 'Communes — index recherche prêt', `${allCommunes.length} entrées`);

        communesByCodeInsee = new Map(
            allCommunes
                .map(commune => [
                    String(commune.code_insee || '').trim(),
                    commune
                ])
                .filter(([code]) => code)
        );

        /* v16.66 — les alias ne bloquent plus le démarrage principal.
         * Le DIAG v16.65 a montré un blocage JavaScript d'environ 2,7 s au
         * moment de leur chargement/normalisation. La recherche des 34 935
         * communes reste disponible immédiatement ; les alias sont chargés
         * après l'affichage PÉLIC, au repos. */
        communeAliases = [];
        communeAliasesLoadSource = 'differe-apres-demarrage';
        npfStartupDiagMark('communes_aliases_deferred', 'Alias communes — chargement différé', 'après démarrage principal');
    } catch (error) {
        communesLoadError = error;
        allCommunes = [];
        communeAliases = [];
        npfStartupDiagMark('communes_error', 'Communes / alias en erreur', error?.message || error);
        console.error('Chargement communes/alias indisponible:', error);
    }

    if (searchSection) searchSection.style.display = 'block';

    try {
        setupEventListeners();
    } catch (uiError) {
        console.error('Erreur setupEventListeners:', uiError);
    }

    try {
        map?.invalidateSize?.({ animate: false, pan: false });
    } catch (_) {}

    /*
     * v15.96 — PRIORITÉ 3 : PÉLIC / aérodromes permanents.
     * Aucun dessin de cette couche n'est lancé par initMap() pendant la phase
     * prioritaire ; il est effectué ici seulement après communes + alias.
     */
    npfStartupDiagMark('pelic_start', 'PÉLIC — affichage');
    try {
        drawPermanentAirportMarkers();
        applyPelicanVisualScale();
        npfStartupDiagMark('pelic_ready', 'PÉLIC affichés', `${permanentAirportLayer?.getLayers?.().length || 0} calques`);
    } catch (pelicError) {
        npfStartupDiagMark('pelic_error', 'PÉLIC en erreur', pelicError?.message || pelicError);
        console.error('Affichage PÉLIC au démarrage impossible:', pelicError);
    }

    npfStartupDiagMark('core_ready', 'Démarrage principal prêt');
    npfStartupCorePriorityActive = false;
    window.__npfStartupCoreReady = true;
    try {
        window.dispatchEvent(new CustomEvent('npf-startup-core-ready'));
    } catch (_) {}

    /*
     * v17.19 — les alias ne concurrencent plus le remplissage du viewport.
     * Le DIAG v17.18 montre ~2,2 s de travail alias pendant que les tuiles
     * visibles sont encore incomplètes. On attend donc le viewport courant
     * entièrement chargé ; un secours à 12 s évite tout blocage permanent.
     */
    let communeAliasesStartupLoadStarted = false;
    const startDeferredCommuneAliasesLoad = async () => {
        if (communeAliasesStartupLoadStarted) return;
        communeAliasesStartupLoadStarted = true;
        try {
            communeAliases = await loadCommunesAliases();
            npfStartupDiagMark(
                'communes_aliases_ready',
                'Alias communes prêts',
                `${communeAliases.length} alias`
            );
        } catch (error) {
            communeAliases = [];
            communeAliasesLoadSource = 'indisponible';
            npfStartupDiagMark('communes_aliases_error', 'Alias communes en erreur', error?.message || error);
        }
    };

    const aliasViewportWaitStartedAt = Date.now();
    const scheduleAliasesWhenViewportReady = () => {
        if (communeAliasesStartupLoadStarted) return;

        let viewportReady = false;
        try {
            const coverage = getNpfCurrentZoomVisibleTileCoverage();
            viewportReady = !!(
                coverage
                && Number(coverage.total) > 0
                && Number(coverage.loaded) >= Number(coverage.total)
            );
        } catch (_) {}

        const safetyExpired = Date.now() - aliasViewportWaitStartedAt >= 12000;
        if (!viewportReady && !safetyExpired) {
            setTimeout(scheduleAliasesWhenViewportReady, 350);
            return;
        }

        const launch = () => { startDeferredCommuneAliasesLoad(); };
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(launch, { timeout: 2500 });
        } else {
            setTimeout(launch, 350);
        }
    };
    npfStartupDiagMark(
        'communes_aliases_wait_tiles',
        'Alias communes — attente fond de carte'
    );
    setTimeout(scheduleAliasesWhenViewportReady, 350);

    /*
     * v17.20 — le fond de carte conserve la priorité CPU/IndexedDB après
     * core_ready. Les tâches réellement coûteuses attendent 80 % du viewport,
     * un scheduler tuiles au repos, ou 8 s au maximum. Les calques HT/Routes
     * gardent leur temporisation historique interne et ne sont pas avancés.
     */
    const startupMapPriorityGate = waitForNpfStartupMapPriorityRelease({
        timeoutMs: 8000,
        minCoverageRatio: 0.80
    });

    startupMapPriorityGate.then(() => {
        setTimeout(() => {
            try {
                runNpfStartupMeasuredSync('startup_runways', 'Pistes carte', () => drawNpfRunwayMapLayer());
                runNpfStartupMeasuredSync('startup_fire_history', 'Historique feux', () => drawFireHistoryMarkers());
                runNpfStartupMeasuredSync('startup_gaar', 'Circuits GAAR', () => redrawGaarCircuits());
            } catch (_) {}
        }, 120);

        setTimeout(() => {
            try {
                runNpfStartupMeasuredSync('startup_chat', 'Chat équipe', () => initializeTeamChat());
            } catch (chatInitError) {
                console.warn('Initialisation chat différée:', chatInitError);
            }
        }, 420);

        setTimeout(() => {
            npfStartupDiagMark('sia_init_start', 'SIA — initialisation');
            try {
                initializeSiaSystem();
                npfStartupDiagMark('sia_init_ready', 'SIA — initialisation prête');
            } catch (siaInitError) {
                npfStartupDiagMark('sia_init_error', 'SIA — initialisation en erreur', siaInitError?.message || siaInitError);
                console.error('[SIA] Erreur initialisation système:', siaInitError);
            }
        }, 650);

        setTimeout(showPostUpdateRestartNoticeIfNeeded, 650);
    });

    /* Les calques annexes ont déjà un délai offline de 6,5 s : conserver ce
     * séquenceur sans ajouter un second délai complet. */
    setTimeout(() => {
        npfStartupDiagMark('aux_schedule', 'Couches annexes programmées');
        try { scheduleStartupAuxiliaryLayers(); } catch (_) {}
    }, 420);

    /*
     * v15.99 — autorisation BFG -> NPF silencieuse et non bloquante.
     * Elle reste postérieure à carte -> recherche/alias -> PÉLIC.
     */
    startupMapPriorityGate.then(() => {
        setTimeout(() => {
            // v17.29 — couverture NOTAM de la copie locale, y compris hors ligne.
            reconcileNpfNotamsCoverageFromLocalRecord();
            tryAuthorizeBriefingDocsFromBfgBridge({ silent: true })
                .then(async () => {
                    await refreshBriefingDocMapButtons().catch(() => {});
                    await syncNpfBfgNotamsFromNas({ silent: true }).catch(() => false);
                })
                .catch(() => {});
        }, 1600);
    });

    // v16.06 — si BFG a été utilisé pendant que NPF était en arrière-plan,
    // le retour au premier plan récupère automatiquement le snapshot NAS.
    window.addEventListener('online', () => scheduleNpfBfgNotamsBackgroundSync(350));
    window.addEventListener('pageshow', () => scheduleNpfBfgNotamsBackgroundSync(700));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') scheduleNpfBfgNotamsBackgroundSync(500);
    });

    /*
     * v16.48 — VAC : synchronisation entièrement automatique et non bloquante.
     * Le contrôle est lancé après le cœur de démarrage, puis attend lui-même
     * que les tuiles NPF visibles soient au repos avant tout téléchargement.
     */
    startupMapPriorityGate.then(() => {
        setTimeout(() => {
            reconcileVacInstalledIndexFromDb()
                .then(() => {
                    refreshUI();
                    return checkVacUpdatesAtStartup({ source: 'startup' });
                })
                .catch(error => {
                    console.warn('[VAC] Initialisation automatique différée indisponible:', error);
                });
        }, 2200);
    });

    window.addEventListener('online', () => {
        scheduleAutomaticVacSync(VAC_AUTO_SYNC_ONLINE_DELAY_MS, 'online');
    });

    /*
     * FdS / GAAR : lecture locale différée, aucun contrôle réseau au démarrage.
     */
    startupMapPriorityGate.then(() => {
        setTimeout(() => {
            refreshBriefingDocMapButtons().catch(error => {
                console.info(
                    '[FDS/GAAR] Lecture locale de démarrage ignorée:',
                    error?.message || error
                );
            });
        }, 900);
    });

    setTimeout(() => {
        scheduleOfflineTileWake('startup-post-core-v15.96');
    }, 250);

    setupGpsResumeHandlers();

    /*
     * Les polygones communes 500 m sont volontairement postérieurs à
     * carte -> recherche/alias -> PÉLIC. Ils servent ensuite à la commune
     * survolée et au positionnement précis des feux manuels.
     */
    startupMapPriorityGate.then(() => {
        setTimeout(() => {
            npfStartupDiagMark('commune_polygons_start', 'Polygones communes — chargement');
            ensureCommunesLayerDataLoaded()
                .then(() => {
                    npfStartupDiagMark('commune_polygons_ready', 'Polygones communes prêts');
                    repairManualFireCommuneLabelsFromPolygons();
                    if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') {
                        refreshNearestCommuneDisplayFromKnownGps();
                    }
                })
                .catch((error) => {
                    npfStartupDiagMark('commune_polygons_error', 'Polygones communes en erreur', error?.message || error);
                    console.warn('Préchargement polygones communes impossible:', error);
                    if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') {
                        refreshNearestCommuneDisplayFromKnownGps();
                    }
                });
        }, 500);
    });

    /*
     * v16.32 — la base nationale de localités n'est plus préparée au démarrage.
     * Elle est déjà intégralement disponible hors ligne et searchNamedPlacesOffline()
     * appelle loadNamedPlacesOfflineDatabase() au premier besoin. Éviter ici la
     * lecture du ZIP + JSZip + index supprime une grosse tâche concurrente du SIA
     * et de la carte lors des ouvertures lentes sur iPad.
     */
    npfStartupDiagMark(
        'localities_deferred',
        'Localités hors ligne — chargement à la demande'
    );

    /*
     * v16.75 — les départements ne sont plus préchargés lorsque leur calque est
     * masqué. La base communes fournit déjà le code département nécessaire au
     * bandeau "Commune survolée".
     *
     * Si le calque était mémorisé ON, scheduleStartupAuxiliaryLayers() appellera
     * toggleDepartmentsLayer(true), qui déclenchera alors le chargement réel.
     */
    if (!areDepartmentsVisible) {
        npfStartupDiagMark(
            'departments_data_deferred',
            'Départements — chargement à la demande'
        );
    }

    runNpfStartupMeasuredSync(
        'startup_prime_gps',
        'Position GPS mémorisée',
        () => primeGpsFromStoredPosition()
    );

    startupMapPriorityGate.then(() => {
        setTimeout(() => {
            if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') {
                refreshNearestCommuneDisplayFromKnownGps();
            }
        }, 700);

        setTimeout(() => {
            if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') {
                refreshNearestCommuneDisplayFromKnownGps();
            }
        }, 2200);
    });

    if (localStorage.getItem('liveGpsActive') === 'true') {
        restartLiveGpsWatch({ silent: true });
    } else {
        requestOneShotGps({
            silent: true,
            highAccuracy: true,
            timeout: 30000,
            maximumAge: 600000
        });
    }

    if (savedCommuneJSON) {
        try {
            if (!currentCommune) currentCommune = JSON.parse(savedCommuneJSON);

            if (startupSavedCommuneRestoredBeforeMap) {
                /*
                 * v17.19 — le cadrage feu/GPS/PÉLIC a déjà été appliqué avant
                 * l'ajout des tuiles : restaurer seulement les dessins et calculs.
                 */
                runNpfStartupMeasuredSync(
                    'startup_saved_fire',
                    'Restauration feu mémorisé',
                    () => displayCommuneDetails(currentCommune, false)
                );
            } else {
                displayCommuneDetails(currentCommune, true);
                setTimeout(
                    () => fitMapToStartupFireContext({ reason: 'saved-fire-after-display' }),
                    350
                );
                setTimeout(
                    () => fitMapToStartupFireContext({ reason: 'saved-fire-after-gps' }),
                    1400
                );
            }
            armNpfFirePelicAutoCycle('fire');
        } catch (_) {}
    }

    setTimeout(() => {
        if (!startupGpsAutoCenteredWithRealPosition && !startupGpsStoredCenterAppliedAt) {
            applyStoredGpsStartupCenter({ force: false });
        }
    }, 750);

    /*
     * v17.21 — le rendu de tous les plans d'eau est non essentiel au premier
     * viewport. L'état du bouton est restauré immédiatement mais le dessin
     * Leaflet attend la libération de la priorité carte et est chronométré.
     */
    try { refreshWaterPointsButtonState(); } catch (_) {}
    startupMapPriorityGate.then(() => {
        setTimeout(() => {
            try {
                runNpfStartupMeasuredSync(
                    'startup_water_points',
                    'Plans d’eau',
                    () => drawWaterPointMarkersForCommune(currentCommune)
                );
            } catch (_) {}
        }, 1200);
    });

    if (communesLoadError) {
        setTimeout(() => {
            alert(
                "Mode dégradé: base communes/alias indisponible. La carte reste utilisable ; réessayez avec réseau pour la recherche commune."
            );
        }, 400);
    }
}

