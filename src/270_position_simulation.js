function updateUserPosition(pos) {
    if (!pos || !pos.coords) return;

    const isSimulationPosition = pos.npfIsSimulation === true;
    if (isSimulationMode && !isSimulationPosition) {
        return;
    }

    const { latitude, longitude } = pos.coords;
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return;

    const ownAltitudeLabel = isSimulationPosition
        ? `${Math.round(simulationAltitudeFt)} ft`
        : (shouldShowOwnGpsAltitude() ? formatGpsAltitudeFtFromCoords(pos.coords) : '');
    const gpsTimestampMs = Number(pos.timestamp) || Date.now();
    try { npfDiagGpsPosition(pos.coords, gpsTimestampMs); } catch (_) {}
    const estimatedMotion = isSimulationPosition ? { heading: null, speed: null } : estimateMotionFromLastPosition(latitude, longitude, gpsTimestampMs);
    const rawHeading = Number(pos.coords.heading);
    const rawSpeed = Number(pos.coords.speed);
    const motionHeading = Number.isFinite(rawHeading) ? rawHeading : estimatedMotion.heading;
    const motionSpeed = Number.isFinite(rawSpeed) ? rawSpeed : estimatedMotion.speed;

    const isSimulationMotionTick = isSimulationPosition && pos.npfSimulationMotionTick === true;
    const forceSimulationRefresh = isSimulationPosition && pos.npfSimulationForceRefresh === true;
    const simulationRefreshNowMs = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
    let simulationVisualRefreshDue = true;
    let simulationHeavyRefreshDue = true;

    if (isSimulationPosition) {
        simulationVisualRefreshDue = !!(
            forceSimulationRefresh
            || !isSimulationMotionTick
            || simulationLastVisualRefreshMs <= 0
            || simulationRefreshNowMs - simulationLastVisualRefreshMs >= SIMULATION_VISUAL_REFRESH_INTERVAL_MS
        );
        simulationHeavyRefreshDue = !!(
            forceSimulationRefresh
            || !isSimulationMotionTick
            || simulationLastHeavyRefreshMs <= 0
            || simulationRefreshNowMs - simulationLastHeavyRefreshMs >= SIMULATION_HEAVY_REFRESH_INTERVAL_MS
        );
        if (simulationVisualRefreshDue) simulationLastVisualRefreshMs = simulationRefreshNowMs;
        if (simulationHeavyRefreshDue) simulationLastHeavyRefreshMs = simulationRefreshNowMs;
    }

    if (isSimulationPosition) {
        const simulatedSpeedMps = Number.isFinite(motionSpeed) ? Math.max(0, motionSpeed) : 0;
        const simulatedHeading = Number.isFinite(motionHeading)
            ? ((motionHeading % 360) + 360) % 360
            : getSimulationTrueRouteDeg();

        if (simulationVisualRefreshDue) {
            if (simulatedSpeedMps >= 1) {
                updateOwnGpsVector(latitude, longitude, simulatedHeading, simulatedSpeedMps);
            } else {
                clearOwnGpsVector();
            }
        }

        const simulatedAltitudeMeters = Number(pos.coords.altitude);
        const simulatedAltitudeFeet = Number.isFinite(simulatedAltitudeMeters)
            ? Math.round(simulatedAltitudeMeters * 3.28084)
            : Math.round(simulationAltitudeFt);

        lastPosition = {
            lat: latitude,
            lng: longitude,
            latitude,
            longitude,
            timestamp: gpsTimestampMs,
            heading: simulatedHeading,
            speedMps: simulatedSpeedMps,
            speedKt: simulatedSpeedMps * 1.9438444924406,
            altitudeFt: simulatedAltitudeFeet,
            altitudeFeet: simulatedAltitudeFeet,
            altitudeTimeMs: gpsTimestampMs,
            simulation: true
        };
    } else {
        updateOwnGpsVector(latitude, longitude, motionHeading, motionSpeed);
        const storedSpeedMps = Number.isFinite(motionSpeed) ? motionSpeed : null;
        lastPosition = {
            lat: latitude,
            lng: longitude,
            latitude,
            longitude,
            timestamp: gpsTimestampMs,
            heading: Number.isFinite(motionHeading)
                ? ((motionHeading % 360) + 360) % 360
                : null,
            speedMps: storedSpeedMps,
            speedKt: storedSpeedMps !== null ? storedSpeedMps * 1.9438444924406 : null,
            altitudeFt: Number.isFinite(Number(pos.coords.altitude)) ? Math.round(Number(pos.coords.altitude) * 3.28084) : null,
            altitudeTimeMs: Number.isFinite(Number(pos.coords.altitude)) ? gpsTimestampMs : null,
            stored: pos?.npfIsStoredPosition === true
        };
        saveStoredGpsPosition(latitude, longitude, gpsTimestampMs);
        applyStartupGpsAutoCenter(latitude, longitude, {
            source: pos && pos.npfIsStoredPosition ? 'stored' : 'real'
        });
    }

    const simulationIconSignature = isSimulationPosition
        ? `simulation|${ownAltitudeLabel}`
        : '';

    if (!userMarker) {
        const userIcon = buildOwnGpsIcon(ownAltitudeLabel, { simulation: isSimulationPosition });
        userMarker = L.marker([latitude, longitude], { icon: userIcon, pane: 'ownAircraftPane', zIndexOffset: 0, keyboard: false, interactive: false }).addTo(map);
        if (isSimulationPosition) userMarker.__npfSimulationIconSignature = simulationIconSignature;
    } else {
        userMarker.setLatLng([latitude, longitude]);
        if (
            !isSimulationPosition
            || userMarker.__npfSimulationIconSignature !== simulationIconSignature
        ) {
            userMarker.setIcon(buildOwnGpsIcon(ownAltitudeLabel, { simulation: isSimulationPosition }));
            if (isSimulationPosition) {
                userMarker.__npfSimulationIconSignature = simulationIconSignature;
            } else {
                try { delete userMarker.__npfSimulationIconSignature; } catch (_) {}
            }
        }
        try { if (typeof userMarker.unbindPopup === 'function') userMarker.unbindPopup(); } catch (_) {}
    }

    /* v12.85 — priorité tactile : les icônes pélicandrome restent au-dessus de l'avion si les deux sont superposées. */
    try { if (userMarker && typeof userMarker.setZIndexOffset === 'function') userMarker.setZIndexOffset(500); } catch (_) {}

    applyOwnGpsPlaneHeading(motionHeading);

    /* v16.09 — acquisition automatique du WP actif à 1 NM, jamais sur une position GPS stockée. */
    if (window.__npfWaypointRouteReady === true && pos?.npfIsStoredPosition !== true && typeof handleNpfWaypointAutoAdvance === 'function') {
        handleNpfWaypointAutoAdvance(latitude, longitude);
    }

    /* Navette automatique Feu ↔ PÉLIC : uniquement sur une position GPS fraîche. */
    if (pos?.npfIsStoredPosition !== true) {
        handleNpfFirePelicAutoCycle(latitude, longitude);
    }

    /*
     * v16.55 — aucune tâche SIA n'est déclenchée directement par l'échantillon
     * GPS. Le moteur SIA ne travaille qu'à moveend si sa couverture est devenue
     * réellement insuffisante.
     */
    if (!isSimulationPosition || simulationHeavyRefreshDue) {
        updateNearestCommuneDisplay(latitude, longitude);
        setTimeout(() => { if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') refreshNearestCommuneDisplayFromKnownGps(); }, 250);

        if (typeof window.refreshCalculatorAirportContext === 'function') {
            window.refreshCalculatorAirportContext();
        }

        if (typeof updateDeroutementGpsStatus === 'function') {
            updateDeroutementGpsStatus(isSimulationPosition ? 'GPS simulation' : 'GPS actualisé');
        }
    }

    if (isCenterGpsFollowEffective()) {
        const nowForFollow = Date.now();
        const recentManualMapGesture = (nowForFollow - centerGpsFollowLastUserGestureAt) < getCenterGpsFollowRecenterDelayMs();
        if (!centerGpsFollowUserGestureActive && !recentManualMapGesture && nowForFollow >= centerGpsFollowPausedUntil) {
            recenterMapOnKnownGpsPosition('gps-update');
        }
    }

 // Synchronise les calculs (dont GPS->Feu) à une cadence adaptée en simulation.
    if (currentCommune && (!isSimulationPosition || simulationHeavyRefreshDue)) {
        updateCalculatorData();
    }

 // La route dynamique reste réactive sans être reconstruite deux fois par seconde.
    if (!isSimulationPosition || simulationVisualRefreshDue) {
        drawUserToTargetRoute();
    }

    /*
     * v17.16 — le timer trafic global travaille déjà toutes les 5 s avec le
     * centre carte courant. On force seulement une actualisation lors d'un
     * positionnement explicite de l'avion, jamais à chaque tick de 500 ms.
     */
    if (isSimulationPosition && showTrafficLayer && !isSimulationMotionTick) {
        refreshTrafficLayer({ force: true, reason: 'simulation-position-init' });
    }
}




function normalizeSimulationRoute(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return ((numericValue % 360) + 360) % 360;
}

/*
 * v17.16 — la route saisie/affichée en simulation est magnétique, comme les
 * routes NPF. Les calculs géographiques et l'orientation sur la carte utilisent
 * ensuite le cap vrai correspondant.
 */
function getSimulationTrueRouteDeg() {
    return normalizeSimulationRoute(
        Number(simulationRouteDeg) + Number(MAGNETIC_DECLINATION || 0)
    );
}

function normalizeSimulationSpeed(value) {
    const numericValue = Number(String(value ?? '').replace(',', '.'));
    if (!Number.isFinite(numericValue)) return 0;
    return Math.min(700, Math.max(0, numericValue));
}

function normalizeSimulationAltitude(value) {
    const numericValue = Number(String(value ?? '').replace(',', '.'));
    if (!Number.isFinite(numericValue)) return 0;
    return Math.min(60000, Math.max(-1000, numericValue));
}

function isSimulationPenPointer(event) {
    return String(event?.pointerType || '').toLowerCase() === 'pen';
}

function selectWholeSimulationInputValue(input) {
    if (!input) return;

    try { input.select(); } catch (_) {}
    try { input.setSelectionRange(0, String(input.value || '').length); } catch (_) {}
}

function focusAndSelectSimulationInput(input) {
    if (!input) return;

    try {
        input.focus({ preventScroll: true });
    } catch (_) {
        try { input.focus(); } catch (_) {}
    }

    /*
     * L'appel immédiat reste dans le geste utilisateur : Safari iPad ouvre le
     * clavier. Une seconde sélection stabilise le surlignage après le rendu.
     */
    selectWholeSimulationInputValue(input);
    requestAnimationFrame(() => selectWholeSimulationInputValue(input));
}

function formatSimulationRoute(value) {
    return String(Math.round(normalizeSimulationRoute(value)) % 360).padStart(3, '0');
}

function refreshSimulationMotionButtonState() {
    const button = document.getElementById('simulation-motion-button');
    const summary = document.getElementById('simulation-motion-button-summary');

    if (button) {
        button.hidden = !isSimulationMode;
        button.classList.toggle('active', isSimulationMode);
    }

    if (summary) {
        const displayedSpeed = Number.isInteger(simulationSpeedKt)
            ? String(simulationSpeedKt)
            : simulationSpeedKt.toFixed(1);
        const displayedAltitude = Math.round(simulationAltitudeFt);
        summary.innerHTML = `<span>${displayedSpeed} kt · ${formatSimulationRoute(simulationRouteDeg)}°</span><span>${displayedAltitude} ft</span>`;
    }
}

function closeSimulationMotionModal() {
    const modal = document.getElementById('simulation-motion-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function openSimulationMotionModal() {
    if (!isSimulationMode) return;

    const modal = document.getElementById('simulation-motion-modal');
    const speedInput = document.getElementById('simulation-speed-input');
    const routeInput = document.getElementById('simulation-route-input');
    const altitudeInput = document.getElementById('simulation-altitude-input');
    if (!modal) return;

    if (speedInput) {
        speedInput.value = Number.isInteger(simulationSpeedKt)
            ? String(simulationSpeedKt)
            : simulationSpeedKt.toFixed(1);
    }
    if (routeInput) {
        routeInput.value = String(Math.round(simulationRouteDeg) % 360);
    }
    if (altitudeInput) {
        altitudeInput.value = String(Math.round(simulationAltitudeFt));
    }

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    /*
     * Focus synchrone dans le clic d'ouverture, indispensable sur Safari iPad.
     */
    focusAndSelectSimulationInput(speedInput);
}

function applySimulationMotionSettings(speedKt, routeDeg, altitudeFt) {
    simulationSpeedKt = normalizeSimulationSpeed(speedKt);
    simulationRouteDeg = normalizeSimulationRoute(routeDeg);
    simulationAltitudeFt = normalizeSimulationAltitude(altitudeFt);

    localStorage.setItem(SIMULATION_SPEED_STORAGE_KEY, String(simulationSpeedKt));
    localStorage.setItem(SIMULATION_ROUTE_STORAGE_KEY, String(simulationRouteDeg));
    localStorage.setItem(SIMULATION_ALTITUDE_STORAGE_KEY, String(simulationAltitudeFt));

    simulationMotionLastTickMs = performance.now();
    ensureSimulationMotionTimer();
    refreshSimulationMotionButtonState();

    if (
        isSimulationMode
        && simulationAircraftPositionReady
        && lastPosition?.simulation === true
        && Number.isFinite(Number(lastPosition.latitude))
        && Number.isFinite(Number(lastPosition.longitude))
    ) {
        applySimulatedUserPosition(
            Number(lastPosition.latitude),
            Number(lastPosition.longitude),
            { fromMotionTimer: true, forceFullRefresh: true }
        );
    }

    /*
     * Recoloration locale immédiate, puis actualisation live autour de la
     * position simulée.
     */
    redrawTrafficLayerFromSnapshot();
    if (showTrafficLayer) {
        refreshTrafficLayer({ force: true, reason: 'simulation-settings' });
    }
}

function applySimulationMotionSettingsFromModal() {
    const speedInput = document.getElementById('simulation-speed-input');
    const routeInput = document.getElementById('simulation-route-input');
    const altitudeInput = document.getElementById('simulation-altitude-input');

    applySimulationMotionSettings(
        speedInput ? speedInput.value : simulationSpeedKt,
        routeInput ? routeInput.value : simulationRouteDeg,
        altitudeInput ? altitudeInput.value : simulationAltitudeFt
    );

    closeSimulationMotionModal();
}

function stopSimulationMotionTimer() {
    if (simulationMotionTimer) {
        clearInterval(simulationMotionTimer);
        simulationMotionTimer = null;
    }
    simulationMotionLastTickMs = 0;
}

function ensureSimulationMotionTimer() {
    if (!isSimulationMode || simulationMotionTimer) return;
    simulationMotionLastTickMs = performance.now();
    simulationMotionTimer = setInterval(runSimulationMotionStep, SIMULATION_MOTION_INTERVAL_MS);
}

function runSimulationMotionStep() {
    const nowMs = performance.now();

    if (!isSimulationMode || !simulationAircraftPositionReady || document.hidden) {
        simulationMotionLastTickMs = nowMs;
        return;
    }

    const latitude = Number(simulationMotionLatitude);
    const longitude = Number(simulationMotionLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        simulationMotionLastTickMs = nowMs;
        return;
    }

    let elapsedSeconds = simulationMotionLastTickMs > 0
        ? (nowMs - simulationMotionLastTickMs) / 1000
        : SIMULATION_MOTION_INTERVAL_MS / 1000;
    simulationMotionLastTickMs = nowMs;

    /*
     * iPad/Safari : après suspension, ne jamais rattraper tout le temps écoulé.
     * Le mouvement reprend depuis le dernier point simulé effectivement affiché.
     */
    elapsedSeconds = Math.min(1.0, Math.max(0, elapsedSeconds));
    if (simulationSpeedKt <= 0 || elapsedSeconds <= 0) return;

    const distanceMeters = simulationSpeedKt * 1852 * elapsedSeconds / 3600;
    const destination = calculateDestinationLatLng(
        latitude,
        longitude,
        getSimulationTrueRouteDeg(),
        distanceMeters
    );

    applySimulatedUserPosition(destination[0], destination[1], {
        fromMotionTimer: true
    });
}

function startSimulationMotionTimer() {
    stopSimulationMotionTimer();
    ensureSimulationMotionTimer();
}

function closeSimulationActionPopup() {
    try {
        if (map && simulationActionPopup) {
            map.closePopup(simulationActionPopup);
        }
    } catch (_) {}
    simulationActionPopup = null;
}

async function createSimulatedFireAtPoint(lat, lng) {
    const numericLat = Number(lat);
    const numericLng = Number(lng);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) return;

    selectedPelicanOACI = null;
    const simulatedFire = await buildManualFireCommuneFromPointAsync(numericLat, numericLng, 'Feu SIM');
    currentCommune = simulatedFire;
    localStorage.setItem('currentCommune', JSON.stringify(simulatedFire));
    displayCommuneDetails(simulatedFire, false);
    armNpfFirePelicAutoCycle('fire');
}

function openSimulationActionPopup(latlng) {
    if (!map || !latlng) return;

    closeSimulationActionPopup();

    const container = document.createElement('div');
    container.className = 'simulation-action-popup-content';

    const title = document.createElement('div');
    title.className = 'simulation-action-popup-title';
    title.textContent = 'Mode simulation';

    const actions = document.createElement('div');
    actions.className = 'simulation-action-popup-actions';

    const aircraftButton = document.createElement('button');
    aircraftButton.type = 'button';
    aircraftButton.className = 'simulation-action-popup-btn simulation-aircraft-btn';
    aircraftButton.textContent = 'Positionner avion';
    aircraftButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        applySimulatedUserPosition(latlng.lat, latlng.lng);
        closeSimulationActionPopup();
    });

    const fireButton = document.createElement('button');
    fireButton.type = 'button';
    fireButton.className = 'simulation-action-popup-btn simulation-fire-btn';
    fireButton.textContent = 'Positionner feu';
    fireButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await createSimulatedFireAtPoint(latlng.lat, latlng.lng);
        closeSimulationActionPopup();
    });

    actions.appendChild(aircraftButton);
    actions.appendChild(fireButton);
    container.appendChild(title);
    container.appendChild(actions);

    try {
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'].forEach((eventName) => {
            container.addEventListener(eventName, (event) => {
                event.stopPropagation();
            }, { passive: true });
        });
    } catch (_) {}

    simulationActionPopup = L.popup({
        className: 'simulation-action-popup',
        closeButton: true,
        autoClose: true,
        closeOnClick: false,
        autoPan: true,
        maxWidth: 280
    })
        .setLatLng(latlng)
        .setContent(container)
        .openOn(map);
}

