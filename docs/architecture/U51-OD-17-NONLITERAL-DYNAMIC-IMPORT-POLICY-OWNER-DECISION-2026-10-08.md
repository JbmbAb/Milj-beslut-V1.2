# U51-OD-17 -- non-literal dynamic imports in the absence proof (owner decision record)

**Status: DECIDED.** This is a policy decision, not its implementation. None of the six current imports is remediated by this record.

| Field | Value |
| --- | --- |
| decision_id | `U51-OD-17` |
| owner | Jimmy Bruce |
| contract | `2d937d6336d73ab11d428af7d56afc6fdb38d0ee` (tree `4f2b720ae247f5e15b2040a17275353a85df0f95`), `U51-CANONICAL-MANIFEST-CONTRACT-01` R2 section 5.3 (`nonliteral_dynamic_imports`) and 15 (OD-17). Not modified by this record. |
| source anchor | `a652d7b6160a62dc9fc3c5ba73a9820141b9cb6a` (tree `2ce1c2004ba3aaf324c1e3120f4b3cdd3b65d402`) |
| scope | the `nonliteral_dynamic_imports == 0` requirement of `DECLARED_ABSENT` (OD-3 = `ABSENT_ADMISSIBLE`) |
| date | 2026-10-08 |

## 1. Decision

```
NO_GENERAL_DYNAMIC_IMPORT_ALLOWLIST
FIRST_PARTY_NONLITERAL_IMPORTS = REMOVE_OR_MAKE_DETERMINISTIC_AND_CENSUS_VISIBLE
VENDORED_CODE                  = NO_AUTOMATIC_EXEMPTION
VENDORED_EXCEPTION             = EXACT_PATH_AND_CONTENT_HASH_ONLY_IF_REQUIRED
NEW_OR_UNKNOWN_NONLITERAL_IMPORT = BLOCK
```

- No wildcard, directory-wide, regex-wide or "known dynamic imports" exemption exists.
- A first-party non-literal import whose target is already deterministically known is changed to a literal, or to another mechanism the census can see,
  where behaviour can be preserved.
- Vendored code is not exempt by being vendored. An exception for a vendored file is allowed only when it binds the exact path, the exact content hash,
  an owner-reviewed rationale and an explicit statement that the file is vendored. It never broadens to a prefix, and any byte change invalidates it.
- The census stays fail-closed: a non-literal import that is new or not covered by such an exception is blocking.

## 2. How the decision was made

The owner authorised the policy conditionally, to be recorded only if the agent, after reproducing the census and checking the alternatives, found it
optimal. The agent reproduced the census, found no cleaner mechanism, and recorded the policy. The authorisation was used.

## 3. Reproduced census (parser-backed, two independent implementations)

Count: **6** in non-test code of the anchor tree, from 157 `import()`/`require()` calls (151 literal) in 2505 parsed files. The `a652d7b6` runner and a
separate scratch implementation agree. Reachability is the static import closure of the production entrypoint files (literal imports only).

| # | Path:line | Shape | Origin | Specifier recoverable | Reachable in production | Literal is behaviour-preserving? | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1-2 | `public/cesium/Workers/createGeometry.js:26` (two calls, one minified line) | `(await import(t)).default`, `t` is the worker module name passed at run time | vendored; verbatim copy of `cesium@1.144.0` | **No**, it is a runtime argument | Static browser asset (web worker). In no server import closure; nothing in server code references `public/cesium`. | Not applicable, the file is not first-party | **Vendored exception** (section 5) |
| 3 | `server/services/backupService.ts:200` | `const awsModule = '@aws-sdk/client-s3'; await import(/* @vite-ignore */ awsModule).catch(...)` | first-party | Yes, a constant string literal in the same function | Yes, in the `web` closure (via `fullStatusService`, `platform/public`) | **Runtime: yes** (a missing optional module rejects and is caught). **Typecheck: no**, the package is neither declared nor installed, so a literal needs a typed escape or the S3 branch must go. | Remediate |
| 4 | `server/services/errorTrackingService.ts:66` | `const sentryModule = '@sentry/node'; await import(/* @vite-ignore */ sentryModule).catch(...)` | first-party | Yes | Yes, `web` closure | **Yes**: `@sentry/node` is declared (`^10.67.0`) and installed, so the "optional" comment is stale | Remediate (trivial) |
| 5 | `server/services/openDataSourceService.ts:76` | `const path = './lastkajenService'; await import(path)` | first-party | Yes | Yes, `web` closure; the target is already in that closure | **Yes** (same sibling module) | Remediate (trivial) |
| 6 | `services/aiAssistantService.ts:540` | `const serverModulePath = '../server/services/spatialAuditService'; await import(/* @vite-ignore */ serverModulePath)` in the `!hasWindow()` branch | first-party, **shared** by browser components and the server | Yes | Yes, `web` closure; the target is already in that closure | **Not trivially.** The variable keeps the server service graph out of the browser bundle; a literal is expected to pull it in. This is inferred, not tested. | Remediate with a structural change and a test |

Not first-party and not exempt: nothing in this table is exempt today. The table is the review input for section 5 and for the remediation unit.

## 4. Alternatives rejected

- **A general allowlist** (any form). It is exactly the "known dynamic imports" broadening C6 exists to prevent: a path that is allowed once is a place
  where a hidden dynamic registration path can sit later.
- **An existing vendor boundary instead of a hash.** The repository has path-prefix boundaries for `public/cesium/**` (ESLint ignore, the zero-google
  guard allow-list, the protected-write channel review). They are prefixes. A prefix exemption lets any new file or any changed byte under that path
  hide, so it is weaker than an exact-hash exception and is the wildcard this decision forbids.
- **Untracking `public/cesium`** (it is regenerated by `scripts/copy-cesium-assets.cjs` at postinstall). That would hide the vendored code from the
  census instead of binding it, and it would change what the release identity measures. Not chosen.

## 5. Vendored exception required: one file

| Field | Value |
| --- | --- |
| path | `public/cesium/Workers/createGeometry.js` |
| content sha256 | `2d82f9f488888652a358dc9cb8355049a71ce066508d5fa5d94fdfff9d39481f` |
| vendored | yes: byte-identical to `node_modules/cesium/Build/Cesium/Workers/createGeometry.js` of `cesium@1.144.0`, copied by `scripts/copy-cesium-assets.cjs` |
| sites covered | exactly 2 (`import(t)` on line 26) |
| rationale | upstream Cesium worker module loader; runs only as a browser web worker; its specifier is a message argument and cannot be made literal without changing upstream code |
| scope limit | no prefix, no sibling file, no other path. The hash is checked against the blob in the subject tree. Any byte change, or a new Cesium version, makes the hit blocking again until re-reviewed. |

**Where it lives.** The frozen policy (`u51-freeze-policy-1`) and derivation (`u51-generation-derivation-1`) schemas are closed and have no key for an
exemption. The exact path-and-hash table therefore belongs in the verifier implementation, whose tree identity is bound by the authenticated
`accepted_verifiers` (contract 7.3). The census then counts only non-exempt sites against the required 0, and the unhashed audit part of the evidence
lists the exempt site. Putting the exception into the policy or the derivation instead would be a contract revision (R3), which is not made here.

## 6. What this record does not say

It does not say the four first-party files are remediated, that the census is zero, or that the absence proof can run. It does not decide the
remediation design for `services/aiAssistantService.ts`. Remediation is a separate bounded unit (suggested name `U51-DYNAMIC-IMPORT-CLOSURE-01`) and is
not mixed into release integration.
