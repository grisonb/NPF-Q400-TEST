/*
 * v14.80 — nettoyage des états aéroportuaires devenus obsolètes.
 *
 * Toute entrée qui n'existe plus dans les listes actives est retirée des états
 * persistants d'une installation antérieure de la PWA. Brive reste ainsi
 * disponible uniquement sous son code actif LFSL.
 */
const sanitizeStoredAirportState = () => {
    const validAirportCodes = new Set(
        [...pelicanAirports, ...otherAirports]
            .map(airport => normalizeOaciCodeInput(airport?.oaci))
            .filter(Boolean)
    );

    const sanitizeSet = (source) => new Set(
        [...source]
            .map(normalizeOaciCodeInput)
            .filter(oaci => oaci && validAirportCodes.has(oaci))
    );

    const previousDisabledSize = disabledAirports.size;
    const previousWaterSize = waterAirports.size;
    const previousCustomSize = customPelicanAirports.size;

    disabledAirports = sanitizeSet(disabledAirports);
    waterAirports = sanitizeSet(waterAirports);
    customPelicanAirports = sanitizeSet(customPelicanAirports);

    let changed = (
        disabledAirports.size !== previousDisabledSize
        || waterAirports.size !== previousWaterSize
        || customPelicanAirports.size !== previousCustomSize
    );

    const savedBase = normalizeOaciCodeInput(localStorage.getItem('selected_base_oaci'));
    if (savedBase && !validAirportCodes.has(savedBase)) {
        localStorage.removeItem('selected_base_oaci');
        if (selectedBaseOACI === savedBase) selectedBaseOACI = null;
        changed = true;
    }

    if (changed) {
        localStorage.setItem('disabled_airports', JSON.stringify([...disabledAirports]));
        localStorage.setItem('water_airports', JSON.stringify([...waterAirports]));
        localStorage.setItem('custom_pelican_airports', JSON.stringify([...customPelicanAirports]));
    }
};

/*
 * v17.30 — MIGRATION UNIQUE DES CODES OACI CORRIGÉS.
 * Les réglages mémorisés (base, PÉLIC personnalisés, terrains désactivés ou en
 * eau) portaient d'anciens codes erronés. Chaque ancien code est converti
 * directement vers son nouveau code, sans enchaînement : l'ancien LFRT
 * (Saint-Nazaire) devient LFRZ AVANT que l'ancien LFBK ne devienne LFRT
 * (Saint-Brieuc) ; l'ancien LFSX (Montbéliard) devient LFSM AVANT que l'ancien
 * LFSQ ne devienne LFSX (Luxeuil). Une référence à un terrain retiré (absent du
 * SIA) est abandonnée. Exécutée une seule fois (drapeau), sinon un nouveau LFRT
 * ou LFSX légitime serait converti à tort à chaque ouverture. Le drapeau porte
 * le compte rendu, rappelé dans le DIAG à chaque démarrage : la page qui a fait
 * la migration peut être rechargée aussitôt (mise à jour du Service Worker).
 */
const NPF_AIRPORT_CODES_MIGRATION_KEY = 'npfAirportCodesMigrationV1730';
const NPF_AIRPORT_CODES_MIGRATION_MAP = Object.freeze({
    LFCU: 'LFOA', LFLZ: 'LFHP', LFYD: 'LFRD', LFSF: 'LFJL', LFSK: 'LFGA',
    LFRT: 'LFRZ', LFBK: 'LFRT',
    LFSX: 'LFSM', LFSQ: 'LFSX'
});
const NPF_AIRPORT_CODES_REMOVED = Object.freeze(['LFPC', 'LFSR']);

const markStoredAirportCodesMigrationV1730 = (raw) => {
    try {
        const report = JSON.parse(raw);
        if (!report || (!report.converted?.length && !report.dropped?.length)) return;
        npfStartupDiagMark(
            'airport_codes_migration_v1730',
            'Codes OACI — migration v17.30',
            `effectuée le ${report.at || '?'} · convertis : ${report.converted.join(', ') || 'aucun'} · abandonnés (terrain retiré) : ${report.dropped.join(', ') || 'aucun'}`
        );
    } catch (_) {}
};

const migrateStoredAirportCodesV1730 = () => {
    try {
        const existingReport = localStorage.getItem(NPF_AIRPORT_CODES_MIGRATION_KEY);
        if (existingReport) {
            markStoredAirportCodesMigrationV1730(existingReport);
            return;
        }
        const converted = [];
        const dropped = [];
        const migrateCode = (value, where) => {
            const code = normalizeOaciCodeInput(value);
            if (!code) return null;
            if (NPF_AIRPORT_CODES_REMOVED.includes(code)) {
                dropped.push(`${where}:${code}`);
                return null;
            }
            const next = NPF_AIRPORT_CODES_MIGRATION_MAP[code];
            if (next) {
                converted.push(`${where}:${code}->${next}`);
                return next;
            }
            return code;
        };
        [
            ['disabled_airports', 'désactivé'],
            ['water_airports', 'eau'],
            ['custom_pelican_airports', 'PÉLIC']
        ].forEach(([key, where]) => {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            let list = [];
            try { list = JSON.parse(raw); } catch (_) { list = []; }
            if (!Array.isArray(list)) return;
            const next = [...new Set(list.map(code => migrateCode(code, where)).filter(Boolean))];
            localStorage.setItem(key, JSON.stringify(next));
        });
        const savedBase = localStorage.getItem('selected_base_oaci');
        if (savedBase) {
            const nextBase = migrateCode(savedBase, 'base');
            if (nextBase) localStorage.setItem('selected_base_oaci', nextBase);
            else localStorage.removeItem('selected_base_oaci');
        }
        const report = JSON.stringify({ at: new Date().toLocaleString('fr-FR'), converted, dropped });
        localStorage.setItem(NPF_AIRPORT_CODES_MIGRATION_KEY, report);
        markStoredAirportCodesMigrationV1730(report);
    } catch (error) {
        try { npfStartupDiagMark('airport_codes_migration_v1730_error', 'Codes OACI — migration v17.30 en erreur', error?.message || String(error)); } catch (_) {}
    }
};

const loadState = () => {
    migrateStoredAirportCodesV1730();
    const savedDisabled = localStorage.getItem('disabled_airports');
    if (savedDisabled) disabledAirports = new Set(JSON.parse(savedDisabled));
    const savedWater = localStorage.getItem('water_airports');
    if (savedWater) waterAirports = new Set(JSON.parse(savedWater));
    const savedCustomPelic = localStorage.getItem('custom_pelican_airports');
    if (savedCustomPelic) customPelicanAirports = new Set(JSON.parse(savedCustomPelic));

    sanitizeStoredAirportState();

    const savedBase = localStorage.getItem('selected_base_oaci');
    if (savedBase && getAirportByOaci(savedBase)) {
        selectedBaseOACI = savedBase;
    }
};
const saveState = () => {
    localStorage.setItem('disabled_airports', JSON.stringify([...disabledAirports]));
    localStorage.setItem('water_airports', JSON.stringify([...waterAirports]));
    localStorage.setItem('selected_base_oaci', selectedBaseOACI);
    localStorage.setItem('custom_pelican_airports', JSON.stringify([...customPelicanAirports]));
};
window.toggleAirport = oaci => { disabledAirports.has(oaci) ? disabledAirports.delete(oaci) : (disabledAirports.add(oaci), waterAirports.delete(oaci)), saveState(), refreshUI() };
window.toggleWater = oaci => { waterAirports.has(oaci) ? waterAirports.delete(oaci) : (waterAirports.add(oaci), disabledAirports.delete(oaci)), saveState(), refreshUI() };
window.toggleCustomPelican = oaci => {
    const normalizedOaci = normalizeOaciCodeInput(oaci);
    if (!normalizedOaci || !getAirportByOaci(normalizedOaci)) return;

    if (customPelicanAirports.has(normalizedOaci)) {
        customPelicanAirports.delete(normalizedOaci);
        waterAirports.delete(normalizedOaci);
        disabledAirports.delete(normalizedOaci);
        if (selectedPelicanOACI === normalizedOaci) selectedPelicanOACI = null;
    } else {
        customPelicanAirports.add(normalizedOaci);
        disabledAirports.delete(normalizedOaci);
        /*
         * v15.91 — déclarer un terrain comme PÉLIC enrichit seulement la liste
         * des candidats. Le PÉLIC du feu reste choisi par proximité réelle.
         */
    }
    saveState();
    refreshUI();
    if (map) map.closePopup();
};
window.setBaseAirport = oaci => {
    const normalizedOaci = normalizeOaciCodeInput(oaci);
    if (!getAirportByOaci(normalizedOaci)) return;
    selectedBaseOACI = normalizedOaci;
    saveState();
    updateBaseLabels();
    updateCalculatorData();
    if (typeof window.updateBaseSunsetDisplay === 'function') {
        window.updateBaseSunsetDisplay();
    }
    refreshUI();
    if (map) map.closePopup();
};


