function initMap() {
    if (map) return;
    map = L.map('map', {
        attributionControl: false,
        zoomControl: false,
        maxZoom: GLOBAL_MAX_ZOOM,
 // v13.58 — iPad : moins d'animations Leaflet pour éviter les anciennes tuiles étirées/bleues après zoom.
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false
    });

    /*
     * v17.19 — fixer le cadrage de démarrage AVANT setupBaseTileLayer().
     * Les premières requêtes de tuiles correspondent ainsi directement au
     * viewport utile au lieu de partir sur France puis d'être abandonnées.
     */
    let startupInitialViewApplied = false;
    try {
        if (currentCommune) {
            startupInitialViewApplied = fitMapToStartupFireContext({
                reason: 'pretiles-saved-fire-v17.19'
            });
            if (startupInitialViewApplied && getStoredGpsPosition()) {
                startupGpsStoredCenterAppliedAt = Date.now();
            }
        }
    } catch (_) {}

    if (!startupInitialViewApplied) {
        try {
            const storedStartupGps = getStoredGpsPosition();
            if (storedStartupGps) {
                map.setView(
                    [storedStartupGps.lat, storedStartupGps.lng],
                    STARTUP_GPS_CENTER_ZOOM,
                    { animate: false }
                );
                startupGpsStoredCenterAppliedAt = Date.now();
                startupInitialViewApplied = true;
            }
        } catch (_) {}
    }

    if (!startupInitialViewApplied) {
        map.setView([46.6, 2.2], 5.5, { animate: false });
    }

    map.on('movestart', () => {
        const gpsFollowPan = isNpfGpsFollowProgrammaticPan();

        /*
         * v16.55 / v17.04 — le recentrage automatique GPS/simulation ne doit
         * JAMAIS entrer dans le séquenceur Tuiles -> VFR -> HT -> Routes.
         *
         * Les calques déjà rendus restent visibles et se déplacent naturellement
         * avec Leaflet. Routes/HT ne seront recalculés par leur mécanisme
         * historique que si leur couverture devient insuffisante.
         */
        if (gpsFollowPan) {
            /*
             * v17.05 — si le GPS reprend pendant qu'une restitution issue
             * d'un geste manuel est encore active, cette restitution concerne
             * désormais un ancien viewport : on l'annule et on réaffiche
             * immédiatement VFR/HT/Routes, sans recalcul lourd.
             */
            cancelNpfMapOverlayPriorityForGpsResume('gps-movestart');

            /*
             * Conserver le comportement historique SIA : arrêter uniquement
             * un ancien travail SIA issu du mouvement carte, sans masquer les
             * points déjà visibles et sans toucher aux tuiles.
             */
            if (typeof cancelObsoleteSiaMapMotionWork === 'function') {
                cancelObsoleteSiaMapMotionWork('gps-movestart');
            }
            return;
        }

        /*
         * v17.07 — priorité stricte uniquement pour un déplacement utilisateur.
         * Le premier start ouvre le verrou ; les starts suivants du même geste
         * sont ignorés jusqu'à stabilisation.
         */
        const startedNewNpfManualGesture = beginNpfMapOverlayPrioritySequence('movestart');

        /*
         * v17.12 — un seul epoch de priorité tuiles par geste manuel.
         * `movestart` et `zoomstart` peuvent appartenir au même pinch/pan ;
         * seul le premier start qui ouvre réellement le verrou de geste peut
         * donc rebattre la priorité de la file IndexedDB et trimmer le cache.
         */
        if (startedNewNpfManualGesture) {
            beginBaseMapZoomStabilityGuard('movestart');
        }
        beginMapVisualRenderGuard('movestart');
        if (showRoadOverlayLayer) {
            roadOverlayRefreshToken += 1;
            clearTimeout(roadOverlayRefreshTimer);
        }
        if (showHighVoltageLinesLayer) {
            highVoltageLinesRefreshToken += 1;
            clearTimeout(highVoltageLinesRefreshTimer);
        }
    });
    map.on('zoomstart', () => {
        /*
         * v17.11 — un pinch reconnu comme zoom ne doit jamais basculer ensuite
         * en règle deux doigts, même si Safari a retardé des touchmove.
         */
        cancelTwoFingerRulerTimer();
        if (!twoFingerRulerActive) twoFingerRulerStartPoints = null;

        /* v17.15 — figer visuellement le fond déjà peint avant que Leaflet ne
         * libère l'ancien niveau. La GridLayer réelle reste totalement autonome. */
        beginNpfBaseTileZoomVisualSnapshot('zoomstart');

        const startedNewNpfManualGesture = beginNpfMapOverlayPrioritySequence('zoomstart');
        /* v17.12 : les starts secondaires du même geste ne recréent pas un epoch tuiles. */

        if (!Number.isFinite(npfHeavyOverlayZoomStartLevel)) {
            npfHeavyOverlayZoomStartLevel = Number(map.getZoom?.());
        }
        /* v16.60 — tout nouveau geste invalide une ancienne séquence lourde.
         * Quand Routes + HT sont actifs, masquer les panes immédiatement :
         * WebKit ne redimensionne/repeint plus les anciens Canvas pendant le pinch. */
        npfHeavyOverlayZoomSerialToken += 1;
        if (npfHeavyOverlayZoomSettleTimer) {
            clearTimeout(npfHeavyOverlayZoomSettleTimer);
            npfHeavyOverlayZoomSettleTimer = null;
        }
        if (hasEffectiveHeavyOverlayAtCurrentZoom()) {
            /*
             * v16.76 — Routes ON en tier 0 est volontairement inerte : à 5 NM
             * et au-delà, aucune route n'est affichée et le zoom doit rester
             * identique à la carte seule de référence v16.75.
             */
            setNpfHeavyOverlayPanesHidden(true);
            /*
             * v17.09 — aucun nettoyage de cache Routes pendant le geste.
             * La mémoire source sera éventuellement libérée après le rendu,
             * jamais au zoomstart : pendant le geste, seule la carte travaille.
             */
        }
        if (directOfflineNpfZoomSettleTimer) {
            clearTimeout(directOfflineNpfZoomSettleTimer);
            directOfflineNpfZoomSettleTimer = null;
        }
        if (startedNewNpfManualGesture) {
            beginBaseMapZoomStabilityGuard('zoomstart');
        }
        beginMapVisualRenderGuard('zoomstart');
        if (showRoadOverlayLayer) {
            roadOverlayRefreshToken += 1;
            clearTimeout(roadOverlayRefreshTimer);
        }
        if (showHighVoltageLinesLayer) {
            highVoltageLinesRefreshToken += 1;
            clearTimeout(highVoltageLinesRefreshTimer);
        }
    });
    map.on('zoomend', enforceOfflineZoomLimit);
    map.on('zoomend', () => {
        /* v17.15 — recaler le snapshot de l'ancien niveau sur la vue finale ;
         * les nouvelles tuiles réelles le recouvrent progressivement. */
        settleNpfBaseTileZoomVisualSnapshot('zoomend');

        /*
         * v16.71 — retour ciblé au scheduling v16.50 : nettoyage immédiat de la
         * file pour la vue finale, sans délai de stabilisation de 240 ms.
         */
        if (directOfflineNpfZoomSettleTimer) {
            clearTimeout(directOfflineNpfZoomSettleTimer);
            directOfflineNpfZoomSettleTimer = null;
        }
        try { pruneDirectOfflineNpfQueueForCurrentView('zoomend'); } catch (_) {}
        try { trimDirectOfflineTileBlobCache(); } catch (_) {}
        scheduleBaseMapStabilityRefresh('zoomend');
        scheduleNpfOfflineZoomCleanup('zoomend');
        scheduleNpfMapOverlayPriorityRestore('zoomend');
        scheduleTrafficVisualResumeAfterMapInteraction('zoomend');
    });
    map.on('moveend', () => {
        const gpsFollowPan = isNpfGpsFollowProgrammaticPan();

        /*
         * v17.04 — recentrage automatique GPS/simulation :
         * - aucune purge tuiles ajoutée ;
         * - aucune séquence de masquage/restauration overlays ;
         * - aucun traitement visuel manuel.
         *
         * Les handlers historiques SIA / HT / Routes restent libres de gérer
         * seulement les changements de couverture nécessaires.
         */
        if (gpsFollowPan) {
            cancelNpfMapOverlayPriorityForGpsResume('gps-moveend');
            scheduleNpfGpsTileCoverageRepair('gps-moveend');
            return;
        }

        try { pruneDirectOfflineNpfQueueForCurrentView('moveend'); } catch (_) {}
        scheduleNpfMapOverlayPriorityRestore('moveend');
        scheduleTrafficVisualResumeAfterMapInteraction('moveend');
    });
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    ensureNauticalScaleControl();
    ensureTwoFingerRulerControl();
    installTrafficPopupMapDismissInteraction();
    applyMapNoBackgroundStyle();

    if (map.createPane && !map.getPane('highVoltageLinesPane')) {
        map.createPane('highVoltageLinesPane');
        const htPane = map.getPane('highVoltageLinesPane');
        if (htPane) htPane.style.zIndex = '385';
    }
    if (map.createPane && !map.getPane('roadOverlayCasingPane')) {
        map.createPane('roadOverlayCasingPane');
        const roadCasingPane = map.getPane('roadOverlayCasingPane');
        if (roadCasingPane) {
            roadCasingPane.style.zIndex = '405';
            roadCasingPane.style.pointerEvents = 'none';
        }
    }
    if (map.createPane && !map.getPane('roadOverlayLinePane')) {
        map.createPane('roadOverlayLinePane');
        const roadLinePane = map.getPane('roadOverlayLinePane');
        if (roadLinePane) {
            roadLinePane.style.zIndex = '410';
            roadLinePane.style.pointerEvents = 'none';
        }
    }
    if (map.createPane && !map.getPane('roadOverlayLabelPane')) {
        map.createPane('roadOverlayLabelPane');
        const roadLabelPane = map.getPane('roadOverlayLabelPane');
        if (roadLabelPane) {
            roadLabelPane.style.zIndex = '415';
            roadLabelPane.style.pointerEvents = 'none';
        }
    }
    if (map.createPane && !map.getPane('trafficAdvisoryPane')) {
        map.createPane('trafficAdvisoryPane');
        const advisoryPane = map.getPane('trafficAdvisoryPane');
        if (advisoryPane) advisoryPane.style.zIndex = '675';
    }
    if (map.createPane && !map.getPane('trafficPane')) {
        map.createPane('trafficPane');
        const trafficPane = map.getPane('trafficPane');
        if (trafficPane) trafficPane.style.zIndex = '690';
    }
    if (map.createPane && !map.getPane('siaAirspacePane')) {
        map.createPane('siaAirspacePane');
        const siaAirspacePane = map.getPane('siaAirspacePane');
        if (siaAirspacePane) siaAirspacePane.style.zIndex = '440';
    }
    if (map.createPane && !map.getPane('siaCtrTouchPane')) {
        map.createPane('siaCtrTouchPane');
        const siaCtrTouchPane = map.getPane('siaCtrTouchPane');
        if (siaCtrTouchPane) siaCtrTouchPane.style.zIndex = '445';
    }
    if (map.createPane && !map.getPane('siaPointPane')) {
        map.createPane('siaPointPane');
        const siaPointPane = map.getPane('siaPointPane');
        if (siaPointPane) siaPointPane.style.zIndex = '555';
    }
    if (map.createPane && !map.getPane('siaPointTouchPane')) {
        map.createPane('siaPointTouchPane');
        const siaPointTouchPane = map.getPane('siaPointTouchPane');
        if (siaPointTouchPane) {
            siaPointTouchPane.style.zIndex = '660';
            siaPointTouchPane.style.pointerEvents = 'auto';
        }
    }
    if (map.createPane && !map.getPane('npfTouchPane')) {
        map.createPane('npfTouchPane');
        const npfTouchPane = map.getPane('npfTouchPane');
        if (npfTouchPane) {
            npfTouchPane.style.zIndex = '665';
            npfTouchPane.style.pointerEvents = 'auto';
        }
    }
    // v15.50 — renderer tactile NPF disponible avant le premier dessin des terrains.
    if (!npfTouchRenderer && L.svg) {
        npfTouchRenderer = L.svg({ padding: 0.35, pane: 'npfTouchPane' });
    }
    if (!siaPointTouchRenderer && L.svg) {
        siaPointTouchRenderer = L.svg({ padding: 0.35, pane: 'siaPointTouchPane' });
    }

    if (map.createPane && !map.getPane('ownAircraftPane')) {
        map.createPane('ownAircraftPane');
        const ownAircraftPane = map.getPane('ownAircraftPane');
        if (ownAircraftPane) {
            ownAircraftPane.style.zIndex = '698';
            ownAircraftPane.style.pointerEvents = 'none';
        }
    }
    /* v15.80 — hitbox des points GAAR au-dessus des surfaces tactiles SIA. */
    if (map.createPane && !map.getPane('gaarEditTouchPane')) {
        map.createPane('gaarEditTouchPane');
        const pane = map.getPane('gaarEditTouchPane');
        if (pane) {
            pane.style.zIndex = '695';
            pane.style.pointerEvents = 'auto';
        }
    }
    if (!gaarEditTouchRenderer && L.svg) {
        gaarEditTouchRenderer = L.svg({ padding: 0.35, pane: 'gaarEditTouchPane' });
    }

    if (map.createPane && !map.getPane('npfRunwaysPane')) {
        map.createPane('npfRunwaysPane');
        const runwayPane = map.getPane('npfRunwaysPane');
        if (runwayPane) {
            runwayPane.style.zIndex = '390';
            runwayPane.style.pointerEvents = 'none';
        }
    }
    /*
     * v17.31 — canvas HT dans son propre pane (journal, section 16, piste 2).
     * Sans option `pane`, Leaflet plaçait ce canvas dans overlayPane (z400) :
     * le masquage de highVoltageLinesPane pendant les gestes n'avait aucun
     * effet sur HT. Le canvas passe ainsi en z385, sous les pistes (z390).
     */
    highVoltageLinesRenderer = L.canvas
        ? L.canvas({
            padding: 0.35,
            pane: 'highVoltageLinesPane'
        })
        : null;
    npfRunwayRenderer = L.canvas
        ? L.canvas({
            padding: 0.35,
            pane: 'npfRunwaysPane'
        })
        : null;

    /*
     * v14.16 — un Canvas distinct par pane.
     * Le partage d'un même renderer entre l'entourage et la ligne pouvait
     * provoquer des redessins incomplets sur Safari/iPadOS.
     */
    roadOverlayCasingRenderer = L.canvas
        ? L.canvas({
            padding: 0.55,
            pane: 'roadOverlayCasingPane'
        })
        : null;
    roadOverlayLineRenderer = L.canvas
        ? L.canvas({
            padding: 0.55,
            pane: 'roadOverlayLinePane'
        })
        : null;

    setupBaseTileLayer();
    npfRunwayMapLayer = L.layerGroup().addTo(map);
    permanentAirportLayer = L.layerGroup().addTo(map);
    airportOperationalLabelLayer = L.layerGroup().addTo(map);
    /*
     * v16.90 — les libellés nom/fréquence sont des DIV Leaflet. Sur iPad,
     * on ne les compose plus pendant un geste de carte : ils disparaissent
     * au début du drag/zoom puis sont reconstruits après stabilisation.
     * Cela élimine aussi les reliquats tronqués observés après zoom arrière.
     */
    map.on('zoomstart dragstart', () => clearAirportOperationalLabelsForMapMotion());
    map.on('zoomend', () => scheduleAirportOperationalLabelsRefresh(0));
    map.on('moveend', () => scheduleAirportOperationalLabelsRefresh(180));
    routesLayer = L.layerGroup().addTo(map);
    fireHistoryLayer = L.layerGroup().addTo(map);
    waterPointsLayer = L.layerGroup().addTo(map);
    userToTargetLayer = L.layerGroup().addTo(map);
    lftwRouteLayer = L.layerGroup().addTo(map);
    gaarLayer = L.layerGroup().addTo(map);
    departmentsLayerGroup = L.layerGroup();
    departmentsLabelsLayer = L.layerGroup();
    highVoltageLinesLayer = L.layerGroup();
    roadOverlayCasingLayer = L.layerGroup();
    roadOverlayLineLayer = L.layerGroup();
    roadOverlayLabelsLayer = L.layerGroup();
    roadOverlayLayer = L.layerGroup([
        roadOverlayCasingLayer,
        roadOverlayLineLayer,
        roadOverlayLabelsLayer
    ]);
    trafficLayer = L.layerGroup();
    trafficAdvisoryLayer = L.layerGroup();
    trafficAdvisoryLayer.addTo(trafficLayer);
    communesLayerGroup = L.layerGroup();
    communesLabelsLayer = L.layerGroup();
    /*
     * v15.96 — pendant la phase prioritaire, initMap() ne dessine que le fond
     * de carte et prépare les groupes. Les couches métier sont relâchées après
     * recherche communes/alias puis affichage PÉLIC.
     */
    if (!npfStartupCorePriorityActive) {
        drawNpfRunwayMapLayer();
    }
    map.on('zoomend', () => scheduleNpfRunwayMapRefresh('zoomend'));
    map.on('moveend', () => { if (!isNpfGpsFollowProgrammaticPan()) scheduleNpfRunwayMapRefresh('moveend'); });

    applyPelicanVisualScale();
    map.on('zoomend', applyPelicanVisualScale);

    /* PÉLIC : après rendu complet de la fiche, la garder dans la zone visible. */
    map.on('popupopen', event => {
        scheduleNpfPelicPopupReposition(event?.popup);
    });

    if (!npfStartupCorePriorityActive) {
        drawPermanentAirportMarkers();
        drawFireHistoryMarkers();
        redrawGaarCircuits();
        scheduleStartupAuxiliaryLayers();
    }

    map.on('moveend zoomend', event => {
        const gpsFollowPan = event?.type === 'moveend' && isNpfGpsFollowProgrammaticPan();
        const zoomEnded = event?.type === 'zoomend';

        /*
         * v17.02 — la restitution VFR -> HT -> Routes est pilotée par le
         * séquenceur prioritaire. Ne pas lancer en parallèle l'ancien chemin.
         */
        if (isNpfMapOverlayPrioritySequenceActive()) return;
        const finalZoom = Number(map.getZoom?.());
        const startZoom = Number(npfHeavyOverlayZoomStartLevel);
        const combinedZoomOut = !!(
            zoomEnded
            && showRoadOverlayLayer
            && showHighVoltageLinesLayer
            && hasLoadedHighVoltageLines
            && isHighVoltageLayerEffectiveAtCurrentScale()
            && Number.isFinite(startZoom)
            && Number.isFinite(finalZoom)
            && finalZoom < startZoom - 0.01
        );

        if (combinedZoomOut) {
            /* v16.62 — ne plus exécuter une transaction à chaque zoomend
             * intermédiaire du pinch. Le même Promise est conservé et le timer
             * 360 ms est repoussé jusqu'au dernier niveau réellement atteint. */
            scheduleSerializedHeavyOverlayZoomOut(startZoom, finalZoom);
            return;
        }

        if (zoomEnded) {
            /* Si le geste a finalement été inversé/annulé avant le seuil de
             * zoom-out, invalider la transaction différée et rendre les panes. */
            if (npfHeavyOverlayZoomOutPromise) {
                cancelPendingSerializedHeavyOverlayZoomOut('zoomend-non-combine');
            }
            npfHeavyOverlayZoomStartLevel = null;
            /*
             * v16.83 — Routes seul ET HT seul sont désormais indépendants du
             * chargement du fond OFFLINE à zoomend.
             *
             * Les panes sont réaffichés immédiatement ; le moteur tuiles v16.75
             * continue son travail sans attente artificielle.
             *
             * La transaction sérialisée Routes+HT conserve, elle, son attente
             * spécifique gérée séparément.
             */
            setNpfHeavyOverlayPanesHidden(false);
        }

        if (showRoadOverlayLayer) {
            const roadTier = getRoadOverlayZoomTier();

            if (roadTier > 0) {
                if (roadOverlayLayer && !map.hasLayer(roadOverlayLayer)) {
                    roadOverlayLayer.addTo(map);
                }
                if (!gpsFollowPan || !isRoadOverlayCoverageValidForCurrentView()) {
                    scheduleRoadOverlayRefresh(gpsFollowPan ? 'gps-follow-edge' : 'map-change');
                }
            } else {
                /*
                 * v16.76 — tier 0 : Routes est un état mémorisé, pas un calque
                 * actif. Aucun scheduleRoadOverlayRefresh() n'est lancé sur
                 * moveend/zoomend. Le parent est retiré immédiatement et les
                 * anciennes géométries sont libérées progressivement.
                 */
                roadOverlayRefreshToken += 1;
                clearTimeout(roadOverlayRefreshTimer);
                roadOverlayRefreshTimer = null;
                try {
                    if (roadOverlayLayer && map.hasLayer(roadOverlayLayer)) {
                        map.removeLayer(roadOverlayLayer);
                    }
                } catch (_) {}

                roadOverlayLoadedZoomTier = 0;

                if (loadedRoadOverlayParts.size || roadOverlaySourceParts.size) {
                    const cleanupToken = npfHeavyOverlayZoomSerialToken;
                    clearRoadOverlayRenderedPartsProgressively(
                        { resetTier: false, clearSources: true },
                        cleanupToken
                    ).catch(error => {
                        console.warn('Nettoyage progressif Routes tier 0 impossible:', error);
                    });
                }
            }
        }
        if (showHighVoltageLinesLayer) {
            if (!isHighVoltageLayerEffectiveAtCurrentScale()) {
                suppressHighVoltageLinesForWideScale(zoomEnded ? 'zoomend' : 'moveend');
            } else if (!hasLoadedHighVoltageLines && !isHighVoltageLinesLoading) {
                highVoltageLinesScaleSuppressed = false;
                toggleHighVoltageLinesLayer(true, {
                    silent: true,
                    retry: true,
                    source: 'scale-enter'
                }).catch(() => {});
            } else if (hasLoadedHighVoltageLines) {
                highVoltageLinesScaleSuppressed = false;
                if (highVoltageLinesLayer && !map.hasLayer(highVoltageLinesLayer)) highVoltageLinesLayer.addTo(map);
                if (!gpsFollowPan || !isHighVoltageCoverageValidForCurrentView()) {
                    scheduleHighVoltageLinesRefresh(gpsFollowPan ? 'gps-follow-edge' : 'map-change');
                }
            }
            refreshHighVoltageLinesButtonState();
        }
    });

    map.on('click', handleGaarMapClick);

    map.on('contextmenu', async (e) => {
        if (isDrawingMode) return;
        if (!e || !e.latlng) return;
        if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent);

        /*
         * v15.49 — sur iPad, Leaflet émet normalement un contextmenu tactile
         * assez tôt. Pendant notre appui tactile temporisé, cet événement est
         * neutralisé : le feu n'est créé qu'après 1,2 s.
         */
        const touchState = window.__npfFireLongPressTouchState;
        if (touchState && (
            touchState.active
            || Date.now() < Number(touchState.suppressContextMenuUntil || 0)
        )) {
            return;
        }

        await executeMapLongPressAction(e.latlng);
    });

    installMapFireLongPressDelay();
}

