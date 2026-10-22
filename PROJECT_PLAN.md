# Axial quote ingestion analysis and implementation plan

**Historical planning document.** The implementation now uses Next.js, TypeScript, Prisma, and local PostgreSQL. SQLite/Python suggestions below are superseded. See README.md for the current design and IMPLEMENTATION_REPORT.md for tested results.


Original analysis prepared October 21, 2026. Update: the first implementation milestone now uses a minimal Next.js + TypeScript + Zod + Prisma 6 / SQLite scaffold, following the subsequent discussion. Dependencies and runtime checks remain pending. The Python proposal and file layout below are retained as historical analysis, not the current implementation choice. See README.md for the current starter.

The original proposed approach was a small Python API with FastAPI, Pydantic, and file-backed SQLite. The chosen TypeScript starter preserves the central plan: build the quote state engine first using structured operations, then connect conversation extraction to it. Most of the engineering effort should go into selecting the correct quote, applying changes atomically, and explaining why each change happened.

Source: all five pages of `[Axial] Quote Ingestion & State Management Challenge .pdf` in this repository. Requirements below describe the assignment; proposed policies and architecture are our design choices. The document's submission instructions are not authorization to implement, publish, or send anything now.

## Repository starting point

The repository currently has a one-line README and the assignment PDF. There is no application, dependency manifest, database, or existing implementation to preserve. No repository-level AGENTS.md or AGENTS.override.md was found; the working agreements supplied in chat apply. The PDF was already untracked when inspected.

## What the assignment actually requires

The assignment allows 48 hours elapsed time and asks for approximately six hours or less of active work. It explicitly prioritizes Phase 2. We should avoid spending the budget on an elaborate extractor or infrastructure.

| Requirement | What must be demonstrated |
| --- | --- |
| Headless API | Accept the initial conversation and subsequent individual messages; expose stored quotes. No UI. |
| Conversation extraction | Combine inbound and outbound messages, including product, dimensions, and quantity supplied in different turns. |
| Catalog restriction | Only the four supplied SKUs can appear in quote lines. Pricing is excluded. |
| Durable state | Correct state after every call, surviving a process restart. |
| Multiple chats and quotes | A many-to-many relationship between conversations and quotes. |
| Content-based routing | Event 4 finds the acrylic quote by its content across the customer's quotes. |
| History | A human can inspect what changed and the source message. |
| Ambiguity policy | README explains how an unassignable message is handled without guessing. |
| Submission | GitHub repository and a concise README with model, routing walkthrough, ambiguity behavior, trade-offs, scaling, and honest AI-use disclosure. |

Duplicate delivery handling is the first optional extra. A human-visible unresolved-message workflow is the second. Neither should displace the required state engine.

## Exact acceptance sequence

| Step | Interpretation | Expected stored result |
| --- | --- | --- |
| Initial conversation | Create draft from the complete conversation | Q-001: frontlit 20, mesh 5, microperforated vinyl 5; linked to Alice's chat. |
| Event 1 | Set the frontlit quantity to 15 | Only that line changes; mesh and vinyl remain 5. |
| Event 2 | Mario asks about the existing lona quote | Link Mario's chat to Q-001; no line changes. |
| Event 3 | Alice requests a separate acrylic quote | Create Q-002 with acrylic 2 and link Alice's chat; leave Q-001 unchanged. |
| Event 4 | Mario revises Alice's acrylic request | Set Q-002 acrylic to 4 and link Mario's chat to Q-002; leave Q-001 unchanged. |
| Optional replay | Deliver event 4 again with the same message ID | No new mutation, audit entry, or association. |
| Ambiguous fifth message | “mejor cancelalo” | No quote mutation; require clarification or human selection. |

Final state: two draft quotes, each linked to both chats. Q-001 contains quantities 15, 5, 5; Q-002 contains quantity 4. IDs need not literally be Q-001 and Q-002.

## Pitfalls and decisions to make before coding

