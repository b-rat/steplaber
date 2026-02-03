/**
 * STEP Labeler — Feature Manager
 * Handles feature creation, display, editing, and face-to-feature mapping.
 */

class FeatureManager {
    constructor() {
        this.features = {};        // name -> { color: [r,g,b], faces: [{face_id, sub_name}] }
        this.faceToFeature = {};   // face_id -> feature_name
        this.colorIndex = 0;
        this.onFeaturesChanged = null;
    }

    // Predefined feature colors — more saturated for visibility
    static COLORS = [
        [0.9, 0.3, 0.3],   // Red
        [0.3, 0.7, 0.3],   // Green
        [0.3, 0.5, 0.9],   // Blue
        [0.9, 0.7, 0.2],   // Yellow
        [0.8, 0.3, 0.8],   // Purple
        [0.2, 0.8, 0.8],   // Cyan
        [0.9, 0.5, 0.2],   // Orange
        [0.6, 0.8, 0.3],   // Lime
        [0.9, 0.4, 0.6],   // Pink
        [0.4, 0.6, 0.9],   // Light blue
    ];

    _nextColor() {
        const color = FeatureManager.COLORS[this.colorIndex % FeatureManager.COLORS.length];
        this.colorIndex++;
        return color;
    }

    createFeature(name, faceIds, faceMeta) {
        /**
         * Create a new feature from selected face IDs.
         * faceMeta: array of face metadata objects (used for auto sub-naming).
         */
        if (this.features[name]) {
            return { error: `Feature "${name}" already exists` };
        }

        // Validate faces aren't already in a feature
        for (const fid of faceIds) {
            if (this.faceToFeature[fid]) {
                return { error: `Face ${fid} already belongs to feature "${this.faceToFeature[fid]}"` };
            }
        }

        const color = this._nextColor();
        const faces = [];

        // Auto-generate sub-names based on surface type and count
        const typeCounts = {};
        for (const fid of faceIds) {
            const meta = faceMeta.find(m => m.id === fid);
            const type = meta ? meta.surface_type : 'face';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        }

        // Reset counts for naming
        const typeIndexes = {};
        for (const fid of faceIds) {
            const meta = faceMeta.find(m => m.id === fid);
            const type = meta ? meta.surface_type : 'face';

            let subName;
            if (faceIds.length === 1) {
                // Single face feature, no sub-name needed
                subName = null;
            } else if (typeCounts[type] === 1) {
                // Only one of this type, use type as sub-name
                subName = type;
            } else {
                // Multiple of this type, add index
                typeIndexes[type] = (typeIndexes[type] || 0) + 1;
                subName = `${type}_${typeIndexes[type]}`;
            }

            faces.push({ face_id: fid, sub_name: subName });
            this.faceToFeature[fid] = name;
        }

        this.features[name] = { color, faces };

        if (this.onFeaturesChanged) {
            this.onFeaturesChanged();
        }

        return { success: true, feature: this.features[name] };
    }

    deleteFeature(name) {
        const feature = this.features[name];
        if (!feature) return;

        for (const member of feature.faces) {
            delete this.faceToFeature[member.face_id];
        }
        delete this.features[name];

        if (this.onFeaturesChanged) {
            this.onFeaturesChanged();
        }
    }

    renameFeature(oldName, newName) {
        if (!this.features[oldName]) return { error: 'Feature not found' };
        if (this.features[newName]) return { error: 'Name already in use' };

        this.features[newName] = this.features[oldName];
        delete this.features[oldName];

        for (const member of this.features[newName].faces) {
            this.faceToFeature[member.face_id] = newName;
        }

        if (this.onFeaturesChanged) {
            this.onFeaturesChanged();
        }
        return { success: true };
    }

    renameMember(featureName, faceId, newSubName) {
        const feature = this.features[featureName];
        if (!feature) return;

        const member = feature.faces.find(m => m.face_id === faceId);
        if (member) {
            member.sub_name = newSubName || null;
        }

        if (this.onFeaturesChanged) {
            this.onFeaturesChanged();
        }
    }

    removeFaceFromFeature(featureName, faceId) {
        const feature = this.features[featureName];
        if (!feature) return;

        feature.faces = feature.faces.filter(m => m.face_id !== faceId);
        delete this.faceToFeature[faceId];

        // If feature is now empty, remove it
        if (feature.faces.length === 0) {
            delete this.features[featureName];
        }

        if (this.onFeaturesChanged) {
            this.onFeaturesChanged();
        }
    }

    getFeatureForFace(faceId) {
        return this.faceToFeature[faceId] || null;
    }

    getExportData() {
        /**
         * Return features in the format expected by the backend export endpoint.
         */
        const result = {};
        for (const [name, feature] of Object.entries(this.features)) {
            result[name] = feature.faces;
        }
        return result;
    }

    clear() {
        this.features = {};
        this.faceToFeature = {};
        this.colorIndex = 0;
    }
}
