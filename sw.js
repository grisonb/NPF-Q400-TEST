const SW_VERSION = 'sw-v16-59_glr_fuel_zoom_serial';
const APP_VERSION = 'v16.59';
const SIA_DATA_REVISION = '15.69';
const SIA_DATA_URL = './sia.js';
const SIA_DATA_CACHE = `npf-q400-sia-data-${SIA_DATA_REVISION}`;

const DB_NAME = 'OfflineTilesDB_v13_70_clean';
const LEGACY_TILE_DB_NAME = DB_NAME;
const DB_VERSION = 3;

const OFFLINE_TILES_ENABLED_KEY = 'offlineTilesEnabled';
const OFFLINE_ONLINE_FALLBACK_KEY = 'offlineOnlineFallback';
const OFFLINE_ACTIVE_PACKS_KEY = 'offlineActivePacks';
const OFFLINE_ACTIVE_PACK_DATABASES_KEY = 'offlineActivePackDatabases';
const OFFLINE_ACTIVE_PACK_ALIASES_KEY = 'offlineActivePackAliases';
const OFFLINE_MAP_DATABASE_PREFIX = 'OfflineMap_';

const APP_SHELL_CACHE = `npf-q400-app-shell-${SW_VERSION}`;
const APP_DATA_CACHE = 'npf-q400-app-data-v1';
const APP_SHELL_CACHE_PREFIX = 'npf-q400-app-shell-';
const DEPARTMENTS_GEOJSON_URL = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/departements-1000m.geojson';
const COMMUNES_GEOJSON_1000M_URL = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/communes-1000m.geojson';
const COMMUNES_GEOJSON_1000M_GZIP_URL = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/communes-1000m.geojson.gz';
const COMMUNES_GEOJSON_100M_URL = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/communes-100m.geojson';
const COMMUNES_GEOJSON_50M_URL = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/communes-50m.geojson';
const COMMUNES_GEOJSON_URLS = Object.freeze([
    COMMUNES_GEOJSON_1000M_GZIP_URL,
    COMMUNES_GEOJSON_1000M_URL,
    COMMUNES_GEOJSON_100M_URL,
    COMMUNES_GEOJSON_50M_URL
]);
const LOCAL_COMMUNES_GEOJSON_URL = './data/communes-500m.geojson';
const HIGH_VOLTAGE_LINES_GEOJSON_URL = './lignes_ht_rte_simplifiees.geojson';

/*
 * v14.64 — app-shell minimal et atomique.
 * Seules les ressources indispensables à l'ouverture de l'interface bloquent
 * l'installation. Les bases volumineuses et ressources métier sont mises en
 * cache séparément, à la demande, et ne peuvent plus faire échouer le SW.
 */
const CORE_APP_SHELL_URLS = [
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './leaflet.css',
    './leaflet.min.js',
    './suncalc.js',
    './jszip.min.js'
];

const APP_DATA_URLS = [
    './communes.json',
    './communes_aliases.json',
    './data/localites/localites-france-v14.56.zip',
    LOCAL_COMMUNES_GEOJSON_URL,
    HIGH_VOLTAGE_LINES_GEOJSON_URL,
    DEPARTMENTS_GEOJSON_URL,
    ...COMMUNES_GEOJSON_URLS,
    './icons/safesky-traffic-monochrome.png',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/apple-touch-icon.png',
    './icons/maskable-icon-512x512.png',
    './icons/bloc-fuel-shortcut-icon.png',
    './icons/calculator-fms-icon.png',
    './icons/search-commune-icon.png',
    './icons/center-gps-icon.png'
];

const APP_SHELL_URLS = [...CORE_APP_SHELL_URLS, ...APP_DATA_URLS];



/*
 * IMPORTANT :
 * - pas de cache agressif de index.html / script.js ;
 * - pas de suppression des caches de tuiles ;
 * - service worker conservé pour Push + offline tiles ;
 * - lecture tuiles optimisée IndexedDB, sans boucle Cache Storage à chaque tuile.
 */

let offlineTilesEnabled = false;
let offlineOnlineFallback = false;
let activeOfflinePacks = [];
let activeOfflinePackDatabases = [];
let activeOfflinePackAliases = [];
let offlineConfigurationMessageAt = 0;

let dbPromise = null;
const tileDbPromises = new Map();
let offlineSettingsLoadedAt = 0;

const SETTINGS_REFRESH_INTERVAL_MS = 5000;
const OFFLINE_MESSAGE_AUTHORITY_MS = 120000;
const MEMORY_TILE_CACHE_MAX = 160;
const memoryTileCache = new Map();

const VERSION_SENSITIVE_CORE_FILES = new Set([
    'index.html',
    'script.js',
    'style.css',
    'manifest.json'
]);

function getAppShellFilename(url) {
    try {
        return new URL(url, self.location.href).pathname.split('/').pop() || '';
    } catch (_) {
        return '';
    }
}

function buildVersionedAppShellUrl(url, attempt = 0) {
    const parsed = new URL(url, self.location.href);
    parsed.searchParams.set('appv', APP_VERSION);
    parsed.searchParams.set('swinstall', SW_VERSION);
    if (attempt > 0) {
        parsed.searchParams.set('swtry', `${attempt}-${Date.now()}`);
    }
    return parsed.toString();
}

async function fetchForAppShell(url, timeoutMs = 12000, attempt = 0) {
    const request = new Request(buildVersionedAppShellUrl(url, attempt), {
        cache: 'reload',
        mode: url === DEPARTMENTS_GEOJSON_URL ? 'cors' : 'same-origin'
    });
    return await swFetchWithTimeout(request, {}, timeoutMs);
}

