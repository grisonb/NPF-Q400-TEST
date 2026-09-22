function initAirportPdfDB() {
    return new Promise((resolve, reject) => {
        if (airportPdfDb) {
            resolve(airportPdfDb);
            return;
        }
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }
        const request = indexedDB.open(AIRPORT_PDF_DB_NAME, AIRPORT_PDF_DB_VERSION);
        request.onupgradeneeded = event => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains(AIRPORT_PDF_STORE_NAME)) {
                dbInstance.createObjectStore(AIRPORT_PDF_STORE_NAME, { keyPath: 'oaci' });
            }
        };
        request.onsuccess = event => {
            airportPdfDb = event.target.result;
            airportPdfDb.onversionchange = () => {
                try { airportPdfDb.close(); } catch (_) {}
                airportPdfDb = null;
            };
            resolve(airportPdfDb);
        };
        request.onerror = event => {
            reject(event.target.error || new Error('Ouverture base PDF impossible'));
        };
        request.onblocked = () => {
            reject(new Error("Base PDF bloquée par une autre instance de l'application"));
        };
    });
}

function normalizeAirportPdfOaciFromFilename(filename) {
    const baseName = String(filename || '').split(/[\\/]/).pop().trim();
    const nameWithoutExt = baseName.replace(/\.pdf$/i, '').trim();
    const simplifiedName = nameWithoutExt
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    /*
     * v13.66 — PDF commun FDF réduite :
     * accepte "Doc Fdf Réduite.pdf" ou "Doc Fdf Réduité.pdf"
     * et le stocke avec une clé unique, commune à tous les pélicandromes.
     * v13.67 — accepte aussi "Carte Fréquences OPS.pdf" comme PDF commun.
     */
    if (simplifiedName === 'docfdfreduite') {
        return FDF_REDUCED_PDF_KEY;
    }
    if (simplifiedName === 'cartefrequencesops') {
        return OPS_FREQUENCIES_PDF_KEY;
    }

    const match = baseName.match(/^([A-Z0-9]{4})\.pdf$/i);
    return match ? match[1].toUpperCase() : null;
}

function getAirportPdfDisplayLabel(recordOrKey) {
    const key = typeof recordOrKey === 'string' ? recordOrKey : String((recordOrKey && recordOrKey.oaci) || '');
    if (key === FDF_REDUCED_PDF_KEY) return FDF_REDUCED_PDF_LABEL;
    if (key === OPS_FREQUENCIES_PDF_KEY) return OPS_FREQUENCIES_PDF_LABEL;
    return key;
}

async function getAirportPdfRecord(oaci) {
    const safeOaci = String(oaci || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!safeOaci) return null;
    try {
        const pdfDb = await initAirportPdfDB();
        return await new Promise((resolve, reject) => {
            const tx = pdfDb.transaction(AIRPORT_PDF_STORE_NAME, 'readonly');
            const store = tx.objectStore(AIRPORT_PDF_STORE_NAME);
            const request = store.get(safeOaci);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Lecture PDF impossible'));
        });
    } catch (error) {
        console.warn('PDF offline indisponible:', error);
        return null;
    }
}

