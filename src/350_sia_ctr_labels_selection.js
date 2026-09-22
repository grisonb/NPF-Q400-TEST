// =========================================================================
// v15.48 — CORRECTIONS TACTILES / VRP / CTR / APPUI LONG
// =========================================================================

function installQuickOfflineMapButtonInteractions(button) {
    if (!button || button.dataset.siaLongPressBound === '1') return;
    button.dataset.siaLongPressBound = '1';

    protectNpfLongPressControlFromIosSelection(button);

    let longPressTimer = null;
    let longPressTriggered = false;
    let pointerStartX = null;
    let pointerStartY = null;

    const clearLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        pointerStartX = null;
        pointerStartY = null;
    };

    const startLongPress = event => {
        if (event && event.button !== undefined && event.button !== 0) return;
        if (event && typeof event.preventDefault === 'function' && event.cancelable) event.preventDefault();
        clearLongPress();
        longPressTriggered = false;
        pointerStartX = Number(event?.clientX);
        pointerStartY = Number(event?.clientY);
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            longPressTriggered = true;
            try { window.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
            openSiaFilterDialog();
        }, 650);
    };

    const trackPointer = event => {
        if (!longPressTimer || pointerStartX === null || pointerStartY === null) return;
        const dx = Number(event?.clientX) - pointerStartX;
        const dy = Number(event?.clientY) - pointerStartY;
        if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > 12) {
            clearLongPress();
        }
    };

    button.addEventListener('selectstart', event => event.preventDefault());
    button.addEventListener('dragstart', event => event.preventDefault());
    button.addEventListener('pointerdown', startLongPress, { passive: false });
    button.addEventListener('pointermove', trackPointer, { passive: true });
    button.addEventListener('pointerup', clearLongPress);
    button.addEventListener('pointerleave', clearLongPress);
    button.addEventListener('pointercancel', clearLongPress);
    button.addEventListener('contextmenu', event => {
        event.preventDefault();
        clearLongPress();
        longPressTriggered = true;
        try { window.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
        openSiaFilterDialog();
    });
    button.addEventListener('click', event => {
        if (longPressTriggered) {
            event.preventDefault();
            event.stopPropagation();
            longPressTriggered = false;
            return;
        }
        openQuickOfflineMapSelector();
    });
}

function getSiaVrpSymbolText(item) {
    const codeId = String(item?.c || '').trim().toUpperCase();
    const published = String(item?.d || '').trim().toUpperCase();

    /*
     * Les codes SIA VRP sont très souvent construits avec un préfixe terrain
     * de 2 caractères (MTNE -> NE, LBAL -> AL, TBMAT -> MAT). On utilise
     * cette forme courte lorsqu'elle tient en 1 à 3 caractères, sinon on
     * conserve le libellé publié.
     */
    if (codeId.length > 2) {
        const shortCode = codeId.slice(2);
        if (/^[A-Z0-9]{1,3}$/.test(shortCode)) return shortCode;
    }
    return published || codeId || '?';
}

/* v15.87 — VRP légèrement plus compacts ; hitbox tactile inchangée. */
function getSiaVrpVisualSize(label) {
    // v15.88 — diamètre visuel homogène ; seule la taille du texte varie.
    void label;
    return 24;
}

function addSiaTouchHitbox(latlng, popupHtml, popupFactory = null) {
    if (!siaLayerGroup || !latlng || !popupHtml) return null;

    /*
     * v15.50 — même correction que pour les terrains NPF : surface SVG
     * quasi invisible plutôt qu'un DIV vide. Diamètre tactile 56 px.
     */
    ensureSiaMapPanes();
    const hitbox = L.circleMarker(latlng, {
        pane: 'siaPointTouchPane',
        renderer: siaPointTouchRenderer || undefined,
        radius: 28,
        stroke: false,
        color: '#000000',
        opacity: 0,
        fill: true,
        fillColor: '#000000',
        fillOpacity: 0.002,
        interactive: true,
        bubblingMouseEvents: false,
        keyboard: false
    });
    hitbox.bindPopup(popupHtml, { maxWidth: 340 });
    hitbox.on('click', event => {
        try {
            if (event?.originalEvent) {
                L.DomEvent.stopPropagation(event.originalEvent);
            }
        } catch (_) {}

        /*
         * v16.12 — même arbitrage pour les VRP/SIA : si le doigt est réellement
         * sur le losange WP, ouvrir le WP ; sinon la fiche SIA reste accessible.
         */
        if (window.__npfWaypointRouteReady === true
            && openNpfWaypointPopupNearLatLng(
                event?.latlng || hitbox.getLatLng(),
                NPF_WAYPOINT_SELECT_TOLERANCE_PX
            )) {
            return;
        }

        try {
            if (typeof popupFactory === 'function') {
                hitbox.setPopupContent(popupFactory());
            }
            hitbox.openPopup();
        } catch (_) {}
    });
    hitbox.addTo(siaLayerGroup);
    try { if (hitbox.bringToFront) hitbox.bringToFront(); } catch (_) {}
    return hitbox;
}

function formatSiaCtrServices(item) {
    const services = Array.isArray(item?.sv) ? item.sv : [];
    if (!services.length) return '';

    const rows = services.map(service => {
        const type = String(service?.[0] || '').trim();
        const unitRaw = String(service?.[1] || '').trim();
        const unit = unitRaw.replace(/^[A-Z]{4}\s+/, '').trim();
        const frequencies = Array.isArray(service?.[2]) ? service[2] : [];

        const freqText = frequencies
            .map(freq => {
                const value = String(freq?.[0] || '').trim();
                const uom = String(freq?.[1] || '').trim();
                return value ? `${escapeHtml(value)}${uom ? ` ${escapeHtml(uom)}` : ''}` : '';
            })
            .filter(Boolean)
            .join(' / ');

        if (!freqText) return '';

        const hours = [...new Set(
            frequencies
                .map(freq => String(freq?.[2] || '').trim())
                .filter(Boolean)
        )].join(' / ');

        const callSign = frequencies
            .map(freq => String(freq?.[3] || '').trim())
            .find(Boolean) || '';

        return `
            <div class="sia-ctr-service-row">
                <strong>${escapeHtml(type || 'Service')} :</strong> ${freqText}
                ${unit ? `<span class="sia-ctr-service-unit">${escapeHtml(unit)}</span>` : ''}
                ${callSign ? `<span class="sia-ctr-service-call">${escapeHtml(callSign)}</span>` : ''}
                ${hours ? `<span class="sia-ctr-service-hours">${escapeHtml(hours)}</span>` : ''}
            </div>
        `;
    }).filter(Boolean).join('');

    if (!rows) return '';
    return `<div class="sia-ctr-services"><div class="sia-ctr-services-title">Fréquences associées SIA</div>${rows}</div>`;
}

function formatSiaCtrFrequencyValue(value, unit = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const numeric = Number(raw.replace(',', '.'));
    if (Number.isFinite(numeric) && String(unit || '').toUpperCase() === 'MHZ') {
        return numeric.toFixed(3);
    }
    return raw;
}

function normalizeSiaFrequencyServiceLabel(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return 'FREQ';
    if (raw === 'GND' || raw === 'GROUND') return 'SOL';
    return raw;
}


/*
 * v15.62 — enrichissement opérationnel des zones R.
 *
 * Ordre de priorité demandé :
 * 1) instruction explicite d'entrée/clairance/contact/autorisation ;
 * 2) gestionnaire publié (Administrator / Managing authority) ;
 * 3) service ATS explicite dans les premières lignes, hors listes "activity known".
 *
 * Une liste "Activity known on" ne sert JAMAIS à nommer la zone. Elle peut
 * uniquement fournir une fréquence de repli si le service retenu est clairement
 * cité sur la même ligne. Aucun rapprochement géographique n'est utilisé.
 */
const siaRestrictedRemarkInfoCache = new WeakMap();

function normalizeSiaAirspaceRemarkLines(item) {
    return String(item?.r || '')
        .replace(/#/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

function extractSiaOperationalServiceFromChunk(value) {
    let text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[\s\-–—:;,.]+/, '');

    // v15.64 — une condition météo/visibilité n'est pas un indicatif de service.
    if (/^(?:VISI|VISIBILITY|METEO|WEATHER)\b/i.test(text)) return null;

    text = text
        .replace(/^(?:ACTUAL\s+)?ACTIVITY\s+KNOWN\s+ON\s*:?\s*/i, '')
        .replace(/^RADIO\s+CONTACT(?:\s+MANDATORY)?\s+WITH\s*:?\s*/i, '');

    const match = text.match(
        /^(.{1,70}?)\s+(APP|TWR|INFO|SIV|FIS|ACC|FIC|AFIS|ATIS|A\/A|CONTROL)\b/i
    );
    if (!match) return null;

    let operationalName = String(match[1] || '')
        .trim()
        .replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '')
        .replace(/^.*:\s*/i, '')
        .replace(/^.*\b(?:THROUGH|FOLLOW|BY|ON|UPON|WITH|OF|AFTER|AND|OR|FROM)\s+/i, '')
        .replace(/^(?:MANDATORY|CONTACT|WITH|CLEARANCE)\s+/i, '')
        .trim()
        .toUpperCase();

    if (!operationalName || /^(?:NIL|NONE|N\/A)$/.test(operationalName)) return null;

    return {
        operationalName,
        serviceType: String(match[2] || '').trim().toUpperCase(),
        rawService: String(match[0] || '').trim()
    };
}

function extractSiaAeronauticalFrequencyFromText(value) {
    const text = String(value || '');
    const regex = /\b((?:1[1-3]\d|2\d{2}|3\d{2})(?:[.,]\d{1,3}))\s*(?:MHZ)?\b/i;
    const match = text.match(regex);
    if (!match) return '';

    const numeric = Number(String(match[1] || '').replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric < 118 || numeric >= 400) return '';
    return numeric.toFixed(3);
}

let siaRestrictedCrossReferenceNameIndex = null;

function normalizeSiaRestrictedReferenceCode(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/^LF\s*-?\s*R\s*/i, '')
        .replace(/\s+/g, '');
}

function cleanSiaRestrictedCrossReferenceName(value) {
    let name = String(value || '')
        .trim()
        .replace(/^[\s\-–—:;,.()]+|[\s\-–—:;,.()]+$/g, '')
        .replace(/\s+/g, ' ')
        .toUpperCase();

    // Ces mots décrivent l'état ou la relation, pas un nom géographique.
    if (!name || /^(?:IS|ARE|ACTIVE|ACTIVATED|WHEN|IF|PART|AREA|AREAS|ZONE|ZONES)\b/i.test(name)) return '';
    if (/^(?:ACTIVITY|ACTIVATION)\b/i.test(name)) return '';
    if (/\bLF\s*-\s*[PRD]\b/i.test(name)) return '';
    if (/^\d+(?:[./]\d+)*$/.test(name)) return '';

    /*
     * v15.64 — garde-fou contre les faux noms issus de conditions opérationnelles.
     * Exemple R8 : « VISI > or = 5 km : ATIS GARONS » ne doit jamais produire
     * « = 5 KM » comme nom de zone.
     */
    if (/(?:^|\b)(?:VISI|VISIBILITY|METEO|WEATHER)\b/i.test(name)) return '';
    if (/(?:>=|<=|>|<|=)\s*\d/i.test(name)) return '';
    if (/^=?\s*\d+(?:[.,]\d+)?\s*(?:KM|NM|FT|M|FL\d*)\b/i.test(name)) return '';
    return name;
}

