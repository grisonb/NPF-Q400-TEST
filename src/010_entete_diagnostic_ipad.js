const NPF_SCRIPT_BUILD_VERSION = 'v17.31';


/*
 * Diagnostic TEST passif du démarrage.
 * Il ne modifie aucun ordre de chargement : il enregistre uniquement les temps
 * et les blocages de la boucle principale afin d'identifier une lenteur iPad.
 */
const NPF_STARTUP_DIAGNOSTIC = (() => {
    const now = () => (
        typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now()
    );
    const state = {
        marks: [],
        markIndex: Object.create(null),
        stalls: [],
        longTasks: [],
        siaInteractions: [],
        monitorStartedAt: now(),
        monitorStartedWallAt: Date.now(),
        monitorStoppedAt: null,
        eventLoopMonitorSupported: true,
        longTaskObserverSupported: false,
        mapMotionSummary: {
            gpsFollow: {
                count: 0, slow: 0, totalMs: 0, maxMs: 0, maxGapMs: 0, maxEvents: 0,
                gap100Count: 0, gap150Count: 0, gap250Count: 0
            },
            manual: {
                count: 0, slow: 0, totalMs: 0, maxMs: 0, maxGapMs: 0, maxEvents: 0,
                gap100Count: 0, gap150Count: 0, gap250Count: 0
            },
            other: {
                count: 0, slow: 0, totalMs: 0, maxMs: 0, maxGapMs: 0, maxEvents: 0,
                gap100Count: 0, gap150Count: 0, gap250Count: 0
            },
            zoom: { count: 0, slow: 0, totalMs: 0, maxMs: 0 }
        },
        gpsSummary: {
            positions: 0, lastPositionAt: 0, intervalCount: 0, intervalTotalMs: 0, maxIntervalMs: 0,
            accuracyCount: 0, accuracyTotalM: 0, maxAccuracyM: 0,
            recenterCount: 0, gpsFollowRecenterCount: 0, lastRecenterAt: 0,
            recenterIntervalCount: 0, recenterIntervalTotalMs: 0, maxRecenterIntervalMs: 0,
            maxCenterShiftM: 0
        },
        layerSummary: {
            siaRefreshCount: 0, siaSlowCount: 0, siaMaxMs: 0, siaMaxPointsMs: 0, siaMaxDecorMs: 0,
            htRenderCount: 0, htMaxRendered: 0,
            roadRenderCount: 0, roadMaxRendered: 0,
            filterActivationCount: 0, filterActivationMaxWaitMs: 0, filterLayerMaxMs: 0,
            tileQueueMax: 0, tileActiveMax: 0, tileBlankSnapshots: 0,
            tileAbortedMax: 0, tileQueuedDiscardedMax: 0, tileRetriesMax: 0
        },
        restoredSession: null,
        persistCount: 0,
        persistMaxMs: 0,
        persistTotalMs: 0
    };

    const DIAG_PERSIST_KEY = 'npfDiagSessionV3';
    const DIAG_PERSIST_INTERVAL_MS = 30000;
    const DIAG_PERSIST_MAX_AGE_MS = 6 * 60 * 60 * 1000;

    try {
        const previous = JSON.parse(localStorage.getItem(DIAG_PERSIST_KEY) || 'null');
        if (
            previous
            && previous.build === NPF_SCRIPT_BUILD_VERSION
            && Number(previous.savedAt) >= Date.now() - DIAG_PERSIST_MAX_AGE_MS
        ) {
            state.restoredSession = previous;
        }
    } catch (_) {}

    const refreshOpenPanel = () => {
        try {
            const panel = document.getElementById('npf-startup-diag-panel');
            if (panel && !panel.hidden && typeof window.renderNpfStartupDiagnosticPanel === 'function') {
                window.renderNpfStartupDiagnosticPanel();
            }
        } catch (_) {}
    };

    const mark = (key, label, detail = '') => {
        const safeKey = String(key || '').trim();
        if (!safeKey || state.markIndex[safeKey] !== undefined) {
            return safeKey ? state.marks[state.markIndex[safeKey]] || null : null;
        }
        const entry = {
            key: safeKey,
            label: String(label || safeKey),
            detail: detail == null ? '' : String(detail),
            t: now()
        };
        state.markIndex[safeKey] = state.marks.length;
        state.marks.push(entry);
        refreshOpenPanel();
        return entry;
    };

    const has = key => state.markIndex[String(key || '')] !== undefined;

    const updateLayerSummary = (kind, detail, metrics) => {
        const safeMetrics = metrics && typeof metrics === 'object' ? metrics : {};
        const summary = state.layerSummary;

        if (Number.isFinite(Number(safeMetrics.npfReadsQueued))) {
            summary.tileQueueMax = Math.max(summary.tileQueueMax, Number(safeMetrics.npfReadsQueued));
        }
        if (Number.isFinite(Number(safeMetrics.npfReadsActive))) {
            summary.tileActiveMax = Math.max(summary.tileActiveMax, Number(safeMetrics.npfReadsActive));
        }
        if (Number.isFinite(Number(safeMetrics.npfReadsAborted))) {
            summary.tileAbortedMax = Math.max(summary.tileAbortedMax, Number(safeMetrics.npfReadsAborted));
        }
        if (Number.isFinite(Number(safeMetrics.npfQueuedDiscarded))) {
            summary.tileQueuedDiscardedMax = Math.max(Number(summary.tileQueuedDiscardedMax || 0), Number(safeMetrics.npfQueuedDiscarded));
        }
        if (Number.isFinite(Number(safeMetrics.npfTileRetries))) {
            summary.tileRetriesMax = Math.max(summary.tileRetriesMax, Number(safeMetrics.npfTileRetries));
        }
        if (Number.isFinite(Number(safeMetrics.tilesVisible)) && Number(safeMetrics.tilesVisible) === 0) {
            summary.tileBlankSnapshots += 1;
        }

        if (kind === 'SIA RAFRAÎCHISSEMENT') {
            const totalMs = Math.max(0, Number(safeMetrics.totalMs) || 0);
            summary.siaRefreshCount += 1;
            if (totalMs >= 120) summary.siaSlowCount += 1;
            summary.siaMaxMs = Math.max(summary.siaMaxMs, totalMs);
            summary.siaMaxPointsMs = Math.max(summary.siaMaxPointsMs, Math.max(0, Number(safeMetrics.pointsMs) || 0));
            summary.siaMaxDecorMs = Math.max(summary.siaMaxDecorMs, Math.max(0, Number(safeMetrics.touchDecorMs) || Number(safeMetrics.decorationsMs) || 0));
        }

        if (kind === 'FILTRE CARTE') {
            summary.filterActivationCount += 1;
            summary.filterActivationMaxWaitMs = Math.max(
                summary.filterActivationMaxWaitMs,
                Math.max(0, Number(safeMetrics.waitMs) || 0)
            );
            summary.filterLayerMaxMs = Math.max(
                summary.filterLayerMaxMs,
                Math.max(0, Number(safeMetrics.layerMs) || 0)
            );
        }

        if (kind === 'Couches carte') {
            const safeDetail = String(detail || '');
            if (safeDetail.includes('lignes-ht rendu')) {
                summary.htRenderCount += 1;
                summary.htMaxRendered = Math.max(summary.htMaxRendered, Math.max(0, Number(safeMetrics.htRenderedSegments) || 0));
            }
            if (safeDetail.includes('routes viewport')) {
                summary.roadRenderCount += 1;
                summary.roadMaxRendered = Math.max(summary.roadMaxRendered, Math.max(0, Number(safeMetrics.routesRenderedSegments) || 0));
            }
        }
    };

    const shouldRetainInteraction = (kind, detail, metrics) => {
        const safeMetrics = metrics && typeof metrics === 'object' ? metrics : {};
        if (kind === 'SIA RAFRAÎCHISSEMENT') {
            const totalMs = Math.max(0, Number(safeMetrics.totalMs) || 0);
            const safeDetail = String(detail || '');
            return totalMs >= 120
                || safeDetail.includes('profile-show-map-zones')
                || safeDetail.includes('profile-hide-map-zones')
                || safeDetail.includes('startup');
        }
        if (kind === 'FILTRE CARTE') return true;
        if (kind === 'Couches carte') {
            const safeDetail = String(detail || '');
            return safeDetail.includes('tile-priority-retry')
                || safeDetail.includes(' ON')
                || safeDetail.includes(' OFF')
                || Number(safeMetrics.tilesVisible) === 0
                || Number(safeMetrics.npfReadsQueued) >= 12;
        }
        return true;
    };

    const addSiaInteraction = (kind, detail = '', metrics = null) => {
        const safeKind = String(kind || 'SIA');
        const safeDetail = detail == null ? '' : String(detail);
        const safeMetrics = metrics && typeof metrics === 'object' ? { ...metrics } : null;
        updateLayerSummary(safeKind, safeDetail, safeMetrics);

        if (!shouldRetainInteraction(safeKind, safeDetail, safeMetrics)) {
            return null;
        }

        const entry = {
            t: now(),
            at: Date.now(),
            kind: safeKind,
            detail: safeDetail,
            metrics: safeMetrics
        };
        state.siaInteractions.push(entry);
        if (state.siaInteractions.length > 100) {
            state.siaInteractions.splice(0, state.siaInteractions.length - 100);
        }
        refreshOpenPanel();
        return entry;
    };

    const recordMapMotion = (source, metrics = null) => {
        const safeMetrics = metrics && typeof metrics === 'object' ? metrics : {};
        const safeSource = source === 'gps-follow' ? 'gpsFollow' : (source === 'manual' ? 'manual' : 'other');
        const bucket = state.mapMotionSummary[safeSource];
        const durationMs = Math.max(0, Number(safeMetrics.dureeMs) || 0);
        const avgGapMs = Math.max(0, Number(safeMetrics.gapMoyMs) || 0);
        const maxGapMs = Math.max(0, Number(safeMetrics.gapMaxMs) || 0);
        const moveEvents = Math.max(0, Number(safeMetrics.moveEvents) || 0);
        const gap100Count = Math.max(0, Number(safeMetrics.gaps100) || 0);
        const gap150Count = Math.max(0, Number(safeMetrics.gaps150) || 0);
        const gap250Count = Math.max(0, Number(safeMetrics.gaps250) || 0);

        /*
         * v16.89 — la durée du geste n'est plus assimilée à une lenteur.
         * Un pan de 2,3 s à 18 ms entre frames est fluide. On retient une
         * saccade lorsqu'un vrai trou temporel >=100 ms est observé.
         */
        const slow = maxGapMs >= 100 || gap100Count > 0;

        bucket.count += 1;
        bucket.totalMs += durationMs;
        bucket.maxMs = Math.max(bucket.maxMs, durationMs);
        bucket.maxGapMs = Math.max(bucket.maxGapMs, maxGapMs);
        bucket.maxEvents = Math.max(bucket.maxEvents, moveEvents);
        bucket.gap100Count = Number(bucket.gap100Count || 0) + gap100Count;
        bucket.gap150Count = Number(bucket.gap150Count || 0) + gap150Count;
        bucket.gap250Count = Number(bucket.gap250Count || 0) + gap250Count;
        if (slow) bucket.slow += 1;

        if (slow) {
            return addSiaInteraction(
                'PAN CARTE SACCADÉ',
                `source=${source || 'autre'}`,
                { ...safeMetrics }
            );
        }
        refreshOpenPanel();
        return null;
    };

    const recordZoom = (metrics = null) => {
        const safeMetrics = metrics && typeof metrics === 'object' ? metrics : {};
        const durationMs = Math.max(0, Number(safeMetrics.dureeMs) || 0);
        const bucket = state.mapMotionSummary.zoom;
        bucket.count += 1;
        bucket.totalMs += durationMs;
        bucket.maxMs = Math.max(bucket.maxMs, durationMs);
        if (durationMs >= 120) {
            bucket.slow += 1;
            return addSiaInteraction('ZOOM CARTE LENT', '', { ...safeMetrics });
        }
        refreshOpenPanel();
        return null;
    };

    const recordGpsPosition = (coords, timestampMs = Date.now()) => {
        const summary = state.gpsSummary;
        const at = Number(timestampMs) || Date.now();
        summary.positions += 1;
        if (summary.lastPositionAt > 0 && at > summary.lastPositionAt) {
            const delta = at - summary.lastPositionAt;
            summary.intervalCount += 1;
            summary.intervalTotalMs += delta;
            summary.maxIntervalMs = Math.max(summary.maxIntervalMs, delta);
        }
        summary.lastPositionAt = at;

        const accuracy = Number(coords?.accuracy);
        if (Number.isFinite(accuracy) && accuracy >= 0) {
            summary.accuracyCount += 1;
            summary.accuracyTotalM += accuracy;
            summary.maxAccuracyM = Math.max(summary.maxAccuracyM, accuracy);
        }
    };

    const recordGpsRecenter = (reason = '', centerShiftM = 0) => {
        const summary = state.gpsSummary;
        const at = Date.now();
        summary.recenterCount += 1;
        if (String(reason || '') === 'gps-update') summary.gpsFollowRecenterCount += 1;
        if (summary.lastRecenterAt > 0 && at > summary.lastRecenterAt) {
            const delta = at - summary.lastRecenterAt;
            summary.recenterIntervalCount += 1;
            summary.recenterIntervalTotalMs += delta;
            summary.maxRecenterIntervalMs = Math.max(summary.maxRecenterIntervalMs, delta);
        }
        summary.lastRecenterAt = at;
        const shift = Math.max(0, Number(centerShiftM) || 0);
        summary.maxCenterShiftM = Math.max(summary.maxCenterShiftM, shift);
    };

    const buildPersistedSnapshot = () => ({
        build: NPF_SCRIPT_BUILD_VERSION,
        savedAt: Date.now(),
        sessionStartedAt: state.monitorStartedWallAt,
        mapMotionSummary: state.mapMotionSummary,
        gpsSummary: state.gpsSummary,
        layerSummary: state.layerSummary,
        interactions: state.siaInteractions.slice(-80),
        stalls: state.stalls.slice(0, 20),
        longTasks: state.longTasks.slice(0, 20)
    });

    const persist = () => {
        const started = now();
        try {
            localStorage.setItem(DIAG_PERSIST_KEY, JSON.stringify(buildPersistedSnapshot()));
            state.persistCount += 1;
            const duration = Math.max(0, now() - started);
            state.persistTotalMs += duration;
            state.persistMaxMs = Math.max(state.persistMaxMs, duration);
        } catch (_) {}
    };

    mark('script_eval', 'Script NPF exécuté');

    try {
        setInterval(persist, DIAG_PERSIST_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') persist();
        }, { passive: true });
        window.addEventListener('pagehide', persist, { passive: true });
    } catch (_) {}

    /* Mesure indépendante des API LongTask, absentes de certaines versions Safari. */
    try {
        /*
         * Surveillance pendant toute la session, mais à 1 Hz seulement : charge
         * négligeable en vol et conservation des plus gros blocages, même après
         * plusieurs heures d'utilisation.
         */
        const intervalMs = 1000;
        let expected = now() + intervalMs;
        let wasVisible = document.visibilityState !== 'hidden';

        document.addEventListener('visibilitychange', () => {
            wasVisible = document.visibilityState !== 'hidden';
            expected = now() + intervalMs;
        }, { passive: true });

        setInterval(() => {
            const current = now();

            /*
             * v16.53 — une suspension iPadOS / passage en arrière-plan n'est
             * pas un blocage JavaScript. On réarme simplement la référence
             * temporelle au retour au premier plan.
             */
            if (!wasVisible || document.visibilityState === 'hidden') {
                expected = current + intervalMs;
                return;
            }

            const drift = Math.max(0, current - expected);
            if (drift >= 120) {
                state.stalls.push({ t: current, at: Date.now(), delay: drift });
                state.stalls.sort((a, b) => b.delay - a.delay);
                if (state.stalls.length > 20) state.stalls.length = 20;
                refreshOpenPanel();
            }
            expected = current + intervalMs;
        }, intervalMs);
    } catch (_) {
        state.eventLoopMonitorSupported = false;
    }

    try {
        if (typeof PerformanceObserver === 'function') {
            const supported = Array.isArray(PerformanceObserver.supportedEntryTypes)
                && PerformanceObserver.supportedEntryTypes.includes('longtask');
            if (supported) {
                state.longTaskObserverSupported = true;
                const observer = new PerformanceObserver(list => {
                    list.getEntries().forEach(entry => {
                        state.longTasks.push({
                            t: Number(entry.startTime) || 0,
                            duration: Number(entry.duration) || 0
                        });
                    });
                    state.longTasks.sort((a, b) => b.duration - a.duration);
                    if (state.longTasks.length > 20) state.longTasks.length = 20;
                    refreshOpenPanel();
                });
                observer.observe({ entryTypes: ['longtask'] });
            }
        }
    } catch (_) {}

    return {
        state, mark, has, now, addSiaInteraction,
        recordMapMotion, recordZoom, recordGpsPosition, recordGpsRecenter,
        persist
    };
})();

