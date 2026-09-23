async function loadCommunesData() {
    const fetchWithTimeout = async (url, options = {}, timeoutMs = 8000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    };

    const parseAndStore = async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.data)) {
            throw new Error("Format JSON invalide.");
        }
        /*
         * v17.27 — plus de copie de la base communes dans localStorage.
         * JSON.stringify des ~62 Mo bloquait le démarrage pour rien : setItem
         * dépasse de toute façon le quota Safari (~5 Mo). Hors ligne, la base
         * est servie par le cache APP_DATA du Service Worker.
         */
        return payload;
    };

    try {
        const networkResponse = await fetchWithTimeout('./communes.json', { cache: 'no-cache' }, 8000);
        return await parseAndStore(networkResponse);
    } catch (_) {
        try {
            const cachedData = localStorage.getItem(COMMUNES_CACHE_KEY);
            if (cachedData) {
                const parsed = JSON.parse(cachedData);
                if (parsed && Array.isArray(parsed.data)) {
                    return parsed;
                }
            }
        } catch (_) {}

        try {
            const fallbackResponse = await fetchWithTimeout('./communes.json', { cache: 'force-cache' }, 4000);
            return await parseAndStore(fallbackResponse);
        } catch (_) {
            throw new Error("Impossible de charger les données communes (réseau indisponible et cache local absent).");
        }
    }
}

async function loadCommunesAliases() {
    const fetchWithTimeout = async (url, options = {}, timeoutMs = 5000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    };

    const buildAliasEntry = (entry, key = null) => {
        if (!entry) return null;

        if (typeof entry === 'string') {
            return null;
        }

        const displayName = String(entry.nom_affiche || entry.display_name || entry.alias_nom_affiche || entry.nom_standard || entry.nom || '').trim();
        const targetCode = String(entry.alias_target_code_insee || entry.code_insee || entry.target_code_insee || '').trim();
        if (!displayName || !targetCode) return null;

        const targetCommune = communesByCodeInsee.get(targetCode);
        if (!targetCommune) return null;

        const searchKeys = Array.isArray(entry.cles_recherche) && entry.cles_recherche.length
            ? entry.cles_recherche
            : [key, displayName];

        const normalizedName = simplifyString(displayName);
        const searchParts = normalizedName.split(' ').filter(Boolean);

        return {
            ...targetCommune,
            code_insee: targetCommune.code_insee,
            nom_standard: displayName,
            nom_sans_pronom: displayName,
            nom_sans_accent: normalizedName.replace(/\s+/g, '-'),
            dep_code: entry.dep_code || targetCommune.dep_code,
            dep_nom: entry.dep_nom || targetCommune.dep_nom,
            alias_match: true,
            alias_nom_affiche: displayName,
            alias_commune_actuelle: entry.nom_commune_actuelle || targetCommune.nom_standard,
            alias_target_code_insee: targetCode,
            alias_old_code_insee: entry.ancien_code_insee || null,
            normalized_name: normalizedName,
            search_parts: searchParts,
            search_compact: searchParts.join(''),
            soundex_parts: searchParts.map(part => soundex(part)),
            alias_search_keys: searchKeys
        };
    };

    const yieldAliasBuildToUi = () => new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });

    const parseAliasPayload = async (payload) => {
        if (!payload) return [];

        const sourceEntries = [];
        if (Array.isArray(payload.aliases)) {
            payload.aliases.forEach(entry => sourceEntries.push([null, entry]));
        } else if (payload.aliases && typeof payload.aliases === 'object') {
            Object.entries(payload.aliases).forEach(entry => sourceEntries.push(entry));
        } else {
            return [];
        }

        const aliases = [];
        for (let index = 0; index < sourceEntries.length; index += 1) {
            const [key, value] = sourceEntries[index];
            let normalizedValue = value;

            if (typeof value === 'string') {
                const targetCommune = communesByCodeInsee.get(String(value).trim());
                if (targetCommune) {
                    normalizedValue = {
                        nom_affiche: String(key || '').replace(/-/g, ' '),
                        code_insee: value,
                        nom_commune_actuelle: targetCommune.nom_standard
                    };
                } else {
                    normalizedValue = null;
                }
            }

            const built = buildAliasEntry(normalizedValue, key);
            if (built) aliases.push(built);

            /* v16.66 — fractionner aussi la normalisation CPU des 6 000+ alias.
             * Même sur un cache compact, Safari ne doit plus garder le thread
             * principal plusieurs centaines de ms d'affilée. */
            if ((index + 1) % 192 === 0) {
                await yieldAliasBuildToUi();
            }
        }

        return aliases;
    };

    const storeAliases = async (payload) => {
        const aliases = await parseAliasPayload(payload);
        try {
            /* v16.66 — stocker le payload compact d'origine, pas les objets
             * alias déjà enrichis avec toute la commune cible. L'ancien cache
             * expansé pouvait devenir très volumineux et bloquer Safari lors
             * du JSON.stringify/localStorage. */
            localStorage.setItem(COMMUNES_ALIASES_CACHE_KEY, JSON.stringify(payload));
        } catch (_) {}
        return aliases;
    };

    /* v16.58 — cache d'abord : les 6 000+ alias ne doivent plus bloquer
     * l'affichage des PÉLIC pendant une requête réseau. Une copie locale valide
     * est rendue immédiatement puis rafraîchie silencieusement en arrière-plan. */
    try {
        const cachedData = localStorage.getItem(COMMUNES_ALIASES_CACHE_KEY);
        if (cachedData) {
            const aliases = await parseAliasPayload(JSON.parse(cachedData));
            if (aliases.length) {
                communeAliasesLoadSource = 'cache-local';
                setTimeout(async () => {
                    try {
                        const response = await fetchWithTimeout('./communes_aliases.json', { cache: 'no-cache' }, 5000);
                        if (!response.ok) return;
                        const updatedAliases = await storeAliases(await response.json());
                        if (updatedAliases.length) {
                            communeAliases = updatedAliases;
                            communeAliasesLoadSource = 'fichier-reseau-maj';
                        }
                    } catch (_) {}
                }, 1800);
                return aliases;
            }
        }
    } catch (_) {}

    try {
        const response = await fetchWithTimeout('./communes_aliases.json', { cache: 'no-cache' }, 5000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const aliases = await storeAliases(await response.json());
        communeAliasesLoadSource = 'fichier-reseau';
        return aliases;
    } catch (_) {
        try {
            const fallbackResponse = await fetchWithTimeout('./communes_aliases.json', { cache: 'force-cache' }, 3000);
            if (!fallbackResponse.ok) throw new Error(`HTTP ${fallbackResponse.status}`);
            const aliases = storeAliases(await fallbackResponse.json());
            communeAliasesLoadSource = 'cache-http';
            return aliases;
        } catch (_) {
            communeAliasesLoadSource = 'indisponible';
            console.warn('Alias communes indisponibles: recherche principale conservée.');
            return [];
        }
    }
}

