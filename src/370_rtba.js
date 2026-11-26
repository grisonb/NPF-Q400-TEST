/*
 * v18.07 — RÉSEAU RTBA (AZBA) sur la carte, mêmes règles que BFG TEST (Briefing_fdf_TEST v5.51, index.html, module
 * « RTBA (AZBA) SUR LA CARTE FRANCE »), reprises à l'identique :
 *  - source : NAS get-sdvfr-temporary-airspaces.php?type=rtba&ceiling=195 (même plafond fixe que BFG), délai 25 s ;
 *    réponse valable seulement si ok === true, type === 'rtba' et payload.airspaces est un tableau ; vraies RTBA
 *    seulement (type AZBA ou sous-type RTBA) ; heure du fichier = finishedAt / savedAt du NAS (heure réelle de SDVFR) ;
 *  - créneaux : un objet = un créneau, ou un créneau par plage des « activations » (nouveau format SDVFR) ;
 *    heure illisible, contour illisible : non affiché ; créneau terminé : retiré ;
 *  - nuit civile (soleil à -6°, au centre du secteur) : créneau qui touche la nuit avec 30 min de jour ou moins : écarté ;
 *    créneau qui COMMENCE après le coucher du soleil moins 30 min (jour UTC de son début) : écarté ; calcul impossible :
 *    créneau gardé (prudence) ;
 *  - regroupement par SECTEUR (même code et même contour) ; secteur actif si un créneau est en cours, sinon à venir ;
 *  - actif : magenta vif FIXE ; à venir : rose clair CLIGNOTANT ; horaires en UTC « HH:MMZ » (date jj/mm si ce n'est
 *    pas le jour UTC courant) ; fenêtre au toucher : toutes les zones sous le doigt, créneaux ACTIF / À VENIR / TERMINÉ
 *    (créneaux terminés du jour gardés en mémoire, SDVFR ne renvoyant que les créneaux en cours ou à venir) ;
 *  - actualisation toutes les 5 min (en ligne, app au premier plan), au lancement et au retour au premier plan ;
 *    jamais deux demandes en moins de 60 s ; recalcul local des statuts chaque minute, sans réseau.
 * Différence voulue : NPF-Q400 n'a pas de champ « FL max » : aucun filtre de niveau (BFG sans valeur saisie = idem).
 *
 * Décisions de Bastien (26/11/2026) : bouton « RTBA » de la colonne des calques, ALLUMÉ par défaut et rallumé à chaque
 * lancement (jamais enregistré), éteint = masqué seulement (les téléchargements continuent) ; affiché à toutes les
 * échelles ; sans réseau, dernier fichier valable gardé (« RTBA de 14:32 ») ; un fichier d'un jour de Paris précédent
 * n'est JAMAIS affiché ; un échec ne remplace jamais le dernier fichier valable ; les touchers RTBA ne bloquent jamais
 * les autres touchers (terrains, trait feu-pélic, WP, appui long).
 *
 * Fluidité : contours, regroupement, nuit et coucher du soleil calculés UNE FOIS par fichier ; la minute ne recalcule
 * que les statuts (et ne touche à la carte que si un statut change, jamais pendant un geste) ; clignotement par
 * l'opacité CSS du niveau « à venir » seulement (aucun redessin) ; niveaux sans pointer-events (le doigt les traverse),
 * le toucher est traité au clic sur la carte, après les autres (terrains, trait, symboles, fenêtres).
 */
const NPF_RTBA_API_URL = 'https://grisonb.synology.me/briefing-api/get-sdvfr-temporary-airspaces.php';
const NPF_RTBA_CEILING = 195;
const NPF_RTBA_REFRESH_MS = 5 * 60 * 1000;
const NPF_RTBA_MIN_INTERVAL_MS = 60 * 1000;
const NPF_RTBA_TICK_MS = 60 * 1000;
const NPF_RTBA_TIMEOUT_MS = 25000;
const NPF_RTBA_STORE_KEY = 'npfQ400TestRtbaV1';
const NPF_RTBA_DAY_SLOTS_KEY = 'npfQ400TestRtbaJourV1';
const NPF_RTBA_SUNSET_MARGIN_MS = 30 * 60 * 1000;
const NPF_RTBA_NIGHT_DAY_TOLERANCE_MIN = 30;
const NPF_RTBA_STYLE_ACTIVE = { color: '#d1007a', fillColor: '#ff1aa3', weight: 2.5, opacity: 1, fillOpacity: 0.32 };
const NPF_RTBA_STYLE_UPCOMING = { color: '#f08cc4', fillColor: '#fbc6e3', weight: 2, opacity: 0.95, fillOpacity: 0.28 };

const npfRtba = {
    visible: true,
    installed: false,
    airspaces: null,        // vraies RTBA du dernier fichier valable (mémoire)
    fetchedAt: null,        // Date de récupération SDVFR de ce fichier
    fromMemory: false,      // fichier gardé (hors ligne, échec, ou relu au lancement)
    sectors: [],            // secteurs préparés une fois par fichier
    counts: null,
    nonRtbaIgnored: 0,
    state: 'aucun',         // 'ok' | 'veille' | 'aucun'
    shown: [],              // secteurs dessinés : { sector, status, slots }
    layers: new Map(),      // clé secteur -> { layer, status }
    inFlight: null,
    lastRequestAt: 0,
    lastAttemptAt: null,
    lastReason: '',
    lastResult: '',
    lastError: '',
    httpStatus: null,
    failures: 0,
    downloads: 0,
    relaySource: '',
    relayVersion: '',
    workerVersion: '',
    stored: 'non',
    renders: 0,
    layerChanges: 0,
    lastRenderMs: 0,
    prepareMs: 0,
    popup: null,
    pendingRender: false,
    moving: false,
    messageTimer: null,
    lastMessageKey: ''
};

