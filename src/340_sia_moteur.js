let siaDbPromise = null;
let siaDataset = null;
let siaDatasetLoadPromise = null;
let siaMapLiteDataset = null;
let siaMapLiteDatasetLoadPromise = null;
let siaLayerGroup = null;
let siaAirspaceRenderer = null;
let siaCtrTouchRenderer = null;
let siaPointRenderer = null;
let siaSelectionRenderer = null;
let siaSelectionLayer = null;

let siaProfileOpen = false;
let siaProfileDistanceNm = 25;
let siaProfileRefreshTimer = null;
let siaProfileSegments = [];

// v15.75 — sélection propre au PROFIL, indépendante des filtres carte.
const SIA_PROFILE_FILTER_PREFS_KEY = 'npfSiaProfileFilterPrefs_v1';
let siaProfileFilterPrefs = null;

// v15.83 — l'affichage graphique des volumes est mémorisé entre deux ouvertures.
const SIA_MAP_AIRSPACES_VISIBLE_PREF_KEY = 'npfSiaMapAirspacesVisible_v1';

function loadSiaMapAirspacesVisiblePreference() {
    try {
        const stored = localStorage.getItem(SIA_MAP_AIRSPACES_VISIBLE_PREF_KEY);
        if (stored === 'false') return false;
        if (stored === 'true') return true;
    } catch (_) {}
    // Migration / première utilisation : conserver le comportement historique.
    return true;
}

function saveSiaMapAirspacesVisiblePreference(visible) {
    try {
        localStorage.setItem(
            SIA_MAP_AIRSPACES_VISIBLE_PREF_KEY,
            visible === false ? 'false' : 'true'
        );
    } catch (_) {}
}

let siaMapAirspacesVisible = loadSiaMapAirspacesVisiblePreference();

/*
 * v15.98 — masque rapide des points VFR / VRP depuis le coin bas-gauche du
 * bouton France. Il reste indépendant du filtre SIA principal, mais son état
 * d'affichage est désormais mémorisé d'une ouverture de NPF à l'autre.
 */
const SIA_MAP_VRP_VISIBLE_PREF_KEY = 'npfSiaMapVrpVisible_v1';

function loadSiaMapVrpVisiblePreference() {
    try {
        const stored = localStorage.getItem(SIA_MAP_VRP_VISIBLE_PREF_KEY);
        if (stored === 'false') return false;
        if (stored === 'true') return true;
    } catch (_) {}
    return true;
}

function saveSiaMapVrpVisiblePreference(visible) {
    try {
        localStorage.setItem(
            SIA_MAP_VRP_VISIBLE_PREF_KEY,
            visible === false ? 'false' : 'true'
        );
    } catch (_) {}
}

let siaMapVrpVisible = loadSiaMapVrpVisiblePreference();

function updateQuickSiaVrpToggleButton() {
    const button = document.getElementById('quick-sia-vrp-toggle');
    if (!button) return;

    const hidden = !siaMapVrpVisible;
    button.classList.toggle('is-hidden', hidden);
    button.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    button.title = hidden
        ? 'Réafficher les points VFR / VRP'
        : 'Masquer les points VFR / VRP';
    button.setAttribute(
        'aria-label',
        hidden
            ? 'Réafficher les points VFR / VRP'
            : 'Masquer les points VFR / VRP'
    );
}

function setSiaMapVrpVisible(visible) {
    const next = visible !== false;
    saveSiaMapVrpVisiblePreference(next);
    if (siaMapVrpVisible === next) {
        updateQuickSiaVrpToggleButton();
        return;
    }

    siaMapVrpVisible = next;
    updateQuickSiaVrpToggleButton();
    scheduleSiaLayerRefresh(
        next ? 'quick-vrp-show' : 'quick-vrp-hide'
    );
}

// v15.75 — tampon de rendu et cache de géométries pour limiter les reconstructions iPad.
const SIA_RENDER_BOUNDS_PAD_RATIO = 0.25;
const SIA_COMBINED_HEAVY_RENDER_PAD_RATIO = 0.04;
const SIA_POINT_ONLY_RENDER_BOUNDS_PAD_RATIO = 0.80;
let siaRenderedCoverageBounds = null;
let siaRenderedZoom = null;
let siaRenderedSignature = '';
let siaRenderedAirspaceFeatures = [];
let siaZoomDependentLayers = [];
let siaRenderedShowDesignatedPoints = null;
let siaRenderedPointLabelsEnabled = null;

/*
 * v16.87 — détail réel du contenu SIA visible.
 * Le simple compteur `siaLayers` ne permettait pas de savoir si la charge
 * provenait des zones, terrains, VRP, autres points ou décorations.
 */
let siaRenderedDiagnosticCounts = {
    zones: 0,
    terrains: 0,
    vrp: 0,
    otherPoints: 0,
    decorations: 0,
    touchEntries: 0
};

let siaRefreshInProgress = false;
let siaRefreshPendingReason = null;
let siaRefreshCurrentReason = null;
let siaRefreshScheduledReason = null;
/*
 * Fluidité iPad : pendant un pan, Leaflet déplace le rendu existant sans
 * reconstruire le SIA. Les décorations dépendantes de l'écran sont recalculées
 * seulement après la fin du geste et après une courte période d'inactivité.
 */
let siaMoveDecorationRefreshTimer = null;
/*
 * v16.87 — 560 ms était trop court sur iPad : lors de petits déplacements
 * successifs, les bandes/libellés pouvaient être reconstruits entre deux gestes.
 * On exige désormais une vraie période de stabilité, puis on vérifie à nouveau
 * juste avant de commencer le travail.
 */
const SIA_MOVE_DECORATION_IDLE_MS = 950;
const SIA_DECORATION_STABLE_RECHECK_MS = 180;
let siaLastMapMotionAt = 0;
let siaLastDecorationViewKey = '';

function markSiaDecorationMapMotion() {
    siaLastMapMotionAt = NPF_STARTUP_DIAGNOSTIC.now();
}

function getSiaDecorationViewKey() {
    if (!map) return '';
    try {
        const bounds = map.getBounds();
        const round = value => Number(value).toFixed(4);
        return [
            map.getZoom(),
            round(bounds.getSouth()),
            round(bounds.getWest()),
            round(bounds.getNorth()),
            round(bounds.getEast()),
            String(siaRenderedSignature || ''),
            Number(siaRenderedAirspaceFeatures?.length || 0)
        ].join('|');
    } catch (_) {
        return '';
    }
}

/* v16.32 — décorations SIA construites par petits lots pour ne plus figer WebKit. */
/* v16.70 — budget temporel plutôt qu'un nombre fixe de zones : une géométrie
 * complexe peut coûter beaucoup plus cher que deux géométries simples. */
const SIA_DECORATION_TIME_BUDGET_MS = 9;
const SIA_DECORATION_VIEW_PAD_RATIO = 0.015;
const SIA_DECORATION_LIGHTWEIGHT_SCALE_NM = 10;
const SIA_TOUCH_SURFACE_BATCH_SIZE = 24;
const SIA_TOUCH_SURFACE_LIGHTWEIGHT_BATCH_SIZE = 512;
let siaDecorationProgressiveRun = 0;
/*
 * v16.34 — garde one-shot : certains ajustements Leaflet de fin de démarrage
 * émettent un moveend sans movestart utilisateur juste après startup-prefs.
 * Ne pas relancer une deuxième fois les mêmes décorations dans ce cas.
 */
let siaStartupPassiveMoveendGuardUntil = 0;
const SIA_STARTUP_PASSIVE_MOVEEND_GUARD_MS = 2500;
/* v16.57 — tant que startup-prefs est programmé, un moveend passif de démarrage
 * ne doit pas lancer une seconde reconstruction SIA sur la même vue. */
let siaStartupInitialRefreshPending = false;
/* v16.58 — empêche moveend de lancer un rendu intermédiaire pendant un zoom. */
let siaZoomGestureActive = false;
/* v16.62 — lorsqu'un zoom out HT+Routes est en cours, le moveend associé ne
 * doit pas déclencher un rendu SIA avant la vue finale stabilisée. */
let siaHeavyZoomFinalRefreshPending = false;
let siaHeavyZoomObservedPromise = null;
/* Ancien préchargement conservé pour compatibilité mais non déclenché pendant le pan. */
let siaMovePreloadLastTriggerAt = 0;
const SIA_MOVE_PRELOAD_MIN_INTERVAL_MS = 400;
const SIA_MOVE_PRELOAD_INNER_PAD_RATIO = -0.08;
const SIA_GEOMETRY_CACHE_MAX = 900;
const siaGeometryCache = new Map();

/* v15.54 — la surface tactile "CTR" est généralisée à tous les espaces SIA. */
let siaSelectedCtrTouchLayer = null;
let siaSelectedCtrKey = null;
let siaSelectedAirspaceItem = null;
let siaSelectedAirspaceGeometry = null;
let siaAirspaceTouchEntries = [];
let siaRefreshTimer = null;
let siaFilterPrefs = null;

function openSiaDb() {
    if (siaDbPromise) return siaDbPromise;
    siaDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(SIA_DB_NAME, SIA_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(SIA_DB_STORE)) {
                db.createObjectStore(SIA_DB_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Ouverture IndexedDB SIA impossible'));
    });
    return siaDbPromise;
}

async function siaDbGet(key) {
    const db = await openSiaDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SIA_DB_STORE, 'readonly');
        const req = tx.objectStore(SIA_DB_STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Lecture IndexedDB SIA impossible'));
    });
}

async function siaDbPut(key, value) {
    const db = await openSiaDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SIA_DB_STORE, 'readwrite');
        tx.objectStore(SIA_DB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Écriture IndexedDB SIA impossible'));
        tx.onabort = () => reject(tx.error || new Error('Écriture IndexedDB SIA annulée'));
    });
}

async function siaDbDelete(key) {
    const db = await openSiaDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SIA_DB_STORE, 'readwrite');
        tx.objectStore(SIA_DB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Suppression IndexedDB SIA impossible'));
    });
}

function siaMetaMatchesEmbedded(meta) {
    return !!meta
        && String(meta.airac || '') === SIA_EMBEDDED_META.airac
        && String(meta.effectiveDate || '') === SIA_EMBEDDED_META.effectiveDate
        && String(meta.datasetVersion || '') === SIA_EMBEDDED_META.datasetVersion
        && Number(meta.airspaces || 0) === SIA_EMBEDDED_META.airspaces
        && Number(meta.ahp || 0) === SIA_EMBEDDED_META.ahp
        && Number(meta.dpnNonIfr || 0) === SIA_EMBEDDED_META.dpnNonIfr
        && String(meta.npfDatasetRevision || '') === SIA_EMBEDDED_META.npfDatasetRevision;
}

