# Spec 01: Demo entry point

Specification family: demo platform. Draft 2, dated 18 October 2026.

## Applying the datum

This specification applies `ENGINEERING_DATUM.md` version 2, dated 20 September 2026, as Spec 00, Applying the datum, states for the family. Its identifiers and its statement of what it is not are there too.

What this subject requires beyond the datum and Spec 00: an identity provider for the demo (ED1), and one departure from Spec 00's error contract (ED3).

## 1. Scope

Spec 01 delivers the single public API: an API Gateway HTTP API with a JWT authoriser and three routes, each integrated with a Lambda function from Spec 02 or Spec 03.

**MUST NOT** contain runtime code other than the identity provider trigger in §4.2.

Owns: the HTTP API and its stage, the JWT authoriser, the demo identity provider, route and integration configuration, throttling, CORS, access logs, gateway alarms, and the `DemoApi` construct.

Does not own: body validation, scope checks, tenant checks or response shaping, which belong to the handlers (Spec 00 §3.2).

| Depends on | What | Where |
|---|---|---|
| Spec 00 | routes, headers, bounds, errors, handler contract | Spec 00 §3 |
| Spec 00 | `DemoApiProperties`, `DemoApiOutputs` | Spec 00 §3.11 |
| Spec 00 | stub functions and the `stub` stage | Spec 00 CE5, §2.3 |

Spec 01 never imports from Spec 02 or Spec 03. It receives their functions through `DemoApiProperties`.

## 2. HTTP API

**MUST** use an API Gateway HTTP API (EU1).

### 2.1 Settings

| Setting | Value |
|---|---|
| name | component `api`, so `demo-dev-api` in `dev` |
| payload format | `2.0` |
| stage | the default stage, deployed automatically |
| default endpoint | enabled, unless `customDomain` is set |
| integration timeout | EU10 |
| default route | none |

### 2.2 Routes

**MUST** configure exactly these routes:

| Route | Integration | Authoriser |
|---|---|---|
| `GET /v1/records/{recordId}` | Lambda proxy to `readHandler` | JWT |
| `POST /v1/commands` | Lambda proxy to `commandHandler` | JWT |
| `GET /v1/operations/{operationId}` | Lambda proxy to `statusHandler` | JWT |

**MUST NOT** add, remove or rewrite a header in the gateway.

**MUST NOT** configure a default or catch all route, so an unknown path, including another API version, gets the gateway's own 404 (EU3).

**MUST** integrate the three routes with three separate functions. This keeps one IAM role and one concurrency setting per route, and lets Specs 02 and 03 deploy independently.

## 3. DemoApi construct

`DemoApi` is the only export of `services/entry`.

**MUST** implement `DemoApiProperties` and `DemoApiOutputs` exactly as Spec 00 §3.11 defines them. Its tuning values, the throttles and alarm thresholds, are constants inside the construct, taken from Appendix A.

**MUST NOT** require Specs 02 or 03 to add a resource policy for the gateway. The integration grants invoke permission itself (EU4).

## 4. Authentication

The gateway verifies every token before any handler runs. Handlers check scope and tenant through Spec 00 §3.5.

### 4.1 JWT authoriser

**MUST** configure the authoriser as follows:

| Setting | Value |
|---|---|
| identity source | the `Authorization` request header |
| issuer | the demo user pool's issuer, or `issuerUrl` per ED1 |
| audience | the demo app client, or `audiences` per ED1 |
| route scopes | none |

**MUST NOT** set route level authorisation scopes, so that a missing scope is answered by `requireScope` with a problem document.

### 4.2 Demo identity provider

Applies only if ED1 chooses the demo user pool. The construct **MUST** then create:

- a Cognito user pool, component `users`, with self sign up off and a custom tenant attribute
- a resource server with the scopes `records:read` and `records:write`
- an app client using the client credentials grant, for automated checks
- a pre token generation trigger that copies the tenant attribute into the access token claim `tenant_id` (EU6)
- two synthetic users, one in `tenant-1` and one in `tenant-2`, in `dev` and `stub` only

**MUST** fail synth if the configured trigger cannot add `tenant_id` to client credentials access tokens (EU6), because every handler would refuse those tokens.

**MUST** keep the trigger's claim mapping in a pure module.

