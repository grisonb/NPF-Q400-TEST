/* ==========================================================================
   v17.96 — VISIONNEUSE PDF (repris de NPF-Q400-RUN v1.14, src/215 « lecteur PDF des cibles »).
   PDF.js 4.10.38 (Apache-2.0, dossier pdfjs/ de l'app, mis en cache par le service worker, aucun appel extérieur) :
   chaque page est dessinée sur un canvas à la largeur de la fenêtre ; zoom à deux doigts (x1 à x6) ; déplacement au doigt
   par le défilement natif ; toutes les pages ; redessinée nette après le zoom ou une rotation ; en ligne et hors ligne.
   Prête pour de futures cibles en métropole : AUCUNE cible ici (ni points, ni PDF). Entrée : ouvrirNpfVisionneusePdf(titre,
   blob). La Doc FdF, FdS / GAAR et les PDF terrains gardent leur ouverture actuelle (inchangée).
   Code de la RUN gardé tel quel, seuls les noms changent (npf-cible-… -> npf-pdf-…).
   ========================================================================== */
const NPF_PDF_ZOOM_MAX = 6;
const NPF_PDF_PIXELS_MAX = 8000000;   // pixels par page (mémoire de l'iPad)
let npfPdfBiblio = null;
let npfPdfCourant = null;
let npfPdfOuverture = 0;

function getNpfPdfBiblio() {
    if (!npfPdfBiblio) {
        npfPdfBiblio = (async () => {
            const lib = await import(new URL('pdfjs/pdf.min.mjs', window.location.href).toString());
            lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.mjs', window.location.href).toString();
            return { lib, worker: new lib.PDFWorker() };
        })().catch(error => { npfPdfBiblio = null; throw error; });
    }
    return npfPdfBiblio;
}

function setNpfPdfEtat(texte) {
    const etat = document.getElementById('npf-pdf-etat');
    if (etat) etat.textContent = texte || '';
}

/* Tailles à l'écran de toutes les pages pour le zoom courant (zoom 1 = largeur de la fenêtre). */
function placerNpfPdfPages(pdf) {
    const zone = document.getElementById('npf-pdf-scroll');
    const largeur = zone.clientWidth;
    if (!largeur) return;
    pdf.pages.forEach(p => {
        p.largeur = largeur * pdf.zoom;
        p.hauteur = p.base.height * (p.largeur / p.base.width);
        p.boite.style.width = `${p.largeur}px`;
        p.boite.style.height = `${p.hauteur}px`;
    });
    const pages = document.getElementById('npf-pdf-pages');
    pages.style.width = `${largeur * pdf.zoom}px`;
}

/* Dessin net : sur un canvas à part, qui remplace l'ancien une fois fini (l'ancien reste affiché, agrandi, en attendant). */
async function dessinerNpfPdfPage(pdf, p) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const echelleVoulue = (p.largeur / p.base.width) * dpr;
    const echelle = Math.min(echelleVoulue, Math.sqrt(NPF_PDF_PIXELS_MAX / (p.base.width * p.base.height)));
    if (p.tache) { try { p.tache.cancel(); } catch (_) {} }
    const viewport = p.page.getViewport({ scale: echelle });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const tache = p.page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
    p.tache = tache;
    try {
        await tache.promise;
    } catch (error) {
        if (error && error.name === 'RenderingCancelledException') return false;
        throw error;
    }
    if (p.tache !== tache || npfPdfCourant !== pdf) return false;
    p.tache = null;
    p.boite.replaceChildren(canvas);
    p.dessinee = true;
    return true;
}

async function dessinerNpfPdf(pdf) {
    const modal = document.getElementById('npf-pdf-viewer-modal');
    const tour = (pdf.tour = (pdf.tour || 0) + 1);
    for (const p of pdf.pages) {
        if (npfPdfCourant !== pdf || pdf.tour !== tour) return;
        await dessinerNpfPdfPage(pdf, p);
        if (modal && npfPdfCourant === pdf) modal.dataset.pagesDessinees = String(pdf.pages.filter(x => x.dessinee).length);
    }
}

function fermerNpfVisionneusePdf() {
    const modal = document.getElementById('npf-pdf-viewer-modal');
    const pdf = npfPdfCourant;
    npfPdfCourant = null;
    npfPdfOuverture += 1;
    if (pdf) {
        pdf.pages.forEach(p => { if (p.tache) { try { p.tache.cancel(); } catch (_) {} } });
        try { pdf.doc.destroy(); } catch (_) {}
    }
    document.getElementById('npf-pdf-pages')?.replaceChildren();
    setNpfPdfEtat('');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        delete modal.dataset.pages;
        delete modal.dataset.pagesDessinees;
    }
}

