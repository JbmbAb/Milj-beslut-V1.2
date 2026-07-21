import { describe, expect, it } from 'vitest';
import {
  assertExpectedColumnsPresent,
  assertStagingQaPasses,
  EXPECTED_IMPORT_SRID,
  findMapLayerKeyForTable,
  formatPromoteAuditSummary,
  formatStagingQaSummary,
  parseOgrinfoFieldNames,
  pickBrinColumnFromNames,
  columnsForPromote,
} from '../../../scripts/import/importLibrarianQa';

describe('importLibrarianQa', () => {
  it('assertStagingQaPasses accepts valid staging stats', () => {
    expect(() =>
      assertStagingQaPasses({
        totalRows: 100,
        nullGeomRows: 0,
        invalidGeomRows: 0,
        srid: EXPECTED_IMPORT_SRID,
      }),
    ).not.toThrow();
  });

  it('assertStagingQaPasses rejects empty staging', () => {
    expect(() =>
      assertStagingQaPasses({
        totalRows: 0,
        nullGeomRows: 0,
        invalidGeomRows: 0,
        srid: EXPECTED_IMPORT_SRID,
      }),
    ).toThrow(/zero rows/);
  });

  it('assertStagingQaPasses rejects wrong SRID', () => {
    expect(() =>
      assertStagingQaPasses({
        totalRows: 10,
        nullGeomRows: 0,
        invalidGeomRows: 0,
        srid: 4326,
      }),
    ).toThrow(/SRID/);
  });

  it('assertStagingQaPasses rejects invalid geometries', () => {
    expect(() =>
      assertStagingQaPasses({
        totalRows: 10,
        nullGeomRows: 0,
        invalidGeomRows: 2,
        srid: EXPECTED_IMPORT_SRID,
      }),
    ).toThrow(/invalid geometries/);
  });

  it('formatStagingQaSummary includes phase marker', () => {
    const parsed = JSON.parse(
      formatStagingQaSummary({
        totalRows: 5,
        nullGeomRows: 0,
        invalidGeomRows: 0,
        srid: 3006,
      }),
    );
    expect(parsed.phase).toBe('staging_qa');
    expect(parsed.totalRows).toBe(5);
  });

  it('formatPromoteAuditSummary captures row delta', () => {
    const parsed = JSON.parse(
      formatPromoteAuditSummary({
        stagingRows: 1000,
        prodRowsBefore: 900,
        prodRowsAfter: 1000,
      }),
    );
    expect(parsed.deltaFromProd).toBe(100);
  });

  it('findMapLayerKeyForTable resolves known registry table', () => {
    const key = findMapLayerKeyForTable('env', 'registerenhetsomradesytor');
    expect(key).toBe('lm_fastighetsytor');
  });

  it('parseOgrinfoFieldNames reads Layer schema fields', () => {
    const stdout = `
Layer name: registerenhetsomradesyta
Geometry Column = geom
  etikett: String (0.0)
  kommunnamn: String (0.0)
  trakt: String (0.0)
`;
    expect(parseOgrinfoFieldNames(stdout)).toEqual(['etikett', 'kommunnamn', 'trakt']);
  });

  it('assertExpectedColumnsPresent fails on missing columns', () => {
    expect(() =>
      assertExpectedColumnsPresent(['etikett', 'trakt'], ['etikett', 'kommunnamn', 'trakt']),
    ).toThrow(/missing expected columns/i);
  });

  it('columnsForPromote excludes staging id (SERIAL conflict)', () => {
    expect(columnsForPromote(['id', 'geom', 'kommun_namn'], ['id', 'geom', 'kommun_namn', 'ogc_fid'])).toEqual([
      'geom',
      'kommun_namn',
    ]);
  });

  it('pickBrinColumnFromNames prefers ogc_fid then fid', () => {
    expect(pickBrinColumnFromNames(['geom', 'fid', 'etikett'])).toBe('fid');
    expect(pickBrinColumnFromNames(['geom', 'ogc_fid', 'fid'])).toBe('ogc_fid');
    expect(pickBrinColumnFromNames(['geom', 'etikett'])).toBeNull();
  });
});
