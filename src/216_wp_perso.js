/* ==========================================================================
   v17.90 — WP PERSO (repères personnels : étoile magenta et nom sur la carte)
   (repris de NPF-Q400-RUN v1.14 / v1.15, adapté à la France métropolitaine)
   --------------------------------------------------------------------------
   - création par l'appui long sur la carte (bouton « WP perso », src/320) ou
     après une recherche d'adresse (src/217) : nom obligatoire, coordonnées du
     point modifiables (tous formats : degrés minutes, degrés minutes secondes,
     degrés décimaux, avec ou sans N/S/E/O, point ou virgule ; saisie incohérente
     refusée) ; bouton « Position actuelle » (GPS, ou avion simulé) ;
   - avertissement si le point n'est dans aucune commune de France métropolitaine
     (Corse comprise) : en mer ou hors de France ; on peut continuer ;
   - fiche : Direct to, Renommer, Déplacer (glisser ou saisir), Supprimer ;
   - Direct to : le WP entre dans la route du mode navigation (src/200), comme un
     terrain ; le feu en cours est fermé (règle du Go To, src/200) ;
   - étoile au-dessus des losanges de navigation (z675 > z670) : elle reste
     touchable après un Direct to ; sa fiche ouvre aussi le WP de route ;
   - gardés après fermeture de l'app, clé propre à la TEST (npfQ400TestWpPersoV1) :
     ni la pérenne ni la RUN ne la lisent.
   Ce sont des repères : jamais dans les listes de terrains, pélicandromes, terrain
   le plus proche, BINGO ni dégagements.
   ========================================================================== */

const NPF_WP_PERSO_CLE = 'npfQ400TestWpPersoV1';
const NPF_WP_PERSO_PANE = 'npfWpPersoPane';
const NPF_WP_PERSO_NOM_MAX = 40;
const NPF_WP_PERSO_AIDE_COORD = 'Exemples : N 43°27.000\' E 005°22.500\' ; 43°27\'00"N 5°22\'30"E ; 43,45 5,375 ; N4327.000 E00522.500';
let npfWpPersoListe = [];
let npfWpPersoLayer = null;
let npfWpPersoPoignee = null;

/* ---------- coordonnées : lecture de tous les formats ---------- */

function erreurNpfCoord(message) { return { erreur: message }; }

