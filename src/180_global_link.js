// =========================================================================
// =========================================================================
const NPF_GLOBAL_LINK_UI_ENABLED = true; // TEST v15.36 : bouton et fonctions GLR disponibles.
const NPF_GLOBAL_LINK_API_URL = 'https://grisonb.synology.me/briefing-api/npf-global-link-api.php';
const NPF_GLOBAL_LINK_SESSION_KEY = 'npfGlobalLinkSessionV1';
const NPF_GLOBAL_LINK_SESSION_EXP_KEY = 'npfGlobalLinkSessionExpV1';
const NPF_GLOBAL_LINK_LAYER_ENABLED_KEY = 'npfGlobalLinkLayerEnabledV1';
const NPF_GLOBAL_LINK_SHOW_OFF_KEY = 'npfGlobalLinkShowOffTrafficV1';
const NPF_GLOBAL_LINK_REFRESH_MS = 15000;
const NPF_GLOBAL_LINK_OFF_SECONDS = 180;
const NPF_GLOBAL_LINK_PANE_NAME = 'npfGlobalLinkPane';
const NPF_GLOBAL_LINK_PANE_Z_INDEX = 645;
const NPF_GLOBAL_LINK_CONNECTOR_PANE_NAME = 'npfGlobalLinkConnectorPane';
const NPF_GLOBAL_LINK_CONNECTOR_PANE_Z_INDEX = 644;

let npfGlobalLinkLayer = null;
let npfGlobalLinkRefreshTimer = null;
let npfGlobalLinkEnabled = false;
let npfGlobalLinkFetchInProgress = false;
let npfGlobalLinkAttempt = '';
let npfGlobalLinkLastPositions = [];
/* v15.30 — état de fusion GLR/SafeSky. */
let npfGlobalLinkRenderedCount = 0;
let npfGlobalLinkActiveTotalCount = 0;
let npfGlobalLinkOffTotalCount = 0;
let npfGlobalLinkSafeSkyMatches = [];
let npfGlobalLinkRelayoutTimer = null;
/* v15.51 — authentification GLR : mot de passe masqué et chargement captcha sérialisé. */
let npfGlobalLinkCaptchaLoadPromise = null;
let npfGlobalLinkPasswordAuthPromise = null;
let npfGlobalLinkLastAuthState = 'non-testé';
/* v16.59 — diagnostic GLR sans donnée sensible : action, HTTP et erreur amont. */
let npfGlobalLinkLastAction = '—';
let npfGlobalLinkLastHttpStatus = 0;
let npfGlobalLinkLastError = '';

function rememberGlobalLinkRequestState(action, response = null, error = '') {
    npfGlobalLinkLastAction = String(action || '—');
    npfGlobalLinkLastHttpStatus = Number(response?.status || 0);
    npfGlobalLinkLastError = String(error || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function isGlobalLinkTemporaryLoadFail(value) {
    const text = String(value?.message || value?.error || value || '');
    return /\bload\s*fail(?:ed)?\b/i.test(text);
}

/*
 * v15.94 — les trafics GLR non actifs sont affichés par défaut.
 * Si l'utilisateur les masque via l'appui long GLR, ce choix est mémorisé
 * localement et restauré aux ouvertures suivantes.
 */
function loadGlobalLinkShowOffPreference() {
    try {
        const stored = localStorage.getItem(NPF_GLOBAL_LINK_SHOW_OFF_KEY);
        if (stored === null) return true;
        return stored !== '0';
    } catch (_) {
        return true;
    }
}

let npfGlobalLinkShowOffTraffic = loadGlobalLinkShowOffPreference();

function setGlobalLinkShowOffTraffic(enabled) {
    npfGlobalLinkShowOffTraffic = !!enabled;
    try {
        localStorage.setItem(
            NPF_GLOBAL_LINK_SHOW_OFF_KEY,
            npfGlobalLinkShowOffTraffic ? '1' : '0'
        );
    } catch (_) {}

    if (npfGlobalLinkEnabled && npfGlobalLinkLastPositions.length) {
        renderGlobalLinkPositions(npfGlobalLinkLastPositions);
    } else {
        updateGlobalLinkButton();
    }
}

function getStoredGlobalLinkSession() {
    try {
        const token = String(localStorage.getItem(NPF_GLOBAL_LINK_SESSION_KEY) || '');
        const exp = Number(localStorage.getItem(NPF_GLOBAL_LINK_SESSION_EXP_KEY) || 0);
        if (!token || !Number.isFinite(exp) || exp <= Date.now()) {
            clearStoredGlobalLinkSession();
            return null;
        }
        return { token, exp };
    } catch (_) {
        return null;
    }
}

function storeGlobalLinkSession(token, expiresAt) {
    const exp = Date.parse(String(expiresAt || ''));
    if (!token || !Number.isFinite(exp) || exp <= Date.now()) return false;
    try {
        localStorage.setItem(NPF_GLOBAL_LINK_SESSION_KEY, String(token));
        localStorage.setItem(NPF_GLOBAL_LINK_SESSION_EXP_KEY, String(exp));
        return true;
    } catch (_) {
        return false;
    }
}

function clearStoredGlobalLinkSession() {
    try {
        localStorage.removeItem(NPF_GLOBAL_LINK_SESSION_KEY);
        localStorage.removeItem(NPF_GLOBAL_LINK_SESSION_EXP_KEY);
    } catch (_) {}
}

function globalLinkAuthHeaders(docsSession, globalSession = null) {
    const headers = {};
    if (docsSession?.token) headers.Authorization = `Bearer ${docsSession.token}`;
    if (globalSession?.token) headers['X-Global-Link-Session'] = globalSession.token;
    return headers;
}

async function fetchGlobalLinkNas(action, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    npfGlobalLinkLastAction = String(action || '—');
    npfGlobalLinkLastHttpStatus = 0;
    npfGlobalLinkLastError = '';
    try {
        const separator = NPF_GLOBAL_LINK_API_URL.includes('?') ? '&' : '?';
        const url = `${NPF_GLOBAL_LINK_API_URL}${separator}action=${encodeURIComponent(action)}&t=${Date.now()}`;
        const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
        npfGlobalLinkLastHttpStatus = Number(response?.status || 0);
        return response;
    } catch (error) {
        npfGlobalLinkLastError = String(error?.message || error || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function setGlobalLinkAuthStatus(message = '', type = '') {
    const el = document.getElementById('global-link-auth-status');
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.toggle('error', type === 'error');
    el.classList.toggle('success', type === 'success');
}

function openGlobalLinkAuthModal() {
    const modal = document.getElementById('global-link-auth-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function closeGlobalLinkAuthModal() {
    const modal = document.getElementById('global-link-auth-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    const input = document.getElementById('global-link-captcha-input');
    if (input) input.value = '';
}

function isGlobalLinkAbortError(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || error || '');
    return name === 'AbortError' || /fetch\s+is\s+aborted|aborted|aborterror/i.test(message);
}


function isGlobalLinkTemporaryNetworkError(errorOrMessage) {
    if (isGlobalLinkAbortError(errorOrMessage)) return false;
    const message = String(errorOrMessage?.message || errorOrMessage || '')
        .replace(/\s+/g, ' ')
        .trim();
    return /load\s*fail(?:ed)?|failed\s+to\s+fetch|network\s*(?:error|request\s+failed)|connexion\s+(?:réseau\s+)?(?:échouée|impossible)/i.test(message);
}

function shouldRetryGlobalLinkFromEnabledButton() {
    const lastAction = String(npfGlobalLinkLastAction || '').toLowerCase();
    const lastError = String(npfGlobalLinkLastError || '');
    const state = String(npfGlobalLinkLastAuthState || '').toLowerCase();
    return lastAction === 'positions'
        && (isGlobalLinkTemporaryNetworkError(lastError) || /positions-.*(?:fail|erreur)/.test(state));
}

async function probeGlobalLinkEndpoint(url, mode = 'cors', timeoutMs = 6500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            mode,
            credentials: 'omit',
            signal: controller.signal
        });
        return {
            reached: true,
            status: Number(response?.status || 0),
            opaque: response?.type === 'opaque',
            error: ''
        };
    } catch (error) {
        return { reached: false, status: 0, opaque: false, error: String(error?.message || error || '') };
    } finally {
        clearTimeout(timer);
    }
}

async function diagnoseGlobalLinkLoadFailure(timeoutMs = 6500) {
    /* v16.62 — un fetch CORS qui échoue ne permet pas de distinguer CORS de
     * DNS/TLS. On teste donc le même PHP GLR en no-cors, puis le PHP FDS/GAAR
     * du même NAS. Aucun en-tête d'authentification ni token n'est envoyé. */
    const glrSeparator = NPF_GLOBAL_LINK_API_URL.includes('?') ? '&' : '?';
    const glrUrl = `${NPF_GLOBAL_LINK_API_URL}${glrSeparator}action=positions&npf_probe=1&t=${Date.now()}`;
    const docsSeparator = NPF_BRIEFING_DOCS_API_URL.includes('?') ? '&' : '?';
    const docsUrl = `${NPF_BRIEFING_DOCS_API_URL}${docsSeparator}action=status&npf_probe=1&t=${Date.now()}`;

    const corsProbe = await probeGlobalLinkEndpoint(glrUrl, 'cors', timeoutMs);
    if (corsProbe.reached) {
        return { state: 'positions-auth-ou-entetes-fail', glrCors: corsProbe, glrNoCors: null, docsNoCors: null };
    }

    const glrNoCors = await probeGlobalLinkEndpoint(glrUrl, 'no-cors', timeoutMs);
    if (glrNoCors.reached) {
        return { state: 'positions-cors-fail', glrCors: corsProbe, glrNoCors, docsNoCors: null };
    }

    const docsNoCors = await probeGlobalLinkEndpoint(docsUrl, 'no-cors', timeoutMs);
    if (docsNoCors.reached) {
        return { state: 'positions-endpoint-glr-fail', glrCors: corsProbe, glrNoCors, docsNoCors };
    }

    return { state: 'positions-nas-reseau-fail', glrCors: corsProbe, glrNoCors, docsNoCors };
}

function setGlobalLinkPasswordStatus(message = '', type = '') {
    const el = document.getElementById('global-link-password-status');
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.toggle('error', type === 'error');
    el.classList.toggle('success', type === 'success');
}

function closeGlobalLinkPasswordModal() {
    const modal = document.getElementById('global-link-password-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    const input = document.getElementById('global-link-password-input');
    if (input) input.value = '';
}

async function requestGlobalLinkNpfAuthorization() {
    if (npfGlobalLinkPasswordAuthPromise) return npfGlobalLinkPasswordAuthPromise;

    npfGlobalLinkPasswordAuthPromise = new Promise((resolve, reject) => {
        const modal = document.getElementById('global-link-password-modal');
        const input = document.getElementById('global-link-password-input');
        const submitButton = document.getElementById('global-link-password-submit');
        const closeButton = document.getElementById('global-link-password-close');

        if (!modal || !input || !submitButton) {
            reject(new Error('Fenêtre de mot de passe Global Link indisponible.'));
            return;
        }

        let settled = false;
        const cleanup = () => {
            submitButton.removeEventListener('click', onSubmit);
            closeButton?.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeyDown);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onEscape);
        };
        const finishResolve = value => {
            if (settled) return;
            settled = true;
            cleanup();
            closeGlobalLinkPasswordModal();
            resolve(value);
        };
        const finishReject = error => {
            if (settled) return;
            settled = true;
            cleanup();
            closeGlobalLinkPasswordModal();
            reject(error);
        };
        const onCancel = () => finishReject(new Error('Autorisation annulée.'));
        const onBackdrop = event => {
            if (event.target === modal) onCancel();
        };
        const onEscape = event => {
            if (event.key === 'Escape' && modal.style.display === 'flex') onCancel();
        };
        const onKeyDown = event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                onSubmit();
            }
        };
        const onSubmit = async () => {
            const password = String(input.value || '');
            if (!password) {
                setGlobalLinkPasswordStatus('Saisis le mot de passe.', 'error');
                try { input.focus(); } catch (_) {}
                return;
            }

            submitButton.disabled = true;
            setGlobalLinkPasswordStatus('Vérification du mot de passe…');
            try {
                const docsSession = await authorizeBriefingDocs(password);
                if (!docsSession) throw new Error('Autorisation NPF impossible.');
                setGlobalLinkPasswordStatus('Autorisation acceptée.', 'success');
                finishResolve(docsSession);
            } catch (error) {
                submitButton.disabled = false;
                setGlobalLinkPasswordStatus(error?.message || String(error), 'error');
                try {
                    input.focus();
                    input.select();
                } catch (_) {}
            }
        };

        input.value = '';
        submitButton.disabled = false;
        setGlobalLinkPasswordStatus('');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');

        submitButton.addEventListener('click', onSubmit);
        closeButton?.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKeyDown);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onEscape);

        setTimeout(() => {
            try { input.focus(); } catch (_) {}
        }, 30);
    }).finally(() => {
        npfGlobalLinkPasswordAuthPromise = null;
    });

    return npfGlobalLinkPasswordAuthPromise;
}

