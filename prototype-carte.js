/*
 * NPF-Q400 TEST v18.03 — PROTOTYPE de carte MapLibre GL JS (module de prototype-carte.html, page à part).
 * - Chargé SEULEMENT quand on ouvre la page (bouton « Prototype carte GPU » du DIAG) ; la carte NPF-Q400 n'est pas touchée.
 * - MapLibre GL JS 6.17.0 en copie locale (dossier maplibre-6.17.0) ; aucune requête vers un serveur extérieur.
 * - Fond V11 et noms des communes lus dans les bases IndexedDB actuelles par addProtocol, renvoyés en ArrayBuffer.
 *   LECTURE SEULE STRICTE : bases ouvertes sans numéro de version, transactions « readonly » seulement, aucune
 *   création ni suppression de base ou de magasin, rien écrit dans localStorage ni dans les caches.
 * - Lignes HT lues dans le cache existant (lecture seule), dessinées par la puce graphique.
 * - Avion simulé, suivi, échelle en NM, boutons 5 NM / 2 NM, Retour à NPF-Q400, DIAG exportable.
 * - Pas de routes, VFR, zones SIA, feux, WP, trafic ni popups.
 */
/* ==== BANC CARTE GPU — DÉBUT DU CODE COMMUN (identique dans src/360_banc_carte_gpu.js et prototype-carte.js) ==== */
/*
 * v18.03 — même mesure des deux côtés (Leaflet = carte NPF-Q400 actuelle, MapLibre = prototype) :
 * - images par seconde pendant un geste (cadence requestAnimationFrame, de la pose du doigt à la fin de l'inertie) ;
 *   glissement (1 doigt ou souris), pincement (2 doigts), molette (PC) ; classés par échelle au début du geste ;
 *   saccade = une image de plus de 50 ms ; un toucher sans déplacement de la carte n'est pas compté ;
 * - temps d'affichage des dalles du fond (demande -> image prête) et dalles encore blanches à la fin d'un geste ;
 * - mémoire (taille des canvas, dalles gardées) ;
 * - retours au premier plan : durée de l'absence, perte du contexte graphique, temps jusqu'à une carte de nouveau
 *   complète, alerte « CARTE BLANCHE » si la carte reste vide plus de 2 s.
 * PASSIF : écouteurs passifs, aucune action sur la carte, rien d'enregistré (mémoire de la page seulement).
 */
