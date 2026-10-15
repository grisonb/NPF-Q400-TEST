/*
 * v17.79 — ESSAI DE FLUIDITÉ : calque « Noms des communes » (tuiles raster transparentes).
 *
 * Décision de Bastien (15/10/2026) : les noms de communes passent dans un calque séparé,
 * affiché AU-DESSUS du Calque Routier et SOUS les zones SIA / VRP / avion. Cette version
 * ne sert qu'à mesurer la fluidité sur iPad, sur le secteur Valence / Privas / Aubenas /
 * Montélimar (section serveur « noms-essai »). La carte NPF-Q400 (V10) reste la carte normale.
 *
 * - Base IndexedDB SÉPARÉE « CalqueNomsCommunes » (sans « NPF » ni préfixe « OfflineMap_ ») :
 *   jamais effacée avec la carte NPF-Q400, jamais listée comme carte, jamais choisie comme fond.
 * - Calque absent (rien installé) : rien n'est créé, l'app est strictement identique à avant.
 * - Lecteur PROPRE, distinct du moteur du fond (dont aucun réglage n'est modifié) : 2 lectures
 *   simultanées au plus, et chaque lecture attend que la file du fond soit vide (1,5 s au plus).
 * - Pane « calqueNomsCommunesPane » (z 420) : au-dessus des routes (405-415), sous les zones
 *   SIA (440) ; tuiles transparentes, sans le fond gris imposé aux tuiles du fond (style.css).
 * - Affiché seulement sur le fond NPF-Q400 (et la carte en ligne), zooms 8 et plus
 *   (images jusqu'au zoom 13, agrandies au-delà), interrupteur dans Gestion des Cartes.
 * - DIAG : temps de lecture des tuiles du calque, mémoire, périodes affiché / masqué et lectures
 *   du fond pendant ces périodes (section « CALQUE NOMS DES COMMUNES » de l'export DIAG).
 */
const NPF_CALQUE_NOMS_DB_NAME = 'CalqueNomsCommunes';
const NPF_CALQUE_NOMS_PACK = 'Calque_Noms_Communes';
const NPF_CALQUE_NOMS_INFO_KEY = 'npfCalqueNomsCommunesV1';
const NPF_CALQUE_NOMS_SHOW_KEY = 'npfCalqueNomsCommunesAfficheV1';
const NPF_CALQUE_NOMS_PANE = 'calqueNomsCommunesPane';
const NPF_CALQUE_NOMS_MIN_ZOOM = 8;
const NPF_CALQUE_NOMS_NATIVE_MAX_ZOOM = 13;
const NPF_CALQUE_NOMS_MAX_READS = 2;
const NPF_CALQUE_NOMS_WAIT_FOND_MAX_MS = 1500;

let npfCalqueNomsLayer = null;
let npfCalqueNomsDbPromise = null;
let npfCalqueNomsActiveReads = 0;
let npfCalqueNomsSyncTimer = null;
let npfCalqueNomsMapListener = false;
const npfCalqueNomsQueue = [];
const npfCalqueNomsStats = {
    lectures: 0, trouvees: 0, vides: 0, erreurs: 0, annulees: 0,
    totalMs: 0, maxMs: 0, durees: [], attenteFondMs: 0, maxAttenteFondMs: 0,
    tuilesMax: 0, periodes: [], memoire: []
};

function readNpfCalqueNomsInfo() {
    try {
        const info = JSON.parse(localStorage.getItem(NPF_CALQUE_NOMS_INFO_KEY) || 'null');
        return info && typeof info === 'object' && info.installed ? info : null;
    } catch (_) {
        return null;
    }
}

function isNpfCalqueNomsShown() {
    try { return localStorage.getItem(NPF_CALQUE_NOMS_SHOW_KEY) !== '0'; } catch (_) { return true; }
}