async function ensureGlobalLinkNpfAuthorization() {
    let docsSession = getStoredBriefingDocsSession();
    if (docsSession) return docsSession;
    if (!navigator.onLine) throw new Error('Connexion Internet requise.');
    docsSession = await tryAuthorizeBriefingDocsFromBfgBridge({ silent: true });
    if (docsSession) return docsSession;
    docsSession = await requestGlobalLinkNpfAuthorization();
    if (!docsSession) throw new Error('Autorisation NPF impossible.');
    return docsSession;
}

async function loadGlobalLinkCaptcha() {
    if (npfGlobalLinkCaptchaLoadPromise) return npfGlobalLinkCaptchaLoadPromise;

    npfGlobalLinkCaptchaLoadPromise = (async () => {
        const docsSession = await ensureGlobalLinkNpfAuthorization();
        openGlobalLinkAuthModal();
        npfGlobalLinkLastAuthState = 'captcha-chargement';
        setGlobalLinkAuthStatus('Chargement du code de sécurité…');
        const image = document.getElementById('global-link-captcha-image');
        if (image) {
            image.removeAttribute('src');
            image.style.visibility = 'hidden';
        }

        const response = await fetchGlobalLinkNas('captcha', {
            method: 'GET',
            headers: globalLinkAuthHeaders(docsSession)
        }, 45000);
        const payload = await response.json().catch(() => null);
        const captchaError = payload?.message || payload?.error || (!response.ok ? `Captcha Global Link impossible (${response.status})` : '');
        rememberGlobalLinkRequestState('captcha', response, captchaError);

        if (!response.ok || !payload || payload.ok !== true || !payload.attempt || !payload.imageDataUrl) {
            if (response.status === 401) clearBriefingDocsSession();
            if (isGlobalLinkTemporaryLoadFail(captchaError)) npfGlobalLinkLastAuthState = 'captcha-load-fail-temporaire';
            throw new Error(captchaError || `Captcha Global Link impossible (${response.status})`);
        }
        rememberGlobalLinkRequestState('captcha', response, '');

        npfGlobalLinkAttempt = String(payload.attempt);
        if (image) {
            image.src = String(payload.imageDataUrl);
            image.style.visibility = 'visible';
        }

        npfGlobalLinkLastAuthState = 'captcha-prêt';
        setGlobalLinkAuthStatus('Saisis le code affiché puis appuie sur Connexion.');
        const input = document.getElementById('global-link-captcha-input');
        if (input) {
            input.value = '';
            try { input.focus(); } catch (_) {}
        }

        // Laisser WebKit peindre le captcha avant toute autre requête/alerte.
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        return true;
    })();

    try {
        return await npfGlobalLinkCaptchaLoadPromise;
    } finally {
        npfGlobalLinkCaptchaLoadPromise = null;
    }
}

