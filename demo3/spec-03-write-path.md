# Spec 03: Demo write path

Specification family: demo platform. Draft 2, dated 18 October 2026.

## Applying the datum

This specification applies `ENGINEERING_DATUM.md` version 2, dated 20 September 2026, as Spec 00, Applying the datum, states for the family. Its identifiers and its statement of what it is not are there too.

What this subject requires beyond the datum and Spec 00:

- a durable queue that holds a command through a provider outage and applies it afterwards, which departs from datum 0.17 item 10 and is WD1. WE3 and WE5 are blocked until WD1 is answered.
- operator tooling that deletes and redrives dead lettered messages, which are destructive operations (§8)

## 1. Scope

Spec 03 delivers durable asynchronous writes. A command is recorded in a journal and acknowledged with 202 in one DynamoDB transaction. A relay moves it to an SQS FIFO queue, and a worker applies it to the owning provider. Every attempt carries the same idempotency key and the client's base version, so a repeat cannot overwrite newer data, and a conflict is reported rather than resolved.

Owns: intake (`POST /v1/commands`), the command journal, the stream relay, the recovery sweep, the queue and its dead letter queue, the worker, the three `WriteAdapter` implementations, the operator tooling, the status handler (`GET /v1/operations/{operationId}`), and the `WritePath` construct.

Does not own: routing, token verification or throttling (Spec 01); reads (Spec 02); the mock providers, test doubles and wiring (Spec 00).

| Depends on | What | Where |
|---|---|---|
| Spec 00 | `CommandRequest`, `OperationState`, `OperationStatus`, sections, bounds, headers, errors, authentication context | Spec 00 §3 |
| Spec 00 | `WriteAdapter`, `ApplyOutcome`, routing table, provider wire schemas, msw doubles, event builder, mock providers | Spec 00 §4 |
| Spec 00 | `WritePathProperties`, `WritePathOutputs` | Spec 00 §3.11 |

Spec 03 never imports from Spec 01 or Spec 02.

## 2. Flow

1. **Intake** (§3) checks the request, writes the operation and its idempotency entry in one transaction, and answers 202. State `ACCEPTED`.
2. **Relay** (§5.1) receives the new operation from the journal's stream, sends its identifier to the queue, and moves it to `QUEUED`.
3. **Sweep** (§5.3) runs on a schedule, and sends anything still `ACCEPTED` after a grace period.
4. **Worker** (§6) receives the message, moves the operation to `APPLYING`, and calls the provider. It records `SUCCEEDED`, `CONFLICT` or `FAILED`, or leaves the message for SQS to deliver again.
5. After the last allowed receive, the operation is `DEAD_LETTERED` and the message moves to the dead letter queue, to await an operator (§8).
6. The client polls the **status handler** (§9) until a terminal state.

The journal comes before the queue so that the 202 means the command is durable. One transaction makes it durable and idempotent together, and the stream hands it to the queue at least once, without a second write in the request path.

Delivery from journal to provider is at least once. The effect at the provider is at most once, because every attempt carries the same `Idempotency-Key` and `If-Match`.

## 3. Intake

**MUST NOT** call a provider from intake.

### 3.1 Steps

**MUST** perform these in order:

1. `withHttpProblemHandling`, `readAuthenticationContext`, then `requireScope` for `records:write`.
2. Check `Content-Type` and `Idempotency-Key` per Spec 00 §3.4.
3. Check the raw body length against Spec 00 §3.3 as received, before any decoding or parsing (WU1).
4. Parse the body with the strict `CommandRequest` schema, and validate the payload (Spec 00 §3.9).
5. Resolve the provider from the routing table (Spec 00 §4.2), and refuse with 400 a section it does not list, or a command type it does not allow for that section.
6. Compute `requestHash` over the canonical form of the tenant and the body (WD2).
7. Mint `operationId`, and write the operation item and the idempotency item in one transaction, each conditional on not existing (§4).
8. Answer 202 with the `OperationStatus` in state `ACCEPTED`, with `Location` and `Cache-Control: no-store`.

### 3.2 Replay

