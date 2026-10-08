/**
 * Static adapter, the static half of the generation derivation (contract 5.3): `port.source_blob_sha1` and
 * `static_census`. The census is REUSED from packages/mps-u51-generation-absence (not duplicated), including the
 * OD-17 vendored exception, which lives in that package because its tree identity is what `accepted_verifiers` binds.
 *
 * What this does NOT produce: the entrypoint set (derived from the release composition, which is not in every
 * tree) and the boot probe (it boots real production composition roots). Those are separate adapter work; without
 * them there is no generation derivation and the proof stays NOT_EXECUTED.
 */
import {
  PORT_MODULE_PATH,
  StaticCensusAccumulator,
  iterateTreeEntries,
  type StaticCensus,
  type StaticCensusDetail,
} from '../../../mps-u51-generation-absence/src/index';
import { readBlobAtTree, gitBlobSha1 } from './gitObjects';

export interface GenerationStaticFacts {
  /** blob sha1 of LocalGenerationPort in the subject tree, or undefined when the tree has no such file */
  readonly port_source_blob_sha1: string | undefined;
  readonly static_census: StaticCensus;
  /** audit: paths and sites behind the counts, including the exempt vendored sites (never counted) */
  readonly detail: StaticCensusDetail;
}

export function deriveGenerationStaticFacts(repo: string, tree: string): GenerationStaticFacts {
  const accumulator = new StaticCensusAccumulator();
  for (const entry of iterateTreeEntries(repo, tree)) accumulator.add(entry);
  const detail = accumulator.result();
  const port = readBlobAtTree(repo, tree, PORT_MODULE_PATH);
  return {
    port_source_blob_sha1: port === undefined ? undefined : gitBlobSha1(port),
    static_census: detail.census,
    detail,
  };
}
