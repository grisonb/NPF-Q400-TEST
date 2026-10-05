/* ==========================================================================
   v16.09 — ROUTE PAR WAYPOINTS (WP)
   --------------------------------------------------------------------------
   - Ajout depuis aéroport / PÉLIC / VRP / appui long carte.
   - Premier WP = GoTo actif automatiquement.
   - Acquisition WP actif à 1 NM, passage automatique au suivant uniquement
     lorsque le GoTo route est actif.
   - Route, ordre, WP actif et état GoTo persistants.
   ========================================================================== */

const NPF_WAYPOINT_ROUTE_STORAGE_KEY = 'npfWaypointRouteV1';
const NPF_WAYPOINT_CAPTURE_RADIUS_NM = 1;
let npfWaypointRouteState = {
    version: 'npfWaypointRouteV1',
    waypoints: [],
    origin: null,
    originPending: false,
    activeId: null,
    gotoActive: false,
    updatedAt: ''
};
let npfWaypointLineLayer = null;
let npfWaypointMarkerLayer = null;
let npfWaypointLabelLayer = null;
let npfWaypointMarkerRegistry = new Map();
let npfWaypointMoveHandle = null;
let npfWaypointMoveOutsidePointerHandler = null;
let npfWaypointSearchOverlayState = null;
let npfWaypointZoomListenerInstalled = false;

/*
 * v16.12 — interaction tactile et "snap" des WP.
 *
 * - La sélection d'un WP doit rester prioritaire sur les grandes hitbox
 *   aéroport / VRP uniquement dans la zone réellement occupée par le losange.
 * - Lors d'un déplacement, un relâchement à proximité immédiate d'un
 *   aéroport/PÉLIC ou d'un VRP recale exactement le WP sur le point source.
 */
const NPF_WAYPOINT_SELECT_TOLERANCE_PX = 30;
const NPF_WAYPOINT_SELECT_FALLBACK_NM = 0.08;
const NPF_WAYPOINT_SNAP_MAX_DISTANCE_NM = 0.20;
const NPF_WAYPOINT_SNAP_MAX_DISTANCE_PX = 36;

function getNpfWaypointNearLatLng(latlng, tolerancePx = NPF_WAYPOINT_SELECT_TOLERANCE_PX) {
    if (!latlng || !npfWaypointRouteState?.waypoints?.length) return null;

    let pressPoint = null;
    try {
        if (map?.latLngToContainerPoint) pressPoint = map.latLngToContainerPoint(latlng);
    } catch (_) {
        pressPoint = null;
    }

    let best = null;
    for (const wp of npfWaypointRouteState.waypoints) {
        let distancePx = Infinity;
        if (pressPoint && map?.latLngToContainerPoint) {
            try {
                const wpPoint = map.latLngToContainerPoint([Number(wp.lat), Number(wp.lon)]);
                distancePx = wpPoint.distanceTo(pressPoint);
            } catch (_) {}
        }

        const distanceNm = calculateDistanceInNm(
            Number(latlng.lat),
            Number(latlng.lng),
            Number(wp.lat),
            Number(wp.lon)
        );

        const hitByPixel = Number.isFinite(distancePx) && distancePx <= Number(tolerancePx);
        const hitByFallback = !Number.isFinite(distancePx)
            && Number.isFinite(distanceNm)
            && distanceNm <= NPF_WAYPOINT_SELECT_FALLBACK_NM;
        if (!hitByPixel && !hitByFallback) continue;

        const score = Number.isFinite(distancePx) ? distancePx : distanceNm * 1000;
        if (!best || score < best.score) best = { wp, score, distancePx, distanceNm };
    }
    return best?.wp || null;
}

function openNpfWaypointPopupNearLatLng(latlng, tolerancePx = NPF_WAYPOINT_SELECT_TOLERANCE_PX) {
    const wp = getNpfWaypointNearLatLng(latlng, tolerancePx);
    if (!wp) return false;

    const marker = npfWaypointMarkerRegistry.get(wp.id);
    if (!marker) return false;

    try { map?.closePopup?.(); } catch (_) {}
    try {
        const index = getNpfWaypointIndexById(wp.id);
        if (index >= 0) marker.setPopupContent(buildNpfWaypointPopupHtml(wp, index));
        marker.openPopup();
        return true;
    } catch (_) {
        return false;
    }
}

