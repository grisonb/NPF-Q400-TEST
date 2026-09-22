// =========================================================================
// FONCTIONS UTILITAIRES
// =========================================================================
const toRad = deg => deg * Math.PI / 180, toDeg = rad => rad * 180 / Math.PI;
const simplifyString = str => typeof str !== 'string' ? '' : str.toLowerCase().replace(/\bst\b/g, 'saint').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
const calculateDistanceInNm = (lat1, lon1, lat2, lon2) => { const R = 6371, dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1), a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2), c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return (R * c) / 1.852; };
const calculateBearing = (lat1, lon1, lat2, lon2) => { const lat1Rad = toRad(lat1), lon1Rad = toRad(lon1), lat2Rad = toRad(lat2), lon2Rad = toRad(lon2), dLon = lon2Rad - lon1Rad, y = Math.sin(dLon) * Math.cos(lat2Rad), x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon); let bearingRad = Math.atan2(y, x), bearingDeg = toDeg(bearingRad); return (bearingDeg + 360) % 360; };
const formatRouteDegrees = (bearing) => {
    const roundedBearing = Math.round(Number(bearing));
    if (!Number.isFinite(roundedBearing)) return '---°';
    const normalizedBearing = ((roundedBearing % 360) + 360) % 360;
    return `${String(normalizedBearing).padStart(3, '0')}°`;
};
function calculateOneWayFlightTimeMinutes(distanceNm) {
    /*
     * v11.58 — temps de vol étiquette carte.
     * Distance prise uniquement : feu ↔ base ou feu ↔ pélicandrome.
     * Formule identique transit : 210 kt jusqu'à 70 Nm, 240 kt au-delà.
     */
    const distance = Number(distanceNm);
    if (!Number.isFinite(distance) || distance <= 0) return null;
    const speedKt = distance <= 70 ? 210 : 240;
    return Math.round(distance * 60 / speedKt);
}

function formatFlightTimeLabel(distanceNm) {
    const minutes = calculateOneWayFlightTimeMinutes(distanceNm);
    return Number.isFinite(minutes) ? `${minutes}'` : "--'";
}

