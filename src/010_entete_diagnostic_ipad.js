const NPF_SCRIPT_BUILD_VERSION = 'v17.64';


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
            maxCenterShiftM: 0,
            speedCount: 0, speedTotalMps: 0, maxSpeedMps: 0, lastSpeedMps: null,
            recenterReasons: {}, recenterShiftTotalM: 0
        },
        /* v17.35 — positions simulées : statistiques séparées (même forme). */
        gpsSummarySim: null,
        layerSummary: {
            siaRefreshCount: 0, siaSlowCount: 0, siaMaxMs: 0, siaMaxPointsMs: 0, siaMaxDecorMs: 0,
            htRenderCount: 0, htMaxRendered: 0,
            roadRenderCount: 0, roadMaxRendered: 0,
            filterActivationCount: 0, filterActivationMaxWaitMs: 0, filterLayerMaxMs: 0,
            tileQueueMax: 0, tileActiveMax: 0, tileBlankSnapshots: 0,
            tileAbortedMax: 0, tileQueuedDiscardedMax: 0, tileRetriesMax: 0,
            siaGpsZeroWorkCount: 0
        },
        restoredSession: null,
        persistCount: 0,
        persistMaxMs: 0,
        persistTotalMs: 0
    };

    state.gpsSummarySim = JSON.parse(JSON.stringify(state.gpsSummary));

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
            /* v17.53 — P3 : reconstructions évitées (identique) et objets lus par l'index. */
            if (Number(safeMetrics.identicalAvoided) > 0) summary.siaIdenticalAvoidedCount = Number(summary.siaIdenticalAvoidedCount || 0) + 1;
            if (Number.isFinite(Number(safeMetrics.indexRead))) {
                summary.siaIndexReadCount = Number(summary.siaIndexReadCount || 0) + 1;
                summary.siaIndexReadTotal = Number(summary.siaIndexReadTotal || 0) + Number(safeMetrics.indexRead);
                summary.siaIndexReadMax = Math.max(Number(summary.siaIndexReadMax || 0), Number(safeMetrics.indexRead));
            }
        }

        /* v17.33 — D2 : les passages « SIA GPS » sans travail sont comptés,
         * plus listés (ils saturaient la liste des 100 événements). */
        if (kind === 'SIA GPS' && !(Number(safeMetrics.totalMs) > 0)) {
            summary.siaGpsZeroWorkCount = Number(summary.siaGpsZeroWorkCount || 0) + 1;
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
        if (kind === 'SIA GPS') return Number(safeMetrics.totalMs) > 0;
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

        /* v17.32 — chaque geste est journalisé, pas seulement les saccadés. */
        try { NPF_DIAG_DETAIL.recordGesture(source, safeMetrics); } catch (_) {}

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

    const recordGpsPosition = (coords, timestampMs = Date.now(), isSimulation = false) => {
        /* v17.35 — positions réelles et simulées comptées séparément. */
        const summary = isSimulation ? state.gpsSummarySim : state.gpsSummary;
        const at = Number(timestampMs) || Date.now();
        summary.positions += 1;
        if (summary.lastPositionAt > 0 && at > summary.lastPositionAt) {
            const delta = at - summary.lastPositionAt;
            summary.intervalCount += 1;
            summary.intervalTotalMs += delta;
            summary.maxIntervalMs = Math.max(summary.maxIntervalMs, delta);
        }
        summary.lastPositionAt = at;

        /* v17.35 — précision absente (simulation) : non comptée (ne vaut pas 0 m). */
        const accuracy = coords?.accuracy === null || coords?.accuracy === undefined ? NaN : Number(coords.accuracy);
        if (Number.isFinite(accuracy) && accuracy >= 0) {
            summary.accuracyCount += 1;
            summary.accuracyTotalM += accuracy;
            summary.maxAccuracyM = Math.max(summary.maxAccuracyM, accuracy);
        }

        /* v17.33 — D5 : vitesse GPS (m/s), pour rapporter le débit de tuiles. */
        const speed = coords?.speed === null || coords?.speed === undefined ? NaN : Number(coords.speed);
        if (Number.isFinite(speed) && speed >= 0) {
            summary.speedCount = Number(summary.speedCount || 0) + 1;
            summary.speedTotalMps = Number(summary.speedTotalMps || 0) + speed;
            summary.maxSpeedMps = Math.max(Number(summary.maxSpeedMps || 0), speed);
            summary.lastSpeedMps = speed;
        }
    };

    const recordGpsRecenter = (reason = '', centerShiftM = 0, isSimulation = false) => {
        const summary = isSimulation ? state.gpsSummarySim : state.gpsSummary;
        const at = Date.now();
        summary.recenterCount += 1;
        /* v17.35 — recentrages par raison (gps-update, manual-delay, enable…). */
        const reasonKey = String(reason || '—');
        summary.recenterReasons = summary.recenterReasons || {};
        summary.recenterReasons[reasonKey] = (summary.recenterReasons[reasonKey] || 0) + 1;
        summary.recenterShiftTotalM = Number(summary.recenterShiftTotalM || 0) + Math.max(0, Number(centerShiftM) || 0);
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
        gpsSummarySim: state.gpsSummarySim,
        layerSummary: state.layerSummary,
        /* v17.40 — enregistrement allégé : 30 derniers événements, détails
         * limités aux 10 premières mesures (les instantanés de couches en
         * comptaient ≈ 35). */
        interactions: state.siaInteractions.slice(-30).map(entry => ({
            t: entry.t,
            at: entry.at,
            kind: entry.kind,
            detail: String(entry.detail || '').slice(0, 160),
            metrics: entry.metrics && typeof entry.metrics === 'object'
                ? Object.fromEntries(Object.entries(entry.metrics).slice(0, 10))
                : null
        })),
        stalls: state.stalls.slice(0, 12),
        longTasks: state.longTasks.slice(0, 12),
        /* v17.32 — extrait du DIAG détaillé, restitué dans l'export suivant. */
        detail: npfDiagDetailPersistSnapshot()
    });

    /* v17.40 — aucune écriture pendant un geste manuel : report de 2 s. Les
     * écritures au passage en arrière-plan restent immédiates. */
    let persistDeferTimer = null;
    const isMapGestureInProgress = () => {
        try {
            return (typeof npfMapManualGestureLockActive !== 'undefined' && !!npfMapManualGestureLockActive)
                || (typeof centerGpsFollowUserGestureActive !== 'undefined' && !!centerGpsFollowUserGestureActive);
        } catch (_) {
            return false;
        }
    };
    const persistWhenIdle = () => {
        if (isMapGestureInProgress()) {
            state.persistDeferred = (state.persistDeferred || 0) + 1;
            if (!persistDeferTimer) {
                persistDeferTimer = setTimeout(() => {
                    persistDeferTimer = null;
                    persistWhenIdle();
                }, 2000);
            }
            return;
        }
        persist();
    };

    const persist = () => {
        const started = now();
        try {
            const serialized = JSON.stringify(buildPersistedSnapshot());
            localStorage.setItem(DIAG_PERSIST_KEY, serialized);
            state.persistChars = serialized.length;
            state.persistCount += 1;
            const duration = Math.max(0, now() - started);
            state.persistTotalMs += duration;
            state.persistMaxMs = Math.max(state.persistMaxMs, duration);
        } catch (_) {}
    };

    mark('script_eval', 'Script NPF-Q400 exécuté');

    try {
        setInterval(persistWhenIdle, DIAG_PERSIST_INTERVAL_MS);
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
        wouldRetainInteraction: shouldRetainInteraction,
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
function npfDiagGpsPosition(coords, timestampMs = Date.now(), isSimulation = false) {
    try { NPF_DIAG_DETAIL.notePosition(coords, !!isSimulation); } catch (_) {}
    return NPF_STARTUP_DIAGNOSTIC.recordGpsPosition(coords, timestampMs, !!isSimulation);
}
/* v17.36 — recentrage économe : points d'appel de src/260. */
function npfDiagEconomicRecenterChanged(enabled) {
    try { NPF_DIAG_DETAIL.economicRecenterChanged(!!enabled); } catch (_) {}
}
function npfDiagEconomicRecenterSkipped(shiftPx) {
    try { NPF_DIAG_DETAIL.economicRecenterSkipped(shiftPx); } catch (_) {}
}
/* v17.35 — position courante simulée ? */
function npfDiagIsSimulatedPosition() {
    try { return !!(isSimulationMode && lastPosition?.simulation === true); } catch (_) { return false; }
}
function npfDiagGpsRecenter(reason = '', centerShiftM = 0) {
    /* v17.34 — heure du recentrage, pour la corrélation avec les attentes HT. */
    const isSimulation = npfDiagIsSimulatedPosition();
    try { NPF_DIAG_DETAIL.noteGpsRecenter(isSimulation, reason, centerShiftM); } catch (_) {}
    return NPF_STARTUP_DIAGNOSTIC.recordGpsRecenter(reason, centerShiftM, isSimulation);
}
function npfDiagPersist() {
    try { return NPF_STARTUP_DIAGNOSTIC.persist(); } catch (_) { return null; }
}

/*
 * v17.32 — DIAG DÉTAILLÉ (lecture seule, aucun changement de comportement).
 *
 * - Les fonctions suivies sont enveloppées ici, une seule fois, au chargement du
 *   script : leur code n'est pas modifié, l'enveloppe mesure seulement la durée
 *   synchrone (et la durée totale si la fonction est async), puis rend exactement
 *   le même résultat ou la même exception.
 * - Aucune fonction du moteur de tuiles (src/100) n'est enveloppée : ses compteurs
 *   sont seulement lus.
 * - Aucune mesure ne force un calcul de mise en page (pas de
 *   getBoundingClientRect) ; la mémoire des canvas n'est pas relevée pendant un
 *   geste ni pendant une restitution.
 * - Blocages JS : minuterie de 50 ms (en plus de la mesure historique à 1 Hz,
 *   conservée telle quelle pour comparer avec les versions précédentes).
 */
const NPF_DIAG_DETAIL = (() => {
    const now = () => NPF_STARTUP_DIAGNOSTIC.now();
    const LIMITS = {
        activities: 400,
        blocks: 80,
        firstBlocks: 40,
        gestures: 150,
        restores: 60,
        routes: 60,
        ht: 60,
        memory: 60,
        startupCalls: 120,
        tileTimeline: 150,
        waits: 60,
        markers: 40,
        gpsSlowCycles: 15,
        tileLookups: 600,
        tileSlowest: 25,
        zoomEvents: 60,
        packChanges: 20,
        gpsRecenters: 6000,
        layerWaits: 400,
        waitMinutes: 180,
        positions: 120,
        simPeriods: 20,
        followChanges: 60
    };
    const TILE_MS_BINS = [50, 100, 250, 500, 1000, 2000, 5000];
    const STARTUP_WINDOW_MS = 30000;
    const BLOCK_TICK_MS = 50;
    const BLOCK_MIN_MS = 100;

    const state = {
        wrapped: [],
        missing: [],
        activities: [],
        blocks: [],
        firstBlocks: [],
        blockCount: 0,
        blockMaxMs: 0,
        gestures: [],
        gestureCount: 0,
        restores: [],
        restoreCount: 0,
        routesRebuilds: [],
        routesCount: 0,
        htRebuilds: [],
        htCount: 0,
        memorySamples: [],
        memoryPeak: null,
        cellCache: {
            insertions: 0, hits: 0, misses: 0, evictions: 0, clears: 0,
            estimatedBytes: 0, peakBytes: 0, peakCells: 0
        },
        cellBytesByKey: new Map(),
        startupCalls: [],
        tileTimeline: [],
        waits: [],
        markers: [],
        userContactActive: false,
        userContactLastAt: -Infinity,
        motionActive: false,
        lastMoveEndAt: 0,
        gesturesSinceRestore: 0,
        currentRestore: null,
        currentRoutes: null,
        htRenderedZoomBand: null,
        lastWaitByLabel: Object.create(null),
        fnStats: new Map(),
        gpsCycle: null,
        gps: { cycles: 0, totalMs: 0, maxMs: 0, parts: new Map(), slowest: [] },
        layoutProbe: null,
        tiles: {
            n: 0, byOutcome: Object.create(null), histo: new Array(TILE_MS_BINS.length + 1).fill(0),
            waitHisto: new Array(TILE_MS_BINS.length + 1).fill(0), waitCount: 0,
            reads: 0, opens: 0, readTimeouts: 0, openTimeouts: 0, readErrors: 0, openErrors: 0,
            foundCount: 0, foundReads: 0, maxFoundReads: 0, foundAfterFirstDb: 0,
            hintUsed: 0, hintMiss: 0, maxMs: 0, maxWait: 0,
            recent: [], slowest: [], perPack: Object.create(null)
        },
        zoomEvents: [],
        packChanges: [],
        packKey: null,
        /* v17.34 — instantanés DIAG : avec / sans mesure DOM, non calculés. */
        snapshotStats: { dom: 0, gesture: 0, gpsFollow: 0, requested: 0, skipped: 0 },
        /* v17.34 — attentes de calque et vérification des tuiles (mesure seule). */
        gpsRecenterTimes: [],
        activeWaits: new Map(),
        waitSeq: 0,
        layerWaits: [],
        layerWaitTotals: Object.create(null),
        waitCorrelation: { interrupted: 0, startNear: 0, endNear: 0, bothNear: 0 },
        tileCheck: {
            calls: 0, totalMs: 0, maxMs: 0, tiles: 0, byCaller: Object.create(null),
            secondIndex: -1, secondCalls: 0, maxPerSecond: 0
        },
        waitMinutes: new Map(),
        /* v17.35 — simulation : périodes, positions, cycles et recentrages séparés. */
        gpsSim: { cycles: 0, totalMs: 0, maxMs: 0, parts: new Map(), slowest: [] },
        gpsIgnoredDuringSimulation: 0,
        gpsRecenterTimesSim: [],
        waitCorrelationSim: { interrupted: 0, startNear: 0, endNear: 0, bothNear: 0 },
        positions: [],
        simPeriods: [],
        followChanges: [],
        /* v17.36 — recentrage économe : périodes ON / OFF et statistiques séparées. */
        ecoPeriods: [],
        ecoStats: Object.create(null),
        /* v17.38 — FdS / BFG / GLR : requêtes NAS (30 dernières), temps ressenti,
         * messages affichés, tentatives du pont BFG. Mémoire seule : écrits
         * uniquement avec l'enregistrement DIAG existant (30 s). */
        nasRequests: [],
        felt: [],
        messages: [],
        bfgAttempts: [],
        glrClickAt: 0,
        glrClickCaptcha: false,
        fdsClick: null,
        /* v17.39 — lectures du pack : 20 premières, paquets lents (> 1 s),
         * synthèse par minute, et repères HT (redimensionnement du dessin,
         * masquage / réaffichage du calque). Mémoire seule. */
        firstPackReads: [],
        slowReadBatches: [],
        readMinutes: new Map(),
        lastHtCanvasUpdateAt: null,
        lastHtPaneToggleAt: null,
        lastHtPaneVisible: null,
        /* v17.40 — sélections de feu et messages affichés en bandeau. */
        fireSelections: [],
        bannerCount: 0,
        lastBanner: null,
        /* v17.41 — premier plan / arrière-plan, récupérations automatiques du
         * lecteur de tuiles, lectures ayant dépassé leur délai et encore en
         * cours, délais de restitution dépassés, « référence iPad ».
         * Mémoire seule : écrits avec l'enregistrement DIAG existant. */
        visibilityEvents: [],
        readerRecoveries: [],
        pendingPackReads: new Map(),
        pendingPackReadSeq: 0,
        lateReads: { total: 0, maxSimultaneous: 0 },
        restoreTimeouts: [],
        refDurations: [],
        refStats: { n: 0, totalMs: 0, maxMs: 0, skipped: 0 },
        /* v17.42 — activité de stockage (ouvertures / fermetures de base,
         * écritures IndexedDB de l'app, autres lectures, fichiers en cache,
         * localStorage) et sondes lancées après un paquet de lectures lent. */
        storageEvents: [],
        packProbes: [],
        probePending: null,
        probeLastAt: null,
        probeDropped: 0,
        /* v17.43 — forme de la dernière image lue (Blob / données brutes). */
        lastReadForm: null
    };

    const safe = (callback, fallback = undefined) => {
        try { return callback(); } catch (_) { return fallback; }
    };
    const pushCapped = (list, item, limit) => {
        list.push(item);
        if (list.length > limit) list.splice(0, list.length - limit);
    };
    const round = value => Math.round(Number(value) || 0);
    const wallAt = t => (
        NPF_STARTUP_DIAGNOSTIC.state.monitorStartedWallAt
        + (Number(t) - NPF_STARTUP_DIAGNOSTIC.state.monitorStartedAt)
    );

    /* ---------- État courant lu sans calcul de mise en page ---------- */

    const getTileState = () => safe(() => {
        let current = 0;
        let loaded = 0;
        const tiles = baseTileLayer && baseTileLayer._tiles ? baseTileLayer._tiles : {};
        for (const key in tiles) {
            const tile = tiles[key];
            if (!tile || !tile.current) continue;
            current += 1;
            if (tile.loaded) loaded += 1;
        }
        return {
            queued: Number(directOfflineNpfReadQueue?.length || 0),
            active: Number(directOfflineNpfActiveReads || 0),
            loaded,
            current,
            idb: Number(directOfflineNpfIndexedDbLookupCount || 0),
            ram: Number(directOfflineNpfMainRamHitCount || 0)
        };
    }, { queued: 0, active: 0, loaded: 0, current: 0, idb: 0, ram: 0 });

    const formatTileState = tileState => (
        `file ${tileState.queued} / actives ${tileState.active} / tuiles ${tileState.loaded}/${tileState.current}`
    );

    const getHtZoomBand = zoom => {
        const z = Number(zoom);
        if (!Number.isFinite(z)) return null;
        if (z <= 8) return '≤8';
        if (z <= 9) return '9';
        if (z <= 10) return '10';
        return '≥11';
    };

    const getHtZoneState = () => safe(() => {
        if (!showHighVoltageLinesLayer) return '—';
        if (!isHighVoltageLayerEffectiveAtCurrentScale()) return 'masqué 50 NM';
        if (!highVoltageLinesRenderedGeoJsonLayer) return 'non dessiné';
        const sameBand = state.htRenderedZoomBand === getHtZoomBand(map?.getZoom?.());
        return isHighVoltageCoverageValidForCurrentView() && sameBand ? 'oui' : 'non';
    }, '?');

    const getRoutesZoneState = () => safe(() => {
        if (!showRoadOverlayLayer) return '—';
        if (getRoadOverlayZoomTier() === 0) return 'niveau 0';
        return isRoadOverlayCoverageValidForCurrentView() ? 'oui' : 'non';
    }, '?');

    const getRestoreStageName = ctx => {
        if (!ctx) return '—';
        if (ctx.tTiles == null) return 'tuiles';
        if (ctx.tRoutesStart != null || ctx.tHt != null) return 'Routes';
        if (ctx.tHtStart != null) return 'HT';
        return 'VFR';
    };

    const getSpeedKt = () => safe(() => {
        const mps = NPF_STARTUP_DIAGNOSTIC.state.gpsSummary.lastSpeedMps;
        return Number.isFinite(Number(mps)) && mps !== null ? Math.round(Number(mps) * 1.9438444924406) : null;
    }, null);

    const describeRunningState = () => {
        const tileState = getTileState();
        const speedKt = getSpeedKt();
        return [
            `geste=${state.motionActive || state.userContactActive ? 'oui' : 'non'}`,
            `restitution=${getRestoreStageName(state.currentRestore)}`,
            `tuiles q${tileState.queued}/a${tileState.active}`,
            `SIA=${safe(() => (siaRefreshInProgress ? 'en cours' : '—'), '?')}`,
            `Routes=${safe(() => (isRoadOverlayLoading ? 'en cours' : '—'), '?')}`,
            `HT=${state.htInProgress ? 'en cours' : '—'}`,
            `v=${speedKt === null ? '—' : speedKt + ' kt'}`,
            safe(() => (isSimulationMode ? 'SIMULATION' : 'GPS réel'), '?'),
            `suivi=${isGpsFollowActive() ? 'oui' : 'non'}`
        ].join(' · ');
    };

    const describeWindow = (start, end) => {
        const syncItems = state.activities
            .filter(item => item.t0 < end && item.t1 > start && item.t1 - item.t0 >= 1)
            .sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0))
            .slice(0, 4);
        const sync = syncItems.map(item => `${item.name} ${round(item.t1 - item.t0)} ms`);
        const syncNames = new Set(syncItems.map(item => item.name));
        const asyncNames = [];
        state.activities.forEach(item => {
            if (!item.async || item.t0 >= end) return;
            if (item.tEnd !== null && item.tEnd < start) return;
            if (syncNames.has(item.name) || asyncNames.includes(item.name)) return;
            asyncNames.push(item.name);
        });
        const marks = NPF_STARTUP_DIAGNOSTIC.state.marks
            .filter(entry => entry.t >= start - 20 && entry.t <= end + 50)
            .slice(0, 8)
            .map(entry => `${entry.label} (+${(entry.t / 1000).toFixed(2)} s)`);
        return {
            sync: sync.join(', '),
            async: asyncNames.slice(-5).join(', '),
            marks: marks.join(', '),
            state: describeRunningState()
        };
    };

    /* ---------- Activités (fonctions enveloppées) ---------- */

    /* v17.33 — statistiques par fonction suivie (nombre, total, max). */
    const addFnStat = (name, syncMs, extra = null) => {
        let stat = state.fnStats.get(name);
        if (!stat) {
            stat = { n: 0, total: 0, max: 0, asyncN: 0, asyncTotal: 0, asyncMax: 0, info: '' };
            state.fnStats.set(name, stat);
        }
        stat.n += 1;
        stat.total += syncMs;
        if (syncMs > stat.max) stat.max = syncMs;
        if (extra) stat.info = extra;
        return stat;
    };

    /* v17.33 — I1 : durée des fonctions appelées pendant un cycle GPS. */
    const addGpsPart = (name, ms) => {
        const cycle = state.gpsCycle;
        if (!cycle || cycle.done) return;
        cycle.parts[name] = (cycle.parts[name] || 0) + ms;
    };

    const recordActivity = (name, t0, t1, isAsync, options) => {
        const entry = { name, t0, t1, tEnd: isAsync ? null : t1, async: !!isAsync };
        const syncMs = t1 - t0;
        addFnStat(name, syncMs);
        if (options.gpsPart) addGpsPart(name, syncMs);
        if (
            !options.noActivity
            && !(options.activityMinMs && syncMs < options.activityMinMs && !isAsync)
        ) {
            pushCapped(state.activities, entry, LIMITS.activities);
        }
        if (!options.noStartup && t0 <= STARTUP_WINDOW_MS && (isAsync || t1 - t0 >= 2)) {
            pushCapped(state.startupCalls, entry, LIMITS.startupCalls);
        }
        return entry;
    };

    const wrapGlobal = (name, options = {}) => {
        const original = safe(() => window[name]);
        if (typeof original !== 'function') {
            state.missing.push(name);
            return false;
        }
        if (original.__npfDiagWrapped) return true;
        const label = options.label || name;
        const wrapped = function (...args) {
            const before = options.before ? safe(() => options.before(args)) : undefined;
            const t0 = now();
            let result;
            try {
                result = original.apply(this, args);
            } catch (error) {
                const t1 = now();
                recordActivity(label, t0, t1, false, options);
                if (options.after) safe(() => options.after({ args, before, t0, t1, tEnd: t1, error }));
                throw error;
            }
            const t1 = now();
            const isAsync = !!(result && typeof result.then === 'function');
            const activity = recordActivity(label, t0, t1, isAsync, options);
            if (isAsync) {
                result.then(
                    value => {
                        activity.tEnd = now();
                        const stat = state.fnStats.get(label);
                        if (stat) {
                            const asyncMs = activity.tEnd - t0;
                            stat.asyncN += 1;
                            stat.asyncTotal += asyncMs;
                            if (asyncMs > stat.asyncMax) stat.asyncMax = asyncMs;
                        }
                        if (options.after) safe(() => options.after({ args, before, t0, t1, tEnd: activity.tEnd, value }));
                    },
                    error => {
                        activity.tEnd = now();
                        activity.error = true;
                        if (options.after) safe(() => options.after({ args, before, t0, t1, tEnd: activity.tEnd, error }));
                    }
                );
            } else if (options.after) {
                safe(() => options.after({ args, before, t0, t1, tEnd: t1, value: result }));
            }
            return result;
        };
        wrapped.__npfDiagWrapped = true;
        try { window[name] = wrapped; } catch (_) {}
        if (window[name] !== wrapped) {
            state.missing.push(name);
            return false;
        }
        state.wrapped.push(name);
        return true;
    };

    /* ---------- Blocages JS > 100 ms (minuterie 50 ms) ---------- */

    const recordBlock = (start, end, blockedMs) => {
        const context = describeWindow(start, end);
        state.blockCount += 1;
        state.blockMaxMs = Math.max(state.blockMaxMs, blockedMs);
        const entry = {
            t: round(start),
            end: round(end),
            at: wallAt(start),
            ms: round(blockedMs),
            speedKt: getSpeedKt(),
            ...context
        };
        /* v17.33 — D3 : les 40 premiers blocages (démarrage) restent conservés. */
        if (state.firstBlocks.length < LIMITS.firstBlocks) state.firstBlocks.push(entry);
        const eco = ecoStat();
        eco.blocks += 1;
        eco.blockMs += blockedMs;
        if (blockedMs > eco.blockMax) eco.blockMax = blockedMs;
        entry.eco = ecoMode();
        pushCapped(state.blocks, entry, LIMITS.blocks);
        /* v17.33 — I7 : mémoire des canvas relevée après un gros blocage. */
        if (blockedMs >= 500) scheduleCanvasMemorySample('après blocage > 500 ms', 0);
    };

    const startBlockMonitor = () => {
        let lastTick = now();
        document.addEventListener('visibilitychange', () => {
            lastTick = now();
        }, { passive: true });
        const tick = () => {
            const current = now();
            const blockedMs = current - lastTick - BLOCK_TICK_MS;
            /* Au-delà de 20 s : suspension iPadOS / arrière-plan, pas un blocage. */
            if (
                document.visibilityState !== 'hidden'
                && blockedMs >= BLOCK_MIN_MS
                && blockedMs < 20000
            ) {
                safe(() => recordBlock(lastTick, current, blockedMs));
            }
            lastTick = current;
            setTimeout(tick, BLOCK_TICK_MS);
        };
        setTimeout(tick, BLOCK_TICK_MS);
    };

    /* ---------- Mémoire des canvas ---------- */

    const sampleCanvasMemory = (reason = 'intervalle') => {
        const canvases = safe(() => document.getElementsByTagName('canvas'), []);
        const items = [];
        let total = 0;
        for (let index = 0; index < canvases.length; index += 1) {
            const canvas = canvases[index];
            const width = Number(canvas.width) || 0;
            const height = Number(canvas.height) || 0;
            if (!width || !height) continue;
            const bytes = width * height * 4;
            total += bytes;
            const pane = safe(() => canvas.closest('.leaflet-pane'), null);
            const paneName = pane
                ? ((String(pane.className).match(/leaflet-([A-Za-z0-9]+)-pane/) || [])[1] || 'pane')
                : (canvas.id || 'hors carte');
            items.push({
                pane: paneName,
                w: width,
                h: height,
                mb: Math.round(bytes / 104857.6) / 10,
                hidden: !!(pane && pane.style && pane.style.display === 'none')
            });
        }
        items.sort((a, b) => b.mb - a.mb);
        const sample = {
            t: round(now()),
            at: Date.now(),
            reason,
            totalMb: Math.round(total / 104857.6) / 10,
            count: items.length,
            items
        };
        pushCapped(state.memorySamples, {
            ...sample,
            items: items.slice(0, 4)
        }, LIMITS.memory);
        if (!state.memoryPeak || sample.totalMb > state.memoryPeak.totalMb) {
            state.memoryPeak = sample;
        }
        return sample;
    };

    const scheduleCanvasMemorySample = (reason, delayMs = 0, attempt = 0) => {
        setTimeout(() => {
            if ((state.motionActive || state.userContactActive || state.currentRestore) && attempt < 5) {
                scheduleCanvasMemorySample(reason, 2000, attempt + 1);
                return;
            }
            safe(() => sampleCanvasMemory(reason));
        }, delayMs);
    };

    /* ---------- Chronologie tuiles au démarrage ---------- */

    const startTileTimeline = () => {
        let last = '';
        let lastRecordedAt = -Infinity;
        const tick = () => {
            const t = now();
            const baseLoaded = NPF_STARTUP_DIAGNOSTIC.state.marks.find(entry => entry.key === 'base_tiles_loaded');
            if (t > STARTUP_WINDOW_MS || (baseLoaded && t > baseLoaded.t + 3000)) return;
            const tileState = getTileState();
            const signature = [
                tileState.queued, tileState.active, tileState.loaded, tileState.current
            ].join('|');
            if (signature !== last || t - lastRecordedAt >= 1000) {
                last = signature;
                lastRecordedAt = t;
                const marks = NPF_STARTUP_DIAGNOSTIC.state.marks;
                pushCapped(state.tileTimeline, {
                    t: round(t),
                    ...tileState,
                    phase: marks.length ? marks[marks.length - 1].label : '—'
                }, LIMITS.tileTimeline);
            }
            setTimeout(tick, 100);
        };
        setTimeout(tick, 100);
    };

    const recordWait = (label, info) => {
        const ms = info.tEnd - info.t0;
        state.lastWaitByLabel[label] = { t0: info.t0, tEnd: info.tEnd, ok: info.value !== false };
        if (!(info.t0 <= STARTUP_WINDOW_MS || ms >= 1000)) return;
        const endState = getTileState();
        /* Attente imbriquée (calque lourd -> activation) : l'attente englobante
         * remplace l'attente interne du même calque. */
        const last = state.waits[state.waits.length - 1];
        if (last && last.label === label && Math.abs(last.t - info.t0) < 3) state.waits.pop();
        pushCapped(state.waits, {
            t: round(info.t0),
            label,
            ms: round(ms),
            result: info.error ? 'erreur' : (info.value === false ? 'annulée ou délai dépassé' : 'prête'),
            start: info.before?.tiles ? formatTileState(info.before.tiles) : '—',
            end: formatTileState(endState)
        }, LIMITS.waits);
    };

    /* ---------- Attentes de calque et vérification des tuiles (v17.34) ---------- */

    const minuteBucket = t => {
        const index = Math.floor(Number(t) / 60000);
        let bucket = state.waitMinutes.get(index);
        if (!bucket) {
            bucket = {
                index, at: wallAt(index * 60000), gpsFollow: false, htOn: false, recenters: 0, recentersSim: 0,
                htStarted: 0, htReady: 0, htInterrupted: 0, htWaitMs: 0, htWaitMax: 0,
                checks: 0, checkMs: 0, checkMax: 0, checkTiles: 0, byCaller: Object.create(null)
            };
            state.waitMinutes.set(index, bucket);
            if (state.waitMinutes.size > LIMITS.waitMinutes) {
                state.waitMinutes.delete(state.waitMinutes.keys().next().value);
            }
        }
        return bucket;
    };

    const isGpsFollowActive = () => safe(() => !!isCenterGpsFollowEffective(), false);

    const noteGpsRecenter = (isSimulation = false, reason = '', shiftM = 0) => {
        const t = now();
        pushCapped(isSimulation ? state.gpsRecenterTimesSim : state.gpsRecenterTimes, t, LIMITS.gpsRecenters);
        const bucket = minuteBucket(t);
        if (isSimulation) bucket.recentersSim += 1; else bucket.recenters += 1;
        if (!isSimulation) ecoStat().recenters += 1;
        /* Rattacher le recentrage à la dernière position enregistrée (même mode). */
        const last = state.positions[state.positions.length - 1];
        if (last && last.sim === isSimulation && t - last.t < 1500 && !last.recenter) {
            last.recenter = String(reason || '—');
            last.shiftM = round(shiftM);
        }
    };

    const notePosition = (coords, isSimulation) => {
        const speed = coords?.speed === null || coords?.speed === undefined ? NaN : Number(coords.speed);
        const accuracy = coords?.accuracy === null || coords?.accuracy === undefined ? NaN : Number(coords.accuracy);
        pushCapped(state.positions, {
            t: round(now()),
            at: Date.now(),
            sim: !!isSimulation,
            lat: Math.round(Number(coords?.latitude) * 100000) / 100000,
            lon: Math.round(Number(coords?.longitude) * 100000) / 100000,
            speedKt: Number.isFinite(speed) ? Math.round(speed * 1.9438444924406) : null,
            accuracyM: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
            heading: coords?.heading === null || coords?.heading === undefined || !Number.isFinite(Number(coords.heading))
                ? null
                : Math.round(Number(coords.heading) * 10) / 10,
            follow: isGpsFollowActive(),
            recenter: null,
            shiftM: null
        }, LIMITS.positions);
    };

    const currentSimulationSettings = () => safe(() => ({
        speedKt: Math.round(Number(simulationSpeedKt) || 0),
        routeDeg: Math.round((Number(simulationRouteDeg) || 0) * 10) / 10,
        altitudeFt: Math.round(Number(simulationAltitudeFt) || 0)
    }), { speedKt: null, routeDeg: null, altitudeFt: null });

    /* Recentrage GPS à moins de 200 ms de l'instant t ? (tableau trié). */
    const nearGpsRecenter = (t, times = state.gpsRecenterTimes) => {
        let low = 0;
        let high = times.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (times[mid] < t) low = mid + 1; else high = mid - 1;
        }
        return [times[low], times[low - 1]].some(value => Number.isFinite(value) && Math.abs(value - t) <= 200);
    };

    const waitCategory = (fnName, label) => {
        const text = String(label || '');
        if (fnName === 'restitution') return 'restitution';
        if (text === 'HT') return 'attente HT';
        if (text === 'Routes') return 'attente Routes';
        if (text === 'Routes+HT') return 'attente Routes+HT';
        if (text.startsWith('SIA')) return 'attente SIA';
        return 'attente ' + (text || 'autre');
    };

    const startLayerWait = (fnName, args) => {
        const t0 = now();
        const id = ++state.waitSeq;
        const label = fnName === 'restitution' ? 'restitution' : String(args?.[0] || '—');
        const wait = {
            id, fnName, label, t0,
            category: waitCategory(fnName, label),
            gpsFollow: isGpsFollowActive(),
            htOn: safe(() => !!showHighVoltageLinesLayer, false),
            maxWaitMs: Number(args?.[1]?.maxWaitMs) || null,
            isCancelled: typeof args?.[1]?.isCancelled === 'function' ? args[1].isCancelled : null
        };
        state.activeWaits.set(id, wait);
        const bucket = minuteBucket(t0);
        if (wait.gpsFollow) bucket.gpsFollow = true;
        if (wait.htOn) bucket.htOn = true;
        if (label === 'HT' && fnName !== 'restitution') bucket.htStarted += 1;
        return wait;
    };

    const finishLayerWait = (wait, info) => {
        if (!wait) return;
        state.activeWaits.delete(wait.id);
        const tEnd = info.tEnd;
        const ms = tEnd - wait.t0;
        const ready = !info.error && info.value !== false;
        let reason = 'prête';
        if (info.error) {
            reason = 'erreur';
        } else if (!ready) {
            const cancelled = safe(() => (wait.isCancelled ? !!wait.isCancelled() : false), false);
            if (wait.label === 'HT' && !safe(() => showHighVoltageLinesLayer, true)) reason = 'annulée : HT désactivé';
            else if (wait.label === 'Routes' && !safe(() => showRoadOverlayLayer, true)) reason = 'annulée : Routes désactivé';
            else if (cancelled) reason = 'annulée : nouvelle demande';
            else if (wait.maxWaitMs && ms >= wait.maxWaitMs - 5) reason = 'délai dépassé';
            else reason = 'non prête (tuiles en cours)';
        }
        const key = `${wait.fnName} · ${wait.label}`;
        let total = state.layerWaitTotals[key];
        if (!total) {
            total = { started: 0, ready: 0, interrupted: 0, reasons: Object.create(null), totalMs: 0, maxMs: 0, gpsFollow: 0, htOn: 0 };
            state.layerWaitTotals[key] = total;
        }
        total.started += 1;
        if (ready) total.ready += 1; else total.interrupted += 1;
        total.reasons[reason] = (total.reasons[reason] || 0) + 1;
        total.totalMs += ms;
        if (ms > total.maxMs) total.maxMs = ms;
        if (wait.gpsFollow) total.gpsFollow += 1;
        if (wait.htOn) total.htOn += 1;

        if (wait.label === 'HT' && wait.fnName !== 'restitution') {
            const eco = ecoStat();
            eco.htWaits += 1;
            if (!ready) eco.htInterrupted += 1;
            const bucket = minuteBucket(wait.t0);
            if (ready) bucket.htReady += 1; else bucket.htInterrupted += 1;
            bucket.htWaitMs += ms;
            if (ms > bucket.htWaitMax) bucket.htWaitMax = ms;
        }

        const entry = {
            t: round(wait.t0), at: wallAt(wait.t0), ms: round(ms), fnName: wait.fnName, label: wait.label,
            reason, gpsFollow: wait.gpsFollow, htOn: wait.htOn, startNear: null, endNear: null
        };
        pushCapped(state.layerWaits, entry, LIMITS.layerWaits);
        /* Corrélation classée 250 ms plus tard (recentrages postérieurs à la fin connus). */
        if (!ready && wait.label === 'HT') {
            setTimeout(() => {
                /* v17.35 — corrélation séparée : recentrages réels / simulés. */
                entry.startNear = nearGpsRecenter(wait.t0);
                entry.endNear = nearGpsRecenter(tEnd);
                entry.startNearSim = nearGpsRecenter(wait.t0, state.gpsRecenterTimesSim);
                entry.endNearSim = nearGpsRecenter(tEnd, state.gpsRecenterTimesSim);
                [
                    [state.waitCorrelation, entry.startNear, entry.endNear],
                    [state.waitCorrelationSim, entry.startNearSim, entry.endNearSim]
                ].forEach(([correlation, startNear, endNear]) => {
                    correlation.interrupted += 1;
                    if (startNear) correlation.startNear += 1;
                    if (endNear) correlation.endNear += 1;
                    if (startNear && endNear) correlation.bothNear += 1;
                });
            }, 250);
        }
    };

    /* Appelant d'une vérification des tuiles : attente(s) en cours à cet instant. */
    const currentWaitCaller = () => {
        const categories = new Set();
        state.activeWaits.forEach(wait => categories.add(wait.category));
        if (!categories.size) return 'autre (hors attente)';
        if (categories.size === 1) return categories.values().next().value;
        return 'plusieurs attentes : ' + [...categories].sort().join(' + ');
    };

    const recordTileCheck = info => {
        const ms = info.t1 - info.t0;
        const caller = info.before || 'autre (hors attente)';
        const tiles = safe(() => Object.keys(baseTileLayer?._tiles || {}).length, 0);
        const check = state.tileCheck;
        check.calls += 1;
        check.totalMs += ms;
        if (ms > check.maxMs) check.maxMs = ms;
        check.tiles += tiles;
        check.byCaller[caller] = (check.byCaller[caller] || 0) + 1;
        const second = Math.floor(info.t0 / 1000);
        if (second !== check.secondIndex) {
            check.secondIndex = second;
            check.secondCalls = 0;
        }
        check.secondCalls += 1;
        if (check.secondCalls > check.maxPerSecond) check.maxPerSecond = check.secondCalls;
        const bucket = minuteBucket(info.t0);
        bucket.checks += 1;
        bucket.checkMs += ms;
        if (ms > bucket.checkMax) bucket.checkMax = ms;
        bucket.checkTiles += tiles;
        bucket.byCaller[caller] = (bucket.byCaller[caller] || 0) + 1;
        if (isGpsFollowActive()) bucket.gpsFollow = true;
    };

    /* ---------- Recentrage économe (v17.36) ---------- */

    const ecoMode = () => {
        const periods = state.ecoPeriods;
        if (periods.length) return periods[periods.length - 1].on ? 'ON' : 'OFF';
        return safe(() => (isNpfEconomicRecenterEnabled() ? 'ON' : 'OFF'), '?');
    };

    const ecoStat = () => {
        const mode = ecoMode();
        let stat = state.ecoStats[mode];
        if (!stat) {
            stat = {
                recenters: 0, skipped: 0, blocks: 0, blockMs: 0, blockMax: 0,
                gpsCycles: 0, gpsMs: 0, gpsMax: 0, canvasCalls: 0, canvasMs: 0, canvasMax: 0,
                htWaits: 0, htInterrupted: 0
            };
            state.ecoStats[mode] = stat;
        }
        return stat;
    };

    const startEcoPeriod = (on, t = now()) => {
        const last = state.ecoPeriods[state.ecoPeriods.length - 1];
        if (last && last.end === null) {
            if (last.on === on) return;
            last.end = round(t);
            last.endAt = wallAt(t);
        }
        state.ecoPeriods.push({ on: !!on, start: round(t), startAt: wallAt(t), end: null, endAt: null });
        if (state.ecoPeriods.length > 40) state.ecoPeriods.splice(0, state.ecoPeriods.length - 40);
    };

    const economicRecenterChanged = enabled => {
        startEcoPeriod(!!enabled);
        safe(() => npfDiagSiaInteraction('RECENTRAGE ÉCONOME', enabled ? 'ON' : 'OFF', null));
    };

    const economicRecenterSkipped = shiftPx => {
        ecoStat().skipped += 1;
        const last = state.positions[state.positions.length - 1];
        if (last && !last.sim && now() - last.t < 1500 && !last.recenter) {
            last.recenter = 'évité (' + (Math.round(Number(shiftPx) * 10) / 10) + ' px < 8)';
        }
    };

    /* ---------- Gestes ---------- */

    const recordGesture = (source, metrics) => {
        const safeMetrics = metrics || {};
        const durationMs = round(safeMetrics.dureeMs);
        state.gestureCount += 1;
        state.gesturesSinceRestore += 1;
        pushCapped(state.gestures, {
            t: round(now() - durationMs),
            at: Date.now() - durationMs,
            source: String(source || 'autre'),
            ms: durationMs,
            ev: round(safeMetrics.moveEvents),
            gapAvg: round(safeMetrics.gapMoyMs),
            gapMax: round(safeMetrics.gapMaxMs),
            g100: round(safeMetrics.gaps100),
            dx: safeMetrics.deplXPct,
            dy: safeMetrics.deplYPct,
            zFrom: safeMetrics.zoomDe,
            zTo: safeMetrics.zoomA,
            ht: safeMetrics.htZone || '—',
            routes: safeMetrics.routesZone || '—',
            speedKt: getSpeedKt(),
            sim: safe(() => !!isSimulationMode, false)
        }, LIMITS.gestures);
    };

    const getMapMotionExtraMetrics = sample => {
        const out = {};
        safe(() => {
            const zoomFrom = Number(sample?.startZoom);
            const zoomTo = Number(map.getZoom());
            out.zoomDe = zoomFrom;
            out.zoomA = zoomTo;
            if (sample?.startCenter && zoomFrom === zoomTo) {
                const size = map.getSize();
                const point = map.latLngToContainerPoint(sample.startCenter);
                if (size.x > 0 && size.y > 0) {
                    out.deplXPct = Math.round((size.x / 2 - point.x) / size.x * 100);
                    out.deplYPct = Math.round((size.y / 2 - point.y) / size.y * 100);
                }
            }
        });
        out.htZone = getHtZoneState();
        out.routesZone = getRoutesZoneState();
        return out;
    };

    /* v17.32 — piste 19 : un geste est « manuel » dès qu'un contact utilisateur
     * sur la carte le précède, que le suivi GPS soit actif ou non. */
    const isUserMapContactRecent = () => (
        state.userContactActive || now() - state.userContactLastAt < 1200
    );

    const installMapHooks = () => {
        if (!map || map.__npfDiagDetailBound) return;
        map.__npfDiagDetailBound = true;

        map.on('movestart', () => { state.motionActive = true; });
        map.on('moveend', () => {
            state.motionActive = false;
            state.lastMoveEndAt = now();
        });

        const container = safe(() => map.getContainer(), null);
        if (container) {
            const ignore = event => safe(() => !!event?.target?.closest?.(
                '.leaflet-control, .leaflet-popup, button, input, textarea, select, a'
            ), false);
            ['pointerdown', 'touchstart', 'mousedown'].forEach(name => {
                container.addEventListener(name, event => {
                    if (ignore(event)) return;
                    state.userContactActive = true;
                    state.userContactLastAt = now();
                }, { passive: true, capture: true });
            });
            container.addEventListener('wheel', event => {
                if (ignore(event)) return;
                state.userContactLastAt = now();
            }, { passive: true, capture: true });
            ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach(name => {
                container.addEventListener(name, () => {
                    if (!state.userContactActive) return;
                    state.userContactActive = false;
                    state.userContactLastAt = now();
                }, { passive: true, capture: true });
            });
        }

        const originalInvalidateSize = map.invalidateSize;
        if (typeof originalInvalidateSize === 'function') {
            map.invalidateSize = function (...args) {
                const t0 = now();
                try {
                    return originalInvalidateSize.apply(this, args);
                } finally {
                    recordActivity('map.invalidateSize', t0, now(), false, {});
                }
            };
        }

        /* v17.33 — I2 : durée de chaque setView (dont les recentrages GPS). */
        const originalSetView = map.setView;
        if (typeof originalSetView === 'function') {
            map.setView = function (...args) {
                const t0 = now();
                try {
                    return originalSetView.apply(this, args);
                } finally {
                    recordActivity('map.setView', t0, now(), false, { gpsPart: true });
                }
            };
        }

        /* v17.39 — masquage / réaffichage du calque HT : observateur du style du
         * pane (aucune lecture de mise en page). */
        safe(() => {
            const htPane = map.getPane('highVoltageLinesPane');
            if (!htPane || typeof MutationObserver !== 'function') return;
            const paneVisible = () => htPane.style.display !== 'none' && htPane.style.visibility !== 'hidden';
            state.lastHtPaneVisible = paneVisible();
            new MutationObserver(() => {
                const visible = paneVisible();
                if (visible !== state.lastHtPaneVisible) {
                    state.lastHtPaneVisible = visible;
                    state.lastHtPaneToggleAt = now();
                }
            }).observe(htPane, { attributes: true, attributeFilter: ['style'] });
        });

        /* v17.33 — I8 : heure de chaque zoom, pour regrouper les lectures de tuiles. */
        map.on('zoomend', () => {
            pushCapped(state.zoomEvents, { t: now(), at: Date.now(), z: safe(() => map.getZoom(), null) }, LIMITS.zoomEvents);
        });

        /*
         * v17.33 — I3 : renderers canvas. Les méthodes sont enveloppées sur
         * l'INSTANCE avant son ajout à la carte : Leaflet capture `_update` à
         * l'ajout (moveend) et appelle `_redraw` par requestAnimationFrame.
         */
        [
            ['canvas HT', safe(() => highVoltageLinesRenderer, null)],
            ['canvas pistes', safe(() => npfRunwayRenderer, null)],
            /* v17.57 — C : un seul canvas Routes (bordures + lignes). */
            ['canvas Routes', safe(() => roadOverlayLineRenderer, null)],
            ['canvas Routes bordure', safe(() => roadOverlayCasingRenderer, null)]
        ].forEach(([label, renderer]) => {
            if (!renderer || renderer.__npfDiagWrapped) return;
            renderer.__npfDiagWrapped = true;
            ['_update', '_redraw'].forEach(method => {
                const original = renderer[method];
                if (typeof original !== 'function') return;
                const name = `${label} ${method}`;
                renderer[method] = function (...args) {
                    const t0 = now();
                    try {
                        return original.apply(this, args);
                    } finally {
                        const t1 = now();
                        if (label === 'canvas HT' && method === '_update') state.lastHtCanvasUpdateAt = t1;
                        recordActivity(name, t0, t1, false, { gpsPart: true });
                        const eco = ecoStat();
                        eco.canvasCalls += 1;
                        eco.canvasMs += t1 - t0;
                        if (t1 - t0 > eco.canvasMax) eco.canvasMax = t1 - t0;
                        const canvas = this._container;
                        if (canvas) {
                            const stat = state.fnStats.get(name);
                            if (stat) stat.info = `${canvas.width}×${canvas.height}`;
                        }
                    }
                };
            });
        });
    };

    /* ---------- Chaîne GPS (I1) ---------- */

    const startGpsCycle = args => {
        const pos = args?.[0];
        const sim = pos?.npfIsSimulation === true;
        const ignored = !sim && safe(() => !!isSimulationMode, false);
        const cycle = { t0: now(), parts: Object.create(null), done: false, sim, ignored };
        state.gpsCycle = cycle;
        return cycle;
    };

    const finishGpsCycle = info => {
        const cycle = info.before;
        if (!cycle) return;
        cycle.done = true;
        if (state.gpsCycle === cycle) state.gpsCycle = null;
        const ms = info.t1 - info.t0;
        /* v17.35 — position réelle ignorée pendant la simulation : comptée à part. */
        if (cycle.ignored) {
            state.gpsIgnoredDuringSimulation += 1;
            return;
        }
        /* v17.40 — temps du traitement GPS et du calculateur, par minute. */
        safe(() => {
            const minute = readMinuteAt(info.t0);
            minute.gpsMs += ms;
            minute.gpsN += 1;
            minute.calcMs += Number(cycle.parts.updateCalculatorData) || 0;
        });
        const gps = cycle.sim ? state.gpsSim : state.gps;
        if (!cycle.sim) {
            const eco = ecoStat();
            eco.gpsCycles += 1;
            eco.gpsMs += ms;
            if (ms > eco.gpsMax) eco.gpsMax = ms;
        }
        gps.cycles += 1;
        gps.totalMs += ms;
        if (ms > gps.maxMs) gps.maxMs = ms;
        Object.keys(cycle.parts).forEach(name => {
            let part = gps.parts.get(name);
            if (!part) {
                part = { n: 0, total: 0, max: 0 };
                gps.parts.set(name, part);
            }
            const value = cycle.parts[name];
            part.n += 1;
            part.total += value;
            if (value > part.max) part.max = value;
        });
        if (gps.slowest.length < LIMITS.gpsSlowCycles || ms > gps.slowest[gps.slowest.length - 1].ms) {
            gps.slowest.push({
                t: round(info.t0),
                at: wallAt(info.t0),
                ms: round(ms),
                sim: cycle.sim,
                speedKt: getSpeedKt(),
                parts: Object.keys(cycle.parts)
                    .sort((a, b) => cycle.parts[b] - cycle.parts[a])
                    .slice(0, 8)
                    .map(name => `${name} ${round(cycle.parts[name])}`)
                    .join(' · ')
            });
            gps.slowest.sort((a, b) => b.ms - a.ms);
            if (gps.slowest.length > LIMITS.gpsSlowCycles) gps.slowest.length = LIMITS.gpsSlowCycles;
        }
    };

    /* ---------- Lectures de tuiles (I8) et packs (I9) ---------- */

    const getPackKey = () => safe(() => (
        Array.isArray(activeOfflinePacks) && activeOfflinePacks.length
            ? activeOfflinePacks.join(', ')
            : (offlineTilesMode ? 'OFFLINE sans pack' : 'ONLINE')
    ), '?');

    const tileBin = ms => {
        let index = 0;
        while (index < TILE_MS_BINS.length && ms >= TILE_MS_BINS[index]) index += 1;
        return index;
    };

    const tileLookupStart = (coords, options) => {
        const t0 = now();
        const queuedAt = Number(options?.queuedAt);
        return {
            t0,
            z: Number(coords?.z),
            wait: Number.isFinite(queuedAt) ? t0 - queuedAt : null,
            reads: 0, opens: 0, readTimeouts: 0, openTimeouts: 0, readErrors: 0, openErrors: 0,
            hintDb: '', dbCandidates: 0, urlCandidates: 0,
            pack: state.packKey || getPackKey(),
            done: false
        };
    };

    const tileLookupError = (lookup, error, phase) => {
        if (!lookup) return;
        const timeout = /^Timeout/i.test(String(error?.message || ''));
        if (phase === 'ouverture') {
            if (timeout) lookup.openTimeouts += 1; else lookup.openErrors += 1;
        } else if (timeout) {
            lookup.readTimeouts += 1;
        } else {
            lookup.readErrors += 1;
        }
    };

    /* v17.39 — lectures réelles du pack (IndexedDB) : premières lectures,
     * synthèse par minute, paquets lents. */
    const layerStateNow = () => ({
        ht: !!safe(() => showHighVoltageLinesLayer, false),
        routes: !!safe(() => showRoadOverlayLayer, false)
    });
    const readMinuteAt = t => {
        const index = Math.floor(t / 60000);
        let minute = state.readMinutes.get(index);
        if (!minute) {
            minute = {
                index, at: wallAt(index * 60000), durations: [], n: 0, max: 0,
                htOn: false, htOff: false, routesOn: false, routesOff: false,
                gpsMs: 0, gpsN: 0, calcMs: 0,
                lateN: 0, lateMax: 0, refMs: null,
                stW: 0, stWMax: 0, stR: 0, stRMax: 0, stC: 0, stCMax: 0, stLs: 0, stLsMs: 0,
                /* v17.43 — carte lue et forme des images. */
                map: null, mapMixed: false, fmBlob: 0, fmRaw: 0
            };
            state.readMinutes.set(index, minute);
            if (state.readMinutes.size > 60) state.readMinutes.delete(state.readMinutes.keys().next().value);
        }
        return minute;
    };

    /* v17.43 — nom court de la carte active (groupe du premier fichier). */
    const currentMapShortName = () => safe(() => (
        Array.isArray(activeOfflinePacks) && activeOfflinePacks.length
            ? String(getOfflinePackGroupName(activeOfflinePacks[0])).slice(0, 40)
            : (offlineTilesMode ? 'OFFLINE sans pack' : 'ONLINE')
    ), '?');

    const notePackRead = (outcome, ms) => {
        if (outcome !== 'trouvée' && outcome !== 'absente' && outcome !== 'erreur-technique') return;
        const t = now();
        const layers = layerStateNow();
        const mapName = currentMapShortName();
        const form = outcome === 'trouvée' ? state.lastReadForm : null;
        if (state.firstPackReads.length < 20) {
            state.firstPackReads.push({ ms: round(ms), ht: layers.ht, routes: layers.routes });
        }
        const minute = readMinuteAt(t);
        minute.n += 1;
        if (minute.map === null) minute.map = mapName;
        else if (minute.map !== mapName) minute.mapMixed = true;
        if (form === 'Blob') minute.fmBlob += 1;
        else if (form === 'brut') minute.fmRaw += 1;
        if (minute.durations.length < 600) minute.durations.push(round(ms));
        if (ms > minute.max) minute.max = round(ms);
        if (layers.ht) minute.htOn = true; else minute.htOff = true;
        if (layers.routes) minute.routesOn = true; else minute.routesOff = true;
        if (ms > 1000) {
            const last = state.slowReadBatches[state.slowReadBatches.length - 1];
            if (last && Math.abs(t - last.endT) < 80) {
                last.n += 1;
                if (ms > last.maxMs) last.maxMs = round(ms);
            } else {
                const since = at => (at === null ? null : round(t - at));
                pushCapped(state.slowReadBatches, {
                    at: Date.now(), endT: t, n: 1, maxMs: round(ms), ht: layers.ht, routes: layers.routes,
                    map: mapName, form,
                    sinceHtCanvasUpdate: since(state.lastHtCanvasUpdateAt),
                    sinceHtPaneToggle: since(state.lastHtPaneToggleAt),
                    htPaneVisible: state.lastHtPaneVisible
                }, 30);
            }
        }
    };

    /* v17.41 — lectures ayant dépassé leur délai (5,2 s fond NPF-Q400, 1,8 s
     * autres fonds) et qui continuent en arrière-plan. Mesure seule, sans
     * minuterie : le décompte est fait au début et à la fin de chaque lecture. */
    const noteLatePackReads = t => {
        let late = 0;
        state.pendingPackReads.forEach(entry => {
            if (t - entry.t0 > entry.limit) late += 1;
        });
        if (!late) return;
        const minute = readMinuteAt(t);
        if (late > minute.lateMax) minute.lateMax = late;
        if (late > state.lateReads.maxSimultaneous) state.lateReads.maxSimultaneous = late;
    };
    const packReadStart = args => {
        const t = now();
        const id = ++state.pendingPackReadSeq;
        if (state.pendingPackReads.size >= 200) {
            state.pendingPackReads.delete(state.pendingPackReads.keys().next().value);
        }
        state.pendingPackReads.set(id, {
            t0: t,
            limit: safe(() => isNpfOfflinePackSelection(), false) ? 5200 : 1800,
            db: args?.[0] || null,
            tileUrl: String(args?.[1] || '')
        });
        noteLatePackReads(t);
        return id;
    };
    const packReadEnd = (id, info) => {
        /* v17.43 — forme de l'image lue : Blob ou données brutes (ArrayBuffer). */
        const tile = info && !info.error ? info.value?.tile : null;
        state.lastReadForm = tile ? (tile instanceof Blob ? 'Blob' : 'brut') : null;
        const entry = state.pendingPackReads.get(id);
        if (!entry) return;
        const t = now();
        noteLatePackReads(t);
        state.pendingPackReads.delete(id);
        if (t - entry.t0 > entry.limit) {
            state.lateReads.total += 1;
            readMinuteAt(t).lateN += 1;
        }
        /* v17.42 — lecture de plus de 1 s : une sonde est demandée. */
        if (t - entry.t0 > 1000) requestPackProbe(entry.db, entry.tileUrl, t - entry.t0);
    };

    /* v17.42 — sonde après un paquet lent : sur une tuile voisine (12 tuiles
     * plus à l'est, donc pas encore lue), chronométrer séparément la recherche
     * dans l'index, la lecture de l'image, puis la méthode actuelle sur une
     * autre tuile et sur la même tuile relue. Lancée seulement hors geste,
     * lecteur au repos, au plus une par minute et 12 par session. Elle utilise
     * sa propre transaction en lecture seule : la file et les 5 lectures du
     * moteur ne sont pas touchées. */
    const PACK_PROBE_LIMIT = 12;
    const PACK_PROBE_MIN_GAP_MS = 60000;
    const round1 = value => Math.round((Number(value) || 0) * 10) / 10;
    const requestPackProbe = (db, tileUrl, slowMs) => {
        if (!db || !tileUrl || state.probePending) return;
        if (state.packProbes.length >= PACK_PROBE_LIMIT) return;
        if (state.probeLastAt !== null && now() - state.probeLastAt < PACK_PROBE_MIN_GAP_MS) return;
        state.probePending = { db, tileUrl, slowMs: round(slowMs), tries: 0 };
        setTimeout(tryPackProbe, 2500);
    };
    const tryPackProbe = () => {
        const pending = state.probePending;
        if (!pending) return;
        const busy = document.visibilityState === 'hidden'
            || safe(() => !!npfMapManualGestureLockActive, false)
            || safe(() => !!centerGpsFollowUserGestureActive, false)
            || safe(() => Number(directOfflineNpfActiveReads) > 0, false)
            || safe(() => directOfflineNpfReadQueue.length > 0, false)
            || state.pendingPackReads.size > 0;
        if (busy) {
            pending.tries += 1;
            if (pending.tries > 8) {
                state.probePending = null;
                state.probeDropped += 1;
                return;
            }
            setTimeout(tryPackProbe, 2500);
            return;
        }
        state.probePending = null;
        state.probeLastAt = now();
        safe(() => runPackProbe(pending));
    };
    const runPackProbe = pending => {
        const match = /^(.*\/)(\d+)\/(\d+)\/(\d+)(\.\w+)$/.exec(pending.tileUrl);
        if (!match) return;
        const z = Number(match[2]);
        const x = Number(match[3]) + 12;
        const y = Number(match[4]);
        const urlA = match[1] + z + '/' + x + '/' + y + match[5];
        const urlB = match[1] + z + '/' + x + '/' + (y + 3) + match[5];
        /*
         * v17.43 — ordre des mesures :
         * 1. normalMs : méthode normale de l'app (curseur sur l'index) sur la
         *    tuile A, jamais lue — seule mesure comparable à une lecture normale ;
         * 2. indexMs  : index seul (sans l'image) sur la tuile B ;
         * 3. directMs : accès direct par la clé sur la tuile B — l'app ne lit
         *    jamais ainsi, non comparable ;
         * 4. warmMs   : méthode normale sur la tuile A relue.
         */
        const entry = {
            at: Date.now(), slowMs: pending.slowMs, z, v: 2,
            map: currentMapShortName(), form: null,
            normalMs: null, normalFound: null, size: null,
            indexMs: null, directMs: null, found: null,
            warmMs: null, error: null
        };
        let finished = false;
        const finish = error => {
            if (finished) return;
            finished = true;
            clearTimeout(guard);
            if (error) entry.error = String(error?.message || error || 'erreur').slice(0, 60);
            pushCapped(state.packProbes, entry, PACK_PROBE_LIMIT);
        };
        const guard = setTimeout(() => finish('sans réponse après 20 s'), 20000);
        const cursorRead = (url, done) => {
            const t0 = now();
            const request = pending.db.transaction('tiles', 'readonly')
                .objectStore('tiles').index('tileUrl').openCursor(IDBKeyRange.only(url));
            request.onsuccess = () => done(round1(now() - t0), request.result ? request.result.value : null);
            request.onerror = () => finish(request.error);
        };
        const indexThenDirect = done => {
            const store = pending.db.transaction('tiles', 'readonly').objectStore('tiles');
            const t0 = now();
            const keyRequest = store.index('tileUrl').getKey(urlB);
            keyRequest.onerror = () => finish(keyRequest.error);
            keyRequest.onsuccess = () => {
                entry.indexMs = round1(now() - t0);
                const primaryKey = keyRequest.result;
                entry.found = primaryKey !== undefined;
                if (primaryKey === undefined) {
                    done();
                    return;
                }
                const t1 = now();
                const valueRequest = store.get(primaryKey);
                valueRequest.onerror = () => finish(valueRequest.error);
                valueRequest.onsuccess = () => {
                    entry.directMs = round1(now() - t1);
                    done();
                };
            };
        };
        try {
            cursorRead(urlA, (ms, record) => {
                entry.normalMs = ms;
                entry.normalFound = !!record;
                const tile = record?.tile;
                if (tile) {
                    entry.form = tile instanceof Blob ? 'Blob' : 'brut';
                    entry.size = Number(tile.size ?? tile.byteLength ?? 0) || null;
                }
                safe(() => indexThenDirect(() => safe(() => cursorRead(urlA, warmMs => {
                    entry.warmMs = warmMs;
                    finish();
                }))));
            });
        } catch (error) {
            finish(error);
        }
    };

    /* v17.42 — activité de stockage. Les lectures du pack (déjà mesurées) ne
     * sont pas comptées ici. Écritures consécutives sur la même base en moins
     * de 1 s : une seule ligne avec leur nombre. */
    const noteStorageEvent = (kind, name, ms) => {
        const label = String(name || '—').slice(0, 60);
        const last = state.storageEvents[state.storageEvents.length - 1];
        const at = Date.now();
        if (last && last.kind === kind && last.name === label && at - last.at < 1000) {
            last.n += 1;
            if (ms !== null && ms > (last.ms || 0)) last.ms = round(ms);
            return;
        }
        pushCapped(state.storageEvents, { at, kind, name: label, ms: ms === null ? null : round(ms), n: 1 }, 80);
    };
    const installStorageProbes = () => {
        if (typeof IDBFactory !== 'undefined' && !IDBFactory.prototype.__npfDiagStorage) {
            const originalOpen = IDBFactory.prototype.open;
            IDBFactory.prototype.open = function (name) {
                const request = originalOpen.apply(this, arguments);
                safe(() => {
                    const t0 = now();
                    request.addEventListener('success', () => {
                        noteStorageEvent('ouverture', name, now() - t0);
                        safe(() => {
                            const opened = request.result;
                            opened.addEventListener('versionchange', () => noteStorageEvent('changement de version', name, null));
                            opened.addEventListener('close', () => noteStorageEvent('connexion perdue', name, null));
                        });
                    });
                    request.addEventListener('error', () => noteStorageEvent('ouverture en erreur', name, now() - t0));
                    request.addEventListener('blocked', () => noteStorageEvent('ouverture bloquée', name, now() - t0));
                    request.addEventListener('upgradeneeded', () => noteStorageEvent('mise à niveau', name, now() - t0));
                });
                return request;
            };
            IDBFactory.prototype.__npfDiagStorage = true;

            const originalClose = IDBDatabase.prototype.close;
            IDBDatabase.prototype.close = function () {
                safe(() => noteStorageEvent('fermeture', this.name, null));
                return originalClose.apply(this, arguments);
            };

            const originalTransaction = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function (storeNames, mode) {
                const transaction = originalTransaction.apply(this, arguments);
                safe(() => {
                    const write = mode === 'readwrite';
                    const name = String(this.name || '');
                    if (!write && name.indexOf('OfflineMap_') === 0) return;
                    const t0 = now();
                    let done = false;
                    const end = () => {
                        if (done) return;
                        done = true;
                        const ms = now() - t0;
                        const minute = readMinuteAt(t0);
                        if (write) {
                            minute.stW += 1;
                            if (ms > minute.stWMax) minute.stWMax = round(ms);
                            noteStorageEvent('écriture', name + ' / ' + [].concat(storeNames).join(','), ms);
                        } else {
                            minute.stR += 1;
                            if (ms > minute.stRMax) minute.stRMax = round(ms);
                        }
                    };
                    transaction.addEventListener('complete', end);
                    transaction.addEventListener('abort', end);
                });
                return transaction;
            };
        }

        const timePromise = (target, method) => {
            const original = target && target[method];
            if (typeof original !== 'function') return;
            target[method] = function () {
                const result = original.apply(this, arguments);
                safe(() => {
                    const t0 = now();
                    const end = () => {
                        const ms = now() - t0;
                        const minute = readMinuteAt(t0);
                        minute.stC += 1;
                        if (ms > minute.stCMax) minute.stCMax = round(ms);
                    };
                    result.then(end, end);
                });
                return result;
            };
        };
        if (typeof CacheStorage !== 'undefined' && !CacheStorage.prototype.__npfDiagStorage) {
            timePromise(CacheStorage.prototype, 'match');
            timePromise(CacheStorage.prototype, 'open');
            if (typeof Cache !== 'undefined') timePromise(Cache.prototype, 'match');
            CacheStorage.prototype.__npfDiagStorage = true;
        }

        if (typeof Storage !== 'undefined' && !Storage.prototype.__npfDiagStorage) {
            const originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function () {
                const t0 = now();
                try {
                    return originalSetItem.apply(this, arguments);
                } finally {
                    safe(() => {
                        if (this !== window.localStorage) return;
                        const minute = readMinuteAt(t0);
                        minute.stLs += 1;
                        minute.stLsMs += now() - t0;
                    });
                }
            };
            Storage.prototype.__npfDiagStorage = true;
        }
    };

    /* v17.41 — « référence iPad » : petit calcul toujours identique (entiers,
     * sans DOM, sans stockage, sans allocation), chronométré une fois par
     * minute hors geste et après le démarrage principal. Sa durée sert de
     * thermomètre indirect : elle augmente quand l'iPad bride son processeur. */
    const REFERENCE_ITERATIONS = 500000;
    let referenceCoreReady = false;
    const runReferenceComputation = () => {
        let x = 0x2545F491;
        let acc = 0;
        for (let i = 0; i < REFERENCE_ITERATIONS; i += 1) {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            acc = (acc + (x & 0xffff)) | 0;
        }
        return acc;
    };
    const sampleReference = () => {
        if (document.visibilityState === 'hidden') return;
        if (!referenceCoreReady) {
            referenceCoreReady = NPF_STARTUP_DIAGNOSTIC.state.marks.some(entry => entry.key === 'core_ready');
            if (!referenceCoreReady) return;
        }
        if (
            safe(() => !!npfMapManualGestureLockActive, false)
            || safe(() => !!centerGpsFollowUserGestureActive, false)
        ) {
            state.refStats.skipped += 1;
            return;
        }
        /* Une mesure par ligne « par minute » : rien si la minute en a déjà une. */
        const minute = readMinuteAt(now());
        if (minute.refMs !== null) return;
        const t0 = now();
        runReferenceComputation();
        const ms = Math.round((now() - t0) * 10) / 10;
        minute.refMs = ms;
        const stats = state.refStats;
        stats.n += 1;
        stats.totalMs += ms;
        if (ms > stats.maxMs) stats.maxMs = ms;
        pushCapped(state.refDurations, ms, 600);
    };

    const tileLookupEnd = (lookup, outcome, dbName) => {
        if (!lookup || lookup.done) return;
        lookup.done = true;
        const ms = now() - lookup.t0;
        const tiles = state.tiles;
        tiles.n += 1;
        tiles.byOutcome[outcome] = (tiles.byOutcome[outcome] || 0) + 1;
        tiles.histo[tileBin(ms)] += 1;
        if (lookup.wait !== null) {
            tiles.waitHisto[tileBin(lookup.wait)] += 1;
            tiles.waitCount += 1;
            if (lookup.wait > tiles.maxWait) tiles.maxWait = lookup.wait;
        }
        tiles.reads += lookup.reads;
        tiles.opens += lookup.opens;
        tiles.readTimeouts += lookup.readTimeouts;
        tiles.openTimeouts += lookup.openTimeouts;
        tiles.readErrors += lookup.readErrors;
        tiles.openErrors += lookup.openErrors;
        if (ms > tiles.maxMs) tiles.maxMs = ms;
        if (outcome === 'trouvée') {
            tiles.foundCount += 1;
            tiles.foundReads += lookup.reads;
            if (lookup.reads > tiles.maxFoundReads) tiles.maxFoundReads = lookup.reads;
            if (lookup.opens > 1) tiles.foundAfterFirstDb += 1;
            if (lookup.hintDb) {
                tiles.hintUsed += 1;
                if (dbName && dbName !== lookup.hintDb) tiles.hintMiss += 1;
            }
        }
        let pack = tiles.perPack[lookup.pack];
        if (!pack) {
            pack = { n: 0, found: 0, absent: 0, totalMs: 0, maxMs: 0, timeouts: 0 };
            tiles.perPack[lookup.pack] = pack;
        }
        pack.n += 1;
        if (outcome === 'trouvée') pack.found += 1;
        if (outcome === 'absente') pack.absent += 1;
        pack.totalMs += ms;
        if (ms > pack.maxMs) pack.maxMs = ms;
        pack.timeouts += lookup.readTimeouts + lookup.openTimeouts;

        const compact = {
            t: round(lookup.t0),
            z: lookup.z,
            ms: round(ms),
            wait: lookup.wait === null ? null : round(lookup.wait),
            reads: lookup.reads,
            opens: lookup.opens,
            timeouts: lookup.readTimeouts + lookup.openTimeouts,
            errors: lookup.readErrors + lookup.openErrors,
            outcome,
            hintMiss: !!(outcome === 'trouvée' && lookup.hintDb && dbName && dbName !== lookup.hintDb)
        };
        pushCapped(tiles.recent, compact, LIMITS.tileLookups);
        notePackRead(outcome, ms);
        const slowest = tiles.slowest;
        if (slowest.length < LIMITS.tileSlowest || compact.ms > slowest[slowest.length - 1].ms) {
            slowest.push({ ...compact, at: wallAt(lookup.t0) });
            slowest.sort((a, b) => b.ms - a.ms);
            if (slowest.length > LIMITS.tileSlowest) slowest.length = LIMITS.tileSlowest;
        }
    };

    const tileCounters = () => safe(() => ({
        trouvees: Number(directOfflineTileHitCount || 0),
        absentes: Number(directOfflineTileMissCount || 0),
        accesIdbNpf: Number(directOfflineNpfIndexedDbLookupCount || 0),
        hitsRamNpf: Number(directOfflineNpfMainRamHitCount || 0),
        fileAbandonnees: Number(directOfflineNpfQueuedDiscardCount || 0),
        obsoletes: Number(directOfflineNpfAbortedReadCount || 0),
        reprises: Number(directOfflineNpfTileRetryCount || 0)
    }), {});

    /* v17.33 — I9 : changement de pack détecté par simple comparaison (1 s). */
    const watchPackChanges = () => {
        const check = () => {
            const key = getPackKey();
            if (key !== state.packKey) {
                const previous = state.packKey;
                state.packKey = key;
                const counters = tileCounters();
                pushCapped(state.packChanges, {
                    t: round(now()),
                    at: Date.now(),
                    from: previous,
                    to: key,
                    counters
                }, LIMITS.packChanges);
                safe(() => npfDiagSiaInteraction(
                    'PACK CARTE',
                    previous === null ? `initial : ${key}` : `de « ${previous} » à « ${key} »`,
                    counters
                ));
            }
        };
        /* Premier relevé après le chargement des réglages (pack mémorisé). */
        setTimeout(() => {
            check();
            setInterval(check, 1000);
        }, 3000);
    };

    /* ---------- Restitutions ---------- */

    const finishRestore = (ctx, info) => {
        ctx.tEnd = info.tEnd;
        const cancelled = safe(() => (
            ctx.token !== npfMapOverlayPriorityToken || npfMapOverlayPriorityActive
        ), false);
        /* Fin VFR = début HT (ou Routes) ; fin HT = début Routes. */
        let vfrMs = null;
        let htMs = null;
        let routesMs = null;
        if (ctx.tTiles != null) {
            const vfrEnd = ctx.tHtStart ?? ctx.tRoutesStart ?? ctx.tVfr ?? ctx.tEnd;
            const htEnd = ctx.tHt ?? ctx.tRoutesStart ?? (ctx.tHtStart != null ? ctx.tEnd : vfrEnd);
            vfrMs = round(vfrEnd - ctx.tTiles);
            htMs = round(htEnd - vfrEnd);
            routesMs = round(ctx.tEnd - htEnd);
        }
        if (!ctx.routes && safe(() => showRoadOverlayLayer && getRoadOverlayZoomTier() === 0, false)) {
            ctx.routes = 'niveau 0';
        }
        const entry = {
            t: round(ctx.t0),
            at: wallAt(ctx.t0),
            reason: String(ctx.reason || ''),
            gestures: ctx.gestures,
            sinceMoveEnd: ctx.sinceMoveEnd,
            totalMs: round(ctx.tEnd - ctx.t0),
            tilesMs: ctx.tTiles != null ? round(ctx.tTiles - ctx.t0) : round(ctx.tEnd - ctx.t0),
            vfrMs,
            htMs,
            routesMs,
            ht: ctx.ht || (safe(() => showHighVoltageLinesLayer, false) ? '—' : 'OFF'),
            routes: ctx.routes || (safe(() => showRoadOverlayLayer, false) ? '—' : 'OFF'),
            outcome: cancelled
                ? `annulée pendant ${getRestoreStageName(ctx)}`
                : 'terminée'
        };
        state.restoreCount += 1;
        pushCapped(state.restores, entry, LIMITS.restores);
        if (state.currentRestore === ctx) state.currentRestore = null;
        if (!cancelled) scheduleCanvasMemorySample('après restitution', 300);
    };

    const restoreOf = token => {
        const ctx = state.currentRestore;
        return ctx && ctx.token === token ? ctx : null;
    };

    /* ---------- HT ---------- */

    const finishHt = info => {
        const before = info.before || {};
        state.htInProgress = false;
        const layerAfter = safe(() => highVoltageLinesRenderedGeoJsonLayer, null);
        const source = String(info.args?.[0] || 'refresh');
        let decision;
        if (!safe(() => showHighVoltageLinesLayer, false)) decision = 'OFF';
        else if (safe(() => highVoltageLinesScaleSuppressed, false)) decision = 'masqué 50 NM';
        else if (layerAfter !== before.layer) decision = layerAfter ? 'reconstruit' : 'vidé';
        else if (safe(() => highVoltageLinesRefreshToken, 0) !== before.token + 1) decision = 'interrompu';
        else decision = 'inchangé';

        if (decision === 'reconstruit') state.htRenderedZoomBand = before.band;
        if (decision === 'OFF' || (decision === 'inchangé' && info.tEnd - info.t0 < 1)) return;

        const wait = state.lastWaitByLabel.HT;
        const waitMs = wait && wait.t0 >= info.t0 ? round(wait.tEnd - wait.t0) : 0;
        const workMs = wait && wait.t0 >= info.t0 ? round(info.tEnd - wait.tEnd) : round(info.tEnd - info.t0);
        const reason = decision === 'reconstruit'
            ? `toujours reconstruit · réutilisable=${before.reusable ? 'oui' : 'non'}`
            : '';
        state.htCount += 1;
        pushCapped(state.htRebuilds, {
            t: round(info.t0),
            at: wallAt(info.t0),
            source,
            zoom: before.zoom,
            decision,
            reason,
            waitMs,
            workMs,
            totalMs: round(info.tEnd - info.t0),
            rendered: safe(() => Number(highVoltageLinesRenderedFeatureCount || 0), 0)
        }, LIMITS.ht);

        const ctx = state.currentRestore;
        if (ctx && source.startsWith('overlay-priority')) {
            ctx.tHt = info.tEnd;
            ctx.ht = decision + (reason ? ` (${reason})` : '');
        }
    };

    /* ---------- Routes ---------- */

    const startRoutes = args => {
        const ctx = {
            source: String(args?.[0] || 'refresh'),
            t0: now(),
            token: safe(() => roadOverlayRefreshToken, 0),
            tier: safe(() => getRoadOverlayZoomTier(), null),
            loadedTier: safe(() => roadOverlayLoadedZoomTier, null),
            coverageValid: safe(() => isRoadOverlayCoverageValidForCurrentView(), false),
            hadParts: safe(() => loadedRoadOverlayParts.size > 0, false),
            readMs: 0, readParts: 0, worksetParts: 0, ram: 0, storage: 0, cells: 0,
            filterMs: 0, buildMs: 0, labelsMs: 0, clearMs: 0, loadParts: 0, cleared: false
        };
        state.currentRoutes = ctx;
        const restore = state.currentRestore;
        if (restore && ctx.source.startsWith('overlay-priority') && restore.tRoutesStart == null) {
            restore.tRoutesStart = ctx.t0;
        }
        return ctx;
    };

    const finishRoutes = info => {
        const ctx = info.before;
        if (!ctx) return;
        const t1 = info.tEnd;
        ctx.tEnd = t1;
        const interrupted = safe(() => roadOverlayRefreshToken, 0) !== ctx.token + 1;
        const wait = state.lastWaitByLabel.Routes;
        const waitMs = wait && wait.t0 >= ctx.t0 ? round(wait.tEnd - wait.t0) : 0;
        const tileWaitFailed = !!(wait && wait.t0 >= ctx.t0 && !wait.ok);
        let decision;
        let reason = '';
        if (!safe(() => showRoadOverlayLayer, false)) decision = 'OFF';
        else if (ctx.tier === 0) decision = ctx.hadParts || ctx.cleared ? 'niveau 0 : vidé' : 'niveau 0';
        else if (ctx.loadParts > 0 || ctx.cleared) {
            decision = interrupted ? 'reconstruction interrompue' : 'reconstruit';
            if (ctx.tier !== ctx.loadedTier) reason = 'changement de niveau';
            else if (!ctx.coverageValid) reason = 'sortie de couverture';
            else if (ctx.source !== 'map-change') reason = `forcé (${ctx.source})`;
            else reason = 'sources non couvrantes';
        } else if (tileWaitFailed) decision = 'reporté (tuiles)';
        else if (interrupted) decision = 'interrompu';
        else decision = ctx.labelsMs > 0 ? 'réutilisé (cartouches refaits)' : 'réutilisé (couverture valide)';

        if (state.currentRoutes === ctx) state.currentRoutes = null;
        if (decision === 'OFF') return;
        if (decision === 'niveau 0' && t1 - ctx.t0 < 1) return;

        state.routesCount += 1;
        pushCapped(state.routesRebuilds, {
            t: round(ctx.t0),
            at: wallAt(ctx.t0),
            source: ctx.source,
            tier: ctx.tier,
            decision,
            reason,
            waitMs,
            readMs: round(ctx.readMs),
            readParts: ctx.readParts,
            worksetParts: ctx.worksetParts,
            cells: ctx.cells,
            ram: ctx.ram,
            storage: ctx.storage,
            filterMs: round(ctx.filterMs),
            buildMs: round(ctx.buildMs),
            labelsMs: round(ctx.labelsMs),
            clearMs: round(ctx.clearMs),
            totalMs: round(t1 - ctx.t0),
            rendered: safe(() => getNpfRenderedRoadFeatureCount(), 0)
        }, LIMITS.routes);

        const restore = state.currentRestore;
        if (restore && ctx.source.startsWith('overlay-priority')) {
            restore.routes = decision + (reason ? ` (${reason})` : '');
        }
    };

    /* ---------- Cache des cellules Routes ---------- */

    const estimateCellBytes = payload => {
        let bytes = 200;
        const entries = Array.isArray(payload?.e) ? payload.e : [];
        for (let index = 0; index < entries.length; index += 1) {
            const geometry = entries[index]?.[2]?.geometry;
            const coordinates = geometry?.coordinates;
            let points = 0;
            let lines = 0;
            if (geometry?.type === 'LineString' && Array.isArray(coordinates)) {
                points = coordinates.length;
                lines = 1;
            } else if (geometry?.type === 'MultiLineString' && Array.isArray(coordinates)) {
                coordinates.forEach(line => {
                    points += Array.isArray(line) ? line.length : 0;
                    lines += 1;
                });
            }
            /* Estimation : entrée + emprise + objet feature/propriétés + points. */
            bytes += 64 + 72 + 240 + points * 48 + lines * 32;
        }
        return bytes;
    };

    const refreshCellBytes = () => {
        const ram = safe(() => roadOverlaySpatialCellRam, null);
        if (!ram) return;
        let total = 0;
        state.cellBytesByKey.forEach((bytes, key) => {
            if (!ram.has(key)) {
                state.cellBytesByKey.delete(key);
                return;
            }
            total += bytes;
        });
        const cache = state.cellCache;
        cache.estimatedBytes = total;
        if (total > cache.peakBytes) cache.peakBytes = total;
        cache.peakCells = Math.max(cache.peakCells, ram.size);
    };

    /* ---------- Repères utilisateur ---------- */

    const addMarker = () => {
        const t = now();
        const context = describeWindow(t - 1000, t);
        const entry = {
            n: state.markers.length + 1,
            t: round(t),
            at: Date.now(),
            ...context
        };
        pushCapped(state.markers, entry, LIMITS.markers);
        safe(() => npfDiagSiaInteraction('REPÈRE UTILISATEUR', `n°${entry.n} · ${context.state}`, null));
        return entry;
    };

    /* ---------- Installation des enveloppes ---------- */

    const installWrappers = () => {
        const simple = [
            'loadCommunesData', 'drawPermanentAirportMarkers',
            'applyPelicanVisualScale', 'setupGpsResumeHandlers', 'primeGpsFromStoredPosition',
            'requestOneShotGps', 'restartLiveGpsWatch', 'displayCommuneDetails',
            'drawNpfRunwayMapLayer', 'drawFireHistoryMarkers', 'redrawGaarCircuits',
            'initializeTeamChat', 'initializeSiaSystem', 'ensureCommunesLayerDataLoaded',
            'loadCommunesAliases', 'displayInstalledMaps', 'initDB',
            'reconcileVacInstalledIndexFromDb', 'checkVacUpdatesAtStartup', 'refreshUI',
            'refreshBriefingDocMapButtons', 'reconcileNpfNotamsCoverageFromLocalRecord',
            'drawWaterPointMarkersForCommune', 'refreshNearestCommuneDisplayFromKnownGps',
            'refreshAirportOperationalLabels', 'renderVisibleCommuneLayers',
            'renderVisibleCommuneLabels', 'refreshSiaLayers', 'loadHighVoltageLinesLayerData',
            'toggleHighVoltageLinesLayer', 'toggleRoadOverlayLayer',
            'suppressHighVoltageLinesForWideScale', 'clearRoadOverlayRenderedPartsProgressively'
        ];
        simple.forEach(name => wrapGlobal(name));

        /* v17.33 — I6 : sonde de mise en page avant / après setupEventListeners
         * (démarrage uniquement, une fois). */
        const probeLayout = () => {
            const t0 = now();
            safe(() => document.body.offsetHeight);
            return round(now() - t0);
        };
        wrapGlobal('setupEventListeners', {
            before: () => {
                if (state.layoutProbe) return null;
                return {
                    beforeMs: probeLayout(),
                    domCount: safe(() => document.getElementsByTagName('*').length, 0)
                };
            },
            after: info => {
                if (!info.before || state.layoutProbe) return;
                state.layoutProbe = {
                    t: round(info.t0),
                    beforeMs: info.before.beforeMs,
                    listenersMs: round(info.t1 - info.t0),
                    afterMs: probeLayout(),
                    domCount: info.before.domCount,
                    domCountAfter: safe(() => document.getElementsByTagName('*').length, 0)
                };
            }
        });

        /* v17.38 — requêtes NAS : heure, action, durée, code de réponse. */
        const pushLimited = (list, entry, max) => {
            list.push(entry);
            if (list.length > max) list.splice(0, list.length - max);
        };
        const noteNasRequest = (service, action, t0, tEnd, value, error) => pushLimited(state.nasRequests, {
            at: wallAt(t0),
            service,
            action: String(action || '—').slice(0, 30),
            ms: round(tEnd - t0),
            status: value && typeof value.status === 'number' ? value.status : 0,
            error: error
                ? String(error.name === 'AbortError' ? 'délai dépassé' : (error.message || error)).slice(0, 90)
                : ''
        }, 30);
        wrapGlobal('fetchBriefingDocsNas', {
            after: ({ args, t0, tEnd, value, error }) => {
                const action = safe(() => new URL(String(args[0]), window.location.href).searchParams.get('action'), '?');
                noteNasRequest('FdS/BFG', action, t0, tEnd, value, error);
            }
        });
        wrapGlobal('fetchGlobalLinkNas', {
            after: ({ args, t0, tEnd, value, error }) => noteNasRequest('Trafic Moyens Nationaux', args[0], t0, tEnd, value, error)
        });

        /* v17.38 — temps ressenti : appui GLR -> code affiché, appui FdS ->
         * document affiché ou message. */
        const noteFelt = (kind, result, ms, extra = {}) => pushLimited(state.felt, {
            at: Date.now(), kind, result: String(result || '').slice(0, 200), ms: round(ms), ...extra
        }, 20);
        wrapGlobal('handleGlobalLinkButtonClick', {
            before: () => {
                state.glrClickAt = now();
                state.glrClickCaptcha = false;
            },
            after: ({ t0, tEnd, error }) => {
                if (state.glrClickCaptcha) return;
                const enabled = safe(() => npfGlobalLinkEnabled, false);
                noteFelt('Trafic Moyens Nationaux', error
                    ? 'erreur : ' + String(error.message || error)
                    : (enabled ? 'Trafic Moyens Nationaux ON (positions demandées)' : 'Trafic Moyens Nationaux OFF'), tEnd - t0);
            }
        });
        wrapGlobal('loadGlobalLinkCaptcha', {
            after: ({ t0, tEnd, error }) => {
                const clickAt = state.glrClickAt;
                const fromClick = clickAt && t0 - clickAt < 120000;
                if (fromClick) state.glrClickCaptcha = true;
                state.glrClickAt = 0;
                noteFelt('Trafic Moyens Nationaux', error ? 'code non affiché : ' + String(error.message || error) : 'code affiché',
                    fromClick ? tEnd - clickAt : tEnd - t0,
                    { captchaMs: round(tEnd - t0), fromClick: !!fromClick });
            }
        });
        wrapGlobal('handleBriefingDocMapButtonClick', {
            before: args => {
                state.fdsClick = { t0: now(), type: String(args[0] || ''), messageCount: state.messages.length };
            },
            after: ({ t0, tEnd, value, error }) => {
                const click = state.fdsClick;
                state.fdsClick = null;
                const newMessages = click ? state.messages.slice(click.messageCount) : [];
                const lastMessage = newMessages.length ? newMessages[newMessages.length - 1].text : '';
                const label = String(click?.type || 'fds').toLowerCase() === 'gaar' ? 'GAAR' : 'FdS';
                noteFelt(label, value === true
                    ? 'document affiché'
                    : (error ? 'erreur : ' + String(error.message || error) : (lastMessage ? 'message : ' + lastMessage : 'pas de document')),
                tEnd - t0);
            }
        });

        /* v17.38 — texte exact des messages FdS / BFG / GLR affichés, à toute heure. */
        const noteMessage = (source, text) => {
            const clean = String(text || '').replace(/\s+/g, ' ').trim();
            if (!clean) return;
            pushLimited(state.messages, { at: Date.now(), source, text: clean.slice(0, 300) }, 30);
        };
        const RELATED_MESSAGE = /FdS|GAAR|BFG|NAS|Global Link|GLR|Trafic Moyens Nationaux|associ|autorisation|captcha|code de sécurité/i;
        safe(() => {
            const previousAlert = window.alert;
            if (typeof previousAlert !== 'function' || previousAlert.__npfDiagMessages) return;
            const alertWrapper = function (message) {
                safe(() => { if (RELATED_MESSAGE.test(String(message || ''))) noteMessage('alerte', message); });
                return previousAlert.apply(this, arguments);
            };
            alertWrapper.__npfDiagMessages = true;
            window.alert = alertWrapper;
        });
        wrapGlobal('setBriefingDocViewerStatus', {
            before: args => { if (args[1] && args[1].error) noteMessage('lecteur FdS / GAAR', args[0]); }
        });
        wrapGlobal('setGlobalLinkAuthStatus', {
            before: args => { if (args[1] === 'error') noteMessage('fenêtre code Trafic Moyens Nationaux', args[0]); }
        });
        wrapGlobal('setGlobalLinkPasswordStatus', {
            before: args => { if (args[1] === 'error') noteMessage('fenêtre mot de passe Trafic Moyens Nationaux', args[0]); }
        });

        /* v17.35 — périodes de simulation et réglages (vitesse, route, altitude). */
        wrapGlobal('enableSimulationMode', {
            noStartup: true,
            before: () => safe(() => !!isSimulationMode, false),
            after: info => {
                if (info.before || !safe(() => !!isSimulationMode, false)) return;
                pushCapped(state.simPeriods, {
                    start: round(info.t0), startAt: wallAt(info.t0), end: null, endAt: null,
                    settings: [{ at: wallAt(info.t0), ...currentSimulationSettings() }]
                }, LIMITS.simPeriods);
                safe(() => npfDiagSiaInteraction('SIMULATION', 'début', currentSimulationSettings()));
            }
        });
        wrapGlobal('disableSimulationMode', {
            noStartup: true,
            before: () => safe(() => !!isSimulationMode, false),
            after: info => {
                if (!info.before || safe(() => !!isSimulationMode, false)) return;
                const period = state.simPeriods[state.simPeriods.length - 1];
                if (period && period.end === null) {
                    period.end = round(info.t0);
                    period.endAt = wallAt(info.t0);
                }
                safe(() => npfDiagSiaInteraction('SIMULATION', 'fin', currentSimulationSettings()));
            }
        });
        wrapGlobal('applySimulationMotionSettings', {
            noStartup: true,
            after: info => {
                const period = state.simPeriods[state.simPeriods.length - 1];
                if (period && period.end === null) {
                    period.settings.push({ at: wallAt(info.t0), ...currentSimulationSettings() });
                    if (period.settings.length > 20) period.settings.splice(1, period.settings.length - 20);
                }
                safe(() => npfDiagSiaInteraction('SIMULATION', 'réglages', currentSimulationSettings()));
            }
        });

        /* v17.35 — changement d'état du bouton Suivi (réel comme simulation). */
        const followWrapper = name => wrapGlobal(name, {
            noStartup: true,
            before: () => safe(() => !!centerGpsFollowActive, false),
            after: info => {
                const active = safe(() => !!centerGpsFollowActive, false);
                if (active === info.before) return;
                const entry = {
                    t: round(info.t0), at: wallAt(info.t0), active,
                    mode: safe(() => (isSimulationMode ? 'simulation' : 'GPS réel'), '?')
                };
                pushCapped(state.followChanges, entry, LIMITS.followChanges);
                safe(() => npfDiagSiaInteraction('SUIVI GPS', `${active ? 'activé' : 'désactivé'} · ${entry.mode}`, null));
            }
        });
        followWrapper('enableCenterGpsFollow');
        followWrapper('disableCenterGpsFollow');

        /* v17.33 — I1 : chaîne GPS. */
        wrapGlobal('updateUserPosition', {
            noStartup: true,
            before: args => startGpsCycle(args),
            after: finishGpsCycle
        });
        [
            'recenterMapOnKnownGpsPosition', 'updateOwnGpsVector', 'updateNearestCommuneDisplay',
            'updateCalculatorData', 'drawUserToTargetRoute', 'saveStoredGpsPosition',
            'buildOwnGpsIcon', 'applyOwnGpsPlaneHeading', 'handleNpfFirePelicAutoCycle'
        ].forEach(name => wrapGlobal(name, { noStartup: true, gpsPart: true }));

        /* v17.34 — vérification des tuiles (getBoundingClientRect sur chaque
         * tuile) : appels, durée, tuiles, appelant. Mesure seule. */
        wrapGlobal('getVisibleBaseTileLoadStateForSia', {
            noStartup: true,
            activityMinMs: 8,
            before: () => currentWaitCaller(),
            after: recordTileCheck
        });

        /* v17.33 — I4 : instantanés DIAG (dont ceux qui mesurent les tuiles). */
        wrapGlobal('getNpfStartupDiagnosticOverlaySnapshot', { noStartup: true, gpsPart: true });

        /* v17.33 — I5 : trafic et GLR. L'animation (20 images/s) n'entre dans
         * le contexte des blocages qu'au-delà de 8 ms. */
        wrapGlobal('refreshTrafficLayer', { noStartup: true });
        wrapGlobal('redrawTrafficLayerFromSnapshot', { noStartup: true, activityMinMs: 8 });
        wrapGlobal('updateTrafficSmoothPositions', { noStartup: true, activityMinMs: 8 });
        wrapGlobal('refreshGlobalLinkPositions', { noStartup: true });

        /* v17.50 — C3 : reprise après geste et pose des marqueurs PÉLIC /
         * terrains proches de la vue, visibles dans « en cours » des blocages. */
        wrapGlobal('runNpfMapGestureResumeStep', { noStartup: true });
        wrapGlobal('processNpfAirportMarkerViewChunk', { noStartup: true, activityMinMs: 4 });
        /* v17.52 — pose des bordures intérieures des zones SIA par lots. */
        wrapGlobal('runSiaInnerBandsStep', { noStartup: true, activityMinMs: 4 });

        wrapGlobal('initMap', { after: () => installMapHooks() });

        /* v17.41 — lectures du pack encore en cours après leur délai, et
         * récupérations automatiques du lecteur. Mesure seule : les fonctions
         * du moteur de tuiles (src/100) sont observées, pas modifiées. */
        wrapGlobal('readDirectOfflineTileRecord', {
            noStartup: true,
            noActivity: true,
            before: args => packReadStart(args),
            after: info => packReadEnd(info.before, info)
        });
        wrapGlobal('recoverDirectOfflineTileReader', {
            noStartup: true,
            before: args => ({
                count: safe(() => Number(directOfflineRecoveryCount) || 0, 0),
                reason: String(args?.[0] || 'read-error').slice(0, 80)
            }),
            after: info => {
                const count = safe(() => Number(directOfflineRecoveryCount) || 0, 0);
                /* Appel refusé (récupération déjà en cours, délai de 12 s) : non compté. */
                if (!info.before || count <= info.before.count) return;
                pushCapped(state.readerRecoveries, {
                    at: wallAt(info.t0),
                    reason: info.before.reason,
                    ms: round(info.tEnd - info.t0),
                    ok: info.value === true
                }, 30);
            }
        });

        const waitWrapper = (name, labelOf, layerWaitName = null) => wrapGlobal(name, {
            noStartup: true,
            before: args => ({
                tiles: getTileState(),
                wait: layerWaitName ? startLayerWait(layerWaitName, args) : null
            }),
            after: info => {
                recordWait(labelOf(info.args), info);
                if (info.before?.wait) finishLayerWait(info.before.wait, info);
            }
        });
        waitWrapper('waitForNpfStartupFirstTile', () => 'première tuile');
        waitWrapper('waitForNpfStartupMapPriorityRelease', () => 'priorité fond de carte');
        waitWrapper('waitForNpfLayerActivationTileWindow', args => String(args?.[0] || 'activation'), 'activation');
        waitWrapper('waitForNpfHeavyOverlayTileWindow', args => String(args?.[0] || 'calque lourd'), 'fenêtre lourde');
        waitWrapper('waitForNpfVisibleBaseTilesReady', () => 'tuiles visibles');

        wrapGlobal('runNpfMapOverlayPriorityRestore', {
            before: args => {
                const ctx = {
                    token: args?.[0],
                    reason: args?.[1],
                    t0: now(),
                    gestures: state.gesturesSinceRestore,
                    sinceMoveEnd: state.lastMoveEndAt ? round(now() - state.lastMoveEndAt) : null,
                    tTiles: null, tVfr: null, tHtStart: null, tHt: null, tRoutesStart: null,
                    ht: null, routes: null
                };
                state.gesturesSinceRestore = 0;
                state.currentRestore = ctx;
                return ctx;
            },
            after: info => finishRestore(info.before, info)
        });
        wrapGlobal('waitForNpfMapOverlayPriorityTilesSettled', {
            noStartup: true,
            before: () => ({ tiles: getTileState(), wait: startLayerWait('restitution', null) }),
            after: info => {
                recordWait('priorité carte (restitution)', info);
                if (info.before?.wait) finishLayerWait(info.before.wait, info);
                const ctx = restoreOf(info.args?.[0]);
                if (ctx) ctx.tTiles = info.tEnd;
            }
        });
        wrapGlobal('waitForNpfMapOverlayPrioritySiaIdle', {
            after: info => {
                const ctx = restoreOf(info.args?.[0]);
                if (ctx) ctx.tVfr = info.tEnd;
            }
        });

        wrapGlobal('refreshVisibleHighVoltageLines', {
            before: args => {
                state.htInProgress = true;
                const ctx = state.currentRestore;
                if (ctx && String(args?.[0] || '').startsWith('overlay-priority') && ctx.tHtStart == null) {
                    ctx.tHtStart = now();
                }
                const zoom = safe(() => Number(map.getZoom()), null);
                const band = getHtZoomBand(zoom);
                return {
                    zoom,
                    band,
                    layer: safe(() => highVoltageLinesRenderedGeoJsonLayer, null),
                    token: safe(() => highVoltageLinesRefreshToken, 0),
                    reusable: safe(() => (
                        isHighVoltageCoverageValidForCurrentView()
                        && state.htRenderedZoomBand === band
                    ), false)
                };
            },
            after: finishHt
        });

        wrapGlobal('refreshRoadOverlayVisibleParts', {
            before: args => startRoutes(args),
            after: finishRoutes
        });
        wrapGlobal('getRoadOverlaySourcePart', {
            before: args => ({
                ctx: state.currentRoutes,
                cached: safe(() => roadOverlaySourceParts.get(args?.[0]?.key), null)
            }),
            after: info => {
                const ctx = info.before?.ctx;
                if (!ctx || ctx.tEnd) return;
                const record = info.value;
                if (record && record === info.before.cached) {
                    ctx.worksetParts += 1;
                    return;
                }
                ctx.readMs += info.tEnd - info.t0;
                ctx.readParts += 1;
                const stats = record?.geojson?.__npfSpatialStats;
                if (stats) {
                    ctx.cells += Number(stats.cells || 0);
                    ctx.ram += Number(stats.ramHits || 0);
                    ctx.storage += Number(stats.storageReads || 0);
                }
            }
        });
        wrapGlobal('buildRoadOverlayGeojsonForTierAndBounds', {
            before: () => state.currentRoutes,
            after: info => { if (info.before) info.before.filterMs += info.tEnd - info.t0; }
        });
        wrapGlobal('loadRoadOverlayPart', {
            before: () => {
                const ctx = state.currentRoutes;
                return ctx ? { ctx, readMs: ctx.readMs, filterMs: ctx.filterMs } : null;
            },
            after: info => {
                const before = info.before;
                if (!before) return;
                const ctx = before.ctx;
                ctx.loadParts += 1;
                ctx.buildMs += Math.max(
                    0,
                    (info.tEnd - info.t0) - (ctx.readMs - before.readMs) - (ctx.filterMs - before.filterMs)
                );
            }
        });
        wrapGlobal('rebuildRoadOverlayLabels', {
            before: () => state.currentRoutes,
            after: info => { if (info.before) info.before.labelsMs += info.t1 - info.t0; }
        });
        wrapGlobal('clearRoadOverlayRenderedParts', {
            before: () => state.currentRoutes,
            after: info => {
                if (!info.before) return;
                info.before.clearMs += info.t1 - info.t0;
                info.before.cleared = true;
            }
        });

        wrapGlobal('getRoadOverlaySpatialCellFromRam', {
            noActivity: true,
            noStartup: true,
            after: info => {
                if (info.value) state.cellCache.hits += 1;
                else state.cellCache.misses += 1;
            }
        });
        wrapGlobal('setRoadOverlaySpatialCellInRam', {
            noActivity: true,
            noStartup: true,
            before: args => {
                const key = safe(() => getRoadOverlaySpatialCellRamKey(args[0], args[1], args[2]), null);
                return {
                    key,
                    size: safe(() => roadOverlaySpatialCellRam.size, 0),
                    existed: safe(() => roadOverlaySpatialCellRam.has(key), false),
                    bytes: estimateCellBytes(args?.[3])
                };
            },
            after: info => {
                const before = info.before;
                if (!before) return;
                const cache = state.cellCache;
                const sizeAfter = safe(() => roadOverlaySpatialCellRam.size, 0);
                cache.insertions += 1;
                cache.evictions += Math.max(0, before.size + (before.existed ? 0 : 1) - sizeAfter);
                if (before.key) state.cellBytesByKey.set(before.key, before.bytes);
                refreshCellBytes();
            }
        });
        wrapGlobal('clearRoadOverlaySpatialRamCaches', {
            noActivity: true,
            after: () => {
                state.cellCache.clears += 1;
                state.cellBytesByKey.clear();
                state.cellCache.estimatedBytes = 0;
            }
        });
    };

    try { installWrappers(); } catch (error) { console.warn('[NPF DIAG] Enveloppes v17.32 :', error); }
    try { installStorageProbes(); } catch (error) { console.warn('[NPF DIAG] Mesures de stockage v17.42 :', error); }
    /* v17.41 — premier plan / arrière-plan, et « référence iPad » (essai toutes
     * les 10 s, une mesure par minute au plus). */
    try {
        document.addEventListener('visibilitychange', () => {
            pushCapped(state.visibilityEvents, {
                at: Date.now(),
                hidden: document.visibilityState === 'hidden'
            }, 60);
        }, { passive: true });
        setInterval(() => safe(sampleReference), 10000);
    } catch (_) {}
    try { startBlockMonitor(); } catch (_) {}
    try { startTileTimeline(); } catch (_) {}
    try { watchPackChanges(); } catch (_) {}
    /* v17.36 — période initiale du recentrage économe (réglage lu après chargement). */
    setTimeout(() => {
        safe(() => {
            if (!state.ecoPeriods.length) startEcoPeriod(isNpfEconomicRecenterEnabled(), 0);
        });
    }, 0);
    try {
        [5000, 10000, 20000].forEach(delay => scheduleCanvasMemorySample(`démarrage +${delay / 1000} s`, delay));
        setInterval(() => scheduleCanvasMemorySample('intervalle 30 s'), 30000);
    } catch (_) {}

    return {
        state,
        addMarker,
        recordGesture,
        getMapMotionExtraMetrics,
        isUserMapContactRecent,
        sampleCanvasMemory,
        wallAt,
        tileLookupStart,
        tileLookupError,
        tileLookupEnd,
        getSpeedKt,
        TILE_MS_BINS,
        noteGpsRecenter,
        isGpsFollowActive,
        notePosition,
        economicRecenterChanged,
        economicRecenterSkipped,
        ecoMode,
        fireSelected: (origin, item) => {
            const name = String(item?.nom_standard || item?.name || 'feu').slice(0, 60);
            pushCapped(state.fireSelections, { at: Date.now(), t: round(now()), origin: String(origin || '—'), name }, 20);
            safe(() => npfDiagSiaInteraction('SÉLECTION FEU', `${origin} · ${name}`, null));
        },
        restoreTimeout: (kind, waitedMs, tiles) => {
            pushCapped(state.restoreTimeouts, {
                at: Date.now(),
                kind: String(kind || '—'),
                ms: round(waitedMs),
                zoom: safe(() => Number(map.getZoom()), null),
                fond: String(getPackKey()).slice(0, 60),
                tiles: tiles ? (Number(tiles.loaded) || 0) + '/' + (Number(tiles.total) || 0) : '—'
            }, 20);
        },
        bannerShown: text => {
            const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
            state.bannerCount += 1;
            state.lastBanner = { at: Date.now(), text: clean };
            state.messages.push({ at: Date.now(), source: 'bandeau', text: clean });
            if (state.messages.length > 30) state.messages.splice(0, state.messages.length - 30);
        },
        bfgBridgeAttempt: entry => {
            state.bfgAttempts.push({
                at: Date.now(),
                attempt: Number(entry?.attempt) || 1,
                ms: round(entry?.ms),
                result: String(entry?.result || '—'),
                httpStatus: Number(entry?.httpStatus) || 0,
                error: String(entry?.error || '').slice(0, 90)
            });
            if (state.bfgAttempts.length > 20) state.bfgAttempts.splice(0, state.bfgAttempts.length - 20);
        }
    };
})();

