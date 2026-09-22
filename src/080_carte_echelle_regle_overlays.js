function applyMapNoBackgroundStyle() {
    /*
     * v13.58 — le fond transparent laissait apparaître le bleu de l'app pendant
     * les très courts chargements de tuiles au zoom/dézoom. On garde un fond
     * neutre fixe : si une tuile manque brièvement, l'écran ne devient plus bleu.
     */
    const mapLoadingBackground = '#d8e2e8';
    const styleId = 'map-no-background-style';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #map,
            .leaflet-container,
            .leaflet-pane,
            .leaflet-map-pane,
            .leaflet-tile-pane {
                background: ${mapLoadingBackground} !important;
                background-color: ${mapLoadingBackground} !important;
            }

            .leaflet-tile {
                background: ${mapLoadingBackground} !important;
            }
        `;
        document.head.appendChild(style);
    }

    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.style.background = mapLoadingBackground;
        mapElement.style.backgroundColor = mapLoadingBackground;
    }

    if (map && map.getContainer) {
        const container = map.getContainer();
        if (container) {
            container.style.background = mapLoadingBackground;
            container.style.backgroundColor = mapLoadingBackground;
        }
    }

    document.querySelectorAll('.leaflet-container, .leaflet-pane, .leaflet-map-pane, .leaflet-tile-pane').forEach((element) => {
        element.style.background = mapLoadingBackground;
        element.style.backgroundColor = mapLoadingBackground;
    });
}



/* v13.77 — échelle nautique dynamique permanente.
 * Indépendante du fond de carte : fonctionne sur carte NPF, OACI et cartes offline.
 * Affichage bas-gauche : nautique uniquement.
 */
let nauticalScaleControl = null;
let nauticalScaleElement = null;

function injectNauticalScaleStyle() {
    const styleId = 'npf-nautical-scale-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .npf-nautical-scale {
            position: fixed !important;
            /* v15.12 : dégagée de la colonne FdS / GAAR / SafeSky. */
            left: calc(env(safe-area-inset-left, 0px) + 125px) !important;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 0px) !important;
            z-index: 1350 !important;
            background: rgba(255, 255, 255, 0.95);
            border: 2px solid rgba(0, 67, 112, 0.86);
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
            padding: 6px 8px 5px 8px;
            color: #003f6b;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
            font-weight: 800;
            line-height: 1;
            pointer-events: none;
            min-width: 74px;
        }
        .npf-nautical-scale-bar-wrap {
            height: 8px;
            border-left: 2px solid #003f6b;
            border-right: 2px solid #003f6b;
            border-bottom: 3px solid #003f6b;
            margin-bottom: 4px;
        }
        .npf-nautical-scale-label {
            display: flex;
            flex-direction: column;
            gap: 2px;
            text-align: center;
            white-space: nowrap;
        }
        .npf-nautical-scale-label .nm {
            font-size: 13px;
            font-weight: 1000;
            color: #003f6b;
        }
        .npf-nautical-scale-label .km {
            font-size: 11px;
            font-weight: 900;
            color: #41556a;
        }
        .npf-two-finger-ruler-label {
            background: rgba(255, 255, 255, 0.96);
            border: 2px solid rgba(0, 67, 112, 0.90);
            border-radius: 9px;
            box-shadow: 0 2px 8px rgba(0,0,0,.30);
            padding: 5px 8px;
            color: #003f6b;
            font-family: Arial, Helvetica, sans-serif;
            font-weight: 1000;
            line-height: 1.08;
            text-align: center;
            white-space: nowrap;
            pointer-events: none;
        }
        .npf-two-finger-ruler-label .nm { font-size: 15px; }
        .npf-two-finger-ruler-label .km { font-size: 12px; color:#41556a; margin-top:2px; }
        .npf-two-finger-ruler-mark-label {
            background: transparent !important;
            border: 0 !important;
            box-shadow: none !important;
            pointer-events: none !important;
            width: auto !important;
            height: auto !important;
        }
        .npf-two-finger-ruler-mark-value {
            display: inline-block;
            min-width: 72px;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 18px;
            font-weight: 1000;
            line-height: 1;
            text-align: center;
            white-space: nowrap;
            text-shadow:
                -2px -2px 0 #111827,
                 2px -2px 0 #111827,
                -2px  2px 0 #111827,
                 2px  2px 0 #111827,
                 0 2px 7px rgba(0,0,0,.90);
        }
        .npf-two-finger-ruler-mark-value.nm {
            color: #ffea00;
        }
        .npf-two-finger-ruler-mark-value.km {
            color: #00f5ff;
        }
        .npf-two-finger-ruler-help {
            position: fixed;
            left: 50%;
            top: calc(env(safe-area-inset-top, 0px) + 14px);
            transform: translateX(-50%);
            z-index: 1850;
            background: rgba(0,67,112,.92);
            color: #fff;
            border-radius: 999px;
            padding: 6px 12px;
            font: 900 13px/1 Arial, Helvetica, sans-serif;
            box-shadow: 0 2px 9px rgba(0,0,0,.28);
            pointer-events: none;
        }
        @media (max-width: 900px) {
            .npf-nautical-scale {
                left: calc(env(safe-area-inset-left, 0px) + 72px) !important;
                font-size: 12px;
                padding: 5px 7px 4px 7px;
            }
        }
    `;
    document.head.appendChild(style);
}

function formatNauticalMiles(value) {
    if (!Number.isFinite(value) || value <= 0) return '-- NM';
    if (value < 1) {
        return `${Number(value.toFixed(1)).toString()} NM`;
    }
    if (value < 10) {
        return `${Number(value.toFixed(value % 1 ? 1 : 0)).toString()} NM`;
    }
    return `${Math.round(value)} NM`;
}

function formatKilometers(value) {
    if (!Number.isFinite(value) || value <= 0) return '-- km';
    if (value < 10) return `${Number(value.toFixed(1)).toString()} km`;
    return `${Math.round(value)} km`;
}

function chooseNiceNauticalScale(maxNm) {
    const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
    let selected = candidates[0];
    for (const candidate of candidates) {
        if (candidate <= maxNm) selected = candidate;
    }
    return selected;
}