async function validateVersionSensitiveCoreResponse(url, response) {
    const filename = getAppShellFilename(url);
    if (!VERSION_SENSITIVE_CORE_FILES.has(filename)) return true;
    if (!response || !response.ok) return false;

    try {
        const text = await response.clone().text();
        if (filename === 'index.html') {
            return text.includes(`const APP_VERSION = '${APP_VERSION}'`)
                && text.includes(`sia.js?siav=${SIA_DATA_REVISION}`)
                && text.includes(`script.js?appv=${APP_VERSION}`)
                && text.includes(`style.css?appv=${APP_VERSION}`);
        }
        if (filename === 'script.js') {
            return text.includes(`const NPF_SCRIPT_BUILD_VERSION = '${APP_VERSION}'`);
        }
        if (filename === 'style.css') {
            return text.includes(`NPF_STYLE_BUILD_VERSION: ${APP_VERSION}`);
        }
        if (filename === 'manifest.json') {
            const manifest = JSON.parse(text);
            return String(manifest.start_url || '').includes(`appv=${APP_VERSION}`);
        }
    } catch (_) {
        return false;
    }
    return false;
}

/*
 * v15.21 — GitHub Pages peut propager index/script/style/manifest sur quelques
 * secondes. Un seul fichier ancien ne doit plus condamner immédiatement
 * l'installation du nouveau Service Worker. Les fichiers versionnés sont donc
 * relus plusieurs fois avec une URL anti-cache différente avant abandon.
 */
async function fetchValidatedVersionSensitiveCoreSetForInstall(urls) {
    const pending = new Set(urls);
    const responses = new Map();
    const maxAttempts = 8;

    for (let attempt = 1; attempt <= maxAttempts && pending.size; attempt += 1) {
        const batch = [...pending];
        const results = await Promise.all(batch.map(async url => {
            try {
                const response = await fetchForAppShell(url, 6500, attempt);
                const valid = response && response.ok
                    && await validateVersionSensitiveCoreResponse(url, response);
                return { url, response: valid ? response : null };
            } catch (_) {
                return { url, response: null };
            }
        }));

        for (const result of results) {
            if (!result.response) continue;
            responses.set(result.url, result.response);
            pending.delete(result.url);
        }

        if (pending.size && attempt < maxAttempts) {
            await swDelay(1200);
        }
    }

    return { responses, missing: [...pending] };
}

async function notifyClientsOfSwInstallStage(stage, detail = '') {
    try {
        const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });
        clients.forEach(client => {
            try {
                client.postMessage({
                    type: 'NPF_SW_INSTALL_STAGE',
                    stage: String(stage || ''),
                    detail: String(detail || ''),
                    appVersion: APP_VERSION,
                    swVersion: SW_VERSION,
                    at: Date.now()
                });
            } catch (_) {}
        });
    } catch (_) {}
}

async function copyExistingCachedAsset(url, targetCache) {
    try {
        const filename = getAppShellFilename(url);
        if (VERSION_SENSITIVE_CORE_FILES.has(filename)) return false;
        const existing = await caches.match(url, { ignoreSearch: true });
        if (!existing) return false;
        await targetCache.put(url, existing.clone());
        return true;
    } catch (_) {
        return false;
    }
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const installStartedAt = Date.now();
        await notifyClientsOfSwInstallStage('start', APP_VERSION);

        await caches.delete(APP_SHELL_CACHE).catch(() => false);
        const cache = await caches.open(APP_SHELL_CACHE);
        const failedCoreUrls = [];

        const versionSensitiveUrls = CORE_APP_SHELL_URLS.filter(url => (
            VERSION_SENSITIVE_CORE_FILES.has(getAppShellFilename(url))
        ));
        const stableCoreUrls = CORE_APP_SHELL_URLS.filter(url => (
            !VERSION_SENSITIVE_CORE_FILES.has(getAppShellFilename(url))
        ));

        /*
         * v16.44 — les fichiers sensibles sont validés en parallèle à chaque
         * tentative. Cela évite quatre chaînes de retry séquentielles pendant
         * la propagation GitHub Pages.
         */
        const sensitiveResult = await fetchValidatedVersionSensitiveCoreSetForInstall(
            versionSensitiveUrls
        );
        for (const url of versionSensitiveUrls) {
            const response = sensitiveResult.responses.get(url);
            if (!response) {
                failedCoreUrls.push(url);
                continue;
            }
            try {
                await cache.put(url, response.clone());
            } catch (_) {
                failedCoreUrls.push(url);
            }
        }

        /*
         * Bibliothèques statiques : réutiliser d'abord le shell déjà validé.
         * Aucun téléchargement n'est lancé à chaque changement de version si
         * Leaflet / SunCalc / JSZip sont déjà disponibles hors ligne.
         */
        await Promise.all(stableCoreUrls.map(async url => {
            let stored = await copyExistingCachedAsset(url, cache);
            if (!stored) {
                try {
                    const response = await fetchForAppShell(url, 8000, 1);
                    if (response && response.ok) {
                        await cache.put(url, response.clone());
                        stored = true;
                    }
                } catch (_) {}
            }
            if (!stored) failedCoreUrls.push(url);
        }));

        if (failedCoreUrls.length) {
            await caches.delete(APP_SHELL_CACHE).catch(() => false);
            await notifyClientsOfSwInstallStage(
                'refused',
                failedCoreUrls.join(', ')
            );
            throw new Error(
                `[SW ${APP_VERSION}] Installation atomique refusée, app-shell `
                + `incomplet ou incohérent: ${failedCoreUrls.join(', ')}`
            );
        }

        /*
         * v16.44 — aucune opération SIA ni APP_DATA pendant `install`.
         * - sia.js reste dans le cache indépendant de révision 15.69 ;
         * - les données communes/HT/icônes restent dans APP_DATA_CACHE ;
         * - les handlers fetch les servent cache-first et les régénèrent à la
         *   demande si nécessaire.
         * Les bases IndexedDB de cartes Offline ne sont jamais touchées.
         */
        await notifyClientsOfSwInstallStage(
            'shell-ready',
            `${Date.now() - installStartedAt} ms`
        );
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        const previousShells = cacheNames.filter(
            name => name.startsWith(APP_SHELL_CACHE_PREFIX)
                && name !== APP_SHELL_CACHE
        );

        /*
         * Conserver le shell précédent comme secours. Les shells plus anciens
         * sont supprimés ; le cache stable des données n'est jamais touché.
         */
        const shellsToDelete = previousShells.slice(0, Math.max(0, previousShells.length - 1));
        await Promise.all(shellsToDelete.map(name => caches.delete(name)));

        /*
         * L'ouverture de la grande base IndexedDB ne doit jamais retenir le
         * service worker dans l'état « activating ». Safari peut conserver une
         * transaction de cartes ouverte plusieurs secondes après fermeture.
         */
        await Promise.race([
            refreshOfflineSettingsFromDB({ force: true }).catch(() => null),
            swDelay(1500, null)
        ]);
        await self.clients.claim();

        /*
         * v16.32 — transition de version à rechargement unique.
         * Le service worker prend seulement le contrôle des clients. Il ne les
         * navigue plus lui-même : la page écoute `controllerchange` et effectue
         * l'unique rechargement contrôlé. Cela supprime la concurrence
         * client.navigate() + window.location.replace() observée sur iPadOS.
         * Les bases IndexedDB et les cartes Offline ne sont jamais modifiées ici.
         */
    })());
});


