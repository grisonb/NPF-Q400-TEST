// =========================================================================
// v14.89 — aides contextuelles des imports offline
// - ajout d’un bouton ? à côté de Importer Cartes Offline ;
// - ajout d’un bouton ? à côté de Importer Calque Routier ;
// - ajout d’un bouton ? à côté de Télécharger PDFs Doc Fdf Réduité ;
// - fenêtre d’aide commune adaptée à l’iPad, sans modifier les imports.
// =========================================================================

// =========================================================================
// v14.88 — contour France fidèle à la référence visuelle validée
// - remplacement du tracé polygonal approximatif de la v14.87 ;
// - contour vectorisé depuis la référence France validée ;
// - fond blanc, contour bleu, aucun texte conservés.
// =========================================================================

// =========================================================================
// v14.87 — icône France corrigée pour le sélecteur rapide offline
// - suppression du texte dans le bouton France ;
// - fond blanc conservé en permanence ;
// - silhouette remplacée par un contour bleu de la France ;
// - aspect du bouton rendu cohérent avec la demande utilisateur.
// =========================================================================

// =========================================================================
// v14.85 — réorganisation de Gestion des Cartes et suppression groupée des PDF
// - section Cartes Offline regroupée avec son bouton d'import ;
// - section Calque Routier placée immédiatement sous les cartes offline ;
// - libellés d'import simplifiés ;
// - boutons de suppression redimensionnés ;
// - suppression simultanée de tous les PDF offline avec confirmation.
// =========================================================================

// =========================================================================
// v14.84 — stabilité cartes offline pendant un vol prolongé
// - le calque routier ne reconstruit plus toutes ses couches à chaque recentrage GPS ;
// - les cartouches ne sont recalculés qu'après un déplacement significatif ;
// - les connexions IndexedDB sont rouvertes automatiquement après plusieurs erreurs ;
// - la couche de tuiles locale est reconstruite sans relancer la PWA.
// =========================================================================

// =========================================================================
// v14.83 — cartouches routiers lisibles
// - suppression à l'affichage des suffixes techniques girondins U / Uxxxx ;
// - un seul cartouche par référence dans l'emprise visible ;
// - priorité aux axes principaux et rejet des cartouches qui se chevauchent ;
// - limitation automatique du nombre de cartouches selon le zoom et la taille de l'écran.
// =========================================================================

// =========================================================================
// v14.82 — routes territoriales T / RT et cartouches sur la portion visible
// - import et affichage des références T10, RT10 et « Route territoriale 10 » ;
// - classe T affichée comme une route nationale à partir du niveau 1 NM ;
// - cartouches calculés sur les segments réellement visibles dans la fenêtre ;
// - conservation intégrale des classes A, N, D et M.
// =========================================================================

// =========================================================================
// v14.49 — routes métropolitaines M
// - import des références M613, M185, M5E14, RM613 et « Route métropolitaine » ;
// - classe M affichée comme une route départementale, dès le niveau 1 NM ;
// - conservation intégrale des classes A, N et D existantes.
// =========================================================================

// =========================================================================
// v14.49 — calque routier vectoriel offline A / N / D / M / T
// =========================================================================

function getRoadOverlayManifest() {
    try {
        const parsed = JSON.parse(localStorage.getItem(ROAD_OVERLAY_MANIFEST_KEY) || 'null');
        if (!parsed || !Array.isArray(parsed.parts)) {
            return { version: 1, name: '', importedAt: 0, parts: [] };
        }
        return {
            version: 1,
            name: String(parsed.name || ''),
            importedAt: Number(parsed.importedAt) || 0,
            parts: parsed.parts
                .filter(part => part && typeof part.key === 'string')
                .map(part => ({
                    key: String(part.key),
                    name: String(part.name || part.key),
                    bbox: Array.isArray(part.bbox) && part.bbox.length === 4
                        ? part.bbox.map(Number)
                        : null,
                    featureCount: Number(part.featureCount) || 0
                }))
        };
    } catch (_) {
        return { version: 1, name: '', importedAt: 0, parts: [] };
    }
}

function saveRoadOverlayManifest(manifest) {
    localStorage.setItem(ROAD_OVERLAY_MANIFEST_KEY, JSON.stringify(manifest));
}

function normalizeRoadOverlayReferenceValue(value) {
    if (value === null || value === undefined) return '';

    let normalized = String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
        .replace(/[°º]/g, '')
        .replace(/\bNUMERO\b/g, '')
        .replace(/\bAUTOROUTE\b/g, 'A')
        .replace(/\bROUTE\s*NATIONALE\b/g, 'N')
        .replace(/\bNATIONALE\b/g, 'N')
        .replace(/\bROUTE\s*DEPARTEMENTALE\b/g, 'D')
        .replace(/\bDEPARTEMENTALE\b/g, 'D')
        .replace(/\bROUTE\s*METROPOLITAINE\b/g, 'M')
        .replace(/\bMETROPOLITAINE\b/g, 'M')
        .replace(/\bROUTE\s*TERRITORIALE\b/g, 'T')
        .replace(/\bTERRITORIALE\b/g, 'T')
        .replace(/[\s._/]+/g, '');

    if (!normalized) return '';

    /*
     * L'ordre est important : DN/RDN doit être reconnu avant RD/D.
     * Exemples : DN7, D.N.7, D N 7 et RD N7 deviennent tous DN7.
     */
    let match = normalized.match(/(?:^|[^A-Z0-9])R?DN(\d+[A-Z0-9-]*)(?:$|[^A-Z0-9])/);
    if (!match) match = normalized.match(/R?DN(\d+[A-Z0-9-]*)/);
    if (match) return `DN${match[1]}`;

    /*
     * Formes départementales administratives : RD559, RD 559, CD35.
     */
    match = normalized.match(/(?:^|[^A-Z0-9])(?:R|C)D(\d+[A-Z0-9-]*)(?:$|[^A-Z0-9])/);
    if (!match) match = normalized.match(/(?:R|C)D(\d+[A-Z0-9-]*)/);
    if (match) return `D${match[1]}`;

    /*
     * Formes métropolitaines administratives : RM613, RM 613.
     */
    match = normalized.match(/(?:^|[^A-Z0-9])RM(\d+[A-Z0-9-]*)(?:$|[^A-Z0-9])/);
    if (!match) match = normalized.match(/RM(\d+[A-Z0-9-]*)/);
    if (match) return `M${match[1]}`;

    /*
     * Formes territoriales corses administratives : RT10, RT 10.
     * Elles sont normalisées en T10 pour utiliser une classe unique dans NPF.
     */
    match = normalized.match(/(?:^|[^A-Z0-9])RT(\d+[A-Z0-9-]*)(?:$|[^A-Z0-9])/);
    if (!match) match = normalized.match(/RT(\d+[A-Z0-9-]*)/);
    if (match) return `T${match[1]}`;

    /*
     * Formes nationales administratives : RN7, RN 7.
     */
    match = normalized.match(/(?:^|[^A-Z0-9])RN(\d+[A-Z0-9-]*)(?:$|[^A-Z0-9])/);
    if (!match) match = normalized.match(/RN(\d+[A-Z0-9-]*)/);
    if (match) return `N${match[1]}`;

    /*
     * Formes directement exploitables : A8, N7, D559, M613, T10,
     * D7N et D2007.
     */
    match = normalized.match(/(?:^|[^A-Z0-9])([ANDMT]\d+[A-Z0-9-]*)(?:$|[^A-Z0-9])/);
    if (!match) match = normalized.match(/([ANDMT]\d+[A-Z0-9-]*)/);
    return match ? match[1] : '';
}

function normalizeRoadOverlayDisplayReference(value) {
    let ref = String(value || '').trim().toUpperCase();
    if (!ref) return '';

    /*
     * Le complément routier girondin utilise U, U1, U002, U451, etc. comme
     * identifiants techniques d'unités routières. Ils ne font pas partie du
     * numéro opérationnel affiché sur la carte.
     *
     * Exemples :
     * D211U451       -> D211
     * D1215E1U002    -> D1215E1
     * D211E3U951     -> D211E3
     *
     * Les suffixes routiers officiels E1, E2, E3, N, etc. sont conservés.
     */
    if (/^D\d/.test(ref)) {
        ref = ref.replace(/U\d*$/i, '');
    }

    return ref;
}

function getRoadOverlayFeatureReference(feature) {
    const props = feature?.properties || {};
    const candidates = [
        props.ref,
        props.route,
        props.ROUTE,
        props.num_route,
        props.NUM_ROUTE,
        props.numero_route,
        props.NUMERO_ROUTE,
        props.code_route,
        props.CODE_ROUTE,
        props.numero,
        props.NUMERO,
        props.ref_raw,
        props.toponyme,
        props.TOPONYME,
        props.name,
        props.nom,
        props.NOM
    ];

    for (const value of candidates) {
        const ref = normalizeRoadOverlayDisplayReference(
            normalizeRoadOverlayReferenceValue(value)
        );
        if (ref) return ref;
    }

    return '';
}

function getRoadOverlayClassFromRef(ref) {
    const prefix = String(ref || '').trim().toUpperCase().charAt(0);
    return prefix === 'A'
        || prefix === 'N'
        || prefix === 'D'
        || prefix === 'M'
        || prefix === 'T'
        ? prefix
        : '';
}

function normalizeRoadOverlayFeature(feature) {
    if (!feature || feature.type !== 'Feature' || !feature.geometry) return null;
    const geometryType = feature.geometry.type;
    if (geometryType !== 'LineString' && geometryType !== 'MultiLineString') return null;

    const ref = getRoadOverlayFeatureReference(feature);
    const roadClass = getRoadOverlayClassFromRef(ref);
    if (!ref || !roadClass) return null;

    return {
        type: 'Feature',
        properties: {
            ref,
            roadClass,
            name: String(
                feature.properties?.name
                || feature.properties?.nom
                || feature.properties?.NOM
                || ''
            ).trim()
        },
        geometry: feature.geometry
    };
}

function iterateRoadOverlayCoordinates(geometry, callback) {
    if (!geometry || typeof callback !== 'function') return;
    const coordinates = geometry.coordinates;

    if (geometry.type === 'LineString' && Array.isArray(coordinates)) {
        coordinates.forEach(coord => {
            if (Array.isArray(coord) && coord.length >= 2) {
                callback(Number(coord[0]), Number(coord[1]));
            }
        });
        return;
    }

    if (geometry.type === 'MultiLineString' && Array.isArray(coordinates)) {
        coordinates.forEach(line => {
            if (!Array.isArray(line)) return;
            line.forEach(coord => {
                if (Array.isArray(coord) && coord.length >= 2) {
                    callback(Number(coord[0]), Number(coord[1]));
                }
            });
        });
    }
}

function calculateRoadOverlayGeojsonBbox(geojson) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    (geojson?.features || []).forEach(feature => {
        iterateRoadOverlayCoordinates(feature?.geometry, (lon, lat) => {
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
            minLon = Math.min(minLon, lon);
            minLat = Math.min(minLat, lat);
            maxLon = Math.max(maxLon, lon);
            maxLat = Math.max(maxLat, lat);
        });
    });

    return [minLon, minLat, maxLon, maxLat].every(Number.isFinite)
        ? [minLon, minLat, maxLon, maxLat]
        : null;
}

