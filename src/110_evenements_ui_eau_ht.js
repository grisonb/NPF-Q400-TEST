function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search');
    const airportCountInput = document.getElementById('airport-count');
    const gpsFeuButton = document.getElementById('gps-feu-button');
    const centerGpsButton = document.getElementById('center-gps-button');
    const liveGpsButton = document.getElementById('live-gps-button');
    const lftwRouteButton = document.getElementById('lftw-route-button');
    const gaarModeButton = document.getElementById('gaar-mode-button');
    const editCircuitsButton = document.getElementById('edit-circuits-button');
    const deleteCircuitsButton = document.getElementById('delete-circuits-btn');
    const toggleSearchButton = document.getElementById('toggle-search-button');
    const mainActionButtons = document.getElementById('main-action-buttons');
    const calculatorButton = document.getElementById('calculator-button');
    const blocFuelShortcutButton = document.getElementById('bloc-fuel-shortcut-button');
    const calculatorModal = document.getElementById('calculator-modal');
    const closeCalculatorButton = document.getElementById('close-calculator-btn');
    const departmentsLayerButton = document.getElementById('departments-layer-button');
    const communesLayerButton = document.getElementById('communes-layer-button');
    const waterPointsButton = document.getElementById('water-points-button');
    const highVoltageLinesButton = document.getElementById('high-voltage-lines-button');
    const roadOverlayButton = document.getElementById('road-overlay-button');
    const opsFrequenciesButton = document.getElementById('ops-frequencies-pdf-button');
    const quickOfflineMapButton = document.getElementById('quick-offline-map-button');
    const quickSiaVrpToggleButton = document.getElementById('quick-sia-vrp-toggle');
    const quickSiaZonesToggleButton = document.getElementById('quick-sia-zones-toggle');
    const quickOfflineMapModal = document.getElementById('quick-offline-map-modal');
    const closeQuickOfflineMapModalButton = document.getElementById('close-quick-offline-map-modal');
    const trafficLayerButton = document.getElementById('traffic-layer-button');
    const offlineMapsButton = document.getElementById('offline-maps-button');
    const offlineMapModal = document.getElementById('offline-map-modal');
    const closeOfflineMapButton = document.getElementById('close-offline-map-btn');
    const vacDownloadUpdateButton = document.getElementById('vac-download-update-button');
    const notamsRefreshButton = document.getElementById('notams-refresh-button');
    const vacDeleteAllButton = document.getElementById('vac-delete-all-button');
    const vacUpdateModal = document.getElementById('vac-update-modal');
    const vacUpdateNowButton = document.getElementById('vac-update-now-button');
    const vacUpdateLaterButton = document.getElementById('vac-update-later-button');
    const zipImporterInput = document.getElementById('zip-importer-input');
    const folderImporterInput = document.getElementById('folder-importer-input');
    const tilesImporterInput = document.getElementById('tiles-importer-input');
    const airportPdfImporterInput = document.getElementById('airport-pdf-importer-input');
    const deleteAllAirportPdfsButton = document.getElementById('delete-all-airport-pdfs-button');
    const roadOverlayImporterInput = document.getElementById('road-overlay-importer-input');
    const deleteRoadOverlayButton = document.getElementById('delete-road-overlay-button');
    const mapSourceOnlineBtn = document.getElementById('map-source-online-btn');
    const mapSourceOfflineBtn = document.getElementById('map-source-offline-btn');
    const simulationModeButton = document.getElementById('simulation-mode-button');
    const simulationMotionButton = document.getElementById('simulation-motion-button');
    const simulationMotionModal = document.getElementById('simulation-motion-modal');
    const closeSimulationMotionModalButton = document.getElementById('close-simulation-motion-modal');
    const applySimulationMotionButton = document.getElementById('apply-simulation-motion');
    const quitSimulationModeButton = document.getElementById('quit-simulation-mode');
    const simulationSpeedInput = document.getElementById('simulation-speed-input');
    const simulationRouteInput = document.getElementById('simulation-route-input');
    const simulationAltitudeInput = document.getElementById('simulation-altitude-input');
    
    if (mainActionButtons) {
        const versionDisplay = document.getElementById('app-version-display');
        if (versionDisplay) {
            versionDisplay.innerText = (typeof APP_VERSION !== 'undefined' && APP_VERSION) ? APP_VERSION : 'version inconnue';
        }

        const forceUpdateButton = document.getElementById('force-update-button');
        if (forceUpdateButton && forceUpdateButton.dataset.bound !== '1') {
            forceUpdateButton.dataset.bound = '1';
            forceUpdateButton.addEventListener('click', async () => {
                forceUpdateButton.disabled = true;
                forceUpdateButton.textContent = '⏳ MAJ...';
                try {
                    if (typeof window.forceRecoveryReload === 'function') {
                        await window.forceRecoveryReload();
                    } else {
                        window.location.reload();
                    }
                } catch (error) {
                    alert(`Mise à jour impossible: ${error.message}`);
                } finally {
                    forceUpdateButton.disabled = false;
                    forceUpdateButton.textContent = '🔄 MAJ';
                }
            });
        }
    }

    if (departmentsLayerButton) {
        departmentsLayerButton.classList.toggle('active', areDepartmentsVisible);
        departmentsLayerButton.addEventListener('click', () => {
            toggleDepartmentsLayer(!areDepartmentsVisible);
        });

        if (map && map._departmentZoomStyleBound !== true) {
            map._departmentZoomStyleBound = true;
            map.on('zoomend', updateDepartmentsLayerAppearance);
        }
    }

    if (communesLayerButton) {
        communesLayerButton.classList.toggle('active', areCommunesVisible);
        communesLayerButton.addEventListener('click', () => {
            toggleCommunesLayer(!areCommunesVisible);
        });

        if (map && map._communesZoomStyleBound !== true) {
            map._communesZoomStyleBound = true;
 // v16.02 — recalcul Communes différé après stabilisation de la vue pour ne pas concurrencer SS / GLR / SIA.
            map.on('zoomend moveend', event => { if (event?.type !== 'moveend' || !isNpfGpsFollowProgrammaticPan()) scheduleCommunesLayerAppearanceRefresh(260); });
        }
    }

    if (waterPointsButton) {
        waterPointsButton.classList.toggle('active', showWaterPointsLayer);
        waterPointsButton.addEventListener('click', () => {
            toggleWaterPointsLayer();
        });
    }

    if (highVoltageLinesButton) {
        refreshHighVoltageLinesButtonState();
        highVoltageLinesButton.addEventListener('click', () => {
            toggleHighVoltageLinesLayer();
        });
    }

    if (roadOverlayButton) {
        refreshRoadOverlayButtonState();
        roadOverlayButton.addEventListener('click', () => {
            toggleRoadOverlayLayer();
        });
    }

    if (opsFrequenciesButton) {
        opsFrequenciesButton.addEventListener('click', () => {
            openOpsFrequenciesPdf();
        });
    }

    if (quickOfflineMapButton) {
        refreshQuickOfflineMapButtonState();
        installQuickOfflineMapButtonInteractions(quickOfflineMapButton);
    }


    if (quickSiaVrpToggleButton) {
        updateQuickSiaVrpToggleButton();
        quickSiaVrpToggleButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setSiaMapVrpVisible(!siaMapVrpVisible);
        });
    }

    if (quickSiaZonesToggleButton) {
        updateSiaProfileMapZonesToggleButton();
        quickSiaZonesToggleButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setSiaMapAirspacesVisible(!siaMapAirspacesVisible);
        });
    }

    if (closeQuickOfflineMapModalButton) {
        closeQuickOfflineMapModalButton.addEventListener('click', () => {
            closeQuickOfflineMapSelector();
        });
    }

    if (quickOfflineMapModal) {
        quickOfflineMapModal.addEventListener('click', (event) => {
            if (event.target === quickOfflineMapModal) closeQuickOfflineMapSelector();
        });
    }

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && quickOfflineMapModal && quickOfflineMapModal.style.display === 'flex') {
            closeQuickOfflineMapSelector();
        }
    });

    if (trafficLayerButton) {
        refreshTrafficButtonState();
        installTrafficButtonInteractions(trafficLayerButton);
    }

    let searchInputDebounceTimer = null;

    const runCommuneSearch = () => {
        const rawSearch = searchInput.value;
        clearSearchBtn.style.display = rawSearch.length > 0 ? 'block' : 'none';

        const communeSearch = searchCommunesWithSharedEngine(rawSearch, 10);
        const {
            departmentFilter,
            searchTerm,
            simplifiedSearch,
            searchWords,
            results: localResults
        } = communeSearch;

        if (simplifiedSearch.length < 2) {
            namedPlacesSearchSequence += 1;

            if (rawSearch.trim().length === 0) {
                displayFireHistory();
            } else {
                document.getElementById('results-list').style.display = 'none';
            }
            return;
        }
        displayResults(localResults);

        const sequence =
            ++namedPlacesSearchSequence;

        /*
         * Le résultat communes/alias est affiché immédiatement. La base locale
         * Gironde est ensuite fusionnée, sans réseau et sans bloquer le clavier.
         */
        enrichCommuneSearchWithNamedPlaces({
            rawSearch,
            searchTerm,
            departmentFilter,
            searchWords,
            localResults,
            expectedSequence: sequence
        });
    };

    searchInput.addEventListener('input', keepKeyboardAfterSearchClear);
    searchInput.addEventListener('search', () => {
        clearSearchBtn.style.display = searchInput.value.length > 0 ? 'block' : 'none';
        if (searchInput.value.length === 0) {
            displayFireHistory();
        }
        keepKeyboardAfterSearchClear();
    });

    searchInput.addEventListener('input', () => {
        clearSearchBtn.style.display = searchInput.value.length > 0 ? 'block' : 'none';

        if (searchInputDebounceTimer) {
            clearTimeout(searchInputDebounceTimer);
        }

        /*
         * v11.85 — fluidité saisie.
         * Le scoring complet communes + alias ne tourne plus à chaque frappe.
         * Il est déclenché après une courte pause, ou immédiatement si la saisie
         * se termine par un département, cas typique pour affiner les alias.
         */
        const value = searchInput.value;
        const immediateDepartmentSearch = /\s(\d{1,3}|2A|2B)$/i.test(value);

        searchInputDebounceTimer = setTimeout(runCommuneSearch, immediateDepartmentSearch ? 0 : 260);
    });

    const showFireHistoryFromSearch = () => {
        /*
         * v14.45 — placement tactile natif du curseur dans la recherche.
         * L'ancien setSelectionRange différé remettait systématiquement le
         * curseur à droite après un toucher au milieu du nom. On conserve le
         * focus et l'historique, mais Safari/iPadOS choisit désormais lui-même
         * la position exacte correspondant au toucher de l'utilisateur.
         */
        searchInput.disabled = false;
        searchInput.readOnly = false;
        displayFireHistory();
    };

    const collapseSearchInputSelection = () => {
        if (document.activeElement !== searchInput || !searchInput.value) return;
        try {
            const end = searchInput.value.length;
            searchInput.setSelectionRange(end, end);
        } catch (_) {}
    };

    searchInput.addEventListener('focus', showFireHistoryFromSearch);
    searchInput.addEventListener('click', showFireHistoryFromSearch);
    document.addEventListener('pointerdown', (event) => {
        if (event.target === searchInput) return;

        /*
         * v11.95 — iPad : ne pas laisser le gestionnaire global interférer
         * avec le bouton X du feu en cours. Le clavier doit rester ouvert.
         */
        if (event.target && event.target.closest && (
            event.target.closest('#clear-commune-btn') ||
            event.target.closest('#clear-search') ||
            event.target.closest('#search-container')
        )) {
            return;
        }

        setTimeout(collapseSearchInputSelection, 0);
    }, true);
    searchInput.addEventListener('pointerdown', () => {
        searchInput.disabled = false;
        searchInput.readOnly = false;
    });

    const focusSearchInputForKeyboard = () => {
        searchInput.disabled = false;
        searchInput.readOnly = false;
        try {
            searchInput.focus({ preventScroll: true });
        } catch (_) {
            searchInput.focus();
        }
    };

    const prepareSearchClearAndKeyboard = (event = null) => {
        if (event) event.stopPropagation();
        focusSearchInputForKeyboard();
    };

    const clearSearchInputAndKeepKeyboard = (event = null) => {
        /*
         * v12.66 — iPad : lorsque le champ contient déjà un feu et que l'on clique
         * sur X, on force le focus dans le geste utilisateur pour rouvrir le clavier.
         */
        if (event) {
            event.stopPropagation();
        }

        focusSearchInputForKeyboard();
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        document.getElementById('results-list').style.display = 'none';
        displayFireHistory();

        const refocus = () => {
            try {
                searchInput.focus({ preventScroll: true });
                searchInput.setSelectionRange(0, 0);
            } catch (_) {
                searchInput.focus();
            }
        };

        refocus();
        setTimeout(refocus, 40);
        setTimeout(refocus, 140);
    };

    ['touchstart', 'pointerdown', 'mousedown'].forEach((eventName) => {
        clearSearchBtn.addEventListener(eventName, prepareSearchClearAndKeyboard, { passive: false });
    });

    clearSearchBtn.addEventListener('touchend', (event) => {
        event.preventDefault();
        clearSearchInputAndKeepKeyboard(event);
    }, { passive: false });

    clearSearchBtn.addEventListener('click', (event) => {
        event.preventDefault();
        clearSearchInputAndKeepKeyboard(event);
    });

    airportCountInput.addEventListener('change', () => {
        if (currentCommune) {
            displayCommuneDetails(currentCommune, false);
        }
    });

    gpsFeuButton.addEventListener('click', () => {
        if (!navigator.geolocation) { alert("La géolocalisation n'est pas supportée par votre navigateur."); return; }
        selectedPelicanOACI = null;
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                clearAirportDestination({ restoreFire: false, redraw: false });
                const { latitude, longitude } = pos.coords;
                const gpsCommune = await buildManualFireCommuneFromPointAsync(latitude, longitude, 'Feu GPS');
                currentCommune = gpsCommune;
                localStorage.setItem('currentCommune', JSON.stringify(gpsCommune));
                displayCommuneDetails(gpsCommune, false);
                armNpfFirePelicAutoCycle('fire');
            },
            () => { alert("Impossible d'obtenir la position GPS. Veuillez vérifier vos autorisations."); },
            { enableHighAccuracy: true }
        );
    });

    if (centerGpsButton) {
        refreshCenterGpsFollowButtonState();
        installCenterGpsFollowHandlers();
        installCenterGpsButtonPressHandlers(centerGpsButton);
    }

    liveGpsButton.addEventListener('click', toggleLiveGps);
    if (lftwRouteButton) {
        lftwRouteButton.addEventListener('click', toggleLftwRoute);
    }
    gaarModeButton.addEventListener('click', toggleGaarVisibility);
    editCircuitsButton.addEventListener('click', toggleGaarDrawingMode);
    deleteCircuitsButton.addEventListener('click', () => { if (confirm("Voulez-vous vraiment supprimer tous les circuits GAAR ?")) { clearAllGaarCircuits(); } });

    toggleSearchButton.addEventListener('click', () => {
        const uiOverlay = document.getElementById('ui-overlay');
        const communeDisplay = document.getElementById('commune-info-display');
        if (uiOverlay.style.display === 'none') {
            uiOverlay.style.display = 'block';
            document.body?.classList.add('npf-main-search-open');
            communeDisplay.style.display = 'none';
            toggleSearchButton.classList.add('active');
            setTimeout(() => {
                try {
                    searchInput.disabled = false;
                    searchInput.readOnly = false;
                    searchInput.focus();
                    if (searchInput.value) searchInput.select();
                } catch (_) {}
            }, 80);
        } else {
            uiOverlay.style.display = 'none';
            document.body?.classList.remove('npf-main-search-open');
            toggleSearchButton.classList.remove('active');
            if (communeDisplay.innerHTML.trim() !== '' && (currentCommune || selectedAirportDestination)) {
                communeDisplay.style.display = 'flex';
            }
        }
    });

    const closeSearchAfterTargetSelection = () => {
        document.getElementById('ui-overlay').style.display = 'none';
        document.body?.classList.remove('npf-main-search-open');
        document.getElementById('toggle-search-button').classList.remove('active');
        if (currentCommune || selectedAirportDestination) {
            document.getElementById('commune-info-display').style.display = 'flex';
        }
    };

    document.addEventListener('communeSelected', closeSearchAfterTargetSelection);
    document.addEventListener('airportDestinationSelected', closeSearchAfterTargetSelection);

    function setCalculatorModalOpen(open) {
        if (!calculatorModal) return;
        const isOpen = open === true;
        calculatorModal.style.display = isOpen ? 'flex' : 'none';
        document.body?.classList.toggle('npf-calculator-modal-open', isOpen);
        if (isOpen) {
            try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (_) { try { window.scrollTo(0, 0); } catch (_) {} }
        }
    }

    function openCalculatorTab(tabId) {
        if (!calculatorModal) return;
        setCalculatorModalOpen(true);
        const targetTab = calculatorModal.querySelector(`.onglet-bouton[data-onglet="${tabId}"]`);
        if (targetTab) targetTab.click();
    }

    calculatorButton.addEventListener('click', () => { openCalculatorTab('previ-rotations'); });
    if (blocFuelShortcutButton) {
        blocFuelShortcutButton.addEventListener('click', () => { openCalculatorTab('bloc-fuel'); });
    }
    closeCalculatorButton.addEventListener('click', () => { setCalculatorModalOpen(false); });
    calculatorModal.addEventListener('click', (e) => { if (e.target === calculatorModal) { setCalculatorModalOpen(false); } });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && calculatorModal.style.display === 'flex') { setCalculatorModalOpen(false); } });

    /*
     * v16.56 — iPad : empêcher un glissement sur une zone non défilable de
     * déplacer visuellement toute la modale. Les deux vrais conteneurs de
     * contenu restent scrollables, mais leur rebond est bloqué aux extrémités.
     */
    let calculatorTouchLastY = null;
    calculatorModal.addEventListener('touchstart', event => {
        calculatorTouchLastY = Number(event.touches?.[0]?.clientY);
    }, { passive: true });
    calculatorModal.addEventListener('touchmove', event => {
        const currentY = Number(event.touches?.[0]?.clientY);
        const target = event.target instanceof Element ? event.target : null;
        const scroller = target?.closest('#calculator-modal .table-wrapper, #calculator-modal .analyse-grid');
        if (!scroller || !Number.isFinite(currentY) || !Number.isFinite(calculatorTouchLastY)) {
            event.preventDefault();
            calculatorTouchLastY = currentY;
            return;
        }
        const deltaY = currentY - calculatorTouchLastY;
        const atTop = scroller.scrollTop <= 0;
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
        if ((deltaY > 0 && atTop) || (deltaY < 0 && atBottom)) {
            event.preventDefault();
        }
        calculatorTouchLastY = currentY;
    }, { passive: false });
    calculatorModal.addEventListener('touchend', () => { calculatorTouchLastY = null; }, { passive: true });
    calculatorModal.addEventListener('touchcancel', () => { calculatorTouchLastY = null; }, { passive: true });
    const importHelpContent = {
        'offline-maps': {
            title: 'Aide — Importer Cartes Offline',
            text: [
                'Clique sur Drive.',
                'Il faut être connecté au Drive Dash 8.',
                'Ouvre le dossier Cartes NPF-Q400, puis Cartes OACI, et clique sur le fichier ZIP.',
                'Une fois le téléchargement terminé, recommence la procédure et ouvre le dossier Cartes NPF v....',
                'Il faut télécharger les fichiers ZIP un par un, les uns après les autres et dans l\'ordre en répétant l’opération décrite pour chaque fichier.'
            ].join('\n')
        },
        'road-overlay': {
            title: 'Aide — Importer Calque Routier',
            text: [
                'Clique sur Drive.',
                'Il faut être connecté au Drive Dash 8.',
                'Ouvre le dossier Cartes NPF-Q400, puis Calque Routier et clique sur le fichier ZIP.'
            ].join('\n')
        },
        'fdf-pdfs': {
            title: 'Aide — Importer Doc FdF Réduite / Carte Fréquences',
            text: [
                'Clique sur Drive.',
                'Il faut être connecté au Drive Dash 8.',
                'Ouvre le dossier Cartes NPF-Q400, puis Doc Fdf.',
                'Fais Tout sélectionner, puis Ouvrir.',
                'Cela va télécharger la documentation FDF réduite, accessible en cliquant sur les pélicandromes, ainsi que la carte des fréquences OPS.'
            ].join('\n')
        }
    };

    const importHelpModal = document.getElementById('import-help-modal');
    const importHelpModalTitle = document.getElementById('import-help-modal-title');
    const importHelpModalText = document.getElementById('import-help-modal-text');
    const closeImportHelpModalButton = document.getElementById('close-import-help-modal');
    const importHelpModalOkButton = document.getElementById('import-help-modal-ok');

    function closeImportHelpModal() {
        if (!importHelpModal) return;
        importHelpModal.style.display = 'none';
        importHelpModal.setAttribute('aria-hidden', 'true');
    }

    function openImportHelpModal(helpKey) {
        const content = importHelpContent[helpKey];
        if (!content || !importHelpModal) return;
        if (importHelpModalTitle) importHelpModalTitle.textContent = content.title;
        if (importHelpModalText) importHelpModalText.textContent = content.text;
        importHelpModal.style.display = 'flex';
        importHelpModal.setAttribute('aria-hidden', 'false');
    }

    document.querySelectorAll('.import-help-button').forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openImportHelpModal(button.dataset.importHelp || '');
        });
    });

    if (closeImportHelpModalButton) closeImportHelpModalButton.addEventListener('click', closeImportHelpModal);
    if (importHelpModalOkButton) importHelpModalOkButton.addEventListener('click', closeImportHelpModal);
    if (importHelpModal) {
        importHelpModal.addEventListener('click', (event) => {
            if (event.target === importHelpModal) closeImportHelpModal();
        });
    }
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && importHelpModal?.style.display === 'flex') closeImportHelpModal();
    });

    initializeBriefingDocsUi();

    offlineMapsButton.addEventListener('click', () => {
        offlineMapModal.style.display = 'flex';
        displayInstalledMaps();
        displayInstalledAirportPdfs();
        displayVacManagementStatus();
        refreshSimulationModeButtonState();
        refreshRoadOverlayInstalledStatus();
        displayNpfNotamsLocalStatus().catch(() => {});
    });
    closeOfflineMapButton.addEventListener('click', () => { offlineMapModal.style.display = 'none'; });

    if (notamsRefreshButton) {
        notamsRefreshButton.addEventListener('click', () => {
            refreshNpfNotamsFromNasManually().catch(error => {
                console.error('[NPF NOTAMS] Rafraîchissement impossible:', error);
            });
        });
    }
    if (vacDownloadUpdateButton) {
        vacDownloadUpdateButton.addEventListener('click', () => {
            handleVacDownloadUpdateClick().catch(error => {
                console.error('[VAC] Téléchargement / mise à jour impossible:', error);
            });
        });
    }
    if (vacDeleteAllButton) {
        vacDeleteAllButton.addEventListener('click', () => {
            deleteAllVacPdfs().catch(error => {
                console.error('[VAC] Suppression impossible:', error);
            });
        });
    }
    if (vacUpdateNowButton) {
        vacUpdateNowButton.addEventListener('click', async () => {
            const manifestToApply = pendingVacUpdateManifest;
            closeVacUpdatePrompt();
            if (!manifestToApply) return;

            vacInitialDownloadDeclinedForSession = false;
            const sequence = ++vacAutomaticSyncSequence;
            try {
                /*
                 * v17.12 — le choix « Oui » lance le téléchargement hors ligne
                 * en arrière-plan, avec la même priorité carte que l'auto-sync.
                 */
                await syncVacFromManifest(manifestToApply, {
                    source: 'startup-initial-prompt',
                    silent: true,
                    background: true,
                    sequence
                });
            } catch (error) {
                console.error('[VAC] Téléchargement initial impossible:', error);
            }
        });
    }
    if (vacUpdateLaterButton) {
        vacUpdateLaterButton.addEventListener('click', () => {
            vacInitialDownloadDeclinedForSession = true;
            closeVacUpdatePrompt();
        });
    }
    if (vacUpdateModal) {
        /* v17.12 — décision explicite Oui/Non : un clic sur le fond ne ferme pas la question. */
        vacUpdateModal.addEventListener('click', event => {
            if (event.target === vacUpdateModal) event.preventDefault();
        });
    }

    offlineMapModal.addEventListener('click', (e) => { if (e.target === offlineMapModal) { offlineMapModal.style.display = 'none'; } });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && offlineMapModal.style.display === 'flex') { offlineMapModal.style.display = 'none'; } });
    zipImporterInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        handleZipImport(file);
        event.target.value = '';
    });
    if (airportPdfImporterInput) {
        airportPdfImporterInput.addEventListener('change', async (event) => {
            const files = Array.from(event.target.files || []);
            await importAirportPdfFiles(files);
            event.target.value = '';
        });
    }

    if (deleteAllAirportPdfsButton) {
        deleteAllAirportPdfsButton.addEventListener('click', async () => {
            await deleteAllAirportPdfs();
        });
    }

    if (roadOverlayImporterInput) {
        roadOverlayImporterInput.addEventListener('change', async (event) => {
            const file = event.target.files?.[0] || null;
            try {
                await importRoadOverlayFile(file);
            } catch (error) {
                console.error('Import calque routier impossible:', error);
                alert(`Import du calque routier impossible : ${error.message || error}`);
            } finally {
                event.target.value = '';
                refreshRoadOverlayInstalledStatus();
                refreshRoadOverlayButtonState();
            }
        });
    }

    if (deleteRoadOverlayButton) {
        deleteRoadOverlayButton.addEventListener('click', async () => {
            if (!confirm('Supprimer le calque routier offline A / N / D / M / T de cet appareil ?')) {
                return;
            }
            await deleteRoadOverlayData();
            refreshRoadOverlayInstalledStatus();
            refreshRoadOverlayButtonState();
        });
    }
    if (folderImporterInput) {
        folderImporterInput.addEventListener('change', (event) => {
            const files = Array.from(event.target.files || []);
            handleFolderImport(files);
            event.target.value = '';
        });
    }
    if (tilesImporterInput) {
        tilesImporterInput.addEventListener('change', (event) => {
            const files = Array.from(event.target.files || []);
            handleFolderImport(files, { fromDirectoryPicker: false });
            event.target.value = '';
        });
    }

    if (mapSourceOnlineBtn) {
        mapSourceOnlineBtn.addEventListener('click', async () => {
            try {
                await setMapSourceMode('online');
            } catch (error) {
                console.error('Erreur activation mode online:', error);
                alert(`Impossible d'activer le mode online: ${error.message || error}`);
            }
        });
    }

    if (mapSourceOfflineBtn) {
        mapSourceOfflineBtn.addEventListener('click', async () => {
            if (!activeOfflinePacks.length) {
                alert('Aucun pack offline actif. Activez (ou importez) un pack avant de passer en mode offline.');
                return;
            }
            try {
                await setMapSourceMode('offline');
            } catch (error) {
                console.error('Erreur activation mode offline:', error);
                alert(`Impossible d'activer le mode offline: ${error.message || error}`);
            }
        });
    }



    if (simulationModeButton) {
        refreshSimulationModeButtonState();
        simulationModeButton.addEventListener('click', () => {
            toggleSimulationMode();
        });
    }

    if (simulationMotionButton) {
        simulationMotionButton.addEventListener('click', () => {
            openSimulationMotionModal();
        });
    }

    if (closeSimulationMotionModalButton) {
        closeSimulationMotionModalButton.addEventListener('click', closeSimulationMotionModal);
    }

    if (applySimulationMotionButton) {
        applySimulationMotionButton.addEventListener('click', () => {
            applySimulationMotionSettingsFromModal();
        });
    }

    if (quitSimulationModeButton) {
        quitSimulationModeButton.addEventListener('click', () => {
            /*
             * Même fonction et mêmes paramètres que le bouton présent dans
             * Gestion des Cartes.
             */
            disableSimulationMode({ restoreGps: true });
        });
    }

    if (simulationMotionModal) {
        simulationMotionModal.addEventListener('click', (event) => {
            if (event.target === simulationMotionModal) {
                closeSimulationMotionModal();
            }
        });
    }

    [simulationSpeedInput, simulationRouteInput, simulationAltitudeInput].filter(Boolean).forEach((input) => {
        /*
         * v14.11 — bloquer le stylet sur les champs de saisie.
         * Le passage temporaire en readOnly empêche iPadOS Scribble de prendre
         * la main ; le champ redevient immédiatement disponible pour le doigt.
         */
        input.addEventListener('pointerdown', (event) => {
            if (!isSimulationPenPointer(event)) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            input.readOnly = true;
            input.blur();
            input.classList.add('simulation-stylus-blocked');

            window.setTimeout(() => {
                input.readOnly = false;
                input.classList.remove('simulation-stylus-blocked');
            }, 350);
        }, true);

        input.addEventListener('pointerup', (event) => {
            if (!isSimulationPenPointer(event)) return;
            event.preventDefault();
            event.stopPropagation();
        }, true);

        input.addEventListener('click', (event) => {
            if (isSimulationPenPointer(event)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            focusAndSelectSimulationInput(input);
        });

        input.addEventListener('focus', () => {
            if (!input.readOnly) {
                selectWholeSimulationInputValue(input);
            }
        });

        input.addEventListener('touchend', () => {
            if (!input.readOnly) {
                focusAndSelectSimulationInput(input);
            }
        }, { passive: true });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applySimulationMotionSettingsFromModal();
            }
        });
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && simulationMotionModal?.style.display === 'flex') {
            closeSimulationMotionModal();
        }
    });

    setupBaseOaciInputs();
    updateBaseLabels();
    updateLftwButtonState();
    updateGaarButtonState();
}

