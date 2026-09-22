/* =========================================================================
   v14.93 — Cartes VAC SIA hors ligne via GitHub Pages / IndexedDB
   ========================================================================= */

function initVacDB() {
    return new Promise((resolve, reject) => {
        if (vacDb) {
            resolve(vacDb);
            return;
        }
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }

        const request = indexedDB.open(VAC_DB_NAME, VAC_DB_VERSION);
        request.onupgradeneeded = event => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains(VAC_STORE_NAME)) {
                dbInstance.createObjectStore(VAC_STORE_NAME, { keyPath: 'oaci' });
            }
        };
        request.onsuccess = event => {
            vacDb = event.target.result;
            vacDb.onversionchange = () => {
                try { vacDb.close(); } catch (_) {}
                vacDb = null;
            };
            resolve(vacDb);
        };
        request.onerror = event => {
            reject(event.target.error || new Error('Ouverture base VAC impossible'));
        };
        request.onblocked = () => {
            reject(new Error("Base VAC bloquée par une autre instance de l'application"));
        };
    });
}

function normalizeVacOaci(oaci) {
    return String(oaci || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/*
 * v16.50 — périmètre VAC attendu : tous les aérodromes OACI réellement
 * affichés par NPF, et non plus seulement les terrains PÉLIC/sélectionnables.
 * La référence PIAF embarquée contient la liste la plus large de la carte.
 */
function getNpfDisplayedAirportOaciSetForVac() {
    const codes = new Set();
    const append = airport => {
        const oaci = normalizeVacOaci(airport?.oaci);
        if (/^LF[A-Z0-9]{2}$/.test(oaci)) codes.add(oaci);
    };
    try { (pelicanAirports || []).forEach(append); } catch (_) {}
    try { (otherAirports || []).forEach(append); } catch (_) {}
    try { (piafMetropolitanAerodromes || []).forEach(append); } catch (_) {}
    return codes;
}

function getNpfDisplayedAirportOaciCountForVac() {
    return getNpfDisplayedAirportOaciSetForVac().size;
}

function formatVacBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0 Mo';
    if (value < 1024 * 1024) {
        return `${Math.max(1, Math.round(value / 1024))} ko`;
    }
    return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

function persistVacManifestSummary(manifest) {
    try {
        const airportEntries = Object.values(manifest?.airports || {}).filter(Boolean);
        const availableEntries = airportEntries
            .filter(entry => entry && entry.available && entry.file);
        const expected = Number(manifest?.stats?.availableVac) || availableEntries.length;
        const remoteAirportCount = airportEntries.length;
        const remoteUnavailableCount = Number(manifest?.stats?.unavailableVac)
            || Math.max(0, remoteAirportCount - expected);
        const totalSize = Number(manifest?.stats?.totalSizeBytes)
            || availableEntries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);

        localStorage.setItem(VAC_EXPECTED_COUNT_KEY, String(expected));
        localStorage.setItem(VAC_REMOTE_AIRPORT_COUNT_KEY, String(remoteAirportCount));
        localStorage.setItem(VAC_REMOTE_UNAVAILABLE_COUNT_KEY, String(remoteUnavailableCount));
        localStorage.setItem(VAC_REMOTE_CYCLE_KEY, String(manifest?.sourceCycle || ''));
        localStorage.setItem(VAC_REMOTE_TOTAL_SIZE_KEY, String(totalSize));
    } catch (_) {}
}

async function getAllVacRecords() {
    try {
        const database = await initVacDB();
        return await new Promise((resolve, reject) => {
            const tx = database.transaction(VAC_STORE_NAME, 'readonly');
            const request = tx.objectStore(VAC_STORE_NAME).getAll();
            request.onsuccess = () => {
                resolve(
                    (request.result || [])
                        .filter(record => record && record.oaci)
                        .sort((a, b) => String(a.oaci).localeCompare(String(b.oaci)))
                );
            };
            request.onerror = () => reject(request.error || new Error('Lecture VAC impossible'));
        });
    } catch (error) {
        console.warn('[VAC] Liste locale indisponible:', error);
        return [];
    }
}

async function getVacRecord(oaci) {
    const safeOaci = normalizeVacOaci(oaci);
    if (!safeOaci) return null;

    try {
        const database = await initVacDB();
        return await new Promise((resolve, reject) => {
            const tx = database.transaction(VAC_STORE_NAME, 'readonly');
            const request = tx.objectStore(VAC_STORE_NAME).get(safeOaci);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Lecture VAC impossible'));
        });
    } catch (error) {
        console.warn(`[VAC] Lecture ${safeOaci} impossible:`, error);
        return null;
    }
}

async function putVacRecord(record) {
    const safeOaci = normalizeVacOaci(record?.oaci);
    if (!safeOaci || !(record?.blob instanceof Blob)) {
        throw new Error('Enregistrement VAC invalide');
    }

    const database = await initVacDB();
    await new Promise((resolve, reject) => {
        const tx = database.transaction(VAC_STORE_NAME, 'readwrite');
        tx.objectStore(VAC_STORE_NAME).put({
            ...record,
            oaci: safeOaci
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error(`Enregistrement ${safeOaci} impossible`));
        tx.onabort = () => reject(tx.error || new Error(`Enregistrement ${safeOaci} interrompu`));
    });
}

async function reconcileVacInstalledIndexFromDb() {
    const records = await getAllVacRecords();
    vacInstalledOaciSet = new Set(records.map(record => normalizeVacOaci(record.oaci)).filter(Boolean));
    try {
        localStorage.setItem(VAC_INSTALLED_CODES_KEY, JSON.stringify([...vacInstalledOaciSet].sort()));
    } catch (_) {}
    return records;
}

async function fetchVacManifest(timeoutMs = 12000) {
    if (!navigator.onLine) {
        throw new Error('Connexion Internet indisponible');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const separator = VAC_MANIFEST_URL.includes('?') ? '&' : '?';
        const response = await fetch(`${VAC_MANIFEST_URL}${separator}t=${Date.now()}`, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Manifest VAC HTTP ${response.status}`);
        }
        const manifest = await response.json();
        if (
            !manifest
            || Number(manifest.schemaVersion) !== 1
            || !manifest.airports
            || typeof manifest.airports !== 'object'
        ) {
            throw new Error('Manifest VAC invalide');
        }
        persistVacManifestSummary(manifest);
        return manifest;
    } finally {
        clearTimeout(timer);
    }
}

function getVacAvailableEntries(manifest) {
    /*
     * v16.47 — aucune restriction PÉLIC : toutes les VAC publiées dans le
     * manifest peuvent être téléchargées et utilisées hors ligne.
     */
    return Object.entries(manifest?.airports || {})
        .map(([oaci, entry]) => ({
            oaci: normalizeVacOaci(oaci),
            ...(entry || {})
        }))
        .filter(entry => (
            entry.oaci
            && entry.available === true
            && typeof entry.file === 'string'
            && entry.file
            && typeof entry.sha256 === 'string'
            && entry.sha256
        ))
        .sort((a, b) => a.oaci.localeCompare(b.oaci));
}

function getVacEntriesNeedingDownload(manifest, localRecords = []) {
    const localByOaci = new Map(
        (localRecords || []).map(record => [normalizeVacOaci(record.oaci), record])
    );

    return getVacAvailableEntries(manifest).filter(entry => {
        const local = localByOaci.get(entry.oaci);
        if (!local || !(local.blob instanceof Blob)) return true;
        return String(local.sha256 || '').toLowerCase() !== String(entry.sha256 || '').toLowerCase();
    });
}


function sleepVacBackground(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function areNpfTileReadsIdleForVac() {
    try {
        return Number(directOfflineNpfActiveReads || 0) === 0
            && Number(directOfflineNpfReadQueue?.length || 0) === 0;
    } catch (_) {
        return true;
    }
}

async function waitForVacBackgroundOpportunity(options = {}) {
    const sequence = Number(options.sequence) || 0;
    const startedAt = Date.now();
    const maxWaitMs = Number.isFinite(Number(options.maxWaitMs))
        ? Math.max(5000, Number(options.maxWaitMs))
        : 120000;

    while (navigator.onLine) {
        if (sequence && sequence !== vacAutomaticSyncSequence) return false;

        let tilesReady = true;
        try {
            tilesReady = await waitForNpfVisibleBaseTilesReady({
                maxWaitMs: 2500,
                pollMs: 100,
                isCancelled: () => (
                    !navigator.onLine
                    || (sequence && sequence !== vacAutomaticSyncSequence)
                )
            });
        } catch (_) {
            tilesReady = areNpfTileReadsIdleForVac();
        }

        if (tilesReady && areNpfTileReadsIdleForVac()) {
            await sleepVacBackground(250);
            if (areNpfTileReadsIdleForVac()) return true;
        }

        if (Date.now() - startedAt >= maxWaitMs) {
            /* La carte reste prioritaire : l'auto-sync sera reprise plus tard. */
            return false;
        }

        await sleepVacBackground(500);
    }

    return false;
}

function scheduleAutomaticVacSync(delayMs = VAC_AUTO_SYNC_RETRY_DELAY_MS, source = 'scheduled') {
    clearTimeout(vacAutomaticSyncTimer);
    vacAutomaticSyncTimer = setTimeout(() => {
        vacAutomaticSyncTimer = null;
        checkVacUpdatesAtStartup({ source }).catch(error => {
            console.info('[VAC] Synchronisation automatique différée:', error?.message || error);
        });
    }, Math.max(0, Number(delayMs) || 0));
}

async function sha256HexFromArrayBuffer(buffer) {
    if (!globalThis.crypto?.subtle?.digest) {
        throw new Error('Vérification SHA-256 indisponible sur cet appareil');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function downloadAndValidateVacEntry(entry, timeoutMs = 30000) {
    const pdfUrl = new URL(entry.file, VAC_REPOSITORY_BASE_URL).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${pdfUrl}?sha=${encodeURIComponent(entry.sha256)}`, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength) {
            throw new Error('PDF vide');
        }

        const signatureBytes = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
        const signature = String.fromCharCode(...signatureBytes);
        if (signature !== '%PDF-') {
            throw new Error('signature PDF invalide');
        }

        const expectedSize = Number(entry.size) || 0;
        if (expectedSize && buffer.byteLength !== expectedSize) {
            throw new Error(
                `taille invalide (${buffer.byteLength} octets au lieu de ${expectedSize})`
            );
        }

        const computedSha256 = await sha256HexFromArrayBuffer(buffer);
        if (computedSha256.toLowerCase() !== String(entry.sha256).toLowerCase()) {
            throw new Error('SHA-256 invalide');
        }

        return {
            blob: new Blob([buffer], { type: 'application/pdf' }),
            size: buffer.byteLength,
            sha256: computedSha256,
            sourceUrl: pdfUrl
        };
    } finally {
        clearTimeout(timer);
    }
}

function setVacDownloadProgress(current, total, label = '') {
    const container = document.getElementById('vac-download-progress');
    const bar = document.getElementById('vac-download-progress-bar');
    const text = document.getElementById('vac-download-progress-text');
    if (!container || !bar || !text) return;

    const safeTotal = Math.max(1, Number(total) || 1);
    const safeCurrent = Math.min(safeTotal, Math.max(0, Number(current) || 0));
    const percent = Math.round((safeCurrent / safeTotal) * 100);

    container.style.display = 'block';
    bar.style.width = `${percent}%`;
    text.textContent = label || `${safeCurrent} / ${safeTotal}`;
}

function hideVacDownloadProgress(delayMs = 0) {
    const apply = () => {
        const container = document.getElementById('vac-download-progress');
        const bar = document.getElementById('vac-download-progress-bar');
        const text = document.getElementById('vac-download-progress-text');
        if (container) container.style.display = 'none';
        if (bar) bar.style.width = '0%';
        if (text) text.textContent = '';
    };
    if (delayMs > 0) setTimeout(apply, delayMs);
    else apply();
}

async function displayVacManagementStatus() {
    const status = document.getElementById('vac-installed-status');
    const downloadButton = document.getElementById('vac-download-update-button');
    const deleteButton = document.getElementById('vac-delete-all-button');
    if (!status) return;

    const records = await reconcileVacInstalledIndexFromDb();
    const count = records.length;
    const totalSize = records.reduce((sum, record) => sum + (Number(record.size) || Number(record.blob?.size) || 0), 0);
    const expected = Math.max(0, Number(localStorage.getItem(VAC_EXPECTED_COUNT_KEY)) || 0);
    const remoteAirportCount = Math.max(0, Number(localStorage.getItem(VAC_REMOTE_AIRPORT_COUNT_KEY)) || 0);
    const displayedAirportCount = getNpfDisplayedAirportOaciCountForVac();
    const manifestGap = remoteAirportCount && displayedAirportCount
        ? Math.max(0, displayedAirportCount - remoteAirportCount)
        : 0;
    const cycle = localStorage.getItem(VAC_REMOTE_CYCLE_KEY)
        || records.find(record => record.cycle)?.cycle
        || '';
    const lastSyncRaw = Number(localStorage.getItem(VAC_LAST_SUCCESSFUL_SYNC_KEY)) || 0;
    const lastSync = lastSyncRaw
        ? new Date(lastSyncRaw).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
        : '';

    if (!count) {
        const remoteHint = expected
            ? ` ${expected} VAC étaient disponibles lors du dernier contrôle.`
            : '';
        status.textContent = `Aucune carte VAC téléchargée.${remoteHint}`;
    } else {
        const missing = expected ? Math.max(0, expected - count) : null;
        const pieces = [
            `Téléchargées : ${count}${expected ? ` / ${expected}` : ''}`,
            missing !== null ? `Non téléchargées : ${missing}` : '',
            remoteAirportCount && displayedAirportCount
                ? `Périmètre dépôt : ${remoteAirportCount} / ${displayedAirportCount} terrains NPF`
                : '',
            manifestGap ? `À ajouter au manifest : ${manifestGap}` : '',
            cycle ? `Cycle SIA : ${cycle}` : '',
            `Stockage : ${formatVacBytes(totalSize)}`,
            lastSync ? `Dernière mise à jour : ${lastSync}` : ''
        ].filter(Boolean);
        status.textContent = pieces.join(' · ');
    }

    if (downloadButton) {
        downloadButton.textContent = 'Synchroniser maintenant';
        downloadButton.disabled = vacSyncInProgress;
    }
    if (deleteButton) {
        deleteButton.style.display = count ? 'inline-flex' : 'none';
        deleteButton.disabled = vacSyncInProgress;
    }
}

async function syncVacFromManifest(manifest, options = {}) {
    if (vacSyncInProgress) return false;
    vacSyncInProgress = true;

    const silent = !!options.silent;
    const background = !!options.background;
    const sequence = Number(options.sequence) || 0;
    const downloadButton = document.getElementById('vac-download-update-button');
    const deleteButton = document.getElementById('vac-delete-all-button');
    if (downloadButton) downloadButton.disabled = true;
    if (deleteButton) deleteButton.disabled = true;

    try {
        persistVacManifestSummary(manifest);

        const localRecords = await getAllVacRecords();
        const targets = getVacEntriesNeedingDownload(manifest, localRecords);

        if (!targets.length) {
            await displayVacManagementStatus();
            hideVacDownloadProgress();
            if (options.showNoChangesAlert && !silent) {
                alert('Les cartes VAC téléchargées sont déjà à jour.');
            }
            return true;
        }

        let completed = 0;
        let stored = 0;
        const failures = [];
        let pausedForMap = false;

        setVacDownloadProgress(0, targets.length, `Synchronisation automatique de ${targets.length} VAC…`);

        for (const entry of targets) {
            if (!navigator.onLine) {
                failures.push('connexion interrompue');
                break;
            }
            if (sequence && sequence !== vacAutomaticSyncSequence) {
                pausedForMap = true;
                break;
            }

            if (background) {
                const opportunity = await waitForVacBackgroundOpportunity({
                    sequence,
                    maxWaitMs: 120000
                });
                if (!opportunity) {
                    pausedForMap = true;
                    break;
                }
            }

            setVacDownloadProgress(
                completed,
                targets.length,
                `VAC ${completed + 1} / ${targets.length} — ${entry.oaci}`
            );

            try {
                /*
                 * Le record IndexedDB existant n'est écrasé qu'après :
                 * 1) réponse HTTP complète ;
                 * 2) signature %PDF- ;
                 * 3) taille attendue ;
                 * 4) SHA-256 identique au manifeste.
                 */
                const validated = await downloadAndValidateVacEntry(entry);
                await putVacRecord({
                    oaci: entry.oaci,
                    filename: `${entry.oaci}.pdf`,
                    blob: validated.blob,
                    size: validated.size,
                    sha256: validated.sha256,
                    cycle: String(entry.cycle || manifest.sourceCycle || ''),
                    updatedAt: Date.now(),
                    source: String(entry.source || 'SIA'),
                    sourceUrl: validated.sourceUrl
                });
                stored += 1;
            } catch (error) {
                console.error(`[VAC] ${entry.oaci} non mise à jour:`, error);
                failures.push(`${entry.oaci} (${error.message || error})`);
                if (error?.name === 'QuotaExceededError') {
                    break;
                }
                if (!navigator.onLine) {
                    break;
                }
            }

            completed += 1;
            setVacDownloadProgress(
                completed,
                targets.length,
                `${completed} / ${targets.length} VAC synchronisées`
            );

            if (background) {
                await sleepVacBackground(80);
            }
        }

        await reconcileVacInstalledIndexFromDb();

        const fullyCompleted = !failures.length
            && !pausedForMap
            && completed === targets.length;

        if (fullyCompleted) {
            try {
                localStorage.setItem(VAC_LAST_SUCCESSFUL_SYNC_KEY, String(Date.now()));
            } catch (_) {}
        }

        await displayVacManagementStatus();
        refreshUI();

        if (pausedForMap || (!navigator.onLine && completed < targets.length)) {
            console.info(
                `[VAC] Synchronisation automatique suspendue après ${completed}/${targets.length}; reprise programmée.`
            );
            hideVacDownloadProgress(800);
            scheduleAutomaticVacSync(VAC_AUTO_SYNC_RETRY_DELAY_MS, 'resume');
            return false;
        }

        if (failures.length) {
            console.warn(
                `[VAC] ${stored} VAC mise(s) à jour, ${failures.length} échec(s).`,
                failures.slice(0, 12)
            );
            if (!silent) {
                alert(
                    `${stored} carte(s) VAC mise(s) à jour.\n`
                    + `${failures.length} échec(s) : ${failures.slice(0, 8).join(', ')}`
                    + (failures.length > 8 ? '…' : '')
                    + '\n\nLes anciennes VAC locales ont été conservées lorsqu’elles existaient.'
                );
            }
            hideVacDownloadProgress(1800);
            if (background) scheduleAutomaticVacSync(VAC_AUTO_SYNC_RETRY_DELAY_MS, 'retry-failures');
            return false;
        }

        if (!silent) {
            alert(`${stored} carte(s) VAC téléchargée(s) et vérifiée(s) pour utilisation hors ligne.`);
        } else if (stored) {
            console.info(`[VAC] Synchronisation automatique terminée : ${stored} VAC mise(s) à jour.`);
        }
        hideVacDownloadProgress(1200);
        return true;
    } finally {
        vacSyncInProgress = false;
        if (downloadButton) downloadButton.disabled = false;
        if (deleteButton) deleteButton.disabled = false;
        displayVacManagementStatus().catch(() => {});
    }
}

async function handleVacDownloadUpdateClick() {
    if (vacSyncInProgress) return;

    let manifest;
    try {
        manifest = await fetchVacManifest();
    } catch (error) {
        if (!navigator.onLine) {
            alert('Connexion Internet nécessaire pour synchroniser les cartes VAC.');
        } else {
            alert(`Impossible de récupérer la liste des cartes VAC : ${error.message || error}`);
        }
        return;
    }

    await syncVacFromManifest(manifest, {
        source: 'manual-sync',
        showNoChangesAlert: true,
        silent: false,
        background: false
    });
}

async function deleteAllVacPdfs() {
    if (vacSyncInProgress) return false;

    const records = await getAllVacRecords();
    if (!records.length) {
        alert('Aucune carte VAC hors ligne à supprimer.');
        await displayVacManagementStatus();
        return false;
    }

    if (!confirm(`Supprimer les ${records.length} cartes VAC stockées hors ligne sur cet appareil ?`)) {
        return false;
    }

    const database = await initVacDB();
    await new Promise((resolve, reject) => {
        const tx = database.transaction(VAC_STORE_NAME, 'readwrite');
        tx.objectStore(VAC_STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Suppression des VAC impossible'));
        tx.onabort = () => reject(tx.error || new Error('Suppression des VAC interrompue'));
    });

    vacInstalledOaciSet = new Set();
    try {
        localStorage.setItem(VAC_INSTALLED_CODES_KEY, '[]');
        localStorage.removeItem(VAC_LAST_SUCCESSFUL_SYNC_KEY);
    } catch (_) {}

    await displayVacManagementStatus();
    refreshUI();
    alert(`${records.length} carte(s) VAC supprimée(s).`);
    return true;
}


async function deleteVacRecordByOaciSilently(oaci) {
    const safeOaci = normalizeVacOaci(oaci);
    if (!safeOaci) return false;

    try {
        const database = await initVacDB();
        await new Promise((resolve, reject) => {
            const tx = database.transaction(VAC_STORE_NAME, 'readwrite');
            tx.objectStore(VAC_STORE_NAME).delete(safeOaci);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error(`Suppression ${safeOaci} impossible`));
            tx.onabort = () => reject(tx.error || new Error(`Suppression ${safeOaci} interrompue`));
        });
        return true;
    } catch (error) {
        console.warn(`[VAC] Suppression silencieuse ${safeOaci} impossible:`, error);
        return false;
    }
}

async function migrateDoleVacReferenceIfNeeded(manifest, localRecords = []) {
    /*
     * v15.45 — migration automatique et strictement ciblée Dole LFSJ -> LFGJ.
     * Elle ne s'exécute que pour un appareil possédant déjà une bibliothèque
     * VAC locale : elle ne transforme donc pas le premier téléchargement VAC
     * en téléchargement automatique général.
     */
    if (!navigator.onLine || !Array.isArray(localRecords) || !localRecords.length) {
        return { changed: false, records: localRecords || [] };
    }

    const remoteLfgj = getVacAvailableEntries(manifest)
        .find(entry => entry.oaci === 'LFGJ');
    if (!remoteLfgj) {
        return { changed: false, records: localRecords };
    }

    const localByOaci = new Map(
        localRecords.map(record => [normalizeVacOaci(record?.oaci), record])
    );
    let changed = false;

    const legacyLfsj = localByOaci.get('LFSJ');
    if (
        legacyLfsj
        && String(legacyLfsj.sha256 || '').toLowerCase() === VAC_LEGACY_DOLE_LFSJ_SHA256
    ) {
        if (await deleteVacRecordByOaciSilently('LFSJ')) {
            changed = true;
            localByOaci.delete('LFSJ');
            console.info('[VAC] Ancienne VAC Dole mal étiquetée LFSJ supprimée.');
        }
    }

    const localLfgj = localByOaci.get('LFGJ');
    const lfgjNeedsUpdate = (
        !localLfgj
        || !(localLfgj.blob instanceof Blob)
        || String(localLfgj.sha256 || '').toLowerCase() !== String(remoteLfgj.sha256 || '').toLowerCase()
    );

    if (lfgjNeedsUpdate) {
        try {
            const validated = await downloadAndValidateVacEntry(remoteLfgj, 30000);
            await putVacRecord({
                oaci: 'LFGJ',
                blob: validated.blob,
                size: validated.size,
                sha256: validated.sha256,
                cycle: String(remoteLfgj.cycle || manifest.sourceCycle || ''),
                updatedAt: Date.now(),
                source: String(remoteLfgj.source || 'SIA'),
                sourceUrl: validated.sourceUrl
            });
            changed = true;
            console.info('[VAC] VAC Dole-Tavaux LFGJ migrée automatiquement.');
        } catch (error) {
            console.warn('[VAC] Migration automatique Dole LFGJ impossible:', error);
        }
    }

    if (!changed) {
        return { changed: false, records: localRecords };
    }

    try {
        localStorage.setItem(VAC_LAST_SUCCESSFUL_SYNC_KEY, String(Date.now()));
    } catch (_) {}

    const records = await reconcileVacInstalledIndexFromDb();
    await displayVacManagementStatus();
    refreshUI();
    return { changed: true, records };
}

async function ensureVacAvailableForOaci(oaci) {
    const safeOaci = normalizeVacOaci(oaci);
    if (!safeOaci) return null;

    let record = await getVacRecord(safeOaci);
    if (record && record.blob instanceof Blob) return record;

    if (vacSyncInProgress) {
        for (let i = 0; i < 40; i += 1) {
            await sleepVacBackground(250);
            record = await getVacRecord(safeOaci);
            if (record && record.blob instanceof Blob) return record;
            if (!vacSyncInProgress) break;
        }
    }

    if (!navigator.onLine) return null;

    const manifest = await fetchVacManifest(9000);
    const entry = getVacAvailableEntries(manifest)
        .find(candidate => candidate.oaci === safeOaci);
    if (!entry) return null;

    /* Priorité absolue à la carte avant un téléchargement VAC à la demande. */
    await waitForVacBackgroundOpportunity({ maxWaitMs: 30000 });

    const validated = await downloadAndValidateVacEntry(entry);
    await putVacRecord({
        oaci: safeOaci,
        filename: `${safeOaci}.pdf`,
        blob: validated.blob,
        size: validated.size,
        sha256: validated.sha256,
        cycle: String(entry.cycle || manifest.sourceCycle || ''),
        updatedAt: Date.now(),
        source: String(entry.source || 'SIA'),
        sourceUrl: validated.sourceUrl
    });

    await reconcileVacInstalledIndexFromDb();
    displayVacManagementStatus().catch(() => {});
    refreshUI();
    return getVacRecord(safeOaci);
}

async function openVacPdf(oaci) {
    const safeOaci = normalizeVacOaci(oaci);
    if (!safeOaci) return false;

    /* v16.56 — la fiche terrain ne doit pas rester ouverte derrière la VAC. */
    try { map?.closePopup?.(); } catch (_) {}

    const openedWindow = window.open('', '_blank');

    try {
        let record = await getVacRecord(safeOaci);
        if (!record || !(record.blob instanceof Blob)) {
            try {
                record = await ensureVacAvailableForOaci(safeOaci);
            } catch (error) {
                console.warn(`[VAC] Téléchargement à la demande ${safeOaci} impossible:`, error);
            }
        }

        if (!record || !(record.blob instanceof Blob)) {
            const onlineFallbackUrl = VAC_ONLINE_FALLBACK_URLS[safeOaci] || '';
            if (onlineFallbackUrl && navigator.onLine) {
                if (openedWindow) {
                    openedWindow.location.href = onlineFallbackUrl;
                } else {
                    window.location.href = onlineFallbackUrl;
                }
                return true;
            }

            try {
                if (openedWindow && !openedWindow.closed) openedWindow.close();
            } catch (_) {}

            if (navigator.onLine) {
                alert(`Aucune carte VAC publiée dans le pack NPF-Q400-VAC pour ${safeOaci}.`);
            } else {
                alert(`VAC ${safeOaci} non encore disponible hors ligne. La synchronisation reprendra automatiquement dès qu'Internet sera disponible.`);
            }
            return false;
        }

        const pdfUrl = URL.createObjectURL(record.blob);
        if (openedWindow) {
            openedWindow.location.href = pdfUrl;
        } else {
            window.location.href = pdfUrl;
        }
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 120000);
        return true;
    } catch (error) {
        try {
            if (openedWindow && !openedWindow.closed) openedWindow.close();
        } catch (_) {}
        alert(`Ouverture de la VAC ${safeOaci} impossible : ${error.message || error}`);
        return false;
    }
}

function buildVacButtonHtml(oaci) {
    const safeOaci = normalizeVacOaci(oaci);
    if (!safeOaci) return '';

    const hasLocalVac = vacInstalledOaciSet.has(safeOaci);
    const title = hasLocalVac
        ? `VAC ${safeOaci} hors ligne`
        : `VAC ${safeOaci} — synchronisation automatique`;
    return `<div class="popup-buttons popup-vac-buttons"><button type="button" class="vac-btn" title="${title}" onclick="window.openVacPdf('${safeOaci}')">VAC</button></div>`;
}

function closeVacUpdatePrompt() {
    const modal = document.getElementById('vac-update-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    vacInitialDownloadPromptActive = false;
    pendingVacUpdateManifest = null;
}

function showVacUpdatePrompt(manifest, updateCount) {
    const modal = document.getElementById('vac-update-modal');
    const title = document.getElementById('vac-update-modal-title');
    const detail = document.getElementById('vac-update-detail');
    const yesButton = document.getElementById('vac-update-now-button');
    const noButton = document.getElementById('vac-update-later-button');
    if (!modal) return false;

    /*
     * v17.12 — première installation uniquement.
     * Libellés imposés : « Télécharger cartes VAC » / « Oui » / « Non ».
     */
    pendingVacUpdateManifest = manifest;
    vacInitialDownloadPromptActive = true;
    if (title) title.textContent = 'Télécharger cartes VAC';
    if (detail) {
        detail.textContent = '';
        detail.style.display = 'none';
    }
    if (yesButton) yesButton.textContent = 'Oui';
    if (noButton) noButton.textContent = 'Non';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    return true;
}

async function checkVacUpdatesAtStartup(options = {}) {
    const source = String(options.source || 'startup');
    if (!navigator.onLine) return false;
    if (vacSyncInProgress) return false;
    if (vacInitialDownloadPromptActive || vacInitialDownloadDeclinedForSession) return false;

    const now = Date.now();
    if (source !== 'startup' && now - vacAutomaticSyncLastAttemptAt < 2500) {
        return false;
    }
    vacAutomaticSyncLastAttemptAt = now;

    const sequence = ++vacAutomaticSyncSequence;

    /*
     * v17.12 — contrôle VAC après disponibilité de la carte.
     * - première installation (0 VAC locale) : demander Oui/Non ;
     * - installation existante : conserver les mises à jour automatiques.
     * La carte NPF garde dans tous les cas la priorité absolue.
     */
    const mapReady = await waitForVacBackgroundOpportunity({
        sequence,
        maxWaitMs: 120000
    });
    if (!mapReady) {
        if (sequence === vacAutomaticSyncSequence && navigator.onLine) {
            scheduleAutomaticVacSync(VAC_AUTO_SYNC_RETRY_DELAY_MS, 'map-busy');
        }
        return false;
    }

    let manifest;
    try {
        manifest = await fetchVacManifest(9000);
        persistVacManifestSummary(manifest);
    } catch (error) {
        console.info('[VAC] Manifest automatique indisponible:', error.message || error);
        if (navigator.onLine) {
            scheduleAutomaticVacSync(VAC_AUTO_SYNC_RETRY_DELAY_MS, 'manifest-retry');
        }
        return false;
    }

    let localRecords = await getAllVacRecords();
    try {
        const migration = await migrateDoleVacReferenceIfNeeded(manifest, localRecords);
        if (migration && Array.isArray(migration.records)) {
            localRecords = migration.records;
        }
    } catch (error) {
        console.info('[VAC] Migration Dole ignorée:', error.message || error);
    }

    const targets = getVacEntriesNeedingDownload(manifest, localRecords);
    if (!targets.length) {
        try {
            localStorage.setItem(VAC_LAST_SUCCESSFUL_SYNC_KEY, String(Date.now()));
        } catch (_) {}
        await displayVacManagementStatus();
        return true;
    }

    const installedVacCount = localRecords.reduce(
        (count, record) => count + (record?.blob instanceof Blob ? 1 : 0),
        0
    );
    if (source === 'startup' && installedVacCount === 0) {
        refreshUI();
        showVacUpdatePrompt(manifest, targets.length);
        return true;
    }

    console.info(`[VAC] Synchronisation automatique ${source}: ${targets.length} VAC à traiter.`);
    return syncVacFromManifest(manifest, {
        source: `auto-${source}`,
        silent: true,
        background: true,
        sequence
    });
}

window.openVacPdf = openVacPdf;
window.deleteAllVacPdfs = deleteAllVacPdfs;
window.displayVacManagementStatus = displayVacManagementStatus;