async function submitGlobalLinkCaptcha() {
    const input = document.getElementById('global-link-captcha-input');
    const captcha = String(input?.value || '').trim();
    if (!npfGlobalLinkAttempt) throw new Error('Charge d’abord un code de sécurité.');
    if (!captcha) throw new Error('Saisis le code de sécurité.');
    const docsSession = await ensureGlobalLinkNpfAuthorization();
    npfGlobalLinkLastAuthState = 'connexion-en-cours';
    setGlobalLinkAuthStatus('Connexion à Global Link…');

    let response;
    try {
        response = await fetchGlobalLinkNas('login', {
            method: 'POST',
            headers: {
                ...globalLinkAuthHeaders(docsSession),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ attempt: npfGlobalLinkAttempt, captcha })
        }, 15000);
    } catch (error) {
        if (isGlobalLinkAbortError(error)) {
            npfGlobalLinkLastAuthState = 'timeout-login';
            throw new Error('Global Link ne répond pas (délai 15 s dépassé). Appuie sur Nouveau code puis réessaie.');
        }
        npfGlobalLinkLastAuthState = 'erreur-réseau';
        throw error;
    }

    const payload = await response.json().catch(() => null);
    const loginError = payload?.message || payload?.error || (!response.ok ? `Connexion Global Link refusée (${response.status})` : '');
    rememberGlobalLinkRequestState('login', response, loginError);
    if (!response.ok || !payload || payload.ok !== true || !payload.session || !payload.expiresAt) {
        if (response.status === 401 && payload?.error === 'npf_authorization_required') clearBriefingDocsSession();
        npfGlobalLinkLastAuthState = isGlobalLinkTemporaryLoadFail(loginError)
            ? 'login-load-fail-temporaire'
            : `refusé:${String(payload?.error || response.status)}`;
        throw new Error(loginError || `Connexion Global Link refusée (${response.status})`);
    }
    rememberGlobalLinkRequestState('login', response, '');
    if (!storeGlobalLinkSession(payload.session, payload.expiresAt)) {
        throw new Error('Session Global Link reçue mais impossible à enregistrer.');
    }
    npfGlobalLinkAttempt = '';
    npfGlobalLinkLastAuthState = 'connecté';
    setGlobalLinkAuthStatus('Connexion Global Link établie.', 'success');
    setTimeout(closeGlobalLinkAuthModal, 250);
    return getStoredGlobalLinkSession();
}

function ensureGlobalLinkPane() {
    if (!map?.getPane || !map?.createPane) return null;

    let connectorPane = map.getPane(NPF_GLOBAL_LINK_CONNECTOR_PANE_NAME);
    if (!connectorPane) {
        connectorPane = map.createPane(NPF_GLOBAL_LINK_CONNECTOR_PANE_NAME);
    }
    if (connectorPane) {
        connectorPane.style.zIndex = String(NPF_GLOBAL_LINK_CONNECTOR_PANE_Z_INDEX);
        connectorPane.style.pointerEvents = 'none';
    }

    let pane = map.getPane(NPF_GLOBAL_LINK_PANE_NAME);
    if (!pane) pane = map.createPane(NPF_GLOBAL_LINK_PANE_NAME);
    if (pane) {
        pane.style.zIndex = String(NPF_GLOBAL_LINK_PANE_Z_INDEX);
        pane.style.pointerEvents = 'auto';
    }
    return pane;
}

function scheduleGlobalLinkLabelRelayout() {
    if (!npfGlobalLinkEnabled || !npfGlobalLinkLastPositions.length) return;
    if (npfGlobalLinkRelayoutTimer) clearTimeout(npfGlobalLinkRelayoutTimer);
    npfGlobalLinkRelayoutTimer = setTimeout(() => {
        npfGlobalLinkRelayoutTimer = null;
        renderGlobalLinkPositions(npfGlobalLinkLastPositions);
    }, 180); // v16.02 — laisse d'abord finir le rendu Leaflet / tuiles.
}

function ensureGlobalLinkLayer() {
    if (!map || !window.L) return null;
    ensureGlobalLinkPane();
    if (!npfGlobalLinkLayer) npfGlobalLinkLayer = L.layerGroup().addTo(map);
    if (!map.__npfGlobalLinkLabelRelayoutBound) {
        map.__npfGlobalLinkLabelRelayoutBound = true;
        map.on('zoomend moveend resize', scheduleGlobalLinkLabelRelayout);
    }
    return npfGlobalLinkLayer;
}

function formatGlobalLinkAge(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 90) return `${Math.round(value)} s`;
    return `${Math.round(value / 60)} min`;
}

function escapeGlobalLinkHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


function normalizeTrafficSourceCallsign(value) {
    let text = String(value ?? '').trim().toUpperCase();
    if (!text || text === 'N/A' || text === '--') return '';

    /*
     * NFD enlève les accents éventuels, puis on retire espaces, tirets,
     * ponctuation et séparateurs. MILAN 80 et MILAN80 donnent donc la même clé.
     */
    try {
        text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {}

    return text.replace(/[^A-Z0-9]/g, '');
}

function splitTrafficComparableCallsign(value) {
    const compact = normalizeTrafficSourceCallsign(value);
    if (!compact) return { compact: '', base: '', suffix: '' };

    /*
     * On isole le numéro final, éventuellement suivi d'une lettre.
     * Le préfixe doit contenir au moins deux lettres pour éviter des
     * rapprochements trop permissifs.
     */
    const match = compact.match(/^([A-Z]{2,})(\d+[A-Z]?)$/);
    if (!match) return { compact, base: compact, suffix: '' };

    return {
        compact,
        base: match[1],
        suffix: match[2]
    };
}

function trafficCallsignEditDistance(left, right, maxDistance = 4) {
    const a = String(left || '');
    const b = String(right || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

    let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        let rowMinimum = current[0];
        for (let j = 1; j <= b.length; j += 1) {
            const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + substitutionCost
            );
            rowMinimum = Math.min(rowMinimum, current[j]);
        }
        if (rowMinimum > maxDistance) return maxDistance + 1;
        previous = current;
    }
    return previous[b.length];
}

function trafficCallsignCommonPrefixLength(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    const limit = Math.min(a.length, b.length);
    let index = 0;
    while (index < limit && a[index] === b[index]) index += 1;
    return index;
}

/*
 * v16.01 — certains groupes GLR condensent plusieurs appareils dans un seul
 * libellé, par exemple « TRACT C F ». SafeSky publie alors les indicatifs
 * individuels « TRACTC » et « TRACTF ». On produit uniquement des variantes
 * lorsque le premier token est une base d'au moins 3 caractères et que tous
 * les tokens suivants sont des suffixes unitaires alphanumériques.
 */
