function initializeCalculator() {
    let isSharedHeaderSyncing = false;
    let activeRltMassWrapper = null;
    let activeRltMassLastEdited = null;
    let activeRltMassCalculationMode = null;
    let activeRltFirstFull = false;

    function getSharedHeaderMainId(wrapper) {
        if (!wrapper) return '';
        return wrapper.dataset?.syncTarget || wrapper.id || '';
    }

    function getSharedHeaderMirrorWrapper(mainId) {
        return document.querySelector(`.previ-shared-header-section [data-sync-target="${mainId}"]`);
    }

    function copyWrapperValue(sourceWrapper, targetWrapper) {
        if (!sourceWrapper || !targetWrapper) return;

        const sourceDisplay = sourceWrapper.querySelector('.display-input');
        const targetDisplay = targetWrapper.querySelector('.display-input');
        if (sourceDisplay && targetDisplay && targetDisplay.value !== sourceDisplay.value) {
            targetDisplay.value = sourceDisplay.value;
        }

        const sourceEngine = sourceWrapper.querySelector('.engine-input');
        const targetEngine = targetWrapper.querySelector('.engine-input');
        if (sourceEngine && targetEngine && targetEngine.value !== sourceEngine.value) {
            targetEngine.value = sourceEngine.value;
        }
    }

    function syncSharedHeaderFromWrapper(wrapper) {
        if (!wrapper || isSharedHeaderSyncing) return;

        const mainId = getSharedHeaderMainId(wrapper);
        if (!mainId) return;

        const mainWrapper = document.getElementById(mainId);
        const mirrorWrapper = getSharedHeaderMirrorWrapper(mainId);
        if (!mainWrapper || !mirrorWrapper) return;

        isSharedHeaderSyncing = true;
        try {
            if (wrapper === mirrorWrapper) {
                copyWrapperValue(mirrorWrapper, mainWrapper);
            } else if (wrapper === mainWrapper) {
                copyWrapperValue(mainWrapper, mirrorWrapper);
            }
        } finally {
            isSharedHeaderSyncing = false;
        }
    }

    function refreshSharedHeaderMirrorValues() {
        /*
         * v12.88 — Prévi indépendant : HEURE TO et FUEL Départ de
         * l'onglet Prévi ne sont plus synchronisés avec BLOC DÉPART / FUEL
         * DÉPART de BLOC/FUEL. Seuls TMD et LIMITE HDV restent communs.
         */
        ['tmd', 'limite-hdv'].forEach((mainId) => {
            copyWrapperValue(document.getElementById(mainId), getSharedHeaderMirrorWrapper(mainId));
        });

        const mainCs = document.getElementById('cs-lftw-display');
        const previCs = document.getElementById('previ-cs-lftw-display');
        if (mainCs && previCs) previCs.value = mainCs.value;

        const previBlocLabel = document.getElementById('previ-bloc-depart-label');
        if (previBlocLabel) previBlocLabel.textContent = 'HEURE TO';

        const mainCsLabel = document.getElementById('cs-base-label');
        const previCsLabel = document.getElementById('previ-cs-base-label');
        if (mainCsLabel && previCsLabel) previCsLabel.textContent = mainCsLabel.textContent;
    }


    const resetButton = document.getElementById('reset-all-btn');
    const onglets = document.querySelectorAll('.onglet-bouton');
    const csLftwDisplay = document.getElementById('cs-lftw-display');
    const refreshGpsBtn = document.getElementById('refresh-gps-btn');
    const deroutEmptyRetardantCheckbox = document.getElementById('derout-empty-retardant-checkbox');

    function getCurrentGpsAgeLabel() {
        if (!lastPosition || !lastPosition.timestamp) return null;
        const ageMs = Date.now() - Number(lastPosition.timestamp);
        if (!Number.isFinite(ageMs) || ageMs < 0) return null;
        const ageMinutes = Math.floor(ageMs / 60000);
        if (ageMinutes < 1) return 'moins d’1 min';
        if (ageMinutes < 60) return `${ageMinutes} min`;
        const ageHours = Math.floor(ageMinutes / 60);
        const remainingMinutes = ageMinutes % 60;
        return remainingMinutes ? `${ageHours} h ${remainingMinutes} min` : `${ageHours} h`;
    }

    function updateDeroutementGpsStatus(extraText = '') {
        const status = document.getElementById('derout-gps-status');
        if (!status) return;

        const hasMarkerGps = !!(userMarker && typeof userMarker.getLatLng === 'function' && userMarker.getLatLng());
        const hasLastGps = !!(lastPosition && Number.isFinite(Number(lastPosition.lat ?? lastPosition.latitude)) && Number.isFinite(Number(lastPosition.lng ?? lastPosition.longitude)));

        if (!hasMarkerGps && !hasLastGps) {
            status.textContent = extraText || 'GPS non disponible';
            status.className = 'derout-gps-status derout-gps-status-missing';
            return;
        }

        const timestamp = lastPosition && lastPosition.timestamp ? Number(lastPosition.timestamp) : Date.now();
        const updatedAt = new Date(timestamp);
        const hhmm = updatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const ageLabel = getCurrentGpsAgeLabel();
        const ageMs = Number.isFinite(timestamp) ? Date.now() - timestamp : 0;
        const isOld = Number.isFinite(ageMs) && ageMs > 15 * 60000;
        const label = extraText || (isOld ? 'GPS ancien' : 'GPS actualisé');
        status.textContent = `${label} à ${hhmm}${ageLabel ? ` — ${ageLabel}` : ''}`;
        status.className = `derout-gps-status ${isOld ? 'derout-gps-status-old' : 'derout-gps-status-ok'}`;
    }

    if (deroutEmptyRetardantCheckbox) {
        deroutEmptyRetardantCheckbox.checked = localStorage.getItem(DEROUT_EMPTY_RETARDANT_KEY) === 'true';
        deroutEmptyRetardantCheckbox.addEventListener('change', () => {
            localStorage.setItem(DEROUT_EMPTY_RETARDANT_KEY, deroutEmptyRetardantCheckbox.checked ? 'true' : 'false');
            masterRecalculate();
        });
    }

    updateDeroutementGpsStatus();

    if (refreshGpsBtn) refreshGpsBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
            alert("La géolocalisation n'est pas supportée par votre navigateur.");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                updateUserPosition(pos);
                updateDeroutementGpsStatus('GPS actualisé');
                masterRecalculate();
            },
            () => {
                updateDeroutementGpsStatus('GPS non disponible');
                alert("Impossible d'obtenir la position GPS. Vérifiez les autorisations.");
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });

    function updateLftwSunset() {
        const baseAirport = getAirportByOaci(selectedBaseOACI);
        if (baseAirport && typeof SunCalc !== 'undefined') {
            try {
                const now = new Date();
                const times = SunCalc.getTimes(now, baseAirport.lat, baseAirport.lon);
                const sunsetString = times.sunset.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
                if (csLftwDisplay) csLftwDisplay.value = sunsetString;
                const previCsDisplay = document.getElementById('previ-cs-lftw-display');
                if (previCsDisplay) previCsDisplay.value = sunsetString;
                return;
            } catch (e) {
 // ignore
            }
        }
        if (csLftwDisplay) csLftwDisplay.value = '--:--';
        const previCsDisplay = document.getElementById('previ-cs-lftw-display');
        if (previCsDisplay) previCsDisplay.value = '--:--';
    }
    window.updateBaseSunsetDisplay = updateLftwSunset;
    updateLftwSunset();
    setInterval(updateLftwSunset, 60000);

    const AIRPORT_DETECTION_RADIUS_NM = 2;

    function getCurrentGpsLatLngForAirportDetection() {
        if (userMarker && userMarker.getLatLng) {
            const latLng = userMarker.getLatLng();
            if (latLng && Number.isFinite(latLng.lat) && Number.isFinite(latLng.lng)) {
                return { lat: latLng.lat, lon: latLng.lng };
            }
        }

        if (lastPosition) {
            const lat = Number.isFinite(lastPosition.lat) ? lastPosition.lat : lastPosition.latitude;
            const lon = Number.isFinite(lastPosition.lng) ? lastPosition.lng : lastPosition.longitude;
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                return { lat, lon };
            }
        }

        return null;
    }

    function getAirportAtCurrentPosition(maxDistanceNm = AIRPORT_DETECTION_RADIUS_NM) {
        const gps = getCurrentGpsLatLngForAirportDetection();
        if (!gps) return null;

        const airports = [...pelicanAirports, ...otherAirports];
        let bestAirport = null;
        let bestDistance = Infinity;

        airports.forEach((airport) => {
            const distance = calculateDistanceInNm(gps.lat, gps.lon, airport.lat, airport.lon);
            if (Number.isFinite(distance) && distance < bestDistance) {
                bestDistance = distance;
                bestAirport = airport;
            }
        });

        if (!bestAirport || bestDistance > maxDistanceNm) return null;
        return { ...bestAirport, distance: bestDistance };
    }

    function normalizeBlocDepartAirportOaci(value) {
        return String(value || '').trim().toUpperCase();
    }

    function getBlocDepartAirportOaci() {
        const blocDepartWrapper = document.getElementById('bloc-depart');
        const blocDepartValue = blocDepartWrapper?.querySelector('.display-input')?.value || '';

        if (parseTime(blocDepartValue) === null) {
            if (blocDepartWrapper) blocDepartWrapper.dataset.airportOaci = '';
            return '';
        }

        return normalizeBlocDepartAirportOaci(blocDepartWrapper?.dataset?.airportOaci || '');
    }

    function setBlocDepartAirportOaci(oaci) {
        const blocDepartWrapper = document.getElementById('bloc-depart');
        if (!blocDepartWrapper) return '';
        const normalized = normalizeBlocDepartAirportOaci(oaci);
        blocDepartWrapper.dataset.airportOaci = normalized;
        return normalized;
    }

    function clearBlocDepartAirportOaci() {
        setBlocDepartAirportOaci('');
    }

    function lockBlocDepartAirportOaciIfNeeded({ force = false } = {}) {
        const blocDepartWrapper = document.getElementById('bloc-depart');
        const blocDepartValue = blocDepartWrapper?.querySelector('.display-input')?.value || '';

        if (parseTime(blocDepartValue) === null) {
            clearBlocDepartAirportOaci();
            return '';
        }

        const existing = getBlocDepartAirportOaci();
        if (existing && !force) return existing;

        const airport = getAirportAtCurrentPosition();
        return setBlocDepartAirportOaci(airport ? airport.oaci : '');
    }

    function updateBlocDepartAirportLabel() {
        const label = document.getElementById('bloc-depart-label');
        const previLabel = document.getElementById('previ-bloc-depart-label');

        const oaci = getBlocDepartAirportOaci();
        const text = oaci ? `BLOC DÉPART ${oaci}` : 'BLOC DÉPART';

        if (label) label.textContent = text;
        if (previLabel) previLabel.textContent = 'HEURE TO';
    }

    function updateRowAirportOaci(row, { forceDetect = false } = {}) {
        if (!row) return;
        const cell = row.querySelector('.airport-oaci-cell');
        if (!cell) return;

        const rowTimeValue = row.querySelector('.time-input-wrapper .display-input')?.value || '';
        if (parseTime(rowTimeValue) === null) {
            row.dataset.airportOaci = '';
            cell.textContent = '--';
            return;
        }

        if (forceDetect || !row.dataset.airportOaci) {
            const airport = getAirportAtCurrentPosition();
            row.dataset.airportOaci = airport ? airport.oaci : '';
        }

        cell.textContent = row.dataset.airportOaci || '--';
    }

    function refreshBlocFuelAirportOaciCells() {
        document.querySelectorAll('#bloc-fuel tbody tr').forEach((row) => {
            updateRowAirportOaci(row);
        });
    }

    window.refreshCalculatorAirportContext = () => {
        updateBlocDepartAirportLabel();
        refreshBlocFuelAirportOaciCells();
    };

    const activateTab = (onglet) => { document.querySelectorAll('.onglet-bouton').forEach(btn => btn.classList.remove('active')); document.querySelectorAll('.onglet-panneau').forEach(p => p.classList.remove('active')); onglet.classList.add('active'); document.getElementById(onglet.dataset.onglet).classList.add('active'); resetButton.style.display = (onglet.dataset.onglet === 'bloc-fuel') ? 'flex' : 'none'; };
    onglets.forEach(onglet => {
        onglet.addEventListener('click', () => activateTab(onglet));
        onglet.addEventListener('pointerup', (event) => {
            event.preventDefault();
            activateTab(onglet);
        });
    });

    function handleCalculatorTabHitByCoordinates(event) {
        if (!calculatorModal || calculatorModal.style.display !== 'flex') return false;
        const nav = calculatorModal.querySelector('.onglets-navigation');
        if (!nav) return false;

        const targetElement = event.target instanceof Element ? event.target : null;
        const blockedInteractive = targetElement?.closest('button, input, select, textarea, a, [role="button"]');
        if (blockedInteractive && !blockedInteractive.classList.contains('onglet-bouton') && !blockedInteractive.closest('.onglets-navigation')) {
            return false;
        }

        const point = event.changedTouches && event.changedTouches[0]
            ? event.changedTouches[0]
            : (event.touches && event.touches[0] ? event.touches[0] : event);
        const x = Number(point.clientX);
        const y = Number(point.clientY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

        const rect = nav.getBoundingClientRect();
        const verticalMarginTop = 105;
        const verticalMarginBottom = 42;
        if (x < rect.left || x > rect.right || y < rect.top - verticalMarginTop || y > rect.bottom + verticalMarginBottom) return false;

        const buttons = Array.from(nav.querySelectorAll('.onglet-bouton'));
        if (!buttons.length) return false;

        let target = buttons.find((button) => {
            const b = button.getBoundingClientRect();
            return x >= b.left && x <= b.right;
        });

        if (!target) {
            const ratio = Math.max(0, Math.min(0.999, (x - rect.left) / Math.max(1, rect.width)));
            target = buttons[Math.floor(ratio * buttons.length)];
        }

        if (!target) return false;
        event.preventDefault();
        activateTab(target);
        return true;
    }

    /*
     * v17.29 — gestionnaire NON branché. Il lisait `calculatorModal`, constante
     * propre à setupEventListeners() (src/110), et levait donc une ReferenceError
     * à chaque pointerdown / pointerup / touchend / click du document, sans jamais
     * rien faire d'autre. Le retirer supprime l'erreur SANS réactiver ce repli par
     * coordonnées : le calculateur garde strictement son comportement antérieur
     * (onglets pilotés par leurs propres écouteurs click / pointerup).
     */


    function createEmptyFlight(number = 1) {
        return {
            id: `flight_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
            number,
            closed: false,
            state: {
                'bloc-depart': '',
                'bloc-depart-oaci': '',
                'fuel-depart': '3500 kg',
                'rlt-depart': '',
                'previ-bloc-depart': '',
                'previ-fuel-depart': '3500 kg',
                'tmd': '21:30',
                'limite-hdv': '08:00',
                calculator_table_data: []
            }
        };
    }


    function calculatorRowDataHasContent(rowData) {
        if (!rowData) return false;
        return !!(
            rowData.time
            || rowData.fuel
            || rowData.oaci
            || rowData.rltMass
            || rowData.rltVolume
            || rowData.rltDensity
            || rowData.rltTopMass
            || rowData.rltTopDensity
            || rowData.rltTopVolume
            || rowData.rltBottomVolume
            || rowData.rltBottomDensity
            || rowData.rltBottomMass
            || rowData.rltRefracto
            || rowData.rltMode
            || rowData.rltFirstFull
            || rowData.rltFirstFullPending
            || rowData.rltFirstFullWanted
        );
    }

    function compactCalculatorTableData(tableData = []) {
        return (Array.isArray(tableData) ? tableData : []).filter(calculatorRowDataHasContent);
    }

    function normalizeFlightNumbers() {
        dailyFlights.forEach((flight, index) => {
            flight.number = index + 1;
        });
    }

    function normalizeHdvLimitLabel(value) {
        const minutes = parseTime(value);
        return minutes !== null ? (formatTime(minutes) || '00:00') : '';
    }

    function getLimitHdvWrappers() {
        return [
            document.getElementById('limite-hdv'),
            document.getElementById('previ-limite-hdv')
        ].filter(Boolean);
    }

    function setStoredGlobalLimitHdvLabel(value, options = {}) {
        const { persistFirstFlight = true } = options;
        const label = normalizeHdvLimitLabel(value);
        if (!label) return '';

        getLimitHdvWrappers().forEach(wrapper => {
            wrapper.dataset.globalHdvLimit = label;
            const display = wrapper.querySelector('.display-input');
            const engine = wrapper.querySelector('.engine-input');
            if (display) display.dataset.globalHdvLimit = label;
            if (engine) engine.dataset.globalHdvLimit = label;
        });

        if (persistFirstFlight && dailyFlights[0]) {
            dailyFlights[0].state = dailyFlights[0].state || {};
            dailyFlights[0].state['limite-hdv'] = label;
        }

        return label;
    }

    function getStoredGlobalLimitHdvLabel() {
        const firstFlightLabel = normalizeHdvLimitLabel(dailyFlights[0]?.state?.['limite-hdv']);
        if (firstFlightLabel) return firstFlightLabel;

        for (const wrapper of getLimitHdvWrappers()) {
            const wrapperLabel = normalizeHdvLimitLabel(wrapper?.dataset?.globalHdvLimit);
            if (wrapperLabel) return wrapperLabel;

            const displayLabel = normalizeHdvLimitLabel(wrapper?.querySelector('.display-input')?.dataset?.globalHdvLimit);
            if (displayLabel) return displayLabel;
        }

        const visibleLabel = normalizeHdvLimitLabel(document.getElementById('limite-hdv')?.querySelector('.display-input')?.value || '');
        return visibleLabel || '08:00';
    }

    function readCalculatorStateFromDom() {
        const state = {};
        document.querySelectorAll('#calculator-modal .input-wrapper').forEach(wrapper => {
            if (wrapper.id) {
                let value = wrapper.querySelector('.display-input')?.value || '';

                /*
                 * v2026.54 — LIMITE HDV dynamique :
                 * le champ affiché peut montrer le restant après les BLOC ARRIVÉE
                 * saisis. En stockage, on conserve la limite journée de référence
                 * pour éviter qu'elle baisse à chaque sauvegarde.
                 */
                if (wrapper.id === 'limite-hdv') {
                    value = getStoredGlobalLimitHdvLabel() || value;
                }

                state[wrapper.id] = value;
            }
        });

        state['bloc-depart-oaci'] = getBlocDepartAirportOaci();

        const tableData = [];
        document.querySelectorAll('#bloc-fuel tbody tr').forEach(row => {
            const time = row.querySelector('.time-input-wrapper .display-input')?.value || '';
            const fuel = row.querySelector('.numeric-input-wrapper .display-input')?.value || '';
            const rltWrapper = row.querySelector('.rlt-mass-input-wrapper');
            const rltMass = rltWrapper?.querySelector('.display-input')?.value || '';
            const rltVolume = rltWrapper?.dataset.volume || '';
            const rltDensity = rltWrapper?.dataset.density || '';
            const rltTopMass = rltWrapper?.dataset.topMass || '';
            const rltTopDensity = rltWrapper?.dataset.topDensity || '';
            const rltTopVolume = rltWrapper?.dataset.topVolume || '';
            const rltBottomVolume = rltWrapper?.dataset.bottomVolume || '';
            const rltBottomDensity = rltWrapper?.dataset.bottomDensity || '';
            const rltBottomMass = rltWrapper?.dataset.bottomMass || '';
            const rltRefracto = rltWrapper?.dataset.refracto || '';
            const rltMode = rltWrapper?.dataset.rltMode || '';
            const rltFirstFull = rltWrapper?.dataset.rltFirstFull || '';
            const rltFirstFullPending = rltWrapper?.dataset.rltFirstFullPending || '';
            const rltFirstFullWanted = rltWrapper?.dataset.rltFirstFullWanted || '';
            const oaci = row.dataset.airportOaci || row.querySelector('.airport-oaci-cell')?.textContent?.replace('--', '').trim() || '';
            if (time || fuel || oaci || rltMass || rltVolume || rltDensity || rltTopMass || rltTopDensity || rltTopVolume || rltBottomVolume || rltBottomDensity || rltBottomMass || rltRefracto || rltMode || rltFirstFull || rltFirstFullPending || rltFirstFullWanted) {
                tableData.push({ time, fuel, oaci, rltMass, rltVolume, rltDensity, rltTopMass, rltTopDensity, rltTopVolume, rltBottomVolume, rltBottomDensity, rltBottomMass, rltRefracto, rltMode, rltFirstFull, rltFirstFullPending, rltFirstFullWanted });
            }
        });
        state.calculator_table_data = compactCalculatorTableData(tableData);
        return state;
    }

    function getFlightDurationFromState(state) {
        if (!state) return 0;

        let previousBlocArrivee = parseTime(state['bloc-depart']);
        let cumulative = 0;

        (state.calculator_table_data || []).forEach(rowData => {
            const blocArrivee = parseTime(rowData.time);
            if (blocArrivee !== null && previousBlocArrivee !== null) {
                const delta = blocArrivee - previousBlocArrivee;
                if (delta > 0) cumulative += delta;
            }
            if (blocArrivee !== null) previousBlocArrivee = blocArrivee;
        });

        return cumulative;
    }

    function getActiveFlightIndex() {
        return dailyFlights.findIndex(flight => flight.id === activeFlightId);
    }

    function getCumulativeHdvBeforeActiveFlight() {
        const activeIndex = getActiveFlightIndex();
        if (activeIndex <= 0) return 0;

        return dailyFlights
            .slice(0, activeIndex)
            .reduce((total, flight) => total + getFlightDurationFromState(flight.state), 0);
    }


    function formatDurationForFlightSummary(totalMinutes) {
        const value = formatTime(totalMinutes) || '00:00';
        return value.replace(':', 'h');
    }

    function updateFlightDurationSummary() {
        const summary = document.getElementById('flight-duration-summary');
        if (!summary) return;

        const activeFlight = dailyFlights.find(flight => flight.id === activeFlightId);
        if (!activeFlight) {
            summary.textContent = '';
            summary.style.display = 'none';
            return;
        }

        let state = activeFlight.state || {};
        try {
            if (!isApplyingFlightState && document.querySelector('#bloc-fuel tbody')) {
                state = readCalculatorStateFromDom();
            }
        } catch (_) {}

        const flightDuration = getFlightDurationFromState(state);
        const activeIndex = getActiveFlightIndex();
        const flightText = `Tps de vol : ${formatDurationForFlightSummary(flightDuration)}`;

        if (activeIndex > 0) {
            const totalDuration = getCumulativeHdvBeforeActiveFlight() + flightDuration;
            summary.innerHTML = `<span>${flightText}</span><span class="flight-duration-separator">/</span><span class="flight-duration-total">Total : ${formatDurationForFlightSummary(totalDuration)}</span>`;
        } else {
            summary.textContent = flightText;
        }

        summary.style.display = 'inline-flex';
    }

    function getGlobalLimitHdvMinutes() {
        /*
         * v2026.54 — Limite HDV journée :
         * la valeur stockée reste la limite journée de référence, même si le
         * champ affiché montre le restant après les BLOC ARRIVÉE déjà saisis.
         */
        const storedLimit = parseTime(getStoredGlobalLimitHdvLabel());
        return storedLimit !== null ? storedLimit : parseTime('08:00');
    }

    function getCurrentActiveFlightDurationFromDom() {
        try {
            const currentState = readCalculatorStateFromDom();
            return getFlightDurationFromState(currentState);
        } catch (_) {
            return 0;
        }
    }

    function getEffectiveLimitHdvForActiveFlight(options = {}) {
        const includeCurrentFlight = !!options.includeCurrentFlight;
        const globalLimit = getGlobalLimitHdvMinutes();
        let used = 0;
        try {
            used = getCumulativeHdvBeforeActiveFlight();
        } catch (_) {
            used = 0;
        }

        if (includeCurrentFlight) {
            used += getCurrentActiveFlightDurationFromDom();
        }

        if (globalLimit === null) return null;
        return Math.max(0, globalLimit - used);
    }

    function updateDisplayedLimitHdvForActiveFlight() {
        /*
         * v13.54 — LIMITE HDV figée par vol :
         * - vol n°1 : affiche la limite journée saisie par l'utilisateur ;
         * - vols n°2 et suivants : affiche le restant disponible après les vols précédents ;
         * - la durée du vol actif n'est pas retranchée de son propre champ LIMITE HDV.
         */
        const globalLabel = getStoredGlobalLimitHdvLabel();
        setStoredGlobalLimitHdvLabel(globalLabel, { persistFirstFlight: false });

        const effectiveLimit = getEffectiveLimitHdvForActiveFlight({ includeCurrentFlight: false });
        const effectiveLabel = formatTime(effectiveLimit) || '00:00';

        const mainWrapper = document.getElementById('limite-hdv');
        const previWrapper = document.getElementById('previ-limite-hdv');

        [mainWrapper, previWrapper].forEach(wrapper => {
            const input = wrapper?.querySelector('.display-input');
            const engine = wrapper?.querySelector('.engine-input');
            if (!input) return;
            wrapper.dataset.currentHdvRemaining = effectiveLabel;
            input.value = effectiveLabel;
            input.dataset.effectiveMultiflightLimit = effectiveLabel;
            if (engine) engine.value = effectiveLabel;
        });
    }

    function persistFlights() {
        normalizeFlightNumbers();
        localStorage.setItem(MULTI_FLIGHT_STORAGE_KEY, JSON.stringify(dailyFlights));
        if (activeFlightId) {
            localStorage.setItem(ACTIVE_FLIGHT_ID_STORAGE_KEY, activeFlightId);
        }
    }

    function updateActiveFlightStateFromDom() {
        if (!activeFlightId || isApplyingFlightState) return;
        const activeFlight = dailyFlights.find(flight => flight.id === activeFlightId);
        if (!activeFlight) return;
        const nextState = readCalculatorStateFromDom();

        /*
         * v12.31 : pour les vols n°2 et suivants, le champ LIMITE HDV affiché
         * est le restant journée. On ne doit pas l'utiliser comme nouvelle limite
         * globale, sinon elle baisse à chaque changement de vol.
         */
        if (getActiveFlightIndex() > 0 && dailyFlights[0]?.state?.['limite-hdv']) {
            nextState['limite-hdv'] = dailyFlights[0].state['limite-hdv'];
        }

        activeFlight.state = nextState;
        persistFlights();
    }


    function buildRltExportCalculationLabel(rowData = {}) {
        const parseExportNumber = (value) => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).replace(/[^0-9,.-]/g, '').replace(',', '.');
            const num = Number(normalized);
            return Number.isFinite(num) ? num : null;
        };
        const formatExportNumber = (value, decimals = 0) => {
            const num = parseExportNumber(value);
            if (num === null) return '';
            return decimals > 0 ? num.toFixed(decimals) : String(Math.round(num));
        };

        const candidates = [
            { volume: rowData.rltBottomVolume, density: rowData.rltBottomDensity, mass: rowData.rltBottomMass || rowData.rltMass },
            { volume: rowData.rltVolume, density: rowData.rltDensity, mass: rowData.rltMass },
            { volume: rowData.rltTopVolume, density: rowData.rltTopDensity, mass: rowData.rltTopMass || rowData.rltMass }
        ];

        for (const candidate of candidates) {
            const volume = parseExportNumber(candidate.volume);
            const density = parseExportNumber(candidate.density);
            const mass = parseExportNumber(candidate.mass);
            if (volume !== null && density !== null) {
                const computedMass = mass !== null ? mass : volume * density;
                return `${formatExportNumber(volume)} L × ${formatExportNumber(density, 3)} = ${formatExportNumber(computedMass)} kg`;
            }
        }

        return '';
    }

    function getBlocFuelExportRowCalculations(state, flightIndex = 0) {
        const rows = [];
        const globalLimit = parseTime(dailyFlights[0]?.state?.['limite-hdv']) ?? parseTime(state?.['limite-hdv']);
        const hdvBeforeFlight = dailyFlights
            .slice(0, Math.max(0, flightIndex))
            .reduce((total, flight) => total + getFlightDurationFromState(flight.state), 0);
        const limitForFlight = globalLimit !== null ? Math.max(0, globalLimit - hdvBeforeFlight) : null;

        let previousBlocArrivee = parseTime(state?.['bloc-depart']);
        let previousFuelPelic = parseNumeric(state?.['fuel-depart']);
        let cumulativeTpsVol = 0;

        compactCalculatorTableData(state?.calculator_table_data || []).forEach((rowData) => {
            const blocArrivee = parseTime(rowData.time || '');
            const fuelPelic = parseNumeric(rowData.fuel || '');
            const isFirstFullRlt = rowData.rltFirstFull === '1' || rowData.rltMode === 'firstFull';

            let dureeRotation = null;
            let fuelRotation = null;
            let tpsVol = null;
            let tpsVolRestant = null;

            if (!isFirstFullRlt) {
                if (blocArrivee !== null && previousBlocArrivee !== null) {
                    dureeRotation = blocArrivee - previousBlocArrivee;
                }
                if (fuelPelic !== null && previousFuelPelic !== null) {
                    fuelRotation = previousFuelPelic - fuelPelic;
                }
                if (blocArrivee !== null) {
                    if (dureeRotation !== null && dureeRotation > 0) cumulativeTpsVol += dureeRotation;
                    tpsVol = cumulativeTpsVol;
                    tpsVolRestant = limitForFlight !== null ? limitForFlight - cumulativeTpsVol : null;
                }
            }

            rows.push({
                blocArrivee: rowData.time || '',
                fuelPelic: rowData.fuel || '',
                oaci: rowData.oaci || '',
                rlt: rowData.rltMass || '',
                rltCalculation: buildRltExportCalculationLabel(rowData),
                dureeRotation: isFirstFullRlt ? '' : (formatTime(dureeRotation) || '--'),
                fuelRotation: isFirstFullRlt ? '' : (fuelRotation === null ? '--' : String(fuelRotation)),
                tpsVol: isFirstFullRlt ? '' : (formatTime(tpsVol) || (blocArrivee !== null ? '00:00' : '--')),
                tpsVolRestant: isFirstFullRlt ? '' : (formatTime(tpsVolRestant) || '--'),
                isFirstFullRlt
            });

            if (blocArrivee !== null) previousBlocArrivee = blocArrivee;
            if (fuelPelic !== null) previousFuelPelic = fuelPelic;
        });

        return rows;
    }

    function getBlocFuelExportTimestamp(date = new Date()) {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yy = String(date.getFullYear()).slice(-2);
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${dd}/${mm}/${yy} ${hh}:${min}`;
    }

    function getBlocFuelExportTitle(date = new Date()) {
        return `NPF-Q400 ${getBlocFuelExportTimestamp(date)}`;
    }

    function getBlocFuelExportSafeFileName(extension = 'pdf', date = new Date()) {
        const timestamp = getBlocFuelExportTimestamp(date)
            .replace(/\//g, '-')
            .replace(/:/g, 'h');
        return `NPF-Q400 ${timestamp}.${extension}`;
    }

    function getBlocFuelExportPrintDocumentTitle(date = new Date()) {
        /*
         * iPadOS refuse les / et : comme nom de fichier. Le titre interne du
         * document garde le format demandé, mais le nom PDF proposé utilise une
         * variante compatible fichiers : NPF-Q400 10-07-26 15h10.
         */
        const timestamp = getBlocFuelExportTimestamp(date)
            .replace(/\//g, '-')
            .replace(/:/g, 'h');
        return `NPF-Q400 ${timestamp}`;
    }

    function getBlocFuelFlightsForExport() {
        return dailyFlights
            .map((flight, originalIndex) => ({ flight, originalIndex }))
            .filter(({ flight }) => parseTime(flight?.state?.['bloc-depart']) !== null);
    }

    function buildBlocFuelExportHtml(options = {}) {
        updateActiveFlightStateFromDom();
        ensureFlightsLoadedFromStorage();
        normalizeFlightNumbers();

        const exportGeneratedAt = options.exportGeneratedAt instanceof Date ? options.exportGeneratedAt : new Date();
        const exportDate = getBlocFuelExportTimestamp(exportGeneratedAt);
        const exportTitle = getBlocFuelExportTitle(exportGeneratedAt);
        const exportPrintDocumentTitle = getBlocFuelExportPrintDocumentTitle(exportGeneratedAt);
        const exportHtmlFileName = getBlocFuelExportSafeFileName('html', exportGeneratedAt);
        const includeControls = !!options.includeControls;
        const safe = (value) => escapeHtml(value || '');
        const stripKgForExport = (value) => String(value ?? '')
            .replace(/kg/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        const kgExportHtml = (value, fallback = '--') => {
            const raw = stripKgForExport(value);
            const clean = raw || fallback;
            if (!clean || clean === '--') return '<span class="kg-inline"><span class="kg-number">--</span></span>';
            return `<span class="kg-inline"><span class="kg-number">${safe(clean)}</span><span class="kg-unit">kg</span></span>`;
        };
        const plainExportHtml = (value, fallback = '--') => safe(String(value ?? '').trim() || fallback);
        const flightsForExport = getBlocFuelFlightsForExport();
        const totalHdv = flightsForExport.reduce((total, item) => total + getFlightDurationFromState(item.flight.state), 0);
        let cumulativeExportHdv = 0;

        const flightSections = flightsForExport.length ? flightsForExport.map(({ flight, originalIndex }, exportIndex) => {
            const state = flight.state || {};
            const rows = getBlocFuelExportRowCalculations(state, originalIndex);
            const flightDuration = getFlightDurationFromState(state);
            cumulativeExportHdv += flightDuration;
            const flightDurationLabel = formatDurationForFlightSummary(flightDuration);
            const titleDurationLabel = exportIndex > 0
                ? `Tps de vol : ${safe(flightDurationLabel)} / Total : ${safe(formatDurationForFlightSummary(cumulativeExportHdv))}`
                : `Tps de vol : ${safe(flightDurationLabel)}`;
            const rowsHtml = rows.length
                ? rows.map(row => `
                    <tr${row.isFirstFullRlt ? ' class="first-full-row"' : ''}>
                        <td>${plainExportHtml(row.blocArrivee)}</td>
                        <td class="kg-cell">${kgExportHtml(row.fuelPelic)}</td>
                        <td>${plainExportHtml(row.oaci, '--')}</td>
                        <td class="kg-cell rlt-export-cell">${kgExportHtml(row.rlt)}${row.rltCalculation ? `<div class="rlt-calc-line">${safe(row.rltCalculation)}</div>` : ''}</td>
                        <td>${plainExportHtml(row.dureeRotation)}</td>
                        <td>${plainExportHtml(row.fuelRotation)}</td>
                        <td>${plainExportHtml(row.tpsVol)}</td>
                        <td>${plainExportHtml(row.tpsVolRestant)}</td>
                    </tr>`).join('')
                : '<tr><td colspan="8" class="empty-row">Aucune ligne BLOC arrivée saisie</td></tr>';

            return `
                <section class="flight-section">
                    <div class="flight-title-row">
                        <h2>Vol n°${flight.number || exportIndex + 1}${flight.closed ? ' — clôturé' : ''}</h2>
                        <span>${titleDurationLabel}</span>
                    </div>
                    <div class="header-grid">
                        <div><b>BLOC DÉPART</b><span>${plainExportHtml(state['bloc-depart'], '--:--')}</span></div>
                        <div class="header-card-fuel-depart"><b>FUEL DÉPART</b><span class="fuel-depart-export-value">${kgExportHtml(state['fuel-depart'])}</span></div>
                        <div class="header-card-rlt-depart"><b>RLT</b><span>${kgExportHtml(state['rlt-depart'])}</span></div>
                        <div><b>BASE</b><span>${plainExportHtml(state['base-oaci-input'] || selectedBaseOACI || DEFAULT_BASE_OACI)}</span></div>
                        <div><b>TMD</b><span>${plainExportHtml(state['tmd'], '--:--')}</span></div>
                        <div><b>LIMITE HDV</b><span>${plainExportHtml(state['limite-hdv'], '--:--')}</span></div>
                    </div>
                    <table class="bloc-fuel-export-table">
                        <colgroup>
                            <col class="col-bloc-arrivee">
                            <col class="col-fuel-pelic">
                            <col class="col-oaci">
                            <col class="col-masse-rlt">
                            <col class="col-duree-rot">
                            <col class="col-fuel-rot">
                            <col class="col-tps-vol">
                            <col class="col-tps-restant">
                        </colgroup>
                        <thead>
                            <tr>
                                <th>BLOC Arrivée</th>
                                <th>FUEL Pélic.</th>
                                <th>OACI</th>
                                <th>Masse Rlt</th>
                                <th>Durée Rot.</th>
                                <th>Fuel Rot.</th>
                                <th>Tps de Vol</th>
                                <th>Tps de Vol Restant</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </section>`;
        }).join('') : '<section class="flight-section"><h2>Aucun vol avec BLOC DÉPART renseigné</h2></section>';

        return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${safe(exportPrintDocumentTitle)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    @page { size: A4 landscape; margin: 5mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 0; padding: 8px 10px; color: #111827; background: #fff; }
    .topbar { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; border-bottom: 3px solid #005a9c; padding-bottom: 8px; }
    h1 { margin: 0; font-size: 24px; color: #005a9c; }
    .meta { text-align: right; font-size: 13px; color: #475569; font-weight: 700; }
    .export-toolbar { position: fixed; right: 18px; bottom: 18px; z-index: 10; display: flex; gap: 8px; align-items: center; }
    .export-toolbar button { border: 0; border-radius: 12px; background: #005a9c; color: #fff; padding: 12px 16px; font-size: 15px; font-weight: 900; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
    .export-toolbar .close-export-btn { background: #334155; }
    .flight-section { page-break-inside: avoid; margin: 0 0 12px; padding: 10px; border: 1px solid #cbd5e1; border-radius: 12px; background: #f8fafc; overflow: hidden; }
    .flight-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
    h2 { margin: 0; font-size: 20px; color: #0f172a; }
    .flight-title-row span { font-size: 15px; font-weight: 900; color: #005a9c; white-space: nowrap; }
    .header-grid { display: grid; grid-template-columns: .9fr 1.15fr .85fr .85fr .9fr .95fr; gap: 7px; margin-bottom: 10px; }
    .header-grid div { border: 1px solid #d7dee8; background: #fff; border-radius: 10px; padding: 8px 9px; min-height: 76px; overflow: hidden; display: grid; grid-template-rows: 28px 1fr; align-items: stretch; }
    .header-grid b { display: flex; align-items: flex-start; min-height: 28px; margin: 0; font-size: 10.5px; line-height: 1.1; letter-spacing: .04em; color: #64748b; text-transform: uppercase; }
    .header-grid span { display: flex; align-items: center; justify-content: flex-start; width: 100%; min-width: 0; margin: 0; font-size: 19px; line-height: 1; font-weight: 950; color: #111827; white-space: nowrap; overflow: visible; }
    .header-grid span .kg-inline { justify-content: flex-start !important; max-width: 100%; min-width: 0; }
    .header-grid span .kg-unit { font-size: .50em !important; }
    .header-card-fuel-depart { overflow: visible !important; }
    .header-card-fuel-depart .fuel-depart-export-value { font-size: 19px !important; letter-spacing: -0.04em; overflow: visible !important; white-space: nowrap !important; }
    .header-card-fuel-depart .kg-inline { gap: 5px !important; transform: none !important; transform-origin: left center; flex-shrink: 0; }
    .header-grid .header-card-fuel-depart .fuel-depart-export-value .kg-inline,
    .header-grid .header-card-fuel-depart .fuel-depart-export-value .kg-number,
    .header-grid .header-card-fuel-depart .fuel-depart-export-value .kg-unit { font-size: 1em !important; line-height: 1 !important; }
    .header-grid .header-card-fuel-depart .fuel-depart-export-value .kg-unit { margin-left: 0 !important; }
    .header-card-rlt-depart .kg-inline { justify-content: flex-start !important; gap: 4px !important; }
    .header-card-rlt-depart .kg-number { font-size: 1em !important; }
    .header-card-rlt-depart .kg-unit { font-size: .55em !important; }
    .kg-inline { display: inline-flex !important; align-items: baseline; justify-content: center; gap: 4px; white-space: nowrap; line-height: 1 !important; }
    .kg-number { display: inline-block; line-height: 1 !important; }
    .kg-unit { display: inline-block; font-size: .48em; line-height: 1 !important; font-weight: 900; color: #111827; }
    table.bloc-fuel-export-table { width: 100%; table-layout: fixed; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; }
    .bloc-fuel-export-table .col-bloc-arrivee { width: 10%; }
    .bloc-fuel-export-table .col-fuel-pelic { width: 11%; }
    .bloc-fuel-export-table .col-oaci { width: 8%; }
    .bloc-fuel-export-table .col-masse-rlt { width: 27%; }
    .bloc-fuel-export-table .col-duree-rot { width: 9%; }
    .bloc-fuel-export-table .col-fuel-rot { width: 9%; }
    .bloc-fuel-export-table .col-tps-vol { width: 10%; }
    .bloc-fuel-export-table .col-tps-restant { width: 16%; }
    th, td { border: 1px solid #d7dee8; padding: 6px 4px; text-align: center; font-size: 12.5px; line-height: 1.12; vertical-align: middle; overflow: hidden; }
    th { background: #005a9c; color: #fff; font-weight: 900; font-size: 12px; line-height: 1.08; }
    td { font-weight: 800; }
    th:nth-child(5), th:nth-child(6) { font-size: 11.8px; }
    td:nth-child(5), td:nth-child(6) { font-size: 12.5px; white-space: nowrap; }
    td.kg-cell .kg-inline { font-size: 18px; }
    td.kg-cell .kg-unit { font-size: .68em; }
    .rlt-export-cell { line-height: 1.06; padding-left: 3px; padding-right: 3px; white-space: nowrap; overflow: hidden; }
    .rlt-export-cell .kg-inline { font-size: 13px; }
    .rlt-calc-line { display: block; margin-top: 2px; font-size: 8.4px; line-height: 1.05; font-weight: 800; color: #475569; white-space: nowrap; letter-spacing: -0.055em; overflow: visible; }
    tr.first-full-row td { background: #fff7ed; }
    .empty-row { color: #64748b; font-style: italic; padding: 16px; }

    .header-card-fuel-depart .kg-number,
    .header-card-fuel-depart .kg-unit { font-size: 1em !important; line-height: 1 !important; }
    .header-card-fuel-depart .kg-unit { color: #111827 !important; font-weight: 950 !important; }
    .rlt-export-cell .kg-number { font-size: 13px; }
    @media print { .export-toolbar { display: none; } body { padding: 0; } .flight-section { background: #fff; } }
</style>
</head>
<body>
    ${includeControls ? `<div class="export-toolbar"><button onclick="shareBlocFuelPreview()">Partager</button><button onclick="window.print()">PDF / Imprimer</button><button class="close-export-btn" onclick="closeBlocFuelPreview()">Fermer</button></div>` : ''}
    <div class="topbar">
        <div>
            <h1>${safe(exportTitle)}</h1>
            <div>Total vols exportés : ${flightsForExport.length} · Total HDV : ${safe(formatDurationForFlightSummary(totalHdv))}</div>
        </div>
        <div class="meta">Export : ${safe(exportDate)}<br>Vols exportés : ${flightsForExport.length}<br>Version : ${safe(window.APP_VERSION || 'v13.26')}</div>
    </div>
    ${flightSections}
    <script>
    function closeBlocFuelPreview() {
        try { window.close(); } catch (_) {}
        setTimeout(function () {
            try {
                if (!window.closed) {
                    document.body.classList.add('export-close-failed');
                    alert("Fermez cet aperçu avec le bouton retour ou la gestion des fenêtres de l’iPad.");
                }
            } catch (_) {}
        }, 250);
    }
    async function shareBlocFuelPreview() {
        try {
            const clone = document.documentElement.cloneNode(true);
            clone.querySelectorAll('.export-toolbar, script').forEach(function (el) { el.remove(); });
            const html = '<!doctype html>\n' + clone.outerHTML;
            const file = new File([html], '${safe(exportHtmlFileName)}', { type: 'text/html' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ title: '${safe(exportPrintDocumentTitle)}', text: 'Export BLOC/FUEL NPF-Q400', files: [file] });
                return;
            }
            if (navigator.share) {
                await navigator.share({ title: '${safe(exportPrintDocumentTitle)}', text: 'Export BLOC/FUEL NPF-Q400' });
                return;
            }
            alert('Partage natif non disponible sur ce navigateur. Utilisez PDF / Imprimer.');
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            alert('Partage impossible : ' + (error && error.message ? error.message : error));
        }
    }
    <\/script>
</body>
</html>`;
    }

    function buildBlocFuelExportFileName(extension = 'pdf') {
        return getBlocFuelExportSafeFileName(extension, new Date());
    }

    function normalizePdfText(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[’‘]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[–—]/g, '-')
            .replace(/°/g, 'deg')
            .replace(/[^\x20-\x7E]/g, ' ');
    }

    function escapePdfText(value) {
        return normalizePdfText(value)
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
    }

    function fitPdfCell(value, width) {
        const text = normalizePdfText(value).replace(/\s+/g, ' ').trim();
        if (text.length <= width) return text.padEnd(width, ' ');
        return (text.slice(0, Math.max(0, width - 1)) + '…').replace(/[^\x20-\x7E]/g, '.');
    }

    function splitPdfLine(value, maxChars = 118) {
        const text = normalizePdfText(value).replace(/\s+/g, ' ').trimEnd();
        if (text.length <= maxChars) return [text];

        const lines = [];
        let rest = text;
        while (rest.length > maxChars) {
            let cut = rest.lastIndexOf(' ', maxChars);
            if (cut < 40) cut = maxChars;
            lines.push(rest.slice(0, cut).trimEnd());
            rest = rest.slice(cut).trimStart();
        }
        if (rest) lines.push(rest);
        return lines;
    }

    function buildBlocFuelExportPdfPages() {
        updateActiveFlightStateFromDom();
        ensureFlightsLoadedFromStorage();
        normalizeFlightNumbers();

        const pages = [[]];
        const maxLinesPerPage = 36;
        const addLine = (line = '') => {
            const parts = splitPdfLine(line, 118);
            parts.forEach((part) => {
                if (pages[pages.length - 1].length >= maxLinesPerPage) pages.push([]);
                pages[pages.length - 1].push(part);
            });
        };
        const addBlank = () => addLine('');
        const addSeparator = () => addLine('-'.repeat(118));

        const exportGeneratedAt = new Date();
        const exportDate = getBlocFuelExportTimestamp(exportGeneratedAt);
        const exportTitle = getBlocFuelExportTitle(exportGeneratedAt);
        const flightsForExport = getBlocFuelFlightsForExport();
        const totalHdv = flightsForExport.reduce((total, item) => total + getFlightDurationFromState(item.flight.state), 0);
        let cumulativeExportHdv = 0;

        addLine(exportTitle);
        addLine(`Export : ${exportDate}    Version : ${window.APP_VERSION || 'v13.20'}`);
        addLine(`Total vols exportes : ${flightsForExport.length}    Total HDV : ${formatDurationForFlightSummary(totalHdv)}`);
        addSeparator();

        flightsForExport.forEach(({ flight, originalIndex }, exportIndex) => {
            const state = flight.state || {};
            const rows = getBlocFuelExportRowCalculations(state, originalIndex);
            const flightDuration = getFlightDurationFromState(state);
            cumulativeExportHdv += flightDuration;
            const durationText = exportIndex > 0
                ? `Tps de vol : ${formatDurationForFlightSummary(flightDuration)} / Total : ${formatDurationForFlightSummary(cumulativeExportHdv)}`
                : `Tps de vol : ${formatDurationForFlightSummary(flightDuration)}`;
            addBlank();
            addLine(`VOL N°${flight.number || exportIndex + 1}${flight.closed ? ' - cloture' : ''}    ${durationText}`);
            addLine(`BLOC DEPART : ${state['bloc-depart'] || '--:--'}    FUEL Depart : ${state['fuel-depart'] || '-- kg'}    RLT : ${state['rlt-depart'] || '-- kg'}    Base : ${state['base-oaci-input'] || selectedBaseOACI || DEFAULT_BASE_OACI}    TMD : ${state['tmd'] || '--:--'}    LIMITE HDV : ${state['limite-hdv'] || '--:--'}`);
            addLine('BLOC Arr | FUEL Pelic | OACI | Masse Rlt | Duree Rot | Fuel Rot | Tps Vol | Restant');
            addSeparator();

            if (!rows.length) {
                addLine('Aucune ligne BLOC arrivee saisie');
                return;
            }

            rows.forEach((row) => {
                addLine([
                    fitPdfCell(row.blocArrivee || '--:--', 8),
                    fitPdfCell(row.fuelPelic || '--', 10),
                    fitPdfCell(row.oaci || '--', 4),
                    fitPdfCell(row.rlt || '--', 9),
                    fitPdfCell(row.dureeRotation || '--', 9),
                    fitPdfCell(row.fuelRotation || '--', 8),
                    fitPdfCell(row.tpsVol || '--', 7),
                    fitPdfCell(row.tpsVolRestant || '--', 7)
                ].join(' | '));
                if (row.rltCalculation) addLine(`          Calcul RLT : ${row.rltCalculation}`);
            });
        });

        return pages;
    }

    function createSimplePdfBlobFromPages(pages) {
        const pageWidth = 842;
        const pageHeight = 595;
        const marginLeft = 32;
        const startY = 560;
        const lineHeight = 13;
        const objects = [];

        const addObject = (body) => {
            objects.push(body);
            return objects.length;
        };

        const catalogId = addObject('');
        const pagesId = addObject('');
        const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
        const pageIds = [];

        pages.forEach((lines, pageIndex) => {
            const contentLines = [
                'BT',
                `/F1 ${pageIndex === 0 ? 10 : 9.5} Tf`,
                `${marginLeft} ${startY} Td`,
                `${lineHeight} TL`
            ];
            lines.forEach((line) => {
                contentLines.push(`(${escapePdfText(line)}) Tj`);
                contentLines.push('T*');
            });
            contentLines.push('ET');
            const stream = contentLines.join('\n');
            const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
            const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
            pageIds.push(pageId);
        });

        objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
        objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

        let pdf = '%PDF-1.4\n%NPF-Q400\n';
        const offsets = [0];
        objects.forEach((body, index) => {
            offsets[index + 1] = pdf.length;
            pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
        });
        const xrefOffset = pdf.length;
        pdf += `xref\n0 ${objects.length + 1}\n`;
        pdf += '0000000000 65535 f \n';
        for (let i = 1; i <= objects.length; i += 1) {
            pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
        }
        pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

        return new Blob([pdf], { type: 'application/pdf' });
    }

    function buildBlocFuelExportPdfBlob() {
        const pages = buildBlocFuelExportPdfPages();
        return createSimplePdfBlobFromPages(pages);
    }

    async function shareBlocFuelPdfFile() {
        if (!navigator.share || typeof File === 'undefined') return false;

        const pdfBlob = buildBlocFuelExportPdfBlob();
        const pdfFile = new File([pdfBlob], buildBlocFuelExportFileName('pdf'), { type: 'application/pdf' });

        if (!navigator.canShare || !navigator.canShare({ files: [pdfFile] })) {
            return false;
        }

        await navigator.share({
            title: 'NPF-Q400 — BLOC/FUEL',
            text: 'Export PDF BLOC/FUEL NPF-Q400',
            files: [pdfFile]
        });
        return true;
    }

    function openBlocFuelExportPreview() {
        const exportGeneratedAt = new Date();
        const exportPrintDocumentTitle = getBlocFuelExportPrintDocumentTitle(exportGeneratedAt);
        const html = buildBlocFuelExportHtml({ includeControls: false, exportGeneratedAt });
        let overlay = document.getElementById('bloc-fuel-export-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'bloc-fuel-export-overlay';
        overlay.dataset.exportPrintTitle = exportPrintDocumentTitle;
        overlay.innerHTML = `
            <div class="bloc-fuel-export-panel" role="dialog" aria-modal="true" aria-label="Aperçu export BLOC/FUEL">
                <div class="bloc-fuel-export-toolbar">
                    <div class="bloc-fuel-export-title">Export BLOC/FUEL</div>
                    <div class="export-hint">Aperçu imprimable. Utiliser “PDF / Imprimer” puis “Partager / Enregistrer en PDF” sur iPad.</div>
                    <button type="button" id="bloc-fuel-export-print-btn" class="print-primary">PDF / Imprimer</button>
                    <button type="button" id="bloc-fuel-export-close-btn" class="secondary">Fermer</button>
                </div>
                <iframe id="bloc-fuel-export-frame" title="${escapeHtml(exportPrintDocumentTitle)}"></iframe>
            </div>`;
        document.body.appendChild(overlay);

        const cleanupPreview = () => {
            try {
                const blobUrl = overlay.dataset.exportBlobUrl;
                if (blobUrl) URL.revokeObjectURL(blobUrl);
            } catch (_) {}
            overlay.remove();
        };

        const frame = overlay.querySelector('#bloc-fuel-export-frame');
        if (frame) {
            try {
                const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                const blobUrl = URL.createObjectURL(blob);
                overlay.dataset.exportBlobUrl = blobUrl;
                frame.src = blobUrl;
            } catch (_) {
                frame.srcdoc = html;
            }
            frame.addEventListener('load', () => {
                try {
                    frame.contentWindow.document.title = exportPrintDocumentTitle;
                } catch (_) {}
            }, { once: true });
        }

        overlay.querySelector('#bloc-fuel-export-close-btn')?.addEventListener('click', cleanupPreview);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanupPreview();
        });
        overlay.querySelector('#bloc-fuel-export-print-btn')?.addEventListener('click', () => {
            try {
                const win = frame?.contentWindow;
                const printTitle = overlay.dataset.exportPrintTitle || exportPrintDocumentTitle;
                const previousAppTitle = document.title;
                if (win) {
                    try { document.title = printTitle; } catch (_) {}
                    try { win.document.title = printTitle; } catch (_) {}
                    win.focus();
                    win.print();
                    setTimeout(() => {
                        try { document.title = previousAppTitle || 'NPF-Q400'; } catch (_) {}
                    }, 12000);
                }
            } catch (error) {
                alert(`Impression impossible : ${error.message || error}`);
            }
        });
    }

    async function exportBlocFuelPdf() {
        try {
            /*
             * v13.13 — retour au rendu imprimable HTML, plus propre que le PDF
             * généré en texte pur. L'export s'ouvre dans une modale fermable.
             */
            openBlocFuelExportPreview();
        } catch (error) {
            console.error('Export BLOC/FUEL impossible:', error);
            alert(`Export BLOC/FUEL impossible : ${error.message || error}`);
        }
    }

    function ensureFlightsLoadedFromStorage() {
        try {
            const savedFlights = JSON.parse(localStorage.getItem(MULTI_FLIGHT_STORAGE_KEY) || 'null');
            if (Array.isArray(savedFlights) && savedFlights.length) {
                dailyFlights = savedFlights;
            }
        } catch (_) {
            dailyFlights = [];
        }

        if (!dailyFlights.length) {
            let legacyState = {};
            try {
                legacyState = JSON.parse(localStorage.getItem('calculator_state') || '{}') || {};
            } catch (_) {
                legacyState = {};
            }
            dailyFlights = [createEmptyFlight(1)];
            dailyFlights[0].state = {
                'bloc-depart': legacyState['bloc-depart'] || '',
                'bloc-depart-oaci': legacyState['bloc-depart-oaci'] || '',
                'fuel-depart': legacyState['fuel-depart'] || '3500 kg',
                'rlt-depart': legacyState['rlt-depart'] || '',
                'previ-bloc-depart': legacyState['previ-bloc-depart'] || legacyState['bloc-depart'] || '',
                'previ-fuel-depart': legacyState['previ-fuel-depart'] || legacyState['fuel-depart'] || '3500 kg',
                'tmd': legacyState['tmd'] || '21:30',
                'limite-hdv': legacyState['limite-hdv'] || '08:00',
                'deroutement-heure-wrapper': legacyState['deroutement-heure-wrapper'] || '',
                'deroutement-fuel-wrapper': legacyState['deroutement-fuel-wrapper'] || '',
                'suivi-conso-rotation-wrapper': legacyState['suivi-conso-rotation-wrapper'] || '',
                'suivi-duree-rotation-wrapper': legacyState['suivi-duree-rotation-wrapper'] || '',
                calculator_table_data: legacyState.calculator_table_data || []
            };
        }

        normalizeFlightNumbers();

        const savedActiveId = localStorage.getItem(ACTIVE_FLIGHT_ID_STORAGE_KEY);
        activeFlightId = dailyFlights.some(flight => flight.id === savedActiveId)
            ? savedActiveId
            : dailyFlights[dailyFlights.length - 1].id;

        persistFlights();
    }

    function refreshFlightSelector() {
        const select = document.getElementById('flight-select');
        const closeButton = document.getElementById('close-flight-btn');
        if (!select) return;

        if (!Array.isArray(dailyFlights) || !dailyFlights.length) {
            dailyFlights = [createEmptyFlight(1)];
            activeFlightId = dailyFlights[0].id;
        }

        select.innerHTML = '';
        dailyFlights.forEach(flight => {
            const option = document.createElement('option');
            option.value = flight.id;
            option.textContent = `Vol n°${flight.number}${flight.closed ? ' — clôturé' : ' — en cours'}`;
            select.appendChild(option);
        });
        select.value = activeFlightId || '';

        const activeFlight = dailyFlights.find(flight => flight.id === activeFlightId);
        if (closeButton) {
            closeButton.textContent = activeFlight?.closed ? 'Réouvrir' : 'Clôturer';
        }

        updateActiveFlightLockState();
        updateFlightDurationSummary();
    }

    function updateActiveFlightLockState() {
        const activeFlight = dailyFlights.find(flight => flight.id === activeFlightId);
        const isClosed = !!activeFlight?.closed;
        const blocFuelPanel = document.getElementById('bloc-fuel');
        const lockStatus = document.getElementById('flight-lock-status');

        if (blocFuelPanel) {
            blocFuelPanel.classList.toggle('flight-locked', isClosed);
        }

        if (lockStatus) {
            lockStatus.textContent = '';
            lockStatus.style.display = 'none';
        }

        updateFlightDurationSummary();

        /*
         * v12.44 — verrouillage réel des vols clôturés :
         * les champs du vol restent lisibles mais ne doivent plus être modifiables
         * tant que l'utilisateur n'a pas cliqué sur “Réouvrir”.
         */
        const editableSelectors = [
            '#bloc-fuel .header-section .input-wrapper',
            '#bloc-fuel .table-wrapper .input-wrapper'
        ];

        editableSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(wrapper => {
                wrapper.classList.toggle('locked-input-wrapper', isClosed);
                wrapper.setAttribute('aria-disabled', isClosed ? 'true' : 'false');
            });
        });
    }

    function applyFlightStateToDom(state) {
        isApplyingFlightState = true;
        try {
            const tableBody = document.querySelector('#bloc-fuel tbody');
            tableBody.innerHTML = '';

            initializeTimeInput(document.getElementById('bloc-depart'), state['bloc-depart']);
            setBlocDepartAirportOaci(state['bloc-depart-oaci'] || '');
            initializeNumericInput(document.getElementById('fuel-depart'), state['fuel-depart'] || '3500 kg');
            initializeNumericInput(document.getElementById('rlt-depart'), state['rlt-depart'] || '');
            initializeTimeInput(document.getElementById('tmd'), state['tmd'] || '21:30');
            initializeTimeInput(document.getElementById('limite-hdv'), state['limite-hdv'] || '08:00');

            initializeTimeInput(document.getElementById('previ-bloc-depart'), state['previ-bloc-depart'] || state['bloc-depart'] || '');
            initializeNumericInput(document.getElementById('previ-fuel-depart'), state['previ-fuel-depart'] || state['fuel-depart'] || '3500 kg');
            initializeTimeInput(document.getElementById('previ-tmd'), state['tmd'] || '21:30');
            initializeTimeInput(document.getElementById('previ-limite-hdv'), state['limite-hdv'] || '08:00');

            refreshSharedHeaderMirrorValues();
            initializeTimeInput(document.getElementById('deroutement-heure-wrapper'), state['deroutement-heure-wrapper']);
            initializeNumericInput(document.getElementById('deroutement-fuel-wrapper'), state['deroutement-fuel-wrapper']);
            initializeNumericInput(document.getElementById('suivi-conso-rotation-wrapper'), state['suivi-conso-rotation-wrapper']);
            initializeTimeInput(document.getElementById('suivi-duree-rotation-wrapper'), state['suivi-duree-rotation-wrapper']);

            const tableData = compactCalculatorTableData(state.calculator_table_data || []);
            const activeFlight = dailyFlights.find(flight => flight.id === activeFlightId);
            const isClosedFlight = !!activeFlight?.closed;
            tableData.forEach(rowData => addNewRow(tableBody, rowData, false));

            if (!isClosedFlight) {
                const rowsToAdd = Math.max(6, tableBody.rows.length + 1) - tableBody.rows.length;
                for (let i = 0; i < rowsToAdd; i++) {
                    addNewRow(tableBody, null, i === rowsToAdd - 1);
                }
            }
        } finally {
            isApplyingFlightState = false;
        }

        updateBlocDepartAirportLabel();
        refreshBlocFuelAirportOaciCells();
        updateDisplayedLimitHdvForActiveFlight();
        refreshSharedHeaderMirrorValues();
        updateActiveFlightLockState();
        masterRecalculate();
        updateFlightDurationSummary();
    }

    function loadActiveFlightState() {
        ensureFlightsLoadedFromStorage();
        const activeFlight = dailyFlights.find(flight => flight.id === activeFlightId) || dailyFlights[dailyFlights.length - 1];
        activeFlightId = activeFlight.id;
        applyFlightStateToDom(activeFlight.state || createEmptyFlight(activeFlight.number).state);
        refreshFlightSelector();
    }

    function saveCalculatorState() {
        const state = readCalculatorStateFromDom();
        localStorage.setItem('calculator_state', JSON.stringify(state));
        updateActiveFlightStateFromDom();
    }

    function getPreviousBlocFuelArrivalTimeForWrapper(wrapper) {
        try {
            const row = wrapper?.closest?.('tr');
            const table = row?.closest?.('#bloc-fuel');
            if (!row || !table) return '';

            const rows = Array.from(table.querySelectorAll('tbody tr'));
            const rowIndex = rows.indexOf(row);
            for (let i = rowIndex - 1; i >= 0; i -= 1) {
                const previousValue = rows[i].querySelector('.time-input-wrapper .display-input')?.value || '';
                if (parseTime(previousValue) !== null) return previousValue;
            }

            const blocDepartValue = document.getElementById('bloc-depart')?.querySelector('.display-input')?.value || '';
            return parseTime(blocDepartValue) !== null ? blocDepartValue : '';
        } catch (_) {
            return '';
        }
    }

    function initializeTimeInput(wrapper, initialValue = '') {
        if (!wrapper) return;
        const displayInput = wrapper.querySelector('.display-input');
        const engineInput = wrapper.querySelector('.engine-input');
        const clearBtn = wrapper.querySelector('.clear-btn');
        const wrapperRole = wrapper.dataset.syncTarget || wrapper.id;

        const setTimeValue = (time) => {
            const safeTime = time || '';
            displayInput.value = safeTime;
            if (engineInput) {
                if (String(safeTime).match(/^\d{2}:\d{2}$/)) {
                    engineInput.value = safeTime;
                } else {
                    engineInput.value = '';
                }
            }
        };

        const recalculateAndSave = () => {
            if (wrapperRole === 'limite-hdv' && getActiveFlightIndex() <= 0) {
                /*
                 * v13.54 — LIMITE HDV journée figée par le vol n°1 :
                 * seul le premier vol peut modifier la limite de référence.
                 * Les vols suivants affichent le restant issu des vols précédents.
                 */
                setStoredGlobalLimitHdvLabel(displayInput.value);
            }

            syncSharedHeaderFromWrapper(wrapper);

            if (wrapperRole === 'bloc-depart') {
                if (parseTime(displayInput.value || '') === null) {
                    clearBlocDepartAirportOaci();
                } else {
                    lockBlocDepartAirportOaciIfNeeded();
                }
                updateBlocDepartAirportLabel();
            } else {
                const row = wrapper.closest('tr');
                if (row && row.closest('#bloc-fuel')) {
                    updateRowAirportOaci(row, { forceDetect: true });
                }
            }

            refreshSharedHeaderMirrorValues();
            masterRecalculate();
            saveCalculatorState();
        };

        const getAutoTimeValue = () => {
            if (wrapperRole === 'tmd') {
                return '21:30';
            }

            if (wrapperRole === 'limite-hdv') {
                return '08:00';
            }

            const now = new Date();
            return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        };

        const getClearTimeValue = () => {
            if (wrapperRole === 'tmd') {
                return '21:30';
            }

            if (wrapperRole === 'limite-hdv') {
                return '08:00';
            }

            return '';
        };

        setTimeValue(initialValue);

        /*
         * Saisie manuelle PC uniquement.
         * Important : ne rien changer au comportement iPad.
         */
        const isPcKeyboardDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches
            && navigator.maxTouchPoints === 0;

        if (isPcKeyboardDevice) {
            displayInput.readOnly = false;
            displayInput.removeAttribute('readonly');
            displayInput.inputMode = 'numeric';
            displayInput.placeholder = '--:--';
            displayInput.autocomplete = 'off';
            displayInput.maxLength = 5;

            const commitTypedTime = () => {
                const rawValue = String(displayInput.value || '').trim();

                if (rawValue === '') {
                    setTimeValue('');
                    recalculateAndSave();
                    return;
                }

                const compactValue = rawValue.replace(/\D/g, '');
                let hh = '';
                let mm = '';

                if (/^\d{3,4}$/.test(compactValue)) {
                    const padded = compactValue.padStart(4, '0');
                    hh = padded.slice(0, 2);
                    mm = padded.slice(2, 4);
                } else {
                    const match = /^(\d{1,2}):(\d{1,2})$/.exec(rawValue);
                    if (match) {
                        hh = match[1].padStart(2, '0');
                        mm = match[2].padStart(2, '0');
                    }
                }

                const hourNumber = Number(hh);
                const minuteNumber = Number(mm);

                if (!Number.isInteger(hourNumber) || !Number.isInteger(minuteNumber) || hourNumber < 0 || hourNumber > 23 || minuteNumber < 0 || minuteNumber > 59) {
                    setTimeValue('');
                    recalculateAndSave();
                    return;
                }

                setTimeValue(`${hh}:${mm}`);
                recalculateAndSave();
            };

            displayInput.addEventListener('focus', () => {
                displayInput.select();
            });

            displayInput.addEventListener('click', (event) => {
                event.stopPropagation();
                displayInput.focus();
            });

            displayInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commitTypedTime();
                    displayInput.blur();
                }

                if (event.key === 'Escape') {
                    event.preventDefault();
                    setTimeValue(engineInput && engineInput.value ? engineInput.value : displayInput.value);
                    displayInput.blur();
                }
            });

            displayInput.addEventListener('blur', () => {
                commitTypedTime();
            });
        }

        displayInput.addEventListener('dblclick', (e) => {
            e.preventDefault();
            let timeString;
            if (wrapperRole === 'tmd') {
                timeString = '21:30';
            } else if (wrapperRole === 'limite-hdv') {
                timeString = '08:00';
            } else {
                timeString = getAutoTimeValue();
            }
            setTimeValue(timeString);
            recalculateAndSave();
        });

        if (engineInput) {
            const prepareTimePickerDefault = () => {
                try {
                    const isBlocFuelArrival = !!wrapper.closest('tr')?.closest('#bloc-fuel');
                    if (isBlocFuelArrival && !displayInput.value) {
                        const previousTime = getPreviousBlocFuelArrivalTimeForWrapper(wrapper);
                        if (previousTime) engineInput.value = previousTime;
                        return;
                    }
                    if (!engineInput.value && !displayInput.value) {
                        engineInput.value = getAutoTimeValue();
                    }
                } catch (_) {}
            };

            ['pointerdown', 'touchstart', 'mousedown', 'focus'].forEach((eventName) => {
                engineInput.addEventListener(eventName, prepareTimePickerDefault, { passive: true });
            });

            engineInput.addEventListener('change', () => {
                if (engineInput.value) {
                    setTimeValue(engineInput.value);
                    recalculateAndSave();
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                setTimeValue(getClearTimeValue());
                recalculateAndSave();
            });
        }
    }

    function getFuelSplitModalElements() {
        return {
            modal: document.getElementById('fuel-split-modal'),
            leftInput: document.getElementById('fuel-split-left'),
            rightInput: document.getElementById('fuel-split-right'),
            totalInput: document.getElementById('fuel-split-total'),
            validateBtn: document.getElementById('fuel-split-validate-btn'),
            cancelBtn: document.getElementById('fuel-split-cancel-btn'),
            clearBtn: document.getElementById('fuel-split-clear-btn'),
            closeBtn: document.getElementById('fuel-split-close-btn')
        };
    }

    function cleanFuelDigits(value) {
        return String(value || '').replace(/[^0-9]/g, '');
    }

    function formatFuelKg(value) {
        const digits = cleanFuelDigits(value);
        return digits ? `${parseInt(digits, 10)} kg` : '';
    }

    function resetFuelSplitKeyboardOffset() {
        const { modal } = getFuelSplitModalElements();
        if (!modal) return;

        const content = modal.querySelector('.fuel-split-modal-content');

        document.body.classList.remove('fuel-keyboard-open');

        modal.style.alignItems = '';
        modal.style.justifyContent = '';
        modal.style.paddingTop = '';
        modal.style.paddingBottom = '';

        if (content) {
            content.style.position = '';
            content.style.left = '';
            content.style.top = '';
            content.style.bottom = '';
            content.style.transform = '';
            content.style.maxHeight = '';
            content.style.overflowY = '';
        }
    }

    function applyFuelSplitKeyboardOffset() {
        const { modal } = getFuelSplitModalElements();
        if (!modal || modal.style.display === 'none') return;

        const visualViewport = window.visualViewport;
        if (!visualViewport || !modal.contains(document.activeElement)) {
            resetFuelSplitKeyboardOffset();
            return;
        }

        const keyboardOffset = Math.max(
            0,
            Math.round(window.innerHeight - visualViewport.height - visualViewport.offsetTop)
        );

        if (keyboardOffset > 40) {
            /*
             * La fenêtre carburant est maintenant compacte par défaut.
             * On ne force plus de position fixe ni de gros décalage au clavier :
             * ces styles inline étaient responsables du décalage vers le haut/droite sur iPad.
             */
            document.body.classList.add('fuel-keyboard-open');
        } else {
            resetFuelSplitKeyboardOffset();
        }
    }
    function closeFuelSplitModal() {
        const { modal, leftInput, rightInput, totalInput } = getFuelSplitModalElements();

        try {
            [leftInput, rightInput, totalInput].forEach(input => {
                if (input && typeof input.blur === 'function') input.blur();
            });
        } catch (_) {}

        if (modal) {
            modal.style.setProperty('display', 'none', 'important');
            modal.classList.remove('active', 'open', 'show');
            modal.setAttribute('aria-hidden', 'true');
        }

        resetFuelSplitKeyboardOffset();
        activeFuelSplitInput = null;
    }

    function updateFuelSplitTotalFromTanks() {
        const { leftInput, rightInput, totalInput } = getFuelSplitModalElements();
        if (!leftInput || !rightInput || !totalInput) return;

        leftInput.value = cleanFuelDigits(leftInput.value);
        rightInput.value = cleanFuelDigits(rightInput.value);

        const left = leftInput.value ? parseInt(leftInput.value, 10) : 0;
        const right = rightInput.value ? parseInt(rightInput.value, 10) : 0;
        totalInput.value = (leftInput.value || rightInput.value) ? String(left + right) : '';
    }

    function setupFuelSplitModalOnce() {
        const { modal, leftInput, rightInput, totalInput, validateBtn, cancelBtn, clearBtn, closeBtn } = getFuelSplitModalElements();
        if (!modal || modal.dataset.bound === '1') return;
        modal.dataset.bound = '1';

        const modalContent = modal.querySelector('.rlt-mass-modal-content');
        if (modalContent && modalContent.dataset.rltStopBound !== '1') {
            modalContent.dataset.rltStopBound = '1';
            ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(type => {
                modalContent.addEventListener(type, (event) => {
                    /*
                     * v12.80 — boutons Retardant : ne pas bloquer les événements
                     * des boutons internes. Le stopPropagation global de la fenêtre
                     * interceptait parfois Plein au départ avant le handler du bouton
                     * sur iPad, ce qui donnait seulement un état visuel fugitif.
                     */
                    if (event.target?.closest?.('#rlt-first-full-btn, #rlt-mass-validate-btn, #rlt-mass-clear-btn, #rlt-mass-cancel-btn')) {
                        return;
                    }
                    event.stopPropagation();
                }, { capture: true });
            });
        }

        if (window.visualViewport && modal.dataset.keyboardOffsetBound !== '1') {
            modal.dataset.keyboardOffsetBound = '1';
            window.visualViewport.addEventListener('resize', applyFuelSplitKeyboardOffset);
            window.visualViewport.addEventListener('scroll', applyFuelSplitKeyboardOffset);
        }

        [leftInput, rightInput].forEach((input) => {
            if (!input) return;
            input.addEventListener('input', updateFuelSplitTotalFromTanks);
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    if (input === leftInput && rightInput) rightInput.focus();
                    else if (totalInput) totalInput.focus();
                }
            });
        });

        if (totalInput) {
            totalInput.addEventListener('input', () => {
                totalInput.value = cleanFuelDigits(totalInput.value);
            });
            totalInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    validateBtn?.click();
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeFuelSplitModal();
                }
            });
        }

        [leftInput, rightInput, totalInput].forEach((input) => {
            if (!input) return;
            input.addEventListener('focus', () => {
                setTimeout(applyFuelSplitKeyboardOffset, 0);
                setTimeout(applyFuelSplitKeyboardOffset, 250);
            });
            input.addEventListener('blur', () => {
                setTimeout(applyFuelSplitKeyboardOffset, 80);
            });
        });

        if (validateBtn) {
            validateBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                if (!activeFuelSplitInput) {
                    closeFuelSplitModal();
                    return;
                }

                const targetInput = activeFuelSplitInput;
                const total = cleanFuelDigits(totalInput?.value || '');
                targetInput.value = total ? `${parseInt(total, 10)} kg` : '';

                const targetWrapper = targetInput.closest('.input-wrapper');
                syncSharedHeaderFromWrapper(targetWrapper);
                refreshSharedHeaderMirrorValues();

                /*
                 * v12.30 — correction Bloc/Fuel multi-vols :
                 * on force le recalcul immédiat avant fermeture de la fenêtre carburant,
                 * puis on sauvegarde le vol actif. Cela évite les colonnes dérivées vides.
                 */
                try { recalculateBlocFuel(); } catch (_) {}
                masterRecalculate();
                saveCalculatorState();

                closeFuelSplitModal();
                setTimeout(closeFuelSplitModal, 80);
                setTimeout(closeFuelSplitModal, 250);
            }, { capture: true });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (leftInput) leftInput.value = '';
                if (rightInput) rightInput.value = '';
                if (totalInput) {
                    totalInput.value = '';
                    totalInput.focus();
                }
            });
        }

        if (cancelBtn) cancelBtn.addEventListener('click', closeFuelSplitModal);
        if (closeBtn) closeBtn.addEventListener('click', closeFuelSplitModal);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeFuelSplitModal();
        });
    }

    function openFuelSplitModal(displayInput) {
        const { modal, leftInput, rightInput, totalInput } = getFuelSplitModalElements();
        if (!modal || !totalInput) return;

        setupFuelSplitModalOnce();
        activeFuelSplitInput = displayInput;
        if (leftInput) leftInput.value = '';
        if (rightInput) rightInput.value = '';
        totalInput.value = cleanFuelDigits(displayInput?.value || '');
        resetFuelSplitKeyboardOffset();
        modal.style.removeProperty('display');
        modal.style.display = 'flex';
        modal.removeAttribute('aria-hidden');

        /*
         * Focus immédiat : indispensable sur iPad/iPhone pour ouvrir le clavier
         * quand la fenêtre est déclenchée par le bouton AUTO -> MANUEL.
         */
        totalInput.focus({ preventScroll: false });
        totalInput.select();
        applyFuelSplitKeyboardOffset();

        requestAnimationFrame(() => {
            totalInput.focus({ preventScroll: false });
            totalInput.select();
            applyFuelSplitKeyboardOffset();
        });

        setTimeout(() => {
            totalInput.focus({ preventScroll: false });
            totalInput.select();
            applyFuelSplitKeyboardOffset();
        }, 250);
    }

    function initializeNumericInput(wrapper, initialValue = '') {
        if (!wrapper) return;
        const displayInput = wrapper.querySelector('.display-input');
        const clearBtn = wrapper.querySelector('.clear-btn');
        const unit = wrapper.dataset.unit || '';
        let shouldClearOnNextInput = false;
        displayInput.value = initialValue;

        if (wrapper.classList.contains('fuel-split-input-wrapper')) {
            setupFuelSplitModalOnce();
            displayInput.readOnly = true;
            displayInput.setAttribute('readonly', 'readonly');
            displayInput.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openFuelSplitModal(displayInput);
            });
            wrapper.addEventListener('click', (event) => {
                if (event.target === clearBtn) return;
                openFuelSplitModal(displayInput);
            });
            if (clearBtn) {
                clearBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    displayInput.value = '';
                    syncSharedHeaderFromWrapper(wrapper);
                    refreshSharedHeaderMirrorValues();
                    masterRecalculate();
                    saveCalculatorState();
                });
            }
            return;
        }

        displayInput.addEventListener('focus', () => { if (displayInput.readOnly) return; if (displayInput.value) { shouldClearOnNextInput = true; } displayInput.value = displayInput.value.replace(/[^0-9]/g, ''); });
        displayInput.addEventListener('blur', () => { if (displayInput.readOnly) return; shouldClearOnNextInput = false; let v = displayInput.value.replace(/[^0-9]/g, ''); if (v) { displayInput.value = `${v} ${unit}`; } else { displayInput.value = ''; } masterRecalculate(); saveCalculatorState(); });
        displayInput.addEventListener('input', (e) => { if (displayInput.readOnly) return; if (shouldClearOnNextInput && e.data) { displayInput.value = e.data.replace(/[^0-9]/g, ''); shouldClearOnNextInput = false; } else { displayInput.value = displayInput.value.replace(/[^0-9]/g, ''); } masterRecalculate(); });
        displayInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); displayInput.blur(); } });
        if (clearBtn) {
            if (wrapper.id === 'rlt-depart') {
                /*
                 * v13.90 — cellule RLT de l'en-tête BLOC / FUEL.
                 * Sur iPad, le premier appui sur × donnait auparavant le focus au champ :
                 * le gestionnaire focus retirait seulement le suffixe « kg », puis un second
                 * appui était nécessaire pour vider la valeur. L'effacement est désormais
                 * exécuté dès pointerdown, avant toute prise de focus du champ.
                 */
                if (clearBtn.dataset.rltDirectClearBound !== '1') {
                    clearBtn.dataset.rltDirectClearBound = '1';

                    const clearRltDepartImmediately = (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        shouldClearOnNextInput = false;
                        displayInput.value = '';
                        if (document.activeElement === displayInput) displayInput.blur();
                        masterRecalculate();
                        saveCalculatorState();
                    };

                    if (window.PointerEvent) {
                        clearBtn.addEventListener('pointerdown', clearRltDepartImmediately);
                    } else {
                        clearBtn.addEventListener('touchstart', clearRltDepartImmediately, { passive: false });
                        clearBtn.addEventListener('mousedown', clearRltDepartImmediately);
                    }

                    clearBtn.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (displayInput.value) clearRltDepartImmediately(event);
                    });
                }
            } else {
                clearBtn.addEventListener('click', () => {
                    displayInput.value = '';
                    masterRecalculate();
                    saveCalculatorState();
                });
            }
        }
    }


    function parseDecimalInput(value) {
        if (value === null || value === undefined) return null;
        const normalized = String(value).trim().replace(',', '.').replace(/[^0-9.]/g, '');
        if (!normalized) return null;
        const number = Number(normalized);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeRltDensityInput(value) {
        const raw = String(value || '').replace(',', '.').replace(/[^0-9.]/g, '');

        /*
         * v12.42 — densité retardant :
         * l'usage attendu est toujours 1.06 à 1.10.
         * On garde donc le préfixe visuel "1." et l'utilisateur ne saisit
         * que la partie décimale si besoin.
         */
        const digits = raw.replace(/\D/g, '');

        if (!digits) return '1.';

        let decimals = '';
        if (digits.startsWith('1')) {
            decimals = digits.slice(1);
        } else {
            decimals = digits;
        }

        decimals = decimals.slice(0, 3);
        return `1.${decimals}`;
    }

    function parseRltDensityInput(value) {
        const rawString = String(value || '').trim().replace(',', '.');
        const normalized = rawString.replace(/[^0-9.]/g, '');
        if (normalized === '1.' || normalized === '1' || normalized === '') return null;

        let density = Number(normalized);

        /*
         * v12.75 — sécurité densité retardant.
         * La densité attendue est autour de 1,06 à 1,10. Sur iPad, selon
         * le clavier et les anciennes valeurs, une saisie visuelle "1.1" peut
         * parfois être relue comme 0.11. Dans ce cas opérationnel impossible,
         * on reconstruit la densité à partir des chiffres saisis.
         */
        const digits = normalized.replace(/\D/g, '');
        if (Number.isFinite(density) && density > 0 && density < 0.5 && digits.startsWith('1') && digits.length >= 2) {
            const decimals = digits.slice(1, 4);
            density = Number(`1.${decimals}`);
        }

        if (!Number.isFinite(density) || density <= 0) return null;
        return density;
    }

    function markRltCalculatedField(fieldName) {
        const elements = getRltMassModalElements();
        [
            elements.massToVolumeVolumeInput,
            elements.massInput
        ].filter(Boolean).forEach(input => {
            input.classList.remove('rlt-calculated-field');
        });

        if (fieldName === 'volumeFromMass') elements.massToVolumeVolumeInput?.classList.add('rlt-calculated-field');
        if (fieldName === 'massFromVolume') elements.massInput?.classList.add('rlt-calculated-field');
    }

    function formatDecimalValue(value, decimals = 2) {
        if (!Number.isFinite(value)) return '';
        /*
         * v12.77 — correction Masse RLT :
         * ne jamais supprimer les zéros significatifs sur les valeurs entières.
         * L'ancien nettoyage transformait par exemple 8500 en 85.
         */
        if (decimals === 0) return String(Math.round(value));
        return value.toFixed(decimals).replace(/\.?0+$/, '').replace('.', ',');
    }

    function formatKgValue(value) {
        if (!Number.isFinite(value)) return '';
        return `${Math.round(value)} kg`;
    }

    function parseRltRefractoInput(value) {
        const normalized = String(value || '').trim().replace(',', '.').replace(/[^0-9.]/g, '');
        if (!normalized) return null;
        let number = Number(normalized);
        if (!Number.isFinite(number)) return null;
        /* Tolérance iPad : 145 peut représenter 14,5. */
        if (number > 30 && number <= 300) number = number / 10;
        return Number.isFinite(number) ? number : null;
    }

    function getRltDensityFromRefracto(value) {
        const refracto = parseRltRefractoInput(value);
        if (refracto === null) return null;
        if (refracto >= 11.5 && refracto <= 13.9) return 1.04;
        if (refracto >= 14 && refracto <= 17.4) return 1.08;
        if (refracto >= 17.5 && refracto <= 20.4) return 1.10;
        if (refracto >= 20.5 && refracto <= 23.9) return 1.12;
        if (refracto >= 24 && refracto <= 26.9) return 1.14;
        if (refracto >= 27 && refracto <= 30) return 1.16;
        return null;
    }

    function formatRltDensityForInput(value) {
        if (!Number.isFinite(value)) return '';
        return value.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
    }

    function normalizeRltRefractoInputValue(value) {
        return String(value || '').replace(',', '.').replace(/[^0-9.]/g, '');
    }

    function updateRltRefractoDensityOutput({ applyToDensityInputs = false } = {}) {
        const {
            refractoInput,
            refractoDensityOutput,
            massToVolumeDensityInput,
            densityInput
        } = getRltMassModalElements();

        if (!refractoInput) return null;
        const density = getRltDensityFromRefracto(refractoInput.value);
        const densityLabel = density !== null ? formatRltDensityForInput(density) : '';

        if (refractoDensityOutput) {
            refractoDensityOutput.value = densityLabel;
            refractoDensityOutput.classList.toggle('rlt-calculated-field', !!densityLabel);
        }

        if (applyToDensityInputs && densityLabel) {
            if (massToVolumeDensityInput) massToVolumeDensityInput.value = densityLabel;
            if (densityInput) densityInput.value = densityLabel;
        }

        return density;
    }

    function getRltMassModalElements() {
        return {
            modal: document.getElementById('rlt-mass-modal'),
            massToVolumeMassInput: document.getElementById('rlt-mass-to-volume-mass-input'),
            massToVolumeDensityInput: document.getElementById('rlt-mass-to-volume-density-input'),
            massToVolumeVolumeInput: document.getElementById('rlt-mass-to-volume-volume-input'),
            refractoInput: document.getElementById('rlt-refracto-input'),
            refractoDensityOutput: document.getElementById('rlt-refracto-density-output'),
            volumeInput: document.getElementById('rlt-volume-input'),
            densityInput: document.getElementById('rlt-density-input'),
            massInput: document.getElementById('rlt-mass-input'),
            validateBtn: document.getElementById('rlt-mass-validate-btn'),
            clearBtn: document.getElementById('rlt-mass-clear-btn'),
            cancelBtn: document.getElementById('rlt-mass-cancel-btn'),
            closeBtn: document.getElementById('rlt-mass-close-btn'),
            firstFullBtn: document.getElementById('rlt-first-full-btn')
        };
    }

    function closeRltMassModal() {
        const elements = getRltMassModalElements();
        const { modal } = elements;
        try {
            [
                elements.massToVolumeMassInput,
                elements.massToVolumeDensityInput,
                elements.massToVolumeVolumeInput,
                elements.refractoInput,
                elements.refractoDensityOutput,
                elements.volumeInput,
                elements.densityInput,
                elements.massInput
            ].forEach(input => input && input.blur && input.blur());
        } catch (_) {}
        if (modal) {
            modal.style.setProperty('display', 'none', 'important');
            modal.setAttribute('aria-hidden', 'true');
        }
        activeRltMassWrapper = null;
        activeRltMassLastEdited = null;
        activeRltMassCalculationMode = null;
        activeRltFirstFull = false;
        markRltCalculatedField(null);
    }

    function ensureRltDensityDefaults() {
        const { massToVolumeDensityInput, densityInput } = getRltMassModalElements();
        [massToVolumeDensityInput, densityInput].filter(Boolean).forEach(input => {
            if (!input.value || input.value === '1') input.value = '1.';
        });
    }

    function isFirstBlocFuelRltRow(wrapper) {
        const row = wrapper?.closest?.('#bloc-fuel tbody tr');
        if (!row || !row.parentElement) return false;
        const rows = Array.from(row.parentElement.querySelectorAll('tr'));
        return rows.indexOf(row) === 0;
    }

    function setRltFirstFullActive(active, persistPending = true) {
        const canUseFirstFull = isFirstBlocFuelRltRow(activeRltMassWrapper);
        activeRltFirstFull = !!active && canUseFirstFull;

        /*
         * v12.85 — Plein au départ : interrupteur volontaire protégé.
         * Le bouton peut être activé/désactivé volontairement. Sur iPad, la même action
         * peut produire touchstart + pointerdown + click ; chaque événement doit
         * conduire au même état actif, jamais à une désactivation involontaire.
         */
        if (persistPending && activeRltMassWrapper) {
            if (activeRltFirstFull) {
                activeRltMassWrapper.dataset.rltFirstFullPending = '1';
                activeRltMassWrapper.dataset.rltFirstFullWanted = '1';
            } else {
                activeRltMassWrapper.dataset.rltFirstFullPending = '';
                activeRltMassWrapper.dataset.rltFirstFullWanted = '';
                activeRltMassWrapper.dataset.rltFirstFull = '';
                if (activeRltMassWrapper.dataset.rltMode === 'firstFull') {
                    activeRltMassWrapper.dataset.rltMode = '';
                }
            }

            const pendingRow = activeRltMassWrapper.closest('tr');
            if (pendingRow) {
                pendingRow.classList.toggle('bloc-fuel-first-full-row-pending', activeRltFirstFull);
                if (!activeRltFirstFull) {
                    pendingRow.classList.remove('bloc-fuel-first-full-row');
                }
            }
            try { saveCalculatorState(); } catch (_) {}
        }

        const { firstFullBtn } = getRltMassModalElements();
        if (firstFullBtn) {
            firstFullBtn.classList.toggle('active', activeRltFirstFull);
            firstFullBtn.setAttribute('aria-pressed', activeRltFirstFull ? 'true' : 'false');
        }
    }

    function toggleRltFirstFullActive() {
        const canUseFirstFull = isFirstBlocFuelRltRow(activeRltMassWrapper);
        const nextActive = canUseFirstFull ? !(activeRltFirstFull === true) : false;

        setRltFirstFullActive(nextActive, true);
        syncRltMassModalFromInputs();

        if (nextActive) {
            applyRltFirstFullIfPossible();
        } else {
            const row = activeRltMassWrapper?.closest?.('tr');
            if (row) {
                row.classList.remove('bloc-fuel-first-full-row');
                row.classList.remove('bloc-fuel-first-full-row-pending');
            }
            try { masterRecalculate(); } catch (_) {}
            try { saveCalculatorState(); } catch (_) {}
        }
    }

    function applyRltFirstFullIfPossible() {
        if (!activeRltMassWrapper || !isFirstBlocFuelRltRow(activeRltMassWrapper) || !activeRltFirstFull) return false;

        const {
            massToVolumeMassInput,
            massToVolumeDensityInput,
            massToVolumeVolumeInput,
            volumeInput,
            densityInput,
            massInput
        } = getRltMassModalElements();

        const topMass = parseDecimalInput(massToVolumeMassInput?.value);
        const topDensity = parseRltDensityInput(massToVolumeDensityInput?.value);
        const bottomVolume = parseDecimalInput(volumeInput?.value);
        const bottomDensity = parseRltDensityInput(densityInput?.value);
        const existingBottomMass = parseDecimalInput(massInput?.value);

        const topComputedVolume = (topMass !== null && topDensity !== null) ? (topMass / topDensity) : null;
        const bottomComplete = bottomVolume !== null && bottomDensity !== null;
        const bottomComputedMass = bottomComplete
            ? (existingBottomMass !== null ? existingBottomMass : (bottomVolume * bottomDensity))
            : null;

        /*
         * v12.83 — Plein au départ : ne plus dépendre uniquement de la
         * ligne 1 « Masse ÷ Densité ». Si l'utilisateur travaille avec la
         * ligne 2 « Volume × Densité = Masse » (ex. 8500 × 1,1), le bouton
         * doit aussi appliquer le mode Plein au départ avec cette masse.
         */
        const selectedMass = bottomComputedMass !== null ? bottomComputedMass : topMass;
        const selectedVolume = bottomComputedMass !== null ? bottomVolume : topComputedVolume;
        const selectedDensity = bottomComputedMass !== null ? bottomDensity : topDensity;
        if (selectedMass === null) return false;

        if (massToVolumeVolumeInput && topComputedVolume !== null) {
            massToVolumeVolumeInput.value = formatDecimalValue(topComputedVolume, 0);
        }
        if (massInput && bottomComputedMass !== null) {
            massInput.value = formatDecimalValue(bottomComputedMass, 0);
        }

        activeRltMassWrapper.dataset.topMass = topMass !== null ? String(Math.round(topMass)) : '';
        activeRltMassWrapper.dataset.topDensity = topDensity !== null ? formatDecimalValue(topDensity, 3) : '';
        activeRltMassWrapper.dataset.topVolume = topComputedVolume !== null ? formatDecimalValue(topComputedVolume, 0) : '';
        activeRltMassWrapper.dataset.bottomVolume = bottomVolume !== null ? formatDecimalValue(bottomVolume, 0) : '';
        activeRltMassWrapper.dataset.bottomDensity = bottomDensity !== null ? formatDecimalValue(bottomDensity, 3) : '';
        activeRltMassWrapper.dataset.bottomMass = bottomComputedMass !== null ? String(Math.round(bottomComputedMass)) : '';
        activeRltMassWrapper.dataset.refracto = normalizeRltRefractoInputValue(getRltMassModalElements().refractoInput?.value || '');
        activeRltMassWrapper.dataset.volume = selectedVolume !== null ? formatDecimalValue(selectedVolume, 0) : '';
        activeRltMassWrapper.dataset.density = selectedDensity !== null ? formatDecimalValue(selectedDensity, 3) : '';
        activeRltMassWrapper.dataset.mass = String(Math.round(selectedMass));
        activeRltMassWrapper.dataset.rltMode = 'firstFull';
        activeRltMassWrapper.dataset.rltFirstFull = '1';
        activeRltMassWrapper.dataset.rltFirstFullPending = '1';
        activeRltMassWrapper.dataset.rltFirstFullWanted = '1';

        const displayInput = activeRltMassWrapper.querySelector('.display-input');
        if (displayInput) displayInput.value = formatKgValue(selectedMass);

        const row = activeRltMassWrapper.closest('tr');
        if (row) {
            row.classList.add('bloc-fuel-first-full-row');
            row.classList.add('bloc-fuel-first-full-row-pending');
            /* v12.84 — ne plus vider Fuel ni OACI en mode Plein au départ. */
            try { updateRowAirportOaci(row); } catch (_) {}
        }

        try { masterRecalculate(); } catch (_) {}
        try { saveCalculatorState(); } catch (_) {}
        return true;
    }

    function syncRltMassModalFromInputs() {
        const {
            massToVolumeMassInput,
            massToVolumeDensityInput,
            massToVolumeVolumeInput,
            refractoInput,
            refractoDensityOutput,
            volumeInput,
            densityInput,
            massInput,
            firstFullBtn
        } = getRltMassModalElements();

        ensureRltDensityDefaults();
        updateRltRefractoDensityOutput({ applyToDensityInputs: false });
        markRltCalculatedField(null);

        const topMass = parseDecimalInput(massToVolumeMassInput?.value);
        const topDensity = parseRltDensityInput(massToVolumeDensityInput?.value);
        const bottomVolume = parseDecimalInput(volumeInput?.value);
        const bottomDensity = parseRltDensityInput(densityInput?.value);
        const topComputedVolume = (topMass !== null && topDensity !== null) ? (topMass / topDensity) : null;

        if (massToVolumeVolumeInput) {
            if (topComputedVolume !== null) {
                massToVolumeVolumeInput.value = formatDecimalValue(topComputedVolume, 0);
                markRltCalculatedField('volumeFromMass');
            } else {
                massToVolumeVolumeInput.value = '';
            }
        }

        /*
         * v12.71 — les deux lignes sont indépendantes.
         * Ligne 1 : Masse ÷ Densité = Volume. Elle calcule uniquement son volume.
         * Ligne 2 : Volume × Densité = Masse. Elle calcule uniquement sa masse.
         * La ligne 1 ne remplit plus la ligne 2 et inversement.
         */
        if (massInput) {
            if (bottomVolume !== null && bottomDensity !== null) {
                massInput.value = formatDecimalValue(bottomVolume * bottomDensity, 0);
                markRltCalculatedField('massFromVolume');
            } else {
                massInput.value = '';
            }
        }

        if (firstFullBtn) {
            /*
             * v12.75 — le bouton Plein au départ dépend de la ligne du tableau
             * BLOC/FUEL ouverte, pas de la première ligne de calcul de la
             * fenêtre. Il n'est disponible que sur la première ligne du tableau.
             */
            const canUseFirstFull = isFirstBlocFuelRltRow(activeRltMassWrapper);
            firstFullBtn.hidden = !canUseFirstFull;
            firstFullBtn.style.display = canUseFirstFull ? 'flex' : 'none';
            if (!canUseFirstFull) activeRltFirstFull = false;
            firstFullBtn.classList.toggle('active', !!activeRltFirstFull && canUseFirstFull);
            firstFullBtn.setAttribute('aria-pressed', (!!activeRltFirstFull && canUseFirstFull) ? 'true' : 'false');
        }
    }

    function setupRltMassModalOnce() {
        const elements = getRltMassModalElements();
        const {
            modal,
            massToVolumeMassInput,
            massToVolumeDensityInput,
            massToVolumeVolumeInput,
            refractoInput,
            refractoDensityOutput,
            volumeInput,
            densityInput,
            massInput,
            validateBtn,
            clearBtn,
            cancelBtn,
            closeBtn,
            firstFullBtn
        } = elements;
        if (!modal || modal.dataset.bound === '1') return;
        modal.dataset.bound = '1';

        const modalContent = modal.querySelector('.rlt-mass-modal-content');
        if (modalContent && modalContent.dataset.rltStopBound !== '1') {
            modalContent.dataset.rltStopBound = '1';
            ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(type => {
                modalContent.addEventListener(type, (event) => {
                    /*
                     * v12.80 — boutons Retardant : ne pas bloquer les événements
                     * des boutons internes. Le stopPropagation global de la fenêtre
                     * interceptait parfois Plein au départ avant le handler du bouton
                     * sur iPad, ce qui donnait seulement un état visuel fugitif.
                     */
                    if (event.target?.closest?.('#rlt-first-full-btn, #rlt-mass-validate-btn, #rlt-mass-clear-btn, #rlt-mass-cancel-btn')) {
                        return;
                    }
                    event.stopPropagation();
                }, { capture: true });
            });
        }

        [massToVolumeVolumeInput, refractoDensityOutput, massInput].filter(Boolean).forEach(input => {
            input.readOnly = true;
            input.setAttribute('readonly', 'readonly');
            input.setAttribute('aria-readonly', 'true');
            input.addEventListener('focus', () => input.blur());
        });

        const bindInput = (input, field, mode) => {
            if (!input) return;
            input.addEventListener('focus', () => {
                /*
                 * v12.60 — iPad : quand le clavier apparaît, la fenêtre
                 * Masse RLT doit remonter comme lorsqu'une cellule déjà
                 * renseignée est ouverte. On force un recentrage visuel
                 * de la boîte au focus de chaque champ éditable.
                 */
                setTimeout(() => {
                    try {
                        const content = input.closest('.rlt-mass-modal-content');
                        if (content && typeof content.scrollIntoView === 'function') {
                            content.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
                        }
                    } catch (_) {}
                }, 160);
            });
            input.addEventListener('input', () => {
                if (field === 'density') {
                    input.value = normalizeRltDensityInput(input.value);
                    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
                } else if (field === 'volume' || field === 'mass') {
                    input.value = String(input.value || '').replace(/[^0-9]/g, '');
                }
                activeRltMassLastEdited = field;
                activeRltMassCalculationMode = mode;
                syncRltMassModalFromInputs();
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    validateBtn?.click();
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeRltMassModal();
                }
            });
        };

        bindInput(massToVolumeMassInput, 'mass', 'massToVolume');
        bindInput(massToVolumeDensityInput, 'density', 'massToVolume');
        bindInput(volumeInput, 'volume', 'volumeToMass');
        bindInput(densityInput, 'density', 'volumeToMass');

        if (refractoInput && refractoInput.dataset.rltRefractoBound !== '1') {
            refractoInput.dataset.rltRefractoBound = '1';
            refractoInput.addEventListener('focus', () => {
                setTimeout(() => {
                    try {
                        const content = refractoInput.closest('.rlt-mass-modal-content');
                        if (content && typeof content.scrollIntoView === 'function') {
                            content.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
                        }
                    } catch (_) {}
                }, 160);
            });
            refractoInput.addEventListener('input', () => {
                refractoInput.value = normalizeRltRefractoInputValue(refractoInput.value);
                try { refractoInput.setSelectionRange(refractoInput.value.length, refractoInput.value.length); } catch (_) {}
                const density = updateRltRefractoDensityOutput({ applyToDensityInputs: true });
                if (density !== null) {
                    activeRltMassLastEdited = 'density';
                    activeRltMassCalculationMode = 'refractoToDensity';
                }
                syncRltMassModalFromInputs();
            });
            refractoInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    volumeInput?.focus?.({ preventScroll: false });
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeRltMassModal();
                }
            });
        }

        if (firstFullBtn && firstFullBtn.dataset.rltFirstFullBound !== '1') {
            firstFullBtn.dataset.rltFirstFullBound = '1';
            ['touchstart', 'pointerdown', 'mousedown', 'click'].forEach(type => {
                firstFullBtn.addEventListener(type, handleRltFirstFullButtonEvent, { capture: true, passive: false });
            });
        }

        const stopRltButtonEvent = (event) => {
            if (!event) return;
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
        };

        const runRltButtonActionOnce = (action, actionKey = 'rlt') => {
            const now = Date.now();
            const lastRun = Number(modal?.dataset.rltLastButtonActionAt || '0');
            const lastKey = modal?.dataset.rltLastButtonActionKey || '';
            const dedupeDelayMs = 320;
            if (lastKey === actionKey && now - lastRun < dedupeDelayMs) return;
            if (modal) {
                modal.dataset.rltLastButtonActionAt = String(now);
                modal.dataset.rltLastButtonActionKey = actionKey;
            }
            action();
        };

        function handleRltFirstFullButtonEvent(event) {
            /*
             * v12.88 — Plein au départ : gestion tactile déterministe.
             * Le bouton est volontairement traité sur le premier événement tactile
             * réel, puis les événements souris/click synthétiques du même appui sont
             * ignorés. Un second appui tactile reste possible pour désélectionner.
             */
            const now = Date.now();
            const type = event?.type || '';
            const pointerType = String(event?.pointerType || '').toLowerCase();
            const isTouchLike = type === 'touchstart' || (type === 'pointerdown' && pointerType === 'touch');
            const isMouseSyntheticCandidate = type === 'mousedown' || type === 'click' || (type === 'pointerdown' && pointerType === 'mouse');

            stopRltButtonEvent(event);

            if (isTouchLike) {
                const lastTouchAt = Number(modal?.dataset.rltFirstFullLastTouchAt || '0');
                if (now - lastTouchAt < 250) return;
                if (modal) {
                    modal.dataset.rltFirstFullLastTouchAt = String(now);
                    modal.dataset.rltFirstFullIgnoreMouseUntil = String(now + 5000);
                }
                runRltButtonActionOnce(() => {
                    toggleRltFirstFullActive();
                }, 'rlt-firstfull-touch');
                return;
            }

            if (isMouseSyntheticCandidate) {
                const ignoreMouseUntil = Number(modal?.dataset.rltFirstFullIgnoreMouseUntil || '0');
                if (now < ignoreMouseUntil) return;
                if (type !== 'click') return;
                runRltButtonActionOnce(() => {
                    toggleRltFirstFullActive();
                }, 'rlt-firstfull-click');
            }
        }

        const validateRltModalFields = () => {
            if (!activeRltMassWrapper) {
                closeRltMassModal();
                return;
            }

            syncRltMassModalFromInputs();

            const topMass = parseDecimalInput(massToVolumeMassInput?.value);
            const topDensity = parseRltDensityInput(massToVolumeDensityInput?.value);
            const topVolume = parseDecimalInput(massToVolumeVolumeInput?.value);
            const refractoValue = normalizeRltRefractoInputValue(refractoInput?.value || '');
            const bottomVolume = parseDecimalInput(volumeInput?.value);
            const bottomDensity = parseRltDensityInput(densityInput?.value);
            const bottomMass = parseDecimalInput(massInput?.value);

            const topComplete = topMass !== null && topDensity !== null;
            const bottomComplete = bottomVolume !== null && bottomDensity !== null;

            const topComputedVolume = topComplete
                ? (topVolume !== null ? topVolume : (topMass / topDensity))
                : null;
            const bottomComputedMass = bottomComplete
                ? (bottomMass !== null ? bottomMass : (bottomVolume * bottomDensity))
                : null;

            let volume = null;
            let density = null;
            let mass = null;
            let selectedMode = '';

            /*
             * v12.83 — Plein au départ : l'appui sur le bouton doit primer sur
             * le choix de ligne de calcul. Avant, si la ligne 2 était remplie
             * (Volume × Densité = Masse), le bloc `bottomComplete` passait avant
             * `firstFull` et réécrivait l'état en `volumeToMass`, ce qui
             * désactivait le bouton à la réouverture. Désormais, dès que le
             * bouton est actif et qu'une masse existe, le mode validé reste
             * `firstFull`.
             */
            const firstFullMass = bottomComputedMass !== null ? bottomComputedMass : topMass;
            const firstFullVolume = bottomComputedMass !== null ? bottomVolume : topComputedVolume;
            const firstFullDensity = bottomComputedMass !== null ? bottomDensity : topDensity;
            const isFirstFull = !!activeRltFirstFull && isFirstBlocFuelRltRow(activeRltMassWrapper) && firstFullMass !== null;

            if (isFirstFull) {
                volume = firstFullVolume;
                density = firstFullDensity;
                mass = firstFullMass;
                selectedMode = 'firstFull';
            } else if (bottomComplete) {
                volume = bottomVolume;
                density = bottomDensity;
                mass = bottomComputedMass;
                selectedMode = 'volumeToMass';
            } else if (topComplete) {
                volume = topComputedVolume;
                density = topDensity;
                mass = topMass;
                selectedMode = 'massToVolume';
            }

            activeRltMassWrapper.dataset.topMass = topMass !== null ? String(Math.round(topMass)) : '';
            activeRltMassWrapper.dataset.topDensity = topDensity !== null ? formatDecimalValue(topDensity, 3) : '';
            activeRltMassWrapper.dataset.topVolume = topComputedVolume !== null ? formatDecimalValue(topComputedVolume, 0) : '';
            activeRltMassWrapper.dataset.bottomVolume = bottomVolume !== null ? formatDecimalValue(bottomVolume, 0) : '';
            activeRltMassWrapper.dataset.bottomDensity = bottomDensity !== null ? formatDecimalValue(bottomDensity, 3) : '';
            activeRltMassWrapper.dataset.bottomMass = bottomMass !== null ? String(Math.round(bottomMass)) : '';
            activeRltMassWrapper.dataset.refracto = refractoValue;
            activeRltMassWrapper.dataset.rltMode = selectedMode;
            activeRltMassWrapper.dataset.rltFirstFull = selectedMode === 'firstFull' ? '1' : '';
            activeRltMassWrapper.dataset.rltFirstFullPending = selectedMode === 'firstFull' ? '1' : '';
            activeRltMassWrapper.dataset.rltFirstFullWanted = selectedMode === 'firstFull' ? '1' : '';

            const activeRltRow = activeRltMassWrapper.closest('tr');
            if (activeRltRow) {
                activeRltRow.classList.toggle('bloc-fuel-first-full-row', selectedMode === 'firstFull');
                activeRltRow.classList.toggle('bloc-fuel-first-full-row-pending', selectedMode === 'firstFull');
                if (selectedMode === 'firstFull') {
                    /* v12.84 — Plein au départ ne vide plus Fuel ni OACI. */
                    try { updateRowAirportOaci(activeRltRow); } catch (_) {}
                }
            }

            activeRltMassWrapper.dataset.volume = volume !== null ? formatDecimalValue(volume, 0) : '';
            activeRltMassWrapper.dataset.density = density !== null ? formatDecimalValue(density, 3) : '';
            activeRltMassWrapper.dataset.mass = mass !== null ? String(Math.round(mass)) : '';

            const displayInput = activeRltMassWrapper.querySelector('.display-input');
            if (displayInput) displayInput.value = mass !== null ? formatKgValue(mass) : '';

            masterRecalculate();
            saveCalculatorState();
            closeRltMassModal();
        };

        const clearRltModalFields = () => {
            if (massToVolumeMassInput) massToVolumeMassInput.value = '';
            if (massToVolumeDensityInput) massToVolumeDensityInput.value = '1.';
            if (massToVolumeVolumeInput) massToVolumeVolumeInput.value = '';
            if (refractoInput) refractoInput.value = '';
            if (refractoDensityOutput) refractoDensityOutput.value = '';
            if (volumeInput) volumeInput.value = '';
            if (densityInput) densityInput.value = '1.';
            if (massInput) massInput.value = '';
            activeRltMassLastEdited = null;
            activeRltMassCalculationMode = null;
            activeRltFirstFull = false;
            markRltCalculatedField(null);
            ensureRltDensityDefaults();

            /*
             * v12.72 — Effacer ne ferme ni le clavier ni la fenêtre.
             * On refocalise un champ éditable après le nettoyage pour empêcher
             * Safari/iPad de transformer le premier appui en simple fermeture clavier.
             */
            try {
                const current = document.activeElement && modal?.contains(document.activeElement)
                    && document.activeElement.tagName === 'INPUT'
                    && !document.activeElement.readOnly
                    ? document.activeElement
                    : null;
                const refocusInput = current || volumeInput || massToVolumeMassInput;
                requestAnimationFrame(() => refocusInput?.focus?.({ preventScroll: false }));
                setTimeout(() => refocusInput?.focus?.({ preventScroll: false }), 80);
                setTimeout(() => refocusInput?.focus?.({ preventScroll: false }), 220);
            } catch (_) {}
        };

        const bindRltActionButton = (button, action) => {
            if (!button || button.dataset.rltActionBound === '1') return;
            button.dataset.rltActionBound = '1';
            const handler = (event) => {
                stopRltButtonEvent(event);
                runRltButtonActionOnce(action, button.id || 'rlt-action');
            };
            ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(type => {
                button.addEventListener(type, handler, { capture: true, passive: false });
            });
        };


        const getRltActionPoint = (event) => {
            const source = event?.touches?.[0] || event?.changedTouches?.[0] || event;
            if (!source || typeof source.clientX !== 'number' || typeof source.clientY !== 'number') return null;
            return { x: source.clientX, y: source.clientY };
        };

        const buttonContainsPoint = (button, point) => {
            if (!button || !point) return false;
            const rect = button.getBoundingClientRect();
            const margin = 12;
            return point.x >= rect.left - margin
                && point.x <= rect.right + margin
                && point.y >= rect.top - margin
                && point.y <= rect.bottom + margin;
        };

        const bindRltGlobalButtonCapture = () => {
            if (!modal || modal.dataset.rltGlobalButtonCaptureBound === '1') return;
            modal.dataset.rltGlobalButtonCaptureBound = '1';

            const captureHandler = (event) => {
                try {
                    if (modal.getAttribute('aria-hidden') === 'true' || modal.style.display === 'none') return;
                    const point = getRltActionPoint(event);
                    if (!point) return;

                    if (buttonContainsPoint(validateBtn, point)) {
                        stopRltButtonEvent(event);
                        runRltButtonActionOnce(validateRltModalFields, 'rlt-validate-global');
                        return;
                    }
                    if (buttonContainsPoint(clearBtn, point)) {
                        stopRltButtonEvent(event);
                        runRltButtonActionOnce(clearRltModalFields, 'rlt-clear-global');
                        return;
                    }
                    if (buttonContainsPoint(firstFullBtn, point)) {
                        handleRltFirstFullButtonEvent(event);
                        return;
                    }
                    if (buttonContainsPoint(cancelBtn, point) || buttonContainsPoint(closeBtn, point)) {
                        stopRltButtonEvent(event);
                        runRltButtonActionOnce(closeRltMassModal, 'rlt-close-global');
                    }
                } catch (_) {}
            };

            ['touchstart', 'pointerdown', 'mousedown'].forEach(type => {
                document.addEventListener(type, captureHandler, { capture: true, passive: false });
            });
        };

        bindRltGlobalButtonCapture();

        bindRltActionButton(validateBtn, validateRltModalFields);
        bindRltActionButton(clearBtn, clearRltModalFields);

        const bindRltModalCloseButton = (button) => {
            if (!button || button.dataset.rltCloseBound === '1') return;
            button.dataset.rltCloseBound = '1';
            const handler = (event) => {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                closeRltMassModal();
            };
            ['pointerdown', 'touchstart', 'mousedown'].forEach(type => {
                button.addEventListener(type, handler, { capture: true });
            });
            button.addEventListener('click', handler, { capture: true });
        };

        bindRltModalCloseButton(cancelBtn);
        bindRltModalCloseButton(closeBtn);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeRltMassModal();
        });
    }

    function openRltMassModal(wrapper) {
        const elements = getRltMassModalElements();
        const {
            modal,
            massToVolumeMassInput,
            massToVolumeDensityInput,
            massToVolumeVolumeInput,
            refractoInput,
            refractoDensityOutput,
            volumeInput,
            densityInput,
            massInput
        } = elements;
        if (!modal || !wrapper) return;

        setupRltMassModalOnce();
        activeRltMassWrapper = wrapper;
        activeRltMassLastEdited = null;
        activeRltMassCalculationMode = null;
        activeRltFirstFull = isFirstBlocFuelRltRow(wrapper) && (wrapper.dataset.rltFirstFullPending === '1' || wrapper.dataset.rltFirstFullWanted === '1' || wrapper.dataset.rltFirstFull === '1' || wrapper.dataset.rltMode === 'firstFull');

        const storedVolume = wrapper.dataset.volume || '';
        const storedDensity = wrapper.dataset.density || '1.';
        const storedMass = wrapper.dataset.mass || String(wrapper.querySelector('.display-input')?.value || '').replace(/[^0-9]/g, '');
        const storedTopMass = wrapper.dataset.topMass || '';
        const storedTopDensity = wrapper.dataset.topDensity || '';
        const storedTopVolume = wrapper.dataset.topVolume || '';
        const storedBottomVolume = wrapper.dataset.bottomVolume || '';
        const storedBottomDensity = wrapper.dataset.bottomDensity || '';
        const storedBottomMass = wrapper.dataset.bottomMass || '';
        const storedRefracto = wrapper.dataset.refracto || '';
        const storedMode = wrapper.dataset.rltMode || '';
        const storedFirstFull = wrapper.dataset.rltFirstFull || '';

        /*
         * v12.71 — restauration indépendante des deux lignes.
         * Compatibilité ancienne donnée : s'il n'existe pas encore de détail
         * ligne 1/ligne 2, on restaure l'ancienne valeur comme ligne 2.
         */
        const hasDetailedRltData = !!(storedTopMass || storedTopDensity || storedTopVolume || storedBottomVolume || storedBottomDensity || storedBottomMass || storedMode);

        if (massToVolumeMassInput) massToVolumeMassInput.value = hasDetailedRltData ? storedTopMass : '';
        if (massToVolumeDensityInput) massToVolumeDensityInput.value = hasDetailedRltData ? (storedTopDensity || '1.') : '1.';
        if (massToVolumeVolumeInput) massToVolumeVolumeInput.value = hasDetailedRltData ? storedTopVolume : '';
        if (refractoInput) refractoInput.value = storedRefracto;
        if (refractoDensityOutput) refractoDensityOutput.value = '';
        updateRltRefractoDensityOutput({ applyToDensityInputs: false });
        if (volumeInput) volumeInput.value = hasDetailedRltData ? storedBottomVolume : storedVolume;
        if (densityInput) densityInput.value = hasDetailedRltData ? (storedBottomDensity || '1.') : (storedDensity || '1.');
        if (massInput) massInput.value = hasDetailedRltData ? storedBottomMass : storedMass;

        markRltCalculatedField(null);
        syncRltMassModalFromInputs();

        modal.style.removeProperty('display');
        modal.style.display = 'flex';
        modal.removeAttribute('aria-hidden');

        setTimeout(() => {
            try {
                /*
                 * v12.60 — on privilégie la ligne opérationnelle
                 * Volume × Densité = Masse. Sur iPad, focaliser ce champ
                 * fait remonter la fenêtre avec le clavier, y compris quand
                 * la cellule Masse RLT était vide.
                 */
                const preferredInput = volumeInput || massToVolumeMassInput;
                if (preferredInput) {
                    preferredInput.focus({ preventScroll: false });
                    const content = preferredInput.closest('.rlt-mass-modal-content');
                    setTimeout(() => {
                        try {
                            if (content && typeof content.scrollIntoView === 'function') {
                                content.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
                            }
                        } catch (_) {}
                    }, 180);
                }
            } catch (_) {}
        }, 80);
    }

    function initializeRltMassInput(wrapper, data = {}) {
        if (!wrapper) return;
        const displayInput = wrapper.querySelector('.display-input');
        const clearBtn = wrapper.querySelector('.clear-btn');

        wrapper.dataset.volume = data?.rltVolume || '';
        wrapper.dataset.density = data?.rltDensity || '';
        wrapper.dataset.mass = data?.rltMass ? String(data.rltMass).replace(/[^0-9]/g, '') : '';
        wrapper.dataset.topMass = data?.rltTopMass || '';
        wrapper.dataset.topDensity = data?.rltTopDensity || '';
        wrapper.dataset.topVolume = data?.rltTopVolume || '';
        wrapper.dataset.bottomVolume = data?.rltBottomVolume || '';
        wrapper.dataset.bottomDensity = data?.rltBottomDensity || '';
        wrapper.dataset.bottomMass = data?.rltBottomMass || '';
        wrapper.dataset.refracto = data?.rltRefracto || '';
        wrapper.dataset.rltMode = data?.rltMode || '';
        wrapper.dataset.rltFirstFull = data?.rltFirstFull || '';
        wrapper.dataset.rltFirstFullPending = data?.rltFirstFullPending || data?.rltFirstFull || '';
        wrapper.dataset.rltFirstFullWanted = data?.rltFirstFullWanted || data?.rltFirstFullPending || data?.rltFirstFull || '';
        const rowForFirstFull = wrapper.closest('tr');
        if (rowForFirstFull) {
            rowForFirstFull.classList.toggle('bloc-fuel-first-full-row', wrapper.dataset.rltFirstFull === '1' || wrapper.dataset.rltMode === 'firstFull');
            rowForFirstFull.classList.toggle('bloc-fuel-first-full-row-pending', wrapper.dataset.rltFirstFullPending === '1' || wrapper.dataset.rltFirstFullWanted === '1');
        }
        if (displayInput) displayInput.value = data?.rltMass || '';

        setupRltMassModalOnce();

        const open = (event) => {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            if (wrapper.closest('#bloc-fuel') && wrapper.classList.contains('locked-input-wrapper')) return;
            openRltMassModal(wrapper);
        };

        wrapper.addEventListener('click', open);
        if (displayInput) displayInput.addEventListener('click', open);

        if (clearBtn) {
            clearBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                wrapper.dataset.volume = '';
                wrapper.dataset.density = '';
                wrapper.dataset.mass = '';
                wrapper.dataset.topMass = '';
                wrapper.dataset.topDensity = '';
                wrapper.dataset.topVolume = '';
                wrapper.dataset.bottomVolume = '';
                wrapper.dataset.bottomDensity = '';
                wrapper.dataset.bottomMass = '';
                wrapper.dataset.refracto = '';
                wrapper.dataset.rltMode = '';
                wrapper.dataset.rltFirstFull = '';
                wrapper.dataset.rltFirstFullPending = '';
                wrapper.dataset.rltFirstFullWanted = '';
                const rowForClear = wrapper.closest('tr');
                if (rowForClear) {
                    rowForClear.classList.remove('bloc-fuel-first-full-row');
                    rowForClear.classList.remove('bloc-fuel-first-full-row-pending');
                }
                if (displayInput) displayInput.value = '';
                masterRecalculate();
                saveCalculatorState();
            });
        }
    }

    const addNewRow = (tableBody, data, isLastRow = false) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td><div class="input-wrapper time-input-wrapper"><input type="text" class="display-input" readonly placeholder="--:--"><span class="clear-btn">&times;</span><span class="clock-icon">🕒</span><input type="time" class="engine-input"></div></td><td><div class="input-wrapper numeric-input-wrapper fuel-split-input-wrapper" data-unit="kg"><input type="text" class="display-input" inputmode="numeric" placeholder="[valeur]"><span class="clear-btn">&times;</span></div></td><td class="airport-oaci-cell">--</td><td><div class="input-wrapper rlt-mass-input-wrapper" data-unit="kg"><input type="text" class="display-input" readonly placeholder="[kg]"><span class="clear-btn">&times;</span></div></td><td class="duree-rotation-cell"></td><td class="fuel-rotation-cell"></td><td class="tps-vol-cell"></td><td class="tps-vol-restant-cell"></td>`;
        tableBody.appendChild(row);

        const timeWrapper = row.querySelector('.time-input-wrapper');
        const numericWrapper = row.querySelector('.numeric-input-wrapper');
        const rltMassWrapper = row.querySelector('.rlt-mass-input-wrapper');

        initializeTimeInput(timeWrapper, data ? data.time : '');
        initializeNumericInput(numericWrapper, data ? data.fuel : '');
        initializeRltMassInput(rltMassWrapper, data || {});
        row.dataset.airportOaci = data?.oaci || '';
        updateRowAirportOaci(row);

        const forceRowRecalculateAndSave = () => {
            /*
             * v12.30 — sécurité : une modification dans une ligne BLOC/FUEL doit
             * toujours recalculer les colonnes Durée/Fuel/Tps de vol.
             */
            try { updateRowAirportOaci(row); } catch (_) {}
            try { recalculateBlocFuel(); } catch (_) {}
            masterRecalculate();
            saveCalculatorState();
        };

        [
            timeWrapper.querySelector('.display-input'),
            timeWrapper.querySelector('.engine-input'),
            numericWrapper.querySelector('.display-input'),
            rltMassWrapper.querySelector('.display-input')
        ].filter(Boolean).forEach(input => {
            input.addEventListener('change', forceRowRecalculateAndSave);
            input.addEventListener('input', forceRowRecalculateAndSave);
            input.addEventListener('blur', forceRowRecalculateAndSave);
        });

        const checkAndAddRow = () => {
            if (row.nextSibling) {
                timeWrapper.querySelector('.engine-input').removeEventListener('change', checkAndAddRow);
                timeWrapper.querySelector('.display-input').removeEventListener('blur', checkAndAddRow);
                numericWrapper.querySelector('.display-input').removeEventListener('blur', checkAndAddRow);
                return;
            }
            if (timeWrapper.querySelector('.display-input').value || numericWrapper.querySelector('.display-input').value) {
                addNewRow(tableBody, null, true);
            }
        };

        if (isLastRow) {
            timeWrapper.querySelector('.engine-input').addEventListener('change', checkAndAddRow);
            timeWrapper.querySelector('.display-input').addEventListener('blur', checkAndAddRow);
            numericWrapper.querySelector('.display-input').addEventListener('blur', checkAndAddRow);
        }
    };

    function loadCalculatorState() {
        loadActiveFlightState();
    }

    loadCalculatorState();
    updateBlocDepartAirportLabel();
    refreshBlocFuelAirportOaciCells();

    function setupManualButton(btnId, wrapperId, flagSetter) {
        const btn = document.getElementById(btnId);
        const wrapper = document.getElementById(wrapperId);
        const input = wrapper?.querySelector('.display-input');
        if (!btn || !wrapper || !input) return;

        btn.addEventListener('click', () => {
            const isManual = flagSetter();
            const isFuelManualField = wrapper.classList.contains('numeric-input-wrapper') && (wrapper.dataset.unit || '') === 'kg';

            if (isManual) {
                btn.textContent = 'MANUEL';
                btn.classList.add('active');

                if (isFuelManualField) {
                    input.readOnly = true;
                    input.setAttribute('readonly', 'readonly');
                    openFuelSplitModal(input);
                } else {
                    input.readOnly = false;
                    input.removeAttribute('readonly');
                }
            } else {
                btn.textContent = 'AUTO';
                btn.classList.remove('active');
                input.readOnly = true;
                input.setAttribute('readonly', 'readonly');
            }

            masterRecalculate();
        });
    }
    setupManualButton('suivi-conso-rotation-manual-btn', 'suivi-conso-rotation-wrapper', () => isSuiviConsoManual = !isSuiviConsoManual);
    setupManualButton('suivi-duree-rotation-manual-btn', 'suivi-duree-rotation-wrapper', () => isSuiviDureeManual = !isSuiviDureeManual);

    ['suivi-conso-rotation-wrapper'].forEach((wrapperId) => {
        const wrapper = document.getElementById(wrapperId);
        const input = wrapper?.querySelector('.display-input');
        if (!wrapper || !input || wrapper.dataset.fuelSplitManualBound === '1') return;
        wrapper.dataset.fuelSplitManualBound = '1';
        wrapper.addEventListener('click', (event) => {
            if (event.target && event.target.classList && event.target.classList.contains('clear-btn')) return;
            const isManualWrapper = wrapperId === 'suivi-conso-rotation-wrapper' && isSuiviConsoManual;
            if (isManualWrapper) {
                event.preventDefault();
                event.stopPropagation();
                openFuelSplitModal(input);
            }
        });
    });

    const flightSelect = document.getElementById('flight-select');
    const newFlightButton = document.getElementById('new-flight-btn');
    const closeFlightButton = document.getElementById('close-flight-btn');
    const deleteFlightButton = document.getElementById('delete-flight-btn');
    const exportBlocFuelPdfButton = document.getElementById('export-bloc-fuel-pdf-btn');

    if (flightSelect) {
        flightSelect.addEventListener('change', () => {
            updateActiveFlightStateFromDom();
            activeFlightId = flightSelect.value;
            persistFlights();
            loadActiveFlightState();
        });
    }

    if (newFlightButton) {
        newFlightButton.addEventListener('click', () => {
            updateActiveFlightStateFromDom();
            const newFlight = createEmptyFlight(dailyFlights.length + 1);
            const activeFlight = dailyFlights.find(flight => flight.id === activeFlightId);
            if (activeFlight) {
                newFlight.state['tmd'] = activeFlight.state?.['tmd'] || document.getElementById('tmd')?.querySelector('.display-input')?.value || '21:30';
                newFlight.state['limite-hdv'] = activeFlight.state?.['limite-hdv'] || document.getElementById('limite-hdv')?.querySelector('.display-input')?.value || '08:00';
                newFlight.state['fuel-depart'] = activeFlight.state?.['fuel-depart'] || document.getElementById('fuel-depart')?.querySelector('.display-input')?.value || '3500 kg';
                newFlight.state['previ-bloc-depart'] = activeFlight.state?.['previ-bloc-depart'] || document.getElementById('previ-bloc-depart')?.querySelector('.display-input')?.value || '';
                newFlight.state['previ-fuel-depart'] = activeFlight.state?.['previ-fuel-depart'] || document.getElementById('previ-fuel-depart')?.querySelector('.display-input')?.value || '3500 kg';
            }
            dailyFlights.push(newFlight);
            activeFlightId = newFlight.id;
            persistFlights();
            loadActiveFlightState();
        });
    }

    if (closeFlightButton) {
        closeFlightButton.addEventListener('click', () => {
            updateActiveFlightStateFromDom();
            const activeFlight = dailyFlights.find(flight => flight.id === activeFlightId);
            if (!activeFlight) return;
            activeFlight.closed = !activeFlight.closed;
            if (activeFlight.state) {
                activeFlight.state.calculator_table_data = compactCalculatorTableData(activeFlight.state.calculator_table_data || []);
            }
            persistFlights();

            if (activeFlight.closed) {
                const allClosed = dailyFlights.every(flight => flight.closed);
                if (allClosed) {
                    const nextFlight = createEmptyFlight(dailyFlights.length + 1);
                    nextFlight.state['tmd'] = activeFlight.state?.['tmd'] || '21:30';
                    nextFlight.state['limite-hdv'] = activeFlight.state?.['limite-hdv'] || '08:00';
                    nextFlight.state['fuel-depart'] = activeFlight.state?.['fuel-depart'] || '3500 kg';
                    nextFlight.state['previ-bloc-depart'] = activeFlight.state?.['previ-bloc-depart'] || '';
                    nextFlight.state['previ-fuel-depart'] = activeFlight.state?.['previ-fuel-depart'] || '3500 kg';
                    dailyFlights.push(nextFlight);
                    activeFlightId = nextFlight.id;
                    persistFlights();
                    loadActiveFlightState();
                    return;
                }
            }

            loadActiveFlightState();
        });
    }

    if (deleteFlightButton) {
        deleteFlightButton.addEventListener('click', () => {
            if (!confirm('Supprimer ce vol ?')) return;
            dailyFlights = dailyFlights.filter(flight => flight.id !== activeFlightId);
            if (!dailyFlights.length) {
                dailyFlights = [createEmptyFlight(1)];
            }
            normalizeFlightNumbers();
            activeFlightId = dailyFlights[Math.min(dailyFlights.length - 1, 0)].id;
            persistFlights();
            loadActiveFlightState();
        });
    }


    if (exportBlocFuelPdfButton) {
        exportBlocFuelPdfButton.addEventListener('click', exportBlocFuelPdf);
    }

    resetButton.addEventListener('click', () => {
        if (confirm("Voulez-vous vraiment supprimer tous les vols et remettre le Bloc/Fuel à zéro ?")) {
            localStorage.removeItem('calculator_state');
            localStorage.removeItem(MULTI_FLIGHT_STORAGE_KEY);
            localStorage.removeItem(ACTIVE_FLIGHT_ID_STORAGE_KEY);
            dailyFlights = [createEmptyFlight(1)];
            activeFlightId = dailyFlights[0].id;
            persistFlights();
            loadCalculatorState();
            masterRecalculate();
        }
    });

    masterRecalculate = () => {
        if (!isApplyingFlightState && typeof updateDisplayedLimitHdvForActiveFlight === 'function') {
            updateDisplayedLimitHdvForActiveFlight();
        }
        recalculateBlocFuel();
        updatePreviTab();
        updateSuiviTab();
        updateCommuneGpsRouteDisplay();
        updateDeroutementTab();
        if (typeof updateFlightDurationSummary === 'function') updateFlightDurationSummary();
    };

    masterRecalculate();
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calculator-modal')) {
        initializeCalculator();
    }
});
/*
 * v2026.63 — l'ancien redraw Leaflet au `visibilitychange` (hérité de v11.43)
 * est supprimé. La reprise de la carte est centralisée dans
 * setupNpfUnifiedForegroundResume(), afin d'éviter plusieurs redraw concurrents.
 */



// v13.89 — corrections d'affichage RLT/Suivi et alerte post-MAJ gérées par index.html/style.css.


// v14.44 — filtres trafic : centre carte unique et affichage au sol optionnel.


// v14.44 — restauration de getOwnTrafficAltitudeFeet : connexion SafeSky rétablie, carte inchangée.


