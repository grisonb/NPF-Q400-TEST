// =========================================================================
// v13.01 — réglages calque trafic ADS-B
// =========================================================================
function sanitizeTrafficSettings(candidate = {}) {
    const fallback = DEFAULT_TRAFFIC_SETTINGS;
    const parseIntOr = (value, defaultValue) => {
        const num = Number(value);
        return Number.isFinite(num) ? Math.round(num) : defaultValue;
    };

    const asBool = (value, defaultValue = false) => {
        if (value === undefined || value === null || value === '') return !!defaultValue;
        return value === true || value === 'true' || value === '1' || value === 'on' || value === 1;
    };

    const radiusNm = Math.max(5, Math.min(250, parseIntOr(candidate.radiusNm, fallback.radiusNm)));
    const minAltitudeFt = Math.max(0, Math.min(60000, parseIntOr(candidate.minAltitudeFt, fallback.minAltitudeFt)));

    let maxAltitudeFt = candidate.maxAltitudeFt;
    if (maxAltitudeFt === '' || maxAltitudeFt === null || maxAltitudeFt === undefined) {
        maxAltitudeFt = null;
    } else {
        maxAltitudeFt = Math.max(0, Math.min(60000, parseIntOr(maxAltitudeFt, fallback.maxAltitudeFt ?? 60000)));
    }

    if (maxAltitudeFt !== null && maxAltitudeFt < minAltitudeFt) {
        maxAltitudeFt = minAltitudeFt;
    }

    const showAltitudeLabel = asBool(candidate.showAltitudeLabel, fallback.showAltitudeLabel);

    const validAltitudeModes = new Set(['absolute', 'around', 'ground']);
    let altitudeFilterMode = String(candidate.altitudeFilterMode || '').toLowerCase();
    if (!validAltitudeModes.has(altitudeFilterMode)) {
        /*
         * Migration transparente des versions précédentes :
         * - ancienne case cochée = mode ± autour de mon altitude ;
         * - ancienne case décochée = altitude absolue.
         */
        altitudeFilterMode = asBool(
            candidate.relativeAltitudeEnabled,
            fallback.relativeAltitudeEnabled
        ) ? 'around' : 'absolute';
    }

    const relativeAltitudeBandFt = Math.max(
        100,
        Math.min(
            10000,
            parseIntOr(candidate.relativeAltitudeBandFt, fallback.relativeAltitudeBandFt)
        )
    );
    const groundToAboveBandFt = Math.max(
        100,
        Math.min(
            10000,
            parseIntOr(candidate.groundToAboveBandFt, fallback.groundToAboveBandFt)
        )
    );

    /*
     * v14.44 — suppression des modes « autour de ma position » et
     * « autour du feu ». Le trafic est toujours demandé autour du centre
     * courant de la carte, quelle que soit une ancienne valeur mémorisée.
     */
    const trafficAroundOwnPosition = false;
    const trafficAroundFire = false;
    const showGroundTraffic = asBool(
        candidate.showGroundTraffic,
        fallback.showGroundTraffic
    );

    const showDroneAdvisories = asBool(
        candidate.showDroneAdvisories,
        fallback.showDroneAdvisories
    );
    const onlyTrackedIdentifiers = asBool(
        candidate.onlyTrackedIdentifiers,
        fallback.onlyTrackedIdentifiers
    );
    const onlyNonAirplaneHelicopterTraffic = asBool(
        candidate.onlyNonAirplaneHelicopterTraffic,
        fallback.onlyNonAirplaneHelicopterTraffic
    );
    /*
     * v14.41 — publication NPF vers SafeSky supprimée.
     * Les anciennes valeurs mémorisées sont ignorées et neutralisées.
     */
    const publishOwnPosition = false;
    const publicationCallsign = '';
    const publicationBeaconType = 'MOTORPLANE';

    return {
        radiusNm,
        minAltitudeFt,
        maxAltitudeFt,
        showAltitudeLabel,
        altitudeFilterMode,
        /*
         * Propriété conservée pour compatibilité avec d'anciens réglages ou
         * modules, vraie pour les deux modes dépendant de l'altitude propre.
         */
        relativeAltitudeEnabled: altitudeFilterMode !== 'absolute',
        relativeAltitudeBandFt,
        groundToAboveBandFt,
        trafficAroundOwnPosition,
        trafficAroundFire,
        showGroundTraffic,
        showDroneAdvisories,
        onlyTrackedIdentifiers,
        onlyNonAirplaneHelicopterTraffic,
        publishOwnPosition,
        publicationCallsign,
        publicationBeaconType
    };
}


function normalizeTrackedTrafficCallsign(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
}

function isPermanentTrackedTrafficCallsign(value) {
    return TRAFFIC_PERMANENT_TRACKED_CALLSIGN_SET.has(
        normalizeTrackedTrafficCallsign(value)
    );
}

function isPermanentTrackedTrafficEntry(entry) {
    if (!entry) return false;
    if (entry.permanent === true) return true;

    const callsign = normalizeTrackedTrafficCallsign(
        entry.callsign
        || (
            isPendingTrackedTrafficIdentifier(entry.id)
                ? String(entry.id).slice('CALLSIGN:'.length)
                : ''
        )
    );
    return isPermanentTrackedTrafficCallsign(callsign);
}

function buildPermanentTrackedTrafficEntry(callsign) {
    const normalizedCallsign = normalizeTrackedTrafficCallsign(callsign);
    return {
        id: buildPendingTrackedTrafficIdentifier(normalizedCallsign),
        callsign: normalizedCallsign,
        registration: '',
        type: '',
        pendingResolution: true,
        permanent: true,
        addedAt: 0
    };
}

function mergePermanentTrackedTrafficIdentifiers(entries) {
    const merged = Array.isArray(entries) ? [...entries] : [];

    TRAFFIC_PERMANENT_TRACKED_CALLSIGNS.forEach(callsign => {
        const existing = merged.find(entry => (
            normalizeTrackedTrafficCallsign(entry?.callsign) === callsign
            || String(entry?.id || '').toUpperCase()
                === buildPendingTrackedTrafficIdentifier(callsign)
        ));

        if (existing) {
            existing.callsign = callsign;
            existing.permanent = true;
            return;
        }

        merged.push(buildPermanentTrackedTrafficEntry(callsign));
    });

    return merged;
}

function isPendingTrackedTrafficIdentifier(id) {
    return String(id || '').toUpperCase().startsWith('CALLSIGN:');
}

function buildPendingTrackedTrafficIdentifier(callsign) {
    const normalizedCallsign = normalizeTrackedTrafficCallsign(callsign);
    return normalizedCallsign ? `CALLSIGN:${normalizedCallsign}` : '';
}

function getTrackedTrafficEntryAlphabeticalLabel(entry) {
    return String(
        entry?.callsign
        || entry?.registration
        || (
            isPendingTrackedTrafficIdentifier(entry?.id)
                ? String(entry.id).slice('CALLSIGN:'.length)
                : entry?.id
        )
        || ''
    ).trim().toUpperCase();
}

function sortTrackedTrafficIdentifiers(entries) {
    return [...(Array.isArray(entries) ? entries : [])]
        .sort((left, right) => {
            const labelDifference = getTrackedTrafficEntryAlphabeticalLabel(left)
                .localeCompare(
                    getTrackedTrafficEntryAlphabeticalLabel(right),
                    'fr',
                    { numeric: true, sensitivity: 'base' }
                );
            if (labelDifference) return labelDifference;
            return String(left?.id || '').localeCompare(
                String(right?.id || ''),
                'fr',
                { numeric: true, sensitivity: 'base' }
            );
        });
}

function sanitizeTrackedTrafficIdentifierEntry(entry) {
    if (!entry) return null;

    const callsign = normalizeTrackedTrafficCallsign(
        entry.callsign || entry.call_sign || ''
    );
    const registration = String(entry.registration || '')
        .trim()
        .toUpperCase();
    let id = String(entry.id || entry.hex || '')
        .trim()
        .toUpperCase();

    if (!id && callsign) {
        id = buildPendingTrackedTrafficIdentifier(callsign);
    }
    if (!id) return null;

    return {
        id,
        callsign: callsign || (
            isPendingTrackedTrafficIdentifier(id)
                ? id.slice('CALLSIGN:'.length)
                : ''
        ),
        registration,
        type: String(entry.type || entry.beaconType || '')
            .trim()
            .toUpperCase(),
        pendingResolution: (
            Boolean(entry.pendingResolution)
            || isPendingTrackedTrafficIdentifier(id)
        ),
        permanent: (
            Boolean(entry.permanent)
            || isPermanentTrackedTrafficCallsign(callsign)
        ),
        addedAt: Number(entry.addedAt) || Date.now()
    };
}

function loadTrackedTrafficIdentifiers() {
    let parsed = [];
    try {
        const stored = JSON.parse(
            localStorage.getItem(
                TRAFFIC_TRACKED_IDENTIFIERS_STORAGE_KEY
            ) || '[]'
        );
        parsed = Array.isArray(stored) ? stored : [];
    } catch (_) {
        parsed = [];
    }

    const result = [];
    const seenIds = new Set();
    const seenCallsigns = new Set();

    mergePermanentTrackedTrafficIdentifiers(parsed).forEach(entry => {
        const cleanEntry = sanitizeTrackedTrafficIdentifierEntry(entry);
        if (!cleanEntry) return;

        const callsign = normalizeTrackedTrafficCallsign(cleanEntry.callsign);
        if (seenIds.has(cleanEntry.id)) return;

        /*
         * Un indicatif permanent peut avoir été résolu en identifiant SafeSky.
         * Dans ce cas, l'entrée résolue remplace l'entrée CALLSIGN:... et évite
         * de faire réapparaître un doublon « en attente » au lancement suivant.
         */
        if (callsign && seenCallsigns.has(callsign)) {
            const existingIndex = result.findIndex(candidate => (
                normalizeTrackedTrafficCallsign(candidate.callsign)
                    === callsign
            ));
            const existing = result[existingIndex];
            const preferCurrent = (
                existing
                && isPendingTrackedTrafficIdentifier(existing.id)
                && !isPendingTrackedTrafficIdentifier(cleanEntry.id)
            );
            if (preferCurrent) {
                cleanEntry.permanent = (
                    cleanEntry.permanent
                    || existing.permanent
                    || isPermanentTrackedTrafficCallsign(callsign)
                );
                seenIds.delete(existing.id);
                result[existingIndex] = cleanEntry;
                seenIds.add(cleanEntry.id);
            }
            return;
        }

        if (isPermanentTrackedTrafficCallsign(callsign)) {
            cleanEntry.permanent = true;
        }

        seenIds.add(cleanEntry.id);
        if (callsign) seenCallsigns.add(callsign);
        result.push(cleanEntry);
    });

    return sortTrackedTrafficIdentifiers(result);
}