function displayResults(results) {
    const resultsList = document.getElementById('results-list');
    const searchValue = document.getElementById('search-input')?.value || '';
    const airportResults = searchAirportsByOaci(searchValue);
    resultsList.innerHTML = '';

    if (airportResults.length > 0 || results.length > 0) {
        resultsList.style.display = 'block';

        airportResults.forEach((airport) => {
            const li = document.createElement('li');
            li.className = 'search-result-airport';
            li.innerHTML = `<span class="search-result-airport-oaci">${escapeHtml(airport.oaci)}</span><span class="search-result-airport-name">${escapeHtml(airport.name)}</span>`;
            li.title = `Tracer la route GPS vers ${airport.oaci} — sans modifier le feu ni le pélicandrome`;
            li.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                selectAirportDestination(airport);
            });
            resultsList.appendChild(li);
        });

        results.forEach(c => {
            const li = document.createElement('li');

            if (c.locality_match) {
                const municipality =
                    c.locality_commune_name
                        ? ` — ${c.locality_commune_name}`
                        : '';
                const department =
                    c.dep_code
                        ? ` (${c.dep_code})`
                        : '';

                li.textContent =
                    `${c.nom_standard}${municipality}${department}`;
                li.classList.add(
                    'search-result-locality'
                );
                li.title = [
                    c.locality_type
                        || 'Lieu nommé',
                    c.dep_nom || '',
                    c.locality_source || ''
                ].filter(Boolean).join(' · ');
            } else {
                li.textContent =
                    `${c.nom_standard} (${c.dep_nom} - ${c.dep_code})`;
            }

            if (c.alias_match && c.alias_commune_actuelle) {
                li.title = `Rattachée à ${c.alias_commune_actuelle}`;
            }
            li.addEventListener('click', () => {
                clearAirportDestination({ restoreFire: false, redraw: false });
                currentCommune = c;
                localStorage.setItem('currentCommune', JSON.stringify(c));
                displayCommuneDetails(c);
                armNpfFirePelicAutoCycle('fire');
            });
            resultsList.appendChild(li);
        });
    } else {
        if (!document.getElementById('search-input')?.value.trim()) {
            displayFireHistory();
        } else {
            resultsList.style.display = 'none';
        }
    }
}