const convertToDMM = (deg, type) => { if (deg === null || isNaN(deg)) return 'N/A'; const absDeg = Math.abs(deg), degrees = Math.floor(absDeg), minutesTotal = (absDeg - degrees) * 60, minutesFormatted = minutesTotal.toFixed(2).padStart(5, '0'); let direction = type === 'lat' ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W'); return `${degrees}° ${minutesFormatted}' ${direction}`; };
const levenshteinDistance = (a, b) => { const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null)); for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i; for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j; for (let j = 1; j <= b.length; j += 1) for (let i = 1; i <= a.length; i += 1) { const indicator = a[i - 1] === b[j - 1] ? 0 : 1; matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + indicator); } return matrix[b.length][a.length]; };
const withTimeout = (promise, timeoutMs, timeoutMessage) => new Promise((resolve, reject) => {
    const timerId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
        (value) => { clearTimeout(timerId); resolve(value); },
        (error) => { clearTimeout(timerId); reject(error); }
    );
});

const TILE_CACHE_PREFIX = 'npf-communes-tile-cache-';


function buildStoredTileKey(tileUrl, packName) {
    const safeUrl = String(tileUrl || '');
    const safePack = String(packName || '').trim();
    return safePack ? `${safeUrl}::${safePack}` : safeUrl;
}

function getTileUrlFromStoredKey(storedUrl) {
    return String(storedUrl || '').split('::')[0];
}

function getPreferredTileCacheName(cacheKeys = []) {
    const tileCacheNames = cacheKeys.filter((name) => name.startsWith(TILE_CACHE_PREFIX)).sort();
    if (tileCacheNames.length) {
        return tileCacheNames[tileCacheNames.length - 1];
    }
    const versionDigits = (typeof APP_VERSION !== 'undefined' ? String(APP_VERSION) : '').replace(/[^0-9]/g, '');
    return `${TILE_CACHE_PREFIX}v${versionDigits || 'fallback'}`;
}

async function persistTilesBatchToCache(batch = []) {
    if (!('caches' in window) || !Array.isArray(batch) || batch.length === 0) return;
    try {
        const cacheKeys = await caches.keys();
        const tileCacheName = getPreferredTileCacheName(cacheKeys);
        const cache = await caches.open(tileCacheName);
        await Promise.all(batch.map(({ url, tile, tileUrl }) => {
            const targetUrl = tileUrl || getTileUrlFromStoredKey(url);
            if (!targetUrl || !tile) return Promise.resolve();
            const contentType = tile.type || (targetUrl.endsWith('.jpg') || targetUrl.endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
            return cache.put(targetUrl, new Response(tile, { headers: { 'Content-Type': contentType } }));
        }));
    } catch (error) {
        console.warn('Impossible de persister les tuiles dans Cache Storage:', error);
    }
}

async function clearTileCaches() {
    if (!('caches' in window)) return;
    const cacheNames = await caches.keys();
    const targets = cacheNames.filter((name) => name.startsWith(TILE_CACHE_PREFIX));
    await Promise.all(targets.map((name) => caches.delete(name)));
}

async function refreshOfflineTilesRendering() {
    notifyServiceWorkerActivePacks(activeOfflinePacks);
    if (map) {
        setupBaseTileLayer();
        scheduleOfflineTileWake('refreshOfflineTilesRendering');
    }
}


function normalizeDepartmentCode(value) {
    if (value === undefined || value === null) return '';
    const raw = String(value).trim().toUpperCase();
    if (!raw) return '';

    if (/^(2A|2B)$/.test(raw)) return raw;
    if (/^2[AB]$/.test(raw)) return raw;
    if (/^\d$/.test(raw)) return `0${raw}`;
    if (/^\d{2,3}$/.test(raw)) return raw;

    return raw;
}

function deriveDepartmentCodeFromInsee(codeInsee) {
    if (codeInsee === undefined || codeInsee === null) return '';
    const code = String(codeInsee).trim().toUpperCase();
    if (!code) return '';

    if (/^2[AB]\d{3}$/.test(code)) return code.slice(0, 2);
    if (/^97[1-6]\d{2}$/.test(code)) return code.slice(0, 3);
    if (/^98\d{3}$/.test(code)) return code.slice(0, 3);
    if (/^\d{5}$/.test(code)) return code.slice(0, 2);

    return '';
}

function getCommuneCodeInsee(commune = {}) {
    const directCandidates = [
        commune.code_insee,
        commune.codeInsee,
        commune.insee,
        commune.insee_code,
        commune.code_commune,
        commune.codeCommune,
        commune.code
    ];

    for (const candidate of directCandidates) {
        const value = candidate === undefined || candidate === null ? '' : String(candidate).trim().toUpperCase();
        if (value) return value;
    }

    return '';
}

function formatCommuneDepartment(commune) {
    if (!commune || typeof commune !== 'object') return '';

    const directCandidates = [
        commune.dep_code,
        commune.dep,
        commune.depCode,
        commune.department_code,
        commune.departmentCode,
        commune.code_departement,
        commune.codeDepartement,
        commune.departement_code,
        commune.departementCode
    ];

    for (const candidate of directCandidates) {
        const value = normalizeDepartmentCode(candidate);
        if (value) return value;
    }

    const fromInsee = deriveDepartmentCodeFromInsee(getCommuneCodeInsee(commune));
    if (fromInsee) return fromInsee;

    const postalCode = commune.code_postal || commune.postal_code || commune.postcode;
    if (postalCode !== undefined && postalCode !== null) {
        const value = String(postalCode).trim();
        if (/^\d{5}$/.test(value)) return value.slice(0, 2);
    }

    return '';
}

function getCommuneFromDatabaseByNameAndDepartment(commune) {
    if (!commune || !Array.isArray(allCommunes) || !allCommunes.length) return null;

    const targetCodeInsee = getCommuneCodeInsee(commune);
    if (targetCodeInsee && communesByCodeInsee instanceof Map) {
        const exactByCode = communesByCodeInsee.get(targetCodeInsee);
        if (exactByCode) return exactByCode;
    }

    const targetName = simplifyString(commune.nom_standard || commune.name || '');
    if (!targetName) return null;

    const targetDep = formatCommuneDepartment(commune);
    const sameName = allCommunes.filter(item => simplifyString(item.nom_standard || item.name || '') === targetName);

    if (!sameName.length) return null;
    if (targetDep) {
        const sameDep = sameName.find(item => formatCommuneDepartment(item) === targetDep);
        if (sameDep) return sameDep;
    }

    return sameName[0];
}

function buildManualFireCommuneFromPoint(lat, lon, fallbackName = 'Feu manuel') {
    /*
     * v12.59 — nommage feu par polygone communal uniquement.
     * On ne persiste plus une commune calculée par simple proximité, car cela
     * peut nommer à tort un feu situé dans Marseille avec une commune limitrophe.
     */
    const containedFromMap = findCommuneContainingPoint(lat, lon);
    const databaseCommune = getCommuneFromDatabaseByNameAndDepartment(containedFromMap) || containedFromMap;

    if (databaseCommune) {
        return {
            nom_standard: databaseCommune.nom_standard || databaseCommune.name || 'Feu manuel',
            dep_code: databaseCommune.dep_code || null,
            dep_nom: databaseCommune.dep_nom || null,
            latitude_mairie: lat,
            longitude_mairie: lon,
            isManual: true,
            communeSource: 'polygon'
        };
    }

    return {
        nom_standard: fallbackName,
        dep_code: null,
        dep_nom: null,
        latitude_mairie: lat,
        longitude_mairie: lon,
        isManual: true,
        communeSource: 'coordinates'
    };
}

async function buildManualFireCommuneFromPointAsync(lat, lon, fallbackName = 'Feu manuel') {
    if (!hasLoadedCommunes) {
        try {
            await ensureCommunesLayerDataLoaded();
        } catch (error) {
            console.warn('Identification commune par polygone indisponible:', error);
        }
    }

    return buildManualFireCommuneFromPoint(lat, lon, fallbackName);
}

function repairManualFireCommuneLabelsFromPolygons() {
    if (!hasLoadedCommunes) return;

    let shouldRefreshCurrent = false;

    try {
        if (currentCommune && currentCommune.isManual) {
            const repairedCurrent = normalizeHistoryCommune(currentCommune);
            if (repairedCurrent) {
                const before = JSON.stringify(currentCommune);
                const after = JSON.stringify(repairedCurrent);
                if (before !== after) {
                    currentCommune = repairedCurrent;
                    localStorage.setItem('currentCommune', JSON.stringify(repairedCurrent));
                    shouldRefreshCurrent = true;
                }
            }
        }
    } catch (_) {}

    try {
        const rawHistory = JSON.parse(localStorage.getItem(FIRE_HISTORY_STORAGE_KEY) || '[]');
        if (Array.isArray(rawHistory)) {
            const repairedHistory = rawHistory
                .map(normalizeHistoryCommune)
                .filter(Boolean)
                .slice(0, FIRE_HISTORY_MAX_ITEMS);
            localStorage.setItem(FIRE_HISTORY_STORAGE_KEY, JSON.stringify(repairedHistory));
        }
    } catch (_) {}

    displayFireHistory();
    drawFireHistoryMarkers();

    if (shouldRefreshCurrent && currentCommune) {
        displayCommuneDetails(currentCommune, false);
    }
}


function normalizeHistoryCommune(commune) {
    if (!commune || typeof commune !== 'object') return null;
    const lat = Number(commune.latitude_mairie);
    const lon = Number(commune.longitude_mairie);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    /*
     * v14.38 — une localité sélectionnée doit rester la localité exacte.
     * Le polygone communal sert uniquement au rattachement administratif et
     * ne doit pas remplacer « Blagon » par « Lanton » dans le feu actif.
     */
    if (commune.locality_match) {
        const localityName = String(
            commune.nom_standard
            || commune.name
            || 'Lieu nommé'
        ).trim();

        if (!localityName) return null;

        return {
            nom_standard: localityName,
            dep_code:
                commune.dep_code || null,
            dep_nom:
                commune.dep_nom || null,
            code_insee:
                commune.code_insee || null,
            latitude_mairie: lat,
            longitude_mairie: lon,
            locality_match: true,
            locality_commune_name: String(
                commune.locality_commune_name
                || ''
            ).trim(),
            locality_type: String(
                commune.locality_type
                || 'lieu nommé'
            ).trim(),
            locality_source: String(
                commune.locality_source
                || ''
            ).trim(),
            fireNumber: Number.isInteger(Number(commune.fireNumber)) && Number(commune.fireNumber) > 0
                ? Number(commune.fireNumber)
                : null,
            savedAt:
                commune.savedAt || Date.now()
        };
    }

    const polygonCommune = findCommuneContainingPoint(lat, lon);
    const polygonDatabaseCommune = polygonCommune ? (getCommuneFromDatabaseByNameAndDepartment(polygonCommune) || polygonCommune) : null;

    let name = String(polygonDatabaseCommune?.nom_standard || polygonDatabaseCommune?.name || commune.nom_standard || commune.name || 'Feu').trim();
    if (!name) return null;

    /*
     * v12.58 — historique feux : priorité au polygone communal.
     * La commune la plus proche n'est plus utilisée pour enrichir un feu,
     * afin d'éviter les erreurs aux limites de Marseille / communes voisines.
     */
    let depCode = polygonDatabaseCommune?.dep_code || commune.dep_code || null;
    let depNom = polygonDatabaseCommune?.dep_nom || commune.dep_nom || null;

    /*
     * Si le nom contient déjà un suffixe "(12)", on récupère ce code
     * et on nettoie le nom pour éviter "Prades-d'Aubrac (12) (12)".
     */
    const depInNameMatch = name.match(/\s*\((\d{1,3}|2A|2B)\)\s*$/i);
    if (depInNameMatch) {
        if (!depCode) depCode = depInNameMatch[1].toUpperCase().padStart(2, '0');
        name = name.replace(/\s*\((\d{1,3}|2A|2B)\)\s*$/i, '').trim();
    }

    return {
        nom_standard: name,
        dep_code: depCode,
        dep_nom: depNom,
        latitude_mairie: lat,
        longitude_mairie: lon,
        isManual: !!commune.isManual,
        fireNumber: Number.isInteger(Number(commune.fireNumber)) && Number(commune.fireNumber) > 0
            ? Number(commune.fireNumber)
            : null,
        savedAt: commune.savedAt || Date.now()
    };
}

/*
 * v15.85 — numérotation stable des feux d'une même commune.
 * - un feu isolé historique reste sans numéro ;
 * - dès qu'une commune possède plusieurs feux, les anciens feux non numérotés
 *   sont numérotés dans leur ordre de création (1, 2, ...);
 * - les numéros existants ne sont jamais renumérotés après suppression ;
 * - un nouveau feu prend toujours max + 1, donc un trou n'est pas réutilisé.
 */
function getFireCommuneNumberingKey(item) {
    if (!item || typeof item !== 'object') return '';
    const communeName = item.locality_match && String(item.locality_commune_name || '').trim()
        ? String(item.locality_commune_name).trim()
        : String(item.nom_standard || item.name || '').trim();
    if (!communeName) return '';
    return [
        simplifyString(communeName),
        String(item.dep_code || '').trim().toUpperCase()
    ].join('|');
}

function stabilizeExistingFireHistoryNumbers(history) {
    const items = Array.isArray(history) ? history : [];
    const groups = new Map();

    items.forEach((item, index) => {
        const key = getFireCommuneNumberingKey(item);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ item, index });
    });

    let changed = false;

    groups.forEach(entries => {
        if (entries.length < 2) return;

        const validNumbers = entries
            .map(entry => Number(entry.item.fireNumber))
            .filter(value => Number.isInteger(value) && value > 0);
        let nextNumber = validNumbers.length ? Math.max(...validNumbers) + 1 : 1;

        // L'historique est stocké du plus récent au plus ancien : on attribue
        // donc d'abord les numéros aux éléments les plus anciens.
        [...entries].reverse().forEach(entry => {
            const currentNumber = Number(entry.item.fireNumber);
            if (Number.isInteger(currentNumber) && currentNumber > 0) return;
            entry.item.fireNumber = nextNumber++;
            changed = true;
        });
    });

    return { items, changed };
}

function getFireHistory() {
    try {
        const rawHistory = localStorage.getItem(FIRE_HISTORY_STORAGE_KEY);
        const parsed = JSON.parse(rawHistory || '[]');
        if (!Array.isArray(parsed)) return [];
        const normalizedHistory = parsed
            .map(normalizeHistoryCommune)
            .filter(Boolean)
            .slice(0, FIRE_HISTORY_MAX_ITEMS);
        const stabilized = stabilizeExistingFireHistoryNumbers(normalizedHistory);
        if (stabilized.changed) {
            localStorage.setItem(FIRE_HISTORY_STORAGE_KEY, JSON.stringify(stabilized.items));
        }
        return stabilized.items;
    } catch (_) {
        return [];
    }
}

function getFireHistoryItemKey(item) {
    const normalized = normalizeHistoryCommune(item);
    if (!normalized) return '';
    return [
        simplifyString(normalized.nom_standard || ''),
        normalized.dep_code || '',
        Number(normalized.latitude_mairie).toFixed(5),
        Number(normalized.longitude_mairie).toFixed(5)
    ].join('|');
}

function deleteFireHistoryItemByCommune(item) {
    const targetKey = getFireHistoryItemKey(item);
    if (!targetKey) return;

    const nextHistory = getFireHistory().filter(entry => getFireHistoryItemKey(entry) !== targetKey);
    localStorage.setItem(FIRE_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
    displayFireHistory();
    drawFireHistoryMarkers();
}


function saveFireHistory(commune) {
    const normalized = normalizeHistoryCommune(commune);
    if (!normalized) return;

    const keyFor = (item) => [
        simplifyString(item.nom_standard || ''),
        item.dep_code || '',
        Number(item.latitude_mairie).toFixed(5),
        Number(item.longitude_mairie).toFixed(5)
    ].join('|');

    let currentHistory = getFireHistory();
    const normalizedKey = keyFor(normalized);
    const exactExisting = currentHistory.find(item => keyFor(item) === normalizedKey) || null;

    if (exactExisting) {
        const existingNumber = Number(exactExisting.fireNumber);
        if (Number.isInteger(existingNumber) && existingNumber > 0) {
            normalized.fireNumber = existingNumber;
        }
        normalized.savedAt = exactExisting.savedAt || normalized.savedAt;
    } else {
        const communeKey = getFireCommuneNumberingKey(normalized);
        const sameCommune = communeKey
            ? currentHistory.filter(item => getFireCommuneNumberingKey(item) === communeKey)
            : [];

        if (sameCommune.length) {
            let maxNumber = sameCommune.reduce((max, item) => {
                const value = Number(item.fireNumber);
                return Number.isInteger(value) && value > max ? value : max;
            }, 0);

            /*
             * Le premier doublon transforme le feu historique unique en « 1 ».
             * Les groupes plus anciens non numérotés ont normalement déjà été
             * migrés par getFireHistory(), mais ce garde-fou couvre aussi les
             * données locales atypiques.
             */
            if (maxNumber === 0) {
                const sameCommuneKeys = new Set(sameCommune.map(keyFor));
                let nextExistingNumber = 1;
                currentHistory = currentHistory.map(item => {
                    if (!sameCommuneKeys.has(keyFor(item))) return item;
                    const updated = { ...item, fireNumber: nextExistingNumber++ };
                    return updated;
                });
                maxNumber = sameCommune.length;
            }

            normalized.fireNumber = maxNumber + 1;
        }
    }

    const nextHistory = [
        normalized,
        ...currentHistory.filter(item => keyFor(item) !== normalizedKey)
    ].slice(0, FIRE_HISTORY_MAX_ITEMS);

    try {
        localStorage.setItem(FIRE_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));

        // Le feu actif doit porter immédiatement le numéro attribué : bandeau,
        // étiquette carte et exports affichent ainsi le même identifiant sans reload.
        if (commune && typeof commune === 'object') {
            if (Number.isInteger(Number(normalized.fireNumber)) && Number(normalized.fireNumber) > 0) {
                commune.fireNumber = Number(normalized.fireNumber);
            }
            commune.savedAt = normalized.savedAt;
        }
        if (currentCommune && keyFor(currentCommune) === normalizedKey) {
            currentCommune.fireNumber = normalized.fireNumber || null;
            currentCommune.savedAt = normalized.savedAt;
            localStorage.setItem('currentCommune', JSON.stringify(currentCommune));
        }

        drawFireHistoryMarkers();
    } catch (error) {
        console.warn('Impossible de mémoriser le feu:', error);
    }
}

function buildFireDisplayName(item) {
    const normalized = normalizeHistoryCommune(item) || item || {};
    const baseName = String(normalized.nom_standard || normalized.name || 'Feu').trim() || 'Feu';
    const fireNumber = Number(normalized.fireNumber);
    const numberedName = Number.isInteger(fireNumber) && fireNumber > 0
        ? `${baseName} ${fireNumber}`
        : baseName;
    const name = normalized.dep_code
        ? `${numberedName} (${normalized.dep_code})`
        : numberedName;
    return String(name || 'Feu');
}

function buildFireMapIcon(label, markerClassName = 'fire-history-map-marker') {
    /*
     * v12.51 — retour à l'étiquette Leaflet au-dessus du feu.
     * La flamme reste dans une zone tactile 34 px ; le nom du feu est affiché
     * par tooltip permanent, avec la petite flèche Leaflet, mais rapproché de
     * l'icône par tooltipAnchor + offset.
     */
    return L.divIcon({
        className: `${markerClassName} fire-touch-hitbox`,
        html: `<span class="fire-marker-glyph">🔥</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -16],
        tooltipAnchor: [0, -10]
    });
}

