/* ==========================================================================
   v17.91 — EXPORT CARNET DE VOL (NPF-Q400 TEST)
   v17.92 — format « carnet-vol-npf » version 2 (avion = « M » + numéro, copi,
   escales ordonnées), zone « Carnet de vol » dépliante, export seulement
   d'un vol clôturé, export dès le premier appui.
   --------------------------------------------------------------------------
   Envoie un vol de BLOC/FUEL vers la copie NAS du Carnet de vol
   (carnet-api/carnet.php, action vol-depot, protocole 2 : erreurs en
   HTTP 200 + {"erreur":…, "code":…}). Le même vol garde toujours le même id :
   un 2e export remplace le précédent côté carnet.
   - Mot de passe : réglage « Carnet de vol » (fenêtre Cartes), gardé
     seulement dans le stockage local de cet iPad, envoyé dans l'en-tête
     X-Carnet-Cle, jamais dans les exports ni le DIAG.
   - Pas de réseau / NAS injoignable : le vol attend et repart tout seul
     (ouverture de l'app, retour du réseau, retour au premier plan, toutes
     les 60 s). Jamais de fenêtre bloquante.
   - Heures du BLOC/FUEL = heure locale de l'iPad (saisie « maintenant » par
     getHours) ; converties ici en UTC. Le vol ne stockait pas sa date :
     elle est notée au moment où le bloc départ est saisi (stockage séparé,
     les vols BLOC/FUEL ne changent pas de format). v17.92 : de la même
     façon, la position GPS est notée quand l'heure d'une ligne est saisie
     (escale sans terrain reconnu).
   - v17.92, double appui (R41) : en v17.91 l'avion n'était enregistré qu'à
     la sortie du champ (change / blur) ; sur iPad, toucher le bouton ne fait
     pas sortir du champ avant le clic : le 1er appui lisait encore l'ancienne
     valeur (« il manque … ») et seul le 2e partait. Les champs sont
     maintenant enregistrés à chaque frappe, et relus juste avant l'export.
   ========================================================================== */

const NPF_CARNET_URL = 'https://grisonb.synology.me/carnet-api/carnet.php';
const NPF_CARNET_CLE_KEY = 'npfQ400TestCarnetCleV1';
const NPF_CARNET_VOLS_KEY = 'npfQ400TestCarnetVolsV1';
const NPF_CARNET_DELAI_MS = 15000;
const NPF_CARNET_RELANCE_MS = 60000;
const NPF_CARNET_TAILLE_MAX = 64 * 1024;
const NPF_CARNET_DUREE_MAX_MIN = 16 * 60;
const NPF_CARNET_FORMAT_VERSION = 2;
let npfCarnetVolsCache = null;
let npfCarnetEnvoiEnCours = false;

function lireNpfCarnetCle() {
    try { return String(localStorage.getItem(NPF_CARNET_CLE_KEY) || ''); } catch (_) { return ''; }
}

function lireNpfCarnetVols() {
    if (npfCarnetVolsCache) return npfCarnetVolsCache;
    let vols = {};
    try { vols = JSON.parse(localStorage.getItem(NPF_CARNET_VOLS_KEY) || '{}') || {}; } catch (_) { vols = {}; }
    if (typeof vols !== 'object' || Array.isArray(vols)) vols = {};
    npfCarnetVolsCache = vols;
    return vols;
}

function ecrireNpfCarnetVols() {
    try { localStorage.setItem(NPF_CARNET_VOLS_KEY, JSON.stringify(lireNpfCarnetVols())); } catch (_) {}
}

function getNpfCarnetEntree(flightId, creer = false) {
    const vols = lireNpfCarnetVols();
    if (!vols[flightId] && creer) vols[flightId] = {};
    return vols[flightId] || null;
}

/* « 7:05 » / « 07:05 » -> { hh, mm, texte } ; sinon null. */
function lireNpfCarnetHeure(valeur) {
    const m = String(valeur || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]), mm = Number(m[2]);
    if (hh > 23 || mm > 59) return null;
    return { hh, mm, texte: `${String(hh).padStart(2, '0')}:${m[2]}` };
}

function decalerNpfCarnetJour(date, jours) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + jours);   // jour local : passe les changements d'heure
    return d;
}

