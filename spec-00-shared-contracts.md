# Spec 00: Demo platform shared contracts

Specification family: demo platform. Draft 2, dated 18 October 2026.

## Applying the datum

This family applies `ENGINEERING_DATUM.md` version 2, dated 20 September 2026, by reference. The family is four specifications: Spec 00 (this one), Spec 01 entry point, Spec 02 read path and Spec 03 write path. This section is the family's single statement of how it applies the datum. Specs 01 to 03 reference it.

Optional modules:

- Module A, memory unsafe languages: not applied. Every component is TypeScript on Node.js, which is memory safe.
- Module B, a repository holding several products: not applied, pending CD2.

What the subject requires beyond the datum:

- a cloud deployment target, so a deployment changes state outside the process (CD3)
- an asynchronous write path that durably queues commands and applies them after a provider outage, which departs from datum 0.17 item 10 (Spec 03 WD1)
- three build streams working in parallel against one provisional contract, owned here (§3, §4)

Identifiers, one prefix pair per document:

| Document | Phases | Decisions | Unverified values |
|---|---|---|---|
| Spec 00 shared contracts | CE | CD | CU |
| Spec 01 entry point | EE | ED | EU |
| Spec 02 read path | RE | RD | RU |
| Spec 03 write path | WE | WD | WU |

## What this specification is not

This statement covers the whole family.

The agent wrote the family on 18 October 2026. It worked from an architecture diagram supplied by the author, and from general knowledge with a cut off of June 2026.

Read when writing: the author's diagram; `ENGINEERING_DATUM.md` version 2.

Not read when writing:

- the documentation for AWS API Gateway HTTP APIs, Lambda, DynamoDB, DynamoDB Streams, SQS, Cognito, Secrets Manager, EventBridge Scheduler or CloudWatch
- the sources or release notes of AWS CDK v2, Powertools for AWS Lambda (TypeScript), zod, msw, vitest, fast-check or undici
- the reference implementations the datum names
- any AWS account

Every service limit, construct name, API name, package name and default in the family is a Plan stage question. The values the build depends on are listed in each specification's Appendix A.

## 1. Scope and ownership

The demo platform exposes one public HTTP API over a set of upstream provider systems. Reads aggregate live data from several providers. Writes are accepted durably, then applied to the owning provider asynchronously.

Providers are the source of truth and own the meaning of every record (datum 0.12). The platform reports and relays.

**MUST NOT** hold authoritative record state anywhere in the platform. The optional read cache in Spec 02 holds marked copies, never the record of truth.

| Specification | Owns | Depends on |
|---|---|---|
| Spec 00 shared contracts | `packages/contracts`, `packages/construct-contracts`, `packages/test-doubles`, the mock providers, the tree wide checks, `infra/bin/app.ts`, the required documents | nothing |
| Spec 01 entry point | the HTTP API, authoriser, demo identity provider, routing, throttling, access logs | Spec 00 |
| Spec 02 read path | the read handler, read adapters, merge, aggregate ETag, optional read cache | Spec 00 |
| Spec 03 write path | intake, command journal, relay, sweep, queue, worker, write adapters, operator tooling, status handler | Spec 00 |

Specs 01, 02 and 03 depend on Spec 00 alone. None depends on another's code.

Out of scope for the whole family: client applications, client local storage and client synchronisation, real provider integrations, and production data governance. The demo talks only to the mock providers in §4.3.

## 2. Repository, toolchain and conventions

### 2.1 Toolchain

**GUIDANCE** Use the baseline below. Each entry is a candidate until the Plan stage records its exact version read from source.

| Concern | Candidate |
|---|---|
| Runtime | Node.js 22 LTS on Lambda, arm64 (CU1) |
| Language | TypeScript 5, `strict` on, ESM modules |
| Bundling | CDK `NodejsFunction` with esbuild, source maps on (CU2) |
| AWS SDK | v3 modular clients only |
| HTTP client | the runtime's built in `fetch` with `AbortSignal` (CU7) |
| Validation | zod, strict object schemas |
| Observability | Powertools for AWS Lambda (TypeScript): Logger, Tracer, Metrics (CU5) |
| Tests | vitest, `aws-sdk-client-mock`, msw, fast-check (CU6) |
| Infrastructure | AWS CDK v2 in TypeScript, one stack per stage |
| Lint and format | ESLint with typescript-eslint, Prettier |

**MUST** keep each package's datum 0.13 record in `docs/evaluation/ACTUAL_CONTRACT_EVALUATION.md`.

### 2.2 Repository layout

**MUST** use one repository with npm workspaces, laid out as follows:

```text
demo-platform/
  packages/
    contracts/              Spec 00: schemas, types, bounds, headers, errors, routing table, authentication context; pure
    construct-contracts/    Spec 00: construct property interfaces, stub constructs
    test-doubles/           Spec 00: msw provider doubles, synthetic fixtures, Lambda event builder
  services/
    entry/                  Spec 01: DemoApi construct and the identity provider trigger
    read/                   Spec 02
    write/                  Spec 03
    mock-providers/         Spec 00 §4.3
  infra/
    bin/app.ts              Spec 00: wires every construct per stage
    test/                   one file per stream for its deployed checks
  docs/evaluation/          the Plan stage record
```

**MUST** keep each stream's changes inside its own directory under `services/`, and in its own file under `infra/test/`.

**MUST NOT** change anything under `packages/`, or `infra/bin/app.ts`, outside a Spec 00 phase. A stream that needs a change there raises it as a Spec 00 change (§3).

### 2.3 Naming and configuration

**MUST** name every AWS resource by joining these parts with single hyphens:

| Part | Value |
|---|---|
| prefix | `demo` |
| stage | one of `dev`, `stub`, `test`, `demo` |
| component | lower case words joined by hyphens, named in the owning specification |

For example, `demo-dev-command-journal`.

| Stage | Handlers | Used by |
|---|---|---|
| `dev` | real | RE6, WE9, EE5 |
| `stub` | Spec 00 stubs | EE4 |
| `test` | real, relay disabled | WE9 sweep check |
| `demo` | real | showing the demo |

**MUST** read runtime configuration only from environment variables, each validated at cold start by a strict zod schema in its service. A missing required variable **MUST** fail the cold start.

**MUST NOT** put a secret in an environment variable.

**MUST** keep provider credentials in Secrets Manager, named `demo/` stage `/providers/` providerId (CU8), and **MUST** read each once per execution environment.

**MUST** write timestamps as ISO 8601 UTC strings with milliseconds, durations in milliseconds and time to live values in seconds.

**MUST** mint every platform identifier as a ULID.

Code excerpts in this family are part of the contract only where §3 or §4 says so. Elsewhere they show shape.

### 2.4 Tree wide checks

**MUST** run each of these in continuous integration on every pull request, each proven under datum 0.4:

1. The prose and typography scan (datum 0.8). Nothing is vendored, so its exclusion list is empty.
2. A pure module import check. A module any specification lists as pure **MUST NOT** import `@aws-sdk/*`, `aws-cdk-lib`, `@aws-lambda-powertools/*`, `node:fs`, `node:net`, `node:http` or `node:child_process` (datum 0.10).
3. A single definition check. No type, schema, bound, header name, error code or routing entry from §3 or §4 is declared outside `packages/contracts`. The mechanism is a Plan stage choice.
4. Typecheck with `strict`, and ESLint with warnings as errors.
5. The full test suite of every workspace.
6. A short fuzz run of every parser in the family: the command body, the provider response body and headers, the aggregate ETag, the queue message body and the correlation identifier. It uses fast-check arbitrary input generation (CU6).
7. `cdk synth` for every stage.

**MUST** record in `IMPLEMENTATION_DEVIATIONS.md` that check 6 is property based random generation, not coverage guided fuzzing, with the author's decision.

**MUST** record in `TESTING.md` what, if anything, the pinned Node.js toolchain offers for datum 0.10 memory and undefined behaviour analysis.

### 2.5 Required documents

One repository holds one product, so datum Part 2 applies once, at the root:

| Document | Applies | Note |
|---|---|---|
| `README.md` | yes | |
| `TESTING.md` | yes | lists every author gate in the family |
| `IMPLEMENTATION_DEVIATIONS.md` | yes | starts with §2.4 check 6, Spec 01 ED3 and Spec 03 WD1 if accepted |
| `CHANGELOG.md` | yes | |
| `LICENSE` | yes | per CD4 |
| `docs/evaluation/ACTUAL_CONTRACT_EVALUATION.md` | yes | **GUIDANCE** one top level section per specification, so the four Plan stages write in parallel without colliding |
| `packages/contracts/CONTRACT.md` | yes | the contract document, holding the provisional change record (§3) |
| `SECURITY.md` | yes | trust boundaries: the public API and provider responses |
| `PRIVACY.md` | yes | the token `sub` claim is personal data; CD5 settles whether it is ever logged |
| `HARDWARE_COMPATIBILITY.md` | no | no hardware gates |
| `FIELD_NOTES.md` | no | no real world use |
| `PROVENANCE.md` | no | nothing is imported or vendored |

## 3. Shared contracts

`packages/contracts` is the single owner of every definition in §3 and §4 (datum 0.12). Services import it by workspace and hold no copy.

The contract is provisional until CD1 freezes it (datum 0.11). Its change record lives in `packages/contracts/CONTRACT.md`.

**MUST** define every type in §3 and §4 as a strict zod schema with the TypeScript type inferred from it.

### 3.1 Versions

**MUST** check a version on every input that crosses a boundary:

| Input | Version carrier | Value | On mismatch |
|---|---|---|---|
| public API request | path prefix | `/v1` | gateway 404 (Spec 01 §2.2) |
| provider response | header `Demo-Provider-Contract` | `1` | adapter result `error`, reason `version-mismatch` |
| queue message body | field `messageVersion` | `1` | worker rejects (Spec 03 §6.3) |
| journal item | attribute `schemaVersion` | `1` | reader rejects (Spec 03 §4.1) |

**MUST** count every version mismatch.

### 3.2 Routes

**MUST** expose exactly these three routes:

| Method | Path | Handler | Success | Required scope |
|---|---|---|---|---|
| GET | `/v1/records/{recordId}` | Spec 02 read handler | 200 or 304 | `records:read` |
| POST | `/v1/commands` | Spec 03 command handler | 202 | `records:write` |
| GET | `/v1/operations/{operationId}` | Spec 03 status handler | 200 | per Spec 03 WD4 |

**MUST NOT** inspect bodies in the gateway. Each handler owns validation and authorisation for its own route.

### 3.3 Bounds and grammars

This table is the only statement of these bounds. Every service **MUST** import them from `packages/contracts`, and **MUST** check each before the input is copied, decoded or parsed. The maximums are CU10.

| Input | Grammar | Maximum | Checked by |
|---|---|---|---|
| raw request body, `POST /v1/commands`, as received | | 65,536 bytes | Spec 03 intake |
| provider response body | | 262,144 bytes | Spec 02 and Spec 03 adapters |
| `recordId` | `[A-Za-z0-9_-]`, at least 1 | 128 characters | every handler |
| `tenantId` claim | `[A-Za-z0-9_-]`, at least 1 | 64 characters | `readAuthenticationContext` |
| `scope` claim | space separated scope names | 1,024 characters | `readAuthenticationContext` |
| `operationId` | ULID | 26 characters | Spec 03 status |
| `X-Correlation-Id` | ULID or UUID | 64 characters | every handler |
| `Idempotency-Key` | UUID version 4 | 36 characters | Spec 03 intake |
| `If-None-Match` | Spec 02 §4.2 | 1,024 characters | Spec 02 |
| provider version, as `ETag` value and as `baseVersion` | `[A-Za-z0-9._-]`, at least 1, quoted on the wire | 128 characters | adapters, Spec 03 intake |
| provider `Retry-After` | whole seconds | 3,600 | Spec 03 adapters |
| provider `Cache-Control` `max-age` | whole seconds | 86,400 | Spec 02 adapters |
| queue message body | | 256 bytes | Spec 03 worker |

### 3.4 Headers

`packages/contracts` **MUST** export every header name below as a constant, and the gateway's CORS lists **MUST** be derived from them.

| Header | Direction | Rule |
|---|---|---|
| `Authorization` | request | **MUST** be verified by the gateway (Spec 01). Handlers **MUST NOT** verify it again. |
| `Content-Type` | request | **MUST** be `application/json` on `POST /v1/commands`; otherwise 400. |
| `X-Correlation-Id` | both | Optional on request; **MUST** be refused with 400 if present and outside §3.3. If absent, the handler **MUST** mint a ULID. **MUST** be echoed on every response. |
| `Idempotency-Key` | request | **MUST** be present and within §3.3 on `POST /v1/commands`; otherwise 400 `idempotency-key-required`. |
| `If-None-Match` | request | Optional on the read route. |
| `ETag` | response | Read route only, per Spec 02 §4.2. |
| `Location` | response | **MUST** be set on 202 from the command route, naming the operation's status path. |
| `Idempotent-Replayed` | response | **MUST** be `true` on a replayed command (Spec 03 §3.2), and absent otherwise. |
| `Retry-After` | response | Whole seconds, where Specs 02 and 03 say. |
| `Cache-Control` | response | Read route per Spec 02 §5. Command and status routes **MUST** send `no-store`. |
| `Vary` | response | Read route per Spec 02 §5. |

### 3.5 Authentication context

The gateway passes verified claims to handlers (CU3, CU4). Every handler **MUST** obtain them through this module, and **MUST NOT** read claims directly:

```ts
// packages/contracts/src/authentication-context.ts
export interface AuthenticationContext {
  subject: string;          // the sub claim; personal data, see CD5
  tenantId: string;         // the tenant_id claim
  scopes: readonly string[];
}

export function readAuthenticationContext(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): AuthenticationContext; // throws DemoError unauthorised on a missing or out of bound claim

export function requireScope(
  authenticationContext: AuthenticationContext,
  requiredScope: 'records:read' | 'records:write',
): void; // throws DemoError forbidden
```

**MUST** key or filter every record lookup, journal item and operation by `tenantId`.

**MUST** answer a request for another tenant's resource with 404, never 403.

### 3.6 Errors

**MUST** answer every non 2xx response from a handler with an RFC 9457 problem document, `Content-Type: application/problem+json`:

```ts
export interface ProblemDocument {
  type: string;            // https://errors.demo.local/ followed by the error code
  title: string;
  status: number;
  detail?: string;
  correlationId: string;
  invalidFields?: readonly { path: string; reason: string }[];
}
```

**MUST NOT** put an input value in `detail` or `invalidFields`. They name the field and the reason.

| Error code | Status | Raised by |
|---|---|---|
| `validation-failed` | 400 | any handler |
| `idempotency-key-required` | 400 | Spec 03 intake |
| `unauthorised` | 401 | gateway (Spec 01 ED3); `readAuthenticationContext` |
| `forbidden` | 403 | `requireScope` |
| `not-found` | 404 | any handler |
| `idempotency-key-reused` | 422 | Spec 03 intake |
| `throttled` | 429 | gateway (Spec 01) |
| `internal` | 500 | any handler |
| `not-implemented` | 501 | the stub functions only (CE5) |
| `all-sources-unavailable` | 503 | Spec 02 |

`packages/contracts` **MUST** export `DemoError`, carrying the error code, and `withHttpProblemHandling`, which every handler **MUST** use. The wrapper **MUST**:

- resolve the correlation identifier and bind it to the logger
- map a thrown `DemoError` to its problem document, and anything else to `internal`
- emit the metric `RequestRejected` with dimension `errorCode` for every 4xx
- log the error code and reason category, and no input value

### 3.7 Sections

The section shapes below are illustrative pending CD6. Whatever CD6 settles **MUST** live in this table and nowhere else. Spec 02 validates provider responses with it, and Spec 03 validates command payloads with it.

| Section | Shape | Bounds (CU10) |
|---|---|---|
| `summary` | `title` string; `status` one of `active`, `paused`, `closed` | title 1 to 200 characters |
| `tasks` | `entries`: list of `taskId` string, `label` string, `done` boolean | up to 50 entries; taskId 1 to 64; label 1 to 200 |
| `schedule` | `entries`: list of `startsAt` and `endsAt` timestamps, `label` string | up to 50 entries; label 1 to 200 |
| `notes` | `entries`: list of `noteId` ULID, `writtenAt` timestamp, `text` string | up to 100 entries; text 1 to 1,000 |
| `preferences` | `contactWindow` one of `morning`, `afternoon`, `evening`; `language` BCP 47 tag | language 2 to 35 characters |

| Exported name | Definition |
|---|---|
| `SectionName` | the five section names above |
| `SectionsBySectionName` | each section name mapped to its shape |
| `ReplaceableSectionName` | `summary`, `tasks`, `schedule`, `preferences` |
| `NotesAppendPayload` | `text` string, 1 to 1,000 characters |

**MUST** use only synthetic values in fixtures and seed records.

### 3.8 Read response

```ts
export type ProviderOutcomeStatus =
  'ok' | 'not-modified' | 'timeout' | 'error' | 'not-found';

export type ProviderErrorReason =
  'transport' | 'http-status' | 'version-mismatch' | 'body-too-large' | 'header-invalid' | 'schema-invalid';

export interface SourceProvenance {
  providerId: string;
  status: ProviderOutcomeStatus;
  errorReason?: ProviderErrorReason;   // present only when status is error
  version?: string;                    // provider version, when ok or not-modified
  fetchedAt: string;
  ttlSeconds: number;
  latencyMilliseconds: number;
}

export interface DemoRecord {
  recordId: string;
  sections: Partial<SectionsBySectionName>;
  sectionSources: Partial<Record<SectionName, string>>;
  updatedAt: string;
}

export interface ReadResponse {
  record: DemoRecord;
  partial: boolean;
  sources: readonly SourceProvenance[];
  servedFrom: 'live' | 'server-cache';
}
```

### 3.9 Command

```ts
export type CommandRequest =
  | { type: 'record.section.replace'; recordId: string; section: ReplaceableSectionName;
      baseVersion: string; payload: SectionsBySectionName[ReplaceableSectionName] }
  | { type: 'record.notes.append'; recordId: string; section: 'notes';
      baseVersion: string; payload: NotesAppendPayload };
```

**MUST** validate `payload` against the shape for its `section` (§3.7), and against `NotesAppendPayload` for an append.

**MUST** resolve the owning provider from `section` through the routing table in §4.2. One command touches exactly one provider.

**MUST** take `baseVersion` from the `version` the client last read in `SourceProvenance`.

### 3.10 Operation status

```ts
export type OperationState =
  'ACCEPTED' | 'QUEUED' | 'APPLYING' | 'SUCCEEDED' | 'CONFLICT' | 'FAILED' | 'DEAD_LETTERED';

export interface OperationStatus {
  operationId: string;
  state: OperationState;
  recordId: string;
  providerId: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  result?: { providerVersion: string };                     // SUCCEEDED
  conflict?: { currentVersion?: string; reason: string };   // CONFLICT
  failure?: { code: string; reason: string };               // FAILED or DEAD_LETTERED
}
```