function bindFireMapTooltip(marker, label, isActive = false) {
    if (!marker) return marker;

    marker.bindTooltip(escapeHtml(label || 'Feu'), {
        permanent: true,
        direction: 'top',
        offset: [0, -2],
        opacity: 1,
        className: `fire-history-map-tooltip-permanent${isActive ? ' fire-active-map-tooltip' : ''}`
    });

    return marker;
}

function buildFireHistoryIcon(label = 'Feu') {
    return buildFireMapIcon(label, 'fire-history-map-marker');
}

function buildActiveFireIcon(label = 'Feu') {
    return buildFireMapIcon(label, 'active-fire-map-marker');
}

function selectFireFromHistoryMap(item) {
    clearAirportDestination({ restoreFire: false, redraw: false });
    const normalized = normalizeHistoryCommune(item);
    if (!normalized) return;

    currentCommune = normalized;
    localStorage.setItem('currentCommune', JSON.stringify(normalized));
    displayCommuneDetails(normalized, false);
    armNpfFirePelicAutoCycle('fire');

    if (map && Number.isFinite(Number(normalized.latitude_mairie)) && Number.isFinite(Number(normalized.longitude_mairie))) {
        map.panTo([Number(normalized.latitude_mairie), Number(normalized.longitude_mairie)]);
    }
}