async function findOfflineTileZoomRange() {
    try {
        await initDB();
    } catch (_) {
        return null;
    }

    if (!isMainOfflineDatabaseUsable(db)) {
        return null;
    }

    const targetPacks = new Set(activeOfflinePacks);
    return new Promise((resolve) => {
        let settled = false;
        const finalize = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(safetyTimer);
            resolve(value);
        };

        const safetyTimer = setTimeout(() => {
            console.warn('Scan zoom offline interrompu (timeout sécurité).');
            finalize(null);
        }, 8000);

        let tx;
        let store;
        let request;

        try {
            tx = db.transaction(
                'tiles',
                'readonly'
            );
            store = tx.objectStore('tiles');
            request = store.openCursor();
        } catch (error) {
            if (
                isOfflineDatabaseClosingError(error)
            ) {
                invalidateMainOfflineDatabase(db);
            }
            finalize(null);
            return;
        }
        let minZoom = null;
        let maxZoom = null;

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                finalize(minZoom === null || maxZoom === null ? null : { minZoom, maxZoom });
                return;
            }
            if (targetPacks.size && !targetPacks.has(cursor.value?.packName || '')) {
                cursor.continue();
                return;
            }
            const storedUrl = cursor.value?.url;
            const url = getTileUrlFromStoredKey(storedUrl);
            if (typeof url === 'string') {
                const match = url.match(/\/(\d+)\/\d+\/\d+\.(png|jpg|jpeg)(?:\?.*)?$/i);
                if (match) {
                    const zoom = Number.parseInt(match[1], 10);
                    if (Number.isFinite(zoom)) {
                        minZoom = minZoom === null ? zoom : Math.min(minZoom, zoom);
                        maxZoom = maxZoom === null ? zoom : Math.max(maxZoom, zoom);
                    }
                }
            }
            cursor.continue();
        };

        request.onerror = () => finalize(null);
        tx.onerror = () => finalize(null);
        tx.onabort = () => finalize(null);
        tx.oncomplete = () => finalize(minZoom === null || maxZoom === null ? null : { minZoom, maxZoom });
    });
}

