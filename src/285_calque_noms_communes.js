/*
 * v17.79 — calque « Noms des communes » (tuiles raster transparentes) ; essai de fluidité VALIDÉ sur iPad.
 * v17.80 — le calque fait partie de la carte NPF-Q400 V11 (fond sans noms + noms), téléchargés ensemble par
 * « Télécharger la carte NPF-Q400 » (src/280) ; la section d'essai « noms-essai » est supprimée.
 *
 * - Base IndexedDB SÉPARÉE « CalqueNomsCommunes » (sans « NPF » ni préfixe « OfflineMap_ ») : jamais listée
 *   comme carte, jamais un fond ; remplacée (effacée puis réécrite) à chaque téléchargement de la carte, et
 *   supprimée avec la carte NPF-Q400 dans Gestion des Cartes.
 * - Affiché SEULEMENT si la carte affichée est une carte NPF-Q400 « avec calque des noms » (V11) : avec la V10 ou
 *   une carte importée par ZIP (noms déjà imprimés dans la carte), rien n'est créé (pas de noms en double).
 * - Tuile de noms absente (tuile sans aucun nom, non fournie par le serveur) = transparente : lecture locale sans
 *   résultat, aucune image, AUCUNE requête réseau.
 * - Pane « calqueNomsCommunesPane » (z 420) : au-dessus des routes (405-415), sous les zones SIA (440) ; tuiles
 *   transparentes (style.css). Zooms 8 et plus (images jusqu'au zoom 13, agrandies au-delà).
 * - Lecteur PROPRE, distinct du moteur du fond (aucun réglage du fond modifié) : 2 lectures au plus, chaque
 *   lecture attend que la file du fond soit vide (1,5 s au plus).
 * - v17.80 : la base est ouverte AVANT la première lecture et son ouverture est mesurée à part (DIAG du 15/10
 *   17:59 : une lecture de 2 007 ms, la seule au-delà de 154 ms, pendant un blocage du fil principal de 1,35 s
 *   peu après l'installation ; la durée d'une lecture compte aussi l'attente du fil principal). Les lectures
 *   de plus de 500 ms sont listées au DIAG avec leur heure.
 * - v17.87 : plus de case « Afficher les noms des communes » : le calque est toujours affiché sur une carte V11.
 */
const NPF_CALQUE_NOMS_DB_NAME = 'CalqueNomsCommunes';
const NPF_CALQUE_NOMS_PACK = 'Calque_Noms_Communes';
const NPF_CALQUE_NOMS_INFO_KEY = 'npfCalqueNomsCommunesV1';
/* v17.87 — anciennes clés effacées une fois au démarrage : réglage de la case supprimée (v17.80) et restes de
 * l'essai « noms-essai » v17.79 (case, téléchargement et journal de la section d'essai). La clé du calque V11
 * (NPF_CALQUE_NOMS_INFO_KEY) et la base CalqueNomsCommunes ne sont pas touchées. */
const NPF_CALQUE_NOMS_OLD_KEYS = [
    'npfCalqueNomsCommunesAfficheV2',
    'npfCalqueNomsCommunesAfficheV1',
    'npfServerSectionDownloadV1:noms-essai',
    'npfServerSectionLogV1:noms-essai'
];
const NPF_SERVER_MAP_LATEST_KEY = 'npfServerMapLatestV1';
const NPF_CALQUE_NOMS_PANE = 'calqueNomsCommunesPane';
const NPF_CALQUE_NOMS_MIN_ZOOM = 8;
const NPF_CALQUE_NOMS_NATIVE_MAX_ZOOM = 13;
const NPF_CALQUE_NOMS_MAX_READS = 2;
const NPF_CALQUE_NOMS_WAIT_FOND_MAX_MS = 1500;
const NPF_CALQUE_NOMS_SLOW_READ_MS = 500;

let npfCalqueNomsLayer = null;
let npfCalqueNomsDbPromise = null;
let npfCalqueNomsActiveReads = 0;
let npfCalqueNomsSyncTimer = null;
let npfCalqueNomsMapListener = false;
const npfCalqueNomsQueue = [];
const npfCalqueNomsStats = {
    lectures: 0, trouvees: 0, vides: 0, erreurs: 0, annulees: 0,
    totalMs: 0, maxMs: 0, durees: [], attenteFondMs: 0, maxAttenteFondMs: 0,
    tuilesMax: 0, periodes: [], memoire: [], ouvertures: [], lentes: []
};