function getNpfWaypointSnapCandidate(latlng) {
    const lat = Number(latlng?.lat);
    const lon = Number(latlng?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    let releasePoint = null;
    try {
        if (map?.latLngToContainerPoint) releasePoint = map.latLngToContainerPoint([lat, lon]);
    } catch (_) {
        releasePoint = null;
    }

    const candidates = [];
    const airportSeen = new Set();

    [...pelicanAirports, ...otherAirports, ...(Array.isArray(additionalAerodromes) ? additionalAerodromes : [])]
        .forEach(airport => {
            const airportLat = Number(airport?.lat);
            const airportLon = Number(airport?.lon);
            const oaci = normalizeOaciCodeInput(airport?.oaci);
            if (!oaci || airportSeen.has(oaci) || !Number.isFinite(airportLat) || !Number.isFinite(airportLon)) return;
            airportSeen.add(oaci);
            candidates.push({
                lat: airportLat,
                lon: airportLon,
                name: `${oaci} — ${String(airport?.name || oaci).trim()}`,
                source: 'airport',
                sourceRef: oaci
            });
        });

    try {
        const points = Array.isArray(siaDataset?.points) ? siaDataset.points : [];
        points.forEach(item => {
            if (item?.k !== 'dpn:VRP') return;
            const vrpLat = Number(item?.x);
            const vrpLon = Number(item?.y);
            if (!Number.isFinite(vrpLat) || !Number.isFinite(vrpLon)) return;

            const code = String(item?.d || item?.c || '').trim();
            let airport = '';
            try { airport = String(getSiaVrpAirportCode(item) || '').trim().toUpperCase(); } catch (_) {}
            const title = airport ? `${code || 'VRP'}-${airport}` : (code || 'Point VFR');

            candidates.push({
                lat: vrpLat,
                lon: vrpLon,
                name: title,
                source: 'vfr',
                sourceRef: title
            });
        });
    } catch (_) {}

    let best = null;
    for (const candidate of candidates) {
        const distanceNm = calculateDistanceInNm(lat, lon, candidate.lat, candidate.lon);
        if (!Number.isFinite(distanceNm) || distanceNm > NPF_WAYPOINT_SNAP_MAX_DISTANCE_NM) continue;

        let distancePx = 0;
        if (releasePoint && map?.latLngToContainerPoint) {
            try {
                const candidatePoint = map.latLngToContainerPoint([candidate.lat, candidate.lon]);
                distancePx = candidatePoint.distanceTo(releasePoint);
            } catch (_) {
                distancePx = 0;
            }
            if (Number.isFinite(distancePx) && distancePx > NPF_WAYPOINT_SNAP_MAX_DISTANCE_PX) continue;
        }

        if (!best || distanceNm < best.distanceNm) {
            best = { ...candidate, distanceNm, distancePx };
        }
    }
    return best;
}

function ensureNpfWaypointRouteLayers() {
    if (!map || typeof L === 'undefined') return false;

    /*
     * Restauration route WP : panes dédiés et stables.
     * Les couches SIA/VFR et leurs hitbox sont ajoutées progressivement au
     * démarrage. Les traits et losanges WP ne doivent donc pas dépendre de
     * l'ordre de création des panes Leaflet génériques.
     */
    const ensureWaypointPane = (name, zIndex, pointerEvents) => {
        if (!map.createPane) return null;
        let pane = map.getPane(name);
        if (!pane) pane = map.createPane(name);
        if (pane) {
            pane.style.zIndex = String(zIndex);
            pane.style.pointerEvents = pointerEvents;
        }
        return pane;
    };

    ensureWaypointPane('npfWaypointLinePane', 548, 'none');
    /*
     * v16.96 — le pointillé rouge Avion -> WP actif doit rester visible au-dessus
     * du trait plein de route, tout en restant sous les étiquettes.
     */
    ensureWaypointPane('npfWaypointGotoPane', 549, 'none');
    ensureWaypointPane('npfWaypointLabelPane', 550, 'none');
    ensureWaypointPane('npfWaypointMarkerPane', 670, 'auto');
    ensureWaypointPane('npfWaypointMovePane', 699, 'auto');

    if (!npfWaypointLineLayer) npfWaypointLineLayer = L.layerGroup();
    if (!npfWaypointLabelLayer) npfWaypointLabelLayer = L.layerGroup();
    if (!npfWaypointMarkerLayer) npfWaypointMarkerLayer = L.layerGroup();

    /*
     * Ne pas supposer qu'un LayerGroup existant est encore attaché à la carte.
     * Cette vérification rend la restauration idempotente après réouverture,
     * changement de fond ou reconstruction progressive des couches.
     */
    if (!map.hasLayer(npfWaypointLineLayer)) npfWaypointLineLayer.addTo(map);
    if (!map.hasLayer(npfWaypointLabelLayer)) npfWaypointLabelLayer.addTo(map);
    if (!map.hasLayer(npfWaypointMarkerLayer)) npfWaypointMarkerLayer.addTo(map);

    if (!npfWaypointZoomListenerInstalled) {
        map.on('zoomend', updateNpfWaypointSegmentLabels);
        npfWaypointZoomListenerInstalled = true;
    }
    return true;
}

function normalizeNpfWaypointRouteState(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const waypoints = (Array.isArray(input.waypoints) ? input.waypoints : [])
        .map((wp, index) => {
            const lat = Number(wp?.lat);
            const lon = Number(wp?.lon ?? wp?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            let id = String(wp?.id || '').trim();
            if (!id || seen.has(id)) id = `wp-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
            seen.add(id);
            return {
                id,
                lat,
                lon,
                name: String(wp?.name || `WP ${index + 1}`).trim() || `WP ${index + 1}`,
                source: String(wp?.source || 'map').trim() || 'map',
                sourceRef: String(wp?.sourceRef || '').trim()
            };
        })
        .filter(Boolean);

    const rawOrigin = input?.origin && typeof input.origin === 'object'
        ? input.origin
        : null;
    const originLat = Number(rawOrigin?.lat);
    const originLon = Number(rawOrigin?.lon ?? rawOrigin?.lng);
    const origin = (
        waypoints.length
        && Number.isFinite(originLat)
        && Number.isFinite(originLon)
    )
        ? {
            lat: originLat,
            lon: originLon,
            createdAt: String(rawOrigin?.createdAt || '')
        }
        : null;

    let activeId = String(input.activeId || '').trim() || null;
    if (!waypoints.some(wp => wp.id === activeId)) activeId = waypoints[0]?.id || null;

    return {
        version: 'npfWaypointRouteV1',
        waypoints,
        origin,
        originPending: Boolean(
            waypoints.length
            && !origin
            && input.originPending === true
        ),
        activeId,
        gotoActive: Boolean(input.gotoActive && activeId && waypoints.length),
        updatedAt: String(input.updatedAt || '')
    };
}

function restoreNpfWaypointRouteState() {
    try {
        const raw = localStorage.getItem(NPF_WAYPOINT_ROUTE_STORAGE_KEY);
        npfWaypointRouteState = normalizeNpfWaypointRouteState(raw ? JSON.parse(raw) : null);
    } catch (error) {
        console.warn('NPF route WP : restauration impossible.', error);
        npfWaypointRouteState = normalizeNpfWaypointRouteState(null);
    }
}

function persistNpfWaypointRouteState() {
    npfWaypointRouteState.updatedAt = new Date().toISOString();
    try {
        localStorage.setItem(NPF_WAYPOINT_ROUTE_STORAGE_KEY, JSON.stringify(npfWaypointRouteState));
    } catch (error) {
        console.warn('NPF route WP : sauvegarde impossible.', error);
    }
}

function getNpfWaypointIndexById(id) {
    return npfWaypointRouteState.waypoints.findIndex(wp => wp.id === id);
}

function getNpfWaypointById(id) {
    const index = getNpfWaypointIndexById(id);
    return index >= 0 ? npfWaypointRouteState.waypoints[index] : null;
}

function getNpfActiveWaypoint() {
    return getNpfWaypointById(npfWaypointRouteState.activeId);
}

function isNpfWaypointGotoActive() {
    return Boolean(
        npfWaypointRouteState.gotoActive
        && npfWaypointRouteState.waypoints.length
        && getNpfActiveWaypoint()
    );
}

function getNpfWaypointDisplayNumber(id) {
    const index = getNpfWaypointIndexById(id);
    return index >= 0 ? index + 1 : 0;
}

function normalizeNpfWaypointSourceRef(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function findNpfWaypointForSource({ source = '', sourceRef = '', lat = NaN, lon = NaN } = {}) {
    const wantedSource = String(source || '').trim().toLowerCase();
    const wantedRef = normalizeNpfWaypointSourceRef(sourceRef);
    const targetLat = Number(lat);
    const targetLon = Number(lon);

    return npfWaypointRouteState.waypoints.find(wp => {
        const wpSource = String(wp?.source || '').trim().toLowerCase();
        if (wantedSource && wpSource && wpSource !== wantedSource) return false;

        const wpRef = normalizeNpfWaypointSourceRef(wp?.sourceRef);
        const wpName = normalizeNpfWaypointSourceRef(wp?.name);
        if (wantedRef) {
            if (wpRef && wpRef === wantedRef) return true;
            if (wantedSource === 'vfr' && wpName === wantedRef) return true;
            if (wantedSource === 'airport' && (wpName === wantedRef || wpName.startsWith(`${wantedRef} —`) || wpName.startsWith(`${wantedRef} -`))) return true;
        }

        if (Number.isFinite(targetLat) && Number.isFinite(targetLon)) {
            const distance = calculateDistanceInNm(targetLat, targetLon, Number(wp?.lat), Number(wp?.lon));
            if (Number.isFinite(distance) && distance <= 0.05) return true;
        }
        return false;
    }) || null;
}

function getNpfWaypointForAirport(oaci) {
    const safeOaci = normalizeOaciCodeInput(oaci);
    if (!safeOaci) return null;
    const airport = getNpfAirportForWaypoint(safeOaci);
    return findNpfWaypointForSource({
        source: 'airport',
        sourceRef: safeOaci,
        lat: Number(airport?.lat),
        lon: Number(airport?.lon)
    });
}

function getNpfWaypointForVfr(name, lat, lon) {
    return findNpfWaypointForSource({
        source: 'vfr',
        sourceRef: name,
        lat: Number(lat),
        lon: Number(lon)
    });
}

function formatNpfWaypointDistanceNm(distanceNm) {
    if (!Number.isFinite(Number(distanceNm))) return '-- Nm';
    const value = Number(distanceNm);
    return `${value < 100 ? value.toFixed(1) : Math.round(value)} Nm`;
}

function getNpfWaypointMagneticBearing(fromLat, fromLon, toLat, toLon) {
    const trueBearing = calculateBearing(fromLat, fromLon, toLat, toLon);
    return (trueBearing - MAGNETIC_DECLINATION + 360) % 360;
}

function isNpfWaypointSourceLinked(wp) {
    const source = String(wp?.source || '').trim().toLowerCase();
    return source === 'airport' || source === 'vfr';
}

function buildNpfWaypointIcon(wp, index) {
    const active = wp?.id === npfWaypointRouteState.activeId;
    const sourceLinked = isNpfWaypointSourceLinked(wp);
    const label = `WP${index + 1}`;
    const markerClass = [
        'npf-waypoint-marker',
        active ? 'npf-waypoint-marker-active' : '',
        sourceLinked ? 'npf-waypoint-marker-source' : ''
    ].filter(Boolean).join(' ');
    const diamondClass = `npf-waypoint-diamond${sourceLinked ? ' npf-waypoint-diamond-source' : ''}`;

    return L.divIcon({
        className: markerClass,
        html: `<span class="${diamondClass}"><span class="npf-waypoint-diamond-label">${label}</span></span>`,
        iconSize: sourceLinked ? [52, 52] : [48, 48],
        iconAnchor: sourceLinked ? [26, 26] : [24, 24],
        popupAnchor: [0, sourceLinked ? -28 : -24]
    });
}

function buildNpfWaypointActionsHtml(wp) {
    const safeId = String(wp?.id || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!safeId) return '';
    return `
        <button type="button" class="npf-waypoint-action npf-waypoint-goto" onclick="window.npfWaypointGoto('${safeId}')">GoTo</button>
        <button type="button" class="npf-waypoint-action npf-waypoint-delete" onclick="window.npfWaypointDelete('${safeId}')">Supprimer</button>
        <button type="button" class="npf-waypoint-action npf-waypoint-edit" onclick="window.npfWaypointModify('${safeId}')">Modifier</button>
        <button type="button" class="npf-waypoint-action npf-waypoint-move" onclick="window.npfWaypointMove('${safeId}')">Déplacer</button>
        <button type="button" class="npf-waypoint-action npf-waypoint-delete-route" onclick="window.npfWaypointDeleteRoute()">Supp. Route</button>
    `;
}

function buildNpfWaypointPelicActionsHtml(wp) {
    const safeId = String(wp?.id || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!safeId) return '';

    /*
     * Fiche PÉLIC + WP : les actions de navigation/édition restent groupées,
     * puis les deux suppressions occupent ensemble la dernière ligne.
     * Le libellé « Supp. WP » évite toute ambiguïté avec « Supp. Route ».
     */
    return `
        <div class="npf-waypoint-popup-actions npf-source-waypoint-actions npf-pelic-waypoint-actions">
            <button type="button" class="npf-waypoint-action npf-waypoint-goto" onclick="window.npfWaypointGoto('${safeId}')">GoTo</button>
            <button type="button" class="npf-waypoint-action npf-waypoint-edit" onclick="window.npfWaypointModify('${safeId}')">Modifier</button>
            <button type="button" class="npf-waypoint-action npf-waypoint-move" onclick="window.npfWaypointMove('${safeId}')">Déplacer</button>
            <button type="button" class="npf-waypoint-action npf-waypoint-delete" onclick="window.npfWaypointDelete('${safeId}')">Supp. WP</button>
            <button type="button" class="npf-waypoint-action npf-waypoint-delete-route" onclick="window.npfWaypointDeleteRoute()">Supp. Route</button>
        </div>
    `;
}

function buildNpfWaypointPelicPopupHtml(wp) {
    if (String(wp?.source || '').trim() !== 'airport') return '';

    const oaci = normalizeOaciCodeInput(wp?.sourceRef);
    if (!oaci || typeof isSelectablePelicanAirport !== 'function' || !isSelectablePelicanAirport(oaci)) return '';

    const airport = getNpfAirportForWaypoint(oaci);
    if (!airport) return '';

    const isDisabled = disabledAirports.has(oaci);
    const isWater = waterAirports.has(oaci);
    const isBase = selectedBaseOACI === oaci;
    const isCustomPelic = customPelicanAirports.has(oaci)
        && !pelicanAirports.some(ap => normalizeOaciCodeInput(ap?.oaci) === oaci);

    const waterButtonText = isWater ? 'RETARDANT' : 'EAU';
    const waterButtonClass = isWater ? 'water-btn water-btn-retardant' : 'water-btn';
    const disableButtonText = isDisabled ? 'Activer' : 'Désactiver';
    const disableButtonClass = isDisabled ? 'enable-btn' : 'disable-btn';
    const baseButtonText = isBase ? 'BASE ✓' : 'BASE';
    const baseButtonClass = isBase ? 'base-btn base-btn-active' : 'base-btn';
    const customPelicButton = isCustomPelic
        ? `<button class="base-btn base-btn-active" onclick="window.toggleCustomPelican('${oaci}')">PÉLIC ✓</button>`
        : '';

    /*
     * Un WP posé exactement sur un PÉLIC conserve la fiche opérationnelle
     * complète du PÉLIC. buildAirportAddWpButtonHtml() détecte le WP existant
     * et insère ses actions Route dans cette même fiche. buildAirportGoToButtonHtml()
     * masque de son côté le Go To aéroport indépendant : un seul GoTo reste visible.
     */
    return `<div class="airport-popup"><b>${escapeHtml(oaci)}</b><br>${escapeHtml(String(airport.name || oaci))}<div class="popup-buttons"><button class="${waterButtonClass}" onclick="window.toggleWater('${oaci}')">${waterButtonText}</button><button class="${disableButtonClass}" onclick="window.toggleAirport('${oaci}')">${disableButtonText}</button><button class="${baseButtonClass}" onclick="window.setBaseAirport('${oaci}')">${baseButtonText}</button>${customPelicButton}</div>${buildPelicPdfButtonsHtml(oaci)}${buildVacButtonHtml(oaci)}${buildPelicNotamsButtonHtml(oaci)}${buildAirportGoToButtonHtml(oaci)}${buildNpfWaypointPelicActionsHtml(wp)}</div>`;
}

/* v17.29 — WP posé sur un terrain couvert par les NOTAM : bouton NOTAMS. */
function buildNpfWaypointNotamsButtonHtml(wp) {
    if (String(wp?.source || '').trim() !== 'airport') return '';
    return buildNpfNotamsButtonHtmlIfCovered(normalizeOaciCodeInput(wp?.sourceRef));
}

function buildNpfWaypointPopupHtml(wp, index) {
    const pelicPopupHtml = buildNpfWaypointPelicPopupHtml(wp);
    if (pelicPopupHtml) return pelicPopupHtml;

    const number = index + 1;
    const active = wp?.id === npfWaypointRouteState.activeId;
    const safeName = escapeHtml(String(wp?.name || `WP ${number}`));
    return `
        <div class="npf-waypoint-popup">
            <div class="npf-waypoint-popup-title">WP${number}${active ? ' — ACTIF' : ''}</div>
            <div class="npf-waypoint-popup-name">${safeName}</div>
            <div class="npf-waypoint-popup-actions">
                ${buildNpfWaypointActionsHtml(wp)}
            </div>
            ${buildNpfWaypointNotamsButtonHtml(wp)}
        </div>
    `;
}

/*
 * v16.95 — origine FIXE de la route WP.
 * Elle est enregistrée une seule fois à la création de WP1 (ou au premier fix
 * qui suit si aucun GPS valide n'était disponible à cet instant).
 */
function getNpfWaypointRouteOrigin() {
    const origin = npfWaypointRouteState?.origin;
    const lat = Number(origin?.lat);
    const lon = Number(origin?.lon ?? origin?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
        id: '__npf-route-origin__',
        lat,
        lon,
        name: 'Départ',
        source: 'route-origin',
        sourceRef: '',
        isRouteOrigin: true
    };
}

function getNpfWaypointRoutePathPoints() {
    const waypoints = Array.isArray(npfWaypointRouteState?.waypoints)
        ? npfWaypointRouteState.waypoints
        : [];
    const origin = getNpfWaypointRouteOrigin();
    return origin ? [origin, ...waypoints] : [...waypoints];
}

function setNpfWaypointRouteOriginFromLatLng(latlng, { persist = true } = {}) {
    const lat = Number(latlng?.lat);
    const lon = Number(latlng?.lng ?? latlng?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

    npfWaypointRouteState.origin = {
        lat,
        lon,
        createdAt: new Date().toISOString()
    };
    npfWaypointRouteState.originPending = false;

    if (persist) persistNpfWaypointRouteState();
    return true;
}

function drawNpfWaypointRouteLines() {
    if (!ensureNpfWaypointRouteLayers()) return;
    npfWaypointLineLayer.clearLayers();
    const waypoints = npfWaypointRouteState.waypoints;
    if (!waypoints.length) return;

    const routePoints = getNpfWaypointRoutePathPoints();
    for (let i = 0; i < routePoints.length - 1; i += 1) {
        const from = routePoints[i];
        const to = routePoints[i + 1];
        const latlngs = buildNpfGreatCircleLatLngs(
            [from.lat, from.lon],
            [to.lat, to.lon]
        );
        L.polyline(latlngs, {
            pane: 'npfWaypointLinePane',
            color: '#ffffff',
            weight: 8,
            opacity: .95,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(npfWaypointLineLayer);
        L.polyline(latlngs, {
            pane: 'npfWaypointLinePane',
            color: '#1d4ed8',
            weight: 4,
            opacity: 1,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(npfWaypointLineLayer);
    }

    const active = getNpfActiveWaypoint();
    if (active && isNpfWaypointGotoActive()) {
        L.circle([active.lat, active.lon], {
            pane: 'npfWaypointLinePane',
            radius: NPF_WAYPOINT_CAPTURE_RADIUS_NM * 1852,
            color: '#16a34a',
            weight: 2,
            opacity: .95,
            fillColor: '#22c55e',
            fillOpacity: .06,
            dashArray: '7 7',
            interactive: false
        }).addTo(npfWaypointLineLayer);
    }
}

function getNpfWaypointSegmentScreenMetrics(from, to) {
    if (!map || !from || !to) return null;
    try {
        const a = map.latLngToLayerPoint([from.lat, from.lon]);
        const b = map.latLngToLayerPoint([to.lat, to.lon]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 1) return null;
        return {
            a,
            b,
            dx,
            dy,
            length,
            ux: dx / length,
            uy: dy / length
        };
    } catch (_) {
        return null;
    }
}

function getNpfWaypointSegmentZoomClass() {
    const zoom = Number(map?.getZoom?.());
    if (!Number.isFinite(zoom)) return 'npf-waypoint-segment-zoom-medium';
    if (zoom <= 7) return 'npf-waypoint-segment-zoom-very-low';
    if (zoom <= 9) return 'npf-waypoint-segment-zoom-low';
    if (zoom <= 11) return 'npf-waypoint-segment-zoom-medium';
    return 'npf-waypoint-segment-zoom-high';
}

function buildNpfWaypointSegmentLabel(from, to) {
    const metrics = getNpfWaypointSegmentScreenMetrics(from, to);
    if (!metrics || metrics.length < 34) return null;

    const distance = calculateDistanceInNm(from.lat, from.lon, to.lat, to.lon);
    const magneticBearing = getNpfWaypointMagneticBearing(from.lat, from.lon, to.lat, to.lon);
    const routeText = formatRouteDegrees(magneticBearing);
    const distanceText = formatNpfWaypointDistanceNm(distance);
    const timeText = formatGpsEtaMinutes(distance);

    /*
     * v16.11 — priorité demandée : Route, puis Distance, puis Temps.
     * Le nombre d'informations dépend de la longueur réellement disponible à
     * l'écran ; le zoom fait donc apparaître progressivement les compléments.
     */
    let text = routeText;
    if (metrics.length >= 86) text += ` / ${distanceText}`;
    if (metrics.length >= 144) text += ` / ${timeText}`;

    return {
        text,
        metrics,
        zoomClass: getNpfWaypointSegmentZoomClass()
    };
}

function getNpfWaypointSegmentLabelLatLng(from, to, metrics = null) {
    if (!map || !from || !to) return L.latLng(from?.lat || 0, from?.lon || 0);
    try {
        const m = metrics || getNpfWaypointSegmentScreenMetrics(from, to);
        if (!m) return L.latLng(from.lat, from.lon);

        const px = -m.uy;
        const py = m.ux;
        const zoom = Number(map.getZoom());
        const sideOffset = !Number.isFinite(zoom)
            ? 13
            : (zoom <= 7 ? 9 : zoom <= 9 ? 10 : zoom <= 11 ? 12 : 14);

        /*
         * La bulle reste CONTRE la route : centre au milieu du segment avec
         * seulement le décalage perpendiculaire nécessaire pour que son bord
         * ne masque pas le trait. On choisit le côté le plus proche du centre
         * de la carte afin de limiter les sorties d'écran.
         */
        const middle = L.point(m.a.x + m.dx * 0.5, m.a.y + m.dy * 0.5);
        const candidateA = L.point(middle.x + px * sideOffset, middle.y + py * sideOffset);
        const candidateB = L.point(middle.x - px * sideOffset, middle.y - py * sideOffset);
        const mapCenter = map.latLngToLayerPoint(map.getCenter());
        const chosen = candidateB.distanceTo(mapCenter) < candidateA.distanceTo(mapCenter)
            ? candidateB
            : candidateA;
        return map.layerPointToLatLng(chosen);
    } catch (_) {
        return getRouteTooltipLatLng([from.lat, from.lon], [to.lat, to.lon], 0.5);
    }
}

function updateNpfWaypointSegmentLabels() {
    if (!ensureNpfWaypointRouteLayers()) return;
    npfWaypointLabelLayer.clearLayers();
    const waypoints = npfWaypointRouteState.waypoints;
    if (!waypoints.length) return;

    const routePoints = getNpfWaypointRoutePathPoints();
    if (routePoints.length < 2) return;

    for (let i = 0; i < routePoints.length - 1; i += 1) {
        const from = routePoints[i];
        const to = routePoints[i + 1];
        const label = buildNpfWaypointSegmentLabel(from, to);
        if (!label) continue;

        L.tooltip({
            pane: 'npfWaypointLabelPane',
            permanent: true,
            direction: 'center',
            className: `npf-waypoint-segment-tooltip ${label.zoomClass}`,
            opacity: 1,
            interactive: false
        })
            .setLatLng(getNpfWaypointSegmentLabelLatLng(from, to, label.metrics))
            .setContent(label.text)
            .addTo(npfWaypointLabelLayer);
    }
}

function redrawNpfWaypointRoute() {
    if (!ensureNpfWaypointRouteLayers()) return;
    drawNpfWaypointRouteLines();
    updateNpfWaypointSegmentLabels();

    npfWaypointMarkerLayer.clearLayers();
    npfWaypointMarkerRegistry = new Map();

    npfWaypointRouteState.waypoints.forEach((wp, index) => {
        const sourceLinked = isNpfWaypointSourceLinked(wp);
        const marker = L.marker([wp.lat, wp.lon], {
            pane: 'npfWaypointMarkerPane',
            icon: buildNpfWaypointIcon(wp, index),
            zIndexOffset: wp.id === npfWaypointRouteState.activeId ? 3300 : 3200,
            keyboard: false,
            draggable: false,
            /*
             * Aéroport / PÉLIC / VFR déjà représenté par son icône métier :
             * le losange WP devient un simple encadrement visuel. Le clic traverse
             * donc vers l'icône d'origine, dont la fiche contient les actions WP.
             */
            interactive: !sourceLinked
        });
        const waypointIsPelic = String(wp?.source || '').trim() === 'airport'
            && typeof isSelectablePelicanAirport === 'function'
            && isSelectablePelicanAirport(normalizeOaciCodeInput(wp?.sourceRef));
        marker.bindPopup(
            buildNpfWaypointPopupHtml(wp, index),
            waypointIsPelic
                ? getNpfPelicPopupOptions({ maxWidth: 390 })
                : { maxWidth: 390, closeButton: true }
        );
        marker.addTo(npfWaypointMarkerLayer);
        npfWaypointMarkerRegistry.set(wp.id, marker);
    });

    /*
     * v16.13 — le bandeau Route est resynchronisé à chaque redessin. Cela
     * couvre notamment la restauration d'une route persistante après MAJ,
     * sans dépendre du bandeau commune/feu pour le recréer.
     */
    if (window.__npfWaypointRouteReady === true) {
        syncNpfWaypointNavigationBanner();
    }
}

/*
 * v16.94 — origine de navigation WP.
 * Le marqueur avion est prioritaire. La dernière position GPS valide permet
 * néanmoins de tracer immédiatement Position actuelle -> WP pendant une
 * reconstruction de couche ou juste après réouverture de l'application.
 */
function getNpfWaypointCurrentPositionLatLng() {
    try {
        const markerLatLng = userMarker?.getLatLng?.();
        if (
            markerLatLng
            && Number.isFinite(Number(markerLatLng.lat))
            && Number.isFinite(Number(markerLatLng.lng))
        ) {
            return {
                lat: Number(markerLatLng.lat),
                lng: Number(markerLatLng.lng)
            };
        }
    } catch (_) {}

    const lastLat = Number(lastPosition?.lat ?? lastPosition?.latitude);
    const lastLng = Number(lastPosition?.lng ?? lastPosition?.longitude);
    if (Number.isFinite(lastLat) && Number.isFinite(lastLng)) {
        return { lat: lastLat, lng: lastLng };
    }

    return null;
}

function ensureNpfWaypointGps() {
    if (userMarker) return;
    if (typeof requestOneShotGps === 'function') {
        requestOneShotGps({
            silent: true,
            highAccuracy: true,
            timeout: 15000,
            maximumAge: 600000
        });
    }
}

function activateNpfWaypointGoto(id) {
    const wp = getNpfWaypointById(id);
    if (!wp) return false;
    suspendNpfFirePelicAutoCycle();
    npfWaypointRouteState.activeId = wp.id;
    npfWaypointRouteState.gotoActive = true;

    // Une navigation WP remplace un éventuel GoTo aéroport temporaire.
    selectedAirportDestination = null;

    persistNpfWaypointRouteState();
    redrawNpfWaypointRoute();
    updateCommuneDisplay(currentCommune);
    drawUserToTargetRoute();
    ensureNpfWaypointGps();
    try { map?.closePopup?.(); } catch (_) {}
    return true;
}

function addNpfWaypoint(point = {}) {
    const lat = Number(point.lat);
    const lon = Number(point.lon ?? point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

    const source = String(point.source || 'map').trim() || 'map';
    const sourceRef = String(point.sourceRef || '').trim();
    const existing = findNpfWaypointForSource({ source, sourceRef, lat, lon });
    if (existing && source !== 'map') {
        redrawNpfWaypointRoute();
        const existingMarker = npfWaypointMarkerRegistry.get(existing.id);
        try { existingMarker?.openPopup?.(); } catch (_) {}
        return false;
    }

    const wasEmpty = npfWaypointRouteState.waypoints.length === 0;
    const wp = {
        id: `wp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        lat,
        lon,
        name: String(point.name || '').trim() || `WP ${npfWaypointRouteState.waypoints.length + 1}`,
        source,
        sourceRef
    };
    npfWaypointRouteState.waypoints.push(wp);

    if (wasEmpty) {
        /*
         * v16.95 — la position avion au moment de la création de WP1 devient
         * l'origine fixe du trait plein. Si aucun fix n'est encore disponible,
         * on attend uniquement le premier fix valide suivant.
         */
        const routeOrigin = getNpfWaypointCurrentPositionLatLng();
        if (routeOrigin) {
            setNpfWaypointRouteOriginFromLatLng(routeOrigin, { persist: false });
        } else {
            npfWaypointRouteState.origin = null;
            npfWaypointRouteState.originPending = true;
        }

        suspendNpfFirePelicAutoCycle();
        npfWaypointRouteState.activeId = wp.id;
        npfWaypointRouteState.gotoActive = true;
        selectedAirportDestination = null;
    } else if (!npfWaypointRouteState.activeId) {
        npfWaypointRouteState.activeId = npfWaypointRouteState.waypoints[0].id;
    }

    persistNpfWaypointRouteState();
    redrawNpfWaypointRoute();

    /*
     * v16.94 — tout ajout de WP resynchronise immédiatement la branche
     * Position actuelle -> WP actif. Pour le premier WP, le GoTo vient d'être
     * activé ci-dessus ; pour les suivants, l'ordre et le WP actif sont conservés.
     */
    drawUserToTargetRoute();

    if (wasEmpty) {
        updateCommuneDisplay(currentCommune);
        ensureNpfWaypointGps();
    }
    try { map?.closePopup?.(); } catch (_) {}
    return true;
}

function getNpfAirportForWaypoint(oaci) {
    const safe = normalizeOaciCodeInput(oaci);
    if (!safe) return null;
    return [...pelicanAirports, ...otherAirports, ...(Array.isArray(additionalAerodromes) ? additionalAerodromes : [])]
        .find(ap => normalizeOaciCodeInput(ap?.oaci) === safe) || null;
}

function addNpfWaypointFromAirportByOaci(oaci) {
    const airport = getNpfAirportForWaypoint(oaci);
    if (!airport) return false;
    return addNpfWaypoint({
        lat: Number(airport.lat),
        lon: Number(airport.lon),
        name: `${airport.oaci} — ${airport.name || airport.oaci}`,
        source: 'airport',
        sourceRef: normalizeOaciCodeInput(airport.oaci)
    });
}

function addNpfWaypointFromVfr(encodedName, lat, lon) {
    let name = '';
    try { name = decodeURIComponent(String(encodedName || '')); } catch (_) { name = String(encodedName || ''); }
    return addNpfWaypoint({
        lat: Number(lat),
        lon: Number(lon),
        name: name || 'Point VFR',
        source: 'vfr',
        sourceRef: name || 'Point VFR'
    });
}

function addNpfWaypointFromMapLatLng(latlng) {
    if (!latlng) return false;
    let name = 'Point carte';
    try {
        name = findClosestCommuneName(Number(latlng.lat), Number(latlng.lng)) || name;
    } catch (_) {}
    return addNpfWaypoint({
        lat: Number(latlng.lat),
        lon: Number(latlng.lng),
        name,
        source: 'map'
    });
}


const NPF_WAYPOINT_ROUTE_LONG_PRESS_TOLERANCE_PX = 22;

function getNpfWaypointRouteSegmentAtLatLng(latlng, tolerancePx = NPF_WAYPOINT_ROUTE_LONG_PRESS_TOLERANCE_PX) {
    if (!map || !latlng || !npfWaypointRouteState.waypoints.length) return null;

    const routePoints = getNpfWaypointRoutePathPoints();
    if (routePoints.length < 2) return null;
    const hasFixedOrigin = Boolean(getNpfWaypointRouteOrigin());

    let p;
    try { p = map.latLngToContainerPoint(latlng); } catch (_) { return null; }
    if (!p) return null;

    let best = null;
    for (let i = 0; i < routePoints.length - 1; i += 1) {
        const from = routePoints[i];
        const to = routePoints[i + 1];
        let a;
        let b;
        try {
            a = map.latLngToContainerPoint([from.lat, from.lon]);
            b = map.latLngToContainerPoint([to.lat, to.lon]);
        } catch (_) {
            continue;
        }

        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const len2 = vx * vx + vy * vy;
        if (!Number.isFinite(len2) || len2 < 25) continue;

        const rawT = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
        /* « Entre 2 WP » : on ne capte pas les extrémités elles-mêmes. */
        if (rawT <= 0.05 || rawT >= 0.95) continue;
        const t = Math.max(0, Math.min(1, rawT));
        const qx = a.x + vx * t;
        const qy = a.y + vy * t;
        const distancePx = Math.hypot(p.x - qx, p.y - qy);
        if (!Number.isFinite(distancePx) || distancePx > tolerancePx) continue;

        if (!best || distancePx < best.distancePx) {
            /*
             * Avec une origine fixe :
             *   segment 0 = Origine -> WP1 => insertion à l'index 0 ;
             *   segment 1 = WP1 -> WP2   => insertion à l'index 1 ; etc.
             * Sans origine, on conserve exactement l'indexation historique.
             */
            const insertIndex = hasFixedOrigin ? i : i + 1;
            best = {
                segmentIndex: i,
                insertIndex,
                distancePx,
                t,
                fromOrigin: Boolean(hasFixedOrigin && i === 0)
            };
        }
    }
    return best;
}

function insertNpfWaypointOnRouteSegment(segmentInfo, latlng) {
    if (!segmentInfo || !latlng) return null;
    const insertIndex = Number(segmentInfo.insertIndex);
    const hasFixedOrigin = Boolean(getNpfWaypointRouteOrigin());

    const validInsertIndex = hasFixedOrigin
        ? (
            Number.isInteger(insertIndex)
            && insertIndex >= 0
            && insertIndex < npfWaypointRouteState.waypoints.length
        )
        : (
            Number.isInteger(insertIndex)
            && insertIndex > 0
            && insertIndex < npfWaypointRouteState.waypoints.length
        );

    if (!validInsertIndex) return null;

    const lat = Number(latlng.lat);
    const lon = Number(latlng.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    let name = 'Point route';
    try { name = findClosestCommuneName(lat, lon) || name; } catch (_) {}

    const wp = {
        id: `wp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        lat,
        lon,
        name,
        source: 'map',
        sourceRef: ''
    };

    const firstWaypointBeforeInsert = npfWaypointRouteState.waypoints[0] || null;
    const insertedBeforeActiveFirstWaypoint = Boolean(
        insertIndex === 0
        && npfWaypointRouteState.gotoActive
        && firstWaypointBeforeInsert
        && npfWaypointRouteState.activeId === firstWaypointBeforeInsert.id
    );

    npfWaypointRouteState.waypoints.splice(insertIndex, 0, wp);

    /*
     * Si l'on crée un WP sur le premier segment Origine -> WP1 pendant que WP1
     * est la prochaine cible, le nouveau point devient logiquement le WP actif.
     */
    if (insertedBeforeActiveFirstWaypoint) {
        npfWaypointRouteState.activeId = wp.id;
    }

    persistNpfWaypointRouteState();
    redrawNpfWaypointRoute();
    drawUserToTargetRoute();
    updateCommuneDisplay(currentCommune);
    return wp;
}

function handleNpfWaypointRouteLongPress(latlng) {
    const segmentInfo = getNpfWaypointRouteSegmentAtLatLng(latlng);
    if (!segmentInfo) return false;

    const wp = insertNpfWaypointOnRouteSegment(segmentInfo, latlng);
    if (!wp) return false;

    /*
     * v16.11 — aucun menu intermédiaire : le WP est inséré dans l'ordre de la
     * route puis passe immédiatement en mode Déplacer.
     */
    requestAnimationFrame(() => startNpfWaypointMove(wp.id));
    return true;
}

function buildAirportAddWpButtonHtml(oaci) {
    const safeOaci = String(oaci || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!safeOaci) return '';
    const existing = getNpfWaypointForAirport(safeOaci);
    if (existing) {
        return `<div class="npf-waypoint-popup-actions npf-source-waypoint-actions popup-add-wp-buttons">${buildNpfWaypointActionsHtml(existing)}</div>`;
    }
    return `<div class="popup-buttons popup-add-wp-buttons"><button type="button" class="add-wp-btn" onclick="window.addNpfWaypointFromAirportByOaci('${safeOaci}')">Ajout WP</button></div>`;
}

function refreshAirportWaypointPopupHtml(popupHtml, oaci) {
    const freshGotoSection = buildAirportGoToButtonHtml(oaci);
    const freshWaypointSection = buildAirportAddWpButtonHtml(oaci);
    let html = String(popupHtml || '');

    /*
     * v16.13 — le popup peut avoir été construit avant l'ajout/suppression du
     * WP. On resynchronise donc les deux zones au clic :
     * - Go To aéroport indépendant ;
     * - actions du WP / bouton Ajout WP.
     */
    const gotoPattern = /<div class="popup-buttons popup-goto-buttons">[\s\S]*?<\/div>/;
    if (gotoPattern.test(html)) {
        html = html.replace(gotoPattern, freshGotoSection);
    } else if (freshGotoSection) {
        const waypointMarker = /<div class="(?:popup-buttons |npf-waypoint-popup-actions npf-source-waypoint-actions )?popup-add-wp-buttons">/;
        html = html.replace(waypointMarker, `${freshGotoSection}$&`);
    }

    return html.replace(
        /<div class="(?:popup-buttons |npf-waypoint-popup-actions npf-source-waypoint-actions )?popup-add-wp-buttons">[\s\S]*?<\/div>/,
        freshWaypointSection
    );
}

function deleteNpfWaypoint(id) {
    const index = getNpfWaypointIndexById(id);
    if (index < 0) return false;
    const wasActive = npfWaypointRouteState.activeId === id;
    npfWaypointRouteState.waypoints.splice(index, 1);

    if (!npfWaypointRouteState.waypoints.length) {
        npfWaypointRouteState.origin = null;
        npfWaypointRouteState.originPending = false;
        npfWaypointRouteState.activeId = null;
        npfWaypointRouteState.gotoActive = false;
    } else if (wasActive) {
        // Le point qui suivait prend la même position d'index après le splice.
        const nextIndex = Math.min(index, npfWaypointRouteState.waypoints.length - 1);
        npfWaypointRouteState.activeId = npfWaypointRouteState.waypoints[nextIndex].id;
    } else if (!getNpfActiveWaypoint()) {
        npfWaypointRouteState.activeId = npfWaypointRouteState.waypoints[0].id;
    }

    persistNpfWaypointRouteState();
    redrawNpfWaypointRoute();
    if (isNpfWaypointGotoActive()) {
        updateCommuneDisplay(currentCommune);
    } else {
        updateCommuneDisplay(currentCommune);
    }
    drawUserToTargetRoute();
    try { map?.closePopup?.(); } catch (_) {}
    return true;
}

function deleteWholeNpfWaypointRoute() {
    if (!npfWaypointRouteState.waypoints.length) return false;
    if (!confirm('Supprimer toute la route et tous les WP ?')) return false;

    npfWaypointRouteState = normalizeNpfWaypointRouteState(null);
    try { localStorage.removeItem(NPF_WAYPOINT_ROUTE_STORAGE_KEY); } catch (_) {}
    if (npfWaypointLineLayer) npfWaypointLineLayer.clearLayers();
    if (npfWaypointLabelLayer) npfWaypointLabelLayer.clearLayers();
    if (npfWaypointMarkerLayer) npfWaypointMarkerLayer.clearLayers();
    npfWaypointMarkerRegistry = new Map();

    updateCommuneDisplay(currentCommune);
    drawUserToTargetRoute();
    try { map?.closePopup?.(); } catch (_) {}
    return true;
}

function disableNpfWaypointGoto() {
    if (!npfWaypointRouteState.waypoints.length) return false;
    npfWaypointRouteState.gotoActive = false;
    if (currentCommune) armNpfFirePelicAutoCycle('fire');
    persistNpfWaypointRouteState();
    drawNpfWaypointRouteLines();
    updateNpfWaypointSegmentLabels();
    updateCommuneDisplay(currentCommune);
    drawUserToTargetRoute();
    return true;
}

function handleNpfWaypointAutoAdvance(userLat, userLon) {
    if (!isNpfWaypointGotoActive()) return false;
    const active = getNpfActiveWaypoint();
    if (!active) return false;

    const distance = calculateDistanceInNm(
        Number(userLat),
        Number(userLon),
        Number(active.lat),
        Number(active.lon)
    );
    if (!Number.isFinite(distance) || distance > NPF_WAYPOINT_CAPTURE_RADIUS_NM) return false;

    const currentIndex = getNpfWaypointIndexById(active.id);
    if (currentIndex < 0 || currentIndex >= npfWaypointRouteState.waypoints.length - 1) {
        return false;
    }

    npfWaypointRouteState.activeId = npfWaypointRouteState.waypoints[currentIndex + 1].id;
    persistNpfWaypointRouteState();
    redrawNpfWaypointRoute();
    updateCommuneDisplay(currentCommune);
    return true;
}

function getOrCreateNpfWaypointNavigationBanner() {
    let banner = document.getElementById('npf-waypoint-route-banner');
    if (banner || !document.body) return banner;
    banner = document.createElement('div');
    banner.id = 'npf-waypoint-route-banner';
    banner.setAttribute('role', 'status');
    document.body.appendChild(banner);
    return banner;
}

function removeNpfWaypointNavigationBanner() {
    const banner = document.getElementById('npf-waypoint-route-banner');
    if (banner?.parentNode) banner.parentNode.removeChild(banner);
}

function positionNpfWaypointNavigationBanner() {
    const banner = document.getElementById('npf-waypoint-route-banner');
    if (!banner || banner.style.display === 'none') return;

    let safeAreaTop = 0;
    try {
        safeAreaTop = parseFloat(
            window.getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top')
        ) || 0;
    } catch (_) {}

    let top = Math.max(8, safeAreaTop + 4);
    const blockers = [
        document.getElementById('bingo-map-display'),
        document.getElementById('commune-info-display')
    ];
    blockers.forEach(element => {
        if (!element) return;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
        const rect = element.getBoundingClientRect();
        if (rect.width > 1 && rect.height > 1) top = Math.max(top, rect.bottom + 8);
    });

    /* Le CSS du bandeau utilise !important : on applique donc la position calculée
       avec la même priorité pour que les bandeaux Feu/BINGO restent toujours visibles. */
    banner.style.setProperty('top', `${Math.round(top)}px`, 'important');
}

function syncNpfWaypointNavigationBanner() {
    if (window.__npfWaypointRouteReady !== true || !isNpfWaypointGotoActive()) {
        removeNpfWaypointNavigationBanner();
        return false;
    }
    return renderNpfWaypointNavigationBanner();
}

function renderNpfWaypointNavigationBanner() {
    const active = getNpfActiveWaypoint();
    if (!active || !isNpfWaypointGotoActive()) {
        removeNpfWaypointNavigationBanner();
        return false;
    }
    const display = getOrCreateNpfWaypointNavigationBanner();
    if (!display) return false;

    const activeNumber = getNpfWaypointDisplayNumber(active.id);
    display.innerHTML = `
        <div class="wp-route-band-metric">
            <span class="wp-route-band-label">WP${activeNumber}</span>
            <span id="wp-route-active-metric">---° / -- Nm / -- min</span>
        </div>
        <div class="wp-route-band-metric wp-route-band-final">
            <span class="wp-route-band-label">WP Final</span>
            <span id="wp-route-final-metric">---° / -- Nm / -- min</span>
        </div>
        <button type="button" class="wp-route-band-button wp-route-disable-goto" onclick="window.npfWaypointDisableGoto()">Désact. GoTo</button>
        <button type="button" class="wp-route-band-button wp-route-delete-all" onclick="window.npfWaypointDeleteRoute()">Supp. Route</button>
    `;
    display.style.display = 'flex';
    updateNpfWaypointNavigationBannerMetrics();
    requestAnimationFrame(positionNpfWaypointNavigationBanner);
    return true;
}

function updateNpfWaypointNavigationBannerMetrics() {
    if (!isNpfWaypointGotoActive()) return false;
    const active = getNpfActiveWaypoint();
    const finalWp = npfWaypointRouteState.waypoints[npfWaypointRouteState.waypoints.length - 1];
    const activeMetric = document.getElementById('wp-route-active-metric');
    const finalMetric = document.getElementById('wp-route-final-metric');
    if (!active || !finalWp) return false;

    const userLatLng = getNpfWaypointCurrentPositionLatLng();
    const formatMetric = wp => {
        if (!userLatLng || !Number.isFinite(userLatLng.lat) || !Number.isFinite(userLatLng.lng)) {
            return '---° / -- Nm / -- min';
        }
        const distance = calculateDistanceInNm(userLatLng.lat, userLatLng.lng, wp.lat, wp.lon);
        const bearing = getNpfWaypointMagneticBearing(userLatLng.lat, userLatLng.lng, wp.lat, wp.lon);
        return `${formatRouteDegrees(bearing)} / ${formatNpfWaypointDistanceNm(distance)} / ${formatGpsEtaMinutes(distance)}`;
    };

    if (activeMetric) activeMetric.textContent = formatMetric(active);
    if (finalMetric) finalMetric.textContent = formatMetric(finalWp);
    requestAnimationFrame(positionNpfWaypointNavigationBanner);
    return true;
}

function closeNpfWaypointSearchOverlay() {
    const overlay = document.getElementById('npf-waypoint-search-overlay');
    if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
    document.body?.classList.remove('npf-waypoint-search-open');
    npfWaypointSearchOverlayState = null;
}

function applyNpfWaypointCommune(id, commune) {
    const wp = getNpfWaypointById(id);
    const latLng = getGaarCommuneLatLng(commune);
    if (!wp || !latLng) return false;
    wp.lat = latLng.lat;
    wp.lon = latLng.lng;
    wp.name = formatGaarCommuneResultName(commune) || wp.name;
    persistNpfWaypointRouteState();
    closeNpfWaypointSearchOverlay();
    redrawNpfWaypointRoute();
    drawUserToTargetRoute();
    updateCommuneDisplay(currentCommune);
    try { map?.panTo?.([wp.lat, wp.lon], { animate: false }); } catch (_) {}
    return true;
}

function openNpfWaypointSearchOverlay(id) {
    const wp = getNpfWaypointById(id);
    if (!wp || !document.body) return false;
    try { map?.closePopup?.(); } catch (_) {}
    closeNpfWaypointSearchOverlay();
    npfWaypointSearchOverlayState = { id };

    const overlay = document.createElement('div');
    overlay.id = 'npf-waypoint-search-overlay';
    overlay.className = 'gaar-point-search-overlay npf-waypoint-search-overlay';
    document.body.classList.add('npf-waypoint-search-open');

    const panel = document.createElement('div');
    panel.className = 'gaar-point-search-panel npf-waypoint-search-panel';

    const header = document.createElement('div');
    header.className = 'gaar-point-search-header';
    const title = document.createElement('div');
    title.className = 'gaar-point-search-title';
    title.innerHTML = `<b>Modifier WP${getNpfWaypointDisplayNumber(id)}</b><span>${escapeHtml(wp.name)}</span>`;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'gaar-point-search-close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Fermer');
    closeButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closeNpfWaypointSearchOverlay();
    });
    header.appendChild(title);
    header.appendChild(closeButton);

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'gaar-point-search-field-wrapper gaar-point-search-field-wrapper-top';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gaar-point-search-input gaar-point-search-input-top';
    input.placeholder = 'Rechercher une commune...';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'gaar-point-search-clear';
    clearButton.textContent = '×';
    clearButton.setAttribute('aria-label', 'Effacer la recherche');
    inputWrapper.appendChild(input);
    inputWrapper.appendChild(clearButton);

    const results = document.createElement('ul');
    results.className = 'gaar-point-results gaar-point-results-top';
    results.style.display = 'none';

    let currentResults = [];
    const renderResults = () => {
        currentResults = searchCommunesForGaarPoint(input.value);
        results.innerHTML = '';
        if (!currentResults.length) {
            results.style.display = 'none';
            return;
        }
        currentResults.forEach(commune => {
            const li = document.createElement('li');
            li.textContent = `${commune.nom_standard} (${commune.dep_nom || commune.dep_code} - ${commune.dep_code})`;
            const choose = event => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                applyNpfWaypointCommune(id, commune);
            };
            li.addEventListener('pointerdown', choose, { passive: false });
            li.addEventListener('click', choose);
            results.appendChild(li);
        });
        results.style.display = 'block';
    };

    let timer = null;
    input.addEventListener('input', () => {
        clearButton.style.display = input.value ? 'inline-flex' : 'none';
        if (timer) clearTimeout(timer);
        timer = setTimeout(renderResults, 150);
    });
    input.addEventListener('focus', renderResults);
    input.addEventListener('click', event => {
        event.stopPropagation();
        renderResults();
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeNpfWaypointSearchOverlay();
        if (event.key === 'Enter') {
            event.preventDefault();
            const best = currentResults[0] || findBestGaarCommuneForInput(input.value);
            if (best) applyNpfWaypointCommune(id, best);
        }
    });
    clearButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        input.value = '';
        results.innerHTML = '';
        results.style.display = 'none';
        clearButton.style.display = 'none';
        try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
    });
    clearButton.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'gaar-point-popup-actions gaar-point-search-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'delete-point-btn gaar-point-delete-btn';
    cancel.textContent = 'Annuler';
    cancel.addEventListener('click', closeNpfWaypointSearchOverlay);
    actions.appendChild(cancel);

    panel.appendChild(header);
    panel.appendChild(inputWrapper);
    panel.appendChild(results);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeNpfWaypointSearchOverlay();
        else event.stopPropagation();
    });
    return true;
}

function clearNpfWaypointMoveOutsideListener() {
    if (!npfWaypointMoveOutsidePointerHandler) return;
    try {
        document.removeEventListener('pointerdown', npfWaypointMoveOutsidePointerHandler, true);
    } catch (_) {}
    npfWaypointMoveOutsidePointerHandler = null;
}

function cancelNpfWaypointMoveFromOutside() {
    const handle = npfWaypointMoveHandle;
    clearNpfWaypointMoveOutsideListener();
    if (!handle) return false;

    try { handle.closeTooltip?.(); } catch (_) {}
    try { handle.remove(); } catch (_) {}
    if (npfWaypointMoveHandle === handle) npfWaypointMoveHandle = null;

    /*
     * Un clic extérieur annule seulement le mode « Déplacer » : il ne modifie
     * ni les coordonnées enregistrées ni l'action que l'utilisateur vient de
     * viser. Le redessin restaure simplement l'affichage WP normal.
     */
    redrawNpfWaypointRoute();
    drawUserToTargetRoute();
    updateCommuneDisplay(currentCommune);
    return true;
}

function armNpfWaypointMoveOutsideCancellation(handle) {
    clearNpfWaypointMoveOutsideListener();

    /*
     * Le listener est armé au tour d'événement suivant afin que l'appui sur le
     * bouton « Déplacer » qui vient d'ouvrir le mode ne puisse pas l'annuler.
     * Capture document => fonctionne aussi sur un autre marqueur ou une popup.
     */
    window.setTimeout(() => {
        if (!handle || npfWaypointMoveHandle !== handle) return;

        npfWaypointMoveOutsidePointerHandler = event => {
            if (!npfWaypointMoveHandle || npfWaypointMoveHandle !== handle) {
                clearNpfWaypointMoveOutsideListener();
                return;
            }

            const target = event?.target;
            if (target instanceof Element && target.closest('.npf-waypoint-move-handle')) {
                return;
            }

            cancelNpfWaypointMoveFromOutside();
        };
        document.addEventListener('pointerdown', npfWaypointMoveOutsidePointerHandler, true);
    }, 0);
}

function startNpfWaypointMove(id) {
    const wp = getNpfWaypointById(id);
    const marker = npfWaypointMarkerRegistry.get(id);
    if (!wp || !marker || !map || typeof L === 'undefined') return false;
    if (!ensureNpfWaypointRouteLayers()) return false;

    try { map.closePopup?.(); } catch (_) {}

    /*
     * v16.11 — ne pas rendre le losange permanent prioritaire : cela masquerait
     * les fiches VFR / aéroport lorsqu'ils sont superposés. On crée seulement
     * pendant « Déplacer » une poignée tactile de 76 px, dans un pane supérieur
     * aux hitbox SIA/NPF. Le déplacement devient ainsi fiable sans régression
     * sur l'ouverture normale des points sources.
     */
    if (npfWaypointMoveHandle) {
        cancelNpfWaypointMoveFromOutside();
    } else {
        clearNpfWaypointMoveOutsideListener();
    }

    const wpIndex = Math.max(0, npfWaypointRouteState.waypoints.findIndex(item => item.id === id));
    const label = `WP${wpIndex + 1}`;
    const moveIcon = L.divIcon({
        className: 'npf-waypoint-move-handle',
        html: `<span class="npf-waypoint-move-handle-ring"><span>${label}</span></span>`,
        iconSize: [76, 76],
        iconAnchor: [38, 38]
    });

    const handle = L.marker([wp.lat, wp.lon], {
        icon: moveIcon,
        pane: map.getPane('npfWaypointMovePane') ? 'npfWaypointMovePane' : 'markerPane',
        zIndexOffset: 20000,
        keyboard: false,
        draggable: true,
        autoPan: true,
        autoPanPadding: [60, 60],
        autoPanSpeed: 10
    }).addTo(map);
    npfWaypointMoveHandle = handle;
    armNpfWaypointMoveOutsideCancellation(handle);

    const syncPosition = latlng => {
        if (!latlng) return;
        wp.lat = Number(latlng.lat);
        wp.lon = Number(latlng.lng);
        try { marker.setLatLng(latlng); } catch (_) {}
        drawNpfWaypointRouteLines();
        updateNpfWaypointSegmentLabels();
        drawUserToTargetRoute();
    };

    const finishMove = event => {
        const releasedLatLng = event?.target?.getLatLng?.() || handle.getLatLng();
        const snap = getNpfWaypointSnapCandidate(releasedLatLng);
        const finalLatLng = snap
            ? L.latLng(Number(snap.lat), Number(snap.lon))
            : releasedLatLng;

        if (snap) {
            /*
             * v16.12 — un WP relâché à proximité immédiate d'un point connu
             * adopte exactement ses coordonnées ET son identité de source.
             * Ainsi, le popup du point sait aussi qu'il s'agit déjà d'un WP.
             */
            wp.source = snap.source;
            wp.sourceRef = snap.sourceRef;
            wp.name = snap.name;
            try { handle.setLatLng(finalLatLng); } catch (_) {}
        } else if (wp.source === 'airport' || wp.source === 'vfr') {
            /*
             * Un WP déplacé franchement hors de son point d'origine devient
             * un WP libre. Le libellé est conservé, mais l'identité de source
             * est libérée pour ne pas faire croire qu'il coïncide encore.
             */
            wp.source = 'map';
            wp.sourceRef = '';
        }

        syncPosition(finalLatLng);
        persistNpfWaypointRouteState();
        clearNpfWaypointMoveOutsideListener();
        try { handle.remove(); } catch (_) {}
        if (npfWaypointMoveHandle === handle) npfWaypointMoveHandle = null;
        redrawNpfWaypointRoute();
        drawUserToTargetRoute();
        updateCommuneDisplay(currentCommune);
    };

    handle.on('drag', event => syncPosition(event.target.getLatLng()));
    handle.once('dragend', finishMove);

    try {
        handle.bindTooltip('Déplacer le WP puis relâcher', {
            permanent: false,
            direction: 'top',
            className: 'npf-waypoint-move-hint',
            offset: [0, -32]
        }).openTooltip();
        setTimeout(() => { try { handle.closeTooltip(); } catch (_) {} }, 1800);
    } catch (_) {}

    return true;
}

restoreNpfWaypointRouteState();
window.__npfWaypointRouteReady = true;
window.addEventListener('resize', () => requestAnimationFrame(positionNpfWaypointNavigationBanner), { passive: true });
window.addEventListener('orientationchange', () => setTimeout(positionNpfWaypointNavigationBanner, 120), { passive: true });

/*
 * initMap() est exécuté plus haut dans le fichier. On initialise donc les couches
 * WP ici, une fois que les variables/constantes route sont réellement créées.
 */
const restoreNpfWaypointRouteLayersAfterStartup = () => {
    if (!ensureNpfWaypointRouteLayers()) return;
    redrawNpfWaypointRoute();
    if (isNpfWaypointGotoActive()) {
        updateCommuneDisplay(currentCommune);
        drawUserToTargetRoute();
    }
};

setTimeout(() => {
    if (map?.whenReady) map.whenReady(restoreNpfWaypointRouteLayersAfterStartup);
    else restoreNpfWaypointRouteLayersAfterStartup();

    /*
     * Deuxième contrôle après le chargement progressif des couches métier.
     * Il ne change aucun état de route : il garantit seulement que les trois
     * LayerGroups persistants sont encore présents et redessinés.
     */
    setTimeout(restoreNpfWaypointRouteLayersAfterStartup, 1200);
}, 0);

window.addNpfWaypointFromAirportByOaci = addNpfWaypointFromAirportByOaci;
window.addNpfWaypointFromVfr = addNpfWaypointFromVfr;
window.npfWaypointGoto = activateNpfWaypointGoto;
window.npfWaypointDelete = deleteNpfWaypoint;
window.npfWaypointModify = openNpfWaypointSearchOverlay;
window.npfWaypointMove = startNpfWaypointMove;
window.npfWaypointDeleteRoute = deleteWholeNpfWaypointRoute;
window.npfWaypointDisableGoto = disableNpfWaypointGoto;


