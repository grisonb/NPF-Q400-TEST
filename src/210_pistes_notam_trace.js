let npfRunwayLastRenderSignature = '';
let npfRunwayRefreshTimer = null;

function getNpfRunwayViewportBounds() {
    try {
        return map?.getBounds?.()?.pad?.(0.28) || null;
    } catch (_) {
        return null;
    }
}

function npfRunwayIntersectsBounds(runway, bounds) {
    if (!runway || !bounds) return true;
    const minLat = Math.min(Number(runway.leLat), Number(runway.heLat));
    const maxLat = Math.max(Number(runway.leLat), Number(runway.heLat));
    const minLon = Math.min(Number(runway.leLon), Number(runway.heLon));
    const maxLon = Math.max(Number(runway.leLon), Number(runway.heLon));
    if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) return false;
    return !(
        maxLon < bounds.getWest()
        || minLon > bounds.getEast()
        || maxLat < bounds.getSouth()
        || minLat > bounds.getNorth()
    );
}

function drawNpfRunwayMapLayer(force = false) {
    if (!npfRunwayMapLayer || !map) return;

    const zoom = Number(map.getZoom());
    if (!Number.isFinite(zoom) || zoom < NPF_RUNWAY_MIN_ZOOM) {
        if (npfRunwayMapLayer.getLayers?.().length) npfRunwayMapLayer.clearLayers();
        npfRunwayLastRenderSignature = `off|${zoom}`;
        return;
    }

    const bounds = getNpfRunwayViewportBounds();
    const visibleRunways = [];

    const collectRunways = (runwaysByOaci) => {
        runwaysByOaci.forEach(runways => {
            runways.forEach(runway => {
                if (npfRunwayIntersectsBounds(runway, bounds)) visibleRunways.push(runway);
            });
        });
    };

    collectRunways(additionalAerodromeRunwaysByOaci);
    collectRunways(declaredPelicanRunwaysByOaci);
    collectRunways(otherAirportRunwaysByOaci);

    const signature = visibleRunways
        .map(runway => `${runway.oaci}:${runway.ident}:${Number(runway.leLat).toFixed(4)}:${Number(runway.leLon).toFixed(4)}`)
        .sort()
        .join('|');

    if (!force && signature === npfRunwayLastRenderSignature) return;
    npfRunwayLastRenderSignature = signature;
    npfRunwayMapLayer.clearLayers();

    visibleRunways.forEach(runway => {
        const endpoints = [
            [runway.leLat, runway.leLon],
            [runway.heLat, runway.heLon]
        ];

        L.polyline(endpoints, {
            color: '#ffffff',
            weight: 5,
            opacity: 0.96,
            lineCap: 'butt',
            lineJoin: 'miter',
            interactive: false,
            pane: 'npfRunwaysPane',
            renderer: npfRunwayRenderer || undefined
        }).addTo(npfRunwayMapLayer);

        L.polyline(endpoints, {
            color: '#111111',
            weight: 2.4,
            opacity: 1,
            lineCap: 'butt',
            lineJoin: 'miter',
            interactive: false,
            pane: 'npfRunwaysPane',
            renderer: npfRunwayRenderer || undefined
        }).addTo(npfRunwayMapLayer);
    });
}

function scheduleNpfRunwayMapRefresh(source = 'map-change') {
    clearTimeout(npfRunwayRefreshTimer);
    npfRunwayRefreshTimer = setTimeout(() => {
        npfRunwayRefreshTimer = null;
        drawNpfRunwayMapLayer(false);
    }, source === 'zoomend' ? 90 : 180);
}



/*
 * Fiche PÉLIC — maintien dans la zone visible de la carte.
 *
 * Leaflet ancre normalement la popup à l'icône et peut donc placer une grande
 * fiche en partie hors écran lorsqu'un PÉLIC se trouve près du bord supérieur.
 * Pour les PÉLIC uniquement, on laisse la carte immobile puis on descend la
 * popup elle-même si nécessaire. La fiche peut donc être visuellement séparée
 * de l'icône : la priorité est donnée à la lisibilité complète des commandes.
 */
const NPF_PELIC_POPUP_CLASS = 'npf-pelic-leaflet-popup';
const NPF_PELIC_POPUP_MARGIN_PX = 10;

function getNpfPelicPopupOptions(extraOptions = {}) {
    return {
        maxWidth: 330,
        closeButton: true,
        autoPan: false,
        className: NPF_PELIC_POPUP_CLASS,
        ...extraOptions
    };
}

function getNpfPelicPopupSafeTop(popupRect, mapRect) {
    let safeTop = mapRect.top + NPF_PELIC_POPUP_MARGIN_PX;

    /*
     * Les bandeaux supérieurs font partie de la zone réellement occupée sur
     * l'iPad. Si la popup les recouvre horizontalement, elle est placée sous
     * leur bord inférieur plutôt que simplement sous le bord physique du map.
     */
    ['#bingo-map-display', '#commune-info-display', '#npf-waypoint-route-banner']
        .forEach(selector => {
            const element = document.querySelector(selector);
            if (!element) return;
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
            const rect = element.getBoundingClientRect();
            if (!(rect.width > 0 && rect.height > 0)) return;
            const horizontalOverlap = Math.min(popupRect.right, rect.right) - Math.max(popupRect.left, rect.left);
            if (horizontalOverlap <= 0) return;
            if (rect.bottom <= mapRect.top || rect.top >= mapRect.bottom) return;
            safeTop = Math.max(safeTop, rect.bottom + 8);
        });

    return safeTop;
}

function repositionNpfPelicPopupIfNeeded(popup) {
    if (!popup || !map) return;
    const className = String(popup?.options?.className || '');
    if (!className.split(/\s+/).includes(NPF_PELIC_POPUP_CLASS)) return;

    const container = typeof popup.getElement === 'function'
        ? popup.getElement()
        : popup._container;
    const mapContainer = typeof map.getContainer === 'function' ? map.getContainer() : null;
    if (!container || !mapContainer) return;

    /* Repart toujours de la position Leaflet normale avant de calculer le décalage. */
    try {
        if (typeof popup._updatePosition === 'function') popup._updatePosition();
    } catch (_) {}

    const popupRect = container.getBoundingClientRect();
    const mapRect = mapContainer.getBoundingClientRect();
    const safeTop = getNpfPelicPopupSafeTop(popupRect, mapRect);
    const shiftDown = Math.ceil(safeTop - popupRect.top);
    if (!(shiftDown > 0)) return;

    const currentBottom = Number.parseFloat(container.style.bottom);
    if (!Number.isFinite(currentBottom)) return;

    /* Diminuer bottom déplace la popup vers le bas sans déplacer la carte. */
    container.style.bottom = `${currentBottom - shiftDown}px`;
    container.dataset.npfPelicPopupShift = String(shiftDown);
}

function scheduleNpfPelicPopupReposition(popup) {
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => repositionNpfPelicPopupIfNeeded(popup));
    });
}

