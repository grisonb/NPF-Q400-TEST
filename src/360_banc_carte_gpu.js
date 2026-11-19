/*
 * v18.03 — BANC CARTE GPU, côté carte NPF-Q400 actuelle (Leaflet) : mêmes mesures que le prototype MapLibre
 * (prototype-carte.html), pour comparer les deux DIAG sur l'iPad. Rien ne change à l'affichage.
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

/* ==================== CÔTÉ LEAFLET (carte NPF-Q400 actuelle) ==================== */
/*
 * v18.03 — mesures du banc branchées en ÉCOUTE SEULE : écouteurs passifs sur le conteneur de la carte, écouteurs
 * « move » de la carte et « tileloadstart / tileload / tileerror / tileunload » du fond (aucun réglage du moteur de
 * tuiles, aucun redessin, rien d'enregistré). Résultat dans le DIAG exporté (section « BANC CARTE GPU »).
 */
let npfBancCarteLeaflet = null;
let npfBancCarteLeafletDernierMouvement = 0;

function getNpfBancCarteLeafletMemoire() {
    let dalles = 0;
    try { dalles = baseTileLayer && baseTileLayer._tiles ? Object.keys(baseTileLayer._tiles).length : 0; } catch (_) {}
    let images = 0;
    let canvasN = 0;
    let canvasOctets = 0;
    let plusGrand = '';
    let plusGrandPx = 0;
    try {
        const conteneur = map.getContainer();
        images = conteneur.querySelectorAll('img.leaflet-tile').length;
        conteneur.querySelectorAll('canvas').forEach(c => {
            canvasN += 1;
            const px = (Number(c.width) || 0) * (Number(c.height) || 0);
            canvasOctets += px * 4;
            if (px > plusGrandPx) { plusGrandPx = px; plusGrand = c.width + '×' + c.height; }
        });
    } catch (_) {}
    let tas = '';
    try { if (performance.memory) tas = ' | tas JS ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + ' Mo'; } catch (_) {}
    return dalles + ' dalles gardées par Leaflet (≈ ' + Math.round(dalles * 0.25) + ' Mo décodées) | ' + images + ' images de dalles | '
        + canvasN + ' canvas (≈ ' + Math.round(canvasOctets / 1048576) + ' Mo' + (plusGrand ? ', le plus grand ' + plusGrand : '') + ')' + tas;
}

function brancherNpfBancCarteLeafletFond() {
    const banc = npfBancCarteLeaflet;
    if (!banc || typeof baseTileLayer === 'undefined' || !baseTileLayer || baseTileLayer.__npfBancCarte) return;
    const couche = baseTileLayer;
    couche.__npfBancCarte = true;
    const cle = e => {
        const c = e && e.coords;
        return c ? (L.Util.stamp(couche) + ':' + c.z + '/' + c.x + '/' + c.y) : '';
    };
    couche.on('tileloadstart', e => banc.tuileDemandee(cle(e)));
    couche.on('tileload', e => banc.tuileAffichee(cle(e)));
    couche.on('tileerror', e => banc.tuileAbsente(cle(e)));
    couche.on('tileunload', e => banc.tuileOubliee(cle(e)));
}

function installNpfBancCarteLeaflet() {
    if (npfBancCarteLeaflet) return true;
    if (typeof map === 'undefined' || !map || typeof map.getContainer !== 'function' || !window.L) return false;
    const banc = npfBancCreer({
        nom: 'Leaflet ' + (L.version || '') + ' (carte NPF-Q400 actuelle)',
        contexteSansObjet: true,
        conteneur: () => map.getContainer(),
        dernierMouvement: () => npfBancCarteLeafletDernierMouvement,
        echelleNm: () => getCurrentNpfScaleNm(),
        couverture: () => {
            const c = getNpfCurrentZoomVisibleTileCoverage();
            return { total: c.total, chargees: c.loaded };
        },
        memoire: getNpfBancCarteLeafletMemoire
    });
    if (!banc.brancher()) return false;
    npfBancCarteLeaflet = banc;
    map.on('move', () => { npfBancCarteLeafletDernierMouvement = performance.now(); });
    brancherNpfBancCarteLeafletFond();
    /* Le fond est recréé à chaque changement de carte (src/100) : la nouvelle couche est branchée dans les 2 s. */
    setInterval(brancherNpfBancCarteLeafletFond, 2000);
    return true;
}

(function demarrerNpfBancCarteLeaflet() {
    let essais = 0;
    const essayer = () => {
        essais += 1;
        let ok = false;
        try { ok = installNpfBancCarteLeaflet(); } catch (_) { ok = false; }
        if (!ok && essais < 240) setTimeout(essayer, 1000);
    };
    setTimeout(essayer, 1000);
})();

/* Section du DIAG exporté (src/010 appendNpfDiagDetailExportSections). */
function appendNpfBancCarteGpuSection(lines) {
    if (!npfBancCarteLeaflet) {
        lines.push('');
        lines.push('################ BANC CARTE GPU (v18.03) ################');
        lines.push('Moteur : Leaflet (carte NPF-Q400 actuelle) | mesure pas encore branchée (carte non prête)');
        return;
    }
    npfBancCarteLeaflet.lignes().forEach(line => lines.push(line));
}

/*
 * v18.03 — bouton « Prototype carte GPU » du DIAG : ouvre la page à part prototype-carte.html dans la même fenêtre
 * (l'app installée sur l'écran d'accueil garde ses propres bases ; une autre fenêtre ne les verrait pas). Le centre,
 * le zoom de la carte et le trajet de la simulation lui sont passés dans l'adresse ; rien n'est modifié ici.
 */
function openNpfPrototypeCarteGpu() {
    const p = new URLSearchParams();
    p.set('appv', String(window.APP_VERSION || ''));
    try {
        const c = map.getCenter();
        p.set('lat', c.lat.toFixed(5));
        p.set('lon', c.lng.toFixed(5));
        p.set('z', String(map.getZoom()));
    } catch (_) {}
    try {
        if (isSimulationMode && Number.isFinite(Number(simulationMotionLatitude)) && Number.isFinite(Number(simulationMotionLongitude))) {
            p.set('alat', Number(simulationMotionLatitude).toFixed(5));
            p.set('alon', Number(simulationMotionLongitude).toFixed(5));
        }
    } catch (_) {}
    try {
        p.set('kt', String(Number(simulationSpeedKt) || 0));
        p.set('route', String(Math.round(getSimulationTrueRouteDeg())));
    } catch (_) {}
    try { npfDiagPersist(); } catch (_) {}
    window.location.href = 'prototype-carte.html?' + p.toString();
}
window.openNpfPrototypeCarteGpu = openNpfPrototypeCarteGpu;
