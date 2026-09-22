function updateMapBingoDisplay() {
    const bingoDisplay = document.getElementById('bingo-map-display');
    if (!currentCommune) {
        bingoDisplay.style.display = 'none';
        requestAnimationFrame(() => {
            if (typeof positionNpfWaypointNavigationBanner === 'function') positionNpfWaypointNavigationBanner();
        });
        return;
    }

    const bingoBase = calculateBingo(CALCULATOR_DATA.distBaseFeu);
    const bingoPelic = calculateBingo(CALCULATOR_DATA.distPelicFeu);

    const lftwEl = document.getElementById('map-bingo-lftw');
    const pelicEl = document.getElementById('map-bingo-pelic');

    lftwEl.innerHTML = `<span class="bingo-title">BINGO BASE <span class="bingo-oaci">${selectedBaseOACI}</span>:</span> <b>${bingoBase} kg</b>`;

    if (bingoPelic !== 700 && selectedPelicanOACI) {
        pelicEl.innerHTML = `<span class="bingo-title">BINGO <span class="bingo-oaci">${selectedPelicanOACI}</span>:</span> <b>${bingoPelic} kg</b>`;
        pelicEl.style.display = 'inline-block';
    } else {
        pelicEl.style.display = 'none';
    }

    bingoDisplay.style.display = 'flex';
    requestAnimationFrame(() => {
        if (typeof positionNpfWaypointNavigationBanner === 'function') positionNpfWaypointNavigationBanner();
    });
}

