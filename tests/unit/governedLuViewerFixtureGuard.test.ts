import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('GOVERNED-VIEWER-PROJECT-CAPABILITY-01: fixture is not a LU product workaround', () => {
  it('CesiumMapView offers fixture fallback only when there is no governed projectId', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.resolve(here, '../../components/CesiumMapView.tsx'), 'utf8');
    expect(source).toContain("mode === 'live' && !projectId");
    expect(source).toContain('Governed LU (projectId set) must fail closed');
  });

  it('LuWorkspace product path defaults to live evidence, never fixture', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.resolve(here, '../../components/app/lu/LuWorkspace.tsx'), 'utf8');
    expect(source).toContain("useState<CesiumEvidenceMode>('live')");
    expect(source).toContain('getBootstrapStatus');
  });
});