function readNpfCalqueNomsInfo() {
    try {
        const info = JSON.parse(localStorage.getItem(NPF_CALQUE_NOMS_INFO_KEY) || 'null');
        return info && typeof info === 'object' && info.installed ? info : null;
    } catch (_) {
        return null;
    }
}

function removeNpfCalqueNomsOldKeys() {
    NPF_CALQUE_NOMS_OLD_KEYS.forEach(key => {
        try { localStorage.removeItem(key); } catch (_) {}
    });
}

/* Carte NPF-Q400 installée (groupe NPF_France) : version, taille, avec ou sans calque des noms. */
function getNpfInstalledMapDescription() {
    const packs = getInstalledMapPacksSafe().filter(pack => pack && isNpfOfflinePackSelection([pack.name]));
    if (!packs.length) return null;
    const avecNoms = packs.every(pack => pack.calqueNoms === true);
    const version = packs.map(pack => pack.versionCarte).find(Boolean) || '';
    const origine = packs.some(pack => pack.origin === 'serveur') ? 'serveur' : 'import';
    const sizeBytes = packs.reduce((total, pack) => total + (Number(pack.sizeBytes) > 0 ? Number(pack.sizeBytes) : 0), 0);
    return { packs, avecNoms, version, origine, sizeBytes };
}

/* Le calque n'est affiché que sur une carte NPF-Q400 « avec calque des noms » (V11), hors ligne, entièrement active. */
function isNpfCarteAvecNomsActive() {
    try {
        if (!offlineTilesMode || !Array.isArray(activeOfflinePacks) || !activeOfflinePacks.length) return false;
        const installed = getInstalledMapPacksSafe();
        return activeOfflinePacks.every(name => {
            const pack = installed.find(item => item && item.name === name);
            return !!pack && pack.calqueNoms === true && isNpfOfflinePackSelection([name]);
        });
    } catch (_) {
        return false;
    }
}

function openNpfCalqueNomsDb() {
    if (!npfCalqueNomsDbPromise) {
        const startedAt = performance.now();
        npfCalqueNomsDbPromise = openOfflineTileDatabaseByName(NPF_CALQUE_NOMS_DB_NAME, 3).then(db => {
            npfCalqueNomsStats.ouvertures.push({ t: Date.now(), ms: Math.round(performance.now() - startedAt) });
            while (npfCalqueNomsStats.ouvertures.length > 20) npfCalqueNomsStats.ouvertures.shift();
            db.onversionchange = () => {
                try { db.close(); } catch (_) {}
                npfCalqueNomsDbPromise = null;
            };
            return db;
        }).catch(error => {
            npfCalqueNomsDbPromise = null;
            throw error;
        });
    }
    return npfCalqueNomsDbPromise;
}

function closeNpfCalqueNomsDb() {
    const pending = npfCalqueNomsDbPromise;
    npfCalqueNomsDbPromise = null;
    if (pending) pending.then(db => { try { db.close(); } catch (_) {} }).catch(() => {});
}

/* Le fond passe d'abord : on attend que sa file de lectures soit vide (1,5 s au plus). */
async function waitNpfCalqueNomsFondIdle() {
    const startedAt = performance.now();
    for (;;) {
        let busy = false;
        try {
            busy = Number(directOfflineNpfActiveReads || 0) > 0 || (Array.isArray(directOfflineNpfReadQueue) && directOfflineNpfReadQueue.length > 0);
        } catch (_) {
            busy = false;
        }
        const waited = performance.now() - startedAt;
        if (!busy || waited >= NPF_CALQUE_NOMS_WAIT_FOND_MAX_MS) return waited;
        await new Promise(resolve => setTimeout(resolve, 40));
    }
}

/* Lecture d'une tuile de noms (base déjà ouverte) : données, ou null si la tuile n'existe pas (= transparente). */
function readNpfCalqueNomsTileFromDb(db, coords) {
    const tileUrl = buildOfflineTileUrlForPack(`${coords.z}/${coords.x}/${coords.y}.png`, NPF_CALQUE_NOMS_PACK);
    const key = buildStoredTileKey(tileUrl, NPF_CALQUE_NOMS_PACK);
    return new Promise((resolve, reject) => {
        let request;
        try {
            request = db.transaction('tiles', 'readonly').objectStore('tiles').get(key);
        } catch (error) {
            reject(error);
            return;
        }
        request.onsuccess = () => resolve(request.result ? request.result.tile : null);
        request.onerror = () => reject(request.error || new Error('lecture impossible'));
    });
}

