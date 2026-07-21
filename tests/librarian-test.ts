/**
 * librarian-test.ts
 *
 * Testskript för att verifiera Mimer Bibliotekarie (Librarian AI).
 * Körs med: npx vitest tests/librarian-test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { LibrarianService } from '../server/services/librarianService';
import * as vertexAi from '../server/services/vertexAiService';

vi.mock('../server/services/vertexAiService', () => ({
  generateTextWithVertex: vi.fn(),
}));

describe('Mimer Librarian Service', () => {
  it('skall planera harvesting enligt Mimers Brunn-policy', async () => {
    const mockPlan = `
[APPROVED_TO_RUN]
1. Skapa mapp: H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Data\\SGU\\Grundvatten_2026-06-07
2. Ladda ner rådata från SGU REST API.
3. Generera SHA-256 checksums.txt.

[REQUIRES_HUMAN_APPROVAL]
- Import till PostGIS-tabell core.groundwater_wells (tidsberäknat till 2 min).
    `;

    vi.mocked(vertexAi.generateTextWithVertex).mockResolvedValue(mockPlan);

    const result = await LibrarianService.planHarvesting({
      datasetName: 'Grundvattenbrunnar',
      provider: 'SGU',
      sourceUrl: 'https://resource.sgu.se/service/wfs/... ',
      format: 'WFS',
    });

    expect(result).toContain('[APPROVED_TO_RUN]');
    expect(result).toContain('H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive');
    expect(result).toContain('SHA-256');
  });

  it('skall planera diarie-integration', async () => {
    const mockDiaryPlan = `
[APPROVED_TO_RUN]
1. Analysera webbstruktur för Mariestads kommuns diarium.
2. Sätt upp bevakning för sökord 'Miljöfarlig verksamhet'.
3. Arkivera funna PDF-handlingar till H-disken.
    `;

    vi.mocked(vertexAi.generateTextWithVertex).mockResolvedValue(mockDiaryPlan);

    const result = await LibrarianService.planDiaryIntegration('Mariestads kommun', 'Västra Götaland');

    expect(result).toContain('Mariestads kommun');
    expect(result).toContain('H-disken');
  });

  it('skall planera selektiv dammsugning', async () => {
    const mockScrapingPlan = `
[APPROVED_TO_RUN]
1. Läs metadata från lmm_targets.csv.
2. Filtrera efter kriteriet 'beslutsklass: C'.
3. Ladda ner med batch-storlek 5 och 2s jitter.
    `;

    vi.mocked(vertexAi.generateTextWithVertex).mockResolvedValue(mockScrapingPlan);

    const result = await LibrarianService.planSelectiveScraping('lmm_targets.csv', 'beslutsklass: C');

    expect(result).toContain('batch-storlek 5');
    expect(result).toContain('jitter');
  });

  it('skall föreslå PostGIS-optimeringar', async () => {
    const mockReview = `
Föreslagna optimeringar för core.wells:
1. Skapa GiST-index på kolumnen geom: CREATE INDEX wells_geom_idx ON core.wells USING GIST (geom);
2. Skapa Context Bridge-vy: view_well_context_summary som kombinerar djup och jordart.
    `;

    vi.mocked(vertexAi.generateTextWithVertex).mockResolvedValue(mockReview);

    const result = await LibrarianService.reviewPostGisTable({
      tableName: 'core.wells',
      currentSchema: 'id UUID, geom GEOMETRY, depth FLOAT, soil_type TEXT',
    });

    expect(result).toContain('GIST');
    expect(result).toContain('Context Bridge');
  });
});
