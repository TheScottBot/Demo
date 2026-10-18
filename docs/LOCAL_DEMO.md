# Local demonstration

Runs the platform on one machine, with no AWS account, so the concept can be tried by hand: a client calls one public API, and reads and writes travel the same boundaries they would deployed. Everything is synthetic.

## What runs

Each piece is its own process on its own port, and they talk only over HTTP:

| Piece | Port | What it is |
|---|---|---|
| Gateway | 8080 | A stand-in for API Gateway: the three contract routes, a token check, one access log line per request. The only address a client calls. |
| Read service | 8081 | The real read function (Spec 02), configured as the `ReadPath` construct configures it. |
| Write service | 8082 | The real intake and status functions (Spec 03), with the write path's local model behind them: the journal and its stream, the relay, the FIFO queue and its dead letter queue, the sweep, and the real worker. |
| Mock providers | 4101, 4102, 4103 | The three provider APIs (Spec 00 §4.3), holding 20 synthetic records per tenant. |

## Start it

```bash
npm ci
```

```bash
npm run demo:local
```

Each process's output is prefixed with its name: `[gateway]`, `[read]`, `[write]` and `[providers]`. Ctrl+C stops them all.

To run the pieces in separate terminals instead, start each of these in its own:

```bash
npm run start --workspace services/mock-providers
```

```bash
npm run start:read --workspace services/local-demo
```

```bash
npm run start:write --workspace services/local-demo
```

```bash
npm run start:gateway --workspace services/local-demo
```

Stopping the write service while the gateway and read service run shows the boundary: reads still answer, and commands answer 500 at the gateway until it is back.

## Tokens

The gateway takes these demo tokens in place of signed JWTs. Each stands for the claims a verified token from the demo user pool would carry, with the scopes in the pool's resource server form:

| Token | Tenant | Scopes |
|---|---|---|
| `local-tenant-1-reader` | `tenant-1` | `demo/records:read` |
| `local-tenant-1-writer` | `tenant-1` | `demo/records:read demo/records:write` |
| `local-tenant-2-writer` | `tenant-2` | `demo/records:read demo/records:write` |

## Try it

The examples use bash's `curl`; in PowerShell call `curl.exe`.

Read a record:

```bash
curl -i -H "Authorization: Bearer local-tenant-1-reader" http://127.0.0.1:8080/v1/records/record-0001
```

Read it again with the `ETag` the first answer gave, for a 304:

```bash
curl -i -H "Authorization: Bearer local-tenant-1-reader" -H "If-None-Match: <etag>" http://127.0.0.1:8080/v1/records/record-0001
```

Submit a command. `baseVersion` is the `version` of `provider-a` in the read's `sources`, and the idempotency key is any version 4 UUID:

```bash
curl -i -X POST -H "Authorization: Bearer local-tenant-1-writer" -H "Content-Type: application/json" -H "Idempotency-Key: 6f1c2e8a-3b7d-4c5e-9a1f-2d3e4f5a6b7c" -d '{"type":"record.section.replace","recordId":"record-0001","section":"summary","baseVersion":"<version>","payload":{"title":"Synthetic summary","status":"active"}}' http://127.0.0.1:8080/v1/commands
```

Poll its operation with the `operationId` the 202 gave:

```bash
curl -i -H "Authorization: Bearer local-tenant-1-writer" http://127.0.0.1:8080/v1/operations/<operationId>
```

### Records that misbehave

The mock providers misbehave on purpose for records with these identifiers, in either tenant:

| Record | What happens |
|---|---|
| `slow-a-0001`, `slow-b-0001`, `slow-c-0001` | one provider answers slowly: a read that misses its time shows that source as `timeout`, and the read partial |
| `down-a-0001`, `down-b-0001`, `down-c-0001` | one provider is down: a read answers 200 with `partial: true`; a write to it is tried 5 times, then ends `DEAD_LETTERED` |
| `flaky-0001` | a write fails twice, then succeeds on its third attempt |
| `throttle-0001` | a write is throttled once, then succeeds on its second attempt |
| `poison-0001` | a write always fails: after 5 attempts the operation ends `DEAD_LETTERED` |
| `conflict-0001` | a write always meets a newer version: the operation ends `CONFLICT` on its first attempt, never overwriting |
| `oldversion-0001`, `oversize-0001`, `badheader-0001` | every provider answers a read wrongly: no source is usable, so the read answers 503 |

Other things worth trying:
- the same command twice with one idempotency key: the second answer says `Idempotent-Replayed: true`, and the change is applied once;
- the same key with a different body: 422;
- a command with the reader token: 403, from the handler;
- `tenant-2`'s token on `tenant-1`'s operation: 404;
- no token, or a path that is not a route: 401 or 404, from the gateway.

## What it proves, and what it does not

It proves the code: the handlers, the contract, the read fan out and merge, partial reads, ETags, idempotency, the journal, relay, queue, worker, retries, conflicts and tenant isolation, all end to end over HTTP.

It does not prove AWS. The stand-ins are these:
- the gateway checks a fixed token table, not a signature, and does no CORS or throttling, which the synth suites assert instead (Spec 01 EE3);
- the journal, its stream and the queue are the write path's local model (as WE9 runs it), not DynamoDB or SQS;
- Secrets Manager hands back each provider's synthetic key;
- a retry's backoff is not waited out, so a retried command settles at once;
- state lives in memory, and is gone when the processes stop.

Load on the demo says nothing about AWS's scaling. That needs a deployed stage (Spec 01 EE4, set aside).