function pumpNpfCalqueNomsQueue() {
    while (npfCalqueNomsActiveReads < NPF_CALQUE_NOMS_MAX_READS && npfCalqueNomsQueue.length) {
        const job = npfCalqueNomsQueue.shift();
        if (job.cancelled) {
            npfCalqueNomsStats.annulees += 1;
            continue;
        }
        npfCalqueNomsActiveReads += 1;
        runNpfCalqueNomsJob(job).finally(() => {
            npfCalqueNomsActiveReads -= 1;
            pumpNpfCalqueNomsQueue();
        });
    }
}

/*
 * v17.85 — tuile de noms ABSENTE (aucun nom : la V11 ne contient pas les tuiles vides), annulée ou illisible :
 * l'élément <img> restait affiché SANS image. Les navigateurs dessinent alors un fin cadre gris autour d'une image
 * vide (vu sur iPad et reproduit sous Chrome) : tuiles côte à côte = quadrillage gris sur la carte. La tuile vide
 * est rendue invisible (visibility, plus forte que la classe leaflet-tile-loaded de Leaflet).
 */
function finishNpfCalqueNomsEmptyTile(job) {
    try { job.tile.style.visibility = 'hidden'; } catch (_) {}
    job.done(null, job.tile);
}

async function runNpfCalqueNomsJob(job) {
    const waited = await waitNpfCalqueNomsFondIdle();
    npfCalqueNomsStats.attenteFondMs += waited;
    if (waited > npfCalqueNomsStats.maxAttenteFondMs) npfCalqueNomsStats.maxAttenteFondMs = Math.round(waited);
    if (job.cancelled) {
        npfCalqueNomsStats.annulees += 1;
        finishNpfCalqueNomsEmptyTile(job);
        return;
    }
    let data = null;
    let ms = 0;
    try {
        /* v17.80 — ouverture de la base hors de la mesure de la lecture. */
        const db = await openNpfCalqueNomsDb();
        if (job.cancelled) {
            npfCalqueNomsStats.annulees += 1;
            finishNpfCalqueNomsEmptyTile(job);
            return;
        }
        const startedAt = performance.now();
        data = await readNpfCalqueNomsTileFromDb(db, job.coords);
        ms = performance.now() - startedAt;
    } catch (error) {
        npfCalqueNomsStats.erreurs += 1;
        finishNpfCalqueNomsEmptyTile(job);
        return;
    }
    npfCalqueNomsStats.lectures += 1;
    npfCalqueNomsStats.totalMs += ms;
    if (ms > npfCalqueNomsStats.maxMs) npfCalqueNomsStats.maxMs = Math.round(ms);
    npfCalqueNomsStats.durees.push({ t: Date.now(), ms: Math.round(ms * 10) / 10 });
    if (npfCalqueNomsStats.durees.length > 400) npfCalqueNomsStats.durees.shift();
    if (ms > NPF_CALQUE_NOMS_SLOW_READ_MS) {
        npfCalqueNomsStats.lentes.push({ t: Date.now(), ms: Math.round(ms), z: job.coords.z, enAttente: npfCalqueNomsQueue.length, actives: npfCalqueNomsActiveReads });
        while (npfCalqueNomsStats.lentes.length > 20) npfCalqueNomsStats.lentes.shift();
    }
    if (!data || job.cancelled) {
        if (!data) npfCalqueNomsStats.vides += 1;
        finishNpfCalqueNomsEmptyTile(job);
        return;
    }
    npfCalqueNomsStats.trouvees += 1;
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'image/png' }));
    job.tile.onload = () => { URL.revokeObjectURL(url); job.done(null, job.tile); };
    job.tile.onerror = () => { URL.revokeObjectURL(url); finishNpfCalqueNomsEmptyTile(job); };
    job.tile.src = url;
}

