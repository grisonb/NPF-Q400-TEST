/* ==========================================================================
   v17.90 — TRAITS VERS LE FEU MODIFIABLES : AVION -> FEU et PÉLIC -> FEU
   (repris de NPF-Q400-RUN v1.11 / v1.16, adapté à la TEST : plusieurs pélicandromes)
   --------------------------------------------------------------------------
   Même mécanisme et mêmes gestes que les WP du mode navigation (src/200) :
   - appui long près d'un trait : un WP y est inséré puis passe aussitôt en
     « Déplacer » (poignée à faire glisser, relâcher pour poser) ;
   - toucher un WP : sa fiche (Déplacer, Supprimer, Remettre en ligne droite) ;
   - chaque branche affiche son cap magnétique et sa distance (étiquettes et
     cap constant de src/200), le total est recalculé.
   Traits : AVION -> FEU (trait rouge, quand il va de l'avion au feu) et chaque
   route PÉLIC -> FEU affichée (les N pélicandromes les plus proches) ; les WP
   sont gardés par pélicandrome. Calculs (src/270 updateCalculatorData) : trait du
   pélicandrome choisi pour la rotation, le BINGO PÉLIC et les distances du
   calculateur ; trait de la base si elle est un des pélicandromes affichés
   (transit, BINGO BASE) ; AVION -> FEU pour le transit avion (Dérout.). Temps et
   rotation : règle de vitesse unique de la TEST (src/050), sur la distance du
   trait. Un nouveau feu repart en ligne droite ; les WP restent pour le feu
   (clé propre à la TEST, relance comprise) et partent avec lui quand il est
   fermé (src/100 clearCurrentSelection). Aucun réseau (hors ligne).
   Le mode navigation (route WP, GoTo) n'est pas modifié : il garde la priorité.
   ========================================================================== */

const NPF_TRAITS_FEU_KEY = 'npfQ400TestTraitsFeuV1';
let npfTraitsFeuState = { feuKey: '', avion: [], pelic: {} };
let npfTraitsFeuLayer = null;
let npfTraitsFeuLabelLayer = null;
let npfTraitsFeuMarkers = new Map();        // id du WP -> marqueur
let npfTraitsFeuMoveHandle = null;
let npfTraitsFeuMoveOutsideHandler = null;