function shouldSearchCandidate(candidate, searchWords, searchCompact, departmentFilter = null) {
    /*
     * v11.94 — fluidité saisie.
     * Sans filtre département, on évite de calculer Levenshtein/Soundex sur
     * 35k communes + alias à chaque recherche. On garde la recherche exhaustive
     * si un département est fourni, car le volume est alors faible.
     */
    if (departmentFilter) return true;
    if (!candidate || !Array.isArray(searchWords) || !searchWords.length) return false;

    const firstWord = searchWords[0] || '';
    if (firstWord.length < 2) return false;

    const normalizedName = candidate.normalized_name || simplifyString(candidate.nom_standard);
    const compactName = candidate.search_compact || normalizedName.replace(/\s+/g, '');

    if (searchCompact.length >= 4 && compactName.includes(searchCompact.slice(0, Math.min(5, searchCompact.length)))) {
        return true;
    }

    const parts = Array.isArray(candidate.search_parts) && candidate.search_parts.length
        ? candidate.search_parts
        : normalizedName.split(' ').filter(Boolean);

    const firstPrefix = firstWord.slice(0, 2);
    if (parts.some(part => part.startsWith(firstPrefix) || firstWord.startsWith(part.slice(0, Math.min(3, part.length))))) {
        return true;
    }

    const firstSoundex = soundex(firstWord);
    const soundexParts = Array.isArray(candidate.soundex_parts) && candidate.soundex_parts.length
        ? candidate.soundex_parts
        : parts.map(part => soundex(part));

    return soundexParts.includes(firstSoundex);
}

function buildFrenchConsonantSearchKey(value) {
    /*
     * v15.90 — recherche commune avec département : C / Q / K sont rapprochés
     * dans la clé consonantique. Cela couvre notamment « cuc » -> « cuques »
     * sans élargir le préfiltre national, cette clé n'étant utilisée que par
     * le scoring phonétique ciblé avec département.
     */
    return simplifyString(String(value || ''))
        .replace(/ph/g, 'f')
        .replace(/gn/g, 'n')
        .replace(/qu/g, 'k')
        .replace(/ck/g, 'k')
        .replace(/[cq]/g, 'k')
        .replace(/y/g, 'i')
        .replace(/[aeiou0-9\s]/g, '')
        .replace(/(.)\1+/g, '$1');
}