async function importAirportPdfFiles(files = []) {
    const pdfFiles = Array.from(files || []).filter(file => file && /\.pdf$/i.test(file.name));
    if (!pdfFiles.length) {
        alert('Sélectionne un ou plusieurs fichiers PDF : LFTW.pdf pour un aérodrome, Doc Fdf Réduité.pdf pour le document FDF réduit commun, ou Carte Fréquences OPS.pdf pour la carte fréquences OPS.');
        return;
    }

    const invalidNames = [];
    const records = [];
    for (const file of pdfFiles) {
        const oaci = normalizeAirportPdfOaciFromFilename(file.name);
        if (!oaci) {
            invalidNames.push(file.name);
            continue;
        }
        records.push({
            oaci,
            filename: oaci === FDF_REDUCED_PDF_KEY ? FDF_REDUCED_PDF_FILENAME : (oaci === OPS_FREQUENCIES_PDF_KEY ? OPS_FREQUENCIES_PDF_FILENAME : `${oaci}.pdf`),
            blob: file,
            size: file.size || 0,
            updatedAt: Date.now()
        });
    }

    if (!records.length) {
        alert(`Aucun PDF importé. Les fichiers doivent être nommés LFTW.pdf, LFKJ.pdf, etc., Doc Fdf Réduité.pdf ou Carte Fréquences OPS.pdf.${invalidNames.length ? `\nIgnorés : ${invalidNames.join(', ')}` : ''}`);
        return;
    }

    try {
        const pdfDb = await initAirportPdfDB();
        await new Promise((resolve, reject) => {
            const tx = pdfDb.transaction(AIRPORT_PDF_STORE_NAME, 'readwrite');
            const store = tx.objectStore(AIRPORT_PDF_STORE_NAME);
            records.forEach(record => store.put(record));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Import PDF impossible'));
            tx.onabort = () => reject(tx.error || new Error('Import PDF interrompu'));
        });
        displayInstalledAirportPdfs();
        alert(`${records.length} PDF(s) FDF/aérodrome/OPS stocké(s) hors ligne.${invalidNames.length ? `\nIgnorés : ${invalidNames.join(', ')}` : ''}`);
    } catch (error) {
        console.error('Import PDF aérodromes impossible:', error);
        alert(`Import PDF impossible : ${error.message || error}`);
    }
}

