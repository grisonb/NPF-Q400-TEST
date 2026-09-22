
function refreshDepartmentsRemoteCacheInBackground() {
    if (typeof fetch !== 'function') return;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = setTimeout(() => {
        try { controller?.abort(); } catch (_) {}
    }, 15000);

    fetch(NPF_DEPARTMENTS_REMOTE_URL, {
        cache: 'no-cache',
        signal: controller?.signal
    })
        .then(async (response) => {
            if (!response || !response.ok) return;

            /*
             * Ne jamais remplacer le calque local pendant son affichage :
             * l'appel réseau sert uniquement à entretenir le cache historique.
             */
            try {
                const candidate = await response.clone().json();
                if (!Array.isArray(candidate?.features) || candidate.features.length < 90) return;
            } catch (_) {
                return;
            }

            try {
                if ('caches' in window) {
                    const cache = await caches.open(NPF_DEPARTMENTS_CACHE_NAME);
                    await cache.put(NPF_DEPARTMENTS_REMOTE_URL, response.clone());
                }
            } catch (cacheError) {
                console.warn('Cache départements impossible:', cacheError);
            }
        })
        .catch(() => {
            /* La copie locale embarquée reste la source opérationnelle. */
        })
        .finally(() => clearTimeout(timeoutId));
}

async function loadDepartmentsLayerData() {
    if (hasLoadedDepartments) return;

    /*
     * Une copie Etalab déjà validée en cache reste prioritaire pour conserver
     * exactement le rendu historique des appareils qui l'ont déjà chargée.
     * En l'absence de cache, on bascule immédiatement sur la géométrie locale :
     * aucun fetch réseau n'est attendu pour ouvrir le calque.
     */
    let departmentsGeojson = null;
    try {
        if ('caches' in window) {
            const cached = await caches.match(NPF_DEPARTMENTS_REMOTE_URL, { ignoreSearch: true });
            if (cached && cached.ok) {
                const candidate = await cached.clone().json();
                if (Array.isArray(candidate?.features) && candidate.features.length >= 90) {
                    departmentsGeojson = candidate;
                }
            }
        }
    } catch (_) {}

    if (!departmentsGeojson) {
        departmentsGeojson = NPF_EMBEDDED_DEPARTMENTS_GEOJSON;
    }

    if (!Array.isArray(departmentsGeojson?.features) || !departmentsGeojson.features.length) {
        throw new Error('GeoJSON départements local indisponible');
    }

    departmentsPolygonData = buildDepartmentPolygonIndex(departmentsGeojson);

    if (departmentsLayerGroup && typeof departmentsLayerGroup.clearLayers === 'function') {
        departmentsLayerGroup.clearLayers();
    }
    if (departmentsLabelsLayer && typeof departmentsLabelsLayer.clearLayers === 'function') {
        departmentsLabelsLayer.clearLayers();
    }

    const geoJsonLayer = L.geoJSON(departmentsGeojson, {
        style: getDepartmentBoundaryStyle
    });

    geoJsonLayer.eachLayer((layer) => {
        departmentsLayerGroup.addLayer(layer);
        const properties = layer.feature?.properties || {};
        const depCode = properties.code || properties.code_departement || properties.dep_code || '';
        if (!depCode || !layer.getBounds) return;
        const center = layer.getBounds().getCenter();
        departmentsLabelsLayer.addLayer(L.marker(center, {
            icon: buildDepartmentCodeIcon(depCode),
            interactive: false,
            keyboard: false,
            depCode
        }));
    });

    hasLoadedDepartments = true;
    updateDepartmentsLayerAppearance();

    /* Actualisation externe facultative : elle ne bloque jamais l'affichage. */
    refreshDepartmentsRemoteCacheInBackground();
}

function ensureDepartmentsLayerDataLoaded() {
    if (hasLoadedDepartments) return Promise.resolve();
    if (departmentsLayerLoadPromise) return departmentsLayerLoadPromise;

    departmentsLayerLoadPromise = loadDepartmentsLayerData()
        .catch((error) => {
            departmentsLayerLoadPromise = null;
            throw error;
        });

    return departmentsLayerLoadPromise;
}