function displayCommuneDetails(commune, shouldFitBounds = true) {
    saveFireHistory(commune);
    routesLayer.clearLayers();
    lftwRouteLayer.clearLayers();
    resetRouteTooltipOffsets();
    drawFireHistoryMarkers();

    updateCommuneDisplay(commune);

    const { latitude_mairie: lat, longitude_mairie: lon, nom_standard: name } = commune;
 // v13.54 — après validation d'un feu, la barre de recherche est vidée.
 // Le feu reste sélectionné via currentCommune + bandeau carte ; seul le texte de recherche est nettoyé.
    const fireSearchInput = document.getElementById('search-input');
    const fireResultsList = document.getElementById('results-list');
    const fireClearSearchButton = document.getElementById('clear-search');
    if (fireSearchInput) fireSearchInput.value = '';
    if (fireResultsList) fireResultsList.style.display = 'none';
    if (fireClearSearchButton) fireClearSearchButton.style.display = 'none';

    const allPoints = [[lat, lon]];
    const fireLabel = buildFireDisplayName(commune);
    const fireIcon = buildActiveFireIcon(fireLabel);
    const activeFireMarker = L.marker([lat, lon], { icon: fireIcon, title: fireLabel, keyboard: false });
    bindFireMapTooltip(activeFireMarker, fireLabel, true);
    activeFireMarker
        .bindPopup(() => {
            const container = document.createElement('div');
            container.className = 'fire-history-map-popup active-fire-map-popup';
            container.innerHTML = `<b>${escapeHtml(fireLabel)}</b><br>${convertToDMM(lat, 'lat')}<br>${convertToDMM(lon, 'lon')}`;

            const actions = document.createElement('div');
            actions.className = 'fire-history-map-popup-actions';

            /*
             * Si le GoTo a été repris par un WP ou un aéroport/PÉLIC, le feu
             * sélectionné reste cliquable et propose de redevenir la cible.
             */
            if (!isCurrentFireGotoActive()) {
                const gotoButton = document.createElement('button');
                gotoButton.type = 'button';
                gotoButton.textContent = 'GoTo';
                gotoButton.className = 'fire-history-map-select-btn fire-history-map-goto-btn';
                gotoButton.title = 'Reprendre le GoTo vers ce feu';
                gotoButton.addEventListener('click', () => {
                    activateCurrentFireGoto();
                });
                actions.appendChild(gotoButton);
            }

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = 'Supprimer';
            deleteButton.className = 'fire-history-map-delete-btn';
            deleteButton.title = 'Supprimer ce feu de la carte et de l’historique';
            deleteButton.addEventListener('click', () => {
                if (!confirm('Supprimer ce feu de la carte et de l’historique ?')) return;
                deleteFireHistoryItemByCommune(commune);
                clearCurrentSelection({ preserveMapView: true });
                try { map.closePopup(); } catch (_) {}
            });

            actions.appendChild(deleteButton);
            container.appendChild(actions);
            return container;
        })
        .addTo(routesLayer);

    const numAirportsRaw = parseInt(document.getElementById('airport-count').value, 10);
    const numAirports = Number.isFinite(numAirportsRaw)
        ? Math.max(0, Math.min(10, numAirportsRaw))
        : 0;
    const closestAirports = getClosestAirports(lat, lon, numAirports);

    /*
     * v15.91 — les routes automatiques sont strictement les N PÉLIC actifs
     * les plus proches du feu. Déclarer un nouvel aérodrome comme PÉLIC ne peut
     * plus imposer ce terrain dans la sélection s'il est géographiquement loin.
     * Une sélection manuelle reste conservée uniquement tant qu'elle appartient
     * réellement à cette liste des N plus proches.
     */
    const closestOACIs = new Set(closestAirports.map(ap => ap.oaci));
    if (!selectedPelicanOACI || !closestOACIs.has(selectedPelicanOACI) || !isSelectablePelicanAirport(selectedPelicanOACI)) {
        selectedPelicanOACI = closestAirports.length > 0 ? closestAirports[0].oaci : null;
    }

    /* v15.86 — dessiner les PÉLIC après résolution de la sélection pour que
     * l'intérieur vert corresponde immédiatement au PÉLIC réellement choisi. */
    drawPermanentAirportMarkers();

    closestAirports.forEach(ap => {
        allPoints.push([ap.lat, ap.lon]);
        drawRoute([lat, lon], [ap.lat, ap.lon], { oaci: ap.oaci });
    });

    drawWaterPointMarkersForCommune(commune);

    /*
     * Si la BASE actuelle fait déjà partie des PÉLIC affichés, sa route PÉLIC
     * porte déjà le cartouche BASE au-dessus de l'OACI. Ne pas redessiner en
     * plus la route/étiquette BASE dédiée : cela créait un doublon visuel.
     */
    const isBaseInClosest = closestAirports.some(ap => normalizeOaciCodeInput(ap.oaci) === normalizeOaciCodeInput(selectedBaseOACI));
    if (showLftwRoute && !isBaseInClosest) {
        drawLftwRoute();
    }

    updateBaseLabels();
    updateCalculatorData();
    updateMapBingoDisplay();
 // Nous appelons directement la fonction de dessin. Si le GPS est actif, elle utilisera la dernière position.
    drawUserToTargetRoute();

    if (shouldFitBounds) {
        setTimeout(() => {
            if (userMarker && userMarker.getLatLng()) {
                allPoints.push(userMarker.getLatLng());
            }
            if (allPoints.length > 1) {
                map.fitBounds(L.latLngBounds(allPoints).pad(0.3));
            } else {
                map.setView([lat, lon], 10);
            }
        }, 300);
    }

    if (showTrafficLayer) {
        refreshTrafficLayer({ force: true, reason: 'commune' });
    }

    document.dispatchEvent(new Event('communeSelected'));
}

function selectPelicanOaciFromRoute(oaci) {
    const normalizedOaci = String(oaci || '').trim().toUpperCase();
    if (!normalizedOaci) return;
    selectedPelicanOACI = normalizedOaci;
    displayCommuneDetails(currentCommune, false);
}

/*
 * v17.18 — géométrie orthodromique commune à toutes les routes de navigation NPF.
 * Leaflet reçoit toujours UNE seule polyline continue ; les points intermédiaires
 * sont des sommets géographiques invisibles. Les tracés avion, Feu/PÉLIC/Base et
 * les branches de route WP utilisent ainsi exactement la même logique.
 * Environ un sommet tous les 10 NM, avec un maximum de 48 segments.
 */