async function decodeEmbeddedSiaGzipBase64(gzipBase64, invalidMessage) {
    if (!gzipBase64) {
        throw new Error(invalidMessage || 'Données SIA intégrées indisponibles.');
    }
    if (typeof DecompressionStream !== 'function') {
        throw new Error("Cette version d'iPadOS/Safari ne fournit pas DecompressionStream nécessaire au jeu SIA compressé.");
    }

    const binary = atob(gzipBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    const decompressed = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(decompressed).text();
    const parsed = JSON.parse(text);

    if (!parsed || !parsed.meta || !Array.isArray(parsed.airspaces)
        || !Array.isArray(parsed.terrain) || !Array.isArray(parsed.points)) {
        throw new Error(invalidMessage || 'Jeu SIA intégré invalide.');
    }
    return parsed;
}

async function decodeEmbeddedSiaDataset() {
    if (!SIA_EMBEDDED_AVAILABLE) {
        throw new Error("Données SIA intégrées indisponibles : le fichier sia.js est absent ou invalide.");
    }
    return decodeEmbeddedSiaGzipBase64(
        SIA_EMBEDDED_GZIP_BASE64,
        'Jeu SIA intégré invalide.'
    );
}

async function ensureSiaMapLiteDatasetLoaded() {
    if (siaDataset) return siaDataset;
    if (siaMapLiteDataset) return siaMapLiteDataset;
    if (siaMapLiteDatasetLoadPromise) return siaMapLiteDatasetLoadPromise;

    if (!SIA_EMBEDDED_MAP_LITE_AVAILABLE) {
        /*
         * Cas de secours uniquement. En v16.74 le fallback embarqué dans
         * script.js rend normalement cette branche inaccessible.
         */
        return ensureSiaDatasetLoaded({
            full: true,
            reason: 'map-lite-indisponible'
        });
    }

    npfStartupDiagMark('sia_map_lite_start', 'SIA — carte légère');
    siaMapLiteDatasetLoadPromise = (async () => {
        const parsed = await decodeEmbeddedSiaGzipBase64(
            SIA_EMBEDDED_MAP_LITE_GZIP_BASE64,
            'Jeu SIA carte légère invalide.'
        );
        if (parsed.airspaces.length !== 0) {
            throw new Error('Jeu SIA carte légère invalide : volumes inattendus.');
        }
        siaMapLiteDataset = parsed;
        return siaMapLiteDataset;
    })();

    try {
        const loaded = await siaMapLiteDatasetLoadPromise;
        npfStartupDiagMark(
            'sia_map_lite_ready',
            'SIA — carte légère prête',
            `${Array.isArray(loaded?.terrain) ? loaded.terrain.length : 0} terrains · ${Array.isArray(loaded?.points) ? loaded.points.length : 0} points`
        );
        return loaded;
    } catch (error) {
        npfStartupDiagMark('sia_map_lite_error', 'SIA — carte légère en erreur', error?.message || error);
        throw error;
    } finally {
        siaMapLiteDatasetLoadPromise = null;
    }
}

async function ensureSiaDatasetForMapRefresh() {
    /*
     * v16.73 — zones masquées : le rendu carte n'a besoin que des terrains
     * et points. Le dataset complet est réservé aux volumes/profils.
     */
    if (!siaMapAirspacesVisible && !siaDataset) {
        return ensureSiaMapLiteDatasetLoaded();
    }
    return ensureSiaDatasetLoaded({
        full: true,
        reason: 'carte-zones-visibles'
    });
}

async function ensureSiaDatasetLoaded(options = {}) {
    const forceEmbedded = !!options.forceEmbedded;
    const explicitFull = options.full === true;
    const requestReason = String(options.reason || '').trim() || 'appel-non-qualifié';

    if (siaDataset && !forceEmbedded) return siaDataset;
    if (siaDatasetLoadPromise && !forceEmbedded) return siaDatasetLoadPromise;

    /*
     * v16.74 — verrou anti-chargement passif.
     *
     * Le dataset complet (5 066 espaces) n'est autorisé que pour un besoin
     * explicite, ou lorsque les volumes SIA / le profil sont réellement actifs.
     * Tout appel ancien/non qualifié survenant au démarrage avec zones masquées
     * est redirigé vers le dataset carte léger.
     */
    if (
        !forceEmbedded
        && !explicitFull
        && !siaMapAirspacesVisible
        && !siaProfileOpen
    ) {
        npfStartupDiagMark(
            'sia_dataset_passive_blocked',
            'SIA — dataset complet différé',
            requestReason
        );
        npfDiagSiaInteraction(
            'SIA RAFRAÎCHISSEMENT',
            `dataset complet différé · raison=${requestReason} · zones=OFF · profil=FERMÉ`,
            { totalMs: 0 }
        );
        return ensureSiaMapLiteDatasetLoaded();
    }

    npfStartupDiagMark(
        'sia_dataset_start',
        'SIA — données',
        `raison=${requestReason}`
    );
    siaDatasetLoadPromise = (async () => {
        if (!forceEmbedded) {
            try {
                const meta = await siaDbGet(SIA_META_KEY);
                if (siaMetaMatchesEmbedded(meta)) {
                    const stored = await siaDbGet(SIA_DATASET_KEY);
                    if (stored && Array.isArray(stored.airspaces)
                        && Array.isArray(stored.terrain) && Array.isArray(stored.points)) {
                        siaDataset = stored;
                        return siaDataset;
                    }
                }
            } catch (error) {
                console.warn('[SIA] Lecture locale indisponible, réinitialisation depuis le jeu embarqué:', error);
            }
        }

        const embedded = await decodeEmbeddedSiaDataset();
        await siaDbPut(SIA_DATASET_KEY, embedded);
        await siaDbPut(SIA_META_KEY, embedded.meta || SIA_EMBEDDED_META);
        siaDataset = embedded;
        return siaDataset;
    })();

    try {
        const loaded = await siaDatasetLoadPromise;
        /* v16.73 — le dataset complet remplace le cache carte léger en mémoire. */
        siaMapLiteDataset = null;
        npfStartupDiagMark(
            'sia_dataset_ready',
            'SIA — données prêtes',
            `${Array.isArray(loaded?.airspaces) ? loaded.airspaces.length : 0} espaces · raison=${requestReason}`
        );
        return loaded;
    } catch (error) {
        npfStartupDiagMark('sia_dataset_error', 'SIA — données en erreur', error?.message || error);
        throw error;
    } finally {
        siaDatasetLoadPromise = null;
    }
}

function loadSiaFilterPrefs() {
    if (siaFilterPrefs) return siaFilterPrefs;
    try {
        const raw = localStorage.getItem(SIA_FILTER_PREFS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            siaFilterPrefs = parsed;
            return siaFilterPrefs;
        }
    } catch (_) {}
    siaFilterPrefs = {};
    return siaFilterPrefs;
}

function saveSiaFilterPrefs() {
    try {
        localStorage.setItem(SIA_FILTER_PREFS_KEY, JSON.stringify(loadSiaFilterPrefs()));
    } catch (_) {}
}

function hasAnyEnabledSiaFilter() {
    return Object.entries(loadSiaFilterPrefs()).some(([key, enabled]) =>
        key !== SIA_HIDE_ABOVE_FL115_PREF_KEY && enabled === true
    );
}

function isSiaFilterEnabled(key) {
    return loadSiaFilterPrefs()[key] === true;
}

function setSiaFilterEnabled(key, enabled) {
    loadSiaFilterPrefs()[key] = !!enabled;
    saveSiaFilterPrefs();

    // Le profil reflète immédiatement la liste des catégories autorisées par le filtre principal.
    if (siaDataset) {
        renderSiaProfileZoneFilterControls(siaDataset);
        scheduleSiaProfileRefresh('main-filter-change');
    }
}

function loadSiaProfileFilterPrefs() {
    if (siaProfileFilterPrefs) return siaProfileFilterPrefs;
    try {
        const raw = localStorage.getItem(SIA_PROFILE_FILTER_PREFS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            siaProfileFilterPrefs = parsed;
            return siaProfileFilterPrefs;
        }
    } catch (_) {}
    siaProfileFilterPrefs = {};
    return siaProfileFilterPrefs;
}

function saveSiaProfileFilterPrefs() {
    try {
        localStorage.setItem(SIA_PROFILE_FILTER_PREFS_KEY, JSON.stringify(loadSiaProfileFilterPrefs()));
    } catch (_) {}
}

function isSiaProfileFilterEnabled(key) {
    // Une catégorie nouvellement activée dans le filtre principal est cochée par défaut dans PROFIL.
    return loadSiaProfileFilterPrefs()[key] !== false;
}

function setSiaProfileFilterEnabled(key, enabled) {
    loadSiaProfileFilterPrefs()[key] = !!enabled;
    saveSiaProfileFilterPrefs();
}

function getSiaCachedGeometry(item) {
    if (!item || typeof item !== 'object' || !item.g) return null;
    if (siaGeometryCache.has(item)) {
        const cached = siaGeometryCache.get(item);
        // LRU simple : l'objet relu repasse en fin de Map.
        siaGeometryCache.delete(item);
        siaGeometryCache.set(item, cached);
        return cached;
    }

    const geometry = siaCompactGeometryToGeoJson(item.g) || null;
    siaGeometryCache.set(item, geometry);
    while (siaGeometryCache.size > SIA_GEOMETRY_CACHE_MAX) {
        const oldestKey = siaGeometryCache.keys().next().value;
        if (oldestKey === undefined) break;
        siaGeometryCache.delete(oldestKey);
    }
    return geometry;
}

function getSiaRenderSignature() {
    const prefs = loadSiaFilterPrefs();
    const enabled = Object.keys(prefs)
        .filter(key => key !== SIA_HIDE_ABOVE_FL115_PREF_KEY && prefs[key] === true)
        .sort();
    return [
        enabled.join('|'),
        `fl115:${isSiaHideAboveFl115Enabled() ? 1 : 0}`,
        `airspaces:${siaMapAirspacesVisible ? 1 : 0}`,
        `vrp:${siaMapVrpVisible ? 1 : 0}`
    ].join('::');
}

function siaBoundsFullyContains(outer, inner) {
    if (!outer || !inner || typeof outer.contains !== 'function') return false;
    try {
        return outer.contains(inner.getSouthWest()) && outer.contains(inner.getNorthEast());
    } catch (_) {
        return false;
    }
}

function armSiaStartupPassiveMoveendGuard() {
    siaStartupPassiveMoveendGuardUntil = NPF_STARTUP_DIAGNOSTIC.now()
        + SIA_STARTUP_PASSIVE_MOVEEND_GUARD_MS;
}

function consumeSiaStartupPassiveMoveendGuard() {
    if (!siaStartupPassiveMoveendGuardUntil) return false;
    const now = NPF_STARTUP_DIAGNOSTIC.now();
    const active = now <= siaStartupPassiveMoveendGuardUntil;
    siaStartupPassiveMoveendGuardUntil = 0;
    return active;
}

function cancelObsoleteSiaMapMotionWork(reason = 'gps-contained') {
    const mapMotionReasons = new Set([
        'gps-follow',
        'moveend',
        'move-preload',
        'moveend-refresh-contained',
        'moveend-contained'
    ]);

    clearTimeout(siaMoveDecorationRefreshTimer);
    siaMoveDecorationRefreshTimer = null;
    siaDecorationProgressiveRun += 1;

    if (mapMotionReasons.has(String(siaRefreshScheduledReason || '')) && siaRefreshTimer) {
        clearTimeout(siaRefreshTimer);
        siaRefreshTimer = null;
        siaRefreshScheduledReason = null;
    }
    if (mapMotionReasons.has(String(siaRefreshPendingReason || ''))) {
        siaRefreshPendingReason = null;
    }
    if (mapMotionReasons.has(String(siaRefreshCurrentReason || ''))) {
        window.__npfSiaRefreshGeneration = (Number(window.__npfSiaRefreshGeneration) || 0) + 1;
    }

    npfDiagSiaInteraction(
        'SIA GPS',
        `raison=${reason} · aucun traitement SIA`,
        { totalMs: 0 }
    );
}

/* v16.57 — un changement de zoom rend obsolète TOUT travail SIA calculé
 * pour l'ancienne projection, quel qu'en soit le motif d'origine. */
function cancelAllSiaWorkForZoomStart() {
    clearTimeout(siaRefreshTimer);
    siaRefreshTimer = null;
    siaRefreshScheduledReason = null;
    siaRefreshPendingReason = null;
    clearTimeout(siaMoveDecorationRefreshTimer);
    siaMoveDecorationRefreshTimer = null;
    siaDecorationProgressiveRun += 1;
    window.__npfSiaRefreshGeneration = (Number(window.__npfSiaRefreshGeneration) || 0) + 1;

    /*
     * v16.70 — bandes intérieures et libellés dépendent directement de la
     * projection écran. Ils ne doivent jamais survivre au début d'un zoom :
     * lors d'un zoom-out ils se tassent sinon au centre avant la reconstruction
     * finale. Les contours principaux peuvent, eux, rester en double-buffer.
     */
    clearSiaZoomDependentLayers();

    /* v16.58 — ne plus transporter un ancien jeu de centaines de calques SIA
     * pendant un zoom out. Sous charge combinée, ou dès que le rendu SIA est
     * déjà volumineux, on libère l'ancien groupe au début du geste. Le rendu
     * final sera reconstruit une seule fois au zoomend. */
    const renderedZoneCount = Array.isArray(siaRenderedAirspaceFeatures)
        ? siaRenderedAirspaceFeatures.length
        : 0;
    const releaseOldSiaNow = !!(
        siaMapAirspacesVisible
        && renderedZoneCount > 0
        && (showRoadOverlayLayer || showHighVoltageLinesLayer || renderedZoneCount >= 120)
    );
    if (releaseOldSiaNow) {
        clearSiaRenderedLayers();
    }

    npfDiagSiaInteraction(
        'SIA ZOOM',
        `raison=zoomstart · génération précédente invalidée · ancien-rendu=${releaseOldSiaNow ? 'libéré' : 'conservé'} · courant=${String(siaRefreshCurrentReason || 'aucun')}`,
        { totalMs: 0, zonesAvant: renderedZoneCount }
    );
}

function scheduleSiaMovePreloadRefresh() {
    if (!map || !hasAnyEnabledSiaFilter() || !siaRenderedCoverageBounds) return;

    const currentBounds = map.getBounds();
    const currentZoom = map.getZoom();
    const signature = getSiaRenderSignature();

    if (
        siaRenderedZoom !== currentZoom
        || siaRenderedSignature !== signature
    ) {
        return;
    }

    /*
     * v15.91 — ne pas attendre que le viewport sorte complètement du tampon.
     * Dès qu'il approche de son bord, reconstruire en avance autour de la vue
     * courante. Un throttle protège Safari/iPad pendant un pan continu.
     */
    let innerCoverage = null;
    try {
        innerCoverage = siaRenderedCoverageBounds.pad(SIA_MOVE_PRELOAD_INNER_PAD_RATIO);
    } catch (_) {
        innerCoverage = null;
    }

    if (innerCoverage && siaBoundsFullyContains(innerCoverage, currentBounds)) return;

    const now = Date.now();
    if ((now - siaMovePreloadLastTriggerAt) < SIA_MOVE_PRELOAD_MIN_INTERVAL_MS) return;
    siaMovePreloadLastTriggerAt = now;
    scheduleSiaLayerRefresh('move-preload');
}

function scheduleSiaCoverageRefresh(reason = 'moveend') {
    if (!map || !hasAnyEnabledSiaFilter()) return;
    const currentBounds = map.getBounds();
    const currentZoom = map.getZoom();
    const signature = getSiaRenderSignature();
    const contained = !!(
        siaRenderedCoverageBounds
        && siaRenderedZoom === currentZoom
        && siaRenderedSignature === signature
        && siaBoundsFullyContains(siaRenderedCoverageBounds, currentBounds)
    );

    /*
     * v16.55 — suivi GPS dans une couverture déjà valide = ZÉRO travail SIA.
     * Pas de profil, pas de décorations, pas de scan points/zones. Les calques
     * existants suivent nativement le déplacement Leaflet.
     */
    if (reason === 'gps-follow' && contained) {
        cancelObsoleteSiaMapMotionWork('gps-follow-contained');
        return;
    }

    if (contained) {
        /*
         * v16.70 — couverture, zoom et filtres inchangés : ZÉRO recalcul.
         * Les contours, bandes et libellés sont déjà des calques Leaflet et
         * suivent nativement le pan. Ne plus lancer la redécoration différée
         * qui pouvait reprendre 0,5–1,3 s après chaque déplacement contenu.
         */
        cancelObsoleteSiaMapMotionWork('moveend-contained-v16.70-zero-work');
        return;
    }

    /*
     * GPS hors couverture : recalcul uniquement parce que la couverture est
     * réellement devenue insuffisante. Aucun throttle artificiel de 12 s.
     */
    scheduleSiaLayerRefresh(reason);
}

function updateSiaProfileMapZonesToggleButton() {
    const hidden = !siaMapAirspacesVisible;
    const button = document.getElementById('sia-profile-map-zones-toggle');
    if (button) {
        button.textContent = hidden ? 'Afficher zones' : 'Masquer zones';
        button.classList.toggle('is-hidden', hidden);
        button.setAttribute('aria-pressed', hidden ? 'true' : 'false');
        button.title = hidden
            ? 'Réafficher sur la carte les zones toujours sélectionnées dans le filtre SIA'
            : 'Masquer les zones de la carte sans modifier les filtres';
    }

    /* v15.80 — même commande, accessible directement sur le bouton France. */
    const quickButton = document.getElementById('quick-sia-zones-toggle');
    if (quickButton) {
        quickButton.classList.toggle('is-hidden', hidden);
        quickButton.setAttribute('aria-pressed', hidden ? 'true' : 'false');
        quickButton.title = hidden
            ? 'Réafficher les zones SIA de la carte'
            : 'Masquer les zones SIA de la carte';
        quickButton.setAttribute(
            'aria-label',
            hidden ? 'Réafficher les zones SIA de la carte' : 'Masquer les zones SIA de la carte'
        );
    }
}

function setSiaMapAirspacesVisible(visible) {
    const next = visible !== false;
    saveSiaMapAirspacesVisiblePreference(next);
    if (siaMapAirspacesVisible === next) {
        updateSiaProfileMapZonesToggleButton();
        return;
    }
    siaMapAirspacesVisible = next;
    updateSiaProfileMapZonesToggleButton();

    if (next && !siaDataset && !siaDatasetLoadPromise) {
        npfDiagSiaInteraction(
            'SIA RAFRAÎCHISSEMENT',
            'raison=profile-show-map-zones · dataset complet demandé à la demande',
            { totalMs: 0 }
        );
    }

    // Les cases du filtre principal et celles du profil ne sont jamais modifiées ici.
    if (!next) {
        clearTimeout(siaMoveDecorationRefreshTimer);
        siaMoveDecorationRefreshTimer = null;
        siaDecorationProgressiveRun += 1;
        window.__npfSiaRefreshGeneration = (Number(window.__npfSiaRefreshGeneration) || 0) + 1;
        if (['gps-follow', 'moveend', 'move-preload'].includes(String(siaRefreshPendingReason || ''))) {
            siaRefreshPendingReason = null;
        }
    }
    scheduleSiaLayerRefresh(next ? 'profile-show-map-zones' : 'profile-hide-map-zones');
}

/*
 * v15.65 — les SIV sont publiés dans l'AIXM embarqué comme RAS avec le
 * sous-type local "FLIGHT INFORMATION SECTOR". NPF leur donne un filtre
 * virtuel propre sans modifier le payload SIA.
 */
function isSiaFlightInformationSector(item) {
    return String(item?.t || '').trim().toUpperCase() === 'RAS'
        && String(item?.l || '').trim().toUpperCase() === 'FLIGHT INFORMATION SECTOR';
}

/*
 * v15.74 — SIV : 19 objets génériques sans limites verticales sont des parents
 * techniques. Ils sont ignorés lorsqu'un enfant opérationnel utilisant leur code
 * comme préfixe existe. Cela laisse 110 secteurs SIV réellement opérationnels.
 */
let siaTechnicalSivParentCacheDataset = null;
let siaTechnicalSivParentCodeSet = null;

function hasSiaOperationalVerticalLimit(raw) {
    return Array.isArray(raw)
        && raw.length >= 3
        && String(raw?.[1] || '').trim() !== '';
}

function buildSiaTechnicalSivParentCodeSet(dataset = siaDataset) {
    if (siaTechnicalSivParentCodeSet && siaTechnicalSivParentCacheDataset === dataset) {
        return siaTechnicalSivParentCodeSet;
    }

    const sivs = (dataset?.airspaces || []).filter(isSiaFlightInformationSector);
    const result = new Set();

    sivs.forEach(item => {
        const code = String(item?.c || '').trim().toUpperCase();
        if (!code) return;
        if (hasSiaOperationalVerticalLimit(item?.lo) || hasSiaOperationalVerticalLimit(item?.up)) return;

        const hasOperationalChild = sivs.some(child => {
            const childCode = String(child?.c || '').trim().toUpperCase();
            return childCode
                && childCode !== code
                && childCode.startsWith(code)
                && (hasSiaOperationalVerticalLimit(child?.lo) || hasSiaOperationalVerticalLimit(child?.up));
        });

        if (hasOperationalChild) result.add(code);
    });

    siaTechnicalSivParentCacheDataset = dataset;
    siaTechnicalSivParentCodeSet = result;
    return result;
}

function isSiaTechnicalSivParent(item, dataset = siaDataset) {
    if (!isSiaFlightInformationSector(item)) return false;
    const code = String(item?.c || '').trim().toUpperCase();
    return !!code && buildSiaTechnicalSivParentCodeSet(dataset).has(code);
}

/*
 * v15.74 — fréquences FIS sectorielles lues dans XML_SIA
 * Espace -> Partie -> Volume -> Activite. Le payload v15.69 n'est pas réécrit :
 * l'association est appliquée uniquement au moment de construire le libellé carte.
 * 109 secteurs sur 110 disposent d'une fréquence explicite dans cette source.
 * SOCAFS / CAYENNE renvoie « Fréquences : voir ENR 6.4 » et n'est donc pas inventé.
 */
const SIA_SIV_VOLUME_FREQUENCIES = Object.freeze({
    "LFBDFS1": ["120.575"],
    "LFBDFS2": ["120.575"],
    "LFBHFS1": ["124.205"],
    "LFBHFS2": ["124.205"],
    "LFBIFS": ["124.000"],
    "LFBLFS": ["124.050"],
    "LFBOFS1": ["121.250"],
    "LFBPFS": ["126.525"],
    "LFBZFS": ["119.175", "126.525"],
    "LFFFFSN": ["125.700"],
    "LFFFFSO": ["129.625"],
    "LFFFFSS": ["126.100"],
    "LFKBFSNORD": ["124.725"],
    "LFKBFSSUD": ["135.135"],
    "LFKJFS": ["119.825"],
    "LFLBFS1": ["123.705"],
    "LFLBFS2": ["123.705"],
    "LFLCFS1": ["122.225"],
    "LFLCFS2": ["120.675"],
    "LFLCFS3": ["120.675"],
    "LFLCFS4": ["120.500"],
    "LFLCFS5": ["119.375"],
    "LFLCFS6": ["119.375"],
    "LFLCFS7": ["133.725"],
    "LFLLFS1": ["135.200"],
    "LFLLFS2": ["135.200"],
    "LFLLFS3": ["135.530"],
    "LFLLFS4": ["135.530"],
    "LFLLFS5": ["135.530"],
    "LFMLFS1": ["132.950"],
    "LFMLFS2": ["124.350"],
    "LFMLFS3": ["132.300"],
    "LFMLFS4": ["132.950"],
    "LFMLFS5": ["126.260"],
    "LFMLFS6": ["132.300"],
    "LFMMFSN1": ["124.500"],
    "LFMMFSN2": ["124.500"],
    "LFMMFSS": ["120.550"],
    "LFMNFS1": ["120.850"],
    "LFMNFS2": ["122.925"],
    "LFMNFS3": ["124.425"],
    "LFMTFS1": ["134.375"],
    "LFMTFS1P1": ["134.375"],
    "LFMTFS1P2": ["134.375"],
    "LFMTFS2": ["125.900"],
    "LFMTFS2P1": ["125.900"],
    "LFMTFS3": ["136.625"],
    "LFOBFS1": ["119.800"],
    "LFOBFS2": ["119.800"],
    "LFPBFS": ["123.835"],
    "LFPMFS1": ["134.300"],
    "LFPMFS2": ["134.300"],
    "LFPMFS3": ["134.300"],
    "LFPMFS4": ["120.330"],
    "LFPMFS5": ["120.330"],
    "LFPMFS6": ["127.815"],
    "LFPMFS7": ["127.815"],
    "LFPMFS8": ["127.815"],
    "LFPNFS1": ["119.305"],
    "LFPNFS2": ["119.305"],
    "LFPNFS3": ["119.305"],
    "LFQQFS1": ["126.480"],
    "LFQQFS2": ["132.540"],
    "LFQQFS3": ["129.360"],
    "LFQQFS4P1": ["132.610"],
    "LFQQFS4P2": ["132.610"],
    "LFQQFS5": ["129.360"],
    "LFQQFS6P1": ["134.825"],
    "LFQQFS6P2": ["134.825"],
    "LFQQFS6P3": ["134.825"],
    "LFQQFS6P4": ["134.825"],
    "LFRBFS1": ["135.830"],
    "LFRBFS2": ["119.575"],
    "LFRBFS3": ["122.400", "119.575"],
    "LFRBFS4P1": ["119.575"],
    "LFRBFS4P2": ["119.575"],
    "LFRNFSCTNA": ["134.200", "120.350"],
    "LFRNFSCTNB": ["134.200", "120.350"],
    "LFRNFSCTNC": ["134.200", "120.350"],
    "LFRNFSNORD": ["126.950"],
    "LFRNFSSUDA": ["134.000"],
    "LFRNFSSUDB": ["134.000"],
    "LFRSFS1": ["122.800"],
    "LFRSFS2P1": ["130.275"],
    "LFRSFS4": ["130.275"],
    "LFSBFS11": ["130.905"],
    "LFSBFS12": ["130.905"],
    "LFSBFS13": ["130.905"],
    "LFSBFS21": ["135.855"],
    "LFSBFS22": ["135.855"],
    "LFSBFS23": ["135.855"],
    "LFSBFS24": ["135.855"],
    "LFSBFS25": ["135.855"],
    "LFSTFS1": ["136.135", "119.580"],
    "LFSTFS2": ["136.135", "119.580"],
    "LFSTFS3": ["119.450"],
    "LFSTFS4": ["132.215", "119.450"],
    "LFSTFS4.20": ["119.450"],
    "LSAGFS01": ["126.350"],
    "LSAGFS02": ["126.350"],
    "LSAGFS03": ["126.350"],
    "LSAGFS04": ["126.350"],
    "LSAGFS05": ["126.350"],
    "LSAGFS06": ["126.350"],
    "LSAGFS07": ["126.350"],
    "LSAGFS08": ["126.350"],
    "LSAGFS09": ["126.350"],
    "NWWWFS": ["128.200", "128.300"],
    "TFFRFS": ["129.800"],
});

function getSiaVolumeAssignedFrequencies(item) {
    if (!isSiaFlightInformationSector(item)) return [];
    const code = String(item?.c || '').trim().toUpperCase();
    const values = SIA_SIV_VOLUME_FREQUENCIES[code];
    return Array.isArray(values) ? values : [];
}

function getSiaEffectiveFilterKey(item) {
    if (isSiaFlightInformationSector(item)) return 'ase:SIV';
    return String(item?.k || '').trim();
}

function migrateSiaSivFilterPreference() {
    const prefs = loadSiaFilterPrefs();
    if (prefs['ase:SIV'] !== undefined) return;

    /*
     * Avant v15.65, les SIV dépendaient du bouton RAS. On reprend son état
     * lors de la première ouverture afin de ne pas faire disparaître un calque
     * qui était déjà affiché.
     */
    if (prefs['ase:RAS'] !== undefined) {
        prefs['ase:SIV'] = prefs['ase:RAS'] === true;
        saveSiaFilterPrefs();
    }
}

function isSiaHideAboveFl115Enabled() {
    return loadSiaFilterPrefs()[SIA_HIDE_ABOVE_FL115_PREF_KEY] === true;
}

function setSiaHideAboveFl115Enabled(enabled) {
    loadSiaFilterPrefs()[SIA_HIDE_ABOVE_FL115_PREF_KEY] = !!enabled;
    saveSiaFilterPrefs();
}

function getSiaAirspaceLowerLimitFeetForFilter(item) {
    const raw = item?.lo;
    if (!Array.isArray(raw)) return null;

    const ref = String(raw?.[0] || '').trim().toUpperCase();
    const value = Number(raw?.[1]);
    const unit = String(raw?.[2] || '').trim().toUpperCase();
    if (!Number.isFinite(value)) return null;

    if (ref === 'STD' && unit === 'FL') return value * 100;
    if ((ref === 'ALT' || ref === 'HEI') && unit === 'FT') return value;
    return null;
}

function shouldHideSiaAirspaceAboveFl115(item) {
    if (!isSiaHideAboveFl115Enabled()) return false;
    const lowerFeet = getSiaAirspaceLowerLimitFeetForFilter(item);
    // Une limite non interprétable reste visible par sécurité.
    return Number.isFinite(lowerFeet) && lowerFeet >= SIA_HIDE_ABOVE_FL115_FEET;
}

function ensureSiaMapPanes() {
    if (!map || !map.createPane) return;

    if (!map.getPane('siaAirspacePane')) {
        map.createPane('siaAirspacePane');
        const pane = map.getPane('siaAirspacePane');
        if (pane) pane.style.zIndex = '440';
    }

    if (!map.getPane('siaCtrTouchPane')) {
        map.createPane('siaCtrTouchPane');
        const pane = map.getPane('siaCtrTouchPane');
        if (pane) pane.style.zIndex = '445';
    }

    if (!map.getPane('siaSelectionPane')) {
        map.createPane('siaSelectionPane');
        const pane = map.getPane('siaSelectionPane');
        if (pane) {
            pane.style.zIndex = '448';
            pane.style.pointerEvents = 'none';
        }
    }

    if (!map.getPane('siaPointPane')) {
        map.createPane('siaPointPane');
        const pane = map.getPane('siaPointPane');
        if (pane) pane.style.zIndex = '555';
    }

    if (!map.getPane('siaPointTouchPane')) {
        map.createPane('siaPointTouchPane');
        const pane = map.getPane('siaPointTouchPane');
        if (pane) {
            pane.style.zIndex = '660';
            pane.style.pointerEvents = 'auto';
        }
    }

    if (!map.getPane('npfTouchPane')) {
        map.createPane('npfTouchPane');
        const pane = map.getPane('npfTouchPane');
        if (pane) {
            pane.style.zIndex = '665';
            pane.style.pointerEvents = 'auto';
        }
    }

    // v15.50 — les hitboxes utilisent SVG plutôt qu'un DIV vide :
    // c'est beaucoup plus fiable pour le hit-testing tactile Safari/iPad.
    if (!siaPointTouchRenderer && L.svg) {
        siaPointTouchRenderer = L.svg({ padding: 0.35, pane: 'siaPointTouchPane' });
    }
    if (!npfTouchRenderer && L.svg) {
        npfTouchRenderer = L.svg({ padding: 0.35, pane: 'npfTouchPane' });
    }

    if (!siaAirspaceRenderer && L.canvas) {
        siaAirspaceRenderer = L.canvas({ padding: 0.35, pane: 'siaAirspacePane' });
    }
    if (!siaCtrTouchRenderer && L.svg) {
        siaCtrTouchRenderer = L.svg({ padding: 0.35, pane: 'siaCtrTouchPane' });
    }
    if (!siaSelectionRenderer && L.svg) {
        siaSelectionRenderer = L.svg({ padding: 0.35, pane: 'siaSelectionPane' });
    }
    if (!siaPointRenderer && L.canvas) {
        siaPointRenderer = L.canvas({ padding: 0.35, pane: 'siaPointPane' });
    }
}

function clearSiaRenderedLayers() {
    siaRenderedCoverageBounds = null;
    siaRenderedZoom = null;
    siaRenderedSignature = '';
    siaRenderedAirspaceFeatures = [];
    siaZoomDependentLayers = [];
    siaRenderedShowDesignatedPoints = null;
    siaRenderedPointLabelsEnabled = null;
    siaRenderedDiagnosticCounts = {
        zones: 0,
        terrains: 0,
        vrp: 0,
        otherPoints: 0,
        decorations: 0,
        touchEntries: 0
    };
    siaLastDecorationViewKey = '';
    clearSiaSelectionHighlight();
    siaSelectedCtrTouchLayer = null;
    siaSelectedCtrKey = null;
    siaSelectedAirspaceItem = null;
    siaSelectedAirspaceGeometry = null;
    siaAirspaceTouchEntries = [];
    if (siaLayerGroup) {
        try { siaLayerGroup.clearLayers(); } catch (_) {}
    }
}

function normalizeSiaFilterCounts(dataset) {
    const counts = new Map();
    const add = (key) => counts.set(key, (counts.get(key) || 0) + 1);
    (dataset?.terrain || []).forEach(item => add(item.k));
    (dataset?.points || []).forEach(item => add(item.k));
    (dataset?.airspaces || []).forEach(item => {
        if (isSiaTechnicalSivParent(item, dataset)) return;
        add(getSiaEffectiveFilterKey(item));
    });
    return counts;
}

function getSiaFilterSections(dataset) {
    migrateSiaSivFilterPreference();
    const counts = normalizeSiaFilterCounts(dataset);
    const count = (key) => counts.get(key) || 0;

    const orderedAseTypes = [
        'CTR', 'TMA', 'CTA', 'SIV', 'FIR', 'UIR', 'UIR-P', 'UTA', 'OCA',
        'SECTOR', 'SECTOR-C', 'RAS', 'TRA', 'P', 'R', 'D'
    ];
    const aseLabels = {
        CTR: 'CTR',
        TMA: 'TMA',
        CTA: 'CTA',
        SIV: 'SIV — Secteurs d’information de vol',
        FIR: 'FIR',
        UIR: 'UIR',
        'UIR-P': 'UIR-P',
        UTA: 'UTA',
        OCA: 'OCA',
        SECTOR: 'SECTOR',
        'SECTOR-C': 'SECTOR-C',
        RAS: 'RAS — Autres espaces réglementés',
        TRA: 'TRA — Zone temporairement réservée',
        P: 'Zones P',
        R: 'Zones R',
        D: 'Zones D'
    };

    const dOtherOrder = [
        'AER', 'VOL', 'SUR', 'PJE', 'PRN', 'TRVL', 'TRPLA',
        'AP', 'LTA', 'BAL', 'UAC', 'ACC', 'TRPVL'
    ];
    const dOtherLabels = {
        AER: 'AER — Aéromodélisme',
        VOL: 'VOL — Voltige',
        SUR: 'SUR — Restriction de survol',
        PJE: 'PJE — Parachutage',
        PRN: 'PRN — Parcs / réserves naturelles',
        TRVL: 'TRVL — Treuillage vol libre',
        TRPLA: 'TRPLA — Treuillage planeurs',
        AP: 'AP — Activité particulière / UAS',
        LTA: 'LTA — Lower Traffic Area',
        BAL: 'BAL — Ballons',
        UAC: 'UAC — Contrôle supérieur',
        ACC: 'ACC — Contrôle régional',
        TRPVL: 'TRPVL — Treuillage planeurs / vol libre'
    };

    const sections = [
        {
            title: 'Terrains',
            items: [
                { key: 'ahp:AD', label: 'Aérodromes AD', count: count('ahp:AD') },
                { key: 'ahp:HP', label: 'Hélistations HP', count: count('ahp:HP') },
                { key: 'ahp:LS', label: 'Landing sites LS', count: count('ahp:LS') }
            ]
        },
        {
            title: 'Points non-IFR',
            items: [
                { key: 'dpn:VRP', label: 'Points VFR / VRP', count: count('dpn:VRP') },
                { key: 'dpn:OTHER', label: 'Autres points OTHER', count: count('dpn:OTHER') },
                { key: 'dpn:ADHP', label: 'Points ADHP', count: count('dpn:ADHP') }
            ]
        },
        {
            title: 'Espaces aériens / zones',
            items: orderedAseTypes
                .map(type => ({
                    key: `ase:${type}`,
                    label: aseLabels[type] || type,
                    count: count(`ase:${type}`)
                }))
                .filter(item => item.count > 0)
        },
        {
            title: 'D-OTHER — sous-types SIA',
            items: dOtherOrder
                .map(type => ({
                    key: `ase:D-OTHER:${type}`,
                    label: dOtherLabels[type] || type,
                    count: count(`ase:D-OTHER:${type}`)
                }))
                .filter(item => item.count > 0)
        }
    ];

    return sections;
}

function ensureSiaFilterModal() {
    let modal = document.getElementById('sia-filter-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'sia-filter-modal';
    modal.className = 'sia-filter-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="sia-filter-card" role="dialog" aria-modal="true" aria-labelledby="sia-filter-title">
            <button type="button" class="sia-filter-close" id="sia-filter-close" aria-label="Fermer">&times;</button>
            <h2 id="sia-filter-title">CALQUES AÉRONAUTIQUES SIA</h2>
            <div class="sia-filter-subtitle">
                AIRAC <strong>${SIA_EMBEDDED_META.airac}</strong> — effet ${SIA_EMBEDDED_META.effectiveDate.split('-').reverse().join('/')}
                — points IFR ICAO exclus
            </div>
            <div class="sia-filter-global-actions">
                <button type="button" id="sia-filter-show-all">Tout afficher</button>
                <button type="button" id="sia-filter-hide-all">Tout masquer</button>
                <button type="button"
                        id="sia-profile-button"
                        aria-pressed="false"
                        title="Afficher ou masquer la coupe verticale des espaces devant l'avion">
                    PROFIL ESPACES
                </button>
                <label class="sia-filter-altitude-option"
                       title="Masquer les zones dont le plancher est au FL115 / 11 500 ft ou au-dessus">
                    <input type="checkbox" id="sia-filter-hide-above-fl115">
                    <span>Masquer zones &gt; FL115</span>
                </label>
            </div>
            <div id="sia-filter-sections" class="sia-filter-sections">
                <div class="sia-filter-loading">Chargement des données SIA…</div>
            </div>
            <div class="sia-filter-footer">
                <span id="sia-filter-footer-status">Les choix sont mémorisés sur cet appareil.</span>
                <button type="button" id="sia-filter-done">Fermer</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // v15.61 — le bouton PROFIL vit désormais dans ce menu dynamique.
    initializeSiaAirspaceProfileUi();

    const close = () => {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    };

    modal.querySelector('#sia-filter-close')?.addEventListener('click', close);
    modal.querySelector('#sia-filter-done')?.addEventListener('click', close);
    modal.addEventListener('click', event => {
        if (event.target === modal) close();
    });

    modal.querySelector('#sia-filter-show-all')?.addEventListener('click', () => {
        modal.querySelectorAll('input[data-sia-filter-key]').forEach(input => {
            input.checked = true;
            setSiaFilterEnabled(input.dataset.siaFilterKey, true);
        });
        scheduleSiaLayerRefresh('filters-all');
    });

    modal.querySelector('#sia-filter-hide-all')?.addEventListener('click', () => {
        modal.querySelectorAll('input[data-sia-filter-key]').forEach(input => {
            input.checked = false;
            setSiaFilterEnabled(input.dataset.siaFilterKey, false);
        });
        scheduleSiaLayerRefresh('filters-none');
    });

    const altitudeFilterInput = modal.querySelector('#sia-filter-hide-above-fl115');
    if (altitudeFilterInput) {
        altitudeFilterInput.checked = isSiaHideAboveFl115Enabled();
        altitudeFilterInput.addEventListener('change', () => {
            setSiaHideAboveFl115Enabled(altitudeFilterInput.checked);
            scheduleSiaLayerRefresh('altitude-filter-change');
            scheduleSiaProfileRefresh('altitude-filter-change');
        });
    }

    modal.querySelector('#sia-filter-sections')?.addEventListener('change', event => {
        const input = event.target?.closest?.('input[data-sia-filter-key]');
        if (!input) return;
        setSiaFilterEnabled(input.dataset.siaFilterKey, input.checked);
        scheduleSiaLayerRefresh('filter-change');
    });

    return modal;
}

function renderSiaFilterModal(dataset) {
    const modal = ensureSiaFilterModal();
    const container = modal.querySelector('#sia-filter-sections');
    if (!container) return;

    const sections = getSiaFilterSections(dataset);
    const prefs = loadSiaFilterPrefs();
    const altitudeFilterInput = modal.querySelector('#sia-filter-hide-above-fl115');
    if (altitudeFilterInput) altitudeFilterInput.checked = isSiaHideAboveFl115Enabled();

    container.innerHTML = sections.map(section => `
        <section class="sia-filter-section">
            <h3>${escapeHtml(section.title)}</h3>
            <div class="sia-filter-grid">
                ${section.items.map(item => `
                    <label class="sia-filter-item">
                        <input type="checkbox"
                               data-sia-filter-key="${escapeHtml(item.key)}"
                               ${prefs[item.key] === true ? 'checked' : ''}>
                        <span class="sia-filter-item-label">${escapeHtml(item.label)}</span>
                        <span class="sia-filter-item-count">${item.count}</span>
                    </label>
                `).join('')}
            </div>
        </section>
    `).join('');
}

async function openSiaFilterDialog() {
    const modal = ensureSiaFilterModal();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');

    const container = modal.querySelector('#sia-filter-sections');
    if (container) container.innerHTML = '<div class="sia-filter-loading">Chargement des données SIA…</div>';

    try {
        const dataset = await ensureSiaDatasetLoaded({
            full: true,
            reason: 'dialogue-filtres-sia'
        });
        renderSiaFilterModal(dataset);
        await refreshSiaManagementStatus();
        scheduleSiaLayerRefresh('filter-open');
    } catch (error) {
        console.error('[SIA] Ouverture filtres impossible:', error);
        if (container) {
            container.innerHTML = `<div class="sia-filter-error">Impossible de charger les données SIA : ${escapeHtml(error.message || String(error))}</div>`;
        }
    }
}

function installQuickOfflineMapButtonInteractions(button) {
    if (!button || button.dataset.siaLongPressBound === '1') return;
    button.dataset.siaLongPressBound = '1';

    try {
        button.setAttribute('draggable', 'false');
        button.querySelectorAll('*').forEach(child => child.setAttribute('draggable', 'false'));
    } catch (_) {}

    let longPressTimer = null;
    let longPressTriggered = false;

    const clearLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    const startLongPress = event => {
        if (event && event.button !== undefined && event.button !== 0) return;
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        clearLongPress();
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            openSiaFilterDialog();
        }, 650);
    };

    button.addEventListener('selectstart', event => event.preventDefault());
    button.addEventListener('dragstart', event => event.preventDefault());
    button.addEventListener('pointerdown', startLongPress);
    button.addEventListener('pointerup', clearLongPress);
    button.addEventListener('pointerleave', clearLongPress);
    button.addEventListener('pointercancel', clearLongPress);
    button.addEventListener('contextmenu', event => {
        event.preventDefault();
        clearLongPress();
        longPressTriggered = true;
        openSiaFilterDialog();
    });
    button.addEventListener('click', event => {
        if (longPressTriggered) {
            event.preventDefault();
            event.stopPropagation();
            longPressTriggered = false;
            return;
        }
        openQuickOfflineMapSelector();
    });
}

