// =========================================================================
// GESTION DES CARTES HORS-LIGNE
// =========================================================================
function isOfflineDatabaseClosingError(error) {
    const name = String(error?.name || '').toLowerCase();
    const message = String(
        error?.message || error || ''
    ).toLowerCase();

    return (
        name === 'invalidstateerror'
        || name === 'transactioninactiveerror'
        || message.includes('connection is closing')
        || message.includes('database connection is closing')
        || message.includes('connection is closed')
        || message.includes('database connection is closed')
        || message.includes('not allowed to create a transaction')
    );
}

function isMainOfflineDatabaseUsable(candidate = db) {
    if (!candidate) return false;
    try {
        candidate.transaction('settings', 'readonly');
        return true;
    } catch (_) {
        return false;
    }
}

function invalidateMainOfflineDatabase(candidate = db) {
    const connection = candidate || db;
    try {
        connection?.close?.();
    } catch (_) {}
    if (!candidate || db === candidate) {
        db = null;
    }
}

function initDB({ force = false } = {}) {
    /*
     * v14.37 — correction ciblée :
     * - ne jamais réutiliser une connexion fermée ;
     * - ne jamais ouvrir deux fois la base en parallèle ;
     * - ne pas modifier la logique de stockage des tuiles.
     */
    if (!force && isMainOfflineDatabaseUsable(db)) {
        return Promise.resolve(db);
    }

    if (force || db) {
        invalidateMainOfflineDatabase(db);
    }

    if (offlineDbOpenPromise) {
        return offlineDbOpenPromise;
    }

    offlineDbOpenPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }

        const request = indexedDB.open(
            OFFLINE_DB_NAME,
            3
        );

        request.onupgradeneeded = event => {
            const dbInstance = event.target.result;

            if (!dbInstance.objectStoreNames.contains('tiles')) {
                const store = dbInstance.createObjectStore(
                    'tiles',
                    { keyPath: 'url' }
                );
                store.createIndex(
                    'packName',
                    'packName',
                    { unique: false }
                );
                store.createIndex(
                    'tileUrl',
                    'tileUrl',
                    { unique: false }
                );
            } else {
                const store = event.target.transaction
                    .objectStore('tiles');

                if (!store.indexNames.contains('packName')) {
                    store.createIndex(
                        'packName',
                        'packName',
                        { unique: false }
                    );
                }
                if (!store.indexNames.contains('tileUrl')) {
                    store.createIndex(
                        'tileUrl',
                        'tileUrl',
                        { unique: false }
                    );
                }
            }

            if (
                !dbInstance.objectStoreNames
                    .contains('settings')
            ) {
                dbInstance.createObjectStore(
                    'settings',
                    { keyPath: 'key' }
                );
            }
        };

        request.onsuccess = event => {
            const openedDb = event.target.result;
            db = openedDb;

            const clearReference = () => {
                if (db === openedDb) db = null;
            };

            try {
                openedDb.onversionchange = () => {
                    try {
                        openedDb.close();
                    } catch (_) {}
                    clearReference();
                };
            } catch (_) {}

            try {
                openedDb.addEventListener(
                    'close',
                    clearReference,
                    { once: true }
                );
            } catch (_) {}

            console.log('[DB] Connexion réussie.');
            resolve(openedDb);
        };

        request.onerror = event => {
            reject(
                event.target.error
                || new Error(
                    'Ouverture IndexedDB impossible'
                )
            );
        };

        request.onblocked = () => {
            reject(
                new Error(
                    'Base IndexedDB bloquée. Fermez les autres onglets de l’application puis réessayez.'
                )
            );
        };
    }).finally(() => {
        offlineDbOpenPromise = null;
    });

    return offlineDbOpenPromise;
}

async function runOfflineSettingsTransaction(
    mode,
    operation
) {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const connection = await initDB({
            force: attempt > 0
        });

        try {
            return await new Promise(
                (resolve, reject) => {
                    let transaction;

                    try {
                        transaction =
                            connection.transaction(
                                'settings',
                                mode
                            );
                        operation(
                            transaction.objectStore(
                                'settings'
                            ),
                            transaction
                        );
                    } catch (error) {
                        reject(error);
                        return;
                    }

                    transaction.oncomplete = resolve;
                    transaction.onerror = () => reject(
                        transaction.error
                        || new Error(
                            'Transaction settings échouée'
                        )
                    );
                    transaction.onabort = () => reject(
                        transaction.error
                        || new Error(
                            'Transaction settings annulée'
                        )
                    );
                }
            );
        } catch (error) {
            lastError = error;

            if (
                attempt >= 1
                || !isOfflineDatabaseClosingError(error)
            ) {
                throw error;
            }

            invalidateMainOfflineDatabase(connection);
        }
    }

    throw lastError;
}



function sanitizeOfflineDatabaseToken(value) {
    const base = String(value || 'Carte')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 72);
    return base || 'Carte';
}

function getOfflineMapDatabaseNameForGroup(groupName) {
    return `${OFFLINE_MAP_DATABASE_PREFIX}${sanitizeOfflineDatabaseToken(groupName)}`;
}

function getInstalledMapPacksSafe() {
    try {
        const packs = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
        return Array.isArray(packs) ? packs : [];
    } catch (_) {
        return [];
    }
}


function getOfflineActivePackAliasesForPacks(
    packs = activeOfflinePacks
) {
    const installed = getInstalledMapPacksSafe();
    const aliases = [];
    const addAlias = value => {
        const clean = String(value || '')
            .replace(/\.zip$/i, '')
            .trim();
        if (clean && !aliases.includes(clean)) {
            aliases.push(clean);
        }
    };

    (Array.isArray(packs) ? packs : []).forEach(packName => {
        addAlias(packName);
        addAlias(normalizeOfflinePackName(packName));

        const canonicalName =
            normalizeOfflinePackName(packName);
        const groupName =
            getOfflinePackGroupName(packName);

        installed.forEach(pack => {
            if (!pack) return;

            const packCanonical =
                normalizeOfflinePackName(pack.name);
            const packGroup =
                getOfflinePackGroupName(pack.name);

            if (
                pack.name === packName
                || packCanonical === canonicalName
                || packGroup === groupName
            ) {
                addAlias(pack.name);
                addAlias(pack.sourceName);
                addAlias(
                    normalizeOfflinePackName(
                        pack.sourceName || ''
                    )
                );
            }
        });
    });

    return aliases;
}

function getOfflineDatabaseCandidatesForPack(
    packName,
    installed = getInstalledMapPacksSafe()
) {
    const names = [];
    const addName = value => {
        const clean = String(value || '').trim();
        if (clean && !names.includes(clean)) {
            names.push(clean);
        }
    };

    const canonicalName =
        normalizeOfflinePackName(packName);
    const canonicalGroup =
        getOfflinePackGroupName(canonicalName);

    installed.forEach(pack => {
        if (!pack) return;

        const samePack = (
            pack.name === packName
            || normalizeOfflinePackName(pack.name)
                === canonicalName
            || getOfflinePackGroupName(pack.name)
                === canonicalGroup
        );

        if (!samePack) return;

        addName(pack.dbName);

        const sourceGroup =
            getOfflinePackGroupName(
                pack.sourceName || pack.name
            );
        addName(
            getOfflineMapDatabaseNameForGroup(
                sourceGroup
            )
        );
    });

    /*
     * Base déterministe utilisée par les imports isolés v13.73+.
     * Elle est ajoutée même si l'ancien enregistrement local a perdu dbName.
     */
    addName(
        getOfflineMapDatabaseNameForGroup(
            canonicalGroup
        )
    );

    /*
     * Base commune historique, nécessaire pour les cartes importées avant
     * l'isolation par groupe.
     */
    addName(OFFLINE_DB_NAME);

    return names;
}

function getOfflinePackDatabaseName(packName) {
    const installed = getInstalledMapPacksSafe();
    const found = installed.find(pack => pack && pack.name === packName);
    if (found && found.dbName) return found.dbName;

    const groupName = typeof getOfflinePackGroupName === 'function'
        ? getOfflinePackGroupName(packName)
        : String(packName || '').trim();
    const sameGroupWithDb = installed.find(pack => pack && pack.dbName && typeof getOfflinePackGroupName === 'function' && getOfflinePackGroupName(pack.name) === groupName);
    if (sameGroupWithDb && sameGroupWithDb.dbName) return sameGroupWithDb.dbName;

 // Compatibilité cartes déjà installées avant v13.73 : ancienne base commune.
    return OFFLINE_DB_NAME;
}

function getOfflineActivePackDatabasesForPacks(
    packs = activeOfflinePacks
) {
    const names = [];
    const installed = getInstalledMapPacksSafe();

    (Array.isArray(packs) ? packs : [])
        .forEach(packName => {
            getOfflineDatabaseCandidatesForPack(
                packName,
                installed
            ).forEach(dbName => {
                if (
                    dbName
                    && !names.includes(dbName)
                ) {
                    names.push(dbName);
                }
            });
        });

    if (!names.includes(OFFLINE_DB_NAME)) {
        names.push(OFFLINE_DB_NAME);
    }

    return names;
}

function openOfflineTileDatabaseByName(dbName = OFFLINE_DB_NAME, version = 3) {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }
        const safeName = String(dbName || OFFLINE_DB_NAME);
        const request = indexedDB.open(safeName, version);
        request.onupgradeneeded = event => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains('tiles')) {
                const store = dbInstance.createObjectStore('tiles', { keyPath: 'url' });
                store.createIndex('packName', 'packName', { unique: false });
                store.createIndex('tileUrl', 'tileUrl', { unique: false });
            } else {
                const store = event.target.transaction.objectStore('tiles');
                if (!store.indexNames.contains('packName')) store.createIndex('packName', 'packName', { unique: false });
                if (!store.indexNames.contains('tileUrl')) store.createIndex('tileUrl', 'tileUrl', { unique: false });
            }
            if (!dbInstance.objectStoreNames.contains('settings')) {
                dbInstance.createObjectStore('settings', { keyPath: 'key' });
            }
        };
        request.onsuccess = event => {
            const openedDb = event.target.result;
            try { openedDb.onversionchange = () => { try { openedDb.close(); } catch (_) {} }; } catch (_) {}
            resolve(openedDb);
        };
        request.onerror = event => reject(event.target.error || new Error(`Erreur ouverture ${safeName}`));
        request.onblocked = () => reject(new Error(`Base IndexedDB bloquée : ${safeName}`));
    });
}

function getOfflineTilesEnabled() {
    return new Promise((resolve) => {
        if (!db) {
            resolve(DEFAULT_OFFLINE_TILES_ENABLED);
            return;
        }

        const transaction = db.transaction('settings', 'readonly');
        const store = transaction.objectStore('settings');
        const request = store.get(OFFLINE_TILES_ENABLED_KEY);

        request.onsuccess = () => {
            if (!request.result || typeof request.result.value !== 'boolean') {
                resolve(DEFAULT_OFFLINE_TILES_ENABLED);
                return;
            }
            resolve(request.result.value);
        };
        request.onerror = () => resolve(DEFAULT_OFFLINE_TILES_ENABLED);
    });
}

async function setOfflineTilesEnabled(enabled) {
    offlineTilesMode = !!enabled;

    localStorage.setItem(
        OFFLINE_TILES_ENABLED_KEY,
        String(offlineTilesMode)
    );
    notifyServiceWorkerOfflineTilesPreference(offlineTilesMode);

    /*
     * v14.63 — persistance IndexedDB strictement en arrière-plan.
     * Safari peut conserver une transaction ouverte sans déclencher oncomplete ;
     * cela ne doit plus bloquer le bouton ni la création de la couche Leaflet.
     */
    const valueToPersist = offlineTilesMode;
    setTimeout(() => {
        withTimeout(
            runOfflineSettingsTransaction(
                'readwrite',
                store => {
                    store.put({
                        key: OFFLINE_TILES_ENABLED_KEY,
                        value: valueToPersist
                    });
                }
            ),
            1800,
            'Timeout persistance du mode Offline'
        ).catch(error => {
            console.warn(
                '[Offline] Mode conservé en localStorage uniquement:',
                error
            );
        });
    }, 0);

    return offlineTilesMode;
}


function notifyServiceWorkerOfflineTilesPreference(enabled) {
    if (!('serviceWorker' in navigator)) return;
    if (!navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({
        type: 'OFFLINE_TILES_ENABLED_CHANGED',
        value: !!enabled
    });
}

function notifyServiceWorkerOfflineOnlineFallback(enabled) {
    if (!('serviceWorker' in navigator)) return;
    if (!navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({
        type: 'OFFLINE_ONLINE_FALLBACK_CHANGED',
        value: !!enabled
    });
}

function notifyServiceWorkerActivePacks(
    packs,
    { waitForAck = false } = {}
) {
    const safePacks = Array.isArray(packs)
        ? packs.filter(Boolean)
        : [];
    const dbNames =
        getOfflineActivePackDatabasesForPacks(
            safePacks
        );
    const aliases =
        getOfflineActivePackAliasesForPacks(
            safePacks
        );

    activeOfflinePackDatabases = dbNames;
    activeOfflinePackAliases = aliases;

    try {
        localStorage.setItem(
            OFFLINE_ACTIVE_PACK_DATABASES_KEY,
            JSON.stringify(dbNames)
        );
        localStorage.setItem(
            OFFLINE_ACTIVE_PACK_ALIASES_KEY,
            JSON.stringify(aliases)
        );
    } catch (_) {}

    if (
        !('serviceWorker' in navigator)
        || !navigator.serviceWorker.controller
    ) {
        return Promise.resolve(false);
    }

    const message = {
        type: 'OFFLINE_ACTIVE_PACKS_CHANGED',
        value: safePacks,
        dbNames,
        aliases
    };

    if (!waitForAck) {
        navigator.serviceWorker.controller
            .postMessage(message);
        return Promise.resolve(true);
    }

    return new Promise(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(
            () => resolve(false),
            2500
        );

        channel.port1.onmessage = event => {
            if (
                event.data?.type
                !== 'OFFLINE_ACTIVE_PACKS_READY'
            ) {
                return;
            }
            clearTimeout(timer);
            resolve(true);
        };

        navigator.serviceWorker.controller.postMessage(
            message,
            [channel.port2]
        );
    });
}

async function setOfflineActivePacks(packs) {
    activeOfflinePacks = Array.isArray(packs) ? packs.filter(Boolean) : [];
    activeOfflinePackDatabases = getOfflineActivePackDatabasesForPacks(activeOfflinePacks);
    localStorage.setItem(OFFLINE_ACTIVE_PACKS_KEY, JSON.stringify(activeOfflinePacks));
    localStorage.setItem(OFFLINE_ACTIVE_PACK_DATABASES_KEY, JSON.stringify(activeOfflinePackDatabases));
    if (db) {
        try {
            const tx = db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            store.put({ key: OFFLINE_ACTIVE_PACKS_KEY, value: activeOfflinePacks });
            store.put({ key: OFFLINE_ACTIVE_PACK_DATABASES_KEY, value: activeOfflinePackDatabases });
        } catch (_) {}
    }
    notifyServiceWorkerActivePacks(activeOfflinePacks);
    await refreshOfflineTilesRendering();
}

function setOfflineOnlineFallbackMode(enabled) {
    offlineOnlineFallbackMode = !!enabled;
    localStorage.setItem(OFFLINE_ONLINE_FALLBACK_KEY, String(offlineOnlineFallbackMode));
    if (db) {
        try {
            const tx = db.transaction('settings', 'readwrite');
            tx.objectStore('settings').put({ key: OFFLINE_ONLINE_FALLBACK_KEY, value: offlineOnlineFallbackMode });
        } catch (_) {}
    }
    notifyServiceWorkerOfflineOnlineFallback(offlineOnlineFallbackMode);
}

function updateMapSourceButtons() {
    const onlineBtn = document.getElementById('map-source-online-btn');
    const offlineBtn = document.getElementById('map-source-offline-btn');
    if (!onlineBtn || !offlineBtn) return;
    onlineBtn.classList.toggle('active', mapSourceMode !== 'offline');
    offlineBtn.classList.toggle('active', mapSourceMode === 'offline');
    onlineBtn.disabled = isMapSourceSwitching;
    offlineBtn.disabled = isMapSourceSwitching;
    onlineBtn.setAttribute('aria-pressed', String(mapSourceMode !== 'offline'));
    offlineBtn.setAttribute('aria-pressed', String(mapSourceMode === 'offline'));
}


async function synchronizeOfflineConfigurationWithServiceWorker({
    scheduleReload = false,
    timeoutMs = 2200
} = {}) {
    if (!('serviceWorker' in navigator)) return false;

    const postConfiguration = worker => {
        if (!worker || typeof worker.postMessage !== 'function') return false;
        try {
            worker.postMessage({
                type: 'OFFLINE_TILES_ENABLED_CHANGED',
                value: mapSourceMode === 'offline'
            });
            worker.postMessage({
                type: 'OFFLINE_ONLINE_FALLBACK_CHANGED',
                value: false
            });
            worker.postMessage({
                type: 'OFFLINE_ACTIVE_PACKS_CHANGED',
                value: Array.isArray(activeOfflinePacks)
                    ? activeOfflinePacks.filter(Boolean)
                    : [],
                dbNames: getOfflineActivePackDatabasesForPacks(activeOfflinePacks),
                aliases: getOfflineActivePackAliasesForPacks(activeOfflinePacks)
            });
            return true;
        } catch (_) {
            return false;
        }
    };

    if (navigator.serviceWorker.controller) {
        postConfiguration(navigator.serviceWorker.controller);
        return true;
    }

    let registration = null;
    try {
        registration = await withTimeout(
            /*
             * v17.37 — même URL que index.html (avec appv). Une URL différente
             * relançait l'installation de la même version du service worker.
             */
            navigator.serviceWorker.register(
                `./sw.js?appv=${encodeURIComponent(window.APP_VERSION || '')}`,
                { updateViaCache: 'none' }
            ),
            timeoutMs,
            'Timeout enregistrement service worker'
        );
    } catch (error) {
        console.warn('[Offline] Enregistrement SW différé:', error);
    }

    if (!registration) {
        try {
            registration = await withTimeout(
                navigator.serviceWorker.ready,
                timeoutMs,
                'Timeout attente service worker'
            );
        } catch (_) {}
    }

    postConfiguration(
        navigator.serviceWorker.controller
        || registration?.active
        || registration?.waiting
        || registration?.installing
    );

    if (navigator.serviceWorker.controller) return true;

    if (scheduleReload && mapSourceMode === 'offline') {
        try {
            const guardKey = `npfOfflineSwControlReload:${window.APP_VERSION || 'unknown'}`;
            if (sessionStorage.getItem(guardKey) !== '1') {
                sessionStorage.setItem(guardKey, '1');
                setTimeout(() => {
                    const refreshUrl = new URL(window.location.href);
                    refreshUrl.searchParams.set(
                        'appv',
                        window.APP_VERSION || 'v14.75'
                    );
                    refreshUrl.searchParams.set(
                        'swctl',
                        Date.now().toString()
                    );
                    window.location.replace(refreshUrl.toString());
                }, 120);
            }
        } catch (_) {}
    }

    return false;
}

async function ensureServiceWorkerControlsPageForOffline(options = {}) {
    return synchronizeOfflineConfigurationWithServiceWorker({
        scheduleReload: options.scheduleReload !== false,
        timeoutMs: Number(options.timeoutMs) || 2200
    });
}

function applyImmediateBaseTileZoomForMapSource(mode) {
    if (mode !== 'offline') {
        baseTileMinNativeZoom = GLOBAL_MIN_ZOOM;
        baseTileMaxNativeZoom = ONLINE_MAX_NATIVE_ZOOM;
        return;
    }

    const activeOfflineMaxZoomLimit =
        getOfflinePackMaxNativeZoomLimitForPacks(activeOfflinePacks);
    const storedMin = Number.parseInt(
        localStorage.getItem(OFFLINE_TILES_MIN_ZOOM_KEY) || '',
        10
    );
    const storedMax = Number.parseInt(
        localStorage.getItem(OFFLINE_TILES_MAX_ZOOM_KEY) || '',
        10
    );

    baseTileMinNativeZoom = Number.isFinite(storedMin)
        ? Math.max(
            GLOBAL_MIN_ZOOM,
            Math.min(storedMin, activeOfflineMaxZoomLimit)
        )
        : GLOBAL_MIN_ZOOM;
    baseTileMaxNativeZoom = Number.isFinite(storedMax)
        ? Math.max(
            baseTileMinNativeZoom,
            Math.min(storedMax, activeOfflineMaxZoomLimit)
        )
        : activeOfflineMaxZoomLimit;
}

async function setMapSourceMode(mode) {
    if (isMapSourceSwitching) return false;

    const nextMode = mode === 'offline' ? 'offline' : 'online';
    if (
        nextMode === 'offline'
        && (!Array.isArray(activeOfflinePacks) || !activeOfflinePacks.length)
    ) {
        throw new Error('Aucun pack de cartes actif');
    }

    isMapSourceSwitching = true;
    mapSourceMode = nextMode;
    offlineTilesMode = nextMode === 'offline';
    if (offlineTilesMode) {
        directOfflineTileHitCount = 0;
        directOfflineTileMissCount = 0;
        directOfflineNpfMainRamHitCount = 0;
        directOfflineNpfZoomReturnCacheHitCount = 0;
        directOfflineNpfIndexedDbLookupCount = 0;
    }

    localStorage.setItem(MAP_SOURCE_MODE_KEY, mapSourceMode);
    localStorage.setItem(
        OFFLINE_TILES_ENABLED_KEY,
        String(offlineTilesMode)
    );

    updateMapSourceButtons();
    updateOfflineStatus();
    setOfflineMapSwitchBusy(
        offlineTilesMode
            ? 'Mode OFFLINE sélectionné — chargement des tuiles…'
            : 'Mode ONLINE actif.'
    );

    try {
        /*
         * v14.63 — le changement visible et la couche sont appliqués
         * synchroniquement, avant tout accès IndexedDB ou attente du SW.
         */
        setOfflineTilesEnabled(offlineTilesMode);
        setOfflineOnlineFallbackMode(false);
        notifyServiceWorkerActivePacks(activeOfflinePacks);
        applyImmediateBaseTileZoomForMapSource(nextMode);
        rebuildBaseTileLayerAfterOfflineSwitch('setMapSourceMode-immediate-v14.69');
    } finally {
        isMapSourceSwitching = false;
        updateMapSourceButtons();
        updateOfflineStatus();
    }

    if (offlineTilesMode) {
        synchronizeOfflineConfigurationWithServiceWorker({
            scheduleReload: true,
            timeoutMs: 2200
        }).then(controlled => {
            if (!controlled || mapSourceMode !== 'offline') return;
            notifyServiceWorkerOfflineTilesPreference(true);
            notifyServiceWorkerActivePacks(activeOfflinePacks);
            rebuildBaseTileLayerAfterOfflineSwitch('sw-synchronized-v14.69');
        }).catch(error => {
            console.warn('[Offline] Synchronisation SW différée:', error);
        });
    }

    withTimeout(
        updateBaseTileNativeZoomFromAvailability({ forceScan: false, rebuildLayer: false }),
        2400,
        'Timeout analyse des niveaux de zoom'
    ).then(() => {
        if (mapSourceMode === nextMode) {
            rebuildBaseTileLayerAfterOfflineSwitch('zoom-ready-v14.69');
        }
    }).catch(error => {
        console.warn('[Offline] Niveaux de zoom par défaut conservés:', error);
    });

    return true;
}

function updateOfflineStatus() {
    const status = document.getElementById('offline-status');
    if (!status) return;
    status.textContent = mapSourceMode === 'offline' ? 'Mode OFFLINE' : 'Mode ONLINE';
}

async function initializeOfflineTilePreference() {
    const enabled = mapSourceMode === 'offline';
    offlineTilesMode = enabled;

    localStorage.setItem(
        OFFLINE_TILES_ENABLED_KEY,
        String(enabled)
    );
    applyImmediateBaseTileZoomForMapSource(mapSourceMode);
    setOfflineTilesEnabled(enabled);
    setOfflineOnlineFallbackMode(false);

    if (Array.isArray(activeOfflinePacks) && activeOfflinePacks.length) {
        persistSimpleActiveOfflinePacks(activeOfflinePacks).catch(error => {
            console.warn('[Offline] Persistance des packs différée:', error);
        });
    }

    notifyServiceWorkerOfflineTilesPreference(enabled);
    notifyServiceWorkerOfflineOnlineFallback(false);
    notifyServiceWorkerActivePacks(activeOfflinePacks);
    updateMapSourceButtons();
    updateOfflineStatus();

    /* Plusieurs envois courts couvrent le changement de contrôleur Safari. */
    [0, 500, 1600].forEach((delay, index) => {
        setTimeout(() => {
            synchronizeOfflineConfigurationWithServiceWorker({
                scheduleReload: enabled && index === 2,
                timeoutMs: 1800
            }).catch(() => {});
        }, delay);
    });

    return enabled;
}

async function purgeInactivePacksCache() {
    if (!db) {
        try {
            await initDB();
        } catch (_) {
            alert('Base offline indisponible.');
            return;
        }
    }
    const installedPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
    const inactiveNames = installedPacks.map((p) => p.name).filter((name) => !activeOfflinePacks.includes(name));
    if (!inactiveNames.length) {
        alert('Aucun pack désélectionné à purger.');
        return;
    }
    if (!confirm(`Supprimer définitivement le cache de ${inactiveNames.length} pack(s) désélectionné(s) ?`)) {
        return;
    }

    const inactiveSet = new Set(inactiveNames);
    let deletedCount = 0;
    await new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readwrite');
        const store = tx.objectStore('tiles');
        const request = store.openCursor();
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            if (inactiveSet.has(cursor.value?.packName || '')) {
                cursor.delete();
                deletedCount += 1;
            }
            cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('Erreur purge cache offline'));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Erreur transaction purge offline'));
    });

    const updatedInstalled = installedPacks.filter((pack) => !inactiveSet.has(pack.name));
    localStorage.setItem('installedMapPacks', JSON.stringify(updatedInstalled));
    await updateBaseTileNativeZoomFromAvailability({ forceScan: false });
    displayInstalledMaps();
    alert(`Purge terminée: ${deletedCount} tuiles supprimées (${inactiveNames.length} pack(s)).`);
}



