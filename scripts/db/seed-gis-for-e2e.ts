import {
  applyGisTestStubs,
  ensureE2ESeedProject,
  ensureTestAdminUser,
} from '../../tests/setup/seedGisStubs.js';

await applyGisTestStubs();
await ensureTestAdminUser();
await ensureE2ESeedProject();