function beginMapVisualRenderGuard(reason = 'map-start') {
    if (!map) return;

    trafficVisualMapSequenceToken += 1;
    clearTimeout(trafficVisualResumeTimer);
    trafficVisualResumeTimer = null;
    suspendTrafficVisualUpdates('map-interaction');

    /*
     * v17.02 — VFR/HT/Routes ont déjà été invalidés par
     * beginNpfMapOverlayPrioritySequence(). Ne pas incrémenter deux fois les
     * tokens/générations. La suspension visuelle du trafic reste inchangée.
     */
    if (!npfMapOverlayPriorityActive) {
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
    }
    if (isRoadOverlayLoading) {
        isRoadOverlayLoading = false;
        refreshRoadOverlayButtonState();
    }
}

function scheduleTrafficVisualResumeAfterMapInteraction(reason = 'map-end') {
    clearTimeout(trafficVisualResumeTimer);
    const token = ++trafficVisualMapSequenceToken;

    trafficVisualResumeTimer = setTimeout(() => {
        if (token !== trafficVisualMapSequenceToken) return;
        trafficVisualResumeTimer = null;
        resumeTrafficVisualUpdates('map-interaction', {
            redraw: true,
            reason
        });
    }, TRAFFIC_VISUAL_RESUME_AFTER_MAP_MS);
}