function siaCompactGeometryToGeoJson(compact) {
    if (!Array.isArray(compact) || compact.length < 2) return null;
    const typeMap = {
        P: 'Point',
        G: 'Polygon',
        M: 'MultiPolygon',
        L: 'LineString',
        N: 'MultiLineString'
    };
    const type = typeMap[compact[0]] || compact[0];
    return { type, coordinates: compact[1] };
}

function siaBoundsIntersects(featureBounds, leafletBounds) {
    if (!Array.isArray(featureBounds) || featureBounds.length !== 4 || !leafletBounds) return true;
    const minLon = featureBounds[0];
    const minLat = featureBounds[1];
    const maxLon = featureBounds[2];
    const maxLat = featureBounds[3];

    if (maxLat < leafletBounds.getSouth() || minLat > leafletBounds.getNorth()) return false;

    const west = leafletBounds.getWest();
    const east = leafletBounds.getEast();
    if (west <= east) {
        return !(maxLon < west || minLon > east);
    }
    return maxLon >= west || minLon <= east;
}

function formatSiaVertical(raw) {
    if (!Array.isArray(raw)) return '—';
    const ref = String(raw[0] || '');
    const value = String(raw[1] || '');
    const unit = String(raw[2] || '');
    if (!value) return '—';

    const numeric = Number(value);
    if (ref === 'HEI' && Number.isFinite(numeric) && numeric === 0) return 'SFC';
    if (ref === 'STD' && unit === 'FL') return `FL${value}`;
    if (unit === 'FT') return `${value} ft${ref === 'ALT' ? ' AMSL' : ref === 'HEI' ? ' AGL' : ''}`;
    if (unit) return `${value} ${unit}`;
    return value;
}

