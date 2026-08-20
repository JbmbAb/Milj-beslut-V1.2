"""HTTP client for Mimer read-model APIs only."""

from dataclasses import dataclass
import json
from typing import Any, Mapping
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from .contracts import ReadModelFeatureCollection, parse_feature_collection


@dataclass(frozen=True)
class LayerSpec:
    catalog_key: str
    layer_id: str


PILOT_LAYERS = {
    "property": LayerSpec("postgis_property", "property"),
    "building": LayerSpec("topo10_buildings", "topo10-building"),
    "protected_nature": LayerSpec("postgis_nvr", "protected-area"),
    "natura2000": LayerSpec("natura2000_area", "natura2000-area"),
    "international_protection": LayerSpec("international_protection", "international-protection"),
    "water_protection": LayerSpec("water_protection", "water-protection"),
    "sgu_wells": LayerSpec("sgu_brunnar_postgis", "sgu-well"),
    "sgu_permeability": LayerSpec("sgu_genomslapplighet", "sgu-permeability"),
    "sgu_groundwater_magazines": LayerSpec("sgu_groundwater_magazine", "sgu-groundwater-magazine"),
    "sgu_groundwater_bodies": LayerSpec("sgu_groundwater_body", "sgu-groundwater-body"),
    "topo10_streams": LayerSpec("postgis_streams", "topo10-stream"),
}


class MimerApiClient:
    def __init__(self, base_url: str, bearer_token: str | None = None, timeout_seconds: int = 20):
        parsed = urlparse(base_url)
        if parsed.scheme not in ("https", "http") or not parsed.netloc:
            raise ValueError("MIMER_API:invalid_base_url")
        if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("MIMER_API:insecure_remote_url")
        self._base_url = base_url.rstrip("/")
        self._bearer_token = bearer_token
        self._timeout_seconds = timeout_seconds

    def fetch_catalog(self) -> Mapping[str, Any]:
        payload = self._get_json("/api/reference/map-layers")
        if not isinstance(payload, Mapping) or payload.get("ok") is not True:
            raise ValueError("MIMER_API:invalid_catalog")
        return payload

    def fetch_layer(self, spec: LayerSpec, bbox: str) -> ReadModelFeatureCollection:
        if not bbox.strip():
            raise ValueError("MIMER_API:bbox_required")
        layer = self._resolve_catalog_layer(spec)
        endpoint = layer.get("endpoint")
        if not isinstance(endpoint, str) or not endpoint.startswith("/api/"):
            raise ValueError("MIMER_API:invalid_catalog_endpoint")
        if not isinstance(layer.get("bboxRequired"), bool):
            raise ValueError("MIMER_API:invalid_catalog_bbox_contract")
        payload = self._get_json(endpoint, {"bbox": bbox})
        if not isinstance(payload, Mapping):
            raise ValueError("MIMER_API:invalid_layer_response")
        return parse_feature_collection(payload, spec.layer_id)

    def _resolve_catalog_layer(self, spec: LayerSpec) -> Mapping[str, Any]:
        catalog = self.fetch_catalog()
        layers = catalog.get("layers")
        if not isinstance(layers, list):
            raise ValueError("MIMER_API:invalid_catalog_layers")
        for layer in layers:
            if isinstance(layer, Mapping) and layer.get("key") == spec.catalog_key:
                return layer
        raise ValueError("MIMER_API:pilot_layer_not_published")

    def _get_json(self, path: str, query: Mapping[str, str] | None = None) -> Any:
        url = f"{self._base_url}{path}"
        if query:
            url = f"{url}?{urlencode(query)}"
        headers = {"Accept": "application/json"}
        if self._bearer_token:
            headers["Authorization"] = f"Bearer {self._bearer_token}"
        with urlopen(Request(url, headers=headers, method="GET"), timeout=self._timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
