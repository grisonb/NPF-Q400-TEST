// =========================================================================
// v15.49 — APPUI LONG CARTE POUR CRÉER UN FEU : 1,2 s
// =========================================================================

const NPF_FIRE_LONG_PRESS_DELAY_MS = 1200;
const NPF_FIRE_LONG_PRESS_MOVE_TOLERANCE_PX = 14;

async function createManualFireAtLatLng(latlng) {
    if (!latlng) return;

    selectedPelicanOACI = null;
    const manualCommune = await buildManualFireCommuneFromPointAsync(
        latlng.lat,
        latlng.lng,
        'Feu manuel'
    );
    currentCommune = manualCommune;
    localStorage.setItem('currentCommune', JSON.stringify(manualCommune));
    displayCommuneDetails(manualCommune, false);
    armNpfFirePelicAutoCycle('fire');
}

function openMapLongPressActionPopup(latlng, zoneCandidates = [], options = {}) {
    if (!map || !latlng) return;

    const safeZoneCandidates = Array.isArray(zoneCandidates) ? zoneCandidates : [];
    const simulation = options?.simulation === true;

    const container = document.createElement('div');
    container.className = 'npf-map-longpress-actions';

    /*
     * v15.77 — même menu d'appui long en exploitation normale et en simulation.
     * La simulation ajoute seulement « Positionner avion » ; Créer Feu et
     * Sélection Zone conservent exactement le même point d'appui.
     */
    if (simulation) {
        const aircraftButton = document.createElement('button');
        aircraftButton.type = 'button';
        aircraftButton.className = 'npf-map-longpress-action simulation-aircraft-btn';
        aircraftButton.textContent = 'Positionner avion';
        aircraftButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            try { map.closePopup(); } catch (_) {}
            applySimulatedUserPosition(latlng.lat, latlng.lng);
        });
        container.appendChild(aircraftButton);
    }

    const fireButton = document.createElement('button');
    fireButton.type = 'button';
    fireButton.className = 'npf-map-longpress-action npf-map-longpress-fire';
    fireButton.textContent = 'Créer Feu';

    const wpButton = document.createElement('button');
    wpButton.type = 'button';
    wpButton.className = 'npf-map-longpress-action npf-map-longpress-wp';
    wpButton.textContent = 'Ajout WP';

    const zoneButton = document.createElement('button');
    zoneButton.type = 'button';
    zoneButton.className = 'npf-map-longpress-action npf-map-longpress-zone';
    zoneButton.textContent = 'Sélection Zone';
    zoneButton.disabled = safeZoneCandidates.length === 0;
    if (!safeZoneCandidates.length) {
        zoneButton.title = 'Aucune zone SIA à cet endroit';
        zoneButton.setAttribute('aria-disabled', 'true');
    }

    fireButton.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        try { map.closePopup(); } catch (_) {}

        if (simulation) {
            await createSimulatedFireAtPoint(latlng.lat, latlng.lng);
        } else {
            await createManualFireAtLatLng(latlng);
        }
    });

    wpButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        try { map.closePopup(); } catch (_) {}
        addNpfWaypointFromMapLatLng(latlng);
    });

    zoneButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (zoneButton.disabled) return;

        try { map.closePopup(); } catch (_) {}

        /*
         * On recalcule les candidats au moment du choix. En mode Suivi la popup
         * n'auto-pan plus, mais cette vérification reste utile après tout refresh SIA.
         */
        let currentCandidates = [];
        try {
            currentCandidates = getSiaAirspaceTouchCandidates(latlng);
        } catch (_) {}
        if (!currentCandidates.length) currentCandidates = safeZoneCandidates;
        if (!currentCandidates.length) return;

        if (currentCandidates.length === 1) {
            selectSiaCtrTouchLayer(
                currentCandidates[0].layer,
                currentCandidates[0].item,
                latlng,
                currentCandidates[0].geometry
            );
            return;
        }

        openSiaAirspaceChoicePopup(latlng, currentCandidates);
    });

    container.appendChild(fireButton);
    container.appendChild(wpButton);
    container.appendChild(zoneButton);

    const actionPopup = L.popup({
        maxWidth: 280,
        closeButton: true,
        autoPan: !centerGpsFollowActive,
        keepInView: !centerGpsFollowActive
    })
        .setLatLng(latlng)
        .setContent(container)
        .openOn(map);

    if (simulation) {
        simulationActionPopup = actionPopup;
    }
}

async function executeMapLongPressAction(latlng) {
    if (isDrawingMode) return;
    if (!latlng) return;

    /*
     * v16.12 — si l'appui tombe sur/au voisinage immédiat d'un losange WP,
     * le WP est prioritaire. On n'ouvre donc jamais à cet endroit le menu
     * Créer Feu / Ajout WP / Sélection Zone.
     */
    if (window.__npfWaypointRouteReady === true
        && openNpfWaypointPopupNearLatLng(latlng, NPF_WAYPOINT_SELECT_TOLERANCE_PX)) {
        return;
    }

    if (isSimulationMode) {
        simulationSuppressNextClickUntil = Date.now() + 900;
    }

    /*
     * v16.11 — priorité à la route WP : un appui long au voisinage d'un segment
     * insère directement un WP intermédiaire et ouvre son mode Déplacer.
     * Ailleurs, le menu historique Créer Feu / Ajout WP / Sélection Zone reste
     * strictement inchangé.
     */
    if (window.__npfWaypointRouteReady === true && handleNpfWaypointRouteLongPress(latlng)) {
        return;
    }

    /*
     * v15.77 — l'appui long utilise une logique unique en mode normal et SIM.
     * Le SIV reste recherché à la demande même lorsque son calque graphique est
     * masqué, conformément au comportement v15.74.
     */
    let zoneCandidates = [];
    try {
        if (!siaDataset && typeof ensureSiaDatasetLoaded === 'function') {
            await ensureSiaDatasetLoaded({
                full: true,
                reason: 'appui-long-zone'
            });
        }
        if (typeof getSiaAirspaceTouchCandidates === 'function') {
            zoneCandidates = getSiaAirspaceTouchCandidates(latlng);
        }
    } catch (_) {
        zoneCandidates = [];
    }

    openMapLongPressActionPopup(latlng, zoneCandidates, {
        simulation: isSimulationMode
    });
}

