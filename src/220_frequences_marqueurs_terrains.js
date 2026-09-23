/* ========================================================================== 
   v16.66 — noms + fréquence opérationnelle des terrains à partir de 2 NM
   ========================================================================== */
function getNpfDisplayedAirportRecordsForLabels() {
    const byOaci = new Map();
    const add = airport => {
        const oaci = String(airport?.oaci || '').trim().toUpperCase();
        const lat = Number(airport?.lat);
        const lon = Number(airport?.lon);
        if (!/^[A-Z]{4}$/.test(oaci) || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (!byOaci.has(oaci)) byOaci.set(oaci, { ...airport, oaci, lat, lon });
    };
    (pelicanAirports || []).forEach(add);
    (otherAirports || []).forEach(add);
    (additionalAerodromes || []).forEach(add);
    return [...byOaci.values()];
}

/* v16.58 — fréquences aérodrome.
 * Priorité : valeurs explicitement vérifiées > services SIA déjà en mémoire
 * > référentiel VAC léger mis en cache. Le simple affichage des noms/fréquences
 * ne déclenche plus le décompactage du jeu SIA. */
const AIRPORT_OPERATIONAL_FREQUENCY_OVERRIDES = new Map([
    ['LFBD', Object.freeze({ type: 'TWR', value: '118.305', priority: 0, source: 'verified' })],
    ['LFCS', Object.freeze({ type: 'A/A', value: '119.005', priority: 2, source: 'verified' })]
]);

/* v16.64 — référentiel local minimal des services opérationnels français.
 * Objectif : AFIS / A/A / INFO restent disponibles hors ligne et ne dépendent
 * plus d'un fetch GitHub au moment de l'affichage. La fréquence NPF reste
 * toujours la valeur affichée et prioritaire. */
const AIRPORT_SERVICE_BUILTIN_EXACT = new Map([
    ['LFAD|122.300', 'A/A'],
    ['LFAV|122.600', 'AFIS'],
    ['LFBD|120.575', 'INFO'],
    ['LFBF|121.250', 'AFIS'],
    ['LFBI|120.775', 'INFO'],
    ['LFBL|124.050', 'INFO'],
    ['LFBN|119.100', 'AFIS'],
    ['LFBO|121.250', 'AFIS'],
    ['LFBU|118.200', 'AFIS'],
    ['LFBX|118.775', 'AFIS'],
    ['LFCC|119.225', 'AFIS'],
    ['LFCI|118.950', 'AFIS'],
    ['LFCK|118.500', 'AFIS'],
    ['LFCM|120.800', 'AFIS'],
    ['LFCY|118.800', 'AFIS'],
    ['LFDH|123.000', 'AFIS'],
    ['LFDJ|118.175', 'AFIS'],
    ['LFDN|119.300', 'AFIS'],
    ['LFEY|118.900', 'AFIS'],
    ['LFFH|120.375', 'A/A'],
    ['LFFI|118.200', 'AFIS'],
    ['LFGF|123.500', 'A/A'],
    ['LFGJ|130.775', 'INFO'],
    ['LFHA|118.150', 'A/A'],
    ['LFHN|123.500', 'A/A'],
    ['LFHO|119.850', 'A/A'],
    ['LFHP|118.000', 'INFO'],
    ['LFHQ|120.050', 'AFIS'],
    ['LFHS|118.450', 'AFIS'],
    ['LFHY|125.200', 'AFIS'],
    ['LFJR|119.000', 'AFIS'],
    ['LFJS|120.375', 'A/A'],
    ['LFKB|124.725', 'AFIS'],
    ['LFKJ|119.825', 'AFIS'],
    ['LFKO|118.500', 'AFIS'],
    ['LFLA|129.800', 'INFO'],
    ['LFLD|119.600', 'AFIS'],
    ['LFLH|118.600', 'AFIS'],
    ['LFLI|126.350', 'INFO'],
    ['LFLM|119.000', 'AFIS'],
    ['LFLO|120.900', 'AFIS'],
    ['LFLP|118.200', 'AFIS'],
    ['LFLV|121.400', 'AFIS'],
    ['LFLW|118.325', 'AFIS'],
    ['LFLX|125.875', 'AFIS'],
    ['LFML|118.850', 'INFO'],
    ['LFMQ|119.000', 'AFIS'],
    ['LFMS|130.200', 'AFIS'],
    ['LFMZ|121.200', 'INFO'],
    ['LFNB|119.600', 'AFIS'],
    ['LFOD|120.600', 'AFIS'],
    ['LFOI|123.500', 'A/A'],
    ['LFOK|119.400', 'AFIS'],
    ['LFOQ|118.450', 'AFIS'],
    ['LFOT|118.300', 'AFIS'],
    ['LFOU|120.400', 'INFO'],
    ['LFOV|119.300', 'AFIS'],
    ['LFOZ|122.400', 'AFIS'],
    ['LFPP|120.400', 'A/A'],
    ['LFPQ|120.225', 'A/A'],
    ['LFQA|134.925', 'AFIS'],
    ['LFQB|123.725', 'AFIS'],
    ['LFQG|120.600', 'INFO'],
    ['LFQM|122.200', 'INFO'],
    ['LFQQ|134.825', 'AFIS'],
    ['LFQV|119.000', 'AFIS'],
    ['LFRE|121.400', 'AFIS'],
    ['LFRG|119.825', 'INFO'],
    ['LFRI|119.900', 'AFIS'],
    ['LFRS|129.875', 'INFO'],
    ['LFSB|121.250', 'INFO'],
    ['LFSD|118.325', 'AFIS'],
    ['LFSG|120.200', 'AFIS'],
    ['LFSL|121.125', 'TWR / AFIS'],
    ['LFSM|132.025', 'AFIS'],
    ['LFSN|119.600', 'AFIS'],
    ['LFTZ|118.125', 'AFIS'],
]);

/* Secours par OACI limité aux terrains dont le référentiel ne présente pas
 * simultanément un service TWR distinct. Il n'est utilisé que si NPF possède
 * déjà une fréquence mais aucun type de service. */
const AIRPORT_SERVICE_BUILTIN_OACI_FALLBACK = new Map([
    ['LFAD', 'A/A'],
    ['LFAV', 'AFIS'],
    ['LFBK', 'AFIS'],
    ['LFBN', 'AFIS'],
    ['LFBU', 'AFIS'],
    ['LFBX', 'AFIS'],
    ['LFCC', 'AFIS'],
    ['LFCI', 'AFIS'],
    ['LFCK', 'AFIS'],
    ['LFCM', 'AFIS'],
    ['LFCY', 'AFIS'],
    ['LFDH', 'AFIS'],
    ['LFDJ', 'AFIS'],
    ['LFEY', 'AFIS'],
    ['LFFH', 'A/A'],
    ['LFFI', 'AFIS'],
    ['LFGF', 'A/A'],
    ['LFHA', 'A/A'],
    ['LFHN', 'A/A'],
    ['LFHO', 'A/A'],
    ['LFHP', 'INFO'],
    ['LFHQ', 'AFIS'],
    ['LFHS', 'AFIS'],
    ['LFHY', 'AFIS'],
    ['LFJR', 'AFIS'],
    ['LFJS', 'A/A'],
    ['LFKO', 'AFIS'],
    ['LFLA', 'INFO'],
    ['LFLD', 'AFIS'],
    ['LFLH', 'AFIS'],
    ['LFLI', 'INFO'],
    ['LFLM', 'AFIS'],
    ['LFLO', 'AFIS'],
    ['LFLV', 'AFIS'],
    ['LFLW', 'AFIS'],
    ['LFMQ', 'AFIS'],
    ['LFMS', 'AFIS'],
    ['LFMZ', 'INFO'],
    ['LFNB', 'AFIS'],
    ['LFOD', 'AFIS'],
    ['LFOI', 'A/A'],
    ['LFOQ', 'AFIS'],
    ['LFOU', 'INFO'],
    ['LFOV', 'AFIS'],
    ['LFOZ', 'AFIS'],
    ['LFPP', 'A/A'],
    ['LFPQ', 'A/A'],
    ['LFQA', 'AFIS'],
    ['LFQB', 'AFIS'],
    ['LFQG', 'INFO'],
    ['LFQM', 'INFO'],
    ['LFQQ', 'AFIS'],
    ['LFQV', 'AFIS'],
    ['LFRE', 'AFIS'],
    ['LFRI', 'AFIS'],
    ['LFRT', 'AFIS'],
    ['LFSG', 'AFIS'],
    ['LFSM', 'AFIS'],
    ['LFSN', 'AFIS'],
    ['LFTZ', 'AFIS'],
]);


function normalizeAirportOperationalFrequencyValue(raw) {
    const match = String(raw || '').replace(',', '.').match(/(?:^|[^0-9])(1(?:1[89]|2[0-9]|3[0-6])(?:\.\d{1,3})?)(?:[^0-9]|$)/);
    if (!match) return '';
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric) || numeric < 118 || numeric >= 137 || Math.abs(numeric - 121.5) < 0.0001) return '';
    return numeric.toFixed(3);
}