function lireNpfCoordJetons(texte) {
    const s = String(texte || '').toUpperCase()
        .replace(/[−–—]/g, '-')
        .replace(/[’′‘`´]/g, "'")
        .replace(/[”″“]/g, '"')
        .replace(/''/g, '"')
        .replace(/[º˚]/g, '°')
        .replace(/\b(LATITUDE|LONGITUDE|LAT|LONG|LON)\b/g, ' ')
        .replace(/\bNORD\b/g, 'N').replace(/\bSUD\b/g, 'S').replace(/\bEST\b/g, 'E').replace(/\bOUEST\b/g, 'O')
        .replace(/DEG\b/g, '°')
        .replace(/[/;:|]/g, ' ');
    const motif = /\s+|(\d+(?:[.,]\d+)?)|([NSEOW])|([°'"])|([-+])|(,)/y;
    const items = [];
    let signe = null;
    let position = 0;
    while (position < s.length) {
        motif.lastIndex = position;
        const m = motif.exec(s);
        if (!m) return erreurNpfCoord(`Caractère non reconnu : « ${s[position]} ».`);
        position = motif.lastIndex;
        if (m[1]) {
            items.push({ texte: m[1].replace(',', '.'), valeur: Number(m[1].replace(',', '.')), marque: null, signe });
            signe = null;
        } else if (m[2]) {
            if (signe) return erreurNpfCoord('Signe mal placé.');
            items.push({ hemisphere: m[2] === 'W' ? 'O' : m[2] });
        } else if (m[3]) {
            const dernier = items[items.length - 1];
            if (!dernier || dernier.hemisphere || dernier.marque) return erreurNpfCoord(`Symbole « ${m[3]} » mal placé.`);
            dernier.marque = m[3];
        } else if (m[4]) {
            if (signe) return erreurNpfCoord('Signe mal placé.');
            signe = m[4];
        }
    }
    if (signe) return erreurNpfCoord('Signe mal placé.');
    return items.length ? { items } : erreurNpfCoord('Coordonnées vides.');
}

/* Partage en deux d'une suite de nombres sans hémisphère entre eux : au 2e symbole ° s'il existe, sinon en deux moitiés. */
function couperNpfCoordNombres(nombres) {
    const degres = nombres.map((n, i) => (n.marque === '°' ? i : -1)).filter(i => i >= 0);
    if (degres.length === 2 && degres[0] === 0) return [nombres.slice(0, degres[1]), nombres.slice(degres[1])];
    if (nombres.length === 2 || nombres.length === 4 || nombres.length === 6) {
        return [nombres.slice(0, nombres.length / 2), nombres.slice(nombres.length / 2)];
    }
    return null;
}

/* Une coordonnée en degrés : D ; D M ; D M S ; compact DDMM(.m) / DDDMM(.m) / DDMMSS / DDDMMSS. */
function lireNpfCoordValeur(nombres, axe) {
    const nom = axe === 'lat' ? 'latitude' : 'longitude';
    if (!nombres.length || nombres.length > 3) return erreurNpfCoord(`La ${nom} n'est pas lisible.`);
    if (nombres.slice(1).some(n => n.signe)) return erreurNpfCoord('Signe mal placé.');
    const attendues = ['°', "'", '"'];
    let deg, min = 0, sec = 0;
    if (nombres.length === 1) {
        const n = nombres[0];
        if (n.marque === "'" || n.marque === '"') return erreurNpfCoord(`La ${nom} n'a pas de degrés.`);
        const [entier, decimales = ''] = n.texte.split('.');
        const limite = axe === 'lat' ? 2 : 3;
        const chiffres = entier.length;
        if (chiffres <= limite || n.marque === '°') {
            deg = n.valeur;
        } else if (chiffres <= limite + 2) {
            deg = Number(entier.slice(0, -2));
            min = Number(`${entier.slice(-2)}${decimales ? `.${decimales}` : ''}`);
        } else if (chiffres <= limite + 4 && !decimales) {
            deg = Number(entier.slice(0, -4));
            min = Number(entier.slice(-4, -2));
            sec = Number(entier.slice(-2));
        } else {
            return erreurNpfCoord(`La ${nom} n'est pas lisible.`);
        }
    } else {
        for (let i = 0; i < nombres.length; i += 1) {
            if (nombres[i].marque && nombres[i].marque !== attendues[i]) return erreurNpfCoord(`Symbole « ${nombres[i].marque} » mal placé dans la ${nom}.`);
            if (i < nombres.length - 1 && nombres[i].texte.includes('.')) return erreurNpfCoord(`Seul le dernier nombre de la ${nom} peut avoir des décimales.`);
        }
        deg = nombres[0].valeur;
        min = nombres[1].valeur;
        sec = nombres[2] ? nombres[2].valeur : 0;
    }
    if (min >= 60 || sec >= 60) return erreurNpfCoord(`Minutes ou secondes de la ${nom} incohérentes (60 ou plus).`);
    const valeur = deg + min / 60 + sec / 3600;
    if (valeur > (axe === 'lat' ? 90 : 180)) return erreurNpfCoord(`La ${nom} dépasse ${axe === 'lat' ? 90 : 180}°.`);
    return { valeur };
}

function parseNpfCoordonnees(texte) {
    const lu = lireNpfCoordJetons(texte);
    if (lu.erreur) return lu;
    const items = lu.items;
    const places = items.map((x, i) => (x.hemisphere ? i : -1)).filter(i => i >= 0);
    if (places.length !== 0 && places.length !== 2) return erreurNpfCoord('Il faut un hémisphère pour chaque coordonnée (N ou S, et E ou O), ou aucun.');
    let parties;
    let hemispheres = [null, null];
    if (!places.length) {
        parties = couperNpfCoordNombres(items);
    } else {
        const [p1, p2] = places;
        hemispheres = [items[p1].hemisphere, items[p2].hemisphere];
        if (p1 === 0 && p2 < items.length - 1) parties = [items.slice(1, p2), items.slice(p2 + 1)];
        else if (p1 === 0) parties = couperNpfCoordNombres(items.slice(1, p2));
        else if (p2 === items.length - 1) parties = [items.slice(0, p1), items.slice(p1 + 1, p2)];
        else parties = null;
    }
    if (!parties || !parties[0].length || !parties[1].length) return erreurNpfCoord('Il faut une latitude et une longitude.');
    let axes = ['lat', 'lon'];
    if (places.length) {
        const axe = h => (h === 'N' || h === 'S' ? 'lat' : 'lon');
        axes = hemispheres.map(axe);
        if (axes[0] === axes[1]) return erreurNpfCoord('Deux hémisphères du même axe : il faut N ou S, et E ou O.');
    }
    const resultat = {};
    for (let i = 0; i < 2; i += 1) {
        const nombres = parties[i];
        const signe = nombres[0].signe;
        if (signe && hemispheres[i]) return erreurNpfCoord('Signe et hémisphère en même temps : incohérent.');
        const v = lireNpfCoordValeur(nombres, axes[i]);
        if (v.erreur) return v;
        const negatif = signe === '-' || hemispheres[i] === 'S' || hemispheres[i] === 'O';
        resultat[axes[i]] = negatif ? -v.valeur : v.valeur;
    }
    return resultat;
}

/* Degrés minutes au millième : N 43°27.000' E 005°22.500' */
function formatNpfCoordonnees(lat, lon) {
    const partie = (valeur, positif, negatif) => {
        const milliemes = Math.round(Math.abs(valeur) * 60000);
        const degres = Math.floor(milliemes / 60000);
        const minutes = (milliemes - degres * 60000) / 1000;
        return `${valeur < 0 ? negatif : positif} ${String(degres).padStart(largeur, '0')}°${minutes.toFixed(3).padStart(6, '0')}'`;
    };
    let largeur = 2;
    const latTexte = partie(lat, 'N', 'S');
    largeur = 3;
    return `${latTexte} ${partie(lon, 'E', 'O')}`;
}

/* ---------- stockage ---------- */

function lireNpfWpPerso() {
    try {
        const brut = JSON.parse(localStorage.getItem(NPF_WP_PERSO_CLE) || '[]');
        npfWpPersoListe = (Array.isArray(brut) ? brut : [])
            .map(p => ({ id: String(p?.id || ''), nom: String(p?.nom || '').trim(), lat: Number(p?.lat), lon: Number(p?.lon) }))
            .filter(p => p.id && p.nom && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    } catch (_) {
        npfWpPersoListe = [];
    }
}

function garderNpfWpPerso() {
    try { localStorage.setItem(NPF_WP_PERSO_CLE, JSON.stringify(npfWpPersoListe)); } catch (_) {}
}

/* ---------- dessin : étoile magenta, nom toujours affiché ---------- */

function refreshNpfWpPerso() {
    if (typeof map === 'undefined' || !map || typeof L === 'undefined') return;
    if (!map.getPane(NPF_WP_PERSO_PANE)) {
        map.createPane(NPF_WP_PERSO_PANE);
        const pane = map.getPane(NPF_WP_PERSO_PANE);
        /* v17.90 — au-dessus des losanges de navigation (z670) : l'étoile reste touchable après un Direct to. */
        if (pane) pane.style.zIndex = '675';
    }
    if (!npfWpPersoLayer) npfWpPersoLayer = L.layerGroup().addTo(map);
    npfWpPersoLayer.clearLayers();
    npfWpPersoListe.forEach(p => {
        const marqueur = L.marker([p.lat, p.lon], {
            pane: NPF_WP_PERSO_PANE,
            keyboard: false,
            icon: L.divIcon({
                className: 'npf-wp-perso-marqueur',
                html: `<span class="npf-wp-perso-etoile"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,1.5 15.1,8.6 22.9,9.4 17,14.6 18.7,22.3 12,18.3 5.3,22.3 7,14.6 1.1,9.4 8.9,8.6" fill="#e6007e" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg></span><span class="npf-wp-perso-nom">${escapeHtml(p.nom)}</span>`,
                iconSize: [48, 48],
                iconAnchor: [24, 24],
                popupAnchor: [0, -20]
            })
        });
        marqueur._npfWpPerso = p.id;
        marqueur.on('click', () => ouvrirNpfWpPersoFiche(p.id));
        npfWpPersoLayer.addLayer(marqueur);
    });
}

/* ---------- fiche ---------- */

function ouvrirNpfWpPersoFiche(id) {
    const p = npfWpPersoListe.find(x => x.id === id);
    if (!p || !map) return;
    const fiche = document.createElement('div');
    fiche.className = 'npf-wp-perso-fiche';
    const nom = document.createElement('div');
    nom.className = 'npf-wp-perso-fiche-nom';
    nom.textContent = p.nom;
    const coord = document.createElement('div');
    coord.className = 'npf-wp-perso-fiche-coord';
    coord.textContent = formatNpfCoordonnees(p.lat, p.lon);
    const actions = document.createElement('div');
    actions.className = 'npf-wp-perso-actions';
    const bouton = (texte, classe, action) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `npf-wp-perso-btn ${classe}`;
        b.textContent = texte;
        b.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            try { map.closePopup(); } catch (_) {}
            action();
        });
        actions.appendChild(b);
    };
    bouton('Direct to', 'npf-wp-perso-btn-direct', () => npfWpPersoDirectTo(id));
    bouton('Renommer', 'npf-wp-perso-btn-renommer', () => renommerNpfWpPerso(id));
    bouton('Déplacer', 'npf-wp-perso-btn-deplacer', () => deplacerNpfWpPerso(id));
    bouton('Supprimer', 'npf-wp-perso-btn-suppr', () => supprimerNpfWpPerso(id));
    /* v17.90 — WP de route issu de ce WP perso (Direct to) : sa fiche reste accessible, l'étoile étant au-dessus. */
    const wpRoute = getNpfWpPersoRouteWp(id);
    if (wpRoute) {
        bouton('WP de route', 'npf-wp-perso-btn-route', () => {
            try { openNpfWaypointPopupNearLatLng(L.latLng(wpRoute.lat, wpRoute.lon), NPF_WAYPOINT_SELECT_TOLERANCE_PX); } catch (_) {}
        });
    }
    fiche.append(nom, coord, actions);
    L.popup({ maxWidth: 300, closeButton: true, autoPan: !centerGpsFollowActive, offset: [0, -14] })
        .setLatLng([p.lat, p.lon])
        .setContent(fiche)
        .openOn(map);
}

