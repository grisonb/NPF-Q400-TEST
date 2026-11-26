/*
 * v18.10 — MÉTÉO DES PÉLICANDROMES (METAR / TAF). Décisions de Bastien (26/11/2026) :
 *  - source : un fichier « tous les pélics » du NAS (get-meteo-pelics.php, chaîne NOTAM / météo de BFG : NAS -> worker VPS ->
 *    SDVFR, VPS inchangé), lu comme le RTBA : sans connexion BFG, sans jeton côté navigateur ;
 *  - aucune station de repli : un pélic sans METAR ni TAF n'a PAS de bouton ; METAR sans TAF : METAR seul (et inversement) ;
 *  - bouton « MÉTÉO » dans la fenêtre du pélic, à côté de « NOTAMS » ; un toucher ouvre le METAR et le TAF en texte brut,
 *    âge du METAR (vert jusqu'à 35 min, rouge au-delà) et « TAF non à jour » : mêmes règles que BFG TEST
 *    (checkWeatherValidity) ;
 *  - sans réseau : dernier fichier valable du jour gardé avec son heure ; JAMAIS celui d'un jour de Paris précédent ; un échec
 *    ne remplace jamais le dernier fichier valable ;
 *  - au lancement, au retour au premier plan, toutes les 10 min (en ligne, app au premier plan) ; jamais deux demandes en moins
 *    de 60 s ; si le NAS vient de lancer une actualisation (lot de pélics demandé à SDVFR), une seule relecture 90 s plus tard
 *    (3 au plus de suite) pour recevoir les bulletins sans attendre 10 min.
 * Rien n'est dessiné sur la carte : seules la fenêtre du pélic (bouton ajouté à son ouverture) et la fenêtre MÉTÉO changent.
 *
 * v18.11 — bouton « Rafraîchir » de la fenêtre MÉTÉO (demande de Bastien, 26/11/2026) : un toucher demande au NAS les DERNIERS
 * bulletins des 27 pélics, même de moins de 10 min (get-meteo-pelics.php 1.1, ?force=1 ; le NAS attend toujours que le créneau
 * SDVFR soit libre, jamais pendant une demande NOTAM, et travaille par lots de 10). Pendant la mise à jour : « mise à jour en
 * cours… », relecture toutes les 30 s, fenêtre mise à jour toute seule (bulletins et âges). Au bout de 4 min sans tout recevoir,
 * ou sans réseau : message clair, bulletins précédents gardés. Bouton grisé 2 min après un toucher (le NAS refuse de toute façon
 * une seconde demande forcée en moins de 2 min, tous iPad confondus).
 */
const NPF_METEO_PELICS_URL = 'https://grisonb.synology.me/briefing-api/get-meteo-pelics.php';
const NPF_METEO_PELICS_STORE_KEY = 'npfQ400TestMeteoPelicsV1';
const NPF_METEO_PELICS_REFRESH_MS = 10 * 60 * 1000;
const NPF_METEO_PELICS_MIN_INTERVAL_MS = 60 * 1000;
const NPF_METEO_PELICS_FOLLOW_MS = 90 * 1000;
const NPF_METEO_PELICS_FOLLOW_MAX = 3;
const NPF_METEO_PELICS_TIMEOUT_MS = 20000;
const NPF_METEO_METAR_MAX_AGE_MIN = 35;
const NPF_METEO_FORCE_LOCK_MS = 2 * 60 * 1000;     // bouton grisé 2 min après un toucher
const NPF_METEO_FORCE_POLL_MS = 30 * 1000;         // relecture pendant une mise à jour demandée
const NPF_METEO_FORCE_MAX_MS = 4 * 60 * 1000;      // au-delà : message, bulletins précédents gardés

const npfMeteoPelics = {
    installed: false,
    file: null,             // { genereA (Date), recuA (Date), pelics: { OACI: { recupereA, metar, taf } } }
    fromMemory: false,
    inFlight: null,
    lastRequestAt: 0,
    lastAttemptAt: null,
    lastReason: '',
    lastResult: '',
    lastError: '',
    failures: 0,
    downloads: 0,
    followCount: 0,
    followTimer: null,
    stored: 'non',
    nasCreneau: '',
    nasDemandes: 0,
    modalOaci: '',
    modalTimer: null,
    forceLockUntil: 0,      // bouton « Rafraîchir » grisé jusqu'à cette heure
    forceRun: null,         // { startedAt, timer, restants } pendant une mise à jour demandée
    forceMessage: '',
    forceMessageWarn: false,
    forceRequests: 0
};

