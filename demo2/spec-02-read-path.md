# Spec 02: Demo read path

Specification family: demo platform. Draft 2, dated 18 October 2026.

## Applying the datum

This specification applies `ENGINEERING_DATUM.md` version 2, dated 20 September 2026, as Spec 00, Applying the datum, states for the family. Its identifiers and its statement of what it is not are there too.

What this subject requires beyond the datum and Spec 00: an optional server side cache of provider data, gated by a data governance decision (RD1).

## 1. Scope

Spec 02 delivers `GET /v1/records/{recordId}`. One function calls every provider in parallel, tolerates slow or failing providers, and merges their sections into one record, with provenance for each source. It supports conditional requests.

Owns: the read handler, the three `ReadAdapter` implementations, merge, the aggregate ETag, the read cache switch, and the `ReadPath` construct.

Does not own: routing, token verification or throttling (Spec 01); writes (Spec 03); the mock providers, test doubles and wiring (Spec 00).

| Depends on | What | Where |
|---|---|---|
| Spec 00 | `ReadResponse`, `SourceProvenance`, sections, bounds, headers, errors, authentication context | Spec 00 §3 |
| Spec 00 | `ReadAdapter`, routing table, provider wire schemas, msw doubles, event builder, mock providers | Spec 00 §4 |
| Spec 00 | `ReadPathProperties`, `ReadPathOutputs` | Spec 00 §3.11 |

Spec 02 never imports from Spec 01 or Spec 03.

## 2. Request flow

**MUST** handle each request in this order, within the overall budget in §3.1:

1. `withHttpProblemHandling` resolves the correlation identifier (Spec 00 §3.6).
2. `readAuthenticationContext`, then `requireScope` for `records:read`.
3. Check `recordId` and `If-None-Match` against Spec 00 §3.3 before anything else reads them, and refuse with 400 on any breach.
4. Decode `If-None-Match` by §4.2, and refuse with 400 if it does not decode.
5. If the cache is enabled, read it (§6).
6. Call every provider in the routing table in parallel (§3).
7. Merge the results and compute the aggregate ETag (§4).
8. Choose the status and headers (§5), emit metrics, respond.

**MUST** keep the logic of steps 4 to 7 in modules listed as pure below. Each receives its adapters or store as an argument and imports none.

```text
services/read/src/
  read-handler.ts               steps 1 to 3 and 8; composes the rest
  provider-fan-out.ts           step 6; pure, adapters injected
  record-merge.ts               step 7; pure
  aggregate-etag.ts             pure
  read-cache-policy.ts          step 5 decisions; pure, store injected
  read-cache-store.ts           the DynamoDB store; exists only once RD1 enables it
  adapters/
    http-read-adapter.ts        shared transport and mapping
    provider-a-read-adapter.ts
    provider-b-read-adapter.ts
    provider-c-read-adapter.ts
  read-path-construct.ts
```

## 3. Fan-out, timeouts and partial results

Each provider has its own timeout. The read returns whatever arrived in time, so one slow provider never blocks the others or fails the whole read.

### 3.1 Budgets

| Setting | Environment variable | Value |
|---|---|---|
| per provider timeout | `PROVIDER_TIMEOUT_MILLISECONDS` | RU1 |
| overall fan-out budget | `FAN_OUT_BUDGET_MILLISECONDS` | RU2 |

**MUST** give every provider call an abort signal that fires at whichever comes first: its own timeout, or the overall budget (RU3).

**MUST NOT** retry a provider call on the read path. A read is cheap for the client to repeat, and a retry inside the budget only lengthens the tail.

```ts
const settledProviderCalls = await Promise.allSettled(
  readAdapters.map((readAdapter) =>
    measureProviderCall(readAdapter.providerId, () =>
      readAdapter.read(
        { tenantId, recordId, ifNoneMatchVersion: clientVersionsByProvider[readAdapter.providerId] },
        { abortSignal: abortSignalForProvider(readAdapter.providerId), correlationId },
      ),
    ),
  ),
);
```

**MUST** map a rejection caused by the abort signal to `timeout`, and any other rejection to `error` with reason `transport`.

### 3.2 HTTP adapter

**MUST** keep transport and mapping in one `HttpReadAdapter`. Each provider file sets only `providerId`, its base URL variable and its secret.

The adapter:

- **MUST** send `X-Api-Key`, `X-Correlation-Id`, and `If-None-Match` when a version is known.
- **MUST** stop reading the body at the Spec 00 §3.3 provider bound, and return `error` with reason `body-too-large` without parsing any of it.
- **MUST** check `Demo-Provider-Contract` before parsing, and return `error` with reason `version-mismatch` if it is missing or different.
- **MUST** check `ETag` and `Cache-Control` against Spec 00 §3.3, and return `error` with reason `header-invalid` on a breach.
- **MUST** validate the body with the Spec 00 §4.4 read response schema, and return `error` with reason `schema-invalid` on any failure.
- **MUST** read `ETag` into `version`, and `max-age` into `ttlSeconds`, defaulting to RU4 when absent and capped at RU5.
- **MUST** reuse connections across invocations (RU6).

### 3.3 Status per provider

**MUST** map each provider result as follows:

| Provider result | `status` | `errorReason` | Sections used |
|---|---|---|---|
| 200 and every check passes | `ok` | | yes |
| 304 | `not-modified` | | see §4.3 |
| 404 | `not-found` | | no; not a failure |
| any other status | `error` | `http-status` | no |
| version header missing or wrong | `error` | `version-mismatch` | no |
| body over the bound | `error` | `body-too-large` | no |
| header out of bound or grammar | `error` | `header-invalid` | no |
| body fails the schema | `error` | `schema-invalid` | no |
| network failure | `error` | `transport` | no |
| abort signal fired | `timeout` | | no |

### 3.4 Partial and total failure

- **MUST** set `partial` when at least one provider is `timeout` or `error`, and at least one is `ok` or `not-modified`.
- **MUST** answer 404 `not-found` when every provider is `not-found`.
- **MUST** answer 503 `all-sources-unavailable`, with `Retry-After` of RU7, when no provider is `ok` or `not-modified`, and at least one is `timeout` or `error`.

How a partial record is shown is the client's concern. This specification guarantees only that `sources` tells the client which sections are missing and why.

## 4. Merge, aggregate ETag and conditional requests

### 4.1 Merge

**MUST** implement merge as a pure function of the provider results, the routing table and the current time, which:

- takes from each `ok` provider only the sections the routing table assigns it (Spec 00 §4.2), dropping any other and counting it as `ProviderSectionIgnored`
- sets `sectionSources` for every section included
- sets `updatedAt` to the latest `updatedAt` among `ok` providers
- returns one `SourceProvenance` per provider, in routing table order, including every failure

### 4.2 Aggregate ETag

This specification owns the aggregate ETag's grammar. Clients treat it as opaque.

**MUST** use this grammar:

| Part | Content |
|---|---|
| quoting | the whole value in double quotes, a strong validator |
| prefix | `v1.` |
| body | base64url, unpadded, of a JSON object mapping each `providerId` to its provider version, keys sorted |

- **MUST** include only providers that returned a version.
- **MUST** emit an ETag only when every provider is `ok` or `not-modified`, so a conditional request can never hide a missing source.
- **MUST** refuse with 400 `validation-failed` an `If-None-Match` that is not exactly one value of this grammar. That includes weak validators, lists, `*`, and a body naming a provider not in the routing table.

### 4.3 Conditional requests

**MUST** respond as follows:

| Provider results | Response |
|---|---|
| every provider 304 | 304, the same ETag, no body |
| every provider 200 | 200, full body, new ETag |
| a mix of 200 and 304 | call the 304 providers once more without `If-None-Match`, within the remaining budget, then 200 |
| that second call fails or times out | 200, `partial` set, the affected providers marked `timeout` or `error`, no ETag |
| some 304, the rest failed, none 200 | 503 `all-sources-unavailable`; the client keeps its copy |

The second call in the mixed row asks for the body, not whether it changed, so §3.1's no-retry rule does not cover it.

**MUST** log the second call once with that reason, and count it as `ConditionalRefetch`.

If RD1 enables the cache, a cached body whose version matches **MAY** stand in for the second call.

## 5. Status codes and caching headers

**MUST** answer as follows:

| Status | When | Body | Headers |
|---|---|---|---|
| 200 | at least one provider `ok` | `ReadResponse` | `ETag` if complete, `Cache-Control`, `Vary`, `X-Correlation-Id` |
| 304 | §4.3 first row | none | `ETag`, `Cache-Control`, `Vary`, `X-Correlation-Id` |
| 400 | a breach at §2 step 3 or 4 | problem document | |
| 403 | scope missing | problem document | |
| 404 | every provider `not-found`, or another tenant's record | problem document | |
| 503 | §3.4 | problem document | `Retry-After` |