/* ---------- fenêtre de saisie ---------- */

/* Position de l'avion (GPS, ou avion simulé en simulation). La position mémorisée à la fermeture de l'app
 * (lastPosition.stored) sert à placer l'avion au démarrage mais n'est pas une position actuelle. */
function getNpfWpPersoPositionAvion() {
    const p = lastPosition;
    if (!p) return null;
    if (isSimulationMode ? p.simulation !== true : (p.simulation === true || p.stored === true)) return null;
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, ageMinutes: p.simulation === true ? 0 : Math.floor((Date.now() - Number(p.timestamp)) / 60000) };
}

/* options : titre, nom (texte ou null si pas de champ), lat, lon (null si pas de champ), glisser (bouton « Glisser sur la carte »).
 * Résultat : { nom, lat, lon }, 'glisser' ou null (Annuler). */
function demanderNpfWpPerso(options) {
    return new Promise(resolve => {
        const avecNom = options.nom !== null;
        const avecCoord = options.lat !== null;
        let fond = document.getElementById('npf-wp-perso-modal');
        if (!fond) {
            fond = document.createElement('div');
            fond.id = 'npf-wp-perso-modal';
            fond.className = 'npf-confirm-modal';
            fond.innerHTML = `
                <div class="npf-confirm-card" role="dialog" aria-modal="true" aria-labelledby="npf-wp-perso-titre">
                    <div id="npf-wp-perso-titre" class="npf-confirm-title"></div>
                    <label class="npf-wp-perso-champ" id="npf-wp-perso-champ-nom">Nom
                        <input id="npf-wp-perso-nom" type="text" maxlength="${NPF_WP_PERSO_NOM_MAX}" autocomplete="off" autocapitalize="characters">
                    </label>
                    <label class="npf-wp-perso-champ" id="npf-wp-perso-champ-coord">Coordonnées
                        <input id="npf-wp-perso-coord" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false">
                        <div class="npf-wp-perso-aide"></div>
                    </label>
                    <button type="button" id="npf-wp-perso-position" class="npf-wp-perso-btn npf-wp-perso-position">Position actuelle</button>
                    <button type="button" id="npf-wp-perso-glisser" class="npf-wp-perso-btn npf-wp-perso-glisser">Glisser sur la carte</button>
                    <div id="npf-wp-perso-erreur" class="npf-wp-perso-erreur" aria-live="polite"></div>
                    <div class="npf-confirm-actions">
                        <button type="button" class="npf-confirm-cancel">Annuler</button>
                        <button type="button" class="npf-confirm-ok">Valider</button>
                    </div>
                </div>`;
            document.body.appendChild(fond);
        }
        const champNom = fond.querySelector('#npf-wp-perso-nom');
        const champCoord = fond.querySelector('#npf-wp-perso-coord');
        const erreur = fond.querySelector('#npf-wp-perso-erreur');
        const glisser = fond.querySelector('#npf-wp-perso-glisser');
        const position = fond.querySelector('#npf-wp-perso-position');
        const coordInitiale = avecCoord ? formatNpfCoordonnees(options.lat, options.lon) : '';
        fond.querySelector('#npf-wp-perso-titre').textContent = options.titre;
        fond.querySelector('#npf-wp-perso-champ-nom').style.display = avecNom ? 'block' : 'none';
        fond.querySelector('#npf-wp-perso-champ-coord').style.display = avecCoord ? 'block' : 'none';
        fond.querySelector('.npf-wp-perso-aide').textContent = NPF_WP_PERSO_AIDE_COORD;
        position.style.display = avecCoord ? 'block' : 'none';
        glisser.style.display = options.glisser ? 'block' : 'none';
        champNom.value = avecNom ? options.nom : '';
        champCoord.value = coordInitiale;
        erreur.textContent = '';
        const fin = valeur => {
            fond.style.display = 'none';
            fond.querySelector('.npf-confirm-ok').onclick = null;
            fond.querySelector('.npf-confirm-cancel').onclick = null;
            glisser.onclick = null;
            position.onclick = null;
            resolve(valeur);
        };
        fond.querySelector('.npf-confirm-cancel').onclick = () => fin(null);
        glisser.onclick = () => fin('glisser');
        position.onclick = () => {
            const avion = getNpfWpPersoPositionAvion();
            if (!avion) { erreur.textContent = "Pas de position de l'avion disponible : coordonnées inchangées."; return; }
            champCoord.value = formatNpfCoordonnees(avion.lat, avion.lon);
            erreur.textContent = avion.ageMinutes >= 1 ? `Dernière position GPS reçue il y a ${avion.ageMinutes} min.` : '';
        };
        fond.querySelector('.npf-confirm-ok').onclick = async () => {
            const nom = champNom.value.trim();
            if (avecNom && !nom) { erreur.textContent = 'Le nom est obligatoire.'; return; }
            let lat = options.lat;
            let lon = options.lon;
            if (avecCoord && champCoord.value.trim() !== coordInitiale) {
                const lu = parseNpfCoordonnees(champCoord.value);
                if (lu.erreur) { erreur.textContent = `Coordonnées refusées : ${lu.erreur} Rien n'est créé.`; return; }
                lat = lu.lat;
                lon = lu.lon;
            }
            if (avecCoord && !(await confirmerNpfWpPersoFrance(lat, lon))) return;
            fin({ nom, lat, lon });
        };
        fond.style.display = 'flex';
    });
}