function isCurrentOfflineOaciMap() {
    if (mapSourceMode !== 'offline') return false;
    const activeGroup = String(getQuickOfflineActiveGroupName() || '').trim();
    if (/\bOACI\b/i.test(activeGroup)) return true;

    return (Array.isArray(activeOfflinePacks) ? activeOfflinePacks : []).some(pack => {
        const group = String(getOfflinePackGroupName(pack) || '');
        return /\bOACI\b/i.test(group) || /\bOACI\b/i.test(String(pack || ''));
    });
}

function getSiaAirspaceStyle(item) {
    const type = String(item?.t || '');
    const local = String(item?.l || '');

    let color = '#3559e0';
    let dashArray = null;
    let fillOpacity = 0;

    if (type === 'P') color = '#d50000';
    else if (type === 'R') color = '#ff6d00';
    else if (type === 'D') color = '#e91e63';
    else if (type === 'TRA') { color = '#ff6d00'; dashArray = '7 5'; }
    else if (type === 'CTR') color = '#0066ff';
    else if (type === 'TMA') color = '#673ab7';
    else if (type === 'CTA') color = '#3f51b5';
    else if (type === 'FIR' || type === 'UIR' || type === 'UIR-P' || type === 'UTA' || type === 'OCA') {
        color = '#455a64';
        dashArray = '9 6';
        fillOpacity = 0;
    } else if (type === 'SECTOR' || type === 'SECTOR-C' || type === 'RAS') {
        color = '#607d8b';
        dashArray = '6 5';
        fillOpacity = 0;
    } else if (type === 'D-OTHER') {
        color = '#8e24aa';
        dashArray = '5 4';
        if (local === 'PJE') color = '#d81b60';
        else if (local === 'AER') color = '#00897b';
        else if (local === 'VOL') color = '#3949ab';
        else if (local === 'SUR') color = '#6d4c41';
        else if (local === 'PRN') color = '#f4511e';
        else if (local === 'BAL') color = '#7b1fa2';
    }

    return {
        color,
        weight: 2.2,
        opacity: 0.95,
        fillColor: color,
        fillOpacity,
        dashArray,
        lineCap: 'round',
        lineJoin: 'round'
    };
}

