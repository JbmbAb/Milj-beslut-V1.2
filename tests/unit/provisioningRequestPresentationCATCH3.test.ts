// @vitest-environment node
/**
 * W-CATCH3 (owner decision 2026-10-03: old provisioning rows' raw failureDetail is sanitised at
 * PRESENTATION, never in storage; CATCH2 verifier finding 11): the geometry view shows a stored
 * identity-provisioning or geometry-supersession request by its stable failureCode -- a neutral Swedish
 * text, a retry sentence only where the code determines it -- never by its stored failureDetail.
 *
 * Pure: no database, no CAS, no environment.
 */
import { describe, expect, it } from 'vitest';
import {
  presentProvisioningRequestDetail,
  presentProvisioningRequestRetryable,
  PROCESS_BUILT_REQUEST_VIEW,
  PROVISIONING_REQUEST_FAILURE_PRESENTATION,
} from '../../server/modules/localization/provisioningRequestPresentation';
import { provisioningFailure } from '../../server/modules/localization/provisioningFailure';
import { LuReadFaultError } from '../../server/modules/localization/readFaultClassification';

const RAW = /mimer-demo|EIO|ECONNREFUSED|Prisma|SELECT|REJECT_|Artifact not found|WORM|localization-geometry-|lu-identity-|\.idx|[A-Za-z]:[\\/]/;
const UNKNOWN_IDENTITY = 'Förberedelsen av analysen för kontrollpunkten slutfördes inte (okänd felkod). Felet beskrivs inte närmare här.';
const RAW_DETAIL = "EIO: i/o error, open 'D:\\mimer-demo\\cas\\x.idx'";

describe('W-CATCH3: presentProvisioningRequestDetail', () => {
  it('every known code renders a neutral text with the lead of its kind, never the stored text', () => {
    for (const code of Object.keys(PROVISIONING_REQUEST_FAILURE_PRESENTATION)) {
      for (const kind of ['execution-identity', 'geometry-supersession'] as const) {
        const text = presentProvisioningRequestDetail(kind, { status: 'FAILED', failureCode: code, failureDetail: RAW_DETAIL });
        expect(text, code).not.toMatch(RAW);
        expect(text, code).toMatch(kind === 'execution-identity' ? /^Förberedelsen av analysen för kontrollpunkten slutfördes inte: / : /^Bytet till den nya kontrollpunkten slutfördes inte: /);
      }
    }
  });
  it('the retry sentence follows the code: true -> "kan lyckas", false -> "bestående", undetermined -> none', () => {
    const show = (failureCode: string) => presentProvisioningRequestDetail('execution-identity', { status: 'FAILED', failureCode, failureDetail: null });
    expect(show('EXISTING_ARTIFACT_READ_ERROR')).toMatch(/Ett nytt försök kan lyckas\.$/);
    expect(show('EXISTING_ARTIFACT_INTEGRITY_FAULT')).toMatch(/Felet är bestående och löses inte av ett nytt försök\.$/);
    expect(show('GEOMETRY_UNAVAILABLE_OR_TAMPERED')).not.toMatch(/försök/);
    expect(show('LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY')).toBe(
      'Förberedelsen av analysen för kontrollpunkten slutfördes inte: projektets aktuella kontrollpunkt kunde inte fastställas.',
    );
  });
  it('an unknown code, no code, a prototype key or an empty string -> the unknown text, nothing promised', () => {
    for (const failureCode of ['SOME_OLDER_CODE_V0', null, undefined, '', 'constructor', '__proto__', 'toString']) {
      expect(presentProvisioningRequestDetail('execution-identity', { status: 'FAILED', failureCode, failureDetail: RAW_DETAIL })).toBe(UNKNOWN_IDENTITY);
    }
  });
  it('PENDING, LEASED, COMPLETED and no request -> null; a view this process built (W-CATCH3-R2: marked PROCESS_BUILT_REQUEST_VIEW) keeps its own neutral text', () => {
    for (const status of ['PENDING', 'LEASED', 'COMPLETED']) {
      expect(presentProvisioningRequestDetail('execution-identity', { status, failureCode: null, failureDetail: RAW_DETAIL })).toBeNull();
    }
    expect(presentProvisioningRequestDetail('execution-identity', null)).toBeNull();
    expect(presentProvisioningRequestDetail('geometry-supersession', { status: 'FAILED', failureDetail: 'Bytet till den nya kontrollpunkten kunde inte begäras (tekniskt fel).', [PROCESS_BUILT_REQUEST_VIEW]: true })).toBe(
      'Bytet till den nya kontrollpunkten kunde inte begäras (tekniskt fel).',
    );
  });
  it('every code the shared provisioningFailure stores has its own text (a new code would fall to "okänd felkod" -- caught here)', () => {
    const none = { written: false };
    const samples: unknown[] = [
      Object.assign(new Error('EIO'), { code: 'EIO' }),
      Object.assign(new Error('x'), { name: 'CASIntegrityError' }),
      new Error('REJECT_SOMETHING'),
      new Error('WORM violation: x'),
      new Error('Artifact not found: x'),
      ...(['READ_ERROR', 'STORAGE_INTEGRITY_FAULT', 'MISSING_FROM_CAS', 'BINDING_INDEX_INCONSISTENT', 'REFUSED'] as const).flatMap((faultClass) =>
        ['viewer-capability-issuer', 'execution-identity', 'current-binding'].map(
          (subject) => new LuReadFaultError(subject, { faultClass, retryable: faultClass === 'READ_ERROR', refusalCode: null }, new Error('x')),
        ),
      ),
    ];
    for (const error of samples) {
      const { failureCode } = provisioningFailure(error, none);
      expect(presentProvisioningRequestDetail('execution-identity', { status: 'FAILED', failureCode, failureDetail: null }), failureCode).not.toBe(UNKNOWN_IDENTITY);
    }
  });
});