async function persistOfflineImportPauseSettings() {
    /*
     * v13.70 — import ZIP stable iPad.
     * On écrit réellement dans IndexedDB/settings que les tuiles offline sont suspendues
     * et qu'aucun pack n'est actif. Le service worker relit périodiquement ces settings :
     * si on ne les met pas à jour, il peut reprendre la lecture de l'ancien pack pendant
     * que l'import écrit le nouveau ZIP, ce qui bloque Safari/iPadOS dès le premier lot.
     */
    try { localStorage.setItem(OFFLINE_TILES_ENABLED_KEY, 'false'); } catch (_) {}
    try { localStorage.setItem(OFFLINE_ACTIVE_PACKS_KEY, JSON.stringify([])); } catch (_) {}
    try { localStorage.setItem(OFFLINE_ACTIVE_PACK_DATABASES_KEY, JSON.stringify([])); } catch (_) {}

    if (!db) {
        try { await initDB(); } catch (_) {}
    }

    if (!db) return;

    await new Promise((resolve, reject) => {
        try {
            const tx = db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            store.put({ key: OFFLINE_TILES_ENABLED_KEY, value: false });
            store.put({ key: OFFLINE_ACTIVE_PACKS_KEY, value: [] });
            store.put({ key: OFFLINE_ACTIVE_PACK_DATABASES_KEY, value: [] });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error('Erreur suspension settings offline'));
            tx.onabort = () => reject(tx.error || new Error('Transaction suspension settings annulée'));
        } catch (error) {
            reject(error);
        }
    }).catch((error) => {
        console.warn('[Offline] Suspension settings import incomplète:', error);
    });
}

function postServiceWorkerMessageWithAck(message, expectedType = 'OFFLINE_IMPORT_READY', timeoutMs = 2500) {
    return new Promise((resolve) => {
        try {
            if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller || typeof MessageChannel === 'undefined') {
                resolve(false);
                return;
            }

            const channel = new MessageChannel();
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                try { channel.port1.close(); } catch (_) {}
                resolve(value);
            };

            const timer = setTimeout(() => finish(false), timeoutMs);
            channel.port1.onmessage = (event) => {
                const data = event.data || {};
                if (data.type === expectedType) {
                    clearTimeout(timer);
                    finish(true);
                }
            };

            navigator.serviceWorker.controller.postMessage(message, [channel.port2]);
        } catch (error) {
            console.warn('[Offline] ACK service worker impossible:', error);
            resolve(false);
        }
    });
}


async function suspendOfflineMapRenderingDuringImport(reason = 'Import offline en cours') {
    /*
     * v13.70 — suspension renforcée.
     * La suspension n'est plus seulement en mémoire/localStorage : elle est aussi
     * écrite dans IndexedDB/settings pour empêcher le service worker de reprendre
     * l'ancien pack en plein import.
     */

    await persistOfflineImportPauseSettings();
    offlineTilesMode = false;

    /*
     * v12.16 — accélération du deuxième gros import.
     *
     * Symptôme confirmé :
     * - première carte importée : rapide ;
     * - deuxième carte importée : très lente ou bloquée.
     *
     * Cause probable :
     * pendant le deuxième import, Leaflet + le service worker continuent à lire
     * les tuiles de la carte active dans la même IndexedDB pendant que l'import
     * écrit massivement. Sur Safari/iPadOS, lecture + écriture simultanées sur une
     * grosse IndexedDB ralentissent très fortement les transactions.
     *
     * Correction :
     * - désactiver temporairement la carte offline active ;
     * - retirer la couche tuiles de Leaflet ;
     * - informer le service worker qu'il ne doit plus chercher de pack actif ;
     * - laisser l'import écrire seul dans IndexedDB.
     *
     * À la fin de l'import, le nouveau groupe importé est réactivé par le code existant.
     */
    try {
        activeOfflinePacks = [];
        activeOfflinePackDatabases = [];
        localStorage.setItem(OFFLINE_ACTIVE_PACKS_KEY, JSON.stringify([]));
        localStorage.setItem(OFFLINE_ACTIVE_PACK_DATABASES_KEY, JSON.stringify([]));
    } catch (_) {}

    try {
        notifyServiceWorkerOfflineTilesPreference(false);
        notifyServiceWorkerActivePacks([]);
    } catch (_) {}

    try {
        if (map && baseTileLayer) {
            map.removeLayer(baseTileLayer);
            baseTileLayer = null;
        }
    } catch (_) {}

    try {
        const statusEl = document.getElementById('offline-status');
        if (statusEl) {
            statusEl.textContent = `${reason} — carte suspendue pour accélérer l'écriture.`;
        }
    } catch (_) {}

    await new Promise(resolve => setTimeout(resolve, 250));
}


async function releaseOfflineDatabaseForHeavyOperation(reason = 'Opération offline lourde') {
    /*
     * v12.18 — libération réelle IndexedDB avant import/suppression.
     *
     * v12.17 envoyait un message au service worker, mais postMessage n'est pas
     * awaitable : l'import/suppression pouvait démarrer avant que le SW ait fermé
     * sa connexion IndexedDB.
     *
     * Ici on :
     * - suspend la carte ;
     * - demande au SW de fermer sa connexion ;
     * - ferme aussi la connexion IndexedDB de la page ;
     * - attend brièvement ;
     * - rouvre une connexion propre côté page.
     */
    await suspendOfflineMapRenderingDuringImport(reason);

    try {
        await postServiceWorkerMessageWithAck({ type: 'OFFLINE_IMPORT_START' }, 'OFFLINE_IMPORT_READY', 3000);
    } catch (_) {}

    try {
        if (db) db.close();
    } catch (_) {}
    db = null;

    await new Promise(resolve => setTimeout(resolve, 1200));
    await initDB();
}

/*
 * v17.46 — cartes hors ligne en données brutes (ArrayBuffer).
 * v17.43 avait ajouté un import d'essai « NPF_France_B » en données brutes : il
 * a été mesuré nettement plus fluide sur iPad. Toutes les cartes importées par
 * le bouton normal sont désormais enregistrées ainsi, sous leur nom normal. La
 * lecture accepte toujours les deux formes (src/100). Une base qui contient
 * encore des images en Blob n'est jamais complétée en données brutes : on
 * propose d'abord de la supprimer en entier.
 */
const NPF_OFFLINE_TILE_FORMAT_RAW = 'arraybuffer';
const NPF_OFFLINE_IMPORT_PROGRESS_KEY = 'npfOfflineImportProgressV1';
const NPF_OFFLINE_IMPORT_LOG_KEY = 'npfOfflineImportLogV1';
const NPF_OFFLINE_PENDING_DB_DELETIONS_KEY = 'npfOfflinePendingDbDeletionsV1';
const NPF_OFFLINE_RAW_IMPORT_MAX_BATCH = 40;

function readNpfJsonStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : fallback;
        return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (_) {
        return fallback;
    }
}

function writeNpfJsonStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (_) {
        return false;
    }
}

/* Forme des images d'un groupe installé : 'arraybuffer' si tous ses fichiers
 * ont été importés en données brutes, sinon 'ancienne'. */
function getOfflineGroupTileFormat(groupName) {
    const name = String(groupName || '');
    const packs = getInstalledMapPacksSafe().filter(pack => pack && getOfflinePackGroupName(pack.name) === name);
    if (!packs.length) return 'inconnue';
    return packs.every(pack => pack.tileFormat === NPF_OFFLINE_TILE_FORMAT_RAW)
        ? NPF_OFFLINE_TILE_FORMAT_RAW
        : 'ancienne';
}

/* Nom affiché à l'utilisateur ; le nom réel du groupe (et de sa base) ne change pas. */
function getOfflineMapGroupDisplayName(groupName) {
    const name = String(groupName || '');
    /* v17.66 — noms validés par Bastien : « Carte OACI 1/500 000 » et « Carte OACI ». */
    if (name && isOaci500000GroupName(name)) return 'Carte OACI 1/500 000';
    if (/^(carte[\s_-]*)?oaci$/i.test(name.trim())) {
        /* Ancienne « Carte OACI » gardée (contrôle du contenu) à côté de la nouvelle « OACI ». */
        const nouvelleInstallee = name.trim().toUpperCase() !== 'OACI'
            && getInstalledMapPacksSafe().some(pack => pack && String(getOfflinePackGroupName(pack.name)).trim().toUpperCase() === 'OACI');
        return nouvelleInstallee ? 'Carte OACI (ancienne)' : 'Carte OACI';
    }
    if (!name || !isNpfOfflinePackSelection([name])) return name;
    if (getOfflineGroupTileFormat(name) !== NPF_OFFLINE_TILE_FORMAT_RAW) {
        return 'Carte NPF-Q400 (ancienne, lente)';
    }
    const rawNpfGroups = groupInstalledMapPacks(getInstalledMapPacksSafe())
        .map(group => String(group.name))
        .filter(groupNameItem => isNpfOfflinePackSelection([groupNameItem])
            && getOfflineGroupTileFormat(groupNameItem) === NPF_OFFLINE_TILE_FORMAT_RAW);
    if (rawNpfGroups.length > 1 && /_B$/.test(name)) return 'Carte NPF-Q400 (B)';
    return 'Carte NPF-Q400';
}