function updateNauticalScale() {
    if (!map || !nauticalScaleElement || !map.getSize || !map.containerPointToLatLng || !map.distance) return;
    const size = map.getSize();
    if (!size || !size.x || !size.y) return;

    const samplePixels = Math.min(160, Math.max(80, Math.floor(size.x * 0.16)));
    const y = Math.max(10, Math.floor(size.y / 2));
    const x1 = Math.max(5, Math.floor((size.x - samplePixels) / 2));
    const x2 = x1 + samplePixels;

    const ll1 = map.containerPointToLatLng(L.point(x1, y));
    const ll2 = map.containerPointToLatLng(L.point(x2, y));
    const meters = map.distance(ll1, ll2);
    const metersPerPixel = meters / samplePixels;
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return;

    const maxPixels = 110;
    const maxNm = (metersPerPixel * maxPixels) / 1852;
    const niceNm = chooseNiceNauticalScale(maxNm);
    const pixelWidth = Math.max(26, Math.round((niceNm * 1852) / metersPerPixel));

    nauticalScaleElement.innerHTML = `
        <div class="npf-nautical-scale-bar-wrap" style="width:${pixelWidth}px"></div>
        <div class="npf-nautical-scale-label"><span class="nm">${formatNauticalMiles(niceNm)}</span></div>
    `;
    if (typeof positionNpfStartupDiagButtonNextToScale === 'function') {
        window.requestAnimationFrame(positionNpfStartupDiagButtonNextToScale);
    }
}

function ensureNauticalScaleControl() {
    if (!map || !window.L || nauticalScaleControl) return;
    injectNauticalScaleStyle();

    /* v13.75 — l'échelle est sortie des contrôles Leaflet.
     * Sur iPad, les contrôles bottom-left pouvaient être masqués/décalés par le zoom,
     * la safe-area ou les bandeaux. Un overlay fixe reste visible sur NPF, OACI,
     * online et offline, y compris avec les anciennes cartes.
     */
    nauticalScaleElement = document.getElementById('npf-nautical-scale-fixed');
    if (!nauticalScaleElement) {
        nauticalScaleElement = document.createElement('div');
        nauticalScaleElement.id = 'npf-nautical-scale-fixed';
        nauticalScaleElement.className = 'npf-nautical-scale';
        nauticalScaleElement.innerHTML = '<div class="npf-nautical-scale-label"><span class="nm">-- NM</span></div>';
        document.body.appendChild(nauticalScaleElement);
    }
    nauticalScaleControl = { fixedOverlay: true };

    map.on('zoomend moveend resize viewreset', updateNauticalScale);
    setTimeout(updateNauticalScale, 0);
    setTimeout(updateNauticalScale, 350);
    setTimeout(updateNauticalScale, 1200);
}


/* v13.77 — règle mobile 2 doigts, graduée en NM/km.
 * Appui prolongé à 2 doigts : affichage de la règle tant que les doigts restent posés.
 * Fonctionne avec carte NPF, OACI, online et offline car elle utilise la géométrie Leaflet.
 */
let twoFingerRulerLayer = null;
let twoFingerRulerTimer = null;
let twoFingerRulerActive = false;
let twoFingerRulerWasDraggingEnabled = null;
let twoFingerRulerWasTouchZoomEnabled = null;
let twoFingerRulerPreviousTouchAction = null;
let twoFingerRulerStartPoints = null;
let twoFingerRulerHelpEl = null;
const TWO_FINGER_RULER_PANE_NAME = 'npfTwoFingerRulerPane';
const TWO_FINGER_RULER_PANE_Z_INDEX = 800;

function getTouchContainerPoints(event) {
    if (!map || !map.getContainer || !event || !event.touches || event.touches.length < 2) return null;
    const rect = map.getContainer().getBoundingClientRect();
    const t1 = event.touches[0];
    const t2 = event.touches[1];
    return [
        L.point(t1.clientX - rect.left, t1.clientY - rect.top),
        L.point(t2.clientX - rect.left, t2.clientY - rect.top)
    ];
}

function clearTwoFingerRulerLayer() {
    if (twoFingerRulerLayer) {
        twoFingerRulerLayer.clearLayers();
    }
}

function ensureTwoFingerRulerPane() {
    if (!map || !map.getPane || !map.createPane) return null;
    let pane = map.getPane(TWO_FINGER_RULER_PANE_NAME);
    if (!pane) pane = map.createPane(TWO_FINGER_RULER_PANE_NAME);
    if (pane) {
        pane.style.zIndex = String(TWO_FINGER_RULER_PANE_Z_INDEX);
        pane.style.pointerEvents = 'none';
    }
    return pane;
}

function ensureTwoFingerRulerLayer() {
    if (!map || !window.L) return null;
    ensureTwoFingerRulerPane();
    if (!twoFingerRulerLayer) twoFingerRulerLayer = L.layerGroup().addTo(map);
    return twoFingerRulerLayer;
}

function showTwoFingerRulerHelp() {
    if (twoFingerRulerHelpEl) return;
    twoFingerRulerHelpEl = document.createElement('div');
    twoFingerRulerHelpEl.className = 'npf-two-finger-ruler-help';
    twoFingerRulerHelpEl.textContent = 'Règle mobile — zoom suspendu';
    document.body.appendChild(twoFingerRulerHelpEl);
}

function hideTwoFingerRulerHelp() {
    if (twoFingerRulerHelpEl && twoFingerRulerHelpEl.parentNode) {
        twoFingerRulerHelpEl.parentNode.removeChild(twoFingerRulerHelpEl);
    }
    twoFingerRulerHelpEl = null;
}

function formatTwoFingerRulerMarkNm(value, includeUnit = false) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return includeUnit ? '-- NM' : '--';
    let text;
    if (numeric === 0) text = '0';
    else if (numeric < 1) text = Number(numeric.toFixed(1)).toString();
    else if (numeric < 10) text = Number(numeric.toFixed(numeric % 1 ? 1 : 0)).toString();
    else text = Math.round(numeric).toString();
    return includeUnit ? `${text} NM` : text;
}

function formatTwoFingerRulerMarkKm(value, includeUnit = false) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return includeUnit ? '-- km' : '--';
    let text;
    if (numeric === 0) text = '0';
    else if (numeric < 1) text = Number(numeric.toFixed(1)).toString();
    else if (numeric < 10) text = Number(numeric.toFixed(numeric % 1 ? 1 : 0)).toString();
    else text = Math.round(numeric).toString();
    return includeUnit ? `${text} km` : text;
}

