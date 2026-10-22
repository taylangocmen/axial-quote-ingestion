# Axial local implementation report

Completed October 22, 2026. Scope: the headless assignment pipeline and both optional extras, implemented and tested locally. No application deployment, remote database access, live hosted model calls, Git push, or new commit was performed.

## Delivered behavior

| Requirement | Implementation and evidence |
| --- | --- |
| Initial conversation to draft | Ingestion reads both directions and returns frontlit 20, mesh 5, vinyl 5. Unit and DB tests verify the exact initial state and four source-message references for contextual vinyl extraction. |
| Event 1 revision | Frontlit becomes 15; mesh and vinyl remain 5. Intermediate-state assertion passes. |
| Event 2 cross-chat inquiry | Mario is linked to the first quote without line changes. Intermediate-state assertion passes. |
| Event 3 separate quote | Acrylic creates a second quote at quantity 2, associated with Alice's chat. |
| Event 4 cross-chat revision | Acrylic becomes 4 and Mario is linked to the second quote. The first quote remains unchanged. |
| Durable state | PostgreSQL stores all state; a separate Node process reads the final state exactly. |
| Valid catalog only | Application validation plus catalog foreign keys reject unknown SKUs; DB constraint tests pass. |
| Data model and history | Eight models, many-to-many conversation links, customer-scoped foreign keys, source-linked before/after activities. History endpoint verified. |
| Ambiguous cancellation | Stored for review with both candidates, with no quote mutation. Human selection or dismissal is available through a local API. |
| Duplicate delivery | Same ID returns the original result without another mutation or audit entry. Changed payload conflicts; distinct IDs remain distinct events. Concurrent same-customer duplicate delivery also passes. |
| README | Setup, example sequence, model diagram, event 4 walkthrough, ambiguity policy, scaling, trade-offs, and AI-use disclosure included. |

## Local database and setup

- Reused the already running PostgreSQL service on 127.0.0.1:5432; did not start or stop that shared service.
- Created dedicated `axial_quote_ingestion` and `axial_quote_ingestion_test` databases.
- Installed project/test dependencies after explicit permission; saved `package-lock.json`.
- Generated Prisma Client and successfully applied all nine migrations to each database.
- Kept one migration per model, ordered by foreign-key dependencies; the last migration inserts the four supplied catalog items.
- Removed the old seed script and duplicate TypeScript catalog data.
- Development DB contains the four catalog products and no quotes. Integration fixtures were exercised in the separate test DB only.
- Local `.env` and `.env.test` files and the test log are ignored by Git.

## Verification

Final command: `npm test` using Node 22.18.0 and the native Node test runner through tsx, with test concurrency set to one.

**48 tests passed, 0 failed, 0 skipped:** 30 unit tests and 18 PostgreSQL/API integration tests. Final aggregate execution took approximately 1.4 seconds in the local environment. Raw TAP output is in `output/test-results.log`.

Coverage includes input/output contracts, invalid quantities and provenance, unknown and duplicate SKUs, the supplied Spanish conversation, changed quantities beyond the fixture, unsupported dimensions/products, partial requests, routing ambiguity, the local-model adapter's payload and error paths, every intermediate quote state, process-independent persistence, customer isolation, database constraints, rollback, late messages, duplicates, human resolution, and real route-handler Request/Response contracts.

Tests were added incrementally and rerun after fixes. Failures exposed a Prisma nested-write issue with shared composite foreign-key fields and an idempotency comparison that depended on JSON property order. Those were corrected by explicitly inserting source associations inside the transaction and canonicalizing request hashes. Review also found unsupported extra items could be ignored by the local parser; new regressions now require clarification. The width-alternative parsing regression introduced during that fix was caught and corrected before the final passing run.

## Final review and limits

The final static review covered model/migration consistency, transaction boundaries, catalog enforcement, customer scoping, event replay, provenance, route contracts, local configuration, and the example sequence. No known unresolved defect prevents the documented assignment sequence or tested optional extras from working.

The interpreter's deterministic grammar is deliberately bounded. It recognizes the brief's product vocabulary and conversational patterns; it is not a general Spanish sales assistant. Unsupported or ambiguous requests enter review. The agreed prompt is implemented in the optional localhost model adapter, called only when rules cannot complete extraction. Its transport and output checks were tested with controlled responses; no local model was provisioned or called, so live-model quality remains unmeasured. General language robustness cannot be inferred from these tests.

API tests invoke route handlers directly. A Next.js HTTP server, production build, lint, and standalone typecheck were not run: the explicit runtime authorization covered tests and local database setup. No temporary server or watcher was left running. The existing PostgreSQL service remains running.

The local API trusts the supplied customer identity and explicit human-resolution requests. Production authentication, a review UI, general unresolved-request editing/reprocessing, exhaustive out-of-order reconciliation, pagination, and operational telemetry are not implemented. The README explains these trade-offs and the next scaling priorities. Changes remain local and uncommitted for review.

## Follow-up requirements audit

Rechecked every section of the five-page brief; the detailed mapping is in `REQUIREMENTS_AUDIT.md`. Added seven regression/acceptance tests. Fixed negative availability being accepted as confirmation, unsupported extra items being omitted from separate requests, and multiple revisions being reduced to the first quantity. The exact initial response and full stored state after each of the four separate API calls now have explicit acceptance assertions. Both optional extras remain covered. GitHub submission is outstanding; no commit or push was performed.