function addAirportTouchHitbox(airport, popupHtml) {
    /*
     * v15.50 — correction tactile ciblée.
     *
     * Les DIV transparents 64 × 64 px introduits en v15.49 ne sont pas
     * suffisamment fiables sur Safari/iPad. Retour au mécanisme Leaflet Path
     * qui fonctionnait avant l'arrivée des couches SIA, mais :
     * - rayon porté à 32 px (64 px de diamètre) ;
     * - renderer SVG dédié dans npfTouchPane z665 ;
     * - remplissage quasi invisible (0.002) et non totalement transparent afin
     *   que WebKit conserve toujours la surface dans son hit-testing ;
     * - bubblingMouseEvents=false pour empêcher le clic carte de prendre le pas.
     */
    if (!airport || !Number.isFinite(Number(airport.lat)) || !Number.isFinite(Number(airport.lon)) || !popupHtml) return null;

    ensureSiaMapPanes();
    const hitbox = L.circleMarker([airport.lat, airport.lon], {
        pane: 'npfTouchPane',
        renderer: npfTouchRenderer || undefined,
        radius: 32,
        stroke: false,
        color: '#000000',
        opacity: 0,
        fill: true,
        fillColor: '#000000',
        fillOpacity: 0.002,
        interactive: true,
        bubblingMouseEvents: false,
        keyboard: false
    });

    const pelicPopup = typeof isSelectablePelicanAirport === 'function' && isSelectablePelicanAirport(airport.oaci);
    hitbox.bindPopup(popupHtml, pelicPopup ? getNpfPelicPopupOptions({ maxWidth: 390 }) : { maxWidth: 300 });
    hitbox.on('click', event => {
        try {
            if (event?.originalEvent) {
                L.DomEvent.stopPropagation(event.originalEvent);
            }
        } catch (_) {}

        /*
         * v16.12 — la grande hitbox aéroport (64 px) ne doit plus voler le clic
         * d'un losange WP situé dessus ou juste à côté. Seule la petite zone
         * du WP (30 px autour de son centre) est prioritaire.
         */
        if (window.__npfWaypointRouteReady === true
            && openNpfWaypointPopupNearLatLng(
                event?.latlng || hitbox.getLatLng(),
                NPF_WAYPOINT_SELECT_TOLERANCE_PX
            )) {
            return;
        }

        try {
            hitbox.setPopupContent(refreshAirportWaypointPopupHtml(popupHtml, airport.oaci));
            hitbox.openPopup();
        } catch (_) {}
    });
    hitbox.addTo(permanentAirportLayer);
    try { if (hitbox.bringToFront) hitbox.bringToFront(); } catch (_) {}
    return hitbox;
}

/*
 * v15.88 — PÉLIC : avion noir restauré + taille visuelle liée au zoom.
 * Les états opérationnels sont portés par le cercle : vert RETARDANT, bleu EAU,
 * rouge + X pour un terrain désactivé. La hitbox tactile reste indépendante.
 */
function buildPelicanAircraftSymbolHtml() {
    return `<svg class="pelic-aircraft-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11.2 2.4c0-.9 1.6-.9 1.6 0v5.7l7.7 3.9c.7.35 1 .95.8 1.6l-.35 1.15-8.15-1.95v5.1l2.75 2.05-.3 1.25L12 20.3l-3.25.9-.3-1.25 2.75-2.05v-5.1l-8.15 1.95-.35-1.15c-.2-.65.1-1.25.8-1.6l7.7-3.9V2.4Z"/></svg>`;
}

function buildPelicanDisabledSymbolHtml() {
    return '<span class="pelic-disabled-x" aria-hidden="true"></span>';
}

function getPelicanVisualMetricsForZoom(zoomValue) {
    const zoom = Number.isFinite(Number(zoomValue)) ? Number(zoomValue) : 9;
    if (zoom >= 9) return { size: 26, border: 4, aircraft: 17, xSize: 14, xLine: 16, xWeight: 3 };
    if (zoom >= 8) return { size: 22, border: 3.5, aircraft: 14.5, xSize: 12, xLine: 14, xWeight: 2.6 };
    if (zoom >= 7) return { size: 18, border: 3, aircraft: 12, xSize: 10, xLine: 12, xWeight: 2.3 };
    return { size: 14, border: 2, aircraft: 9, xSize: 8, xLine: 9.5, xWeight: 2 };
}

function applyPelicanVisualScale() {
    const metrics = getPelicanVisualMetricsForZoom(map && Number.isFinite(map.getZoom()) ? map.getZoom() : 9);
    const root = document.documentElement;
    if (!root) return;
    root.style.setProperty('--npf-pelic-size', `${metrics.size}px`);
    root.style.setProperty('--npf-pelic-border', `${metrics.border}px`);
    root.style.setProperty('--npf-pelic-aircraft-size', `${metrics.aircraft}px`);
    root.style.setProperty('--npf-pelic-x-size', `${metrics.xSize}px`);
    root.style.setProperty('--npf-pelic-x-line', `${metrics.xLine}px`);
    root.style.setProperty('--npf-pelic-x-weight', `${metrics.xWeight}px`);
}

function buildPelicanMapIconClass(airport, isDisabled, isWater) {
    const classes = [
        'custom-marker-icon',
        'airport-marker-base',
        'airport-marker-pelic'
    ];
    if (isDisabled) classes.push('airport-marker-disabled');
    else classes.push(isWater ? 'airport-marker-water' : 'airport-marker-retardant');
    if (!isDisabled && selectedPelicanOACI === airport?.oaci) {
        classes.push('airport-marker-selected');
    }
    return classes.join(' ');
}

/* ========================================================================== 
   v16.07 — NOTAMS PÉLIC : SNAPSHOT NAS / FILTRES BFG
   --------------------------------------------------------------------------
   Les PWA BFG et NPF installées sur iPad peuvent être isolées par WebKit.
   BFG v4.61 publie donc le snapshot NOTAM sur le NAS. NPF le récupère
   silencieusement lorsqu'il dispose du réseau et de l'autorisation BFG/NPF,
   puis l'enregistre dans son propre IndexedDB. L'ouverture de la fenêtre NOTAMS
   reste ensuite 100 % locale et hors ligne.
   ========================================================================== */
const NPF_BFG_NOTAMS_DB_NAME = 'NpfBfgNotamsDB';
const NPF_BFG_NOTAMS_DB_VERSION = 1;
const NPF_BFG_NOTAMS_STORE_NAME = 'snapshots';
const NPF_BFG_NOTAMS_RECORD_ID = 'current';
// Ancien canal v16.05 conservé uniquement comme migration éventuelle.
const NPF_BFG_NOTAMS_SHARED_CACHE_NAME = 'bfg-npf-shared-notams-v1';
const NPF_BFG_NOTAMS_SHARED_LOCAL_KEY = 'bfgNpfSharedNotamsV1';
const NPF_BFG_NOTAMS_SHARED_URL_PATH = '/__bfg_npf_shared__/notams-v1.json';
let npfBfgNotamsDb = null;
let npfBfgNotamsSyncPromise = null;
let npfPelicNotamsCurrentPayload = null;
let npfPelicNotamsCurrentOaci = '';
let npfPelicNotamsViewMode = 'all';
const NPF_PELIC_NOTAMS_KEYWORDS_TO_FILTER = Object.freeze([
    'administration',
    'aerodrome administration',
    'air start',
    'altitude',
    'animal',
    'avgas 100ll',
    'construction',
    'crane',
    'dme',
    'drill',
    'fato',
    'grf',
    'handling',
    'lights',
    'model flying',
    'nacelle',
    'night parachuting',
    'obst',
    'obstacle',
    'obstacles',
    'papi',
    'police',
    'radar',
    'rffs',
    'security',
    'telescopic',
    'trees',
    'ul',
    'unpaved',
    'vdf',
    'vor',
    'wig wag'
]);

/*
 * v17.29 — NOTAM DES TERRAINS NPF (114 depuis v17.30) : la couverture est lue dans le champ
 * `coverage` du fichier produit par le NAS. Elle est recopiée en localStorage
 * afin que les popups des terrains soient justes dès le premier tracé, avant
 * toute lecture IndexedDB. Fichier sans `coverage` (ancienne publication BFG)
 * ou aucune copie locale : retour aux 27 pélicandromes.
 */
const NPF_NOTAMS_COVERAGE_LOCAL_KEY = 'npfNotamsCoverageV1';

function getNpfNotamsFallbackCoverage() {
    return pelicanAirports
        .map(airport => String(airport?.oaci || '').trim().toUpperCase())
        .filter(Boolean);
}

function getNpfNotamsCoverageFromPayload(payload) {
    const coverage = Array.isArray(payload?.coverage)
        ? payload.coverage
            .map(code => String(code || '').trim().toUpperCase())
            .filter(code => /^[A-Z0-9]{4}$/.test(code))
        : [];
    return coverage.length ? coverage : getNpfNotamsFallbackCoverage();
}