async function toggleDepartmentsLayer(shouldShow) {
    const departmentsLayerButton = document.getElementById('departments-layer-button');

    if (shouldShow && !hasLoadedDepartments) {
        try {
            npfStartupDiagMark('departments_data_start', 'Départements — données');
            await ensureDepartmentsLayerDataLoaded();
            npfStartupDiagMark('departments_data_ready', 'Départements — données prêtes');

            if (typeof refreshNearestCommuneDisplayFromKnownGps === 'function') {
                refreshNearestCommuneDisplayFromKnownGps();
            }
            repairManualFireCommuneLabelsFromPolygons();
        } catch (error) {
            console.error('Erreur de chargement du calque départements:', error);
            alert("Impossible de charger le calque des départements.");
            areDepartmentsVisible = false;
            localStorage.setItem(SHOW_DEPARTMENTS_LAYER_KEY, 'false');
            if (departmentsLayerButton) departmentsLayerButton.classList.remove('active');
            return;
        }
    }

    areDepartmentsVisible = shouldShow;

    if (areDepartmentsVisible) {
        departmentsLayerGroup.addTo(map);
        departmentsLabelsLayer.addTo(map);
        updateDepartmentsLayerAppearance();
    } else {
        map.removeLayer(departmentsLayerGroup);
        map.removeLayer(departmentsLabelsLayer);
    }

    localStorage.setItem(SHOW_DEPARTMENTS_LAYER_KEY, String(areDepartmentsVisible));
    if (departmentsLayerButton) departmentsLayerButton.classList.toggle('active', areDepartmentsVisible);
}

function getCommunesBoundaryStyle() {
    const zoom = map && Number.isFinite(map.getZoom()) ? map.getZoom() : 8;

    /*
     * Contours communes renforcés :
     * - plus visibles sur fond OSM/OACI ;
     * - restent moins épais que les limites départementales.
     */
    let weight = 0.9;
    let opacity = 0.72;

    if (zoom >= 10.5) {
        weight = 1.15;
        opacity = 0.82;
    }

    if (zoom >= 12) {
        weight = 1.65;
        opacity = 0.92;
    }

    if (zoom >= 14) {
        weight = 2.15;
        opacity = 1;
    }

    return {
        color: '#111111',
        weight,
        opacity,
        fillColor: '#ffffff',
        fillOpacity: 0,
        pane: 'overlayPane'
    };
}


function buildCommuneNameIcon(communeName) {
    const zoom = map && Number.isFinite(map.getZoom()) ? map.getZoom() : 12;

    /*
     * Tailles strictement inchangées :
     * 10 px, 11 px à partir du zoom 13, 12 px à partir du zoom 15.
     */
    let fontSize = 10;
    let maxWidth = 120;

    if (zoom >= 13) {
        fontSize = 11;
        maxWidth = 150;
    }

    if (zoom >= 15) {
        fontSize = 12;
        maxWidth = 180;
    }

    return L.divIcon({
        className: 'commune-name-label',
        html: `<span style="
            display:inline-block;
            max-width:${maxWidth}px;
            overflow:hidden;
            text-overflow:ellipsis;
            padding:1px 4px;
            border-radius:6px;
            background:rgba(255,255,255,.90);
            color:#050505;
            font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Arial,sans-serif;
            font-size:${fontSize}px;
            font-weight:700;
            font-synthesis:none;
            font-kerning:normal;
            letter-spacing:0;
            line-height:1.05;
            text-align:center;
            text-rendering:optimizeLegibility;
            -webkit-font-smoothing:auto;
            -webkit-text-stroke:0 transparent;
            text-shadow:none;
            box-shadow:
                inset 0 0 0 1px rgba(255,255,255,.95),
                0 1px 2px rgba(0,0,0,.22);
            white-space:nowrap;
        ">${escapeHtml(communeName)}</span>`,
        iconSize: [1, 1],
        iconAnchor: [0, 0]
    });
}