function formatNpfStorageSizeForUser(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return 'inconnue';
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1).replace('.', ',')} Go`;
    return `${Math.max(1, Math.round(value / (1024 * 1024)))} Mo`;
}

async function doesNpfIndexedDatabaseExist(dbName) {
    try {
        if (typeof indexedDB.databases === 'function') {
            const list = await indexedDB.databases();
            return list.some(item => item && item.name === dbName);
        }
    } catch (_) {}
    return null;
}

/* Première image de la base : Blob ou données brutes. Ne crée jamais de base. */
async function detectOfflineDatabaseTileForm(dbName, timeoutMs = 6000) {
    const exists = await doesNpfIndexedDatabaseExist(dbName);
    if (exists === false) return { exists: false, form: null };
    return new Promise(resolve => {
        let done = false;
        let openedDb = null;
        const finish = value => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { if (openedDb) openedDb.close(); } catch (_) {}
            resolve(value);
        };
        const timer = setTimeout(() => finish({ exists: exists !== false, form: 'inconnue' }), timeoutMs);
        try {
            const request = indexedDB.open(dbName);
            request.onupgradeneeded = () => {
                /* La base n'existait pas (navigateur sans indexedDB.databases) : on annule. */
                try { request.transaction.abort(); } catch (_) {}
                finish({ exists: false, form: null });
            };
            request.onerror = () => finish({ exists: exists !== false, form: 'inconnue' });
            request.onsuccess = () => {
                openedDb = request.result;
                try {
                    if (!openedDb.objectStoreNames.contains('tiles')) {
                        finish({ exists: true, form: null });
                        return;
                    }
                    const cursorRequest = openedDb.transaction('tiles', 'readonly').objectStore('tiles').openCursor();
                    cursorRequest.onsuccess = () => {
                        const cursor = cursorRequest.result;
                        const tile = cursor ? cursor.value?.tile : null;
                        finish({ exists: true, form: !tile ? null : (tile instanceof Blob ? 'Blob' : 'brut') });
                    };
                    cursorRequest.onerror = () => finish({ exists: true, form: 'inconnue' });
                } catch (_) {
                    finish({ exists: true, form: 'inconnue' });
                }
            };
        } catch (_) {
            finish({ exists: exists !== false, form: 'inconnue' });
        }
    });
}

async function countTilesInOfflineDatabase(dbName, timeoutMs = 5000) {
    if (await doesNpfIndexedDatabaseExist(dbName) === false) return null;
    return new Promise(resolve => {
        let done = false;
        let openedDb = null;
        const finish = value => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { if (openedDb) openedDb.close(); } catch (_) {}
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        try {
            const request = indexedDB.open(dbName);
            request.onupgradeneeded = () => { try { request.transaction.abort(); } catch (_) {} finish(null); };
            request.onerror = () => finish(null);
            request.onsuccess = () => {
                openedDb = request.result;
                try {
                    const countRequest = openedDb.transaction('tiles', 'readonly').objectStore('tiles').count();
                    countRequest.onsuccess = () => finish(Number(countRequest.result) || 0);
                    countRequest.onerror = () => finish(null);
                } catch (_) {
                    finish(null);
                }
            };
        } catch (_) {
            finish(null);
        }
    });
}

/* Journal des imports (DIAG) : 12 derniers fichiers. */
function updateNpfOfflineImportLog(entry) {
    const log = readNpfJsonStorage(NPF_OFFLINE_IMPORT_LOG_KEY, []);
    const list = Array.isArray(log) ? log : [];
    const index = list.findIndex(item => item && item.id === entry.id);
    if (index >= 0) list[index] = { ...list[index], ...entry };
    else list.push(entry);
    while (list.length > 12) list.shift();
    writeNpfJsonStorage(NPF_OFFLINE_IMPORT_LOG_KEY, list);
}

/* Suppressions de base refusées par Safari (connexion encore ouverte) :
 * réessayées au lancement suivant, avant toute ouverture de carte. */
function addPendingOfflineDatabaseDeletion(dbName) {
    const list = readNpfJsonStorage(NPF_OFFLINE_PENDING_DB_DELETIONS_KEY, []);
    const next = Array.isArray(list) ? list : [];
    if (!next.includes(dbName)) next.push(dbName);
    writeNpfJsonStorage(NPF_OFFLINE_PENDING_DB_DELETIONS_KEY, next);
}

function processPendingOfflineDatabaseDeletions() {
    const list = readNpfJsonStorage(NPF_OFFLINE_PENDING_DB_DELETIONS_KEY, []);
    if (!Array.isArray(list) || !list.length) return;
    const activeDatabases = new Set(getOfflineActivePackDatabasesForPacks(activeOfflinePacks || []));
    list.forEach(dbName => {
        if (!dbName || activeDatabases.has(dbName)) return;
        deleteIndexedDatabaseWithTimeoutForNpf(dbName, 15000).then(result => {
            if (result && result.status === 'deleted') {
                const remaining = readNpfJsonStorage(NPF_OFFLINE_PENDING_DB_DELETIONS_KEY, []);
                writeNpfJsonStorage(
                    NPF_OFFLINE_PENDING_DB_DELETIONS_KEY,
                    (Array.isArray(remaining) ? remaining : []).filter(name => name !== dbName)
                );
            }
        }).catch(() => {});
    });
}

/* Carte de remplacement quand la carte affichée est supprimée : de préférence
 * une Carte NPF-Q400 en données brutes, sinon une autre carte hors ligne. */
function pickFallbackOfflineMapGroup(excludedGroupName) {
    const groups = groupInstalledMapPacks(getInstalledMapPacksSafe())
        .map(group => String(group.name))
        .filter(name => name && name !== excludedGroupName);
    const score = name => {
        const npf = isNpfOfflinePackSelection([name]);
        const raw = getOfflineGroupTileFormat(name) === NPF_OFFLINE_TILE_FORMAT_RAW;
        return (npf ? 2 : 0) + (raw ? 1 : 0);
    };
    groups.sort((a, b) => score(b) - score(a));
    return groups[0] || null;
}

/*
 * Suppression d'une carte à base séparée : la base entière en une seule
 * opération. Les connexions de la page et du service worker sont fermées
 * d'abord ; si Safari refuse quand même, la carte est retirée de la liste et
 * sa base est effacée au lancement suivant.
 */
async function deleteOfflineMapGroupDatabase(groupName, options = {}) {
    const packNames = getInstalledPackNamesForGroup(groupName);
    const dbName = getOfflineMapDatabaseNameForGroup(groupName);
    const wasActive = mapSourceMode === 'offline'
        && Array.isArray(activeOfflinePacks)
        && activeOfflinePacks.some(name => packNames.includes(name));

    if (wasActive) {
        const fallback = pickFallbackOfflineMapGroup(groupName);
        try {
            if (fallback) {
                /* v17.66 — téléchargement : la fenêtre Gestion des Cartes reste ouverte. */
                await selectQuickOfflineMapGroup(fallback, { keepModalOpen: !!options.keepModalOpen });
            } else {
                await setMapSourceMode('online');
            }
        } catch (error) {
            console.warn('[Offline] Bascule avant suppression impossible:', error);
        }
    }

    try {
        resetPendingDirectOfflineNpfReads();
        closeDirectOfflineDatabaseConnectionsForStartupRetry();
        directOfflineTileBlobCache.clear();
        clearDirectOfflineNpfZoomReturnCache();
        directOfflineTileMissCache.clear();
        directOfflineTileLookupHints.clear();
        directOfflineNpfLastSuccessfulLookup = null;
    } catch (_) {}
    try {
        await postServiceWorkerMessageWithAck({ type: 'OFFLINE_MASS_DELETE_START' }, 'OFFLINE_IMPORT_READY', 3000);
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 350));

    const result = await deleteIndexedDatabaseWithTimeoutForNpf(dbName, 10000);

    /* Le service worker a remis ses packs à zéro : on lui redonne l'état actuel. */
    try {
        notifyServiceWorkerActivePacks(activeOfflinePacks);
        notifyServiceWorkerOfflineTilesPreference(offlineTilesMode);
    } catch (_) {}

    removeInstalledOfflinePacksLogically(packNames);
    const progress = readNpfJsonStorage(NPF_OFFLINE_IMPORT_PROGRESS_KEY, null);
    if (progress && progress.dbName === dbName) {
        try { localStorage.removeItem(NPF_OFFLINE_IMPORT_PROGRESS_KEY); } catch (_) {}
    }
    if (!result || result.status !== 'deleted') addPendingOfflineDatabaseDeletion(dbName);

    try { displayInstalledMaps(); } catch (_) {}
    try { refreshQuickOfflineMapButtonState(); } catch (_) {}
    return { ...(result || {}), dbName, packNames, wasActive };
}

async function describeOfflineMapGroupSize(groupName) {
    const packs = getInstalledMapPacksSafe().filter(pack => pack && getOfflinePackGroupName(pack.name) === groupName);
    if (packs.length && packs.every(pack => Number.isFinite(Number(pack.sizeBytes)) && Number(pack.sizeBytes) > 0)) {
        const total = packs.reduce((sum, pack) => sum + Number(pack.sizeBytes), 0);
        return `taille estimée ${formatNpfStorageSizeForUser(total * 1.15)}`;
    }
    const count = await countTilesInOfflineDatabase(getOfflineMapDatabaseNameForGroup(groupName));
    return Number.isFinite(count) && count > 0
        ? `environ ${count.toLocaleString('fr-FR')} tuiles (taille exacte inconnue)`
        : 'taille inconnue';
}

async function handleZipImport(file, options = {}) {
    if (!file) return;
    if (isZipImportRunning) {
        alert("Un import est déjà en cours. Veuillez attendre la fin avant d'importer un autre ZIP.");
        return;
    }
    if (typeof JSZip === 'undefined') {
        alert("ERREUR : La librairie d'importation (JSZip) n'est pas chargée.");
        return;
    }

    const sourcePackName = file.name.replace(/\.zip$/i, '');
    const packName = normalizeOfflinePackName(sourcePackName);
    const packGroupNameForImport = getOfflinePackGroupName(packName);
    const isolatedImportDbName = getOfflineMapDatabaseNameForGroup(packGroupNameForImport);
    let importTileDb = null;

    /*
     * v17.46 — reprise : même fichier (nom et taille) et même carte qu'un import
     * interrompu -> on repart de la dernière tuile écrite.
     */
    const savedProgress = readNpfJsonStorage(NPF_OFFLINE_IMPORT_PROGRESS_KEY, null);
    const resumeFromTile = savedProgress
        && savedProgress.packName === packName
        && savedProgress.fileName === file.name
        && Number(savedProgress.fileSize) === Number(file.size)
        && savedProgress.dbName === isolatedImportDbName
        ? Math.max(0, Number(savedProgress.written) || 0)
        : 0;

    /*
     * v17.46 — ne jamais mélanger les deux formes dans une même base : si la
     * carte cible contient encore des images en Blob, on propose d'abord de la
     * supprimer en entier. Refus = aucun import, rien n'est touché.
     */
    if (!resumeFromTile) {
        const existingForm = await detectOfflineDatabaseTileForm(isolatedImportDbName);
        const legacyPacksInGroup = getInstalledMapPacksSafe()
            .some(pack => pack && getOfflinePackGroupName(pack.name) === packGroupNameForImport && pack.tileFormat !== NPF_OFFLINE_TILE_FORMAT_RAW);
        const mustReplaceLegacy = existingForm.exists && (
            existingForm.form === 'Blob'
            || (existingForm.form === 'inconnue' && legacyPacksInGroup)
        );
        if (mustReplaceLegacy) {
            const label = getOfflineMapGroupDisplayName(packGroupNameForImport) || packGroupNameForImport;
            const sizeText = await describeOfflineMapGroupSize(packGroupNameForImport);
            const confirmed = confirm([
                `La carte « ${label} » est enregistrée dans l'ancien format.`,
                `(${sizeText})`,
                '',
                `Pour importer « ${file.name} » dans le nouveau format, cette carte doit d'abord être supprimée en entier.`,
                '',
                'Supprimer maintenant l\'ancienne carte, puis importer ?',
                'Annuler : aucun import, la carte actuelle reste inchangée.'
            ].join('\n'));
            if (!confirmed) return;
            const deletion = await deleteOfflineMapGroupDatabase(packGroupNameForImport);
            if (!deletion || deletion.status !== 'deleted') {
                alert(`L'ancienne carte « ${label} » a été retirée de la liste, mais Safari n'a pas encore pu l'effacer.\nElle sera effacée au prochain lancement de NPF-Q400 ; relancez NPF-Q400 puis importez de nouveau « ${file.name} ».`);
                return;
            }
        }
    }
    const progressSection = document.getElementById('import-progress-section');
    const statusMessage = document.getElementById('import-status-message');
    const progressBar = document.getElementById('import-progress-bar');

    progressSection.style.display = 'block';
    progressBar.style.width = '0%';
    statusMessage.textContent = sourcePackName === packName
        ? `Ouverture du ZIP ${packName}...`
        : `Ouverture du ZIP ${sourcePackName} → ${packName}...`;
    isZipImportRunning = true;
    try { sessionStorage.setItem('npfZipImportRunning', '1'); } catch (_) {}

    const previousImportOfflineTilesMode = !!offlineTilesMode;
    const previousImportMapSourceMode = mapSourceMode;
    const previousImportActiveOfflinePacks = Array.isArray(activeOfflinePacks) ? [...activeOfflinePacks] : [];
    let zipImportCompletedSuccessfully = false;

    /*
     * v12.25 — OpenStreet en ZIP découpés : import progressif.
     * Le profil v12.24 en lots de 260 donnait des paliers longs 251/511/771...
     * On garde l'absence de libération lourde IndexedDB, mais on réduit les lots
     * pour éviter les pauses longues sur iPad/Safari.
     */
    const earlyPackNameForImport = packName;
    const earlyIsOpenStreetPack = isOpenStreetOfflinePackName(earlyPackNameForImport);
    const earlyIsLargeZip = file.size > 300 * 1024 * 1024;
    if (earlyIsOpenStreetPack && !earlyIsLargeZip) {
        await suspendOfflineMapRenderingDuringImport(`Import ${packName}`);
    } else {
        await releaseOfflineDatabaseForHeavyOperation(`Import ${packName}`);
    }

    const idle = (delay = 0) => new Promise((resolve) => setTimeout(resolve, delay));
    const nextFrame = () => new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });

    const updateImportProgress = async (message, percent = null, forceFrame = false) => {
        if (typeof percent === 'number') {
            progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
        statusMessage.textContent = message;
        if (forceFrame) {
            await nextFrame();
        }
    };

    const reopenDbCleanly = async () => {
        try {
            if (importTileDb) importTileDb.close();
        } catch (_) {}
        importTileDb = null;
        await idle(180);
        importTileDb = await openOfflineTileDatabaseByName(isolatedImportDbName, 3);
    };

    const getTileWriteTransaction = () => {
        /*
         * v13.73 — import isolé par carte.
         * Les tuiles sont écrites dans une base dédiée au groupe de carte,
         * afin de ne plus écrire dans la base IndexedDB déjà utilisée par la carte active.
         */
        const targetDb = importTileDb || db;
        if (!targetDb) throw new Error('Base de tuiles import indisponible');
        try {
            return targetDb.transaction('tiles', 'readwrite', { durability: 'relaxed' });
        } catch (_) {
            return targetDb.transaction('tiles', 'readwrite');
        }
    };

    const putTileBatch = (batch, timeoutMs = 22000) => new Promise((resolve, reject) => {
        if (!batch.length) {
            resolve();
            return;
        }

        const transaction = getTileWriteTransaction();
        const store = transaction.objectStore('tiles');
        let finished = false;

        const finish = (callback, value) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            callback(value);
        };

        const timer = setTimeout(() => {
            try { transaction.abort(); } catch (_) {}
            finish(reject, new Error(`Transaction IndexedDB bloquée plus de ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs);

        try {
            batch.forEach(tileData => {
                store.put(tileData);
            });
        } catch (error) {
            try { transaction.abort(); } catch (_) {}
            finish(reject, error);
            return;
        }

        transaction.oncomplete = () => finish(resolve);
        transaction.onerror = () => finish(reject, transaction.error || new Error('Erreur transaction IndexedDB'));
        transaction.onabort = () => finish(reject, transaction.error || new Error('Transaction IndexedDB annulée'));
    });

    const putTileBatchResilient = async (batch) => {
        try {
            await putTileBatch(batch);
            return;
        } catch (error) {
            /*
             * v13.70 — reprise automatique si Safari bloque une transaction.
             * Le blocage observé à 171/22387 correspond typiquement au premier
             * gros lot qui ne se termine jamais après utilisation d'une carte active.
             * On rouvre la base et on réécrit le même lot en micro-lots.
             */
            console.warn('[Offline] Lot IndexedDB bloqué, reprise micro-lots:', error);
            await updateImportProgress('Base iPad occupée : reprise en petits lots...', null, true);
            await reopenDbCleanly();
            for (let i = 0; i < batch.length; i += 12) {
                await putTileBatch(batch.slice(i, i + 12), 18000);
                await idle(6);
            }
        }
    };

    const deleteExistingTilesForPack = (packNameToDelete, isLargeZipPack) => new Promise((resolve, reject) => {
        /*
         * Avant de réimporter un gros pack, on libère l'ancien contenu.
         * C'est critique pour OpenStreet ~900 Mo : sans purge préalable,
         * Safari/iPadOS peut atteindre le quota avant d'avoir remplacé les tuiles.
         */
        if (!importTileDb || !packNameToDelete) {
            resolve(0);
            return;
        }

        let deleted = 0;
        const tx = getTileWriteTransaction();
        const store = tx.objectStore('tiles');

        const deleteCursor = (request) => {
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (!cursor) return;

                const value = cursor.value || {};
                const key = cursor.primaryKey || value.url || '';
                const keyText = String(key);
                const shouldDelete = value.packName === packNameToDelete
                    || keyText.endsWith(`::${packNameToDelete}`);

                if (shouldDelete) {
                    cursor.delete();
                    deleted += 1;
                }
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        };

        try {
            if (store.indexNames && store.indexNames.contains('packName')) {
                deleteCursor(store.index('packName').openCursor(IDBKeyRange.only(packNameToDelete)));
            } else {
                deleteCursor(store.openCursor());
            }
        } catch (error) {
            reject(error);
            return;
        }

        tx.oncomplete = () => resolve(deleted);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction purge IndexedDB annulée'));
    });

    try {
        /*
         * v12.11 — renforcement gros volumes à partir de v11.33.
         *
         * Symptôme validé :
         * - OpenStreet 900 Mo s'installe, mais peut planter en toute fin.
         * - OACI finit par s'installer mais démarre très lentement après OpenStreet.
         *
         * Correction :
         * - avant chaque import, fermeture/réouverture IndexedDB pour repartir propre ;
         * - OpenStreet garde la clé simple qui fonctionne ;
         * - OACI garde la clé pack-scopée ;
         * - après gros import, on recharge immédiatement AVANT displayInstalledMaps()
         *   et AVANT notifyServiceWorkerActivePacks(), car le crash arrive en fin d'installation.
         */
        await reopenDbCleanly();

        await idle(80);
        const zip = await JSZip.loadAsync(file);

        const tileFiles = Object.values(zip.files || {}).filter(f => {
            return !f.dir && /\d+\/\d+\/\d+\.(png|jpg|jpeg)$/i.test(f.name);
        });

        const totalFiles = tileFiles.length;
        if (totalFiles === 0) {
            throw new Error("Aucune tuile valide trouvée dans le ZIP. La structure doit être /zoom/colonne/ligne.png");
        }

        await updateImportProgress(`Préparation terminée. Base isolée ${isolatedImportDbName}. Lecture de ${totalFiles} tuiles...`, 1, true);
        await idle(120);

        const isLargeZip = file.size > 300 * 1024 * 1024;
        const isOpenStreetPack = isOpenStreetOfflinePackName(packName);
        const isIgnPack = isIgnOfflinePackName(packName);
        const isOaciPack = isOaciOfflinePackName(packName);

        /*
         * v12.14 — OpenStreet reste sur le profil conservateur validé.
         * IGN, même en gros ZIP, passe sur un profil plus rapide :
         * - plus gros lots IndexedDB ;
         * - pas de fermeture/réouverture toutes les 700 tuiles ;
         * - clé pack-scopée pour éviter les collisions entre ZIP/hosts.
         */
        const useConservativeLargeImport = isLargeZip && isOpenStreetPack;
        const useSplitZipFastProfile = isOpenStreetPack && !isLargeZip;
        const useSafeMultiZipImport = !isLargeZip && totalFiles >= 5000 && !useSplitZipFastProfile;

        /*
         * v13.70 — profil multi-ZIP stable iPad.
         * Les nouveaux ZIP de carte France peuvent contenir ~20 000 à 25 000 tuiles par bloc
         * sans être nommés OpenStreet. Après utilisation d'une carte active, Safari bloquait
         * le premier gros lot autour de 171/22387. On force donc un profil plus petit,
         * progressif et rouvert régulièrement pour ces ZIP.
         */
        /* v17.46 — données brutes : lots de 40 tuiles au plus (mémoire iPad). */
        const batchSize = Math.min(NPF_OFFLINE_RAW_IMPORT_MAX_BATCH, useConservativeLargeImport
            ? 35
            : (useSafeMultiZipImport ? 40 : (useSplitZipFastProfile ? 240 : (isIgnPack ? 320 : (isOaciPack ? 35 : (isLargeZip ? 160 : 180))))));
        const reopenEveryTiles = useConservativeLargeImport ? 700 : (useSafeMultiZipImport ? 400 : (isOaciPack ? 350 : 0));
        const splitZipReadConcurrency = useSplitZipFastProfile ? 48 : 1;
        const splitZipUiYieldEveryTiles = useSplitZipFastProfile ? 960 : 0;
        const usePackScopedKey = !isOpenStreetPack;
        /*
         * v12.19 : OACI passe en mode sécurisé.
         * Symptôme : blocage/crash vers Lecture tuiles 51/3347 quand OACI est la 3e carte.
         * Mesure : petits lots de 10, réouverture périodique IndexedDB, lecture blob.
         */
        /* v17.46 — toutes les cartes en données brutes (ArrayBuffer). */
        const tileReadMode = NPF_OFFLINE_TILE_FORMAT_RAW;
        let skippedTiles = 0;

        const alreadyInstalledPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
        const alreadyInstalled = alreadyInstalledPacks.some(p => p && p.name === packName);
        /* v17.46 — en reprise, les tuiles déjà écrites sont conservées. */
        if (!resumeFromTile && (alreadyInstalled || (isLargeZip && isOpenStreetPack))) {
            statusMessage.textContent = `Nettoyage préalable du pack ${packName}...`;
            progressBar.style.width = '2%';
            await idle(120);
            try {
                const deletedBeforeImport = await deleteExistingTilesForPack(packName, isLargeZip && isOpenStreetPack);
                if (deletedBeforeImport > 0) {
                    statusMessage.textContent = `Ancien pack nettoyé : ${deletedBeforeImport} tuiles supprimées.`;
                    await idle(250);
                }
                await reopenDbCleanly();
            } catch (cleanupError) {
                console.warn('[Offline] Nettoyage préalable impossible, import poursuivi:', cleanupError);
            }
        }
        /*
         * v11.36 : les petits packs utilisent aussi un host dédié dans tileUrl.
         * L'index tileUrl du service worker tombe donc directement sur le bon pack
         * et l'affichage OACI redevient rapide.
         */

        let batch = [];
        let processedFiles = 0;
        let lastUiUpdate = Date.now();

        /* v17.46 — suivi de l'import (reprise + DIAG). */
        const importLogId = `${Date.now()}-${packName}`;
        const importStartedAt = Date.now();
        let committedTiles = resumeFromTile;
        let maxBatchMs = 0;
        let flushCount = 0;
        const saveImportProgress = () => {
            writeNpfJsonStorage(NPF_OFFLINE_IMPORT_PROGRESS_KEY, {
                packName,
                fileName: file.name,
                fileSize: file.size,
                dbName: isolatedImportDbName,
                written: committedTiles,
                total: totalFiles,
                updatedAt: Date.now()
            });
            updateNpfOfflineImportLog({
                id: importLogId, file: file.name, pack: packName, at: importStartedAt,
                status: 'en cours', written: committedTiles, total: totalFiles,
                ms: Date.now() - importStartedAt, maxBatchMs: Math.round(maxBatchMs),
                resumedFrom: resumeFromTile
            });
        };
        saveImportProgress();
        if (resumeFromTile > 0) {
            processedFiles = resumeFromTile;
            await updateImportProgress(`Reprise de ${packName} à la tuile ${resumeFromTile + 1} / ${totalFiles}...`, Math.round((resumeFromTile / totalFiles) * 100), true);
            await idle(200);
        }

        const flushBatch = async () => {
            if (!batch.length) return;
            const toWrite = batch;
            batch = [];
            const batchStartedAt = Date.now();
            await putTileBatchResilient(toWrite);
            processedFiles += toWrite.length;
            committedTiles = processedFiles;
            maxBatchMs = Math.max(maxBatchMs, Date.now() - batchStartedAt);
            flushCount += 1;
            /* Libération explicite des images du lot écrit. */
            for (const item of toWrite) {
                if (item) item.tile = null;
            }
            toWrite.length = 0;
            if (flushCount % 10 === 0) saveImportProgress();

            const percent = Math.min(100, Math.round((processedFiles / totalFiles) * 100));
            await updateImportProgress(
                useSplitZipFastProfile
                    ? `ZIP fractionné rapide : ${processedFiles} / ${totalFiles} tuiles`
                    : (useSafeMultiZipImport
                        ? `Import sécurisé iPad : ${processedFiles} / ${totalFiles} tuiles`
                        : `Écriture iPad... ${processedFiles} / ${totalFiles} tuiles`),
                percent,
                useConservativeLargeImport || useSplitZipFastProfile || useSafeMultiZipImport
            );

            if (reopenEveryTiles && processedFiles > 0 && processedFiles % reopenEveryTiles < toWrite.length) {
                await updateImportProgress(`Stabilisation base offline... ${processedFiles} / ${totalFiles}`, percent, true);
                await reopenDbCleanly();
            }

            await idle(useConservativeLargeImport ? 20 : 8);
        };

        await updateImportProgress(`Début lecture des tuiles ${packName}...`, 2, true);
        await idle(120);

        if (useSplitZipFastProfile) {
            /*
             * v12.51 — ZIP fractionné RAPIDE :
             * On garde la lecture parallèle, mais avec des transactions moyennes
             * de 240 tuiles : assez grandes pour accélérer l'import, assez courtes pour
             * éviter le palier bloquant observé à 1008 tuiles.
             */
            for (let i = resumeFromTile; i < tileFiles.length; i += splitZipReadConcurrency) {
                const slice = tileFiles.slice(i, i + splitZipReadConcurrency);

                const readItems = await Promise.all(slice.map(async (tileFile, offset) => {
                    const absoluteIndex = i + offset;
                    try {
                        const tile = await tileFile.async(tileReadMode);
                        const tileUrl = buildOfflineTileUrlForPack(tileFile.name, packName, isLargeZip);
                        return {
                            url: usePackScopedKey ? buildStoredTileKey(tileUrl, packName) : tileUrl,
                            tileUrl,
                            tile,
                            packName
                        };
                    } catch (tileReadError) {
                        console.warn('[Offline] Tuile ZIP fractionné ignorée:', absoluteIndex + 1, tileReadError);
                        skippedTiles += 1;
                        return null;
                    }
                }));

                for (const item of readItems) {
                    if (item) batch.push(item);
                }

                if (batch.length >= batchSize) {
                    await flushBatch();
                    if (splitZipUiYieldEveryTiles && processedFiles > 0 && processedFiles % splitZipUiYieldEveryTiles === 0) {
                        await updateImportProgress(`Import rapide : ${processedFiles} / ${totalFiles} tuiles`, Math.min(99, Math.round((processedFiles / totalFiles) * 100)), true);
                        await idle(8);
                    }
                }

                const now = Date.now();
                if (now - lastUiUpdate > 900) {
                    lastUiUpdate = now;
                    const readCount = Math.min(i + splitZipReadConcurrency, totalFiles);
                    const percent = Math.min(99, Math.round((Math.max(processedFiles, readCount) / totalFiles) * 100));
                    await updateImportProgress(
                        `ZIP fractionné rapide : lu ${readCount} / ${totalFiles}, écrit ${processedFiles}`,
                        percent,
                        true
                    );
                }
            }
        } else {
            for (let i = resumeFromTile; i < tileFiles.length; i += 1) {
                const tileFile = tileFiles[i];

                if (!useConservativeLargeImport && !useSplitZipFastProfile && (i === 0 || i % 10 === 0)) {
                    const readPercent = Math.min(95, Math.max(2, Math.round((i / totalFiles) * 100)));
                    await updateImportProgress(useSafeMultiZipImport
                        ? `Import sécurisé : lecture ${i + 1} / ${totalFiles}`
                        : `Lecture tuiles... ${i + 1} / ${totalFiles}`, readPercent, true);
                }

                if (useConservativeLargeImport && (i === 0 || i % 10 === 0)) {
                    const readPercent = Math.min(96, Math.max(1, Math.round((i / totalFiles) * 100)));
                    await updateImportProgress(`Lecture ZIP... ${i + 1} / ${totalFiles} tuiles`, readPercent, true);
                }

                let blob;
                try {
                    blob = await tileFile.async(tileReadMode);
                } catch (tileReadError) {
                    await idle(isOaciPack ? 300 : 160);
                    try {
                        blob = await tileFile.async(tileReadMode);
                    } catch (secondTileReadError) {
                        if (isOaciPack) {
                            skippedTiles += 1;
                            await updateImportProgress(`OACI : tuile ignorée ${i + 1} / ${totalFiles} (${skippedTiles} erreur(s))`, null, true);
                            continue;
                        }
                        throw secondTileReadError;
                    }
                }
                const tileUrl = buildOfflineTileUrlForPack(tileFile.name, packName, isLargeZip);

                batch.push({
                    url: usePackScopedKey ? buildStoredTileKey(tileUrl, packName) : tileUrl,
                    tileUrl,
                    tile: blob,
                    packName
                });

                if (batch.length >= batchSize) {
                    await flushBatch();
                }

                const now = Date.now();
                if (now - lastUiUpdate > (useConservativeLargeImport ? 350 : 700)) {
                    lastUiUpdate = now;
                    const percent = Math.min(99, Math.round((Math.max(processedFiles, i + 1) / totalFiles) * 100));
                    await updateImportProgress(`Importation... lecture ${i + 1} / ${totalFiles}, écrit ${processedFiles}`, percent, true);
                }
            }
        }

        await flushBatch();

        /* v17.46 — import terminé : plus de reprise possible, journal à jour. */
        try { localStorage.removeItem(NPF_OFFLINE_IMPORT_PROGRESS_KEY); } catch (_) {}
        updateNpfOfflineImportLog({
            id: importLogId, status: 'terminé', written: committedTiles, total: totalFiles,
            ms: Date.now() - importStartedAt, maxBatchMs: Math.round(maxBatchMs), skipped: skippedTiles
        });

        await updateImportProgress(skippedTiles > 0 ? `Importation de ${packName} terminée — ${skippedTiles} tuile(s) ignorée(s).` : `Importation de ${packName} terminée !`, 100, true);

        const installedPacks = JSON.parse(
            localStorage.getItem('installedMapPacks') || '[]'
        );

        /*
         * Un ancien enregistrement NPF_France_V8_01 ou NPF_France_V9_01 est
         * remplacé logiquement par NPF_France_01. Il ne peut donc pas apparaître
         * comme une deuxième dalle dans la liste.
         */
        const installedPacksWithoutSameCanonicalName = installedPacks.filter(
            pack => (
                !pack
                || normalizeOfflinePackName(pack.name) !== packName
            )
        );

        installedPacksWithoutSameCanonicalName.push({
            name: packName,
            sourceName: sourcePackName,
            date: new Date().toLocaleDateString(),
            groupName: packGroupNameForImport,
            dbName: isolatedImportDbName,
            storageMode: 'isolated-v13.73',
            tileFormat: NPF_OFFLINE_TILE_FORMAT_RAW,
            sizeBytes: Number(file.size) || null
        });

        localStorage.setItem(
            'installedMapPacks',
            JSON.stringify(installedPacksWithoutSameCanonicalName)
        );

        const importedGroupName = getOfflinePackGroupName(packName);
        const importedGroupPacks = getInstalledPackNamesForGroup(importedGroupName);
        await persistSimpleActiveOfflinePacks(importedGroupPacks.length ? importedGroupPacks : [packName]);

        try {
            localStorage.removeItem(OFFLINE_TILES_MIN_ZOOM_KEY);
            localStorage.removeItem(OFFLINE_TILES_MAX_ZOOM_KEY);
        } catch (_) {}

        const restoreOfflineAfterImport = previousImportMapSourceMode === 'offline' || previousImportOfflineTilesMode;
        mapSourceMode = restoreOfflineAfterImport ? 'offline' : 'online';
        localStorage.setItem(MAP_SOURCE_MODE_KEY, mapSourceMode);
        await setOfflineTilesEnabled(restoreOfflineAfterImport);
        notifyServiceWorkerActivePacks(activeOfflinePacks);
        updateMapSourceButtons();
        updateOfflineStatus();
        zipImportCompletedSuccessfully = true;

        try { if (importTileDb) importTileDb.close(); } catch (_) {}
        importTileDb = null;

        if (isLargeZip) {
            reloadAfterOfflinePackChange(`Importation de ${packName} terminée. Rechargement mémoire...`);
            return;
        }

        reloadAfterOfflinePackChange(`Importation de ${packName} terminée. Rechargement de la carte...`);
        return;

    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        /* v17.46 — journal des imports : erreur ; la reprise reste possible. */
        try {
            const log = readNpfJsonStorage(NPF_OFFLINE_IMPORT_LOG_KEY, []);
            const last = (Array.isArray(log) ? [...log] : []).reverse()
                .find(item => item && item.pack === packName && item.status === 'en cours');
            if (last) updateNpfOfflineImportLog({ id: last.id, status: 'erreur', error: message.slice(0, 80) });
        } catch (_) {}
        statusMessage.textContent = `Erreur: ${message}`;
        if (/quota|storage|abort|transaction/i.test(message)) {
            statusMessage.textContent += " — vérifiez l'espace iPad disponible, puis relancez après fermeture/réouverture de NPF-Q400.";
        }
        console.error("Erreur d'importation ZIP:", error);

        if (!zipImportCompletedSuccessfully) {
            try {
                mapSourceMode = previousImportMapSourceMode || 'online';
                localStorage.setItem(MAP_SOURCE_MODE_KEY, mapSourceMode);
                await persistSimpleActiveOfflinePacks(previousImportActiveOfflinePacks);
                await setOfflineTilesEnabled(previousImportOfflineTilesMode);
                notifyServiceWorkerActivePacks(previousImportActiveOfflinePacks);
                updateMapSourceButtons();
                updateOfflineStatus();
            } catch (restoreError) {
                console.warn('[Offline] Restauration état offline après échec import impossible:', restoreError);
            }
        }
    } finally {
        try { if (importTileDb) importTileDb.close(); } catch (_) {}
        importTileDb = null;
        isZipImportRunning = false;
        try { sessionStorage.removeItem('npfZipImportRunning'); } catch (_) {}
        setTimeout(() => { progressSection.style.display = 'none'; }, 7000);
    }
}

function isPlausibleTileZoom(value) {
    return Number.isFinite(value) && value >= 0 && value <= 22;
}

function parseTilePathFromName(name) {
    const normalizedName = String(name || '').replace(/\\/g, '/');
    const xyzMatch = normalizedName.match(/(?:^|\/)(\d+)\/(\d+)\/(\d+)\.(png|jpg|jpeg)$/i);
    if (xyzMatch) {
        const zoom = Number.parseInt(xyzMatch[1], 10);
        if (!isPlausibleTileZoom(zoom)) return [];
        return [{ tilePath: `${xyzMatch[1]}/${xyzMatch[2]}/${xyzMatch[3]}.png`, zoom }];
    }

    const flatMatch = normalizedName.match(/(?:^|\/)(\d+)[-_](\d+)[-_](\d+)\.(png|jpg|jpeg)$/i);
    if (!flatMatch) return [];

    const a = Number.parseInt(flatMatch[1], 10);
    const c = Number.parseInt(flatMatch[3], 10);
    const candidates = [];

    if (isPlausibleTileZoom(a)) {
        candidates.push({ tilePath: `${flatMatch[1]}/${flatMatch[2]}/${flatMatch[3]}.png`, zoom: a });
    }
 // Compatibilité imports plats potentiellement en x_y_z : on ajoute aussi z/x/y.
    if (isPlausibleTileZoom(c)) {
        const altTilePath = `${flatMatch[3]}/${flatMatch[1]}/${flatMatch[2]}.png`;
        if (!candidates.some((entry) => entry.tilePath === altTilePath)) {
            candidates.push({ tilePath: altTilePath, zoom: c });
        }
    }

    return candidates;
}


async function persistSimpleActiveOfflinePacks(packs) {
    activeOfflinePacks = Array.isArray(packs)
        ? packs.filter(Boolean)
        : [];
    activeOfflinePackDatabases =
        getOfflineActivePackDatabasesForPacks(activeOfflinePacks);
    activeOfflinePackAliases =
        getOfflineActivePackAliasesForPacks(activeOfflinePacks);

    localStorage.setItem(
        OFFLINE_ACTIVE_PACKS_KEY,
        JSON.stringify(activeOfflinePacks)
    );
    localStorage.setItem(
        OFFLINE_ACTIVE_PACK_DATABASES_KEY,
        JSON.stringify(activeOfflinePackDatabases)
    );
    localStorage.setItem(
        OFFLINE_ACTIVE_PACK_ALIASES_KEY,
        JSON.stringify(activeOfflinePackAliases)
    );

    try {
        localStorage.removeItem(OFFLINE_TILES_MIN_ZOOM_KEY);
        localStorage.removeItem(OFFLINE_TILES_MAX_ZOOM_KEY);
    } catch (_) {}

    notifyServiceWorkerActivePacks(activeOfflinePacks);

    const packsToPersist = [...activeOfflinePacks];
    const databasesToPersist = [...activeOfflinePackDatabases];
    const aliasesToPersist = [...activeOfflinePackAliases];
    setTimeout(() => {
        withTimeout(
            runOfflineSettingsTransaction(
                'readwrite',
                store => {
                    store.put({
                        key: OFFLINE_ACTIVE_PACKS_KEY,
                        value: packsToPersist
                    });
                    store.put({
                        key: OFFLINE_ACTIVE_PACK_DATABASES_KEY,
                        value: databasesToPersist
                    });
                    store.put({
                        key: OFFLINE_ACTIVE_PACK_ALIASES_KEY,
                        value: aliasesToPersist
                    });
                }
            ),
            2000,
            'Timeout persistance des packs Offline'
        ).catch(error => {
            console.warn(
                '[Offline] Packs conservés en localStorage uniquement:',
                error
            );
        });
    }, 0);

    return activeOfflinePacks;
}


function reloadAfterOfflinePackChange(message = 'Rechargement de la carte...') {
    const statusMessage = document.getElementById('import-status-message');
    if (statusMessage) statusMessage.textContent = message;

    try {
        if (map && baseTileLayer) {
            map.removeLayer(baseTileLayer);
            baseTileLayer = null;
        }
    } catch (_) {}

    try {
        if (db) db.close();
    } catch (_) {}
    db = null;

    setTimeout(() => {
        const refreshUrl = new URL(window.location.href);
        refreshUrl.searchParams.set('appv', APP_VERSION);
        refreshUrl.searchParams.set('ts', Date.now().toString());
        window.location.replace(refreshUrl.toString());
    }, 300);
}



function normalizeOfflinePackName(packName) {
    /*
     * v14.34 — la version de fabrication du pack ne fait pas partie de son
     * identité locale.
     *
     * Exemples :
     * NPF_France_V9_01.zip    -> NPF_France_01
     * NPF_France_V12_10.zip   -> NPF_France_10
     * NPF_France_V9.2_03.zip  -> NPF_France_03
     * NPF_France_04.zip       -> NPF_France_04
     *
     * Le suffixe final reste le numéro de dalle. Il est normalisé sur au moins
     * deux chiffres pour conserver l'ordre 01...10.
     */
    const rawName = String(packName || '')
        .split(/[\\/]/)
        .pop()
        .replace(/\.zip$/i, '')
        .trim();

    const cleaned = rawName
        .replace(/\s*\(\d+\)\s*$/i, '')
        .replace(/\s+(copy|copie)\s*$/i, '')
        .trim();

    const versionedMatch = cleaned.match(
        /^(.*?)[\s_-]+v(?:ersion)?[\s_-]*\d+(?:\.\d+)*(?:[\s_-]+(?:part|partie|zip)?[\s_-]*(\d{1,3}))$/i
    );

    if (!versionedMatch) {
        return cleaned;
    }

    const prefix = versionedMatch[1]
        .replace(/[\s_-]+$/g, '')
        .trim();

    const partNumber = Number.parseInt(versionedMatch[2], 10);
    if (!prefix || !Number.isFinite(partNumber)) {
        return cleaned;
    }

    const sourcePartWidth = String(versionedMatch[2]).length;
    const normalizedPartWidth = Math.max(2, sourcePartWidth);
    const normalizedPart = String(partNumber).padStart(
        normalizedPartWidth,
        '0'
    );

    return `${prefix}_${normalizedPart}`;
}


function getOfflinePackGroupName(packName) {
    /*
     * v12.15 — groupes de packs offline plus tolérants.
     * Exemples :
     * OpenStreet_01, OpenStreet-02, IGN_001, IGN 03, IGN_part04 => groupe IGN.
     */
    const name = normalizeOfflinePackName(packName);
    const cleaned = name
        .replace(/\s*\(\d+\)\s*$/i, '')
        .replace(/\s+(copy|copie)\s*$/i, '')
        .trim();

    const match = cleaned.match(/^(.+?)(?:[\s_-]*(?:part|partie|zip)?[\s_-]*)(\d{1,3})$/i);
    if (match && match[1].trim().length >= 2) {
        return match[1].replace(/[\s_-]+$/g, '').trim();
    }

    return cleaned;
}

function groupInstalledMapPacks(installedPacks = []) {
    const groups = new Map();
    installedPacks.forEach(pack => {
        if (!pack || !pack.name) return;
        const groupName = getOfflinePackGroupName(pack.name);
        if (!groups.has(groupName)) {
            groups.set(groupName, {
                name: groupName,
                packs: [],
                date: pack.date || ''
            });
        }
        const group = groups.get(groupName);
        group.packs.push(pack);
        group.date = pack.date || group.date;
    });
    return Array.from(groups.values()).map(group => {
        group.packs.sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr', { numeric: true }));
        return group;
    });
}

function getInstalledPackNamesForGroup(groupName) {
    const installedPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
    return installedPacks
        .filter(pack => pack && getOfflinePackGroupName(pack.name) === groupName)
        .map(pack => pack.name);
}

function getQuickOfflineMapGroups() {
    let installedPacks = [];
    try {
        const parsed = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
        installedPacks = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        installedPacks = [];
    }

    return groupInstalledMapPacks(installedPacks)
        .filter(group => group && group.name && Array.isArray(group.packs) && group.packs.length)
        .sort((left, right) => String(left.name).localeCompare(
            String(right.name),
            'fr',
            { numeric: true, sensitivity: 'base' }
        ));
}

function getQuickOfflineActiveGroupName(groups = null) {
    if (mapSourceMode !== 'offline') return '';
    const installedGroups = Array.isArray(groups) ? groups : getQuickOfflineMapGroups();
    for (const group of installedGroups) {
        const names = group.packs.map(pack => pack?.name).filter(Boolean);
        if (
            names.length
            && names.every(name => activeOfflinePacks.includes(name))
            && activeOfflinePacks.length === names.length
        ) return String(group.name || '');
    }
    return '';
}

function refreshQuickOfflineMapButtonState() {
    const button = document.getElementById('quick-offline-map-button');
    if (!button) return;

    const groups = getQuickOfflineMapGroups();
    const activeGroupName = getQuickOfflineActiveGroupName(groups);
    const hasInstalledMaps = groups.length > 0;

    button.classList.toggle(
        'active',
        !!activeGroupName && mapSourceMode === 'offline'
    );
    button.classList.toggle(
        'missing-data',
        !hasInstalledMaps
    );
    button.disabled = isMapSourceSwitching;
    button.dataset.activeGroup = activeGroupName || '';
    button.dataset.hasInstalledMaps = hasInstalledMaps ? 'true' : 'false';

    button.title = hasInstalledMaps
        ? (
            activeGroupName
                ? `Carte offline active : ${activeGroupName} — appuyer pour changer`
                : 'Choisir rapidement une carte offline'
        )
        : 'Aucune carte offline téléchargée';
}

function closeQuickOfflineMapSelector() {
    const modal = document.getElementById('quick-offline-map-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function setQuickOfflineMapStatus(message = '', state = '') {
    const status = document.getElementById('quick-offline-map-status');
    if (!status) return;
    status.textContent = String(message || '');
    status.dataset.state = String(state || '');
}

function displayQuickOfflineMapSelector() {
    const list = document.getElementById('quick-offline-map-list');
    if (!list) return;

    const groups = getQuickOfflineMapGroups();
    const activeGroupName = getQuickOfflineActiveGroupName(groups);
    list.innerHTML = '';

    if (!groups.length) {
        const empty = document.createElement('div');
        empty.className = 'quick-offline-map-empty';
        empty.textContent = 'Aucune carte offline téléchargée.';
        list.appendChild(empty);
        setQuickOfflineMapStatus('Importe d’abord une carte depuis Gestion des Cartes.', 'empty');
        refreshQuickOfflineMapButtonState();
        return;
    }

    groups.forEach(group => {
        const packNames = group.packs.map(pack => pack?.name).filter(Boolean);
        const isActive = mapSourceMode === 'offline' && String(group.name) === activeGroupName;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quick-offline-map-choice';
        button.classList.toggle('active', isActive);
        button.dataset.groupName = String(group.name);

        const name = document.createElement('span');
        name.className = 'quick-offline-map-choice-name';
        name.textContent = getOfflineMapGroupDisplayName(group.name);

        const detail = document.createElement('span');
        detail.className = 'quick-offline-map-choice-detail';
        detail.textContent = isActive
            ? 'CARTE ACTUELLE — appuyer pour recharger'
            : (packNames.length > 1 ? `${packNames.length} fichiers — appuyer pour afficher` : 'Appuyer pour afficher');

        button.appendChild(name);
        button.appendChild(detail);
        button.addEventListener('click', () => {
            selectQuickOfflineMapGroup(String(group.name)).catch(error => {
                console.error('Sélection rapide carte offline impossible:', error);
                alert(`Impossible de sélectionner ${group.name} : ${error?.message || error}`);
            });
        });
        list.appendChild(button);
    });

    setQuickOfflineMapStatus(
        activeGroupName ? `Carte actuellement affichée : ${activeGroupName}.` : 'Aucune carte offline n’est actuellement active.',
        activeGroupName ? 'active' : 'idle'
    );
    refreshQuickOfflineMapButtonState();
}

function openQuickOfflineMapSelector() {
    const modal = document.getElementById('quick-offline-map-modal');
    if (!modal) return;
    displayQuickOfflineMapSelector();
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

async function forceQuickOfflineMapGroupReload(groupName, packNames) {
    const token = ++offlineMapSwitchToken;
    const cleanPacks = Array.isArray(packNames) ? packNames.filter(Boolean) : [];
    if (!cleanPacks.length) throw new Error(`Aucun fichier installé pour ${groupName}.`);

    isMapSourceSwitching = true;
    updateMapSourceButtons();
    refreshQuickOfflineMapButtonState();
    setOfflineMapSwitchBusy(`Réouverture de la carte ${groupName}…`);

    try {
        await persistSimpleActiveOfflinePacks(cleanPacks);
        if (token !== offlineMapSwitchToken) return false;

        mapSourceMode = 'offline';
        offlineTilesMode = true;
        localStorage.setItem(MAP_SOURCE_MODE_KEY, 'offline');
        localStorage.setItem(OFFLINE_TILES_ENABLED_KEY, 'true');
        setOfflineTilesEnabled(true);
        setOfflineOnlineFallbackMode(false);
        notifyServiceWorkerOfflineTilesPreference(true);
        notifyServiceWorkerActivePacks(activeOfflinePacks);

        resetPendingDirectOfflineNpfReads();
        closeDirectOfflineDatabaseConnectionsForStartupRetry();
        directOfflineTileBlobCache.clear();
        clearDirectOfflineNpfZoomReturnCache();
        directOfflineTileMissCache.clear();
        directOfflineTileLookupHints.clear();
        directOfflineNpfLastSuccessfulLookup = null;
        directOfflineTileHitCount = 0;
        directOfflineTileMissCount = 0;
        directOfflineNpfMainRamHitCount = 0;
        directOfflineNpfIndexedDbLookupCount = 0;
        directOfflineConsecutiveReadErrors = 0;

        await new Promise(resolve => setTimeout(resolve, 180));
        if (token !== offlineMapSwitchToken) return false;
        refreshRememberedOfflinePackRuntimeMetadata();

        const readyDatabase = await waitForRememberedOfflineTileDatabaseReady();
        if (token !== offlineMapSwitchToken) return false;

        if (readyDatabase) {
            const rebuilt = rebuildRememberedOfflineMapAfterDatabaseReady(
                `quick-selector-force:${groupName}`,
                readyDatabase
            );
            if (rebuilt) setOfflineMapSwitchBusy(`Carte ${groupName} réouverte.`);
        } else {
            applyImmediateBaseTileZoomForMapSource('offline');
            rebuildBaseTileLayerAfterOfflineSwitch(`quick-selector-force-fallback:${groupName}`);
            scheduleRememberedOfflineMapStartupRecovery(`quick-selector-force-fallback:${groupName}`);
            setOfflineMapSwitchBusy(`Carte ${groupName} sélectionnée — stockage local en cours de réveil.`);
        }

        synchronizeOfflineConfigurationWithServiceWorker({
            scheduleReload: false,
            timeoutMs: 2200
        }).then(controlled => {
            if (!controlled || token !== offlineMapSwitchToken || mapSourceMode !== 'offline') return;
            notifyServiceWorkerOfflineTilesPreference(true);
            notifyServiceWorkerActivePacks(activeOfflinePacks);
            rebuildBaseTileLayerAfterOfflineSwitch(`quick-selector-sw-ready:${groupName}`);
        }).catch(() => {});
        return true;
    } finally {
        if (token === offlineMapSwitchToken) {
            isMapSourceSwitching = false;
            updateMapSourceButtons();
            updateOfflineStatus();
            displayInstalledMaps();
            refreshQuickOfflineMapButtonState();
        }
    }
}

async function selectQuickOfflineMapGroup(groupName, options = {}) {
    const packNames = getInstalledPackNamesForGroup(groupName);
    if (!packNames.length) {
        alert(`Aucun pack trouvé pour ${groupName}.`);
        displayQuickOfflineMapSelector();
        return false;
    }

    const isAlreadyActive = (
        mapSourceMode === 'offline'
        && packNames.length === activeOfflinePacks.length
        && packNames.every(name => activeOfflinePacks.includes(name))
    );

    closeQuickOfflineMapSelector();
    resetPendingDirectOfflineNpfReads();
    closeDirectOfflineDatabaseConnectionsForStartupRetry();
    directOfflineTileBlobCache.clear();
    clearDirectOfflineNpfZoomReturnCache();
    directOfflineTileMissCache.clear();
    directOfflineTileLookupHints.clear();
        directOfflineNpfLastSuccessfulLookup = null;

    if (isAlreadyActive) return forceQuickOfflineMapGroupReload(groupName, packNames);

    const changed = await applyOfflineMapGroupSelectionInPlace(groupName, true, packNames, options);
    refreshQuickOfflineMapButtonState();
    return changed;
}

window.openQuickOfflineMapSelector = openQuickOfflineMapSelector;
window.closeQuickOfflineMapSelector = closeQuickOfflineMapSelector;
window.selectQuickOfflineMapGroup = selectQuickOfflineMapGroup;

function displayInstalledMaps() {
    refreshQuickOfflineMapButtonState();

    /*
     * v12.12 — affichage par groupes.
     * Les packs OpenStreet_01...OpenStreet_05 apparaissent comme une seule ligne OpenStreet.
     */
    const list = document.getElementById('installed-maps-list');
    if (!list) return;

    const installedPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
    const groups = groupInstalledMapPacks(installedPacks);
    list.innerHTML = '';

    if (groups.length === 0) {
        list.innerHTML = '<li class="no-maps-placeholder">Aucun pack de cartes installé.</li>';
        return;
    }

    groups.forEach(group => {
        const li = document.createElement('li');
        const packNames = group.packs.map(pack => pack.name);
        const activeCount = packNames.filter(name => activeOfflinePacks.includes(name)).length;
        const isActive = activeCount === packNames.length && packNames.length > 0;
        const partiallyActive = activeCount > 0 && !isActive;
        const packLabel = packNames.length > 1 ? `${packNames.length} fichiers` : '1 fichier';
        const dateLabel = group.date ? `Installé le ${group.date}` : 'Installé';
        const storageLabel = group.packs.some(pack => pack && pack.dbName) ? 'base séparée' : 'base héritée';

        li.className = packNames.length > 1 ? 'offline-map-group-line' : '';
        li.innerHTML = `
            <span class="offline-map-name-line">
                <input type="checkbox" class="offline-map-select-checkbox" ${isActive ? 'checked' : ''} data-partial="${partiallyActive ? 'true' : 'false'}" onchange="window.selectSimpleMapGroup('${group.name}', this.checked)">
                <strong>${escapeHtml(getOfflineMapGroupDisplayName(group.name) || group.name)}</strong> (${packLabel} — ${dateLabel} — ${storageLabel})${isActive ? ' — actif' : partiallyActive ? ` — partiel ${activeCount}/${packNames.length}` : ''}
            </span>
            <div class="offline-map-actions">
                <button class="delete-map-btn" onclick="window.deleteMapGroup('${group.name}')">Supprimer</button>
            </div>
        `;
        list.appendChild(li);
    });

    // v15.43 — une seule commande, centrée, sans texte de réparation.
    const resetLi = document.createElement('li');
    resetLi.className = 'offline-map-reset-line';
    resetLi.innerHTML = `
        <button class="delete-map-btn offline-full-reset-btn" onclick="window.resetAllOfflineMapsStorage()">Réinitialiser Cartes Offline</button>
    `;
    list.appendChild(resetLi);

    updateOfflineStatus();
}

async function applyOfflineMapGroupSelectionInPlace(groupName, checked, packNames, options = {}) {
    const token = ++offlineMapSwitchToken;
    const nextPacks = checked ? packNames : [];
    const nextMode = checked ? 'offline' : 'online';

    isMapSourceSwitching = true;
    updateMapSourceButtons();
    setOfflineMapSwitchBusy(
        checked
            ? `Carte ${groupName} sélectionnée — chargement des tuiles…`
            : 'Carte offline désactivée. Retour online…'
    );
    /* v17.66 — pendant un téléchargement (effacement de l'ancienne version), la
     * fenêtre Gestion des Cartes reste ouverte : la barre de progression y est. */
    if (!options.keepModalOpen) closeOfflineMapModalSoon(120);

    try {
        await persistSimpleActiveOfflinePacks(nextPacks);
        if (token !== offlineMapSwitchToken) return false;

        mapSourceMode = nextMode;
        offlineTilesMode = nextMode === 'offline';
        localStorage.setItem(MAP_SOURCE_MODE_KEY, mapSourceMode);
        localStorage.setItem(
            OFFLINE_TILES_ENABLED_KEY,
            String(offlineTilesMode)
        );

        setOfflineTilesEnabled(offlineTilesMode);
        setOfflineOnlineFallbackMode(false);
        notifyServiceWorkerActivePacks(activeOfflinePacks);
        applyImmediateBaseTileZoomForMapSource(nextMode);
        rebuildBaseTileLayerAfterOfflineSwitch('selectSimpleMapGroup-immediate-v14.69');
    } catch (error) {
        console.error('Changement de carte offline impossible:', error);
        alert(`Impossible de changer de carte offline: ${error.message || error}`);
        return false;
    } finally {
        if (token === offlineMapSwitchToken) {
            isMapSourceSwitching = false;
            updateMapSourceButtons();
            updateOfflineStatus();
            displayInstalledMaps();
            refreshQuickOfflineMapButtonState();
        }
    }

    if (checked) {
        synchronizeOfflineConfigurationWithServiceWorker({
            scheduleReload: true,
            timeoutMs: 2200
        }).then(controlled => {
            if (!controlled || mapSourceMode !== 'offline') return;
            notifyServiceWorkerOfflineTilesPreference(true);
            notifyServiceWorkerActivePacks(activeOfflinePacks);
            rebuildBaseTileLayerAfterOfflineSwitch('group-sw-ready-v14.69');
        }).catch(() => {});
    }

    withTimeout(
        updateBaseTileNativeZoomFromAvailability({ forceScan: false, rebuildLayer: false }),
        2400,
        'Timeout analyse carte sélectionnée'
    ).then(() => {
        if (token === offlineMapSwitchToken) {
            rebuildBaseTileLayerAfterOfflineSwitch('group-zoom-ready-v14.69');
        }
    }).catch(() => {});

    scheduleSiaLayerRefresh('basemap-switch-v15.51');
    return true;
}

window.selectSimpleMapGroup = async function(groupName, checked = true) {
    const packNames = getInstalledPackNamesForGroup(groupName);
    if (!packNames.length) {
        alert(`Aucun pack trouvé pour ${groupName}.`);
        displayInstalledMaps();
        return;
    }

    /*
     * v12.12 — une seule carte active à la fois, mais une carte peut être composée
     * de plusieurs ZIP indépendants : OpenStreet_01...OpenStreet_05.
     */
    await applyOfflineMapGroupSelectionInPlace(groupName, checked, packNames);
};

window.selectSimpleMapPack = async function(packName, checked = true) {
    const groupName = getOfflinePackGroupName(packName);
    return window.selectSimpleMapGroup(groupName, checked);
};





function removeInstalledOfflinePacksLogically(packNames = []) {
    const targetSet = new Set((packNames || []).filter(Boolean));
    if (!targetSet.size) return 0;

    let installedPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
    const beforeCount = installedPacks.length;
    installedPacks = installedPacks.filter(pack => !pack || !targetSet.has(pack.name));
    localStorage.setItem('installedMapPacks', JSON.stringify(installedPacks));

    if (Array.isArray(activeOfflinePacks) && activeOfflinePacks.some(name => targetSet.has(name))) {
        activeOfflinePacks = activeOfflinePacks.filter(name => !targetSet.has(name));
        activeOfflinePackDatabases = getOfflineActivePackDatabasesForPacks(activeOfflinePacks);
        localStorage.setItem(OFFLINE_ACTIVE_PACKS_KEY, JSON.stringify(activeOfflinePacks));
        localStorage.setItem(OFFLINE_ACTIVE_PACK_DATABASES_KEY, JSON.stringify(activeOfflinePackDatabases));
        notifyServiceWorkerActivePacks(activeOfflinePacks);
    }

    return beforeCount - installedPacks.length;
}

function shouldUseLogicalDeleteForOfflineGroup(groupName, packNames = []) {
    /*
     * v12.22 — OpenStreet est trop volumineux pour une suppression physique fiable
     * sur iPad/Safari. On retire donc le pack de la liste active/installée, sans
     * parcourir 1 Go de tuiles dans IndexedDB.
     */
    if (isOpenStreetOfflinePackName(groupName)) return true;
    return (packNames || []).some(name => isOpenStreetOfflinePackName(name));
}


window.resetAllOfflineMapsStorage = async function() {
    /*
     * v12.20 — reset sans deleteDatabase bloquant.
     *
     * Le deleteDatabase('OfflineTilesDB') peut rester bloqué si Safari/iPadOS ou
     * l'ancien service worker garde encore une connexion ouverte.
     *
     * La v12.20 abandonne donc l'ancienne base et utilise une nouvelle base :
     * OfflineTilesDB_v12_20.
     *
     * Conséquence :
     * - le reset fonctionne même si l'ancienne base est verrouillée ;
     * - les anciennes tuiles peuvent rester dans les données Safari du site ;
     * - si l'espace iPad devient insuffisant, il faudra effacer les données du site
     *   depuis Réglages Safari.
     */
    const confirmed = confirm(
        'Réinitialiser la liste des cartes offline ?\n\n' +
        'La v12.20 utilise une nouvelle base offline propre.\n' +
        'Les anciennes données verrouillées seront ignorées.'
    );
    if (!confirmed) return;

    const progressSection = document.getElementById('import-progress-section');
    const statusMessage = document.getElementById('import-status-message') || document.getElementById('offline-status');
    const progressBar = document.getElementById('import-progress-bar');

    if (progressSection) progressSection.style.display = 'block';
    if (progressBar) progressBar.style.width = '10%';
    if (statusMessage) statusMessage.textContent = 'Réinitialisation logique du stockage offline...';

    try {
        await suspendOfflineMapRenderingDuringImport('Réinitialisation stockage offline');

        try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'OFFLINE_FACTORY_RESET' });
            }
        } catch (_) {}

        try {
            if (db) db.close();
        } catch (_) {}
        db = null;

        if (progressBar) progressBar.style.width = '35%';

        try {
            await clearTileCaches();
        } catch (_) {}

        if (progressBar) progressBar.style.width = '60%';

        /*
         * Tentative non bloquante de supprimer l'ancienne base historique.
         * Si elle est bloquée, on n'échoue plus : la nouvelle base v12.20 sera utilisée.
         */
        try {
            if (typeof indexedDB !== 'undefined') {
                const legacyReq = indexedDB.deleteDatabase('OfflineTilesDB');
                legacyReq.onerror = () => {};
                legacyReq.onblocked = () => {};
            }
        } catch (_) {}

        localStorage.removeItem('installedMapPacks');
        localStorage.removeItem(OFFLINE_ACTIVE_PACKS_KEY);
        localStorage.removeItem(OFFLINE_ACTIVE_PACK_DATABASES_KEY);
        localStorage.setItem(OFFLINE_TILES_ENABLED_KEY, String(DEFAULT_OFFLINE_TILES_ENABLED));
        activeOfflinePacks = [];

        await initDB();

        if (progressBar) progressBar.style.width = '100%';
        if (statusMessage) statusMessage.textContent = 'Stockage offline réinitialisé sur nouvelle base. Rechargement...';

        setTimeout(() => {
            const refreshUrl = new URL(window.location.href);
            refreshUrl.searchParams.set('appv', APP_VERSION);
            refreshUrl.searchParams.set('ts', Date.now().toString());
            window.location.replace(refreshUrl.toString());
        }, 700);
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (statusMessage) statusMessage.textContent = `Réinitialisation impossible : ${message}`;
        alert(`Réinitialisation impossible : ${message}`);
    }
};;


/*
 * v13.70 — reset profond offline iPad.
 * Le reset logique ne suffit pas sur iPadOS quand IndexedDB reste verrouillée :
 * l'import suivant peut bloquer dès 31 tuiles, et seule la suppression de la PWA
 * libère réellement le stockage. Cette version :
 * - utilise une nouvelle base OfflineTilesDB_v13_70_clean ;
 * - ferme la connexion page + service worker ;
 * - supprime les bases OfflineTilesDB connues quand Safari l'autorise ;
 * - désinscrit le service worker uniquement pendant le reset, puis recharge l'app
 *   pour qu'il soit réinstallé proprement.
 */
function deleteIndexedDatabaseWithTimeoutForNpf(name, timeoutMs = 3200) {
    return new Promise((resolve) => {
        if (!name || typeof indexedDB === 'undefined') {
            resolve({ name, status: 'skipped' });
            return;
        }
        let done = false;
        const finish = (status, detail = '') => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({ name, status, detail });
        };
        const timer = setTimeout(() => finish('timeout'), timeoutMs);
        try {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => finish('deleted');
            request.onerror = () => finish('error', request.error && request.error.message ? request.error.message : 'deleteDatabase error');
            request.onblocked = () => finish('blocked');
        } catch (error) {
            finish('exception', error && error.message ? error.message : String(error));
        }
    });
}

async function getNpfOfflineDatabaseNamesForReset() {
    const names = new Set([
        OFFLINE_DB_NAME,
        'OfflineTilesDB',
        'OfflineTilesDB_v12_20',
        'OfflineTilesDB_v12_21',
        'OfflineTilesDB_v13_70_clean'
    ]);
    try {
        if (indexedDB && typeof indexedDB.databases === 'function') {
            const databases = await indexedDB.databases();
            (databases || []).forEach((entry) => {
                const name = entry && entry.name ? String(entry.name) : '';
                if (/^OfflineTilesDB/i.test(name) || /^OfflineMap_/i.test(name)) names.add(name);
            });
        }
    } catch (_) {}
    return Array.from(names).filter(Boolean);
}

window.resetAllOfflineMapsStorage = async function() {
    const confirmed = confirm(
        'Réinitialisation profonde des cartes offline ?\n\n' +
        'Cette action désactive la carte offline, ferme IndexedDB, nettoie les bases de tuiles et recharge NPF-Q400.\n' +
        'Elle remplace la suppression complète de la PWA dans la plupart des cas.'
    );
    if (!confirmed) return;

    const progressSection = document.getElementById('import-progress-section');
    const statusMessage = document.getElementById('import-status-message') || document.getElementById('offline-status');
    const progressBar = document.getElementById('import-progress-bar');
    const setProgress = async (message, percent) => {
        if (progressSection) progressSection.style.display = 'block';
        if (progressBar && typeof percent === 'number') progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        if (statusMessage) statusMessage.textContent = message;
        await new Promise(resolve => setTimeout(resolve, 60));
    };

    try {
        isZipImportRunning = false;
        try { sessionStorage.removeItem('npfZipImportRunning'); } catch (_) {}

        await setProgress('Réinitialisation profonde : suspension carte offline...', 5);
        try {
            mapSourceMode = 'online';
            localStorage.setItem(MAP_SOURCE_MODE_KEY, 'online');
            offlineTilesMode = false;
            activeOfflinePacks = [];
            localStorage.setItem(OFFLINE_TILES_ENABLED_KEY, 'false');
            localStorage.setItem(OFFLINE_ACTIVE_PACKS_KEY, JSON.stringify([]));
            localStorage.setItem(OFFLINE_ACTIVE_PACK_DATABASES_KEY, JSON.stringify([]));
            localStorage.setItem(OFFLINE_ONLINE_FALLBACK_KEY, 'false');
            localStorage.removeItem('installedMapPacks');
            notifyServiceWorkerOfflineTilesPreference(false);
            notifyServiceWorkerOfflineOnlineFallback(false);
            notifyServiceWorkerActivePacks([]);
        } catch (_) {}

        try {
            if (map && baseTileLayer) {
                map.removeLayer(baseTileLayer);
                baseTileLayer = null;
            }
        } catch (_) {}

        await setProgress('Fermeture service worker / IndexedDB...', 18);
        try {
            await postServiceWorkerMessageWithAck({ type: 'OFFLINE_FACTORY_RESET' }, 'OFFLINE_IMPORT_READY', 2500);
        } catch (_) {}

        try {
            if (db) db.close();
        } catch (_) {}
        db = null;

        await setProgress('Nettoyage caches de tuiles...', 35);
        try { await clearTileCaches(); } catch (_) {}

        await setProgress('Service worker conservé pour le mode hors ligne...', 48);
        /*
         * v13.71 — on ne désinscrit plus le service worker pendant le reset.
         * La désinscription v13.70 nettoyait parfois trop bien : la PWA pouvait
         * repartir sans contrôleur SW, donc les tuiles offline n'étaient plus
         * servies. On ferme seulement sa connexion IndexedDB via OFFLINE_FACTORY_RESET.
         */
        await new Promise(resolve => setTimeout(resolve, 600));

        await setProgress('Suppression bases offline...', 62);
        const dbNames = await getNpfOfflineDatabaseNamesForReset();
        const results = [];
        for (const name of dbNames) {
            const result = await deleteIndexedDatabaseWithTimeoutForNpf(name, 3200);
            results.push(result);
        }
        const blockedOrTimedOut = results.filter(r => r && (r.status === 'blocked' || r.status === 'timeout'));

        try {
            localStorage.removeItem('installedMapPacks');
            localStorage.removeItem(OFFLINE_ACTIVE_PACKS_KEY);
            localStorage.removeItem(OFFLINE_ACTIVE_PACK_DATABASES_KEY);
            localStorage.removeItem(OFFLINE_ACTIVE_PACK_ALIASES_KEY);
            localStorage.setItem(OFFLINE_TILES_ENABLED_KEY, 'false');
            localStorage.setItem(MAP_SOURCE_MODE_KEY, 'online');
            localStorage.setItem('npfOfflineDeepResetAt', String(Date.now()));
        } catch (_) {}

        await setProgress(blockedOrTimedOut.length
            ? 'Reset profond terminé avec bases verrouillées ignorées. Rechargement sur base neuve...'
            : 'Reset profond terminé. Rechargement sur base neuve...', 100);

        try {
            await ensureServiceWorkerControlsPageForOffline();
        } catch (_) {}

        setTimeout(() => {
            const refreshUrl = new URL(window.location.href);
            refreshUrl.searchParams.set('appv', APP_VERSION);
            refreshUrl.searchParams.set('resetdb', Date.now().toString());
            refreshUrl.searchParams.set('swkeep', '1');
            window.location.replace(refreshUrl.toString());
        }, 900);
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (statusMessage) statusMessage.textContent = `Réinitialisation profonde impossible : ${message}`;
        alert(`Réinitialisation profonde impossible : ${message}\n\nDernier recours : supprimer la PWA puis la réinstaller.`);
    }
};


window.deleteMapGroup = async function(groupName) {
    const packNames = getInstalledPackNamesForGroup(groupName);
    if (!packNames.length) {
        alert(`Aucun pack trouvé pour ${groupName}.`);
        displayInstalledMaps();
        return;
    }

    /*
     * v17.46 — carte à base séparée : suppression de la base entière en une
     * seule opération (et plus tuile par tuile), avec confirmation indiquant
     * le nom et la taille estimée. Si c'est la carte affichée, NPF-Q400 passe
     * d'abord sur une autre carte, sans relance.
     */
    const groupPacks = getInstalledMapPacksSafe().filter(pack => pack && getOfflinePackGroupName(pack.name) === groupName);
    const isolatedGroup = groupPacks.length > 0
        && groupPacks.every(pack => pack.dbName && String(pack.storageMode || '').startsWith('isolated'));
    if (isolatedGroup) {
        const label = getOfflineMapGroupDisplayName(groupName) || groupName;
        const sizeText = await describeOfflineMapGroupSize(groupName);
        const isActive = mapSourceMode === 'offline'
            && Array.isArray(activeOfflinePacks)
            && activeOfflinePacks.some(name => packNames.includes(name));
        const fallback = isActive ? pickFallbackOfflineMapGroup(groupName) : null;
        const lines = [
            `Supprimer la carte « ${label} » ?`,
            '',
            `${packNames.length} fichier(s) · ${sizeText}`,
            'Elle sera effacée en entier, en une seule opération.'
        ];
        if (isActive) {
            lines.push('', fallback
                ? `Elle est affichée : NPF-Q400 passera sur « ${getOfflineMapGroupDisplayName(fallback) || fallback} ».`
                : 'Elle est affichée : NPF-Q400 passera sur la carte en ligne.');
        }
        if (!confirm(lines.join('\n'))) return;

        const statusElement = document.getElementById('import-status-message') || document.getElementById('offline-status');
        const progressElement = document.getElementById('import-progress-section');
        if (progressElement) progressElement.style.display = 'block';
        if (statusElement) statusElement.textContent = `Suppression de « ${label} »…`;

        const result = await deleteOfflineMapGroupDatabase(groupName);
        const message = result && result.status === 'deleted'
            ? `Carte « ${label} » supprimée.`
            : `Carte « ${label} » retirée de la liste. Safari l'effacera au prochain lancement de NPF-Q400.`;
        if (statusElement) statusElement.textContent = message;
        if (progressElement) setTimeout(() => { progressElement.style.display = 'none'; }, 5000);
        try {
            showNpfInfoBanner(message, { kind: result && result.status === 'deleted' ? 'info' : 'error' });
        } catch (_) {}
        return;
    }

    if (shouldUseLogicalDeleteForOfflineGroup(groupName, packNames)) {
        if (!confirm(`Retirer "${groupName}" de l'application ?\n\nOpenStreet est très volumineux : la suppression physique des tuiles peut bloquer l'iPad.\nCette action désactive la carte et la retire de la liste installée.`)) {
            return;
        }

        const removedCount = removeInstalledOfflinePacksLogically(packNames);
        displayInstalledMaps();
        alert(`Carte "${groupName}" retirée (${removedCount} fichier(s)).\nLes anciennes tuiles pourront rester dans le stockage Safari jusqu'à un nettoyage système.`);
        return;
    }

    if (!confirm(`Supprimer définitivement la carte "${groupName}" (${packNames.length} fichier(s)) ?\nCette opération peut prendre du temps sur iPad.`)) {
        return;
    }

    const statusMessage = document.getElementById('import-status-message') || document.getElementById('offline-status');
    const progressSection = document.getElementById('import-progress-section');
    const progressBar = document.getElementById('import-progress-bar');

    if (progressSection) progressSection.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';

    try {
        await releaseOfflineDatabaseForHeavyOperation(`Suppression ${groupName}`);
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'OFFLINE_MASS_DELETE_START' });
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    } catch (_) {}

    let totalDeleted = 0;
    for (let i = 0; i < packNames.length; i += 1) {
        const packName = packNames[i];
        if (statusMessage) {
            statusMessage.textContent = `Suppression ${i + 1}/${packNames.length} : ${packName}...`;
        }
        if (progressBar) {
            progressBar.style.width = `${Math.round((i / packNames.length) * 100)}%`;
        }

        const deleted = await window.deleteMapPack(packName, {
            silent: true,
            noReload: true,
            alreadyConfirmed: true,
            onProgress: (deletedSoFar, mode, loops) => {
                if (statusMessage) {
                    statusMessage.textContent = `Suppression ${i + 1}/${packNames.length} : ${packName} — ${deletedSoFar} tuiles (${mode})`;
                }
                if (progressBar) {
                    const basePercent = (i / packNames.length) * 100;
                    const chunkPercent = Math.min(1, loops / 50) * (100 / packNames.length);
                    progressBar.style.width = `${Math.min(99, Math.round(basePercent + chunkPercent))}%`;
                }
            }
        });
        totalDeleted += Number(deleted || 0);

        await new Promise(resolve => setTimeout(resolve, 40));
    }

    if (progressBar) progressBar.style.width = '100%';

    if (activeOfflinePacks.some(name => packNames.includes(name))) {
        await persistSimpleActiveOfflinePacks([]);
    }

    displayInstalledMaps();

    if (statusMessage) {
        statusMessage.textContent = `Carte "${groupName}" supprimée : ${totalDeleted} tuile(s).`;
    }
    alert(`Carte "${groupName}" supprimée (${packNames.length} fichier(s), ${totalDeleted} tuile(s)).`);
};

window.deleteMapPack = async function(packName, options = {}) {
    if (!options.alreadyConfirmed && !options.silent) {
        if (!confirm(`Voulez-vous vraiment supprimer le pack de cartes "${packName}" ?\nCette opération peut prendre du temps.`)) {
            return 0;
        }
    }

    try {
        const deletedCount = await deleteTilesForPackName(packName, options.onProgress || null);

        if (!options.silent) {
            alert(`${deletedCount} tuiles du pack "${packName}" ont été supprimées.`);
        }

        let installedPacks = JSON.parse(localStorage.getItem('installedMapPacks') || '[]');
        installedPacks = installedPacks.filter(p => p.name !== packName);
        localStorage.setItem('installedMapPacks', JSON.stringify(installedPacks));

        if (Array.isArray(activeOfflinePacks) && activeOfflinePacks.includes(packName)) {
            await persistSimpleActiveOfflinePacks(activeOfflinePacks.filter(name => name !== packName));
            if (!options.noReload) {
                reloadAfterOfflinePackChange(`Pack ${packName} supprimé. Rechargement...`);
                return deletedCount;
            }
        }

        if (!options.noReload) displayInstalledMaps();
        return deletedCount;

    } catch (error) {
        alert(`Erreur lors de la suppression du pack : ${error.message || error}`);
        console.error("Erreur de suppression:", error);
        return 0;
    }
};

async function deleteTilesForPackName(packName, onProgress = null) {
    /*
     * v12.18 — suppression par getAllKeys + lots courts.
     *
     * v12.17 utilisait un curseur et s'arrêtait volontairement par chunk.
     * Sur Safari/iPadOS, cette méthode peut rester silencieuse au premier curseur
     * sur une très grosse IndexedDB.
     *
     * Nouvelle méthode :
     * - récupérer jusqu'à 500 clés du pack par l'index packName ;
     * - supprimer ces clés dans une transaction courte ;
     * - recommencer jusqu'à zéro clé ;
     * - fallback scan complet si l'index ne trouve rien.
     */
    if (!packName) return 0;
    const tileDbNameForDelete = getOfflinePackDatabaseName(packName);
    let targetDbForDelete = db;
    let closeTargetDbForDelete = false;
    if (tileDbNameForDelete && tileDbNameForDelete !== OFFLINE_DB_NAME) {
        targetDbForDelete = await openOfflineTileDatabaseByName(tileDbNameForDelete, 3);
        closeTargetDbForDelete = true;
    }
    if (!targetDbForDelete) return 0;

    const CHUNK_SIZE = 500;
    let totalDeleted = 0;
    const sleep = (delay = 0) => new Promise(resolve => setTimeout(resolve, delay));

    const getKeysByIndex = () => new Promise((resolve, reject) => {
        try {
            const tx = targetDbForDelete.transaction('tiles', 'readonly');
            const store = tx.objectStore('tiles');

            if (!(store.indexNames && store.indexNames.contains('packName')) || typeof store.index('packName').getAllKeys !== 'function') {
                resolve(null);
                return;
            }

            const req = store.index('packName').getAllKeys(IDBKeyRange.only(packName), CHUNK_SIZE);
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => reject(req.error || new Error('Erreur getAllKeys suppression'));
        } catch (error) {
            reject(error);
        }
    });

    const deleteKeys = (keys = []) => new Promise((resolve, reject) => {
        if (!keys.length) {
            resolve(0);
            return;
        }

        try {
            let tx;
            try {
                tx = targetDbForDelete.transaction('tiles', 'readwrite', { durability: 'relaxed' });
            } catch (_) {
                tx = targetDbForDelete.transaction('tiles', 'readwrite');
            }

            const store = tx.objectStore('tiles');
            keys.forEach(key => store.delete(key));

            tx.oncomplete = () => resolve(keys.length);
            tx.onerror = () => reject(tx.error || new Error('Erreur suppression clés'));
            tx.onabort = () => reject(tx.error || new Error('Transaction suppression annulée'));
        } catch (error) {
            reject(error);
        }
    });

    const scanAndDeleteChunk = () => new Promise((resolve, reject) => {
        try {
            let tx;
            try {
                tx = targetDbForDelete.transaction('tiles', 'readwrite', { durability: 'relaxed' });
            } catch (_) {
                tx = targetDbForDelete.transaction('tiles', 'readwrite');
            }

            const store = tx.objectStore('tiles');
            const req = store.openCursor();
            let deleted = 0;
            let reachedEnd = false;

            req.onsuccess = event => {
                const cursor = event.target.result;
                if (!cursor) {
                    reachedEnd = true;
                    return;
                }

                const value = cursor.value || {};
                const primaryKey = cursor.primaryKey || value.url || '';
                const shouldDelete = value.packName === packName
                    || String(primaryKey).endsWith(`::${packName}`)
                    || String(value.url || '').endsWith(`::${packName}`);

                if (shouldDelete) {
                    cursor.delete();
                    deleted += 1;
                }

                if (deleted >= CHUNK_SIZE) return;
                cursor.continue();
            };

            req.onerror = () => reject(req.error || new Error('Erreur scan suppression'));
            tx.oncomplete = () => resolve({ deleted, done: reachedEnd || deleted === 0 });
            tx.onerror = () => reject(tx.error || new Error('Erreur transaction scan suppression'));
            tx.onabort = () => reject(tx.error || new Error('Transaction scan suppression annulée'));
        } catch (error) {
            reject(error);
        }
    });

    let loops = 0;
    while (true) {
        loops += 1;

        const keys = await getKeysByIndex();
        if (keys === null) break;
        if (!keys.length) break;

        const deleted = await deleteKeys(keys);
        totalDeleted += deleted;

        if (typeof onProgress === 'function') {
            onProgress(totalDeleted, 'index-keys', loops);
        }

        await sleep(60);

        if (loops > 20000) {
            throw new Error(`Suppression interrompue par sécurité (${packName})`);
        }
    }

    if (totalDeleted === 0) {
        loops = 0;
        while (true) {
            loops += 1;
            const result = await scanAndDeleteChunk();
            totalDeleted += result.deleted || 0;

            if (typeof onProgress === 'function') {
                onProgress(totalDeleted, 'scan', loops);
            }

            await sleep(60);

            if (result.done) break;
            if (loops > 20000) {
                throw new Error(`Suppression scan interrompue par sécurité (${packName})`);
            }
        }
    }

    try { if (closeTargetDbForDelete && targetDbForDelete) targetDbForDelete.close(); } catch (_) {}
    return totalDeleted;
};

/*
 * v17.65 — Carte NPF-Q400 téléchargée depuis le serveur NPF-Q400 (VPS).
 * v17.66 — même fonctionnement pour quatre autres SECTIONS : Carte OACI
 * 1/500 000, Carte OACI, Calque Routier, Doc FdF (PDF, protégée par un code).
 *
 * Une section = un dossier sur le serveur, décrit par son manifeste ; les
 * morceaux sont lus à côté du manifeste. Deux formats :
 * - « tuiles » (npf-q400-tiles-v1, ~50 Mo) : cartes NPF-Q400 et OACI. Déroulé :
 *   confirmation -> manifeste -> place (place libre + ancienne version ; rien
 *   n'est effacé si la carte ne peut pas tenir) -> effacement de TOUTE
 *   l'ancienne version de la section, en une seule opération -> morceaux un
 *   par un (téléchargement, SHA-256, écriture des tuiles en lots de 40) ->
 *   comptage des tuiles -> la carte apparaît dans la liste.
 * - « fichier » (npf-q400-fichier-v1, ~5 Mo) : un ZIP coupé en morceaux,
 *   gardés au fur et à mesure (reprise), recollés puis vérifiés (SHA-256),
 *   puis installés comme l'import manuel. L'ancienne version de la section
 *   n'est remplacée qu'une fois la nouvelle complète et vérifiée.
 *
 * Les tuiles sont rangées comme celles de l'import manuel (même base, même
 * adresse logique). Tant qu'une section n'est pas complète et vérifiée, elle
 * n'est ni listée ni utilisée. Après une coupure ou une fermeture de l'app :
 * reprise au morceau en cours. La fenêtre Gestion des Cartes reste ouverte
 * pendant tout le téléchargement (v17.66).
 */
const NPF_SERVER_BASE_URL = 'https://vps-3c305ff2.vps.ovh.net/';
const NPF_SERVER_MAPS = {
    'npf-q400': {
        type: 'tuiles',
        nom: 'Carte NPF-Q400',
        manifestUrl: `${NPF_SERVER_BASE_URL}npf-q400/manifest.json`,
        format: 'npf-q400-tiles-v1',
        groupName: 'NPF_France',
        packName: 'NPF_France_00',
        stateKey: 'npfServerMapDownloadV1',
        logKey: 'npfServerMapDownloadLogV1',
        ui: 'npf-map-download',
        libelle: 'Télécharger la carte NPF-Q400',
        libelleReprise: 'Reprendre le téléchargement de la carte NPF-Q400',
        ancienne: 'l\'ancienne carte NPF-Q400',
        /* ‑ : trait d'union insécable, « NPF-Q400 » jamais coupé en fin de ligne. */
        confirmation: 'Carte de 2,7 Go : utilise le Wi-Fi. L\'ancienne carte NPF‑Q400 sera d\'abord effacée. Pas de carte hors ligne pendant le téléchargement.',
        estAncienGroupe: name => isNpfOfflinePackSelection([name])
    },
    'oaci-500000': {
        type: 'tuiles',
        nom: 'Carte OACI 1/500 000',
        manifestUrl: `${NPF_SERVER_BASE_URL}oaci-500000/manifest.json`,
        format: 'npf-q400-tiles-v1',
        groupName: 'OACI 1-500 000',
        packName: 'OACI 1-500 000_00',
        stateKey: 'npfServerSectionDownloadV1:oaci-500000',
        logKey: 'npfServerSectionLogV1:oaci-500000',
        ui: 'oaci500-download',
        libelle: 'Télécharger la carte OACI 1/500 000 (670 Mo)',
        libelleReprise: 'Reprendre le téléchargement de la carte OACI 1/500 000',
        ancienne: 'l\'ancienne Carte OACI 1/500 000',
        confirmation: 'Carte OACI 1/500 000 de 670 Mo : utilise le Wi-Fi. L\'ancienne Carte OACI 1/500 000 sera d\'abord effacée. Pas de Carte OACI 1/500 000 hors ligne pendant le téléchargement.',
        estAncienGroupe: name => isOaci500000GroupName(name)
    },
    'oaci': {
        type: 'tuiles',
        nom: 'Carte OACI',
        manifestUrl: `${NPF_SERVER_BASE_URL}oaci/manifest.json`,
        format: 'npf-q400-tiles-v1',
        groupName: 'OACI',
        /* Même nom que l'import manuel de OACI.zip : reconnu comme carte OACI (zoom 10 natif, affichage jusqu'au zoom 11). */
        packName: 'OACI',
        stateKey: 'npfServerSectionDownloadV1:oaci',
        logKey: 'npfServerSectionLogV1:oaci',
        ui: 'oaci-download',
        libelle: 'Télécharger la carte OACI (245 Mo)',
        libelleReprise: 'Reprendre le téléchargement de la carte OACI',
        ancienne: 'l\'ancienne Carte OACI',
        confirmation: 'Carte OACI de 245 Mo : utilise le Wi-Fi. L\'ancienne Carte OACI sera d\'abord effacée. Pas de Carte OACI hors ligne pendant le téléchargement.',
        /* « OACI » (OACI.zip) et l'ancienne « Carte OACI » ; jamais l'OACI 1/500 000. */
        estAncienGroupe: name => !isOaci500000GroupName(name) && /^(carte[\s_-]*)?oaci$/i.test(String(name || '').trim()),
        /* Contrôle par le contenu avant d'effacer (demande de Bastien, 09/10/2026) :
         * aucune tuile au-delà du zoom 10, ~3 347 tuiles, ~2 478 au zoom 10, zone
         * large au zoom 10 (l'OACI 1/500 000 : zoom 11, 2 160 au zoom 10). */
        controleContenu: { zoomMax: 10, tuiles: 3347, ecartTuiles: 0.15, z10: 2478, ecartZ10: 0.08, largeurZ10Min: 55 }
    },
    'calque-routier': {
        type: 'fichier',
        nom: 'Calque Routier',
        manifestUrl: `${NPF_SERVER_BASE_URL}calque-routier/manifest.json`,
        format: 'npf-q400-fichier-v1',
        stateKey: 'npfServerSectionDownloadV1:calque-routier',
        logKey: 'npfServerSectionLogV1:calque-routier',
        ui: 'routes-download',
        libelle: 'Télécharger le Calque Routier (23 Mo)',
        libelleReprise: 'Reprendre le téléchargement du Calque Routier',
        ancienne: 'l\'ancien Calque Routier',
        confirmation: 'Calque Routier de 23 Mo : utilise le Wi-Fi. L\'ancien Calque Routier sera remplacé en entier, seulement une fois le nouveau complet et vérifié.',
        /* Place une fois installé (routes + index par zone), mesurée sur desktop le 09/10/2026. */
        besoinOctets: 450 * 1024 * 1024
    },
    'doc-fdf': {
        type: 'fichier',
        protege: true,
        nom: 'Doc FdF Réduite / Carte Fréquences',
        manifestUrl: `${NPF_SERVER_BASE_URL}doc-fdf/manifest.json`,
        format: 'npf-q400-fichier-v1',
        stateKey: 'npfServerSectionDownloadV1:doc-fdf',
        logKey: 'npfServerSectionLogV1:doc-fdf',
        ui: 'docfdf-download',
        libelle: 'Télécharger Doc FdF Réduite / Carte Fréquences (23 Mo)',
        libelleReprise: 'Reprendre le téléchargement Doc FdF Réduite / Carte Fréquences',
        ancienne: 'les anciens PDF Doc FdF',
        confirmation: 'Doc FdF Réduite / Carte Fréquences, 23 Mo : utilise le Wi-Fi. Tous les PDF Doc FdF de l\'iPad (Carte Fréquences comprise) seront remplacés, seulement une fois les nouveaux complets et vérifiés.',
        besoinOctets: 160 * 1024 * 1024
    }
};
const NPF_SERVER_MAP_STATE_KEY = 'npfServerMapDownloadV1';
const NPF_SERVER_MAP_LOG_KEY = 'npfServerMapDownloadLogV1';
const NPF_SERVER_MAP_SPACE_FACTOR = 1.15;
const NPF_SERVER_MAP_SPACE_MARGIN_BYTES = 300 * 1024 * 1024;
const NPF_SERVER_MAP_STALL_TIMEOUT_MS = 30000;
const NPF_SERVER_MAP_RETRY_DELAYS_MS = [3000, 6000, 12000, 24000, 30000, 30000];
const NPF_SERVER_SECTION_CHUNK_CACHE = 'npf-section-telechargement-v1';
/* Code Doc FdF : saisi une fois, gardé sur cet iPad seulement ; jamais écrit au DIAG. */
const NPF_DOC_FDF_CODE_KEY = 'npfDocFdfCodeV1';
let npfServerMapDownloadRunning = false;
let npfServerSectionRunningId = '';
let npfServerMapWakeLock = null;

function getNpfServerSection(mapId) {
    const cfg = NPF_SERVER_MAPS[mapId];
    return cfg ? { id: mapId, ...cfg } : null;
}

function isOaci500000GroupName(name) {
    const simplified = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return /oaci/.test(simplified) && /1\s*[-_/:]\s*500[\s_.]*000/.test(simplified);
}

function readNpfServerMapState(cfg = getNpfServerSection('npf-q400')) {
    const state = readNpfJsonStorage(cfg.stateKey, null);
    return state && typeof state === 'object' && state.mapId ? state : null;
}

function writeNpfServerMapState(state, cfg = getNpfServerSection('npf-q400')) {
    if (state) writeNpfJsonStorage(cfg.stateKey, { ...state, updatedAt: Date.now() });
    else {
        try { localStorage.removeItem(cfg.stateKey); } catch (_) {}
    }
}

/* DIAG : événements et durées par morceau du dernier téléchargement de la section. */
function readNpfServerMapLog(cfg = getNpfServerSection('npf-q400')) {
    const log = readNpfJsonStorage(cfg.logKey, null);
    return log && typeof log === 'object' && Array.isArray(log.events) && Array.isArray(log.chunks)
        ? log
        : { events: [], chunks: [] };
}

function addNpfServerMapLogEvent(text, extra = {}, cfg = getNpfServerSection('npf-q400')) {
    const log = readNpfServerMapLog(cfg);
    log.events.push({ at: Date.now(), text: String(text || '').slice(0, 160), ...extra });
    while (log.events.length > 80) log.events.shift();
    writeNpfJsonStorage(cfg.logKey, log);
}

function setNpfServerMapLogChunk(entry, cfg = getNpfServerSection('npf-q400')) {
    const log = readNpfServerMapLog(cfg);
    const index = log.chunks.findIndex(item => item && item.i === entry.i);
    if (index >= 0) log.chunks[index] = { ...log.chunks[index], ...entry };
    else log.chunks.push(entry);
    log.chunks.sort((a, b) => a.i - b.i);
    writeNpfJsonStorage(cfg.logKey, log);
}

function setNpfServerMapLogInfo(info, cfg = getNpfServerSection('npf-q400')) {
    const log = readNpfServerMapLog(cfg);
    writeNpfJsonStorage(cfg.logKey, { ...log, ...info });
}

function npfServerMapWait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* Taille pour le DIAG : « 0 Mo » quand il n'y a rien (v17.66). */
function formatNpfServerMapBytes(bytes) {
    return Number(bytes) > 0 ? formatNpfStorageSizeForUser(bytes) : '0 Mo';
}

/* Écran allumé pendant le téléchargement (si Safari le permet). */
async function requestNpfServerMapWakeLock() {
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return 'indisponible';
    if (npfServerMapWakeLock && !npfServerMapWakeLock.released) return 'obtenu';
    try {
        npfServerMapWakeLock = await navigator.wakeLock.request('screen');
        return 'obtenu';
    } catch (error) {
        npfServerMapWakeLock = null;
        return `refusé (${error && (error.name || error.message) || 'erreur'})`;
    }
}

function releaseNpfServerMapWakeLock() {
    const sentinel = npfServerMapWakeLock;
    npfServerMapWakeLock = null;
    if (sentinel) sentinel.release().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
    if (!npfServerMapDownloadRunning) return;
    const cfg = getNpfServerSection(npfServerSectionRunningId);
    if (!cfg) return;
    if (document.visibilityState === 'visible') {
        requestNpfServerMapWakeLock().then(result => {
            addNpfServerMapLogEvent(`retour au premier plan — écran allumé : ${result}`, {}, cfg);
            setNpfServerMapLogInfo({ wakeLock: result }, cfg);
        });
    } else {
        addNpfServerMapLogEvent('app passée en arrière-plan', {}, cfg);
    }
});

function getNpfServerMapUi(cfg = getNpfServerSection('npf-q400')) {
    return {
        button: document.getElementById(`${cfg.ui}-button`),
        box: document.getElementById(`${cfg.ui}-progress`),
        bar: document.getElementById(`${cfg.ui}-progress-bar`),
        text: document.getElementById(`${cfg.ui}-progress-text`),
        advice: document.getElementById(`${cfg.ui}-advice`)
    };
}

function showNpfServerMapProgress(message, percent = null, { advice = true, error = false } = {}, cfg = getNpfServerSection(npfServerSectionRunningId || 'npf-q400')) {
    const ui = getNpfServerMapUi(cfg);
    if (!ui.box) return;
    ui.box.style.display = 'block';
    ui.box.classList.toggle('npf-map-download-error', !!error);
    if (ui.advice) ui.advice.style.display = advice ? 'block' : 'none';
    if (ui.bar && typeof percent === 'number') {
        ui.bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
    if (ui.text) ui.text.textContent = message;
}

/* Bouton de chaque section : « Télécharger… » ou « Reprendre… » si un téléchargement est inachevé. */
function refreshNpfServerMapDownloadButton(mapId = null) {
    if (!mapId) {
        Object.keys(NPF_SERVER_MAPS).forEach(id => refreshNpfServerMapDownloadButton(id));
        return;
    }
    const cfg = getNpfServerSection(mapId);
    const ui = getNpfServerMapUi(cfg);
    if (!ui.button) return;
    if (npfServerMapDownloadRunning) {
        ui.button.disabled = true;
        ui.button.textContent = npfServerSectionRunningId === mapId ? 'Téléchargement en cours…' : cfg.libelle;
        return;
    }
    ui.button.disabled = false;
    const state = readNpfServerMapState(cfg);
    if (state && state.status !== 'terminé') {
        ui.button.textContent = cfg.libelleReprise;
        const total = Number(state.total) || 0;
        const next = Math.min(total, (Number(state.next) || 0) + 1);
        const percent = Number(state.totalOctets) > 0
            ? Math.floor((Number(state.doneOctets) || 0) / Number(state.totalOctets) * 100)
            : 0;
        const absent = cfg.type === 'tuiles'
            ? `Pas de ${cfg.nom} hors ligne tant qu'il n'est pas terminé.`
            : `${cfg.nom} : la version déjà installée reste utilisée tant qu'il n'est pas terminé.`;
        showNpfServerMapProgress(
            cfg.id === 'npf-q400'
                ? `Téléchargement interrompu au morceau ${next} sur ${total} (${percent} %). Pas de carte NPF-Q400 hors ligne tant qu'il n'est pas terminé.`
                : `Téléchargement interrompu au morceau ${next} sur ${total} (${percent} %). ${absent}`,
            percent,
            { advice: false, error: true },
            cfg
        );
    } else {
        ui.button.textContent = cfg.libelle;
    }
}

/* --- Doc FdF : code de téléchargement ------------------------------------ */

function readNpfDocFdfCode() {
    try { return localStorage.getItem(NPF_DOC_FDF_CODE_KEY) || ''; } catch (_) { return ''; }
}

function forgetNpfDocFdfCode() {
    try { localStorage.removeItem(NPF_DOC_FDF_CODE_KEY); } catch (_) {}
}

function buildNpfServerAuthHeaders(cfg, code) {
    if (!cfg.protege || !code) return {};
    const bytes = new TextEncoder().encode(`npf-q400:${code}`);
    let binary = '';
    bytes.forEach(value => { binary += String.fromCharCode(value); });
    return { Authorization: `Basic ${btoa(binary)}` };
}

/* Fenêtre interne de saisie du code (Annuler / Continuer). Renvoie le code ou null. */
function npfAskDocFdfCode(message) {
    return new Promise(resolve => {
        let overlay = document.getElementById('npf-code-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'npf-code-modal';
            overlay.className = 'npf-confirm-modal';
            overlay.innerHTML = `
                <div class="npf-confirm-card" role="dialog" aria-modal="true" aria-labelledby="npf-code-title">
                    <div id="npf-code-title" class="npf-confirm-title">Code Doc FdF</div>
                    <div class="npf-confirm-message"></div>
                    <input type="password" class="npf-code-input" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Code Doc FdF" aria-label="Code Doc FdF">
                    <div class="npf-confirm-actions">
                        <button type="button" class="npf-confirm-cancel">Annuler</button>
                        <button type="button" class="npf-confirm-ok">Continuer</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
        }
        const input = overlay.querySelector('.npf-code-input');
        overlay.querySelector('.npf-confirm-message').textContent = String(message || '');
        input.value = '';
        const done = value => {
            overlay.style.display = 'none';
            input.value = '';
            overlay.querySelector('.npf-confirm-ok').onclick = null;
            overlay.querySelector('.npf-confirm-cancel').onclick = null;
            input.onkeydown = null;
            overlay.onclick = null;
            resolve(value);
        };
        overlay.querySelector('.npf-confirm-ok').onclick = event => {
            event.stopPropagation();
            const value = String(input.value || '').trim();
            done(value || null);
        };
        overlay.querySelector('.npf-confirm-cancel').onclick = event => { event.stopPropagation(); done(null); };
        input.onkeydown = event => { if (event.key === 'Enter') overlay.querySelector('.npf-confirm-ok').click(); };
        overlay.onclick = event => { if (event.target === overlay) done(null); };
        overlay.style.display = 'flex';
        setTimeout(() => { try { input.focus(); } catch (_) {} }, 60);
    });
}

/* --- Effacement de l'ancienne version (sections « tuiles ») ---------------- */

/* Zooms d'une base de tuiles, sans lire les images (clés de l'index tileUrl). */
function inspectNpfOfflineDatabaseZooms(dbName, timeoutMs = 20000) {
    return new Promise(resolve => {
        let done = false;
        let openedDb = null;
        const finish = value => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { if (openedDb) openedDb.close(); } catch (_) {}
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        try {
            const request = indexedDB.open(dbName);
            request.onupgradeneeded = () => { try { request.transaction.abort(); } catch (_) {} finish(null); };
            request.onerror = () => finish(null);
            request.onsuccess = () => {
                openedDb = request.result;
                try {
                    const store = openedDb.transaction('tiles', 'readonly').objectStore('tiles');
                    if (!store.indexNames.contains('tileUrl')) { finish(null); return; }
                    const result = { total: 0, parZoom: {}, z10MinX: Infinity, z10MaxX: -Infinity };
                    const cursorRequest = store.index('tileUrl').openKeyCursor();
                    cursorRequest.onsuccess = () => {
                        const cursor = cursorRequest.result;
                        if (!cursor) { finish(result); return; }
                        const match = String(cursor.key || '').match(/\/(\d+)\/(\d+)\/(\d+)\.(png|jpe?g)/i);
                        if (match) {
                            const zoom = Number(match[1]);
                            result.total += 1;
                            result.parZoom[zoom] = (result.parZoom[zoom] || 0) + 1;
                            if (zoom === 10) {
                                result.z10MinX = Math.min(result.z10MinX, Number(match[2]));
                                result.z10MaxX = Math.max(result.z10MaxX, Number(match[2]));
                            }
                        }
                        cursor.continue();
                    };
                    cursorRequest.onerror = () => finish(null);
                } catch (_) {
                    finish(null);
                }
            };
        } catch (_) {
            finish(null);
        }
    });
}

/* Groupes installés de la section : à effacer, ou gardés (avec la raison). */
async function findNpfServerSectionOldGroups(cfg) {
    const aEffacer = [];
    const gardes = [];
    const groups = groupInstalledMapPacks(getInstalledMapPacksSafe());
    for (const group of groups) {
        const groupName = String(group.name || '');
        if (!groupName || !cfg.estAncienGroupe(groupName)) continue;
        const packs = group.packs || [];
        const isolated = packs.length > 0
            && packs.every(pack => pack.dbName && String(pack.storageMode || '').startsWith('isolated'));
        const sizeBytes = packs.reduce((total, pack) => total + (Number(pack.sizeBytes) > 0 ? Number(pack.sizeBytes) * NPF_SERVER_MAP_SPACE_FACTOR : 0), 0);
        const controle = cfg.controleContenu;
        if (controle) {
            if (!isolated) {
                gardes.push({ groupName, raison: 'ancienne base commune : contenu impossible à contrôler' });
                continue;
            }
            const dbName = packs[0].dbName || getOfflineMapDatabaseNameForGroup(groupName);
            const zooms = await inspectNpfOfflineDatabaseZooms(dbName);
            if (!zooms) {
                gardes.push({ groupName, raison: 'contenu illisible' });
                continue;
            }
            const zoomMax = Math.max(-1, ...Object.keys(zooms.parZoom).map(Number));
            const z10 = Number(zooms.parZoom[10]) || 0;
            const largeur = zooms.z10MaxX >= zooms.z10MinX ? zooms.z10MaxX - zooms.z10MinX : 0;
            const resume = `${zooms.total} tuiles, zooms ${Object.keys(zooms.parZoom).sort((a, b) => a - b).join('-') || '—'}, ${z10} au zoom 10`;
            let raison = '';
            if (zoomMax > controle.zoomMax) raison = `zoom ${zoomMax} présent (OACI 1/500 000 ?)`;
            else if (Math.abs(zooms.total - controle.tuiles) > controle.tuiles * controle.ecartTuiles) raison = 'nombre de tuiles trop différent';
            else if (Math.abs(z10 - controle.z10) > controle.z10 * controle.ecartZ10) raison = 'nombre de tuiles du zoom 10 trop différent';
            else if (largeur < controle.largeurZ10Min) raison = 'zone couverte trop petite';
            if (raison) {
                gardes.push({ groupName, raison: `${raison} — ${resume}` });
                continue;
            }
            aEffacer.push({ groupName, isolated, sizeBytes, controle: resume });
            continue;
        }
        aEffacer.push({ groupName, isolated, sizeBytes });
    }
    return { aEffacer, gardes };
}

/* Effacement de toute l'ancienne version de la section (et seulement elle), en une seule opération.
 * La fenêtre Gestion des Cartes reste ouverte (v17.66). */
async function deleteNpfServerSectionOldGroups(cfg, aEffacer) {
    const results = [];
    for (const item of aEffacer) {
        if (item.isolated) {
            const result = await deleteOfflineMapGroupDatabase(item.groupName, { keepModalOpen: true });
            results.push({ groupName: item.groupName, dbName: result.dbName, status: result.status || 'inconnu' });
        } else {
            const packNames = getInstalledMapPacksSafe()
                .filter(pack => pack && getOfflinePackGroupName(pack.name) === item.groupName)
                .map(pack => pack.name);
            removeInstalledOfflinePacksLogically(packNames);
            results.push({ groupName: item.groupName, dbName: '', status: 'retirée de la liste (ancienne base commune)' });
        }
    }
    /* Base cible restée d'un import ou d'un téléchargement inachevé. */
    const targetDbName = getOfflineMapDatabaseNameForGroup(cfg.groupName);
    if (!results.some(item => item.dbName === targetDbName)
        && await doesNpfIndexedDatabaseExist(targetDbName) !== false) {
        const result = await deleteIndexedDatabaseWithTimeoutForNpf(targetDbName, 15000);
        results.push({ groupName: cfg.groupName, dbName: targetDbName, status: result.status });
        if (result.status !== 'deleted') addPendingOfflineDatabaseDeletion(targetDbName);
    }
    const progress = readNpfJsonStorage(NPF_OFFLINE_IMPORT_PROGRESS_KEY, null);
    if (progress && progress.dbName === targetDbName) {
        try { localStorage.removeItem(NPF_OFFLINE_IMPORT_PROGRESS_KEY); } catch (_) {}
    }
    try { displayInstalledMaps(); } catch (_) {}
    try { refreshQuickOfflineMapButtonState(); } catch (_) {}
    return results;
}

/* --- Réseau ------------------------------------------------------------------ */

async function fetchNpfServerMapManifest(cfg, code = '') {
    const response = await fetch(`${cfg.manifestUrl}?t=${Date.now()}`, { cache: 'no-store', headers: buildNpfServerAuthHeaders(cfg, code) });
    if (response.status === 401) {
        const error = new Error('code refusé');
        error.codeRefuse = true;
        throw error;
    }
    if (!response.ok) throw new Error(`serveur : code ${response.status}`);
    const manifest = await response.json();
    const okTuiles = cfg.type !== 'tuiles' || Number(manifest.totalTuiles) > 0;
    const okFichier = cfg.type !== 'fichier' || (manifest.fichier && manifest.fichier.sha256 && Number(manifest.nombreFichiers) > 0);
    if (!manifest || manifest.format !== cfg.format
        || !Array.isArray(manifest.morceaux) || !manifest.morceaux.length
        || !(Number(manifest.totalOctets) > 0) || !okTuiles || !okFichier) {
        throw new Error('manifeste illisible');
    }
    return manifest;
}

/* Un morceau entier en mémoire ; arrêt si plus rien n'arrive pendant 30 s. */
async function fetchNpfServerMapChunk(url, expectedBytes, onBytes, headers = {}) {
    const controller = new AbortController();
    let stallTimer = null;
    const arm = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => controller.abort(), NPF_SERVER_MAP_STALL_TIMEOUT_MS);
    };
    arm();
    try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal, headers });
        if (response.status === 401) {
            const error = new Error('code refusé');
            error.codeRefuse = true;
            throw error;
        }
        if (!response.ok) throw new Error(`serveur : code ${response.status}`);
        const bytes = new Uint8Array(expectedBytes);
        let received = 0;
        if (!response.body || typeof response.body.getReader !== 'function') {
            const whole = new Uint8Array(await response.arrayBuffer());
            if (whole.length !== expectedBytes) throw new Error(`morceau incomplet (${whole.length} / ${expectedBytes} octets)`);
            bytes.set(whole);
            onBytes(expectedBytes);
            return bytes.buffer;
        }
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            arm();
            if (received + value.length > expectedBytes) throw new Error('morceau plus gros que prévu');
            bytes.set(value, received);
            received += value.length;
            onBytes(received);
        }
        if (received !== expectedBytes) throw new Error(`morceau incomplet (${received} / ${expectedBytes} octets)`);
        return bytes.buffer;
    } catch (error) {
        if (controller.signal.aborted) throw new Error(`plus rien reçu depuis ${NPF_SERVER_MAP_STALL_TIMEOUT_MS / 1000} s`);
        throw error;
    } finally {
        clearTimeout(stallTimer);
    }
}

async function sha256HexForNpfServerMap(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}

/* En-tête d'un morceau de tuiles : « NPFQ400T », longueur (uint32 LE), JSON {v, tuiles}. */
function parseNpfServerMapChunk(buffer) {
    const view = new DataView(buffer);
    const magic = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, 8));
    if (magic !== 'NPFQ400T') throw new Error('morceau illisible (signature)');
    const headerLength = view.getUint32(8, true);
    const header = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buffer, 12, headerLength)));
    if (!header || header.v !== 1 || !Array.isArray(header.tuiles)) throw new Error('morceau illisible (en-tête)');
    return { dataStart: 12 + headerLength, tiles: header.tuiles };
}

function putNpfServerMapTileBatch(tileDb, records, timeoutMs = 22000) {
    return new Promise((resolve, reject) => {
        let transaction;
        try {
            transaction = tileDb.transaction('tiles', 'readwrite', { durability: 'relaxed' });
        } catch (_) {
            transaction = tileDb.transaction('tiles', 'readwrite');
        }
        let finished = false;
        const finish = (callback, value) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            callback(value);
        };
        const timer = setTimeout(() => {
            try { transaction.abort(); } catch (_) {}
            finish(reject, new Error(`écriture bloquée plus de ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs);
        try {
            const store = transaction.objectStore('tiles');
            records.forEach(record => store.put(record));
        } catch (error) {
            try { transaction.abort(); } catch (_) {}
            finish(reject, error);
            return;
        }
        transaction.oncomplete = () => finish(resolve);
        transaction.onerror = () => finish(reject, transaction.error || new Error('erreur d\'écriture'));
        transaction.onabort = () => finish(reject, transaction.error || new Error('écriture annulée'));
    });
}

/* Écriture des tuiles d'un morceau, lots de 40 ; chaque image est copiée
 * (slice) pour ne pas garder le morceau entier en mémoire. */
async function writeNpfServerMapChunkTiles(context, buffer, parsed, onTiles) {
    const { mapConfig } = context;
    const batchSize = NPF_OFFLINE_RAW_IMPORT_MAX_BATCH;
    let written = 0;
    for (let start = 0; start < parsed.tiles.length; start += batchSize) {
        const records = parsed.tiles.slice(start, start + batchSize).map(([tilePath, offset, length]) => {
            const begin = parsed.dataStart + Number(offset);
            const tileUrl = buildOfflineTileUrlForPack(String(tilePath), mapConfig.packName);
            return {
                url: buildStoredTileKey(tileUrl, mapConfig.packName),
                tileUrl,
                tile: buffer.slice(begin, begin + Number(length)),
                packName: mapConfig.packName
            };
        });
        try {
            await putNpfServerMapTileBatch(context.tileDb, records);
        } catch (error) {
            /* Comme l'import manuel : base rouverte, même lot en petits lots. */
            addNpfServerMapLogEvent(`écriture : nouvel essai en petits lots (${error && error.message || error})`, {}, mapConfig);
            try { context.tileDb.close(); } catch (_) {}
            await npfServerMapWait(180);
            context.tileDb = await openOfflineTileDatabaseByName(context.dbName, 3);
            for (let i = 0; i < records.length; i += 12) {
                await putNpfServerMapTileBatch(context.tileDb, records.slice(i, i + 12), 18000);
            }
        }
        written += records.length;
        onTiles(written);
        await npfServerMapWait(4);
    }
}

/* Morceaux d'une section « fichier » : gardés dans un cache dédié jusqu'au recollage. */
function buildNpfServerSectionChunkRequest(cfg, fileName) {
    return new Request(`./__npf_section__/${encodeURIComponent(cfg.id)}/${encodeURIComponent(fileName)}`);
}

async function clearNpfServerSectionChunks(cfg) {
    try {
        const cache = await caches.open(NPF_SERVER_SECTION_CHUNK_CACHE);
        const keys = await cache.keys();
        const prefix = `/__npf_section__/${encodeURIComponent(cfg.id)}/`;
        await Promise.all(keys.filter(request => new URL(request.url).pathname.includes(prefix)).map(request => cache.delete(request)));
    } catch (_) {}
}

function formatNpfServerMapPercent(state, chunkBytes, fraction) {
    const total = Number(state.totalOctets) || 1;
    const value = ((Number(state.doneOctets) || 0) + chunkBytes * fraction) / total * 100;
    return Math.min(99, Math.floor(value));
}

/* Un morceau. Tuiles : téléchargement (60 % de sa part), écriture des tuiles (40 %).
 * Fichier : téléchargement (90 %), mise de côté (10 %). */
async function downloadAndStoreNpfServerMapChunk(context, index) {
    const { state, manifest, mapConfig: cfg } = context;
    const chunk = manifest.morceaux[index];
    const total = manifest.morceaux.length;
    const label = `morceau ${index + 1} sur ${total}`;
    const url = new URL(chunk.fichier, cfg.manifestUrl).toString();
    const octets = Number(chunk.octets);
    const downloadShare = cfg.type === 'tuiles' ? 0.6 : 0.9;
    let lastUi = 0;
    for (let attempt = 1; ; attempt += 1) {
        const startedAt = Date.now();
        try {
            showNpfServerMapProgress(`${formatNpfServerMapPercent(state, octets, 0)} % — ${label} — téléchargement…`, null, {}, cfg);
            const buffer = await fetchNpfServerMapChunk(url, octets, received => {
                const now = Date.now();
                if (now - lastUi < 250) return;
                lastUi = now;
                const percent = formatNpfServerMapPercent(state, octets, downloadShare * received / octets);
                showNpfServerMapProgress(`${percent} % — ${label} — téléchargement…`, percent, {}, cfg);
            }, buildNpfServerAuthHeaders(cfg, context.code));
            const downloadMs = Date.now() - startedAt;
            const hash = await sha256HexForNpfServerMap(buffer);
            if (hash !== String(chunk.sha256)) throw new Error('empreinte différente (morceau abîmé)');
            const writeStartedAt = Date.now();
            if (cfg.type === 'tuiles') {
                const parsed = parseNpfServerMapChunk(buffer);
                if (parsed.tiles.length !== Number(chunk.tuiles)) throw new Error('nombre de tuiles différent');
                await writeNpfServerMapChunkTiles(context, buffer, parsed, written => {
                    const now = Date.now();
                    if (now - lastUi < 250 && written < parsed.tiles.length) return;
                    lastUi = now;
                    const percent = formatNpfServerMapPercent(state, octets, 0.6 + 0.4 * written / parsed.tiles.length);
                    showNpfServerMapProgress(`${percent} % — ${label} — écriture des tuiles…`, percent, {}, cfg);
                });
                setNpfServerMapLogChunk({
                    i: index + 1, octets, tuiles: parsed.tiles.length,
                    dlMs: downloadMs, wMs: Date.now() - writeStartedAt, essais: attempt, at: Date.now()
                }, cfg);
            } else {
                const cache = await caches.open(NPF_SERVER_SECTION_CHUNK_CACHE);
                await cache.put(buildNpfServerSectionChunkRequest(cfg, chunk.fichier), new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } }));
                setNpfServerMapLogChunk({
                    i: index + 1, octets, tuiles: 0,
                    dlMs: downloadMs, wMs: Date.now() - writeStartedAt, essais: attempt, at: Date.now()
                }, cfg);
            }
            return;
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            addNpfServerMapLogEvent(`erreur ${label}, essai ${attempt} : ${message}`, {}, cfg);
            if (error && error.codeRefuse) throw error;
            if (/QuotaExceeded|quota/i.test(`${error && error.name} ${message}`)) {
                throw new Error('place insuffisante sur l\'appareil pendant l\'écriture');
            }
            const delay = NPF_SERVER_MAP_RETRY_DELAYS_MS[attempt - 1];
            if (delay === undefined) throw new Error(`${label} : ${message}`);
            showNpfServerMapProgress(
                `${formatNpfServerMapPercent(state, octets, 0)} % — ${label} — réseau coupé ou lent, nouvel essai dans ${Math.round(delay / 1000)} s…`,
                null, { error: true }, cfg
            );
            await npfServerMapWait(delay);
            addNpfServerMapLogEvent(`reprise du ${label} (essai ${attempt + 1})`, {}, cfg);
        }
    }
}

