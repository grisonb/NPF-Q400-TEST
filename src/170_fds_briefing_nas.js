// =========================================================================
// v15.13 — FdS / GAAR NAS : lecteur intégré + mise à jour manuelle + stockage hors ligne
// =========================================================================

function initBriefingDocsDB() {
    return new Promise((resolve, reject) => {
        if (npfBriefingDocsDb) {
            resolve(npfBriefingDocsDb);
            return;
        }
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }
        const request = indexedDB.open(NPF_BRIEFING_DOCS_DB_NAME, NPF_BRIEFING_DOCS_DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(NPF_BRIEFING_DOCS_STORE_NAME)) {
                db.createObjectStore(NPF_BRIEFING_DOCS_STORE_NAME, { keyPath: 'type' });
            }
        };
        request.onsuccess = event => {
            npfBriefingDocsDb = event.target.result;
            npfBriefingDocsDb.onversionchange = () => {
                try { npfBriefingDocsDb.close(); } catch (_) {}
                npfBriefingDocsDb = null;
            };
            resolve(npfBriefingDocsDb);
        };
        request.onerror = () => reject(request.error || new Error('Base FDS / GAAR indisponible'));
        request.onblocked = () => reject(new Error('Base FDS / GAAR bloquée par une autre instance'));
    });
}

async function getBriefingDocRecord(type) {
    const safeType = String(type || '').toLowerCase();
    if (!NPF_BRIEFING_DOC_TYPES.includes(safeType)) return null;
    const db = await initBriefingDocsDB();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(NPF_BRIEFING_DOCS_STORE_NAME, 'readonly');
        const request = tx.objectStore(NPF_BRIEFING_DOCS_STORE_NAME).get(safeType);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error(`Lecture ${safeType.toUpperCase()} impossible`));
    });
}

async function putBriefingDocRecord(record) {
    if (!record || !NPF_BRIEFING_DOC_TYPES.includes(record.type)) {
        throw new Error('Document FDS / GAAR invalide');
    }
    const db = await initBriefingDocsDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(NPF_BRIEFING_DOCS_STORE_NAME, 'readwrite');
        tx.objectStore(NPF_BRIEFING_DOCS_STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Enregistrement FDS / GAAR impossible'));
        tx.onabort = () => reject(tx.error || new Error('Enregistrement FDS / GAAR interrompu'));
    });
}

function clearBriefingDocsSession() {
    try {
        localStorage.removeItem(NPF_BRIEFING_DOCS_SESSION_TOKEN_KEY);
        localStorage.removeItem(NPF_BRIEFING_DOCS_SESSION_EXP_KEY);
    } catch (_) {}
}

function getStoredBriefingDocsSession() {
    try {
        const token = String(localStorage.getItem(NPF_BRIEFING_DOCS_SESSION_TOKEN_KEY) || '');
        const exp = Number(localStorage.getItem(NPF_BRIEFING_DOCS_SESSION_EXP_KEY) || 0);
        if (!token || !Number.isFinite(exp) || exp <= Date.now()) {
            clearBriefingDocsSession();
            return null;
        }
        return { token, exp };
    } catch (_) {
        return null;
    }
}

function storeBriefingDocsSession(token, expiresAt) {
    const exp = Date.parse(String(expiresAt || ''));
    if (!token || !Number.isFinite(exp) || exp <= Date.now()) return false;
    try {
        localStorage.setItem(NPF_BRIEFING_DOCS_SESSION_TOKEN_KEY, String(token));
        localStorage.setItem(NPF_BRIEFING_DOCS_SESSION_EXP_KEY, String(exp));
        return true;
    } catch (_) {
        return false;
    }
}

function getStoredNpfBfgBridgeCredentials() {
    try {
        const bridgeId = String(localStorage.getItem(NPF_BFG_BRIDGE_ID_KEY) || '').trim().toLowerCase();
        const deviceSecret = String(localStorage.getItem(NPF_BFG_BRIDGE_DEVICE_SECRET_KEY) || '').trim().toLowerCase();
        if (!/^[a-f0-9]{32}$/.test(bridgeId) || !/^[a-f0-9]{64}$/.test(deviceSecret)) return null;
        return { bridgeId, deviceSecret };
    } catch (_) {
        return null;
    }
}

function updateBriefingDocsBfgPairButton() {
    const button = document.getElementById('briefing-docs-bfg-pair-button');
    if (!button) return;
    const paired = Boolean(getStoredNpfBfgBridgeCredentials());
    button.classList.toggle('paired', paired);
    button.textContent = paired ? 'BFG ✓' : 'BFG';
    const label = paired
        ? 'BFG associé à cet iPad — appuyer pour réassocier'
        : 'Associer BFG à NPF';
    button.title = label;
    button.setAttribute('aria-label', label);
}

function storeNpfBfgBridgeCredentials(bridgeId, deviceSecret) {
    const cleanId = String(bridgeId || '').trim().toLowerCase();
    const cleanSecret = String(deviceSecret || '').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(cleanId) || !/^[a-f0-9]{64}$/.test(cleanSecret)) return false;
    try {
        localStorage.setItem(NPF_BFG_BRIDGE_ID_KEY, cleanId);
        localStorage.setItem(NPF_BFG_BRIDGE_DEVICE_SECRET_KEY, cleanSecret);
        updateBriefingDocsBfgPairButton();
        return true;
    } catch (_) {
        return false;
    }
}

function clearNpfBfgBridgeCredentials() {
    try {
        localStorage.removeItem(NPF_BFG_BRIDGE_ID_KEY);
        localStorage.removeItem(NPF_BFG_BRIDGE_DEVICE_SECRET_KEY);
        updateBriefingDocsBfgPairButton();
    } catch (_) {}
}