function buildSiaRestrictedCrossReferenceNameIndex(dataset = siaDataset) {
    if (siaRestrictedCrossReferenceNameIndex) return siaRestrictedCrossReferenceNameIndex;

    const counts = new Map();
    const referenceRegex = /\bLF\s*-\s*R\s*([0-9A-Z./]+)\s+(.+?)(?=\s+(?:OR|AND)\s+LF\s*-\s*R\s*[0-9]|\s+(?:WHEN|INTERFERING|EXCEPT|EXCLUDING|WHICH|ACTIVITY|ACTIVATION|IS\s+ACTIVE|ARE\s+ACTIVE)\b|[#;,\n.]|$)/gi;

    (dataset?.airspaces || []).forEach(sourceItem => {
        const remark = String(sourceItem?.r || '');
        if (!remark) return;

        referenceRegex.lastIndex = 0;
        for (const match of remark.matchAll(referenceRegex)) {
            const code = normalizeSiaRestrictedReferenceCode(match?.[1]);
            const name = cleanSiaRestrictedCrossReferenceName(match?.[2]);
            if (!code || !name) continue;

            if (!counts.has(code)) counts.set(code, new Map());
            const nameCounts = counts.get(code);
            nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
        }
    });

    const index = new Map();
    counts.forEach((nameCounts, code) => {
        const ordered = [...nameCounts.entries()].sort((a, b) => {
            if (a[1] !== b[1]) return b[1] - a[1];
            if (a[0].length !== b[0].length) return b[0].length - a[0].length;
            return a[0].localeCompare(b[0], 'fr');
        });
        if (ordered[0]?.[0]) index.set(code, ordered[0][0]);
    });

    siaRestrictedCrossReferenceNameIndex = index;
    return index;
}

function getSiaRestrictedCrossReferenceName(item) {
    if (String(item?.t || '').trim().toUpperCase() !== 'R') return '';
    const code = normalizeSiaRestrictedReferenceCode(item?.c);
    if (!code) return '';
    return buildSiaRestrictedCrossReferenceNameIndex().get(code) || '';
}


/*
 * v15.65 — même principe pour les zones P : leur propre fiche contient
 * souvent seulement le numéro alors que d'autres espaces publient explicitement
 * "LF-P xx NOM" (P62 TOULON, P48 FORT DE BRÉGANÇON, P63 ILE DU LEVANT...).
 */
let siaProhibitedCrossReferenceNameIndex = null;

function normalizeSiaProhibitedReferenceCode(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/^LF\s*-?\s*P\s*/i, '')
        .replace(/\s+/g, '');
}

function buildSiaProhibitedCrossReferenceNameIndex(dataset = siaDataset) {
    if (siaProhibitedCrossReferenceNameIndex) return siaProhibitedCrossReferenceNameIndex;

    const counts = new Map();
    const referenceRegex = /\bLF\s*-\s*P\s*([0-9A-Z./]+)\s+(.+?)(?=\s+(?:OR|AND)\s+LF\s*-\s*[PRD]\s*[0-9]|,\s*LF\s*-\s*[PRD]\s*[0-9]|\s+(?:WHEN|INTERFERING|EXCEPT|EXCLUDING|WHICH|ACTIVITY|ACTIVATION|IS\s+ACTIVE|ARE\s+ACTIVE)\b|[#;\n.]|$)/gi;

    (dataset?.airspaces || []).forEach(sourceItem => {
        const remark = String(sourceItem?.r || '');
        if (!remark) return;

        referenceRegex.lastIndex = 0;
        for (const match of remark.matchAll(referenceRegex)) {
            const code = normalizeSiaProhibitedReferenceCode(match?.[1]);
            const name = cleanSiaRestrictedCrossReferenceName(match?.[2]);
            if (!code || !name) continue;

            if (!counts.has(code)) counts.set(code, new Map());
            const nameCounts = counts.get(code);
            nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
        }
    });

    const index = new Map();
    counts.forEach((nameCounts, code) => {
        const ordered = [...nameCounts.entries()].sort((a, b) => {
            if (a[1] !== b[1]) return b[1] - a[1];
            if (a[0].length !== b[0].length) return b[0].length - a[0].length;
            return a[0].localeCompare(b[0], 'fr');
        });
        if (ordered[0]?.[0]) index.set(code, ordered[0][0]);
    });

    siaProhibitedCrossReferenceNameIndex = index;
    return index;
}

function getSiaProhibitedCrossReferenceName(item) {
    if (String(item?.t || '').trim().toUpperCase() !== 'P') return '';
    const code = normalizeSiaProhibitedReferenceCode(item?.c);
    if (!code) return '';
    return buildSiaProhibitedCrossReferenceNameIndex().get(code) || '';
}

/*
 * v15.68 — les zones P utilisent désormais le NomUsuel de leur propre Partie
 * dans XML_SIA, embarqué dans item.pn. Les phrases réglementaires rencontrées
 * dans les remarques d'autres espaces ne sont plus admises comme nom de carte.
 * Si le SIA ne fournit pas de NomUsuel, le libellé reste volontairement P + numéro.
 */
function getSiaProhibitedOfficialName(item) {
    if (String(item?.t || '').trim().toUpperCase() !== 'P') return '';
    return String(item?.pn || '').trim();
}

function getSiaRestrictedAdministratorFallback(administratorChunk) {
    const chunk = String(administratorChunk || '').trim();
    if (!chunk) return null;

    const atsService = extractSiaOperationalServiceFromChunk(chunk);
    if (atsService) return atsService;

    /*
     * v15.64 — lorsqu'un gestionnaire publie lui-même un lieu géographique
     * explicite, celui-ci est plus fiable que le nom rencontré seulement dans
     * une référence croisée. Ex. « 2ème REI, camp des Garrigues » -> GARRIGUES.
     */
    const placePatterns = [
        /\bCAMP\s+(?:DES|DU|DE|D['’])\s*([A-ZÀ-ÖØ-öø-ÿ][A-ZÀ-ÖØ-öø-ÿ'’.\- ]{1,45}?)(?=[.;,]|$)/i,
        /\bBASE(?:\s+A[ÉE]RIENNE)?\s+(?:DES|DU|DE|D['’])\s*([A-ZÀ-ÖØ-öø-ÿ][A-ZÀ-ÖØ-öø-ÿ'’.\- ]{1,45}?)(?=[.;,]|$)/i,
        /\bCENTRE\s+(?:DES|DU|DE|D['’])\s*([A-ZÀ-ÖØ-öø-ÿ][A-ZÀ-ÖØ-öø-ÿ'’.\- ]{1,45}?)(?=[.;,]|$)/i
    ];

    for (const pattern of placePatterns) {
        const match = chunk.match(pattern);
        if (!match) continue;
        const operationalName = String(match[1] || '')
            .trim()
            .replace(/\s+/g, ' ')
            .toUpperCase();
        if (!operationalName) continue;
        return {
            operationalName,
            serviceType: '',
            rawService: String(match[0] || '').trim(),
            administratorGeographic: true
        };
    }

    /*
     * Gestionnaires militaires : le lieu est conservé, l'acronyme organique
     * n'est pas utilisé comme nom de zone. Ex. "CCER Istres or CMC Istres"
     * -> ISTRES.
     */
    const organizationMatch = chunk.match(
        /\b(?:CCER|CMC|CMCI|CDC|CLA|ESCA|CDPGE)\s+([A-ZÀ-ÖØ-öø-ÿ][A-ZÀ-ÖØ-öø-ÿ'’.\- ]{1,30}?)(?=\s+(?:OR|AND)\b|[.;,]|$)/i
    );
    const airForceBaseMatch = chunk.match(
        /^(.{2,30}?)\s+AIR\s+FORCE\s+BASE\b/i
    );
    const fallbackMatch = organizationMatch || airForceBaseMatch;
    if (!fallbackMatch) return null;

    const operationalName = String(fallbackMatch[1] || '')
        .split(/[.;,]/)[0]
        .trim()
        .toUpperCase();

    if (!operationalName) return null;
    return {
        operationalName,
        serviceType: '',
        rawService: String(fallbackMatch[0] || '').trim(),
        administratorGeographic: true
    };
}

function getSiaRestrictedRemarkInfo(item) {
    if (String(item?.t || '').trim().toUpperCase() !== 'R') return null;

    if (item && typeof item === 'object' && siaRestrictedRemarkInfoCache.has(item)) {
        return siaRestrictedRemarkInfoCache.get(item);
    }

    const lines = normalizeSiaAirspaceRemarkLines(item);
    let service = null;
    let frequency = '';
    let sourceKind = '';
    let administratorChunk = '';

    /*
     * 1) Priorité absolue aux instructions opérationnelles explicites.
     * Ex. R108B :
     * "entry with clearance from CAMARGUE Control 127.925 MHz"
     * -> CAMARGUE / 127.925.
     */
    const explicitOperationalRegex =
        /(?:entry(?:\s+\w+){0,4}\s+with\s+clearance\s+from|clearance\s+(?:from|by)|radio\s+contact(?:\s+mandatory)?\s+with|contact\s+with|with\s+authori[sz]ation\s+of|upon\s+.*authori[sz]ation|authori[sz]ation\s+(?:of|from|by)|authori[sz]ed\s+by)\s+(.+)/i;

    for (const line of lines) {
        const explicitMatch = line.match(explicitOperationalRegex);
        if (!explicitMatch) continue;

        const explicitService = extractSiaOperationalServiceFromChunk(explicitMatch[1]);
        if (!explicitService) continue;

        service = explicitService;
        frequency = extractSiaAeronauticalFrequencyFromText(line);
        sourceKind = 'explicit';
        break;
    }

    // 2) À défaut seulement : gestionnaire/autorité explicitement publié.
    if (!service) {
        for (const line of lines) {
            const administratorMatch = line.match(
                /(?:Admin(?:istrator|itrator)s?|Managing\s+authority)\s*:?\s*(.+)/i
            );
            if (!administratorMatch) continue;

            administratorChunk = String(administratorMatch[1] || '').trim();
            service = getSiaRestrictedAdministratorFallback(administratorChunk);
            if (service) {
                frequency = extractSiaAeronauticalFrequencyFromText(line);
                sourceKind = 'administrator';
                break;
            }
        }
    } else {
        // On mémorise quand même le gestionnaire pour la fiche, sans lui donner priorité.
        for (const line of lines) {
            const administratorMatch = line.match(
                /(?:Admin(?:istrator|itrator)s?|Managing\s+authority)\s*:?\s*(.+)/i
            );
            if (administratorMatch) {
                administratorChunk = String(administratorMatch[1] || '').trim();
                break;
            }
        }
    }

    /*
     * 3) Repli très conservateur : service ATS présent directement dans les
     * premières lignes, mais jamais une ligne "activity known".
     */
    if (!service) {
        for (const line of lines.slice(0, 4)) {
            if (/(?:actual\s+)?activity\s+known|activation\s+(?:known|provided|announced)/i.test(line)) continue;
            const directService = extractSiaOperationalServiceFromChunk(line);
            if (!directService) continue;
            service = directService;
            frequency = extractSiaAeronauticalFrequencyFromText(line);
            sourceKind = 'direct';
            break;
        }
    }

    const serviceOperationalName = String(service?.operationalName || '').trim();
    const crossReferenceName = getSiaRestrictedCrossReferenceName(item);

    /*
     * v15.63 — un vrai nom géographique publié ailleurs dans le même jeu SIA
     * devient le nom principal, sauf si une instruction explicite de clairance/
     * contact a fourni un service directement opérationnel (ex. R108B/CAMARGUE).
     */
    const operationalName = sourceKind === 'explicit'
        ? serviceOperationalName
        : (
            sourceKind === 'administrator' && service?.administratorGeographic
                ? serviceOperationalName
                : (crossReferenceName || serviceOperationalName)
        );

    /*
     * Fréquence de repli :
     * - si l'instruction opérationnelle retenue donne une fréquence, elle gagne ;
     * - sinon priorité à une ligne citant le SERVICE retenu ;
     * - les lignes "activity known" peuvent fournir la fréquence, mais jamais
     *   le NOM de la zone ;
     * - RAI n'est jamais affiché.
     */
    if (!frequency && serviceOperationalName) {
        const candidates = [];
        lines.forEach((line, lineIndex) => {
            const value = extractSiaAeronauticalFrequencyFromText(line);
            if (!value) return;

            const upperLine = line.toUpperCase();
            let score = 0;

            if (upperLine.includes(serviceOperationalName.toUpperCase())) score += 12;
            if (explicitOperationalRegex.test(line)) score += 10;
            if (/(?:Admin(?:istrator|itrator)s?|Managing\s+authority)/i.test(line)) score += 7;
            if (/(?:actual\s+)?activity\s+known|activation\s+(?:known|provided|announced)/i.test(line)) score += 3;
            if (/\bRAI\b/i.test(line)) score += 1;

            if (score <= 0) return;
            candidates.push({ score, lineIndex, value });
        });

        candidates.sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            return a.lineIndex - b.lineIndex;
        });

        frequency = candidates[0]?.value || '';
    }

    const result = {
        operationalName,
        serviceName: serviceOperationalName,
        crossReferenceName,
        serviceType: service?.serviceType || '',
        frequency,
        sourceKind: crossReferenceName && sourceKind !== 'explicit' ? 'cross-reference' : sourceKind,
        administrator: administratorChunk
    };

    if (item && typeof item === 'object') {
        try { siaRestrictedRemarkInfoCache.set(item, result); } catch (_) {}
    }
    return result;
}

function formatSiaCtrFrequencyRows(item) {
    const effectiveServices = getSiaEffectiveServices(item);
    const services = effectiveServices.services;

    if (!services.length) {
        const restrictedInfo = getSiaRestrictedRemarkInfo(item);
        if (!restrictedInfo?.frequency) return '';

        const frequencyDetailName = restrictedInfo.serviceName || restrictedInfo.operationalName || '';
        const detail = frequencyDetailName
            ? `<div class="sia-airspace-frequency-detail">${escapeHtml(frequencyDetailName)}</div>`
            : '';

        return `
            <div class="sia-airspace-frequency-block">
                <div class="sia-ctr-frequency-row">Fréquence : ${escapeHtml(restrictedInfo.frequency)}</div>
                ${detail}
            </div>
        `;
    }

    const grouped = new Map();

    services.forEach(service => {
        const type = normalizeSiaFrequencyServiceLabel(service?.[0]);
        const unitName = String(service?.[1] || '').trim();
        const frequencies = Array.isArray(service?.[2]) ? service[2] : [];

        if (!grouped.has(type)) {
            grouped.set(type, {
                unitNames: [],
                frequencies: []
            });
        }

        const group = grouped.get(type);
        if (unitName && !group.unitNames.includes(unitName)) {
            group.unitNames.push(unitName);
        }

        frequencies.forEach(freq => {
            const formatted = formatSiaCtrFrequencyValue(freq?.[0], freq?.[1]);
            if (!formatted) return;

            const supplementary = Number(freq?.[4] || 0) === 1;
            const hours = String(freq?.[2] || '').trim();
            const callsign = String(freq?.[3] || '').trim();
            const key = [
                formatted,
                supplementary ? 1 : 0,
                hours,
                callsign
            ].join('|');

            if (!group.frequencies.some(entry => entry.key === key)) {
                group.frequencies.push({
                    key,
                    value: formatted,
                    supplementary,
                    hours,
                    callsign
                });
            }
        });
    });

    return [...grouped.entries()]
        .filter(([, group]) => group.frequencies.length)
        .map(([type, group]) => {
            const ordered = [
                ...group.frequencies.filter(v => !v.supplementary),
                ...group.frequencies.filter(v => v.supplementary)
            ];

            const frequencyText = ordered
                .map(v => `${v.value}${v.supplementary ? ' (s)' : ''}`)
                .join(' / ');

            const detailPairs = ordered.map(v => ({
                frequency: `${v.value}${v.supplementary ? ' (s)' : ''}`,
                hours: v.hours,
                callsign: v.callsign
            }));

            const uniqueDetails = new Map();
            detailPairs.forEach(detail => {
                const key = `${detail.hours}|${detail.callsign}`;
                if (!uniqueDetails.has(key)) uniqueDetails.set(key, detail);
            });

            let detailsHtml = '';
            if (uniqueDetails.size === 1) {
                const detail = [...uniqueDetails.values()][0];
                const detailText = [detail.hours, detail.callsign].filter(Boolean).join(' — ');
                if (detailText) {
                    detailsHtml += `<div class="sia-airspace-frequency-detail">${escapeHtml(detailText)}</div>`;
                }
            } else {
                detailPairs.forEach(detail => {
                    const detailText = [
                        detail.frequency,
                        detail.hours,
                        detail.callsign
                    ].filter(Boolean).join(' — ');
                    if (detailText) {
                        detailsHtml += `<div class="sia-airspace-frequency-detail">${escapeHtml(detailText)}</div>`;
                    }
                });
            }

            const zoneCode = String(item?.c || '').trim().toUpperCase();
            const zoneName = String(item?.n || '').trim().toUpperCase();
            const redundantUnit = group.unitNames.length === 1
                && String(group.unitNames[0]).trim().toUpperCase() === `${zoneCode} ${zoneName}`.trim();

            if (group.unitNames.length && !redundantUnit) {
                detailsHtml += `<div class="sia-airspace-frequency-detail">${escapeHtml(group.unitNames.join(' / '))}</div>`;
            }

            return `
                <div class="sia-airspace-frequency-block">
                    <div class="sia-ctr-frequency-row">${escapeHtml(type)} : ${escapeHtml(frequencyText)}</div>
                    ${detailsHtml}
                </div>
            `;
        })
        .join('');
}

let siaTmaFamilyServicesIndex = null;

function getSiaTmaServiceSignature(services) {
    if (!Array.isArray(services) || !services.length) return '';
    try {
        return JSON.stringify(services);
    } catch (_) {
        return '';
    }
}

function buildSiaTmaFamilyServicesIndex(dataset = siaDataset) {
    if (siaTmaFamilyServicesIndex) return siaTmaFamilyServicesIndex;

    const families = new Map();

    (dataset?.airspaces || []).forEach(item => {
        if (String(item?.t || '').trim().toUpperCase() !== 'TMA') return;

        const services = Array.isArray(item?.sv) ? item.sv : [];
        if (!services.length) return;

        const family = getSiaTmaFamilyBaseFromSectorName(item?.n);
        if (!family) return;

        const signature = getSiaTmaServiceSignature(services);
        if (!signature) return;

        if (!families.has(family)) families.set(family, new Map());
        const signatures = families.get(family);
        if (!signatures.has(signature)) signatures.set(signature, services);
    });

    const index = new Map();
    families.forEach((signatures, family) => {
        /*
         * Héritage uniquement si tous les secteurs renseignés de la famille
         * convergent vers un unique bloc de services. Aucune fréquence n'est
         * déduite en cas d'ambiguïté.
         */
        if (signatures.size === 1) {
            index.set(family, [...signatures.values()][0]);
        }
    });

    siaTmaFamilyServicesIndex = index;
    return index;
}

function getSiaEffectiveServices(item) {
    const direct = Array.isArray(item?.sv) ? item.sv : [];
    if (direct.length) {
        return { services: direct, inheritedFromFamily: false };
    }

    if (String(item?.t || '').trim().toUpperCase() !== 'TMA') {
        return { services: [], inheritedFromFamily: false };
    }

    const family = getSiaTmaFamilyBaseFromSectorName(item?.n);
    if (!family) return { services: [], inheritedFromFamily: false };

    const inherited = buildSiaTmaFamilyServicesIndex().get(family);
    if (!Array.isArray(inherited) || !inherited.length) {
        return { services: [], inheritedFromFamily: false };
    }

    return {
        services: inherited,
        inheritedFromFamily: true,
        inheritedFamily: family
    };
}

function getSiaFirstAssignedFrequency(item) {
    /*
     * v15.67 — pour un SIV, la fréquence affichée sur la carte n'est choisie
     * que lorsque XML_SIA la rattache sans ambiguïté au secteur (sfp).
     * Les autres fréquences FIS restent visibles dans la fiche détaillée via sv.
     */
    if (isSiaFlightInformationSector(item)) {
        const volumeAssigned = getSiaVolumeAssignedFrequencies(item);
        if (volumeAssigned.length) {
            return {
                serviceType: 'FIS',
                value: volumeAssigned.join(' / '),
                supplementary: false,
                sourceDesignatedSiv: true,
                sourceSivVolumeActivity: true
            };
        }

        const preferred = Array.isArray(item?.sfp)
            ? item.sfp.map(value => String(value || '').trim()).filter(Boolean)
            : [];
        if (preferred.length) {
            return {
                serviceType: 'FIS',
                value: preferred.join(' / '),
                supplementary: false,
                sourceDesignatedSiv: true
            };
        }
        if (Number(item?.sfa || 0) === 1) return null;
    }

    const effectiveServices = getSiaEffectiveServices(item);
    const services = effectiveServices.services;
    const candidates = [];

    services.forEach((service, serviceIndex) => {
        const serviceType = normalizeSiaFrequencyServiceLabel(service?.[0]);
        const frequencies = Array.isArray(service?.[2]) ? service[2] : [];

        frequencies.forEach((freq, freqIndex) => {
            const value = formatSiaCtrFrequencyValue(freq?.[0], freq?.[1]);
            if (!value) return;

            candidates.push({
                serviceType,
                value,
                supplementary: Number(freq?.[4] || 0) === 1,
                serviceIndex,
                freqIndex,
                inheritedFromFamily: effectiveServices.inheritedFromFamily === true,
                inheritedFamily: effectiveServices.inheritedFamily || ''
            });
        });
    });

    if (!candidates.length) {
        const restrictedInfo = getSiaRestrictedRemarkInfo(item);
        if (!restrictedInfo?.frequency) return null;

        return {
            serviceType: restrictedInfo.serviceType || '',
            value: restrictedInfo.frequency,
            supplementary: false,
            inferredFromRemark: true
        };
    }

    // Première fréquence normale dans l'ordre SIA ; supplétive seulement à défaut.
    candidates.sort((a, b) => {
        if (a.supplementary !== b.supplementary) return a.supplementary ? 1 : -1;
        if (a.serviceIndex !== b.serviceIndex) return a.serviceIndex - b.serviceIndex;
        return a.freqIndex - b.freqIndex;
    });

    return candidates[0];
}

function getSiaAirspaceBoundaryLabelText(item) {
    const displayType = getSiaAirspaceDisplayType(item);
    const type = String(item?.t || '').trim().toUpperCase();
    const name = String(item?.n || '').trim();
    const code = String(item?.c || '').trim();
    const primaryName = name || code;
    const base = [displayType, primaryName].filter(Boolean).join(' ');

    /* v16.63 — ligne 1 = nom uniquement. */
    if (type === 'R') {
        const restrictedInfo = getSiaRestrictedRemarkInfo(item);
        return [base, String(restrictedInfo?.operationalName || '').trim()]
            .filter(Boolean).join(' / ');
    }
    if (type === 'P') {
        return [base, getSiaProhibitedOfficialName(item)].filter(Boolean).join(' / ');
    }
    return base;
}

function getSiaAirspaceBoundaryFrequencyText(item) {
    const type = String(item?.t || '').trim().toUpperCase();
    if (type === 'P') return '';

    if (type === 'R') {
        const restrictedInfo = getSiaRestrictedRemarkInfo(item);
        const value = String(restrictedInfo?.frequency || '').trim();
        if (!value) return '';
        const serviceType = String(restrictedInfo?.serviceType || '').trim();
        return [serviceType, value].filter(Boolean).join(' ');
    }

    const firstFrequency = getSiaFirstAssignedFrequency(item);
    if (!firstFrequency) return '';
    const frequencyPrefix = firstFrequency.inferredFromRemark
        ? String(firstFrequency.serviceType || '').trim()
        : String(firstFrequency.serviceType || '').trim();
    const frequencyText = [frequencyPrefix, firstFrequency.value].filter(Boolean).join(' ');
    return `${frequencyText}${firstFrequency.supplementary ? ' (s)' : ''}`;
}

function getSiaAirspaceBoundaryVerticalText(item) {
    const hasLower = hasSiaVerticalValue(item?.lo);
    const hasUpper = hasSiaVerticalValue(item?.up);
    if (!hasLower && !hasUpper) return '';

    const lower = hasLower ? formatSiaVertical(item.lo) : '—';
    const upper = hasUpper ? formatSiaVertical(item.up) : '—';
    return `${lower} – ${upper}`;
}

function getSiaAirspaceDisplayType(item) {
    const type = String(item?.t || '').trim().toUpperCase();
    const local = String(item?.l || '').trim().toUpperCase();

    // v15.65 — les RAS "FLIGHT INFORMATION SECTOR" sont présentés comme SIV.
    if (isSiaFlightInformationSector(item)) return 'SIV';

    // Pour les D-OTHER, le type local est plus utile opérationnellement.
    if (type === 'D-OTHER' && local) return local;
    return type || 'ESPACE';
}

function getSiaAirspaceDisplayTitle(item) {
    const displayType = getSiaAirspaceDisplayType(item);
    const type = String(item?.t || '').trim().toUpperCase();
    const name = String(item?.n || '').trim();
    const code = String(item?.c || '').trim();

    // v15.57 — une TMA est présentée par son nom opérationnel, sans doublon
    // du code technique de secteur (LFML1, LFMN2, etc.).
    if (type === 'TMA') {
        return [displayType, name].filter(Boolean).join(' / ');
    }

    // v15.61 — les zones R gardent leur numéro lisible et ajoutent, lorsqu'il
    // est explicitement disponible, le gestionnaire/service opérationnel.
    if (type === 'R') {
        const restrictedInfo = getSiaRestrictedRemarkInfo(item);
        return [
            displayType,
            name || code,
            restrictedInfo?.operationalName || ''
        ].filter(Boolean).join(' / ');
    }

    if (type === 'P') {
        return [
            displayType,
            name || code,
            getSiaProhibitedOfficialName(item)
        ].filter(Boolean).join(' / ');
    }

    return [displayType, code, name].filter(Boolean).join(' / ');
}

function isSiaTechnicalTmaUnionParent(item) {
    return String(item?.t || '').toUpperCase() === 'TMA'
        && Number(item?.tp || 0) === 1;
}

function normalizeSiaTmaFamilyName(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function getSiaTmaFamilyBaseFromSectorName(value) {
    const normalized = normalizeSiaTmaFamilyName(value);
    if (!normalized) return '';
    return normalized.replace(/\s+\d+(?:\.\d+)*$/, '').trim();
}

function hasSiaTmaVerticalLimits(item) {
    return hasSiaVerticalValue(item?.lo) || hasSiaVerticalValue(item?.up);
}

function buildSiaTmaOperationalFamilySet(dataset) {
    const families = new Set();

    for (const item of dataset?.airspaces || []) {
        if (String(item?.t || '').toUpperCase() !== 'TMA') continue;
        if (!hasSiaTmaVerticalLimits(item)) continue;

        const name = normalizeSiaTmaFamilyName(item?.n);
        const family = getSiaTmaFamilyBaseFromSectorName(name);

        if (family && family !== name) {
            families.add(family);
        }
    }
    return families;
}

function isSiaGenericTmaWithoutAltitude(item, operationalFamilies) {
    if (String(item?.t || '').toUpperCase() !== 'TMA') return false;
    if (hasSiaTmaVerticalLimits(item)) return false;

    const name = normalizeSiaTmaFamilyName(item?.n);
    return !!name
        && operationalFamilies instanceof Set
        && operationalFamilies.has(name);
}

function hasSiaVerticalValue(raw) {
    return Array.isArray(raw) && String(raw?.[1] || '').trim() !== '';
}

function formatSiaAirspaceRemark(value) {
    return escapeHtml(String(value || '').trim()).replace(/#|\n/g, '<br>');
}

function buildSiaAirspacePopup(item) {
    const displayType = getSiaAirspaceDisplayType(item);
    const title = getSiaAirspaceDisplayTitle(item);
    const typeClass = [displayType, item?.cl].filter(Boolean).join(' / ');
    const vertical = `${formatSiaVertical(item?.lo)} / ${formatSiaVertical(item?.up)}`;
    const frequencyRows = formatSiaCtrFrequencyRows(item);

    const minVertical = hasSiaVerticalValue(item?.mi)
        ? formatSiaVertical(item.mi)
        : '';
    const maxVertical = hasSiaVerticalValue(item?.ma)
        ? formatSiaVertical(item.ma)
        : '';

    const activity = String(item?.a || '').trim();
    const identifier = String(item?.i || '').trim();
    const code = String(item?.c || '').trim();
    const remark = String(item?.r || '').trim();

    /*
     * v15.55 — présentation identique pour toutes les zones :
     * - les 3 lignes principales restent sans libellés ;
     * - toutes les autres données opérationnelles réellement présentes dans
     *   le payload SIA sont ajoutées ;
     * - aucune information n'est déduite par proximité.
     */
    return `
        <div class="sia-popup sia-ctr-popup sia-ctr-popup-compact sia-airspace-popup-compact">
            <div class="sia-popup-title">${escapeHtml(title || displayType)}</div>

            <div class="sia-ctr-info-row">${escapeHtml(typeClass || displayType)}</div>
            <div class="sia-ctr-info-row">${escapeHtml(vertical)}</div>

            ${minVertical ? `<div class="sia-airspace-extra-row">MIN : ${escapeHtml(minVertical)}</div>` : ''}
            ${maxVertical ? `<div class="sia-airspace-extra-row">MAX : ${escapeHtml(maxVertical)}</div>` : ''}

            ${frequencyRows}

            ${activity ? `
                <div class="sia-airspace-section">
                    <div class="sia-airspace-section-title">ACTIVITÉ</div>
                    <div class="sia-airspace-extra-row">${formatSiaAirspaceRemark(activity)}</div>
                </div>
            ` : ''}

            ${identifier && identifier !== code ? `
                <div class="sia-airspace-section">
                    <div class="sia-airspace-section-title">IDENTIFIANT</div>
                    <div class="sia-airspace-extra-row">${escapeHtml(identifier)}</div>
                </div>
            ` : ''}

            ${remark ? `
                <div class="sia-airspace-section">
                    <div class="sia-airspace-section-title">REMARQUES</div>
                    <div class="sia-airspace-extra-row sia-airspace-remark">${formatSiaAirspaceRemark(remark)}</div>
                </div>
            ` : ''}
        </div>
    `;
}

function getSiaAirspaceStyle(item) {
    const type = String(item?.t || '');
    const local = String(item?.l || '');

    let color = '#3559e0';
    let dashArray = null;
    let fillOpacity = 0;
    let weight = 2.2;
    let opacity = 0.95;

    if (isSiaFlightInformationSector(item)) {
        color = '#ffea00';
        weight = 3.2;
        opacity = 1;
        dashArray = null;
        fillOpacity = 0;
    }
    else if (type === 'P') color = '#d50000';
    else if (type === 'R') color = '#ff6d00';
    else if (type === 'D') color = '#e91e63';
    else if (type === 'TRA') { color = '#ff6d00'; dashArray = '7 5'; }
    else if (type === 'CTR') {
        color = '#0066ff';
        weight = Number(item?.co || 0) === 1 ? 1.7 : 2.4;
        opacity = Number(item?.co || 0) === 1 ? 0.65 : 1;
        fillOpacity = 0;

    }
    else if (type === 'TMA') color = '#673ab7';
    else if (type === 'CTA') color = '#3f51b5';
    else if (type === 'FIR' || type === 'UIR' || type === 'UIR-P' || type === 'UTA' || type === 'OCA') {
        color = '#455a64';
        dashArray = '9 6';
        fillOpacity = 0;
    } else if (type === 'SECTOR' || type === 'SECTOR-C' || type === 'RAS') {
        color = '#607d8b';
        dashArray = '6 5';
        fillOpacity = 0;
    } else if (type === 'D-OTHER') {
        color = '#8e24aa';
        dashArray = '5 4';
        if (local === 'PJE') color = '#d81b60';
        else if (local === 'AER') color = '#00897b';
        else if (local === 'VOL') color = '#3949ab';
        else if (local === 'SUR') color = '#6d4c41';
        else if (local === 'PRN') color = '#f4511e';
        else if (local === 'BAL') color = '#7b1fa2';
    }

    /*
     * v15.54 — sur le fond OACI, TOUS les espaces SIA restent actifs/tactiles
     * mais leur dessin normal est masqué. Seule la zone sélectionnée se colore.
     */
    if (isCurrentOfflineOaciMap()) {
        opacity = 0;
        fillOpacity = 0;
    }

    return {
        color,
        weight,
        opacity,
        fillColor: color,
        fillOpacity,
        dashArray,
        lineCap: 'round',
        lineJoin: 'round'
    };
}

function getSiaCtrOuterRings(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return [];
    if (geometry.type === 'Polygon') {
        return geometry.coordinates.length ? [geometry.coordinates[0]] : [];
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates
            .map(polygon => Array.isArray(polygon) && polygon.length ? polygon[0] : null)
            .filter(Boolean);
    }
    return [];
}

function buildSiaCtrInsetSegmentsLatLngs(ring, geometry, insetPixels = 7) {
    if (!map || !geometry || !Array.isArray(ring) || ring.length < 3) return [];

    const raw = ring.slice();
    const first = raw[0];
    const last = raw[raw.length - 1];
    const isClosed = Array.isArray(first) && Array.isArray(last)
        && Number(first[0]) === Number(last[0])
        && Number(first[1]) === Number(last[1]);

    if (!isClosed && raw.length >= 3) raw.push(raw[0]);

    const segments = [];
    const preferredInset = Math.max(7, Number(insetPixels) || 7);
    const insetCandidates = [preferredInset, 6, 5, 4, 3, 2]
        .filter((value, index, values) => value > 0 && values.indexOf(value) === index)
        .sort((a, b) => b - a);
    const MAX_SUBDIVISION_DEPTH = 7;
    const MIN_SOURCE_PIECE_PX = 3;

    const isLayerPointInsideGeometry = point => {
        try {
            return siaGeometryContainsLatLng(geometry, map.layerPointToLatLng(point));
        } catch (_) {
            return false;
        }
    };

    const movePointToward = (from, to, distancePx) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= 0 || distancePx <= 0) return from;
        const ratio = Math.min(1, distancePx / length);
        return L.point(
            from.x + dx * ratio,
            from.y + dy * ratio
        );
    };

    const findFirstInsideTowardMid = (endpoint, midpoint) => {
        if (isLayerPointInsideGeometry(endpoint)) return endpoint;
        if (!isLayerPointInsideGeometry(midpoint)) return null;

        let outside = endpoint;
        let inside = midpoint;
        for (let step = 0; step < 9; step += 1) {
            const candidate = L.point(
                (outside.x + inside.x) / 2,
                (outside.y + inside.y) / 2
            );
            if (isLayerPointInsideGeometry(candidate)) inside = candidate;
            else outside = candidate;
        }

        // 2 px suffisent : l'axe reste déjà décalé de 7 px pour un trait de 12 px.
        return movePointToward(inside, midpoint, 2);
    };

    const tryInsetPiece = (pa, pb, trimStart, trimEnd) => {
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 2) return null;

        const tx = dx / length;
        const ty = dy / length;
        const endpointTrim = Math.min(5, length * 0.16);
        const startTrim = trimStart ? endpointTrim : 0;
        const endTrim = trimEnd ? endpointTrim : 0;
        if (startTrim + endTrim >= length - 1) return null;

        const baseA = L.point(pa.x + tx * startTrim, pa.y + ty * startTrim);
        const baseB = L.point(pb.x - tx * endTrim, pb.y - ty * endTrim);
        const normals = [
            { x: -ty, y: tx },
            { x: ty, y: -tx }
        ];

        /*
         * v15.80 — 7 px reste la cible. Si la géométrie locale devient trop
         * étroite à un niveau de zoom donné, on rapproche progressivement l'axe
         * de la limite au lieu de faire disparaître toute la bande.
         */
        for (const inset of insetCandidates) {
            let best = null;
            for (const normal of normals) {
                const shiftedA = L.point(
                    baseA.x + normal.x * inset,
                    baseA.y + normal.y * inset
                );
                const shiftedB = L.point(
                    baseB.x + normal.x * inset,
                    baseB.y + normal.y * inset
                );
                const shiftedMid = L.point(
                    (shiftedA.x + shiftedB.x) / 2,
                    (shiftedA.y + shiftedB.y) / 2
                );

                if (!isLayerPointInsideGeometry(shiftedMid)) continue;

                const safeA = findFirstInsideTowardMid(shiftedA, shiftedMid);
                const safeB = findFirstInsideTowardMid(shiftedB, shiftedMid);
                if (!safeA || !safeB) continue;

                const safeLength = Math.hypot(safeB.x - safeA.x, safeB.y - safeA.y);
                if (!Number.isFinite(safeLength) || safeLength < 2) continue;

                const testRatios = safeLength < 12 ? [0.35, 0.50, 0.65] : [0.20, 0.35, 0.50, 0.65, 0.80];
                const allInside = testRatios.every(ratio => isLayerPointInsideGeometry(L.point(
                    safeA.x + (safeB.x - safeA.x) * ratio,
                    safeA.y + (safeB.y - safeA.y) * ratio
                )));
                if (!allInside) continue;

                if (!best || safeLength > best.safeLength) {
                    best = { safeA, safeB, safeLength };
                }
            }
            if (best) return [best.safeA, best.safeB];
        }

        return null;
    };

    const buildPieceRecursively = (pa, pb, depth, trimStart, trimEnd) => {
        const direct = tryInsetPiece(pa, pb, trimStart, trimEnd);
        if (direct) return [direct];

        const length = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        if (
            depth >= MAX_SUBDIVISION_DEPTH
            || !Number.isFinite(length)
            || length < MIN_SOURCE_PIECE_PX
        ) {
            return [];
        }

        /*
         * v15.80 — subdivision de dernier recours. Les petites portions ne sont
         * plus abandonnées au seuil fixe de 10 px de v15.79 ; le décalage local
         * adaptatif est essayé avant chaque nouvelle subdivision.
         */
        const midpoint = L.point((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
        return [
            ...buildPieceRecursively(pa, midpoint, depth + 1, trimStart, false),
            ...buildPieceRecursively(midpoint, pb, depth + 1, false, trimEnd)
        ];
    };

    for (let i = 1; i < raw.length; i += 1) {
        const a = raw[i - 1];
        const b = raw[i];
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;

        const pa = map.latLngToLayerPoint(L.latLng(Number(a[1]), Number(a[0])));
        const pb = map.latLngToLayerPoint(L.latLng(Number(b[1]), Number(b[0])));
        const pieces = buildPieceRecursively(pa, pb, 0, true, true);

        pieces.forEach(piece => {
            if (!Array.isArray(piece) || piece.length !== 2) return;
            segments.push([
                map.layerPointToLatLng(piece[0]),
                map.layerPointToLatLng(piece[1])
            ]);
        });
    }

    return segments;
}

function addSiaCtrInnerBand(geometry, color = '#0066ff') {
    if (!siaLayerGroup || !geometry || isCurrentOfflineOaciMap()) return [];
    const createdLayers = [];
    const rings = getSiaCtrOuterRings(geometry);
    rings.forEach(ring => {
        const segments = buildSiaCtrInsetSegmentsLatLngs(ring, geometry, 7);
        if (!segments.length) return;

        const layer = L.polyline(segments, {
            pane: 'siaAirspacePane',
            renderer: siaAirspaceRenderer,
            color,
            weight: 12,
            opacity: 0.22,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false
        }).addTo(siaLayerGroup);
        createdLayers.push(layer);
    });
    return createdLayers;
}

function normalizeSiaBoundaryLabelAngle(angleDeg) {
    let angle = Number(angleDeg) || 0;
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return angle;
}

function getSiaBoundaryLabelPriority(item) {
    const type = String(item?.t || '').trim().toUpperCase();
    if (type === 'CTR') return 10;
    if (type === 'R' || type === 'P' || type === 'D') return 20;
    if (type === 'TRA') return 25;
    if (type === 'TMA') return 30;
    if (type === 'CTA') return 40;
    if (isSiaFlightInformationSector(item)) return 45;
    if (type === 'D-OTHER') return 50;
    return 60;
}

function getSiaBoundaryLabelMinimumSegmentPx(item) {
    const priority = getSiaBoundaryLabelPriority(item);
    if (priority <= 10) return 34; // CTR : priorité maximale, notamment SALON.
    if (priority <= 20) return 38; // R / P / D.
    if (priority <= 30) return 44;
    return 50;
}

/*
 * v15.68 — les zones P petites/circulaires ne doivent pas dépendre de la longueur
 * d'un segment issu de la discrétisation du contour. On construit plusieurs points
 * intérieurs autour du centroïde/barycentre écran et on les essaie avant les
 * placements le long des segments. Le texte reste horizontal.
 */
function buildSiaProhibitedInteriorLabelPlacements(geometry, bounds) {
    if (!map || !geometry) return [];
    const rings = getSiaCtrOuterRings(geometry);
    const placements = [];
    const seen = new Set();

    const polygonCentroid = points => {
        let twiceArea = 0;
        let cx = 0;
        let cy = 0;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const a = points[j];
            const b = points[i];
            const cross = a.x * b.y - b.x * a.y;
            twiceArea += cross;
            cx += (a.x + b.x) * cross;
            cy += (a.y + b.y) * cross;
        }
        if (Math.abs(twiceArea) < 0.001) return null;
        return L.point(cx / (3 * twiceArea), cy / (3 * twiceArea));
    };

    rings.forEach(ring => {
        if (!Array.isArray(ring) || ring.length < 3) return;
        const points = ring.map(coord =>
            map.latLngToContainerPoint(L.latLng(Number(coord[1]), Number(coord[0])))
        ).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
        if (points.length < 3) return;

        const xs = points.map(point => point.x);
        const ys = points.map(point => point.y);
        const bboxCenter = L.point((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
        const mean = L.point(
            points.reduce((sum, point) => sum + point.x, 0) / points.length,
            points.reduce((sum, point) => sum + point.y, 0) / points.length
        );
        const centroid = polygonCentroid(points);
        const bases = [centroid, bboxCenter, mean].filter(Boolean);
        const offsets = [
            [0, 0], [0, -18], [0, 18], [-24, 0], [24, 0],
            [-20, -16], [20, -16], [-20, 16], [20, 16],
            [0, -30], [0, 30], [-36, 0], [36, 0]
        ];

        bases.forEach((base, baseIndex) => {
            offsets.forEach((offset, offsetIndex) => {
                const point = L.point(base.x + offset[0], base.y + offset[1]);
                const key = `${Math.round(point.x / 3)}:${Math.round(point.y / 3)}`;
                if (seen.has(key)) return;
                const latlng = map.containerPointToLatLng(point);
                if (bounds && !bounds.contains(latlng)) return;
                if (!siaGeometryContainsLatLng(geometry, latlng)) return;
                seen.add(key);
                placements.push({
                    latlng,
                    point,
                    angle: 0,
                    lengthPx: 100000 - baseIndex * 1000 - offsetIndex,
                    insetPx: 0,
                    interior: true
                });
            });
        });
    });

    return placements;
}

function findSiaBoundaryLabelPlacements(item, geometry) {
    if (!map || !geometry) return [];

    const rings = getSiaCtrOuterRings(geometry);
    if (!rings.length) return [];

    const bounds = map.getBounds().pad(-0.01);
    const minimumLengthPx = getSiaBoundaryLabelMinimumSegmentPx(item);
    const placements = [];

    if (String(item?.t || '').trim().toUpperCase() === 'P') {
        placements.push(...buildSiaProhibitedInteriorLabelPlacements(geometry, bounds));
    }

    rings.forEach(ring => {
        if (!Array.isArray(ring) || ring.length < 2) return;

        for (let i = 1; i < ring.length; i += 1) {
            const a = ring[i - 1];
            const b = ring[i];
            if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;

            const aLatLng = L.latLng(Number(a[1]), Number(a[0]));
            const bLatLng = L.latLng(Number(b[1]), Number(b[0]));
            const pa = map.latLngToContainerPoint(aLatLng);
            const pb = map.latLngToContainerPoint(bLatLng);
            const lengthPx = pa.distanceTo(pb);
            if (!Number.isFinite(lengthPx) || lengthPx < minimumLengthPx) continue;

            const midpoint = L.point((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
            const dx = pb.x - pa.x;
            const dy = pb.y - pa.y;
            const segmentLength = Math.hypot(dx, dy);
            if (!Number.isFinite(segmentLength) || segmentLength < 1) continue;

            const angle = normalizeSiaBoundaryLabelAngle(
                Math.atan2(dy, dx) * 180 / Math.PI
            );

            /*
             * Le texte ne doit plus être posé sur le trait plein.
             * On teste les deux normales au segment et plusieurs retraits.
             * Seul un point réellement contenu dans le polygone est retenu.
             */
            const normals = [
                { x: -dy / segmentLength, y: dx / segmentLength },
                { x: dy / segmentLength, y: -dx / segmentLength }
            ];
            const insetDistances = [22, 30, 38];
            let insidePlacement = null;

            for (const insetPx of insetDistances) {
                for (const normal of normals) {
                    const point = L.point(
                        midpoint.x + normal.x * insetPx,
                        midpoint.y + normal.y * insetPx
                    );
                    const latlng = map.containerPointToLatLng(point);
                    if (!bounds.contains(latlng)) continue;
                    if (!siaGeometryContainsLatLng(geometry, latlng)) continue;

                    insidePlacement = {
                        latlng,
                        point,
                        angle,
                        lengthPx,
                        insetPx
                    };
                    break;
                }
                if (insidePlacement) break;
            }

            if (insidePlacement) placements.push(insidePlacement);
        }
    });

    /*
     * Les segments les plus longs sont essayés d'abord. En cas de collision,
     * addSiaAirspaceBoundaryLabel() essaie les suivants au lieu d'abandonner.
     */
    placements.sort((a, b) => {
        if (!!a.interior !== !!b.interior) return a.interior ? -1 : 1;
        if (a.lengthPx !== b.lengthPx) return b.lengthPx - a.lengthPx;
        return b.insetPx - a.insetPx;
    });

    return placements;
}

function addSiaAirspaceBoundaryLabel(item, geometry, labelState) {
    if (!siaLayerGroup || !map || !item || !geometry) return null;
    if (isCurrentOfflineOaciMap()) return null;
    if (Number(item?.co || 0) === 1) return null;

    /* v15.81 — à partir de l'échelle 10 NM en dézoomant, conserver les zones
     * mais supprimer leurs noms/fréquences/altitudes pour alléger la carte. */
    if (getCurrentNpfScaleNm() >= 10) return null;

    const type = String(geometry.type || '');
    if (type !== 'Polygon' && type !== 'MultiPolygon') return null;

    const state = labelState || { points: [], count: 0 };
    if (state.count >= 70) return null;

    const text = getSiaAirspaceBoundaryLabelText(item);
    if (!text) return null;
    const frequencyText = getSiaAirspaceBoundaryFrequencyText(item);
    const verticalText = getSiaAirspaceBoundaryVerticalText(item);

    const placements = findSiaBoundaryLabelPlacements(item, geometry);
    if (!placements.length) return null;

    const priority = getSiaBoundaryLabelPriority(item);
    const nearFiveNm = getCurrentNpfScaleNm() <= 5.000001;
    const isSiv = isSiaFlightInformationSector(item);
    const collisionDistance = (priority <= 20 ? 92 : 105) + (nearFiveNm ? 18 : 0) + (isSiv ? 12 : 0);
    const placement = placements.find(candidate =>
        !state.points.some(point => point.distanceTo(candidate.point) < collisionDistance)
    );
    if (!placement) return null;

    const marker = L.marker(placement.latlng, {
        pane: 'siaAirspacePane',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
            className: 'sia-boundary-label-icon',
            html: `<div class="sia-boundary-label-text${String(item?.t || '').trim().toUpperCase() === 'P' ? ' sia-prohibited-label' : ''}${isSiv ? ' sia-siv-label' : ''}${nearFiveNm ? ' sia-zone-label-near' : ''}" style="transform:translate(-50%,-50%) rotate(${placement.angle.toFixed(1)}deg)"><div class="sia-boundary-label-main">${escapeHtml(text)}</div>${frequencyText ? `<div class="sia-boundary-label-frequency">${escapeHtml(frequencyText)}</div>` : ''}${verticalText ? `<div class="sia-boundary-label-altitude">${escapeHtml(verticalText)}</div>` : ''}</div>`,
            iconSize: [1, 1],
            iconAnchor: [0, 0]
        })
    });

    marker.addTo(siaLayerGroup);
    state.points.push(placement.point);
    state.count += 1;
    return marker;
}

function getCurrentNpfScaleNm() {
    if (!map || !map.getSize || !map.containerPointToLatLng || !map.distance) return Infinity;
    const size = map.getSize();
    if (!size || !size.x || !size.y) return Infinity;

    const samplePixels = Math.min(160, Math.max(80, Math.floor(size.x * 0.16)));
    const y = Math.max(10, Math.floor(size.y / 2));
    const x1 = Math.max(5, Math.floor((size.x - samplePixels) / 2));
    const x2 = x1 + samplePixels;

    const ll1 = map.containerPointToLatLng(L.point(x1, y));
    const ll2 = map.containerPointToLatLng(L.point(x2, y));
    const meters = map.distance(ll1, ll2);
    const metersPerPixel = meters / samplePixels;
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return Infinity;

    return chooseNiceNauticalScale((metersPerPixel * 110) / 1852);
}

function shouldDisplaySiaDesignatedPoints() {
    return getCurrentNpfScaleNm() <= 5.000001;
}

function getSiaCtrSelectionKey(item) {
    return [
        String(item?.t || ''),
        String(item?.l || ''),
        String(item?.c || ''),
        String(item?.n || ''),
        JSON.stringify(item?.lo || null),
        JSON.stringify(item?.up || null)
    ].join('|');
}

function getSiaAirspaceSelectionColor(item) {
    try {
        return String(getSiaAirspaceStyle(item)?.color || '#0066ff');
    } catch (_) {
        return '#0066ff';
    }
}

function ensureSiaSelectionLayer() {
    if (!map) return null;
    ensureSiaMapPanes();

    if (!siaSelectionLayer) {
        siaSelectionLayer = L.layerGroup().addTo(map);
    }
    return siaSelectionLayer;
}

function clearSiaSelectionHighlight() {
    if (siaSelectionLayer) {
        try { siaSelectionLayer.clearLayers(); } catch (_) {}
    }
}

function drawSiaSelectionHighlight(item, geometry) {
    if (!map || !item || !geometry) return;

    const targetLayer = ensureSiaSelectionLayer();
    if (!targetLayer) return;

    clearSiaSelectionHighlight();

    const selectionColor = getSiaAirspaceSelectionColor(item);
    const feature = {
        type: 'Feature',
        properties: {},
        geometry
    };

    const highlight = L.geoJSON(feature, {
        pane: 'siaSelectionPane',
        renderer: siaSelectionRenderer || undefined,
        interactive: false,
        style: {
            color: selectionColor,
            weight: 2.6,
            opacity: 1,
            fillColor: selectionColor,
            fillOpacity: 0.30,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false
        },
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
            pane: 'siaSelectionPane',
            renderer: siaSelectionRenderer || undefined,
            radius: 11,
            color: selectionColor,
            weight: 3,
            opacity: 1,
            fillColor: selectionColor,
            fillOpacity: 0.30,
            interactive: false
        })
    });

    highlight.addTo(targetLayer);
}

function resetSelectedSiaCtrTouchLayer(clearKey = true) {
    clearSiaSelectionHighlight();
    siaSelectedCtrTouchLayer = null;
    siaSelectedAirspaceItem = null;
    siaSelectedAirspaceGeometry = null;
    if (clearKey) siaSelectedCtrKey = null;
}

function selectSiaCtrTouchLayer(layer, item, latlng, geometry = null, options = {}) {
    if (!map || !item) return;

    const selectionKey = getSiaCtrSelectionKey(item);

    if (siaSelectedCtrKey && siaSelectedCtrKey !== selectionKey) {
        resetSelectedSiaCtrTouchLayer(false);
    }

    /*
     * v15.59 — la coloration ne dépend plus de la couche tactile.
     * Une popup Leaflet avec autoPan peut déclencher moveend puis reconstruire
     * les couches SIA. La géométrie sélectionnée est donc surlignée dans une
     * couche indépendante qui survit au rafraîchissement.
     */
    let selectedGeometry = geometry;
    if (!selectedGeometry) {
        const currentEntry = siaAirspaceTouchEntries.find(entry =>
            entry?.layer === layer
            || getSiaCtrSelectionKey(entry?.item) === selectionKey
        );
        selectedGeometry = currentEntry?.geometry || null;
        if (currentEntry?.layer) layer = currentEntry.layer;
    }

    siaSelectedCtrTouchLayer = layer || null;
    siaSelectedCtrKey = selectionKey;
    siaSelectedAirspaceItem = item;
    siaSelectedAirspaceGeometry = selectedGeometry;

    if (selectedGeometry) {
        drawSiaSelectionHighlight(item, selectedGeometry);
    }

    const popupLatLng = latlng;
    if (!popupLatLng) return;

    const choiceOrigin = options?.choiceOrigin
        ? L.latLng(Number(options.choiceOrigin.lat), Number(options.choiceOrigin.lng))
        : null;

    let popupContent = buildSiaAirspacePopup(item);
    if (choiceOrigin && Number.isFinite(choiceOrigin.lat) && Number.isFinite(choiceOrigin.lng)) {
        const wrapper = document.createElement('div');
        wrapper.className = 'sia-airspace-detail-with-return';

        const backButton = document.createElement('button');
        backButton.type = 'button';
        backButton.className = 'sia-airspace-choice-return';
        backButton.textContent = '← RETOUR';
        backButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            resetSelectedSiaCtrTouchLayer(true);
            try { map.closePopup(popup); } catch (_) {}

            setTimeout(() => {
                const freshCandidates = getSiaAirspaceTouchCandidates(choiceOrigin);
                const returnCandidates = freshCandidates.length
                    ? freshCandidates
                    : (Array.isArray(options?.choiceCandidates) ? options.choiceCandidates : []);
                if (returnCandidates.length) {
                    openSiaAirspaceChoicePopup(choiceOrigin, returnCandidates);
                }
            }, 0);
        });

        const details = document.createElement('div');
        details.innerHTML = popupContent;
        wrapper.appendChild(backButton);
        wrapper.appendChild(details);
        popupContent = wrapper;
    }

    const popup = L.popup({
        maxWidth: 400,
        /*
         * v15.77 — en Suivi, la position/trajectoire de l'avion est prioritaire.
         * La popup reste ancrée à la zone et peut sortir de l'écran ; Leaflet ne
         * déplace plus la carte en sens inverse pour la garder visible.
         */
        autoPan: !centerGpsFollowActive,
        keepInView: !centerGpsFollowActive,
        className: 'sia-airspace-dialog-popup sia-airspace-detail-popup'
    })
        .setLatLng(popupLatLng)
        .setContent(popupContent)
        .openOn(map);

    const onPopupClose = event => {
        if (event?.popup !== popup) return;
        map.off('popupclose', onPopupClose);

        /*
         * La couche tactile a pu être reconstruite pendant l'autoPan.
         * On compare donc la clé métier, pas la référence Leaflet du layer.
         */
        if (siaSelectedCtrKey === selectionKey) {
            resetSelectedSiaCtrTouchLayer(true);
        }
    };
    map.on('popupclose', onPopupClose);
}

function siaPointInRing(lng, lat, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;

        const xi = Number(a[0]);
        const yi = Number(a[1]);
        const xj = Number(b[0]);
        const yj = Number(b[1]);
        if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

        const intersects = ((yi > lat) !== (yj > lat))
            && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersects) inside = !inside;
    }

    return inside;
}