When the transaction fails because the idempotency item already exists (WU2), intake **MUST** answer:

| Stored `requestHash` | Response |
|---|---|
| equal | 202 with the original operation's current `OperationStatus`, its `Location`, and `Idempotent-Replayed: true` |
| different | 422 `idempotency-key-reused` |

**MUST** answer 500 for any other transaction failure, so the client retries with the same key.

### 3.3 What intake does not check

Intake does not check `baseVersion` against the provider, or whether the record exists. The provider owns both, and they surface at apply time as `CONFLICT` or `FAILED`.

## 4. Command journal

One DynamoDB table holds operations and idempotency entries, with a sparse index for the sweep and a stream for the relay.

**MUST** configure the table as: component `command-journal`; on demand capacity; string keys `partitionKey` and `sortKey`; a stream carrying new and old images; TTL on `expiresAt`; point in time recovery on.

### 4.1 Items

| Item | `partitionKey` | `sortKey` | Attributes | Expiry |
|---|---|---|---|---|
| operation | `OP#` followed by `operationId` | `OP` | `schemaVersion`, `tenantId`, `recordId`, `providerId`, `section`, `commandType`, `baseVersion`, `payload`, `idempotencyKey`, `requestHash`, `state`, `attempts`, `redriveCount`, `createdAt`, `updatedAt`, `lastTransitionOrigin`, and where set `result`, `conflict`, `failure`, `lastErrorReason`, `pendingBucket`, `pendingSince` | WD3 |
| idempotency | `IDEM#` followed by `tenantId`, `#` and `idempotencyKey` | `IDEM` | `schemaVersion`, `operationId`, `requestHash`, `createdAt` | WD3 |

**MUST** refuse on read any item whose `schemaVersion` is not `1`, and count it.

**MUST** store `payload` as a map, within the item size limit (WU3).

### 4.2 Sparse index

**MUST** create an index, `pending-index`, with partition key `pendingBucket` and sort key `pendingSince`, projecting the keys and `tenantId`.

**MUST** set `pendingBucket` to `PENDING` and `pendingSince` to `createdAt` at intake, and remove both on every transition out of `ACCEPTED`.

**GUIDANCE** One partition is enough at demo volume. Shard the bucket if sustained intake approaches the per partition write limit (WU4).

### 4.3 Transitions

**MUST** make every state change a conditional update on the current `state`, from the sources listed in §7.

**MUST** pass `lastTransitionOrigin` to every transition as a required argument, naming the acting surface: `intake`, `relay`, `sweep`, `worker` or `operator` (datum 0.14).

When the condition fails:

- **MUST**, for `relay`, `sweep` and `worker`, log `StaleTransition` once, count it, and stop.
- **MUST**, for `operator`, treat the operation already being in the target state as done, and go on to the remaining steps (§8.2). Any other state stops the action.

### 4.4 Data access

**MUST** make `journal-store.ts` the only module that touches the table. It exports `createOperation`, `readOperation`, `readIdempotencyEntry`, `transitionOperation` and `listPendingOperations`.

**MUST** hold the §7 table as data in `operation-state-machine.ts`, which is pure, and **MUST** take `transitionOperation`'s allowed sources from it.

### 4.5 Expiry

TTL expiry deletes journal items. The deletion is explicit in the model through `expiresAt`, and idempotent.

**MUST** count expiries as `JournalItemExpired`, from the stream (WU5).

## 5. Relay and sweep

### 5.1 Relay

- **MUST** be triggered by the journal's stream, filtered to inserts of operation items and to TTL removals (WU5, WU6).
- **MUST** call `enqueueOperation` (§5.2) for each inserted operation, and count each TTL removal (§4.5).
- **MUST** report failures per record, split a failing batch, retry a bounded number of times, and send exhausted records to a failure queue, component `relay-failures` (WU7). The sweep recovers the operations themselves.
- **MUST** log once per batch, and count as `RelayBatchFailed`, every batch in which it reports failed records, saying that the event source will retry them.
- **MUST** be absent when `relayEnabled` is false. That is allowed only in `test` (Spec 00 §2.3), and the sweep logs it at cold start (Spec 00 §5.1).