/* --- Installation des sections « fichier » --------------------------------- */

async function assembleNpfServerSectionFile(cfg, manifest) {
    const cache = await caches.open(NPF_SERVER_SECTION_CHUNK_CACHE);
    const parts = [];
    for (const chunk of manifest.morceaux) {
        const response = await cache.match(buildNpfServerSectionChunkRequest(cfg, chunk.fichier));
        if (!response) throw new Error(`morceau ${chunk.fichier} introuvable sur l'appareil`);
        parts.push(await response.blob());
    }
    const blob = new Blob(parts, { type: 'application/zip' });
    if (blob.size !== Number(manifest.fichier.octets)) throw new Error('fichier recollé : taille différente');
    const hash = await sha256HexForNpfServerMap(await blob.arrayBuffer());
    if (hash !== String(manifest.fichier.sha256)) throw new Error('fichier recollé : empreinte différente');
    return blob;
}

/* Calque Routier : import manuel existant, puis contrôle du nombre de parties. */
async function installNpfServerRoadOverlay(cfg, manifest, blob) {
    const attendues = (manifest.contenu || []).filter(item => (
        /\.(geojson|json)$/i.test(String(item.nom || ''))
        && !/(^|\/)(manifest|index)\.json$/i.test(String(item.nom || ''))
    )).length;
    await importRoadOverlayFile(new File([blob], manifest.fichier.nom || 'calque-routier.zip', { type: 'application/zip' }));
    const installees = getRoadOverlayManifest().parts.length;
    if (installees !== attendues) throw new Error(`vérification : ${installees} parties installées au lieu de ${attendues}`);
    return `${installees} parties`;
}