let communesLayerAppearanceRefreshTimer = null;

function scheduleCommunesLayerAppearanceRefresh(delayMs = 260) {
    if (communesLayerAppearanceRefreshTimer) {
        clearTimeout(communesLayerAppearanceRefreshTimer);
    }
    communesLayerAppearanceRefreshTimer = setTimeout(() => {
        communesLayerAppearanceRefreshTimer = null;
        updateCommunesLayerAppearance();
    }, Math.max(0, Number(delayMs) || 0));
}

function updateCommunesLayerAppearance() {
    if (!map || !hasLoadedCommunes) return;

    const zoom = map.getZoom();
    const shouldDrawCommunes = areCommunesVisible && zoom >= COMMUNES_DISPLAY_MIN_ZOOM;

    /*
     * Calque Communes :
     * - sous COMMUNES_DISPLAY_MIN_ZOOM : aucun contour / aucun nom ;
     * - à partir du seuil : contours + noms.
     */
    if (!shouldDrawCommunes) {
        communesLabelsLayer.clearLayers();

        if (map.hasLayer(communesLabelsLayer)) {
            map.removeLayer(communesLabelsLayer);
        }

        if (map.hasLayer(communesLayerGroup)) {
            map.removeLayer(communesLayerGroup);
        }

        updateOfflineStatus();
        return;
    }

    if (!map.hasLayer(communesLayerGroup)) {
        communesLayerGroup.addTo(map);
    }

    if (!map.hasLayer(communesLabelsLayer)) {
        communesLabelsLayer.addTo(map);
    }

    renderVisibleCommuneLayers();
    renderVisibleCommuneLabels();
}


function renderVisibleCommuneLayers() {
    if (!map || !communesLayerGroup || !areCommunesVisible || !hasLoadedCommunes) return;

    communesLayerGroup.clearLayers();

    const zoom = map.getZoom();
    if (zoom < COMMUNES_DISPLAY_MIN_ZOOM) return;

    const viewportBounds = map.getBounds().pad(0.08);
    const style = getCommunesBoundaryStyle();
    let visibleCount = 0;

    for (const item of communesViewportLayerData) {
        if (!item || !item.layer || !item.bounds) continue;
        if (!viewportBounds.intersects(item.bounds)) continue;

        if (typeof item.layer.setStyle === 'function') {
            item.layer.setStyle(style);
        }

        communesLayerGroup.addLayer(item.layer);
        visibleCount += 1;
    }

    updateOfflineStatus();
}



function normalizeCommuneLabelKey(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function hydrateCommunesPopulationMap(entries) {
    const nextMap = new Map();

    for (const entry of Array.isArray(entries) ? entries : []) {
        const code = String(Array.isArray(entry) ? entry[0] : entry?.code || '').trim();
        const population = Number(Array.isArray(entry) ? entry[1] : entry?.population);

        if (!code || !Number.isFinite(population) || population < 0) continue;
        nextMap.set(code, population);
    }

    if (nextMap.size) communesPopulationByInsee = nextMap;
    return communesPopulationByInsee;
}

function readCachedCommunesPopulation() {
    try {
        const raw = localStorage.getItem(COMMUNES_POPULATION_CACHE_KEY);
        if (!raw) return false;

        const cached = JSON.parse(raw);
        const savedAt = Number(cached?.savedAt || 0);
        const entries = Array.isArray(cached?.entries) ? cached.entries : [];

        hydrateCommunesPopulationMap(entries);
        return communesPopulationByInsee.size > 0
            && savedAt > 0
            && (Date.now() - savedAt) <= COMMUNES_POPULATION_CACHE_MAX_AGE_MS;
    } catch (_) {
        return false;
    }
}

function applyPopulationToCommuneLabels() {
    for (const item of communesLabelData) {
        if (!item) continue;
        const population = item.inseeCode
            ? Number(communesPopulationByInsee.get(item.inseeCode))
            : NaN;

        if (Number.isFinite(population) && population >= 0) {
            item.population = population;
        }
    }
}

async function loadCommunesPopulationIndex() {
    if (communesPopulationLoadPromise) return communesPopulationLoadPromise;

    const cacheIsFresh = readCachedCommunesPopulation();

    communesPopulationLoadPromise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6500);

        try {
            const response = await fetch(COMMUNES_POPULATION_API_URL, {
                cache: cacheIsFresh ? 'force-cache' : 'default',
                signal: controller.signal
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const entries = [];

            for (const commune of Array.isArray(data) ? data : []) {
                const code = String(commune?.code || '').trim();
                const population = Number(commune?.population);
                if (!code || !Number.isFinite(population) || population < 0) continue;
                entries.push([code, population]);
            }

            hydrateCommunesPopulationMap(entries);

            try {
                localStorage.setItem(COMMUNES_POPULATION_CACHE_KEY, JSON.stringify({
                    savedAt: Date.now(),
                    entries
                }));
            } catch (_) {}
        } catch (error) {
            console.warn('[Communes] Population indisponible, classement de secours conservé :', error);
        } finally {
            clearTimeout(timeoutId);
        }

        applyPopulationToCommuneLabels();

        if (areCommunesVisible && hasLoadedCommunes) {
            renderVisibleCommuneLabels();
        }

        return communesPopulationByInsee;
    })();

    return communesPopulationLoadPromise;
}