/*
 * v16.92 — diagnostic PASSIF du chargement des tuiles pendant un zoom.
 *
 * Important : ce code n'agit jamais sur la file, les priorités, les epochs,
 * la concurrence IndexedDB, Leaflet ou les couches annexes. Il se contente
 * d'observer l'état existant à intervalles espacés.
 */
let npfPassiveTileZoomDiagToken = 0;
let npfPassiveTileZoomStartZoom = NaN;
let npfPassiveTileZoomStartedAt = 0;
let npfPassiveTileZoomIdbSeqStart = 0;
let npfPassiveTileZoomLookupSeqStart = 0;

function beginNpfPassiveTileZoomDiagnostic() {
    npfPassiveTileZoomDiagToken += 1;
    npfPassiveTileZoomStartZoom = Number(map?.getZoom?.());
    npfPassiveTileZoomStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
    npfPassiveTileZoomIdbSeqStart = Number(directOfflineTileIdbDiagSeq || 0);
    npfPassiveTileZoomLookupSeqStart = Number(directOfflineTileLookupDiagSeq || 0);
}

function scheduleNpfPassiveTileZoomDiagnostic() {
    if (!map || !baseTileLayer) return;

    const token = npfPassiveTileZoomDiagToken;
    const fromZoom = Number(npfPassiveTileZoomStartZoom);
    const toZoom = Number(map.getZoom?.());
    const startedAt = Number(npfPassiveTileZoomStartedAt)
        || NPF_STARTUP_DIAGNOSTIC.now();
    const zoomEndedAt = NPF_STARTUP_DIAGNOSTIC.now();

    if (!Number.isFinite(fromZoom) || !Number.isFinite(toZoom)) return;

    const direction = toZoom > fromZoom
        ? 'IN'
        : (toZoom < fromZoom ? 'OUT' : 'STABLE');

    let firstVisibleMs = null;
    let maxQueued = Math.max(0, Number(directOfflineNpfReadQueue?.length || 0));
    let maxActive = Math.max(0, Number(directOfflineNpfActiveReads || 0));
    let maxLoaded = 0;
    let maxTotal = 0;

    const finish = (status, state, elapsedMs) => {
        if (token !== npfPassiveTileZoomDiagToken) return;

        const loaded = Math.max(0, Number(state?.loaded || 0));
        const total = Math.max(0, Number(state?.total || 0));
        const tileZoomReady = state?.tileZoomReady !== false;

        const idbEvents = getDirectOfflineTileIdbDiagEventsSince(
            npfPassiveTileZoomIdbSeqStart
        );
        const lookupEvents = getDirectOfflineTileLookupDiagEventsSince(
            npfPassiveTileZoomLookupSeqStart
        );
        const idbSummary = summarizeDirectOfflineTileIdbDiagEvents(idbEvents);
        const lookupSummary = summarizeDirectOfflineTileLookupDiagEvents(lookupEvents);

        npfDiagSiaInteraction(
            'TUILES ZOOM PASSIF',
            `direction=${direction} · z${fromZoom}->${toZoom} · état=${status} · première=${firstVisibleMs === null ? '—' : Math.round(firstVisibleMs) + 'ms'} · couverture=${status === 'complet' ? Math.round(elapsedMs) + 'ms' : '—'} · visibles=${loaded}/${total} · IDB=${idbSummary.count} moy=${idbSummary.avgMs}ms max=${idbSummary.maxMs}ms >=1s=${idbSummary.ge1000} · lookup=${lookupSummary.count} cache=${lookupSummary.cacheHits} max=${lookupSummary.maxMs}ms timeout=${lookupSummary.readTimeouts}`,
            {
                direction,
                fromZoom,
                toZoom,
                zoomGestureMs: Math.round(zoomEndedAt - startedAt),
                firstVisibleMs: firstVisibleMs === null ? -1 : Math.round(firstVisibleMs),
                coverageMs: status === 'complet' ? Math.round(elapsedMs) : -1,
                loaded,
                total,
                tileZoomReady: tileZoomReady ? 1 : 0,
                maxLoaded,
                maxTotal,
                maxQueued,
                maxActive,
                readsQueued: Math.max(0, Number(directOfflineNpfReadQueue?.length || 0)),
                readsActive: Math.max(0, Number(directOfflineNpfActiveReads || 0)),
                idbReads: idbSummary.count,
                idbFound: idbSummary.found,
                idbMiss: idbSummary.miss,
                idbErrors: idbSummary.errors,
                idbAvgMs: idbSummary.avgMs,
                idbMaxMs: idbSummary.maxMs,
                idbGe500: idbSummary.ge500,
                idbGe1000: idbSummary.ge1000,
                idbIndexGets: idbSummary.indexGets,
                idbIndexDirectHits: idbSummary.indexDirectHits,
                idbIndexCursorFallbacks: idbSummary.indexCursorFallbacks,
                idbIndexCursorMax: idbSummary.indexCursorMax,
                idbLegacyReads: idbSummary.legacyReads,
                tileLookups: lookupSummary.count,
                tileLookupCacheHits: lookupSummary.cacheHits,
                tileLookupIdb: lookupSummary.idbLookups,
                tileLookupAvgMs: lookupSummary.avgMs,
                tileLookupMaxMs: lookupSummary.maxMs,
                tileLookupDbAttempts: lookupSummary.dbAttempts,
                tileLookupUrlAttempts: lookupSummary.urlAttempts,
                tileLookupOpenMs: lookupSummary.openMs,
                tileLookupReadMs: lookupSummary.readMs,
                tileLookupTimeouts: lookupSummary.readTimeouts,
                tileLookupSlowest: lookupSummary.slowestCoords
            }
        );
    };

    const check = () => {
        if (token !== npfPassiveTileZoomDiagToken || !map || !baseTileLayer) return;

        const now = NPF_STARTUP_DIAGNOSTIC.now();
        const elapsedMs = Math.max(0, now - zoomEndedAt);
        const state = typeof getVisibleBaseTileLoadStateForSia === 'function'
            ? getVisibleBaseTileLoadStateForSia()
            : {
                total: getNpfRetainedBaseTileCount(),
                loaded: countVisibleLoadedBaseTiles(),
                tileZoomReady: true
            };

        const loaded = Math.max(0, Number(state?.loaded || 0));
        const total = Math.max(0, Number(state?.total || 0));
        maxLoaded = Math.max(maxLoaded, loaded);
        maxTotal = Math.max(maxTotal, total);
        maxQueued = Math.max(
            maxQueued,
            Math.max(0, Number(directOfflineNpfReadQueue?.length || 0))
        );
        maxActive = Math.max(
            maxActive,
            Math.max(0, Number(directOfflineNpfActiveReads || 0))
        );

        if (
            firstVisibleMs === null
            && state?.tileZoomReady !== false
            && loaded > 0
        ) {
            firstVisibleMs = elapsedMs;
        }

        if (
            state?.tileZoomReady !== false
            && total > 0
            && loaded >= total
        ) {
            finish('complet', state, elapsedMs);
            return;
        }

        if (elapsedMs >= 12000) {
            finish('timeout', state, elapsedMs);
            return;
        }

        setTimeout(check, 80);
    };

    setTimeout(check, 0);
}