/* ---------- Dates, jour de Paris, heures ---------- */
function npfRtbaParseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const d = new Date(value < 1e12 ? value * 1000 : value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const raw = String(value).trim();
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function npfRtbaParisDayKey(ms) {
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

function npfRtbaHhMm(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--';
    try {
        return date.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
}

function npfRtbaDayMonth(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--/--';
    try {
        return date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' });
    } catch (_) {
        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    }
}

function npfRtbaFormatUtc(date, nowMs) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '?';
    const today = new Date(nowMs);
    const sameDay = date.getUTCFullYear() === today.getUTCFullYear()
        && date.getUTCMonth() === today.getUTCMonth()
        && date.getUTCDate() === today.getUTCDate();
    const hhmm = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}Z`;
    if (sameDay) return hhmm;
    return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')} ${hhmm}`;
}

function npfRtbaEscape(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- Niveaux (mêmes libellés que BFG : FL195, 6000 ft AMSL, 1000 ft ASFC, SFC, UNL) ---------- */
function npfRtbaAltitudeToFl(value, unitHint) {
    if (value === null || value === undefined || value === '') return null;
    const raw = String(value).trim().toUpperCase();
    if (!raw || raw === 'SFC' || raw === 'GND') return 0;
    if (raw.includes('UNL')) return 999;
    const n = Number(((raw.match(/-?\d+(?:[.,]\d+)?/) || [])[0] || '').replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    const unit = String(unitHint || raw).toUpperCase();
    if (unit.includes('FL')) return n;
    if (unit.includes('M ') || unit.endsWith('M') || unit.includes('METR')) return (n * 3.28084) / 100;
    if (unit.includes('FT') || unit.includes('FEET') || n > 660) return n / 100;
    return n;
}

function npfRtbaFormatAltitude(raw, fl, unitHint, reference, msl) {
    if (raw === null || raw === undefined || raw === '') {
        return Number.isFinite(fl) ? `FL${Math.round(fl)}` : 'Non précisé';
    }
    const text = String(raw).trim().toUpperCase();
    const ref = String(reference || '').trim().toUpperCase();
    const unit = String(unitHint || '').trim().toUpperCase();
    const numeric = Number(((text.match(/-?\d+(?:[.,]\d+)?/) || [])[0] || '').replace(',', '.'));
    const mslValue = msl === null || msl === undefined || msl === '' ? NaN : Number(msl);
    if (text.includes('UNL') || (Number.isFinite(mslValue) && mslValue >= 99900)
        || (numeric === 999 && (unit.includes('FL') || ref === 'STD'))) return 'UNL';
    if (text === 'SFC' || text === 'GND') return 'SFC';
    if (numeric === 0 && (ref === 'HEI' || ref === 'ASFC' || ref === 'AGL' || unit.includes('FT'))) return 'SFC';
    if (!Number.isFinite(numeric)) return `${String(raw)}${unit ? ' ' + unit : ''}${ref ? ' ' + ref : ''}`;
    if (unit.includes('FL') || ref === 'STD') return `FL${Math.round(numeric)}`;
    if (ref === 'ALT' || ref === 'AMSL') return `${Math.round(numeric)} ft AMSL`;
    if (ref === 'HEI' || ref === 'ASFC' || ref === 'AGL') return `${Math.round(numeric)} ft ASFC`;
    return `${String(raw)}${unit ? ' ' + unit : ''}${ref ? ' ' + ref : ''}`;
}

/* ---------- Contours (WKT SDVFR « SRID=4326;POLYGON(...) » / MULTIPOLYGON) ---------- */
function npfRtbaParseWkt(wkt) {
    if (!wkt || typeof wkt !== 'string') return null;
    let text = wkt.trim().replace(/^SRID=\d+;/i, '');
    const typeMatch = text.match(/^(POLYGON|MULTIPOLYGON)\s*/i);
    if (!typeMatch) return null;
    const type = typeMatch[1].toUpperCase();
    text = text.slice(typeMatch[0].length).trim();
    const parseRing = ring => ring.split(',').map(pair => {
        const parts = pair.trim().split(/\s+/).map(Number);
        return parts.length >= 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : null;
    }).filter(Boolean);
    try {
        if (type === 'POLYGON') {
            const inner = text.replace(/^\(\(/, '').replace(/\)\)$/, '');
            const rings = inner.split(/\)\s*,\s*\(/).map(parseRing).filter(r => r.length >= 3);
            return rings.length ? { type: 'Polygon', coordinates: rings } : null;
        }
        const inner = text.replace(/^\(\(\(/, '').replace(/\)\)\)$/, '');
        const polygons = inner.split(/\)\)\s*,\s*\(\(/).map(poly => poly.split(/\)\s*,\s*\(/).map(parseRing).filter(r => r.length >= 3))
            .filter(poly => poly.length);
        return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null;
    } catch (_) {
        return null;
    }
}

function npfRtbaGeometryCentre(geometry) {
    try {
        const ring = geometry.type === 'Polygon' ? geometry.coordinates[0]
            : geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0] : null;
        if (!Array.isArray(ring) || ring.length < 3) return null;
        const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
        const pts = ring.slice(0, ring.length - (closed ? 1 : 0));
        const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    } catch (_) {
        return null;
    }
}

function npfRtbaPointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function npfRtbaGeometryContains(geometry, lon, lat) {
    try {
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
            : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
        return polygons.some(rings => {
            let inside = false;
            rings.forEach(ring => { if (npfRtbaPointInRing(lon, lat, ring)) inside = !inside; });
            return inside;
        });
    } catch (_) {
        return false;
    }
}

/* ---------- Soleil (algorithme NOAA, identique à BFG) ---------- */
function npfRtbaSunEventMs(dayUtcMs, lat, lon, rise, zenithDeg) {
    const day = new Date(dayUtcMs);
    const start = Date.UTC(day.getUTCFullYear(), 0, 1);
    const n = Math.floor((Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - start) / 86400000) + 1;
    const gamma = 2 * Math.PI / 365 * (n - 1);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
        - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma)
        + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    const rad = Math.PI / 180;
    const cosHa = Math.cos(zenithDeg * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
    if (!(cosHa >= -1 && cosHa <= 1)) return NaN;
    const ha = Math.acos(cosHa) / rad;
    const minutes = 720 - 4 * (lon + (rise ? ha : -ha)) - eqt;
    return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + minutes * 60000;
}

function npfRtbaSlotDayMinutes(startMs, endMs, lat, lon) {
    if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)) return null;
    if (!(Number.isFinite(lat) && Number.isFinite(lon))) return null;
    let nightMs = 0;
    const s = new Date(startMs);
    const firstDay = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - 86400000;
    for (let d = firstDay; d < endMs + 86400000; d += 86400000) {
        const dusk = npfRtbaSunEventMs(d, lat, lon, false, 96);
        const dawn = npfRtbaSunEventMs(d + 86400000, lat, lon, true, 96);
        if (!Number.isFinite(dusk) || !Number.isFinite(dawn)) return null;
        const overlap = Math.min(endMs, dawn) - Math.max(startMs, dusk);
        if (overlap > 0) nightMs += overlap;
    }
    return Math.max(0, (endMs - startMs - nightMs) / 60000);
}