function getStoredGpsPosition() {
    try {
        const raw = localStorage.getItem(LAST_GPS_POSITION_KEY);
        const parsed = JSON.parse(raw || 'null');
        if (!parsed) return null;
        const lat = Number(parsed.lat);
        const lng = Number(parsed.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng, timestamp: Number(parsed.timestamp) || 0 };
    } catch (_) {
        return null;
    }
}

function saveStoredGpsPosition(lat, lng, timestamp = Date.now()) {
    try {
        localStorage.setItem(LAST_GPS_POSITION_KEY, JSON.stringify({ lat, lng, timestamp }));
    } catch (_) {}
}

function getStartupGpsCenterZoom() {
    if (!map) return STARTUP_GPS_CENTER_ZOOM;

    const minZoom = typeof map.getMinZoom === 'function' ? map.getMinZoom() : GLOBAL_MIN_ZOOM;
    const maxZoom = typeof map.getMaxZoom === 'function' ? map.getMaxZoom() : GLOBAL_MAX_ZOOM;

    return Math.max(
        minZoom,
        Math.min(maxZoom, STARTUP_GPS_CENTER_ZOOM)
    );
}


function fitMapToStartupFireContext({ reason = 'startup-fire-context' } = {}) {
    /*
     * v13.41 — ouverture avec feu sélectionné : la carte doit afficher dans la
     * même vue la position avion connue, le feu actif et les pélicandromes
     * affichés/sélectionnés. On l'utilise uniquement comme cadrage de démarrage,
     * sans activer le suivi GPS.
     */
    if (!map || !currentCommune) return false;

    const fireLat = Number(currentCommune.latitude_mairie);
    const fireLon = Number(currentCommune.longitude_mairie);
    if (!Number.isFinite(fireLat) || !Number.isFinite(fireLon)) return false;

    const points = [[fireLat, fireLon]];
    const seen = new Set();
    const addPoint = (lat, lon) => {
        const numericLat = Number(lat);
        const numericLon = Number(lon);
        if (!Number.isFinite(numericLat) || !Number.isFinite(numericLon)) return;
        const key = `${numericLat.toFixed(5)},${numericLon.toFixed(5)}`;
        if (seen.has(key)) return;
        seen.add(key);
        points.push([numericLat, numericLon]);
    };

    const gpsPos = getKnownGpsLatLngForCentering();
    if (gpsPos) addPoint(gpsPos.lat, gpsPos.lng);

    try {
        const countInput = document.getElementById('airport-count');
        const count = Number.parseInt(countInput?.value || '0', 10);
        const closest = Number.isFinite(count) && count > 0 ? getClosestAirports(fireLat, fireLon, count) : [];
        closest.forEach(ap => addPoint(ap.lat, ap.lon));
    } catch (_) {}

    try {
        const selectedPelic = selectedPelicanOACI ? getAirportByOaci(selectedPelicanOACI) : null;
        if (selectedPelic) addPoint(selectedPelic.lat, selectedPelic.lon);
    } catch (_) {}

    if (!points.length) return false;

    centerGpsFollowProgrammaticMove = true;
    try {
        if (points.length === 1) {
            map.setView(points[0], Math.min(Math.max(getStartupGpsCenterZoom(), 9), 11), { animate: false });
        } else {
            map.fitBounds(L.latLngBounds(points).pad(0.25), {
                animate: false,
                padding: [34, 34],
                maxZoom: 11
            });
        }
    } finally {
        setTimeout(() => {
            centerGpsFollowProgrammaticMove = false;
        }, 350);
    }
    return true;
}

function applyStartupGpsAutoCenter(lat, lng, { source = 'real', force = false } = {}) {
    /*
     * v12.54 — ouverture centrée GPS.
     * Objectif : ouvrir la carte sur la position GPS avec un zoom large,
     * sans suivre ensuite l'utilisateur en permanence.
     * - position stockée : recentrage provisoire rapide ;
     * - position GPS réelle : recentrage prioritaire une seule fois au lancement.
     */
    if (!map) return false;

    const numericLat = Number(lat);
    const numericLng = Number(lng);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) return false;

    const isRealPosition = source !== 'stored';

    if (isRealPosition) {
        if (startupGpsAutoCenteredWithRealPosition && !force) return false;
        startupGpsAutoCenteredWithRealPosition = true;

        /*
         * v17.20 — le cadrage pré-tuiles de v17.19 reste la référence. Si le
         * premier GPS réel tombe déjà dans les 70 % centraux du viewport, on
         * déplace uniquement l'avion : aucun setView/fitBounds, donc aucune
         * seconde vague de tuiles. Un GPS réellement hors cadre conserve le
         * comportement historique de recentrage.
         */
        if (!force && startupGpsStoredCenterAppliedAt) {
            try {
                const point = map.latLngToContainerPoint([numericLat, numericLng]);
                const size = map.getSize();
                const marginX = size.x * 0.15;
                const marginY = size.y * 0.15;
                const insideCentralViewport = (
                    point.x >= marginX
                    && point.x <= size.x - marginX
                    && point.y >= marginY
                    && point.y <= size.y - marginY
                );
                if (insideCentralViewport) {
                    npfStartupDiagMark(
                        'gps_real_recenter_skipped',
                        'GPS réel — recadrage évité',
                        'position déjà dans les 70 % centraux du viewport'
                    );
                    return true;
                }
            } catch (_) {}
        }
    } else {
        if (startupGpsAutoCenteredWithRealPosition) return false;
        if (startupGpsStoredCenterAppliedAt && !force) return false;
        startupGpsStoredCenterAppliedAt = Date.now();
    }

    if (currentCommune && fitMapToStartupFireContext({ reason: `startup-${source}` })) {
        return true;
    }

    map.setView([numericLat, numericLng], getStartupGpsCenterZoom(), { animate: false });
    return true;
}

function applyStoredGpsStartupCenter({ force = false } = {}) {
    const stored = getStoredGpsPosition();
    if (!stored) return false;
    return applyStartupGpsAutoCenter(stored.lat, stored.lng, { source: 'stored', force });
}

function centerMapOnGpsOverviewAfterClear() {
    /*
     * v12.58 — fermeture du bandeau feu conservée.
     * Le bouton X ne doit plus renvoyer sur une vue France dézoomée.
     * On reprend la logique d'ouverture : position GPS connue, zoom large 10,
     * puis correction par GPS réel si disponible.
     */
    if (!map) return;

    const zoom = getStartupGpsCenterZoom();

    const centerOn = (lat, lng) => {
        const numericLat = Number(lat);
        const numericLng = Number(lng);
        if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) return false;
        map.setView([numericLat, numericLng], zoom, { animate: false });
        return true;
    };

    let centered = false;

    try {
        if (userMarker && typeof userMarker.getLatLng === 'function') {
            const latlng = userMarker.getLatLng();
            centered = centerOn(latlng.lat, latlng.lng);
        }
    } catch (_) {}

    if (!centered && lastPosition) {
        centered = centerOn(lastPosition.lat, lastPosition.lng);
    }

    if (!centered) {
        const stored = getStoredGpsPosition();
        if (stored) centered = centerOn(stored.lat, stored.lng);
    }

    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            updateUserPosition(pos);
            const { latitude, longitude } = pos.coords || {};
            centerOn(latitude, longitude);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 600000 }
    );
}

function primeGpsFromStoredPosition() {
    if (userMarker || !map) return false;
    const stored = getStoredGpsPosition();
    if (!stored) return false;

    const fakePosition = {
        coords: {
            latitude: stored.lat,
            longitude: stored.lng,
            altitude: null,
            heading: null,
            speed: null,
            accuracy: null
        },
        timestamp: stored.timestamp || Date.now(),
        npfIsStoredPosition: true
    };

    updateUserPosition(fakePosition);
    return true;
}

function requestOneShotGps({ silent = true, highAccuracy = true, timeout = 30000, maximumAge = 600000 } = {}) {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        updateUserPosition,
        (error) => {
            console.warn('GPS ponctuel indisponible:', error);
            primeGpsFromStoredPosition();
            if (!silent) alert("Impossible d'obtenir la position GPS. Vérifiez les autorisations.");
        },
        { enableHighAccuracy: highAccuracy, timeout, maximumAge }
    );
}

