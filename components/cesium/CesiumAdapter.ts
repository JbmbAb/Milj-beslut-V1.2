import {
  Viewer,
  Cartesian3,
  Cartographic,
  GeoJsonDataSource,
  Color,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Entity,
  Math as CesiumMath,
  EllipsoidTerrainProvider,
  Ion,
} from 'cesium';
import {
  flyToLngLat,
  flyToPropertyDataSource,
  flyToSwedenOverview,
  setSwedenOverviewInstant,
} from './cameraHelpers';
import {
  attachLocalImagery,
  detachImagery,
  LOCAL_ORTHOPHOTO_FIXTURE,
  LOCAL_TOPOGRAPHIC_FIXTURE,
  setImageryOpacity,
  setImageryVisibility,
  type ImagerySeamHandle,
  type ImagerySeamKind,
  type LocalImageryDataset,
} from './imageryProviderSeam';
import { highlightPropertyEntity, resolvePropertyIdentity } from './propertySelection';
import {
  applyTerrainSeam,
  disableTerrain,
  type GovernedTerrainConfig,
  type TerrainSeamMode,
  type TerrainSeamState,
} from './terrainProviderSeam';
import {
  LOCAL_BUILDINGS_TILESET_FIXTURE,
  TilesetClient,
  type TilesetClientState,
  type TilesetProvenance,
} from './tilesetClient';
import { ViewportController, type ViewportRequest } from './viewportController';
import { commitViewportPropertyFeatures } from './viewportPropertyCommit';

// Ensure Cesium knows where to locate assets locally (no Ion/CDN required).
if (typeof window !== 'undefined') {
  (window as any).CESIUM_BASE_URL = '/cesium/';
  // Local-first: never rely on Cesium ion defaults for mandatory boot.
  Ion.defaultAccessToken = '';
}

export interface CesiumAdapterConfig {
  container: HTMLDivElement;
  onFeatureClick?: (properties: any) => void;
  onPropertySelect?: (identity: string, properties: Record<string, unknown>) => void;
  onViewportRequest?: (request: ViewportRequest) => void | Promise<void>;
  onViewportRejected?: (reason: string) => void;
  enableViewportLoading?: boolean;
}

const DRAFT_LOCATION_MARKER_ID = 'localization-draft-marker';
const CURRENT_LOCATION_MARKER_ID = 'localization-current-marker';
const SEARCH_RADIUS_RING_ID = 'localization-search-radius-ring';

export class CesiumAdapter {
  /**
   * LU-CESIUM-PROPERTY-GEOMETRY-LIFECYCLE-01. Guard against destroy() racing in-flight
   * GeoJsonDataSource.load() / tileset loads.
   */
  private destroyed = false;
  private viewer: Viewer;
  private propertyDataSource: GeoJsonDataSource | null = null;
  private viewportPropertyDataSource: GeoJsonDataSource | null = null;
  private evidenceDataSource: GeoJsonDataSource | null = null;
  private clickHandler: ScreenSpaceEventHandler | null = null;
  private onFeatureClick: ((properties: any) => void) | undefined;
  private onPropertySelect: ((identity: string, properties: Record<string, unknown>) => void) | undefined;
  private onLocationPick: ((lat: number, lng: number) => void) | null = null;
  private selectedPropertyIdentity: string | null = null;
  private tilesetClient: TilesetClient;
  private viewportController: ViewportController | null = null;
  private imageryHandles: Partial<Record<ImagerySeamKind, ImagerySeamHandle>> = {};
  private terrainState: TerrainSeamState | null = null;