function refreshSimulationModeButtonState() {
    const button = document.getElementById('simulation-mode-button');
    if (document.body) {
        document.body.classList.toggle('simulation-mode-active', isSimulationMode);
    }

    if (button) {
        button.classList.toggle('active', isSimulationMode);
        button.textContent = isSimulationMode ? 'Quitter le mode simulation avion' : 'Mode simulation avion';
    }

    refreshSimulationMotionButtonState();

    if (!isSimulationMode) {
        closeSimulationMotionModal();
    }
}

function applySimulatedUserPosition(lat, lng, { fromMotionTimer = false, forceFullRefresh = false } = {}) {
    const numericLat = Number(lat);
    const numericLng = Number(lng);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) return;

    simulationAircraftPositionReady = true;
    simulationMotionLatitude = numericLat;
    simulationMotionLongitude = numericLng;
    if (!fromMotionTimer) {
        simulationMotionLastTickMs = performance.now();
        ensureSimulationMotionTimer();
    }

    updateUserPosition({
        coords: {
            latitude: numericLat,
            longitude: numericLng,
            altitude: simulationAltitudeFt / 3.28084,
            heading: getSimulationTrueRouteDeg(),
            speed: simulationSpeedKt * 0.5144444444444445,
            accuracy: null
        },
        timestamp: Date.now(),
        npfIsSimulation: true,
        npfSimulationMotionTick: fromMotionTimer,
        npfSimulationForceRefresh: forceFullRefresh
    });
}