/*
 * v17.46 — lignes courtes en tête du DIAG (export seulement, rien n'est
 * enregistré en plus) : durées du démarrage, historique des feux, imports.
 */
function appendNpfDiagV1746HeaderLines(lines) {
    const seconds = value => (Number.isFinite(value) ? (value / 1000).toFixed(2).replace('.', ',') : '—');
    const marks = (NPF_STARTUP_DIAGNOSTIC.state.marks || []);
    const markAt = key => {
        const entry = marks.find(item => item && item.key === key);
        return entry ? Number(entry.t) : NaN;
    };
    const boot = window.__npfBootTiming || {};
    let scriptReceived = NaN;
    try {
        const entry = performance.getEntriesByType('resource')
            .find(item => /\/script\.js(\?|$)/.test(item.name));
        if (entry) scriptReceived = entry.responseEnd;
    } catch (_) {}
    lines.push(
        'Durées du démarrage (s depuis l’ouverture) : scripts de la page ' + seconds(Number(boot.inlineAt))
        + ' · stockage local, 1re lecture ' + (Number.isFinite(boot.localStorageFirstReadMs) ? Math.round(boot.localStorageFirstReadMs) + ' ms' : '—')
        + ' · script.js reçu ' + seconds(scriptReceived)
        + ' · début ' + seconds(markAt('script_eval'))
        + ' · évalué ' + seconds(markAt('script_end'))
        + ' · DOM prêt ' + seconds(markAt('dom_ready'))
        + ' · carte créée ' + seconds(markAt('map_init_ready'))
        + ' · 1re tuile ' + seconds(markAt('first_tile'))
        + ' · démarrage principal ' + seconds(markAt('core_ready'))
        + ' · carte complète ' + seconds(markAt('startup_visible_map_complete'))
    );

    const fireAtLaunch = boot.fireHistoryAtLaunch || null;
    let fireNow = '—';
    try { fireNow = String(getFireHistory().length); } catch (_) {}
    const writeErrors = window.__npfFireHistoryWriteErrors || null;
    lines.push(
        'Historique des feux : ' + (fireAtLaunch ? fireAtLaunch.n + ' au lancement (' + fireAtLaunch.chars + ' car.)' : '—')
        + (fireAtLaunch && fireAtLaunch.error ? ' · lecture illisible : ' + fireAtLaunch.error : '')
        + ' · ' + fireNow + ' maintenant'
        + ' · écritures refusées : ' + (writeErrors && writeErrors.n
            ? writeErrors.n + ' (dernière ' + formatNpfDiagClock(writeErrors.last && writeErrors.last.at) + ' ' + (writeErrors.last && writeErrors.last.message || '') + ')'
            : 'aucune')
    );

    let importLog = [];
    try { importLog = JSON.parse(localStorage.getItem('npfOfflineImportLogV1') || '[]'); } catch (_) {}
    if (Array.isArray(importLog) && importLog.length) {
        const running = typeof isZipImportRunning !== 'undefined' && !!isZipImportRunning;
        lines.push('Imports de cartes (derniers) :');
        importLog.slice(-6).forEach(item => {
            if (!item) return;
            const interrupted = item.status === 'en cours' && !running;
            lines.push('   ' + formatNpfDiagClock(item.at) + ' | ' + String(item.file || '—').slice(0, 40)
                + ' | ' + (Number(item.written) || 0) + ' / ' + (Number(item.total) || 0) + ' tuiles'
                + ' | ' + seconds(Number(item.ms)) + ' s | lot le plus long ' + (Number(item.maxBatchMs) || 0) + ' ms'
                + (Number(item.resumedFrom) > 0 ? ' | reprise depuis ' + item.resumedFrom : '')
                + ' | ' + (interrupted ? 'INTERROMPU à la tuile ' + (Number(item.written) || 0) : item.status)
                + (item.error ? ' (' + item.error + ')' : ''));
        });
    }
}