function normalizeRoadOverlayGeojson(rawGeojson) {
    if (!rawGeojson || rawGeojson.type !== 'FeatureCollection') {
        throw new Error('Le fichier doit être un GeoJSON de type FeatureCollection.');
    }

    const features = (rawGeojson.features || [])
        .map(normalizeRoadOverlayFeature)
        .filter(Boolean);

    if (!features.length) {
        throw new Error('Aucune route A, N, D, M ou T avec une référence exploitable n’a été trouvée.');
    }

    const normalized = {
        type: 'FeatureCollection',
        features
    };
    const bbox = calculateRoadOverlayGeojsonBbox(normalized);
    if (bbox) normalized.bbox = bbox;
    return normalized;
}

function sanitizeRoadOverlayPartName(value, index = 0) {
    const baseName = String(value || `routes-${index + 1}`)
        .replace(/\.(geojson|json)$/i, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return baseName || `routes-${index + 1}`;
}

function buildRoadOverlayCacheRequest(key) {
    const safeKey = encodeURIComponent(String(key || 'routes'));
    return new Request(`${ROAD_OVERLAY_RESOURCE_PREFIX}${safeKey}.geojson`);
}

async function clearRoadOverlayCacheAndManifest() {
    cancelRoadOverlaySpatialBuilds('clear-road-pack');
    clearRoadOverlaySpatialRamCaches();
    try {
        await caches.delete(ROAD_OVERLAY_CACHE_NAME);
    } catch (_) {}
    try {
        await caches.delete(ROAD_OVERLAY_SPATIAL_CACHE_NAME);
    } catch (_) {}
    localStorage.removeItem(ROAD_OVERLAY_MANIFEST_KEY);
}

async function importRoadOverlayFile(file) {
    if (!file) return;
    if (typeof JSZip === 'undefined' && /\.zip$/i.test(file.name)) {
        throw new Error('JSZip n’est pas disponible.');
    }
    if (!('caches' in window)) {
        throw new Error('Le stockage offline Cache API n’est pas disponible.');
    }

    const progressSection = document.getElementById('import-progress-section');
    const statusMessage = document.getElementById('import-status-message');
    const progressBar = document.getElementById('import-progress-bar');

    if (progressSection) progressSection.style.display = 'block';
    if (progressBar) progressBar.style.width = '2%';
    if (statusMessage) statusMessage.textContent = `Lecture de ${file.name}…`;

    const candidates = [];

    if (/\.zip$/i.test(file.name)) {
        const zip = await JSZip.loadAsync(file);
        const entries = Object.values(zip.files || {}).filter(entry => (
            !entry.dir
            && /\.(geojson|json)$/i.test(entry.name)
            && !/(^|\/)(manifest|index)\.json$/i.test(entry.name)
        ));

        if (!entries.length) {
            throw new Error('Le ZIP ne contient aucun fichier .geojson ou .json.');
        }

        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            if (statusMessage) {
                statusMessage.textContent = `Analyse des routes ${index + 1} / ${entries.length}…`;
            }
            if (progressBar) {
                progressBar.style.width = `${Math.max(3, Math.round(((index + 1) / entries.length) * 60))}%`;
            }
            const text = await entry.async('string');
            candidates.push({
                name: entry.name.split('/').pop() || `routes-${index + 1}.geojson`,
                text
            });
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    } else {
        candidates.push({
            name: file.name || 'routes.geojson',
            text: await file.text()
        });
    }

    const normalizedParts = [];
    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        let parsed;
        try {
            parsed = JSON.parse(candidate.text);
        } catch (_) {
            throw new Error(`JSON invalide dans ${candidate.name}.`);
        }

        const normalized = normalizeRoadOverlayGeojson(parsed);
        normalizedParts.push({
            key: `${Date.now()}-${index}-${sanitizeRoadOverlayPartName(candidate.name, index)}`,
            name: candidate.name,
            bbox: normalized.bbox || calculateRoadOverlayGeojsonBbox(normalized),
            featureCount: normalized.features.length,
            text: JSON.stringify(normalized)
        });

        if (statusMessage) {
            statusMessage.textContent = `Préparation ${index + 1} / ${candidates.length}…`;
        }
        if (progressBar) {
            progressBar.style.width = `${60 + Math.round(((index + 1) / candidates.length) * 20)}%`;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    /*
     * Remplacement atomique du pack précédent. On prépare le nouveau cache,
     * puis on enregistre le manifeste seulement lorsque tous les fichiers ont
     * été écrits.
     */
    await clearRoadOverlayCacheAndManifest();
    const cache = await caches.open(ROAD_OVERLAY_CACHE_NAME);

    for (let index = 0; index < normalizedParts.length; index += 1) {
        const part = normalizedParts[index];
        await cache.put(
            buildRoadOverlayCacheRequest(part.key),
            new Response(part.text, {
                headers: {
                    'Content-Type': 'application/geo+json; charset=utf-8',
                    'X-NPF-Road-Part': part.name
                }
            })
        );

        if (statusMessage) {
            statusMessage.textContent = `Stockage offline ${index + 1} / ${normalizedParts.length}…`;
        }
        if (progressBar) {
            progressBar.style.width = `${80 + Math.round(((index + 1) / normalizedParts.length) * 18)}%`;
        }
    }

    const manifest = {
        version: 1,
        name: file.name || 'Calque routier',
        importedAt: Date.now(),
        parts: normalizedParts.map(part => ({
            key: part.key,
            name: part.name,
            bbox: part.bbox,
            featureCount: part.featureCount
        }))
    };
    saveRoadOverlayManifest(manifest);

    clearRoadOverlayRenderedParts({ clearSources: true });
    if (progressBar) progressBar.style.width = '100%';
    if (statusMessage) {
        const totalFeatures = manifest.parts.reduce((sum, part) => sum + part.featureCount, 0);
        statusMessage.textContent = `${totalFeatures.toLocaleString('fr-FR')} tronçons routiers installés.`;
    }

    showRoadOverlayLayer = true;
    localStorage.setItem(ROAD_OVERLAY_LAYER_KEY, 'true');
    await toggleRoadOverlayLayer(true, { silent: true, source: 'import' });
    refreshRoadOverlayInstalledStatus();

    window.setTimeout(() => {
        if (progressSection) progressSection.style.display = 'none';
    }, 1800);
}

async function deleteRoadOverlayData() {
    showRoadOverlayLayer = false;
    localStorage.setItem(ROAD_OVERLAY_LAYER_KEY, 'false');
    clearRoadOverlayRenderedParts({ clearSources: true });

    if (roadOverlayLayer && map?.hasLayer(roadOverlayLayer)) {
        map.removeLayer(roadOverlayLayer);
    }

    await clearRoadOverlayCacheAndManifest();
    refreshRoadOverlayButtonState();
    recordNpfStartupDiagnosticOverlaySnapshot('routes OFF · suppression');
}

function formatRoadOverlayImportedDate(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return '';
    try {
        return new Date(Number(timestamp)).toLocaleString('fr-FR', {
            dateStyle: 'short',
            timeStyle: 'short'
        });
    } catch (_) {
        return '';
    }
}

function refreshRoadOverlayInstalledStatus() {
    const status = document.getElementById('road-overlay-installed-status');
    const deleteButton = document.getElementById('delete-road-overlay-button');
    if (!status) return;

    const manifest = getRoadOverlayManifest();
    const totalFeatures = manifest.parts.reduce(
        (sum, part) => sum + (Number(part.featureCount) || 0),
        0
    );

    if (!manifest.parts.length) {
        status.textContent = 'Aucun pack routier installé.';
        if (deleteButton) deleteButton.style.display = 'none';
        return;
    }

    const importedDate = formatRoadOverlayImportedDate(manifest.importedAt);
    status.textContent = `${manifest.name || 'Calque routier'} — ${manifest.parts.length} partie(s) — ${totalFeatures.toLocaleString('fr-FR')} tronçons${importedDate ? ` — ${importedDate}` : ''}.`;
    if (deleteButton) deleteButton.style.display = 'inline-flex';
}

function refreshRoadOverlayButtonState() {
    const button = document.getElementById('road-overlay-button');
    const status = document.getElementById('road-overlay-button-status');
    if (!button) return;

    const manifest = getRoadOverlayManifest();
    const hasData = manifest.parts.length > 0;

    button.classList.toggle('active', showRoadOverlayLayer && hasData);
    button.classList.toggle('loading', isRoadOverlayLoading);
    button.classList.toggle('missing-data', !hasData);
    button.disabled = isRoadOverlayLoading;

    if (status) {
        status.textContent = hasData ? 'A/N/D/M/T' : '!';
    }

    button.title = isRoadOverlayLoading
        ? 'Chargement du calque routier…'
        : (
            hasData
                ? 'Afficher/Masquer le calque routier A / N / D / M / T'
                : 'Aucun calque routier installé — ouvrir Gestion des Cartes'
        );
}

function buildRoadOverlaySpatialManifestRequest(partKey) {
    const safePartKey = encodeURIComponent(String(partKey || 'routes'));
    return new Request(
        `${ROAD_OVERLAY_SPATIAL_RESOURCE_PREFIX}${safePartKey}/manifest.json`
    );
}

function buildRoadOverlaySpatialCellRequest(partKey, tier, cellKey) {
    const safePartKey = encodeURIComponent(String(partKey || 'routes'));
    const safeCellKey = encodeURIComponent(String(cellKey || '0_0'));
    return new Request(
        `${ROAD_OVERLAY_SPATIAL_RESOURCE_PREFIX}${safePartKey}/t${Number(tier)}/${safeCellKey}.json`
    );
}

function getRoadOverlaySpatialCellCoord(value) {
    return Math.floor(Number(value) / ROAD_OVERLAY_SPATIAL_CELL_DEG);
}

function getRoadOverlaySpatialCellKey(x, y) {
    return `${Number(x)}_${Number(y)}`;
}

function getRoadOverlaySpatialCellRangeFromBbox(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;
    const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;

    return {
        minX: getRoadOverlaySpatialCellCoord(minLon),
        maxX: getRoadOverlaySpatialCellCoord(maxLon),
        minY: getRoadOverlaySpatialCellCoord(minLat),
        maxY: getRoadOverlaySpatialCellCoord(maxLat)
    };
}

function getRoadOverlaySpatialCellKeysForBounds(bounds) {
    if (!bounds) return [];
    let bbox;
    try {
        bbox = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth()
        ];
    } catch (_) {
        return [];
    }

    const range = getRoadOverlaySpatialCellRangeFromBbox(bbox);
    if (!range) return [];

    const keys = [];
    for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
            keys.push(getRoadOverlaySpatialCellKey(x, y));
        }
    }
    return keys;
}

function getRoadOverlaySpatialTierBucket(state, tier) {
    return state?.buckets?.get?.(Number(tier)) || null;
}

