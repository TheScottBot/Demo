# Implementation tracker

Where the demo platform stands, phase by phase. This file states the present and is rewritten whenever the state changes: at the start and end of every phase, and whenever the author answers a decision. The evidence behind each line (sources read, tests first, planted regressions, reproduction reports) lives in `docs/evaluation/ACTUAL_CONTRACT_EVALUATION.md`, and the contract's change record in `packages/contracts/CONTRACT.md`.

Last updated: 18 October 2026.

## Next up

Spec 00 is built up to CE6, which waits for the streams (RE5, WE8, EE3). RE1 to RE4 are built; RE5 (the ReadPath construct and the read Lambda entry point) is next in Spec 02, with a small Spec 00 change for a runtime only Powertools subpath. CD1 freezes the contract once RE4 and WE2 pass against the doubles: RE4 has. A question about ETags and `not-found` providers is noted for RE4 (the RE1 record). The Spec 01 and Spec 03 Plan stages have not started.

## Anonymity

The family is an anonymous proof of concept (author, 18 October 2026): nothing in the repository may name the real organisation or its domain. Use the specifications' generic vocabulary: records, sections, providers, tenants. Check 1 enforces it: its identifying-term rule fails on any listed term, in prose or split out of a code identifier (the lockfile excepted).

## Resuming work

1. Read this file, then the open items below.
2. Reread `ENGINEERING_DATUM.md` Part 0 and 0.17 before starting a phase.
3. Take the next phase from the table whose dependencies are all complete, and whose decisions are answered.
4. The agent never performs a git write; the author commits.

## Status key

| Status | Meaning |
|---|---|
| not started | no work yet |
| in progress | work under way in a session |
| awaiting reproduction | automated criteria met on the agent's machine; complete once the author reproduces them on a clean machine (datum Stage three) |
| awaiting author gate | needs something only the author can do |
| blocked | waiting on a decision or another phase, named in the note |
| complete | done, including the author's reproduction or gate |

## Tree wide checks

Every phase now runs under the seven checks of Spec 00 §2.4 (`TESTING.md`). Run them before reporting a phase.

## Environment

| Item | State |
|---|---|
| Repository | one repository at `demo/`, npm workspaces, branch `main` |
| Target runtime | Node.js 24, Lambda `nodejs24.x` on arm64 (CQ1) |
| Local Node.js | v22.23.2; the author is to install 24.22.0 (CQ5, open) |
| AWS | nothing is deployed; the family runs locally (CQ6) |
| Workspaces | `packages/contracts`, `packages/test-doubles`, `packages/construct-contracts`, `services/mock-providers`, `services/read`, `infra` |
| Suite | 40 files, 961 tests, and all seven tree checks passing on 18 October 2026 |

## Spec 00 shared contracts

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | complete | | closed 18 October 2026; CU4 left unsettled by design under CQ6 |
| CE1 Contract package | awaiting reproduction | Plan stage | `packages/contracts`; amended in CE2 for the `sub` bound, `no-store` and the CQ7 wire rules |
| CE2 Shared test doubles | awaiting reproduction | CE1 | `packages/test-doubles`: event builder, synthetic records, provider simulation, msw doubles |
| CE3 Tree wide checks | awaiting reproduction | CE1 | seven checks in `.github/workflows/tree-checks.yml`, each proven locally on a planted violation; seeing them run on GitHub needs a push (author gate); `TESTING.md` and `IMPLEMENTATION_DEVIATIONS.md` written |
| CE4 Mock providers | awaiting reproduction | CE1, CE2 | `services/mock-providers`: handlers, DynamoDB store, seed scripts and construct, all synthesising; local servers run the same handler (`npm start --workspace services/mock-providers`); deployment and seeding replaced under CQ6 |
| CE5 Construct contracts and stubs | awaiting reproduction | CE1 | `packages/construct-contracts` and `infra`: §3.11 interfaces, naming, stubs, Powertools adapter, one stack per stage; `DemoApi` wiring waits for EE1 (circular as drafted) |
| CE6 Wiring real constructs | not started | RE5, WE8, EE3 | |

## Spec 01 entry point

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | not started | | |
| EE1 DemoApi against stubs | not started | CE5 | |
| EE2 Identity provider | blocked | CE5, ED1 | |
| EE3 Throttling, CORS, logs and alarms | not started | CE5 | ED2 sets its scope |
| EE4 Deployed checks against the stubs | blocked | EE1 to EE3, CE5 | written for a deployed stage; its local replacement is decided in the Spec 01 Plan stage (CQ6) |
| EE5 Author smoke gate | blocked | EE4, RE6, WE9 | as EE4 |

## Spec 02 read path

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | complete | | closed 18 October 2026; RU8 and RU9 left for RE7 |
| RE1 Aggregate ETag and merge | awaiting reproduction | CE1, CE2, CE5 | `services/read`: `aggregate-etag.ts`, `record-merge.ts`, both proven pure; ETag emission and 304 rules left to RE4 |
| RE2 Read adapters | awaiting reproduction | CE1, CE2, CE5 | `services/read/src/adapters`: `HttpReadAdapter` and the three provider adapters, every §3.3 row tested |
| RE3 Fan-out | awaiting reproduction | CE1, CE2, CE5 | `provider-fan-out.ts`, proven pure; per provider deadline, budget and parent signal; adapters that ignore abort still time out |
| RE4 Read handler | awaiting reproduction | CE1, CE2, CE5 | `read-handler.ts` and the disabled `read-cache-policy.ts`; every §2 to §5 row and RQ4 tested; the Lambda entry point moved to RE5 |
| RE5 ReadPath construct | not started | CE1, CE2, CE5 | |
| RE6 Deployed checks against the mock providers | not started | RE4, CE4 | under RQ1, run locally against the local mock providers; no longer blocked on deployment |
| RE7 Read cache | not scheduled | RD1 | RD1 leaves it unscheduled |

