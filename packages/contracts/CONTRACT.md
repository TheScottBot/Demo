# Contract document: packages/contracts

This directory is the owner of every definition in Spec 00 §3 and §4 (datum 0.12). Services import it by workspace and hold no copy. Because the owner and its consumers live in one repository (CD2), there is no copied definition and no digest to check; the single definition check (Spec 00 §2.4 check 3, built in CE3) stands in for that proof.

## Status

**Frozen**, at version 1.2.0 since 18 October 2026. The author froze it at 1.0.0 (CD1) once Spec 02 RE4 and Spec 03 WE2 passed against the doubles, in the author's words: "Fix the CE1 doubled path as a Spec 00 change, tests first, then freeze the contract under CD1."

From the freeze, datum 0.11 applies in full: nothing here is renamed, aliased, normalised, reinterpreted or silently improved, no required value gains a default, and no unknown field is accepted. A change is a version decision for the author, raised as a Spec 00 change:

- one that breaks a consumer raises the major version of `@demo/contracts` and carries migration notes, in the section below;
- one that breaks nothing (a new export, a corrected defect that no consumer relied on) raises the minor or patch version.

Every change is still recorded in the change record, dated, with its reason. The record above the freeze line is the history of how the contract settled into its shape (datum 0.11).

## Where each definition lives

The definitions are the source files; this document never restates them.

| Spec 00 section | Module |
|---|---|
| §3.1 versions | `src/versions.ts` |
| §3.2 routes, scope names | `src/routing.ts` |
| §3.3 bounds | `src/bounds.ts` |
| §3.3 grammars | `src/grammars.ts` |
| §3.4 headers | `src/headers.ts` |
| §3.5 authentication context | `src/authentication-context.ts` |
| §3.6 errors, problem documents | `src/errors.ts`, `src/invalid-fields.ts` |
| §3.6 `withHttpProblemHandling`, §3.11 handler signature | `src/http-problem-handling.ts` |
| §3.7 sections | `src/sections.ts` |
| §3.8 read response | `src/read-response.ts` |
| §3.9 command | `src/command.ts` |
| §3.10 operation status | `src/operation-status.ts` |
| §4.1 adapter results and interfaces | `src/adapters.ts` |
| §4.2 routing table, provider identifiers | `src/routing.ts` |
| §4.3 fault prefixes, CU9 and CU11 values | `src/mock-provider-contract.ts` |
| §4.3 and §4.4 provider headers | `src/provider-headers.ts`, `src/headers.ts` |
| §4.4 provider wire bodies | `src/provider-wire.ts` |

Held elsewhere: the queue message and journal item schemas belong to Spec 03; this package holds only their versions (§3.1) and the queue message bound (§3.3). The aggregate ETag grammar belongs to Spec 02; this package holds only the `If-None-Match` bound.

## Change record

Each entry is a choice CE1 made where the specification left room, dated, with its reason. A consumer that finds one wrong raises it here as a Spec 00 change.

| Date | Definition | Choice | Reason |
|---|---|---|---|
| 2026-10-18 | `CommandRequestSchema` | One variant per section (five), discriminated by `section`, each with its own literal `type` and payload shape | §4.2 gives each section exactly one command type, so the section selects the variant, and §3.9's payload rule is enforced by the same parse rather than a second step |
| 2026-10-18 | every length bound on a string | Counted in UTF-16 code units, as JavaScript counts | Never admits more characters than the bound states; a code point count would need a second pass over hostile input |
| 2026-10-18 | `preferences.language` | Shape only: two or three letters, then subtags of one to eight letters or digits | Full RFC 5646 validation needs the IANA registry, which a pure module cannot hold; the platform relays the tag |
| 2026-10-18 | ULID grammar | Canonical upper case Crockford base 32, first character 0 to 7 | The canonical form; the first character bound is the 48 bit time limit |
| 2026-10-18 | UUID grammar | Either case | RFC 9562 permits either on input |
| 2026-10-18 | `TimestampSchema` | The §2.3 form, then a round trip through `Date` | Refuses a well formed impossible date such as 30 February |
| 2026-10-18 | `scope` claim | Read as a space separated string or as a list of names; each name held to RFC 6749 §3.3 scope-token; an empty string is no scopes | CU4 is unsettled and stays so while the family runs locally; an empty scope is a valid token lacking permission, so `requireScope` answers 403 |
| 2026-10-18 | `sub` claim | Required, a non empty string; no length bound | §3.3 states no bound for it; one is an author decision (see open questions) |
| 2026-10-18 | provider identifiers | A closed set derived from the §4.2 routing table | §4.2 names every provider; none ends in a hyphen and six characters (CU8) |
| 2026-10-18 | `SourceProvenance`, `ProviderReadResult` | `errorReason` present exactly when the status is `error`; `SourceProvenance.version` only on `ok` or `not-modified` | States §3.8's comments as rules, so no consumer repeats them |
| 2026-10-18 | `OperationStatus` | Each detail object present exactly when its state is | States §3.10's comments as rules |
| 2026-10-18 | entity tags | Strong tags only; one provider version per header | `If-Match` compares exactly; a weak tag promises an equivalence the provider never offered |
| 2026-10-18 | provider `Retry-After` | Whole seconds only; the HTTP date form is refused | §3.3 states the grammar as whole seconds |
| 2026-10-18 | provider `Cache-Control` | Directive names case insensitive; a quoted, repeated or over bound `max-age` is invalid, not capped | RFC 9111; datum 0.10 refuses rather than truncates. See finding for Spec 02 in the evaluation record |
| 2026-10-18 | `invalidFields` | A fixed reason vocabulary; an unknown key is reported at its enclosing path | zod issues carry caller supplied key names, which §3.6 forbids in a problem document |
| 2026-10-18 | `DemoError` | No free text detail; the message is the error code; the reason travels as `reasonCategory` | Keeps input values out of problem documents and logs by construction |
| 2026-10-18 | `withHttpProblemHandling` | Takes the CQ3 `ProblemHandlingLog` and `ProblemHandlingMetrics` interfaces; a malformed `X-Correlation-Id` is answered 400 under a freshly minted identifier; `RequestRejected` is counted for 4xx only | CQ3; a refused identifier is input and is never echoed |
| 2026-10-18 | status route scope | Named as decided by Spec 03 WD4 | WD4 is open; the rule is not guessed |
| 2026-10-18 | headers | Provider facing headers (`X-Api-Key`, `If-Match`, `Demo-Provider-Contract`) declared with the public ones, each marked with its boundary | §2.4 check 3 covers every header name in §3 and §4 |
| 2026-10-18 | fault prefixes | `flaky-`, `throttle-`, `poison-` and `conflict-` apply to writes only; `slow-` and `down-` to reads and writes | `flaky-` and `throttle-` are counted per idempotency key, which only writes carry; the rest follow §4.3's wording |