function loadNpfNotamsCoverageSet() {
    try {
        const stored = JSON.parse(localStorage.getItem(NPF_NOTAMS_COVERAGE_LOCAL_KEY) || 'null');
        if (Array.isArray(stored) && stored.length) {
            return new Set(stored.map(code => String(code || '').trim().toUpperCase()).filter(Boolean));
        }
    } catch (_) {}
    return new Set(getNpfNotamsFallbackCoverage());
}

let npfNotamsCoverageSet = loadNpfNotamsCoverageSet();

function isNpfNotamsAirportCovered(oaci) {
    return npfNotamsCoverageSet.has(String(oaci || '').trim().toUpperCase());
}

function applyNpfNotamsCoverageFromPayload(payload) {
    const next = getNpfNotamsCoverageFromPayload(payload);
    const changed = next.length !== npfNotamsCoverageSet.size
        || next.some(code => !npfNotamsCoverageSet.has(code));
    try { localStorage.setItem(NPF_NOTAMS_COVERAGE_LOCAL_KEY, JSON.stringify(next)); } catch (_) {}
    if (!changed) return false;
    npfNotamsCoverageSet = new Set(next);
    // Le bouton NOTAMS est porté par les popups des terrains : un seul retracé.
    try {
        if (map && permanentAirportLayer) drawPermanentAirportMarkers();
    } catch (_) {}
    return true;
}

async function reconcileNpfNotamsCoverageFromLocalRecord() {
    try {
        const record = await getNpfBfgNotamsLocalRecord();
        if (record?.payload) applyNpfNotamsCoverageFromPayload(record.payload);
    } catch (_) {}
}

function formatNpfNotamsParisDate(value, options) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...options }).formatToParts(date);
        return Object.fromEntries(parts.map(part => [part.type, part.value]));
    } catch (_) {
        return null;
    }
}

function formatNpfNotamsParisDayMonth(value) {
    const parts = formatNpfNotamsParisDate(value, { day: '2-digit', month: '2-digit' });
    return parts ? `${parts.day}/${parts.month}` : '';
}

function formatNpfNotamsParisHourMinute(value) {
    const parts = formatNpfNotamsParisDate(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return parts ? `${parts.hour}h${parts.minute}` : '';
}

function getNpfNotamsSourceIso(payload) {
    return String(payload?.notamsAutoPdfStatus?.timestampIso || payload?.publishedAt || '').trim();
}

/* v17.29 — un fichier qui n'est pas du jour est affiché avec cet avertissement. */
function getNpfNotamsStaleWarningText(payload) {
    if (isNpfPelicNotamsPayloadCurrentToday(payload)) return '';
    const dayMonth = formatNpfNotamsParisDayMonth(getNpfNotamsSourceIso(payload));
    return dayMonth ? `NOTAM du ${dayMonth} — pas à jour` : 'NOTAM — pas à jour';
}

function getNpfNotamsCopyLabel(payload) {
    if (isNpfPelicNotamsPayloadCurrentToday(payload)) return 'copie locale du jour';
    const dayMonth = formatNpfNotamsParisDayMonth(getNpfNotamsSourceIso(payload));
    return dayMonth ? `copie locale du ${dayMonth}` : 'copie locale';
}

/*
 * v17.29 — SÉLECTIONS INDIVIDUELLES : elles restent sur cet iPad et ne sont
 * jamais envoyées au NAS. Un éventuel `state` présent dans le fichier du NAS
 * est ignoré. Lors du remplacement de la copie locale, une sélection n'est
 * conservée que si son NOTAM existe toujours avec le même identifiant ET la
 * même signature de texte ; sinon elle repart à zéro.
 */
function carryOverNpfNotamsLocalSelections(previousPayload, nextPayload) {
    const previousById = previousPayload?.state?.byId;
    if (!previousById || typeof previousById !== 'object') return null;

    const signaturesByOaci = new Map();
    const kept = {};
    Object.entries(previousById).forEach(([id, entry]) => {
        if (!entry || typeof entry !== 'object') return;
        const oaci = String(id || '').split('-')[0].toUpperCase();
        if (!oaci) return;
        if (!signaturesByOaci.has(oaci)) {
            signaturesByOaci.set(oaci, new Map(
                extractNpfBfgNotamsForOaci(nextPayload?.notamText || '', oaci)
                    .map(record => [record.id, record.signature])
            ));
        }
        const signature = signaturesByOaci.get(oaci).get(id);
        const expected = String(entry.textSignature || entry.signature || '').trim();
        if (signature && expected && expected === signature) kept[id] = entry;
    });

    if (!Object.keys(kept).length) return null;
    return {
        version: 'persistentNotamStateV1',
        updatedAt: String(previousPayload.state.updatedAt || new Date().toISOString()),
        byId: kept
    };
}

function getNpfBfgNotamsSharedUrl() {
    try {
        return new URL(NPF_BFG_NOTAMS_SHARED_URL_PATH, window.location.origin).toString();
    } catch (_) {
        return NPF_BFG_NOTAMS_SHARED_URL_PATH;
    }
}

function initNpfBfgNotamsDb() {
    if (npfBfgNotamsDb) return Promise.resolve(npfBfgNotamsDb);
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('IndexedDB indisponible')); return; }
        const request = indexedDB.open(NPF_BFG_NOTAMS_DB_NAME, NPF_BFG_NOTAMS_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(NPF_BFG_NOTAMS_STORE_NAME)) {
                db.createObjectStore(NPF_BFG_NOTAMS_STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => {
            npfBfgNotamsDb = request.result;
            npfBfgNotamsDb.onversionchange = () => {
                try { npfBfgNotamsDb.close(); } catch (_) {}
                npfBfgNotamsDb = null;
            };
            resolve(npfBfgNotamsDb);
        };
        request.onerror = () => reject(request.error || new Error('Base NOTAM NPF indisponible'));
        request.onblocked = () => reject(new Error('Base NOTAM NPF bloquée'));
    });
}

async function getNpfBfgNotamsLocalRecord() {
    const db = await initNpfBfgNotamsDb();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(NPF_BFG_NOTAMS_STORE_NAME, 'readonly');
        const request = tx.objectStore(NPF_BFG_NOTAMS_STORE_NAME).get(NPF_BFG_NOTAMS_RECORD_ID);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Lecture NOTAM locale impossible'));
    });
}

async function putNpfBfgNotamsLocalPayload(payload, options = {}) {
    if (!payload || payload.version !== 'bfgNpfNotamsV1') return false;
    const db = await initNpfBfgNotamsDb();
    const record = {
        id: NPF_BFG_NOTAMS_RECORD_ID,
        payload,
        remotePublishedAt: String(options.remotePublishedAt || payload.remotePublishedAt || payload.publishedAt || ''),
        cachedAt: new Date().toISOString()
    };
    await new Promise((resolve, reject) => {
        const tx = db.transaction(NPF_BFG_NOTAMS_STORE_NAME, 'readwrite');
        tx.objectStore(NPF_BFG_NOTAMS_STORE_NAME).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Enregistrement NOTAM local impossible'));
        tx.onabort = () => reject(tx.error || new Error('Enregistrement NOTAM local interrompu'));
    });
    return true;
}

function npfPelicNotamsParisDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Paris',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${byType.year || ''}-${byType.month || ''}-${byType.day || ''}`;
    } catch (_) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
}

function isNpfPelicNotamsPayloadCurrentToday(payload) {
    const timestampIso = String(payload?.notamsAutoPdfStatus?.timestampIso || '').trim();
    if (!timestampIso) return false;
    const sourceDay = npfPelicNotamsParisDateKey(timestampIso);
    const today = npfPelicNotamsParisDateKey(new Date());
    return Boolean(sourceDay && today && sourceDay === today);
}

