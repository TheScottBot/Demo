# Implementation tracker

Where the demo platform stands, phase by phase. This file states the present and is rewritten whenever the state changes: at the start and end of every phase, and whenever the author answers a decision. The evidence behind each line (sources read, tests first, planted regressions, reproduction reports) lives in `docs/evaluation/ACTUAL_CONTRACT_EVALUATION.md`, and the contract's change record in `packages/contracts/CONTRACT.md`.

Last updated: 18 October 2026.

## Next up

Spec 01 is built as far as the agent can take it: EE1 to EE3 await reproduction, EE4 is set aside, and EE5's `npm run smoke:local` waits on the author's own run. `DemoApi` is wired into `infra` on the demo user pool. Specs 02 and 03 are built as far as they go (RE1 to RE6 and WE1 to WE9 await reproduction). CE6 (wiring the real constructs) is unblocked and not started. A local demonstration runs the platform as separate local servers: `npm run demo:local`, described in `docs/LOCAL_DEMO.md`. The contract is frozen at `@demo/contracts` 1.2.0, since EQ6.

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
| Workspaces | `packages/contracts`, `packages/test-doubles`, `packages/construct-contracts`, `services/mock-providers`, `services/read`, `services/write`, `services/entry`, `infra` |
| Suite | 71 files, 1,301 tests, and all seven tree checks passing on 18 October 2026 |

## Spec 00 shared contracts

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | complete | | closed 18 October 2026; CU4 left unsettled by design under CQ6 |
| CE1 Contract package | awaiting reproduction | Plan stage | `packages/contracts`; amended in CE2 for the `sub` bound, `no-store` and the CQ7 wire rules; frozen at 1.0.0 (CD1) after the doubled path fix |
| CE2 Shared test doubles | awaiting reproduction | CE1 | `packages/test-doubles`: event builder, synthetic records, provider simulation, msw doubles |
| CE3 Tree wide checks | awaiting reproduction | CE1 | seven checks in `.github/workflows/tree-checks.yml`, each proven locally on a planted violation; seeing them run on GitHub needs a push (author gate); `TESTING.md` and `IMPLEMENTATION_DEVIATIONS.md` written |
| CE4 Mock providers | awaiting reproduction | CE1, CE2 | `services/mock-providers`: handlers, DynamoDB store, seed scripts and construct, all synthesising; local servers run the same handler (`npm start --workspace services/mock-providers`); deployment and seeding replaced under CQ6 |
| CE5 Construct contracts and stubs | awaiting reproduction | CE1 | `packages/construct-contracts` and `infra`: §3.11 interfaces, naming, stubs, Powertools adapter, one stack per stage; `DemoApi` wiring waits for EE1 (circular as drafted); amended in RE5 with the `./runtime` subpath and `activeTracing` |
| CE6 Wiring real constructs | not started | RE5, WE8, EE3 | RE5, WE8 and EE3 are built; `ReadPath` and `WritePath` replace the stubs here; `DemoApi` is already wired |

## Spec 01 entry point

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | complete | | closed 18 October 2026; deviation entries 12 to 14 |
| EE1 DemoApi against stubs | awaiting reproduction | CE5 | `services/entry`: `DemoApi`, its three routes from the contract, the JWT authoriser; the demo pool refused until EE2 |
| EE2 Identity provider | awaiting reproduction | CE5 | `DemoUserPool`: Essentials, `V3_0` trigger, resource server `demo`, one client per tenant holding its own tenant scope (EQ3, EQ5), the §4.2 synth guard; contract 1.2.0 (EQ6) |
| EE3 Throttling, CORS, logs and alarms | awaiting reproduction | CE5 | route throttles, CORS from the contract headers, structured access logs, four alarms; `DemoApi` wired into `infra` |
| EE4 Deployed checks against the stubs | set aside | EE1 to EE3, CE5 | until a stage is deployed (EQ1); deviation entry 13 |
| EE5 Author smoke gate | awaiting author gate | EE1 to EE3, RE6, WE9 | `npm run smoke:local` is built; the author runs it by hand and records it in `TESTING.md` (EQ2); deviation entry 14 |

