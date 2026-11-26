/*
 * NPF-Q400 TEST v18.12 (inchangé depuis la v18.04) — fil de calcul à part du prototype de carte (prototype-carte.html) : Calque Routier.
 * Lit les routes là où l'app les range déjà (src/120 : index par cases de 0,15° « npf-road-overlay-spatial-v1 »,
 * sinon le fichier complet de la partie « npf-road-overlay-data-v1 ») et renvoie les routes de la zone demandée
 * (GeoJSON en octets). LECTURE SEULE STRICTE : un cache n'est ouvert que s'il existe déjà (caches.has d'abord :
 * caches.open créerait un cache absent), rien n'est écrit. Aucun calcul sur le fil principal de la page.
 */
const CACHE_CASES = 'npf-road-overlay-spatial-v1';
const PREFIXE_CASES = './__npf_road_overlay_spatial_v1__/';
const CACHE_PARTIES = 'npf-road-overlay-data-v1';
const PREFIXE_PARTIES = './__npf_road_overlay__/';
const CASE_DEG = 0.15;
const VERSION_INDEX = 1;
const MAX_CASES_GARDEES = 160;

const descriptions = new Map();
const casesGardees = new Map();
const partiesGardees = new Map();
let cacheCases = undefined;
let cacheParties = undefined;

async function ouvrirSiExiste(nom) {
    try {
        if (!(await caches.has(nom))) return null;
        return await caches.open(nom);
    } catch (_) {
        return null;
    }
}
const adresse = chemin => new URL(chemin, self.location.href).href;
const coupe = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
const garderCase = (cle, valeur) => {
    casesGardees.delete(cle);
    casesGardees.set(cle, valeur);
    while (casesGardees.size > MAX_CASES_GARDEES) casesGardees.delete(casesGardees.keys().next().value);
};

async function lireJson(cache, chemin) {
    if (!cache) return null;
    try {
        const r = await cache.match(adresse(chemin));
        if (!r || !r.ok) return null;
        return await r.json();
    } catch (_) {
        return null;
    }
}
async function description(cle) {
    if (descriptions.has(cle)) return descriptions.get(cle);
    const d = await lireJson(cacheCases, `${PREFIXE_CASES}${encodeURIComponent(cle)}/manifest.json`);
    const ok = d && Number(d.v) === VERSION_INDEX && String(d.p) === String(cle) && Number(d.cellDeg) === CASE_DEG ? d : null;
    descriptions.set(cle, ok);
    return ok;
}
async function lireCase(cle, tier, caseCle) {
    const k = cle + '|' + tier + '|' + caseCle;
    if (casesGardees.has(k)) { const v = casesGardees.get(k); garderCase(k, v); return v; }
    const d = await lireJson(cacheCases, `${PREFIXE_CASES}${encodeURIComponent(cle)}/t${tier}/${encodeURIComponent(caseCle)}.json`);
    const entrees = d && Array.isArray(d.e) ? d.e : [];
    garderCase(k, entrees);
    return entrees;
}
function garderPourNiveau(classe, tier) {
    const c = String(classe || '').toUpperCase();
    if (tier >= 2) return c === 'A' || c === 'N' || c === 'D' || c === 'M' || c === 'T';
    return tier === 1 && c === 'A';
}
function boiteRoute(f) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const g = f && f.geometry;
    const lignes = !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    lignes.forEach(l => (l || []).forEach(p => { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }));
    return [a, b, c, d];
}

async function routesDeLaPartie(partie, tier, boite, sortie, vues) {
    const d = await description(partie.key);
    if (d && d.tiers && d.tiers[String(tier)]) {
        const x0 = Math.floor(boite[0] / CASE_DEG), x1 = Math.floor(boite[2] / CASE_DEG);
        const y0 = Math.floor(boite[1] / CASE_DEG), y1 = Math.floor(boite[3] / CASE_DEG);
        const presentes = new Set(d.tiers[String(tier)].cells || []);
        const cases = [];
        for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) { const k = x + '_' + y; if (presentes.has(k)) cases.push(k); }
        if (d.tiers[String(tier)].overflow) cases.push('__overflow__');
        for (const k of cases) {
            const entrees = await lireCase(partie.key, tier, k);
            for (const e of entrees) {
                const [indice, bb, f] = e;
                const id = partie.key + ':' + indice;
                if (vues.has(id)) continue;
                if (Array.isArray(bb) && !coupe(bb, boite)) continue;
                if (!f || !garderPourNiveau(f.properties && f.properties.roadClass, tier)) continue;
                vues.add(id);
                sortie.push(f);
            }
        }
        return 'index par cases (cache de l’app)';
    }
    /* Pas encore d'index : fichier complet de la partie (rangé par l'app à l'import), gardé en mémoire de ce fil. */
    let toutes = partiesGardees.get(partie.key);
    if (!toutes) {
        const g = await lireJson(cacheParties, `${PREFIXE_PARTIES}${encodeURIComponent(partie.key)}.geojson`);
        toutes = g && Array.isArray(g.features) ? g.features.map((f, i) => [i, boiteRoute(f), f]) : [];
        partiesGardees.set(partie.key, toutes);
        while (partiesGardees.size > 6) partiesGardees.delete(partiesGardees.keys().next().value);
    }
    for (const [indice, bb, f] of toutes) {
        const id = partie.key + ':' + indice;
        if (vues.has(id) || !coupe(bb, boite)) continue;
        if (!garderPourNiveau(f.properties && f.properties.roadClass, tier)) continue;
        vues.add(id);
        sortie.push(f);
    }
    return 'fichier de la partie (cache de l’app)';
}

self.onmessage = async ev => {
    const m = ev.data || {};
    const t0 = performance.now();
    try {
        if (cacheCases === undefined) cacheCases = await ouvrirSiExiste(CACHE_CASES);
        if (cacheParties === undefined) cacheParties = await ouvrirSiExiste(CACHE_PARTIES);
        if (!cacheCases && !cacheParties) throw new Error('Calque Routier absent du cache de l’app');
        const boite = m.boite;
        const sortie = [];
        const vues = new Set();
        const sources = new Set();
        for (const partie of m.parties || []) {
            if (Array.isArray(partie.bbox) && !coupe(partie.bbox, boite)) continue;
            sources.add(await routesDeLaPartie(partie, m.tier, boite, sortie, vues));
        }
        const features = sortie.map(f => ({
            type: 'Feature',
            properties: { ref: String(f.properties && f.properties.ref || ''), c: String(f.properties && f.properties.roadClass || '').toUpperCase() },
            geometry: f.geometry
        }));
        const octets = new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features })).buffer;
        self.postMessage({ id: m.id, ok: true, tier: m.tier, boite, entites: features.length, source: [...sources].join(' + ') || '—', ms: Math.round(performance.now() - t0), octets }, [octets]);
    } catch (e) {
        self.postMessage({ id: m.id, ok: false, erreur: String(e && e.message || e) });
    }
};