function normalizeNpfBfgNotamTextForState(text) {
    return String(text || '')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function hashNpfBfgNotamTextForState(text) {
    const input = normalizeNpfBfgNotamTextForState(text);
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function createNpfBfgNotamRecord(notamText, icao) {
    const normalizedOaci = String(icao || '').trim().toUpperCase();
    const text = String(notamText || '').trim();
    const signature = hashNpfBfgNotamTextForState(text);
    const firstLine = text.split('\n')[0] || '';
    const notamNumberMatch = firstLine.match(/([A-Z]\d{4}\/\d{2})$/);
    const notamNumber = notamNumberMatch ? notamNumberMatch[1].replace('/', '-') : null;
    let id = '';

    if (notamNumber) {
        id = `${normalizedOaci}-${notamNumber}`;
    } else {
        const bMatch = text.match(/B\)\s*(\d{10})/);
        const cMatch = text.match(/C\)\s*(\d{10}|PERM)/);
        if (bMatch && cMatch) id = `${normalizedOaci}-${bMatch[1]}-${cMatch[1]}`;
    }

    if (!id) id = `${normalizedOaci}-SIG-${signature}`;
    return { id, signature, text };
}

function extractNpfBfgNotamsForOaci(rawText, targetOaci) {
    const normalizedOaci = String(targetOaci || '').trim().toUpperCase();
    if (!normalizedOaci) return [];

    const airportSections = String(rawText || '').split(/\n\s*(?=LF[A-Z]{2}\s+-\s+)/);
    let matchingSection = null;

    for (const section of airportSections) {
        const lines = String(section || '').trim().split('\n');
        const header = lines.shift() || '';
        if (!header.match(/^LF[A-Z]{2}\s+-\s+/)) continue;
        if (header.split(' ')[0].toUpperCase() !== normalizedOaci) continue;
        matchingSection = { header, lines };
        break;
    }

    if (!matchingSection) return [];
    if (matchingSection.header.includes('No information received')) return [];

    const content = matchingSection.lines.join('\n').replace(/Page \d+ of \d+\s*\n?/gi, '');
    let currentNotamNumber = '';
    const processedBlocks = [];

    content.split('\n').forEach(line => {
        const notamNumberMatch = line.match(/([A-Z]\d{4}\/\d{2})$/);
        if (notamNumberMatch) currentNotamNumber = notamNumberMatch[1];
        if (line.startsWith('Q)')) {
            processedBlocks.push(line.trim() + ' ' + currentNotamNumber);
        } else if (processedBlocks.length > 0) {
            processedBlocks[processedBlocks.length - 1] += '\n' + line;
        }
    });

    return processedBlocks
        .map(blockText => createNpfBfgNotamRecord(blockText, normalizedOaci))
        .filter(record => record.text);
}

function getNpfBfgNotamValidityInfo(notamBlock) {
    const bMatch = String(notamBlock || '').match(/B\)\s*(\d{10})/);
    const cMatch = String(notamBlock || '').match(/C\)\s*(\d{10}|PERM)/);
    if (!bMatch || !cMatch) return { text: '', start: null, end: null };
    const s = bMatch[1];
    const e = cMatch[1];
    const start = new Date(Date.UTC(
        parseInt(`20${s.substring(0, 2)}`),
        parseInt(s.substring(2, 4)) - 1,
        parseInt(s.substring(4, 6)),
        parseInt(s.substring(6, 8)),
        parseInt(s.substring(8, 10))
    ));
    const end = e === 'PERM'
        ? new Date('2099-12-31T23:59:59Z')
        : new Date(Date.UTC(
            parseInt(`20${e.substring(0, 2)}`),
            parseInt(e.substring(2, 4)) - 1,
            parseInt(e.substring(4, 6)),
            parseInt(e.substring(6, 8)),
            parseInt(e.substring(8, 10))
        ));
    const text = `VALIDE DU ${s.substring(4,6)}/${s.substring(2,4)}/20${s.substring(0,2)} à ${s.substring(6,8)}h${s.substring(8,10)} AU ${e === 'PERM' ? 'PERMANENT' : `${e.substring(4,6)}/${e.substring(2,4)}/20${e.substring(0,2)} à ${e.substring(6,8)}h${e.substring(8,10)}`}`;
    return { text, start, end };
}

function parseNpfBfgNotamValidity(notamBlock) {
    return getNpfBfgNotamValidityInfo(notamBlock).text;
}

async function readNpfBfgNotamsSharedPayload() {
    try {
        const record = await getNpfBfgNotamsLocalRecord();
        const payload = record?.payload;
        if (payload && payload.version === 'bfgNpfNotamsV1') return payload;
    } catch (error) {
        console.warn('NPF NOTAMS : lecture IndexedDB locale impossible.', error);
    }

    // Migration v16.05 : si une ancienne copie est exceptionnellement visible,
    // on la rapatrie une seule fois dans l'IndexedDB propre à NPF.
    let legacyPayload = null;
    if ('caches' in window) {
        try {
            const cache = await caches.open(NPF_BFG_NOTAMS_SHARED_CACHE_NAME);
            const response = await cache.match(getNpfBfgNotamsSharedUrl());
            if (response) {
                const payload = await response.json();
                if (payload && payload.version === 'bfgNpfNotamsV1') legacyPayload = payload;
            }
        } catch (_) {}
    }
    if (!legacyPayload) {
        try {
            const raw = localStorage.getItem(NPF_BFG_NOTAMS_SHARED_LOCAL_KEY);
            const payload = raw ? JSON.parse(raw) : null;
            if (payload && payload.version === 'bfgNpfNotamsV1') legacyPayload = payload;
        } catch (_) {}
    }
    if (legacyPayload) {
        try { await putNpfBfgNotamsLocalPayload(legacyPayload); } catch (_) {}
        return legacyPayload;
    }
    return null;
}

async function writeNpfBfgNotamsSharedPayload(payload) {
    if (!payload || payload.version !== 'bfgNpfNotamsV1') return false;
    try {
        const current = await getNpfBfgNotamsLocalRecord().catch(() => null);
        return await putNpfBfgNotamsLocalPayload(payload, {
            remotePublishedAt: current?.remotePublishedAt || payload.remotePublishedAt || payload.publishedAt || ''
        });
    } catch (error) {
        console.warn('NPF NOTAMS : écriture IndexedDB locale impossible.', error);
        return false;
    }
}

async function syncNpfBfgNotamsFromNas(options = {}) {
    if (npfBfgNotamsSyncPromise) return npfBfgNotamsSyncPromise;
    if (!navigator.onLine) return false;

    npfBfgNotamsSyncPromise = (async () => {
        let session = getStoredBriefingDocsSession();
        if (!session) session = await tryAuthorizeBriefingDocsFromBfgBridge({ silent: true });
        if (!session) return false;

        const response = await fetchBriefingDocsNas(
            `${NPF_BRIEFING_DOCS_API_URL}?action=notams-snapshot&t=${Date.now()}`,
            { method: 'GET', headers: briefingDocsAuthHeaders(session) },
            Number(options.timeoutMs) || 12000
        );
        if (response.status === 404) return false;
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || payload.version !== 'bfgNpfNotamsV1') {
            if (!options.silent) {
                throw new Error(payload?.message || payload?.error || `Snapshot NOTAM indisponible (${response.status})`);
            }
            return false;
        }

        // v17.29 — un fichier qui n'est pas du jour n'est plus écarté : il est
        // conservé et affiché avec un avertissement de date. Un snapshot ancien
        // n'écrase toujours jamais une copie locale plus récente.
        const localRecord = await getNpfBfgNotamsLocalRecord().catch(() => null);
        const localRemotePublishedAt = String(localRecord?.remotePublishedAt || localRecord?.payload?.remotePublishedAt || localRecord?.payload?.publishedAt || '');
        const remotePublishedAt = String(payload.publishedAt || '');
        const localTs = Date.parse(localRemotePublishedAt);
        const remoteTs = Date.parse(remotePublishedAt);
        if (localRecord?.payload && Number.isFinite(localTs) && Number.isFinite(remoteTs) && remoteTs <= localTs) {
            return false;
        }

        const localPayload = {
            ...payload,
            remotePublishedAt,
            npfCachedAt: new Date().toISOString()
        };
        delete localPayload.state;
        const carriedState = carryOverNpfNotamsLocalSelections(localRecord?.payload, localPayload);
        if (carriedState) localPayload.state = carriedState;
        await putNpfBfgNotamsLocalPayload(localPayload, { remotePublishedAt });
        applyNpfNotamsCoverageFromPayload(localPayload);
        return true;
    })();

    try {
        return await npfBfgNotamsSyncPromise;
    } catch (error) {
        if (!options.silent) throw error;
        console.info('[NPF NOTAMS] Synchronisation NAS ignorée:', error?.message || error);
        return false;
    } finally {
        npfBfgNotamsSyncPromise = null;
    }
}