function siaPointInPolygonCoordinates(lng, lat, polygonCoordinates) {
    if (!Array.isArray(polygonCoordinates) || !polygonCoordinates.length) return false;
    if (!siaPointInRing(lng, lat, polygonCoordinates[0])) return false;

    // Trous éventuels du polygone.
    for (let i = 1; i < polygonCoordinates.length; i += 1) {
        if (siaPointInRing(lng, lat, polygonCoordinates[i])) return false;
    }
    return true;
}

function siaDistancePointToSegmentPx(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return Infinity;

    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 1e-9) return point.distanceTo(a);

    let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    return point.distanceTo(L.point(
        a.x + t * dx,
        a.y + t * dy
    ));
}

function siaPointGeometryDistancePx(latlng, coordinate) {
    if (!map || !latlng || !Array.isArray(coordinate) || coordinate.length < 2) return Infinity;
    const lng = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return Infinity;

    const a = map.latLngToLayerPoint(latlng);
    const b = map.latLngToLayerPoint(L.latLng(lat, lng));
    return a.distanceTo(b);
}

function siaLineGeometryDistancePx(latlng, coordinates) {
    if (!map || !latlng || !Array.isArray(coordinates) || coordinates.length < 2) return Infinity;

    const point = map.latLngToLayerPoint(latlng);
    let best = Infinity;

    for (let i = 1; i < coordinates.length; i += 1) {
        const c1 = coordinates[i - 1];
        const c2 = coordinates[i];
        if (!Array.isArray(c1) || !Array.isArray(c2) || c1.length < 2 || c2.length < 2) continue;

        const a = map.latLngToLayerPoint(L.latLng(Number(c1[1]), Number(c1[0])));
        const b = map.latLngToLayerPoint(L.latLng(Number(c2[1]), Number(c2[0])));
        best = Math.min(best, siaDistancePointToSegmentPx(point, a, b));
    }

    return best;
}