async function yieldRoadOverlaySpatialBuildTurn() {
    if (typeof requestIdleCallback === 'function') {
        await new Promise(resolve => {
            requestIdleCallback(() => resolve(), { timeout: 80 });
        });
        return;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
}

function cancelRoadOverlaySpatialBuilds(reason = '') {
    roadOverlaySpatialBuildStates.forEach(state => {
        if (!state) return;
        state.cancelled = true;
        state.cancelReason = String(reason || 'cancelled');
        state.rawGeojson = null;
        state.buckets = null;
        state.overflow = null;
    });
    roadOverlaySpatialBuildStates.clear();
}

function clearRoadOverlaySpatialRamCaches() {
    roadOverlaySpatialManifestRam.clear();
    roadOverlaySpatialCellRam.clear();
}

function getRoadOverlaySpatialCellRamKey(partKey, tier, cellKey) {
    return `${String(partKey)}|${Number(tier)}|${String(cellKey)}`;
}

function getRoadOverlaySpatialCellFromRam(partKey, tier, cellKey) {
    const key = getRoadOverlaySpatialCellRamKey(partKey, tier, cellKey);
    if (!roadOverlaySpatialCellRam.has(key)) return null;

    const value = roadOverlaySpatialCellRam.get(key);

    /*
     * LRU léger : réinsérer en fin de Map à chaque hit.
     */
    roadOverlaySpatialCellRam.delete(key);
    roadOverlaySpatialCellRam.set(key, value);
    return value;
}

function setRoadOverlaySpatialCellInRam(partKey, tier, cellKey, payload) {
    const key = getRoadOverlaySpatialCellRamKey(partKey, tier, cellKey);
    roadOverlaySpatialCellRam.delete(key);
    roadOverlaySpatialCellRam.set(key, payload);

    while (roadOverlaySpatialCellRam.size > ROAD_OVERLAY_SPATIAL_RAM_CELL_LIMIT) {
        const oldestKey = roadOverlaySpatialCellRam.keys().next().value;
        if (oldestKey == null) break;
        roadOverlaySpatialCellRam.delete(oldestKey);
    }
}

async function mapRoadOverlaySpatialInBatches(items, concurrency, worker) {
    const source = Array.isArray(items) ? items : [];
    const width = Math.max(1, Math.floor(Number(concurrency) || 1));
    const results = [];

    for (let index = 0; index < source.length; index += width) {
        const batch = source.slice(index, index + width);
        const batchResults = await Promise.all(batch.map(worker));
        results.push(...batchResults);

        if (index + width < source.length) {
            await yieldRoadOverlayRenderTurn();
        }
    }

    return results;
}

function addRoadOverlaySpatialEntry(bucketMap, cellKey, entry) {
    if (!bucketMap.has(cellKey)) bucketMap.set(cellKey, []);
    bucketMap.get(cellKey).push(entry);
}

async function buildRoadOverlaySpatialBuckets(part, rawGeojson, state) {
    const sourceFeatures = Array.isArray(rawGeojson?.features)
        ? rawGeojson.features
        : [];

    const bucketsByTier = new Map([
        [1, new Map()],
        [2, new Map()]
    ]);
    const overflowByTier = new Map([
        [1, []],
        [2, []]
    ]);

    for (let index = 0; index < sourceFeatures.length; index += 1) {
        if (state.cancelled) return null;

        const feature = sourceFeatures[index];
        const roadClass = String(feature?.properties?.roadClass || '').toUpperCase();
        const tiers = roadClass === 'A'
            ? [1, 2]
            : (
                roadClass === 'N'
                || roadClass === 'D'
                || roadClass === 'M'
                || roadClass === 'T'
                    ? [2]
                    : []
            );
        if (!tiers.length) continue;

        const bbox = getRoadOverlayFeatureBbox(feature);
        const range = getRoadOverlaySpatialCellRangeFromBbox(bbox);
        if (!range) continue;

        const cellCount = (
            (range.maxX - range.minX + 1)
            * (range.maxY - range.minY + 1)
        );
        const entry = [index, bbox, feature];

        for (const tier of tiers) {
            if (cellCount > ROAD_OVERLAY_SPATIAL_MAX_CELLS_PER_FEATURE) {
                overflowByTier.get(tier).push(entry);
                continue;
            }
            const tierBuckets = bucketsByTier.get(tier);
            for (let x = range.minX; x <= range.maxX; x += 1) {
                for (let y = range.minY; y <= range.maxY; y += 1) {
                    addRoadOverlaySpatialEntry(
                        tierBuckets,
                        getRoadOverlaySpatialCellKey(x, y),
                        entry
                    );
                }
            }
        }

        if (
            index > 0
            && index % ROAD_OVERLAY_SPATIAL_BUILD_YIELD_EVERY === 0
        ) {
            await yieldRoadOverlaySpatialBuildTurn();
        }
    }

    if (state.cancelled) return null;

    state.rawGeojson = null;
    state.buckets = bucketsByTier;
    state.overflow = overflowByTier;
    state.bucketReady = true;
    return state;
}

async function persistRoadOverlaySpatialBuckets(part, state) {
    if (state.cancelled || !state.bucketReady) return false;

    const cache = await caches.open(ROAD_OVERLAY_SPATIAL_CACHE_NAME);
    const startedAt = NPF_STARTUP_DIAGNOSTIC.now();
    const tiersManifest = {};

    for (const tier of [1, 2]) {
        if (state.cancelled) return false;

        const tierBuckets = getRoadOverlaySpatialTierBucket(state, tier) || new Map();
        const cellKeys = [...tierBuckets.keys()];
        const overflowEntries = state.overflow?.get?.(tier) || [];

        for (let index = 0; index < cellKeys.length; index += 1) {
            if (state.cancelled) return false;
            const cellKey = cellKeys[index];
            const entries = tierBuckets.get(cellKey) || [];
            await cache.put(
                buildRoadOverlaySpatialCellRequest(part.key, tier, cellKey),
                new Response(
                    JSON.stringify({
                        v: ROAD_OVERLAY_SPATIAL_INDEX_VERSION,
                        p: part.key,
                        t: tier,
                        c: cellKey,
                        e: entries
                    }),
                    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
                )
            );

            if (index > 0 && index % 4 === 0) {
                await yieldRoadOverlaySpatialBuildTurn();
            }
        }

        if (overflowEntries.length) {
            await cache.put(
                buildRoadOverlaySpatialCellRequest(part.key, tier, '__overflow__'),
                new Response(
                    JSON.stringify({
                        v: ROAD_OVERLAY_SPATIAL_INDEX_VERSION,
                        p: part.key,
                        t: tier,
                        c: '__overflow__',
                        e: overflowEntries
                    }),
                    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
                )
            );
        }

        tiersManifest[String(tier)] = {
            cells: cellKeys,
            overflow: overflowEntries.length > 0
        };
    }

    if (state.cancelled) return false;

    const spatialManifest = {
        v: ROAD_OVERLAY_SPATIAL_INDEX_VERSION,
        p: part.key,
        n: part.name,
        rawFeatureCount: Number(state.rawFeatureCount || 0),
        cellDeg: ROAD_OVERLAY_SPATIAL_CELL_DEG,
        tiers: tiersManifest
    };

    await cache.put(
        buildRoadOverlaySpatialManifestRequest(part.key),
        new Response(
            JSON.stringify(spatialManifest),
            { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        )
    );

    roadOverlaySpatialManifestRam.set(part.key, spatialManifest);
    state.persisted = true;

    npfDiagSiaInteraction(
        'ROUTES INDEX',
        `partie=${part.name} · brut=${Number(state.rawFeatureCount || 0)} · cellules1=${tiersManifest['1']?.cells?.length || 0} · cellules2=${tiersManifest['2']?.cells?.length || 0}`,
        {
            totalMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - startedAt),
            rawFeatures: Number(state.rawFeatureCount || 0),
            tier1Cells: tiersManifest['1']?.cells?.length || 0,
            tier2Cells: tiersManifest['2']?.cells?.length || 0
        }
    );

    return true;
}

function scheduleRoadOverlaySpatialIndexBuild(part, rawGeojson, rawFeatureCount) {
    const existing = roadOverlaySpatialBuildStates.get(part.key);
    if (existing) return existing;

    const state = {
        partKey: part.key,
        partName: part.name,
        rawGeojson,
        rawFeatureCount: Number(rawFeatureCount || 0),
        buckets: null,
        overflow: null,
        bucketReady: false,
        persisted: false,
        cancelled: false,
        cancelReason: '',
        promise: null
    };
    roadOverlaySpatialBuildStates.set(part.key, state);

    state.promise = (async () => {
        await yieldRoadOverlaySpatialBuildTurn();
        if (state.cancelled) return false;

        const built = await buildRoadOverlaySpatialBuckets(
            part,
            rawGeojson,
            state
        );
        if (!built || state.cancelled) return false;

        return persistRoadOverlaySpatialBuckets(part, state);
    })()
        .catch(error => {
            if (!state.cancelled) {
                console.warn(
                    'Index spatial Routes non créé:',
                    part.name,
                    error
                );
            }
            return false;
        })
        .finally(() => {
            state.rawGeojson = null;
            state.buckets = null;
            state.overflow = null;
            if (roadOverlaySpatialBuildStates.get(part.key) === state) {
                roadOverlaySpatialBuildStates.delete(part.key);
            }
        });

    return state;
}

async function loadRoadOverlaySpatialManifest(cache, part) {
    const cachedManifest = roadOverlaySpatialManifestRam.get(part.key);
    if (cachedManifest) return cachedManifest;

    try {
        const response = await cache.match(
            buildRoadOverlaySpatialManifestRequest(part.key)
        );
        if (!response || !response.ok) return null;

        const manifest = await response.json();
        if (
            Number(manifest?.v) !== ROAD_OVERLAY_SPATIAL_INDEX_VERSION
            || String(manifest?.p || '') !== String(part.key)
            || Number(manifest?.cellDeg) !== ROAD_OVERLAY_SPATIAL_CELL_DEG
        ) {
            return null;
        }

        roadOverlaySpatialManifestRam.set(part.key, manifest);
        return manifest;
    } catch (_) {
        return null;
    }
}

async function collectRoadOverlaySpatialEntries(
    entries,
    bounds,
    token,
    tier,
    seenIndexes,
    features
) {
    if (!Array.isArray(entries)) return true;

    for (let index = 0; index < entries.length; index += 1) {
        if (
            token !== roadOverlayRefreshToken
            || !showRoadOverlayLayer
            || tier !== roadOverlayLoadedZoomTier
        ) {
            return false;
        }

        const entry = entries[index];
        const sourceIndex = Number(entry?.[0]);
        const bbox = entry?.[1];
        const feature = entry?.[2];

        if (
            !Number.isFinite(sourceIndex)
            || seenIndexes.has(sourceIndex)
            || !feature
            || !roadOverlayBboxIntersectsBounds(bbox, bounds)
            || !shouldLoadRoadOverlayFeatureForTier(feature, tier)
        ) {
            continue;
        }

        seenIndexes.add(sourceIndex);
        try {
            Object.defineProperty(feature, '__npfRoadBbox', {
                value: bbox,
                writable: true,
                configurable: true,
                enumerable: false
            });
        } catch (_) {}

        features.push(feature);

        if (
            index > 0
            && index % ROAD_OVERLAY_FILTER_YIELD_EVERY === 0
        ) {
            await yieldRoadOverlayRenderTurn();
        }
    }

    return true;
}

async function buildRoadOverlayGeojsonFromSpatialState(
    state,
    tier,
    bounds,
    token
) {
    if (!state?.bucketReady) return null;
    const tierBuckets = getRoadOverlaySpatialTierBucket(state, tier);
    if (!tierBuckets) return null;

    const features = [];
    const seenIndexes = new Set();
    const requestedKeys = getRoadOverlaySpatialCellKeysForBounds(bounds);

    for (const cellKey of requestedKeys) {
        const ok = await collectRoadOverlaySpatialEntries(
            tierBuckets.get(cellKey),
            bounds,
            token,
            tier,
            seenIndexes,
            features
        );
        if (!ok) return null;
    }

    const overflowEntries = state.overflow?.get?.(tier) || [];
    const overflowOk = await collectRoadOverlaySpatialEntries(
        overflowEntries,
        bounds,
        token,
        tier,
        seenIndexes,
        features
    );
    if (!overflowOk) return null;

    return {
        type: 'FeatureCollection',
        features
    };
}

async function buildRoadOverlayGeojsonFromSpatialCache(
    cache,
    part,
    spatialManifest,
    tier,
    bounds,
    token
) {
    const tierManifest = spatialManifest?.tiers?.[String(tier)];
    if (!tierManifest) return null;

    const availableCells = new Set(
        Array.isArray(tierManifest.cells) ? tierManifest.cells : []
    );

    const requestedKeys = getRoadOverlaySpatialCellKeysForBounds(bounds)
        .filter(key => availableCells.has(key));

    if (tierManifest.overflow) {
        requestedKeys.push('__overflow__');
    }

    const features = [];
    const seenIndexes = new Set();

    const loadCellPayload = async cellKey => {
        if (
            token !== roadOverlayRefreshToken
            || !showRoadOverlayLayer
            || tier !== roadOverlayLoadedZoomTier
        ) {
            return null;
        }

        const ramPayload = getRoadOverlaySpatialCellFromRam(
            part.key,
            tier,
            cellKey
        );
        if (ramPayload) {
            return {
                cellKey,
                payload: ramPayload,
                fromRam: true
            };
        }

        const response = await cache.match(
            buildRoadOverlaySpatialCellRequest(part.key, tier, cellKey)
        );
        if (!response || !response.ok) {
            throw new Error(`Cellule Routes absente : ${part.name} ${cellKey}`);
        }

        const payload = await response.json();
        if (
            Number(payload?.v) !== ROAD_OVERLAY_SPATIAL_INDEX_VERSION
            || String(payload?.p || '') !== String(part.key)
            || Number(payload?.t) !== Number(tier)
        ) {
            throw new Error(`Cellule Routes invalide : ${part.name} ${cellKey}`);
        }

        setRoadOverlaySpatialCellInRam(
            part.key,
            tier,
            cellKey,
            payload
        );

        return {
            cellKey,
            payload,
            fromRam: false
        };
    };

    /*
     * v16.79 — Cache.match() + response.json() ne sont plus strictement
     * séquentiels. On charge les nouvelles cellules par petits lots de 4 afin
     * de réduire la latence cumulée sans créer un pic de pression WebKit.
     */
    const loadedCells = await mapRoadOverlaySpatialInBatches(
        requestedKeys,
        ROAD_OVERLAY_SPATIAL_CELL_READ_CONCURRENCY,
        loadCellPayload
    );

    let ramHits = 0;
    let storageReads = 0;

    for (const item of loadedCells) {
        if (!item?.payload) return null;

        if (item.fromRam) ramHits += 1;
        else storageReads += 1;

        const ok = await collectRoadOverlaySpatialEntries(
            item.payload.e,
            bounds,
            token,
            tier,
            seenIndexes,
            features
        );
        if (!ok) return null;
    }

    return {
        type: 'FeatureCollection',
        features,
        __npfSpatialStats: {
            cells: requestedKeys.length,
            ramHits,
            storageReads
        }
    };
}

function roadOverlayBboxIntersectsBounds(bbox, bounds) {
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bounds) return true;
    const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return true;

    return !(
        maxLon < bounds.getWest()
        || minLon > bounds.getEast()
        || maxLat < bounds.getSouth()
        || minLat > bounds.getNorth()
    );
}