function restartLiveGpsWatch({ silent = true } = {}) {
    if (!navigator.geolocation) {
        if (!silent) alert("La géolocalisation n'est pas supportée.");
        return;
    }

    const liveGpsButton = document.getElementById('live-gps-button');

    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    primeGpsFromStoredPosition();

    watchId = navigator.geolocation.watchPosition(
        updateUserPosition,
        (error) => {
            console.warn('Erreur de suivi GPS:', error);
            primeGpsFromStoredPosition();

            /*
             * v11.61 — après longue période sans réseau, Safari/Android peut rendre
             * une erreur temporaire. On ne coupe plus le mode GPS : on relance
             * une demande ponctuelle puis le watchPosition continue dès que possible.
             */
            setTimeout(() => requestOneShotGps({ silent: true, timeout: 30000, maximumAge: 600000 }), 2000);
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 600000 }
    );

    if (liveGpsButton) liveGpsButton.classList.add('active');
    localStorage.setItem('liveGpsActive', 'true');
}

function setupGpsResumeHandlers() {
    const resumeGps = () => {
        if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') {
            refreshNearestCommuneDisplayFromKnownGps();
        }
        if (localStorage.getItem('liveGpsActive') === 'true') {
            restartLiveGpsWatch({ silent: true });
        } else {
            requestOneShotGps({ silent: true, highAccuracy: true, timeout: 30000, maximumAge: 600000 });
        }
        setTimeout(() => {
            if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') refreshNearestCommuneDisplayFromKnownGps();
        }, 1500);
    };

    window.addEventListener('online', resumeGps);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) resumeGps();
    });
}


function getKnownGpsLatLngForCentering() {
    if (userMarker && typeof userMarker.getLatLng === 'function') {
        try {
            const pos = userMarker.getLatLng();
            if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng)) {
                return { lat: pos.lat, lng: pos.lng };
            }
        } catch (_) {}
    }

    if (lastPosition) {
        const lat = Number(lastPosition.lat ?? lastPosition.latitude);
        const lng = Number(lastPosition.lng ?? lastPosition.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
        }
    }

    /* v17.19 — utilisable dès le premier cadrage, avant création du marker GPS. */
    const stored = getStoredGpsPosition();
    if (stored && Number.isFinite(stored.lat) && Number.isFinite(stored.lng)) {
        return { lat: stored.lat, lng: stored.lng };
    }

    return null;
}

function refreshCenterGpsFollowButtonState() {
    const button = document.getElementById('center-gps-button');
    if (!button) return;

    button.classList.toggle('center-follow-active', centerGpsFollowActive);
    button.classList.toggle('active', centerGpsFollowActive);
    button.setAttribute('aria-pressed', centerGpsFollowActive ? 'true' : 'false');

    button.title = centerGpsFollowActive
        ? 'Clic : centrer sur ma position · Appui long : désactiver le suivi'
        : 'Clic : centrer sur ma position · Appui long : activer le suivi';

    button.setAttribute(
        'aria-label',
        centerGpsFollowActive
            ? 'Centrer sur ma position ; appui long pour désactiver le suivi'
            : 'Centrer sur ma position ; appui long pour activer le suivi'
    );
}

function clearCenterGpsButtonLongPressTimer() {
    if (centerGpsButtonLongPressTimer) {
        clearTimeout(centerGpsButtonLongPressTimer);
        centerGpsButtonLongPressTimer = null;
    }
}

function resetCenterGpsButtonPressState(button = null) {
    clearCenterGpsButtonLongPressTimer();
    centerGpsButtonActivePointerId = null;
    centerGpsButtonPressStartX = 0;
    centerGpsButtonPressStartY = 0;
    if (button) {
        button.classList.remove('center-gps-pressing');
    }
}

function handleCenterGpsButtonLongPress(button) {
    centerGpsButtonLongPressTimer = null;
    centerGpsButtonLongPressTriggered = true;
    centerGpsButtonSuppressClickUntil = Date.now() + 900;

    button.classList.remove('center-gps-pressing');
    button.classList.add('center-gps-long-press-confirmed');

    /*
     * L'appui long conserve la possibilité de désactiver le suivi avec le même
     * bouton. Lorsqu'il est inactif, il l'active comme demandé.
     */
    if (centerGpsFollowActive) {
        disableCenterGpsFollow();
    } else {
        enableCenterGpsFollow();
    }

    try {
        if (navigator.vibrate) navigator.vibrate(35);
    } catch (_) {}

    setTimeout(() => {
        button.classList.remove('center-gps-long-press-confirmed');
    }, 360);
}

function installCenterGpsButtonPressHandlers(button) {
    if (!button || button.dataset.centerGpsPressHandlersInstalled === 'true') {
        return;
    }
    button.dataset.centerGpsPressHandlersInstalled = 'true';

    protectNpfLongPressControlFromIosSelection(button);

    const cancelPress = () => {
        resetCenterGpsButtonPressState(button);
    };

    button.addEventListener('pointerdown', (event) => {
        if (String(event.pointerType || '').toLowerCase() === 'pen') return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        event.preventDefault();
        event.stopPropagation();

        centerGpsButtonLongPressTriggered = false;
        centerGpsButtonActivePointerId = event.pointerId;
        centerGpsButtonPressStartX = Number(event.clientX) || 0;
        centerGpsButtonPressStartY = Number(event.clientY) || 0;

        button.classList.add('center-gps-pressing');
        clearCenterGpsButtonLongPressTimer();

        try {
            button.setPointerCapture?.(event.pointerId);
        } catch (_) {}

        centerGpsButtonLongPressTimer = setTimeout(() => {
            if (centerGpsButtonActivePointerId !== event.pointerId) return;
            handleCenterGpsButtonLongPress(button);
        }, CENTER_GPS_BUTTON_LONG_PRESS_MS);
    }, { passive: false });

    button.addEventListener('pointermove', (event) => {
        if (centerGpsButtonActivePointerId !== event.pointerId) return;

        const deltaX = (Number(event.clientX) || 0) - centerGpsButtonPressStartX;
        const deltaY = (Number(event.clientY) || 0) - centerGpsButtonPressStartY;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance > CENTER_GPS_BUTTON_MOVE_TOLERANCE_PX) {
            cancelPress();
        }
    }, { passive: true });

    button.addEventListener('pointerup', (event) => {
        if (centerGpsButtonActivePointerId !== event.pointerId) return;

        event.preventDefault();
        event.stopPropagation();

        const wasLongPress = centerGpsButtonLongPressTriggered;
        centerGpsButtonSuppressClickUntil = Date.now() + 700;
        resetCenterGpsButtonPressState(button);

        try {
            button.releasePointerCapture?.(event.pointerId);
        } catch (_) {}

        if (!wasLongPress) {
            centerMapOnCurrentPosition();
        }

        centerGpsButtonLongPressTriggered = false;
    }, { passive: false });

    button.addEventListener('pointercancel', cancelPress, { passive: true });
    button.addEventListener('lostpointercapture', () => {
        if (!centerGpsButtonLongPressTriggered) {
            cancelPress();
        }
    }, { passive: true });

    /*
     * Supprimer le clic synthétique émis par Safari après pointerup ou après
     * l'appui long, afin qu'il ne déclenche jamais une seconde action.
     */
    button.addEventListener('click', (event) => {
        if (Date.now() <= centerGpsButtonSuppressClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
        }

        /*
         * Repli souris/clavier si aucun événement Pointer n'a été reçu.
         */
        event.preventDefault();
        event.stopPropagation();
        centerMapOnCurrentPosition();
    }, true);

    button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            centerMapOnCurrentPosition();
        }
    });
}

/*
 * v15.80 — Suivi : référence = viewport réellement visible de l'iPad.
 * Le conteneur Leaflet peut être plus haut que la zone visible (100lvh / Safari).
 * On choisit donc la position avion dans le viewport visible, puis on la convertit
 * en coordonnées du conteneur Leaflet. Les caps 090/270 restent à Y visible = 50 %.
 */
const CENTER_GPS_FOLLOW_HORIZONTAL_OFFSET_RATIO = 0.25;
const CENTER_GPS_FOLLOW_VERTICAL_OFFSET_RATIO = 0.24;
const CENTER_GPS_FOLLOW_SAFE_MARGIN_LEFT_RATIO = 0.17;
const CENTER_GPS_FOLLOW_SAFE_MARGIN_RIGHT_RATIO = 0.17;
const CENTER_GPS_FOLLOW_SAFE_MARGIN_TOP_RATIO = 0.15;
const CENTER_GPS_FOLLOW_SAFE_MARGIN_BOTTOM_RATIO = 0.17;
const CENTER_GPS_FOLLOW_MIN_SIDE_MARGIN_PX = 145;
const CENTER_GPS_FOLLOW_MIN_VERTICAL_MARGIN_PX = 105;
const CENTER_GPS_FOLLOW_CARDINAL_EPSILON = 1e-8;

/*
 * v17.14 — en mode simulation, un avion réellement en mouvement utilise
 * automatiquement le cadrage anticipé du mode Suivi, sans démarrer le GPS réel
 * et sans modifier l'état visuel du bouton Suivi.
 */