function parseAirportFrequencyFallbackCup(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const input = String(text || '');

    const pushField = () => {
        row.push(field);
        field = '';
    };
    const pushRow = () => {
        pushField();
        if (row.some(value => String(value || '').trim())) rows.push(row);
        row = [];
    };

    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (ch === '"') {
            if (quoted && input[i + 1] === '"') {
                field += '"';
                i += 1;
            } else {
                quoted = !quoted;
            }
            continue;
        }
        if (!quoted && ch === ',') {
            pushField();
            continue;
        }
        if (!quoted && (ch === '\n' || ch === '\r')) {
            if (ch === '\r' && input[i + 1] === '\n') i += 1;
            pushRow();
            continue;
        }
        field += ch;
    }
    if (field.length || row.length) pushRow();
    if (!rows.length) return new Map();

    const header = rows[0].map(value => String(value || '').trim().toLowerCase());
    const codeIndex = header.indexOf('code');
    const freqIndex = header.indexOf('freq');
    if (codeIndex < 0 || freqIndex < 0) return new Map();

    const index = new Map();
    for (let i = 1; i < rows.length; i += 1) {
        const record = rows[i];
        const code = String(record?.[codeIndex] || '').trim().toUpperCase();
        if (!/^LF[A-Z]{2}$/.test(code)) continue;
        const value = normalizeAirportOperationalFrequencyValue(record?.[freqIndex]);
        if (!value) continue;
        index.set(code, { type: '', value, priority: 9, source: 'vac-fallback' });
    }
    return index;
}