| Kind | States | Meaning to a client |
|---|---|---|
| in progress | `ACCEPTED`, `QUEUED`, `APPLYING` | keep polling |
| awaiting operator | `DEAD_LETTERED` | keep polling, more slowly; an operator will redrive or discard it |
| terminal | `SUCCEEDED`, `CONFLICT`, `FAILED` | stop polling; the state never changes again |

Spec 03 §7 owns the transitions.

**MUST NOT** retry, merge or resolve a `CONFLICT` anywhere in the platform. The provider owns the meaning, so the provider's answer stands.

### 3.11 Handlers and constructs

**MUST** use API Gateway HTTP API payload format 2.0 for all three handlers, with this signature (CU3):

```ts
export type DemoHttpHandler = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  lambdaContext: Context,
) => Promise<APIGatewayProxyStructuredResultV2>;
```

`packages/construct-contracts` **MUST** export the interfaces below. Each stream's construct implements its interface, and `infra/bin/app.ts` wires them through these interfaces alone.

```ts
// packages/construct-contracts/src/construct-properties.ts
export type DemoStage = 'dev' | 'stub' | 'test' | 'demo';

export interface ProviderConnection {
  providerId: string;
  baseUrl: string;
  secretArn: string;
}

export interface ReadPathProperties {
  stage: DemoStage;
  providers: readonly ProviderConnection[];
  alarmTopic: sns.ITopic;
  readCache?: { enabled: boolean; approvalReference?: string };     // Spec 02 §6
}
export interface ReadPathOutputs {
  readonly readHandler: lambda.IFunction;
}

export interface WritePathProperties {
  stage: DemoStage;
  providers: readonly ProviderConnection[];
  alarmTopic: sns.ITopic;
  relayEnabled: boolean;                                            // false only in test
}
export interface WritePathOutputs {
  readonly commandHandler: lambda.IFunction;
  readonly statusHandler: lambda.IFunction;
}

export interface DemoApiProperties {
  stage: DemoStage;
  readHandler: lambda.IFunction;
  commandHandler: lambda.IFunction;
  statusHandler: lambda.IFunction;
  identityProvider:
    | { kind: 'demo-user-pool' }
    | { kind: 'external'; issuerUrl: string; audiences: readonly string[] };  // Spec 01 ED1
  corsAllowedOrigins: readonly string[];
  alarmTopic: sns.ITopic;
  customDomain?: { domainName: string; certificateArn: string };
}
export interface DemoApiOutputs {
  readonly baseUrl: string;
}
```

Tuning values such as timeouts, memory and throttles are not part of these interfaces. Each stream keeps its own as constants inside its construct.

## 4. Provider adapters and mock providers

### 4.1 Adapter interfaces

```ts
export interface ProviderReadResult {
  outcome: 'ok' | 'not-modified' | 'not-found' | 'error';
  errorReason?: ProviderErrorReason;
  version?: string;
  updatedAt?: string;
  ttlSeconds: number;
  sections?: Partial<SectionsBySectionName>;
}

export interface ReadAdapter {            // implemented in Spec 02
  readonly providerId: string;
  read(
    readRequest: { tenantId: string; recordId: string; ifNoneMatchVersion?: string },
    callOptions: { abortSignal: AbortSignal; correlationId: string },
  ): Promise<ProviderReadResult>;
}

export type ApplyOutcome =
  | { kind: 'applied'; providerVersion: string }
  | { kind: 'conflict'; currentVersion?: string; reason: string }
  | { kind: 'rejected'; code: string; reason: string }
  | { kind: 'retryable'; retryAfterMilliseconds?: number; reason: string };

export interface WriteAdapter {           // implemented in Spec 03
  readonly providerId: string;
  apply(
    applyRequest: { tenantId: string; command: CommandRequest; idempotencyKey: string },
    callOptions: { abortSignal: AbortSignal; correlationId: string },
  ): Promise<ApplyOutcome>;
}
```

**MUST** map every HTTP response to a result. An adapter **MUST NOT** throw for a response.

**MUST** treat every provider response as untrusted: bound its body and headers by §3.3, check its version by §3.1, and validate it with the §4.4 schemas.

### 4.2 Routing table

This table is the single source for read fan-out and write routing:

| Section | Owning provider | Readable | Write command type |
|---|---|---|---|
| `summary` | `provider-a` | yes | `record.section.replace` |
| `tasks` | `provider-a` | yes | `record.section.replace` |
| `schedule` | `provider-b` | yes | `record.section.replace` |
| `notes` | `provider-b` | yes | `record.notes.append` only |
| `preferences` | `provider-c` | yes | `record.section.replace` |

Each section has exactly one owning provider, so a read merge never chooses between competing values.

### 4.3 Mock providers