## 5. Throttling, CORS, access logs and alarms

### 5.1 Throttling

**MUST** set a rate and burst on each route, from EU11.

**MUST** count throttled requests through the access log metric filter in §5.5.

### 5.2 Per tenant fairness

HTTP APIs have no usage plans (EU8), so one tenant can use up another's share of the route limits. ED2 decides whether that is accepted.

### 5.3 CORS

**MUST** configure CORS as follows, with every header list derived from the Spec 00 §3.4 constants:

| Setting | Value |
|---|---|
| allowed origins | `corsAllowedOrigins`, which **MUST NOT** contain a wildcard outside `dev` |
| allowed methods | `GET`, `POST`, `OPTIONS` |
| allowed headers | `Authorization`, `Content-Type`, `Idempotency-Key`, `If-None-Match`, `X-Correlation-Id` |
| exposed headers | `ETag`, `Location`, `X-Correlation-Id`, `Retry-After`, `Idempotent-Replayed` |
| maximum age | EU12 |

### 5.4 Access logs

**MUST** write structured JSON access logs, retained for EU12, carrying: the request identifier, route key, status, response latency, integration latency, integration error message, authoriser error, and the `tenant_id` claim (EU9).

**MUST NOT** log the source IP address, the `sub` claim, any other header value, or any body (Spec 00 CD5).

### 5.5 Alarms

**MUST** create these alarms on `alarmTopic`, with thresholds from EU13:

| Alarm | Measures |
|---|---|
| `Api5xx` | server error responses |
| `Api4xxSpike` | client error responses as a share of all requests |
| `ApiReadLatencyP95` | p95 latency on the read route |
| `ApiThrottled` | responses with status 429, from an access log metric filter |

## 6. Trust boundary

The gateway is the trust boundary for identity. `SECURITY.md` **MUST** record, in the author's words:

- that handlers trust gateway-verified claims and do not verify tokens again
- the per tenant fairness limit, if ED2 accepts it
- that the gateway's 401 body is not a problem document, per ED3
- what the demo user pool is and is not fit for

## 7. Decisions

**ED1 DECIDE Identity provider.**
- Blocked: EE2.
- Why open: the author's audience and existing identity setup are unknown here.
- Options: the demo user pool in §4.2; an external issuer that already emits `tenant_id` and `scope`.
- Trade offs: the demo pool is self contained, but its trigger may need a paid Cognito feature plan to reach client credentials tokens (EU6). An external issuer needs no pool, but ties the demo to that issuer's claims.
- Recommendation: the demo user pool, provided EU6 confirms it can add `tenant_id` to client credentials tokens at an acceptable cost. Otherwise an external issuer.

**ED2 DECIDE Per tenant fairness.**
- Blocked: EE3's scope.
- Why open: whether it matters depends on how the demo is shown.
- Options: accept it and record it in `SECURITY.md`; add a WAF rate based rule; replace the JWT authoriser with a Lambda authoriser that enforces quotas.
- Trade offs: WAF adds a resource and its cost. A Lambda authoriser adds latency and code to every request.
- Recommendation: accept it for the demo, recorded in the author's words.

**ED3 DECIDE 401 body.**
- Blocked: EE4's 401 assertions.
- Why open: the gateway's 401 is not a problem document (EU5), which departs from Spec 00 §3.6.
- Options: accept it and record it in `IMPLEMENTATION_DEVIATIONS.md` with a covering test; customise the gateway response, if HTTP APIs allow it; move to a Lambda authoriser.
- Trade offs: customisation may not exist for HTTP APIs. A Lambda authoriser costs latency on every request.
- Recommendation: accept and record it. The covering test asserts the 401 status and nothing about the body.

## 8. Phases

The Plan stage for this specification **MUST** settle every EU value before the phase that needs it.

### EE1 DemoApi against stubs

- **Work:** the `DemoApi` construct, the three routes and their integrations, the authoriser wiring, the default stage.
- **Excluded:** the identity provider (EE2); throttling, CORS, logs and alarms (EE3).
- **Assumptions to verify:** EU1, EU3, EU4, EU10.
- **Tests first:** synth assertions with the Spec 00 stubs: exactly three routes with the expected keys; each integrated with the function passed for it; the authoriser on all three; no default route.
- **Done when:** the synth suite passes and lint is clean.

