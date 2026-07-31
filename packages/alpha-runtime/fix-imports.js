const fs = require('fs');
const dir = 'c:/miljöbeslut/packages/alpha-runtime/src/__tests__/e2e/replay';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.ts'));
for (const f of files) {
  const path = dir + '/' + f;
  let code = fs.readFileSync(path, 'utf8');
  code = code.replace(/import \{ buildPfasExecutionManifestV4 \} from "\.\.\/fixtures\/pfasManifestV4";/g, 'import { createPfasExecutionManifest } from "../../fixtures/createPfasExecutionManifest";');
  code = code.replace(/import \{ buildPfasExecutionPlanV4 \} from "\.\.\/fixtures\/pfasPlanV4";/g, 'import { createPfasDagPlan } from "../../fixtures/createPfasDagPlan";');
  code = code.replace(/import \{ DeterministicRuntimeScheduler \} from "\.\.\/\.\.\/\.\.\/runtime\/scheduler\/DeterministicRuntimeScheduler";/g, 'import { DeterministicRuntimeScheduler } from "../../../runtime/DeterministicRuntimeScheduler";');
  code = code.replace(/import \{ createArtifactFactory \} from "\.\.\/fixtures\/artifactFactoryFixture";/g, 'import { createArtifactFactory } from "../../fixtures/createArtifactFactory";');
  code = code.replace(/buildPfasExecutionManifestV4\(\)/g, 'createPfasExecutionManifest()');
  code = code.replace(/buildPfasExecutionPlanV4\(manifest\)/g, 'createPfasDagPlan(manifest)');
  fs.writeFileSync(path, code);
}
console.log('done');
