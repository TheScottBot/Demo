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

## CE3 Tree wide checks

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met locally; the CI runs on GitHub, and the author's reproduction, are outstanding.

### Sources read

| Item | Source | Read |
|---|---|---|
| `actions/checkout` | GitHub API, latest release | v7.0.1, 2026-07-20, commit `3d3c42e5aac5ba805825da76410c181273ba90b1`; `action.yml` at that tag: runs on `node24`, takes `persist-credentials` |
| `actions/setup-node` | GitHub API, latest release | v7.1.0, 2026-10-08, commit `949feb2413d6458794dcd2491c4babbbce0c15c1`; `action.yml` at that tag: takes `node-version`, `node-version-file`, `cache` |
| fast-check global configuration | `fast-check` 4.10.2, `lib/cjs/fast-check.d.ts` | `configureGlobal(parameters)` and `readConfigureGlobal()`, with `numRuns` |
| Node.js analysis options | `node --help`, v22.23.2 | see `TESTING.md` |

### Assumptions verified

- The CI runner needs nothing but the Node.js toolchain: every job runs `npm ci` and an npm script, and `cdk synth` uses the local esbuild, so no Docker and no AWS credentials. This is by construction; no GitHub run has confirmed it yet.

### Work completed

- `tree-checks/`: the decisions of checks 1 to 3 in pure, tested modules (`src/prose-scan.ts`, `src/pure-imports.ts`, `src/single-definition.ts`) and thin command line wrappers (`bin/`) that list the files git would commit, read them and print what the modules return (datum Part 3).
- `tree-checks/pure-modules.json`: the one list of pure modules and forbidden imports, read by check 2 and by `eslint.config.js`.
- Check 3's mechanism, a Plan stage choice under §2.4: the tokens are collected from `packages/contracts` itself (header names, bounds of 1,000 and over, route paths and the problem type prefix, every exported name, every vocabulary of two or more values); every other non test source is parsed with the TypeScript compiler and searched for a redeclaration. A contract value used through its type is not one; a list of several values from one vocabulary is. A deliberate duplication is allowed by a `single-definition:` comment carrying its reason (datum 0.7).
- `vitest.setup.ts`: the property run count from `DEMO_PROPERTY_RUNS`.
- `.github/workflows/tree-checks.yml`: one job per check; `.node-version` (24.22.0).
- `TESTING.md` and `IMPLEMENTATION_DEVIATIONS.md`, including the check 6 entry §2.4 requires.
- Two small duplications found while building check 3 and removed: the stub handler's literal 501 now comes from `errorCodeDefinitions`, and the event builder's scope string from `scopeNames`.

### Tests first

The four tree check test files failed with `Cannot find module` before their source existed. The first run of check 1 over the real tree found 109 findings, all of them real:

- the scan's own word list and test inputs (fixed by storing the list reversed and building every planted value from parts);
- two literal dash characters in `prose-scan.ts`, where Unicode escapes had been intended: an editing step had turned the escapes for U+2013 and U+2014 into the characters themselves. Every other file was checked for the same and was clean;
- two test inputs from earlier phases holding a literal double hyphen (a component name in `resource-naming.test.ts` and a language tag in `sections.test.ts`), rebuilt from parts with byte for byte the same value. These are earlier phase tests (datum 0.4); their assertions are unchanged.

Lint then found five issues in this phase's own code, each fixed.

Each check, seen to fail on a planted violation and then pass, by `prove-tree-checks.mjs` in scratch, restoring each file byte for byte:

| Check | Planted violation | Planted run | Clean run |
|---|---|---|---|
| 1 Prose | an em dash in a new Markdown file | exit 1, 1 finding | exit 0 |
| 2 Pure imports | `@aws-sdk/client-s3` imported in `packages/contracts/src` | exit 1, 1 finding | exit 0 |
| 3 Single definition | the bound `65_536` declared in `packages/test-doubles/src` | exit 1, 1 finding | exit 0 |
| 4 Typecheck | a string assigned to a number | exit 1, TS2322 | exit 0 |
| 4 Lint | a one letter name | exit 1, `id-length` | exit 0 |
| 5 Full suite | a failing test | exit 1, 1 failed | exit 0 |
| 6 Property runs | `parseEntityTag` throwing on any value holding a tilde, at 1,000 runs | exit 1, failed only in `parser-properties.test.ts`: no example based test holds a tilde | exit 0 |
| 7 Synth | an alarm topic component outside the naming grammar | exit 1, `component-outside-grammar` | exit 0 |

### Reproduction report

| Item | Value |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 (target 24; CQ5) |

Commands: those in `TESTING.md`, Running everything locally, and `DEMO_PROPERTY_RUNS=1000 npm test`.

| Check | Result after a clean `npm ci` |
|---|---|
| Checks 1 to 3 | exit 0; 104 files scanned by check 1 |
| Typecheck, lint, format | exit 0, 0 warnings |
| Full suite | 28 files, 666 tests passed, at 100 and at 1,000 property runs |
| Synth | all four stacks |
| Tests skipped | none |

Done when: each check has a recorded failing run and a passing run. Locally, it has. The same on GitHub needs a push, which is the author's, and the author's reproduction is outstanding.

### Answers, 18 October 2026

The author accepted CQ8 (check 6 as property runs, deviation entry 1) and CQ9 (`DemoApi` wired after EE1, deviation entry 5).

### Findings

| For | Finding | Likely fix |
|---|---|---|
| Spec 00 §2.5 | `README.md`, `CHANGELOG.md`, `SECURITY.md` and `PRIVACY.md` still have no owning phase (`TESTING.md` and `IMPLEMENTATION_DEVIATIONS.md` now exist) | assign them to a Spec 00 phase |
| Specs 02, 03 | the aggregate ETag and queue message parsers need their own fast-check properties for check 6 | written in RE1 and WE5 |
| Spec 00 | check 3 does not search for bounds below 1,000 | left to review, as `TESTING.md` says |

## CE4 Mock providers

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Scope as built, under CQ6

CE4's Work is three mock provider Lambdas, their HTTP APIs, the store table, the seed script for each stage, and every fault prefix. All of it is built and synthesises. Because nothing is deployed (CQ6), the same handler also runs as three local Node.js servers (`npm start --workspace services/mock-providers`, ports 4101 to 4103), so the streams have real HTTP providers to call. The seed scripts are built and tested against `aws-sdk-client-mock`, but not run: they need a deployed table.

### Assumptions verified

