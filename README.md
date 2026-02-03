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
git clone <your-repo-url>
cd step-labeler

# Install dependencies (virtual environment recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run with a STEP file
python app.py my_part.step

# Or run and import via the UI
python app.py
```

The application opens in your browser at `http://localhost:5000`.

## Usage

### Loading a STEP File
- Drag and drop a `.step` or `.stp` file onto the viewer
- Or click **Import STEP** in the top bar

### Navigating the 3D View
- **Left-click drag**: Orbit/rotate
- **Right-click drag**: Orbit/rotate
- **Middle-click drag** or **Ctrl+click drag**: Pan
- **Scroll wheel**: Zoom

### Selecting Faces
- **Click** a face to select it
- **Shift+click** to add/remove faces from selection
- **Escape** to clear selection
- Click in empty space to deselect

### Creating Features
1. Select one or more faces (click + shift-click)
2. Click **Create Feature from Selection** (or press **F**)
3. Enter a snake_case name (e.g., `mounting_boss`, `cable_slot`)
4. Sub-face names are auto-generated from geometry type

### Managing Hidden Faces
- Select faces and press **H** to hide them (reveals geometry behind)
- Press **U** to unhide all faces
- Press **X** to toggle X-ray (transparency) mode

### Face List
- Switch to the **Face List** tab to see all faces with metadata
- Filter by surface type (planar, cylindrical, etc.)
- Search by face ID or feature name
- Hover over a face in the list to highlight it in the 3D view
- Click a face in the list to select it

### Exporting
- Click **Export Named STEP** to download the STEP file with embedded face names
- Names follow the convention: `feature_name.sub_face` (e.g., `mounting_boss.cylindrical`)

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
| H | Hide selected faces |
| U | Unhide all faces |
| X | Toggle X-ray mode |
| F | Create feature from selection |

## License

MIT