function siaGeometryContainsLatLng(geometry, latlng) {
    if (!geometry || !latlng) return false;
    const lng = Number(latlng.lng);
    const lat = Number(latlng.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;

    if (geometry.type === 'Polygon') {
        return siaPointInPolygonCoordinates(lng, lat, geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon') {
        return (geometry.coordinates || []).some(poly =>
            siaPointInPolygonCoordinates(lng, lat, poly)
        );
    }

    /*
     * v15.59 — une grande partie des D-OTHER SIA (AER, VOL, SUR, PJE,
     * PRN, TRVL, TRPLA, AP, BAL...) est publiée comme un point AIXM.
     * La sélection est donc faite avec une tolérance tactile en pixels.
     */
    if (geometry.type === 'Point') {
        return siaPointGeometryDistancePx(latlng, geometry.coordinates) <= 30;
    }

    if (geometry.type === 'MultiPoint') {
        return (geometry.coordinates || []).some(coord =>
            siaPointGeometryDistancePx(latlng, coord) <= 30
        );
    }

    // Prévu également pour d'éventuelles géométries linéaires futures.
    if (geometry.type === 'LineString') {
        return siaLineGeometryDistancePx(latlng, geometry.coordinates) <= 18;
    }

    if (geometry.type === 'MultiLineString') {
        return (geometry.coordinates || []).some(line =>
            siaLineGeometryDistancePx(latlng, line) <= 18
        );
    }

    return false;
}

function getSiaAirspaceChoicePriority(item) {
    /* v15.81 — Sélection Zone : les SIV sont toujours présentés en premier. */
    if (isSiaFlightInformationSector(item)) return 0;

    const type = String(item?.t || '').toUpperCase();
    if (type === 'CTR') return 10;
    if (type === 'P' || type === 'R' || type === 'D' || type === 'TRA') return 20;
    if (type === 'TMA') return 30;
    if (type === 'CTA') return 40;
    if (type === 'D-OTHER') return 50;
    if (type === 'RAS' || type === 'SECTOR' || type === 'SECTOR-C') return 60;
    if (type === 'OCA' || type === 'UTA') return 70;
    if (type === 'FIR' || type === 'UIR' || type === 'UIR-P') return 80;
    return 90;
}

function getSiaAlwaysSelectableSivCandidates(latlng, existingEntries = []) {
    const dataset = siaDataset;
    if (!dataset || !Array.isArray(dataset.airspaces) || !latlng) return [];

    const lat = Number(latlng.lat);
    const lng = Number(latlng.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const existingKeys = new Set(
        (Array.isArray(existingEntries) ? existingEntries : [])
            .map(entry => getSiaCtrSelectionKey(entry?.item))
            .filter(Boolean)
    );

    const matches = [];
    for (const item of dataset.airspaces) {
        if (!isSiaFlightInformationSector(item)) continue;
        if (isSiaTechnicalSivParent(item, dataset)) continue;
        if (!item?.g) continue;

        const bounds = Array.isArray(item?.b) ? item.b : null;
        if (bounds && bounds.length >= 4) {
            const minLng = Number(bounds[0]);
            const minLat = Number(bounds[1]);
            const maxLng = Number(bounds[2]);
            const maxLat = Number(bounds[3]);
            if ([minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
                if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
            }
        }

        const key = getSiaCtrSelectionKey(item);
        if (key && existingKeys.has(key)) continue;

        const geometry = getSiaCachedGeometry(item);
        if (!geometry || !siaGeometryContainsLatLng(geometry, latlng)) continue;

        matches.push({
            item,
            geometry,
            layer: null,
            hiddenSivCandidate: !isSiaFilterEnabled('ase:SIV')
        });
        if (key) existingKeys.add(key);
    }

    return matches;
}

function getSiaHiddenFilteredAirspaceCandidates(latlng, existingEntries = []) {
    if (siaMapAirspacesVisible) return [];
    const dataset = siaDataset;
    if (!dataset || !Array.isArray(dataset.airspaces) || !latlng) return [];

    const lat = Number(latlng.lat);
    const lng = Number(latlng.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const operationalFamilies = buildSiaTmaOperationalFamilySet(dataset);
    const existingKeys = new Set(
        (Array.isArray(existingEntries) ? existingEntries : [])
            .map(entry => getSiaCtrSelectionKey(entry?.item))
            .filter(Boolean)
    );
    const matches = [];

    for (const item of dataset.airspaces) {
        if (!isSiaFilterEnabled(getSiaEffectiveFilterKey(item))) continue;
        if (shouldHideSiaAirspaceAboveFl115(item)) continue;
        if (isSiaTechnicalTmaUnionParent(item)) continue;
        if (isSiaTechnicalSivParent(item, dataset)) continue;
        if (isSiaGenericTmaWithoutAltitude(item, operationalFamilies)) continue;
        if (!item?.g) continue;

        const bounds = Array.isArray(item?.b) ? item.b : null;
        if (bounds && bounds.length >= 4) {
            const minLng = Number(bounds[0]);
            const minLat = Number(bounds[1]);
            const maxLng = Number(bounds[2]);
            const maxLat = Number(bounds[3]);
            if ([minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
                if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
            }
        }

        const key = getSiaCtrSelectionKey(item);
        if (key && existingKeys.has(key)) continue;
        const geometry = getSiaCachedGeometry(item);
        if (!geometry || !siaGeometryContainsLatLng(geometry, latlng)) continue;

        matches.push({ item, geometry, layer: null, hiddenMapCandidate: true });
        if (key) existingKeys.add(key);
    }

    return matches;
}

function getSiaAirspaceTouchCandidates(latlng) {
    const operationalFamilies = buildSiaTmaOperationalFamilySet(siaDataset);

    const visibleCandidates = siaAirspaceTouchEntries
        .filter(entry => !isSiaTechnicalTmaUnionParent(entry.item))
        .filter(entry => !isSiaTechnicalSivParent(entry.item, siaDataset))
        .filter(entry => !isSiaGenericTmaWithoutAltitude(entry.item, operationalFamilies))
        .filter(entry => siaGeometryContainsLatLng(entry.geometry, latlng));

    const hiddenFilteredCandidates = getSiaHiddenFilteredAirspaceCandidates(latlng, visibleCandidates);
    const candidates = visibleCandidates
        .concat(hiddenFilteredCandidates)
        .concat(getSiaAlwaysSelectableSivCandidates(latlng, visibleCandidates.concat(hiddenFilteredCandidates)));

    return candidates.sort((a, b) => {
        const pa = getSiaAirspaceChoicePriority(a.item);
        const pb = getSiaAirspaceChoicePriority(b.item);
        if (pa !== pb) return pa - pb;

        const aa = Array.isArray(a.item?.b) && a.item.b.length >= 4
            ? Math.abs((Number(a.item.b[2]) - Number(a.item.b[0])) * (Number(a.item.b[3]) - Number(a.item.b[1])))
            : Infinity;
        const ab = Array.isArray(b.item?.b) && b.item.b.length >= 4
            ? Math.abs((Number(b.item.b[2]) - Number(b.item.b[0])) * (Number(b.item.b[3]) - Number(b.item.b[1])))
            : Infinity;
        return aa - ab;
    });
}

function getSiaAirspaceChoiceLabel(item) {
    return getSiaAirspaceDisplayTitle(item);
}

function getSiaAirspaceChoiceVerticalLabel(item) {
    const hasLower = hasSiaVerticalValue(item?.lo);
    const hasUpper = hasSiaVerticalValue(item?.up);
    if (!hasLower && !hasUpper) return '';

    const lower = hasLower ? formatSiaVertical(item.lo) : '—';
    const upper = hasUpper ? formatSiaVertical(item.up) : '—';
    return `${lower} / ${upper}`;
}

function openSiaAirspaceChoicePopup(latlng, candidates) {
    if (!map || !latlng || !Array.isArray(candidates) || !candidates.length) return;

    const container = document.createElement('div');
    container.className = 'sia-airspace-choice';

    const title = document.createElement('div');
    title.className = 'sia-airspace-choice-title';
    title.textContent = 'ESPACES À CET ENDROIT';
    container.appendChild(title);

    const list = document.createElement('div');
    list.className = 'sia-airspace-choice-list';

    candidates.forEach(entry => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sia-airspace-choice-button';

        const nameLine = document.createElement('div');
        nameLine.className = 'sia-airspace-choice-name';
        nameLine.textContent = getSiaAirspaceChoiceLabel(entry.item);
        button.appendChild(nameLine);

        const verticalLabel = getSiaAirspaceChoiceVerticalLabel(entry.item);
        if (verticalLabel) {
            const verticalLine = document.createElement('div');
            verticalLine.className = 'sia-airspace-choice-vertical';
            verticalLine.textContent = verticalLabel;
            button.appendChild(verticalLine);
        }

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            try { map.closePopup(); } catch (_) {}
            selectSiaCtrTouchLayer(
                entry.layer,
                entry.item,
                latlng,
                entry.geometry,
                { choiceOrigin: latlng, choiceCandidates: candidates }
            );
        });

        list.appendChild(button);
    });

    container.appendChild(list);

    L.popup({
        maxWidth: 390,
        closeButton: true,
        autoPan: !centerGpsFollowActive,
        keepInView: !centerGpsFollowActive,
        className: 'sia-airspace-dialog-popup sia-airspace-choice-popup'
    })
        .setLatLng(latlng)
        .setContent(container)
        .openOn(map);
}

function handleSiaAirspaceTouch(latlng) {
    const candidates = getSiaAirspaceTouchCandidates(latlng);

    if (!candidates.length) return;
    if (candidates.length === 1) {
        selectSiaCtrTouchLayer(
            candidates[0].layer,
            candidates[0].item,
            latlng,
            candidates[0].geometry
        );
        return;
    }

    /*
     * Plusieurs zones se superposent : le z-index ne choisit jamais à la place
     * de l'utilisateur. On propose toutes les zones actives contenant le point.
     */
    openSiaAirspaceChoicePopup(latlng, candidates);
}

function addSiaCtrTouchSurface(feature) {
    if (!siaLayerGroup || !feature?.geometry || !feature?.properties?.siaItem) return null;
    const item = feature.properties.siaItem;
    const selectionColor = getSiaAirspaceSelectionColor(item);
    const geometryType = String(feature?.geometry?.type || '');
    const isDirectDotherPoint = String(item?.t || '').trim().toUpperCase() === 'D-OTHER'
        && (geometryType === 'Point' || geometryType === 'MultiPoint');

    /*
     * v15.75 — optimisation iPad majeure : les volumes surfaciques ne créent
     * plus chacun un second GeoJSON invisible de 30 px uniquement pour le toucher.
     * Leur géométrie est conservée ici et testée à la demande lors de
     * « Sélection Zone ». Les D-OTHER ponctuels gardent seuls une hitbox afin
     * de conserver leur ouverture par appui court.
     */
    if (!isDirectDotherPoint) {
        siaAirspaceTouchEntries.push({
            item,
            geometry: feature.geometry,
            layer: null
        });
        return null;
    }

    const neutralizeShortClick = event => {
        /*
         * v15.75 — en mode CRÉER/MODIFIER GAAR, les grandes surfaces tactiles
         * SIA couvrent souvent toute la carte. Elles transfèrent alors le clic
         * au créateur GAAR au lieu de l'absorber.
         */
        if (isDrawingMode && event?.latlng) {
            handleGaarMapClick(event, { fromSiaSurface: true }).catch(() => {});
        }
        try {
            if (event?.originalEvent) {
                L.DomEvent.stopPropagation(event.originalEvent);
                L.DomEvent.preventDefault(event.originalEvent);
            }
        } catch (_) {}
    };

    const touchGeoJson = L.geoJSON(feature, {
        pane: 'siaCtrTouchPane',
        renderer: siaCtrTouchRenderer || undefined,

        /*
         * v15.59 — important pour les D-OTHER ponctuels :
         * sans pointToLayer, Leaflet crée son Marker PNG par défaut. Dans la
         * PWA, l'icône peut être absente et apparaître sous forme de « ? ».
         * On utilise maintenant un cercle SVG tactile quasi invisible.
         */
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
            pane: 'siaCtrTouchPane',
            renderer: siaCtrTouchRenderer || undefined,
            radius: 30,
            stroke: false,
            color: selectionColor,
            opacity: 0,
            fill: true,
            fillColor: selectionColor,
            fillOpacity: 0.002,
            interactive: true,
            bubblingMouseEvents: false,
            keyboard: false,
            className: 'sia-airspace-touch-surface'
        }),

        style: geoFeature => {
            const geometryType = String(geoFeature?.geometry?.type || '');

            if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
                return {
                    color: selectionColor,
                    weight: 30,
                    opacity: 0.002,
                    fillOpacity: 0,
                    interactive: true,
                    className: 'sia-airspace-touch-surface'
                };
            }

            return {
                color: 'transparent',
                weight: 0,
                opacity: 0,
                fillColor: selectionColor,
                fillOpacity: 0.001,
                interactive: true,
                className: 'sia-airspace-touch-surface'
            };
        },

        onEachFeature: (geoFeature, layer) => {
            const geometryType = String(geoFeature?.geometry?.type || '');
            const isDirectDotherPoint = String(item?.t || '').trim().toUpperCase() === 'D-OTHER'
                && (geometryType === 'Point' || geometryType === 'MultiPoint');

            if (isDirectDotherPoint) {
                /*
                 * v15.69 — les activités D-OTHER ponctuelles sont de vrais
                 * symboles opérationnels : un appui court ouvre directement leur
                 * fiche. L'appui long carte reste disponible pour les volumes.
                 */
                layer.on('click', event => {
                    if (isDrawingMode && event?.latlng) {
                        handleGaarMapClick(event, { fromSiaSurface: true }).catch(() => {});
                        try {
                            if (event?.originalEvent) {
                                L.DomEvent.stopPropagation(event.originalEvent);
                                L.DomEvent.preventDefault(event.originalEvent);
                            }
                        } catch (_) {}
                        return;
                    }
                    try {
                        if (event?.originalEvent) {
                            L.DomEvent.stopPropagation(event.originalEvent);
                            L.DomEvent.preventDefault(event.originalEvent);
                        }
                    } catch (_) {}

                    const popupPoint = event?.latlng
                        || (geometryType === 'Point'
                            ? L.latLng(Number(geoFeature.geometry.coordinates[1]), Number(geoFeature.geometry.coordinates[0]))
                            : null);
                    if (!popupPoint) return;
                    selectSiaCtrTouchLayer(
                        touchGeoJson,
                        item,
                        popupPoint,
                        feature.geometry,
                        { directPoint: true }
                    );
                });
            } else {
                /*
                 * Les volumes restent sélectionnés par appui long puis
                 * « Sélection Zone » afin de gérer correctement les superpositions.
                 */
                layer.on('click', neutralizeShortClick);
            }
        }
    });

    touchGeoJson.addTo(siaLayerGroup);
    siaAirspaceTouchEntries.push({
        item,
        geometry: feature.geometry,
        layer: touchGeoJson
    });

    return touchGeoJson;
}

