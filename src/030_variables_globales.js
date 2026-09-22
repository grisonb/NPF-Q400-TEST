
/* Ancien complément tiers conservé momentanément dans le code uniquement pour
 * compatibilité de cache. Il n'est plus consulté pour déterminer TWR/AFIS/A/A. */
/* v16.63 — complément léger pour le TYPE de service terrain (AFIS, TWR,
 * A/A, INFO). Il ne remplace jamais la fréquence retenue par NPF : un type
 * n'est appliqué que s'il correspond exactement à la même fréquence. */
const AIRPORT_SERVICE_SUPPLEMENT_URLS = Object.freeze([
    'https://raw.githubusercontent.com/laegsgaardTroels/whatisflying-db/master/data/airports_frequencies.csv',
    'https://cdn.jsdelivr.net/gh/laegsgaardTroels/whatisflying-db@master/data/airports_frequencies.csv'
]);
const AIRPORT_SERVICE_SUPPLEMENT_CACHE_KEY = 'npfAirportServiceSupplement_v1';
const AIRPORT_SERVICE_SUPPLEMENT_TIMEOUT_MS = 9000;
let airportServiceSupplementIndex = null;
let airportServiceSupplementByOaciIndex = new Map();
let airportServiceSupplementLoadPromise = null;
let airportServiceSupplementLastAttemptAt = 0;

/*
 * Navigation automatique Feu ↔ PÉLIC.
 * Le cycle n'agit que lorsqu'il est explicitement armé sur le feu courant.
 * Un GoTo manuel WP/aéroport reste prioritaire et suspend le cycle.
 */
const NPF_FIRE_PELIC_CAPTURE_RADIUS_NM = 1;
const NPF_FIRE_PELIC_RELEASE_RADIUS_NM = 1.15;
let npfFirePelicAutoCycleState = {
    armed: false,
    target: 'fire',
    captureBlocked: false
};

function resetNpfFirePelicAutoCycle() {
    npfFirePelicAutoCycleState = {
        armed: false,
        target: 'fire',
        captureBlocked: false
    };
}

function armNpfFirePelicAutoCycle(target = 'fire') {
    if (!currentCommune) {
        resetNpfFirePelicAutoCycle();
        return false;
    }
    npfFirePelicAutoCycleState = {
        armed: true,
        target: target === 'pelic' ? 'pelic' : 'fire',
        captureBlocked: false
    };
    return true;
}

function suspendNpfFirePelicAutoCycle() {
    npfFirePelicAutoCycleState.armed = false;
    npfFirePelicAutoCycleState.captureBlocked = false;
}

function getNpfFirePelicAutoCycleTarget() {
    if (!npfFirePelicAutoCycleState.armed || !currentCommune) return null;

    if (npfFirePelicAutoCycleState.target === 'pelic') {
        const pelic = getSelectedPelicanAirport();
        if (pelic && !disabledAirports.has(pelic.oaci)) {
            return {
                kind: 'pelic',
                oaci: pelic.oaci,
                lat: Number(pelic.lat),
                lon: Number(pelic.lon)
            };
        }
        npfFirePelicAutoCycleState.target = 'fire';
        npfFirePelicAutoCycleState.captureBlocked = false;
    }

    return {
        kind: 'fire',
        lat: Number(currentCommune.latitude_mairie),
        lon: Number(currentCommune.longitude_mairie)
    };
}

function handleNpfFirePelicAutoCycle(userLat, userLon) {
    if (!npfFirePelicAutoCycleState.armed || !currentCommune) return false;
    if (selectedAirportDestination) return false;
    if (window.__npfWaypointRouteReady === true && typeof isNpfWaypointGotoActive === 'function' && isNpfWaypointGotoActive()) return false;

    const target = getNpfFirePelicAutoCycleTarget();
    if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lon)) return false;

    const distance = calculateDistanceInNm(Number(userLat), Number(userLon), target.lat, target.lon);
    if (!Number.isFinite(distance)) return false;

    /*
     * Après un basculement, il faut d'abord sortir du petit voisinage de la
     * nouvelle cible avant d'autoriser une nouvelle acquisition. Cela évite un
     * aller-retour instantané si Feu et PÉLIC sont exceptionnellement proches.
     */
    if (npfFirePelicAutoCycleState.captureBlocked) {
        if (distance > NPF_FIRE_PELIC_RELEASE_RADIUS_NM) {
            npfFirePelicAutoCycleState.captureBlocked = false;
        }
        return false;
    }

    if (distance > NPF_FIRE_PELIC_CAPTURE_RADIUS_NM) return false;

    if (target.kind === 'fire') {
        const pelic = getSelectedPelicanAirport();
        if (!pelic || disabledAirports.has(pelic.oaci)) return false;
        npfFirePelicAutoCycleState.target = 'pelic';
    } else {
        npfFirePelicAutoCycleState.target = 'fire';
    }
    npfFirePelicAutoCycleState.captureBlocked = true;

    updateCommuneDisplay(currentCommune);
    drawUserToTargetRoute();
    return true;
}

// v15.50 — renderers SVG dédiés aux grandes zones tactiles iPad.
let npfTouchRenderer = null;
let siaPointTouchRenderer = null;
let npfRunwayMapLayer = null;
let npfRunwayRenderer = null;
let communeAliases = [];
let communeAliasesLoadSource = 'non-charge';
let communesByCodeInsee = new Map();

/*
 * v14.40 — base nationale de localités intégralement offline.
 *
 * Une archive ZIP unique est pré-cachée par le service worker. Elle contient
 * 179 402 villages, hameaux et lieux-dits répartis en petits fragments de
 * recherche. Une saisie ne décompresse que le fragment utile : la base France
 * reste disponible en mode avion sans charger 20 Mo de JSON en mémoire.
 */
const NAMED_PLACES_OFFLINE_ARCHIVE_URL =
    './data/localites/localites-france-v14.56.zip?appv=v14.92';
const NAMED_PLACES_OFFLINE_RESULT_LIMIT = 5;
const NAMED_PLACES_OFFLINE_SHARD_PREFIX_LENGTH = 3;
// v14.81 — la recherche phonétique charge tous les fragments partageant
// les deux premières lettres, puis applique Soundex et Levenshtein.
const NAMED_PLACES_OFFLINE_PHONETIC_PREFIX_LENGTH = 2;
const NAMED_PLACES_OFFLINE_SHARD_CACHE_MAX = 64;

/*
 * v16.52 — filet national des noms d'usage.
 * La recherche principale reste la base nationale de 179 402 localités + les
 * alias de communes. Cette petite table ne remplace pas la base nationale : elle
 * corrige uniquement des noms d'usage administratifs connus qui peuvent être
 * absents des sources embarquées. Chaque entrée pointe vers le code INSEE de la
 * commune et vers les coordonnées du lieu réellement recherché.
 */