function getNpfTraitsFeuKey(commune = (typeof currentCommune !== 'undefined' ? currentCommune : null)) {
    const lat = Number(commune?.latitude_mairie);
    const lon = Number(commune?.longitude_mairie);
    return Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(5)}|${lon.toFixed(5)}` : '';
}

/* Trait : 'avion' ou 'pelic:OACI'. */
function getNpfTraitFeuOaci(trait) {
    const m = /^pelic:([A-Z0-9]{3,4})$/.exec(String(trait || ''));
    return m ? m[1] : '';
}

function getNpfTraitFeuLibelle(trait) {
    return trait === 'avion' ? 'AVION → FEU' : `${getNpfTraitFeuOaci(trait)} → FEU`;
}

function videNpfTraitsFeu() {
    return { feuKey: '', avion: [], pelic: {} };
}

/* Feu fermé (×, Fermer, Go To ailleurs) : plus aucune trace de ses WP (carte, poignée, mémoire). */
function effacerNpfTraitsFeu() {
    if (npfTraitsFeuMoveHandle) { try { npfTraitsFeuMoveHandle.remove(); } catch (_) {} npfTraitsFeuMoveHandle = null; }
    clearNpfTraitsFeuMoveOutside();
    npfTraitsFeuState = videNpfTraitsFeu();
    try { localStorage.removeItem(NPF_TRAITS_FEU_KEY); } catch (_) {}
    npfTraitsFeuMarkers = new Map();
    try { npfTraitsFeuLayer?.clearLayers(); npfTraitsFeuLabelLayer?.clearLayers(); } catch (_) {}
}

function normalizeNpfTraitsFeuWaypoints(list) {
    return (Array.isArray(list) ? list : []).map((wp, index) => {
        const lat = Number(wp?.lat);
        const lon = Number(wp?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { id: String(wp?.id || `tf-${Date.now()}-${index}`), lat, lon };
    }).filter(Boolean);
}

function restoreNpfTraitsFeu() {
    try {
        const raw = JSON.parse(localStorage.getItem(NPF_TRAITS_FEU_KEY) || 'null');
        const pelic = {};
        Object.entries(raw?.pelic && typeof raw.pelic === 'object' ? raw.pelic : {}).forEach(([oaci, list]) => {
            const code = String(oaci || '').toUpperCase();
            const wps = normalizeNpfTraitsFeuWaypoints(list);
            if (/^[A-Z0-9]{3,4}$/.test(code) && wps.length) pelic[code] = wps;
        });
        npfTraitsFeuState = { feuKey: String(raw?.feuKey || ''), avion: normalizeNpfTraitsFeuWaypoints(raw?.avion), pelic };
        /* WP restés en mémoire alors qu'aucun feu n'est ouvert : effacés. */
        if (raw && !localStorage.getItem('currentCommune')) {
            npfTraitsFeuState = videNpfTraitsFeu();
            localStorage.removeItem(NPF_TRAITS_FEU_KEY);
        }
    } catch (_) {
        npfTraitsFeuState = videNpfTraitsFeu();
    }
}

function persistNpfTraitsFeu() {
    try {
        const vide = !npfTraitsFeuState.avion.length && !Object.values(npfTraitsFeuState.pelic).some(l => l.length);
        if (vide) localStorage.removeItem(NPF_TRAITS_FEU_KEY);
        else localStorage.setItem(NPF_TRAITS_FEU_KEY, JSON.stringify(npfTraitsFeuState));
    } catch (_) {}
}

/* Feu affiché : un NOUVEAU feu repart en ligne droite ; le même feu (relance, réaffichage) garde ses WP. */
function syncNpfTraitsFeuPourFeu(commune) {
    const key = getNpfTraitsFeuKey(commune);
    if (!key || key === npfTraitsFeuState.feuKey) return;
    npfTraitsFeuState = { feuKey: key, avion: [], pelic: {} };
    persistNpfTraitsFeu();
}

/* Liste modifiable des WP d'un trait (créée au besoin pour un pélicandrome). */
function getNpfTraitsFeuListe(trait, creer = false) {
    if (trait === 'avion') return npfTraitsFeuState.avion;
    const oaci = getNpfTraitFeuOaci(trait);
    if (!oaci) return [];
    if (!npfTraitsFeuState.pelic[oaci] && creer) npfTraitsFeuState.pelic[oaci] = [];
    return npfTraitsFeuState.pelic[oaci] || [];
}

function getNpfTraitsFeuWaypoints(trait) {
    if (getNpfTraitsFeuKey() !== npfTraitsFeuState.feuKey || !npfTraitsFeuState.feuKey) return [];
    return getNpfTraitsFeuListe(trait);
}

function getNpfTraitsFeuFeu() {
    if (typeof currentCommune === 'undefined' || !currentCommune) return null;
    const lat = Number(currentCommune.latitude_mairie);
    const lon = Number(currentCommune.longitude_mairie);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/* Pélicandromes dont la route PÉLIC -> FEU est dessinée (les N plus proches, src/150 displayCommuneDetails). */
function getNpfTraitsFeuPelicAffiches() {
    const feu = getNpfTraitsFeuFeu();
    if (!feu) return [];
    try {
        const count = Number.parseInt(document.getElementById('airport-count')?.value || '0', 10);
        const n = Number.isFinite(count) ? Math.max(0, Math.min(10, count)) : 0;
        return getClosestAirports(feu.lat, feu.lon, n).map(ap => ap.oaci);
    } catch (_) {
        return [];
    }
}

function getNpfTraitsFeuTraitsAffiches() {
    return ['avion', ...getNpfTraitsFeuPelicAffiches().map(oaci => `pelic:${oaci}`)];
}

/* Trait AVION -> FEU présent seulement quand le trait rouge va de l'avion au feu (ni GoTo WP / terrain, ni cycle vers le pélic). */
function isNpfTraitAvionVersFeu() {
    if (!getNpfTraitsFeuFeu()) return false;
    try {
        if (window.__npfWaypointRouteReady === true && typeof isNpfWaypointGotoActive === 'function' && isNpfWaypointGotoActive()) return false;
        if (typeof selectedAirportDestination !== 'undefined' && selectedAirportDestination) return false;
        const cycle = typeof getNpfFirePelicAutoCycleTarget === 'function' ? getNpfFirePelicAutoCycleTarget() : null;
        if (cycle && cycle.kind !== 'fire') return false;   // cycle armé vers le feu : c'est bien le trait AVION -> FEU
    } catch (_) {}
    return true;
}

function getNpfTraitsFeuAvionLatLng() {
    try {
        const p = userMarker?.getLatLng?.();
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) return { lat: p.lat, lon: p.lng };
    } catch (_) {}
    return null;
}

/* Points du trait : départ (pélicandrome ou avion), WP, feu ; null si le trait n'est pas affiché. */
function getNpfTraitFeuPoints(trait) {
    const feu = getNpfTraitsFeuFeu();
    if (!feu) return null;
    let depart = null;
    if (trait === 'avion') {
        if (!isNpfTraitAvionVersFeu()) return null;
        depart = getNpfTraitsFeuAvionLatLng();
    } else {
        const oaci = getNpfTraitFeuOaci(trait);
        if (!oaci || !getNpfTraitsFeuPelicAffiches().includes(oaci)) return null;
        const ap = getAirportByOaci(oaci);
        depart = ap ? { lat: Number(ap.lat), lon: Number(ap.lon) } : null;
    }
    if (!depart || !Number.isFinite(depart.lat) || !Number.isFinite(depart.lon)) return null;
    return [depart, ...getNpfTraitsFeuWaypoints(trait).map(wp => ({ lat: wp.lat, lon: wp.lon, id: wp.id })), feu];
}

/* Branche au cap magnétique constant (src/200) ; la 1re branche du trait AVION part de l'avion. */
function getNpfTraitFeuBranche(trait, from, to, index) {
    return getNpfWaypointCourse(from.lat, from.lon, to.lat, to.lon, trait === 'avion' && index === 0);
}

/* Distance totale du trait MODIFIÉ (null en ligne droite : les calculs gardent alors la ligne droite). */
function getNpfTraitFeuDistanceNm(trait) {
    if (!getNpfTraitsFeuWaypoints(trait).length) return null;
    const points = getNpfTraitFeuPoints(trait);
    if (!points) return null;
    let total = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
        const c = getNpfTraitFeuBranche(trait, points[i], points[i + 1], i);
        if (!c || !Number.isFinite(c.distanceNm)) return null;
        total += c.distanceNm;
    }
    return total;
}

/* Trait PÉLIC -> FEU modifié : géométrie et distance pour la route PÉLIC (src/150 drawRoute). */
function getNpfTraitFeuRoutePelic(oaci) {
    const trait = `pelic:${String(oaci || '').toUpperCase()}`;
    if (!getNpfTraitsFeuWaypoints(trait).length) return null;
    const points = getNpfTraitFeuPoints(trait);
    if (!points) return null;
    const latlngs = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
        const c = getNpfTraitFeuBranche(trait, points[i], points[i + 1], i);
        total += c ? c.distanceNm : calculateDistanceInNm(points[i].lat, points[i].lon, points[i + 1].lat, points[i + 1].lon);
        const seg = c && Array.isArray(c.latlngs) ? c.latlngs : [[points[i].lat, points[i].lon], [points[i + 1].lat, points[i + 1].lon]];
        latlngs.push(...(i ? seg.slice(1) : seg));
    }
    return { latlngs, distanceNm: total };
}

/* Trait AVION -> FEU modifié : 1er WP (cible du trait rouge en direct) et reste fixe jusqu'au feu. */
function getNpfTraitFeuAvionPremierWp() {
    if (!isNpfTraitAvionVersFeu()) return null;
    const wps = getNpfTraitsFeuWaypoints('avion');
    if (!wps.length) return null;
    const feu = getNpfTraitsFeuFeu();
    const points = [...wps, feu];
    let reste = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
        const c = getNpfTraitFeuBranche('avion', points[i], points[i + 1], i + 1);
        reste += c ? c.distanceNm : 0;
    }
    return { lat: wps[0].lat, lon: wps[0].lon, resteNm: reste };
}

/* ---------- dessin : branches fixes du trait AVION, étiquettes cap / distance, losanges WP ---------- */
function ensureNpfTraitsFeuLayers() {
    if (typeof map === 'undefined' || !map || typeof L === 'undefined') return false;
    if (typeof ensureNpfWaypointRouteLayers === 'function') ensureNpfWaypointRouteLayers();   // panes WP (src/200)
    if (!npfTraitsFeuLayer) npfTraitsFeuLayer = L.layerGroup();
    if (!npfTraitsFeuLabelLayer) npfTraitsFeuLabelLayer = L.layerGroup();
    if (!map.hasLayer(npfTraitsFeuLayer)) npfTraitsFeuLayer.addTo(map);
    if (!map.hasLayer(npfTraitsFeuLabelLayer)) npfTraitsFeuLabelLayer.addTo(map);
    return true;
}

function buildNpfTraitsFeuIcon(index) {
    return L.divIcon({
        className: 'npf-waypoint-marker npf-trait-feu-marker',
        html: `<span class="npf-waypoint-diamond"><span class="npf-waypoint-diamond-label">WP${index + 1}</span></span>`,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
        popupAnchor: [0, -24]
    });
}

function buildNpfTraitsFeuPopupHtml(trait, wp, index) {
    const id = String(wp.id).replace(/[^A-Za-z0-9_-]/g, '');
    const t = String(trait).replace(/[^A-Za-z0-9:]/g, '');
    return `
        <div class="npf-waypoint-popup npf-trait-feu-popup">
            <div class="npf-waypoint-popup-title">WP${index + 1} — ${escapeHtml(getNpfTraitFeuLibelle(trait))}</div>
            <div class="npf-waypoint-popup-actions">
                <button type="button" class="npf-waypoint-action npf-waypoint-move" onclick="window.npfTraitFeuMove('${t}', '${id}')">Déplacer</button>
                <button type="button" class="npf-waypoint-action npf-waypoint-delete" onclick="window.npfTraitFeuDelete('${t}', '${id}')">Supprimer</button>
                <button type="button" class="npf-waypoint-action npf-trait-feu-ligne-droite" onclick="window.npfTraitFeuLigneDroite('${t}')">Remettre en ligne droite</button>
            </div>
        </div>`;
}

function drawNpfTraitsFeuLabels() {
    if (!ensureNpfTraitsFeuLayers()) return;
    npfTraitsFeuLabelLayer.clearLayers();
    getNpfTraitsFeuTraitsAffiches().forEach(trait => {
        if (!getNpfTraitsFeuWaypoints(trait).length) return;
        const points = getNpfTraitFeuPoints(trait);
        if (!points) return;
        /* AVION : la 1re branche (en direct) est étiquetée par le trait rouge (src/260) ; ici les branches fixes. */
        for (let i = trait === 'avion' ? 1 : 0; i < points.length - 1; i += 1) {
            const label = buildNpfWaypointSegmentLabel(points[i], points[i + 1]);
            if (!label) continue;
            L.tooltip({ pane: 'npfWaypointLabelPane', permanent: true, direction: 'center', className: `npf-waypoint-segment-tooltip npf-trait-feu-segment ${label.zoomClass}`, opacity: 1, interactive: false })
                .setLatLng(getNpfWaypointSegmentLabelLatLng(points[i], points[i + 1], label.metrics))
                .setContent(label.text)
                .addTo(npfTraitsFeuLabelLayer);
        }
    });
}

function drawNpfTraitsFeu() {
    if (!ensureNpfTraitsFeuLayers()) return;
    npfTraitsFeuLayer.clearLayers();
    npfTraitsFeuMarkers = new Map();
    getNpfTraitsFeuTraitsAffiches().forEach(trait => {
        const wps = getNpfTraitsFeuWaypoints(trait);
        if (!wps.length) return;
        const points = getNpfTraitFeuPoints(trait);
        if (!points) return;
        if (trait === 'avion') {
            /* branches fixes WP1 -> ... -> FEU, même dessin que le trait rouge avion -> feu */
            const fixes = points.slice(1).map(p => [p.lat, p.lon]);
            L.polyline(fixes, { color: '#ffffff', weight: 9, opacity: 0.95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(npfTraitsFeuLayer);
            L.polyline(fixes, { color: 'var(--secondary-color)', weight: 5, opacity: 1, dashArray: '5, 10', interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(npfTraitsFeuLayer);
        }
        wps.forEach((wp, index) => {
            const marker = L.marker([wp.lat, wp.lon], { pane: 'npfWaypointMarkerPane', icon: buildNpfTraitsFeuIcon(index), zIndexOffset: 3100, keyboard: false, draggable: false });
            marker.bindPopup(buildNpfTraitsFeuPopupHtml(trait, wp, index), { maxWidth: 390, closeButton: true });
            marker._npfTraitFeu = { trait, id: wp.id };
            marker.addTo(npfTraitsFeuLayer);
            npfTraitsFeuMarkers.set(wp.id, marker);
        });
    });
    drawNpfTraitsFeuLabels();
}

/* Après un changement de WP : routes du feu, trait rouge, calculs, WP. */
function refreshNpfTraitsFeuApresChangement() {
    persistNpfTraitsFeu();
    if (typeof currentCommune !== 'undefined' && currentCommune) displayCommuneDetails(currentCommune, false);
    try { drawUserToTargetRoute(); } catch (_) {}
    drawNpfTraitsFeu();
}

/* ---------- gestes (mêmes que la route WP du mode navigation) ---------- */
function getNpfTraitFeuSegmentAtLatLng(latlng, tolerancePx = NPF_WAYPOINT_ROUTE_LONG_PRESS_TOLERANCE_PX) {
    if (!map || !latlng) return null;
    let p;
    try { p = map.latLngToContainerPoint(latlng); } catch (_) { return null; }
    let best = null;
    getNpfTraitsFeuTraitsAffiches().forEach(trait => {
        const points = getNpfTraitFeuPoints(trait);
        if (!points) return;
        for (let i = 0; i < points.length - 1; i += 1) {
            let a;
            let b;
            try {
                a = map.latLngToContainerPoint([points[i].lat, points[i].lon]);
                b = map.latLngToContainerPoint([points[i + 1].lat, points[i + 1].lon]);
            } catch (_) { continue; }
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const len2 = vx * vx + vy * vy;
            if (!Number.isFinite(len2) || len2 < 25) continue;
            const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
            if (t <= 0.05 || t >= 0.95) continue;   // « entre 2 points », comme src/200
            const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
            if (!Number.isFinite(d) || d > tolerancePx) continue;
            if (!best || d < best.distancePx) best = { trait, insertIndex: i, distancePx: d };
        }
    });
    return best;
}

function openNpfTraitFeuPopupNearLatLng(latlng, tolerancePx = NPF_WAYPOINT_SELECT_TOLERANCE_PX) {
    if (!map || !latlng || !npfTraitsFeuMarkers.size) return false;
    let p;
    try { p = map.latLngToContainerPoint(latlng); } catch (_) { return false; }
    let best = null;
    npfTraitsFeuMarkers.forEach(marker => {
        try {
            const d = map.latLngToContainerPoint(marker.getLatLng()).distanceTo(p);
            if (d <= tolerancePx && (!best || d < best.d)) best = { marker, d };
        } catch (_) {}
    });
    if (!best) return false;
    best.marker.openPopup();
    return true;
}

/* Exécuter fn APRÈS la fin du toucher en cours : le trait PÉLIC touché est une route interactive (src/150) ; la
 * redessiner pendant que le doigt est posé retirerait l'élément touché, Leaflet ne recevrait jamais la fin du toucher et
 * le glisser suivant déplacerait la carte au lieu de la poignée. */
function runNpfTraitsFeuApresToucher(fn) {
    let fait = false;
    const evenements = ['touchend', 'touchcancel', 'pointerup', 'mouseup'];
    const lancer = () => {
        if (fait) return;
        fait = true;
        evenements.forEach(type => document.removeEventListener(type, lancer, true));
        setTimeout(fn, 0);
    };
    evenements.forEach(type => document.addEventListener(type, lancer, true));
    setTimeout(lancer, 4000);
}

/* Appui long (src/320), après la route WP du mode navigation : sur un WP -> sa fiche ; près d'un trait -> nouveau WP. */
function handleNpfTraitFeuLongPress(latlng) {
    if (openNpfTraitFeuPopupNearLatLng(latlng)) return true;
    const seg = getNpfTraitFeuSegmentAtLatLng(latlng);
    if (!seg) return false;
    const lat = Number(latlng.lat);
    const lon = Number(latlng.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    syncNpfTraitsFeuPourFeu(currentCommune);
    const wp = { id: `tf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, lat, lon };
    getNpfTraitsFeuListe(seg.trait, true).splice(seg.insertIndex, 0, wp);
    persistNpfTraitsFeu();
    /* comme src/200 : le WP passe aussitôt en « Déplacer » ; routes et calculs redessinés à la fin du toucher */
    requestAnimationFrame(() => startNpfTraitFeuMove(seg.trait, wp.id));
    runNpfTraitsFeuApresToucher(() => { if (npfTraitsFeuMoveHandle) return; refreshNpfTraitsFeuApresChangement(); });
    return true;
}