async function tryAuthorizeBriefingDocsFromBfgBridge(options = {}) {
    const silent = options.silent !== false;
    const existing = getStoredBriefingDocsSession();
    if (existing) return existing;
    if (!navigator.onLine) return null;

    const credentials = getStoredNpfBfgBridgeCredentials();
    if (!credentials) return null;
    if (npfBfgBridgeAuthorizationPromise) return npfBfgBridgeAuthorizationPromise;

    npfBfgBridgeAuthorizationPromise = (async () => {
        try {
            const response = await fetchBriefingDocsNas(`${NPF_BRIEFING_DOCS_API_URL}?action=bridge-session&t=${Date.now()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentials)
            }, 9000);
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload || payload.ok !== true || !payload.token || !payload.expiresAt) {
                const errorCode = String(payload?.error || '');
                npfBfgBridgeLastError = errorCode || `http_${response.status}`;
                npfBfgBridgeLastStatus = 'refusé';
                /*
                 * v16.53 — ne pas effacer silencieusement l'association BFG.
                 * Une panne/transitoire NAS ne doit plus forcer un nouveau
                 * code à 8 chiffres.
                 */
                if (!silent && errorCode !== 'bridge_not_granted') {
                    console.warn('[BFG -> NPF] Autorisation refusée:', payload?.message || errorCode || response.status);
                }
                return null;
            }
            if (!storeBriefingDocsSession(payload.token, payload.expiresAt)) return null;
            npfBfgBridgeLastError = '';
            npfBfgBridgeLastStatus = 'session-ok';
            console.info('[BFG -> NPF] Session NPF récupérée automatiquement.');
            return getStoredBriefingDocsSession();
        } catch (error) {
            npfBfgBridgeLastError = String(error?.message || error || 'pont_indisponible');
            npfBfgBridgeLastStatus = 'indisponible';
            if (!silent) console.warn('[BFG -> NPF] Pont indisponible:', error);
            return null;
        } finally {
            npfBfgBridgeAuthorizationPromise = null;
        }
    })();

    return npfBfgBridgeAuthorizationPromise;
}

async function claimBfgBridgePairingCode(code) {
    const cleanCode = String(code || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(cleanCode)) throw new Error('Saisis le code BFG à 8 chiffres.');
    if (!navigator.onLine) throw new Error('Connexion Internet requise pour l’association BFG.');

    const response = await fetchBriefingDocsNas(`${NPF_BRIEFING_DOCS_API_URL}?action=bridge-claim&t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cleanCode })
    }, 12000);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true || !payload.bridgeId || !payload.deviceSecret || !payload.token || !payload.expiresAt) {
        throw new Error(payload?.message || payload?.error || `Association BFG refusée (${response.status})`);
    }
    if (!storeNpfBfgBridgeCredentials(payload.bridgeId, payload.deviceSecret)) {
        throw new Error('Association reçue mais impossible à enregistrer sur cet iPad.');
    }
    if (!storeBriefingDocsSession(payload.token, payload.expiresAt)) {
        throw new Error('Association réussie mais session NPF impossible à enregistrer.');
    }
    npfBfgBridgeLastError = '';
    npfBfgBridgeLastStatus = 'associé';
    return getStoredBriefingDocsSession();
}