async function getInstalledAirportPdfRecords() {
    try {
        const pdfDb = await initAirportPdfDB();
        return await new Promise((resolve, reject) => {
            const tx = pdfDb.transaction(AIRPORT_PDF_STORE_NAME, 'readonly');
            const store = tx.objectStore(AIRPORT_PDF_STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve((request.result || []).sort((a, b) => String(a.oaci).localeCompare(String(b.oaci))));
            request.onerror = () => reject(request.error || new Error('Liste PDF impossible'));
        });
    } catch (error) {
        console.warn('Liste PDF aérodromes indisponible:', error);
        return [];
    }
}

async function displayInstalledAirportPdfs() {
    const list = document.getElementById('installed-airport-pdfs-list');
    const deleteAllButton = document.getElementById('delete-all-airport-pdfs-button');
    if (!list) return;

    const records = await getInstalledAirportPdfRecords();
    list.innerHTML = '';

    if (!records.length) {
        list.innerHTML = '<li class="no-pdfs-placeholder">Aucun PDF FDF/aérodrome/OPS stocké.</li>';
        if (deleteAllButton) deleteAllButton.style.display = 'none';
        return;
    }

    if (deleteAllButton) deleteAllButton.style.display = 'inline-flex';

    records.forEach(record => {
        const li = document.createElement('li');
        const sizeKb = record.size ? `${Math.max(1, Math.round(record.size / 1024))} ko` : 'taille inconnue';
        const date = record.updatedAt ? new Date(record.updatedAt).toLocaleDateString('fr-FR') : '--/--/----';
        const openAction = record.oaci === FDF_REDUCED_PDF_KEY
            ? 'window.openFdfReducedPdf()'
            : (record.oaci === OPS_FREQUENCIES_PDF_KEY ? 'window.openOpsFrequenciesPdf()' : `window.openAirportPdf('${record.oaci}')`);
        li.innerHTML = `
            <span><strong>${getAirportPdfDisplayLabel(record)}</strong> — ${record.filename || `${record.oaci}.pdf`} <small>(${sizeKb}, ${date})</small></span>
            <div class="airport-pdf-actions">
                <button type="button" class="open-pdf-btn" onclick="${openAction}">Ouvrir</button>
                <button type="button" class="delete-pdf-btn" onclick="window.deleteAirportPdf('${record.oaci}')">Supprimer</button>
            </div>
        `;
        list.appendChild(li);
    });
}

async function deleteAirportPdf(oaci) {
    const safeOaci = String(oaci || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!safeOaci) return;
    if (!confirm(`Supprimer le PDF offline ${getAirportPdfDisplayLabel(safeOaci)} ?`)) return;
    try {
        const pdfDb = await initAirportPdfDB();
        await new Promise((resolve, reject) => {
            const tx = pdfDb.transaction(AIRPORT_PDF_STORE_NAME, 'readwrite');
            tx.objectStore(AIRPORT_PDF_STORE_NAME).delete(safeOaci);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Suppression PDF impossible'));
            tx.onabort = () => reject(tx.error || new Error('Suppression PDF interrompue'));
        });
        displayInstalledAirportPdfs();
    } catch (error) {
        alert(`Suppression PDF impossible : ${error.message || error}`);
    }
}

async function deleteAllAirportPdfs() {
    const records = await getInstalledAirportPdfRecords();
    if (!records.length) {
        alert('Aucun PDF offline à supprimer.');
        await displayInstalledAirportPdfs();
        return false;
    }

    const count = records.length;
    const confirmed = confirm(
        `Supprimer en une seule fois les ${count} PDF offline FDF, aérodromes et OPS de cet appareil ?\n\nCette action est définitive.`
    );
    if (!confirmed) return false;

    try {
        const pdfDb = await initAirportPdfDB();
        await new Promise((resolve, reject) => {
            const tx = pdfDb.transaction(AIRPORT_PDF_STORE_NAME, 'readwrite');
            tx.objectStore(AIRPORT_PDF_STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(
                tx.error || new Error('Suppression de tous les PDF impossible')
            );
            tx.onabort = () => reject(
                tx.error || new Error('Suppression de tous les PDF interrompue')
            );
        });

        await displayInstalledAirportPdfs();
        alert(`${count} PDF offline supprimé(s).`);
        return true;
    } catch (error) {
        console.error('Suppression groupée des PDF impossible:', error);
        alert(`Suppression de tous les PDF impossible : ${error.message || error}`);
        return false;
    }
}

async function airportServerPdfExists(url) {
    try {
        const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        return !!(response && response.ok);
    } catch (_) {
        return false;
    }
}

async function openAirportPdfByKey(pdfKey, options = {}) {
    const safeKey = String(pdfKey || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!safeKey) return;

    /*
     * v12.58/v13.66 — sécurité PDF pélicandrome/aérodrome/FDF réduite :
     * si aucun PDF offline ni serveur n'est trouvé, on n'envoie plus l'iPad
     * vers une page PDF inexistante. La fenêtre pré-ouverte est fermée proprement.
     */
    const openedWindow = window.open('', '_blank');
    const label = options.label || getAirportPdfDisplayLabel(safeKey);
    const serverPdfUrls = Array.isArray(options.serverPdfUrls) && options.serverPdfUrls.length
        ? options.serverPdfUrls
        : [`./pdf/${safeKey}.pdf`];

    try {
        const record = await getAirportPdfRecord(safeKey);
        if (record && record.blob) {
            const pdfUrl = URL.createObjectURL(record.blob);
            if (openedWindow) {
                openedWindow.location.href = pdfUrl;
            } else {
                window.location.href = pdfUrl;
            }
            setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
            return;
        }
    } catch (error) {
        console.warn('Ouverture PDF offline impossible:', error);
    }

    for (const serverPdfUrl of serverPdfUrls) {
        const hasServerPdf = await airportServerPdfExists(serverPdfUrl);
        if (hasServerPdf) {
            if (openedWindow) {
                openedWindow.location.href = serverPdfUrl;
            } else {
                window.location.href = serverPdfUrl;
            }
            return;
        }
    }

    try {
        if (openedWindow && !openedWindow.closed) openedWindow.close();
    } catch (_) {}

    alert(`Aucun PDF associé à ${label}.`);
}

async function openAirportPdf(oaci) {
    const safeOaci = String(oaci || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!safeOaci) return;
    return openAirportPdfByKey(safeOaci, {
        label: safeOaci,
        serverPdfUrls: [`./pdf/${safeOaci}.pdf`]
    });
}

async function openFdfReducedPdf() {
    return openAirportPdfByKey(FDF_REDUCED_PDF_KEY, {
        label: FDF_REDUCED_PDF_LABEL,
        serverPdfUrls: FDF_REDUCED_PDF_SERVER_CANDIDATES
    });
}

async function openOpsFrequenciesPdf() {
    return openAirportPdfByKey(OPS_FREQUENCIES_PDF_KEY, {
        label: OPS_FREQUENCIES_PDF_LABEL,
        serverPdfUrls: OPS_FREQUENCIES_PDF_SERVER_CANDIDATES
    });
}

window.openAirportPdf = openAirportPdf;
window.openFdfReducedPdf = openFdfReducedPdf;
window.openOpsFrequenciesPdf = openOpsFrequenciesPdf;
window.deleteAirportPdf = deleteAirportPdf;
window.deleteAllAirportPdfs = deleteAllAirportPdfs;


function buildPermanentAirportDotIcon() {
    /*
     * v12.09 — points noirs aéroports :
     * point noir + cerclage blanc + liseré noir extérieur.
     * Correction : les points étaient dessinés par HTML inline, donc le CSS v12.08
     * ne touchait pas la bonne classe.
     */
    return L.divIcon({
        className: 'permanent-airport-black-dot-icon',
        html: '<span></span>',
        iconSize: [10, 10],
        iconAnchor: [5, 5]
    });
}


function getTerrainAirportRunways(airport) {
    const oaci = String(airport?.oaci || '').trim().toUpperCase();
    if (!oaci) return [];

    if (typeof getAdditionalAerodromeRunways === 'function') {
        const additional = getAdditionalAerodromeRunways(oaci);
        if (Array.isArray(additional) && additional.length) return additional;
    }

    if (typeof otherAirportRunwaysByOaci !== 'undefined' && otherAirportRunwaysByOaci?.has?.(oaci)) {
        return otherAirportRunwaysByOaci.get(oaci) || [];
    }

    if (typeof declaredPelicanRunwaysByOaci !== 'undefined' && declaredPelicanRunwaysByOaci?.has?.(oaci)) {
        return declaredPelicanRunwaysByOaci.get(oaci) || [];
    }

    return [];
}

function getTerrainAirportPrimaryRunway(airport) {
    const runways = getTerrainAirportRunways(airport);
    if (!Array.isArray(runways) || !runways.length) return null;

    return runways.reduce((best, runway) => {
        if (!best) return runway;
        const bestLength = Number(best?.lengthM) || 0;
        const runwayLength = Number(runway?.lengthM) || 0;
        return runwayLength > bestLength ? runway : best;
    }, null);
}

function getTerrainAirportIconHeading(airport) {
    const runway = getTerrainAirportPrimaryRunway(airport);
    if (
        runway
        && Number.isFinite(runway.leLat)
        && Number.isFinite(runway.leLon)
        && Number.isFinite(runway.heLat)
        && Number.isFinite(runway.heLon)
    ) {
        try {
            return Number(calculateBearing(runway.leLat, runway.leLon, runway.heLat, runway.heLon)) || 0;
        } catch (_) {}
    }
    return 90;
}

function getTerrainAirportIconSvgRotation(airport) {
    /*
     * Le rectangle SVG est horizontal à 0°, tandis que le relèvement aviation
     * est mesuré depuis le Nord. La conversion exacte est donc cap - 90°.
     */
    const heading = getTerrainAirportIconHeading(airport);
    if (!Number.isFinite(heading)) return 0;
    let rotation = heading - 90;
    while (rotation <= -180) rotation += 360;
    while (rotation > 180) rotation -= 360;
    return rotation;
}

function buildTerrainAirportSymbolHtml(airport, options = {}) {
    const inverted = !!options.inverted;
    const showCardinalTabs = options.showCardinalTabs !== false;
    const heading = getTerrainAirportIconSvgRotation(airport);
    const mainColor = '#3358d4';
    const fillColor = inverted ? '#ffffff' : mainColor;
    const strokeColor = inverted ? mainColor : '#ffffff';
    const runwayColor = inverted ? mainColor : '#ffffff';
    const ringColor = mainColor;

    const tabsSvg = showCardinalTabs ? `
        <rect x="28" y="2.5" width="8" height="10" rx="2.4" fill="${fillColor}" stroke="${strokeColor}" stroke-width="3"/>
        <rect x="28" y="51.5" width="8" height="10" rx="2.4" fill="${fillColor}" stroke="${strokeColor}" stroke-width="3"/>
        <rect x="2.5" y="28" width="10" height="8" rx="2.4" fill="${fillColor}" stroke="${strokeColor}" stroke-width="3"/>
        <rect x="51.5" y="28" width="10" height="8" rx="2.4" fill="${fillColor}" stroke="${strokeColor}" stroke-width="3"/>
    ` : '';

    return `
        <span class="terrain-airport-symbol" aria-hidden="true">
            <svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">
                ${tabsSvg}
                <circle cx="32" cy="32" r="20.5" fill="${fillColor}" stroke="${ringColor}" stroke-width="4"/>
                ${!inverted ? '<circle cx="32" cy="32" r="20.5" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.95"/>' : ''}
                <g transform="rotate(${Number.isFinite(heading) ? heading.toFixed(1) : '0.0'} 32 32)">
                    <rect x="15" y="27.6" width="34" height="8.8" rx="4.4" fill="${runwayColor}"/>
                </g>
            </svg>
        </span>`;
}

function buildTerrainAirportMapIcon(airport, options = {}) {
    const showCardinalTabs = options.showCardinalTabs !== false;
    const size = Number(options.size) || (showCardinalTabs ? 30 : 22);
    const anchorX = Number.isFinite(Number(options.anchorX)) ? Number(options.anchorX) : size / 2;
    const anchorY = Number.isFinite(Number(options.anchorY)) ? Number(options.anchorY) : size / 2;
    const className = [
        'terrain-airport-marker-icon',
        options.inverted ? 'terrain-airport-marker-icon-inverted' : 'terrain-airport-marker-icon-selectable'
    ].join(' ');

    return L.divIcon({
        className,
        html: buildTerrainAirportSymbolHtml(airport, options),
        iconSize: [size, size],
        iconAnchor: [anchorX, anchorY],
        popupAnchor: [0, -Math.round(anchorY)]
    });
}


function buildPelicPdfButtonsHtml(oaci) {
    const safeOaci = String(oaci || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return `<div class="popup-buttons popup-pdf-buttons"><button class="pdf-btn" onclick="window.openAirportPdf('${safeOaci}')">PDF Pélic</button><button class="pdf-btn fdf-reduced-pdf-btn" onclick="window.openFdfReducedPdf()">Doc PDF Réduite</button></div>`;
}

function buildAirportGoToButtonHtml(oaci) {
    const safeOaci = String(oaci || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    if (!safeOaci) return '';

    /*
     * v16.13 — si l'aéroport/PÉLIC est déjà un WP de la route, le popup du
     * point contient déjà l'action GoTo du WP. On masque alors le Go To
     * aéroport indépendant afin de ne jamais afficher deux commandes GoTo.
     * Le GoTo conservé est celui du WP : il active la route et son bandeau.
     */
    try {
        if (typeof getNpfWaypointForAirport === 'function' && getNpfWaypointForAirport(safeOaci)) {
            return '';
        }
    } catch (_) {}

    return `<div class="popup-buttons popup-goto-buttons"><button type="button" class="goto-btn" onclick="window.goToAirportDestinationByOaci('${safeOaci}')">Go To</button></div>`;
}

function goToAirportDestinationByOaci(oaci) {
    const airport = getAirportByOaci(oaci);
    if (!airport) return false;

    try {
        if (map && typeof map.closePopup === 'function') map.closePopup();
    } catch (_) {}

    return selectAirportDestination(airport);
}

window.goToAirportDestinationByOaci = goToAirportDestinationByOaci;