function beginBaseMapZoomStabilityGuard(reason = 'zoomstart') {
    if (!map) return;

 // Annule les rafraîchissements post-geste qui ne correspondent plus à la vue courante.
    baseMapStabilityRefreshToken += 1;

    /*
     * v14.94 — la carte NPF utilise une file IndexedDB limitée. Pendant un
     * changement de zoom, les lectures encore en attente pour l'ancien niveau
     * ne doivent pas retarder les nouvelles tuiles. Les lectures déjà actives
     * sont rendues inoffensives par la génération existante.
     */
    if (
        offlineTilesMode
        && typeof isNpfOfflinePackSelection === 'function'
        && isNpfOfflinePackSelection()
    ) {
        /*
         * v17.00 — le nouveau viewport devient prioritaire dès le début du
         * geste. Les transactions actives ne sont annulées qu'au zoomend/moveend
         * si Leaflet ne retient plus réellement leur tuile.
         */
        try { markDirectOfflineNpfViewportPriority(reason); } catch (_) {}
        /*
         * v17.22 — protéger le niveau déjà peint pour un éventuel retour OUT,
         * sans réduire artificiellement le LRU principal. Le cache NPF conserve
         * donc sa limite historique de 160 entrées pendant le geste.
         */
        try { rememberCurrentNpfZoomLevelForFastReturn(`before-${reason}`); } catch (_) {}
    }
}