/* v17.41 — délai de restitution dépassé (appelé par le séquenceur, src/080). */
function npfDiagRestoreWaitTimeout(kind, waitedMs, tiles) {
    try { NPF_DIAG_DETAIL.restoreTimeout(kind, waitedMs, tiles); } catch (_) {}
}

/* v17.40 — sélection d'un feu (src/050) et bandeau d'information (src/050). */
function npfDiagFireSelected(origin, item) {
    try { NPF_DIAG_DETAIL.fireSelected(origin, item); } catch (_) {}
}
function npfDiagInfoBannerShown(text) {
    try { NPF_DIAG_DETAIL.bannerShown(text); } catch (_) {}
}

/* v17.38 — tentative du pont BFG (appelé par src/170). */
function npfDiagBfgBridgeAttempt(entry) {
    try { NPF_DIAG_DETAIL.bfgBridgeAttempt(entry); } catch (_) {}
}

/* v17.33 — DIAG I8 : points d'appel du moteur de tuiles (mesure seule). */
function npfDiagTileNow() {
    try { return NPF_STARTUP_DIAGNOSTIC.now(); } catch (_) { return 0; }
}
function npfDiagTileLookupStart(coords, options) {
    try { return NPF_DIAG_DETAIL.tileLookupStart(coords, options); } catch (_) { return null; }
}
function npfDiagTileLookupError(lookup, error, phase) {
    try { NPF_DIAG_DETAIL.tileLookupError(lookup, error, phase); } catch (_) {}
}
function npfDiagTileLookupEnd(lookup, outcome, dbName) {
    try { NPF_DIAG_DETAIL.tileLookupEnd(lookup, outcome, dbName); } catch (_) {}
}

