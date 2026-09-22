// =========================================================================
// v12.96 — calque trafic ADS-B indicatif
// =========================================================================
function getTrafficQueryPoint() {
    const points = getTrafficQueryPoints();
    return points.length ? points[0] : null;
}


function buildSafeSkyViewport(point, radiusNm = getTrafficRadiusNm()) {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    const radius = Math.max(5, Math.min(250, Number(radiusNm) || TRAFFIC_RADIUS_NM));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('Point SafeSky invalide');
    }

    /*
     * 1 degré de latitude ≈ 60 NM.
     * La longitude est corrigée par le cosinus de la latitude.
     * Une petite marge évite de couper un trafic placé exactement sur la limite.
     */
    const marginFactor = 1.03;
    const latDelta = (radius / 60) * marginFactor;
    const cosLatitude = Math.max(0.08, Math.cos(lat * Math.PI / 180));
    const lonDelta = (radius / (60 * cosLatitude)) * marginFactor;

    const latMin = Math.max(-90, lat - latDelta);
    const latMax = Math.min(90, lat + latDelta);
    const lonMin = Math.max(-180, lon - lonDelta);
    const lonMax = Math.min(180, lon + lonDelta);

    return [latMin, lonMin, latMax, lonMax]
        .map(value => Number(value).toFixed(4))
        .join(',');
}

function feetToSafeSkyMeters(feet) {
    const numericFeet = Number(feet);
    if (!Number.isFinite(numericFeet)) return null;
    return Math.max(0, Math.round(numericFeet / 3.280839895));
}

function getSafeSkyAltitudeQueryParameters() {
    const settings = sanitizeTrafficSettings(trafficSettings);
    const ownAltitudeFt = getOwnTrafficAltitudeFeet();

    let minAltitudeFt = null;
    let maxAltitudeFt = null;

    if (settings.altitudeFilterMode === 'absolute') {
        minAltitudeFt = settings.minAltitudeFt;
        maxAltitudeFt = settings.maxAltitudeFt;
    } else if (
        settings.altitudeFilterMode === 'around'
        && Number.isFinite(ownAltitudeFt)
    ) {
        minAltitudeFt = Math.max(
            0,
            ownAltitudeFt - settings.relativeAltitudeBandFt
        );
        maxAltitudeFt = ownAltitudeFt + settings.relativeAltitudeBandFt;
    } else if (
        settings.altitudeFilterMode === 'ground'
        && Number.isFinite(ownAltitudeFt)
    ) {
        minAltitudeFt = 0;
        maxAltitudeFt = ownAltitudeFt + settings.groundToAboveBandFt;
    }

    const result = {};
    const minMeters = feetToSafeSkyMeters(minAltitudeFt);
    const maxMeters = feetToSafeSkyMeters(maxAltitudeFt);

    /*
     * Dans l'API SafeSky, zéro signifie « filtre inutilisé ».
     * Ne transmettre altitude_min que lorsqu'il est strictement positif.
     */
    if (Number.isFinite(minMeters) && minMeters > 0) {
        result.altitude_min = String(minMeters);
    }
    if (Number.isFinite(maxMeters) && maxMeters > 0) {
        result.altitude_max = String(maxMeters);
    }

    return result;
}

function buildTrafficApiUrl(point, provider = null) {
    const activeProvider = provider || TRAFFIC_API_PROVIDERS[0];
    const lat = Number(point.lat).toFixed(4);
    const lon = Number(point.lon).toFixed(4);
    const radius = Math.max(5, Math.min(250, getTrafficRadiusNm()));

    if (!activeProvider?.baseUrl) {
        throw new Error(
            `${activeProvider?.label || 'Source trafic'} non configurée`
        );
    }

    if (activeProvider.urlFormat === 'viewport') {
        const viewport = buildSafeSkyViewport(point, radius);
        const url = new URL(activeProvider.baseUrl, window.location.href);

        url.searchParams.set('viewport', viewport);
        const settings = sanitizeTrafficSettings(trafficSettings);
        url.searchParams.set(
            'show_grounded',
            settings.showGroundTraffic ? 'true' : 'false'
        );

        const altitudeParameters = getSafeSkyAltitudeQueryParameters();
        Object.entries(altitudeParameters).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });

        if (settings.onlyTrackedIdentifiers) {
            const identifiers = getResolvedTrackedTrafficIdentifiers();

            /*
             * Une liste très longue dépasserait la taille raisonnable d'une URL.
             * Les appareils suivis restent tous interrogés directement plus bas ;
             * ce filtre viewport n'est utilisé que lorsqu'il tient dans une requête.
             */
            if (
                identifiers.length
                && identifiers.length <= TRAFFIC_VIEWPORT_IDENTIFIER_QUERY_LIMIT
            ) {
                url.searchParams.set(
                    'identifiers',
                    identifiers.join(',')
                );
            }
        }

        return url.toString();
    }

    if (activeProvider.urlFormat === 'point') {
        return `${activeProvider.baseUrl}/point/${lat}/${lon}/${radius}`;
    }

    return `${activeProvider.baseUrl}/lat/${lat}/lon/${lon}/dist/${radius}`;
}

function extractTrafficAircraftList(data) {
    if (Array.isArray(data?.beacons)) return data.beacons;
    if (Array.isArray(data?.aircraft)) return data.aircraft;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.ac)) return data.ac;
    if (Array.isArray(data)) return data;
    return [];
}

async function fetchTrafficAircraftFromProvider(point, provider) {
    const url = buildTrafficApiUrl(point, provider);
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        TRAFFIC_FETCH_TIMEOUT_MS
    );

    try {
        const response = await fetch(url, {
            cache: 'no-store',
            mode: 'cors',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': SAFESKY_API_KEY
            }
        });

        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }

        if (!response.ok || data?.ok === false) {
            const safeSkyMessage = String(
                data?.error
                || data?.message
                || `HTTP ${response.status}`
            ).trim();
            throw new Error(
                safeSkyMessage || `HTTP ${response.status}`
            );
        }

        return {
            provider,
            aircraft: extractTrafficAircraftList(data),
            raw: data
        };
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


function isSafeSkyAdvisory(raw) {
    return String(
        raw?.transponder_type
        || raw?.transponderType
        || ''
    ).trim().toUpperCase() === 'ADVISORY';
}

function parseSafeSkyOperationArea(raw) {
    let area = (
        raw?.operation_area
        ?? raw?.operationArea
        ?? null
    );

    if (typeof area === 'string') {
        try {
            area = JSON.parse(area);
        } catch (_) {
            area = null;
        }
    }

    if (
        area?.type === 'Feature'
        && area.geometry
    ) {
        return {
            geometry: area.geometry,
            properties: area.properties || {}
        };
    }

    if (
        area
        && typeof area === 'object'
        && typeof area.type === 'string'
        && area.coordinates
    ) {
        return {
            geometry: area,
            properties: area.properties || {}
        };
    }

    return null;
}

function formatSafeSkyAdvisoryAltitude(raw) {
    const altitudeMeters = Number(
        raw?.max_altitude
        ?? raw?.altitude
    );

    if (!Number.isFinite(altitudeMeters)) {
        return '--';
    }

    return `${Math.round(
        altitudeMeters * 3.280839895
    )} ft AMSL`;
}

function buildSafeSkyAdvisoryPopup(raw) {
    const title = String(
        raw?.call_sign
        || raw?.callsign
        || raw?.id
        || 'Zone d’activité drone'
    ).trim();

    const remarks = String(raw?.remarks || '').trim();
    const updatedAt = Number(raw?.last_update);

    return `
        <div class="traffic-popup traffic-advisory-popup">
            <div class="traffic-popup-title">
                ${escapeHtml(title)}
            </div>
            <div class="traffic-popup-subtitle">
                ZONE D’ACTIVITÉ DRONE DÉCLARÉE
            </div>
            <div>Altitude maximale :
                <b>${escapeHtml(
                    formatSafeSkyAdvisoryAltitude(raw)
                )}</b>
            </div>
            ${remarks
                ? `<div>Remarque : <b>${escapeHtml(remarks)}</b></div>`
                : ''}
            ${Number.isFinite(updatedAt)
                ? `<div>Mise à jour : <b>${escapeHtml(
                    new Date(updatedAt * 1000)
                        .toLocaleTimeString(
                            'fr-FR',
                            {
                                hour: '2-digit',
                                minute: '2-digit'
                            }
                        )
                )}</b></div>`
                : ''}
            <div class="traffic-popup-warning">
                Zone déclarative SafeSky — position exacte du drone non garantie
            </div>
        </div>
    `;
}

function renderSafeSkyAdvisories(rawList) {
    const targetLayer = trafficAdvisoryLayer || trafficLayer;
    if (!targetLayer) return 0;

    /*
     * v14.42 — les zones drone sont isolées des marqueurs mobiles. Leur
     * rafraîchissement ne détruit donc plus les aéronefs et ne coupe plus
     * leur animation entre deux réponses SafeSky.
     */
    targetLayer.clearLayers();

    const settings = sanitizeTrafficSettings(trafficSettings);
    if (!settings.showDroneAdvisories) return 0;

    let count = 0;

    (Array.isArray(rawList) ? rawList : [])
        .filter(isSafeSkyAdvisory)
        .forEach(raw => {
            const area = parseSafeSkyOperationArea(raw);
            const popup = buildSafeSkyAdvisoryPopup(raw);
            const commonStyle = {
                pane: 'trafficAdvisoryPane',
                color: '#7c3aed',
                weight: 3,
                opacity: 0.95,
                fillColor: '#c084fc',
                fillOpacity: 0.22,
                dashArray: '10 7',
                interactive: true
            };

            if (
                area?.geometry?.type === 'Point'
                && Array.isArray(area.geometry.coordinates)
            ) {
                const [longitude, latitude] =
                    area.geometry.coordinates.map(Number);
                const radius = Math.max(
                    50,
                    Number(
                        area.geometry.radius
                        ?? area.properties?.radius
                        ?? raw?.radius
                        ?? raw?.accuracy
                        ?? 500
                    ) || 500
                );

                if (
                    Number.isFinite(latitude)
                    && Number.isFinite(longitude)
                ) {
                    L.circle(
                        [latitude, longitude],
                        {
                            ...commonStyle,
                            radius
                        }
                    )
                        .bindPopup(popup, {
                            className:
                                'traffic-aircraft-popup traffic-advisory-leaflet-popup'
                        })
                        .addTo(targetLayer);
                    count += 1;
                }
                return;
            }

            if (area?.geometry) {
                try {
                    const geoJsonLayer = L.geoJSON(
                        {
                            type: 'Feature',
                            properties:
                                area.properties || {},
                            geometry: area.geometry
                        },
                        {
                            pane: 'trafficAdvisoryPane',
                            style: () => commonStyle,
                            pointToLayer: (
                                feature,
                                latlng
                            ) => L.circle(
                                latlng,
                                {
                                    ...commonStyle,
                                    radius: Math.max(
                                        50,
                                        Number(
                                            feature?.properties
                                                ?.radius
                                            ?? raw?.radius
                                            ?? raw?.accuracy
                                            ?? 500
                                        ) || 500
                                    )
                                }
                            )
                        }
                    );

                    geoJsonLayer.eachLayer(layer => {
                        layer.bindPopup(popup, {
                            className:
                                'traffic-aircraft-popup traffic-advisory-leaflet-popup'
                        });
                        layer.addTo(targetLayer);
                    });
                    count += 1;
                } catch (error) {
                    console.warn(
                        'Zone drone GeoJSON invalide:',
                        error,
                        raw
                    );
                }
                return;
            }

            const latitude = Number(
                raw?.latitude ?? raw?.lat
            );
            const longitude = Number(
                raw?.longitude
                ?? raw?.lon
                ?? raw?.lng
            );

            if (
                Number.isFinite(latitude)
                && Number.isFinite(longitude)
            ) {
                L.circle(
                    [latitude, longitude],
                    {
                        ...commonStyle,
                        radius: Math.max(
                            50,
                            Number(
                                raw?.radius
                                ?? raw?.accuracy
                                ?? 500
                            ) || 500
                        )
                    }
                )
                    .bindPopup(popup, {
                        className:
                            'traffic-aircraft-popup traffic-advisory-leaflet-popup'
                    })
                    .addTo(targetLayer);
                count += 1;
            }
        });

    return count;
}


function parseTrafficSourceTimestampMs(value, nowMs = Date.now()) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    let timestampMs = null;
    const numericValue = Number(value);

    if (Number.isFinite(numericValue)) {
        /*
         * SafeSky utilise normalement des secondes Unix. Le garde-fou accepte
         * aussi les millisecondes afin qu'un changement de format ne fige pas
         * silencieusement l'extrapolation locale.
         */
        if (Math.abs(numericValue) >= 1e12) {
            timestampMs = numericValue;
        } else if (Math.abs(numericValue) >= 1e9) {
            timestampMs = numericValue * 1000;
        }
    } else if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) timestampMs = parsed;
    }

    if (!Number.isFinite(timestampMs)) return null;

    /* Tolérance à un léger décalage d'horloge, sans accepter une date future. */
    if (timestampMs > nowMs + 30000) return nowMs;
    return timestampMs;
}