### 5.2 enqueueOperation

Shared by the relay and the sweep. **MUST** perform these in order:

1. Send to the FIFO queue, component `commands`, a message whose body holds `messageVersion` `1` and `operationId`, and nothing else.
    - Message group: the SHA-256, in hexadecimal, of `tenantId`, `#` and `recordId`. Commands for one record then apply in order while different records run in parallel, and the group stays within SQS's limit (WU22).
    - Deduplication identifier: `operationId`.
2. Move the operation from `ACCEPTED` to `QUEUED`, with origin `relay` or `sweep`. A stale transition here is expected, because the worker may already have the message.

If step 1 succeeds and step 2 fails, the sweep sends again. Within the deduplication window SQS drops the duplicate (WU8). After it, the worker's state check in §6.3 makes the duplicate harmless.

### 5.3 Sweep

- **MUST** run on a schedule (WU9).
- **MUST** list pending operations older than the grace period (WU10), read each, and call `enqueueOperation` for each still `ACCEPTED`.
- **MUST** stop at its batch limit or time limit per run (WU10), and count each run that stops at a limit as `SweepLimitReached`.
- **MUST** count each operation it sends as `SweepRecovered`, and log once per run that it is sending operations the relay has not moved.

## 6. Queue, dead letter queue and worker

### 6.1 Queues

**MUST** configure the queues as follows:

| Setting | `commands` | `commands-dlq` |
|---|---|---|
| type | FIFO, content based deduplication off | FIFO |
| visibility timeout | WU11 | |
| retention | WU12 | WU12 |
| redrive | to `commands-dlq` after WU13 receives | none |
| encryption | SQS managed | SQS managed |

### 6.2 Worker trigger

**MUST** read with batch size 1, report failures per message, and cap concurrency at WU14. That cap is the backpressure control on the providers.

With batch size 1, a failed message holds back only its own record's group.

### 6.3 Worker steps

**MUST** perform these in order:

1. Check the message body against Spec 00 §3.3 and its schema, including `messageVersion`. On failure, log the reason category, count it as `QueueMessageRejected`, and report the message failed, so it reaches the dead letter queue.
2. `readOperation`. If there is none, log `OperationMissing` and acknowledge.
3. If the state is terminal (Spec 00 §3.10), log `DuplicateDelivery` and acknowledge.
4. Move to `APPLYING` from `ACCEPTED`, `QUEUED` or `APPLYING`, with origin `worker`, adding one to `attempts` and removing the pending attributes. `ACCEPTED` is a source because the sweep can send before the relay's transition lands.
5. Call the provider's `WriteAdapter` with `idempotencyKey` set to `operationId`, and an abort signal at WU15.
6. Act on the `ApplyOutcome`:

| Outcome | Action |
|---|---|
| `applied` | to `SUCCEEDED` with `result`; acknowledge |
| `conflict` | to `CONFLICT` with `conflict`; acknowledge |
| `rejected` | to `FAILED` with `failure`; acknowledge |
| `retryable`, receive count below WU13 | save `lastErrorReason`; log once what is retried and why; set the message's visibility to the §6.4 backoff; report the message failed |
| `retryable`, receive count at WU13 | to `DEAD_LETTERED` with `failure`; report the message failed |

The receive count comes from the message attribute in WU16.

### 6.4 Backoff

On a retryable outcome, **MUST** set visibility to the provider's `Retry-After` when present and within Spec 00 §3.3. Otherwise it uses a doubling backoff from a base, capped, with jitter (WU17).

A FIFO group waits while its message is invisible, so later commands for the same record wait too. That is intended, because they were written against the earlier version.

### 6.5 Write adapters

**MUST** keep transport and mapping in one `HttpWriteAdapter`. Each provider file sets only `providerId`, its base URL variable and its secret.

| Command type | Provider call |
|---|---|
| `record.section.replace` | `PUT /records/{recordId}/sections/{section}` |
| `record.notes.append` | `POST /records/{recordId}/sections/notes/entries` |

The adapter:

- **MUST** send `If-Match` with the quoted `baseVersion`, and `Idempotency-Key`, `X-Api-Key` and `X-Correlation-Id`.
- **MUST** send the Spec 00 §4.4 request body, and check the response as Spec 00 §4.1 requires.
- **MUST** map 200 and 201 to `applied`, with the version from `ETag`.
- **MUST** map 409 and 412 to `conflict`, with `currentVersion` from `ETag` when present and valid.
- **MUST** map 400, 404 and 422 to `rejected`.
- **MUST** map 429, 5xx, an abort and a network failure to `retryable`, with `Retry-After` when present and valid.
- **MUST** map a version mismatch, an oversized body or an invalid header on a 2xx to `retryable`, and count it by reason category.

## 7. Operation state machine

Every transition is a conditional update (§4.3). A transition missing from this table is a defect.

| From | To | Origin | Trigger |
|---|---|---|---|
| none | `ACCEPTED` | `intake` | transaction committed |
| `ACCEPTED` | `QUEUED` | `relay` or `sweep` | message sent |
| `ACCEPTED`, `QUEUED` | `APPLYING` | `worker` | message received |
| `APPLYING` | `APPLYING` | `worker` | received again after a retryable outcome |
| `APPLYING` | `SUCCEEDED` | `worker` | `applied` |
| `APPLYING` | `CONFLICT` | `worker` | `conflict` |
| `APPLYING` | `FAILED` | `worker` | `rejected` |
| `APPLYING` | `DEAD_LETTERED` | `worker` | `retryable` at the last receive |
| `DEAD_LETTERED`, `APPLYING` | `QUEUED` | `operator` | redrive (§8), adding one to `redriveCount` |
| `DEAD_LETTERED`, `APPLYING` | `FAILED` | `operator` | discard (§8) |

`APPLYING` is a source of the operator rows because a worker that times out on its last receive leaves the operation `APPLYING` while SQS moves the message (WU18).

Spec 00 §3.10 governs `CONFLICT`. The client re-reads, resolves the difference, and submits a new command with a new `Idempotency-Key` and the current `baseVersion`.

## 8. Operator tooling for dead letters

Dead letters are handled by an operator, never automatically, because a command that has failed every attempt needs a person's decision. Redrive and discard each delete a message, so they are destructive operations.

### 8.1 Scripts

**MUST** provide these scripts in `services/write`, each run with the operator's own AWS credentials, for example `npm run dlq:inspect:dev --workspace services/write`:

| Script | Effect |
|---|---|
| `dlq:inspect:dev`, `dlq:inspect:test`, `dlq:inspect:demo` | lists the stage's dead letter messages without deleting any. Each shows `operationId`, `tenantId`, `recordId`, `providerId`, `state`, `attempts`, `redriveCount`, `lastErrorReason` and `createdAt`, and any operation not in `DEAD_LETTERED` is flagged. |
| `dlq:resolve:dev`, `dlq:resolve:test`, `dlq:resolve:demo` | for each message, shows the same line and asks the operator to redrive, discard or skip it |

**MUST NOT** grant any Lambda permission to delete from `commands-dlq`.

### 8.2 Behaviour

**MUST** keep every decision in `dead-letter-decisions.ts`, which is pure. The scripts only print what it returns and pass on the operator's answers.

**MUST** redrive in this order:

1. Move the operation to `QUEUED` with origin `operator`, adding one to `redriveCount`.
2. Send a new message with deduplication identifier `operationId`, `#r` and the stored `redriveCount`.
3. Delete the dead letter message.

**MUST** discard in this order:

1. Move the operation to `FAILED` with origin `operator`, and failure code `operator-discarded`.
2. Delete the dead letter message.

**MUST** make a rerun after a partial failure at any step finish the action. Under §4.3 a rerun finds the operation already in the target state, reuses the stored `redriveCount` rather than adding to it, and completes the remaining steps.

**MUST** log each action with `operationId`, the action and the outcome, and count it as `OperatorAction`.

**MUST NOT** reset `attempts` on redrive.

## 9. Status handler

**MUST** handle `GET /v1/operations/{operationId}` in this order:

1. `withHttpProblemHandling`, `readAuthenticationContext`, then `requireScope` per WD4.
2. Check `operationId` against Spec 00 §3.3, and refuse with 400 on failure.
3. `readOperation` with a strongly consistent read. Answer 404 if it is missing, or if its `tenantId` differs from the caller's.
4. Map to `OperationStatus` (Spec 00 §3.10), leaving out `payload`, `requestHash`, `lastErrorReason`, `lastTransitionOrigin` and `redriveCount`.
5. Set `Cache-Control: no-store`, and `Retry-After` from WU19 while the state is in progress or awaiting an operator.

## 10. WritePath construct and function configuration

**MUST** implement `WritePathProperties` and `WritePathOutputs` exactly as Spec 00 §3.11 defines them. The tuning values below are constants inside the construct.

**MUST** fail synth if `relayEnabled` is false in any stage other than `test`.

| Function | Component | Memory and timeout | Trigger | Permissions |
|---|---|---|---|---|
| intake | `write-intake` | WU20 | the command route | transactional write and read on the journal |
| status | `write-status` | WU20 | the status route | read on the journal |
| relay | `write-relay` | WU20 | the journal stream | stream read; update on the journal; send to `commands` and `relay-failures` |
| sweep | `write-sweep` | WU20 | the schedule | query `pending-index`; read and update the journal; send to `commands` |
| worker | `write-worker` | WU20 | `commands` | read and update the journal; change message visibility; read the provider secrets |

**MUST NOT** place any function in a VPC.

```text
services/write/src/
  handlers/
    intake-handler.ts
    status-handler.ts
    relay-handler.ts
    sweep-handler.ts
    worker-handler.ts
  journal-store.ts
  operation-state-machine.ts       pure
  enqueue-operation.ts
  message-group.ts                 pure
  request-hash.ts                  pure
  retry-backoff.ts                 pure
  adapters/
    http-write-adapter.ts
    provider-a-write-adapter.ts
    provider-b-write-adapter.ts
    provider-c-write-adapter.ts
  operator/
    dead-letter-decisions.ts       pure
    dead-letter-inspect-script.ts
    dead-letter-resolve-script.ts
  write-path-construct.ts
```

## 11. Observability

**MUST** emit these metrics:

| Metric | Unit | Dimensions | Emitted by |
|---|---|---|---|
| `CommandsAccepted` | count | `providerId` | intake |
| `IdempotentReplay` | count | none | intake |
| `IdempotencyKeyReused` | count | none | intake |
| `JournalItemRejected` | count | reason category | every reader |
| `RelayEnqueued` | count | none | relay |
| `RelayBatchFailed` | count | none | relay |
| `JournalItemExpired` | count | item kind | relay |
| `SweepRecovered` | count | none | sweep |
| `SweepLimitReached` | count | limit | sweep |
| `QueueMessageRejected` | count | reason category | worker |
| `ApplyOutcome` | count | `providerId`, outcome, reason category where present | worker |
| `ApplyLatency` | milliseconds | `providerId` | worker |
| `TimeToTerminalState` | milliseconds | terminal state | worker |
| `DuplicateDelivery` | count | none | worker |
| `StaleTransition` | count | origin | every caller of `transitionOperation` |
| `OperatorAction` | count | action, outcome | operator scripts |

`JournalItemRejected` and `QueueMessageRejected` with reason `version-mismatch` are the version mismatch counts Spec 00 §3.1 requires.

**MUST** create these alarms, with thresholds from WU21:

| Alarm | Measures |
|---|---|
| `CommandsDeadLetterNotEmpty` | visible messages in `commands-dlq` |
| `CommandQueueAgeHigh` | the age of the oldest message in `commands` |
| `SweepRecovering` | `SweepRecovered` over consecutive periods |
| `RelayIteratorAgeHigh` | the relay's iterator age |
| `QueueMessageRejected` | rejected queue messages |
| `WorkerErrors` | worker function errors, which mean unexpected throws, since retryable outcomes are reported failures |

**MUST** log `operationId` on every line once it is known, and `providerId` and `attempts` in the worker.