function serializeAirportFrequencyFallbackIndex(index) {
    const payload = {};
    (index instanceof Map ? index : new Map()).forEach((entry, code) => {
        const value = normalizeAirportOperationalFrequencyValue(entry?.value);
        if (/^LF[A-Z]{2}$/.test(String(code || '')) && value) payload[code] = value;
    });
    return payload;
}

function hydrateAirportFrequencyFallbackIndex(payload) {
    const index = new Map();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return index;
    Object.entries(payload).forEach(([rawCode, rawValue]) => {
        const code = String(rawCode || '').trim().toUpperCase();
        const value = normalizeAirportOperationalFrequencyValue(rawValue);
        if (/^LF[A-Z]{2}$/.test(code) && value) {
            index.set(code, { type: '', value, priority: 9, source: 'vac-fallback-cache' });
        }
    });
    return index;
}

function loadCachedAirportFrequencyFallbackIndex() {
    try {
        const raw = localStorage.getItem(AIRPORT_FREQUENCY_FALLBACK_CACHE_KEY);
        if (!raw) return null;
        const index = hydrateAirportFrequencyFallbackIndex(JSON.parse(raw));
        return index.size ? index : null;
    } catch (_) {
        return null;
    }
}

async function fetchAirportFrequencyFallbackIndex() {
    let lastError = null;
    for (const url of AIRPORT_FREQUENCY_FALLBACK_URLS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AIRPORT_FREQUENCY_FALLBACK_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                cache: 'no-cache',
                signal: controller.signal,
                mode: 'cors'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const index = parseAirportFrequencyFallbackCup(await response.text());
            if (index.size < 100) throw new Error(`Référentiel fréquences incomplet (${index.size})`);
            return index;
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError || new Error('Référentiel fréquences indisponible');
}

function persistAirportFrequencyFallbackIndex(index) {
    try {
        const payload = serializeAirportFrequencyFallbackIndex(index);
        localStorage.setItem(AIRPORT_FREQUENCY_FALLBACK_CACHE_KEY, JSON.stringify(payload));
    } catch (_) {}
}

function refreshAirportFrequencyFallbackInBackground() {
    if ((Date.now() - Number(airportFrequencyFallbackLastAttemptAt || 0)) < 60000) return;
    airportFrequencyFallbackLastAttemptAt = Date.now();
    fetchAirportFrequencyFallbackIndex().then(index => {
        airportFrequencyFallbackIndex = index;
        persistAirportFrequencyFallbackIndex(index);
        scheduleAirportOperationalLabelsRefresh(0);
    }).catch(() => {});
}

function ensureAirportFrequencyFallbackLoaded() {
    if (airportFrequencyFallbackIndex instanceof Map && airportFrequencyFallbackIndex.size) {
        return Promise.resolve(airportFrequencyFallbackIndex);
    }
    if (airportFrequencyFallbackLoadPromise) return airportFrequencyFallbackLoadPromise;

    const cached = loadCachedAirportFrequencyFallbackIndex();
    if (cached?.size) {
        airportFrequencyFallbackIndex = cached;
        setTimeout(refreshAirportFrequencyFallbackInBackground, 1800);
        return Promise.resolve(cached);
    }

    airportFrequencyFallbackLastAttemptAt = Date.now();
    airportFrequencyFallbackLoadPromise = fetchAirportFrequencyFallbackIndex()
        .then(index => {
            airportFrequencyFallbackIndex = index;
            persistAirportFrequencyFallbackIndex(index);
            scheduleAirportOperationalLabelsRefresh(0);
            return index;
        })
        .catch(error => {
            console.warn('Référentiel fréquences aérodromes indisponible:', error);
            return new Map();
        })
        .finally(() => {
            airportFrequencyFallbackLoadPromise = null;
        });
    return airportFrequencyFallbackLoadPromise;
}


let siaOfficialAirportOperationalIndex = null;

function buildSiaOfficialAirportOperationalIndex() {
    if (siaOfficialAirportOperationalIndex instanceof Map) {
        return siaOfficialAirportOperationalIndex;
    }
    const index = new Map();
    SIA_OFFICIAL_AIRPORT_OPERATIONAL_GROUP_ROWS.forEach(row => {
        const oaci = String(row?.[0] || '').trim().toUpperCase();
        const groups = Array.isArray(row?.[1]) ? row[1] : [];
        const allTypes = String(row?.[2] || '').trim().toUpperCase();
        if (!/^LF[A-Z0-9]{2}$/.test(oaci) || !groups.length) return;
        const normalizedGroups = groups.map(group => {
            const value = normalizeAirportOperationalFrequencyValue(group?.[0]);
            const type = String(group?.[1] || '').trim().toUpperCase();
            return value && type ? { value, type } : null;
        }).filter(Boolean);
        if (!normalizedGroups.length) return;
        index.set(oaci, {
            type: normalizedGroups[0].type,
            value: normalizedGroups[0].value,
            groups: normalizedGroups,
            allTypes,
            source: 'sia-official-airport-radio',
            priority: 0
        });
    });
    siaOfficialAirportOperationalIndex = index;
    return index;
}

function getSiaOfficialAirportOperationalFrequency(oaci) {
    const code = String(oaci || '').trim().toUpperCase();
    if (!/^LF[A-Z0-9]{2}$/.test(code)) return null;
    return buildSiaOfficialAirportOperationalIndex().get(code) || null;
}

function countSiaOfficialAirportType(type) {
    const wanted = String(type || '').trim().toUpperCase();
    if (!wanted) return 0;
    let count = 0;
    buildSiaOfficialAirportOperationalIndex().forEach(entry => {
        const allTypes = String(entry?.allTypes || entry?.type || '').toUpperCase();
        const known = ['TWR', 'AFIS', 'A/A'];
        if (known.filter(value => allTypes.includes(value)).includes(wanted)) count += 1;
    });
    return count;
}

function buildAirportServiceSupplementByOaciIndex(index = airportServiceSupplementIndex) {
    const byOaci = new Map();

    const add = (key, label, source = 'supplement') => {
        const match = String(key || '').match(/^(LF[A-Z]{2})\|(1\d{2}\.\d{3})$/);
        const normalizedLabel = mergeAirportServiceTypeLabels(label);
        if (!match || !normalizedLabel) return;
        const [, oaci, frequency] = match;
        if (!byOaci.has(oaci)) byOaci.set(oaci, []);
        const list = byOaci.get(oaci);
        const existing = list.find(row => row.frequency === frequency);
        if (existing) {
            existing.type = mergeAirportServiceTypeLabels(existing.type, normalizedLabel);
            return;
        }
        list.push({ frequency, type: normalizedLabel, source });
    };

    AIRPORT_SERVICE_BUILTIN_EXACT.forEach((label, key) => add(key, label, 'builtin'));
    (index instanceof Map ? index : new Map()).forEach((label, key) => add(key, label, 'supplement'));

    byOaci.forEach(list => {
        list.sort((a, b) => Number(a.frequency) - Number(b.frequency));
    });

    airportServiceSupplementByOaciIndex = byOaci;
    return byOaci;
}

function ensureAirportServiceSupplementByOaciIndex() {
    if (!(airportServiceSupplementByOaciIndex instanceof Map) || !airportServiceSupplementByOaciIndex.size) {
        return buildAirportServiceSupplementByOaciIndex();
    }
    return airportServiceSupplementByOaciIndex;
}

function countAirportServiceSupplementTypeEntries(type) {
    const wanted = String(type || '').trim().toUpperCase();
    if (!wanted) return 0;
    let count = 0;
    ensureAirportServiceSupplementByOaciIndex().forEach(rows => {
        (rows || []).forEach(row => {
            if (mergeAirportServiceTypeLabels(row?.type).includes(wanted)) count += 1;
        });
    });
    return count;
}

function getAirportServiceFrequencyEquivalentKeys(oaci, frequencyValue) {
    const code = String(oaci || '').trim().toUpperCase();
    const frequency = normalizeAirportOperationalFrequencyValue(frequencyValue);
    if (!/^LF[A-Z]{2}$/.test(code) || !frequency) return [];

    const khz = Math.round(Number(frequency) * 1000);
    const values = new Set([khz]);

    /* Correspondance stricte fréquence porteuse 25 kHz <-> désignateur de
     * canal 8,33 kHz : les désignateurs finissant à +5 kHz utilisent la
     * porteuse 5 kHz plus bas. On ajoute aussi l'autre sens pour les données
     * qui stockent la porteuse alors que le libellé de service stocke le canal. */
    if (Number.isFinite(khz)) {
        const modulo25 = ((khz % 25) + 25) % 25;
        if (modulo25 === 5) values.add(khz - 5);
        if (modulo25 === 0) values.add(khz + 5);
    }

    return [...values]
        .filter(value => value >= 118000 && value < 137000)
        .map(value => `${code}|${(value / 1000).toFixed(3)}`);
}

function getAirportServiceFromOaciIndex(oaci, frequencyValue, currentType = '') {
    const code = String(oaci || '').trim().toUpperCase();
    if (!/^LF[A-Z]{2}$/.test(code)) return '';

    const byOaci = ensureAirportServiceSupplementByOaciIndex();
    const rows = byOaci.get(code) || [];
    const wantedKeys = new Set(getAirportServiceFrequencyEquivalentKeys(code, frequencyValue));

    let matched = '';
    rows.forEach(row => {
        if (wantedKeys.has(`${code}|${row.frequency}`)) {
            matched = mergeAirportServiceTypeLabels(matched, row.type);
        }
    });
    if (matched) return matched;

    /* Si aucune fréquence ne correspond, n'utiliser un secours OACI que
     * lorsqu'il est non ambigu : tous les services opérationnels connus de ce
     * terrain appartiennent alors à la même famille. On ne remplace jamais un
     * TWR déjà établi par un AFIS/A/A déduit. */
    if (String(currentType || '').toUpperCase().includes('TWR')) return '';

    const knownTypes = new Set();
    rows.forEach(row => {
        ['TWR', 'AFIS', 'A/A', 'INFO'].forEach(type => {
            if (String(row?.type || '').toUpperCase().includes(type)) knownTypes.add(type);
        });
    });
    if (knownTypes.size === 1) return [...knownTypes][0];

    return AIRPORT_SERVICE_BUILTIN_OACI_FALLBACK.get(code) || '';
}

function normalizeAirportServiceSupplementType(rawType, rawDescription) {
    const type = String(rawType || '').trim().toUpperCase();
    const description = String(rawDescription || '').trim().toUpperCase();
    const combined = `${type} ${description}`;
    if ((/TWR/.test(combined) || /TOWER/.test(combined)) && /AFIS/.test(combined)) return 'TWR / AFIS';
    if (type === 'TWR') return 'TWR';
    if (type === 'AFIS') return 'AFIS';
    if (type === 'INFO') return 'INFO';
    const explicitAirToAir = combined;
    if (/\bA\s*\/\s*A\b|\bAIR\s*\/\s*AIR\b|\bAUTO[-\s]?INFO\b|\bSELF[-\s]?INFO\b/.test(explicitAirToAir)) return 'A/A';
    return '';
}

function normalizeAirportServiceSupplementFrequency(raw) {
    let numeric = Number(String(raw ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(numeric)) return '';
    if (numeric >= 1000) numeric /= 1000;
    if (numeric < 118 || numeric >= 137 || Math.abs(numeric - 121.5) < 0.0001) return '';
    return numeric.toFixed(3);
}

function parseAirportServiceSupplementCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const input = String(text || '');
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => {
        pushField();
        if (row.some(value => String(value || '').trim())) rows.push(row);
        row = [];
    };
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (ch === '"') {
            if (quoted && input[i + 1] === '"') { field += '"'; i += 1; }
            else quoted = !quoted;
            continue;
        }
        if (!quoted && ch === ',') { pushField(); continue; }
        if (!quoted && (ch === '\n' || ch === '\r')) {
            if (ch === '\r' && input[i + 1] === '\n') i += 1;
            pushRow();
            continue;
        }
        field += ch;
    }
    if (field.length || row.length) pushRow();
    if (!rows.length) return new Map();

    const header = rows[0].map(value => String(value || '').trim().toLowerCase());
    const airportIndex = header.indexOf('airport');
    const descriptionIndex = header.indexOf('description');
    const frequencyIndex = header.indexOf('frequency');
    const typeIndex = header.indexOf('type');
    if ([airportIndex, frequencyIndex, typeIndex].some(index => index < 0)) return new Map();

    const grouped = new Map();
    for (let i = 1; i < rows.length; i += 1) {
        const record = rows[i];
        const code = String(record?.[airportIndex] || '').trim().toUpperCase();
        if (!/^LF[A-Z]{2}$/.test(code)) continue;
        const frequency = normalizeAirportServiceSupplementFrequency(record?.[frequencyIndex]);
        if (!frequency) continue;
        const serviceType = normalizeAirportServiceSupplementType(
            record?.[typeIndex],
            descriptionIndex >= 0 ? record?.[descriptionIndex] : ''
        );
        if (!serviceType) continue;
        const key = `${code}|${frequency}`;
        if (!grouped.has(key)) grouped.set(key, new Set());
        grouped.get(key).add(serviceType);
    }

    const order = new Map([['TWR', 0], ['AFIS', 1], ['A/A', 2], ['INFO', 3]]);
    const index = new Map();
    grouped.forEach((types, key) => {
        const label = [...types]
            .sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
            .join(' / ');
        if (label) index.set(key, label);
    });
    return index;
}