function npfRtbaSlotIsNight(startMs, endMs, centre) {
    if (!centre) return false;
    const dayMinutes = npfRtbaSlotDayMinutes(startMs, endMs, centre[0], centre[1]);
    if (dayMinutes === null) return false;
    const nightMinutes = (endMs - startMs) / 60000 - dayMinutes;
    return nightMinutes > 0 && dayMinutes <= NPF_RTBA_NIGHT_DAY_TOLERANCE_MIN;
}

function npfRtbaStartsAfterSunsetMinus30(startMs, centre) {
    if (!centre || !Number.isFinite(startMs)) return false;
    const d = new Date(startMs);
    const dayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const sunset = npfRtbaSunEventMs(dayUtc, centre[0], centre[1], false, 90.833);
    if (!Number.isFinite(sunset)) return false;
    return startMs > sunset - NPF_RTBA_SUNSET_MARGIN_MS;
}

/* ---------- Objets SDVFR ---------- */
function npfRtbaIsRealRtba(item) {
    if (!item || typeof item !== 'object') return false;
    const type = String(item.type || '').trim().toUpperCase();
    const local = String(item.local_type || item.localType || '').trim().toUpperCase();
    return type === 'AZBA' || local === 'RTBA';
}

function npfRtbaNormalizeZone(item) {
    if (!item || typeof item !== 'object') return null;
    const f = (snake, camel) => (item[snake] !== undefined && item[snake] !== null ? item[snake] : item[camel]);
    const lowerUnit = f('lower_limit_unit', 'lowerLimitUnit') || '';
    const upperUnit = f('upper_limit_unit', 'upperLimitUnit') || '';
    const lowerRaw = f('lower_limit', 'lowerLimit');
    const upperRaw = f('upper_limit', 'upperLimit');
    const lowerReference = String(f('lower_limit_reference', 'lowerLimitReference') || '').trim();
    const upperReference = String(f('upper_limit_reference', 'upperLimitReference') || '').trim();
    return {
        code: String(item.code || item.label || '').trim() || 'RTBA',
        start: npfRtbaParseDate(f('start_validity', 'startValidity')),
        end: npfRtbaParseDate(f('end_validity', 'endValidity')),
        lower: npfRtbaFormatAltitude(lowerRaw, npfRtbaAltitudeToFl(lowerRaw, lowerUnit), lowerUnit, lowerReference, f('lower_limit_msl', 'lowerLimitMsl')),
        upper: npfRtbaFormatAltitude(upperRaw, npfRtbaAltitudeToFl(upperRaw, upperUnit), upperUnit, upperReference, f('upper_limit_msl', 'upperLimitMsl'))
    };
}

/* Créneaux détaillés (« activations[].windows », mêmes règles que les zones NOTAM de BFG). */
function npfRtbaActivationWindows(item, fromMs, toMs) {
    const out = [];
    const acts = Array.isArray(item && item.activations) ? item.activations : [];
    acts.forEach(act => {
        const days = Array.isArray(act && act.days) && act.days.length ? act.days.map(Number) : [1, 2, 3, 4, 5, 6, 7];
        (Array.isArray(act && act.windows) ? act.windows : []).forEach(w => {
            const s = npfRtbaParseDate(w && w.start);
            if (!s) return;
            const e = npfRtbaParseDate(w && w.end);
            const sMs = s.getTime();
            const eMs = e ? e.getTime() : Number.MAX_SAFE_INTEGER;
            if (!act.dailyTimeWindow) {
                if (sMs < toMs && eMs > fromMs) out.push({ start: sMs, end: eMs });
                return;
            }
            if (!e || eMs < sMs) return;
            const startTod = sMs % 86400000;
            let endTod = eMs % 86400000;
            if (endTod <= startTod) endTod += 86400000;
            for (let day = Math.max(Math.floor(sMs / 86400000), Math.floor(fromMs / 86400000) - 1);
                day <= Math.min(Math.floor(eMs / 86400000), Math.floor(toMs / 86400000) + 1); day++) {
                const isoDay = ((new Date(day * 86400000).getUTCDay() + 6) % 7) + 1;
                if (!days.includes(isoDay)) continue;
                const ws = day * 86400000 + startTod, we = day * 86400000 + endTod;
                if (ws < toMs && we > fromMs) out.push({ start: ws, end: we });
            }
        });
    });
    return out.sort((a, b) => a.start - b.start);
}

function npfRtbaSlotsFromItem(item, refMs) {
    const zone = npfRtbaNormalizeZone(item);
    if (!zone) return [];
    const acts = Array.isArray(item.activations) ? item.activations : [];
    if (acts.some(a => Array.isArray(a && a.windows) && a.windows.length)) {
        return npfRtbaActivationWindows(item, refMs - 86400000, refMs + 2 * 86400000)
            .filter(w => w.end < Number.MAX_SAFE_INTEGER)
            .map(w => ({ ...zone, start: new Date(w.start), end: new Date(w.end) }));
    }
    return [zone];
}

function npfRtbaLatLngs(geometry) {
    const ring = r => r.map(p => [p[1], p[0]]);
    if (geometry.type === 'Polygon') return geometry.coordinates.map(ring);
    return geometry.coordinates.map(poly => poly.map(ring));
}

function npfRtbaBbox(geometry) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polys.forEach(poly => (poly[0] || []).forEach(p => {
        if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1];
    }));
    return [w, s, e, n];
}