function enableSimulationMode() {
    if (!map || isSimulationMode) return;

    /*
     * v15.77 — la simulation démarre directement depuis la position GPS connue.
     * La position est capturée AVANT de couper le watch GPS afin que l'utilisateur
     * n'ait plus à repositionner manuellement l'avion pour commencer un scénario.
     */
    const knownGpsBeforeSimulation = getKnownGpsLatLngForCentering();

    simulationWasLiveGpsActiveBeforeSimulation = (localStorage.getItem('liveGpsActive') === 'true') || !!watchId;
    isSimulationMode = true;
    /* v17.14 — installer seulement les gardes tactiles du suivi anticipé.
     * Aucun watch GPS n'est lancé : la simulation reste entièrement autonome. */
    installCenterGpsFollowHandlers();
    if (watchId && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        const liveGpsButton = document.getElementById('live-gps-button');
        if (liveGpsButton) liveGpsButton.classList.remove('active');
        localStorage.setItem('liveGpsActive', 'false');
    }

    simulationMapClickHandler = null;
    simulationAircraftPositionReady = false;
    simulationMotionLatitude = null;
    simulationMotionLongitude = null;
    simulationLastVisualRefreshMs = 0;
    simulationLastHeavyRefreshMs = 0;
    startSimulationMotionTimer();
    refreshSimulationModeButtonState();

    const startFromGps = (lat, lng) => {
        if (!isSimulationMode) return;
        if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
        applySimulatedUserPosition(Number(lat), Number(lng));
    };

    if (knownGpsBeforeSimulation) {
        startFromGps(knownGpsBeforeSimulation.lat, knownGpsBeforeSimulation.lng);
    } else if (navigator.geolocation) {
        /*
         * Repli installation fraîche : une demande GPS ponctuelle initialise la
         * simulation. Elle ne passe pas par updateUserPosition(), qui ignore
         * volontairement les positions réelles une fois le mode SIM actif.
         */
        navigator.geolocation.getCurrentPosition(
            pos => startFromGps(pos?.coords?.latitude, pos?.coords?.longitude),
            () => {},
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 600000 }
        );
    }

    const offlineMapModal = document.getElementById('offline-map-modal');
    if (offlineMapModal) offlineMapModal.style.display = 'none';

    alert('Mode simulation actif : avion initialisé sur la position GPS. Appui long sur la carte pour les actions.');
}