function getTwoFingerRulerOffsetNormal(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nA = { x: -dy / len, y: dx / len };
    const nB = { x: -nA.x, y: -nA.y };

    /*
     * Par défaut on choisit le côté qui pointe le plus vers le haut de l'écran,
     * afin de conserver le comportement historique lorsque les doigts sont horizontaux.
     * Si ce côté sort de l'écran, le score de débordement fait basculer la règle.
     */
    const preferred = nA.y <= nB.y ? nA : nB;
    const alternate = preferred === nA ? nB : nA;
    const container = map?.getContainer ? map.getContainer() : null;
    const width = Math.max(1, Number(container?.clientWidth || container?.getBoundingClientRect?.().width || 0));
    const height = Math.max(1, Number(container?.clientHeight || container?.getBoundingClientRect?.().height || 0));
    const rulerOffsetPx = 74;
    const nmLabelOffsetPx = 26;
    const kmLabelOffsetPx = 42;
    const maxLabelOffsetPx = Math.max(nmLabelOffsetPx, kmLabelOffsetPx);
    const edgeMarginPx = 18;

    const overflowScore = (normal) => {
        const points = [p1, p2].flatMap((point) => {
            const shifted = {
                x: point.x + normal.x * rulerOffsetPx,
                y: point.y + normal.y * rulerOffsetPx
            };
            return [
                shifted,
                {
                    x: shifted.x + normal.x * maxLabelOffsetPx,
                    y: shifted.y + normal.y * maxLabelOffsetPx
                },
                {
                    x: shifted.x - normal.x * maxLabelOffsetPx,
                    y: shifted.y - normal.y * maxLabelOffsetPx
                }
            ];
        });
        let score = 0;
        points.forEach((point) => {
            if (point.x < edgeMarginPx) score += edgeMarginPx - point.x;
            if (point.x > width - edgeMarginPx) score += point.x - (width - edgeMarginPx);
            if (point.y < edgeMarginPx) score += edgeMarginPx - point.y;
            if (point.y > height - edgeMarginPx) score += point.y - (height - edgeMarginPx);
        });
        return score;
    };

    const preferredScore = overflowScore(preferred);
    const alternateScore = overflowScore(alternate);
    const normal = alternateScore + 2 < preferredScore ? alternate : preferred;
    return { normal, rulerOffsetPx, nmLabelOffsetPx, kmLabelOffsetPx };
}

function drawTwoFingerRulerFromTouches(event) {
    const points = getTouchContainerPoints(event);
    const layer = ensureTwoFingerRulerLayer();
    if (!points || !layer || !map || !map.containerPointToLatLng || !map.distance) return;

    const [touchA, touchB] = points;
    const ll1 = map.containerPointToLatLng(touchA);
    const ll2 = map.containerPointToLatLng(touchB);

    /* v15.23 — ordre visuel stable des extrémités.
     * L'ordre event.touches dépend du doigt posé en premier et ne doit pas
     * déterminer le sens de lecture de l'échelle. Sur une règle horizontale,
     * p1 est toujours l'extrémité gauche ; si elle est quasi verticale, p1 est
     * l'extrémité haute pour éviter les inversions aléatoires.
     */
    const mostlyVertical = Math.abs(touchB.x - touchA.x) < Math.abs(touchB.y - touchA.y) * 0.18;
    const touchAComesFirst = mostlyVertical
        ? (touchA.y <= touchB.y)
        : (touchA.x <= touchB.x);
    const p1 = touchAComesFirst ? touchA : touchB;
    const p2 = touchAComesFirst ? touchB : touchA;
    const meters = map.distance(ll1, ll2);
    if (!Number.isFinite(meters) || meters <= 0) return;

    clearTwoFingerRulerLayer();

    const nm = meters / 1852;
    const km = meters / 1000;
    const { normal, rulerOffsetPx, nmLabelOffsetPx, kmLabelOffsetPx } = getTwoFingerRulerOffsetNormal(p1, p2);
    const visualOffset = L.point(normal.x * rulerOffsetPx, normal.y * rulerOffsetPx);
    const vp1 = p1.add(visualOffset);
    const vp2 = p2.add(visualOffset);
    const vll1 = map.containerPointToLatLng(vp1);
    const vll2 = map.containerPointToLatLng(vp2);
    const rulerPaneOptions = { pane: TWO_FINGER_RULER_PANE_NAME };

    /* v15.19 — même langage graphique que le vecteur temps :
     * halo noir + jaune fluorescent, au premier plan cartographique.
     */
    L.polyline([vll1, vll2], {
        ...rulerPaneOptions,
        color: '#111827',
        weight: 10,
        opacity: 0.88,
        interactive: false,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(layer);
    L.polyline([vll1, vll2], {
        ...rulerPaneOptions,
        color: '#ffea00',
        weight: 6,
        opacity: 1,
        interactive: false,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(layer);

    const dx = vp2.x - vp1.x;
    const dy = vp2.y - vp1.y;
    const tickLength = 18;
    const fractions = [0, 0.25, 0.5, 0.75, 1];

    fractions.forEach((fraction) => {
        const px = vp1.x + dx * fraction;
        const py = vp1.y + dy * fraction;
        const a = L.point(
            px - normal.x * tickLength / 2,
            py - normal.y * tickLength / 2
        );
        const b = L.point(
            px + normal.x * tickLength / 2,
            py + normal.y * tickLength / 2
        );
        const tickLatLngs = [
            map.containerPointToLatLng(a),
            map.containerPointToLatLng(b)
        ];
        const isMajor = fraction === 0 || fraction === 1 || fraction === 0.5;

        L.polyline(tickLatLngs, {
            ...rulerPaneOptions,
            color: '#111827',
            weight: isMajor ? 8 : 7,
            opacity: 0.90,
            interactive: false,
            lineCap: 'round'
        }).addTo(layer);
        L.polyline(tickLatLngs, {
            ...rulerPaneOptions,
            color: '#ffea00',
            weight: isMajor ? 5 : 4,
            opacity: 1,
            interactive: false,
            lineCap: 'round'
        }).addTo(layer);

        /* v15.23 — échelle NM : 0 à l’extrémité de départ visuelle (gauche si horizontale). */
        const nmLabelPoint = L.point(
            px + normal.x * nmLabelOffsetPx,
            py + normal.y * nmLabelOffsetPx
        );
        const displayFraction = fraction;
        const nmValueText = formatTwoFingerRulerMarkNm(nm * displayFraction, fraction === 1);
        L.marker(map.containerPointToLatLng(nmLabelPoint), {
            pane: TWO_FINGER_RULER_PANE_NAME,
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
                className: 'npf-two-finger-ruler-mark-label',
                html: `<div class="npf-two-finger-ruler-mark-value nm">${nmValueText}</div>`,
                iconSize: [108, 28],
                iconAnchor: [54, 14]
            })
        }).addTo(layer);

        /* v15.23 — échelle km : même sens que NM, mais davantage dégagée du trait. */
        const kmLabelPoint = L.point(
            px - normal.x * kmLabelOffsetPx,
            py - normal.y * kmLabelOffsetPx
        );
        const kmValueText = formatTwoFingerRulerMarkKm(km * displayFraction, fraction === 1);
        L.marker(map.containerPointToLatLng(kmLabelPoint), {
            pane: TWO_FINGER_RULER_PANE_NAME,
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
                className: 'npf-two-finger-ruler-mark-label',
                html: `<div class="npf-two-finger-ruler-mark-value km">${kmValueText}</div>`,
                iconSize: [108, 28],
                iconAnchor: [54, 14]
            })
        }).addTo(layer);
    });
}