function countVisibleLoadedBaseTiles() {
    if (!map || !baseTileLayer) return 0;

    try {
        const container = baseTileLayer.getContainer?.();
        if (!container) return 0;

        const mapRect = map.getContainer().getBoundingClientRect();
        const tiles = container.querySelectorAll(
            'img.leaflet-tile.leaflet-tile-loaded'
        );

        let visibleLoaded = 0;

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

            visibleLoaded += 1;
        });

        return visibleLoaded;
    } catch (_) {
        return 0;
    }
}

async function waitForNpfVisibleBaseTilesReady(options = {}) {
    const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => false;
    const maxWaitMs = Number.isFinite(Number(options.maxWaitMs))
        ? Math.max(0, Number(options.maxWaitMs))
        : 7000;
    const pollMs = Number.isFinite(Number(options.pollMs))
        ? Math.max(40, Number(options.pollMs))
        : 80;

    if (
        !offlineTilesMode
        || typeof isNpfOfflinePackSelection !== 'function'
        || !isNpfOfflinePackSelection()
        || !map
        || !baseTileLayer
    ) {
        return true;
    }

    const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
    let stablePasses = 0;

    while (true) {
        if (isCancelled()) return false;

        const state = typeof getVisibleBaseTileLoadStateForSia === 'function'
            ? getVisibleBaseTileLoadStateForSia()
            : {
                total: getNpfRetainedBaseTileCount(),
                loaded: countVisibleLoadedBaseTiles(),
                tileZoomReady: true
            };

        const visibleReady = state.total > 0
            && state.loaded >= state.total
            && state.tileZoomReady;

        if (visibleReady) {
            stablePasses += 1;
            if (stablePasses >= 2) {
                await new Promise(resolve => {
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(() => resolve());
                    } else {
                        setTimeout(resolve, 0);
                    }
                });
                return !isCancelled();
            }
        } else {
            stablePasses = 0;
        }

        const now = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        if (now - startedAt >= maxWaitMs) {
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, pollMs));
    }
}

