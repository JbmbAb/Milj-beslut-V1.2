/**
 * U30-R5 -- the machine-readable KNOWN_LIMITATION of LU re-execution (verify). Its own module, deliberately NOT
 * re-exported from the package root (src/index.ts re-exports LuDeterministicReExecution wholesale; the API
 * boundary snapshot stays unchanged). Referenced from the LuDeterministicReExecution module header.
 */

/**
 * KNOWN_LIMITATION (U30-R5; U30R4-VERIFICATION V1, V4, V5; owner decisions 2026-10-03 (4) p.7 and (5): replay may
 * be called a reproducibility check, but nothing may claim authenticity before a real attestation authority
 * exists). Same format as the M1a/APR/BOOT markers.
 *
 * Machine-readable marker with exactly this meaning: re-execution proves deterministic CONSISTENCY of an
 * assessment with the artifacts it pins, not who made them. Every residual below gives PASS to someone with
 * write access to CAS (and the DB row that makes an assessment current); none needs a signature, because verify
 * checks none. No text describing verify (UI, API, PDF, U51, reports) may claim more than `meaning_sv` says. The
 * residual forms are pinned as PASS in LuDeterministicReExecution.test.ts under KNOWN_LIMITATION -- NOT approved
 * behaviour.
 */
export const LU_REEXECUTION_CONSISTENCY_KNOWN_LIMITATION = Object.freeze({
  code: "KNOWN_LIMITATION",
  id: "LU_REEXECUTION_CONSISTENCY_NOT_AUTHENTICITY",
  meaning_sv:
    "verify är konsistens, inte äkthet; kräver skrivåtkomst till CAS + DB; kan inte stängas i grunden utan framåtriktad markör i körningskedjan eller attestationsverifiering",
  residuals: Object.freeze([
    Object.freeze({
      id: "v1-format-outcome-redirect",
      form_sv:
        "En kanonisk V4 (eller annan bedömning över ett v2-utfall) skrivs om till V1, V2 eller V3 och pekas mot ett V1-format utfall utan körningslinje: antingen en nypräglad kedja (manifest + attempt + V1-utfall = tre nya CAS-objekt) eller en äkta körning från före 2026-08-24; valfri punkt, en HIGH kan tas bort; ger PASS även med NODE_ENV=production och APP_ENV=production",
      requires_sv: "tre nya CAS-objekt för den präglade kedjan (inga för en äkta äldre körning) + en ny bedömning + en DB-rad; ingen signatur och ingen WORM-förbikoppling",
    }),
    Object.freeze({
      id: "v3-relabel-own-execution",
      form_sv:
        "En V4 omstämplad till V3 över sitt eget utfall och sin egen punkt (auktoritetsreferensen borttagen) kan inte skiljas från en äkta V3 från 2026-08-24..2026-09-16; inga fynd och ingen punkt ändras (27m)",
      requires_sv: "en ny bedömning + en DB-rad",
    }),
    Object.freeze({
      id: "subject-axes-not-compared",
      form_sv:
        "Projekt, fastighet, bindning och release jämförs inte mot exekveringssubjektet: B:s hela resultat inklusive B:s punkt under A:s projekt och fastighet (R-2, 27n), eller omdirigering till en annan körning med samma punkt, även en fabricerad v2-kedja där en HIGH kan försvinna",
      requires_sv: "nya CAS-objekt + en DB-rad",
    }),
    Object.freeze({
      id: "fabricated-chain-never-run",
      form_sv: "En helt nypåhittad kedja för ett subjekt som aldrig körts ger PASS, eftersom ingen signatur kontrolleras",
      requires_sv: "nya CAS-objekt + en DB-rad",
    }),
    Object.freeze({
      id: "historical-v1-v2-unbound",
      form_sv:
        "V1/V2-formade bedömningar över äkta körningar från före 2026-08-24 (V1-utfall utan körningslinje) är inte bundna till något exekveringssubjekt (R-1)",
      requires_sv: "ingenting nytt för äkta historik; för omdirigering se v1-format-outcome-redirect",
    }),
    Object.freeze({
      id: "identity-minted-after-the-fact",
      form_sv:
        "En bootstrap-körning med V3-subjekt ger EXECUTION_SUBJECT_UNBOUND i produktkonfiguration tills någon präglar den aldrig utfärdade identiteten på det id manifestet namnger; därefter PASS (UNBOUND är ingen hård grind)",
      requires_sv: "ett nytt CAS-objekt; ingen WORM-förbikoppling (rest i samma familj som R-3/R-4: förfalskare med skrivåtkomst)",
    }),
    Object.freeze({
      id: "deleted-v2-outcome-minted-v1",
      form_sv:
        "Ett v2-utfall som tas bort ur CAS och ersätts av ett präglat V1-utfall på legacy-adressen gör körningen till en 'V1-era'-körning; en HIGH kan tas bort och PASS ges även med V4-etikett",
      requires_sv: "borttagning på plats (WORM-förbikoppling eller dataförlust) + ett nytt CAS-objekt + en ny bedömning + en DB-rad (R-3/R-4-klass)",
    }),
    Object.freeze({
      id: "in-place-overwrite",
      form_sv:
        "Ett utfall eller en körningspost som skrivs över på plats till en ny självkonsistent post ger PASS; utfallet pinnar körningsposten med 48 bitars hashprefix (R-3 för V3, R-4 för V4)",
      requires_sv: "överskrivning på plats (WORM-förbikoppling)",
    }),
    Object.freeze({
      id: "historical-cause-text",
      form_sv:
        "Fritext i producentens historiska form '<vad som helst>: <högst 200 tecken>' i en NOT_CHECKED-förklaring kan inte skiljas från äkta orsakstext (PASS med notisen NOT_CHECKED_CAUSE_NOT_PINNED)",
      requires_sv: "en ny bedömning + en DB-rad",
    }),
    Object.freeze({
      id: "outcome-attestation-not-checked",
      form_sv:
        "Utfallsattestationen läses inte vid verify och är HMAC med dev-hemligheten; den får inte åberopas som äkthetsbevis någonstans",
      requires_sv: "källkoden (dev-hemligheten är hårdkodad); fail-closed utanför dev hör till U42/U40-2",
    }),
  ]),
  owner_decision:
    "OPEN 2026-10-03: documented and pinned as a KNOWN_LIMITATION per U30R4-VERIFICATION V1 option (a) -- NOT approved behaviour; " +
    "the owner has not accepted these residuals (A-R4-1, A-R5-1); the structural fix (a forward marker in the execution chain, A-R4-6, " +
    "or attestation verification at verify, A-R3-3) is not built",
} as const);
