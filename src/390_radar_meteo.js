/*
 * v18.12 — CALQUE RADAR (lame d'eau Météo-France), seulement avec du réseau. Décisions de Bastien (26/11/2026) :
 *  - images fabriquées sur le VPS (npf-meteo-radar 1.0.0, toutes les 5 min, API Météo-France « DonneesPubliquesRadar »,
 *    Licence Ouverte : mention « Météo-France ») et publiées sous https://vps-3c305ff2.vps.ovh.net/meteo-radar/ ; aucune clé
 *    ni calcul dans l'app : une image PNG transparente par pas de 5 min (Web Mercator, métropole + Corse) et index.json ;
 *  - légende en mm/h (couleurs proches de Windy, faibles intensités transparentes), « Météo-France » et heure UTC de l'image,
 *    en vert jusqu'à 15 min, en rouge au-delà ; image de plus de 30 min : plus rien affiché (aussi sans réseau) ;
 *  - ANIMATION des 12 dernières images (1 h) : lecture / pause ; images préparées (décodées) avant la lecture, une seule image
 *    sur la carte (changement d'adresse), mise en pause pendant les gestes, reprise après ; libérées quand le calque est éteint ;
 *  - au-dessus des HT et des Routes, sous les noms des communes, les zones SIA, les zones de toucher et les symboles (niveau 418,
 *    le doigt le traverse) ; bouton ON / OFF dans le panneau « Calques aéronautiques » ; ÉTEINT au lancement ;
 *  - actualisation toutes les 5 min quand le calque est allumé (en ligne, premier plan), jamais pendant un geste.
 * Le service worker laisse déjà passer le VPS en direct (isNpfMapServerRequest) : rien n'est copié dans ses caches.
 */
const NPF_RADAR_BASE_URL = 'https://vps-3c305ff2.vps.ovh.net/meteo-radar/';
const NPF_RADAR_REFRESH_MS = 5 * 60 * 1000;
const NPF_RADAR_MIN_INTERVAL_MS = 60 * 1000;
const NPF_RADAR_TIMEOUT_MS = 20000;
const NPF_RADAR_MAX_AGE_MIN = 30;       // au-delà : rien affiché
const NPF_RADAR_FRESH_MIN = 15;         // heure en vert jusqu'à 15 min, rouge au-delà
const NPF_RADAR_FRAME_MS = 600;         // animation : une image toutes les 0,6 s…
const NPF_RADAR_LAST_HOLD_MS = 1800;    // …et la plus récente tenue 1,8 s

const npfRadar = {
    installed: false,
    visible: false,
    index: null,            // index.json du VPS (dernier valable)
    frames: [],             // [{ heure: Date, url }]
    overlay: null,
    showing: -1,            // image affichée (indice dans frames)
    playing: false,
    pausedByGesture: false,
    timer: null,
    decoded: new Map(),     // url -> Image décodée (seulement pendant l'animation)
    inFlight: null,
    lastRequestAt: 0,
    lastAttemptAt: null,
    lastResult: '',
    lastError: '',
    failures: 0,
    downloads: 0,
    moving: false,
    pendingApply: false,
    decodeMs: 0
};