function isCurrentCommuneLabel(item) {
    if (!item || !currentCommune) return false;

    const itemCode = String(item.inseeCode || '');
    const currentCode = String(getCommuneInseeCodeFromProperties(currentCommune) || '');
    if (itemCode && currentCode && itemCode === currentCode) return true;

    const currentName = currentCommune.nom_standard
        || currentCommune.nom
        || currentCommune.name
        || currentCommune.libelle
        || '';

    return normalizeCommuneLabelKey(item.name) === normalizeCommuneLabelKey(currentName);
}

function getCommuneLabelDistanceToCenter(item, center) {
    if (!item?.latLng || !center) return Number.POSITIVE_INFINITY;
    const latDiff = Number(item.latLng.lat) - Number(center.lat);
    const lngDiff = Number(item.latLng.lng) - Number(center.lng);
    return (latDiff * latDiff) + (lngDiff * lngDiff);
}

function renderVisibleCommuneLabels() {
    if (!map || !communesLabelsLayer || !areCommunesVisible || !hasLoadedCommunes) return;

    communesLabelsLayer.clearLayers();

    const zoom = map.getZoom();
    if (zoom < COMMUNES_DISPLAY_MIN_ZOOM) return;

    const bounds = map.getBounds().pad(0.05);
    const center = map.getCenter();
    const maxLabels = zoom >= 14 ? 450 : 220;

    /*
     * Priorité :
     * 1. commune sélectionnée ;
     * 2. population décroissante ;
     * 3. proximité du centre à population égale ou inconnue.
     */
    const visibleItems = communesLabelData
        .filter(item => item?.latLng && bounds.contains(item.latLng))
        .sort((a, b) => {
            const selectedDifference = Number(isCurrentCommuneLabel(b)) - Number(isCurrentCommuneLabel(a));
            if (selectedDifference) return selectedDifference;

            const populationA = Number.isFinite(Number(a.population)) ? Number(a.population) : 0;
            const populationB = Number.isFinite(Number(b.population)) ? Number(b.population) : 0;
            if (populationA !== populationB) return populationB - populationA;

            return getCommuneLabelDistanceToCenter(a, center)
                - getCommuneLabelDistanceToCenter(b, center);
        })
        .slice(0, maxLabels);

    for (const item of visibleItems) {
        communesLabelsLayer.addLayer(L.marker(item.latLng, {
            icon: buildCommuneNameIcon(item.name),
            interactive: false,
            keyboard: false
        }));
    }
}



function simplifyCommuneDisplayName(name) {
    return String(name || '')
        .replace(/\s+Arrondissement$/i, '')
        .replace(/\s+arrondissement$/i, '')
        .trim();
}