function scheduleNpfBfgNotamsBackgroundSync(delayMs = 0) {
    setTimeout(() => {
        if (document.visibilityState === 'hidden' || !navigator.onLine) return;
        syncNpfBfgNotamsFromNas({ silent: true }).catch(() => {});
    }, Math.max(0, Number(delayMs) || 0));
}

function ensureNpfPelicNotamsModal() {
    let modal = document.getElementById('pelic-notams-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'pelic-notams-modal';
    modal.className = 'pelic-notams-modal';
    modal.hidden = true;
    modal.innerHTML = `
        <div class="pelic-notams-modal-card" role="dialog" aria-modal="true" aria-labelledby="pelic-notams-modal-title">
            <div class="pelic-notams-modal-header">
                <div class="pelic-notams-modal-heading">
                    <div id="pelic-notams-modal-title" class="pelic-notams-modal-title">NOTAMS</div>
                    <div id="pelic-notams-modal-source" class="pelic-notams-modal-source"></div>
                </div>
                <button type="button" class="pelic-notams-modal-close" aria-label="Fermer">×</button>
            </div>
            <div id="pelic-notams-modal-stale" class="pelic-notams-modal-status pelic-notams-modal-status-warning pelic-notams-modal-stale" style="display: none;"></div>
            <div id="pelic-notams-modal-status" class="pelic-notams-modal-status"></div>
            <div id="pelic-notams-modal-prefilters" class="pelic-notams-modal-prefilters" hidden>
                <label class="pelic-notams-date-filter-label" for="pelic-notams-date-filter-cb">
                    <input type="checkbox" id="pelic-notams-date-filter-cb" checked>
                    <span>Afficher uniquement les NOTAMs valides aujourd'hui</span>
                </label>
                <div class="pelic-notams-filter-dropdown">
                    <button type="button" id="pelic-notams-keyword-filter-toggle">Filtres par Mots-Clés</button>
                    <div id="pelic-notams-keyword-filter-list" class="pelic-notams-filter-list" hidden></div>
                </div>
            </div>
            <div id="pelic-notams-modal-controls" class="pelic-notams-modal-controls" hidden>
                <button type="button" class="pelic-notams-keep-selection">Garder la sélection</button>
                <button type="button" class="pelic-notams-show-all" hidden>Tout afficher</button>
            </div>
            <div id="pelic-notams-modal-list" class="pelic-notams-modal-list"></div>
        </div>`;
    document.body.appendChild(modal);

    const keywordList = modal.querySelector('#pelic-notams-keyword-filter-list');
    if (keywordList) {
        NPF_PELIC_NOTAMS_KEYWORDS_TO_FILTER.forEach(keyword => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.keyword = keyword;
            checkbox.checked = true;
            checkbox.addEventListener('change', applyNpfPelicNotamsViewMode);
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(keyword.toUpperCase()));
            keywordList.appendChild(label);
        });
    }

    modal.querySelector('#pelic-notams-date-filter-cb')?.addEventListener('change', applyNpfPelicNotamsViewMode);
    const keywordToggle = modal.querySelector('#pelic-notams-keyword-filter-toggle');
    keywordToggle?.addEventListener('click', event => {
        event.stopPropagation();
        const list = modal.querySelector('#pelic-notams-keyword-filter-list');
        if (list) list.hidden = !list.hidden;
    });

    const close = () => {
        modal.hidden = true;
        document.body.classList.remove('pelic-notams-modal-open');
        const list = modal.querySelector('#pelic-notams-keyword-filter-list');
        if (list) list.hidden = true;
    };
    modal.querySelector('.pelic-notams-modal-close')?.addEventListener('click', close);
    modal.addEventListener('click', event => {
        if (event.target === modal) close();
        if (!event.target.closest('.pelic-notams-filter-dropdown')) {
            const list = modal.querySelector('#pelic-notams-keyword-filter-list');
            if (list) list.hidden = true;
        }
    });
    modal.querySelector('.pelic-notams-keep-selection')?.addEventListener('click', () => {
        npfPelicNotamsViewMode = 'selection';
        applyNpfPelicNotamsViewMode();
    });
    modal.querySelector('.pelic-notams-show-all')?.addEventListener('click', () => {
        npfPelicNotamsViewMode = 'all';
        applyNpfPelicNotamsViewMode();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !modal.hidden) close();
    });
    return modal;
}

function getNpfPelicNotamStateEntry(payload, record) {
    const byId = payload?.state?.byId || {};
    const entry = byId[record.id];
    if (!entry || typeof entry !== 'object') return null;
    const expected = String(entry.textSignature || entry.signature || '').trim();
    if (expected && expected !== record.signature) return null;
    return entry;
}

function updateNpfPelicNotamSharedState(record, checked, hiddenUntilChanged) {
    if (!npfPelicNotamsCurrentPayload || !record?.id) return;
    const payload = npfPelicNotamsCurrentPayload;
    if (!payload.state || typeof payload.state !== 'object') {
        payload.state = { version: 'persistentNotamStateV1', updatedAt: new Date().toISOString(), byId: {} };
    }
    if (!payload.state.byId || typeof payload.state.byId !== 'object') payload.state.byId = {};

    const previous = payload.state.byId[record.id] && typeof payload.state.byId[record.id] === 'object'
        ? { ...payload.state.byId[record.id] }
        : {};
    const next = {
        ...previous,
        checked: Boolean(checked),
        hiddenUntilChanged: Boolean(hiddenUntilChanged),
        textSignature: record.signature
    };
    const hasOtherPersistentData = Boolean(next.highlightHtml || next.validityHighlightHtml);

    if (!next.checked && !next.hiddenUntilChanged && !hasOtherPersistentData) {
        delete payload.state.byId[record.id];
    } else {
        payload.state.byId[record.id] = next;
    }
    payload.state.updatedAt = new Date().toISOString();
    payload.npfSelectionUpdatedAt = payload.state.updatedAt;
    void writeNpfBfgNotamsSharedPayload(payload);
}

function applyNpfPelicNotamsLiveFilters() {
    const modal = document.getElementById('pelic-notams-modal');
    if (!modal) return;
    const dateFilterActive = Boolean(modal.querySelector('#pelic-notams-date-filter-cb')?.checked);
    const activeKeywords = Array.from(modal.querySelectorAll('#pelic-notams-keyword-filter-list input:checked'))
        .map(input => String(input.dataset.keyword || '').trim())
        .filter(Boolean);

    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0));
    const todayEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59));

    modal.querySelectorAll('.pelic-notam-item').forEach(item => {
        let shouldBeHidden = false;
        if (dateFilterActive) {
            const start = item.dataset.startDate ? new Date(item.dataset.startDate) : null;
            const end = item.dataset.endDate ? new Date(item.dataset.endDate) : null;
            if (start && end && !(start <= todayEnd && end >= todayStart)) shouldBeHidden = true;
        }
        if (activeKeywords.length > 0 && !shouldBeHidden) {
            const itemText = String(item.querySelector('.pelic-notam-text')?.textContent || '');
            if (activeKeywords.some(keyword => {
                const regex = new RegExp(`\\b${keyword.replace(/ /g, '\\s')}\\b`, 'i');
                return regex.test(itemText);
            })) shouldBeHidden = true;
        }
        item.classList.toggle('pelic-notam-prefilter-hidden', shouldBeHidden);
    });
}