function buildNpfGreatCircleLatLngs(startLatLng, endLatLng, distanceNm = null) {
    const startLat = Number(startLatLng?.[0]);
    const startLon = Number(startLatLng?.[1]);
    const endLat = Number(endLatLng?.[0]);
    const endLon = Number(endLatLng?.[1]);
    if (![startLat, startLon, endLat, endLon].every(Number.isFinite)) {
        return [startLatLng, endLatLng];
    }

    const totalDistanceNm = Number.isFinite(Number(distanceNm))
        ? Math.max(0, Number(distanceNm))
        : calculateDistanceInNm(startLat, startLon, endLat, endLon);
    if (!Number.isFinite(totalDistanceNm) || totalDistanceNm <= 0.01) {
        return [[startLat, startLon], [endLat, endLon]];
    }

    const initialTrueBearing = calculateBearing(startLat, startLon, endLat, endLon);
    if (!Number.isFinite(initialTrueBearing)) {
        return [[startLat, startLon], [endLat, endLon]];
    }

    const segmentCount = Math.min(48, Math.max(1, Math.ceil(totalDistanceNm / 10)));
    if (segmentCount <= 1) {
        return [[startLat, startLon], [endLat, endLon]];
    }

    const totalDistanceMeters = totalDistanceNm * 1852;
    const points = [[startLat, startLon]];
    for (let index = 1; index < segmentCount; index += 1) {
        const intermediate = calculateDestinationLatLng(
            startLat,
            startLon,
            initialTrueBearing,
            totalDistanceMeters * index / segmentCount
        );
        if (
            Array.isArray(intermediate)
            && Number.isFinite(Number(intermediate[0]))
            && Number.isFinite(Number(intermediate[1]))
        ) {
            points.push([Number(intermediate[0]), Number(intermediate[1])]);
        }
    }
    /* L'extrémité reste exactement la cible réelle, sans approximation accumulée. */
    points.push([endLat, endLon]);
    return points;
}