function getRoadOverlayZoomTier() {
    const zoom = map?.getZoom?.() ?? 0;

    /*
     * Niveau 0 : rien avant 2 NM.
     * Niveau 1 : autoroutes uniquement à partir de 2 NM.
     * Niveau 2 : A + N + D + M + T à partir de 1 NM.
     */
    if (zoom >= 12) return 2;
    if (zoom >= 11) return 1;
    return 0;
}

/*
 * v16.76 — le bouton Routes peut rester ON à une échelle où aucune route
 * n'est dessinée. Dans ce cas, le calque ne doit PAS faire basculer NPF dans
 * le mode "overlay lourd" : pas de masquage de pane, pas d'attente
 * TUILES ZOOM FINAL, pas de rafraîchissement routier sur moveend.
 */
function isRoadOverlayEffectiveAtCurrentZoom() {
    return !!(showRoadOverlayLayer && getRoadOverlayZoomTier() > 0);
}

function hasEffectiveHeavyOverlayAtCurrentZoom() {
    return !!(
        (showHighVoltageLinesLayer && isHighVoltageLayerEffectiveAtCurrentScale())
        || isRoadOverlayEffectiveAtCurrentZoom()
    );
}

function shouldLoadRoadOverlayFeatureForTier(feature, tier) {
    const roadClass = String(
        feature?.properties?.roadClass || ''
    ).toUpperCase();

    if (tier >= 2) {
        return roadClass === 'A'
            || roadClass === 'N'
            || roadClass === 'D'
            || roadClass === 'M'
            || roadClass === 'T';
    }

    if (tier === 1) {
        return roadClass === 'A';
    }

    return false;
}

function calculateRoadOverlayFeatureBbox(feature) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    iterateRoadOverlayCoordinates(feature?.geometry, (lon, lat) => {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
    });

    return [minLon, minLat, maxLon, maxLat].every(Number.isFinite)
        ? [minLon, minLat, maxLon, maxLat]
        : null;
}

function getRoadOverlayFeatureBbox(feature) {
    if (Array.isArray(feature?.__npfRoadBbox) && feature.__npfRoadBbox.length === 4) {
        return feature.__npfRoadBbox;
    }
    const bbox = calculateRoadOverlayFeatureBbox(feature);
    try {
        Object.defineProperty(feature, '__npfRoadBbox', {
            value: bbox,
            writable: true,
            configurable: true,
            enumerable: false
        });
    } catch (_) {
        try { feature.__npfRoadBbox = bbox; } catch (_) {}
    }
    return bbox;
}

async function buildRoadOverlayGeojsonForTierAndBounds(geojson, tier, bounds, token) {
    const sourceFeatures = Array.isArray(geojson?.features) ? geojson.features : [];
    const features = [];

    for (let index = 0; index < sourceFeatures.length; index += 1) {
        if (
            token !== roadOverlayRefreshToken
            || !showRoadOverlayLayer
            || tier !== roadOverlayLoadedZoomTier
        ) {
            return null;
        }

        const feature = sourceFeatures[index];
        if (
            shouldLoadRoadOverlayFeatureForTier(feature, tier)
            && roadOverlayBboxIntersectsBounds(getRoadOverlayFeatureBbox(feature), bounds)
        ) {
            features.push(feature);
        }

        if (index > 0 && index % ROAD_OVERLAY_FILTER_YIELD_EVERY === 0) {
            await yieldRoadOverlayRenderTurn();
        }
    }

    return {
        type: 'FeatureCollection',
        features
    };
}

/*
 * v16.44 — rendu Canvas agrégé par classe routière.
 * Le GeoJSON filtré conserve les features originales pour les cartouches et le
 * diagnostic, mais le dessin n'a plus besoin d'une Polyline Leaflet par feature.
 * Chaque classe A/N/D/M/T devient au maximum un MultiLineString par partie.
 */
function buildRoadOverlayAggregatedRenderGeojson(filteredGeojson) {
    const groupedLines = new Map();
    const features = Array.isArray(filteredGeojson?.features)
        ? filteredGeojson.features
        : [];

    for (const feature of features) {
        const roadClass = String(feature?.properties?.roadClass || '').toUpperCase();
        if (!roadClass) continue;
        const lines = getRoadOverlayGeometryLines(feature);
        if (!lines.length) continue;
        if (!groupedLines.has(roadClass)) groupedLines.set(roadClass, []);
        const target = groupedLines.get(roadClass);
        for (const line of lines) {
            if (Array.isArray(line) && line.length >= 2) target.push(line);
        }
    }

    return {
        type: 'FeatureCollection',
        features: [...groupedLines.entries()]
            .filter(([, lines]) => lines.length)
            .map(([roadClass, lines]) => ({
                type: 'Feature',
                properties: { roadClass, ref: roadClass },
                geometry: {
                    type: 'MultiLineString',
                    coordinates: lines
                }
            }))
    };
}

function getRoadOverlayLineStyle(feature, casing = false) {
    const roadClass = getRoadOverlayClassFromRef(
        feature?.properties?.ref || feature?.properties?.roadClass
    ) || String(feature?.properties?.roadClass || '');

    const zoom = map?.getZoom?.() ?? 10;
    const visibleAtCurrentZoom = shouldDisplayRoadOverlayFeature(feature);
    const styleByClass = {
        A: {
            color: '#e85d04',
            weight: zoom >= 12 ? 4.6 : 3.9,
            casingWeight: zoom >= 12 ? 6.3 : 5.5
        },
        N: {
            color: '#d62828',
            weight: zoom >= 12 ? 4.0 : 3.3,
            casingWeight: zoom >= 12 ? 5.6 : 4.9
        },
        T: {
            color: '#d62828',
            weight: zoom >= 12 ? 4.0 : 3.3,
            casingWeight: zoom >= 12 ? 5.6 : 4.9
        },
        D: {
            color: '#f0a202',
            weight: zoom >= 13 ? 3.0 : 2.5,
            casingWeight: zoom >= 13 ? 4.8 : 4.2
        },
        M: {
            color: '#f0a202',
            weight: zoom >= 13 ? 3.0 : 2.5,
            casingWeight: zoom >= 13 ? 4.8 : 4.2
        }
    };

    const selected = styleByClass[roadClass] || styleByClass.D;

    /*
     * Toutes les routes restent présentes dans les couches Leaflet. En dessous
     * du zoom prévu, elles deviennent transparentes mais ne sont pas supprimées.
     */
    return {
        color: casing ? '#ffffff' : selected.color,
        weight: visibleAtCurrentZoom
            ? (casing ? selected.casingWeight : selected.weight)
            : 0,
        /*
         * v16.82 — les noms de villes sont imprimés dans le fond raster.
         * Le calque Routes reste au-dessus mais devient plus transparent
         * afin de laisser les toponymes lisibles.
         */
        opacity: visibleAtCurrentZoom
            ? (casing ? 0.32 : 0.78)
            : 0,
        fillOpacity: 0,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
        pane: casing ? 'roadOverlayCasingPane' : 'roadOverlayLinePane'
    };
}