const NPF_KNOWN_LOCALITY_EQUIVALENTS = Object.freeze([
    Object.freeze({
        names: Object.freeze(['lapradelle', 'lapradelle puilaurens']),
        displayName: 'Lapradelle',
        municipalityName: 'Puilaurens',
        codeInsee: '11302',
        departmentCode: '11',
        latitude: 42.80994,
        longitude: 2.30584
    })
]);

function searchNpfKnownLocalityEquivalents(searchTerm, departmentFilter = null) {
    const normalizedQuery = simplifyString(searchTerm);
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    if (!normalizedQuery || compactQuery.length < 3) return [];

    return NPF_KNOWN_LOCALITY_EQUIVALENTS
        .filter(entry => !departmentFilter || entry.departmentCode === departmentFilter)
        .filter(entry => entry.names.some(name => {
            const normalizedName = simplifyString(name);
            const compactName = normalizedName.replace(/\s+/g, '');
            return normalizedName === normalizedQuery
                || compactName === compactQuery
                || normalizedName.startsWith(normalizedQuery)
                || normalizedQuery.startsWith(normalizedName)
                || (
                    compactQuery.length >= 4
                    && (
                        compactName.startsWith(compactQuery)
                        || compactQuery.startsWith(compactName)
                    )
                );
        }))
        .map(entry => {
            const commune = communesByCodeInsee.get(entry.codeInsee);
            const normalizedName = simplifyString(entry.displayName);
            const municipalityNormalized = simplifyString(entry.municipalityName);
            const exactUsageName = entry.names.some(name => {
                const normalizedName = simplifyString(name);
                return normalizedName === normalizedQuery
                    || normalizedName.replace(/\s+/g, '') === compactQuery;
            });
            const searchParts = Array.from(new Set([
                ...normalizedName.split(' ').filter(Boolean),
                ...municipalityNormalized.split(' ').filter(Boolean)
            ]));
            return {
                ...(commune || {}),
                nom_standard: entry.displayName,
                nom_sans_pronom: entry.displayName,
                nom_sans_accent: normalizedName.replace(/\s+/g, '-'),
                normalized_name: normalizedName,
                search_parts: searchParts,
                search_compact: searchParts.join(''),
                soundex_parts: searchParts.map(part => soundex(part)),
                latitude_mairie: Number(entry.latitude),
                longitude_mairie: Number(entry.longitude),
                dep_code: entry.departmentCode,
                dep_nom: commune?.dep_nom || '',
                code_insee: entry.codeInsee,
                locality_match: true,
                locality_commune_name: entry.municipalityName,
                locality_type: 'village, hameau ou lieu-dit',
                locality_source: 'Équivalence locale NPF — rattachement commune INSEE',
                locality_offline: true,
                locality_linked_commune: !!commune,
                search_exact_locality: exactUsageName,
                score: exactUsageName ? -0.90 : -0.25
            };
        });
}

let namedPlacesSearchSequence = 0;
/*
 * v16.87 — diagnostic de la dernière recherche nationale.
 * Il permet de distinguer : résultat absent de l'archive, fragment non chargé,
 * filtre département, élimination au scoring ou perte au merge final.
 */
let namedPlacesLastOfflineSearchMeta = null;
let npfLastLocalitySearchDiagnostic = null;

function formatNpfSearchResultNames(results, limit = 6) {
    return (Array.isArray(results) ? results : [])
        .slice(0, Math.max(1, Number(limit) || 6))
        .map(item => {
            const name = String(item?.nom_standard || '').trim();
            const dep = String(item?.dep_code || '').trim();
            return `${name}${dep ? `(${dep})` : ''}`;
        })
        .filter(Boolean)
        .join(', ');
}

function recordNpfLocalitySearchDiagnostic(stage, detail, metrics = {}) {
    const safeStage = String(stage || 'étape');
    const safeDetail = String(detail || '');
    npfLastLocalitySearchDiagnostic = {
        stage: safeStage,
        detail: safeDetail,
        ...metrics
    };
    npfDiagSiaInteraction(
        'RECHERCHE LOCALITÉS',
        `étape=${safeStage}${safeDetail ? ` · ${safeDetail}` : ''}`,
        metrics
    );
}

let namedPlacesOfflineArchive = null;
let namedPlacesOfflineIndex = null;
let namedPlacesOfflineLoadPromise = null;
let namedPlacesOfflineLoadError = '';
let namedPlacesOfflineLoadedCount = 0;
let namedPlacesOfflineLinkedCount = 0;
let namedPlacesOfflineOrphanCount = 0;
let namedPlacesOfflineShardIdsByPrefix = new Map();
const namedPlacesOfflineShardCache = new Map();
const namedPlacesOfflineShardPromises = new Map();
let disabledAirports = new Set(), waterAirports = new Set(), customPelicanAirports = new Set();
const MAGNETIC_DECLINATION = 1.0;
let userMarker = null, watchId = null, accuracyCircle = null, headingLayer = null, lastPosition = null;
let centerGpsFollowActive = false;
let centerGpsFollowProgrammaticMove = false;
let centerGpsFollowLastProgrammaticMoveAt = 0;
let centerGpsFollowPauseTimer = null;
let centerGpsFollowPausedUntil = 0;
let centerGpsFollowStartedLiveGps = false;
let centerGpsFollowHandlersInstalled = false;
let centerGpsFollowUserGestureActive = false;
let centerGpsFollowLastUserGestureAt = 0;
let centerGpsButtonLongPressTimer = null;
let centerGpsButtonLongPressTriggered = false;
let centerGpsButtonActivePointerId = null;
let centerGpsButtonPressStartX = 0;
let centerGpsButtonPressStartY = 0;
let centerGpsButtonSuppressClickUntil = 0;
const CENTER_GPS_FOLLOW_RECENTER_DELAY_MS = 10000;
const CENTER_GPS_BUTTON_LONG_PRESS_MS = 650;
const CENTER_GPS_BUTTON_MOVE_TOLERANCE_PX = 14;
function isNpfGpsFollowProgrammaticPan() {
    const recentProgrammaticMove = (Date.now() - Number(centerGpsFollowLastProgrammaticMoveAt || 0)) < 800;
    return !!(
        isCenterGpsFollowEffective()
        && (centerGpsFollowProgrammaticMove || recentProgrammaticMove)
        && !centerGpsFollowUserGestureActive
        && (Date.now() - Number(centerGpsFollowLastUserGestureAt || 0)) > 180
    );
}
let ownGpsVectorLayer = null, ownGpsVectorMarkers = [];
let userToTargetLayer = null, lftwRouteLayer = null, fireHistoryLayer = null;
let showLftwRoute = true;
let departmentsLayerGroup = null;
let departmentsLabelsLayer = null;
let departmentsPolygonData = [];
let departmentsLayerLoadPromise = null;
let highVoltageLinesLayer = null;
let highVoltageLinesRenderer = null;
let highVoltageLinesData = null;
let highVoltageLinesIndexedFeatures = [];
let highVoltageLinesRenderedGeoJsonLayer = null;
let highVoltageLinesRenderedFeatureCount = 0;
let highVoltageLinesRenderedBounds = null;
let highVoltageLinesRefreshTimer = null;
let highVoltageLinesRefreshToken = 0;
const HIGH_VOLTAGE_LINES_VIEWPORT_PAD = 0.22;
const HIGH_VOLTAGE_LINES_MAP_CHANGE_DELAY_MS = 160;

