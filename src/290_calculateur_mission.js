// =========================================================================
// LOGIQUE DU CALCULATEUR DE MISSION
// =========================================================================
let CALCULATOR_DATA = { distBaseFeu: 0, distPelicFeu: 0, csFeu: '--:--', distGpsFeu: 0 };
const calculateBingo = (dist) => (dist <= 70) ? (dist * 5) + 700 : (dist * 4) + 700;
const calculateFuelToGo = (dist) => (dist <= 70) ? (dist * 5) : (dist * 4);
const calculateConsoRotation = (dist) => { const effectiveDist = Math.max(dist, 10); return (effectiveDist <= 70) ? (effectiveDist * 10) + 250 : (effectiveDist * 8) + 250; };
const calculateTransitTime = (dist) => (dist <= 70) ? (dist * (60 / 210)) : (dist * (60 / 240));

/*
 * v14.47 — forfait premier transit piloté par le champ RLT Départ.
 * Ce forfait est distinct des 10 minutes conservées avant validation du largage.
 */
const RETARDANT_LOADING_FORFAIT_MIN = 10;

const calculateRotationTime = (dist) => {
    const effectiveDist = Math.max(dist, 10);
    const rotationDistance = effectiveDist * 2;
    return (effectiveDist <= 50) ? (20 + (rotationDistance / 3.5)) : (20 + (rotationDistance / 4));
};
let masterRecalculate = () => {};
let isSuiviConsoManual = false, isSuiviDureeManual = false;
const MULTI_FLIGHT_STORAGE_KEY = 'calculator_flights_v12_28';
const ACTIVE_FLIGHT_ID_STORAGE_KEY = 'calculator_active_flight_id_v12_28';
const DEROUT_EMPTY_RETARDANT_KEY = 'derout_empty_retardant_v12_29';
let dailyFlights = [];
let activeFlightId = null;
let isApplyingFlightState = false;
const parseTime = (timeString) => { if (!timeString || !timeString.includes(':')) return null; const parts = timeString.split(':'); return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10); };
const formatTime = (totalMinutes) => { if (totalMinutes === null || isNaN(totalMinutes) || totalMinutes < 0) return ''; const roundedMinutes = Math.round(totalMinutes); const hours = Math.floor(roundedMinutes / 60); const minutes = roundedMinutes % 60; return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`; };
function normalizeClockLimitAfterReference(limitMinutes, referenceMinutes) {
    if (limitMinutes === null || !Number.isFinite(limitMinutes)) return limitMinutes;
    if (referenceMinutes === null || !Number.isFinite(referenceMinutes)) return limitMinutes;
    let normalized = limitMinutes;
    while (normalized < referenceMinutes) normalized += 1440;
    return normalized;
}
function formatClockLimitTime(totalMinutes) {
    if (totalMinutes === null || !Number.isFinite(totalMinutes) || totalMinutes < 0) return '';
    const roundedMinutes = Math.round(totalMinutes);
    const dayOffset = Math.floor(roundedMinutes / 1440);
    const minutesOfDay = ((roundedMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(minutesOfDay / 60);
    const minutes = minutesOfDay % 60;
    const suffix = dayOffset > 0 ? ` +${dayOffset}j` : '';
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}${suffix}`;
}
const parseNumeric = (numericString) => { if (!numericString) return null; const value = parseInt(numericString.replace(/[^0-9]/g, ''), 10); return isNaN(value) ? null : value; };


/*
 * v16.59 — calcul carburant exprimé en NOMBRE DE LARGAGES selon le point de départ.
 *
 * RETOUR BASE : on raisonne sur le feu. Les rotations intermédiaires consomment
 * une rotation complète ; le dernier largage ne consomme dans la marge que le
 * forfait 250 kg, puisque Feu → Base est déjà contenu dans le BINGO Base.
 *
 * RETOUR PÉLIC depuis le PÉLIC : aucun +1. Chaque largage appartient à une
 * rotation complète Pélic → Feu → largage → Pélic. La marge est Fuel départ
 * Pélic - réserve 700 kg.
 *
 * ARRIVÉE SUR FEU depuis Base/GPS (prévi / déroutement direct) : le premier
 * largage est immédiat et coûte d'abord 250 kg dans la marge Feu → BINGO Pélic ;
 * les largages suivants consomment chacun une rotation complète. C'est la
 * traduction correcte du « +1 » opérationnel, sans ajouter un largage gratuit.
 */
function calculateFuelLimitedDropCount(fuelOnFire, bingoFuel, fullRotationFuel, dropFuel = 250) {
    if (![fuelOnFire, bingoFuel, fullRotationFuel, dropFuel].every(Number.isFinite)) return null;
    if (fullRotationFuel <= 0 || dropFuel <= 0) return null;
    const margin = Math.max(0, fuelOnFire - bingoFuel);
    const fullCycles = Math.floor(margin / fullRotationFuel);
    const remainderKg = Math.max(0, margin - (fullCycles * fullRotationFuel));
    const terminalFraction = Math.min(1, remainderKg / dropFuel);
    return { margin, fullCycles, remainderKg, terminalFraction, value: fullCycles + terminalFraction };
}

function calculateFuelDropsFromPelicDeparture(fuelAtPelic, fullRotationFuel, reserveFuel = 700) {
    if (![fuelAtPelic, fullRotationFuel, reserveFuel].every(Number.isFinite)) return null;
    if (fullRotationFuel <= 0) return null;
    const margin = Math.max(0, fuelAtPelic - reserveFuel);
    return { margin, reserveFuel, value: margin / fullRotationFuel };
}

function calculateFuelDropsFromInboundFireToPelic(fuelOnFire, bingoPelic, fullRotationFuel, dropFuel = 250) {
    if (![fuelOnFire, bingoPelic, fullRotationFuel, dropFuel].every(Number.isFinite)) return null;
    if (fullRotationFuel <= 0 || dropFuel <= 0) return null;
    const margin = Math.max(0, fuelOnFire - bingoPelic);
    if (margin <= dropFuel) {
        return {
            margin,
            firstDropFraction: margin / dropFuel,
            fuelAfterFirstDropMargin: 0,
            followingRotations: 0,
            value: margin / dropFuel
        };
    }
    const fuelAfterFirstDropMargin = margin - dropFuel;
    const followingRotations = fuelAfterFirstDropMargin / fullRotationFuel;
    return {
        margin,
        firstDropFraction: 1,
        fuelAfterFirstDropMargin,
        followingRotations,
        value: 1 + followingRotations
    };
}