function buildSiaAirspacePopup(item) {
    const typeLabel = item.t === 'D-OTHER' && item.l
        ? `${item.t} / ${item.l}`
        : item.t;
    const name = [item.c, item.n].filter(Boolean).join(' — ');
    const remark = String(item.r || '').trim();

    return `
        <div class="sia-popup">
            <div class="sia-popup-title">${escapeHtml(name || typeLabel || 'Espace SIA')}</div>
            <div><strong>Type :</strong> ${escapeHtml(typeLabel || '—')}</div>
            ${item.cl ? `<div><strong>Classe :</strong> ${escapeHtml(item.cl)}</div>` : ''}
            <div><strong>Plancher :</strong> ${escapeHtml(formatSiaVertical(item.lo))}</div>
            <div><strong>Plafond :</strong> ${escapeHtml(formatSiaVertical(item.up))}</div>
            ${item.a ? `<div><strong>Activité :</strong> ${escapeHtml(item.a)}</div>` : ''}
            ${remark ? `<div class="sia-popup-remark">${escapeHtml(remark).replace(/#|\n/g, '<br>')}</div>` : ''}
        </div>
    `;
}

function getSiaTerrainMarkerStyle(item) {
    if (item.t === 'HP') {
        return { radius: 5, color: '#0b6e4f', weight: 2, fillColor: '#48d597', fillOpacity: 0.95 };
    }
    if (item.t === 'LS') {
        return { radius: 4, color: '#37474f', weight: 2, fillColor: '#cfd8dc', fillOpacity: 0.95 };
    }
    return { radius: 5, color: '#0d47a1', weight: 2, fillColor: '#42a5f5', fillOpacity: 0.95 };
}

function buildSiaTerrainPopup(item) {
    const typeLabel = item.t === 'AD' ? 'Aérodrome' : item.t === 'HP' ? 'Hélistation' : 'Landing site';
    const elevation = item.e ? `${item.e} ${item.u || 'FT'}` : '—';
    return `
        <div class="sia-popup">
            <div class="sia-popup-title">${escapeHtml([item.c, item.n].filter(Boolean).join(' — '))}</div>
            <div><strong>Type :</strong> ${escapeHtml(typeLabel)}</div>
            <div><strong>Altitude :</strong> ${escapeHtml(elevation)}</div>
            ${item.city ? `<div><strong>Ville :</strong> ${escapeHtml(item.city)}</div>` : ''}
            <div><strong>Coordonnées :</strong> ${Number(item.x).toFixed(5)}, ${Number(item.y).toFixed(5)}</div>
            ${item.s ? `<div class="sia-popup-remark">${escapeHtml(item.s).replace(/#|\n/g, '<br>')}</div>` : ''}
        </div>
    `;
}

const SIA_VRP_AIRPORT_COLOR_PALETTE = Object.freeze([
    '#ff00ff', // magenta
    '#ffff00', // jaune
    '#00e5ff', // cyan
    '#39ff14', // vert fluorescent
    '#ff7a00', // orange
    '#ff1744', // rouge vif
    '#7c4dff', // violet électrique
    '#00ff95', // turquoise fluorescent
    '#2979ff'  // bleu électrique
]);
const SIA_VRP_AIRPORT_COLOR_OVERRIDES = Object.freeze({
    LFTW: '#ff00ff', // Nîmes-Garons
    LFMT: '#ffff00'  // Montpellier-Méditerranée
});
/*
 * v15.79 — « voisin » signifie ici terrain suffisamment proche pour que ses
 * VRP puissent être visibles dans la même zone opérationnelle. À 55 NM, le
 * dataset AIRAC 08/26 est coloriable avec la palette limitée de 9 couleurs,
 * sans conflit entre voisins (notamment LFTW / LFMI).
 */
const SIA_VRP_NEIGHBOUR_DISTANCE_NM = 55;
let siaVrpAirportColorMap = null;
let siaVrpAirportColorDataset = null;

/*
 * v15.90 — certains VRP SIA sont publiés sans AhpUidAssoc alors que leur
 * appartenance est évidente dans le groupe local. On ne modifie pas sia.js :
 * un rattachement de secours est calculé uniquement lorsque le voisinage est
 * suffisamment dominant. Les cas ambigus restent volontairement non rattachés.
 */
const SIA_VRP_INFERENCE_RADIUS_NM = 25;
const SIA_VRP_INFERENCE_MIN_SHARE = 0.52;
const SIA_VRP_INFERENCE_MIN_MARGIN = 0.18;
const SIA_VRP_INFERENCE_MIN_SUPPORT = 3;
const SIA_VRP_INFERENCE_MAX_NEAREST_NM = 10;
const SIA_VRP_INFERRED_AIRPORT_OVERRIDES = Object.freeze({
    MMND: 'LFMC',
    MMSR: 'LFML'
});
let siaVrpInferredAirportMap = null;
let siaVrpInferredAirportDataset = null;

/*
 * v16.76 — depuis v16.73 les points/VRP peuvent être rendus depuis
 * siaMapLiteDataset alors que siaDataset (5 066 espaces) reste volontairement
 * non chargé. Les couleurs par terrain doivent donc utiliser le dataset SIA
 * réellement disponible, et non uniquement siaDataset.
 */
function getSiaVrpVisualDataset() {
    return siaDataset || siaMapLiteDataset || null;
}

function getSiaVrpInferenceKey(item) {
    return [
        String(item?.c || '').trim().toUpperCase(),
        Number(item?.x).toFixed(6),
        Number(item?.y).toFixed(6)
    ].join('|');
}

function buildSiaVrpInferredAirportMap(dataset) {
    const inferred = new Map();
    if (!dataset) return inferred;

    const vrps = (dataset.points || []).filter(item => item?.k === 'dpn:VRP');
    const assigned = vrps.filter(item => String(item?.a || '').trim());
    const airportSet = new Set(
        assigned.map(item => String(item.a || '').trim().toUpperCase()).filter(Boolean)
    );

    for (const item of vrps) {
        if (String(item?.a || '').trim()) continue;

        const key = getSiaVrpInferenceKey(item);
        const codeId = String(item?.c || '').trim().toUpperCase();
        const forcedAirport = SIA_VRP_INFERRED_AIRPORT_OVERRIDES[codeId];
        if (forcedAirport && airportSet.has(forcedAirport)) {
            inferred.set(key, forcedAirport);
            continue;
        }

        const lat = Number(item?.x);
        const lon = Number(item?.y);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const stats = new Map();
        for (const candidate of assigned) {
            const candidateLat = Number(candidate?.x);
            const candidateLon = Number(candidate?.y);
            if (!Number.isFinite(candidateLat) || !Number.isFinite(candidateLon)) continue;

            const distance = calculateDistanceInNm(lat, lon, candidateLat, candidateLon);
            if (!Number.isFinite(distance) || distance > SIA_VRP_INFERENCE_RADIUS_NM) continue;

            const airport = String(candidate?.a || '').trim().toUpperCase();
            if (!airport) continue;

            const current = stats.get(airport) || { weight: 0, count: 0, nearest: Infinity };
            current.weight += 1 / Math.pow(Math.max(distance, 1), 1.5);
            current.count += 1;
            current.nearest = Math.min(current.nearest, distance);
            stats.set(airport, current);
        }

        if (!stats.size) continue;
        const ranked = Array.from(stats.entries()).sort((a, b) => b[1].weight - a[1].weight);
        const totalWeight = ranked.reduce((sum, entry) => sum + entry[1].weight, 0);
        if (!(totalWeight > 0)) continue;

        const [topAirport, topStats] = ranked[0];
        const secondWeight = ranked.length > 1 ? ranked[1][1].weight : 0;
        const topShare = topStats.weight / totalWeight;
        const secondShare = secondWeight / totalWeight;

        if (
            topStats.count >= SIA_VRP_INFERENCE_MIN_SUPPORT
            && topStats.nearest <= SIA_VRP_INFERENCE_MAX_NEAREST_NM
            && topShare >= SIA_VRP_INFERENCE_MIN_SHARE
            && (topShare - secondShare) >= SIA_VRP_INFERENCE_MIN_MARGIN
        ) {
            inferred.set(key, topAirport);
        }
    }

    return inferred;
}

function ensureSiaVrpInferredAirportMap(dataset = getSiaVrpVisualDataset()) {
    if (siaVrpInferredAirportMap && siaVrpInferredAirportDataset === dataset) {
        return siaVrpInferredAirportMap;
    }
    siaVrpInferredAirportDataset = dataset || null;
    siaVrpInferredAirportMap = buildSiaVrpInferredAirportMap(dataset);
    return siaVrpInferredAirportMap;
}

function getSiaVrpAirportCode(item, dataset = getSiaVrpVisualDataset()) {
    const officialAirport = String(item?.a || '').trim().toUpperCase();
    if (officialAirport) return officialAirport;
    if (item?.k !== 'dpn:VRP') return '';
    return ensureSiaVrpInferredAirportMap(dataset).get(getSiaVrpInferenceKey(item)) || '';
}

function getSiaVrpReadableTextColor(background) {
    const hex = String(background || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
    return luminance >= 150 ? '#000000' : '#ffffff';
}

function buildSiaVrpAirportColorMap(dataset) {
    const mapByAirport = new Map();
    if (!dataset) return mapByAirport;

    const airports = Array.from(new Set(
        (dataset.points || [])
            .filter(item => item?.k === 'dpn:VRP')
            .map(item => String(item?.a || '').trim().toUpperCase())
            .filter(Boolean)
    ));

    const airportSet = new Set(airports);
    const coordsByAirport = new Map();
    for (const terrain of dataset.terrain || []) {
        const code = String(terrain?.c || '').trim().toUpperCase();
        if (!airportSet.has(code) || coordsByAirport.has(code)) continue;
        const lat = Number(terrain?.x);
        const lon = Number(terrain?.y);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            coordsByAirport.set(code, { lat, lon });
        }
    }

    const neighbours = new Map(airports.map(code => [code, new Set()]));
    for (let i = 0; i < airports.length; i += 1) {
        const aCode = airports[i];
        const a = coordsByAirport.get(aCode);
        if (!a) continue;
        for (let j = i + 1; j < airports.length; j += 1) {
            const bCode = airports[j];
            const b = coordsByAirport.get(bCode);
            if (!b) continue;
            const distance = calculateDistanceInNm(a.lat, a.lon, b.lat, b.lon);
            if (Number.isFinite(distance) && distance <= SIA_VRP_NEIGHBOUR_DISTANCE_NM) {
                neighbours.get(aCode).add(bCode);
                neighbours.get(bCode).add(aCode);
            }
        }
    }

    const paletteIndexByColor = new Map(
        SIA_VRP_AIRPORT_COLOR_PALETTE.map((color, index) => [color.toLowerCase(), index])
    );
    const assignedIndex = new Map();
    const usage = new Array(SIA_VRP_AIRPORT_COLOR_PALETTE.length).fill(0);

    Object.entries(SIA_VRP_AIRPORT_COLOR_OVERRIDES).forEach(([code, color]) => {
        const index = paletteIndexByColor.get(String(color).toLowerCase());
        if (Number.isInteger(index) && airportSet.has(code)) {
            assignedIndex.set(code, index);
            usage[index] += 1;
        }
    });

    const stableSeed = code => Array.from(code).reduce(
        (sum, char) => ((sum * 33) + char.charCodeAt(0)) >>> 0,
        5381
    );

    /*
     * DSATUR : on traite d'abord le terrain dont les voisins déjà colorés
     * utilisent le plus de couleurs différentes. Contrairement à v15.78, une
     * couleur déjà utilisée par un voisin n'est PAS candidate tant qu'une
     * couleur libre existe.
     */
    while (assignedIndex.size < airports.length) {
        const unassigned = airports.filter(code => !assignedIndex.has(code));
        if (!unassigned.length) break;

        unassigned.sort((a, b) => {
            const saturationA = new Set(
                Array.from(neighbours.get(a) || [])
                    .map(code => assignedIndex.get(code))
                    .filter(Number.isInteger)
            ).size;
            const saturationB = new Set(
                Array.from(neighbours.get(b) || [])
                    .map(code => assignedIndex.get(code))
                    .filter(Number.isInteger)
            ).size;
            if (saturationA !== saturationB) return saturationB - saturationA;
            const degreeA = neighbours.get(a)?.size || 0;
            const degreeB = neighbours.get(b)?.size || 0;
            if (degreeA !== degreeB) return degreeB - degreeA;
            return a.localeCompare(b);
        });

        const code = unassigned[0];
        const usedByNeighbours = new Set(
            Array.from(neighbours.get(code) || [])
                .map(neighbourCode => assignedIndex.get(neighbourCode))
                .filter(Number.isInteger)
        );

        let candidates = SIA_VRP_AIRPORT_COLOR_PALETTE
            .map((_color, index) => index)
            .filter(index => !usedByNeighbours.has(index));

        /*
         * Garde-fou pour un futur AIRAC plus dense : sur le dataset actuel ce
         * repli n'est jamais utilisé. S'il devenait nécessaire, on minimise
         * alors le nombre de conflits au lieu d'échouer complètement.
         */
        if (!candidates.length) {
            let minimumConflicts = Infinity;
            candidates = [];
            SIA_VRP_AIRPORT_COLOR_PALETTE.forEach((_color, index) => {
                const conflicts = Array.from(neighbours.get(code) || [])
                    .reduce((count, neighbourCode) => (
                        count + (assignedIndex.get(neighbourCode) === index ? 1 : 0)
                    ), 0);
                if (conflicts < minimumConflicts) {
                    minimumConflicts = conflicts;
                    candidates = [index];
                } else if (conflicts === minimumConflicts) {
                    candidates.push(index);
                }
            });
        }

        const seed = stableSeed(code) % SIA_VRP_AIRPORT_COLOR_PALETTE.length;
        candidates.sort((a, b) => (
            usage[a] - usage[b]
            || ((a - seed + SIA_VRP_AIRPORT_COLOR_PALETTE.length) % SIA_VRP_AIRPORT_COLOR_PALETTE.length)
                - ((b - seed + SIA_VRP_AIRPORT_COLOR_PALETTE.length) % SIA_VRP_AIRPORT_COLOR_PALETTE.length)
        ));

        const chosenIndex = candidates[0] ?? 0;
        assignedIndex.set(code, chosenIndex);
        usage[chosenIndex] += 1;
    }

    airports.forEach(code => {
        const forced = SIA_VRP_AIRPORT_COLOR_OVERRIDES[code];
        const index = assignedIndex.get(code);
        const background = forced
            || SIA_VRP_AIRPORT_COLOR_PALETTE[Number.isInteger(index) ? index : 0];
        mapByAirport.set(code, {
            background,
            foreground: getSiaVrpReadableTextColor(background)
        });
    });

    return mapByAirport;
}

function ensureSiaVrpAirportColorMap(dataset = getSiaVrpVisualDataset()) {
    if (siaVrpAirportColorMap && siaVrpAirportColorDataset === dataset) return siaVrpAirportColorMap;
    siaVrpAirportColorDataset = dataset || null;
    siaVrpAirportColorMap = buildSiaVrpAirportColorMap(dataset);
    return siaVrpAirportColorMap;
}

function getSiaVrpAirportVisual(item, dataset = getSiaVrpVisualDataset()) {
    const airport = getSiaVrpAirportCode(item, dataset);
    if (!airport) {
        return { background: '#ff00ff', foreground: '#ffffff' };
    }
    const mapByAirport = ensureSiaVrpAirportColorMap(dataset);
    return mapByAirport.get(airport) || { background: '#ff00ff', foreground: '#ffffff' };
}

function getSiaPointMarkerStyle(item) {
    if (item.k === 'dpn:VRP') {
        const visual = getSiaVrpAirportVisual(item);
        return { radius: 4.5, color: '#111111', weight: 1.5, fillColor: visual.background, fillOpacity: 1 };
    }
    if (item.k === 'dpn:ADHP') {
        return { radius: 3.5, color: '#263238', weight: 1.5, fillColor: '#90a4ae', fillOpacity: 0.9 };
    }
    return { radius: 4, color: '#4a148c', weight: 1.5, fillColor: '#e040fb', fillOpacity: 0.95 };
}

function buildSiaPointPopup(item) {
    /*
     * v15.49 — VRP : titre compact (ex. AS-LFMA), sans répétition des
     * informations déjà présentes dans le titre et sans coordonnées.
     */
    if (item.k === 'dpn:VRP') {
        const code = String(item.d || getSiaVrpSymbolText(item) || item.c || '').trim();
        const airport = getSiaVrpAirportCode(item);
        const title = airport ? `${code}-${airport}` : code;
        const remark = String(item.r || '').trim().replace(/^VRP\s*[-:]?\s*/i, '');

        const encodedWpName = encodeURIComponent(title || code || 'Point VFR');
        const wpLat = Number(item.x);
        const wpLon = Number(item.y);
        const existingWp = getNpfWaypointForVfr(title || code || 'Point VFR', wpLat, wpLon);
        const waypointActions = existingWp
            ? `<div class="npf-waypoint-popup-actions npf-source-waypoint-actions sia-vrp-existing-wp-actions">${buildNpfWaypointActionsHtml(existingWp)}</div>`
            : `<div class="sia-vrp-popup-actions"><button type="button" class="sia-vrp-add-wp-btn" onclick="window.addNpfWaypointFromVfr('${encodedWpName}', ${wpLat}, ${wpLon})">Ajout WP</button></div>`;
        return `
            <div class="sia-popup sia-vrp-popup">
                <div class="sia-popup-title">${escapeHtml(title || 'Point VFR')}</div>
                ${remark ? `<div class="sia-popup-remark">${escapeHtml(remark).replace(/#|\n/g, '<br>')}</div>` : ''}
                ${waypointActions}
            </div>
        `;
    }

    const title = [item.d || item.c, item.a].filter(Boolean).join(' — ');
    const remark = String(item.r || '').trim();
    return `
        <div class="sia-popup">
            <div class="sia-popup-title">${escapeHtml(title || item.c || 'Point SIA')}</div>
            ${item.n && item.n !== item.d ? `<div><strong>Nom SIA :</strong> ${escapeHtml(item.n)}</div>` : ''}
            ${item.a ? `<div><strong>Aérodrome associé :</strong> ${escapeHtml(item.a)}</div>` : ''}
            <div><strong>Coordonnées :</strong> ${Number(item.x).toFixed(5)}, ${Number(item.y).toFixed(5)}</div>
            ${remark ? `<div class="sia-popup-remark">${escapeHtml(remark).replace(/#|\n/g, '<br>')}</div>` : ''}
        </div>
    `;
}

function getVisibleBaseTileLoadStateForSia() {
    if (!map || !baseTileLayer) return { total: 0, loaded: 0, tileZoomReady: true };

    try {
        const layerContainer = baseTileLayer.getContainer?.();
        const mapContainer = map.getContainer?.();
        if (!layerContainer || !mapContainer) {
            return { total: 0, loaded: countVisibleLoadedBaseTiles(), tileZoomReady: true };
        }

        const mapRect = mapContainer.getBoundingClientRect();
        const tiles = layerContainer.querySelectorAll('img.leaflet-tile');
        let total = 0;
        let loaded = 0;

        tiles.forEach(tile => {
            if (!tile || tile.style.display === 'none') return;
            const rect = tile.getBoundingClientRect();
            if (
                rect.width <= 1
                || rect.height <= 1
                || rect.right <= mapRect.left
                || rect.left >= mapRect.right
                || rect.bottom <= mapRect.top
                || rect.top >= mapRect.bottom
            ) {
                return;
            }

            total += 1;
            if (
                tile.classList.contains('leaflet-tile-loaded')
                || (tile.complete && Number(tile.naturalWidth) > 0)
            ) {
                loaded += 1;
            }
        });

        const layerZoom = Number(baseTileLayer._tileZoom);
        const mapZoom = Number(map.getZoom?.());
        const tileZoomReady = !Number.isFinite(layerZoom)
            || !Number.isFinite(mapZoom)
            || Math.abs(layerZoom - mapZoom) < 0.001;

        return { total, loaded, tileZoomReady };
    } catch (_) {
        return { total: 0, loaded: countVisibleLoadedBaseTiles(), tileZoomReady: true };
    }
}

function shouldSiaWaitForBaseMap(reason) {
    return reason === 'moveend'
        || reason === 'zoomend'
        || reason === 'startup-prefs'
        || reason === 'profile-show-map-zones'
        || reason === 'filters-all'
        || reason === 'filter-change'
        || reason === 'altitude-filter-change'
        || reason === 'filter-open'
        || reason === 'management-check';
}

async function waitForBaseMapBeforeSiaRefresh(reason, refreshGeneration) {
    if (!shouldSiaWaitForBaseMap(reason) || !map || !baseTileLayer) return;

    const isFilterActivation = reason === 'profile-show-map-zones'
        || reason === 'filters-all'
        || reason === 'filter-change'
        || reason === 'altitude-filter-change'
        || reason === 'filter-open'
        || reason === 'management-check';

    if (isFilterActivation) {
        const ready = await waitForNpfLayerActivationTileWindow(`SIA:${reason}`, {
            maxWaitMs: 12000,
            isCancelled: () => {
                try {
                    throwIfSiaRefreshObsolete(refreshGeneration);
                    return false;
                } catch (_) {
                    return true;
                }
            }
        });
        throwIfSiaRefreshObsolete(refreshGeneration);
        if (!ready) {
            const error = new Error('Priorité tuiles SIA');
            error.name = SIA_REFRESH_ABORT_ERROR_NAME;
            throw error;
        }
        return;
    }

    const directNpfOffline = !!(
        offlineTilesMode
        && typeof isNpfOfflinePackSelection === 'function'
        && isNpfOfflinePackSelection()
    );
    const maxWaitMs = directNpfOffline ? 6500 : 1000;
    const pollMs = directNpfOffline ? 90 : 70;
    const startedAt = NPF_STARTUP_DIAGNOSTIC.now();
    let stablePasses = 0;

    while (true) {
        throwIfSiaRefreshObsolete(refreshGeneration);

        const state = getVisibleBaseTileLoadStateForSia();
        const readsIdle = !directNpfOffline || (
            Number(directOfflineNpfActiveReads || 0) === 0
            && Number(directOfflineNpfReadQueue?.length || 0) === 0
        );
        const allVisibleTilesReady = state.total > 0
            && state.loaded >= state.total
            && state.tileZoomReady
            && readsIdle;

        if (allVisibleTilesReady) {
            stablePasses += 1;
            if (stablePasses >= 2) {
                await yieldSiaRefreshToMap(refreshGeneration);
                return;
            }
        } else {
            stablePasses = 0;
        }

        if (NPF_STARTUP_DIAGNOSTIC.now() - startedAt >= maxWaitMs) {
            await yieldSiaRefreshToMap(refreshGeneration);
            return;
        }

        await new Promise(resolve => setTimeout(resolve, pollMs));
    }
}

function scheduleSiaLayerRefresh(reason = 'unspecified') {
    clearTimeout(siaRefreshTimer);
    siaRefreshScheduledReason = String(reason || 'unspecified');

    /*
     * v15.83 — après un geste carte, le SIA ne repart plus sur un chronomètre
     * arbitraire. Il attend l'état visuel réel des tuiles de fond.
     */
    const delay = shouldSiaWaitForBaseMap(reason) ? 40 : 120;
    const scheduledGeneration = getSiaRefreshGeneration();

    siaRefreshTimer = setTimeout(async () => {
        siaRefreshTimer = null;
        siaRefreshScheduledReason = null;
        try {
            await waitForBaseMapBeforeSiaRefresh(reason, scheduledGeneration);
            throwIfSiaRefreshObsolete(scheduledGeneration);
            await refreshSiaLayers(reason);
        } catch (error) {
            if (error?.name === SIA_REFRESH_ABORT_ERROR_NAME) return;
            console.warn('[SIA] Rafraîchissement impossible:', reason, error);
        }
    }, delay);
}

async function refreshSiaLayers(reason = 'manual') {
    if (!map) return;
    ensureSiaMapPanes();

    if (!hasAnyEnabledSiaFilter()) {
        clearSiaRenderedLayers();
        return;
    }

    const dataset = await ensureSiaDatasetLoaded({
        full: true,
        reason: 'ancien-refresh-zones-sia'
    });
    if (!siaLayerGroup) {
        siaLayerGroup = L.layerGroup().addTo(map);
    }
    siaLayerGroup.clearLayers();

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    let rendered = 0;

    const visibleAirspaceFeatures = [];
    for (const item of dataset.airspaces || []) {
        if (!isSiaFilterEnabled(getSiaEffectiveFilterKey(item))) continue;
        if (shouldHideSiaAirspaceAboveFl115(item)) continue;

        // v15.57 — les parents techniques TMA issus d'un Adg/UNION ne sont ni
        // dessinés ni proposés à la sélection. Les vrais secteurs restent.
        if (isSiaTechnicalTmaUnionParent(item)) continue;
        if (isSiaTechnicalSivParent(item, dataset)) continue;

        if (!item.g) continue;
        if (!siaBoundsIntersects(item.b, bounds)) continue;

        const geometry = siaCompactGeometryToGeoJson(item.g);
        if (!geometry) continue;

        visibleAirspaceFeatures.push({
            type: 'Feature',
            properties: { siaItem: item },
            geometry
        });
    }

    if (visibleAirspaceFeatures.length) {
        const airspaceLayer = L.geoJSON(
            { type: 'FeatureCollection', features: visibleAirspaceFeatures },
            {
                pane: 'siaAirspacePane',
                renderer: siaAirspaceRenderer,
                style: feature => getSiaAirspaceStyle(feature.properties.siaItem),
                pointToLayer: (feature, latlng) => {
                    const style = getSiaAirspaceStyle(feature.properties.siaItem);
                    return L.circleMarker(latlng, {
                        pane: 'siaAirspacePane',
                        renderer: siaAirspaceRenderer,
                        radius: 5,
                        color: style.color,
                        weight: 2,
                        fillColor: style.color,
                        fillOpacity: 0.85
                    });
                },
                onEachFeature: (feature, layer) => {
                    layer.bindPopup(
                        buildSiaAirspacePopup(feature.properties.siaItem),
                        { maxWidth: 340 }
                    );
                }
            }
        );
        airspaceLayer.addTo(siaLayerGroup);
        rendered += visibleAirspaceFeatures.length;
    }

    const pointBounds = bounds.pad(0.04);

    for (const item of dataset.terrain || []) {
        if (!isSiaFilterEnabled(getSiaEffectiveFilterKey(item))) continue;
        const latlng = L.latLng(Number(item.x), Number(item.y));
        if (!pointBounds.contains(latlng)) continue;

        const marker = L.circleMarker(latlng, {
            ...getSiaTerrainMarkerStyle(item),
            pane: 'siaPointPane',
            renderer: siaPointRenderer
        });
        marker.bindPopup(buildSiaTerrainPopup(item), { maxWidth: 320 });
        if (zoom >= 8 && item.c) {
            marker.bindTooltip(escapeHtml(item.c), {
                permanent: true,
                direction: 'right',
                offset: [5, 0],
                className: 'sia-point-label sia-terrain-label'
            });
        }
        marker.addTo(siaLayerGroup);
        rendered += 1;
    }

    for (const item of dataset.points || []) {
        if (!isSiaFilterEnabled(getSiaEffectiveFilterKey(item))) continue;
        if (item.k === 'dpn:VRP' && !siaMapVrpVisible) continue;
        const latlng = L.latLng(Number(item.x), Number(item.y));
        if (!pointBounds.contains(latlng)) continue;

        const marker = L.circleMarker(latlng, {
            ...getSiaPointMarkerStyle(item),
            pane: 'siaPointPane',
            renderer: siaPointRenderer
        });
        marker.bindPopup(buildSiaPointPopup(item), { maxWidth: 320 });
        if (item.k === 'dpn:VRP') {
            marker.on('popupopen', () => marker.setPopupContent(buildSiaPointPopup(item)));
        }

        const label = item.k === 'dpn:VRP'
            ? String(item.d || '').trim()
            : String(item.d || item.c || '').trim();
        if (zoom >= 8 && label && item.k !== 'dpn:ADHP') {
            marker.bindTooltip(escapeHtml(label), {
                permanent: true,
                direction: 'right',
                offset: [5, 0],
                className: `sia-point-label ${item.k === 'dpn:VRP' ? 'sia-vrp-label' : ''}`
            });
        }
        marker.addTo(siaLayerGroup);
        rendered += 1;
    }

    const footer = document.getElementById('sia-filter-footer-status');
    if (footer) {
        footer.textContent = `${rendered} objet${rendered > 1 ? 's' : ''} SIA affiché${rendered > 1 ? 's' : ''} dans la zone visible.`;
    }
}

async function refreshSiaManagementStatus() {
    const status = document.getElementById('sia-installed-status');
    const deleteButton = document.getElementById('sia-delete-data-button');
    if (!status) return;

    try {
        const meta = await siaDbGet(SIA_META_KEY);
        if (siaMetaMatchesEmbedded(meta)) {
            status.textContent = `✓ À jour — AIRAC ${meta.airac} v${meta.datasetVersion}`;
            status.classList.add('is-ready');
            if (deleteButton) deleteButton.style.display = '';
        } else {
            status.textContent = `Non initialisé — AIRAC intégré ${SIA_EMBEDDED_META.airac} v${SIA_EMBEDDED_META.datasetVersion}`;
            status.classList.remove('is-ready');
            if (deleteButton) deleteButton.style.display = 'none';
        }
    } catch (error) {
        status.textContent = 'Stockage SIA indisponible';
        status.classList.remove('is-ready');
        if (deleteButton) deleteButton.style.display = 'none';
    }
}

function bindSiaManagementButtons() {
    const checkButton = document.getElementById('sia-check-update-button');
    const deleteButton = document.getElementById('sia-delete-data-button');

    if (checkButton && checkButton.dataset.bound !== '1') {
        checkButton.dataset.bound = '1';
        checkButton.addEventListener('click', async () => {
            const oldText = checkButton.textContent;
            checkButton.disabled = true;
            checkButton.textContent = 'Vérification…';
            try {
                const meta = await siaDbGet(SIA_META_KEY).catch(() => null);
                if (siaMetaMatchesEmbedded(meta)) {
                    await ensureSiaDatasetLoaded({
                        full: true,
                        reason: 'gestion-sia-verification'
                    });
                    alert(`Données SIA à jour : AIRAC ${SIA_EMBEDDED_META.airac} v${SIA_EMBEDDED_META.datasetVersion}.`);
                } else {
                    await ensureSiaDatasetLoaded({
                        forceEmbedded: true,
                        full: true,
                        reason: 'gestion-sia-reinitialisation'
                    });
                    alert(`Données SIA initialisées : AIRAC ${SIA_EMBEDDED_META.airac} v${SIA_EMBEDDED_META.datasetVersion}.`);
                }
                scheduleSiaLayerRefresh('management-check');
            } catch (error) {
                console.error('[SIA] Initialisation impossible:', error);
                alert(`Initialisation SIA impossible : ${error.message || error}`);
            } finally {
                checkButton.disabled = false;
                checkButton.textContent = oldText;
                refreshSiaManagementStatus();
            }
        });
    }

    if (deleteButton && deleteButton.dataset.bound !== '1') {
        deleteButton.dataset.bound = '1';
        deleteButton.addEventListener('click', async () => {
            if (!confirm('Supprimer les données aéronautiques SIA stockées sur cet appareil ? Les autres données NPF ne seront pas touchées.')) {
                return;
            }
            try {
                await siaDbDelete(SIA_DATASET_KEY);
                await siaDbDelete(SIA_META_KEY);
                siaDataset = null;
                siaDatasetLoadPromise = null;
                clearSiaRenderedLayers();
                await refreshSiaManagementStatus();
            } catch (error) {
                console.error('[SIA] Suppression impossible:', error);
                alert(`Suppression SIA impossible : ${error.message || error}`);
            }
        });
    }
}

function siaProfileVerticalToFeet(raw) {
    if (!Array.isArray(raw)) return null;

    const ref = String(raw?.[0] || '').toUpperCase();
    const value = Number(raw?.[1]);
    const unit = String(raw?.[2] || '').toUpperCase();

    if (!Number.isFinite(value)) return null;
    if (ref === 'STD' && unit === 'FL') return value * 100;
    if ((ref === 'ALT' || ref === 'HEI') && unit === 'FT') return value;
    return null;
}

function getSiaProfileCurrentPosition() {
    if (!lastPosition) return null;

    const lat = Number(lastPosition.latitude ?? lastPosition.lat);
    const lng = Number(lastPosition.longitude ?? lastPosition.lng);
    let heading = Number(lastPosition.heading);
    const altitudeFt = Number(lastPosition.altitudeFt ?? lastPosition.altitudeFeet);

    if (!Number.isFinite(heading) && isSimulationMode) {
        heading = getSimulationTrueRouteDeg();
    }

    if (![lat, lng, heading].every(Number.isFinite)) return null;

    const speedKtDirect = Number(lastPosition.speedKt);
    const speedMps = Number(lastPosition.speedMps);
    const speedKt = Number.isFinite(speedKtDirect)
        ? speedKtDirect
        : (Number.isFinite(speedMps) ? speedMps * 1.9438444924406 : null);

    return {
        lat,
        lng,
        heading: ((heading % 360) + 360) % 360,
        altitudeFt: Number.isFinite(altitudeFt) ? altitudeFt : null,
        speedKt: Number.isFinite(speedKt) ? Math.max(0, speedKt) : null
    };
}

function scheduleSiaProfileRefresh(reason = 'unspecified') {
    if (!siaProfileOpen) return;
    clearTimeout(siaProfileRefreshTimer);
    siaProfileRefreshTimer = setTimeout(() => {
        renderSiaAirspaceProfile(reason).catch(error => {
            console.warn('[SIA profil] Rendu impossible:', error);
        });
    }, 120);
}


/*
 * v15.69 — mouvement du profil :
 * les volumes déjà présents sont déplacés avec le même delta que l'avion
 * entre deux rafraîchissements lorsque la route reste stable. On évite ainsi
 * que l'échantillonnage 0,25 NM fasse varier séparément les deux bords d'une
 * zone et produise un effet « accordéon ».
 */
let siaProfilePreviousMotionPosition = null;
let siaProfilePreviousIntervals = new Map();

function normalizeSiaProfileHeadingDelta(a, b) {
    let delta = ((Number(a) || 0) - (Number(b) || 0)) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return Math.abs(delta);
}

function getSiaProfileForwardMovementNm(position) {
    const previous = siaProfilePreviousMotionPosition;
    const current = {
        lat: Number(position?.lat),
        lng: Number(position?.lng),
        heading: Number(position?.heading)
    };
    siaProfilePreviousMotionPosition = current;

    if (!previous || ![current.lat, current.lng, current.heading, previous.lat, previous.lng, previous.heading].every(Number.isFinite)) {
        return 0;
    }

    const distanceNm = calculateDistanceInNm(previous.lat, previous.lng, current.lat, current.lng);
    if (!Number.isFinite(distanceNm) || distanceNm <= 0 || distanceNm > 2) return 0;
    if (normalizeSiaProfileHeadingDelta(previous.heading, current.heading) > 5) return 0;

    const movementBearing = calculateBearing(previous.lat, previous.lng, current.lat, current.lng);
    if (!Number.isFinite(movementBearing)) return 0;
    const courseDelta = normalizeSiaProfileHeadingDelta(movementBearing, current.heading);
    if (courseDelta > 35) return 0;

    const alongTrackNm = distanceNm * Math.cos(courseDelta * Math.PI / 180);
    return Number.isFinite(alongTrackNm) && alongTrackNm > 0 ? alongTrackNm : 0;
}

function getSiaProfileVolumeMotionKey(item, intervalIndex) {
    return `${getSiaCtrSelectionKey(item)}|${Number(intervalIndex) || 0}`;
}

function stabilizeSiaProfileVolumeIntervals(volumes, forwardMovementNm) {
    const next = new Map();
    const toleranceNm = 0.75;

    volumes.forEach(volume => {
        const key = String(volume.profileKey || '');
        const previous = key ? siaProfilePreviousIntervals.get(key) : null;

        if (previous && Number.isFinite(forwardMovementNm) && forwardMovementNm > 0) {
            const predictedStart = Math.max(0, Number(previous.startNm) - forwardMovementNm);
            const predictedEnd = Math.max(0, Number(previous.endNm) - forwardMovementNm);

            if (
                predictedEnd > predictedStart
                && Math.abs(Number(volume.startNm) - predictedStart) <= toleranceNm
                && Math.abs(Number(volume.endNm) - predictedEnd) <= toleranceNm
            ) {
                volume.startNm = predictedStart;
                volume.endNm = Math.min(siaProfileDistanceNm, predictedEnd);
            }
        }

        if (key) {
            next.set(key, {
                startNm: Number(volume.startNm),
                endNm: Number(volume.endNm)
            });
        }
    });

    siaProfilePreviousIntervals = next;
    return volumes;
}

function buildSiaProfileSamples(position, distanceNm) {
    const stepNm = distanceNm <= 25 ? 0.25 : distanceNm <= 50 ? 0.4 : 0.5;
    const samples = [];

    for (let d = 0; d <= distanceNm + 1e-6; d += stepNm) {
        const dest = calculateDestinationLatLng(
            position.lat,
            position.lng,
            position.heading,
            d * 1852
        );
        samples.push({
            distanceNm: Math.min(distanceNm, d),
            latlng: L.latLng(Number(dest[0]), Number(dest[1]))
        });
    }

    if (!samples.length || samples[samples.length - 1].distanceNm < distanceNm - 0.01) {
        const dest = calculateDestinationLatLng(
            position.lat,
            position.lng,
            position.heading,
            distanceNm * 1852
        );
        samples.push({
            distanceNm,
            latlng: L.latLng(Number(dest[0]), Number(dest[1]))
        });
    }

    return { samples, stepNm };
}

function getSiaProfileRouteBounds(samples) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;

    samples.forEach(sample => {
        minLat = Math.min(minLat, sample.latlng.lat);
        maxLat = Math.max(maxLat, sample.latlng.lat);
        minLng = Math.min(minLng, sample.latlng.lng);
        maxLng = Math.max(maxLng, sample.latlng.lng);
    });

    return { minLat, maxLat, minLng, maxLng };
}

function siaProfileItemCouldMeetRoute(item, routeBounds) {
    if (!Array.isArray(item?.b) || item.b.length < 4) return true;

    const minLon = Number(item.b[0]);
    const minLat = Number(item.b[1]);
    const maxLon = Number(item.b[2]);
    const maxLat = Number(item.b[3]);
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return true;

    const pad = 0.08;
    return !(
        maxLat < routeBounds.minLat - pad
        || minLat > routeBounds.maxLat + pad
        || maxLon < routeBounds.minLng - pad
        || minLon > routeBounds.maxLng + pad
    );
}

function buildSiaProfileIntervals(item, geometry, samples, stepNm) {
    const intervals = [];
    let runStart = null;

    for (let i = 0; i < samples.length; i += 1) {
        const inside = siaGeometryContainsLatLng(geometry, samples[i].latlng);

        if (inside && runStart === null) {
            runStart = i;
        }

        const isLast = i === samples.length - 1;
        if (runStart !== null && (!inside || isLast)) {
            const lastInsideIndex = inside && isLast ? i : i - 1;
            const startNm = Math.max(0, samples[runStart].distanceNm - stepNm / 2);
            const endNm = Math.min(
                siaProfileDistanceNm,
                samples[lastInsideIndex].distanceNm + stepNm / 2
            );

            if (endNm > startNm + 0.05) {
                intervals.push({ startNm, endNm });
            }
            runStart = null;
        }
    }

    return intervals;
}

function getSiaProfileFilterLabel(key) {
    const labels = {
        'ase:CTR': 'CTR',
        'ase:TMA': 'TMA',
        'ase:CTA': 'CTA',
        'ase:FIR': 'FIR',
        'ase:UIR': 'UIR',
        'ase:UIR-P': 'UIR-P',
        'ase:UTA': 'UTA',
        'ase:OCA': 'OCA',
        'ase:SECTOR': 'SECTOR',
        'ase:SECTOR-C': 'SECTOR-C',
        'ase:RAS': 'RAS',
        'ase:TRA': 'TRA',
        'ase:P': 'P',
        'ase:R': 'R',
        'ase:D': 'D'
    };
    if (labels[key]) return labels[key];
    if (String(key || '').startsWith('ase:D-OTHER:')) {
        return String(key).slice('ase:D-OTHER:'.length);
    }
    return String(key || '').replace(/^ase:/, '') || 'Zone';
}

function getSiaProfileAvailableFilterKeys(dataset) {
    const operationalFamilies = buildSiaTmaOperationalFamilySet(dataset);
    const keys = new Set();

    (dataset?.airspaces || []).forEach(item => {
        const key = getSiaEffectiveFilterKey(item);
        if (!key || !isSiaFilterEnabled(key)) return;
        if (isSiaFlightInformationSector(item)) return; // SIV reste hors profil.
        if (isSiaTechnicalTmaUnionParent(item)) return;
        if (isSiaGenericTmaWithoutAltitude(item, operationalFamilies)) return;
        if (!item.g) return;
        const geometryType = String(item.g?.[0] || '');
        if (geometryType !== 'G' && geometryType !== 'M') return;
        keys.add(key);
    });

    const priority = [
        'ase:CTR', 'ase:R', 'ase:P', 'ase:D', 'ase:TRA',
        'ase:TMA', 'ase:CTA', 'ase:SECTOR', 'ase:SECTOR-C',
        'ase:RAS', 'ase:OCA', 'ase:UTA', 'ase:FIR', 'ase:UIR', 'ase:UIR-P'
    ];
    return [...keys].sort((a, b) => {
        const pa = priority.indexOf(a);
        const pb = priority.indexOf(b);
        if (pa !== -1 || pb !== -1) {
            if (pa === -1) return 1;
            if (pb === -1) return -1;
            if (pa !== pb) return pa - pb;
        }
        return a.localeCompare(b);
    });
}

function renderSiaProfileZoneFilterControls(dataset = siaDataset) {
    const container = document.getElementById('sia-profile-zone-filters');
    if (!container) return;

    const keys = getSiaProfileAvailableFilterKeys(dataset);
    if (!keys.length) {
        container.innerHTML = '<span class="sia-profile-zone-empty">Aucune zone activée dans le filtre SIA</span>';
        return;
    }

    container.innerHTML = keys.map(key => `
        <label class="sia-profile-zone-filter-item">
            <input type="checkbox"
                   data-sia-profile-filter-key="${escapeHtml(key)}"
                   ${isSiaProfileFilterEnabled(key) ? 'checked' : ''}>
            <span>${escapeHtml(getSiaProfileFilterLabel(key))}</span>
        </label>
    `).join('');
}

function getSiaProfileCandidateItems(dataset) {
    const operationalFamilies = buildSiaTmaOperationalFamilySet(dataset);
    return (dataset?.airspaces || []).filter(item => {
        const effectiveKey = getSiaEffectiveFilterKey(item);
        if (!isSiaFilterEnabled(effectiveKey)) return false;
        if (!isSiaProfileFilterEnabled(effectiveKey)) return false;
        // v15.67 — les SIV restent sur la carte mais ne font pas partie de la coupe verticale.
        if (isSiaFlightInformationSector(item)) return false;
        if (shouldHideSiaAirspaceAboveFl115(item)) return false;
        if (isSiaTechnicalTmaUnionParent(item)) return false;
        if (isSiaGenericTmaWithoutAltitude(item, operationalFamilies)) return false;
        if (!item.g) return false;

        const geometryType = String(item.g?.[0] || '');
        // Le profil représente des volumes traversés, donc uniquement les
        // zones surfaciques. Les D-OTHER ponctuels restent sur la carte.
        return geometryType === 'G' || geometryType === 'M';
    });
}

function getSiaProfileLabelParts(item) {
    const displayType = getSiaAirspaceDisplayType(item);
    const type = String(item?.t || '').trim().toUpperCase();
    const name = String(item?.n || '').trim();
    const code = String(item?.c || '').trim();
    const primaryName = name || code;
    const base = [displayType, primaryName].filter(Boolean).join(' ');

    if (type === 'R') {
        const restrictedInfo = getSiaRestrictedRemarkInfo(item);
        return {
            name: [
                base,
                String(restrictedInfo?.operationalName || '').trim()
            ].filter(Boolean).join(' / '),
            frequency: String(restrictedInfo?.frequency || '').trim()
        };
    }

    if (type === 'P') {
        return {
            name: [base, getSiaProhibitedOfficialName(item)].filter(Boolean).join(' / '),
            frequency: ''
        };
    }

    const firstFrequency = getSiaFirstAssignedFrequency(item);
    if (!firstFrequency) return { name: base, frequency: '' };

    const frequencyPrefix = firstFrequency.inferredFromRemark
        ? ''
        : String(firstFrequency.serviceType || '').trim();

    return {
        name: base,
        frequency: [frequencyPrefix, firstFrequency.value]
            .filter(Boolean)
            .join(' ') + (firstFrequency.supplementary ? ' (s)' : '')
    };
}

function getSiaProfileDisplayCeilingFeet(position) {
    const ownAlt = Number(position?.altitudeFt);
    let ceiling = Number.isFinite(ownAlt)
        ? Math.max(5000, ownAlt + 5000)
        : null;

    if (isSiaHideAboveFl115Enabled()) {
        ceiling = Number.isFinite(ceiling)
            ? Math.min(ceiling, SIA_HIDE_ABOVE_FL115_FEET)
            : SIA_HIDE_ABOVE_FL115_FEET;
    }

    return Number.isFinite(ceiling) ? ceiling : null;
}

function estimateSiaProfileLabelWidth(text, fontSize = 11) {
    const value = String(text || '');
    if (!value) return 0;
    // Estimation volontairement conservatrice pour éviter tout chevauchement.
    return value.length * fontSize * 0.59 + 8;
}

function siaProfileLabelRectsOverlap(a, b, padding = 4) {
    return !(
        a.x + a.width + padding <= b.x
        || b.x + b.width + padding <= a.x
        || a.y + a.height + padding <= b.y
        || b.y + b.height + padding <= a.y
    );
}

function findSiaProfileLabelPlacement({ x1, x2, yTop, yBottom, name, frequency }, occupied) {
    const rectWidth = Math.max(0, x2 - x1);
    const rectHeight = Math.max(0, yBottom - yTop);
    const labelWidth = Math.max(
        estimateSiaProfileLabelWidth(name, 11),
        estimateSiaProfileLabelWidth(frequency, 10)
    );
    const labelHeight = frequency ? 28 : 16;
    const inset = 5;

    if (!name || labelWidth > rectWidth - inset * 2 || labelHeight > rectHeight - 4) {
        return null;
    }

    const minCenterX = x1 + inset + labelWidth / 2;
    const maxCenterX = x2 - inset - labelWidth / 2;
    const minCenterY = yTop + 2 + labelHeight / 2;
    const maxCenterY = yBottom - 2 - labelHeight / 2;
    if (minCenterX > maxCenterX || minCenterY > maxCenterY) return null;

    const centersX = [
        (x1 + x2) / 2,
        minCenterX,
        maxCenterX,
        x1 + rectWidth * 0.35,
        x1 + rectWidth * 0.65
    ].map(x => Math.max(minCenterX, Math.min(maxCenterX, x)));

    const centersY = [
        (yTop + yBottom) / 2,
        minCenterY,
        maxCenterY
    ].map(y => Math.max(minCenterY, Math.min(maxCenterY, y)));

    const seen = new Set();
    for (const centerY of centersY) {
        for (const centerX of centersX) {
            const key = `${Math.round(centerX)}:${Math.round(centerY)}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const candidate = {
                x: centerX - labelWidth / 2,
                y: centerY - labelHeight / 2,
                width: labelWidth,
                height: labelHeight,
                centerX,
                centerY
            };

            if (!occupied.some(other => siaProfileLabelRectsOverlap(candidate, other))) {
                occupied.push(candidate);
                return candidate;
            }
        }
    }
    return null;
}

