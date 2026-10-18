# Implementation tracker

Where the demo platform stands, phase by phase. This file states the present and is rewritten whenever the state changes: at the start and end of every phase, and whenever the author answers a decision. The evidence behind each line (sources read, tests first, planted regressions, reproduction reports) lives in `docs/evaluation/ACTUAL_CONTRACT_EVALUATION.md`, and the contract's change record in `packages/contracts/CONTRACT.md`.

Last updated: 18 October 2026.

## Next up

With CE1, CE2, CE3 and CE5 built, every stream can start once the author has reproduced them: the Spec 01, 02 and 03 Plan stages, then EE1 to EE3, RE1 to RE5, and WE1, WE2, WE4, WE6 and WE7. CE4, the local mock provider servers, is the one Spec 00 build phase left before the streams need it (RE6, WE9); the agent recommends it next, unless the author would rather start a stream's Plan stage.

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
| Workspaces | `packages/contracts`, `packages/test-doubles`, `packages/construct-contracts`, `infra` |
| Suite | 28 files, 666 tests, and all seven tree checks passing on 18 October 2026 |

## Spec 00 shared contracts

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | complete | | closed 18 October 2026; CU4 left unsettled by design under CQ6 |
| CE1 Contract package | awaiting reproduction | Plan stage | `packages/contracts`; amended in CE2 for the `sub` bound, `no-store` and the CQ7 wire rules |
| CE2 Shared test doubles | awaiting reproduction | CE1 | `packages/test-doubles`: event builder, synthetic records, provider simulation, msw doubles |
| CE3 Tree wide checks | awaiting reproduction | CE1 | seven checks in `.github/workflows/tree-checks.yml`, each proven locally on a planted violation; seeing them run on GitHub needs a push (author gate); `TESTING.md` and `IMPLEMENTATION_DEVIATIONS.md` written |
| CE4 Mock providers | not started | CE1, CE2 | under CQ6, local Node.js servers wrapping `simulateProviderRequest`; deployment and seeding to AWS replaced |
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
| Plan stage | not started | | |
| RE1 Aggregate ETag and merge | not started | CE1, CE2, CE5 | |
| RE2 Read adapters | not started | CE1, CE2, CE5 | use the msw doubles; see the `max-age` finding |
| RE3 Fan-out | not started | CE1, CE2, CE5 | |
| RE4 Read handler | not started | CE1, CE2, CE5 | CD1 freezes the contract after RE4 and WE2 |
| RE5 ReadPath construct | not started | CE1, CE2, CE5 | |
| RE6 Deployed checks against the mock providers | blocked | CE4, CE6 | local replacement under CQ6 |
| RE7 Read cache | blocked | RD1 | not in Spec 00's delivery table |

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
| CQ8 Check 6 as property runs | open | accepting `IMPLEMENTATION_DEVIATIONS.md` entry 1 |
| CQ9 `DemoApi` wiring after EE1 | open | accepting `IMPLEMENTATION_DEVIATIONS.md` entry 5 |
| ED1 Identity provider | open | EE2 |
| ED2 Per tenant fairness | open | EE3's scope |
| ED3 401 body | open | EE4's 401 assertions |
| RD1 Enable the read cache | open | RE7 |
| WD1 Applying commands after a provider outage | open | WE3, WE5 |
| WD2 Canonical form for `requestHash` | open | Spec 03 intake |
| WD3 Retention | open | Spec 03 |
| WD4 Scope for the status route | open | WE6 |

## Open items for the author

- Reproduce CE1, CE2, CE3 and CE5 on a clean machine: `TESTING.md`, Running everything locally.
- Push, and see each CI job in `.github/workflows/tree-checks.yml` run (CE3 author gate).
- Answer CQ8 and CQ9 (Decisions, above).
- Install Node.js 24.22.0 locally (CQ5).

## Findings awaiting their owners

Each is set out with its evidence and likely fix in the evaluation record.

| Owner | Finding |
|---|---|
| Spec 00 | wire `DemoApi` into `infra/lib/demo-platform.ts` once EE1 is done |
| Spec 00 | a shared `NodejsFunction` props helper, so Specs 02 and 03 reuse the runtime, banner and `NODE_OPTIONS` the stubs use |
| Spec 00 §2.5 | `README.md`, `CHANGELOG.md`, `SECURITY.md` and `PRIVACY.md` have no owning phase |
| Spec 01 | per route throttling needs L1 `CfnStage.routeSettings`; the exposed CORS headers cannot be derived from header direction alone; the audience check for Cognito tokens |
| Spec 02 | an over bound `max-age` is refused by the contract, not capped; a timed out fetch rejects with `TimeoutError` |
| Spec 03 | no fault prefix makes a write time out; a timed out fetch rejects with `TimeoutError` |