function npfMeteoParisDayKey(ms) {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(new Date(ms));
        const get = type => (parts.find(p => p.type === type) || {}).value || '00';
        return `${get('year')}-${get('month')}-${get('day')}`;
    } catch (_) {
        const d = new Date(ms);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
}

function npfMeteoHhMm(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--';
    try {
        return date.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
}

function npfMeteoEscape(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Bulletin lisible : texte brut non vide, sinon null. */
function npfMeteoReport(report) {
    if (!report || typeof report !== 'object') return null;
    const texte = String(report.texte || '').trim();
    return texte ? { texte, heure: String(report.heure || '') } : null;
}

/* Réponse du NAS -> fichier normalisé, ou null si elle n'est pas reconnue. */
function npfMeteoNormalizeFile(data, recuA) {
    if (!data || data.ok !== true || data.type !== 'meteo-pelics' || !data.pelics || typeof data.pelics !== 'object') return null;
    const genereA = new Date(data.genereA || '');
    if (Number.isNaN(genereA.getTime())) return null;
    const pelics = {};
    Object.entries(data.pelics).forEach(([oaci, p]) => {
        const code = String(oaci || '').trim().toUpperCase();
        if (!/^[A-Z]{4}$/.test(code) || !p || typeof p !== 'object') return;
        const recupereA = new Date(p.recupereA || '');
        pelics[code] = {
            recupereA: Number.isNaN(recupereA.getTime()) ? null : recupereA,
            metar: npfMeteoReport(p.metar),
            taf: npfMeteoReport(p.taf)
        };
    });
    return { genereA, recuA: recuA instanceof Date ? recuA : new Date(), pelics };
}

function npfMeteoReadStore() {
    try {
        const raw = JSON.parse(localStorage.getItem(NPF_METEO_PELICS_STORE_KEY) || 'null');
        if (!raw || !raw.data) return null;
        return npfMeteoNormalizeFile(raw.data, new Date(raw.recuA || ''));
    } catch (_) {
        return null;
    }
}

function npfMeteoWriteStore(data, recuA) {
    try {
        localStorage.setItem(NPF_METEO_PELICS_STORE_KEY, JSON.stringify({ version: 1, recuA: recuA.toISOString(), data }));
        npfMeteoPelics.stored = 'oui';
    } catch (_) {
        npfMeteoPelics.stored = 'mémoire seulement (enregistrement impossible)';
    }
}

/* Fichier utilisable : reçu, et produit AUJOURD'HUI (jour de Paris). */
function npfMeteoFileOfToday() {
    const f = npfMeteoPelics.file;
    if (!f || !(f.genereA instanceof Date)) return null;
    return npfMeteoParisDayKey(f.genereA.getTime()) === npfMeteoParisDayKey(Date.now()) ? f : null;
}

/* Bulletins d'un pélic (fichier du jour, bulletin récupéré aujourd'hui), ou null s'il n'a ni METAR ni TAF. */
function getNpfMeteoPelic(oaci) {
    const f = npfMeteoFileOfToday();
    const code = String(oaci || '').trim().toUpperCase();
    if (!f || !f.pelics[code]) return null;
    const p = f.pelics[code];
    if (p.recupereA instanceof Date && npfMeteoParisDayKey(p.recupereA.getTime()) !== npfMeteoParisDayKey(Date.now())) return null;
    if (!p.metar && !p.taf) return null;
    return p;
}

/* Âge du METAR en minutes (heure JJHHMMZ du texte, comme BFG), ou null. */
function npfMeteoMetarAgeMinutes(texte, nowMs) {
    const m = String(texte || '').match(/(\d{2})(\d{2})(\d{2})Z/);
    if (!m) return null;
    const now = new Date(nowMs);
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Number(m[1]), Number(m[2]), Number(m[3])));
    if (d.getTime() > nowMs) {
        d.setUTCMonth(d.getUTCMonth() - 1);
        if (d.getTime() > nowMs) d.setUTCFullYear(d.getUTCFullYear() - 1);
    }
    return (nowMs - d.getTime()) / 60000;
}