function cancelTwoFingerRulerTimer() {
    if (twoFingerRulerTimer) {
        clearTimeout(twoFingerRulerTimer);
        twoFingerRulerTimer = null;
    }
}

function startTwoFingerRuler(event) {
    cancelTwoFingerRulerTimer();
    twoFingerRulerActive = true;
    showTwoFingerRulerHelp();
    try {
        twoFingerRulerWasDraggingEnabled = map?.dragging?.enabled ? map.dragging.enabled() : null;
        twoFingerRulerWasTouchZoomEnabled = map?.touchZoom?.enabled ? map.touchZoom.enabled() : null;
        const container = map?.getContainer ? map.getContainer() : null;
        if (container) {
            twoFingerRulerPreviousTouchAction = container.style.touchAction || '';
            container.style.touchAction = 'none';
        }
        if (map?.dragging?.disable) map.dragging.disable();
        if (map?.touchZoom?.disable) map.touchZoom.disable();
    } catch (_) {}
    if (event) {
        if (event.cancelable) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    drawTwoFingerRulerFromTouches(event);
}

function endTwoFingerRuler() {
    cancelTwoFingerRulerTimer();
    twoFingerRulerStartPoints = null;
    if (twoFingerRulerActive) {
        twoFingerRulerActive = false;
        clearTwoFingerRulerLayer();
        hideTwoFingerRulerHelp();
        try {
            if (twoFingerRulerWasDraggingEnabled && map?.dragging?.enable) map.dragging.enable();
            if (twoFingerRulerWasTouchZoomEnabled && map?.touchZoom?.enable) map.touchZoom.enable();
            const container = map?.getContainer ? map.getContainer() : null;
            if (container) container.style.touchAction = twoFingerRulerPreviousTouchAction || '';
        } catch (_) {}
    }
    twoFingerRulerWasDraggingEnabled = null;
    twoFingerRulerWasTouchZoomEnabled = null;
    twoFingerRulerPreviousTouchAction = null;
}

function handleTwoFingerRulerTouchStart(event) {
    if (!event || !event.touches || event.touches.length !== 2 || !map) {
        endTwoFingerRuler();
        return;
    }
    injectNauticalScaleStyle();
    twoFingerRulerStartPoints = getTouchContainerPoints(event);
    cancelTwoFingerRulerTimer();
    twoFingerRulerTimer = setTimeout(() => {
        if (event.touches && event.touches.length === 2) startTwoFingerRuler(event);
    }, 420);
}

function handleTwoFingerRulerTouchMove(event) {
    if (twoFingerRulerActive) {
        if (event.cancelable) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        drawTwoFingerRulerFromTouches(event);
        return;
    }
    if (!twoFingerRulerTimer || !twoFingerRulerStartPoints || !event.touches || event.touches.length !== 2) return;
    const currentPoints = getTouchContainerPoints(event);
    if (!currentPoints) return;
    const moved = Math.max(
        Math.hypot(currentPoints[0].x - twoFingerRulerStartPoints[0].x, currentPoints[0].y - twoFingerRulerStartPoints[0].y),
        Math.hypot(currentPoints[1].x - twoFingerRulerStartPoints[1].x, currentPoints[1].y - twoFingerRulerStartPoints[1].y)
    );
    if (moved > 18) cancelTwoFingerRulerTimer();
}

function handleTwoFingerRulerTouchEnd() {
    endTwoFingerRuler();
}

function ensureTwoFingerRulerControl() {
    if (!map || !map.getContainer || map.__npfTwoFingerRulerReady) return;
    const container = map.getContainer();
    container.addEventListener('touchstart', handleTwoFingerRulerTouchStart, { passive: false });
    /* v17.11 — avant les handlers Leaflet/bubble : cacher Routes/HT sur le
     * premier mouvement du même geste, sans retirer aucun renderer. */
    container.addEventListener('touchmove', handleNpfHeavyOverlayTouchPreMask, { passive: true, capture: true });
    container.addEventListener('touchmove', handleTwoFingerRulerTouchMove, { passive: false });
    container.addEventListener('touchend', handleTwoFingerRulerTouchEnd, { passive: false });
    container.addEventListener('touchcancel', handleTwoFingerRulerTouchEnd, { passive: false });
    map.__npfTwoFingerRulerReady = true;
}


function isNpfMapOverlayPrioritySequenceActive() {
    return !!npfMapOverlayPriorityActive;
}

function applyNpfMapOverlayPriorityVisibility() {
    if (!map) return;

    const active = !!npfMapOverlayPriorityActive;
    const stage = active
        ? Math.max(0, Math.min(3, Number(npfMapOverlayPriorityStage) || 0))
        : 3;

    const setPaneVisibility = (names, visible, { heavy = false } = {}) => {
        const visibility = visible ? 'visible' : 'hidden';
        names.forEach(name => {
            try {
                const pane = map.getPane?.(name);
                if (!pane) return;
                pane.style.visibility = visibility;
                if (heavy) pane.style.display = visible ? '' : 'none';
            } catch (_) {}
        });
    };

    // Étape 2 — points VFR.
    setPaneVisibility(
        ['siaPointPane', 'siaPointTouchPane'],
        !active || stage >= 1
    );

    // Étape 3 — lignes HT.
    setPaneVisibility(
        ['highVoltageLinesPane'],
        !active || stage >= 2,
        { heavy: true }
    );

    // Étape 4 — routes.
    setPaneVisibility(
        ['roadOverlayCasingPane', 'roadOverlayLinePane', 'roadOverlayLabelPane'],
        !active || stage >= 3,
        { heavy: true }
    );
}


let npfHeavyOverlayTouchPreMaskRestoreTimer = null;

function hideNpfHeavyOverlayPanesImmediately() {
    if (!map) return;
    [
        'roadOverlayCasingPane',
        'roadOverlayLinePane',
        'roadOverlayLabelPane',
        'highVoltageLinesPane'
    ].forEach(name => {
        try {
            const pane = map.getPane?.(name);
            if (pane) {
                pane.style.display = 'none';
                pane.style.visibility = 'hidden';
            }
        } catch (_) {}
    });
}

function scheduleNpfHeavyOverlayTouchPreMaskRestore() {
    if (npfHeavyOverlayTouchPreMaskRestoreTimer) {
        clearTimeout(npfHeavyOverlayTouchPreMaskRestoreTimer);
    }
    npfHeavyOverlayTouchPreMaskRestoreTimer = setTimeout(() => {
        npfHeavyOverlayTouchPreMaskRestoreTimer = null;
        if (
            !npfMapOverlayPriorityActive
            && !npfMapManualGestureLockActive
            && !twoFingerRulerActive
        ) {
            applyNpfMapOverlayPriorityVisibility();
        }
    }, 260);
}

function handleNpfHeavyOverlayTouchPreMask(event) {
    if (
        !map
        || !event?.touches
        || event.touches.length < 1
        || event.touches.length > 2
        || twoFingerRulerActive
    ) return;

    const htHeavy = !!showHighVoltageLinesLayer
        && !!hasLoadedHighVoltageLines
        && isHighVoltageLayerEffectiveAtCurrentScale();
    const routesHeavy = !!showRoadOverlayLayer && getRoadOverlayZoomTier() > 0;
    if (!htHeavy && !routesHeavy) return;

    /*
     * v17.11 — pré-masquage tactile avant Leaflet.
     *
     * Le listener est installé en phase CAPTURE. Au tout premier `touchmove`,
     * les panes Routes/HT passent donc en `display:none` avant que Leaflet ne
     * traite ce même mouvement comme pan/pinch. Aucune couche, aucun renderer,
     * aucune géométrie n'est retiré de `map` ici.
     *
     * Si le mouvement ne devient finalement pas un geste Leaflet, un petit
     * filet de sécurité restaure l'affichage automatiquement.
     */
    hideNpfHeavyOverlayPanesImmediately();
    scheduleNpfHeavyOverlayTouchPreMaskRestore();
}

function suspendNpfHeavyOverlayRenderersForMapMotion(reason = 'map-start') {
    if (!map) return;

    /*
     * v17.11 — aucun démontage au premier geste.
     *
     * v17.10 retirait encore les trois renderers Canvas via `map.removeLayer()`.
     * Le DIAG utilisateur montre que cette première opération pouvait consommer
     * le premier pan/pinch : les calques disparaissaient, puis la seconde
     * tentative devenait fluide.
     *
     * Les renderers, LayerGroup et Paths restent désormais attachés à Leaflet
     * en permanence. Pendant le geste on ne fait qu'un changement CSS borné :
     * `display:none` + `visibility:hidden` sur les panes lourds.
     */
    if (npfHeavyOverlayTouchPreMaskRestoreTimer) {
        clearTimeout(npfHeavyOverlayTouchPreMaskRestoreTimer);
        npfHeavyOverlayTouchPreMaskRestoreTimer = null;
    }
    hideNpfHeavyOverlayPanesImmediately();
    npfHeavyOverlayPanesHidden = true;
}

function resumeNpfHeavyOverlayRenderersWithoutRefresh(reason = 'restore') {
    if (!map) return;

    /*
     * v17.11 — rien à rattacher : les renderers n'ont jamais quitté `map`.
     * Cette fonction ne fait que restaurer la visibilité correspondant à
     * l'état courant du séquenceur, sans scan ni recalcul lourd.
     */
    if (npfHeavyOverlayTouchPreMaskRestoreTimer) {
        clearTimeout(npfHeavyOverlayTouchPreMaskRestoreTimer);
        npfHeavyOverlayTouchPreMaskRestoreTimer = null;
    }
    npfHeavyOverlayPanesHidden = false;
    applyNpfMapOverlayPriorityVisibility();
}

function beginNpfMapOverlayPrioritySequence(reason = 'map-start') {
    /*
     * v17.07 — verrou de geste réel.
     *
     * Tant qu'un geste manuel n'est pas stabilisé, Leaflet peut émettre
     * plusieurs movestart/zoomstart. Ils appartiennent tous à la même séquence.
     * On ne réincrémente donc ni token, ni génération, ni epoch overlay.
     */
    if (npfMapManualGestureLockActive) {
        if (npfMapOverlayPriorityRestoreTimer) {
            clearTimeout(npfMapOverlayPriorityRestoreTimer);
            npfMapOverlayPriorityRestoreTimer = null;
        }
        return false;
    }

    npfMapManualGestureLockActive = true;
    npfMapOverlayPriorityToken += 1;
    npfMapOverlayPriorityActive = true;
    npfMapOverlayPriorityStage = 0;

    if (npfMapOverlayPriorityRestoreTimer) {
        clearTimeout(npfMapOverlayPriorityRestoreTimer);
        npfMapOverlayPriorityRestoreTimer = null;
    }

    /*
     * Toute reconstruction ancienne devient inutile pendant le geste.
     * On annule uniquement les travaux VFR/HT/Routes, jamais les lectures
     * de tuiles IndexedDB.
     */
    clearTimeout(roadOverlayRefreshTimer);
    roadOverlayRefreshTimer = null;
    roadOverlayRefreshToken += 1;

    clearTimeout(highVoltageLinesRefreshTimer);
    highVoltageLinesRefreshTimer = null;
    highVoltageLinesRefreshToken += 1;

    window.__npfSiaRefreshGeneration =
        (Number(window.__npfSiaRefreshGeneration) || 0) + 1;
    if (siaRefreshTimer) {
        clearTimeout(siaRefreshTimer);
        siaRefreshTimer = null;
    }

    if (npfHeavyOverlayZoomOutPromise || npfHeavyOverlayZoomSettleTimer) {
        try { cancelPendingSerializedHeavyOverlayZoomOut('priorité-carte-v17.11'); }
        catch (_) {}
    }

    /*
     * v17.11 — aucun retrait Leaflet : le geste ne fait que maintenir les panes
     * lourds masqués. Le pré-masquage tactile a déjà pu les cacher avant le
     * premier mouvement traité par Leaflet.
     */
    suspendNpfHeavyOverlayRenderersForMapMotion(reason);
    applyNpfMapOverlayPriorityVisibility();

    if (reason) {
        recordNpfStartupDiagnosticOverlaySnapshot(
            `priorité carte · début geste verrouillé · ${reason}`
        );
    }

    return true;
}

/*
 * v17.03 — attente dédiée à la priorité carte.
 * IMPORTANT : lecture seule de l'état des tuiles. Cette fonction ne modifie
 * ni la file, ni les epochs, ni IndexedDB, ni le cache.
 */
async function waitForNpfMapOverlayPriorityTilesSettled(token) {
    let stablePasses = 0;

    while (
        token === npfMapOverlayPriorityToken
        && npfMapOverlayPriorityActive
    ) {
        const state = typeof getVisibleBaseTileLoadStateForSia === 'function'
            ? getVisibleBaseTileLoadStateForSia()
            : {
                total: getNpfRetainedBaseTileCount(),
                loaded: countVisibleLoadedBaseTiles(),
                tileZoomReady: true
            };

        const queued = Math.max(
            0,
            Number(directOfflineNpfReadQueue?.length || 0)
        );
        const activeReads = Math.max(
            0,
            Number(directOfflineNpfActiveReads || 0)
        );

        const allVisibleLoaded = (
            state.total > 0
            && state.loaded >= state.total
            && state.tileZoomReady
        );

        /*
         * Si certaines coordonnées ne possèdent réellement aucune tuile,
         * loaded peut rester inférieur à total. Dans ce cas, "terminé" signifie
         * que le moteur de référence n'a strictement plus rien à lire.
         */
        const schedulerIdle = (
            queued === 0
            && activeReads === 0
            && state.tileZoomReady
        );

        if (allVisibleLoaded || schedulerIdle) {
            stablePasses += 1;
            if (
                stablePasses
                >= NPF_MAP_OVERLAY_PRIORITY_TILE_STABLE_PASSES
            ) {
                await new Promise(resolve => {
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(() => resolve());
                    } else {
                        setTimeout(resolve, 0);
                    }
                });

                return (
                    token === npfMapOverlayPriorityToken
                    && npfMapOverlayPriorityActive
                );
            }
        } else {
            stablePasses = 0;
        }

        await new Promise(resolve => setTimeout(
            resolve,
            NPF_MAP_OVERLAY_PRIORITY_TILE_POLL_MS
        ));
    }

    return false;
}

