import { startSearchWorker } from './services/searchWorker';
import { loadEnvFile } from './loadEnv';
import { createApp } from './createApp';

loadEnvFile();

const app = createApp();
const port = Number(process.env.PORT || 8787);

if (process.env.SEARCH_WORKER_ENABLED !== 'false') {
  const pollMs = Math.max(500, Number(process.env.SEARCH_WORKER_POLL_MS || 2500));
  const maxJobs = Math.max(1, Number(process.env.SEARCH_WORKER_MAX_JOBS || 3));
  startSearchWorker(pollMs, maxJobs);
}

app.listen(port, () => {
  console.info(`RiskGuard backend listening on port ${port}`);
});