window.NPF_STARTUP_DIAGNOSTIC = NPF_STARTUP_DIAGNOSTIC;
function npfStartupDiagMark(key, label, detail = '') {
    return NPF_STARTUP_DIAGNOSTIC.mark(key, label, detail);
}
function npfStartupDiagHasMark(key) {
    return NPF_STARTUP_DIAGNOSTIC.has(key);
}
function npfDiagSiaInteraction(kind, detail = '', metrics = null) {
    return NPF_STARTUP_DIAGNOSTIC.addSiaInteraction(kind, detail, metrics);
}
function npfDiagMapMotion(source, metrics = null) {
    return NPF_STARTUP_DIAGNOSTIC.recordMapMotion(source, metrics);
}
function npfDiagZoom(metrics = null) {
    return NPF_STARTUP_DIAGNOSTIC.recordZoom(metrics);
}
function npfDiagGpsPosition(coords, timestampMs = Date.now()) {
    return NPF_STARTUP_DIAGNOSTIC.recordGpsPosition(coords, timestampMs);
}
function npfDiagGpsRecenter(reason = '', centerShiftM = 0) {
    return NPF_STARTUP_DIAGNOSTIC.recordGpsRecenter(reason, centerShiftM);
}
function npfDiagPersist() {
    try { return NPF_STARTUP_DIAGNOSTIC.persist(); } catch (_) { return null; }
}

function escapeNpfStartupDiagnosticHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getNpfRoadSourceFeatureCount() {
    let count = 0;
    try {
        roadOverlaySourceParts?.forEach?.(record => {
            count += Number(record?.featureCount || record?.geojson?.features?.length || 0);
        });
    } catch (_) {}
    return count;
}

function getNpfRenderedRoadFeatureCount() {
    let count = 0;
    try {
        loadedRoadOverlayParts?.forEach?.(record => {
            count += Number(record?.geojson?.features?.length || 0);
        });
    } catch (_) {}
    return count;
}

function getNpfRetainedBaseTileCount() {
    try {
        return Number(Object.keys(baseTileLayer?._tiles || {}).length || 0);
    } catch (_) {
        return 0;
    }
}

function getNpfBaseTileDomCount() {
    try {
        return Number(baseTileLayer?.getContainer?.()?.querySelectorAll?.('.leaflet-tile')?.length || 0);
    } catch (_) {
        return 0;
    }
}

function getNpfStartupDiagnosticOverlaySnapshot() {
    let roadOverlayInstalledParts = 0;
    try {
        roadOverlayInstalledParts = Number(getRoadOverlayManifest?.()?.parts?.length || 0);
    } catch (_) {}

    return {
        routes: showRoadOverlayLayer ? 'ON' : 'OFF',
        routesInstalledParts: roadOverlayInstalledParts,
        routesRenderedLines: Number(roadOverlayLineLayer?.getLayers?.().length || 0),
        routesSourceSegments: getNpfRoadSourceFeatureCount(),
        routesRenderedSegments: getNpfRenderedRoadFeatureCount(),
        routesRenderedLabels: Number(roadOverlayLabelsLayer?.getLayers?.().length || 0),
        ht: showHighVoltageLinesLayer ? 'ON' : 'OFF',
        htLoaded: hasLoadedHighVoltageLines ? 'OUI' : 'NON',
        htSegments: Number(highVoltageLinesFeatureCount || 0),
        htRenderedSegments: Number(highVoltageLinesRenderedFeatureCount || 0),
        htRenderedGroups: Number(highVoltageLinesRenderedGeoJsonLayer?.getLayers?.().length || 0),
        tilesRetained: getNpfRetainedBaseTileCount(),
        tilesDom: getNpfBaseTileDomCount(),
        tilesVisible: typeof countVisibleLoadedBaseTiles === 'function' ? countVisibleLoadedBaseTiles() : 0,
        npfReadsActive: Number(directOfflineNpfActiveReads || 0),
        npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
        npfReadsAborted: Number(directOfflineNpfAbortedReadCount || 0),
        npfQueuedDiscarded: Number(directOfflineNpfQueuedDiscardCount || 0),
        npfTileRetries: Number(directOfflineNpfTileRetryCount || 0),
        npfViewEpoch: Number(directOfflineTileViewPriorityEpoch || 0),
        tileBlobCache: Number(directOfflineTileBlobCache?.size || 0),
        tileMainRamHits: Number(directOfflineNpfMainRamHitCount || 0),
        tileZoomReturnCache: Number(directOfflineNpfZoomReturnBlobCache?.size || 0),
        tileZoomReturnHits: Number(directOfflineNpfZoomReturnCacheHitCount || 0),
        tileIndexedDbLookups: Number(directOfflineNpfIndexedDbLookupCount || 0),
        gpsTileRepairChecks: Number(npfGpsTileRepairCheckCount || 0),
        gpsTileRepairTriggers: Number(npfGpsTileRepairTriggeredCount || 0),
        gpsTileRepairRecovered: Number(npfGpsTileRepairRecoveredCount || 0),
        gpsTileRepairFallbackRedraws: Number(npfGpsTileRepairFallbackRedrawCount || 0),
        leafletLayers: (() => {
            try { return Number(Object.keys(map?._layers || {}).length || 0); }
            catch (_) { return 0; }
        })(),
        runwayLayers: Number(npfRunwayMapLayer?.getLayers?.().length || 0),
        siaLayers: Number(siaLayerGroup?.getLayers?.().length || 0),
        siaZones: Number(siaRenderedDiagnosticCounts?.zones || 0),
        siaTerrains: Number(siaRenderedDiagnosticCounts?.terrains || 0),
        siaVrp: Number(siaRenderedDiagnosticCounts?.vrp || 0),
        siaOtherPoints: Number(siaRenderedDiagnosticCounts?.otherPoints || 0),
        siaDecorations: Number(siaRenderedDiagnosticCounts?.decorations || 0),
        siaTouchEntries: Number(siaRenderedDiagnosticCounts?.touchEntries || 0),
        departmentsLoaded: hasLoadedDepartments ? 'OUI' : 'NON',
        departmentsVisible: areDepartmentsVisible ? 'OUI' : 'NON'
    };
}

