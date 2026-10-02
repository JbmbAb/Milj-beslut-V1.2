import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Import this BEFORE '../../server/createApp' in any test file that may open the durable CAS.
// server/routes/governance.routes.ts used to open `process.env.MIMERS_ROOT || path.resolve('.data/mimers')`
// once at module load; every test file importing createApp then shared that one on-disk
// directory, so FileCASRepository.initialize()'s same-filesystem link probe raced when two such
// test files ran concurrently in separate worker processes (RC8-C: dbContents.test.ts and
// documentViewRoute.test.ts observed alternating EEXIST/ENOENT on the same probe path).
// Since U30-A the routes resolve the durable root lazily and fail closed (MIMERS_ROOT_REQUIRED)
// without one, and the probe file name is unique per initialize(); a unique per-import temp root
// still keeps test files from sharing on-disk CAS state.
process.env.MIMERS_ROOT = mkdtempSync(join(tmpdir(), 'mimers-cas-test-'));