function buildGlobalLinkGroupedCallsignCandidates(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];

    let normalizedText = raw.toUpperCase();
    try {
        normalizedText = normalizedText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {}

    const tokens = normalizedText.match(/[A-Z0-9]+/g) || [];
    const candidates = [raw];
    if (
        tokens.length >= 3
        && tokens[0].length >= 3
        && tokens.slice(1).every(token => /^[A-Z0-9]$/.test(token))
    ) {
        tokens.slice(1).forEach(suffix => {
            candidates.push(`${tokens[0]}${suffix}`);
        });
    }

    const seen = new Set();
    return candidates.filter(candidate => {
        const key = normalizeTrafficSourceCallsign(candidate);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function compareGlobalLinkNameToSafeSkyIdentifier(glrName, safeSkyIdentifier) {
    const candidates = buildGlobalLinkGroupedCallsignCandidates(glrName);
    let best = null;

    candidates.forEach((candidate, index) => {
        const comparison = compareTrafficSourceCallsigns(candidate, safeSkyIdentifier);
        if (!comparison.match) return;

        const groupedMember = index > 0;
        const result = {
            ...comparison,
            groupedMember,
            groupedCandidate: groupedMember
                ? normalizeTrafficSourceCallsign(candidate)
                : '',
            // Un membre extrait d'un groupe doit toujours être confirmé par proximité.
            fuzzy: comparison.fuzzy || groupedMember,
            mode: groupedMember
                ? `group-member-${comparison.mode || 'match'}`
                : comparison.mode
        };

        const modeScore = result.mode === 'exact-normalized'
            ? 0
            : (result.mode.includes('group-member-exact-normalized') ? 1 : 2);
        const score = modeScore * 100 + (1 - Number(result.similarity || 0)) * 10;
        if (!best || score < best.score) best = { ...result, score };
    });

    if (!best) return { match: false, mode: '', fuzzy: false, similarity: 0 };
    const { score: _score, ...result } = best;
    return result;
}

function compareTrafficSourceCallsigns(glrName, safeSkyIdentifier) {
    const glr = splitTrafficComparableCallsign(glrName);
    const ss = splitTrafficComparableCallsign(safeSkyIdentifier);

    if (!glr.compact || !ss.compact) {
        return { match: false, mode: '', fuzzy: false, similarity: 0 };
    }

    if (glr.compact === ss.compact) {
        return { match: true, mode: 'exact-normalized', fuzzy: false, similarity: 1 };
    }

    /*
     * v15.79 — forte ressemblance GLR / SafeSky :
     * - le numéro final doit être STRICTEMENT identique ;
     * - les préfixes doivent avoir au moins 4 caractères ;
     * - abréviation évidente admise (PELIC <-> PELICAN) ;
     * - petite faute/insertion admise (DRAGO <-> DRAGON).
     * La proximité géographique confirme ensuite les rapprochements flous.
     */
    if (
        !glr.suffix
        || !ss.suffix
        || glr.suffix !== ss.suffix
        || glr.base.length < 4
        || ss.base.length < 4
    ) {
        return { match: false, mode: '', fuzzy: false, similarity: 0 };
    }

    const shorter = glr.base.length <= ss.base.length ? glr.base : ss.base;
    const longer = glr.base.length > ss.base.length ? glr.base : ss.base;
    const lengthDifference = longer.length - shorter.length;
    const editDistance = trafficCallsignEditDistance(glr.base, ss.base, 3);
    const maxLength = Math.max(glr.base.length, ss.base.length);
    const similarity = maxLength > 0
        ? Math.max(0, 1 - (editDistance / maxLength))
        : 0;
    const commonPrefixLength = trafficCallsignCommonPrefixLength(glr.base, ss.base);

    const isStrongPrefixAbbreviation = (
        longer.startsWith(shorter)
        && shorter.length >= 4
        && lengthDifference <= 3
        && (shorter.length / longer.length) >= 0.60
    );
    if (isStrongPrefixAbbreviation) {
        return {
            match: true,
            mode: 'same-number-prefix-abbreviation',
            fuzzy: true,
            similarity
        };
    }

    const isStrongTypoMatch = (
        editDistance <= 1
        || (
            editDistance <= 2
            && similarity >= 0.70
            && commonPrefixLength >= 3
        )
    );
    if (isStrongTypoMatch) {
        return {
            match: true,
            mode: 'same-number-strong-similarity',
            fuzzy: true,
            similarity
        };
    }

    return { match: false, mode: '', fuzzy: false, similarity };
}

const TRAFFIC_GLR_FUZZY_MATCH_MAX_DISTANCE_NM = 3;

function getSafeSkyTrafficForGlobalLinkDedup() {
    /*
     * SafeSky reste la source prioritaire lorsqu'elle est affichée. Chaque
     * candidat expose désormais TOUS ses identifiants utiles (callsign +
     * immatriculation), et non plus seulement le callsign.
     */
    const result = [];
    const seenCandidateKeys = new Set();

    const pushCandidate = ({ aircraft, marker = null, ownAircraft = false, ownId = '' }) => {
        const ac = aircraft || {};
        const identifiers = [ac.callsign, ac.registration]
            .map(value => String(value || '').trim())
            .filter(value => value && value !== 'N/A' && value !== '--');
        const normalizedIdentifiers = Array.from(new Set(
            identifiers.map(normalizeTrafficSourceCallsign).filter(Boolean)
        ));
        if (!normalizedIdentifiers.length) return;

        const aircraftKey = ownAircraft
            ? `own:${ownId || ac.id || normalizedIdentifiers[0]}`
            : (marker?._trafficAircraftKey || buildTrafficAircraftKey(ac));
        const candidateKey = `${aircraftKey || ''}|${normalizedIdentifiers.join('|')}`;
        if (seenCandidateKeys.has(candidateKey)) return;
        seenCandidateKeys.add(candidateKey);

        const latLng = marker?.getLatLng?.();
        result.push({
            callsign: String(ac.callsign || '').trim(),
            registration: String(ac.registration || '').trim(),
            identifiers,
            normalizedIdentifiers,
            lat: Number(latLng?.lat ?? ac.lat),
            lon: Number(latLng?.lng ?? ac.lon),
            aircraftKey,
            ownAircraft
        });
    };

    if (
        showTrafficLayer
        && trafficLayer
        && map
        && map.hasLayer?.(trafficLayer)
    ) {
        trafficMarkerRegistry.forEach(entry => {
            if (!entry?.aircraft || !entry?.marker || entry.marker._npfTrafficRemoved) return;
            pushCandidate({ aircraft: entry.aircraft, marker: entry.marker });
        });
    }

    const ownAircraft = getOwnTrafficAircraftSession();
    if (ownAircraft) {
        pushCandidate({
            aircraft: ownAircraft,
            ownAircraft: true,
            ownId: ownAircraft.id
        });
    }

    return result;
}

function findSafeSkyMatchForGlobalLinkItem(item, safeSkyTraffic) {
    const glrName = String(item?.name || '').trim();
    if (!glrName || !Array.isArray(safeSkyTraffic) || !safeSkyTraffic.length) {
        return null;
    }

    let best = null;

    safeSkyTraffic.forEach(candidate => {
        let distanceNm = Infinity;
        if (
            Number.isFinite(Number(item?.lat))
            && Number.isFinite(Number(item?.lon))
            && Number.isFinite(Number(candidate.lat))
            && Number.isFinite(Number(candidate.lon))
        ) {
            distanceNm = calculateDistanceInNm(
                Number(item.lat),
                Number(item.lon),
                Number(candidate.lat),
                Number(candidate.lon)
            );
        }

        const identifiers = Array.isArray(candidate.identifiers) && candidate.identifiers.length
            ? candidate.identifiers
            : [candidate.callsign, candidate.registration].filter(Boolean);

        identifiers.forEach(identifier => {
            const comparison = compareGlobalLinkNameToSafeSkyIdentifier(glrName, identifier);
            if (!comparison.match) return;

            /*
             * Une ressemblance floue n'est validée que si les deux plots sont
             * géographiquement compatibles. Exception : « mon avion », dont la
             * position SafeSky est volontairement absente lorsque son plot est masqué.
             */
            const strongPrefixAbbreviation = (
                comparison.mode === 'same-number-prefix-abbreviation'
            );

            /*
             * v17.00 — BENGA96 / BENGALE96, PELIC31 / PELICAN31, etc.
             * Une abréviation forte avec même numéro final identifie déjà
             * suffisamment le même appareil : SafeSky reste prioritaire même si
             * les deux sources n'ont pas exactement la même position.
             *
             * Les fautes/similarités floues et membres de groupe GLR conservent
             * la sécurité géographique de 3 NM.
             */
            if (
                comparison.fuzzy
                && !strongPrefixAbbreviation
                && !candidate.ownAircraft
                && (
                    !Number.isFinite(distanceNm)
                    || distanceNm > TRAFFIC_GLR_FUZZY_MATCH_MAX_DISTANCE_NM
                )
            ) {
                return;
            }

            const modeScore = comparison.mode === 'exact-normalized'
                ? 0
                : (comparison.mode === 'same-number-prefix-abbreviation' ? 1 : 2);
            const score = modeScore * 100
                + (1 - Number(comparison.similarity || 0)) * 10
                + (Number.isFinite(distanceNm) ? Math.min(distanceNm, 9.9) : 9.9);

            if (!best || score < best.score) {
                best = {
                    score,
                    mode: comparison.mode,
                    similarity: comparison.similarity,
                    glrName,
                    safeSkyCallsign: candidate.callsign,
                    safeSkyRegistration: candidate.registration,
                    safeSkyMatchedIdentifier: identifier,
                    groupedCandidate: comparison.groupedCandidate || '',
                    safeSkyAircraftKey: candidate.aircraftKey,
                    distanceNm: Number.isFinite(distanceNm) ? distanceNm : null
                };
            }
        });
    });

    return best;
}

/*
 * Diagnostic volontairement non graphique : disponible dans la console si
 * besoin de contrôler les appariements sans encombrer la carte.
 */
window.getGlobalLinkSafeSkyMatches = () => (
    Array.isArray(npfGlobalLinkSafeSkyMatches)
        ? npfGlobalLinkSafeSkyMatches.map(item => ({ ...item }))
        : []
);

function parseGlobalLinkBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (['1','true','yes','oui','y','on'].includes(normalized)) return true;
    if (['0','false','no','non','n','off'].includes(normalized)) return false;
    return null;
}

function isGlobalLinkOffTraffic(item, ageSeconds = null) {
    if (!item || typeof item !== 'object') return false;

    /*
     * v15.92 — marron/orange signifie exclusivement « Off ».
     * Si le relais expose un état explicite, il est toujours prioritaire.
     */
    for (const key of ['off', 'isOff', 'disabled', 'inactive']) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        const raw = String(item[key] ?? '').trim().toLowerCase();
        if (raw === 'off' || raw === 'inactive' || raw === 'disabled') return true;
        const parsed = parseGlobalLinkBoolean(item[key]);
        if (parsed !== null) return parsed;
    }

    for (const key of ['active', 'isActive', 'enabled', 'online']) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        const parsed = parseGlobalLinkBoolean(item[key]);
        if (parsed !== null) return !parsed;
    }

    const stateText = [
        item.flightStatus,
        item.status,
        item.state,
        item.groupStatus,
        item.missionStatus
    ].map(value => String(value ?? '').trim().toLowerCase()).join(' ');

    if (/\b(off|inactive|disabled|stopped|offline)\b/i.test(stateText)) return true;
    if (/\b(active|enabled|online|on)\b/i.test(stateText)) return false;

    /*
     * Le relais actuel ne transmet pas encore l'étiquette « Off » affichée par
     * l'interface GLR. On conserve donc le comportement historique qui produit
     * les éléments marron/orange : position non renouvelée depuis plus de 180 s.
     * Cela ne signifie en aucun cas « au sol ».
     */
    const age = Number.isFinite(Number(ageSeconds))
        ? Number(ageSeconds)
        : (() => {
            const ts = Date.parse(String(item.updatedAt || ''));
            return Number.isFinite(ts) ? Math.max(0, (Date.now() - ts) / 1000) : Infinity;
        })();
    return age > NPF_GLOBAL_LINK_OFF_SECONDS;
}

