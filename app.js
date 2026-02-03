/**
 * STEP Labeler — Main Application
 * Connects the 3D viewer, feature manager, and Flask backend.
 */

(function () {
    'use strict';

    // --- State ---
    let viewer = null;
    let featureManager = null;
    let facesMetadata = [];
    let isLoaded = false;

    // --- DOM refs ---
    const canvas = document.getElementById('viewer-canvas');
    const fileInput = document.getElementById('file-input');
    const btnImport = document.getElementById('btn-import');
    const btnExport = document.getElementById('btn-export');
    const filenameEl = document.getElementById('filename');
    const hoverInfo = document.getElementById('hover-info');
    const selectedCount = document.getElementById('selected-faces-count');
    const btnCreateFeature = document.getElementById('btn-create-feature');
    const featuresContainer = document.getElementById('features-container');
    const faceListContainer = document.getElementById('face-list-container');
    const faceSearch = document.getElementById('face-search');
    const faceTypeFilter = document.getElementById('face-type-filter');
    const nameDialog = document.getElementById('name-dialog');
    const featureNameInput = document.getElementById('feature-name-input');
    const dialogFaceCount = document.getElementById('dialog-face-count');
    const btnDialogCancel = document.getElementById('btn-dialog-cancel');
    const btnDialogConfirm = document.getElementById('btn-dialog-confirm');
    const viewerPanel = document.getElementById('viewer-panel');
    const dropOverlay = document.getElementById('drop-overlay');

    // Toolbar buttons
    const btnResetView = document.getElementById('btn-reset-view');
    const btnZoomFit = document.getElementById('btn-zoom-fit');
    const btnXray = document.getElementById('btn-xray');
    const btnHideSelected = document.getElementById('btn-hide-selected');
    const btnUnhideAll = document.getElementById('btn-unhide-all');

    // Tabs
    const tabs = document.querySelectorAll('.tab');
    const panelContents = document.querySelectorAll('.panel-content');

    // --- Initialize ---
    function init() {
        viewer = new StepViewer(canvas);
        featureManager = new FeatureManager();

        // Wire up viewer callbacks
        viewer.onFaceClicked = onFaceClicked;
        viewer.onFaceHovered = onFaceHovered;

        // Wire up feature manager
        featureManager.onFeaturesChanged = onFeaturesChanged;

        // File import
        btnImport.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', onFileSelected);

        // Export
        btnExport.addEventListener('click', onExport);

        // Toolbar
        btnResetView.addEventListener('click', () => viewer.resetView());
        btnZoomFit.addEventListener('click', () => viewer._fitCamera());
        btnXray.addEventListener('click', toggleXray);
        btnHideSelected.addEventListener('click', hideSelectedFaces);
        btnUnhideAll.addEventListener('click', () => {
            viewer.unhideAll();
            updateFaceList();
        });

        // Create feature button
        btnCreateFeature.addEventListener('click', showNameDialog);

        // Dialog
        btnDialogCancel.addEventListener('click', hideNameDialog);
        btnDialogConfirm.addEventListener('click', confirmCreateFeature);
        featureNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirmCreateFeature();
            if (e.key === 'Escape') hideNameDialog();
        });

        // Tabs
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                panelContents.forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`${tab.dataset.tab}-panel`).classList.add('active');
            });
        });

        // Face list filters
        faceSearch.addEventListener('input', updateFaceList);
        faceTypeFilter.addEventListener('change', updateFaceList);

        // Drag and drop
        viewerPanel.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropOverlay.classList.remove('hidden');
        });
        viewerPanel.addEventListener('dragleave', () => {
            dropOverlay.classList.add('hidden');
        });
        viewerPanel.addEventListener('drop', onFileDrop);

        // Keyboard shortcuts
        document.addEventListener('keydown', onKeyDown);
    }

    // --- File Loading ---

    async function onFileSelected(event) {
        const file = event.target.files[0];
        if (!file) return;
        await uploadFile(file);
        fileInput.value = '';
    }

    async function onFileDrop(event) {
        event.preventDefault();
        dropOverlay.classList.add('hidden');

        const file = event.dataTransfer.files[0];
        if (file && (file.name.endsWith('.step') || file.name.endsWith('.stp'))) {
            await uploadFile(file);
        }
    }

    async function uploadFile(file) {
        filenameEl.textContent = `Loading ${file.name}...`;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const resp = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });
            const data = await resp.json();

            if (data.error) {
                alert(`Error: ${data.error}`);
                filenameEl.textContent = 'Error loading file';
                return;
            }

            onStepLoaded(data);
        } catch (err) {
            alert(`Failed to load file: ${err.message}`);
            filenameEl.textContent = 'Error loading file';
        }
    }

    function onStepLoaded(data) {
        isLoaded = true;
        filenameEl.textContent = data.filename;
        facesMetadata = data.faces;

        // Load mesh into viewer
        viewer.loadMesh(data.mesh);

        // Clear features
        featureManager.clear();

        // Update UI
        btnExport.disabled = false;
        updateSelectionInfo();
        updateFeaturesList();
        updateFaceList();
    }

    // --- Face Selection ---

    function onFaceClicked(faceId, shiftKey) {
        if (faceId < 0) {
            // Clicked empty space — clear selection unless shift
            if (!shiftKey) {
                viewer.clearSelection();
                updateSelectionInfo();
            }
            return;
        }

        if (shiftKey) {
            // Toggle face in selection
            if (viewer.selectedFaces.has(faceId)) {
                viewer.deselectFace(faceId);
            } else {
                viewer.selectFace(faceId);
            }
        } else {
            // Single select — replace selection
            viewer.clearSelection();
            viewer.selectFace(faceId);
        }

        updateSelectionInfo();
        updateFaceList();
    }

    function onFaceHovered(faceId, mouseX, mouseY) {
        if (faceId < 0) {
            hoverInfo.classList.add('hidden');
            return;
        }

        const meta = facesMetadata[faceId];
        if (!meta) {
            hoverInfo.classList.add('hidden');
            return;
        }

        const featureName = featureManager.getFeatureForFace(faceId);
        let text = `Face ${faceId} · ${meta.surface_type} · area: ${meta.area.toFixed(2)}`;
        if (featureName) {
            text += ` · ${featureName}`;
        }

        hoverInfo.textContent = text;
        hoverInfo.classList.remove('hidden');
        hoverInfo.style.left = (mouseX + 15) + 'px';
        hoverInfo.style.top = (mouseY - 10) + 'px';
    }

    function updateSelectionInfo() {
        const count = viewer.selectedFaces.size;
        if (count === 0) {
            selectedCount.textContent = 'No faces selected';
            btnCreateFeature.disabled = true;
        } else {
            selectedCount.textContent = `${count} face${count > 1 ? 's' : ''} selected`;
            btnCreateFeature.disabled = false;
        }
    }

    // --- Feature Creation ---

    function showNameDialog() {
        if (viewer.selectedFaces.size === 0) return;

        const count = viewer.selectedFaces.size;
        dialogFaceCount.textContent = `${count} face${count > 1 ? 's' : ''} will be grouped into this feature.`;
        featureNameInput.value = '';
        nameDialog.classList.remove('hidden');
        featureNameInput.focus();
    }

    function hideNameDialog() {
        nameDialog.classList.add('hidden');
    }

    function confirmCreateFeature() {
        const name = featureNameInput.value.trim();
        if (!name) {
            featureNameInput.style.borderColor = '#ff4a6a';
            return;
        }

        // Validate name (snake_case)
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
            featureNameInput.style.borderColor = '#ff4a6a';
            return;
        }

        const faceIds = Array.from(viewer.selectedFaces);
        const result = featureManager.createFeature(name, faceIds, facesMetadata);

        if (result.error) {
            alert(result.error);
            return;
        }

        // Apply feature colors in viewer
        const feature = featureManager.features[name];
        for (const member of feature.faces) {
            viewer.setFeatureColor(member.face_id, feature.color);
        }

        // Clear selection
        viewer.clearSelection();
        updateSelectionInfo();

        hideNameDialog();
        updateFeaturesList();
        updateFaceList();
    }

    // --- Features List ---

    function onFeaturesChanged() {
        updateFeaturesList();
        updateFaceList();
    }

    function updateFeaturesList() {
        const entries = Object.entries(featureManager.features);

        if (entries.length === 0) {
            featuresContainer.innerHTML = `
                <div class="empty-state">
                    ${isLoaded ? 'Select faces and click "Create Feature" to start labeling.' : 'Import a STEP file and select faces to create features.'}
                </div>`;
            return;
        }

        featuresContainer.innerHTML = entries.map(([name, feature]) => {
            const colorStr = `rgb(${Math.round(feature.color[0]*255)}, ${Math.round(feature.color[1]*255)}, ${Math.round(feature.color[2]*255)})`;
            const membersHtml = feature.faces.map(member => {
                const meta = facesMetadata[member.face_id];
                const fullName = member.sub_name ? `${name}.${member.sub_name}` : name;
                return `
                    <div class="feature-member"
                         data-face-id="${member.face_id}"
                         onmouseenter="window._app.flashFace(${member.face_id})"
                         onmouseleave="window._app.unflashFace(${member.face_id})">
                        <span>${fullName}</span>
                        <span class="member-type">${meta ? meta.surface_type : '?'}</span>
                    </div>`;
            }).join('');

            return `
                <div class="feature-item" data-feature="${name}">
                    <div class="feature-header" onclick="window._app.toggleFeature('${name}')">
                        <div class="feature-header-left">
                            <div class="feature-color" style="background: ${colorStr}"></div>
                            <span class="feature-name">${name}</span>
                        </div>
                        <div class="feature-header-right">
                            <span class="feature-count">${feature.faces.length} face${feature.faces.length > 1 ? 's' : ''}</span>
                            <div class="feature-actions">
                                <button onclick="event.stopPropagation(); window._app.deleteFeature('${name}')" class="danger" title="Delete feature">✕</button>
                            </div>
                        </div>
                    </div>
                    <div class="feature-members">${membersHtml}</div>
                </div>`;
        }).join('');
    }

    // --- Face List ---

    function updateFaceList() {
        if (!isLoaded || facesMetadata.length === 0) {
            faceListContainer.innerHTML = '<div class="empty-state">No STEP file loaded.</div>';
            return;
        }

        const searchTerm = faceSearch.value.toLowerCase();
        const typeFilter = faceTypeFilter.value;

        let filtered = facesMetadata.filter(face => {
            if (typeFilter !== 'all' && face.surface_type !== typeFilter) return false;
            if (searchTerm) {
                const featureName = featureManager.getFeatureForFace(face.id) || '';
                const text = `face ${face.id} ${face.surface_type} ${featureName}`.toLowerCase();
                if (!text.includes(searchTerm)) return false;
            }
            return true;
        });

        faceListContainer.innerHTML = filtered.map(face => {
            const isSelected = viewer.selectedFaces.has(face.id);
            const isHidden = viewer.hiddenFaces.has(face.id);
            const featureName = featureManager.getFeatureForFace(face.id);

            return `
                <div class="face-list-item ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-face' : ''}"
                     data-face-id="${face.id}"
                     onclick="window._app.clickFaceListItem(${face.id}, event)"
                     onmouseenter="window._app.flashFace(${face.id})"
                     onmouseleave="window._app.unflashFace(${face.id})">
                    <div class="face-list-left">
                        <span class="face-id">#${face.id}</span>
                        <span class="face-type-badge ${face.surface_type}">${face.surface_type}</span>
                        ${featureName ? `<span class="face-feature-tag">${featureName}</span>` : ''}
                    </div>
                    <span class="face-area">${face.area.toFixed(2)}</span>
                </div>`;
        }).join('');
    }

    // --- Toolbar Actions ---

    function toggleXray() {
        const enabled = !viewer.xrayMode;
        viewer.setXray(enabled);
        btnXray.classList.toggle('active', enabled);
    }

    function hideSelectedFaces() {
        for (const faceId of viewer.selectedFaces) {
            viewer.hideFace(faceId);
        }
        viewer.clearSelection();
        updateSelectionInfo();
        updateFaceList();
    }

    // --- Export ---

    async function onExport() {
        const features = featureManager.getExportData();

        if (Object.keys(features).length === 0) {
            alert('No features defined. Select faces and create features before exporting.');
            return;
        }

        try {
            const resp = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ features }),
            });

            if (!resp.ok) {
                const err = await resp.json();
                alert(`Export error: ${err.error}`);
                return;
            }

            // Download the file
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = resp.headers.get('content-disposition')?.split('filename=')[1] || 'output_named.step';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            alert(`Export failed: ${err.message}`);
        }
    }

    // --- Keyboard ---

    function onKeyDown(event) {
        // Don't capture if typing in input
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

        switch (event.key) {
            case 'Escape':
                viewer.clearSelection();
                updateSelectionInfo();
                break;
            case 'h':
            case 'H':
                hideSelectedFaces();
                break;
            case 'u':
            case 'U':
                viewer.unhideAll();
                updateFaceList();
                break;
            case 'x':
            case 'X':
                toggleXray();
                break;
            case 'f':
            case 'F':
                if (viewer.selectedFaces.size > 0) {
                    showNameDialog();
                }
                break;
        }
    }

    // --- Public API (for inline event handlers) ---

    window._app = {
        toggleFeature(name) {
            const el = featuresContainer.querySelector(`[data-feature="${name}"]`);
            if (el) el.classList.toggle('expanded');
        },

        deleteFeature(name) {
            const feature = featureManager.features[name];
            if (!feature) return;

            // Remove colors from viewer
            for (const member of feature.faces) {
                viewer.clearFeatureColor(member.face_id);
            }

            featureManager.deleteFeature(name);
            updateFeaturesList();
            updateFaceList();
        },

        flashFace(faceId) {
            viewer.flashFace(faceId);
        },

        unflashFace(faceId) {
            viewer.unflashFace(faceId);
        },

        clickFaceListItem(faceId, event) {
            onFaceClicked(faceId, event.shiftKey);
        },
    };

    // --- Start ---
    init();

})();