## Spec 03 write path

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | not started | | |
| WE1 State machine and journal store | not started | CE1, CE2, CE5 | |
| WE2 Intake | not started | CE1, CE2, CE5 | CD1 freezes the contract after RE4 and WE2 |
| WE3 Relay and sweep | blocked | WD1 | |
| WE4 Write adapters | not started | CE1, CE2, CE5 | |
| WE5 Worker | blocked | WD1 | |
| WE6 Status handler | not started | CE1, CE2, CE5 | WD4 sets its scope |
| WE7 Operator tooling | not started | CE1, CE2, CE5 | |
| WE8 WritePath construct | not started | WE1 to WE7 | |
| WE9 Deployed checks against the mock providers | blocked | CE4, CE6 | local replacement under CQ6 |

## Decisions

| Decision | State | Answer or what it blocks |
|---|---|---|
| CD1 Contract freeze | answered | freeze after RE4 and WE2 pass against the doubles |
| CD2 Module B | answered | not applied |
| CD3 Who deploys | answered | nobody: the family runs locally (CQ6) |
| CD4 Licence and holder | answered | MIT, `TheScottBot` |
| CD5 Logging the subject | answered | never logged |
| CD6 Section shapes | answered | §3.7 as written |
| CQ1 Lambda runtime | answered | `nodejs24.x` |
| CQ2 CU4 experiment | answered | not run; both scope renderings are read |
| CQ3 Wrapper logging | answered | narrow interfaces injected |
| CQ4 CU9 to CU11 values | answered | Appendix A as written; `sub` bound 255 |
| CQ5 Local Node.js | answered, action open | the author installs 24.22.0; CI pins 24.21.0 too |
| CQ6 Deployed checks | answered | local mock servers, direct invocation, synth assertions; unverified gateway behaviour recorded as deviations |
| CQ7 Provider wire gaps | answered | items 1 to 7 as recommended |
| CQ8 Check 6 as property runs | answered | accepted; `IMPLEMENTATION_DEVIATIONS.md` entry 1 |
| CQ9 `DemoApi` wiring after EE1 | answered | accepted; `IMPLEMENTATION_DEVIATIONS.md` entry 5 |
| ED1 Identity provider | open | EE2 |
| ED2 Per tenant fairness | open | EE3's scope |
| ED3 401 body | open | EE4's 401 assertions |
| RD1 Enable the read cache | answered | switch, synth guard and cold start log only; RE7 unscheduled |
| RQ1 RE6 under CQ6 | answered | an automated suite against the local mock providers |
| RQ2 RU15 latency gate under CQ6 | answered | set aside; deviation entry 7 |
| RQ3 RU author values | answered | Appendix A as written, RU12 100 |
| RQ4 ETags when a provider answers not-found | answered | option (b): not-found counts as complete; a 304 needs the same providers as the client's ETag; deviation entry 8 |
| WD1 Applying commands after a provider outage | open | WE3, WE5 |
| WD2 Canonical form for `requestHash` | open | Spec 03 intake |
| WD3 Retention | open | Spec 03 |
| WD4 Scope for the status route | open | WE6 |

## Open items for the author

- Reproduce CE1 to CE5 and RE1 to RE4 on a clean machine: `TESTING.md`, Running everything locally.
- Push, and see each CI job in `.github/workflows/tree-checks.yml` run (CE3 author gate).
- Install Node.js 24.22.0 locally (CQ5).

## Findings awaiting their owners

Each is set out with its evidence and likely fix in the evaluation record.

| Owner | Finding |
|---|---|
| Spec 00 CE2 | msw 3.0.3 let a request escape interception after a cancelled mocked body and a refused unmatched request (RE2 record); add a catch all network error handler to the doubles, raising the change to CE2's refusal test |
| Spec 00 | wire `DemoApi` into `infra/lib/demo-platform.ts` once EE1 is done (CQ9) |
| Spec 00 CE6 | wire `MockProviders` and pass its connections to the read and write paths; that breaks the CE5 assertion of three functions per stack, to be raised with the author then |
| Spec 00 §2.5 | `README.md`, `CHANGELOG.md`, `SECURITY.md` and `PRIVACY.md` have no owning phase |
| Spec 01 | per route throttling needs L1 `CfnStage.routeSettings`; the exposed CORS headers cannot be derived from header direction alone; the audience check for Cognito tokens |
| Spec 02 | a timed out fetch rejects with `TimeoutError`; adapters must send `Demo-Tenant-Id` (CQ7.1); the four pure files need listing in the tree checks at RE1 (the earlier `max-age` finding is withdrawn) |
| Spec 03 | no fault prefix makes a write time out; a timed out fetch rejects with `TimeoutError` |