function updateGlobalLinkButton(options = {}) {
    const button = document.getElementById('global-link-layer-button');
    const activeCountEl = document.getElementById('global-link-button-count');
    const offCountEl = document.getElementById('global-link-off-button-count');
    if (!button) return;

    const hasSession = !!getStoredGlobalLinkSession();
    const positions = Array.isArray(npfGlobalLinkLastPositions) ? npfGlobalLinkLastPositions : [];
    const detected = positions.filter(item => (
        Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))
    ));

    button.classList.remove('global-link-auth-needed','global-link-ready','global-link-active','global-link-stale','loading');
    if (options.loading) button.classList.add('loading');

    /*
     * v15.92 — le contour est national : vert dès qu'au moins un trafic GLR
     * valide est reçu, indépendamment du viewport et de son état Actif/Off.
     */
    if (!hasSession) {
        button.classList.add('global-link-auth-needed');
        button.title = 'GLR — connexion requise';
    } else if (npfGlobalLinkEnabled && detected.length) {
        button.classList.add('global-link-active');
        button.title = `GLR — ${detected.length} trafic(s) détecté(s) au total — appuyer pour masquer · appui long : options`;
    } else {
        button.classList.add('global-link-ready');
        button.title = npfGlobalLinkEnabled
            ? 'GLR — aucun trafic détecté · appui long : options'
            : 'GLR — appuyer pour afficher · appui long : options';
    }

    const activeCount = Math.max(0, Math.round(Number(npfGlobalLinkActiveTotalCount) || 0));
    const offCount = Math.max(0, Math.round(Number(npfGlobalLinkOffTotalCount) || 0));

    if (activeCountEl) {
        activeCountEl.textContent = String(activeCount);
        activeCountEl.style.display = npfGlobalLinkEnabled && activeCount > 0 ? 'inline-flex' : 'none';
        activeCountEl.title = `${activeCount} trafic(s) GLR actif(s) — total national`;
    }
    if (offCountEl) {
        offCountEl.textContent = String(offCount);
        offCountEl.style.display = npfGlobalLinkEnabled && offCount > 0 ? 'inline-flex' : 'none';
        offCountEl.title = `${offCount} trafic(s) GLR Off — total national`;
    }
}

function globalLinkRectsOverlap(a, b, gap = 3) {
    return !(
        a.right + gap <= b.left
        || a.left >= b.right + gap
        || a.bottom + gap <= b.top
        || a.top >= b.bottom + gap
    );
}

/*
 * v16.00 — GLR : le type de porteur est normalisé avant le choix de l'icône.
 * La valeur nominale reste `0 = hélicoptère`, `1 = avion`, mais NPF accepte
 * aussi les formes texte usuelles. Si un ancien relais ne transmet pas encore
 * `typePorteur`, les indicatifs GLR hélicoptère clairement identifiables
 * (DRAGON / DRAGO / PUMA / HÉLI) servent uniquement de repli visuel.
 */
function normalizeGlobalLinkCarrierType(item) {
    const rawType = item?.typePorteur ?? item?.type_porteur ?? item?.carrierType ?? item?.typeCarrier;
    if (rawType !== null && rawType !== undefined && rawType !== '') {
        const numeric = Number(rawType);
        if (numeric === 0 || numeric === 1) return numeric;
        const text = String(rawType)
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        if (/^(?:HELICOPTER|HELICOPTERE|HELICO|HELI)$/.test(text)) return 0;
        if (/^(?:AIRPLANE|PLANE|AVION|MOTORPLANE)$/.test(text)) return 1;
    }

    const normalizedName = String(item?.name || '')
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]/g, '');
    if (/^(?:DRAGON|DRAGO|PUMA|HELI)/.test(normalizedName)) return 0;
    return null;
}

function getGlobalLinkVisualDefinition(item) {
    const typePorteur = normalizeGlobalLinkCarrierType(item);
    const beaconType = typePorteur === 0 ? 'HELICOPTER' : 'MOTORPLANE';
    return getTrafficAircraftVisualDefinition({ beaconType });
}

/* v16.08 — altitude GLR à nouveau affichée dans les étiquettes.
 * Le relais GLR fournit la valeur `alt` en centimètres. */
const NPF_GLOBAL_LINK_ALTITUDE_RAW_TO_FEET = 0.03280839895;

function getGlobalLinkAltitudeFeet(rawAltitude) {
    if (rawAltitude === null || rawAltitude === undefined || rawAltitude === '') return null;
    const raw = Number(rawAltitude);
    if (!Number.isFinite(raw)) return null;
    const feet = raw * NPF_GLOBAL_LINK_ALTITUDE_RAW_TO_FEET;
    return Number.isFinite(feet) ? feet : null;
}

function formatGlobalLinkAltitudeFeet(rawAltitude) {
    const feet = getGlobalLinkAltitudeFeet(rawAltitude);
    if (!Number.isFinite(feet)) return '';
    const roundedFeet = Math.round(feet / 100) * 100;
    return formatNpfAltitudeFeetLabel(roundedFeet);
}

function buildGlobalLinkLabelLayout(items) {
    const placements = new Map();
    if (!map?.latLngToContainerPoint || !map?.getSize) return placements;
    const size = map.getSize();
    const edge = 8;
    const occupiedLabels = [];
    const symbolRects = items.map(item => {
        const p = map.latLngToContainerPoint([item.lat, item.lon]);
        return { left: p.x - 21, right: p.x + 21, top: p.y - 21, bottom: p.y + 21 };
    });

    const insideViewport = rect => (
        rect.left >= edge && rect.right <= size.x - edge
        && rect.top >= edge && rect.bottom <= size.y - edge
    );
    const isFree = (rect, ownIndex) => (
        insideViewport(rect)
        && !occupiedLabels.some(other => globalLinkRectsOverlap(rect, other, 4))
        && !symbolRects.some((symbol, symbolIndex) => symbolIndex !== ownIndex && globalLinkRectsOverlap(rect, symbol, 2))
    );
    const rectFromCenter = (x, y, width, height) => ({
        left: x - width / 2, right: x + width / 2,
        top: y - height / 2, bottom: y + height / 2
    });

    items.forEach((item, index) => {
        const p = map.latLngToContainerPoint([item.lat, item.lon]);
        const altitudeLabel = formatGlobalLinkAltitudeFeet(item.altitude);
        const longestLabelLength = Math.max(
            String(item.name || '').length,
            altitudeLabel.length
        );
        const width = Math.max(68, Math.min(178, 20 + longestLabelLength * 8.4));
        const height = altitudeLabel ? 42 : 25;
        const hGap = 27 + width / 2;
        const vGap = 27 + height / 2;
        const shifts = [0, -30, 30, -60, 60, -90, 90, -120, 120];
        const candidates = [];

        // Priorité à droite/gauche puis dessus/dessous, en décalant progressivement.
        shifts.forEach(dy => {
            candidates.push({ x: p.x + hGap, y: p.y + dy });
            candidates.push({ x: p.x - hGap, y: p.y + dy });
        });
        shifts.forEach(dx => {
            candidates.push({ x: p.x + dx, y: p.y - vGap });
            candidates.push({ x: p.x + dx, y: p.y + vGap });
        });

        let chosen = null;
        for (const candidate of candidates) {
            const rect = rectFromCenter(candidate.x, candidate.y, width, height);
            if (isFree(rect, index)) { chosen = { ...candidate, rect }; break; }
        }

        /*
         * v15.28 — ne jamais transformer les étiquettes GLR en « liste » dans
         * un coin de la carte. Si aucun emplacement proche du trafic n'est libre,
         * l'étiquette est masquée plutôt que déplacée loin de son symbole.
         * Le symbole avion reste visible et cliquable.
         */
        if (!chosen) return;

        placements.set(item.key, { point: L.point(chosen.x, chosen.y), width, height });
        occupiedLabels.push(chosen.rect);
    });
    return placements;
}


