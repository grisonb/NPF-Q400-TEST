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
    installerNpfBaseBandeau(lftwEl);

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
    /* v17.90 — nouveau feu : traits AVION / PÉLIC -> FEU en ligne droite ; même feu : WP gardés (src/205). */
    if (typeof syncNpfTraitsFeuPourFeu === 'function') syncNpfTraitsFeuPourFeu(commune);
    saveFireHistory(commune);
    routesLayer.clearLayers();
    npfPelicRouteTouchLines = [];
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

    closestAirports.forEach((ap, index) => {
        allPoints.push([ap.lat, ap.lon]);
        /* v17.86 — le plus proche (liste triée par distance) garde sa bordure verte même si un autre est choisi. */
        drawRoute([lat, lon], [ap.lat, ap.lon], { oaci: ap.oaci, isNearest: index === 0 });
    });
    /* v17.90 — WP des traits AVION / PÉLIC -> FEU (src/205). */
    if (typeof drawNpfTraitsFeu === 'function') drawNpfTraitsFeu();

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
            /* v17.96 — avion hors de la métropole (src/030) : pas dans le cadre du feu (pas de vue vers une position lointaine). */
            if (userMarker && userMarker.getLatLng() && isNpfPositionCentrable(userMarker.getLatLng().lat, userMarker.getLatLng().lng)) {
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

/* v17.90 (décision de Bastien du 04/11/2026) — pendant un feu, un Go To vers un AUTRE pélicandrome que celui choisi en fait
 * le pélicandrome choisi, exactement comme un choix à la main (selectPelicanOaciFromRoute) : calculateur, bandeau du feu,
 * bordure verte ; son trait -> feu sert au calcul avec ses WP s'il en a. Le trait de l'ancien pélicandrome garde ses WP et
 * reste dessiné. Comme le choix à la main : seulement parmi les routes PÉLIC affichées (les N plus proches du feu). */
function choisirNpfPelicCibleGoto(oaci) {
    const cible = normalizeOaciCodeInput(oaci);
    if (!currentCommune || !cible || cible === selectedPelicanOACI || !isSelectablePelicanAirport(cible)) return false;
    const affiches = typeof getNpfTraitsFeuPelicAffiches === 'function' ? getNpfTraitsFeuPelicAffiches() : [];
    if (!affiches.includes(cible)) return false;
    selectPelicanOaciFromRoute(cible);
    return true;
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

/*
 * v18.06 — bande de toucher des traits PÉLIC -> FEU au-dessus des couches SIA (comme les terrains en v15.50) : niveau
 * 662, juste sous les zones rondes des terrains (npfTouchPane, 665) qui gardent la priorité sur leur symbole ; au-dessus
 * des canvas SIA (zones 440, points 555) et des cibles VRP (660) qui prenaient tout le toucher. Rendu SVG (fiable pour le
 * toucher sur Safari / iPad), créé au premier trait dessiné.
 */
/* var (et non let) : displayCommuneDetails, plus haut dans le fichier, peut s'en servir dès le démarrage. */
var npfPelicRouteTouchRenderer = null;
/*
 * Second chemin, indépendant de la cible choisie par le navigateur : Safari (iPad) peut envoyer le clic d'un toucher
 * posé sur la bande à un canvas voisin (choix « au plus probable » de la cible). Au clic sur la carte (jamais pendant
 * un geste), un trait à moins de 12 px du doigt (demi-largeur de la bande) change le PÉLIC, sauf dans la zone ronde
 * d'un terrain (32 px, le terrain garde la priorité sur son symbole) et sauf le clic qui suit un appui long.
 */
var npfPelicRouteTouchLines = [];
var npfPelicRouteMapClickInstalled = false;
function getNpfPelicRouteNearContainerPoint(point) {
    if (!map || !point || !npfPelicRouteTouchLines.length) return null;
    const terrainProche = (() => {
        let trouve = false;
        try {
            if (typeof permanentAirportLayer !== 'undefined' && permanentAirportLayer) {
                permanentAirportLayer.eachLayer(layer => {
                    if (trouve || !layer || !layer._npfAirportOaci || !(layer instanceof L.CircleMarker) || !layer._map) return;
                    const c = map.latLngToContainerPoint(layer.getLatLng());
                    if (Math.hypot(c.x - point.x, c.y - point.y) <= Number(layer.options?.radius || 32)) trouve = true;
                });
            }
        } catch (_) {}
        return trouve;
    })();
    if (terrainProche) return null;
    let meilleur = null;
    npfPelicRouteTouchLines.forEach(trait => {
        const pts = trait.latlngs.map(ll => map.latLngToContainerPoint(ll));
        for (let i = 1; i < pts.length; i += 1) {
            const a = pts[i - 1], b = pts[i];
            const dx = b.x - a.x, dy = b.y - a.y;
            const l2 = dx * dx + dy * dy;
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / l2)) : 0;
            const d = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
            if (d <= 12 && (!meilleur || d < meilleur.d)) meilleur = { oaci: trait.oaci, d };
        }
    });
    return meilleur;
}
function installNpfPelicRouteMapClick() {
    if (npfPelicRouteMapClickInstalled || !map) return;
    npfPelicRouteMapClickInstalled = true;
    /* Position EXACTE du doigt au début du toucher : le clic qui suit peut arriver déplacé de quelques pixels
     * (ajustement de la cible par le navigateur). Écoute passive, aucune action pendant un geste. */
    let dernierAppui = null;
    const conteneur = map.getContainer();
    conteneur.addEventListener('pointerdown', event => {
        const r = conteneur.getBoundingClientRect();
        dernierAppui = { x: Number(event.clientX) - r.left, y: Number(event.clientY) - r.top, at: Date.now() };
    }, { capture: true, passive: true });
    map.on('click', event => {
        try {
            if (!currentCommune || (typeof isDrawingMode !== 'undefined' && isDrawingMode) || !event?.containerPoint) return;
            const appuiLong = window.__npfFireLongPressTouchState;
            if (appuiLong && Date.now() < Number(appuiLong.suppressSyntheticClickUntil || 0)) return;
            const point = dernierAppui && Date.now() - dernierAppui.at < 1000
                ? L.point(dernierAppui.x, dernierAppui.y)
                : event.containerPoint;
            const trait = getNpfPelicRouteNearContainerPoint(point);
            if (trait) selectPelicanOaciFromRoute(trait.oaci);
        } catch (_) {}
    });
}
function getNpfPelicRouteTouchRenderer() {
    if (!map || !map.createPane) return undefined;
    installNpfPelicRouteMapClick();
    if (!map.getPane('npfPelicRouteTouchPane')) {
        const pane = map.createPane('npfPelicRouteTouchPane');
        pane.style.zIndex = '662';
        pane.style.pointerEvents = 'auto';
    }
    if (!npfPelicRouteTouchRenderer && L.svg) npfPelicRouteTouchRenderer = L.svg({ padding: 0.35, pane: 'npfPelicRouteTouchPane' });
    return npfPelicRouteTouchRenderer || undefined;
}

