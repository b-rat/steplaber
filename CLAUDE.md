# STEP Labeler - Project Guide for Claude Code

## What This Project Does

STEP Labeler is a local web application for naming faces and defining features on CAD geometry exported as STEP files. It bridges SolidWorks (or any CAD tool) with AI-driven parametric modification by embedding semantic labels directly into STEP file entities.

### The Pipeline
```
SolidWorks → STEP export → STEP Labeler (this tool) → Named STEP → Claude Code / OCC / CadQuery
```

### Why It Exists
STEP files exported from CAD tools have anonymous faces (`ADVANCED_FACE('NONE', ...)`). This tool lets an engineer visually select faces, group them into named features, and export a STEP file with those names embedded. Downstream tools (Claude Code, CadQuery, OCC) can then reference faces by name for parametric operations.

## Architecture

### Directory Structure
```
steplabeler/
├── app.py                 # Flask application and API endpoints
├── step_processor.py      # STEP file I/O using OCC/CadQuery
├── requirements.txt       # Python dependencies
├── CLAUDE.md              # This file
├── README.md              # User documentation
├── templates/
│   └── index.html         # Main page template
└── static/
    ├── css/
    │   └── style.css      # UI styling
    └── js/
        ├── app.js         # Application state and API communication
        ├── features.js    # Feature manager logic
        └── viewer.js      # Three.js 3D viewer
```

### Backend (Python/Flask)
- `app.py` — Main Flask application. Serves the web UI and provides REST API endpoints.
- `step_processor.py` — STEP file I/O using OCC (via CadQuery/OCP). Handles:
  - Reading STEP files and extracting topology
  - Tessellating faces to triangle meshes with face-index tracking
  - Extracting CAD topological edges for wireframe display
  - Mapping between mesh triangles and OCC TopoDS_Face objects
  - Writing named STEP files by text-replacing entity name strings

### Frontend (HTML/JS/CSS)
- `templates/index.html` — Main page template with two-panel layout
- `static/js/viewer.js` — Three.js 3D viewer with:
  - Trackball-style orbit controls (continuous rotation around any axis)
  - Face picking via raycasting
  - Face highlighting (selection, hover, feature colors)
  - X-ray transparency mode
  - CAD edge wireframe display
  - Origin axes with X/Y/Z labels
- `static/js/features.js` — Feature manager: creation, storage, auto sub-naming, import from STEP names
- `static/js/app.js` — Application state, API calls, UI event handling
- `static/css/style.css` — Dark theme UI styling

### API Endpoints
- `GET /` — Serve the main UI
- `POST /api/upload` — Upload a STEP file, returns tessellated mesh with face mapping
- `POST /api/load_file` — Load STEP from local path (for CLI argument)
- `GET /api/faces` — Get list of all faces with geometric metadata
- `GET /api/face/<id>` — Get detail for a specific face (type, area, centroid, normal)
- `GET/POST /api/features` — Get or save feature definitions
- `POST /api/export` — Export the named STEP file

### Data Flow
1. User uploads STEP file → backend parses with OCC
2. Backend tessellates each face separately, tracks face_id → triangle range mapping
3. Backend extracts CAD topological edges for wireframe display
4. Frontend renders combined mesh, uses face_id mapping for click detection
5. User selects faces, groups them into features with names
6. On export, backend maps feature names back to STEP entity line numbers
7. Backend does text replacement on ADVANCED_FACE name fields, writes new STEP

### STEP Naming Convention
Faces are named using dot-separated `feature.sub_face` convention:
```
#452 = ADVANCED_FACE('mounting_boss.top', ...);
#453 = ADVANCED_FACE('mounting_boss.cylinder', ...);
#454 = ADVANCED_FACE('cable_slot.bottom', ...);
```
Ungrouped but named faces use just the name: `ADVANCED_FACE('datum_a', ...)`
Unnamed faces remain as the original value (usually `'NONE'` or `''`).

### Importing Labeled STEP Files
When loading a STEP file that already has named faces (from a previous labeling session or another tool), the existing names are automatically imported as features:

1. Backend extracts existing names via `_get_step_name()` in `step_processor.py`
2. Names are passed to frontend in face metadata as `step_name`
3. `FeatureManager.importFromStepNames()` parses names and creates features:
   - `feature.sub_name` format → feature with sub_name preserved
   - `feature_name` format → feature with null sub_name
4. Feature colors are applied to faces in the 3D viewer
5. Features appear in the panel as if user-created

This enables iterative workflows: export a partially-labeled STEP, re-import later to continue labeling. Empty names and 'NONE' are filtered out during import.

## Key Technical Details

### Face-Triangle Mapping
This is the most critical piece. When OCC tessellates a shape, each face produces a set of triangles. We track which triangles belong to which face using an array of face IDs parallel to the triangle array. In Three.js, raycasting returns a face index which maps back through this array to the OCC face.

### CAD Edge Extraction
The wireframe displays actual CAD topological edges (not tessellation edges). Edges are extracted using `TopExp_Explorer` with `TopAbs_EDGE`, then discretized using `GCPnts_TangentialDeflection` for smooth curves.

### STEP Entity Matching
To write names back into the STEP file, we need to match OCC's internal TopoDS_Face objects to line numbers in the STEP text. We do this during initial parsing by walking the STEP entities alongside OCC's topology tree, matching by entity type and order.

### Face Metadata
Each face carries metadata extracted from OCC:
- `surface_type`: planar, cylindrical, conical, spherical, toroidal, bspline, bezier, revolution, extrusion, offset, other
- `area`: surface area in model units
- `centroid`: [x, y, z] center of mass
- `normal`: [x, y, z] average normal (for planar faces, exact normal)
- `bounds`: bounding box [min_x, min_y, min_z, max_x, max_y, max_z]