function clearSiaZoomDependentLayers() {
    if (!siaLayerGroup || !Array.isArray(siaZoomDependentLayers)) {
        siaZoomDependentLayers = [];
        return;
    }
    siaZoomDependentLayers.forEach(layer => {
        try { siaLayerGroup.removeLayer(layer); } catch (_) {}
    });
    siaZoomDependentLayers = [];
}

function getSiaDecorationFeaturesForCurrentView(features) {
    if (!map || !Array.isArray(features) || !features.length) return [];
    let viewportBounds = null;
    try {
        /* Petit débord seulement : ne pas décorer tout le tampon de rendu. */
        viewportBounds = map.getBounds().pad(SIA_DECORATION_VIEW_PAD_RATIO);
    } catch (_) {
        viewportBounds = map.getBounds?.() || null;
    }
    if (!viewportBounds) return features;

    return features.filter(feature => {
        const item = feature?.properties?.siaItem;
        if (!item) return false;
        return siaBoundsIntersects(item.b, viewportBounds);
    });
}

function renderSiaZoomDependentDecorations(features) {
    const npfDiagStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
    clearSiaZoomDependentLayers();
    if (!siaMapAirspacesVisible || !Array.isArray(features) || !features.length) return;

    /*
     * v16.33 — à grande échelle, les contours principaux suffisent. Les bandes
     * intérieures et libellés impliquent des centaines de conversions écran et
     * n'apportent pas d'information supplémentaire lorsque l'échelle est >= 10 NM.
     * Les zones, leurs contours et la sélection restent intégralement disponibles.
     */
    const scaleNm = getCurrentNpfScaleNm();
    const combinedHeavyDecorationLoad = !!(siaMapAirspacesVisible && showRoadOverlayLayer && showHighVoltageLinesLayer);
    const combinedHeavyLightweight = combinedHeavyDecorationLoad && Number.isFinite(scaleNm) && scaleNm >= 5;
    if (scaleNm >= SIA_DECORATION_LIGHTWEIGHT_SCALE_NM || combinedHeavyLightweight) {
        npfDiagSiaInteraction(
            'SIA DÉCORATIONS',
            `zones=0/${features.length} · labels=0 · zoom=${map?.getZoom?.() ?? '—'} · allégées=oui · charge-combinée=${combinedHeavyLightweight ? 'oui' : 'non'} · echelle=${Number.isFinite(scaleNm) ? scaleNm.toFixed(1) : '—'}NM`,
            { dureeMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - npfDiagStartedAt) }
        );
        return;
    }

    /*
     * Les volumes sont chargés avec un tampon pour éviter les reconstructions
     * permanentes. En revanche, bandes intérieures et libellés ne sont utiles
     * qu'autour de la vue courante : ne pas les créer pour toutes les zones du tampon.
     */
    const decorationFeatures = getSiaDecorationFeaturesForCurrentView(features);
    const labelState = { points: [], count: 0 };
    decorationFeatures.forEach(feature => {
        const item = feature?.properties?.siaItem;
        if (!item || Number(item?.co || 0) === 1) return;
        const itemStyle = getSiaAirspaceStyle(item);
        const layers = addSiaCtrInnerBand(feature.geometry, itemStyle.color);
        if (Array.isArray(layers)) siaZoomDependentLayers.push(...layers);
    });

    decorationFeatures
        .filter(feature => Number(feature?.properties?.siaItem?.co || 0) !== 1)
        .sort((a, b) =>
            getSiaBoundaryLabelPriority(a.properties.siaItem)
            - getSiaBoundaryLabelPriority(b.properties.siaItem)
        )
        .forEach(feature => {
            const marker = addSiaAirspaceBoundaryLabel(
                feature.properties.siaItem,
                feature.geometry,
                labelState
            );
            if (marker) siaZoomDependentLayers.push(marker);
        });

    npfDiagSiaInteraction(
        'SIA DÉCORATIONS',
        `zones=${decorationFeatures.length}/${features.length} · labels=${labelState.count} · zoom=${map?.getZoom?.() ?? '—'}`,
        { dureeMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - npfDiagStartedAt) }
    );
}

