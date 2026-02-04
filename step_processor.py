"""
STEP file processor using OCC (via CadQuery/OCP).
Handles reading, tessellating, face metadata extraction, and named STEP export.
"""

import math
import re
import json
import numpy as np
from pathlib import Path

import cadquery as cq
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX
from OCP.GCPnts import GCPnts_TangentialDeflection
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopLoc import TopLoc_Location
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import (
    GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone,
    GeomAbs_Sphere, GeomAbs_Torus, GeomAbs_BSplineSurface,
    GeomAbs_BezierSurface, GeomAbs_SurfaceOfRevolution,
    GeomAbs_SurfaceOfExtrusion, GeomAbs_OffsetSurface
)
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.TopoDS import TopoDS


SURFACE_TYPE_NAMES = {
    GeomAbs_Plane: "planar",
    GeomAbs_Cylinder: "cylindrical",
    GeomAbs_Cone: "conical",
    GeomAbs_Sphere: "spherical",
    GeomAbs_Torus: "toroidal",
    GeomAbs_BSplineSurface: "bspline",
    GeomAbs_BezierSurface: "bezier",
    GeomAbs_SurfaceOfRevolution: "revolution",
    GeomAbs_SurfaceOfExtrusion: "extrusion",
    GeomAbs_OffsetSurface: "offset",
}