// W-CATCH3 mutation F3-L: a caller that hands provisioningFailure no write record (impossible from
// TypeScript, possible from plain JavaScript) is treated as "may have written" -- "Inget utfärdades."
// is never claimed without the record that proves it.
describe('W-CATCH3: provisioningFailure without a write record never claims "Inget utfärdades."', () => {
  it('no record -> the may-have-written sentence; { written: false } -> "Inget utfärdades."', () => {
    const error = Object.assign(new Error('EIO'), { code: 'EIO' });
    const without = provisioningFailure(error, undefined as never);
    expect(without.failureDetail).not.toContain('Inget utfärdades');
    expect(without.failureDetail.endsWith('Ett eller flera objekt kan ha sparats innan felet uppstod, men begäran slutfördes inte.')).toBe(true);
    expect(provisioningFailure(error, { written: false }).failureDetail.endsWith('Inget utfärdades.')).toBe(true);
  });
});

// W-CATCH3-R2 (CATCH3 verifier Low 3): a record without its own failureCode field used to pass its stored
// text through (meant for the views this process builds). Fail-closed now: only an explicitly marked
// process-built view keeps its text; anything else without its own code is "okänd felkod".
describe('W-CATCH3-R2: no own failureCode field and no process mark -> never the stored text', () => {
  it('a FAILED record without a failureCode field, or with an inherited one -> the unknown-code text', () => {
    expect(presentProvisioningRequestDetail('execution-identity', { status: 'FAILED', failureDetail: RAW_DETAIL })).toBe(UNKNOWN_IDENTITY);
    const inherited = Object.create({ failureCode: 'PROVISIONING_EXECUTION_ERROR' }) as { status: string; failureDetail: string };
    inherited.status = 'FAILED';
    inherited.failureDetail = RAW_DETAIL;
    expect(presentProvisioningRequestDetail('execution-identity', inherited)).toBe(UNKNOWN_IDENTITY);
  });
  it('a mark that is not exactly true keeps nothing', () => {
    expect(presentProvisioningRequestDetail('execution-identity', { status: 'FAILED', failureDetail: RAW_DETAIL, [PROCESS_BUILT_REQUEST_VIEW]: 'yes' as never })).toBe(UNKNOWN_IDENTITY);
  });
  it('OD-C3-2: EXISTING_ARTIFACT_REFUSED names a damaged object or a misconfigured verification key', () => {
    expect(presentProvisioningRequestDetail('geometry-supersession', { status: 'FAILED', failureCode: 'EXISTING_ARTIFACT_REFUSED', failureDetail: null })).toBe(
      'Bytet till den nya kontrollpunkten slutfördes inte: ett befintligt objekt som begäran bygger på underkändes vid verifieringen (skadat objekt eller felkonfigurerad verifieringsnyckel). Felet är bestående och löses inte av ett nytt försök.',
    );
  });
});