function recordNpfStartupDiagnosticOverlaySnapshot(detail = '') {
    const snapshot = getNpfStartupDiagnosticOverlaySnapshot();
    return npfDiagSiaInteraction('Couches carte', detail || 'état', snapshot);
}

/*
 * v16.89 — corrélation passive d'une vraie saccade de pan.
 * Le timer de surveillance JS travaille à 1 Hz : on attend 1150 ms après le
 * moveend afin de lui laisser le temps d'enregistrer un éventuel retard.
 * Aucun traitement de carte n'est déclenché par ce diagnostic.
 */
function scheduleNpfPanJankCorrelation(sample, endedAt, endSnapshot) {
    if (!sample || !Number.isFinite(Number(sample.startedAt))) return;

    const startedAt = Number(sample.startedAt);
    const finishedAt = Number(endedAt);
    const startSnapshot = sample.startSnapshot || {};
    const finalSnapshot = endSnapshot || getNpfStartupDiagnosticOverlaySnapshot();

    setTimeout(() => {
        try {
            const state = NPF_STARTUP_DIAGNOSTIC.state;
            const overlap = (aStart, aEnd, bStart, bEnd) =>
                Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);

            /*
             * Le timestamp du stall est celui du réveil du timer.
             * Son début estimé est donc t - delay. Cela permet de savoir si
             * l'intervalle bloqué recoupe réellement le geste.
             */
            const stalls = (Array.isArray(state?.stalls) ? state.stalls : [])
                .filter(item => {
                    const stallEnd = Number(item?.t) || 0;
                    const delay = Math.max(0, Number(item?.delay) || 0);
                    const stallStart = Math.max(0, stallEnd - delay);
                    return overlap(startedAt, finishedAt, stallStart, stallEnd);
                });
            const jsStallMaxMs = stalls.reduce(
                (maxValue, item) => Math.max(maxValue, Number(item?.delay) || 0),
                0
            );

            const classifyInteraction = item => {
                const kind = String(item?.kind || '').toUpperCase();
                const detail = String(item?.detail || '').toUpperCase();
                if (kind.includes('ROUTES') || detail.includes('ROUTES')) return 'Routes';
                if (
                    kind.includes('HT')
                    || detail.includes('LIGNES-HT')
                    || detail.includes('COUCHE=HT')
                ) return 'HT';
                if (kind.includes('SIA')) return 'SIA';
                if (
                    kind.includes('TUILE')
                    || kind.includes('MÉMOIRE CARTE')
                    || detail.includes('TUILE')
                ) return 'Tuiles';
                return 'Autre';
            };

            const getInteractionDuration = item => {
                const metrics = item?.metrics && typeof item.metrics === 'object'
                    ? item.metrics
                    : {};
                return Math.max(
                    0,
                    Number(metrics.totalMs) || 0,
                    Number(metrics.dureeMs) || 0,
                    Number(metrics.waitMs) || 0,
                    Number(metrics.layerMs) || 0,
                    Number(metrics.pointsMs) || 0,
                    Number(metrics.bandMs) || 0,
                    Number(metrics.labelMs) || 0,
                    Number(metrics.datasetMs) || 0,
                    Number(metrics.scanMs) || 0,
                    Number(metrics.geoJsonMs) || 0,
                    Number(metrics.commitMs) || 0
                );
            };

            const componentStats = {
                Routes: { count: 0, maxMs: 0 },
                HT: { count: 0, maxMs: 0 },
                SIA: { count: 0, maxMs: 0 },
                Tuiles: { count: 0, maxMs: 0 },
                Autre: { count: 0, maxMs: 0 }
            };

            const overlappingEvents = (
                Array.isArray(state?.siaInteractions)
                    ? state.siaInteractions
                    : []
            )
                .filter(item => !String(item?.kind || '').startsWith('PAN '))
                .filter(item => {
                    const eventEnd = Number(item?.t) || 0;
                    const duration = getInteractionDuration(item);
                    const eventStart = Math.max(0, eventEnd - duration);
                    return duration > 0
                        ? overlap(startedAt, finishedAt, eventStart, eventEnd)
                        : eventEnd >= startedAt && eventEnd <= finishedAt;
                });

            overlappingEvents.forEach(item => {
                const category = classifyInteraction(item);
                const stats = componentStats[category] || componentStats.Autre;
                const duration = getInteractionDuration(item);
                stats.count += 1;
                stats.maxMs = Math.max(stats.maxMs, duration);
            });

            const gpsPositionsEnd = Number(state?.gpsSummary?.positions || 0);
            const gpsPositionsDelta = Math.max(
                0,
                gpsPositionsEnd - Number(sample.gpsPositionsStart || 0)
            );

            const delta = key =>
                Number(finalSnapshot?.[key] || 0)
                    - Number(startSnapshot?.[key] || 0);

            const activityText = [
                `JS=${stalls.length ? Math.round(jsStallMaxMs) + 'ms' : '0'}`,
                `tuiles=q${Math.round(Number(sample.maxReadsQueued || 0))}/a${Math.round(Number(sample.maxReadsActive || 0))}`,
                `SIA=${componentStats.SIA.count}/${Math.round(componentStats.SIA.maxMs)}ms`,
                `Routes=${componentStats.Routes.count}/${Math.round(componentStats.Routes.maxMs)}ms`,
                `HT=${componentStats.HT.count}/${Math.round(componentStats.HT.maxMs)}ms`,
                `GPS=${gpsPositionsDelta}`,
                `Leaflet=${Number(startSnapshot.leafletLayers || 0)}→${Number(finalSnapshot.leafletLayers || 0)}`
            ].join(' · ');

            npfDiagSiaInteraction(
                'PAN DIAGNOSTIC',
                `source=${sample.source || 'autre'} · ${activityText}`,
                {
                    gesteMs: Math.round(finishedAt - startedAt),
                    moveEvents: Number(sample.events || 0),
                    gapMoyMs: Math.round(
                        Number(sample.events || 0) > 0
                            ? Number(sample.gapTotal || 0) / Number(sample.events || 1)
                            : 0
                    ),
                    gapMaxMs: Math.round(Number(sample.maxGap || 0)),
                    gaps100: Number(sample.gaps100 || 0),
                    gaps150: Number(sample.gaps150 || 0),
                    gaps250: Number(sample.gaps250 || 0),
                    jsStalls: stalls.length,
                    jsStallMaxMs: Math.round(jsStallMaxMs),
                    tileQueueMax: Number(sample.maxReadsQueued || 0),
                    tileActiveMax: Number(sample.maxReadsActive || 0),
                    tileQueuedDiscardedDelta: delta('npfQueuedDiscarded'),
                    tileAbortedDelta: delta('npfReadsAborted'),
                    tileRetriesDelta: delta('npfTileRetries'),
                    tilesVisibleStart: Number(startSnapshot.tilesVisible || 0),
                    tilesVisibleEnd: Number(finalSnapshot.tilesVisible || 0),
                    routesSourceDelta: delta('routesSourceSegments'),
                    routesRenderedDelta: delta('routesRenderedSegments'),
                    htRenderedDelta: delta('htRenderedSegments'),
                    siaLayersDelta: delta('siaLayers'),
                    gpsPositionsDelta,
                    leafletLayersStart: Number(startSnapshot.leafletLayers || 0),
                    leafletLayersEnd: Number(finalSnapshot.leafletLayers || 0),
                    siaEvents: componentStats.SIA.count,
                    siaEventMaxMs: Math.round(componentStats.SIA.maxMs),
                    routeEvents: componentStats.Routes.count,
                    routeEventMaxMs: Math.round(componentStats.Routes.maxMs),
                    htEvents: componentStats.HT.count,
                    htEventMaxMs: Math.round(componentStats.HT.maxMs),
                    tileEvents: componentStats.Tuiles.count,
                    tileEventMaxMs: Math.round(componentStats.Tuiles.maxMs)
                }
            );
        } catch (error) {
            console.warn('[NPF DIAG] Corrélation pan impossible:', error);
        }
    }, 1150);
}