/* « M » + numéro (v17.92) : seul nom d'avion accepté ; « 073 » -> « M73 ». */
function normaliserNpfCarnetNomAvion(valeur) {
    const chiffres = String(valeur || '').toUpperCase().replace(/^M/, '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 4);
    return chiffres ? `M${chiffres}` : '';
}

/* Trigramme du copilote : 3 lettres majuscules (accents retirés). */
function normaliserNpfCarnetCopilote(valeur) {
    return String(valeur || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
}

/* Position GPS du moment, comme la détection du terrain du BLOC/FUEL (src/310, getCurrentGpsLatLngForAirportDetection). */
function lireNpfCarnetGps() {
    try {
        if (typeof userMarker !== 'undefined' && userMarker && userMarker.getLatLng) {
            const p = userMarker.getLatLng();
            if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) return { lat: p.lat, lon: p.lng };
        }
        if (typeof lastPosition !== 'undefined' && lastPosition) {
            const lat = Number.isFinite(lastPosition.lat) ? lastPosition.lat : lastPosition.latitude;
            const lon = Number.isFinite(lastPosition.lng) ? lastPosition.lng : lastPosition.longitude;
            if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
        }
    } catch (_) {}
    return null;
}

/*
 * Appelée par updateActiveFlightStateFromDom (src/310) à chaque sauvegarde du
 * vol actif. Ne note une date que si le bloc départ vient de CHANGER : un vol
 * saisi avant la v17.91 n'est jamais daté au hasard.
 */
function noterNpfCarnetBlocDepart(flightId, ancien, nouveau, maintenant = new Date()) {
    try {
        if (!flightId || String(ancien || '') === String(nouveau || '')) return;
        const heure = lireNpfCarnetHeure(nouveau);
        const entree = getNpfCarnetEntree(flightId, true);
        if (!heure) {
            delete entree.blocDepart;
            delete entree.blocDepartLe;
            ecrireNpfCarnetVols();
            return;
        }
        if (entree.blocDepart === heure.texte && entree.blocDepartLe) return;
        const ancre = entree.blocDepartLe ? new Date(entree.blocDepartLe) : null;
        const base = ancre && Number.isFinite(ancre.getTime()) ? ancre : maintenant;
        let instant = new Date(base.getFullYear(), base.getMonth(), base.getDate(), heure.hh, heure.mm, 0, 0);
        if (typeof isSimulationMode !== 'undefined' && isSimulationMode) entree.simulation = true;   // v17.96 (RUN v1.20)
        if (base === ancre) {
            /* correction d'une heure déjà datée : jour le plus proche de l'ancienne */
            if (instant - ancre > 12 * 3600e3) instant = decalerNpfCarnetJour(instant, -1);
            else if (ancre - instant > 12 * 3600e3) instant = decalerNpfCarnetJour(instant, 1);
        } else if (instant - maintenant > 3 * 3600e3) {
            /* ex. 23:50 saisi à 00:10 : c'était la veille */
            instant = decalerNpfCarnetJour(instant, -1);
        }
        entree.blocDepart = heure.texte;
        entree.blocDepartLe = instant.toISOString();
        ecrireNpfCarnetVols();
    } catch (_) {}
}

/*
 * v17.92 — appelée au même endroit : pour chaque heure de la colonne BLOC
 * Arrivée qui vient d'APPARAÎTRE (absente de l'état précédent), note la
 * position GPS du moment, c'est-à-dire au même moment que la détection du
 * terrain de la ligne (src/310, updateRowAirportOaci forceDetect). Sert
 * seulement quand aucun terrain n'est reconnu. Les heures déjà là avant
 * la v17.92 ne reçoivent jamais de position au hasard.
 */
function noterNpfCarnetLignes(flightId, ancienEtat, nouvelEtat) {
    try {
        if (!flightId) return;
        const heures = etat => (Array.isArray(etat?.calculator_table_data) ? etat.calculator_table_data : [])
            .map(l => lireNpfCarnetHeure(l && l.time)).filter(Boolean).map(h => h.texte);
        const avant = heures(ancienEtat);
        const nouvelles = heures(nouvelEtat).filter(h => !avant.includes(h));
        if (!nouvelles.length) return;
        const gps = lireNpfCarnetGps();
        const entree = getNpfCarnetEntree(flightId, true);
        if (typeof isSimulationMode !== 'undefined' && isSimulationMode) entree.simulation = true;   // v17.96 (RUN v1.20)
        entree.positions = entree.positions && typeof entree.positions === 'object' ? entree.positions : {};
        nouvelles.forEach(h => {
            /* sans GPS à la saisie : noté aussi, un terrain venu ensuite ne peut venir que de la redétection */
            entree.positions[h] = gps ? { lat: Math.round(gps.lat * 1e5) / 1e5, lon: Math.round(gps.lon * 1e5) / 1e5 } : { sansGps: true };
        });
        ecrireNpfCarnetVols();
    } catch (_) {}
}

const formatNpfCarnetHeureUtc = d => d.toISOString().slice(11, 16);
const formatNpfCarnetDateUtc = d => d.toISOString().slice(0, 10);
const formatNpfCarnetInstantUtc = d => `${d.toISOString().slice(0, 16)}Z`;

/* v17.96 (repris de NPF-Q400-RUN v1.20) — MODE SIMULATION : les feux sont enregistrés à l'heure RÉELLE de l'iPad, alors que les
 * heures BLOC d'un vol simulé ne correspondent pas à cette heure : le filtre « entre le bloc départ et le bloc arrivée » les
 * écartait tous. Un feu créé en simulation est donc noté avec le vol en cours (src/270 createSimulatedFireAtPoint) et exporté
 * avec lui, comme un feu de vrai vol (même format). Le vol est marqué « simulation » (bloc, heure ou feu saisi en simulation) :
 * champ "simulation": true dans le vol envoyé ; ABSENT pour un vrai vol (envoi identique à la v17.95). */
function noterNpfCarnetFeuSimulation(feu) {
    try {
        if (!activeFlightId || !feu) return;
        const flight = (Array.isArray(dailyFlights) ? dailyFlights : []).find(f => f && f.id === activeFlightId);
        if (!flight || flight.closed) return;
        const entree = getNpfCarnetEntree(activeFlightId, true);
        entree.simulation = true;
        entree.feuxSimulation = Array.isArray(entree.feuxSimulation) ? entree.feuxSimulation : [];
        entree.feuxSimulation.push({ savedAt: Number(feu.savedAt) || Date.now(), latitude_mairie: Number(feu.latitude_mairie), longitude_mairie: Number(feu.longitude_mairie),
            nom_standard: String(feu.nom_standard || ''), locality_match: !!feu.locality_match, locality_commune_name: String(feu.locality_commune_name || '') });
        ecrireNpfCarnetVols();
    } catch (_) {}
}

/* Feux de l'historique créés entre le bloc départ et le bloc arrivée (lecture brute, sans réécriture) ;
 * v17.96 (RUN v1.20) : + feux notés avec un vol simulé (sans doublon). */
function lireNpfCarnetFeux(debutMs, finMs, feuxSimulation = []) {
    let historique = [];
    try { historique = JSON.parse(localStorage.getItem(FIRE_HISTORY_STORAGE_KEY) || '[]'); } catch (_) { historique = []; }
    if (!Array.isArray(historique)) historique = [];
    const dansLeVol = historique.filter(f => f && Number.isFinite(Number(f.savedAt)) && Number(f.savedAt) >= debutMs && Number(f.savedAt) <= finMs);
    const cle = f => `${Number(f.savedAt)}|${Number(f.latitude_mairie).toFixed(5)}|${Number(f.longitude_mairie).toFixed(5)}`;
    const vus = new Set(dansLeVol.map(cle));
    (Array.isArray(feuxSimulation) ? feuxSimulation : []).forEach(f => { if (f && !vus.has(cle(f))) { vus.add(cle(f)); dansLeVol.push(f); } });
    return dansLeVol
        .filter(f => Number.isFinite(Number(f.latitude_mairie)) && Number.isFinite(Number(f.longitude_mairie)))
        .sort((a, b) => Number(a.savedAt) - Number(b.savedAt))
        .map(f => {
            const feu = {
                heure: formatNpfCarnetHeureUtc(new Date(Number(f.savedAt))),
                lat: Math.round(Number(f.latitude_mairie) * 1e5) / 1e5,
                lon: Math.round(Number(f.longitude_mairie) * 1e5) / 1e5
            };
            const nom = String(f.nom_standard || '').trim();
            if (f.locality_match) {
                const commune = String(f.locality_commune_name || '').trim();
                if (commune) feu.commune = commune;
                if (nom) feu.nom = nom;
            } else if (nom && !/^Feu (manuel|SIM)$/i.test(nom)) {
                feu.commune = nom;
            }
            return feu;
        });
}

/*
 * v17.92 — escales : toutes les lignes de la colonne BLOC Arrivée SAUF la
 * dernière (l'arrivée finale), dans l'ordre du vol ; seules les lignes
 * CONSÉCUTIVES sur le même terrain (même OACI) sont regroupées. Terrain =
 * OACI détecté par NPF-Q400 (GPS à 2 Nm au plus) : nom et position du
 * terrain ; sans terrain : position GPS notée à la saisie de l'heure, si connue.
 */
const NPF_CARNET_RAYON_TERRAIN_NM = 2;   // même distance que la détection du BLOC/FUEL (src/310, AIRPORT_DETECTION_RADIUS_NM)

/*
 * Le BLOC/FUEL redétecte, à chaque position GPS, le terrain des lignes restées
 * sans terrain (src/270 -> refreshCalculatorAirportContext) : une ligne saisie
 * loin de tout terrain peut recevoir plus tard le terrain d'un autre passage.
 * Pour le carnet, le terrain d'une escale doit être à 2 Nm au plus de la
 * position notée à la saisie de son heure (si elle est connue) ; sinon
 * l'escale part sans code, avec cette position.
 */
function terrainNpfCarnetConfirme(terrain, position) {
    if (!position) return true;                 // heure saisie avant la v17.92 : rien de noté, terrain gardé
    if (position.sansGps) return false;         // pas de GPS à la saisie : terrain venu plus tard, pas envoyé
    if (!terrain || typeof calculateDistanceInNm !== 'function') return true;
    const d = calculateDistanceInNm(Number(position.lat), Number(position.lon), Number(terrain.lat), Number(terrain.lon));
    return !Number.isFinite(d) || d <= NPF_CARNET_RAYON_TERRAIN_NM + 0.05;
}

function construireNpfCarnetEscales(lignes, positions) {
    const escales = [];
    lignes.forEach(l => {
        const position = positions && positions[l.heure.texte];
        if (l.oaci) {
            let terrain = null;
            try { terrain = typeof getAirportByOaci === 'function' ? getAirportByOaci(l.oaci) : null; } catch (_) { terrain = null; }
            if (!terrainNpfCarnetConfirme(terrain, position)) l = { ...l, oaci: '' };
        }
        const derniere = escales[escales.length - 1];
        if (l.oaci && derniere && derniere.oaci === l.oaci) {
            derniere.atterrissages.push(formatNpfCarnetInstantUtc(l.instant));
            return;
        }
        const escale = {};
        if (l.oaci) {
            escale.oaci = l.oaci;
            let terrain = null;
            try { terrain = typeof getAirportByOaci === 'function' ? getAirportByOaci(l.oaci) : null; } catch (_) { terrain = null; }
            if (terrain && String(terrain.name || '').trim()) escale.nom = String(terrain.name).trim();
            if (terrain && Number.isFinite(Number(terrain.lat)) && Number.isFinite(Number(terrain.lon))) {
                escale.lat = Math.round(Number(terrain.lat) * 1e5) / 1e5;
                escale.lon = Math.round(Number(terrain.lon) * 1e5) / 1e5;
            }
        } else if (position && Number.isFinite(Number(position.lat)) && Number.isFinite(Number(position.lon))) {
            escale.lat = Number(position.lat);
            escale.lon = Number(position.lon);
        }
        escale.atterrissages = [formatNpfCarnetInstantUtc(l.instant)];
        escales.push(escale);
    });
    return escales;
}

/* Vol au format « carnet-vol-npf » v2, ou { manque: [...] }. */
function construireNpfCarnetVol(flightId, exporteLe = new Date()) {
    const flight = (Array.isArray(dailyFlights) ? dailyFlights : []).find(f => f && f.id === flightId);
    if (!flight) return { manque: ['vol introuvable'] };
    const state = flight.state || {};
    const entree = getNpfCarnetEntree(flightId) || {};
    const manque = [];

    const depart = lireNpfCarnetHeure(state['bloc-depart']);
    let departLe = null;
    if (!depart) manque.push('bloc départ');
    else if (!entree.blocDepartLe || entree.blocDepart !== depart.texte) manque.push('date du vol (bloc départ saisi avant la v17.91 : efface-le et ressaisis-le)');
    else departLe = new Date(entree.blocDepartLe);

    const lignes = (Array.isArray(state.calculator_table_data) ? state.calculator_table_data : [])
        .map(l => ({ heure: lireNpfCarnetHeure(l && l.time), oaci: String((l && l.oaci) || '').trim().toUpperCase() }))
        .filter(l => l.heure);
    if (!lignes.length) manque.push('bloc arrivée (aucune heure dans la colonne BLOC Arrivée)');

    const nomAvion = normaliserNpfCarnetNomAvion(entree.nomAvion);
    if (!nomAvion) manque.push('avion (numéro après le « M »)');
    const copilote = normaliserNpfCarnetCopilote(entree.copilote);
    if (copilote && copilote.length !== 3) manque.push('trigramme du copi complet (3 lettres, ou vide)');

    let arriveeLe = null;
    if (departLe && Number.isFinite(departLe.getTime()) && lignes.length) {
        /* heures locales successives : une heure plus petite que la précédente = lendemain */
        let precedent = departLe;
        lignes.forEach(l => {
            let instant = new Date(precedent.getFullYear(), precedent.getMonth(), precedent.getDate(), l.heure.hh, l.heure.mm, 0, 0);
            if (instant < precedent) instant = decalerNpfCarnetJour(instant, 1);
            l.instant = instant;
            precedent = instant;
        });
        arriveeLe = precedent;
        if ((arriveeLe - departLe) / 60000 > NPF_CARNET_DUREE_MAX_MIN) {
            manque.push('heures du BLOC/FUEL cohérentes (plus de 16 h entre le bloc départ et la dernière heure : vérifie l\'ordre des heures)');
            arriveeLe = null;
        }
    }
    if (manque.length) return { manque };

    const vol = {
        format: 'carnet-vol-npf',
        version: NPF_CARNET_FORMAT_VERSION,
        id: flight.id,
        exporteLe: exporteLe.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        date: formatNpfCarnetDateUtc(departLe),
        blocDepart: formatNpfCarnetHeureUtc(departLe),
        blocArrivee: formatNpfCarnetHeureUtc(arriveeLe),
        blocArriveeJ1: formatNpfCarnetDateUtc(arriveeLe) !== formatNpfCarnetDateUtc(departLe),
        nomAvion
    };
    if (copilote) vol.copilote = copilote;
    const oaciDepart = String(state['bloc-depart-oaci'] || '').trim().toUpperCase();
    if (oaciDepart) vol.depart = oaciDepart;
    /*
     * v17.92 — arrivée : même vérification que les escales. Le terrain n'est
     * envoyé que s'il est à 2 Nm au plus de la position notée à la saisie de la
     * dernière heure BLOC Arrivée ; sinon l'arrivée part sans code, avec cette
     * position si elle existe (arriveePosition). Le BLOC/FUEL n'est pas modifié.
     */
    const derniere = lignes[lignes.length - 1];
    const positionArrivee = entree.positions && entree.positions[derniere.heure.texte];
    let oaciArrivee = derniere.oaci;
    if (oaciArrivee) {
        let terrain = null;
        try { terrain = typeof getAirportByOaci === 'function' ? getAirportByOaci(oaciArrivee) : null; } catch (_) { terrain = null; }
        if (!terrainNpfCarnetConfirme(terrain, positionArrivee)) oaciArrivee = '';
    }
    if (oaciArrivee) vol.arrivee = oaciArrivee;
    else if (positionArrivee && Number.isFinite(Number(positionArrivee.lat)) && Number.isFinite(Number(positionArrivee.lon))) {
        vol.arriveePosition = { lat: Number(positionArrivee.lat), lon: Number(positionArrivee.lon) };
    }
    vol.escales = construireNpfCarnetEscales(lignes.slice(0, -1), entree.positions);
    vol.feux = lireNpfCarnetFeux(departLe.getTime(), arriveeLe.getTime(), entree.feuxSimulation);
    if (entree.simulation === true) vol.simulation = true;   // v17.96 (RUN v1.20) — vrai vol : champ absent

    const taille = new TextEncoder().encode(JSON.stringify(vol)).length;
    if (taille > NPF_CARNET_TAILLE_MAX) return { manque: [`vol plus petit que 64 Ko (${Math.round(taille / 1024)} Ko)`] };
    return { vol };
}

/* Empreinte du contenu (sans la date d'export) : sert à voir si le vol a changé depuis l'envoi. */
const empreinteNpfCarnetVol = vol => JSON.stringify({ ...vol, exporteLe: '' });

function messageNpfCarnetErreur(erreur, detail, message) {
    const e = String(erreur || '');
    if (e === 'mot-de-passe') return 'Mot de passe du Carnet de vol refusé par le NAS : corrige-le dans les réglages (Cartes).';
    if (e === 'origine') return 'Le NAS refuse cette app (origine non autorisée).';
    if (e === 'action' || e === 'methode') return 'Le NAS ne connaît pas encore l\'envoi de vol (carnet.php à mettre à jour).';
    if (e === 'trop-gros') return 'Vol trop gros pour le NAS.';
    if (e === 'stockage') return 'Le NAS ne peut pas enregistrer pour l\'instant (stockage).';
    const precision = [detail, message].map(v => String(v || '').trim()).filter(Boolean).join(' — ');
    return `Le NAS refuse le vol : ${e || 'erreur inconnue'}${precision ? ` (${precision.slice(0, 160)})` : ''}`;
}

/* Un dépôt : { etat: 'envoye' | 'attente' | 'erreur', message, code }. */
async function deposerNpfCarnetVol(vol, cle, action = 'vol-depot') {
    if (navigator.onLine === false) return { etat: 'attente', message: 'Pas de réseau : le vol partira tout seul au retour du réseau.' };
    const controle = new AbortController();
    const minuterie = setTimeout(() => controle.abort(), NPF_CARNET_DELAI_MS);
    let reponse = null;
    try {
        reponse = await fetch(`${NPF_CARNET_URL}?action=${action}&v=2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Carnet-Cle': cle },
            body: vol ? JSON.stringify(vol) : '{}',
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal: controle.signal
        });
    } catch (_) {
        clearTimeout(minuterie);
        return { etat: 'attente', message: 'NAS injoignable : le vol partira tout seul plus tard.' };
    }
    let donnees = null;
    try { donnees = await reponse.json(); } catch (_) { donnees = null; }
    clearTimeout(minuterie);
    if (donnees && donnees.ok === true) return { etat: 'envoye', message: '' };
    if (donnees && donnees.erreur) {
        const code = Number(donnees.code) || reponse.status;
        const message = messageNpfCarnetErreur(donnees.erreur, donnees.detail, donnees.message);
        if (code >= 500) return { etat: 'attente', message: `${message} Nouvel essai plus tard.`, code };
        return { etat: 'erreur', message, code, erreur: String(donnees.erreur) };
    }
    return { etat: 'attente', message: `Réponse illisible du NAS (HTTP ${reponse.status}) : nouvel essai plus tard.` };
}

async function envoyerNpfCarnetEntree(flightId) {
    const entree = getNpfCarnetEntree(flightId);
    const cle = lireNpfCarnetCle();
    if (!entree || !entree.vol || !cle) return;
    entree.essaiLe = new Date().toISOString();
    const resultat = await deposerNpfCarnetVol(entree.vol, cle);
    const courante = getNpfCarnetEntree(flightId);
    if (!courante || courante.vol !== entree.vol) return;   // réexporté pendant l'envoi : le nouveau passe ensuite
    courante.etat = resultat.etat;
    courante.message = resultat.message;
    courante.erreur = resultat.erreur || '';
    if (resultat.etat === 'envoye') {
        courante.envoyeLe = new Date().toISOString();
        courante.empreinteEnvoyee = empreinteNpfCarnetVol(courante.vol);
    }
    ecrireNpfCarnetVols();
}

/* Envoie les vols en attente, un par un. Sans effet hors ligne ou sans mot de passe. */
async function envoyerNpfCarnetAttente() {
    if (npfCarnetEnvoiEnCours || navigator.onLine === false || !lireNpfCarnetCle()) return;
    const ids = Object.keys(lireNpfCarnetVols()).filter(id => {
        const e = lireNpfCarnetVols()[id];
        return e && e.etat === 'attente' && e.vol;
    });
    if (!ids.length) return;
    npfCarnetEnvoiEnCours = true;
    rafraichirNpfCarnetBouton();
    try {
        for (const id of ids) await envoyerNpfCarnetEntree(id);
    } finally {
        npfCarnetEnvoiEnCours = false;
        rafraichirNpfCarnetBouton();
    }
}

/* Vol sans rien de saisi (le nouveau vol créé par « Clôturer ») ? */
function estNpfCarnetVolVide(flight) {
    const state = flight?.state || {};
    if (lireNpfCarnetHeure(state['bloc-depart'])) return false;
    return !(Array.isArray(state.calculator_table_data) ? state.calculator_table_data : []).some(l => lireNpfCarnetHeure(l && l.time));
}

/*
 * v17.92 (R43) — vol exporté : le vol affiché s'il est clôturé ; si le vol
 * affiché est le nouveau vol vide créé par « Clôturer », le vol clôturé juste
 * avant (sinon il faudrait le rechoisir dans la liste). Vol en cours avec des
 * heures : « Clôture le vol d'abord ».
 */
function getNpfCarnetVolCible() {
    const liste = Array.isArray(dailyFlights) ? dailyFlights : [];
    const index = liste.findIndex(f => f && f.id === activeFlightId);
    if (index < 0) return null;
    const actif = liste[index];
    if (actif.closed) return { flight: actif, precedent: false };
    if (index > 0 && estNpfCarnetVolVide(actif) && liste[index - 1]?.closed) return { flight: liste[index - 1], precedent: true };
    return { flight: null, precedent: false };
}

/* Relit les champs de la zone (au cas où le dernier caractère n'a pas encore été enregistré). */
function lireNpfCarnetChamps() {
    if (!activeFlightId) return;
    const champNom = document.getElementById('carnet-vol-nom');
    const champCopi = document.getElementById('carnet-vol-copi');
    if (!champNom && !champCopi) return;
    const entree = getNpfCarnetEntree(activeFlightId, true);
    entree.avionVu = true;
    if (champNom) entree.nomAvion = normaliserNpfCarnetNomAvion(champNom.value);
    if (champCopi) entree.copilote = normaliserNpfCarnetCopilote(champCopi.value);
    ecrireNpfCarnetVols();
}

async function exporterNpfCarnetVolActif() {
    const etat = document.getElementById('carnet-vol-etat');
    if (!activeFlightId || npfCarnetEnvoiEnCours) return;
    lireNpfCarnetChamps();
    const cible = getNpfCarnetVolCible();
    if (!lireNpfCarnetCle() || !cible || !cible.flight) {
        rafraichirNpfCarnetBouton();
        return;
    }
    const flightId = cible.flight.id;
    const { vol, manque } = construireNpfCarnetVol(flightId);
    if (!vol) {
        if (etat) {
            etat.textContent = `${cible.precedent ? `Vol n°${cible.flight.number} pas envoyé` : 'Pas envoyé'}, il manque : ${manque.join(' ; ')}.`;
            etat.className = 'carnet-vol-etat carnet-vol-etat-erreur';
        }
        return;
    }
    const entree = getNpfCarnetEntree(flightId, true);
    entree.vol = vol;
    entree.etat = 'attente';
    entree.message = navigator.onLine === false ? 'Pas de réseau : le vol partira tout seul au retour du réseau.' : '';
    entree.erreur = '';
    ecrireNpfCarnetVols();
    await envoyerNpfCarnetAttente();
    rafraichirNpfCarnetBouton();
}

/* Un nouveau vol reprend le « M » et le copi du vol précédent (une seule fois ; toujours modifiables, effaçables).
   v17.93 (R53) : le copi est repris comme l'avion (en v17.92 il restait vide). */
function preremplirNpfCarnetAvion(flightId) {
    const entree = getNpfCarnetEntree(flightId, true);
    if (entree.avionVu) return entree;
    const liste = Array.isArray(dailyFlights) ? dailyFlights : [];
    const index = liste.findIndex(f => f && f.id === flightId);
    entree.copilote = '';
    for (let i = index - 1; i >= 0; i -= 1) {
        const precedente = getNpfCarnetEntree(liste[i].id);
        const nom = normaliserNpfCarnetNomAvion(precedente?.nomAvion);
        const copi = normaliserNpfCarnetCopilote(precedente?.copilote);
        if (nom || copi) {
            entree.nomAvion = nom;
            entree.copilote = copi.length === 3 ? copi : '';
            break;
        }
    }
    entree.avionVu = true;
    ecrireNpfCarnetVols();
    return entree;
}

function rafraichirNpfCarnetBouton() {
    try {
        const bouton = document.getElementById('export-carnet-vol-btn');
        const etat = document.getElementById('carnet-vol-etat');
        const champNom = document.getElementById('carnet-vol-nom');
        const champCopi = document.getElementById('carnet-vol-copi');
        const resume = document.getElementById('carnet-vol-resume');
        if (!bouton || !etat || !activeFlightId) return;
        const entreeActive = preremplirNpfCarnetAvion(activeFlightId);
        const nomActif = normaliserNpfCarnetNomAvion(entreeActive.nomAvion);
        if (champNom && document.activeElement !== champNom) champNom.value = nomActif.replace(/^M/, '');
        if (champCopi && document.activeElement !== champCopi) champCopi.value = normaliserNpfCarnetCopilote(entreeActive.copilote);

        const cible = getNpfCarnetVolCible();
        const entree = cible && cible.flight ? (getNpfCarnetEntree(cible.flight.id) || {}) : {};
        const prefixe = cible && cible.precedent ? `Vol n°${cible.flight.number} : ` : '';
        let libelle = cible && cible.precedent ? `Export Carnet de Vol (vol n°${cible.flight.number})` : 'Export Carnet de Vol';
        let texte = '', classe = '', court = '';
        if (!cible || !cible.flight) {
            libelle = 'Clôture le vol d\'abord';
            texte = 'L\'export part quand le vol est clôturé (bouton « Clôturer »). Avion et copi peuvent être saisis dès maintenant.';
            classe = 'attente';
            court = 'vol en cours';
        } else if (!lireNpfCarnetCle()) {
            texte = 'Saisis le mot de passe du Carnet de vol dans les réglages (bouton Cartes, section « Carnet de vol »).';
            classe = 'attention';
            court = 'mot de passe à saisir';
        } else if (npfCarnetEnvoiEnCours && entree.etat === 'attente') {
            libelle = 'Envoi…';
            court = 'envoi…';
        } else if (entree.etat === 'envoye') {
            libelle = 'Envoyé au carnet ✓';
            const actuel = construireNpfCarnetVol(cible.flight.id).vol;
            const heure = entree.envoyeLe ? new Date(entree.envoyeLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
            const modifie = !!(actuel && entree.empreinteEnvoyee && empreinteNpfCarnetVol(actuel) !== entree.empreinteEnvoyee);
            texte = modifie
                ? `${prefixe}vol modifié depuis l'envoi : touche le bouton pour remplacer la version du carnet.`
                : `${prefixe}envoyé au carnet${heure ? ` à ${heure}` : ''}. Un nouvel export remplace celui-ci.`;
            classe = modifie ? 'attention' : 'ok';
            court = modifie ? 'modifié depuis l\'envoi' : 'envoyé ✓';
        } else if (entree.etat === 'attente') {
            libelle = 'En attente d\'envoi';
            texte = prefixe + (entree.message || 'Le vol partira tout seul dès que le NAS répond.');
            classe = 'attente';
            court = 'en attente d\'envoi';
        } else if (entree.etat === 'erreur') {
            libelle = 'Export Carnet de Vol ⚠';
            texte = prefixe + (entree.message || 'Erreur du NAS.');
            classe = 'erreur';
            court = 'erreur';
        } else {
            texte = cible.precedent ? `Vol n°${cible.flight.number} clôturé, prêt à envoyer.` : 'Vol clôturé, prêt à envoyer.';
            court = 'prêt à envoyer';
        }
        if (cible && cible.precedent && court) court = `vol n°${cible.flight.number} ${court}`;
        bouton.textContent = libelle;
        bouton.disabled = npfCarnetEnvoiEnCours;
        bouton.dataset.etat = cible && cible.flight ? (entree.etat || '') : 'cloturer';
        etat.textContent = texte;
        etat.className = `carnet-vol-etat${classe ? ` carnet-vol-etat-${classe}` : ''}`;
        if (resume) {
            const copi = normaliserNpfCarnetCopilote(entreeActive.copilote);
            resume.textContent = [nomActif || 'M ?', copi, court].filter(Boolean).join(' · ');
            resume.className = `carnet-vol-resume${classe ? ` carnet-vol-etat-${classe}` : ''}`;
        }
    } catch (_) {}
}

function afficherNpfCarnetCleEtat(texte, classe = '') {
    const zone = document.getElementById('carnet-vol-cle-etat');
    if (!zone) return;
    zone.textContent = texte;
    zone.className = `carnet-vol-cle-etat${classe ? ` carnet-vol-etat-${classe}` : ''}`;
}

function afficherNpfCarnetCleEnregistree() {
    afficherNpfCarnetCleEtat(lireNpfCarnetCle() ? 'Mot de passe enregistré sur cet iPad.' : 'Aucun mot de passe enregistré.');
}

/* Après un nouveau mot de passe : les vols refusés pour mot de passe repartent. */
function relancerNpfCarnetApresCle() {
    const vols = lireNpfCarnetVols();
    Object.keys(vols).forEach(id => {
        const e = vols[id];
        if (e && e.etat === 'erreur' && e.erreur === 'mot-de-passe' && e.vol) {
            e.etat = 'attente';
            e.message = '';
            e.erreur = '';
        }
    });
    ecrireNpfCarnetVols();
    rafraichirNpfCarnetBouton();
    envoyerNpfCarnetAttente();
}

function brancherNpfCarnetVol() {
    const bouton = document.getElementById('export-carnet-vol-btn');
    if (bouton) bouton.addEventListener('click', event => {
        event.preventDefault();
        exporterNpfCarnetVolActif();
    });

    const champNom = document.getElementById('carnet-vol-nom');
    const champCopi = document.getElementById('carnet-vol-copi');
    /* R41 : enregistré à chaque frappe (et pas seulement à la sortie du champ). */
    const noterChamps = () => {
        if (champNom) {
            const chiffres = normaliserNpfCarnetNomAvion(champNom.value).replace(/^M/, '');
            if (champNom.value !== chiffres) champNom.value = chiffres;
        }
        if (champCopi) {
            const tri = normaliserNpfCarnetCopilote(champCopi.value);
            if (champCopi.value !== tri) champCopi.value = tri;
        }
        lireNpfCarnetChamps();
        rafraichirNpfCarnetBouton();
    };
    [champNom, champCopi].forEach(champ => {
        if (!champ) return;
        champ.addEventListener('input', noterChamps);
        champ.addEventListener('change', noterChamps);
        champ.addEventListener('blur', noterChamps);
    });

    const champCle = document.getElementById('carnet-vol-cle-input');
    document.getElementById('carnet-vol-cle-enregistrer')?.addEventListener('click', () => {
        const valeur = String(champCle?.value || '');
        if (!valeur.trim()) {
            afficherNpfCarnetCleEtat('Tape d\'abord le mot de passe.', 'erreur');
            return;
        }
        try { localStorage.setItem(NPF_CARNET_CLE_KEY, valeur); } catch (_) {
            afficherNpfCarnetCleEtat('Impossible d\'enregistrer sur cet iPad (stockage plein ?).', 'erreur');
            return;
        }
        if (champCle) champCle.value = '';
        afficherNpfCarnetCleEnregistree();
        relancerNpfCarnetApresCle();
    });
    document.getElementById('carnet-vol-cle-tester')?.addEventListener('click', async () => {
        const cle = String(champCle?.value || '') || lireNpfCarnetCle();
        if (!cle) {
            afficherNpfCarnetCleEtat('Tape ou enregistre d\'abord le mot de passe.', 'erreur');
            return;
        }
        afficherNpfCarnetCleEtat('Test en cours…');
        const resultat = await deposerNpfCarnetVol(null, cle, 'test');
        if (resultat.etat === 'envoye') afficherNpfCarnetCleEtat(`Mot de passe accepté par le NAS ✓${champCle?.value ? ' (pas encore enregistré : touche « Enregistrer »)' : ''}`, 'ok');
        else afficherNpfCarnetCleEtat(resultat.etat === 'attente' ? 'NAS injoignable : réessaie quand le réseau est là.' : resultat.message, 'erreur');
    });
    document.getElementById('carnet-vol-cle-oublier')?.addEventListener('click', () => {
        try { localStorage.removeItem(NPF_CARNET_CLE_KEY); } catch (_) {}
        if (champCle) champCle.value = '';
        afficherNpfCarnetCleEnregistree();
        rafraichirNpfCarnetBouton();
    });
    afficherNpfCarnetCleEnregistree();

    /* Nettoyage : entrées de vols supprimés, sauf celles qui attendent encore leur envoi. */
    try {
        const ids = new Set((Array.isArray(dailyFlights) ? dailyFlights : []).map(f => f && f.id));
        const vols = lireNpfCarnetVols();
        if (ids.size) Object.keys(vols).forEach(id => { if (!ids.has(id) && vols[id]?.etat !== 'attente') delete vols[id]; });
        ecrireNpfCarnetVols();
    } catch (_) {}

    window.addEventListener('online', () => envoyerNpfCarnetAttente());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') envoyerNpfCarnetAttente(); });
    setInterval(() => envoyerNpfCarnetAttente(), NPF_CARNET_RELANCE_MS);
    setTimeout(() => envoyerNpfCarnetAttente(), 4000);
    rafraichirNpfCarnetBouton();
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('export-carnet-vol-btn')) brancherNpfCarnetVol();
});