function npfBancCreer(adaptateur) {
    const SACCADE_MS = 50;
    const VIDE_ALERTE_MS = 2000;
    const SUIVI_RETOUR_MAX_MS = 30000;
    const B = {
        debut: Date.now(),
        gestes: [],
        categories: {},
        tuiles: { demandees: 0, affichees: 0, absentes: 0, durees: [] },
        retours: [],
        contexte: []
    };
    const enAttente = new Map();
    const pointeurs = new Set();
    let geste = null;
    let rafActif = false;
    let absence = null;
    let contextePerdu = false;
    let perteEnCours = null;

    const maintenant = () => performance.now();
    const mediane = valeurs => {
        if (!valeurs.length) return NaN;
        const v = valeurs.slice().sort((a, b) => a - b);
        const m = Math.floor(v.length / 2);
        return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const centile = (valeurs, p) => {
        if (!valeurs.length) return NaN;
        const v = valeurs.slice().sort((a, b) => a - b);
        return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
    };
    const ips = dt => (Number.isFinite(dt) && dt > 0 ? Math.round(1000 / dt) : NaN);
    const heure = at => new Date(at).toLocaleTimeString('fr-FR');
    const sec = ms => (Number.isFinite(ms) ? (ms / 1000).toFixed(1).replace('.', ',') + ' s' : '—');
    const libelleEchelle = nm => {
        const v = Number(nm);
        if (!Number.isFinite(v) || v <= 0) return '? NM';
        return String(v).replace('.', ',') + ' NM';
    };
    const duree = ms => {
        const s = Math.round(ms / 1000);
        if (s < 60) return s + ' s';
        const m = Math.floor(s / 60);
        if (m < 60) return m + ' min ' + String(s % 60).padStart(2, '0') + ' s';
        return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
    };
    const couverture = () => {
        try {
            const c = adaptateur.couverture() || {};
            return { total: Number(c.total) || 0, chargees: Number(c.chargees) || 0 };
        } catch (_) {
            return { total: 0, chargees: 0 };
        }
    };
    const horsCarte = cible => {
        try {
            return !!(cible && cible.closest && cible.closest('button, input, select, textarea, a, .proto-ui, .leaflet-control, [role="dialog"]'));
        } catch (_) {
            return false;
        }
    };

    function demarrer(type) {
        geste = {
            type,
            t0: maintenant(),
            relache: null,
            derniere: null,
            dts: [],
            images: 0,
            echelleNm: (() => { try { return adaptateur.echelleNm(); } catch (_) { return NaN; } })()
        };
        if (!rafActif) {
            rafActif = true;
            requestAnimationFrame(image);
        }
    }

    function image(t) {
        if (!geste) {
            rafActif = false;
            return;
        }
        if (geste.derniere !== null) geste.dts.push(t - geste.derniere);
        geste.derniere = t;
        geste.images += 1;
        const n = maintenant();
        let dernierMouvement = 0;
        try { dernierMouvement = Number(adaptateur.dernierMouvement()) || 0; } catch (_) {}
        if (
            pointeurs.size === 0
            && geste.relache !== null
            && n - geste.relache > 100
            && (n - dernierMouvement > 150 || n - geste.relache > 2500)
        ) {
            terminer(dernierMouvement);
        }
        if (geste) {
            requestAnimationFrame(image);
        } else {
            rafActif = false;
        }
    }

    function terminer(dernierMouvement) {
        const g = geste;
        geste = null;
        if (!g || dernierMouvement < g.t0 || !g.dts.length) return;
        const cov = couverture();
        const dtMed = mediane(g.dts);
        const dtMax = Math.max(...g.dts);
        const fin = g.derniere !== null ? g.derniere : maintenant();
        const enregistrement = {
            a: Date.now(),
            type: g.type,
            echelle: libelleEchelle(g.echelleNm),
            echelleFin: libelleEchelle((() => { try { return adaptateur.echelleNm(); } catch (_) { return NaN; } })()),
            dureeMs: Math.round(fin - g.t0),
            images: g.images,
            ipsMoy: g.dts.length ? Math.round(g.dts.length * 1000 / g.dts.reduce((a, b) => a + b, 0)) : NaN,
            ipsMed: ips(dtMed),
            ipsPire: ips(dtMax),
            imageMaxMs: Math.round(dtMax),
            saccades: g.dts.filter(dt => dt > SACCADE_MS).length,
            blanches: Math.max(0, cov.total - cov.chargees),
            dallesFin: cov.total
        };
        B.gestes.push(enregistrement);
        while (B.gestes.length > 200) B.gestes.shift();
        const cle = enregistrement.type + '|' + enregistrement.echelle;
        const cat = B.categories[cle] || (B.categories[cle] = { type: enregistrement.type, echelle: enregistrement.echelle, gestes: 0, dts: [], blanches: [] });
        cat.gestes += 1;
        g.dts.forEach(dt => cat.dts.push(dt));
        if (cat.dts.length > 20000) cat.dts.splice(0, cat.dts.length - 20000);
        cat.blanches.push(enregistrement.blanches);
    }

    function relacher() {
        if (geste && pointeurs.size === 0 && geste.relache === null) geste.relache = maintenant();
    }

    function brancher() {
        let conteneur = null;
        try { conteneur = adaptateur.conteneur(); } catch (_) {}
        if (!conteneur) return false;
        conteneur.addEventListener('pointerdown', e => {
            if (horsCarte(e.target)) return;
            pointeurs.add(e.pointerId);
            if (!geste || geste.type === 'molette') {
                if (geste) geste = null;
                demarrer(pointeurs.size >= 2 ? 'pincement' : 'glissement');
            } else {
                geste.relache = null;
                if (pointeurs.size >= 2) geste.type = 'pincement';
            }
        }, { capture: true, passive: true });
        const fin = e => {
            if (!pointeurs.has(e.pointerId)) return;
            pointeurs.delete(e.pointerId);
            relacher();
        };
        window.addEventListener('pointerup', fin, { capture: true, passive: true });
        window.addEventListener('pointercancel', fin, { capture: true, passive: true });
        conteneur.addEventListener('wheel', e => {
            if (horsCarte(e.target)) return;
            if (!geste) demarrer('molette');
            if (geste.type === 'molette') geste.relache = maintenant();
        }, { capture: true, passive: true });
        document.addEventListener('visibilitychange', changementVisibilite, { passive: true });
        return true;
    }

    function changementVisibilite() {
        if (document.visibilityState === 'hidden') {
            if (!absence) absence = { a: Date.now(), perdu: false };
            pointeurs.clear();
            geste = null;
            return;
        }
        if (!absence) return;
        const r = {
            a: Date.now(),
            absenceMs: Date.now() - absence.a,
            perdu: absence.perdu || contextePerdu,
            restaure: false,
            completeMs: null,
            videMs: null,
            blanche: false,
            fini: false
        };
        absence = null;
        B.retours.push(r);
        while (B.retours.length > 40) B.retours.shift();
        suivre(r, maintenant());
    }

    /* Suivi après un retour au premier plan ou une perte du contexte : carte vide / complète. */
    function suivre(r, t0) {
        const tick = () => {
            const e = maintenant() - t0;
            const cov = couverture();
            const vide = contextePerdu || cov.chargees === 0;
            if (contextePerdu) r.perdu = true;
            if (!vide && r.videMs === null) r.videMs = Math.round(e);
            if (!contextePerdu && cov.total > 0 && cov.chargees >= cov.total) {
                r.completeMs = Math.round(e);
                if (r.videMs === null) r.videMs = r.completeMs;
                r.fini = true;
                return;
            }
            if (vide && e > VIDE_ALERTE_MS) r.blanche = true;
            if (e > SUIVI_RETOUR_MAX_MS) {
                r.fini = true;
                return;
            }
            setTimeout(tick, 100);
        };
        tick();
    }

    const banc = {
        etat: B,
        brancher,
        tuileDemandee(cle) {
            B.tuiles.demandees += 1;
            enAttente.delete(cle);
            enAttente.set(cle, maintenant());
            while (enAttente.size > 3000) enAttente.delete(enAttente.keys().next().value);
        },
        tuileAffichee(cle) {
            const t0 = enAttente.get(cle);
            if (t0 === undefined) return;
            enAttente.delete(cle);
            B.tuiles.affichees += 1;
            B.tuiles.durees.push(maintenant() - t0);
            if (B.tuiles.durees.length > 6000) B.tuiles.durees.splice(0, B.tuiles.durees.length - 6000);
        },
        tuileAbsente(cle) {
            if (!enAttente.has(cle)) return;
            enAttente.delete(cle);
            B.tuiles.absentes += 1;
        },
        tuileOubliee(cle) {
            enAttente.delete(cle);
        },
        contextePerdu() {
            contextePerdu = true;
            if (absence) absence.perdu = true;
            perteEnCours = { a: Date.now(), t0: maintenant(), pendantAbsence: !!absence || document.visibilityState === 'hidden', restaureMs: null, completeMs: null, videMs: null, blanche: false, fini: false, perdu: true };
            B.contexte.push(perteEnCours);
            while (B.contexte.length > 40) B.contexte.shift();
        },
        contexteRestaure() {
            contextePerdu = false;
            const p = perteEnCours;
            perteEnCours = null;
            if (!p) return;
            p.restaureMs = Math.round(maintenant() - p.t0);
            const t1 = maintenant();
            const suiviP = { completeMs: null, videMs: null, blanche: false, fini: false, perdu: false };
            suivre(suiviP, t1);
            const copie = () => {
                p.completeMs = suiviP.completeMs;
                /* Perte pendant l'arrière-plan : seul compte ce qui est vu au retour (ligne « Arrière-plan »). */
                p.blanche = p.blanche || suiviP.blanche || (!p.pendantAbsence && p.restaureMs > VIDE_ALERTE_MS);
                p.fini = suiviP.fini;
                if (!suiviP.fini) setTimeout(copie, 200);
            };
            copie();
        },
        lignes() {
            const L = [];
            let ecran = '—';
            try { ecran = Math.round(window.innerWidth) + '×' + Math.round(window.innerHeight) + ' CSS ×' + (window.devicePixelRatio || 1); } catch (_) {}
            L.push('');
            L.push('################ BANC CARTE GPU (v18.03) ################');
            L.push('Moteur : ' + adaptateur.nom + ' | écran ' + ecran + ' | mesure depuis ' + heure(B.debut));
            L.push('Méthode : images/s = cadence d’affichage (requestAnimationFrame) de la pose du doigt à la fin de l’inertie ; saccade = image de plus de ' + SACCADE_MS + ' ms ; échelle lue au début du geste');
            L.push('Gestes : ' + B.gestes.length + ' mesuré(s)');
            const ordre = ['glissement|5 NM', 'glissement|2 NM', 'pincement|5 NM', 'pincement|2 NM'];
            const nomType = { glissement: 'Glissement', pincement: 'Pincement', molette: 'Molette (PC)' };
            const autres = Object.keys(B.categories).filter(k => !ordre.includes(k)).sort();
            [...ordre, ...autres].forEach(cle => {
                const cat = B.categories[cle];
                const [type, echelle] = cle.split('|');
                const nom = '  ' + (nomType[type] || type) + ' ' + echelle + ' : ';
                if (!cat || !cat.dts.length) {
                    L.push(nom + 'aucun geste');
                    return;
                }
                const bl = cat.blanches;
                const moyBl = bl.length ? (bl.reduce((a, b) => a + b, 0) / bl.length) : 0;
                L.push(nom + cat.gestes + ' geste(s) | médiane ' + ips(mediane(cat.dts)) + ' i/s | pire ' + ips(Math.max(...cat.dts)) + ' i/s (image de ' + Math.round(Math.max(...cat.dts)) + ' ms) | saccades ' + cat.dts.filter(dt => dt > SACCADE_MS).length + ' sur ' + cat.dts.length + ' images | dalles blanches à la fin : moy ' + moyBl.toFixed(1).replace('.', ',') + ' / max ' + Math.max(...bl));
            });
            const d = B.tuiles.durees;
            L.push('Dalles du fond (demande -> image prête) : ' + B.tuiles.demandees + ' demandées / ' + B.tuiles.affichees + ' affichées / ' + B.tuiles.absentes + ' absentes de la carte'
                + (d.length ? ' | médiane ' + Math.round(mediane(d)) + ' ms | 95 % ' + Math.round(centile(d, 0.95)) + ' ms | max ' + Math.round(Math.max(...d)) + ' ms' : ' | aucune mesure'));
            let memoire = '—';
            try { memoire = adaptateur.memoire(); } catch (_) {}
            L.push('Mémoire : ' + memoire);
            L.push('Arrière-plan : ' + B.retours.length + ' retour(s) au premier plan');
            B.retours.forEach(r => {
                L.push('  ' + heure(r.a) + ' | absence ' + duree(r.absenceMs)
                    + ' | contexte graphique perdu : ' + (adaptateur.contexteSansObjet ? 'sans objet (pas de WebGL)' : (r.perdu ? 'OUI' : 'non'))
                    + ' | carte affichée en ' + sec(r.videMs)
                    + ' | complète en ' + (r.completeMs !== null ? sec(r.completeMs) : (r.fini ? 'PAS COMPLÈTE après 30 s' : 'en cours'))
                    + (r.blanche ? ' | ⚠ CARTE BLANCHE (vide plus de 2 s)' : ''));
            });
            if (!adaptateur.contexteSansObjet) {
                L.push('Contexte graphique : ' + B.contexte.length + ' perte(s)');
                B.contexte.forEach(p => {
                    L.push('  ' + heure(p.a) + ' | ' + (p.pendantAbsence ? 'pendant l’arrière-plan' : 'app au premier plan')
                        + ' | rendu en ' + (p.restaureMs !== null ? sec(p.restaureMs) : 'PAS RENDU')
                        + ' | carte complète ' + (p.completeMs !== null ? sec(p.completeMs) + ' après' : (p.fini ? 'PAS COMPLÈTE après 30 s' : 'en cours'))
                        + (p.blanche ? ' | ⚠ CARTE BLANCHE (vide plus de 2 s)' : ''));
                });
            }
            L.push('Derniers gestes (' + Math.min(30, B.gestes.length) + ') :');
            B.gestes.slice(-30).forEach(g => {
                L.push('  ' + heure(g.a) + ' | ' + g.type + ' ' + g.echelle + (g.echelleFin !== g.echelle ? ' -> ' + g.echelleFin : '')
                    + ' | ' + (g.dureeMs / 1000).toFixed(2).replace('.', ',') + ' s · ' + g.images + ' images'
                    + ' | moy ' + g.ipsMoy + ' · médiane ' + g.ipsMed + ' · pire ' + g.ipsPire + ' i/s'
                    + ' | saccades ' + g.saccades + ' | blanches fin ' + g.blanches + '/' + g.dallesFin);
            });
            return L;
        }
    };
    return banc;
}
/* ==== BANC CARTE GPU — FIN DU CODE COMMUN ==== */

/* ==================== PROTOTYPE ==================== */
const APPV = 'v18.03';
const MAPLIBRE_VERSION = '6.17.0';
const MAPLIBRE_DOSSIER = 'maplibre-6.17.0';
/*
 * Cache de dalles MapLibre : 100 dalles gardées hors de l'écran PAR SOURCE (fond, noms), en plus des dalles affichées.
 * Une dalle de 256 px décodée occupe 256 Ko sur la puce graphique : 100 dalles ≈ 25 Mo par source, soit ≈ 50 Mo
 * pour les deux, plus ≈ 2 × 40 dalles à l'écran (≈ 20 Mo). Assez pour revenir sur ses pas (un écran et demi autour,
 * un niveau de zoom au-dessus et en dessous) sans approcher la limite d'un iPad 9 de 3 Go (la carte actuelle
 * garde déjà jusqu'à 1 300 dalles en mémoire et 146 Mo de canvas d'après le DIAG).
 */
const MAX_DALLES_CACHE = 100;
/* Lectures IndexedDB simultanées au plus (fond + noms ensemble) ; la carte actuelle : 5 (fond) + 2 (noms). */
const LECTURES_MAX = 8;
const NOMS_DB = 'CalqueNomsCommunes';
const NOMS_PACK = 'Calque_Noms_Communes';
const NOMS_ZOOM_MIN = 8;
const NOMS_ZOOM_MAX = 13;
const HT_URL = 'lignes_ht_rte_simplifiees.geojson';
const HT_MASQUEES_NM = 50;
const SIMULATION_PAS_MS = 500;

const PNG_TRANSPARENT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
/* Dalle absente du fond : même couleur que la carte actuelle (#d8e2e8, OFFLINE_TILE_PLACEHOLDER_DATA_URL). */
const PNG_ABSENTE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO48ejFfwAI2gOifHT6QQAAAABJRU5ErkJggg==';
const octets = b64 => {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
};
const BUF_TRANSPARENT = octets(PNG_TRANSPARENT);
const BUF_ABSENTE = octets(PNG_ABSENTE);

const params = new URLSearchParams(location.search);
const nombre = (cle, defaut) => {
    const v = Number(params.get(cle));
    return params.has(cle) && Number.isFinite(v) ? v : defaut;
};

const journal = {
    ouverture: Date.now(),
    bases: [],
    lectures: { fond: 0, noms: 0, trouvees: 0, absentes: 0, erreurs: 0, durees: [] },
    erreurs: [],
    messages: []
};
const noterErreur = texte => {
    journal.erreurs.push(new Date().toLocaleTimeString('fr-FR') + ' ' + String(texte).slice(0, 200));
    while (journal.erreurs.length > 40) journal.erreurs.shift();
};

function afficherMessage(texte, alerte = false, dureeMs = 0) {
    const el = document.getElementById('proto-message');
    if (!el) return;
    el.textContent = texte;
    el.classList.toggle('proto-alerte', !!alerte);
    el.hidden = !texte;
    journal.messages.push(new Date().toLocaleTimeString('fr-FR') + ' ' + texte);
    clearTimeout(afficherMessage.t);
    if (dureeMs > 0) afficherMessage.t = setTimeout(() => { el.hidden = true; }, dureeMs);
}

document.getElementById('proto-retour').addEventListener('click', () => {
    location.href = './index.html';
});

/* ---------- Réglages de la carte NPF-Q400 installée : LECTURE de localStorage seulement ---------- */
function lireLocal(cle) {
    try { return localStorage.getItem(cle); } catch (_) { return null; }
}

/* Copies des règles de nommage de l'app (src/280 normalizeOfflinePackName / getOfflinePackGroupName,
 * src/100 normalizeOfflineTileHostPrefix, isNpfOfflinePackSelection), sans rien modifier. */
function normaliserNomPack(nom) {
    const brut = String(nom || '').split(/[\\/]/).pop().replace(/\.zip$/i, '').trim();
    const propre = brut.replace(/\s*\(\d+\)\s*$/i, '').replace(/\s+(copy|copie)\s*$/i, '').trim();
    const m = propre.match(/^(.*?)[\s_-]+v(?:ersion)?[\s_-]*\d+(?:\.\d+)*(?:[\s_-]+(?:part|partie|zip)?[\s_-]*(\d{1,3}))$/i);
    if (!m) return propre;
    const prefixe = m[1].replace(/[\s_-]+$/g, '').trim();
    const partie = Number.parseInt(m[2], 10);
    if (!prefixe || !Number.isFinite(partie)) return propre;
    return `${prefixe}_${String(partie).padStart(Math.max(2, String(m[2]).length), '0')}`;
}
function groupePack(nom) {
    const propre = normaliserNomPack(nom).replace(/\s*\(\d+\)\s*$/i, '').replace(/\s+(copy|copie)\s*$/i, '').trim();
    const m = propre.match(/^(.+?)(?:[\s_-]*(?:part|partie|zip)?[\s_-]*)(\d{1,3})$/i);
    if (m && m[1].trim().length >= 2) return m[1].replace(/[\s_-]+$/g, '').trim();
    return propre;
}
function prefixeHote(nom) {
    const brut = String(nom || '').trim();
    const s = String(groupePack(brut) || brut || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!s || /open\s*street|openstreet|\bosm\b/.test(s)) return 'a';
    if (/\bign\b|scan25|scan\s*25|oaci\s*ign/.test(s)) return 'ign';
    if (/oaci|carte\s*oaci/.test(s)) return 'oaci';
    return s.replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'pack';
}
function estPackNpf(nom) {
    const s = String(groupePack(nom) || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return /(^|[^a-z0-9])npf([^a-z0-9]|$)|npf[_\s-]*france|carte[_\s-]*npf/.test(s);
}
function lirePacksNpf() {
    let liste = [];
    try { liste = JSON.parse(lireLocal('installedMapPacks') || '[]'); } catch (_) { liste = []; }
    return (Array.isArray(liste) ? liste : []).filter(p => p && p.name && estPackNpf(p.name));
}

/* ---------- IndexedDB : LECTURE SEULE STRICTE ---------- */
async function baseListee(nom) {
    if (!indexedDB || typeof indexedDB.databases !== 'function') return null;
    try {
        const liste = await indexedDB.databases();
        return liste.some(d => d && d.name === nom);
    } catch (_) {
        return null;
    }
}
/* Ouverture SANS numéro de version : aucune mise à niveau possible. Si la base n'existe pas, la création
 * qui démarrerait est annulée aussitôt (la base n'est pas créée) et la base est déclarée absente. */
function ouvrirLectureSeule(nom) {
    return new Promise((resolve, reject) => {
        let creation = false;
        let demande;
        try {
            demande = indexedDB.open(nom);
        } catch (e) {
            reject(e);
            return;
        }
        demande.onupgradeneeded = ev => {
            creation = true;
            try { ev.target.transaction.abort(); } catch (_) {}
        };
        demande.onsuccess = () => {
            const db = demande.result;
            if (creation) {
                try { db.close(); } catch (_) {}
                reject(new Error('base absente'));
                return;
            }
            db.onversionchange = () => { try { db.close(); } catch (_) {} };
            resolve(db);
        };
        demande.onerror = ev => {
            try { ev.preventDefault(); } catch (_) {}
            reject(creation ? new Error('base absente') : (demande.error || new Error('ouverture impossible')));
        };
        demande.onblocked = () => reject(new Error('base bloquée'));
    });
}
async function ouvrirSiPresente(nom) {
    const listee = await baseListee(nom);
    if (listee === false) {
        journal.bases.push({ nom, etat: 'absente (non ouverte)' });
        return null;
    }
    try {
        const db = await ouvrirLectureSeule(nom);
        if (!db.objectStoreNames.contains('tiles')) {
            try { db.close(); } catch (_) {}
            journal.bases.push({ nom, etat: 'sans magasin « tiles » (non utilisée)' });
            return null;
        }
        journal.bases.push({ nom, etat: 'ouverte en lecture seule (version ' + db.version + ')' });
        return db;
    } catch (e) {
        journal.bases.push({ nom, etat: 'absente ou illisible : ' + (e && e.message || e) });
        return null;
    }
}
function premierTileUrl(db, packs) {
    /* Une seule lecture (curseur) pour retrouver l'adresse logique réellement rangée : lecture seule. */
    return new Promise(resolve => {
        try {
            const store = db.transaction('tiles', 'readonly').objectStore('tiles');
            const source = store.indexNames.contains('packName') && packs.length ? store.index('packName') : store;
            const req = source === store ? store.openCursor() : source.openCursor(IDBKeyRange.only(packs[0]));
            req.onsuccess = () => { const c = req.result; resolve(c && c.value ? String(c.value.tileUrl || '') : ''); };
            req.onerror = () => resolve('');
        } catch (_) {
            resolve('');
        }
    });
}
function lireEnregistrement(db, url, packs) {
    return new Promise((resolve, reject) => {
        let store;
        try {
            store = db.transaction('tiles', 'readonly').objectStore('tiles');
        } catch (e) {
            reject(e);
            return;
        }
        if (store.indexNames.contains('tileUrl')) {
            const req = store.index('tileUrl').openCursor(IDBKeyRange.only(url));
            req.onsuccess = () => {
                const c = req.result;
                if (!c) { resolve(null); return; }
                const v = c.value || {};
                if (!v.packName || packs.has(String(v.packName))) { resolve(v); return; }
                c.continue();
            };
            req.onerror = () => reject(req.error || new Error('lecture impossible'));
            return;
        }
        const cles = [...[...packs].map(p => url + '::' + p), url];
        let i = 0;
        const suivante = () => {
            if (i >= cles.length) { resolve(null); return; }
            const req = store.get(cles[i++]);
            req.onsuccess = () => (req.result ? resolve(req.result) : suivante());
            req.onerror = () => reject(req.error || new Error('lecture impossible'));
        };
        suivante();
    });
}
function lireCle(db, cle) {
    return new Promise((resolve, reject) => {
        try {
            const req = db.transaction('tiles', 'readonly').objectStore('tiles').get(cle);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error || new Error('lecture impossible'));
        } catch (e) {
            reject(e);
        }
    });
}
async function enArrayBuffer(donnee) {
    if (!donnee) return null;
    if (donnee instanceof ArrayBuffer) return donnee.slice(0);
    if (ArrayBuffer.isView(donnee)) return donnee.buffer.slice(donnee.byteOffset, donnee.byteOffset + donnee.byteLength);
    if (typeof Blob !== 'undefined' && donnee instanceof Blob) return await donnee.arrayBuffer();
    return null;
}

const SOURCES = { fond: [], noms: null, fondMin: 7, fondMax: 13, avecNoms: false };

async function preparerBases() {
    const packs = lirePacksNpf();
    if (!packs.length) return { ok: false, message: 'Aucune carte NPF-Q400 installée sur cet appareil : le prototype n’a rien à afficher. Rien n’a été créé.' };
    const noms = new Set();
    packs.forEach(p => { noms.add(String(p.name)); if (p.sourceName) noms.add(String(p.sourceName)); });
    const dbNoms = [...new Set(packs.map(p => String(p.dbName || '').trim()).filter(Boolean))];
    if (!dbNoms.length) dbNoms.push('OfflineTilesDB_v13_70_clean');
    for (const nom of dbNoms) {
        const db = await ouvrirSiPresente(nom);
        if (!db) continue;
        const prefixes = [];
        packs.forEach(p => { const x = prefixeHote(p.name); if (!prefixes.includes(x)) prefixes.push(x); });
        const exemple = await premierTileUrl(db, [...noms]);
        const m = /^https:\/\/([^.]+)\.tile\.openstreetmap\.org\//.exec(exemple);
        if (m && !prefixes.includes(m[1])) prefixes.push(m[1]);
        SOURCES.fond.push({ db, nom, packs: noms, prefixes, ext: /\.jpe?g/i.test(exemple) ? 'jpg' : 'png' });
    }
    if (!SOURCES.fond.length) return { ok: false, message: 'La base de la carte NPF-Q400 est absente ou illisible : rien n’a été créé. Retourne à NPF-Q400.' };
    const zMin = Number.parseInt(lireLocal('offlineTilesMinZoom') || '', 10);
    const zMax = Number.parseInt(lireLocal('offlineTilesMaxZoom') || '', 10);
    if (Number.isFinite(zMin)) SOURCES.fondMin = Math.max(0, Math.min(13, zMin));
    if (Number.isFinite(zMax)) SOURCES.fondMax = Math.max(SOURCES.fondMin, Math.min(13, zMax));
    SOURCES.avecNoms = packs.every(p => p.calqueNoms === true);
    if (SOURCES.avecNoms) {
        SOURCES.noms = await ouvrirSiPresente(NOMS_DB);
        if (!SOURCES.noms) afficherMessage('Calque des noms des communes absent : la carte s’affiche sans les noms. Rien n’a été créé.', false, 8000);
    }
    return { ok: true };
}

/* ---------- Lectures limitées ---------- */
let lecturesActives = 0;
const fileLectures = [];
function avecCreneau(travail) {
    return new Promise((resolve, reject) => {
        const lancer = () => {
            lecturesActives += 1;
            Promise.resolve().then(travail).then(resolve, reject).finally(() => {
                lecturesActives -= 1;
                const suivant = fileLectures.shift();
                if (suivant) suivant();
            });
        };
        if (lecturesActives < LECTURES_MAX) lancer(); else fileLectures.push(lancer);
    });
}
async function lireDalleFond(z, x, y) {
    for (const s of SOURCES.fond) {
        const urls = [];
        s.prefixes.forEach(p => {
            urls.push(`https://${p}.tile.openstreetmap.org/${z}/${x}/${y}.${s.ext}`);
            if (s.ext !== 'png') urls.push(`https://${p}.tile.openstreetmap.org/${z}/${x}/${y}.png`);
        });
        for (const url of urls) {
            const rec = await lireEnregistrement(s.db, url, s.packs);
            if (rec && rec.tile) return enArrayBuffer(rec.tile);
        }
    }
    return null;
}
async function lireDalleNoms(z, x, y) {
    if (!SOURCES.noms) return null;
    const url = `https://${prefixeHote(NOMS_PACK)}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const rec = await lireCle(SOURCES.noms, url + '::' + NOMS_PACK);
    return rec && rec.tile ? enArrayBuffer(rec.tile) : null;
}

/* ---------- Échelle (même calcul que la carte actuelle : 110 px au plus, valeurs « rondes ») ---------- */
const ECHELLES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const choisirEchelle = maxNm => { let s = ECHELLES[0]; ECHELLES.forEach(c => { if (c <= maxNm) s = c; }); return s; };
function metresParPixel(lat, zoomMapLibre) {
    return 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, zoomMapLibre));
}
/* Zoom Leaflet entier qui donne l'échelle voulue à cette latitude ; MapLibre = Leaflet - 1 (mêmes dalles, même taille). */
function zoomPourEchelle(nm, lat) {
    for (let zl = 13; zl >= 5; zl -= 1) {
        const mpp = 156543.03392804097 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zl);
        if (choisirEchelle(mpp * 110 / 1852) === nm) return zl - 1;
    }
    return null;
}

/* ---------- Banc et carte ---------- */
let map = null;
let dernierMouvement = 0;
let contexteGlPerdu = false;
const dallesPretes = new Set();
const dallesAbsentes = new Set();
const cleDalle = (z, x, y) => `${z}/${x}/${y}`;

const banc = npfBancCreer({
    nom: 'MapLibre GL JS ' + MAPLIBRE_VERSION + ' (prototype)',
    contexteSansObjet: false,
    conteneur: () => (map ? map.getCanvasContainer() : null),
    dernierMouvement: () => dernierMouvement,
    echelleNm: () => {
        const c = map.getCenter();
        return choisirEchelle(metresParPixel(c.lat, map.getZoom()) * 110 / 1852);
    },
    couverture: () => {
        if (!map) return { total: 0, chargees: 0 };
        const tuiles = map.coveringTiles({ tileSize: 256, minzoom: SOURCES.fondMin, maxzoom: SOURCES.fondMax, roundZoom: true });
        let chargees = 0;
        tuiles.forEach(t => {
            const c = t.canonical;
            const k = cleDalle(c.z, c.x, c.y);
            if (dallesPretes.has(k) || dallesAbsentes.has(k)) chargees += 1;
        });
        return { total: tuiles.length, chargees: contexteGlPerdu ? 0 : chargees };
    },
    memoire: () => {
        const canvas = map.getCanvas();
        const w = canvas.width, h = canvas.height;
        let gestionnaires = {};
        try { gestionnaires = map.style && (map.style.tileManagers || map.style.sourceCaches) || {}; } catch (_) {}
        const compter = id => {
            const g = gestionnaires[id];
            if (!g) return '—';
            let vues = 0, cache = 0;
            try { vues = g.getIds().length; } catch (_) {}
            let max = '?';
            try { cache = g._outOfViewCache && g._outOfViewCache.order ? g._outOfViewCache.order.length : 0; max = g._outOfViewCache ? g._outOfViewCache.max : '?'; } catch (_) {}
            return vues + ' affichées + ' + cache + ' en cache (au plus ' + max + ')';
        };
        let tas = '';
        try { if (performance.memory) tas = ' | tas JS ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + ' Mo'; } catch (_) {}
        return 'canvas ' + w + '×' + h + ' px (≈ ' + Math.round(w * h * 4 / 1048576) + ' Mo par image) | dalles fond : ' + compter('fond')
            + ' | dalles noms : ' + compter('noms') + ' | cache réglé à ' + MAX_DALLES_CACHE + ' dalles par source (256 Ko chacune sur la puce graphique)' + tas;
    }
});

/* ---------- Avion simulé (même mouvement que la simulation de l'app : pas de 500 ms, ligne droite) ---------- */
const avion = {
    lat: nombre('alat', nombre('lat', 44.7)),
    lon: nombre('alon', nombre('lon', 4.65)),
    vitesseKt: nombre('kt', 0) > 0 ? nombre('kt', 0) : 120,
    routeVraie: ((nombre('route', 0) % 360) + 360) % 360,
    dernierPas: 0,
    suivi: false
};
function destination(lat, lon, capDeg, distanceM) {
    const R = 6371008.8;
    const d = distanceM / R, c = capDeg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(c));
    const l2 = l1 + Math.atan2(Math.sin(c) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * 180 / Math.PI, ((l2 * 180 / Math.PI + 540) % 360) - 180];
}
function geojsonAvion() {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cap: avion.routeVraie }, geometry: { type: 'Point', coordinates: [avion.lon, avion.lat] } }] };
}
let doigtsPoses = 0;
function pasSimulation() {
    const n = performance.now();
    if (document.hidden || !map) { avion.dernierPas = n; return; }
    const ecoule = avion.dernierPas > 0 ? Math.min(1, Math.max(0, (n - avion.dernierPas) / 1000)) : SIMULATION_PAS_MS / 1000;
    avion.dernierPas = n;
    const [la, lo] = destination(avion.lat, avion.lon, avion.routeVraie, avion.vitesseKt * 1852 * ecoule / 3600);
    avion.lat = la;
    avion.lon = lo;
    const src = map.getSource('avion');
    if (src) src.setData(geojsonAvion());
    if (avion.suivi && doigtsPoses === 0) map.jumpTo({ center: [avion.lon, avion.lat] });
}
function dessinerAvion() {
    const t = 48, c = document.createElement('canvas');
    c.width = t; c.height = t;
    const g = c.getContext('2d');
    g.translate(t / 2, t / 2);
    g.fillStyle = '#e11d48';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, -21); g.lineTo(3.5, -8); g.lineTo(20, 3); g.lineTo(20, 7); g.lineTo(3.5, 2); g.lineTo(2.5, 14);
    g.lineTo(8, 19); g.lineTo(8, 21); g.lineTo(0, 18.5); g.lineTo(-8, 21); g.lineTo(-8, 19); g.lineTo(-2.5, 14);
    g.lineTo(-3.5, 2); g.lineTo(-20, 7); g.lineTo(-20, 3); g.lineTo(-3.5, -8); g.closePath();
    g.stroke(); g.fill();
    return g.getImageData(0, 0, t, t);
}
function majBoutonSuivi() {
    const b = document.getElementById('proto-suivi');
    b.setAttribute('aria-pressed', avion.suivi ? 'true' : 'false');
    b.textContent = avion.suivi ? 'Suivi avion ON' : 'Suivi avion';
}

/* ---------- Lignes HT : même couleur, mêmes traits et même règle d'affichage (63 kV) que src/110 ---------- */
const BANDES_HT = [
    { b: '400', w: 3.0, o: 0.86, d: null, zMin: 0 },
    { b: '225', w: 2.4, o: 0.82, d: null, zMin: 0 },
    /* Leaflet : 90 kV au-delà du zoom 8, 63 kV au-delà du zoom 9, autres au-delà du zoom 10 ; MapLibre = Leaflet - 1. */
    { b: '90', w: 1.9, o: 0.78, d: [7, 4], zMin: 8 },
    { b: '63', w: 1.6, o: 0.70, d: [4, 4], zMin: 9 },
    { b: 'autres', w: 1.5, o: 0.72, d: [5, 4], zMin: 10 }
];
const TENSION = ['downcase', ['to-string', ['coalesce', ['get', 'tension'], '']]];
const BANDE = ['case', ['in', '400', TENSION], '400', ['in', '225', TENSION], '225', ['in', '90', TENSION], '90', ['in', '63', TENSION], '63', 'autres'];
let htUrl = null;
let htVisibles = null;
async function lireHtDuCache() {
    /* Même lecture que l'app (src/110 fetchHighVoltageLinesGeojson) : cache existant seulement, rien n'y est écrit. */
    if (!('caches' in window)) return null;
    try {
        const r = await caches.match(HT_URL, { ignoreSearch: true });
        if (!r || !r.ok) return null;
        return URL.createObjectURL(await r.blob());
    } catch (_) {
        return null;
    }
}
function majVisibiliteHt() {
    if (!map || !htUrl) return;
    const c = map.getCenter();
    const visibles = choisirEchelle(metresParPixel(c.lat, map.getZoom()) * 110 / 1852) < HT_MASQUEES_NM - 0.000001;
    if (visibles === htVisibles) return;
    htVisibles = visibles;
    BANDES_HT.forEach(x => { try { map.setLayoutProperty('ht-' + x.b, 'visibility', visibles ? 'visible' : 'none'); } catch (_) {} });
}
function majEchelle() {
    if (!map) return;
    const c = map.getCenter();
    const mpp = metresParPixel(c.lat, map.getZoom());
    const nm = choisirEchelle(mpp * 110 / 1852);
    const px = Math.max(26, Math.round(nm * 1852 / mpp));
    const el = document.getElementById('proto-echelle');
    el.querySelector('.proto-echelle-barre').style.width = px + 'px';
    el.querySelector('.proto-echelle-texte').textContent = String(nm).replace('.', ',') + ' NM';
}

/* ---------- Export DIAG (même forme que le DIAG de l'app) ---------- */
function texteDiag() {
    const L = [];
    L.push('NPF-Q400 — Diagnostic prototype carte GPU');
    L.push('Date : ' + new Date().toLocaleString('fr-FR'));
    L.push('Build : ' + APPV + ' (prototype-carte.html, MapLibre GL JS ' + MAPLIBRE_VERSION + ', copie locale)');
    L.push('Ouverture : ' + new Date(journal.ouverture).toLocaleString('fr-FR') + ' | appareil : ' + navigator.userAgent);
    let gl = '—';
    try {
        const ctx = map.painter && map.painter.context && map.painter.context.gl;
        if (ctx) gl = (typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1') + (ctx.isContextLost() ? ' (PERDU)' : '');
    } catch (_) {}
    L.push('Carte : NPF-Q400 hors ligne (fond ' + SOURCES.fondMin + '-' + SOURCES.fondMax + (SOURCES.noms ? ' + noms des communes' : ', sans noms') + ') | graphique : ' + gl);
    L.push('Bases (lecture seule) : ' + (journal.bases.map(b => b.nom + ' = ' + b.etat).join(' | ') || 'aucune'));
    const lec = journal.lectures;
    const d = lec.durees.slice().sort((a, b) => a - b);
    const med = d.length ? Math.round(d[Math.floor(d.length / 2)]) : null;
    L.push('Lectures IndexedDB : ' + lec.fond + ' fond / ' + lec.noms + ' noms | ' + lec.trouvees + ' trouvées / ' + lec.absentes + ' absentes / ' + lec.erreurs + ' erreurs'
        + (d.length ? ' | médiane ' + med + ' ms | max ' + Math.round(d[d.length - 1]) + ' ms' : '') + ' | ' + LECTURES_MAX + ' simultanées au plus');
    L.push('Lignes HT : ' + (htUrl ? 'lues dans le cache de l’app' : 'absentes du cache (ouvrir NPF-Q400 avec les lignes HT une fois)'));
    L.push('Avion simulé : ' + Math.round(avion.vitesseKt) + ' kt, route vraie ' + Math.round(avion.routeVraie) + '° | suivi ' + (avion.suivi ? 'ON' : 'OFF'));
    banc.lignes().forEach(l => L.push(l));
    if (journal.erreurs.length) {
        L.push('');
        L.push('Erreurs (' + journal.erreurs.length + ') :');
        journal.erreurs.forEach(e => L.push('  ' + e));
    }
    if (journal.messages.length) {
        L.push('');
        L.push('Événements (' + journal.messages.length + ') :');
        journal.messages.slice(-30).forEach(e => L.push('  ' + e));
    }
    return L.join('\n');
}
async function exporterDiag() {
    const texte = texteDiag();
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const nomFichier = `NPF_DIAG_PROTOTYPE_GPU_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.txt`;
    const titre = 'NPF-Q400 — Diagnostic prototype carte GPU';
    try {
        if (typeof File === 'function' && navigator.share) {
            const f = new File([texte], nomFichier, { type: 'text/plain;charset=utf-8' });
            if (!navigator.canShare || navigator.canShare({ files: [f] })) {
                await navigator.share({ title: titre, text: 'Diagnostic du prototype de carte GPU NPF-Q400 en pièce jointe.', files: [f] });
                return;
            }
        }
        if (navigator.share) {
            await navigator.share({ title: titre, text: texte });
            return;
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(texte);
            alert('Diagnostic copié. Tu peux le coller directement dans un mail.');
            return;
        }
    } catch (_) {}
    try {
        const url = URL.createObjectURL(new Blob([texte], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = nomFichier;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (_) {
        alert('Export impossible sur cet appareil.');
    }
}
window.npfPrototypeTexteDiag = texteDiag;
window.npfPrototypeBanc = banc;
window.npfPrototypeAvion = avion;
document.getElementById('proto-export').addEventListener('click', () => { exporterDiag(); });

/* ---------- Démarrage ---------- */
async function demarrer() {
    const maplibregl = await import('./' + MAPLIBRE_DOSSIER + '/maplibre-gl.mjs?appv=' + APPV);
    maplibregl.setWorkerUrl(new URL('./' + MAPLIBRE_DOSSIER + '/maplibre-gl-worker.mjs?appv=' + APPV, location.href).href);
    maplibregl.setMaxParallelImageRequests(LECTURES_MAX);
    const prep = await preparerBases();
    if (!prep.ok) {
        afficherMessage(prep.message, true);
        return;
    }
    maplibregl.addProtocol('npfidb', async params => {
        const m = /^npfidb:\/\/(fond|noms)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
        if (!m) throw new Error('adresse inconnue');
        const couche = m[1], z = +m[2], x = +m[3], y = +m[4];
        const k = cleDalle(z, x, y);
        if (couche === 'fond') {
            dallesPretes.delete(k);
            banc.tuileDemandee(k);
        }
        journal.lectures[couche] += 1;
        const t0 = performance.now();
        let donnees = null;
        try {
            donnees = await avecCreneau(() => (couche === 'fond' ? lireDalleFond(z, x, y) : lireDalleNoms(z, x, y)));
        } catch (e) {
            journal.lectures.erreurs += 1;
            noterErreur('lecture ' + couche + ' ' + k + ' : ' + (e && e.message || e));
        }
        journal.lectures.durees.push(performance.now() - t0);
        if (journal.lectures.durees.length > 6000) journal.lectures.durees.splice(0, 3000);
        if (donnees) {
            journal.lectures.trouvees += 1;
            return { data: donnees };
        }
        journal.lectures.absentes += 1;
        if (couche === 'fond') {
            dallesAbsentes.add(k);
            banc.tuileAbsente(k);
            return { data: BUF_ABSENTE.slice(0) };
        }
        return { data: BUF_TRANSPARENT.slice(0) };
    });
    htUrl = await lireHtDuCache();

    const zl = nombre('z', 10);
    const centre = [nombre('lon', avion.lon), nombre('lat', avion.lat)];
    const couches = [
        { id: 'fond-uni', type: 'background', paint: { 'background-color': '#eef2f5' } },
        { id: 'fond', type: 'raster', source: 'fond', paint: { 'raster-fade-duration': 0 } }
    ];
    const sources = {
        fond: { type: 'raster', tiles: ['npfidb://fond/{z}/{x}/{y}'], tileSize: 256, minzoom: SOURCES.fondMin, maxzoom: SOURCES.fondMax, scheme: 'xyz' },
        avion: { type: 'geojson', data: geojsonAvion() }
    };
    if (htUrl) {
        sources.ht = { type: 'geojson', data: htUrl, maxzoom: 12, tolerance: 0.375, buffer: 32 };
        BANDES_HT.forEach(x => {
            const couche = {
                id: 'ht-' + x.b,
                type: 'line',
                source: 'ht',
                minzoom: x.zMin,
                filter: ['==', BANDE, x.b],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': '#d8232a', 'line-width': x.w, 'line-opacity': x.o }
            };
            /* Leaflet : pointillés en pixels ; MapLibre : en largeurs de trait. */
            if (x.d) couche.paint['line-dasharray'] = x.d.map(v => v / x.w);
            couches.push(couche);
        });
    } else {
        afficherMessage('Lignes HT absentes du cache de l’app : ouvre NPF-Q400 une fois avec les lignes HT affichées. Rien n’a été téléchargé.', false, 9000);
    }
    if (SOURCES.noms) {
        sources.noms = { type: 'raster', tiles: ['npfidb://noms/{z}/{x}/{y}'], tileSize: 256, minzoom: NOMS_ZOOM_MIN, maxzoom: NOMS_ZOOM_MAX, scheme: 'xyz' };
        couches.push({ id: 'noms', type: 'raster', source: 'noms', minzoom: NOMS_ZOOM_MIN - 1, paint: { 'raster-fade-duration': 0 } });
    }
    couches.push({
        id: 'avion', type: 'symbol', source: 'avion',
        layout: { 'icon-image': 'avion', 'icon-rotate': ['get', 'cap'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 0.75 }
    });

    map = new maplibregl.Map({
        container: 'proto-carte',
        style: { version: 8, sources, layers: couches },
        center: centre,
        zoom: Math.max(SOURCES.fondMin - 1, Math.min(12, zl - 1)),
        minZoom: Math.max(0, SOURCES.fondMin - 1),
        maxZoom: 12,
        maxTileCacheSize: MAX_DALLES_CACHE,
        fadeDuration: 0,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        renderWorldCopies: false,
        cancelPendingTileRequestsWhileZooming: true
    });
    window.npfPrototypeCarte = map;
    map.touchZoomRotate.disableRotation();
    try { map.keyboard.disableRotation(); } catch (_) {}
    map.on('styleimagemissing', e => {
        if (e && e.id === 'avion' && !map.hasImage('avion')) map.addImage('avion', dessinerAvion(), { pixelRatio: 2 });
    });
    map.on('move', () => { dernierMouvement = performance.now(); });
    map.on('move', majEchelle);
    map.on('zoom', majVisibiliteHt);
    map.on('moveend', majVisibiliteHt);
    map.on('dragstart', () => { if (avion.suivi) { avion.suivi = false; majBoutonSuivi(); } });
    map.on('sourcedata', e => {
        if (e.sourceId !== 'fond' || !e.tile || !e.tile.tileID) return;
        if (e.tile.state !== 'loaded') return;
        const c = e.tile.tileID.canonical;
        const k = cleDalle(c.z, c.x, c.y);
        if (!dallesAbsentes.has(k)) dallesPretes.add(k);
        banc.tuileAffichee(k);
    });
    map.on('webglcontextlost', () => {
        contexteGlPerdu = true;
        dallesPretes.clear();
        banc.contextePerdu();
        journal.messages.push(new Date().toLocaleTimeString('fr-FR') + ' contexte graphique perdu');
    });
    map.on('webglcontextrestored', () => {
        contexteGlPerdu = false;
        banc.contexteRestaure();
        journal.messages.push(new Date().toLocaleTimeString('fr-FR') + ' contexte graphique rendu');
    });
    map.on('error', e => noterErreur('MapLibre : ' + (e && e.error && e.error.message || 'erreur')));
    const conteneur = map.getCanvasContainer();
    conteneur.addEventListener('touchstart', e => { doigtsPoses = e.touches.length; }, { passive: true });
    conteneur.addEventListener('touchend', e => { doigtsPoses = e.touches.length; }, { passive: true });
    conteneur.addEventListener('touchcancel', e => { doigtsPoses = e.touches.length; }, { passive: true });
    banc.brancher();
    map.on('load', () => {
        majEchelle();
        majVisibiliteHt();
        setInterval(pasSimulation, SIMULATION_PAS_MS);
    });

    const allerA = nm => {
        const z = zoomPourEchelle(nm, map.getCenter().lat);
        if (z === null) return;
        map.jumpTo({ zoom: z, center: avion.suivi ? [avion.lon, avion.lat] : map.getCenter() });
    };
    document.getElementById('proto-5nm').addEventListener('click', () => allerA(5));
    document.getElementById('proto-2nm').addEventListener('click', () => allerA(2));
    document.getElementById('proto-suivi').addEventListener('click', () => {
        avion.suivi = !avion.suivi;
        majBoutonSuivi();
        if (avion.suivi) map.jumpTo({ center: [avion.lon, avion.lat] });
    });
}

demarrer().catch(e => {
    noterErreur('démarrage : ' + (e && e.message || e));
    afficherMessage('Le prototype n’a pas pu démarrer (' + (e && e.message || e) + '). Retourne à NPF-Q400.', true);
});
