# Actual contract evaluation

The Plan stage record for the demo platform family, kept under `ENGINEERING_DATUM.md` version 2, Stage one. Each specification has its own top level section, so the four Plan stages write in parallel without colliding (Spec 00 §2.5).

Every entry says whether its claim was **read** from source or **run** as an experiment. Nothing here comes from memory, a search snippet or a forum post. Where a value could not be settled, the entry says so and names what blocks it.

# Spec 00 shared contracts

Plan stage started 18 October 2026. Status: evidence gathered; author decisions outstanding (see Decisions still needing the author, at the end of this section).

## Environment used for the Plan stage

| Item | Value | Basis |
|---|---|---|
| Development machine | Windows 11 Home 10.0.26200 | read |
| Local Node.js | v22.23.2 | run (`node --version`) |
| Local npm | 10.9.8 | run |
| git | 2.55.0.windows.3 | run |
| AWS CLI, CDK CLI | not installed | run |
| AWS account access | none | no experiment touched AWS |

All downloads and experiments ran in a scratch directory outside the repository. No install script of any package was run (`npm install --ignore-scripts`, `npm pack`).

## Reference implementations

Datum, Reference implementations, and Stage one.

| Repository | Exists at exact path | Default branch | Commit read | Commit date |
|---|---|---|---|---|
| `https://github.com/FtrOnOff/FtrIO` | yes | `main` | `7e214d5b3d62d31333031413b43f69d9c7e65a7d` | 2026-06-26 |
| `https://github.com/FtrOnOff/ftrio-python` | yes | `main` | `b95ec4e1feaf1b3c74a30a43edd5e03c90f7ad68` | 2026-07-08 |
| `https://github.com/FtrOnOff/ftrio-rust` | yes | `main` | `e814d40758eb3524d64e9e40688bb8c59de65989` | 2026-07-09 |

Existence was confirmed with `git ls-remote` and the GitHub API before cloning into scratch. Retrieved 18 October 2026. Basis: read.

Observed:

- None of the three repositories has a prose and typography scan, a pure import check, a contract digest check or a fuzz job in continuous integration. FtrIO itself contains em dashes and an en dash (for example in `CHANGELOG.md`). The Python and Rust ports contain none, and the Rust changelog writes `## [0.1.2], 2026-07-08`, which suggests a deliberate move away from dashes (inferred).
- None carries `TESTING.md`, `IMPLEMENTATION_DEVIATIONS.md`, `SECURITY.md`, `PRIVACY.md`, a contract document or an evaluation record. The nearest equivalent is `PORTING_NOTES.md` in both ports.
- `PORTING_NOTES.md` opens with its guiding rule, then one section per mechanism with a one line justification, rename tables, and fixed closing sections: Additive, Naming convention, Style guide conformance, Components intentionally not ported verbatim, and (Rust) Dependency choices. Each additive item is also marked in the code at the point of departure.
- `CHANGELOG.md` follows Keep a Changelog 1.1.0 with Semantic Versioning, with `### Added` and `### Changed` sections.
- `LICENSE` is MIT in FtrIO (holder `TheScottBot`) and ftrio-rust (holder `FtrIO`); ftrio-python has no `LICENSE` file and declares MIT in `pyproject.toml`.
- Naming: interfaces without an `I` prefix; a concrete class named for what it reads where a clash would arise (`AppSettingsToggleParser`); acronyms as one word in Rust (`AbTestStrategy`), enforced by lint; verbose names stated as policy in `pyproject.toml`.
- Tests: sentence style names (`BooleanStrategy_CanHandle_ReturnsTrueForValidBooleanValues`, `percentage_boundaries_are_deterministic`); unit and integration folders; test modules name the source they cover.
- Test doubles: named by role (`FakeContextAccessor`, `_SpyToggleBuffer`) or with a `TestDouble` suffix, kept in shared helpers, and asserted to satisfy the interface they stand in for.
- Errors: a small, semantically distinct set (`ToggleDoesNotExistError`, Rust `ToggleError` variants); network failures kept out of the domain error type.
- Comments lead with the reason. Module headers name the counterpart and why a change was made. Workflow steps carry a comment saying why each gate exists.
- Test isolation: process global state reset before each test; per test temporary directories; golden vectors shared verbatim across languages.
- Continuous integration: format check, lint with warnings denied, the full suite, a minimum toolchain job that builds on exactly the claimed minimum version, and release workflows that check the tag against the manifest version.

Taken into this family:

- `IMPLEMENTATION_DEVIATIONS.md` follows the `PORTING_NOTES.md` skeleton: the governing rule, one section per departure with its rule, what is done instead, the reason, the author's decision and the covering test (datum Part 2), and a comment at the point of departure in the code.
- `CHANGELOG.md` follows Keep a Changelog 1.1.0, with the per tag content datum Stage three requires.
- Type names in PascalCase without an `I` prefix, acronyms as one word (`HttpProblem`, not `HTTPProblem`), enforced by a typescript-eslint naming convention rule.
- vitest names as sentences: `describe` names the subject, `it` states the behaviour; table driven cases with `it.each`.
- Test doubles named by role in `packages/test-doubles`, each checked with `satisfies` against the interface it stands in for.
- A minimum toolchain job pinned to the exact Node.js version the family claims.
- Every continuous integration step commented with why it exists.

Not taken: the .NET and Cargo specifics; the FtrIO changelog's dash style, which the datum forbids.

Uncertainty: the prose scan, the pure import check, the single definition check and the fuzz job have no precedent in the reference implementations. CE3 designs them from the datum alone.

## CU1 Lambda Node.js runtime

Basis: read. Retrieved 18 October 2026.

Sources:

- `https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html` (no last updated date shown)
- `https://docs.aws.amazon.com/lambda/latest/api/API_CreateFunction.html`
- `https://github.com/aws/aws-lambda-base-images`, branch `nodejs22.x` at `144c260dbd44204be8446fbc6b16cdbb767665a5` (2026-10-14), branch `nodejs24.x` at `3eced94285886d673beff15fa8322868c3a91d33` (2026-10-14); arm64 layer files `var/lang/include/node/node_version.h` and `var/runtime/runtime-release`, read from the tarballs without executing anything

Observed:

| Identifier | OS | Deprecation | Block create | Block update |
|---|---|---|---|---|
| `nodejs22.x` | Amazon Linux 2023 | 30 April 2027 | 29 July 2027 | 31 August 2027 |
| `nodejs24.x` | Amazon Linux 2023 | 30 April 2028 | 1 June 2028 | 1 July 2028 |
| `nodejs26.x` | Amazon Linux 2023 | public preview, not for production | | |