function normalizeTrafficAircraft(raw) {
    if (!raw) return null;

    const safeSkyFormat = (
        raw.latitude !== undefined
        || raw.longitude !== undefined
        || raw.beacon_type !== undefined
        || raw.transponder_type !== undefined
        || raw.call_sign !== undefined
    );

    /*
     * SafeSky ADVISORY décrit une zone déclarée d'activité drone.
     * Ce n'est pas une position mobile : elle ne doit pas utiliser le symbole avion.
     * Le support cartographique des zones ADVISORY pourra être ajouté séparément.
     */
    if (String(raw.transponder_type || '').toUpperCase() === 'ADVISORY') {
        return null;
    }

    const latitudeRaw = raw.lat ?? raw.latitude;
    const longitudeRaw = raw.lon ?? raw.longitude;
    if (!Number.isFinite(Number(latitudeRaw)) || !Number.isFinite(Number(longitudeRaw))) {
        return null;
    }

    const callsign = String(
        raw.flight
        || raw.callsign
        || raw.call_sign
        || raw.registration
        || raw.r
        || raw.id
        || raw.hex
        || ''
    ).trim() || 'N/A';

    const trafficId = String(raw.hex || raw.id || '').trim().toUpperCase();
    const lat = Number(latitudeRaw);
    const lon = Number(longitudeRaw);

    let seenPos = null;
    const normalizedAtMs = Date.now();
    let sourceTimestampMs = normalizedAtMs;
    const safeSkyTimestampMs = safeSkyFormat
        ? parseTrafficSourceTimestampMs(
            raw.last_update ?? raw.lastUpdate,
            normalizedAtMs
        )
        : null;

    if (Number.isFinite(safeSkyTimestampMs)) {
        sourceTimestampMs = safeSkyTimestampMs;
        seenPos = Math.max(
            0,
            (normalizedAtMs - sourceTimestampMs) / 1000
        );
    } else if (Number.isFinite(Number(raw.seen_pos))) {
        seenPos = Number(raw.seen_pos);
        sourceTimestampMs = Date.now() - seenPos * 1000;
    } else if (Number.isFinite(Number(raw.seen))) {
        seenPos = Number(raw.seen);
        sourceTimestampMs = Date.now() - seenPos * 1000;
    }

    let altitudeFeet = null;
    let altitude = '--';
    const safeSkyAltitudeMeters = Number(raw.altitude);

    if (
        safeSkyFormat
        && Number.isFinite(safeSkyAltitudeMeters)
        && safeSkyAltitudeMeters > -9000
    ) {
        altitudeFeet = Math.round(
            safeSkyAltitudeMeters * 3.280839895
        );
        altitude = `${altitudeFeet} ft`;
    } else {
        const altitudeRaw = raw.alt_baro ?? raw.alt_geom ?? raw.altitude;
        altitudeFeet = parseTrafficAltitudeFeet(raw);
        altitude = altitudeRaw === 'ground'
            ? 'GND'
            : (Number.isFinite(Number(altitudeRaw)) ? `${Math.round(Number(altitudeRaw))} ft` : '--');
    }

    let groundSpeedKnots = null;
    if (safeSkyFormat && Number.isFinite(Number(raw.ground_speed))) {
        groundSpeedKnots = Number(raw.ground_speed) * 1.943844492;
    } else if (Number.isFinite(Number(raw.gs))) {
        groundSpeedKnots = Number(raw.gs);
    }
    const gs = Number.isFinite(groundSpeedKnots) ? `${Math.round(groundSpeedKnots)} kt` : '--';

    const trackRaw = safeSkyFormat ? raw.course : raw.track;
    const track = Number.isFinite(Number(trackRaw)) ? Number(trackRaw) : null;
    const beaconType = String(raw.beacon_type || '').trim().toUpperCase();
    const emitterCategory = String(
        raw.category
        || raw.emitter_category
        || raw.emitterCategory
        || ''
    ).trim().toUpperCase();
    const type = String(
        raw.beacon_type
        || raw.t
        || raw.aircraft_type
        || raw.type
        || ''
    ).trim();

    const registration = String(
        raw.registration
        || raw.registration_number
        || raw.tail_number
        || raw.tail
        || raw.r
        || ''
    ).trim();

    const source = String(
        raw.transponder_type
        || raw.source
        || raw.type
        || raw.dbFlags
        || ''
    ).trim();

    const status = String(raw.status || '').trim().toUpperCase();
    const remarks = String(raw.remarks || '').trim();

    /*
     * Ces champs ne sont pas garantis par le modèle public SafeSky, mais ils
     * sont conservés lorsqu'une réponse enrichie les fournit.
     */
    const operatorName = String(
        raw.operator_name
        || raw.operator
        || raw.airline_name
        || raw.airline
        || raw.company_name
        || raw.company
        || raw.owner_name
        || raw.owner
        || ''
    ).trim();

    const aircraftModel = String(
        raw.aircraft_model
        || raw.aircraft_model_name
        || raw.model_name
        || raw.model
        || raw.type_description
        || raw.aircraft_description
        || raw.icao_type_designator
        || raw.type_designator
        || ''
    ).trim();

    let verticalRateFpm = null;
    if (safeSkyFormat && Number.isFinite(Number(raw.vertical_rate))) {
        verticalRateFpm = Math.round(
            Number(raw.vertical_rate) * 196.8503937
        );
    }

    const turnRateDegPerSec = Number.isFinite(
        Number(raw.turn_rate)
    )
        ? Number(raw.turn_rate)
        : null;

    const forceDisplay = Boolean(
        raw._npfForceDisplay
        || raw._npfTracked
        || raw._npfSearchResult
    );

    if (status === 'INACTIVE') {
        return null;
    }

    const isGrounded = (
        status === 'GROUNDED'
        || String(raw.alt_baro || '').toLowerCase() === 'ground'
    );

    if (isGrounded) {
        altitude = 'SOL';
    }

    return {
        callsign,
        hex: trafficId,
        lat,
        lon,
        seenPos,
        sourceTimestampMs,
        receivedAtMs: normalizedAtMs,
        altitude,
        altitudeFeet,
        gs,
        groundSpeedKnots,
        track,
        turnRateDegPerSec,
        type,
        beaconType,
        emitterCategory,
        registration,
        source,
        status,
        isGrounded,
        remarks,
        operatorName,
        aircraftModel,
        verticalRateFpm,
        forceDisplay,
        providerFormat: safeSkyFormat ? 'safesky' : 'readsb',
        raw
    };
}

function formatTrafficAge(seconds) {
    if (!Number.isFinite(seconds)) return 'âge inconnu';
    if (seconds < 60) return `${Math.round(seconds)} s`;
    return `${Math.round(seconds / 60)} min`;
}

function getTrafficRelativeAltitudeState(aircraft) {
    if (aircraft?.isGrounded) {
        return {
            className: 'traffic-altitude-grounded',
            label: 'Trafic au sol',
            deltaFt: null
        };
    }

    const ownAltitudeFt = getOwnTrafficAltitudeFeet();
    const trafficAltitudeFt = Number(aircraft?.altitudeFeet);

    if (!Number.isFinite(ownAltitudeFt) || !Number.isFinite(trafficAltitudeFt)) {
        return {
            className: 'traffic-altitude-unknown',
            label: 'Altitude relative inconnue',
            deltaFt: null
        };
    }

    const deltaFt = Math.round(trafficAltitudeFt - ownAltitudeFt);

    if (Math.abs(deltaFt) <= 500) {
        return {
            className: 'traffic-altitude-same',
            label: 'Même tranche d’altitude ±500 ft',
            deltaFt
        };
    }

    if (deltaFt < -500) {
        return {
            className: 'traffic-altitude-below',
            label: 'Trafic en dessous',
            deltaFt
        };
    }

    return {
        className: 'traffic-altitude-above',
        label: 'Trafic au-dessus',
        deltaFt
    };
}


function resolveTrafficVisualType(aircraft) {
    const safeSkyType = String(aircraft?.beaconType || '').trim().toUpperCase();
    const emitterCategory = String(aircraft?.emitterCategory || '').trim().toUpperCase();
    const designator = String(aircraft?.type || '').trim().toUpperCase();

    /*
     * Priorité 1 : catégorie explicite SafeSky.
     */
    const safeSkyMapping = {
        JET: 'jet',
        HELICOPTER: 'helicopter',
        GLIDER: 'glider',
        UAV: 'uav',
        BALLOON: 'balloon',
        AIRSHIP: 'airship',
        PARACHUTE: 'parachute',
        PARA_GLIDER: 'paraglider',
        HAND_GLIDER: 'hangglider',
        HANG_GLIDER: 'hangglider',
        GYROCOPTER: 'gyrocopter',
        MILITARY: 'military',
        FLEX_WING_TRIKES: 'pendular',
        PARA_MOTOR: 'paramotor',
        THREE_AXES_LIGHT_PLANE: 'ultralight',
        MOTORPLANE: 'airplane',
        PAV: 'pav',
        STATIC_OBJECT: 'static'
    };
    if (safeSkyMapping[safeSkyType]) return safeSkyMapping[safeSkyType];

    /*
     * Priorité 2 : catégorie d'émetteur ADS-B/readsb.
     * Elle permet déjà d'afficher correctement hélicoptères, planeurs,
     * ballons, parachutistes, ULM et drones avant l'arrivée de SafeSky.
     */
    const emitterMapping = {
        A0: 'airplane',
        A1: 'airplane',
        A2: 'airplane',
        A3: 'jet',
        A4: 'jet',
        A5: 'jet',
        A6: 'military',
        A7: 'helicopter',
        B0: 'airplane',
        B1: 'glider',
        B2: 'balloon',
        B3: 'parachute',
        B4: 'ultralight',
        B5: 'airplane',
        B6: 'uav',
        B7: 'airplane',
        C0: 'static',
        C1: 'static',
        C2: 'static',
        C3: 'static',
        C4: 'static'
    };
    if (emitterMapping[emitterCategory]) return emitterMapping[emitterCategory];

    /*
     * Priorité 3 : désignateur ICAO de type.
     *
     * Cette classification ne prétend pas reproduire la silhouette exacte de
     * chaque modèle. Elle choisit la bonne grande famille visuelle.
     */
    const widebodyJetPattern = /^(?:A30[06B]|A310|A33[0-9]|A34[0-9]|A35[0-9]|A38[08]|B74[1-8RS]|B76[2-4]|B77[2-39LW]|B78[89X]|DC10|L101|IL96|AN12[4-9]|C5M)/;
    if (widebodyJetPattern.test(designator)) {
        return 'widebody-jet';
    }

    const narrowbodyJetPattern = /^(?:A18[89]|A19[0-9N]|A20N|A21N|A22[0-9]|A31[89]|A32[0-9]|B70[37]|B71[27]|B72[0-2]|B73[1-9]|B37M|B38M|B39M|B75[23]|BCS[13]|F70|F100|MD8[0-9]|MD90|DC9)/;
    if (narrowbodyJetPattern.test(designator)) {
        return 'narrowbody-jet';
    }

    const regionalJetPattern = /^(?:CRJ[1-9X]|E17[05]|E19[05]|E29[05]|E135|E145|E170|E175|E190|E195|ARJ2|RJ1H|RJ70|RJ85|RJ1X)/;
    if (regionalJetPattern.test(designator)) {
        return 'regional-jet';
    }

    const turbopropDesignatorPattern = /^(?:AT4[3-6]|AT7[2-6]|DH8[ABCD]|Q400|SF34|E120|F50|F60|D328|C212|C295|CN35|AN2[468]|AN32|L410|BE20|BE30|B350|SW4|JS3[12]|JS41|C130|C160|P3|P8)/;
    if (turbopropDesignatorPattern.test(designator)) {
        return 'turboprop';
    }

    const lightTwinPattern = /^(?:BE5[568]|BE9[59]|BE10|BE18|BE24|BE33|BE35|BE36|BE50|BE55|BE58|BE60|BE65|BE76|BE77|BE80|BE90|C303|C310|C320|C335|C336|C337|C340|C401|C402|C404|C411|C414|C421|C425|C441|DA42|DA62|PA23|PA30|PA31|PA34|PA39|PA44|P68|BN2|AC50|AC56|AC68)/;
    if (lightTwinPattern.test(designator)) {
        return 'light-twin';
    }

    const lightSinglePattern = /^(?:C1[025-9][025-9]|C20[568]|C21[02]|C22[0-9]|C23[0-9]|C24[0-9]|C25[0-9]|C26[0-9]|C27[0-9]|C28[0-9]|C182|C172|C152|C150|C206|C210|PA18|PA20|PA22|PA24|PA28|PA32|PA38|SR20|SR22|DA20|DA40|DR40|DR30|RALL|JAB[24]|VL3|WT9|PIVI|M20[ABCEJMKRS]|BE23|BE24|BE33|BE35|BE36)/;
    if (lightSinglePattern.test(designator)) {
        return 'light-single';
    }

    const helicopterDesignatorPattern = /^(?:H[0-9A-Z]{1,3}|EC[0-9A-Z]{2,4}|AS[0-9A-Z]{2,4}|SA[0-9A-Z]{2,4}|R22|R44|R66|B06|B47|S76|AW[0-9A-Z]{2,4}|BK17|H145|H135|H160|H175|H225|NH90|TIGR)/;
    if (helicopterDesignatorPattern.test(designator)) {
        return 'helicopter';
    }

    const gliderDesignatorPattern = /^(?:GLID|ASW|DG[0-9A-Z]*|DUOD|LS[0-9A-Z]*|JS[0-9A-Z]*|SZD|ASK|ASTR|VENT|DISC|NIMB|JANU|ARCUS)/;
    if (gliderDesignatorPattern.test(designator)) {
        return 'glider';
    }

    const gyrocopterDesignatorPattern = /^(?:GYRO|MTO|CAVAL|MAGN|ELA|XENON)/;
    if (gyrocopterDesignatorPattern.test(designator)) {
        return 'gyrocopter';
    }

    return 'airplane';
}

/*
 * v16.01 — filtre « N'afficher que parapentes, deltaplanes, planeurs, etc. ».
 * On filtre sur la famille visuelle déjà normalisée afin de couvrir à la fois
 * les catégories SafeSky, les catégories ADS-B et les désignateurs ICAO de repli.
 */
const TRAFFIC_LIGHT_TYPES_HIDDEN_VISUAL_TYPES = new Set([
    'airplane',
    'jet',
    'widebody-jet',
    'narrowbody-jet',
    'regional-jet',
    'turboprop',
    'light-single',
    'light-twin',
    'helicopter',
    'military'
]);

function isTrafficAircraftHiddenByLightTypesFilter(aircraft) {
    return TRAFFIC_LIGHT_TYPES_HIDDEN_VISUAL_TYPES.has(
        resolveTrafficVisualType(aircraft)
    );
}

/*
 * v16.04 — signal visuel de provenance SafeSky pour les trafics hors liste.
 * ADS-B et MODE-S restent fixes. Les autres sources non ADS-B déjà concernées
 * continuent de clignoter. Une source absente reste fixe afin de ne pas attribuer
 * une provenance par défaut.
 */
function shouldBlinkTrafficAircraftSource(aircraft) {
    const source = String(aircraft?.source || '')
        .trim()
        .toUpperCase();
    if (!source) return false;

    const compactSource = source.replace(/[^A-Z0-9]/g, '');
    return !['ADSB', 'MODES'].includes(compactSource);
}

function getTrafficTypeDisplayLabel(aircraft) {
    const safeSkyType = String(
        aircraft?.beaconType
        || aircraft?.type
        || ''
    ).trim().toUpperCase();

    const labels = {
        JET: 'JET',
        MOTORPLANE: 'AVION',
        THREE_AXES_LIGHT_PLANE: 'ULM',
        HELICOPTER: 'HÉLICOPTÈRE',
        GLIDER: 'PLANEUR',
        UAV: 'DRONE',
        BALLOON: 'BALLON',
        AIRSHIP: 'DIRIGEABLE',
        PARACHUTE: 'PARACHUTISTE',
        PARA_GLIDER: 'PARAPENTE',
        HAND_GLIDER: 'DELTAPLANE',
        HANG_GLIDER: 'DELTAPLANE',
        GYROCOPTER: 'AUTOGIRE',
        MILITARY: 'MILITAIRE',
        FLEX_WING_TRIKES: 'PENDULAIRE',
        PARA_MOTOR: 'PARAMOTEUR',
        PAV: 'PAV',
        STATIC_OBJECT: 'OBJET STATIQUE'
    };

    if (labels[safeSkyType]) {
        return labels[safeSkyType];
    }

    /*
     * Repli sur la catégorie visuelle lorsque SafeSky ne fournit pas de type
     * exploitable. Les désignations techniques ne sont jamais montrées.
     */
    const visual = getTrafficAircraftVisualDefinition(aircraft);
    return String(visual?.label || 'AVION').toUpperCase();
}