function shouldDisplayRoadOverlayFeature(feature) {
    const roadClass = String(feature?.properties?.roadClass || '').toUpperCase();
    const zoom = map?.getZoom?.() ?? 10;

    /*
     * v14.20 — autoroutes à partir de l'échelle 2 NM environ.
     * Sur la carte actuelle, cela correspond au niveau de zoom 11.
     */
    if (roadClass === 'A') return zoom >= 11;

    /*
     * v14.20 — nationales et départementales à partir de l'échelle 1 NM
     * environ, correspondant au niveau de zoom 12.
     */
    if (roadClass === 'N' || roadClass === 'T') return zoom >= 12;
    if (roadClass === 'D' || roadClass === 'M') return zoom >= 12;
    return false;
}

function getRoadOverlayGeometryLines(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return [];

    if (geometry.type === 'LineString') {
        return Array.isArray(geometry.coordinates)
            ? [geometry.coordinates]
            : [];
    }

    if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
        return geometry.coordinates.filter(Array.isArray);
    }

    return [];
}

function getRoadOverlayLongestLineCoordinates(feature) {
    return getRoadOverlayGeometryLines(feature).reduce((longest, line) => (
        Array.isArray(line) && line.length > (longest?.length || 0)
            ? line
            : longest
    ), null);
}

function getRoadOverlayLabelBounds() {
    if (!map) return null;

    try {
        const size = map.getSize();
        const margin = Math.max(
            18,
            Math.min(42, Math.round(Math.min(size.x, size.y) * 0.045))
        );

        if (size.x > margin * 2 + 20 && size.y > margin * 2 + 20) {
            const northWest = map.containerPointToLatLng([margin, margin]);
            const southEast = map.containerPointToLatLng([
                size.x - margin,
                size.y - margin
            ]);
            return L.latLngBounds(
                [southEast.lat, northWest.lng],
                [northWest.lat, southEast.lng]
            );
        }
    } catch (_) {}

    return map.getBounds();
}

function clipRoadOverlaySegmentToBounds(start, end, bounds) {
    if (!Array.isArray(start) || !Array.isArray(end) || !bounds) return null;

    const x0 = Number(start[0]);
    const y0 = Number(start[1]);
    const x1 = Number(end[0]);
    const y1 = Number(end[1]);

    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;

    const west = Number(bounds.getWest());
    const east = Number(bounds.getEast());
    const south = Number(bounds.getSouth());
    const north = Number(bounds.getNorth());

    if (![west, east, south, north].every(Number.isFinite)) return null;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - west, east - x0, y0 - south, north - y0];

    let uStart = 0;
    let uEnd = 1;

    for (let index = 0; index < 4; index += 1) {
        if (Math.abs(p[index]) < 1e-12) {
            if (q[index] < 0) return null;
            continue;
        }

        const ratio = q[index] / p[index];
        if (p[index] < 0) {
            uStart = Math.max(uStart, ratio);
        } else {
            uEnd = Math.min(uEnd, ratio);
        }

        if (uStart > uEnd) return null;
    }

    return [
        [x0 + uStart * dx, y0 + uStart * dy],
        [x0 + uEnd * dx, y0 + uEnd * dy]
    ];
}

function getRoadOverlayVisibleSegments(feature, bounds) {
    const segments = [];

    getRoadOverlayGeometryLines(feature).forEach(line => {
        if (!Array.isArray(line) || line.length < 2) return;

        for (let index = 1; index < line.length; index += 1) {
            const clipped = clipRoadOverlaySegmentToBounds(
                line[index - 1],
                line[index],
                bounds
            );
            if (!clipped) continue;

            const start = L.latLng(Number(clipped[0][1]), Number(clipped[0][0]));
            const end = L.latLng(Number(clipped[1][1]), Number(clipped[1][0]));
            const length = start.distanceTo(end);

            if (!Number.isFinite(length) || length <= 0) continue;
            segments.push({ start, end, length });
        }
    });

    return segments;
}

function getRoadOverlayMidpointOnSegments(segments) {
    if (!Array.isArray(segments) || !segments.length) return null;

    const totalLength = segments.reduce(
        (sum, segment) => sum + (Number(segment?.length) || 0),
        0
    );
    if (!Number.isFinite(totalLength) || totalLength <= 0) return null;

    const target = totalLength / 2;
    let walked = 0;

    for (const segment of segments) {
        const length = Number(segment?.length) || 0;
        if (walked + length >= target) {
            const ratio = length > 0 ? (target - walked) / length : 0;
            return L.latLng(
                segment.start.lat + (segment.end.lat - segment.start.lat) * ratio,
                segment.start.lng + (segment.end.lng - segment.start.lng) * ratio
            );
        }
        walked += length;
    }

    return segments[segments.length - 1]?.end || null;
}

function getRoadOverlayFeatureLabelPoint(feature, bounds = null) {
    /*
     * v14.82 — placer le cartouche sur la portion de route réellement visible.
     * Une marge intérieure en pixels évite qu'il soit coupé par le bord de la
     * carte. Si aucune portion n'entre dans cette zone, on réessaie sur toute
     * l'emprise visible avant d'abandonner.
     */
    const preferredBounds = bounds || getRoadOverlayLabelBounds();
    const preferredSegments = preferredBounds
        ? getRoadOverlayVisibleSegments(feature, preferredBounds)
        : [];
    const preferredPoint = getRoadOverlayMidpointOnSegments(preferredSegments);
    if (preferredPoint) return preferredPoint;

    const fullBounds = map?.getBounds?.();
    if (fullBounds && fullBounds !== preferredBounds) {
        const fullSegments = getRoadOverlayVisibleSegments(feature, fullBounds);
        const fullPoint = getRoadOverlayMidpointOnSegments(fullSegments);
        if (fullPoint) return fullPoint;
    }

    return null;
}

function getRoadOverlayLabelClassPriority(roadClass) {
    const priorities = {
        A: 0,
        N: 1,
        T: 1,
        M: 2,
        D: 3
    };
    return priorities[String(roadClass || '').toUpperCase()] ?? 4;
}

function getRoadOverlayLabelBranchPriority(ref) {
    /*
     * À classe identique, afficher d'abord les axes principaux D211, D1215,
     * M35, etc., avant leurs branches D211E1, D1215E1 ou autres suffixes.
     */
    return /^[ANDMT]\d+$/.test(String(ref || '').toUpperCase()) ? 0 : 1;
}

function getRoadOverlayMinimumLabelLength(roadClass, zoom) {
    if (roadClass === 'A' || roadClass === 'N' || roadClass === 'T') {
        return zoom >= 13 ? 90 : 180;
    }
    if (roadClass === 'M') {
        return zoom >= 13 ? 120 : 260;
    }
    /* v17.25 — à z13 (~0,5 NM sur la configuration iPad de référence),
     * rendre davantage de références départementales candidates sans toucher
     * aux autres niveaux de zoom. L'anti-collision reste inchangé. */
    return zoom >= 14 ? 120 : (zoom >= 13 ? 180 : 520);
}

function getRoadOverlayMaximumLabelCount() {
    if (!map) return 0;

    const zoom = map.getZoom();
    const size = map.getSize();
    const area = Math.max(1, Number(size.x) * Number(size.y));

    /* v17.25 — z13 : plafond relevé pour permettre environ 30 cartouches
     * sur l'iPad de référence. Les priorités A/N/T/M/D et l'anti-collision
     * restent inchangés ; z12 et z14+ conservent leur comportement propre. */
    const absoluteLimit = zoom >= 14 ? 30 : (zoom >= 13 ? 30 : 14);
    const areaPerLabel = zoom >= 14 ? 39000 : (zoom >= 13 ? 45000 : 76000);
    const areaLimit = Math.max(8, Math.floor(area / areaPerLabel));

    return Math.max(8, Math.min(absoluteLimit, areaLimit));
}

function getRoadOverlayLabelCollisionBox(point, ref) {
    const screenPoint = map.latLngToContainerPoint(point);
    const width = Math.max(36, Math.min(106, 18 + String(ref || '').length * 8));
    const height = 24;
    const padding = 8;

    return {
        left: screenPoint.x - width / 2 - padding,
        right: screenPoint.x + width / 2 + padding,
        top: screenPoint.y - height / 2 - padding,
        bottom: screenPoint.y + height / 2 + padding
    };
}

function roadOverlayLabelBoxesIntersect(first, second) {
    return !(
        first.right < second.left
        || first.left > second.right
        || first.bottom < second.top
        || first.top > second.bottom
    );
}

function addRoadOverlayLabelsForGeojson(geojson, partKey, candidatesByRef = new Map()) {
    if (!map) return candidatesByRef;

    const zoom = map.getZoom();
    const bounds = getRoadOverlayLabelBounds() || map.getBounds();

    (geojson?.features || []).forEach(feature => {
        if (!shouldDisplayRoadOverlayFeature(feature)) return;

        const roadClass = String(feature?.properties?.roadClass || '').toUpperCase();
        if (
            (roadClass === 'D' || roadClass === 'M' || roadClass === 'T')
            && zoom < 12
        ) return;

        const ref = normalizeRoadOverlayDisplayReference(
            feature?.properties?.ref
        );
        if (!ref) return;

        const segments = getRoadOverlayVisibleSegments(feature, bounds);
        const visibleLength = segments.reduce(
            (sum, segment) => sum + (Number(segment?.length) || 0),
            0
        );

        if (
            !Number.isFinite(visibleLength)
            || visibleLength < getRoadOverlayMinimumLabelLength(roadClass, zoom)
        ) {
            return;
        }

        const point = getRoadOverlayMidpointOnSegments(segments)
            || getRoadOverlayFeatureLabelPoint(feature, bounds);
        if (!point || !map.getBounds().contains(point)) return;

        const candidate = {
            ref,
            roadClass,
            point,
            visibleLength,
            partKey,
            classPriority: getRoadOverlayLabelClassPriority(roadClass),
            branchPriority: getRoadOverlayLabelBranchPriority(ref)
        };

        const existing = candidatesByRef.get(ref);
        if (
            !existing
            || candidate.classPriority < existing.classPriority
            || (
                candidate.classPriority === existing.classPriority
                && candidate.branchPriority < existing.branchPriority
            )
            || (
                candidate.classPriority === existing.classPriority
                && candidate.branchPriority === existing.branchPriority
                && candidate.visibleLength > existing.visibleLength
            )
        ) {
            candidatesByRef.set(ref, candidate);
        }
    });

    return candidatesByRef;
}

function renderRoadOverlayLabelCandidates(candidatesByRef) {
    if (!roadOverlayLabelsLayer || !map || !(candidatesByRef instanceof Map)) return;

    const maximumLabels = getRoadOverlayMaximumLabelCount();
    if (maximumLabels <= 0) return;

    const candidates = Array.from(candidatesByRef.values()).sort((first, second) => (
        first.classPriority - second.classPriority
        || first.branchPriority - second.branchPriority
        || second.visibleLength - first.visibleLength
        || String(first.ref).localeCompare(String(second.ref), 'fr', {
            numeric: true,
            sensitivity: 'base'
        })
    ));

    const occupiedBoxes = [];
    let displayed = 0;

    for (const candidate of candidates) {
        if (displayed >= maximumLabels) break;

        const box = getRoadOverlayLabelCollisionBox(
            candidate.point,
            candidate.ref
        );
        if (occupiedBoxes.some(existing => (
            roadOverlayLabelBoxesIntersect(box, existing)
        ))) {
            continue;
        }

        occupiedBoxes.push(box);

        const marker = L.marker(candidate.point, {
            pane: 'roadOverlayLabelPane',
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
                className: 'road-overlay-label-marker',
                html: `<span class="road-overlay-ref road-overlay-ref-${candidate.roadClass.toLowerCase()}">${escapeHtml(candidate.ref)}</span>`,
                iconSize: null
            })
        });
        marker.__npfRoadPartKey = candidate.partKey;
        marker.__npfRoadRef = candidate.ref;
        marker.addTo(roadOverlayLabelsLayer);
        displayed += 1;
    }
}