function getNpfStartupDiagnosticRuntimeInfo() {
    let source = '—';
    let pack = '';
    let zoom = '—';
    try {
        source = offlineTilesMode ? 'OFFLINE' : 'ONLINE';
        if (offlineTilesMode && Array.isArray(activeOfflinePacks) && activeOfflinePacks.length) {
            pack = activeOfflinePacks.join(', ');
        }
    } catch (_) {}
    try {
        if (map && typeof map.getZoom === 'function') zoom = String(map.getZoom());
    } catch (_) {}

    const layers = getNpfStartupDiagnosticOverlaySnapshot();

    return {
        source,
        pack,
        zoom,
        directHits: typeof directOfflineTileHitCount === 'number' ? directOfflineTileHitCount : null,
        directMisses: typeof directOfflineTileMissCount === 'number' ? directOfflineTileMissCount : null,
        roadOverlaySelected: layers.routes,
        roadOverlayInstalledParts: layers.routesInstalledParts,
        roadOverlayRenderedLines: layers.routesRenderedLines,
        roadOverlaySourceSegments: layers.routesSourceSegments,
        roadOverlayRenderedSegments: layers.routesRenderedSegments,
        roadOverlayRenderedLabels: layers.routesRenderedLabels,
        highVoltageSelected: layers.ht,
        highVoltageLoaded: layers.htLoaded,
        highVoltageFeatureCount: layers.htSegments,
        highVoltageRenderedFeatureCount: layers.htRenderedSegments,
        highVoltageRenderedGroupCount: layers.htRenderedGroups,
        retainedTileCount: layers.tilesRetained,
        tileDomCount: layers.tilesDom,
        visibleTileCount: layers.tilesVisible,
        npfReadsActive: layers.npfReadsActive,
        npfReadsQueued: layers.npfReadsQueued,
        npfReadsAborted: layers.npfReadsAborted,
        npfQueuedDiscarded: layers.npfQueuedDiscarded,
        npfTileRetries: layers.npfTileRetries,
        npfViewEpoch: layers.npfViewEpoch,
        tileBlobCacheSize: layers.tileBlobCache,
        tileMainRamHits: layers.tileMainRamHits,
        tileZoomReturnCacheSize: layers.tileZoomReturnCache,
        tileZoomReturnCacheHits: layers.tileZoomReturnHits,
        tileIndexedDbLookups: layers.tileIndexedDbLookups,
        gpsTileRepairChecks: layers.gpsTileRepairChecks,
        gpsTileRepairTriggers: layers.gpsTileRepairTriggers,
        gpsTileRepairRecovered: layers.gpsTileRepairRecovered,
        gpsTileRepairFallbackRedraws: layers.gpsTileRepairFallbackRedraws,
        leafletLayerCount: layers.leafletLayers,
        runwayLayerCount: layers.runwayLayers,
        siaLayerCount: layers.siaLayers,
        siaZoneCount: layers.siaZones,
        siaTerrainCount: layers.siaTerrains,
        siaVrpCount: layers.siaVrp,
        siaOtherPointCount: layers.siaOtherPoints,
        siaDecorationLayerCount: layers.siaDecorations,
        siaTouchEntryCount: layers.siaTouchEntries,
        lastLocalitySearchDiagnostic: npfLastLocalitySearchDiagnostic,
        vacInstalledCount: Number(vacInstalledOaciSet?.size || 0),
        vacAvailableCount: Math.max(0, Number(localStorage.getItem(VAC_EXPECTED_COUNT_KEY)) || 0),
        vacManifestAirportCount: Math.max(0, Number(localStorage.getItem(VAC_REMOTE_AIRPORT_COUNT_KEY)) || 0),
        vacManifestUnavailableCount: Math.max(0, Number(localStorage.getItem(VAC_REMOTE_UNAVAILABLE_COUNT_KEY)) || 0),
        vacDisplayedAirportCount: typeof getNpfDisplayedAirportOaciCountForVac === 'function'
            ? getNpfDisplayedAirportOaciCountForVac()
            : 0,
        airportFrequencyFallbackCount: airportFrequencyFallbackIndex instanceof Map
            ? airportFrequencyFallbackIndex.size
            : 0,
        airportServiceSupplementCount: SIA_OFFICIAL_AIRPORT_SERVICE_ROWS.length,
        airportServiceOfficialOaciCount: buildSiaOfficialAirportOperationalIndex().size,
        airportServiceTwrCount: countSiaOfficialAirportType('TWR'),
        airportServiceAfisCount: countSiaOfficialAirportType('AFIS'),
        airportServiceAirToAirCount: countSiaOfficialAirportType('A/A'),
        airportServiceAirac: String(SIA_OFFICIAL_AIRPORT_RADIO_META?.airac || '—'),
        airportServiceEffectiveDate: String(SIA_OFFICIAL_AIRPORT_RADIO_META?.effectiveDate || '—'),
        airportFrequencyAdditionalCount: Array.isArray(additionalAerodromes)
            ? additionalAerodromes.reduce((count, airport) => count + (getAirportOperationalFrequency(airport?.oaci) ? 1 : 0), 0)
            : 0,
        airportFrequencyAdditionalTotal: Array.isArray(additionalAerodromes) ? additionalAerodromes.length : 0,
        communeCount: Array.isArray(allCommunes) ? allCommunes.length : 0,
        communeAliasCount: Array.isArray(communeAliases) ? communeAliases.length : 0,
        communeAliasSource: String(communeAliasesLoadSource || '—'),
        localityTotalCount: Math.max(0, Number(namedPlacesOfflineIndex?.total_count) || 0),
        localityLoadedCount: Math.max(0, Number(namedPlacesOfflineLoadedCount) || 0),
        localityLinkedCount: Math.max(0, Number(namedPlacesOfflineLinkedCount) || 0),
        localityOrphanCount: Math.max(0, Number(namedPlacesOfflineOrphanCount) || 0),
        localityCachedShards: Number(namedPlacesOfflineShardCache?.size || 0),
        localityLoadError: String(namedPlacesOfflineLoadError || ''),
        bfgPaired: (() => { try { return Boolean(getStoredNpfBfgBridgeCredentials()); } catch (_) { return false; } })(),
        briefingSessionActive: (() => { try { return Boolean(getStoredBriefingDocsSession()); } catch (_) { return false; } })(),
        bfgBridgeLastStatus: String(typeof npfBfgBridgeLastStatus !== 'undefined' ? npfBfgBridgeLastStatus : '—'),
        bfgBridgeLastError: String(typeof npfBfgBridgeLastError !== 'undefined' ? npfBfgBridgeLastError : ''),
        glrSessionActive: (() => { try { return Boolean(getStoredGlobalLinkSession()); } catch (_) { return false; } })(),
        glrLastAuthState: String(typeof npfGlobalLinkLastAuthState !== 'undefined' ? npfGlobalLinkLastAuthState : '—'),
        glrLastAction: String(typeof npfGlobalLinkLastAction !== 'undefined' ? npfGlobalLinkLastAction : '—'),
        glrLastHttpStatus: Number(typeof npfGlobalLinkLastHttpStatus !== 'undefined' ? npfGlobalLinkLastHttpStatus : 0),
        glrLastError: String(typeof npfGlobalLinkLastError !== 'undefined' ? npfGlobalLinkLastError : ''),
        diagMapMotion: NPF_STARTUP_DIAGNOSTIC.state.mapMotionSummary,
        diagGps: NPF_STARTUP_DIAGNOSTIC.state.gpsSummary,
        diagLayers: NPF_STARTUP_DIAGNOSTIC.state.layerSummary,
        diagPersistCount: Number(NPF_STARTUP_DIAGNOSTIC.state.persistCount || 0),
        diagPersistMaxMs: Number(NPF_STARTUP_DIAGNOSTIC.state.persistMaxMs || 0),
        diagPersistTotalMs: Number(NPF_STARTUP_DIAGNOSTIC.state.persistTotalMs || 0),
        diagRestoredSession: NPF_STARTUP_DIAGNOSTIC.state.restoredSession || null
    };
}