function getTrafficAircraftVisualDefinition(aircraft) {
    const visualType = resolveTrafficVisualType(aircraft);

    /*
     * v14.26 — pictogrammes originaux volontairement rapprochés du langage
     * graphique SafeSky montré en référence :
     * - silhouettes simples et monochromes ;
     * - vues de dessus pour les aéronefs directionnels ;
     * - pictogrammes filaires pour hélicoptère, drones et voilures légères ;
     * - proportions homogènes dans un viewBox 64 × 64.
     */
    const definitions = {
        airplane: {
            className: 'airplane',
            directional: true,
            label: 'AVION',
            svg: `
                <!-- Avion léger : aile droite et empennage droit -->
                <path class="ss-fill" d="M29 4h6l1.2 21H58v7H36.5l-.8 14H47v6H35.4L34.7 59h-5.4l-.7-7H17v-6h11.3l-.8-14H6v-7h21.8L29 4Z"/>
                <rect class="ss-fill" x="27" y="1.8" width="10" height="4.4" rx="1"/>
            `
        },
        jet: {
            className: 'jet',
            directional: true,
            label: 'JET',
            svg: `
                <!-- Jet : ailes et empennage volontairement en flèche -->
                <path class="ss-fill" d="M30 2h4l4.7 21.5 18 10.7v6.5l-18.9-5.6-1.7 10.7 10.8 8.8v4.2L32 55l-14.9 3.8v-4.2l10.8-8.8-1.7-10.7-18.9 5.6v-6.5l18-10.7L30 2Z"/>
            `
        },
        helicopter: {
            className: 'helicopter',
            directional: true,
            label: 'HÉLICOPTÈRE',
            svg: `
                <g class="ss-line">
                    <path d="M32 8v39"/>
                    <path d="M13 13l38 38"/>
                    <path d="M51 13 13 51"/>
                    <path d="M23 30h18"/>
                    <path d="M32 47v10"/>
                    <path d="M26 57h12"/>
                </g>
                <ellipse class="ss-fill" cx="32" cy="32" rx="6.5" ry="13"/>
                <circle class="ss-ring" cx="32" cy="18" r="3.3"/>
            `
        },
        glider: {
            className: 'glider',
            directional: true,
            label: 'PLANEUR',
            svg: `
                <!-- Planeur : grande aile droite et empennage sans flèche -->
                <path class="ss-fill" d="M30.5 3h3l1.1 26H62v4.8H34.8l-.7 16.2h8.4v4.5h-8.6L33.5 61h-3l-.4-6.5h-8.6V50h8.4l-.7-16.2H2V29h27.4l1.1-26Z"/>
                <path class="ss-cut" d="M31.2 7h1.6v14h-1.6Z"/>
            `
        },
        uav: {
            className: 'uav',
            directional: false,
            label: 'DRONE',
            svg: `
                <g class="ss-line">
                    <path d="M22 22l20 20M42 22 22 42"/>
                    <path d="M32 25v14M25 32h14"/>
                </g>
                <circle class="ss-ring" cx="17" cy="17" r="8"/>
                <circle class="ss-ring" cx="47" cy="17" r="8"/>
                <circle class="ss-ring" cx="17" cy="47" r="8"/>
                <circle class="ss-ring" cx="47" cy="47" r="8"/>
                <rect class="ss-fill" x="26" y="26" width="12" height="12" rx="3"/>
            `
        },
        pav: {
            className: 'pav',
            directional: false,
            label: 'PAV',
            svg: `
                <g class="ss-line">
                    <path d="M32 11v10M32 43v10M14 21l9 6M41 37l9 6M14 43l9-6M41 27l9-6"/>
                </g>
                <circle class="ss-ring" cx="32" cy="8" r="6"/>
                <circle class="ss-ring" cx="54" cy="20" r="6"/>
                <circle class="ss-ring" cx="54" cy="44" r="6"/>
                <circle class="ss-ring" cx="32" cy="56" r="6"/>
                <circle class="ss-ring" cx="10" cy="44" r="6"/>
                <circle class="ss-ring" cx="10" cy="20" r="6"/>
                <circle class="ss-ring" cx="32" cy="32" r="11"/>
                <circle class="ss-fill" cx="32" cy="32" r="4"/>
            `
        },
        balloon: {
            className: 'balloon',
            directional: false,
            label: 'BALLON',
            svg: `
                <path class="ss-fill" d="M32 5c13 0 21 9 21 21 0 11-7 19-16 25h-10C18 45 11 37 11 26 11 14 19 5 32 5Z"/>
                <path class="ss-cut" d="M22 10c-2 11-1 26 7 39M42 10c2 11 1 26-7 39M12 26h40"/>
                <rect class="ss-fill" x="27" y="53" width="10" height="7" rx="1.5"/>
            `
        },
        airship: {
            className: 'airship',
            directional: true,
            label: 'DIRIGEABLE',
            svg: `
                <ellipse class="ss-fill" cx="30" cy="31" rx="25" ry="14"/>
                <path class="ss-fill" d="M51 25l10-7v10l-5 3 5 3v10l-10-7Z"/>
                <path class="ss-cut" d="M10 31h40"/>
                <path class="ss-fill" d="M26 45h12l-2 7h-8l-2-7Z"/>
            `
        },
        parachute: {
            className: 'parachute',
            directional: false,
            label: 'PARACHUTISTE',
            svg: `
                <path class="ss-fill ss-hangglider-color" d="M7 29C9 15 19 7 32 7s23 8 25 22H7Z"/>
                <path class="ss-cut" d="M17 28c2-9 7-15 15-20M47 28C45 19 40 13 32 8M32 8v20"/>
                <g class="ss-line ss-hangglider-line">
                    <path d="M12 29l17 18M52 29 35 47M24 29l7 18M40 29l-7 18"/>
                    <path d="M32 47v8M26 60l6-5 6 5"/>
                </g>
                <circle class="ss-fill ss-hangglider-color" cx="32" cy="48" r="3.5"/>
            `
        },
        paraglider: {
            className: 'paraglider',
            directional: false,
            label: 'PARAPENTE',
            svg: `
                <!-- Parapente : voilure segmentée et petit pilote -->
                <path class="ss-fill ss-paraglider-color" d="M4 30C9 16 19 8 32 8s23 8 28 22c-9-4.7-18.3-7-28-7S13 25.3 4 30Z"/>
                <path class="ss-cut" d="M12 26.8c3.1-8 7.1-13 12-16M23.5 24.2c1.5-7.7 4.3-13 8.5-16.2M40.5 24.2c-1.5-7.7-4.3-13-8.5-16.2M52 26.8c-3.1-8-7.1-13-12-16"/>
                <rect class="ss-fill ss-paraglider-color" x="27" y="38.5" width="10" height="5.5" rx="2"/>
                <path class="ss-line ss-paraglider-line" d="M10 28.5 29 39M54 28.5 35 39M22 24.5 31 39M42 24.5 33 39"/>
            `
        },
        hangglider: {
            className: 'hangglider',
            directional: true,
            label: 'DELTAPLANE',
            svg: `
                <!-- Deltaplane : chevron simple et barre/pilote sous l'aile -->
                <path class="ss-fill ss-hangglider-color" d="M7 37 32 17l25 20-25-9.2L7 37Z"/>
                <rect class="ss-fill ss-hangglider-color" x="26.5" y="42.5" width="11" height="4.5" rx="1.6"/>
            `
        },
        gyrocopter: {
            className: 'gyrocopter',
            directional: true,
            label: 'AUTOGIRE',
            svg: `
                <g class="ss-line">
                    <path d="M6 10h52"/>
                    <path d="M32 10v24"/>
                    <path d="M21 35h26l10 9H31l-8 8H10"/>
                    <path d="M44 34l8-11"/>
                </g>
                <circle class="ss-ring" cx="18" cy="53" r="6"/>
                <circle class="ss-ring" cx="47" cy="53" r="6"/>
                <circle class="ss-fill" cx="32" cy="31" r="5"/>
            `
        },
        military: {
            className: 'military',
            directional: true,
            label: 'MILITAIRE',
            svg: `
                <path class="ss-fill" d="M30 3h4l5 20 17 10v7l-18-4-2 10 10 9v5l-14-5-14 5v-5l10-9-2-10-18 4v-7l17-10 5-20Z"/>
                <path class="ss-cut" d="M32 9v42"/>
            `
        },
        'widebody-jet': {
            className: 'widebody-jet',
            directional: true,
            label: 'JET',
            svg: `
                <path class="ss-fill" d="M28 3h8l5 20 18 10v8l-20-5-2 11 11 9v4l-16-4-16 4v-4l11-9-2-11-20 5v-8l18-10 5-20Z"/>
            `
        },
        'narrowbody-jet': {
            className: 'narrowbody-jet',
            directional: true,
            label: 'JET',
            svg: `
                <path class="ss-fill" d="M29 3h6l4 21 18 9v7l-19-4-2 11 10 8v4l-14-3-14 3v-4l10-8-2-11-19 4v-7l18-9 4-21Z"/>
            `
        },
        'regional-jet': {
            className: 'regional-jet',
            directional: true,
            label: 'JET',
            svg: `
                <path class="ss-fill" d="M29 5h6l3 20 16 8v6l-17-3-2 12 8 7v4l-11-3-11 3v-4l8-7-2-12-17 3v-6l16-8 3-20Z"/>
            `
        },
        turboprop: {
            className: 'turboprop',
            directional: true,
            label: 'AVION',
            svg: `
                <path class="ss-fill" d="M29 4h6l2 20 20 8v6l-20-3-1 13 8 7v4l-12-3-12 3v-4l8-7-1-13-20 3v-6l20-8 2-20Z"/>
                <g class="ss-line">
                    <circle cx="16" cy="31" r="5"/>
                    <circle cx="48" cy="31" r="5"/>
                    <path d="M16 23v16M8 31h16M48 23v16M40 31h16"/>
                </g>
            `
        },
        'light-single': {
            className: 'light-single',
            directional: true,
            label: 'AVION',
            svg: `
                <path class="ss-fill" d="M29 5h6l1 18 18 8v6l-18-3v14l8 7v4l-12-3-12 3v-4l8-7V34l-18 3v-6l18-8 1-18Z"/>
                <path class="ss-cut" d="M25 18h14"/>
            `
        },
        'light-twin': {
            className: 'light-twin',
            directional: true,
            label: 'AVION',
            svg: `
                <path class="ss-fill" d="M29 5h6l1 18 19 8v6l-19-3v14l8 7v4l-12-3-12 3v-4l8-7V34L9 37v-6l19-8 1-18Z"/>
                <circle class="ss-ring" cx="18" cy="29" r="4"/>
                <circle class="ss-ring" cx="46" cy="29" r="4"/>
            `
        },
        ultralight: {
            className: 'ultralight',
            directional: true,
            label: 'ULM',
            svg: `
                <!-- ULM 3 axes : aile droite et empennage rectangulaire -->
                <path class="ss-fill" d="M29 5h6l1.1 20H57v7H36.3l-.8 14.5h10v6H35.2L34.5 59h-5l-.7-6.5H18.5v-6h10l-.8-14.5H7v-7h20.9L29 5Z"/>
                <rect class="ss-fill" x="27" y="2.5" width="10" height="4.5" rx="1.2"/>
            `
        },
        pendular: {
            className: 'pendular',
            directional: true,
            label: 'PENDULAIRE',
            svg: `
                <path class="ss-fill ss-hangglider-color" d="M4 22 32 7l28 15-28 8L4 22Z"/>
                <path class="ss-cut" d="M32 8v21M8 22h48"/>
                <g class="ss-line ss-hangglider-line">
                    <path d="M32 29v14M23 50l9-7 9 7"/>
                    <path d="M25 54h14"/>
                </g>
                <circle class="ss-ring ss-hangglider-ring" cx="24" cy="55" r="4"/>
                <circle class="ss-ring ss-hangglider-ring" cx="40" cy="55" r="4"/>
                <circle class="ss-fill ss-hangglider-color" cx="32" cy="42" r="3"/>
            `
        },
        paramotor: {
            className: 'paramotor',
            directional: false,
            label: 'PARAMOTEUR',
            svg: `
                <path class="ss-fill ss-paraglider-color" d="M7 22C15 11 23 7 32 7s17 4 25 15c-9-4-17-6-25-6S16 18 7 22Z"/>
                <g class="ss-line ss-paraglider-line">
                    <path d="M12 22l17 21M52 22 35 43M23 19l8 24M41 19l-8 24"/>
                    <path d="M32 43v10M27 59l5-6 5 6"/>
                </g>
                <circle class="ss-fill ss-paraglider-color" cx="32" cy="44" r="3.5"/>
                <circle class="ss-ring ss-paraglider-ring" cx="42" cy="47" r="8"/>
                <path class="ss-line ss-paraglider-line" d="M42 39v16M34 47h16"/>
            `
        },
        static: {
            className: 'static',
            directional: false,
            label: 'OBJET STATIQUE',
            svg: `
                <g class="ss-line">
                    <path d="M32 8v48M8 32h48"/>
                    <circle cx="32" cy="32" r="13"/>
                </g>
                <circle class="ss-fill" cx="32" cy="32" r="5"/>
            `
        }
    };

    return definitions[visualType] || definitions.airplane;
}

function getTrafficCompactIdentifier(aircraft) {
    const callsign = String(aircraft?.callsign || '').trim().toUpperCase();
    const registration = String(aircraft?.registration || '').trim().toUpperCase();
    const trafficId = String(aircraft?.hex || '').trim().toUpperCase();

    const invalidValues = new Set(['', 'N/A', 'UNKNOWN', '--']);

    /*
     * L'indicatif opérationnel est prioritaire lorsqu'il est réellement fourni.
     * S'il n'est pas exploitable, utiliser l'immatriculation puis l'identifiant.
     */
    if (!invalidValues.has(callsign)) {
        return callsign;
    }

    if (!invalidValues.has(registration)) {
        return registration;
    }

    if (!invalidValues.has(trafficId)) {
        return trafficId;
    }

    return '';
}


const TRAFFIC_AIRLINE_ICAO_NAMES = Object.freeze({
    AFR: 'Air France',
    TVF: 'Transavia France',
    CCM: 'Air Corsica',
    HOP: 'HOP!',
    FPO: 'ASL Airlines France',
    CRL: 'Corsair',
    RYR: 'Ryanair',
    EZY: 'easyJet',
    EJU: 'easyJet Europe',
    VOE: 'Volotea',
    VLG: 'Vueling',
    IBE: 'Iberia',
    I2L: 'Iberia Express',
    BAW: 'British Airways',
    DLH: 'Lufthansa',
    SWR: 'Swiss',
    BEL: 'Brussels Airlines',
    KLM: 'KLM',
    TAP: 'TAP Air Portugal',
    ITY: 'ITA Airways',
    SAS: 'SAS',
    NSZ: 'Norwegian',
    WZZ: 'Wizz Air',
    EIN: 'Aer Lingus',
    THY: 'Turkish Airlines',
    UAE: 'Emirates',
    QTR: 'Qatar Airways',
    ETD: 'Etihad Airways',
    AAL: 'American Airlines',
    DAL: 'Delta Air Lines',
    UAL: 'United Airlines',
    FDX: 'FedEx Express',
    UPS: 'UPS Airlines'
});

function getTrafficCompanyName(aircraft) {
    const directName = String(aircraft?.operatorName || '').trim();
    if (directName) {
        return directName;
    }

    const callsign = String(aircraft?.callsign || '')
        .trim()
        .toUpperCase();

    const prefixMatch = callsign.match(/^([A-Z]{3})/);
    if (!prefixMatch) {
        return '';
    }

    return TRAFFIC_AIRLINE_ICAO_NAMES[prefixMatch[1]] || '';
}

function getTrafficAircraftModel(aircraft) {
    const rawModel = String(aircraft?.aircraftModel || '').trim();
    if (!rawModel) {
        return '';
    }

    const technicalValues = new Set([
        String(aircraft?.beaconType || '').trim().toUpperCase(),
        String(aircraft?.source || '').trim().toUpperCase(),
        'UNKNOWN',
        'MOTORPLANE',
        'THREE_AXES_LIGHT_PLANE',
        'JET',
        'HELICOPTER',
        'GLIDER',
        'UAV'
    ]);

    if (technicalValues.has(rawModel.toUpperCase())) {
        return '';
    }

    return rawModel;
}

function getTrafficPermanentIdentifier(aircraft) {
    const registration = String(aircraft?.registration || '')
        .trim()
        .toUpperCase();

    if (registration) {
        return registration;
    }

    return getTrafficCompactIdentifier(aircraft);
}

function getTrafficPermanentType(aircraft) {
    return (
        getTrafficAircraftModel(aircraft)
        || getTrafficTypeDisplayLabel(aircraft)
    );
}