async function renderSiaZoomDependentDecorationsProgressive(features, refreshGeneration) {
    const npfDiagStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
    const runId = ++siaDecorationProgressiveRun;
    let bandMs = 0;
    let labelMs = 0;
    clearSiaZoomDependentLayers();
    if (!siaMapAirspacesVisible || !Array.isArray(features) || !features.length) return;

    /*
     * v16.33 — mode allégé à grande échelle. Le GeoJSON principal reste visible
     * et sélectionnable ; seules les décorations dépendantes des pixels écran
     * (bandes intérieures / libellés) sont omises. Cela évite les blocs de 1–2 s
     * observés au zoom 8/9 sur iPad, sans retirer aucune zone SIA.
     */
    const scaleNm = getCurrentNpfScaleNm();
    const combinedHeavyDecorationLoad = !!(siaMapAirspacesVisible && showRoadOverlayLayer && showHighVoltageLinesLayer);
    const combinedHeavyLightweight = combinedHeavyDecorationLoad && Number.isFinite(scaleNm) && scaleNm >= 5;
    if (scaleNm >= SIA_DECORATION_LIGHTWEIGHT_SCALE_NM || combinedHeavyLightweight) {
        throwIfSiaRefreshObsolete(refreshGeneration);
        npfDiagSiaInteraction(
            'SIA DÉCORATIONS',
            `zones=0/${features.length} · labels=0 · zoom=${map?.getZoom?.() ?? '—'} · progressif=oui · allégées=oui · charge-combinée=${combinedHeavyLightweight ? 'oui' : 'non'} · echelle=${Number.isFinite(scaleNm) ? scaleNm.toFixed(1) : '—'}NM`,
            { dureeMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - npfDiagStartedAt) }
        );
        return;
    }

    const decorationFeatures = getSiaDecorationFeaturesForCurrentView(features);
    const labelState = { points: [], count: 0 };

    /* v16.65 — correction de régression : si les décorations SIA sont rendues,
     * les bordures/bandes intérieures le sont elles aussi. La v16.64 les
     * supprimait dès 5 NM (ou avec HT/Routes), alors que les libellés restaient
     * visibles. Le mode global allégé >= 10 NM / charge combinée reste géré
     * plus haut et continue, lui, à omettre toutes les décorations. */
    const skipInnerBands = false;

    let phaseBudgetStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
    const bandStartedAt = phaseBudgetStartedAt;
    for (let index = 0; index < decorationFeatures.length; index += 1) {
        throwIfSiaRefreshObsolete(refreshGeneration);
        if (runId !== siaDecorationProgressiveRun) {
            const error = new Error('Décorations SIA remplacées par une vue plus récente');
            error.name = SIA_REFRESH_ABORT_ERROR_NAME;
            throw error;
        }
        const feature = decorationFeatures[index];
        const item = feature?.properties?.siaItem;
        if (!skipInnerBands && item && Number(item?.co || 0) !== 1) {
            const itemStyle = getSiaAirspaceStyle(item);
            const layers = addSiaCtrInnerBand(feature.geometry, itemStyle.color);
            if (Array.isArray(layers)) siaZoomDependentLayers.push(...layers);
        }
        if (
            NPF_STARTUP_DIAGNOSTIC.now() - phaseBudgetStartedAt
            >= SIA_DECORATION_TIME_BUDGET_MS
        ) {
            await yieldSiaRefreshToMap(refreshGeneration);
            phaseBudgetStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
        }
    }
    bandMs = NPF_STARTUP_DIAGNOSTIC.now() - bandStartedAt;

    const labelFeatures = decorationFeatures
        .filter(feature => Number(feature?.properties?.siaItem?.co || 0) !== 1)
        .sort((a, b) =>
            getSiaBoundaryLabelPriority(a.properties.siaItem)
            - getSiaBoundaryLabelPriority(b.properties.siaItem)
        );

    phaseBudgetStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
    const labelStartedAt = phaseBudgetStartedAt;
    for (let index = 0; index < labelFeatures.length; index += 1) {
        throwIfSiaRefreshObsolete(refreshGeneration);
        if (runId !== siaDecorationProgressiveRun) {
            const error = new Error('Décorations SIA remplacées par une vue plus récente');
            error.name = SIA_REFRESH_ABORT_ERROR_NAME;
            throw error;
        }
        const feature = labelFeatures[index];
        const marker = addSiaAirspaceBoundaryLabel(
            feature.properties.siaItem,
            feature.geometry,
            labelState
        );
        if (marker) siaZoomDependentLayers.push(marker);
        if (
            NPF_STARTUP_DIAGNOSTIC.now() - phaseBudgetStartedAt
            >= SIA_DECORATION_TIME_BUDGET_MS
        ) {
            await yieldSiaRefreshToMap(refreshGeneration);
            phaseBudgetStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
        }
    }
    labelMs = NPF_STARTUP_DIAGNOSTIC.now() - labelStartedAt;
    siaRenderedDiagnosticCounts.decorations = Number(
        siaZoomDependentLayers?.length || 0
    );
    siaRenderedDiagnosticCounts.touchEntries = Number(
        siaAirspaceTouchEntries?.length || 0
    );

    npfDiagSiaInteraction(
        'SIA DÉCORATIONS',
        `zones=${decorationFeatures.length}/${features.length} · labels=${labelState.count} · zoom=${map?.getZoom?.() ?? '—'} · progressif=oui · bandes=${skipInnerBands ? 'non' : 'oui'}`,
        {
            dureeMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - npfDiagStartedAt),
            bandMs: Math.round(bandMs),
            labelMs: Math.round(labelMs)
        }
    );
}