/* TAF périmé (fin de validité dépassée, règle de BFG), true / false, ou null si illisible. */
function npfMeteoTafExpired(texte, nowMs) {
    const m = String(texte || '').match(/(\d{2})\d{4}Z\s+\d{2}(\d{2})\/(\d{2})(\d{2})/);
    if (!m) return null;
    const now = new Date(nowMs);
    const issueDay = Number(m[1]);
    const endDay = Number(m[3]);
    const endHour = Number(m[4]);
    const expiry = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), endDay, endHour, 0));
    if (endDay < issueDay) expiry.setUTCMonth(expiry.getUTCMonth() + 1);
    return nowMs > expiry.getTime();
}

/* ---------- Téléchargement ---------- */
function npfMeteoRefresh(reason, options = {}) {
    if (npfMeteoPelics.inFlight) return npfMeteoPelics.inFlight;
    const now = Date.now();
    if (!options.user && now - npfMeteoPelics.lastRequestAt < NPF_METEO_PELICS_MIN_INTERVAL_MS) return Promise.resolve(false);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (npfMeteoPelics.file) npfMeteoPelics.fromMemory = true;
        return Promise.resolve(false);
    }
    npfMeteoPelics.lastRequestAt = now;
    npfMeteoPelics.lastAttemptAt = new Date(now);
    npfMeteoPelics.lastReason = String(reason || '');
    npfMeteoPelics.inFlight = npfMeteoRequest(!!options.force).finally(() => { npfMeteoPelics.inFlight = null; });
    return npfMeteoPelics.inFlight;
}