function buildNpfCalqueNomsLayer(info) {
    const NpfCalqueNomsGridLayer = L.GridLayer.extend({
        createTile(coords, done) {
            const tile = document.createElement('img');
            tile.alt = '';
            tile.setAttribute('role', 'presentation');
            const job = { coords: { z: coords.z, x: coords.x, y: coords.y }, tile, done, cancelled: false };
            tile.__npfCalqueNomsJob = job;
            npfCalqueNomsQueue.push(job);
            pumpNpfCalqueNomsQueue();
            return tile;
        }
    });
    const options = {
        pane: NPF_CALQUE_NOMS_PANE,
        className: 'calque-noms-communes-tuiles',
        tileSize: 256,
        minZoom: NPF_CALQUE_NOMS_MIN_ZOOM,
        maxNativeZoom: NPF_CALQUE_NOMS_NATIVE_MAX_ZOOM,
        maxZoom: GLOBAL_MAX_ZOOM,
        keepBuffer: 1,
        updateWhenZooming: false,
        updateWhenIdle: true,
        noWrap: true
    };
    if (info && Array.isArray(info.bounds) && info.bounds.length === 4) {
        options.bounds = L.latLngBounds([info.bounds[1], info.bounds[0]], [info.bounds[3], info.bounds[2]]);
    }
    const layer = new NpfCalqueNomsGridLayer(options);
    layer.__npfCalqueNoms = true;
    layer.on('tileunload', event => {
        const job = event && event.tile && event.tile.__npfCalqueNomsJob;
        if (job) job.cancelled = true;
    });
    layer.on('load', () => {
        const count = Object.keys(layer._tiles || {}).length;
        if (count > npfCalqueNomsStats.tuilesMax) npfCalqueNomsStats.tuilesMax = count;
    });
    return layer;
}

function ensureNpfCalqueNomsPane() {
    if (!map || !map.createPane) return null;
    let pane = map.getPane(NPF_CALQUE_NOMS_PANE);
    if (!pane) {
        pane = map.createPane(NPF_CALQUE_NOMS_PANE);
        pane.style.zIndex = '420';
        pane.style.pointerEvents = 'none';
        pane.classList.add('calque-noms-communes-pane');
    }
    return pane;
}

function noteNpfCalqueNomsPeriod(shown) {
    const periods = npfCalqueNomsStats.periodes;
    const last = periods[periods.length - 1];
    if (last && last.shown === shown && !last.end) return;
    if (last && !last.end) last.end = Date.now();
    periods.push({ shown, start: Date.now(), end: 0 });
    while (periods.length > 40) periods.shift();
}

function sampleNpfCalqueNomsMemory(reason) {
    const tiles = npfCalqueNomsLayer ? Object.keys(npfCalqueNomsLayer._tiles || {}).length : 0;
    let heapMb = null;
    try {
        if (performance.memory && performance.memory.usedJSHeapSize) heapMb = Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10;
    } catch (_) {}
    npfCalqueNomsStats.memoire.push({ t: Date.now(), reason, tiles, imagesMb: Math.round(tiles * 0.25 * 10) / 10, heapMb });
    while (npfCalqueNomsStats.memoire.length > 60) npfCalqueNomsStats.memoire.shift();
}

/* Affiche ou retire le calque selon : installé et carte NPF-Q400 avec calque des noms affichée (v17.87 : plus de case). */
function syncNpfCalqueNomsLayer(reason = 'sync') {
    if (!map || typeof L === 'undefined') return;
    const info = readNpfCalqueNomsInfo();
    const wanted = !!info && isNpfCarteAvecNomsActive();
    if (!info) {
        if (npfCalqueNomsLayer) {
            try { map.removeLayer(npfCalqueNomsLayer); } catch (_) {}
            npfCalqueNomsLayer = null;
        }
        refreshNpfCalqueNomsUi();
        return;
    }
    if (!npfCalqueNomsMapListener) {
        npfCalqueNomsMapListener = true;
        map.on('layeradd layerremove', event => {
            if (event && event.layer instanceof L.GridLayer && !event.layer.__npfCalqueNoms) scheduleNpfCalqueNomsSync('changement-de-fond');
        });
    }
    if (wanted && !npfCalqueNomsLayer) {
        ensureNpfCalqueNomsPane();
        /* v17.80 — base ouverte d'avance : la première lecture ne paie pas l'ouverture. */
        openNpfCalqueNomsDb().catch(() => {});
        npfCalqueNomsLayer = buildNpfCalqueNomsLayer(info);
        npfCalqueNomsLayer.addTo(map);
        noteNpfCalqueNomsPeriod(true);
        sampleNpfCalqueNomsMemory(`affiché (${reason})`);
    } else if (!wanted && npfCalqueNomsLayer) {
        sampleNpfCalqueNomsMemory(`avant masquage (${reason})`);
        try { map.removeLayer(npfCalqueNomsLayer); } catch (_) {}
        npfCalqueNomsLayer = null;
        npfCalqueNomsQueue.forEach(job => { job.cancelled = true; });
        noteNpfCalqueNomsPeriod(false);
        setTimeout(() => sampleNpfCalqueNomsMemory(`masqué (${reason})`), 1500);
    } else if (!wanted && !npfCalqueNomsLayer) {
        noteNpfCalqueNomsPeriod(false);
    }
    refreshNpfCalqueNomsUi();
}

