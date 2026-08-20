"""The sole PyQGIS bridge. It imports QGIS only when QGIS invokes the plugin."""

import json
from typing import Any
from uuid import uuid4

from .contracts import ReadModelFeatureCollection
from .export_metadata import export_attributes


def add_read_model_layer(project: Any, collection: ReadModelFeatureCollection, label: str):
    from qgis.PyQt.QtCore import QVariant
    from qgis.core import QgsFeature, QgsField, QgsGeometry, QgsProject, QgsVectorLayer

    geometry_type = _geometry_type(collection)
    layer = QgsVectorLayer(f"{geometry_type}?crs=EPSG:4326", label, "memory")
    provider = layer.dataProvider()
    provider.addAttributes([
        QgsField("mimer_feature_ref", QVariant.String),
        QgsField("mimer_identity_json", QVariant.String),
        QgsField("mimer_export_id", QVariant.String),
        QgsField("mimer_layer_id", QVariant.String),
        QgsField("mimer_dataset_version", QVariant.String),
        QgsField("mimer_provenance_status", QVariant.String),
        QgsField("mimer_provenance_json", QVariant.String),
    ])
    layer.updateFields()

    export_id = str(uuid4())
    features = []
    for source_feature in collection.features:
        feature = QgsFeature(layer.fields())
        feature.setGeometry(QgsGeometry.fromGeoJson(json.dumps(source_feature.geometry)))
        metadata = export_attributes(collection, source_feature, export_id)
        feature.setAttributes([
            source_feature.feature_ref,
            json.dumps(source_feature.identity, sort_keys=True),
            metadata["mimer_export_id"],
            metadata["mimer_layer_id"],
            metadata["mimer_dataset_version"],
            metadata["mimer_provenance_status"],
            metadata["mimer_provenance_json"],
        ])
        features.append(feature)
    provider.addFeatures(features)
    layer.setCustomProperty("mimer.presentation_kind", "read_model")
    layer.setCustomProperty("mimer.layer_id", collection.layer_id)
    layer.setCustomProperty("mimer.provenance_status", collection.provenance_status)
    _apply_style(layer, collection.layer_id)
    group = QgsProject.instance().layerTreeRoot().findGroup("Mimer Read Models")
    if group is None:
        group = QgsProject.instance().layerTreeRoot().addGroup("Mimer Read Models")
    QgsProject.instance().addMapLayer(layer, False)
    group.addLayer(layer)
    return layer


def export_layer(layer: Any, destination: str) -> tuple[int, str]:
    from qgis.core import QgsCoordinateTransformContext, QgsVectorFileWriter

    options = QgsVectorFileWriter.SaveVectorOptions()
    options.driverName = "GPKG" if destination.lower().endswith(".gpkg") else "GeoJSON"
    options.fileEncoding = "UTF-8"
    return QgsVectorFileWriter.writeAsVectorFormatV3(layer, destination, QgsCoordinateTransformContext(), options)


def _geometry_type(collection: ReadModelFeatureCollection) -> str:
    geometry_types = {str(feature.geometry.get("type")) for feature in collection.features}
    if len(geometry_types) != 1:
        raise ValueError("MIMER_QGIS:mixed_or_missing_geometry")
    return next(iter(geometry_types))


def _apply_style(layer: Any, layer_id: str) -> None:
    from qgis.core import QgsFillSymbol

    colors = {
        "property": "#2563eb",
        "topo10-building": "#64748b",
        "protected-area": "#15803d",
        "natura2000-area": "#0f766e",
        "international-protection": "#7c3aed",
        "water-protection": "#0891b2",
        "sgu-permeability": "#a16207",
        "sgu-groundwater-magazine": "#0369a1",
        "sgu-groundwater-body": "#2563eb",
    }
    if layer.geometryType() == 2:
        layer.renderer().setSymbol(QgsFillSymbol.createSimple({"color": colors.get(layer_id, "#64748b"), "outline_color": "#1f2937"}))
        layer.triggerRepaint()