function purgeGlobalLinkDomArtifacts() {
    try {
        const container = map?.getContainer?.();
        if (!container) return;
        container.querySelectorAll(
            '.global-link-aircraft-marker, .global-link-aircraft-label-marker, .global-link-connector-marker'
        ).forEach(node => node.remove());
    } catch (_) {}
}

function renderGlobalLinkPositions(positions) {
    npfGlobalLinkLastPositions = Array.isArray(positions) ? positions : [];
    const layer = ensureGlobalLinkLayer();
    if (!layer) return;
    layer.clearLayers();
    purgeGlobalLinkDomArtifacts();
    if (!npfGlobalLinkEnabled) {
        npfGlobalLinkRenderedCount = 0;
        npfGlobalLinkActiveTotalCount = 0;
        npfGlobalLinkOffTotalCount = 0;
        npfGlobalLinkSafeSkyMatches = [];
        updateGlobalLinkButton();
        return;
    }
    const now = Date.now();
    const currentBounds = map?.getBounds ? map.getBounds() : null;

    /*
     * v15.92 — préparer d'abord la totalité des trafics GLR reçus. Les badges
     * Actif / Off sont calculés ici, avant tout filtrage par viewport ou fusion
     * visuelle avec SafeSky.
     */
    const allItems = npfGlobalLinkLastPositions
        .map((item, sourceIndex) => {
            const lat = Number(item.lat);
            const lon = Number(item.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

            const ts = Date.parse(String(item.updatedAt || ''));
            const ageSeconds = Number.isFinite(ts) ? Math.max(0, (now - ts) / 1000) : Infinity;
            const name = String(item.name || 'Global Link').trim();
            const off = isGlobalLinkOffTraffic(item, ageSeconds);
            return {
                ...item, lat, lon, ageSeconds, name,
                off,
                /*
                 * Classe CSS historique conservée pour ne pas modifier le rendu :
                 * « stale » signifie désormais uniquement « Off ».
                 */
                stale: off,
                key: `${String(item.groupId || item.missionId || name)}|${sourceIndex}`
            };
        })
        .filter(Boolean)
        .filter(item => !isOwnGlobalLinkAircraft(item))
        .sort((a, b) => (a.ageSeconds - b.ageSeconds) || a.name.localeCompare(b.name, 'fr'));

    npfGlobalLinkOffTotalCount = allItems.filter(item => item.off === true).length;
    npfGlobalLinkActiveTotalCount = Math.max(
        0,
        allItems.length - npfGlobalLinkOffTotalCount
    );

    /*
     * v15.94 — l'option « Afficher trafics non actifs » agit uniquement sur le
     * rendu cartographique. Les compteurs Actif / Off restent nationaux et ne
     * dépendent donc jamais de ce filtre.
     */
    const displayItems = npfGlobalLinkShowOffTraffic
        ? allItems
        : allItems.filter(item => item.off !== true);

    /*
     * Le rendu cartographique reste limité au viewport : aucun trafic hors champ
     * ne génère symbole, étiquette ou connecteur, mais il reste compté au bouton.
     */
    const visibleItems = currentBounds
        ? displayItems.filter(item => currentBounds.contains(L.latLng(item.lat, item.lon)))
        : displayItems.slice();

    /*
     * v15.43 — SafeSky reste prioritaire. En plus des trafics réellement
     * rendus, l'avion SafeSky défini comme « mon avion » participe à la
     * déduplication GLR même s'il est volontairement masqué de la carte.
     */
    const renderedSafeSkyTraffic = getSafeSkyTrafficForGlobalLinkDedup();
    npfGlobalLinkSafeSkyMatches = [];

    const deduplicatedItems = visibleItems.filter(item => {
        const match = findSafeSkyMatchForGlobalLinkItem(
            item,
            renderedSafeSkyTraffic
        );
        if (!match) return true;

        npfGlobalLinkSafeSkyMatches.push({
            ...match,
            glrGroupId: item.groupId || '',
            glrMissionId: item.missionId || ''
        });
        return false;
    });

    npfGlobalLinkRenderedCount = deduplicatedItems.length;
    const labelLayout = buildGlobalLinkLabelLayout(deduplicatedItems);
    deduplicatedItems.forEach(item => {
        const safeName = escapeGlobalLinkHtml(item.name);
        const placement = labelLayout.get(item.key);
        const labelLatLng = placement
            ? map.containerPointToLatLng(placement.point)
            : null;

        /*
         * v15.27 — liaison centre étiquette -> centre trafic.
         * Le trait est ajouté avant le symbole et l'étiquette afin qu'ils
         * restent graphiquement au premier plan, tout en reliant leurs centres.
         */
        if (labelLatLng && placement) {
            /*
             * v15.30 — connecteur DOM. Les deux extrémités sont calculées à
             * partir des centres en pixels du trafic et de l'étiquette.
             * L'élément est un marqueur Leaflet dans le MEME pane que les
             * symboles GLR : on évite ainsi les problèmes de rendu SVG/canvas
             * constatés sur l'iPad.
             */
            const aircraftPoint = map.latLngToContainerPoint(
                [item.lat, item.lon]
            );
            const labelPoint = placement.point;
            const dx = labelPoint.x - aircraftPoint.x;
            const dy = labelPoint.y - aircraftPoint.y;
            const lengthPx = Math.hypot(dx, dy);

            if (Number.isFinite(lengthPx) && lengthPx >= 2) {
                const midpoint = L.point(
                    (aircraftPoint.x + labelPoint.x) / 2,
                    (aircraftPoint.y + labelPoint.y) / 2
                );
                const midpointLatLng = map.containerPointToLatLng(
                    midpoint
                );
                const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
                const connectorClass = item.stale
                    ? ' stale'
                    : '';
                /*
                 * v15.94 — le connecteur reste associé à l'état de l'étiquette :
                 * vert pour actif, marron pour Off.
                 */
                const connectorColor = item.stale
                    ? '#8b5a2b'
                    : '#198754';

                const connectorIcon = L.divIcon({
                    className: 'global-link-connector-marker',
                    html: `<span class="global-link-connector-line${connectorClass}" style="--glr-connector-color:${connectorColor};width:${lengthPx.toFixed(1)}px;transform:translate(-50%,-50%) rotate(${angleDeg.toFixed(2)}deg);"></span>`,
                    iconSize: [1, 1],
                    iconAnchor: [0.5, 0.5]
                });

                L.marker(midpointLatLng, {
                    /*
                     * v15.34 — pane DOM dédié juste sous les marqueurs GLR.
                     * Aucun zIndexOffset négatif : Safari pouvait placer le
                     * connecteur derrière le contenu cartographique.
                     */
                    pane: NPF_GLOBAL_LINK_CONNECTOR_PANE_NAME,
                    icon: connectorIcon,
                    interactive: false,
                    keyboard: false,
                    zIndexOffset: 0
                }).addTo(layer);
            }
        }

        const glrVisual = getGlobalLinkVisualDefinition(item);
        const glrSymbolSvg = `<svg viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">${glrVisual.svg}</svg>`;
        const symbolIcon = L.divIcon({
            className: 'global-link-aircraft-marker',
            html: `<div class="global-link-aircraft-symbol${item.stale ? ' stale' : ''} glr-type-${escapeGlobalLinkHtml(glrVisual.className)}"><span class="global-link-aircraft-silhouette" aria-label="${escapeGlobalLinkHtml(glrVisual.label)}">${glrSymbolSvg}</span></div>`,
            iconSize: [38,38],
            iconAnchor: [19,19]
        });
        const marker = L.marker([item.lat, item.lon], {
            pane: NPF_GLOBAL_LINK_PANE_NAME,
            icon: symbolIcon,
            keyboard: false,
            title: item.name
        });
        marker.bindPopup(`<div class="global-link-popup"><strong>${safeName}</strong><br>Source : Global Link Rescue<br>Position : ${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}<br>Âge : ${escapeGlobalLinkHtml(formatGlobalLinkAge(item.ageSeconds))}<button type="button" class="traffic-popup-own-button global-link-popup-own-button">Définir comme mon avion et masquer</button></div>`);
        marker.on('popupopen', () => {
            const popupElement = marker.getPopup()?.getElement?.();
            const ownButton = popupElement?.querySelector?.('.global-link-popup-own-button');
            if (!ownButton) return;
            ownButton.onclick = event => {
                event.preventDefault();
                event.stopPropagation();
                try {
                    setOwnTrafficAircraftCallsign(item.name, {
                        source: 'GLR'
                    });
                } catch (error) {
                    console.warn('[GLR] Définition Mon avion impossible:', error);
                }
            };
        });
        marker.addTo(layer);

        if (placement && labelLatLng) {
            const altitudeLabel = formatGlobalLinkAltitudeFeet(item.altitude);
            const safeAltitudeLabel = altitudeLabel
                ? escapeGlobalLinkHtml(altitudeLabel)
                : '';
            const labelIcon = L.divIcon({
                className: 'global-link-aircraft-label-marker',
                html: `<div class="global-link-aircraft-label${item.stale ? ' stale' : ''}${safeAltitudeLabel ? ' glr-with-altitude' : ''}"><span class="glr-label-name">${safeName}</span>${safeAltitudeLabel ? `<span class="glr-label-altitude">${safeAltitudeLabel}</span>` : ''}</div>`,
                iconSize: [placement.width, placement.height],
                iconAnchor: [placement.width / 2, placement.height / 2]
            });
            const labelMarker = L.marker(labelLatLng, {
                pane: NPF_GLOBAL_LINK_PANE_NAME,
                icon: labelIcon,
                interactive: true,
                bubblingMouseEvents: false,
                keyboard: false,
                title: item.name
            });
            labelMarker.on('click', event => {
                try {
                    if (event?.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
                } catch (_) {}
                try { marker.openPopup(); } catch (_) {}
            });
            labelMarker.addTo(layer);
        }
    });
    updateGlobalLinkButton();
}

async function refreshGlobalLinkPositions(options = {}) {
    if (!npfGlobalLinkEnabled || npfGlobalLinkFetchInProgress) return false;
    if (!navigator.onLine) {
        updateGlobalLinkButton();
        return false;
    }
    const docsSession = getStoredBriefingDocsSession();
    const globalSession = getStoredGlobalLinkSession();
    if (!docsSession || !globalSession) {
        if (!docsSession) clearBriefingDocsSession();
        if (!globalSession) clearStoredGlobalLinkSession();
        updateGlobalLinkButton();
        if (!options.silent) await loadGlobalLinkCaptcha();
        return false;
    }
    npfGlobalLinkFetchInProgress = true;
    updateGlobalLinkButton({ loading: true });
    try {
        let response = null;
        let payload = null;
        let lastMessage = '';

        /* v16.60 — Safari peut échouer AVANT toute réponse HTTP avec
         * TypeError('Load failed'). Cette exception doit entrer elle aussi dans
         * l'unique relance POSITIONS ; elle ne doit jamais invalider la session. */
        for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
            try {
                response = await fetchGlobalLinkNas('positions', {
                    method: 'GET',
                    headers: globalLinkAuthHeaders(docsSession, globalSession)
                }, 20000);
                payload = await response.json().catch(() => null);
                lastMessage = payload?.message || payload?.error || (!response.ok ? `Positions Global Link indisponibles (${response.status})` : '');
                rememberGlobalLinkRequestState('positions', response, lastMessage);

                if (response.ok && payload && payload.ok === true) break;

                const temporaryLoadFail = isGlobalLinkTemporaryLoadFail(lastMessage);
                if (temporaryLoadFail && attemptIndex === 0) {
                    npfGlobalLinkLastAuthState = 'positions-load-fail-retry';
                    await new Promise(resolve => setTimeout(resolve, 650));
                    continue;
                }
                break;
            } catch (requestError) {
                lastMessage = String(requestError?.message || requestError || '');
                rememberGlobalLinkRequestState('positions', { status: 0 }, lastMessage);
                if (isGlobalLinkTemporaryNetworkError(requestError)) {
                    npfGlobalLinkLastAuthState = attemptIndex === 0
                        ? 'positions-network-retry'
                        : 'positions-network-fail-temporaire';
                    if (attemptIndex === 0) {
                        await new Promise(resolve => setTimeout(resolve, 650));
                        continue;
                    }
                }
                throw requestError;
            }
        }

        if (!response?.ok || !payload || payload.ok !== true) {
            if (response?.status === 401) {
                if (payload?.error === 'npf_authorization_required') clearBriefingDocsSession();
                if (payload?.error === 'global_session_invalid') clearStoredGlobalLinkSession();
            }
            if (isGlobalLinkTemporaryLoadFail(lastMessage)) {
                npfGlobalLinkLastAuthState = 'positions-load-fail-temporaire';
            }
            throw new Error(lastMessage || `Positions Global Link indisponibles (${response?.status || 0})`);
        }

        rememberGlobalLinkRequestState('positions', response, '');
        npfGlobalLinkLastAuthState = 'positions-ok';
        renderGlobalLinkPositions(payload.positions || []);
        return true;
    } catch (error) {
        let userMessage = String(error?.message || error || 'Erreur Global Link');
        if (isGlobalLinkTemporaryNetworkError(error)) {
            const diagnostic = await diagnoseGlobalLinkLoadFailure();
            npfGlobalLinkLastAuthState = diagnostic.state;
            if (diagnostic.state === 'positions-cors-fail') {
                userMessage = 'Load failed — relais GLR joignable sans CORS : blocage CORS probable sur npf-global-link-api.php.';
            } else if (diagnostic.state === 'positions-endpoint-glr-fail') {
                userMessage = 'Load failed — NAS joignable via FDS/GAAR, mais endpoint npf-global-link-api.php inaccessible.';
            } else if (diagnostic.state === 'positions-nas-reseau-fail') {
                userMessage = 'Load failed — NAS non joignable depuis Safari, y compris via le relais FDS/GAAR.';
            } else {
                userMessage = `Load failed — relais GLR joignable en CORS (HTTP ${diagnostic.glrCors?.status || 'réponse'}), requête authentifiée/en-têtes à contrôler.`;
            }
        }
        rememberGlobalLinkRequestState(
            npfGlobalLinkLastAction || 'positions',
            { status: npfGlobalLinkLastHttpStatus },
            userMessage
        );
        console.warn('[Global Link]', error);
        updateGlobalLinkButton();
        if (!options.silent && !isGlobalLinkAbortError(error)) {
            alert(`Global Link : ${userMessage}`);
        }
        return false;
    } finally {
        npfGlobalLinkFetchInProgress = false;
        updateGlobalLinkButton();
    }
}

function stopGlobalLinkRefreshTimer() {
    if (npfGlobalLinkRefreshTimer) clearInterval(npfGlobalLinkRefreshTimer);
    npfGlobalLinkRefreshTimer = null;
}

function startGlobalLinkRefreshTimer() {
    stopGlobalLinkRefreshTimer();
    if (!npfGlobalLinkEnabled) return;
    npfGlobalLinkRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible') refreshGlobalLinkPositions({ silent: true });
    }, NPF_GLOBAL_LINK_REFRESH_MS);
}