- **MUST** set `Cache-Control: private, max-age=` followed by the smallest `ttlSeconds` among `ok` and `not-modified` providers, on a complete 200 or a 304.
- **MUST** set `Cache-Control: private, max-age=0, must-revalidate` on a partial 200.
- **MUST NOT** set `public`.
- **MUST** set `Vary: Authorization` on every 200 and 304.

## 6. Read cache

The cache ships disabled, and **MUST** stay disabled unless RD1 enables it.

- **MUST** honour `ReadPathProperties.readCache` (Spec 00 §3.11). Synth **MUST** fail if it is enabled without an `approvalReference` naming the RD1 decision.
- **MUST** log its absence at cold start, as Spec 00 §5.1 requires.
- **MUST** use cached sections only in place of the §4.3 second call, or in place of a provider that timed out. A stand-in for a timed out provider keeps provenance status `timeout` and its original `fetchedAt`, and sets `servedFrom` to `server-cache` and `partial` to true. A cached copy is never presented as live.

RE7 specifies the enabled behaviour when RD1 schedules it.

## 7. ReadPath construct and function configuration

**MUST** implement `ReadPathProperties` and `ReadPathOutputs` exactly as Spec 00 §3.11 defines them. The tuning values below are constants inside the construct.

| Setting | Value |
|---|---|
| function name | component `read` |
| runtime | per Spec 00 CU1 |
| memory | RU10 |
| timeout | RU11 |
| reserved concurrency | RU12 |
| provisioned concurrency | RU13 in `demo`; none elsewhere |
| permissions | read the three provider secrets, and nothing else unless RD1 enables the cache |

**MUST NOT** place the function in a VPC.

## 8. Observability

**MUST** emit these metrics:

| Metric | Unit | Dimensions |
|---|---|---|
| `ProviderLatency` | milliseconds | `providerId` |
| `ProviderOutcome` | count | `providerId`, `status`, `errorReason` where present |
| `ProviderSectionIgnored` | count | `providerId` |
| `ReadPartial` | count | none |
| `ReadNotModified` | count | none |
| `ReadAllSourcesUnavailable` | count | none |
| `ConditionalRefetch` | count | `providerId` |

`ProviderOutcome` with reason `version-mismatch` is the version mismatch count Spec 00 §3.1 requires.

**MUST** create these alarms, with thresholds from RU14:

| Alarm | Measures |
|---|---|
| `ProviderTimeoutRate` | one provider's timeouts as a share of its outcomes |
| `ProviderVersionMismatch` | `version-mismatch` outcomes |
| `ReadAllSourcesUnavailable` | 503 answers |
| `ReadFunctionErrors` | function errors |

**MUST** trace each provider call as its own subsegment, annotated with `providerId` and `status`.

## 9. Decisions

**RD1 DECIDE Enable the read cache.**
- Blocked: RE7.
- Why open: storing copies of provider data is a data governance question. It belongs to the author, and in any real deployment to the providers' owners.
- Options: build the switch and its synth guard only, and no cache behaviour; build the cache and leave it disabled; enable it in `demo` only.
- Trade offs: the cache softens provider outages, but creates a second place provider data lives, with its own retention, encryption and `PRIVACY.md` duties.
- Recommendation: build the switch, its synth guard and the cold start log in RE5, and no cache behaviour. RE7 stays unscheduled until RD1 enables it.

## 10. Phases

The Plan stage for this specification **MUST** settle every RU value before the phase that needs it.

### RE1 Aggregate ETag and merge

- **Work:** `aggregate-etag.ts` and `record-merge.ts`.
- **Excluded:** transport, timeouts, the handler.
- **Assumptions to verify:** none beyond Spec 00 CE1.
- **Tests first:**
    - an encode and decode round trip, as a fuzz property
    - refusal of weak validators, lists, `*`, a bad prefix, bad base64, bad JSON and an unknown provider
    - a merge that keeps only owned sections, sets `sectionSources`, takes the latest `updatedAt`, keeps routing order, and sets `partial` for every combination in §3.4
- **Done when:** the suites pass, and the pure import check passes on both modules.

### RE2 Read adapters

- **Work:** `HttpReadAdapter` and the three provider adapters.
- **Excluded:** fan-out and budgets.
- **Assumptions to verify:** RU3 to RU6.
- **Tests first:** against the Spec 00 msw doubles, every row of §3.3, including `oldversion-`, `oversize-` and `badheader-` records; that the bound stops reading before the parser runs; that `max-age` is defaulted and capped.
- **Done when:** the suite passes.

### RE3 Fan-out