function scheduleSiaMoveDecorationRefresh(reason = 'moveend-idle') {
    clearTimeout(siaMoveDecorationRefreshTimer);

    const scheduledGeneration = getSiaRefreshGeneration();

    const attempt = async () => {
        siaMoveDecorationRefreshTimer = null;

        if (
            !map
            || !siaMapAirspacesVisible
            || !Array.isArray(siaRenderedAirspaceFeatures)
            || !siaRenderedAirspaceFeatures.length
        ) {
            return;
        }

        if (scheduledGeneration !== getSiaRefreshGeneration()) {
            return;
        }

        const now = NPF_STARTUP_DIAGNOSTIC.now();
        const quietFor = Math.max(0, now - Number(siaLastMapMotionAt || 0));

        /*
         * v16.87 — si un geste/zoom vient encore d'avoir lieu, ne pas commencer
         * une reconstruction de 200–600 ms entre deux mouvements. On attend la
         * fin réelle de l'activité carte.
         */
        if (quietFor < SIA_MOVE_DECORATION_IDLE_MS) {
            const remaining = Math.max(
                SIA_DECORATION_STABLE_RECHECK_MS,
                SIA_MOVE_DECORATION_IDLE_MS - quietFor
            );
            siaMoveDecorationRefreshTimer = setTimeout(attempt, remaining);
            return;
        }

        const viewKey = getSiaDecorationViewKey();
        if (viewKey && viewKey === siaLastDecorationViewKey) {
            npfDiagSiaInteraction(
                'SIA DÉCORATIONS',
                `raison=${reason} · vue déjà décorée · aucun recalcul · zoom=${map.getZoom()}`,
                { dureeMs: 0, skippedDuplicate: 1 }
            );
            return;
        }

        const startedAt = NPF_STARTUP_DIAGNOSTIC.now();
        const refreshGeneration = getSiaRefreshGeneration();

        try {
            await renderSiaZoomDependentDecorationsProgressive(
                siaRenderedAirspaceFeatures,
                refreshGeneration
            );

            if (
                refreshGeneration === getSiaRefreshGeneration()
                && getSiaDecorationViewKey() === viewKey
            ) {
                siaLastDecorationViewKey = viewKey;
            }

            scheduleSiaProfileRefresh('sia-moveend-idle-decorations');
            npfDiagSiaInteraction(
                'SIA RAFRAÎCHISSEMENT',
                `raison=${reason} · décorations après stabilisation · zones=${siaRenderedAirspaceFeatures.length} · zoom=${map.getZoom()}`,
                {
                    totalMs: Math.round(
                        NPF_STARTUP_DIAGNOSTIC.now() - startedAt
                    ),
                    stableMs: Math.round(
                        NPF_STARTUP_DIAGNOSTIC.now()
                        - Number(siaLastMapMotionAt || 0)
                    )
                }
            );
        } catch (error) {
            if (error?.name !== SIA_REFRESH_ABORT_ERROR_NAME) {
                console.warn('[SIA] Décorations différées impossibles:', error);
            }
        }
    };

    siaMoveDecorationRefreshTimer = setTimeout(
        attempt,
        SIA_MOVE_DECORATION_IDLE_MS
    );
}

const SIA_REFRESH_ABORT_ERROR_NAME = 'NpfSiaRefreshAborted';

function getSiaRefreshGeneration() {
    return Number(window.__npfSiaRefreshGeneration) || 0;
}

function throwIfSiaRefreshObsolete(refreshGeneration) {
    if (getSiaRefreshGeneration() === refreshGeneration) return;
    const error = new Error('Rendu SIA devenu obsolète');
    error.name = SIA_REFRESH_ABORT_ERROR_NAME;
    throw error;
}

async function yieldSiaRefreshToMap(refreshGeneration) {
    await new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });
    throwIfSiaRefreshObsolete(refreshGeneration);
}

async function addSiaDesignatedPointsToExistingCoverage(dataset, bounds, refreshGeneration) {
    if (!map || !siaLayerGroup || !dataset || !bounds) return 0;
    let rendered = 0;
    let scanIndex = 0;
    const zoom = map.getZoom();

    for (const item of dataset.points || []) {
        scanIndex += 1;
        if (scanIndex % 512 === 0) {
            await yieldSiaRefreshToMap(refreshGeneration);
        }
        if (!isSiaFilterEnabled(getSiaEffectiveFilterKey(item))) continue;
        if (item.k === 'dpn:VRP' && !siaMapVrpVisible) continue;
        const latlng = L.latLng(Number(item.x), Number(item.y));
        if (!bounds.contains(latlng)) continue;

        const popupHtml = buildSiaPointPopup(item);
        if (item.k === 'dpn:VRP') {
            const symbolText = getSiaVrpSymbolText(item);
            const size = getSiaVrpVisualSize(symbolText);
            const vrpVisual = getSiaVrpAirportVisual(item);
            const marker = L.marker(latlng, {
                pane: 'siaPointPane',
                interactive: true,
                bubblingMouseEvents: false,
                keyboard: false,
                icon: L.divIcon({
                    className: 'sia-vrp-div-icon',
                    html: `<span class="sia-vrp-symbol" style="--sia-vrp-bg:${vrpVisual.background};--sia-vrp-fg:${vrpVisual.foreground};width:${size}px;height:${size}px;font-size:${symbolText.length >= 5 ? 7 : symbolText.length === 4 ? 8 : symbolText.length === 3 ? 9 : 11}px">${escapeHtml(symbolText)}</span>`,
                    iconSize: [size, size],
                    iconAnchor: [size / 2, size / 2]
                })
            });
            marker.bindPopup(popupHtml, { maxWidth: 340 });
            marker.on('popupopen', () => marker.setPopupContent(buildSiaPointPopup(item)));
            marker.addTo(siaLayerGroup);
            addSiaTouchHitbox(latlng, popupHtml, () => buildSiaPointPopup(item));
            rendered += 1;
            continue;
        }

        const marker = L.circleMarker(latlng, {
            ...getSiaPointMarkerStyle(item),
            pane: 'siaPointPane',
            renderer: siaPointRenderer,
            interactive: true,
            bubblingMouseEvents: false
        });
        marker.bindPopup(popupHtml, { maxWidth: 340 });

        const label = String(item.d || item.c || '').trim();
        if (zoom >= 8 && label && item.k !== 'dpn:ADHP') {
            marker.bindTooltip(escapeHtml(label), {
                permanent: true,
                direction: 'right',
                offset: [5, 0],
                className: 'sia-point-label'
            });
        }
        marker.addTo(siaLayerGroup);
        addSiaTouchHitbox(latlng, popupHtml);
        rendered += 1;
    }
    return rendered;
}