function scoreCommuneSearchCandidate(candidate, searchWords, departmentFilter = null) {
    if (!candidate || !Array.isArray(searchWords) || !searchWords.length) return 999;

    const parts = Array.isArray(candidate.search_parts) && candidate.search_parts.length
        ? candidate.search_parts
        : simplifyString(candidate.nom_standard).split(' ').filter(Boolean);

    const soundexParts = Array.isArray(candidate.soundex_parts) && candidate.soundex_parts.length
        ? candidate.soundex_parts
        : parts.map(part => soundex(part));

    /*
     * v11.84 — recherche alias plus tolérante.
     * Cas visé : "La Tourlandry" doit sortir avec "la tour landri 49".
     * Le moteur historique compare mot par mot. Cela échoue quand l'utilisateur
     * sépare un toponyme composé dans un ancien nom écrit en un seul bloc.
     * On ajoute donc une comparaison compacte sans espaces avant le scoring mot par mot.
     */
    const searchCompact = searchWords.join('');
    const candidateCompact = candidate.search_compact || parts.join('');

    if (searchCompact.length >= 4 && candidateCompact.length >= 4) {
        if (candidateCompact.startsWith(searchCompact) || searchCompact.startsWith(candidateCompact)) {
            return 0.1;
        }

        const compactDistance = levenshteinDistance(searchCompact, candidateCompact);
        const compactTolerance = Math.max(1, Math.floor(searchCompact.length / 4));
        if (compactDistance <= compactTolerance) {
            return 0.5 + compactDistance;
        }

        /*
         * v14.45 — tolérance phonétique ciblée avec département.
         * « essen 12 », « esen 12 » et « aissen 12 » doivent retrouver
         * Ayssènes. La comparaison porte sur le nom compact complet afin que
         * les mots très fréquents de noms composés (Saint, Sainte...) ne
         * produisent pas une multitude de faux positifs.
         */
        const searchPhonetic = buildFrenchConsonantSearchKey(searchCompact);
        const candidatePhonetic = buildFrenchConsonantSearchKey(candidateCompact);
        if (
            departmentFilter
            && searchPhonetic.length >= 2
            && candidatePhonetic.length >= 2
        ) {
            if (searchPhonetic === candidatePhonetic) {
                return 1.75;
            }

            const phoneticDistance = levenshteinDistance(searchPhonetic, candidatePhonetic);
            if (
                phoneticDistance <= 1
                && (
                    searchPhonetic.startsWith(candidatePhonetic)
                    || candidatePhonetic.startsWith(searchPhonetic)
                )
            ) {
                return 2.3 + (phoneticDistance * 0.2);
            }

            if (phoneticDistance <= 1) {
                return 3.4;
            }
        }
    }

    let totalScore = 0;
    let wordsFound = 0;

    for (const word of searchWords) {
        let bestWordScore = 999;
        const wordSoundex = soundex(word);

        for (let i = 0; i < parts.length; i++) {
            const communePart = parts[i];
            const communeSoundex = soundexParts[i];
            let currentScore = 999;

            if (communePart.startsWith(word)) {
                currentScore = 0;
            } else if (communeSoundex === wordSoundex) {
                currentScore = 1;
            } else if (candidate.dep_code === '07' && (word === 'talo' || word === 'talaud') && communePart === 'toulaud') {
                /*
                 * v12.80 — recherche commune Ardèche : l'utilisateur saisit
                 * souvent "Talo 07" ou "Talaud 07" pour Toulaud (07323).
                 * Ce cas doit primer sur les autres communes du département.
                 */
                currentScore = -1;
            } else if (word.length >= 4 && communePart.startsWith(word.slice(0, 3))) {
                /*
                 * v12.78/v12.80 — recherche filtrée par département :
                 * accepter les préfixes courts approximatifs, sans forcer
                 * une commune précise hors du cas Toulaud ci-dessus.
                 */
                currentScore = 3.8 + Math.min(2, Math.abs(communePart.length - word.length) / 10);
            } else {
                const dist = levenshteinDistance(word, communePart);
                if (dist <= Math.floor(word.length / 3) + 1) {
                    currentScore = 2 + dist;
                }
            }

            if (currentScore < bestWordScore) bestWordScore = currentScore;
        }

        if (bestWordScore < 999) {
            wordsFound++;
            totalScore += bestWordScore;
        }
    }

    return wordsFound === searchWords.length ? totalScore : 999;
}

function searchAliasCommunes(searchWords, departmentFilter = null) {
    if (!Array.isArray(communeAliases) || !communeAliases.length) return [];

    const compactQuery = searchWords.join('');
    if (!departmentFilter && compactQuery.length < 6) return [];

    const candidates = departmentFilter
        ? communeAliases.filter(alias => alias.dep_code === departmentFilter)
        : communeAliases.filter(alias => shouldSearchCandidate(alias, searchWords, compactQuery, departmentFilter));

    return candidates
        .map(alias => {
            const score = scoreCommuneSearchCandidate(alias, searchWords, departmentFilter);
            return { ...alias, score: score + 0.25 };
        })
        .filter(alias => alias.score < 999)
        .sort((a, b) => a.score - b.score || a.nom_standard.length - b.nom_standard.length)
        .slice(0, 10);
}