function openNpfCalqueNomsDb() {
    if (!npfCalqueNomsDbPromise) {
        npfCalqueNomsDbPromise = openOfflineTileDatabaseByName(NPF_CALQUE_NOMS_DB_NAME, 3).then(db => {
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

function readNpfCalqueNomsTile(coords) {
    const tileUrl = buildOfflineTileUrlForPack(`${coords.z}/${coords.x}/${coords.y}.png`, NPF_CALQUE_NOMS_PACK);
    const key = buildStoredTileKey(tileUrl, NPF_CALQUE_NOMS_PACK);
    return openNpfCalqueNomsDb().then(db => new Promise((resolve, reject) => {
        let request;
        try {
            request = db.transaction('tiles', 'readonly').objectStore('tiles').get(key);
        } catch (error) {
            reject(error);
            return;
        }
        request.onsuccess = () => resolve(request.result ? request.result.tile : null);
        request.onerror = () => reject(request.error || new Error('lecture impossible'));
    }));
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

async function runNpfCalqueNomsJob(job) {
    const waited = await waitNpfCalqueNomsFondIdle();
    npfCalqueNomsStats.attenteFondMs += waited;
    if (waited > npfCalqueNomsStats.maxAttenteFondMs) npfCalqueNomsStats.maxAttenteFondMs = Math.round(waited);
    if (job.cancelled) {
        npfCalqueNomsStats.annulees += 1;
        job.done(null, job.tile);
        return;
    }
    const startedAt = performance.now();
    let data = null;
    try {
        data = await readNpfCalqueNomsTile(job.coords);
    } catch (error) {
        npfCalqueNomsStats.erreurs += 1;
        job.done(null, job.tile);
        return;
    }
    const ms = performance.now() - startedAt;
    npfCalqueNomsStats.lectures += 1;
    npfCalqueNomsStats.totalMs += ms;
    if (ms > npfCalqueNomsStats.maxMs) npfCalqueNomsStats.maxMs = Math.round(ms);
    npfCalqueNomsStats.durees.push({ t: Date.now(), ms: Math.round(ms * 10) / 10 });
    if (npfCalqueNomsStats.durees.length > 400) npfCalqueNomsStats.durees.shift();
    if (!data || job.cancelled) {
        if (!data) npfCalqueNomsStats.vides += 1;
        job.done(null, job.tile);
        return;
    }
    npfCalqueNomsStats.trouvees += 1;
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'image/png' }));
    job.tile.onload = () => { URL.revokeObjectURL(url); job.done(null, job.tile); };
    job.tile.onerror = () => { URL.revokeObjectURL(url); job.done(null, job.tile); };
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

/* Affiche ou retire le calque selon : installé, interrupteur, fond NPF-Q400 (ou carte en ligne). */
function syncNpfCalqueNomsLayer(reason = 'sync') {
    if (!map || typeof L === 'undefined') return;
    const info = readNpfCalqueNomsInfo();
    let fondOk = true;
    try { fondOk = isNpfHeavyOverlayBaseMapAllowed(); } catch (_) {}
    const wanted = !!info && isNpfCalqueNomsShown() && fondOk;
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

function setNpfCalqueNomsShown(shown) {
    try { localStorage.setItem(NPF_CALQUE_NOMS_SHOW_KEY, shown ? '1' : '0'); } catch (_) {}
    syncNpfCalqueNomsLayer(shown ? 'interrupteur affiché' : 'interrupteur masqué');
}

/* Téléchargement (section « noms-essai ») : appelé avant d'effacer l'ancienne version du calque. */
function prepareNpfCalqueNomsDownload() {
    try { localStorage.removeItem(NPF_CALQUE_NOMS_INFO_KEY); } catch (_) {}
    if (npfCalqueNomsLayer) {
        try { map.removeLayer(npfCalqueNomsLayer); } catch (_) {}
        npfCalqueNomsLayer = null;
    }
    npfCalqueNomsQueue.forEach(job => { job.cancelled = true; });
    closeNpfCalqueNomsDb();
    refreshNpfCalqueNomsUi();
}

/* Emprise des tuiles du zoom le plus fin (clés seulement, sans lire les images). */
function scanNpfCalqueNomsBounds() {
    return openNpfCalqueNomsDb().then(db => new Promise(resolve => {
        let maxZoom = -1;
        let box = null;
        try {
            const cursorRequest = db.transaction('tiles', 'readonly').objectStore('tiles').index('tileUrl').openKeyCursor();
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor) {
                    if (!box) { resolve(null); return; }
                    const n = 2 ** box.z;
                    const lon = x => x / n * 360 - 180;
                    const lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
                    resolve([lon(box.x0), lat(box.y1 + 1), lon(box.x1 + 1), lat(box.y0)].map(v => Math.round(v * 10000) / 10000));
                    return;
                }
                const match = String(cursor.key || '').match(/\/(\d+)\/(\d+)\/(\d+)\.png/i);
                if (match) {
                    const z = Number(match[1]); const x = Number(match[2]); const y = Number(match[3]);
                    if (z > maxZoom) { maxZoom = z; box = { z, x0: x, x1: x, y0: y, y1: y }; }
                    else if (z === maxZoom) {
                        box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
                        box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
                    }
                }
                cursor.continue();
            };
            cursorRequest.onerror = () => resolve(null);
        } catch (_) {
            resolve(null);
        }
    })).catch(() => null);
}

/* Téléchargement terminé et vérifié : le calque est ajouté, sans recharger la page. */
async function finishNpfCalqueNomsDownload(manifest, count) {
    const bounds = await scanNpfCalqueNomsBounds();
    const info = {
        installed: true, tuiles: count, octets: Number(manifest.totalOctets) || 0,
        version: manifest.versionCarte || manifest.versionContenu || '', creeLe: manifest.creeLe || '',
        installeLe: Date.now(), bounds
    };
    localStorage.setItem(NPF_CALQUE_NOMS_INFO_KEY, JSON.stringify(info));
    syncNpfCalqueNomsLayer('installation');
    return info;
}

async function deleteNpfCalqueNoms() {
    const ok = await npfConfirmInApp('Supprimer le calque des noms des communes ? La carte NPF-Q400 n\'est pas touchée.');
    if (!ok) return;
    prepareNpfCalqueNomsDownload();
    try { await deleteIndexedDatabaseWithTimeoutForNpf(NPF_CALQUE_NOMS_DB_NAME, 15000); } catch (_) {}
    syncNpfCalqueNomsLayer('suppression');
}

function refreshNpfCalqueNomsUi() {
    const status = document.getElementById('noms-installed-status');
    const toggleRow = document.getElementById('noms-toggle-row');
    const toggle = document.getElementById('noms-toggle-input');
    const remove = document.getElementById('noms-delete-button');
    if (!status) return;
    const info = readNpfCalqueNomsInfo();
    if (!info) {
        status.textContent = 'Calque des noms des communes non installé.';
        if (toggleRow) toggleRow.style.display = 'none';
        if (remove) remove.style.display = 'none';
        return;
    }
    const date = info.installeLe ? new Date(info.installeLe).toLocaleDateString('fr-FR') : '?';
    status.textContent = `Installé : ${Number(info.tuiles || 0).toLocaleString('fr-FR')} tuiles (${info.version || '?'}, ${date}).`;
    if (toggleRow) toggleRow.style.display = '';
    if (toggle) toggle.checked = isNpfCalqueNomsShown();
    if (remove) remove.style.display = '';
}

function initNpfCalqueNomsCommunes() {
    const toggle = document.getElementById('noms-toggle-input');
    if (toggle && toggle.dataset.bound !== '1') {
        toggle.dataset.bound = '1';
        toggle.addEventListener('change', () => setNpfCalqueNomsShown(!!toggle.checked));
    }
    const remove = document.getElementById('noms-delete-button');
    if (remove && remove.dataset.bound !== '1') {
        remove.dataset.bound = '1';
        remove.addEventListener('click', () => { deleteNpfCalqueNoms(); });
    }
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

/* DIAG (export) : lectures du calque, mémoire, périodes affiché / masqué et lectures du fond pendant ces périodes. */
function appendNpfCalqueNomsDiagLines(lines) {
    const info = readNpfCalqueNomsInfo();
    lines.push('');
    lines.push('CALQUE NOMS DES COMMUNES — ESSAI DE FLUIDITÉ (v17.79)');
    if (!info) {
        lines.push('Non installé : aucune couche, aucune lecture.');
        return;
    }
    const s = npfCalqueNomsStats;
    const sorted = s.durees.map(item => item.ms).sort((a, b) => a - b);
    const pct = p => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
    lines.push('Installé : ' + info.tuiles + ' tuiles, version ' + info.version + ', base ' + NPF_CALQUE_NOMS_DB_NAME
        + ' | interrupteur ' + (isNpfCalqueNomsShown() ? 'affiché' : 'masqué') + ' | couche ' + (npfCalqueNomsLayer ? 'présente' : 'absente'));
    lines.push('Lectures : ' + s.lectures + ' (' + s.trouvees + ' images, ' + s.vides + ' vides) | erreurs ' + s.erreurs + ' | annulées ' + s.annulees
        + ' | moyenne ' + (s.lectures ? (s.totalMs / s.lectures).toFixed(1) : '—') + ' ms | médiane ' + pct(0.5) + ' ms | 95 % ' + pct(0.95) + ' ms | max ' + s.maxMs + ' ms');
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