/* Ouvre un PDF (Blob) dans la visionneuse. Retour : true une fois toutes les pages dessinées. */
async function ouvrirNpfVisionneusePdf(titre, blob) {
    const modal = document.getElementById('npf-pdf-viewer-modal');
    const pagesEl = document.getElementById('npf-pdf-pages');
    if (!modal || !pagesEl) throw new Error('visionneuse PDF indisponible');
    if (!blob) throw new Error('PDF absent');
    fermerNpfVisionneusePdf();
    const ouverture = npfPdfOuverture;
    try { map?.closePopup?.(); } catch (_) {}
    const titreEl = document.getElementById('npf-pdf-viewer-title');
    if (titreEl) titreEl.textContent = String(titre || 'PDF');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    setNpfPdfEtat('Ouverture du PDF…');
    try {
        const { lib, worker } = await getNpfPdfBiblio();
        const data = new Uint8Array(await blob.arrayBuffer());
        const doc = await lib.getDocument({ data, worker, isEvalSupported: false }).promise;
        if (ouverture !== npfPdfOuverture) { try { doc.destroy(); } catch (_) {} return false; }
        const pdf = { titre, doc, zoom: 1, pages: [] };
        for (let n = 1; n <= doc.numPages; n += 1) {
            const page = await doc.getPage(n);
            const boite = document.createElement('div');
            boite.className = 'npf-pdf-page';
            pagesEl.appendChild(boite);
            pdf.pages.push({ page, boite, base: page.getViewport({ scale: 1 }), dessinee: false, tache: null });
        }
        npfPdfCourant = pdf;
        modal.dataset.pages = String(doc.numPages);
        setNpfPdfEtat('');
        document.getElementById('npf-pdf-scroll').scrollTo(0, 0);
        placerNpfPdfPages(pdf);
        await dessinerNpfPdf(pdf);
        return true;
    } catch (error) {
        fermerNpfVisionneusePdf();
        throw error;
    }
}

/* Zoom : facteur appliqué à partir du point (x, y) de la zone, qui reste sous les doigts. */
function appliquerNpfPdfZoom(pdf, zoom, x, y) {
    const zone = document.getElementById('npf-pdf-scroll');
    const avant = pdf.zoom;
    const nouveau = Math.max(1, Math.min(NPF_PDF_ZOOM_MAX, zoom));
    const contenuX = zone.scrollLeft + x;
    const contenuY = zone.scrollTop + y;
    pdf.zoom = nouveau;
    placerNpfPdfPages(pdf);
    zone.scrollLeft = (contenuX * nouveau) / avant - x;
    zone.scrollTop = (contenuY * nouveau) / avant - y;
    dessinerNpfPdf(pdf).catch(() => {});
}

/* Deux doigts : agrandissement immédiat par transform, tailles réelles et dessin net au lâcher. Un doigt : défilement natif. */
function brancherNpfPdfGestes() {
    const zone = document.getElementById('npf-pdf-scroll');
    const pages = document.getElementById('npf-pdf-pages');
    if (!zone || !pages) return;
    let pince = null;
    const ecart = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const centre = t => {
        const r = zone.getBoundingClientRect();
        return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top };
    };
    zone.addEventListener('touchstart', event => {
        if (event.touches.length !== 2 || !npfPdfCourant) return;
        event.preventDefault();
        const c = centre(event.touches);
        pince = { d0: ecart(event.touches), x: c.x, y: c.y, facteur: 1 };
        pages.style.transformOrigin = `${zone.scrollLeft + c.x}px ${zone.scrollTop + c.y}px`;
    }, { passive: false });
    zone.addEventListener('touchmove', event => {
        if (!pince || event.touches.length < 2) return;
        event.preventDefault();
        const pdf = npfPdfCourant;
        if (!pdf || !pince.d0) return;
        const zoom = Math.max(1, Math.min(NPF_PDF_ZOOM_MAX, pdf.zoom * (ecart(event.touches) / pince.d0)));
        pince.facteur = zoom / pdf.zoom;
        pages.style.transform = `scale(${pince.facteur})`;
    }, { passive: false });
    const finir = event => {
        if (!pince || event.touches.length >= 2) return;
        const { x, y, facteur } = pince;
        pince = null;
        pages.style.transform = '';
        pages.style.transformOrigin = '';
        if (npfPdfCourant && facteur !== 1) appliquerNpfPdfZoom(npfPdfCourant, npfPdfCourant.zoom * facteur, x, y);
    };
    zone.addEventListener('touchend', finir);
    zone.addEventListener('touchcancel', finir);
    /* Safari : pas de zoom de la page entière */
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => zone.addEventListener(type, event => event.preventDefault(), { passive: false }));
    window.addEventListener('resize', () => {
        const pdf = npfPdfCourant;
        if (!pdf) return;
        placerNpfPdfPages(pdf);
        dessinerNpfPdf(pdf).catch(() => {});
    });
}

(function brancherNpfVisionneusePdf() {
    const brancher = () => {
        document.getElementById('npf-pdf-viewer-close')?.addEventListener('click', fermerNpfVisionneusePdf);
        brancherNpfPdfGestes();
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            if (document.getElementById('npf-pdf-viewer-modal')?.style.display === 'flex') fermerNpfVisionneusePdf();
        });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', brancher, { once: true });
    else brancher();
})();

window.ouvrirNpfVisionneusePdf = ouvrirNpfVisionneusePdf;
window.fermerNpfVisionneusePdf = fermerNpfVisionneusePdf;