function buildSiaProfileSvg(volumes, position, viewport = {}) {
    /*
     * v15.67 — coordonnées SVG calées sur les dimensions CSS réelles du graphe.
     * On n’utilise plus le redimensionnement SVG anisotrope : les textes
     * gardent donc leurs proportions normales sur iPad, même en pleine largeur.
     */
    const width = Math.max(640, Math.round(Number(viewport.width) || 1000));
    const height = Math.max(220, Math.round(Number(viewport.height) || 330));
    const margin = { left: 64, right: 16, top: 18, bottom: 38 };
    const plotW = Math.max(1, width - margin.left - margin.right);
    const plotH = Math.max(1, height - margin.top - margin.bottom);
    const motionShiftNm = Math.max(0, Number(viewport.motionShiftNm) || 0);
    const motionShiftPx = (motionShiftNm / Math.max(1, siaProfileDistanceNm)) * plotW;

    const ownAlt = Number(position.altitudeFt);
    const profileCeilingFt = getSiaProfileDisplayCeilingFeet(position);
    const upperValues = volumes
        .map(v => Number(v.upperFt))
        .filter(Number.isFinite);

    let maxAlt;
    if (Number.isFinite(profileCeilingFt)) {
        maxAlt = Math.max(1000, profileCeilingFt);
    } else {
        maxAlt = Math.max(
            10000,
            upperValues.length ? Math.max(...upperValues) : 0
        );
        maxAlt = Math.min(40000, Math.ceil(maxAlt / 5000) * 5000);
        if (maxAlt < 10000) maxAlt = 10000;
    }

    const xForDistance = nm =>
        margin.left + (Math.max(0, Math.min(siaProfileDistanceNm, nm)) / siaProfileDistanceNm) * plotW;

    const yForAltitude = feet =>
        margin.top + plotH - (Math.max(0, Math.min(maxAlt, feet)) / maxAlt) * plotH;

    const grid = [];
    const gridAltitudes = [];
    for (let alt = 0; alt <= maxAlt; alt += 5000) gridAltitudes.push(alt);
    if (!gridAltitudes.includes(maxAlt)) gridAltitudes.push(maxAlt);

    [...new Set(gridAltitudes.map(v => Math.round(v)))].sort((a, b) => a - b).forEach(alt => {
        const y = yForAltitude(alt);
        const isTop = Math.abs(alt - maxAlt) < 1;
        let label = alt === 0 ? 'SFC' : `${Math.round(alt / 1000)}k`;
        if (isTop && isSiaHideAboveFl115Enabled() && Math.abs(maxAlt - SIA_HIDE_ABOVE_FL115_FEET) < 1) {
            label = 'FL115';
        } else if (isTop && alt % 1000 !== 0) {
            label = `${Math.round(alt)} ft`;
        }
        grid.push(`<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(width-margin.right).toFixed(1)}" y2="${y.toFixed(1)}" class="sia-profile-grid-line${isTop ? ' sia-profile-ceiling-line' : ''}"/>`);
        grid.push(`<text x="${margin.left-8}" y="${(y+4).toFixed(1)}" text-anchor="end" class="sia-profile-axis-label${isTop ? ' sia-profile-ceiling-label' : ''}">${escapeHtml(label)}</text>`);
    });

    const distanceStep = siaProfileDistanceNm <= 25 ? 5 : siaProfileDistanceNm <= 50 ? 10 : 20;
    for (let nm = 0; nm <= siaProfileDistanceNm; nm += distanceStep) {
        const x = xForDistance(nm);
        grid.push(`<line x1="${x.toFixed(1)}" y1="${margin.top}" x2="${x.toFixed(1)}" y2="${(height-margin.bottom).toFixed(1)}" class="sia-profile-grid-line sia-profile-grid-vertical"/>`);
        grid.push(`<text x="${x.toFixed(1)}" y="${height-12}" text-anchor="middle" class="sia-profile-axis-label">${nm} NM</text>`);
    }

    const shapes = [];
    const occupiedLabels = [];

    volumes.forEach((volume, index) => {
        const x1 = xForDistance(volume.startNm);
        const x2 = xForDistance(volume.endNm);
        const lower = Number.isFinite(volume.lowerFt) ? volume.lowerFt : 0;
        const upper = Number.isFinite(volume.upperFt) ? volume.upperFt : maxAlt;
        const visibleLower = Math.max(0, Math.min(maxAlt, lower));
        const visibleUpper = Math.max(0, Math.min(maxAlt, upper));
        if (visibleUpper <= visibleLower + 1) return;

        const yTop = yForAltitude(visibleUpper);
        const yBottom = yForAltitude(visibleLower);
        const rectHeight = Math.max(2, yBottom - yTop);
        const rectWidth = Math.max(2, x2 - x1);
        const style = getSiaAirspaceStyle(volume.item);
        const color = String(style?.color || '#3559e0');
        const labelParts = getSiaProfileLabelParts(volume.item);
        const placement = findSiaProfileLabelPlacement({
            x1,
            x2,
            yTop,
            yBottom,
            name: labelParts.name,
            frequency: labelParts.frequency
        }, occupiedLabels);

        let labelSvg = '';
        if (placement) {
            const nameY = labelParts.frequency
                ? placement.centerY - 3
                : placement.centerY + 4;
            const frequencyY = placement.centerY + 10;
            labelSvg = `
                <text x="${placement.centerX.toFixed(1)}" y="${nameY.toFixed(1)}"
                      text-anchor="middle" class="sia-profile-volume-label sia-profile-volume-label-name">${escapeHtml(labelParts.name)}</text>
                ${labelParts.frequency ? `<text x="${placement.centerX.toFixed(1)}" y="${frequencyY.toFixed(1)}"
                      text-anchor="middle" class="sia-profile-volume-label sia-profile-volume-label-frequency">${escapeHtml(labelParts.frequency)}</text>` : ''}`;
        }

        const motionAnimation = motionShiftPx >= 0.5
            ? `<animateTransform attributeName="transform" type="translate" from="${motionShiftPx.toFixed(1)} 0" to="0 0" dur="0.18s" fill="freeze"/>`
            : '';

        shapes.push(`
            <g class="sia-profile-volume-group" data-profile-index="${index}" data-profile-key="${escapeHtml(String(volume.profileKey || ''))}">
                ${motionAnimation}
                <rect x="${x1.toFixed(1)}" y="${yTop.toFixed(1)}"
                      width="${rectWidth.toFixed(1)}" height="${rectHeight.toFixed(1)}"
                      fill="${escapeHtml(color)}" fill-opacity="0.20"
                      stroke="${escapeHtml(color)}" stroke-width="2"
                      class="sia-profile-volume"/>
                ${labelSvg}
            </g>
        `);
    });

    const ownAltitudeLine = [];
    const timeVectorMarks = [];
    if (Number.isFinite(ownAlt) && ownAlt >= 0 && ownAlt <= maxAlt) {
        const y = yForAltitude(ownAlt);
        ownAltitudeLine.push(`<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${width-margin.right}" y2="${y.toFixed(1)}" class="sia-profile-own-alt-line"/>`);
        ownAltitudeLine.push(`<text x="${width-margin.right-4}" y="${(y-5).toFixed(1)}" text-anchor="end" class="sia-profile-own-alt-label">${Math.round(ownAlt)} ft</text>`);

        /*
         * v15.69 — les repères 2'/5'/10' du vecteur temps sont reportés sur
         * cette ligne d'altitude. Leur abscisse est calculée avec la vitesse sol.
         */
        const speedKt = Number(position?.speedKt);
        if (Number.isFinite(speedKt) && speedKt >= 1) {
            [2, 5, 10].forEach(minutes => {
                const distanceNm = speedKt * minutes / 60;
                if (distanceNm < 0 || distanceNm > siaProfileDistanceNm + 0.001) return;
                const x = xForDistance(distanceNm);
                timeVectorMarks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5" class="sia-profile-time-dot"/>`);
                timeVectorMarks.push(`<text x="${x.toFixed(1)}" y="${(y-10).toFixed(1)}" text-anchor="middle" class="sia-profile-time-dot-label">${minutes}'</text>`);
            });
        }
    }

    return `
        <svg class="sia-profile-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Coupe verticale des espaces aéronautiques devant l'avion">
            <rect x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" class="sia-profile-plot-bg"/>
            ${grid.join('')}
            ${shapes.join('')}
            ${ownAltitudeLine.join('')}
            ${timeVectorMarks.join('')}
            <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height-margin.bottom}" class="sia-profile-axis"/>
            <line x1="${margin.left}" y1="${height-margin.bottom}" x2="${width-margin.right}" y2="${height-margin.bottom}" class="sia-profile-axis"/>
            <text x="${margin.left+5}" y="${margin.top+14}" class="sia-profile-axis-title">Altitude ft</text>
        </svg>
    `;
}

