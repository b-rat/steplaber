"""
STEP Labeler — Local web application for naming faces on CAD geometry.
Run with: python app.py [optional_step_file.step]
"""

import sys
import os
import json
import webbrowser
import tempfile
from pathlib import Path
from threading import Timer

from flask import Flask, render_template, request, jsonify, send_file

from step_processor import StepProcessor

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max upload

processor = StepProcessor()

# Store features state server-side
current_features = {}
upload_dir = tempfile.mkdtemp(prefix="step_labeler_")


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/upload', methods=['POST'])
def upload_step():
    """Upload and process a STEP file."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400

    ext = Path(file.filename).suffix.lower()
    if ext not in ('.step', '.stp'):
        return jsonify({"error": "File must be .step or .stp"}), 400

    # Save uploaded file
    filepath = os.path.join(upload_dir, file.filename)
    file.save(filepath)

    try:
        # Load and process
        info = processor.load_step(filepath)

        # Tessellate for 3D viewer
        mesh_data = processor.tessellate()

        # Get face metadata
        faces = processor.get_faces_metadata()

        return jsonify({
            "success": True,
            "info": info,
            "mesh": mesh_data,
            "faces": faces,
            "filename": file.filename,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/load_file', methods=['POST'])
def load_file():
    """Load a STEP file from a local path (for CLI argument)."""
    data = request.get_json()
    filepath = data.get("filepath")

    if not filepath or not os.path.exists(filepath):
        return jsonify({"error": "File not found"}), 404

    try:
        info = processor.load_step(filepath)
        mesh_data = processor.tessellate()
        faces = processor.get_faces_metadata()

        return jsonify({
            "success": True,
            "info": info,
            "mesh": mesh_data,
            "faces": faces,
            "filename": Path(filepath).name,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/faces')
def get_faces():
    """Get metadata for all faces."""
    faces = processor.get_faces_metadata()
    if not faces:
        return jsonify({"error": "No STEP file loaded"}), 400
    return jsonify({"faces": faces})


@app.route('/api/face/<int:face_id>')
def get_face(face_id):
    """Get metadata for a specific face."""
    meta = processor.get_face_metadata(face_id)
    if meta is None:
        return jsonify({"error": "Face not found"}), 404
    return jsonify(meta)


@app.route('/api/features', methods=['GET', 'POST'])
def features():
    """Get or save feature definitions."""
    global current_features

    if request.method == 'GET':
        return jsonify({"features": current_features})

    data = request.get_json()
    current_features = data.get("features", {})
    return jsonify({"success": True})


@app.route('/api/export', methods=['POST'])
def export_step():
    """Export the STEP file with named faces."""
    data = request.get_json()
    features = data.get("features", current_features)

    if not features:
        return jsonify({"error": "No features defined"}), 400

    if processor.step_content is None:
        return jsonify({"error": "No STEP file loaded"}), 400

    # Generate output filename
    original = processor.step_path
    output_name = f"{original.stem}_named{original.suffix}"
    output_path = os.path.join(upload_dir, output_name)

    try:
        result_path = processor.export_named_step(features, output_path)
        return send_file(
            result_path,
            as_attachment=True,
            download_name=output_name,
            mimetype='application/step'
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def open_browser(port):
    """Open the browser after a short delay."""
    webbrowser.open(f'http://localhost:{port}')


if __name__ == '__main__':
    port = 5000

    # Check for CLI argument: python app.py my_part.step
    initial_file = None
    if len(sys.argv) > 1:
        initial_file = os.path.abspath(sys.argv[1])
        if not os.path.exists(initial_file):
            print(f"Error: File not found: {initial_file}")
            sys.exit(1)
        print(f"Will load: {initial_file}")

    # Open browser after server starts
    Timer(1.5, open_browser, args=[port]).start()

    print(f"\n  STEP Labeler running at http://localhost:{port}")
    print(f"  Press Ctrl+C to stop\n")

    # Pass initial file path to frontend via environment
    if initial_file:
        os.environ['STEP_LABELER_INITIAL_FILE'] = initial_file

    app.run(host='localhost', port=port, debug=False)