- **Work:** `provider-fan-out.ts`.
- **Excluded:** the handler.
- **Assumptions to verify:** RU1 to RU3.
- **Tests first:** with fake timers and stub adapters: a provider is aborted at its own timeout; every outstanding call is aborted at the overall budget; an abort maps to `timeout` and anything else to `error`; one slow provider does not delay the others.
- **Done when:** the suite passes, and the pure import check passes.

### RE4 Read handler

- **Work:** `read-handler.ts` and `read-cache-policy.ts` in its disabled form.
- **Excluded:** the enabled cache (RE7).
- **Assumptions to verify:** Spec 00 CU3, CU4.
- **Tests first:** invoked directly with the Spec 00 event builder, against the msw doubles:
    - the scope check, every bound breach in §2 step 3, and a bad `If-None-Match`
    - every row of §3.4, §4.3 and §5, with `Cache-Control` and `Vary` on each
    - another tenant's record answered 404
    - the cold start log of the absent cache
- **Done when:** the suite passes.

### RE5 ReadPath construct

- **Work:** `read-path-construct.ts`, implementing the Spec 00 §3.11 interfaces.
- **Excluded:** wiring it into `infra/bin/app.ts`, which is Spec 00 CE6; deployment.
- **Assumptions to verify:** RU10 to RU14; Spec 00 CU2.
- **Tests first:** synth assertions for the function settings, its permissions, no VPC, the alarms and their topic, and the synth failure for an enabled cache without `approvalReference`.
- **Done when:** the synth suite passes.

### RE6 Deployed checks against the mock providers

- **Work:** `infra/test/read.spec.ts`, invoking the deployed function in `dev` directly with the Spec 00 event builder, against the deployed mock providers.
- **Excluded:** the gateway (Spec 00 §5.4).
- **Assumptions to verify:** Spec 00 CE4 is deployed and seeded, and CE6 is done.
- **Tests first:**
    - a normal record gives 200, not partial, three `ok` sources and an ETag
    - the same request with that ETag gives 304
    - `slow-b-` gives 200 within the budget, partial, provider-b `timeout`, no ETag and `max-age=0`
    - `down-a-` gives 200, partial, provider-a `error`
    - an unknown record gives 404
    - a `tenant-2` record read with a `tenant-1` event gives 404
    - an event without `records:read` gives 403
- **Done when:** the suite passes against `dev`. Under Spec 00 CD3's recommendation this is an author gate. The latency target RU15 is a further author gate.

### RE7 Read cache

- **Work:** the enabled cache, when RD1 schedules it.
- **Excluded:** everything, until then.
- **Assumptions to verify:** RU8, RU9.
- **Tests first:** written when RD1 schedules this phase.
- **Done when:** not scheduled.

## Appendix A: unverified values

| Identifier | Value assumed | Needed by | Settle by |
|---|---|---|---|
| RU1 | per provider timeout 1,500 ms | RE3 | author decision against provider latency |
| RU2 | overall fan-out budget 2,500 ms, below RU11 and Spec 01 EU10 | RE3 | author decision |
| RU3 | `AbortSignal.any` and `AbortSignal.timeout` abort the runtime's `fetch` | RE2, RE3 | Spec 00 CU7 |
| RU4 | `ttlSeconds` 60 when `max-age` is absent | RE2 | author decision |
| RU5 | `ttlSeconds` capped at 300 | RE2 | author decision |
| RU6 | the runtime's `fetch` keeps connections alive across invocations without an explicit agent | RE2 | Node.js documentation for the runtime's exact version, then an experiment |
| RU7 | `Retry-After` 5 seconds on 503 | RE4 | author decision |
| RU8 | DynamoDB TTL deletes expired entries some time after expiry, so readers check expiry themselves | RE7 | DynamoDB documentation |
| RU9 | the runtime may freeze work not awaited before the handler returns | RE7 | Lambda execution environment documentation |
| RU10 | memory 512 MB | RE5 | author decision after measurement |
| RU11 | function timeout 5 seconds | RE5 | author decision, checked against RU2 and Spec 01 EU10 |
| RU12 | reserved concurrency 100 | RE5 | author decision against provider capacity and Spec 01 EU11 |
| RU13 | provisioned concurrency 2 in `demo` | RE5 | author decision; it has a cost |
| RU14 | alarm thresholds: `ProviderTimeoutRate` above 10 per cent over 5 minutes; the other three on any occurrence in 5 minutes | RE5 | author decision |
| RU15 | p95 below 800 ms for normal records at 20 requests per second for 2 minutes | RE6 author gate | author decision |