function buildNpfStartupDiagnosticExportText() {
    const diag = NPF_STARTUP_DIAGNOSTIC.state;
    const runtime = getNpfStartupDiagnosticRuntimeInfo();
    const marks = diag.marks.slice().sort((a, b) => a.t - b.t);
    let previous = 0;
    const lines = [];
    const generatedAt = new Date();

    lines.push('NPF-Q400 — Diagnostic démarrage');
    lines.push('Date : ' + generatedAt.toLocaleString('fr-FR'));
    lines.push('Build : ' + String(window.NPF_SCRIPT_BUILD_VERSION || NPF_SCRIPT_BUILD_VERSION || '—'));
    lines.push('Carte : ' + runtime.source + ' | Zoom : ' + runtime.zoom);
    if (runtime.pack) lines.push('Packs : ' + runtime.pack);
    if (runtime.directHits !== null) {
        lines.push('Tuiles IDB : ' + runtime.directHits + ' trouvées / ' + runtime.directMisses + ' absentes');
    }
    lines.push('Couches : Routes ' + runtime.roadOverlaySelected + ' | Lignes HT ' + runtime.highVoltageSelected);
    lines.push(
        'Détail couches : '
        + runtime.roadOverlayInstalledParts + ' parties routes installées | '
        + runtime.roadOverlayRenderedLines + ' groupes routes / '
        + runtime.roadOverlaySourceSegments + ' segments source chargés / '
        + runtime.roadOverlayRenderedSegments + ' segments rendus / '
        + runtime.roadOverlayRenderedLabels + ' cartouches | '
        + 'HT chargées ' + runtime.highVoltageLoaded + ' | '
        + runtime.highVoltageFeatureCount + ' tronçons HT connus | '
        + runtime.highVoltageRenderedFeatureCount + ' tronçons HT rendus / '
        + runtime.highVoltageRenderedGroupCount + ' groupes HT'
    );
    lines.push(
        'Mémoire carte : '
        + runtime.retainedTileCount + ' tuiles Leaflet | '
        + runtime.tileDomCount + ' tuiles DOM | '
        + runtime.visibleTileCount + ' visibles | '
        + runtime.npfReadsActive + ' lectures actives / '
        + runtime.npfReadsQueued + ' en file | '
        + runtime.npfQueuedDiscarded + ' demandes en file abandonnées | '
        + runtime.npfReadsAborted + ' lectures devenues obsolètes / '
        + runtime.npfTileRetries + ' reprises | '
        + runtime.tileBlobCacheSize + ' blobs cache | '
        + runtime.tileMainRamHits + ' hits RAM principal | '
        + runtime.tileZoomReturnCacheSize + ' cache retour zoom / '
        + runtime.tileZoomReturnCacheHits + ' hits retour | '
        + runtime.tileIndexedDbLookups + ' accès IDB | '
        + 'réparation GPS ' + runtime.gpsTileRepairChecks + ' contrôles / '
        + runtime.gpsTileRepairTriggers + ' déclenchements / '
        + runtime.gpsTileRepairRecovered + ' tuiles récupérées / '
        + runtime.gpsTileRepairFallbackRedraws + ' redraw secours | '
        + runtime.leafletLayerCount + ' calques Leaflet totaux | '
        + runtime.runwayLayerCount + ' couches pistes | '
        + runtime.siaLayerCount + ' couches SIA'
    );
    lines.push(
        'Détail SIA rendu : '
        + 'zones ' + runtime.siaZoneCount
        + ' | terrains ' + runtime.siaTerrainCount
        + ' | VRP ' + runtime.siaVrpCount
        + ' | autres points ' + runtime.siaOtherPointCount
        + ' | décorations ' + runtime.siaDecorationLayerCount
        + ' | entrées tactiles zones ' + runtime.siaTouchEntryCount
    );
    lines.push(
        'VAC : '
        + runtime.vacInstalledCount + ' téléchargées / '
        + runtime.vacAvailableCount + ' disponibles dans le dépôt | '
        + runtime.vacManifestAirportCount + ' terrains dans le manifest / '
        + runtime.vacDisplayedAirportCount + ' aérodromes OACI affichés dans NPF'
        + (runtime.vacManifestUnavailableCount
            ? ' | ' + runtime.vacManifestUnavailableCount + ' sans VAC publiée'
            : '')
    );
    lines.push(
        'Fréquences terrains : '
        + runtime.airportFrequencyAdditionalCount + '/' + runtime.airportFrequencyAdditionalTotal
        + ' aérodromes complémentaires renseignés | '
        + runtime.airportFrequencyFallbackCount + ' fréquences de secours | '
        + 'SIA AIRAC ' + runtime.airportServiceAirac + ' (' + runtime.airportServiceEffectiveDate + ') | '
        + runtime.airportServiceOfficialOaciCount + ' terrains radio | '
        + runtime.airportServiceSupplementCount + ' lignes officielles | '
        + 'TWR=' + runtime.airportServiceTwrCount
        + ' | AFIS=' + runtime.airportServiceAfisCount
        + ' | A/A=' + runtime.airportServiceAirToAirCount
    );
    lines.push(
        'Recherche France : '
        + runtime.communeCount + ' communes | '
        + runtime.communeAliasCount + ' alias (' + runtime.communeAliasSource + ') | '
        + (runtime.localityTotalCount
            ? runtime.localityTotalCount + ' localités indexées'
            : 'base localités non ouverte')
        + (runtime.localityLoadedCount ? ' | ' + runtime.localityLoadedCount + ' localités chargées' : '')
        + (runtime.localityLoadedCount ? ' | rattachées ' + runtime.localityLinkedCount + ' / sans commune ' + runtime.localityOrphanCount : '')
        + (runtime.localityLoadError ? ' | erreur=' + runtime.localityLoadError : '')
    );

    if (runtime.lastLocalitySearchDiagnostic) {
        const searchDiag = runtime.lastLocalitySearchDiagnostic;
        lines.push(
            'Dernière recherche localités : '
            + String(searchDiag.stage || '—')
            + ' | ' + String(searchDiag.detail || '—')
            + (searchDiag.top ? ' | résultats=' + String(searchDiag.top) : '')
        );
    }

    const motion = runtime.diagMapMotion || {};
    const gpsDiag = runtime.diagGps || {};
    const layerDiag = runtime.diagLayers || {};
    const fmtAvg = (total, count) => count > 0 ? Math.round(total / count) : 0;
    lines.push(
        'Suivi GPS : '
        + (gpsDiag.positions || 0) + ' positions | '
        + (gpsDiag.gpsFollowRecenterCount || 0) + ' recentrages auto | '
        + 'intervalle GPS moy ' + fmtAvg(gpsDiag.intervalTotalMs || 0, gpsDiag.intervalCount || 0) + ' ms / max ' + Math.round(gpsDiag.maxIntervalMs || 0) + ' ms | '
        + 'précision moy ' + fmtAvg(gpsDiag.accuracyTotalM || 0, gpsDiag.accuracyCount || 0) + ' m / max ' + Math.round(gpsDiag.maxAccuracyM || 0) + ' m | '
        + 'déplacement centre max ' + Math.round(gpsDiag.maxCenterShiftM || 0) + ' m'
    );
    const fmtMotionBucket = bucket => {
        const safeBucket = bucket || {};
        return (safeBucket.count || 0)
            + ' (' + (safeBucket.slow || 0) + ' saccadés'
            + ', >100=' + (safeBucket.gap100Count || 0)
            + ', >150=' + (safeBucket.gap150Count || 0)
            + ', >250=' + (safeBucket.gap250Count || 0)
            + ', gap max ' + Math.round(safeBucket.maxGapMs || 0) + ' ms)';
    };
    lines.push(
        'Mouvements carte : GPS auto '
        + fmtMotionBucket(motion.gpsFollow)
        + ' | manuels ' + fmtMotionBucket(motion.manual)
        + ' | autres ' + fmtMotionBucket(motion.other)
        + ' | zooms ' + (motion.zoom?.count || 0)
        + ' (' + (motion.zoom?.slow || 0) + ' lents)'
    );
    lines.push(
        'Synthèse performance : '
        + 'file tuiles max ' + Math.round(layerDiag.tileQueueMax || 0) + ' | '
        + 'lectures actives max ' + Math.round(layerDiag.tileActiveMax || 0) + ' | '
        + 'snapshots écran sans tuile ' + Math.round(layerDiag.tileBlankSnapshots || 0) + ' | '
        + 'file abandonnée max ' + Math.round(layerDiag.tileQueuedDiscardedMax || 0) + ' / lectures obsolètes max ' + Math.round(layerDiag.tileAbortedMax || 0) + ' / reprises max ' + Math.round(layerDiag.tileRetriesMax || 0) + ' | '
        + 'SIA ' + Math.round(layerDiag.siaRefreshCount || 0) + ' refresh (' + Math.round(layerDiag.siaSlowCount || 0) + ' lents, max ' + Math.round(layerDiag.siaMaxMs || 0) + ' ms) | '
        + 'HT ' + Math.round(layerDiag.htRenderCount || 0) + ' rendus | Routes ' + Math.round(layerDiag.roadRenderCount || 0) + ' rendus | '
        + 'filtres ' + Math.round(layerDiag.filterActivationCount || 0)
        + ' événements (attente tuiles max ' + Math.round(layerDiag.filterActivationMaxWaitMs || 0)
        + ' ms / couche max ' + Math.round(layerDiag.filterLayerMaxMs || 0) + ' ms)'
    );
    lines.push(
        'Charge DIAG : '
        + Math.round(runtime.diagPersistCount || 0) + ' écritures groupées | '
        + 'écriture max ' + Math.round(runtime.diagPersistMaxMs || 0) + ' ms | '
        + 'temps total ' + Math.round(runtime.diagPersistTotalMs || 0) + ' ms'
    );
    lines.push(
        'Authentification : BFG↔NPF associé ' + (runtime.bfgPaired ? 'OUI' : 'NON')
        + ' | session FdS/GAAR ' + (runtime.briefingSessionActive ? 'ACTIVE' : 'ABSENTE/EXPIRÉE')
        + ' | pont BFG ' + (runtime.bfgBridgeLastStatus || '—')
        + (runtime.bfgBridgeLastError ? ' (' + runtime.bfgBridgeLastError + ')' : '')
        + ' | session GLR ' + (runtime.glrSessionActive ? 'ACTIVE' : 'ABSENTE/EXPIRÉE')
        + ' | état GLR ' + (runtime.glrLastAuthState || '—')
        + ' | action ' + (runtime.glrLastAction || '—')
        + (runtime.glrLastHttpStatus ? ' HTTP ' + runtime.glrLastHttpStatus : '')
        + (runtime.glrLastError ? ' (' + runtime.glrLastError + ')' : '')
    );
    const restoredDiag = runtime.diagRestoredSession;
    if (restoredDiag) {
        lines.push(
            'DIAG restauré après rechargement : sauvegarde '
            + new Date(Number(restoredDiag.savedAt) || Date.now()).toLocaleTimeString('fr-FR')
            + ' | session début '
            + new Date(Number(restoredDiag.sessionStartedAt) || Date.now()).toLocaleTimeString('fr-FR')
            + ' | ' + Number(restoredDiag?.interactions?.length || 0) + ' événements conservés'
        );
    }
    lines.push('');
    lines.push('ÉTAPES');
    lines.push('Étape | Depuis ouverture | Delta | Détail');

    marks.forEach(entry => {
        const delta = Math.max(0, entry.t - previous);
        previous = entry.t;
        lines.push([
            entry.label,
            (entry.t / 1000).toFixed(2) + ' s',
            (delta / 1000).toFixed(2) + ' s',
            entry.detail || ''
        ].join(' | '));
    });

    const siaInteractions = Array.isArray(diag.siaInteractions) ? diag.siaInteractions.slice() : [];
    lines.push('');
    lines.push('ÉVÉNEMENTS LENTS / CHANGEMENTS DE COUCHES');
    if (!siaInteractions.length) {
        lines.push('Aucun événement lent ou changement de couche retenu.');
    } else {
        siaInteractions.forEach(item => {
            const metrics = item.metrics && typeof item.metrics === 'object'
                ? Object.entries(item.metrics)
                    .map(([key, value]) => `${key}=${value}`)
                    .join(' | ')
                : '';
            const eventClock = Number(item.at)
                ? new Date(Number(item.at)).toLocaleTimeString('fr-FR')
                : '—';
            lines.push(
                eventClock + ' | + ' + (item.t / 1000).toFixed(2) + ' s | '
                + item.kind
                + (item.detail ? ' | ' + item.detail : '')
                + (metrics ? ' | ' + metrics : '')
            );
        });
    }

    const restoredSession = runtime.diagRestoredSession;
    if (restoredSession) {
        lines.push('');
        lines.push('SESSION DIAG RESTAURÉE AVANT RECHARGEMENT');
        lines.push(
            'Début : ' + new Date(Number(restoredSession.sessionStartedAt) || Date.now()).toLocaleString('fr-FR')
            + ' | sauvegarde : ' + new Date(Number(restoredSession.savedAt) || Date.now()).toLocaleString('fr-FR')
        );
        const restoredInteractions = Array.isArray(restoredSession.interactions)
            ? restoredSession.interactions.slice(-80)
            : [];
        if (!restoredInteractions.length) {
            lines.push('Aucun événement détaillé conservé avant le rechargement.');
        } else {
            restoredInteractions.forEach(item => {
                const metrics = item?.metrics && typeof item.metrics === 'object'
                    ? Object.entries(item.metrics).map(([key, value]) => `${key}=${value}`).join(' | ')
                    : '';
                const eventClock = Number(item?.at)
                    ? new Date(Number(item.at)).toLocaleTimeString('fr-FR')
                    : '—';
                lines.push(
                    eventClock + ' | ' + String(item?.kind || 'événement')
                    + (item?.detail ? ' | ' + item.detail : '')
                    + (metrics ? ' | ' + metrics : '')
                );
            });
        }
        const restoredStalls = Array.isArray(restoredSession.stalls)
            ? restoredSession.stalls.slice(0, 20)
            : [];
        if (restoredStalls.length) {
            lines.push('Blocages JS restaurés :');
            restoredStalls.forEach(item => {
                const eventClock = Number(item?.at)
                    ? new Date(Number(item.at)).toLocaleTimeString('fr-FR')
                    : '—';
                lines.push(eventClock + ' | ≈ ' + Math.round(Number(item?.delay) || 0) + ' ms');
            });
        }
    }

    /* v16.36 — événements de mise à jour PWA conservés brièvement entre deux rechargements. */
    try {
        const swDiagKey = window.NPF_SW_UPDATE_DIAG_STORAGE_KEY || 'npfSwUpdateDiagV1';
        const swEvents = JSON.parse(sessionStorage.getItem(swDiagKey) || '[]');
        const recentSwEvents = Array.isArray(swEvents)
            ? swEvents.filter(item => item && Number(item.at) >= Date.now() - 15 * 60 * 1000)
            : [];
        lines.push('');
        lines.push('MISE À JOUR PWA');
        if (!recentSwEvents.length) {
            lines.push('Aucun événement de mise à jour récent.');
        } else {
            recentSwEvents.forEach(item => {
                const time = new Date(Number(item.at) || Date.now()).toLocaleTimeString('fr-FR');
                lines.push(`${time} | ${item.stage || 'événement'}${item.detail ? ' | ' + item.detail : ''}`);
            });
        }
    } catch (_) {}

    const stalls = diag.stalls.slice().sort((a, b) => b.delay - a.delay);
    lines.push('');
    lines.push('BLOCAGES JAVASCRIPT');
    if (stalls.length) {
        lines.push('Nombre : ' + stalls.length + ' | Maximum : ' + Math.round(stalls[0].delay) + ' ms');
        stalls.forEach(item => {
            lines.push('+ ' + (item.t / 1000).toFixed(2) + ' s : ≈ ' + Math.round(item.delay) + ' ms');
        });
    } else {
        lines.push('Aucun blocage > 120 ms détecté.');
    }

    const longTasks = diag.longTasks.slice().sort((a, b) => b.duration - a.duration);
    lines.push('');
    lines.push('LONGTASK API');
    if (!diag.longTaskObserverSupported) {
        lines.push('Indisponible sur ce Safari — mesure par retard de boucle utilisée.');
    } else if (!longTasks.length) {
        lines.push('Aucune LongTask détectée.');
    } else {
        lines.push('Nombre : ' + longTasks.length);
        longTasks.forEach(item => {
            lines.push('+ ' + (item.t / 1000).toFixed(2) + ' s : ' + Math.round(item.duration) + ' ms');
        });
    }

    lines.push('');
    lines.push('Mesures enregistrées automatiquement depuis l’ouverture de NPF.');
    return lines.join('\n');
}

