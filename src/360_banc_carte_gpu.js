/*
 * v18.03 — BANC CARTE GPU, côté carte NPF-Q400 actuelle (Leaflet) : mêmes mesures que le prototype MapLibre
 * (prototype-carte.html), pour comparer les deux DIAG sur l'iPad. Rien ne change à l'affichage.
 * v18.04 — couches de chaque geste, gestes à 20 NM, session longue par tranches de 10 min, trajet simulé
 * (boutons du DIAG) ; l'affichage de la carte actuelle ne change toujours pas.
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

/*
 * v18.04 — couches affichées par la carte actuelle (lecture des états de l'app, aucun calcul, aucune action) :
 * même ligne que le prototype dans le DIAG (« couches : … »), relevée au début de chaque geste.
 */
function getNpfBancCarteLeafletCouches() {
    const parties = ['fond'];
    const nb = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
    try { if (typeof npfCalqueNomsLayer !== 'undefined' && npfCalqueNomsLayer && map.hasLayer(npfCalqueNomsLayer)) parties.push('noms'); } catch (_) {}
    try { if (showHighVoltageLinesLayer && isHighVoltageLayerEffectiveAtCurrentScale()) parties.push('HT'); } catch (_) {}
    try {
        if (isRoadOverlayEffectiveAtCurrentZoom()) {
            const t = getRoadOverlayZoomTier();
            parties.push('Routes (' + (t >= 2 ? 'A N D M T' : 'autoroutes') + ')');
        }
    } catch (_) {}
    let echelle = Infinity;
    try { echelle = getCurrentNpfScaleNm(); } catch (_) {}
    try {
        const zones = siaMapAirspacesVisible && Array.isArray(siaRenderedAirspaceFeatures) ? siaRenderedAirspaceFeatures.length : 0;
        if (zones) {
            const details = [];
            if (map.getZoom() >= SIA_AIRSPACE_OUTLINE_MIN_ZOOM) details.push('contours');
            if (siaAirspaceVeilLayers.length && getSiaAirspaceVeilOpacity('P') > 0) details.push('voiles P/D');
            let bordures = 0;
            try { bordures = siaInnerBandLayerGroup ? siaInnerBandLayerGroup.getLayers().length : 0; } catch (_) {}
            if (bordures) details.push('bordures ' + bordures);
            const noms = Array.isArray(siaZoomDependentLayers) ? siaZoomDependentLayers.length : 0;
            if (noms) details.push('noms ' + noms);
            parties.push('zones SIA ' + zones + ' posées' + (details.length ? ' (' + details.join(', ') + ')' : ''));
        }
    } catch (_) {}
    try {
        const vfr = Array.isArray(siaRenderedPointItems) ? siaRenderedPointItems.length : 0;
        if (vfr) parties.push('VFR / points ' + vfr);
        const ter = Array.isArray(siaRenderedTerrainItems) ? siaRenderedTerrainItems.length : 0;
        if (ter) parties.push('terrains SIA ' + ter);
        if (typeof siaDotherIconStats !== 'undefined' && nb(siaDotherIconStats.drawn)) parties.push('icônes AER/VOL/PJE ' + nb(siaDotherIconStats.drawn));
    } catch (_) {}
    try {
        let terrains = 0;
        if (typeof permanentAirportLayer !== 'undefined' && permanentAirportLayer) {
            permanentAirportLayer.eachLayer(l => { if (l instanceof L.Marker && l._icon) terrains += 1; });
        }
        if (terrains) parties.push('PÉLIC / terrains ' + terrains);
        const noms = typeof airportOperationalLabelLayer !== 'undefined' && airportOperationalLabelLayer ? airportOperationalLabelLayer.getLayers().length : 0;
        if (noms) parties.push('noms des terrains ' + noms);
        const pistes = typeof npfRunwayMapLayer !== 'undefined' && npfRunwayMapLayer ? Math.round(npfRunwayMapLayer.getLayers().length / 2) : 0;
        if (pistes) parties.push('pistes ' + pistes);
    } catch (_) {}
    void echelle;
    return parties.join(' + ');
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
        /* Essais sur PC seulement : tranches plus courtes si l'adresse contient « npfBancTranche=<secondes> ». */
        trancheMs: (() => { try { const v = Number(new URLSearchParams(location.search).get('npfBancTranche')); return v > 0 ? v * 1000 : 0; } catch (_) { return 0; } })(),
        conteneur: () => map.getContainer(),
        dernierMouvement: () => npfBancCarteLeafletDernierMouvement,
        echelleNm: () => getCurrentNpfScaleNm(),
        couverture: () => {
            const c = getNpfCurrentZoomVisibleTileCoverage();
            return { total: c.total, chargees: c.loaded };
        },
        memoire: getNpfBancCarteLeafletMemoire,
        couches: getNpfBancCarteLeafletCouches
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
        lines.push('################ BANC CARTE GPU (v18.04) ################');
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

/*
 * v18.04 — TRAJET SIMULÉ du banc (même trajet que le prototype) : départ Valence (LFLU), route vraie vers Marseille,
 * demi-tour à 30 min ; vitesse telle que l'aller-retour dure 60 min ; suivi ON (le suivi de l'app, anticipé). Il utilise la simulation de l'app
 * (même pas de 500 ms, même formule) : mode simulation activé s'il ne l'était pas, puis vitesse et route posées
 * directement (sans les enregistrer : les réglages de simulation de l'utilisateur sont remis à la fin), suivi activé
 * comme par son bouton. Tranches de 10 minutes mesurées par le banc. Lancé seulement par les boutons du DIAG.
 */
const NPF_BANC_TRAJET = Object.freeze({ depart: [44.91247778, 4.96578056], arrivee: [43.2965, 5.3698], nom: 'Valence (LFLU)', but: 'Marseille' });
let npfBancTrajetEnCours = null;

function calculerNpfBancTrajet() {
    const r = Math.PI / 180;
    const [la1, lo1] = NPF_BANC_TRAJET.depart, [la2, lo2] = NPF_BANC_TRAJET.arrivee;
    const p1 = la1 * r, p2 = la2 * r, dl = (lo2 - lo1) * r;
    const route = ((Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / r) + 360) % 360;
    const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const distanceNm = 2 * 6371000 * Math.asin(Math.sqrt(a)) / 1852;
    return { route, retour: (route + 180) % 360, distanceNm, vitesseKt: 2 * distanceNm };
}

function arreterNpfBancTrajet(raison = 'arrêté') {
    const t = npfBancTrajetEnCours;
    if (!t) return;
    npfBancTrajetEnCours = null;
    clearInterval(t.minuterie);
    try {
        simulationSpeedKt = t.avant.vitesse;
        simulationRouteDeg = t.avant.route;
        refreshSimulationMotionButtonState();
    } catch (_) {}
    try { if (!t.avant.suivi && centerGpsFollowActive) disableCenterGpsFollow(); } catch (_) {}
    try { if (!t.avant.sim && isSimulationMode) disableSimulationMode({ restoreGps: t.gpsAvant }); } catch (_) {}
    try { if (npfBancCarteLeaflet) npfBancCarteLeaflet.trajetFin(raison); } catch (_) {}
}

function demarrerNpfBancTrajet(minutes) {
    if (!map || !npfBancCarteLeaflet) return false;
    arreterNpfBancTrajet('remplacé par un nouveau trajet');
    const duree = Number(minutes) >= 60 ? 60 : 30;
    const calc = calculerNpfBancTrajet();
    const avant = { sim: !!isSimulationMode, vitesse: simulationSpeedKt, route: simulationRouteDeg, suivi: !!centerGpsFollowActive };
    if (!isSimulationMode) {
        const alerte = window.alert;
        window.alert = () => {};
        try { enableSimulationMode(); } finally { window.alert = alerte; }
    }
    if (!isSimulationMode) return false;
    const gpsAvant = !!simulationWasLiveGpsActiveBeforeSimulation;
    const poserRoute = vraie => { simulationRouteDeg = normalizeSimulationRoute(vraie - Number(getNpfMagneticDeclination() || 0)); };
    simulationSpeedKt = calc.vitesseKt;
    poserRoute(calc.route);
    applySimulatedUserPosition(NPF_BANC_TRAJET.depart[0], NPF_BANC_TRAJET.depart[1], { forceFullRefresh: true });
    /* Déclinaison du point de départ (connue seulement une fois l'avion posé à Valence). */
    poserRoute(calc.route);
    try { refreshSimulationMotionButtonState(); } catch (_) {}
    if (!centerGpsFollowActive) enableCenterGpsFollow();
    const t = { minutes: duree, ecouleMs: 0, dernier: performance.now(), retourFait: false, avant, gpsAvant, minuterie: null };
    npfBancTrajetEnCours = t;
    npfBancCarteLeaflet.trajetDebut('Trajet ' + duree + ' min ' + NPF_BANC_TRAJET.nom + (duree >= 60 ? ' ⇄ ' : ' → ') + NPF_BANC_TRAJET.but
        + ' | ' + Math.round(calc.vitesseKt) + ' kt, route vraie ' + Math.round(calc.route) + '° | suivi ON | carte actuelle (Leaflet)');
    t.minuterie = setInterval(() => {
        if (npfBancTrajetEnCours !== t) return;
        const n = performance.now();
        if (!document.hidden) t.ecouleMs += Math.min(1000, Math.max(0, n - t.dernier));
        t.dernier = n;
        if (!t.retourFait && t.minutes >= 60 && t.ecouleMs >= 30 * 60000) t.retourFait = true;
        /* La déclinaison magnétique suit la position : la route est reposée à chaque pas pour garder la MÊME route vraie
         * que le prototype (route vraie constante, comme sa simulation). */
        poserRoute(t.retourFait ? calc.retour : calc.route);
        if (t.ecouleMs >= t.minutes * 60000) arreterNpfBancTrajet('fini');
    }, 500);
    return true;
}
window.demarrerNpfBancTrajet = demarrerNpfBancTrajet;
window.arreterNpfBancTrajet = arreterNpfBancTrajet;