/* v14.49 — calque routier vectoriel offline A / N / D / M / T. */
let roadOverlayLayer = null;
let roadOverlayCasingLayer = null;
let roadOverlayLineLayer = null;
let roadOverlayLabelsLayer = null;
let roadOverlayCasingRenderer = null;
let roadOverlayLineRenderer = null;
let roadOverlayRefreshTimer = null;
let roadOverlayRefreshToken = 0;
let roadOverlayLoadedZoomTier = -1;
const loadedRoadOverlayParts = new Map();
const roadOverlaySourceParts = new Map();
let roadOverlayRenderedBounds = null;
let roadOverlayRenderedPartSignature = '';

/*
 * v14.87 — état de rafraîchissement du calque routier.
 * En suivi GPS, Leaflet déclenche un moveend à chaque recentrage. Les routes
 * déjà chargées se déplacent naturellement avec la carte : il est donc inutile
 * de reparcourir les GeoJSON, de réappliquer tous les styles et de reconstruire
 * tous les cartouches à chaque position reçue.
 */
let roadOverlayLastVisiblePartSignature = '';
let roadOverlayLastStyleBand = -1;
let roadOverlayLastLabelCenter = null;
let roadOverlayLastLabelZoom = -1;
let roadOverlayLastLabelRefreshAt = 0;
const ROAD_OVERLAY_LABEL_REFRESH_MAX_INTERVAL_MS = 60000;
const ROAD_OVERLAY_LABEL_REFRESH_VIEWPORT_RATIO = 0.24;
/*
 * v15.00 — laisser le fond de carte et SafeSky se stabiliser avant le
 * rendu routier, et éviter de charger des secteurs trop éloignés de l'écran.
 */
const ROAD_OVERLAY_MAP_CHANGE_DELAY_MS = 1150;
const ROAD_OVERLAY_VIEWPORT_PAD_TIER_1 = 0.10;
const ROAD_OVERLAY_VIEWPORT_PAD_TIER_2 = 0.12;
const ROAD_OVERLAY_FEATURE_PAD_TIER_1 = 0.18;
const ROAD_OVERLAY_FEATURE_PAD_TIER_2 = 0.12;

/*
 * v16.77 — cache source compact autour du viewport.
 *
 * Les fichiers installés restent inchangés dans Cache Storage, mais après
 * lecture d'une partie NPF ne conserve plus en RAM ses dizaines de milliers
 * de tronçons. Il garde uniquement un working-set spatial autour de la vue.
 *
 * Tier 1 = autoroutes seulement : on peut conserver une marge un peu plus
 * large. Tier 2 = toutes classes : marge plus serrée pour limiter WebKit.
 */
const ROAD_OVERLAY_SOURCE_WORKSET_PAD_TIER_1 = 0.50;
const ROAD_OVERLAY_SOURCE_WORKSET_PAD_TIER_2 = 0.35;

/*
 * v16.78 — index spatial dérivé des parties Routes.
 *
 * Le pack installé n'est pas modifié. Au premier accès à une partie, NPF crée
 * paresseusement dans un cache séparé de petites cellules GeoJSON. Les pans
 * suivants relisent uniquement les cellules proches du viewport au lieu de
 * reparcourir/reparser le gros fichier départemental.
 */
const ROAD_OVERLAY_SPATIAL_CACHE_NAME = 'npf-road-overlay-spatial-v1';
const ROAD_OVERLAY_SPATIAL_RESOURCE_PREFIX = './__npf_road_overlay_spatial_v1__/';
const ROAD_OVERLAY_SPATIAL_INDEX_VERSION = 1;
const ROAD_OVERLAY_SPATIAL_CELL_DEG = 0.15;
const ROAD_OVERLAY_SPATIAL_MAX_CELLS_PER_FEATURE = 64;
const ROAD_OVERLAY_SPATIAL_BUILD_YIELD_EVERY = 600;

/*
 * v16.79 — lecture spatiale chaude.
 * - manifeste gardé en RAM tant que Routes reste actif ;
 * - cellules déjà décodées gardées en petit LRU RAM ;
 * - nouvelles cellules lues/décodées par lots parallèles de 4.
 */
const ROAD_OVERLAY_SPATIAL_CELL_READ_CONCURRENCY = 4;
const ROAD_OVERLAY_SPATIAL_RAM_CELL_LIMIT = 96;
const roadOverlaySpatialBuildStates = new Map();
const roadOverlaySpatialManifestRam = new Map();
const roadOverlaySpatialCellRam = new Map();

const ROAD_OVERLAY_FILTER_YIELD_EVERY = 1200;
const ROAD_OVERLAY_TILE_PRIORITY_QUEUE_LIMIT = 0;
const ROAD_OVERLAY_TILE_PRIORITY_ACTIVE_LIMIT = 0;
const ROAD_OVERLAY_TILE_PRIORITY_MAX_WAIT_MS = 7000;

let areDepartmentsVisible = false;
let hasLoadedDepartments = false;
let communesLayerGroup = null;
let communesLabelsLayer = null;
let areCommunesVisible = false;
let hasLoadedCommunes = false;
let communesLabelData = [];
let communesViewportLayerData = [];
let communesPolygonData = [];
let communesLayerLoadController = null;
let communesLayerLoadPromise = null;

/*
 * v13.93 — priorité des libellés de communes selon la population.
 * La géométrie Etalab reste la source des contours. La population est chargée
 * séparément depuis l'API officielle geo.api.gouv.fr et mise en cache localement.
 */
