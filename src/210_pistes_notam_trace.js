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

/*
 * v17.45 — fenêtre d'un terrain (grande fenêtre PÉLIC et petite fenêtre des
 * autres terrains) : si elle ne tient pas entièrement dans la zone libre de
 * l'écran, la carte glisse juste ce qu'il faut. La fenêtre reste au-dessus du
 * terrain ; elle n'est plus descendue comme en v16.24. Un seul calcul, à
 * l'ouverture. Le glissement est traité par le Suivi GPS comme un déplacement
 * à la main (même pause, même retour automatique).
 */
const NPF_AIRPORT_POPUP_SAFE_MARGIN_PX = 8;

function isNpfAirportPopup(popup) {
    try {
        const container = typeof popup?.getElement === 'function'
            ? popup.getElement()
            : popup?._container;
        return !!(container && container.querySelector('.airport-popup'));
    } catch (_) {
        return false;
    }
}

/* Zone libre : carte moins les éléments fixes réellement affichés. */
function getNpfAirportPopupSafeRect(mapRect) {
    const safe = {
        left: mapRect.left,
        top: mapRect.top,
        right: mapRect.right,
        bottom: mapRect.bottom
    };
    const visibleRectOf = element => {
        if (!element) return null;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
        const rect = element.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return null;
        if (rect.bottom <= mapRect.top || rect.top >= mapRect.bottom) return null;
        if (rect.right <= mapRect.left || rect.left >= mapRect.right) return null;
        return rect;
    };
    const middleY = mapRect.top + mapRect.height / 2;
    const bottomStripY = mapRect.top + mapRect.height * 0.9;

    /* Haut : barre de recherche et bandeaux. */
    document.querySelectorAll(
        '#ui-overlay, #search-section, #offline-status, #bingo-map-display, #commune-info-display, #npf-waypoint-route-banner'
    ).forEach(element => {
        const rect = visibleRectOf(element);
        if (rect && rect.top < middleY) safe.top = Math.max(safe.top, rect.bottom);
    });

    /* Colonnes de boutons à gauche et à droite, rangée de boutons du bas. */
    document.querySelectorAll(
        '.left-map-action-button, #quick-sia-vrp-toggle, #quick-sia-zones-toggle, '
        + '#toggle-search-button, #main-action-buttons, #yul-trace-button, #sia-profile-swipe-handle'
    ).forEach(element => {
        const rect = visibleRectOf(element);
        if (!rect) return;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (centerY > bottomStripY) {
            safe.bottom = Math.min(safe.bottom, rect.top);
        } else if (centerX < mapRect.left + mapRect.width * 0.3) {
            safe.left = Math.max(safe.left, rect.right);
        } else if (centerX > mapRect.left + mapRect.width * 0.7) {
            safe.right = Math.min(safe.right, rect.left);
        }
    });

    safe.left += NPF_AIRPORT_POPUP_SAFE_MARGIN_PX;
    safe.top += NPF_AIRPORT_POPUP_SAFE_MARGIN_PX;
    safe.right -= NPF_AIRPORT_POPUP_SAFE_MARGIN_PX;
    safe.bottom -= NPF_AIRPORT_POPUP_SAFE_MARGIN_PX;
    return safe;
}

function panMapToShowNpfAirportPopup(popup) {
    if (!popup || !map || map._popup !== popup || !isNpfAirportPopup(popup)) return false;

    const container = typeof popup.getElement === 'function' ? popup.getElement() : popup._container;
    const mapContainer = typeof map.getContainer === 'function' ? map.getContainer() : null;
    if (!container || !mapContainer) return false;

    const popupRect = container.getBoundingClientRect();
    const mapRect = mapContainer.getBoundingClientRect();
    if (!(popupRect.width > 0 && popupRect.height > 0)) return false;
    const safe = getNpfAirportPopupSafeRect(mapRect);

    /* Déplacement à l'écran nécessaire pour que la fenêtre soit entière. */
    let shiftX = 0;
    let shiftY = 0;
    if (popupRect.width > safe.right - safe.left) {
        shiftX = (safe.left + safe.right) / 2 - (popupRect.left + popupRect.right) / 2;
    } else if (popupRect.left < safe.left) {
        shiftX = safe.left - popupRect.left;
    } else if (popupRect.right > safe.right) {
        shiftX = safe.right - popupRect.right;
    }
    if (popupRect.top < safe.top || popupRect.height > safe.bottom - safe.top) {
        shiftY = safe.top - popupRect.top;
    } else if (popupRect.bottom > safe.bottom) {
        shiftY = safe.bottom - popupRect.bottom;
    }

    shiftX = Math.round(shiftX);
    shiftY = Math.round(shiftY);
    if (!shiftX && !shiftY) return false;

    /*
     * Même traitement qu'un déplacement à la main : le Suivi se met en pause
     * et le compte du retour automatique part de ce glissement.
     */
    try {
        if (typeof isCenterGpsFollowEffective === 'function' && isCenterGpsFollowEffective()) {
            centerGpsFollowLastUserGestureAt = Date.now();
            scheduleCenterGpsFollowRecentering();
        }
    } catch (_) {}

    /* panBy déplace la vue : la fenêtre se déplace de l'opposé à l'écran. */
    map.panBy([-shiftX, -shiftY], { animate: true, duration: 0.25 });
    return true;
}

function scheduleNpfPelicPopupReposition(popup) {
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            try { panMapToShowNpfAirportPopup(popup); } catch (_) {}
        });
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
    /* v17.45 — petite fenêtre des autres terrains : même glissement que la
     * fenêtre PÉLIC (panMapToShowNpfAirportPopup), à la place du glissement
     * standard de Leaflet qui ne connaît que les bords de la carte. */
    hitbox.bindPopup(popupHtml, pelicPopup ? getNpfPelicPopupOptions({ maxWidth: 390 }) : { maxWidth: 300, autoPan: false });
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
    hitbox._npfAirportOaci = airport.oaci;
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