function disableSimulationMode({ restoreGps = true } = {}) {
    if (!isSimulationMode && !simulationMapClickHandler) return;

    if (map && simulationMapClickHandler) {
        map.off('click', simulationMapClickHandler);
    }
    simulationMapClickHandler = null;
    simulationSuppressNextClickUntil = 0;
    stopSimulationMotionTimer();
    simulationAircraftPositionReady = false;
    simulationMotionLatitude = null;
    simulationMotionLongitude = null;
    simulationLastVisualRefreshMs = 0;
    simulationLastHeavyRefreshMs = 0;
    closeSimulationActionPopup();
    closeSimulationMotionModal();
    isSimulationMode = false;
    if (!centerGpsFollowActive) {
        centerGpsFollowPausedUntil = 0;
        centerGpsFollowUserGestureActive = false;
        centerGpsFollowLastUserGestureAt = 0;
        if (centerGpsFollowPauseTimer) {
            clearTimeout(centerGpsFollowPauseTimer);
            centerGpsFollowPauseTimer = null;
        }
    }
    refreshSimulationModeButtonState();

    if (restoreGps) {
        localStorage.setItem('liveGpsActive', 'true');
        restartLiveGpsWatch({ silent: true });
        setTimeout(() => requestOneShotGps({ silent: true, highAccuracy: true, timeout: 12000, maximumAge: 600000 }), 250);
    }
    simulationWasLiveGpsActiveBeforeSimulation = false;
}

function toggleSimulationMode() {
    if (isSimulationMode) {
        disableSimulationMode({ restoreGps: true });
    } else {
        enableSimulationMode();
    }
}

document.addEventListener('visibilitychange', () => {
    if (isSimulationMode && !document.hidden) {
        simulationMotionLastTickMs = performance.now();
        ensureSimulationMotionTimer();
    }
});

function findClosestCommuneName(lat, lon) {
    const closestCommune = findClosestCommune(lat, lon, 27);
    return closestCommune ? closestCommune.nom_standard : null;
}

function toggleLftwRoute() {
    showLftwRoute = !showLftwRoute;
    localStorage.setItem('showLftwRoute', showLftwRoute);
    updateLftwButtonState();
    if(currentCommune) { displayCommuneDetails(currentCommune, false); }
}

function updateLftwButtonState() {
    const lftwRouteButton = document.getElementById('lftw-route-button');
    if (!lftwRouteButton) return;
    lftwRouteButton.classList.toggle('active', showLftwRoute);
}

