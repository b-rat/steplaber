/**
 * STEP Labeler — Three.js 3D Viewer
 * Handles rendering, orbit controls, face picking, and highlighting.
 */

class StepViewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mesh = null;
        this.faceIds = [];        // Per-triangle face ID
        this.faceColors = null;   // Per-vertex color buffer
        this.numFaces = 0;
        this.selectedFaces = new Set();
        this.hoveredFace = -1;
        this.hiddenFaces = new Set();
        this.xrayMode = false;
        this.featureColors = {};  // face_id -> [r, g, b]
        this.wireframe = null;
        this.wireframeVisible = true;
        this.facesMetadata = [];

        // Orbit state - trackball style
        this.isOrbiting = false;
        this.isPanning = false;
        this.lastMouse = { x: 0, y: 0 };
        this.cameraDistance = 50;
        this.target = new THREE.Vector3(0, 0, 0);
        // Initial isometric-like view
        this.rotationQuaternion = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(-Math.PI / 6, Math.PI / 4, 0, 'YXZ')
        );

        // Callbacks
        this.onFaceClicked = null;
        this.onFaceHovered = null;

        this._init();
        this._setupEvents();
        this._animate();
    }

    _init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111114);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            45,
            this.canvas.clientWidth / this.canvas.clientHeight,
            0.1,
            10000
        );

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Lights - high ambient for visibility of all surfaces
        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambient);

        // Hemisphere light for soft all-around illumination
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
        hemi.position.set(0, 20, 0);
        this.scene.add(hemi);

        const dir1 = new THREE.DirectionalLight(0xffffff, 0.4);
        dir1.position.set(5, 8, 5);
        this.scene.add(dir1);

        const dir2 = new THREE.DirectionalLight(0xffffff, 0.2);
        dir2.position.set(-5, -3, -5);
        this.scene.add(dir2);

        // Grid
        const grid = new THREE.GridHelper(100, 20, 0x2a2a30, 0x1e1e24);
        this.scene.add(grid);

        // Origin axes helper (R=X, G=Y, B=Z)
        const axisLength = 20;
        const axes = new THREE.AxesHelper(axisLength);
        this.scene.add(axes);

        // Axis labels
        const makeLabel = (text, color, position) => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = color;
            ctx.font = 'bold 48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 32, 32);

            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(material);
            sprite.position.copy(position);
            sprite.scale.set(5, 5, 1);
            return sprite;
        };

        this.scene.add(makeLabel('X', '#ff4444', new THREE.Vector3(axisLength + 2, 0, 0)));
        this.scene.add(makeLabel('Y', '#44ff44', new THREE.Vector3(0, axisLength + 2, 0)));
        this.scene.add(makeLabel('Z', '#4444ff', new THREE.Vector3(0, 0, axisLength + 2)));

        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Handle resize
        window.addEventListener('resize', () => this._onResize());
    }

    _setupEvents() {
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this._onWheel(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    loadMesh(data, facesMetadata) {
        /**
         * Load tessellated mesh data from backend.
         * data: { vertices: [...], normals: [...], triangles: [...], face_ids: [...], num_faces: N }
         * facesMetadata: array of { id, surface_type, area, ... } for each face
         */
        this.facesMetadata = facesMetadata || [];

        // Remove old mesh
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }

        this.faceIds = data.face_ids;
        this.numFaces = data.num_faces;

        // Build geometry
        const geometry = new THREE.BufferGeometry();

        const vertices = new Float32Array(data.vertices);
        const normals = new Float32Array(data.normals);
        const indices = new Uint32Array(data.triangles);

        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        // Per-vertex colors for face highlighting
        const colors = new Float32Array(vertices.length);
        this._resetColors(colors, indices, data.face_ids);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.faceColors = geometry.getAttribute('color');

        // Material with vertex colors
        const material = new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            shininess: 30,
            transparent: false,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);

        // Edge outline from CAD topology (if provided)
        if (data.edges && data.edges.length > 0) {
            const edgeGeo = new THREE.BufferGeometry();
            const edgeVerts = new Float32Array(data.edges);
            edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeVerts, 3));
            const edgeMat = new THREE.LineBasicMaterial({
                color: 0x000000,
                linewidth: 1,
            });
            this.wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
            this.wireframe.visible = this.wireframeVisible;
            this.mesh.add(this.wireframe);
        } else {
            this.wireframe = null;
        }

        // Fit camera
        this._fitCamera();

        // Clear state
        this.selectedFaces.clear();
        this.hiddenFaces.clear();
        this.featureColors = {};
        this.xrayMode = false;
    }

    clearMesh() {
        /**
         * Remove the current mesh and reset viewer state.
         */
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }
        if (this.wireframe) {
            this.wireframe = null;
        }

        this.faceIds = [];
        this.faceColors = null;
        this.numFaces = 0;
        this.facesMetadata = [];
        this.selectedFaces.clear();
        this.hiddenFaces.clear();
        this.featureColors = {};
        this.hoveredFace = -1;
    }

    _resetColors(colorArray, indices, faceIds) {
        /**
         * Assign base color to each face.
         */
        const baseColor = [0.6, 0.6, 0.65];

        // First, initialize ALL vertices to base color
        for (let i = 0; i < colorArray.length; i += 3) {
            colorArray[i] = baseColor[0];
            colorArray[i + 1] = baseColor[1];
            colorArray[i + 2] = baseColor[2];
        }
    }

    _generateFaceColors(count) {
        /**
         * Generate uniform color for all faces.
         */
        const colors = [];
        const baseColor = [0.6, 0.6, 0.65]; // Light gray-blue

        for (let i = 0; i < count; i++) {
            colors.push(baseColor);
        }
        return colors;
    }

    _hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [r, g, b];
    }

    _fitCamera() {
        if (!this.mesh) return;

        const box = new THREE.Box3().setFromObject(this.mesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        this.target.copy(center);
        this.cameraDistance = maxDim * 2;
        this._updateCamera();
    }

    _updateCamera() {
        // Trackball-style: apply quaternion rotation to a base camera direction
        const baseDirection = new THREE.Vector3(0, 0, 1);
        baseDirection.applyQuaternion(this.rotationQuaternion);

        this.camera.position.copy(this.target).addScaledVector(baseDirection, this.cameraDistance);
        this.camera.up.set(0, 1, 0).applyQuaternion(this.rotationQuaternion);
        this.camera.lookAt(this.target);
    }

    // --- Face highlighting ---

    highlightFace(faceId, color) {
        if (!this.mesh || faceId < 0) return;

        const indices = this.mesh.geometry.index.array;
        const colorAttr = this.faceColors;

        for (let i = 0; i < this.faceIds.length; i++) {
            if (this.faceIds[i] === faceId) {
                for (let v = 0; v < 3; v++) {
                    const vertIdx = indices[i * 3 + v];
                    colorAttr.setXYZ(vertIdx, color[0], color[1], color[2]);
                }
            }
        }
        colorAttr.needsUpdate = true;
    }

    resetFaceColor(faceId) {
        if (!this.mesh || faceId < 0) return;

        // Check if face has a feature color
        if (this.featureColors[faceId]) {
            this.highlightFace(faceId, this.featureColors[faceId]);
            return;
        }

        const baseColors = this._generateFaceColors(this.numFaces);
        const color = baseColors[faceId] || [0.45, 0.45, 0.48];
        this.highlightFace(faceId, color);
    }

    setFeatureColor(faceId, color) {
        this.featureColors[faceId] = color;
        if (!this.selectedFaces.has(faceId)) {
            this.highlightFace(faceId, color);
        }
    }

    clearFeatureColor(faceId) {
        delete this.featureColors[faceId];
        if (!this.selectedFaces.has(faceId)) {
            this.resetFaceColor(faceId);
        }
    }

    selectFace(faceId) {
        this.selectedFaces.add(faceId);
        this.highlightFace(faceId, [0.3, 0.6, 1.0]); // Selection blue
    }

    deselectFace(faceId) {
        this.selectedFaces.delete(faceId);
        this.resetFaceColor(faceId);
    }

    clearSelection() {
        for (const faceId of this.selectedFaces) {
            this.resetFaceColor(faceId);
        }
        this.selectedFaces.clear();
    }

    hideFace(faceId) {
        this.hiddenFaces.add(faceId);
        this.highlightFace(faceId, [0.12, 0.12, 0.14]); // Near-background
    }

    showFace(faceId) {
        this.hiddenFaces.delete(faceId);
        this.resetFaceColor(faceId);
    }

    unhideAll() {
        for (const faceId of this.hiddenFaces) {
            this.showFace(faceId);
        }
        this.hiddenFaces.clear();
    }

    setXray(enabled) {
        this.xrayMode = enabled;
        if (this.mesh) {
            this.mesh.material.transparent = enabled;
            this.mesh.material.opacity = enabled ? 0.3 : 1.0;
            this.mesh.material.depthWrite = !enabled;
            this.mesh.material.needsUpdate = true;
        }
    }

    setWireframe(enabled) {
        this.wireframeVisible = enabled;
        if (this.wireframe) {
            this.wireframe.visible = enabled;
        }
    }

    // --- Picking ---

    _getFaceAtMouse(event) {
        if (!this.mesh) return -1;

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.mesh, false);

        if (intersects.length > 0) {
            const triIndex = intersects[0].faceIndex;
            if (triIndex !== undefined && triIndex < this.faceIds.length) {
                const faceId = this.faceIds[triIndex];
                if (!this.hiddenFaces.has(faceId)) {
                    return faceId;
                }
            }
        }
        return -1;
    }

    // --- Mouse events ---

    _onMouseDown(event) {
        this.lastMouse = { x: event.clientX, y: event.clientY };
        this._mouseDownPos = { x: event.clientX, y: event.clientY };

        if (event.button === 0 && !event.ctrlKey && !event.metaKey) {
            // Left click — might be select or orbit
            this.isOrbiting = true;
        } else if (event.button === 1 || (event.button === 0 && (event.ctrlKey || event.metaKey))) {
            // Middle click or Ctrl+left — pan
            this.isPanning = true;
        } else if (event.button === 2) {
            // Right click — orbit
            this.isOrbiting = true;
        }
    }

    _onMouseMove(event) {
        const dx = event.clientX - this.lastMouse.x;
        const dy = event.clientY - this.lastMouse.y;

        if (this.isOrbiting && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
            this._didDrag = true;

            // Trackball rotation: rotate around camera's right and up axes
            const rotSpeed = 0.005;

            // Get camera axes
            const right = new THREE.Vector3();
            const up = new THREE.Vector3();
            right.setFromMatrixColumn(this.camera.matrixWorld, 0);
            up.setFromMatrixColumn(this.camera.matrixWorld, 1);

            // Create rotation quaternions
            const qx = new THREE.Quaternion().setFromAxisAngle(up, -dx * rotSpeed);
            const qy = new THREE.Quaternion().setFromAxisAngle(right, -dy * rotSpeed);

            // Apply rotations
            this.rotationQuaternion.premultiply(qx).premultiply(qy);
            this.rotationQuaternion.normalize();

            this._updateCamera();
        } else if (this.isPanning) {
            this._didDrag = true;
            const panSpeed = this.cameraDistance * 0.001;
            const right = new THREE.Vector3();
            const up = new THREE.Vector3();
            right.setFromMatrixColumn(this.camera.matrixWorld, 0);
            up.setFromMatrixColumn(this.camera.matrixWorld, 1);
            this.target.add(right.multiplyScalar(-dx * panSpeed));
            this.target.add(up.multiplyScalar(dy * panSpeed));
            this._updateCamera();
        } else {
            // Hover
            const faceId = this._getFaceAtMouse(event);
            if (faceId !== this.hoveredFace) {
                if (this.hoveredFace >= 0 && !this.selectedFaces.has(this.hoveredFace)) {
                    this.resetFaceColor(this.hoveredFace);
                }
                this.hoveredFace = faceId;
                if (faceId >= 0 && !this.selectedFaces.has(faceId)) {
                    this.highlightFace(faceId, [0.5, 0.65, 0.8]); // Hover tint
                }
                if (this.onFaceHovered) {
                    this.onFaceHovered(faceId, event.clientX, event.clientY);
                }
            }
        }

        this.lastMouse = { x: event.clientX, y: event.clientY };
    }

    _onMouseUp(event) {
        const wasDrag = this._didDrag;
        this.isOrbiting = false;
        this.isPanning = false;
        this._didDrag = false;

        // If it was a click (not drag) and left button, do face selection
        if (!wasDrag && event.button === 0 && !event.ctrlKey && !event.metaKey) {
            const faceId = this._getFaceAtMouse(event);
            if (this.onFaceClicked) {
                this.onFaceClicked(faceId, event.shiftKey);
            }
        }
    }

    _onWheel(event) {
        event.preventDefault();
        const factor = event.deltaY > 0 ? 1.1 : 0.9;
        this.cameraDistance = Math.max(0.5, this.cameraDistance * factor);
        this._updateCamera();
    }

    _onResize() {
        const parent = this.canvas.parentElement;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        this.renderer.render(this.scene, this.camera);
    }

    resetView() {
        // Reset to an isometric-like view
        this.rotationQuaternion.setFromEuler(new THREE.Euler(-Math.PI / 6, Math.PI / 4, 0, 'YXZ'));
        this._fitCamera();
    }

    /**
     * Highlight a face temporarily for face-list hover.
     */
    flashFace(faceId) {
        if (faceId >= 0 && !this.selectedFaces.has(faceId)) {
            this.highlightFace(faceId, [1.0, 0.73, 0.2]); // Gold flash
        }
    }

    unflashFace(faceId) {
        if (faceId >= 0 && !this.selectedFaces.has(faceId)) {
            this.resetFaceColor(faceId);
        }
    }
}