  constructor(config: CesiumAdapterConfig) {
    // Local-first boot: no Ion/Google/Bing/OSM-remote mandatory base layer.
    this.viewer = new Viewer(config.container, {
      animation: false,
      timeline: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: true,
      navigationHelpButton: false,
      baseLayerPicker: false,
      baseLayer: false,
      terrainProvider: new EllipsoidTerrainProvider(),
      // Credit container kept so local attribution can render without remote widgets.
    });

    setSwedenOverviewInstant(this.viewer);

    this.onFeatureClick = config.onFeatureClick;
    this.onPropertySelect = config.onPropertySelect;
    this.tilesetClient = new TilesetClient(this.viewer);
    this.setupClickHandler();

    if (config.enableViewportLoading && config.onViewportRequest) {
      this.viewportController = new ViewportController(this.viewer, {
        onRequest: config.onViewportRequest,
        onRejected: config.onViewportRejected,
      });
      this.viewportController.start();
    }
  }

  private setupClickHandler(): void {
    this.clickHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.clickHandler.setInputAction((click: { position: any }) => {
      if (this.onLocationPick) {
        const cartesian = this.viewer.camera.pickEllipsoid(click.position, this.viewer.scene.globe.ellipsoid);
        if (!cartesian) return;
        const cartographic = Cartographic.fromCartesian(cartesian);
        const lat = CesiumMath.toDegrees(cartographic.latitude);
        const lng = CesiumMath.toDegrees(cartographic.longitude);
        this.onLocationPick(lat, lng);
        return;
      }

      const pickedObject = this.viewer.scene.pick(click.position);
      if (pickedObject && pickedObject.id instanceof Entity) {
        const entity = pickedObject.id;
        if (entity.properties) {
          const props: Record<string, any> = {};
          entity.properties.propertyNames.forEach((name) => {
            props[name] = entity.properties[name]?.getValue();
          });
          const identity = resolvePropertyIdentity(props, entity.id);
          if (identity && (props.sourceKey || props.feature_ref || props.designation)) {
            this.selectProperty(identity);
            this.onPropertySelect?.(identity, props);
          }
          this.onFeatureClick?.(props);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

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

  public setDraftLocationPoint(lat: number, lng: number): void {
    this.setLocationMarker(DRAFT_LOCATION_MARKER_ID, lat, lng, Color.YELLOW, 'Utkast: ny lokalisering');
  }

  public clearDraftLocationPoint(): void {
    if (this.destroyed) return;
    this.viewer.entities.removeById(DRAFT_LOCATION_MARKER_ID);
  }

  public setCurrentLocationPoint(lat: number, lng: number, label = 'Aktuell lokalisering'): void {
    this.setLocationMarker(CURRENT_LOCATION_MARKER_ID, lat, lng, Color.LIME, label);
  }

  public setSearchRadiusRing(lat: number, lng: number, radiusMeters: number): void {
    if (this.destroyed) return;
    this.viewer.entities.removeById(SEARCH_RADIUS_RING_ID);
    if (!(radiusMeters > 0)) return;
    this.viewer.entities.add({
      id: SEARCH_RADIUS_RING_ID,
      position: Cartesian3.fromDegrees(lng, lat, 0),
      ellipse: {
        semiMajorAxis: radiusMeters as any,
        semiMinorAxis: radiusMeters as any,
        height: 0 as any,
        material: Color.WHITE.withAlpha(0.05) as any,
        outline: true as any,
        outlineColor: Color.WHITE.withAlpha(0.9) as any,
      } as any,
      properties: { title: `Sökradie ${radiusMeters} m` } as any,
    });
  }

  public clearSearchRadiusRing(): void {
    if (this.destroyed) return;
    this.viewer.entities.removeById(SEARCH_RADIUS_RING_ID);
  }

  public clearCurrentLocationPoint(): void {
    if (this.destroyed) return;
    this.viewer.entities.removeById(CURRENT_LOCATION_MARKER_ID);
  }

  public async setPropertyGeometry(geojson: any, fallbackCoordinates?: [number, number] | null): Promise<void> {
    if (this.destroyed) return;
    if (this.propertyDataSource) {
      this.viewer.dataSources.remove(this.propertyDataSource);
      this.propertyDataSource = null;
    }

    this.viewer.entities.removeById('property-fallback-marker');

    if (!geojson) {
      if (fallbackCoordinates) {
        const [lat, lng] = fallbackCoordinates;
        this.viewer.entities.add({
          id: 'property-fallback-marker',
          position: Cartesian3.fromDegrees(lng, lat, 10.0),
          ellipsoid: {
            radii: new Cartesian3(15.0, 15.0, 15.0) as any,
            material: Color.GOLD.withAlpha(0.6) as any,
            outline: true as any,
            outlineColor: Color.DARKRED as any,
            outlineWidth: 3 as any,
          },
          properties: {
            title: 'Centroid Sfär',
            description: 'Fastigheten saknar tillgänglig polygon-geometri. Visar ungefärlig centroidsfär.',
          } as any,
        });
        flyToLngLat(this.viewer, lng, lat, 350, 3.0);
      }
      return;
    }

    try {
      const loaded = await GeoJsonDataSource.load(geojson, {
        stroke: Color.CYAN,
        fill: Color.CYAN.withAlpha(0.2),
        strokeWidth: 3,
      });
      if (this.destroyed) return;

      this.propertyDataSource = loaded;
      await this.viewer.dataSources.add(this.propertyDataSource);
      if (this.destroyed) return;

      flyToPropertyDataSource(this.viewer, this.propertyDataSource, 3.0);
    } catch (err) {
      console.error('[CesiumAdapter] Failed to load property geometry:', err);
      throw err;
    }
  }

  /**
   * Viewport-bounded property features from the presentation API (never a national dump).
   * Replaces previous viewport layer entities; keeps primary property geometry intact.
   *
   * `generation` is mandatory: a stale generation must never clear/replace/append the
   * viewport datasource after a newer generation became current (abort is not sufficient).
   */
  public async setViewportPropertyFeatures(geojson: any, generation: number): Promise<number> {
    const result = await commitViewportPropertyFeatures<GeoJsonDataSource>(geojson, {
      generation,
      isCurrent: (g) => this.isViewportCurrent(g),
      isDestroyed: () => this.destroyed,
      clearViewportLayer: () => {
        if (this.viewportPropertyDataSource) {
          this.viewer.dataSources.remove(this.viewportPropertyDataSource);
          this.viewportPropertyDataSource = null;
        }
      },
      loadGeoJson: (payload) =>
        GeoJsonDataSource.load(payload as any, {
          stroke: Color.CYAN.withAlpha(0.7),
          fill: Color.CYAN.withAlpha(0.12),
          strokeWidth: 2,
        }),
      attachLoaded: async (loaded) => {
        this.viewportPropertyDataSource = loaded;
        await this.viewer.dataSources.add(loaded);
        if (this.selectedPropertyIdentity && this.isViewportCurrent(generation) && !this.destroyed) {
          highlightPropertyEntity(loaded, this.selectedPropertyIdentity);
        }
      },
      discardLoaded: (loaded) => {
        try {
          if (typeof (loaded as { destroy?: () => void }).destroy === 'function') {
            (loaded as { destroy: () => void }).destroy();
          }
        } catch {
          // Best-effort discard of never-attached datasource.
        }
      },
    });

    if (!result.committed) {
      return 0;
    }
    return result.count;
  }

  public selectProperty(identity: string | null): void {
    if (this.destroyed) return;
    this.selectedPropertyIdentity = identity;
    highlightPropertyEntity(this.viewportPropertyDataSource, identity);
    highlightPropertyEntity(this.propertyDataSource, identity);
  }

  public async zoomToSelectedProperty(): Promise<void> {
    if (this.destroyed || !this.selectedPropertyIdentity) return;
    const source = this.viewportPropertyDataSource ?? this.propertyDataSource;
    if (!source) return;
    const entity = highlightPropertyEntity(source, this.selectedPropertyIdentity);
    if (entity) {
      await this.viewer.flyTo(entity, { duration: 1.5 });
    }
  }

  public clearEvidenceLayers(): void {
    if (this.destroyed) return;
    if (this.evidenceDataSource) {
      this.viewer.dataSources.remove(this.evidenceDataSource);
      this.evidenceDataSource = null;
    }
  }

  public async setEvidenceLayers(geojson: any): Promise<number> {
    if (this.destroyed) return 0;
    this.clearEvidenceLayers();

    const features = geojson?.features;
    if (!Array.isArray(features) || features.length === 0) {
      return 0;
    }

    try {
      const loaded = await GeoJsonDataSource.load(geojson);
      if (this.destroyed) return 0;
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
          baseColor = Color.fromCssColorString('#a855f7');
          extrudeHeight = 45.0;
        } else if (layerId === 'water_protection_area') {
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
      if (this.destroyed) return 0;
      return features.length;
    } catch (err) {
      console.error('[CesiumAdapter] Failed to load evidence GeoJSON:', err);
      this.clearEvidenceLayers();
      throw err;
    }
  }

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

  public resetCameraOverview(): void {
    if (this.destroyed) return;
    flyToSwedenOverview(this.viewer, 1.6);
  }

  public requestViewportNow(): void {
    this.viewportController?.requestNow();
  }

  public isViewportCurrent(generation: number): boolean {
    return this.viewportController?.isCurrent(generation) ?? false;
  }

  /** True after destroy(); stale async work must not mutate presentation. */
  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public async setImagery(kind: ImagerySeamKind, enabled: boolean, dataset?: LocalImageryDataset): Promise<void> {
    if (this.destroyed) return;
    const existing = this.imageryHandles[kind];
    if (!enabled) {
      detachImagery(this.viewer, existing ?? null);
      delete this.imageryHandles[kind];
      return;
    }
    if (existing) {
      setImageryVisibility(existing, true);
      return;
    }
    const ds = dataset ?? (kind === 'orthophoto' ? LOCAL_ORTHOPHOTO_FIXTURE : LOCAL_TOPOGRAPHIC_FIXTURE);
    this.imageryHandles[kind] = await attachLocalImagery(this.viewer, ds, 0.85);
  }

  public setImageryOpacity(kind: ImagerySeamKind, opacity: number): void {
    setImageryOpacity(this.imageryHandles[kind] ?? null, opacity);
  }

  public async setTerrain(
    mode: TerrainSeamMode | 'off',
    governed?: GovernedTerrainConfig,
  ): Promise<TerrainSeamState> {
    if (this.destroyed) {
      throw new Error('CesiumAdapter destroyed');
    }
    if (mode === 'off') {
      this.terrainState = disableTerrain(this.viewer);
      return this.terrainState;
    }
    this.terrainState = await applyTerrainSeam(this.viewer, mode, governed);
    return this.terrainState;
  }

  public getTerrainState(): TerrainSeamState | null {
    return this.terrainState;
  }

  public async loadBuildingsTileset(provenance: TilesetProvenance = LOCAL_BUILDINGS_TILESET_FIXTURE): Promise<TilesetClientState> {
    if (this.destroyed) {
      return { status: 'error', provenance, message: 'destroyed' };
    }
    return this.tilesetClient.load(provenance);
  }

  public async unloadBuildingsTileset(): Promise<void> {
    await this.tilesetClient.unload();
  }

  public setBuildingsVisible(visible: boolean): void {
    this.tilesetClient.setVisible(visible);
  }

  public async flyToBuildings(): Promise<void> {
    await this.tilesetClient.flyTo();
  }

  public getTilesetState(): TilesetClientState {
    return this.tilesetClient.getState();
  }

  /** Expose canvas for WebGL proof harnesses (never mock the viewer). */
  public getCanvas(): HTMLCanvasElement {
    return this.viewer.scene.canvas;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.viewportController?.destroy();
    this.viewportController = null;
    this.tilesetClient.destroy();
    for (const kind of Object.keys(this.imageryHandles) as ImagerySeamKind[]) {
      detachImagery(this.viewer, this.imageryHandles[kind] ?? null);
    }
    this.imageryHandles = {};
    if (this.clickHandler) {
      this.clickHandler.destroy();
    }
    this.viewer.destroy();
  }
}