function scheduleNpfCalqueNomsSync(reason) {
    clearTimeout(npfCalqueNomsSyncTimer);
    npfCalqueNomsSyncTimer = setTimeout(() => syncNpfCalqueNomsLayer(reason), 300);
}

/* Téléchargement de la carte (src/280) : avant d'effacer l'ancien calque des noms. */
function prepareNpfCalqueNomsDownload() {
    try { localStorage.removeItem(NPF_CALQUE_NOMS_INFO_KEY); } catch (_) {}
    /* v17.88 — carte effacée (téléchargement complet, suppression, réinitialisation) : liste des morceaux oubliée. */
    try { localStorage.removeItem('npfCarteV11MorceauxV1'); localStorage.removeItem('npfCarteV11MajV1'); } catch (_) {}
    try { if (typeof npfCarteMajPlan !== 'undefined') npfCarteMajPlan = null; } catch (_) {}
    if (npfCalqueNomsLayer) {
        try { map.removeLayer(npfCalqueNomsLayer); } catch (_) {}
        npfCalqueNomsLayer = null;
    }
    npfCalqueNomsQueue.forEach(job => { job.cancelled = true; });
    closeNpfCalqueNomsDb();
    refreshNpfCalqueNomsUi();
}

/* Téléchargement de la carte terminé et vérifié (src/280) : calque des noms installé (la page est ensuite rechargée). */
function recordNpfCalqueNomsInstalled(manifest, count) {
    const info = {
        installed: true, tuiles: count, octets: Number(manifest.octetsNoms) || 0,
        version: manifest.versionCarte || '', creeLe: manifest.creeLe || '', installeLe: Date.now(),
        bounds: Array.isArray(manifest.emprise) && manifest.emprise.length === 4 ? manifest.emprise : null
    };
    localStorage.setItem(NPF_CALQUE_NOMS_INFO_KEY, JSON.stringify(info));
    return info;
}

/* Carte NPF-Q400 supprimée dans Gestion des Cartes (src/280) : son calque des noms aussi. */
async function deleteNpfCalqueNomsWithMap() {
    prepareNpfCalqueNomsDownload();
    if (await doesNpfIndexedDatabaseExist(NPF_CALQUE_NOMS_DB_NAME) !== false) {
        await deleteIndexedDatabaseWithTimeoutForNpf(NPF_CALQUE_NOMS_DB_NAME, 15000);
    }
    syncNpfCalqueNomsLayer('carte supprimée');
}

function refreshNpfCalqueNomsUi() {
    try { refreshNpfMapInstalledStatus(); } catch (_) {}
}

/* Gestion des Cartes : « Carte NPF-Q400 — V11, 1,5 Go » et « Nouvelle carte disponible : V11 ».
 * checkServer : lecture du manifeste du serveur (à l'ouverture de Gestion des Cartes, si le réseau répond). */