function parseSearchDepartmentFilter(rawSearch) {
    const value = String(rawSearch || '');
    const match = value.match(
        /\s(\d{1,3}|2A|2B)$/i
    );

    if (!match) {
        return {
            departmentFilter: null,
            searchTerm: value.trim()
        };
    }

    return {
        departmentFilter:
            match[1].length === 1
                ? `0${match[1]}`
                : match[1].toUpperCase(),
        searchTerm: value
            .substring(0, match.index)
            .trim()
    };
}

function buildOfflineNamedPlaceCandidate(record) {
    if (!record || typeof record !== 'object') {
        return null;
    }

    const name = String(record.n || '').trim();
    const municipality = String(
        record.c || ''
    ).trim();
    const departmentCode = String(
        record.d || ''
    ).trim().toUpperCase();
    const latitude = Number(record.a);
    const longitude = Number(record.o);
    const normalizedName = String(
        record.k || simplifyString(name)
    )
        .trim()
        .toLowerCase();

    if (
        !name
        || !normalizedName
        || !Number.isFinite(latitude)
        || !Number.isFinite(longitude)
    ) {
        return null;
    }

    const commune = communesByCodeInsee.get(
        String(record.i || '').trim()
    );
    const municipalityNormalized = simplifyString(
        municipality || commune?.nom_standard || ''
    );
    /*
     * v16.51 — recherche France entière : un lieu-dit est indexé à la fois
     * sous son nom et sous son rattachement communal. Une saisie composée du
     * type « lieu-dit + commune » retrouve donc le même point sans alias manuel.
     */
    const searchParts = Array.from(new Set([
        ...normalizedName.split(' ').filter(Boolean),
        ...municipalityNormalized.split(' ').filter(Boolean)
    ]));
    const combinedCompact = [normalizedName, municipalityNormalized]
        .filter(Boolean)
        .join(' ')
        .split(' ')
        .filter(Boolean)
        .join('');

    return {
        nom_standard: name,
        nom_sans_pronom: name,
        nom_sans_accent:
            normalizedName.replace(/\s+/g, '-'),
        normalized_name: normalizedName,
        search_parts: searchParts,
        search_compact: combinedCompact || searchParts.join(''),
        soundex_parts:
            searchParts.map(part => soundex(part)),
        latitude_mairie: latitude,
        longitude_mairie: longitude,
        dep_code: departmentCode,
        dep_nom:
            commune?.dep_nom
            || (
                departmentCode === '33'
                    ? 'Gironde'
                    : ''
            ),
        code_insee: String(
            record.i || ''
        ).trim(),
        locality_match: true,
        locality_commune_name: municipality,
        locality_type:
            'village, hameau ou lieu-dit',
        locality_source:
            'Base Adresse Nationale — base locale NPF',
        locality_offline: true,
        locality_linked_commune: !!commune
    };
}

function normalizeNamedPlacesShardSearchKey(value) {
    const original = simplifyString(value);
    const stripped = original.replace(
        /^(?:(?:de la|de l|les|aux|des|le|la|au|du|en|de|l|a)\s+)+/,
        ''
    ).trim();
    return stripped || original;
}

function encodeNamedPlacesShardPrefix(prefix) {
    return Array.from(String(prefix || ''))
        .map(character => character
            .charCodeAt(0)
            .toString(16)
            .padStart(2, '0'))
        .join('');
}

function getNamedPlacesShardId(searchTerm) {
    const normalized = normalizeNamedPlacesShardSearchKey(searchTerm);
    let prefix = normalized.slice(
        0,
        NAMED_PLACES_OFFLINE_SHARD_PREFIX_LENGTH
    );
    prefix = prefix.padEnd(
        NAMED_PLACES_OFFLINE_SHARD_PREFIX_LENGTH,
        '_'
    );
    return encodeNamedPlacesShardPrefix(prefix);
}

function buildNamedPlacesShardPrefixIndex(archive) {
    const index = new Map();
    if (!archive || !archive.files) return index;

    Object.keys(archive.files).forEach(path => {
        const match = String(path).match(
            /^shards\/([0-9a-f]+)\.json$/i
        );
        if (!match) return;

        const shardId = match[1].toLowerCase();
        const prefixId = shardId.slice(
            0,
            NAMED_PLACES_OFFLINE_PHONETIC_PREFIX_LENGTH * 2
        );
        if (!prefixId) return;

        if (!index.has(prefixId)) {
            index.set(prefixId, []);
        }
        index.get(prefixId).push(shardId);
    });

    index.forEach(shardIds => shardIds.sort());
    return index;
}

