import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Import this BEFORE '../../server/createApp' in any test file that races on the shared
// CAS baseDir. server/routes/governance.routes.ts resolves `MIMERS_ROOT` once at module
// load time (`process.env.MIMERS_ROOT || path.resolve('.data/mimers')`); without this,
// every test file that imports createApp shares that one on-disk directory, so
// FileCASRepository.initialize()'s same-filesystem link probe races when two such test
// files run concurrently in separate worker processes (RC8-C: dbContents.test.ts and
// documentViewRoute.test.ts observed alternating EEXIST/ENOENT on the same probe path).
// A unique per-import temp dir removes the shared state instead of touching CAS semantics.
process.env.MIMERS_ROOT = mkdtempSync(join(tmpdir(), 'mimers-cas-test-'));