function drawLftwRoute() {
    lftwRouteLayer.clearLayers();
    if (!showLftwRoute || !currentCommune) return;
    const baseAirport = getAirportByOaci(selectedBaseOACI);
    if (!baseAirport) return;
    const { latitude_mairie: lat, longitude_mairie: lon } = currentCommune;
    const { lat: baseLat, lon: baseLon } = baseAirport;
    const trueBearing = calculateBearing(lat, lon, baseLat, baseLon);
    const magneticBearing = (trueBearing - MAGNETIC_DECLINATION + 360) % 360;
    drawRoute([lat, lon], [baseLat, baseLon], { isLftwRoute: true, magneticBearing: magneticBearing });
}

function toggleGaarVisibility() {
    isGaarMode = !isGaarMode;
    try { localStorage.setItem(GAAR_LAYER_VISIBLE_KEY, isGaarMode ? 'true' : 'false'); } catch (_) {}
    updateGaarButtonState();
    if (isGaarMode) {
        redrawGaarCircuits();
    } else {
        gaarLayer.clearLayers();
        if (isDrawingMode) { toggleGaarDrawingMode(); }
    }
}
function updateGaarButtonState() { const gaarButton = document.getElementById('gaar-mode-button'); const gaarControls = document.getElementById('gaar-controls'); gaarButton.classList.toggle('active', isGaarMode); gaarControls.style.display = isGaarMode ? 'flex' : 'none'; }

function setGaarEditingBannerVisible(active) {
    try {
        let banner = document.getElementById('gaar-editing-banner');
        if (active) {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'gaar-editing-banner';
                banner.className = 'gaar-editing-banner';
                banner.innerHTML = 'Mode création/modification circuit GAAR activé<span class="gaar-editing-banner-subtitle">Touchez un point pour modifier ou supprimer — touchez la carte pour ajouter un point</span>';
                document.body.appendChild(banner);
            }
        } else if (banner && banner.parentNode) {
            banner.parentNode.removeChild(banner);
        }
        if (document.body) {
            document.body.classList.toggle('gaar-editing-active-ui', !!active);
        }
    } catch (_) {}
}

function suppressNextGaarMapClick(durationMs = 650) {
    try {
        window.__gaarSuppressMapClickUntil = Date.now() + durationMs;
    } catch (_) {}
}

function shouldIgnoreGaarMapClick(e, options = {}) {
    try {
        if (Date.now() < (window.__gaarSuppressMapClickUntil || 0)) return true;
        const original = e && e.originalEvent;
        const target = original && original.target;
        if (target && typeof target.closest === 'function') {
            // Les vrais contrôles/markers/éléments GAAR restent prioritaires.
            if (target.closest('.leaflet-marker-icon, .leaflet-tooltip, .leaflet-popup, .leaflet-control, .gaar-point-search-overlay, .gaar-editing-banner')) {
                return true;
            }
            // v15.75 — une surface SIA polygonale ne doit plus bloquer la création GAAR.
            if (!options.fromSiaSurface && target.closest('.leaflet-interactive')) {
                return true;
            }
        }
    } catch (_) {}
    return false;
}

function stopGaarUiEvent(event, options = {}) {
    try { suppressNextGaarMapClick(options.durationMs || 800); } catch (_) {}
    try { if (event && typeof event.stopPropagation === 'function') event.stopPropagation(); } catch (_) {}
    if (options.preventDefault !== false) {
        try { if (event && typeof event.preventDefault === 'function') event.preventDefault(); } catch (_) {}
    }
    try {
        const original = event && event.originalEvent;
        if (original && typeof original.stopPropagation === 'function') original.stopPropagation();
        if (options.preventDefault !== false && original && typeof original.preventDefault === 'function') original.preventDefault();
        if (typeof L !== 'undefined' && L.DomEvent && original) L.DomEvent.stop(original);
    } catch (_) {}
}

function updateGaarDrawingButtonState() {
    const editButton = document.getElementById('edit-circuits-button');
    const mapContainer = document.getElementById('map');
    const status = document.getElementById('gaar-status');

    if (editButton) {
        editButton.classList.toggle('active', isDrawingMode);
        editButton.setAttribute('aria-pressed', isDrawingMode ? 'true' : 'false');
        editButton.innerHTML = isDrawingMode
            ? 'Créer/Modifier<br><span class="gaar-edit-state-label">ACTIF</span>'
            : 'Créer/Modifier';
    }

    if (mapContainer) {
        mapContainer.classList.toggle('crosshair-cursor', isDrawingMode);
        mapContainer.classList.toggle('gaar-editing-active', isDrawingMode);
    }

    setGaarEditingBannerVisible(isDrawingMode);

    if (status) {
        status.textContent = isDrawingMode
            ? 'Mode CRÉER/MODIFIER actif. Cliquez sur la carte pour ajouter un point ou sur un point pour renommer.'
            : '';
    }
}