function saveTrackedTrafficIdentifiers(entries) {
    const cleanEntries = [];
    const seen = new Set();

    mergePermanentTrackedTrafficIdentifiers(
        Array.isArray(entries) ? entries : []
    ).forEach(entry => {
        const cleanEntry = sanitizeTrackedTrafficIdentifierEntry(entry);
        if (!cleanEntry || seen.has(cleanEntry.id)) return;
        seen.add(cleanEntry.id);
        cleanEntries.push(cleanEntry);
    });

    const sortedEntries = sortTrackedTrafficIdentifiers(cleanEntries);

    try {
        localStorage.setItem(
            TRAFFIC_TRACKED_IDENTIFIERS_STORAGE_KEY,
            JSON.stringify(sortedEntries)
        );
    } catch (_) {}

    return sortedEntries;
}

function getTrackedTrafficIdentifiers() {
    return loadTrackedTrafficIdentifiers();
}

function getResolvedTrackedTrafficIdentifiers() {
    return getTrackedTrafficIdentifiers()
        .map(entry => entry.id)
        .filter(id => id && !isPendingTrackedTrafficIdentifier(id));
}

function trackedTrafficEntryMatchesAircraft(entry, aircraft) {
    const normalized = aircraft?.lat !== undefined
        ? aircraft
        : normalizeTrafficAircraft(aircraft?.raw || aircraft);
    if (!entry || !normalized) return false;

    const aircraftId = String(normalized.hex || '')
        .trim()
        .toUpperCase();
    const aircraftCallsign = normalizeTrackedTrafficCallsign(
        normalized.callsign
    );
    const aircraftRegistration = String(
        normalized.registration || ''
    ).trim().toUpperCase();

    if (
        entry.id
        && !isPendingTrackedTrafficIdentifier(entry.id)
        && aircraftId === entry.id
    ) {
        return true;
    }

    const entryCallsign = normalizeTrackedTrafficCallsign(entry.callsign);
    if (entryCallsign && aircraftCallsign === entryCallsign) return true;

    const entryRegistration = String(entry.registration || '')
        .trim()
        .toUpperCase();
    return Boolean(
        entryRegistration
        && aircraftRegistration === entryRegistration
    );
}

function findTrackedTrafficEntryForAircraft(aircraft) {
    return getTrackedTrafficIdentifiers().find(
        entry => trackedTrafficEntryMatchesAircraft(entry, aircraft)
    ) || null;
}

function isTrafficAircraftTracked(aircraft) {
    return Boolean(findTrackedTrafficEntryForAircraft(aircraft));
}

function addPendingTrackedTrafficCallsign(callsign) {
    const normalizedCallsign = normalizeTrackedTrafficCallsign(callsign);
    if (!/^[A-Z0-9][A-Z0-9._-]{1,23}$/.test(normalizedCallsign)) {
        throw new Error(
            'Indicatif invalide : utilise uniquement lettres, chiffres, point, tiret ou soulignement.'
        );
    }

    const current = getTrackedTrafficIdentifiers();
    const duplicate = current.find(entry => (
        normalizeTrackedTrafficCallsign(entry.callsign) === normalizedCallsign
        || entry.id === buildPendingTrackedTrafficIdentifier(normalizedCallsign)
    ));
    if (duplicate) {
        throw new Error(
            `${normalizedCallsign} est déjà présent dans la liste suivie.`
        );
    }

    current.push({
        id: buildPendingTrackedTrafficIdentifier(normalizedCallsign),
        callsign: normalizedCallsign,
        registration: '',
        type: '',
        pendingResolution: true,
        addedAt: Date.now()
    });

    const saved = saveTrackedTrafficIdentifiers(current);
    refreshTrackedTrafficListUi();

    if (showTrafficLayer) {
        refreshTrafficLayer({
            force: true,
            reason: 'tracked-pending-add'
        });
    }

    return saved;
}

function mergeResolvedTrackedTrafficIdentity(entry, aircraft) {
    const identity = extractTrackedTrafficIdentity(aircraft);
    if (!entry || !identity.id) return false;

    const entries = getTrackedTrafficIdentifiers();
    const replacement = {
        id: identity.id,
        callsign: identity.callsign || entry.callsign,
        registration: identity.registration || entry.registration,
        type: identity.type || entry.type,
        pendingResolution: false,
        permanent: isPermanentTrackedTrafficEntry(entry),
        addedAt: entry.addedAt
    };

    const updated = entries
        .filter(candidate => (
            candidate.id !== entry.id
            && candidate.id !== identity.id
        ))
        .concat(replacement);

    saveTrackedTrafficIdentifiers(updated);
    return true;
}

function getTrackedTrafficIdentifierSet() {
    return new Set(getResolvedTrackedTrafficIdentifiers());
}

function isTrafficIdentifierTracked(id) {
    const normalizedId = String(id || '').trim().toUpperCase();
    return normalizedId
        ? getTrackedTrafficIdentifierSet().has(normalizedId)
        : false;
}

function extractTrackedTrafficIdentity(aircraft) {
    const raw = aircraft?.raw || aircraft || {};
    const normalized = normalizeTrafficAircraft(raw);

    const id = String(
        normalized?.hex
        || raw.hex
        || raw.id
        || raw.aircraft_id
        || raw.aircraftId
        || ''
    ).trim().toUpperCase();

    const cleanText = (...values) => {
        for (const value of values) {
            const text = String(value || '').trim();
            if (
                text
                && !['N/A', 'UNKNOWN', '--', 'NULL'].includes(
                    text.toUpperCase()
                )
            ) {
                return text;
            }
        }
        return '';
    };

    return {
        id,
        callsign: cleanText(
            normalized?.callsign,
            raw.call_sign,
            raw.callsign,
            raw.flight
        ),
        registration: cleanText(
            normalized?.registration,
            raw.registration,
            raw.registration_number,
            raw.tail_number,
            raw.tail,
            raw.r
        ),
        type: cleanText(
            normalized?.beaconType,
            normalized?.type,
            raw.beacon_type,
            raw.aircraft_type,
            raw.type
        ),
        raw
    };
}

function addTrackedTrafficIdentifier(aircraft) {
    const identity = extractTrackedTrafficIdentity(aircraft);
    const id = identity.id;

    if (!id) {
        throw new Error(
            'SafeSky ne fournit pas d’identifiant technique exploitable pour cet indicatif.'
        );
    }

    const identityCallsign = normalizeTrackedTrafficCallsign(
        identity.callsign
    );
    const identityRegistration = String(identity.registration || '')
        .trim()
        .toUpperCase();
    const current = getTrackedTrafficIdentifiers()
        .filter(entry => (
            entry.id !== id
            && !(
                identityCallsign
                && normalizeTrackedTrafficCallsign(entry.callsign)
                    === identityCallsign
            )
            && !(
                identityRegistration
                && String(entry.registration || '').trim().toUpperCase()
                    === identityRegistration
            )
        ));

    current.push({
        id,
        callsign: identity.callsign,
        registration: identity.registration,
        type: identity.type,
        pendingResolution: false,
        addedAt: Date.now()
    });

    const saved = saveTrackedTrafficIdentifiers(current);
    refreshTrackedTrafficListUi();

    if (showTrafficLayer) {
        refreshTrafficLayer({
            force: true,
            reason: 'tracked-add'
        });
    }

    return saved;
}

function removeTrackedTrafficIdentifier(id) {
    const normalizedId = String(id || '').trim().toUpperCase();
    const currentEntry = getTrackedTrafficIdentifiers().find(
        entry => entry.id === normalizedId
    );

    if (isPermanentTrackedTrafficEntry(currentEntry)) {
        return getTrackedTrafficIdentifiers();
    }

    const saved = saveTrackedTrafficIdentifiers(
        getTrackedTrafficIdentifiers().filter(
            entry => entry.id !== normalizedId
        )
    );

    refreshTrackedTrafficListUi();

    if (showTrafficLayer) {
        refreshTrafficLayer({
            force: true,
            reason: 'tracked-remove'
        });
    }

    return saved;
}

function getCurrentlyDetectedTrackedTrafficMap() {
    const detected = new Map();
    const refreshAgeMs = Date.now() - Number(lastTrafficRefreshAt || 0);

    if (
        !showTrafficLayer
        || lastTrafficError
        || !Number.isFinite(refreshAgeMs)
        || refreshAgeMs > Math.max(15000, TRAFFIC_MAX_SEEN_SECONDS * 1000)
    ) {
        return detected;
    }

    const entries = getTrackedTrafficIdentifiers();
    if (!entries.length) return detected;

    const candidates = [
        ...(Array.isArray(lastTrafficAircraftSnapshot)
            ? lastTrafficAircraftSnapshot
            : []),
        ...getTemporaryGlobalTrafficRaw()
    ]
        .map(normalizeTrafficAircraft)
        .filter(Boolean)
        .filter(aircraft => (
            !Number.isFinite(aircraft.seenPos)
            || aircraft.seenPos <= TRAFFIC_MAX_SEEN_SECONDS
        ));

    entries.forEach(entry => {
        const aircraft = candidates.find(candidate => (
            trackedTrafficEntryMatchesAircraft(entry, candidate)
        ));
        if (aircraft) detected.set(entry.id, aircraft);
    });

    return detected;
}