async function closeOfflineDBForHeavyWrite() {
    /*
     * v12.17 — libère la connexion IndexedDB du service worker avant gros import/suppression.
     * Safari/iPadOS ralentit fortement si le SW garde une connexion de lecture
     * pendant que la page écrit ou supprime massivement.
     */
    memoryTileCache.clear();
    offlineSettingsLoadedAt = 0;

    try {
        if (dbPromise) {
            const db = await dbPromise.catch(() => null);
            if (db && typeof db.close === 'function') db.close();
        }
    } catch (_) {}

    dbPromise = null;

    try {
        for (const promise of tileDbPromises.values()) {
            const tileDb = await promise.catch(() => null);
            if (tileDb && typeof tileDb.close === 'function') tileDb.close();
        }
    } catch (_) {}
    tileDbPromises.clear();
}


self.addEventListener('message', event => {
    const data = event.data || {};

    if (data.type === 'GET_SW_VERSION') {
        try {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    type: 'SW_VERSION',
                    version: APP_VERSION,
                    swVersion: SW_VERSION
                });
            }
        } catch (_) {}
        return;
    }

    if (data.type === 'VERIFY_APP_SHELL') {
        const verify = async () => {
            const missing = [];
            const currentShellCache = await caches.open(APP_SHELL_CACHE);
            for (const url of CORE_APP_SHELL_URLS) {
                const response = await currentShellCache.match(url, { ignoreSearch: true });
                if (!response) missing.push(url);
            }
            try {
                if (event.ports && event.ports[0]) {
                    event.ports[0].postMessage({
                        type: 'APP_SHELL_STATUS',
                        ok: missing.length === 0,
                        version: APP_VERSION,
                        missing
                    });
                }
            } catch (_) {}
        };
        if (event.waitUntil) event.waitUntil(verify());
        else verify();
        return;
    }

    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }

    if (data.type === 'OFFLINE_IMPORT_START' || data.type === 'OFFLINE_MASS_DELETE_START' || data.type === 'OFFLINE_FACTORY_RESET') {
        activeOfflinePacks = [];
        activeOfflinePackDatabases = [];
        activeOfflinePackAliases = [];
        offlineTilesEnabled = false;
        offlineSettingsLoadedAt = Date.now();

        const acknowledgeHeavyWriteReady = async () => {
            /*
             * v13.72 — import ZIP iPad : accusé de réception réel.
             * La page attend cette réponse avant de commencer à écrire dans IndexedDB.
             * Cela évite que le service worker garde encore une connexion/lecture active
             * au moment du premier lot d'écriture, blocage constaté vers 171/22387.
             */
            await closeOfflineDBForHeavyWrite();
            try {
                if (event.ports && event.ports[0]) {
                    event.ports[0].postMessage({ type: 'OFFLINE_IMPORT_READY' });
                }
            } catch (_) {}
        };

        if (event.waitUntil) {
            event.waitUntil(acknowledgeHeavyWriteReady());
        } else {
            acknowledgeHeavyWriteReady();
        }
        return;
    }

    if (data.type === 'OFFLINE_TILES_ENABLED_CHANGED') {
        offlineTilesEnabled = !!data.value;
        offlineSettingsLoadedAt = Date.now();
        return;
    }

    if (data.type === 'OFFLINE_ONLINE_FALLBACK_CHANGED') {
        offlineOnlineFallback = !!data.value;
        offlineSettingsLoadedAt = Date.now();
        return;
    }

    if (data.type === 'OFFLINE_ACTIVE_PACKS_CHANGED') {
        activeOfflinePacks = Array.isArray(data.value)
            ? data.value.filter(Boolean)
            : [];
        activeOfflinePackDatabases =
            Array.isArray(data.dbNames)
                ? data.dbNames.filter(Boolean)
                : [];
        activeOfflinePackAliases =
            Array.isArray(data.aliases)
                ? data.aliases.filter(Boolean)
                : [];

        offlineSettingsLoadedAt = Date.now();
        offlineConfigurationMessageAt = Date.now();
        memoryTileCache.clear();

        try {
            if (event.ports && event.ports[0]) {
                event.ports[0].postMessage({
                    type:
                        'OFFLINE_ACTIVE_PACKS_READY'
                });
            }
        } catch (_) {}
        return;
    }
});


