/*
 * NPF-Q400 TEST v18.09 (prototype inchangé depuis la v18.04) — PROTOTYPE de carte MapLibre GL JS (module de prototype-carte.html, page à part).
 * - Chargé SEULEMENT quand on ouvre la page (bouton « Prototype carte GPU » du DIAG) ; la carte NPF-Q400 n'est pas touchée.
 * - MapLibre GL JS 6.17.0 en copie locale (dossier maplibre-6.17.0) ; aucune requête vers un serveur extérieur ;
 *   textes dessinés sur l'appareil avec ses propres polices (aucun fichier de police, aucun serveur).
 * - Fond V11 et noms des communes lus dans les bases IndexedDB actuelles par addProtocol, renvoyés en ArrayBuffer.
 *   LECTURE SEULE STRICTE : bases ouvertes sans numéro de version, transactions « readonly » seulement, aucune
 *   création ni suppression de base ou de magasin, rien écrit dans localStorage ni dans les caches.
 * - Lignes HT lues dans le cache existant (lecture seule), dessinées par la puce graphique.
 * - v18.04 : zones SIA (contours, voiles P / D, bordures, noms), VFR et points, terrains SIA, icônes AER / VOL / PJE,
 *   PÉLIC et terrains de l'app (noms + fréquences à 2 NM), pistes, Calque Routier (numéros) : données préparées sur le PC
 *   (prototype-carte-donnees.json, -zones.geojson, -points.geojson) avec les couleurs et textes de l'app ; filtres de
 *   l'utilisateur lus en lecture seule ; routes lues dans le cache de l'app par un fil de calcul à part.
 * - Avion simulé, suivi, échelle en NM, boutons 20 / 5 / 2 NM, HT, Routes, trajet 30 / 60 min, Retour, DIAG.
 * - Pas de feux, WP, trafic ni popups.
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
 * v18.04 — en plus :
 * - couches affichées au début de chaque geste (adaptateur.couches()), des deux côtés ; gestes classés aussi à 20 NM ;
 * - session longue (trajet simulé en suivi ON) : images par seconde par tranche de 10 minutes (cadence
 *   requestAnimationFrame pendant tout le trajet, page visible), saccades, image la plus longue, dalles blanches
 *   relevées toutes les 5 s, « carte vide plus de 2 s » ; la boucle d'images ne tourne QUE pendant un trajet.
 */
function npfBancCreer(adaptateur) {
    const SACCADE_MS = 50;
    const VIDE_ALERTE_MS = 2000;
    const SUIVI_RETOUR_MAX_MS = 30000;
    const TRANCHE_MS = Number(adaptateur.trancheMs) > 0 ? Number(adaptateur.trancheMs) : 600000;
    const ECHANTILLON_MS = 5000;
    const B = {
        trajets: [],
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
    const lireCouches = () => {
        try { return String(adaptateur.couches ? adaptateur.couches() : '') || '—'; } catch (_) { return '—'; }
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
            echelleNm: (() => { try { return adaptateur.echelleNm(); } catch (_) { return NaN; } })(),
            couches: lireCouches()
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
            dallesFin: cov.total,
            couches: g.couches
        };
        B.gestes.push(enregistrement);
        while (B.gestes.length > 200) B.gestes.shift();
        const cle = enregistrement.type + '|' + enregistrement.echelle;
        const cat = B.categories[cle] || (B.categories[cle] = { type: enregistrement.type, echelle: enregistrement.echelle, gestes: 0, dts: [], blanches: [], couches: {} });
        cat.gestes += 1;
        cat.couches[enregistrement.couches] = (cat.couches[enregistrement.couches] || 0) + 1;
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

    /* ---------- Session longue (trajet simulé) : tranches de 10 minutes ---------- */
    let trajet = null;
    const nouvelleTranche = () => ({ images: 0, histo: new Uint32Array(1001), saccades: 0, maxDt: 0, blanches: [], vides: 0, videLongs: 0, couches: {} });
    function imageTrajet(t) {
        const tr = trajet;
        if (!tr || tr.fini) return;
        if (tr.derniere !== null) {
            const dt = t - tr.derniere;
            /* Écart de plus d'1 s : page cachée ou mise en pause par le système, pas une image affichée. */
            if (dt > 0 && dt <= 1000) {
                const i = Math.min(Math.floor((Date.now() - tr.debut) / TRANCHE_MS), 200);
                while (tr.tranches.length <= i) tr.tranches.push(nouvelleTranche());
                const s = tr.tranches[i];
                s.images += 1;
                s.histo[Math.min(1000, Math.round(dt))] += 1;
                if (dt > SACCADE_MS) s.saccades += 1;
                if (dt > s.maxDt) s.maxDt = dt;
            }
        }
        tr.derniere = t;
        requestAnimationFrame(imageTrajet);
    }
    function echantillonTrajet() {
        const tr = trajet;
        if (!tr || tr.fini || document.visibilityState === 'hidden') {
            if (tr) tr.videDepuis = null;
            return;
        }
        const i = Math.min(Math.floor((Date.now() - tr.debut) / TRANCHE_MS), 200);
        while (tr.tranches.length <= i) tr.tranches.push(nouvelleTranche());
        const s = tr.tranches[i];
        const cov = couverture();
        s.blanches.push(Math.max(0, cov.total - cov.chargees));
        let c = lireCouches();
        try { c = libelleEchelle(adaptateur.echelleNm()) + ' · ' + c; } catch (_) {}
        s.couches[c] = (s.couches[c] || 0) + 1;
        const vide = contextePerdu || (cov.total > 0 && cov.chargees === 0);
        if (vide) {
            s.vides += 1;
            if (tr.videDepuis === null) tr.videDepuis = maintenant();
            else if (maintenant() - tr.videDepuis > VIDE_ALERTE_MS && !tr.videCompte) { s.videLongs += 1; tr.videCompte = true; }
        } else {
            tr.videDepuis = null;
            tr.videCompte = false;
        }
    }
    const histoValeur = (histo, total, p) => {
        /* Durée d'image au rang p (0..1) : p = 0,5 médiane ; p = 0,95 = les 5 % d'images les plus longues. */
        if (!total) return NaN;
        const rang = Math.max(1, Math.ceil(p * total));
        let cumul = 0;
        for (let ms = 0; ms < histo.length; ms += 1) {
            cumul += histo[ms];
            if (cumul >= rang) return Math.max(1, ms);
        }
        return histo.length - 1;
    };
    const plusFrequent = obj => {
        let best = '—', n = -1, total = 0;
        Object.entries(obj || {}).forEach(([k, v]) => { total += v; if (v > n) { best = k; n = v; } });
        return total ? best + (Object.keys(obj).length > 1 ? ' (' + Math.round(n * 100 / total) + ' % du temps)' : '') : '—';
    };

    const banc = {
        etat: B,
        brancher,
        trajetDebut(description) {
            if (trajet && !trajet.fini) banc.trajetFin('remplacé par un nouveau trajet');
            trajet = { a: Date.now(), debut: Date.now(), description: String(description || ''), tranches: [nouvelleTranche()], derniere: null, fini: false, finA: null, raison: '', videDepuis: null, videCompte: false, minuterie: null };
            B.trajets.push(trajet);
            while (B.trajets.length > 6) B.trajets.shift();
            trajet.minuterie = setInterval(echantillonTrajet, ECHANTILLON_MS);
            requestAnimationFrame(imageTrajet);
        },
        trajetFin(raison) {
            const tr = trajet;
            if (!tr || tr.fini) return;
            tr.fini = true;
            tr.finA = Date.now();
            tr.raison = String(raison || 'fini');
            clearInterval(tr.minuterie);
            tr.minuterie = null;
        },
        trajetEnCours() {
            return !!(trajet && !trajet.fini);
        },
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
            L.push('################ BANC CARTE GPU (v18.04) ################');
            L.push('Moteur : ' + adaptateur.nom + ' | écran ' + ecran + ' | mesure depuis ' + heure(B.debut));
            L.push('Méthode : images/s = cadence d’affichage (requestAnimationFrame) de la pose du doigt à la fin de l’inertie ; saccade = image de plus de ' + SACCADE_MS + ' ms ; échelle lue au début du geste');
            L.push('Couches maintenant : ' + lireCouches());
            L.push('Gestes : ' + B.gestes.length + ' mesuré(s)');
            const ordre = ['glissement|20 NM', 'glissement|5 NM', 'glissement|2 NM', 'pincement|20 NM', 'pincement|5 NM', 'pincement|2 NM'];
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
                Object.entries(cat.couches || {}).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => L.push('      couches (' + n + ' geste' + (n > 1 ? 's' : '') + ') : ' + c));
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
            L.push('Session longue (trajet simulé, suivi ON) : ' + B.trajets.length + ' trajet(s) | tranches de ' + (TRANCHE_MS >= 60000 ? Math.round(TRANCHE_MS / 60000) + ' min' : Math.round(TRANCHE_MS / 1000) + ' s (essai)'));
            B.trajets.forEach(tr => {
                L.push('  ' + tr.description + ' | début ' + heure(tr.debut) + ' | ' + (tr.fini ? 'fin ' + heure(tr.finA) + ' (' + tr.raison + ', ' + duree(tr.finA - tr.debut) + ')' : 'en cours depuis ' + duree(Date.now() - tr.debut)));
                tr.tranches.forEach((s, i) => {
                    const unite = TRANCHE_MS >= 60000 ? 60000 : 1000, nomUnite = unite === 60000 ? ' min' : ' s';
                    const de = Math.round(i * TRANCHE_MS / unite), a = Math.round((i + 1) * TRANCHE_MS / unite);
                    if (!s.images && !s.blanches.length) {
                        L.push('    ' + de + '-' + a + nomUnite + ' : aucune image (page cachée ?)');
                        return;
                    }
                    const bl = s.blanches;
                    const moyBl = bl.length ? bl.reduce((x, y) => x + y, 0) / bl.length : 0;
                    L.push('    ' + de + '-' + a + nomUnite + ' : ' + s.images + ' images | médiane ' + ips(histoValeur(s.histo, s.images, 0.5)) + ' i/s | 5 % les plus lentes ≤ ' + ips(histoValeur(s.histo, s.images, 0.95)) + ' i/s'
                        + ' | saccades ' + s.saccades + ' | image max ' + Math.round(s.maxDt) + ' ms | dalles blanches moy ' + moyBl.toFixed(1).replace('.', ',') + ' / max ' + (bl.length ? Math.max(...bl) : 0)
                        + ' | carte vide : ' + s.vides + ' relevé(s)' + (s.videLongs ? ' | ⚠ CARTE BLANCHE ' + s.videLongs + ' fois (vide plus de 2 s)' : ''));
                    L.push('      couches : ' + plusFrequent(s.couches));
                });
            });
            L.push('Derniers gestes (' + Math.min(30, B.gestes.length) + ') :');
            B.gestes.slice(-30).forEach(g => {
                L.push('  ' + heure(g.a) + ' | ' + g.type + ' ' + g.echelle + (g.echelleFin !== g.echelle ? ' -> ' + g.echelleFin : '')
                    + ' | ' + (g.dureeMs / 1000).toFixed(2).replace('.', ',') + ' s · ' + g.images + ' images'
                    + ' | moy ' + g.ipsMoy + ' · médiane ' + g.ipsMed + ' · pire ' + g.ipsPire + ' i/s'
                    + ' | saccades ' + g.saccades + ' | blanches fin ' + g.blanches + '/' + g.dallesFin
                    + ' | couches : ' + (g.couches || '—'));
            });
            return L;
        }
    };
    return banc;
}
/* ==== BANC CARTE GPU — FIN DU CODE COMMUN ==== */