async function exportNpfStartupDiagnostic() {
    try { npfDiagPersist(); } catch (_) {}
    const text = buildNpfStartupDiagnosticExportText();
    const date = new Date();
    const pad = n => String(n).padStart(2, '0');
    const filename = `NPF_DIAG_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}.txt`;
    const title = 'NPF-Q400 — Diagnostic démarrage';

    try {
        if (typeof File === 'function' && navigator.share) {
            const file = new File([text], filename, { type: 'text/plain;charset=utf-8' });
            const shareData = { title, text: 'Diagnostic de démarrage NPF-Q400 en pièce jointe.', files: [file] };
            if (!navigator.canShare || navigator.canShare({ files: [file] })) {
                await navigator.share(shareData);
                return;
            }
        }
        if (navigator.share) {
            await navigator.share({ title, text });
            return;
        }
    } catch (error) {
        if (error && error.name === 'AbortError') return;
        console.warn('[NPF DIAG] Partage direct indisponible :', error);
    }

    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            alert('Diagnostic copié. Tu peux le coller directement dans un mail.');
            return;
        }
    } catch (_) {}

    try {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        alert('Le diagnostic a été exporté en fichier texte.');
    } catch (_) {
        alert('Export impossible sur cet appareil.');
    }
}
window.exportNpfStartupDiagnostic = exportNpfStartupDiagnostic;

function renderNpfStartupDiagnosticPanel() {
    const panel = document.getElementById('npf-startup-diag-panel');
    const body = document.getElementById('npf-startup-diag-body');
    if (!panel || !body) return;

    const diag = NPF_STARTUP_DIAGNOSTIC.state;
    const runtime = getNpfStartupDiagnosticRuntimeInfo();
    const marks = diag.marks.slice().sort((a, b) => a.t - b.t);
    let previous = 0;
    const timedMarks = marks.map(entry => {
        const delta = Math.max(0, entry.t - previous);
        previous = entry.t;
        return { ...entry, delta };
    });

    const coreReady = timedMarks.find(entry => entry.key === 'core_ready');
    const coreReadyTime = coreReady ? coreReady.t : Infinity;
    const page = panel.dataset.diagPage === '2' ? 2 : 1;
    const pageMarks = page === 1
        ? timedMarks.filter(entry => entry.t <= coreReadyTime)
        : timedMarks.filter(entry => entry.t > coreReadyTime);

    const rows = pageMarks.map(entry => `<tr>
            <td>${escapeNpfStartupDiagnosticHtml(entry.label)}</td>
            <td>${(entry.t / 1000).toFixed(2)} s</td>
            <td>${(entry.delta / 1000).toFixed(2)} s</td>
            <td>${escapeNpfStartupDiagnosticHtml(entry.detail)}</td>
        </tr>`).join('');

    const stalls = diag.stalls.slice().sort((a, b) => b.delay - a.delay);
    const maxStall = stalls.length ? stalls[0].delay : 0;
    const stallRows = stalls.slice(0, 8).map(item => (
        `<li>+${(item.t / 1000).toFixed(2)} s : ≈ ${Math.round(item.delay)} ms</li>`
    )).join('');

    const longTasks = diag.longTasks.slice().sort((a, b) => b.duration - a.duration);
    const longTaskRows = longTasks.slice(0, 5).map(item => (
        `<li>+${(item.t / 1000).toFixed(2)} s : ${Math.round(item.duration)} ms</li>`
    )).join('');

    const offlineCounters = runtime.directHits === null
        ? ''
        : `<span>Tuiles IDB : <b>${runtime.directHits}</b> trouvées / <b>${runtime.directMisses}</b> absentes</span>`;

    const table = `<table class="npf-startup-diag-table">
        <thead><tr><th>Étape</th><th>Depuis ouv.</th><th>Δ</th><th>Détail</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">Aucune mesure sur cette page.</td></tr>'}</tbody>
    </table>`;

    if (page === 1) {
        body.innerHTML = `
            <div class="npf-startup-diag-page-title">1/2 — CARTE ET DÉMARRAGE PRINCIPAL</div>
            <div class="npf-startup-diag-meta npf-startup-diag-meta-compact">
                <span>Carte : <b>${escapeNpfStartupDiagnosticHtml(runtime.source)}</b></span>
                <span>Zoom : <b>${escapeNpfStartupDiagnosticHtml(runtime.zoom)}</b></span>
                ${offlineCounters}
                ${runtime.pack ? `<span class="npf-startup-diag-pack">Packs : <b>${escapeNpfStartupDiagnosticHtml(runtime.pack)}</b></span>` : ''}
            </div>
            ${table}
            <div class="npf-startup-diag-shot-hint">Capture 1/2 · puis touche « 2/2 Suite ».</div>`;
    } else {
        body.innerHTML = `
            <div class="npf-startup-diag-page-title">2/2 — COUCHES ANNEXES ET BLOCAGES</div>
            <div class="npf-startup-diag-meta npf-startup-diag-meta-compact">
                <span>Routes : <b>${escapeNpfStartupDiagnosticHtml(runtime.roadOverlaySelected)}</b></span>
                <span>Routes installées : <b>${runtime.roadOverlayInstalledParts}</b></span>
                <span>Routes : <b>${runtime.roadOverlayRenderedSegments}</b> segments / <b>${runtime.roadOverlayRenderedLabels}</b> labels</span>
                <span>Lignes HT : <b>${escapeNpfStartupDiagnosticHtml(runtime.highVoltageSelected)}</b></span>
                <span>HT chargées : <b>${escapeNpfStartupDiagnosticHtml(runtime.highVoltageLoaded)}</b></span>
                <span>Tronçons HT : <b>${runtime.highVoltageFeatureCount}</b></span>
                <span>HT rendues : <b>${runtime.highVoltageRenderedFeatureCount}</b></span>
                <span>Tuiles : <b>${runtime.retainedTileCount}</b> Leaflet / <b>${runtime.tileDomCount}</b> DOM</span>
                <span>Lectures NPF : <b>${runtime.npfReadsActive}</b> actives / <b>${runtime.npfReadsQueued}</b> file</span>
                <span>NPF interrompues/reprises : <b>${runtime.npfReadsAborted}</b> / <b>${runtime.npfTileRetries}</b></span>
                <span>Priorité viewport : <b>${runtime.npfViewEpoch}</b></span>
                <span>Cache tuiles : <b>${runtime.tileBlobCacheSize}</b></span>
                <span>Réparation GPS : <b>${runtime.gpsTileRepairChecks}</b> contrôles / <b>${runtime.gpsTileRepairTriggers}</b> déclenchements / <b>${runtime.gpsTileRepairRecovered}</b> récupérées</span>
                <span>GPS auto : <b>${runtime.diagMapMotion?.gpsFollow?.count || 0}</b> pans / <b>${runtime.diagMapMotion?.gpsFollow?.slow || 0}</b> lents</span>
                <span>File tuiles max : <b>${runtime.diagLayers?.tileQueueMax || 0}</b></span>
                <span>SIA : <b>${runtime.diagLayers?.siaRefreshCount || 0}</b> refresh / max <b>${Math.round(runtime.diagLayers?.siaMaxMs || 0)} ms</b></span>
                <span>Recherche : <b>${runtime.communeCount}</b> communes / <b>${runtime.communeAliasCount}</b> alias (${escapeNpfStartupDiagnosticHtml(runtime.communeAliasSource)})</span>
            </div>
            <div class="npf-startup-diag-page2-grid">
                <div class="npf-startup-diag-page2-table">${table}</div>
                <div class="npf-startup-diag-stalls">
                    <div><b>Blocages JS : ${diag.stalls.length}</b>${diag.stalls.length ? ` · max ≈ ${Math.round(maxStall)} ms` : ''}</div>
                    ${stallRows ? `<ul>${stallRows}</ul>` : '<div>Aucun blocage &gt; 120 ms.</div>'}
                    ${diag.longTaskObserverSupported
                        ? `<div class="npf-startup-diag-longtasks"><b>LongTask API : ${longTasks.length}</b>${longTaskRows ? `<ul>${longTaskRows}</ul>` : ''}</div>`
                        : '<div class="npf-startup-diag-longtasks">LongTask API Safari indisponible : mesure par retard de boucle.</div>'}
                    <div class="npf-startup-diag-longtasks"><b>SIA / carte : ${Array.isArray(diag.siaInteractions) ? diag.siaInteractions.length : 0}</b>${
                        Array.isArray(diag.siaInteractions) && diag.siaInteractions.length
                            ? `<ul>${diag.siaInteractions.slice(-6).map(item => `<li>${escapeNpfStartupDiagnosticHtml(item.kind)}${item.detail ? ' · ' + escapeNpfStartupDiagnosticHtml(item.detail) : ''}</li>`).join('')}</ul>`
                            : '<div>Aucune interaction enregistrée.</div>'
                    }</div>
                    <div class="npf-startup-diag-monitor">Mesure automatique dès l’ouverture, même panneau fermé.</div>
                </div>
            </div>
            <div class="npf-startup-diag-shot-hint">Capture 2/2 · ces deux captures contiennent tout le diagnostic affiché.</div>`;
    }

    panel.querySelectorAll('.npf-startup-diag-page-button').forEach(button => {
        const buttonPage = Number(button.dataset.diagPage || 1);
        button.classList.toggle('active', buttonPage === page);
        button.setAttribute('aria-pressed', buttonPage === page ? 'true' : 'false');
    });
}
window.renderNpfStartupDiagnosticPanel = renderNpfStartupDiagnosticPanel;

function ensureNpfStartupDiagnosticUi() {
    const button = document.getElementById('npf-startup-diag-button');
    if (!button || button.dataset.bound === '1') return;
    button.dataset.bound = '1';

    let panel = document.getElementById('npf-startup-diag-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'npf-startup-diag-panel';
        panel.className = 'npf-startup-diag-panel';
        panel.hidden = true;
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = `
            <div class="npf-startup-diag-card">
                <div class="npf-startup-diag-header">
                    <strong>Diagnostic démarrage</strong>
                    <div class="npf-startup-diag-page-nav" aria-label="Pages du diagnostic">
                        <button type="button" class="npf-startup-diag-page-button active" data-diag-page="1" aria-pressed="true">1/2 Démarrage</button>
                        <button type="button" class="npf-startup-diag-page-button" data-diag-page="2" aria-pressed="false">2/2 Suite</button>
                    </div>
                    <button type="button" id="npf-startup-diag-export" aria-label="Exporter le diagnostic">Exporter</button>
                    <button type="button" id="npf-startup-diag-close" aria-label="Fermer">×</button>
                </div>
                <div id="npf-startup-diag-body" class="npf-startup-diag-body"></div>
            </div>`;
        document.body.appendChild(panel);
    }

    const close = () => {
        panel.hidden = true;
        panel.setAttribute('aria-hidden', 'true');
    };
    const open = () => {
        panel.dataset.diagPage = '1';
        renderNpfStartupDiagnosticPanel();
        panel.hidden = false;
        panel.setAttribute('aria-hidden', 'false');
    };

    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        open();
    });
    panel.querySelector('#npf-startup-diag-close')?.addEventListener('click', close);
    panel.querySelector('#npf-startup-diag-export')?.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        await exportNpfStartupDiagnostic();
    });
    panel.querySelectorAll('.npf-startup-diag-page-button').forEach(pageButton => {
        pageButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            panel.dataset.diagPage = String(pageButton.dataset.diagPage || '1');
            renderNpfStartupDiagnosticPanel();
        });
    });
    panel.addEventListener('click', event => {
        if (event.target === panel) close();
    });

    positionNpfStartupDiagButtonNextToScale();
}