function getCommuneNameFromProperties(properties = {}) {
    const rawName = properties.nom || properties.nom_commune || properties.name || properties.libelle || properties.nom_standard || '';
    return simplifyCommuneDisplayName(rawName);
}

/*
 * v13.29 — commune survolée : l'identification du département ne doit plus
 * dépendre d'une recherche par nom. Les communes homonymes comme Mérignac
 * existent dans plusieurs départements ; on utilise donc le code INSEE du
 * polygone Etalab quand il est disponible.
 */
function getCommuneInseeCodeFromProperties(properties = {}) {
    const directCandidates = [
        properties.code,
        properties.code_insee,
        properties.codeInsee,
        properties.insee,
        properties.insee_code,
        properties.code_commune,
        properties.codeCommune
    ];

    for (const candidate of directCandidates) {
        const value = candidate === undefined || candidate === null ? '' : String(candidate).trim().toUpperCase();
        if (/^(?:\d{5}|2[AB]\d{3})$/.test(value)) return value;
    }

    return '';
}

function getCommuneDepCodeFromProperties(properties = {}) {
    const directDep = properties.code_departement || properties.dep_code || properties.dep || properties.codeDepartement || '';
    const normalizedDirectDep = normalizeDepartmentCode(directDep);
    if (normalizedDirectDep) return normalizedDirectDep;

    return deriveDepartmentCodeFromInsee(getCommuneInseeCodeFromProperties(properties));
}

/*
 * v13.30 — commune survolée : le département affiché est calculé à partir
 * du calque départements au même point GPS. Le nom vient du calque communes,
 * le département vient du calque départements ; le code INSEE reste un secours.
 */
function getDepartmentCodeFromProperties(properties = {}) {
    const directCandidates = [
        properties.code,
        properties.code_departement,
        properties.dep_code,
        properties.dep,
        properties.codeDepartement,
        properties.num_dep,
        properties.numero
    ];

    for (const candidate of directCandidates) {
        const value = normalizeDepartmentCode(candidate);
        if (value) return value;
    }

    return '';
}

function getDepartmentNameFromProperties(properties = {}) {
    return String(properties.nom || properties.nom_departement || properties.name || properties.libelle || properties.dep_nom || '').trim();
}

function buildDepartmentPolygonIndex(departmentsGeojson) {
    const features = Array.isArray(departmentsGeojson?.features) ? departmentsGeojson.features : [];
    const index = [];

    features.forEach((feature) => {
        const properties = feature.properties || {};
        const depCode = getDepartmentCodeFromProperties(properties);
        if (!depCode) return;

        const polygons = coordinatesToPolygonSets(feature.geometry);
        const bounds = getGeometryBoundsFromPolygonSets(polygons);
        if (!bounds) return;

        index.push({
            depCode,
            depName: getDepartmentNameFromProperties(properties),
            polygons,
            bounds
        });
    });

    return index;
}

function findDepartmentContainingPoint(lat, lon) {
    if (!Array.isArray(departmentsPolygonData) || !departmentsPolygonData.length) return null;

    const numericLat = Number(lat);
    const numericLon = Number(lon);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLon)) return null;

    for (const department of departmentsPolygonData) {
        const bounds = department.bounds;
        if (!bounds) continue;

        if (
            numericLat < bounds.minLat
            || numericLat > bounds.maxLat
            || numericLon < bounds.minLon
            || numericLon > bounds.maxLon
        ) {
            continue;
        }

        if (isPointInPolygonSets(numericLat, numericLon, department.polygons)) {
            return {
                dep_code: department.depCode,
                dep_nom: department.depName || ''
            };
        }
    }

    return null;
}

function coordinatesToPolygonSets(geometry) {
    if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return [];

    if (geometry.type === 'Polygon') {
        return [geometry.coordinates];
    }

    if (geometry.type === 'MultiPolygon') {
        /*
         * v16.11 — IMPORTANT : conserver chaque polygone séparément.
         * L'ancien .flat() transformait les polygones 2..n en « trous » du
         * premier. C'est notamment faux pour Hyères (continent + îles).
         */
        return geometry.coordinates;
    }

    return [];
}

