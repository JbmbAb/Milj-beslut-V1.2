import { Viewer, Cartesian3, GeoJsonDataSource, Color, ScreenSpaceEventHandler, ScreenSpaceEventType, Entity, HeadingPitchRange, Math as CesiumMath } from 'cesium';

// Ensure Cesium knows where to locate assets locally
if (typeof window !== 'undefined') {
  (window as any).CESIUM_BASE_URL = '/cesium/';
}

export interface CesiumAdapterConfig {
  container: HTMLDivElement;
  onFeatureClick?: (properties: any) => void;
}

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

  constructor(config: CesiumAdapterConfig) {
    // Instantiate Cesium Viewer with clean, focused options (no default heavy widgets)
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
      terrainProvider: undefined, // flat ellipsoid terrain for minimal L0/L1
    });

    // Configure camera for Sweden view default
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(15.0, 62.0, 1500000.0), // Sweden overview
    });

    // Set up click handler for picking evidence features
    if (config.onFeatureClick) {
      this.setupClickHandler(config.onFeatureClick);
    }
  }

  private setupClickHandler(onFeatureClick: (properties: any) => void): void {
    this.clickHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.clickHandler.setInputAction((click: { position: any }) => {
      const pickedObject = this.viewer.scene.pick(click.position);
      if (pickedObject && pickedObject.id instanceof Entity) {
        const entity = pickedObject.id;
        // Check if there are GeoJSON properties on this entity
        if (entity.properties) {
          const props: Record<string, any> = {};
          entity.properties.propertyNames.forEach((name) => {
            props[name] = entity.properties[name]?.getValue();
          });
          onFeatureClick(props);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
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

        // Flight transition: fly to center with a 45 degree tilt looking North
        this.viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(lng, lat - 0.004, 350.0), // Zoom in close from south
          orientation: {
            heading: CesiumMath.toRadians(0.0), // Look North
            pitch: CesiumMath.toRadians(-45.0), // 45 degrees tilt
            roll: 0.0,
          },
          duration: 3.0,
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

      // Smooth 3-second camera flight with a 45 degree tilt from the south looking North
      const hpr = new HeadingPitchRange(
        CesiumMath.toRadians(0.0), // heading: look North
        CesiumMath.toRadians(-45.0), // pitch: look down at 45 degrees
        0.0 // auto-calculate range
      );

      this.viewer.flyTo(this.propertyDataSource, {
        duration: 3.0,
        offset: hpr,
      });
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
    if (this.clickHandler) {
      this.clickHandler.destroy();
    }
    this.viewer.destroy();
  }
}