function getRoadOverlayStyleBand() {
    const zoom = map?.getZoom?.() ?? 0;
    if (zoom >= 13) return 3;
    if (zoom >= 12) return 2;
    if (zoom >= 11) return 1;
    return 0;
}

function getRoadOverlayPartSignature(parts, tier) {
    const keys = (Array.isArray(parts) ? parts : [])
        .map(part => String(part?.key || ''))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(
            right,
            'fr',
            { numeric: true, sensitivity: 'base' }
        ));
    return `${Number(tier) || 0}|${keys.join('|')}`;
}

function getLoadedRoadOverlayPartSignature(tier) {
    const keys = [];
    loadedRoadOverlayParts.forEach((record, key) => {
        if (record?.tier === tier) keys.push(String(key || ''));
    });
    keys.sort((left, right) => left.localeCompare(
        right,
        'fr',
        { numeric: true, sensitivity: 'base' }
    ));
    return `${Number(tier) || 0}|${keys.join('|')}`;
}

function shouldRefreshRoadOverlayLabelsForView({ force = false } = {}) {
    if (!map) return false;
    if (force) return true;

    const center = map.getCenter?.();
    const zoom = Number(map.getZoom?.());
    const now = Date.now();

    if (
        !center
        || !roadOverlayLastLabelCenter
        || !Number.isFinite(roadOverlayLastLabelZoom)
        || zoom !== roadOverlayLastLabelZoom
    ) {
        return true;
    }

    if (
        now - roadOverlayLastLabelRefreshAt
        >= ROAD_OVERLAY_LABEL_REFRESH_MAX_INTERVAL_MS
    ) {
        return true;
    }

    try {
        const bounds = map.getBounds();
        const westPoint = L.latLng(center.lat, bounds.getWest());
        const eastPoint = L.latLng(center.lat, bounds.getEast());
        const viewportWidthMeters = westPoint.distanceTo(eastPoint);
        const minimumShiftMeters = Math.max(
            1200,
            viewportWidthMeters * ROAD_OVERLAY_LABEL_REFRESH_VIEWPORT_RATIO
        );
        return center.distanceTo(roadOverlayLastLabelCenter) >= minimumShiftMeters;
    } catch (_) {
        return false;
    }
}

function rememberRoadOverlayLabelView() {
    if (!map) return;
    try {
        const center = map.getCenter();
        roadOverlayLastLabelCenter = L.latLng(center.lat, center.lng);
    } catch (_) {
        roadOverlayLastLabelCenter = null;
    }
    roadOverlayLastLabelZoom = Number(map.getZoom?.());
    roadOverlayLastLabelRefreshAt = Date.now();
}

function resetRoadOverlayRefreshState() {
    roadOverlayLastVisiblePartSignature = '';
    roadOverlayLastStyleBand = -1;
    roadOverlayLastLabelCenter = null;
    roadOverlayLastLabelZoom = -1;
    roadOverlayLastLabelRefreshAt = 0;
    roadOverlayRenderedBounds = null;
    roadOverlayRenderedPartSignature = '';
}

function clearRoadOverlaySourceParts() {
    roadOverlaySourceParts.clear();
}

function releaseRoadOverlaySourceCacheIfHeavy(reason = '', force = false) {
    const before = getNpfRoadSourceFeatureCount();
    if (before <= 0) return false;
    if (!force && before <= ROAD_OVERLAY_SOURCE_FEATURE_SOFT_LIMIT) return false;
    clearRoadOverlaySourceParts();
    recordNpfStartupDiagnosticOverlaySnapshot(
        `routes cache source libéré · ${reason || 'mémoire'} · avant=${before}`
    );
    return true;
}

function pruneRoadOverlaySourceParts(visibleKeys) {
    if (!(visibleKeys instanceof Set)) return;
    [...roadOverlaySourceParts.keys()].forEach(key => {
        if (!visibleKeys.has(key)) roadOverlaySourceParts.delete(key);
    });
}

function roadOverlayBoundsContainBounds(outerBounds, innerBounds) {
    if (!outerBounds || !innerBounds) return false;
    try {
        return outerBounds.getWest() <= innerBounds.getWest()
            && outerBounds.getEast() >= innerBounds.getEast()
            && outerBounds.getSouth() <= innerBounds.getSouth()
            && outerBounds.getNorth() >= innerBounds.getNorth();
    } catch (_) {
        return false;
    }
}

function cloneRoadOverlayBounds(bounds) {
    try {
        return L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
    } catch (_) {
        return null;
    }
}

function roadOverlaySourceRecordCoversBounds(record, tier, bounds) {
    if (!record || !bounds) return false;
    if (Number(record.tier) !== Number(tier)) return false;
    return roadOverlayBoundsContainBounds(record.coverageBounds, bounds);
}

function buildRoadOverlaySourceWorksetBounds(renderBounds, tier) {
    if (!renderBounds?.pad) return renderBounds || null;
    const ratio = tier === 1
        ? ROAD_OVERLAY_SOURCE_WORKSET_PAD_TIER_1
        : ROAD_OVERLAY_SOURCE_WORKSET_PAD_TIER_2;
    try {
        return renderBounds.pad(ratio);
    } catch (_) {
        return renderBounds;
    }
}

function isRoadOverlayCoverageValidForCurrentView() {
    if (!map || !roadOverlayRenderedBounds || roadOverlayLoadedZoomTier !== getRoadOverlayZoomTier()) return false;
    try {
        return roadOverlayBoundsContainBounds(roadOverlayRenderedBounds, map.getBounds());
    } catch (_) {
        return false;
    }
}

function setNpfHeavyOverlayPanesHidden(hidden) {
    /*
     * v17.02 — pendant la séquence prioritaire, elle seule décide quand HT et
     * Routes redeviennent visibles. Un ancien appel `hidden=false` ne doit pas
     * court-circuiter l'ordre tuiles -> VFR -> HT -> Routes.
     */
    if (npfMapOverlayPriorityActive) {
        applyNpfMapOverlayPriorityVisibility();
        return;
    }

    const shouldHide = !!hidden;
    if (npfHeavyOverlayPanesHidden === shouldHide) return;
    npfHeavyOverlayPanesHidden = shouldHide;
    const visibility = shouldHide ? 'hidden' : 'visible';
    ['roadOverlayCasingPane', 'roadOverlayLinePane', 'roadOverlayLabelPane', 'highVoltageLinesPane'].forEach(name => {
        try {
            const pane = map?.getPane?.(name);
            if (pane) pane.style.visibility = visibility;
        } catch (_) {}
    });
}

async function clearRoadOverlayRenderedPartsProgressively(options = {}, serialToken = null) {
    const records = [...loadedRoadOverlayParts.entries()];
    loadedRoadOverlayParts.clear();

    /* Les cartouches sont peu nombreux : les retirer d'abord évite les labels
     * orphelins pendant la libération progressive des géométries. */
    try { roadOverlayLabelsLayer?.clearLayers(); } catch (_) {}

    for (let index = 0; index < records.length; index += 1) {
        if (serialToken !== null && serialToken !== npfHeavyOverlayZoomSerialToken) return false;
        const [partKey, record] = records[index];
        try { if (record?.casing) roadOverlayCasingLayer?.removeLayer(record.casing); } catch (_) {}
        try { if (record?.lines) roadOverlayLineLayer?.removeLayer(record.lines); } catch (_) {}
        try {
            if (record) {
                record.casing = null;
                record.lines = null;
                record.geojson = null;
                record.renderGeojson = null;
            }
        } catch (_) {}
        if (options.clearSources === true) roadOverlaySourceParts.delete(partKey);

        /* Une seule partie par frame : pas de destruction de plusieurs milliers
         * de commandes Canvas dans la même tranche JavaScript sur iPadOS. */
        await yieldRoadOverlayRenderTurn();
    }

    if (options.clearSources === true && roadOverlaySourceParts.size) {
        const sourceKeys = [...roadOverlaySourceParts.keys()];
        for (let index = 0; index < sourceKeys.length; index += 8) {
            if (serialToken !== null && serialToken !== npfHeavyOverlayZoomSerialToken) return false;
            sourceKeys.slice(index, index + 8).forEach(key => roadOverlaySourceParts.delete(key));
            await yieldRoadOverlayRenderTurn();
        }
    }

    /* Les groupes doivent maintenant être quasi vides ; ce nettoyage final ne
     * concentre plus la destruction de toutes les parties dans un seul frame. */
    try { roadOverlayCasingLayer?.clearLayers(); } catch (_) {}
    try { roadOverlayLineLayer?.clearLayers(); } catch (_) {}
    try { roadOverlayCasingRenderer?._redraw?.(); } catch (_) {}
    try { roadOverlayLineRenderer?._redraw?.(); } catch (_) {}

    resetRoadOverlayRefreshState();
    if (options.resetTier !== false) roadOverlayLoadedZoomTier = -1;
    return true;
}

function clearRoadOverlayRenderedParts(options = {}) {
    loadedRoadOverlayParts.clear();

    try { roadOverlayCasingLayer?.clearLayers(); } catch (_) {}
    try { roadOverlayLineLayer?.clearLayers(); } catch (_) {}
    try { roadOverlayLabelsLayer?.clearLayers(); } catch (_) {}

    /*
     * Libérer immédiatement les géométries et les commandes Canvas. Cette
     * opération est essentielle sur iPad lorsque l'on revient à un zoom où
     * aucune route ne doit être affichée.
     */
    try { roadOverlayCasingRenderer?._redraw?.(); } catch (_) {}
    try { roadOverlayLineRenderer?._redraw?.(); } catch (_) {}

    resetRoadOverlayRefreshState();
    if (options.clearSources === true) {
        clearRoadOverlaySourceParts();
    }

    if (options.resetTier !== false) {
        roadOverlayLoadedZoomTier = -1;
    }
}

function yieldRoadOverlayRenderTurn() {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                setTimeout(resolve, 0);
            });
            return;
        }
        setTimeout(resolve, 0);
    });
}