/* Doc FdF : tous les PDF de la section remplacés en une seule opération
 * (comme l'import manuel pour les noms ; anciens PDF effacés dans la même transaction). */
async function installNpfServerDocFdf(cfg, manifest, blob) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip non chargé');
    const zip = await JSZip.loadAsync(blob);
    const entries = Object.values(zip.files || {}).filter(entry => !entry.dir && /\.pdf$/i.test(entry.name));
    const records = [];
    for (const entry of entries) {
        const name = entry.name.split('/').pop();
        const oaci = normalizeAirportPdfOaciFromFilename(name);
        if (!oaci) throw new Error(`PDF au nom inattendu : ${name}`);
        const data = await entry.async('blob');
        records.push({
            oaci,
            filename: oaci === FDF_REDUCED_PDF_KEY ? FDF_REDUCED_PDF_FILENAME : (oaci === OPS_FREQUENCIES_PDF_KEY ? OPS_FREQUENCIES_PDF_FILENAME : `${oaci}.pdf`),
            blob: new Blob([data], { type: 'application/pdf' }),
            size: data.size || 0,
            updatedAt: Date.now()
        });
    }
    if (records.length !== Number(manifest.nombreFichiers)) throw new Error(`${records.length} PDF au lieu de ${manifest.nombreFichiers}`);
    const pdfDb = await initAirportPdfDB();
    await new Promise((resolve, reject) => {
        const tx = pdfDb.transaction(AIRPORT_PDF_STORE_NAME, 'readwrite');
        const store = tx.objectStore(AIRPORT_PDF_STORE_NAME);
        store.clear();
        records.forEach(record => store.put(record));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('écriture des PDF impossible'));
        tx.onabort = () => reject(tx.error || new Error('écriture des PDF annulée'));
    });
    const installed = await getInstalledAirportPdfRecords();
    if (installed.length !== records.length) throw new Error(`vérification : ${installed.length} PDF au lieu de ${records.length}`);
    try { displayInstalledAirportPdfs(); } catch (_) {}
    return `${installed.length} PDF`;
}

