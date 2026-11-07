/* ==========================================================================
   v17.91 — EXPORT CARNET DE VOL (NPF-Q400 TEST)
   --------------------------------------------------------------------------
   Envoie le vol choisi dans BLOC/FUEL vers la copie NAS du Carnet de vol
   (carnet-api/carnet.php v3, action vol-depot, protocole 2 : erreurs en
   HTTP 200 + {"erreur":…, "code":…}). Format commun « carnet-vol-npf »,
   version 1. Le même vol garde toujours le même id : un 2e export remplace
   le précédent côté carnet.
   - Mot de passe : réglage « Carnet de vol » (fenêtre Cartes), gardé
     seulement dans le stockage local de cet iPad, envoyé dans l'en-tête
     X-Carnet-Cle, jamais dans les exports ni le DIAG.
   - Pas de réseau / NAS injoignable : le vol attend et repart tout seul
     (ouverture de l'app, retour du réseau, retour au premier plan, toutes
     les 60 s). Jamais de fenêtre bloquante.
   - Heures du BLOC/FUEL = heure locale de l'iPad (saisie « maintenant » par
     getHours) ; converties ici en UTC. Le vol ne stockait pas sa date :
     elle est notée au moment où le bloc départ est saisi (stockage séparé,
     les vols BLOC/FUEL ne changent pas de format).
   ========================================================================== */

const NPF_CARNET_URL = 'https://grisonb.synology.me/carnet-api/carnet.php';
const NPF_CARNET_CLE_KEY = 'npfQ400TestCarnetCleV1';
const NPF_CARNET_VOLS_KEY = 'npfQ400TestCarnetVolsV1';
const NPF_CARNET_NOMS_KEY = 'npfQ400TestCarnetNomsAvionV1';
const NPF_CARNET_DELAI_MS = 15000;
const NPF_CARNET_RELANCE_MS = 60000;
const NPF_CARNET_TAILLE_MAX = 64 * 1024;
const NPF_CARNET_DUREE_MAX_MIN = 16 * 60;
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

const formatNpfCarnetHeureUtc = d => d.toISOString().slice(11, 16);
const formatNpfCarnetDateUtc = d => d.toISOString().slice(0, 10);