async function getRoadOverlaySourcePart(part, token, tier, renderBounds) {
    const cached = roadOverlaySourceParts.get(part.key);

    if (roadOverlaySourceRecordCoversBounds(cached, tier, renderBounds)) {
        return cached;
    }

    const startedAt = NPF_STARTUP_DIAGNOSTIC.now();
    const coverageBounds = buildRoadOverlaySourceWorksetBounds(
        renderBounds,
        tier
    );

    let compactGeojson = null;
    let rawFeatureCount = Number(part?.featureCount || 0);
    let sourceKind = 'inconnu';

    const spatialCache = await caches.open(ROAD_OVERLAY_SPATIAL_CACHE_NAME);
    const spatialManifest = await loadRoadOverlaySpatialManifest(
        spatialCache,
        part
    );

    if (spatialManifest) {
        try {
            compactGeojson = await buildRoadOverlayGeojsonFromSpatialCache(
                spatialCache,
                part,
                spatialManifest,
                tier,
                coverageBounds,
                token
            );
            rawFeatureCount = Number(
                spatialManifest.rawFeatureCount
                || rawFeatureCount
                || 0
            );
            sourceKind = 'cellules-cache';
        } catch (error) {
            console.warn('Index spatial Routes ignoré:', part.name, error);
            try {
                await spatialCache.delete(
                    buildRoadOverlaySpatialManifestRequest(part.key)
                );
            } catch (_) {}
            compactGeojson = null;
        }
    }

    if (
        token !== roadOverlayRefreshToken
        || !showRoadOverlayLayer
        || tier !== roadOverlayLoadedZoomTier
    ) {
        return null;
    }

    if (!compactGeojson) {
        const buildState = roadOverlaySpatialBuildStates.get(part.key);

        if (buildState?.bucketReady) {
            compactGeojson = await buildRoadOverlayGeojsonFromSpatialState(
                buildState,
                tier,
                coverageBounds,
                token
            );
            rawFeatureCount = Number(
                buildState.rawFeatureCount
                || rawFeatureCount
                || 0
            );
            sourceKind = 'cellules-memoire';
        } else if (buildState?.rawGeojson) {
            compactGeojson = await buildRoadOverlayGeojsonForTierAndBounds(
                buildState.rawGeojson,
                tier,
                coverageBounds,
                token
            );
            rawFeatureCount = Number(
                buildState.rawFeatureCount
                || rawFeatureCount
                || 0
            );
            sourceKind = 'brut-memoire';
        }
    }

    if (!compactGeojson) {
        const sourceCache = await caches.open(ROAD_OVERLAY_CACHE_NAME);
        const response = await sourceCache.match(
            buildRoadOverlayCacheRequest(part.key)
        );
        if (!response || !response.ok) {
            throw new Error(`Partie routière absente : ${part.name}`);
        }

        const storedGeojson = await response.json();
        const sourceFeatures = Array.isArray(storedGeojson?.features)
            ? storedGeojson.features
            : [];
        rawFeatureCount = sourceFeatures.length;

        if (
            token !== roadOverlayRefreshToken
            || !showRoadOverlayLayer
            || tier !== roadOverlayLoadedZoomTier
        ) {
            return null;
        }

        compactGeojson = await buildRoadOverlayGeojsonForTierAndBounds(
            storedGeojson,
            tier,
            coverageBounds,
            token
        );
        if (!compactGeojson) return null;

        sourceKind = 'brut-initial';

        scheduleRoadOverlaySpatialIndexBuild(
            part,
            storedGeojson,
            rawFeatureCount
        );
    }

    if (!compactGeojson) return null;

    if (
        token !== roadOverlayRefreshToken
        || !showRoadOverlayLayer
        || tier !== roadOverlayLoadedZoomTier
    ) {
        return null;
    }

    const retainedFeatureCount = Array.isArray(compactGeojson.features)
        ? compactGeojson.features.length
        : 0;

    const spatialStats = compactGeojson.__npfSpatialStats || null;

    const record = {
        geojson: compactGeojson,
        featureCount: retainedFeatureCount,
        rawFeatureCount,
        tier,
        sourceKind,
        coverageBounds: cloneRoadOverlayBounds(coverageBounds)
    };
    roadOverlaySourceParts.set(part.key, record);

    npfDiagSiaInteraction(
        'ROUTES SOURCE',
        `partie=${part.name} · tier=${tier} · source=${sourceKind} · brut=${rawFeatureCount} · retenu=${retainedFeatureCount}`
            + (spatialStats
                ? ` · cellules=${spatialStats.cells} · ram=${spatialStats.ramHits} · storage=${spatialStats.storageReads}`
                : ''),
        {
            totalMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - startedAt),
            rawFeatures: rawFeatureCount,
            retainedFeatures: retainedFeatureCount,
            spatialCells: Number(spatialStats?.cells || 0),
            spatialRamHits: Number(spatialStats?.ramHits || 0),
            spatialStorageReads: Number(spatialStats?.storageReads || 0)
        }
    );

    return record;
}

async function loadRoadOverlayPart(part, token, tier, renderBounds) {
    const sourceRecord = await getRoadOverlaySourcePart(
        part,
        token,
        tier,
        renderBounds
    );
    if (!sourceRecord) return null;

    if (
        token !== roadOverlayRefreshToken
        || !showRoadOverlayLayer
        || tier !== roadOverlayLoadedZoomTier
    ) {
        return null;
    }

    const geojson = await buildRoadOverlayGeojsonForTierAndBounds(
        sourceRecord.geojson,
        tier,
        renderBounds,
        token
    );
    if (!geojson) return null;

    if (!geojson.features.length) {
        const emptyRecord = {
            casing: null,
            lines: null,
            geojson,
            tier,
            sourceFeatureCount: sourceRecord.featureCount,
            rawSourceFeatureCount: sourceRecord.rawFeatureCount
        };
        loadedRoadOverlayParts.set(part.key, emptyRecord);
        return emptyRecord;
    }

    const renderGeojson = buildRoadOverlayAggregatedRenderGeojson(geojson);
    const casing = L.geoJSON(renderGeojson, {
        pane: 'roadOverlayCasingPane',
        renderer: roadOverlayCasingRenderer || undefined,
        interactive: false,
        style: feature => getRoadOverlayLineStyle(feature, true)
    });
    const lines = L.geoJSON(renderGeojson, {
        pane: 'roadOverlayLinePane',
        renderer: roadOverlayLineRenderer || undefined,
        interactive: false,
        style: feature => getRoadOverlayLineStyle(feature, false)
    });

    casing.addTo(roadOverlayCasingLayer);
    lines.addTo(roadOverlayLineLayer);

    const record = {
        casing,
        lines,
        geojson,
        renderGeojson,
        tier,
        sourceFeatureCount: sourceRecord.featureCount,
        rawSourceFeatureCount: sourceRecord.rawFeatureCount,
        renderGroupCount: renderGeojson.features.length
    };
    loadedRoadOverlayParts.set(part.key, record);
    return record;
}

async function waitForRoadOverlayOfflineTiles(token) {
    return waitForNpfVisibleBaseTilesReady({
        maxWaitMs: ROAD_OVERLAY_TILE_PRIORITY_MAX_WAIT_MS,
        pollMs: 80,
        isCancelled: () => (
            token !== roadOverlayRefreshToken
            || !showRoadOverlayLayer
        )
    });
}

function rebuildRoadOverlayLabels() {
    if (!roadOverlayLabelsLayer) return;
    roadOverlayLabelsLayer.clearLayers();

    /*
     * v14.87 — préparer d'abord tous les candidats des parties visibles.
     * Le meilleur tronçon de chaque référence est retenu, puis les cartouches
     * sont triés et filtrés globalement pour éviter les amas illisibles.
     */
    const candidatesByRef = new Map();

    loadedRoadOverlayParts.forEach((record, partKey) => {
        if (
            record?.tier !== roadOverlayLoadedZoomTier
            || !record?.geojson?.features?.length
        ) {
            return;
        }

        addRoadOverlayLabelsForGeojson(
            record.geojson,
            partKey,
            candidatesByRef
        );
    });

    renderRoadOverlayLabelCandidates(candidatesByRef);
}