function getGeometryBoundsFromPolygonSets(polygons) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    (Array.isArray(polygons) ? polygons : []).forEach((rings) => {
        (Array.isArray(rings) ? rings : []).forEach((ring) => {
            if (!Array.isArray(ring)) return;
            ring.forEach((coord) => {
                if (!Array.isArray(coord) || coord.length < 2) return;
                const lon = Number(coord[0]);
                const lat = Number(coord[1]);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
                minLat = Math.min(minLat, lat);
                maxLat = Math.max(maxLat, lat);
                minLon = Math.min(minLon, lon);
                maxLon = Math.max(maxLon, lon);
            });
        });
    });

    if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
    return { minLat, maxLat, minLon, maxLon };
}

function isPointInRing(lat, lon, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;

    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i][0]);
        const yi = Number(ring[i][1]);
        const xj = Number(ring[j][0]);
        const yj = Number(ring[j][1]);

        if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
            continue;
        }

        const intersects = ((yi > lat) !== (yj > lat))
            && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);

        if (intersects) inside = !inside;
    }

    return inside;
}

function isPointInPolygonRings(lat, lon, rings) {
    if (!Array.isArray(rings) || !rings.length) return false;

    /* GeoJSON : anneau 0 = extérieur ; anneaux suivants = trous. */
    if (!isPointInRing(lat, lon, rings[0])) return false;
    for (let i = 1; i < rings.length; i += 1) {
        if (isPointInRing(lat, lon, rings[i])) return false;
    }
    return true;
}

function isPointInPolygonSets(lat, lon, polygons) {
    if (!Array.isArray(polygons) || !polygons.length) return false;
    return polygons.some(rings => isPointInPolygonRings(lat, lon, rings));
}

function buildCommunePolygonIndex(communesGeojson) {
    const features = Array.isArray(communesGeojson?.features) ? communesGeojson.features : [];
    const index = [];

    features.forEach((feature) => {
        const properties = feature.properties || {};
        const name = getCommuneNameFromProperties(properties);
        if (!name) return;

        const polygons = coordinatesToPolygonSets(feature.geometry);
        const bounds = getGeometryBoundsFromPolygonSets(polygons);
        if (!bounds) return;

        const codeInsee = getCommuneInseeCodeFromProperties(properties);

        index.push({
            name,
            codeInsee,
            depCode: getCommuneDepCodeFromProperties(properties),
            polygons,
            bounds
        });
    });

    return index;
}

function findCommuneContainingPoint(lat, lon) {
    if (!Array.isArray(communesPolygonData) || !communesPolygonData.length) return null;

    for (const commune of communesPolygonData) {
        const bounds = commune.bounds;
        if (!bounds) continue;

        if (
            lat < bounds.minLat
            || lat > bounds.maxLat
            || lon < bounds.minLon
            || lon > bounds.maxLon
        ) {
            continue;
        }

        if (isPointInPolygonSets(lat, lon, commune.polygons)) {
            const departmentAtPoint = findDepartmentContainingPoint(lat, lon);
            return {
                nom_standard: commune.name,
                dep_code: departmentAtPoint?.dep_code || commune.depCode || deriveDepartmentCodeFromInsee(commune.codeInsee) || '',
                dep_nom: departmentAtPoint?.dep_nom || '',
                code_insee: commune.codeInsee || ''
            };
        }
    }

    return null;
}

function ensureCommunesLayerDataLoaded() {
    if (hasLoadedCommunes) return Promise.resolve();
    if (communesLayerLoadPromise) return communesLayerLoadPromise;

    communesLayerLoadPromise = loadCommunesLayerData()
        .catch((error) => {
            communesLayerLoadPromise = null;
            throw error;
        });

    return communesLayerLoadPromise;
}


function isTouchTabletForCommunesLayer() {
    const ua = navigator.userAgent || '';
    const isIPadClassic = /iPad/i.test(ua);
    const isIPadDesktopUA = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    const isTouchLargeScreen = navigator.maxTouchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) >= 700;

    return isIPadClassic || isIPadDesktopUA || isTouchLargeScreen;
}