function isCenterGpsFollowEffective() {
    const simulationMoving = !!(
        isSimulationMode
        && simulationAircraftPositionReady
        && Number(simulationSpeedKt) > 0
    );
    return !!(centerGpsFollowActive || simulationMoving);
}

function getCenterGpsFollowRecenterDelayMs() {
    const simulationMoving = !!(
        isSimulationMode
        && simulationAircraftPositionReady
        && Number(simulationSpeedKt) > 0
    );
    return simulationMoving
        ? SIMULATION_FOLLOW_RECENTER_DELAY_MS
        : CENTER_GPS_FOLLOW_RECENTER_DELAY_MS;
}

function getCenterGpsFollowHeadingDegrees() {
    const heading = Number(lastPosition?.heading);
    if (Number.isFinite(heading)) {
        return ((heading % 360) + 360) % 360;
    }

    if (isSimulationMode && Number.isFinite(Number(simulationRouteDeg))) {
        return getSimulationTrueRouteDeg();
    }

    return null;
}

function getCenterGpsFollowVisibleMapRect(width, height) {
    const fallback = { left: 0, top: 0, width, height };
    try {
        const container = map?.getContainer?.();
        if (!container) return fallback;
        const rect = container.getBoundingClientRect();
        const vv = window.visualViewport;

        const viewportWidth = Number(vv?.width) || Number(window.innerWidth) || width;
        const viewportHeight = Number(vv?.height) || Number(window.innerHeight) || height;
        const viewportLeft = Number(vv?.offsetLeft) || 0;
        const viewportTop = Number(vv?.offsetTop) || 0;

        let left = Math.max(0, viewportLeft - Number(rect.left || 0));
        let top = Math.max(0, viewportTop - Number(rect.top || 0));
        let visibleWidth = Math.min(width - left, viewportWidth, Number(rect.width) || width);
        let visibleHeight = Math.min(height - top, viewportHeight, Number(rect.height) || height);

        if (!Number.isFinite(visibleWidth) || visibleWidth < 100) visibleWidth = width;
        if (!Number.isFinite(visibleHeight) || visibleHeight < 100) visibleHeight = height;
        if (!Number.isFinite(left) || left < 0 || left + visibleWidth > width + 1) left = 0;
        if (!Number.isFinite(top) || top < 0 || top + visibleHeight > height + 1) top = 0;

        return { left, top, width: visibleWidth, height: visibleHeight };
    } catch (_) {
        return fallback;
    }
}

function getCenterGpsFollowOverlayVerticalInsets(visible) {
    const result = { top: 0, bottom: 0 };
    try {
        const container = map?.getContainer?.();
        if (!container) return result;
        const mapRect = container.getBoundingClientRect();
        const selectors = [
            '#npf-waypoint-route-banner',
            '#commune-info-display',
            '#bingo-map-display',
            '#nearest-commune-display'
        ];
        const visibleTopAbs = mapRect.top + visible.top;
        const visibleBottomAbs = visibleTopAbs + visible.height;
        const visibleLeftAbs = mapRect.left + visible.left;
        const visibleRightAbs = visibleLeftAbs + visible.width;

        selectors.forEach(selector => {
            const element = document.querySelector(selector);
            if (!element) return;
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.01) return;
            const rect = element.getBoundingClientRect();
            if (rect.width < 80 || rect.height < 18) return;
            if (rect.right <= visibleLeftAbs || rect.left >= visibleRightAbs) return;
            const overlapWidth = Math.max(0, Math.min(rect.right, visibleRightAbs) - Math.max(rect.left, visibleLeftAbs));
            if (overlapWidth < Math.min(180, visible.width * 0.22)) return;

            if (rect.top <= visibleTopAbs + visible.height * 0.42) {
                result.top = Math.max(result.top, rect.bottom - visibleTopAbs);
            }
            if (rect.bottom >= visibleBottomAbs - visible.height * 0.32) {
                result.bottom = Math.max(result.bottom, visibleBottomAbs - rect.top);
            }
        });
    } catch (_) {}
    return result;
}

function getCenterGpsFollowMapCenter(pos, zoom) {
    if (!map || !pos || !isCenterGpsFollowEffective()) return pos;

    const headingDeg = getCenterGpsFollowHeadingDegrees();
    if (!Number.isFinite(headingDeg)) return pos;

    try {
        const mapSize = map.getSize();
        const width = Number(mapSize?.x);
        const height = Number(mapSize?.y);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 || height < 100) {
            return pos;
        }

        const visible = getCenterGpsFollowVisibleMapRect(width, height);
        const headingRad = headingDeg * Math.PI / 180;
        let sinHeading = Math.sin(headingRad);
        let cosHeading = Math.cos(headingRad);

        if (Math.abs(sinHeading) < CENTER_GPS_FOLLOW_CARDINAL_EPSILON) sinHeading = 0;
        if (Math.abs(cosHeading) < CENTER_GPS_FOLLOW_CARDINAL_EPSILON) cosHeading = 0;

        const mapCenterX = width / 2;
        const mapCenterY = height / 2;
        const visibleCenterX = visible.left + visible.width / 2;
        const visibleCenterY = visible.top + visible.height / 2;

        const desiredX = visibleCenterX
            - sinHeading * visible.width * CENTER_GPS_FOLLOW_HORIZONTAL_OFFSET_RATIO;
        const desiredY = visibleCenterY
            + cosHeading * visible.height * CENTER_GPS_FOLLOW_VERTICAL_OFFSET_RATIO;

        const sideMargin = Math.min(
            visible.width / 2,
            Math.max(CENTER_GPS_FOLLOW_MIN_SIDE_MARGIN_PX, visible.width * CENTER_GPS_FOLLOW_SAFE_MARGIN_LEFT_RATIO)
        );
        const rightMargin = Math.min(
            visible.width / 2,
            Math.max(CENTER_GPS_FOLLOW_MIN_SIDE_MARGIN_PX, visible.width * CENTER_GPS_FOLLOW_SAFE_MARGIN_RIGHT_RATIO)
        );
        const overlayInsets = getCenterGpsFollowOverlayVerticalInsets(visible);
        const aircraftClearancePx = 54;
        /*
         * v17.14 — une grosse zone UI détectée ne doit jamais rabattre le point
         * anticipé exactement au centre de l'écran. Le suivi conserve au moins
         * une vraie avance visuelle dans le sens opposé au cap.
         */
        const maxVerticalSafetyMargin = visible.height * 0.34;
        const topMargin = Math.min(
            maxVerticalSafetyMargin,
            Math.max(
                CENTER_GPS_FOLLOW_MIN_VERTICAL_MARGIN_PX,
                visible.height * CENTER_GPS_FOLLOW_SAFE_MARGIN_TOP_RATIO,
                Number(overlayInsets.top || 0) + aircraftClearancePx
            )
        );
        const bottomMargin = Math.min(
            maxVerticalSafetyMargin,
            Math.max(
                CENTER_GPS_FOLLOW_MIN_VERTICAL_MARGIN_PX,
                visible.height * CENTER_GPS_FOLLOW_SAFE_MARGIN_BOTTOM_RATIO,
                Number(overlayInsets.bottom || 0) + aircraftClearancePx
            )
        );

        const safeLeft = visible.left + sideMargin;
        const safeRight = visible.left + visible.width - rightMargin;
        const safeTop = visible.top + topMargin;
        const safeBottom = visible.top + visible.height - bottomMargin;

        const aircraftScreenX = Math.min(safeRight, Math.max(safeLeft, desiredX));
        const aircraftScreenY = Math.min(safeBottom, Math.max(safeTop, desiredY));

        /*
         * map.setView place toujours le centre géographique au centre du
         * CONTENEUR Leaflet. On convertit donc le point écran visible souhaité
         * vers ce centre interne, même lorsque le conteneur dépasse le viewport.
         */
        const aheadX = mapCenterX - aircraftScreenX;
        const aheadY = mapCenterY - aircraftScreenY;

        const aircraftPixel = map.project(L.latLng(pos.lat, pos.lng), zoom);
        const mapCenterPixel = L.point(
            aircraftPixel.x + aheadX,
            aircraftPixel.y + aheadY
        );
        const centerLatLng = map.unproject(mapCenterPixel, zoom);

        if (centerLatLng && Number.isFinite(centerLatLng.lat) && Number.isFinite(centerLatLng.lng)) {
            return { lat: centerLatLng.lat, lng: centerLatLng.lng };
        }
    } catch (_) {}

    return pos;
}