function positionNpfStartupDiagButtonNextToScale() {
    const button = document.getElementById('npf-startup-diag-button');
    const scale = document.getElementById('npf-nautical-scale-fixed');
    if (!button) return;

    if (!scale) {
        button.style.removeProperty('--npf-diag-left');
        return;
    }

    try {
        const rect = scale.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const buttonWidth = button.offsetWidth || 64;
        const gap = 10;
        let left = Math.round(rect.right + gap);
        if (viewportWidth > 0) left = Math.min(left, Math.max(8, viewportWidth - buttonWidth - 8));
        button.style.setProperty('--npf-diag-left', `${left}px`);
    } catch (_) {}
}
window.positionNpfStartupDiagButtonNextToScale = positionNpfStartupDiagButtonNextToScale;

/*
 * v15.96 — séquence de démarrage prioritaire :
 * 1) carte / premières tuiles ; 2) recherche communes + alias ; 3) PÉLIC.
 * Les couches et services non indispensables sont relâchés seulement après.
 */
let npfStartupCorePriorityActive = true;
window.__npfStartupCoreReady = false;
window.NPF_SCRIPT_BUILD_VERSION = NPF_SCRIPT_BUILD_VERSION;

// Base fonctionnelle : pérenne v2026.65.

function installGlobalStylusBlocker() {
    if (window.__npfGlobalStylusBlockerInstalled) return;
    window.__npfGlobalStylusBlockerInstalled = true;

    let lastBlockedPenAt = 0;
    let lastBlockedPenTarget = null;

    const isPenEvent = (event) => (
        String(event?.pointerType || '').toLowerCase() === 'pen'
    );

    const isEditableElement = (element) => {
        if (!(element instanceof Element)) return false;
        return Boolean(
            element.closest(
                'input, textarea, select, [contenteditable=""], '
                + '[contenteditable="true"], [role="textbox"]'
            )
        );
    };

    const releaseTemporaryReadOnly = (element) => {
        if (!element || !element.dataset?.npfPenTemporaryReadonly) return;

        window.setTimeout(() => {
            try {
                element.readOnly = false;
                delete element.dataset.npfPenTemporaryReadonly;
                element.classList.remove('npf-global-stylus-blocked-field');
            } catch (_) {}
        }, 400);
    };

    const blurEditableTarget = (target) => {
        if (!(target instanceof Element)) return;

        const editable = target.closest(
            'input, textarea, select, [contenteditable=""], '
            + '[contenteditable="true"], [role="textbox"]'
        );
        if (!editable) return;

        try {
            /*
             * readOnly empêche iPadOS Scribble d'activer le champ. Cette
             * propriété est restaurée immédiatement pour l'utilisation au doigt.
             */
            if ('readOnly' in editable && editable.readOnly !== true) {
                editable.readOnly = true;
                editable.dataset.npfPenTemporaryReadonly = 'true';
                editable.classList.add('npf-global-stylus-blocked-field');
                releaseTemporaryReadOnly(editable);
            }

            editable.blur();
        } catch (_) {}
    };

    const blockPenEvent = (event) => {
        if (!isPenEvent(event)) return;

        lastBlockedPenAt = performance.now();
        lastBlockedPenTarget = event.target;

        blurEditableTarget(event.target);

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    };

    /*
     * Capture avant Leaflet et avant tous les gestionnaires de l'application.
     */
    ['pointerdown', 'pointerup', 'pointermove', 'pointercancel'].forEach((type) => {
        document.addEventListener(type, blockPenEvent, {
            capture: true,
            passive: false
        });
    });

    /*
     * Certains Safari génèrent ensuite un clic ou un événement souris sans
     * conserver pointerType. Le clic synthétique qui suit le stylet est donc
     * supprimé lui aussi.
     */
    const blockSyntheticPenMouseEvent = (event) => {
        const elapsed = performance.now() - lastBlockedPenAt;
        const sameTarget = (
            event.target === lastBlockedPenTarget
            || (
                lastBlockedPenTarget instanceof Element
                && event.target instanceof Element
                && (
                    lastBlockedPenTarget.contains(event.target)
                    || event.target.contains(lastBlockedPenTarget)
                )
            )
        );

        if (isPenEvent(event) || (elapsed >= 0 && elapsed < 700 && sameTarget)) {
            blurEditableTarget(event.target);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }
    };

    ['click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu'].forEach((type) => {
        document.addEventListener(type, blockSyntheticPenMouseEvent, {
            capture: true,
            passive: false
        });
    });

    /*
     * Dernier garde-fou : si Scribble a malgré tout tenté de focaliser un
     * champ juste après un événement stylet, le focus est immédiatement retiré.
     */
    document.addEventListener('focusin', (event) => {
        const elapsed = performance.now() - lastBlockedPenAt;
        if (elapsed < 0 || elapsed >= 900 || !isEditableElement(event.target)) {
            return;
        }

        blurEditableTarget(event.target);
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

installGlobalStylusBlocker();

document.addEventListener('DOMContentLoaded', () => {
    npfStartupDiagMark('dom_ready', 'DOM prêt');
    ensureNpfStartupDiagnosticUi();

    const markAppReady = () => {
        if (document.body) {
            document.body.classList.add('app-ready');
            document.documentElement.classList.add('app-ready');
        }
    };

    window.markNpfAppReady = markAppReady;

    try {
        if (typeof L === 'undefined') {
            const statusEl = document.getElementById('status-message');
            if (statusEl) statusEl.textContent = "❌ ERREUR : leaflet.min.js non chargé.";
            markAppReady();
            return;
        }

        initializeApp();

        /*
         * v17.19 — conserver le splash jusqu'à la première tuile réellement
         * peinte. Le secours à 6,5 s garantit l'accès à l'interface si aucune
         * tuile n'est disponible dans la zone courante.
         */
        setTimeout(markAppReady, 6500);
    } catch (error) {
        console.error('Erreur initialisation application:', error);
        const statusEl = document.getElementById('status-message');
        if (statusEl) statusEl.textContent = `❌ Erreur initialisation: ${error.message || error}`;
        markAppReady();
    }
});




// =========================================================================
// v2026.52 — version pérenne issue de v12.95 // Corrige le grand bandeau bas : Safari peut donner une hauteur CSS trop courte
// avec -webkit-fill-available. On force une variable de hauteur réelle et on
// redemande à Leaflet de recalculer sa taille.
// =========================================================================
(function setupNpfMapViewportHeightFix() {
    /*
     * v2026.63 — la hauteur du viewport reste recalculée comme auparavant, mais
     * un recalcul de taille ne force plus un redraw complet des tuiles.
     * Les retours au premier plan sont traités sans action Leaflet ici :
     * setupNpfUnifiedForegroundResume() effectue une seule invalidation dédupliquée.
     */
    const applyViewportHeight = ({ refreshMap = true } = {}) => {
        try {
            const docEl = document.documentElement;
            const vv = window.visualViewport;
            const candidates = [
                window.innerHeight || 0,
                docEl ? docEl.clientHeight || 0 : 0,
                vv ? Math.round(vv.height + Math.max(0, vv.offsetTop || 0)) : 0,
                window.screen ? Math.round(Math.max(window.screen.height || 0, window.screen.availHeight || 0)) : 0
            ].filter(Boolean);

            const height = Math.max(...candidates);
            if (!height || !Number.isFinite(height)) return;

            docEl.style.setProperty('--npf-app-vh', `${height}px`);
            if (document.body) document.body.style.minHeight = `${height}px`;

            const mapEl = document.getElementById('map');
            if (mapEl) {
                mapEl.style.height = `${height}px`;
                mapEl.style.minHeight = `${height}px`;
                mapEl.style.bottom = '0px';
                mapEl.style.backgroundColor = '#dff3fb';
            }

            if (!refreshMap) return;

            setTimeout(() => {
                try {
                    if (typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') {
                        map.invalidateSize({ animate: false, pan: false });
                    }
                } catch (_) {}
            }, 80);
        } catch (_) {}
    };

    const scheduleApply = (options = {}) => {
        applyViewportHeight(options);
        setTimeout(() => applyViewportHeight(options), 250);
        setTimeout(() => applyViewportHeight(options), 900);
    };

    const scheduleForegroundViewportOnly = () => {
        scheduleApply({ refreshMap: false });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => scheduleApply(), { once: true });
    } else {
        scheduleApply();
    }

    window.addEventListener('load', () => scheduleApply(), { passive: true });
    window.addEventListener('resize', () => scheduleApply(), { passive: true });
    window.addEventListener(
        'orientationchange',
        () => setTimeout(() => scheduleApply(), 350),
        { passive: true }
    );

 // v2026.63 : retour premier plan = hauteur uniquement, aucun redraw ici.
    window.addEventListener('pageshow', scheduleForegroundViewportOnly, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleForegroundViewportOnly();
    }, { passive: true });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => scheduleApply(), { passive: true });
        window.visualViewport.addEventListener('scroll', () => scheduleApply(), { passive: true });
    }
})();

// =========================================================================
// v16.01 — IPAD : EMPÊCHER LA MISE EN VEILLE TANT QUE NPF EST AU PREMIER PLAN
// =========================================================================
(function setupNpfIpadScreenWakeLock() {
    if (window.__npfIpadScreenWakeLockInstalled) return;
    window.__npfIpadScreenWakeLockInstalled = true;

    const ua = String(navigator.userAgent || '');
    const isIpad = (
        /iPad/i.test(ua)
        || (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1)
    );
    if (!isIpad) return;

    let wakeLockSentinel = null;
    let requestInProgress = false;

    const releaseWakeLock = async () => {
        const sentinel = wakeLockSentinel;
        wakeLockSentinel = null;
        if (!sentinel) return;
        try {
            await sentinel.release();
        } catch (_) {}
    };

    const requestWakeLock = async () => {
        if (document.hidden || document.visibilityState !== 'visible') return false;
        if (wakeLockSentinel && !wakeLockSentinel.released) return true;
        if (requestInProgress) return false;
        if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return false;

        requestInProgress = true;
        try {
            const sentinel = await navigator.wakeLock.request('screen');
            wakeLockSentinel = sentinel;
            sentinel.addEventListener('release', () => {
                if (wakeLockSentinel === sentinel) wakeLockSentinel = null;
            }, { once: true });
            return true;
        } catch (error) {
            // iPadOS peut refuser temporairement (économie d'énergie, état système...).
            // NPF reste pleinement fonctionnel et réessaiera au prochain retour / geste.
            console.info('[NPF] Screen Wake Lock iPad indisponible:', error?.name || error);
            return false;
        } finally {
            requestInProgress = false;
        }
    };

    const handleVisibility = () => {
        if (document.hidden || document.visibilityState !== 'visible') {
            releaseWakeLock();
            return;
        }
        requestWakeLock();
    };

    document.addEventListener('visibilitychange', handleVisibility, { passive: true });
    window.addEventListener('pageshow', () => requestWakeLock(), { passive: true });
    window.addEventListener('pagehide', () => releaseWakeLock(), { passive: true });

    // Si une première demande a été refusée avant interaction, le premier geste
    // suivant permet une nouvelle tentative sans ajouter de contrôle à l'interface.
    document.addEventListener('pointerdown', () => {
        if (!wakeLockSentinel) requestWakeLock();
    }, { passive: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => requestWakeLock(), { once: true });
    } else {
        requestWakeLock();
    }
})();