function toggleGaarDrawingMode() {
    isDrawingMode = !isDrawingMode;
    updateGaarDrawingButtonState();
    /* v13.64 : étiquettes visibles en mode modification + état du bouton beaucoup plus lisible. */
    redrawGaarCircuits();
}
async function handleGaarMapClick(e, options = {}) {
    if (!isDrawingMode) return;
    if (!e || !e.latlng) return;
    if (shouldIgnoreGaarMapClick(e, options)) return;

    let targetCircuit = gaarCircuits.find(c => c && c.isManual && c.points.length < 3);
    if (!targetCircuit) {
        const manualCircuitsCount = gaarCircuits.filter(c => c && c.isManual).length;
        targetCircuit = {
            points: [],
            color: manualCircuitColors[manualCircuitsCount % manualCircuitColors.length],
            isManual: true,
        };
        gaarCircuits.push(targetCircuit);
    }

    const pointName = await reverseGeocode(e.latlng) || `Point Manuel`;
    targetCircuit.points.push({ lat: e.latlng.lat, lng: e.latlng.lng, name: pointName });
    redrawGaarCircuits();
    saveGaarCircuits();
}
async function reverseGeocode(latlng) { document.getElementById('gaar-status').textContent = 'Recherche du nom...'; try { if (!navigator.onLine) { throw new Error("Application hors ligne."); } const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latlng.lat}&lon=${latlng.lng}&zoom=10`); if (!response.ok) throw new Error('La réponse du réseau n\'était pas OK.'); const data = await response.json(); const name = data.address.city || data.address.town || data.address.village || data.display_name.split(',')[0]; document.getElementById('gaar-status').textContent = `Point ajouté près de ${name}.`; return name; } catch (error) { const closestCommuneName = findClosestCommuneName(latlng.lat, latlng.lng); if (closestCommuneName) { document.getElementById('gaar-status').textContent = `Point ajouté près de ${closestCommuneName} (hors-ligne).`; return closestCommuneName; } else { document.getElementById('gaar-status').textContent = 'Nom non trouvé (hors-ligne).'; return null; } } }
function getGaarPointDisplayName(point) {
    const raw = String(point?.name || '').trim();
    return raw || 'Point GAAR';
}

function formatGaarCommuneResultName(c) {
    const name = c?.nom_standard || c?.name || '';
    const dep = c?.dep_code || '';
    return dep ? `${name} (${dep})` : name;
}

function searchCommunesForGaarPoint(rawSearch) {
    return searchCommunesWithSharedEngine(rawSearch, 10).results;
}

function getGaarCommuneLatLng(commune) {
    if (!commune) return null;
    const lat = Number(
        commune.latitude_mairie ??
        commune.lat ??
        commune.latitude ??
        commune.centre_lat
    );
    const lng = Number(
        commune.longitude_mairie ??
        commune.lng ??
        commune.lon ??
        commune.longitude ??
        commune.centre_lon
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

function findBestGaarCommuneForInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const normalizedInput = simplifyString(
        raw
            .replace(/\s*\([^)]*\)\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
    );

    const results = searchCommunesForGaarPoint(raw);
    if (!results.length) return null;

    const exact = results.find((candidate) => {
        const candidateName = simplifyString(candidate?.nom_standard || candidate?.name || '');
        const candidateWithDep = simplifyString(formatGaarCommuneResultName(candidate));
        return candidateName === normalizedInput || candidateWithDep === simplifyString(raw);
    });

    return exact || results[0];
}

function applyGaarPointCommune(circuitIndex, pointIndex, commune, fallbackName = '') {
    const circuit = gaarCircuits[circuitIndex];
    const point = circuit && circuit.points ? circuit.points[pointIndex] : null;
    if (!point || !commune) return false;

    const latLng = getGaarCommuneLatLng(commune);
    if (!latLng) return false;

    point.name = formatGaarCommuneResultName(commune) || String(fallbackName || point.name || 'Point GAAR').trim();
    point.lat = latLng.lat;
    point.lng = latLng.lng;

    redrawGaarCircuits();
    saveGaarCircuits();
    closeGaarPointSearchOverlay();
    if (map) {
        map.closePopup();
        try { map.panTo([point.lat, point.lng], { animate: false }); } catch (_) {}
    }

    const status = document.getElementById('gaar-status');
    if (status) status.textContent = `Point GAAR déplacé sur ${point.name}.`;
    return true;
}

function setGaarPointName(circuitIndex, pointIndex, value, options = {}) {
    const newName = String(value || '').trim();
    if (!newName) return false;

    if (options && options.moveToCommune === true) {
        const commune = options.commune || findBestGaarCommuneForInput(newName);
        if (commune && applyGaarPointCommune(circuitIndex, pointIndex, commune, newName)) {
            return true;
        }
    }

    const circuit = gaarCircuits[circuitIndex];
    const point = circuit && circuit.points ? circuit.points[pointIndex] : null;
    if (!point) return false;

    /* v13.64 — saisie libre sans commune reconnue : renommage simple.
       Sélection d'une commune / OK sur une ville reconnue : déplacement du point sur la commune. */
    point.name = newName;

    redrawGaarCircuits();
    saveGaarCircuits();
    closeGaarPointSearchOverlay();
    if (map) map.closePopup();
    return true;
}


function closeGaarPointSearchOverlay() {
    try {
        const overlay = document.getElementById('gaar-point-search-overlay');
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (document.body) document.body.classList.remove('gaar-point-search-open');
    } catch (_) {}
    gaarPointSearchOverlayState = null;
}

function closeFireSearchPanelForGaarPointEdit() {
    /*
     * v13.64 — édition nom point GAAR en panneau haut iPad :
     * on ferme la fenêtre de recherche feu pour libérer l'écran et éviter que
     * la liste de résultats du point passe dessous / soit masquée par le clavier.
     * Les états GAAR (affichage + modification/création de circuit) ne sont pas modifiés.
     */
    try {
        const uiOverlay = document.getElementById('ui-overlay');
        const toggleSearchButton = document.getElementById('toggle-search-button');
        const communeDisplay = document.getElementById('commune-info-display');
        const resultsList = document.getElementById('results-list');
        const searchInput = document.getElementById('search-input');

        if (resultsList) resultsList.style.display = 'none';
        if (searchInput) searchInput.blur();
        if (uiOverlay) uiOverlay.style.display = 'none';
        if (toggleSearchButton) toggleSearchButton.classList.remove('active');

        if (communeDisplay && (currentCommune || selectedAirportDestination) && communeDisplay.innerHTML.trim() !== '') {
            communeDisplay.style.display = 'flex';
        }
    } catch (_) {}
}

function openGaarPointSearchOverlay(circuitIndex, pointIndex) {
    closeFireSearchPanelForGaarPointEdit();
    if (map) map.closePopup();

    const point = gaarCircuits[circuitIndex]?.points?.[pointIndex];
    if (!point) return;

    closeGaarPointSearchOverlay();
    gaarPointSearchOverlayState = { circuitIndex, pointIndex };

    const overlay = document.createElement('div');
    overlay.id = 'gaar-point-search-overlay';
    overlay.className = 'gaar-point-search-overlay';
    if (document.body) document.body.classList.add('gaar-point-search-open');
    ['click', 'pointerdown', 'touchstart', 'mousedown'].forEach(type => {
        overlay.addEventListener(type, (event) => stopGaarUiEvent(event, { preventDefault: false, durationMs: 900 }), { passive: true });
    });

    const panel = document.createElement('div');
    panel.className = 'gaar-point-search-panel';

    const header = document.createElement('div');
    header.className = 'gaar-point-search-header';

    const title = document.createElement('div');
    title.className = 'gaar-point-search-title';
    title.innerHTML = `<b>Point ${pointIndex + 1}</b><span>${escapeHtml(getGaarPointDisplayName(point))}</span>`;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'gaar-point-search-close';
    closeButton.setAttribute('aria-label', 'Fermer');
    closeButton.textContent = '×';
    closeButton.addEventListener('pointerdown', (event) => stopGaarUiEvent(event), { passive: false });
    closeButton.addEventListener('click', (event) => {
        stopGaarUiEvent(event);
        closeGaarPointSearchOverlay();
    });

    header.appendChild(title);
    header.appendChild(closeButton);

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'gaar-point-search-field-wrapper gaar-point-search-field-wrapper-top';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gaar-point-search-input gaar-point-search-input-top';
    input.id = `gaar-input-${circuitIndex}-${pointIndex}`;
    input.value = getGaarPointDisplayName(point);
    input.placeholder = 'Rechercher une commune...';
    input.autocomplete = 'off';
    input.autocapitalize = 'words';
    input.spellcheck = false;
    input.inputMode = 'text';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'gaar-point-search-clear';
    clearButton.setAttribute('aria-label', 'Effacer la recherche');
    clearButton.textContent = '×';

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(clearButton);

    const resultsList = document.createElement('ul');
    resultsList.className = 'gaar-point-results gaar-point-results-top';
    resultsList.style.display = 'none';

    const renderResults = () => {
        const results = searchCommunesForGaarPoint(input.value);
        resultsList.innerHTML = '';
        if (!results.length) {
            resultsList.style.display = 'none';
            return;
        }

        results.forEach((result) => {
            const li = document.createElement('li');
            li.textContent = `${result.nom_standard} (${result.dep_nom || result.dep_code} - ${result.dep_code})`;
            const applyResultName = (event) => {
                if (event) {
                    try { event.preventDefault(); } catch (_) {}
                    try { event.stopPropagation(); } catch (_) {}
                }
                suppressNextGaarMapClick(900);
                const selectedName = formatGaarCommuneResultName(result);
                input.value = selectedName;
                /* v13.64 : sélection d'une commune = déplacement du point sur cette commune. */
                setGaarPointName(circuitIndex, pointIndex, selectedName, { moveToCommune: true, commune: result });
            };
            li.addEventListener('pointerdown', applyResultName, { passive: false });
            li.addEventListener('click', applyResultName);
            resultsList.appendChild(li);
        });
        resultsList.style.display = 'block';
    };

    const updateClearButtonVisibility = () => {
        clearButton.style.display = input.value ? 'inline-flex' : 'none';
    };

    const clearGaarPointSearchInput = () => {
        input.value = '';
        resultsList.innerHTML = '';
        resultsList.style.display = 'none';
        updateClearButtonVisibility();
    };

    let searchTimer = null;
    input.addEventListener('input', () => {
        updateClearButtonVisibility();
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(renderResults, 160);
    });

    clearButton.addEventListener('pointerdown', (event) => {
        stopGaarUiEvent(event, { durationMs: 900 });
        clearGaarPointSearchInput();
        /* Garder le clavier ouvert quand iPad l'a déjà affiché. */
        try { input.focus({ preventScroll: true }); } catch (_) { try { input.focus(); } catch (_) {} }
    }, { passive: false });

    clearButton.addEventListener('click', (event) => {
        stopGaarUiEvent(event, { durationMs: 900 });
        clearGaarPointSearchInput();
        try { input.focus({ preventScroll: true }); } catch (_) { try { input.focus(); } catch (_) {} }
    });

    updateClearButtonVisibility();

    /* v13.64 : on ne force plus le focus par JS sur iPad.
       Le clavier s'ouvre via le tap natif dans l'input ; on bloque seulement la propagation vers la carte. */
    input.addEventListener('focus', renderResults);
    input.addEventListener('pointerdown', (event) => {
        try { event.stopPropagation(); } catch (_) {}
        suppressNextGaarMapClick(900);
    }, { passive: true });
    input.addEventListener('touchstart', (event) => {
        try { event.stopPropagation(); } catch (_) {}
        suppressNextGaarMapClick(900);
    }, { passive: true });
    input.addEventListener('click', (event) => {
        try { event.stopPropagation(); } catch (_) {}
        suppressNextGaarMapClick(900);
        renderResults();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            setGaarPointName(circuitIndex, pointIndex, input.value, { moveToCommune: true });
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeGaarPointSearchOverlay();
        }
    });

    const actions = document.createElement('div');
    actions.className = 'gaar-point-popup-actions gaar-point-search-actions';

    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.className = 'gaar-point-ok-btn';
    okButton.textContent = 'OK';
    okButton.addEventListener('pointerdown', (event) => stopGaarUiEvent(event), { passive: false });
    okButton.addEventListener('click', (event) => {
        stopGaarUiEvent(event);
        setGaarPointName(circuitIndex, pointIndex, input.value, { moveToCommune: true });
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-point-btn gaar-point-delete-btn';
    deleteButton.textContent = 'Supprimer';
    deleteButton.addEventListener('pointerdown', (event) => stopGaarUiEvent(event), { passive: false });
    deleteButton.addEventListener('click', (event) => {
        stopGaarUiEvent(event);
        window.deleteGaarPoint(circuitIndex, pointIndex);
    });

    actions.appendChild(okButton);
    actions.appendChild(deleteButton);

    panel.appendChild(header);
    panel.appendChild(inputWrapper);
    panel.appendChild(resultsList);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}

function redrawGaarCircuits() {
    gaarLayer.clearLayers();

    // v15.98 — une préférence GAAR explicitement OFF reste prioritaire,
    // y compris lorsqu’un import ou une tâche de démarrage demande un redraw.
    try {
        if (localStorage.getItem(GAAR_LAYER_VISIBLE_KEY) === 'false') return;
    } catch (_) {}

    gaarCircuits.forEach((circuit, circuitIndex) => {
        if (!circuit || circuit.points.length === 0) return;
        const latlngs = circuit.points.map(p => [p.lat, p.lng]);
        const lineStyleOptions = {
            color: circuit.color,
            weight: 3,
            opacity: 0.75,
            fillColor: 'transparent',
            fillOpacity: 0
        };

        if (latlngs.length >= 3) {
            L.polygon(latlngs, lineStyleOptions).addTo(gaarLayer);
        } else if (latlngs.length > 1) {
            L.polyline(latlngs, lineStyleOptions).addTo(gaarLayer);
        }

        circuit.points.forEach((point, pointIndex) => {
            const marker = L.circleMarker([point.lat, point.lng], {
                radius: 8,
                fillColor: circuit.color,
                color: '#000',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.85
            }).addTo(gaarLayer);

            ['mousedown', 'touchstart', 'pointerdown'].forEach(type => {
                marker.on(type, (event) => {
                    stopGaarUiEvent(event, { preventDefault: false, durationMs: 900 });
                });
            });

            marker.on('click', (event) => {
                stopGaarUiEvent(event, { durationMs: 900 });

                if (isDrawingMode) {
                    openGaarPointSearchOverlay(circuitIndex, pointIndex);
                    return;
                }

                /*
                 * v13.65 — hors mode Créer/Modifier :
                 * un clic sur un point GAAR affiche seulement une petite étiquette
                 * avec le nom du point/ville. Aucune fenêtre d'édition, aucun bouton.
                 */
                try {
                    if (map && typeof map.closePopup === 'function') map.closePopup();
                    if (typeof L !== 'undefined' && L.popup && map) {
                        L.popup({
                            autoPan: false,
                            closeButton: false,
                            className: 'gaar-point-name-popup',
                            offset: [0, -8]
                        })
                            .setLatLng([point.lat, point.lng])
                            .setContent(`<div class="gaar-point-simple-label">${escapeHtml(getGaarPointDisplayName(point))}</div>`)
                            .openOn(map);
                    }
                } catch (_) {}
            });

            if (isDrawingMode) {
                marker.bindTooltip(escapeHtml(getGaarPointDisplayName(point)), {
                    permanent: true,
                    direction: 'top',
                    offset: [0, -10],
                    className: 'gaar-point-label'
                });
            }


            /*
             * v15.80 — la modification/suppression d'un point ne dépend plus du
             * hit-testing du petit cercle visuel. Une hitbox SVG de 48 px, dans
             * un pane supérieur aux surfaces tactiles SIA, ouvre toujours
             * l'éditeur lorsque CRÉER/MODIFIER est actif.
             */
            if (isDrawingMode && gaarEditTouchRenderer) {
                const editHitbox = L.circleMarker([point.lat, point.lng], {
                    pane: 'gaarEditTouchPane',
                    renderer: gaarEditTouchRenderer,
                    radius: 24,
                    stroke: false,
                    opacity: 0,
                    fill: true,
                    fillColor: circuit.color,
                    fillOpacity: 0.002,
                    interactive: true,
                    bubblingMouseEvents: false,
                    keyboard: false,
                    className: 'gaar-point-edit-hitbox'
                }).addTo(gaarLayer);

                ['mousedown', 'touchstart', 'pointerdown'].forEach(type => {
                    editHitbox.on(type, event => {
                        stopGaarUiEvent(event, { preventDefault: false, durationMs: 1000 });
                    });
                });
                editHitbox.on('click', event => {
                    stopGaarUiEvent(event, { durationMs: 1100 });
                    suppressNextGaarMapClick(1200);
                    openGaarPointSearchOverlay(circuitIndex, pointIndex);
                });
            }
        });
    });
}

window.updateGaarPoint = function(circuitIndex, pointIndex) {
    const input = document.getElementById(`gaar-input-${circuitIndex}-${pointIndex}`);
    setGaarPointName(circuitIndex, pointIndex, input ? input.value : '', { moveToCommune: true });
};
window.deleteGaarPoint = function(circuitIndex, pointIndex) {
    suppressNextGaarMapClick(1200);
    if (!gaarCircuits[circuitIndex] || !gaarCircuits[circuitIndex].points[pointIndex]) return;
    gaarCircuits[circuitIndex].points.splice(pointIndex, 1);
    if (gaarCircuits[circuitIndex].points.length === 0) {
        gaarCircuits.splice(circuitIndex, 1);
    }
    redrawGaarCircuits();
    saveGaarCircuits();
    closeGaarPointSearchOverlay();
    if (map) map.closePopup();
    const status = document.getElementById('gaar-status');
    if (status && isDrawingMode) {
        status.textContent = 'Point GAAR supprimé. Mode création/modification toujours actif.';
    }
};
function clearAllGaarCircuits() { gaarCircuits = []; gaarLayer.clearLayers(); saveGaarCircuits(); }
function saveGaarCircuits() { localStorage.setItem('gaarCircuits', JSON.stringify(gaarCircuits)); }

function updateCalculatorData() {
    if (!currentCommune) {
        CALCULATOR_DATA = { distBaseFeu: 0, distPelicFeu: 0, csFeu: '--:--', distGpsFeu: 0 };
    } else {
        const baseAirport = getAirportByOaci(selectedBaseOACI);
        const selectedPelican = getSelectedPelicanAirport();
        const { latitude_mairie: feuLat, longitude_mairie: feuLon } = currentCommune;
        let distBaseFeu = 0; if (baseAirport) { distBaseFeu = calculateDistanceInNm(baseAirport.lat, baseAirport.lon, feuLat, feuLon); }
        let distPelicFeu = 0; if (selectedPelican) { distPelicFeu = calculateDistanceInNm(selectedPelican.lat, selectedPelican.lon, feuLat, feuLon); }
        let csFeu = '--:--'; if (typeof SunCalc !== 'undefined') { try { const now = new Date(); const times = SunCalc.getTimes(now, feuLat, feuLon); csFeu = times.sunset.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }); } catch (e) { /* ignore */ } }
        let distGpsFeu = 0; if (userMarker && userMarker.getLatLng()) { const userLatLng = userMarker.getLatLng(); distGpsFeu = calculateDistanceInNm(userLatLng.lat, userLatLng.lng, feuLat, feuLon); }
        CALCULATOR_DATA.distBaseFeu = Math.round(distBaseFeu);
        CALCULATOR_DATA.distPelicFeu = Math.round(distPelicFeu);
        CALCULATOR_DATA.csFeu = csFeu;
        CALCULATOR_DATA.distGpsFeu = Math.round(distGpsFeu);
    }
    if (typeof masterRecalculate === 'function') { masterRecalculate(); }
}

function soundex(s) { if (!s) return ""; const a = s.toLowerCase().split(""), f = a.shift(); if (!f) return ""; let r = ""; const codes = { a: "", e: "", i: "", o: "", u: "", b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 }; return r = f + a.map(v => codes[v]).filter((v, i, a) => 0 === i ? v !== codes[f] : v !== a[i - 1]).join(""), (r + "000").slice(0, 4).toUpperCase() }