function setGlobalLinkEnabled(enabled, options = {}) {
    npfGlobalLinkEnabled = !!enabled;
    try { localStorage.setItem(NPF_GLOBAL_LINK_LAYER_ENABLED_KEY, npfGlobalLinkEnabled ? '1' : '0'); } catch (_) {}
    if (!npfGlobalLinkEnabled) {
        stopGlobalLinkRefreshTimer();
        if (npfGlobalLinkLayer) npfGlobalLinkLayer.clearLayers();
        purgeGlobalLinkDomArtifacts();
        updateGlobalLinkButton();
        return;
    }
    startGlobalLinkRefreshTimer();
    updateGlobalLinkButton();
    if (options.refresh !== false) refreshGlobalLinkPositions({ silent: !!options.silent });
}

async function handleGlobalLinkButtonClick() {
    if (npfGlobalLinkEnabled) {
        /* v16.60 — si GLR est resté ON après un échec silencieux POSITIONS,
         * le premier clic doit RELANCER et afficher l'erreur éventuelle ; il ne
         * doit plus simplement passer le calque OFF et obliger à cliquer deux fois. */
        if (shouldRetryGlobalLinkFromEnabledButton()) {
            await refreshGlobalLinkPositions({ silent: false });
            return;
        }
        setGlobalLinkEnabled(false);
        return;
    }
    const docsSession = await ensureGlobalLinkNpfAuthorization();
    let globalSession = getStoredGlobalLinkSession();
    if (!globalSession) {
        await loadGlobalLinkCaptcha();
        return;
    }
    if (!docsSession) return;
    setGlobalLinkEnabled(true, { refresh: true, silent: false });
}