function updateNpfPelicNotamsStatusForView() {
    const modal = document.getElementById('pelic-notams-modal');
    const status = modal?.querySelector('#pelic-notams-modal-status');
    if (!modal || !status || !npfPelicNotamsCurrentPayload) return;
    const items = Array.from(modal.querySelectorAll('.pelic-notam-item'));
    if (!items.length) return;

    const selectedCount = items.filter(item => {
        const keep = Boolean(item.querySelector('.pelic-notam-keep-checkbox')?.checked);
        const exclude = Boolean(item.querySelector('.pelic-notam-exclude-checkbox')?.checked);
        return keep && !exclude;
    }).length;
    const visibleCount = items.filter(item => (
        !item.classList.contains('pelic-notam-filtered-hidden')
        && !item.classList.contains('pelic-notam-prefilter-hidden')
    )).length;

    status.classList.remove('pelic-notams-modal-status-warning');
    if (npfPelicNotamsViewMode === 'selection' && selectedCount === 0) {
        status.textContent = 'Aucun NOTAM sélectionné';
        status.classList.add('pelic-notams-modal-status-warning');
        return;
    }
    if (visibleCount === 0) {
        status.textContent = 'Aucun NOTAM avec les filtres actifs.';
        status.classList.add('pelic-notams-modal-status-warning');
        return;
    }
    status.textContent = `${visibleCount} NOTAM(s) affiché(s) — ${getNpfNotamsCopyLabel(npfPelicNotamsCurrentPayload)}.`;
}

function applyNpfPelicNotamsViewMode() {
    const modal = document.getElementById('pelic-notams-modal');
    if (!modal) return;
    const selectionOnly = npfPelicNotamsViewMode === 'selection';
    modal.querySelectorAll('.pelic-notam-item').forEach(item => {
        const keep = Boolean(item.querySelector('.pelic-notam-keep-checkbox')?.checked);
        const exclude = Boolean(item.querySelector('.pelic-notam-exclude-checkbox')?.checked);
        item.classList.toggle('pelic-notam-filtered-hidden', selectionOnly && (!keep || exclude));
    });
    const keepButton = modal.querySelector('.pelic-notams-keep-selection');
    const showAllButton = modal.querySelector('.pelic-notams-show-all');
    if (keepButton) keepButton.hidden = selectionOnly;
    if (showAllButton) showAllButton.hidden = !selectionOnly;
    applyNpfPelicNotamsLiveFilters();
    updateNpfPelicNotamsStatusForView();
}

function refreshNpfPelicNotamItemState(item) {
    if (!item) return;
    const keep = Boolean(item.querySelector('.pelic-notam-keep-checkbox')?.checked);
    const exclude = Boolean(item.querySelector('.pelic-notam-exclude-checkbox')?.checked);
    item.classList.toggle('pelic-notam-kept', keep && !exclude);
    item.classList.toggle('pelic-notam-excluded', exclude);
}

function renderNpfPelicNotams(payload, oaci) {
    const modal = ensureNpfPelicNotamsModal();
    const title = modal.querySelector('#pelic-notams-modal-title');
    const source = modal.querySelector('#pelic-notams-modal-source');
    const status = modal.querySelector('#pelic-notams-modal-status');
    const prefilters = modal.querySelector('#pelic-notams-modal-prefilters');
    const controls = modal.querySelector('#pelic-notams-modal-controls');
    const list = modal.querySelector('#pelic-notams-modal-list');

    if (title) title.textContent = `NOTAMS ${oaci}`;
    if (source) source.textContent = String(payload?.notamsAutoPdfStatus?.timestampText || 'Source locale BFG');
    if (status) status.textContent = '';
    if (list) list.innerHTML = '';
    if (prefilters) prefilters.hidden = true;
    if (controls) controls.hidden = true;

    // v17.29 — fichier qui n'est pas du jour : affiché quand même, avec un
    // avertissement de date bien visible au-dessus de la liste.
    const stale = modal.querySelector('#pelic-notams-modal-stale');
    const staleText = getNpfNotamsStaleWarningText(payload);
    if (stale) {
        stale.textContent = staleText;
        stale.style.display = staleText ? '' : 'none';
    }

    if (status) status.classList.remove('pelic-notams-modal-status-warning');
    const records = extractNpfBfgNotamsForOaci(payload.notamText || '', oaci);
    if (!records.length) {
        if (status) status.textContent = 'Aucun NOTAM';
        return;
    }

    if (status) status.textContent = `${records.length} NOTAM(s) — ${getNpfNotamsCopyLabel(payload)}.`;
    if (prefilters) prefilters.hidden = false;
    if (controls) controls.hidden = false;

    records.forEach(record => {
        const entry = getNpfPelicNotamStateEntry(payload, record);
        const item = document.createElement('div');
        item.className = 'pelic-notam-item';
        item.dataset.notamId = record.id;
        item.dataset.notamSignature = record.signature;

        const checkboxColumn = document.createElement('div');
        checkboxColumn.className = 'pelic-notam-checkbox-column';

        const keepLabel = document.createElement('label');
        keepLabel.className = 'pelic-notam-checkbox-ring pelic-notam-checkbox-ring-keep';
        keepLabel.title = 'Garder ce NOTAM dans la sélection';
        const keepCheckbox = document.createElement('input');
        keepCheckbox.type = 'checkbox';
        keepCheckbox.className = 'pelic-notam-keep-checkbox';
        keepCheckbox.setAttribute('aria-label', 'Garder ce NOTAM dans la sélection');
        keepCheckbox.checked = Boolean(entry?.checked);
        keepLabel.appendChild(keepCheckbox);

        const excludeLabel = document.createElement('label');
        excludeLabel.className = 'pelic-notam-checkbox-ring pelic-notam-checkbox-ring-exclude';
        excludeLabel.title = 'Exclure ce NOTAM tant qu’il ne change pas';
        const excludeCheckbox = document.createElement('input');
        excludeCheckbox.type = 'checkbox';
        excludeCheckbox.className = 'pelic-notam-exclude-checkbox';
        excludeCheckbox.setAttribute('aria-label', 'Exclure ce NOTAM tant qu’il ne change pas');
        excludeCheckbox.checked = Boolean(entry?.hiddenUntilChanged);
        excludeLabel.appendChild(excludeCheckbox);

        checkboxColumn.appendChild(keepLabel);
        checkboxColumn.appendChild(excludeLabel);

        const wrapper = document.createElement('div');
        wrapper.className = 'pelic-notam-content-wrapper';
        const validityInfo = getNpfBfgNotamValidityInfo(record.text);
        if (validityInfo.start) item.dataset.startDate = validityInfo.start.toISOString();
        if (validityInfo.end) item.dataset.endDate = validityInfo.end.toISOString();
        if (validityInfo.text) {
            const validity = document.createElement('div');
            validity.className = 'pelic-notam-validity';
            validity.textContent = validityInfo.text;
            wrapper.appendChild(validity);
        }
        const text = document.createElement('div');
        text.className = 'pelic-notam-text';
        text.textContent = record.text;
        wrapper.appendChild(text);

        item.appendChild(checkboxColumn);
        item.appendChild(wrapper);
        list.appendChild(item);
        refreshNpfPelicNotamItemState(item);

        keepCheckbox.addEventListener('change', () => {
            if (keepCheckbox.checked) excludeCheckbox.checked = false;
            refreshNpfPelicNotamItemState(item);
            updateNpfPelicNotamSharedState(record, keepCheckbox.checked, excludeCheckbox.checked);
            applyNpfPelicNotamsViewMode();
        });
        excludeCheckbox.addEventListener('change', () => {
            if (excludeCheckbox.checked) keepCheckbox.checked = false;
            refreshNpfPelicNotamItemState(item);
            updateNpfPelicNotamSharedState(record, keepCheckbox.checked, excludeCheckbox.checked);
            applyNpfPelicNotamsViewMode();
        });
    });

    applyNpfPelicNotamsViewMode();
}