const COMMUNES_POPULATION_API_URL = 'https://geo.api.gouv.fr/communes?fields=nom,code,population&format=json';
const COMMUNES_POPULATION_CACHE_KEY = 'npfCommunesPopulationV1';
const COMMUNES_POPULATION_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let communesPopulationByInsee = new Map();
let communesPopulationLoadPromise = null;
const DEFAULT_BASE_OACI = 'LFTW';
let selectedBaseOACI = DEFAULT_BASE_OACI;
let gaarCircuits = [];
let isGaarMode = false;
let isDrawingMode = false;
const manualCircuitColors = ['#ff00ff', '#00ffff', '#ff8c00', '#00ff00', '#ff1493'];
let gaarLayer = null;
let gaarEditTouchRenderer = null;
let db; // Variable pour la connexion à la base de données IndexedDB
let offlineDbOpenPromise = null;
const OFFLINE_DB_NAME = 'OfflineTilesDB_v13_70_clean';
const OFFLINE_TILES_ENABLED_KEY = 'offlineTilesEnabled';
const DEFAULT_OFFLINE_TILES_ENABLED = true;
const MAP_SOURCE_MODE_KEY = 'mapSourceMode';
const DEFAULT_MAP_SOURCE_MODE = 'online';
const OFFLINE_ONLINE_FALLBACK_KEY = 'offlineOnlineFallback';
const DEFAULT_OFFLINE_ONLINE_FALLBACK = true;
const OFFLINE_TILES_MAX_ZOOM_KEY = 'offlineTilesMaxZoom';
const OFFLINE_TILES_MIN_ZOOM_KEY = 'offlineTilesMinZoom';
const OFFLINE_ACTIVE_PACKS_KEY = 'offlineActivePacks';
const OFFLINE_ACTIVE_PACK_DATABASES_KEY = 'offlineActivePackDatabases';
const OFFLINE_ACTIVE_PACK_ALIASES_KEY = 'offlineActivePackAliases';
const OFFLINE_MAP_DATABASE_PREFIX = 'OfflineMap_';
const COMMUNES_CACHE_KEY = 'communesDataCacheV1';
const COMMUNES_ALIASES_CACHE_KEY = 'communesAliasesCacheV3';
const AIRPORT_PDF_STORE_NAME = 'airportPdfs';
const AIRPORT_PDF_DB_NAME = 'AirportPdfsDB';
const AIRPORT_PDF_DB_VERSION = 1;

/*
 * v14.93 — cartes VAC SIA hors ligne.
 * Les PDF sont publiés par le dépôt GitHub Pages NPF-Q400-VAC puis stockés
 * localement dans une base IndexedDB distincte des PDF FDF.
 */
const VAC_DB_NAME = 'NpfVacDB';
const VAC_DB_VERSION = 1;
const VAC_STORE_NAME = 'vacPdfs';
const VAC_REPOSITORY_BASE_URL = 'https://grisonb.github.io/NPF-Q400-VAC/';
const VAC_MANIFEST_URL = `${VAC_REPOSITORY_BASE_URL}manifest.json`;
const VAC_INSTALLED_CODES_KEY = 'npfVacInstalledCodesV1';
const VAC_EXPECTED_COUNT_KEY = 'npfVacExpectedCountV1';
const VAC_REMOTE_AIRPORT_COUNT_KEY = 'npfVacRemoteAirportCountV1';
const VAC_REMOTE_UNAVAILABLE_COUNT_KEY = 'npfVacRemoteUnavailableCountV1';
const VAC_REMOTE_CYCLE_KEY = 'npfVacRemoteCycleV1';
const VAC_REMOTE_TOTAL_SIZE_KEY = 'npfVacRemoteTotalSizeV1';
const VAC_LAST_SUCCESSFUL_SYNC_KEY = 'npfVacLastSuccessfulSyncV1';

/*
 * v15.42 — correction transitoire Dole-Tavaux.
 * Le dépôt NPF-Q400-VAC a été généré depuis l'ancienne référence v14.92,
 * dans laquelle Dole était encore associé à tort à LFSJ. La VAC locale LFSJ
 * ne doit surtout pas être réutilisée pour LFGJ (LFSJ = Sedan-Douzy).
 * Tant que le dépôt VAC n'a pas été régénéré avec LFGJ, l'ouverture en ligne
 * de Dole utilise le lien stable officiel SIA. Les autres VAC restent strictement
 * inchangées et continuent d'utiliser IndexedDB hors ligne.
 */
const VAC_ONLINE_FALLBACK_URLS = Object.freeze({});

/*
 * v15.45 — migration ciblée de l'ancienne VAC Dole mal étiquetée LFSJ.
 * Ce SHA correspond uniquement au PDF Dole publié historiquement sous LFSJ
 * dans le dépôt VAC avant la correction LFGJ. Il ne doit jamais entraîner la
 * suppression d'une vraie VAC Sedan-Douzy portant un autre SHA.
 */
const VAC_LEGACY_DOLE_LFSJ_SHA256 = '17c83cb0e4f607e336962e05bb593d6d8054327581444fbf5f8aa463669b6e28';