async function waitForNpfMapOverlayPrioritySiaIdle(token) {
    while (
        token === npfMapOverlayPriorityToken
        && npfMapOverlayPriorityActive
        && (
            siaRefreshTimer
            || siaRefreshInProgress
        )
    ) {
        await new Promise(resolve => setTimeout(
            resolve,
            NPF_MAP_OVERLAY_PRIORITY_SIA_POLL_MS
        ));
    }

    return (
        token === npfMapOverlayPriorityToken
        && npfMapOverlayPriorityActive
    );
}

async function runNpfMapOverlayPriorityRestore(token, reason = 'map-end') {
    if (
        token !== npfMapOverlayPriorityToken
        || !npfMapOverlayPriorityActive
        || !map
    ) return;

    const isCancelled = () => (
        token !== npfMapOverlayPriorityToken
        || !npfMapOverlayPriorityActive
    );

    /*
     * 1 — TUILES
     * Lecture seule de l'état Leaflet/DOM : aucune priorité, aucun epoch,
     * aucune transaction IndexedDB et aucun scheduler de tuiles n'est modifié.
     */
    const tilesSettled = await waitForNpfMapOverlayPriorityTilesSettled(token);
    if (!tilesSettled || isCancelled()) return;

    /*
     * 2 — POINTS VFR
     * Le pane reste encore masqué pendant la reconstruction SIA. Les points
     * n'apparaissent qu'une fois la vue finale recalculée : aucun ancien rendu
     * VFR n'est brièvement montré avant le nouveau.
     */
    if (typeof hasAnyEnabledSiaFilter !== 'function' || hasAnyEnabledSiaFilter()) {
        try {
            scheduleSiaLayerRefresh('overlay-priority-vfr');
            await waitForNpfMapOverlayPrioritySiaIdle(token);
        } catch (_) {}
    }
    if (isCancelled()) return;

    npfMapOverlayPriorityStage = 1;
    applyNpfMapOverlayPriorityVisibility();
    recordNpfStartupDiagnosticOverlaySnapshot(
        `priorité carte · VFR prêt · ${reason}`
    );

    /*
     * 3 — LIGNES HT
     * Le pane reste caché pendant la reconstruction, puis est révélé une fois
     * le rendu du viewport final terminé.
     */
    if (showHighVoltageLinesLayer) {
        try {
            if (!isHighVoltageLayerEffectiveAtCurrentScale()) {
                suppressHighVoltageLinesForWideScale('overlay-priority-ht');
            } else if (!hasLoadedHighVoltageLines && !isHighVoltageLinesLoading) {
                /* v17.21 — retour sous 50 NM : charger HT seulement maintenant. */
                highVoltageLinesScaleSuppressed = false;
                await toggleHighVoltageLinesLayer(true, {
                    silent: true,
                    retry: true,
                    source: 'overlay-priority-scale-enter'
                });
                /* v17.24 — au premier passage 50 -> 20 NM, le chargement HT a
                 * lieu alors que la séquence prioritaire est encore active.
                 * `toggleHighVoltageLinesLayer()` construit le rendu mais ne peut
                 * pas rattacher son groupe parent dans cet état. Le rattacher ici,
                 * pane encore masqué, avant l'étape qui révèle les HT. */
                if (
                    !isCancelled()
                    && hasLoadedHighVoltageLines
                    && highVoltageLinesLayer
                    && !map.hasLayer(highVoltageLinesLayer)
                ) {
                    highVoltageLinesLayer.addTo(map);
                }
            } else if (hasLoadedHighVoltageLines) {
                highVoltageLinesScaleSuppressed = false;
                if (highVoltageLinesLayer && !map.hasLayer(highVoltageLinesLayer)) {
                    highVoltageLinesLayer.addTo(map);
                }
                await refreshVisibleHighVoltageLines('overlay-priority-ht');
            }
        } catch (error) {
            console.warn(
                'Restitution prioritaire lignes HT impossible:',
                error
            );
        }
    }
    if (isCancelled()) return;

    npfMapOverlayPriorityStage = 2;
    applyNpfMapOverlayPriorityVisibility();
    recordNpfStartupDiagnosticOverlaySnapshot(
        `priorité carte · HT prêt · ${reason}`
    );

    /*
     * 4 — ROUTES
     * Dernier calque lourd réactivé/reconstruit.
     */
    if (showRoadOverlayLayer) {
        try {
            const tier = getRoadOverlayZoomTier();
            if (tier > 0) {
                /*
                 * v17.13 — même protection que HT : si Routes a été laissé
                 * détaché par un démarrage/tier 0 antérieur, rattacher le
                 * LayerGroup avant le recalcul. Le pane Routes est encore
                 * masqué à ce stade ; le fond reste donc prioritaire.
                 * Sur un geste normal, le groupe est déjà présent et aucun
                 * travail supplémentaire n'est effectué.
                 */
                if (roadOverlayLayer && !map.hasLayer(roadOverlayLayer)) {
                    roadOverlayLayer.addTo(map);
                }
                await refreshRoadOverlayVisibleParts(
                    'overlay-priority-routes'
                );
            } else {
                roadOverlayRefreshToken += 1;
                clearTimeout(roadOverlayRefreshTimer);
                roadOverlayRefreshTimer = null;
                roadOverlayLoadedZoomTier = 0;

                /*
                 * v17.10 — au tier 0 le parent reste attaché, donc les anciennes
                 * géométries doivent être libérées progressivement après les
                 * tuiles. Le token série permet à un nouveau geste d'interrompre
                 * ce nettoyage sans bloquer le pinch.
                 */
                if (loadedRoadOverlayParts.size || roadOverlaySourceParts.size) {
                    const cleanupToken = npfHeavyOverlayZoomSerialToken;
                    await clearRoadOverlayRenderedPartsProgressively(
                        { resetTier: false, clearSources: true },
                        cleanupToken
                    );
                }
            }
        } catch (error) {
            console.warn(
                'Restitution prioritaire Routes impossible:',
                error
            );
        }
    }
    if (isCancelled()) return;

    npfMapOverlayPriorityStage = 3;
    npfMapOverlayPriorityActive = false;
    npfMapManualGestureLockActive = false;
    applyNpfMapOverlayPriorityVisibility();

    /*
     * Réinitialiser l'ancien état de zoom lourd afin qu'il ne puisse pas
     * déclencher ensuite une séquence Routes/HT héritée.
     */
    npfHeavyOverlayZoomStartLevel = null;
    npfHeavyOverlayPanesHidden = false;

    recordNpfStartupDiagnosticOverlaySnapshot(
        `priorité carte · fin · ${reason}`
    );
}