function drawRoute(startLatLng, endLatLng, options = {}) {
    const { oaci, isUser, isLftwRoute, magneticBearing, pane } = options;
    const distance = calculateDistanceInNm(startLatLng[0], startLatLng[1], endLatLng[0], endLatLng[1]);
    /* v17.18 — toutes les routes de navigation dessinées ici partagent la même orthodromie. */
    const routeLatLngs = buildNpfGreatCircleLatLngs(startLatLng, endLatLng, distance);
    let labelText, color = 'var(--primary-color)', dashArray = '', layer = routesLayer;

    if (isUser) {
        labelText = `${formatRouteDegrees(magneticBearing)} / ${Math.round(distance)} Nm`;
        color = 'var(--secondary-color)';
        dashArray = '5, 10';
        layer = userToTargetLayer;
    } else if (isLftwRoute) {
        labelText = `<b>BASE ${selectedBaseOACI}</b><span class="route-label-sub">${formatRouteDegrees(magneticBearing)} / ${Math.round(distance)} Nm / ${formatFlightTimeLabel(distance)}</span>`;
        color = 'var(--success-color)';
        dashArray = '5, 10';
        layer = lftwRouteLayer;
    } else if (oaci) {
        const isSelected = selectedPelicanOACI === oaci;
        /* v15.44 — routes pélicandromes : couleur vive + bord blanc, 100 % opaque. */
        color = isSelected ? '#39ff14' : '#00a8ff';
        const tooltipClass = isSelected
            ? 'route-tooltip route-tooltip-selected route-tooltip-near-icon'
            : 'route-tooltip route-tooltip-other-pelic route-tooltip-near-icon';
        const baseFlag = selectedBaseOACI === oaci
            ? '<div class="route-label-base-flag">BASE</div>'
            : '';
        labelText = `${baseFlag}<div class="route-label-oaci">${oaci}</div><div class="route-label-sub">${Math.round(distance)} Nm / ${formatFlightTimeLabel(distance)}</div>`;

        L.polyline(routeLatLngs, {
            color: '#ffffff',
            weight: 9,
            opacity: 1,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(layer);
        L.polyline(routeLatLngs, {
            color,
            weight: 5,
            opacity: 1,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(layer);

        const hitbox = L.polyline(routeLatLngs, { color: 'transparent', weight: 24, opacity: 0 }).addTo(layer);
        const selectPelicRoute = (event) => {
            try {
                if (event && event.originalEvent && typeof event.originalEvent.stopPropagation === 'function') {
                    event.originalEvent.stopPropagation();
                }
            } catch (_) {}
            selectPelicanOaciFromRoute(oaci);
        };

        hitbox.on('click', selectPelicRoute);

        const tooltipOptions = getRouteLabelNearAirportOptions(startLatLng, endLatLng, 'pelic');

        const tooltip = L.tooltip({
            permanent: true,
            interactive: true,
            direction: tooltipOptions.direction,
            offset: tooltipOptions.offset,
            className: `${tooltipClass} route-tooltip-clickable`,
            bubblingMouseEvents: false
        }).setLatLng(tooltipOptions.latLng).setContent(labelText).addTo(layer);

        tooltip.on('click', selectPelicRoute);
        tooltip.on('touchstart', selectPelicRoute);
        return;
    } else {
        labelText = `${Math.round(distance)} Nm`;
    }

    if (isUser) {
        /*
         * v17.18 — le trait rouge utilise la géométrie orthodromique commune NPF.
         * Le halo et le trait rouge utilisent exactement la même polyline continue.
         */
        L.polyline(routeLatLngs, {
            ...(pane ? { pane } : {}),
            color: '#ffffff',
            weight: 9,
            opacity: 0.95,
            dashArray,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(layer);
        L.polyline(routeLatLngs, {
            ...(pane ? { pane } : {}),
            color: '#e3001b',
            weight: 5,
            opacity: 1,
            dashArray,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(layer);
 // Pas d'étiquette sur la route rouge GPS -> Feu : l'information est affichée dans le bandeau commune.
        return;
    }

    if (isLftwRoute) {
        /* v15.44 — route Feu -> Base : pointillés plus épais et bordés de blanc. */
        L.polyline(routeLatLngs, {
            color: '#ffffff',
            weight: 9,
            opacity: 1,
            dashArray,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(layer);
        L.polyline(routeLatLngs, {
            color,
            weight: 5,
            opacity: 1,
            dashArray,
            interactive: false,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(layer);
    } else {
        L.polyline(routeLatLngs, { color, weight: 3, opacity: 0.8, dashArray }).addTo(layer);
    }

    if (isLftwRoute) {
        const tooltipOptions = getRouteLabelNearAirportOptions(startLatLng, endLatLng, 'base');
        L.tooltip({
            permanent: true,
            direction: tooltipOptions.direction,
            offset: tooltipOptions.offset,
            className: 'route-tooltip route-tooltip-base route-tooltip-near-icon'
        }).setLatLng(tooltipOptions.latLng).setContent(labelText).addTo(layer);
    } else if (oaci) {
        const tooltipOptions = getRouteLabelNearAirportOptions(startLatLng, endLatLng, 'default');
        L.tooltip({
            permanent: true,
            direction: tooltipOptions.direction,
            offset: tooltipOptions.offset,
            className: 'route-tooltip route-tooltip-near-icon'
        }).setLatLng(tooltipOptions.latLng).setContent(labelText).addTo(layer);
    }
}


function getPelicCandidateAirports() {
    /*
     * v13.59 — les terrains ajoutés manuellement comme PÉLIC sont traités
     * comme de vrais pélicandromes pour les routes, les bingos et les calculs.
     */
    const merged = [...pelicanAirports];
    otherAirports.forEach(ap => {
        if (customPelicanAirports.has(ap.oaci) && !merged.some(existing => existing.oaci === ap.oaci)) {
            merged.push(ap);
        }
    });
    return merged;
}

function isSelectablePelicanAirport(oaci) {
    const normalized = normalizeOaciCodeInput(oaci);
    if (!normalized) return false;
    return pelicanAirports.some(ap => ap.oaci === normalized) || customPelicanAirports.has(normalized);
}

function getSelectedPelicanAirport() {
    if (!selectedPelicanOACI || !isSelectablePelicanAirport(selectedPelicanOACI)) return null;
    return getAirportByOaci(selectedPelicanOACI);
}

function getClosestAirports(lat, lon, count) {
    return getPelicCandidateAirports()
        .filter(ap => !disabledAirports.has(ap.oaci))
        .map(ap => ({ ...ap, distance: calculateDistanceInNm(lat, lon, ap.lat, ap.lon) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, count);
}

function getAirportByOaci(oaci) {
    const normalized = normalizeOaciCodeInput(oaci);
    return [...pelicanAirports, ...otherAirports].find(ap => ap.oaci === normalized) || null;
}

function normalizeOaciCodeInput(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

/*
 * v14.55 — destination aéroport temporaire et fermeture tactile fiable.
 * Cette destination ne modifie ni le feu, ni la base, ni le pélicandrome, ni les
 * calculs mission. Elle remplace uniquement la route GPS et le bandeau de carte.
 */
function getAllKnownAirportsForSearch() {
    const unique = new Map();
    [...pelicanAirports, ...otherAirports].forEach((airport) => {
        const oaci = normalizeOaciCodeInput(airport?.oaci);
        const lat = Number(airport?.lat);
        const lon = Number(airport?.lon);
        if (!oaci || oaci.length !== 4 || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (!unique.has(oaci)) {
            unique.set(oaci, {
                oaci,
                name: String(airport?.name || oaci).trim(),
                lat,
                lon
            });
        }
    });
    return [...unique.values()];
}

function searchAirportsByOaci(rawSearch) {
    const raw = String(rawSearch || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,4}$/.test(raw)) return [];

    return getAllKnownAirportsForSearch()
        .filter(airport => airport.oaci.startsWith(raw))
        .sort((left, right) => {
            const exactDifference = Number(right.oaci === raw) - Number(left.oaci === raw);
            if (exactDifference) return exactDifference;
            return left.oaci.localeCompare(right.oaci, 'fr');
        })
        .slice(0, 8);
}

function clearAirportDestination({ restoreFire = true, redraw = true } = {}) {
    if (!selectedAirportDestination) return false;
    selectedAirportDestination = null;
    if (restoreFire && currentCommune) {
        armNpfFirePelicAutoCycle('fire');
    }

    if (redraw) {
        if (userToTargetLayer) userToTargetLayer.clearLayers();
        updateCommuneDisplay(restoreFire ? currentCommune : null);
        drawUserToTargetRoute();

        const communeDisplay = document.getElementById('commune-info-display');
        const searchOverlay = document.getElementById('ui-overlay');
        if (communeDisplay && (!searchOverlay || searchOverlay.style.display === 'none')) {
            communeDisplay.style.display = currentCommune ? 'flex' : 'none';
        }
    }
    return true;
}


function isCurrentFireGotoActive() {
    if (!currentCommune) return false;

    const waypointActive = (
        window.__npfWaypointRouteReady === true
        && typeof isNpfWaypointGotoActive === 'function'
        && isNpfWaypointGotoActive()
    );

    return !waypointActive && !selectedAirportDestination;
}

function activateCurrentFireGoto() {
    if (!currentCommune) return false;

    armNpfFirePelicAutoCycle('fire');

    /*
     * Le feu reste sélectionné même lorsqu'un GoTo WP ou aéroport/PÉLIC prend
     * temporairement la priorité. Reprendre le GoTo feu désactive uniquement
     * ces cibles de navigation, sans supprimer la route WP ni le feu.
     */
    selectedAirportDestination = null;

    if (
        window.__npfWaypointRouteReady === true
        && npfWaypointRouteState?.waypoints?.length
        && npfWaypointRouteState.gotoActive
    ) {
        npfWaypointRouteState.gotoActive = false;
        persistNpfWaypointRouteState();
        drawNpfWaypointRouteLines();
        updateNpfWaypointSegmentLabels();
    }

    updateCommuneDisplay(currentCommune);
    drawUserToTargetRoute();

    if (!userMarker && typeof requestOneShotGps === 'function') {
        requestOneShotGps({
            silent: true,
            highAccuracy: true,
            timeout: 15000,
            maximumAge: 600000
        });
    }

    try { map?.closePopup?.(); } catch (_) {}
    return true;
}

window.activateCurrentFireGoto = activateCurrentFireGoto;

function selectAirportDestination(airport) {
    const normalized = getAirportByOaci(airport?.oaci);
    if (!normalized) return false;

    /* Un GoTo aéroport/PÉLIC demandé manuellement suspend la navette automatique. */
    suspendNpfFirePelicAutoCycle();

    selectedAirportDestination = {
        oaci: normalized.oaci,
        name: normalized.name,
        lat: Number(normalized.lat),
        lon: Number(normalized.lon)
    };

    const searchInput = document.getElementById('search-input');
    const resultsList = document.getElementById('results-list');
    const clearSearchButton = document.getElementById('clear-search');
    if (searchInput) searchInput.value = '';
    if (resultsList) resultsList.style.display = 'none';
    if (clearSearchButton) clearSearchButton.style.display = 'none';

    if (!currentCommune) {
        const bingoDisplay = document.getElementById('bingo-map-display');
        if (bingoDisplay) bingoDisplay.style.display = 'none';
    }

    updateCommuneDisplay(currentCommune);
    drawUserToTargetRoute();

    if (!userMarker && typeof requestOneShotGps === 'function') {
        requestOneShotGps({
            silent: true,
            highAccuracy: true,
            timeout: 15000,
            maximumAge: 600000
        });
    }

    setTimeout(() => {
        if (!map || !selectedAirportDestination) return;
        const target = [selectedAirportDestination.lat, selectedAirportDestination.lon];
        const gps = userMarker && typeof userMarker.getLatLng === 'function'
            ? userMarker.getLatLng()
            : null;
        if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
            map.fitBounds(L.latLngBounds([[gps.lat, gps.lng], target]).pad(0.25), {
                animate: false
            });
        } else {
            map.setView(target, Math.max(8, Number(map.getZoom()) || 8), {
                animate: false
            });
        }
    }, 250);

    document.dispatchEvent(new Event('airportDestinationSelected'));
    return true;
}


function normalizeBaseOaciLockedLfInput(value) {
    const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!raw) return 'LF';
    if (raw.startsWith('LF')) return `LF${raw.slice(2, 4)}`;
    if (raw.length <= 2) return `LF${raw.slice(0, 2)}`;
    return `LF${raw.slice(-2)}`;
}

function selectBaseOaciSuffix(input) {
    if (!input) return;
    if (!input.value || !String(input.value).toUpperCase().startsWith('LF')) {
        input.value = normalizeBaseOaciLockedLfInput(input.value || selectedBaseOACI || 'LF');
    }
    try {
        requestAnimationFrame(() => {
            input.focus?.();
            input.setSelectionRange?.(2, Math.min(4, String(input.value || '').length));
        });
        setTimeout(() => input.setSelectionRange?.(2, Math.min(4, String(input.value || '').length)), 80);
    } catch (_) {}
}

function updateBaseOaciInputs() {
    const inputs = [
        document.getElementById('base-oaci-input'),
        document.getElementById('previ-base-oaci-input')
    ].filter(Boolean);

    inputs.forEach(input => {
        if (document.activeElement !== input) {
            input.value = selectedBaseOACI;
        }
        input.classList.remove('base-oaci-invalid');
        input.title = `Base actuelle : ${selectedBaseOACI}`;
    });
}

function applyBaseOaciFromInput(input, { silent = false } = {}) {
    if (!input) return false;

    const requestedOaci = normalizeBaseOaciLockedLfInput(input.value);
    input.value = requestedOaci;

    if (!requestedOaci || requestedOaci.length !== 4) {
        input.classList.add('base-oaci-invalid');
        if (!silent) alert('Code OACI base incomplet. Exemple : LFTW.');
        updateBaseOaciInputs();
        return false;
    }

    const airport = getAirportByOaci(requestedOaci);
    if (!airport) {
        input.classList.add('base-oaci-invalid');
        if (!silent) alert(`Base ${requestedOaci} inconnue dans la base terrains.`);
        updateBaseOaciInputs();
        return false;
    }

    selectedBaseOACI = requestedOaci;
    saveState();
    updateBaseLabels();
    updateCalculatorData();
    if (typeof window.updateBaseSunsetDisplay === 'function') {
        window.updateBaseSunsetDisplay();
    }
    refreshUI();
    return true;
}

function setupBaseOaciInputs() {
    const inputs = [
        document.getElementById('base-oaci-input'),
        document.getElementById('previ-base-oaci-input')
    ].filter(Boolean);

    inputs.forEach(input => {
        if (input.dataset.baseOaciBound === '1') return;
        input.dataset.baseOaciBound = '1';

        input.addEventListener('input', () => {
            const previousLength = input.value.length;
            input.value = normalizeBaseOaciLockedLfInput(input.value);
            input.classList.remove('base-oaci-invalid');
            if (input.value.length <= 2 || previousLength <= 2) {
                try { input.setSelectionRange(2, 2); } catch (_) {}
            }
        });

        input.addEventListener('change', () => {
            applyBaseOaciFromInput(input);
        });

        input.addEventListener('blur', () => {
            if (normalizeBaseOaciLockedLfInput(input.value) !== selectedBaseOACI) {
                applyBaseOaciFromInput(input);
            } else {
                updateBaseOaciInputs();
            }
        });

        input.addEventListener('focus', () => selectBaseOaciSuffix(input));
        input.addEventListener('click', () => selectBaseOaciSuffix(input));
        input.addEventListener('pointerup', () => selectBaseOaciSuffix(input));

        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyBaseOaciFromInput(input);
                input.blur();
            } else if (event.key === 'Escape') {
                input.value = selectedBaseOACI;
                input.classList.remove('base-oaci-invalid');
                input.blur();
            }
        });
    });

    updateBaseOaciInputs();
}

function updateBaseLabels() {
    const routeButton = document.getElementById('lftw-route-button');
    if (routeButton) {
        routeButton.innerHTML = `Route BASE<br>${selectedBaseOACI}`;
        routeButton.title = `Afficher/Masquer la route vers la base ${selectedBaseOACI}`;
    }
    const csBaseLabel = document.getElementById('cs-base-label');
    if (csBaseLabel) csBaseLabel.textContent = 'Base';
    const previCsBaseLabel = document.getElementById('previ-cs-base-label');
    if (previCsBaseLabel) previCsBaseLabel.textContent = 'Base';
    updateBaseOaciInputs();
    document.querySelectorAll('.base-bingo-label').forEach(el => {
        el.textContent = 'BINGO BASE';
    });
    const deroutFuelMiniBaseLabel = document.getElementById('derout-fuel-mini-base-label');
    if (deroutFuelMiniBaseLabel) deroutFuelMiniBaseLabel.textContent = `Fuel mini 1 Lrg / BASE (${selectedBaseOACI}) :`;

    const deroutFuelMiniPelicLabel = document.getElementById('derout-fuel-mini-pelic-label');
    if (deroutFuelMiniPelicLabel) {
        const selectedPelic = selectedPelicanOACI ? getAirportByOaci(selectedPelicanOACI) : null;
        const pelicCode = selectedPelic ? selectedPelic.oaci : 'PÉLIC';
        deroutFuelMiniPelicLabel.textContent = `Fuel mini 1 Lrg / Pélic (${pelicCode}) :`;
    }
}
function refreshUI() {
    drawPermanentAirportMarkers();
    drawNpfRunwayMapLayer();
    if (currentCommune) displayCommuneDetails(currentCommune, false);
}