function npfRadarHhMmZ(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--Z';
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}Z`;
}

function npfRadarAgeMin(date) {
    return (Date.now() - date.getTime()) / 60000;
}

/* Dernière image utilisable (30 min au plus), ou -1. */
function npfRadarLatestUsable() {
    const i = npfRadar.frames.length - 1;
    if (i < 0) return -1;
    return npfRadarAgeMin(npfRadar.frames[i].heure) <= NPF_RADAR_MAX_AGE_MIN ? i : -1;
}

function npfRadarEnsurePane() {
    if (!map || !map.createPane) return false;
    if (!map.getPane('npfRadarPane')) {
        const pane = map.createPane('npfRadarPane');
        pane.style.zIndex = '418';
        pane.style.pointerEvents = 'none';
    }
    return true;
}

function npfRadarBounds() {
    const e = npfRadar.index && npfRadar.index.emprise;
    return e ? L.latLngBounds([[Number(e.sud), Number(e.ouest)], [Number(e.nord), Number(e.est)]]) : null;
}

/* Affiche l'image d'indice i (jamais pendant un geste : reporté à la fin). */
function npfRadarShow(i) {
    if (npfRadar.moving) { npfRadar.pendingApply = true; return; }
    const frame = npfRadar.frames[i];
    const bounds = npfRadarBounds();
    if (!npfRadar.visible || !frame || !bounds || !npfRadarEnsurePane()) { npfRadarRemoveOverlay(); return; }
    if (!npfRadar.overlay) {
        npfRadar.overlay = L.imageOverlay(frame.url, bounds, { pane: 'npfRadarPane', interactive: false, className: 'npf-radar-image', opacity: 1 });
        npfRadar.overlay.addTo(map);
    } else if (npfRadar.showing !== i) {
        npfRadar.overlay.setUrl(frame.url);
        npfRadar.overlay.setBounds(bounds);
    }
    npfRadar.showing = i;
    npfRadarUpdateLegend();
}

function npfRadarRemoveOverlay() {
    if (npfRadar.overlay) { try { map.removeLayer(npfRadar.overlay); } catch (_) {} }
    npfRadar.overlay = null;
    npfRadar.showing = -1;
}

/* État courant : image la plus récente (hors animation), ou rien si trop vieille. */
function npfRadarApply() {
    npfRadar.pendingApply = false;
    if (!npfRadar.visible) { npfRadarStop(); npfRadarRemoveOverlay(); npfRadarUpdateLegend(); npfRadarUpdateButton(); return; }
    const latest = npfRadarLatestUsable();
    if (latest < 0) { npfRadarStop(); npfRadarRemoveOverlay(); }
    else if (!npfRadar.playing) npfRadarShow(latest);
    npfRadarUpdateLegend();
    npfRadarUpdateButton();
}

/* ---------- Animation ---------- */
async function npfRadarPrepareFrames() {
    const t0 = performance.now();
    const urls = npfRadar.frames.map(f => f.url);
    Array.from(npfRadar.decoded.keys()).forEach(u => { if (!urls.includes(u)) npfRadar.decoded.delete(u); });
    await Promise.all(urls.map(async url => {
        if (npfRadar.decoded.has(url)) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        try { await img.decode(); npfRadar.decoded.set(url, img); } catch (_) {}
    }));
    npfRadar.decodeMs = Math.round(performance.now() - t0);
}

function npfRadarTick() {
    npfRadar.timer = null;
    if (!npfRadar.playing || !npfRadar.visible) return;
    if (npfRadar.moving) { npfRadar.pausedByGesture = true; return; }
    const n = npfRadar.frames.length;
    if (!n || npfRadarLatestUsable() < 0) { npfRadarStop(); npfRadarApply(); return; }
    const next = npfRadar.showing < 0 || npfRadar.showing >= n - 1 ? 0 : npfRadar.showing + 1;
    npfRadarShow(next);
    npfRadar.timer = setTimeout(npfRadarTick, next === n - 1 ? NPF_RADAR_LAST_HOLD_MS : NPF_RADAR_FRAME_MS);
}

async function npfRadarPlay() {
    if (npfRadar.playing || !npfRadar.visible || npfRadar.frames.length < 2 || npfRadarLatestUsable() < 0) return;
    npfRadar.playing = true;
    npfRadarUpdateLegend();
    await npfRadarPrepareFrames();
    if (!npfRadar.playing) return;
    npfRadarTick();
}

function npfRadarStop() {
    npfRadar.playing = false;
    npfRadar.pausedByGesture = false;
    if (npfRadar.timer) { clearTimeout(npfRadar.timer); npfRadar.timer = null; }
}

function npfRadarTogglePlay() {
    if (npfRadar.playing) {
        npfRadarStop();
        const latest = npfRadarLatestUsable();
        if (latest >= 0) npfRadarShow(latest);
        npfRadar.decoded.clear();        // images de l'animation libérées
        npfRadarUpdateLegend();
    } else {
        npfRadarPlay();
    }
}

/* ---------- Légende (mm/h, Météo-France, heure) ---------- */
function npfRadarEnsureLegend() {
    let el = document.getElementById('npf-radar-legende');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'npf-radar-legende';
    el.className = 'npf-radar-legende';
    el.hidden = true;
    el.innerHTML = `
        <div class="npf-radar-legende-haut">
            <span class="npf-radar-legende-titre">Radar pluie</span>
            <span id="npf-radar-heure" class="npf-radar-heure">--:--Z</span>
            <button type="button" id="npf-radar-lecture" class="npf-radar-lecture" aria-label="Lecture de l'animation">▶</button>
        </div>
        <div id="npf-radar-echelle" class="npf-radar-echelle"></div>
        <div class="npf-radar-legende-bas"><span id="npf-radar-unite">mm/h</span><span>Météo-France</span></div>
        <div id="npf-radar-message" class="npf-radar-message"></div>`;
    document.body.appendChild(el);
    el.querySelector('#npf-radar-lecture').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); npfRadarTogglePlay(); });
    return el;
}

function npfRadarUpdateLegend() {
    const el = npfRadarEnsureLegend();
    el.hidden = !npfRadar.visible;
    if (!npfRadar.visible) return;
    const echelle = el.querySelector('#npf-radar-echelle');
    const leg = npfRadar.index && Array.isArray(npfRadar.index.legende) ? npfRadar.index.legende : [];
    const cle = leg.map(l => l.mmh + l.couleur).join('|');
    if (echelle.dataset.cle !== cle) {
        echelle.dataset.cle = cle;
        echelle.innerHTML = leg.map(l => `<span class="npf-radar-case" style="background:${String(l.couleur).replace(/[^#0-9a-fA-F]/g, '')}"><b>${Number(l.mmh)}</b></span>`).join('');
    }
    const heure = el.querySelector('#npf-radar-heure');
    const message = el.querySelector('#npf-radar-message');
    const lecture = el.querySelector('#npf-radar-lecture');
    const frame = npfRadar.frames[npfRadar.showing];
    if (frame && npfRadar.showing >= 0) {
        const age = npfRadarAgeMin(npfRadar.frames[npfRadar.frames.length - 1].heure);
        heure.textContent = npfRadarHhMmZ(frame.heure);
        heure.classList.toggle('npf-radar-heure-ok', age <= NPF_RADAR_FRESH_MIN);
        heure.classList.toggle('npf-radar-heure-vieille', age > NPF_RADAR_FRESH_MIN);
        heure.classList.toggle('npf-radar-heure-animee', npfRadar.playing && npfRadar.showing !== npfRadar.frames.length - 1);
        message.textContent = npfRadar.lastResult === 'ERREUR' ? `Dernière image gardée (${npfRadar.lastError})` : '';
    } else {
        heure.textContent = '--:--Z';
        heure.classList.remove('npf-radar-heure-ok', 'npf-radar-heure-animee');
        heure.classList.add('npf-radar-heure-vieille');
        message.textContent = npfRadar.frames.length
            ? `Pas d'image de moins de ${NPF_RADAR_MAX_AGE_MIN} min : rien affiché`
            : (npfRadar.inFlight ? 'Chargement…' : `Radar indisponible${npfRadar.lastError ? ' (' + npfRadar.lastError + ')' : ''}`);
    }
    lecture.textContent = npfRadar.playing ? '❚❚' : '▶';
    lecture.disabled = npfRadar.frames.length < 2 || npfRadarLatestUsable() < 0;
    lecture.setAttribute('aria-label', npfRadar.playing ? "Pause de l'animation" : "Lecture de l'animation");
}

