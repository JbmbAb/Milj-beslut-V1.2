import { Cesium3DTileset, type Viewer } from 'cesium';
import { flyToTileset } from './cameraHelpers';

export type TilesetProvenance = {
  readonly dataset_id: string;
  readonly source: 'fixture' | 'governed_pending';
  readonly url: string;
  readonly note: string;
};

export type TilesetClientState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly provenance: TilesetProvenance }
  | {
      readonly status: 'ready';
      readonly provenance: TilesetProvenance;
      readonly tileset: Cesium3DTileset;
    }
  | {
      readonly status: 'error';
      readonly provenance: TilesetProvenance;
      readonly message: string;
    };

export const LOCAL_BUILDINGS_TILESET_FIXTURE: TilesetProvenance = {
  dataset_id: 'cesium.fixture.buildings.3dtiles.v1',
  source: 'fixture',
  url: '/cesium/fixtures/tilesets/buildings/tileset.json',
  note: 'BUILDING CLIENT COMPLETE / REAL NATIONAL DATA PENDING',
};

/**
 * Local 3D Tiles client: load, visibility, fly-to, error, destroy/unload, replacement.
 * Provenance hook is mandatory so fixture never pretends to be national governed data.
 */
export class TilesetClient {
  private readonly viewer: Viewer;
  private tileset: Cesium3DTileset | null = null;
  private provenance: TilesetProvenance | null = null;
  private destroyed = false;
  private loadGeneration = 0;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }

  getState(): TilesetClientState {
    if (!this.provenance) return { status: 'idle' };
    if (this.tileset) {
      return { status: 'ready', provenance: this.provenance, tileset: this.tileset };
    }
    return { status: 'loading', provenance: this.provenance };
  }

  async load(provenance: TilesetProvenance): Promise<TilesetClientState> {
    if (this.destroyed) {
      return {
        status: 'error',
        provenance,
        message: 'TilesetClient destroyed',
      };
    }
    const generation = ++this.loadGeneration;
    await this.unload();
    this.provenance = provenance;
    try {
      const tileset = await Cesium3DTileset.fromUrl(provenance.url, {
        show: true,
      });
      if (this.destroyed || generation !== this.loadGeneration) {
        tileset.destroy();
        return { status: 'idle' };
      }
      this.viewer.scene.primitives.add(tileset);
      this.tileset = tileset;
      return { status: 'ready', provenance, tileset };
    } catch (err) {
      if (this.destroyed || generation !== this.loadGeneration) {
        return { status: 'idle' };
      }
      const message = err instanceof Error ? err.message : 'Tileset load failed';
      this.provenance = provenance;
      this.tileset = null;
      return { status: 'error', provenance, message };
    }
  }

  setVisible(visible: boolean): void {
    if (this.tileset) this.tileset.show = visible;
  }

  async flyTo(duration = 2.0): Promise<void> {
    if (!this.tileset) return;
    await flyToTileset(this.viewer, this.tileset, duration);
  }

  async unload(): Promise<void> {
    if (this.tileset) {
      this.viewer.scene.primitives.remove(this.tileset);
      if (!this.tileset.isDestroyed()) {
        this.tileset.destroy();
      }
      this.tileset = null;
    }
    this.provenance = null;
  }

  async replace(provenance: TilesetProvenance): Promise<TilesetClientState> {
    return this.load(provenance);
  }

  destroy(): void {
    this.destroyed = true;
    this.loadGeneration += 1;
    void this.unload();
  }
}