function recenterMapOnKnownGpsPosition(reason = 'manual') {
    if (!map) return false;
    const pos = getKnownGpsLatLngForCentering();
    if (!pos) return false;

    /*
     * v13.40 — retour base v13.34 : le bouton Suivi ne doit plus provoquer
     * de changement de zoom. Sur iPad/PWA, ce changement rechargeait les tuiles
     * et pouvait faire disparaître la carte quelques secondes.
     *
     * v15.77 — lorsque le Suivi est actif, la carte regarde devant l'avion au
     * lieu de centrer le propre avion. Un recentrage ponctuel hors Suivi garde
     * le centrage classique exact.
     */
    const currentZoom = Number.isFinite(map.getZoom()) ? map.getZoom() : 10;

    /*
     * v15.90 — un clic court sur « Centrer » doit placer l'avion au centre
     * géométrique de la carte, y compris lorsque le Suivi anticipé est actif.
     * Les recentrages automatiques du Suivi conservent, eux, l'anticipation cap.
     */
    const isDirectCenterButtonRequest = String(reason || '').startsWith('short-press-');
    const mapCenter = isDirectCenterButtonRequest
        ? pos
        : getCenterGpsFollowMapCenter(pos, currentZoom);

    if (isDirectCenterButtonRequest && centerGpsFollowActive) {
        centerGpsFollowLastUserGestureAt = Date.now();
        centerGpsFollowPausedUntil = Date.now() + getCenterGpsFollowRecenterDelayMs();
    }

    /*
     * v17.16 — en simulation, ne plus lancer un setView deux fois par seconde
     * pour un déplacement inférieur à quelques pixels. L'avion continue à
     * avancer à 500 ms ; la carte ne bouge que lorsque le cadrage l'exige.
     */
    const routineSimulationFollow = !!(
        isSimulationMode
        && lastPosition?.simulation === true
        && String(reason || '') === 'gps-update'
    );
    if (routineSimulationFollow) {
        try {
            const currentCenter = map.getCenter?.();
            if (currentCenter) {
                const currentCenterPixel = map.project(currentCenter, currentZoom);
                const targetCenterPixel = map.project(L.latLng(mapCenter.lat, mapCenter.lng), currentZoom);
                const centerShiftPx = currentCenterPixel.distanceTo(targetCenterPixel);
                if (Number.isFinite(centerShiftPx) && centerShiftPx < SIMULATION_FOLLOW_MIN_CENTER_SHIFT_PX) {
                    return true;
                }
            }
        } catch (_) {}
    }

    let npfDiagCenterShiftM = 0;
    try {
        const currentCenter = map.getCenter?.();
        if (currentCenter && typeof map.distance === 'function') {
            npfDiagCenterShiftM = Number(map.distance(currentCenter, L.latLng(mapCenter.lat, mapCenter.lng))) || 0;
        }

    } catch (_) {}
    try { npfDiagGpsRecenter(reason, npfDiagCenterShiftM); } catch (_) {}

    centerGpsFollowProgrammaticMove = true;
    centerGpsFollowLastProgrammaticMoveAt = Date.now();
    try {
        map.setView([mapCenter.lat, mapCenter.lng], currentZoom, {
            animate: false,
            noMoveStart: true
        });
    } finally {
        setTimeout(() => {
            centerGpsFollowProgrammaticMove = false;
        }, 350);
    }
    return true;
}

function scheduleCenterGpsFollowRecentering() {
    if (!isCenterGpsFollowEffective()) return;

    const recenterDelayMs = getCenterGpsFollowRecenterDelayMs();
    centerGpsFollowPausedUntil = Date.now() + recenterDelayMs;
    if (centerGpsFollowPauseTimer) {
        clearTimeout(centerGpsFollowPauseTimer);
        centerGpsFollowPauseTimer = null;
    }

    centerGpsFollowPauseTimer = setTimeout(() => {
        centerGpsFollowPauseTimer = null;
        centerGpsFollowPausedUntil = 0;
        if (isCenterGpsFollowEffective()) {
            recenterMapOnKnownGpsPosition('manual-delay');
        }
    }, recenterDelayMs);
}

function installCenterGpsFollowHandlers() {
    if (!map || centerGpsFollowHandlersInstalled) return;
    centerGpsFollowHandlersInstalled = true;

    const shouldIgnoreCenterFollowDomEvent = (event) => {
        try {
            const target = event && event.target;
            if (!target || typeof target.closest !== 'function') return false;
            return !!target.closest('.leaflet-control, .leaflet-popup, .leaflet-tooltip, button, input, textarea, select, a, #results-list, #commune-info-display, #nearest-commune-display');
        } catch (_) {
            return false;
        }
    };

    const markUserMapGesture = (event, { active = true } = {}) => {
        if (!isCenterGpsFollowEffective()) return;
        if (event && shouldIgnoreCenterFollowDomEvent(event)) return;

        centerGpsFollowUserGestureActive = active;
        centerGpsFollowLastUserGestureAt = Date.now();

        /*
         * v13.34 — on arme la pause de 10 secondes dès le contact utilisateur
         * sur la carte, avant les événements Leaflet. Sur iPad, le premier drag
         * pouvait sinon arriver pendant le fanion de recentrage programmatique
         * et être ignoré, ce qui provoquait un recentrage immédiat.
         */
        scheduleCenterGpsFollowRecentering();
    };

    const endUserMapGesture = (event) => {
        if (!isCenterGpsFollowEffective()) {
            centerGpsFollowUserGestureActive = false;
            return;
        }
        if (event && shouldIgnoreCenterFollowDomEvent(event)) return;
        markUserMapGesture(event, { active: false });
        centerGpsFollowUserGestureActive = false;
    };

    const container = typeof map.getContainer === 'function' ? map.getContainer() : null;
    if (container) {
        ['pointerdown', 'touchstart', 'mousedown', 'wheel'].forEach((eventName) => {
            container.addEventListener(eventName, (event) => markUserMapGesture(event, { active: true }), { passive: true, capture: true });
        });

        ['pointermove', 'touchmove'].forEach((eventName) => {
            container.addEventListener(eventName, (event) => {
                if (centerGpsFollowUserGestureActive) markUserMapGesture(event, { active: true });
            }, { passive: true, capture: true });
        });

        ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach((eventName) => {
            container.addEventListener(eventName, endUserMapGesture, { passive: true, capture: true });
        });
    }

    const forcePauseForMapGesture = () => {
        if (!isCenterGpsFollowEffective()) return;
        centerGpsFollowLastUserGestureAt = Date.now();
        centerGpsFollowPausedUntil = Date.now() + getCenterGpsFollowRecenterDelayMs();
        scheduleCenterGpsFollowRecentering();
    };

    const onManualMapMove = (event) => {
        if (!isCenterGpsFollowEffective()) return;

        const recentDomUserGesture = Date.now() - centerGpsFollowLastUserGestureAt < 1500;
        const isUserInteraction = !!(
            (event && event.originalEvent)
            || centerGpsFollowUserGestureActive
            || recentDomUserGesture
        );

        if (centerGpsFollowProgrammaticMove && !isUserInteraction) return;

        scheduleCenterGpsFollowRecentering();
    };

    map.on('dragstart zoomstart', forcePauseForMapGesture);
    map.on('drag moveend dragend zoomend', onManualMapMove);
    map.on('movestart', (event) => {
        if (event && event.originalEvent) {
            forcePauseForMapGesture();
            onManualMapMove(event);
        }
    });
}
function enableCenterGpsFollow() {
    centerGpsFollowActive = true;
    centerGpsFollowPausedUntil = 0;
    if (centerGpsFollowPauseTimer) {
        clearTimeout(centerGpsFollowPauseTimer);
        centerGpsFollowPauseTimer = null;
    }

    /*
     * v15.77 — si une fiche SIA était déjà ouverte avant l'activation du Suivi,
     * neutraliser immédiatement son autoPan. Sans cela, Leaflet pouvait encore
     * essayer de la maintenir dans l'écran pendant que le Suivi déplaçait la carte.
     */
    try {
        const activePopup = map?._popup || null;
        const className = String(activePopup?.options?.className || '');
        if (activePopup && className.includes('sia-airspace')) {
            activePopup.options.autoPan = false;
            activePopup.options.keepInView = false;
        }
    } catch (_) {}

    refreshCenterGpsFollowButtonState();
    installCenterGpsFollowHandlers();

    const liveGpsWasActive = !!watchId || localStorage.getItem('liveGpsActive') === 'true';
    centerGpsFollowStartedLiveGps = !liveGpsWasActive;

    if (!liveGpsWasActive) {
        restartLiveGpsWatch({ silent: false });
    } else {
        requestOneShotGps({ silent: true, highAccuracy: true, timeout: 30000, maximumAge: 600000 });
    }

    if (!recenterMapOnKnownGpsPosition('enable') && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                updateUserPosition(pos);
                recenterMapOnKnownGpsPosition('enable-current');
            },
            () => {
                if (!recenterMapOnKnownGpsPosition('enable-fallback')) {
                    alert("Impossible d'obtenir la position GPS. Vérifiez les autorisations.");
                    disableCenterGpsFollow({ keepLiveGps: true });
                }
            },
            { enableHighAccuracy: true, timeout: 30000, maximumAge: 600000 }
        );
    }
}