function compactTrafficLabelText(value, maxLength = 18) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function getTrafficVerticalTrend(aircraft) {
    const verticalRateFpm = Number(aircraft?.verticalRateFpm);

    if (!Number.isFinite(verticalRateFpm) || aircraft?.isGrounded) {
        return {
            symbol: '',
            className: 'traffic-trend-level',
            label: ''
        };
    }

    if (verticalRateFpm > 0) {
        return {
            /*
             * Le sélecteur de présentation texte évite un rendu emoji sur
             * Safari/iPadOS et conserve une flèche aéronautique nette.
             */
            symbol: '↗︎',
            className: 'traffic-trend-climb',
            label: 'Montée'
        };
    }

    if (verticalRateFpm < 0) {
        return {
            symbol: '↘︎',
            className: 'traffic-trend-descent',
            label: 'Descente'
        };
    }

    return {
        symbol: '',
        className: 'traffic-trend-level',
        label: ''
    };
}

/*
 * v14.79 — vecteur vitesse par traits de 50 kt.
 * 0 à 50 kt : 1 trait ; puis un trait supplémentaire par tranche de 50 kt.
 */
const TRAFFIC_VECTOR_SPEED_STEP_KT = 50;
const TRAFFIC_VECTOR_SEGMENT_LENGTH_PX = 8;
const TRAFFIC_VECTOR_SEGMENT_GAP_PX = 5;
const TRAFFIC_VECTOR_MAX_SEGMENTS = 20;
const TRAFFIC_VECTOR_CANVAS_CENTER_PX = 280;
const TRAFFIC_VECTOR_CANVAS_SIZE_PX = 560;

function getTrafficSpeedVectorSegmentCount(aircraft) {
    const rawSpeedKnots = aircraft?.groundSpeedKnots;

    if (
        rawSpeedKnots === null
        || rawSpeedKnots === undefined
        || rawSpeedKnots === ''
    ) {
        return 0;
    }

    const speedKnots = Number(rawSpeedKnots);
    if (!Number.isFinite(speedKnots)) return 0;

    return Math.max(
        1,
        Math.min(
            TRAFFIC_VECTOR_MAX_SEGMENTS,
            Math.ceil(Math.max(0, speedKnots) / TRAFFIC_VECTOR_SPEED_STEP_KT)
        )
    );
}

function getTrafficSpeedVectorLengthPx(aircraft) {
    const segmentCount = getTrafficSpeedVectorSegmentCount(aircraft);
    if (!segmentCount) return 0;

    return (
        segmentCount * TRAFFIC_VECTOR_SEGMENT_LENGTH_PX
        + (segmentCount - 1) * TRAFFIC_VECTOR_SEGMENT_GAP_PX
    );
}



const TRAFFIC_VECTOR_TURN_HORIZON_SECONDS = 8;

function buildTrafficCurvedVectorPath(
    vectorLengthPx,
    turnRateDegPerSec
) {
    const canvasCenter = TRAFFIC_VECTOR_CANVAS_CENTER_PX;
    const length = Math.max(
        0,
        Number(vectorLengthPx) || 0
    );

    if (length <= 0) return '';

    const turnAngleDeg = Math.max(
        -70,
        Math.min(
            70,
            (
                Number(turnRateDegPerSec) || 0
            ) * TRAFFIC_VECTOR_TURN_HORIZON_SECONDS
        )
    );
    const turnAngleRad = turnAngleDeg * Math.PI / 180;

    if (Math.abs(turnAngleDeg) < 2) {
        return `M ${canvasCenter} ${canvasCenter} L ${canvasCenter} ${canvasCenter - length}`;
    }

    const endX = canvasCenter
        + Math.sin(turnAngleRad) * length;
    const endY = canvasCenter
        - Math.cos(turnAngleRad) * length;
    const controlAngle = turnAngleRad * 0.48;
    const controlDistance = length * 0.58;
    const controlX = canvasCenter
        + Math.sin(controlAngle) * controlDistance;
    const controlY = canvasCenter
        - Math.cos(controlAngle) * controlDistance;

    return [
        `M ${canvasCenter} ${canvasCenter}`,
        `Q ${controlX.toFixed(2)} ${controlY.toFixed(2)}`,
        `${endX.toFixed(2)} ${endY.toFixed(2)}`
    ].join(' ');
}

function buildTrafficVectorHtml(
    aircraft,
    track,
    vectorLengthPx
) {
    const segmentCount = getTrafficSpeedVectorSegmentCount(aircraft);
    if (vectorLengthPx <= 0 || segmentCount <= 0) return '';

    const path = buildTrafficCurvedVectorPath(
        vectorLengthPx,
        aircraft?.turnRateDegPerSec
    );

    if (!path) return '';

    /*
     * `pathLength` calibre exactement le motif 8 px / 5 px : la longueur
     * calculée se termine après le dernier trait, sans demi-segment final.
     */
    return `
        <span class="traffic-aircraft-vector-wrap"
              data-speed-segments="${segmentCount}"
              style="transform: rotate(${track}deg);">
            <svg class="traffic-speed-vector-svg"
                 viewBox="0 0 ${TRAFFIC_VECTOR_CANVAS_SIZE_PX} ${TRAFFIC_VECTOR_CANVAS_SIZE_PX}"
                 aria-hidden="true"
                 focusable="false">
                <path class="traffic-speed-vector-path"
                      pathLength="${vectorLengthPx}"
                      d="${path}"></path>
            </svg>
        </span>
    `;
}

function destinationFromBearingDistance(
    latitude,
    longitude,
    bearingDegrees,
    distanceMeters
) {
    const earthRadiusMeters = 6371008.8;
    const angularDistance =
        distanceMeters / earthRadiusMeters;
    const bearing =
        bearingDegrees * Math.PI / 180;
    const latitudeRad =
        latitude * Math.PI / 180;
    const longitudeRad =
        longitude * Math.PI / 180;

    const destinationLatitude = Math.asin(
        Math.sin(latitudeRad)
            * Math.cos(angularDistance)
        + Math.cos(latitudeRad)
            * Math.sin(angularDistance)
            * Math.cos(bearing)
    );

    const destinationLongitude = longitudeRad
        + Math.atan2(
            Math.sin(bearing)
                * Math.sin(angularDistance)
                * Math.cos(latitudeRad),
            Math.cos(angularDistance)
                - Math.sin(latitudeRad)
                * Math.sin(destinationLatitude)
        );

    return {
        lat: destinationLatitude * 180 / Math.PI,
        lon: (
            (
                destinationLongitude * 180 / Math.PI
                + 540
            ) % 360
        ) - 180
    };
}

function extrapolateTrafficAircraft(
    aircraft,
    targetTimestampMs = Date.now()
) {
    if (!aircraft) return null;

    const baseLatitude = Number(aircraft.lat);
    const baseLongitude = Number(aircraft.lon);
    const speedMps = Number(
        aircraft.groundSpeedKnots
    ) / 1.943844492;
    const trackValue = aircraft.track;
    const baseTrack = (
        trackValue === null
        || trackValue === undefined
        || trackValue === ''
    )
        ? NaN
        : Number(trackValue);
    const turnRate = Number(
        aircraft.turnRateDegPerSec
    ) || 0;
    const sourceTimestampMs = Number(
        aircraft.sourceTimestampMs
    ) || targetTimestampMs;
    const receivedAtMs = Number.isFinite(
        Number(aircraft.receivedAtMs)
    )
        ? Number(aircraft.receivedAtMs)
        : sourceTimestampMs;

    if (
        aircraft.isGrounded
        || !Number.isFinite(baseLatitude)
        || !Number.isFinite(baseLongitude)
        || !Number.isFinite(speedMps)
        || speedMps <= 0
        || !Number.isFinite(baseTrack)
    ) {
        return {
            lat: baseLatitude,
            lon: baseLongitude,
            track: Number.isFinite(baseTrack)
                ? baseTrack
                : 0
        };
    }

    /*
     * v14.72 — séparation des deux temps.
     *
     * Avant : la limite de 8 s partait de last_update SafeSky. Un point reçu
     * avec 8 s d'âge avait donc déjà épuisé toute son extrapolation et restait
     * immobile entre deux réponses.
     *
     * Maintenant :
     * 1) on rattrape raisonnablement l'âge du point jusqu'à sa réception ;
     * 2) on continue à le faire avancer pendant 15 s APRÈS cette réception.
     */
    const sourceCatchupSeconds = Math.max(
        0,
        Math.min(
            TRAFFIC_SOURCE_CATCHUP_MAX_SECONDS,
            (receivedAtMs - sourceTimestampMs) / 1000
        )
    );
    const liveElapsedSeconds = Math.max(
        0,
        Math.min(
            TRAFFIC_MAX_EXTRAPOLATION_SECONDS,
            (targetTimestampMs - receivedAtMs) / 1000
        )
    );
    const elapsedSeconds =
        sourceCatchupSeconds + liveElapsedSeconds;

    if (elapsedSeconds <= 0) {
        return {
            lat: baseLatitude,
            lon: baseLongitude,
            track: baseTrack
        };
    }

    let latitude = baseLatitude;
    let longitude = baseLongitude;
    let track = baseTrack;
    let remaining = elapsedSeconds;

    /*
     * Intégration par pas de 0,25 s : suffisamment fluide pour un virage tout
     * en restant légère sur iPad, même avec plusieurs dizaines de trafics.
     */
    while (remaining > 0.0001) {
        const step = Math.min(0.25, remaining);
        const midTrack = track + turnRate * step * 0.5;
        const destination = destinationFromBearingDistance(
            latitude,
            longitude,
            midTrack,
            speedMps * step
        );

        latitude = destination.lat;
        longitude = destination.lon;
        track = (
            (
                track + turnRate * step
            ) % 360
            + 360
        ) % 360;
        remaining -= step;
    }

    return {
        lat: latitude,
        lon: longitude,
        track
    };
}

function normalizeTrafficTrackDegrees(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return ((numeric % 360) + 360) % 360;
}

function interpolateTrafficTrackDegrees(fromTrack, toTrack, progress) {
    const from = normalizeTrafficTrackDegrees(fromTrack);
    const to = normalizeTrafficTrackDegrees(toTrack);
    if (!Number.isFinite(to)) return Number.isFinite(from) ? from : 0;
    if (!Number.isFinite(from)) return to;

    const shortestDelta = ((to - from + 540) % 360) - 180;
    return normalizeTrafficTrackDegrees(from + shortestDelta * progress);
}

function interpolateTrafficLongitude(fromLongitude, toLongitude, progress) {
    const from = Number(fromLongitude);
    const to = Number(toLongitude);
    if (!Number.isFinite(from)) return to;
    if (!Number.isFinite(to)) return from;

    const shortestDelta = ((to - from + 540) % 360) - 180;
    return ((from + shortestDelta * progress + 540) % 360) - 180;
}


function applyTrafficMotionFallbackFromHistory(
    previousAircraft,
    aircraft
) {
    if (
        !previousAircraft
        || !aircraft
        || aircraft.isGrounded
    ) {
        return aircraft;
    }

    const previousLat = Number(previousAircraft.lat);
    const previousLon = Number(previousAircraft.lon);
    const currentLat = Number(aircraft.lat);
    const currentLon = Number(aircraft.lon);

    if (
        !Number.isFinite(previousLat)
        || !Number.isFinite(previousLon)
        || !Number.isFinite(currentLat)
        || !Number.isFinite(currentLon)
    ) {
        return aircraft;
    }

    const previousSourceAt = Number(
        previousAircraft.sourceTimestampMs
    );
    const currentSourceAt = Number(
        aircraft.sourceTimestampMs
    );
    const previousReceivedAt = Number(
        previousAircraft.receivedAtMs
    );
    const currentReceivedAt = Number(
        aircraft.receivedAtMs
    );

    let elapsedSeconds = (
        Number.isFinite(previousSourceAt)
        && Number.isFinite(currentSourceAt)
    )
        ? (currentSourceAt - previousSourceAt) / 1000
        : NaN;

    if (
        !Number.isFinite(elapsedSeconds)
        || elapsedSeconds < TRAFFIC_MOTION_ESTIMATION_MIN_SECONDS
        || elapsedSeconds > TRAFFIC_MOTION_ESTIMATION_MAX_SECONDS
    ) {
        elapsedSeconds = (
            Number.isFinite(previousReceivedAt)
            && Number.isFinite(currentReceivedAt)
        )
            ? (currentReceivedAt - previousReceivedAt) / 1000
            : NaN;
    }

    if (
        !Number.isFinite(elapsedSeconds)
        || elapsedSeconds < TRAFFIC_MOTION_ESTIMATION_MIN_SECONDS
        || elapsedSeconds > TRAFFIC_MOTION_ESTIMATION_MAX_SECONDS
    ) {
        return aircraft;
    }

    const distanceNm = calculateDistanceInNm(
        previousLat,
        previousLon,
        currentLat,
        currentLon
    );

    if (
        !Number.isFinite(distanceNm)
        || distanceNm < 0.002
    ) {
        return aircraft;
    }

    const estimatedSpeedKnots =
        distanceNm * 3600 / elapsedSeconds;

    if (
        !Number.isFinite(estimatedSpeedKnots)
        || estimatedSpeedKnots <= 1
        || estimatedSpeedKnots
            > TRAFFIC_MOTION_ESTIMATION_MAX_SPEED_KNOTS
    ) {
        return aircraft;
    }

    const currentSpeedKnots = Number(
        aircraft.groundSpeedKnots
    );

    /*
     * Certaines balises SafeSky fournissent la position et la route sans
     * ground_speed exploitable. Le déplacement entre les deux derniers points
     * devient alors la vitesse locale de secours.
     */
    if (
        !Number.isFinite(currentSpeedKnots)
        || currentSpeedKnots <= 1
    ) {
        aircraft.groundSpeedKnots =
            estimatedSpeedKnots;
        aircraft.gs =
            `${Math.round(estimatedSpeedKnots)} kt`;
    }

    const currentTrackValue = aircraft.track;
    if (
        currentTrackValue === null
        || currentTrackValue === undefined
        || currentTrackValue === ''
        || !Number.isFinite(Number(currentTrackValue))
    ) {
        aircraft.track = calculateBearing(
            previousLat,
            previousLon,
            currentLat,
            currentLon
        );
    }

    return aircraft;
}

function getTrafficReconciledPosition(entry, predicted, nowMs) {
    const correction = entry?.correction;
    if (!correction) return predicted;

    const durationMs = Math.max(
        1,
        Number(correction.durationMs)
            || TRAFFIC_RECONCILIATION_DURATION_MS
    );
    const rawProgress = Math.max(
        0,
        Math.min(1, (nowMs - correction.startedAt) / durationMs)
    );

    /* Courbe douce sans ralentir durablement la trajectoire. */
    const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    const rendered = {
        lat: correction.fromLat
            + (predicted.lat - correction.fromLat) * progress,
        lon: interpolateTrafficLongitude(
            correction.fromLon,
            predicted.lon,
            progress
        ),
        track: interpolateTrafficTrackDegrees(
            correction.fromTrack,
            predicted.track,
            progress
        )
    };

    if (rawProgress >= 1) {
        entry.correction = null;
    }

    return rendered;
}

function applyTrafficMarkerTrack(marker, track) {
    if (!marker || !Number.isFinite(Number(track))) return;

    const normalizedTrack = normalizeTrafficTrackDegrees(track);
    const markerElement = marker.getElement?.();
    const arrow = markerElement?.querySelector(
        '.traffic-aircraft-arrow'
    );
    const vector = markerElement?.querySelector(
        '.traffic-aircraft-vector-wrap'
    );
    const aircraft = marker._npfTrafficAircraft;
    const visual = getTrafficAircraftVisualDefinition(aircraft);

    if (arrow && visual?.directional) {
        arrow.style.transform =
            `translate(-50%, -50%) rotate(${normalizedTrack}deg)`;
    }

    if (vector) {
        vector.style.transform =
            `rotate(${normalizedTrack}deg)`;
    }
}