/* v17.29 — un fichier qui n'est pas du jour est affiché avec cet avertissement.
 * v17.59 — texte : date ET heure des NOTAM affichés (heure de Paris). */
function getNpfNotamsStaleWarningText(payload) {
    if (isNpfPelicNotamsPayloadCurrentToday(payload)) return '';
    const label = getNpfSofiaNotamsDateLabel(payload);
    return `⚠️ NOTAM ${label ? `${label} ` : ''}: ce ne sont pas les NOTAM du jour`;
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
        request.onerror = () => reject(request.error || new Error('Base NOTAM NPF-Q400 indisponible'));
        request.onblocked = () => reject(new Error('Base NOTAM NPF-Q400 bloquée'));
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

/*
 * v17.59 — NOTAM SOFIA COMMUNS BFG / NPF-Q400 (fichier complet, 114 terrains)
 * --------------------------------------------------------------------------
 * Source unique : get-sofia-notams-all.php (lecture publique, schéma
 * bfg-sofia-notams-all-v1), produit par le programme VPS bfg-sofia-notams
 * 1.1.0 (06:30, 10:00 et à la demande ; NOTAM « IFR seulement » écartés).
 * Plus aucune lecture des NOTAM SDVFR (notams-snapshot) : aucun secours SDVFR.
 * Le fichier est converti UNE fois, à la réception, dans le format texte
 * bfgNpfNotamsV1 déjà affiché par la fenêtre NOTAMS (même affichage, mêmes
 * filtres, mêmes sélections locales). Rien ne tourne à chaque image de la carte.
 * Lancement d'une recherche : npf-docs-api.php?action=sofia-notams-request,
 * suivi : ?action=sofia-notams-status (session NPF-Q400 : pont BFG silencieux,
 * sinon mot de passe de session, comme FdS / GAAR). NAS éteint 23h50-06h00 :
 * aucun appel. Suivi d'une recherche : 5 min au plus, seulement pendant elle.
 */
const NPF_SOFIA_NOTAMS_ALL_URL = 'https://grisonb.synology.me/briefing-api/get-sofia-notams-all.php';
const NPF_SOFIA_NOTAMS_ALL_SCHEMA = 'bfg-sofia-notams-all-v1';
const NPF_SOFIA_NOTAMS_FILE_TIMEOUT_MS = 30000;
const NPF_SOFIA_NOTAMS_POLL_MS = 3000;                  // suivi avec session (réponse légère)
const NPF_SOFIA_NOTAMS_REREAD_MS = 60000;               // suivi sans session : relecture du fichier
const NPF_SOFIA_NOTAMS_FOLLOW_MAX_MS = 5 * 60 * 1000;   // suivi : 5 min au plus
const NPF_SOFIA_NOTAMS_RECHECK_MS = 10 * 60 * 1000;     // copie du jour : mise à jour légère au plus toutes les 10 min
const NPF_SOFIA_NOTAMS_SEARCH_STEPS = 24;
const NPF_SOFIA_NOTAMS_LAST_CHECK_KEY = 'npfSofiaNotamsLastCheckV1';
const NPF_SOFIA_NOTAMS_ALERT_DAY_KEY = 'npfSofiaNotamsAlertDayV1';
let npfSofiaNotamsDailyPromise = null;

function isNpfNasOffHours(now = new Date()) {
    const parts = formatNpfNotamsParisDate(now, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (!parts) return false;
    const hm = (Number(parts.hour) || 0) * 100 + (Number(parts.minute) || 0);
    return hm >= 2350 || hm < 600;
}

function isNpfSofiaNotamsPayload(payload) {
    return Boolean(payload && payload.version === 'bfgNpfNotamsV1' && payload.sourceKind === 'SOFIA');
}

/* Fichier SOFIA complet -> format bfgNpfNotamsV1 (même texte que celui que
 * fabriquait le NAS à partir de SDVFR : en-tête terrain, numéro, ligne Q, A) B) C) E)). */
function buildNpfNotamsPayloadFromSofiaAll(data) {
    const generatedAt = String(data?.generatedAt || '');
    const yearSuffix = String(new Date(generatedAt).getUTCFullYear() || '').slice(-2) || '00';
    const sections = [];
    const airportsWithNotams = [];
    let notamCount = 0;
    (Array.isArray(data?.airports) ? data.airports : []).forEach(airport => {
        const icao = String(airport?.icao || '').trim().toUpperCase();
        if (!/^[A-Z]{4}$/.test(icao)) return;
        const blocks = [];
        (Array.isArray(airport.notams) ? airport.notams : []).forEach((notam, index) => {
            const description = String(notam?.description || '').replace(/\r\n?/g, '\n').trim();
            if (!description) return;
            const code = String(notam?.code || '').trim().toUpperCase();
            const number = /^[A-Z]\d{4}\/\d{2}$/.test(code)
                ? code
                : `Z${String(index + 1).padStart(4, '0')}/${yearSuffix}`;
            const hasQLine = /(^|\n)\s*Q\)/i.test(description);
            blocks.push([
                number,
                hasQLine ? '' : `Q) ${icao}/QXXXX/IV/NBO/A/000/999/0000N00000E005`,
                description
            ].filter(Boolean).join('\n'));
        });
        if (!blocks.length) return;
        airportsWithNotams.push(icao);
        notamCount += blocks.length;
        sections.push(`${icao} - ${icao}\n${blocks.join('\n')}`);
    });
    const coverage = (Array.isArray(data?.terrains) && data.terrains.length ? data.terrains : (data?.airports || []).map(a => a?.icao))
        .map(code => String(code || '').trim().toUpperCase())
        .filter(code => /^[A-Z0-9]{4}$/.test(code));
    const parts = formatNpfNotamsParisDate(generatedAt, {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const timestampText = parts
        ? `NOTAM SOFIA du ${parts.day}/${parts.month}/${parts.year} à ${parts.hour}:${parts.minute}`
        : 'NOTAM SOFIA';
    return {
        version: 'bfgNpfNotamsV1',
        source: 'NAS',
        sourceKind: 'SOFIA',
        publishedAt: generatedAt,
        generatedAt,
        notamsAutoPdfStatus: { timestampText, timestampIso: generatedAt, savedAt: generatedAt },
        notamText: sections.join('\n\n'),
        coverage,
        coverageCount: coverage.length,
        airportsWithNotams,
        notamCount,
        sofiaRequestId: String(data?.requestId || ''),
        sofiaScriptVersion: String(data?.scriptVersion || '')
    };
}

/* Lecture du fichier complet (public). Renvoie { data, search } ; data = null
 * si le NAS n'a encore aucun fichier complet. Erreur réseau ou fichier illisible : exception. */
async function fetchNpfSofiaNotamsAllFile(timeoutMs = NPF_SOFIA_NOTAMS_FILE_TIMEOUT_MS) {
    const response = await fetchBriefingDocsNas(
        `${NPF_SOFIA_NOTAMS_ALL_URL}?t=${Date.now()}`,
        { method: 'GET', headers: { 'Accept': 'application/json' } },
        timeoutMs
    );
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new Error(`Réponse inattendue du NAS (${response.status}).`);
    const search = body.search && typeof body.search === 'object' ? body.search : null;
    if (body.ok !== true) {
        if (body.error === 'absent') return { data: null, search };
        throw new Error(body.message || body.error || `Fichier NOTAM SOFIA illisible (${response.status}).`);
    }
    const data = body.data;
    if (!data || data.schema !== NPF_SOFIA_NOTAMS_ALL_SCHEMA || !Array.isArray(data.airports)
        || !Number.isFinite(Date.parse(String(data.generatedAt || '')))) {
        throw new Error('Fichier NOTAM SOFIA illisible.');
    }
    return { data, search };
}

/* Enregistre le fichier sur cet iPad s'il est plus récent que la copie locale
 * (une ancienne copie SDVFR est toujours remplacée). Sélections : même règle qu'avant. */
async function storeNpfSofiaNotamsIfNewer(data) {
    const localRecord = await getNpfBfgNotamsLocalRecord().catch(() => null);
    const localTs = Date.parse(String(localRecord?.remotePublishedAt || localRecord?.payload?.publishedAt || ''));
    const remotePublishedAt = String(data.generatedAt || '');
    const remoteTs = Date.parse(remotePublishedAt);
    if (isNpfSofiaNotamsPayload(localRecord?.payload) && Number.isFinite(localTs) && Number.isFinite(remoteTs)
        && remoteTs <= localTs) {
        return false;
    }
    const localPayload = {
        ...buildNpfNotamsPayloadFromSofiaAll(data),
        remotePublishedAt,
        npfCachedAt: new Date().toISOString()
    };
    const carriedState = carryOverNpfNotamsLocalSelections(localRecord?.payload, localPayload);
    if (carriedState) localPayload.state = carriedState;
    await putNpfBfgNotamsLocalPayload(localPayload, { remotePublishedAt });
    applyNpfNotamsCoverageFromPayload(localPayload);
    return true;
}

/* Lecture + enregistrement. Renvoie { ok, stored, search }. */
async function fetchAndStoreNpfSofiaNotams(timeoutMs) {
    const { data, search } = await fetchNpfSofiaNotamsAllFile(timeoutMs);
    try { localStorage.setItem(NPF_SOFIA_NOTAMS_LAST_CHECK_KEY, String(Date.now())); } catch (_) {}
    const stored = data ? await storeNpfSofiaNotamsIfNewer(data) : false;
    return { ok: true, stored, search, hasFile: Boolean(data) };
}

/* Nom conservé (appelé au démarrage, à l'ouverture de la fenêtre NOTAMS…) :
 * v17.59 — lit désormais le fichier SOFIA complet ; ne lance aucune recherche. */
async function syncNpfBfgNotamsFromNas(options = {}) {
    if (npfBfgNotamsSyncPromise) return npfBfgNotamsSyncPromise;
    if (!navigator.onLine || isNpfNasOffHours()) return false;

    npfBfgNotamsSyncPromise = (async () => {
        const result = await fetchAndStoreNpfSofiaNotams(Number(options.timeoutMs) || NPF_SOFIA_NOTAMS_FILE_TIMEOUT_MS);
        return result.stored;
    })();

    try {
        return await npfBfgNotamsSyncPromise;
    } catch (error) {
        if (!options.silent) throw error;
        console.info('[NPF-Q400 NOTAM] Lecture du fichier SOFIA ignorée :', error?.message || error);
        return false;
    } finally {
        npfBfgNotamsSyncPromise = null;
    }
}

function scheduleNpfBfgNotamsBackgroundSync(delayMs = 0) {
    setTimeout(() => {
        if (document.visibilityState === 'hidden' || !navigator.onLine) return;
        // v17.59 — copie du jour : mise à jour légère (jamais de recherche) ;
        // sinon règle de la première connexion du jour.
        ensureNpfSofiaNotamsOfToday('premier plan').catch(() => {});
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
    if (source) source.textContent = String(payload?.notamsAutoPdfStatus?.timestampText || 'NOTAM');
    applyNpfNotamsFreshnessClass(source, getNpfNotamsSourceIso(payload));
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
    if (source) source.textContent = 'NOTAM SOFIA';
    applyNpfNotamsFreshnessClass(source, '');
    if (status) {
        status.classList.remove('pelic-notams-modal-status-warning');
        status.textContent = 'Lecture des NOTAM de cet iPad…';
    }
    if (prefilters) prefilters.hidden = true;
    if (controls) controls.hidden = true;
    if (list) list.innerHTML = '';
    const stale = modal.querySelector('#pelic-notams-modal-stale');
    if (stale) stale.style.display = 'none';

    let payload = await readNpfBfgNotamsSharedPayload();
    // v17.59 — copie absente ou pas du jour : relecture rapide du fichier SOFIA
    // (8 s au plus, aucune recherche lancée d'ici).
    if ((!payload || !isNpfSofiaNotamsPayload(payload) || !isNpfPelicNotamsPayloadCurrentToday(payload)) && navigator.onLine) {
        await syncNpfBfgNotamsFromNas({ silent: true, timeoutMs: 8000 }).catch(() => false);
        payload = await readNpfBfgNotamsSharedPayload();
    }
    if (!payload) {
        npfPelicNotamsCurrentPayload = null;
        if (source) source.textContent = 'NOTAM SOFIA';
        if (status) {
            status.textContent = navigator.onLine
                ? 'Aucun NOTAM SOFIA sur cet iPad ni sur le NAS. Utiliser « Rafraîchir les NOTAM » (bouton Cartes).'
                : 'Aucun NOTAM SOFIA sur cet iPad (hors ligne).';
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
 * v17.59 — NOTAM SOFIA : PREMIÈRE CONNEXION DU JOUR ET BOUTON « Rafraîchir les NOTAM »
 * --------------------------------------------------------------------------
 * Contrat NAS (NOTE-INTERFACE-NPF-Q400.txt du 06/10/2026) :
 * - get-sofia-notams-all.php (GET, public) : { ok, data, search } ; absent :
 *   { ok: false, error: 'absent', search }. search.active = recherche en cours.
 * - npf-docs-api.php?action=sofia-notams-request (POST { mode }) : lance ou
 *   rejoint la recherche commune ; réponse « success » + reused/today quand le
 *   fichier complet de moins de 2 min / du jour existe déjà.
 * - npf-docs-api.php?action=sofia-notams-status&requestId=… (GET) :
 *   full.status = pending | running | success | error (fichier complet).
 * - Session absente ou expirée : HTTP 401 { error: 'unauthorized' }.
 * v17.29 remplacé : plus de notams-refresh / notams-refresh-status / notams-snapshot.
 */
const NPF_NOTAMS_API_TIMEOUT_MS = 15000;
let npfNotamsManualRefreshInProgress = false;

/* Copie locale seule (IndexedDB), sans la migration v16.05 qui ouvrirait
 * l'ancien cache partagé : rien n'est créé dans Cache Storage. */
async function readNpfSofiaNotamsLocalPayload() {
    const record = await getNpfBfgNotamsLocalRecord().catch(() => null);
    return record?.payload || null;
}

function setNpfNotamsRefreshStatus(message, { error = false, success = false, notamsIso = '' } = {}) {
    const status = document.getElementById('notams-refresh-status');
    if (!status) return;
    status.textContent = String(message || '');
    status.classList.toggle('notams-refresh-status-error', Boolean(error));
    status.classList.toggle('notams-refresh-status-success', Boolean(success));
    // v17.62 — phrase de fraîcheur : vert si NOTAM du jour, rouge sinon ; autres messages : aucune.
    applyNpfNotamsFreshnessClass(status, notamsIso);
}

/* v17.62 — COULEUR DE FRAÎCHEUR des phrases « NOTAM SOFIA du … » : vert si les NOTAM
 * sont du jour (date de Paris), rouge sinon ; textes inchangés, pas de fond. La date
 * des NOTAM est gardée sur l'élément (data-npf-notams-iso) pour recolorer sans relire. */
function applyNpfNotamsFreshnessClass(element, iso) {
    if (!element) return;
    const value = String(iso || '').trim();
    const sourceDay = value ? npfPelicNotamsParisDateKey(value) : '';
    if (!sourceDay) {
        delete element.dataset.npfNotamsIso;
        element.classList.remove('npf-notams-du-jour', 'npf-notams-pas-du-jour');
        return;
    }
    element.dataset.npfNotamsIso = value;
    const today = sourceDay === npfPelicNotamsParisDateKey(new Date());
    element.classList.toggle('npf-notams-du-jour', today);
    element.classList.toggle('npf-notams-pas-du-jour', !today);
}

function refreshNpfNotamsFreshnessColors() {
    document.querySelectorAll('[data-npf-notams-iso]').forEach(element => {
        applyNpfNotamsFreshnessClass(element, element.dataset.npfNotamsIso);
    });
}

/* Passage de minuit : une vérification par minute au plus (jour de Paris), sautée si un
 * doigt est sur la carte (reprise à la minute suivante) ; retour au premier plan : aussitôt. */
let npfNotamsFreshnessDay = npfPelicNotamsParisDateKey(new Date());
setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    if (typeof isNpfMapGesturePauseActive === 'function' && isNpfMapGesturePauseActive()) return;
    const day = npfPelicNotamsParisDateKey(new Date());
    if (day === npfNotamsFreshnessDay) return;
    npfNotamsFreshnessDay = day;
    refreshNpfNotamsFreshnessColors();
}, 60000);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    npfNotamsFreshnessDay = npfPelicNotamsParisDateKey(new Date());
    refreshNpfNotamsFreshnessColors();
});

let npfNotamsRefreshLastPercent = 0;

function setNpfNotamsRefreshProgress(stepIndex, stepCount) {
    const container = document.getElementById('notams-refresh-progress');
    const bar = document.getElementById('notams-refresh-progress-bar');
    const text = document.getElementById('notams-refresh-progress-text');
    if (!container) return;
    const count = Number(stepCount) || 0;
    const index = Math.min(Number(stepIndex) || 0, count);
    if (count < 1 || index < 1) {
        npfNotamsRefreshLastPercent = 0;
        container.style.display = 'none';
        return;
    }
    container.style.display = '';
    // v17.60 — pourcentage (« 12/24 » se lisait comme un nombre de terrains). En cas de
    // secours du VPS (demandes jour par jour), le total augmente : l'affichage ne recule
    // jamais, il attend que l'avancement réel dépasse la dernière valeur affichée.
    // v17.61 — demandes TERMINÉES, comme BFG TEST v5.45 : (demande en cours − 1) ÷ total,
    // 99 % au plus pendant la recherche ; 100 % seulement à la fin
    // (setNpfNotamsRefreshProgressDone).
    const percent = Math.max(npfNotamsRefreshLastPercent, Math.min(99, Math.round(((index - 1) / count) * 100)));
    npfNotamsRefreshLastPercent = percent;
    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = `Recherche SOFIA : ${percent} %`;
}

/* v17.61 — recherche terminée : 100 %, affichage normal. */
function setNpfNotamsRefreshProgressDone() {
    const container = document.getElementById('notams-refresh-progress');
    const bar = document.getElementById('notams-refresh-progress-bar');
    const text = document.getElementById('notams-refresh-progress-text');
    if (!container) return;
    npfNotamsRefreshLastPercent = 0;
    container.style.display = '';
    if (bar) bar.style.width = '100%';
    if (text) text.textContent = 'Recherche SOFIA : 100 %';
    // Retour à l'affichage normal (barre masquée) 4 s plus tard, sauf nouvelle recherche.
    setTimeout(() => {
        if (!npfNotamsManualRefreshInProgress && text && text.textContent === 'Recherche SOFIA : 100 %') {
            container.style.display = 'none';
        }
    }, 4000);
}

/* v17.61 — style « recherche en cours » sur la ligne d'état et la barre existantes
 * (texte plus gros, gras, contrasté, indicateur qui tourne). Animation CSS seule,
 * présente uniquement pendant une recherche ; rien n'est calculé pendant les gestes. */
function setNpfNotamsRefreshBusy(active) {
    const on = Boolean(active);
    document.getElementById('notams-refresh-status')?.classList.toggle('notams-refresh-busy', on);
    document.getElementById('notams-refresh-progress')?.classList.toggle('notams-refresh-busy', on);
}

/* Alerte « pas du jour » : date et heure des NOTAM affichés. */
function getNpfSofiaNotamsDateLabel(payload) {
    const iso = getNpfNotamsSourceIso(payload);
    const dayMonth = formatNpfNotamsParisDayMonth(iso);
    const hourMinute = formatNpfNotamsParisHourMinute(iso);
    return dayMonth ? `du ${dayMonth}${hourMinute ? ` à ${hourMinute}` : ''}` : '';
}

function getNpfSofiaNotamsNotTodayAlertText(payload) {
    if (!payload) return 'Aucun NOTAM SOFIA sur cet iPad.';
    const stale = getNpfNotamsStaleWarningText(payload);
    return stale ? `${stale}.` : '';
}

async function displayNpfNotamsLocalStatus() {
    if (npfNotamsManualRefreshInProgress) return;
    const record = await getNpfBfgNotamsLocalRecord().catch(() => null);
    const payload = record?.payload;
    if (!payload) {
        setNpfNotamsRefreshStatus('Aucun NOTAM SOFIA sur cet iPad.', { error: true });
        return;
    }
    const source = String(payload?.notamsAutoPdfStatus?.timestampText || '').trim() || 'NOTAM';
    const staleText = getNpfNotamsStaleWarningText(payload);
    const coverageCount = getNpfNotamsCoverageFromPayload(payload).length;
    setNpfNotamsRefreshStatus(
        `Copie locale : ${source} — ${coverageCount} terrain(s) couvert(s).${staleText ? ` ${staleText}.` : ''}`,
        { notamsIso: getNpfNotamsSourceIso(payload) }
    );
}

function handleNpfNotamsAuthorizationMissing() {
    // Même règle que FdS / GAAR (v17.40) : BFG associé et pont refusé (BFG TEST
    // non connecté) -> mot de passe de session ; BFG associé sans réponse -> message.
    if (getStoredNpfBfgBridgeCredentials()) {
        if (typeof npfBfgBridgeLastStatus !== 'undefined' && npfBfgBridgeLastStatus === 'refusé') {
            openBriefingDocsPasswordModal('notams', { allowWhenPaired: true, reason: 'bfg-refused' });
            setNpfNotamsRefreshStatus('Connexion BFG refusée : saisis le mot de passe de session NPF-Q400.', { error: true });
            return;
        }
        setNpfNotamsRefreshStatus(getBriefingDocsBfgAuthorizationUnavailableMessage(), { error: true });
        return;
    }
    openBriefingDocsPasswordModal('notams');
    setNpfNotamsRefreshStatus('Autorisation expirée : saisis à nouveau le mot de passe NPF-Q400.', { error: true });
}

/* Fenêtre de confirmation interne (boutons Annuler / Continuer). */
function npfConfirmInApp(message) {
    return new Promise(resolve => {
        let overlay = document.getElementById('npf-confirm-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'npf-confirm-modal';
            overlay.className = 'npf-confirm-modal';
            overlay.innerHTML = `
                <div class="npf-confirm-card" role="dialog" aria-modal="true" aria-labelledby="npf-confirm-title">
                    <div id="npf-confirm-title" class="npf-confirm-title">Confirmation</div>
                    <div class="npf-confirm-message"></div>
                    <div class="npf-confirm-actions">
                        <button type="button" class="npf-confirm-cancel">Annuler</button>
                        <button type="button" class="npf-confirm-ok">Continuer</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
        }
        overlay.querySelector('.npf-confirm-message').textContent = String(message || '');
        const done = value => {
            overlay.style.display = 'none';
            overlay.querySelector('.npf-confirm-ok').onclick = null;
            overlay.querySelector('.npf-confirm-cancel').onclick = null;
            overlay.onclick = null;
            resolve(value);
        };
        overlay.querySelector('.npf-confirm-ok').onclick = event => { event.stopPropagation(); done(true); };
        overlay.querySelector('.npf-confirm-cancel').onclick = event => { event.stopPropagation(); done(false); };
        overlay.onclick = event => { if (event.target === overlay) done(false); };
        overlay.style.display = 'flex';
    });
}

/* Lancement (ou rejoint) d'une recherche commune. Renvoie la réponse du NAS,
 * { unauthorized: true } sans session valide ; erreur : exception. */
async function requestNpfSofiaNotamsSearch(session, mode) {
    const response = await fetchBriefingDocsNas(
        `${NPF_BRIEFING_DOCS_API_URL}?action=sofia-notams-request&t=${Date.now()}`,
        {
            method: 'POST',
            headers: { ...briefingDocsAuthHeaders(session), 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: mode === 'first-connection' ? 'first-connection' : 'manual' })
        },
        NPF_NOTAMS_API_TIMEOUT_MS
    );
    if (response.status === 401) return { unauthorized: true };
    const payload = await response.json().catch(() => null);
    if (!payload || payload.ok !== true) {
        throw new Error(payload?.message || payload?.error || `Réponse inattendue du NAS (${response.status}).`);
    }
    return payload;
}

async function requestNpfSofiaNotamsStatus(session, requestId) {
    const response = await fetchBriefingDocsNas(
        `${NPF_BRIEFING_DOCS_API_URL}?action=sofia-notams-status&requestId=${encodeURIComponent(requestId)}&t=${Date.now()}`,
        { method: 'GET', headers: briefingDocsAuthHeaders(session) },
        NPF_NOTAMS_API_TIMEOUT_MS
    );
    if (response.status === 401) return { unauthorized: true };
    return await response.json().catch(() => null);
}

function npfSofiaNotamsWait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* Suivi d'une recherche jusqu'au fichier complet, 5 min au plus.
 * Avec session et identifiant : état léger toutes les 3 s. Sinon : relecture du
 * fichier public toutes les 60 s. Renvoie { kind: 'ready' | 'error' | 'timeout'
 * | 'offline' | 'ended', message }. Le fichier « ready » est déjà enregistré. */
async function followNpfSofiaNotamsSearch(session, initial, onProgress = null) {
    const startedAt = Date.now();
    const requestId = String(initial?.requestId || '');
    let useStatus = Boolean(session && requestId);
    if (initial?.status === 'success' && (initial.reused === true || initial.today === true)) {
        await fetchAndStoreNpfSofiaNotams();
        return { kind: 'ready' };
    }
    while (Date.now() - startedAt < NPF_SOFIA_NOTAMS_FOLLOW_MAX_MS) {
        if (!navigator.onLine) return { kind: 'offline' };
        if (isNpfNasOffHours()) return { kind: 'ended' };
        if (useStatus) {
            await npfSofiaNotamsWait(NPF_SOFIA_NOTAMS_POLL_MS);
            let state = null;
            try { state = await requestNpfSofiaNotamsStatus(session, requestId); } catch (_) { continue; }
            if (!state || state.unauthorized || state.ok !== true) {
                if (state && !state.unauthorized && state.error !== 'unknown_request') continue;
                useStatus = false;          // session perdue ou demande remplacée : relecture du fichier
                continue;
            }
            const full = state.full && typeof state.full === 'object' ? state.full : {};
            if (typeof onProgress === 'function') {
                // v17.60 — avancement en demandes SOFIA : partie BFG (premier groupe)
                // puis fichier complet ; total annoncé par le NAS (3 groupes sinon).
                const total = Number(full.steps) > 0 ? Number(full.steps)
                    : (Number(state.steps) > 0 ? Number(state.steps) * 3 : NPF_SOFIA_NOTAMS_SEARCH_STEPS);
                onProgress(Number(full.step) > 0 ? Number(full.step) : Number(state.step) || 0, total);
            }
            if (full.status === 'success') {
                await fetchAndStoreNpfSofiaNotams();
                return { kind: 'ready' };
            }
            if (full.status === 'error' || state.status === 'error') {
                return { kind: 'error', message: String(full.message || state.message || '').trim() };
            }
        } else {
            await npfSofiaNotamsWait(NPF_SOFIA_NOTAMS_REREAD_MS);
            let result = null;
            try { result = await fetchAndStoreNpfSofiaNotams(); } catch (_) { continue; }
            const payload = await readNpfSofiaNotamsLocalPayload().catch(() => null);
            if (isNpfSofiaNotamsPayload(payload) && isNpfPelicNotamsPayloadCurrentToday(payload)) return { kind: 'ready' };
            if (!result?.search?.active) return { kind: 'ended' };
        }
    }
    return { kind: 'timeout' };
}

/* NOTAM SOFIA lus ou mis à jour : la fenêtre NOTAMS ouverte et l'état de
 * « Gestion des Cartes » sont remis à jour (fenêtre : seulement si elle
 * montrait des NOTAM qui n'étaient pas du jour, pour ne pas bouger la lecture). */
async function refreshOpenNpfNotamsViews() {
    const payload = await readNpfSofiaNotamsLocalPayload().catch(() => null);
    const modal = document.getElementById('pelic-notams-modal');
    if (payload && modal && !modal.hidden && npfPelicNotamsCurrentOaci
        && !isNpfPelicNotamsPayloadCurrentToday(npfPelicNotamsCurrentPayload)) {
        npfPelicNotamsCurrentPayload = payload;
        renderNpfPelicNotams(payload, npfPelicNotamsCurrentOaci);
    }
    displayNpfNotamsLocalStatus().catch(() => {});
}

function showNpfSofiaNotamsAlertOncePerDay(payload) {
    const text = getNpfSofiaNotamsNotTodayAlertText(payload);
    if (!text) return;
    const today = npfPelicNotamsParisDateKey(new Date());
    try {
        if (localStorage.getItem(NPF_SOFIA_NOTAMS_ALERT_DAY_KEY) === today) return;
        localStorage.setItem(NPF_SOFIA_NOTAMS_ALERT_DAY_KEY, today);
    } catch (_) {}
    showNpfInfoBanner(text.startsWith('⚠️') ? text : `⚠️ ${text}`, { kind: 'error', durationMs: 12000 });
}

/* Attente de la fin d'un geste sur la carte (doigt posé + 0,8 s), 30 s au plus. */
async function waitNpfMapIdleForNotams(maxMs = 30000) {
    const end = Date.now() + maxMs;
    while (typeof isNpfMapGesturePauseActive === 'function' && isNpfMapGesturePauseActive() && Date.now() < end) {
        await npfSofiaNotamsWait(250);
    }
}

/* v17.59 — MISE À JOUR LÉGÈRE (copie du jour déjà sur l'iPad ; démarrage,
 * retour au premier plan, retour du réseau) : au plus une lecture toutes les
 * 10 min du fichier complet du NAS ; enregistré seulement s'il est plus récent
 * que la copie de l'iPad (ex. passage de 10:00). Jamais de recherche SOFIA,
 * jamais de mot de passe, rien entre 23h50 et 06h00. Échec réseau : silencieux,
 * la copie de l'iPad est gardée. Lecture et enregistrement hors des gestes sur
 * la carte. Le NAS n'a pas d'état léger public : le « contrôle » lit le fichier
 * (conversion et écriture seulement s'il est plus récent). */
async function lightUpdateNpfSofiaNotams(reason = '') {
    if (!navigator.onLine || isNpfNasOffHours() || npfNotamsManualRefreshInProgress) return false;
    let lastCheck = 0;
    try { lastCheck = Number(localStorage.getItem(NPF_SOFIA_NOTAMS_LAST_CHECK_KEY) || 0); } catch (_) {}
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < NPF_SOFIA_NOTAMS_RECHECK_MS) return false;
    try { localStorage.setItem(NPF_SOFIA_NOTAMS_LAST_CHECK_KEY, String(Date.now())); } catch (_) {}

    await waitNpfMapIdleForNotams();
    let file;
    try {
        file = await fetchNpfSofiaNotamsAllFile();
    } catch (error) {
        console.info(`[NPF-Q400 NOTAM] Mise à jour légère (${reason}) impossible, copie de l'iPad gardée :`, error?.message || error);
        return false;
    }
    if (!file.data) return false;
    const local = await readNpfSofiaNotamsLocalPayload();
    const localTs = Date.parse(String(local?.generatedAt || local?.publishedAt || ''));
    if (isNpfSofiaNotamsPayload(local) && Number.isFinite(localTs) && Date.parse(String(file.data.generatedAt)) <= localTs) {
        return false;                               // même fichier (ou plus ancien) : rien à faire
    }
    await waitNpfMapIdleForNotams();
    const stored = await storeNpfSofiaNotamsIfNewer(file.data).catch(() => false);
    if (stored) await refreshOpenNpfNotamsViews();
    return stored;
}

/* Première connexion du jour (démarrage, retour au premier plan, retour du
 * réseau) : fichier complet du jour -> rien d'autre ; recherche en cours (BFG,
 * passage planifié…) -> attente de son résultat ; sinon recherche commune
 * « first-connection », seulement avec une session obtenue sans mot de passe
 * (session en cours ou pont BFG). Jamais de mot de passe demandé ici. */
async function ensureNpfSofiaNotamsOfToday(reason = '') {
    if (npfSofiaNotamsDailyPromise) return npfSofiaNotamsDailyPromise;
    npfSofiaNotamsDailyPromise = (async () => {
        if (!navigator.onLine || isNpfNasOffHours() || npfNotamsManualRefreshInProgress) return false;
        const local = await readNpfSofiaNotamsLocalPayload().catch(() => null);
        const localToday = isNpfSofiaNotamsPayload(local) && isNpfPelicNotamsPayloadCurrentToday(local);
        // Copie du jour déjà sur l'iPad : mise à jour légère seulement (jamais de recherche).
        if (localToday) return await lightUpdateNpfSofiaNotams(reason);

        let result;
        try {
            result = await fetchAndStoreNpfSofiaNotams();
        } catch (error) {
            console.info('[NPF-Q400 NOTAM] NAS injoignable :', error?.message || error);
            return false;
        }
        let payload = await readNpfSofiaNotamsLocalPayload().catch(() => null);
        if (isNpfSofiaNotamsPayload(payload) && isNpfPelicNotamsPayloadCurrentToday(payload)) {
            if (result.stored) await refreshOpenNpfNotamsViews();
            return true;
        }

        console.info(`[NPF-Q400 NOTAM] ${reason} : aucun fichier NOTAM SOFIA du jour, recherche ${result.search?.active ? 'en cours' : 'à lancer'}.`);
        if (result.search?.active) {
            await followNpfSofiaNotamsSearch(getStoredBriefingDocsSession(), { requestId: result.search.requestId || '' });
        } else {
            let session = getStoredBriefingDocsSession();
            if (!session) session = await tryAuthorizeBriefingDocsFromBfgBridge({ silent: true }).catch(() => null);
            if (session) {
                try {
                    const answer = await requestNpfSofiaNotamsSearch(session, 'first-connection');
                    if (!answer.unauthorized) await followNpfSofiaNotamsSearch(getStoredBriefingDocsSession(), answer);
                } catch (error) {
                    console.info('[NPF-Q400 NOTAM] Recherche du jour impossible :', error?.message || error);
                }
            }
        }
        payload = await readNpfSofiaNotamsLocalPayload().catch(() => null);
        await refreshOpenNpfNotamsViews();
        const ok = isNpfSofiaNotamsPayload(payload) && isNpfPelicNotamsPayloadCurrentToday(payload);
        if (!ok) showNpfSofiaNotamsAlertOncePerDay(payload);
        return ok;
    })();
    try {
        return await npfSofiaNotamsDailyPromise;
    } catch (error) {
        console.info('[NPF-Q400 NOTAM] Vérification du jour interrompue :', error?.message || error);
        return false;
    } finally {
        npfSofiaNotamsDailyPromise = null;
    }
}

/* Bouton « Rafraîchir les NOTAM » : nouvelle recherche SOFIA complète (114
 * terrains), après confirmation. options.confirmed : retour de la fenêtre mot de passe. */
async function refreshNpfNotamsFromNasManually(options = {}) {
    if (npfNotamsManualRefreshInProgress) return;
    if (!navigator.onLine) {
        setNpfNotamsRefreshStatus('Hors ligne : recherche NOTAM impossible. Les NOTAM de cet iPad restent affichés.', { error: true });
        return;
    }
    if (isNpfNasOffHours()) {
        setNpfNotamsRefreshStatus('NAS éteint de 23h50 à 06h00 : recherche NOTAM impossible. Les NOTAM de cet iPad restent affichés.', { error: true });
        return;
    }
    if (options.confirmed !== true) {
        const confirmed = await npfConfirmInApp('La recherche complète des NOTAM sur SOFIA prend environ 1 minute.');
        if (!confirmed) return;
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

        setNpfNotamsRefreshBusy(true);
        setNpfNotamsRefreshStatus('Recherche des NOTAM sur SOFIA : demande envoyée…');
        const answer = await requestNpfSofiaNotamsSearch(session, 'manual');
        if (answer.unauthorized) {
            setNpfNotamsRefreshBusy(false);
            handleNpfNotamsAuthorizationMissing();
            return;
        }
        setNpfNotamsRefreshStatus('Recherche des NOTAM sur SOFIA en cours (environ 1 minute)…');
        const outcome = await followNpfSofiaNotamsSearch(session, answer, (step, total) => {
            setNpfNotamsRefreshProgress(step, total || NPF_SOFIA_NOTAMS_SEARCH_STEPS);
        });
        setNpfNotamsRefreshBusy(false);
        if (outcome.kind === 'ready') {
            setNpfNotamsRefreshProgressDone();
            const payload = await readNpfSofiaNotamsLocalPayload().catch(() => null);
            const source = String(payload?.notamsAutoPdfStatus?.timestampText || 'NOTAM SOFIA');
            setNpfNotamsRefreshStatus(`${source} : enregistrés sur cet iPad pour le hors ligne.`, { notamsIso: getNpfNotamsSourceIso(payload) });
            await refreshOpenNpfNotamsViews();
            return;
        }
        setNpfNotamsRefreshProgress(0, 0);
        if (outcome.kind === 'error') {
            setNpfNotamsRefreshStatus(
                `Recherche des NOTAM sur SOFIA impossible${outcome.message ? ` : ${outcome.message}` : ''}. Les NOTAM de cet iPad restent affichés.`,
                { error: true }
            );
            return;
        }
        if (outcome.kind === 'offline') {
            setNpfNotamsRefreshStatus('Connexion perdue : suivi de la recherche interrompu. Les NOTAM de cet iPad restent affichés.', { error: true });
            return;
        }
        setNpfNotamsRefreshStatus('La recherche n’a pas abouti en 5 min. Les NOTAM de cet iPad restent affichés ; réessaie dans quelques minutes.', { error: true });
    } catch (error) {
        setNpfNotamsRefreshBusy(false);
        setNpfNotamsRefreshProgress(0, 0);
        if (!getStoredBriefingDocsSession()) {
            handleNpfNotamsAuthorizationMissing();
        } else if (error?.name === 'AbortError') {
            setNpfNotamsRefreshStatus('Le NAS ne répond pas (délai dépassé). Les NOTAM de cet iPad restent affichés.', { error: true });
        } else {
            setNpfNotamsRefreshStatus(`Recherche des NOTAM sur SOFIA impossible : ${error?.message || String(error)}. Les NOTAM de cet iPad restent affichés.`, { error: true });
        }
    } finally {
        setNpfNotamsRefreshBusy(false);
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