function updateAndSortRotations(container, current, params) {
    const FIRST_DROP_FORFAIT_MIN = Number.isFinite(params.firstDropForfaitMin) ? params.firstDropForfaitMin : 10;
    const lines = Array.from(container.querySelectorAll('.result-line'));
    const resultsData = [];
    let minTimeLimit = Infinity;
    let minFuelLimit = Infinity;

    const containerId = container?.id || '';
    const isSuiviRotation = containerId === 'suivi-rotation-results-container';
    const isPreviRotation = containerId === 'previ-rotation-results-container';
    const isDeroutRotation = containerId === 'derout-rotation-results-container';

    const returnBaseTime = Math.round(calculateTransitTime(CALCULATOR_DATA.distBaseFeu || 0));
    const effectivePelicDistance = Math.max(CALCULATOR_DATA.distPelicFeu || 0, 10);
    const rotationSpeedLabel = effectivePelicDistance <= 50 ? '3,5 Nm/min (210 kt)' : '4,0 Nm/min (240 kt)';
    const rotationSpeedValue = effectivePelicDistance <= 50 ? 3.5 : 4;
    const rotationConsoRate = effectivePelicDistance <= 70 ? 10 : 8;
    const baseConsoRate = (CALCULATOR_DATA.distBaseFeu || 0) <= 70 ? 5 : 4;
    const pelicConsoRate = (CALCULATOR_DATA.distPelicFeu || 0) <= 70 ? 5 : 4;

    const numberOrNA = value => Number.isFinite(value) ? value : 'N/A';
    const kgOrNA = value => Number.isFinite(value) ? `${value} kg` : 'N/A';
    const minOrNA = value => Number.isFinite(value) ? `${Math.round(value)} min` : 'N/A';
    const timeOrNA = value => (value !== null && Number.isFinite(value)) ? formatTime(value) : 'N/A';

    const rotationFormulaDetails = () => [
        `Durée rotation feu ↔ pélic = 20 min + ((Distance retenue × 2) / Vitesse)`,
        `Distance retenue = max(Distance Feu → Pélic, 10 Nm) = ${effectivePelicDistance} Nm`,
        `Vitesse = ${rotationSpeedLabel}`,
        `Durée rotation = 20 + ((${effectivePelicDistance} × 2) / ${rotationSpeedValue}) = ${minOrNA(params.rotationTime)}`,
        ``,
        `Conso rotation feu ↔ pélic = Distance retenue × conso aller-retour + forfait largage`,
        `Conso aller-retour = 10 kg/Nm si distance ≤ 70 Nm, sinon 8 kg/Nm`,
        `Forfait largage = 250 kg`,
        `Conso rotation = (${effectivePelicDistance} × ${rotationConsoRate}) + 250 = ${kgOrNA(params.consoRotation)}`
    ].join('\n');

    const bingoBaseDetails = () => [
        `BINGO Base = 700 kg + conso Feu → Base`,
        `Distance Feu → Base = ${numberOrNA(CALCULATOR_DATA.distBaseFeu)} Nm`,
        `Conso = ${baseConsoRate} kg/Nm (${(CALCULATOR_DATA.distBaseFeu || 0) <= 70 ? 'distance ≤ 70 Nm' : 'distance > 70 Nm'})`,
        `BINGO Base = 700 + (${numberOrNA(CALCULATOR_DATA.distBaseFeu)} × ${baseConsoRate}) = ${kgOrNA(params.bingoBase)}`
    ].join('\n');

    const bingoPelicDetails = () => [
        `BINGO Pélic = 700 kg + conso Feu → Pélic`,
        `Distance Feu → Pélic = ${numberOrNA(CALCULATOR_DATA.distPelicFeu)} Nm`,
        `Conso = ${pelicConsoRate} kg/Nm (${(CALCULATOR_DATA.distPelicFeu || 0) <= 70 ? 'distance ≤ 70 Nm' : 'distance > 70 Nm'})`,
        `BINGO Pélic = 700 + (${numberOrNA(CALCULATOR_DATA.distPelicFeu)} × ${pelicConsoRate}) = ${kgOrNA(params.bingoPelic)}`
    ].join('\n');

    const currentContextDetails = () => [
        params.currentTimeLabel ? `${params.currentTimeLabel} = ${timeOrNA(current.time)}` : `Heure sur feu = ${timeOrNA(current.time)}`,
        `Fuel sur feu = ${kgOrNA(current.fuel)}`,
        params.transitSourceLabel ? `Terrain départ premier transit = ${params.transitSourceLabel}` : null,
        params.preTransitForfaitMin ? `Forfait départ/roulage/décollage = ${params.preTransitForfaitMin} min` : null,
        `Transit vers feu = ${minOrNA(params.rawTransitTime ?? params.transitTime)}`,
        params.effectiveTransitDistance !== undefined ? `Distance transit retenue = ${numberOrNA(params.effectiveTransitDistance)} Nm` : null,
        `Forfait validation premier largage = ${FIRST_DROP_FORFAIT_MIN} min`,
        `Retour feu → base = ${minOrNA(returnBaseTime)}`
    ].filter(Boolean).join('\n');

 // --- Première passe : calculer toutes les valeurs et trouver les limites ---
    lines.forEach(line => {
        const type = line.dataset.rotationType;
        let value = null;
        let formulaString = "Données insuffisantes pour le calcul.";

        const canCalculateFuel = current.fuel !== null && Number.isFinite(current.fuel) && params.consoRotation !== null && Number.isFinite(params.consoRotation) && params.consoRotation > 0;
        const canCalculateTime = current.time !== null && Number.isFinite(current.time) && params.rotationTime !== null && Number.isFinite(params.rotationTime) && params.rotationTime > 0;

        if (type === 'base') {
            const fuelResult = canCalculateFuel
                ? calculateFuelLimitedDropCount(current.fuel, params.bingoBase, params.consoRotation, 250)
                : null;
            formulaString = [
                `FUEL RETOUR BASE — NOMBRE DE LARGAGES`,
                ``,
                currentContextDetails(),
                ``,
                bingoBaseDetails(),
                ``,
                rotationFormulaDetails(),
                ``,
                `Règle carburant :`,
                `Marge disponible = Fuel sur feu - BINGO Base`,
                `Rotations complètes avant le dernier largage = ENT(Marge / Conso rotation)`,
                `Reste = Marge - (rotations complètes × Conso rotation)`,
                `Fraction du dernier largage = min(1 ; Reste / 250 kg)`,
                `Nbr largages = rotations complètes + fraction du dernier largage`,
                ``,
                fuelResult
                    ? `Calcul = marge ${kgOrNA(fuelResult.margin)} ; complets ${fuelResult.fullCycles} ; reste ${kgOrNA(fuelResult.remainderKg)} ; fraction ${(fuelResult.terminalFraction).toFixed(3)} ; total ${(fuelResult.value).toFixed(3)}`
                    : `Données insuffisantes.`
            ].join('\n');
            if (fuelResult) value = fuelResult.value;
        }
        if (type === 'pelic') {
            const pelicFuelMode = String(params.pelicFuelMode || 'inbound-fire');
            const fuelResult = canCalculateFuel
                ? (
                    pelicFuelMode === 'pelic-departure'
                        ? calculateFuelDropsFromPelicDeparture(params.pelicDepartureFuel, params.consoRotation, 700)
                        : calculateFuelDropsFromInboundFireToPelic(current.fuel, params.bingoPelic, params.consoRotation, 250)
                )
                : null;

            if (pelicFuelMode === 'pelic-departure') {
                formulaString = [
                    `FUEL RETOUR PÉLIC — NOMBRE DE LARGAGES`,
                    ``,
                    `Point de départ du calcul : PÉLIC`,
                    `Fuel départ Pélic = ${kgOrNA(params.pelicDepartureFuel)}`,
                    `Réserve arrivée Pélic = 700 kg`,
                    ``,
                    rotationFormulaDetails(),
                    ``,
                    `Règle carburant :`,
                    `Marge utilisable = Fuel départ Pélic - 700 kg`,
                    `Chaque largage = une rotation complète Pélic → Feu → largage → Pélic`,
                    `Aucun +1 : le calcul commence avant le départ du Pélic`,
                    `Nbr largages = Marge utilisable / Conso rotation`,
                    ``,
                    fuelResult
                        ? `Calcul = (${params.pelicDepartureFuel} - 700) / ${params.consoRotation} = ${(fuelResult.value).toFixed(3)}`
                        : `Données insuffisantes.`
                ].join('\n');
            } else {
                formulaString = [
                    `FUEL RETOUR PÉLIC — NOMBRE DE LARGAGES`,
                    ``,
                    currentContextDetails(),
                    ``,
                    bingoPelicDetails(),
                    ``,
                    rotationFormulaDetails(),
                    ``,
                    `Règle carburant — arrivée sur feu depuis Base/GPS :`,
                    `Marge disponible = Fuel sur feu - BINGO Pélic`,
                    `Le premier largage est immédiat : il consomme d'abord 250 kg dans cette marge`,
                    `Si la marge est < 250 kg : fraction du 1er largage = Marge / 250`,
                    `Sinon : 1er largage = 1 puis rotations suivantes = (Marge - 250) / Conso rotation`,
                    `Nbr largages = 1 + rotations suivantes`,
                    ``,
                    fuelResult
                        ? `Calcul = marge ${kgOrNA(fuelResult.margin)} ; 1er largage ${(fuelResult.firstDropFraction).toFixed(3)} ; marge après 1er largage ${kgOrNA(fuelResult.fuelAfterFirstDropMargin)} ; rotations suivantes ${(fuelResult.followingRotations).toFixed(3)} ; total ${(fuelResult.value).toFixed(3)}`
                        : `Données insuffisantes.`
                ].join('\n');
            }
            if (fuelResult) value = fuelResult.value;
        }
        if (type === 'cs') {
            const firstDropTime = canCalculateTime ? current.time + FIRST_DROP_FORFAIT_MIN : null;
            const canFirstDropBeforeCs = canCalculateTime && params.csFeuTime !== null && Number.isFinite(params.csFeuTime) && firstDropTime <= params.csFeuTime;
            const remainingAfterFirstDrop = canFirstDropBeforeCs ? (params.csFeuTime - firstDropTime) : null;
            formulaString = [
                `COUCHER SOLEIL`,
                ``,
                currentContextDetails(),
                `Coucher soleil sur feu = ${timeOrNA(params.csFeuTime)}`,
                ``,
                rotationFormulaDetails(),
                ``,
                `Validation du +1 :`,
                `+1 possible uniquement si Heure sur feu + ${FIRST_DROP_FORFAIT_MIN} min ≤ CS.`,
                `Test : ${timeOrNA(current.time)} + ${FIRST_DROP_FORFAIT_MIN} min = ${timeOrNA(firstDropTime)} ≤ ${timeOrNA(params.csFeuTime)} → ${canFirstDropBeforeCs ? 'OUI' : 'NON'}`,
                ``,
                `Si le +1 est impossible : résultat = 0.`,
                `Si le +1 est possible :`,
                `Nbr largages CS = 1 + ((CS - Heure premier largage) / Durée rotation)`,
                `Heure premier largage = Heure sur feu + ${FIRST_DROP_FORFAIT_MIN} min`,
                `Calcul = 1 + ((${timeOrNA(params.csFeuTime)} - ${timeOrNA(firstDropTime)}) / ${minOrNA(params.rotationTime)})`
            ].join('\n');
            if (canCalculateTime && params.csFeuTime !== null && Number.isFinite(params.csFeuTime)) {
                value = canFirstDropBeforeCs ? 1 + (remainingAfterFirstDrop / params.rotationTime) : 0;
            }
        }
        if (type === 'tmd') {
            const firstDropTime = canCalculateTime ? current.time + FIRST_DROP_FORFAIT_MIN : null;
            const backBaseAfterFirstDropTime = canCalculateTime ? firstDropTime + returnBaseTime : null;
            const effectiveTmdTime = normalizeClockLimitAfterReference(params.tmdTime, current.time);
            const canFirstDropAndReturnBeforeTmd = canCalculateTime && effectiveTmdTime !== null && Number.isFinite(effectiveTmdTime) && backBaseAfterFirstDropTime <= effectiveTmdTime;
            const remainingForRotations = canFirstDropAndReturnBeforeTmd ? (effectiveTmdTime - firstDropTime - returnBaseTime) : null;
            formulaString = [
                `TMD`,
                ``,
                currentContextDetails(),
                `Fin TMD = ${formatClockLimitTime(effectiveTmdTime) || 'N/A'}`,
                ``,
                rotationFormulaDetails(),
                ``,
                `Validation du +1 :`,
                `+1 possible uniquement si l'avion peut arriver sur feu, larguer avec le forfait ${FIRST_DROP_FORFAIT_MIN} min, puis revenir base avant la fin TMD.`,
                `Test : Heure sur feu + ${FIRST_DROP_FORFAIT_MIN} min + retour base ≤ TMD`,
                `Test : ${timeOrNA(current.time)} + ${FIRST_DROP_FORFAIT_MIN} min + ${minOrNA(returnBaseTime)} = ${formatClockLimitTime(backBaseAfterFirstDropTime) || 'N/A'} ≤ ${formatClockLimitTime(effectiveTmdTime) || 'N/A'} → ${canFirstDropAndReturnBeforeTmd ? 'OUI' : 'NON'}`,
                ``,
                `Si le +1 est impossible : résultat = 0.`,
                `Si le +1 est possible :`,
                `Nbr largages TMD = 1 + ((TMD - Heure premier largage - Retour base final) / Durée rotation)`,
                `Heure premier largage = Heure sur feu + ${FIRST_DROP_FORFAIT_MIN} min`,
                `Calcul = 1 + ((${formatClockLimitTime(effectiveTmdTime) || 'N/A'} - ${formatClockLimitTime(firstDropTime) || 'N/A'} - ${minOrNA(returnBaseTime)}) / ${minOrNA(params.rotationTime)})`
            ].join('\n');
            if (canCalculateTime && effectiveTmdTime !== null && Number.isFinite(effectiveTmdTime)) {
                value = canFirstDropAndReturnBeforeTmd ? 1 + (remainingForRotations / params.rotationTime) : 0;
            }
        }
        if (type === 'hdv') {
            const canFirstDropAndReturnWithinHdv = canCalculateTime && params.limiteHDV !== null && Number.isFinite(params.limiteHDV)
                && params.transitTime !== null && Number.isFinite(params.transitTime)
                && (params.transitTime + FIRST_DROP_FORFAIT_MIN + returnBaseTime) <= params.limiteHDV;
            const remainingForRotations = canFirstDropAndReturnWithinHdv ? (params.limiteHDV - params.transitTime - FIRST_DROP_FORFAIT_MIN - returnBaseTime) : null;
            formulaString = [
                `HDV RESTANTES`,
                ``,
                currentContextDetails(),
                `HDV restantes disponibles = ${timeOrNA(params.limiteHDV)}`,
                ``,
                rotationFormulaDetails(),
                ``,
                `Validation du +1 :`,
                `Même logique que TMD, mais en durée restante : +1 possible uniquement si Transit vers feu + ${FIRST_DROP_FORFAIT_MIN} min + retour base ≤ HDV restantes.`,
                `Test : ${minOrNA(params.transitTime)} + ${FIRST_DROP_FORFAIT_MIN} min + ${minOrNA(returnBaseTime)} = ${minOrNA((params.transitTime || 0) + FIRST_DROP_FORFAIT_MIN + returnBaseTime)} ≤ ${timeOrNA(params.limiteHDV)} → ${canFirstDropAndReturnWithinHdv ? 'OUI' : 'NON'}`,
                ``,
                `Si le +1 est impossible : résultat = 0.`,
                `Si le +1 est possible :`,
                `Nbr largages HDV = 1 + ((HDV restantes - Transit vers feu - ${FIRST_DROP_FORFAIT_MIN} min - Retour base final) / Durée rotation)`,
                `Calcul = 1 + ((${timeOrNA(params.limiteHDV)} - ${minOrNA(params.transitTime)} - ${FIRST_DROP_FORFAIT_MIN} min - ${minOrNA(returnBaseTime)}) / ${minOrNA(params.rotationTime)})`
            ].join('\n');
            if (canCalculateTime && params.limiteHDV !== null && Number.isFinite(params.limiteHDV)) {
                value = canFirstDropAndReturnWithinHdv ? 1 + (remainingForRotations / params.rotationTime) : 0;
            }
        }

        resultsData.push({ type, value, element: line, formulaString });

        if ((type === 'cs' || type === 'tmd' || type === 'hdv') && value !== null) {
            minTimeLimit = Math.min(minTimeLimit, value);
        }
        if ((type === 'base' || type === 'pelic') && value !== null) {
            minFuelLimit = Math.min(minFuelLimit, value);
        }
    });

 // Si une limite temporelle est la première limite atteinte,
 // toute valeur suivante (plus élevée) est impossible et passe en rouge.
    const shouldForceTimeConstraint = minTimeLimit !== Infinity;

 // --- Deuxième passe : appliquer les styles et mettre à jour le DOM ---
    resultsData.forEach(result => {
        const { type, value, element, formulaString } = result;
        const valueCell = element.querySelector('.value');
        const helpIcon = element.querySelector('.formula-help-icon');
        const isTimeLimited = shouldForceTimeConstraint && value !== null && value > minTimeLimit;

        if (value === null) {
            valueCell.textContent = '--';
        } else {
            valueCell.textContent = Math.max(0, value).toFixed(1);
        }

        valueCell.classList.remove('rotation-value-default', 'rotation-value-green', 'rotation-value-yellow', 'rotation-value-red');

        if (isTimeLimited) {
            valueCell.classList.add('rotation-value-red');
        } else {
            if (value === null) {
                 valueCell.classList.add('rotation-value-default');
                 valueCell.textContent = '--';
            } else if (value > 1.5) {
                valueCell.classList.add('rotation-value-green');
            } else if (value >= 1.1) {
                valueCell.classList.add('rotation-value-yellow');
            } else {
                valueCell.classList.add('rotation-value-red');
            }
        }

        if (helpIcon) { helpIcon.onclick = () => alert(formulaString); }
    });

 // --- Trier et ré-insérer les éléments dans le DOM ---
    resultsData.sort((a, b) => {
        const valA = a.value !== null ? Math.max(0, a.value) : Infinity;
        const valB = b.value !== null ? Math.max(0, b.value) : Infinity;
        return valA - valB;
    });

    resultsData.forEach(item => container.appendChild(item.element));
}