/* UNE FOIS par fichier : contours, nuit, coucher du soleil, regroupement par secteur (ne dépend pas de l'heure). */
function npfRtbaPrepare(airspaces, refMs) {
    const t0 = performance.now();
    const counts = { slotsNoSchedule: 0, slotsInvalid: 0, slotsNight: 0, slotsAfterSunset: 0, slotsKept: 0 };
    const byKey = new Map();
    const geometryCache = new Map();
    (airspaces || []).forEach(item => {
        const slots = npfRtbaSlotsFromItem(item, refMs);
        if (!slots.length) { counts.slotsNoSchedule += 1; return; }
        const geometryText = typeof (item && item.coordinates) === 'string' ? item.coordinates.trim() : '';
        if (!geometryCache.has(geometryText)) {
            const geometry = npfRtbaParseWkt(geometryText);
            geometryCache.set(geometryText, geometry ? { geometry, centre: npfRtbaGeometryCentre(geometry) } : null);
        }
        const geo = geometryCache.get(geometryText);
        slots.forEach(zone => {
            if (!(zone.start instanceof Date) || !(zone.end instanceof Date)) { counts.slotsNoSchedule += 1; return; }
            if (!geo) { counts.slotsInvalid += 1; return; }
            if (npfRtbaSlotIsNight(zone.start.getTime(), zone.end.getTime(), geo.centre)) { counts.slotsNight += 1; return; }
            if (npfRtbaStartsAfterSunsetMinus30(zone.start.getTime(), geo.centre)) { counts.slotsAfterSunset += 1; return; }
            const key = `${zone.code}|${geometryText}`;
            if (!byKey.has(key)) {
                byKey.set(key, {
                    key, code: zone.code, geometry: geo.geometry,
                    latlngs: npfRtbaLatLngs(geo.geometry), bbox: npfRtbaBbox(geo.geometry), slots: []
                });
            }
            byKey.get(key).slots.push(zone);
            counts.slotsKept += 1;
        });
    });
    const sectors = Array.from(byKey.values());
    sectors.forEach(sector => sector.slots.sort((a, b) => a.start.getTime() - b.start.getTime()));
    npfRtba.prepareMs = Math.round((performance.now() - t0) * 10) / 10;
    return { sectors, counts };
}

/* ---------- Mémoire : dernier fichier valable, créneaux du jour ---------- */
function npfRtbaReadStore() {
    try {
        const parsed = JSON.parse(localStorage.getItem(NPF_RTBA_STORE_KEY) || 'null');
        if (!parsed || !Array.isArray(parsed.airspaces)) return null;
        const fetchedAt = new Date(parsed.fetchedAt || '');
        if (Number.isNaN(fetchedAt.getTime())) return null;
        return { airspaces: parsed.airspaces.filter(npfRtbaIsRealRtba), fetchedAt };
    } catch (_) {
        return null;
    }
}

function npfRtbaWriteStore(airspaces, fetchedAt) {
    try {
        localStorage.setItem(NPF_RTBA_STORE_KEY, JSON.stringify({
            version: 1, fetchedAt: fetchedAt.toISOString(), storedAt: new Date().toISOString(), airspaces
        }));
        npfRtba.stored = 'oui';
    } catch (_) {
        npfRtba.stored = 'mémoire seulement (enregistrement impossible)';
    }
}

let npfRtbaDaySlots = null;   // { day: 'AAAA-MM-JJ' (Paris), sectors: { clé: { id: { s, e, lower, upper } } } }
function npfRtbaSectorStoreKey(sector) {
    let h = 5381;
    const text = String(sector.key || '');
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return `${sector.code}|${h.toString(36)}`;
}

function npfRtbaDaySlotsFor(nowMs) {
    const day = npfRtbaParisDayKey(nowMs);
    if (!npfRtbaDaySlots) {
        try {
            const stored = JSON.parse(localStorage.getItem(NPF_RTBA_DAY_SLOTS_KEY) || 'null');
            if (stored && stored.day === day && stored.sectors && typeof stored.sectors === 'object') npfRtbaDaySlots = stored;
        } catch (_) {}
    }
    if (!npfRtbaDaySlots || npfRtbaDaySlots.day !== day) npfRtbaDaySlots = { day, sectors: {} };
    return npfRtbaDaySlots;
}

function npfRtbaRememberSlots(shown, nowMs) {
    try {
        const memory = npfRtbaDaySlotsFor(nowMs);
        let changed = false;
        shown.forEach(entry => {
            const sk = npfRtbaSectorStoreKey(entry.sector);
            const sector = memory.sectors[sk] || (memory.sectors[sk] = {});
            entry.slots.forEach(({ zone }) => {
                const id = `${zone.start.toISOString()}|${zone.end.toISOString()}`;
                if (sector[id]) return;
                sector[id] = { s: zone.start.toISOString(), e: zone.end.toISOString(), lower: zone.lower, upper: zone.upper };
                changed = true;
            });
        });
        if (changed) localStorage.setItem(NPF_RTBA_DAY_SLOTS_KEY, JSON.stringify(memory));
    } catch (_) {}
}

function npfRtbaEndedSlotsFor(entry, nowMs) {
    try {
        const memory = npfRtbaDaySlotsFor(nowMs);
        const sector = memory.sectors[npfRtbaSectorStoreKey(entry.sector)] || {};
        const current = new Set(entry.slots.map(({ zone }) => `${zone.start.toISOString()}|${zone.end.toISOString()}`));
        return Object.entries(sector)
            .filter(([id, slot]) => !current.has(id) && Date.parse(slot.e) <= nowMs)
            .map(([, slot]) => ({ zone: { start: new Date(slot.s), end: new Date(slot.e), lower: slot.lower, upper: slot.upper }, status: 'ended' }));
    } catch (_) {
        return [];
    }
}