1. **A chat does not own a quote.** A single `quote_id` on a conversation or `conversation_id` on a quote cannot represent the examples. Use a join table. Even a correct join table is insufficient if routing searches only previously linked quotes.
2. **Product-family ambiguity needs evidence.** Both frontlit and mesh descriptions contain “Lona.” In event 1, “15, no 20” identifies the line previously at 20; matching the word “lona” alone is too weak. If several lines satisfy the evidence, stop for clarification.
3. **A question can change associations without changing quantities.** Event 2 must persist its link and provenance even though it is read-only with respect to quote lines.
4. **Separate versus additional matters.** “Aparte cotizame” explicitly requests a new quote. Do not append acrylic to Q-001 merely because Alice's chat is already linked to it. Do not generalize every occurrence of “aparte” into a new quote regardless of sentence context.
5. **Replacement and increment are different operations.** “Que sean 15” means set to 15, not subtract 15 or add 15. Represent intent explicitly rather than inferring it inside persistence code.
6. **Read both directions, but preserve speaker meaning.** The rep supplies available dimensions, not a purchase instruction. The final inbound quantity refers to that available product. An outbound suggestion by itself must not create an order line.
7. **The brief has a wording inconsistency.** Page 2 says “only 50 is available”; the chat says `1.37x50`, and the expected SKU is the 1.37 m width. Follow the explicit example and catalog: 1.50 m was discussed and resolved as unavailable, so it creates neither a line nor an unresolved issue in this scenario. Do not interpret 50 as width or quantity.
8. **A prompt is not a catalog constraint.** Use server-side catalog resolution and database foreign keys. An invented or unsupported SKU must never reach a persisted quote or quote response.
9. **Unknown and unavailable are not automatically equivalent.** An unsupported product in another request should be reported for clarification, not silently replaced with the nearest catalog item. The provided 1.50 m request is resolved because the conversation addresses it.
10. **Names are context, not identity.** Use the supplied `customer_id` for scope, not “ACME” or “Alice” in message text. Production identity verification is separate from this exercise.
11. **Message IDs, not text, define duplicate deliveries.** Two requests with identical text but different IDs are distinct events. Reusing an ID with different content should return a conflict rather than silently dropping data.
12. **Persistence must include the explanation.** Updating lines without retaining source messages, before/after values, and routing reasons fails the history requirement.
13. **Avoid guessing from recency.** “Mejor cancelalo” is ambiguous with two open quotes, even if one was updated most recently. No cancellation should follow from a model's self-reported confidence alone.
14. **Avoid designing for imaginary volume.** At 1,000 conversations per day, message bursts, model latency, retries, and ambiguity matter more than average throughput. Conversation count is not message count.

## Proposed starter and dependencies

| Choice | Reason |
| --- | --- |
| Python 3.12 or newer supported project baseline | Direct standard-library SQLite access and a compact implementation. Select an available interpreter when implementation begins. |
| FastAPI + Pydantic | Typed request/response contracts and nested conversation validation. |
| Uvicorn | Serve the headless HTTP API. |
| Standard-library `sqlite3` | File persistence, transactions, and constraints without a database service or ORM setup. |
| Small interpretation adapter | Deterministic parsing for supported clear cases; one bounded model call when language requires it. |
| Pytest + HTTPX, development dependencies | Focused state-transition and API checks when execution is explicitly authorized. |
| Provider SDK, only if using a live LLM | Optional narrow dependency; configure the model and API key through environment variables. |