### EE2 Identity provider

- **Work:** §4.2 if ED1 chooses the demo pool, the external issuer wiring otherwise.
- **Excluded:** user management beyond the two synthetic users.
- **Assumptions to verify:** EU6.
- **Tests first:** synth assertions for the pool, resource server, scopes and app client; unit tests of the trigger's pure claim mapping; the §4.2 synth failure shown on a planted pool without the trigger.
- **Done when:** the synth suite and the trigger's unit tests pass.

### EE3 Throttling, CORS, logs and alarms

- **Work:** §5 in full.
- **Excluded:** per tenant fairness, unless ED2 chooses otherwise.
- **Assumptions to verify:** EU7, EU8, EU9, EU11 to EU13.
- **Tests first:** synth assertions for each route's throttle, CORS lists equal to those derived from Spec 00 §3.4, an access log format holding none of the fields §5.4 forbids, and each alarm on its topic.
- **Done when:** the synth suite passes.

### EE4 Deployed checks against the stubs

- **Work:** `infra/test/entry.spec.ts`, run against the deployed `stub` stage.
- **Excluded:** real handlers. With them in place these checks would span independently built sides (Spec 00 §5.4).
- **Assumptions to verify:** EU2, EU5; ED3 answered.
- **Tests first:**
    - no token gives 401 on every route
    - an expired or wrong-audience token gives 401
    - a valid token reaches the stub, which answers its 501 problem document with `X-Correlation-Id` echoed
    - `Demo-Stub-Echo` shows `If-None-Match` and `Idempotency-Key` arriving unchanged
    - preflight from an allowed origin passes, and from another origin fails
    - a burst above the read route's limit produces 429
- **Done when:** the suite passes against `stub`. Under CD3's recommendation this is an author gate: the author deploys, runs it and records the result in `TESTING.md`.

### EE5 Author smoke gate

- **Work:** with CE6 done and `dev` deployed, the author makes one read, one command and one status poll through the public API, and records the result in `TESTING.md`.
- **Excluded:** any automated suite through the full stack (Spec 00 §5.4).
- **Assumptions to verify:** RE6 and WE9 have passed.
- **Tests first:** none of its own. CE6's synth assertions cover the wiring.
- **Done when:** the author has recorded the manual check. This is an author gate.

## Appendix A: unverified values

| Identifier | Value assumed | Needed by | Settle by |
|---|---|---|---|
| EU1 | HTTP APIs support a JWT authoriser and payload format 2.0 together | EE1 | API Gateway HTTP API documentation |
| EU2 | the integration timeout maximum allows EU10 | EE4 | API Gateway quotas |
| EU3 | an HTTP API with no default route answers an unknown path with 404 | EE1 | API Gateway documentation, then an experiment |
| EU4 | the CDK Lambda integration grants invoke permission without an explicit resource policy | EE1 | CDK source for the pinned version |
| EU5 | the body of the gateway's 401, and whether HTTP APIs let it be customised | ED3, EE4 | API Gateway documentation, then an experiment |
| EU6 | Cognito pre token generation can add a claim to client credentials access tokens, the trigger event version that needs, and any feature plan it requires | ED1, EE2 | Cognito documentation and pricing |
| EU7 | HTTP APIs support rate and burst settings per route | EE3 | API Gateway documentation |
| EU8 | HTTP APIs have no usage plans or API keys | ED2 | API Gateway documentation |
| EU9 | the access log variable names for request identifier, route key, latencies, integration error, authoriser error and a JWT claim | EE3 | API Gateway access log variable reference |
| EU10 | integration timeout 6 seconds on the read route, 10 seconds on the command and status routes | EE1 | author decision, checked against EU2 and Spec 02 RU11 |
| EU11 | rate and burst per second: read 100 and 200; command 50 and 100; status 100 and 200 | EE3 | author decision |
| EU12 | CORS maximum age 600 seconds; access log retention 14 days | EE3 | author decision |
| EU13 | alarm thresholds: `Api5xx` above 5 in 5 minutes; `Api4xxSpike` above 20 per cent over 10 minutes; `ApiReadLatencyP95` above 3,000 ms for 3 of 5 minutes; `ApiThrottled` above 50 in 5 minutes | EE3 | author decision |