/* ---------- Bouton du panneau « Calques aéronautiques » ---------- */
function npfRadarUpdateButton() {
    const button = document.getElementById('sia-filter-radar');
    if (!button) return;
    button.classList.toggle('active', npfRadar.visible);
    button.setAttribute('aria-pressed', npfRadar.visible ? 'true' : 'false');
    const titre = button.querySelector('.sia-filter-radar-titre');
    const heure = button.querySelector('.sia-filter-radar-heure');
    const latest = npfRadarLatestUsable();
    const t1 = `RADAR ${npfRadar.visible ? 'ON' : 'OFF'}`;
    const t2 = latest >= 0 ? `image ${npfRadarHhMmZ(npfRadar.frames[latest].heure)}` : (npfRadar.visible ? (npfRadar.inFlight ? 'chargement…' : 'pas d\'image') : 'Météo-France');
    if (titre && titre.textContent !== t1) titre.textContent = t1;
    if (heure && heure.textContent !== t2) heure.textContent = t2;
    button.classList.toggle('radar-sans-image', npfRadar.visible && latest < 0);
}

function npfRadarToggle() {
    npfRadar.visible = !npfRadar.visible;
    if (npfRadar.visible) {
        npfRadarApply();
        npfRadarRefresh('allumage');
    } else {
        npfRadarStop();
        npfRadarRemoveOverlay();
        npfRadar.decoded.clear();
        npfRadarApply();
    }
}

/* ---------- Téléchargement de index.json ---------- */
function npfRadarRefresh(reason) {
    if (npfRadar.inFlight) return npfRadar.inFlight;
    const now = Date.now();
    if (now - npfRadar.lastRequestAt < NPF_RADAR_MIN_INTERVAL_MS) return Promise.resolve(false);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { npfRadarApply(); return Promise.resolve(false); }
    npfRadar.lastRequestAt = now;
    npfRadar.lastAttemptAt = new Date(now);
    npfRadar.inFlight = npfRadarRequest(reason).finally(() => { npfRadar.inFlight = null; npfRadarApply(); });
    npfRadarUpdateButton();
    return npfRadar.inFlight;
}