function recalculateBlocFuel() {
    const blocDepartWrapper = document.getElementById('bloc-depart');
    const fuelDepartWrapper = document.getElementById('fuel-depart');
    const limiteHdvWrapper = document.getElementById('limite-hdv');

    const blocDepart = parseTime(blocDepartWrapper?.querySelector('.display-input')?.value || '');
    const fuelDepart = parseNumeric(fuelDepartWrapper?.querySelector('.display-input')?.value || '');
    const limiteHDV = (typeof getEffectiveLimitHdvForActiveFlight === 'function')
        ? getEffectiveLimitHdvForActiveFlight()
        : parseTime(limiteHdvWrapper?.querySelector('.display-input')?.value || '');

    /*
     * v12.31 : le champ LIMITE HDV du vol actif affiche déjà le restant journée
     * avant ce vol. Le cumul du tableau repart donc à 0 pour le vol actif.
     */
    let previousBlocArrivee = blocDepart;
    let previousFuelPelic = fuelDepart;
    let cumulativeTpsVol = 0;

    const tableRows = document.querySelectorAll('#bloc-fuel tbody tr');
    tableRows.forEach((row) => {
        const blocArrivee = parseTime(row.querySelector('.time-input-wrapper .display-input')?.value || '');
        const fuelPelic = parseNumeric(row.querySelector('.numeric-input-wrapper .display-input')?.value || '');

        const dureeCell = row.querySelector('.duree-rotation-cell');
        const fuelCell = row.querySelector('.fuel-rotation-cell');
        const tpsVolCell = row.querySelector('.tps-vol-cell');
        const tpsRestantCell = row.querySelector('.tps-vol-restant-cell');
        const rltWrapper = row.querySelector('.rlt-mass-input-wrapper');
        const isFirstFullRlt = rltWrapper?.dataset.rltFirstFull === '1' || rltWrapper?.dataset.rltMode === 'firstFull';
        row.classList.toggle('bloc-fuel-first-full-row', !!isFirstFullRlt);
        if (!isFirstFullRlt) {
            row.classList.remove('bloc-fuel-first-full-row');
        }
        if (isFirstFullRlt) {
            /*
             * v12.84 — Plein au départ : la ligne reste une ligne de départ
             * exploitable. On ne verrouille/masque plus Fuel ni OACI : ces
             * deux valeurs servent notamment au premier transit Suivi largages.
             * Seules les colonnes de rotations calculées restent vides pour
             * cette ligne.
             */
            if (dureeCell) dureeCell.textContent = '';
            if (fuelCell) fuelCell.textContent = '';
            if (tpsVolCell) tpsVolCell.textContent = '';
            if (tpsRestantCell) tpsRestantCell.textContent = '';
            try { updateRowAirportOaci(row); } catch (_) {}
            if (blocArrivee !== null) previousBlocArrivee = blocArrivee;
            if (fuelPelic !== null) previousFuelPelic = fuelPelic;
            return;
        }

        let dureeRotation = null;
        if (blocArrivee !== null && previousBlocArrivee !== null) {
            dureeRotation = blocArrivee - previousBlocArrivee;
        }

        let fuelRotation = null;
        if (fuelPelic !== null && previousFuelPelic !== null) {
            fuelRotation = previousFuelPelic - fuelPelic;
        }

        if (dureeCell) dureeCell.textContent = formatTime(dureeRotation) || '--';
        if (fuelCell) fuelCell.textContent = (fuelRotation === null) ? '--' : `${fuelRotation}`;

        if (blocArrivee !== null) {
            if (dureeRotation !== null && dureeRotation > 0) {
                cumulativeTpsVol += dureeRotation;
            }

            let tpsVolRestant = null;
            if (limiteHDV !== null) {
                tpsVolRestant = limiteHDV - cumulativeTpsVol;
            }

            if (tpsVolCell) tpsVolCell.textContent = formatTime(cumulativeTpsVol) || '00:00';
            if (tpsRestantCell) tpsRestantCell.textContent = formatTime(tpsVolRestant) || '--';
        } else {
            if (tpsVolCell) tpsVolCell.textContent = '--';
            if (tpsRestantCell) tpsRestantCell.textContent = '--';
        }

        if (blocArrivee !== null) previousBlocArrivee = blocArrivee;
        if (fuelPelic !== null) previousFuelPelic = fuelPelic;
    });
}

