import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  LuClientError,
  describeBootstrapFailure,
  isNoCurrentAssessmentError,
  presentBootstrapFailure,
  presentCurrentnessFailureClass,
  presentLuError,
  presentLuRunReason,
} from '../../components/app/lu/luErrorPresentation';
import { LuErrorNotice } from '../../components/app/lu/LuErrorNotice';
import { presentLuOverallStatement } from '../../components/app/lu/luOverallStatement';

// DEMO M2b item 3. Pure mapping + one tiny component. No network, no database.
const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });

describe('DEMO M2b presentLuError', () => {
  it.each([
    [httpError(424, 'Governed LU assessment failed tamper verification.'), 'current-assessment', 'INTEGRITY', 'klarade inte integritetskontrollen'],
    [httpError(424, 'Governed LU assessment is not bound to this project.'), 'current-assessment', 'INTEGRITY', 'hör till det här projektet'],
    [httpError(424, 'REJECT_LOCALIZATION_PRESENTATION: assessment canonical_body_hash'), 'viewer-evidence', 'INTEGRITY', 'Kontrollunderlaget klarade inte integritetskontrollen'],
    [httpError(404, 'Governed viewer capability is not configured for this project.'), 'viewer-evidence', 'TECHNICAL', 'Kartvisningen för projektet är inte förberedd ännu'],
    [httpError(403, 'Not authorized for this project.'), 'verify', 'UNAUTHORIZED', 'Du saknar behörighet till det här projektet.'],
    [httpError(401, 'Unauthorized'), 'export', 'UNAUTHORIZED', 'Sessionen har gått ut'],
    [httpError(500, 'Cannot read properties of undefined'), 'run', 'TECHNICAL', 'Bedömningen kunde inte köras. Ett tekniskt fel uppstod på servern.'],
    // W-M2e item 1-2 (M2d verification finding 1): a 424 without a code of its own names no cause --
    // this one is a contract-version failure, which the old text called an identity mismatch.
    [httpError(424, 'Unsupported assessment contract version 9'), 'current-assessment', 'INTEGRITY', 'Underlaget kunde inte bekräftas och visas därför inte.'],
    [new TypeError('Failed to fetch'), 'viewer-evidence', 'TECHNICAL', 'Servern kunde inte nås eller svarade oväntat.'],
    [httpError(503, 'Otillräcklig datakvalitet för plats site-1 i strikt läge.', { code: 'LOCALIZATION_DATA_UNAVAILABLE' }), 'run', 'TECHNICAL', 'För många datakällor var otillgängliga'],
  ] as const)('%s (%s) -> %s, plain Swedish main text', (err, context, kind, text) => {
    const p = presentLuError(err, context);
    expect(p.kind).toBe(kind);
    expect(p.messageSv).toContain(text);
    // The raw server/JS text is never the main text ...
    expect(p.messageSv).not.toContain((err as Error).message);
    // ... it is kept for the collapsed technical section.
    expect(p.technical.map((r) => r.value)).toContain((err as Error).message);
  });

  it('a currentness failure is shown per failure class in this UI\'s Swedish (W-M2d item 5); the server\'s text and codes stay technical', () => {
    const err = httpError(409, 'Projektet har flera möjliga aktuella lokaliseringspunkter. Ingen bedömning görs förrän det är utrett vilken punkt som gäller.', {
      code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY',
      reasonCode: 'LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY',
    });
    const p = presentLuError(err, 'run');
    expect(p.kind).toBe('REFUSED');
    expect(p.retryable).toBe(false);
    expect(p.messageSv).toBe('Projektet har flera möjliga aktuella kontrollpunkter. Ingen bedömning görs förrän det är utrett vilken punkt som gäller.');
    expect(p.technical).toContainEqual({ label: 'Serverns meddelande', value: err.message });
    expect(p.technical).toContainEqual({ label: 'Felklass', value: 'AMBIGUOUS_CURRENT_GEOMETRY' });
    expect(p.technical).toContainEqual({ label: 'Orsakskod', value: 'LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY' });
    // A class this UI does not know falls back to the status: a 503 is never a refusal.
    const technical = presentLuError({ ...err, message: err.message, failureClass: 'SOME_NEW_CLASS', status: 503 } as unknown, 'run');
    expect(technical.kind).not.toBe('REFUSED');
    expect(technical.messageSv).toBe('Kontrollpunkten kunde inte fastställas. Ingen bedömning görs.');
  });

  it('only the server\'s exact 404 text means "no current assessment"; any other 404 is not read as absence', () => {
    expect(isNoCurrentAssessmentError(new Error('No current governed LU assessment is available for this project.'))).toBe(true);
    expect(isNoCurrentAssessmentError(httpError(404, 'Cannot GET /api/localization/x/current-assessment'))).toBe(false);
    expect(presentLuError(httpError(404, 'No current governed LU assessment is available for this project.'), 'export').messageSv).toBe(
      'Det finns ingen sparad bedömning att exportera.',
    );
  });

  it('M2c item 3: a 404 from the control results while an assessment IS shown is never "ingen sparad bedömning", and can be retried', () => {
    // viewer-evidence is only fetched for a displayed assessment, so any 404 there contradicts the view.
    for (const err of [
      httpError(404, 'No current governed LU assessment is available for this project.'), // probe D
      httpError(404, 'Viewer capability not configured.'), // probe C: a reworded capability text
      httpError(404, 'Cannot GET /api/localization/x/viewer/evidence'),
    ]) {
      const p = presentLuError(err, 'viewer-evidence');
      expect(p.kind).toBe('INCOHERENT');
      expect(p.retryable).toBe(true);
      expect(p.messageSv).not.toMatch(/ingen sparad bedömning/i);
      expect(p.messageSv).toContain('Kontrollresultaten kunde inte hämtas');
      expect(p.messageSv).not.toContain(err.message);
    }
    expect(presentLuError(httpError(404, 'No current governed LU assessment is available for this project.'), 'viewer-evidence').messageSv).toBe(
      // W-M2d item 1: the viewer evidence feeds only the map.
      'Kontrollresultaten kunde inte hämtas till kartan: servern anger att projektet inte längre har någon aktuell bedömning, men en bedömning visas här. Läs in bedömningen på nytt.',
    );
  });

  it('M2c item 3: a status the mapping does not know (e.g. 422) says the server answered -- never "kunde inte nås"', () => {
    const p = presentLuError(httpError(422, 'Unprocessable'), 'viewer-evidence');
    expect(p.kind).toBe('TECHNICAL');
    expect(p.messageSv).toBe('Kontrollresultaten kunde inte hämtas till kartan. Servern svarade med ett oväntat fel.');
    expect(p.messageSv).not.toMatch(/kunde inte nås/);
    expect(p.technical).toContainEqual({ label: 'HTTP-status', value: '422' });
  });

  // -----------------------------------------------------------------------------------------------
  // W-M2d item 5: whether "Försök igen" is offered is the SERVER's `retryable` flag (never the HTTP
  // status); configuration errors, lasting integrity errors and refusals never offer it. Every code the
  // server can send has a Swedish main text -- no raw code, no English.
  // -----------------------------------------------------------------------------------------------
  const currentness = (failureClass: string, status: number, retryable: boolean, message = 'serverns egen text') =>
    httpError(status, message, {
      code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass,
      reasonCode: `LOCALIZATION_GEOMETRY_${failureClass}`,
      retryable,
    });

  it.each([
    // [error, context, kind, retryable, Swedish text]
    [currentness('VERIFIER_CONFIGURATION', 503, false), 'current-assessment', 'TECHNICAL', false, 'konfigurationsfel'],
    [currentness('CURRENTNESS_STORAGE_INTEGRITY_FAULT', 503, false), 'run', 'INTEGRITY', false, 'bestående lagringsfel'],
    [currentness('CURRENTNESS_RESOLUTION_ERROR', 503, true), 'geometry-load', 'TECHNICAL', true, 'tekniskt fel'],
    [currentness('DERIVED_GEOMETRY_PERSISTENCE_FAILED', 503, true), 'geometry-load', 'TECHNICAL', true, 'kunde inte sparas'],
    [currentness('AMBIGUOUS_CURRENT_GEOMETRY', 409, false), 'run', 'REFUSED', false, 'flera möjliga aktuella kontrollpunkter'],
    [currentness('INVALID_SUPERSESSION_GRAPH', 409, false), 'run', 'REFUSED', false, 'inkonsekvent'],
    [currentness('NO_VERIFIED_GEOMETRY_CANDIDATE', 409, false), 'run', 'REFUSED', false, 'kunde inte bekräftas mot arkivet'],
    [currentness('CURRENT_GEOMETRY_UNVERIFIED', 409, false), 'current-assessment', 'REFUSED', false, 'kunde inte bekräftas'],
    [currentness('INVALID_GEOMETRY_HEAD', 409, false), 'run', 'REFUSED', false, 'ogiltig'],
    [
      httpError(424, 'Bedömningens lokaliseringspunkt (x) kunde inte verifieras (LOCALIZATION_GEOMETRY_MISSING). Bedömningen visas inte.', {
        code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED',
        failureClass: 'LOCALIZATION_GEOMETRY_MISSING',
      }),
      'current-assessment',
      'INTEGRITY',
      false,
      'Bedömningens kontrollpunkt saknas i arkivet',
    ],
    [
      // W-UI1 (owner decision 2): "Försök igen" only when the server says retryable -- this answer says so.
      httpError(503, 'Bedömningens lokaliseringspunkt (x) kunde inte verifieras (LOCALIZATION_GEOMETRY_READ_ERROR). Bedömningen visas inte.', {
        code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED',
        failureClass: 'LOCALIZATION_GEOMETRY_READ_ERROR',
        retryable: true,
      }),
      'current-assessment',
      'TECHNICAL',
      true,
      'kunde inte läsas',
    ],
    [
      httpError(424, 'Bedömningens underlag klarade inte integritetskontrollen (EVIDENCE_TAMPERED: e1). Bedömningen visas inte.', {
        code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED',
        failureClass: 'EVIDENCE_TAMPERED',
      }),
      'current-assessment',
      'INTEGRITY',
      false,
      'Bedömningens underlag klarade inte integritetskontrollen',
    ],
    [
      httpError(409, 'Den begärda bedömningen är inte projektets aktuella styrda bedömning.', {
        code: 'ASSESSMENT_ID_MISMATCH',
        failureClass: 'ASSESSMENT_NOT_CURRENT',
      }),
      'export',
      'INCOHERENT',
      false,
      'inte längre projektets aktuella bedömning',
    ],
    [httpError(400, 'assessmentArtifactId must be a single artifact id.', { code: 'INVALID_ASSESSMENT_ARTIFACT_ID' }), 'verify', 'TECHNICAL', false, 'ogiltigt bedömnings-id'],
    // W-UI1: no server flag -> no "Försök igen" (the text still says a new attempt can help; the server did not).
    [httpError(503, 'storage', { code: 'LU_REEXECUTION_STORAGE_FAULT', stage: 'execution_outcome' }), 'verify', 'TECHNICAL', false, 'lagrade artefakter'],
    [httpError(503, 'storage', { code: 'LU_REEXECUTION_STORAGE_FAULT', stage: 'execution_outcome', retryable: true }), 'verify', 'TECHNICAL', true, 'lagrade artefakter'],
    [httpError(503, 'Live Lantmäteriet-uppslag är avstängt.', { code: 'LIVE_LANTMATERIET_DISABLED' }), 'property-lookup', 'TECHNICAL', false, 'lokala fastighetsunderlaget'],
    [httpError(404, 'Fastighet hittades inte i lokalt PostGIS-arkiv.', { code: 'LOCAL_PROPERTY_NOT_FOUND' }), 'property-lookup', 'NOT_FOUND', false, 'hittades inte i fastighetsunderlaget'],
  ] as const)('%s (%s) -> %s, retryable %s', (err, context, kind, retryable, text) => {
    const p = presentLuError(err, context);
    expect(p.kind).toBe(kind);
    expect(p.retryable).toBe(retryable);
    expect(p.messageSv).toContain(text);
    // No raw code or server text in the main text; the codes stay in the technical rows.
    expect(p.messageSv).not.toContain((err as Error).message);
    expect(p.messageSv).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
    expect(p.technical.map((r) => r.value)).toContain((err as unknown as { code: string }).code);
  });

  it('items 2+5 (U20CDF2 add-ons 1-2, W-APR): an unreadable assessment is a technical/integrity state with the server\'s retry flag -- never "no assessment", never "aldrig"', () => {
    const read = (failureClass: string, retryable: boolean, reasonCode = failureClass) =>
      presentLuError(
        httpError(503, 'Projektets aktuella bedömning kan inte fastställas ... En äldre bedömning visas aldrig i stället.', {
          code: 'ASSESSMENT_READ_ERROR',
          failureClass,
          reasonCode,
          retryable,
        }),
        'current-assessment',
      );
    const transient = read('ASSESSMENT_READ_ERROR', true, 'CURRENT_ASSESSMENT_CANDIDATE_READ_ERROR');
    expect(transient.kind).toBe('TECHNICAL');
    expect(transient.retryable).toBe(true);
    expect(transient.messageSv).toContain('kunde inte läsas på grund av ett tekniskt fel');
    const lasting = read('ASSESSMENT_STORAGE_INTEGRITY_FAULT', false, 'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT');
    expect(lasting.kind).toBe('INTEGRITY');
    expect(lasting.retryable).toBe(false);
    expect(lasting.messageSv).toContain('bestående');
    const resolution = read('ASSESSMENT_RESOLUTION_ERROR', true);
    expect(resolution.kind).toBe('TECHNICAL');
    expect(resolution.retryable).toBe(true);
    for (const p of [transient, lasting, resolution]) {
      expect(p.messageSv).not.toMatch(/aldrig|ingen sparad bedömning|[A-Z]{3,}_[A-Z_]{3,}/);
      expect(p.messageSv).toContain('En äldre bedömning visas inte i stället.');
    }
    // verify's storage fault: the route sends code LU_REEXECUTION_STORAGE_FAULT with an honest flag.
    const lastingVerify = presentLuError(
      httpError(503, 'Verifieringen kunde inte genomföras: ...', { code: 'LU_REEXECUTION_STORAGE_FAULT', failureClass: 'REEXECUTION_STORAGE_FAULT', reasonCode: 'EXECUTION_OUTCOME', retryable: false }),
      'verify',
    );
    expect(lastingVerify.retryable).toBe(false);
    expect(lastingVerify.messageSv).toContain('försvinner inte vid ett nytt försök');
    expect(lastingVerify.messageSv).not.toMatch(/just nu|verifier/i);
  });

  it('item 6: PROPERTY_LOOKUP_AMBIGUOUS is a known limitation of the property data -- never "check your designation", never a retry', () => {
    for (const status of [400, 409]) {
      const p = presentLuError(
        httpError(status, 'Fastighetsbeteckningen matchar flera fastighetsytor. Ingen fastighet valdes.', { code: 'PROPERTY_LOOKUP_AMBIGUOUS' }),
        'property-lookup',
      );
      expect(p.kind).toBe('REFUSED');
      expect(p.retryable).toBe(false);
      expect(p.messageSv).toBe(
        'Fastigheten kan inte analyseras ännu: beteckningen är inte unik i fastighetsunderlaget. Det är en känd begränsning i underlaget, inte ett fel i din sökning.',
      );
      expect(p.messageSv).not.toMatch(/Kontrollera fastighetsbeteckningen/);
      expect(p.technical).toContainEqual({ label: 'Felkod', value: 'PROPERTY_LOOKUP_AMBIGUOUS' });
    }
  });

  it('item 5: the server\'s `retryable` decides -- a 503 it marks not retryable never offers "Försök igen"; a refusal never does', () => {
    expect(presentLuError(httpError(503, 'x', { retryable: false }), 'current-assessment').retryable).toBe(false);
    // W-UI1 (owner decision 2): an answer without the server's flag offers no "Försök igen".
    expect(presentLuError(httpError(500, 'x'), 'current-assessment').retryable).toBe(false);
    expect(presentLuError(httpError(500, 'x', { retryable: true }), 'current-assessment').retryable).toBe(true);
    // A refusal is never retryable, whatever a flag says.
    expect(presentLuError(currentness('AMBIGUOUS_CURRENT_GEOMETRY', 409, true), 'run').retryable).toBe(false);
    // The server's retryable is shown in the technical rows.
    expect(presentLuError(currentness('VERIFIER_CONFIGURATION', 503, false), 'run').technical).toContainEqual({ label: 'Nytt försök kan lyckas', value: 'nej' });
  });

  it('item 9 (M1a KNOWN_LIMITATION): no currentness text claims a global guarantee about older points', () => {
    for (const failureClass of [
      'CURRENT_GEOMETRY_UNVERIFIED',
      'AMBIGUOUS_CURRENT_GEOMETRY',
      'INVALID_SUPERSESSION_GRAPH',
      'NO_VERIFIED_GEOMETRY_CANDIDATE',
      'INVALID_GEOMETRY_HEAD',
      'VERIFIER_CONFIGURATION',
      'CURRENTNESS_STORAGE_INTEGRITY_FAULT',
      'CURRENTNESS_RESOLUTION_ERROR',
      'DERIVED_GEOMETRY_PERSISTENCE_FAILED',
    ]) {
      const message = presentLuError(
        currentness(failureClass, 409, false, 'Projektets aktuella lokaliseringspunkt kunde inte verifieras. En äldre punkt används aldrig i stället.'),
        'run',
      ).messageSv;
      expect(message).not.toMatch(/aldrig|garanter|alltid/i);
    }
  });

  // -----------------------------------------------------------------------------------------------
  // W-M2e item 1 (M2d verification finding 1, W-APR add-on 3): the selection's refusals have their
  // own Swedish text per class -- a binding that failed its check is not "motstridigt underlag", and a
  // contract-version refusal is not "stämmer inte med sin lagrade identitet". Never retried.
  // -----------------------------------------------------------------------------------------------
  const selection = (status: number, code: string, failureClass: string, reasonCode: string) =>
    httpError(status, 'Projektets aktuella bedömning kan inte fastställas: ... en äldre bedömning visas aldrig i stället.', {
      code,
      failureClass,
      reasonCode,
      retryable: false,
    });

  it.each([
    // [error, kind, required text, forbidden text]
    [
      selection(409, 'ASSESSMENT_CURRENT_UNRESOLVED', 'CURRENT_BINDING_REFUSED', 'REJECT_PROJECT_CONTEXT_BINDING_V2'),
      'INTEGRITY',
      'projektets aktuella bindning till fastigheten underkändes vid kontrollen',
      /motstridig|lagrade identitet/,
    ],
    [
      selection(409, 'ASSESSMENT_CURRENT_UNRESOLVED', 'ASSESSMENT_CURRENT_AMBIGUOUS', 'REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT'),
      'REFUSED',
      'det finns flera giltiga bedömningar för den aktuella kontrollpunkten, och ingen av dem är utpekad som den aktuella',
      /motstridig|lagrade identitet/,
    ],
    [
      selection(409, 'ASSESSMENT_CURRENT_UNRESOLVED', 'ASSESSMENT_SELECTION_REFUSED', 'REJECT_SOMETHING_NEW'),
      'REFUSED',
      'valet av aktuell bedömning nekades',
      /motstridig|lagrade identitet/,
    ],
    [
      selection(424, 'ASSESSMENT_CONTRACT_REFUSED', 'ASSESSMENT_CONTRACT_INVALID', 'REJECT_LOCALIZATION_ASSESSMENT_V4'),
      'INTEGRITY',
      'den följer inget godkänt bedömningskontrakt (okänd eller ogiltig kontraktsversion)',
      /motstridig|lagrade identitet/,
    ],
  ] as const)('W-M2e item 1: %s -> %s with its own text', (err, kind, text, forbidden) => {
    for (const context of ['current-assessment', 'export', 'verify', 'viewer-evidence'] as const) {
      const p = presentLuError(err, context);
      expect(p.kind).toBe(kind);
      expect(p.retryable).toBe(false);
      expect(p.messageSv).toContain(text);
      expect(p.messageSv).not.toMatch(forbidden);
      // Never stronger than the KNOWN_LIMITATION, no authenticity language, no raw code or server text.
      expect(p.messageSv).not.toMatch(/aldrig|alltid|garanter|signatur|äkthet|attest|[A-Z]{3,}_[A-Z_]{3,}/i);
      expect(p.messageSv).not.toContain(err.message);
      expect(p.technical).toContainEqual({ label: 'Felkod', value: (err as unknown as { code: string }).code });
      expect(p.technical).toContainEqual({ label: 'Orsakskod', value: (err as unknown as { reasonCode: string }).reasonCode });
    }
  });

  it('W-M2e item 1: a class of the two codes this UI does not know still gets the code\'s own text, never the status text', () => {
    const unresolved = presentLuError(selection(409, 'ASSESSMENT_CURRENT_UNRESOLVED', 'SOME_NEW_CLASS', 'REJECT_X'), 'current-assessment');
    expect(unresolved.kind).toBe('REFUSED');
    expect(unresolved.retryable).toBe(false);
    expect(unresolved.messageSv).toBe(
      'Projektets aktuella bedömning kan inte fastställas. Ingen bedömning visas, och en äldre bedömning visas inte i stället. Ett nytt försök ändrar inte detta.',
    );
    const contract = presentLuError(selection(424, 'ASSESSMENT_CONTRACT_REFUSED', 'SOME_NEW_CLASS', 'REJECT_X'), 'export');
    expect(contract.kind).toBe('INTEGRITY');
    expect(contract.retryable).toBe(false);
    expect(contract.messageSv).toContain('bedömningskontrakt');
    expect(contract.messageSv).not.toMatch(/lagrade identitet/);
  });

  // -----------------------------------------------------------------------------------------------
  // W-M2e item 2: the gaps the exhaustive inventory found -- generic texts that claimed a cause, the
  // geometry routes' "no canonical project context" 404, bootstrap codes without a text (W-BOOT), the
  // spatial-form violation, the record integrity state (U20CDF3), prototype keys as classes.
  // -----------------------------------------------------------------------------------------------
  it('W-M2e item 2: a 409 or 424 without a code of its own claims no particular cause', () => {
    for (const context of ['current-assessment', 'viewer-evidence', 'export', 'verify', 'geometry-save'] as const) {
      const refused = presentLuError(httpError(409, 'REJECT_PROJECT_CONTEXT_BINDING_CONFLICT: x'), context);
      expect(refused.kind).toBe('REFUSED');
      expect(refused.messageSv).toMatch(/Servern nekade åtgärden\.$/);
      expect(refused.messageSv).not.toMatch(/motstridig/);
      const failed = presentLuError(httpError(424, 'REJECT_VIEWER_CAPABILITY_EXPIRED: x'), context);
      expect(failed.kind).toBe('INTEGRITY');
      expect(failed.retryable).toBe(false);
      expect(failed.messageSv).toMatch(/Underlaget kunde inte bekräftas och visas därför inte\.$/);
      expect(failed.messageSv).not.toMatch(/lagrade identitet|REJECT_/);
    }
  });

  it('W-M2e item 2: the geometry routes\' "No canonical project context available" 404 never says the thing does not exist', () => {
    for (const context of ['geometry-load', 'geometry-save', 'geometry-retry'] as const) {
      const p = presentLuError(
        httpError(404, 'No canonical project context available: REJECT_PROJECT_CONTEXT_BINDING_V2: signature does not verify'),
        context,
      );
      expect(p.kind).toBe('NOT_FOUND');
      expect(p.retryable).toBe(false);
      expect(p.messageSv).toContain('Projektets koppling till fastigheten kunde inte fastställas, så kontrollpunkten kan inte användas.');
      expect(p.messageSv).not.toMatch(/finns inte|REJECT_|signature/);
      expect(p.technical.map((r) => r.value).join(' ')).toContain('REJECT_PROJECT_CONTEXT_BINDING_V2');
    }
  });

  it('W-M2e item 2: a class or code named like an Object.prototype member is never read as an entry', () => {
    for (const failureClass of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const p = presentLuError(
        httpError(503, 'x', { code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED', failureClass, retryable: true }),
        'run',
      );
      expect(p.messageSv).toBe('Kontrollpunkten kunde inte fastställas. Ingen bedömning görs.');
      expect(typeof p.kind).toBe('string');
      expect(presentCurrentnessFailureClass(failureClass, true)).toBeNull();
      // W-UI1: the reason only -- whether a retry is offered is the server's flag on bootstrap-status.
      expect(describeBootstrapFailure(failureClass)).toEqual({ reasonSv: 'Fastigheten kunde inte knytas till lokaliseringen.' });
    }
    expect(presentLuError(httpError(503, 'x', { code: 'constructor' }), 'run').messageSv).toBe('Bedömningen kunde inte köras. Ett tekniskt fel uppstod på servern.');
  });

  it.each([
    // [bootstrap failureCode, required text, retryable]
    ['CURRENT_BINDING_READ_ERROR', 'kunde inte läsas på grund av ett tekniskt fel. Ingen ny koppling skapades i dess ställe.', true],
    ['CURRENT_BINDING_INTEGRITY_FAULT', 'bestående lagrings- eller integritetsfel', false],
    ['CURRENT_BINDING_REFUSED', 'underkändes vid kontrollen. Ingen ny koppling skapades i dess ställe.', false],
    ['PROPERTY_MISMATCH', 'stämmer inte med lokaliseringens egen fastighet', false],
  ] as const)('W-M2e item 2 (W-BOOT): bootstrap failure %s has its own text; retry is the server flag (W-UI1)', (code, text, retryable) => {
    const d = describeBootstrapFailure(code);
    expect(d.reasonSv).toContain(text);
    expect(d.reasonSv).not.toMatch(/aldrig|signatur|[A-Z]{3,}_[A-Z_]{3,}/);
    expect(presentBootstrapFailure({ status: 'FAILED', failureCode: code, retryable }).retryable).toBe(retryable);
  });

  it('W-M2e item 2 (U20CDF3): a rejected spatial form names its violation neutrally; LAYER_NOT_ANSWERED included', () => {
    expect(presentLuRunReason(['REJECT_SPATIAL_EVIDENCE_FORM', 'LAYER_NOT_ANSWERED'])?.messageSv).toBe(
      'Underlaget från en datakälla hade en oväntad form och avvisades innan bedömningsreglerna tillämpades ' +
        '(ett efterfrågat lager redovisas varken med evidens eller som otillgängligt). Ingen bedömning skapades.',
    );
    // An unknown violation adds nothing; no violation at all adds nothing.
    expect(presentLuRunReason(['REJECT_SPATIAL_EVIDENCE_FORM', 'SOMETHING_NEW'])?.messageSv).toBe(
      'Underlaget från en datakälla hade en oväntad form och avvisades innan bedömningsreglerna tillämpades. Ingen bedömning skapades.',
    );
    expect(presentLuRunReason(['EXECUTION_KERNEL_ERROR'])).toBeNull();
    expect(presentLuRunReason('REJECT_SPATIAL_EVIDENCE_FORM')).toBeNull();
  });

  it('W-M2e item 2 (U20CDF3): RECORD_INTEGRITY_ERROR has its own label, the technical tone, no retry -- never "Okänt täckningstillstånd" or green', () => {
    const view = presentLuOverallStatement({
      statement_sv: 'Integritetsfel: bedömningens lagrade underlag är motsägelsefullt ... Lagrade fynd: ...',
      coverage_state: 'RECORD_INTEGRITY_ERROR',
      coverage_basis: ['UNKNOWN_SEVERITY:f-1'],
      coverage: null,
      risk_level: 'LOW',
    });
    expect(view.stateLabelSv).toBe('Integritetsfel i den lagrade bedömningen – fynden visas var för sig');
    expect(view.tone).toBe('technical');
    expect(view.retryable).toBe(false);
    expect(view.statementSv).toContain('Integritetsfel');
    expect(view.notices).toEqual([]);
    expect(view.technical).toContainEqual({ label: 'Grund', value: 'UNKNOWN_SEVERITY:f-1' });
  });

  // -----------------------------------------------------------------------------------------------
  // W-M2e item 3 (M2d verification finding 4): a SECOND lock on "never retry" -- configuration and
  // lasting integrity faults never offer "Försök igen", even if an answer's flag says retryable:true.
  // -----------------------------------------------------------------------------------------------
  it.each([
    // [code, failureClass, reasonCode, status]
    ['LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED', 'VERIFIER_CONFIGURATION', 'LOCALIZATION_GEOMETRY_VERIFIER_CONFIGURATION', 503],
    ['LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED', 'CURRENTNESS_STORAGE_INTEGRITY_FAULT', 'LOCALIZATION_GEOMETRY_CURRENTNESS_STORAGE_INTEGRITY_FAULT', 503],
    ['ASSESSMENT_READ_ERROR', 'ASSESSMENT_STORAGE_INTEGRITY_FAULT', 'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT', 503],
    ['ASSESSMENT_READ_ERROR', 'ASSESSMENT_STORAGE_INTEGRITY_FAULT', 'CURRENT_BINDING_INTEGRITY_FAULT', 503],
    ['ASSESSMENT_CURRENT_UNRESOLVED', 'CURRENT_BINDING_REFUSED', 'REJECT_PROJECT_CONTEXT_BINDING_V2', 409],
    ['ASSESSMENT_CONTRACT_REFUSED', 'ASSESSMENT_CONTRACT_INVALID', 'REJECT_LOCALIZATION_ASSESSMENT_V4', 424],
    ['GOVERNED_EVIDENCE_INTEGRITY_FAILED', 'EVIDENCE_TAMPERED', 'x', 424],
    ['ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED', 'LOCALIZATION_GEOMETRY_MISSING', 'x', 424],
  ] as const)('W-M2e item 3 / W-UI1: %s / %s says the fault is lasting, so it is never retried, even with retryable:true', (code, failureClass, reasonCode, status) => {
    for (const context of ['current-assessment', 'run', 'geometry-load', 'export', 'verify'] as const) {
      const p = presentLuError(httpError(status, 'x', { code, failureClass, reasonCode, retryable: true }), context);
      expect(p.retryable, `${code}/${failureClass} @${context}`).toBe(false);
    }
  });

  it('W-M2e item 3: the second lock leaves transient faults retryable and holds for a run record and the overall line too', () => {
    // Transient faults the server marks retryable stay retryable.
    for (const failureClass of ['CURRENTNESS_RESOLUTION_ERROR', 'DERIVED_GEOMETRY_PERSISTENCE_FAILED']) {
      expect(presentLuError(httpError(503, 'x', { code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED', failureClass, retryable: true }), 'run').retryable).toBe(true);
    }
    expect(presentLuError(httpError(503, 'x', { code: 'ASSESSMENT_READ_ERROR', failureClass: 'ASSESSMENT_READ_ERROR', reasonCode: 'CURRENT_ASSESSMENT_CANDIDATE_READ_ERROR', retryable: true }), 'current-assessment').retryable).toBe(true);
    // A run's FAILED_CLOSED record (executionMotor.localization_geometry).
    expect(presentCurrentnessFailureClass('VERIFIER_CONFIGURATION', true)?.retryable).toBe(false);
    expect(presentCurrentnessFailureClass('CURRENTNESS_STORAGE_INTEGRITY_FAULT', true)?.retryable).toBe(false);
    expect(presentCurrentnessFailureClass('CURRENTNESS_RESOLUTION_ERROR', true)?.retryable).toBe(true);
    // The overall line: unreadable pinned evidence is re-read only for a read error the server marks retryable.
    const overall = (technical_error_class: unknown, retryable: unknown) =>
      presentLuOverallStatement({
        statement_sv: 'x',
        coverage_state: 'PINNED_EVIDENCE_UNREADABLE',
        pinned_evidence: { retryable, technical_error_class, unreadable_artifact_ids: ['e'] },
      }).retryable;
    // W-UI1 (owner decision 2): the server's flag decides -- no client class list.
    expect(overall('EVIDENCE_READ_ERROR', true)).toBe(true);
    expect(overall('EVIDENCE_NOT_FOUND', true)).toBe(true);
    expect(overall(undefined, true)).toBe(true);
    expect(overall('EVIDENCE_READ_ERROR', false)).toBe(false);
    expect(overall('EVIDENCE_READ_ERROR', undefined)).toBe(false);
    // W-UI1: an unknown code is no longer refused by a client list -- the server's flag decides.
    expect(presentLuError(httpError(503, 'x', { code: 'SOME_FUTURE_CODE', failureClass: 'VERIFIER_CONFIGURATION', retryable: true }), 'run').retryable).toBe(true);
    expect(presentLuError(httpError(503, 'x', { code: 'SOME_FUTURE_CODE', failureClass: 'VERIFIER_CONFIGURATION', retryable: false }), 'run').retryable).toBe(false);
  });

  it('a client-side Swedish error is shown as written', () => {
    expect(presentLuError(new LuClientError('Slå upp en fastighet först.'), 'run').messageSv).toBe('Slå upp en fastighet först.');
  });

  it('LuErrorNotice: Swedish line, retry only when retryable, raw text only in a collapsed "Teknisk information"', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <LuErrorNotice testId="x" error={presentLuError(httpError(500, 'raw server text', { retryable: true }), 'verify')} onRetry={onRetry} />,
    );
    expect(screen.getByTestId('x-message')).toHaveTextContent('Reproducerbarhetskontrollen kunde inte genomföras. Ett tekniskt fel uppstod på servern.');
    expect(screen.getByTestId('x-message')).not.toHaveTextContent('raw server text');
    expect(screen.getByTestId('x-technical')).not.toHaveAttribute('open');
    expect(screen.getByTestId('x-technical')).toHaveTextContent('raw server text');
    screen.getByTestId('x-retry').click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<LuErrorNotice testId="x" error={presentLuError(httpError(424, 'Governed LU assessment failed tamper verification.'), 'verify')} onRetry={onRetry} />);
    expect(screen.queryByTestId('x-retry')).not.toBeInTheDocument();
  });
});
