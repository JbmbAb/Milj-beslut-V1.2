import * as fs from 'fs';
import * as path from 'path';

export interface GisResult {
  hitCount: number;
  coordinates: [number, number][]; // Huvudkoordinater för intressepunkter / centroid
  calculatedAreaSqm?: number; // Beräknad polygonarea i kvadratmeter
  bufferDistances?: number[]; // Skyddszoner (t.ex. [10, 50, 100])
  metadata?: Record<string, any>;
}

export interface PdfStructure {
  pageCount: number;
  headers: string[];
  tables: { headers: string[]; rowCount: number }[];
  citations: { documentId: string; version: string; textSnippet?: string }[];
  metadata?: {
    title?: string;
    author?: string;
    keywords?: string[];
  };
}

export interface ComparisonResult {
  match: boolean;
  difference?: string;
}

const GOLDEN_MASTER_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'golden-masters');

/**
 * Hjälpmedel för att spara och jämföra resultat mot en känd fungerande "Golden Master"-referens.
 * Säkerställer funktionell ekvivalens vid refaktorering från legacy till Clean Architecture.
 */
export class GoldenMasterManager {
  constructor() {
    if (!fs.existsSync(GOLDEN_MASTER_DIR)) {
      fs.mkdirSync(GOLDEN_MASTER_DIR, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    return path.join(GOLDEN_MASTER_DIR, `${key}.json`);
  }

  /**
   * Sparar data som en ny Golden Master-referens.
   */
  saveGoldenMaster(key: string, data: any): void {
    const filePath = this.getFilePath(key);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Läser in en existerande Golden Master-referens. Returnerar null om den inte finns.
   */
  loadGoldenMaster<T = any>(key: string): T | null {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  }

  /**
   * Jämför två GIS-resultat med viss tolerans för flyttalsberäkningar.
   */
  compareGis(actual: GisResult, expected: GisResult, areaTolerancePercent = 0.5): ComparisonResult {
    if (actual.hitCount !== expected.hitCount) {
      return {
        match: false,
        difference: `Hit count mismatch: expected ${expected.hitCount}, got ${actual.hitCount}`,
      };
    }

    if (actual.coordinates.length !== expected.coordinates.length) {
      return {
        match: false,
        difference: `Coordinate count mismatch: expected ${expected.coordinates.length}, got ${actual.coordinates.length}`,
      };
    }

    // Jämför koordinater med liten precisionstolerans (t.ex. 0.00001 grader för GPS-precision)
    for (let i = 0; i < actual.coordinates.length; i++) {
      const act = actual.coordinates[i];
      const exp = expected.coordinates[i];
      const latDiff = Math.abs(act[0] - exp[0]);
      const lngDiff = Math.abs(act[1] - exp[1]);
      if (latDiff > 0.0001 || lngDiff > 0.0001) {
        return {
          match: false,
          difference: `Coordinate index ${i} mismatch: expected [${exp}], got [${act}]`,
        };
      }
    }

    // Jämför polygonareor med procentuell tolerans
    if (expected.calculatedAreaSqm !== undefined) {
      if (actual.calculatedAreaSqm === undefined) {
        return {
          match: false,
          difference: `Expected calculatedAreaSqm (${expected.calculatedAreaSqm}) but actual is missing`,
        };
      }
      const diff = Math.abs(actual.calculatedAreaSqm - expected.calculatedAreaSqm);
      const percentDiff = (diff / expected.calculatedAreaSqm) * 100;
      if (percentDiff > areaTolerancePercent) {
        return {
          match: false,
          difference: `Area mismatch: expected ${expected.calculatedAreaSqm} sqm, got ${actual.calculatedAreaSqm} sqm (difference of ${percentDiff.toFixed(2)}% exceeds tolerance of ${areaTolerancePercent}%)`,
        };
      }
    }

    // Jämför skyddsavstånd/buffer
    if (expected.bufferDistances && actual.bufferDistances) {
      if (expected.bufferDistances.length !== actual.bufferDistances.length) {
        return {
          match: false,
          difference: `Buffer distance array length mismatch`,
        };
      }
      for (let i = 0; i < expected.bufferDistances.length; i++) {
        if (expected.bufferDistances[i] !== actual.bufferDistances[i]) {
          return {
            match: false,
            difference: `Buffer distance at index ${i} mismatch: expected ${expected.bufferDistances[i]}, got ${actual.bufferDistances[i]}`,
          };
        }
      }
    }

    return { match: true };
  }

  /**
   * Jämför två PDF-strukturer för funktionell ekvivalens.
   */
  comparePdf(actual: PdfStructure, expected: PdfStructure): ComparisonResult {
    if (actual.pageCount !== expected.pageCount) {
      return {
        match: false,
        difference: `Page count mismatch: expected ${expected.pageCount}, got ${actual.pageCount}`,
      };
    }

    // Rubriker
    if (actual.headers.length !== expected.headers.length) {
      return {
        match: false,
        difference: `Header count mismatch: expected ${expected.headers.length}, got ${actual.headers.length}`,
      };
    }
    for (let i = 0; i < expected.headers.length; i++) {
      if (actual.headers[i].trim() !== expected.headers[i].trim()) {
        return {
          match: false,
          difference: `Header mismatch at index ${i}: expected "${expected.headers[i]}", got "${actual.headers[i]}"`,
        };
      }
    }

    // Tabeller
    if (actual.tables.length !== expected.tables.length) {
      return {
        match: false,
        difference: `Table count mismatch: expected ${expected.tables.length}, got ${actual.tables.length}`,
      };
    }
    for (let i = 0; i < expected.tables.length; i++) {
      const actTab = actual.tables[i];
      const expTab = expected.tables[i];
      if (actTab.rowCount !== expTab.rowCount) {
        return {
          match: false,
          difference: `Table ${i} row count mismatch: expected ${expTab.rowCount}, got ${actTab.rowCount}`,
        };
      }
    }

    // Källhänvisningar (Citations)
    if (actual.citations.length !== expected.citations.length) {
      return {
        match: false,
        difference: `Citation count mismatch: expected ${expected.citations.length}, got ${actual.citations.length}`,
      };
    }
    for (let i = 0; i < expected.citations.length; i++) {
      const actCit = actual.citations[i];
      const expCit = expected.citations[i];
      if (actCit.documentId !== expCit.documentId || actCit.version !== expCit.version) {
        return {
          match: false,
          difference: `Citation mismatch at index ${i}: expected "${expCit.documentId}" v${expCit.version}, got "${actCit.documentId}" v${actCit.version}`,
        };
      }
    }

    return { match: true };
  }
}

export const goldenMaster = new GoldenMasterManager();