function disableCenterGpsFollow({ keepLiveGps = false } = {}) {
    centerGpsFollowActive = false;
    centerGpsFollowPausedUntil = 0;
    centerGpsFollowUserGestureActive = false;
    centerGpsFollowLastUserGestureAt = 0;
    if (centerGpsFollowPauseTimer) {
        clearTimeout(centerGpsFollowPauseTimer);
        centerGpsFollowPauseTimer = null;
    }

    if (!keepLiveGps && centerGpsFollowStartedLiveGps && watchId) {
        try { navigator.geolocation.clearWatch(watchId); } catch (_) {}
        watchId = null;
        const liveGpsButton = document.getElementById('live-gps-button');
        if (liveGpsButton) liveGpsButton.classList.remove('active');
        localStorage.setItem('liveGpsActive', 'false');
    }

    centerGpsFollowStartedLiveGps = false;
    refreshCenterGpsFollowButtonState();
}

function toggleCenterGpsFollow() {
    if (centerGpsFollowActive) {
        disableCenterGpsFollow();
    } else {
        enableCenterGpsFollow();
    }
}

function centerMapOnCurrentPosition() {
    /*
     * Action ponctuelle : recentrer immédiatement, sans modifier l'état du
     * suivi. La dernière position connue est prioritaire pour éviter tout délai.
     */
    if (!map) return;

    if (recenterMapOnKnownGpsPosition('short-press-known')) {
        return;
    }

    if (!navigator.geolocation) {
        alert("La géolocalisation n'est pas supportée par votre navigateur.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            updateUserPosition(pos);
            recenterMapOnKnownGpsPosition('short-press-current');
        },
        () => {
            if (!recenterMapOnKnownGpsPosition('short-press-fallback')) {
                alert("Impossible d'obtenir la position GPS. Vérifiez les autorisations.");
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 600000
        }
    );
}

function toggleLiveGps() {
    const liveGpsButton = document.getElementById('live-gps-button');
    if (watchId) {
        if (centerGpsFollowActive) {
            disableCenterGpsFollow({ keepLiveGps: true });
        }
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        if (liveGpsButton) liveGpsButton.classList.remove('active');
        localStorage.setItem('liveGpsActive', 'false');
        centerGpsFollowStartedLiveGps = false;
    } else {
        centerGpsFollowStartedLiveGps = false;
        restartLiveGpsWatch({ silent: false });
    }
}

function drawUserToTargetRoute() {
    userToTargetLayer.clearLayers();

    const routeWaypointTarget = (window.__npfWaypointRouteReady === true && typeof isNpfWaypointGotoActive === 'function' && isNpfWaypointGotoActive())
        ? getNpfActiveWaypoint()
        : null;

    const automaticFirePelicTarget = (!routeWaypointTarget && !selectedAirportDestination)
        ? getNpfFirePelicAutoCycleTarget()
        : null;

    const target = routeWaypointTarget
        ? {
            lat: Number(routeWaypointTarget.lat),
            lon: Number(routeWaypointTarget.lon)
        }
        : (selectedAirportDestination
            ? {
                lat: Number(selectedAirportDestination.lat),
                lon: Number(selectedAirportDestination.lon)
            }
            : (automaticFirePelicTarget
                ? {
                    lat: Number(automaticFirePelicTarget.lat),
                    lon: Number(automaticFirePelicTarget.lon)
                }
                : (currentCommune
                    ? {
                        lat: Number(currentCommune.latitude_mairie),
                        lon: Number(currentCommune.longitude_mairie)
                    }
                    : null)));

    let userLatLng = null;
    try { userLatLng = userMarker?.getLatLng?.() || null; } catch (_) { userLatLng = null; }

    /*
     * v16.94 — pour une navigation WP, ne pas attendre la reconstruction du
     * marqueur avion si une dernière position GPS valide est déjà connue.
     * Les autres types de cibles conservent leur comportement historique.
     */
    if (
        routeWaypointTarget
        && (
            !userLatLng
            || !Number.isFinite(Number(userLatLng.lat))
            || !Number.isFinite(Number(userLatLng.lng))
        )
    ) {
        userLatLng = getNpfWaypointCurrentPositionLatLng();
    }

    if (
        routeWaypointTarget
        && npfWaypointRouteState.originPending === true
        && !getNpfWaypointRouteOrigin()
        && userLatLng
        && Number.isFinite(Number(userLatLng.lat))
        && Number.isFinite(Number(userLatLng.lng))
    ) {
        /*
         * Le premier fix reçu après la création de WP1 fige définitivement
         * l'origine de la route. Les déplacements GPS suivants ne la modifient plus.
         */
        if (setNpfWaypointRouteOriginFromLatLng(userLatLng)) {
            drawNpfWaypointRouteLines();
            updateNpfWaypointSegmentLabels();
        }
    }

    if (target && userLatLng
        && Number.isFinite(Number(userLatLng.lat))
        && Number.isFinite(Number(userLatLng.lng))
        && Number.isFinite(target.lat) && Number.isFinite(target.lon)) {

        const trueBearingToTarget = calculateBearing(
            userLatLng.lat,
            userLatLng.lng,
            target.lat,
            target.lon
        );
        const magneticBearing = (trueBearingToTarget - MAGNETIC_DECLINATION + 360) % 360;

        /*
         * v16.96 — navigation WP : le pointillé dynamique utilise un pane situé
         * juste au-dessus du trait plein fixe. Les autres routes GPS conservent
         * leur pane historique.
         */
        if (routeWaypointTarget && typeof ensureNpfWaypointRouteLayers === 'function') {
            ensureNpfWaypointRouteLayers();
        }

        drawRoute(
            [userLatLng.lat, userLatLng.lng],
            [target.lat, target.lon],
            {
                isUser: true,
                magneticBearing,
                pane: routeWaypointTarget ? 'npfWaypointGotoPane' : undefined
            }
        );
    }
    updateCommuneGpsRouteDisplay();
    if (window.__npfWaypointRouteReady === true && typeof updateNpfWaypointSegmentLabels === 'function') {
        updateNpfWaypointSegmentLabels();
    }
}


function getOrCreateNearestCommuneDisplay() {
    let display = document.getElementById('nearest-commune-display');
    if (!display && document.body) {
        display = document.createElement('div');
        display.id = 'nearest-commune-display';
        display.className = 'gps-waiting';
        display.innerHTML = '📍 Survolée: <b>GPS en attente</b>';
        document.body.appendChild(display);
    }
    return display;
}

function forceNearestCommuneHudVisible(display) {
    if (!display) return;
    const importantStyles = {
        position: 'fixed',
        display: 'flex',
        visibility: 'visible',
        opacity: '1',
        zIndex: '980',
        pointerEvents: 'none'
    };

    Object.entries(importantStyles).forEach(([prop, value]) => {
        try { display.style.setProperty(prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), value, 'important'); } catch (_) {}
    });

    try {
        display.setAttribute('aria-live', 'polite');
        display.dataset.npfHud = 'commune-survolee';
    } catch (_) {}
}