/* Feux de l'historique créés entre le bloc départ et le bloc arrivée (lecture brute, sans réécriture). */
function lireNpfCarnetFeux(debutMs, finMs) {
    let historique = [];
    try { historique = JSON.parse(localStorage.getItem(FIRE_HISTORY_STORAGE_KEY) || '[]'); } catch (_) { historique = []; }
    if (!Array.isArray(historique)) return [];
    return historique
        .filter(f => f && Number.isFinite(Number(f.savedAt)) && Number(f.savedAt) >= debutMs && Number(f.savedAt) <= finMs
            && Number.isFinite(Number(f.latitude_mairie)) && Number.isFinite(Number(f.longitude_mairie)))
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

/* Vol au format « carnet-vol-npf » v1, ou { manque: [...] }. */
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

    const immat = String(entree.immat || '').trim().toUpperCase();
    if (!immat) manque.push('immatriculation (champ « Immat. » sous la barre du vol)');

    let arriveeLe = null;
    if (departLe && Number.isFinite(departLe.getTime()) && lignes.length) {
        /* heures locales successives : une heure plus petite que la précédente = lendemain */
        let precedent = departLe;
        lignes.forEach(l => {
            let instant = new Date(precedent.getFullYear(), precedent.getMonth(), precedent.getDate(), l.heure.hh, l.heure.mm, 0, 0);
            if (instant < precedent) instant = decalerNpfCarnetJour(instant, 1);
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
        version: 1,
        id: flight.id,
        exporteLe: exporteLe.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        date: formatNpfCarnetDateUtc(departLe),
        blocDepart: formatNpfCarnetHeureUtc(departLe),
        blocArrivee: formatNpfCarnetHeureUtc(arriveeLe),
        blocArriveeJ1: formatNpfCarnetDateUtc(arriveeLe) !== formatNpfCarnetDateUtc(departLe),
        immat
    };
    const nomAvion = String(entree.nomAvion || '').trim().toUpperCase();
    if (nomAvion) vol.nomAvion = nomAvion;
    const oaciDepart = String(state['bloc-depart-oaci'] || '').trim().toUpperCase();
    if (oaciDepart) vol.depart = oaciDepart;
    const oaciArrivee = lignes[lignes.length - 1].oaci;
    if (oaciArrivee) vol.arrivee = oaciArrivee;
    vol.escales = lignes.slice(0, -1).map(l => l.oaci).filter((o, i, t) => o && o !== t[i - 1]);
    vol.feux = lireNpfCarnetFeux(departLe.getTime(), arriveeLe.getTime());

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
    if (e === 'action' || e === 'methode') return 'Le NAS ne connaît pas encore l\'envoi de vol (carnet.php v3 à installer).';
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

async function exporterNpfCarnetVolActif() {
    const flightId = activeFlightId;
    const etat = document.getElementById('carnet-vol-etat');
    if (!flightId || npfCarnetEnvoiEnCours) return;
    if (!lireNpfCarnetCle()) {
        rafraichirNpfCarnetBouton();
        return;
    }
    const { vol, manque } = construireNpfCarnetVol(flightId);
    if (!vol) {
        if (etat) {
            etat.textContent = `Pas envoyé, il manque : ${manque.join(' ; ')}.`;
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

/* Avion du vol : saisi à la main ; un nouveau vol reprend celui du vol précédent (une seule fois). */
function preremplirNpfCarnetAvion(flightId) {
    const entree = getNpfCarnetEntree(flightId, true);
    if (entree.avionVu) return entree;
    const liste = Array.isArray(dailyFlights) ? dailyFlights : [];
    const index = liste.findIndex(f => f && f.id === flightId);
    for (let i = index - 1; i >= 0; i -= 1) {
        const precedente = getNpfCarnetEntree(liste[i].id);
        if (precedente && precedente.immat) {
            entree.immat = precedente.immat;
            entree.nomAvion = precedente.nomAvion || '';
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
        const champImmat = document.getElementById('carnet-vol-immat');
        const champNom = document.getElementById('carnet-vol-nom');
        if (!bouton || !etat || !activeFlightId) return;
        const entree = preremplirNpfCarnetAvion(activeFlightId);
        if (champImmat && document.activeElement !== champImmat) champImmat.value = entree.immat || '';
        if (champNom && document.activeElement !== champNom) champNom.value = entree.nomAvion || '';

        let libelle = 'Export Carnet de Vol', texte = '', classe = '';
        if (!lireNpfCarnetCle()) {
            texte = 'Saisis le mot de passe du Carnet de vol dans les réglages (bouton Cartes, section « Carnet de vol »).';
            classe = 'attention';
        } else if (npfCarnetEnvoiEnCours && entree.etat === 'attente') {
            libelle = 'Envoi…';
        } else if (entree.etat === 'envoye') {
            libelle = 'Envoyé au carnet ✓';
            const actuel = construireNpfCarnetVol(activeFlightId).vol;
            const heure = entree.envoyeLe ? new Date(entree.envoyeLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
            texte = actuel && entree.empreinteEnvoyee && empreinteNpfCarnetVol(actuel) !== entree.empreinteEnvoyee
                ? 'Vol modifié depuis l\'envoi : touche le bouton pour remplacer la version du carnet.'
                : `Envoyé au carnet${heure ? ` à ${heure}` : ''}. Un nouvel export remplace celui-ci.`;
            classe = texte.startsWith('Vol modifié') ? 'attention' : 'ok';
        } else if (entree.etat === 'attente') {
            libelle = 'En attente d\'envoi';
            texte = entree.message || 'Le vol partira tout seul dès que le NAS répond.';
            classe = 'attente';
        } else if (entree.etat === 'erreur') {
            libelle = 'Export Carnet de Vol ⚠';
            texte = entree.message || 'Erreur du NAS.';
            classe = 'erreur';
        }
        bouton.textContent = libelle;
        bouton.disabled = npfCarnetEnvoiEnCours;
        bouton.dataset.etat = entree.etat || '';
        etat.textContent = texte;
        etat.className = `carnet-vol-etat${classe ? ` carnet-vol-etat-${classe}` : ''}`;
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

    const champImmat = document.getElementById('carnet-vol-immat');
    const champNom = document.getElementById('carnet-vol-nom');
    const noterAvion = () => {
        if (!activeFlightId) return;
        const entree = getNpfCarnetEntree(activeFlightId, true);
        entree.avionVu = true;
        entree.immat = String(champImmat?.value || '').trim().toUpperCase().slice(0, 12);
        entree.nomAvion = String(champNom?.value || '').trim().toUpperCase().slice(0, 12);
        if (entree.immat && !entree.nomAvion) {
            let noms = {};
            try { noms = JSON.parse(localStorage.getItem(NPF_CARNET_NOMS_KEY) || '{}') || {}; } catch (_) { noms = {}; }
            if (noms[entree.immat]) {
                entree.nomAvion = String(noms[entree.immat]);
                if (champNom) champNom.value = entree.nomAvion;
            }
        } else if (entree.immat && entree.nomAvion) {
            try {
                const noms = JSON.parse(localStorage.getItem(NPF_CARNET_NOMS_KEY) || '{}') || {};
                noms[entree.immat] = entree.nomAvion;
                localStorage.setItem(NPF_CARNET_NOMS_KEY, JSON.stringify(noms));
            } catch (_) {}
        }
        ecrireNpfCarnetVols();
        rafraichirNpfCarnetBouton();
    };
    [champImmat, champNom].forEach(champ => {
        if (!champ) return;
        champ.addEventListener('change', noterAvion);
        champ.addEventListener('blur', noterAvion);
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