async function refreshNpfMapInstalledStatus({ checkServer = false } = {}) {
    const box = document.getElementById('npf-map-installed-status');
    if (!box) return;
    if (checkServer && typeof NPF_SERVER_MAPS !== 'undefined' && NPF_SERVER_MAPS['npf-q400'] && !npfServerMapDownloadRunning) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);
            const response = await fetch(`${NPF_SERVER_MAPS['npf-q400'].manifestUrl}?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) {
                const manifest = await response.json();
                if (manifest && manifest.versionCarte) {
                    /* v17.88 — empreintes des morceaux gardées (DIAG : morceaux à jour / à mettre à jour). */
                    writeNpfJsonStorage(NPF_SERVER_MAP_LATEST_KEY, {
                        versionCarte: manifest.versionCarte, totalOctets: Number(manifest.totalOctets) || 0, creeLe: manifest.creeLe || '', at: Date.now(),
                        morceaux: Array.isArray(manifest.morceaux) ? manifest.morceaux.map(chunk => ({ fichier: chunk && chunk.fichier, sha256: chunk && chunk.sha256 })) : null
                    });
                    try { if (typeof onNpfCarteManifestRead === 'function') onNpfCarteManifestRead(manifest); } catch (_) {}
                }
            }
        } catch (_) {}
    }
    const carte = getNpfInstalledMapDescription();
    const latest = readNpfJsonStorage(NPF_SERVER_MAP_LATEST_KEY, null);
    const lignes = [];
    if (!carte) {
        lignes.push('Carte NPF-Q400 installée : aucune.');
    } else {
        const version = carte.version || (carte.origine === 'import' ? 'import manuel (ZIP)' : 'version inconnue');
        const taille = carte.sizeBytes > 0 ? `, ${formatNpfStorageSizeForUser(carte.sizeBytes)}` : '';
        lignes.push(`Carte NPF-Q400 — ${version}${taille}${carte.avecNoms ? '' : ' (noms des communes imprimés dans la carte)'}.`);
    }
    let nouvelle = '';
    if (latest && latest.versionCarte && (!carte || carte.version !== latest.versionCarte)) {
        nouvelle = `${carte ? 'Nouvelle carte disponible' : 'Carte disponible'} : ${latest.versionCarte}${latest.totalOctets > 0 ? `, ${formatNpfStorageSizeForUser(latest.totalOctets)}` : ''}.`;
    } else if (carte && typeof npfCarteMajPlan !== 'undefined' && npfCarteMajPlan) {
        /* v17.88 — même version (V11) mais morceaux changés sur le serveur. */
        if (npfCarteMajPlan.etat === 'maj') {
            nouvelle = `Mise à jour disponible : ${npfCarteMajPlan.indices.length} morceau${npfCarteMajPlan.indices.length > 1 ? 'x' : ''}, ${formatNpfStorageSizeForUser(npfCarteMajPlan.octets)} (bouton ci-dessus).`;
        } else if (npfCarteMajPlan.etat === 'complet' && latest && latest.creeLe && carte.packs.some(pack => pack.serverCreeLe && pack.serverCreeLe !== latest.creeLe)) {
            nouvelle = `Nouvelle version de la carte disponible (${npfCarteMajPlan.raison}) : téléchargement complet${latest.totalOctets > 0 ? `, ${formatNpfStorageSizeForUser(latest.totalOctets)}` : ''}.`;
        }
    }
    box.innerHTML = '';
    lignes.forEach(texte => {
        const div = document.createElement('div');
        div.textContent = texte;
        box.appendChild(div);
    });
    if (nouvelle) {
        const div = document.createElement('div');
        div.className = 'npf-map-new-available';
        div.textContent = nouvelle;
        box.appendChild(div);
    }
}

function initNpfCalqueNomsCommunes() {
    removeNpfCalqueNomsOldKeys();
    refreshNpfCalqueNomsUi();
    if (!readNpfCalqueNomsInfo()) return;
    /* Calque installé : ajouté une fois la carte prête (fond déjà en place). */
    let tries = 0;
    const attempt = () => {
        tries += 1;
        if (typeof map !== 'undefined' && map && map.getPane && map.getPane('roadOverlayLabelPane')) {
            syncNpfCalqueNomsLayer('démarrage');
            return;
        }
        if (tries < 240) setTimeout(attempt, 500);
    };
    setTimeout(attempt, 1500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNpfCalqueNomsCommunes, { once: true });
} else {
    initNpfCalqueNomsCommunes();
}

/* DIAG (export) : carte installée, lectures du calque, ouverture de la base, lectures lentes, mémoire,
 * périodes affiché / masqué et lectures du fond pendant ces périodes. */
function appendNpfCalqueNomsDiagLines(lines) {
    const info = readNpfCalqueNomsInfo();
    const carte = getNpfInstalledMapDescription();
    lines.push('');
    lines.push('CALQUE NOMS DES COMMUNES (v17.80)');
    lines.push('Carte NPF-Q400 installée : ' + (carte
        ? (carte.version || carte.origine) + ' · ' + (carte.avecNoms ? 'avec calque des noms' : 'noms imprimés dans la carte (calque non affiché)') + ' · ' + formatNpfStorageSizeForUser(carte.sizeBytes)
        : 'aucune') + ' | carte avec noms affichée : ' + (isNpfCarteAvecNomsActive() ? 'oui' : 'non'));
    /* v17.88 — morceaux V11 installés / à jour / à mettre à jour. */
    try { if (typeof describeNpfCarteMorceauxForDiag === 'function') lines.push(describeNpfCarteMorceauxForDiag()); } catch (_) {}
    if (!info) {
        lines.push('Calque non installé : aucune couche, aucune lecture.');
        return;
    }
    const s = npfCalqueNomsStats;
    const sorted = s.durees.map(item => item.ms).sort((a, b) => a - b);
    const pct = p => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
    lines.push('Installé : ' + info.tuiles + ' tuiles, version ' + info.version + ', base ' + NPF_CALQUE_NOMS_DB_NAME
        + ' | toujours affiché sur V11 | couche ' + (npfCalqueNomsLayer ? 'présente' : 'absente'));
    lines.push('Lectures : ' + s.lectures + ' (' + s.trouvees + ' images, ' + s.vides + ' sans nom) | erreurs ' + s.erreurs + ' | annulées ' + s.annulees
        + ' | moyenne ' + (s.lectures ? (s.totalMs / s.lectures).toFixed(1) : '—') + ' ms | médiane ' + pct(0.5) + ' ms | 95 % ' + pct(0.95) + ' ms | max ' + s.maxMs + ' ms');
    lines.push('Ouverture de la base (hors lectures) : ' + (s.ouvertures.length ? s.ouvertures.map(item => new Date(item.t).toLocaleTimeString('fr-FR') + ' ' + item.ms + ' ms').join(' ; ') : 'pas encore ouverte'));
    lines.push('Lectures de plus de ' + NPF_CALQUE_NOMS_SLOW_READ_MS + ' ms (à comparer aux BLOCAGES JS de la même heure) : '
        + (s.lentes.length ? s.lentes.map(item => new Date(item.t).toLocaleTimeString('fr-FR') + ' ' + item.ms + ' ms (zoom ' + item.z + ', ' + item.enAttente + ' en attente)').join(' ; ') : 'aucune'));
    lines.push('Attente de la file du fond avant lecture : total ' + Math.round(s.attenteFondMs) + ' ms | max ' + s.maxAttenteFondMs + ' ms');
    lines.push('Tuiles du calque en mémoire : max ' + s.tuilesMax + ' (≈ ' + (s.tuilesMax * 0.25).toFixed(1) + ' Mo d\'images décodées)');
    lines.push('Mémoire (tuiles du calque · images décodées estimées · tas JS si le navigateur le donne) :');
    if (!s.memoire.length) lines.push('   Aucun relevé.');
    s.memoire.forEach(item => lines.push('   ' + new Date(item.t).toLocaleTimeString('fr-FR') + ' | ' + item.reason + ' | ' + item.tiles + ' tuiles · ' + item.imagesMb + ' Mo'
        + (item.heapMb === null ? '' : ' · tas JS ' + item.heapMb + ' Mo')));
    lines.push('Lectures du FOND pendant les périodes calque affiché / masqué (minutes entières) :');
    let minutes = [];
    try { minutes = Array.from(NPF_DIAG_DETAIL.state.readMinutes.values()); } catch (_) {}
    const summary = shown => {
        const values = [];
        s.periodes.filter(p => p.shown === shown).forEach(p => {
            const a = Math.floor(p.start / 60000);
            const b = Math.floor((p.end || Date.now()) / 60000);
            minutes.forEach(m => {
                const index = Math.floor((m.at || 0) / 60000);
                if (index >= a && index <= b) values.push(...(m.durations || []));
            });
        });
        if (!values.length) return 'aucune lecture';
        values.sort((x, y) => x - y);
        return values.length + ' lectures · médiane ' + values[Math.floor(values.length / 2)] + ' ms · 95 % ' + values[Math.floor(values.length * 0.95)] + ' ms · max ' + values[values.length - 1] + ' ms';
    };
    lines.push('   calque affiché : ' + summary(true));
    lines.push('   calque masqué : ' + summary(false));
    lines.push('Périodes : ' + (s.periodes.length
        ? s.periodes.map(p => (p.shown ? 'affiché ' : 'masqué ') + new Date(p.start).toLocaleTimeString('fr-FR') + '→' + (p.end ? new Date(p.end).toLocaleTimeString('fr-FR') : 'maintenant')).join(' ; ')
        : 'aucune'));
}