function getNamedPlacesSearchVariants(searchTerm) {
    const original = simplifyString(searchTerm);
    if (!original) return [];

    const compact = original.replace(/\s+/g, '');
    const withoutArticle = normalizeNamedPlacesShardSearchKey(original);
    const withoutArticleCompact = withoutArticle.replace(/\s+/g, '');

    /*
     * v16.88 — la sélection des fragments ne doit plus casser la recherche
     * phonétique avant même Soundex/Levenshtein.
     *
     * Exemple :
     *   "la pradelle"
     *       forme originale         -> "la pradelle"
     *       forme compacte          -> "lapradelle"
     *       forme sans article      -> "pradelle"
     *
     * Les familles de fragments "la..." ET "pr..." sont donc chargées.
     * Même principe pour espaces, tirets et articles des autres toponymes.
     */
    return Array.from(new Set([
        original,
        compact,
        withoutArticle,
        withoutArticleCompact
    ].filter(value => String(value || '').length >= 2)));
}

function getNamedPlacesShardIds(searchTerm) {
    const variants = getNamedPlacesSearchVariants(searchTerm);
    const collectedShardIds = new Set();

    const collectForVariant = variant => {
        const normalized = normalizeNamedPlacesShardSearchKey(variant);
        if (!normalized) return;

        if (
            normalized.length
                < NAMED_PLACES_OFFLINE_PHONETIC_PREFIX_LENGTH
        ) {
            collectedShardIds.add(getNamedPlacesShardId(variant));
            return;
        }

        const broadPrefix = normalized.slice(
            0,
            NAMED_PLACES_OFFLINE_PHONETIC_PREFIX_LENGTH
        );
        const broadPrefixId = encodeNamedPlacesShardPrefix(
            broadPrefix
        );
        const shardIds = namedPlacesOfflineShardIdsByPrefix.get(
            broadPrefixId
        );

        if (Array.isArray(shardIds) && shardIds.length) {
            shardIds.forEach(shardId => collectedShardIds.add(shardId));
            return;
        }

        collectedShardIds.add(getNamedPlacesShardId(variant));
    };

    variants.forEach(collectForVariant);

    if (!collectedShardIds.size) {
        collectedShardIds.add(getNamedPlacesShardId(searchTerm));
    }

    return Array.from(collectedShardIds).sort();
}

function showNamedPlacesOfflineStatus(
    message,
    {
        error = false,
        duration = 4200
    } = {}
) {
    let element = document.getElementById(
        'named-places-offline-status'
    );
    if (!element) {
        element = document.createElement('div');
        element.id = 'named-places-offline-status';
        document.body.appendChild(element);
    }
    element.textContent = String(message || '');
    element.classList.toggle('error', Boolean(error));
    requestAnimationFrame(() => {
        element.classList.add('visible');
    });
    window.clearTimeout(
        showNamedPlacesOfflineStatus.hideTimer
    );
    showNamedPlacesOfflineStatus.hideTimer =
        window.setTimeout(() => {
            element.classList.remove('visible');
        }, Math.max(1200, Number(duration) || 4200));
}