## 12. Decisions

**WD1 DECIDE Applying commands after a provider outage.**
- Blocked: WE3 and WE5.
- Why open: datum 0.17 item 10 forbids queuing an event across a disconnection and replaying it later. The write path does exactly that: a command accepted while a provider is down is applied when the provider recovers. The datum gives no exception, so the author decides.
- Options: keep the design and record a deviation in `IMPLEMENTATION_DEVIATIONS.md`; drop the queue and apply in intake, answering 503 while the provider is down; keep the queue, but move commands older than a short window to `FAILED` before applying them.
- Trade offs:
    - The deviation keeps durable acceptance, the property the architecture exists for. It is made safe by `If-Match` on every attempt, so a command applied against a changed record ends `CONFLICT` rather than overwriting, and by one idempotency key per command.
    - Applying in intake is simplest, but loses durable acceptance and puts provider latency in the request.
    - An expiry window bounds staleness, but discards commands the client was told were accepted.
- Recommendation: keep the design and record the deviation. Its covering tests are in WE5.

**WD2 DECIDE Canonical form for `requestHash`.**
- Blocked: WE2.
- Why open: a key order independent canonical JSON can come from a dependency or from a small pure function, and a dependency needs a datum 0.13 record.
- Options: a published JSON canonicalisation package; a pure function that serialises with keys sorted at every depth.
- Trade offs: the package follows a published scheme, but adds a dependency for a hash that never leaves this service. The pure function is about twenty lines, but is ours to get right.
- Recommendation: the pure function, `request-hash.ts`.

**WD3 DECIDE Retention.**
- Blocked: WE1.
- Why open: how long operation and idempotency entries live is a retention decision, and belongs in `PRIVACY.md`.
- Options: operations 30 days and idempotency entries 7 days; shorter; longer.
- Trade offs: the idempotency window must outlast any client's retry horizon, or a late retry becomes a second command. Operation retention bounds how long a client can poll.
- Recommendation: operations 30 days, idempotency entries 7 days.

**WD4 DECIDE Scope for the status route.**
- Blocked: WE6.
- Why open: reading a status is a read, but it only concerns a caller who can write.
- Options: `records:write`; `records:read`; either.
- Trade offs: `records:read` lets read only callers watch write activity in their tenant. `records:write` keeps it with callers who can submit.
- Recommendation: `records:write`.

## 13. Phases

The Plan stage for this specification **MUST** settle every WU value before the phase that needs it.

### WE1 State machine and journal store

- **Work:** `operation-state-machine.ts`, `journal-store.ts`, and the table and index in the construct.
- **Excluded:** handlers.
- **Assumptions to verify:** WU2, WU3; WD3 answered.
- **Tests first:**
    - every allowed transition in §7 passes, and every other pair is refused
    - `transitionOperation` cannot be called without an origin
    - a stale condition logs and counts once and stops, for each non operator origin
    - an operator transition finding the target state already set reports done
    - an item with another `schemaVersion` is refused and counted
- **Done when:** the suite passes against `aws-sdk-client-mock`, and the pure import check passes on the state machine.

### WE2 Intake

- **Work:** `intake-handler.ts`, `request-hash.ts`.
- **Excluded:** the queue.
- **Assumptions to verify:** WU1, WU2; WD2 answered.
- **Tests first:** invoked directly with the Spec 00 event builder:
    - a missing or malformed `Idempotency-Key`, and a wrong `Content-Type`
    - a body over the bound refused before parsing, including a base64 encoded one
    - an unknown key, an unknown section, the wrong command type for a section, and a payload that breaks its schema
    - the scope check
    - a replay with the same body, and one with a different body
    - any other transaction failure answered 500
    - a fuzz property showing key order never changes `requestHash` and any value change always does
- **Done when:** the suite passes.

### WE3 Relay and sweep

