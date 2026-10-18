# Testing

Every suite and check in the demo platform, with its command and where it runs; the testing deviations and their reasons; and every author gate in the family (datum Part 2, Spec 00 §2.5). This file states the present and is rewritten as suites are added.

## Running everything locally

From the repository root, on Node.js 24.22.0 (`.node-version`):

```bash
npm ci
npm run check:prose
npm run check:pure-imports
npm run check:single-definition
npm run typecheck
npm run lint
npm run format:check
npm test
npm run synth
```

## Suites

| Suite | Where | Command | Runs in |
|---|---|---|---|
| Contract package | `packages/contracts/test` | `npm test --workspace packages/contracts` | locally; CI jobs 5 and 6 |
| Shared test doubles | `packages/test-doubles/test` | `npm test --workspace packages/test-doubles` | locally; CI jobs 5 and 6 |
| Construct contracts and stubs | `packages/construct-contracts/test` | `npm test --workspace packages/construct-contracts` | locally; CI jobs 5 and 6 |
| Read path | `services/read/test` | `npm test --workspace services/read` | locally; CI jobs 5 and 6 |
| Mock providers | `services/mock-providers/test` | `npm test --workspace services/mock-providers` | locally; CI jobs 5 and 6 |
| Synth assertions | `infra/test` | `npm test --workspace infra` | locally; CI jobs 5 and 6 |
| Tree check logic | `tree-checks/test` | `npm test` | locally; CI jobs 5 and 6 |

`npm test` runs all of them. The mock provider handlers are tested against `aws-sdk-client-mock` with a fake of the store table that refuses any request the store does not make. Tests are named as sentences: `describe` names the subject and `it` states the behaviour, after the reference implementations. Shared fixtures and doubles live in `packages/test-doubles`; no suite builds its own.

## Tree wide checks (Spec 00 §2.4)

Each runs as its own job in `.github/workflows/tree-checks.yml`, on every pull request and every push to `main`. Each was seen to fail on a planted violation and then pass on the real tree (the CE3 record in `docs/evaluation/ACTUAL_CONTRACT_EVALUATION.md`).

| Check | Job | Command | What it enforces |
|---|---|---|---|
| 1 Prose and typography | `prose-scan` | `npm run check:prose` | datum 0.8: no em or en dash, no double or triple hyphen outside a table separator row or a flag token, no US spelling; over every file git would commit |
| 2 Pure module imports | `pure-imports` | `npm run check:pure-imports` | datum 0.10: the modules in `tree-checks/pure-modules.json` import none of the platform modules listed there; ESLint enforces the same list in the editor |
| 3 Single definition | `single-definition` | `npm run check:single-definition` | datum 0.12: no header name, distinctive bound, route path, contract declaration name or parallel list of contract values is declared outside `packages/contracts` |
| 4 Typecheck and lint | `typecheck-and-lint` | `npm run typecheck`, `npm run lint`, `npm run format:check` | `strict` TypeScript; ESLint with warnings as errors; Prettier |
| 5 Full suite | `test-suite` | `npm test` | on Node.js 24.22.0 and on 24.21.0, the Lambda base image's version (CQ5) |
| 6 Property runs | `property-runs` | `npm test` with `DEMO_PROPERTY_RUNS=1000` | every fast-check property at 1,000 generated inputs rather than 100 |
| 7 Synth | `cdk-synth` | `npm run synth` | `cdk synth` for all four stages |

What the tools cannot express is left to review: quotation marks used for emphasis (datum 0.8), and bounds below 1,000, which are too common as ordinary numbers for check 3 to search for.

## A caution when testing against the msw doubles

In msw 3.0.3, a suite that both cancels a mocked response body and sends a request no double matches can see a later request escape interception (the RE2 record). Every synthetic host is under `example.test`, which never resolves, so an escape fails loudly rather than reaching anything. Until the doubles gain a catch all handler, inject network failures through an adapter's `fetchImplementation` rather than sending an unmatched request.

## Local mock providers

Under CQ6 the mock providers run on this machine: `npm start --workspace services/mock-providers` serves provider-a, provider-b and provider-c on ports 4101, 4102 and 4103, from the same handler the Lambdas run, seeded with the synthetic records and held in memory. Each accepts the synthetic key `syntheticProviderApiKey(providerId)` gives (`packages/test-doubles`). Stop it with Ctrl+C. Tests start their own servers on free ports (`startLocalMockProviders`).

## Property runs

`vitest.setup.ts` sets fast-check's run count for the whole suite from `DEMO_PROPERTY_RUNS`, defaulting to 100; a value that is not a positive whole number fails the run. `tree-checks/test/property-run-configuration.test.ts` proves the count reaches fast-check. The parsers with properties are the command body, the provider response body and headers, and the correlation identifier (`packages/contracts/test/parser-properties.test.ts`). The aggregate ETag parser has its own (`services/read/test/aggregate-etag.test.ts`), as does the record merge. The queue message body (Spec 03) gains its in that stream.

## Memory and undefined behaviour analysis (datum 0.10)

Spec 00 §2.4 asks what the pinned Node.js toolchain offers. Read from `node --help` on v22.23.2, 18 October 2026: nothing that performs memory or undefined behaviour analysis on JavaScript. V8 is memory safe, so the sanitisers datum 0.10 has in mind have no JavaScript counterpart, and Module A is not applied (Spec 00, Applying the datum). The nearest options are hardening and diagnostics, none of them analysis, and none used: `--permission`, `--frozen-intrinsics`, `--disallow-code-generation-from-strings`, `--abort-on-uncaught-exception` and the heap profiler (`--heap-prof`). This is to be read again on Node.js 24 once CQ5 is done.

## Testing deviations

Each is recorded in full in `IMPLEMENTATION_DEVIATIONS.md`.

- Check 6 is property based random generation, not coverage guided fuzzing.
- Nothing is deployed (CQ6): the deployed checks EE4, EE5, RE6 and WE9 are replaced by local equivalents, and gateway behaviour that nothing local can exercise is recorded as unverified.
- CU4 (how the gateway renders the scope claim) is unsettled; both renderings are tested.

## Author gates

Only the author can clear these, and the agent never claims one has passed (datum 0.17 item 19).

| Gate | Owner | State |
|---|---|---|
| Reproduce each phase's automated criteria on a clean machine (datum Stage three) | every phase | outstanding for CE1 to CE5 and RE1 to RE3 |
| See each CI job fail on a planted violation and pass, on GitHub | Spec 00 CE3 | outstanding: needs a push; proven locally only |
| Install Node.js 24.22.0 locally (CQ5) | Spec 00 | outstanding; an action rather than a gate, listed so it is not lost |
| The manual smoke check through the public API | Spec 01 EE5 | to be redefined under CQ6 in the Spec 01 Plan stage |
| The deployed checks against the stubs | Spec 01 EE4 | to be redefined under CQ6 |
| The deployed read checks | Spec 02 RE6 | no longer a gate: RQ1 makes RE6 an automated suite against the local mock providers |
| The latency target RU15 | Spec 02 RE6 | set aside under CQ6 (RQ2; `IMPLEMENTATION_DEVIATIONS.md` entry 7) |
| The deployed write checks, and resolving the `poison-` operation | Spec 03 WE9 | to be redefined under CQ6 |