function refreshTrackedTrafficListUi() {
    const listElement = document.getElementById(
        'traffic-tracked-list'
    );
    if (!listElement) return;

    const entries = getTrackedTrafficIdentifiers();
    const detectedTrafficMap = getCurrentlyDetectedTrackedTrafficMap();
    listElement.innerHTML = '';

    const countElement = document.getElementById(
        'traffic-tracked-count'
    );
    if (countElement) {
        countElement.textContent = String(entries.length);
        countElement.title = entries.length
            ? `${entries.length} indicatif${entries.length > 1 ? 's' : ''} suivi${entries.length > 1 ? 's' : ''}`
            : 'Aucun indicatif suivi';
    }

    if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'traffic-tool-empty';
        empty.textContent = 'Aucun identifiant suivi';
        listElement.appendChild(empty);
        return;
    }

    entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'traffic-tracked-row';

        const detectedAircraft = detectedTrafficMap.get(entry.id);
        if (detectedAircraft) {
            row.classList.add('traffic-tracked-detected');
            row.title = detectedAircraft.isGrounded
                ? 'Détecté par SafeSky — appuyer pour afficher au sol'
                : 'Détecté par SafeSky — appuyer pour afficher sur la carte';
            row.setAttribute('role', 'button');
            row.setAttribute('tabindex', '0');
            row.setAttribute(
                'aria-label',
                `${entry.registration || entry.callsign || entry.id} — afficher sur la carte`
            );

            /*
             * v14.56 — distinction appui / défilement dans la liste suivie.
             *
             * Aucun preventDefault n'est utilisé : Safari peut donc faire défiler
             * naturellement la carte des filtres lorsque le doigt part verticalement.
             * Si le déplacement dépasse quelques pixels, le clic synthétique suivant
             * est neutralisé afin de ne pas ouvrir le trafic à la fin du scroll.
             */
            let trackedRowTouchStartX = 0;
            let trackedRowTouchStartY = 0;
            let trackedRowTouchMoved = false;

            const suppressTrackedRowClickAfterScroll = () => {
                row.dataset.trafficSuppressClickUntil = String(
                    Date.now() + 700
                );
                window.setTimeout(() => {
                    const suppressUntil = Number(
                        row.dataset.trafficSuppressClickUntil || 0
                    );
                    if (Date.now() >= suppressUntil) {
                        delete row.dataset.trafficSuppressClickUntil;
                    }
                }, 750);
            };

            row.addEventListener('touchstart', event => {
                if (event?.target?.closest?.('button')) return;
                const touch = event.touches?.[0];
                if (!touch) return;

                trackedRowTouchStartX = touch.clientX;
                trackedRowTouchStartY = touch.clientY;
                trackedRowTouchMoved = false;
                delete row.dataset.trafficSuppressClickUntil;
            }, { passive: true });

            row.addEventListener('touchmove', event => {
                const touch = event.touches?.[0];
                if (!touch) return;

                const deltaX = touch.clientX - trackedRowTouchStartX;
                const deltaY = touch.clientY - trackedRowTouchStartY;
                if (Math.hypot(deltaX, deltaY) >= 8) {
                    trackedRowTouchMoved = true;
                }
            }, { passive: true });

            row.addEventListener('touchend', () => {
                if (trackedRowTouchMoved) {
                    suppressTrackedRowClickAfterScroll();
                }
                trackedRowTouchMoved = false;
            }, { passive: true });

            row.addEventListener('touchcancel', () => {
                suppressTrackedRowClickAfterScroll();
                trackedRowTouchMoved = false;
            }, { passive: true });

            const openDetectedTraffic = async (event) => {
                if (event?.target?.closest?.('button')) return;
                if (
                    Date.now() < Number(
                        row.dataset.trafficSuppressClickUntil || 0
                    )
                ) return;
                if (row.dataset.trafficOpening === '1') return;

                row.dataset.trafficOpening = '1';
                row.classList.add('traffic-tracked-opening');

                try {
                    await focusTrafficAircraftResult(
                        detectedAircraft.raw || detectedAircraft,
                        { forceGroundDisplay: true }
                    );

                    const modal = document.getElementById(
                        'traffic-settings-modal'
                    );
                    if (modal) {
                        modal.classList.remove('open');
                        modal.setAttribute('aria-hidden', 'true');
                    }
                } catch (error) {
                    console.warn(
                        'Affichage du trafic suivi impossible:',
                        error
                    );
                    row.title = error?.message
                        || 'Position du trafic indisponible';
                } finally {
                    delete row.dataset.trafficOpening;
                    row.classList.remove('traffic-tracked-opening');
                }
            };

            row.addEventListener('click', openDetectedTraffic);
            row.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                openDetectedTraffic(event);
            });
        }

        const label = document.createElement('div');
        label.className = 'traffic-tracked-label';

        const primary = document.createElement('strong');
        primary.textContent = (
            entry.callsign
            || entry.registration
            || (
                isPendingTrackedTrafficIdentifier(entry.id)
                    ? entry.id.slice('CALLSIGN:'.length)
                    : entry.id
            )
        );

        const secondary = document.createElement('span');
        secondary.textContent = [
            entry.registration
                && entry.registration !== primary.textContent
                ? entry.registration
                : '',
            entry.type,
            isPermanentTrackedTrafficEntry(entry)
                ? 'Permanent'
                : '',
            isPendingTrackedTrafficIdentifier(entry.id)
                ? 'En attente de détection'
                : entry.id
        ].filter(Boolean).join(' · ');

        label.append(primary, secondary);

        if (detectedAircraft) {
            const liveState = document.createElement('span');
            liveState.className = 'traffic-tracked-live-state';
            liveState.textContent = detectedAircraft.isGrounded
                ? 'Détecté au sol'
                : 'Détecté en vol';
            label.appendChild(liveState);
        }

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className =
            'traffic-tool-button traffic-tool-button-danger';
        const permanentEntry = isPermanentTrackedTrafficEntry(entry);
        removeButton.textContent = permanentEntry ? 'Permanent' : 'Retirer';
        removeButton.disabled = permanentEntry;
        if (permanentEntry) {
            removeButton.title = 'Indicatif permanent intégré à NPF';
            removeButton.setAttribute('aria-label', 'Indicatif permanent');
        } else {
            removeButton.addEventListener('click', event => {
                event.stopPropagation();
                removeTrackedTrafficIdentifier(entry.id);
            });
        }

        row.append(label, removeButton);
        listElement.appendChild(row);
    });
}