- CU8: the secrets synthesise as `demo/{stage}/providers/{providerId}` (synth assertion).
- CU9: the slow fault waits 3,000 ms; each mock function's timeout is 10 seconds, asserted to exceed it.
- CU11: `max-age` 60, replay window 24 hours (also the store's time to live), version prefix 16, throttle `Retry-After` 2, 20 records per tenant; each asserted.
- `@aws-sdk/lib-dynamodb` 3.1152.0 exports `DynamoDBDocumentClient.from`, `GetCommand`, `PutCommand` and `QueryCommand`; `aws-sdk-client-mock` 4.1.0 offers `callsFake`. Both read from their declarations this phase.

### Work completed

- `services/mock-providers`:
  - `createDynamoDbProviderStore`: one item per section under the §4.3 keys; idempotency entries under their own partition prefix with a time to live; strongly consistent reads; never a delete.
  - `createMockProviderHandler`: transport only around `simulateProviderRequest`. It reads the API key once per execution environment (§2.3), decodes base64 bodies, applies the slow fault's delay, and logs one line per request: provider, method, status, and the tenant and correlation identifier only where they pass their grammar. It never logs a body or a key.
  - `seedMockProviderStore` and the four `seed:{stage}` scripts.
  - `startLocalMockProviders`, holding request bodies to the command bound.
  - The Lambda entry point, and the `MockProviders` construct.
- `packages/test-doubles`: a `./provider-simulation` subpath export without msw, so no Lambda bundle holds a test only dependency, and `syntheticProviderApiKey`, shared by the msw doubles and the local servers.
- `packages/construct-contracts`: `createDemoNodejsFunction`, the CE5 finding. The stubs now use it; every CE5 test passed unchanged after the refactor.

### Tests first

All six new test files failed before their source existed (`Cannot find module` for five; `createDemoNodejsFunction is not a function` for the sixth). Two issues arose before green:

- The new helper test bundles a real function inside `it` and took 6.3 seconds in the full run, past vitest's 5 second default; it was given a 60 second timeout, as the other synth tests have in `beforeAll`.
- Lint refused the name `item` (datum 0.5) throughout the DynamoDB fake; it is `tableItem` now.

The DynamoDB fake interprets only the exact requests the store makes and refuses anything else, including any delete.

| Planted regression | Result |
|---|---|
| store partition key parts in the wrong order | 2 tests failed |
| store writing only the first section | 3 failed |
| idempotency entries expiring at once | 1 failed |
| API key read on every request | 1 failed |
| base64 bodies not decoded | 1 failed |
| mock function timeout no longer than the slow fault | 1 failed |
| local servers buffering twice the bound | 1 failed |

A local run was also tried by hand: `GET /records/record-0001` answered 200 with the right key and 401 with a wrong one. That run's start script first logged each synthetic API key, which datum 0.15 forbids for any credential; the line was removed before the phase closed. The run's processes also outlived the timeout meant to stop them (on Windows, `timeout` does not reach the child processes) and held `esbuild.exe` open, which made a later `npm ci` fail. The agent identified the three processes by their command lines and stopped them; nothing else was touched.

### Reproduction report

| Item | Value |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 (target 24; CQ5) |
| New pins | `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-secrets-manager` 3.1152.0 (Apache-2.0, 2026-10-14); `aws-sdk-client-mock` 4.1.0 (dev) |

Commands: those in `TESTING.md`, Running everything locally.

| Check | Result after a clean `npm ci` |
|---|---|
| The seven tree checks | all exit 0 |
| Full suite | 34 files, 712 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

Done when: the local suite passes and the construct synthesises. Both hold on the agent's machine; complete once the author reproduces them. Deploying and seeding are replaced under CQ6.

### Findings

| For | Finding | Likely fix |
|---|---|---|
| Spec 00 CE6 | `MockProviders` is not yet wired into `infra/lib/demo-platform.ts`; its connections are what `ReadPath` and `WritePath` take as `providers`. Wiring it adds three functions to each stack, which the CE5 assertion of exactly three functions per stack would then fail: that earlier test must be raised with the author when the wiring is made (datum 0.4) | wire it in CE6, raising the CE5 assertion then |
| Spec 00 | a write reads then puts without a condition, so two concurrent writes to one record could interleave; acceptable for a double driven by one test at a time | a conditional put on a version attribute, if concurrent use ever matters |
| Specs 02, 03 | real HTTP providers now run locally; adapters can be checked against them as well as against the msw doubles | use `startLocalMockProviders` in a stream's local checks |

# Spec 01 entry point

Plan stage not started.

# Spec 02 read path

Plan stage worked on 18 October 2026, after reading Spec 02 Draft 2 once, top to bottom. Status: evidence gathered; author decisions outstanding (Decisions still needing the author, at the end of this section).

## Shared ground

- Reference implementations: read in the Spec 00 Plan stage (commits and what was taken are recorded there); nothing further applies to the read path.
- Environment: as the Spec 00 record states; local Node.js v22.23.2, target Node.js 24 (CQ1, CQ5), nothing deployed (CQ6).
- Built and ready for this stream: `packages/contracts` (CE1), the msw doubles and event builder (CE2), the tree checks (CE3), the local mock providers (CE4), and `createDemoNodejsFunction` with the `ReadPath` interfaces (CE5).

## Correction to an earlier finding

(18 October 2026.) The CE1 findings recorded that Spec 02 caps an over bound provider `max-age` while the contract refuses it. Reading Spec 02 §3.2 in full shows no conflict: it checks `Cache-Control` against Spec 00 §3.3 and answers `header-invalid` on a breach, and caps only valid values (at most 86,400) at RU5. `parseCacheControlMaxAge` already reports a breach as invalid, which is what RE2 needs. The CE1 finding stands in its table as history, and is withdrawn here.

## RU values

| Identifier | Value assumed | Basis | Conclusion |
|---|---|---|---|
| RU1 | per provider timeout 1,500 ms | author decision | consistent: below CU9's 3,000 ms slow fault, so `slow-` records time the adapter out, and below RU2 |
| RU2 | fan-out budget 2,500 ms | author decision | consistent: below RU11 (5 s) and Spec 01 EU10 (6 s), leaving room for §4.3's second call |
| RU3 | `AbortSignal.any` and `AbortSignal.timeout` abort `fetch` | run (Spec 00 CU7) | holds on Node.js v22.23.2; a timeout rejects with `TimeoutError`, a plain abort with `AbortError`. To be rerun on Node.js 24 (CQ5) |
| RU4 | `ttlSeconds` 60 when `max-age` is absent | author decision | consistent with CU11's mock `max-age` of 60 |
| RU5 | `ttlSeconds` capped at 300 | author decision | consistent; see the correction above for over bound values |
| RU6 | `fetch` keeps connections alive across invocations without an explicit agent | read and run, below | holds, within the provider's keep alive window |
| RU7 | `Retry-After` 5 s on 503 | author decision | consistent |
| RU8 | DynamoDB TTL deletes lazily | not read | needed only by RE7, unscheduled under RD1's recommendation |
| RU9 | the runtime may freeze unawaited work | not read | needed only by RE7, as RU8 |
| RU10 | memory 512 MB | author decision | to be measured: under CQ6 there is no Lambda to measure on, so the value is a synth constant |
| RU11 | timeout 5 s | author decision | consistent: above RU2, below EU10 |
| RU12 | reserved concurrency 100 | author decision | see the note below |
| RU13 | provisioned concurrency 2 in `demo` | author decision | a synth constant under CQ6; it would cost money only if deployed |
| RU14 | alarm thresholds | author decision | consistent |
| RU15 | p95 below 800 ms at 20 requests a second | author gate | not measurable under CQ6; RQ2 below |

Note on RU12: Spec 01 EU11 sets the read route's burst at 200 requests a second. By Little's law, at RU15's p95 of 0.8 s a sustained 200 a second needs about 160 concurrent executions, more than 100. At EU11's steady rate of 100 a second it needs about 80. So 100 serves the rate, and a full burst would be throttled by Lambda before the gateway. Under CQ6 this matters only if the family is ever deployed; it is set out for the author's RU12 decision.

## RU6 experiment

Basis: read from `docs/docs/api/Client.md` at `nodejs/undici` tag v6.28.0, the version Node.js v22.23.2 bundles (`process.versions.undici`), retrieved 18 October 2026; then run.

Read: pipelining defaults to 1, which keeps connections alive; `keepAliveTimeout` defaults to 4,000 ms and "may be overridden by keep-alive hints from the server", less a 2,000 ms `keepAliveTimeoutThreshold`; the override is capped at 600,000 ms.

Run: a local `node:http` server counting TCP connections, called by the built in `fetch` with no agent (`keep-alive-experiment.mjs` in scratch).

```text
server keep-alive 30 s:
first call: new connection: true, total 1
immediately after: new connection: true, total 2
after 1 s idle: new connection: false, total 2
after 3 s idle: new connection: false, total 2
after 5 s idle (past the 4 s keepAliveTimeout): new connection: false, total 2
after the server closed the idle connection: status 200, new connection: true, total 3

server keep-alive default (5 s):
after 1 s idle: new connection: false
after 3 s idle: new connection: true
after 5 s idle: new connection: true
after the server closed the idle connection: status 200, new connection: true
```

Conclusions:

- RU6 holds: the built in `fetch` reuses a connection with no explicit agent, for as long as the server's `Keep-Alive` hint allows less 2 seconds, or 4 seconds without a hint. Across Lambda invocations a connection is reused when the next call comes within that window, and otherwise replaced at the cost of a new handshake, not a failure.
- A call made at once after another opened a second connection in both runs: the first socket is released a moment after its body is read. Concurrent calls to one provider each take their own connection, which pipelining 1 implies.
- Not observed, because nothing is deployed: a socket left half open by a Lambda freeze. If one fails mid request it surfaces as a transport error, and §3.1 forbids a retry, so that provider reads as `error` for that request.

## Design notes for the read phases

Recorded so the phases do not rediscover them.

- RE2: the adapters must also send `Demo-Tenant-Id`, which CQ7.1 added to the provider contract after Spec 02 was drafted; §3.2's header list predates it.
- RE2: the adapter takes its API key through an injected reader, so the Lambda entry reads it from Secrets Manager once per execution environment (Spec 00 §2.3) and local checks pass the synthetic key.
- RE2 and RE3: telling an abort from another failure by `abortSignal.aborted` rather than by the error's name, since a timeout rejects as `TimeoutError` and a plain abort as `AbortError` (RU3).
- RE1: base64url is available on Node.js 22 through `Buffer` (`toString('base64url')`), a global needing no import; `Uint8Array.prototype.toBase64` is not available on v22.23.2 (run).
- RE1 to RE4: `tree-checks/pure-modules.json` lists pure module directories, while §2 names four pure files inside `services/read/src`. Listing them is a Spec 00 change to the tree checks, made at the start of RE1.
- RE4: another tenant's record is answered 404 because every provider is keyed by tenant (Spec 00 §4.3), so a read with the wrong tenant finds nothing anywhere.

## Decisions still needing the author

Batched for the Spec 02 Plan stage exit (datum 0.3). RD1 is stated in the five part form in Spec 02 §9.

- **RQ1** How RE6 runs under CQ6. Blocks RE6.
- **RQ2** What becomes of the RU15 latency gate under CQ6. Blocks RE6's author gate.
- **RQ3** The RU author values (RU1, RU2, RU4, RU5, RU7, RU10 to RU14). Block RE2 to RE5.

### Answers, 18 October 2026

Given by the author in the working session ("Go with recommendations"), recorded as given.

| Item | Decision |
|---|---|
| RD1 | Spec 02 §9's recommendation: RE5 builds the cache switch, its synth guard and the cold start log, and no cache behaviour. RE7 stays unscheduled, so RU8 and RU9 stay unsettled and `read-cache-store.ts` is not created. |
| RQ1 | RE6 becomes an automated suite: the read handler invoked directly with the shared event builder against the local mock provider servers (`startLocalMockProviders`), with RE6's seven checks. It runs locally and in CI; it is no longer an author gate. |
| RQ2 | The RU15 latency gate is set aside under CQ6 and recorded as `IMPLEMENTATION_DEVIATIONS.md` entry 7; RU15 stays in the specification for a deployment. |
| RQ3 | Appendix A as written: RU1 1,500 ms, RU2 2,500 ms, RU4 60 s, RU5 300 s, RU7 5 s, RU10 512 MB, RU11 5 s, RU12 100, RU13 2 in `demo`, RU14 as listed. RU12 is Appendix A's 100; the agent raised the burst arithmetic but made no recommendation of its own on it, and the note above stands for any later revision. |

### Plan stage exit (Spec 02)

Closed on 18 October 2026 for Spec 02: every RU value a read phase needs is read, run or decided. RU8 and RU9 stay unsettled because RE7, the only phase needing them, is unscheduled under RD1. RU3 and RU6 were run on Node.js v22.23.2 and are to be rerun on Node.js 24 once CQ5 is done.

## RE1 Aggregate ETag and merge

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Spec 00 change made first

`tree-checks/pure-modules.json` now takes `pureModuleFiles` beside `pureModuleDirectories`, listing the four files Spec 02 §2 names as pure (`aggregate-etag.ts`, `record-merge.ts`, `provider-fan-out.ts`, `read-cache-policy.ts`). Check 2 and ESLint both read it. Driven by two new tests in `tree-checks/test/pure-imports.test.ts`, which failed before the change; no earlier assertion was edited.

### Work completed

- `services/read` workspace.
- `aggregate-etag.ts`: `formatAggregateEntityTag` and `parseAggregateEntityTag`, to the §4.2 grammar. Parsing checks the If-None-Match bound first, then refuses the wildcard, lists, weak validators, unquoted values, a wrong prefix, anything but canonical unpadded base64url, a body that is not a JSON object of strings, an empty object, a provider outside the routing table, a version outside the provider grammar, and any spelling other than the one the formatter writes. It encodes with the web standard `btoa` and `atob`, so the module needs nothing beyond the language.
- `record-merge.ts`: `mergeProviderOutcomes`, a pure function of the outcomes, the routing table and the time. It keeps each ok provider to the sections it owns, counting the rest for `ProviderSectionIgnored`; names each section's source; takes the latest `updatedAt` among ok providers; returns one `SourceProvenance` per provider in routing table order; collects the providers' versions for the ETag; and reports §3.4's three conditions as written. Every source's `fetchedAt` is the merge time, the "current time" §4.1 names.

Left to RE4, deliberately: whether to emit an ETag and when to answer 304, since those decide the response, which is the handler's. See the question below.

### Tests first

Both test files failed with `Cannot find module` before their source existed. One test of this phase was wrong when first run: it planted one extra base64url character as a length no encoder produces, but 27 characters is a length an encoder does produce (only a remainder of 1 over a multiple of 4 is impossible); it decoded to the JSON plus a NUL and was rightly refused as `json`. The test was corrected to plant three characters.

| Planted regression | Result |
|---|---|
| ETag keys left unsorted | 2 tests failed |
| non canonical ETags accepted | 2 failed |
| lists not refused | 2 failed |
| unowned sections kept | 1 failed |
| `partial` set on any failure | 26 failed |
| earliest `updatedAt` taken | 1 failed |
| sources left in input order | 1 failed |

Pure import check: a `node:fs` import planted in each of the two modules failed both check 2 and ESLint, and both passed once it was removed.

Property based runs added to §2.4 check 6: the ETag round trip, the ETag parser on arbitrary text (never throwing, and accepting only what the formatter writes), and the merge on every status combination. All pass at 1,000 runs.

### Reproduction report

| Check | Result |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 36 files, 874 tests passed, at 100 and at 1,000 property runs |
| Tests skipped | none |

Done when: the suites pass, and the pure import check passes on both modules. Both hold on the agent's machine; complete once the author reproduces them.

### Question for RE4, raised now so it is not lost

To be asked in the five part form at RE4, the phase it blocks. §4.2 says an ETag is emitted only when every provider is `ok` or `not-modified`. Read literally, a record that one provider holds nothing of (that provider answers `not-found`, as provider-c does for `record-0006`) can never be given an ETag, and so never answered 304. Counting `not-found` as complete would allow it, but then a provider that held part of a record and now answers `not-found` must not let a conditional read answer 304 over the stale copy.

(18 October 2026.) Asked as RQ4 at the start of RE4 and answered by the author: option (b), a provider answering `not-found` counts as complete, with the safeguard that a 304 needs the same providers as the client's ETag. Recorded as `IMPLEMENTATION_DEVIATIONS.md` entry 8.

## RE2 Read adapters

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Assumptions verified

- RU3: an abort fires through `fetch` as the signal's reason, here `TimeoutError` (`slow-a-` with a 100 ms signal).
- RU4, RU5: the default of 60 and the cap of 300, each tested.
- RU6: met by using the runtime's `fetch` with no agent, as the Plan stage experiment showed; nothing in the adapter configures a dispatcher.
- msw 3.0.3's `server.events.on('request:start', ...)` hands the listener the real `Request` (read from its declarations), so the requests the adapter sends are checked directly.

### Work completed

- `adapters/http-read-adapter.ts`: `createHttpReadAdapter`, the shared transport and mapping, and `createConfiguredReadAdapter`, which builds one from the environment (Spec 00 §2.3), refusing a base URL that is neither https nor the loopback address the local mock providers use (CQ6), and a secret variable that is not an ARN.
  - It sends `X-Api-Key`, `Demo-Tenant-Id` (CQ7.1), `X-Correlation-Id`, and `If-None-Match` only when a version is known.
  - For 200 and 304 it checks `Demo-Provider-Contract` before anything else, then `ETag` and `Cache-Control`.
  - It refuses a declared `Content-Length` over the bound without reading, and otherwise reads the body chunk by chunk, cancelling the rest as soon as the bound is crossed.
  - It decodes the body as strict UTF-8 and validates it against the §4.4 schema, also refusing a body about another record.
  - It discards every body it does not need, so the connection returns to the pool.
- `adapters/provider-{a,b,c}-read-adapter.ts`: each sets only its providerId, base URL variable and secret variable (§3.2). `adapters/read-adapters.ts` composes the three in routing table order.
- `read-path-settings.ts`: RU4 and RU5.

Two decisions within the phase, recorded here:

- The adapter rethrows its signal's reason when the signal has fired. `ProviderReadResult` has no timeout outcome, and §3.1 gives the fan-out the mapping of an abort to `timeout`. Any other failure of the call is `transport`.
- A body about another record is `schema-invalid`; §3.3 does not name the case, and a provider answering for the wrong record is as untrustworthy as a malformed one.

### Tests first

Both test files failed before their source existed. Four of the environment refusal tests passed at that point for the wrong reason: calling an undefined function throws, which satisfies `toThrow`. The planted regression that accepts any URL scheme, below, proves they now refuse for the right one.

Two tests of this phase were wrong at first:

- The `Content-Length` test planted a stream that pulled on construction, so it reported the body as read before the adapter touched it; it now pulls only on demand (`highWaterMark: 0`).
- The request recorder pushed into an array that was undefined unless the first test block had run. msw answered the listener's exception with a 500, which the adapter rightly reported as `http-status`. It now records plain values into an array initialised at declaration.

### Finding: an msw interception escape

Observed while getting the abort test green. In one test file, a provider-a request whose body the adapter cancelled (a 503, or the oversized body), followed by a refused unmatched request, made the next provider-a request escape interception: it went to the network and failed with `getaddrinfo ENOTFOUND provider-a.providers.example.test`. It reproduced every time with those two predecessors, and never with either alone. Cancelling an unneeded body is the correct behaviour against a real server, and is what keeps the body bound, so the adapter is unchanged.

The escape was contained by design: every synthetic provider host is under `example.test`, a reserved name that never resolves, so an escaped request fails loudly as a transport error rather than reaching anything. The network failure test now injects its failure through `fetchImplementation` and sends no unmatched request. The behaviour is recorded for the owner of the doubles below.

| Planted regression | Result |
|---|---|
| contract version not checked | 2 tests failed |
| body bound doubled | 1 failed |
| declared `Content-Length` ignored | 1 failed |
| `max-age` not capped | 1 failed |
| `Demo-Tenant-Id` not sent | 9 failed |
| abort swallowed as transport | 1 failed |
| a body about another record accepted | 1 failed |
| API key read on every call | 1 failed |
| any URL scheme accepted | 1 failed |

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 38 files, 913 tests passed, at 100 and at 1,000 property runs; the read path suite passed three runs in a row |
| Tests skipped | none |

Done when: the suite passes. It does on the agent's machine; complete once the author reproduces it.

### Findings

| For | Finding | Likely fix |
|---|---|---|
| Spec 00 CE2 | the msw interception escape above, in msw 3.0.3: a suite that both cancels mocked bodies and sends an unmatched request can have a later request escape | in the doubles, add a final catch all handler answering a network error for every request no provider handler matches, so nothing can pass through whatever msw's own strategy does; that changes what CE2's refusal test sees, so it is raised as a Spec 00 change rather than made here |
| RE3 | the adapter throws only on abort, with the signal's reason; the fan-out maps exactly that to `timeout` | test with `abortSignal.aborted`, as the Plan stage noted |

## RE3 Fan-out

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Assumptions verified

- RU1, RU2: 1,500 ms and 2,500 ms, now in `read-path-settings.ts` with a test that also holds the provider timeout inside the budget.
- RU3: `AbortSignal.any` combining a provider deadline, the budget and an optional parent signal; an abort reaches the adapter as its signal's reason.
- Run in RE3: under vitest's fake timers, `AbortSignal.timeout(1000)` had not fired after the clock advanced 1,500 ms, while a `setTimeout` aborting an `AbortController` had, and `AbortSignal.any` followed it. The deadlines are therefore ordinary timers: the same behaviour in production, and drivable in tests.

### Work completed

`provider-fan-out.ts` (pure, on the list in `tree-checks/pure-modules.json`): `fanOutToProviders` calls every adapter at once, each with its own `If-None-Match` version and the correlation identifier, under a per provider deadline, the fan-out budget and an optional parent signal (for §4.3's second call within the remaining budget). It returns one `ProviderCallOutcome` per adapter, in the order given, with its latency. It never retries (§3.1).

Two choices beyond the specification's text, both for §3's rule that one slow provider never blocks the others:

- Each call is raced against its own signal, so an adapter that ignores its signal still yields `timeout` on time; whatever such a call settles to later is dropped rather than left as an unhandled rejection.
- Every timer is cleared once the fan-out settles, so nothing wakes a frozen Lambda environment.

The timing is validated synchronously, so a bad value throws at once rather than as a rejected read.

### Tests first

The test file failed with `Cannot find module` before the source existed; the RU1 and RU2 test failed on its assertion before the constants existed. Lint then refused a loop flag it took to be constant because it is set in a callback; the test reads it through a function now.

| Planted regression | First result | After a new test |
|---|---|---|
| provider deadline set to the budget | 2 tests failed | |
| budget not applied | 1 failed | |
| call not raced against its signal | 1 failed | |
| an abort rejection mapped to transport | not caught | caught (1 failed) |
| timers left running | 1 failed | |
| parent signal ignored | 1 failed | |

The one not caught first exposed an untested path. The fan-out's own abort listener is registered before the adapter is called, so an abort during a call always wins the race, and the catch path's abort check is reached only when the signal has already fired before the call: then `fetch` rejects at once with the signal's reason, as the new test's adapter does. That path now reads as `timeout` under test.

Pure import check: a `node:fs` import planted in `provider-fan-out.ts` failed check 2 and ESLint, and both passed once removed.

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 39 files, 925 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

Done when: the suite passes, and the pure import check passes. Both hold on the agent's machine; complete once the author reproduces them.

### Anonymity check, 18 October 2026

At the author's instruction the family is an anonymous proof of concept: nothing may name the real organisation or its domain. Every file git would commit was searched for such terms; the only matches were the word "diagnostics" in `TESTING.md` (Node.js tooling) and a substring of a `package-lock.json` integrity hash. No change was needed.

(18 October 2026, after RE3.) At the author's request the check is now automated, as a Spec 00 change to check 1: an identifying-term rule in `tree-checks/src/prose-scan.ts`, with its term list stored reversed so it is not itself a finding. It reads code as well as prose, splitting identifiers into words first, so a camel or snake case spelling is caught; a term inside a longer word is not. The generated lockfile is exempt, as its hashes can hold any letters. Driven by ten new tests, which failed before the rule existed; no earlier assertion was edited. Proven: a planted term in a Markdown file and one in a code identifier each failed `npm run check:prose`, and both passed once removed. Planted regressions: identifiers not split into words (2 tests failed), the rule not run (10 failed).

## RE4 Read handler

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17, and after RQ4 was answered. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Scope as built

- `read-handler.ts`: `createReadHandler`, taking its adapters, logging (`ReadPathLog`, and the CQ3 interfaces), metrics (`ReadPathMetrics`, §8), cache policy and clocks as dependencies. RE5's Lambda entry point wires those to Powertools and the environment. Moving the entry point to RE5 keeps a small Spec 00 change with the phase that needs it: the Powertools adapter lives in `packages/construct-contracts`, whose main entry imports CDK, so a Lambda bundle needs a runtime only subpath.
- `read-cache-policy.ts` (pure): the disabled form RD1 allows, whose absence the handler logs once, when it is created.
- `read-path-settings.ts`: RU7 (5 seconds).

### Behaviour

- §2: correlation identifier (by the wrapper), authentication context, `records:read`, the `recordId` and `If-None-Match` bounds, then the ETag grammar; a breach answers 400 naming `pathParameters.recordId` or `headers.If-None-Match`, before any provider is called.
- §3.4: 404 when every provider answers `not-found` (so another tenant's record is 404, since providers key by tenant); 503 with `Retry-After: 5` when no provider answered; partial 200 otherwise.
- §4.3 with RQ4:
  - 304 needs every provider unchanged or holding nothing, and the unchanged ones to be exactly those in the client's ETag.
  - Unchanged providers alongside a changed one, or alongside a provider in the client's ETag that now holds nothing, are called again without `If-None-Match` within what remains of the budget, logged once and counted per provider as `ConditionalRefetch`.
  - When the rest failed and none answered 200, the answer is 503 without that call.
- §5: `Cache-Control: private, max-age=` the smallest ttl among answering providers on a complete 200 or a 304; `private, max-age=0, must-revalidate` on a partial 200; `Vary: Authorization` on both; an ETag only on a complete read.
- §8: every provider call recorded for `ProviderLatency` and `ProviderOutcome`, including the second calls; `ProviderSectionIgnored`, `ReadPartial`, `ReadNotModified` and `ReadAllSourcesUnavailable` counted.

### Tests first

`read-handler.test.ts` failed with `createReadHandler is not a function` (24 tests) before the source existed. Its rows run against the msw doubles, seeded without tenant-2's `record-0003` for the tenant isolation row, and against stub adapters for the rows no double can produce: a second call that fails, unchanged providers beside failed ones, every provider failing, unequal ttls, and a provider sending a section it does not own.

Check 3 then found a duplication in the new handler: it listed the failed statuses again, a rule the merge already held. The rule is now `isFailedStatus` in `record-merge.ts`, used by both.

| Planted regression | Result |
|---|---|
| RQ4 safeguard removed | 1 test failed |
| conditional second call skipped | 3 failed |
| ETag sent on a partial read | 2 failed |
| partial read cached | 2 failed |
| `Vary` missing on 304 | 1 failed |
| scope not required | 1 failed |
| bad `If-None-Match` accepted | 4 failed |
| `Retry-After` missing on 503 | 2 failed |
| all `not-found` answered 503 | 2 failed |
| absent cache not logged | 1 failed, once replanted: the first plant was a syntax error, which failed the file without running a test, so it proved nothing and was redone as a valid no op call |

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 40 files, 961 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

Done when: the suite passes. It does on the agent's machine; complete once the author reproduces it.

### For RE5

- The Lambda entry point: environment (`PROVIDER_TIMEOUT_MILLISECONDS`, `FAN_OUT_BUDGET_MILLISECONDS`, the provider variables), Secrets Manager reads, and Powertools behind `ReadPathLog` and `ReadPathMetrics`; the subsegment per provider call of §8.
- A Spec 00 change: a runtime only subpath of `packages/construct-contracts` for `createPowertoolsProblemHandling`, so the read bundle does not pull in CDK.

## RE5 ReadPath construct and read Lambda entry point

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Sources read

- The aws-cdk-lib 2.273.0 declarations for `lambda.Alias` (`provisionedConcurrentExecutions`), `lambda.Tracing`, `CfnFunction.reservedConcurrentExecutions`, `cloudwatch.MathExpression` and `Metric.createAlarm`: `createAlarm` is on `Metric` and `MathExpression`, not on `IMetric`, so the alarm helper takes those two.
- The Powertools 2.36.0 tracer declarations for `isTracingEnabled`, `getSegment` and `addNewSubsegment`: outside Lambda, tracing is off and there is no segment.

### Spec 00 changes

- `packages/construct-contracts` gains a `./runtime` export, `src/runtime/index.ts`, holding `createPowertoolsProblemHandling` and nothing that imports CDK. `runtime-subpath.test.ts` bundles it with esbuild and asserts that no `aws-cdk-lib` or `constructs` input is bundled, and that Powertools is.
- `createDemoNodejsFunction` gains `activeTracing`, which sets `Tracing.ACTIVE`; left unset, a function's tracing is unchanged.

### Work completed

- `read-path-configuration.ts`: the function's environment, read strictly at cold start: a known stage, whole millisecond budgets, and a fan-out budget longer than the provider timeout.
- `read-path-observability.ts`: Powertools behind `ReadPathLog`, `ReadPathMetrics` and the CQ3 interfaces. Each §8 metric is a single metric with its own dimensions; `errorReason` appears only on an outcome that has one. `traceReadAdapters` opens a subsegment per provider call, annotated with `providerId` and `status` (`timeout` on an aborted call, `error` on any other rejection), closed either way, and passes the call straight through when there is no segment.
- `read-handler-entry.ts`: the Lambda handler. It parses the configuration, reads the provider secrets from Secrets Manager, wraps the configured adapters for tracing, and gives `createReadHandler` the disabled cache policy (RD1).
- `read-path-construct.ts`: `ReadPath`, implementing `ReadPathOutputs`.
  - One function, `demo-<stage>-read`: 512 MB, 5 seconds, reserved concurrency 100, active tracing, no VPC.
  - Reached through a `live` alias, with provisioned concurrency 2 in demo only (RU13).
  - `secretsmanager:GetSecretValue` on the three provider secrets and nothing else.
  - Synth fails without each routing table provider exactly once, and on any cache that is switched on (`read-cache-needs-approval-reference`, then `read-cache-not-built`, since RE7 is unscheduled).
  - Six alarms to the alarm topic, missing data not breaching, over 5 minutes: a timeout rate above 10 per cent per provider, and any version mismatch, all sources unavailable or function error.
- `read-bundle.test.ts` bundles the entry point and asserts it holds `read-handler.ts` and no CDK, `constructs`, msw or test double code.

The construct is not yet wired into `infra`: that is CE6.

### Tests first

`read-path-configuration.test.ts`, `read-path-observability.test.ts` and `read-path-construct.test.ts` each failed with `Cannot find module` before their source existed.

| Planted regression | Result |
|---|---|
| runtime subpath re-exports the CDK stubs | 2 tests failed |
| reserved concurrency unset | 1 failed |
| provisioned concurrency in every stage | 1 failed |
| tracing off | 2 failed |
| secret permission broadened with `ListSecrets` | 1 failed |
| cache switched on without approval passes the first guard | 1 failed |
| timeout rate threshold changed to 20 | 1 failed |
| alarms not sent to the topic | 1 failed |
| subsegment status not annotated | 1 failed |
| `errorReason` dimension misnamed | 1 failed |
| budget not checked against the provider timeout | 1 failed |

Each planted file was restored byte for byte.

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 45 files, 997 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

Done when: the construct synthesises with the §7 settings and the §8 alarms, and the entry point bundles without CDK. Both hold on the agent's machine; complete once the author reproduces them.

### For CE6

- Wire `ReadPath` into `infra/lib/demo-platform.ts` in place of the read stub, with the mock provider connections and the alarm topic.

## RE6 Checks against the mock providers

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17, under RQ1 and CQ6. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Scope as built

- `infra/test/read.spec.ts`, at the path Spec 02 names. It loads the read function's entry point, `read-handler-entry.ts`, and invokes its exported handler directly with the shared event builder. The three mock providers run as local servers (`startLocalMockProviders`) on ports the operating system picks, over real HTTP.
- The function's environment is the one the construct deploys: `read-function-environment.ts` now builds it, and the `ReadPath` construct and the suite both call it. The construct's check that each routing table provider appears exactly once moved there with it; the RE5 synth suite still covers it.
- Secrets Manager is the one stand in: `aws-sdk-client-mock` answers each provider's secret ARN with that provider's synthetic API key.
- The seed leaves out tenant-1's `record-0004`, so the tenant isolation row has a record that tenant-2 holds and tenant-1 does not.

### Spec 00 changes

- `vitest.config.ts` also runs `infra/test/**/*.spec.ts`, so a deployed check keeps the name its specification gives it.
- `services/read` exports `./read-handler-entry`, for the suite alone; the bundle is still built from the source file.
- `infra` gains development dependencies on `@demo/read`, `@demo/mock-providers`, `@demo/test-doubles`, `@demo/contracts`, `@aws-sdk/client-secrets-manager`, `aws-sdk-client-mock` and `@types/aws-lambda`, all at versions the tree already pins.

### Checks

Spec 02's seven, plus one the datum asks for:

1. A normal record: 200, not partial, three `ok` sources and an ETag.
2. The same request with that ETag: 304.
3. `slow-b-`: 200 within the 2,500 ms budget, partial, provider-b `timeout`, no ETag, `private, max-age=0, must-revalidate`.
4. `down-a-`: 200, partial, provider-a `error`.
5. An unknown record: 404.
6. A `tenant-2` record read with a `tenant-1` event: 404; read with a `tenant-2` event: 200, so the 404 is not vacuous.
7. An event without `records:read`: 403.
8. Everything the function wrote to standard output and standard error holds the absent cache log (proving the capture works) and neither any provider API key nor the subject (datum 0.15, CD5).

### Tests first

The suite was first not run at all: the harness matched only `*.test.ts` (`No test files found`). With the include added, it failed with `"./read-handler-entry" is not exported` before the subpath and `readFunctionEnvironment` existed.

Each regression was planted with only `read.spec.ts` running, so a catch is RE6's own:

| Planted regression | Result |
|---|---|
| tenant header not sent to the providers | 6 of 8 failed |
| `If-None-Match` not forwarded to the providers | 1 failed |
| provider base URLs crossed in the environment | 6 failed |
| the secret ARN used as the API key | 6 failed |
| scope not required | 1 failed |
| the entry point logs the event | 1 failed |
| provider timeout and budget outlasting a slow provider | 1 failed, once replanted: the first plant repeated an object key, and its failure gave no test count, so it proved nothing and was redone as a valid change |

Each planted file was restored byte for byte.

### What this does not cover

Recorded under `IMPLEMENTATION_DEVIATIONS.md` entry 3: the suite runs the entry point's TypeScript source in Node.js v22.23.2, not the bundle on the Lambda runtime; Secrets Manager, IAM and the network between function and providers are not exercised; Powertools tracing is off outside Lambda, so no trace is produced.

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 46 files, 1,005 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

Done when: under RQ1, the suite passes locally and in CI. It does on the agent's machine; complete once the author reproduces it, and CI is seen to run it after a push.

# Spec 03 write path

Plan stage worked on 18 October 2026, after reading Spec 03 Draft 2 once, top to bottom, and rereading datum Part 0, 0.17 and Stage one. Status: evidence gathered; author decisions outstanding (Decisions still needing the author, at the end of this section).

## Shared ground

- Reference implementations: read in the Spec 00 Plan stage (commits and what was taken are recorded there); nothing further applies to the write path.
- Environment: as the Spec 00 record states; local Node.js v22.23.2, target Node.js 24 (CQ1, CQ5), nothing deployed (CQ6).
- Built and ready for this stream: `packages/contracts` (CE1: `CommandRequest`, `OperationStatus`, `WriteAdapter`, `ApplyOutcome`, and the bounds including `commandRequestBodyMaximumBytes` 65,536, `queueMessageBodyMaximumBytes` 256 and `providerRetryAfterMaximumSeconds` 3,600), the msw doubles, provider simulation and event builder (CE2), the tree checks (CE3), the local mock providers with the `flaky-`, `throttle-`, `poison-` and `conflict-` write faults (CE4), and `WritePathProperties` with `relayEnabled` (CE5).
- Packages read for this record, as installed: `@aws-sdk/client-dynamodb` 3.1152.0 (`dist-types/models`), and `aws-cdk-lib` 2.273.0 (`aws-lambda-event-sources`, `aws-scheduler`, `aws-scheduler-targets`).

## WU values

Basis: read, from the sources named, retrieved 18 October 2026, unless the row says otherwise. AWS documentation pages are under `https://docs.aws.amazon.com/`. Nothing could be run against AWS (CQ6).

| Identifier | Value assumed | Source | Conclusion |
|---|---|---|---|
| WU1 | how payload format 2.0 presents the body | `apigateway/latest/developerguide/http-api-develop-integrations-lambda.html`; CU3 | not settled: the page shows `isBase64Encoded` but says nothing of when an HTTP API encodes a request body, and the experiment needs a deployed gateway (WQ2, WQ4) |
| WU2 | a failed transaction condition says which item failed | SDK model documentation of `TransactionCanceledException` | holds: `CancellationReasons` are in request order, `None` for an item without error and `ConditionalCheckFailed` for a failed condition; `ReturnValuesOnConditionCheckFailure` set to `ALL_OLD` returns the existing item, so intake can read the stored `requestHash` from the failure itself |
| WU3 | the item size limit is well above the command bound | `amazondynamodb/latest/developerguide/Constraints.html` | holds: 400 KB per item, attribute names included, against a 65,536 byte command; maps nest to 32 levels |
| WU4 | the per partition write limit | `amazondynamodb/latest/developerguide/bp-partition-key-design.html` | 1,000 write units a second per partition. Each intake adds a `pending-index` entry and each move out of `ACCEPTED` removes it, so one `PENDING` partition serves about 500 intakes a second: ample at demo volume, as §4.2 assumes |
| WU5 | a TTL deletion can be told apart | `amazondynamodb/latest/developerguide/time-to-live-ttl-streams.html` | holds: `userIdentity.type` is `Service` and `userIdentity.principalId` is `dynamodb.amazonaws.com` |
| WU6 | filters can select operation inserts and TTL removals | `lambda/latest/dg/invocation-eventfiltering.html` | holds: up to five filters, ORed, each matching fields such as `eventName` and `dynamodb.Keys.sortKey.S`; a stream record matching none is passed over, not retried |
| WU7 | per record failures, batch splitting, bounded retries, an on failure destination | `lambda/latest/dg/services-dynamodb-errors.html`; `lambda/latest/dg/monitoring-metrics-types.html`; CDK `stream.d.ts` | holds, with one correction: the destination may be SNS, SQS, S3 or Kafka, but an SQS FIFO queue is an unsupported destination type (under `DestinationDeliveryFailures`), so `relay-failures` must be a standard queue. The destination record holds batch metadata only, not the records, which the sweep's recovery already allows for |
| WU8 | FIFO deduplication window 5 minutes | `AWSSimpleQueueService/latest/APIReference/API_SendMessage.html` | holds: a 5 minute deduplication interval; identifiers up to 128 characters |
| WU9 | sweep every 2 minutes on EventBridge Scheduler | `scheduler/latest/UserGuide/schedule-types.html`; CDK `aws-scheduler` | consistent: `rate(2 minutes)` is valid, with 60 second precision; the CDK has `Schedule`, `ScheduleExpression.rate` and the `LambdaInvoke` target. The value is an author decision (WQ5) |
| WU10 | grace 60 s; 100 operations or 50 s a run | author decision | consistent: 50 s is below WU20's 60 s sweep timeout, and a 2 minute schedule leaves no overlap (WQ5) |
| WU11 | visibility timeout 120 s | `lambda/latest/dg/services-sqs-configure.html` | consistent: Lambda advises at least six times the function timeout, and 6 × 20 s is 120 s; Lambda refuses a function timeout above the visibility timeout |
| WU12 | retention 4 days and 14 days | `AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html`; `sqs-dead-letter-queues.html` | consistent: 60 s to 14 days allowed. For a FIFO queue the enqueue timestamp resets on the move to the dead letter queue, so a dead letter keeps the full 14 days (WQ5) |
| WU13 | 5 receives | `lambda/latest/dg/services-sqs-configure.html` | consistent: Lambda advises a `maxReceiveCount` of at least 5 (WQ5) |
| WU14 | concurrency cap 10 | CDK `sqs.d.ts`, `maxConcurrency` | consistent: the allowed range is 2 to 1,000 (WQ5) |
| WU15 | per call abort 8,000 ms | author decision | consistent: below WU20's 20 s worker timeout (WQ5) |
| WU16 | receive count from `ApproximateReceiveCount` | `AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html` | holds as defined: the number of times a message was received and not deleted; a visibility change is not a receive. Whether a visibility the worker sets survives Lambda handling the reported failure is stated nowhere read, including `lambda/latest/dg/services-sqs-errorhandling.html` (WQ2) |
| WU17 | backoff 5 s doubling, cap 300 s, 20 per cent jitter | `quotas-messages.html` | consistent: below the 12 hour visibility maximum. Whether jitter may take a delay above the cap is open (WQ5) |
| WU18 | a timeout on the last receive leaves `APPLYING` | none | not settled: an experiment on a deployed stack, impossible under CQ6. The §7 operator rows already take `APPLYING` as a source, so the design holds either way (WQ2) |
| WU19 | status `Retry-After` 2 s and 60 s | author decision | consistent (WQ5) |
| WU20 | memory and timeouts | author decision | to be measured: as RU10, a synth constant under CQ6 (WQ5) |
| WU21 | alarm thresholds | `lambda/latest/dg/monitoring-metrics-types.html` | consistent: `IteratorAge` exists in `AWS/Lambda` for DynamoDB streams, in milliseconds, so 60 s is 60,000; `Errors` counts timeouts and runtime errors as well as throws (WQ5) |
| WU22 | group identifier allows 64 hexadecimal characters | `API_SendMessage.html` | holds: `MessageGroupId` takes 128 characters, and a SHA-256 in hexadecimal is 64 |

## Design notes for the write phases

Recorded so the phases do not rediscover them.

- WE4: the adapters must send `Demo-Tenant-Id` (CQ7.1), which §6.5's header list predates, as Spec 02's did.
- WE4: providers answer a stale `If-Match` with 412 (CQ7); the doubles never send 409, which §6.5 also maps, so that row is tested through a stub transport.
- WE4: no fault prefix gives a write a version mismatch, an oversized body or an invalid header (`oldversion-`, `oversize-` and `badheader-` apply to reads), so those §6.5 rows are tested through an injected `fetch`, as RE2 tested network failures. No Spec 00 change is needed.
- WE5: the Spec 00 CU9 finding stands: `slow-` waits 3,000 ms, below WU15's 8,000 ms, so no prefix times a write out. The per call abort is tested with stub adapters and fake timers; no Spec 00 change is needed.
- WE3: `relay-failures` is a standard queue (WU7). Spec 03 §5.1 names only its component, so this is not a departure.
- WD1 evidence: a mock provider replays an idempotency key for 1 day (CU11). A command redriven after that, whose first attempt applied but whose answer was lost, meets `If-Match` with the old version and ends `CONFLICT`: it is never applied twice, but the reported state can be `CONFLICT` for a command that did apply. Set out for WD1 and WD3.
- WE5: the SQS documentation warns that a dead letter queue breaks strict order. A redriven command reaches its provider after later commands for the same record, which `If-Match` turns into `CONFLICT` rather than an overwrite.

## Decisions still needing the author

Batched for the Spec 03 Plan stage exit (datum 0.3). WD1 to WD4 are stated in the five part form in Spec 03 §12, and their recommendations stand on the evidence above. The questions raised here:

- **WQ1** How WE9 runs under CQ6. Blocks WE9.
    - Why open: WE9 invokes deployed functions against deployed queues and a deployed table; under CQ6 there are none, and nothing in the tree simulates DynamoDB Streams or an SQS FIFO queue.
    - Options: (a) an automated local suite, `infra/test/write.spec.ts`: the real intake, relay, sweep, worker and status handlers, joined by an in-memory journal with a stream and an in-memory FIFO queue with message groups, visibility, receive counts and a dead letter queue, on a controlled clock, with the worker's real adapters calling the local mock provider servers; (b) emulators, DynamoDB Local and an SQS compatible server, in containers; (c) no local WE9: rely on the WE1 to WE8 suites and record a deviation.
    - Trade offs: (a) runs every handler and the provider side for real, in CI, but the journal and queue behaviour is the suite's model of AWS, not AWS; (b) is closer to the services, but adds Docker and a Java runtime to the toolchain and to CI, and an emulator is still not AWS; (c) is cheapest, but loses the ordering, backoff and redrive evidence that only the whole flow shows.
    - Recommendation: (a), with the in-memory journal and queue in `services/write/test/support`, and the relay disabled row run with the relay left out. It runs locally and in CI and is no longer an author gate, as RQ1 did for RE6.
- **WQ2** What becomes of the AWS behaviours nothing local can show. Blocks WE2, WE5, WE7.
    - Why open: three behaviours need a deployed stack: how an HTTP API presents a request body (WU1); whether a visibility the worker sets survives Lambda handling the reported failure (WU16); and what a timeout on the last receive leaves (WU18).
    - Options: (a) record them as unverified in `IMPLEMENTATION_DEVIATIONS.md`, as entry 4 did for CU4, and build so each outcome is safe; (b) hold WE2, WE5 and WE7 until a deployment exists.
    - Trade offs: (a) keeps the stream moving, and each outcome is safe by design: intake reads both body forms (WQ4); if Lambda resets the visibility, a retry waits WU11's 120 s instead of its backoff, slower but correct; the operator rows already accept `APPLYING`. The behaviours themselves stay unobserved. (b) observes them, but CQ6 has no deployment to observe them on.
    - Recommendation: (a).
- **WQ3** How the adapters map provider answers that §6.5 does not list. Blocks WE4.
    - Why open: CQ7 added 401 for a bad `X-Api-Key` and 428 for a missing `If-Match` after §6.5 was drafted, and §6.5 names no outcome for any other status.
    - Options: (a) 401, 428 and any other unlisted status to `retryable`, with reason categories `api-key-refused`, `if-match-required` and `unexpected-status`, so the command reaches the dead letter queue, and an operator, after WU13 receives; (b) the same statuses to `rejected`, so the operation ends `FAILED` at once.
    - Trade offs: each is a fault on the platform's side (a rotated key, an adapter defect), not in the client's command. (a) keeps the command for a person to redrive once the fault is fixed, and the dead letter alarm makes it visible (datum 0.15), at the cost of WU13 attempts that will each be refused. (b) is quicker, but tells the client its command failed for a reason it did not cause, and discards the command.
    - Recommendation: (a).
- **WQ4** How intake bounds a base64 encoded body. Blocks WE2.
    - Why open: §3.1 step 3 bounds the body as received, before decoding, and WE2 tests a base64 encoded body over the bound; but the bound is stated in bytes of the command, and WU1 is unsettled.
    - Options: (a) refuse encoded text longer than the encoded length of the bound (four characters for every three bytes, rounded up: 87,384 characters for 65,536 bytes), then decode strictly and hold the decoded bytes to 65,536; (b) refuse every base64 encoded body with 400, since a command is JSON.
    - Trade offs: (a) accepts either form the gateway may send, and still bounds before decoding; (b) is simpler, but would refuse every command if the gateway does encode JSON bodies, which WU1 leaves open.
    - Recommendation: (a), with the encoded bound derived from `commandRequestBodyMaximumBytes` in `packages/contracts`, so the bound is stated once.
- **WQ5** The WU author values: WU9, WU10, WU12 to WU15, WU17, WU19, WU20 and WU21. Block WE3, WE5, WE6 and WE8.
    - Why open: Appendix A gives each as an author decision, or a value after measurement, and under CQ6 nothing can be measured.
    - Options: Appendix A as written, with jitter subtracting up to 20 per cent so no delay exceeds the 300 s cap; Appendix A with jitter adding; other values.
    - Trade offs: every value is consistent with the limits read above. Jitter that adds can take a delay to 360 s, past the cap WU17 names; jitter that subtracts keeps the cap a true maximum.
    - Recommendation: Appendix A as written, jitter subtracting, and WU20 kept as synth constants, as RU10 was.

### Answers, 18 October 2026

Given by the author in the working session, recorded as given: "Taking your recommendations on them makes sense, lets do that. We can always make changes later, getting a scaffolding up helps us visualise whats what."

| Item | Decision |
|---|---|
| WD1 | keep the queue, and record the departure from datum 0.17 item 10 as `IMPLEMENTATION_DEVIATIONS.md` entry 9; its covering tests are WE5's |
| WD2 | a pure function, `request-hash.ts`, serialising with keys sorted at every depth; no dependency |
| WD3 | operations 30 days, idempotency entries 7 days. `PRIVACY.md` is still owed (the Spec 00 §2.5 finding), and must state these when written |
| WD4 | `records:write` for the status route |
| WQ1 | (a): `infra/test/write.spec.ts` runs the real handlers, joined by an in-memory journal, stream and FIFO queue in `services/write/test/support`, against the local mock provider servers; it runs locally and in CI and is no longer an author gate. Resolving the `poison-` operation with `dlq:resolve:dev` needs a deployed stage, and is raised again at WE7 |
| WQ2 | (a): WU1, the visibility after a reported failure, and WU18 are recorded as unverified, `IMPLEMENTATION_DEVIATIONS.md` entry 10, and each outcome is built to be safe |
| WQ3 | (a): 401, 428 and any other unlisted status map to `retryable`, with reason categories `api-key-refused`, `if-match-required` and `unexpected-status` |
| WQ4 | (a): encoded text over the encoded length of the bound is refused before decoding; the decoded bytes are then held to `commandRequestBodyMaximumBytes` |
| WQ5 | Appendix A as written, jitter subtracting up to 20 per cent, WU20 kept as synth constants |

### Plan stage exit (Spec 03)

Closed on 18 October 2026: every WU value is read, decided, or recorded as unverified with the author's agreement (WQ2); every decision is answered. The author's own words describe the answers as open to change once the scaffolding stands; each change would be recorded here, dated.

## WE1 State machine and journal store

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17, and after the Spec 03 Plan stage closed. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Assumptions verified

- WU2 and WU3: read in the Plan stage. WU2 is now relied on: a cancelled transaction carries the existing idempotency item, so a replay is answered without a second read.
- Read for this phase, as installed: `@aws-sdk/lib-dynamodb` 3.1152.0 leaves the item on a condition failure in DynamoDB's attribute value form (no error handling in `dist-cjs` touches it), so the store unmarshalls it with `@aws-sdk/util-dynamodb` 3.996.9, the version `lib-dynamodb` itself depends on.
- WD3: operations expire after 30 days and idempotency entries after 7 (`write-path-settings.ts`).

### Work completed

- `services/write`, a new workspace.
- `operation-state-machine.ts` (pure, listed in `tree-checks/pure-modules.json`): §7 as data. Each row names its source states, target, origins, and whether it adds an attempt (every move to `APPLYING`) or a redrive (the operator's move to `QUEUED`). `ACCEPTED` has no source: intake creates it by a conditional put.
- `journal-store.ts`: `createOperation`, `readOperation`, `readIdempotencyEntry`, `transitionOperation` and `listPendingOperations`.
  - Creation writes the operation and its idempotency entry in one transaction, each conditional on not existing. Only the idempotency item failing its condition is a replay; every other failure goes to the caller.
  - Reads are strongly consistent. Every item is checked for `schemaVersion` 1 first, then against a strict schema, including its payload against the very command schema intake uses; a refusal throws `JournalItemRejectedError` and counts `JournalItemRejected` by reason and item kind.
  - A transition needs an origin, checked by type and at run time; takes its allowed sources from the state machine; refuses, before any request, a transition the machine lacks or a detail its target does not carry; sets the target's detail and clears the others; always removes the pending attributes. On a failed condition, a relay, sweep or worker transition logs and counts `StaleTransition` once and stops; an operator transition reports done when the target is already set, without adding to `redriveCount`, and stops on any other state.
  - The pending list reads `pending-index` below a cutoff, oldest first, across pages, up to its limit; `operationId` comes from the table key, since the index projects only the keys and `tenantId`.
- `command-journal-construct.ts`: `CommandJournal`, the §4 table and `pending-index`, for WE8 to build on. Spec 03 §10's layout names no file for it; the table is WE1's work and `WritePath` is WE8's. No removal policy is set, so the CDK default of retaining the table holds: it keeps commands clients were told are accepted (datum 0.14).
- `test/support/fake-command-journal-table.ts`: the table behind `aws-sdk-client-mock`, interpreting only the request forms the store sends and refusing any other; condition failures carry the item in attribute value form, as DynamoDB returns it. WQ1's local WE9 suite can reuse it.

### Spec 00 changes

- `packages/contracts` exports `operationDetailField(state)`, the rule the status schema already used, so the journal sets and clears details by the same rule rather than a copy. Recorded in `packages/contracts/CONTRACT.md`. Its test was seen to fail (`operationDetailField is not a function`) before the export existed.
- `tree-checks/pure-modules.json` lists `services/write/src/operation-state-machine.ts`.

### Tests first

`operation-state-machine.test.ts`, `journal-store.test.ts` and `command-journal-construct.test.ts` each failed with `Cannot find module` before their source existed.

Check 3 then flagged four arrays of state names in the state machine as parallel lists of the state enum. Each is one §7 row's sources, not a copy of the enum, so the operator rows' repeated pair became one constant and each array carries the check's exemption marker with that reason.

| Planted regression | Result |
|---|---|
| worker may not move `ACCEPTED` to `APPLYING` | 5 tests failed |
| no attempt added on `APPLYING` | 3 failed |
| no redrive counted | 3 failed |
| operator may queue from `ACCEPTED` | 5 failed |
| origin not checked at run time | 1 failed |
| stale transition not counted | 4 failed |
| operator handled as a stale caller | 2 failed |
| `schemaVersion` not checked first | 2 failed |
| pending attributes kept on transition | 3 failed |
| replay detected from the wrong cancellation reason | 1 failed |
| operation read eventually consistent | 3 failed |
| reads sent as another command, refused by the fake | 4 failed |
| idempotency entries kept 1 day | 1 failed |
| point in time recovery off | 1 failed |
| `pending-index` projecting everything | 1 failed |
| `DEAD_LETTERED` losing its detail rule in the contract | 4 failed |
| an AWS SDK import in the state machine | check 2 failed: `Pure module: no AWS SDK` |

Each planted file was restored byte for byte.

### A git write made in error

(18 October 2026.) To redo the contract export from a failing test, the agent ran `git checkout` on `packages/contracts/src/operation-status.ts`, which datum 0.1 does not allow: only read only git commands are. A `git diff --stat` just before showed the file's only change was the agent's own 8 added lines; the command restored the committed version in the working tree and touched no history, index or branch. The edit was then redone after its test failed. Undoing an edit is done with the editor from now on.

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 49 files, 1,035 tests passed, at 100 and at 1,000 property runs, and once more at 100 |
| `cdk synth` | all four stacks |
| Tests skipped | none |

The first full run after the clean install was not clean, and is reported as it happened: the new construct test's setup timed out at the default 10 seconds, so its 4 tests were skipped, and `packages/construct-contracts/test/demo-nodejs-function.test.ts` (CE5) failed once. The construct test now allows 180 seconds for synthesis, as RE5's does. The CE5 test, which already allows 60 seconds, passed on three later runs and is left as it is (datum 0.4); it is a finding for its owner below.

Done when: the suite passes against `aws-sdk-client-mock`, and the pure import check passes on the state machine. Both hold on the agent's machine; complete once the author reproduces them.

### Findings

| For | Finding | Likely fix |
|---|---|---|
| Spec 00 CE5 | `demo-nodejs-function.test.ts` failed once, on the first full run after a clean `npm ci`, and passed on three runs after; its test bundles with esbuild, which a cold cache and a loaded machine slow | the author's call: a longer timeout, or leave it and watch for a repeat |
| Spec 03 WE5 | §6.3 saves `lastErrorReason` on a retryable outcome without a state change, but §4.4's five store functions have no update outside a transition | WE5 adds that update to the store, raised then as a change to §4.4's list |
| Spec 03 WE6 | WD4 is answered (`records:write`); `packages/contracts/CONTRACT.md` still records the status route's scope as open | WE6 records the scope where the route is defined |

## WE2 Intake

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; awaiting the author's reproduction.

### Assumptions verified

- WU1: unsettled, recorded as unverified (`IMPLEMENTATION_DEVIATIONS.md` entry 10); intake reads both body forms (WQ4).
- WU2: relied on through WE1's `createOperation`, which reports an existing idempotency entry from the cancelled transaction.
- WD2: answered; `request-hash.ts` is the pure function.

### Work completed

- `request-hash.ts` (pure, listed in `tree-checks/pure-modules.json`): the SHA-256, in hexadecimal, of `{ body, tenantId }` as JSON with keys sorted at every depth, list order kept and no whitespace. The mock providers' version (CQ7.6) uses the same canonical form; the two are kept apart deliberately, with a comment saying why, since one is a provider wire rule and the other intake's own (datum 0.7).
- `operation-status-mapping.ts`: `toOperationStatus`, §9 step 4's mapping, checked against `OperationStatusSchema`; WE6 will use it too.
- `handlers/intake-handler.ts`: `createIntakeHandler`, in §3.1's order.
  - `records:write`; then `Content-Type`: `application/json`, optionally with `charset=utf-8`, in any case; any other value is refused naming `headers.Content-Type`. Spec 00 §3.4 says only that it must be `application/json`. A UTF-8 charset parameter is accepted because the bound and every grammar are stated over UTF-8, and a client naming it sends the same bytes.
  - `Idempotency-Key`: missing, malformed or too long answers `idempotency-key-required`.
  - The body (WQ4): plain text goes to `parseCommandRequestBody`, which bounds its bytes before parsing; base64 text is refused beyond 87,384 characters before decoding, then must be strict base64, then strict UTF-8.
  - The command: `parseCommandRequestBody`'s strict schema. The provider comes from `owningProviderForSection`.
  - The operation is minted, journalled and answered 202 with `Location`, `Cache-Control: no-store` and the `ACCEPTED` status. A replay with the same hash answers the original operation's current status with `Idempotent-Replayed: true`; a different hash answers 422; any other failure 500.
  - `CommandsAccepted`, `IdempotentReplay` and `IdempotencyKeyReused` are counted, and `operationId` is bound to the log once known.
- Intake calls no provider: it is given no adapter.

### Tests first

`request-hash.test.ts` and `intake-handler.test.ts` failed with `Cannot find module` before their source existed. The request hash has two fast-check properties: key order at any depth never changes the hash, and any change of value, compared as JSON reads it back, always does.

Two of the first expectations were the agent's own errors, corrected against the contract: notes belong to provider-b, not provider-c; and an unknown key is reported at its enclosing object (path `''`), by the contract's design, so a caller's key name is never echoed.

The first round of plants found four gaps, each closed:

| Plant that survived | Why | What changed |
|---|---|---|
| decoded bytes not bounded | `parseCommandRequestBody` already holds the decoded text to the same bound | the duplicate check removed; one layer owns the bound (datum 0.7) |
| command type routing check removed | `CommandRequestSchema` already refuses any command type but the section's own | the duplicate check removed, for the same reason |
| base64 not checked strictly | the test inputs were not JSON however decoded | tests added: base64 with its padding removed, and with a line break, each of which a lenient decoder turns into a valid command |
| invalid UTF-8 replaced, not refused | as above | a test added: an invalid byte inside a string value, which replacement would hide |
| hash taken over a fixed tenant | no test read a tenant-2 operation's hash | the tenant isolation test now checks it |

| Planted regression | Result |
|---|---|
| read scope accepted for writes | 28 tests failed |
| `Content-Type` not checked | 4 failed |
| any charset accepted | 1 failed, once replanted: the first plant's search text, escaped in the plant file, matched nothing, and the runner said so |
| `Idempotency-Key` not validated | 3 failed |
| encoded length not bounded before decoding | 1 failed |
| encoded bound off by one | 1 failed |
| base64 body not decoded | 1 failed |
| base64 not checked strictly | 2 failed |
| invalid UTF-8 replaced, not refused | 1 failed |
| replayed body not compared | 1 failed |
| replay not marked | 1 failed |
| `Location` naming the wrong route | 2 failed |
| `no-store` missing | 2 failed |
| hash taken over a fixed tenant | 1 failed |
| hash keys not sorted | 2 failed |
| hash ignoring the tenant | 2 failed |
| an AWS SDK import in `request-hash.ts` | check 2 failed: `Pure module: no AWS SDK` |

Each planted file was restored byte for byte.

### Finding: a doubled path in the contract

`invalidFieldsFromZodError` in `packages/contracts/src/invalid-fields.ts` (CE1) reports an unknown section as `section.section`. Run on zod 4.6.7: an `invalid_union` issue for a discriminated union already carries the discriminator in its `path` (`["section"]`, and `["outer","section"]` when nested), and `pathForIssue` appends it again. The problem document names a field that does not exist, though it still carries no input value. CE1's own test of an unknown section checks only that it is refused. WE2's test holds that path by its start until the owner fixes it, and says so. Likely fix: append the discriminator only when the path does not already end with it, with CE1's test extended to the exact path. It belongs to Spec 00, and is raised before CD1 freezes the contract.

### Line endings

After the author's WE1 commit, two files in `packages/contracts` were on disk with CRLF endings, which `format:check` flagged. Prettier rewrote them to LF; `git ls-files --eol` shows LF in the index and working tree and `git diff` shows no change. With `core.autocrlf` on, a commit can leave files this way locally; CI checks out LF.

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 51 files, 1,071 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

Done when: the suite passes. It does on the agent's machine; complete once the author reproduces it. With RE4 also passing, CD1's condition for freezing the contract is met on the agent's machine; the freeze itself is the author's (datum 0.11).

## Spec 00 change: the doubled path, and the CD1 freeze

Worked on 18 October 2026, after WE2, at the author's instruction: "Fix the CE1 doubled path as a Spec 00 change, tests first, then freeze the contract under CD1."

### The fix

- Test first: `packages/contracts/test/invalid-fields.test.ts` gained a test that an unknown discriminator is named once, at the top level (`section`) and nested (`command.section`). It failed with `section.section` before the fix.
- Run on zod 4.6.7: an unknown discriminator's issue path already ends with the discriminator whether the value is missing, of another type, `null` or unknown; an input that is not an object gives `invalid_type` at the root instead. So `pathForIssue` needed no special case, and the one that appended the discriminator was removed.
- Planted: the old branch put back fails that test (1 failed).
- WE2's intake test still holds the path by its start; its assertion is left as it is (datum 0.4), and its comment now points to the contract test that pins the exact path.

### The freeze

- `packages/contracts/CONTRACT.md` records the contract as frozen at version 1.0.0, in the author's words, with the rule for every later change: a version decision for the author, a major version and migration notes for anything that breaks a consumer.
- `@demo/contracts` moved from 0.1.0 to 1.0.0, and every workspace that depends on it names 1.0.0.
- Spec 00 itself still says the contract is provisional until CD1 freezes it, which is now so; the specification is the author's document and is not edited.

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 51 files, 1,072 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

After the author's WE2 commit, six files were on disk with CRLF endings; Prettier rewrote them to LF, with no change in content (`git ls-files --eol` shows LF in the index).

## WE3 Relay and sweep

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; five stream mapping values await the author (WQ6 below), then the author's reproduction.

### Assumptions verified

- WU5, WU6, WU7, WU8 and WU22: read in the Plan stage, and now relied on (TTL identity, two ORed filters, per record failures with splitting and an SQS destination, a 5 minute deduplication window, 64 of 128 group characters).
- WU9 and WU10: Appendix A as written (WQ5): every 2 minutes, 60 seconds' grace, 100 operations or 50 seconds a run.
- WD1: answered; deviation entry 9.
- Read for this phase, as installed: `aws-cdk-lib` 2.273.0 `DynamoEventSource`, `SqsDlq`, `FilterCriteria`, `Schedule` and `LambdaInvoke`; `@types/aws-lambda` 8.10.164 `DynamoDBStreamEvent` and `DynamoDBBatchResponse`. `FilterRule.isEqual` is typed `any`, so the filter patterns write out the one element lists it would build.

### Dependency record (datum 0.13)

`@aws-sdk/client-sqs` 3.1152.0: sends to the commands queue. The platform offers no other SQS client; it is the AWS SDK v3 family already pinned at this version, Apache-2.0, maintained by AWS, and provided by the Lambda runtime, so bundles leave it external. Tested through `aws-sdk-client-mock`. Replacing it means another SQS client, a small change behind `CommandQueueSender`.

### Work completed

- `message-group.ts` (pure, listed in `tree-checks/pure-modules.json`): the SHA-256 of `tenantId#recordId`.
- `command-queue.ts`: `CommandMessageSchema` (strict: `messageVersion` from `contractVersions`, and `operationId`), `formatCommandMessage`, the `CommandQueueSender` interface and its SQS implementation. WE5's worker parses with the same schema.
- `enqueue-operation.ts`: send, then move to `QUEUED` with the caller's origin; a stale transition after the send answers `already-moved`; a failed send leaves the operation `ACCEPTED` for the sweep.
- `handlers/relay-handler.ts`: an operation insert is checked by `readOperationImage` and enqueued; a removal by time to live counts `JournalItemExpired` by item kind; anything else the filter should have kept out is passed by. On the first failure it reports that record and every later one, sends none of them, and logs and counts the batch once. A record without a sequence number fails the whole batch.
- `handlers/sweep-handler.ts`: lists pending operations past the grace period, sends each one still `ACCEPTED`, logs once per run that sends, counts each recovery, stops at the batch or time limit and counts which, and logs the absent relay at cold start when `relayEnabled` is false.
- `write-function-configuration.ts`, `write-path-observability.ts` and the two entry points, as RE5 built them for the read path.
- `command-relay-construct.ts`: `CommandRelay`, the relay with its filtered mapping and `relay-failures` (a standard queue, SQS managed encryption), and the sweep on its schedule, each granted only what §10 lists. With `relayEnabled` false there is no relay and no mapping. The commands queue is a property, since WE5 builds it; WE8's `WritePath` holds the synth guard on `relayEnabled`. Spec 03 §10's layout names no file for this; the pieces are WE3's work and `WritePath` is WE8's.
- `journal-store.ts` gained `readOperationImage`, which checks a stream image as any read is checked and touches no table. Spec 03 §4.4 lists five exports; this is a sixth, kept in the store so the item schema stays in one place.
- Correction to WE1: the journal store stated `schemaVersion` 1 as its own literal, though `contractVersions.journalSchemaVersion` already states it (datum 0.7). It now takes the contract's.
- The journal store test now takes `newOperation` from the shared write path fixtures, with the same values; none of its assertions changed.

### Tests first

`enqueue-operation.test.ts`, `relay-handler.test.ts`, `sweep-handler.test.ts`, `command-relay-construct.test.ts`, `write-function-configuration.test.ts` and `write-path-observability.test.ts` failed with `Cannot find module`, and `write-bundles.test.ts` with `Build failed`, before their source existed.

Check 3 flagged `3_600`, the relay's maximum record age, as the contract's `Retry-After` bound restated. It is an hour of record age, not that bound, so it carries the exemption marker with that reason rather than a rewrite that would hide it from the check.

| Planted regression | Result |
|---|---|
| message group without the tenant | 2 tests failed |
| deduplicated by record instead of operation | 4 failed |
| an extra field in the message body | 1 failed |
| origin always `relay` | 2 failed |
| a stale transition thrown | 1 failed |
| any removal counted as an expiry | 1 failed |
| later records sent after a failure | 1 failed |
| only the failing record reported | 1 failed |
| a failed batch not counted | 1 failed |
| the stream image not checked | 1 failed |
| idempotency inserts treated as operations | 1 failed, once a test was added: no test had sent the relay an idempotency insert |
| the grace period ignored | 1 failed |
| state not checked before sending | 1 failed |
| recovery logged per operation | 1 failed |
| the batch limit not counted | 1 failed |
| the time limit ignored | 1 failed |
| the absent relay not logged | 1 failed |
| batches not split | 1 failed |
| the filter selecting changes, not inserts | 1 failed |
| the failure queue made FIFO | 1 failed, once replanted: the first plant gave the queue no `.fifo` name, so synth itself failed and no assertion was tested |
| the sweep allowed to scan | 1 failed |
| the relay allowed to read items | 1 failed |
| the relay built when disabled | 1 failed |
| the schedule every 5 minutes | 2 failed |
| the relay switch read loosely | 1 failed |
| the origin dimension misnamed | 1 failed |
| an AWS SDK import in `message-group.ts` | check 2 failed: `Pure module: no AWS SDK` |

Each planted file was restored byte for byte.

### Decision needed from the author

- **WQ6** The relay's stream mapping values. Blocks WE3's completion.
    - Why open: §5.1 requires bounded retries, batch splitting and an on failure destination, and WU7 confirms each exists, but neither §5.1 nor Appendix A gives a value for any of them.
    - Options, as built: batch size 10; 3 retries; a maximum record age of 1 hour; starting at `TRIM_HORIZON`; `relay-failures` kept 14 days. Otherwise, other values for any of them.
    - Trade offs: more retries and a longer age ride out a longer DynamoDB or SQS fault before a record goes to `relay-failures`, but hold the shard behind it longer; the sweep recovers any operation the relay gives up on, so a lost record delays a command by about the grace period and a schedule interval, and never loses it. `TRIM_HORIZON` reads every record still in the stream when the mapping is created, where `LATEST` would skip those. `relay-failures` holds batch metadata only, for a person to read; 14 days is SQS's maximum and matches `commands-dlq` (WU12).
    - Recommendation: the values as built.

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 58 files, 1,114 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

Done when: the suite passes. It does on the agent's machine; complete once WQ6 is answered and the author reproduces it.

### Answer, 18 October 2026

WQ6, in the author's words: "Accept WQ6 as built." Batch size 10, 3 retries, a maximum record age of 1 hour, `TRIM_HORIZON`, and `relay-failures` kept 14 days. WE3 now awaits the author's reproduction only.

## WE4 Write adapters

Phase worked on 18 October 2026, after rereading datum Part 0 and 0.17. Automated criteria met on the agent's machine; awaiting the author's reproduction. One question for WE5 is raised below (WQ7).

### Assumptions verified

- Spec 00 CU7: an aborted `fetch` rejects, while connecting or while the body arrives; both are mapped here, and run in the tests below.
- WQ3: answered; 401, 428 and any other status §6.5 does not list map to `retryable`.
- Read for this phase: the provider simulation's write path (`packages/test-doubles/src/provider-simulation.ts`): 412 for a stale `If-Match`, 428 without one, 400 for a malformed one or an invalid payload, 404 for a record or section not held, 422 for a reused key, 429 with `Retry-After: 2` once per key for `throttle-`, 503 for the first two attempts per key for `flaky-`, 500 for `poison-`, 412 for `conflict-`, and 200 or 201 with `ETag` and `Demo-Provider-Contract` on success. A 412 carries no `ETag`, so a conflict from the doubles has no `currentVersion`.

### Spec 00 change: the provider transport

`packages/construct-contracts/src/runtime/provider-transport.ts`, on the runtime subpath: `readResponseBodyWithinBound` and `discardResponseBody` (datum 0.10), `createCachedApiKeyReader` (Spec 00 §2.3) and `parseProviderEndpoint` (§2.3, CQ6). The read adapter (RE2) holds private copies of the same four pieces, and Spec 03 may not import Spec 02, so the shared form lives with Spec 00, which owns the rules. Its tests (`provider-transport.test.ts`) failed with `readResponseBodyWithinBound is not a function` before it existed. Switching the read adapter to it is Spec 02's to do (Findings).

### Work completed

- `adapters/http-write-adapter.ts`: `createHttpWriteAdapter`.
  - A replace is `PUT /records/{recordId}/sections/{section}` and an append `POST /records/{recordId}/sections/notes/entries`, each with the §4.4 body, `If-Match` (the quoted `baseVersion`), `Idempotency-Key`, `X-Api-Key`, `Demo-Tenant-Id` (CQ7.1, which §6.5's list predates) and `X-Correlation-Id`.
  - 200 or 201 is `applied` only after the contract version, the `ETag`, the bounded body and its `recordId` and `section` all check; any failure is `retryable` with its reason category.
  - 409 and 412 are `conflict`, with `currentVersion` from a valid `ETag`. 400, 404 and 422 are `rejected`, with codes `provider-request-invalid`, `provider-not-held` and `provider-idempotency-key-reused`.
  - 429, 503 and other 5xx are `retryable` with a valid `Retry-After`; one beyond the bound or malformed is ignored and counted. 401, 428 and any other status are `retryable` (WQ3). A failed key read is `retryable` as `api-key-unavailable`, and sends nothing. A network failure is `transport`, and an abort is `aborted`.
  - The adapter never throws: the worker acts on outcomes alone.
- `adapters/provider-a-write-adapter.ts`, `-b-`, `-c-`: each names only its provider, base URL variable and secret. `adapters/write-adapters.ts` builds all three from the environment, in routing table order.
- One metric beyond §11: `ProviderRetryAfterIgnored`, by `providerId`, through `WriteAdapterMetrics`. §11 counts outcomes by reason at the worker, but an ignored header leaves no outcome reason, and WE4 requires it counted.

### Tests first

`http-write-adapter.test.ts` and `provider-write-adapters.test.ts` failed with `Cannot find module` before their source existed. The rows run against the msw doubles where a double gives the answer (every fault prefix the doubles define for writes, stale versions, records and sections not held, invalid payloads, reused keys and a wrong key), and against a stub transport for 409, 428, 418, 204, 302, an out of bound `Retry-After`, a network failure, aborts, and each untrusted 2xx.

The `api-key-unavailable` reason was written into the adapter before its test. Its test was then added, and the plant that folds it back into `transport` fails it.

| Planted regression | Result |
|---|---|
| `If-Match` unquoted | 8 tests failed |
| `Idempotency-Key` not sent | 8 failed |
| the tenant not sent | 10 failed |
| the correlation identifier not sent | 1 failed |
| an append to the wrong path | 1 failed |
| 409 not a conflict | 3 failed |
| 404 not rejected | 1 failed |
| 422 not rejected | 1 failed |
| 401 rejected rather than kept | 1 failed |
| an ignored `Retry-After` not counted | 1 failed |
| `Retry-After` in seconds, not milliseconds | 1 failed |
| the contract version unchecked | 2 failed |
| the streamed bound doubled | 1 failed, once a test was added: the contract's body parser bounds the text again, so the outcome alone could not show it; the new test counts the bytes the adapter pulls from a body ten times the bound |
| an answer about another record trusted | 1 failed |
| an abort thrown rather than retryable | 1 failed |
| a key read failure folded into `transport` | 1 failed |
| a failed key read kept | 1 failed |
| a declared length over the bound not checked | 1 failed |
| any http endpoint allowed | 2 failed |

Each planted file was restored byte for byte.

### Decision needed from the author

- **WQ7** Which `Idempotency-Key` the worker sends a provider. Blocks WE5.
    - Why open: §6.3 step 5 sets it to `operationId`, a ULID of 26 characters. The provider wire, frozen with the contract at 1.0.0, holds `Idempotency-Key` to the §3.3 grammar, a version 4 UUID, and the doubles answer anything else 400. Followed as written, every command would end `FAILED` as `provider-request-invalid`. WE4's adapter sends whatever key it is given, so the choice is the worker's.
    - Options: (a) send the client's own `Idempotency-Key`, which the operation already stores, a version 4 UUID; (b) raise the contract to 1.1.0 so a provider also accepts a ULID; (c) derive a UUID shaped key from `operationId`.
    - Trade offs: (a) changes no contract. Providers key by tenant and key (CQ7.4), and intake allows one operation per tenant and key, so the client's key names exactly one operation, as `operationId` does, and stays the same across retries and redrives. It departs from §6.3's wording, to be recorded as a deviation. (b) keeps §6.3's wording, but reopens the frozen contract and changes the doubles and every provider's grammar. (c) keeps both documents, but adds a mapping whose only purpose is to hide the difference.
    - Recommendation: (a).

### Reproduction report

| Check | Result after a clean `npm ci` |
|---|---|
| Platform, Node.js | Windows 11 Home 10.0.26200, v22.23.2 |
| The seven tree checks | all exit 0 |
| Full suite | 61 files, 1,161 tests passed, at 100 and at 1,000 property runs |
| `cdk synth` | all four stacks |
| Tests skipped | none |

Done when: the suite passes. It does on the agent's machine; complete once the author reproduces it.

### Findings

| For | Finding | Likely fix |
|---|---|---|
| Spec 02 RE2 | `http-read-adapter.ts` holds private copies of the bounded body read, body discard, cached key reader and endpoint schema that `@demo/construct-contracts/runtime` now provides | import them from the runtime subpath; RE2's suite is the test |
| Spec 03 §11 | `ProviderRetryAfterIgnored` is a metric §11 does not list | add it to §11's table at the next revision |
