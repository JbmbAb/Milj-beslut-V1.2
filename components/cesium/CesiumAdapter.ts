import {
  Cartesian3,
  Cartographic,
  Color,
  EllipsoidTerrainProvider,
  Entity,
  GeoJsonDataSource,
  ImageryLayer,
  Ion,
  Math as CesiumMath,
  OpenStreetMapImageryProvider,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { resolveCesiumBasemapChoice } from './cesiumBasemapRuntime';
import { applyCesiumIonRuntimeConfiguration } from './cesiumIonRuntime';
import { computePropertyCameraFit } from './cesiumPropertyCameraFit';

// Ensure Cesium knows where to locate assets locally
if (typeof window !== 'undefined') {
  (window as any).CESIUM_BASE_URL = '/cesium/';
}

const MIN_ZOOM_DISTANCE_METERS = 80;

export interface CesiumAdapterConfig {
  container: HTMLDivElement;
  onFeatureClick?: (properties: any) => void;
}

const DRAFT_LOCATION_MARKER_ID = 'localization-draft-marker';
const CURRENT_LOCATION_MARKER_ID = 'localization-current-marker';

export class CesiumAdapter {
  /**
   * LU-CESIUM-PROPERTY-GEOMETRY-LIFECYCLE-01. Real, reproduced-in-browser cause: React (in dev,
   * StrictMode's intentional double-invoke; in production, any re-render that changes an effect
   * dependency identity -- e.g. CesiumMapView's now-fixed unstable onFeatureClick closure) can
   * destroy() this adapter while an async setPropertyGeometry()/setEvidenceLayers() call it
   * started is still awaiting GeoJsonDataSource.load(). Cesium's own Viewer.destroy() tears down
   * the viewer's internal dataSources collection; the stale call then resumes and throws
   * "Cannot read properties of undefined (reading 'dataSources')" trying to write into it.
   *
   * This flag is checked after every await in those methods, immediately before touching
   * `this.viewer` again: a load that finishes after this adapter was destroyed is discarded
   * silently (not an error -- a newer adapter, or nothing, now owns the container), never used to
   * mutate a torn-down viewer.
   */
  private destroyed = false;
  private viewer: Viewer;
  private propertyDataSource: GeoJsonDataSource | null = null;
  private evidenceDataSource: GeoJsonDataSource | null = null;
  private clickHandler: ScreenSpaceEventHandler | null = null;
  private onFeatureClick: ((properties: any) => void) | undefined;
  /**
   * PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01. When set, LEFT_CLICK picks a WGS84 lat/lng off
   * the globe ellipsoid instead of picking an evidence feature entity -- an exclusive mode, not a
   * second independent handler, so a click during location-picking can never also fire a feature
   * click underneath it.
   */
  private onLocationPick: ((lat: number, lng: number) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingCameraFit: (() => void) | null = null;

  constructor(config: CesiumAdapterConfig) {
    applyCesiumIonRuntimeConfiguration(Ion, import.meta.env);
    const baseLayer = this.createBaseLayer();

    // Instantiate Cesium Viewer with clean, focused options (no default heavy widgets).
    // Ellipsoid terrain + OSM/local XYZ: never Ion World Imagery unless an env token is
    // explicitly opted into VITE_CESIUM_ION_IMAGERY. That is what stops api.cesium.com 401s
    // and the bundled default-token warning.
    this.viewer = new Viewer(config.container, {
      animation: false,
      timeline: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false, // We use our own sidebar/evidence panel
      sceneModePicker: false,
      selectionIndicator: true,
      navigationHelpButton: false,
      baseLayerPicker: false,
      ...(baseLayer ? { baseLayer } : {}),
      terrainProvider: new EllipsoidTerrainProvider(),
    });

    this.viewer.scene.globe.depthTestAgainstTerrain = false;
    this.viewer.scene.screenSpaceCameraController.minimumZoomDistance = MIN_ZOOM_DISTANCE_METERS;
    this.viewer.scene.requestRenderMode = false;

    // Configure camera for Sweden view default
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(15.0, 62.0, 1500000.0), // Sweden overview
    });

    this.onFeatureClick = config.onFeatureClick;
    this.setupClickHandler();
    this.observeContainerSize(config.container);
    this.resizeToContainer();
  }

  private createBaseLayer(): ImageryLayer | undefined {
    const choice = resolveCesiumBasemapChoice(import.meta.env);
    switch (choice.kind) {
      case 'ion-world-imagery':
        // Token already applied; Viewer default World Imagery uses Ion.
        return undefined;
      case 'local-xyz':
        return new ImageryLayer(
          new UrlTemplateImageryProvider({
            url: choice.url,
            credit: choice.credit,
          }),
        );
      case 'osm':
        return new ImageryLayer(
          new OpenStreetMapImageryProvider({
            url: choice.url,
          }),
        );
      default: {
        const exhaustive: never = choice;
        return exhaustive;
      }
    }
  }

  private observeContainerSize(container: HTMLDivElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeToContainer();
      this.flushPendingCameraFit();
    });
    this.resizeObserver.observe(container);
  }

  /** Public so the React wrapper can force a resize after the LU map panel becomes visible. */
  public resizeToContainer(): void {
    if (this.destroyed) return;
    this.viewer.resize();
    this.viewer.scene.requestRender();
  }

  private hasPositiveSize(): boolean {
    const container = this.viewer.container as HTMLElement;
    return container.clientWidth > 0 && container.clientHeight > 0;
  }

  private scheduleCameraFit(run: () => void): void {
    this.pendingCameraFit = run;
    this.flushPendingCameraFit();
  }

  private flushPendingCameraFit(): void {
    if (this.destroyed || !this.pendingCameraFit) return;
    this.resizeToContainer();
    if (!this.hasPositiveSize()) return;
    const run = this.pendingCameraFit;
    this.pendingCameraFit = null;
    run();
  }

  /**
   * Fit from the property GeoJSON itself. DataSource bounding-sphere flyTo uses a cartesian
   * sphere whose center is inside the ellipsoid for surface polygons — black globe, no tiles.
   */
  private fitToPropertyGeoJson(geojson: unknown): void {
    const fit = computePropertyCameraFit(geojson);
    if (!fit.ok) return;
    this.scheduleCameraFit(() => {
      if (this.destroyed) return;
      const container = this.viewer.container as HTMLElement;
      const before = this.viewer.camera.positionCartographic;
      this.viewer.camera.setView({
        destination: Cartesian3.fromDegrees(
          fit.destination.longitude,
          fit.destination.latitude,
          fit.destination.heightMeters,
        ),
        orientation: {
          heading: 0,
          pitch: CesiumMath.toRadians(-90),
          roll: 0,
        },
      });
      const after = this.viewer.camera.positionCartographic;
      console.info('[CESIUM-PROPERTY-CAMERA-FIT-01]', {
        container: { width: container.clientWidth, height: container.clientHeight },
        entityCount: this.propertyDataSource?.entities.values.length ?? 0,
        geometryTypes: fit.geometryTypes,
        finiteCoordinateCount: fit.finiteCoordinateCount,
        bbox: fit.bbox,
        cartesianSphere: fit.cartesianSphere,
        classification: fit.classification,
        destination: fit.destination,
        cameraBefore: {
          longitude: CesiumMath.toDegrees(before.longitude),
          latitude: CesiumMath.toDegrees(before.latitude),
          height: before.height,
        },
        cameraAfter: {
          longitude: CesiumMath.toDegrees(after.longitude),
          latitude: CesiumMath.toDegrees(after.latitude),
          height: after.height,
        },
        sceneMode: this.viewer.scene.mode,
        globeShow: this.viewer.scene.globe.show,
      });
      this.viewer.scene.requestRender();
    });
  }

  private setupClickHandler(): void {
    this.clickHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.clickHandler.setInputAction((click: { position: any }) => {
      if (this.onLocationPick) {
        const cartesian = this.viewer.camera.pickEllipsoid(click.position, this.viewer.scene.globe.ellipsoid);
        if (!cartesian) return; // click missed the globe (e.g. clicked the sky)
        const cartographic = Cartographic.fromCartesian(cartesian);
        const lat = CesiumMath.toDegrees(cartographic.latitude);
        const lng = CesiumMath.toDegrees(cartographic.longitude);
        this.onLocationPick(lat, lng);
        return;
      }

      if (!this.onFeatureClick) return;
      const pickedObject = this.viewer.scene.pick(click.position);
      if (pickedObject && pickedObject.id instanceof Entity) {
        const entity = pickedObject.id;
        // Check if there are GeoJSON properties on this entity
        if (entity.properties) {
          const props: Record<string, any> = {};
          entity.properties.propertyNames.forEach((name) => {
            props[name] = entity.properties[name]?.getValue();
          });
          this.onFeatureClick(props);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  /**
   * PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01. Enters/exits point-picking mode. While active,
   * LEFT_CLICK never reaches feature-click handling (see setupClickHandler) -- a user placing a
   * localization point cannot simultaneously select an evidence feature by accident.
   */
  public enableLocationPicking(onPick: (lat: number, lng: number) => void): void {
    if (this.destroyed) return;
    this.onLocationPick = onPick;
  }

  public disableLocationPicking(): void {
    if (this.destroyed) return;
    this.onLocationPick = null;
  }

  private setLocationMarker(id: string, lat: number, lng: number, color: Color, label: string): void {
    if (this.destroyed) return;
    this.viewer.entities.removeById(id);
    this.viewer.entities.add({
      id,
      position: Cartesian3.fromDegrees(lng, lat, 5.0),
      point: {
        pixelSize: 14 as any,
        color: color as any,
        outlineColor: Color.WHITE as any,
        outlineWidth: 2 as any,
        heightReference: 0 as any,
      } as any,
      properties: { title: label } as any,
    });
  }

  /** The unconfirmed, not-yet-saved point the user just clicked. */
  public setDraftLocationPoint(lat: number, lng: number): void {
    this.setLocationMarker(DRAFT_LOCATION_MARKER_ID, lat, lng, Color.YELLOW, 'Utkast: ny lokalisering');
  }

  public clearDraftLocationPoint(): void {
    if (this.destroyed) return;
    this.viewer.entities.removeById(DRAFT_LOCATION_MARKER_ID);
  }

  /** The persisted, current LocalizationGeometry point. */
  public setCurrentLocationPoint(lat: number, lng: number): void {
    this.setLocationMarker(CURRENT_LOCATION_MARKER_ID, lat, lng, Color.LIME, 'Aktuell lokalisering');
  }

  public clearCurrentLocationPoint(): void {
    if (this.destroyed) return;
    this.viewer.entities.removeById(CURRENT_LOCATION_MARKER_ID);
  }

  /**
   * Set and zoom smoothly to the property polygon geometry (WGS84 GeoJSON).
   * If geojson is missing, but fallbackCoordinates is provided, renders a beautiful fallback 3D sphere.
   */
  public async setPropertyGeometry(geojson: any, fallbackCoordinates?: [number, number] | null): Promise<void> {
    if (this.destroyed) return;
    if (this.propertyDataSource) {
      this.viewer.dataSources.remove(this.propertyDataSource);
      this.propertyDataSource = null;
    }

    // Clear any previous fallback marker
    this.viewer.entities.removeById('property-fallback-marker');

    if (!geojson) {
      if (fallbackCoordinates) {
        const [lat, lng] = fallbackCoordinates;

        // Render a beautiful fallback 3D Sphere at the center coordinates
        this.viewer.entities.add({
          id: 'property-fallback-marker',
          position: Cartesian3.fromDegrees(lng, lat, 10.0), // 10m above ellipsoid
          ellipsoid: {
            radii: new Cartesian3(15.0, 15.0, 15.0) as any, // 15m radius
            material: Color.GOLD.withAlpha(0.6) as any,
            outline: true as any,
            outlineColor: Color.DARKRED as any,
            outlineWidth: 3 as any,
          },
          properties: {
            title: 'Centroid Sfär',
            description: 'Fastigheten saknar tillgänglig polygon-geometri. Visar ungefärlig centroidsfär.',
          } as any
        });

        // Flight transition: fly to center with a 45 degree tilt looking North -- only after
        // the widget has a real size, so the destination is not computed against a 0x0 canvas.
        this.scheduleCameraFit(() => {
          this.viewer.camera.flyTo({
            destination: Cartesian3.fromDegrees(lng, lat - 0.004, 350.0), // Zoom in close from south
            orientation: {
              heading: CesiumMath.toRadians(0.0), // Look North
              pitch: CesiumMath.toRadians(-45.0), // 45 degrees tilt
              roll: 0.0,
            },
            duration: 3.0,
          });
        });
      }
      return;
    }

    try {
      const loaded = await GeoJsonDataSource.load(geojson, {
        stroke: Color.CYAN,
        fill: Color.CYAN.withAlpha(0.2),
        strokeWidth: 3,
      });
      if (this.destroyed) return; // this adapter was torn down while the load was in flight

      this.propertyDataSource = loaded;
      await this.viewer.dataSources.add(this.propertyDataSource);
      if (this.destroyed) return; // destroyed during the add() await too -- nothing left to fly to

      this.fitToPropertyGeoJson(geojson);
    } catch (err) {
      console.error('[CesiumAdapter] Failed to load property geometry:', err);
    }
  }

  /**
   * Clears all evidence entities (used for empty live responses and mode switches).
   */
  public clearEvidenceLayers(): void {
    if (this.destroyed) return;
    if (this.evidenceDataSource) {
      this.viewer.dataSources.remove(this.evidenceDataSource);
      this.evidenceDataSource = null;
    }
  }

  /**
   * Loads and displays SpatialEvidence GeoJSON (WGS84) as 2.5D volumes.
   * Returns feature count after load (0 = empty observation set).
   */
  public async setEvidenceLayers(geojson: any): Promise<number> {
    if (this.destroyed) return 0;
    this.clearEvidenceLayers();

    const features = geojson?.features;
    if (!Array.isArray(features) || features.length === 0) {
      return 0;
    }

    try {
      const loaded = await GeoJsonDataSource.load(geojson);
      if (this.destroyed) return 0; // this adapter was torn down while the load was in flight
      this.evidenceDataSource = loaded;

      const entities = this.evidenceDataSource.entities.values;
      entities.forEach((entity) => {
        const layerId = entity.properties?.layer_id?.getValue();
        let baseColor = Color.BLUE;
        let extrudeHeight = 15.0;

        if (layerId === 'ebh') {
          baseColor = Color.RED;
          extrudeHeight = 25.0;
        } else if (layerId === 'protected_area') {
          baseColor = Color.GREEN;
          extrudeHeight = 45.0;
        } else if (layerId === 'natura2000') {
          // LU-FINDING-MAP-DRILLDOWN-V1: matches CESIUM_EVIDENCE_LAYERS' '#a855f7' swatch --
          // previously fell through to the default blue, indistinguishable from water.
          baseColor = Color.fromCssColorString('#a855f7');
          extrudeHeight = 45.0;
        } else if (layerId === 'water_protection_area') {
          // Matches CESIUM_EVIDENCE_LAYERS' '#f59e0b' swatch.
          baseColor = Color.fromCssColorString('#f59e0b');
          extrudeHeight = 25.0;
        }

        if (entity.polygon) {
          entity.polygon.material = baseColor.withAlpha(0.35) as any;
          entity.polygon.outline = true as any;
          entity.polygon.outlineColor = baseColor as any;
          entity.polygon.outlineWidth = 2 as any;
          entity.polygon.extrudedHeight = extrudeHeight as any;
        } else if (entity.point) {
          const position = entity.position?.getValue(this.viewer.clock.currentTime);
          if (position) {
            entity.cylinder = {
              length: 30.0 as any,
              topRadius: 4.0 as any,
              bottomRadius: 4.0 as any,
              material: Color.CYAN.withAlpha(0.6) as any,
              outline: true as any,
              outlineColor: Color.WHITE as any,
              outlineWidth: 1 as any,
            } as any;
            entity.point = undefined;
          }
        }
      });

      await this.viewer.dataSources.add(this.evidenceDataSource);
      if (this.destroyed) return 0; // destroyed during the add() await
      return features.length;
    } catch (err) {
      console.error('[CesiumAdapter] Failed to load evidence GeoJSON:', err);
      this.clearEvidenceLayers();
      throw err;
    }
  }

  /**
   * Dynamically toggles individual evidence layers on/off.
   */
  public setLayerVisibility(visibility: Record<string, boolean>): void {
    if (this.destroyed || !this.evidenceDataSource) return;
    const entities = this.evidenceDataSource.entities.values;
    entities.forEach((entity) => {
      const layerId = entity.properties?.layer_id?.getValue();
      if (layerId && typeof visibility[layerId] === 'boolean') {
        entity.show = visibility[layerId];
      }
    });
  }

  /**
   * LU-FINDING-MAP-DRILLDOWN-V1. Locates an already-rendered evidence entity by its governed
   * cas_artifact_id (the SAME id already present in a finding's evidence_refs -- see
   * ViewerKernel.exportAsGeoJSON) among the entities setEvidenceLayers() already loaded via the
   * canonical /viewer/evidence path. Never queries anything new: this only searches evidence the
   * server has already authorized and the map has already rendered. Flies the camera to it and
   * returns its full properties (the exact same shape a manual click would produce), so the caller
   * can open EvidenceDetailsPanel through the identical existing path. Returns null, honestly, if
   * no matching entity is currently rendered (wrong project's id, evidence not yet loaded, or a
   * non-spatial evidence ref) -- never fabricates a match.
   */
  public focusEvidenceByArtifactId(artifactId: string): Record<string, unknown> | null {
    if (this.destroyed || !this.evidenceDataSource) return null;
    const entities = this.evidenceDataSource.entities.values;
    const match = entities.find((entity) => entity.properties?.cas_artifact_id?.getValue() === artifactId);
    if (!match) return null;

    this.viewer.flyTo(match, { duration: 1.5 }).catch(() => undefined);

    const props: Record<string, unknown> = {};
    if (match.properties) {
      for (const name of match.properties.propertyNames) {
        props[name] = match.properties[name]?.getValue();
      }
    }
    return props;
  }

  /** Reset camera to Sweden overview (L0 home). */
  public resetCameraOverview(): void {
    if (this.destroyed) return;
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(15.0, 62.0, 1500000.0),
      duration: 1.6,
    });
  }

  /**
   * Cleans up all Cesium viewer instances and handlers to prevent memory leaks.
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingCameraFit = null;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.clickHandler) {
      this.clickHandler.destroy();
    }
    this.viewer.destroy();
  }
}