/*
 * v15.94 — menu GLR accessible par appui long sur le bouton de carte.
 * Il ne contient pour l'instant que le filtre des trafics non actifs.
 */
function ensureGlobalLinkOptionsMenu() {
    let modal = document.getElementById('global-link-options-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'global-link-options-modal';
    modal.className = 'global-link-options-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="global-link-options-card" role="dialog" aria-modal="true" aria-labelledby="global-link-options-title">
            <div class="global-link-options-header">
                <strong id="global-link-options-title">Global Link Rescue</strong>
                <button type="button" class="global-link-options-close" aria-label="Fermer">×</button>
            </div>
            <label class="global-link-options-check-row">
                <input id="global-link-show-off-input" type="checkbox">
                <span>Afficher trafics non actifs</span>
            </label>
        </div>
    `;
    document.body.appendChild(modal);

    const closeButton = modal.querySelector('.global-link-options-close');
    const checkbox = modal.querySelector('#global-link-show-off-input');

    const close = () => {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    };

    closeButton?.addEventListener('click', close);
    modal.addEventListener('click', event => {
        if (event.target === modal) close();
    });
    checkbox?.addEventListener('change', () => {
        setGlobalLinkShowOffTraffic(checkbox.checked);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal.style.display === 'flex') close();
    });

    return modal;
}

function openGlobalLinkOptionsMenu() {
    const modal = ensureGlobalLinkOptionsMenu();
    const checkbox = modal.querySelector('#global-link-show-off-input');
    if (checkbox) checkbox.checked = npfGlobalLinkShowOffTraffic;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function installGlobalLinkButtonInteractions(button) {
    if (!button || button.dataset.globalLinkBound === '1') return;
    button.dataset.globalLinkBound = '1';

    protectNpfLongPressControlFromIosSelection(button);

    let longPressTimer = null;
    let longPressTriggered = false;

    const clearLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    const startLongPress = event => {
        if (event && event.button !== undefined && event.button !== 0) return;
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        clearLongPress();
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            openGlobalLinkOptionsMenu();
        }, 650);
    };

    button.addEventListener('pointerdown', startLongPress, { passive: false });
    button.addEventListener('pointerup', clearLongPress);
    button.addEventListener('pointerleave', clearLongPress);
    button.addEventListener('pointercancel', clearLongPress);
    button.addEventListener('contextmenu', event => {
        event.preventDefault();
        clearLongPress();
        longPressTriggered = true;
        openGlobalLinkOptionsMenu();
    });
    button.addEventListener('click', event => {
        if (longPressTriggered) {
            event.preventDefault();
            event.stopPropagation();
            longPressTriggered = false;
            return;
        }
        handleGlobalLinkButtonClick().catch(error => {
            console.warn('[Global Link]', error);
            if (
                error?.message
                && error.message !== 'Autorisation annulée.'
                && !isGlobalLinkAbortError(error)
            ) {
                alert(`Global Link : ${error.message}`);
            }
            updateGlobalLinkButton();
        });
    });
}

function initializeGlobalLinkUi() {
    const button = document.getElementById('global-link-layer-button');

    if (!NPF_GLOBAL_LINK_UI_ENABLED) {
        npfGlobalLinkEnabled = false;
        stopGlobalLinkRefreshTimer();
        if (npfGlobalLinkLayer) npfGlobalLinkLayer.clearLayers();
        purgeGlobalLinkDomArtifacts();
        try {
            localStorage.setItem(NPF_GLOBAL_LINK_LAYER_ENABLED_KEY, '0');
        } catch (_) {}
        updateGlobalLinkButton();
        return;
    }
    const modal = document.getElementById('global-link-auth-modal');
    const closeButton = document.getElementById('global-link-auth-close');
    const refreshButton = document.getElementById('global-link-captcha-refresh');
    const submitButton = document.getElementById('global-link-auth-submit');
    const captchaInput = document.getElementById('global-link-captcha-input');

    installGlobalLinkButtonInteractions(button);
    if (closeButton && closeButton.dataset.bound !== '1') {
        closeButton.dataset.bound = '1';
        closeButton.addEventListener('click', closeGlobalLinkAuthModal);
    }
    if (refreshButton && refreshButton.dataset.bound !== '1') {
        refreshButton.dataset.bound = '1';
        refreshButton.addEventListener('click', () => {
            loadGlobalLinkCaptcha().catch(error => {
                if (isGlobalLinkAbortError(error)) {
                    setGlobalLinkAuthStatus('Chargement interrompu. Appuie sur Nouveau code pour réessayer.', 'error');
                    return;
                }
                setGlobalLinkAuthStatus(error.message || String(error), 'error');
            });
        });
    }
    const submit = async () => {
        const originalText = submitButton?.textContent || 'Connexion';
        try {
            if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Connexion…'; }
            await submitGlobalLinkCaptcha();
            setGlobalLinkEnabled(true, { refresh: true, silent: false });
        } catch (error) {
            /*
             * v16.53 — ne plus bloquer le bouton pendant un rechargement
             * automatique de captcha pouvant durer 45 s.
             */
            setGlobalLinkAuthStatus(error.message || String(error), 'error');
        } finally {
            if (submitButton) { submitButton.disabled = false; submitButton.textContent = originalText; }
        }
    };
    if (submitButton && submitButton.dataset.bound !== '1') {
        submitButton.dataset.bound = '1';
        submitButton.addEventListener('click', submit);
    }
    if (captchaInput && captchaInput.dataset.bound !== '1') {
        captchaInput.dataset.bound = '1';
        captchaInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); submit(); }
        });
    }
    if (modal && modal.dataset.bound !== '1') {
        modal.dataset.bound = '1';
        modal.addEventListener('click', event => { if (event.target === modal) closeGlobalLinkAuthModal(); });
    }
    if (!window.__npfGlobalLinkLifecycleBound) {
        window.__npfGlobalLinkLifecycleBound = true;
        window.addEventListener('online', () => {
            if (npfGlobalLinkEnabled && window.__npfStartupCoreReady !== false) refreshGlobalLinkPositions({ silent: true });
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && npfGlobalLinkEnabled && window.__npfStartupCoreReady !== false) {
                refreshGlobalLinkPositions({ silent: true });
            }
        });
        window.addEventListener('keydown', event => {
            if (event.key === 'Escape' && modal?.style.display === 'flex') closeGlobalLinkAuthModal();
        });
    }
    try { npfGlobalLinkEnabled = localStorage.getItem(NPF_GLOBAL_LINK_LAYER_ENABLED_KEY) === '1'; } catch (_) {}
    updateGlobalLinkButton();

    const startStoredGlobalLinkAfterCore = async () => {
        if (!npfGlobalLinkEnabled) return;
        if (!getStoredBriefingDocsSession()) {
            await tryAuthorizeBriefingDocsFromBfgBridge({ silent: true });
        }
        if (!getStoredGlobalLinkSession() || !getStoredBriefingDocsSession()) {
            npfGlobalLinkEnabled = false;
            try { localStorage.setItem(NPF_GLOBAL_LINK_LAYER_ENABLED_KEY, '0'); } catch (_) {}
            updateGlobalLinkButton();
            return;
        }
        startGlobalLinkRefreshTimer();
        setTimeout(() => {
            if (window.__npfStartupCoreReady === true) {
                refreshGlobalLinkPositions({ silent: true });
            }
        }, 250);
    };

    if (npfGlobalLinkEnabled) {
        if (window.__npfStartupCoreReady === true) {
            startStoredGlobalLinkAfterCore();
        } else {
            window.addEventListener(
                'npf-startup-core-ready',
                startStoredGlobalLinkAfterCore,
                { once: true }
            );
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeGlobalLinkUi();
});

window.refreshGlobalLinkPositions = refreshGlobalLinkPositions;
window.setGlobalLinkEnabled = setGlobalLinkEnabled;