/* ==================== PROTOTYPE ==================== */
const APPV = 'v18.09';
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
/* v18.04 — données préparées sur le PC (générateur hors dépôt, qui fait tourner la vraie app) : aucun calcul lourd ici. */
const DONNEES_URL = 'prototype-carte-donnees.json';
const ZONES_URL = 'prototype-carte-zones.geojson';
const POINTS_URL = 'prototype-carte-points.geojson';
/* Calque Routier : mêmes noms que l'app (src/030), lus en lecture seule par un fil de calcul à part. */
const ROUTES_DESCRIPTION_CLE = 'npfRoadOverlayManifestV1';
/* Polices : celles de l'appareil (mêmes familles que la carte actuelle) ; « npf black » ne sert qu'à demander la graisse 900. */
const POLICE_TEXTE = ['npf black', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Arial'];
const POLICE_ROUTES = ['npf black', 'Arial', 'Helvetica'];
/* Trajet simulé (même trajet que la carte actuelle, src/360) : Valence (LFLU) -> Marseille, demi-tour à 30 min. */
const TRAJET = Object.freeze({ depart: [44.91247778, 4.96578056], arrivee: [43.2965, 5.3698], nom: 'Valence (LFLU)', but: 'Marseille' });

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
    messages: [],
    /* v18.04 — temps d'ouverture (ms depuis le début du chargement de la page) et longues tâches (Chrome seulement). */
    temps: {},
    longues: { n: 0, max: 0, totalMs: 0, liste: [] },
    routes: { demandes: 0, chargees: 0, entites: 0, dureesMs: [], source: '', erreurs: 0, derniere: '' }
};
const marquer = nom => { if (journal.temps[nom] === undefined) journal.temps[nom] = Math.round(performance.now()); };
marquer('script');
try {
    new PerformanceObserver(liste => {
        liste.getEntries().forEach(e => {
            const L = journal.longues;
            L.n += 1; L.totalMs += e.duration; L.max = Math.max(L.max, e.duration);
            L.liste.push([Math.round(e.startTime), Math.round(e.duration)]);
            L.liste.sort((a, b) => b[1] - a[1]);
            if (L.liste.length > 6) L.liste.length = 6;
        });
    }).observe({ type: 'longtask', buffered: true });
} catch (_) {}
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
function lireJson(cle, defaut) {
    try {
        const v = JSON.parse(lireLocal(cle) || 'null');
        return v === null || v === undefined ? defaut : v;
    } catch (_) {
        return defaut;
    }
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
const echelleCourante = () => {
    if (!map) return Infinity;
    const c = map.getCenter();
    return choisirEchelle(metresParPixel(c.lat, map.getZoom()) * 110 / 1852);
};

/* ---------- Préférences de l'utilisateur (filtres SIA, PÉLIC…) : LECTURE de localStorage seulement ---------- */
const PREFS = { cles: [], zones: true, vrp: true, fl115: false, desactives: [], eau: [], pelicAjoutes: [], ht: false, routes: false, filtresActifs: 0 };
function lirePreferences(donnees) {
    const r = donnees.regles || {};
    const filtres = lireJson(r.cleFiltres || 'npfSiaLayerPrefs_v1', {});
    const prefs = filtres && typeof filtres === 'object' && !Array.isArray(filtres) ? { ...filtres } : {};
    /* Même reprise que l'app (src/340 migrateSiaSivFilterPreference), sans rien enregistrer. */
    if (prefs['ase:SIV'] === undefined && prefs['ase:RAS'] !== undefined) prefs['ase:SIV'] = prefs['ase:RAS'] === true;
    const cleFl = r.cleFl115 || '__npfHideAirspacesAboveFL115';
    PREFS.cles = Object.entries(prefs).filter(([k, v]) => k !== cleFl && v === true).map(([k]) => k);
    PREFS.filtresActifs = PREFS.cles.length;
    PREFS.fl115 = prefs[cleFl] === true;
    PREFS.zones = lireLocal(r.cleZonesVisibles || 'npfSiaMapAirspacesVisible_v1') !== 'false';
    PREFS.vrp = lireLocal(r.cleVrpVisibles || 'npfSiaMapVrpVisible_v1') !== 'false';
    const ensemble = cle => { const v = lireJson(cle, []); return Array.isArray(v) ? v.map(x => String(x || '').trim().toUpperCase()).filter(Boolean) : []; };
    PREFS.desactives = ensemble('disabled_airports');
    PREFS.eau = ensemble('water_airports');
    PREFS.pelicAjoutes = ensemble('custom_pelican_airports');
    PREFS.ht = lireLocal('showHighVoltageLinesLayer') === 'true';
    PREFS.routes = lireLocal('showRoadOverlayLayer') === 'true';
}

/* ---------- Banc et carte ---------- */
let map = null;
let DONNEES = null;
let dernierMouvement = 0;
let contexteGlPerdu = false;
const dallesPretes = new Set();
const dallesAbsentes = new Set();
const cleDalle = (z, x, y) => `${z}/${x}/${y}`;
const ETAT = { ht: false, routes: false, echelle: null };

const banc = npfBancCreer({
    nom: 'MapLibre GL JS ' + MAPLIBRE_VERSION + ' (prototype)',
    contexteSansObjet: false,
    trancheMs: nombre('tranche', 0) > 0 ? nombre('tranche', 0) * 1000 : 0,
    conteneur: () => (map ? map.getCanvasContainer() : null),
    dernierMouvement: () => dernierMouvement,
    echelleNm: () => echelleCourante(),
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
            + ' | dalles noms : ' + compter('noms') + ' | dalles zones : ' + compter('zones') + ' | dalles points : ' + compter('points') + ' | dalles routes : ' + compter('routes')
            + ' | cache réglé à ' + MAX_DALLES_CACHE + ' dalles par source (256 Ko chacune sur la puce graphique)' + tas;
    },
    couches: () => texteCouches()
});