## Spec 02 read path

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | complete | | closed 18 October 2026; RU8 and RU9 left for RE7 |
| RE1 Aggregate ETag and merge | awaiting reproduction | CE1, CE2, CE5 | `services/read`: `aggregate-etag.ts`, `record-merge.ts`, both proven pure; ETag emission and 304 rules left to RE4 |
| RE2 Read adapters | awaiting reproduction | CE1, CE2, CE5 | `services/read/src/adapters`: `HttpReadAdapter` and the three provider adapters, every §3.3 row tested |
| RE3 Fan-out | awaiting reproduction | CE1, CE2, CE5 | `provider-fan-out.ts`, proven pure; per provider deadline, budget and parent signal; adapters that ignore abort still time out |
| RE4 Read handler | awaiting reproduction | CE1, CE2, CE5 | `read-handler.ts` and the disabled `read-cache-policy.ts`; every §2 to §5 row and RQ4 tested; the Lambda entry point moved to RE5 |
| RE5 ReadPath construct | awaiting reproduction | CE1, CE2, CE5 | `read-path-construct.ts`, `read-handler-entry.ts`, configuration and Powertools observability; the entry bundle is proven free of CDK and test doubles; not wired into `infra` until CE6 |
| RE6 Deployed checks against the mock providers | awaiting reproduction | RE4, CE4 | `infra/test/read.spec.ts`: under RQ1, the read entry point, configured as the construct deploys it, invoked directly against the local mock provider servers; Spec 02's seven checks plus one that nothing logged carries a key or the subject; CI run needs a push |
| RE7 Read cache | not scheduled | RD1 | RD1 leaves it unscheduled |

## Spec 03 write path

| Phase | Status | Depends on | Note |
|---|---|---|---|
| Plan stage | complete | | closed 18 October 2026; deviation entries 9 (WD1) and 10 (WQ2) |
| WE1 State machine and journal store | awaiting reproduction | CE1, CE2, CE5 | `services/write`: the pure state machine, the journal store, the `CommandJournal` table construct, and a fake table for later phases |
| WE2 Intake | awaiting reproduction | CE1, CE2, CE5 | `intake-handler.ts`, `request-hash.ts` (pure), `operation-status-mapping.ts`; meets CD1's condition for the freeze |
| WE3 Relay and sweep | awaiting reproduction | CE1, CE2, CE5 | `enqueue-operation.ts`, the relay and sweep handlers and entries, `message-group.ts` (pure), the `CommandRelay` construct |
| WE4 Write adapters | awaiting reproduction | CE1, CE2, CE5 | `HttpWriteAdapter`, the three provider adapters, and a Spec 00 runtime transport module shared with the read path |
| WE5 Worker | awaiting reproduction | CE1, CE2, CE5 | `worker-handler.ts`, `retry-backoff.ts` (pure), the `CommandWorker` construct with both queues; carries the covering tests of deviation entries 9 and 11 |
| WE6 Status handler | awaiting reproduction | CE1, CE2, CE5 | `status-handler.ts`, requiring `records:write` (WD4); its function is WE8's |
| WE7 Operator tooling | awaiting reproduction | CE1, CE2, CE5 | `dead-letter-decisions.ts` (pure), the operator, and the `dlq:inspect` and `dlq:resolve` scripts; built and tested, not run (CQ6) |
| WE8 WritePath construct | awaiting reproduction | WE1 to WE7 | `WritePath`, the intake and status functions and entries, and §11's six alarms; not wired into `infra` until CE6 |
| WE9 Deployed checks against the mock providers | awaiting reproduction | WE1 to WE8, CE4 | `infra/test/write.spec.ts`: every WE9 row against the local mock providers, through the real handlers, an in-memory stream and FIFO queue; the `poison-` operation resolved locally; CI run needs a push |

## Decisions

