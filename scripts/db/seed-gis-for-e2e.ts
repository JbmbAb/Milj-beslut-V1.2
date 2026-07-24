import { applyGisTestStubs, ensureTestAdminUser } from '../../tests/setup/seedGisStubs.js';

await applyGisTestStubs();
await ensureTestAdminUser();