async function swFetchWithTimeout(input, init = {}, timeoutMs = 3500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function swDelay(ms, value = null) {
    return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

async function swFetchFallbackToCache(request, timeoutMs = 8000) {
    try {
        return await swFetchWithTimeout(request, {}, timeoutMs);
    } catch (_) {
        return await caches.match(request, { ignoreSearch: true }) || new Response('', { status: 504, statusText: 'Offline asset unavailable' });
    }
}

self.addEventListener('fetch', event => {
    const request = event.request;

    if (request.method !== 'GET') return;

    // v15.16 — FdS / GAAR : ne pas appeler respondWith() pour la chaîne réseau
    // de mise à jour. Safari/iPad affichait sinon « FetchEvent.respondWith ...
    // TypeError: Load failed » quand une navigation/fetch externe échouait.
    // Sans respondWith, le navigateur effectue sa requête réseau normalement et
    // script.js gère les erreurs dans le bandeau du lecteur.
    if (isBriefingDocsNasRequest(request.url) || isBriefingDocsSourceRequest(request.url) || isGlobalLinkNasRequest(request.url)) {
        return;
    }

 // v14.93 — le dépôt VAC GitHub Pages reste une source réseau pure.
 // Les PDF sont ensuite conservés par script.js dans IndexedDB, pas dans Cache Storage.
    if (isVacRepositoryRequest(request.url)) {
        event.respondWith(fetch(request));
        return;
    }

    if (isTrafficApiRequest(request.url)) {
        event.respondWith(fetch(request));
        return;
    }

    if (isOpenStreetMapTileRequest(request.url)) {
        event.respondWith(handleTileRequest(request));
        return;
    }

    if (isSiaDataRequest(request)) {
        event.respondWith(handleSiaDataRequest(request));
        return;
    }

    if (isAppDataRequest(request)) {
        event.respondWith(handleAppDataRequest(request));
        return;
    }

    if (isAppShellRequest(request)) {
        event.respondWith(handleAppShellRequest(request));
        return;
    }

    event.respondWith(swFetchFallbackToCache(request, 8000));
});




function isGlobalLinkNasRequest(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'grisonb.synology.me'
            && parsed.pathname === '/briefing-api/npf-global-link-api.php';
    } catch (_) {
        return false;
    }
}

function isBriefingDocsNasRequest(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'grisonb.synology.me'
            && parsed.pathname === '/briefing-api/npf-docs-api.php';
    } catch (_) {
        return false;
    }
}

function isBriefingDocsSourceRequest(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'script.google.com' || parsed.hostname === 'script.googleusercontent.com') {
            return true;
        }
        return parsed.hostname === 'grisonb.synology.me'
            && parsed.pathname === '/briefing-api/request-gaar-import.php';
    } catch (_) {
        return false;
    }
}


function isVacRepositoryRequest(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'grisonb.github.io'
            && parsed.pathname.startsWith('/NPF-Q400-VAC/');
    } catch (_) {
        return false;
    }
}

function isTrafficApiRequest(url) {
    try {
        const parsed = new URL(url);
        return [
            'opendata.adsb.fi',
            'api.adsb.lol',
            'api.airplanes.live'
        ].includes(parsed.hostname);
    } catch (_) {
        return false;
    }
}

function getRequestFilename(request) {
    try {
        const parsed = new URL(request.url);
        return parsed.pathname.split('/').pop() || '';
    } catch (_) {
        return '';
    }
}


function isCommunesGeojsonRequest(url) {
    try {
        const parsed = new URL(url, self.location.href);

        const localPath = new URL(
            LOCAL_COMMUNES_GEOJSON_URL,
            self.location.href
        ).pathname;

        if (
            parsed.origin === self.location.origin
            && parsed.pathname === localPath
        ) {
            return true;
        }

        return parsed.hostname === 'etalab-datasets.geo.data.gouv.fr'
            && /^\/contours-administratifs\/latest\/geojson\/communes-(?:50|100|1000)m\.geojson(?:\.gz)?$/i.test(parsed.pathname);
    } catch (_) {
        return false;
    }
}

function isSiaDataRequest(request) {
    try {
        const parsed = new URL(request.url);
        return parsed.origin === self.location.origin
            && (parsed.pathname.split('/').pop() || '') === 'sia.js';
    } catch (_) {
        return false;
    }
}

function isAppDataRequest(request) {
    try {
        const parsed = new URL(request.url);
        const isExternalCommuneGeojson = isCommunesGeojsonRequest(request.url);
        if (
            parsed.origin !== self.location.origin
            && request.url !== DEPARTMENTS_GEOJSON_URL
            && !isExternalCommuneGeojson
        ) return false;

        const filename = parsed.pathname.split('/').pop() || '';
        return [
            'communes.json',
            'communes_aliases.json',
            'communes-500m.geojson',
            'communes-1000m.geojson',
            'localites-france-v14.56.zip',
            'lignes_ht_rte_simplifiees.geojson'
        ].includes(filename)
            || parsed.pathname.includes('/icons/')
            || request.url === DEPARTMENTS_GEOJSON_URL
            || isExternalCommuneGeojson;
    } catch (_) {
        return false;
    }
}

function isAppShellRequest(request) {
    try {
        const parsed = new URL(request.url);
        if (parsed.origin !== self.location.origin) return false;
        if (request.mode === 'navigate') return true;
        return [
            'index.html',
            'style.css',
            'script.js',
            'manifest.json',
            'leaflet.css',
            'leaflet.min.js',
            'suncalc.js',
            'jszip.min.js'
        ].includes(getRequestFilename(request));
    } catch (_) {
        return false;
    }
}