For cylindrical faces, additional properties are extracted:
- `radius`: cylinder radius
- `axis_direction`: [x, y, z] unit vector along cylinder axis
- `axis_point`: [x, y, z] point on the cylinder axis
- `arc_angle`: angular extent in degrees (360 for full cylinder, less for partial arcs)

### Measurement Tool
The UI includes a measurement tool that automatically displays measurements when faces are selected:

**Single face selected:**
- Cylindrical face: Shows diameter (⌀) for arcs ≥180°, radius (R) for arcs <180°
- Displays arc angle in the note

**Two faces selected:**
- Two parallel planar faces: Distance between planes
- Two non-parallel planar faces: Angle between faces
- Two parallel cylindrical faces: Center-to-center distance (perpendicular distance between axes)
- Two non-parallel cylindrical faces: Angle between axes

Units are automatically extracted from the STEP file (mm, in, m, etc.) and displayed with measurements. Falls back to "units" if not detected.

The measurement logic is in `app.js` functions: `updateMeasurement()`, `measurePlanarDistance()`, `measureCylinderDistance()`.

### Camera Controls
The viewer uses trackball-style rotation implemented with quaternions. This allows continuous orbiting around any axis without gimbal lock. Camera state is stored as:
- `rotationQuaternion`: Current camera orientation
- `cameraDistance`: Distance from target
- `target`: Look-at point (Vector3)

## Assembly Behavior

### Single Parts vs Assemblies
The tool works best with single-part STEP files. For assemblies, behavior depends on how the CAD system exports and how OCC reads the file.

### Simple Assemblies (Unique Parts)
Assemblies containing multiple unique parts (e.g., a block and a pin) work correctly. OCC reads faces in the same order as `ADVANCED_FACE` entities appear in the STEP file, so the direct `face_id → entity_id` mapping holds.

### Assemblies with Instanced Parts
When an assembly contains multiple instances of the same part (e.g., two identical pins), the STEP file contains:
- One set of `ADVANCED_FACE` entities for the prototype geometry
- Multiple `MAPPED_ITEM` references that instantiate it with different transforms

OCC expands these instances into separate faces, resulting in more OCC faces than STEP entities. For example:
- STEP: 3 `ADVANCED_FACE` entities for a pin (top, cylinder, bottom)
- OCC: 6 faces (3 per instance × 2 instances)

**Observed behavior (SolidWorks):** The *last-added* instance in SolidWorks appears to be read *first* by OCC, placing its faces at indices that align with the STEP entity indices. Therefore:
- Selecting faces on the **last-added instance** → names export correctly
- Selecting faces on earlier instances → may map to wrong/nonexistent entities

This is due to the combination of:
1. SolidWorks' STEP export ordering
2. OCC's instance expansion order
3. The direct index-based face→entity mapping

### Workarounds for Instanced Assemblies
- **Select faces on ALL instances (recommended):** Select the same face on every instance (e.g., select both pin tops). The export gracefully handles this—faces with valid entity indices get labeled, faces with out-of-range indices are silently skipped. At least one face will map correctly to the prototype's `ADVANCED_FACE` entity, which is what all instances reference.
- **Export parts separately:** Export individual parts from CAD, label them separately, then reassemble
- **Accept partial labeling:** Label what works; unlabeled faces retain their original names

### Graceful Failure for Unmapped Faces
The export code checks `if face_id < len(self.advanced_face_lines)` before attempting to label. Faces with IDs beyond the STEP entity count are silently skipped—no errors, no file corruption. This makes it safe to select faces across all instances without worrying about which one maps correctly.

### Why Automatic Instance Detection Failed
We attempted automatic instance grouping using:
1. **OCC's `IsSame()`** — Doesn't work because OCC creates independent geometry for each instance
2. **Geometric fingerprinting** — Groups faces by (surface_type, area, bbox_size), but incorrectly groups symmetric faces within the same part (e.g., both ends of a cylinder)

Proper instance handling would require parsing the STEP file's assembly structure (`MAPPED_ITEM`, `REPRESENTATION_RELATIONSHIP`) to track which OCC faces correspond to which prototype entities.

## Development

### Prerequisites
- Python 3.9+
- CadQuery (which brings OCP/OCC): `pip install cadquery`
- Flask: `pip install flask`

### Running
```bash
pip install -r requirements.txt
python app.py
# Opens browser to http://localhost:5001
```

Or with a file:
```bash
python app.py my_part.step
```

### Testing
Upload any STEP file exported from SolidWorks or other CAD tools.
Simple test: export a box with a hole from SolidWorks, load it, name faces.

## Modifying This Project

### Adding new face metadata
Edit `step_processor.py`, `_extract_face_metadata()` method. Add new properties to the face info dict. Update the frontend face list in `app.js` `updateFaceList()` to display them.

### Changing the naming convention
Edit `step_processor.py`, `export_named_step()` method. The regex pattern for name replacement is there.

### Adding new view modes
Edit `viewer.js`. The `StepViewer` class has methods like `setXray()` and `setWireframe()` as examples. Add a new method and wire it to a toolbar button in `app.js`.

### Adding new surface type filters
1. Add the type to `SURFACE_TYPE_NAMES` in `step_processor.py`
2. Add an `<option>` in `templates/index.html` under `#face-type-filter`

### Changing camera behavior
Edit `viewer.js`, `_onMouseMove()` for rotation/pan logic, `_updateCamera()` for how position is computed from quaternion.

### Changing the UI layout
Edit `templates/index.html` and `static/css/style.css`. The layout is a two-panel split: 3D viewer left, feature manager right. Tabs switch between Features and Face List panels.