/* v17.33 — D1 : geste manuel en cours (contact ou verrou de geste). */
function npfDiagIsManualGestureInProgress() {
    try {
        return !!(
            npfMapManualGestureLockActive
            || NPF_DIAG_DETAIL.state.userContactActive
        );
    } catch (_) {
        return false;
    }
}

/* v17.33 — D1 : tuiles chargées du niveau courant, sans mesure DOM. */
function npfDiagCountLoadedCurrentTiles() {
    try {
        let loaded = 0;
        const tiles = baseTileLayer && baseTileLayer._tiles ? baseTileLayer._tiles : {};
        for (const key in tiles) {
            const tile = tiles[key];
            if (tile && tile.current && tile.loaded) loaded += 1;
        }
        return loaded;
    } catch (_) {
        return 0;
    }
}

function npfDiagIsUserMapContactRecent() {
    try { return NPF_DIAG_DETAIL.isUserMapContactRecent(); } catch (_) { return false; }
}
function npfDiagGetMapMotionExtraMetrics(sample) {
    try { return NPF_DIAG_DETAIL.getMapMotionExtraMetrics(sample); } catch (_) { return {}; }
}
function npfDiagAddUserMarker() {
    try { return NPF_DIAG_DETAIL.addMarker(); } catch (_) { return null; }
}