function isCriticalAppShellRequest(request) {
    try {
        if (request.mode === 'navigate') return true;
        return [
            'index.html',
            'script.js',
            'style.css',
            'manifest.json',
            'leaflet.css',
            'leaflet.min.js',
            'suncalc.js',
            'jszip.min.js'
        ].includes(getRequestFilename(request));
    } catch (_) {
        return false;
    }
}

function compareNpfAppVersions(left, right) {
    const parse = value => {
        const match = String(value || '').match(/v?(\d+)\.(\d+)/i);
        return match ? [Number(match[1]), Number(match[2])] : [0, 0];
    };
    const a = parse(left);
    const b = parse(right);
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] - b[1];
}

async function handleAppShellRequest(request) {
    const cache = await caches.open(APP_SHELL_CACHE);
    const isNavigation = request.mode === 'navigate';
    const cacheKey = isNavigation ? './index.html' : request;
    /*
     * v14.70 — ne jamais rechercher l'app-shell dans tous les caches.
     * caches.match() pouvait renvoyer le cache v14.68 conservé en secours avant
     * le cache courant v14.70. La version active lit exclusivement son cache.
     */
    const cached = await cache.match(cacheKey, { ignoreSearch: true })
        || await cache.match(request, { ignoreSearch: true });
    const requestUrl = new URL(request.url);
    const requestedAppVersion = requestUrl.searchParams.get('appv') || '';
    const requestsNewerAppVersion = requestedAppVersion
        && compareNpfAppVersions(requestedAppVersion, APP_VERSION) > 0;
    const forcedTransition = isNavigation
        && (requestUrl.searchParams.has('swrefresh')
            || requestUrl.searchParams.has('ts'));

    /*
     * Si une page demande explicitement une version plus récente que celle de
     * ce SW, celui-ci ne doit jamais lui substituer son ancien shell en cache.
     * On laisse le réseau fournir les nouveaux fichiers ; en cas d'absence de
     * réseau le shell courant reste disponible comme secours.
     */
    if (requestsNewerAppVersion) {
        try {
            const fresh = await swFetchWithTimeout(
                new Request(request, { cache: 'reload' }),
                {},
                5000
            );
            if (fresh && fresh.ok) return fresh;
        } catch (_) {}
        if (cached) return cached;
    }

    const refreshFromNetwork = async (timeoutMs = 4500) => {
        try {
            const freshRequest = new Request(request, { cache: 'reload' });
            const fresh = await swFetchWithTimeout(freshRequest, {}, timeoutMs);
            if (fresh && fresh.ok) {
                const valid = await validateVersionSensitiveCoreResponse(
                    request.url,
                    fresh
                );
                /*
                 * Une réponse réseau ancienne ne doit jamais écraser le cache
                 * atomique courant. Ceci protège aussi contre la propagation
                 * différée de GitHub Pages après activation de la v14.70.
                 */
                if (!valid) return null;
                await cache.put(cacheKey, fresh.clone());
                return fresh;
            }
        } catch (_) {}
        return null;
    };

    /*
     * Démarrage ordinaire : cache d'abord. Le réseau ne doit jamais retarder
     * l'ouverture hors ligne. Une mise à jour explicite peut attendre le réseau,
     * mais conserve toujours le shell mis en cache en secours.
     */
    if (cached && !forcedTransition) {
        refreshFromNetwork(4500).catch(() => {});
        return cached;
    }

    const fresh = await refreshFromNetwork(forcedTransition ? 6000 : 4500);
    if (fresh) return fresh;
    if (cached) return cached;

    if (isNavigation) {
        const fallbackIndex = await caches.match('./index.html', { ignoreSearch: true });
        if (fallbackIndex) return fallbackIndex;
    }

    return new Response('', {
        status: 504,
        statusText: 'Offline app shell unavailable'
    });
}

async function handleSiaDataRequest(request) {
    const siaCache = await caches.open(SIA_DATA_CACHE);
    const cached = await siaCache.match(SIA_DATA_URL, { ignoreSearch: true })
        || await siaCache.match(request, { ignoreSearch: true })
        || await caches.match(request, { ignoreSearch: true });

    /*
     * La base SIA est immuable pour une révision donnée. Cache d'abord : une
     * petite évolution de NPF ne doit ni retélécharger ni remplacer ce fichier.
     */
    if (cached) {
        try {
            if (!(await siaCache.match(SIA_DATA_URL, { ignoreSearch: true }))) {
                await siaCache.put(SIA_DATA_URL, cached.clone());
            }
        } catch (_) {}
        return cached;
    }

    try {
        const freshRequest = new Request(request, { cache: 'reload' });
        const fresh = await swFetchWithTimeout(freshRequest, {}, 18000);
        if (fresh && fresh.ok) {
            const text = await fresh.clone().text();
            if (text.includes(`const NPF_SIA_DATA_REVISION = '${SIA_DATA_REVISION}'`)) {
                await siaCache.put(SIA_DATA_URL, fresh.clone());
                return fresh;
            }
        }
    } catch (_) {}

    return new Response('', {
        status: 504,
        statusText: 'Offline SIA data unavailable'
    });
}