/* ---------- Carte : niveaux, rendu ---------- */
function npfRtbaEnsurePanes() {
    if (!map || !map.createPane) return false;
    [['npfRtbaAVenirPane', '446'], ['npfRtbaActifPane', '447']].forEach(([name, z]) => {
        if (map.getPane(name)) return;
        const pane = map.createPane(name);
        pane.style.zIndex = z;
        pane.style.pointerEvents = 'none';
    });
    if (!npfRtba.rendererActive) npfRtba.rendererActive = L.canvas({ pane: 'npfRtbaActifPane', padding: 0.3 });
    if (!npfRtba.rendererUpcoming) npfRtba.rendererUpcoming = L.canvas({ pane: 'npfRtbaAVenirPane', padding: 0.3 });
    npfRtbaApplyVisibility();
    return true;
}

function npfRtbaApplyVisibility() {
    if (!map) return;
    ['npfRtbaAVenirPane', 'npfRtbaActifPane'].forEach(name => {
        const pane = map.getPane(name);
        if (pane) pane.style.display = npfRtba.visible ? '' : 'none';
    });
    const upcoming = map.getPane('npfRtbaAVenirPane');
    if (upcoming) {
        const blink = npfRtba.visible && npfRtba.shown.some(entry => entry.status === 'upcoming');
        upcoming.classList.toggle('npf-rtba-clignote', blink);
    }
}

function npfRtbaClearLayers() {
    npfRtba.layers.forEach(entry => { try { map.removeLayer(entry.layer); } catch (_) {} });
    if (npfRtba.layers.size) npfRtba.layerChanges += 1;
    npfRtba.layers.clear();
    npfRtba.shown = [];
}

/* Statuts à l'heure « nowMs » ; la carte n'est touchée que si un secteur apparaît, disparaît ou change de statut. */
function npfRtbaRender() {
    if (!npfRtba.installed || !map) return;
    if (npfRtba.moving) { npfRtba.pendingRender = true; return; }
    npfRtba.pendingRender = false;
    const t0 = performance.now();
    const nowMs = Date.now();
    npfRtba.renders += 1;
    const today = npfRtbaParisDayKey(nowMs);
    if (!Array.isArray(npfRtba.airspaces) || !(npfRtba.fetchedAt instanceof Date)) {
        npfRtba.state = 'aucun';
        npfRtbaClearLayers();
    } else if (npfRtbaParisDayKey(npfRtba.fetchedAt.getTime()) !== today) {
        npfRtba.state = 'veille';
        npfRtbaClearLayers();
    } else {
        npfRtba.state = 'ok';
        const shown = [];
        npfRtba.sectors.forEach(sector => {
            const slots = [];
            sector.slots.forEach(zone => {
                const s = zone.start.getTime(), e = zone.end.getTime();
                if (e <= nowMs) return;
                slots.push({ zone, status: s > nowMs ? 'upcoming' : 'active' });
            });
            if (!slots.length) return;
            shown.push({ sector, slots, status: slots.some(x => x.status === 'active') ? 'active' : 'upcoming' });
        });
        const seen = new Set();
        let changed = false;
        shown.forEach(entry => {
            const key = entry.sector.key;
            seen.add(key);
            const existing = npfRtba.layers.get(key);
            if (existing && existing.status === entry.status) return;
            if (existing) { try { map.removeLayer(existing.layer); } catch (_) {} }
            const active = entry.status === 'active';
            const layer = L.polygon(entry.sector.latlngs, {
                ...(active ? NPF_RTBA_STYLE_ACTIVE : NPF_RTBA_STYLE_UPCOMING),
                pane: active ? 'npfRtbaActifPane' : 'npfRtbaAVenirPane',
                renderer: active ? npfRtba.rendererActive : npfRtba.rendererUpcoming,
                interactive: false
            });
            layer.addTo(map);
            npfRtba.layers.set(key, { layer, status: entry.status });
            changed = true;
        });
        Array.from(npfRtba.layers.keys()).forEach(key => {
            if (seen.has(key)) return;
            try { map.removeLayer(npfRtba.layers.get(key).layer); } catch (_) {}
            npfRtba.layers.delete(key);
            changed = true;
        });
        if (changed) npfRtba.layerChanges += 1;
        npfRtba.shown = shown;
        npfRtbaRememberSlots(shown, nowMs);
    }
    npfRtbaApplyVisibility();
    npfRtbaUpdateButton();
    npfRtbaRefreshPopup();
    npfRtba.lastRenderMs = Math.round((performance.now() - t0) * 10) / 10;
}

/* ---------- Bouton, message ---------- */
function npfRtbaStatusText() {
    if (npfRtba.state === 'ok') {
        return `RTBA de ${npfRtbaHhMm(npfRtba.fetchedAt)}${npfRtba.fromMemory ? ' (dernier fichier gardé)' : ''}`;
    }
    if (npfRtba.state === 'veille') {
        return `RTBA : pas de fichier d'aujourd'hui (dernier du ${npfRtbaDayMonth(npfRtba.fetchedAt)} à ${npfRtbaHhMm(npfRtba.fetchedAt)}) — rien affiché`;
    }
    if (npfRtba.inFlight) return 'RTBA : chargement…';
    return 'RTBA : aucun fichier (pas encore reçu) — rien affiché';
}

function npfRtbaUpdateButton() {
    const button = document.getElementById('rtba-layer-button');
    if (!button) return;
    button.classList.toggle('active', npfRtba.visible);
    button.setAttribute('aria-pressed', npfRtba.visible ? 'true' : 'false');
    button.classList.toggle('rtba-sans-fichier', npfRtba.state !== 'ok');
    button.classList.toggle('rtba-fichier-garde', npfRtba.state === 'ok' && npfRtba.fromMemory);
    const status = document.getElementById('rtba-button-status');
    const text = npfRtba.state === 'ok' ? npfRtbaHhMm(npfRtba.fetchedAt) : (npfRtba.state === 'veille' ? 'veille' : '—');
    if (status && status.textContent !== text) status.textContent = text;
    const title = `${npfRtba.visible ? 'Masquer' : 'Afficher'} le réseau RTBA — ${npfRtbaStatusText()}`;
    if (button.title !== title) {
        button.title = title;
        button.setAttribute('aria-label', title);
    }
    /* Message seulement une fois la demande du lancement faite (ou hors ligne) : pas d'alerte avant la première réponse. */
    const launchDone = !!npfRtba.lastAttemptAt || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (npfRtba.visible && npfRtba.state !== 'ok' && !npfRtba.inFlight && launchDone) {
        npfRtbaShowMessage(`${npfRtba.state}|${npfRtba.fetchedAt ? npfRtba.fetchedAt.getTime() : 0}`, npfRtbaStatusText());
    }
}