- The runtimes page states that every supported runtime supports both x86_64 and arm64. The CreateFunction default architecture is x86_64, so arm64 must be set explicitly.
- The base images carry Node.js 22.23.3 (`VERSION=22.23.3-6abfd0e4`) and Node.js 24.21.0 (`VERSION=24.21.0-6ac923fd`).
- The dates are stated as subject to change.

Uncertainties: the base image version is an AWS published artefact for the container image, not a guarantee of the managed runtime's version in a given region on a given day. Lambda updates managed runtimes automatically. The authoritative reading is `process.version` inside a deployed function.

Conclusions:

- CU1 as written holds: `nodejs22.x` exists on arm64.
- `nodejs22.x` is deprecated about six months after this record. Whether the family moves to `nodejs24.x` is an author decision (CQ1 below), because §2.1 names Node.js 22.
- Pin the major runtime only. Lambda's patch version is recorded at the first deployed check, by logging `process.version` at cold start.
- The local machine runs v22.23.2, one patch behind the base image's v22.23.3.

(18 October 2026: the author chose `nodejs24.x` under CQ1. The family targets `Runtime.NODEJS_24_X` on arm64, a departure from §2.1's Node.js 22 candidate. The base image carries Node.js 24.21.0; nodejs.org lists v24.22.0, 14 October 2026, as the latest Node.js 24 LTS, Krypton. Read from `https://nodejs.org/dist/index.json` the same day. The local machine still runs v22.23.2, so local runs do not yet match the target runtime; see CQ5.)

## CU2 AWS CDK v2 construct names

Basis: read, from the published tarballs. Retrieved 18 October 2026.

| Package | Version | Published | Licence | Engines |
|---|---|---|---|---|
| `aws-cdk-lib` | 2.273.0 | 2026-10-08 | Apache-2.0 | node >= 20.0.0 |
| `aws-cdk` (CLI) | 2.1145.0 | 2026-10-08 | Apache-2.0 | node >= 18.0.0 |
| `constructs` | 10.8.1 | 2026-08-03 | Apache-2.0 | none |

`aws-cdk-lib` 2.273.0 declares the peer dependency `constructs ^10.5.0`.

Observed in `aws-cdk-lib` 2.273.0:

- `aws-lambda-nodejs/lib/function.d.ts`: `NodejsFunction` with `entry`, `handler`, `runtime`, `depsLockFilePath`, `projectRoot`, `bundling`; `architecture` inherited from `aws-lambda` `FunctionOptions`.
- With no `runtime`, `NodejsFunction` falls back to a feature flag dependent default. The family sets `runtime` explicitly.
- `aws-lambda-nodejs/lib/types.d.ts`: `BundlingOptions` has `minify`, `sourceMap`, `sourceMapMode`, `banner`, `externalModules`, `format` (`OutputFormat.CJS` by default, `OutputFormat.ESM` available), `forceDockerBundling`, `bundleAwsSDK`.
- `aws-lambda-nodejs/lib/bundling.js`: esbuild is used locally if found, otherwise Docker bundling is used; a local esbuild must be a `0.x` version. The default externals are `@aws-sdk/*` for an explicit runtime, and nothing (the SDK is bundled) for the variable `NODEJS_LATEST`.
- `aws-lambda/lib/runtime.d.ts`: `Runtime.NODEJS_22_X` (`nodejs22.x`) and `Runtime.NODEJS_24_X` (`nodejs24.x`) exist; `Architecture.ARM_64` exists.
- `aws-lambda/lib/function.d.ts` line 162: `timeout` defaults to `Duration.seconds(3)`.
- `aws-apigatewayv2`: `HttpApi`, `HttpRoute`, `HttpRouteKey`, `HttpMethod`, `CorsHttpMethod`, `HttpStage` are stable (no experimental marker). `HttpStage` takes `throttle` (`rateLimit`, `burstLimit`) mapped to the stage's default route settings, and `accessLogSettings`. The default stage that `HttpApi` creates accepts no throttle. Per route throttling exists only on L1 `CfnStage.routeSettings`.
- `aws-apigatewayv2-authorizers`: `new HttpJwtAuthorizer(id, jwtIssuer, { jwtAudience, identitySource?, authorizerName? })`; `identitySource` defaults to `$request.header.Authorization`.
- `aws-apigatewayv2-integrations`: `new HttpLambdaIntegration(id, handler, { payloadFormatVersion?, timeout?, parameterMapping?, scopePermissionToRoute? })`; payload format defaults to 2.0; `timeout` documented as 50 ms to 29 seconds. `completeBind` calls `handler.addPermission` for `apigateway.amazonaws.com`, scoped to the route path.
- `assertions`: `Template.fromStack`, `resourceCountIs`, `hasResourceProperties`, `findResources`, and `Match.objectLike`, `arrayWith`, `absent`, `exact`, `not`, `stringLikeRegexp` exist.

Uncertainties: which CLI versions are compatible with `aws-cdk-lib` 2.273.0 was not read from a primary statement; pin both at their latest together. Whether `Template.fromStack` runs esbuild during a test is inferred and checked at CE5.

Conclusions:

- CU2 holds for every construct name §2.1 and §3.11 rely on.
- Pin `aws-cdk-lib` 2.273.0, `aws-cdk` 2.1145.0, `constructs` 10.8.1, and esbuild as a local devDependency, so synth needs no Docker.
- Set `runtime` and `architecture` explicitly on every function. Do not use `NODEJS_LATEST`, since it changes under the family without a version decision.
- ESM bundles need a hand set `createRequire` banner (CU5).
- The mock provider Lambdas (CE4) must set a timeout above CU9, since the default 3 seconds is not above 3,000 ms.

## CU3 Payload format 2.0

Basis: read. Retrieved 18 October 2026.

Sources:

- `https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html`
- `@types/aws-lambda` 8.10.164 tarball (registry time 2026-09-29), files `trigger/api-gateway-proxy.d.ts` and `handler.d.ts`

Observed:

- The 2.0 event has `routeKey`, `rawPath`, `rawQueryString`, `cookies`, `headers`, `queryStringParameters`, `pathParameters`, `isBase64Encoded`, `body`, `requestContext.authorizer.jwt.claims` (object) and `requestContext.authorizer.jwt.scopes` (array).
- Header names are lower cased. Duplicate headers are joined with commas.
- `APIGatewayProxyEventV2WithJWTAuthorizer` exists. Its `jwt.claims` is typed `{ [name: string]: string | number | boolean | string[] }` and `jwt.scopes` is `string[] | null`.
- `APIGatewayProxyStructuredResultV2` has optional `statusCode`, `headers`, `body`, `isBase64Encoded`, `cookies`.
- `Context` has `awsRequestId`, `functionName`, `getRemainingTimeInMillis()` and the other documented fields.

Uncertainties: the `claims` value union is the DefinitelyTyped authors' typing, not an AWS statement.

Conclusions:

- CU3 holds. `DemoHttpHandler` in §3.11 can be written as specified against `@types/aws-lambda` 8.10.164.
- Every handler reads headers by their lower case names. The header constants in `packages/contracts` carry both the canonical wire name, used for responses and CORS lists, and the lower case lookup key, derived from it in one place.
- A comma joined duplicate `X-Correlation-Id` or `Idempotency-Key` fails the §3.3 grammar and is refused, which is the wanted behaviour.

## CU4 Scope claim delivery

Basis: read; the experiment the datum requires is not yet run. Retrieved 18 October 2026.

Sources:

- `https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html`
- `https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html`
- `https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging-variables.html`

Observed:

- The authoriser checks route scopes against the `scope` or `scp` claim, and passes the token's claims to the integration.
- Cognito access tokens carry `scope` as one space separated string, and `client_id`. They carry `aud` only when the application requested a resource binding.
- The authoriser checks `client_id` against its audiences only when `aud` is absent.
- No AWS page states how `claims.scope` is rendered to the handler, how array or numeric claims are rendered, or when `jwt.scopes` is populated.

Uncertainties: all three rendering questions remain. Only an experiment on a throwaway stack answers them, and no AWS account is available to the agent (CD3).

Conclusions:

- CU4 is not settled. CQ2 below asks how the experiment is run.
- Until it is, `readAuthenticationContext` is specified to accept `scope` as a space separated string or as an array of strings, each within §3.3, and to refuse anything else as `unauthorised`. The tests cover both forms. This tolerates an unsettled platform rendering; it does not widen the contract.

## CU5 Powertools for AWS Lambda (TypeScript)

Basis: read, from the published tarballs and `https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/`. Retrieved 18 October 2026.

Observed:

- `@aws-lambda-powertools/logger`, `/tracer` and `/metrics` are each at 2.36.0 (2026-10-06), licence MIT-0, released in lockstep about monthly. None declares `engines`. Each ships CommonJS and ESM builds.
- Tracer depends on `aws-xray-sdk-core ^3.12.0`. All three take `@middy/core` 4.x to 7.x as an optional peer.
- Logger: options `serviceName`, `logLevel`, `persistentKeys`, `jsonReplacerFn`; methods `appendKeys`, `appendPersistentKeys`, `removeKeys`, `resetKeys`, `addContext`; `injectLambdaContext` as a method decorator or as middy middleware from `@aws-lambda-powertools/logger/middleware`.
- Metrics: options `namespace`, `serviceName`, `defaultDimensions`; `addMetric(name, unit, value)`, `addDimension`, `publishStoredMetrics`, `logMetrics`; `MetricUnit` is a const object.
- Tracer: `captureAWSv3Client`, `captureLambdaHandler`, `putAnnotation`.
- The Tracer documentation states that it relies on a CommonJS dependency, and gives a `createRequire` banner for ESM bundles.

Uncertainties: no published Node.js support matrix was found; the Lambda layer sample lists `nodejs22.x` and `nodejs24.x`.

Conclusions:

- CU5 holds. Pin 2.36.0 for all three.
- ESM bundles set `bundling.banner` to the `createRequire` line the Tracer documentation gives.
- Design consequence for CE1: `withHttpProblemHandling` must bind the correlation identifier to the logger and emit `RequestRejected`, yet `packages/contracts` is pure and may not import `@aws-lambda-powertools/*` (§2.4 check 2). The wrapper therefore takes narrow logging and metrics interfaces defined in `packages/contracts`, which each service satisfies with its Powertools instances. CQ3 below confirms this.

## CU6 Test tool versions

Basis: read from registry metadata and tarballs; run for msw, zod and aws-sdk-client-mock. Retrieved 18 October 2026.

Observed and run:

- vitest 5.0.5 (2026-10-15), engines `^22.12.0 || ^24.0.0 || >=26.0.0`; `@vitest/coverage-v8` 5.0.5 is pinned to the same version.
- msw 3.0.3 (2026-10-10), engines `>=22.12.0`. The v2 imports (`http`, `HttpResponse` from `msw`, `setupServer` from `msw/node`) still exist. Run: it intercepts Node.js 22 global `fetch`. Run: `server.listen({ onUnhandledRequest: 'error' })` is silently ignored in 3.0.3 and an unmatched request reaches the network; `onUnhandledFrame: 'error'` refuses it. msw 2.15.0 is the last 2.x and still uses `onUnhandledRequest`.
- fast-check 4.10.2 (2026-09-19); `@fast-check/vitest` 0.5.0 takes vitest 4.1 or 5 as a peer.
- aws-sdk-client-mock 4.1.0, last published 2024-10-15. Run: it mocks `@aws-sdk/client-dynamodb` 3.1152.0 correctly at run time. Its type declarations import `@smithy/types` without declaring it; a type check against current versions was not run. `aws-sdk-client-mock-vitest` 8.0.0 takes vitest 5 as a peer.

Experiment, msw (Node.js v22.23.2, msw 3.0.3, `onUnhandledFrame: 'error'`):

```text
global fetch: 201 {"id":"42","mocked":true}
[MSW] Error: intercepted a request without a matching request handler:
unhandled: TypeError | [MSW] Cannot bypass a request when using the "error" strategy for the "onUnhandledFrame" option.
```

Experiment, aws-sdk-client-mock 4.1.0: `mocked: {"pk":{"S":"x"}} calls: 1`.

Conclusions:

- CU6 holds for Node.js 22.12 and later, and for Node.js 24.
- Pin vitest 5.0.5, fast-check 4.10.2, `@fast-check/vitest` 0.5.0, aws-sdk-client-mock 4.1.0 with `aws-sdk-client-mock-vitest` 8.0.0.
- Pin msw 3.0.3, with `onUnhandledFrame: 'error'` set once in the shared setup in `packages/test-doubles`, so no stream can miss it. CE2's tests include one proving an unmatched request is refused, because the failure mode is silent.
- aws-sdk-client-mock's maintenance signal is weak. It is named in §2.1, so it is kept, and its record below says so. CE4 runs a type check over its use.

## CU7 AbortSignal and fetch

Basis: read from `doc/api/globals.md` at `nodejs/node` tag v22.23.2; run on local Node.js v22.23.2. Retrieved 18 October 2026.

Observed:

- `AbortSignal.timeout` added in v17.3.0; `AbortSignal.any` added in v20.3.0; `fetch` no longer experimental from v21.0.0. The page is marked Stability 2, Stable.
- Node.js 22 bundles undici 6.28.0 for `fetch` (`process.versions.undici`).

Experiment (a local `node:http` server that delays its response by 2,000 ms):

```text
A any(timeout200, ctrl) timeout fires: name=TimeoutError ctor=DOMException code=23 t=215ms
B any(timeout200, ctrl) manual abort at 50ms: name=AbortError ctor=DOMException code=20 t=63ms
C manual abort with custom reason at 50ms: name=Error msg="client-cancel" t=97ms
D timeout(200) alone: name=TimeoutError ctor=DOMException code=23 t=213ms
```

In each case `fetch` rejected with `signal.reason` itself.

Uncertainties: run on Windows and v22.23.2, not on the Lambda runtime's v22.23.3 on Linux arm64.

Conclusions:

- CU7 holds: both functions exist and abort `fetch`.
- A timeout rejects with `TimeoutError`, not `AbortError`. Adapters (Specs 02 and 03) classify by `error.name`. Recorded below as a finding for those streams.
- undici is not a dependency of the family.

## CU8 Secrets Manager names

Basis: read. Retrieved 18 October 2026.

Sources: `https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_CreateSecret.html`; `https://docs.aws.amazon.com/secretsmanager/latest/userguide/create_secret.html`.

Observed: names may hold 1 to 512 ASCII letters, digits and `/_+=.@-`. Secrets Manager appends a hyphen and six random characters to the ARN, and warns against names ending in a hyphen followed by six characters. The response `Name` field is documented with a maximum of 256.

Conclusions:

- CU8 holds: `demo/dev/providers/provider-a` is valid and does not end in a hyphen and six characters.
- Provider identifiers must never end in a hyphen followed by exactly six characters; `packages/contracts` enforces it on the provider identifier grammar, with a comment saying why.
- IAM grants on these secrets match the name followed by `-??????`.

## CU9 Slow fault delay

Basis: read from Spec 02 Appendix A and Spec 03 Appendix A as drafted on 18 October 2026.

Observed: RU1 assumes a 1,500 ms per provider timeout; RU11 a 5 second read function timeout; Spec 01 EU10 a 6 second read integration timeout; Spec 03 WU15 an 8,000 ms per call abort on writes.

Conclusions:

- 3,000 ms is above RU1, below RU11 and EU10, so a `slow-` record times out the read adapter and the read handler still answers in time. This holds only while RU1 stays below 3,000 ms.
- On the write path, 3,000 ms is below WU15, so `slow-` records make writes slow but never time them out. Spec 03 cannot test its own per call abort with these prefixes as drafted. Recorded below as a finding for Spec 03.
- CU9 is settled with RU1 by the author (CQ4).

## CU10 and CU11 author values

Basis: author decision, not yet given. The values the specification assumes are listed in Spec 00 Appendix A; CQ4 asks for them.

One related observation from CU6: zod 4.6.7 reports an unknown key with the issue code `unrecognized_keys` and the key's own name in `keys` and `message` (run). The key name is caller supplied, so §3.6 forbids it in `invalidFields`. CE1 reports an unknown key at the enclosing object's path with a fixed reason, and never copies the key name or zod's message. zod's `reportInput` option copies the whole input into each issue (run) and is never enabled.

Experiment, zod 4.6.7:

```text
strictObject: false [{"code":"unrecognized_keys","keys":["extra"],"path":[],"message":"Unrecognized key: \"extra\""}]
message contains secret: false | issues contain secret: false
reportInput:true -> [{"code":"unrecognized_keys",...,"input":{"name":"a","age":1,"extra":"SECRET-VALUE-123"}}]
```

## Naming limits for §2.3

Basis: read from the AWS API references for CreateFunction, CreateQueue, CreateTopic, CreateLogGroup and the DynamoDB naming rules. Retrieved 18 October 2026.

| Resource | Limit |
|---|---|
| Lambda function name | 64 characters, `[a-zA-Z0-9-_]` |
| DynamoDB table | 3 to 255, `a-z A-Z 0-9 _ - .` |
| SQS queue | 80, alphanumeric, `-`, `_` |
| SNS topic | 256, alphanumeric, `_`, `-` |
| CloudWatch log group | 512 |
| HTTP API name | no limit stated |

Conclusion: the Lambda limit binds. With `demo-` and the longest stage (`stub`, `test` and `demo` at four characters), a component has 54 characters. `packages/construct-contracts` checks the joined name at synth time so a breach fails synth rather than deployment.

## Toolchain pins and dependency records

Datum 0.13; Spec 00 §2.1. Basis: read from registry metadata on 18 October 2026. Maintenance signal is the recency of the last publish only; repository activity was not read.

Choices made under §2.1 GUIDANCE, with reasons:

- TypeScript 5.9.3, as §2.1 names TypeScript 5. TypeScript 7.0.2 is current, but typescript-eslint 8.71.2 declares `typescript >=4.8.4 <6.1.0`, so 7 cannot serve type aware lint. 6.0.3 is inside that range and is the alternative if the author prefers it.
- msw 3.0.3 rather than 2.15.0, because 2.x has no maintenance tag and 3.x is current; the renamed option is handled once, in shared setup (CU6).
- `ulid` 3.0.2 for minting identifiers (§2.3), chosen over `ulidx` 2.4.1 on publish recency.
- ESLint 10.13.0 with typescript-eslint 8.71.2; Prettier 3.9.10; `@types/node` 22.20.5, or the 24 line if CQ1 moves the runtime.

| Package | Version | Licence | Unpacked bytes | Last publish | Behaviour and why the platform is insufficient | Security, test strategy, replacement cost |
|---|---|---|---|---|---|---|
| `zod` | 4.6.7 | MIT | 6,148,944 | 2026-10-12 | strict schemas with inferred types; the platform has no schema validation | parses hostile input, so pinned and fuzzed (§2.4 check 6); replacement touches every schema |
| `aws-cdk-lib` | 2.273.0 | Apache-2.0 | 137,853,661 | 2026-10-08 | infrastructure as code (§2.1) | build time only; synth assertions; replacement is a rewrite of `infra/` |
| `aws-cdk` | 2.1145.0 | Apache-2.0 | 25,777,833 | 2026-10-08 | synth and deploy | build time only |
| `constructs` | 10.8.1 | Apache-2.0 | 930,146 | 2026-08-03 | CDK peer | build time only |
| `esbuild` | 0.28.2 | MIT | 147,361 plus binary | 2026-08-08 | local bundling without Docker | build time only; a native binary per platform |
| `@aws-lambda-powertools/logger`, `/tracer`, `/metrics` | 2.36.0 | MIT-0 | 330,184; 192,795; 262,331 | 2026-10-06 | structured logs, traces, metrics (§5.1) | runs in every Lambda; behind the CE1 interfaces, so replacement stays inside services |
| `@aws-sdk/*` v3 clients | pinned per client at CE4 and in Specs 02, 03 | Apache-2.0 | | | AWS API calls | external in bundles for explicit runtimes |
| `ulid` | 3.0.2 | MIT | 69,343 | 2025-11-30 | ULID minting; the platform offers UUID only | no dependencies; small and replaceable |
| `typescript` | 5.9.3 | Apache-2.0 | | 2025-09-30 | language | build time only |
| `vitest`, `@vitest/coverage-v8` | 5.0.5 | MIT | 2,817,789; 29,553 | 2026-10-15 | test runner | test only |
| `msw` | 3.0.3 | MIT | 3,363,377 | 2026-10-10 | provider doubles over `fetch` | test only; unmatched requests refused (CU6) |
| `fast-check`, `@fast-check/vitest` | 4.10.2; 0.5.0 | MIT | 1,523,883; 19,581 | 2026-09-19; 2026-09-11 | property based generation (§2.4 check 6) | test only |
| `aws-sdk-client-mock`, `aws-sdk-client-mock-vitest` | 4.1.0; 8.0.0 | MIT | 93,953; 47,630 | 2024-10-15; 2026-09-12 | AWS SDK v3 doubles | test only; weak maintenance signal; undeclared `@smithy/types` import |
| `eslint`, `typescript-eslint` | 10.13.0; 8.71.2 | MIT | 2,950,609; 42,688 | 2026-10-16; 2026-10-12 | lint with warnings as errors | build time only |
| `prettier` | 3.9.10 | MIT | 9,959,033 | 2026-10-10 | formatting | build time only |
| `@types/aws-lambda` | 8.10.164 | MIT | 175,870 | 2026-09-29 | handler and event types (CU3) | types only, so allowed in pure modules |
| `@types/node` | 22.20.5 | MIT | 2,438,360 | 2026-10-01 | Node.js types | types only |

Not a dependency: `undici`, since Node.js 22 bundles it for `fetch`.

(18 October 2026: with `nodejs24.x` chosen under CQ1, `@types/node` moves to the 24 line, 24.19.2, published 2026-10-09, MIT, read from the registry the same day. Every other pin above declares support for Node.js 24. CU7's experiment was run on Node.js 22 and is repeated on Node.js 24 before Specs 02 and 03 rely on it.)

## Findings for other specifications

Recorded here because they were found during this Plan stage. Each belongs to its owner and is left for that owner's Plan stage (datum Stage two).

| For | Finding | Evidence | Likely fix |
|---|---|---|---|
| Spec 01 EU4 | `HttpLambdaIntegration` adds its own invoke permission, scoped to the route path | CU2 | settles EU4 as assumed |
| Spec 01 EU7, EE3 | Per route throttling exists only on L1 `CfnStage.routeSettings`; the default stage `HttpApi` creates accepts no throttle | CU2 | own the `$default` stage and set route settings through L1 |
| Spec 01 EU2, EU10 | The integration timeout is documented as 30 seconds maximum by API Gateway and 29 seconds by CDK | CU2; HTTP API quotas page | stay below 29 seconds |
| Spec 01 EE4 | The authoriser checks `aud` when present and `client_id` only when `aud` is absent; Cognito access tokens carry `aud` only with a resource binding | CU4 | the wrong audience test uses a token from a second app client |
| Specs 02, 03 | A timed out `fetch` rejects with `TimeoutError`, not `AbortError` | CU7 | classify by `error.name` |
| Spec 03 WE5 | `slow-` waits 3,000 ms, below WU15's 8,000 ms, so no prefix makes a write time out | CU9 | a Spec 00 change for a write side slow prefix, if Spec 03 needs one |

## Decisions still needing the author

Batched for the Spec 00 Plan stage exit (datum 0.3). CD1 to CD6 are already stated in the five part form in Spec 00 §6. The questions below are new, raised by the evidence above.

- **CQ1** Lambda runtime: `nodejs22.x` as §2.1 says, or `nodejs24.x`. Blocks CE5 and every service. Recommendation: `nodejs24.x`.
- **CQ2** How the CU4 experiment is run. Blocks closing CU4; does not block CE1 under the tolerant reading above. Recommendation: the author runs it after CE5's first deployment of `stub`.
- **CQ3** Logging and metrics interfaces injected into `withHttpProblemHandling`. Blocks CE1. Recommendation: accept.
- **CQ4** The values for CU9, CU10 and CU11. Blocks CE1 (CU10) and CE4 (CU9, CU11). Recommendation: adopt the values in Spec 00 Appendix A.

### Answers, 18 October 2026

Given by the author in the working session, recorded as given.

| Item | Answer | Consequence |
|---|---|---|
| CQ1 | Move to Node.js 24. | `nodejs24.x` on arm64; `@types/node` 24.19.2. |
| CQ2 and CD3 | In the author's words: "for AWS we will build knowing it's going to be there and using lambdas but we will run entirely locally." | Nothing is deployed to AWS. The family is still built as Lambda functions and CDK stacks, and `cdk synth` still runs for every stage. CU4's experiment is not run, so the tolerant reading in CU4 stands as the design. What replaces the deployed checks is CQ6. |
| CQ3 | Pass interfaces in. | `packages/contracts` defines narrow logging and metrics interfaces; `withHttpProblemHandling` takes them; each service supplies its Powertools instances. |
| CQ4 | Appendix A as written. | CU9 3,000 ms; CU10 every maximum in §3.3 and every bound in §3.7 as drafted; CU11 `max-age` 60 seconds, replay window 24 hours, version prefix 16 hexadecimal characters, throttle `Retry-After` 2 seconds, 20 seed records per tenant. |

| CD1 | The Spec 00 §6 recommendation: freeze after RE4 and WE2 pass against the doubles. | `packages/contracts` stays provisional until then; every change is recorded in `CONTRACT.md`. |
| CD2 | The Spec 00 §6 recommendation: Module B not applied. | One product; required documents once, at the root. |
| CD4 | MIT, with `TheScottBot` as holder. | `LICENSE` is the MIT licence text with that holder, written in CE1. |
| CD5 | The Spec 00 §6 recommendation: never log `sub`. | `PRIVACY.md` says so; the wrapper and Spec 01's access log format exclude it. |
| CD6 | The Spec 00 §6 recommendation: adopt §3.7 as written. | The section shapes and bounds in §3.7 are the CE1 schemas. |

Author convention, same day: proposed commit message text uses Conventional Commits types (`feat`, `fix`, `docs` and so on).

| CQ5 | The recommendation: install Node.js 24.22.0, the latest 24 LTS, locally; continuous integration also runs a job pinned to exactly 24.21.0, the Lambda base image's version. | Installing Node.js is the author's action. Until it is done, phases run on v22.23.2 and each reproduction report says so. |
| CQ6 | The recommendation: no emulator. Mock providers run as local Node.js servers; handlers are invoked directly with the event builder; the gateway is covered by synth assertions. Gateway behaviour nothing local can exercise (401 responses, CORS preflight, throttling, the authoriser) is recorded in `IMPLEMENTATION_DEVIATIONS.md` as unverified. | EE4, EE5, RE6, WE9 and CE4's deployment and seeding are replaced, each owner recording how in its own Plan stage. |

### Plan stage exit

Closed on 18 October 2026 for Spec 00: every CU value is read from source or decided by the author, except CU4, which the author's choice to run locally leaves unsettled by design (see CU4). Every decision is answered.

## CE1 Contract package

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17.

### Assumptions verified

- CU3: `@types/aws-lambda` 8.10.164 supplies `APIGatewayProxyEventV2WithJWTAuthorizer`, `APIGatewayProxyStructuredResultV2` and `Context` as read in the Plan stage; the package typechecks against them.
- CU4: not settled (local only); `readAuthenticationContext` reads both renderings, tested.
- CU10: the §3.3 and §3.7 values as adopted under CQ4, each tested at its bound and one past it.
- zod 4.6.7 strict objects: every schema refuses an unknown key (tested per schema); issue codes read from `zod/v4/core/errors.d.ts` before mapping them.
- `ulid` 3.0.2 exports `ulid()`, read from `dist/ulid.d.ts`.

### Tests first

All 13 test files were written before any source file existed. First run: every file failed with `Cannot find module '../src/index'`. That is the expected reason for a package with no source, but it is weaker evidence than a failing assertion, so once the suite passed, eight regressions were planted one at a time in the source and the suite was run against each (scratch script, file restored byte for byte after each):

| Planted regression | Result |
|---|---|
| unknown key reported by its own name | 4 tests failed |
| internal failure logs the error message | 1 failed |
| command body bound one byte larger | 2 failed |
| ULID grammar admits I, L, O and U | 5 failed |
| provider version allowed on any outcome | 1 failed |
| refused correlation identifier echoed | 1 failed |
| scope matched by prefix | 1 failed |
| provider `Retry-After` bound one second larger | 2 failed |

### Pure import check

`@typescript-eslint/no-restricted-imports` over `packages/contracts/src`, configured in `eslint.config.js` from the Spec 00 §2.4 check 2 list, `import type` included. A planted file importing `@aws-sdk/client-dynamodb`, `aws-cdk-lib`, `@aws-lambda-powertools/logger`, `node:fs`, `node:net`, `node:http` and `child_process` produced exactly seven errors, one per import, and lint exited 1. The file was deleted and lint over the real package exited 0. CE3 promotes this into the continuous integration job.

The typecheck likewise failed (exit 1, TS2322) on a planted type error and passed once it was removed.

### Reproduction report

| Item | Value |
|---|---|
| Platform | Windows 11 Home 10.0.26200 |
| Node.js, npm | v22.23.2, 10.9.8 (target is Node.js 24 under CQ1; not yet installed, CQ5) |
| Pinned packages | `zod` 4.6.7, `ulid` 3.0.2, `@types/aws-lambda` 8.10.164, `typescript` 5.9.3, `vitest` 5.0.5, `fast-check` 4.10.2, `@fast-check/vitest` 0.5.0, `eslint` 10.13.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.71.2, `prettier` 3.9.10, `@types/node` 24.19.2 |

Commands, from the repository root:

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test --workspace packages/contracts
npm test
```

Results:

| Check | Result |
|---|---|
| Typecheck (`tsc --build`, `strict`, `noUncheckedIndexedAccess`) | exit 0 |
| Lint (`eslint --max-warnings 0`) | exit 0, 0 warnings |
| Format (`prettier --check`) | all files formatted |
| Focused suite (`packages/contracts`) | 13 files, 345 tests passed |
| Full suite | 13 files, 345 tests passed (one workspace exists) |
| Property runs (§2.4 check 6) | fast-check defaults, 100 runs per property, within the suite |
| Memory and undefined behaviour analysis | none applies to TypeScript; what Node.js offers is CE3's `TESTING.md` record |
| Tests skipped | none |
| Tests requiring the author | none |

Done when: the suite passes, lint is clean, and the pure import check passes on the package. All three hold on the agent's machine. The phase is not complete until the author reproduces the commands above on a clean machine (datum Stage three), ideally on Node.js 24 once CQ5 is done.

### Findings

| For | Finding | Likely fix |
|---|---|---|
| Spec 00 §2.5 | Apart from `CONTRACT.md` (CE1), `LICENSE` (CD4, written in CE1) and `IMPLEMENTATION_DEVIATIONS.md` (CE3), no phase owns the required documents (`README.md`, `TESTING.md`, `CHANGELOG.md`, `SECURITY.md`, `PRIVACY.md`) | assign them to CE3, or to a new Spec 00 phase |
| Spec 00 CE3 | `LICENSE` is the MIT text verbatim, which uses quotation marks for defined terms; datum 0.8 allows quotation marks only for quotation | the prose scan treats `LICENSE` as quoted legal text, recorded as a deviation |
| Spec 02 RE2 | Spec 02 says provider `max-age` is defaulted and capped; Spec 00 §4.3's `badheader-` fault and datum 0.10 refuse an over bound value instead. `parseCacheControlMaxAge` reports it as invalid | Spec 02 maps an invalid `max-age` to `header-invalid`, as its own §3.3 table already says |
| Spec 01 EE3 | §5.3's exposed headers are a subset of the response headers in `httpHeaders` (no `Cache-Control`, no `Vary`), so they cannot be derived from `direction` alone | Spec 01 selects them by name from `httpHeaders`, or Spec 00 marks them |

Open questions raised by CE1 are listed in `packages/contracts/CONTRACT.md`: a bound for the `sub` claim, and `Cache-Control` on read route problem documents.

## CE2 Shared test doubles

Phase started 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine on 18 October 2026; awaiting the author's reproduction. (The Done so far list below was written mid phase and is kept as it was; the complete record follows the answers.)

### Done so far

- `packages/test-doubles` workspace, depending on `@demo/contracts` and `msw` 3.0.3 (CU6).
- The payload format 2.0 event builder (`buildVerifiedClaimsEvent`, `buildLambdaContext`, `publicRouteNamed`), delivering headers as CU3 observed: lower cased, duplicates joined by commas.
- The synthetic record set: 20 records per tenant (CU11), one per fault prefix and seven ordinary, generated from position, with each tenant's content distinct under the same identifiers. The tests define the synthetic set as a closed set of value shapes.
- Tests first: both test files failed with `Cannot find module '../src/index'` before the source existed; 30 tests pass now. Planted regressions: duplicate headers keeping only the last value (1 failed), an empty default subject (2 failed), a fixture string outside the synthetic set (1 failed), record content ignoring the tenant (1 failed). A first, weaker tenant plant (only the title made tenant blind) was not caught, correctly, since the records still differed in other fields; it was replaced by the stronger plant.

### Gaps found in the provider wire contract

The msw doubles must implement §4.3 exactly, and §4.3 and §4.4 leave these open. Each is a wire contract choice between the adapters (Specs 02, 03) and the providers, so it is raised as CQ7 rather than guessed.

| Gap | Why it matters |
|---|---|
| How the tenant reaches a provider | §4.3 keys the store by provider, tenant and record, but `GET /records/{recordId}` carries no tenant, and one API key serves all tenants (§2.3 names one secret per provider) |
| The answer to a missing or wrong `X-Api-Key` | the adapters must map it to an outcome |
| The answer to a write missing `If-Match` or `Idempotency-Key` | §4.3 says both are required but not what a breach returns |
| A repeated `Idempotency-Key` with a different request | §4.3 defines only the replay |
| A write to a record or section the provider does not hold | create, or refuse |
| The canonical form hashed for a version | §4.3 names a canonical form without defining it; CE2 and CE4 must agree byte for byte |
| Who mints a note's `noteId` and `writtenAt` on append, and the append status | `NotesAppendPayload` carries only `text`; §4.4 allows 200 or 201 |

### Answers, 18 October 2026

Given by the author in the working session: accept CQ7 items 1 to 7 as recommended, the shared provider simulation, a 255 character `sub` bound, and `no-store` on read route problem documents.

| Item | Decision |
|---|---|
| CQ7.1 | Every provider request carries `Demo-Tenant-Id`, held to the tenant grammar; missing or malformed answers 400 |
| CQ7.2 | A missing or wrong `X-Api-Key` answers 401 |
| CQ7.3 | A write without `If-Match` answers 428; a missing or malformed `Idempotency-Key` answers 400 |
| CQ7.4 | A repeated `Idempotency-Key` with a different request inside the replay window answers 422 |
| CQ7.5 | A write to a record the provider holds nothing of, or to a section it does not own, answers 404; providers never create records |
| CQ7.6 | The version is the first 16 hexadecimal characters of the SHA-256 of the provider's own sections as JSON, object keys sorted at every level, list order kept, no whitespace |
| CQ7.7 | On append the provider mints `noteId` (a ULID) and `writtenAt`, and answers 201; a replace answers 200; every success carries `ETag` and `Demo-Provider-Contract` |
| Simulation | One transport free provider simulation in `packages/test-doubles`, wrapped by the msw doubles (CE2) and the local mock servers (CE4) |
| `sub` bound | 255 characters (CU10, author decision) |
| Problem documents | `Cache-Control: no-store` on every problem document, on all three routes |

### Work completed

- Contract additions in `packages/contracts` for the decisions above: `authenticationClaimBounds`, the `sub` check in `readAuthenticationContext`, `no-store` in `withHttpProblemHandling`, `httpHeaders.providerTenant`, `providerWireStatuses`. Each is recorded in `CONTRACT.md`. They were driven by a new test file, `author-decisions-ce2.test.ts`, whose five new assertions failed before the change; no earlier assertion was edited.
- `canonicalJson` and `computeProviderVersion` (CQ7.6).
- `ProviderSimulationStore`, with an in memory store seeded from the synthetic records and keyed as §4.3 states.
- `simulateProviderRequest`: one mock provider's whole behaviour, free of transport, for CE2 and CE4 to wrap.
- The msw doubles: `createProviderDoubleHandlers` and `startProviderDoubles`, which listens with `onUnhandledFrame: 'error'` (CU6).

### Tests first

| Test file | First run, before its source existed |
|---|---|
| `canonical-version.test.ts`, `provider-simulation.test.ts` | written together; failed to import the missing exports |
| `msw-provider-doubles.test.ts` | `TypeError: Cannot read properties of undefined (reading 'map')`: `syntheticProviderConnections` did not exist |

One test of this phase was corrected before it first passed: the `down-a-` write check read the record first, and `down-a-` rightly refuses that read too.

Planted regressions, each restored byte for byte afterwards:

| Planted regression | First result | After strengthening the test |
|---|---|---|
| msw listening with the old `onUnhandledRequest` option | not caught: the unmatched request still rejected, because its host does not resolve | caught (1 failed): the test now requires msw's own refusal |
| a repeated key applying the write again instead of replaying | not caught: a re-apply of the same payload under the same clock gives an identical response | caught (1 failed): the replay now carries the original, stale `If-Match` and the clock moves on |
| reads ignoring the tenant | caught (3 failed) | |
| the canonical form not sorting keys | caught (3 failed) | |
| `flaky-` failing one attempt too many | caught (4 failed) | |
| a stale `If-Match` accepted | caught (1 failed) | |

### Reproduction report

| Item | Value |
|---|---|
| Platform | Windows 11 Home 10.0.26200 |
| Node.js, npm | v22.23.2, 10.9.8 (target Node.js 24; CQ5 not yet done) |
| New pins | `msw` 3.0.3, `ulid` 3.0.2 (test-doubles), `@types/aws-lambda` 8.10.164 |

Commands, from the repository root:

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test --workspace packages/test-doubles
npm test
```

| Check | Result |
|---|---|
| Typecheck | exit 0; a planted type error in `packages/test-doubles/src` gave exit 1 |
| Lint | exit 0, 0 warnings |
| Format | all files formatted |
| Focused suite (`packages/test-doubles`) | 5 files, 178 tests passed, about 4 seconds (the slow- check waits the full 3,000 ms) |
| Full suite | 19 files, 529 tests passed |
| Tests skipped | none |
| Tests requiring the author | none |

Done when: the suite passes. It does on the agent's machine; the phase is complete once the author reproduces it on a clean machine.

### Findings

| For | Finding | Evidence | Likely fix |
|---|---|---|---|
| Spec 00 CE3, `IMPLEMENTATION_DEVIATIONS.md` | `tsconfig.json` now sets `skipLibCheck: true`. msw 3.0.3's declarations (via `@mswjs/interceptors`) name DOM types such as `RequestInfo`, `BodyInit` and `MessageEvent`, which a Node only `lib` does not define. The alternative, adding the `DOM` lib, would let browser globals typecheck in Lambda code. Our own sources are still checked in full: a planted type error still fails | 20 TS errors, all inside `node_modules/@mswjs/interceptors` | record as a deviation from datum 0.10's strictest setting, with this reason and the planted error as its covering test |
| Specs 02, 03 | The provider double is ready: `startProviderDoubles()` in `beforeAll`, `reset()` in `afterEach`, `stop()` in `afterAll`; connections in `syntheticProviderConnections` | `msw-provider-doubles.test.ts` | use it; do not build another |

## CE5 Construct contracts and stubs

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Scope as built

CE5's Work names `infra/bin/app.ts` wiring `DemoApi`, the stubs and the alarm topic. `DemoApi` is Spec 01 EE1, and EE1 depends on CE5 (§5.5), so it cannot exist yet. CE5 therefore wires the alarm topic and the stubs for every stage; wiring `DemoApi` is a Spec 00 change to make once EE1 is done, and is tracked in `docs/IMPLEMENTATION_TRACKER.md`. None of CE5's own tests depend on `DemoApi`.

Until CE6, every stage holds the stubs, since no real `ReadPath` or `WritePath` exists to assign to `dev`, `test` or `demo`.

### Assumptions verified

- CU1: `lambda.Runtime.NODEJS_24_X` (CQ1) and `Architecture.ARM_64` synthesise as `nodejs24.x` and `arm64` (synth assertions).
- CU2: `NodejsFunction`, its `bundling` options, `OutputFormat.ESM` and `banner` work as read in the Plan stage; `cdk synth` succeeds for every stage.
- Read from the `aws-cdk-lib` 2.273.0 source this phase: `NodejsFunction` with `sourceMap: true` writes the map but sets no `NODE_OPTIONS`, so Node.js would ignore it in stack traces. `node --help` on v22.23.2 lists `--enable-source-maps`. The stubs set `NODE_OPTIONS=--enable-source-maps`.
- A synthesised bundle was loaded in Node.js and invoked with a payload format 2.0 event, as Lambda would: it answered 501 with the problem document, `Cache-Control: no-store`, the `Demo-Stub-Echo` header and the correlation identifier, and logged one structured line carrying `correlationId`, `tenantId`, `service`, `component` and no `sub`. With `DEMO_STAGE` absent it failed at import with a `ZodError`, as §2.3 requires of a cold start.

### Work completed

- `packages/construct-contracts`: the §3.11 interfaces exactly as written; `demoResourceName` (refusing a name over 64 characters at synth), `demoStackName`, `providerSecretName`, `demoMetricsNamespace`; the CQ3 interfaces satisfied with Powertools (`createPowertoolsProblemHandling`); the stub handler and its bundled entry point; `StubReadPath` and `StubWritePath`.
- `infra`: `lib/demo-platform.ts` building one stack per stage, `bin/app.ts`, `cdk.json` (running the app through `tsx`).
- Contract additions recorded in `CONTRACT.md`: route names moved into `packages/contracts`, and the `Demo-Stub-Echo` header name.

### Tests first

All four new test files failed before their source existed (`Cannot find module`); the contract test for the route names and the echo header failed on its assertions. One test of this phase was wrong when first run: it assumed CDK sets `NODE_OPTIONS`, which the source shows it does not; the construct was changed to set it, not the test.

| Planted regression | Result |
|---|---|
| echo header sent in every stage | 9 tests failed |
| stubs on Node.js 22 | 4 failed |
| resource names allowed one character longer | 1 failed |
| `RequestRejected` dimension misnamed | 1 failed |
| stub answering 500 | 12 failed |
| alarm topic misnamed | 4 failed |

### Dependency records

Added this phase, read from the registry on 18 October 2026; the CDK and Powertools entries are those of the Plan stage table.

| Package | Version | Licence | Why | Notes |
|---|---|---|---|---|
| `aws-cdk-lib`, `constructs` | 2.273.0, 10.8.1 | Apache-2.0 | infrastructure (§2.1) | build time only |
| `aws-cdk` | 2.1145.0 | Apache-2.0 | `cdk synth` (§2.4 check 7) | build time only |
| `esbuild` | 0.28.2 | MIT | local bundling without Docker | build time only |
| `tsx` | 4.23.15 | MIT | runs the TypeScript CDK app for `cdk synth`; Node.js 22's type stripping cannot resolve the extensionless imports the workspaces use | build time only; replaceable by a bundling step |
| `@aws-lambda-powertools/logger`, `/metrics`, `/tracer` | 2.36.0 | MIT-0 | §5.1 | bundled into every Lambda |

### Reproduction report

Commands, from the repository root:

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run synth --workspace infra
```

| Check | Result |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 (target Node.js 24; CQ5 not yet done) |
| Typecheck, lint, format | exit 0, 0 warnings, all formatted |
| Full suite | 24 files, 595 tests passed |
| `cdk synth` | all four stacks synthesised to `infra/cdk.out` |
| Tests skipped | none |
| Tests requiring the author | none |

Done when: `cdk synth` succeeds for every stage. It does on the agent's machine; complete once the author reproduces it.

### Findings

| For | Finding | Likely fix |
|---|---|---|
| Spec 00 | `DemoApi` cannot be wired in CE5 as drafted (circular with EE1) | a Spec 00 change after EE1, wiring it in every stage |
| Specs 02, 03 | their `NodejsFunction`s need the same runtime, architecture, ESM banner and `NODE_OPTIONS` as the stubs | a shared props helper in `packages/construct-contracts` as a Spec 00 change, so the settings live in one place |
| Specs 02, 03 | `createPowertoolsProblemHandling` satisfies the CQ3 interfaces with Powertools | use it rather than writing another |
| Spec 00 CE4 | the stacks carry no provider connections yet | CE4 supplies them |
| Spec 00 | Powertools reported `cold_start: false` on the first local invocation of the bundle; it reads the Lambda environment to decide, which a local run lacks | observation only; recheck if a local cold start check is ever needed |

# Spec 01 entry point

Plan stage not started.

# Spec 02 read path

Plan stage not started.

# Spec 03 write path

Plan stage not started.