/*
 * v16.52 — fenêtre de priorité absolue aux tuiles lors de l'activation d'une
 * couche lourde. Une couche ne commence son travail que lorsque toutes les
 * tuiles visibles sont peintes ET que la file IndexedDB est au repos. Deux
 * frames supplémentaires sont laissées à Safari avant le traitement lourd.
 */
async function waitForNpfLayerActivationTileWindow(layerKey, options = {}) {
    const startedAt = NPF_STARTUP_DIAGNOSTIC.now();
    const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => false;
    const maxWaitMs = Number.isFinite(Number(options.maxWaitMs))
        ? Math.max(1000, Number(options.maxWaitMs))
        : 12000;
    let stablePasses = 0;
    let maxQueued = 0;
    let maxActive = 0;
    let blankPasses = 0;

    while (true) {
        if (isCancelled()) return false;

        const tileState = typeof getVisibleBaseTileLoadStateForSia === 'function'
            ? getVisibleBaseTileLoadStateForSia()
            : {
                total: getNpfRetainedBaseTileCount(),
                loaded: countVisibleLoadedBaseTiles(),
                tileZoomReady: true
            };
        const activeReads = Math.max(0, Number(directOfflineNpfActiveReads || 0));
        const queuedReads = Math.max(0, Number(directOfflineNpfReadQueue?.length || 0));
        maxQueued = Math.max(maxQueued, queuedReads);
        maxActive = Math.max(maxActive, activeReads);
        if (Number(tileState.loaded || 0) === 0) blankPasses += 1;

        const directNpfOffline = !!(
            offlineTilesMode
            && typeof isNpfOfflinePackSelection === 'function'
            && isNpfOfflinePackSelection()
        );
        const tilesReady = !directNpfOffline || (
            Number(tileState.total || 0) > 0
            && Number(tileState.loaded || 0) >= Number(tileState.total || 0)
            && tileState.tileZoomReady
            && activeReads === 0
            && queuedReads === 0
        );

        if (tilesReady) {
            stablePasses += 1;
            if (stablePasses >= 3) {
                for (let frame = 0; frame < 2; frame += 1) {
                    await new Promise(resolve => {
                        if (typeof requestAnimationFrame === 'function') {
                            requestAnimationFrame(() => resolve());
                        } else {
                            setTimeout(resolve, 0);
                        }
                    });
                    if (isCancelled()) return false;
                }
                npfDiagSiaInteraction(
                    'FILTRE CARTE',
                    `couche=${String(layerKey || 'inconnue')} · tuiles-prêtes`,
                    {
                        waitMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - startedAt),
                        maxQueued,
                        maxActive,
                        blankPasses,
                        tilesVisible: countVisibleLoadedBaseTiles(),
                        npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
                        npfReadsActive: Number(directOfflineNpfActiveReads || 0)
                    }
                );
                return true;
            }
        } else {
            stablePasses = 0;
        }

        if (NPF_STARTUP_DIAGNOSTIC.now() - startedAt >= maxWaitMs) {
            npfDiagSiaInteraction(
                'FILTRE CARTE',
                `couche=${String(layerKey || 'inconnue')} · attente-tuiles-timeout`,
                {
                    waitMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - startedAt),
                    maxQueued,
                    maxActive,
                    blankPasses,
                    tilesVisible: countVisibleLoadedBaseTiles(),
                    npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
                    npfReadsActive: Number(directOfflineNpfActiveReads || 0)
                }
            );
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, 80));
    }
}