async function loadNamedPlacesOfflineDatabase({
    force = false,
    searchTerm = ''
} = {}) {
    if (force) {
        namedPlacesOfflineArchive = null;
        namedPlacesOfflineIndex = null;
        namedPlacesOfflineShardIdsByPrefix = new Map();
        namedPlacesOfflineShardCache.clear();
        namedPlacesOfflineShardPromises.clear();
        namedPlacesOfflineLoadedCount = 0;
        namedPlacesOfflineLinkedCount = 0;
        namedPlacesOfflineOrphanCount = 0;
    }

    if (!namedPlacesOfflineArchive) {
        if (!namedPlacesOfflineLoadPromise) {
            namedPlacesOfflineLoadError = '';
            namedPlacesOfflineLoadPromise = (async () => {
                if (typeof JSZip === 'undefined') {
                    throw new Error('JSZip non chargé');
                }

                const response = await fetch(
                    NAMED_PLACES_OFFLINE_ARCHIVE_URL,
                    {
                        method: 'GET',
                        cache: 'force-cache',
                        credentials: 'same-origin'
                    }
                );
                if (!response.ok) {
                    throw new Error(
                        `Base localités France HTTP ${response.status}`
                    );
                }

                const archiveBuffer = await response.arrayBuffer();
                const archive = await JSZip.loadAsync(archiveBuffer);
                const indexFile = archive.file(
                    'localites-index.json'
                );
                if (!indexFile) {
                    throw new Error(
                        'Index de la base France absent'
                    );
                }

                const indexPayload = JSON.parse(
                    await indexFile.async('string')
                );
                if (
                    !indexPayload
                    || Number(indexPayload.total_count) < 10000
                    || !Array.isArray(indexPayload.departments)
                ) {
                    throw new Error(
                        'Index de la base France invalide'
                    );
                }

                namedPlacesOfflineArchive = archive;
                namedPlacesOfflineIndex = indexPayload;
                namedPlacesOfflineShardIdsByPrefix =
                    buildNamedPlacesShardPrefixIndex(archive);
                return archive;
            })()
                .catch(error => {
                    namedPlacesOfflineLoadError =
                        error?.message || String(error);
                    namedPlacesOfflineArchive = null;
                    namedPlacesOfflineIndex = null;
                    console.warn(
                        '[Localités France offline] Chargement impossible:',
                        error
                    );
                    throw error;
                })
                .finally(() => {
                    namedPlacesOfflineLoadPromise = null;
                });
        }

        try {
            await namedPlacesOfflineLoadPromise;
        } catch (_) {
            return [];
        }
    }

    if (!searchTerm) {
        return [];
    }

    const loadShard = async shardId => {
        if (namedPlacesOfflineShardCache.has(shardId)) {
            const cached = namedPlacesOfflineShardCache.get(shardId);
            namedPlacesOfflineShardCache.delete(shardId);
            namedPlacesOfflineShardCache.set(shardId, cached);
            return cached;
        }

        if (namedPlacesOfflineShardPromises.has(shardId)) {
            return namedPlacesOfflineShardPromises.get(shardId);
        }

        const loadPromise = (async () => {
            const shardFile = namedPlacesOfflineArchive.file(
                `shards/${shardId}.json`
            );
            if (!shardFile) return [];

            const payload = JSON.parse(
                await shardFile.async('string')
            );
            const records = Array.isArray(payload?.items)
                ? payload.items
                    .map(buildOfflineNamedPlaceCandidate)
                    .filter(Boolean)
                : [];

            namedPlacesOfflineShardCache.set(
                shardId,
                records
            );
            namedPlacesOfflineLoadedCount += records.length;
            namedPlacesOfflineLinkedCount += records.filter(item => item.locality_linked_commune).length;
            namedPlacesOfflineOrphanCount += records.filter(item => !item.locality_linked_commune).length;

            while (
                namedPlacesOfflineShardCache.size
                    > NAMED_PLACES_OFFLINE_SHARD_CACHE_MAX
            ) {
                const oldestKey =
                    namedPlacesOfflineShardCache.keys()
                        .next().value;
                namedPlacesOfflineShardCache.delete(oldestKey);
            }

            return records;
        })()
            .catch(error => {
                namedPlacesOfflineLoadError =
                    error?.message || String(error);
                console.warn(
                    '[Localités France offline] Fragment impossible:',
                    shardId,
                    error
                );
                return [];
            })
            .finally(() => {
                namedPlacesOfflineShardPromises.delete(shardId);
            });

        namedPlacesOfflineShardPromises.set(
            shardId,
            loadPromise
        );
        return loadPromise;
    };

    /*
     * v14.81 — tous les fragments partageant les deux premières lettres sont
     * chargés avant le classement phonétique local.
     *
     * v16.88 — ces préfixes sont maintenant calculés sur plusieurs formes
     * simultanées (originale, compacte, sans article). Ainsi une saisie comme
     * « la pradelle » ne reste plus cantonnée à `pr...` : `la...` est aussi
     * chargé avant Soundex + Levenshtein.
     */
    const shardIds = getNamedPlacesShardIds(searchTerm);
    const shardGroups = await Promise.all(
        shardIds.map(loadShard)
    );

    return shardGroups.flat();
}

function isDirectionalSearchTerm(searchTerm) {
    const normalized = simplifyString(
        searchTerm
    );
    return /(?:^|\s)(?:nord|sud|est|ouest)(?:\s|$)/
        .test(normalized);
}

function groupOfflineNamedPlaceResults(
    results,
    searchTerm
) {
    const grouped = [];
    const seen = new Set();
    const keepDirection =
        isDirectionalSearchTerm(searchTerm);

    (Array.isArray(results) ? results : [])
        .forEach(candidate => {
            if (!candidate) return;

            let groupName =
                candidate.normalized_name;

            if (!keepDirection) {
                groupName = groupName.replace(
                    /(?:\s|-)+(?:nord(?:\s|-)?est|nord(?:\s|-)?ouest|sud(?:\s|-)?est|sud(?:\s|-)?ouest|nord|sud|est|ouest)$/,
                    ''
                ).trim();
            }

            const key = [
                groupName,
                candidate.code_insee || '',
                candidate.locality_commune_name || ''
            ].join('|');

            if (seen.has(key)) return;
            seen.add(key);
            grouped.push(candidate);
        });

    return grouped;
}