function serializeAirportServiceSupplementIndex(index) {
    const payload = {};
    (index instanceof Map ? index : new Map()).forEach((label, key) => {
        if (/^LF[A-Z]{2}\|1\d{2}\.\d{3}$/.test(String(key || '')) && String(label || '').trim()) {
            payload[key] = String(label).trim();
        }
    });
    return payload;
}

function hydrateAirportServiceSupplementIndex(payload) {
    const index = new Map();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return index;
    Object.entries(payload).forEach(([key, label]) => {
        if (/^LF[A-Z]{2}\|1\d{2}\.\d{3}$/.test(String(key || '')) && String(label || '').trim()) {
            index.set(key, String(label).trim());
        }
    });
    buildAirportServiceSupplementByOaciIndex(index);
    return index;
}

function loadCachedAirportServiceSupplementIndex() {
    try {
        const raw = localStorage.getItem(AIRPORT_SERVICE_SUPPLEMENT_CACHE_KEY);
        if (!raw) return null;
        const index = hydrateAirportServiceSupplementIndex(JSON.parse(raw));
        return index.size ? index : null;
    } catch (_) { return null; }
}

function persistAirportServiceSupplementIndex(index) {
    try {
        localStorage.setItem(
            AIRPORT_SERVICE_SUPPLEMENT_CACHE_KEY,
            JSON.stringify(serializeAirportServiceSupplementIndex(index))
        );
    } catch (_) {}
}