function updateNearestCommuneDisplay(lat, lon) {
    const nearestDisplay = getOrCreateNearestCommuneDisplay();
    if (!nearestDisplay) return;
    forceNearestCommuneHudVisible(nearestDisplay);

    const showDisplay = (html, extraClass = '') => {
        nearestDisplay.style.display = 'flex';
        nearestDisplay.className = extraClass ? `nearest-commune-display ${extraClass}` : 'nearest-commune-display';
        nearestDisplay.innerHTML = html;
    };

    const enrichCommuneForDisplay = (commune) => {
        if (!commune) return null;
        return getCommuneFromDatabaseByNameAndDepartment(commune) || commune;
    };

    const buildLabel = (commune, prefix = 'Commune') => {
        const displayCommune = enrichCommuneForDisplay(commune);
        if (!displayCommune) return '';
        const departmentAtPoint = findDepartmentContainingPoint(lat, lon);
        const depLabel = departmentAtPoint?.dep_code || formatCommuneDepartment(displayCommune);
        return `<span class="nearest-commune-prefix">📍 ${prefix}:</span> <b class="nearest-commune-name">${displayCommune.nom_standard || displayCommune.name || 'non déterminée'}${depLabel ? ` (${depLabel})` : ''}</b>`;
    };

    const numericLat = Number(lat);
    const numericLon = Number(lon);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLon)) {
        showDisplay('📍 Survolée: <b>GPS en attente</b>', 'gps-waiting');
        return;
    }

    const containedCommune = findCommuneContainingPoint(numericLat, numericLon);
    if (containedCommune) {
        showDisplay(buildLabel(containedCommune, 'Survolée'));

        /*
         * v16.75 — ne plus charger les géométries départementales uniquement
         * pour compléter le bandeau. Tant que le calque Départements n'est pas
         * chargé, buildLabel() utilise formatCommuneDepartment(displayCommune),
         * déjà disponible depuis la base communes.
         */
        return;
    }

    /*
     * v12.99 — restauration robuste du bandeau "commune survolée".
     * Le bandeau doit rester visible même si les polygones ne sont pas encore
     * chargés ou si le réseau est mauvais. La valeur précise est mise à jour
     * dès que les polygones deviennent disponibles.
     */
    if (!hasLoadedCommunes) {
        showDisplay('📍 Survolée: <b>chargement...</b>', 'loading');
        ensureCommunesLayerDataLoaded()
            .then(() => {
                const preciseCommune = findCommuneContainingPoint(numericLat, numericLon);
                const display = document.getElementById('nearest-commune-display');
                if (!display) return;
                if (preciseCommune) {
                    display.style.display = 'flex';
                    display.className = 'nearest-commune-display';
                    display.innerHTML = buildLabel(preciseCommune, 'Survolée');
                } else {
                    display.style.display = 'flex';
                    display.className = 'nearest-commune-display unknown';
                    display.innerHTML = '📍 Survolée: <b>non déterminée</b>';
                }
                repairManualFireCommuneLabelsFromPolygons();
            })
            .catch((error) => {
                console.warn('Chargement du calque communes pour identification impossible:', error);
                const display = document.getElementById('nearest-commune-display');
                if (!display) return;
                display.style.display = 'flex';
                display.className = 'nearest-commune-display unavailable';
                display.innerHTML = '📍 Survolée: <b>indisponible</b>';
            });
        return;
    }

    showDisplay('📍 Survolée: <b>non déterminée</b>', 'unknown');
}

function refreshNearestCommuneDisplayFromKnownGps() {
    /*
     * v12.99 — le bandeau bas droit doit être visible en permanence :
     * - commune précise si GPS + polygones disponibles ;
     * - chargement/attente si la position ou les polygones ne sont pas prêts.
     */
    let lat = NaN;
    let lon = NaN;

    try {
        if (userMarker && typeof userMarker.getLatLng === 'function') {
            const ll = userMarker.getLatLng();
            if (ll && Number.isFinite(Number(ll.lat)) && Number.isFinite(Number(ll.lng))) {
                lat = Number(ll.lat);
                lon = Number(ll.lng);
            }
        }
    } catch (_) {}

    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && lastPosition) {
        lat = Number(lastPosition.lat ?? lastPosition.latitude);
        lon = Number(lastPosition.lng ?? lastPosition.longitude);
    }

    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && typeof getStoredGpsPosition === 'function') {
        const stored = getStoredGpsPosition();
        if (stored) {
            lat = Number(stored.lat);
            lon = Number(stored.lng);
        }
    }

    updateNearestCommuneDisplay(lat, lon);
    return Number.isFinite(lat) && Number.isFinite(lon);
}

function ensureNearestCommuneDisplayBootstrapped() {
    const display = getOrCreateNearestCommuneDisplay();
    if (!display) return;
    forceNearestCommuneHudVisible(display);
    display.classList.add('gps-waiting');
    if (!display.innerHTML || !display.textContent.trim()) {
        display.innerHTML = '📍 Survolée: <b>GPS en attente</b>';
    }
}

(function bootstrapNearestCommuneDisplayPersistence() {
    const run = () => {
        ensureNearestCommuneDisplayBootstrapped();
        if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') {
            refreshNearestCommuneDisplayFromKnownGps();
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
    [100, 700, 2000, 5000].forEach(delay => setTimeout(run, delay));
    setInterval(() => {
        if (document.visibilityState === 'visible') run();
    }, 5000);

    /*
     * v16.02 — suppression du MutationObserver global sur tout le document.
     * Il se réveillait à chaque mutation de la carte (trafics, labels, calques)
     * pendant toute la session. Les événements de cycle de vie + contrôle 5 s
     * suffisent à garantir la persistance du HUD sans observer tout le DOM.
     */
    window.addEventListener('pageshow', run, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) run();
    }, { passive: true });
})();


function findClosestCommune(lat, lon, maxDistanceNm = null) {
    if (!allCommunes || allCommunes.length === 0) return null;
    let closestCommune = null;
    let minDistance = Infinity;

    for (const commune of allCommunes) {
        const distance = calculateDistanceInNm(lat, lon, commune.latitude_mairie, commune.longitude_mairie);
        if (distance < minDistance) {
            minDistance = distance;
            closestCommune = commune;
        }
    }

    if (maxDistanceNm !== null && minDistance >= maxDistanceNm) {
        return null;
    }

    return closestCommune;
}


function shouldShowOwnGpsAltitude() {
    try {
        return chatConnected === true && localStorage.getItem('teamChatLocationSharing') === 'true';
    } catch (_) {
        return false;
    }
}

function formatGpsAltitudeFtFromCoords(coords) {
    if (!coords) return '--- ft';
    const altitudeMeters = Number(coords.altitude);
    return Number.isFinite(altitudeMeters) ? `${Math.round(altitudeMeters * 3.28084)} ft` : '--- ft';
}

function sanitizeFilePart(value) {
    return simplifyString(value || 'feu')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'feu';
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

let exportKmlInProgress = false;
let exportKmlLastActionTime = 0;

async function exportCurrentFireKml(event = null, communeOverride = null, buttonOverride = null) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const now = Date.now();
    if (exportKmlInProgress || now - exportKmlLastActionTime < 1200) {
        return;
    }

    exportKmlInProgress = true;
    exportKmlLastActionTime = now;

    const targetCommune = normalizeHistoryCommune(communeOverride) || currentCommune;
    const exportButton = buttonOverride || document.getElementById('export-kml-btn');
    if (exportButton) {
        exportButton.disabled = true;
        exportButton.classList.add('busy');
    }

    try {
        if (!targetCommune) {
            alert('Aucun feu sélectionné.');
            return;
        }

        const lat = Number(targetCommune.latitude_mairie);
        const lon = Number(targetCommune.longitude_mairie);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            alert('Coordonnées du feu indisponibles.');
            return;
        }

        /*
         * v11.93 — KML minimal téléchargé, sans feuille de partage iOS.
         * Objectif : éviter la réouverture de la feuille de partage iOS
         * et fournir un vrai fichier .kml à ouvrir/importer ensuite depuis Fichiers.
         * Coordonnées KML : longitude,latitude,altitude.
         */
        const rawName = buildFireDisplayName(targetCommune) || 'POINT_Q400';
        const safeName = rawName
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 30) || 'POINT_Q400';

        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>${escapeXml(safeName)}</name>
      <description>Point exporte depuis NPF-Q400</description>
      <Point>
        <coordinates>${lon.toFixed(7)},${lat.toFixed(7)},0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;

        const fileName = `${safeName}.kml`;
        const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = fileName;
        link.rel = 'noopener';
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 15000);
    } finally {
        setTimeout(() => {
            exportKmlInProgress = false;
            if (exportButton) {
                exportButton.disabled = false;
                exportButton.classList.remove('busy');
            }
        }, 900);
    }
}

function formatSdvfrCsvValue(value) {
    return String(value ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/;/g, ',')
        .trim();
}

function buildSdvfrPointName(value) {
    return (value || 'POINT_Q400')
        .toString()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 30) || 'POINT_Q400';
}

let exportSdvfrCsvInProgress = false;
let exportSdvfrCsvLastActionTime = 0;