/* ---------- Avion simulé (même mouvement que la simulation de l'app : pas de 500 ms, ligne droite, même formule) ---------- */
const avion = {
    lat: nombre('alat', nombre('lat', 44.7)),
    lon: nombre('alon', nombre('lon', 4.65)),
    vitesseKt: nombre('kt', 0) > 0 ? nombre('kt', 0) : 120,
    routeVraie: ((nombre('route', 0) % 360) + 360) % 360,
    dernierPas: 0,
    suivi: false
};
/* Même calcul que l'app (src/260 calculateDestinationLatLng, rayon 6 371 000 m) : même trajet des deux côtés. */
function destination(lat, lon, capDeg, distanceM) {
    const R = 6371000;
    const d = distanceM / R, c = capDeg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(c));
    const l2 = l1 + Math.atan2(Math.sin(c) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * 180 / Math.PI, ((l2 * 180 / Math.PI + 540) % 360) - 180];
}
function geojsonAvion() {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cap: avion.routeVraie }, geometry: { type: 'Point', coordinates: [avion.lon, avion.lat] } }] };
}
let doigtsPoses = 0;
/* Trajet simulé (boutons « Trajet 30 min » / « Trajet 60 min ») : même calcul que src/360. */
let trajet = null;
function calculerTrajet() {
    const r = Math.PI / 180;
    const [la1, lo1] = TRAJET.depart, [la2, lo2] = TRAJET.arrivee;
    const p1 = la1 * r, p2 = la2 * r, dl = (lo2 - lo1) * r;
    const route = ((Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / r) + 360) % 360;
    const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const distanceNm = 2 * 6371000 * Math.asin(Math.sqrt(a)) / 1852;
    return { route, retour: (route + 180) % 360, distanceNm, vitesseKt: 2 * distanceNm };
}
function majBoutonsTrajet() {
    document.querySelectorAll('.proto-trajet').forEach(b => {
        const actif = !!trajet && Number(b.dataset.trajet) === trajet.minutes;
        b.setAttribute('aria-pressed', actif ? 'true' : 'false');
        b.textContent = actif ? 'Arrêter le trajet' : 'Trajet ' + b.dataset.trajet + ' min';
    });
    const etat = document.getElementById('proto-trajet-etat');
    if (!trajet) { etat.hidden = true; return; }
    const reste = Math.max(0, trajet.minutes * 60000 - trajet.ecouleMs);
    etat.hidden = false;
    etat.textContent = 'Trajet ' + trajet.minutes + ' min · ' + (trajet.retourFait ? 'retour vers ' + TRAJET.nom : 'vers ' + TRAJET.but) + ' · reste ' + Math.ceil(reste / 60000) + ' min';
}
function arreterTrajet(raison = 'arrêté') {
    if (!trajet) return;
    const t = trajet;
    trajet = null;
    avion.vitesseKt = t.avant.vitesse;
    avion.routeVraie = t.avant.route;
    banc.trajetFin(raison);
    majBoutonsTrajet();
}
function demarrerTrajet(minutes) {
    if (!map) return;
    if (trajet) arreterTrajet('remplacé par un nouveau trajet');
    const duree = Number(minutes) >= 60 ? 60 : 30;
    const calc = calculerTrajet();
    trajet = { minutes: duree, ecouleMs: 0, retourFait: false, calc, avant: { vitesse: avion.vitesseKt, route: avion.routeVraie } };
    avion.lat = TRAJET.depart[0];
    avion.lon = TRAJET.depart[1];
    avion.vitesseKt = calc.vitesseKt;
    avion.routeVraie = calc.route;
    avion.dernierPas = performance.now();
    avion.suivi = true;
    majBoutonSuivi();
    map.jumpTo({ center: [avion.lon, avion.lat] });
    const src = map.getSource('avion');
    if (src) src.setData(geojsonAvion());
    banc.trajetDebut('Trajet ' + duree + ' min ' + TRAJET.nom + (duree >= 60 ? ' ⇄ ' : ' → ') + TRAJET.but
        + ' | ' + Math.round(calc.vitesseKt) + ' kt, route vraie ' + Math.round(calc.route) + '° | suivi ON | prototype (MapLibre)');
    majBoutonsTrajet();
}
function pasSimulation() {
    const n = performance.now();
    if (document.hidden || !map) { avion.dernierPas = n; return; }
    const ecoule = avion.dernierPas > 0 ? Math.min(1, Math.max(0, (n - avion.dernierPas) / 1000)) : SIMULATION_PAS_MS / 1000;
    avion.dernierPas = n;
    const [la, lo] = destination(avion.lat, avion.lon, avion.routeVraie, avion.vitesseKt * 1852 * ecoule / 3600);
    avion.lat = la;
    avion.lon = lo;
    if (trajet) {
        trajet.ecouleMs += ecoule * 1000;
        if (!trajet.retourFait && trajet.minutes >= 60 && trajet.ecouleMs >= 30 * 60000) {
            trajet.retourFait = true;
            avion.routeVraie = trajet.calc.retour;
        }
        if (trajet.ecouleMs >= trajet.minutes * 60000) arreterTrajet('fini');
        else if (Math.floor(trajet.ecouleMs / 30000) !== Math.floor((trajet.ecouleMs - ecoule * 1000) / 30000)) majBoutonsTrajet();
    }
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

/* ---------- Images (dessinées une fois à l'ouverture, sur l'appareil) ---------- */
const DPR = 2;
const pxCss = v => { const n = parseFloat(String(v || '')); return Number.isFinite(n) ? n : 0; };
function toile(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * DPR);
    c.height = Math.ceil(h * DPR);
    const g = c.getContext('2d');
    g.scale(DPR, DPR);
    return { c, g };
}
const imageDe = ({ c, g }) => g.getImageData(0, 0, c.width, c.height);
function rectArrondi(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}
/* Boîte étirable (fond + bordure arrondie) pour icon-text-fit : étiquettes des points, terrains, routes, noms de terrains. */
function ajouterBoite(id, fond, bordure, epaisseur, rayon, ombre = null) {
    const m = Math.ceil(rayon + epaisseur + 2);
    const w = m * 2 + 4, h = m * 2 + 4;
    const t = toile(w, h);
    if (ombre) { t.g.shadowColor = ombre; t.g.shadowBlur = 3; t.g.shadowOffsetY = 1; }
    rectArrondi(t.g, 1.5 + epaisseur / 2, 1.5 + epaisseur / 2, w - 3 - epaisseur, h - 3 - epaisseur, rayon);
    t.g.fillStyle = fond;
    t.g.fill();
    t.g.shadowColor = 'transparent';
    if (epaisseur > 0) { t.g.lineWidth = epaisseur; t.g.strokeStyle = bordure; t.g.stroke(); }
    /* Contenu = tout l'intérieur de la bordure : la boîte entoure le texte comme dans l'app (padding CSS seulement). */
    const c = Math.ceil(1.5 + epaisseur);
    map.addImage(id, imageDe(t), {
        pixelRatio: DPR,
        stretchX: [[m * DPR, (w - m) * DPR]],
        stretchY: [[m * DPR, (h - m) * DPR]],
        content: [c * DPR, c * DPR, (w - c) * DPR, (h - c) * DPR]
    });
}
/* Icônes AER / VOL / PJE (copie du dessin de l'app, src/350 getSiaDotherRadioSprite / getSiaDotherEmojiSprite). */
function dessinerRadio(c, B) {
    const dy = 0.07 * B; /* contenu de 0,07 B à 0,93 B : centré verticalement */
    c.fillStyle = '#000000';
    c.strokeStyle = '#000000';
    /* antenne courte, sortant du haut du boîtier */
    c.lineCap = 'round';
    c.lineWidth = 0.11 * B;
    c.beginPath();
    c.moveTo(0.64 * B, 0.07 * B + dy);
    c.lineTo(0.64 * B, 0.3 * B + dy);
    c.stroke();
    /* boîtier rectangulaire aux coins arrondis */
    const x = 0.08 * B, y = 0.28 * B + dy, w = 0.84 * B, h = 0.58 * B, r = 0.14 * B;
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.fill();
    /* deux manches : cercle blanc et point noir au centre */
    for (const cx of [0.3 * B, 0.7 * B]) {
        const cy = 0.57 * B + dy;
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(cx, cy, 0.155 * B, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#000000';
        c.beginPath();
        c.arc(cx, cy, 0.06 * B, 0, Math.PI * 2);
        c.fill();
    }
}
function ajouterIcone(id, symbole, retourne) {
    const r = DONNEES.regles || {};
    const D = Number(r.iconeDisquePx) || 20, B = Number(r.iconeDessinPx) || 14;
    const t = toile(D + 2, D + 2);
    const cx = (D + 2) / 2;
    t.g.beginPath();
    t.g.arc(cx, cx, D / 2, 0, Math.PI * 2);
    t.g.fillStyle = 'rgba(255,255,255,0.85)';
    t.g.fill();
    t.g.lineWidth = 1;
    t.g.strokeStyle = 'rgba(0,0,0,0.35)';
    t.g.stroke();
    if (symbole === 'radiocommande') {
        t.g.save();
        t.g.translate(cx - B / 2, cx - B / 2);
        dessinerRadio(t.g, B);
        t.g.restore();
    } else {
        /* Émoji de l'appareil (Apple Color Emoji sur l'iPad), centré, retourné pour la voltige comme dans l'app. */
        const k = 4, cote = B * k * 3;
        const tmp = document.createElement('canvas');
        tmp.width = cote; tmp.height = cote;
        const gt = tmp.getContext('2d', { willReadFrequently: true });
        gt.font = `${B * k}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        gt.textAlign = 'center';
        gt.textBaseline = 'middle';
        gt.fillStyle = '#000000';
        gt.fillText(symbole, cote / 2, cote / 2);
        const d = gt.getImageData(0, 0, cote, cote).data;
        let x0 = cote, x1 = -1, y0 = cote, y1 = -1;
        for (let y = 0; y < cote; y += 1) for (let x = 0; x < cote; x += 1) if (d[(y * cote + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 >= 0) {
            const w = x1 - x0 + 1, h = y1 - y0 + 1, f = Math.min(1, B * k / w, B * k / h) / k;
            t.g.save();
            t.g.translate(cx, cx);
            if (retourne) t.g.scale(1, -1);
            t.g.drawImage(tmp, x0, y0, w, h, -w * f / 2, -h * f / 2, w * f, h * f);
            t.g.restore();
        }
    }
    map.addImage(id, imageDe(t), { pixelRatio: DPR });
}
/* PÉLIC (src/210 + CSS de l'app lu par le générateur) : disque coloré, avion noir, X rouge si désactivé, taille selon le zoom. */
const AVION_PELIC = 'M11.2 2.4c0-.9 1.6-.9 1.6 0v5.7l7.7 3.9c.7.35 1 .95.8 1.6l-.35 1.15-8.15-1.95v5.1l2.75 2.05-.3 1.25L12 20.3l-3.25.9-.3-1.25 2.75-2.05v-5.1l-8.15 1.95-.35-1.15c-.2-.65.1-1.25.8-1.6l7.7-3.9V2.4Z';
function ajouterPelic(id, etat, metrique) {
    const st = ((DONNEES.styles || {}).pelic || {})[etat] || {};
    const disque = st.disque || {}, avionSt = st.avion || {}, x = st.x || {};
    const bord = Number(metrique.border) || 4;
    const contenu = String(disque['box-sizing'] || '') === 'border-box';
    const total = contenu ? metrique.size : metrique.size + 2 * bord;
    const t = toile(total + 2, total + 2);
    const cx = (total + 2) / 2;
    t.g.beginPath();
    t.g.arc(cx, cx, total / 2 - bord / 2, 0, Math.PI * 2);
    t.g.fillStyle = disque['background-color'] || '#39ff14';
    t.g.fill();
    t.g.lineWidth = bord;
    t.g.strokeStyle = disque['border-top-color'] || '#ffffff';
    t.g.stroke();
    if (etat === 'desactive') {
        const L = Number(metrique.xLine) || 16, W = Number(metrique.xWeight) || 3;
        t.g.save();
        t.g.translate(cx, cx);
        t.g.fillStyle = x['background-color'] || '#d00000';
        [45, -45].forEach(a => { t.g.save(); t.g.rotate(a * Math.PI / 180); t.g.fillRect(-L / 2, -W / 2, L, W); t.g.restore(); });
        t.g.restore();
    } else {
        const A = Number(metrique.aircraft) || 17;
        t.g.save();
        t.g.translate(cx - A / 2, cx - A / 2);
        t.g.scale(A / 24, A / 24);
        t.g.fillStyle = avionSt.fill && avionSt.fill !== 'none' ? avionSt.fill : '#111111';
        t.g.fill(new Path2D(AVION_PELIC));
        t.g.restore();
    }
    map.addImage(id, imageDe(t), { pixelRatio: DPR });
}
/* Terrains (src/190 buildTerrainAirportSymbolHtml) : fond fixe + piste tournée (icon-rotate), même dessin que l'app. */
function ajouterTerrain(id, inverse, taille) {
    const k = taille / 64;
    const bleu = '#3358d4', fond = inverse ? '#ffffff' : bleu, trait = inverse ? bleu : '#ffffff';
    const t = toile(taille, taille);
    t.g.scale(k, k);
    if (!inverse) {
        [[28, 2.5, 8, 10], [28, 51.5, 8, 10], [2.5, 28, 10, 8], [51.5, 28, 10, 8]].forEach(([x, y, w, h]) => {
            rectArrondi(t.g, x, y, w, h, 2.4);
            t.g.fillStyle = fond; t.g.fill();
            t.g.lineWidth = 3; t.g.strokeStyle = trait; t.g.stroke();
        });
    }
    t.g.beginPath(); t.g.arc(32, 32, 20.5, 0, Math.PI * 2);
    t.g.fillStyle = fond; t.g.fill();
    t.g.lineWidth = 4; t.g.strokeStyle = bleu; t.g.stroke();
    if (!inverse) { t.g.beginPath(); t.g.arc(32, 32, 20.5, 0, Math.PI * 2); t.g.lineWidth = 1.6; t.g.globalAlpha = 0.95; t.g.strokeStyle = '#ffffff'; t.g.stroke(); t.g.globalAlpha = 1; }
    map.addImage(id, imageDe(t), { pixelRatio: DPR });
    const p = toile(taille, taille);
    p.g.scale(k, k);
    rectArrondi(p.g, 15, 27.6, 34, 8.8, 4.4);
    p.g.fillStyle = inverse ? bleu : '#ffffff';
    p.g.fill();
    map.addImage(id + '-piste', imageDe(p), { pixelRatio: DPR });
}
function preparerImages() {
    const S = DONNEES.styles || {};
    map.addImage('avion', dessinerAvion(), { pixelRatio: 2 });
    const et = S.etiquettes || {};
    const boiteDe = (id, s, defauts) => {
        const v = s || {};
        ajouterBoite(id, v['background-color'] || defauts[0], v['border-top-color'] || defauts[1], pxCss(v['border-top-width']) || defauts[2], pxCss(v['border-top-left-radius']) || defauts[3], defauts[4] || null);
    };
    boiteDe('boite-point', et.point, ['rgba(255,255,255,0.92)', 'rgba(17,24,39,0.65)', 1, 4, 'rgba(0,0,0,0.25)']);
    boiteDe('boite-terrain', et.terrain, ['#e7f2ff', '#0b2f6b', 1, 4, 'rgba(0,0,0,0.25)']);
    const ro = S.routes || {};
    boiteDe('route-A', ro.A, ['#e85d04', '#ffffff', 2, 6, 'rgba(0,0,0,0.58)']);
    boiteDe('route-N', ro.N, ['#d62828', '#ffffff', 2, 6, 'rgba(0,0,0,0.58)']);
    boiteDe('route-D', ro.D, ['#f0c419', '#ffffff', 2, 6, 'rgba(0,0,0,0.58)']);
    const tn = (S.terrainNom || {}).boite || {};
    ajouterBoite('boite-nom-terrain', tn['background-color'] || 'rgba(255,255,255,0.82)', 'transparent', 0, pxCss(tn['border-top-left-radius']) || 4, 'rgba(0,0,0,0.12)');
    const icones = DONNEES.icones || {}, retournees = DONNEES.iconesRetournees || {};
    Object.entries(icones).forEach(([code, symbole]) => ajouterIcone('icone-' + code, symbole, !!retournees[code]));
    (S.pelicTailles || [{ zoomLeaflet: 9, size: 26, border: 4, aircraft: 17, xLine: 16, xWeight: 3 }]).forEach(m => {
        ['retardant', 'eau', 'desactive'].forEach(etat => ajouterPelic('pelic-' + etat + '-' + m.zoomLeaflet, etat, m));
    });
    ajouterTerrain('terrain-choix', false, 30);
    ajouterTerrain('terrain-ajoute', true, 22);
}

/* ---------- Couches SIA, terrains, pistes (données du PC + préférences de l'utilisateur) ---------- */
const TYPE_PT = ['get', 'g'];
function filtreSia() {
    return ['in', ['get', 'f'], ['literal', PREFS.cles]];
}
function filtreFl115() {
    const lim = Number((DONNEES.regles || {}).fl115Pieds) || 11500;
    return PREFS.fl115 ? ['any', ['!', ['has', 'lf']], ['<', ['get', 'lf'], lim]] : true;
}
function estPelic() {
    return ['any', ['==', TYPE_PT, 'pelic'], ['all', ['==', TYPE_PT, 'autre'], ['in', ['get', 'oaci'], ['literal', PREFS.pelicAjoutes]]]];
}
function etatPelic() {
    return ['case', ['in', ['get', 'oaci'], ['literal', PREFS.desactives]], 'desactive', ['in', ['get', 'oaci'], ['literal', PREFS.eau]], 'eau', 'retardant'];
}
function tailleNoms() {
    const z = (DONNEES.styles || {}).zoneNoms || {};
    const t = (v, d) => pxCss(v) || d;
    const lot = s => ({ nom: t(s && s.nom && s.nom['font-size'], 11), fr: t(s && s.frequence && s.frequence['font-size'], 12), alt: t(s && s.altitude && s.altitude['font-size'], 10) });
    return { loin: lot(z.loin), pres: lot(z.pres), sivLoin: lot(z.sivLoin), sivPres: lot(z.sivPres), couleur: (z.loin && z.loin.nom && z.loin.nom.color) || '#000000' };
}
function texteNomsZones(pres) {
    const T = tailleNoms();
    const a = pres ? T.pres : T.loin, s = pres ? T.sivPres : T.sivLoin;
    const echelle = (cle) => ['case', ['has', 'siv'], s[cle] / s.nom, a[cle] / a.nom];
    return ['format',
        ['get', 'n1'], {},
        ['case', ['has', 'n2'], ['concat', '\n', ['get', 'n2']], ''], { 'font-scale': echelle('fr') },
        ['case', ['has', 'n3'], ['concat', '\n', ['get', 'n3']], ''], { 'font-scale': echelle('alt') }
    ];
}
function tailleNomsZones(pres) {
    const T = tailleNoms();
    return ['case', ['has', 'siv'], (pres ? T.sivPres : T.sivLoin).nom, (pres ? T.pres : T.loin).nom];
}

function construireCouches(couches, sources) {
    const R = DONNEES.regles || {};
    const zl = v => Math.max(0, Number(v) - 1);
    /* Leaflet -> MapLibre : même dalle de 256 px = un zoom de moins. */
    const contourZoom = zl(R.contourZoomLeaflet || 9);
    const pistesZoom = zl(R.pistesZoomLeaflet || 12);
    const ajoutesZoom = zl(R.terrainsAjoutesZoomLeaflet || 7);

    /* Pistes (z390, sous les routes). */
    couches.push({ id: 'pistes-blanc', type: 'line', source: 'points', minzoom: pistesZoom, filter: ['==', TYPE_PT, 'piste'], layout: { 'line-cap': 'butt', 'line-join': 'miter' }, paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.96 } });
    couches.push({ id: 'pistes-noir', type: 'line', source: 'points', minzoom: pistesZoom, filter: ['==', TYPE_PT, 'piste'], layout: { 'line-cap': 'butt', 'line-join': 'miter' }, paint: { 'line-color': '#111111', 'line-width': 2.4, 'line-opacity': 1 } });

    /* Calque Routier (z405 / 410 / 415) : mêmes couleurs, épaisseurs et seuils que src/120. */
    sources.routes = { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: 12, tolerance: 0.375, buffer: 64 };
    const largeur = (c, fort) => {
        if (c === 'A') return ['step', ['zoom'], fort ? 5.5 : 3.9, 11, fort ? 6.3 : 4.6];
        if (c === 'N') return ['step', ['zoom'], fort ? 4.9 : 3.3, 11, fort ? 5.6 : 4.0];
        return ['step', ['zoom'], fort ? 4.2 : 2.5, 12, fort ? 4.8 : 3.0];
    };
    const classes = [['A', ['==', ['get', 'c'], 'A'], '#e85d04', 10], ['N', ['in', ['get', 'c'], ['literal', ['N', 'T']]], '#d62828', 11], ['D', ['in', ['get', 'c'], ['literal', ['D', 'M']]], '#f0a202', 11]];
    classes.forEach(([c, f, couleur, zmin]) => couches.push({ id: 'routes-bord-' + c, type: 'line', source: 'routes', minzoom: zmin, filter: f, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': '#ffffff', 'line-width': largeur(c, true), 'line-opacity': 0.32 } }));
    classes.forEach(([c, f, couleur, zmin]) => couches.push({ id: 'routes-' + c, type: 'line', source: 'routes', minzoom: zmin, filter: f, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': couleur, 'line-width': largeur(c, false), 'line-opacity': 0.78 } }));
    const ro = (DONNEES.styles || {}).routes || {};
    const couleurTexte = (s, d) => (s && s.color) || d;
    couches.push({
        id: 'routes-numeros', type: 'symbol', source: 'routes', minzoom: 10,
        filter: ['any', ['==', ['get', 'c'], 'A'], ['>=', ['zoom'], 11]],
        layout: {
            visibility: 'none',
            'symbol-placement': 'line',
            'symbol-spacing': ['step', ['zoom'], 240, 11, 280, 12, 300],
            'text-field': ['get', 'ref'],
            'text-font': POLICE_ROUTES,
            'text-size': pxCss(ro.A && ro.A['font-size']) || 13,
            'text-rotation-alignment': 'viewport',
            'icon-rotation-alignment': 'viewport',
            'icon-image': ['match', ['get', 'c'], 'A', 'route-A', ['N', 'T'], 'route-N', 'route-D'],
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [1, 5, 1, 5],
            'text-max-width': 40,
            'text-padding': 3,
            'text-max-angle': 180
        },
        paint: { 'text-color': ['match', ['get', 'c'], 'A', couleurTexte(ro.A, '#ffffff'), ['N', 'T'], couleurTexte(ro.N, '#ffffff'), couleurTexte(ro.D, '#17212b')] }
    });

    /* Noms des communes (z420) : posés après les routes, avant les zones (z440). */
    if (SOURCES.noms) {
        sources.noms = { type: 'raster', tiles: ['npfidb://noms/{z}/{x}/{y}'], tileSize: 256, minzoom: NOMS_ZOOM_MIN, maxzoom: NOMS_ZOOM_MAX, scheme: 'xyz' };
        couches.push({ id: 'noms', type: 'raster', source: 'noms', minzoom: NOMS_ZOOM_MIN - 1, paint: { 'raster-fade-duration': 0 } });
    }

    /* Zones SIA (z440) : voiles P / D, bordures intérieures, contours, noms. */
    if (PREFS.zones && PREFS.cles.length) {
        sources.zones = { type: 'geojson', data: new URL(ZONES_URL + '?appv=' + APPV, location.href).href, filter: ['all', filtreSia(), filtreFl115()], maxzoom: 12, tolerance: 0.375, buffer: 128 };
        couches.push({ id: 'zones-voiles', type: 'fill', source: 'zones', filter: ['has', 'v'], layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'c'], 'fill-opacity': ['get', 'v'], 'fill-antialias': false } });
        const bd = R.bordure || { decalagePx: 7, largeurPx: 12, opacite: 0.22 };
        couches.push({ id: 'zones-bordures', type: 'line', source: 'zones', filter: ['all', ['has', 'bd'], ['!=', ['geometry-type'], 'Point']], layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': bd.largeurPx, 'line-offset': bd.decalagePx, 'line-opacity': bd.opacite } });
        /* Contours : une seule couche ; pointillés propres à chaque zone (en pixels dans l'app, en largeurs de trait ici). */
        const motifs = { '7 5': 2.2, '9 6': 2.2, '6 5': 2.2, '5 4': 2.2, '0.1 7': 3.4 };
        const tirets = ['match', ['get', 'd']];
        Object.entries(motifs).forEach(([m, w]) => tirets.push(m, ['literal', m.split(' ').map(Number).map(v => Math.max(0.01, v / w))]));
        tirets.push(['literal', [1, 0]]);
        couches.push({ id: 'zones-contours', type: 'line', source: 'zones', minzoom: contourZoom, filter: ['!=', ['geometry-type'], 'Point'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'o'], 'line-dasharray': tirets } });
        couches.push({ id: 'zones-ponctuelles', type: 'circle', source: 'zones', minzoom: contourZoom, filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'nom']]], paint: { 'circle-radius': 5, 'circle-color': ['get', 'c'], 'circle-opacity': 0, 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': ['get', 'w'], 'circle-stroke-opacity': ['get', 'o'] } });
        const T = tailleNoms();
        /* Noms : points d'ancrage préparés sur le PC (angle de la limite, côté intérieur) ; texte tourné une fois pour toutes,
         * décalé vers l'intérieur de la zone ; collisions entre noms comme dans l'app (un nom qui chevauche est caché). */
        couches.push({
            id: 'zones-noms', type: 'symbol', source: 'zones',
            filter: ['has', 'nom'],
            layout: {
                visibility: 'none',
                'symbol-sort-key': ['get', 'pr'],
                'text-field': texteNomsZones(false),
                'text-font': POLICE_TEXTE,
                'text-size': tailleNomsZones(false),
                'text-rotate': ['get', 'a'],
                'text-rotation-alignment': 'map',
                'text-anchor': ['case', ['==', ['get', 'sd'], 1], 'top', 'bottom'],
                'text-offset': ['case', ['==', ['get', 'sd'], 1], ['literal', [0, 1.25]], ['literal', [0, -1.25]]],
                'text-padding': 6,
                'text-line-height': 1.15,
                'text-max-width': 60
            },
            paint: { 'text-color': T.couleur }
        });
    }

    /* Points SIA (z550 / 555) et étiquettes (z650), terrains de l'app (z600). */
    const filtrePoints = ['case',
        ['==', TYPE_PT, 'vrp'], ['all', filtreSia(), PREFS.vrp],
        ['==', TYPE_PT, 'icone'], ['all', filtreSia(), filtreFl115(), PREFS.zones],
        ['in', TYPE_PT, ['literal', ['terrain', 'point']]], filtreSia(),
        true];
    sources.points = { type: 'geojson', data: new URL(POINTS_URL + '?appv=' + APPV, location.href).href, filter: filtrePoints, maxzoom: 12, buffer: 64 };
    const icones = Object.keys(DONNEES.icones || {});
    couches.push({ id: 'sia-icones', type: 'symbol', source: 'points', filter: ['==', TYPE_PT, 'icone'], layout: { visibility: 'none', 'icon-image': ['concat', 'icone-', ['get', 'ic']], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    void icones;
    const cercle = (id, genre) => ({ id, type: 'circle', source: 'points', filter: ['==', TYPE_PT, genre], layout: genre === 'point' ? { visibility: 'none' } : {}, paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'fc'], 'circle-opacity': ['get', 'fo'], 'circle-stroke-color': ['get', 'sc'], 'circle-stroke-width': ['get', 'sw'] } });
    couches.push(cercle('sia-terrains', 'terrain'));
    couches.push(cercle('sia-points', 'point'));
    const vrp = ((DONNEES.styles || {}).vrp || {}).rond || {};
    const bordVrp = pxCss(vrp['border-top-width']) || 2;
    couches.push({ id: 'sia-vrp', type: 'circle', source: 'points', filter: ['==', TYPE_PT, 'vrp'], layout: { visibility: 'none' }, paint: { 'circle-radius': ['-', ['/', ['get', 'dia'], 2], bordVrp], 'circle-color': ['get', 'fc'], 'circle-stroke-color': vrp['border-top-color'] || '#000000', 'circle-stroke-width': bordVrp } });
    couches.push({ id: 'sia-vrp-texte', type: 'symbol', source: 'points', filter: ['==', TYPE_PT, 'vrp'], layout: { visibility: 'none', 'text-field': ['get', 'e'], 'text-font': POLICE_TEXTE, 'text-size': ['get', 'ts'], 'text-letter-spacing': ['/', -0.3, ['get', 'ts']], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': ['get', 'tc'] } });

    /* Terrains de l'app (z600) : noms + fréquences (2 NM), terrains ajoutés, terrains PÉLIC possibles, PÉLIC. */
    const tn = (DONNEES.styles || {}).terrainNom || {};
    const tailleNom = pxCss(tn.nom && tn.nom['font-size']) || 14, tailleFq = pxCss(tn.frequence && tn.frequence['font-size']) || 18;
    couches.push({
        id: 'terrains-noms', type: 'symbol', source: 'points', filter: ['has', 'nm'],
        layout: {
            visibility: 'none',
            'text-field': ['format', ['get', 'nm'], {}, ['case', ['has', 'fq'], ['concat', '\n', ['get', 'fq']], ''], { 'font-scale': tailleFq / tailleNom, 'text-color': (tn.frequence && tn.frequence.color) || '#0b4f8a' }],
            'text-font': POLICE_TEXTE,
            'text-size': tailleNom,
            'text-anchor': 'left',
            'text-justify': 'center',
            'text-offset': [(13 + 4) / tailleNom, 0],
            'text-line-height': 1.08,
            'text-max-width': 60,
            'icon-image': 'boite-nom-terrain',
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [2, 4, 2, 4],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        paint: { 'text-color': (tn.boite && tn.boite.color) || '#111827' }
    });
    const icone = (id, filtre, image, zmin, avecPiste) => {
        couches.push({ id, type: 'symbol', source: 'points', minzoom: zmin, filter: filtre, layout: { 'icon-image': image, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
        if (avecPiste) couches.push({ id: id + '-piste', type: 'symbol', source: 'points', minzoom: zmin, filter: filtre, layout: { 'icon-image': image + '-piste', 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'viewport', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    };
    icone('terrains-ajoutes', ['==', TYPE_PT, 'ajoute'], 'terrain-ajoute', ajoutesZoom, true);
    icone('terrains-choix', ['all', ['==', TYPE_PT, 'autre'], ['!', ['in', ['get', 'oaci'], ['literal', PREFS.pelicAjoutes]]]], 'terrain-choix', 0, true);
    const tailles = ((DONNEES.styles || {}).pelicTailles || []).map(m => m.zoomLeaflet).sort((a, b) => a - b);
    const imagePelic = tailles.length
        ? ['step', ['zoom'], ['concat', 'pelic-', etatPelic(), '-' + tailles[0]], ...tailles.slice(1).flatMap(z => [z - 1, ['concat', 'pelic-', etatPelic(), '-' + z]])]
        : ['concat', 'pelic-', etatPelic(), '-9'];
    couches.push({ id: 'pelic', type: 'symbol', source: 'points', filter: estPelic(), layout: { 'icon-image': imagePelic, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });

    /* Étiquettes des terrains SIA et des points (z650, au-dessus des marqueurs). */
    const et = (DONNEES.styles || {}).etiquettes || {};
    const etiquette = (id, genre, boite, s, zmin) => {
        const taille = pxCss(s && s['font-size']) || 10;
        couches.push({
            id, type: 'symbol', source: 'points', minzoom: zmin, filter: ['all', ['==', TYPE_PT, genre], ['!=', ['get', 'e'], '']],
            layout: {
                visibility: genre === 'point' ? 'none' : 'visible',
                'text-field': ['get', 'e'], 'text-font': POLICE_TEXTE, 'text-size': taille,
                'text-anchor': 'left', 'text-offset': [(5 + 2 + 6) / taille, 0], 'text-max-width': 40,
                'icon-image': boite, 'icon-text-fit': 'both', 'icon-text-fit-padding': [3, 6, 2, 6],
                'text-allow-overlap': true, 'text-ignore-placement': true, 'icon-allow-overlap': true, 'icon-ignore-placement': true
            },
            paint: { 'text-color': (s && s.color) || '#172033' }
        });
    };
    etiquette('sia-terrains-noms', 'terrain', 'boite-terrain', et.terrain, 7);
    etiquette('sia-points-noms', 'point', 'boite-point', et.point, 7);
}

/* Règles selon l'échelle (comme l'app : appliquées à la fin d'un zoom et à l'ouverture). */
function majSelonEchelle(force = false) {
    if (!map || !DONNEES) return;
    const nm = echelleCourante();
    const R = DONNEES.regles || {};
    const voir = (id, oui) => { try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', oui ? 'visible' : 'none'); } catch (_) {} };
    const cle = nm + '|' + ETAT.ht + '|' + ETAT.routes;
    if (!force && cle === ETAT.echelle) return;
    ETAT.echelle = cle;
    const pres = nm <= 5.000001;
    /* HT : masquées à 50 NM et plus (src/110). */
    BANDES_HT.forEach(x => voir('ht-' + x.b, ETAT.ht && nm < HT_MASQUEES_NM - 0.000001));
    ['routes-bord-A', 'routes-bord-N', 'routes-bord-D', 'routes-A', 'routes-N', 'routes-D', 'routes-numeros'].forEach(id => voir(id, ETAT.routes));
    voir('zones-voiles', nm >= (Number(R.voileEchelleMinNm) || 5) - 1e-6);
    const decorations = nm < (Number(R.decorationsEchelleMaxNm) || 10);
    voir('zones-bordures', decorations);
    /* Noms des zones : moins de 10 NM ; avec HT + Routes allumées, 5 NM et moins seulement (src/350 v17.58). */
    const lourd = PREFS.zones && ETAT.routes && ETAT.ht;
    voir('zones-noms', decorations && (!lourd || pres));
    try {
        if (map.getLayer('zones-noms')) {
            map.setLayoutProperty('zones-noms', 'text-field', texteNomsZones(pres));
            map.setLayoutProperty('zones-noms', 'text-size', tailleNomsZones(pres));
        }
    } catch (_) {}
    const points = nm <= (Number(R.pointsEchelleMaxNm) || 5) + 1e-6;
    ['sia-points', 'sia-points-noms', 'sia-vrp', 'sia-vrp-texte'].forEach(id => voir(id, points));
    voir('sia-icones', nm <= (Number(R.iconesEchelleMaxNm) || 5) + 1e-6);
    voir('terrains-noms', nm <= (Number(R.nomsTerrainsEchelleMaxNm) || 2) + 1e-6);
}

/* ---------- Calque Routier : lecture seule dans un fil de calcul à part (prototype-carte-routes.js) ---------- */
let filRoutes = null;
const ROUTES = { tier: 0, boite: null, demande: 0, enCours: false, url: null, attente: false };
function partiesRoutes() {
    const d = lireJson(ROUTES_DESCRIPTION_CLE, null);
    return d && Array.isArray(d.parts) ? d.parts.filter(p => p && typeof p.key === 'string').map(p => ({ key: p.key, bbox: Array.isArray(p.bbox) && p.bbox.length === 4 ? p.bbox.map(Number) : null })) : [];
}
function niveauRoutes() {
    /* src/120 getRoadOverlayZoomTier : Leaflet 12 et plus = toutes les routes, 11 = autoroutes ; MapLibre = Leaflet - 1. */
    const z = map.getZoom();
    if (z >= 11) return 2;
    if (z >= 10) return 1;
    return 0;
}
function majRoutes() {
    if (!map || !ETAT.routes) return;
    const tier = niveauRoutes();
    if (!tier) return;
    const b = map.getBounds();
    const vue = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const contient = ROUTES.boite && ROUTES.tier === tier && ROUTES.boite[0] <= vue[0] && ROUTES.boite[1] <= vue[1] && ROUTES.boite[2] >= vue[2] && ROUTES.boite[3] >= vue[3];
    if (contient) return;
    if (ROUTES.enCours) { ROUTES.attente = true; return; }
    const parties = partiesRoutes();
    if (!parties.length) {
        if (!majRoutes.prevenu) { majRoutes.prevenu = true; afficherMessage('Calque Routier absent : importe-le dans NPF-Q400 (Gestion des Cartes). Rien n’a été créé.', false, 8000); }
        return;
    }
    if (!filRoutes) {
        try {
            filRoutes = new Worker(new URL('prototype-carte-routes.js?appv=' + APPV, location.href).href);
        } catch (e) {
            noterErreur('fil des routes : ' + (e && e.message || e));
            return;
        }
        filRoutes.onmessage = ev => recevoirRoutes(ev.data || {});
        filRoutes.onerror = e => { journal.routes.erreurs += 1; noterErreur('fil des routes : ' + (e && e.message || 'erreur')); ROUTES.enCours = false; };
    }
    const dx = (vue[2] - vue[0]) * 0.5, dy = (vue[3] - vue[1]) * 0.5;
    const boite = [vue[0] - dx, vue[1] - dy, vue[2] + dx, vue[3] + dy];
    ROUTES.enCours = true;
    ROUTES.demande += 1;
    journal.routes.demandes += 1;
    filRoutes.postMessage({ id: ROUTES.demande, tier, boite, parties });
}
function recevoirRoutes(m) {
    ROUTES.enCours = false;
    if (!m.ok) {
        journal.routes.erreurs += 1;
        noterErreur('routes : ' + (m.erreur || 'lecture impossible'));
    } else if (map && map.getSource('routes')) {
        const url = URL.createObjectURL(new Blob([m.octets], { type: 'application/json' }));
        const ancienne = ROUTES.url;
        ROUTES.url = url;
        ROUTES.tier = m.tier;
        ROUTES.boite = m.boite;
        map.getSource('routes').setData(url);
        if (ancienne) setTimeout(() => URL.revokeObjectURL(ancienne), 5000);
        journal.routes.chargees += 1;
        journal.routes.entites = m.entites;
        journal.routes.source = m.source;
        journal.routes.dureesMs.push(m.ms);
        if (journal.routes.dureesMs.length > 200) journal.routes.dureesMs.shift();
        journal.routes.derniere = new Date().toLocaleTimeString('fr-FR') + ' : ' + m.entites + ' routes (' + (m.tier >= 2 ? 'A N D M T' : 'autoroutes') + '), ' + Math.round(m.octets.byteLength / 1024) + ' Ko, ' + m.ms + ' ms dans le fil à part';
    }
    if (ROUTES.attente) { ROUTES.attente = false; majRoutes(); }
}

/* ---------- Couches affichées (ligne « couches : » du DIAG) : états + décomptes dans la vue (±25 %) ---------- */
function texteCouches() {
    if (!map || !DONNEES) return '—';
    const nm = echelleCourante();
    const visible = id => { try { return !!map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none' && map.getZoom() >= (map.getLayer(id).minzoom || 0); } catch (_) { return false; } };
    const parties = ['fond'];
    if (SOURCES.noms && map.getZoom() >= NOMS_ZOOM_MIN - 1) parties.push('noms');
    if (htUrl && BANDES_HT.some(x => visible('ht-' + x.b))) parties.push('HT');
    if (ETAT.routes && niveauRoutes() > 0 && journal.routes.chargees) parties.push('Routes (' + (niveauRoutes() >= 2 ? 'A N D M T' : 'autoroutes') + ')');
    const b = map.getBounds();
    const w = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
    const dx = (e - w) * 0.25, dy = (n - s) * 0.25;
    const boite = [w - dx, s - dy, e + dx, n + dy];
    const cles = new Set(PREFS.cles);
    const lim = Number((DONNEES.regles || {}).fl115Pieds) || 11500;
    if (map.getSource('zones')) {
        let zones = 0;
        for (const [bb, f, lf] of DONNEES.index || []) {
            if (!cles.has(f)) continue;
            if (PREFS.fl115 && Number.isFinite(lf) && lf >= lim) continue;
            if (bb && (bb[2] < boite[0] || bb[0] > boite[2] || bb[3] < boite[1] || bb[1] > boite[3])) continue;
            zones += 1;
        }
        const details = [];
        if (visible('zones-contours')) details.push('contours');
        if (visible('zones-voiles')) details.push('voiles P/D');
        if (visible('zones-bordures')) details.push('bordures');
        if (visible('zones-noms')) details.push('noms');
        if (zones) parties.push('zones SIA ' + zones + ' dans la vue' + (details.length ? ' (' + details.join(', ') + ')' : ''));
    }
    const compte = { vrp: 0, point: 0, terrain: 0, icone: 0, pelic: 0, autre: 0, ajoute: 0 };
    const pelic = new Set(PREFS.pelicAjoutes);
    const dedans = (lo, la) => lo >= boite[0] && lo <= boite[2] && la >= boite[1] && la <= boite[3];
    for (const [lo, la, g, f] of DONNEES.indexPoints || []) {
        if (!dedans(lo, la)) continue;
        if (g === 'vrp' || g === 'point' || g === 'terrain' || g === 'icone') { if (!cles.has(f)) continue; if (g === 'vrp' && !PREFS.vrp) continue; if (g === 'icone' && !PREFS.zones) continue; }
        if (g === 'autre' && pelic.has(f)) compte.pelic += 1;
        else if (compte[g] !== undefined) compte[g] += 1;
    }
    if (visible('sia-vrp') || visible('sia-points')) { const v = compte.vrp + compte.point; if (v) parties.push('VFR / points ' + v); }
    if (compte.terrain) parties.push('terrains SIA ' + compte.terrain);
    if (visible('sia-icones') && compte.icone) parties.push('icônes AER/VOL/PJE ' + compte.icone);
    const terrains = compte.pelic + compte.autre + (map.getZoom() >= ((DONNEES.regles || {}).terrainsAjoutesZoomLeaflet || 7) - 1 ? compte.ajoute : 0);
    if (terrains) parties.push('PÉLIC / terrains ' + terrains);
    if (visible('terrains-noms')) parties.push('noms des terrains');
    if (visible('pistes-noir')) parties.push('pistes');
    void nm;
    return parties.join(' + ');
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
    if (DONNEES) {
        const c = DONNEES.comptes || {};
        L.push('Données du prototype (préparées sur PC) : SIA ' + DONNEES.sia + ' | créées le ' + new Date(DONNEES.creeLe).toLocaleString('fr-FR') + ' par ' + DONNEES.appv
            + ' | ' + c.zones + ' zones, ' + c.points + ' points SIA, ' + c.icones + ' icônes, ' + c.terrains + ' terrains de l’app, ' + c.pistes + ' pistes');
        L.push('Préférences lues (lecture seule) : ' + PREFS.filtresActifs + ' catégories SIA cochées | zones ' + (PREFS.zones ? 'ON' : 'OFF') + ' | VRP ' + (PREFS.vrp ? 'ON' : 'OFF') + ' | FL115 ' + (PREFS.fl115 ? 'masquées' : 'non')
            + ' | PÉLIC : ' + PREFS.desactives.length + ' désactivé(s), ' + PREFS.eau.length + ' eau, ' + PREFS.pelicAjoutes.length + ' ajouté(s)');
    } else {
        L.push('Données du prototype : NON CHARGÉES');
    }
    const t = journal.temps;
    const ms = v => (v === undefined ? '—' : (v / 1000).toFixed(2).replace('.', ',') + ' s');
    L.push('Ouverture (depuis le chargement de la page) : MapLibre lu ' + ms(t.maplibre) + ' | données lues ' + ms(t.donnees) + ' | images ' + ms(t.images) + ' | carte prête ' + ms(t.load) + ' | première carte complète ' + ms(t.complete)
        + (journal.longues.n ? ' | longues tâches (> 50 ms) : ' + journal.longues.n + ', la plus longue ' + Math.round(journal.longues.max) + ' ms (les plus longues : '
            + journal.longues.liste.map(([a, d]) => d + ' ms à ' + ms(a)).join(', ') + ')' : ''));
    L.push('Lignes HT : ' + (htUrl ? 'lues dans le cache de l’app' : 'absentes du cache (ouvrir NPF-Q400 avec les lignes HT une fois)') + ' | affichage ' + (ETAT.ht ? 'ON' : 'OFF'));
    const rd = journal.routes.dureesMs.slice().sort((a, b) => a - b);
    L.push('Calque Routier : ' + (ETAT.routes ? 'ON' : 'OFF') + ' | ' + journal.routes.demandes + ' demande(s), ' + journal.routes.chargees + ' chargement(s), ' + journal.routes.erreurs + ' erreur(s)'
        + (journal.routes.source ? ' | lu dans ' + journal.routes.source : '') + (rd.length ? ' | médiane ' + rd[Math.floor(rd.length / 2)] + ' ms, max ' + rd[rd.length - 1] + ' ms (fil à part)' : '')
        + (journal.routes.derniere ? ' | dernier : ' + journal.routes.derniere : ''));
    L.push('Avion simulé : ' + Math.round(avion.vitesseKt) + ' kt, route vraie ' + Math.round(avion.routeVraie) + '° | suivi ' + (avion.suivi ? 'ON' : 'OFF') + (trajet ? ' | trajet ' + trajet.minutes + ' min en cours (' + Math.round(trajet.ecouleMs / 60000) + ' min)' : ''));
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
window.npfPrototypeJournal = journal;
window.npfPrototypeTrajet = () => trajet;
document.getElementById('proto-export').addEventListener('click', () => { exporterDiag(); });

/* ---------- Démarrage ---------- */
function majBoutonsCouches() {
    const b1 = document.getElementById('proto-ht'), b2 = document.getElementById('proto-routes');
    b1.setAttribute('aria-pressed', ETAT.ht ? 'true' : 'false');
    b1.textContent = ETAT.ht ? 'HT ON' : 'HT';
    b2.setAttribute('aria-pressed', ETAT.routes ? 'true' : 'false');
    b2.textContent = ETAT.routes ? 'Routes ON' : 'Routes';
}
async function demarrer() {
    const maplibregl = await import('./' + MAPLIBRE_DOSSIER + '/maplibre-gl.mjs?appv=' + APPV);
    marquer('maplibre');
    maplibregl.setWorkerUrl(new URL('./' + MAPLIBRE_DOSSIER + '/maplibre-gl-worker.mjs?appv=' + APPV, location.href).href);
    maplibregl.setMaxParallelImageRequests(LECTURES_MAX);
    const prep = await preparerBases();
    if (!prep.ok) {
        afficherMessage(prep.message, true);
        return;
    }
    try {
        const r = await fetch(DONNEES_URL + '?appv=' + APPV);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        DONNEES = await r.json();
    } catch (e) {
        noterErreur('données du prototype : ' + (e && e.message || e));
        afficherMessage('Données du prototype absentes (ouvre une fois NPF-Q400 en Wi‑Fi) : la carte s’affiche sans zones, VFR ni terrains.', true, 12000);
        DONNEES = { regles: {}, styles: {}, index: [], indexPoints: [], icones: {}, iconesRetournees: {}, comptes: {}, absentes: true };
    }
    marquer('donnees');
    lirePreferences(DONNEES);
    ETAT.ht = PREFS.ht;
    ETAT.routes = PREFS.routes;
    majBoutonsCouches();
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
                layout: { 'line-cap': 'round', 'line-join': 'round', visibility: ETAT.ht ? 'visible' : 'none' },
                paint: { 'line-color': '#d8232a', 'line-width': x.w, 'line-opacity': x.o }
            };
            /* Leaflet : pointillés en pixels ; MapLibre : en largeurs de trait. */
            if (x.d) couche.paint['line-dasharray'] = x.d.map(v => v / x.w);
            couches.push(couche);
        });
    } else if (ETAT.ht) {
        afficherMessage('Lignes HT absentes du cache de l’app : ouvre NPF-Q400 une fois avec les lignes HT affichées. Rien n’a été téléchargé.', false, 9000);
    }
    if (DONNEES.absentes) {
        if (SOURCES.noms) {
            sources.noms = { type: 'raster', tiles: ['npfidb://noms/{z}/{x}/{y}'], tileSize: 256, minzoom: NOMS_ZOOM_MIN, maxzoom: NOMS_ZOOM_MAX, scheme: 'xyz' };
            couches.push({ id: 'noms', type: 'raster', source: 'noms', minzoom: NOMS_ZOOM_MIN - 1, paint: { 'raster-fade-duration': 0 } });
        }
    } else {
        construireCouches(couches, sources);
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
    if (!DONNEES.absentes) preparerImages(); else map.addImage('avion', dessinerAvion(), { pixelRatio: 2 });
    marquer('images');
    map.on('styleimagemissing', e => { if (e && e.id) noterErreur('image absente : ' + e.id); });
    map.on('move', () => { dernierMouvement = performance.now(); });
    map.on('move', majEchelle);
    map.on('zoomend', () => majSelonEchelle());
    map.on('moveend', () => { majSelonEchelle(); majRoutes(); });
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
        marquer('load');
        majEchelle();
        majSelonEchelle(true);
        majRoutes();
        setInterval(pasSimulation, SIMULATION_PAS_MS);
        map.once('idle', () => marquer('complete'));
    });

    const allerA = nm => {
        const z = zoomPourEchelle(nm, map.getCenter().lat);
        if (z === null) return;
        map.jumpTo({ zoom: z, center: avion.suivi ? [avion.lon, avion.lat] : map.getCenter() });
    };
    document.getElementById('proto-20nm').addEventListener('click', () => allerA(20));
    document.getElementById('proto-5nm').addEventListener('click', () => allerA(5));
    document.getElementById('proto-2nm').addEventListener('click', () => allerA(2));
    document.getElementById('proto-suivi').addEventListener('click', () => {
        avion.suivi = !avion.suivi;
        majBoutonSuivi();
        if (avion.suivi) map.jumpTo({ center: [avion.lon, avion.lat] });
    });
    document.getElementById('proto-ht').addEventListener('click', () => {
        ETAT.ht = !ETAT.ht;
        if (ETAT.ht && !htUrl) afficherMessage('Lignes HT absentes du cache de l’app : ouvre NPF-Q400 une fois avec les lignes HT affichées.', false, 7000);
        majBoutonsCouches();
        majSelonEchelle(true);
    });
    document.getElementById('proto-routes').addEventListener('click', () => {
        ETAT.routes = !ETAT.routes;
        majBoutonsCouches();
        majSelonEchelle(true);
        majRoutes();
    });
    document.querySelectorAll('.proto-trajet').forEach(b => b.addEventListener('click', () => {
        const minutes = Number(b.dataset.trajet);
        if (trajet && trajet.minutes === minutes) arreterTrajet('arrêté par le bouton');
        else demarrerTrajet(minutes);
    }));
}

demarrer().catch(e => {
    noterErreur('démarrage : ' + (e && e.message || e));
    afficherMessage('Le prototype n’a pas pu démarrer (' + (e && e.message || e) + '). Retourne à NPF-Q400.', true);
});