async function searchNamedPlacesOffline(
    searchTerm,
    departmentFilter,
    searchWords
) {
    const normalizedQuery = simplifyString(searchTerm);
    const searchCompact = Array.isArray(searchWords)
        ? searchWords.join('')
        : '';

    if (
        !Array.isArray(searchWords)
        || !searchWords.length
        || normalizedQuery.length < 3
    ) {
        namedPlacesLastOfflineSearchMeta = {
            query: normalizedQuery,
            department: departmentFilter || '',
            status: 'saisie-trop-courte',
            shards: 0,
            records: 0,
            prefiltered: 0,
            scored: 0,
            exact: 0,
            returned: 0
        };
        return [];
    }

    if (
        departmentFilter
        && Array.isArray(namedPlacesOfflineIndex?.departments)
        && !namedPlacesOfflineIndex.departments.includes(departmentFilter)
    ) {
        namedPlacesLastOfflineSearchMeta = {
            query: normalizedQuery,
            department: departmentFilter || '',
            status: 'departement-absent-index',
            shards: 0,
            records: 0,
            prefiltered: 0,
            scored: 0,
            exact: 0,
            returned: 0
        };
        recordNpfLocalitySearchDiagnostic(
            'archive',
            `requête="${normalizedQuery}" · département=${departmentFilter} absent de l'index`,
            namedPlacesLastOfflineSearchMeta
        );
        return [];
    }

    const knownEquivalentResults = searchNpfKnownLocalityEquivalents(
        searchTerm,
        departmentFilter
    );

    const searchVariants = getNamedPlacesSearchVariants(searchTerm);
    const requestedShardIds = getNamedPlacesShardIds(searchTerm);
    const records = await loadNamedPlacesOfflineDatabase({ searchTerm });

    if (!records.length) {
        const fallback = knownEquivalentResults
            .slice(0, NAMED_PLACES_OFFLINE_RESULT_LIMIT);

        namedPlacesLastOfflineSearchMeta = {
            query: normalizedQuery,
            department: departmentFilter || '',
            status: namedPlacesOfflineLoadError
                ? 'archive-erreur'
                : 'aucun-enregistrement',
            shards: requestedShardIds.length,
            variants: searchVariants.join(' | '),
            records: 0,
            prefiltered: 0,
            scored: 0,
            exact: fallback.filter(item => item.search_exact_locality).length,
            returned: fallback.length,
            top: formatNpfSearchResultNames(fallback)
        };
        recordNpfLocalitySearchDiagnostic(
            'archive',
            `requête="${normalizedQuery}" · variantes=${searchVariants.join(' / ')} · shards=${requestedShardIds.length} · aucun enregistrement · retour=${fallback.length}`,
            namedPlacesLastOfflineSearchMeta
        );
        return fallback;
    }

    let prefilteredCount = 0;

    const scored = records
        .filter(candidate => (
            !departmentFilter
            || candidate.dep_code === departmentFilter
        ))
        .filter(candidate => {
            const keep = shouldSearchCandidate(
                candidate,
                searchWords,
                searchCompact,
                departmentFilter
            );
            if (keep) prefilteredCount += 1;
            return keep;
        })
        .map(candidate => {
            const candidateCompact = String(
                candidate.search_compact
                || candidate.normalized_name
                || ''
            ).replace(/\s+/g, '');
            const candidateNameCompact = String(
                candidate.normalized_name
                || candidate.nom_standard
                || ''
            ).replace(/\s+/g, '');

            /*
             * v16.88 — exact signifie aussi "même nom sans espaces".
             * "la pradelle" == "lapradelle" avant tout score phonétique.
             * Le compact nom+commune reste accepté pour les recherches de
             * lieux d'usage composés déjà gérées en v16.87.
             */
            const exactLocality = (
                candidate.normalized_name === normalizedQuery
                || (
                    searchCompact.length >= 3
                    && (
                        candidateNameCompact === searchCompact
                        || candidateCompact === searchCompact
                    )
                )
            );

            let score = scoreCommuneSearchCandidate(
                candidate,
                searchWords,
                departmentFilter
            );

            if (exactLocality) {
                score = -1.00;
            } else {
                score += 0.35;
            }

            return {
                ...candidate,
                search_exact_locality: exactLocality,
                score
            };
        })
        .filter(candidate => candidate.score < 999)
        .sort((a, b) =>
            Number(Boolean(b.search_exact_locality))
                - Number(Boolean(a.search_exact_locality))
            || a.score - b.score
            || a.nom_standard.length - b.nom_standard.length
        );

    const grouped = groupOfflineNamedPlaceResults(
        [...knownEquivalentResults, ...scored],
        searchTerm
    );

    const exactResults = grouped.filter(
        candidate => candidate.search_exact_locality === true
    );

    /*
     * v16.87 — garantie générique : une localité exacte n'est jamais éliminée
     * par le scoring phonétique ni par la limite des propositions.
     */
    const finalResults = exactResults.length
        ? exactResults.slice(0, NAMED_PLACES_OFFLINE_RESULT_LIMIT)
        : grouped.slice(0, NAMED_PLACES_OFFLINE_RESULT_LIMIT);

    namedPlacesLastOfflineSearchMeta = {
        query: normalizedQuery,
        department: departmentFilter || '',
        status: 'ok',
        shards: requestedShardIds.length,
        variants: searchVariants.join(' | '),
        records: records.length,
        prefiltered: prefilteredCount,
        scored: scored.length,
        exact: exactResults.length,
        known: knownEquivalentResults.length,
        returned: finalResults.length,
        archiveOpen: Boolean(namedPlacesOfflineArchive),
        top: formatNpfSearchResultNames(finalResults)
    };

    recordNpfLocalitySearchDiagnostic(
        'archive',
        `requête="${normalizedQuery}" · variantes=${searchVariants.join(' / ')} · shards=${requestedShardIds.length} · enregistrements=${records.length} · exacts=${exactResults.length} · retour=${finalResults.length}`,
        namedPlacesLastOfflineSearchMeta
    );

    return finalResults;
}

