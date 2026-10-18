# Implementation deviations

The rule (datum, Applying this datum; datum 0.11): nothing departs from the datum, the project specifications or the contract silently. Every departure is recorded here with the rule it departs from, what is done instead, why, the author's decision, and the covering test. Where the code carries a departure, a comment at that point names it.

Each entry is history once its decision is given; a later change to it is a dated note, not a rewrite.

## 1. Check 6 is property based, not coverage guided fuzzing

- **Rule:** Spec 00 §2.4 check 6, datum 0.10 GUIDANCE: a fuzz harness on every parser in continuous integration.
- **Done instead:** every fast-check property in the suite runs at 1,000 generated inputs in the `property-runs` CI job (100 locally). fast-check generates inputs at random from arbitraries; it is not guided by coverage, as a fuzzer such as libFuzzer is.
- **Why:** the toolchain is TypeScript on Node.js, and the parsers are pure functions that a property can drive directly. A coverage guided fuzzer would add a native toolchain the CI runner is not assumed to have (CE3).
- **Author's decision:** accepted, 18 October 2026 (CQ8).
- **Covering test:** `tree-checks/test/property-run-configuration.test.ts` proves the run count reaches fast-check; the CE3 record shows the job failing on a planted parser bug that no example based test caught.

## 2. `skipLibCheck` is on

- **Rule:** datum 0.10: build clean under the strictest setting the language offers.
- **Done instead:** `tsconfig.json` sets `skipLibCheck: true`, so TypeScript does not check the declaration files of dependencies. Every source file of the family is still checked in full under `strict`.
- **Why:** msw 3.0.3's declarations (through `@mswjs/interceptors`) name DOM types such as `RequestInfo`, `BodyInit` and `MessageEvent`, which a Node.js only `lib` does not define, giving 20 errors inside `node_modules`. The alternative, adding the `DOM` lib, would let browser globals typecheck in Lambda code.
- **Author's decision:** accepted, 18 October 2026 ("skipLibCheck is fine").
- **Covering test:** a planted type error in `packages/test-doubles/src` fails `npm run typecheck` (CE2 and CE3 records).

## 3. Nothing is deployed

- **Rule:** Spec 00 §5.2, CD3, and the deployed phases Spec 01 EE4 and EE5, Spec 02 RE6 and Spec 03 WE9, written for stages deployed to AWS.
- **Done instead:** the family is built as Lambda functions and CDK stacks and synthesised for every stage, but runs locally: mock providers as local servers, handlers invoked directly with the shared event builder, the gateway covered by synth assertions. Gateway behaviour that nothing local can exercise (the 401 responses, CORS preflight, throttling, the JWT authoriser itself) is unverified, and each owner's Plan stage lists it here as it is reached.
- **Why:** the author's decision to run entirely locally.
- **Author's decision:** CQ6, 18 October 2026, in the author's words: "for AWS we will build knowing it's going to be there and using lambdas but we will run entirely locally."
- **Covering test:** the synth assertions in `infra/test`; the stream specific coverage is added in each stream's phases. For Spec 02, `infra/test/read.spec.ts` (RE6) runs the read entry point against the local mock providers; it runs TypeScript source on the local Node.js rather than the bundle on the Lambda runtime, and stubs Secrets Manager, so IAM, the network to the providers and tracing are unverified.

## 4. CU4 is answered without its experiment

- **Rule:** datum Stage one: a question a real experiment can answer is answered by running it, never by reading documentation alone.
- **Done instead:** how API Gateway renders the `scope` claim to a handler is not observed. `readAuthenticationContext` reads both renderings the documentation leaves open, a space separated string and a list, each held to the same bound and grammar.
- **Why:** the experiment needs a deployed stack, and nothing is deployed (entry 3).
- **Author's decision:** CQ2 and CQ6, 18 October 2026.
- **Covering test:** `packages/contracts/test/authentication-context.test.ts`, which reads both renderings and refuses each out of bound form.

## 5. CE5 does not wire `DemoApi`

- **Rule:** Spec 00 CE5, Work: `infra/bin/app.ts` wiring `DemoApi`, the stubs and the alarm topic for every stage.
- **Done instead:** CE5 wires the alarm topic and the stubs; `DemoApi` is wired once Spec 01 EE1 exists, as a Spec 00 change.
- **Why:** `DemoApi` is EE1's construct, and EE1 depends on CE5 (Spec 00 §5.5), so it cannot exist when CE5 is built.
- **Author's decision:** accepted, 18 October 2026 (CQ9): wire `DemoApi` after EE1.
- **Covering test:** none yet; the synth assertions for the wiring come with the Spec 00 change.

## 6. The toolchain departs from §2.1's candidates