async function updateBaseTileNativeZoomFromAvailability({
    forceScan = false,
    rebuildLayer = true
} = {}) {
    const previousMinNativeZoom = baseTileMinNativeZoom;
    const previousMaxNativeZoom = baseTileMaxNativeZoom;
    const offlineEnabled = await getOfflineTilesEnabled();
    const shouldForceScan = forceScan;
    const activeOfflineMaxZoomLimit = getOfflinePackMaxNativeZoomLimitForPacks(activeOfflinePacks);
    if (!offlineEnabled) {
        baseTileMinNativeZoom = GLOBAL_MIN_ZOOM;
        baseTileMaxNativeZoom = ONLINE_MAX_NATIVE_ZOOM;
    } else {
        const storedOfflineMinZoom = Number.parseInt(localStorage.getItem(OFFLINE_TILES_MIN_ZOOM_KEY) || '', 10);
        const storedOfflineMaxZoom = Number.parseInt(localStorage.getItem(OFFLINE_TILES_MAX_ZOOM_KEY) || '', 10);
        let offlineMinZoom = Number.isFinite(storedOfflineMinZoom) ? storedOfflineMinZoom : null;
        let offlineMaxZoom = Number.isFinite(storedOfflineMaxZoom) ? storedOfflineMaxZoom : null;

        if (shouldForceScan && !OFFLINE_DISABLE_STARTUP_FORCE_SCAN) {
            const zoomRange = await findOfflineTileZoomRange();
            if (!zoomRange) {
                offlineMinZoom = null;
                offlineMaxZoom = null;
                localStorage.removeItem(OFFLINE_TILES_MIN_ZOOM_KEY);
                localStorage.removeItem(OFFLINE_TILES_MAX_ZOOM_KEY);
            } else {
                offlineMinZoom = zoomRange.minZoom;
                offlineMaxZoom = zoomRange.maxZoom;
                localStorage.setItem(OFFLINE_TILES_MIN_ZOOM_KEY, String(offlineMinZoom));
                localStorage.setItem(OFFLINE_TILES_MAX_ZOOM_KEY, String(offlineMaxZoom));
            }
        }

        if (offlineMinZoom === null || offlineMaxZoom === null) {
            baseTileMinNativeZoom = GLOBAL_MIN_ZOOM;
            baseTileMaxNativeZoom = activeOfflineMaxZoomLimit;
        } else {
            baseTileMinNativeZoom = Math.max(GLOBAL_MIN_ZOOM, Math.min(GLOBAL_MAX_ZOOM, offlineMinZoom));
            baseTileMaxNativeZoom = Math.max(0, Math.min(activeOfflineMaxZoomLimit, offlineMaxZoom));
        }
    }

    const zoomRangeChanged = (
        previousMinNativeZoom !== baseTileMinNativeZoom
        || previousMaxNativeZoom !== baseTileMaxNativeZoom
    );

    if (rebuildLayer && zoomRangeChanged && map && baseTileLayer) {
        setupBaseTileLayer();
    }
    return zoomRangeChanged;
}


function showPostUpdateRestartNoticeIfNeeded() {
    try {
        if (typeof window.showNpfPostUpdateNoticeOnce === 'function') {
            window.showNpfPostUpdateNoticeOnce();
        }
    } catch (_) {}
}

function showPostUpdateRestartNoticeModal() {
    showPostUpdateRestartNoticeIfNeeded();
}

function showUpdateReminderIfDue() {
    try {
        if (document.getElementById('post-update-restart-modal')) return;
        const lastShown = Number(localStorage.getItem(UPDATE_REMINDER_STORAGE_KEY) || '0');
        const now = Date.now();
        if (lastShown && (now - lastShown) < UPDATE_REMINDER_INTERVAL_MS) return;
        showUpdateReminderModal(now);
    } catch (_) {}
}