let vacDb = null;
let vacSyncInProgress = false;
let pendingVacUpdateManifest = null;
/* v17.12 — première installation VAC : décision utilisateur valable pour la session. */
let vacInitialDownloadPromptActive = false;
let vacInitialDownloadDeclinedForSession = false;
let vacAutomaticSyncTimer = null;
let vacAutomaticSyncSequence = 0;
let vacAutomaticSyncLastAttemptAt = 0;
const VAC_AUTO_SYNC_RETRY_DELAY_MS = 12000;
const VAC_AUTO_SYNC_ONLINE_DELAY_MS = 5000;
let vacInstalledOaciSet = new Set(
    (() => {
        try {
            const parsed = JSON.parse(localStorage.getItem(VAC_INSTALLED_CODES_KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    })()
);

const FDF_REDUCED_PDF_KEY = 'DOC_FDF_REDUITE';
const FDF_REDUCED_PDF_FILENAME = 'Doc Fdf Réduite.pdf';
const FDF_REDUCED_PDF_LABEL = 'Doc FDF réduite';
const FDF_REDUCED_PDF_SERVER_CANDIDATES = [
    './pdf/Doc%20Fdf%20R%C3%A9duite.pdf',
    './pdf/Doc%20Fdf%20R%C3%A9duit%C3%A9.pdf',
    './pdf/Doc Fdf Réduite.pdf',
    './pdf/Doc Fdf Réduité.pdf'
];
const OPS_FREQUENCIES_PDF_KEY = 'CARTE_FREQUENCES_OPS';
const OPS_FREQUENCIES_PDF_FILENAME = 'Carte Fréquences OPS.pdf';
const OPS_FREQUENCIES_PDF_LABEL = 'Carte Fréquences OPS';
const OPS_FREQUENCIES_PDF_SERVER_CANDIDATES = [
    './pdf/Carte%20Fr%C3%A9quences%20OPS.pdf',
    './pdf/Carte%20Frequences%20OPS.pdf',
    './pdf/Carte Fréquences OPS.pdf',
    './pdf/Carte Frequences OPS.pdf'
];
let airportPdfDb = null;

/*
 * v15.11 — FdS / GAAR depuis le NAS BFG, accès direct depuis la carte.
 * Important : aucun jeton BFG longue durée n'est inclus dans cette PWA publique.
 * Le navigateur ne manipule qu'un jeton de session court émis par le NAS après
 * saisie du mot de passe, avec expiration à minuit Europe/Paris.
 */
const NPF_BRIEFING_DOCS_API_URL = 'https://grisonb.synology.me/briefing-api/npf-docs-api.php';
const NPF_FDS_GMAIL_REFRESH_URL = 'https://script.google.com/macros/s/AKfycbwjw2i5AcY9UT31sRvz1sTessKF4k1EUHMo0KW4Tga-mLTeBhup0IN98dXnAJSoqq_LDQ/exec';
const NPF_GAAR_IMPORT_REQUEST_URL = 'https://grisonb.synology.me/briefing-api/request-gaar-import.php';
const NPF_BRIEFING_DOCS_DB_NAME = 'NpfBriefingDocsDB';
const NPF_BRIEFING_DOCS_DB_VERSION = 1;
const NPF_BRIEFING_DOCS_STORE_NAME = 'docs';
const NPF_BRIEFING_DOCS_SESSION_TOKEN_KEY = 'npfBriefingDocsSessionTokenV1';
const NPF_BRIEFING_DOCS_SESSION_EXP_KEY = 'npfBriefingDocsSessionExpV1';
const NPF_BRIEFING_DOCS_LAST_SYNC_KEY = 'npfBriefingDocsLastSyncV1';
// v15.99 — association persistante de cette PWA NPF avec BFG via le NAS.
const NPF_BFG_BRIDGE_ID_KEY = 'npfBfgBridgeIdV1';
const NPF_BFG_BRIDGE_DEVICE_SECRET_KEY = 'npfBfgBridgeDeviceSecretV1';
let npfBfgBridgeLastError = '';
let npfBfgBridgeLastStatus = 'non-testé';
let npfBfgBridgeAuthorizationPromise = null;
const NPF_BRIEFING_DOC_TYPES = Object.freeze(['fds', 'gaar']);
let npfBriefingDocsDb = null;
let npfBriefingDocsSyncInProgress = false;
let npfBriefingDocsPendingType = null;
let npfBriefingDocsBfgPairingOnly = false; // v16.00 — association BFG accessible même si NPF est déjà autorisé.
let npfBriefingDocViewerType = null;
let npfBriefingDocViewerObjectUrl = null;

const WATER_POINTS_LAYER_KEY = 'showWaterPointsLayer';
let showWaterPointsLayer = localStorage.getItem(WATER_POINTS_LAYER_KEY) === 'true';
const HIGH_VOLTAGE_LINES_LAYER_KEY = 'showHighVoltageLinesLayer';
const HIGH_VOLTAGE_LINES_GEOJSON_URL = 'lignes_ht_rte_simplifiees.geojson';
/* v17.21 — à l'échelle nautique 50 NM et au-delà, les HT restent mémorisées
 * ON mais ne sont ni chargées ni rendues. Elles reviennent automatiquement
 * sous 50 NM si l'utilisateur a laissé le bouton HT actif. */
const HIGH_VOLTAGE_LINES_HIDE_SCALE_NM = 50;
let showHighVoltageLinesLayer = localStorage.getItem(HIGH_VOLTAGE_LINES_LAYER_KEY) === 'true';
let highVoltageLinesScaleSuppressed = false;
let hasLoadedHighVoltageLines = false;
let isHighVoltageLinesLoading = false;
let highVoltageLinesFeatureCount = 0;

const ROAD_OVERLAY_LAYER_KEY = 'showRoadOverlayLayer';
const ROAD_OVERLAY_CACHE_NAME = 'npf-road-overlay-data-v1';
const ROAD_OVERLAY_MANIFEST_KEY = 'npfRoadOverlayManifestV1';
const ROAD_OVERLAY_RESOURCE_PREFIX = './__npf_road_overlay__/';
let showRoadOverlayLayer = localStorage.getItem(ROAD_OVERLAY_LAYER_KEY) === 'true';
let isRoadOverlayLoading = false;
/* v16.62 — zoom out iPad : une seule transaction lourde après stabilisation
 * réelle du pinch. Routes/HT sont masqués pendant le geste, puis reconstruits
 * une seule fois sur la vue finale avant l'unique rendu SIA. */
let npfHeavyOverlayZoomStartLevel = null;
let npfHeavyOverlayZoomSerialToken = 0;
let npfHeavyOverlayZoomOutPromise = null;
let npfHeavyOverlayZoomSettleTimer = null;
let npfHeavyOverlayPendingStartZoom = null;
let npfHeavyOverlayPendingFinalZoom = null;
let npfHeavyOverlayPendingResolve = null;
let npfHeavyOverlayPanesHidden = false;

/*
 * v17.02 — priorité d'affichage pendant les gestes carte.
 *
 * Ordre de restitution après moveend/zoomend MANUEL :
 * 0. fond/tuiles seules,
 * 1. points VFR (SIA points),
 * 2. lignes HT,
 * 3. routes.
 *
 * v17.04 : les recentrages automatiques GPS/simulation sont explicitement
 * exclus de ce séquenceur afin d'éviter tout clignotement des overlays.
 *
 * Les calques opérationnels légers (avion, feu, WP, trafic, etc.) ne sont pas
 * concernés. Le moteur de tuiles reste strictement celui de v16.75/v17.01.
 */
let npfMapOverlayPriorityActive = false;
let npfMapOverlayPriorityStage = 3;
let npfMapOverlayPriorityToken = 0;
let npfMapOverlayPriorityRestoreTimer = null;

/*
 * v17.07 — vrai verrou de geste.
 *
 * Le premier `movestart` ou `zoomstart` manuel ouvre UNE séquence.
 * Tous les autres starts émis par Leaflet pendant le même geste/pinch/burst
 * sont ignorés jusqu'à stabilisation complète.
 *
 * Le verrou n'est libéré qu'après 500 ms sans nouvel événement start/end.
 * Cette valeur est volontairement supérieure aux rafales observées dans le
 * DIAG v17.06 (plusieurs starts sur ~0,4 s).
 */
let npfMapManualGestureLockActive = false;
const NPF_MAP_MANUAL_GESTURE_SETTLE_MS = 500;

/*
 * Aucun timeout forcé pour passer de Tuiles -> VFR :
 * on attend soit toutes les tuiles visibles, soit l'arrêt réel du scheduler
 * tuiles (file=0 + lectures actives=0) stabilisé sur plusieurs passes.
 */
const NPF_MAP_OVERLAY_PRIORITY_TILE_POLL_MS = 60;
const NPF_MAP_OVERLAY_PRIORITY_TILE_STABLE_PASSES = 3;
const NPF_MAP_OVERLAY_PRIORITY_SIA_POLL_MS = 35;

const NPF_HEAVY_OVERLAY_ZOOM_SETTLE_MS = 360;
const ROAD_OVERLAY_SOURCE_FEATURE_SOFT_LIMIT = 12000;

const TRAFFIC_LAYER_KEY = 'showTrafficLayer';
// v15.98 — état du masque secondaire SafeSky (compteur vert) restauré au redémarrage.
const TRAFFIC_NON_TRACKED_VISIBLE_KEY = 'showSafeSkyNonTrackedTrafficV1';

/*
 * v14.24 — appel direct de SafeSky Production depuis NPF.
 *
 * La clé temporaire est volontairement intégrée dans le code à la demande de
 * l'utilisateur. Elle sera visible dans GitHub, le navigateur et les requêtes.
 */
const SAFESKY_API_BASE_URL =
    'https://public-api.safesky.app/v1/beacons/';
const SAFESKY_API_KEY =
    'd7a0b3c6d9d2d5d1d4b7e0c3a6c9d2f5';
const SAFESKY_PROVIDER = Object.freeze({
    label: 'SafeSky',
    baseUrl: SAFESKY_API_BASE_URL,
    urlFormat: 'viewport',
    dataFormat: 'safesky'
});
const TRAFFIC_PROVIDER_LABEL = 'SafeSky';

/*
 * SafeSky est l'unique source afin d'éviter les doublons avec les sources ADS-B
 * publiques déjà agrégées par SafeSky.
 */
const TRAFFIC_API_PROVIDERS = Object.freeze([SAFESKY_PROVIDER]);
const TRAFFIC_RADIUS_NM = 50;
const TRAFFIC_REFRESH_INTERVAL_MS = 5000;
const TRAFFIC_FETCH_TIMEOUT_MS = 7000;
const TRAFFIC_MAX_SEEN_SECONDS = 90;

/*
 * Le moteur trafic est actif. La requête est envoyée directement à SafeSky
 * avec la clé intégrée dans l'en-tête x-api-key.
 */
const TRAFFIC_DISABLED_FOR_NOW = false;
let trafficLayer = null;
let trafficAdvisoryLayer = null;
let showTrafficLayer = localStorage.getItem(TRAFFIC_LAYER_KEY) === 'true';
let isTrafficLoading = false;
// v14.94 — sérialise les rafraîchissements SafeSky et invalide les réponses obsolètes.
let trafficRefreshQueued = false;
let trafficRefreshGeneration = 0;
let trafficRefreshTimer = null;
let lastTrafficRefreshAt = 0;
let lastTrafficError = '';
let lastTrafficDisplayedCount = 0;
/*
 * v15.29 — compteurs du bouton SafeSky séparés de la quantité réellement
 * rendue lorsque le filtre « liste suivie » est actif.
 */
let lastTrafficTotalEligibleCount = 0;
let lastTrafficTrackedDetectedCount = 0;
/*
 * v15.95 — compteur vert = trafics éligibles correspondant aux filtres
 * courants, hors liste suivie. Le masque secondaire ne modifie ni la requête
 * SafeSky ni les filtres mémorisés.
 */
let lastTrafficNonTrackedEligibleCount = 0;
let showNonTrackedTraffic = localStorage.getItem(TRAFFIC_NON_TRACKED_VISIBLE_KEY) !== 'false';
let lastTrafficAircraftSnapshot = [];
let lastTrafficRenderMeta = null;

/*
 * v14.44 — déplacement fluide continu sur base v14.43.
 * Les marqueurs sont conservés entre deux réponses SafeSky et raccordés
 * progressivement aux nouvelles positions sans réintroduire les anciennes
 * zones GPS / feu ni modifier le filtre explicite des trafics au sol.
 */
const TRAFFIC_TRACKED_IDENTIFIERS_STORAGE_KEY =
    'safeSkyTrackedIdentifiersV1';

/*
 * v14.74 — indicatifs suivis permanents.
 *
 * Cette liste est intégrée au code de NPF : elle est donc automatiquement
 * recréée après une réinstallation ou un effacement du stockage local. Elle
 * est fusionnée avec les indicatifs ajoutés par l'utilisateur, sans doublon,
 * et reste permanente même lorsqu'un indicatif est associé ultérieurement à
 * son identifiant technique SafeSky.
 */
const TRAFFIC_PERMANENT_TRACKED_CALLSIGNS = Object.freeze([
    'BENGA96',
    'BENGA97',
    'BENGA98',
    'MILAN73',
    'MILAN74',
    'MILAN75',
    'MILAN76',
    'MILAN77',
    'MILAN78',
    'MILAN79',
    'MILAN80',
    'PELIC31',
    'PELIC32',
    'PELIC33',
    'PELIC34',
    'PELIC35',
    'PELIC37',
    'PELIC38',
    'PELIC39',
    'PELIC42',
    'PELIC44',
    'PELIC45',
    'PELIC48'
]);
const TRAFFIC_PERMANENT_TRACKED_CALLSIGN_SET = new Set(
    TRAFFIC_PERMANENT_TRACKED_CALLSIGNS
);
/*
 * v14.48 — l'identifiant du propre avion est volontairement temporaire.
 * sessionStorage le conserve pendant la session PWA courante, puis le navigateur
 * le supprime lorsqu'une nouvelle session réelle est créée.
 */
const TRAFFIC_OWN_AIRCRAFT_SESSION_KEY =
    'safeSkyOwnAircraftSessionV1';
let ownTrafficAircraftSessionFallback = null;
const TRAFFIC_PUBLISHED_BEACON_ID_STORAGE_KEY =
    'safeSkyPublishedBeaconIdV1';
/*
 * v14.57 — la liste suivie n'est plus plafonnée à 20 entrées.
 * La concurrence ne limite pas le nombre enregistré : elle évite seulement
 * d'envoyer toutes les interrogations SafeSky individuelles simultanément.
 */
const TRAFFIC_TRACKED_FETCH_CONCURRENCY = 6;
const TRAFFIC_VIEWPORT_IDENTIFIER_QUERY_LIMIT = 40;
const TRAFFIC_TEMPORARY_SEARCH_RESULT_TTL_MS = 10 * 60 * 1000;
const TRAFFIC_SMOOTH_FRAME_INTERVAL_MS = 50;
const TRAFFIC_SMOOTH_FRAME_INTERVAL_ROAD_TABLET_MS = 100;
const TRAFFIC_VISUAL_RESUME_AFTER_MAP_MS = 420;
/*
 * v14.72 — l'âge déjà accumulé par un point SafeSky ne doit plus
 * consommer la totalité de la période de mouvement local. Deux horizons sont
 * désormais séparés :
 * - rattrapage limité de l'horodatage source jusqu'à la réception par NPF ;
 * - extrapolation continue après réception, suffisamment longue pour couvrir
 *   le rafraîchissement SafeSky de 5 s et ses éventuels retards réseau.
 */
const TRAFFIC_SOURCE_CATCHUP_MAX_SECONDS = 20;
const TRAFFIC_MAX_EXTRAPOLATION_SECONDS = 15;
const TRAFFIC_RECONCILIATION_DURATION_MS = 900;
const TRAFFIC_RECONCILIATION_MAX_DISTANCE_NM = 3;
const TRAFFIC_MOTION_ESTIMATION_MIN_SECONDS = 0.8;
const TRAFFIC_MOTION_ESTIMATION_MAX_SECONDS = 30;
const TRAFFIC_MOTION_ESTIMATION_MAX_SPEED_KNOTS = 750;
const SAFESKY_OWN_PUBLISH_INTERVAL_MS = 5000;

let trafficMarkerRegistry = new Map();
let trafficSmoothAnimationFrame = null;
let trafficSmoothAnimationLastAt = 0;
/*
 * v15.00 — plusieurs opérations lourdes peuvent demander une suspension
 * visuelle simultanée. Un Set évite qu'une reprise prématurée relance SafeSky
 * alors qu'un zoom ou le calque routier est encore en cours de rendu.
 */
const trafficVisualSuspensionReasons = new Set();
let trafficVisualResumeTimer = null;
let trafficVisualMapSequenceToken = 0;
let temporaryGlobalTrafficResults = new Map();
let safeSkyOwnPublishTimer = null;
let safeSkyOwnPublishInProgress = false;
let lastSafeSkyOwnPublishAt = 0;
let lastSafeSkyOwnPublishError = '';
let ownPublicationMotionState = null;

/*
 * v16.99 — breadcrumb minimal SafeSky.
 * Il ne contient aucune position ni identifiant : uniquement des compteurs et
 * la phase du rendu. Il permet de savoir, après un reload Safari, si le dernier
 * passage s'est interrompu entre `render-start` et `render-complete`.
 */
const TRAFFIC_DIAG_BREADCRUMB_KEY = 'npfTrafficDiagBreadcrumbV16_99';
const TRAFFIC_DIAG_BREADCRUMB_MAX_AGE_MS = 6 * 60 * 60 * 1000;
let trafficDiagRefreshSeq = 0;

function getTrafficDiagLayerCount() {
    try { return Number(trafficLayer?.getLayers?.().length || 0); }
    catch (_) { return 0; }
}

function writeTrafficDiagBreadcrumb(payload = {}) {
    try {
        localStorage.setItem(
            TRAFFIC_DIAG_BREADCRUMB_KEY,
            JSON.stringify({
                build: NPF_SCRIPT_BUILD_VERSION,
                at: Date.now(),
                ...payload
            })
        );
    } catch (_) {}
}

function restoreTrafficDiagBreadcrumb() {
    try {
        const value = JSON.parse(
            localStorage.getItem(TRAFFIC_DIAG_BREADCRUMB_KEY) || 'null'
        );
        if (
            !value
            || !Number.isFinite(Number(value.at))
            || Date.now() - Number(value.at) > TRAFFIC_DIAG_BREADCRUMB_MAX_AGE_MS
        ) {
            return;
        }

        npfDiagSiaInteraction(
            'TRAFIC SS RESTAURÉ',
            `phase=${String(value.phase || 'inconnue')}`,
            {
                previousBuild: String(value.build || ''),
                seq: Math.max(0, Number(value.seq) || 0),
                raw: Math.max(0, Number(value.raw) || 0),
                registryBefore: Math.max(0, Number(value.registryBefore) || 0),
                registryAfter: Math.max(0, Number(value.registryAfter) || 0),
                renderMs: Math.max(0, Number(value.renderMs) || 0)
            }
        );
    } catch (_) {}
}

restoreTrafficDiagBreadcrumb();

/*
 * v16.02 — diagnostic performance à la demande, sans journal ni historique
 * conservé en mémoire. Utile pour vérifier qu'aucun registre Leaflet ne grossit
 * au fil des heures. Appel console : getNpfPerformanceDiagnostics().
 */
window.getNpfPerformanceDiagnostics = () => ({
    at: new Date().toISOString(),
    visibility: document.visibilityState,
    trafficMarkers: trafficMarkerRegistry.size,
    trafficLeafletLayers: Number(trafficLayer?.getLayers?.().length || 0),
    globalLinkLeafletLayers: Number(npfGlobalLinkLayer?.getLayers?.().length || 0),
    communesLeafletLayers: Number(communesLayerGroup?.getLayers?.().length || 0),
    communeLabelLayers: Number(communesLabelsLayer?.getLayers?.().length || 0),
    roadCasingLayers: Number(roadOverlayCasingLayer?.getLayers?.().length || 0),
    roadLineLayers: Number(roadOverlayLineLayer?.getLayers?.().length || 0),
    roadLabelLayers: Number(roadOverlayLabelsLayer?.getLayers?.().length || 0),
    trafficSmoothAnimationActive: Boolean(trafficSmoothAnimationFrame),
    trafficRefreshTimerActive: Boolean(trafficRefreshTimer),
    globalLinkRefreshTimerActive: Boolean(npfGlobalLinkRefreshTimer)
});

const TRAFFIC_SETTINGS_STORAGE_KEY = 'trafficLayerSettingsV1';
const DEFAULT_TRAFFIC_SETTINGS = Object.freeze({
    radiusNm: TRAFFIC_RADIUS_NM,
    minAltitudeFt: 0,
    maxAltitudeFt: null,
    showAltitudeLabel: false,
    altitudeFilterMode: 'absolute',
    relativeAltitudeEnabled: false,
    relativeAltitudeBandFt: 1500,
    groundToAboveBandFt: 1500,
    /*
     * v14.44 — la zone trafic est toujours centrée sur la carte.
     * Les deux anciennes options GPS / feu restent neutralisées pour assurer
     * la migration des réglages déjà stockés.
     */
    trafficAroundOwnPosition: false,
    trafficAroundFire: false,
    showGroundTraffic: false,
    showDroneAdvisories: false,
    onlyTrackedIdentifiers: false,
    // v16.01 — masque les familles avion / hélicoptère sans masquer les planeurs.
    onlyNonAirplaneHelicopterTraffic: false,
    publishOwnPosition: false,
    publicationCallsign: '',
    publicationBeaconType: 'MOTORPLANE'
});
let trafficSettings = loadTrafficSettings();
const FIRE_HISTORY_STORAGE_KEY = 'fireHistoryV1';
const FIRE_HISTORY_COLLAPSED_STORAGE_KEY = 'fireHistoryCollapsedV1';
const FIRE_HISTORY_MAX_ITEMS = 20;
const FORCE_DISPLAY_MODE = new URLSearchParams(window.location.search).get('force_display') === '1';
const SHOW_DEPARTMENTS_LAYER_KEY = 'showDepartmentsLayer';
const SHOW_COMMUNES_LAYER_KEY = 'showCommunesLayer';
const GAAR_LAYER_VISIBLE_KEY = 'showGaarLayerV1';
const LAST_GPS_POSITION_KEY = 'lastGpsPositionV1';
const COMMUNES_DISPLAY_MIN_ZOOM = 10.5;
const ONLINE_MAX_NATIVE_ZOOM = 18;
const OFFLINE_FALLBACK_NATIVE_ZOOM = 14;
const OFFLINE_HARD_MAX_NATIVE_ZOOM = 13;
// v13.58 — iPad : démarrage offline séquencé, sans scan IndexedDB lourd au lancement.
// v16.42 — mémoire iPad : petit tampon NPF pour éviter l'accumulation de niveaux de zoom décodés.
const OFFLINE_TILE_KEEP_BUFFER = 4;
const NPF_OFFLINE_TILE_KEEP_BUFFER = 2;
const OFFLINE_TILE_UPDATE_INTERVAL_MS = 80;
// Tuile neutre opaque : évite l'effet page blanche si une tuile manque brièvement.
const OFFLINE_TILE_PLACEHOLDER_DATA_URL = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22256%22%20height%3D%22256%22%3E%3Crect%20width%3D%22256%22%20height%3D%22256%22%20fill%3D%22%23d8e2e8%22/%3E%3C/svg%3E';
// Carte OACI/IGN : plafond plus strict pour éviter de demander des tuiles inexistantes.
const OACI_OFFLINE_MAX_NATIVE_ZOOM = 10;
/* v15.43 — OACI : un seul niveau de sur-zoom entier, sans nouvelle tuile. */
const OACI_OFFLINE_MAX_DISPLAY_ZOOM = 11;
const OFFLINE_TILE_WAKE_DELAYS_MS = [250, 900, 1800, 3500, 6500, 10000];
const OFFLINE_AUX_LAYER_START_DELAY_MS = 6500;
const OFFLINE_DISABLE_STARTUP_FORCE_SCAN = true;
let offlineTileWakeToken = 0;
// v14.94 — rafraîchissement léger et dédupliqué du fond de carte après un geste/UI lourd.
let baseMapStabilityRefreshToken = 0;
/* Travail après v16.60 — un pinch iPad peut émettre plusieurs zoomend/moveend
 * intermédiaires. La priorité/purge des tuiles NPF ne doit être validée qu'une
 * fois lorsque le geste est réellement stabilisé. */
let directOfflineNpfZoomSettleTimer = null;
const DIRECT_OFFLINE_NPF_ZOOM_SETTLE_MS = 240;
let offlineStartupLayerRecoveryToken = 0;
let offlineMapSwitchToken = 0;
let highVoltageLinesRetryToken = 0;
const GLOBAL_MAX_ZOOM = 18;
const GLOBAL_MIN_ZOOM = 0;
let baseTileMaxNativeZoom = ONLINE_MAX_NATIVE_ZOOM;
let baseTileMinNativeZoom = GLOBAL_MIN_ZOOM;
let offlineTilesMode = DEFAULT_OFFLINE_TILES_ENABLED;
let mapSourceMode = DEFAULT_MAP_SOURCE_MODE;
let offlineOnlineFallbackMode = DEFAULT_OFFLINE_ONLINE_FALLBACK;
let activeOfflinePacks = [];
let activeOfflinePackDatabases = [];
let activeOfflinePackAliases = [];
let isMapSourceSwitching = false;
let isZipImportRunning = false;
const STARTUP_GPS_CENTER_ZOOM = 10;
const UPDATE_REMINDER_STORAGE_KEY = 'npfUpdateReminderLastShownAt';
const UPDATE_REMINDER_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000;
let startupGpsAutoCenteredWithRealPosition = false;
let startupGpsStoredCenterAppliedAt = 0;
let isSimulationMode = false;
let simulationMapClickHandler = null;
let simulationSuppressNextClickUntil = 0;
let simulationActionPopup = null;
let simulationWasLiveGpsActiveBeforeSimulation = false;

const SIMULATION_SPEED_STORAGE_KEY = 'npfSimulationSpeedKt';
const SIMULATION_ROUTE_STORAGE_KEY = 'npfSimulationRouteDeg';
const SIMULATION_ALTITUDE_STORAGE_KEY = 'npfSimulationAltitudeFt';
const storedSimulationSpeedKt = Number(localStorage.getItem(SIMULATION_SPEED_STORAGE_KEY));
const storedSimulationRouteDeg = Number(localStorage.getItem(SIMULATION_ROUTE_STORAGE_KEY));
const storedSimulationAltitudeFt = Number(localStorage.getItem(SIMULATION_ALTITUDE_STORAGE_KEY));

let simulationSpeedKt = Number.isFinite(storedSimulationSpeedKt)
    ? Math.min(700, Math.max(0, storedSimulationSpeedKt))
    : 0;
let simulationRouteDeg = Number.isFinite(storedSimulationRouteDeg)
    ? ((storedSimulationRouteDeg % 360) + 360) % 360
    : 0;
let simulationAltitudeFt = Number.isFinite(storedSimulationAltitudeFt)
    ? Math.min(60000, Math.max(-1000, storedSimulationAltitudeFt))
    : 0;
let simulationMotionTimer = null;
let simulationMotionLastTickMs = 0;
let simulationAircraftPositionReady = false;
// v15.74 — état cinématique dédié : la simulation ne dépend plus de lastPosition.
let simulationMotionLatitude = null;
let simulationMotionLongitude = null;
const SIMULATION_MOTION_INTERVAL_MS = 500;
/*
 * v17.16 — l'avion continue à avancer toutes les 500 ms, mais les traitements
 * visuels/lourds ne doivent plus être reconstruits à chaque pas de simulation.
 * Le suivi carte accepte aussi une dérive minime avant un nouveau setView.
 */
const SIMULATION_VISUAL_REFRESH_INTERVAL_MS = 1000;
const SIMULATION_HEAVY_REFRESH_INTERVAL_MS = 2500;
const SIMULATION_FOLLOW_RECENTER_DELAY_MS = 5000;
const SIMULATION_FOLLOW_MIN_CENTER_SHIFT_PX = 8;
let simulationLastVisualRefreshMs = 0;
let simulationLastHeavyRefreshMs = 0;

// v12.22 — sécurité : un import interrompu ne doit pas bloquer les suppressions suivantes.
try {
    sessionStorage.removeItem('npfZipImportRunning');
} catch (_) {}
const CHAT_STORAGE_KEY = 'teamChatConfig';
const CHAT_HISTORY_KEY = 'teamChatHistory';
let chatClient = null;
let chatTopic = null;
let chatHistoryTopic = null;
let chatPresenceTopic = null;
let chatLocationTopic = null;
let chatConnected = false;
const CHAT_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const MQTT_SCRIPT_URL = 'https://unpkg.com/mqtt/dist/mqtt.min.js';