async function handleAppDataRequest(request) {
    const dataCache = await caches.open(APP_DATA_CACHE);
    const isCommunePolygonGeojson = isCommunesGeojsonRequest(request.url);

    /*
     * v14.96 — PWA iPad / commune survolée :
     * le gros GeoJSON Etalab des communes ne doit plus dépendre du chemin
     * générique limité à 8 s. Après un premier succès, la copie locale stable
     * est renvoyée immédiatement et le réseau ne sert qu'à la rafraîchir.
     */
    const cached = await dataCache.match(request, { ignoreSearch: true })
        || await caches.match(request, { ignoreSearch: true });

    if (cached) {
        try {
            if (!(await dataCache.match(request, { ignoreSearch: true }))) {
                await dataCache.put(request, cached.clone());
            }
        } catch (_) {}

        (async () => {
            try {
                const refreshRequest = new Request(request, { cache: 'no-cache' });
                const fresh = await swFetchWithTimeout(
                    refreshRequest,
                    {},
                    isCommunePolygonGeojson ? 45000 : 12000
                );
                if (fresh && (fresh.ok || fresh.type === 'opaque')) {
                    await dataCache.put(request, fresh.clone());
                }
            } catch (_) {
                /* La dernière copie locale valide reste utilisée. */
            }
        })();

        return cached;
    }

    try {
        const fresh = await swFetchWithTimeout(
            request,
            {},
            isCommunePolygonGeojson ? 45000 : 12000
        );
        if (fresh && (fresh.ok || fresh.type === 'opaque')) {
            await dataCache.put(request, fresh.clone());
        }
        return fresh;
    } catch (_) {
        return new Response('', {
            status: 504,
            statusText: isCommunePolygonGeojson
                ? 'Offline communes GeoJSON unavailable'
                : 'Offline data unavailable'
        });
    }
}

async function handleTileRequest(request) {
    await refreshOfflineSettingsFromDB();

    if (offlineTilesEnabled) {
        const offlineResponse = await findOfflineTileResponse(request.url);
        if (offlineResponse) return offlineResponse;

        /*
         * Offline strict : si la tuile n'est pas présente, on ne va pas online.
         */
        return new Response(
            Uint8Array.from(atob('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='), c => c.charCodeAt(0)),
            {
                status: 200,
                headers: {
                    'Content-Type': 'image/gif',
                    'X-Offline-Tile': 'transparent-missing'
                }
            }
        );
    }

    try {
        return await fetch(request);
    } catch (networkError) {
        if (offlineOnlineFallback) {
            const offlineResponse = await findOfflineTileResponse(request.url);
            if (offlineResponse) return offlineResponse;
        }

        throw networkError;
    }
}

function isOpenStreetMapTileRequest(url) {
    try {
        const parsed = new URL(url);
        if (!/\.tile\.openstreetmap\.org$/i.test(parsed.hostname)) return false;
        return /\/\d+\/\d+\/\d+\.(png|jpg|jpeg)$/i.test(parsed.pathname);
    } catch (_) {
        return false;
    }
}

function sanitizeOfflineDatabaseTokenForSw(value) {
    const base = String(value || 'Carte')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 72);
    return base || 'Carte';
}

function normalizeOfflinePackNameForSw(packName) {
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

    if (!versionedMatch) return cleaned;

    const prefix = versionedMatch[1]
        .replace(/[\s_-]+$/g, '')
        .trim();
    const partNumber = Number.parseInt(
        versionedMatch[2],
        10
    );

    if (
        !prefix
        || !Number.isFinite(partNumber)
    ) {
        return cleaned;
    }

    return `${prefix}_${String(partNumber).padStart(
        Math.max(
            2,
            String(versionedMatch[2]).length
        ),
        '0'
    )}`;
}

function getOfflinePackLegacyGroupNameForSw(packName) {
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

    if (
        match
        && match[1].trim().length >= 2
    ) {
        return match[1]
            .replace(/[\s_-]+$/g, '')
            .trim();
    }

    return cleaned;
}

function normalizeOfflineTileHostPrefixForSw(
    packName,
    { legacy = false } = {}
) {
    const groupName = legacy
        ? getOfflinePackLegacyGroupNameForSw(
            packName
        )
        : getOfflinePackGroupNameForSw(
            packName
        );

    const simplified = String(
        groupName || packName || ''
    )
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (
        !simplified
        || /open\s*street|openstreet|\bosm\b/.test(
            simplified
        )
    ) {
        return 'a';
    }

    if (
        /\bign\b|scan25|scan\s*25|oaci\s*ign/.test(
            simplified
        )
    ) {
        return 'ign';
    }

    if (
        /oaci|carte\s*oaci/.test(simplified)
    ) {
        return 'oaci';
    }

    return (
        simplified
            .replace(/[^a-z0-9]+/g, '')
            .slice(0, 20)
        || 'pack'
    );
}

function getOfflineTileUrlCandidates(tileUrl) {
    const candidates = [];
    const addCandidate = value => {
        const clean = String(value || '').trim();
        if (clean && !candidates.includes(clean)) {
            candidates.push(clean);
        }
    };

    addCandidate(tileUrl);

    let parsed;
    try {
        parsed = new URL(tileUrl);
    } catch (_) {
        return candidates;
    }

    const aliases = [
        ...(activeOfflinePacks || []),
        ...(activeOfflinePackAliases || [])
    ];

    aliases.forEach(alias => {
        [
            normalizeOfflineTileHostPrefixForSw(
                alias
            ),
            normalizeOfflineTileHostPrefixForSw(
                alias,
                { legacy: true }
            )
        ].forEach(prefix => {
            addCandidate(
                `${parsed.protocol}//${prefix}.tile.openstreetmap.org${parsed.pathname}${parsed.search}`
            );
        });
    });

    return candidates;
}