function sanitizeOwnTrafficAircraftSessionEntry(entry) {
    if (!entry) return null;

    const id = String(entry.id || entry.hex || '')
        .trim()
        .toUpperCase();
    const callsign = String(entry.callsign || entry.call_sign || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
    const registration = String(entry.registration || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();

    /*
     * v15.86 — « Mon avion » peut venir de SafeSky, de GLR ou d'une saisie
     * manuelle. L'identifiant technique SafeSky n'est donc plus obligatoire :
     * un indicatif exploitable suffit pour masquer le même avion dans les deux
     * sources pendant la session PWA courante.
     */
    if (!id && !callsign && !registration) return null;

    return {
        id,
        callsign,
        registration,
        type: String(entry.type || entry.beaconType || '')
            .trim()
            .toUpperCase(),
        source: String(entry.source || '')
            .trim()
            .toUpperCase(),
        selectedAt: Number(entry.selectedAt) || Date.now()
    };
}

function loadOwnTrafficAircraftSession() {
    try {
        const cleanEntry = sanitizeOwnTrafficAircraftSessionEntry(
            JSON.parse(
                sessionStorage.getItem(
                    TRAFFIC_OWN_AIRCRAFT_SESSION_KEY
                ) || 'null'
            )
        );
        ownTrafficAircraftSessionFallback = cleanEntry;
        return cleanEntry;
    } catch (_) {
        return sanitizeOwnTrafficAircraftSessionEntry(
            ownTrafficAircraftSessionFallback
        );
    }
}

function getOwnTrafficAircraftSession() {
    return loadOwnTrafficAircraftSession();
}

function getTrafficAircraftIdentifier(aircraftOrId) {
    if (typeof aircraftOrId === 'string') {
        return aircraftOrId.trim().toUpperCase();
    }

    return String(
        aircraftOrId?.hex
        || aircraftOrId?.id
        || aircraftOrId?.raw?.hex
        || aircraftOrId?.raw?.id
        || ''
    ).trim().toUpperCase();
}

function areOwnTrafficCallsignsEquivalent(left, right) {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (!a || !b) return false;

    const normalizedA = normalizeTrafficSourceCallsign(a);
    const normalizedB = normalizeTrafficSourceCallsign(b);
    if (!normalizedA || !normalizedB) return false;
    if (normalizedA === normalizedB) return true;

    try {
        return !!compareTrafficSourceCallsigns(a, b)?.match;
    } catch (_) {
        return false;
    }
}

function getOwnTrafficCallsignCandidates(ownAircraft) {
    if (!ownAircraft) return [];
    return Array.from(new Set([
        ownAircraft.callsign,
        ownAircraft.registration
    ].map(value => String(value || '').trim()).filter(Boolean)));
}

function getTrafficAircraftCallsignCandidates(aircraftOrId) {
    if (!aircraftOrId || typeof aircraftOrId === 'string') return [];
    return Array.from(new Set([
        aircraftOrId.callsign,
        aircraftOrId.call_sign,
        aircraftOrId.registration,
        aircraftOrId.raw?.callsign,
        aircraftOrId.raw?.call_sign,
        aircraftOrId.raw?.registration
    ].map(value => String(value || '').trim()).filter(Boolean)));
}

function isOwnTrafficAircraft(aircraftOrId) {
    const ownAircraft = getOwnTrafficAircraftSession();
    if (!ownAircraft) return false;

    const identifier = getTrafficAircraftIdentifier(aircraftOrId);
    if (ownAircraft.id && identifier && ownAircraft.id === identifier) {
        return true;
    }

    const ownCallsigns = getOwnTrafficCallsignCandidates(ownAircraft);
    const candidateCallsigns = typeof aircraftOrId === 'string'
        ? [aircraftOrId]
        : getTrafficAircraftCallsignCandidates(aircraftOrId);

    return ownCallsigns.some(ownCallsign => (
        candidateCallsigns.some(candidate => (
            areOwnTrafficCallsignsEquivalent(ownCallsign, candidate)
        ))
    ));
}

function isOwnGlobalLinkAircraft(item) {
    const ownAircraft = getOwnTrafficAircraftSession();
    if (!ownAircraft) return false;
    const glrName = String(item?.name || '').trim();
    if (!glrName) return false;

    return getOwnTrafficCallsignCandidates(ownAircraft).some(identifier => (
        areOwnTrafficCallsignsEquivalent(identifier, glrName)
    ));
}

function refreshOwnTrafficAircraftUi() {
    const ownAircraft = getOwnTrafficAircraftSession();
    const statusElement = document.getElementById(
        'traffic-own-aircraft-status'
    );
    const resetButton = document.getElementById(
        'traffic-own-aircraft-reset'
    );

    if (statusElement) {
        if (ownAircraft) {
            const mainLabel = (
                ownAircraft.registration
                || ownAircraft.callsign
                || ownAircraft.id
            );
            const details = [
                ownAircraft.callsign
                    && ownAircraft.callsign !== mainLabel
                    ? ownAircraft.callsign
                    : '',
                ownAircraft.type,
                ownAircraft.id
            ].filter(Boolean).join(' · ');

            statusElement.innerHTML = '';
            const title = document.createElement('strong');
            title.textContent = `Mon avion masqué : ${mainLabel}`;
            const detail = document.createElement('span');
            detail.textContent = details;
            statusElement.append(title, detail);
            statusElement.classList.add('traffic-own-aircraft-active');
        } else {
            statusElement.textContent =
                'Aucun avion défini pour cette session.';
            statusElement.classList.remove('traffic-own-aircraft-active');
        }
    }

    if (resetButton) {
        resetButton.disabled = !ownAircraft;
    }
}

function redrawTrafficAfterOwnAircraftChange(reason) {
    refreshOwnTrafficAircraftUi();
    redrawTrafficLayerFromSnapshot();

    if (showTrafficLayer) {
        refreshTrafficLayer({
            force: true,
            reason
        });
    }

    /*
     * v15.43 — « mon avion » doit aussi disparaître/réapparaître
     * immédiatement dans GLR sans attendre le prochain rafraîchissement.
     */
    if (
        typeof renderGlobalLinkPositions === 'function'
        && Array.isArray(npfGlobalLinkLastPositions)
        && npfGlobalLinkLastPositions.length
    ) {
        renderGlobalLinkPositions(npfGlobalLinkLastPositions);
    }
}

function setOwnTrafficAircraftSession(aircraft) {
    const normalized = normalizeTrafficAircraft(
        aircraft?.raw || aircraft
    );
    const id = getTrafficAircraftIdentifier(
        normalized || aircraft
    );

    if (!id) {
        throw new Error(
            'Ce trafic ne fournit pas d’identifiant SafeSky exploitable'
        );
    }

    const entry = sanitizeOwnTrafficAircraftSessionEntry({
        id,
        callsign: normalized?.callsign || aircraft?.callsign || '',
        registration:
            normalized?.registration || aircraft?.registration || '',
        type:
            normalized?.beaconType
            || normalized?.type
            || aircraft?.type
            || '',
        source: 'SAFESKY',
        selectedAt: Date.now()
    });

    ownTrafficAircraftSessionFallback = entry;
    try {
        sessionStorage.setItem(
            TRAFFIC_OWN_AIRCRAFT_SESSION_KEY,
            JSON.stringify(entry)
        );
    } catch (_) {}

    redrawTrafficAfterOwnAircraftChange('own-aircraft-set');
    return entry;
}

function setOwnTrafficAircraftCallsign(callsign, options = {}) {
    const cleanCallsign = String(callsign || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
    if (!cleanCallsign || !normalizeTrafficSourceCallsign(cleanCallsign)) {
        throw new Error('Saisis un indicatif exploitable pour « Mon avion ».');
    }

    const entry = sanitizeOwnTrafficAircraftSessionEntry({
        id: String(options.id || '').trim().toUpperCase(),
        callsign: cleanCallsign,
        registration: String(options.registration || '').trim().toUpperCase(),
        type: String(options.type || '').trim().toUpperCase(),
        source: String(options.source || 'MANUAL').trim().toUpperCase(),
        selectedAt: Date.now()
    });

    ownTrafficAircraftSessionFallback = entry;
    try {
        sessionStorage.setItem(
            TRAFFIC_OWN_AIRCRAFT_SESSION_KEY,
            JSON.stringify(entry)
        );
    } catch (_) {}

    redrawTrafficAfterOwnAircraftChange('own-aircraft-callsign-set');
    return entry;
}

function clearOwnTrafficAircraftSession() {
    ownTrafficAircraftSessionFallback = null;
    try {
        sessionStorage.removeItem(
            TRAFFIC_OWN_AIRCRAFT_SESSION_KEY
        );
    } catch (_) {}

    const manualInput = document.getElementById('traffic-own-aircraft-manual-input');
    if (manualInput) manualInput.value = '';

    redrawTrafficAfterOwnAircraftChange('own-aircraft-reset');
}


function loadTrafficSettings() {
    try {
        const raw = localStorage.getItem(TRAFFIC_SETTINGS_STORAGE_KEY);
        if (!raw) return sanitizeTrafficSettings(DEFAULT_TRAFFIC_SETTINGS);
        return sanitizeTrafficSettings(JSON.parse(raw));
    } catch (_) {
        return sanitizeTrafficSettings(DEFAULT_TRAFFIC_SETTINGS);
    }
}

function saveTrafficSettings(settings) {
    trafficSettings = sanitizeTrafficSettings(settings);
    try {
        localStorage.setItem(TRAFFIC_SETTINGS_STORAGE_KEY, JSON.stringify(trafficSettings));
    } catch (_) {}
    return trafficSettings;
}

function getTrafficSettingsSummary() {
    const settings = sanitizeTrafficSettings(trafficSettings);
    const altitudeMaxLabel = settings.maxAltitudeFt === null
        ? 'sans maxi'
        : `${settings.maxAltitudeFt} ft`;
    const altitudeLabel = settings.showAltitudeLabel
        ? 'étiquette alt ON'
        : 'étiquette alt OFF';

    let altitudeFilterLabel = `Alt. ${settings.minAltitudeFt} ft / ${altitudeMaxLabel}`;
    if (settings.altitudeFilterMode === 'around') {
        altitudeFilterLabel = `±${settings.relativeAltitudeBandFt} ft autour de moi`;
    } else if (settings.altitudeFilterMode === 'ground') {
        altitudeFilterLabel = `du sol à +${settings.groundToAboveBandFt} ft au-dessus de moi`;
    }

    const referenceLabel = 'centre carte';
    const groundLabel = settings.showGroundTraffic
        ? 'trafics au sol ON'
        : 'trafics au sol OFF';

    const trackedCount = getTrackedTrafficIdentifiers().length;
    const trackedLabel = settings.onlyTrackedIdentifiers
        ? `liste suivie ${trackedCount}`
        : 'tous identifiants';
    const advisoryLabel = settings.showDroneAdvisories
        ? 'zones drone ON'
        : 'zones drone OFF';
    const typeFilterLabel = settings.onlyNonAirplaneHelicopterTraffic
        ? 'avions/hélicos masqués'
        : 'tous types';

    return `Rayon ${settings.radiusNm} Nm · ${altitudeFilterLabel} · ${altitudeLabel} · ${referenceLabel} · ${groundLabel} · ${trackedLabel} · ${typeFilterLabel} · ${advisoryLabel}`;
}

function ensureTrafficSettingsModal() {
    let modal = document.getElementById('traffic-settings-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'traffic-settings-modal';
    modal.className = 'traffic-settings-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="traffic-settings-card" role="dialog" aria-modal="true" aria-labelledby="traffic-settings-title">
            <div class="traffic-settings-header">
                <div>
                    <div id="traffic-settings-title" class="traffic-settings-title">Filtres trafic</div>
                </div>
                <button type="button" id="traffic-settings-close" class="traffic-settings-close" aria-label="Fermer">×</button>
            </div>

            <div class="traffic-settings-grid">
                <label class="traffic-settings-field traffic-settings-relative-line traffic-settings-radius-field">
                    <div class="traffic-settings-check-row traffic-settings-radius-inline-row">
                        <em>Rayon d'affichage</em>
                        <input id="traffic-radius-input" type="number" inputmode="numeric" min="5" max="250" step="1">
                        <strong>Nm</strong>
                    </div>
                </label>

                <label id="traffic-altitude-absolute-mode-field" class="traffic-settings-field traffic-settings-checkbox-field traffic-settings-relative-line">
                    <div class="traffic-settings-check-row traffic-settings-altitude-row traffic-settings-absolute-band-row">
                        <input id="traffic-altitude-mode-absolute" type="radio" name="traffic-altitude-mode" value="absolute">
                        <em>Alt. mini / maxi</em>
                        <input id="traffic-min-altitude-input" type="number" inputmode="numeric" min="0" max="60000" step="100" placeholder="mini">
                        <span class="traffic-altitude-separator">/</span>
                        <input id="traffic-max-altitude-input" type="number" inputmode="numeric" min="0" max="60000" step="100" placeholder="maxi">
                        <strong>ft</strong>
                    </div>
                </label>

                <label id="traffic-around-altitude-field" class="traffic-settings-field traffic-settings-checkbox-field traffic-settings-relative-line">
                    <div class="traffic-settings-check-row traffic-settings-altitude-row traffic-settings-around-band-row">
                        <input id="traffic-altitude-mode-around" type="radio" name="traffic-altitude-mode" value="around">
                        <em>Autour de mon altitude</em>
                        <span class="traffic-relative-plusminus">±</span>
                        <input id="traffic-relative-band-input" type="number" inputmode="numeric" min="100" max="10000" step="100">
                        <strong>ft</strong>
                    </div>
                </label>

                <label id="traffic-ground-altitude-field" class="traffic-settings-field traffic-settings-checkbox-field traffic-settings-relative-line">
                    <div class="traffic-settings-check-row traffic-settings-altitude-row traffic-settings-ground-band-row">
                        <input id="traffic-altitude-mode-ground" type="radio" name="traffic-altitude-mode" value="ground">
                        <em>Du sol à</em>
                        <span class="traffic-relative-plusminus">+</span>
                        <input id="traffic-ground-band-input" type="number" inputmode="numeric" min="100" max="10000" step="100">
                        <strong>ft au-dessus de moi</strong>
                    </div>
                </label>

                <label class="traffic-settings-field traffic-settings-checkbox-field">
                    <div class="traffic-settings-check-row">
                        <input id="traffic-show-ground-input" type="checkbox">
                        <em>Afficher les trafics au sol</em>
                    </div>
                </label>

                <label class="traffic-settings-field traffic-settings-checkbox-field">
                    <div class="traffic-settings-check-row">
                        <input id="traffic-altitude-label-input" type="checkbox">
                        <em>Etiquette Alt. Trafics</em>
                    </div>
                </label>

                <label class="traffic-settings-field traffic-settings-checkbox-field">
                    <div class="traffic-settings-check-row">
                        <input id="traffic-drone-advisories-input" type="checkbox">
                        <em>Zones d’activité drone déclarées</em>
                    </div>
                </label>

                <label class="traffic-settings-field traffic-settings-checkbox-field">
                    <div class="traffic-settings-check-row">
                        <input id="traffic-only-tracked-input" type="checkbox">
                        <em>Afficher uniquement la liste suivie</em>
                    </div>
                </label>

                <label class="traffic-settings-field traffic-settings-checkbox-field">
                    <div class="traffic-settings-check-row">
                        <input id="traffic-only-light-types-input" type="checkbox">
                        <em>N'afficher que parapentes, deltaplanes, planeurs, ULM, etc.</em>
                    </div>
                </label>

            </div>

            <div class="traffic-settings-actions traffic-settings-actions-live">
                <button type="button" id="traffic-settings-reset" class="traffic-settings-secondary">Défaut</button>
                <button type="button" id="traffic-settings-cancel" class="traffic-settings-secondary">Annuler</button>
            </div>

            <div class="traffic-tools-section traffic-own-aircraft-section">
                <div class="traffic-tools-title">Mon avion</div>
                <div class="traffic-own-aircraft-row">
                    <div id="traffic-own-aircraft-status" class="traffic-own-aircraft-status">
                        Aucun avion défini pour cette session.
                    </div>
                    <button type="button"
                            id="traffic-own-aircraft-reset"
                            class="traffic-tool-button traffic-tool-button-danger"
                            disabled>
                        Réinitialiser
                    </button>
                </div>
                <div class="traffic-own-aircraft-manual-row">
                    <input id="traffic-own-aircraft-manual-input"
                           type="text"
                           maxlength="24"
                           autocomplete="off"
                           autocapitalize="characters"
                           spellcheck="false"
                           placeholder="Indicatif, ex. PELIC34">
                    <button type="button"
                            id="traffic-own-aircraft-manual-apply"
                            class="traffic-tool-button traffic-own-aircraft-select-button">
                        Définir
                    </button>
                </div>
                <div class="traffic-tools-note">
                    L'indicatif saisi sert à masquer « Mon avion » dans SafeSky et GLR pour la session courante.
                </div>
            </div>

            <div class="traffic-tools-section">
                <div class="traffic-tools-title">Recherche d’identifiants SafeSky</div>
                <div class="traffic-search-row">
                    <input id="traffic-global-search-input"
                           type="search"
                           maxlength="24"
                           autocomplete="off"
                           autocapitalize="characters"
                           placeholder="Indicatif entier ou partie, ex. MILAN">
                    <button type="button"
                            id="traffic-global-add-button"
                            class="traffic-tool-button traffic-tool-button-add">
                        Ajouter
                    </button>
                    <button type="button"
                            id="traffic-global-search-button"
                            class="traffic-tool-button traffic-tool-button-primary">
                        Rechercher
                    </button>
                </div>
                <div class="traffic-tools-note">
                    « Ajouter » enregistre immédiatement l’indicatif, même sans détection actuelle. L’identifiant SafeSky sera associé automatiquement à la première détection.
                    « Rechercher » accepte aussi une partie comme MILAN et affiche les trafics actifs correspondants autour du centre de la carte.
                </div>
                <div id="traffic-search-results" class="traffic-search-results"></div>
            </div>

            <div class="traffic-tools-section">
                <div class="traffic-tools-title">
                    Liste d’identifiants suivis
                    <span id="traffic-tracked-count" class="traffic-tracked-count"></span>
                </div>
                <div class="traffic-tools-note">
                    Les indicatifs permanents intégrés à NPF sont recréés automatiquement après une réinstallation.
                    Tu peux continuer à ajouter et retirer librement les autres indicatifs. NPF mémorise l’identifiant SafeSky, pas seulement l’indicatif.
                </div>
                <div id="traffic-tracked-list" class="traffic-tracked-list"></div>
            </div>


            <div class="traffic-settings-note">Altitude maxi vide = pas de limite haute. « Autour de mon altitude » affiche une tranche ±. « Du sol à + » ne fixe aucune limite basse. Les trafics sont recherchés dans le rayon choisi autour du centre de la carte. Les trafics au sol sont masqués par défaut et apparaissent uniquement lorsque « Afficher les trafics au sol » est coché. Rafraîchissement toutes les 5 secondes. Le déplacement intermédiaire est extrapolé localement. Les données SafeSky/ADS-B restent indicatives et non certifiées.</div>

        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    };

    const getSelectedAltitudeMode = () => (
        modal.querySelector('input[name="traffic-altitude-mode"]:checked')?.value
        || 'absolute'
    );

    const updateAltitudeModeUi = () => {
        const mode = getSelectedAltitudeMode();

        const minAltitudeInput = modal.querySelector('#traffic-min-altitude-input');
        const maxAltitudeInput = modal.querySelector('#traffic-max-altitude-input');
        const relativeBandInput = modal.querySelector('#traffic-relative-band-input');
        const groundBandInput = modal.querySelector('#traffic-ground-band-input');

        const absoluteAltitudeField = modal.querySelector('#traffic-altitude-absolute-mode-field');
        const aroundAltitudeField = modal.querySelector('#traffic-around-altitude-field');
        const groundAltitudeField = modal.querySelector('#traffic-ground-altitude-field');

        const absoluteActive = mode === 'absolute';
        const aroundActive = mode === 'around';
        const groundActive = mode === 'ground';

        [minAltitudeInput, maxAltitudeInput].forEach(input => {
            if (input) input.disabled = !absoluteActive;
        });
        if (absoluteAltitudeField) {
            absoluteAltitudeField.classList.toggle(
                'traffic-settings-field-disabled',
                !absoluteActive
            );
        }

        if (relativeBandInput) relativeBandInput.disabled = !aroundActive;
        if (aroundAltitudeField) {
            aroundAltitudeField.classList.toggle('traffic-settings-field-disabled', !aroundActive);
        }

        if (groundBandInput) groundBandInput.disabled = !groundActive;
        if (groundAltitudeField) {
            groundAltitudeField.classList.toggle('traffic-settings-field-disabled', !groundActive);
        }
    };

    const fillDefaults = () => {
        const defaults = sanitizeTrafficSettings(DEFAULT_TRAFFIC_SETTINGS);
        modal.querySelector('#traffic-radius-input').value = String(defaults.radiusNm);
        modal.querySelector('#traffic-min-altitude-input').value = String(defaults.minAltitudeFt);
        modal.querySelector('#traffic-max-altitude-input').value = '';
        modal.querySelector('#traffic-show-ground-input').checked = !!defaults.showGroundTraffic;
        modal.querySelector(`#traffic-altitude-mode-${defaults.altitudeFilterMode}`).checked = true;
        modal.querySelector('#traffic-relative-band-input').value = String(defaults.relativeAltitudeBandFt);
        modal.querySelector('#traffic-ground-band-input').value = String(defaults.groundToAboveBandFt);
        modal.querySelector('#traffic-altitude-label-input').checked = !!defaults.showAltitudeLabel;
        modal.querySelector('#traffic-drone-advisories-input').checked = !!defaults.showDroneAdvisories;
        modal.querySelector('#traffic-only-tracked-input').checked = !!defaults.onlyTrackedIdentifiers;
        modal.querySelector('#traffic-only-light-types-input').checked = !!defaults.onlyNonAirplaneHelicopterTraffic;
        updateAltitudeModeUi();
    };

    const readTrafficSettingsFromModal = () => {
        const radiusInput = modal.querySelector('#traffic-radius-input');
        const minAltitudeInput = modal.querySelector('#traffic-min-altitude-input');
        const maxAltitudeInput = modal.querySelector('#traffic-max-altitude-input');
        const showGroundInput = modal.querySelector('#traffic-show-ground-input');
        const altitudeModeInput = modal.querySelector('input[name="traffic-altitude-mode"]:checked');
        const relativeBandInput = modal.querySelector('#traffic-relative-band-input');
        const groundBandInput = modal.querySelector('#traffic-ground-band-input');
        const altitudeLabelInput = modal.querySelector('#traffic-altitude-label-input');
        const droneAdvisoriesInput = modal.querySelector('#traffic-drone-advisories-input');
        const onlyTrackedInput = modal.querySelector('#traffic-only-tracked-input');
        const onlyLightTypesInput = modal.querySelector('#traffic-only-light-types-input');

        return {
            radiusNm: radiusInput.value,
            minAltitudeFt: minAltitudeInput.value,
            maxAltitudeFt: maxAltitudeInput.value.trim() === ''
                ? null
                : maxAltitudeInput.value,
            trafficAroundOwnPosition: false,
            trafficAroundFire: false,
            showGroundTraffic: !!showGroundInput.checked,
            altitudeFilterMode: altitudeModeInput?.value || 'absolute',
            relativeAltitudeBandFt: relativeBandInput.value,
            groundToAboveBandFt: groundBandInput.value,
            showAltitudeLabel: !!altitudeLabelInput.checked,
            showDroneAdvisories: !!droneAdvisoriesInput.checked,
            onlyTrackedIdentifiers: !!onlyTrackedInput.checked,
            onlyNonAirplaneHelicopterTraffic: !!onlyLightTypesInput.checked
        };
    };

    const applyTrafficSettingsFromModal = (reason = 'settings-auto') => {
        saveTrafficSettings(readTrafficSettingsFromModal());
        refreshTrafficButtonState(lastTrafficDisplayedCount);

        if (showTrafficLayer) {
            refreshTrafficLayer({ force: true, reason });
        }
        scheduleBaseMapStabilityRefresh(reason);
    };

    modal.querySelectorAll('input[name="traffic-altitude-mode"]').forEach(input => {
        input.addEventListener('change', () => {
            updateAltitudeModeUi();
            applyTrafficSettingsFromModal('settings-auto-mode');
        });
    });

    /*
     * v17.00 — plus de bouton Appliquer.
     * `change` est volontairement utilisé pour les champs numériques : sur iPad,
     * la saisie est validée à la fin de l'édition sans lancer une requête réseau
     * à chaque chiffre. Les cases/radios restent immédiates.
     */
    modal.querySelectorAll(
        '.traffic-settings-grid input:not([name="traffic-altitude-mode"])'
    ).forEach(input => {
        input.addEventListener('change', () => {
            applyTrafficSettingsFromModal('settings-auto');
        });
    });

    modal.querySelector('#traffic-global-add-button')
        .addEventListener('click', () => {
            addTrackedTrafficFromModal(modal);
        });

    modal.querySelector('#traffic-global-search-button')
        .addEventListener('click', () => {
            performTrafficSearchFromModal(modal);
        });

    modal.querySelector('#traffic-global-search-input')
        .addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            performTrafficSearchFromModal(modal);
        });

    modal.querySelector('#traffic-settings-close').addEventListener('click', closeModal);

    modal.querySelector('#traffic-settings-reset').addEventListener('click', () => {
        fillDefaults();
        applyTrafficSettingsFromModal('settings-default');
    });

    modal.querySelector('#traffic-settings-cancel').addEventListener('click', () => {
        const snapshot = modal.__npfTrafficSettingsOpenSnapshot;
        if (snapshot) {
            saveTrafficSettings(snapshot);
            refreshTrafficButtonState(lastTrafficDisplayedCount);
            if (showTrafficLayer) {
                refreshTrafficLayer({ force: true, reason: 'settings-cancel' });
            }
            scheduleBaseMapStabilityRefresh('settings-cancel');
        }
        closeModal();
    });

    modal.querySelector('#traffic-own-aircraft-reset')
        .addEventListener('click', clearOwnTrafficAircraftSession);

    const applyManualOwnAircraft = () => {
        const input = modal.querySelector('#traffic-own-aircraft-manual-input');
        try {
            const entry = setOwnTrafficAircraftCallsign(input?.value || '', {
                source: 'MANUAL'
            });
            if (input) input.value = entry?.callsign || '';
            refreshOwnTrafficAircraftUi();
        } catch (error) {
            if (input) {
                input.setCustomValidity(error?.message || 'Indicatif invalide.');
                input.reportValidity();
                setTimeout(() => input.setCustomValidity(''), 0);
            }
        }
    };

    modal.querySelector('#traffic-own-aircraft-manual-apply')
        .addEventListener('click', applyManualOwnAircraft);
    modal.querySelector('#traffic-own-aircraft-manual-input')
        .addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            applyManualOwnAircraft();
        });

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    refreshTrackedTrafficListUi();
    refreshOwnTrafficAircraftUi();

    return modal;
}