The mock providers are the double for every provider. There is one Lambda per provider behind its own HTTP API, authenticated by `X-Api-Key` from Secrets Manager. All three share one DynamoDB table, component `mock-provider-store`, with `partitionKey` made of providerId, tenantId and recordId joined by `#`, and `sortKey` the section name.

Each mock provider **MUST** behave as follows:

| Endpoint | Behaviour |
|---|---|
| `GET /records/{recordId}` | 200 with the §4.4 read body, and headers `ETag`, `Cache-Control: max-age=` CU11, `Demo-Provider-Contract: 1`. 304 when `If-None-Match` matches. 404 when this provider holds no section of the record. |
| `PUT /records/{recordId}/sections/{section}` | Requires `If-Match` and `Idempotency-Key`. 412 if `If-Match` is stale. Within CU11's replay window, a repeated key replays the stored response. Otherwise 200 with the §4.4 write body and the new `ETag`. |
| `POST /records/{recordId}/sections/notes/entries` | The append variant, with the same rules. |

**MUST** compute a mock provider's version as a hexadecimal prefix of the SHA-256 of the record's sections in canonical form, prefix length CU11.

Each mock provider **MUST** apply this fault injection by record identifier prefix, so every stream's tests are deterministic and share no toggles:

| Prefix | Effect |
|---|---|
| `slow-a-`, `slow-b-`, `slow-c-` | the named provider waits CU9 before responding |
| `down-a-`, `down-b-`, `down-c-` | the named provider returns 503 |
| `flaky-` | every provider returns 503 on the first two attempts per idempotency key, then succeeds |
| `throttle-` | writes return 429 with `Retry-After` of CU11, once per key |
| `poison-` | writes always return 500 |
| `conflict-` | writes always return 412 |
| `oldversion-` | reads omit `Demo-Provider-Contract` |
| `oversize-` | reads return a body larger than the §3.3 provider bound |
| `badheader-` | reads return a `Cache-Control` `max-age` beyond §3.3 |

**MUST** seed each stage with its own script, for example `npm run seed:dev --workspace services/mock-providers`. Seeding writes CU11 synthetic records for each of `tenant-1` and `tenant-2`, including one per fault prefix. It **MUST** write by key and delete nothing, so a rerun after a partial failure converges on the same store (datum 0.14).

`packages/test-doubles` **MUST** provide:

- msw handlers with the same behaviour, generated from the same tables as the deployed mocks, so Specs 02 and 03 can test before CE4 is deployed
- a builder for payload format 2.0 events with verified claims, used by Specs 02 and 03 to invoke their handlers directly

### 4.4 Provider wire schemas

These are the bodies on the wire between adapters and providers. Each **MUST** be a strict schema in `packages/contracts`.

| Message | Body |
|---|---|
| read response, 200 | `recordId`; `updatedAt` timestamp; `sections`, the provider's own sections, each matching §3.7 |
| replace request | the section's shape from §3.7 |
| append request | `NotesAppendPayload` |
| write response, 200 or 201 | `recordId`; `section`; `updatedAt` timestamp |
| any 4xx or 5xx | ignored; the status alone decides the outcome |

The provider's version travels only in `ETag` and `If-Match`, never in a body.

## 5. Observability, deployment and delivery

### 5.1 Observability

**MUST** emit structured logs, traces and metrics through Powertools in every Lambda.

**MUST** include `correlationId`, `tenantId`, `service`, and `route` or `component` on every log line, and `operationId` once known.

**MUST NOT** log a section, a command payload, a token or the `sub` claim, unless CD5 decides otherwise for `sub`.

**MUST** log at cold start every optional subsystem that is absent in that stage: the read cache (Spec 02 §6) and the relay (Spec 03 §5.1).

**MUST** publish metrics under namespace `Demo/` stage, with dimension `service`.

**MUST** send every alarm in the family to one SNS topic, component `alarms`, created in `infra/`.

### 5.2 Deployment

**MUST** deploy from one CDK app with one stack per stage: `DemoPlatform-dev`, `DemoPlatform-stub`, `DemoPlatform-test`, `DemoPlatform-demo`. Who deploys is CD3.

### 5.3 Phase completion

Every phase in the family is complete only as datum Stages two and three define. Each Done when gives the phase's own criteria.

### 5.4 Testing across specifications

Datum 0.17 item 18 applies to the family as follows:

- Spec 01 is tested against the stub functions, in the `stub` stage.
- Specs 02 and 03 invoke their own handlers directly, with events from `packages/test-doubles`, against msw or the deployed mock providers.
- Specs 02 and 03 **MUST NOT** call each other, or the gateway, in a test.
- One manual smoke check through the deployed API is an author gate, Spec 01 EE5.

### 5.5 Delivery order