/*
 * v17.08 — Routes/HT strictement opportunistes.
 *
 * Objectif opérationnel : Routes ON / HT ON ne doivent jamais retirer de
 * fluidité au fond NPF par rapport à Routes OFF / HT OFF.
 *
 * Une couche lourde n'est autorisée à commencer son travail que lorsque :
 * - toutes les tuiles visibles sont peintes ;
 * - la file IndexedDB NPF est vide ;
 * - aucune lecture NPF n'est active ;
 * - cet état reste calme pendant 320 ms supplémentaires.
 *
 * Tout nouveau geste invalide les tokens Routes/HT existants : l'attente se
 * termine alors sans aucun rendu lourd. Le fond de carte reste prioritaire.
 */
const NPF_HEAVY_OVERLAY_POST_TILE_QUIET_MS = 320;

async function waitForNpfHeavyOverlayTileWindow(layerKey, options = {}) {
    const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => false;
    const maxWaitMs = Number.isFinite(Number(options.maxWaitMs))
        ? Math.max(1000, Number(options.maxWaitMs))
        : 30000;

    const ready = await waitForNpfLayerActivationTileWindow(layerKey, {
        maxWaitMs,
        isCancelled
    });
    if (!ready || isCancelled()) return false;

    const directNpfOffline = !!(
        offlineTilesMode
        && typeof isNpfOfflinePackSelection === 'function'
        && isNpfOfflinePackSelection()
    );
    if (!directNpfOffline) return !isCancelled();

    const nowMs = () => (
        typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now()
    );
    const startedAt = nowMs();
    let stableSince = startedAt;

    while (true) {
        if (isCancelled()) return false;

        const tileState = typeof getVisibleBaseTileLoadStateForSia === 'function'
            ? getVisibleBaseTileLoadStateForSia()
            : {
                total: getNpfRetainedBaseTileCount(),
                loaded: countVisibleLoadedBaseTiles(),
                tileZoomReady: true
            };
        const activeReads = Math.max(0, Number(directOfflineNpfActiveReads || 0));
        const queuedReads = Math.max(0, Number(directOfflineNpfReadQueue?.length || 0));
        const tilesStillReady = (
            Number(tileState.total || 0) > 0
            && Number(tileState.loaded || 0) >= Number(tileState.total || 0)
            && tileState.tileZoomReady
            && activeReads === 0
            && queuedReads === 0
        );

        const now = nowMs();
        if (!tilesStillReady) {
            stableSince = now;
        } else if (now - stableSince >= NPF_HEAVY_OVERLAY_POST_TILE_QUIET_MS) {
            return !isCancelled();
        }

        if (now - startedAt >= maxWaitMs) return false;
        await new Promise(resolve => setTimeout(resolve, 70));
    }
}