function openTrafficSettingsDialog() {
    const current = sanitizeTrafficSettings(trafficSettings);
    const modal = ensureTrafficSettingsModal();

    /*
     * v17.00 — Annuler doit revenir à l'état exact de l'ouverture même si les
     * changements sont appliqués au fil de l'eau.
     */
    modal.__npfTrafficSettingsOpenSnapshot = {
        ...current
    };

    modal.querySelector('#traffic-radius-input').value = String(current.radiusNm);
    modal.querySelector('#traffic-min-altitude-input').value = String(current.minAltitudeFt);
    modal.querySelector('#traffic-max-altitude-input').value = current.maxAltitudeFt === null ? '' : String(current.maxAltitudeFt);
    modal.querySelector('#traffic-show-ground-input').checked = !!current.showGroundTraffic;
    modal.querySelector(`#traffic-altitude-mode-${current.altitudeFilterMode}`).checked = true;
    modal.querySelector('#traffic-relative-band-input').value = String(current.relativeAltitudeBandFt);
    modal.querySelector('#traffic-ground-band-input').value = String(current.groundToAboveBandFt);
    modal.querySelector('#traffic-altitude-label-input').checked = !!current.showAltitudeLabel;
    modal.querySelector('#traffic-drone-advisories-input').checked = !!current.showDroneAdvisories;
    modal.querySelector('#traffic-only-tracked-input').checked = !!current.onlyTrackedIdentifiers;
    modal.querySelector('#traffic-only-light-types-input').checked = !!current.onlyNonAirplaneHelicopterTraffic;

    const ownAircraft = getOwnTrafficAircraftSession();
    const manualOwnInput = modal.querySelector('#traffic-own-aircraft-manual-input');
    if (manualOwnInput) {
        manualOwnInput.value = ownAircraft?.callsign || ownAircraft?.registration || '';
    }

    refreshTrackedTrafficListUi();
    refreshOwnTrafficAircraftUi();

    try {
        const mode = current.altitudeFilterMode;
        const absoluteActive = mode === 'absolute';
        const aroundActive = mode === 'around';
        const groundActive = mode === 'ground';

        const minAltitudeInput = modal.querySelector('#traffic-min-altitude-input');
        const maxAltitudeInput = modal.querySelector('#traffic-max-altitude-input');
        const relativeBandInput = modal.querySelector('#traffic-relative-band-input');
        const groundBandInput = modal.querySelector('#traffic-ground-band-input');

        const absoluteAltitudeField = modal.querySelector('#traffic-altitude-absolute-mode-field');
        const aroundAltitudeField = modal.querySelector('#traffic-around-altitude-field');
        const groundAltitudeField = modal.querySelector('#traffic-ground-altitude-field');

        [minAltitudeInput, maxAltitudeInput].forEach(input => {
            if (input) input.disabled = !absoluteActive;
        });
        if (absoluteAltitudeField) {
            absoluteAltitudeField.classList.toggle(
                'traffic-settings-field-disabled',
                !absoluteActive
            );
        }

        if (relativeBandInput) relativeBandInput.disabled = !aroundActive;
        if (aroundAltitudeField) {
            aroundAltitudeField.classList.toggle(
                'traffic-settings-field-disabled',
                !aroundActive
            );
        }

        if (groundBandInput) groundBandInput.disabled = !groundActive;
        if (groundAltitudeField) {
            groundAltitudeField.classList.toggle(
                'traffic-settings-field-disabled',
                !groundActive
            );
        }
    } catch (_) {}

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
        try {
            modal.querySelector('#traffic-radius-input').focus({ preventScroll: true });
        } catch (_) {}
    }, 50);
}