async function npfMeteoRequest(force) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), NPF_METEO_PELICS_TIMEOUT_MS) : null;
    try {
        if (force) npfMeteoPelics.forceRequests += 1;
        const response = await fetch(`${NPF_METEO_PELICS_URL}?${force ? 'force=1&' : ''}t=${Date.now()}`, {
            method: 'GET', cache: 'no-store', credentials: 'omit',
            headers: { 'Accept': 'application/json' },
            signal: controller ? controller.signal : undefined
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let data;
        try { data = await response.json(); } catch (_) { throw new Error('réponse non JSON'); }
        if (data && data.ok === false) throw new Error(String(data.error || data.erreur || data.code || 'erreur du NAS'));
        const recuA = new Date();
        const file = npfMeteoNormalizeFile(data, recuA);
        if (!file) throw new Error('structure de réponse non reconnue');
        npfMeteoWriteStore(data, recuA);
        npfMeteoPelics.file = file;
        npfMeteoPelics.fromMemory = false;
        npfMeteoPelics.downloads += 1;
        npfMeteoPelics.lastResult = 'OK';
        npfMeteoPelics.lastError = '';
        const act = data.actualisation && typeof data.actualisation === 'object' ? data.actualisation : {};
        npfMeteoPelics.nasCreneau = String(act.creneau || '');
        npfMeteoPelics.nasDemandes = Array.isArray(act.demandes) ? act.demandes.length : 0;
        npfMeteoPelics.lastForce = data.force && typeof data.force === 'object' ? data.force : null;
        if (!npfMeteoPelics.forceRun) npfMeteoScheduleFollow(npfMeteoPelics.nasDemandes > 0 || Number(act.enAttente || 0) > 0);
        npfMeteoAfterChange();
        return true;
    } catch (error) {
        const message = error && error.name === 'AbortError' ? 'délai dépassé' : (error && error.message || String(error));
        npfMeteoPelics.failures += 1;
        npfMeteoPelics.lastResult = 'ERREUR';
        npfMeteoPelics.lastError = message;
        /* Un échec ne remplace jamais le dernier fichier valable. */
        if (npfMeteoPelics.file) npfMeteoPelics.fromMemory = true;
        npfMeteoAfterChange();
        return false;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/* ---------- v18.11 — bouton « Rafraîchir » : derniers bulletins des 27 pélics ---------- */
function npfMeteoForceFinish(message, warn) {
    const run = npfMeteoPelics.forceRun;
    if (run && run.timer) clearTimeout(run.timer);
    npfMeteoPelics.forceRun = null;
    npfMeteoPelics.forceMessage = message;
    npfMeteoPelics.forceMessageWarn = !!warn;
    npfMeteoRenderModal();
}

/* Après chaque réponse : fini, à relire dans 30 s, ou abandon au bout de 4 min (bulletins précédents gardés). */
function npfMeteoForceStep(ok) {
    const run = npfMeteoPelics.forceRun;
    if (!run) return;
    if (!ok) {
        npfMeteoForceFinish(`Mise à jour impossible (${npfMeteoPelics.lastError || 'réseau'}) : bulletins précédents gardés.`, true);
        return;
    }
    const f = npfMeteoPelics.lastForce;
    if (!f) {
        npfMeteoForceFinish('Le NAS ne propose pas encore la mise à jour immédiate : bulletins habituels (toutes les 10 min).', true);
        return;
    }
    run.restants = Number(f.restants || 0);
    if (!f.actif || run.restants === 0) {
        npfMeteoForceFinish(`Bulletins à jour (${npfMeteoHhMm(new Date())}).`, false);
        return;
    }
    if (Date.now() - run.startedAt >= NPF_METEO_FORCE_MAX_MS) {
        npfMeteoForceFinish(`Pas tous les nouveaux bulletins reçus (${run.restants} pélic${run.restants > 1 ? 's' : ''} en attente, serveur occupé) : bulletins précédents gardés.`, true);
        return;
    }
    npfMeteoPelics.forceMessage = 'Mise à jour en cours…';
    npfMeteoPelics.forceMessageWarn = false;
    npfMeteoRenderModal();
    run.timer = setTimeout(() => {
        run.timer = null;
        if (npfMeteoPelics.forceRun !== run) return;
        npfMeteoRefresh('mise à jour demandée (suite)', { user: true }).then(npfMeteoForceStep);
    }, NPF_METEO_FORCE_POLL_MS);
}

function npfMeteoForceRefresh() {
    const now = Date.now();
    if (now < npfMeteoPelics.forceLockUntil || npfMeteoPelics.forceRun) return false;
    npfMeteoPelics.forceLockUntil = now + NPF_METEO_FORCE_LOCK_MS;
    setTimeout(npfMeteoRenderModal, NPF_METEO_FORCE_LOCK_MS + 200);   // bouton de nouveau actif
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        npfMeteoPelics.forceMessage = 'Pas de réseau : bulletins précédents gardés.';
        npfMeteoPelics.forceMessageWarn = true;
        npfMeteoRenderModal();
        return false;
    }
    if (npfMeteoPelics.followTimer) { clearTimeout(npfMeteoPelics.followTimer); npfMeteoPelics.followTimer = null; }
    npfMeteoPelics.forceRun = { startedAt: now, timer: null, restants: null };
    npfMeteoPelics.forceMessage = 'Mise à jour en cours…';
    npfMeteoPelics.forceMessageWarn = false;
    npfMeteoRenderModal();
    const go = () => npfMeteoRefresh('mise à jour demandée', { user: true, force: true }).then(npfMeteoForceStep);
    if (npfMeteoPelics.inFlight) npfMeteoPelics.inFlight.then(go, go); else go();
    return true;
}

/* Une relecture 90 s plus tard si le NAS vient de demander des bulletins (3 au plus de suite). */
function npfMeteoScheduleFollow(needed) {
    if (npfMeteoPelics.followTimer) { clearTimeout(npfMeteoPelics.followTimer); npfMeteoPelics.followTimer = null; }
    if (!needed || npfMeteoPelics.followCount >= NPF_METEO_PELICS_FOLLOW_MAX) { if (!needed) npfMeteoPelics.followCount = 0; return; }
    npfMeteoPelics.followCount += 1;
    npfMeteoPelics.followTimer = setTimeout(() => {
        npfMeteoPelics.followTimer = null;
        if (document.hidden) return;
        npfMeteoRefresh('relecture après actualisation du NAS');
    }, NPF_METEO_PELICS_FOLLOW_MS);
}

/* ---------- Fenêtre du pélic : bouton MÉTÉO à côté de NOTAMS ---------- */
function npfMeteoInjectButton(root) {
    if (!root || !root.querySelectorAll) return false;
    let changed = false;
    root.querySelectorAll('.popup-notams-buttons').forEach(box => {
        const notams = box.querySelector('.pelic-notams-btn');
        const m = notams && String(notams.getAttribute('onclick') || '').match(/openPelicNotams\('([A-Z0-9]{4})'\)/);
        const oaci = m ? m[1] : '';
        const isPelic = oaci && typeof pelicanAirports !== 'undefined' && Array.isArray(pelicanAirports) && pelicanAirports.some(a => a && a.oaci === oaci);
        const meteo = isPelic ? getNpfMeteoPelic(oaci) : null;
        const existing = box.querySelector('.pelic-meteo-btn');
        if (!meteo) {
            if (existing) { existing.remove(); box.classList.remove('avec-meteo'); changed = true; }
            return;
        }
        if (existing) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pelic-meteo-btn';
        button.textContent = 'MÉTÉO';
        button.setAttribute('data-oaci', oaci);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openNpfMeteoPelic(oaci);
        });
        box.appendChild(button);
        box.classList.add('avec-meteo');
        changed = true;
    });
    return changed;
}

