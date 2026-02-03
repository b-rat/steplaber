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

### Backend (Python/Flask)
- `app.py` — Main Flask application. Serves the web UI and provides REST API endpoints.
- `step_processor.py` — STEP file I/O using OCC (via CadQuery/OCP). Handles:
  - Reading STEP files and extracting topology
  - Tessellating faces to triangle meshes with face-index tracking
  - Mapping between mesh triangles and OCC TopoDS_Face objects
  - Writing named STEP files by text-replacing entity name strings
- `requirements.txt` — Python dependencies

### Frontend (HTML/JS/CSS)
- `templates/index.html` — Main page template
- `static/js/viewer.js` — Three.js 3D viewer with face selection
- `static/js/features.js` — Feature manager panel logic
- `static/js/app.js` — Application state and API communication
- `static/css/style.css` — UI styling

### API Endpoints
- `GET /` — Serve the main UI
- `POST /api/upload` — Upload a STEP file, returns tessellated mesh with face mapping
- `GET /api/faces` — Get list of all faces with geometric metadata
- `GET /api/face/<id>` — Get detail for a specific face (type, area, centroid, normal)
- `POST /api/features` — Save feature definitions (groups of named faces)
- `POST /api/export` — Export the named STEP file
- `GET /api/face/<id>/highlight` — Get highlight mesh data for a face

### Data Flow
1. User uploads STEP file → backend parses with OCC
2. Backend tessellates each face separately, tracks face_id → triangle range mapping
3. Frontend renders combined mesh, uses face_id mapping for click detection
4. User selects faces, groups them into features with names
5. On export, backend maps feature names back to STEP entity line numbers
6. Backend does text replacement on ADVANCED_FACE name fields, writes new STEP

### STEP Naming Convention
Faces are named using dot-separated `feature.sub_face` convention:
```
#452 = ADVANCED_FACE('mounting_boss.top', ...);
#453 = ADVANCED_FACE('mounting_boss.cylinder', ...);
#454 = ADVANCED_FACE('cable_slot.bottom', ...);
```
Ungrouped but named faces use just the name: `ADVANCED_FACE('datum_a', ...)`
Unnamed faces remain as the original value (usually `'NONE'` or `''`).

## Key Technical Details

### Face-Triangle Mapping
This is the most critical piece. When OCC tessellates a shape, each face produces a set of triangles. We track which triangles belong to which face using an array of face IDs parallel to the triangle array. In Three.js, raycasting returns a face index which maps back through this array to the OCC face.

### STEP Entity Matching
To write names back into the STEP file, we need to match OCC's internal TopoDS_Face objects to line numbers in the STEP text. We do this during initial parsing by walking the STEP entities alongside OCC's topology tree, matching by entity type and order.

### Face Metadata
Each face carries metadata extracted from OCC:
- `surface_type`: planar, cylindrical, conical, spherical, toroidal, bspline, other
- `area`: surface area in model units
- `centroid`: [x, y, z] center of mass
- `normal`: [x, y, z] average normal (for planar faces, exact normal)
- `bounds`: bounding box [min_x, min_y, min_z, max_x, max_y, max_z]

## Development

### Prerequisites
- Python 3.9+
- CadQuery (which brings OCP/OCC): `pip install cadquery`
- Flask: `pip install flask`

### Running
```bash
pip install -r requirements.txt
python app.py
# Opens browser to http://localhost:5000
```

### Testing
Upload any STEP file exported from SolidWorks or other CAD tools.
Simple test: export a box with a hole from SolidWorks, load it, name faces.

## Modifying This Project

### Adding new face metadata
Edit `step_processor.py`, `_extract_face_metadata()` method. Add new properties to the face info dict. Update the frontend face list in `features.js` to display them.

### Changing the naming convention
Edit `step_processor.py`, `export_named_step()` method. The regex pattern for name replacement is there.

### Adding new selection modes (section clip, transparency, hide)
These are Three.js frontend features. Edit `viewer.js`. The clipping plane uses `THREE.Plane` with a `THREE.PlaneHelper`. Transparency is per-material alpha. Hide sets face material to invisible.

### Changing the UI layout
Edit `templates/index.html` and `static/css/style.css`. The layout is a two-panel split: 3D viewer left, feature manager right.
