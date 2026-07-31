const fs = require('fs');
const dir = 'c:/miljöbeslut/packages/alpha-runtime/src/__tests__/e2e/replay';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.ts'));
for (const f of files) {
  const path = dir + '/' + f;
  let code = fs.readFileSync(path, 'utf8');
  
  if (!code.includes('DependencyResolver')) {
    code = code.replace(/import \{ DeterministicRuntimeScheduler \} from "\.\.\/\.\.\/\.\.\/runtime\/DeterministicRuntimeScheduler";/g, 
      `import { DeterministicRuntimeScheduler } from "../../../runtime/DeterministicRuntimeScheduler";
import { DependencyResolver } from "../../../runtime/DependencyResolver";
import { ExecutionContextBuilder } from "../../../runtime/ExecutionContextBuilder";
import { ArtifactMaterializer } from "../../../runtime/ArtifactMaterializer";
import { createCapabilityRegistry } from "../../fixtures/createCapabilityRegistry";`);
  }

  code = code.replace(/const scheduler = new DeterministicRuntimeScheduler\(\);\s*const artifactFactory = createArtifactFactory\(\);/g, 
    `const capabilityRegistry = createCapabilityRegistry();
    const dependencyResolver = new DependencyResolver();
    const contextBuilder = new ExecutionContextBuilder();
    const artifactFactory = createArtifactFactory();
    const materializer = new ArtifactMaterializer(artifactFactory);
    const scheduler = new DeterministicRuntimeScheduler(capabilityRegistry, dependencyResolver, contextBuilder, materializer);`);

  fs.writeFileSync(path, code);
}
console.log('done fixing scheduler instantiations');