async function exportCurrentFireSdvfrCsv(event = null, communeOverride = null, buttonOverride = null) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const now = Date.now();
    if (exportSdvfrCsvInProgress || now - exportSdvfrCsvLastActionTime < 1200) {
        return;
    }

    exportSdvfrCsvInProgress = true;
    exportSdvfrCsvLastActionTime = now;

    const targetCommune = normalizeHistoryCommune(communeOverride) || currentCommune;
    const exportButton = buttonOverride || document.getElementById('export-sdvfr-csv-btn');
    if (exportButton) {
        exportButton.disabled = true;
        exportButton.classList.add('busy');
    }

    try {
        if (!targetCommune) {
            alert('Aucun feu sélectionné.');
            return;
        }

        const lat = Number(targetCommune.latitude_mairie);
        const lon = Number(targetCommune.longitude_mairie);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            alert('Coordonnées du feu indisponibles.');
            return;
        }

        /*
         * v11.96 — Export CSV SDVFR Next.
         * Format validé :
         * name;description;type;latitude;longitude;shape;color
         * BELCODENE;Belcodene;FEU;43.427222;5.589444;diamond;yellow
         */
        const fireDisplayName = buildFireDisplayName(targetCommune) || 'POINT_Q400';
        const pointName = buildSdvfrPointName(fireDisplayName);
        const description = formatSdvfrCsvValue(fireDisplayName || pointName);
        const csv = [
            'name;description;type;latitude;longitude;shape;color',
            `${formatSdvfrCsvValue(pointName)};${description};FEU;${lat.toFixed(6)};${lon.toFixed(6)};diamond;yellow`
        ].join('\n') + '\n';

        const fileName = `Fichier_cibles_NEXT_${pointName}.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = fileName;
        link.rel = 'noopener';
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 15000);
    } finally {
        setTimeout(() => {
            exportSdvfrCsvInProgress = false;
            if (exportButton) {
                exportButton.disabled = false;
                exportButton.classList.remove('busy');
            }
        }, 900);
    }
}


function ensureOwnGpsAltitudeMarkerStyle() {
    const styleId = 'own-gps-altitude-marker-style';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .own-gps-altitude-marker {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
        }
    `;
    document.head.appendChild(style);
}

const OWN_GPS_Q400_ICON_DATA_URL = 'data:image/png;base64,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';

function buildOwnGpsIcon(altitudeLabel = '', options = {}) {
    ensureOwnGpsAltitudeMarkerStyle();
    const isSimulation = options && options.simulation === true;
    const hasAltitudeLabel = !!String(altitudeLabel || '').trim();
    const safeAltitude = escapeHtml(altitudeLabel || '');
    const altitudeHtml = hasAltitudeLabel
        ? `<div class="own-gps-plane-altitude">${safeAltitude}</div>`
        : '';
    const simulationHtml = isSimulation ? '<div class="own-gps-sim-badge">SIM</div>' : '';

    /*
     * v15.46 — silhouette Q400 validée, jaune vif à contour noir.
     * L'image est intégrée en data URI pour conserver exactement la forme
     * choisie sans ajouter de fichier statique au déploiement.
     */
    const q400IconHtml = `<img class="own-gps-q400-img" src="${OWN_GPS_Q400_ICON_DATA_URL}" alt="" draggable="false">`;

    return L.divIcon({
        className: `own-gps-altitude-marker own-gps-plane-icon${hasAltitudeLabel ? ' has-own-gps-altitude' : ' no-own-gps-altitude'}${isSimulation ? ' own-gps-simulation-icon' : ''}`,
        html: `${altitudeHtml}${simulationHtml}<div class="own-gps-plane-body"><span class="own-gps-plane-shape">${q400IconHtml}</span></div>`,
        iconSize: [96, 78],
        // v15.78 — ancrage sur le centre réel du conteneur Q400.
        // Le body 58 px est centré à Y=45 (top 50 % + margin-top -23 px) :
        // le vecteur temps part ainsi du centre de rotation de l'avion à tous les caps.
        iconAnchor: [48, 45]
    });
}

function applyOwnGpsPlaneHeading(courseDegrees) {
    if (!userMarker || !Number.isFinite(courseDegrees)) return;
    const element = userMarker.getElement && userMarker.getElement();
    const plane = element ? element.querySelector('.own-gps-plane-body') : null;
    if (!plane) return;

    /* v15.46 — la silhouette Q400 intégrée pointe nativement vers le nord. */
    plane.style.transform = `rotate(${courseDegrees}deg)`;
}




function calculateDestinationLatLng(lat, lon, bearingDeg, distanceMeters) {
    const earthRadiusMeters = 6371000;
    const angularDistance = distanceMeters / earthRadiusMeters;
    const bearingRad = toRad(bearingDeg);
    const latRad = toRad(lat);
    const lonRad = toRad(lon);

    const destLatRad = Math.asin(
        Math.sin(latRad) * Math.cos(angularDistance)
        + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
    );

    const destLonRad = lonRad + Math.atan2(
        Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(destLatRad)
    );

    return [toDeg(destLatRad), toDeg(destLonRad)];
}

function estimateMotionFromLastPosition(latitude, longitude, currentTimestampMs) {
    if (!lastPosition || !Number.isFinite(lastPosition.latitude) || !Number.isFinite(lastPosition.longitude)) {
        return { heading: null, speed: null };
    }

    const previousTimestampMs = Number(lastPosition.timestamp || 0);
    const elapsedSeconds = (currentTimestampMs - previousTimestampMs) / 1000;

    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 2 || elapsedSeconds > 120) {
        return { heading: null, speed: null };
    }

    const distanceNm = calculateDistanceInNm(lastPosition.latitude, lastPosition.longitude, latitude, longitude);
    const distanceMeters = distanceNm * 1852;

    if (!Number.isFinite(distanceMeters) || distanceMeters < 3) {
        return { heading: null, speed: null };
    }

    return {
        heading: calculateBearing(lastPosition.latitude, lastPosition.longitude, latitude, longitude),
        speed: distanceMeters / elapsedSeconds
    };
}

function ensureOwnGpsVectorLayer() {
    if (!map) return null;

    /*
     * v15.75 — le vecteur temps utilise le même pane de premier plan que le
     * propre avion. Les formes SVG sont créées avant le marqueur avion et
     * restent donc derrière sa silhouette tout en passant devant les zones SIA.
     */
    if (map.createPane && !map.getPane('ownAircraftPane')) {
        map.createPane('ownAircraftPane');
        const pane = map.getPane('ownAircraftPane');
        if (pane) {
            pane.style.zIndex = '698';
            pane.style.pointerEvents = 'none';
        }
    }

    if (!ownGpsVectorLayer) {
        ownGpsVectorLayer = L.layerGroup().addTo(map);
    }

    return ownGpsVectorLayer;
}

function clearOwnGpsVector() {
    if (ownGpsVectorLayer) {
        ownGpsVectorLayer.clearLayers();
    }
    ownGpsVectorMarkers = [];
}

function buildOwnGpsVectorLabel(minutes, latLng) {
    return L.marker(latLng, {
        pane: 'ownAircraftPane',
        interactive: false,
        icon: L.divIcon({
            className: 'own-gps-vector-time-marker',
            html: `<div style="font-size:17px;font-weight:1000;color:#ffea00;text-shadow:-2px -2px 0 #111827,2px -2px 0 #111827,-2px 2px 0 #111827,2px 2px 0 #111827,0 2px 7px rgba(0,0,0,.85);white-space:nowrap;line-height:1;">${minutes}'</div>`,
            iconSize: [42, 22],
            iconAnchor: [-8, 11]
        })
    });
}

function updateOwnGpsVector(latitude, longitude, headingDeg, speedMps) {
    const layer = ensureOwnGpsVectorLayer();
    if (!layer) return;

    layer.clearLayers();
    ownGpsVectorMarkers = [];

    if (!Number.isFinite(headingDeg) || !Number.isFinite(speedMps) || speedMps < 1) {
        return;
    }

    const start = [latitude, longitude];
    const timeMarksMinutes = [2, 5, 10];
    const maxMinutes = Math.max(...timeMarksMinutes);
    const endDistanceMeters = speedMps * maxMinutes * 60;
    const end = calculateDestinationLatLng(latitude, longitude, headingDeg, endDistanceMeters);
    /*
     * v17.18 — la ligne de foi/vecteur temps suit la même orthodromie que les
     * routes NPF. Les repères 2/5/10 min restent à leurs positions exactes.
     */
    const vectorLatLngs = buildNpfGreatCircleLatLngs(
        start,
        end,
        endDistanceMeters / 1852
    );

    /* v13.04 — vecteur de position plus visible : halo noir + jaune. */
    L.polyline(vectorLatLngs, {
        pane: 'ownAircraftPane',
        color: '#111827',
        weight: 9,
        opacity: 0.82,
        dashArray: '12,7',
        interactive: false,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(layer);

    const vectorLine = L.polyline(vectorLatLngs, {
        pane: 'ownAircraftPane',
        color: '#ffea00',
        weight: 5,
        opacity: 1,
        dashArray: '12,7',
        interactive: false,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(layer);

    timeMarksMinutes.forEach((minutes) => {
        const markDistanceMeters = speedMps * minutes * 60;
        const point = calculateDestinationLatLng(latitude, longitude, headingDeg, markDistanceMeters);

        L.circleMarker(point, {
            pane: 'ownAircraftPane',
            radius: 8,
            color: '#111827',
            weight: 4,
            fillColor: '#ffea00',
            fillOpacity: 1,
            interactive: false
        }).addTo(layer);

        ownGpsVectorMarkers.push(buildOwnGpsVectorLabel(minutes, point).addTo(layer));
    });
}