function cancelNpfMapOverlayPriorityForGpsResume(reason = 'gps-resume') {
    if (!npfMapOverlayPriorityActive) return false;

    /*
     * v17.05 — un suivi GPS qui reprend après un geste manuel invalide la
     * séquence de restitution liée à l'ancien viewport.
     *
     * IMPORTANT :
     * - aucune lecture de tuile n'est annulée ;
     * - aucun refresh SIA/HT/Routes n'est lancé ici ;
     * - on remet simplement les panes visibles ;
     * - les mécanismes historiques gps-follow / gps-follow-edge reprendront.
     */
    npfMapOverlayPriorityToken += 1;

    if (npfMapOverlayPriorityRestoreTimer) {
        clearTimeout(npfMapOverlayPriorityRestoreTimer);
        npfMapOverlayPriorityRestoreTimer = null;
    }

    npfMapOverlayPriorityStage = 3;
    npfMapOverlayPriorityActive = false;
    npfMapManualGestureLockActive = false;

    /*
     * Ne pas appeler setNpfHeavyOverlayPanesHidden(false) ici : pendant la
     * séquence prioritaire il peut être court-circuité par sa protection.
     * On rétablit directement la visibilité des panes via la fonction dédiée.
     */
    applyNpfMapOverlayPriorityVisibility();
    npfHeavyOverlayPanesHidden = false;

    /*
     * v17.10 — les renderers Routes/HT ont pu être suspendus par le geste
     * manuel précédent. La reprise GPS les réactive immédiatement, sans
     * recalcul lourd ni réattachement des LayerGroup.
     */
    resumeNpfHeavyOverlayRenderersWithoutRefresh(`reprise GPS · ${reason}`);

    recordNpfStartupDiagnosticOverlaySnapshot(
        `priorité carte · annulée reprise GPS · ${reason}`
    );

    return true;
}

