# STEP Labeler

A local web application for naming faces and defining features on CAD geometry exported as STEP files.

**Purpose:** Bridge the gap between traditional CAD design and AI-driven parametric modification. Design complex parts in SolidWorks (or any CAD tool), then use STEP Labeler to attach semantic names to faces and feature groups. The resulting named STEP file can be consumed by Claude Code, CadQuery, or OCC for text-driven parametric operations.

## The Pipeline

```
SolidWorks → STEP → STEP Labeler → Named STEP → Claude Code / CadQuery / OCC
```

## Quick Start

```bash
# Clone the repo
git clone https://github.com/b-rat/steplabeler.git
cd steplabeler

# Install dependencies (virtual environment recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run with a STEP file
python app.py my_part.step

# Or run and import via the UI
python app.py
```

The application opens in your browser at `http://localhost:5001`.

## Usage

### Loading a STEP File
- Drag and drop a `.step` or `.stp` file onto the viewer
- Or click **Import STEP** in the top bar
- Or pass a file path as a command-line argument

### Navigating the 3D View
- **Left-click drag**: Orbit/rotate (trackball-style continuous rotation)
- **Right-click drag**: Orbit/rotate
- **Middle-click drag** or **Ctrl+click drag**: Pan
- **Scroll wheel**: Zoom

The viewer displays origin axes (X=red, Y=green, Z=blue) and CAD topological edges for clear geometry visualization.

### Selecting Faces
- **Click** a face to select it
- **Shift+click** to add/remove faces from selection
- **Multi-select toggle** (⊕ button): Enable to click faces without holding Shift
- **Escape** to clear selection
- Click in empty space to deselect

### Creating Features
1. Select one or more faces (click + shift-click, or use multi-select mode)
2. Click **Create Feature from Selection** (or press **F**)
3. Enter a snake_case name (e.g., `mounting_boss`, `cable_slot`)
4. Sub-face names are auto-generated from geometry type

### View Controls
- **Reset view** (⟳): Return to initial isometric view
- **Fit all** (⊞): Zoom to fit the entire model
- **X-ray mode** (◇): Toggle transparency to see through the model
- **Wireframe** (△): Toggle CAD edge display

### Face List Tab
- Switch to the **Face List** tab to see all faces with metadata
- Filter by surface type (planar, cylindrical, conical, spherical, toroidal, bspline, bezier, revolution, extrusion, offset)
- Filter by area range (min/max)
- Faces are sorted by area (largest first)
- Hover over a face in the list to highlight it in the 3D view
- Click a face in the list to select it

### Exporting
- Click **Export Named STEP** to download the STEP file with embedded face names
- Names follow the convention: `feature_name.sub_face` (e.g., `mounting_boss.cylindrical`)

## Working with Assemblies

### Single Parts and Simple Assemblies
The tool works best with single-part STEP files. Assemblies with multiple unique parts (e.g., a block and a pin) also work correctly.

### Assemblies with Instanced Parts
When an assembly contains multiple instances of the same part (e.g., two identical pins), the STEP file contains one set of face definitions that all instances reference. OCC expands these into separate faces, creating more faces than STEP entities.

**Recommended workflow:** Select the same face on ALL instances. For example, if you have two pins and want to label the top face, select both pin tops, then create the feature. The export will:
- Label faces with valid entity indices
- Silently skip faces with out-of-range indices (no errors)
- At least one face will map correctly to the prototype's `ADVANCED_FACE` entity

This is safe because the export gracefully handles unmapped faces—they're simply skipped without causing errors or file corruption.

## STEP Naming Convention

Faces are named using dot-separated feature/sub-face notation:

```
#452 = ADVANCED_FACE('mounting_boss.top', ...);
#453 = ADVANCED_FACE('mounting_boss.cylindrical', ...);
#454 = ADVANCED_FACE('cable_slot.planar_1', ...);
#455 = ADVANCED_FACE('datum_a', ...);
```

Single-face features have no sub-name. Unnamed faces retain their original value.

## Reading Named STEP Files

### In CadQuery / OCC (Python)

```python
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_LabelSequence, TDF_ChildIterator

doc = TDocStd_Document(TCollection_ExtendedString("doc"))
reader = STEPCAFControl_Reader()
reader.ReadFile("my_part_named.step")
reader.Transfer(doc)

shape_tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())

# Walk shapes and read names
labels = TDF_LabelSequence()
shape_tool.GetFreeShapes(labels)
# ... (see CLAUDE.md for full example)
```

### Simple Text Parsing

Since names are embedded as plain strings in STEP entities, you can also parse them directly:

```python
import re

with open("my_part_named.step") as f:
    content = f.read()

faces = re.findall(r"#(\d+)\s*=\s*ADVANCED_FACE\s*\(\s*'([^']*)'", content)
named_faces = {eid: name for eid, name in faces if name and name != 'NONE'}
```

## Requirements

- Python 3.9+
- CadQuery >= 2.4.0 (brings OCP/OCCT)
- Flask >= 3.0.0
- A modern web browser

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Escape | Clear selection |
| X | Toggle X-ray mode |
| F | Create feature from selection |

## Directory Structure

```
steplabeler/
├── app.py                 # Flask application and API endpoints
├── step_processor.py      # STEP file I/O using OCC/CadQuery
├── requirements.txt       # Python dependencies
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

## License

MIT