function formatBriefingDocsDate(value) {
    if (!value) return 'date inconnue';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatBriefingDocsExpiry(exp) {
    const date = new Date(Number(exp || 0));
    if (Number.isNaN(date.getTime())) return 'minuit';
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatBriefingDocsSize(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
    return `${Math.max(1, Math.round(value / 1024))} Ko`;
}

async function fetchBriefingDocsNas(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
        if (response.status === 401) {
            clearBriefingDocsSession();
        }
        return response;
    } finally {
        clearTimeout(timer);
    }
}

function briefingDocsAuthHeaders(session) {
    return session && session.token ? { 'Authorization': `Bearer ${session.token}` } : {};
}

async function authorizeBriefingDocs(password) {
    const cleanPassword = String(password || '');
    if (!cleanPassword) throw new Error('Saisis le mot de passe.');
    if (!navigator.onLine) throw new Error('Connexion Internet requise pour autoriser les téléchargements.');

    const response = await fetchBriefingDocsNas(`${NPF_BRIEFING_DOCS_API_URL}?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: cleanPassword })
    }, 12000);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true || !payload.token || !payload.expiresAt) {
        throw new Error(payload?.message || payload?.error || `Autorisation refusée (${response.status})`);
    }
    if (!storeBriefingDocsSession(payload.token, payload.expiresAt)) {
        throw new Error('Session reçue mais impossible à enregistrer sur cet appareil.');
    }
    return getStoredBriefingDocsSession();
}

function getBriefingDocsRemoteSignature(meta) {
    if (!meta || !meta.exists) return '';
    return [
        String(meta.dateKey || ''),
        String(meta.updatedAt || ''),
        String(meta.revision || meta.fileRevision || ''),
        String(meta.sizeBytes || 0),
        String(meta.originalFilename || meta.filename || '')
    ].join('|');
}

async function downloadBriefingDocFromNas(type, meta, session) {
    const safeType = String(type || '').toLowerCase();
    if (!NPF_BRIEFING_DOC_TYPES.includes(safeType)) throw new Error('Type de document inconnu');
    const url = `${NPF_BRIEFING_DOCS_API_URL}?action=download&type=${encodeURIComponent(safeType)}&t=${Date.now()}`;
    const response = await fetchBriefingDocsNas(url, {
        method: 'GET',
        headers: briefingDocsAuthHeaders(session)
    }, 20000);
    if (!response.ok) {
        let message = `Téléchargement ${safeType.toUpperCase()} impossible (${response.status})`;
        try {
            const payload = await response.clone().json();
            if (payload?.message) message = payload.message;
        } catch (_) {}
        throw new Error(message);
    }
    const blob = await response.blob();
    if (!blob || blob.size < 1000) throw new Error(`${safeType.toUpperCase()} vide ou incomplète`);
    const signature = await blob.slice(0, 5).text().catch(() => '');
    if (signature !== '%PDF-') throw new Error(`${safeType.toUpperCase()} reçue mais le fichier n’est pas un PDF valide`);

    const record = {
        type: safeType,
        blob,
        filename: String(meta?.originalFilename || meta?.filename || `${safeType}.pdf`),
        size: blob.size,
        dateKey: String(meta?.dateKey || ''),
        mailDate: String(meta?.mailDate || ''),
        remoteUpdatedAt: String(meta?.updatedAt || ''),
        remoteSignature: getBriefingDocsRemoteSignature(meta),
        downloadedAt: Date.now()
    };
    await putBriefingDocRecord(record);
    return record;
}

async function syncBriefingDocsFromNas(options = {}) {
    if (npfBriefingDocsSyncInProgress) return false;
    const session = getStoredBriefingDocsSession();
    if (!session) {
        if (!options.silent) throw new Error('Autorisation FDS / GAAR requise.');
        await displayBriefingDocsStatus();
        return false;
    }
    if (!navigator.onLine) {
        if (!options.silent) throw new Error('Mode hors ligne : les documents locaux restent disponibles.');
        await displayBriefingDocsStatus();
        return false;
    }

    npfBriefingDocsSyncInProgress = true;
    try {
        const statusUrl = `${NPF_BRIEFING_DOCS_API_URL}?action=status&t=${Date.now()}`;
        const response = await fetchBriefingDocsNas(statusUrl, {
            method: 'GET',
            headers: briefingDocsAuthHeaders(session)
        }, 12000);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || payload.ok !== true) {
            throw new Error(payload?.message || payload?.error || `Statut NAS indisponible (${response.status})`);
        }

        let downloaded = 0;
        for (const type of NPF_BRIEFING_DOC_TYPES) {
            const meta = payload[type];
            if (!isBriefingDocMetaForToday(meta)) continue;
            const remoteSignature = getBriefingDocsRemoteSignature(meta);
            const localRecord = await getBriefingDocRecord(type).catch(() => null);
            if (localRecord && localRecord.remoteSignature === remoteSignature && localRecord.blob instanceof Blob) {
                continue;
            }
            await downloadBriefingDocFromNas(type, meta, session);
            downloaded += 1;
        }

        try { localStorage.setItem(NPF_BRIEFING_DOCS_LAST_SYNC_KEY, String(Date.now())); } catch (_) {}
        return downloaded;
    } finally {
        npfBriefingDocsSyncInProgress = false;
        await refreshBriefingDocMapButtons().catch(() => {});
    }
}

function getBriefingDocsParisDateKey() {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Paris',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        const values = {};
        parts.forEach(part => {
            if (part.type !== 'literal') values[part.type] = part.value;
        });
        if (values.year && values.month && values.day) {
            return `${values.year}${values.month}${values.day}`;
        }
    } catch (_) {}
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function extractBriefingDocDateKey(value) {
    const text = String(value || '');
    const match = text.match(/(?:^|\D)(20\d{6})(?:\D|$)/);
    return match ? match[1] : '';
}

function getBriefingDocEffectiveDateKey(value) {
    if (!value || typeof value !== 'object') return '';
    /*
     * v15.26 — le nom du PDF est prioritaire : en fin de journée une FdS du
     * lendemain peut être reçue aujourd'hui, donc mailDate / mtime ne prouvent
     * pas que le document concerne la date du jour.
     */
    const filenameDate = extractBriefingDocDateKey(value.originalFilename || value.filename || '');
    if (filenameDate) return filenameDate;
    const declared = String(value.dateKey || '').replace(/\D/g, '');
    return /^20\d{6}$/.test(declared) ? declared : '';
}

function isBriefingDocMetaForToday(meta) {
    return Boolean(meta && meta.exists && getBriefingDocEffectiveDateKey(meta) === getBriefingDocsParisDateKey());
}

function isBriefingDocRecordForToday(record) {
    return Boolean(
        record
        && record.blob instanceof Blob
        && getBriefingDocEffectiveDateKey(record) === getBriefingDocsParisDateKey()
    );
}

function getBriefingDocMapButton(type) {
    return document.getElementById(
        String(type || '').toLowerCase() === 'gaar'
            ? 'briefing-gaar-map-button'
            : 'briefing-fds-map-button'
    );
}

function closeBriefingDocSelectorModal() {
    const modal = document.getElementById('briefing-doc-selector-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function openBriefingDocSelectorModal() {
    const modal = document.getElementById('briefing-doc-selector-modal');
    if (!modal) return false;
    refreshBriefingDocMapButtons().catch(() => {});
    updateBriefingDocsBfgPairButton();
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    return true;
}

function updateBriefingDocsMainButtonState(fdsRecord, gaarRecord) {
    const mainButton = document.getElementById('briefing-docs-map-button');
    const fdsLine = document.getElementById('briefing-docs-main-fds-label');
    const gaarLine = document.getElementById('briefing-docs-main-gaar-label');
    const fdsLoaded = isBriefingDocRecordForToday(fdsRecord);
    const gaarLoaded = isBriefingDocRecordForToday(gaarRecord);

    const updateLine = (element, loaded) => {
        if (!element) return;
        element.classList.toggle('briefing-doc-loaded', loaded);
        element.classList.toggle('briefing-doc-missing', !loaded);
    };
    updateLine(fdsLine, fdsLoaded);
    updateLine(gaarLine, gaarLoaded);

    if (!mainButton) return;
    const anyLoaded = fdsLoaded || gaarLoaded;
    mainButton.classList.toggle('briefing-docs-any-loaded', anyLoaded);
    mainButton.classList.toggle('briefing-docs-none-loaded', !anyLoaded);
    mainButton.classList.toggle('loading', npfBriefingDocsSyncInProgress);
    mainButton.setAttribute('aria-busy', npfBriefingDocsSyncInProgress ? 'true' : 'false');
    const fdsState = fdsLoaded ? 'FdS chargée' : 'FdS non chargée';
    const gaarState = gaarLoaded ? 'GAAR chargé' : 'GAAR non chargé';
    const stateText = `${fdsState} — ${gaarState} — appuyer pour choisir`;
    mainButton.title = stateText;
    mainButton.setAttribute('aria-label', stateText);
}

async function refreshBriefingDocMapButtons() {
    const [fds, gaar] = await Promise.all([
        getBriefingDocRecord('fds').catch(() => null),
        getBriefingDocRecord('gaar').catch(() => null)
    ]);

    const update = (type, record) => {
        const button = getBriefingDocMapButton(type);
        if (!button) return;
        const current = isBriefingDocRecordForToday(record);
        const label = type === 'gaar' ? 'GAAR' : 'FdS';
        button.classList.toggle('briefing-doc-loaded', current);
        button.classList.toggle('briefing-doc-missing', !current);
        button.classList.toggle('loading', npfBriefingDocsSyncInProgress);
        button.setAttribute('aria-busy', npfBriefingDocsSyncInProgress ? 'true' : 'false');
        const stateText = current
            ? `${label} du jour charg${type === 'gaar' ? 'é' : 'ée'} — appuyer pour ouvrir`
            : `${label} du jour non télécharg${type === 'gaar' ? 'é' : 'ée'} — appuyer pour télécharger`;
        button.title = stateText;
        button.setAttribute('aria-label', stateText);
        const selectorStatus = document.getElementById(`briefing-${type}-selector-status`);
        if (selectorStatus) {
            selectorStatus.textContent = current
                ? (type === 'gaar' ? 'Chargé aujourd’hui' : 'Chargée aujourd’hui')
                : (type === 'gaar' ? 'Non téléchargé' : 'Non téléchargée');
        }
    };

    update('fds', fds);
    update('gaar', gaar);
    updateBriefingDocsMainButtonState(fds, gaar);
    return { fds, gaar };
}

function closeBriefingDocsPasswordModal() {
    const modal = document.getElementById('briefing-docs-password-modal');
    const input = document.getElementById('briefing-docs-password-input');
    const bfgCodeInput = document.getElementById('briefing-docs-bfg-code-input');
    const status = document.getElementById('briefing-docs-password-status');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    if (input) input.value = '';
    if (bfgCodeInput) bfgCodeInput.value = '';
    if (status) status.textContent = '';
    npfBriefingDocsPendingType = null;
    npfBriefingDocsBfgPairingOnly = false;
}

function getBriefingDocsBfgAuthorizationUnavailableMessage() {
    return 'BFG est associé à cet iPad mais l’autorisation FdS/GAAR n’est pas disponible. Ouvre ou actualise BFG puis réessaie. Aucun mot de passe NPF n’est demandé tant que BFG est associé.';
}

function openBriefingDocsPasswordModal(type) {
    const safeType = String(type || '').toLowerCase();
    // v17.29 — 'notams' : même fenêtre pour le bouton « Rafraîchir les NOTAM ».
    if (!NPF_BRIEFING_DOC_TYPES.includes(safeType) && safeType !== 'notams') return false;

    /* v16.63 — un iPad associé à BFG ne doit jamais retomber sur le mot de
     * passe NPF. Ce garde-fou couvre aussi un éventuel ancien appel résiduel. */
    if (getStoredNpfBfgBridgeCredentials()) {
        alert(getBriefingDocsBfgAuthorizationUnavailableMessage());
        return false;
    }

    const modal = document.getElementById('briefing-docs-password-modal');
    const title = document.getElementById('briefing-docs-password-title');
    const help = document.getElementById('briefing-docs-password-help');
    const input = document.getElementById('briefing-docs-password-input');
    const bfgCodeInput = document.getElementById('briefing-docs-bfg-code-input');
    const authorizeButton = document.getElementById('briefing-docs-authorize-button');
    const bfgCodeButton = document.getElementById('briefing-docs-bfg-code-button');
    const passwordFallbackButton = document.getElementById('briefing-docs-password-fallback-button');
    const separator = modal?.querySelector('.briefing-docs-bfg-pairing-separator');
    const status = document.getElementById('briefing-docs-password-status');
    if (!modal) return false;

    npfBriefingDocsBfgPairingOnly = false;
    npfBriefingDocsPendingType = safeType;
    const label = safeType === 'gaar' ? 'GAAR' : (safeType === 'notams' ? 'NOTAM' : 'FdS');
    if (title) title.textContent = `Accès ${label}`;
    if (help) help.textContent = `Utilise le mot de passe NPF. Pour associer BFG à cet iPad, ferme cette fenêtre puis utilise le bouton BFG dédié.`;
    if (input) { input.value = ''; input.style.display = ''; }
    if (authorizeButton) authorizeButton.style.display = '';
    if (separator) separator.style.display = 'none';
    if (bfgCodeInput) { bfgCodeInput.value = ''; bfgCodeInput.style.display = 'none'; }
    /* v16.63 — correction des deux boutons collés : le bouton d'association
     * BFG restait visible dans la fenêtre mot de passe alors que son champ
     * était masqué. */
    if (bfgCodeButton) bfgCodeButton.style.display = 'none';
    if (passwordFallbackButton) passwordFallbackButton.style.display = 'none';
    if (status) status.textContent = '';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        try { input?.focus({ preventScroll: true }); } catch (_) { try { input?.focus(); } catch (_) {} }
    }, 60);
    return true;
}

function openBriefingDocsBfgPairingModal(targetType = null) {
    const modal = document.getElementById('briefing-docs-password-modal');
    const title = document.getElementById('briefing-docs-password-title');
    const help = document.getElementById('briefing-docs-password-help');
    const input = document.getElementById('briefing-docs-password-input');
    const authorizeButton = document.getElementById('briefing-docs-authorize-button');
    const separator = modal?.querySelector('.briefing-docs-bfg-pairing-separator');
    const bfgCodeInput = document.getElementById('briefing-docs-bfg-code-input');
    const bfgCodeButton = document.getElementById('briefing-docs-bfg-code-button');
    const passwordFallbackButton = document.getElementById('briefing-docs-password-fallback-button');
    const status = document.getElementById('briefing-docs-password-status');
    if (!modal) return false;

    const safeTargetType = NPF_BRIEFING_DOC_TYPES.includes(String(targetType || '').toLowerCase())
        ? String(targetType).toLowerCase()
        : null;
    npfBriefingDocsBfgPairingOnly = !safeTargetType;
    npfBriefingDocsPendingType = safeTargetType;
    if (title) title.textContent = safeTargetType
        ? `Association BFG ↔ NPF — ${getBriefingDocLabel(safeTargetType)}`
        : 'Association BFG ↔ NPF';
    if (help) help.textContent = safeTargetType
        ? `BFG n’est pas encore associé à NPF sur cet iPad. Saisis le code à 8 chiffres affiché dans BFG ; cette association n’est nécessaire qu’une seule fois.`
        : 'Saisis le code à 8 chiffres affiché dans BFG. Cette association n’est nécessaire qu’une seule fois sur cet iPad.';
    if (input) { input.value = ''; input.style.display = 'none'; }
    if (authorizeButton) authorizeButton.style.display = 'none';
    if (separator) separator.style.display = 'none';
    if (bfgCodeInput) { bfgCodeInput.value = ''; bfgCodeInput.style.display = ''; }
    if (bfgCodeButton) bfgCodeButton.style.display = '';
    if (passwordFallbackButton) passwordFallbackButton.style.display = safeTargetType ? '' : 'none';
    if (status) status.textContent = getStoredNpfBfgBridgeCredentials()
        ? 'BFG est déjà associé. Un nouveau code permet de refaire l’association.'
        : '';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        try { bfgCodeInput?.focus({ preventScroll: true }); } catch (_) { try { bfgCodeInput?.focus(); } catch (_) {} }
    }, 60);
    return true;
}

function getBriefingDocLabel(type) {
    return String(type || '').toLowerCase() === 'gaar' ? 'GAAR' : 'FdS';
}

function setBriefingDocViewerStatus(message = '', options = {}) {
    const status = document.getElementById('briefing-doc-viewer-status');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('visible', Boolean(message));
    status.classList.toggle('success', Boolean(options.success));
    status.classList.toggle('error', Boolean(options.error));
}

function revokeBriefingDocViewerObjectUrl() {
    if (!npfBriefingDocViewerObjectUrl) return;
    try { URL.revokeObjectURL(npfBriefingDocViewerObjectUrl); } catch (_) {}
    npfBriefingDocViewerObjectUrl = null;
}

function closeBriefingDocViewer() {
    const modal = document.getElementById('briefing-doc-viewer-modal');
    const frame = document.getElementById('briefing-doc-viewer-frame');
    if (frame) frame.src = 'about:blank';
    revokeBriefingDocViewerObjectUrl();
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('briefing-doc-viewer-fds-width');
        modal.classList.remove('briefing-doc-viewer-gaar-zoom');
    }
    npfBriefingDocViewerType = null;
    setBriefingDocViewerStatus('');
}

async function displayBriefingDocInViewer(type, record, options = {}) {
    const safeType = String(type || '').toLowerCase();
    if (!NPF_BRIEFING_DOC_TYPES.includes(safeType)) return false;
    if (!isBriefingDocRecordForToday(record)) {
        alert(`Aucune ${getBriefingDocLabel(safeType)} du jour enregistrée sur cet appareil.`);
        return false;
    }

    const modal = document.getElementById('briefing-doc-viewer-modal');
    const frame = document.getElementById('briefing-doc-viewer-frame');
    const title = document.getElementById('briefing-doc-viewer-title');
    const meta = document.getElementById('briefing-doc-viewer-meta');
    if (!modal || !frame) throw new Error('Lecteur PDF FdS / GAAR indisponible.');

    revokeBriefingDocViewerObjectUrl();
    npfBriefingDocViewerObjectUrl = URL.createObjectURL(record.blob);
    npfBriefingDocViewerType = safeType;

    const label = getBriefingDocLabel(safeType);
    if (title) title.textContent = label;
    if (meta) {
        const pieces = [];
        if (record.filename) pieces.push(record.filename);
        if (record.mailDate) pieces.push(`mail ${formatBriefingDocsDate(record.mailDate)}`);
        else if (record.remoteUpdatedAt) pieces.push(`MAJ ${formatBriefingDocsDate(record.remoteUpdatedAt)}`);
        meta.textContent = pieces.join(' · ');
    }

    frame.title = `${label} du jour`;
    // v15.16 : Safari/iPad ignore fréquemment les fragments FitH/page-width.
    // La FdS est donc grossie réellement par CSS dans le stage du lecteur ;
    // le fragment reste seulement une indication supplémentaire au moteur PDF.
    modal.classList.toggle('briefing-doc-viewer-fds-width', safeType === 'fds');
    // v15.75 — le diagramme GAAR est grossi indépendamment de la FdS.
    modal.classList.toggle('briefing-doc-viewer-gaar-zoom', safeType === 'gaar');
    frame.src = `${npfBriefingDocViewerObjectUrl}#page=1&view=FitH&zoom=page-width&pagemode=none`;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    if (!options.keepStatus) setBriefingDocViewerStatus('');
    return true;
}

async function openBriefingDoc(type) {
    const safeType = String(type || '').toLowerCase();
    if (!NPF_BRIEFING_DOC_TYPES.includes(safeType)) return false;
    try {
        const record = await getBriefingDocRecord(safeType);
        return await displayBriefingDocInViewer(safeType, record);
    } catch (error) {
        alert(`Ouverture ${getBriefingDocLabel(safeType)} impossible : ${error.message || error}`);
        return false;
    }
}

async function fetchBriefingDocsStatusPayload(session) {
    const statusUrl = `${NPF_BRIEFING_DOCS_API_URL}?action=status&t=${Date.now()}`;
    const response = await fetchBriefingDocsNas(statusUrl, {
        method: 'GET',
        headers: briefingDocsAuthHeaders(session)
    }, 12000);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true) {
        throw new Error(payload?.message || payload?.error || `Statut NAS indisponible (${response.status})`);
    }
    return payload;
}

function getBriefingDocSourceRefreshUrl(type) {
    const safeType = String(type || '').toLowerCase();
    const stamp = encodeURIComponent(Date.now());
    if (safeType === 'fds') {
        // Même URL / même mode de déclenchement que BFG : navigation iframe opaque.
        return `${NPF_FDS_GMAIL_REFRESH_URL}?source=npf-v15.16&t=${stamp}`;
    }
    if (safeType === 'gaar') {
        // BFG utilise déjà ce relais NAS pour déclencher l'Apps Script GAAR.
        return `${NPF_GAAR_IMPORT_REQUEST_URL}?source=npf-v15.16&t=${stamp}`;
    }
    return '';
}

function triggerBriefingDocSourceRefreshInBackground(type) {
    const safeType = String(type || '').toLowerCase();
    const url = getBriefingDocSourceRefreshUrl(safeType);
    if (!url) return Promise.reject(new Error('Type de document inconnu'));

    return new Promise((resolve, reject) => {
        try {
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.left = '-20px';
            iframe.style.top = '-20px';
            iframe.style.width = '1px';
            iframe.style.height = '1px';
            iframe.style.border = '0';
            iframe.style.opacity = '0';
            iframe.style.pointerEvents = 'none';
            iframe.setAttribute('aria-hidden', 'true');
            iframe.tabIndex = -1;
            iframe.src = url;
            (document.body || document.documentElement).appendChild(iframe);

            // Comme BFG : on considère la demande lancée rapidement, mais on laisse
            // l'iframe vivre assez longtemps pour que Gmail -> NAS se termine.
            setTimeout(() => resolve(true), 1000);
            setTimeout(() => {
                try { iframe.remove(); } catch (_) {}
            }, 120000);
        } catch (error) {
            reject(error);
        }
    });
}

function waitBriefingDocsMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForBriefingDocSourceRefresh(type, session, previousSignature) {
    const safeType = String(type || '').toLowerCase();
    const maxAttempts = 45; // environ 90 secondes, comme l'attente robuste BFG
    const retrySourceAttempts = new Set([8, 20, 32]);
    let lastPayload = null;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await waitBriefingDocsMs(attempt === 0 ? 2500 : 2000);

        if (retrySourceAttempts.has(attempt)) {
            setBriefingDocViewerStatus(
                `Toujours en attente du NAS — relance ${getBriefingDocLabel(safeType)}…`
            );
            await triggerBriefingDocSourceRefreshInBackground(safeType).catch(() => {});
        }

        try {
            lastPayload = await fetchBriefingDocsStatusPayload(session);
            const meta = lastPayload?.[safeType];
            const signature = getBriefingDocsRemoteSignature(meta);
            if (!previousSignature || (signature && signature !== previousSignature)) {
                return { payload: lastPayload, changedOnNas: true };
            }
            setBriefingDocViewerStatus(
                `Mise à jour ${getBriefingDocLabel(safeType)} en cours…`
            );
        } catch (error) {
            lastError = error;
            setBriefingDocViewerStatus(
                `NAS temporairement indisponible — nouvelle tentative en cours…`,
                { error: false }
            );
        }
    }

    if (lastPayload) return { payload: lastPayload, changedOnNas: false };
    throw lastError || new Error('Statut FdS / GAAR indisponible après attente.');
}