async function renderSiaAirspaceProfile(reason = 'manual') {
    if (!siaProfileOpen) return;

    const panel = document.getElementById('sia-profile-panel');
    const chart = document.getElementById('sia-profile-chart');
    const subtitle = document.getElementById('sia-profile-subtitle');
    if (!panel || !chart) return;

    const position = getSiaProfileCurrentPosition();
    if (!position) {
        chart.innerHTML = '<div class="sia-profile-empty">Position / route GPS indisponible.</div>';
        if (subtitle) subtitle.textContent = 'Route GPS nécessaire';
        return;
    }

    const dataset = await ensureSiaDatasetLoaded({
        full: true,
        reason: 'profil-sia-rendu'
    });
    const { samples, stepNm } = buildSiaProfileSamples(position, siaProfileDistanceNm);
    const routeBounds = getSiaProfileRouteBounds(samples);
    const items = getSiaProfileCandidateItems(dataset);

    const volumes = [];
    const profileCeilingFt = getSiaProfileDisplayCeilingFeet(position);
    const forwardMovementNm = getSiaProfileForwardMovementNm(position);

    items.forEach(item => {
        if (!siaProfileItemCouldMeetRoute(item, routeBounds)) return;

        const geometry = getSiaCachedGeometry(item);
        if (!geometry) return;

        const intervals = buildSiaProfileIntervals(item, geometry, samples, stepNm);
        if (!intervals.length) return;

        const lowerFt = siaProfileVerticalToFeet(item.lo);
        const upperFt = siaProfileVerticalToFeet(item.up);

        /*
         * v15.67 — le profil est une vue opérationnelle autour de l'avion :
         * on ne conserve pas une zone dont le plancher commence au-dessus du
         * plafond affiché (altitude avion + 5000 ft, limité au FL115 si demandé).
         * Les plafonds plus hauts sont tronqués graphiquement, jamais dans la
         * donnée SIA ni dans la fiche de la zone.
         */
        if (
            Number.isFinite(profileCeilingFt)
            && Number.isFinite(lowerFt)
            && lowerFt >= profileCeilingFt
        ) return;

        const profileUpperFt = Number.isFinite(profileCeilingFt)
            ? (Number.isFinite(upperFt) ? Math.min(upperFt, profileCeilingFt) : profileCeilingFt)
            : upperFt;

        intervals.forEach((interval, intervalIndex) => {
            volumes.push({
                item,
                geometry,
                lowerFt,
                upperFt: profileUpperFt,
                startNm: interval.startNm,
                endNm: interval.endNm,
                profileKey: getSiaProfileVolumeMotionKey(item, intervalIndex)
            });
        });
    });

    stabilizeSiaProfileVolumeIntervals(volumes, forwardMovementNm);

    // Ordre stable : zones les plus proches puis les plus basses.
    volumes.sort((a, b) =>
        a.startNm - b.startNm
        || (Number(a.lowerFt) || 0) - (Number(b.lowerFt) || 0)
    );

    // Garde-fou graphique sur iPad.
    siaProfileSegments = volumes.slice(0, 80);

    if (subtitle) {
        const profileCeilingFt = getSiaProfileDisplayCeilingFeet(position);
        const ceilingText = Number.isFinite(profileCeilingFt)
            ? ` · plafond ${Math.round(profileCeilingFt)} ft`
            : '';
        subtitle.textContent = `Route ${String(Math.round(position.heading)).padStart(3, '0')}° · 0–${siaProfileDistanceNm} NM${ceilingText} · ${siaProfileSegments.length} volume${siaProfileSegments.length > 1 ? 's' : ''}`;
    }

    if (!siaProfileSegments.length) {
        chart.innerHTML = '<div class="sia-profile-empty">Aucun espace SIA actif rencontré dans l’axe.</div>';
        return;
    }

    chart.innerHTML = buildSiaProfileSvg(siaProfileSegments, position, {
        width: chart.clientWidth || chart.getBoundingClientRect?.().width || 1000,
        height: chart.clientHeight || chart.getBoundingClientRect?.().height || 330,
        motionShiftNm: forwardMovementNm
    });

    chart.querySelectorAll('[data-profile-index]').forEach(group => {
        group.addEventListener('click', event => {
            const index = Number(event.currentTarget?.dataset?.profileIndex);
            const segment = siaProfileSegments[index];
            if (!segment) return;

            const middleNm = (segment.startNm + segment.endNm) / 2;
            const point = calculateDestinationLatLng(
                position.lat,
                position.lng,
                position.heading,
                middleNm * 1852
            );
            const latlng = L.latLng(Number(point[0]), Number(point[1]));

            selectSiaCtrTouchLayer(
                null,
                segment.item,
                latlng,
                segment.geometry
            );
        });
    });
}

function syncSiaProfilePanelToViewport() {
    const panel = document.getElementById('sia-profile-panel');
    if (!panel || !siaProfileOpen || panel.hidden) return;

    const visualViewport = window.visualViewport || null;
    const viewportTop = visualViewport
        ? Math.max(0, Number(visualViewport.offsetTop) || 0)
        : 0;
    const fallbackViewportHeight = Math.max(
        1,
        window.innerHeight || 0,
        document.documentElement?.clientHeight || 0
    );
    const viewportHeight = Math.max(
        1,
        visualViewport
            ? Number(visualViewport.height) || fallbackViewportHeight
            : fallbackViewportHeight
    );

    const topGap = 8;
    const maxAvailableHeight = Math.max(160, viewportHeight - topGap);
    const desiredHeight = Math.min(
        430,
        maxAvailableHeight,
        Math.max(250, viewportHeight * 0.43)
    );
    const top = Math.max(
        viewportTop + topGap,
        viewportTop + viewportHeight - desiredHeight
    );

    panel.style.top = `${Math.round(top)}px`;
    panel.style.bottom = 'auto';
    panel.style.height = `${Math.round(desiredHeight)}px`;
    panel.style.maxHeight = `${Math.round(maxAvailableHeight)}px`;
}