// =========================================================================
// v2026.63 PÉRENNE — REPRISE CARTE UNIQUE APRÈS RETOUR AU PREMIER PLAN
// =========================================================================
(function setupNpfUnifiedForegroundResume() {
    if (window.__npfUnifiedForegroundResumeInstalled) return;
    window.__npfUnifiedForegroundResumeInstalled = true;

    const LONG_BACKGROUND_MS = 2 * 60 * 1000;
    const EVENT_DEBOUNCE_MS = 220;
    const AFTER_RUN_DEDUPE_MS = 900;
    const SHORT_TILE_CHECK_MS = 650;
    const LONG_REDRAW_DELAY_MS = 220;
    const LONG_TILE_CHECK_MS = 1400;
    const RECOVERY_GUARD_KEY =
        `npfResumeRecoveryReload:${window.APP_VERSION || 'unknown'}`;

    let hiddenAt = 0;
    let resumeTimer = null;
    let resumeToken = 0;
    let lastResumeRunAt = 0;
    let pendingReason = 'resume';
    let pendingPersisted = false;

    const markReady = () => {
        try {
            if (document.body) document.body.classList.add('app-ready');
            if (document.documentElement) document.documentElement.classList.add('app-ready');
        } catch (_) {}
    };

    const forceMapContainerVisible = () => {
        try {
            const mapEl = document.getElementById('map');
            if (mapEl) {
                mapEl.style.visibility = 'visible';
                mapEl.style.opacity = '1';
            }

            document
                .querySelectorAll('.leaflet-container, .leaflet-pane, .leaflet-map-pane, .leaflet-tile-pane')
                .forEach((el) => {
                    el.style.visibility = 'visible';
                    el.style.opacity = '1';
                });
        } catch (_) {}
    };

    const notifyOfflineSelection = () => {
        try {
            if (typeof notifyServiceWorkerActivePacks === 'function') {
                notifyServiceWorkerActivePacks(activeOfflinePacks);
            }
        } catch (_) {}
    };

    const invalidateMapLightly = () => {
        try {
            if (typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') {
                map.invalidateSize({ animate: false, pan: false });
            }
        } catch (_) {}
    };

    const countUsableTiles = () => {
        try {
            const tiles = Array.from(document.querySelectorAll('.leaflet-tile'));
            if (!tiles.length) return 0;

            return tiles.filter((tile) => {
                const rect = tile.getBoundingClientRect ? tile.getBoundingClientRect() : null;
                const hasSize = rect && rect.width > 10 && rect.height > 10;
                return (
                    hasSize
                    && tile.complete !== false
                    && tile.style.display !== 'none'
                    && tile.style.visibility !== 'hidden'
                );
            }).length;
        } catch (_) {
            return 0;
        }
    };

    const redrawBaseTilesOnce = () => {
        try {
            if (
                typeof baseTileLayer !== 'undefined'
                && baseTileLayer
                && typeof baseTileLayer.redraw === 'function'
            ) {
                baseTileLayer.redraw();
            }
        } catch (_) {}
    };

    const redrawVisibleApplicationLayers = () => {
        try {
            if (typeof updateDepartmentsLayerAppearance === 'function' && areDepartmentsVisible) {
                updateDepartmentsLayerAppearance();
            }
        } catch (_) {}

        try {
            if (typeof updateCommunesLayerAppearance === 'function' && areCommunesVisible) {
                updateCommunesLayerAppearance();
            }
        } catch (_) {}

        try {
            if (typeof redrawGaarCircuits === 'function' && isGaarMode) {
                redrawGaarCircuits();
            }
        } catch (_) {}

        try {
            if (typeof updateHighVoltageLinesLayerVisibility === 'function') {
                updateHighVoltageLinesLayerVisibility();
            }
        } catch (_) {}

        try {
            if (typeof refreshUI === 'function') {
                refreshUI();
            }
        } catch (_) {}
    };

    const recoverIfMapStillBlank = () => {
        setTimeout(() => {
            try {
                const mapEl = document.getElementById('map');
                const mapLooksReady = Boolean(
                    mapEl
                    && mapEl.classList.contains('leaflet-container')
                    && mapEl.offsetWidth > 0
                    && mapEl.offsetHeight > 0
                );

                if (mapLooksReady) return;

                const alreadyReloaded =
                    sessionStorage.getItem(RECOVERY_GUARD_KEY) === '1';

                if (
                    !alreadyReloaded
                    && typeof window.forceRecoveryReload === 'function'
                ) {
                    sessionStorage.setItem(RECOVERY_GUARD_KEY, '1');
                    window.forceRecoveryReload();
                }
            } catch (_) {}
        }, 3500);
    };

    const softRebuildTileLayerIfNeeded = () => {
        try {
            if (typeof isZipImportRunning !== 'undefined' && isZipImportRunning) return;
            if (countUsableTiles() > 0) return;

            if (
                typeof setupBaseTileLayer === 'function'
                && typeof map !== 'undefined'
                && map
            ) {
                setupBaseTileLayer();
                invalidateMapLightly();
            }
        } catch (_) {}
    };

    const ensureResumeOverlay = () => {
        let overlay = document.getElementById('npf-resume-overlay');
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = 'npf-resume-overlay';
        overlay.setAttribute('aria-live', 'polite');
        overlay.innerHTML = '<div class="npf-resume-card">Patience, je réfléchis ...</div>';
        document.body.appendChild(overlay);
        return overlay;
    };

    const showResumeOverlay = () => {
        try {
            if (!document.body) return;
            document.body.classList.add('npf-resuming');
            ensureResumeOverlay();
        } catch (_) {}
    };

    const hideResumeOverlay = (token, delay = 1800) => {
        setTimeout(() => {
            if (token !== resumeToken) return;
            try {
                if (document.body) document.body.classList.remove('npf-resuming');
            } catch (_) {}
        }, delay);
    };

    const runResume = (reason, persisted) => {
        const now = Date.now();
        const token = ++resumeToken;
        const hiddenDuration = hiddenAt ? Math.max(0, now - hiddenAt) : 0;
        const longResume = Boolean(persisted || hiddenDuration >= LONG_BACKGROUND_MS);

        hiddenAt = 0;
        lastResumeRunAt = now;
        markReady();
        forceMapContainerVisible();
        notifyOfflineSelection();

 // Retour normal (ex. fermeture d'une VAC) : une seule invalidation légère.
        invalidateMapLightly();

        if (!longResume) {
            setTimeout(() => {
                if (token !== resumeToken) return;

 // Le redraw complet n'est utilisé qu'en secours si les tuiles ont disparu.
                if (countUsableTiles() === 0) {
                    redrawBaseTilesOnce();
                    setTimeout(() => {
                        if (token !== resumeToken) return;
                        softRebuildTileLayerIfNeeded();
                    }, 900);
                }
            }, SHORT_TILE_CHECK_MS);
            return;
        }

 // Reprise longue / page restaurée par Safari : récupération renforcée unique.
        showResumeOverlay();

        setTimeout(() => {
            if (token !== resumeToken) return;
            redrawBaseTilesOnce();
            redrawVisibleApplicationLayers();
        }, LONG_REDRAW_DELAY_MS);

        setTimeout(() => {
            if (token !== resumeToken) return;
            softRebuildTileLayerIfNeeded();
        }, LONG_TILE_CHECK_MS);

        recoverIfMapStillBlank();
        hideResumeOverlay(token, 2100);
    };

    const scheduleResume = (reason = 'resume', persisted = false) => {
        const now = Date.now();

 // focus + visibilitychange + pageshow arrivent souvent en rafale.
 // Après une reprise déjà exécutée, les doublons immédiats sont ignorés.
        if (!persisted && lastResumeRunAt && (now - lastResumeRunAt) < AFTER_RUN_DEDUPE_MS) {
            return;
        }

        pendingReason = reason || pendingReason;
        pendingPersisted = pendingPersisted || Boolean(persisted);

        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => {
            resumeTimer = null;
            const reasonToRun = pendingReason;
            const persistedToRun = pendingPersisted;
            pendingReason = 'resume';
            pendingPersisted = false;
            runResume(reasonToRun, persistedToRun);
        }, EVENT_DEBOUNCE_MS);
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (!hiddenAt) hiddenAt = Date.now();
            if (resumeTimer) {
                clearTimeout(resumeTimer);
                resumeTimer = null;
            }
            pendingPersisted = false;
            pendingReason = 'resume';
            return;
        }

        scheduleResume('visible', false);
    }, { passive: true });

    window.addEventListener('pageshow', (event) => {
        scheduleResume(
            event && event.persisted ? 'pageshow-persisted' : 'pageshow',
            Boolean(event && event.persisted)
        );
    }, { passive: true });

    window.addEventListener('focus', () => {
        scheduleResume('focus', false);
    }, { passive: true });
})();

// =========================================================================
// VARIABLES GLOBALES
// =========================================================================
// v14.44 — filtre trafics au sol et zone centrée sur la carte.
let allCommunes = [], map, baseTileLayer, permanentAirportLayer, routesLayer, waterPointsLayer, currentCommune = null, selectedPelicanOACI = null, selectedAirportDestination = null;
let airportOperationalLabelLayer = null;
let airportOperationalLabelRefreshTimer = null;
let airportOperationalFrequencyIndex = null;
let airportOperationalFrequencyIndexDataset = null;
/* v16.58 — fréquences des aérodromes complémentaires : référentiel léger,
 * indépendant du chargement lourd SIA et mémorisé pour l'usage offline. */
const AIRPORT_FREQUENCY_FALLBACK_URLS = Object.freeze([
    'https://raw.githubusercontent.com/vmath54/xcsoar/master/waypoints/FranceVacEtUlm.cup',
    'https://cdn.jsdelivr.net/gh/vmath54/xcsoar@master/waypoints/FranceVacEtUlm.cup'
]);
const AIRPORT_FREQUENCY_FALLBACK_CACHE_KEY = 'npfAirportFrequencyFallback_v1';
const AIRPORT_FREQUENCY_FALLBACK_TIMEOUT_MS = 8000;
let airportFrequencyFallbackIndex = null;
let airportFrequencyFallbackLoadPromise = null;
let airportFrequencyFallbackLastAttemptAt = 0;

/* v16.69 — radio aérodromes SIA officielle découplée de sia.js.
 * Ces trois tables sont volontairement embarquées dans script.js afin que
 * l'index TWR / AFIS / A/A soit disponible dès l'initialisation du moteur,
 * même si sia.js est retardé, absent du cache courant ou remplacé ensuite. */