/*
 * v15.67 — protection iPadOS des commandes prévues pour l'appui long.
 * Empêche Safari de transformer l'appui long en sélection de texte / callout
 * sans modifier le comportement des champs de saisie ni les gestes de carte.
 */
function protectNpfLongPressControlFromIosSelection(element) {
    if (!element || element.dataset?.npfLongPressSelectionProtected === '1') return;
    try { element.dataset.npfLongPressSelectionProtected = '1'; } catch (_) {}

    const protect = node => {
        if (!node) return;
        try {
            node.setAttribute?.('draggable', 'false');
            node.style.webkitUserSelect = 'none';
            node.style.userSelect = 'none';
            node.style.webkitTouchCallout = 'none';
            node.style.webkitUserDrag = 'none';
        } catch (_) {}
    };

    protect(element);
    try { element.querySelectorAll('*').forEach(protect); } catch (_) {}

    element.addEventListener('selectstart', event => {
        event.preventDefault();
        try { window.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
    });
    element.addEventListener('dragstart', event => event.preventDefault());
}

function installTrafficButtonInteractions(button) {
    if (!button || button.dataset.trafficBound === '1') return;
    button.dataset.trafficBound = '1';

    protectNpfLongPressControlFromIosSelection(button);

    let longPressTimer = null;
    let longPressTriggered = false;

    const isNonTrackedCounterTarget = event => (
        !!event?.target?.closest?.('#traffic-button-count')
    );

    const clearLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    const startLongPress = (event) => {
        /*
         * v15.95 — la pastille verte est une commande indépendante. Son appui
         * ne doit jamais démarrer le timer d'appui long du bouton principal.
         */
        if (isNonTrackedCounterTarget(event)) {
            clearLongPress();
            longPressTriggered = false;
            return;
        }
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        clearLongPress();
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            openTrafficSettingsDialog();
        }, 650);
    };

    button.addEventListener('selectstart', (event) => event.preventDefault());
    button.addEventListener('dragstart', (event) => event.preventDefault());
    button.addEventListener('pointerdown', startLongPress, { passive: false });
    button.addEventListener('pointerup', clearLongPress);
    button.addEventListener('pointerleave', clearLongPress);
    button.addEventListener('pointercancel', clearLongPress);
    button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        clearLongPress();
        if (isNonTrackedCounterTarget(event)) {
            event.stopPropagation();
            longPressTriggered = false;
            return;
        }
        longPressTriggered = true;
        openTrafficSettingsDialog();
    });
    button.addEventListener('click', (event) => {
        if (isNonTrackedCounterTarget(event)) {
            event.preventDefault();
            event.stopPropagation();
            longPressTriggered = false;
            toggleTrafficNonTrackedVisibility();
            return;
        }
        if (longPressTriggered) {
            event.preventDefault();
            event.stopPropagation();
            longPressTriggered = false;
            return;
        }
        toggleTrafficLayer();
    });
}


function buildSafeSkyApiEndpoint(relativePath = '') {
    return new URL(
        String(relativePath || '').replace(/^\/+/, ''),
        SAFESKY_API_BASE_URL
    );
}

async function fetchSafeSkyJson(
    url,
    {
        method = 'GET',
        body = null,
        allowNotFound = false,
        timeoutMs = TRAFFIC_FETCH_TIMEOUT_MS
    } = {}
) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        timeoutMs
    );

    try {
        const response = await fetch(
            url instanceof URL ? url.toString() : String(url),
            {
                method,
                cache: 'no-store',
                mode: 'cors',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'x-api-key': SAFESKY_API_KEY
                },
                body: body === null
                    ? undefined
                    : JSON.stringify(body)
            }
        );

        if (allowNotFound && response.status === 404) {
            return null;
        }

        let data = null;
        const contentType = String(
            response.headers.get('content-type') || ''
        ).toLowerCase();

        if (contentType.includes('json')) {
            try {
                data = await response.json();
            } catch (_) {
                data = null;
            }
        } else {
            try {
                data = await response.text();
            } catch (_) {
                data = null;
            }
        }

        if (!response.ok) {
            const apiError = new Error(
                String(
                    data?.error
                    || data?.message
                    || data
                    || `HTTP ${response.status}`
                ).trim()
            );
            apiError.status = response.status;
            apiError.method = method;
            throw apiError;
        }

        return data;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('délai de réponse SafeSky dépassé');
        }

        if (
            error instanceof TypeError
            && /fetch/i.test(String(error.message || ''))
        ) {
            throw new Error(
                'SafeSky direct inaccessible : réseau ou CORS'
            );
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function extractSingleSafeSkyBeacon(data) {
    if (!data) return null;
    if (Array.isArray(data)) return data[0] || null;
    if (data.beacon && typeof data.beacon === 'object') {
        return data.beacon;
    }
    if (data.data && !Array.isArray(data.data)) {
        return data.data;
    }
    if (
        typeof data === 'object'
        && (
            data.id
            || data.latitude !== undefined
            || data.call_sign
        )
    ) {
        return data;
    }
    return null;
}

async function fetchSafeSkyBeaconById(identifier) {
    const id = String(identifier || '')
        .trim()
        .toUpperCase();
    if (!id) return null;

    const url = buildSafeSkyApiEndpoint(
        encodeURIComponent(id)
    );
    const data = await fetchSafeSkyJson(
        url,
        { allowNotFound: true }
    );
    return extractSingleSafeSkyBeacon(data);
}

async function searchSafeSkyIdentityExact(query) {
    const normalizedQuery = String(query || '')
        .trim()
        .toUpperCase();

    if (!normalizedQuery) return [];

    const requests = [
        ['call_sign', normalizedQuery],
        ['aircraft_id', normalizedQuery]
    ].map(async ([parameter, value]) => {
        const url = buildSafeSkyApiEndpoint('search');
        url.searchParams.set(parameter, value);

        try {
            const data = await fetchSafeSkyJson(
                url,
                { allowNotFound: true }
            );
            return extractSingleSafeSkyBeacon(data);
        } catch (error) {
            console.warn(
                `Recherche d’identité SafeSky ${parameter} impossible:`,
                error
            );
            return null;
        }
    });

    const results = await Promise.all(requests);
    const uniqueResults = [];
    const seen = new Set();

    results.filter(Boolean).forEach(raw => {
        const identity = extractTrackedTrafficIdentity(raw);
        const key = identity.id || [
            identity.callsign,
            identity.registration
        ].filter(Boolean).join('|').toUpperCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        uniqueResults.push(raw);
    });

    return uniqueResults;
}

async function searchSafeSkyBeaconExact(query) {
    const normalizedQuery = String(query || '')
        .trim()
        .toUpperCase();

    if (!normalizedQuery) return [];

    const requests = [
        ['call_sign', normalizedQuery],
        ['aircraft_id', normalizedQuery]
    ].map(async ([parameter, value]) => {
        const url = buildSafeSkyApiEndpoint('search');
        url.searchParams.set(parameter, value);

        try {
            const data = await fetchSafeSkyJson(
                url,
                { allowNotFound: true }
            );
            return extractSingleSafeSkyBeacon(data);
        } catch (error) {
            console.warn(
                `Recherche SafeSky ${parameter} impossible:`,
                error
            );
            return null;
        }
    });

    const results = await Promise.all(requests);
    const uniqueResults = [];
    const seen = new Set();

    results.filter(Boolean).forEach(raw => {
        const normalized = normalizeTrafficAircraft(raw);
        const key = buildTrafficAircraftKey(normalized);
        if (!normalized || !key || seen.has(key)) return;
        seen.add(key);
        uniqueResults.push(raw);
    });

    return uniqueResults;
}

function buildTrafficSearchHaystack(aircraft) {
    return [
        aircraft?.callsign,
        aircraft?.hex,
        aircraft?.registration,
        aircraft?.aircraftModel,
        aircraft?.operatorName,
        aircraft?.type,
        aircraft?.beaconType
    ]
        .filter(Boolean)
        .join(' ')
        .toUpperCase();
}

function getTrafficSearchRank(aircraft, normalizedQuery) {
    const identifiers = [
        aircraft?.callsign,
        aircraft?.registration,
        aircraft?.hex
    ]
        .filter(Boolean)
        .map(value => String(value).trim().toUpperCase());

    if (identifiers.some(value => value === normalizedQuery)) return 0;
    if (identifiers.some(value => value.startsWith(normalizedQuery))) return 1;
    if (identifiers.some(value => value.includes(normalizedQuery))) return 2;
    return 3;
}

function filterTrafficSearchCandidates(
    candidates,
    query,
    {
        airborneOnly = false,
        limit = 50
    } = {}
) {
    const normalizedQuery = String(query || '')
        .trim()
        .toUpperCase();

    if (!normalizedQuery) return [];

    const unique = [];
    const seen = new Set();

    (Array.isArray(candidates) ? candidates : [])
        .map(normalizeTrafficAircraft)
        .filter(Boolean)
        .filter(ac => !airborneOnly || !ac.isGrounded)
        .filter(ac => (
            ac.forceDisplay
            || !Number.isFinite(ac.seenPos)
            || ac.seenPos <= TRAFFIC_MAX_SEEN_SECONDS
        ))
        .filter(ac => (
            buildTrafficSearchHaystack(ac)
                .includes(normalizedQuery)
        ))
        .sort((left, right) => {
            const rankDifference = (
                getTrafficSearchRank(left, normalizedQuery)
                - getTrafficSearchRank(right, normalizedQuery)
            );
            if (rankDifference) return rankDifference;

            const leftLabel = String(
                left.callsign
                || left.registration
                || left.hex
                || ''
            ).toUpperCase();
            const rightLabel = String(
                right.callsign
                || right.registration
                || right.hex
                || ''
            ).toUpperCase();
            return leftLabel.localeCompare(rightLabel, 'fr');
        })
        .forEach(ac => {
            const key = buildTrafficAircraftKey(ac);
            if (!key || seen.has(key)) return;
            seen.add(key);
            unique.push(ac.raw || ac);
        });

    return unique.slice(0, Math.max(1, limit));
}

function getLocalTrafficSearchResults(query) {
    const candidates = [
        ...(Array.isArray(lastTrafficAircraftSnapshot)
            ? lastTrafficAircraftSnapshot
            : []),
        ...getTemporaryGlobalTrafficRaw()
    ];

    const settings = sanitizeTrafficSettings(trafficSettings);
    return filterTrafficSearchCandidates(
        candidates,
        query,
        { airborneOnly: !settings.showGroundTraffic, limit: 50 }
    );
}

function getTrafficPartialSearchPoints() {
    const points = getTrafficQueryPoints();
    if (points.length) return points;

    try {
        const center = map?.getCenter?.();
        if (
            center
            && Number.isFinite(Number(center.lat))
            && Number.isFinite(Number(center.lng))
        ) {
            return [{
                lat: Number(center.lat),
                lon: Number(center.lng),
                label: 'centre carte',
                kind: 'search-center'
            }];
        }
    } catch (_) {}

    return [];
}

async function fetchActiveSafeSkyTrafficForPartialSearch() {
    const provider = TRAFFIC_API_PROVIDERS.find(candidate => (
        candidate?.dataFormat === 'safesky'
        && candidate?.urlFormat === 'viewport'
        && candidate?.baseUrl
    ));
    const points = getTrafficPartialSearchPoints();

    if (!provider) {
        return {
            candidates: [],
            pointCount: points.length,
            errors: ['source SafeSky indisponible']
        };
    }
    if (!points.length) {
        return {
            candidates: [],
            pointCount: 0,
            errors: ['centre de carte indisponible']
        };
    }

    const settled = await Promise.allSettled(
        points.map(async point => {
            const url = new URL(provider.baseUrl, window.location.href);
            url.searchParams.set(
                'viewport',
                buildSafeSkyViewport(point, getTrafficRadiusNm())
            );
            /*
             * Recherche par partie : ne pas appliquer le filtre d’altitude ni
             * la liste suivie. L’objectif est de retrouver tous les indicatifs
             * actifs autour du centre de la carte, sans modifier le calque affiché.
             */
            const settings = sanitizeTrafficSettings(trafficSettings);
            url.searchParams.set(
                'show_grounded',
                settings.showGroundTraffic ? 'true' : 'false'
            );
            const data = await fetchSafeSkyJson(url);
            return extractTrafficAircraftList(data);
        })
    );

    const candidates = [];
    const errors = [];
    settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            candidates.push(...result.value);
            return;
        }
        errors.push(
            `${points[index]?.label || 'zone'} : ${
                result.reason?.message
                || String(result.reason || 'erreur SafeSky')
            }`
        );
    });

    return {
        candidates,
        pointCount: points.length,
        errors
    };
}