function prepareTrafficMarkerReconciliation(entry, aircraft, nowMs) {
    if (!entry?.marker || !aircraft) return;

    const markerLatLng = entry.marker.getLatLng?.();
    const predicted = extrapolateTrafficAircraft(aircraft, nowMs);

    entry.aircraft = aircraft;
    entry.marker._npfTrafficAircraft = aircraft;

    if (
        !markerLatLng
        || !predicted
        || !Number.isFinite(markerLatLng.lat)
        || !Number.isFinite(markerLatLng.lng)
        || !Number.isFinite(predicted.lat)
        || !Number.isFinite(predicted.lon)
    ) {
        entry.correction = null;
        return;
    }

    const correctionDistanceNm = calculateDistanceInNm(
        markerLatLng.lat,
        markerLatLng.lng,
        predicted.lat,
        predicted.lon
    );

    if (
        !Number.isFinite(correctionDistanceNm)
        || correctionDistanceNm > TRAFFIC_RECONCILIATION_MAX_DISTANCE_NM
    ) {
        entry.correction = null;
        entry.marker.setLatLng([predicted.lat, predicted.lon]);
        entry.renderedTrack = predicted.track;
        applyTrafficMarkerTrack(entry.marker, predicted.track);
        return;
    }

    entry.correction = {
        fromLat: markerLatLng.lat,
        fromLon: markerLatLng.lng,
        fromTrack: Number.isFinite(entry.renderedTrack)
            ? entry.renderedTrack
            : predicted.track,
        startedAt: nowMs,
        durationMs: TRAFFIC_RECONCILIATION_DURATION_MS
    };
}

function removeTrafficMarkerEntry(key, entry) {
    const marker = entry?.marker;
    if (marker) {
        marker._npfTrafficRemoved = true;

        /*
         * v15.79 — nettoyage explicite avant retrait Leaflet. Safari/WebKit
         * pouvait parfois conserver une réminiscence de l'étiquette ou de son
         * connecteur après disparition du trafic.
         */
        try {
            const icon = marker._icon;
            if (icon) {
                icon.querySelectorAll?.(
                    '.traffic-aircraft-altitude-label, .traffic-label-connector'
                )?.forEach?.(node => node.remove());
            }
        } catch (_) {}
        try { marker.closePopup?.(); } catch (_) {}
        try { marker.unbindPopup?.(); } catch (_) {}
        try {
            if (trafficLayer) trafficLayer.removeLayer(marker);
        } catch (_) {}
        try {
            if (marker._icon?.isConnected) marker._icon.remove();
        } catch (_) {}
    }

    trafficMarkerRegistry.delete(key);
}

function clearTrafficDisplay() {
    stopTrafficSmoothAnimation();
    if (trafficLabelConnectorRefreshTimer) {
        clearTimeout(trafficLabelConnectorRefreshTimer);
        trafficLabelConnectorRefreshTimer = null;
    }

    Array.from(trafficMarkerRegistry.entries())
        .forEach(([key, entry]) => {
            removeTrafficMarkerEntry(key, entry);
        });

    try {
        trafficAdvisoryLayer?.clearLayers?.();
    } catch (_) {}
}

function isTrafficVisualUpdatesSuspended() {
    return trafficVisualSuspensionReasons.size > 0;
}

function suspendTrafficVisualUpdates(reason = 'temporary') {
    trafficVisualSuspensionReasons.add(String(reason || 'temporary'));
    stopTrafficSmoothAnimation();
}

function resumeTrafficVisualUpdates(
    reason = 'temporary',
    options = {}
) {
    trafficVisualSuspensionReasons.delete(String(reason || 'temporary'));

    if (isTrafficVisualUpdatesSuspended()) return;
    if (!showTrafficLayer || !trafficLayer) return;

    if (options.redraw !== false) {
        redrawTrafficLayerFromSnapshot();
    }
    startTrafficSmoothAnimation();
}

function getTrafficSmoothFrameIntervalMs() {
    /*
     * v15.00 — quand le calque routier est affiché sur iPad/tablette, 10 Hz
     * restent suffisamment fluides pour l'extrapolation SafeSky tout en
     * réduisant de moitié les mises à jour DOM permanentes.
     */
    try {
        if (
            showRoadOverlayLayer
            && typeof isTouchTabletForCommunesLayer === 'function'
            && isTouchTabletForCommunesLayer()
        ) {
            return TRAFFIC_SMOOTH_FRAME_INTERVAL_ROAD_TABLET_MS;
        }
    } catch (_) {}

    return TRAFFIC_SMOOTH_FRAME_INTERVAL_MS;
}

function stopTrafficSmoothAnimation() {
    if (trafficSmoothAnimationFrame) {
        cancelAnimationFrame(
            trafficSmoothAnimationFrame
        );
        trafficSmoothAnimationFrame = null;
    }
    trafficSmoothAnimationLastAt = 0;
}

function updateTrafficSmoothPositions(timestamp) {
    if (
        !showTrafficLayer
        || !trafficLayer
        || isTrafficVisualUpdatesSuspended()
        || (
            typeof document !== 'undefined'
            && document.visibilityState === 'hidden'
        )
    ) {
        stopTrafficSmoothAnimation();
        return;
    }

    if (
        timestamp - trafficSmoothAnimationLastAt
        >= getTrafficSmoothFrameIntervalMs()
    ) {
        trafficSmoothAnimationLastAt = timestamp;
        const now = Date.now();

        trafficMarkerRegistry.forEach(entry => {
            const marker = entry?.marker;
            const aircraft = entry?.aircraft;
            if (!marker || !aircraft) return;

            const predicted = extrapolateTrafficAircraft(
                aircraft,
                now
            );
            if (
                !predicted
                || !Number.isFinite(predicted.lat)
                || !Number.isFinite(predicted.lon)
            ) {
                return;
            }

            const rendered = getTrafficReconciledPosition(
                entry,
                predicted,
                now
            );

            try {
                marker.setLatLng([
                    rendered.lat,
                    rendered.lon
                ]);
                entry.renderedTrack = rendered.track;
                applyTrafficMarkerTrack(
                    marker,
                    rendered.track
                );
                /*
                 * v16.02 — ne pas recalculer le connecteur d'étiquette à chaque
                 * frame. Le déplacement du marker translate l'ensemble icône +
                 * étiquette ; le connecteur est recalculé à la réception SS et
                 * après les changements de vue carte.
                 */
            } catch (_) {}
        });
    }

    trafficSmoothAnimationFrame =
        requestAnimationFrame(
            updateTrafficSmoothPositions
        );
}

function startTrafficSmoothAnimation() {
    if (
        !showTrafficLayer
        || !trafficMarkerRegistry.size
        || trafficSmoothAnimationFrame
        || isTrafficVisualUpdatesSuspended()
    ) {
        return;
    }

    trafficSmoothAnimationLastAt = 0;
    trafficSmoothAnimationFrame =
        requestAnimationFrame(
            updateTrafficSmoothPositions
        );
}



function updateTrafficMarkerLabelConnector(marker) {
    const icon = marker?._icon;
    if (!icon || !icon.isConnected) return;

    const label = icon.querySelector('.traffic-aircraft-altitude-label');
    const symbol = icon.querySelector('.traffic-aircraft-arrow');
    let connector = icon.querySelector('.traffic-label-connector');

    if (!label || !symbol) {
        if (connector) connector.remove();
        return;
    }

    const iconRect = icon.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const symbolRect = symbol.getBoundingClientRect();

    if (
        labelRect.width <= 0
        || labelRect.height <= 0
        || symbolRect.width <= 0
        || symbolRect.height <= 0
    ) {
        if (connector) connector.style.display = 'none';
        return;
    }

    const x1 = symbolRect.left + symbolRect.width / 2 - iconRect.left;
    const y1 = symbolRect.top + symbolRect.height / 2 - iconRect.top;
    const x2 = labelRect.left + labelRect.width / 2 - iconRect.left;
    const y2 = labelRect.top + labelRect.height / 2 - iconRect.top;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);

    if (!Number.isFinite(length) || length < 2) {
        if (connector) connector.style.display = 'none';
        return;
    }

    if (!connector) {
        connector = document.createElement('span');
        connector.className = 'traffic-label-connector';
        connector.setAttribute('aria-hidden', 'true');
        icon.appendChild(connector);
    }

    const midpointX = (x1 + x2) / 2;
    const midpointY = (y1 + y2) / 2;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    /*
     * v15.34 — la silhouette SafeSky est un SVG sur fond TRANSPARENT.
     * Les v15.32/v15.33 lisaient backgroundColor du conteneur ; WebKit
     * renvoyait rgba(0,0,0,0), valeur non vide qui empêchait le fallback,
     * donc le trait central devenait transparent.
     *
     * On lit désormais la couleur de la forme SVG réellement visible :
     * ss-fill / traffic-symbol-fill, puis le stroke d'une ss-line, puis
     * seulement la propriété color du conteneur comme dernier secours.
     */
    const fillShape = symbol.querySelector(
        'svg .ss-fill, svg .traffic-symbol-fill'
    );
    const lineShape = symbol.querySelector('svg .ss-line');
    const fillStyle = fillShape ? window.getComputedStyle(fillShape) : null;
    const lineStyle = lineShape ? window.getComputedStyle(lineShape) : null;
    const symbolStyle = window.getComputedStyle(symbol);

    const isUsableTrafficColor = value => {
        const normalized = String(value || '').trim().toLowerCase();
        return !!normalized
            && normalized !== 'none'
            && normalized !== 'transparent'
            && normalized !== 'rgba(0, 0, 0, 0)'
            && normalized !== 'rgba(0,0,0,0)';
    };

    const symbolColorCandidates = [
        fillStyle?.fill,
        lineStyle?.stroke,
        symbolStyle?.color,
        '#080c13'
    ];
    const symbolColor = symbolColorCandidates.find(
        isUsableTrafficColor
    ) || '#080c13';

    connector.style.display = 'block';
    connector.style.width = `${length.toFixed(1)}px`;
    connector.style.left = `${midpointX.toFixed(1)}px`;
    connector.style.top = `${midpointY.toFixed(1)}px`;
    connector.style.transform =
        `translate(-50%, -50%) rotate(${angle.toFixed(2)}deg)`;
    connector.style.setProperty(
        'background',
        symbolColor,
        'important'
    );
    connector.style.setProperty(
        'background-color',
        symbolColor,
        'important'
    );
    connector.style.setProperty(
        'opacity',
        '1',
        'important'
    );
    connector.style.setProperty(
        'box-shadow',
        'none',
        'important'
    );
}

function scheduleTrafficMarkerLabelConnector(marker) {
    if (!marker || marker._npfTrafficRemoved) return;

    const updateIfStillActive = () => {
        if (marker._npfTrafficRemoved) return;
        const icon = marker._icon;
        if (!marker._map || !icon || !icon.isConnected) return;
        updateTrafficMarkerLabelConnector(marker);
    };

    requestAnimationFrame(updateIfStillActive);
}

function refreshAllTrafficLabelConnectors() {
    if (!showTrafficLayer) return;
    trafficMarkerRegistry.forEach(entry => {
        if (entry?.marker) {
            updateTrafficMarkerLabelConnector(entry.marker);
        }
    });
}

let trafficLabelConnectorMapEventsInstalled = false;
let trafficLabelConnectorRefreshTimer = null;

function scheduleAllTrafficLabelConnectors(delayMs = 220) {
    if (!showTrafficLayer) return;
    if (trafficLabelConnectorRefreshTimer) {
        clearTimeout(trafficLabelConnectorRefreshTimer);
    }
    trafficLabelConnectorRefreshTimer = setTimeout(() => {
        trafficLabelConnectorRefreshTimer = null;
        requestAnimationFrame(() => {
            refreshAllTrafficLabelConnectors();
        });
    }, Math.max(0, Number(delayMs) || 0));
}

function ensureTrafficLabelConnectorMapEvents() {
    if (trafficLabelConnectorMapEventsInstalled || !map?.on) return;

    trafficLabelConnectorMapEventsInstalled = true;
    /*
     * v16.02 — une seule passe connecteurs après stabilisation de la vue,
     * au lieu d'un recalcul immédiat en concurrence avec les autres calques.
     */
    map.on('zoomend moveend resize', () => {
        scheduleAllTrafficLabelConnectors(220);
    });
}

/* v16.08 — format opérationnel commun des altitudes affichées dans les étiquettes.
 * Pas de séparateur sur 4 chiffres ; séparation par milliers à partir de 10 000 ft. */
function formatNpfAltitudeFeetLabel(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    const rounded = Math.round(numeric);
    const sign = rounded < 0 ? '-' : '';
    const digits = String(Math.abs(rounded));
    const grouped = digits.length >= 5
        ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
        : digits;
    return `${sign}${grouped} ft`;
}