| Decision | State | Answer or what it blocks |
|---|---|---|
| CD1 Contract freeze | answered, done | frozen at `@demo/contracts` 1.0.0 on 18 October 2026, by the author; 1.1.0 since WQ8, 1.2.0 since EQ6; see `packages/contracts/CONTRACT.md` |
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
| ED1 Identity provider | answered | the demo user pool, Essentials, `V3_0` trigger |
| ED2 Per tenant fairness | answered | accepted for the demo; `SECURITY.md` to record it |
| ED3 401 body | answered | accepted; deviation entry 12 |
| EQ1 EE4 under CQ6 | answered | set aside until deployed; deviation entry 13 |
| EQ2 EE5 under CQ6 | answered | `npm run smoke:local`, run by the author; deviation entry 14 |
| EQ3 The tenant of a client credentials token | answered | one app client per tenant, mapped by client identifier |
| EQ4 EU author values | answered | Appendix A as written |
| EQ5 The tenant without a client table | answered | one tenant scope per tenant, each client allowed its own; the mapping reads and suppresses it |
| EQ6 Prefixed Cognito scopes | answered | accept both forms; released as `@demo/contracts` 1.2.0 |
| RD1 Enable the read cache | answered | switch, synth guard and cold start log only; RE7 unscheduled |
| RQ1 RE6 under CQ6 | answered | an automated suite against the local mock providers |
| RQ2 RU15 latency gate under CQ6 | answered | set aside; deviation entry 7 |
| RQ3 RU author values | answered | Appendix A as written, RU12 100 |
| RQ4 ETags when a provider answers not-found | answered | option (b): not-found counts as complete; a 304 needs the same providers as the client's ETag; deviation entry 8 |
| WD1 Applying commands after a provider outage | answered | keep the queue; deviation entry 9 |
| WD2 Canonical form for `requestHash` | answered | a pure function, `request-hash.ts` |
| WD3 Retention | answered | operations 30 days, idempotency entries 7 days; `PRIVACY.md` to state them |
| WD4 Scope for the status route | answered | `records:write` |
| WQ1 WE9 under CQ6 | answered | an automated local suite; no longer an author gate |
| WQ2 AWS behaviours nothing local shows (WU1, WU16, WU18) | answered | unverified, each outcome safe; deviation entry 10 |
| WQ3 Provider answers §6.5 does not map (401, 428, others) | answered | `retryable`, with a reason category each |
| WQ4 Bounding a base64 encoded command body | answered | encoded length bounded before decoding, decoded bytes after |
| WQ5 WU author values | answered | Appendix A as written; jitter subtracts; WU20 synth constants |
| WQ6 Relay stream mapping values | answered | as built: batch size 10, 3 retries, 1 hour record age, `TRIM_HORIZON`, failure queue kept 14 days |
| WQ7 Provider `Idempotency-Key` from the worker | answered | the client's own key; deviation entry 11 |
| WQ8 Status route scope in the frozen contract | answered | released as `@demo/contracts` 1.1.0, with `records:write` |

## Open items for the author

- Reproduce CE1 to CE5, RE1 to RE6, WE1 to WE9 and EE1 to EE3 on a clean machine: `TESTING.md`, Running everything locally.
- Push, and see each CI job in `.github/workflows/tree-checks.yml` run (CE3 author gate).
- Install Node.js 24.22.0 locally (CQ5).
- Run `npm run smoke:local` and record the result in `TESTING.md` (EE5).
- Review the choices EE3 made under your delegated authority (EE3 record): the allowed origin `http://localhost:3000`, the access log group's name, and CE5's changed assertions.
- Review the decisions the local demonstration made under your authority (its record): separate processes, demo tokens, no CORS at the local gateway, WE9's write model, the pump, and the 1 MiB limit.
- Write `SECURITY.md` (Spec 01 §6) in your own words, or give them to the agent: that handlers trust gateway verified claims; the ED2 fairness limit; the ED3 401 body; what the demo user pool is and is not fit for.

## Findings awaiting their owners

Each is set out with its evidence and likely fix in the evaluation record.

| Owner | Finding |
|---|---|
| Spec 00 CE2 | msw 3.0.3 let a request escape interception after a cancelled mocked body and a refused unmatched request (RE2 record); add a catch all network error handler to the doubles, raising the change to CE2's refusal test |
| Spec 00 CE6 | wire `MockProviders` and pass its connections to the read and write paths; that breaks the CE5 assertion of three functions per stack, to be raised with the author then |
| Spec 00 §2.5 | `README.md`, `CHANGELOG.md`, `SECURITY.md` and `PRIVACY.md` have no owning phase |
| Spec 01 | per route throttling needs L1 `CfnStage.routeSettings`; the exposed CORS headers cannot be derived from header direction alone |
| Spec 02 | a timed out fetch rejects with `TimeoutError`; adapters must send `Demo-Tenant-Id` (CQ7.1); the four pure files need listing in the tree checks at RE1 (the earlier `max-age` finding is withdrawn) |
| Spec 03 | `OperatorAction` from an operator's terminal is printed, not ingested by CloudWatch (WE7 record); WE9's ordering row needs each command written against the version the last leaves (WE5 record); §4.4 lists five store exports where there are now seven; §11 lacks `ProviderRetryAfterIgnored` |
| Spec 00 CE5 | `demo-nodejs-function.test.ts` failed once on the first run after a clean install, then passed three times (WE1 record) |
| Spec 02 RE2 | `http-read-adapter.ts` keeps private copies of the transport pieces `@demo/construct-contracts/runtime` now shares (WE4 record) |