function scheduleNpfMapOverlayPriorityRestore(reason = 'map-end') {
    if (!npfMapOverlayPriorityActive) return;

    const token = npfMapOverlayPriorityToken;

    if (npfMapOverlayPriorityRestoreTimer) {
        clearTimeout(npfMapOverlayPriorityRestoreTimer);
        npfMapOverlayPriorityRestoreTimer = null;
    }

    /*
     * v17.07 — ne pas considérer moveend/zoomend comme fin définitive du geste.
     * On attend 500 ms de calme. Tout nouveau start/end repousse cette échéance.
     *
     * Une fois le calme confirmé, le verrou est libéré et la restitution de la
     * vue finale peut commencer. Si un nouveau geste démarre ensuite pendant la
     * restitution, begin() créera une nouvelle séquence et invalidera l'ancienne
     * par son token, ce qui est le comportement voulu.
     */
    npfMapOverlayPriorityRestoreTimer = setTimeout(() => {
        npfMapOverlayPriorityRestoreTimer = null;
        npfMapManualGestureLockActive = false;

        runNpfMapOverlayPriorityRestore(token, reason).catch(error => {
            console.warn('Séquence prioritaire carte impossible:', error);
            if (
                token === npfMapOverlayPriorityToken
                && npfMapOverlayPriorityActive
            ) {
                npfMapOverlayPriorityStage = 3;
                npfMapOverlayPriorityActive = false;
                npfMapManualGestureLockActive = false;
                applyNpfMapOverlayPriorityVisibility();
                resumeNpfHeavyOverlayRenderersWithoutRefresh('erreur restitution');
            }
        });
    }, NPF_MAP_MANUAL_GESTURE_SETTLE_MS);
}

/*
 * v17.15 — continuité visuelle du fond NPF pendant un changement de zoom.
 *
 * Leaflet reste seul propriétaire de la GridLayer réelle : aucune tuile, aucun
 * niveau ni aucune méthode interne (`_pruneTiles`) n'est retenu/modifié ici.
 * On duplique uniquement le DOM déjà peint AVANT le zoom dans un calque visuel
 * indépendant placé derrière la GridLayer active. Au zoomend, ce snapshot est
 * recalé sur la nouvelle vue puis supprimé dès que toutes les tuiles visibles
 * du niveau courant sont peintes (ou au timeout de sécurité).
 *
 * Ce snapshot n'est pas enfant de `baseTileLayer.getContainer()` : il est donc
 * ignoré par les diagnostics, les attentes tuiles et toute la logique métier.
 */
let npfBaseTileZoomVisualSnapshot = null;
let npfBaseTileZoomVisualSnapshotState = null;
let npfBaseTileZoomVisualSnapshotTimer = null;
let npfBaseTileZoomVisualSnapshotToken = 0;
const NPF_BASE_TILE_ZOOM_VISUAL_MAX_HOLD_MS = 2600;
const NPF_BASE_TILE_ZOOM_VISUAL_POLL_MS = 40;

function clearNpfBaseTileZoomVisualSnapshot(reason = 'clear') {
    npfBaseTileZoomVisualSnapshotToken += 1;
    if (npfBaseTileZoomVisualSnapshotTimer) {
        clearTimeout(npfBaseTileZoomVisualSnapshotTimer);
        npfBaseTileZoomVisualSnapshotTimer = null;
    }
    const snapshot = npfBaseTileZoomVisualSnapshot;
    npfBaseTileZoomVisualSnapshot = null;
    npfBaseTileZoomVisualSnapshotState = null;
    if (snapshot) {
        try { snapshot.remove(); } catch (_) {
            try { snapshot.parentNode?.removeChild(snapshot); } catch (_) {}
        }
    }
}