| 2026-10-18 | `authenticationClaimBounds` | `sub` bounded at 255 characters, kept beside `contractBounds` rather than in it | Author decision (CU10); the §3.3 table as drafted has no such row, and `contractBounds` mirrors that table |
| 2026-10-18 | `withHttpProblemHandling` | Every problem document carries `Cache-Control: no-store`, on all three routes | Author decision; §3.4 already required it on the command and status routes |
| 2026-10-18 | `httpHeaders.providerTenant` | `Demo-Tenant-Id` on every provider request | CQ7.1: one API key serves every tenant |
| 2026-10-18 | `providerWireStatuses` | The statuses of every provider answer, including the CQ7 decisions: 401 for a refused key, 400 for an invalid request, 404 for a record or section not held, 412 for a stale `If-Match`, 428 for a missing one, 422 for a reused key, 201 for an append | CQ7.2 to CQ7.5 and CQ7.7; one table both the adapters and the doubles read |
| 2026-10-18 | provider versions | SHA-256 of the provider's own sections, keys sorted at every level, list order kept, no whitespace; first 16 hexadecimal characters. Implemented once in `packages/test-doubles` (`computeProviderVersion`) | CQ7.6; only the doubles and the mock servers compute versions |
| 2026-10-18 | notes appends | The provider mints `noteId` and `writtenAt`; a full notes section (100 entries) refuses another append with 400 | CQ7.7; §3.7 bounds the section |
| 2026-10-18 | provider idempotency | Keys are scoped by provider and tenant; the request fingerprint is method, path and canonical body, leaving out `If-Match` | A client retrying a request may have read the new version since its first attempt |

| 2026-10-18 | `PublicRouteNameSchema`, `publicRouteNamed` | Short names for the three routes (`read-record`, `submit-command`, `read-operation`), moved here from `packages/test-doubles` in CE5 | The stub functions and the event builder both need them; one definition (datum 0.7) |
| 2026-10-18 | `httpHeaders.stubEcho` | `Demo-Stub-Echo`, a response header sent only by the stub functions in the stub stage | Named by Spec 00 CE5; every header name lives here |
| 2026-10-18 | `operationDetailField` | Exported: the detail field each operation state carries, the rule `OperationStatusSchema` already applied | Spec 03 WE1: the journal sets and clears details by the same rule, not a copy (datum 0.7) |
| 2026-10-18 | `invalidFieldsFromZodError` | An unknown discriminator is named by its own path once (`section`, not `section.section`) | Defect found in Spec 03 WE2: zod 4.6.7 already ends the issue's path with the discriminator, and the mapping appended it again. Fixed before the freeze, test first |
| 2026-10-18 | freeze | Version 1.0.0; changes from here are version decisions | CD1, by the author |
| 2026-10-18 | 1.1.0: status route scope | The status route's rule is `{ kind: 'scope', requiredScope: 'records:write' }`, where 1.0.0 named the open decision. The `decided-by` kind stays in the type, used by no route | Spec 03 WD4, answered; released as a minor version by the author (WQ8). Nothing read the rule but CE1's own test, whose assertion changed with this decision |
| 2026-10-18 | 1.2.0: resource server scopes | `scopeResourceServerIdentifier` is `demo`. `readAuthenticationContext` reads exactly `demo/records:read` and `demo/records:write` as `records:read` and `records:write`; every other name, prefixed or not, is kept as it is, so it grants nothing | Spec 01 EE2: Cognito issues a custom scope as its resource server identifier, a slash and the name. The author chose to accept both forms (EQ6), widening what the handlers accept; released as a minor version, since no token they accepted before is now refused |

## Migration notes

- 1.0.0 is the first frozen version.
- 1.1.0: a consumer reading the status route's `scopeRule` now finds `records:write` instead of `decided-by`. No consumer read it.
- 1.2.0: a token whose scope claim holds `demo/records:read` or `demo/records:write` now passes `requireScope` for that scope, where 1.1.0 answered 403. Nothing a consumer accepted before is refused, and the scopes it is handed are still the two contract names.

## Open questions for the author

None at present.