- **Work:** `enqueue-operation.ts`, `message-group.ts`, `relay-handler.ts`, `sweep-handler.ts`, the stream mapping, the schedule and the relay failure queue.
- **Excluded:** the worker.
- **Assumptions to verify:** WU5 to WU10, WU22; WD1 answered.
- **Tests first:**
    - the message body holds only `messageVersion` and `operationId`
    - the group identifier is the hash in §5.2 and within WU22; the deduplication identifier is `operationId`
    - a stale transition after a successful send is tolerated
    - the relay logs and counts a batch with failed records
    - the sweep sends only operations still `ACCEPTED` and past the grace period, stops and counts at each limit, logs once per run, and logs the absent relay at cold start
    - a TTL removal is counted and not sent
- **Done when:** the suite passes.

### WE4 Write adapters

- **Work:** `HttpWriteAdapter` and the three provider adapters.
- **Excluded:** the worker's use of them.
- **Assumptions to verify:** Spec 00 CU7.
- **Tests first:** against the Spec 00 msw doubles, every mapping in §6.5, including `throttle-`, `conflict-` and `poison-` records; `If-Match` and `Idempotency-Key` are sent; an out of bound `Retry-After` is ignored and counted.
- **Done when:** the suite passes.

### WE5 Worker

- **Work:** `worker-handler.ts`, `retry-backoff.ts`, the two queues and the event source mapping.
- **Excluded:** operator tooling (WE7).
- **Assumptions to verify:** WU11 to WU18; WD1 answered.
- **Tests first:**
    - every row of the §6.3 table
    - an unreadable or wrong version message rejected, counted and reported failed
    - a missing operation acknowledged; a terminal duplicate acknowledged
    - backoff values with and without `Retry-After`; each retry logged once with its reason
    - WD1's covering tests: a command applied after its record changed ends `CONFLICT` with `attempts` of 1; five commands for one record apply in submission order
- **Done when:** the suite passes.

### WE6 Status handler

- **Work:** `status-handler.ts`.
- **Excluded:** push notification of any kind.
- **Assumptions to verify:** WU19; WD4 answered.
- **Tests first:** invoked directly: a malformed `operationId`; another tenant's operation answered 404; the fields §9 leaves out are absent; `Retry-After` present for in progress and awaiting operator states, and absent for terminal states.
- **Done when:** the suite passes.

### WE7 Operator tooling

- **Work:** the §8 scripts and `dead-letter-decisions.ts`.
- **Excluded:** automatic redrive of any kind.
- **Assumptions to verify:** WU18.
- **Tests first:** against the pure module and `aws-sdk-client-mock`:
    - redrive and discard in order
    - a partial failure after each step, then a rerun that completes the action without adding to `redriveCount` again
    - an `APPLYING` operation flagged and accepted
    - `attempts` unchanged, origin `operator` recorded, and nothing logged beyond §8.2
- **Done when:** the suite passes. Running the scripts against a deployed stage follows Spec 00 CD3.

### WE8 WritePath construct

- **Work:** `write-path-construct.ts`, implementing the Spec 00 §3.11 interfaces.
- **Excluded:** wiring it into `infra/bin/app.ts`, which is Spec 00 CE6; deployment.
- **Assumptions to verify:** WU20, WU21; Spec 00 CU2.
- **Tests first:** synth assertions for every row of the §10 table; each function's permissions and nothing more; no dead letter delete permission on any function; no VPC; every alarm on its topic; the synth failure for `relayEnabled` false outside `test`.
- **Done when:** the synth suite passes.

### WE9 Deployed checks against the mock providers

- **Work:** `infra/test/write.spec.ts`. It invokes the deployed command and status functions directly with the Spec 00 event builder, and reads results from the mock provider's own endpoint, which is the double.
- **Excluded:** the gateway, and any read through Spec 02 (Spec 00 §5.4).
- **Assumptions to verify:** Spec 00 CE4 is deployed and seeded, and CE6 is done.
- **Tests first:**