function scheduleSiaProfileViewportSync() {
    if (!siaProfileOpen) return;
    requestAnimationFrame(() => syncSiaProfilePanelToViewport());
    setTimeout(() => syncSiaProfilePanelToViewport(), 120);
}

function setSiaProfileOpen(open) {
    siaProfileOpen = !!open;

    const panel = document.getElementById('sia-profile-panel');
    const button = document.getElementById('sia-profile-button');
    const swipeHandle = document.getElementById('sia-profile-swipe-handle');

    if (panel) {
        panel.hidden = !siaProfileOpen;
        panel.setAttribute('aria-hidden', siaProfileOpen ? 'false' : 'true');
    }
    if (button) {
        button.classList.toggle('active', siaProfileOpen);
        button.setAttribute('aria-pressed', siaProfileOpen ? 'true' : 'false');
    }
    if (swipeHandle) {
        swipeHandle.hidden = siaProfileOpen;
        swipeHandle.setAttribute('aria-hidden', siaProfileOpen ? 'true' : 'false');
    }

    if (siaProfileOpen) {
        syncSiaProfilePanelToViewport();
        updateSiaProfileMapZonesToggleButton();
        if (siaDataset) {
            renderSiaProfileZoneFilterControls(siaDataset);
        } else {
            ensureSiaDatasetLoaded({
                full: true,
                reason: 'profil-sia-ouverture'
            })
                .then(dataset => renderSiaProfileZoneFilterControls(dataset))
                .catch(() => {});
        }
        scheduleSiaProfileRefresh('open');
    } else {
        clearTimeout(siaProfileRefreshTimer);
        siaProfileRefreshTimer = null;
        siaProfilePreviousMotionPosition = null;
        siaProfilePreviousIntervals = new Map();
    }
}

function initializeSiaAirspaceProfileUi() {
    const button = document.getElementById('sia-profile-button');
    const panel = document.getElementById('sia-profile-panel');
    const closeButton = document.getElementById('sia-profile-close');
    const swipeHandle = document.getElementById('sia-profile-swipe-handle');
    const zoneFilters = document.getElementById('sia-profile-zone-filters');
    const mapZonesToggle = document.getElementById('sia-profile-map-zones-toggle');

    /*
     * v15.61 — le panneau existe dès index.html, tandis que le bouton PROFIL
     * est créé à l'ouverture du menu des filtres. Les deux sont donc liés
     * indépendamment et de façon idempotente.
     */
    if (panel && panel.dataset.profileBound !== '1') {
        panel.dataset.profileBound = '1';

        zoneFilters?.addEventListener('change', event => {
            const input = event.target?.closest?.('input[data-sia-profile-filter-key]');
            if (!input) return;
            setSiaProfileFilterEnabled(input.dataset.siaProfileFilterKey, input.checked);
            scheduleSiaProfileRefresh('profile-zone-filter');
        });

        mapZonesToggle?.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setSiaMapAirspacesVisible(!siaMapAirspacesVisible);
        });
        updateSiaProfileMapZonesToggleButton();

        closeButton?.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setSiaProfileOpen(false);
        });

        panel.querySelectorAll('[data-profile-range]').forEach(rangeButton => {
            rangeButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                const distance = Number(rangeButton.dataset.profileRange);
                if (![25, 50, 100].includes(distance)) return;

                siaProfileDistanceNm = distance;
                // Un changement d'échelle invalide les intervalles mémorisés
                // pour l'animation de glissement du profil.
                siaProfilePreviousMotionPosition = null;
                siaProfilePreviousIntervals = new Map();
                panel.querySelectorAll('[data-profile-range]').forEach(other =>
                    other.classList.toggle('active', other === rangeButton)
                );
                scheduleSiaProfileRefresh('range');
            });
        });
    }

    /*
     * v15.65 — geste iPad depuis une poignée située à l'intérieur du viewport.
     * Le vrai bord système iPadOS reste réservé au système ; cette poignée est
     * volontairement placée juste au-dessus de la safe-area.
     */
    if (swipeHandle && swipeHandle.dataset.profileSwipeBound !== '1') {
        swipeHandle.dataset.profileSwipeBound = '1';
        swipeHandle.hidden = siaProfileOpen;

        let startY = null;
        let lastY = null;

        const resetSwipe = () => {
            startY = null;
            lastY = null;
        };

        swipeHandle.addEventListener('touchstart', event => {
            if (event.touches?.length !== 1) return;
            startY = Number(event.touches[0].clientY);
            lastY = startY;
            event.preventDefault();
        }, { passive: false });

        swipeHandle.addEventListener('touchmove', event => {
            if (startY === null || event.touches?.length !== 1) return;
            lastY = Number(event.touches[0].clientY);
            event.preventDefault();
        }, { passive: false });

        swipeHandle.addEventListener('touchend', event => {
            const endY = lastY;
            if (startY !== null && Number.isFinite(endY) && endY - startY <= -35) {
                setSiaProfileOpen(true);
            }
            resetSwipe();
            event.preventDefault();
        }, { passive: false });

        swipeHandle.addEventListener('touchcancel', resetSwipe, { passive: true });
        swipeHandle.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setSiaProfileOpen(true);
        });
    }

    if (panel && panel.dataset.profileSwipeCloseBound !== '1') {
        panel.dataset.profileSwipeCloseBound = '1';
        const header = panel.querySelector('.sia-profile-header');
        if (header) {
            let headerStartY = null;
            let headerLastY = null;

            header.addEventListener('touchstart', event => {
                if (event.target?.closest?.('button')) return;
                if (event.touches?.length !== 1) return;
                headerStartY = Number(event.touches[0].clientY);
                headerLastY = headerStartY;
            }, { passive: true });

            header.addEventListener('touchmove', event => {
                if (headerStartY === null || event.touches?.length !== 1) return;
                headerLastY = Number(event.touches[0].clientY);
            }, { passive: true });

            header.addEventListener('touchend', () => {
                if (
                    headerStartY !== null
                    && Number.isFinite(headerLastY)
                    && headerLastY - headerStartY >= 45
                ) {
                    setSiaProfileOpen(false);
                }
                headerStartY = null;
                headerLastY = null;
            }, { passive: true });
        }
    }

    if (button && button.dataset.profileBound !== '1') {
        button.dataset.profileBound = '1';
        button.classList.toggle('active', siaProfileOpen);
        button.setAttribute('aria-pressed', siaProfileOpen ? 'true' : 'false');

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            setSiaProfileOpen(!siaProfileOpen);

            // Le menu filtres ne reste pas posé au-dessus du profil.
            const modal = button.closest('.sia-filter-modal');
            if (modal) {
                modal.classList.remove('open');
                modal.setAttribute('aria-hidden', 'true');
            }
        });
    }

    if (!window.__npfSiaProfileViewportEventsBound) {
        window.__npfSiaProfileViewportEventsBound = true;

        window.addEventListener('resize', scheduleSiaProfileViewportSync, { passive: true });
        window.addEventListener(
            'orientationchange',
            () => setTimeout(scheduleSiaProfileViewportSync, 180),
            { passive: true }
        );

        if (window.visualViewport) {
            window.visualViewport.addEventListener(
                'resize',
                scheduleSiaProfileViewportSync,
                { passive: true }
            );
            window.visualViewport.addEventListener(
                'scroll',
                scheduleSiaProfileViewportSync,
                { passive: true }
            );
        }
    }
}

function initializeSiaSystem() {
    if (window.__npfSiaSystemReady) return;
    window.__npfSiaSystemReady = true;

    ensureSiaMapPanes();
    loadSiaFilterPrefs();
    migrateSiaSivFilterPreference();
    bindSiaManagementButtons();
    initializeSiaAirspaceProfileUi();
    updateSiaProfileMapZonesToggleButton();
    refreshSiaManagementStatus();

    if (map && !map.__npfSiaEventsBound) {
        map.__npfSiaEventsBound = true;
        /*
         * v15.91 — précharger avant de sortir du tampon pendant le déplacement,
         * puis repositionner/recharger proprement à la fin du geste.
         */
        let npfDiagMoveSample = null;
        let npfDiagZoomStartedAt = 0;

        map.on('movestart', () => {
            markSiaDecorationMapMotion();
            const gpsFollowPan = isNpfGpsFollowProgrammaticPan();
            if (!gpsFollowPan) {
                clearTimeout(siaMoveDecorationRefreshTimer);
                siaMoveDecorationRefreshTimer = null;
                siaDecorationProgressiveRun += 1;
            }
            const now = NPF_STARTUP_DIAGNOSTIC.now();
            const startSnapshot = getNpfStartupDiagnosticOverlaySnapshot();
            npfDiagMoveSample = {
                startedAt: now,
                lastAt: now,
                events: 0,
                gapTotal: 0,
                maxGap: 0,
                gaps100: 0,
                gaps150: 0,
                gaps250: 0,
                maxReadsActive: Number(startSnapshot.npfReadsActive || 0),
                maxReadsQueued: Number(startSnapshot.npfReadsQueued || 0),
                gpsPositionsStart: Number(
                    NPF_STARTUP_DIAGNOSTIC.state?.gpsSummary?.positions || 0
                ),
                startSnapshot,
                /* v17.32 — centre / zoom de départ pour le déplacement du geste. */
                startCenter: map.getCenter(),
                startZoom: map.getZoom(),
                /* v17.32 — piste 19 : « manuel » aussi sans suivi GPS actif. */
                source: gpsFollowPan
                    ? 'gps-follow'
                    : (
                        centerGpsFollowUserGestureActive || npfDiagIsUserMapContactRecent()
                            ? 'manual'
                            : 'autre'
                    )
            };
        });
        map.on('move', () => {
            if (!npfDiagMoveSample) return;
            const now = NPF_STARTUP_DIAGNOSTIC.now();
            const gap = Math.max(0, now - npfDiagMoveSample.lastAt);
            npfDiagMoveSample.lastAt = now;
            npfDiagMoveSample.events += 1;
            npfDiagMoveSample.gapTotal += gap;
            npfDiagMoveSample.maxGap = Math.max(npfDiagMoveSample.maxGap, gap);
            if (gap >= 100) npfDiagMoveSample.gaps100 += 1;
            if (gap >= 150) npfDiagMoveSample.gaps150 += 1;
            if (gap >= 250) npfDiagMoveSample.gaps250 += 1;
            npfDiagMoveSample.maxReadsActive = Math.max(
                Number(npfDiagMoveSample.maxReadsActive || 0),
                Number(directOfflineNpfActiveReads || 0)
            );
            npfDiagMoveSample.maxReadsQueued = Math.max(
                Number(npfDiagMoveSample.maxReadsQueued || 0),
                Number(directOfflineNpfReadQueue?.length || 0)
            );
        });
        map.on('moveend', () => {
            markSiaDecorationMapMotion();
            const sample = npfDiagMoveSample;
            npfDiagMoveSample = null;
            if (sample) {
                const now = NPF_STARTUP_DIAGNOSTIC.now();
                const avgGap = sample.events > 0 ? sample.gapTotal / sample.events : 0;
                const endSnapshot = getNpfStartupDiagnosticOverlaySnapshot();
                npfDiagMapMotion(sample.source || 'autre', {
                    dureeMs: Math.round(now - sample.startedAt),
                    moveEvents: sample.events,
                    gapMoyMs: Math.round(avgGap),
                    gapMaxMs: Math.round(sample.maxGap),
                    gaps100: Number(sample.gaps100 || 0),
                    gaps150: Number(sample.gaps150 || 0),
                    gaps250: Number(sample.gaps250 || 0),
                    tileQueueMaxPendantPan: Number(sample.maxReadsQueued || 0),
                    tileActiveMaxPendantPan: Number(sample.maxReadsActive || 0),
                    leafletLayersDebut: Number(sample.startSnapshot?.leafletLayers || 0),
                    leafletLayersFin: Number(endSnapshot.leafletLayers || 0),
                    zoom: map.getZoom(),
                    zonesVisibles: Array.isArray(siaRenderedAirspaceFeatures) ? siaRenderedAirspaceFeatures.length : 0,
                    ...npfDiagGetMapMotionExtraMetrics(sample)
                });

                if (
                    Number(sample.maxGap || 0) >= 100
                    || Number(sample.gaps100 || 0) > 0
                ) {
                    scheduleNpfPanJankCorrelation(sample, now, endSnapshot);
                }
            } else if (consumeSiaStartupPassiveMoveendGuard()) {
                npfDiagSiaInteraction(
                    'SIA RAFRAÎCHISSEMENT',
                    `raison=moveend-passif-post-startup · ignoré · zoom=${map.getZoom()} · zones=${Array.isArray(siaRenderedAirspaceFeatures) ? siaRenderedAirspaceFeatures.length : 0}`,
                    { totalMs: 0 }
                );
                return;
            }
            const gpsFollowMoveend = sample?.source === 'gps-follow' || isNpfGpsFollowProgrammaticPan();

            if (isNpfMapOverlayPrioritySequenceActive()) {
                npfDiagSiaInteraction(
                    'SIA RAFRAÎCHISSEMENT',
                    `raison=moveend · différé par priorité carte v17.02 · zoom=${map.getZoom()}`,
                    { totalMs: 0 }
                );
                return;
            }

            /* v16.58 — Leaflet peut émettre moveend au milieu d'un pinch/zoom.
             * Aucun rendu SIA intermédiaire : seul zoomend reconstruira la vue. */
            if (siaZoomGestureActive) {
                npfDiagSiaInteraction(
                    'SIA RAFRAÎCHISSEMENT',
                    `raison=moveend-pendant-zoom · ignoré · zoom=${map.getZoom()}`,
                    { totalMs: 0 }
                );
                return;
            }
            if (siaHeavyZoomFinalRefreshPending) {
                npfDiagSiaInteraction(
                    'SIA RAFRAÎCHISSEMENT',
                    `raison=moveend-attente-fin-routes-ht · ignoré · zoom=${map.getZoom()}`,
                    { totalMs: 0 }
                );
                return;
            }
            if (siaStartupInitialRefreshPending && !siaRenderedCoverageBounds) {
                npfDiagSiaInteraction(
                    'SIA RAFRAÎCHISSEMENT',
                    `raison=moveend-démarrage · différé vers startup-prefs · zoom=${map.getZoom()}`,
                    { totalMs: 0 }
                );
            } else {
                scheduleSiaCoverageRefresh(gpsFollowMoveend ? 'gps-follow' : 'moveend');
            }
        });
        map.on('zoomstart', () => {
            markSiaDecorationMapMotion();
            npfDiagZoomStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
            siaZoomGestureActive = true;
            /* v16.62 — une transaction Routes/HT différée peut couvrir plusieurs
             * zoomend intermédiaires. Garder le verrou SIA tant que son Promise
             * commun n'est pas résolu. */
            siaHeavyZoomFinalRefreshPending = Boolean(npfHeavyOverlayZoomOutPromise);
            /* v16.58 — tout travail de l'ancien zoom est obsolète, quel que soit son motif. */
            cancelAllSiaWorkForZoomStart();
        });
        map.on('zoomend', () => {
            markSiaDecorationMapMotion();
            const now = NPF_STARTUP_DIAGNOSTIC.now();
            siaZoomGestureActive = false;
            if (npfDiagZoomStartedAt > 0) {
                npfDiagZoom({
                    dureeMs: Math.round(now - npfDiagZoomStartedAt),
                    zoom: map.getZoom(),
                    zonesVisibles: Array.isArray(siaRenderedAirspaceFeatures) ? siaRenderedAirspaceFeatures.length : 0
                });
                npfDiagZoomStartedAt = 0;
            }
            if (isNpfMapOverlayPrioritySequenceActive()) {
                npfDiagSiaInteraction(
                    'SIA RAFRAÎCHISSEMENT',
                    `raison=zoomend · différé par priorité carte v17.02 · zoom=${map.getZoom()}`,
                    { totalMs: 0 }
                );
                return;
            }

            const heavyZoomPromise = npfHeavyOverlayZoomOutPromise;
            if (heavyZoomPromise) {
                /* v16.62 — tous les zoomend intermédiaires observent le même
                 * Promise débouncé. N'enregistrer qu'un seul finally afin de ne
                 * lancer qu'un unique SIA sur la vue finale stabilisée. */
                siaHeavyZoomFinalRefreshPending = true;
                if (siaHeavyZoomObservedPromise !== heavyZoomPromise) {
                    siaHeavyZoomObservedPromise = heavyZoomPromise;
                    heavyZoomPromise.finally(() => {
                        if (siaHeavyZoomObservedPromise !== heavyZoomPromise) return;
                        siaHeavyZoomObservedPromise = null;
                        if (!siaZoomGestureActive) {
                            scheduleSiaLayerRefresh('zoomend-after-routes-ht');
                        } else {
                            siaHeavyZoomFinalRefreshPending = false;
                        }
                    });
                }
            } else {
                scheduleSiaLayerRefresh('zoomend');
            }
        });
    }

    if (hasAnyEnabledSiaFilter()) {
        siaStartupInitialRefreshPending = true;
        setTimeout(() => {
            // v16.57 — un seul rendu initial, sur la vue réellement courante.
            siaStartupInitialRefreshPending = false;
            scheduleSiaLayerRefresh('startup-prefs');
        }, 900);
    }
}


