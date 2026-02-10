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
    let multiSelectMode = false;
    let lengthUnit = 'units';
    let lengthScale = 1.0;  // Scale factor from OCC meters to display unit

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
    const faceTypeFilter = document.getElementById('face-type-filter');
    const faceLabelFilter = document.getElementById('face-label-filter');
    const areaMinInput = document.getElementById('area-min');
    const areaMaxInput = document.getElementById('area-max');
    const nameDialog = document.getElementById('name-dialog');
    const featureNameInput = document.getElementById('feature-name-input');
    const dialogFaceCount = document.getElementById('dialog-face-count');
    const btnDialogCancel = document.getElementById('btn-dialog-cancel');
    const btnDialogConfirm = document.getElementById('btn-dialog-confirm');
    const viewerPanel = document.getElementById('viewer-panel');
    const dropOverlay = document.getElementById('drop-overlay');
    const btnClear = document.getElementById('btn-clear');
    const measurementDisplay = document.getElementById('measurement-display');

    // Toolbar buttons
    const btnResetView = document.getElementById('btn-reset-view');
    const btnZoomFit = document.getElementById('btn-zoom-fit');
    const btnClearSelection = document.getElementById('btn-clear-selection');
    const btnXray = document.getElementById('btn-xray');
    const btnWireframe = document.getElementById('btn-wireframe');
    const btnMultiSelect = document.getElementById('btn-multi-select');
    const btnColors = document.getElementById('btn-colors');
    const btnGridXZ = document.getElementById('btn-grid-xz');
    const btnGridXY = document.getElementById('btn-grid-xy');
    const btnGridYZ = document.getElementById('btn-grid-yz');
    const btnClipXY = document.getElementById('btn-clip-xy');
    const btnClipYZ = document.getElementById('btn-clip-yz');
    const btnClipXZ = document.getElementById('btn-clip-xz');
    const btnClipFlip = document.getElementById('btn-clip-flip');
    const clipSliderContainer = document.getElementById('clip-slider-container');
    const clipSlider = document.getElementById('clip-slider');

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

        // Clear file
        btnClear.addEventListener('click', clearFile);

        // Export
        btnExport.addEventListener('click', onExport);

        // Toolbar
        btnResetView.addEventListener('click', () => viewer.resetView());
        btnZoomFit.addEventListener('click', () => viewer._fitCamera());
        btnClearSelection.addEventListener('click', () => {
            viewer.clearSelection();
            updateSelectionInfo();
        });
        btnXray.addEventListener('click', toggleXray);
        btnWireframe.addEventListener('click', toggleWireframe);
        btnMultiSelect.addEventListener('click', toggleMultiSelect);
        btnColors.addEventListener('click', toggleColors);
        btnGridXZ.addEventListener('click', () => setGridPlane('XZ'));
        btnGridXY.addEventListener('click', () => setGridPlane('XY'));
        btnGridYZ.addEventListener('click', () => setGridPlane('YZ'));
        btnClipXY.addEventListener('click', () => setClipPlane('XY'));
        btnClipYZ.addEventListener('click', () => setClipPlane('YZ'));
        btnClipXZ.addEventListener('click', () => setClipPlane('XZ'));
        btnClipFlip.addEventListener('click', onClipFlip);
        clipSlider.addEventListener('input', () => {
            viewer.setClippingOffset(parseFloat(clipSlider.value));
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
        faceTypeFilter.addEventListener('change', updateFaceList);
        faceLabelFilter.addEventListener('change', updateFaceList);
        areaMinInput.addEventListener('input', updateFaceList);
        areaMaxInput.addEventListener('input', updateFaceList);

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
        lengthUnit = data.info?.length_unit || 'units';
        lengthScale = data.info?.length_scale || 1.0;

        // Reset clipping UI
        clipSliderContainer.classList.add('hidden');
        btnClipXY.classList.remove('active');
        btnClipYZ.classList.remove('active');
        btnClipXZ.classList.remove('active');

        // Load mesh into viewer with face metadata for coloring
        viewer.loadMesh(data.mesh, data.faces);

        // Clear features then import any existing names from STEP
        featureManager.clear();
        const importedCount = featureManager.importFromStepNames(facesMetadata);

        // Apply feature colors to viewer for imported features
        if (importedCount > 0) {
            for (const [name, feature] of Object.entries(featureManager.features)) {
                for (const member of feature.faces) {
                    viewer.setFeatureColor(member.face_id, feature.color);
                }
            }
        }

        // Update UI
        btnExport.disabled = false;
        btnClear.hidden = false;
        updateSelectionInfo();
        updateFeaturesList();
        updateFaceList();
    }

    function clearFile() {
        isLoaded = false;
        facesMetadata = [];
        lengthUnit = 'units';
        lengthScale = 1.0;

        // Clear clipping UI
        clipSliderContainer.classList.add('hidden');
        btnClipXY.classList.remove('active');
        btnClipYZ.classList.remove('active');
        btnClipXZ.classList.remove('active');

        // Clear viewer
        viewer.clearMesh();

        // Clear features
        featureManager.clear();

        // Reset UI
        filenameEl.textContent = 'No file loaded';
        btnExport.disabled = true;
        btnClear.hidden = true;
        updateSelectionInfo();
        updateFeaturesList();
        updateFaceList();
    }

    // --- Face Selection ---

    function onFaceClicked(faceId, shiftKey) {
        const addToSelection = multiSelectMode || shiftKey;

        if (faceId < 0) {
            // Clicked empty space — clear selection unless in multi-select mode
            if (!addToSelection) {
                viewer.clearSelection();
                updateSelectionInfo();
            }
            return;
        }

        if (addToSelection) {
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
            measurementDisplay.classList.add('hidden');
        } else {
            selectedCount.textContent = `${count} face${count > 1 ? 's' : ''} selected`;
            btnCreateFeature.disabled = false;
            updateMeasurement();
        }
    }

    /**
     * Calculate and display measurements for selected faces.
     * - 1 cylindrical face: show diameter
     * - 2 cylindrical faces: show center-to-center distance
     * - 2 parallel planar faces: show distance between planes
     * - 1 cylindrical + 1 planar: show centerline-to-plane distance
     */
    function updateMeasurement() {
        const selectedIds = Array.from(viewer.selectedFaces);

        // Single face selected - show diameter or radius for cylindrical based on arc angle
        if (selectedIds.length === 1) {
            const face = facesMetadata[selectedIds[0]];
            if (face && face.surface_type === 'cylindrical' && face.radius !== null) {
                const arcAngle = face.arc_angle || 360;
                const isFullCylinder = arcAngle >= 180;

                measurementDisplay.classList.remove('hidden');
                measurementDisplay.classList.add('has-value');

                if (isFullCylinder) {
                    const diameter = face.radius * 2 * lengthScale;
                    measurementDisplay.innerHTML = `
                        <div class="measurement-label">Diameter (cylinder)</div>
                        <div class="measurement-value">⌀ ${diameter.toFixed(4)} ${lengthUnit}</div>
                        <div class="measurement-note">Face #${selectedIds[0]} · ${arcAngle}° arc</div>`;
                } else {
                    const radius = face.radius * lengthScale;
                    measurementDisplay.innerHTML = `
                        <div class="measurement-label">Radius (arc)</div>
                        <div class="measurement-value">R ${radius.toFixed(4)} ${lengthUnit}</div>
                        <div class="measurement-note">Face #${selectedIds[0]} · ${arcAngle}° arc</div>`;
                }
                return;
            }
            measurementDisplay.classList.add('hidden');
            measurementDisplay.classList.remove('has-value');
            return;
        }

        // Only measure when exactly 2 faces are selected
        if (selectedIds.length !== 2) {
            measurementDisplay.classList.add('hidden');
            measurementDisplay.classList.remove('has-value');
            return;
        }

        const face1 = facesMetadata[selectedIds[0]];
        const face2 = facesMetadata[selectedIds[1]];

        if (!face1 || !face2) {
            measurementDisplay.classList.add('hidden');
            return;
        }

        // Two cylindrical faces - show center distance
        if (face1.surface_type === 'cylindrical' && face2.surface_type === 'cylindrical') {
            measureCylinderDistance(face1, face2, selectedIds);
            return;
        }

        // Two planar faces - show distance if parallel
        if (face1.surface_type === 'planar' && face2.surface_type === 'planar') {
            measurePlanarDistance(face1, face2, selectedIds);
            return;
        }

        // One cylindrical + one planar: distance from axis to plane
        if ((face1.surface_type === 'cylindrical' && face2.surface_type === 'planar') ||
            (face1.surface_type === 'planar' && face2.surface_type === 'cylindrical')) {
            measureCylinderToPlane(
                face1.surface_type === 'cylindrical' ? face1 : face2,
                face1.surface_type === 'planar' ? face1 : face2,
                selectedIds
            );
            return;
        }

        // Mixed types - show info
        measurementDisplay.classList.remove('hidden', 'has-value');
        measurementDisplay.innerHTML = `
            <div class="measurement-note">
                Select two faces of the same type to measure.
                Selected: ${face1.surface_type} + ${face2.surface_type}
            </div>`;
    }

    /**
     * Measure distance between two parallel planar faces.
     */
    function measurePlanarDistance(face1, face2, selectedIds) {
        const n1 = face1.normal;
        const n2 = face2.normal;
        const c1 = face1.centroid;
        const c2 = face2.centroid;

        if (!n1 || !n2 || !c1 || !c2) {
            measurementDisplay.classList.add('hidden');
            return;
        }

        // Check if faces are parallel: |n1 · n2| ≈ 1
        const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
        const isParallel = Math.abs(Math.abs(dot) - 1) < 0.001;

        if (!isParallel) {
            const angleDeg = Math.acos(Math.min(1, Math.abs(dot))) * (180 / Math.PI);
            measurementDisplay.classList.remove('hidden');
            measurementDisplay.classList.add('has-value');
            measurementDisplay.innerHTML = `
                <div class="measurement-label">Angle (faces)</div>
                <div class="measurement-value">${angleDeg.toFixed(2)}°</div>
                <div class="measurement-note">Face #${selectedIds[0]} ↔ Face #${selectedIds[1]}</div>`;
            return;
        }

        // Calculate distance: |n1 · (c2 - c1)|
        const dx = c2[0] - c1[0];
        const dy = c2[1] - c1[1];
        const dz = c2[2] - c1[2];
        const distanceRaw = Math.abs(n1[0] * dx + n1[1] * dy + n1[2] * dz);
        const distance = distanceRaw * lengthScale;

        measurementDisplay.classList.remove('hidden');
        measurementDisplay.classList.add('has-value');
        measurementDisplay.innerHTML = `
            <div class="measurement-label">Distance (parallel faces)</div>
            <div class="measurement-value">${distance.toFixed(4)} ${lengthUnit}</div>
            <div class="measurement-note">Face #${selectedIds[0]} ↔ Face #${selectedIds[1]}</div>`;
    }

    /**
     * Measure center-to-center distance between two cylindrical faces.
     */
    function measureCylinderDistance(face1, face2, selectedIds) {
        const p1 = face1.axis_point;
        const d1 = face1.axis_direction;
        const p2 = face2.axis_point;
        const d2 = face2.axis_direction;

        if (!p1 || !d1 || !p2 || !d2) {
            measurementDisplay.classList.add('hidden');
            return;
        }

        // Check if axes are parallel: |d1 · d2| ≈ 1
        const dot = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
        const isParallel = Math.abs(Math.abs(dot) - 1) < 0.001;

        // Vector from p1 to p2
        const v = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];

        let centerDistance;
        if (isParallel) {
            // For parallel axes, distance = |v - (v · d1) * d1|
            const proj = v[0] * d1[0] + v[1] * d1[1] + v[2] * d1[2];
            const perp = [
                v[0] - proj * d1[0],
                v[1] - proj * d1[1],
                v[2] - proj * d1[2],
            ];
            centerDistance = Math.sqrt(perp[0] * perp[0] + perp[1] * perp[1] + perp[2] * perp[2]);
        } else {
            // For non-parallel (skew) axes, use closest approach distance
            // Cross product gives perpendicular direction
            const cross = [
                d1[1] * d2[2] - d1[2] * d2[1],
                d1[2] * d2[0] - d1[0] * d2[2],
                d1[0] * d2[1] - d1[1] * d2[0],
            ];
            const crossLen = Math.sqrt(cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]);
            if (crossLen > 0.0001) {
                // Distance = |v · (d1 × d2)| / |d1 × d2|
                centerDistance = Math.abs(v[0] * cross[0] + v[1] * cross[1] + v[2] * cross[2]) / crossLen;
            } else {
                // Nearly parallel, fall back to parallel case
                const proj = v[0] * d1[0] + v[1] * d1[1] + v[2] * d1[2];
                const perp = [v[0] - proj * d1[0], v[1] - proj * d1[1], v[2] - proj * d1[2]];
                centerDistance = Math.sqrt(perp[0] * perp[0] + perp[1] * perp[1] + perp[2] * perp[2]);
            }
        }

        // Apply scale to center distance
        const scaledCenterDistance = centerDistance * lengthScale;

        // Show diameter or radius based on arc angle (>=180° = diameter, <180° = radius)
        function cylSizeStr(face) {
            if (!face.radius) return '?';
            const arc = face.arc_angle || 360;
            const scaledRadius = face.radius * lengthScale;
            if (arc >= 180) {
                return `⌀${(scaledRadius * 2).toFixed(4)}`;
            } else {
                return `R${scaledRadius.toFixed(4)}`;
            }
        }
        const d1Str = cylSizeStr(face1);
        const d2Str = cylSizeStr(face2);

        measurementDisplay.classList.remove('hidden');
        measurementDisplay.classList.add('has-value');

        if (!isParallel) {
            // Show angle between axes for non-parallel cylinders
            const angleDeg = Math.acos(Math.min(1, Math.abs(dot))) * (180 / Math.PI);
            measurementDisplay.innerHTML = `
                <div class="measurement-label">Angle (cylinder axes)</div>
                <div class="measurement-value">${angleDeg.toFixed(2)}°</div>
                <div class="measurement-note">
                    Face #${selectedIds[0]} (${d1Str}) ↔ Face #${selectedIds[1]} (${d2Str}) ${lengthUnit}
                </div>`;
        } else {
            measurementDisplay.innerHTML = `
                <div class="measurement-label">Center Distance (cylinders)</div>
                <div class="measurement-value">${scaledCenterDistance.toFixed(4)} ${lengthUnit}</div>
                <div class="measurement-note">
                    Face #${selectedIds[0]} (${d1Str}) ↔ Face #${selectedIds[1]} (${d2Str}) ${lengthUnit}
                </div>`;
        }
    }

    /**
     * Measure distance from a cylinder's centerline to a planar face.
     * Only meaningful when the axis is parallel to the plane.
     */
    function measureCylinderToPlane(cylFace, planeFace, selectedIds) {
        const axisPoint = cylFace.axis_point;
        const axisDir = cylFace.axis_direction;
        const planeNormal = planeFace.normal;
        const planeCentroid = planeFace.centroid;

        if (!axisPoint || !axisDir || !planeNormal || !planeCentroid) {
            measurementDisplay.classList.add('hidden');
            return;
        }

        // Check if axis is parallel to the plane: axis_dir · plane_normal ≈ 0
        const dot = axisDir[0] * planeNormal[0] + axisDir[1] * planeNormal[1] + axisDir[2] * planeNormal[2];
        const isParallel = Math.abs(dot) < 0.01;

        if (!isParallel) {
            const angleDeg = 90 - Math.acos(Math.min(1, Math.abs(dot))) * (180 / Math.PI);
            measurementDisplay.classList.remove('hidden');
            measurementDisplay.classList.add('has-value');
            measurementDisplay.innerHTML = `
                <div class="measurement-label">Axis-to-plane angle</div>
                <div class="measurement-value">${angleDeg.toFixed(2)}°</div>
                <div class="measurement-note">Axis is not parallel to plane</div>`;
            return;
        }

        // Distance from axis_point to the plane: |plane_normal · (axis_point - plane_centroid)|
        const dx = axisPoint[0] - planeCentroid[0];
        const dy = axisPoint[1] - planeCentroid[1];
        const dz = axisPoint[2] - planeCentroid[2];
        const distanceRaw = Math.abs(planeNormal[0] * dx + planeNormal[1] * dy + planeNormal[2] * dz);
        const distance = distanceRaw * lengthScale;

        // Cylinder size label
        const arc = cylFace.arc_angle || 360;
        const scaledRadius = cylFace.radius * lengthScale;
        const cylStr = arc >= 180
            ? `⌀${(scaledRadius * 2).toFixed(4)}`
            : `R${scaledRadius.toFixed(4)}`;

        const cylId = cylFace === facesMetadata[selectedIds[0]] ? selectedIds[0] : selectedIds[1];
        const planeId = cylId === selectedIds[0] ? selectedIds[1] : selectedIds[0];

        measurementDisplay.classList.remove('hidden');
        measurementDisplay.classList.add('has-value');
        measurementDisplay.innerHTML = `
            <div class="measurement-label">Centerline to Plane</div>
            <div class="measurement-value">${distance.toFixed(4)} ${lengthUnit}</div>
            <div class="measurement-note">
                Face #${cylId} (${cylStr}) ↔ Face #${planeId} (planar) ${lengthUnit}
            </div>`;
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

        const typeFilter = faceTypeFilter.value;
        const labelFilter = faceLabelFilter.value;
        const areaMin = areaMinInput.value ? parseFloat(areaMinInput.value) : null;
        const areaMax = areaMaxInput.value ? parseFloat(areaMaxInput.value) : null;

        let filtered = facesMetadata.filter(face => {
            if (typeFilter !== 'all' && face.surface_type !== typeFilter) return false;
            if (labelFilter === 'labeled' && !featureManager.getFeatureForFace(face.id)) return false;
            if (labelFilter === 'unlabeled' && featureManager.getFeatureForFace(face.id)) return false;
            if (areaMin !== null && face.area < areaMin) return false;
            if (areaMax !== null && face.area > areaMax) return false;
            return true;
        });

        // Sort by area descending for easier browsing
        filtered.sort((a, b) => b.area - a.area);

        faceListContainer.innerHTML = filtered.map(face => {
            const isSelected = viewer.selectedFaces.has(face.id);
            const featureName = featureManager.getFeatureForFace(face.id);

            // Show feature name, or imported STEP name if no feature assigned
            const displayTag = featureName
                ? `<span class="face-feature-tag">${featureName}</span>`
                : (face.step_name ? `<span class="face-step-name">${face.step_name}</span>` : '');

            return `
                <div class="face-list-item ${isSelected ? 'selected' : ''}"
                     data-face-id="${face.id}"
                     onclick="window._app.clickFaceListItem(${face.id}, event)"
                     onmouseenter="window._app.flashFace(${face.id})"
                     onmouseleave="window._app.unflashFace(${face.id})">
                    <div class="face-list-left">
                        <span class="face-id">#${face.id}</span>
                        <span class="face-type-badge ${face.surface_type}">${face.surface_type}</span>
                        ${displayTag}
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

    function toggleWireframe() {
        const enabled = !viewer.wireframeVisible;
        viewer.setWireframe(enabled);
        btnWireframe.classList.toggle('active', enabled);
    }

    function toggleColors() {
        const enabled = !viewer.colorsVisible;
        viewer.setColorsVisible(enabled);
        btnColors.classList.toggle('active', enabled);
    }

    function toggleMultiSelect() {
        multiSelectMode = !multiSelectMode;
        btnMultiSelect.classList.toggle('active', multiSelectMode);
    }

    function setGridPlane(plane) {
        const activePlane = viewer.setGridPlane(plane);
        btnGridXZ.classList.toggle('active', activePlane === 'XZ');
        btnGridXY.classList.toggle('active', activePlane === 'XY');
        btnGridYZ.classList.toggle('active', activePlane === 'YZ');
    }

    function setClipPlane(plane) {
        const result = viewer.setClippingPlane(plane);

        btnClipXY.classList.toggle('active', result && result.axis === 'XY');
        btnClipYZ.classList.toggle('active', result && result.axis === 'YZ');
        btnClipXZ.classList.toggle('active', result && result.axis === 'XZ');

        if (result) {
            clipSlider.min = result.min;
            clipSlider.max = result.max;
            clipSlider.step = (result.max - result.min) / 500;
            clipSlider.value = result.center;
            clipSliderContainer.classList.remove('hidden');
        } else {
            clipSliderContainer.classList.add('hidden');
        }
    }

    function onClipFlip() {
        if (!viewer.clipPlaneAxis) return;
        viewer.flipClipping();
        // Update slider value to match the new constant
        const currentValue = parseFloat(clipSlider.value);
        // After flip, the effective offset sign changes, so we keep the slider position
        // but the viewer internally handles the negation
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
            let filename = 'output_named.step';
            const disposition = resp.headers.get('content-disposition');
            if (disposition) {
                const match = disposition.match(/filename="?([^";\n]+)"?/);
                if (match) filename = match[1];
            }
            a.download = filename;
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