async function refreshSingleBriefingDocFromNas(type, options = {}) {
    const safeType = String(type || '').toLowerCase();
    if (!NPF_BRIEFING_DOC_TYPES.includes(safeType)) throw new Error('Type de document inconnu');
    if (npfBriefingDocsSyncInProgress) throw new Error('Une mise à jour FdS / GAAR est déjà en cours.');

    const session = getStoredBriefingDocsSession();
    if (!session) throw new Error('Autorisation FDS / GAAR requise.');
    if (!navigator.onLine) throw new Error('Mode hors ligne : le document local reste disponible.');

    npfBriefingDocsSyncInProgress = true;
    await refreshBriefingDocMapButtons().catch(() => {});
    try {
        let payload;
        if (options.sourceRefresh === true) {
            // v15.16 : reproduire le fonctionnement BFG côté navigateur.
            // On relève d'abord la révision NAS, on déclenche la source dans un
            // iframe invisible, puis on attend que le NAS expose la nouvelle révision.
            const beforePayload = await fetchBriefingDocsStatusPayload(session);
            const beforeMeta = beforePayload?.[safeType];
            const beforeSignature = getBriefingDocsRemoteSignature(beforeMeta);
            await triggerBriefingDocSourceRefreshInBackground(safeType);
            const waitResult = await waitForBriefingDocSourceRefresh(safeType, session, beforeSignature);
            payload = waitResult.payload;
        } else {
            payload = await fetchBriefingDocsStatusPayload(session);
        }
        const meta = payload[safeType];
        if (!isBriefingDocMetaForToday(meta)) {
            throw new Error(`Aucune ${getBriefingDocLabel(safeType)} de la date du jour disponible sur le NAS.`);
        }

        const remoteSignature = getBriefingDocsRemoteSignature(meta);
        const localRecord = await getBriefingDocRecord(safeType).catch(() => null);
        const localIsCurrent = isBriefingDocRecordForToday(localRecord);
        const same = Boolean(
            localIsCurrent
            && localRecord?.blob instanceof Blob
            && localRecord.remoteSignature === remoteSignature
        );

        let record = localRecord;
        const changed = !same;
        let downloaded = false;
        if (!same || options.force === true) {
            // v15.14 : un appui explicite sur « Maj » doit réellement relire le PDF
            // courant du NAS, même si une métadonnée distante n'a pas changé.
            record = await downloadBriefingDocFromNas(safeType, meta, session);
            downloaded = true;
        }

        try { localStorage.setItem(NPF_BRIEFING_DOCS_LAST_SYNC_KEY, String(Date.now())); } catch (_) {}
        return { changed, downloaded, record, meta };
    } finally {
        npfBriefingDocsSyncInProgress = false;
        await refreshBriefingDocMapButtons().catch(() => {});
    }
}