function mergeTrafficSearchResults(...groups) {
    const result = [];
    const seen = new Set();

    groups.flat().filter(Boolean).forEach(raw => {
        const normalized = normalizeTrafficAircraft(raw);
        const key = buildTrafficAircraftKey(normalized);
        if (!normalized || !key || seen.has(key)) return;
        seen.add(key);
        result.push(raw);
    });

    return result;
}

function renderTrafficSearchResults(modal, results, message = '') {
    const container = modal?.querySelector(
        '#traffic-search-results'
    );
    if (!container) return;

    container.innerHTML = '';

    if (message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'traffic-search-message';
        messageElement.textContent = message;
        container.appendChild(messageElement);
    }

    if (!Array.isArray(results) || !results.length) {
        return;
    }

    results.forEach(raw => {
        const aircraft = normalizeTrafficAircraft(raw);
        if (!aircraft) return;

        const row = document.createElement('div');
        row.className = 'traffic-search-result-row';

        const description = document.createElement('div');
        description.className = 'traffic-search-result-description';

        const primary = document.createElement('strong');
        primary.textContent = (
            aircraft.callsign
            || aircraft.registration
            || aircraft.hex
            || 'Trafic'
        );

        const secondary = document.createElement('span');
        secondary.textContent = [
            aircraft.callsign
                && aircraft.callsign !== primary.textContent
                ? aircraft.callsign
                : '',
            getTrafficAircraftModel(aircraft)
                || getTrafficTypeDisplayLabel(aircraft),
            aircraft.hex
        ].filter(Boolean).join(' · ');

        description.append(primary, secondary);

        const actions = document.createElement('div');
        actions.className = 'traffic-search-result-actions';

        const showButton = document.createElement('button');
        showButton.type = 'button';
        showButton.className =
            'traffic-tool-button traffic-tool-button-primary';
        showButton.textContent = 'Afficher';
        showButton.addEventListener('click', async () => {
            await focusTrafficAircraftResult(raw);
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
        });

        const trackButton = document.createElement('button');
        trackButton.type = 'button';
        trackButton.className = 'traffic-tool-button';
        trackButton.textContent = isTrafficAircraftTracked(aircraft)
            ? 'Déjà suivi'
            : 'Ajouter à la liste';
        trackButton.disabled = isTrafficAircraftTracked(aircraft);
        trackButton.addEventListener('click', () => {
            try {
                addTrackedTrafficIdentifier(aircraft);
                trackButton.textContent = 'Déjà suivi';
                trackButton.disabled = true;
            } catch (error) {
                renderTrafficSearchResults(
                    modal,
                    results,
                    error.message
                );
            }
        });

        const ownAircraftButton = document.createElement('button');
        ownAircraftButton.type = 'button';
        ownAircraftButton.className =
            'traffic-tool-button traffic-own-aircraft-select-button';
        ownAircraftButton.textContent = isOwnTrafficAircraft(aircraft)
            ? 'Mon avion masqué'
            : 'Définir comme mon avion';
        ownAircraftButton.disabled = (
            !aircraft.hex
            || isOwnTrafficAircraft(aircraft)
        );
        ownAircraftButton.addEventListener('click', () => {
            try {
                setOwnTrafficAircraftSession(aircraft);
                renderTrafficSearchResults(
                    modal,
                    results,
                    'Ton avion est masqué pour cette session.'
                );
            } catch (error) {
                renderTrafficSearchResults(
                    modal,
                    results,
                    error.message
                );
            }
        });

        actions.append(
            showButton,
            trackButton,
            ownAircraftButton
        );
        row.append(description, actions);
        container.appendChild(row);
    });
}

async function addTrackedTrafficFromModal(modal) {
    const input = modal?.querySelector(
        '#traffic-global-search-input'
    );
    const addButton = modal?.querySelector(
        '#traffic-global-add-button'
    );
    const query = normalizeTrackedTrafficCallsign(input?.value || '');

    if (!query) {
        renderTrafficSearchResults(
            modal,
            [],
            'Saisis l’indicatif exact de l’avion à ajouter.'
        );
        return;
    }

    if (addButton?.dataset.loading === '1') return;
    if (addButton) {
        addButton.dataset.loading = '1';
        addButton.disabled = true;
        addButton.textContent = 'Ajout…';
    }

    renderTrafficSearchResults(
        modal,
        [],
        `Ajout de « ${query} » à la liste suivie…`
    );

    try {
        const alreadyTracked = getTrackedTrafficIdentifiers().find(entry => (
            normalizeTrackedTrafficCallsign(entry.callsign) === query
            || entry.id === query
        ));
        if (alreadyTracked) {
            throw new Error(
                `${query} est déjà présent dans la liste suivie.`
            );
        }

        let selectedRaw = null;
        try {
            const rawCandidates = await searchSafeSkyIdentityExact(query);
            const exactCandidates = rawCandidates
                .map(raw => ({
                    raw,
                    identity: extractTrackedTrafficIdentity(raw)
                }))
                .filter(candidate => (
                    candidate.identity.id
                    && (
                        normalizeTrackedTrafficCallsign(
                            candidate.identity.callsign
                        ) === query
                        || String(candidate.identity.registration || '')
                            .trim().toUpperCase() === query
                        || candidate.identity.id === query
                    )
                ));
            selectedRaw = exactCandidates[0]?.raw || null;
        } catch (searchError) {
            console.warn(
                'Résolution immédiate SafeSky indisponible, ajout en attente:',
                searchError
            );
        }

        if (selectedRaw) {
            addTrackedTrafficIdentifier(selectedRaw);
            renderTrafficSearchResults(
                modal,
                [],
                `${query} a été ajouté et associé à son identifiant SafeSky.`
            );
        } else {
            addPendingTrackedTrafficCallsign(query);
            renderTrafficSearchResults(
                modal,
                [],
                `${query} a été ajouté. Il sera associé automatiquement à son identifiant SafeSky dès sa première détection.`
            );
        }
    } catch (error) {
        renderTrafficSearchResults(
            modal,
            [],
            error?.message || 'Ajout impossible.'
        );
    } finally {
        if (addButton) {
            delete addButton.dataset.loading;
            addButton.disabled = false;
            addButton.textContent = 'Ajouter';
        }
    }
}

async function performTrafficSearchFromModal(modal) {
    const input = modal?.querySelector(
        '#traffic-global-search-input'
    );
    const query = String(input?.value || '')
        .trim()
        .toUpperCase();

    if (!query) {
        renderTrafficSearchResults(
            modal,
            [],
            'Saisis un indicatif ou une partie d’indicatif.'
        );
        return;
    }

    renderTrafficSearchResults(
        modal,
        [],
        `Recherche des indicatifs contenant « ${query} »…`
    );

    const localResults = getLocalTrafficSearchResults(query);
    const [exactOutcome, activeOutcome] = await Promise.allSettled([
        searchSafeSkyBeaconExact(query),
        fetchActiveSafeSkyTrafficForPartialSearch()
    ]);

    const exactResults = exactOutcome.status === 'fulfilled'
        ? exactOutcome.value
        : [];
    const activeSearch = activeOutcome.status === 'fulfilled'
        ? activeOutcome.value
        : {
            candidates: [],
            pointCount: 0,
            errors: [
                activeOutcome.reason?.message
                || String(activeOutcome.reason || 'erreur SafeSky')
            ]
        };
    const settings = sanitizeTrafficSettings(trafficSettings);
    const airborneOnly = !settings.showGroundTraffic;
    const exactFilteredResults = filterTrafficSearchCandidates(
        exactResults,
        query,
        { airborneOnly, limit: 50 }
    );
    const partialResults = filterTrafficSearchCandidates(
        activeSearch.candidates,
        query,
        { airborneOnly, limit: 50 }
    );

    const results = mergeTrafficSearchResults(
        exactFilteredResults,
        partialResults,
        localResults
    ).slice(0, 50);

    let message = '';
    if (!results.length) {
        const detail = activeSearch.errors?.length
            ? ` — ${activeSearch.errors.join(' / ')}`
            : '';
        message = (
            `Aucun trafic actif contenant « ${query} » autour du centre de la carte`
            + detail
        );
    } else {
        const zoneLabel = activeSearch.pointCount
            ? ` dans ${activeSearch.pointCount} zone carte`
            : '';
        message = (
            `${results.length} correspondance${results.length > 1 ? 's' : ''}`
            + zoneLabel
            + ' — indicatif exact recherché globalement.'
        );
    }

    renderTrafficSearchResults(modal, results, message);
}