/**
 * W-U20CDF6 (UI1 limit 1; CATCH3 OD-C3-6: the geometry view carries `retryable` like bootstrap-status): the flag of a
 * FAILED or SUPERSEDED request, explicit, from the class -- and agreeing with the text's retry sentence wherever the
 * text makes one. null only for a request that did not fail.
 */
describe('W-U20CDF6: presentProvisioningRequestRetryable', () => {
  it('null when nothing failed; an explicit boolean for every FAILED / SUPERSEDED request', () => {
    for (const status of ['PENDING', 'LEASED', 'COMPLETED', null]) {
      expect(presentProvisioningRequestRetryable({ status, failureCode: 'EXISTING_ARTIFACT_READ_ERROR' }), String(status)).toBeNull();
    }
    expect(presentProvisioningRequestRetryable(null)).toBeNull();
    expect(presentProvisioningRequestRetryable(undefined)).toBeNull();
    for (const status of ['FAILED', 'SUPERSEDED']) {
      for (const failureCode of [...Object.keys(PROVISIONING_REQUEST_FAILURE_PRESENTATION), 'LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR', 'SOMETHING_OLDER', null, undefined]) {
        expect(typeof presentProvisioningRequestRetryable({ status, failureCode }), `${status} ${String(failureCode)}`).toBe('boolean');
      }
    }
  });

  it('a stored code: the table flag; agreeing with the text -- "kan lyckas" iff true; an undetermined code promises nothing (false)', () => {
    for (const [code, entry] of Object.entries(PROVISIONING_REQUEST_FAILURE_PRESENTATION)) {
      const flag = presentProvisioningRequestRetryable({ status: 'FAILED', failureCode: code, failureDetail: RAW_DETAIL });
      expect(flag, code).toBe(entry.retryable === true);
      const text = presentProvisioningRequestDetail('execution-identity', { status: 'FAILED', failureCode: code, failureDetail: RAW_DETAIL })!;
      expect(/Ett nytt försök kan lyckas\./.test(text), code).toBe(flag);
    }
    expect(presentProvisioningRequestRetryable({ status: 'FAILED', failureCode: 'GEOMETRY_UNAVAILABLE_OR_TAMPERED' })).toBe(false);
    expect(presentProvisioningRequestRetryable({ status: 'SUPERSEDED', failureCode: 'PREDECESSOR_NO_LONGER_CURRENT' })).toBe(false);
    expect(presentProvisioningRequestRetryable({ status: 'FAILED', failureCode: 'SOMETHING_OLDER' })).toBe(false);
    expect(presentProvisioningRequestRetryable({ status: 'FAILED' })).toBe(false);
    // An inherited code is no code (as for the text).
    expect(presentProvisioningRequestRetryable(Object.create({ failureCode: 'EXISTING_ARTIFACT_READ_ERROR' }, { status: { value: 'FAILED' } }))).toBe(false);
  });

  it('LOCALIZATION_GEOMETRY_<class>: the currentness class own flag (CURRENTNESS_RESOLUTION_ERROR yes, a refusal no, an unknown class no)', () => {
    expect(presentProvisioningRequestRetryable({ status: 'FAILED', failureCode: 'LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR' })).toBe(true);
    expect(presentProvisioningRequestRetryable({ status: 'FAILED', failureCode: 'LOCALIZATION_GEOMETRY_DERIVED_GEOMETRY_PERSISTENCE_FAILED' })).toBe(true);
    expect(presentProvisioningRequestRetryable({ status: 'FAILED', failureCode: 'LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY' })).toBe(false);
    expect(presentProvisioningRequestRetryable({ status: 'FAILED', failureCode: 'LOCALIZATION_GEOMETRY_CURRENTNESS_STORAGE_INTEGRITY_FAULT' })).toBe(false);
    expect(presentProvisioningRequestRetryable({ status: 'FAILED', failureCode: 'LOCALIZATION_GEOMETRY_NOT_A_CLASS' })).toBe(false);
  });

  it('a view this process built: its own fault class decides, and only an own `true` promises a retry', () => {
    const built = (retryable: unknown) => ({ [PROCESS_BUILT_REQUEST_VIEW]: true as const, status: 'FAILED', failureDetail: 'x', retryable: retryable as boolean });
    expect(presentProvisioningRequestRetryable(built(true))).toBe(true);
    expect(presentProvisioningRequestRetryable(built(false))).toBe(false);
    expect(presentProvisioningRequestRetryable(built(undefined))).toBe(false);
  });
});