| Phase | Needs first |
|---|---|
| Plan stage, each of the four specs | nothing; all four run in parallel |
| CE1 contract package | Spec 00 Plan stage |
| CE2 test doubles | CE1 |
| CE3 tree wide checks | CE1 |
| CE4 mock providers | CE1, CE2 |
| CE5 construct contracts and stubs | CE1 |
| EE1 to EE3 | CE5 |
| EE4 | EE1 to EE3, CE5, CD3 |
| RE1 to RE5 | CE1, CE2, CE5 |
| WE1, WE2, WE4, WE6, WE7 | CE1, CE2, CE5 |
| WE3, WE5 | as above, and WD1 |
| WE8 | WE1 to WE7 |
| CE6 wiring real constructs | RE5, WE8, EE3 |
| RE6, WE9 | CE4, CE6, CD3 |
| EE5 author smoke gate | EE4, RE6, WE9 |

Once CE1, CE2 and CE5 are done, Specs 01, 02 and 03 proceed in parallel until CE6.

## 6. Decisions

**CD1 DECIDE Contract freeze.**
- Blocked: when `packages/contracts` stops being provisional.
- Why open: the freeze is the author's decision by datum 0.11. The evidence for it is whether both consumers have run against it.
- Options: freeze after CE1; after RE4 and WE2 pass against the doubles; at first deployment.
- Trade offs: an early freeze turns every change the consumers find into a version decision. A late one lets three streams change a shared contract at once.
- Recommendation: freeze after RE4 and WE2 pass against the doubles. Neither waits on Spec 03 WD1.

**CD2 DECIDE Module B.**
- Blocked: whether datum Part 4 Module B applies.
- Why open: it turns on what counts as a product, which is the author's judgement.
- Options: not applied, one product; applied, with three products sharing `packages/`.
- Trade offs: applying it gives each service its own required documents and a `shared/` tree, which is heavy for one API. Not applying it means the services cannot ship separately.
- Recommendation: not applied. If the services are later shipped separately, revisit as a version decision.

**CD3 DECIDE Who deploys.**
- Blocked: EE4, RE6, WE9 and the seed scripts.
- Why open: a deployment changes state outside the process (datum 0.14), and the datum gives deployment to neither role.
- Options: the author deploys and runs every deployed check; the agent deploys to `dev` and `stub` with credentials scoped to them; the agent deploys every non `demo` stage.
- Trade offs: author deployment adds a hand off before every deployed check. Agent deployment needs scoped credentials and puts cloud cost in the agent's hands.
- Recommendation: the author deploys and runs every deployed check, so EE4, RE6 and WE9 are author gates. The agent runs `cdk synth` and every local suite.

**CD4 DECIDE Licence and holder.**
- Blocked: the content of `LICENSE`, needed by CE1.
- Why open: only the author can choose.
- Options: MIT with the author as holder; all rights reserved; another licence.
- Trade offs: MIT makes the demo easy to share and reuse. All rights reserved keeps control when it is shown to third parties.
- Recommendation: MIT with the author as holder, since the demo exists to be shown.

**CD5 DECIDE Logging the subject.**
- Blocked: whether `sub` may appear in any log, which CE1's wrapper and Spec 01's access log format implement.
- Why open: the fixtures are synthetic, but a deployed demo with real users carries real subject identifiers.
- Options: never log it; log a keyed hash of it; log it as it is.
- Trade offs: never logging it makes one caller's requests harder to trace. A keyed hash needs a key and its handling. Logging it as it is puts personal data in every log line.
- Recommendation: never log it, and say so in `PRIVACY.md`. `tenantId` names an organisation and is logged.

**CD6 DECIDE Section shapes.**
- Blocked: the final schemas in §3.7, needed by CE1.
- Why open: they are illustrative, and the demo's audience decides what a record should look like.
- Options: adopt §3.7 as written; supply other shapes.
- Trade offs: changing them after CE1 touches CE2, RE1 and WE2.
- Recommendation: adopt §3.7 as written for the demo.

## 7. Phases

The Plan stage for this specification **MUST** settle every CU value, and read the reference implementations, before CE1.

### CE1 Contract package

- **Work:** every schema, type, bound, grammar, header name, error code and routing entry in §3 and §4; `DemoError`; `withHttpProblemHandling`; `readAuthenticationContext`; `requireScope`; `CONTRACT.md` with its change record.
- **Excluded:** anything that calls AWS, since the package is pure; the doubles (CE2); the construct contracts (CE5).
- **Assumptions to verify:** CU3, CU4, CU10; zod strict object behaviour in the pinned version.
- **Tests first:** every schema refuses an unknown key, a missing required field and each bound plus one; every grammar refuses a near miss; every error code maps to its status; `readAuthenticationContext` refuses a missing or out of bound claim; `requireScope` refuses a missing scope; the wrapper never puts an input value in a problem document or a log line; a fuzz property per parser (§2.4 check 6).
- **Done when:** the package's suite passes, lint is clean, and the pure import check passes on it.

### CE2 Shared test doubles

