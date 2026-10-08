/**
 * Production wiring of the runner. It contains NO fake adapter: where an authority does not exist yet the port says so
 * (AdapterUnavailable -> exit 2) instead of answering.
 *
 * - subject, controller identity: real (git objects; clean controller checkout).
 * - evidence files: read from --evidence-dir by the CLI as the output of the adapters that produced them.
 * - policy authentication: NOT AVAILABLE. Which mechanism authenticates the policy and where the controller's trust
 *   configuration lives is the open governance question OD-15; this runner never decides it and never accepts an
 *   attestation file as proof of itself. Until OD-15 is answered every run ends NOT_EXECUTED (exit 2).
 */
import fs from 'node:fs';
import path from 'node:path';
import { controllerIdentity } from '../adapters/controller';
import { gitToplevel, subjectObservation } from '../adapters/gitObjects';
import type { CliDeps } from './cli';
import { realpathLoose } from './paths';
import { AdapterUnavailable } from './prover';

const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);

export function productionCliDeps(controllerRoot: string): CliDeps {
  return {
    readFile: (file) => fs.readFileSync(file),
    readOptionalFile: (file) => (fs.existsSync(file) ? fs.readFileSync(file) : undefined),
    writeFile: (file, bytes) => {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, bytes);
    },
    subjectToplevel: (repo) => gitToplevel(repo),
    controllerToplevel: () => gitToplevel(controllerRoot),
    samePath: (a, b) => fold(realpathLoose(a)) === fold(realpathLoose(b)),
    portsFor: ({ repo, commit }, observations) => ({
      subject: () => subjectObservation(repo, commit),
      observations,
      policyAuthentication: () => {
        throw new AdapterUnavailable('no policy-authentication adapter exists: the controller trust configuration is the open governance question OD-15, so no policy can be authenticated yet');
      },
      verifier: () => controllerIdentity(controllerRoot),
      now: () => new Date().toISOString(),
    }),
  };
}