function beginNpfBaseTileZoomVisualSnapshot(reason = 'zoomstart') {
    if (
        !map
        || !baseTileLayer
        || !offlineTilesMode
        || typeof isNpfOfflinePackSelection !== 'function'
        || !isNpfOfflinePackSelection()
    ) return false;

    /* Un pinch Safari peut émettre plusieurs zoomstart : conserver le premier
     * snapshot complet du geste au lieu de le remplacer par une vue partielle. */
    if (npfBaseTileZoomVisualSnapshot && npfBaseTileZoomVisualSnapshotState) {
        return true;
    }

    try {
        const sourceContainer = baseTileLayer.getContainer?.();
        const tilePane = map.getPane?.('tilePane');
        const oldZoom = Number(map.getZoom?.());
        const oldOrigin = map.getPixelOrigin?.();
        if (
            !sourceContainer
            || !tilePane
            || !Number.isFinite(oldZoom)
            || !oldOrigin
            || !Number.isFinite(Number(oldOrigin.x))
            || !Number.isFinite(Number(oldOrigin.y))
        ) return false;

        const paintedTiles = sourceContainer.querySelectorAll(
            'img.leaflet-tile.leaflet-tile-loaded'
        );
        if (!paintedTiles.length) return false;

        const root = document.createElement('div');
        root.className = 'npf-base-tile-zoom-visual-snapshot';
        root.setAttribute('aria-hidden', 'true');
        root.style.position = 'absolute';
        root.style.left = '0';
        root.style.top = '0';
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.pointerEvents = 'none';
        root.style.transformOrigin = '0 0';
        root.style.willChange = 'transform';
        root.style.zIndex = '0';

        const clone = sourceContainer.cloneNode(true);
        clone.classList.add('npf-base-tile-zoom-visual-snapshot-layer');
        clone.setAttribute('aria-hidden', 'true');
        clone.style.pointerEvents = 'none';

        /* Les tuiles non encore peintes ne doivent jamais apparaître dans le
         * snapshot. Les images déjà décodées restent purement visuelles. */
        clone.querySelectorAll('img.leaflet-tile:not(.leaflet-tile-loaded)')
            .forEach(tile => {
                try { tile.remove(); } catch (_) {}
            });
        clone.querySelectorAll('img.leaflet-tile').forEach(tile => {
            tile.style.pointerEvents = 'none';
            tile.draggable = false;
        });

        root.appendChild(clone);
        /* Insérer AVANT la GridLayer réelle : chaque nouvelle tuile chargée se
         * peint naturellement au-dessus du snapshot sans aucune commutation. */
        tilePane.insertBefore(root, sourceContainer);

        npfBaseTileZoomVisualSnapshot = root;
        npfBaseTileZoomVisualSnapshotState = {
            oldZoom,
            oldOriginX: Number(oldOrigin.x),
            oldOriginY: Number(oldOrigin.y),
            startedAt: Date.now(),
            reason: String(reason || '')
        };
        npfBaseTileZoomVisualSnapshotToken += 1;
        return true;
    } catch (_) {
        clearNpfBaseTileZoomVisualSnapshot('capture-error');
        return false;
    }
}

function getNpfCurrentZoomVisibleTileCoverage() {
    if (!map || !baseTileLayer) return { total: 0, loaded: 0 };
    try {
        const mapContainer = map.getContainer?.();
        const tiles = baseTileLayer._tiles || {};
        const tileZoom = Number(baseTileLayer._tileZoom);
        const mapZoom = Number(map.getZoom?.());
        const targetZoom = Number.isFinite(tileZoom)
            ? Math.round(tileZoom)
            : Math.round(mapZoom);
        if (!mapContainer || !Number.isFinite(targetZoom)) {
            return { total: 0, loaded: 0 };
        }

        const mapRect = mapContainer.getBoundingClientRect();
        let total = 0;
        let loaded = 0;
        Object.values(tiles).forEach(entry => {
            const coords = entry?.coords;
            const tile = entry?.el;
            if (!coords || !tile || Number(coords.z) !== targetZoom) return;
            if (tile.style?.display === 'none') return;

            const rect = tile.getBoundingClientRect();
            if (
                rect.width <= 1
                || rect.height <= 1
                || rect.right <= mapRect.left
                || rect.left >= mapRect.right
                || rect.bottom <= mapRect.top
                || rect.top >= mapRect.bottom
            ) return;

            total += 1;
            if (
                tile.classList?.contains('leaflet-tile-loaded')
                || (tile.complete && Number(tile.naturalWidth) > 0)
            ) loaded += 1;
        });
        return { total, loaded };
    } catch (_) {
        return { total: 0, loaded: 0 };
    }
}

function settleNpfBaseTileZoomVisualSnapshot(reason = 'zoomend') {
    const snapshot = npfBaseTileZoomVisualSnapshot;
    const state = npfBaseTileZoomVisualSnapshotState;
    if (!snapshot || !state || !map) return;

    try {
        const newZoom = Number(map.getZoom?.());
        const newOrigin = map.getPixelOrigin?.();
        if (
            Number.isFinite(newZoom)
            && newOrigin
            && Number.isFinite(Number(newOrigin.x))
            && Number.isFinite(Number(newOrigin.y))
        ) {
            const scale = Number(map.getZoomScale?.(newZoom, state.oldZoom));
            if (Number.isFinite(scale) && scale > 0) {
                const tx = scale * state.oldOriginX - Number(newOrigin.x);
                const ty = scale * state.oldOriginY - Number(newOrigin.y);
                /* Matrice explicite : x' = scale*x + tx, y' = scale*y + ty. */
                snapshot.style.transform = `matrix(${scale},0,0,${scale},${tx},${ty})`;
            }
        }
    } catch (_) {}

    if (npfBaseTileZoomVisualSnapshotTimer) {
        clearTimeout(npfBaseTileZoomVisualSnapshotTimer);
        npfBaseTileZoomVisualSnapshotTimer = null;
    }
    const token = ++npfBaseTileZoomVisualSnapshotToken;
    const settleStartedAt = Date.now();

    const check = () => {
        if (
            token !== npfBaseTileZoomVisualSnapshotToken
            || snapshot !== npfBaseTileZoomVisualSnapshot
        ) return;

        const coverage = getNpfCurrentZoomVisibleTileCoverage();
        if (coverage.total > 0 && coverage.loaded >= coverage.total) {
            clearNpfBaseTileZoomVisualSnapshot('current-level-ready');
            return;
        }

        if (Date.now() - settleStartedAt >= NPF_BASE_TILE_ZOOM_VISUAL_MAX_HOLD_MS) {
            clearNpfBaseTileZoomVisualSnapshot('timeout');
            return;
        }

        npfBaseTileZoomVisualSnapshotTimer = setTimeout(
            check,
            NPF_BASE_TILE_ZOOM_VISUAL_POLL_MS
        );
    };

    npfBaseTileZoomVisualSnapshotTimer = setTimeout(check, 0);
}