function getCommunesGeojsonUrl() {
    /*
     * v15.96 — iPad : compromis précision / performances.
     * Le GeoJSON local 500 m remplace le 1000 m pour affiner les contours
     * visibles, la commune survolée et le nommage des feux manuels, tout en
     * restant bien plus léger que le 50/100 m complet.
     * Le PC conserve le fichier officiel 50 m.
     */
    if (isTouchTabletForCommunesLayer()) {
        return {
            precision: '500m-local',
            url: './data/communes-500m.geojson'
        };
    }

    return {
        precision: '50m',
        url: 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/communes-50m.geojson'
    };
}

async function loadCommunesLayerData() {
    if (hasLoadedCommunes) return;

 // Chargement en parallèle : la population ne bloque pas la carte.
    loadCommunesPopulationIndex().catch(() => null);

    const communesSource = getCommunesGeojsonUrl();
    const COMMUNES_GEOJSON_URL = communesSource.url;

    updateOfflineStatus();

    if (!communesLayerLoadController) {
        communesLayerLoadController = new AbortController();
    }

    const response = await fetch(COMMUNES_GEOJSON_URL, {
        cache: 'force-cache',
        signal: communesLayerLoadController.signal
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const communesGeojson = await response.json();

    communesPolygonData = buildCommunePolygonIndex(communesGeojson);
    communesLabelData = [];
    communesViewportLayerData = [];
    communesLayerGroup.clearLayers();
    communesLabelsLayer.clearLayers();

    const geoJsonLayer = L.geoJSON(communesGeojson, {
        style: getCommunesBoundaryStyle
    });

    geoJsonLayer.eachLayer((layer) => {
        const properties = layer.feature?.properties || {};
        const communeName = getCommuneNameFromProperties(properties);
        if (!communeName || !layer.getBounds) return;

        const layerBounds = layer.getBounds();
        communesViewportLayerData.push({
            layer,
            bounds: layerBounds
        });

        const center = layerBounds.getCenter();
        const inseeCode = getCommuneInseeCodeFromProperties(properties);
        const directPopulationCandidates = [
            properties.population,
            properties.population_municipale,
            properties.populationMunicipale,
            properties.pop
        ];
        const directPopulation = directPopulationCandidates
            .map(value => Number(value))
            .find(value => Number.isFinite(value) && value >= 0);
        const indexedPopulation = inseeCode
            ? Number(communesPopulationByInsee.get(String(inseeCode)))
            : NaN;

        communesLabelData.push({
            name: communeName,
            inseeCode: String(inseeCode || ''),
            latLng: center,
            population: Number.isFinite(indexedPopulation)
                ? indexedPopulation
                : (Number.isFinite(directPopulation) ? directPopulation : 0)
        });
    });

    hasLoadedCommunes = true;
    updateCommunesLayerAppearance();

    updateOfflineStatus();
}

async function toggleCommunesLayer(shouldShow) {
    const communesLayerButton = document.getElementById('communes-layer-button');

    if (shouldShow && !hasLoadedCommunes) {
        try {
            await loadCommunesLayerData();
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('Erreur de chargement du calque communes:', error);
            alert("Impossible de générer le calque des communes.");
            areCommunesVisible = false;
            localStorage.setItem(SHOW_COMMUNES_LAYER_KEY, 'false');
            if (communesLayerButton) communesLayerButton.classList.remove('active');
            return;
        }
    }

    areCommunesVisible = shouldShow;

    if (areCommunesVisible) {
        updateCommunesLayerAppearance();
    } else {
        if (map.hasLayer(communesLayerGroup)) map.removeLayer(communesLayerGroup);
        if (map.hasLayer(communesLabelsLayer)) map.removeLayer(communesLabelsLayer);
    }

    localStorage.setItem(SHOW_COMMUNES_LAYER_KEY, String(areCommunesVisible));
    if (communesLayerButton) communesLayerButton.classList.toggle('active', areCommunesVisible);
}