function deleteNpfTraitFeuWaypoint(trait, id) {
    const list = getNpfTraitsFeuListe(trait);
    const index = list.findIndex(wp => wp.id === id);
    if (index < 0) return false;
    list.splice(index, 1);
    try { map?.closePopup?.(); } catch (_) {}
    refreshNpfTraitsFeuApresChangement();
    return true;
}

function resetNpfTraitFeuLigneDroite(trait) {
    if (trait === 'avion') npfTraitsFeuState.avion = [];
    else { const oaci = getNpfTraitFeuOaci(trait); if (oaci) delete npfTraitsFeuState.pelic[oaci]; }
    try { map?.closePopup?.(); } catch (_) {}
    refreshNpfTraitsFeuApresChangement();
    return true;
}

function clearNpfTraitsFeuMoveOutside() {
    if (!npfTraitsFeuMoveOutsideHandler) return;
    try { document.removeEventListener('pointerdown', npfTraitsFeuMoveOutsideHandler, true); } catch (_) {}
    npfTraitsFeuMoveOutsideHandler = null;
}

/* « Déplacer » : même poignée tactile de 76 px que src/200 (startNpfWaypointMove) ; un appui ailleurs annule. */
function startNpfTraitFeuMove(trait, id) {
    const list = getNpfTraitsFeuListe(trait);
    const index = list.findIndex(wp => wp.id === id);
    const wp = list[index];
    if (!wp || !map || typeof L === 'undefined' || !ensureNpfTraitsFeuLayers()) return false;
    try { map.closePopup?.(); } catch (_) {}
    if (npfTraitsFeuMoveHandle) { try { npfTraitsFeuMoveHandle.remove(); } catch (_) {} npfTraitsFeuMoveHandle = null; }
    clearNpfTraitsFeuMoveOutside();
    const handle = L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({ className: 'npf-waypoint-move-handle', html: `<span class="npf-waypoint-move-handle-ring"><span>WP${index + 1}</span></span>`, iconSize: [76, 76], iconAnchor: [38, 38] }),
        pane: map.getPane('npfWaypointMovePane') ? 'npfWaypointMovePane' : 'markerPane',
        zIndexOffset: 20000, keyboard: false, draggable: true, autoPan: true, autoPanPadding: [60, 60], autoPanSpeed: 10
    }).addTo(map);
    npfTraitsFeuMoveHandle = handle;
    let apercu = null;
    const syncPosition = latlng => {
        if (!latlng) return;
        wp.lat = Number(latlng.lat);
        wp.lon = Number(latlng.lng);
        const marker = npfTraitsFeuMarkers.get(id);
        try { marker?.setLatLng(latlng); } catch (_) {}
        const points = getNpfTraitFeuPoints(trait);
        if (!points) return;
        try { apercu?.remove(); } catch (_) {}
        apercu = L.polyline(points.map(p => [p.lat, p.lon]), { color: '#1d4ed8', weight: 4, opacity: 0.9, dashArray: '6 6', interactive: false }).addTo(npfTraitsFeuLayer);
        drawNpfTraitsFeuLabels();
    };
    const finish = () => {
        clearNpfTraitsFeuMoveOutside();
        syncPosition(handle.getLatLng());
        try { handle.remove(); } catch (_) {}
        if (npfTraitsFeuMoveHandle === handle) npfTraitsFeuMoveHandle = null;
        refreshNpfTraitsFeuApresChangement();
    };
    handle.on('drag', event => syncPosition(event.target.getLatLng()));
    handle.once('dragend', finish);
    window.setTimeout(() => {
        if (npfTraitsFeuMoveHandle !== handle) return;
        npfTraitsFeuMoveOutsideHandler = event => {
            const target = event?.target;
            if (target instanceof Element && target.closest('.npf-waypoint-move-handle')) return;
            clearNpfTraitsFeuMoveOutside();
            try { handle.remove(); } catch (_) {}
            if (npfTraitsFeuMoveHandle === handle) npfTraitsFeuMoveHandle = null;
            /* ce toucher peut viser une route PÉLIC (appui long suivant) : redessin à la fin du toucher */
            runNpfTraitsFeuApresToucher(() => { if (!npfTraitsFeuMoveHandle) refreshNpfTraitsFeuApresChangement(); });
        };
        document.addEventListener('pointerdown', npfTraitsFeuMoveOutsideHandler, true);
    }, 0);
    try {
        handle.bindTooltip('Déplacer le WP puis relâcher', { permanent: false, direction: 'top', className: 'npf-waypoint-move-hint', offset: [0, -32] }).openTooltip();
        setTimeout(() => { try { handle.closeTooltip(); } catch (_) {} }, 1800);
    } catch (_) {}
    return true;
}

restoreNpfTraitsFeu();
/* La carte est créée après le chargement du script : on attend qu'elle existe (comme les WP perso, src/216). */
(function attendreCarteTraitsFeu(essai = 0) {
    if (typeof map !== 'undefined' && map && typeof map.whenReady === 'function') {
        map.whenReady(() => {
            if (!ensureNpfTraitsFeuLayers()) return;
            map.on('zoomend', drawNpfTraitsFeuLabels);
            drawNpfTraitsFeu();
        });
        return;
    }
    if (essai < 240) setTimeout(() => attendreCarteTraitsFeu(essai + 1), 500);
})();

window.npfTraitFeuMove = startNpfTraitFeuMove;
window.npfTraitFeuDelete = deleteNpfTraitFeuWaypoint;
window.npfTraitFeuLigneDroite = resetNpfTraitFeuLigneDroite;