let npfOfflineZoomCleanupToken = 0;
let npfZoomMemoryDiagTimer = null;

function releaseStaleOfflineTileResources(reason = 'zoomend') {
    if (!offlineTilesMode || !baseTileLayer) return;

    try { baseTileLayer._pruneTiles?.(); } catch (_) {}

    if (isNpfOfflinePackSelection()) {
        /*
         * Les blobs sont un cache d'appoint, pas les données Offline elles-mêmes.
         * Les réduire ne touche jamais IndexedDB ni les packs installés.
         */
        trimDirectOfflineTileBlobCache(128);
        while (directOfflineTileMissCache.size > 160) {
            const oldestKey = directOfflineTileMissCache.keys().next().value;
            directOfflineTileMissCache.delete(oldestKey);
        }
    }
}

function recordNpfZoomMemorySnapshot(reason = 'zoomend') {
    const snapshot = getNpfStartupDiagnosticOverlaySnapshot();
    npfDiagSiaInteraction(
        'MÉMOIRE CARTE',
        `raison=${reason} · zoom=${map?.getZoom?.() ?? '—'}`,
        {
            tilesLeaflet: snapshot.tilesRetained,
            tilesDom: snapshot.tilesDom,
            tilesVisible: snapshot.tilesVisible,
            readsActive: snapshot.npfReadsActive,
            readsQueued: snapshot.npfReadsQueued,
            blobCache: snapshot.tileBlobCache,
            routesSource: snapshot.routesSourceSegments,
            routesSegments: snapshot.routesRenderedSegments,
            htRendus: snapshot.htRenderedSegments,
            pistesLayers: snapshot.runwayLayers,
            siaLayers: snapshot.siaLayers
        }
    );
}

function scheduleNpfOfflineZoomCleanup(reason = 'zoomend') {
    const token = ++npfOfflineZoomCleanupToken;
    clearTimeout(npfZoomMemoryDiagTimer);

    setTimeout(() => {
        if (token !== npfOfflineZoomCleanupToken) return;
        releaseStaleOfflineTileResources(reason + '-120ms');
    }, 120);

    npfZoomMemoryDiagTimer = setTimeout(() => {
        if (token !== npfOfflineZoomCleanupToken) return;
        npfZoomMemoryDiagTimer = null;
        releaseStaleOfflineTileResources(reason + '-520ms');
        recordNpfZoomMemorySnapshot(reason);
    }, 520);
}