/* Message bref en haut de la carte, une fois par situation (pas de fichier du jour, aucun fichier). */
function npfRtbaShowMessage(key, text, force) {
    if (!force && npfRtba.lastMessageKey === key) return;
    npfRtba.lastMessageKey = key;
    let el = document.getElementById('npf-rtba-message');
    if (!el) {
        el = document.createElement('div');
        el.id = 'npf-rtba-message';
        el.className = 'npf-rtba-message';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('visible');
    if (npfRtba.messageTimer) clearTimeout(npfRtba.messageTimer);
    npfRtba.messageTimer = setTimeout(() => { el.classList.remove('visible'); npfRtba.messageTimer = null; }, 8000);
}

function npfRtbaToggle() {
    npfRtba.visible = !npfRtba.visible;
    if (!npfRtba.visible && npfRtba.popup && map && map.hasLayer(npfRtba.popup)) map.closePopup(npfRtba.popup);
    npfRtbaApplyVisibility();
    if (npfRtba.visible && npfRtba.state !== 'ok') npfRtbaShowMessage('toggle', npfRtbaStatusText(), true);
    npfRtbaUpdateButton();
}

/* ---------- Téléchargement ---------- */
function npfRtbaApplyFile(airspaces, fetchedAt, fromMemory) {
    const prepared = npfRtbaPrepare(airspaces, fetchedAt.getTime());
    npfRtba.airspaces = airspaces;
    npfRtba.fetchedAt = fetchedAt;
    npfRtba.fromMemory = !!fromMemory;
    npfRtba.sectors = prepared.sectors;
    npfRtba.counts = prepared.counts;
    npfRtbaClearLayers();   // nouveau fichier : secteurs recréés (une fois)
    npfRtbaRender();
}

function npfRtbaRefresh(reason) {
    if (npfRtba.inFlight) return npfRtba.inFlight;
    const now = Date.now();
    if (now - npfRtba.lastRequestAt < NPF_RTBA_MIN_INTERVAL_MS) return Promise.resolve(false);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (Array.isArray(npfRtba.airspaces) && !npfRtba.fromMemory) { npfRtba.fromMemory = true; npfRtbaRender(); }
        return Promise.resolve(false);
    }
    npfRtba.lastRequestAt = now;
    npfRtba.lastAttemptAt = new Date(now);
    npfRtba.lastReason = String(reason || '');
    npfRtba.inFlight = npfRtbaRequest().finally(() => { npfRtba.inFlight = null; npfRtbaUpdateButton(); });
    npfRtbaUpdateButton();
    return npfRtba.inFlight;
}