async function npfRadarRequest() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), NPF_RADAR_TIMEOUT_MS) : null;
    try {
        const response = await fetch(`${NPF_RADAR_BASE_URL}index.json?t=${Date.now()}`, {
            method: 'GET', cache: 'no-store', credentials: 'omit', signal: controller ? controller.signal : undefined
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let data;
        try { data = await response.json(); } catch (_) { throw new Error('réponse non JSON'); }
        if (!data || data.version !== 1 || !Array.isArray(data.images) || !data.emprise) throw new Error('index.json non reconnu');
        const frames = data.images.map(i => ({ heure: new Date(i.heure), url: NPF_RADAR_BASE_URL + String(i.fichier || '').replace(/^\/+/, '') }))
            .filter(f => !Number.isNaN(f.heure.getTime()) && /^images\/radar-[0-9TZ]+\.png$/.test(f.url.slice(NPF_RADAR_BASE_URL.length)))
            .sort((a, b) => a.heure - b.heure);
        if (!frames.length) throw new Error('aucune image');
        npfRadar.index = data;
        const changed = frames.map(f => f.url).join('|') !== npfRadar.frames.map(f => f.url).join('|');
        npfRadar.frames = frames;
        if (changed) { npfRadar.showing = Math.min(npfRadar.showing, frames.length - 1); if (npfRadar.playing) npfRadarPrepareFrames(); }
        npfRadar.downloads += 1;
        npfRadar.lastResult = 'OK';
        npfRadar.lastError = '';
        return true;
    } catch (error) {
        npfRadar.failures += 1;
        npfRadar.lastResult = 'ERREUR';
        npfRadar.lastError = error && error.name === 'AbortError' ? 'délai dépassé' : (error && error.message || String(error));
        return false;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/* ---------- Installation ---------- */
function installNpfRadar() {
    if (npfRadar.installed) return true;
    if (typeof map === 'undefined' || !map || !window.L || !map.on) return false;
    npfRadar.installed = true;
    npfRadar.visible = false;     // éteint au lancement
    document.addEventListener('click', event => {
        const target = event.target && event.target.closest ? event.target.closest('#sia-filter-radar') : null;
        if (!target) return;
        event.preventDefault();
        npfRadarToggle();
    });
    map.on('movestart zoomstart', () => { npfRadar.moving = true; });
    map.on('moveend zoomend', () => {
        npfRadar.moving = false;
        setTimeout(() => {
            if (npfRadar.moving) return;
            if (npfRadar.pendingApply) npfRadarApply();
            if (npfRadar.playing && npfRadar.pausedByGesture && !npfRadar.timer) { npfRadar.pausedByGesture = false; npfRadarTick(); }
        }, 400);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (npfRadar.playing) { npfRadarStop(); npfRadarApply(); } return; }
        if (npfRadar.visible) { npfRadarApply(); npfRadarRefresh('retour au premier plan'); }
    });
    setInterval(() => {
        if (!npfRadar.visible || document.hidden || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
        if (npfRadar.moving) return;
        npfRadarRefresh('actualisation 5 min');
    }, NPF_RADAR_REFRESH_MS);
    setInterval(() => { if (npfRadar.visible) npfRadarApply(); }, 60000);   // âge de l'image (vert / rouge / plus rien)
    return true;
}

(function startNpfRadarWhenMapReady() {
    let attempts = 0;
    const attempt = () => {
        attempts += 1;
        let ok = false;
        try { ok = installNpfRadar(); } catch (_) { ok = false; }
        if (!ok && attempts < 240) setTimeout(attempt, 500);
    };
    setTimeout(attempt, 800);
})();

function getNpfRadarDiagLine() {
    const latest = npfRadar.frames[npfRadar.frames.length - 1];
    return 'RADAR (v18.12) : ' + (npfRadar.visible ? 'ON' : 'OFF')
        + ' | dernière image ' + (latest ? npfRadarHhMmZ(latest.heure) + ' (' + Math.round(npfRadarAgeMin(latest.heure)) + ' min)' : '—')
        + ' | images ' + npfRadar.frames.length + (npfRadarLatestUsable() < 0 && npfRadar.frames.length ? ' (trop vieilles : rien affiché)' : '')
        + ' | animation ' + (npfRadar.playing ? 'en lecture' : 'arrêtée') + ', préparée en ' + npfRadar.decodeMs + ' ms (' + npfRadar.decoded.size + ' en mémoire)'
        + ' | téléchargements ' + npfRadar.downloads + ' | échecs ' + npfRadar.failures + (npfRadar.lastError ? ' (dernier : ' + npfRadar.lastError + ')' : '');
}

function getNpfRadarEtat() {
    return {
        visible: npfRadar.visible, images: npfRadar.frames.length, affichee: npfRadar.showing,
        heureAffichee: npfRadar.frames[npfRadar.showing] ? npfRadar.frames[npfRadar.showing].heure.toISOString() : null,
        utilisable: npfRadarLatestUsable(), lecture: npfRadar.playing, decodees: npfRadar.decoded.size, decodeMs: npfRadar.decodeMs,
        downloads: npfRadar.downloads, failures: npfRadar.failures, lastError: npfRadar.lastError, overlay: !!npfRadar.overlay,
        diag: getNpfRadarDiagLine()
    };
}