function getOfflineDatabaseCandidatesForSw() {
    const candidates = [];
    const addCandidate = value => {
        const clean = String(value || '').trim();
        if (clean && !candidates.includes(clean)) {
            candidates.push(clean);
        }
    };

    (activeOfflinePackDatabases || [])
        .forEach(addCandidate);

    [
        ...(activeOfflinePacks || []),
        ...(activeOfflinePackAliases || [])
    ].forEach(alias => {
        const canonicalGroup =
            getOfflinePackGroupNameForSw(alias);
        const legacyGroup =
            getOfflinePackLegacyGroupNameForSw(alias);

        addCandidate(
            `${OFFLINE_MAP_DATABASE_PREFIX}${sanitizeOfflineDatabaseTokenForSw(canonicalGroup)}`
        );
        addCandidate(
            `${OFFLINE_MAP_DATABASE_PREFIX}${sanitizeOfflineDatabaseTokenForSw(legacyGroup)}`
        );
    });

    addCandidate(LEGACY_TILE_DB_NAME);
    return candidates;
}

async function findOfflineTileResponse(tileUrl) {
    const cacheKey = [
        tileUrl,
        (activeOfflinePacks || []).join('|'),
        (activeOfflinePackAliases || []).join('|')
    ].join('::');

    const cached = memoryTileCache.get(cacheKey);
    if (cached) {
        touchMemoryTile(cacheKey, cached);
        return cached.clone();
    }

    const tileUrlCandidates =
        getOfflineTileUrlCandidates(tileUrl);
    const dbNames =
        getOfflineDatabaseCandidatesForSw();

    try {
        for (const dbName of dbNames) {
            let tileDb;

            try {
                tileDb = (
                    dbName === LEGACY_TILE_DB_NAME
                )
                    ? await openOfflineDB()
                    : await openOfflineDBByName(
                        dbName
                    );
            } catch (dbOpenError) {
                console.warn(
                    '[SW] Base offline ignorée:',
                    dbName,
                    dbOpenError
                );
                continue;
            }

            for (
                const candidateUrl
                of tileUrlCandidates
            ) {
                try {
                    const record =
                        await findTileRecordInDB(
                            tileDb,
                            candidateUrl
                        );

                    if (!record?.tile) continue;

                    const contentType =
                        record.tile.type
                        || guessTileContentType(
                            candidateUrl
                        );
                    const response = new Response(
                        record.tile,
                        {
                            headers: {
                                'Content-Type':
                                    contentType,
                                'X-Offline-Tile':
                                    `indexeddb:${dbName}`,
                                'X-Offline-Tile-Key':
                                    candidateUrl
                            }
                        }
                    );

                    rememberMemoryTile(
                        cacheKey,
                        response.clone()
                    );
                    return response;
                } catch (readError) {
                    if (
                        isIndexedDbClosingErrorForSw(
                            readError
                        )
                    ) {
                        closeOfflineDatabasePromise(
                            dbName
                        );
                    }
                }
            }
        }

        return null;
    } catch (error) {
        console.warn(
            '[SW] Lecture tuile offline impossible:',
            error
        );
        return null;
    }
}

function isIndexedDbClosingErrorForSw(error) {
    const name = String(error?.name || '')
        .toLowerCase();
    const message = String(
        error?.message || error || ''
    ).toLowerCase();

    return (
        name === 'invalidstateerror'
        || name === 'transactioninactiveerror'
        || message.includes('connection is closing')
        || message.includes('connection is closed')
    );
}

async function closeOfflineDatabasePromise(dbName) {
    const safeName = String(
        dbName || LEGACY_TILE_DB_NAME
    );

    try {
        const promise = (
            safeName === LEGACY_TILE_DB_NAME
                ? dbPromise
                : tileDbPromises.get(safeName)
        );
        const connection =
            await promise?.catch?.(() => null);
        connection?.close?.();
    } catch (_) {}

    tileDbPromises.delete(safeName);
    if (safeName === LEGACY_TILE_DB_NAME) {
        dbPromise = null;
    }
}


function rememberMemoryTile(key, response) {
    memoryTileCache.set(key, response);

    while (memoryTileCache.size > MEMORY_TILE_CACHE_MAX) {
        const oldestKey = memoryTileCache.keys().next().value;
        memoryTileCache.delete(oldestKey);
    }
}

function touchMemoryTile(key, response) {
    memoryTileCache.delete(key);
    memoryTileCache.set(key, response);
}

function openOfflineDB() {
    if (dbPromise) return dbPromise;
    dbPromise = openOfflineDBByName(DB_NAME);
    return dbPromise;
}

function openOfflineDBByName(dbName = DB_NAME) {
    const safeName = String(dbName || DB_NAME);
    if (tileDbPromises.has(safeName)) return tileDbPromises.get(safeName);

    const promise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible dans le service worker'));
            return;
        }

        const request = indexedDB.open(safeName, DB_VERSION);
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
            try {
                openedDb.onversionchange = () => {
                    try { openedDb.close(); } catch (_) {}
                    tileDbPromises.delete(safeName);
                    if (safeName === DB_NAME) dbPromise = null;
                };
            } catch (_) {}
            resolve(openedDb);
        };
        request.onerror = event => reject(event.target.error || new Error(`Erreur ouverture IndexedDB ${safeName}`));
        request.onblocked = () => reject(new Error(`IndexedDB bloquée : ${safeName}`));
    }).catch(error => {
        tileDbPromises.delete(safeName);
        if (safeName === DB_NAME) dbPromise = null;
        throw error;
    });

    tileDbPromises.set(safeName, promise);
    return promise;
}

function findTileRecordInDB(db, tileUrl) {
    const activeSet = new Set(activeOfflinePacks || []);

    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readonly');
        const store = tx.objectStore('tiles');

        let request;

        if (store.indexNames.contains('tileUrl')) {
            /*
             * Chemin rapide : index tileUrl + curseur.
             * On s'arrête dès qu'une tuile correspondant au pack actif est trouvée.
             */
            request = store.index('tileUrl').openCursor(IDBKeyRange.only(tileUrl));
        } else {
            request = store.openCursor();
        }

        request.onsuccess = () => {
            const cursor = request.result;

            if (!cursor) {
                resolve(null);
                return;
            }

            const value = cursor.value || {};
            const storedTileUrl = value.tileUrl || getTileUrlFromStoredKey(value.url);

            if (storedTileUrl === tileUrl && isTileRecordAllowed(value, activeSet)) {
                resolve(value);
                return;
            }

            cursor.continue();
        };

        request.onerror = () => reject(request.error || new Error('Erreur lecture tuile IndexedDB'));
        tx.onerror = () => reject(tx.error || new Error('Erreur transaction IndexedDB'));
        tx.onabort = () => reject(tx.error || new Error('Transaction IndexedDB annulée'));
    });
}