async function npfRtbaRequest() {
    npfRtba.httpStatus = null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), NPF_RTBA_TIMEOUT_MS) : null;
    try {
        const url = `${NPF_RTBA_API_URL}?type=rtba&ceiling=${NPF_RTBA_CEILING}&t=${Date.now()}`;
        const response = await fetch(url, {
            method: 'GET', cache: 'no-store', credentials: 'omit',
            headers: { 'Accept': 'application/json' },
            signal: controller ? controller.signal : undefined
        });
        npfRtba.httpStatus = response.status;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let data;
        try { data = await response.json(); } catch (_) { throw new Error('réponse non JSON'); }
        const all = data && data.payload && data.payload.airspaces;
        if (!data || data.ok !== true || data.type !== 'rtba' || !Array.isArray(all)) {
            throw new Error(data && (data.error || data.erreur) ? String(data.error || data.erreur) : 'structure de réponse non reconnue');
        }
        npfRtba.relaySource = String(data.source || '');
        npfRtba.relayVersion = String(data.relayVersion || '');
        npfRtba.workerVersion = String((data.relayDiagnostic && data.relayDiagnostic.workerVersion) || '');
        const fetchedAt = npfRtbaParseDate(data.finishedAt || data.savedAt) || new Date();
        const airspaces = all.filter(npfRtbaIsRealRtba);
        npfRtba.nonRtbaIgnored = all.length - airspaces.length;
        npfRtbaWriteStore(airspaces, fetchedAt);
        npfRtba.downloads += 1;
        const fromNasCache = /^nas-cache/.test(npfRtba.relaySource) || data.stale === true;
        npfRtba.lastResult = `${airspaces.length ? 'OK' : 'OK, réponse vide'}${fromNasCache ? ` (cache NAS${data.stale === true ? ', worker indisponible' : ''})` : ''}`;
        npfRtba.lastError = '';
        npfRtbaApplyFile(airspaces, fetchedAt, false);
        return true;
    } catch (error) {
        const message = error && error.name === 'AbortError' ? 'délai dépassé' : (error && error.message || String(error));
        npfRtba.failures += 1;
        npfRtba.lastResult = 'ERREUR';
        npfRtba.lastError = message;
        /* Un échec ne remplace jamais le dernier fichier valable : il reste affiché (s'il est du jour). */
        if (Array.isArray(npfRtba.airspaces)) npfRtba.fromMemory = true;
        npfRtbaRender();
        return false;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/* ---------- Toucher : fenêtre listant toutes les zones sous le doigt ---------- */
function npfRtbaPopupHtmlFor(entry, nowMs) {
    const row = (label, value) => `<div class="npf-rtba-popup-row"><strong>${label} :</strong> ${npfRtbaEscape(value)}</div>`;
    const rows = entry.slots.map(({ zone, status }) => ({ zone, status })).concat(npfRtbaEndedSlotsFor(entry, nowMs));
    rows.sort((x, y) => x.zone.start.getTime() - y.zone.start.getTime());
    const sameLimits = rows.every(r => r.zone.lower === rows[0].zone.lower && r.zone.upper === rows[0].zone.upper);
    const tagOf = { active: 'ACTIF', upcoming: 'À VENIR', ended: 'TERMINÉ' };
    const slotRows = rows.map(({ zone, status }) => {
        const extra = sameLimits ? '' : ` — ${zone.lower} / ${zone.upper}`;
        return `<div class="npf-rtba-slot npf-rtba-slot-${status}"><span class="npf-rtba-slot-tag">${tagOf[status]}</span> `
            + `${npfRtbaEscape(`${npfRtbaFormatUtc(zone.start, nowMs)} → ${npfRtbaFormatUtc(zone.end, nowMs)}${extra}`)}</div>`;
    }).join('');
    return `<div class="npf-rtba-popup-title">RTBA</div>`
        + `<div class="npf-rtba-popup-row npf-rtba-popup-code"><strong>${npfRtbaEscape(entry.sector.code)}</strong></div>`
        + row('Statut', entry.status === 'active' ? 'Actif' : 'À venir')
        + (sameLimits ? row('Plancher', rows[0].zone.lower) + row('Plafond', rows[0].zone.upper) : '')
        + `<div class="npf-rtba-popup-row"><strong>Créneau${rows.length > 1 ? 'x' : ''} (UTC) :</strong></div>`
        + slotRows;
}

function npfRtbaEntriesAt(latlng) {
    if (!latlng || !npfRtba.visible || npfRtba.state !== 'ok') return [];
    const lon = latlng.lng, lat = latlng.lat;
    return npfRtba.shown.filter(entry => {
        const b = entry.sector.bbox;
        if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return false;
        return npfRtbaGeometryContains(entry.sector.geometry, lon, lat);
    });
}

function npfRtbaPopupHtmlAt(latlng) {
    const nowMs = Date.now();
    const entries = npfRtbaEntriesAt(latlng);
    if (!entries.length) return '';
    entries.sort((a, b) => (a.status === b.status ? a.sector.code.localeCompare(b.sector.code) : (a.status === 'active' ? -1 : 1)));
    return entries.map(entry => npfRtbaPopupHtmlFor(entry, nowMs)).join('<hr class="npf-rtba-popup-sep">')
        + `<div class="npf-rtba-popup-row npf-rtba-popup-source">Source : SDVFR — ${npfRtbaEscape(npfRtbaStatusText())}</div>`;
}

function npfRtbaOpenPopupAt(latlng) {
    const html = npfRtbaPopupHtmlAt(latlng);
    if (!html) return false;
    const follow = typeof centerGpsFollowActive !== 'undefined' && centerGpsFollowActive;
    const popup = L.popup({
        maxWidth: 360, maxHeight: 340, autoPan: !follow, keepInView: !follow,
        className: 'npf-rtba-popup'
    }).setLatLng(latlng).setContent(html).openOn(map);
    npfRtba.popup = popup;
    npfRtba.popupLatLng = latlng;
    return true;
}

function npfRtbaRefreshPopup() {
    const popup = npfRtba.popup;
    if (!popup || !map || !map.hasLayer(popup)) return;
    const html = npfRtbaPopupHtmlAt(npfRtba.popupLatLng);
    if (!html) map.closePopup(popup);
    else if (popup.getContent() !== html) popup.setContent(html);
}

/* Le doigt est-il sur autre chose qu'une zone ? (terrain, trait, WP, trafic, symbole, fenêtre, bouton) : RTBA ne répond pas. */
function npfRtbaOtherTargetAt(clientX, clientY, containerPoint) {
    try {
        if (typeof getNpfPelicRouteNearContainerPoint === 'function' && containerPoint && getNpfPelicRouteNearContainerPoint(containerPoint)) return 'trait';
    } catch (_) {}
    try {
        if (typeof permanentAirportLayer !== 'undefined' && permanentAirportLayer && containerPoint) {
            let near = false;
            permanentAirportLayer.eachLayer(layer => {
                if (near || !layer || !layer._npfAirportOaci || !(layer instanceof L.CircleMarker) || !layer._map) return;
                const c = map.latLngToContainerPoint(layer.getLatLng());
                if (Math.hypot(c.x - containerPoint.x, c.y - containerPoint.y) <= Number(layer.options?.radius || 32)) near = true;
            });
            if (near) return 'terrain';
        }
    } catch (_) {}
    try {
        const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(clientX, clientY) : [];
        for (const el of stack) {
            if (!el || !el.closest) continue;
            if (el.closest('.leaflet-popup, .leaflet-marker-icon, .leaflet-control, button, input, select, textarea, a, .modal, [role="dialog"]')) return 'élément';
            if (el.matches && el.matches('path.leaflet-interactive')) {
                const pane = el.closest('.leaflet-pane');
                const z = pane ? Number(getComputedStyle(pane).zIndex) : NaN;
                const touchPane = pane && ['npfPelicRouteTouchPane', 'npfTouchPane', 'siaCtrTouchPane', 'siaPointTouchPane'].some(name => map.getPane(name) === pane);
                if (!Number.isFinite(z) || z >= 600 || touchPane) return 'symbole';
            }
        }
    } catch (_) {}
    return '';
}

function npfRtbaInstallTouch() {
    const container = map.getContainer();
    let lastDown = null;
    let lastPopupOpenAt = 0;
    let timer = null;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    container.addEventListener('pointerdown', event => {
        const r = container.getBoundingClientRect();
        lastDown = { clientX: Number(event.clientX), clientY: Number(event.clientY), x: Number(event.clientX) - r.left, y: Number(event.clientY) - r.top, at: Date.now() };
    }, { capture: true, passive: true });
    map.on('popupopen', event => { if (!npfRtba.popup || event.popup !== npfRtba.popup) lastPopupOpenAt = Date.now(); });
    map.on('dblclick movestart zoomstart', cancel);
    map.on('movestart zoomstart', () => { npfRtba.moving = true; });
    map.on('moveend zoomend', () => {
        npfRtba.moving = false;
        if (npfRtba.pendingRender) setTimeout(() => { if (!npfRtba.moving && npfRtba.pendingRender) npfRtbaRender(); }, 250);
    });
    map.on('click', event => {
        try {
            if (!npfRtba.visible || !npfRtba.shown.length || !event || !event.latlng) return;
            if (typeof isDrawingMode !== 'undefined' && isDrawingMode) return;
            const longPress = window.__npfFireLongPressTouchState;
            if (longPress && Date.now() < Number(longPress.suppressSyntheticClickUntil || 0)) return;
            const down = lastDown && Date.now() - lastDown.at < 1000 ? lastDown : null;
            const containerPoint = down ? L.point(down.x, down.y) : event.containerPoint;
            const latlng = down ? map.containerPointToLatLng(containerPoint) : event.latlng;
            if (!npfRtbaEntriesAt(latlng).length) return;
            const r = container.getBoundingClientRect();
            const clientX = down ? down.clientX : r.left + event.containerPoint.x;
            const clientY = down ? down.clientY : r.top + event.containerPoint.y;
            if (npfRtbaOtherTargetAt(clientX, clientY, containerPoint)) return;
            const downAt = down ? down.at : Date.now();
            cancel();
            /* Après les autres réponses au même toucher (fenêtres, symboles) et hors double appui de zoom. */
            timer = setTimeout(() => {
                timer = null;
                if (lastPopupOpenAt >= downAt) return;
                if (longPress && Date.now() < Number(longPress.suppressSyntheticClickUntil || 0)) return;
                npfRtbaOpenPopupAt(latlng);
            }, 300);
        } catch (_) {}
    });
}

/* ---------- Installation ---------- */
function installNpfRtba() {
    if (npfRtba.installed) return true;
    if (typeof map === 'undefined' || !map || !window.L || !map.getContainer) return false;
    const button = document.getElementById('rtba-layer-button');
    if (!npfRtbaEnsurePanes()) return false;
    npfRtba.installed = true;
    npfRtba.visible = true;   // allumé à chaque lancement (jamais enregistré)
    if (button) button.addEventListener('click', event => { event.preventDefault(); npfRtbaToggle(); });
    npfRtbaInstallTouch();
    const stored = npfRtbaReadStore();
    if (stored) {
        npfRtba.stored = 'oui';
        npfRtbaApplyFile(stored.airspaces, stored.fetchedAt, true);
    } else {
        npfRtbaRender();
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        npfRtbaRender();
        npfRtbaRefresh('retour au premier plan');
    });
    setInterval(() => {
        if (document.hidden || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
        npfRtbaRefresh('actualisation 5 min');
    }, NPF_RTBA_REFRESH_MS);
    setInterval(() => { if (!document.hidden) npfRtbaRender(); }, NPF_RTBA_TICK_MS);
    npfRtbaRefresh('lancement');
    return true;
}

(function startNpfRtbaWhenMapReady() {
    let attempts = 0;
    const attempt = () => {
        attempts += 1;
        let ok = false;
        try { ok = installNpfRtba(); } catch (_) { ok = false; }
        if (!ok && attempts < 240) setTimeout(attempt, 500);
    };
    setTimeout(attempt, 500);
})();

/* Ligne du DIAG (src/010, SESSION COURANTE) et état lisible par les essais. */
function getNpfRtbaDiagLine() {
    const c = npfRtba.counts || {};
    const sectorsActive = npfRtba.shown.filter(e => e.status === 'active').length;
    const sectorsUpcoming = npfRtba.shown.length - sectorsActive;
    const file = npfRtba.fetchedAt
        ? `${npfRtbaDayMonth(npfRtba.fetchedAt)} ${npfRtbaHhMm(npfRtba.fetchedAt)}${npfRtba.state === 'veille' ? ' (jour précédent : NON affiché)' : ''}`
        : 'aucun';
    return 'RTBA (v18.07) : ' + (npfRtba.visible ? 'ON' : 'OFF (masqué)')
        + ' | dernier téléchargement : ' + file
        + ' | fichier gardé : ' + (npfRtba.fetchedAt ? (npfRtba.fromMemory ? 'oui, affiché depuis la mémoire' : 'oui') : 'non') + ' (enregistré : ' + npfRtba.stored + ')'
        + ' | zones reçues ' + (Array.isArray(npfRtba.airspaces) ? npfRtba.airspaces.length : '—')
        + ' (autres types ignorés ' + npfRtba.nonRtbaIgnored + ')'
        + ' | secteurs actifs ' + sectorsActive + ' / à venir ' + sectorsUpcoming
        + ' | écartés : illisibles ' + ((c.slotsNoSchedule || 0) + (c.slotsInvalid || 0)) + ', nuit ' + (c.slotsNight || 0) + ', après coucher -30 min ' + (c.slotsAfterSunset || 0)
        + ' | téléchargements ' + npfRtba.downloads + ' | échecs ' + npfRtba.failures + (npfRtba.lastError ? ' (dernier : ' + npfRtba.lastError + ')' : '')
        + ' | dernière demande ' + (npfRtba.lastAttemptAt ? npfRtbaHhMm(npfRtba.lastAttemptAt) + ' (' + npfRtba.lastReason + ') ' + (npfRtba.lastResult || '…') : '—')
        + (npfRtba.relayVersion || npfRtba.workerVersion ? ' | relais ' + (npfRtba.relayVersion || '?') + ' / worker ' + (npfRtba.workerVersion || '?') : '')
        + ' | préparation ' + npfRtba.prepareMs + ' ms, recalcul ' + npfRtba.lastRenderMs + ' ms, changements carte ' + npfRtba.layerChanges;
}

function getNpfRtbaEtat() {
    return {
        visible: npfRtba.visible, state: npfRtba.state, fromMemory: npfRtba.fromMemory,
        fetchedAt: npfRtba.fetchedAt ? npfRtba.fetchedAt.toISOString() : null,
        zones: Array.isArray(npfRtba.airspaces) ? npfRtba.airspaces.length : null,
        sectors: npfRtba.sectors.length,
        shown: npfRtba.shown.map(e => ({ code: e.sector.code, status: e.status, slots: e.slots.map(s => s.status) })),
        layers: npfRtba.layers.size, counts: npfRtba.counts, failures: npfRtba.failures, downloads: npfRtba.downloads,
        lastResult: npfRtba.lastResult, lastError: npfRtba.lastError, renders: npfRtba.renders, layerChanges: npfRtba.layerChanges,
        status: npfRtbaStatusText(), diag: getNpfRtbaDiagLine()
    };
}