/* v17.32 — extrait compact persisté avec la session (restitué à l'export suivant). */
function npfDiagDetailPersistSnapshot() {
    try {
        const s = NPF_DIAG_DETAIL.state;
        return {
            v: 1,
            counts: {
                gestures: s.gestureCount,
                blocks: s.blockCount,
                blockMaxMs: Math.round(s.blockMaxMs),
                restores: s.restoreCount,
                routes: s.routesCount,
                ht: s.htCount
            },
            gestures: s.gestures.slice(-20),
            firstBlocks: s.firstBlocks.slice(0, 8).filter(item => !s.blocks.slice(-15).includes(item)),
            blocks: s.blocks.slice(-15),
            restores: s.restores.slice(-12),
            routes: s.routesRebuilds.slice(-8),
            ht: s.htRebuilds.slice(-8),
            markers: s.markers.slice(-20),
            simPeriods: s.simPeriods.slice(-10),
            ecoPeriods: s.ecoPeriods.slice(-10),
            followChanges: s.followChanges.slice(-10),
            nasRequests: s.nasRequests.slice(-15),
            felt: s.felt.slice(-20),
            messages: s.messages.slice(-15),
            bfgAttempts: s.bfgAttempts.slice(-10),
            readMinutes: Array.from(s.readMinutes.values()).slice(-15).map(npfDiagCompactReadMinute),
            slowReadBatches: s.slowReadBatches.slice(-10),
            fireSelections: s.fireSelections.slice(-10),
            /* v17.41 — formes courtes pour garder un enregistrement léger. */
            visibility: s.visibilityEvents.slice(-20).map(item => [item.at, item.hidden ? 1 : 0]),
            readerRecoveries: s.readerRecoveries.slice(-10),
            restoreTimeouts: s.restoreTimeouts.slice(-10),
            lateReads: { ...s.lateReads },
            reference: npfDiagReferenceSummary(),
            /* v17.42 */
            storage: s.storageEvents.slice(-15).map(item => [item.at, item.kind, item.name, item.ms, item.n]),
            packProbes: s.packProbes.slice(-PACK_PROBE_PERSIST_LIMIT),
            memoryPeak: s.memoryPeak,
            cellCache: { ...s.cellCache }
        };
    } catch (_) {
        return null;
    }
}

function formatNpfDiagClock(at) {
    return Number(at) ? new Date(Number(at)).toLocaleTimeString('fr-FR') : '—';
}

function formatNpfDiagGestureLine(item) {
    const zoom = Number.isFinite(Number(item.zFrom)) && Number(item.zFrom) !== Number(item.zTo)
        ? ` · zoom ${item.zFrom}→${item.zTo}`
        : '';
    const move = Number.isFinite(Number(item.dx))
        ? ` · dépl. x ${item.dx} % / y ${item.dy} %`
        : '';
    return formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | '
        + item.source + (item.sim ? ' SIM' : '') + (item.speedKt !== null && item.speedKt !== undefined ? ' ' + item.speedKt + ' kt' : '')
        + ' | ' + item.ms + ' ms · ' + item.ev + ' év. · écart moy ' + item.gapAvg
        + ' / max ' + item.gapMax + ' ms' + (item.g100 ? ' · >100=' + item.g100 : '')
        + move + zoom + ' | dans zone HT ' + item.ht + ' · Routes ' + item.routes;
}

function formatNpfDiagRestoreLine(item) {
    const part = (label, value) => label + ' ' + (value === null || value === undefined ? '—' : value + ' ms');
    return formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | '
        + item.outcome + ' · ' + item.totalMs + ' ms · ' + item.gestures + ' geste(s)'
        + (item.sinceMoveEnd !== null && item.sinceMoveEnd !== undefined ? ' · fin geste +' + item.sinceMoveEnd + ' ms' : '')
        + ' | ' + part('tuiles', item.tilesMs) + ' · ' + part('VFR', item.vfrMs)
        + ' · ' + part('HT', item.htMs) + ' · ' + part('Routes', item.routesMs)
        + ' | HT : ' + item.ht + ' | Routes : ' + item.routes;
}

function formatNpfDiagRoutesLine(item) {
    return formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | '
        + item.source + ' · niveau ' + item.tier + ' | ' + item.decision
        + (item.reason ? ' (' + item.reason + ')' : '')
        + ' | total ' + item.totalMs + ' ms · attente tuiles ' + item.waitMs
        + ' · vidage ' + item.clearMs
        + ' · lecture ' + item.readMs + ' (' + item.readParts + ' parties, cellules ram '
        + item.ram + ' / stockage ' + item.storage + ', ' + item.worksetParts + ' en jeu de travail)'
        + ' · filtrage ' + item.filterMs + ' · tracés ' + item.buildMs
        + ' · cartouches ' + item.labelsMs + ' ms | ' + item.rendered + ' segments rendus';
}

function formatNpfDiagHtLine(item) {
    return formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | '
        + item.source + ' · zoom ' + item.zoom + ' | ' + item.decision
        + (item.reason ? ' (' + item.reason + ')' : '')
        + ' | total ' + item.totalMs + ' ms · attente tuiles ' + item.waitMs + ' · travail ' + item.workMs
        + ' ms | ' + item.rendered + ' tronçons';
}

function formatNpfDiagBlockLine(item) {
    return formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' → ' + (item.end / 1000).toFixed(2)
        + ' s | ≈ ' + item.ms + ' ms'
        + ' | en cours : ' + (item.sync || '—')
        + ' | async ouvertes : ' + (item.async || '—')
        + ' | étapes : ' + (item.marks || '—')
        + ' | ' + item.state
        + (item.eco ? ' · économe ' + item.eco : '');
}

function formatNpfDiagMemoryLine(item) {
    return formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | ' + item.reason
        + ' | ' + item.totalMb + ' Mo / ' + item.count + ' canvas | '
        + (item.items || []).map(canvas => canvas.pane + ' ' + canvas.w + '×' + canvas.h + ' ' + canvas.mb + ' Mo'
            + (canvas.hidden ? ' (masqué)' : '')).join(' · ');
}

function formatNpfDiagMarkerLine(item) {
    return 'Repère n°' + item.n + ' | ' + formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s'
        + ' | en cours : ' + (item.sync || '—')
        + ' | async ouvertes : ' + (item.async || '—')
        + ' | ' + item.state;
}