async function refreshRoadOverlayVisibleParts(source = 'refresh') {
    if (!showRoadOverlayLayer || !map || !roadOverlayLayer) return;

    const manifest = getRoadOverlayManifest();
    if (!manifest.parts.length) {
        refreshRoadOverlayButtonState();
        return;
    }

    const token = ++roadOverlayRefreshToken;
    const currentTier = getRoadOverlayZoomTier();
    const currentStyleBand = getRoadOverlayStyleBand();
    const forceRefresh = source !== 'map-change';
    let trafficSuspendedForRoad = false;

    /*
     * v17.08 — même règle que HT : Routes ne font absolument aucun travail
     * lourd tant que le fond NPF n'est pas entièrement prêt et au repos.
     * Le contrôle est placé AVANT les nettoyages/changements de tier afin que
     * Routes ON ne coûte rien à la fluidité d'un pan/zoom par rapport à OFF.
     */
    const heavyTileWindowReady = await waitForNpfHeavyOverlayTileWindow('Routes', {
        maxWaitMs: 30000,
        isCancelled: () => (
            token !== roadOverlayRefreshToken
            || !showRoadOverlayLayer
        )
    });
    if (!heavyTileWindowReady) {
        if (token === roadOverlayRefreshToken && showRoadOverlayLayer) {
            scheduleRoadOverlayRefresh('tile-priority-retry');
        }
        return;
    }

    const suspendTrafficForRoadWork = () => {
        if (trafficSuspendedForRoad) return;
        trafficSuspendedForRoad = true;
        suspendTrafficVisualUpdates('road-overlay-render');
    };

    isRoadOverlayLoading = true;
    refreshRoadOverlayButtonState();

    try {
        if (currentTier === 0) {
            /*
             * v16.80 — Routes reste ON : conserver les cellules et manifestes
             * déjà chauds en RAM. Le calque reste totalement inerte au tier 0,
             * mais un retour à 2/1 NM ne doit pas repartir avec ram=0.
             *
             * La construction d'index encore en cours est toujours annulée pour
             * protéger la fluidité carte seule au tier 0.
             */
            cancelRoadOverlaySpatialBuilds('routes-tier0');

            if (
                roadOverlayLoadedZoomTier !== 0
                || loadedRoadOverlayParts.size
            ) {
                suspendTrafficForRoadWork();
                if (source === 'zoom-out-serial-routes') {
                    const cleared = await clearRoadOverlayRenderedPartsProgressively(
                        { resetTier: false, clearSources: true },
                        npfHeavyOverlayZoomSerialToken
                    );
                    if (!cleared) return;
                } else {
                    clearRoadOverlayRenderedParts({ resetTier: false, clearSources: true });
                }
            } else if (roadOverlaySourceParts.size) {
                clearRoadOverlaySourceParts();
            }
            roadOverlayLoadedZoomTier = 0;
            roadOverlayLastStyleBand = currentStyleBand;
            return;
        }

        const tierChanged = roadOverlayLoadedZoomTier !== currentTier;
        if (tierChanged) {
            suspendTrafficForRoadWork();
            if (source === 'zoom-out-serial-routes') {
                const cleared = await clearRoadOverlayRenderedPartsProgressively(
                    { resetTier: false },
                    npfHeavyOverlayZoomSerialToken
                );
                if (!cleared) return;
            } else {
                clearRoadOverlayRenderedParts({ resetTier: false });
            }
            roadOverlayLoadedZoomTier = currentTier;
        }

        const currentBounds = map.getBounds();
        const partBounds = currentBounds.pad(
            currentTier === 1
                ? ROAD_OVERLAY_VIEWPORT_PAD_TIER_1
                : ROAD_OVERLAY_VIEWPORT_PAD_TIER_2
        );
        const renderBounds = currentBounds.pad(
            currentTier === 1
                ? ROAD_OVERLAY_FEATURE_PAD_TIER_1
                : ROAD_OVERLAY_FEATURE_PAD_TIER_2
        );

        const visibleParts = manifest.parts.filter(part => (
            roadOverlayBboxIntersectsBounds(part.bbox, partBounds)
        ));
        const visibleKeys = new Set(visibleParts.map(part => part.key));
        const visibleSignature = getRoadOverlayPartSignature(
            visibleParts,
            currentTier
        );

        const sourceCoverageStillValid = visibleParts.every(part => {
            const cachedSource = roadOverlaySourceParts.get(part.key);
            return roadOverlaySourceRecordCoversBounds(
                cachedSource,
                currentTier,
                renderBounds
            );
        });

        const coverageStillValid = (
            !tierChanged
            && roadOverlayRenderedPartSignature === visibleSignature
            && roadOverlayBoundsContainBounds(roadOverlayRenderedBounds, currentBounds)
            && sourceCoverageStillValid
        );
        const featureSelectionChanged = forceRefresh || !coverageStillValid;
        const styleChanged = currentStyleBand !== roadOverlayLastStyleBand;
        const labelsNeedRefresh = shouldRefreshRoadOverlayLabelsForView({
            force: forceRefresh || featureSelectionChanged || styleChanged
        });

        if (
            !featureSelectionChanged
            && !styleChanged
            && !labelsNeedRefresh
        ) {
            return;
        }

        if (featureSelectionChanged) {
            /*
             * v17.08 — recontrôle juste avant la reconstruction effective.
             * Si de nouvelles lectures tuiles ont commencé depuis la fenêtre
             * calme initiale, Routes cèdent immédiatement la priorité.
             */
            const tilesReady = await waitForRoadOverlayOfflineTiles(token);
            if (!tilesReady) {
                if (token === roadOverlayRefreshToken && showRoadOverlayLayer) {
                    scheduleRoadOverlayRefresh('tile-priority-retry');
                }
                return;
            }
            if (
                token !== roadOverlayRefreshToken
                || !showRoadOverlayLayer
                || currentTier !== roadOverlayLoadedZoomTier
            ) {
                return;
            }

            suspendTrafficForRoadWork();
            clearRoadOverlayRenderedParts({ resetTier: false });
            roadOverlayLoadedZoomTier = currentTier;
            pruneRoadOverlaySourceParts(visibleKeys);

            /*
             * v16.77 — une partie peut rester géographiquement "visible" dans
             * le manifeste alors que son working-set compact ne couvre plus la
             * nouvelle vue. La supprimer ici force une recharge compacte.
             */
            visibleParts.forEach(part => {
                const cachedSource = roadOverlaySourceParts.get(part.key);
                if (
                    cachedSource
                    && !roadOverlaySourceRecordCoversBounds(
                        cachedSource,
                        currentTier,
                        renderBounds
                    )
                ) {
                    roadOverlaySourceParts.delete(part.key);
                }
            });

            for (const part of visibleParts) {
                if (
                    token !== roadOverlayRefreshToken
                    || !showRoadOverlayLayer
                    || currentTier !== roadOverlayLoadedZoomTier
                ) {
                    return;
                }

                try {
                    await loadRoadOverlayPart(
                        part,
                        token,
                        currentTier,
                        renderBounds
                    );
                } catch (error) {
                    console.warn(
                        'Partie du calque routier ignorée:',
                        part.name,
                        error
                    );
                }

                await yieldRoadOverlayRenderTurn();
            }

            roadOverlayLastVisiblePartSignature = visibleSignature;
            roadOverlayRenderedPartSignature = visibleSignature;
            roadOverlayRenderedBounds = cloneRoadOverlayBounds(renderBounds);

            /* v16.62 — avec HT actif le cache brut Routes n'est qu'un cache de
             * confort. Au-delà de 12 000 tronçons, le libérer après le rendu
             * filtré évite un pic mémoire WebKit ; les parties restent
             * rechargeables depuis Cache Storage au prochain viewport. */
            if (showHighVoltageLinesLayer) {
                releaseRoadOverlaySourceCacheIfHeavy('apres-rendu-routes-ht');
            }
        }

        if (
            token !== roadOverlayRefreshToken
            || !showRoadOverlayLayer
            || currentTier !== roadOverlayLoadedZoomTier
        ) {
            return;
        }

        if (!featureSelectionChanged && styleChanged) {
            loadedRoadOverlayParts.forEach(record => {
                if (record?.tier !== currentTier) return;

                try {
                    record.casing?.setStyle(
                        feature => getRoadOverlayLineStyle(feature, true)
                    );
                    record.lines?.setStyle(
                        feature => getRoadOverlayLineStyle(feature, false)
                    );
                } catch (_) {}
            });

            try { roadOverlayCasingRenderer?._redraw?.(); } catch (_) {}
            try { roadOverlayLineRenderer?._redraw?.(); } catch (_) {}
        }

        roadOverlayLastStyleBand = currentStyleBand;

        if (labelsNeedRefresh || featureSelectionChanged) {
            rebuildRoadOverlayLabels();
            rememberRoadOverlayLabelView();
        }

        if (featureSelectionChanged) {
            recordNpfStartupDiagnosticOverlaySnapshot(
                `routes viewport · ${source}`
            );
        }
    } finally {
        if (token === roadOverlayRefreshToken) {
            isRoadOverlayLoading = false;
            refreshRoadOverlayButtonState();
        }

        if (trafficSuspendedForRoad) {
            resumeTrafficVisualUpdates('road-overlay-render', {
                redraw: true,
                reason: source
            });
        }
    }
}

function scheduleRoadOverlayRefresh(source = 'scheduled') {
    clearTimeout(roadOverlayRefreshTimer);
    roadOverlayRefreshTimer = setTimeout(() => {
        roadOverlayRefreshTimer = null;
        refreshRoadOverlayVisibleParts(source).catch(error => {
            console.warn(
                'Actualisation du calque routier impossible:',
                source,
                error
            );
        });
    }, source === 'map-change' ? ROAD_OVERLAY_MAP_CHANGE_DELAY_MS : 220);
}

async function toggleRoadOverlayLayer(forceState = null, options = {}) {
    const shouldShow = forceState === null
        ? !showRoadOverlayLayer
        : Boolean(forceState);
    const manifest = getRoadOverlayManifest();

    if (shouldShow && !manifest.parts.length) {
        showRoadOverlayLayer = false;
        localStorage.setItem(ROAD_OVERLAY_LAYER_KEY, 'false');
        refreshRoadOverlayButtonState();
        recordNpfStartupDiagnosticOverlaySnapshot(`routes OFF · ${options.source || 'toggle'} · pack absent`);

        if (!options.silent) {
            const modal = document.getElementById('offline-map-modal');
            if (modal) {
                modal.style.display = 'flex';
                refreshRoadOverlayInstalledStatus();
            }
            alert('Aucun calque routier n’est installé. Importe le pack A / N / D / M / T dans Gestion des Cartes.');
        }
        return;
    }

    showRoadOverlayLayer = shouldShow;
    localStorage.setItem(ROAD_OVERLAY_LAYER_KEY, String(showRoadOverlayLayer));
    refreshRoadOverlayButtonState();

    if (showRoadOverlayLayer) {
        const roadTier = getRoadOverlayZoomTier();

        if (roadTier === 0) {
            /*
             * v16.76 — activer le bouton Routes à 5 NM ou plus loin ne lance
             * aucune attente de tuiles et aucun rendu. L'état reste mémorisé :
             * les routes apparaîtront automatiquement en entrant dans tier 1/2.
             */
            roadOverlayRefreshToken += 1;
            clearTimeout(roadOverlayRefreshTimer);
            roadOverlayRefreshTimer = null;
            isRoadOverlayLoading = false;
            roadOverlayLoadedZoomTier = 0;

            try {
                if (roadOverlayLayer && map.hasLayer(roadOverlayLayer)) {
                    map.removeLayer(roadOverlayLayer);
                }
            } catch (_) {}

            if (loadedRoadOverlayParts.size || roadOverlaySourceParts.size) {
                const cleanupToken = npfHeavyOverlayZoomSerialToken;
                await clearRoadOverlayRenderedPartsProgressively(
                    { resetTier: false, clearSources: true },
                    cleanupToken
                );
            }

            npfDiagSiaInteraction(
                'FILTRE CARTE',
                'couche=Routes · tier0-inerte',
                {
                    zoom: Number(map?.getZoom?.() ?? 0),
                    routesSource: getNpfRoadSourceFeatureCount(),
                    routesRendered: getNpfRenderedRoadFeatureCount(),
                    tilesVisible: countVisibleLoadedBaseTiles()
                }
            );
        } else {
            if (
                roadOverlayLayer
                && !npfMapOverlayPriorityActive
                && !map.hasLayer(roadOverlayLayer)
            ) {
                roadOverlayLayer.addTo(map);
            }

            const ready = await waitForNpfLayerActivationTileWindow('Routes', {
                maxWaitMs: 12000,
                isCancelled: () => !showRoadOverlayLayer || getRoadOverlayZoomTier() === 0
            });
            if (!ready || !showRoadOverlayLayer || getRoadOverlayZoomTier() === 0) {
                if (showRoadOverlayLayer && getRoadOverlayZoomTier() > 0) {
                    scheduleRoadOverlayRefresh('tile-priority-retry');
                }
                recordNpfStartupDiagnosticOverlaySnapshot(`routes ON · ${options.source || 'toggle'} · attente tuiles`);
                return;
            }

            const renderStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
            await refreshRoadOverlayVisibleParts(options.source || 'toggle');
            npfDiagSiaInteraction('FILTRE CARTE', 'couche=Routes · rendu-prêt', {
                layerMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - renderStartedAt),
                routesSource: getNpfRoadSourceFeatureCount(),
                routesRendered: getNpfRenderedRoadFeatureCount(),
                tilesVisible: countVisibleLoadedBaseTiles(),
                npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
                npfReadsActive: Number(directOfflineNpfActiveReads || 0)
            });
        }
    } else {
        /*
         * v16.76 — retour immédiat au comportement "carte seule".
         * On invalide toute attente TUILES ZOOM FINAL encore en cours,
         * retire le parent Routes, rend les panes, puis libère les géométries
         * progressivement afin de ne pas concentrer le nettoyage sur un frame.
         */
        roadOverlayRefreshToken += 1;
        clearTimeout(roadOverlayRefreshTimer);
        roadOverlayRefreshTimer = null;
        isRoadOverlayLoading = false;

        cancelNpfHeavyOverlayWaitsForRoadStateChange('routes-off');
        cancelRoadOverlaySpatialBuilds('routes-off');
        clearRoadOverlaySpatialRamCaches();

        if (roadOverlayLayer && map.hasLayer(roadOverlayLayer)) {
            map.removeLayer(roadOverlayLayer);
        }

        try { beginBaseMapZoomStabilityGuard('routes-off'); } catch (_) {}
        try { pruneDirectOfflineNpfQueueForCurrentView('routes-off'); } catch (_) {}
        try { trimDirectOfflineTileBlobCache(); } catch (_) {}

        const cleanupToken = npfHeavyOverlayZoomSerialToken;
        await clearRoadOverlayRenderedPartsProgressively(
            { clearSources: true },
            cleanupToken
        );
    }

    refreshRoadOverlayButtonState();
    recordNpfStartupDiagnosticOverlaySnapshot(`routes ${showRoadOverlayLayer ? 'ON' : 'OFF'} · ${options.source || 'toggle'}`);
}