async function ensureBriefingDocsInteractiveAuthorization(type, options = {}) {
    if (getStoredBriefingDocsSession()) return true;

    const paired = Boolean(getStoredNpfBfgBridgeCredentials());
    if (paired) {
        await tryAuthorizeBriefingDocsFromBfgBridge({ silent: true });
        if (getStoredBriefingDocsSession()) return true;
        const message = getBriefingDocsBfgAuthorizationUnavailableMessage();
        if (options.viewer === true) setBriefingDocViewerStatus(message, { error: true });
        else alert(message);
        return false;
    }

    /* v16.64 — FdS/GAAR privilégie BFG : si cet iPad n'est pas encore
     * associé, ouvrir directement l'association BFG plutôt que demander
     * immédiatement le mot de passe NPF. Le mot de passe reste disponible
     * comme secours depuis cette fenêtre. */
    openBriefingDocsBfgPairingModal(type);
    return false;
}

async function handleBriefingDocMapButtonClick(type) {
    const safeType = String(type || '').toLowerCase();
    if (!NPF_BRIEFING_DOC_TYPES.includes(safeType)) return false;

    /* v16.63 — une FdS/GAAR du jour déjà stockée est consultable immédiatement,
     * sans autorisation réseau. L'autorisation ne sert qu'à télécharger/mettre à jour. */
    const localRecord = await getBriefingDocRecord(safeType).catch(() => null);
    if (isBriefingDocRecordForToday(localRecord)) {
        return await displayBriefingDocInViewer(safeType, localRecord);
    }

    if (!navigator.onLine) {
        alert(`${getBriefingDocLabel(safeType)} du jour non téléchargée. Une connexion Internet est nécessaire pour la récupérer.`);
        return false;
    }

    if (!await ensureBriefingDocsInteractiveAuthorization(safeType)) return false;

    try {
        const result = await refreshSingleBriefingDocFromNas(safeType);
        if (!isBriefingDocRecordForToday(result.record)) {
            alert(`Aucune ${getBriefingDocLabel(safeType)} du jour disponible sur le NAS.`);
            return false;
        }
        return await displayBriefingDocInViewer(safeType, result.record);
    } catch (error) {
        alert(`${getBriefingDocLabel(safeType)} : ${error.message || error}`);
        await refreshBriefingDocMapButtons();
        return false;
    }
}