async function openNpfPelicNotams(oaci) {
    const normalizedOaci = String(oaci || '').trim().toUpperCase();
    if (!normalizedOaci) return;
    const modal = ensureNpfPelicNotamsModal();
    npfPelicNotamsCurrentOaci = normalizedOaci;
    npfPelicNotamsViewMode = 'all';
    modal.hidden = false;
    document.body.classList.add('pelic-notams-modal-open');
    try { map?.closePopup?.(); } catch (_) {}

    const title = modal.querySelector('#pelic-notams-modal-title');
    const source = modal.querySelector('#pelic-notams-modal-source');
    const status = modal.querySelector('#pelic-notams-modal-status');
    const prefilters = modal.querySelector('#pelic-notams-modal-prefilters');
    const controls = modal.querySelector('#pelic-notams-modal-controls');
    const list = modal.querySelector('#pelic-notams-modal-list');
    if (title) title.textContent = `NOTAMS ${normalizedOaci}`;
    if (source) source.textContent = 'Lecture locale BFG…';
    if (status) {
        status.classList.remove('pelic-notams-modal-status-warning');
        status.textContent = 'Chargement des NOTAM locaux…';
    }
    if (prefilters) prefilters.hidden = true;
    if (controls) controls.hidden = true;
    if (list) list.innerHTML = '';
    const stale = modal.querySelector('#pelic-notams-modal-stale');
    if (stale) stale.style.display = 'none';

    let payload = await readNpfBfgNotamsSharedPayload();
    if ((!payload || !isNpfPelicNotamsPayloadCurrentToday(payload)) && navigator.onLine) {
        await syncNpfBfgNotamsFromNas({ silent: true }).catch(() => false);
        payload = await readNpfBfgNotamsSharedPayload();
    }
    if (!payload) {
        npfPelicNotamsCurrentPayload = null;
        if (source) source.textContent = 'Source locale NPF';
        if (status) {
            status.textContent = navigator.onLine
                ? 'Aucun snapshot NOTAM BFG disponible sur le NAS ou dans NPF.'
                : 'Aucune copie locale NOTAM BFG disponible sur cet appareil.';
            status.classList.add('pelic-notams-modal-status-warning');
        }
        return;
    }

    npfPelicNotamsCurrentPayload = payload;
    renderNpfPelicNotams(payload, normalizedOaci);
}

function buildPelicNotamsButtonHtml(oaci) {
    const normalizedOaci = String(oaci || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!normalizedOaci) return '';
    return `<div class="popup-notams-buttons"><button type="button" class="pelic-notams-btn" onclick="window.openPelicNotams('${normalizedOaci}')">NOTAMS</button></div>`;
}

/* v17.29 — bouton NOTAMS des terrains non PÉLIC : seulement si couverts. */
function buildNpfNotamsButtonHtmlIfCovered(oaci) {
    return isNpfNotamsAirportCovered(oaci) ? buildPelicNotamsButtonHtml(oaci) : '';
}

window.openPelicNotams = openNpfPelicNotams;

/*
 * v17.29 — RAFRAÎCHISSEMENT NOTAM À LA DEMANDE (Gestion des cartes)
 * --------------------------------------------------------------------------
 * Contrat : npf-docs-api.php installé sur le NAS (lu en lecture seule).
 * - notams-refresh-status (GET) : état de la chaîne ; sa lecture fait aussi
 *   avancer la machine à états du NAS, il faut donc l'interroger jusqu'au
 *   bout. Champs utilisés : status, message, batchIndex, batchCount,
 *   slotWaitingSince, serverTime, snapshot.available, snapshot.publishedAt.
 * - notams-refresh (POST) : lance ou rejoint le téléchargement.
 * - notams-snapshot (GET) : fichier complet (~248 Ko).
 * - Jeton absent ou expiré : HTTP 401 { error: 'unauthorized' }.
 * Délais calés sur la mesure réelle du 23/09/2026 : 3 lots en ~61 s sans
 * attente de créneau SDVFR. Si le NAS signale une attente de créneau
 * (slotWaitingSince), le délai suit son propre plafond de 600 s.
 */
const NPF_NOTAMS_FRESH_MAX_AGE_MS = 30 * 60 * 1000;
const NPF_NOTAMS_REFRESH_POLL_MS = 2000;
const NPF_NOTAMS_REFRESH_MAX_WAIT_MS = 180000;
const NPF_NOTAMS_REFRESH_SLOT_MAX_WAIT_S = 600;
const NPF_NOTAMS_API_TIMEOUT_MS = 15000;
const NPF_NOTAMS_SNAPSHOT_TIMEOUT_MS = 30000;
let npfNotamsManualRefreshInProgress = false;

function setNpfNotamsRefreshStatus(message, { error = false, success = false } = {}) {
    const status = document.getElementById('notams-refresh-status');
    if (!status) return;
    status.textContent = String(message || '');
    status.classList.toggle('notams-refresh-status-error', Boolean(error));
    status.classList.toggle('notams-refresh-status-success', Boolean(success));
}

function setNpfNotamsRefreshProgress(batchIndex, batchCount) {
    const container = document.getElementById('notams-refresh-progress');
    const bar = document.getElementById('notams-refresh-progress-bar');
    const text = document.getElementById('notams-refresh-progress-text');
    if (!container) return;
    const count = Number(batchCount) || 0;
    const index = Math.min(Number(batchIndex) || 0, count);
    if (count < 1 || index < 1) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';
    if (bar) bar.style.width = `${Math.round((index / count) * 100)}%`;
    if (text) text.textContent = `Lot ${index}/${count}`;
}

async function displayNpfNotamsLocalStatus() {
    if (npfNotamsManualRefreshInProgress) return;
    const record = await getNpfBfgNotamsLocalRecord().catch(() => null);
    const payload = record?.payload;
    if (!payload) {
        setNpfNotamsRefreshStatus('Aucune copie locale NOTAM sur cet iPad.');
        return;
    }
    const source = String(payload?.notamsAutoPdfStatus?.timestampText || '').trim() || 'NOTAM';
    const staleText = getNpfNotamsStaleWarningText(payload);
    const coverageCount = getNpfNotamsCoverageFromPayload(payload).length;
    setNpfNotamsRefreshStatus(
        `Copie locale : ${source} — ${coverageCount} terrain(s) couvert(s).${staleText ? ` ${staleText}.` : ''}`,
        { error: Boolean(staleText) }
    );
}

function handleNpfNotamsAuthorizationMissing() {
    // Même comportement que le lecteur FdS / GAAR.
    if (getStoredNpfBfgBridgeCredentials()) {
        setNpfNotamsRefreshStatus(getBriefingDocsBfgAuthorizationUnavailableMessage(), { error: true });
        return;
    }
    openBriefingDocsPasswordModal('notams');
    setNpfNotamsRefreshStatus('Autorisation expirée : saisis à nouveau le mot de passe NPF.', { error: true });
}

async function requestNpfNotamsRefreshState(session, action, method = 'GET') {
    const response = await fetchBriefingDocsNas(
        `${NPF_BRIEFING_DOCS_API_URL}?action=${action}&t=${Date.now()}`,
        { method, headers: briefingDocsAuthHeaders(session) },
        NPF_NOTAMS_API_TIMEOUT_MS
    );
    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
        handleNpfNotamsAuthorizationMissing();
        return null;
    }
    if (!response.ok || !payload || payload.ok !== true) {
        setNpfNotamsRefreshStatus(
            payload?.message || payload?.error || `Réponse inattendue du NAS (${response.status}).`,
            { error: true }
        );
        return null;
    }
    return payload;
}