class StepProcessor:
    """Processes STEP files: read, tessellate, extract metadata, export with names."""

    def __init__(self):
        self.shape = None
        self.faces = []  # List of TopoDS_Face
        self.face_metadata = []  # List of dicts with face info
        self.step_path = None
        self.step_content = None
        self.advanced_face_lines = []  # (line_number, original_name) tuples
        self.length_unit = "units"  # Default if not detected
        self.length_scale = 1.0  # Scale factor from OCC internal units (meters) to display unit

    def load_step(self, filepath):
        """Load a STEP file and extract topology."""
        self.step_path = Path(filepath)

        # Read raw STEP content for later text manipulation
        with open(filepath, 'r') as f:
            self.step_content = f.read()

        # Parse ADVANCED_FACE entity locations in the STEP text
        self._parse_step_entities()

        # Extract length unit from STEP header
        self._parse_length_unit()

        # Load geometry via CadQuery
        result = cq.importers.importStep(str(filepath))
        self.shape = result.val()

        # Extract all faces
        self.faces = []
        explorer = TopExp_Explorer(self.shape.wrapped, TopAbs_FACE)
        while explorer.More():
            face = TopoDS.Face_s(explorer.Current())
            self.faces.append(face)
            explorer.Next()

        # Extract metadata for each face
        self.face_metadata = []
        for i, face in enumerate(self.faces):
            meta = self._extract_face_metadata(face, i)
            self.face_metadata.append(meta)

        return {
            "num_faces": len(self.faces),
            "num_step_entities": len(self.advanced_face_lines),
            "length_unit": self.length_unit,
            "length_scale": self.length_scale,
        }

    def _parse_step_entities(self):
        """Find all ADVANCED_FACE entities in the STEP text and record their positions."""
        self.advanced_face_lines = []
        pattern = re.compile(
            r"(#(\d+)\s*=\s*ADVANCED_FACE\s*\(\s*'([^']*)')",
            re.IGNORECASE
        )
        for match in pattern.finditer(self.step_content):
            entity_id = int(match.group(2))
            name = match.group(3)
            start_pos = match.start()
            self.advanced_face_lines.append({
                "entity_id": entity_id,
                "name": name,
                "start_pos": start_pos,
                "match_text": match.group(1),
            })

    def _parse_length_unit(self):
        """Extract length unit from STEP file (SI_UNIT or CONVERSION_BASED_UNIT).

        Also sets length_scale to convert from OCC internal units (mm) to display unit.
        OCC normalizes STEP geometry to millimeters regardless of the file's original units.
        """
        content = self.step_content.upper()

        # Scale factors: OCC uses millimeters internally, so these convert mm -> display unit
        scale_map = {
            "mm": 1.0,
            "cm": 0.1,
            "dm": 0.01,
            "m": 0.001,
            "km": 0.000001,
            "in": 1.0 / 25.4,  # mm to inches
            "ft": 1.0 / 304.8,  # mm to feet
            "yd": 1.0 / 914.4,  # mm to yards
            "mi": 1.0 / 1609344.0,  # mm to miles
        }

        # Check for CONVERSION_BASED_UNIT FIRST - e.g., CONVERSION_BASED_UNIT('INCH',...)
        # This takes priority because it indicates the user's intended display unit
        conv_match = re.search(r"CONVERSION_BASED_UNIT\s*\(\s*'(\w+)'", content)
        if conv_match:
            unit_name = conv_match.group(1)
            unit_map = {
                "INCH": "in",
                "FOOT": "ft",
                "YARD": "yd",
                "MILE": "mi",
            }
            self.length_unit = unit_map.get(unit_name, unit_name.lower())
            self.length_scale = scale_map.get(self.length_unit, 1.0)
            return

        # Look for SI_UNIT with length prefix - e.g., SI_UNIT(.MILLI.,.METRE.)
        si_match = re.search(r"SI_UNIT\s*\(\s*\.(\w+)\.\s*,\s*\.METRE\.\s*\)", content)
        if si_match:
            prefix = si_match.group(1)
            prefix_map = {
                "MILLI": "mm",
                "CENTI": "cm",
                "DECI": "dm",
                "KILO": "km",
            }
            self.length_unit = prefix_map.get(prefix, "m")
            self.length_scale = scale_map.get(self.length_unit, 1.0)
            return

        # Check for bare SI_UNIT($,.METRE.) - meters with no prefix
        if re.search(r"SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.\s*\)", content):
            self.length_unit = "m"
            self.length_scale = 0.001
            return

        # Default fallback - assume mm
        self.length_unit = "mm"
        self.length_scale = 1.0

    def _extract_face_metadata(self, face, face_id):
        """Extract geometric metadata from a TopoDS_Face."""
        # Surface type
        adaptor = BRepAdaptor_Surface(face)
        surface_type = SURFACE_TYPE_NAMES.get(adaptor.GetType(), "other")

        # Area
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(face, props)
        area = props.Mass()

        # Centroid
        centroid = props.CentreOfMass()
        cx, cy, cz = centroid.X(), centroid.Y(), centroid.Z()

        # Bounding box
        bbox = Bnd_Box()
        BRepBndLib.Add_s(face, bbox)
        xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()

        # Normal (average for the face, sampled at centroid UV)
        normal = [0, 0, 0]
        if surface_type == "planar":
            plane = adaptor.Plane()
            axis = plane.Axis().Direction()
            # Check face orientation
            if face.Orientation() == 1:  # TopAbs_REVERSED
                normal = [-axis.X(), -axis.Y(), -axis.Z()]
            else:
                normal = [axis.X(), axis.Y(), axis.Z()]

        # Cylinder-specific properties
        radius = None
        axis_direction = None
        axis_point = None
        arc_angle = None
        if surface_type == "cylindrical":
            cylinder = adaptor.Cylinder()
            radius = round(cylinder.Radius(), 4)
            cyl_axis = cylinder.Axis()
            axis_direction = [
                round(cyl_axis.Direction().X(), 4),
                round(cyl_axis.Direction().Y(), 4),
                round(cyl_axis.Direction().Z(), 4),
            ]
            axis_loc = cyl_axis.Location()
            axis_point = [
                round(axis_loc.X(), 4),
                round(axis_loc.Y(), 4),
                round(axis_loc.Z(), 4),
            ]
            # Arc angle from U parameter bounds (radians -> degrees)
            u_min = adaptor.FirstUParameter()
            u_max = adaptor.LastUParameter()
            arc_angle = round(math.degrees(u_max - u_min), 1)

        return {
            "id": face_id,
            "surface_type": surface_type,
            "area": round(area, 4),
            "centroid": [round(cx, 4), round(cy, 4), round(cz, 4)],
            "normal": [round(n, 4) for n in normal],
            "bounds": [
                round(xmin, 4), round(ymin, 4), round(zmin, 4),
                round(xmax, 4), round(ymax, 4), round(zmax, 4)
            ],
            "radius": radius,
            "axis_direction": axis_direction,
            "axis_point": axis_point,
            "arc_angle": arc_angle,
            "step_name": self._get_step_name(face_id),
            "name": None,
            "feature": None,
        }

    def _get_step_name(self, face_id):
        """Get the existing name from the STEP file for a face, if any."""
        if face_id < len(self.advanced_face_lines):
            name = self.advanced_face_lines[face_id]["name"]
            # Return None if name is empty or 'NONE' (common default)
            if name and name.upper() != "NONE":
                return name
        return None

    def tessellate(self, linear_deflection=0.1, angular_deflection=0.5):
        """
        Tessellate all faces and return mesh data with face-index mapping.
        Returns dict with vertices, triangles, normals, and face_ids arrays.
        """
        if self.shape is None:
            raise ValueError("No STEP file loaded")

        # Mesh the entire shape
        mesh = BRepMesh_IncrementalMesh(
            self.shape.wrapped, linear_deflection, False, angular_deflection, True
        )
        mesh.Perform()

        all_vertices = []
        all_normals = []
        all_triangles = []
        all_face_ids = []  # One entry per triangle, maps to face index
        vertex_offset = 0

        for face_id, face in enumerate(self.faces):
            location = TopLoc_Location()
            triangulation = BRep_Tool.Triangulation_s(face, location)

            if triangulation is None:
                continue

            trsf = location.Transformation()
            num_verts = triangulation.NbNodes()
            num_tris = triangulation.NbTriangles()

            # Extract vertices
            for i in range(1, num_verts + 1):
                node = triangulation.Node(i)
                node.Transform(trsf)
                all_vertices.extend([node.X(), node.Y(), node.Z()])

            # Extract normals if available
            if triangulation.HasNormals():
                for i in range(1, num_verts + 1):
                    normal = triangulation.Normal(i)
                    if face.Orientation() == 1:  # Reversed
                        all_normals.extend([-normal.X(), -normal.Y(), -normal.Z()])
                    else:
                        all_normals.extend([normal.X(), normal.Y(), normal.Z()])
            else:
                # Compute normals from triangles for this face
                # First collect all vertices for this face
                face_verts = []
                for i in range(1, num_verts + 1):
                    node = triangulation.Node(i)
                    node.Transform(trsf)
                    face_verts.append([node.X(), node.Y(), node.Z()])

                # Compute per-vertex normals by averaging adjacent triangle normals
                vertex_normals = [[0, 0, 0] for _ in range(num_verts)]
                for i in range(1, num_tris + 1):
                    tri = triangulation.Triangle(i)
                    n1, n2, n3 = tri.Get()
                    v0 = face_verts[n1 - 1]
                    v1 = face_verts[n2 - 1]
                    v2 = face_verts[n3 - 1]
                    # Compute triangle normal
                    e1 = [v1[j] - v0[j] for j in range(3)]
                    e2 = [v2[j] - v0[j] for j in range(3)]
                    n = [
                        e1[1] * e2[2] - e1[2] * e2[1],
                        e1[2] * e2[0] - e1[0] * e2[2],
                        e1[0] * e2[1] - e1[1] * e2[0],
                    ]
                    # Accumulate to each vertex
                    for idx in [n1 - 1, n2 - 1, n3 - 1]:
                        vertex_normals[idx] = [vertex_normals[idx][j] + n[j] for j in range(3)]

                # Normalize and add
                for vn in vertex_normals:
                    length = (vn[0]**2 + vn[1]**2 + vn[2]**2) ** 0.5
                    if length > 0:
                        vn = [vn[j] / length for j in range(3)]
                    else:
                        vn = [0, 0, 1]  # Fallback
                    if face.Orientation() == 1:  # Reversed
                        all_normals.extend([-vn[0], -vn[1], -vn[2]])
                    else:
                        all_normals.extend(vn)

            # Extract triangles with correct winding
            for i in range(1, num_tris + 1):
                tri = triangulation.Triangle(i)
                n1, n2, n3 = tri.Get()
                # Adjust for face orientation
                if face.Orientation() == 1:  # Reversed
                    all_triangles.extend([
                        n1 - 1 + vertex_offset,
                        n3 - 1 + vertex_offset,
                        n2 - 1 + vertex_offset,
                    ])
                else:
                    all_triangles.extend([
                        n1 - 1 + vertex_offset,
                        n2 - 1 + vertex_offset,
                        n3 - 1 + vertex_offset,
                    ])
                all_face_ids.append(face_id)

            vertex_offset += num_verts

        # Extract topological edges
        edge_vertices = []
        edge_explorer = TopExp_Explorer(self.shape.wrapped, TopAbs_EDGE)
        while edge_explorer.More():
            edge = TopoDS.Edge_s(edge_explorer.Current())
            try:
                curve = BRepAdaptor_Curve(edge)
                # Discretize the edge curve
                discretizer = GCPnts_TangentialDeflection(
                    curve, angular_deflection, linear_deflection
                )
                num_points = discretizer.NbPoints()
                if num_points >= 2:
                    for i in range(1, num_points):
                        p1 = discretizer.Value(i)
                        p2 = discretizer.Value(i + 1)
                        edge_vertices.extend([
                            p1.X(), p1.Y(), p1.Z(),
                            p2.X(), p2.Y(), p2.Z()
                        ])
            except Exception:
                pass  # Skip edges that can't be discretized
            edge_explorer.Next()

        return {
            "vertices": all_vertices,
            "normals": all_normals,
            "triangles": all_triangles,
            "face_ids": all_face_ids,
            "num_faces": len(self.faces),
            "edges": edge_vertices,
        }

    def get_faces_metadata(self):
        """Return metadata for all faces."""
        return self.face_metadata

    def get_face_metadata(self, face_id):
        """Return metadata for a specific face."""
        if 0 <= face_id < len(self.face_metadata):
            return self.face_metadata[face_id]
        return None

    def export_named_step(self, features, output_path):
        """
        Export STEP file with named ADVANCED_FACE entities.

        features: dict of feature_name -> list of {face_id, sub_name} entries
            Example: {
                "mounting_boss": [
                    {"face_id": 3, "sub_name": "top"},
                    {"face_id": 4, "sub_name": "cylinder"},
                ],
                "datum_a": [
                    {"face_id": 0, "sub_name": None},
                ],
            }
        """
        if self.step_content is None:
            raise ValueError("No STEP file loaded")

        # Build face_id -> name mapping
        face_name_map = {}
        for feature_name, members in features.items():
            for member in members:
                face_id = member["face_id"]
                sub_name = member.get("sub_name")
                if sub_name:
                    full_name = f"{feature_name}.{sub_name}"
                else:
                    full_name = feature_name
                face_name_map[face_id] = full_name

        # Match face indices to STEP entity indices
        # OCC reads faces in the same order as ADVANCED_FACE entities appear in STEP
        # This mapping is the critical bridge
        content = self.step_content

        # Replace names in reverse order to preserve positions
        replacements = []
        for face_id, name in face_name_map.items():
            if face_id < len(self.advanced_face_lines):
                entity = self.advanced_face_lines[face_id]
                old_text = entity["match_text"]
                # Build new text with the name replaced
                new_text = re.sub(
                    r"'[^']*'",
                    f"'{name}'",
                    old_text,
                    count=1
                )
                replacements.append((entity["start_pos"], old_text, new_text))

        # Sort by position descending so replacements don't shift positions
        replacements.sort(key=lambda x: x[0], reverse=True)

        for pos, old_text, new_text in replacements:
            content = content[:pos] + new_text + content[pos + len(old_text):]

        # Write output
        output_path = Path(output_path)
        with open(output_path, 'w') as f:
            f.write(content)

        return str(output_path)