/* Taille et position de la fenêtre seulement : popup.update() reconstruirait son contenu (et retirerait le bouton). */
function npfMeteoRelayoutPopup(popup) {
    try {
        if (typeof popup._updateLayout === 'function') popup._updateLayout();
        if (typeof popup._updatePosition === 'function') popup._updatePosition();
    } catch (_) {}
}

function npfMeteoRefreshOpenPopups() {
    try {
        if (typeof map === 'undefined' || !map) return;
        const popup = map._popup;
        if (popup && map.hasLayer(popup) && popup._contentNode && npfMeteoInjectButton(popup._contentNode)) npfMeteoRelayoutPopup(popup);
    } catch (_) {}
}

/* ---------- Fenêtre MÉTÉO ---------- */
function ensureNpfMeteoModal() {
    let modal = document.getElementById('npf-meteo-pelic-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'npf-meteo-pelic-modal';
    modal.className = 'npf-meteo-modal';
    modal.hidden = true;
    modal.innerHTML = `
        <div class="npf-meteo-modal-card" role="dialog" aria-modal="true" aria-labelledby="npf-meteo-modal-title">
            <div class="npf-meteo-modal-header">
                <div>
                    <div id="npf-meteo-modal-title" class="npf-meteo-modal-title">MÉTÉO</div>
                    <div id="npf-meteo-modal-source" class="npf-meteo-modal-source"></div>
                </div>
                <button type="button" class="npf-meteo-modal-close" aria-label="Fermer">×</button>
            </div>
            <div id="npf-meteo-modal-body" class="npf-meteo-modal-body"></div>
            <div class="npf-meteo-modal-pied">
                <div id="npf-meteo-modal-etat" class="npf-meteo-modal-etat" role="status"></div>
                <button type="button" id="npf-meteo-rafraichir" class="npf-meteo-rafraichir">Rafraîchir</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    const close = () => closeNpfMeteoPelic();
    modal.querySelector('.npf-meteo-modal-close').addEventListener('click', close);
    modal.querySelector('#npf-meteo-rafraichir').addEventListener('click', event => {
        event.preventDefault();
        npfMeteoForceRefresh();
    });
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    return modal;
}

function npfMeteoRenderModal() {
    const modal = document.getElementById('npf-meteo-pelic-modal');
    if (!modal || modal.hidden) return;
    const oaci = npfMeteoPelics.modalOaci;
    const nowMs = Date.now();
    const airport = typeof pelicanAirports !== 'undefined' && Array.isArray(pelicanAirports) ? pelicanAirports.find(a => a && a.oaci === oaci) : null;
    modal.querySelector('#npf-meteo-modal-title').textContent = `MÉTÉO ${oaci}${airport && airport.name ? ' — ' + airport.name : ''}`;
    const f = npfMeteoPelics.file;
    const p = getNpfMeteoPelic(oaci);
    const source = f ? `Fichier NAS de ${npfMeteoHhMm(f.genereA)}${npfMeteoPelics.fromMemory ? ' (dernier fichier gardé)' : ''}` : '';
    modal.querySelector('#npf-meteo-modal-source').textContent = source;
    const etat = modal.querySelector('#npf-meteo-modal-etat');
    if (etat) {
        if (etat.textContent !== npfMeteoPelics.forceMessage) etat.textContent = npfMeteoPelics.forceMessage;
        etat.classList.toggle('npf-meteo-etat-attention', npfMeteoPelics.forceMessageWarn);
        etat.classList.toggle('npf-meteo-etat-encours', !!npfMeteoPelics.forceRun);
    }
    const bouton = modal.querySelector('#npf-meteo-rafraichir');
    if (bouton) {
        const grise = nowMs < npfMeteoPelics.forceLockUntil || !!npfMeteoPelics.forceRun;
        bouton.disabled = grise;
        bouton.classList.toggle('npf-meteo-rafraichir-grise', grise);
        const reste = Math.max(0, Math.ceil((npfMeteoPelics.forceLockUntil - nowMs) / 1000));
        bouton.title = grise ? `Rafraîchir : de nouveau possible dans ${Math.floor(reste / 60)} min ${String(reste % 60).padStart(2, '0')} s` : 'Demander les derniers bulletins des 27 pélics';
    }
    const body = modal.querySelector('#npf-meteo-modal-body');
    if (!p) {
        body.innerHTML = '<div class="npf-meteo-vide">Pas de METAR ni de TAF du jour pour ce pélic.</div>';
        return;
    }
    let html = '';
    if (p.metar) {
        const age = npfMeteoMetarAgeMinutes(p.metar.texte, nowMs);
        const ageHtml = age === null ? '' : `<span class="npf-meteo-age ${age <= NPF_METEO_METAR_MAX_AGE_MIN ? 'npf-meteo-age-ok' : 'npf-meteo-age-vieux'}">${Math.round(age)} min</span>`;
        html += `<div class="npf-meteo-bloc npf-meteo-bloc-metar"><h4>METAR ${ageHtml}</h4><pre>${npfMeteoEscape(p.metar.texte)}</pre></div>`;
    }
    if (p.taf) {
        const expired = npfMeteoTafExpired(p.taf.texte, nowMs);
        html += `<div class="npf-meteo-bloc npf-meteo-bloc-taf"><h4>TAF${expired ? ' <span class="npf-meteo-taf-perime">TAF non à jour</span>' : ''}</h4><pre>${npfMeteoEscape(p.taf.texte)}</pre></div>`;
    }
    if (body.innerHTML !== html) body.innerHTML = html;
}

function openNpfMeteoPelic(oaci) {
    const modal = ensureNpfMeteoModal();
    npfMeteoPelics.modalOaci = String(oaci || '').trim().toUpperCase();
    if (!npfMeteoPelics.forceRun && Date.now() >= npfMeteoPelics.forceLockUntil) npfMeteoPelics.forceMessage = '';
    modal.hidden = false;
    document.body.classList.add('npf-meteo-modal-open');
    npfMeteoRenderModal();
    if (npfMeteoPelics.modalTimer) clearInterval(npfMeteoPelics.modalTimer);
    npfMeteoPelics.modalTimer = setInterval(npfMeteoRenderModal, 30000);   // âge du METAR tenu à jour
}

function closeNpfMeteoPelic() {
    const modal = document.getElementById('npf-meteo-pelic-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('npf-meteo-modal-open');
    if (npfMeteoPelics.modalTimer) { clearInterval(npfMeteoPelics.modalTimer); npfMeteoPelics.modalTimer = null; }
}

window.openNpfMeteoPelic = openNpfMeteoPelic;

function npfMeteoAfterChange() {
    npfMeteoRefreshOpenPopups();
    npfMeteoRenderModal();
}

/* ---------- Installation ---------- */
function installNpfMeteoPelics() {
    if (npfMeteoPelics.installed) return true;
    if (typeof map === 'undefined' || !map || !map.on) return false;
    npfMeteoPelics.installed = true;
    const stored = npfMeteoReadStore();
    if (stored) {
        npfMeteoPelics.file = stored;
        npfMeteoPelics.fromMemory = true;
        npfMeteoPelics.stored = 'oui';
    }
    map.on('popupopen', event => {
        try {
            const popup = event && event.popup;
            if (!popup || !popup._contentNode) return;
            if (npfMeteoInjectButton(popup._contentNode)) npfMeteoRelayoutPopup(popup);
            /* Contenu réécrit ensuite par l'app (setContent) : bouton remis. */
            if (!popup._npfMeteoContentHook) {
                popup._npfMeteoContentHook = true;
                popup.on('contentupdate', () => {
                    try { if (popup._contentNode && npfMeteoInjectButton(popup._contentNode)) npfMeteoRelayoutPopup(popup); } catch (_) {}
                });
            }
        } catch (_) {}
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        npfMeteoAfterChange();
        npfMeteoRefresh('retour au premier plan');
    });
    setInterval(() => {
        if (document.hidden || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
        npfMeteoRefresh('actualisation 10 min');
    }, NPF_METEO_PELICS_REFRESH_MS);
    npfMeteoRefresh('lancement');
    return true;
}

(function startNpfMeteoPelicsWhenMapReady() {
    let attempts = 0;
    const attempt = () => {
        attempts += 1;
        let ok = false;
        try { ok = installNpfMeteoPelics(); } catch (_) { ok = false; }
        if (!ok && attempts < 240) setTimeout(attempt, 500);
    };
    setTimeout(attempt, 700);
})();

/* Ligne du DIAG (src/010, SESSION COURANTE) et état lisible par les essais. */
function getNpfMeteoPelicsDiagLine() {
    const f = npfMeteoPelics.file;
    const today = npfMeteoFileOfToday();
    let avecMetar = 0, avecTaf = 0, avecBouton = 0;
    if (today && typeof pelicanAirports !== 'undefined' && Array.isArray(pelicanAirports)) {
        pelicanAirports.forEach(a => {
            const p = getNpfMeteoPelic(a && a.oaci);
            if (!p) return;
            avecBouton += 1;
            if (p.metar) avecMetar += 1;
            if (p.taf) avecTaf += 1;
        });
    }
    const fichier = f
        ? `${f.genereA.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' })} ${npfMeteoHhMm(f.genereA)}${today ? '' : ' (jour précédent : NON affiché)'}`
        : 'aucun';
    return 'MÉTÉO PÉLICS (v18.11) : fichier du NAS : ' + fichier
        + ' | gardé : ' + (f ? (npfMeteoPelics.fromMemory ? 'oui, affiché depuis la mémoire' : 'oui') : 'non') + ' (enregistré : ' + npfMeteoPelics.stored + ')'
        + ' | pélics avec bouton ' + avecBouton + ' (METAR ' + avecMetar + ', TAF ' + avecTaf + ')'
        + ' | téléchargements ' + npfMeteoPelics.downloads + ' | échecs ' + npfMeteoPelics.failures + (npfMeteoPelics.lastError ? ' (dernier : ' + npfMeteoPelics.lastError + ')' : '')
        + ' | dernière demande ' + (npfMeteoPelics.lastAttemptAt ? npfMeteoHhMm(npfMeteoPelics.lastAttemptAt) + ' (' + npfMeteoPelics.lastReason + ') ' + (npfMeteoPelics.lastResult || '…') : '—')
        + (npfMeteoPelics.nasCreneau ? ' | NAS : créneau ' + npfMeteoPelics.nasCreneau + ', ' + npfMeteoPelics.nasDemandes + ' pélic(s) demandé(s)' : '')
        + ' | Rafraîchir : ' + npfMeteoPelics.forceRequests + ' demande(s)' + (npfMeteoPelics.forceRun ? ' (en cours)' : '') + (npfMeteoPelics.forceMessage ? ' — ' + npfMeteoPelics.forceMessage : '');
}

function getNpfMeteoPelicsEtat() {
    const f = npfMeteoPelics.file;
    return {
        fichier: f ? f.genereA.toISOString() : null, duJour: !!npfMeteoFileOfToday(), fromMemory: npfMeteoPelics.fromMemory,
        downloads: npfMeteoPelics.downloads, failures: npfMeteoPelics.failures, lastError: npfMeteoPelics.lastError,
        followCount: npfMeteoPelics.followCount, forceRequests: npfMeteoPelics.forceRequests, forceEnCours: !!npfMeteoPelics.forceRun,
        forceMessage: npfMeteoPelics.forceMessage, forceLockMs: Math.max(0, npfMeteoPelics.forceLockUntil - Date.now()), diag: getNpfMeteoPelicsDiagLine()
    };
}
