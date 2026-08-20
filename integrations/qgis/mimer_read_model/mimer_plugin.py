"""QGIS UI shell for read-model spatial QA. Canonical LU remains intentionally locked."""

from qgis.PyQt.QtCore import QSettings
from qgis.PyQt.QtWidgets import QAction, QDockWidget, QInputDialog, QMessageBox, QTextBrowser

from .client import MimerApiClient, PILOT_LAYERS
from .qgis_bridge import add_read_model_layer, export_layer


class MimerReadModelPlugin:
    def __init__(self, iface):
        self.iface = iface
        self._actions = []
        self._panel = None

    def initGui(self):
        self._panel = QDockWidget("Mimer read-model provenance", self.iface.mainWindow())
        self._panel.setWidget(QTextBrowser())
        self.iface.addDockWidget(2, self._panel)
        for key, spec in PILOT_LAYERS.items():
            action = QAction(f"Mimer: load {key}", self.iface.mainWindow())
            action.triggered.connect(lambda _checked=False, selected=spec: self._load(selected))
            self.iface.addPluginToMenu("Mimer", action)
            self._actions.append(action)
        locked = QAction("Mimer: canonical LU assessment (locked)", self.iface.mainWindow())
        locked.setEnabled(False)
        self.iface.addPluginToMenu("Mimer", locked)
        self._actions.append(locked)
        export_action = QAction("Mimer: export selected read-model layer", self.iface.mainWindow())
        export_action.triggered.connect(self._export_selected)
        self.iface.addPluginToMenu("Mimer", export_action)
        self._actions.append(export_action)

    def unload(self):
        for action in self._actions:
            self.iface.removePluginMenu("Mimer", action)
        self._actions = []
        if self._panel is not None:
            self.iface.removeDockWidget(self._panel)
            self._panel = None

    def _load(self, spec):
        base_url, ok = QInputDialog.getText(self.iface.mainWindow(), "Mimer API", "Base URL", text=self._setting("base_url"))
        if not ok:
            return
        bbox, ok = QInputDialog.getText(self.iface.mainWindow(), "Mimer BBOX", "minLng,minLat,maxLng,maxLat")
        if not ok:
            return
        try:
            client = MimerApiClient(base_url, self._setting("bearer_token") or None)
            collection = client.fetch_layer(spec, bbox)
            layer = add_read_model_layer(None, collection, spec.catalog_key)
            self.iface.setActiveLayer(layer)
            self._show_provenance(collection)
            self._set_setting("base_url", base_url)
        except Exception as error:
            QMessageBox.critical(self.iface.mainWindow(), "Mimer read model", str(error))

    def _export_selected(self):
        layer = self.iface.activeLayer()
        if layer is None or layer.customProperty("mimer.presentation_kind") != "read_model":
            QMessageBox.warning(self.iface.mainWindow(), "Mimer export", "Select a Mimer read-model layer first.")
            return
        destination, ok = QInputDialog.getText(self.iface.mainWindow(), "Mimer export", "Destination (.gpkg or .geojson)")
        if not ok or not destination:
            return
        error, message = export_layer(layer, destination)
        if error:
            QMessageBox.critical(self.iface.mainWindow(), "Mimer export", message)

    def _show_provenance(self, collection):
        if self._panel is None:
            return
        self._panel.widget().setText(
            f"Layer: {collection.layer_id}<br>"
            f"Features: {len(collection.features)}<br>"
            f"Provenance status: {collection.provenance_status}<br>"
            "Dataset version and observed time are exported only when supplied by the read model."
        )

    def _setting(self, key):
        return QSettings().value(f"mimer_read_model/{key}", "")

    def _set_setting(self, key, value):
        QSettings().setValue(f"mimer_read_model/{key}", value)