function installMapFireLongPressDelay() {
    if (!map || !map.getContainer) return;
    const container = map.getContainer();
    if (!container || container.dataset.fireLongPressDelayInstalled === '1') return;
    container.dataset.fireLongPressDelayInstalled = '1';

    const state = window.__npfFireLongPressTouchState = {
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        timer: null,
        longPressTriggered: false,
        suppressContextMenuUntil: 0,
        suppressSyntheticClickUntil: 0,
        suppressClickX: 0,
        suppressClickY: 0
    };

    const clearTimer = () => {
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
    };

    const resetGesture = ({ keepTriggered = false } = {}) => {
        clearTimer();
        state.active = false;
        state.pointerId = null;
        if (!keepTriggered) state.longPressTriggered = false;
    };

    const isInteractiveTarget = target => {
        try {
            if (target?.closest?.('.sia-airspace-touch-surface')) return false;

            return !!target?.closest?.(
                '.leaflet-control, .leaflet-popup, .leaflet-marker-icon, .leaflet-interactive, button, input, textarea, select, a'
            );
        } catch (_) {
            return false;
        }
    };

    /*
     * Safari peut produire un click synthétique au relâchement. On le bloque
     * uniquement près du point d'appui et jamais s'il vise déjà une popup.
     */
    container.addEventListener('click', event => {
        if (Date.now() >= Number(state.suppressSyntheticClickUntil || 0)) return;
        if (event?.target?.closest?.('.leaflet-popup')) return;

        const dx = (Number(event.clientX) || 0) - Number(state.suppressClickX || 0);
        const dy = (Number(event.clientY) || 0) - Number(state.suppressClickY || 0);
        if (Math.hypot(dx, dy) > 52) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        state.suppressSyntheticClickUntil = 0;
    }, true);

    container.addEventListener('pointerdown', event => {
        if (String(event.pointerType || '').toLowerCase() !== 'touch') return;

        if (event.isPrimary === false) {
            resetGesture();
            return;
        }

        if (isDrawingMode || isInteractiveTarget(event.target)) {
            resetGesture();
            return;
        }

        resetGesture();
        state.active = true;
        state.pointerId = event.pointerId;
        state.startX = Number(event.clientX) || 0;
        state.startY = Number(event.clientY) || 0;

        state.timer = setTimeout(async () => {
            if (!state.active || state.pointerId !== event.pointerId) return;

            const rect = container.getBoundingClientRect();
            const point = L.point(
                state.startX - rect.left,
                state.startY - rect.top
            );
            const latlng = map.containerPointToLatLng(point);

            state.timer = null;
            state.longPressTriggered = true;
            state.suppressContextMenuUntil = Date.now() + 1800;
            state.suppressSyntheticClickUntil = Date.now() + 1800;
            state.suppressClickX = state.startX;
            state.suppressClickY = state.startY;

            try {
                if (navigator.vibrate) navigator.vibrate(30);
            } catch (_) {}

            /*
             * v15.60 — la fenêtre apparaît DÈS les 1,2 s atteintes,
             * pendant que le doigt est encore posé.
             */
            await executeMapLongPressAction(latlng);
        }, NPF_FIRE_LONG_PRESS_DELAY_MS);
    }, { passive: true });

    container.addEventListener('pointermove', event => {
        if (!state.active || state.pointerId !== event.pointerId) return;
        const dx = (Number(event.clientX) || 0) - state.startX;
        const dy = (Number(event.clientY) || 0) - state.startY;

        if (Math.hypot(dx, dy) > NPF_FIRE_LONG_PRESS_MOVE_TOLERANCE_PX) {
            // Après déclenchement, le popup reste maître : un petit mouvement
            // dû au relâchement ne doit pas l'effacer.
            if (!state.longPressTriggered) resetGesture();
        }
    }, { passive: true });

    container.addEventListener('pointerup', event => {
        if (state.pointerId !== null
            && event.pointerId !== undefined
            && event.pointerId !== state.pointerId) {
            return;
        }

        if (state.longPressTriggered) {
            // Prolonge la protection jusqu'après le clic synthétique Safari.
            state.suppressContextMenuUntil = Date.now() + 1200;
            state.suppressSyntheticClickUntil = Date.now() + 1000;
        }

        resetGesture({ keepTriggered: true });

        // Le flag n'est utile que pour couvrir le relâchement immédiat.
        setTimeout(() => {
            state.longPressTriggered = false;
        }, 1050);
    }, { passive: true });

    ['pointercancel', 'lostpointercapture'].forEach(type => {
        container.addEventListener(type, event => {
            if (state.pointerId !== null
                && event.pointerId !== undefined
                && event.pointerId !== state.pointerId) {
                return;
            }
            resetGesture();
        }, { passive: true });
    });
}