FastAPI supports nested Pydantic request models ([official documentation](https://fastapi.tiangolo.com/tutorial/body-nested-models/)). SQLite foreign keys require explicit enabling on each connection ([official documentation](https://www.sqlite.org/foreignkeys.html)). These choices fit the proposed scope; they are not requirements in the brief.

Install later: `fastapi`, `pydantic`, and `uvicorn`; add `pytest` and `httpx` as development dependencies. Add the chosen provider SDK only after deciding to use a live model. Pin resolved versions and retain a reproducible dependency file. SQLite needs no Python package installation. Do not install anything during this planning pass.

If TypeScript is substantially faster for us to write, a small Fastify + Zod + SQLite service is an equally reasonable alternative. There is no evaluation benefit to learning a new stack here. The recommendation is Python for its small setup footprint, not because the domain requires it.

Avoid Next.js, a frontend, Docker, Redis, a queue service, a vector database, agent frameworks, and a production ERP integration for this submission. None is needed to prove the four transitions.

## Architecture and storage

Proposed flow:

```text
HTTP validation
  -> duplicate lookup
  -> load customer quotes and relevant conversation context
  -> interpret intent and product references
  -> resolve catalog items and target quote deterministically
  -> validate operation against current state
  -> transaction: message + lines + associations + audit + result
  -> response from committed state
```

Keep HTTP handlers thin. Separate interpretation, routing, state mutation, and SQL access into small modules. Use an explicit operation such as `create_quote`, `set_quantity`, `inspect_quote`, or `needs_clarification`. The model proposes meaning; the application owns IDs, routing validation, and writes.

| Table | Proposed contents and constraints |
| --- | --- |
| `catalog_items` | SKU primary key, description, structured product attributes; seed exactly the four supplied items. |
| `conversations` | Conversation ID, customer ID; reject attempts to reuse an existing chat under another customer. |
| `messages` | Internal ID, unique external message ID when supplied, conversation, direction, source timestamp, received timestamp, text, processing outcome, original response. |
| `quotes` | Quote ID, customer ID, draft status, revision number, creation/update timestamps. |
| `quote_lines` | Quote ID + SKU unique key; SKU foreign key to catalog; positive integer quantity for this exercise. |
| `quote_conversations` | Quote ID + conversation ID unique key; source message establishing the link. |
| `quote_changes` | Quote, source message, action, before/after values, routing reason, applied time. For bootstrap, retain all contributing message references. |

Relationships: conversations have messages; quotes have lines and changes; quotes and conversations connect through `quote_conversations`. A source message can be represented in multiple audit records. Enforce same-customer association checks in the transaction. Add customer/quote lookup indexes; keep the catalog immutable for the exercise.

Use a configurable database file path on persistent local storage, never `:memory:` for the running API. Enable foreign keys on every connection. Use parameterized SQL. Commit message outcome, quote changes, links, and audit entries together; rollback all of them if any write fails.

For this ordered-call exercise, start with one application worker. Still guard state-dependent writes: read candidate quotes with revisions, interpret outside the write transaction, then re-read candidates inside a short write transaction before applying. A changed candidate set or revision requires rerouting or a retryable response. An LLM network call must not hold the database write lock. SQLite allows only one simultaneous writer ([transaction documentation](https://www.sqlite.org/lang_transaction.html)).

Duplicate replay should return the previously recorded event result; `GET /quotes` returns current state. Use the unique external message ID inside the transaction to close the concurrent-delivery race. A failed transaction must not leave a message marked successfully processed.

## Quote routing and interpretation

For each event, first scope all candidates to `customer_id`. Use explicit quote references, referenced product attributes, operation intent, and relevant prior messages. Existing chat links help resolve context but do not restrict the candidate set. Require one supported target for a revision; zero or multiple targets produce clarification.

For event 4, search all of C-10029's draft quotes for the referenced acrylic item. Q-002 is the unique match, even though Mario's chat was linked only to Q-001. Validate the replacement quantity, update Q-002, and insert Mario's association in the same transaction. Record the product match and source message in history.

A deterministic fast path can handle explicit SKUs, unambiguous aliases and dimensions, explicit quantity replacements, and clear quote references. It should use a small catalog alias map and structured numeric extraction, not whole-message equality checks against the assignment. Normalize accents and case carefully while preserving decimal dimensions and negation. Ambiguous product families remain unresolved unless other evidence disambiguates them.

For language outside that grammar, a bounded LLM adapter may extract intent, product mentions, quantities, and supporting message references. Give it the small catalog and relevant context; validate every result. Never accept generated SQL, arbitrary quote IDs, or direct state writes. Conversation text is untrusted input, including instructions embedded inside it. Invalid outputs, refusals, timeouts, or unresolved products must leave quote state unchanged.

Do not rerun the full transcript through a model for every event. Duplicate checks, catalog membership, input validation, and straightforward operations are deterministic. Keep initial extraction intentionally modest. Preserve provenance for the three-message vinyl inference: customer product request, rep's available dimensions, customer's quantity.

A live model is a design choice, not an explicit requirement. Decide before implementation whether evaluator operation will require an API key. Recommended: a real bounded deterministic mode for the documented vocabulary, with an optional model fallback. A fixture adapter is useful for tests but must not be presented as general extraction. If dual-mode support threatens the budget, choose one honest, documented mode instead.

## Proposed API contract and unresolved assumptions

| Endpoint | Purpose |
| --- | --- |
| `POST /conversations/ingest` | Accept the supplied initial history shape and create the initial draft. |
| `POST /messages` | Accept a single event; return action, affected quote IDs, or clarification details. |
| `GET /quotes?customer=C-10029` | Return the expected quote shapes from persisted state. |
| `GET /quotes/{quote_id}/history` | Expose source messages and before/after changes. |

Malformed inputs return validation errors. Semantically ambiguous but valid messages return an explicit `needs_clarification` outcome with candidate IDs and a reason; they must not appear to have succeeded as revisions. Quote responses use only validated stored lines. Preserve `document_type: Oferta_de_Venta` on the initial quote response.

Proposed defaults to document before coding:

- The supplied customer ID is trusted upstream identity for this local exercise; every database lookup still enforces customer scope. No production authentication system is implied.
- Quantities are positive integers because the examples use rolls and pieces. Zero, negatives, fractions, or missing quantities require validation or clarification; zero does not silently mean cancellation.
- The initial history lacks message IDs. Assign internal IDs and keep sequence positions. If bootstrap retry protection is added, use a request idempotency key; do not pretend text hashing is webhook identity.
- Events 2–4 supply text and contextual descriptions rather than complete JSON envelopes. Prepare fixtures with distinct message IDs, the stated chats/customer, inbound direction, and explicitly synthetic chronological timestamps.
- Apply the supplied events in arrival order. Record source timestamps, but do not claim timestamp sorting solves delayed-message semantics. Late events that conflict with current state should be held for clarification; general out-of-order reconciliation is outside the core scope.
- Do not reset or reseed mutable quotes on server startup. Initialize only missing schema/catalog records.

For “mejor cancelalo,” persist an unresolved outcome and return both candidate quotes without changing either. Required scope is an honest README explanation. If time remains, expose unresolved messages through a read endpoint so a human can inspect them. A full resolution endpoint is a further feature: it would need explicit target/action selection, current-state validation, and an audited, idempotent application. Do not claim this workflow is implemented unless it actually is.

## Plan before Phase 1

The first work session should establish the state contract, not start with prompts or scaffolding a large app.

1. Freeze the acceptance table above as the definition of done, including intermediate states and restart persistence.
2. Choose Python or TypeScript based on implementation fluency; the baseline recommendation is Python.
3. Choose deterministic-only or deterministic-plus-model interpretation and document API-key expectations.
4. Agree on the proposed quantity, ambiguity, identity, bootstrap retry, and event-ordering assumptions.
5. Sketch the schema, operation types, and API responses. Prioritize the event 4 routing decision and its audit entry.
6. Only after implementation is requested, create the minimal project and install the agreed dependencies when installation is explicitly authorized.

Suggested initial layout, to create later:

```text
app/
  main.py          API routes and application wiring
  contracts.py     validated inputs, operations, and outputs
  interpretation.py
  routing.py
  service.py       state transition orchestration
  storage.py       schema, transactions, queries
  catalog.py       the four catalog entries and aliases
examples/         initial history and four event envelopes
tests/            transition and persistence scenarios
README.md
pyproject.toml
```

Do not create empty layers just to match the sketch. Merge modules if the implementation remains clearer that way.

## Proposed six-hour implementation budget

This is a ceiling including planning; subtract time already spent. The order deliberately implements the assignment's Phase 2 engine before its Phase 1 extraction.

| Work block | Budget | Exit condition |
| --- | --- | --- |
| Decisions and acceptance contract | 30 min | Stack, schema, examples, and ambiguity policy settled. |
| Minimal API and persistence | 40 min | File-backed database, catalog constraints, request contracts. |
| State engine and routing | 120 min | Structured operations reproduce all four events, links, and audit history. |
| Initial extraction and message interpretation | 55 min | Supplied Spanish conversation and events translate into validated operations. |
| Focused verification, when authorized | 45 min | Intermediate states, cross-chat routing, persistence, and key failure cases checked. |
| README and runnable examples | 40 min | Evaluator can install, run, inspect results, and understand trade-offs. |
| Contingency or optional extras | 30 min | Fix core issues first; then duplicate delivery; then visible unresolved messages. |

If time is tight, cut human-resolution actions, generalized multilingual extraction, advanced retry orchestration, and deployment work. Preserve customer isolation, catalog constraints, many-to-many relationships, event 4 routing, durable state, and auditability. Design the message uniqueness constraint early even if the optional replay behavior is finished later.

## Verification plan for the implementation stage

These checks are planned, not executed. The current working agreement requires explicit authorization to run tests, servers, or other resource-intensive verification.

- Assert the initial three lines and each of the four intermediate states, not just the final response.
- Close and reopen the database between calls; separately restart the actual API process when server execution is authorized.
- Confirm event 2 creates an association and audit trail without changing any quantity.
- Confirm event 4 routes outside Mario's existing quote links and preserves Q-001.
- Reject unknown SKUs at both service and database boundaries; do not serialize raw model proposals as quotes.
- Confirm another customer's quote cannot be selected or linked by an injected quote ID or a matching product name.
- Confirm an ambiguous cancellation changes no quote, line, or association.
- If duplicate handling is included, replay event 4 and a quote-creation event; assert no additional state or history. Distinct IDs with identical text must remain distinct messages.
- Confirm conflicting reuse of a message ID is rejected and a forced write failure rolls back the entire transition.
- Confirm extraction handles the rep-supplied dimensions and does not invent a 1.50 m SKU.
- Check model failure behavior only if that adapter exists; use controlled test doubles for routine tests.

## Scaling and submission narrative

At 1,000 conversations per day, first measure messages per conversation, burst concurrency, model latency/cost, unresolved-message rate, and retry rate. Bound context sent to the model and preserve reliable idempotency. Keep writes short. Add PostgreSQL when multiple workers or database contention justify it; add durable queued processing when asynchronous retries or provider latency justify it. Preserve per-customer ordering or concurrency checks across chats, since quotes cross conversation boundaries.

The final README should stay around one or two pages: setup and example calls; a small data-model sketch; event 4 routing walkthrough; ambiguous cancellation behavior; trade-offs and scaling; and an honest description of AI assistance and human validation. Clearly state implemented behavior versus future work, and include one line per optional extra explaining how to inspect it. Do not imply that model output or generated code was manually verified unless it was.

The next concrete milestone is a durable state engine that reproduces the initial quote and four transitions from structured operations. Once that is correct, language extraction becomes an adapter feeding a known contract.