async function refreshSiaLayers(reason = 'manual') {
    if (!map) return;
    ensureSiaMapPanes();

    const npfDiagRefreshStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
    let npfDiagDatasetMs = 0;
    let npfDiagScanMs = 0;
    let npfDiagGeoJsonMs = 0;
    let npfDiagTouchDecorMs = 0;
    let npfDiagPointsMs = 0;
    let npfDiagCommitMs = 0;
    let npfDiagVisibleZones = 0;
    let npfDiagRenderedObjects = 0;
    let npfDiagTerrainCount = 0;
    let npfDiagVrpCount = 0;
    let npfDiagOtherPointCount = 0;

    const refreshGeneration = getSiaRefreshGeneration();
    let previousSiaLayerGroupForSwap = null;
    let replacementSiaLayerGroupForSwap = null;
    let replacementSiaLayerGroupCommitted = false;

    if (siaRefreshInProgress) {
        siaRefreshPendingReason = reason;
        return;
    }

    siaRefreshInProgress = true;
    siaRefreshCurrentReason = String(reason || 'manual');
    try {
        if (!hasAnyEnabledSiaFilter()) {
            clearSiaRenderedLayers();
            return;
        }

        const currentBounds = map.getBounds();
        const zoom = map.getZoom();
        const signature = getSiaRenderSignature();

        if (
            reason === 'gps-follow'
            && siaRenderedCoverageBounds
            && siaRenderedZoom === zoom
            && siaRenderedSignature === signature
            && siaBoundsFullyContains(siaRenderedCoverageBounds, currentBounds)
        ) {
            cancelObsoleteSiaMapMotionWork('gps-follow-contained-execution');
            return;
        }
        const showSiaDesignatedPointsNow = shouldDisplaySiaDesignatedPoints();
        const pointLabelsEnabledNow = zoom >= 8;

        /*
         * v16.37 — retour vers une vue rapprochée : ne plus réutiliser la
         * couverture très large d'un zoom 7/8/9 lorsque les points SIA
         * désignés doivent réapparaître. Le DIAG v16.34-v16.36 montre que
         * l'ajout de plusieurs centaines de points sur l'ancien grand tampon
         * (jusqu'à ~500 points) coûte davantage qu'une reconstruction normale
         * centrée sur le nouveau viewport. Dans ce cas, on laisse donc le
         * chemin de rendu complet ci-dessous reconstruire un tampon adapté au
         * zoom courant. Les autres réutilisations de zoom restent conservées.
         */

        /*
         * v15.80 — zoom dans une couverture déjà chargée : conserver volumes,
         * points et hitboxes. Seules les bandes intérieures et étiquettes de
         * zones, dépendantes des pixels écran, sont recalculées.
         */
        if (
            reason === 'zoomend'
            && siaRenderedCoverageBounds
            && siaRenderedSignature === signature
            && siaBoundsFullyContains(siaRenderedCoverageBounds, currentBounds)
            && siaRenderedShowDesignatedPoints === showSiaDesignatedPointsNow
            && siaRenderedPointLabelsEnabled === pointLabelsEnabledNow
            && Array.isArray(siaRenderedAirspaceFeatures)
        ) {
            /* v16.66 — ne plus calculer bandes/libellés dans la transaction
             * zoomend. Le zoom rend la main immédiatement ; la décoration est
             * recalculée après stabilisation de la vue. */
            siaRenderedZoom = zoom;
            scheduleSiaMoveDecorationRefresh('zoomend-idle-v16.66');
            npfDiagSiaInteraction(
                'SIA RAFRAÎCHISSEMENT',
                `raison=${reason} · décorations différées · zones=${siaRenderedAirspaceFeatures.length} · zoom=${zoom}`,
                { totalMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - npfDiagRefreshStartedAt) }
            );
            return;
        }

        // v16.70 — pan contenu : zéro reconstruction, y compris décorations.
        // Les calques Leaflet existants suivent déjà la carte.
        if (
            reason === 'moveend'
            && siaRenderedCoverageBounds
            && siaRenderedZoom === zoom
            && siaRenderedSignature === signature
            && siaBoundsFullyContains(siaRenderedCoverageBounds, currentBounds)
        ) {
            cancelObsoleteSiaMapMotionWork('moveend-refresh-contained-v16.70-zero-work');
            npfDiagSiaInteraction(
                'SIA RAFRAÎCHISSEMENT',
                `raison=${reason} · couverture valide · zéro recalcul total · zones=${Array.isArray(siaRenderedAirspaceFeatures) ? siaRenderedAirspaceFeatures.length : 0} · zoom=${zoom}`,
                { totalMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - npfDiagRefreshStartedAt) }
            );
            return;
        }

        clearTimeout(siaMoveDecorationRefreshTimer);
        siaMoveDecorationRefreshTimer = null;

        const npfDiagDatasetStart = NPF_STARTUP_DIAGNOSTIC.now();
        const dataset = await ensureSiaDatasetForMapRefresh();
        npfDiagDatasetMs = NPF_STARTUP_DIAGNOSTIC.now() - npfDiagDatasetStart;
        throwIfSiaRefreshObsolete(refreshGeneration);
        // v15.83 — inutile de scanner les familles TMA lorsque les volumes sont masqués.
        const siaTmaOperationalFamilies = siaMapAirspacesVisible
            ? buildSiaTmaOperationalFamilySet(dataset)
            : null;

        /*
         * v15.82 — le double tampon n'est utile que lorsque les volumes SIA sont
         * visibles. Zones masquées : libérer immédiatement l'ancien groupe évite
         * de conserver deux jeux de marqueurs/points pendant la reconstruction.
         */
        const siaCombinedHeavyMapLoad = siaMapAirspacesVisible && showRoadOverlayLayer && showHighVoltageLinesLayer;
        /* v16.57 — sous charge combinée, jamais deux jeux SIA simultanés,
         * quel que soit le zoom : stabilité mémoire prioritaire sur iPad. */
        const preservePreviousSiaDuringRebuild = siaMapAirspacesVisible
            && !siaCombinedHeavyMapLoad;
        previousSiaLayerGroupForSwap = siaLayerGroup;
        replacementSiaLayerGroupForSwap = L.layerGroup();
        siaLayerGroup = replacementSiaLayerGroupForSwap;

        if (
            !preservePreviousSiaDuringRebuild
            && previousSiaLayerGroupForSwap
        ) {
            try {
                if (map.hasLayer(previousSiaLayerGroupForSwap)) {
                    map.removeLayer(previousSiaLayerGroupForSwap);
                }
                previousSiaLayerGroupForSwap.clearLayers();
            } catch (_) {}
            previousSiaLayerGroupForSwap = null;
            /* v16.57 — l'ancien groupe n'existe plus : sa couverture ne doit
             * jamais être réutilisée si le nouveau rendu est interrompu par un zoom. */
            siaRenderedCoverageBounds = null;
            siaRenderedZoom = null;
            siaRenderedSignature = '';
            siaRenderedAirspaceFeatures = [];
            siaRenderedShowDesignatedPoints = null;
            siaRenderedPointLabelsEnabled = null;
        }

        siaSelectedCtrTouchLayer = null;
        siaAirspaceTouchEntries = [];
        siaZoomDependentLayers = [];

        // Charger légèrement au-delà du viewport évite les reconstructions à
        // chaque mouvement du suivi GPS tout en bornant la mémoire Safari/iPad.
        const renderPadRatio = siaMapAirspacesVisible
            ? (siaCombinedHeavyMapLoad
                ? SIA_COMBINED_HEAVY_RENDER_PAD_RATIO
                : SIA_RENDER_BOUNDS_PAD_RATIO)
            : SIA_POINT_ONLY_RENDER_BOUNDS_PAD_RATIO;
        const renderBounds = currentBounds.pad(renderPadRatio);
        const pointBounds = renderBounds.pad(0.03);
        let rendered = 0;

        const visibleAirspaceFeatures = [];
        const npfDiagScanStart = NPF_STARTUP_DIAGNOSTIC.now();

        if (siaMapAirspacesVisible) {
            let siaAirspaceScanIndex = 0;
            for (const item of dataset.airspaces || []) {
                siaAirspaceScanIndex += 1;
                if (siaAirspaceScanIndex % 768 === 0) {
                    await yieldSiaRefreshToMap(refreshGeneration);
                }
                if (!isSiaFilterEnabled(getSiaEffectiveFilterKey(item))) continue;
                if (shouldHideSiaAirspaceAboveFl115(item)) continue;
                if (isSiaTechnicalTmaUnionParent(item)) continue;
                if (isSiaTechnicalSivParent(item, dataset)) continue;
                if (isSiaGenericTmaWithoutAltitude(item, siaTmaOperationalFamilies)) continue;
                if (!item.g) continue;
                if (!siaBoundsIntersects(item.b, renderBounds)) continue;

                const geometry = getSiaCachedGeometry(item);
                if (!geometry) continue;

                visibleAirspaceFeatures.push({
                    type: 'Feature',
                    properties: { siaItem: item },
                    geometry
                });
            }
        }
        npfDiagScanMs = NPF_STARTUP_DIAGNOSTIC.now() - npfDiagScanStart;
        npfDiagVisibleZones = visibleAirspaceFeatures.length;

        if (visibleAirspaceFeatures.length) {
            const npfDiagGeoStart = NPF_STARTUP_DIAGNOSTIC.now();
            const airspaceLayer = L.geoJSON(
                { type: 'FeatureCollection', features: visibleAirspaceFeatures },
                {
                    pane: 'siaAirspacePane',
                    renderer: siaAirspaceRenderer,
                    style: feature => getSiaAirspaceStyle(feature.properties.siaItem),
                    pointToLayer: (feature, latlng) => {
                        const itemStyle = getSiaAirspaceStyle(feature.properties.siaItem);
                        return L.circleMarker(latlng, {
                            pane: 'siaAirspacePane',
                            renderer: siaAirspaceRenderer,
                            radius: 5,
                            color: itemStyle.color,
                            weight: 2,
                            fillColor: itemStyle.color,
                            fillOpacity: 0.85
                        });
                    },
                    onEachFeature: (_feature, layer) => {
                        try { layer.options.interactive = false; } catch (_) {}
                    }
                }
            );
            airspaceLayer.addTo(siaLayerGroup);
            npfDiagGeoJsonMs = NPF_STARTUP_DIAGNOSTIC.now() - npfDiagGeoStart;

            const npfDiagTouchStart = NPF_STARTUP_DIAGNOSTIC.now();
            /*
             * v16.35 — zoom arrière / vue allégée : la très grande majorité des
             * volumes ne crée plus de calque tactile Leaflet depuis v15.75 ; elle
             * ajoute seulement une entrée géométrique dans siaAirspaceTouchEntries.
             * Rendre la main toutes les 24 zones imposait donc artificiellement
             * ~16 ms de délai par lot (jusqu'à ~0,8 s pour 1 100+ zones), alors
             * que le travail entre deux yields est minime. À >= 10 NM, on conserve
             * les mêmes données et la même sélection Zone mais on espace fortement
             * les yields. Les vues rapprochées gardent le lot prudent historique.
             */
            const siaTouchScaleNm = getCurrentNpfScaleNm();
            const siaTouchBatchSize = siaTouchScaleNm >= SIA_DECORATION_LIGHTWEIGHT_SCALE_NM
                ? SIA_TOUCH_SURFACE_LIGHTWEIGHT_BATCH_SIZE
                : SIA_TOUCH_SURFACE_BATCH_SIZE;

            for (let index = 0; index < visibleAirspaceFeatures.length; index += 1) {
                throwIfSiaRefreshObsolete(refreshGeneration);
                addSiaCtrTouchSurface(visibleAirspaceFeatures[index]);
                if ((index + 1) % siaTouchBatchSize === 0) {
                    await yieldSiaRefreshToMap(refreshGeneration);
                }
            }

            /* v16.66 — ne pas bloquer le rendu principal avec les bandes
             * intérieures et libellés. Ici on termine uniquement les surfaces
             * tactiles ; les décorations sont programmées après le commit. */
            npfDiagTouchDecorMs = NPF_STARTUP_DIAGNOSTIC.now() - npfDiagTouchStart;
            rendered += visibleAirspaceFeatures.length;
        }

        const showSiaDesignatedPoints = showSiaDesignatedPointsNow;
        const npfDiagPointsStart = NPF_STARTUP_DIAGNOSTIC.now();

        let siaTerrainScanIndex = 0;
        for (const item of dataset.terrain || []) {
            siaTerrainScanIndex += 1;
            if (siaTerrainScanIndex % 256 === 0) {
                await yieldSiaRefreshToMap(refreshGeneration);
            }
            if (!isSiaFilterEnabled(getSiaEffectiveFilterKey(item))) continue;
            const latlng = L.latLng(Number(item.x), Number(item.y));
            if (!pointBounds.contains(latlng)) continue;

            const terrainPopupHtml = buildSiaTerrainPopup(item);
            const marker = L.circleMarker(latlng, {
                ...getSiaTerrainMarkerStyle(item),
                pane: 'siaPointPane',
                renderer: siaPointRenderer,
                interactive: true,
                bubblingMouseEvents: false
            });
            marker.bindPopup(terrainPopupHtml, { maxWidth: 320 });
            if (zoom >= 8 && item.c) {
                marker.bindTooltip(escapeHtml(item.c), {
                    permanent: true,
                    direction: 'right',
                    offset: [5, 0],
                    className: 'sia-point-label sia-terrain-label'
                });
            }
            marker.addTo(siaLayerGroup);
            addSiaTouchHitbox(latlng, terrainPopupHtml);
            npfDiagTerrainCount += 1;
            rendered += 1;
        }

        let siaPointScanIndex = 0;
        for (const item of dataset.points || []) {
            if (!showSiaDesignatedPoints) break;
            siaPointScanIndex += 1;
            if (siaPointScanIndex % 512 === 0) {
                await yieldSiaRefreshToMap(refreshGeneration);
            }
            if (!isSiaFilterEnabled(getSiaEffectiveFilterKey(item))) continue;
            if (item.k === 'dpn:VRP' && !siaMapVrpVisible) continue;
            const latlng = L.latLng(Number(item.x), Number(item.y));
            if (!pointBounds.contains(latlng)) continue;

            const popupHtml = buildSiaPointPopup(item);

            if (item.k === 'dpn:VRP') {
                const symbolText = getSiaVrpSymbolText(item);
                const size = getSiaVrpVisualSize(symbolText);
                const vrpVisual = getSiaVrpAirportVisual(item);
                const marker = L.marker(latlng, {
                    pane: 'siaPointPane',
                    interactive: true,
                    bubblingMouseEvents: false,
                    keyboard: false,
                    icon: L.divIcon({
                        className: 'sia-vrp-div-icon',
                        html: `<span class="sia-vrp-symbol" style="--sia-vrp-bg:${vrpVisual.background};--sia-vrp-fg:${vrpVisual.foreground};width:${size}px;height:${size}px;font-size:${symbolText.length >= 5 ? 7 : symbolText.length === 4 ? 8 : symbolText.length === 3 ? 9 : 11}px">${escapeHtml(symbolText)}</span>`,
                        iconSize: [size, size],
                        iconAnchor: [size / 2, size / 2]
                    })
                });
                marker.bindPopup(popupHtml, { maxWidth: 340 });
                marker.on('popupopen', () => marker.setPopupContent(buildSiaPointPopup(item)));
                marker.addTo(siaLayerGroup);
                addSiaTouchHitbox(latlng, popupHtml, () => buildSiaPointPopup(item));
                npfDiagVrpCount += 1;
                rendered += 1;
                continue;
            }

            const marker = L.circleMarker(latlng, {
                ...getSiaPointMarkerStyle(item),
                pane: 'siaPointPane',
                renderer: siaPointRenderer,
                interactive: true,
                bubblingMouseEvents: false
            });
            marker.bindPopup(popupHtml, { maxWidth: 340 });

            const label = String(item.d || item.c || '').trim();
            if (zoom >= 8 && label && item.k !== 'dpn:ADHP') {
                marker.bindTooltip(escapeHtml(label), {
                    permanent: true,
                    direction: 'right',
                    offset: [5, 0],
                    className: 'sia-point-label'
                });
            }
            marker.addTo(siaLayerGroup);
            addSiaTouchHitbox(latlng, popupHtml);
            npfDiagOtherPointCount += 1;
            rendered += 1;
        }
        npfDiagPointsMs = NPF_STARTUP_DIAGNOSTIC.now() - npfDiagPointsStart;

        throwIfSiaRefreshObsolete(refreshGeneration);

        /* Le nouveau groupe devient visible d'un bloc, puis l'ancien est retiré. */
        const npfDiagCommitStart = NPF_STARTUP_DIAGNOSTIC.now();
        replacementSiaLayerGroupForSwap.addTo(map);
        if (
            previousSiaLayerGroupForSwap
            && previousSiaLayerGroupForSwap !== replacementSiaLayerGroupForSwap
            && map.hasLayer(previousSiaLayerGroupForSwap)
        ) {
            map.removeLayer(previousSiaLayerGroupForSwap);
        }
        replacementSiaLayerGroupCommitted = true;
        npfDiagCommitMs = NPF_STARTUP_DIAGNOSTIC.now() - npfDiagCommitStart;
        npfDiagRenderedObjects = rendered;

        // Couverture et signature ne sont validées qu'après un rendu complet.
        siaRenderedCoverageBounds = renderBounds;
        siaRenderedZoom = zoom;
        siaRenderedSignature = signature;
        siaRenderedAirspaceFeatures = visibleAirspaceFeatures;
        siaRenderedShowDesignatedPoints = showSiaDesignatedPointsNow;
        siaRenderedPointLabelsEnabled = pointLabelsEnabledNow;
        siaRenderedDiagnosticCounts = {
            zones: visibleAirspaceFeatures.length,
            terrains: npfDiagTerrainCount,
            vrp: npfDiagVrpCount,
            otherPoints: npfDiagOtherPointCount,
            decorations: Number(siaZoomDependentLayers?.length || 0),
            touchEntries: Number(siaAirspaceTouchEntries?.length || 0)
        };

        npfDiagSiaInteraction(
            'SIA COUCHES',
            `zones=${siaRenderedDiagnosticCounts.zones} · terrains=${siaRenderedDiagnosticCounts.terrains} · vrp=${siaRenderedDiagnosticCounts.vrp} · autres=${siaRenderedDiagnosticCounts.otherPoints} · décorations=${siaRenderedDiagnosticCounts.decorations} · tactiles=${siaRenderedDiagnosticCounts.touchEntries}`,
            {
                zones: siaRenderedDiagnosticCounts.zones,
                terrains: siaRenderedDiagnosticCounts.terrains,
                vrp: siaRenderedDiagnosticCounts.vrp,
                otherPoints: siaRenderedDiagnosticCounts.otherPoints,
                decorations: siaRenderedDiagnosticCounts.decorations,
                touchEntries: siaRenderedDiagnosticCounts.touchEntries,
                totalLayers: Number(siaLayerGroup?.getLayers?.().length || 0)
            }
        );

        /* v16.66 — contours/points sont maintenant engagés ; bandes
         * intérieures et libellés suivent au repos, sans retarder ce commit. */
        if (siaMapAirspacesVisible && visibleAirspaceFeatures.length) {
            scheduleSiaMoveDecorationRefresh(`sia-${reason}-idle-v16.66`);
        }

        if (reason === 'startup-prefs') {
            armSiaStartupPassiveMoveendGuard();
        }

        const footer = document.getElementById('sia-filter-footer-status');
        if (footer) {
            const scaleNote = showSiaDesignatedPoints
                ? ''
                : ' Points SIA masqués : ils apparaissent à partir de l’échelle 5 NM.';
            const zonesNote = siaMapAirspacesVisible
                ? ''
                : ' Zones carte masquées.';
            footer.textContent = `${rendered} objet${rendered > 1 ? 's' : ''} SIA affiché${rendered > 1 ? 's' : ''} dans la zone chargée.${zonesNote}${scaleNote}`;
        }

        npfDiagSiaInteraction(
            'SIA RAFRAÎCHISSEMENT',
            `raison=${reason} · zones=${npfDiagVisibleZones} · objets=${npfDiagRenderedObjects} · zoom=${zoom} · carteZones=${siaMapAirspacesVisible ? 'ON' : 'OFF'}`,
            {
                totalMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - npfDiagRefreshStartedAt),
                datasetMs: Math.round(npfDiagDatasetMs),
                scanMs: Math.round(npfDiagScanMs),
                geoJsonMs: Math.round(npfDiagGeoJsonMs),
                touchDecorMs: Math.round(npfDiagTouchDecorMs),
                pointsMs: Math.round(npfDiagPointsMs),
                commitMs: Math.round(npfDiagCommitMs)
            }
        );

        scheduleSiaProfileRefresh(`sia-${reason}`);
    } catch (error) {
        /* En cas d'échec, conserver intégralement l'ancien rendu opérationnel. */
        if (replacementSiaLayerGroupForSwap && !replacementSiaLayerGroupCommitted) {
            try { replacementSiaLayerGroupForSwap.clearLayers(); } catch (_) {}
            siaLayerGroup = previousSiaLayerGroupForSwap;
        }
        if (error?.name === SIA_REFRESH_ABORT_ERROR_NAME) {
            return;
        }
        throw error;
    } finally {
        if (String(reason || '') === 'zoomend-after-routes-ht') {
            siaHeavyZoomFinalRefreshPending = false;
        }
        siaRefreshInProgress = false;
        siaRefreshCurrentReason = null;
        const pending = siaRefreshPendingReason;
        siaRefreshPendingReason = null;
        if (pending) scheduleSiaLayerRefresh(pending);
    }
}