async function pollNpfNotamsRefreshUntilDone(session, initialState) {
    const startedAt = Date.now();
    let deadline = startedAt + NPF_NOTAMS_REFRESH_MAX_WAIT_MS;
    let state = initialState;

    while (true) {
        // Message du NAS affiché tel quel ; progression des lots à part.
        setNpfNotamsRefreshStatus(String(state?.message || 'Téléchargement NOTAM en cours…'));
        setNpfNotamsRefreshProgress(state?.batchIndex, state?.batchCount);

        const status = String(state?.status || '');
        if (status !== 'pending' && status !== 'running') return state;

        const waitingSince = Number(state?.slotWaitingSince) || 0;
        if (waitingSince > 0) {
            const serverNowS = (Date.parse(String(state?.serverTime || '')) || Date.now()) / 1000;
            const remainingS = Math.max(0, NPF_NOTAMS_REFRESH_SLOT_MAX_WAIT_S - (serverNowS - waitingSince));
            deadline = Math.max(deadline, Date.now() + (remainingS + 60) * 1000);
        }
        if (Date.now() >= deadline) {
            const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
            setNpfNotamsRefreshStatus(
                `Le NAS n’a pas terminé dans le délai (${minutes} min). La copie locale reste affichée ; relance « Rafraîchir les NOTAM » dans quelques minutes pour reprendre le suivi.`,
                { error: true }
            );
            return null;
        }
        if (!navigator.onLine) {
            setNpfNotamsRefreshStatus('Connexion perdue : suivi NOTAM interrompu. La copie locale reste affichée.', { error: true });
            return null;
        }

        await new Promise(resolve => setTimeout(resolve, NPF_NOTAMS_REFRESH_POLL_MS));
        state = await requestNpfNotamsRefreshState(session, 'notams-refresh-status');
        if (!state) return null;
    }
}

async function refreshNpfNotamsFromNasManually() {
    if (npfNotamsManualRefreshInProgress) return;
    if (!navigator.onLine) {
        setNpfNotamsRefreshStatus('Hors ligne : rafraîchissement NOTAM impossible. La copie locale reste affichée.', { error: true });
        return;
    }

    const button = document.getElementById('notams-refresh-button');
    npfNotamsManualRefreshInProgress = true;
    if (button) button.disabled = true;
    setNpfNotamsRefreshProgress(0, 0);

    try {
        let session = getStoredBriefingDocsSession();
        if (!session) session = await tryAuthorizeBriefingDocsFromBfgBridge({ silent: true }).catch(() => null);
        if (!session) {
            handleNpfNotamsAuthorizationMissing();
            return;
        }

        setNpfNotamsRefreshStatus('Interrogation du NAS…');
        let state = await requestNpfNotamsRefreshState(session, 'notams-refresh-status');
        if (!state) return;

        const status = String(state.status || '');
        if (status !== 'pending' && status !== 'running') {
            // Fichier du NAS de moins de 30 min : aucun nouveau téléchargement
            // SDVFR, simple rechargement si la copie locale est plus ancienne.
            const publishedAt = String(state?.snapshot?.publishedAt || '');
            const publishedTs = Date.parse(publishedAt);
            if (state?.snapshot?.available && Number.isFinite(publishedTs)
                && Date.now() - publishedTs < NPF_NOTAMS_FRESH_MAX_AGE_MS) {
                setNpfNotamsRefreshStatus('Rechargement du fichier NOTAM du NAS…');
                await syncNpfBfgNotamsFromNas({ silent: false, timeoutMs: NPF_NOTAMS_SNAPSHOT_TIMEOUT_MS });
                setNpfNotamsRefreshStatus(
                    `NOTAM déjà à jour (téléchargés à ${formatNpfNotamsParisHourMinute(publishedAt)})`,
                    { success: true }
                );
                return;
            }
            state = await requestNpfNotamsRefreshState(session, 'notams-refresh', 'POST');
            if (!state) return;
        }

        const finalState = await pollNpfNotamsRefreshUntilDone(session, state);
        if (!finalState) return;
        const finalMessage = String(finalState.message || '').trim();
        if (finalState.status !== 'success') {
            setNpfNotamsRefreshStatus(finalMessage || 'Échec du rafraîchissement NOTAM sur le NAS.', { error: true });
            return;
        }

        setNpfNotamsRefreshStatus(`${finalMessage} Enregistrement sur cet iPad…`);
        const stored = await syncNpfBfgNotamsFromNas({ silent: false, timeoutMs: NPF_NOTAMS_SNAPSHOT_TIMEOUT_MS });
        setNpfNotamsRefreshStatus(
            `${finalMessage} ${stored ? 'NOTAM enregistrés sur cet iPad pour le hors ligne.' : 'La copie locale était déjà à jour.'}`,
            { success: true }
        );
    } catch (error) {
        if (!getStoredBriefingDocsSession()) {
            handleNpfNotamsAuthorizationMissing();
        } else if (error?.name === 'AbortError') {
            setNpfNotamsRefreshStatus('Le NAS ne répond pas (délai dépassé). La copie locale reste affichée.', { error: true });
        } else {
            setNpfNotamsRefreshStatus(error?.message || String(error), { error: true });
        }
    } finally {
        npfNotamsManualRefreshInProgress = false;
        if (button) button.disabled = false;
    }
}



/* ========================================================================== 
   v16.65 — TRACE : RACCOURCI NPF TRACE + ÉTAT SUPPOSÉ MÉMORISÉ
   ========================================================================== */
const NPF_TRACE_SHORTCUT_NAME = 'NPF Trace';
const NPF_TRACE_ASSUMED_ACTIVE_KEY = 'npfTraceAssumedActive_v1';

function getNpfTraceAssumedActive() {
    try {
        return localStorage.getItem(NPF_TRACE_ASSUMED_ACTIVE_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function renderNpfTraceAssumedState(active = getNpfTraceAssumedActive()) {
    const button = document.getElementById('yul-trace-button');
    if (!button) return;
    const isActive = !!active;
    button.classList.toggle('npf-trace-assumed-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    const label = isActive
        ? 'TRACE supposée en cours — appuyer pour arrêter'
        : 'TRACE arrêtée — appuyer pour démarrer';
    button.title = label;
    button.setAttribute('aria-label', label);
}

function setNpfTraceAssumedActive(active) {
    const isActive = !!active;
    try {
        localStorage.setItem(NPF_TRACE_ASSUMED_ACTIVE_KEY, isActive ? '1' : '0');
    } catch (_) {}
    renderNpfTraceAssumedState(isActive);
}

function launchNpfTraceShortcut(nextAssumedState) {
    /* NPF ne peut pas lire l'état interne de MyTracks. Il mémorise donc
     * uniquement l'état qu'il suppose après l'appui. Le raccourci "NPF Trace"
     * reste l'interface native qui décide réellement Start/Stop. */
    const shortcutUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(NPF_TRACE_SHORTCUT_NAME)}`;
    try {
        setNpfTraceAssumedActive(nextAssumedState);
        window.location.href = shortcutUrl;
        return true;
    } catch (error) {
        setNpfTraceAssumedActive(!nextAssumedState);
        alert('Impossible de lancer le raccourci « NPF Trace ». Vérifie qu’il existe dans l’app Raccourcis.');
        return false;
    }
}

function initializeNpfTraceButton() {
    const button = document.getElementById('yul-trace-button');
    if (!button) return;
    renderNpfTraceAssumedState();
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nextAssumedState = !getNpfTraceAssumedActive();
        launchNpfTraceShortcut(nextAssumedState);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNpfTraceButton, { once: true });
} else {
    setTimeout(initializeNpfTraceButton, 0);
}