/* v17.90 — en France métropolitaine (Corse comprise) = dans une commune (contours des communes, src/250). Hors de
 * toute commune : en mer ou hors de France ; avertissement, on peut continuer. Contours indisponibles : commune la plus
 * proche à 3 NM au plus. */
async function estNpfWpPersoEnFrance(lat, lon) {
    try {
        if (typeof hasLoadedCommunes !== 'undefined' && !hasLoadedCommunes && typeof ensureCommunesLayerDataLoaded === 'function') {
            await ensureCommunesLayerDataLoaded();
        }
    } catch (_) {}
    try {
        if (Array.isArray(communesPolygonData) && communesPolygonData.length) return !!findCommuneContainingPoint(lat, lon);
    } catch (_) {}
    try { return !!findClosestCommune(lat, lon, 3); } catch (_) { return true; }
}

async function confirmerNpfWpPersoFrance(lat, lon) {
    if (await estNpfWpPersoEnFrance(lat, lon)) return true;
    return npfConfirmInApp(`Ce point (${formatNpfCoordonnees(lat, lon)}) n'est dans aucune commune de France métropolitaine (Corse comprise) : en mer ou hors de France.\n\nContinuer quand même ?`);
}

/* ---------- actions ---------- */

async function ouvrirNpfWpPersoCreation(latlng, nomInitial = '') {
    const r = await demanderNpfWpPerso({ titre: 'Nouveau WP perso', nom: nomInitial.slice(0, NPF_WP_PERSO_NOM_MAX), lat: Number(latlng.lat), lon: Number(latlng.lng) });
    if (!r || r === 'glisser') return false;
    npfWpPersoListe.push({ id: `perso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, nom: r.nom, lat: r.lat, lon: r.lon });
    garderNpfWpPerso();
    refreshNpfWpPerso();
    return true;
}

/* WP de la route de navigation qui vient de ce WP perso (nom et position suivent le WP perso). */
function getNpfWpPersoRouteWp(id) {
    return npfWaypointRouteState.waypoints.find(wp => wp.source === 'wpperso' && wp.sourceRef === id) || null;
}

function appliquerNpfWpPersoChangement(p) {
    garderNpfWpPerso();
    refreshNpfWpPerso();
    const wp = getNpfWpPersoRouteWp(p.id);
    if (!wp) return;
    wp.name = p.nom;
    wp.lat = p.lat;
    wp.lon = p.lon;
    persistNpfWaypointRouteState();
    redrawNpfWaypointRoute();
    drawUserToTargetRoute();
    syncNpfWaypointNavigationBanner();
}

async function renommerNpfWpPerso(id) {
    const p = npfWpPersoListe.find(x => x.id === id);
    if (!p) return false;
    const r = await demanderNpfWpPerso({ titre: 'Renommer le WP perso', nom: p.nom, lat: null, lon: null });
    if (!r) return false;
    p.nom = r.nom;
    appliquerNpfWpPersoChangement(p);
    return true;
}

async function deplacerNpfWpPerso(id) {
    const p = npfWpPersoListe.find(x => x.id === id);
    if (!p) return false;
    const r = await demanderNpfWpPerso({ titre: `Déplacer ${p.nom}`, nom: null, lat: p.lat, lon: p.lon, glisser: true });
    if (!r) return false;
    if (r === 'glisser') return glisserNpfWpPerso(p);
    p.lat = r.lat;
    p.lon = r.lon;
    appliquerNpfWpPersoChangement(p);
    return true;
}

function retirerNpfWpPersoPoignee() {
    if (!npfWpPersoPoignee) return;
    const poignee = npfWpPersoPoignee;
    npfWpPersoPoignee = null;
    setTimeout(() => { try { poignee.remove(); } catch (_) {} }, 0);
}

/* Poignée de 76 px, comme « Déplacer » d'un WP de navigation ; toucher ailleurs sur la carte annule. */
function glisserNpfWpPerso(p) {
    if (!map || !ensureNpfWaypointRouteLayers()) return false;
    retirerNpfWpPersoPoignee();
    const poignee = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
            className: 'npf-waypoint-move-handle',
            html: `<span class="npf-waypoint-move-handle-ring"><span>${escapeHtml(p.nom.slice(0, 6))}</span></span>`,
            iconSize: [76, 76],
            iconAnchor: [38, 38]
        }),
        pane: map.getPane('npfWaypointMovePane') ? 'npfWaypointMovePane' : 'markerPane',
        zIndexOffset: 20000,
        keyboard: false,
        draggable: true,
        autoPan: true,
        autoPanPadding: [60, 60],
        autoPanSpeed: 10
    }).addTo(map);
    npfWpPersoPoignee = poignee;
    const annuler = () => retirerNpfWpPersoPoignee();
    map.once('click', annuler);
    poignee.on('dragend', () => {
        map.off('click', annuler);
        const position = poignee.getLatLng();
        retirerNpfWpPersoPoignee();
        p.lat = Number(position.lat);
        p.lon = Number(position.lng);
        appliquerNpfWpPersoChangement(p);
    });
    return true;
}

async function supprimerNpfWpPerso(id) {
    const p = npfWpPersoListe.find(x => x.id === id);
    if (!p) return false;
    if (!(await npfConfirmInApp(`Supprimer le WP perso « ${p.nom} » ?`))) return false;
    npfWpPersoListe = npfWpPersoListe.filter(x => x.id !== id);
    garderNpfWpPerso();
    refreshNpfWpPerso();
    /* S'il est dans la route de navigation, il y reste comme WP libre : la navigation en cours n'est pas coupée. */
    const wp = getNpfWpPersoRouteWp(id);
    if (wp) {
        wp.source = 'map';
        wp.sourceRef = '';
        persistNpfWaypointRouteState();
    }
    return true;
}

/* Direct to : comme un terrain en mode navigation (route WP, bandeau cap / distance / temps, WP intermédiaires). */
function npfWpPersoDirectTo(id) {
    const p = npfWpPersoListe.find(x => x.id === id);
    if (!p) return false;
    if (!getNpfWpPersoRouteWp(id)) addNpfWaypoint({ lat: p.lat, lon: p.lon, name: p.nom, source: 'wpperso', sourceRef: id });
    const wp = getNpfWpPersoRouteWp(id);
    return wp ? activateNpfWaypointGoto(wp.id) : false;
}

/* La carte est créée après le chargement du script : on attend qu'elle existe. */
(function attendreCarteWpPerso(essai = 0) {
    if (typeof map !== 'undefined' && map && typeof map.whenReady === 'function') {
        map.whenReady(() => {
            lireNpfWpPerso();
            refreshNpfWpPerso();
        });
        return;
    }
    if (essai < 240) setTimeout(() => attendreCarteWpPerso(essai + 1), 500);
})();

window.ouvrirNpfWpPersoFiche = ouvrirNpfWpPersoFiche;
window.parseNpfCoordonnees = parseNpfCoordonnees;
window.formatNpfCoordonnees = formatNpfCoordonnees;