| Scenario | Record | Expected state | Also check |
|---|---|---|---|
| replace a section | normal | `SUCCEEDED` | the mock provider holds the new section |
| append a note | normal | `SUCCEEDED` | the mock provider holds the note |
| same key, same body, twice | normal | one operation | second answer has `Idempotent-Replayed: true`; the provider applied once |
| same key, different body | normal | 422 at intake | |
| stale base version | `conflict-` | `CONFLICT` | `attempts` is 1 |
| transient failures | `flaky-` | `SUCCEEDED` | `attempts` is 3 |
| throttled once | `throttle-` | `SUCCEEDED` | the second attempt is at least the `Retry-After` after the first |
| always failing | `poison-` | `DEAD_LETTERED` | the message is in `commands-dlq` |
| relay disabled | normal, in `test` | `SUCCEEDED` | `SweepRecovered` incremented |
| ordering | five commands for one record | all `SUCCEEDED` | the provider saw them in submission order |
| another tenant polls | normal | 404 | |

- **Done when:** the suite passes against `dev`, and the relay disabled row against `test`. Under Spec 00 CD3's recommendation this is an author gate. Resolving the `poison-` operation with `dlq:resolve:dev` is a further author gate.

## Appendix A: unverified values

| Identifier | Value assumed | Needed by | Settle by |
|---|---|---|---|
| WU1 | how payload format 2.0 presents the body (`isBase64Encoded`), so the bound applies to the body as received | WE2 | Spec 00 CU3, then an experiment |
| WU2 | a failed condition in `TransactWriteItems` reports which item failed, so an idempotency collision can be told apart from other failures | WE1, WE2 | DynamoDB API reference |
| WU3 | the DynamoDB item size limit is well above the Spec 00 command bound | WE1 | DynamoDB quotas |
| WU4 | the per partition write limit, against expected intake | WE1 | DynamoDB documentation |
| WU5 | a stream record for a TTL deletion can be told apart from other removals | WE3 | DynamoDB Streams documentation |
| WU6 | event source filter criteria can select inserts of operation items and TTL removals | WE3 | Lambda event filtering documentation |
| WU7 | the stream event source supports per record failure reporting, batch splitting, a bounded retry count and an on failure destination | WE3 | Lambda event source mapping documentation |
| WU8 | the FIFO deduplication window is 5 minutes | WE3 | SQS documentation |
| WU9 | the sweep runs every 2 minutes, on EventBridge Scheduler | WE3 | author decision; Scheduler documentation |
| WU10 | sweep grace period 60 seconds; at most 100 operations or 50 seconds per run | WE3 | author decision |
| WU11 | visibility timeout 120 seconds, against the guidance relating it to the function timeout | WE5 | SQS and Lambda documentation |
| WU12 | retention 4 days on `commands`, 14 days on `commands-dlq` | WE5 | author decision; SQS limits |
| WU13 | 5 receives before the dead letter queue | WE5 | author decision |
| WU14 | worker concurrency cap 10, and the minimum the event source mapping allows | WE5 | Lambda documentation; author decision against provider capacity |
| WU15 | per call abort at 8,000 ms, below the worker timeout | WE5 | author decision, checked against WU20 |
| WU16 | the receive count is the attribute `ApproximateReceiveCount`, and counts receives across visibility changes | WE5 | SQS documentation |
| WU17 | backoff base 5 seconds, doubling, capped at 300 seconds, up to 20 per cent jitter, within the maximum visibility timeout | WE5 | author decision; SQS limits |
| WU18 | a function timeout on the last receive leaves the operation `APPLYING` while SQS moves the message | WE5, WE7 | an experiment on a throwaway stack |
| WU19 | status `Retry-After` 2 seconds while in progress, 60 seconds while awaiting an operator | WE6 | author decision |
| WU20 | memory and timeout: intake 256 MB, 5 seconds; status 256 MB, 3 seconds; relay 256 MB, 30 seconds; sweep 256 MB, 60 seconds; worker 512 MB, 20 seconds | WE8 | author decision after measurement |
| WU21 | alarm thresholds: dead letter visible for 1 minute; oldest message above 300 seconds; `SweepRecovered` above 0 for 3 periods; iterator age above 60 seconds, if that metric exists under that name; any rejected message or worker error in 5 minutes | WE8 | author decision; Lambda metrics documentation |
| WU22 | the SQS message group identifier allows 64 hexadecimal characters | WE3 | SQS documentation |