- **Work:** the msw provider doubles generated from §4.3's tables; synthetic fixtures for both tenants; the payload format 2.0 event builder.
- **Excluded:** the deployed mock providers (CE4).
- **Assumptions to verify:** CU6.
- **Tests first:** every fault prefix produces its effect through the msw double; every double response passes the §4.4 schemas, except where a fault prefix requires otherwise; the event builder's output passes CE1's parsing; no fixture value lies outside the synthetic set.
- **Done when:** the suite passes.

### CE3 Tree wide checks

- **Work:** the seven checks in §2.4 as continuous integration jobs, and the deviation record for check 6.
- **Excluded:** any check that needs AWS credentials.
- **Assumptions to verify:** the continuous integration runner has nothing installed but the Node.js toolchain.
- **Tests first:** each check is shown failing on a planted violation: a dash in a Markdown file, an `@aws-sdk` import in a pure module, a redeclared bound, a lint warning, a failing test, a parser property that fails on generated input, a synth error.
- **Done when:** each check has a recorded failing run and a passing run.

### CE4 Mock providers

- **Work:** three mock provider Lambdas, their HTTP APIs, the store table, the seed script for each stage, and every fault prefix.
- **Excluded:** any behaviour not in §4.3 and §4.4.
- **Assumptions to verify:** CU8, CU9, CU11.
- **Tests first:** the handlers invoked directly with every row of the §4.3 tables, against `aws-sdk-client-mock`; the seed run twice gives the same store; a seed run interrupted part way, then run again, gives the same store.
- **Done when:** the local suite passes and the construct synthesises. Deploying and seeding follow CD3.

### CE5 Construct contracts and stubs

- **Work:** `packages/construct-contracts` with the §3.11 interfaces; stub constructs implementing `ReadPathOutputs` and `WritePathOutputs`; `infra/bin/app.ts` wiring `DemoApi`, the stubs and the alarm topic for every stage.
- **Excluded:** real handlers.
- **Assumptions to verify:** CU1, CU2.
- **Tests first:**
    - Synth assertions that each stage contains the topic and the constructs that §2.3 assigns it.
    - Each stub function, invoked with a CE2 event, returns a schema valid `not-implemented` problem document.
    - In the `stub` stage only, each stub function sets the response header `Demo-Stub-Echo`. It is a JSON object holding the request's `If-None-Match`, `Idempotency-Key` and `X-Correlation-Id` values, and no other header.
- **Done when:** `cdk synth` succeeds for every stage.

### CE6 Wiring real constructs

- **Work:** replace the stubs in `infra/bin/app.ts` with the real `ReadPath` from Spec 02 and `WritePath` from Spec 03, in every stage except `stub`.
- **Excluded:** any change inside `services/`.
- **Assumptions to verify:** RE5 and WE8 are done.
- **Tests first:** synth assertions that each route in `dev`, `test` and `demo` integrates with a function from the real constructs, and each route in `stub` with a stub.
- **Done when:** `cdk synth` succeeds for every stage.

## Appendix A: unverified values

Datum, How to read a specification, governs these.

| Identifier | Value assumed | Needed by | Settle by |
|---|---|---|---|
| CU1 | Lambda offers a Node.js 22 runtime as `nodejs22.x` on arm64 in the target region | CE5, every service | Lambda runtime documentation |
| CU2 | the CDK v2 construct names `NodejsFunction`, `HttpApi`, `HttpJwtAuthorizer`, `HttpLambdaIntegration` and their properties | CE5, Specs 01 to 03 | CDK API reference for the pinned version |
| CU3 | payload format 2.0 field paths `requestContext.authorizer.jwt.claims` and `isBase64Encoded`, and the type `APIGatewayProxyEventV2WithJWTAuthorizer` | CE1 | API Gateway documentation; `@types/aws-lambda` source |
| CU4 | how the `scope` claim reaches the handler: a space separated string, or an array rendered as a string | CE1 | API Gateway documentation, then an experiment on a throwaway stack |
| CU5 | Powertools package names and the Logger, Tracer and Metrics interfaces | every service | Powertools source and release notes |
| CU6 | vitest, msw and fast-check versions that support the pinned Node.js | CE2, CE3 | each package's release notes |
| CU7 | `AbortSignal.any` and `AbortSignal.timeout` are available in the pinned runtime and abort `fetch` | Specs 02 and 03 | Node.js documentation for the runtime's exact version |
| CU8 | Secrets Manager accepts the `/` separated name in §2.3 | CE4 | Secrets Manager documentation |
| CU9 | the slow fault waits 3,000 ms, longer than Spec 02's per provider timeout (RU1) | CE4 | settled with RU1 |
| CU10 | every maximum in §3.3 and every bound in §3.7 | CE1 | author decision |
| CU11 | mock `max-age` 60 seconds; replay window 24 hours; version prefix 16 hexadecimal characters; throttle `Retry-After` 2 seconds; 20 seed records per tenant | CE4 | author decision |