function getOfflinePackGroupNameForSw(packName) {
    const name =
        normalizeOfflinePackNameForSw(packName);
    const cleaned = name
        .replace(/\s*\(\d+\)\s*$/i, '')
        .replace(/\s+(copy|copie)\s*$/i, '')
        .trim();

    const match = cleaned.match(
        /^(.+?)(?:[\s_-]*(?:part|partie|zip)?[\s_-]*)(\d{1,3})$/i
    );

    if (
        match
        && match[1].trim().length >= 2
    ) {
        return match[1]
            .replace(/[\s_-]+$/g, '')
            .trim();
    }

    return cleaned;
}

function isTileRecordAllowed(record, activeSet) {
    if (!activeSet || activeSet.size === 0) {
        return true;
    }

    const recordPack = record?.packName
        ? String(record.packName)
        : '';

    if (activeSet.has(recordPack)) {
        return true;
    }

    const recordCanonical =
        normalizeOfflinePackNameForSw(
            recordPack
        );
    const recordGroup =
        getOfflinePackGroupNameForSw(
            recordPack
        );

    const allowedNames = new Set([
        ...activeSet,
        ...(activeOfflinePackAliases || [])
    ]);

    for (const activePack of allowedNames) {
        if (
            normalizeOfflinePackNameForSw(
                activePack
            ) === recordCanonical
        ) {
            return true;
        }

        if (
            getOfflinePackGroupNameForSw(
                activePack
            ) === recordGroup
        ) {
            return true;
        }
    }

    return false;
}

function getTileUrlFromStoredKey(storedUrl) {
    return String(storedUrl || '').split('::')[0];
}

function guessTileContentType(tileUrl) {
    return /\.(jpg|jpeg)(?:\?.*)?$/i.test(tileUrl) ? 'image/jpeg' : 'image/png';
}

async function refreshOfflineSettingsFromDB({ force = false } = {}) {
    const now = Date.now();

    if (
        !force
        && offlineConfigurationMessageAt > 0
        && (
            now - offlineConfigurationMessageAt
        ) < OFFLINE_MESSAGE_AUTHORITY_MS
    ) {
        return;
    }

    if (!force && (now - offlineSettingsLoadedAt) < SETTINGS_REFRESH_INTERVAL_MS) {
        return;
    }

    try {
        const db = await openOfflineDB();
        const settings = await readOfflineSettings(db);

        if (typeof settings[OFFLINE_TILES_ENABLED_KEY] === 'boolean') {
            offlineTilesEnabled = settings[OFFLINE_TILES_ENABLED_KEY];
        }

        if (typeof settings[OFFLINE_ONLINE_FALLBACK_KEY] === 'boolean') {
            offlineOnlineFallback = settings[OFFLINE_ONLINE_FALLBACK_KEY];
        }

        if (Array.isArray(settings[OFFLINE_ACTIVE_PACKS_KEY])) {
            activeOfflinePacks = settings[OFFLINE_ACTIVE_PACKS_KEY].filter(Boolean);
        }

        if (Array.isArray(settings[OFFLINE_ACTIVE_PACK_DATABASES_KEY])) {
            activeOfflinePackDatabases = settings[OFFLINE_ACTIVE_PACK_DATABASES_KEY].filter(Boolean);
        }

        if (Array.isArray(settings[OFFLINE_ACTIVE_PACK_ALIASES_KEY])) {
            activeOfflinePackAliases = settings[OFFLINE_ACTIVE_PACK_ALIASES_KEY].filter(Boolean);
        }

        offlineSettingsLoadedAt = now;
    } catch (error) {
        /*
         * Non bloquant : script.js envoie aussi les changements par postMessage.
         */
    }
}

function readOfflineSettings(db) {
    return new Promise((resolve) => {
        const result = {};
        const keys = [
            OFFLINE_TILES_ENABLED_KEY,
            OFFLINE_ONLINE_FALLBACK_KEY,
            OFFLINE_ACTIVE_PACKS_KEY,
            OFFLINE_ACTIVE_PACK_DATABASES_KEY,
            OFFLINE_ACTIVE_PACK_ALIASES_KEY
        ];

        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        let pending = keys.length;

        keys.forEach(key => {
            const request = store.get(key);
            request.onsuccess = () => {
                if (request.result) {
                    result[key] = request.result.value;
                }
                pending -= 1;
                if (pending === 0) resolve(result);
            };
            request.onerror = () => {
                pending -= 1;
                if (pending === 0) resolve(result);
            };
        });

        tx.onerror = () => resolve(result);
        tx.onabort = () => resolve(result);
    });
}

self.addEventListener('push', event => {
    let data = {};

    try {
        data = event.data ? event.data.json() : {};
    } catch (error) {
        data = {
            title: 'Pelic Chat',
            body: event.data ? event.data.text() : 'Nouveau message'
        };
    }

    const title = data.title || 'Pelic Chat';
    const options = {
        body: data.body || data.text || 'Nouveau message',
        icon: './icons/icon-192x192.png',
        badge: './icons/icon-192x192.png',
        tag: data.tag || 'pelic-chat',
        data: data
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow('./'));
});