function appendNpfDiagDetailExportSections(lines) {
    const s = NPF_DIAG_DETAIL.state;
    const fmtMb = bytes => (Math.round((Number(bytes) || 0) / 104857.6) / 10) + ' Mo';

    lines.push('');
    lines.push('REPÈRES UTILISATEUR (bouton « Repère » du DIAG)');
    if (!s.markers.length) {
        lines.push('Aucun repère.');
    } else {
        s.markers.forEach(item => {
            lines.push(formatNpfDiagMarkerLine(item));
            const near = (list, windowMs) => list.filter(entry => Math.abs(entry.t - item.t) <= windowMs);
            const blocks = near(s.blocks, 10000);
            const gestures = near(s.gestures, 10000);
            lines.push(
                '   ±10 s : ' + blocks.length + ' blocage(s) JS'
                + (blocks.length ? ' (max ' + Math.max(...blocks.map(entry => entry.ms)) + ' ms)' : '')
                + ' · ' + gestures.length + ' geste(s)'
                + (gestures.length ? ' (écart max ' + Math.max(...gestures.map(entry => entry.gapMax)) + ' ms)' : '')
            );
        });
    }

    lines.push('');
    lines.push('BLOCAGES JS > 100 ms — CHRONOLOGIQUE, TOUTE LA SESSION (minuterie 50 ms)');
    const firstOnly = s.firstBlocks.filter(item => !s.blocks.includes(item));
    lines.push('Total : ' + s.blockCount + ' | maximum ≈ ' + Math.round(s.blockMaxMs) + ' ms'
        + (s.blockCount > s.blocks.length
            ? ' | ' + firstOnly.length + ' premiers + ' + s.blocks.length + ' derniers listés'
            : ''));
    firstOnly.forEach(item => lines.push(formatNpfDiagBlockLine(item)));
    if (firstOnly.length && s.blockCount > firstOnly.length + s.blocks.length) {
        lines.push('… ' + (s.blockCount - firstOnly.length - s.blocks.length) + ' blocages non listés …');
    }
    s.blocks.forEach(item => lines.push(formatNpfDiagBlockLine(item)));

    lines.push('');
    lines.push('DÉMARRAGE — FONCTIONS MESURÉES (30 premières s, ≥ 2 ms ou async)');
    lines.push('Début | Fonction | Synchrone | Total (async)');
    s.startupCalls.forEach(item => {
        lines.push(
            '+ ' + (item.t0 / 1000).toFixed(2) + ' s | ' + item.name
            + ' | ' + Math.round(item.t1 - item.t0) + ' ms'
            + ' | ' + (item.async ? (item.tEnd !== null ? Math.round(item.tEnd - item.t0) + ' ms' : 'en cours') : '—')
        );
    });

    lines.push('');
    lines.push('DÉMARRAGE — CHRONOLOGIE TUILES (niveau courant, sans mesure DOM)');
    lines.push('Instant | File | Lectures actives | Tuiles chargées / niveau | Accès IDB cumulés | Hits RAM | Dernière étape');
    s.tileTimeline.forEach(item => {
        lines.push(
            '+ ' + (item.t / 1000).toFixed(2) + ' s | ' + item.queued + ' | ' + item.active
            + ' | ' + item.loaded + '/' + item.current + ' | ' + item.idb + ' | ' + item.ram + ' | ' + item.phase
        );
    });

    lines.push('');
    lines.push('ATTENTES SUR LES TUILES (30 premières s, puis ≥ 1 s)');
    s.waits.forEach(item => {
        lines.push(
            '+ ' + (item.t / 1000).toFixed(2) + ' s | ' + item.label + ' | ' + item.ms + ' ms | ' + item.result
            + ' | début : ' + item.start + ' | fin : ' + item.end
        );
    });

    lines.push('');
    lines.push('GESTES (tous) — source · durée · événements · écarts · déplacement en % de la vue (x+ = est, y+ = sud) · vue finale dans la zone déjà dessinée');
    lines.push('Total : ' + s.gestureCount + (s.gestureCount > s.gestures.length ? ' | ' + s.gestures.length + ' derniers listés' : ''));
    s.gestures.forEach(item => lines.push(formatNpfDiagGestureLine(item)));

    lines.push('');
    lines.push('RESTITUTIONS APRÈS GESTE (tuiles → VFR → HT → Routes)');
    lines.push('Total : ' + s.restoreCount + (s.restoreCount > s.restores.length ? ' | ' + s.restores.length + ' dernières listées' : ''));
    s.restores.forEach(item => lines.push(formatNpfDiagRestoreLine(item)));

    lines.push('');
    lines.push('RECONSTRUCTIONS HT');
    lines.push('Total : ' + s.htCount);
    s.htRebuilds.forEach(item => lines.push(formatNpfDiagHtLine(item)));

    lines.push('');
    lines.push('RECONSTRUCTIONS ROUTES (durées en ms)');
    lines.push('Total : ' + s.routesCount);
    s.routesRebuilds.forEach(item => lines.push(formatNpfDiagRoutesLine(item)));

    const cache = s.cellCache;
    const ramSize = (() => { try { return Number(roadOverlaySpatialCellRam.size || 0); } catch (_) { return 0; } })();
    const ramLimit = (() => { try { return Number(ROAD_OVERLAY_SPATIAL_RAM_CELL_LIMIT || 0); } catch (_) { return 0; } })();
    lines.push('');
    lines.push('CACHE CELLULES ROUTES (RAM)');
    lines.push(
        'Taille ' + ramSize + ' / ' + ramLimit + ' cellules (pic ' + cache.peakCells + ')'
        + ' | lectures RAM ' + cache.hits + ' trouvées / ' + cache.misses + ' absentes'
        + ' | insertions ' + cache.insertions + ' | évictions ' + cache.evictions
        + ' | vidages ' + cache.clears
        + ' | mémoire estimée ' + fmtMb(cache.estimatedBytes) + ' (pic ' + fmtMb(cache.peakBytes) + ')'
    );

    lines.push('');
    lines.push('MÉMOIRE DES CALQUES (canvas : largeur × hauteur × 4 octets, densité écran comprise)');
    const peak = s.memoryPeak;
    if (peak) {
        lines.push('Pic de la session : ' + peak.totalMb + ' Mo à + ' + (peak.t / 1000).toFixed(2) + ' s (' + peak.reason + ')');
        peak.items.forEach(canvas => lines.push(
            '   ' + canvas.pane + ' | ' + canvas.w + ' × ' + canvas.h + ' | ' + canvas.mb + ' Mo' + (canvas.hidden ? ' | pane masqué' : '')
        ));
    }
    /* Relevés successifs identiques regroupés sur une ligne. */
    let memoryRun = null;
    const flushMemoryRun = () => {
        if (!memoryRun) return;
        lines.push(
            formatNpfDiagMemoryLine(memoryRun.first)
            + (memoryRun.count > 1
                ? ' | identique ×' + memoryRun.count + ' jusqu’à ' + formatNpfDiagClock(memoryRun.last.at)
                : '')
        );
        memoryRun = null;
    };
    s.memorySamples.forEach(item => {
        const signature = item.totalMb + '|' + item.count;
        if (memoryRun && memoryRun.signature === signature) {
            memoryRun.count += 1;
            memoryRun.last = item;
            return;
        }
        flushMemoryRun();
        memoryRun = { signature, first: item, last: item, count: 1 };
    });
    flushMemoryRun();

    appendNpfDiagV1733ExportSections(lines);
    appendNpfDiagV1734ExportSections(lines);
    appendNpfDiagSimulationSection(lines);
    appendNpfDiagEconomicSection(lines);
    appendNpfDiagLaunchSection(lines);
    appendNpfDiagNasSection(lines);
    appendNpfDiagPackReadSection(lines);

    lines.push('');
    lines.push(
        'Instrumentation v17.64 : ' + s.wrapped.length + ' fonctions suivies'
        + (s.missing.length ? ' | absentes : ' + s.missing.join(', ') : '')
    );
}

/* v17.33 — sections ajoutées : chaîne GPS, canvas, fonctions, tuiles, packs. */
function appendNpfDiagV1733ExportSections(lines) {
    const s = NPF_DIAG_DETAIL.state;
    const r = value => Math.round(Number(value) || 0);
    const avg = (total, n) => (n > 0 ? Math.round(total / n) : 0);

    lines.push('');
    lines.push('SONDE DE MISE EN PAGE AU DÉMARRAGE (I6)');
    if (s.layoutProbe) {
        const probe = s.layoutProbe;
        lines.push(
            '+ ' + (probe.t / 1000).toFixed(2) + ' s | calcul forcé avant setupEventListeners ' + probe.beforeMs
            + ' ms | setupEventListeners ' + probe.listenersMs + ' ms | calcul forcé après ' + probe.afterMs
            + ' ms | éléments DOM ' + probe.domCount + ' -> ' + probe.domCountAfter
        );
    } else {
        lines.push('Non mesurée.');
    }

    lines.push('');
    lines.push('CHAÎNE GPS (I1 / I2) — durée synchrone de chaque position GPS et de ses étapes (réel et simulé séparés)');
    [['GPS RÉEL', s.gps], ['SIMULATION', s.gpsSim]].forEach(([title, gps]) => {
        lines.push(
            title + ' — positions traitées : ' + gps.cycles + ' | moyenne ' + avg(gps.totalMs, gps.cycles)
            + ' ms | max ' + r(gps.maxMs) + ' ms'
        );
        [...gps.parts.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .forEach(([name, part]) => lines.push(
                '   ' + name + ' | ' + part.n + ' fois | moy ' + avg(part.total, part.n) + ' ms | max ' + r(part.max)
                + ' ms | total ' + r(part.total) + ' ms'
            ));
        if (gps.slowest.length) {
            lines.push('   Positions les plus lentes :');
            gps.slowest.forEach(item => lines.push(
                '   ' + formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | ' + (item.sim ? 'SIM' : 'RÉEL')
                + ' | ' + item.ms + ' ms'
                + (item.speedKt !== null && item.speedKt !== undefined ? ' | ' + item.speedKt + ' kt' : '')
                + ' | ' + (item.parts || '—')
            ));
        }
    });
    lines.push('Positions réelles ignorées pendant la simulation : ' + s.gpsIgnoredDuringSimulation);

    const stats = [...s.fnStats.entries()];
    lines.push('');
    lines.push('RENDERERS CANVAS (I3) — _update à chaque moveend, _redraw à chaque dessin');
    const canvasStats = stats.filter(([name]) => name.startsWith('canvas '));
    if (!canvasStats.length) lines.push('Aucun appel mesuré.');
    canvasStats
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([name, stat]) => lines.push(
            '   ' + name + ' | ' + stat.n + ' fois | moy ' + avg(stat.total, stat.n) + ' ms | max ' + r(stat.max)
            + ' ms | total ' + r(stat.total) + ' ms' + (stat.info ? ' | dernier canvas ' + stat.info : '')
        ));

    lines.push('');
    lines.push('FONCTIONS SUIVIES — 30 PLUS COÛTEUSES (durée synchrone cumulée ; I4 instantanés, I5 trafic / Trafic Moyens Nationaux compris)');
    stats
        .filter(([name]) => !name.startsWith('canvas '))
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 30)
        .forEach(([name, stat]) => lines.push(
            '   ' + name + ' | ' + stat.n + ' fois | moy ' + avg(stat.total, stat.n) + ' ms | max ' + r(stat.max)
            + ' ms | total ' + r(stat.total) + ' ms'
            + (stat.asyncN ? ' | async moy ' + avg(stat.asyncTotal, stat.asyncN) + ' / max ' + r(stat.asyncMax) + ' ms' : '')
        ));

    const tiles = s.tiles;
    const bins = NPF_DIAG_DETAIL.TILE_MS_BINS;
    const binLabels = bins.map((limit, index) => (index === 0 ? '<' + limit : (bins[index - 1]) + '-' + limit))
        .concat(['≥' + bins[bins.length - 1]]);
    const formatHisto = histo => histo.map((count, index) => binLabels[index] + ' ms : ' + count).join(' | ');
    lines.push('');
    lines.push('TUILES — RECHERCHES INDEXEDDB (I8, mesure seule)');
    lines.push(
        'Recherches : ' + tiles.n + ' | ' + Object.entries(tiles.byOutcome).map(([key, value]) => key + ' ' + value).join(' · ')
        + ' | max ' + r(tiles.maxMs) + ' ms'
    );
    lines.push('Durée d\'une recherche : ' + formatHisto(tiles.histo));
    lines.push('Attente en file NPF-Q400 (' + tiles.waitCount + ') : ' + formatHisto(tiles.waitHisto) + ' | max ' + r(tiles.maxWait) + ' ms');
    lines.push(
        /* v17.38 — « accès base » : la connexion IndexedDB de chaque pack est
         * ouverte une seule fois puis réutilisée (src/100, openDirectOfflineTileDatabase). */
        'Lectures ' + tiles.reads + ' · accès base ' + tiles.opens + ' (connexion ouverte une seule fois par pack, puis réutilisée)'
        + ' | par tuile trouvée : moy ' + (tiles.foundCount ? (tiles.foundReads / tiles.foundCount).toFixed(2) : '0')
        + ' lecture(s), max ' + tiles.maxFoundReads
        + ' | trouvées hors première base ' + tiles.foundAfterFirstDb
        + ' | indice de base utilisé ' + tiles.hintUsed + ' / faux ' + tiles.hintMiss
    );
    lines.push(
        'Délais dépassés : lecture ' + tiles.readTimeouts + ' · ouverture ' + tiles.openTimeouts
        + ' | autres erreurs : lecture ' + tiles.readErrors + ' · ouverture ' + tiles.openErrors
    );
    Object.entries(tiles.perPack).forEach(([pack, stat]) => lines.push(
        '   Pack « ' + pack + ' » | ' + stat.n + ' recherches · trouvées ' + stat.found + ' · absentes ' + stat.absent
        + ' | moy ' + avg(stat.totalMs, stat.n) + ' ms · max ' + r(stat.maxMs) + ' ms | délais dépassés ' + stat.timeouts
    ));

    lines.push('');
    lines.push('TUILES — APRÈS CHAQUE ZOOM (recherches commencées dans les 20 s)');
    const median = values => {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    };
    const zoomEvents = s.zoomEvents.slice(-30);
    if (!zoomEvents.length) lines.push('Aucun zoom.');
    zoomEvents.forEach(event => {
        const inWindow = tiles.recent.filter(item => item.t >= event.t && item.t <= event.t + 20000);
        if (!inWindow.length) {
            lines.push(formatNpfDiagClock(event.at) + ' | zoom ' + event.z + ' | aucune recherche (tuiles en RAM ou hors pack NPF-Q400)');
            return;
        }
        const durations = inWindow.map(item => item.ms);
        const waits = inWindow.filter(item => item.wait !== null).map(item => item.wait);
        const lastEnd = Math.max(...inWindow.map(item => item.t + item.ms));
        lines.push(
            formatNpfDiagClock(event.at) + ' | zoom ' + event.z + ' | ' + inWindow.length + ' recherches · trouvées '
            + inWindow.filter(item => item.outcome === 'trouvée').length
            + ' | durée méd ' + median(durations) + ' / max ' + Math.max(...durations) + ' ms'
            + ' | attente file méd ' + median(waits) + ' / max ' + (waits.length ? Math.max(...waits) : 0) + ' ms'
            + ' | lectures ' + inWindow.reduce((sum, item) => sum + item.reads, 0)
            + ' · délais dépassés ' + inWindow.reduce((sum, item) => sum + item.timeouts, 0)
            + ' · indice faux ' + inWindow.filter(item => item.hintMiss).length
            + ' | dernière tuile à + ' + ((lastEnd - event.t) / 1000).toFixed(1) + ' s'
        );
    });

    lines.push('');
    lines.push('TUILES — 25 RECHERCHES LES PLUS LENTES');
    tiles.slowest.forEach(item => lines.push(
        '   ' + formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | z' + item.z + ' | ' + item.ms + ' ms'
        + ' | attente file ' + (item.wait === null ? '—' : item.wait + ' ms')
        + ' | ' + item.outcome + ' | lectures ' + item.reads + ' · accès base ' + item.opens
        + ' · délais dépassés ' + item.timeouts + ' · erreurs ' + item.errors + (item.hintMiss ? ' · indice faux' : '')
    ));

    lines.push('');
    lines.push('CHANGEMENTS DE PACK (I9)');
    if (!s.packChanges.length) lines.push('Aucun.');
    s.packChanges.forEach(item => lines.push(
        formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | '
        + (item.from === null ? 'initial' : '« ' + item.from + ' »') + ' -> « ' + item.to + ' » | compteurs à cet instant : '
        + Object.entries(item.counters || {}).map(([key, value]) => key + '=' + value).join(' · ')
    ));
}

/* v17.35 — en tête de l'export : simulation utilisée, périodes et réglages. */
function formatNpfDiagSimSettings(settings) {
    if (!settings) return '—';
    const route = Number.isFinite(Number(settings.routeDeg)) ? formatRouteDegrees(settings.routeDeg) : '—';
    return settings.speedKt + ' kt · route ' + route + ' · ' + settings.altitudeFt + ' ft';
}

function appendNpfDiagSimulationHeader(lines) {
    const periods = NPF_DIAG_DETAIL.state.simPeriods;
    const simPositions = Number(NPF_STARTUP_DIAGNOSTIC.state.gpsSummarySim?.positions || 0);
    if (!periods.length && !simPositions) {
        lines.push('Simulation : NON (aucune position simulée dans cette session)');
        return;
    }
    lines.push('Simulation : OUI — ' + periods.length + ' période(s), ' + simPositions + ' positions simulées');
    periods.forEach((period, index) => {
        const last = period.settings[period.settings.length - 1];
        lines.push(
            '   Période ' + (index + 1) + ' : ' + formatNpfDiagClock(period.startAt) + ' -> '
            + (period.endAt ? formatNpfDiagClock(period.endAt) : 'en cours')
            + ' | réglages : ' + period.settings.map(item => formatNpfDiagClock(item.at) + ' ' + formatNpfDiagSimSettings(item)).join(' ; ')
            + (last ? '' : '')
        );
    });
}

function appendNpfDiagSimulationSection(lines) {
    const s = NPF_DIAG_DETAIL.state;
    lines.push('');
    lines.push('SIMULATION ET SUIVI GPS (v17.35)');
    lines.push('Changements du bouton Suivi :');
    if (!s.followChanges.length) lines.push('   Aucun.');
    s.followChanges.forEach(item => lines.push(
        '   ' + formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | ' + (item.active ? 'ACTIVÉ' : 'DÉSACTIVÉ') + ' | ' + item.mode
    ));
    lines.push('Dernières positions enregistrées (' + s.positions.length + ') — SIM / RÉEL, suivi, recentrage (raison, décalage) :');
    s.positions.forEach(item => lines.push(
        '   ' + formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | ' + (item.sim ? 'SIM ' : 'RÉEL')
        + ' | ' + item.lat + ', ' + item.lon
        + ' | ' + (item.speedKt === null ? '—' : item.speedKt + ' kt')
        + ' | cap ' + (item.heading === null || item.heading === undefined ? '—' : formatRouteDegrees(item.heading))
        + ' | précision ' + (item.accuracyM === null ? 'non fournie' : item.accuracyM + ' m')
        + ' | suivi ' + (item.follow ? 'oui' : 'non')
        + ' | ' + (item.recenter ? 'recentrage ' + item.recenter + (item.shiftM === null || item.shiftM === undefined ? '' : ' (' + item.shiftM + ' m)') : 'pas de recentrage')
    ));
}