- **Rule:** Spec 00 §2.1 GUIDANCE: Node.js 22 LTS, candidates to be settled at the Plan stage.
- **Done instead:** Node.js 24 (`nodejs24.x`, local 24.22.0, CI also 24.21.0); and `tsx` added to run the TypeScript CDK app.
- **Why:** `nodejs22.x` is deprecated on 30 April 2027 (CU1). `tsx` is needed because Node.js type stripping cannot resolve the extensionless imports the workspaces use.
- **Author's decision:** CQ1 and CQ5, 18 October 2026; `tsx` is recorded in the CE5 dependency records.
- **Covering test:** the synth assertions that every function is `nodejs24.x`, and CI job 5's run on 24.21.0.

## 7. The RU15 latency gate is set aside

- **Rule:** Spec 02 RE6: the latency target RU15 (p95 below 800 ms for normal records at 20 requests a second for 2 minutes) is a further author gate.
- **Done instead:** no latency gate. RE6 runs locally against the local mock providers (RQ1), where a measured latency would describe neither a Lambda cold start nor a real network, so a number taken there could mislead.
- **Why:** nothing is deployed (entry 3).
- **Author's decision:** RQ2, 18 October 2026: set aside; RU15 stays in Spec 02 for a deployment.
- **Covering test:** none; the gate is absent by decision.

## 8. A provider holding nothing of a record does not withhold the ETag

- **Rule:** Spec 02 §4.2: emit an ETag only when every provider is `ok` or `not-modified`.
- **Done instead:** a provider answering `not-found` counts as complete too, so a record that some provider holds nothing of still gets an ETag. The safeguard: a conditional read is answered 304 only when the providers answering `not-modified` are exactly the providers in the client's ETag. If a provider in the client's ETag now answers `not-found`, the providers that answered `not-modified` are called again without `If-None-Match` and the read answers 200, so a 304 never hides a section that has gone.
- **Why:** read literally, a record held by fewer than all three providers could never be answered 304. §4.2's stated purpose, that a conditional request never hides a missing source, concerns providers that failed; `not-found` is not a failure (§3.3), and the safeguard keeps the purpose for it too.
- **Author's decision:** RQ4, 18 October 2026: option (b), with the safeguard.
- **Covering test:** `services/read/test/read-handler.test.ts`, the RQ4 rows (RE4).

## 9. Accepted commands are applied after a provider outage

- **Rule:** datum 0.17 item 10: never queue an event across a disconnection and replay it later.
- **Done instead:** a command accepted while its provider is down waits in the journal and the `commands` queue, and is applied when the provider answers again. Every attempt carries the same `Idempotency-Key` and the command's `If-Match`, so a command applied against a record that has since changed ends `CONFLICT` rather than overwriting it, and a repeat never applies twice. A command redriven after the provider's own replay window, whose first attempt did apply, ends `CONFLICT` too: it is never applied twice, but the state can report `CONFLICT` for a command that went through.
- **Why:** durable acceptance is the property the write path exists for (Spec 03 §2): a 202 means the command is kept.
- **Author's decision:** WD1, 18 October 2026: keep the design and record the deviation (Spec 03 §12's recommendation).
- **Covering test:** WE5: a command applied after its record changed ends `CONFLICT` with `attempts` of 1; five commands for one record apply in submission order.

## 10. Three AWS behaviours on the write path are unverified

- **Rule:** datum Stage one: a question a real experiment can answer is answered by running it; Spec 03 WU1 and WU18 name experiments.
- **Done instead:** not observed: how an HTTP API presents a request body (WU1); whether a visibility the worker sets survives Lambda handling the reported failure (WU16); what a function timeout on the last receive leaves (WU18). Each outcome is built to be safe: intake reads a plain or a base64 encoded body, bounding either before decoding (WQ4); if Lambda resets the visibility, a retry waits the queue's 120 s visibility timeout instead of its backoff; the operator actions accept an operation left `APPLYING`.
- **Why:** each needs a deployed stack, and nothing is deployed (entry 3).
- **Author's decision:** WQ2, 18 October 2026: option (a), record them as unverified.
- **Covering test:** WE2 (both body forms, each bound), WE5 (backoff set through the queue), WE7 (an `APPLYING` operation redriven and discarded).

## Not deviations

Recorded so they are not mistaken for one.

- `LICENSE` is the MIT text verbatim, and its quotation marks mark defined terms ("Software"): quotation, which datum 0.8 permits. The prose scan does not check quotation marks.
- Two test inputs from earlier phases (`resource-naming.test.ts`, `sections.test.ts`) were rebuilt from parts in CE3, because their literal double hyphens failed the new prose scan. The values tested are byte for byte the same.

## Pending

Spec 00 §2.5 names one further entry, to be written only if its decision accepts the departure: Spec 01 ED3 (the gateway's 401 body). Spec 03 WD1 became entry 9.