function buildTrafficMarkerIcon(aircraft) {
    const hasTrack = Number.isFinite(aircraft.track);
    const track = hasTrack ? aircraft.track : 0;
    const settings = sanitizeTrafficSettings(trafficSettings);
    const altitudeState = getTrafficRelativeAltitudeState(aircraft);
    const visual = getTrafficAircraftVisualDefinition(aircraft);
    const isTrackedAircraft = isTrafficAircraftTracked(aircraft);
    const shouldBlinkSource = (
        !isTrackedAircraft
        && shouldBlinkTrafficAircraftSource(aircraft)
    );
    const symbolRotation = visual.directional && hasTrack ? track : 0;
    const vectorLengthPx = hasTrack
        ? getTrafficSpeedVectorLengthPx(aircraft)
        : 0;

    /*
     * L'étiquette reste opposée à la route, mais son BORD le plus proche est
     * désormais ancré sur le point calculé. Sa largeur ne peut donc plus
     * revenir recouvrir l'icône, même lorsqu'elle est placée à gauche ou à
     * droite du trafic.
     */
    const markerCenterPx = 21;
    const labelEdgeDistancePx = 24;
    const trackRadians = track * Math.PI / 180;
    const oppositeX = -Math.sin(trackRadians);
    const oppositeY = Math.cos(trackRadians);
    const altitudeLabelLeft = markerCenterPx
        + oppositeX * labelEdgeDistancePx;
    const altitudeLabelTop = markerCenterPx
        + oppositeY * labelEdgeDistancePx;

    /*
     * Huit secteurs déterminent le coin ou le bord de l'étiquette à utiliser.
     * Le placement reste stable lors des changements légers de route.
     */
    const labelSector = Math.round(
        (((track % 360) + 360) % 360) / 45
    ) % 8;
    const labelAnchorClasses = [
        'traffic-label-anchor-top',
        'traffic-label-anchor-top-right',
        'traffic-label-anchor-right',
        'traffic-label-anchor-bottom-right',
        'traffic-label-anchor-bottom',
        'traffic-label-anchor-bottom-left',
        'traffic-label-anchor-left',
        'traffic-label-anchor-top-left'
    ];
    const labelAnchorClass = labelAnchorClasses[labelSector];

    const permanentIdentifier = compactTrafficLabelText(
        getTrafficPermanentIdentifier(aircraft),
        12
    );
    /*
     * v15.93 — pour les appareils de la liste suivie, l'étiquette reste
     * volontairement opérationnelle et compacte : indicatif + altitude +
     * tendance verticale. Le pictogramme conserve à lui seul le type aéronef.
     */
    const permanentType = isTrackedAircraft
        ? ''
        : compactTrafficLabelText(
            getTrafficPermanentType(aircraft),
            18
        );
    const permanentAltitude = Number.isFinite(Number(aircraft.altitudeFeet))
        ? formatNpfAltitudeFeetLabel(aircraft.altitudeFeet)
        : ((aircraft.altitude && aircraft.altitude !== '--') ? aircraft.altitude : '');
    const verticalTrend = getTrafficVerticalTrend(aircraft);

    const firstLineParts = [
        permanentIdentifier,
        permanentType
    ].filter(Boolean);

    const secondLineParts = [
        permanentAltitude,
        verticalTrend.symbol
    ].filter(Boolean);

    const altitudeHtml = (
        settings.showAltitudeLabel
        && (firstLineParts.length || secondLineParts.length)
    ) ? `
        <span class="traffic-aircraft-altitude-label ${labelAnchorClass}"
              style="--traffic-alt-left:${altitudeLabelLeft.toFixed(1)}px;--traffic-alt-top:${altitudeLabelTop.toFixed(1)}px;">
            ${firstLineParts.length ? `
                <span class="traffic-label-line traffic-label-line-primary">
                    ${firstLineParts.map(escapeHtml).join('<span class="traffic-label-space"> </span>')}
                </span>
            ` : ''}
            ${secondLineParts.length ? `
                <span class="traffic-label-line traffic-label-line-secondary">
                    ${permanentAltitude ? `<span class="traffic-label-altitude-value">${escapeHtml(permanentAltitude)}</span>` : ''}
                    ${verticalTrend.symbol ? `<span class="traffic-vertical-trend ${verticalTrend.className}" aria-label="${escapeHtml(verticalTrend.label)}">${escapeHtml(verticalTrend.symbol)}</span>` : ''}
                </span>
            ` : ''}
        </span>
    ` : '';

    /*
     * v14.26 — chaque catégorie fournit son propre pictogramme SVG, composé de
     * formes simples proches du langage graphique montré dans SafeSky.
     */
    const symbolSvg = `<svg viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">${visual.svg}</svg>`;

    const vectorHtml = buildTrafficVectorHtml(
        aircraft,
        track,
        vectorLengthPx
    );

    return L.divIcon({
        className: 'traffic-aircraft-icon',
        html: `<span class="traffic-aircraft-symbol-wrap ${altitudeState.className} ${aircraft.isGrounded ? 'traffic-status-grounded' : 'traffic-status-airborne'} traffic-type-${visual.className}${isTrackedAircraft ? ' traffic-aircraft-tracked' : ''}">${vectorHtml}<span class="traffic-aircraft-arrow${shouldBlinkSource ? ' traffic-aircraft-source-blink' : ''}" aria-label="${escapeHtml(visual.label)}" style="transform: translate(-50%, -50%) rotate(${symbolRotation}deg);">${symbolSvg}</span>${altitudeHtml}</span>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        popupAnchor: [0, -13]
    });
}

function buildTrafficAircraftPopupHtml(
    ac,
    {
        useAroundAltitude,
        relativeMinAltitudeFt,
        relativeMaxAltitudeFt,
        useGroundToAboveAltitude,
        groundToAboveMaxAltitudeFt
    }
) {
    const title = escapeHtml(
        ac.registration
        || ac.callsign
        || ac.hex
        || 'Trafic'
    );
    const displayType = getTrafficTypeDisplayLabel(ac);
    const aircraftModel = getTrafficAircraftModel(ac);
    const companyName = getTrafficCompanyName(ac);
    const subtitle = [
        displayType,
        ac.source,
        ac.registration,
        ac.hex
    ].filter(Boolean).map(escapeHtml).join(' · ');
    const reference = ac._trafficReference;
    const distance = reference ? reference.distance : null;
    const referenceLabel = reference?.point?.label
        ? escapeHtml(reference.point.label)
        : '';
    const altitudeState = getTrafficRelativeAltitudeState(ac);
    const trackedTrafficEntry = findTrackedTrafficEntryForAircraft(ac);
    const permanentTrackedTraffic = isPermanentTrackedTrafficEntry(
        trackedTrafficEntry
    );
    const relativeAltitudeText = Number.isFinite(altitudeState.deltaFt)
        ? `${altitudeState.deltaFt > 0 ? '+' : ''}${altitudeState.deltaFt} ft`
        : '--';

    return `
        <div class="traffic-popup">
            <div class="traffic-popup-title">${title}</div>
            ${subtitle ? `<div class="traffic-popup-subtitle">${subtitle}</div>` : ''}
            ${companyName ? `<div>Compagnie : <b>${escapeHtml(companyName)}</b></div>` : ''}
            ${aircraftModel ? `<div>Type d’avion : <b>${escapeHtml(aircraftModel)}</b></div>` : ''}
            ${ac.registration ? `<div>Immatriculation : <b>${escapeHtml(ac.registration)}</b></div>` : ''}
            ${ac.callsign && ac.callsign !== ac.registration ? `<div>Indicatif : <b>${escapeHtml(ac.callsign)}</b></div>` : ''}
            <div>Catégorie : <b>${escapeHtml(displayType)}</b></div>
            <div>Altitude : <b>${escapeHtml(ac.altitude)}</b></div>
            <div>Écart avec moi : <b>${escapeHtml(relativeAltitudeText)}</b> — ${escapeHtml(altitudeState.label)}</div>
            <div>Vitesse sol : <b>${escapeHtml(ac.gs)}</b></div>
            <div>Route : <b>${Number.isFinite(ac.track) ? Math.round(ac.track) + '°' : '--'}</b></div>
            ${Number.isFinite(ac.turnRateDegPerSec) ? `<div>Taux de virage : <b>${ac.turnRateDegPerSec > 0 ? '+' : ''}${Number(ac.turnRateDegPerSec).toFixed(1)}°/s</b></div>` : ''}
            ${Number.isFinite(ac.verticalRateFpm) ? `<div>Vitesse verticale : <b>${ac.verticalRateFpm > 0 ? '+' : ''}${Math.round(ac.verticalRateFpm)} ft/min</b></div>` : ''}
            ${ac.remarks ? `<div>Remarque : <b>${escapeHtml(ac.remarks)}</b></div>` : ''}
            ${Number.isFinite(distance) ? `<div>Distance ${referenceLabel ? `à ${referenceLabel}` : ''} : <b>${Math.round(distance)} Nm</b></div>` : ''}
            <div>Âge position : <b>${escapeHtml(formatTrafficAge(ac.seenPos))}</b></div>
            ${useAroundAltitude ? `<div>Filtre altitude : <b>${Math.round(relativeMinAltitudeFt)} / ${Math.round(relativeMaxAltitudeFt)} ft</b></div>` : ''}
            ${useGroundToAboveAltitude ? `<div>Filtre altitude : <b>sol / ${Math.round(groundToAboveMaxAltitudeFt)} ft</b></div>` : ''}
            ${ac.hex ? `<button type="button" class="traffic-popup-track-button"${permanentTrackedTraffic ? ' disabled title="Indicatif permanent intégré à NPF"' : ''}>${permanentTrackedTraffic ? 'Suivi permanent' : (trackedTrafficEntry ? 'Retirer de la liste suivie' : 'Ajouter à la liste suivie')}</button>` : ''}
            ${ac.hex ? `<button type="button" class="traffic-popup-own-button">${isOwnTrafficAircraft(ac) ? 'Mon avion masqué' : 'Définir comme mon avion et masquer'}</button>` : ''}
            <div class="traffic-popup-warning">Trafic SafeSky/ADS-B indicatif — non certifié</div>
        </div>`;
}

function wireTrafficMarkerPopupButtons(marker) {
    if (!marker) return;

    const ac = marker._npfTrafficAircraft;
    const popupElement = marker.getPopup()?.getElement?.();
    if (!popupElement) return;

    const trackButton = popupElement.querySelector(
        '.traffic-popup-track-button'
    );
    const ownAircraftButton = popupElement.querySelector(
        '.traffic-popup-own-button'
    );

    if (trackButton && ac?.hex) {
        const updateTrackButtonState = () => {
            const currentAircraft = marker._npfTrafficAircraft;
            const trackedEntry = findTrackedTrafficEntryForAircraft(
                currentAircraft
            );
            const permanentEntry = isPermanentTrackedTrafficEntry(
                trackedEntry
            );

            trackButton.disabled = permanentEntry;
            trackButton.textContent = permanentEntry
                ? 'Suivi permanent'
                : (trackedEntry
                    ? 'Retirer de la liste suivie'
                    : 'Ajouter à la liste suivie');
            trackButton.title = permanentEntry
                ? 'Indicatif permanent intégré à NPF'
                : '';
        };

        updateTrackButtonState();
        trackButton.onclick = () => {
            const currentAircraft = marker._npfTrafficAircraft;
            if (!currentAircraft?.hex) return;

            const trackedEntry = findTrackedTrafficEntryForAircraft(
                currentAircraft
            );
            if (isPermanentTrackedTrafficEntry(trackedEntry)) {
                updateTrackButtonState();
                return;
            }

            if (trackedEntry) {
                removeTrackedTrafficIdentifier(trackedEntry.id);
            } else {
                addTrackedTrafficIdentifier(currentAircraft);
            }

            /*
             * Le bouton visible est mis à jour immédiatement. Si le rendu
             * SafeSky remplace ensuite le contenu de la popup, updateTrafficMarkerPopup()
             * recâble le nouveau bouton sans attendre une réouverture.
             */
            updateTrackButtonState();
        };
    }

    if (ownAircraftButton && ac?.hex) {
        ownAircraftButton.onclick = () => {
            const currentAircraft = marker._npfTrafficAircraft;
            if (!currentAircraft?.hex) return;
            setOwnTrafficAircraftSession(currentAircraft);
        };
    }
}

function installTrafficMarkerPopupInteraction(marker) {
    if (!marker || marker._npfTrafficPopupInteractionInstalled) return;
    marker._npfTrafficPopupInteractionInstalled = true;

    marker.on('popupopen', () => {
        wireTrafficMarkerPopupButtons(marker);
    });
}

/*
 * v15.09 — l’étiquette permanente fait partie visuellement du trafic mais
 * dépasse largement la boîte 42 × 42 du divIcon. On lui rend les événements
 * et on ouvre explicitement la popup depuis cette zone.
 */
function installTrafficMarkerLabelPopupInteraction(marker) {
    if (!marker) return;

    const markerElement = marker.getElement?.();
    const labelElement = markerElement?.querySelector?.(
        '.traffic-aircraft-altitude-label'
    );
    if (
        !labelElement
        || labelElement._npfTrafficLabelPopupInteractionInstalled
    ) {
        return;
    }

    labelElement._npfTrafficLabelPopupInteractionInstalled = true;

    labelElement.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        try {
            marker.openPopup();
        } catch (_) {}
    }, {
        passive: false
    });
}


/*
 * v14.57 — fermeture de la fiche trafic par clic réel sur le fond de carte.
 * Le déplacement, le zoom, le pincement et la molette ne ferment pas la fiche.
 */
function closeOpenTrafficAircraftPopup() {
    let closedOne = false;

    trafficMarkerRegistry.forEach(entry => {
        const marker = entry?.marker;
        if (
            !marker
            || typeof marker.isPopupOpen !== 'function'
            || !marker.isPopupOpen()
        ) {
            return;
        }

        try {
            marker.closePopup();
            closedOne = true;
        } catch (_) {}
    });

    return closedOne;
}

function installTrafficPopupMapDismissInteraction() {
    if (
        !map
        || typeof map.getContainer !== 'function'
        || map.__npfTrafficPopupMapDismissInstalled
    ) {
        return;
    }

    const container = map.getContainer();
    if (!container) return;

    map.__npfTrafficPopupMapDismissInstalled = true;

    let startPoint = null;
    let touchHadMultipleFingers = false;
    let gestureMoved = false;
    let suppressMapClickUntil = 0;
    let pendingMapCloseTimer = null;

    const cancelPendingMapClose = () => {
        if (!pendingMapCloseTimer) return;
        clearTimeout(pendingMapCloseTimer);
        pendingMapCloseTimer = null;
    };

    const getEventPoint = event => {
        const touch = event?.touches?.[0]
            || event?.changedTouches?.[0]
            || null;
        const source = touch || event;
        const x = Number(source?.clientX);
        const y = Number(source?.clientY);
        return Number.isFinite(x) && Number.isFinite(y)
            ? { x, y }
            : null;
    };

    const eventTargetsMapBackground = event => {
        const target = event?.originalEvent?.target || event?.target;
        if (!target || typeof target.closest !== 'function') return true;
        return !target.closest(
            '.leaflet-popup, .leaflet-marker-icon, .leaflet-control, button, input, select, textarea, a'
        );
    };

    const beginGesture = event => {
        touchHadMultipleFingers = Boolean(
            event?.touches && event.touches.length > 1
        );
        gestureMoved = touchHadMultipleFingers;
        startPoint = getEventPoint(event);

        if (touchHadMultipleFingers) {
            suppressMapClickUntil = Date.now() + 450;
        }
    };

    const moveGesture = event => {
        if (event?.touches && event.touches.length > 1) {
            touchHadMultipleFingers = true;
            gestureMoved = true;
            suppressMapClickUntil = Date.now() + 450;
            return;
        }

        if (!startPoint) return;
        const point = getEventPoint(event);
        if (!point) return;

        if (
            Math.hypot(
                point.x - startPoint.x,
                point.y - startPoint.y
            ) > 8
        ) {
            gestureMoved = true;
            suppressMapClickUntil = Date.now() + 350;
        }
    };

    const endGesture = () => {
        if (gestureMoved || touchHadMultipleFingers) {
            suppressMapClickUntil = Math.max(
                suppressMapClickUntil,
                Date.now() + 300
            );
        }
        startPoint = null;
        gestureMoved = false;
        touchHadMultipleFingers = false;
    };

    container.addEventListener('touchstart', beginGesture, {
        passive: true,
        capture: true
    });
    container.addEventListener('touchmove', moveGesture, {
        passive: true,
        capture: true
    });
    container.addEventListener('touchend', endGesture, {
        passive: true,
        capture: true
    });
    container.addEventListener('touchcancel', endGesture, {
        passive: true,
        capture: true
    });
    container.addEventListener('pointerdown', beginGesture, {
        passive: true,
        capture: true
    });
    container.addEventListener('pointermove', moveGesture, {
        passive: true,
        capture: true
    });
    container.addEventListener('pointerup', endGesture, {
        passive: true,
        capture: true
    });
    container.addEventListener('pointercancel', endGesture, {
        passive: true,
        capture: true
    });
    container.addEventListener('wheel', () => {
        cancelPendingMapClose();
        suppressMapClickUntil = Date.now() + 350;
    }, {
        passive: true,
        capture: true
    });

    map.on('dragstart zoomstart', () => {
        cancelPendingMapClose();
        suppressMapClickUntil = Date.now() + 350;
    });
    map.on('dragend zoomend', () => {
        suppressMapClickUntil = Math.max(
            suppressMapClickUntil,
            Date.now() + 220
        );
    });

    map.on('dblclick', cancelPendingMapClose);

    map.on('click', event => {
        if (Date.now() < suppressMapClickUntil) return;
        if (!eventTargetsMapBackground(event)) return;

        /*
         * Petit délai pour distinguer le clic simple d'un double appui de zoom.
         * Tout début de déplacement ou de zoom annule cette fermeture.
         */
        cancelPendingMapClose();
        pendingMapCloseTimer = setTimeout(() => {
            pendingMapCloseTimer = null;
            if (Date.now() < suppressMapClickUntil) return;
            closeOpenTrafficAircraftPopup();
        }, 320);
    });
}

function updateTrafficMarkerPopup(marker, popupHtml) {
    const popupOptions = {
        autoPan: false,
        closeOnClick: false,
        closeButton: true,
        autoClose: true,
        offset: L.point(0, 0),
        className: 'traffic-aircraft-popup'
    };

    const popup = marker.getPopup?.();
    if (popup) {
        popup.setContent(popupHtml);
    } else {
        marker.bindPopup(popupHtml, popupOptions);
    }

    installTrafficMarkerPopupInteraction(marker);

    /*
     * v15.09 — setContent() remplace le DOM d’une popup ouverte. Les boutons
     * nouvellement créés doivent donc recevoir leurs onclick immédiatement,
     * sans attendre un nouveau popupopen.
     */
    if (marker.isPopupOpen?.()) {
        wireTrafficMarkerPopupButtons(marker);
        requestAnimationFrame(() => {
            if (marker.isPopupOpen?.()) {
                wireTrafficMarkerPopupButtons(marker);
            }
        });
    }
}

function renderTrafficAircraft(aircraftList, meta = {}) {
    if (!trafficLayer) return;
    ensureTrafficLabelConnectorMapEvents();

    if (meta?.skipSnapshot !== true) {
        lastTrafficAircraftSnapshot = Array.isArray(aircraftList)
            ? aircraftList.slice()
            : [];
        lastTrafficRenderMeta = {
            ...meta,
            points: Array.isArray(meta?.points)
                ? meta.points.map(point => ({ ...point }))
                : meta?.points
        };
    }

    /*
     * Une réponse SafeSky peut arriver pendant un zoom ou pendant le rendu
     * routier. On conserve le snapshot mais on ne touche pas au DOM/Leaflet
     * tant que la carte n'est pas de nouveau disponible.
     */
    if (isTrafficVisualUpdatesSuspended()) {
        stopTrafficSmoothAnimation();
        return;
    }

    let openTrafficPopupKey = '';
    trafficMarkerRegistry.forEach((entry, key) => {
        if (
            !openTrafficPopupKey
            && entry?.marker
            && typeof entry.marker.isPopupOpen === 'function'
            && entry.marker.isPopupOpen()
        ) {
            openTrafficPopupKey = key;
        }
    });

    const settings = sanitizeTrafficSettings(trafficSettings);
    const advisoryCount = renderSafeSkyAdvisories(aircraftList);
    const points = Array.isArray(meta.points) && meta.points.length
        ? meta.points
        : (meta.point ? [meta.point] : []);
    const showAllTraffic = true;
    const ownAltitudeFt = getOwnTrafficAltitudeFeet();

    const useAroundAltitude = (
        settings.altitudeFilterMode === 'around'
        && Number.isFinite(ownAltitudeFt)
    );
    const useGroundToAboveAltitude = (
        settings.altitudeFilterMode === 'ground'
        && Number.isFinite(ownAltitudeFt)
    );

    const relativeMinAltitudeFt = useAroundAltitude
        ? ownAltitudeFt - settings.relativeAltitudeBandFt
        : null;
    const relativeMaxAltitudeFt = useAroundAltitude
        ? ownAltitudeFt + settings.relativeAltitudeBandFt
        : null;
    const groundToAboveMaxAltitudeFt = useGroundToAboveAltitude
        ? ownAltitudeFt + settings.groundToAboveBandFt
        : null;

    const trackedIdentifierSet = getTrackedTrafficIdentifierSet();

    /*
     * v15.29 — on calcule d'abord tous les trafics éligibles SafeSky sans
     * appliquer le filtre « seulement la liste suivie ». Cela permet au badge
     * vert de toujours représenter la totalité, même lorsque la carte ne rend
     * volontairement que les trafics de la liste.
     */
    const allEligibleAircraft = [];
    const seenAllEligibleAircraft = new Set();

    (Array.isArray(aircraftList) ? aircraftList : [])
        .map(normalizeTrafficAircraft)
        .filter(Boolean)
        .map(ac => {
            const temporaryOverride = getTemporaryTrafficDisplayOverride(ac);
            if (temporaryOverride) {
                ac.forceDisplay = true;
                ac.forceGroundDisplay = Boolean(
                    temporaryOverride.forceGroundDisplay
                );
            }
            return ac;
        })
        .filter(ac => !isOwnTrafficAircraft(ac))
        .filter(ac => {
            /*
             * v16.02 — le filtre « parapentes / deltaplanes / planeurs… »
             * ne masque jamais un trafic de la liste suivie. Les autres filtres
             * (altitude, sol, âge) conservent strictement leur comportement.
             */
            const isTracked = (
                trackedIdentifierSet.has(String(ac.hex || '').toUpperCase())
                || isTrafficAircraftTracked(ac)
            );
            return (
                ac.forceDisplay
                || isTracked
                || !settings.onlyNonAirplaneHelicopterTraffic
                || !isTrafficAircraftHiddenByLightTypesFilter(ac)
            );
        })
        .filter(ac => (
            ac.forceGroundDisplay
            || settings.showGroundTraffic
            || !ac.isGrounded
        ))
        .filter(ac => (
            ac.forceDisplay
            || !Number.isFinite(ac.seenPos)
            || ac.seenPos <= TRAFFIC_MAX_SEEN_SECONDS
        ))
        .filter(ac => (
            ac.forceDisplay
            || settings.altitudeFilterMode !== 'absolute'
            || ac.altitudeFeet === null
            || ac.altitudeFeet >= settings.minAltitudeFt
        ))
        .filter(ac => (
            ac.forceDisplay
            || settings.altitudeFilterMode !== 'absolute'
            || settings.maxAltitudeFt === null
            || ac.altitudeFeet === null
            || ac.altitudeFeet <= settings.maxAltitudeFt
        ))
        .filter(ac => (
            ac.forceDisplay
            || !useAroundAltitude
            || ac.altitudeFeet === null
            || (
                ac.altitudeFeet >= relativeMinAltitudeFt
                && ac.altitudeFeet <= relativeMaxAltitudeFt
            )
        ))
        .filter(ac => (
            ac.forceDisplay
            || !useGroundToAboveAltitude
            || ac.altitudeFeet === null
            || ac.altitudeFeet <= groundToAboveMaxAltitudeFt
        ))
        .forEach(ac => {
            const reference = getNearestTrafficReference(ac, points);

            if (
                !ac.forceDisplay
                && !showAllTraffic
                && points.length
                && (
                    !reference
                    || reference.distance > settings.radiusNm + 0.5
                )
            ) {
                return;
            }

            ac._trafficReference = showAllTraffic ? null : reference;
            const key = buildTrafficAircraftKey(ac);
            if (seenAllEligibleAircraft.has(key)) return;
            seenAllEligibleAircraft.add(key);
            allEligibleAircraft.push(ac);
        });

    lastTrafficTotalEligibleCount = allEligibleAircraft.length;

    /*
     * v15.95 — la pastille verte exclut tous les appareils appartenant à la
     * liste suivie. Les appareils suivis interrogés directement au niveau
     * national ne gonflent donc plus ce compteur.
     */
    lastTrafficNonTrackedEligibleCount = allEligibleAircraft.filter(ac => (
        !trackedIdentifierSet.has(String(ac.hex || '').toUpperCase())
        && !isTrafficAircraftTracked(ac)
    )).length;

    /*
     * v15.92 — le badge « liste suivie » est alimenté par la recherche directe
     * nationale transmise dans meta, jamais par les seuls appareils rendus.
     */
    if (Number.isFinite(Number(meta.trackedNationalCount))) {
        lastTrafficTrackedDetectedCount = Math.max(
            0,
            Math.round(Number(meta.trackedNationalCount))
        );
    }

    const uniqueAircraft = allEligibleAircraft.filter(ac => {
        const isTracked = (
            trackedIdentifierSet.has(
                String(ac.hex || '').toUpperCase()
            )
            || isTrafficAircraftTracked(ac)
        );

        if (
            settings.onlyTrackedIdentifiers
            && !ac.forceDisplay
            && !isTracked
        ) {
            return false;
        }

        /*
         * v15.95 — masque cartographique secondaire de la pastille verte.
         * Il n'agit que sur les aéronefs hors liste et ne touche pas aux
         * filtres SafeSky ni aux zones advisory.
         */
        if (!showNonTrackedTraffic && !isTracked) {
            return false;
        }

        return true;
    });

    const renderNow = Date.now();
    const activeAircraftKeys = new Set();

    uniqueAircraft.forEach(ac => {
        const aircraftKey = buildTrafficAircraftKey(ac);
        activeAircraftKeys.add(aircraftKey);

        let entry = trafficMarkerRegistry.get(aircraftKey);

        if (entry?.aircraft) {
            applyTrafficMotionFallbackFromHistory(
                entry.aircraft,
                ac
            );
        }

        const popupHtml = buildTrafficAircraftPopupHtml(ac, {
            useAroundAltitude,
            relativeMinAltitudeFt,
            relativeMaxAltitudeFt,
            useGroundToAboveAltitude,
            groundToAboveMaxAltitudeFt
        });
        const nextIcon = buildTrafficMarkerIcon(ac);
        const nextIconSignature = String(
            nextIcon?.options?.html || ''
        );

        if (entry?.marker) {
            prepareTrafficMarkerReconciliation(
                entry,
                ac,
                renderNow
            );

            entry.marker._npfTrafficRemoved = false;
            entry.marker._trafficAircraftKey = aircraftKey;
            entry.marker._npfTrafficAircraft = ac;

            if (entry.iconSignature !== nextIconSignature) {
                entry.marker.setIcon(nextIcon);
                entry.iconSignature = nextIconSignature;
                applyTrafficMarkerTrack(
                    entry.marker,
                    entry.renderedTrack
                );
            }

            updateTrafficMarkerPopup(
                entry.marker,
                popupHtml
            );
            installTrafficMarkerLabelPopupInteraction(
                entry.marker
            );
            scheduleTrafficMarkerLabelConnector(entry.marker);
            return;
        }

        const predicted = extrapolateTrafficAircraft(
            ac,
            renderNow
        ) || { lat: ac.lat, lon: ac.lon, track: ac.track };
        const marker = L.marker(
            [predicted.lat, predicted.lon],
            {
                icon: nextIcon,
                pane: 'trafficPane',
                zIndexOffset: 7000,
                keyboard: false
            }
        );

        marker._npfTrafficRemoved = false;
        marker._trafficAircraftKey = aircraftKey;
        marker._npfTrafficAircraft = ac;
        updateTrafficMarkerPopup(marker, popupHtml);
        marker.addTo(trafficLayer);
        installTrafficMarkerLabelPopupInteraction(marker);
        scheduleTrafficMarkerLabelConnector(marker);

        entry = {
            marker,
            aircraft: ac,
            renderedTrack: predicted.track,
            correction: null,
            iconSignature: nextIconSignature
        };
        trafficMarkerRegistry.set(aircraftKey, entry);
        applyTrafficMarkerTrack(marker, predicted.track);
    });

    Array.from(trafficMarkerRegistry.entries())
        .forEach(([key, entry]) => {
            if (!activeAircraftKeys.has(key)) {
                removeTrafficMarkerEntry(key, entry);
            }
        });

    if (openTrafficPopupKey) {
        const popupEntry = trafficMarkerRegistry.get(
            openTrafficPopupKey
        );
        if (
            popupEntry?.marker
            && !popupEntry.marker.isPopupOpen?.()
        ) {
            requestAnimationFrame(() => {
                try {
                    if (
                        showTrafficLayer
                        && map
                        && trafficLayer
                        && map.hasLayer(trafficLayer)
                    ) {
                        popupEntry.marker.openPopup();
                    }
                } catch (_) {}
            });
        }
    }

    lastTrafficDisplayedCount = uniqueAircraft.length;
    refreshTrackedTrafficListUi();
    refreshTrafficButtonState();
    updateTrafficStatus({
        visible: showTrafficLayer,
        state: 'ok',
        count: uniqueAircraft.length,
        pointLabel: buildTrafficReferenceLabel(points),
        message: advisoryCount
            ? `${advisoryCount} zone(s) drone`
            : '',
        now: meta.now || renderNow
    });

    startTrafficSmoothAnimation();

    /*
     * v15.30 — la liste des marqueurs SafeSky vient de changer : réconcilier
     * immédiatement la couche GLR pour appliquer/supprimer les doublons.
     */
    if (npfGlobalLinkEnabled && npfGlobalLinkLastPositions.length) {
        renderGlobalLinkPositions(npfGlobalLinkLastPositions);
    }
}

function redrawTrafficLayerFromSnapshot() {
    if (
        !showTrafficLayer
        || !trafficLayer
        || !Array.isArray(lastTrafficAircraftSnapshot)
        || !lastTrafficAircraftSnapshot.length
    ) {
        return;
    }

    const currentPoints = getTrafficQueryPoints();
    renderTrafficAircraft(lastTrafficAircraftSnapshot, {
        ...(lastTrafficRenderMeta || {}),
        points: currentPoints.length
            ? currentPoints
            : (lastTrafficRenderMeta?.points || []),
        now: Date.now(),
        skipSnapshot: true
    });
}

function updateTrafficStatus({ visible = showTrafficLayer, state = 'idle', count = null, pointLabel = '', message = '', now = Date.now() } = {}) {
    /* v13.03 : plus de fenêtre/bandeau d'alerte ADS-B sur la carte.
       L'état est porté uniquement par le bouton TRAFIC : rouge = erreur, bleu = chargement, vert = OK. */
    const status = document.getElementById('traffic-status-display');
    if (!status) return;
    status.style.display = 'none';
    status.textContent = '';
    status.className = 'traffic-status-display';
}

function refreshTrafficButtonState(count = null) {
    const button = document.getElementById('traffic-layer-button');
    const countEl = document.getElementById('traffic-button-count');
    const trackedCountEl = document.getElementById('traffic-tracked-button-count');
    if (!button) return;

    if (trackedCountEl) {
        const trackedCount = Math.max(
            0,
            Math.round(Number(lastTrafficTrackedDetectedCount) || 0)
        );
        trackedCountEl.textContent = String(trackedCount);
        trackedCountEl.style.display = showTrafficLayer ? 'inline-flex' : 'none';
        trackedCountEl.title = `${trackedCount} trafic${trackedCount > 1 ? 's' : ''} de la liste suivie détecté${trackedCount > 1 ? 's' : ''} — total national`;
        trackedCountEl.setAttribute(
            'aria-label',
            `${trackedCount} trafic${trackedCount > 1 ? 's' : ''} de la liste suivie détecté${trackedCount > 1 ? 's' : ''} — total national`
        );
    }

    if (count !== null && count !== undefined && count !== '') {
        const numericCount = Number(count);
        if (Number.isFinite(numericCount)) {
            lastTrafficDisplayedCount = Math.max(0, Math.round(numericCount));
        }
    }

    const hasSuccessfulTrafficConnection = (
        Number.isFinite(Number(lastTrafficRefreshAt))
        && Number(lastTrafficRefreshAt) > 0
        && !lastTrafficError
    );

    button.classList.toggle('active', showTrafficLayer);
    button.classList.toggle('loading', isTrafficLoading);
    button.classList.toggle(
        'traffic-state-loading',
        !!showTrafficLayer && isTrafficLoading && !hasSuccessfulTrafficConnection
    );
    button.classList.toggle(
        'traffic-state-error',
        !!showTrafficLayer && !isTrafficLoading && !!lastTrafficError
    );
    button.classList.toggle(
        'traffic-state-ok',
        !!showTrafficLayer
            && !lastTrafficError
            && (!isTrafficLoading || hasSuccessfulTrafficConnection)
    );
    button.classList.toggle('traffic-state-idle', !showTrafficLayer);
    button.disabled = false;
    button.title = isTrafficLoading
        ? `Chargement SafeSky… — ${getTrafficSettingsSummary()}`
        : `SafeSky — afficher/masquer le trafic indicatif — appui long : filtres — ${getTrafficSettingsSummary()}`;

    if (countEl) {
        const nonTrackedCount = Math.max(
            0,
            Math.round(Number(lastTrafficNonTrackedEligibleCount) || 0)
        );
        countEl.classList.toggle(
            'traffic-nontracked-hidden',
            !showNonTrackedTraffic
        );
        const nonTrackedStateLabel = showNonTrackedTraffic
            ? 'affichés'
            : 'masqués';
        countEl.title = `${nonTrackedCount} trafic${nonTrackedCount > 1 ? 's' : ''} SafeSky hors liste suivie (${nonTrackedStateLabel}) — appuyer pour ${showNonTrackedTraffic ? 'masquer' : 'afficher'}`;
        countEl.setAttribute(
            'aria-label',
            `${nonTrackedCount} trafic${nonTrackedCount > 1 ? 's' : ''} SafeSky hors liste suivie (${nonTrackedStateLabel}) — appuyer pour ${showNonTrackedTraffic ? 'masquer' : 'afficher'}`
        );

        if (showTrafficLayer) {
            /*
             * v15.95 — compteur hors liste uniquement. Il reste stable pendant
             * l'interrogation suivante et ne tombe pas à zéro lorsque son
             * masque cartographique est activé.
             */
            if (lastTrafficError && !isTrafficLoading) {
                countEl.textContent = '!';
            } else {
                countEl.textContent = String(nonTrackedCount);
            }
            countEl.style.display = 'inline-flex';
        } else {
            countEl.textContent = '0';
            countEl.style.display = 'none';
        }
    }
}

async function refreshTrafficLayer(options = {}) {
    const { force = false, reason = '' } = options;
    if (!showTrafficLayer || !trafficLayer) return;

    const trafficDiagSeq = ++trafficDiagRefreshSeq;
    const trafficDiagStartedAt = (
        typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now()
    );
    const trafficDiagRegistryBefore = Number(trafficMarkerRegistry?.size || 0);

    /*
     * v14.94 — ne jamais lancer deux lectures SafeSky en parallèle.
     * Une demande forcée (filtre/toggle) reçue pendant une lecture invalide
     * immédiatement la réponse en cours et demande un unique nouveau passage.
     */
    if (isTrafficLoading) {
        if (force) {
            trafficRefreshQueued = true;
            trafficRefreshGeneration += 1;
        }
        return;
    }

    const now = Date.now();
    if (!force && lastTrafficRefreshAt && now - lastTrafficRefreshAt < 4500) return;

    const points = getTrafficQueryPoints();
    const trackedIdentifiers =
        getTrackedTrafficIdentifiers();

    if (!points.length && !trackedIdentifiers.length) {
        lastTrafficError = 'Aucun point de référence';
        lastTrafficDisplayedCount = 0;
        lastTrafficTotalEligibleCount = 0;
        lastTrafficTrackedDetectedCount = 0;
        lastTrafficNonTrackedEligibleCount = 0;
        refreshTrafficButtonState(0);
        updateTrafficStatus({ state: 'error', message: 'Trafic : aucun point de référence', visible: true });
        return;
    }

    const refreshGeneration = ++trafficRefreshGeneration;
    isTrafficLoading = true;
    refreshTrafficButtonState();
    updateTrafficStatus({ state: 'loading', visible: true });

    try {
        const providers = Array.isArray(TRAFFIC_API_PROVIDERS)
            && TRAFFIC_API_PROVIDERS.length
            ? TRAFFIC_API_PROVIDERS
            : [SAFESKY_PROVIDER];
        const errors = [];
        const combinedAircraft = [];
        const usedProviders = [];
        let trackedNationalCount = trackedIdentifiers.length
            ? lastTrafficTrackedDetectedCount
            : 0;

        for (const point of points) {
            try {
                const result = await fetchTrafficAircraftForPoint(point, providers);
                combinedAircraft.push(...result.aircraft);
                if (result.provider?.label && !usedProviders.includes(result.provider.label)) {
                    usedProviders.push(result.provider.label);
                }
            } catch (pointError) {
                const errText = pointError && pointError.message ? pointError.message : String(pointError);
                errors.push(errText);
            }
        }

        /*
         * Lorsque le filtre identifiers est actif, la réponse viewport ne
         * contient plus les zones ADVISORY. Une seconde lecture non filtrée est
         * alors limitée aux zones déclarées.
         */
        const settings = sanitizeTrafficSettings(trafficSettings);
        if (
            settings.onlyTrackedIdentifiers
            && settings.showDroneAdvisories
        ) {
            for (const point of points) {
                try {
                    const url = new URL(
                        buildTrafficApiUrl(
                            point,
                            SAFESKY_PROVIDER
                        )
                    );
                    url.searchParams.delete('identifiers');
                    const advisoryData = await fetchSafeSkyJson(url);
                    combinedAircraft.push(
                        ...extractTrafficAircraftList(
                            advisoryData
                        ).filter(isSafeSkyAdvisory)
                    );
                } catch (advisoryError) {
                    console.warn(
                        'Zones drone SafeSky indisponibles:',
                        advisoryError
                    );
                }
            }
        }

        if (trackedIdentifiers.length) {
            try {
                const trackedDirectAircraft = await fetchTrackedTrafficBeacons();
                trackedNationalCount = countTrackedTrafficDirectDetections(
                    trackedDirectAircraft
                );
                combinedAircraft.push(...trackedDirectAircraft);
                if (!usedProviders.includes('SafeSky direct')) {
                    usedProviders.push('SafeSky direct');
                }
            } catch (trackedError) {
                errors.push(
                    `liste suivie: ${
                        trackedError?.message
                        || trackedError
                    }`
                );
            }
        }

        combinedAircraft.push(
            ...getTemporaryGlobalTrafficRaw()
        );

        /*
         * Un filtre plus récent ou une désactivation SafeSky rend ce résultat
         * caduc : il ne doit ni redessiner ni effacer l'état courant.
         */
        if (
            refreshGeneration !== trafficRefreshGeneration
            || !showTrafficLayer
            || !trafficLayer
        ) {
            return;
        }

        if (
            !combinedAircraft.length
            && errors.length
            && errors.length >= points.length
        ) {
            throw new Error(errors.join(' / ') || 'aucune source disponible');
        }

        lastTrafficRefreshAt = Date.now();
        lastTrafficError = '';

        const trafficDiagFetchDoneAt = (
            typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now()
        );
        const trafficDiagFetchMs = Math.max(
            0,
            trafficDiagFetchDoneAt - trafficDiagStartedAt
        );

        writeTrafficDiagBreadcrumb({
            phase: 'render-start',
            seq: trafficDiagSeq,
            raw: combinedAircraft.length,
            registryBefore: trafficDiagRegistryBefore
        });

        npfDiagSiaInteraction(
            'TRAFIC SS',
            `render-start · raison=${String(reason || (force ? 'force' : 'timer'))}`,
            {
                seq: trafficDiagSeq,
                fetchMs: Math.round(trafficDiagFetchMs),
                raw: combinedAircraft.length,
                queryPoints: points.length,
                trackedConfigured: trackedIdentifiers.length,
                registryBefore: trafficDiagRegistryBefore,
                trafficLayersBefore: getTrafficDiagLayerCount(),
                leafletLayersBefore: (() => {
                    try { return Number(Object.keys(map?._layers || {}).length || 0); }
                    catch (_) { return 0; }
                })()
            }
        );

        const trafficDiagRenderStartedAt = (
            typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now()
        );

        renderTrafficAircraft(combinedAircraft, {
            points,
            provider: { label: usedProviders.join(' + ') },
            now: lastTrafficRefreshAt,
            trackedNationalCount
        });

        const trafficDiagRenderEndedAt = (
            typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now()
        );
        const trafficDiagRenderMs = Math.max(
            0,
            trafficDiagRenderEndedAt - trafficDiagRenderStartedAt
        );
        const trafficDiagRegistryAfter = Number(trafficMarkerRegistry?.size || 0);

        writeTrafficDiagBreadcrumb({
            phase: 'render-complete',
            seq: trafficDiagSeq,
            raw: combinedAircraft.length,
            registryBefore: trafficDiagRegistryBefore,
            registryAfter: trafficDiagRegistryAfter,
            renderMs: Math.round(trafficDiagRenderMs)
        });

        /*
         * Les premiers passages sont toujours conservés. Ensuite, on journalise
         * seulement les rendus significatifs pour ne pas saturer le DIAG toutes
         * les 5 secondes.
         */
        if (
            trafficDiagSeq <= 8
            || trafficDiagRenderMs >= 120
            || combinedAircraft.length >= 60
            || Math.abs(trafficDiagRegistryAfter - trafficDiagRegistryBefore) >= 20
        ) {
            npfDiagSiaInteraction(
                'TRAFIC SS',
                `render-complete · raison=${String(reason || (force ? 'force' : 'timer'))}`,
                {
                    seq: trafficDiagSeq,
                    fetchMs: Math.round(trafficDiagFetchMs),
                    renderMs: Math.round(trafficDiagRenderMs),
                    raw: combinedAircraft.length,
                    eligible: Math.max(0, Number(lastTrafficTotalEligibleCount) || 0),
                    displayed: Math.max(0, Number(lastTrafficDisplayedCount) || 0),
                    trackedDetected: Math.max(0, Number(lastTrafficTrackedDetectedCount) || 0),
                    registryBefore: trafficDiagRegistryBefore,
                    registryAfter: trafficDiagRegistryAfter,
                    trafficLayersAfter: getTrafficDiagLayerCount(),
                    smoothAnimation: trafficSmoothAnimationFrame ? 1 : 0,
                    leafletLayersAfter: (() => {
                        try { return Number(Object.keys(map?._layers || {}).length || 0); }
                        catch (_) { return 0; }
                    })()
                }
            );
        }
    } catch (error) {
        if (
            refreshGeneration !== trafficRefreshGeneration
            || !showTrafficLayer
            || !trafficLayer
        ) {
            return;
        }
        lastTrafficError = error && error.message ? error.message : String(error);
        lastTrafficDisplayedCount = 0;

        writeTrafficDiagBreadcrumb({
            phase: 'error',
            seq: trafficDiagSeq,
            raw: 0,
            registryBefore: trafficDiagRegistryBefore,
            registryAfter: Number(trafficMarkerRegistry?.size || 0)
        });
        npfDiagSiaInteraction(
            'TRAFIC SS',
            `erreur · raison=${String(reason || (force ? 'force' : 'timer'))}`,
            {
                seq: trafficDiagSeq,
                elapsedMs: Math.round(Math.max(
                    0,
                    (
                        typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now()
                    ) - trafficDiagStartedAt
                )),
                registryBefore: trafficDiagRegistryBefore,
                registryAfter: Number(trafficMarkerRegistry?.size || 0),
                trafficLayers: getTrafficDiagLayerCount(),
                error: String(lastTrafficError || '').slice(0, 180)
            }
        );

        console.warn('Trafic temporairement indisponible:', error);
        clearTrafficDisplay();
        refreshTrafficButtonState(0);
        updateTrafficStatus({ state: 'error', visible: true, message: 'Trafic temporairement indisponible — nouvelle tentative automatique' });
    } finally {
        const runQueuedRefresh = trafficRefreshQueued && showTrafficLayer;
        trafficRefreshQueued = false;
        isTrafficLoading = false;
        refreshTrafficButtonState();

        if (runQueuedRefresh) {
            setTimeout(() => {
                if (!showTrafficLayer) return;
                refreshTrafficLayer({ force: true, reason: 'queued-latest' });
            }, 0);
        }
    }
}

function startTrafficAutoRefresh() {
    stopTrafficAutoRefresh();

    if (
        typeof document !== 'undefined'
        && document.visibilityState === 'hidden'
    ) {
        return;
    }

    trafficRefreshTimer = setInterval(() => {
        refreshTrafficLayer({ force: false, reason: 'timer' });
    }, TRAFFIC_REFRESH_INTERVAL_MS);
}

function stopTrafficAutoRefresh() {
    if (trafficRefreshTimer) {
        clearInterval(trafficRefreshTimer);
        trafficRefreshTimer = null;
    }
}

function toggleTrafficNonTrackedVisibility(forceState = null) {
    const next = forceState === null
        ? !showNonTrackedTraffic
        : Boolean(forceState);

    if (showNonTrackedTraffic === next) {
        refreshTrafficButtonState();
        return;
    }

    showNonTrackedTraffic = next;
    try {
        localStorage.setItem(
            TRAFFIC_NON_TRACKED_VISIBLE_KEY,
            showNonTrackedTraffic ? 'true' : 'false'
        );
    } catch (_) {}
    refreshTrafficButtonState();

    /*
     * v15.95 — aucun nouvel appel réseau : le dernier snapshot SafeSky contient
     * déjà les trafics correspondant aux filtres courants. On redessine
     * seulement la couche, puis la déduplication GLR est réconciliée par le
     * chemin normal de renderTrafficAircraft().
     */
    if (showTrafficLayer) {
        redrawTrafficLayerFromSnapshot();
    }
}

function toggleTrafficLayer(forceState = null) {
    if (TRAFFIC_DISABLED_FOR_NOW) {
        showTrafficLayer = false;
        trafficRefreshGeneration += 1;
        trafficRefreshQueued = false;
        try { localStorage.setItem(TRAFFIC_LAYER_KEY, 'false'); } catch (_) {}
        stopTrafficAutoRefresh();
        clearTrafficDisplay();
        if (trafficLayer && map && map.hasLayer(trafficLayer)) map.removeLayer(trafficLayer);
        updateTrafficStatus({ visible: false });
        refreshTrafficButtonState(0);
        scheduleBaseMapStabilityRefresh('traffic-disabled');
        return;
    }
    const shouldShow = forceState === null ? !showTrafficLayer : Boolean(forceState);
    showTrafficLayer = shouldShow;
    localStorage.setItem(TRAFFIC_LAYER_KEY, showTrafficLayer ? 'true' : 'false');

    if (showTrafficLayer) {
        if (trafficLayer && map && !map.hasLayer(trafficLayer)) trafficLayer.addTo(map);
        startTrafficAutoRefresh();
        refreshTrafficButtonState();
        refreshTrafficLayer({ force: true, reason: 'toggle' });
    } else {
 // Invalide toute réponse réseau encore en vol avant de retirer la couche.
        trafficRefreshGeneration += 1;
        trafficRefreshQueued = false;
        stopTrafficAutoRefresh();
        clearTrafficDisplay();
        lastTrafficDisplayedCount = 0;
        if (trafficLayer && map && map.hasLayer(trafficLayer)) map.removeLayer(trafficLayer);
        refreshTrafficButtonState(0);
        updateTrafficStatus({ visible: false });

        if (npfGlobalLinkEnabled && npfGlobalLinkLastPositions.length) {
            renderGlobalLinkPositions(npfGlobalLinkLastPositions);
        }
    }

    scheduleBaseMapStabilityRefresh(showTrafficLayer ? 'traffic-on' : 'traffic-off');
    refreshTrackedTrafficListUi();
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        stopTrafficAutoRefresh();
        stopTrafficSmoothAnimation();
        stopSafeSkyOwnPublication();
        return;
    }

    syncSafeSkyOwnPublication();

    if (showTrafficLayer) {
        startTrafficAutoRefresh();
        startTrafficSmoothAnimation();
        refreshTrafficLayer({
            force: true,
            reason: 'visibility-resume'
        });
    }
}, { passive: true });

window.toggleTrafficLayer = toggleTrafficLayer;
window.refreshTrafficLayer = refreshTrafficLayer;
window.searchSafeSkyBeaconExact = searchSafeSkyBeaconExact;
window.fetchSafeSkyBeaconById = fetchSafeSkyBeaconById;
window.getTrackedTrafficIdentifiers = getTrackedTrafficIdentifiers;
setTimeout(() => {
    syncSafeSkyOwnPublication();
}, 3500);