function mergeCommuneAndNamedPlaceResults(
    communeResults,
    namedPlaceResults,
    searchTerm = ''
) {
    const merged = [];
    const seen = new Set();

    const addCandidate = candidate => {
        if (!candidate) return;

        const coordinatesKey = (
            Number.isFinite(
                Number(candidate.latitude_mairie)
            )
            && Number.isFinite(
                Number(candidate.longitude_mairie)
            )
        )
            ? `${Number(
                candidate.latitude_mairie
            ).toFixed(4)}:${Number(
                candidate.longitude_mairie
            ).toFixed(4)}`
            : '';

        const key = [
            candidate.locality_match
                ? 'locality'
                : 'commune',
            simplifyString(
                candidate.nom_standard || ''
            ),
            candidate.code_insee || '',
            coordinatesKey
        ].join('|');

        if (seen.has(key)) return;
        seen.add(key);
        merged.push(candidate);
    };

    (Array.isArray(communeResults)
        ? communeResults
        : []
    ).forEach(addCandidate);

    (Array.isArray(namedPlaceResults)
        ? namedPlaceResults
        : []
    ).forEach(addCandidate);

    const normalizedQuery = simplifyString(searchTerm);

    return merged
        .sort((a, b) => {
            const aExactLocality = Boolean(
                a?.locality_match
                && (
                    a.search_exact_locality
                    || simplifyString(a.nom_standard || '') === normalizedQuery
                )
            );
            const bExactLocality = Boolean(
                b?.locality_match
                && (
                    b.search_exact_locality
                    || simplifyString(b.nom_standard || '') === normalizedQuery
                )
            );

            return Number(bExactLocality) - Number(aExactLocality)
                || Number(a.score || 0) - Number(b.score || 0)
                || (
                    a.locality_match ? 1 : 0
                ) - (
                    b.locality_match ? 1 : 0
                )
                || String(a.nom_standard || '').length
                    - String(b.nom_standard || '').length;
        })
        .slice(0, 10);
}

async function enrichCommuneSearchWithNamedPlaces({
    rawSearch,
    searchTerm,
    departmentFilter,
    searchWords,
    localResults,
    expectedSequence
}) {
    const offlineResults =
        await searchNamedPlacesOffline(
            searchTerm,
            departmentFilter,
            searchWords
        );

    if (
        expectedSequence
            !== namedPlacesSearchSequence
    ) {
        return;
    }

    const currentInput =
        document.getElementById(
            'search-input'
        );
    if (
        !currentInput
        || String(currentInput.value || '')
            !== String(rawSearch || '')
    ) {
        return;
    }

    const mergedResults = mergeCommuneAndNamedPlaceResults(
        localResults,
        offlineResults,
        searchTerm
    );

    displayResults(mergedResults);

    const exactCount = mergedResults.filter(item => (
        item?.locality_match
        && (
            item.search_exact_locality
            || simplifyString(item.nom_standard || '')
                === simplifyString(searchTerm)
        )
    )).length;

    recordNpfLocalitySearchDiagnostic(
        'fusion',
        `requête="${simplifyString(searchTerm)}" · dept=${departmentFilter || '—'} · immédiats=${Array.isArray(localResults) ? localResults.length : 0} · archive=${offlineResults.length} · finaux=${mergedResults.length} · exacts=${exactCount}`,
        {
            query: simplifyString(searchTerm),
            department: departmentFilter || '',
            immediate: Array.isArray(localResults) ? localResults.length : 0,
            archive: offlineResults.length,
            final: mergedResults.length,
            exact: exactCount,
            top: formatNpfSearchResultNames(mergedResults),
            archiveStatus: String(namedPlacesLastOfflineSearchMeta?.status || '—'),
            shards: Number(namedPlacesLastOfflineSearchMeta?.shards || 0),
            variants: String(namedPlacesLastOfflineSearchMeta?.variants || ''),
            records: Number(namedPlacesLastOfflineSearchMeta?.records || 0),
            prefiltered: Number(namedPlacesLastOfflineSearchMeta?.prefiltered || 0),
            scored: Number(namedPlacesLastOfflineSearchMeta?.scored || 0)
        }
    );
}


