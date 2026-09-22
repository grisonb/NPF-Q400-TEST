function getDepartmentBoundaryStyle() {
    const zoom = map && Number.isFinite(map.getZoom()) ? map.getZoom() : 6;

    let weight = 1.2;
    let opacity = 0.8;

    if (zoom >= 7) {
        weight = 1.8;
        opacity = 0.9;
    }

    if (zoom >= 9) {
        weight = 2.8;
        opacity = 0.95;
    }

    if (zoom >= 11) {
        weight = 4.0;
        opacity = 1;
    }

    return {
        color: '#000000',
        weight,
        opacity,
        fillColor: '#ffffff',
        fillOpacity: 0.02,
        pane: 'overlayPane'
    };
}

function buildDepartmentCodeIcon(depCode) {
    const zoom = map && Number.isFinite(map.getZoom()) ? map.getZoom() : 6;

    let fontSize = 13;
    let padding = '2px 5px';
    let borderWidth = 2;

    if (zoom >= 7) {
        fontSize = 15;
        padding = '3px 6px';
        borderWidth = 2;
    }

    if (zoom >= 9) {
        fontSize = 18;
        padding = '4px 8px';
        borderWidth = 3;
    }

    if (zoom >= 11) {
        fontSize = 22;
        padding = '5px 10px';
        borderWidth = 3;
    }

    return L.divIcon({
        className: 'department-code-label',
        html: `<span style="
            display:inline-block;
            min-width:24px;
            padding:${padding};
            border:${borderWidth}px solid #000;
            border-radius:8px;
            background:rgba(255,255,255,.92);
            color:#000;
            font-size:${fontSize}px;
            font-weight:900;
            line-height:1;
            text-align:center;
            text-shadow:
                -1px -1px 0 #fff,
                1px -1px 0 #fff,
                -1px 1px 0 #fff,
                1px 1px 0 #fff;
            box-shadow:0 1px 5px rgba(0,0,0,.45);
            white-space:nowrap;
        ">${escapeHtml(depCode)}</span>`,
        iconSize: [1, 1],
        iconAnchor: [0, 0]
    });
}

function updateDepartmentsLayerAppearance() {
    if (!map || !hasLoadedDepartments) return;

    const style = getDepartmentBoundaryStyle();

    if (departmentsLayerGroup) {
        departmentsLayerGroup.eachLayer((layer) => {
            if (layer && typeof layer.setStyle === 'function') {
                layer.setStyle(style);
            }
        });
    }

    if (departmentsLabelsLayer) {
        departmentsLabelsLayer.eachLayer((marker) => {
            const depCode = marker?.options?.depCode;
            if (depCode && typeof marker.setIcon === 'function') {
                marker.setIcon(buildDepartmentCodeIcon(depCode));
            }
        });
    }
}

/*
 * v15.89 — Départements autonomes.
 * La géométrie locale est embarquée dans le Script afin que l'affichage du
 * calque ne dépende plus d'un fetch cross-origin Etalab au premier usage.
 * Source de construction : base communale polygonale 2025 déjà utilisée par NPF.
 */
const NPF_DEPARTMENTS_REMOTE_URL = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/departements-1000m.geojson';
const NPF_DEPARTMENTS_CACHE_NAME = 'npf-q400-departments-v13-54';