function drawRoute(startLatLng, endLatLng, options = {}) {
    const { oaci, isUser, isLftwRoute, magneticBearing, pane } = options;
    /* v17.57 — A : route avion -> cible et Feu -> BASE : chemin à cap constant
     * et distance fournis par l'appelant. Routes PÉLIC (sans cap affiché) :
     * orthodromie et distance inchangées (v17.18). */
    /* v17.90 — trait PÉLIC -> FEU modifié (WP, src/205) : la route suit les WP ; distance totale pour l'étiquette
     * (temps de vol, Rot.). Ni la route avion, ni la route BASE dédiée. */
    const traitPelic = oaci && !isUser && !isLftwRoute && typeof getNpfTraitFeuRoutePelic === 'function' ? getNpfTraitFeuRoutePelic(oaci) : null;
    const distance = traitPelic ? traitPelic.distanceNm : (Number.isFinite(Number(options.distanceNm))
        ? Number(options.distanceNm)
        : calculateDistanceInNm(startLatLng[0], startLatLng[1], endLatLng[0], endLatLng[1]));
    const routeLatLngs = traitPelic ? traitPelic.latlngs : (Array.isArray(options.routeLatLngs) && options.routeLatLngs.length >= 2
        ? options.routeLatLngs
        : buildNpfGreatCircleLatLngs(startLatLng, endLatLng, distance));
    let labelText, color = 'var(--primary-color)', dashArray = '', layer = routesLayer;

    if (isUser) {
        labelText = `${formatRouteDegrees(magneticBearing)} / ${Math.round(distance)} Nm`;
        color = 'var(--secondary-color)';
        dashArray = '5, 10';
        layer = userToTargetLayer;
    } else if (isLftwRoute) {
        labelText = `<b>BASE ${selectedBaseOACI}</b><span class="route-label-sub">${formatRouteDegrees(magneticBearing)} / ${Math.round(distance)} Nm / ${formatFlightTimeLabel(Math.round(distance))}</span>`;
        color = 'var(--success-color)';
        dashArray = '5, 10';
        layer = lftwRouteLayer;
    } else if (oaci) {
        const isSelected = selectedPelicanOACI === oaci;
        /* v15.44 — routes pélicandromes : couleur vive + bord blanc, 100 % opaque. */
        color = isSelected ? '#39ff14' : '#00a8ff';
        const tooltipClass = isSelected
            ? 'route-tooltip route-tooltip-selected route-tooltip-near-icon'
            : `route-tooltip route-tooltip-other-pelic route-tooltip-near-icon${options.isNearest ? ' route-tooltip-nearest-pelic' : ''}`;
        const baseFlag = selectedBaseOACI === oaci
            ? '<div class="route-label-base-flag">BASE</div>'
            : '';
        /* v17.86 — temps de rotation feu ↔ ce pélicandrome : MÊME calcul que le calculateur (distance arrondie,
         * calculateRotationTime, résultat arrondi ; src/290 et updateCalculatorData). Calculé une fois, au dessin
         * des routes (feu ou pélicandrome choisi), jamais pendant les déplacements de la carte.
         * v17.89 — temps de vol et rotation calculés sur la MÊME distance : celle affichée, arrondie au Nm. */
        let rotationLine = '';
        try {
            const rotationMinutes = Math.round(calculateRotationTime(Math.round(distance)));
            if (Number.isFinite(rotationMinutes) && rotationMinutes > 0) {
                rotationLine = `<div class="route-label-sub route-label-rotation">Rot. ${rotationMinutes} min</div>`;
            }
        } catch (_) {}
        labelText = `${baseFlag}<div class="route-label-oaci">${oaci}</div><div class="route-label-sub">${Math.round(distance)} Nm / ${formatFlightTimeLabel(Math.round(distance))}</div>${rotationLine}`;

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

        const touchRenderer = getNpfPelicRouteTouchRenderer();
        /* Trait quasi invisible (0,002) et non totalement transparent : comme les zones des terrains (v15.50), sinon
         * Safari / iPad ne le retient pas toujours pour le toucher. */
        const hitbox = L.polyline(routeLatLngs, {
            color: '#000000',
            weight: 24,
            opacity: 0.002,
            pane: touchRenderer ? 'npfPelicRouteTouchPane' : undefined,
            renderer: touchRenderer,
            className: 'npf-pelic-route-touch',
            bubblingMouseEvents: false
        }).addTo(layer);
        npfPelicRouteTouchLines.push({ oaci, latlngs: routeLatLngs });
        const selectPelicRoute = (event) => {
            try {
                if (event && event.originalEvent && typeof event.originalEvent.stopPropagation === 'function') {
                    event.originalEvent.stopPropagation();
                }
            } catch (_) {}
            /* v18.06 — clic que Safari émet à la fin d'un appui long (WP des traits, src/205) : pas un changement de PÉLIC. */
            try {
                const appuiLong = window.__npfFireLongPressTouchState;
                if (appuiLong && Date.now() < Number(appuiLong.suppressSyntheticClickUntil || 0)) return;
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

    /* v17.90 — un Go To vers un autre point ferme le feu, comme « Fermer » (WP de ses traits compris) ; un Go To vers
     * N'IMPORTE QUEL pélicandrome le garde, avec ses WP (décision de Bastien). */
    if (currentCommune && !isSelectablePelicanAirport(normalized.oaci)) clearCurrentSelection({ preserveMapView: true });
    else if (currentCommune) choisirNpfPelicCibleGoto(normalized.oaci);

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
        /* v17.96 — avion hors de la métropole (src/030) : la carte va sur le terrain seul (pas de vue vers une position lointaine). */
        if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng) && isNpfPositionCentrable(gps.lat, gps.lng)) {
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


/*
 * v18.06 (décision de Bastien) — bandeau « BINGO BASE LFxx » : un toucher sur toute cette partie ouvre une petite fenêtre
 * où l'on TAPE le code OACI de la base, exactement comme le champ « Base » du calculateur : même saisie (LF imposé,
 * majuscules), mêmes contrôles et mêmes messages, même effet (applyBaseOaciFromInput : base, calculateur, BINGO,
 * routes, coucher du soleil). Pas de liste. Annuler (ou toucher hors de la fenêtre) ferme sans rien changer.
 */
function installerNpfBaseBandeau(element) {
    if (!element || element.dataset.npfBaseBandeau === '1') return;
    element.dataset.npfBaseBandeau = '1';
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', 'Changer la base');
    element.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        ouvrirNpfBaseBandeau();
    });
}

function fermerNpfBaseBandeau() {
    const fenetre = document.getElementById('npf-base-bandeau-modal');
    if (fenetre) fenetre.hidden = true;
}

function ouvrirNpfBaseBandeau() {
    let fenetre = document.getElementById('npf-base-bandeau-modal');
    if (!fenetre) {
        fenetre = document.createElement('div');
        fenetre.id = 'npf-base-bandeau-modal';
        fenetre.className = 'npf-base-bandeau-modal';
        fenetre.hidden = true;
        fenetre.innerHTML = `
            <div class="npf-base-bandeau-boite" role="dialog" aria-modal="true" aria-labelledby="npf-base-bandeau-titre">
                <div id="npf-base-bandeau-titre" class="npf-base-bandeau-titre">Base</div>
                <input type="text" id="npf-base-bandeau-input" class="npf-base-bandeau-input" inputmode="text" maxlength="4" placeholder="OACI"
                    autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done">
                <div class="npf-base-bandeau-boutons">
                    <button type="button" id="npf-base-bandeau-annuler" class="npf-base-bandeau-annuler">Annuler</button>
                    <button type="button" id="npf-base-bandeau-valider" class="npf-base-bandeau-valider">Valider</button>
                </div>
            </div>`;
        document.body.appendChild(fenetre);
        const input = fenetre.querySelector('#npf-base-bandeau-input');
        /* Même saisie que le champ « Base » du calculateur (setupBaseOaciInputs). */
        input.addEventListener('input', () => {
            const previousLength = input.value.length;
            input.value = normalizeBaseOaciLockedLfInput(input.value);
            input.classList.remove('base-oaci-invalid');
            if (input.value.length <= 2 || previousLength <= 2) {
                try { input.setSelectionRange(2, 2); } catch (_) {}
            }
        });
        input.addEventListener('focus', () => selectBaseOaciSuffix(input));
        const valider = () => {
            if (applyBaseOaciFromInput(input)) fermerNpfBaseBandeau();
        };
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                valider();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                fermerNpfBaseBandeau();
            }
        });
        fenetre.querySelector('#npf-base-bandeau-valider').addEventListener('click', event => {
            event.preventDefault();
            valider();
        });
        fenetre.querySelector('#npf-base-bandeau-annuler').addEventListener('click', event => {
            event.preventDefault();
            fermerNpfBaseBandeau();
        });
        fenetre.addEventListener('click', event => {
            if (event.target === fenetre) fermerNpfBaseBandeau();
        });
    }
    const input = fenetre.querySelector('#npf-base-bandeau-input');
    input.value = selectedBaseOACI || 'LF';
    input.classList.remove('base-oaci-invalid');
    fenetre.hidden = false;
    try { input.focus(); } catch (_) {}
    selectBaseOaciSuffix(input);
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