/* v17.39 — lectures du pack : synthèse par minute, paquets lents, 20 premières. */
function npfDiagMedian(values) {
    const sorted = (Array.isArray(values) ? values : []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function npfDiagLayerMix(on, off) {
    if (on && off) return 'ON puis OFF (mixte)';
    return on ? 'ON' : 'OFF';
}

function npfDiagCompactReadMinute(minute) {
    return {
        at: minute.at, n: minute.n, median: npfDiagMedian(minute.durations), max: minute.max,
        ht: minute.n ? npfDiagLayerMix(minute.htOn, minute.htOff) : '—',
        routes: minute.n ? npfDiagLayerMix(minute.routesOn, minute.routesOff) : '—',
        gpsMs: Math.round(Number(minute.gpsMs) || 0), gpsN: Number(minute.gpsN) || 0,
        calcMs: Math.round(Number(minute.calcMs) || 0),
        lateN: Number(minute.lateN) || 0, lateMax: Number(minute.lateMax) || 0,
        refMs: Number.isFinite(minute.refMs) ? minute.refMs : null,
        /* v17.42 — stockage : écritures IDB, autres lectures IDB, fichiers en
         * cache (nombre, max ms) et localStorage (nombre, total ms). */
        /* v17.43 — carte lue et forme des images (Blob, données brutes). */
        map: minute.n ? (minute.map || '—') + (minute.mapMixed ? ' (+ autre carte)' : '') : null,
        fm: [Number(minute.fmBlob) || 0, Number(minute.fmRaw) || 0],
        st: [
            Number(minute.stW) || 0, Number(minute.stWMax) || 0,
            Number(minute.stR) || 0, Number(minute.stRMax) || 0,
            Number(minute.stC) || 0, Number(minute.stCMax) || 0,
            Number(minute.stLs) || 0, Math.round(Number(minute.stLsMs) || 0)
        ]
    };
}

const PACK_PROBE_PERSIST_LIMIT = 12;

/* v17.42 — activité de stockage et sondes après paquet lent. */
function formatNpfDiagStorageEventLine(item) {
    const entry = Array.isArray(item)
        ? { at: item[0], kind: item[1], name: item[2], ms: item[3], n: item[4] }
        : item;
    return '   ' + formatNpfDiagClock(entry.at) + ' | ' + entry.kind + ' | ' + entry.name
        + (entry.ms === null || entry.ms === undefined ? '' : ' | ' + entry.ms + ' ms')
        + (Number(entry.n) > 1 ? ' | ' + entry.n + ' fois' : '');
}

function formatNpfDiagImageForm(form) {
    return form === 'Blob' ? 'Blob' : (form === 'brut' ? 'données brutes' : '—');
}

function formatNpfDiagPackProbeLine(item) {
    const ms = value => (value === null || value === undefined ? '—' : String(value).replace('.', ',') + ' ms');
    const head = '   ' + formatNpfDiagClock(item.at) + ' | après une lecture de ' + item.slowMs + ' ms | zoom ' + item.z;
    if (item.v !== 2) {
        /* Sonde v17.42 (session précédente enregistrée par l'ancienne version). */
        return head + ' | tuile voisine : index seul ' + ms(item.indexMs)
            + ' · accès direct (non comparable) ' + (item.found === false ? 'tuile absente' : ms(item.valueMs))
            + ' | méthode normale, autre tuile ' + ms(item.cursorMs)
            + ' | même tuile relue ' + ms(item.warmMs)
            + (item.error ? ' | ' + item.error : '');
    }
    return head + ' | carte ' + (item.map || '—') + ' · images ' + formatNpfDiagImageForm(item.form)
        + ' | COMPARABLE à une lecture normale — tuile voisine jamais lue : '
        + (item.normalFound === false ? 'tuile absente (' + ms(item.normalMs) + ')' : ms(item.normalMs))
        + (item.size ? ' (' + Math.round(item.size / 1024) + ' ko)' : '')
        + ' · la même relue : ' + ms(item.warmMs)
        + ' | NON comparable — autre tuile : index seul ' + ms(item.indexMs)
        + ' · accès direct ' + (item.found === false ? 'tuile absente' : ms(item.directMs))
        + (item.error ? ' | ' + item.error : '');
}

/* v17.41 — synthèse de la « référence iPad » (médiane au dixième de ms). */
function npfDiagReferenceSummary() {
    try {
        const s = NPF_DIAG_DETAIL.state;
        const sorted = s.refDurations.slice().sort((a, b) => a - b);
        return {
            n: s.refStats.n,
            median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
            max: s.refStats.maxMs,
            totalMs: Math.round(s.refStats.totalMs),
            skipped: s.refStats.skipped
        };
    } catch (_) {
        return null;
    }
}

function formatNpfDiagReferenceMs(value) {
    return String(value).replace('.', ',') + ' ms';
}

function formatNpfDiagReferenceSummaryLine(item) {
    return 'Référence iPad (petit calcul identique, une fois par minute) : '
        + (item && item.n
            ? item.n + ' mesure(s) · médiane ' + formatNpfDiagReferenceMs(item.median)
                + ' · max ' + formatNpfDiagReferenceMs(item.max)
            : 'aucune mesure')
        + (item && item.skipped ? ' · ' + item.skipped + ' essai(s) reporté(s) pendant un geste' : '');
}

function formatNpfDiagLateReadsLine(item, pending) {
    return 'Lectures ayant dépassé leur délai et poursuivies en arrière-plan : '
        + (Number(item?.total) || 0) + ' terminée(s) en retard · maximum simultané '
        + (Number(item?.maxSimultaneous) || 0)
        + (pending === null || pending === undefined ? '' : ' · encore en cours ' + pending);
}

function formatNpfDiagVisibilityLine(item) {
    const at = Array.isArray(item) ? item[0] : item.at;
    const hidden = Array.isArray(item) ? !!item[1] : !!item.hidden;
    return '   ' + formatNpfDiagClock(at) + ' | ' + (hidden ? 'passage en arrière-plan' : 'retour au premier plan');
}

function formatNpfDiagReaderRecoveryLine(item) {
    return '   ' + formatNpfDiagClock(item.at) + ' | motif : ' + item.reason + ' | ' + item.ms + ' ms | '
        + (item.ok ? 'carte reconstruite' : 'secours (carte non reconstruite)');
}

function formatNpfDiagRestoreTimeoutLine(item) {
    return '   ' + formatNpfDiagClock(item.at) + ' | délai de restitution dépassé (' + item.kind + ', attente '
        + item.ms + ' ms) | zoom ' + (item.zoom === null ? '—' : item.zoom) + ' | fond ' + item.fond
        + ' | tuiles ' + item.tiles;
}

function formatNpfDiagReadMinuteLine(item) {
    return '   ' + formatNpfDiagClock(item.at) + ' | ' + item.n + ' lectures | médiane '
        + (item.median === null ? '—' : item.median + ' ms') + ' | max ' + item.max + ' ms'
        + ' | HT ' + item.ht + ' · Routes ' + item.routes
        + (Array.isArray(item.fm) && item.map
            ? ' | carte ' + item.map + ' · images : ' + item.fm[1] + ' données brutes / ' + item.fm[0] + ' Blob'
            : '')
        + (item.gpsMs !== undefined
            ? ' | traitement GPS ' + item.gpsMs + ' ms (' + item.gpsN + ' positions) · calculateur ' + item.calcMs + ' ms'
            : '')
        + (item.refMs !== undefined
            ? ' | référence iPad ' + (item.refMs === null ? '—' : formatNpfDiagReferenceMs(item.refMs))
                + ' | lectures hors délai ' + item.lateN + ' (max simultané ' + item.lateMax + ')'
            : '')
        + (Array.isArray(item.st)
            ? ' | stockage : écritures IDB ' + item.st[0] + ' (max ' + item.st[1] + ' ms)'
                + ' · autres lectures IDB ' + item.st[2] + ' (max ' + item.st[3] + ' ms)'
                + ' · fichiers cache ' + item.st[4] + ' (max ' + item.st[5] + ' ms)'
                + ' · localStorage ' + item.st[6] + ' (' + item.st[7] + ' ms)'
            : '');
}

function formatNpfDiagFireSelectionLine(item) {
    return '   ' + formatNpfDiagClock(item.at) + ' | ' + item.origin + ' | ' + item.name;
}

function formatNpfDiagSlowBatchLine(item) {
    const since = value => (value === null || value === undefined ? 'jamais' : (value / 1000).toFixed(1) + ' s');
    return '   ' + formatNpfDiagClock(item.at) + ' | paquet de ' + item.n + ' lecture(s) | max ' + item.maxMs + ' ms'
        + ' | HT ' + (item.ht ? 'ON' : 'OFF') + ' · Routes ' + (item.routes ? 'ON' : 'OFF')
        + (item.map ? ' | carte ' + item.map + ' · images ' + formatNpfDiagImageForm(item.form) : '')
        + ' | dernier redimensionnement du dessin HT il y a ' + since(item.sinceHtCanvasUpdate)
        + ' | dernier masquage / réaffichage du calque HT il y a ' + since(item.sinceHtPaneToggle)
        + (item.htPaneVisible === null || item.htPaneVisible === undefined ? '' : ' (calque HT ' + (item.htPaneVisible ? 'affiché' : 'masqué') + ')');
}

/* Résumé des 20 premières lectures du pack (appelé par le journal des lancements). */
function npfDiagFirstPackReadsSummary() {
    try {
        const reads = NPF_DIAG_DETAIL.state.firstPackReads;
        if (!reads.length) return { n: 0, median: null, max: null, layers: '—' };
        const ht = reads.some(item => item.ht);
        const routes = reads.some(item => item.routes);
        return {
            n: reads.length,
            median: npfDiagMedian(reads.map(item => item.ms)),
            max: Math.max(...reads.map(item => item.ms)),
            layers: ht && routes ? 'HT + Routes' : (ht ? 'HT' : (routes ? 'Routes' : 'aucun'))
        };
    } catch (_) {
        return null;
    }
}

function appendNpfDiagPackReadSection(lines) {
    const s = NPF_DIAG_DETAIL.state;
    const first = npfDiagFirstPackReadsSummary();
    lines.push('');
    lines.push('LECTURES DU PACK — PAR MINUTE ET PAQUETS LENTS (v17.39, mesure seule)');
    lines.push('20 premières lectures du pack : ' + (first && first.n
        ? first.n + ' lectures · médiane ' + first.median + ' ms · max ' + first.max + ' ms · calque allumé pendant ces lectures : ' + first.layers
        : 'aucune'));
    lines.push('Par minute (lectures réelles du pack, hors tuiles déjà en mémoire) :');
    const minutes = Array.from(s.readMinutes.values());
    if (!minutes.length) lines.push('   Aucune lecture.');
    minutes.forEach(minute => lines.push(formatNpfDiagReadMinuteLine(npfDiagCompactReadMinute(minute))));
    lines.push('Paquets de lectures lents (> 1 s) :');
    if (!s.slowReadBatches.length) lines.push('   Aucun.');
    s.slowReadBatches.forEach(item => lines.push(formatNpfDiagSlowBatchLine(item)));
    lines.push('Sélections de feu (v17.40) :');
    if (!s.fireSelections.length) lines.push('   Aucune.');
    s.fireSelections.forEach(item => lines.push(formatNpfDiagFireSelectionLine(item)));
    /* v17.41 — référence iPad, lectures hors délai, récupérations, premier
     * plan / arrière-plan, délais de restitution dépassés. */
    lines.push(formatNpfDiagReferenceSummaryLine(npfDiagReferenceSummary()));
    let pendingLate = 0;
    try {
        const t = NPF_STARTUP_DIAGNOSTIC.now();
        s.pendingPackReads.forEach(entry => { if (t - entry.t0 > entry.limit) pendingLate += 1; });
    } catch (_) {}
    lines.push(formatNpfDiagLateReadsLine(s.lateReads, pendingLate));
    lines.push('Récupérations automatiques du lecteur de tuiles (v17.41) :');
    if (!s.readerRecoveries.length) lines.push('   Aucune.');
    s.readerRecoveries.forEach(item => lines.push(formatNpfDiagReaderRecoveryLine(item)));
    lines.push('Délais de restitution dépassés (v17.41) :');
    if (!s.restoreTimeouts.length) lines.push('   Aucun.');
    s.restoreTimeouts.forEach(item => lines.push(formatNpfDiagRestoreTimeoutLine(item)));
    lines.push('Premier plan / arrière-plan (v17.41) :');
    if (!s.visibilityEvents.length) lines.push('   Aucun changement.');
    s.visibilityEvents.forEach(item => lines.push(formatNpfDiagVisibilityLine(item)));
    /* v17.42 — sondes et activité de stockage. */
    lines.push('Sondes après un paquet de lectures lent (v17.43 : la méthode normale est mesurée en premier) :');
    if (!s.packProbes.length) lines.push('   Aucune.' + (s.probeDropped ? ' ' + s.probeDropped + ' abandonnée(s) (carte occupée).' : ''));
    s.packProbes.forEach(item => lines.push(formatNpfDiagPackProbeLine(item)));
    lines.push('Activité de stockage (v17.42 : ouvertures, fermetures, écritures IndexedDB de l’app — 80 dernières) :');
    if (!s.storageEvents.length) lines.push('   Aucune.');
    s.storageEvents.forEach(item => lines.push(formatNpfDiagStorageEventLine(item)));
}

/* v17.38 — FdS / BFG / GLR : requêtes NAS, temps ressenti, messages, pont BFG. */
function isNpfDiagFirstLaunchOfDay() {
    try {
        const launchLog = window.NPF_LAUNCH_LOG;
        if (!launchLog) return null;
        const current = launchLog.current();
        const day = new Date(current.at).toDateString();
        return !launchLog.readAll().some(item => item && item.id !== current.id && new Date(item.at).toDateString() === day && item.at < current.at);
    } catch (_) {
        return null;
    }
}

function formatNpfDiagNasRequestLine(item) {
    return '   ' + formatNpfDiagClock(item.at) + ' | ' + item.service + ' | ' + item.action
        + ' | ' + Math.round(Number(item.ms) || 0) + ' ms | HTTP ' + (item.status || '—')
        + (item.error ? ' | ' + item.error : '');
}

function formatNpfDiagFeltLine(item) {
    return '   ' + formatNpfDiagClock(item.at) + ' | appui ' + item.kind + ' -> ' + item.result
        + ' | ' + (Math.round(Number(item.ms) || 0) / 1000).toFixed(1) + ' s'
        + (Number.isFinite(Number(item.captchaMs)) ? ' (requête du code ' + (Math.round(Number(item.captchaMs)) / 1000).toFixed(1) + ' s)' : '');
}

function formatNpfDiagMessageLine(item) {
    return '   ' + formatNpfDiagClock(item.at) + ' | ' + item.source + ' | « ' + item.text + ' »';
}

function formatNpfDiagBfgAttemptLine(item) {
    return '   ' + formatNpfDiagClock(item.at) + ' | tentative ' + item.attempt + ' | ' + item.result
        + ' | ' + Math.round(Number(item.ms) || 0) + ' ms'
        + (item.httpStatus ? ' | HTTP ' + item.httpStatus : '')
        + (item.error ? ' | ' + item.error : '');
}

function appendNpfDiagNasSection(lines) {
    const s = NPF_DIAG_DETAIL.state;
    const firstOfDay = isNpfDiagFirstLaunchOfDay();
    lines.push('');
    lines.push('FdS / BFG / TRAFIC MOYENS NATIONAUX — PONT BFG, TEMPS RESSENTI, MESSAGES, REQUÊTES NAS (v17.38, mesure seule)');
    lines.push('Premier lancement de la journée : ' + (firstOfDay === null ? 'inconnu' : (firstOfDay ? 'OUI' : 'NON'))
        + ' | pont BFG : ' + (typeof npfBfgBridgeLastStatus !== 'undefined' ? npfBfgBridgeLastStatus : '—'));
    const block = (title, list, formatter, empty) => {
        lines.push(title);
        if (!list.length) lines.push('   ' + empty);
        list.forEach(item => { try { lines.push(formatter(item)); } catch (_) {} });
    };
    block('Pont BFG (tentatives) :', s.bfgAttempts, formatNpfDiagBfgAttemptLine, 'Aucune tentative dans cette session.');
    block('Temps ressenti (appui -> affichage) :', s.felt, formatNpfDiagFeltLine, 'Aucun appui FdS / GAAR / Trafic Moyens Nationaux.');
    block('Messages FdS / BFG / Trafic Moyens Nationaux affichés :', s.messages, formatNpfDiagMessageLine, 'Aucun message.');
    block('Requêtes NAS (30 dernières) :', s.nasRequests, formatNpfDiagNasRequestLine, 'Aucune requête.');
}

/* v17.40 — messages affichés en bandeau (à la place des anciennes alertes). */
function safe_npfDiagBannerHeader(lines) {
    try {
        const s = NPF_DIAG_DETAIL.state;
        lines.push('Messages affichés en bandeau (remplacent les alertes) : ' + s.bannerCount
            + (s.lastBanner ? ' | dernier ' + formatNpfDiagClock(s.lastBanner.at) + ' « ' + s.lastBanner.text + ' »' : ''));
    } catch (_) {}
}

/* v17.37 — journal des lancements et stockage local (mesure seule). */
function formatNpfDiagChars(count) {
    const chars = Math.max(0, Math.round(Number(count) || 0));
    return chars.toLocaleString('fr-FR') + ' car. (≈ ' + (chars * 2 / 1048576).toFixed(2).replace('.', ',') + ' Mo)';
}

function formatNpfDiagDateTime(at) {
    return Number(at)
        ? new Date(Number(at)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + formatNpfDiagClock(at)
        : '—';
}

function describeNpfDiagGlrExpiry(token, exp, referenceAt) {
    if (!token) return 'aucune session enregistrée';
    if (!Number(exp)) return 'session présente, échéance inconnue';
    const deltaMin = Math.round((Number(exp) - Number(referenceAt)) / 60000);
    return 'échéance ' + formatNpfDiagDateTime(exp)
        + (deltaMin >= 0 ? ' — encore ' + deltaMin + ' min' : ' — dépassée de ' + (-deltaMin) + ' min');
}

function formatNpfDiagStorageTop(top) {
    return (Array.isArray(top) ? top : [])
        .map(([key, size]) => key + ' ' + Math.round(Number(size) || 0).toLocaleString('fr-FR'))
        .join(' · ') || '—';
}

function formatNpfDiagRefusedWrites(list) {
    return (Array.isArray(list) && list.length)
        ? list.map(item => formatNpfDiagClock(item.at) + ' ' + item.key + ' (' + Math.round(Number(item.size) || 0).toLocaleString('fr-FR') + ' car., ' + (item.error || 'refus') + ')').join(' · ')
        : 'aucune';
}

function appendNpfDiagLaunchStorageHeader(lines) {
    const launchLog = window.NPF_LAUNCH_LOG;
    if (!launchLog) {
        lines.push('Journal des lancements NPF-Q400 : indisponible');
        return;
    }
    const summary = launchLog.storageSummary();
    const current = launchLog.current();
    const readRaw = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
    const glrToken = !!readRaw('npfGlobalLinkSessionV1');
    const glrExp = Number(readRaw('npfGlobalLinkSessionExpV1')) || 0;
    lines.push(
        'Stockage local : total ' + formatNpfDiagChars(summary.total)
        + ' | 5 plus grosses clés (car.) : ' + formatNpfDiagStorageTop(summary.top)
    );
    lines.push('Écritures localStorage refusées (cette session) : ' + formatNpfDiagRefusedWrites(launchLog.refusedWrites()));
    try { appendNpfDiagV1746HeaderLines(lines); } catch (_) {}
    try { appendNpfDiagV1749GestureLines(lines); } catch (_) {}
    try { appendNpfDiagV1750VrpLine(lines); } catch (_) {}
    try { appendNpfDiagV1752TileLine(lines); } catch (_) {}
    try { appendNpfDiagV1753DeclinationLine(lines); } catch (_) {}
    try { appendNpfDiagV1756MemoryLine(lines); } catch (_) {}
    safe_npfDiagBannerHeader(lines);
    lines.push(
        'SafeSky (showTrafficLayer) relu au lancement : ' + JSON.stringify(current.safeSkyAtLaunch)
        + ' | valeur actuelle : ' + JSON.stringify(readRaw('showTrafficLayer'))
    );
    lines.push(
        'Trafic Moyens Nationaux échéance locale (expiresAt) : ' + describeNpfDiagGlrExpiry(glrToken, glrExp, Date.now())
        + ' | heure iPad ' + formatNpfDiagDateTime(Date.now())
        + ' | au lancement : ' + describeNpfDiagGlrExpiry(current.glrAtLaunch?.token, current.glrAtLaunch?.exp, current.at)
    );
}

function appendNpfDiagLaunchSection(lines) {
    const launchLog = window.NPF_LAUNCH_LOG;
    lines.push('');
    lines.push('DERNIERS LANCEMENTS (5 derniers, NPF-Q400 TEST ; écrits à la carte complète ou dès une erreur)');
    if (!launchLog) {
        lines.push('   Journal indisponible.');
        return;
    }
    const list = launchLog.readAll().slice();
    const current = launchLog.current();
    if (!list.some(item => item && item.id === current.id)) {
        list.push({ ...current, steps: [], notWritten: true });
    }
    list.reverse().forEach((item, index) => {
        const isCurrent = item.id === current.id;
        lines.push(
            (index + 1) + '. ' + formatNpfDiagDateTime(item.at) + ' | ' + (item.version || '—')
            + ' | ' + (item.status || '—') + (item.notWritten ? ' (lancement en cours, pas encore écrit)' : '')
            + (isCurrent ? ' | lancement actuel' : '')
            + ' | page contrôlée par le service worker : ' + (item.controlled ? 'oui' : 'non')
            + (item.reloadReason ? ' | rechargement : ' + item.reloadReason : '')
        );
        lines.push(
            '   SafeSky (showTrafficLayer) relu au lancement ' + JSON.stringify(item.safeSkyAtLaunch)
            + (item.safeSkyAtWrite !== undefined ? ' · à l’écriture ' + JSON.stringify(item.safeSkyAtWrite) : '')
            + ' | Trafic Moyens Nationaux au lancement : ' + describeNpfDiagGlrExpiry(item.glrAtLaunch?.token, item.glrAtLaunch?.exp, item.at)
        );
        if (item.firstReads !== undefined || item.layersAtLaunch) {
            const first = item.firstReads;
            const sincePrevious = Number(item.previousAt) ? Math.round((Number(item.at) - Number(item.previousAt)) / 1000) : null;
            lines.push('   20 premières lectures du pack : ' + (first && first.n
                ? first.n + ' lectures · médiane ' + first.median + ' ms · max ' + first.max + ' ms · calque allumé pendant ces lectures : ' + first.layers
                : 'aucune au moment de l’écriture')
                + ' | au lancement : HT ' + (item.layersAtLaunch?.ht === 'true' ? 'ON' : 'OFF')
                + ' · Routes ' + (item.layersAtLaunch?.routes === 'true' ? 'ON' : 'OFF')
                + ' | depuis le lancement précédent : ' + (sincePrevious === null ? 'inconnu'
                    : (sincePrevious >= 60 ? Math.floor(sincePrevious / 60) + ' min ' + (sincePrevious % 60) + ' s' : sincePrevious + ' s')));
        }
        if (item.storage) {
            lines.push('   Stockage local : ' + formatNpfDiagChars(item.storage.total) + ' | ' + formatNpfDiagStorageTop(item.storage.top));
        }
        lines.push('   Écritures refusées : ' + formatNpfDiagRefusedWrites(item.refusedWrites));
        const errors = Array.isArray(item.errors) ? item.errors : [];
        if (!errors.length) lines.push('   Erreurs : aucune');
        errors.forEach(error => lines.push(
            '   Erreur + ' + ((Number(error.t) || 0) / 1000).toFixed(2) + ' s | ' + error.type + ' | ' + error.message
            + (error.source ? ' | ' + error.source : '')
        ));
        const steps = Array.isArray(item.steps) ? item.steps : [];
        if (steps.length) {
            lines.push('   Étapes : ' + steps.map(([label, t, detail]) => (
                label + ' ' + ((Number(t) || 0) / 1000).toFixed(2) + ' s' + (detail ? ' (' + detail + ')' : '')
            )).join(' · '));
        }
    });
}

/* v17.36 — recentrage économe : état, périodes, comparaison ON / OFF. */
function getNpfDiagEcoPeriodDurationMs(period) {
    const end = period.end === null ? NPF_STARTUP_DIAGNOSTIC.now() : period.end;
    return Math.max(0, end - period.start);
}

function appendNpfDiagEconomicHeader(lines) {
    const s = NPF_DIAG_DETAIL.state;
    const current = (() => { try { return isNpfEconomicRecenterEnabled() ? 'ON' : 'OFF'; } catch (_) { return '?'; } })();
    lines.push(
        'Recentrage économe (TEST) : ' + current + ' actuellement | périodes : '
        + (s.ecoPeriods.map(period => (period.on ? 'ON ' : 'OFF ') + formatNpfDiagClock(period.startAt) + ' -> '
            + (period.endAt ? formatNpfDiagClock(period.endAt) : 'en cours')
            + ' (' + Math.round(getNpfDiagEcoPeriodDurationMs(period) / 60000 * 10) / 10 + ' min)').join(' ; ') || '—')
    );
}

function appendNpfDiagEconomicSection(lines) {
    const s = NPF_DIAG_DETAIL.state;
    const r = value => Math.round(Number(value) || 0);
    const avg = (total, n) => (n > 0 ? Math.round(total / n * 10) / 10 : 0);
    lines.push('');
    lines.push('RECENTRAGE ÉCONOME — COMPARAISON ON / OFF (v17.36 ; GPS réel pour recentrages et chaîne GPS)');
    ['ON', 'OFF'].forEach(mode => {
        const stat = s.ecoStats[mode];
        const minutes = s.ecoPeriods
            .filter(period => (period.on ? 'ON' : 'OFF') === mode)
            .reduce((sum, period) => sum + getNpfDiagEcoPeriodDurationMs(period), 0) / 60000;
        if (!stat) {
            lines.push(mode + ' | ' + (Math.round(minutes * 10) / 10) + ' min | aucune mesure');
            return;
        }
        const perMinute = value => (minutes > 0 ? Math.round(value / minutes * 10) / 10 : 0);
        lines.push(
            mode + ' | ' + (Math.round(minutes * 10) / 10) + ' min'
            + ' | recentrages ' + stat.recenters + ' (' + perMinute(stat.recenters) + ' / min) · évités ' + stat.skipped
            + ' | blocages > 100 ms ' + stat.blocks + ' (' + perMinute(stat.blocks) + ' / min, total ' + r(stat.blockMs) + ' ms, max ' + r(stat.blockMax) + ' ms)'
            + ' | chaîne GPS ' + stat.gpsCycles + ' positions, moy ' + avg(stat.gpsMs, stat.gpsCycles) + ' / max ' + r(stat.gpsMax) + ' ms'
            + ' | canvas ' + stat.canvasCalls + ' appels, moy ' + avg(stat.canvasMs, stat.canvasCalls) + ' / max ' + r(stat.canvasMax) + ' ms, total ' + r(stat.canvasMs) + ' ms'
            + ' | attentes HT ' + stat.htWaits + ' dont interrompues ' + stat.htInterrupted
        );
    });
    lines.push('Changements de l\'interrupteur :');
    const changes = s.ecoPeriods.slice(1);
    if (!changes.length) lines.push('   Aucun.');
    changes.forEach(period => lines.push(
        '   ' + formatNpfDiagClock(period.startAt) + ' | + ' + (period.start / 1000).toFixed(2) + ' s | ' + (period.on ? 'ON' : 'OFF')
    ));
}

/* v17.34 — attentes de calque (HT surtout) et vérification des tuiles. */
function appendNpfDiagV1734ExportSections(lines) {
    const s = NPF_DIAG_DETAIL.state;
    const r = value => Math.round(Number(value) || 0);
    const avg = (total, n) => (n > 0 ? Math.round(total / n) : 0);

    lines.push('');
    lines.push('ATTENTES HT ET VÉRIFICATION DES TUILES (v17.34, mesure seule)');
    lines.push('Attentes par fonction et calque (démarrées · prêtes · interrompues | durée moy / max | au départ : suivi GPS, HT ON) :');
    const totals = Object.entries(s.layerWaitTotals).sort((a, b) => b[1].started - a[1].started);
    if (!totals.length) lines.push('   Aucune attente.');
    totals.forEach(([key, total]) => lines.push(
        '   ' + key + ' | ' + total.started + ' · ' + total.ready + ' · ' + total.interrupted
        + ' | moy ' + avg(total.totalMs, total.started) + ' / max ' + r(total.maxMs) + ' ms'
        + ' | suivi GPS ' + total.gpsFollow + ' · HT ON ' + total.htOn
        + ' | ' + Object.entries(total.reasons).map(([reason, count]) => reason + ' ' + count).join(' · ')
    ));

    [['réels', s.waitCorrelation, s.gpsRecenterTimes], ['simulés', s.waitCorrelationSim, s.gpsRecenterTimesSim]]
        .forEach(([title, correlation, times]) => lines.push(
            'Attentes HT interrompues et recentrages ' + title + ' (±200 ms) : ' + correlation.interrupted + ' interrompues | '
            + correlation.startNear + ' commencent près d\'un recentrage · ' + correlation.endNear + ' finissent près d\'un recentrage · '
            + correlation.bothNear + ' les deux | recentrages enregistrés : ' + times.length
            + ' (au hasard, à 1 recentrage/s : ≈ 40 %)'
        ));

    const check = s.tileCheck;
    lines.push(
        'Vérifications des tuiles (getVisibleBaseTileLoadStateForSia, getBoundingClientRect sur chaque tuile) : '
        + check.calls + ' appels | moy ' + (check.calls ? (check.totalMs / check.calls).toFixed(1) : '0') + ' ms · max '
        + r(check.maxMs) + ' ms · total ' + r(check.totalMs) + ' ms | max ' + check.maxPerSecond + ' appels en 1 s'
        + ' | tuiles mesurées ≈ ' + (check.calls ? Math.round(check.tiles / check.calls) : 0) + ' par appel'
    );
    lines.push(
        '   Appelants : ' + (Object.entries(check.byCaller)
            .sort((a, b) => b[1] - a[1])
            .map(([caller, count]) => caller + ' ' + count)
            .join(' · ') || '—')
    );

    lines.push('Par minute (heure | suivi GPS · HT | recentrages | attentes HT démarrées / prêtes / interrompues, moy / max | vérifications : appels, total, max, tuiles moy | appelants) :');
    const minutes = [...s.waitMinutes.values()].filter(bucket => bucket.checks || bucket.htStarted || bucket.recenters);
    if (!minutes.length) lines.push('   Aucune activité.');
    minutes.forEach(bucket => lines.push(
        '   ' + formatNpfDiagClock(bucket.at) + ' | ' + (bucket.gpsFollow ? 'GPS' : '—') + ' · ' + (bucket.htOn ? 'HT' : '—')
        + ' | ' + bucket.recenters + (bucket.recentersSim ? ' + ' + bucket.recentersSim + ' SIM' : '')
        + ' | ' + bucket.htStarted + ' / ' + bucket.htReady + ' / ' + bucket.htInterrupted
        + ', ' + avg(bucket.htWaitMs, bucket.htReady + bucket.htInterrupted) + ' / ' + r(bucket.htWaitMax) + ' ms'
        + ' | ' + bucket.checks + ', ' + r(bucket.checkMs) + ' ms, ' + r(bucket.checkMax) + ' ms, '
        + (bucket.checks ? Math.round(bucket.checkTiles / bucket.checks) : 0)
        + ' | ' + Object.entries(bucket.byCaller).map(([caller, count]) => caller + ' ' + count).join(' · ')
    ));

    const interrupted = s.layerWaits.filter(item => item.label === 'HT' && item.reason !== 'prête').slice(-20);
    if (interrupted.length) {
        lines.push('20 dernières attentes HT interrompues :');
        interrupted.forEach(item => lines.push(
            '   ' + formatNpfDiagClock(item.at) + ' | + ' + (item.t / 1000).toFixed(2) + ' s | ' + item.fnName + ' | ' + item.ms + ' ms | '
            + item.reason + ' | suivi GPS ' + (item.gpsFollow ? 'oui' : 'non') + ' · HT ' + (item.htOn ? 'ON' : 'OFF')
            + ' | recentrage ±200 ms : début ' + (item.startNear === null ? '?' : (item.startNear ? 'oui' : 'non'))
            + ' · fin ' + (item.endNear === null ? '?' : (item.endNear ? 'oui' : 'non'))
        ));
    }
}

function appendNpfDiagDetailRestoredSections(lines, detail) {
    if (!detail || typeof detail !== 'object') return;
    const counts = detail.counts || {};
    lines.push('');
    lines.push(
        'Totaux session précédente : ' + (counts.gestures || 0) + ' gestes | '
        + (counts.blocks || 0) + ' blocages JS > 100 ms (max ≈ ' + (counts.blockMaxMs || 0) + ' ms) | '
        + (counts.restores || 0) + ' restitutions | ' + (counts.ht || 0) + ' reconstructions HT | '
        + (counts.routes || 0) + ' reconstructions Routes'
    );
    if (detail.memoryPeak) {
        lines.push('Pic mémoire canvas : ' + detail.memoryPeak.totalMb + ' Mo (' + detail.memoryPeak.reason + ')');
    }
    const section = (title, list, formatter) => {
        if (!Array.isArray(list) || !list.length) return;
        lines.push(title);
        list.forEach(item => {
            try { lines.push(formatter(item)); } catch (_) {}
        });
    };
    section('Périodes de simulation :', detail.simPeriods, period => '   ' + formatNpfDiagClock(period.startAt) + ' -> '
        + (period.endAt ? formatNpfDiagClock(period.endAt) : 'fin non enregistrée') + ' | '
        + (period.settings || []).map(item => formatNpfDiagSimSettings(item)).join(' ; '));
    section('Changements du bouton Suivi :', detail.followChanges, item => '   ' + formatNpfDiagClock(item.at) + ' | '
        + (item.active ? 'ACTIVÉ' : 'DÉSACTIVÉ') + ' | ' + item.mode);
    section('Lectures du pack par minute :', detail.readMinutes, formatNpfDiagReadMinuteLine);
    section('Paquets de lectures lents (> 1 s) :', detail.slowReadBatches, formatNpfDiagSlowBatchLine);
    section('Sélections de feu :', detail.fireSelections, formatNpfDiagFireSelectionLine);
    if (detail.reference) lines.push(formatNpfDiagReferenceSummaryLine(detail.reference));
    if (detail.lateReads) lines.push(formatNpfDiagLateReadsLine(detail.lateReads, null));
    section('Récupérations automatiques du lecteur de tuiles :', detail.readerRecoveries, formatNpfDiagReaderRecoveryLine);
    section('Délais de restitution dépassés :', detail.restoreTimeouts, formatNpfDiagRestoreTimeoutLine);
    section('Premier plan / arrière-plan :', detail.visibility, formatNpfDiagVisibilityLine);
    section('Sondes après un paquet de lectures lent :', detail.packProbes, formatNpfDiagPackProbeLine);
    section('Activité de stockage :', detail.storage, formatNpfDiagStorageEventLine);
    section('Pont BFG (tentatives) :', detail.bfgAttempts, formatNpfDiagBfgAttemptLine);
    section('Temps ressenti FdS / Trafic Moyens Nationaux :', detail.felt, formatNpfDiagFeltLine);
    section('Messages FdS / BFG / Trafic Moyens Nationaux affichés :', detail.messages, formatNpfDiagMessageLine);
    section('Requêtes NAS (dernières) :', detail.nasRequests, formatNpfDiagNasRequestLine);
    section('Repères :', detail.markers, formatNpfDiagMarkerLine);
    section('Blocages JS > 100 ms (premiers) :', detail.firstBlocks, formatNpfDiagBlockLine);
    section('Blocages JS > 100 ms (derniers) :', detail.blocks, formatNpfDiagBlockLine);
    section('Gestes (derniers) :', detail.gestures, formatNpfDiagGestureLine);
    section('Restitutions (dernières) :', detail.restores, formatNpfDiagRestoreLine);
    section('Reconstructions HT (dernières) :', detail.ht, formatNpfDiagHtLine);
    section('Reconstructions Routes (dernières) :', detail.routes, formatNpfDiagRoutesLine);
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

function getNpfStartupDiagnosticOverlaySnapshot(options = {}) {
    /*
     * v17.33 — DIAG D1 : sur demande, ou pendant un geste manuel, aucune mesure
     * qui force un calcul de mise en page : les tuiles chargées sont comptées
     * depuis la GridLayer (niveau courant) au lieu de getBoundingClientRect.
     */
    /* v17.34 — suivi GPS actif : tout instantané automatique passe aussi en
     * mode sans mesure DOM. */
    const inGesture = npfDiagIsManualGestureInProgress();
    const inGpsFollow = !inGesture && npfDiagIsGpsFollowActive();
    const layoutFree = !!options?.layoutFree || inGesture || inGpsFollow;
    try {
        const stats = NPF_DIAG_DETAIL.state.snapshotStats;
        if (!layoutFree) stats.dom += 1;
        else if (inGesture) stats.gesture += 1;
        else if (inGpsFollow) stats.gpsFollow += 1;
        else stats.requested += 1;
    } catch (_) {}
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
        tilesVisible: layoutFree
            ? npfDiagCountLoadedCurrentTiles()
            : (typeof countVisibleLoadedBaseTiles === 'function' ? countVisibleLoadedBaseTiles() : 0),
        ...(layoutFree ? { tilesMeasure: 'sans-DOM' } : {}),
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
    const safeDetail = detail || 'état';
    /*
     * v17.34 — suivi GPS actif, hors geste : si l'événement ne sera pas
     * conservé, l'instantané complet n'est pas calculé. Les compteurs de la
     * synthèse reçoivent les mêmes champs, lus sans mesure DOM ; le tri des
     * événements utilise ces mêmes valeurs (celles qu'aurait donné
     * l'instantané sans mesure DOM).
     */
    if (npfDiagIsGpsFollowActive() && !npfDiagIsManualGestureInProgress()) {
        const light = getNpfDiagLightOverlayMetrics();
        let retained = true;
        try { retained = NPF_STARTUP_DIAGNOSTIC.wouldRetainInteraction('Couches carte', safeDetail, light); } catch (_) {}
        if (!retained) {
            try { NPF_DIAG_DETAIL.state.snapshotStats.skipped += 1; } catch (_) {}
            return npfDiagSiaInteraction('Couches carte', safeDetail, light);
        }
    }
    const snapshot = getNpfStartupDiagnosticOverlaySnapshot();
    return npfDiagSiaInteraction('Couches carte', safeDetail, snapshot);
}

/* v17.34 — champs utiles à la synthèse et au tri, lus sans mesure DOM. */
function getNpfDiagLightOverlayMetrics() {
    return {
        htRenderedSegments: Number(highVoltageLinesRenderedFeatureCount || 0),
        routesRenderedSegments: getNpfRenderedRoadFeatureCount(),
        tilesVisible: npfDiagCountLoadedCurrentTiles(),
        tilesMeasure: 'sans-DOM',
        npfReadsActive: Number(directOfflineNpfActiveReads || 0),
        npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
        npfReadsAborted: Number(directOfflineNpfAbortedReadCount || 0),
        npfQueuedDiscarded: Number(directOfflineNpfQueuedDiscardCount || 0),
        npfTileRetries: Number(directOfflineNpfTileRetryCount || 0)
    };
}

/*
 * v17.34 — champ « tilesVisible » des événements DIAG : en suivi GPS, hors
 * geste, compté sans mesure DOM (et marqué). Valeur DIAG seulement : aucune
 * décision de l'application ne l'utilise.
 */
function npfDiagTilesVisibleFields() {
    if (npfDiagIsGpsFollowActive() && !npfDiagIsManualGestureInProgress()) {
        return { tilesVisible: npfDiagCountLoadedCurrentTiles(), tilesMeasure: 'sans-DOM' };
    }
    return { tilesVisible: typeof countVisibleLoadedBaseTiles === 'function' ? countVisibleLoadedBaseTiles() : 0 };
}
function npfDiagTilesVisibleLabel() {
    const fields = npfDiagTilesVisibleFields();
    return String(fields.tilesVisible) + (fields.tilesMeasure ? ' (sans-DOM)' : '');
}

/* v17.34 — suivi GPS centré actif. */
function npfDiagIsGpsFollowActive() {
    try { return NPF_DIAG_DETAIL.isGpsFollowActive(); } catch (_) { return false; }
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
    const finalSnapshot = endSnapshot || getNpfStartupDiagnosticOverlaySnapshot({
        layoutFree: sample.source === 'gps-follow'
    });

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
        diagGpsSim: NPF_STARTUP_DIAGNOSTIC.state.gpsSummarySim,
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
    try { appendNpfDiagSimulationHeader(lines); } catch (_) {}
    try { appendNpfDiagEconomicHeader(lines); } catch (_) {}
    try { appendNpfDiagLaunchStorageHeader(lines); } catch (_) {}
    lines.push('');
    lines.push('################ SESSION COURANTE ################');
    lines.push(
        'Début : ' + new Date(Number(diag.monitorStartedWallAt) || Date.now()).toLocaleString('fr-FR')
        + ' | toutes les sections jusqu’à « SESSION PRÉCÉDENTE » concernent cette session'
    );
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
        + runtime.vacDisplayedAirportCount + ' aérodromes OACI affichés dans NPF-Q400'
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
        'Suivi GPS réel : '
        + (gpsDiag.positions || 0) + ' positions | '
        + (gpsDiag.gpsFollowRecenterCount || 0) + ' recentrages auto | '
        + 'intervalle GPS moy ' + fmtAvg(gpsDiag.intervalTotalMs || 0, gpsDiag.intervalCount || 0) + ' ms / max ' + Math.round(gpsDiag.maxIntervalMs || 0) + ' ms | '
        + 'précision moy ' + fmtAvg(gpsDiag.accuracyTotalM || 0, gpsDiag.accuracyCount || 0) + ' m / max ' + Math.round(gpsDiag.maxAccuracyM || 0) + ' m | '
        + 'déplacement centre max ' + Math.round(gpsDiag.maxCenterShiftM || 0) + ' m'
        + (Number(gpsDiag.speedCount || 0) > 0
            ? ' | vitesse moy ' + Math.round(Number(gpsDiag.speedTotalMps || 0) / Number(gpsDiag.speedCount) * 1.9438444924406)
                + ' kt / max ' + Math.round(Number(gpsDiag.maxSpeedMps || 0) * 1.9438444924406) + ' kt'
            : ' | vitesse GPS non fournie')
    );
    /* v17.35 — positions simulées : ligne séparée ; recentrages par raison. */
    const gpsSimDiag = runtime.diagGpsSim || {};
    const formatReasons = summary => Object.entries(summary?.recenterReasons || {})
        .map(([reason, count]) => reason + ' ' + count).join(' · ') || '—';
    if (Number(gpsSimDiag.positions || 0) > 0 || Number(gpsSimDiag.recenterCount || 0) > 0) {
        lines.push(
            'Suivi GPS simulé : '
            + (gpsSimDiag.positions || 0) + ' positions | '
            + (gpsSimDiag.recenterCount || 0) + ' recentrages | '
            + 'intervalle moy ' + fmtAvg(gpsSimDiag.intervalTotalMs || 0, gpsSimDiag.intervalCount || 0) + ' ms / max ' + Math.round(gpsSimDiag.maxIntervalMs || 0) + ' ms | '
            + 'précision non fournie (non comptée) | '
            + (Number(gpsSimDiag.speedCount || 0) > 0
                ? 'vitesse moy ' + Math.round(Number(gpsSimDiag.speedTotalMps || 0) / Number(gpsSimDiag.speedCount) * 1.9438444924406)
                    + ' kt / max ' + Math.round(Number(gpsSimDiag.maxSpeedMps || 0) * 1.9438444924406) + ' kt'
                : 'vitesse —')
        );
    } else {
        lines.push('Suivi GPS simulé : aucune position simulée');
    }
    lines.push(
        'Recentrages par raison : réel ' + formatReasons(gpsDiag)
        + ' | simulé ' + formatReasons(gpsSimDiag)
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
        + 'SIA ' + Math.round(layerDiag.siaRefreshCount || 0) + ' refresh (' + Math.round(layerDiag.siaSlowCount || 0) + ' lents, max ' + Math.round(layerDiag.siaMaxMs || 0) + ' ms'
        + ', reconstruction évitée (identique) ' + Math.round(layerDiag.siaIdenticalAvoidedCount || 0)
        + ', objets lus par l\'index : moyenne ' + (layerDiag.siaIndexReadCount ? Math.round(layerDiag.siaIndexReadTotal / layerDiag.siaIndexReadCount) : 0) + ' · max ' + Math.round(layerDiag.siaIndexReadMax || 0) + ') | '
        + 'HT ' + Math.round(layerDiag.htRenderCount || 0) + ' rendus | Routes ' + Math.round(layerDiag.roadRenderCount || 0) + ' rendus | '
        + 'filtres ' + Math.round(layerDiag.filterActivationCount || 0)
        + ' événements (attente tuiles max ' + Math.round(layerDiag.filterActivationMaxWaitMs || 0)
        + ' ms / couche max ' + Math.round(layerDiag.filterLayerMaxMs || 0) + ' ms)'
        + ' | SIA GPS sans traitement ' + Math.round(layerDiag.siaGpsZeroWorkCount || 0) + ' (non listés)'
    );
    lines.push(
        'Charge DIAG : '
        + Math.round(runtime.diagPersistCount || 0) + ' écritures groupées | '
        + 'écriture max ' + Math.round(runtime.diagPersistMaxMs || 0) + ' ms | '
        + 'temps total ' + Math.round(runtime.diagPersistTotalMs || 0) + ' ms'
        + ' | taille ' + Math.round(Number(NPF_STARTUP_DIAGNOSTIC.state.persistChars) || 0).toLocaleString('fr-FR') + ' car.'
        + ' | reportées (geste) ' + Math.round(Number(NPF_STARTUP_DIAGNOSTIC.state.persistDeferred) || 0)
        + (() => {
            /* v17.41 — coût de la « référence iPad ». */
            try {
                const reference = npfDiagReferenceSummary();
                if (!reference) return '';
                const elapsedMs = Math.max(1, NPF_STARTUP_DIAGNOSTIC.now());
                return ' | référence iPad : ' + reference.n + ' mesure(s), total ' + reference.totalMs + ' ms ('
                    + ((reference.totalMs / elapsedMs) * 100).toFixed(3).replace('.', ',') + ' % du temps)';
            } catch (_) {
                return '';
            }
        })()
        + (() => {
            try {
                const launchCost = window.NPF_LAUNCH_LOG?.cost?.();
                if (!launchCost) return '';
                return ' | journal des lancements : ' + launchCost.writes + ' écriture(s)'
                    + ', max ' + Math.round(launchCost.maxMs) + ' ms'
                    + ', total ' + Math.round(launchCost.totalMs) + ' ms'
                    + (launchCost.refused ? ', ' + launchCost.refused + ' refusée(s)' : '');
            } catch (_) {
                return '';
            }
        })()
    );
    lines.push(
        'Authentification : BFG↔NPF-Q400 associé ' + (runtime.bfgPaired ? 'OUI' : 'NON')
        + ' | session FdS/GAAR ' + (runtime.briefingSessionActive ? 'ACTIVE' : 'ABSENTE/EXPIRÉE')
        + ' | pont BFG ' + (runtime.bfgBridgeLastStatus || '—')
        + (runtime.bfgBridgeLastError ? ' (' + runtime.bfgBridgeLastError + ')' : '')
        + ' | session Trafic Moyens Nationaux ' + (runtime.glrSessionActive ? 'ACTIVE' : 'ABSENTE/EXPIRÉE')
        + ' | état Trafic Moyens Nationaux ' + (runtime.glrLastAuthState || '—')
        + ' | action ' + (runtime.glrLastAction || '—')
        + (runtime.glrLastHttpStatus ? ' HTTP ' + runtime.glrLastHttpStatus : '')
        + (runtime.glrLastError ? ' (' + runtime.glrLastError + ')' : '')
    );
    const restoredDiag = runtime.diagRestoredSession;
    if (restoredDiag) {
        lines.push(
            'Session précédente restaurée (détail en fin de fichier) : sauvegarde '
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
    try {
        const snapshotStats = NPF_DIAG_DETAIL.state.snapshotStats;
        lines.push(
            'Instantanés : ' + snapshotStats.dom + ' avec mesure DOM | sans mesure DOM : '
            + snapshotStats.gesture + ' pendant un geste, ' + snapshotStats.gpsFollow + ' en suivi GPS, '
            + snapshotStats.requested + ' sur demande | ' + snapshotStats.skipped
            + ' non calculés (suivi GPS, événement non conservé)'
        );
        lines.push(
            'ATTENTION : « tilesMeasure=sans-DOM » = tuiles chargées du niveau courant, marge comprise ;'
            + ' à ne pas comparer aux « tilesVisible » mesurés par le DOM (anciens DIAG).'
        );
    } catch (_) {}
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

    /* v16.36 — événements de mise à jour PWA conservés brièvement entre deux rechargements. */
    try {
        const swDiagKey = window.NPF_SW_UPDATE_DIAG_STORAGE_KEY || 'npfSwUpdateDiagV1';
        const swEvents = JSON.parse(sessionStorage.getItem(swDiagKey) || '[]');
        const recentSwEvents = Array.isArray(swEvents)
            ? swEvents.filter(item => item && Number(item.at) >= Date.now() - 15 * 60 * 1000)
            : [];
        lines.push('');
        lines.push('MISE À JOUR PWA (15 dernières minutes, peut inclure la session précédente)');
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
    lines.push('BLOCAGES JAVASCRIPT (mesure historique à 1 Hz, 20 plus longs — voir aussi la liste chronologique 50 ms)');
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

    try {
        appendNpfDiagDetailExportSections(lines);
    } catch (error) {
        lines.push('DIAG détaillé indisponible : ' + (error?.message || error));
    }

    const restoredSession = runtime.diagRestoredSession;
    if (restoredSession) {
        lines.push('');
        lines.push('################ SESSION PRÉCÉDENTE RESTAURÉE (avant rechargement de NPF-Q400) ################');
        lines.push('Les lignes ci-dessous ne concernent PAS la session courante.');
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
        appendNpfDiagDetailRestoredSections(lines, restoredSession.detail);
    }

    lines.push('');
    lines.push('################ FIN ################');
    lines.push('Mesures enregistrées automatiquement depuis l’ouverture de NPF-Q400.');
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
                    <div>Blocages &gt; 100 ms (mesure 50 ms) : <b>${NPF_DIAG_DETAIL.state.blockCount}</b>${NPF_DIAG_DETAIL.state.blockCount ? ` · max ≈ ${Math.round(NPF_DIAG_DETAIL.state.blockMaxMs)} ms` : ''} · Repères : <b>${NPF_DIAG_DETAIL.state.markers.length}</b></div>
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
                    <button type="button" id="npf-startup-diag-economic" aria-label="Recentrage économe NPF-Q400 (TEST)">Recentrage économe</button>
                    <button type="button" id="npf-startup-diag-marker" aria-label="Marquer un ralentissement">Repère</button>
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
    /* v17.36 — interrupteur TEST « Recentrage économe » (ON par défaut, mémorisé). */
    const economicButton = panel.querySelector('#npf-startup-diag-economic');
    const refreshEconomicButton = () => {
        if (!economicButton) return;
        let enabled = true;
        try { enabled = isNpfEconomicRecenterEnabled(); } catch (_) {}
        economicButton.textContent = `Recentrage économe ${enabled ? 'ON' : 'OFF'}`;
        economicButton.classList.toggle('active', enabled);
        economicButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    };
    refreshEconomicButton();
    economicButton?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        try { setNpfEconomicRecenterEnabled(!isNpfEconomicRecenterEnabled()); } catch (_) {}
        refreshEconomicButton();
    });
    button.addEventListener('click', refreshEconomicButton);

    /* v17.32 — l'heure est prise au contact, avant toute mise à jour du panneau. */
    const markerButton = panel.querySelector('#npf-startup-diag-marker');
    let markerFeedbackTimer = null;
    markerButton?.addEventListener('pointerdown', event => {
        event.stopPropagation();
        const marker = npfDiagAddUserMarker();
        if (!marker) return;
        markerButton.textContent = `Repère ✓ ${marker.n}`;
        clearTimeout(markerFeedbackTimer);
        markerFeedbackTimer = setTimeout(() => { markerButton.textContent = 'Repère'; }, 1500);
    });
    markerButton?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
    });
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