async function getNpfServerSectionOldBytes(cfg) {
    if (cfg.id === 'doc-fdf') {
        try {
            const records = await getInstalledAirportPdfRecords();
            return records.reduce((total, record) => total + (Number(record.size) || 0), 0);
        } catch (_) {
            return 0;
        }
    }
    return 0;
}

async function estimateNpfServerMapFreeBytes() {
    try {
        const estimate = navigator.storage && typeof navigator.storage.estimate === 'function'
            ? await navigator.storage.estimate()
            : null;
        return estimate && Number.isFinite(Number(estimate.quota)) && Number.isFinite(Number(estimate.usage))
            ? Number(estimate.quota) - Number(estimate.usage)
            : null;
    } catch (_) {
        return null;
    }
}

/* --- Déroulé commun ------------------------------------------------------------ */

async function runNpfServerMapDownload(mapId) {
    const cfg = getNpfServerSection(mapId);
    if (!cfg) return;
    if (npfServerMapDownloadRunning) return;
    if (isZipImportRunning) {
        alert(`Un import est déjà en cours. Attends la fin avant de télécharger ${cfg.nom}.`);
        return;
    }
    const targetDbName = cfg.type === 'tuiles' ? getOfflineMapDatabaseNameForGroup(cfg.groupName) : '';
    let state = readNpfServerMapState(cfg);
    const resuming = !!(state && state.mapId === mapId && state.status !== 'terminé');

    if (resuming) {
        const nomReprise = cfg.id === 'npf-q400' ? 'la carte NPF‑Q400' : cfg.nom;
        const ok = await npfConfirmInApp([
            `Reprendre le téléchargement de ${nomReprise} au morceau ${(Number(state.next) || 0) + 1} sur ${state.total} ?`,
            'Utilise le Wi-Fi.'
        ].join('\n\n'));
        if (!ok) return;
    } else {
        const ok = await npfConfirmInApp(cfg.confirmation);
        if (!ok) return;
    }

    npfServerMapDownloadRunning = true;
    npfServerSectionRunningId = mapId;
    isZipImportRunning = true;
    refreshNpfServerMapDownloadButton();
    const context = { mapConfig: cfg, dbName: targetDbName, tileDb: null, state: null, manifest: null, code: '' };
    try {
        /* Doc FdF : le code est vérifié par le serveur AVANT tout effacement. */
        let manifest = null;
        let message = '';
        let code = cfg.protege ? readNpfDocFdfCode() : '';
        for (let essai = 0; essai < 5 && !manifest; essai += 1) {
            if (cfg.protege && !code) {
                addNpfServerMapLogEvent(essai ? 'code refusé : nouvelle saisie demandée' : 'code Doc FdF demandé (aucun code mémorisé)', {}, cfg);
                code = await npfAskDocFdfCode(essai
                    ? 'Code refusé. Saisis à nouveau le code de téléchargement Doc FdF.'
                    : 'Saisis le code de téléchargement Doc FdF. Il est demandé une seule fois sur cet iPad.');
                if (!code) {
                    showNpfServerMapProgress('Téléchargement annulé : aucun code saisi. Rien n\'a été effacé.', null, { advice: false, error: true }, cfg);
                    addNpfServerMapLogEvent('annulé : aucun code saisi', {}, cfg);
                    return;
                }
            }
            showNpfServerMapProgress(cfg.id === 'npf-q400' ? 'Lecture du manifeste de la carte…' : 'Lecture du manifeste…', resuming ? null : 0, { error: false }, cfg);
            try {
                manifest = await fetchNpfServerMapManifest(cfg, code);
            } catch (error) {
                if (error && error.codeRefuse) {
                    forgetNpfDocFdfCode();
                    code = '';
                    addNpfServerMapLogEvent('code refusé par le serveur (401)', {}, cfg);
                    continue;
                }
                message = error && error.message ? error.message : String(error);
                break;
            }
        }
        if (!manifest) {
            if (!message) message = 'code refusé';
            addNpfServerMapLogEvent(resuming ? `reprise impossible, serveur injoignable : ${message}` : `serveur injoignable avant tout effacement : ${message}`, {}, cfg);
            showNpfServerMapProgress(
                resuming
                    ? `${cfg.id === 'npf-q400' ? 'Serveur de la carte injoignable' : 'Serveur injoignable'} (${message}). Vérifie le Wi-Fi puis appuie sur « Reprendre ».`
                    : `${cfg.id === 'npf-q400' ? 'Serveur de la carte injoignable' : 'Serveur injoignable'} (${message}). Rien n'a été effacé.`,
                null, { advice: false, error: true }, cfg
            );
            return;
        }
        if (cfg.protege) {
            try { localStorage.setItem(NPF_DOC_FDF_CODE_KEY, code); } catch (_) {}
            context.code = code;
            setNpfServerMapLogInfo({ codeMemorise: 'oui' }, cfg);
        }

        if (resuming && (state.creeLe !== manifest.creeLe || Number(state.total) !== manifest.morceaux.length)) {
            addNpfServerMapLogEvent('le contenu du serveur a changé depuis le début : téléchargement repris depuis le début', {}, cfg);
            state = null;
        }
        if (resuming && state && cfg.type === 'tuiles' && Number(state.next) > 0 && await doesNpfIndexedDatabaseExist(targetDbName) === false) {
            addNpfServerMapLogEvent('base de la carte introuvable : téléchargement repris depuis le début', {}, cfg);
            state = null;
        }

        if (!state) {
            const previousOffline = mapSourceMode === 'offline' || !!offlineTilesMode;
            writeNpfJsonStorage(cfg.logKey, {
                mapId, version: APP_VERSION, startedAt: Date.now(),
                versionCarte: manifest.versionCarte || manifest.versionContenu,
                creeLe: manifest.creeLe, total: manifest.morceaux.length, events: [], chunks: [],
                codeMemorise: cfg.protege ? 'oui' : undefined
            });
            addNpfServerMapLogEvent(cfg.type === 'tuiles'
                ? `début : ${manifest.morceaux.length} morceaux, ${formatNpfStorageSizeForUser(manifest.totalOctets)}, ${manifest.totalTuiles} tuiles (carte ${manifest.versionCarte || '?'})`
                : `début : ${manifest.morceaux.length} morceaux, ${formatNpfStorageSizeForUser(manifest.totalOctets)}, ${manifest.nombreFichiers} fichiers (version ${manifest.versionContenu || '?'})`, {}, cfg);

            /* Place vérifiée AVANT tout effacement : place libre + place de
             * l'ancienne version de la section. Pas assez : rien n'est effacé. */
            let oldGroups = { aEffacer: [], gardes: [] };
            let oldBytes = 0;
            /* v17.67 — DIAG : « taille inconnue » quand une ancienne version existe sans taille connue. */
            let oldUnknown = false;
            let needed = 0;
            if (cfg.type === 'tuiles') {
                oldGroups = await findNpfServerSectionOldGroups(cfg);
                oldGroups.gardes.forEach(item => addNpfServerMapLogEvent(`gardée (pas effacée) : ${item.groupName} — ${item.raison}`, {}, cfg));
                oldGroups.aEffacer.filter(item => item.controle).forEach(item => addNpfServerMapLogEvent(`contrôle du contenu : ${item.groupName} — ${item.controle} — ancienne version reconnue`, {}, cfg));
                oldBytes = oldGroups.aEffacer.reduce((total, item) => total + item.sizeBytes, 0);
                oldUnknown = oldGroups.aEffacer.some(item => !(item.sizeBytes > 0));
                needed = Math.round(Number(manifest.totalOctets) * NPF_SERVER_MAP_SPACE_FACTOR + NPF_SERVER_MAP_SPACE_MARGIN_BYTES);
            } else {
                oldBytes = await getNpfServerSectionOldBytes(cfg);
                oldUnknown = cfg.id === 'calque-routier' && getRoadOverlayManifest().parts.length > 0;
                needed = Math.round(cfg.besoinOctets);
            }
            const free = await estimateNpfServerMapFreeBytes();
            addNpfServerMapLogEvent(`place avant effacement : ${free === null ? 'inconnue (le navigateur ne la donne pas)' : `${formatNpfStorageSizeForUser(free)} libres`} + ${oldUnknown ? `taille inconnue pour ${cfg.ancienne}` : `${formatNpfServerMapBytes(oldBytes)} occupés par ${cfg.ancienne}`}, ${formatNpfStorageSizeForUser(needed)} nécessaires`, {}, cfg);
            if (free !== null && free + oldBytes < needed) {
                const oldText = oldBytes > 0 ? ` + ${formatNpfStorageSizeForUser(oldBytes)} libérés par ${cfg.ancienne}` : '';
                showNpfServerMapProgress(
                    `Place insuffisante : ${formatNpfStorageSizeForUser(free)} disponibles${oldText}, ${formatNpfStorageSizeForUser(needed)} nécessaires. Rien n'a été effacé ni téléchargé. Libère de la place sur l'iPad puis réessaie.`,
                    0, { advice: false, error: true }, cfg
                );
                addNpfServerMapLogEvent('arrêt : place insuffisante, rien effacé ni téléchargé', {}, cfg);
                return;
            }

            if (cfg.type === 'tuiles') {
                showNpfServerMapProgress(`Effacement de ${cfg.ancienne}…`, 0, {}, cfg);
                const deletions = await deleteNpfServerSectionOldGroups(cfg, oldGroups.aEffacer);
                const statusText = { deleted: 'effacée', blocked: 'bloquée par Safari (effacée au prochain lancement)', timeout: 'effacement trop long (effacée au prochain lancement)' };
                addNpfServerMapLogEvent(`effacement : ${deletions.length ? deletions.map(item => `${item.groupName} ${statusText[item.status] || item.status}`).join(', ') : (cfg.id === 'npf-q400' ? 'aucune carte NPF-Q400 installée' : 'aucune ancienne version installée')}`, {}, cfg);
                if (deletions.some(item => item.dbName === targetDbName && item.status !== 'deleted')) {
                    showNpfServerMapProgress(`${cfg.ancienne.charAt(0).toUpperCase()}${cfg.ancienne.slice(1)} a été retirée de la liste, mais Safari ne l'a pas encore effacée. Relance NPF-Q400 puis appuie de nouveau sur « ${cfg.libelle} ».`, null, { advice: false, error: true }, cfg);
                    return;
                }
                const freeAfter = await estimateNpfServerMapFreeBytes();
                addNpfServerMapLogEvent(`place après effacement : ${freeAfter === null ? 'inconnue' : `${formatNpfStorageSizeForUser(freeAfter)} libres`}`, {}, cfg);
            } else {
                await clearNpfServerSectionChunks(cfg);
            }

            state = {
                mapId, status: 'en cours', creeLe: manifest.creeLe,
                versionCarte: manifest.versionCarte || manifest.versionContenu,
                total: manifest.morceaux.length, totalOctets: Number(manifest.totalOctets),
                totalTuiles: Number(manifest.totalTuiles) || 0, next: 0, doneOctets: 0,
                dbName: targetDbName, previousOffline, startedAt: Date.now()
            };
            writeNpfServerMapState(state, cfg);
        } else {
            addNpfServerMapLogEvent(`reprise au morceau ${Number(state.next) + 1} sur ${state.total}`, {}, cfg);
        }

        const wakeLock = await requestNpfServerMapWakeLock();
        addNpfServerMapLogEvent(`écran allumé (Screen Wake Lock) : ${wakeLock}`, {}, cfg);
        setNpfServerMapLogInfo({ wakeLock }, cfg);

        context.state = state;
        context.manifest = manifest;
        state.status = 'en cours';
        writeNpfServerMapState(state, cfg);
        if (cfg.type === 'tuiles') context.tileDb = await openOfflineTileDatabaseByName(targetDbName, 3);
        for (let index = Number(state.next) || 0; index < manifest.morceaux.length; index += 1) {
            await downloadAndStoreNpfServerMapChunk(context, index);
            state.next = index + 1;
            state.doneOctets = (Number(state.doneOctets) || 0) + Number(manifest.morceaux[index].octets);
            writeNpfServerMapState(state, cfg);
        }

        if (cfg.type === 'fichier') {
            showNpfServerMapProgress('99 % — vérification et installation…', 99, {}, cfg);
            const blob = await assembleNpfServerSectionFile(cfg, manifest);
            const detail = cfg.id === 'doc-fdf'
                ? await installNpfServerDocFdf(cfg, manifest, blob)
                : await installNpfServerRoadOverlay(cfg, manifest, blob);
            await clearNpfServerSectionChunks(cfg);
            const minutes = Math.max(1, Math.round((Date.now() - Number(state.startedAt || Date.now())) / 60000));
            addNpfServerMapLogEvent(`terminé et vérifié : ${detail}, ${minutes} min depuis le début`, {}, cfg);
            writeNpfServerMapState(null, cfg);
            releaseNpfServerMapWakeLock();
            showNpfServerMapProgress(`100 % — ${cfg.nom} installé et vérifié (${detail}).`, 100, { advice: false }, cfg);
            return;
        }

        try { context.tileDb.close(); } catch (_) {}
        context.tileDb = null;

        showNpfServerMapProgress('99 % — vérification de la carte…', 99, {}, cfg);
        const count = await countTilesInOfflineDatabase(targetDbName, 120000);
        if (count !== Number(manifest.totalTuiles)) {
            addNpfServerMapLogEvent(`vérification ÉCHOUÉE : ${count === null ? 'comptage impossible' : count} tuiles au lieu de ${manifest.totalTuiles}`, {}, cfg);
            writeNpfServerMapState(null, cfg);
            showNpfServerMapProgress(`Vérification échouée (${count === null ? 'comptage impossible' : `${count} tuiles au lieu de ${manifest.totalTuiles}`}). La carte n'est pas utilisable : appuie de nouveau sur « ${cfg.libelle} ».`, null, { advice: false, error: true }, cfg);
            return;
        }

        const installed = getInstalledMapPacksSafe()
            .filter(pack => pack && getOfflinePackGroupName(pack.name) !== cfg.groupName);
        installed.push({
            name: cfg.packName,
            /* Même nom que le fichier : le lecteur en déduit la même base (comme l'import manuel). */
            sourceName: cfg.packName,
            date: new Date().toLocaleDateString(),
            groupName: cfg.groupName,
            dbName: targetDbName,
            storageMode: 'isolated-v13.73',
            tileFormat: NPF_OFFLINE_TILE_FORMAT_RAW,
            sizeBytes: Number(manifest.totalOctets) || null,
            origin: 'serveur',
            versionCarte: manifest.versionCarte || null,
            serverCreeLe: manifest.creeLe
        });
        localStorage.setItem('installedMapPacks', JSON.stringify(installed));
        await persistSimpleActiveOfflinePacks([cfg.packName]);
        mapSourceMode = state.previousOffline ? 'offline' : 'online';
        localStorage.setItem(MAP_SOURCE_MODE_KEY, mapSourceMode);
        await setOfflineTilesEnabled(!!state.previousOffline);
        notifyServiceWorkerActivePacks(activeOfflinePacks);

        const minutes = Math.max(1, Math.round((Date.now() - Number(state.startedAt || Date.now())) / 60000));
        addNpfServerMapLogEvent(`terminé et vérifié : ${count} tuiles, ${minutes} min depuis le début`, {}, cfg);
        writeNpfServerMapState(null, cfg);
        releaseNpfServerMapWakeLock();
        showNpfServerMapProgress(`100 % — ${cfg.nom} installée et vérifiée (${count.toLocaleString('fr-FR')} tuiles).`, 100, { advice: false }, cfg);
        npfServerMapDownloadRunning = false;
        npfServerSectionRunningId = '';
        isZipImportRunning = false;
        reloadAfterOfflinePackChange(`${cfg.nom} installée. Rechargement de la carte…`);
    } catch (error) {
        const message = error && error.codeRefuse
            ? 'code refusé par le serveur (il a peut-être changé) ; il sera redemandé'
            : (error && error.message ? error.message : String(error));
        if (error && error.codeRefuse) forgetNpfDocFdfCode();
        addNpfServerMapLogEvent(`arrêt : ${message}`, {}, cfg);
        const current = readNpfServerMapState(cfg);
        if (current) writeNpfServerMapState({ ...current, status: 'interrompu' }, cfg);
        showNpfServerMapProgress(`Téléchargement arrêté : ${message}. Appuie sur « ${cfg.libelleReprise} » (reprise au morceau en cours).`, null, { advice: false, error: true }, cfg);
    } finally {
        try { if (context.tileDb) context.tileDb.close(); } catch (_) {}
        if (npfServerMapDownloadRunning) {
            npfServerMapDownloadRunning = false;
            npfServerSectionRunningId = '';
            isZipImportRunning = false;
            releaseNpfServerMapWakeLock();
            const ui = getNpfServerMapUi(cfg);
            const message = ui.text ? ui.text.textContent : '';
            const isError = ui.box ? ui.box.classList.contains('npf-map-download-error') : false;
            refreshNpfServerMapDownloadButton();
            if (ui.text && message) ui.text.textContent = message;
            if (ui.box) ui.box.classList.toggle('npf-map-download-error', isError);
        }
    }
}

function initNpfServerMapDownloadUi() {
    Object.keys(NPF_SERVER_MAPS).forEach(mapId => {
        const cfg = getNpfServerSection(mapId);
        const ui = getNpfServerMapUi(cfg);
        if (!ui.button || ui.button.dataset.bound === '1') return;
        ui.button.dataset.bound = '1';
        ui.button.addEventListener('click', () => { runNpfServerMapDownload(mapId); });
        /* Téléchargement en cours au moment d'une fermeture ou d'un rechargement de l'app. */
        const state = readNpfServerMapState(cfg);
        if (state && state.status === 'en cours') {
            addNpfServerMapLogEvent(`interrompu (fermeture ou rechargement de l'app) au morceau ${(Number(state.next) || 0) + 1} sur ${state.total}`, {}, cfg);
            writeNpfServerMapState({ ...state, status: 'interrompu' }, cfg);
        }
    });
    refreshNpfServerMapDownloadButton();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNpfServerMapDownloadUi, { once: true });
} else {
    initNpfServerMapDownloadUi();
}
