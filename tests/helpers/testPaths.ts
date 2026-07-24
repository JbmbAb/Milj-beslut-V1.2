import * as os from 'node:os';
import * as path from 'node:path';

/** Cross-platform temp directory for unit test fixtures (Linux-safe). */
export function testTmpDir(name: string): string {
  return path.join(os.tmpdir(), name);
}