async function displayBriefingDocsStatus() {
    return await refreshBriefingDocMapButtons();
}

function initializeBriefingDocsUi() {
    const mainButton = document.getElementById('briefing-docs-map-button');
    const selectorModal = document.getElementById('briefing-doc-selector-modal');
    const selectorCloseButton = document.getElementById('close-briefing-doc-selector-modal');
    const fdsButton = document.getElementById('briefing-fds-map-button');
    const gaarButton = document.getElementById('briefing-gaar-map-button');
    const bfgPairButton = document.getElementById('briefing-docs-bfg-pair-button');
    const modal = document.getElementById('briefing-docs-password-modal');
    const closeButton = document.getElementById('briefing-docs-password-close');
    const passwordInput = document.getElementById('briefing-docs-password-input');
    const authorizeButton = document.getElementById('briefing-docs-authorize-button');
    const bfgCodeInput = document.getElementById('briefing-docs-bfg-code-input');
    const bfgCodeButton = document.getElementById('briefing-docs-bfg-code-button');
    const passwordFallbackButton = document.getElementById('briefing-docs-password-fallback-button');
    const passwordStatus = document.getElementById('briefing-docs-password-status');
    const viewerCloseButton = document.getElementById('briefing-doc-viewer-close');
    const viewerRefreshButton = document.getElementById('briefing-doc-viewer-refresh');

    const bindDocButton = (button, type) => {
        if (!button || button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', () => {
            closeBriefingDocSelectorModal();
            handleBriefingDocMapButtonClick(type).catch(error => {
                alert(`${getBriefingDocLabel(type)} : ${error.message || error}`);
            });
        });
    };

    if (mainButton && mainButton.dataset.bound !== '1') {
        mainButton.dataset.bound = '1';
        mainButton.addEventListener('click', openBriefingDocSelectorModal);
    }
    if (selectorCloseButton && selectorCloseButton.dataset.bound !== '1') {
        selectorCloseButton.dataset.bound = '1';
        selectorCloseButton.addEventListener('click', closeBriefingDocSelectorModal);
    }
    if (selectorModal && selectorModal.dataset.bound !== '1') {
        selectorModal.dataset.bound = '1';
        selectorModal.addEventListener('click', event => {
            if (event.target === selectorModal) closeBriefingDocSelectorModal();
        });
    }

    bindDocButton(fdsButton, 'fds');
    bindDocButton(gaarButton, 'gaar');

    if (bfgPairButton && bfgPairButton.dataset.bound !== '1') {
        bfgPairButton.dataset.bound = '1';
        bfgPairButton.addEventListener('click', () => {
            closeBriefingDocSelectorModal();
            openBriefingDocsBfgPairingModal();
        });
    }
    updateBriefingDocsBfgPairButton();

    if (viewerCloseButton && viewerCloseButton.dataset.bound !== '1') {
        viewerCloseButton.dataset.bound = '1';
        viewerCloseButton.addEventListener('click', closeBriefingDocViewer);
    }
    if (viewerRefreshButton && viewerRefreshButton.dataset.bound !== '1') {
        viewerRefreshButton.dataset.bound = '1';
        viewerRefreshButton.addEventListener('click', async () => {
            const type = npfBriefingDocViewerType;
            if (!type) return;

            if (!await ensureBriefingDocsInteractiveAuthorization(type, { viewer: true })) return;
            if (!navigator.onLine) {
                setBriefingDocViewerStatus('Hors ligne : impossible de vérifier une mise à jour.', { error: true });
                return;
            }

            const originalText = viewerRefreshButton.textContent || 'Maj';
            try {
                viewerRefreshButton.disabled = true;
                viewerRefreshButton.textContent = 'Maj…';
                setBriefingDocViewerStatus(`Recherche de la dernière ${getBriefingDocLabel(type)} dans Gmail…`);
                const result = await refreshSingleBriefingDocFromNas(type, { force: true, sourceRefresh: true });
                await displayBriefingDocInViewer(type, result.record, { keepStatus: true });
                setBriefingDocViewerStatus(
                    result.changed ? 'Nouvelle version téléchargée.' : 'Document rechargé depuis le NAS.',
                    { success: true }
                );
            } catch (error) {
                if (!getStoredBriefingDocsSession() && getStoredNpfBfgBridgeCredentials()) {
                    setBriefingDocViewerStatus(getBriefingDocsBfgAuthorizationUnavailableMessage(), { error: true });
                } else if (!getStoredBriefingDocsSession()) {
                    openBriefingDocsPasswordModal(type);
                    setBriefingDocViewerStatus('Autorisation expirée : saisis à nouveau le mot de passe NPF.', { error: true });
                } else {
                    setBriefingDocViewerStatus(error.message || String(error), { error: true });
                }
            } finally {
                viewerRefreshButton.disabled = false;
                viewerRefreshButton.textContent = originalText;
            }
        });
    }

    if (passwordFallbackButton && passwordFallbackButton.dataset.bound !== '1') {
        passwordFallbackButton.dataset.bound = '1';
        passwordFallbackButton.addEventListener('click', () => {
            const targetType = npfBriefingDocsPendingType || 'fds';
            openBriefingDocsPasswordModal(targetType);
        });
    }

    const closeModal = () => closeBriefingDocsPasswordModal();
    if (closeButton && closeButton.dataset.bound !== '1') {
        closeButton.dataset.bound = '1';
        closeButton.addEventListener('click', closeModal);
    }
    if (modal && modal.dataset.bound !== '1') {
        modal.dataset.bound = '1';
        modal.addEventListener('click', event => {
            if (event.target === modal) closeModal();
        });
    }

    const authorizeWithBfgPairingCode = async () => {
        const pairingOnly = npfBriefingDocsBfgPairingOnly;
        const targetType = npfBriefingDocsPendingType || 'fds';
        const code = String(bfgCodeInput?.value || '').replace(/\D/g, '');
        if (!/^\d{8}$/.test(code)) {
            if (passwordStatus) passwordStatus.textContent = 'Saisis le code BFG à 8 chiffres affiché dans BFG.';
            try { bfgCodeInput?.focus(); } catch (_) {}
            return;
        }

        const originalText = bfgCodeButton?.textContent || 'Associer avec le code BFG';
        try {
            if (bfgCodeButton) {
                bfgCodeButton.disabled = true;
                bfgCodeButton.textContent = 'Association…';
            }
            if (authorizeButton) authorizeButton.disabled = true;
            if (passwordStatus) passwordStatus.textContent = 'Association BFG / NPF en cours…';
            await claimBfgBridgePairingCode(code);
            updateBriefingDocsBfgPairButton();
            if (pairingOnly) {
                if (passwordStatus) passwordStatus.textContent = 'Association BFG / NPF réussie.';
                closeBriefingDocsPasswordModal();
                openBriefingDocSelectorModal();
                return;
            }
            if (passwordStatus) passwordStatus.textContent = `Association réussie. Téléchargement ${getBriefingDocLabel(targetType)} du jour…`;

            const result = await refreshSingleBriefingDocFromNas(targetType);
            if (!isBriefingDocRecordForToday(result.record)) {
                if (passwordStatus) passwordStatus.textContent = `${getBriefingDocLabel(targetType)} du jour non disponible sur le NAS.`;
                return;
            }
            closeBriefingDocsPasswordModal();
            await displayBriefingDocInViewer(targetType, result.record);
        } catch (error) {
            if (passwordStatus) passwordStatus.textContent = error?.message || String(error);
            await refreshBriefingDocMapButtons();
        } finally {
            if (bfgCodeButton) {
                bfgCodeButton.disabled = false;
                bfgCodeButton.textContent = originalText;
            }
            if (authorizeButton) authorizeButton.disabled = false;
        }
    };

    const authorizePending = async () => {
        const targetType = npfBriefingDocsPendingType || 'fds';
        const password = passwordInput?.value || '';
        if (!password) {
            if (passwordStatus) passwordStatus.textContent = 'Saisis le mot de passe.';
            try { passwordInput?.focus(); } catch (_) {}
            return;
        }

        const originalText = authorizeButton?.textContent || 'Autoriser jusqu’à minuit';
        try {
            if (authorizeButton) {
                authorizeButton.disabled = true;
                authorizeButton.textContent = 'Autorisation…';
            }
            if (passwordStatus) passwordStatus.textContent = 'Vérification du mot de passe…';
            await authorizeBriefingDocs(password);
            if (targetType === 'notams') {
                // v17.29 — aucun document FdS / GAAR : on relance le rafraîchissement NOTAM.
                closeBriefingDocsPasswordModal();
                refreshNpfNotamsFromNasManually().catch(error => console.warn('[NPF NOTAMS] Rafraîchissement impossible:', error));
                return;
            }
            if (passwordStatus) passwordStatus.textContent = `Téléchargement ${getBriefingDocLabel(targetType)} du jour…`;

            const result = await refreshSingleBriefingDocFromNas(targetType);
            if (!isBriefingDocRecordForToday(result.record)) {
                if (passwordStatus) passwordStatus.textContent = `${getBriefingDocLabel(targetType)} du jour non disponible sur le NAS.`;
                return;
            }

            closeBriefingDocsPasswordModal();
            await displayBriefingDocInViewer(targetType, result.record);
        } catch (error) {
            if (passwordStatus) passwordStatus.textContent = error.message || String(error);
            await refreshBriefingDocMapButtons();
        } finally {
            if (authorizeButton) {
                authorizeButton.disabled = false;
                authorizeButton.textContent = originalText;
            }
        }
    };

    if (authorizeButton && authorizeButton.dataset.bound !== '1') {
        authorizeButton.dataset.bound = '1';
        authorizeButton.addEventListener('click', authorizePending);
    }
    if (passwordInput && passwordInput.dataset.bound !== '1') {
        passwordInput.dataset.bound = '1';
        passwordInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                authorizePending();
            }
        });
    }

    if (bfgCodeButton && bfgCodeButton.dataset.bound !== '1') {
        bfgCodeButton.dataset.bound = '1';
        bfgCodeButton.addEventListener('click', authorizeWithBfgPairingCode);
    }
    if (bfgCodeInput && bfgCodeInput.dataset.bound !== '1') {
        bfgCodeInput.dataset.bound = '1';
        bfgCodeInput.addEventListener('input', () => {
            bfgCodeInput.value = String(bfgCodeInput.value || '').replace(/\D/g, '').slice(0, 8);
        });
        bfgCodeInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                authorizeWithBfgPairingCode();
            }
        });
    }

    if (!window.__npfBriefingDocsEscapeBound) {
        window.__npfBriefingDocsEscapeBound = true;
        window.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            if (selectorModal?.style.display === 'flex') {
                closeBriefingDocSelectorModal();
                return;
            }
            if (modal?.style.display === 'flex') {
                closeModal();
                return;
            }
            const viewer = document.getElementById('briefing-doc-viewer-modal');
            if (viewer?.style.display === 'flex') closeBriefingDocViewer();
        });
    }

    refreshBriefingDocMapButtons().catch(() => {});
}

window.openBriefingDoc = openBriefingDoc;
window.displayBriefingDocsStatus = displayBriefingDocsStatus;
window.refreshBriefingDocMapButtons = refreshBriefingDocMapButtons;
window.syncBriefingDocsFromNas = syncBriefingDocsFromNas;
window.refreshSingleBriefingDocFromNas = refreshSingleBriefingDocFromNas;
window.closeBriefingDocViewer = closeBriefingDocViewer;
window.openBriefingDocSelectorModal = openBriefingDocSelectorModal;
window.closeBriefingDocSelectorModal = closeBriefingDocSelectorModal;