function storeTemporaryGlobalTraffic(
    raw,
    { forceGroundDisplay = false } = {}
) {
    const normalized = normalizeTrafficAircraft(raw);
    const key = buildTrafficAircraftKey(normalized);
    if (!normalized || !key) return null;

    const rawCopy = {
        ...(normalized.raw || raw),
        _npfForceDisplay: true,
        _npfSearchResult: true,
        _npfForceGroundDisplay: Boolean(forceGroundDisplay)
    };

    temporaryGlobalTrafficResults.set(key, {
        raw: rawCopy,
        forceGroundDisplay: Boolean(forceGroundDisplay),
        expiresAt:
            Date.now() + TRAFFIC_TEMPORARY_SEARCH_RESULT_TTL_MS
    });

    return rawCopy;
}

function getTemporaryGlobalTrafficRaw() {
    const now = Date.now();
    const result = [];

    temporaryGlobalTrafficResults.forEach((entry, key) => {
        if (!entry || entry.expiresAt <= now) {
            temporaryGlobalTrafficResults.delete(key);
            return;
        }
        if (entry.raw) result.push(entry.raw);
    });

    return result;
}

function getTemporaryTrafficDisplayOverride(aircraft) {
    const key = buildTrafficAircraftKey(aircraft);
    if (!key) return null;

    const entry = temporaryGlobalTrafficResults.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
        temporaryGlobalTrafficResults.delete(key);
        return null;
    }

    return {
        forceDisplay: true,
        forceGroundDisplay: Boolean(
            entry.forceGroundDisplay
            || entry.raw?._npfForceGroundDisplay
        )
    };
}

async function focusTrafficAircraftResult(
    raw,
    { forceGroundDisplay = false } = {}
) {
    let currentRaw = raw;
    const normalized = normalizeTrafficAircraft(raw);
    const identifier = normalized?.hex;

    if (identifier) {
        try {
            currentRaw = (
                await fetchSafeSkyBeaconById(identifier)
            ) || raw;
        } catch (_) {}
    }

    const storedRaw = storeTemporaryGlobalTraffic(
        currentRaw,
        { forceGroundDisplay }
    );
    const aircraft = normalizeTrafficAircraft(storedRaw);

    if (!aircraft) {
        throw new Error('Position trafic indisponible');
    }

    if (!showTrafficLayer) {
        toggleTrafficLayer(true);
    } else if (
        trafficLayer
        && map
        && !map.hasLayer(trafficLayer)
    ) {
        trafficLayer.addTo(map);
    }

    const combined = [
        ...(Array.isArray(lastTrafficAircraftSnapshot)
            ? lastTrafficAircraftSnapshot
            : []),
        storedRaw
    ];

    renderTrafficAircraft(combined, {
        points: getTrafficQueryPoints(),
        provider: { label: 'SafeSky recherche' },
        now: Date.now()
    });

    try {
        map.setView(
            [aircraft.lat, aircraft.lon],
            Math.max(10, map.getZoom()),
            { animate: true }
        );
    } catch (_) {}

    const key = buildTrafficAircraftKey(aircraft);
    setTimeout(() => {
        try {
            trafficMarkerRegistry.get(key)?.marker?.openPopup();
        } catch (_) {}
    }, 300);

    return aircraft;
}

async function settleTrackedTrafficWithConcurrency(
    entries,
    worker,
    concurrency = TRAFFIC_TRACKED_FETCH_CONCURRENCY
) {
    const source = Array.isArray(entries) ? entries : [];
    if (!source.length) return [];

    const results = new Array(source.length);
    let nextIndex = 0;
    const workerCount = Math.max(
        1,
        Math.min(Number(concurrency) || 1, source.length)
    );

    const runners = Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= source.length) return;

            try {
                results[index] = {
                    status: 'fulfilled',
                    value: await worker(source[index], index)
                };
            } catch (reason) {
                results[index] = {
                    status: 'rejected',
                    reason
                };
            }
        }
    });

    await Promise.all(runners);
    return results;
}

async function fetchTrackedTrafficBeacons() {
    const entries = getTrackedTrafficIdentifiers();
    if (!entries.length) return [];

    const settled = await settleTrackedTrafficWithConcurrency(
        entries,
        async entry => {
            if (!isPendingTrackedTrafficIdentifier(entry.id)) {
                return {
                    entry,
                    raw: await fetchSafeSkyBeaconById(entry.id)
                };
            }

            const candidates = await searchSafeSkyIdentityExact(
                entry.callsign
            );
            const raw = candidates.find(candidate => {
                const identity = extractTrackedTrafficIdentity(candidate);
                return normalizeTrackedTrafficCallsign(identity.callsign)
                    === normalizeTrackedTrafficCallsign(entry.callsign);
            }) || null;

            return { entry, raw };
        }
    );

    const rawResults = [];
    let resolvedOneEntry = false;

    settled
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value)
        .forEach(({ entry, raw }) => {
            if (!raw) return;

            if (
                isPendingTrackedTrafficIdentifier(entry.id)
                && mergeResolvedTrackedTrafficIdentity(entry, raw)
            ) {
                resolvedOneEntry = true;
            }

            rawResults.push({
                ...raw,
                _npfForceDisplay: true,
                _npfTracked: true
            });
        });

    if (resolvedOneEntry) {
        refreshTrackedTrafficListUi();
    }

    return rawResults;
}

/*
 * v15.92 — compteur national de la liste suivie.
 * Les balises de la liste sont interrogées directement par identifiant, donc
 * ce compteur ne dépend ni du viewport ni du rayon actuellement affiché.
 */
function countTrackedTrafficDirectDetections(rawList) {
    const seen = new Set();

    (Array.isArray(rawList) ? rawList : [])
        .map(normalizeTrafficAircraft)
        .filter(Boolean)
        .filter(ac => !isOwnTrafficAircraft(ac))
        .forEach(ac => {
            const key = buildTrafficAircraftKey(ac);
            if (key) seen.add(key);
        });

    return seen.size;
}

/*
 * v14.41 — SafeSky est strictement utilisé en lecture.
 * Ces fonctions restent comme stubs de compatibilité interne, sans requête POST.
 */
async function publishOwnSafeSkyPosition() {
    stopSafeSkyOwnPublication();
    return false;
}

function stopSafeSkyOwnPublication() {
    if (safeSkyOwnPublishTimer) {
        clearInterval(safeSkyOwnPublishTimer);
        safeSkyOwnPublishTimer = null;
    }
    safeSkyOwnPublishInProgress = false;
}

function startSafeSkyOwnPublication() {
    stopSafeSkyOwnPublication();
}

function syncSafeSkyOwnPublication() {
    stopSafeSkyOwnPublication();
}

function getTrafficRadiusNm() {
    return sanitizeTrafficSettings(trafficSettings).radiusNm;
}

function parseTrafficAltitudeFeet(raw) {
    const altitudeRaw = raw?.alt_baro ?? raw?.alt_geom ?? raw?.altitude;
    if (altitudeRaw === 'ground') return 0;
    const altitudeNumber = Number(altitudeRaw);
    return Number.isFinite(altitudeNumber) ? Math.round(altitudeNumber) : null;
}

function getOwnTrafficPoint() {
    if (userMarker && typeof userMarker.getLatLng === 'function') {
        const ll = userMarker.getLatLng();
        if (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lng)) {
            const simulationPoint = isSimulationMode || lastPosition?.simulation === true;
            return { lat: ll.lat, lon: ll.lng, label: simulationPoint ? 'simulation' : 'GPS', kind: 'own' };
        }
    }

    if (lastPosition) {
        const lat = Number(lastPosition.lat ?? lastPosition.latitude);
        const lon = Number(lastPosition.lng ?? lastPosition.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const simulationPoint = isSimulationMode || lastPosition?.simulation === true;
            return { lat, lon, label: simulationPoint ? 'simulation' : 'GPS', kind: 'own' };
        }
    }

    return null;
}

function getFireTrafficPoint() {
    if (!currentCommune) return null;
    const lat = Number(currentCommune.latitude_mairie);
    const lon = Number(currentCommune.longitude_mairie);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, label: buildFireDisplayName(currentCommune) || 'feu', kind: 'fire' };
}

function getTrafficQueryPoints() {
    /*
     * v14.44 — les anciennes zones GPS et feu sont supprimées.
     * Le rayon SafeSky est toujours appliqué autour du centre actuel de la
     * carte, ce qui rend le comportement unique et prévisible.
     */
    try {
        const center = map?.getCenter?.();
        if (
            center
            && Number.isFinite(Number(center.lat))
            && Number.isFinite(Number(center.lng))
        ) {
            return [{
                lat: Number(center.lat),
                lon: Number(center.lng),
                label: 'centre carte',
                kind: 'all'
            }];
        }
    } catch (_) {}

    /* Secours de démarrage si Leaflet n'a pas encore fourni son centre. */
    const ownPoint = getOwnTrafficPoint();
    if (ownPoint) {
        return [{
            ...ownPoint,
            label: 'centre carte',
            kind: 'all'
        }];
    }

    return [];
}

function getOwnTrafficAltitudeFeet() {
    const candidates = [
        lastPosition?.altitudeFt,
        lastPosition?.altitudeFeet
    ];

    for (const candidate of candidates) {
        const num = Number(candidate);
        if (Number.isFinite(num)) return Math.round(num);
    }

    return null;
}

function getNearestTrafficReference(ac, points = []) {
    if (!ac || !Array.isArray(points) || !points.length) return null;
    let best = null;
    points.forEach(point => {
        const distance = calculateDistanceInNm(point.lat, point.lon, ac.lat, ac.lon);
        if (!Number.isFinite(distance)) return;
        if (!best || distance < best.distance) {
            best = { point, distance };
        }
    });
    return best;
}

function buildTrafficReferenceLabel(points = []) {
    if (!Array.isArray(points) || !points.length) return '';
    return points.map(point => point.label).filter(Boolean).join(' + ');
}

function buildTrafficAircraftKey(ac) {
    if (!ac) return '';
    if (ac.hex) return `hex:${ac.hex}`;

    const stableCallsign = String(ac.callsign || '').trim().toUpperCase();
    if (stableCallsign && stableCallsign !== 'N/A') {
        return `callsign:${stableCallsign}`;
    }

    return `pos:${Number(ac.lat).toFixed(4)}:${Number(ac.lon).toFixed(4)}`;
}

async function fetchTrafficAircraftForPoint(point, providers) {
    const errors = [];

    for (const provider of providers) {
        try {
            const result = await fetchTrafficAircraftFromProvider(point, provider);
            return { provider: result.provider, aircraft: result.aircraft, raw: result.raw, point };
        } catch (providerError) {
            const errText = providerError && providerError.message ? providerError.message : String(providerError);
            errors.push(`${provider.label}: ${errText}`);
            console.warn(`Trafic indisponible via ${provider.label} autour ${point.label}:`, providerError);
        }
    }

    throw new Error(errors.length ? `${point.label}: ${errors.join(' / ')}` : `${point.label}: aucune source disponible`);
}