function drawFireHistoryMarkers() {
    if (!map || !fireHistoryLayer) return;

    fireHistoryLayer.clearLayers();

    const history = getFireHistory();
    const currentLat = currentCommune ? Number(currentCommune.latitude_mairie) : null;
    const currentLon = currentCommune ? Number(currentCommune.longitude_mairie) : null;

    history.forEach((item) => {
        const lat = Number(item.latitude_mairie);
        const lon = Number(item.longitude_mairie);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        /*
         * Le feu actuellement sélectionné est déjà dessiné dans routesLayer.
         * On évite donc de superposer deux flammes au même endroit.
         */
        if (
            Number.isFinite(currentLat)
            && Number.isFinite(currentLon)
            && Math.abs(lat - currentLat) < 0.00001
            && Math.abs(lon - currentLon) < 0.00001
        ) {
            return;
        }

        const name = buildFireDisplayName(item);

        const marker = L.marker([lat, lon], {
            icon: buildFireHistoryIcon(name),
            title: name,
            keyboard: false
        });
        bindFireMapTooltip(marker, name, false);

        marker.bindPopup(() => {
            const container = document.createElement('div');
            container.className = 'fire-history-map-popup';
            container.innerHTML = `<b>${escapeHtml(name)}</b><br>${convertToDMM(lat, 'lat')}<br>${convertToDMM(lon, 'lon')}`;

            const actions = document.createElement('div');
            actions.className = 'fire-history-map-popup-actions';

            const selectButton = document.createElement('button');
            selectButton.type = 'button';
            selectButton.textContent = 'Sélectionner';
            selectButton.className = 'fire-history-map-select-btn';
            selectButton.addEventListener('click', () => {
                selectFireFromHistoryMap(item);
                try { map.closePopup(); } catch (_) {}
            });

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = 'Supprimer';
            deleteButton.className = 'fire-history-map-delete-btn';
            deleteButton.addEventListener('click', () => {
                if (!confirm('Supprimer ce feu de la carte et de l’historique ?')) return;
                deleteFireHistoryItemByCommune(item);
                try { map.closePopup(); } catch (_) {}
            });

            actions.appendChild(selectButton);
            actions.appendChild(deleteButton);
            container.appendChild(actions);
            return container;
        });
        marker.addTo(fireHistoryLayer);
    });
}

