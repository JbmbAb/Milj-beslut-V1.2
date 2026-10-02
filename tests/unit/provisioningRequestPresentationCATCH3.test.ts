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
  it('PENDING, LEASED, COMPLETED and no request -> null; a view this process built (no failureCode field) keeps its own neutral text', () => {
    for (const status of ['PENDING', 'LEASED', 'COMPLETED']) {
      expect(presentProvisioningRequestDetail('execution-identity', { status, failureCode: null, failureDetail: RAW_DETAIL })).toBeNull();
    }
    expect(presentProvisioningRequestDetail('execution-identity', null)).toBeNull();
    expect(presentProvisioningRequestDetail('geometry-supersession', { status: 'FAILED', failureDetail: 'Bytet till den nya kontrollpunkten kunde inte begäras (tekniskt fel).' })).toBe(
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