// v13.88 — Fuel sur feu Prévi en lecture seule, RLT départ et espacements ajustés.
function updatePreviTab() {
    const defaultFormula = "Données insuffisantes pour le calcul.";
    const setHelp = (id, formula) => {
        const icon = document.getElementById(id);
        if (icon) { icon.onclick = () => alert(formula || defaultFormula); }
    };

    if (!currentCommune) {
        document.getElementById('previ-bingo-base').innerHTML = '-- kg';
        document.getElementById('previ-bingo-pelic').innerHTML = '-- kg';
        document.querySelectorAll('#previ-rotation-results-container .value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
        document.getElementById('heure-sur-feu').textContent = '--:--';
        document.getElementById('duree-transit').textContent = '--:--';
        document.getElementById('conso-aller-feu').textContent = '-- kg';
        const previFuelSurFeuNoCommune = document.getElementById('fuel-sur-feu'); if (previFuelSurFeuNoCommune) previFuelSurFeuNoCommune.textContent = '-- kg';
        document.getElementById('duree-rotation').textContent = '--:--';
        document.getElementById('conso-par-rotation').textContent = '-- kg';
        document.getElementById('cs-sur-feu').textContent = '--:--';
        setHelp('heure-sur-feu-help'); setHelp('duree-transit-help'); setHelp('conso-aller-feu-help');
        setHelp('fuel-sur-feu-help'); setHelp('duree-rotation-help'); setHelp('conso-par-rotation-help');
        return;
    }

    const bingoBase = calculateBingo(CALCULATOR_DATA.distBaseFeu);
    const bingoPelic = calculateBingo(CALCULATOR_DATA.distPelicFeu);
    const bingoBaseDisplay = document.getElementById('previ-bingo-base');
    if (bingoBase === 700) { bingoBaseDisplay.innerHTML = '-- kg'; } else { bingoBaseDisplay.innerHTML = `${selectedBaseOACI} / ${CALCULATOR_DATA.distBaseFeu} Nm /&nbsp;<b>${bingoBase} kg</b>`; }
    const bingoPelicDisplay = document.getElementById('previ-bingo-pelic');
    if (bingoPelic === 700 || !selectedPelicanOACI) { bingoPelicDisplay.innerHTML = '-- kg'; } else { bingoPelicDisplay.innerHTML = `${selectedPelicanOACI} / ${CALCULATOR_DATA.distPelicFeu} Nm /&nbsp;<b>${bingoPelic} kg</b>`; }

    const heureTO = parseTime(document.getElementById('previ-bloc-depart').querySelector('.display-input').value);
    const fuelDepart = parseNumeric(document.getElementById('previ-fuel-depart').querySelector('.display-input').value);
    const limiteHDV = parseTime(document.getElementById('previ-limite-hdv').querySelector('.display-input').value);
    const tmdTime = parseTime(document.getElementById('previ-tmd').querySelector('.display-input').value);
    const csFeuTime = parseTime(CALCULATOR_DATA.csFeu);

    const transitTime = Math.round(calculateTransitTime(CALCULATOR_DATA.distBaseFeu));
    const rotationTime = Math.round(calculateRotationTime(CALCULATOR_DATA.distPelicFeu));
    const consoRotation = calculateConsoRotation(CALCULATOR_DATA.distPelicFeu);
    const consoAller = calculateFuelToGo(CALCULATOR_DATA.distBaseFeu);
    const rltDepartMass = parseNumeric(document.getElementById('rlt-depart')?.querySelector('.display-input')?.value || '');
    const firstTransitAlreadyLoaded = rltDepartMass !== null && rltDepartMass > 0;
    const previForfaitRltMin = firstTransitAlreadyLoaded ? 0 : RETARDANT_LOADING_FORFAIT_MIN;
    const previTempsAvantFeu = previForfaitRltMin + transitTime;
    const heureSurFeu = heureTO !== null ? heureTO + previTempsAvantFeu : null;

    document.getElementById('duree-transit').textContent = formatTime(transitTime) || '--:--';
    setHelp('duree-transit-help', `DURÉE TRANSIT BASE → FEU\n\nFormule : Distance Base → Feu × (60 / Vitesse)\n\nRègle vitesse :\n- Distance ≤ 70 Nm : 210 kt\n- Distance > 70 Nm : 240 kt\n\nDistance Base → Feu : ${CALCULATOR_DATA.distBaseFeu} Nm\nVitesse retenue : ${CALCULATOR_DATA.distBaseFeu <= 70 ? 210 : 240} kt\n\nCalcul : ${CALCULATOR_DATA.distBaseFeu} × (60 / ${CALCULATOR_DATA.distBaseFeu <= 70 ? 210 : 240}) = ${formatTime(transitTime)} (${transitTime} min)`);

    document.getElementById('heure-sur-feu').textContent = formatTime(heureSurFeu) || '--:--';
    setHelp('heure-sur-feu-help', `HEURE SUR FEU — PRÉVI\n\nFormule : BLOC DÉPART + forfait plein retardant éventuel + durée transit Base → Feu\n\nBLOC DÉPART : ${formatTime(heureTO) || 'N/A'}\nRLT Départ : ${rltDepartMass !== null ? `${rltDepartMass} kg` : 'non renseigné'}\nForfait plein retardant : ${previForfaitRltMin} min\nDurée transit : ${formatTime(transitTime)} (${transitTime} min)\n\nCalcul : ${formatTime(heureTO) || 'N/A'} + ${previForfaitRltMin} min + ${formatTime(transitTime)} = ${formatTime(heureSurFeu) || 'N/A'}\n\n${firstTransitAlreadyLoaded ? 'Aucun forfait au premier transit : le champ RLT Départ de l’en-tête contient déjà une masse.' : `Le champ RLT Départ est vide : le forfait de ${RETARDANT_LOADING_FORFAIT_MIN} min est appliqué avant le premier transit.`}\nLes 10 min avant validation du largage restent appliquées séparément dans les limites CS/TMD/HDV.`);

    document.getElementById('conso-aller-feu').textContent = `${consoAller} kg`;
    setHelp('conso-aller-feu-help', `CONSO TRANSIT BASE → FEU\n\nFormule : Distance Base → Feu × Conso au Nm\n\nRègle consommation :\n- Distance ≤ 70 Nm : 5 kg/Nm\n- Distance > 70 Nm : 4 kg/Nm\n\nDistance Base → Feu : ${CALCULATOR_DATA.distBaseFeu} Nm\nConso retenue : ${CALCULATOR_DATA.distBaseFeu <= 70 ? 5 : 4} kg/Nm\n\nCalcul : ${CALCULATOR_DATA.distBaseFeu} × ${CALCULATOR_DATA.distBaseFeu <= 70 ? 5 : 4} = ${consoAller} kg`);

    document.getElementById('duree-rotation').textContent = rotationTime === 20 ? '--:--' : formatTime(rotationTime);
    setHelp('duree-rotation-help', `DURÉE ROTATION FEU ↔ PÉLIC\n\nFormule : 20 min + ((Distance retenue × 2) / Vitesse)\n\nDistance retenue :\n- Distance Feu → Pélicandrome mesurée si ≥ 10 Nm\n- 10 Nm minimum si la distance mesurée est < 10 Nm\n\nDistance Feu → Pélic mesurée : ${CALCULATOR_DATA.distPelicFeu} Nm\nDistance retenue : ${Math.max(CALCULATOR_DATA.distPelicFeu, 10)} Nm\n\nRègle vitesse :\n- Distance retenue ≤ 50 Nm : 3,5 Nm/min, soit 210 kt\n- Distance retenue > 50 Nm : 4,0 Nm/min, soit 240 kt\n\nCalcul : 20 + ((${Math.max(CALCULATOR_DATA.distPelicFeu, 10)} × 2) / ${Math.max(CALCULATOR_DATA.distPelicFeu, 10) <= 50 ? 3.5 : 4}) = ${formatTime(rotationTime)} (${rotationTime} min)\n\nCette durée sert pour les rotations supplémentaires après validation éventuelle du +1.`);

    document.getElementById('conso-par-rotation').textContent = consoRotation === 250 ? '-- kg' : `${consoRotation} kg`;
    setHelp('conso-par-rotation-help', `CONSO ROTATION FEU ↔ PÉLIC\n\nFormule : (Distance retenue × conso aller-retour) + forfait largage\n\nDistance retenue :\n- Distance Feu → Pélicandrome mesurée si ≥ 10 Nm\n- 10 Nm minimum si la distance mesurée est < 10 Nm\n\nDistance Feu → Pélic mesurée : ${CALCULATOR_DATA.distPelicFeu} Nm\nDistance retenue : ${Math.max(CALCULATOR_DATA.distPelicFeu, 10)} Nm\n\nRègle consommation aller-retour :\n- Distance retenue ≤ 70 Nm : 10 kg/Nm\n- Distance retenue > 70 Nm : 8 kg/Nm\n\nForfait largage : 250 kg\n\nCalcul : (${Math.max(CALCULATOR_DATA.distPelicFeu, 10)} × ${Math.max(CALCULATOR_DATA.distPelicFeu, 10) <= 70 ? 10 : 8}) + 250 = ${consoRotation} kg`);

    const fuelSurFeuDisplay = document.getElementById('fuel-sur-feu');
    const fuelEstime = fuelDepart !== null ? fuelDepart - consoAller : null;
    if (fuelSurFeuDisplay) fuelSurFeuDisplay.textContent = fuelEstime !== null ? `${fuelEstime} kg` : '-- kg';
    setHelp('fuel-sur-feu-help', `FUEL SUR FEU

Valeur calculée automatiquement et non modifiable.

Formule : FUEL Départ - Conso transit Base → Feu

FUEL Départ : ${fuelDepart !== null ? fuelDepart : 'N/A'} kg
Conso transit : ${consoAller} kg

Calcul : ${fuelDepart !== null ? fuelDepart : 'N/A'} - ${consoAller} = ${fuelEstime !== null ? fuelEstime + ' kg' : 'N/A'}

Cette valeur sert aux calculs Fuel retour Base/Pélic.`);

    const fuelSurFeu = fuelEstime;

    document.getElementById('cs-sur-feu').textContent = CALCULATOR_DATA.csFeu;
    document.getElementById('tmd-display').textContent = formatTime(tmdTime);
    document.getElementById('hdv-restant-display').textContent = formatTime(limiteHDV);

    updateAndSortRotations(
        document.getElementById('previ-rotation-results-container'),
        { fuel: fuelSurFeu, time: heureSurFeu },
        {
            bingoBase,
            bingoPelic,
            consoRotation,
            rotationTime,
            csFeuTime,
            tmdTime,
            limiteHDV,
            transitTime: previTempsAvantFeu,
            rawTransitTime: transitTime,
            preTransitForfaitMin: previForfaitRltMin,
            effectiveTransitDistance: CALCULATOR_DATA.distBaseFeu,
            transitSourceLabel: selectedBaseOACI ? `BLOC DÉPART / base (${selectedBaseOACI})` : 'BLOC DÉPART / base non renseignée',
            currentTimeLabel: 'Heure sur feu',
            consoTransitFromGps: consoAller,
            firstDropForfaitMin: 10,
            pelicFuelMode: 'inbound-fire',
            pelicDepartureFuel: null
        }
    );
}

function updateSuiviTab() {
    const suiviConsoInput = document.getElementById('suivi-conso-rotation-wrapper').querySelector('.display-input');
    const suiviDureeInput = document.getElementById('suivi-duree-rotation-wrapper').querySelector('.display-input');
    const setSuiviHelp = (id, formula) => {
        const icon = document.getElementById(id);
        if (icon) icon.onclick = () => alert(formula || 'Données insuffisantes pour le calcul.');
    };

    if (!currentCommune) {
        document.getElementById('suivi-bingo-base').innerHTML = '-- kg';
        document.getElementById('suivi-bingo-pelic').innerHTML = '-- kg';
        document.querySelectorAll('#suivi-rotation-results-container .value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
        document.getElementById('suivi-heure-sur-feu').textContent = '--:--';
        const suiviDureeTransitNoCommune = document.getElementById('suivi-duree-transit'); if (suiviDureeTransitNoCommune) suiviDureeTransitNoCommune.textContent = '--:--';
        const suiviFuelSurFeuNoCommune = document.getElementById('suivi-fuel-sur-feu'); if (suiviFuelSurFeuNoCommune) suiviFuelSurFeuNoCommune.textContent = '-- kg';
        document.getElementById('suivi-cs-sur-feu').textContent = '--:--';
        const suiviHeureHelpIcon = document.getElementById('suivi-heure-sur-feu-help');
        if (suiviHeureHelpIcon) { suiviHeureHelpIcon.onclick = () => alert('Données insuffisantes pour le calcul.'); }
        setSuiviHelp('suivi-duree-transit-help');
        setSuiviHelp('suivi-fuel-sur-feu-help');
        setSuiviHelp('suivi-duree-rotation-help');
        setSuiviHelp('suivi-conso-rotation-help');
        suiviConsoInput.value = '';
        suiviDureeInput.value = '';
        return;
    }
    const bingoBase = calculateBingo(CALCULATOR_DATA.distBaseFeu);
    const bingoPelic = calculateBingo(CALCULATOR_DATA.distPelicFeu);
    const bingoBaseDisplay = document.getElementById('suivi-bingo-base');
    if (bingoBase === 700) { bingoBaseDisplay.innerHTML = '-- kg'; } else { bingoBaseDisplay.innerHTML = `${selectedBaseOACI} / ${CALCULATOR_DATA.distBaseFeu} Nm /&nbsp;<b>${bingoBase} kg</b>`; }
    const bingoPelicDisplay = document.getElementById('suivi-bingo-pelic');
    if (bingoPelic === 700 || !selectedPelicanOACI) { bingoPelicDisplay.innerHTML = '-- kg'; } else { bingoPelicDisplay.innerHTML = `${selectedPelicanOACI} / ${CALCULATOR_DATA.distPelicFeu} Nm /&nbsp;<b>${bingoPelic} kg</b>`; }

    if (!isSuiviConsoManual) {
        const previConso = document.getElementById('conso-par-rotation').textContent;
        suiviConsoInput.value = previConso.includes('--') ? '' : previConso;
    }
    if (!isSuiviDureeManual) {
        const previDuree = document.getElementById('duree-rotation').textContent;
        suiviDureeInput.value = previDuree.includes('--') ? '' : previDuree;
    }

    const allRows = Array.from(document.querySelectorAll('#bloc-fuel tbody tr'));
    const firstRow = allRows[0] || null;
    const firstRowRltWrapper = firstRow?.querySelector('.rlt-mass-input-wrapper') || null;
    const isFirstRowFullDeparture = !!firstRowRltWrapper && (
        firstRowRltWrapper.dataset.rltFirstFull === '1'
        || firstRowRltWrapper.dataset.rltMode === 'firstFull'
    );

    const getRowTime = row => parseTime(row?.querySelector('.time-input-wrapper .display-input')?.value || '');
    const getRowFuel = row => parseNumeric(row?.querySelector('.numeric-input-wrapper .display-input')?.value || '');
    const getRowOaci = row => {
        const datasetOaci = String(row?.dataset?.airportOaci || '').trim().toUpperCase();
        if (datasetOaci) return datasetOaci;
        const cellText = String(row?.querySelector('.airport-oaci-cell')?.textContent || '').replace('--', '').trim().toUpperCase();
        return cellText || '';
    };
    const getDistanceFromOaciToFire = oaci => {
        if (!currentCommune || !oaci) return null;
        const airport = getAirportByOaci(oaci);
        if (!airport) return null;
        const { latitude_mairie: feuLat, longitude_mairie: feuLon } = currentCommune;
        return Math.round(calculateDistanceInNm(airport.lat, airport.lon, feuLat, feuLon));
    };

    /*
     * v16.96 — l'OACI affiché avec BLOC DÉPART est déjà figé et persistant
     * (`bloc-depart-oaci`). Il devient l'origine géographique du premier transit.
     * La BASE sélectionnée reste uniquement une destination de retour/BINGO.
     */
    const blocDepartWrapperForTransit = document.getElementById('bloc-depart');
    const lockedBlocDepartOaci = String(
        blocDepartWrapperForTransit?.dataset?.airportOaci || ''
    ).trim().toUpperCase();

    let lastFilledRow = null;
    allRows.forEach(row => {
        if (getRowTime(row) !== null || getRowFuel(row) !== null) {
            lastFilledRow = row;
        }
    });

    const blocDepartTime = parseTime(document.getElementById('bloc-depart')?.querySelector('.display-input')?.value || '');
    const fuelDepart = parseNumeric(document.getElementById('fuel-depart')?.querySelector('.display-input')?.value || '');
    const rltDepartMass = parseNumeric(document.getElementById('rlt-depart')?.querySelector('.display-input')?.value || '');
    const firstTransitAlreadyLoaded = rltDepartMass !== null && rltDepartMass > 0;
    const limiteHdvDepart = (typeof getEffectiveLimitHdvForActiveFlight === 'function')
        ? getEffectiveLimitHdvForActiveFlight()
        : parseTime(document.getElementById('limite-hdv')?.querySelector('.display-input')?.value || '');

    let currentFuel = null;
    let currentTime = null;
    let currentHdv = null;
    let transitDistanceVersFeu = null;
    let transitEffectiveDistanceVersFeu = null;
    let transitConsoDistanceVersFeu = null;
    let preTransitForfaitMin = 0;
    let preTransitForfaitReason = '';
    let transitSourceLabel = '';
    let transitSourceDetail = '';

    const isKnownPelicOaci = (oaci) => {
        const normalized = String(oaci || '').trim().toUpperCase();
        if (!normalized) return false;
        if (normalized === selectedPelicanOACI) return true;
        return [...pelicanAirports, ...otherAirports].some(ap => {
            if (ap.oaci !== normalized) return false;
            return pelicanAirports.includes(ap) || customPelicanAirports.has(ap.oaci);
        });
    };

    const setTransitDistancePolicy = ({ measuredDistance, usePelicMinimum = false }) => {
        if (!Number.isFinite(measuredDistance)) {
            transitDistanceVersFeu = null;
            transitEffectiveDistanceVersFeu = null;
            transitConsoDistanceVersFeu = null;
            return;
        }
        transitDistanceVersFeu = measuredDistance;
        transitEffectiveDistanceVersFeu = usePelicMinimum ? Math.max(measuredDistance, 10) : measuredDistance;
        transitConsoDistanceVersFeu = measuredDistance;
    };

    if (lastFilledRow) {
        currentFuel = getRowFuel(lastFilledRow);
        currentTime = getRowTime(lastFilledRow);
        preTransitForfaitMin = RETARDANT_LOADING_FORFAIT_MIN;
        preTransitForfaitReason = `Forfait plein retardant appliqué après la dernière ligne BLOC/FUEL renseignée.`;

        if (lastFilledRow === firstRow && isFirstRowFullDeparture) {
            const firstRowOaci = getRowOaci(firstRow);
            const firstRowDistance = getDistanceFromOaciToFire(firstRowOaci);
            setTransitDistancePolicy({ measuredDistance: firstRowDistance, usePelicMinimum: isKnownPelicOaci(firstRowOaci) });
            currentHdv = limiteHdvDepart;
            transitSourceLabel = firstRowOaci ? `1re ligne Plein au départ (${firstRowOaci})` : '1re ligne Plein au départ — OACI non renseigné';
            transitSourceDetail = `Terrain départ retenu : 1re ligne BLOC/FUEL en mode Plein au départ`;

        } else {
            currentHdv = parseTime(lastFilledRow.querySelector('.tps-vol-restant-cell')?.textContent || '');
            const hasSelectedPelicForSuivi = !!selectedPelicanOACI && Number.isFinite(CALCULATOR_DATA.distPelicFeu);
            setTransitDistancePolicy({ measuredDistance: hasSelectedPelicForSuivi ? CALCULATOR_DATA.distPelicFeu : null, usePelicMinimum: true });
            transitSourceLabel = selectedPelicanOACI ? `Pélic sélectionné (${selectedPelicanOACI})` : 'Pélic sélectionné non renseigné';
            transitSourceDetail = `Terrain départ retenu : pélicandrome sélectionné après la dernière ligne BLOC/FUEL`;
        }
    } else {
        currentFuel = fuelDepart;
        currentTime = blocDepartTime;
        currentHdv = limiteHdvDepart;
        preTransitForfaitMin = firstTransitAlreadyLoaded ? 0 : RETARDANT_LOADING_FORFAIT_MIN;
        preTransitForfaitReason = firstTransitAlreadyLoaded
            ? `Premier transit sans forfait : le champ RLT Départ de l’en-tête contient ${rltDepartMass} kg.`
            : `Premier transit avec forfait plein retardant de ${RETARDANT_LOADING_FORFAIT_MIN} min : le champ RLT Départ est vide.`;
        const blocDepartOaciForTransit = blocDepartTime !== null
            ? lockedBlocDepartOaci
            : '';
        const blocDepartDistance = getDistanceFromOaciToFire(blocDepartOaciForTransit);

        setTransitDistancePolicy({
            measuredDistance: Number.isFinite(blocDepartDistance) ? blocDepartDistance : null,
            usePelicMinimum: false
        });

        transitSourceLabel = blocDepartOaciForTransit
            ? `BLOC DÉPART (${blocDepartOaciForTransit})`
            : 'BLOC DÉPART — OACI non renseigné';
        transitSourceDetail = blocDepartOaciForTransit
            ? `Terrain départ retenu : OACI mémorisé au BLOC DÉPART (${blocDepartOaciForTransit})`
            : `Terrain départ indisponible : aucun OACI mémorisé au BLOC DÉPART`;
    }

    const fuelCalculationStartsAtPelic = !!(
        lastFilledRow
        && !(lastFilledRow === firstRow && isFirstRowFullDeparture)
        && selectedPelicanOACI
        && currentFuel !== null
    );

    const consoRotation = parseNumeric(suiviConsoInput.value);
    const rotationTime = parseTime(suiviDureeInput.value);
    const csFeuTime = parseTime(CALCULATOR_DATA.csFeu);
    const tmdTime = parseTime(document.getElementById('tmd').querySelector('.display-input').value);
    const transitTimeVersFeu = Number.isFinite(transitEffectiveDistanceVersFeu) ? Math.round(calculateTransitTime(transitEffectiveDistanceVersFeu)) : null;
    const consoTransitVersFeu = Number.isFinite(transitConsoDistanceVersFeu) ? calculateFuelToGo(transitConsoDistanceVersFeu) : null;
    const tempsAvantFeu = (transitTimeVersFeu !== null) ? preTransitForfaitMin + transitTimeVersFeu : null;
    const heureSurFeu = (currentTime !== null && tempsAvantFeu !== null) ? currentTime + tempsAvantFeu : null;
    const fuelSurFeu = (currentFuel !== null && consoTransitVersFeu !== null) ? currentFuel - consoTransitVersFeu : currentFuel;

    const transitSpeedKt = Number.isFinite(transitEffectiveDistanceVersFeu)
        ? (transitEffectiveDistanceVersFeu <= 70 ? 210 : 240)
        : null;
    const transitConsoRate = Number.isFinite(transitConsoDistanceVersFeu)
        ? (transitConsoDistanceVersFeu <= 70 ? 5 : 4)
        : null;
    const rotationDistanceRetained = Number.isFinite(CALCULATOR_DATA.distPelicFeu)
        ? Math.max(CALCULATOR_DATA.distPelicFeu, 10)
        : null;
    const rotationSpeedNmMin = Number.isFinite(rotationDistanceRetained)
        ? (rotationDistanceRetained <= 50 ? 3.5 : 4)
        : null;
    const rotationConsoRate = Number.isFinite(rotationDistanceRetained)
        ? (rotationDistanceRetained <= 70 ? 10 : 8)
        : null;

    setSuiviHelp('suivi-duree-transit-help', transitTimeVersFeu !== null
        ? `DURÉE TRANSIT SOURCE → FEU — SUIVI LARGAGES

${transitSourceDetail}
Source utilisée : ${transitSourceLabel}

Distance mesurée : ${Number.isFinite(transitDistanceVersFeu) ? transitDistanceVersFeu : 'N/A'} Nm
Distance retenue pour la durée : ${Number.isFinite(transitEffectiveDistanceVersFeu) ? transitEffectiveDistanceVersFeu : 'N/A'} Nm
Règle vitesse : ≤ 70 Nm = 210 kt ; > 70 Nm = 240 kt
Vitesse retenue : ${transitSpeedKt ?? 'N/A'} kt

Calcul : ${Number.isFinite(transitEffectiveDistanceVersFeu) ? transitEffectiveDistanceVersFeu : 'N/A'} × (60 / ${transitSpeedKt ?? 'N/A'}) = ${formatTime(transitTimeVersFeu)} (${transitTimeVersFeu} min)

La valeur affichée correspond uniquement au temps de vol source → feu.
Forfait plein retardant avant transit : ${preTransitForfaitMin} min, intégré à « Heure sur Feu » mais pas à la durée affichée.
${preTransitForfaitReason}`
        : 'Distance vers le feu indisponible. Vérifiez le terrain de départ, le pélicandrome sélectionné et le feu.');

    setSuiviHelp('suivi-fuel-sur-feu-help', fuelSurFeu !== null && currentFuel !== null && consoTransitVersFeu !== null
        ? `FUEL SUR FEU — SUIVI LARGAGES

Formule : Fuel retenu au départ du transit - Conso transit vers le feu

${transitSourceDetail}
Source utilisée : ${transitSourceLabel}
Fuel retenu au départ du transit : ${currentFuel} kg
Distance retenue pour la consommation : ${Number.isFinite(transitConsoDistanceVersFeu) ? transitConsoDistanceVersFeu : 'N/A'} Nm
Règle consommation : ≤ 70 Nm = 5 kg/Nm ; > 70 Nm = 4 kg/Nm
Taux retenu : ${transitConsoRate ?? 'N/A'} kg/Nm
Conso transit : ${consoTransitVersFeu} kg

Calcul : ${currentFuel} - ${consoTransitVersFeu} = ${fuelSurFeu} kg

Le forfait avant transit de ${preTransitForfaitMin} min n'ajoute pas de consommation forfaitaire dans ce calcul.`
        : 'Fuel de départ du transit ou distance vers le feu indisponible.');

    setSuiviHelp('suivi-duree-rotation-help', rotationDistanceRetained !== null && rotationTime !== null
        ? `DURÉE ROTATION FEU ↔ PÉLIC — SUIVI LARGAGES

Mode actuel : ${isSuiviDureeManual ? 'MANUEL' : 'AUTO'}
Valeur utilisée : ${formatTime(rotationTime) || 'N/A'}${rotationTime !== null ? ` (${rotationTime} min)` : ''}

Référence du mode AUTO :
20 min + ((Distance retenue × 2) / Vitesse)

Pélic sélectionné : ${selectedPelicanOACI || 'N/A'}
Distance Feu → Pélic mesurée : ${Number.isFinite(CALCULATOR_DATA.distPelicFeu) ? CALCULATOR_DATA.distPelicFeu : 'N/A'} Nm
Distance retenue : ${rotationDistanceRetained} Nm, avec un minimum de 10 Nm
Vitesse retenue : ${rotationSpeedNmMin} Nm/min (${rotationSpeedNmMin === 3.5 ? 210 : 240} kt)
Calcul AUTO : 20 + ((${rotationDistanceRetained} × 2) / ${rotationSpeedNmMin}) = ${formatTime(Math.round(calculateRotationTime(CALCULATOR_DATA.distPelicFeu)))}

${isSuiviDureeManual ? 'La valeur manuelle remplace actuellement le calcul AUTO dans le nombre de rotations.' : 'La valeur AUTO est utilisée dans le nombre de rotations.'}`
        : 'Sélectionnez un pélicandrome et renseignez une durée de rotation exploitable.');

    setSuiviHelp('suivi-conso-rotation-help', rotationDistanceRetained !== null && consoRotation !== null
        ? `CONSO ROTATION FEU ↔ PÉLIC — SUIVI LARGAGES

Mode actuel : ${isSuiviConsoManual ? 'MANUEL' : 'AUTO'}
Valeur utilisée : ${consoRotation} kg

Référence du mode AUTO :
(Distance retenue × conso aller-retour) + forfait largage

Pélic sélectionné : ${selectedPelicanOACI || 'N/A'}
Distance Feu → Pélic mesurée : ${Number.isFinite(CALCULATOR_DATA.distPelicFeu) ? CALCULATOR_DATA.distPelicFeu : 'N/A'} Nm
Distance retenue : ${rotationDistanceRetained} Nm, avec un minimum de 10 Nm
Conso aller-retour retenue : ${rotationConsoRate} kg/Nm
Forfait largage : 250 kg
Calcul AUTO : (${rotationDistanceRetained} × ${rotationConsoRate}) + 250 = ${calculateConsoRotation(CALCULATOR_DATA.distPelicFeu)} kg

${isSuiviConsoManual ? 'La valeur manuelle remplace actuellement le calcul AUTO dans le nombre de rotations.' : 'La valeur AUTO est utilisée dans le nombre de rotations.'}`
        : 'Sélectionnez un pélicandrome et renseignez une consommation de rotation exploitable.');

    if (currentFuel === null && currentTime === null) {
        document.getElementById('suivi-fuel-actuel').textContent = '-- kg';
        document.getElementById('suivi-heure-sur-feu').textContent = '--:--';
        document.getElementById('suivi-cs-sur-feu').textContent = '--:--';
        const suiviDureeTransitEl = document.getElementById('suivi-duree-transit'); if (suiviDureeTransitEl) suiviDureeTransitEl.textContent = '--:--';
        const suiviFuelSurFeuEl = document.getElementById('suivi-fuel-sur-feu'); if (suiviFuelSurFeuEl) suiviFuelSurFeuEl.textContent = '-- kg';
        const suiviHeureHelpIcon = document.getElementById('suivi-heure-sur-feu-help');
        if (suiviHeureHelpIcon) { suiviHeureHelpIcon.onclick = () => alert('Données insuffisantes pour calculer l’heure sur feu.'); }
        document.querySelectorAll('#suivi-rotation-results-container .value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
    } else {
        document.getElementById('suivi-fuel-actuel').textContent = currentFuel !== null ? `${currentFuel} kg` : '--';
        document.getElementById('suivi-heure-sur-feu').textContent = formatTime(heureSurFeu) || '--:--';
        document.getElementById('suivi-cs-sur-feu').textContent = CALCULATOR_DATA.csFeu;
        const suiviDureeTransitEl = document.getElementById('suivi-duree-transit'); if (suiviDureeTransitEl) suiviDureeTransitEl.textContent = transitTimeVersFeu !== null ? (formatTime(transitTimeVersFeu) || '--:--') : '--:--';
        const suiviFuelSurFeuEl = document.getElementById('suivi-fuel-sur-feu'); if (suiviFuelSurFeuEl) suiviFuelSurFeuEl.textContent = fuelSurFeu !== null ? `${fuelSurFeu} kg` : '-- kg';
        const suiviHeureHelpIcon = document.getElementById('suivi-heure-sur-feu-help');
        if (suiviHeureHelpIcon) {
            suiviHeureHelpIcon.onclick = () => alert(`HEURE SUR FEU — SUIVI LARGAGES

Règle v14.47 :
- premier transit : BLOC DÉPART + 10 min plein retardant + transit vers le feu ;
- exception au premier transit : si le champ RLT Départ de l’en-tête BLOC/FUEL contient une masse, le forfait de 10 min n'est pas ajouté ;
- les cellules Masse RLT des lignes du tableau ne commandent jamais cette exception ;
- après chaque ligne BLOC/FUEL : heure de la ligne + 10 min plein retardant + transit vers le feu ;
- les 10 min avant validation du largage restent ensuite appliquées séparément.

${transitSourceDetail}
Source utilisée : ${transitSourceLabel}
Heure départ retenue : ${formatTime(currentTime) || 'N/A'}
Forfait plein retardant : ${preTransitForfaitMin} min
${preTransitForfaitReason}
Distance source → Feu mesurée : ${Number.isFinite(transitDistanceVersFeu) ? transitDistanceVersFeu : 'N/A'} Nm
Distance transit retenue : ${Number.isFinite(transitEffectiveDistanceVersFeu) ? transitEffectiveDistanceVersFeu : 'N/A'} Nm
Règle vitesse : ≤70 Nm = 210 kt, >70 Nm = 240 kt
Durée transit : ${transitTimeVersFeu !== null ? `${formatTime(transitTimeVersFeu)} (${transitTimeVersFeu} min)` : 'N/A'}
Conso transit : ${consoTransitVersFeu !== null ? `${consoTransitVersFeu} kg` : 'N/A'}
Fuel sur feu retenu : ${fuelSurFeu !== null ? `${fuelSurFeu} kg` : 'N/A'}

Calcul heure sur feu : ${formatTime(currentTime) || 'N/A'} + ${preTransitForfaitMin} min + ${transitTimeVersFeu !== null ? formatTime(transitTimeVersFeu) : 'N/A'} = ${formatTime(heureSurFeu) || 'N/A'}

Validation du largage : Heure sur feu + 10 min avant CS/TMD/HDV.`);
        }
        updateAndSortRotations(
            document.getElementById('suivi-rotation-results-container'),
            { fuel: fuelSurFeu, time: heureSurFeu },
            {
                bingoBase,
                bingoPelic,
                consoRotation,
                rotationTime,
                csFeuTime,
                tmdTime,
                limiteHDV: currentHdv,
                transitTime: tempsAvantFeu,
                rawTransitTime: transitTimeVersFeu,
                preTransitForfaitMin,
                effectiveTransitDistance: transitEffectiveDistanceVersFeu,
                transitSourceLabel,
                currentTimeLabel: 'Heure sur feu',
                firstDropForfaitMin: 10,
                pelicFuelMode: fuelCalculationStartsAtPelic ? 'pelic-departure' : 'inbound-fire',
                pelicDepartureFuel: fuelCalculationStartsAtPelic ? currentFuel : null
            }
        );
    }
}

function updateDeroutementTab() {
    if (typeof updateDeroutementGpsStatus === 'function') {
        updateDeroutementGpsStatus();
    }
    const resultsContainer = document.getElementById('derout-rotation-results-container');
    const setHelp = (id, formula) => {
        const icon = document.getElementById(id);
        if (icon) { icon.onclick = () => alert(formula || "Données insuffisantes pour le calcul."); }
    };
    const isEmptyRetardant = document.getElementById('derout-empty-retardant-checkbox')?.checked === true;
    const deroutEmptyModeState = isEmptyRetardant
        ? 'COCHÉE — trajet initial GPS → Pélic → Feu, avec 10 min au pélicandrome'
        : 'NON COCHÉE — trajet initial direct GPS → Feu';
    const deroutModeImpactText = isEmptyRetardant
        ? 'La case modifie le trajet initial vers le feu. Elle ne modifie pas la durée ni la consommation des rotations suivantes Feu ↔ Pélic.'
        : 'Le trajet initial est direct vers le feu. La durée et la consommation de rotation concernent ensuite les rotations Feu ↔ Pélic.';

    const deroutFuelMiniPelicLabel = document.getElementById('derout-fuel-mini-pelic-label');
    if (deroutFuelMiniPelicLabel) {
        const selectedPelic = selectedPelicanOACI ? getAirportByOaci(selectedPelicanOACI) : null;
        const pelicCode = selectedPelic ? selectedPelic.oaci : 'PÉLIC';
        deroutFuelMiniPelicLabel.textContent = `Fuel mini 1 Lrg / Pélic (${pelicCode}) :`;
    }

    if (!currentCommune) {
        document.getElementById('derout-bingo-base').innerHTML = '-- kg';
        document.getElementById('derout-bingo-pelic').innerHTML = '-- kg';
        resultsContainer.querySelectorAll('.value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
        document.getElementById('derout-fuel-mini-base').textContent = '-- kg';
        document.getElementById('derout-fuel-mini-pelic').textContent = '-- kg';
        document.getElementById('derout-heure-sur-feu').textContent = '--:--';
        const deroutDureeRotationEmpty = document.getElementById('derout-duree-rotation');
        if (deroutDureeRotationEmpty) deroutDureeRotationEmpty.textContent = '--:--';
        const deroutConsoRotationEmpty = document.getElementById('derout-conso-rotation');
        if (deroutConsoRotationEmpty) deroutConsoRotationEmpty.textContent = '-- kg';
        document.getElementById('derout-cs-sur-feu').textContent = '--:--';
        setHelp('derout-duree-rotation-help', `DURÉE ROTATION — DÉROUT. / GAAR

Case « Retour Pélic avant feu » : ${deroutEmptyModeState}
${deroutModeImpactText}

Sélectionnez un feu pour afficher le calcul détaillé.`);
        setHelp('derout-conso-rotation-help', `CONSO ROTATION — DÉROUT. / GAAR

Case « Retour Pélic avant feu » : ${deroutEmptyModeState}
${deroutModeImpactText}

Sélectionnez un feu pour afficher le calcul détaillé.`);
        setHelp('derout-fuel-mini-base-help', `Case « Retour Pélic avant feu » : ${deroutEmptyModeState}

Sélectionnez un feu pour afficher le calcul détaillé.`);
        setHelp('derout-fuel-mini-pelic-help', `Case « Retour Pélic avant feu » : ${deroutEmptyModeState}

Sélectionnez un feu pour afficher le calcul détaillé.`);
        setHelp('derout-heure-sur-feu-help', `Case « Retour Pélic avant feu » : ${deroutEmptyModeState}

Sélectionnez un feu pour afficher le calcul détaillé.`);
        return;
    }

    const fuelActuel = parseNumeric(document.getElementById('deroutement-fuel-wrapper').querySelector('.display-input').value);
    const heureActuelle = parseTime(document.getElementById('deroutement-heure-wrapper').querySelector('.display-input').value);

    const bingoBase = calculateBingo(CALCULATOR_DATA.distBaseFeu);
    const bingoPelic = calculateBingo(CALCULATOR_DATA.distPelicFeu);
    const rotationTime = Math.round(calculateRotationTime(CALCULATOR_DATA.distPelicFeu));
    const consoRotation = calculateConsoRotation(CALCULATOR_DATA.distPelicFeu);
    const deroutDureeRotationDisplay = document.getElementById('derout-duree-rotation');
    if (deroutDureeRotationDisplay) {
        deroutDureeRotationDisplay.textContent = (rotationTime === 20 || !selectedPelicanOACI) ? '--:--' : formatTime(rotationTime);
    }
    const deroutConsoRotationDisplay = document.getElementById('derout-conso-rotation');
    if (deroutConsoRotationDisplay) {
        deroutConsoRotationDisplay.textContent = (consoRotation === 250 || !selectedPelicanOACI) ? '-- kg' : `${consoRotation} kg`;
    }

    const deroutRotationDistance = Number.isFinite(CALCULATOR_DATA.distPelicFeu)
        ? Math.max(CALCULATOR_DATA.distPelicFeu, 10)
        : null;
    const deroutRotationSpeedNmMin = deroutRotationDistance !== null
        ? (deroutRotationDistance <= 50 ? 3.5 : 4)
        : null;
    const deroutRotationConsoRate = deroutRotationDistance !== null
        ? (deroutRotationDistance <= 70 ? 10 : 8)
        : null;

    setHelp('derout-duree-rotation-help', selectedPelicanOACI && deroutRotationDistance !== null
        ? `DURÉE ROTATION FEU ↔ PÉLIC — DÉROUT. / GAAR

Case « Retour Pélic avant feu » : ${deroutEmptyModeState}
${deroutModeImpactText}

Pélic sélectionné : ${selectedPelicanOACI}
Distance Feu → Pélic mesurée : ${CALCULATOR_DATA.distPelicFeu} Nm
Distance retenue : ${deroutRotationDistance} Nm, avec un minimum de 10 Nm
Règle vitesse : ≤ 50 Nm = 3,5 Nm/min (210 kt) ; > 50 Nm = 4 Nm/min (240 kt)
Vitesse retenue : ${deroutRotationSpeedNmMin} Nm/min
Forfait rotation : 20 min

Calcul : 20 + ((${deroutRotationDistance} × 2) / ${deroutRotationSpeedNmMin}) = ${formatTime(rotationTime)} (${rotationTime} min)`
        : `DURÉE ROTATION — DÉROUT. / GAAR

Case « Retour Pélic avant feu » : ${deroutEmptyModeState}
${deroutModeImpactText}

Sélectionnez un pélicandrome pour calculer la durée de rotation.`);

    setHelp('derout-conso-rotation-help', selectedPelicanOACI && deroutRotationDistance !== null
        ? `CONSO ROTATION FEU ↔ PÉLIC — DÉROUT. / GAAR

Case « Retour Pélic avant feu » : ${deroutEmptyModeState}
${deroutModeImpactText}

Pélic sélectionné : ${selectedPelicanOACI}
Distance Feu → Pélic mesurée : ${CALCULATOR_DATA.distPelicFeu} Nm
Distance retenue : ${deroutRotationDistance} Nm, avec un minimum de 10 Nm
Règle consommation aller-retour : ≤ 70 Nm = 10 kg/Nm ; > 70 Nm = 8 kg/Nm
Taux retenu : ${deroutRotationConsoRate} kg/Nm
Forfait largage : 250 kg

Calcul : (${deroutRotationDistance} × ${deroutRotationConsoRate}) + 250 = ${consoRotation} kg`
        : `CONSO ROTATION — DÉROUT. / GAAR

Case « Retour Pélic avant feu » : ${deroutEmptyModeState}
${deroutModeImpactText}

Sélectionnez un pélicandrome pour calculer la consommation de rotation.`);

    const csFeuTime = parseTime(CALCULATOR_DATA.csFeu);
    const tmdTime = parseTime(document.getElementById('tmd').querySelector('.display-input').value);
    const limiteHDV = parseTime(document.getElementById('limite-hdv').querySelector('.display-input').value);
    const markerLatLng = (userMarker && typeof userMarker.getLatLng === 'function') ? userMarker.getLatLng() : null;
    const lastGpsLat = lastPosition ? Number(lastPosition.lat ?? lastPosition.latitude) : NaN;
    const lastGpsLng = lastPosition ? Number(lastPosition.lng ?? lastPosition.longitude) : NaN;
    const userLatLng = (markerLatLng && Number.isFinite(markerLatLng.lat) && Number.isFinite(markerLatLng.lng))
        ? markerLatLng
        : (Number.isFinite(lastGpsLat) && Number.isFinite(lastGpsLng) ? { lat: lastGpsLat, lng: lastGpsLng } : null);
    const hasGpsPosition = !!userLatLng;
    const selectedPelicForDeroutement = selectedPelicanOACI ? getAirportByOaci(selectedPelicanOACI) : null;
    const distGpsFeu = (hasGpsPosition && currentCommune)
        ? Math.round(calculateDistanceInNm(userLatLng.lat, userLatLng.lng, currentCommune.latitude_mairie, currentCommune.longitude_mairie))
        : null;
    const distGpsPelic = (hasGpsPosition && selectedPelicForDeroutement)
        ? Math.round(calculateDistanceInNm(userLatLng.lat, userLatLng.lng, selectedPelicForDeroutement.lat, selectedPelicForDeroutement.lon))
        : null;
    const distFirstPelicFeu = selectedPelicForDeroutement ? CALCULATOR_DATA.distPelicFeu : null;

    const firstLegDistance = (isEmptyRetardant && distGpsPelic !== null && distFirstPelicFeu !== null)
        ? distGpsPelic + distFirstPelicFeu
        : distGpsFeu;

    const transitTimeFromGps = firstLegDistance !== null
        ? (
            isEmptyRetardant
                ? Math.round(calculateTransitTime(distGpsPelic)) + 10 + Math.round(calculateTransitTime(distFirstPelicFeu))
                : Math.round(calculateTransitTime(distGpsFeu))
        )
        : null;

    const consoTransitFromGps = firstLegDistance !== null
        ? (
            isEmptyRetardant
                ? calculateFuelToGo(distGpsPelic) + calculateFuelToGo(distFirstPelicFeu)
                : calculateFuelToGo(distGpsFeu)
        )
        : null;

    const bingoBaseDisplay = document.getElementById('derout-bingo-base');
    if (bingoBase === 700) { bingoBaseDisplay.innerHTML = '-- kg'; } else { bingoBaseDisplay.innerHTML = `${selectedBaseOACI} / ${CALCULATOR_DATA.distBaseFeu} Nm /&nbsp;<b>${bingoBase} kg</b>`; }
    const bingoPelicDisplay = document.getElementById('derout-bingo-pelic');
    if (bingoPelic === 700 || !selectedPelicanOACI) { bingoPelicDisplay.innerHTML = '-- kg'; } else { bingoPelicDisplay.innerHTML = `${selectedPelicanOACI} / ${CALCULATOR_DATA.distPelicFeu} Nm /&nbsp;<b>${bingoPelic} kg</b>`; }

    const fuelMiniBase = consoTransitFromGps !== null ? consoTransitFromGps + 250 + bingoBase : null;
    const fuelMiniPelic = consoTransitFromGps !== null ? consoTransitFromGps + 250 + bingoPelic : null;
    document.getElementById('derout-fuel-mini-base').textContent = fuelMiniBase !== null ? `${fuelMiniBase} kg` : '-- kg';
    document.getElementById('derout-fuel-mini-pelic').textContent = fuelMiniPelic !== null ? `${fuelMiniPelic} kg` : '-- kg';
    const deroutFirstLegLabel = isEmptyRetardant
        ? `GPS → Pélic (${selectedPelicForDeroutement ? selectedPelicForDeroutement.oaci : 'PÉLIC'}) → Feu`
        : 'GPS → Feu';
    const deroutFirstLegDetail = isEmptyRetardant
        ? `Distance GPS → Pélic : ${distGpsPelic ?? 'N/A'} Nm\nDistance Pélic → Feu : ${distFirstPelicFeu ?? 'N/A'} Nm\nForfait sol Pélic : 10 min`
        : `Distance GPS → Feu : ${distGpsFeu ?? 'N/A'} Nm`;

    setHelp('derout-fuel-mini-base-help', consoTransitFromGps !== null
        ? `FUEL MINI 1 LRG / BASE\n\nCase « Retour Pélic avant feu » : ${deroutEmptyModeState}\n${deroutModeImpactText}\n\nFormule : Conso ${deroutFirstLegLabel} + forfait largage + BINGO Base\n\n${deroutFirstLegDetail}\n\nRègle conso transit :\n- Distance ≤ 70 Nm : 5 kg/Nm\n- Distance > 70 Nm : 4 kg/Nm\n\nForfait largage : 250 kg\n\nBINGO Base :\n700 kg + conso Feu → Base = ${bingoBase} kg\n\nCalcul : ${consoTransitFromGps} + 250 + ${bingoBase} = ${fuelMiniBase} kg`
        : (isEmptyRetardant && !selectedPelicForDeroutement)
            ? 'Sélectionnez un pélicandrome pour le mode “vide retardant”.'
            : 'Distance GPS indisponible. Utilisez “🛰️ Rafraîchir GPS”.');
    setHelp('derout-fuel-mini-pelic-help', consoTransitFromGps !== null
        ? `FUEL MINI 1 LRG / PÉLIC\n\nCase « Retour Pélic avant feu » : ${deroutEmptyModeState}\n${deroutModeImpactText}\n\nFormule : Conso ${deroutFirstLegLabel} + forfait largage + BINGO Pélic\n\n${deroutFirstLegDetail}\n\nRègle conso transit :\n- Distance ≤ 70 Nm : 5 kg/Nm\n- Distance > 70 Nm : 4 kg/Nm\n\nForfait largage : 250 kg\n\nBINGO Pélic :\n700 kg + conso Feu → Pélic = ${bingoPelic} kg\n\nCalcul : ${consoTransitFromGps} + 250 + ${bingoPelic} = ${fuelMiniPelic} kg`
        : (isEmptyRetardant && !selectedPelicForDeroutement)
            ? 'Sélectionnez un pélicandrome pour le mode “vide retardant”.'
            : 'Distance GPS indisponible. Utilisez “🛰️ Rafraîchir GPS”.');

    const heureSurFeu = (heureActuelle !== null && transitTimeFromGps !== null) ? heureActuelle + transitTimeFromGps : null;
    document.getElementById('derout-heure-sur-feu').textContent = formatTime(heureSurFeu) || '--:--';
    document.getElementById('derout-cs-sur-feu').textContent = CALCULATOR_DATA.csFeu;
    setHelp('derout-heure-sur-feu-help', transitTimeFromGps !== null
        ? `HEURE SUR FEU — DÉROUTEMENT\n\nCase « Retour Pélic avant feu » : ${deroutEmptyModeState}\n${deroutModeImpactText}\n\nFormule : Heure actuelle + Durée ${deroutFirstLegLabel}\n\n${deroutFirstLegDetail}\n\nRègle vitesse :\n- Distance ≤ 70 Nm : 210 kt\n- Distance > 70 Nm : 240 kt\n\nHeure actuelle : ${formatTime(heureActuelle) || 'N/A'}\nDurée ${deroutFirstLegLabel} : ${formatTime(transitTimeFromGps) || 'N/A'} (${transitTimeFromGps} min)\n\nCalcul : ${formatTime(heureActuelle) || 'N/A'} + ${formatTime(transitTimeFromGps) || 'N/A'} = ${formatTime(heureSurFeu) || 'N/A'}`
        : (isEmptyRetardant && !selectedPelicForDeroutement)
            ? 'Sélectionnez un pélicandrome pour le mode “vide retardant”.'
            : 'Distance GPS indisponible. Utilisez “🛰️ Rafraîchir GPS”.');

    if (fuelActuel === null || heureActuelle === null || consoTransitFromGps === null || transitTimeFromGps === null || (isEmptyRetardant && !selectedPelicForDeroutement)) {
        resultsContainer.querySelectorAll('.value').forEach(el => { el.textContent = '--'; el.className = 'value rotation-value-default'; });
        resultsContainer.querySelectorAll('.formula-help-icon').forEach(icon => icon.onclick = () => alert(
            isEmptyRetardant && !selectedPelicForDeroutement
                ? 'Mode vide retardant : sélectionnez un pélicandrome.'
                : "Données insuffisantes pour le calcul."
        ));
        return;
    }

    const fuelSurFeu = fuelActuel - consoTransitFromGps;
    const fuelAtPelicBeforeFire = (
        isEmptyRetardant
        && fuelActuel !== null
        && Number.isFinite(distGpsPelic)
    ) ? fuelActuel - calculateFuelToGo(distGpsPelic) : null;

    updateAndSortRotations(
        resultsContainer,
        { fuel: fuelSurFeu, time: heureSurFeu },
        {
            bingoBase,
            bingoPelic,
            consoRotation,
            rotationTime,
            csFeuTime,
            tmdTime,
            limiteHDV,
            transitTime: transitTimeFromGps,
            consoTransitFromGps: consoTransitFromGps,
            pelicFuelMode: isEmptyRetardant ? 'pelic-departure' : 'inbound-fire',
            pelicDepartureFuel: isEmptyRetardant ? fuelAtPelicBeforeFire : null
        }
    );
}