function showUpdateReminderModal(timestamp = Date.now()) {
    if (document.getElementById('update-reminder-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'update-reminder-modal';
    modal.className = 'update-reminder-modal';
    modal.innerHTML = `
        <div class="update-reminder-modal-content" role="dialog" aria-modal="true" aria-labelledby="update-reminder-title">
            <h3 id="update-reminder-title">Mise à jour</h3>
            <p>Pensez à cliquer sur <span class="update-reminder-maj-button" aria-label="bouton MAJ"><span class="update-reminder-maj-symbol">🔄</span><span>MAJ</span></span> de temps en temps pour être certain d’avoir la dernière version à jour.<br><strong>Relancer l’application après mise à jour.</strong></p>
            <div class="update-reminder-actions">
                <button id="update-reminder-now-button" class="update-reminder-primary" type="button">Vérifier maintenant</button>
                <button id="update-reminder-later-button" class="update-reminder-secondary" type="button">Plus tard</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const rememberAndClose = () => {
        try {
            localStorage.setItem(UPDATE_REMINDER_STORAGE_KEY, String(timestamp));
        } catch (_) {}
        modal.remove();
    };

    const laterButton = document.getElementById('update-reminder-later-button');
    if (laterButton) {
        laterButton.addEventListener('click', rememberAndClose);
    }

    const nowButton = document.getElementById('update-reminder-now-button');
    if (nowButton) {
        nowButton.addEventListener('click', () => {
            rememberAndClose();
            if (typeof window.forceRecoveryReload === 'function') {
                window.forceRecoveryReload();
                return;
            }
            const forceUpdateButton = document.getElementById('force-update-button');
            if (forceUpdateButton) forceUpdateButton.click();
        });
    }

    modal.addEventListener('click', (event) => {
        if (event.target === modal) rememberAndClose();
    });
}

function updateCommuneDisplay(commune) {
    const communeDisplay = document.getElementById('commune-info-display');
    if (!communeDisplay) return;

    /* v16.10 — le bandeau Route est indépendant du bandeau Feu/BINGO. */
    communeDisplay.classList.remove('wp-route-navigation-active');

    communeDisplay.classList.toggle(
        'airport-destination-active',
        !!selectedAirportDestination
    );
    communeDisplay.classList.toggle(
        'airport-destination-no-fire',
        !!selectedAirportDestination && !currentCommune
    );

    if (selectedAirportDestination) {
        const airport = selectedAirportDestination;
        const airportName = escapeHtml(airport.name || airport.oaci);
        const airportOaci = escapeHtml(airport.oaci);
        communeDisplay.innerHTML = `
            <span class="commune-name airport-destination-name" title="${airportName}">${airportOaci}</span>
            <div id="gps-feu-route-info" class="gps-feu-route-info" title="Route, distance et temps GPS vers ${airportOaci}">---° / -- Nm / -- min</div>
            <button type="button" id="clear-airport-destination-btn" class="clear-commune-btn clear-airport-destination-btn" title="Quitter la route vers ${airportOaci}" aria-label="Quitter la route vers ${airportOaci}">×</button>
        `;
        updateCommuneGpsRouteDisplay();

        const clearAirportButton = document.getElementById('clear-airport-destination-btn');
        if (clearAirportButton) {
            let airportClearHandled = false;
            const stopAirportClearPropagation = (event) => {
                event.stopPropagation();
            };
            const performAirportDestinationClear = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (airportClearHandled) return;
                airportClearHandled = true;
                clearAirportDestination({ restoreFire: true, redraw: true });
                setTimeout(() => {
                    airportClearHandled = false;
                }, 350);
            };

            ['touchstart', 'pointerdown', 'mousedown'].forEach((eventName) => {
                clearAirportButton.addEventListener(
                    eventName,
                    stopAirportClearPropagation,
                    { passive: true }
                );
            });
            clearAirportButton.addEventListener(
                'touchend',
                performAirportDestinationClear,
                { passive: false }
            );
            clearAirportButton.addEventListener(
                'pointerup',
                performAirportDestinationClear,
                { passive: false }
            );
            clearAirportButton.addEventListener(
                'click',
                performAirportDestinationClear
            );
        }
        syncNpfWaypointNavigationBanner();
        return;
    }

    if (!commune) {
        communeDisplay.innerHTML = '';
        communeDisplay.style.display = 'none';
        syncNpfWaypointNavigationBanner();
        return;
    }

    const dbCommune = getCommuneFromDatabaseByNameAndDepartment(commune);
    const fallbackClosest = (!commune.dep_code && commune.latitude_mairie != null && commune.longitude_mairie != null)
        ? findClosestCommune(commune.latitude_mairie, commune.longitude_mairie, 27)
        : null;
    const displayCommune = dbCommune || fallbackClosest || commune;
    const depLabel = formatCommuneDepartment(displayCommune);
    const depCode = depLabel ? ` (${depLabel})` : '';
    const communeNameHTML = `<span class="commune-name">${displayCommune.nom_standard || commune.nom_standard}${depCode}</span>`;
    const closeButtonHTML = `<span id="clear-commune-btn" class="clear-commune-btn" title="Effacer le feu">×</span>`;
    const routeInfoHTML = `<div id="gps-feu-route-info" class="gps-feu-route-info" title="Route, distance et temps GPS vers le feu">---° / -- Nm / -- min</div><div id="gps-feu-rotation-info" class="gps-feu-rotation-info" title="Durée de rotation issue de l’onglet Suivi largages">Rot. -- min</div>`;
    let sunsetHTML = '';
    if (typeof SunCalc !== 'undefined') {
        try {
            const now = new Date();
            const times = SunCalc.getTimes(now, commune.latitude_mairie, commune.longitude_mairie);
            const sunsetString = times.sunset.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
            sunsetHTML = `<div class="sunset-info">🌅&nbsp;CS&nbsp;<b>${sunsetString}</b></div>${routeInfoHTML}`;
        } catch (e) {
            sunsetHTML = `<div class="sunset-info"></div>${routeInfoHTML}`;
        }
    } else {
        sunsetHTML = routeInfoHTML;
    }
    communeDisplay.innerHTML = communeNameHTML + sunsetHTML + closeButtonHTML;
    updateCommuneGpsRouteDisplay();

 // On attache l'événement de clic au nouveau bouton
    const clearCommuneBtn = document.getElementById('clear-commune-btn');
    if (clearCommuneBtn) {
        const preserveSearchFocusBeforeClear = (event) => {
            /*
             * v11.95 — iPad : pointerdown seul ne suffit pas toujours.
             * On intercepte touchstart + mousedown + pointerdown avant que Safari
             * ne retire le focus du champ et ferme le clavier.
             */
            const searchInput = document.getElementById('search-input');
            if (document.activeElement === searchInput) {
                clearCommuneBtn.dataset.keepSearchKeyboard = '1';
                event.preventDefault();
                event.stopPropagation();
            }
        };

        ['touchstart', 'pointerdown', 'mousedown'].forEach((eventName) => {
            clearCommuneBtn.addEventListener(eventName, preserveSearchFocusBeforeClear, { passive: false });
        });

        clearCommuneBtn.addEventListener('click', (event) => {
            const searchInput = document.getElementById('search-input');
            const shouldKeepKeyboard = clearCommuneBtn.dataset.keepSearchKeyboard === '1' || document.activeElement === searchInput;

            event.preventDefault();
            event.stopPropagation();

            clearCurrentSelection();
            clearCommuneBtn.dataset.keepSearchKeyboard = '0';

            if (shouldKeepKeyboard && searchInput) {
                setTimeout(() => {
                    try {
                        searchInput.focus({ preventScroll: true });
                        const end = searchInput.value.length;
                        searchInput.setSelectionRange(end, end);
                    } catch (_) {
                        searchInput.focus();
                    }
                }, 0);
            }
        });
    }
    syncNpfWaypointNavigationBanner();
}


function getCurrentGpsGroundSpeedKt() {
    const speedMps = Number(lastPosition?.speedMps);
    if (!Number.isFinite(speedMps) || speedMps <= 0) return null;
    return speedMps * 1.9438444924406;
}

function formatGpsEtaMinutes(distanceNm) {
    const speedKt = getCurrentGpsGroundSpeedKt();
    if (!Number.isFinite(distanceNm) || distanceNm <= 0 || !Number.isFinite(speedKt) || speedKt < 30) {
        return '-- min';
    }
    const minutes = Math.max(1, Math.round((distanceNm * 60) / speedKt));
    return `${minutes} min`;
}

function getSuiviRotationDurationMinutesForMap() {
    const suiviInput = document.querySelector('#suivi-duree-rotation-wrapper .display-input');
    const suiviMinutes = parseTime(suiviInput?.value || '');
    if (Number.isFinite(suiviMinutes) && suiviMinutes > 0) return suiviMinutes;

    const previText = document.getElementById('duree-rotation')?.textContent || '';
    const previMinutes = parseTime(previText);
    if (Number.isFinite(previMinutes) && previMinutes > 0) return previMinutes;

    if (Number.isFinite(CALCULATOR_DATA?.distPelicFeu) && CALCULATOR_DATA.distPelicFeu > 0) {
        const computed = Math.round(calculateRotationTime(CALCULATOR_DATA.distPelicFeu));
        if (Number.isFinite(computed) && computed > 20) return computed;
    }

    return null;
}

function updateCommuneMapRotationInfo() {
    const rotationInfo = document.getElementById('gps-feu-rotation-info');
    if (!rotationInfo) return;

    const minutes = getSuiviRotationDurationMinutesForMap();
    rotationInfo.textContent = Number.isFinite(minutes) && minutes > 0
        ? `Rot. ${Math.round(minutes)} min`
        : 'Rot. -- min';
    rotationInfo.classList.toggle('gps-feu-route-info-empty', !(Number.isFinite(minutes) && minutes > 0));
}

function updateCommuneGpsRouteDisplay() {
    if (window.__npfWaypointRouteReady === true && typeof isNpfWaypointGotoActive === 'function' && isNpfWaypointGotoActive()) {
        updateNpfWaypointNavigationBannerMetrics();
    }

    const routeInfo = document.getElementById('gps-feu-route-info');
    const rotationInfo = document.getElementById('gps-feu-rotation-info');
    if (!routeInfo && !rotationInfo) return;

    const automaticFirePelicTarget = !selectedAirportDestination
        ? getNpfFirePelicAutoCycleTarget()
        : null;

    const target = selectedAirportDestination
        ? {
            lat: Number(selectedAirportDestination.lat),
            lon: Number(selectedAirportDestination.lon),
            airport: true
        }
        : (automaticFirePelicTarget
            ? {
                lat: Number(automaticFirePelicTarget.lat),
                lon: Number(automaticFirePelicTarget.lon),
                airport: automaticFirePelicTarget.kind === 'pelic'
            }
            : (currentCommune
                ? {
                    lat: Number(currentCommune.latitude_mairie),
                    lon: Number(currentCommune.longitude_mairie),
                    airport: false
                }
                : null));

    if (!target || !userMarker || !userMarker.getLatLng) {
        if (routeInfo) {
            routeInfo.textContent = '---° / -- Nm / -- min';
            routeInfo.classList.add('gps-feu-route-info-empty');
        }
        if (!selectedAirportDestination) updateCommuneMapRotationInfo();
        return;
    }

    const userLatLng = userMarker.getLatLng();

    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon) || !userLatLng) {
        if (routeInfo) {
            routeInfo.textContent = '---° / -- Nm / -- min';
            routeInfo.classList.add('gps-feu-route-info-empty');
        }
        if (!selectedAirportDestination) updateCommuneMapRotationInfo();
        return;
    }

    const distance = calculateDistanceInNm(userLatLng.lat, userLatLng.lng, target.lat, target.lon);
    const trueBearingToTarget = calculateBearing(userLatLng.lat, userLatLng.lng, target.lat, target.lon);
    const magneticBearing = (trueBearingToTarget - MAGNETIC_DECLINATION + 360) % 360;

    if (routeInfo) {
        routeInfo.textContent = `${formatRouteDegrees(magneticBearing)} / ${Math.round(distance)} Nm / ${formatGpsEtaMinutes(distance)}`;
        routeInfo.classList.remove('gps-feu-route-info-empty');
    }
    if (!selectedAirportDestination) updateCommuneMapRotationInfo();
}


function getClosestWaterPoints(lat, lon, count = 3) {
    return waterPoints
        .map(point => ({
            ...point,
            distance: calculateDistanceInNm(lat, lon, point.lat, point.lon)
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, count);
}

function buildWaterPointIcon(isClosest = false) {
    /*
     * v12.08 — plans d'eau :
     * - tous les plans d'eau = petit point bleu ;
     * - les 3 plus proches = même point bleu, très légèrement agrandi.
     * La zone tactile reste plus large que le point visuel.
     */
    const size = isClosest ? 18 : 16;
    const dotSize = isClosest ? 8 : 6;
    return L.divIcon({
        className: isClosest ? 'water-point-dot-marker water-point-dot-marker-closest' : 'water-point-dot-marker',
        html: `<span style="width:${dotSize}px;height:${dotSize}px;"></span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
}

function drawWaterPointMarkersForCommune(commune) {
    if (!waterPointsLayer) return;
    waterPointsLayer.clearLayers();

    if (!showWaterPointsLayer) {
        return;
    }

    /*
     * v12.03 — Plan d'eau :
     * - bouton actif = toutes les gouttes affichées partout en France ;
     * - si un feu est sélectionné = les 3 plus proches reçoivent une étiquette nom + distance ;
     * - aucun impact sur les calculs.
     */
    let closestWaterPointIds = new Set();
    let closestWaterPointDistances = new Map();

    if (commune) {
        const lat = Number(commune.latitude_mairie);
        const lon = Number(commune.longitude_mairie);

        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            getClosestWaterPoints(lat, lon, 3).forEach(point => {
                closestWaterPointIds.add(point.id);
                closestWaterPointDistances.set(point.id, point.distance);
            });
        }
    }

    waterPoints.forEach(point => {
        const isClosest = closestWaterPointIds.has(point.id);
        const marker = L.marker([point.lat, point.lon], {
            icon: buildWaterPointIcon(isClosest),
            interactive: true,
            zIndexOffset: isClosest ? 540 : 420
        });

        if (isClosest) {
            const distance = closestWaterPointDistances.get(point.id);
            const label = `<div class="water-point-label-name">${escapeHtml(point.name)}</div><div class="water-point-label-distance">${Math.round(distance)} Nm</div>`;

            marker.bindTooltip(label, {
                permanent: true,
                direction: 'right',
                offset: [10, 0],
                className: 'water-point-tooltip'
            });
        }
        marker.bindPopup(`<div class="water-point-popup"><b>${escapeHtml(point.name)}</b></div>`);
        marker.addTo(waterPointsLayer);
    });
}

function refreshWaterPointsButtonState() {
    const button = document.getElementById('water-points-button');
    if (button) {
        button.classList.toggle('active', showWaterPointsLayer);
    }
}

function toggleWaterPointsLayer(forceState = null) {
    showWaterPointsLayer = forceState === null ? !showWaterPointsLayer : Boolean(forceState);
    localStorage.setItem(WATER_POINTS_LAYER_KEY, showWaterPointsLayer ? 'true' : 'false');
    refreshWaterPointsButtonState();

    drawWaterPointMarkersForCommune(currentCommune);
}


function getHighVoltageLineStyle(feature) {
    const props = feature?.properties || {};
    const tension = String(props.tension || '').toLowerCase();

    let weight = 1.5;
    let opacity = 0.72;
    let dashArray = '5 4';

    if (tension.includes('400')) {
        weight = 3.0;
        opacity = 0.86;
        dashArray = null;
    } else if (tension.includes('225')) {
        weight = 2.4;
        opacity = 0.82;
        dashArray = null;
    } else if (tension.includes('90')) {
        weight = 1.9;
        opacity = 0.78;
        dashArray = '7 4';
    } else if (tension.includes('63')) {
        weight = 1.6;
        opacity = 0.70;
        dashArray = '4 4';
    }

    return {
        color: '#d8232a',
        weight,
        opacity,
        dashArray,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
        pane: 'highVoltageLinesPane'
    };
}

function isHighVoltageLayerEffectiveAtCurrentScale() {
    if (!map) return false;
    const scaleNm = getCurrentNpfScaleNm();
    if (!Number.isFinite(scaleNm)) return true;
    return scaleNm < HIGH_VOLTAGE_LINES_HIDE_SCALE_NM - 0.000001;
}

function suppressHighVoltageLinesForWideScale(source = 'scale-50nm') {
    if (!map || !highVoltageLinesLayer || isHighVoltageLayerEffectiveAtCurrentScale()) return false;

    const hadVisual = !!(
        map.hasLayer(highVoltageLinesLayer)
        || highVoltageLinesRenderedGeoJsonLayer
        || highVoltageLinesRenderedFeatureCount > 0
    );
    highVoltageLinesScaleSuppressed = true;
    highVoltageLinesRefreshToken += 1;
    clearTimeout(highVoltageLinesRefreshTimer);
    highVoltageLinesRefreshTimer = null;
    clearRenderedHighVoltageLines();
    try {
        if (map.hasLayer(highVoltageLinesLayer)) map.removeLayer(highVoltageLinesLayer);
    } catch (_) {}
    refreshHighVoltageLinesButtonState();
    if (hadVisual) {
        recordNpfStartupDiagnosticOverlaySnapshot(`lignes-ht masquées 50 NM · ${source}`);
    }
    return true;
}

function refreshHighVoltageLinesButtonState() {
    const button = document.getElementById('high-voltage-lines-button');
    if (!button) return;

    const scaleSuppressed = showHighVoltageLinesLayer
        && !isHighVoltageLayerEffectiveAtCurrentScale();
    button.classList.toggle('active', showHighVoltageLinesLayer);
    button.classList.toggle('loading', isHighVoltageLinesLoading);
    button.disabled = isHighVoltageLinesLoading;
    button.title = isHighVoltageLinesLoading
        ? 'Chargement des lignes haute tension RTE…'
        : scaleSuppressed
            ? 'Lignes HT activées — masquées à l’échelle 50 NM ou plus'
            : 'Afficher/Masquer les lignes haute tension RTE';
}

async function fetchHighVoltageLinesGeojson() {
    const url = `${HIGH_VOLTAGE_LINES_GEOJSON_URL}?appv=${encodeURIComponent(window.APP_VERSION || 'v12.59')}`;
    let response = null;

    try {
        if ('caches' in window) {
            const cached = await caches.match(HIGH_VOLTAGE_LINES_GEOJSON_URL, { ignoreSearch: true });
            if (cached && cached.ok) response = cached;
        }
    } catch (_) {}

    if (!response) {
        response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        try {
            if ('caches' in window) {
                const cache = await caches.open(`npf-q400-lignes-ht-${window.APP_VERSION || 'v12.59'}`);
                await cache.put(HIGH_VOLTAGE_LINES_GEOJSON_URL, response.clone());
            }
        } catch (cacheError) {
            console.warn('Cache lignes HT impossible:', cacheError);
        }
    }

    return await response.json();
}

function getHighVoltageFeatureBbox(feature) {
    const geometry = feature?.geometry;
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates)) return null;

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    const visit = (node) => {
        if (!Array.isArray(node) || !node.length) return;
        if (typeof node[0] === 'number' && typeof node[1] === 'number') {
            const lon = Number(node[0]);
            const lat = Number(node[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            return;
        }
        node.forEach(visit);
    };

    visit(coordinates);

    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
    return [minLon, minLat, maxLon, maxLat];
}

function getHighVoltageAggregationBand(feature) {
    const tension = String(feature?.properties?.tension || '').toLowerCase();
    if (tension.includes('400')) return '400';
    if (tension.includes('225')) return '225';
    if (tension.includes('90')) return '90';
    if (tension.includes('63')) return '63';
    return 'autres';
}


/* v16.58 — généralisation cartographique aux zooms éloignés. Afficher des
 * milliers de tronçons 63 kV à l'échelle France n'apporte pas d'information
 * exploitable et crée un pic Canvas/mémoire sur iPad. Les détails réapparaissent
 * automatiquement en revenant à une échelle rapprochée. */
function shouldRenderHighVoltageFeatureAtZoom(feature, zoom) {
    const band = getHighVoltageAggregationBand(feature);
    const z = Number(zoom);
    if (Number.isFinite(z) && z <= 8) return band === '400' || band === '225';
    if (Number.isFinite(z) && z <= 9) return band === '400' || band === '225' || band === '90';
    if (Number.isFinite(z) && z <= 10) return band !== 'autres';
    return true;
}

function getHighVoltageViewportPadForZoom(zoom) {
    const z = Number(zoom);
    if (Number.isFinite(z) && z <= 8) return 0.02;
    if (Number.isFinite(z) && z <= 10) return 0.06;
    if (Number.isFinite(z) && z <= 11) return 0.12;
    return HIGH_VOLTAGE_LINES_VIEWPORT_PAD;
}

function appendHighVoltageGeometryLines(geometry, target) {
    if (!geometry || !target) return;
    const type = String(geometry.type || '');
    const coordinates = geometry.coordinates;

    if (type === 'LineString' && Array.isArray(coordinates) && coordinates.length >= 2) {
        target.push(coordinates);
        return;
    }
    if (type === 'MultiLineString' && Array.isArray(coordinates)) {
        coordinates.forEach(line => {
            if (Array.isArray(line) && line.length >= 2) target.push(line);
        });
        return;
    }
    if (type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
        geometry.geometries.forEach(child => appendHighVoltageGeometryLines(child, target));
    }
}

function buildHighVoltageAggregatedRenderGeojson(features) {
    const groups = new Map();

    for (const feature of features || []) {
        const band = getHighVoltageAggregationBand(feature);
        if (!groups.has(band)) groups.set(band, []);
        appendHighVoltageGeometryLines(feature?.geometry, groups.get(band));
    }

    const order = ['400', '225', '90', '63', 'autres'];
    return {
        type: 'FeatureCollection',
        features: order
            .filter(band => groups.get(band)?.length)
            .map(band => ({
                type: 'Feature',
                properties: { tension: band, __npfHtGroup: band },
                geometry: {
                    type: 'MultiLineString',
                    coordinates: groups.get(band)
                }
            }))
    };
}

function clearRenderedHighVoltageLines() {
    try {
        if (highVoltageLinesRenderedGeoJsonLayer && highVoltageLinesLayer) {
            highVoltageLinesLayer.removeLayer(highVoltageLinesRenderedGeoJsonLayer);
        }
    } catch (_) {}
    try { highVoltageLinesLayer?.clearLayers?.(); } catch (_) {}
    try { highVoltageLinesRenderer?._redraw?.(); } catch (_) {}
    highVoltageLinesRenderedGeoJsonLayer = null;
    highVoltageLinesRenderedFeatureCount = 0;
    highVoltageLinesRenderedBounds = null;
}

function isHighVoltageCoverageValidForCurrentView() {
    if (!map || !highVoltageLinesRenderedBounds || !highVoltageLinesRenderedGeoJsonLayer) return false;
    try {
        return roadOverlayBoundsContainBounds(highVoltageLinesRenderedBounds, map.getBounds());
    } catch (_) {
        return false;
    }
}

async function refreshVisibleHighVoltageLines(source = 'refresh') {
    if (!map || !highVoltageLinesLayer || !showHighVoltageLinesLayer || !hasLoadedHighVoltageLines) return;
    if (!isHighVoltageLayerEffectiveAtCurrentScale()) {
        suppressHighVoltageLinesForWideScale(source);
        return;
    }
    highVoltageLinesScaleSuppressed = false;

    const token = ++highVoltageLinesRefreshToken;

    /*
     * v17.08 — priorité absolue au fond NPF.
     * Aucun scan, filtrage ni rendu HT ne commence tant que les tuiles ne sont
     * pas totalement peintes et le scheduler IndexedDB au repos, puis calme
     * pendant 320 ms. Cela vaut aussi pour les chemins sérialisés et pour la
     * restitution Tuiles -> VFR -> HT -> Routes.
     */
    const tilesReady = await waitForNpfHeavyOverlayTileWindow('HT', {
        maxWaitMs: 30000,
        isCancelled: () => (
            token !== highVoltageLinesRefreshToken
            || !showHighVoltageLinesLayer
        )
    });
    if (!tilesReady) {
        if (token === highVoltageLinesRefreshToken && showHighVoltageLinesLayer) {
            scheduleHighVoltageLinesRefresh('tile-priority-retry');
        }
        return;
    }

    const zoom = Number(map.getZoom?.());
    const bounds = map.getBounds().pad(getHighVoltageViewportPadForZoom(zoom));
    const visibleFeatures = [];

    for (const feature of highVoltageLinesIndexedFeatures) {
        if (!shouldRenderHighVoltageFeatureAtZoom(feature, zoom)) continue;
        if (feature?.__npfBbox && !roadOverlayBboxIntersectsBounds(feature.__npfBbox, bounds)) continue;
        visibleFeatures.push(feature);
    }

    if (token !== highVoltageLinesRefreshToken || !showHighVoltageLinesLayer) return;

    const previousLayer = highVoltageLinesRenderedGeoJsonLayer;

    if (!visibleFeatures.length) {
        highVoltageLinesRenderedGeoJsonLayer = null;
        highVoltageLinesRenderedFeatureCount = 0;
        highVoltageLinesRenderedBounds = L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
        try { if (previousLayer) highVoltageLinesLayer.removeLayer(previousLayer); } catch (_) {}
        if (source !== 'map-change') {
            recordNpfStartupDiagnosticOverlaySnapshot(`lignes-ht visible=0 · ${source}`);
        }
        return;
    }

    /*
     * v17.10 — swap HT atomique.
     * L'ancien rendu n'est JAMAIS supprimé avant que le nouveau soit construit
     * et que le token soit encore valide. Si un pan/zoom interrompt ce calcul,
     * la fonction quitte simplement et l'ancien HT reste disponible.
     *
     * Le bref chevauchement mémoire ancien+nouveau se produit uniquement après
     * la fenêtre de priorité tuiles ; pendant un geste le renderer HT est
     * suspendu, ce qui évite le coût graphique de ce double-buffer.
     */
    const renderGeojson = buildHighVoltageAggregatedRenderGeojson(visibleFeatures);
    if (!renderGeojson.features.length) return;

    const replacementLayer = L.geoJSON(renderGeojson, {
        style: getHighVoltageLineStyle,
        pane: 'highVoltageLinesPane',
        renderer: highVoltageLinesRenderer || undefined,
        interactive: false,
        filter: feature => !!feature?.geometry
    });

    if (token !== highVoltageLinesRefreshToken || !showHighVoltageLinesLayer) return;

    /*
     * Commit atomique : nouveau d'abord, ancien ensuite. Après ce point, une
     * interruption ne peut plus laisser la couche HT vide.
     */
    replacementLayer.addTo(highVoltageLinesLayer);
    highVoltageLinesRenderedGeoJsonLayer = replacementLayer;
    highVoltageLinesRenderedFeatureCount = visibleFeatures.length;
    highVoltageLinesRenderedBounds = L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
    try {
        if (previousLayer && previousLayer !== replacementLayer) {
            highVoltageLinesLayer.removeLayer(previousLayer);
        }
    } catch (_) {}

    if (source !== 'map-change') {
        recordNpfStartupDiagnosticOverlaySnapshot(`lignes-ht rendu ${source}`);
    }
}

async function waitForNpfFinalZoomFirstTiles(options = {}) {
    /*
     * v16.70 — pendant un zoom arrière OFFLINE NPF, ne pas remettre les gros
     * calques vectoriels au-dessus d'un fond encore vide. On attend seulement
     * un premier noyau de tuiles du zoom final, pas la totalité de la file.
     */
    if (
        !offlineTilesMode
        || !isNpfOfflinePackSelection()
        || !map
        || !baseTileLayer
    ) {
        return true;
    }

    const startedAt = NPF_STARTUP_DIAGNOSTIC.now();
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
        ? Math.max(300, Number(options.timeoutMs))
        : 2200;
    const targetVisibleMax = Number.isFinite(Number(options.targetVisibleMax))
        ? Math.max(1, Math.floor(Number(options.targetVisibleMax)))
        : 8;
    const pollMs = Number.isFinite(Number(options.pollMs))
        ? Math.max(30, Math.floor(Number(options.pollMs)))
        : 55;
    const diagnosticMode = String(options.diagnosticMode || 'heavy');
    const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => false;
    let maxQueued = 0;
    let maxActive = 0;

    while ((NPF_STARTUP_DIAGNOSTIC.now() - startedAt) < timeoutMs) {
        if (isCancelled()) return false;

        const retained = Math.max(0, getNpfRetainedBaseTileCount());
        const visible = Math.max(0, countVisibleLoadedBaseTiles());
        const queued = Math.max(0, Number(directOfflineNpfReadQueue?.length || 0));
        const active = Math.max(0, Number(directOfflineNpfActiveReads || 0));
        maxQueued = Math.max(maxQueued, queued);
        maxActive = Math.max(maxActive, active);

        const targetVisible = retained > 0
            ? Math.max(
                1,
                Math.min(
                    targetVisibleMax,
                    Math.ceil(retained * 0.25)
                )
            )
            : 1;

        if (visible >= targetVisible) {
            npfDiagSiaInteraction(
                'TUILES ZOOM FINAL',
                `état=premier-noyau-prêt · mode=${diagnosticMode} · zoom=${map.getZoom()} · visibles=${visible}/${retained}`,
                {
                    waitMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - startedAt),
                    maxQueued,
                    maxActive,
                    targetVisible,
                    concurrency: getDirectOfflineNpfMaxConcurrentReads()
                }
            );
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    npfDiagSiaInteraction(
        'TUILES ZOOM FINAL',
        `état=timeout · mode=${diagnosticMode} · zoom=${map?.getZoom?.() ?? '—'} · visibles=${countVisibleLoadedBaseTiles()}/${getNpfRetainedBaseTileCount()}`,
        {
            waitMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - startedAt),
            maxQueued,
            maxActive,
            targetVisibleMax,
            concurrency: getDirectOfflineNpfMaxConcurrentReads()
        }
    );
    return false;
}

async function runSerializedHeavyOverlayZoomOut(startZoom, finalZoom) {
    const token = ++npfHeavyOverlayZoomSerialToken;

    roadOverlayRefreshToken += 1;
    highVoltageLinesRefreshToken += 1;
    clearTimeout(roadOverlayRefreshTimer);
    clearTimeout(highVoltageLinesRefreshTimer);
    roadOverlayRefreshTimer = null;
    highVoltageLinesRefreshTimer = null;

    /* v16.60 — les panes ont normalement déjà été masqués au zoomstart. On
     * force l'état ici également pour les zooms programmatiques/limites. */
    setNpfHeavyOverlayPanesHidden(true);
    recordNpfStartupDiagnosticOverlaySnapshot(`zoom-out série · panes masqués z${startZoom}->${finalZoom}`);

    /*
     * v17.08 — même la séquence combinée Routes+HT attend désormais le repos
     * complet des tuiles avant le moindre nettoyage/recalcul lourd.
     */
    const heavyWindowReady = await waitForNpfHeavyOverlayTileWindow('Routes+HT', {
        maxWaitMs: 30000,
        isCancelled: () => token !== npfHeavyOverlayZoomSerialToken || !map
    });
    if (!heavyWindowReady || token !== npfHeavyOverlayZoomSerialToken || !map) {
        if (token === npfHeavyOverlayZoomSerialToken && map) {
            setNpfHeavyOverlayPanesHidden(false);
        }
        return;
    }

    await yieldRoadOverlayRenderTurn();
    if (token !== npfHeavyOverlayZoomSerialToken || !map) return;

    /* 1 — Routes : aucune destruction monolithique. Sous le seuil, chaque
     * partie Canvas est retirée sur une frame distincte. Si Routes restent
     * visibles, refreshRoadOverlayVisibleParts applique la même libération
     * progressive lors d'un changement de tier. */
    if (showRoadOverlayLayer) {
        const tier = getRoadOverlayZoomTier();
        if (tier === 0) {
            const cleared = await clearRoadOverlayRenderedPartsProgressively(
                { resetTier: false, clearSources: true },
                token
            );
            if (!cleared || token !== npfHeavyOverlayZoomSerialToken) return;
            roadOverlayLoadedZoomTier = 0;
        } else {
            await refreshRoadOverlayVisibleParts('zoom-out-serial-routes');
            if (token !== npfHeavyOverlayZoomSerialToken) return;
            releaseRoadOverlaySourceCacheIfHeavy('zoom-out-serial-apres-routes');
        }
    }

    await yieldRoadOverlayRenderTurn();
    if (token !== npfHeavyOverlayZoomSerialToken || !map) return;

    /* 2 — HT seulement après Routes. Son ancien rendu reste caché pendant la
     * suppression ; un frame est rendu avant la reconstruction du viewport. */
    if (
        showHighVoltageLinesLayer
        && hasLoadedHighVoltageLines
        && isHighVoltageLayerEffectiveAtCurrentScale()
    ) {
        clearRenderedHighVoltageLines();
        await yieldRoadOverlayRenderTurn();
        if (token !== npfHeavyOverlayZoomSerialToken) return;
        await refreshVisibleHighVoltageLines('zoom-out-serial-ht');
        if (token !== npfHeavyOverlayZoomSerialToken) return;
    } else if (showHighVoltageLinesLayer) {
        suppressHighVoltageLinesForWideScale('zoom-out-serial-ht');
    }

    await yieldRoadOverlayRenderTurn();
    if (token !== npfHeavyOverlayZoomSerialToken || !map) return;

    /* Réafficher seulement les panes des calques qui doivent réellement rester
     * visibles au zoom final. Le SIA ne repart qu'après résolution de Promise. */
    if (roadOverlayLayer) {
        try {
            if (showRoadOverlayLayer && getRoadOverlayZoomTier() > 0 && !map.hasLayer(roadOverlayLayer)) roadOverlayLayer.addTo(map);
            if ((!showRoadOverlayLayer || getRoadOverlayZoomTier() === 0) && map.hasLayer(roadOverlayLayer)) map.removeLayer(roadOverlayLayer);
        } catch (_) {}
    }
    try {
        if (
            showHighVoltageLinesLayer
            && hasLoadedHighVoltageLines
            && isHighVoltageLayerEffectiveAtCurrentScale()
            && highVoltageLinesLayer
            && !map.hasLayer(highVoltageLinesLayer)
        ) {
            highVoltageLinesLayer.addTo(map);
        }
    } catch (_) {}
    /*
     * v17.08 — la reconstruction Routes+HT reste sérialisée, mais elle ne
     * démarre qu'après repos complet du fond NPF. Le fond conserve donc la
     * priorité absolue ; les panes ne reviennent qu'après reconstruction.
     */
    if (token !== npfHeavyOverlayZoomSerialToken || !map) return;

    setNpfHeavyOverlayPanesHidden(false);
    recordNpfStartupDiagnosticOverlaySnapshot(`zoom-out série · terminé z${startZoom}->${finalZoom}`);
}

function cancelPendingSerializedHeavyOverlayZoomOut(reason = 'annulé') {
    if (npfHeavyOverlayZoomSettleTimer) {
        clearTimeout(npfHeavyOverlayZoomSettleTimer);
        npfHeavyOverlayZoomSettleTimer = null;
    }
    const pendingPromise = npfHeavyOverlayZoomOutPromise;
    const resolvePending = npfHeavyOverlayPendingResolve;
    npfHeavyOverlayPendingStartZoom = null;
    npfHeavyOverlayPendingFinalZoom = null;
    npfHeavyOverlayPendingResolve = null;
    npfHeavyOverlayZoomOutPromise = null;
    npfHeavyOverlayZoomSerialToken += 1;
    try { setNpfHeavyOverlayPanesHidden(false); } catch (_) {}
    if (typeof resolvePending === 'function') resolvePending();
    try {
        if (typeof siaHeavyZoomObservedPromise !== 'undefined' && siaHeavyZoomObservedPromise === pendingPromise) {
            siaHeavyZoomObservedPromise = null;
            siaHeavyZoomFinalRefreshPending = false;
        }
    } catch (_) {}
    if (reason) recordNpfStartupDiagnosticOverlaySnapshot(`zoom-out différé · ${reason}`);
}

function cancelNpfHeavyOverlayWaitsForRoadStateChange(reason = 'routes-state-change') {
    const hasSerializedPending = !!(
        npfHeavyOverlayZoomOutPromise
        || npfHeavyOverlayZoomSettleTimer
    );

    if (hasSerializedPending) {
        cancelPendingSerializedHeavyOverlayZoomOut(reason);
    } else {
        /*
         * Invalide toute transaction lourde déjà engagée.
         */
        npfHeavyOverlayZoomSerialToken += 1;
        npfHeavyOverlayZoomStartLevel = null;
        try { setNpfHeavyOverlayPanesHidden(false); } catch (_) {}
    }
}

function scheduleSerializedHeavyOverlayZoomOut(startZoom, finalZoom) {
    if (!Number.isFinite(npfHeavyOverlayPendingStartZoom)) {
        npfHeavyOverlayPendingStartZoom = Number(startZoom);
    }
    npfHeavyOverlayPendingFinalZoom = Number(finalZoom);

    if (!npfHeavyOverlayZoomOutPromise) {
        npfHeavyOverlayZoomOutPromise = new Promise(resolve => {
            npfHeavyOverlayPendingResolve = resolve;
        });
    }
    const pendingPromise = npfHeavyOverlayZoomOutPromise;

    if (npfHeavyOverlayZoomSettleTimer) clearTimeout(npfHeavyOverlayZoomSettleTimer);
    npfHeavyOverlayZoomSettleTimer = setTimeout(async () => {
        npfHeavyOverlayZoomSettleTimer = null;
        const settledStart = Number(npfHeavyOverlayPendingStartZoom);
        const settledFinal = Number(map?.getZoom?.());
        const resolvePending = npfHeavyOverlayPendingResolve;
        npfHeavyOverlayPendingStartZoom = null;
        npfHeavyOverlayPendingFinalZoom = null;
        npfHeavyOverlayPendingResolve = null;
        npfHeavyOverlayZoomStartLevel = null;

        try {
            if (
                Number.isFinite(settledStart)
                && Number.isFinite(settledFinal)
                && settledFinal < settledStart - 0.01
                && showRoadOverlayLayer
                && showHighVoltageLinesLayer
                && hasLoadedHighVoltageLines
            ) {
                await runSerializedHeavyOverlayZoomOut(settledStart, settledFinal);
            } else {
                setNpfHeavyOverlayPanesHidden(false);
            }
        } catch (error) {
            console.warn('Zoom out Routes/HT sérialisé impossible:', error);
            setNpfHeavyOverlayPanesHidden(false);
        } finally {
            if (npfHeavyOverlayZoomOutPromise === pendingPromise) {
                npfHeavyOverlayZoomOutPromise = null;
            }
            if (typeof resolvePending === 'function') resolvePending();
        }
    }, NPF_HEAVY_OVERLAY_ZOOM_SETTLE_MS);

    return pendingPromise;
}

function scheduleHighVoltageLinesRefresh(source = 'scheduled') {
    clearTimeout(highVoltageLinesRefreshTimer);
    highVoltageLinesRefreshTimer = setTimeout(() => {
        highVoltageLinesRefreshTimer = null;
        refreshVisibleHighVoltageLines(source).catch(error => {
            console.warn('Actualisation des lignes HT impossible:', source, error);
        });
    }, source === 'map-change' ? HIGH_VOLTAGE_LINES_MAP_CHANGE_DELAY_MS : 80);
}

async function loadHighVoltageLinesLayerData() {
    if (!map || !highVoltageLinesLayer) return;
    if (hasLoadedHighVoltageLines) return;

    isHighVoltageLinesLoading = true;
    refreshHighVoltageLinesButtonState();

    try {
        const geojson = await fetchHighVoltageLinesGeojson();
        const sourceFeatures = Array.isArray(geojson?.features) ? geojson.features : [];
        highVoltageLinesFeatureCount = sourceFeatures.length;
        highVoltageLinesData = {
            type: 'FeatureCollection',
            features: sourceFeatures
        };
        highVoltageLinesIndexedFeatures = sourceFeatures
            .filter(feature => !!feature?.geometry)
            .map(feature => {
                feature.__npfBbox = getHighVoltageFeatureBbox(feature);
                return feature;
            });
        hasLoadedHighVoltageLines = true;
        console.log(`Lignes HT chargées: ${highVoltageLinesFeatureCount} tronçons`);
    } finally {
        isHighVoltageLinesLoading = false;
        refreshHighVoltageLinesButtonState();
    }
}

function scheduleHighVoltageLinesRetry(source = 'retry') {
    const token = ++highVoltageLinesRetryToken;
    const delays = [2500, 7000, 15000, 30000];
    delays.forEach((delay) => {
        setTimeout(() => {
            if (token !== highVoltageLinesRetryToken) return;
            if (!showHighVoltageLinesLayer || hasLoadedHighVoltageLines) return;
            toggleHighVoltageLinesLayer(true, { silent: true, retry: false, source }).catch(() => {});
        }, delay);
    });
}

async function toggleHighVoltageLinesLayer(forceState = null, options = {}) {
    const shouldShow = forceState === null ? !showHighVoltageLinesLayer : Boolean(forceState);
    const silent = !!options.silent;
    const allowRetry = options.retry !== false;

    showHighVoltageLinesLayer = shouldShow;
    localStorage.setItem(HIGH_VOLTAGE_LINES_LAYER_KEY, String(showHighVoltageLinesLayer));
    refreshHighVoltageLinesButtonState();

    if (!showHighVoltageLinesLayer) {
        highVoltageLinesScaleSuppressed = false;
        highVoltageLinesRefreshToken += 1;
        highVoltageLinesRetryToken += 1;
        clearTimeout(highVoltageLinesRefreshTimer);
        if (highVoltageLinesLayer && map?.hasLayer(highVoltageLinesLayer)) {
            map.removeLayer(highVoltageLinesLayer);
        }
        recordNpfStartupDiagnosticOverlaySnapshot(`lignes-ht OFF · ${options.source || 'toggle'}`);
        return;
    }

    if (!isHighVoltageLayerEffectiveAtCurrentScale()) {
        suppressHighVoltageLinesForWideScale(options.source || 'toggle');
        recordNpfStartupDiagnosticOverlaySnapshot(
            `lignes-ht ON mémorisé · masquées 50 NM · ${options.source || 'toggle'}`
        );
        return;
    }
    highVoltageLinesScaleSuppressed = false;

    if (
        highVoltageLinesLayer
        && map
        && !npfMapOverlayPriorityActive
        && !map.hasLayer(highVoltageLinesLayer)
    ) {
        highVoltageLinesLayer.addTo(map);
    }

    if (!hasLoadedHighVoltageLines) {
        const ready = await waitForNpfLayerActivationTileWindow('HT', {
            maxWaitMs: 12000,
            isCancelled: () => !showHighVoltageLinesLayer
        });
        if (!ready || !showHighVoltageLinesLayer) {
            if (allowRetry && showHighVoltageLinesLayer) scheduleHighVoltageLinesRetry(options.source || 'tile-priority');
            recordNpfStartupDiagnosticOverlaySnapshot(`lignes-ht ON · ${options.source || 'toggle'} · attente tuiles`);
            return;
        }

        const loadStartedAt = NPF_STARTUP_DIAGNOSTIC.now();
        try {
            await loadHighVoltageLinesLayerData();
            npfDiagSiaInteraction('FILTRE CARTE', 'couche=HT · données-prêtes', {
                layerMs: Math.round(NPF_STARTUP_DIAGNOSTIC.now() - loadStartedAt),
                htSegments: Number(highVoltageLinesFeatureCount || 0),
                tilesVisible: countVisibleLoadedBaseTiles(),
                npfReadsQueued: Number(directOfflineNpfReadQueue?.length || 0),
                npfReadsActive: Number(directOfflineNpfActiveReads || 0)
            });
        } catch (error) {
            console.warn('Chargement lignes HT différé:', options.source || 'manual', error);
            if (allowRetry) scheduleHighVoltageLinesRetry(options.source || 'load-error');
            if (!silent) {
                alert("Chargement Lignes HT différé. L'application va réessayer automatiquement.");
            }
            return;
        }
    }

    if (!showHighVoltageLinesLayer) return;
    await refreshVisibleHighVoltageLines(options.source || 'toggle');
    refreshHighVoltageLinesButtonState();
    recordNpfStartupDiagnosticOverlaySnapshot(`lignes-ht ON · ${options.source || 'toggle'}`);
}