async function fetchAirportServiceSupplementIndex() {
    let lastError = null;
    for (const url of AIRPORT_SERVICE_SUPPLEMENT_URLS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AIRPORT_SERVICE_SUPPLEMENT_TIMEOUT_MS);
        try {
            const response = await fetch(url, { cache: 'no-cache', signal: controller.signal, mode: 'cors' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const index = parseAirportServiceSupplementCsv(await response.text());
            if (index.size < 50) throw new Error(`Référentiel services terrain incomplet (${index.size})`);
            buildAirportServiceSupplementByOaciIndex(index);
            return index;
        } catch (error) {
            lastError = error;
        } finally { clearTimeout(timer); }
    }
    throw lastError || new Error('Référentiel services terrain indisponible');
}

function refreshAirportServiceSupplementInBackground() {
    if ((Date.now() - Number(airportServiceSupplementLastAttemptAt || 0)) < 60000) return;
    airportServiceSupplementLastAttemptAt = Date.now();
    fetchAirportServiceSupplementIndex().then(index => {
        airportServiceSupplementIndex = index;
        buildAirportServiceSupplementByOaciIndex(index);
        persistAirportServiceSupplementIndex(index);
        scheduleAirportOperationalLabelsRefresh(0);
    }).catch(() => {});
}

function ensureAirportServiceSupplementLoaded() {
    if (airportServiceSupplementIndex instanceof Map && airportServiceSupplementIndex.size) {
        return Promise.resolve(airportServiceSupplementIndex);
    }
    if (airportServiceSupplementLoadPromise) return airportServiceSupplementLoadPromise;

    const cached = loadCachedAirportServiceSupplementIndex();
    if (cached?.size) {
        airportServiceSupplementIndex = cached;
        buildAirportServiceSupplementByOaciIndex(cached);
        setTimeout(refreshAirportServiceSupplementInBackground, 2200);
        return Promise.resolve(cached);
    }

    airportServiceSupplementLastAttemptAt = Date.now();
    airportServiceSupplementLoadPromise = fetchAirportServiceSupplementIndex()
        .then(index => {
            airportServiceSupplementIndex = index;
            buildAirportServiceSupplementByOaciIndex(index);
            persistAirportServiceSupplementIndex(index);
            scheduleAirportOperationalLabelsRefresh(0);
            return index;
        })
        .catch(error => {
            console.warn('Référentiel types de services aérodromes indisponible:', error);
            return new Map();
        })
        .finally(() => { airportServiceSupplementLoadPromise = null; });
    return airportServiceSupplementLoadPromise;
}

function mergeAirportServiceTypeLabels(...labels) {
    const order = ['TWR', 'AFIS', 'A/A', 'INFO'];
    const source = labels.map(label => String(label || '').toUpperCase()).join(' | ');
    return order.filter(type => source.includes(type)).join('-');
}

function getAirportServiceSupplementFrequencyKeys(oaci, frequencyValue) {
    return getAirportServiceFrequencyEquivalentKeys(oaci, frequencyValue);
}

function getAirportServiceSupplementLabel(oaci, frequencyValue, currentType = '') {
    const keys = getAirportServiceFrequencyEquivalentKeys(oaci, frequencyValue);
    if (!keys.length) return '';

    let label = '';
    keys.forEach(key => {
        label = mergeAirportServiceTypeLabels(
            label,
            AIRPORT_SERVICE_BUILTIN_EXACT.get(key) || '',
            airportServiceSupplementIndex?.get(key) || ''
        );
    });

    return mergeAirportServiceTypeLabels(
        label,
        getAirportServiceFromOaciIndex(oaci, frequencyValue, currentType)
    );
}

function buildAirportOperationalFrequencyIndex(dataset = siaDataset) {
    if (airportOperationalFrequencyIndex && airportOperationalFrequencyIndexDataset === dataset) {
        return airportOperationalFrequencyIndex;
    }
    const index = new Map();
    const priorities = new Map([['TWR', 0], ['AFIS', 1], ['A/A', 2], ['INFO', 3]]);

    const consider = (oaci, serviceType, frequencies) => {
        const code = String(oaci || '').trim().toUpperCase();
        const type = String(serviceType || '').trim().toUpperCase();
        if (!/^[A-Z]{4}$/.test(code) || !priorities.has(type)) return;
        const candidates = (Array.isArray(frequencies) ? frequencies : [])
            .map(row => ({
                raw: String(row?.[0] || '').trim(),
                unit: String(row?.[1] || '').trim().toUpperCase(),
                supplementary: !!row?.[4]
            }))
            .filter(row => row.raw)
            .map(row => ({ ...row, numeric: Number(row.raw.replace(',', '.')) }))
            .filter(row => Number.isFinite(row.numeric) && row.numeric >= 118 && row.numeric < 137 && Math.abs(row.numeric - 121.5) > 0.0001)
            .sort((a, b) => Number(a.supplementary) - Number(b.supplementary));
        if (!candidates.length) return;
        const candidate = candidates[0];
        const next = {
            type,
            value: candidate.numeric.toFixed(3),
            priority: priorities.get(type),
            source: 'sia'
        };
        const current = index.get(code);
        if (!current || next.priority < current.priority) {
            if (current && current.value === next.value) {
                next.type = mergeAirportServiceTypeLabels(next.type, current.type);
            }
            index.set(code, next);
        } else if (current.value === next.value) {
            current.type = mergeAirportServiceTypeLabels(current.type, next.type);
        }
    };

    if (dataset) {
        (dataset?.airspaces || []).forEach(item => {
            (Array.isArray(item?.sv) ? item.sv : []).forEach(service => {
                const serviceType = String(service?.[0] || '').trim().toUpperCase();
                const unit = String(service?.[1] || '').trim().toUpperCase();
                const unitOaci = unit.match(/^([A-Z]{4})\b/)?.[1] || '';
                const itemOaci = String(item?.c || '').trim().toUpperCase().match(/^([A-Z]{4})(?:\b|\d|\.|-)/)?.[1] || '';
                consider(unitOaci || itemOaci, serviceType, service?.[2]);
            });
        });
    }

    AIRPORT_OPERATIONAL_FREQUENCY_OVERRIDES.forEach((frequency, oaci) => {
        index.set(oaci, { ...frequency });
    });

    airportOperationalFrequencyIndex = index;
    airportOperationalFrequencyIndexDataset = dataset || null;
    return index;
}

function getAirportOperationalFrequency(oaci) {
    const code = String(oaci || '').trim().toUpperCase();
    if (!code) return null;

    /* Autorité unique pour TWR / AFIS / A/A : SIA officiel.
     * Le résumé embarqué provient conjointement de XML-SIA (dont A/A) et
     * d'AIXM 4.5 (fréquences TWR avec indicatif TOUR/TOWER). */
    const official = getSiaOfficialAirportOperationalFrequency(code);
    if (official) return official;

    /* Pour un terrain sans service opérationnel SIA exploitable, l'ancien
     * référentiel léger peut encore fournir une fréquence, mais JAMAIS un type. */
    const fallback = airportFrequencyFallbackIndex?.get(code) || null;
    if (!fallback) return null;
    return {
        ...fallback,
        type: '',
        source: 'frequency-only-fallback'
    };
}

function clearAirportOperationalLabelsForMapMotion() {
    clearTimeout(airportOperationalLabelRefreshTimer);
    airportOperationalLabelRefreshTimer = null;
    if (!airportOperationalLabelLayer) return;
    try {
        airportOperationalLabelLayer.clearLayers();
    } catch (_) {}
}

function refreshAirportOperationalLabels() {
    if (!map) return;
    if (!airportOperationalLabelLayer) airportOperationalLabelLayer = L.layerGroup().addTo(map);
    const scaleNm = getCurrentNpfScaleNm();
    if (!Number.isFinite(scaleNm) || scaleNm > 2.000001) {
        /* v16.90 — nettoyage strict hors seuil, timer compris. */
        clearAirportOperationalLabelsForMapMotion();
        return;
    }

    const bounds = map.getBounds().pad(0.05);
    airportOperationalLabelLayer.clearLayers();
    getNpfDisplayedAirportRecordsForLabels().forEach(airport => {
        const latlng = L.latLng(airport.lat, airport.lon);
        if (!bounds.contains(latlng)) return;
        const freq = getAirportOperationalFrequency(airport.oaci);
        const airportName = String(airport.name || '').trim();
        const airportOaci = String(airport.oaci || '').trim().toUpperCase();
        const airportDisplayName = airportName
            ? `${airportName} (${airportOaci})`
            : airportOaci;
        const frequencyHtml = freq
            ? (
                Array.isArray(freq.groups) && freq.groups.length
                    ? freq.groups.map(group =>
                        `<span class="airport-operational-frequency">${group.type ? `${escapeHtml(group.type)} ` : ''}${escapeHtml(group.value)}</span>`
                    ).join('')
                    : `<span class="airport-operational-frequency">${freq.type ? `${escapeHtml(freq.type)} ` : ''}${escapeHtml(freq.value)}</span>`
            )
            : '';
        L.marker(latlng, {
            interactive: false,
            keyboard: false,
            zIndexOffset: 1650,
            icon: L.divIcon({
                className: 'airport-operational-label-icon',
                html: `<span class="airport-operational-label"><span class="airport-operational-name">${escapeHtml(airportDisplayName)}</span>${frequencyHtml}</span>`,
                iconSize: [1, 1],
                iconAnchor: [0, 0]
            })
        }).addTo(airportOperationalLabelLayer);
    });

    /* v16.58 — les libellés terrain ne chargent jamais le gros jeu SIA.
     * Si le référentiel léger n'est pas encore en cache, il est récupéré en
     * arrière-plan puis les libellés sont redessinés. */
    if (!(airportFrequencyFallbackIndex instanceof Map) || !airportFrequencyFallbackIndex.size) {
        ensureAirportFrequencyFallbackLoaded().catch(() => {});
    }
}

function scheduleAirportOperationalLabelsRefresh(delay = 120) {
    clearTimeout(airportOperationalLabelRefreshTimer);
    airportOperationalLabelRefreshTimer = setTimeout(() => {
        airportOperationalLabelRefreshTimer = null;
        refreshAirportOperationalLabels();
    }, Math.max(0, Number(delay) || 0));
}

function drawPermanentAirportMarkers() {
    permanentAirportLayer.clearLayers();

    /*
     * v14.76 — retour au rendu de la v14.74 pour les aérodromes :
     * un point rond noir cliquable reste affiché au-dessus de la couche de
     * pistes intégrée à la carte NPF. Les pistes ne remplacent plus les ronds.
     */
    additionalAerodromes.forEach(airport => {
        L.marker([airport.lat, airport.lon], {
            icon: buildTerrainAirportMapIcon(airport, {
                inverted: true,
                showCardinalTabs: false,
                size: 22
            }),
            interactive: false,
            keyboard: false,
            zIndexOffset: 1700
        }).addTo(permanentAirportLayer);

        const popupHtml = `<div class="airport-popup additional-aerodrome-popup"><b>${escapeHtml(airport.oaci)}</b><br>${escapeHtml(airport.name)}${buildVacButtonHtml(airport.oaci)}${buildAirportAddWpButtonHtml(airport.oaci)}</div>`;
        addAirportTouchHitbox(airport, popupHtml);
    });

    otherAirports.forEach(airport => {
        const isCustomPelic = customPelicanAirports.has(airport.oaci);
        const isBase = selectedBaseOACI === airport.oaci;
        const baseButtonText = isBase ? 'BASE ✓' : 'BASE';
        const baseButtonClass = isBase ? 'base-btn base-btn-active' : 'base-btn';
        const customPelicText = isCustomPelic ? 'PÉLIC ✓' : 'PÉLIC';
        const customPelicClass = isCustomPelic ? 'base-btn base-btn-active' : 'base-btn';

        if (isCustomPelic) {
            const isDisabled = disabledAirports.has(airport.oaci);
            const isWater = waterAirports.has(airport.oaci);
            const iconClass = buildPelicanMapIconClass(airport, isDisabled, isWater);
            const iconHTML = isDisabled ? buildPelicanDisabledSymbolHtml() : buildPelicanAircraftSymbolHtml();
            const waterButtonText = isWater ? "RETARDANT" : "EAU";
            const waterButtonClass = isWater ? "water-btn water-btn-retardant" : "water-btn";
            const disableButtonText = isDisabled ? "Activer" : "Désactiver";
            const disableButtonClass = isDisabled ? "enable-btn" : "disable-btn";
            const popupHtml = `<div class="airport-popup"><b>${airport.oaci}</b><br>${airport.name}<div class="popup-buttons"><button class="${waterButtonClass}" onclick="window.toggleWater('${airport.oaci}')">${waterButtonText}</button><button class="${disableButtonClass}" onclick="window.toggleAirport('${airport.oaci}')">${disableButtonText}</button><button class="${baseButtonClass}" onclick="window.setBaseAirport('${airport.oaci}')">${baseButtonText}</button><button class="${customPelicClass}" onclick="window.toggleCustomPelican('${airport.oaci}')">${customPelicText}</button></div>${buildPelicPdfButtonsHtml(airport.oaci)}${buildVacButtonHtml(airport.oaci)}${buildPelicNotamsButtonHtml(airport.oaci)}${buildAirportGoToButtonHtml(airport.oaci)}${buildAirportAddWpButtonHtml(airport.oaci)}</div>`;
            const marker = L.marker([airport.lat, airport.lon], { icon: L.divIcon({ className: iconClass, html: iconHTML, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -15] }), zIndexOffset: 2500, keyboard: false });
            marker.bindPopup(popupHtml, getNpfPelicPopupOptions());
            marker.addTo(permanentAirportLayer);
            addAirportTouchHitbox(airport, popupHtml);
            return;
        }

        /*
         * v16.38 — pictogramme terrain orienté.
         * Les terrains sélectionnables comme PÉLIC adoptent désormais une icône
         * bleue dédiée dont le trait central reprend l’orientation de la piste
         * principale disponible dans la base locale.
         */
        L.marker([airport.lat, airport.lon], {
            icon: buildTerrainAirportMapIcon(airport, {
                inverted: false,
                showCardinalTabs: true,
                size: 30
            }),
            interactive: false,
            keyboard: false,
            zIndexOffset: 1850
        }).addTo(permanentAirportLayer);

        const popupHtml = `<div class="airport-popup"><b>${airport.oaci}</b><br>${airport.name}<div class="popup-buttons"><button class="${baseButtonClass}" onclick="window.setBaseAirport('${airport.oaci}')">${baseButtonText}</button><button class="${customPelicClass}" onclick="window.toggleCustomPelican('${airport.oaci}')">${customPelicText}</button></div>${buildVacButtonHtml(airport.oaci)}${buildNpfNotamsButtonHtmlIfCovered(airport.oaci)}${buildAirportGoToButtonHtml(airport.oaci)}${buildAirportAddWpButtonHtml(airport.oaci)}</div>`;
        addAirportTouchHitbox(airport, popupHtml);
    });

    pelicanAirports.forEach(airport => {
        const isDisabled = disabledAirports.has(airport.oaci);
        const isWater = waterAirports.has(airport.oaci);
        const iconClass = buildPelicanMapIconClass(airport, isDisabled, isWater);
        const iconHTML = isDisabled ? buildPelicanDisabledSymbolHtml() : buildPelicanAircraftSymbolHtml();
        const icon = L.divIcon({ className: iconClass, html: iconHTML, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -15] });
        const marker = L.marker([airport.lat, airport.lon], { icon: icon, zIndexOffset: 2500, keyboard: false });
        const disableButtonText = isDisabled ? "Activer" : "Désactiver";
        const disableButtonClass = isDisabled ? "enable-btn" : "disable-btn";
        const waterButtonText = isWater ? "RETARDANT" : "EAU";
        const waterButtonClass = isWater ? "water-btn water-btn-retardant" : "water-btn";
        const isBase = selectedBaseOACI === airport.oaci;
        const baseButtonText = isBase ? 'BASE ✓' : 'BASE';
        const baseButtonClass = isBase ? 'base-btn base-btn-active' : 'base-btn';
        const popupHtml = `<div class="airport-popup"><b>${airport.oaci}</b><br>${airport.name}<div class="popup-buttons"><button class="${waterButtonClass}" onclick="window.toggleWater('${airport.oaci}')">${waterButtonText}</button><button class="${disableButtonClass}" onclick="window.toggleAirport('${airport.oaci}')">${disableButtonText}</button><button class="${baseButtonClass}" onclick="window.setBaseAirport('${airport.oaci}')">${baseButtonText}</button></div>${buildPelicPdfButtonsHtml(airport.oaci)}${buildVacButtonHtml(airport.oaci)}${buildPelicNotamsButtonHtml(airport.oaci)}${buildAirportGoToButtonHtml(airport.oaci)}${buildAirportAddWpButtonHtml(airport.oaci)}</div>`;
        marker.bindPopup(popupHtml, getNpfPelicPopupOptions());
        marker.addTo(permanentAirportLayer);
        addAirportTouchHitbox(airport, popupHtml);
    });

    /* v16.58 — précharge non bloquante du petit référentiel fréquence pour
     * qu'il soit déjà mémorisé lorsque l'utilisateur atteint l'échelle 2 NM. */
    ensureAirportFrequencyFallbackLoaded().catch(() => {});
}