function clearFireHistory() {
    try {
        localStorage.removeItem(FIRE_HISTORY_STORAGE_KEY);
    } catch (_) {}

    displayFireHistory();
    drawFireHistoryMarkers();
}

function isFireHistoryCollapsed() {
    try {
        return localStorage.getItem(FIRE_HISTORY_COLLAPSED_STORAGE_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

function setFireHistoryCollapsed(collapsed) {
    try {
        localStorage.setItem(FIRE_HISTORY_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch (_) {}
}

function displayFireHistory() {
 // v13.31 — flèche de repli conservée à droite de « Tout effacer » quand l’historique est ouvert.
    const resultsList = document.getElementById('results-list');
    if (!resultsList) return;

    const history = getFireHistory();
    resultsList.innerHTML = '';

    if (!history.length) {
        resultsList.style.display = 'none';
        return;
    }

    const collapsed = isFireHistoryCollapsed();

    const header = document.createElement('li');
    header.className = 'fire-history-header';

    const toggleHistory = () => {
        setFireHistoryCollapsed(!collapsed);
        displayFireHistory();
    };

    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'fire-history-toggle fire-history-title-toggle';
    titleButton.setAttribute('aria-label', collapsed ? 'Afficher l’historique des feux' : 'Masquer l’historique des feux');
    titleButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    /* v13.34 — la flèche reste dans la zone du titre, loin de la colonne des X de suppression. */
    titleButton.innerHTML = `<span>Historique des feux</span><span class="fire-history-arrow">${collapsed ? '▼' : '▲'}</span>`;
    titleButton.addEventListener('click', toggleHistory);
    header.appendChild(titleButton);

    if (!collapsed) {
        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'fire-history-clear-all';
        clearButton.textContent = '🗑️ Tout effacer';
        clearButton.addEventListener('click', (event) => {
            event.stopPropagation();
            window.clearFireHistory();
        });
        header.appendChild(clearButton);
    }

    resultsList.appendChild(header);

    if (collapsed) {
        resultsList.style.display = 'block';
        return;
    }

    history.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'fire-history-item';

        const name = buildFireDisplayName(item);

        li.innerHTML = `
            <button type="button" class="fire-history-select" title="Reprendre ce feu">${name}</button>
            <div class="fire-history-export-actions" aria-label="Exports du feu">
                <button type="button" class="fire-history-export-btn fire-history-export-kml" title="Exporter ce feu vers ForeFlight">ForeFlight</button>
                <button type="button" class="fire-history-export-btn fire-history-export-sdvfr" title="Exporter ce feu vers SDVFR Next">SDVFR</button>
                <button type="button" class="fire-history-export-btn fire-history-export-ge" title="Exporter ce feu vers Google Earth">G. Earth</button>
            </div>
            <button type="button" class="fire-history-delete" title="Supprimer ce feu">✕</button>
        `;

        li.querySelector('.fire-history-export-kml')?.addEventListener('click', (event) => {
            exportCurrentFireKml(event, item, event.currentTarget);
        });

        li.querySelector('.fire-history-export-sdvfr')?.addEventListener('click', (event) => {
            exportCurrentFireSdvfrCsv(event, item, event.currentTarget);
        });

        /*
         * v15.82 — Google Earth : export KML uniquement depuis l'historique.
         * Aucun dialogue n'est ajouté au marquage GPS pendant le vol.
         */
        li.querySelector('.fire-history-export-ge')?.addEventListener('click', (event) => {
            exportCurrentFireKml(event, item, event.currentTarget);
        });

        li.querySelector('.fire-history-select').addEventListener('click', () => {
            clearAirportDestination({ restoreFire: false, redraw: false });
            currentCommune = item;
            localStorage.setItem('currentCommune', JSON.stringify(item));
            displayCommuneDetails(item);
            armNpfFirePelicAutoCycle('fire');
            resultsList.style.display = 'none';

            const searchInput = document.getElementById('search-input');
            if (searchInput && searchInput.value) {
                setTimeout(() => {
                    try {
                        const end = searchInput.value.length;
                        searchInput.setSelectionRange(end, end);
                    } catch (_) {}
                }, 0);
            }
        });

        li.querySelector('.fire-history-delete').addEventListener('click', (event) => {
            event.stopPropagation();
            window.deleteFireHistoryItem(index);
        });

        resultsList.appendChild(li);
    });

    resultsList.style.display = 'block';
}

window.toggleFireHistoryCollapsed = function() {
    setFireHistoryCollapsed(!isFireHistoryCollapsed());
    displayFireHistory();
};

window.deleteFireHistoryItem = function(index) {
    const history = getFireHistory();
    if (!Number.isInteger(index) || index < 0 || index >= history.length) return;

    history.splice(index, 1);
    localStorage.setItem(FIRE_HISTORY_STORAGE_KEY, JSON.stringify(history));
    displayFireHistory();
    drawFireHistoryMarkers();
};

window.deleteFireHistoryItemByCommune = deleteFireHistoryItemByCommune;

window.clearFireHistory = function() {
    if (!confirm('Effacer tous les derniers feux mémorisés ?')) return;
    localStorage.removeItem(FIRE_HISTORY_STORAGE_KEY);
    drawFireHistoryMarkers();

    const resultsList = document.getElementById('results-list');
    if (resultsList) {
        resultsList.innerHTML = '';
        resultsList.style.display = 'none';
    }
};

function getRouteTooltipLatLng(startLatLng, endLatLng, ratio = 0.5) {
    const startLat = Number(startLatLng[0]);
    const startLon = Number(startLatLng[1]);
    const endLat = Number(endLatLng[0]);
    const endLon = Number(endLatLng[1]);
    return [
        startLat + ((endLat - startLat) * ratio),
        startLon + ((endLon - startLon) * ratio)
    ];
}

function getRouteTooltipOffset(kind = 'default') {
    if (!window.__routeTooltipOffsetCounter) {
        window.__routeTooltipOffsetCounter = { default: 0, pelic: 0, base: 0, user: 0 };
    }

    const offsetsByKind = {
        pelic: [[12, -24], [12, 22], [-80, -24], [-80, 22], [32, -46], [32, 44]],
        base: [[18, -34], [-95, -34], [18, 34], [-95, 34]],
        user: [[0, -36], [0, 36], [-80, -36], [80, 36]],
        default: [[10, -24], [10, 24], [-70, -24], [-70, 24]]
    };

    const safeKind = offsetsByKind[kind] ? kind : 'default';
    const offsets = offsetsByKind[safeKind];
    const index = window.__routeTooltipOffsetCounter[safeKind] % offsets.length;
    window.__routeTooltipOffsetCounter[safeKind] += 1;
    return offsets[index];
}

function resetRouteTooltipOffsets() {
    window.__routeTooltipOffsetCounter = { default: 0, pelic: 0, base: 0, user: 0 };
}

function getRouteLabelNearAirportOptions(fireLatLng, airportLatLng, kind = 'default') {
    /*
     * v11.71 — règle anti-recouvrement pélicandrome :
     * pour les pélicandromes, l'étiquette est placée sur un côté de l'icône
     * avec direction Leaflet top/bottom/left/right. Elle ne doit donc plus
     * se centrer sur l'icône ni la masquer.
     */
    const fallback = {
        latLng: Array.isArray(airportLatLng) ? airportLatLng : [airportLatLng.lat, airportLatLng.lng],
        offset: [0, 30],
        direction: 'bottom'
    };

    if (!map || !map.latLngToLayerPoint || !Array.isArray(fireLatLng) || !Array.isArray(airportLatLng)) {
        return fallback;
    }

    const firePoint = map.latLngToLayerPoint(L.latLng(fireLatLng[0], fireLatLng[1]));
    const airportPoint = map.latLngToLayerPoint(L.latLng(airportLatLng[0], airportLatLng[1]));

    const dx = firePoint.x - airportPoint.x;
    const dy = firePoint.y - airportPoint.y;

    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) {
        return fallback;
    }

    if (kind === 'pelic') {
        /*
         * Le trait arrive sur l'icône depuis la direction dx/dy.
         * L'étiquette part du côté opposé, avec une marge courte.
         */
        if (Math.abs(dx) >= Math.abs(dy)) {
            if (dx >= 0) {
                return { latLng: airportLatLng, offset: [-16, 0], direction: 'left' };
            }
            return { latLng: airportLatLng, offset: [16, 0], direction: 'right' };
        }

        if (dy >= 0) {
            return { latLng: airportLatLng, offset: [0, -16], direction: 'top' };
        }
        return { latLng: airportLatLng, offset: [0, 16], direction: 'bottom' };
    }

    /*
     * Base/autres routes : on conserve le principe d'étiquette proche de l'icône,
     * à l'opposé du trait, sans l'éloignement fort appliqué aux pélicandromes.
     */
    const length = Math.sqrt((dx * dx) + (dy * dy));
    const distanceFromIcon = kind === 'base' ? 86 : 42;
    let offsetX = Math.round((-dx / length) * distanceFromIcon);
    let offsetY = Math.round((-dy / length) * distanceFromIcon);

    if (Math.abs(offsetX) < 12) offsetX = offsetX < 0 ? -12 : 12;
    if (Math.abs(offsetY) < 12) offsetY = offsetY < 0 ? -12 : 12;

    return {
        latLng: airportLatLng,
        offset: [offsetX, offsetY],
        direction: 'center'
    };
}

const calculateDestinationPoint = (lat, lon, bearing, distanceNm) => {
    const R = 3440.065; // Rayon de la Terre en milles nautiques
    const latRad = toRad(lat);
    const lonRad = toRad(lon);
    const bearingRad = toRad(bearing);
    const distRad = distanceNm / R;

    const destLatRad = Math.asin(Math.sin(latRad) * Math.cos(distRad) + Math.cos(latRad) * Math.sin(distRad) * Math.cos(bearingRad));
    let destLonRad = lonRad + Math.atan2(Math.sin(bearingRad) * Math.sin(distRad) * Math.cos(latRad), Math.cos(distRad) - Math.sin(latRad) * Math.sin(destLatRad));

    return [toDeg(destLatRad), toDeg(destLonRad)];
};

function computeConvexHull(latLngPoints) {
    const uniquePoints = new Map();
    latLngPoints.forEach(([lat, lon]) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
        if (!uniquePoints.has(key)) uniquePoints.set(key, [lat, lon]);
    });

    const points = Array.from(uniquePoints.values());
    if (points.length < 3) return points;

    points.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0])); // tri par longitude puis latitude
    const cross = (o, a, b) => ((a[1] - o[1]) * (b[0] - o[0])) - ((a[0] - o[0]) * (b[1] - o[1]));

    const lower = [];
    for (const p of points) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }

    const upper = [];
    for (let i = points.length - 1; i >= 0; i -= 1) {
        const p = points[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

