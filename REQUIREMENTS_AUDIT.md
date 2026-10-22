# Requirements audit

Checked October 22, 2026 against all five pages of `[Axial] Quote Ingestion & State Management Challenge .pdf` and the local implementation. All specified pipeline behaviors and both optional extras are implemented and covered by passing tests. Repository submission is still outstanding. This is a bounded assignment implementation, not proof of general natural-language accuracy.

## Requirement-by-requirement evidence

| Brief requirement | Result and evidence |
| --- | --- |
| Headless clean API; no UI; SKUs and quantities, no pricing | Implemented through conversation ingestion, message ingestion, quote reads, history and review endpoints. Route-handler tests exercise Request/Response contracts. No pricing or UI added. |
| Four-product mock catalog | Final migration inserts the four exact SKU/description pairs. `catalog migration inserts exactly the required four products` checks the actual PostgreSQL rows. |
| Initial WhatsApp input, including both directions | Rules read all four messages. Unit tests verify contextual extraction and source indexes. API acceptance checks the initial response: `Oferta_de_Venta`, draft, Alice's chat, frontlit 20, mesh 5, vinyl 5. |
| Scattered vinyl product, dimensions and quantity | Product request, rep availability and customer quantity are combined. The 1.50-width alternative does not create a line or unresolved request for the supplied example. Evidence references all four contributing messages. |
| Four events as separate calls; correct state after each | `PDF acceptance: exact API quote state after initial ingestion and each separate event` invokes each POST separately and checks the entire GET response after each call. Generated quote IDs are allowed by the brief. |
| Event 1: frontlit 20 → 15 only | Exact state assertions preserve mesh and vinyl at 5. History records old/new quantities and event 1 as source. |
| Event 2: Mario's chat links to Q-001 without line changes | Exact state assertions check both chats, unchanged lines and source-linked association history. |
| Event 3: separate acrylic quote at 2 | A second draft is created with the supplied acrylic SKU and Alice's chat; Q-001 remains unchanged. |
| Event 4: acrylic 2 → 4 across chats | Content selects Q-002 even though Mario was linked only to Q-001. Final state checks both quotes linked to both chats, with all required quantities. |
| State survives calls and process restart | PostgreSQL persistence; the sequence test starts a fresh Node process that reads the final state and compares it exactly. |
| Human-readable change/source history | QuoteActivity and QuoteActivityMessage store changes and source messages atomically. History API tests inspect before/after values and evidence. |
| Deterministic logic versus LLM cost | Rules handle the supplied sequence; a test proves simple extraction makes no model call. Optional localhost model fallback is limited to unresolved initial extraction. README explains the choice. |
| No invented catalog SKUs | Interpreter schema checks catalog membership; database foreign keys protect stored lines. Tests reject hallucinated output and invalid direct database inserts. |
| Many-to-many quote/conversation model | QuoteConversation joins quotes and conversations. The complete sequence demonstrates both directions of the relationship. Customer-scoped foreign keys and isolation tests protect boundaries. |
| Routing walkthrough and model sketch in README | Both present. Routing examines all customer drafts and product/quantity evidence; chat membership does not restrict candidates. Additional tests cover multiple acrylic candidates without guessing. |
| Ambiguous “mejor cancelalo” policy | README explains holding the message without mutations and requesting explicit selection. Test checks both candidate IDs and unchanged quote state. |
| Optional duplicate delivery | Replaying event 4 returns the stored result without changing lines, links, messages or history. Tests also cover concurrent replay, conflicting payloads and distinct IDs with identical text creating distinct requests. |
| Optional visible cancellation review | Unresolved API exposes the message and candidates. Explicit human cancellation/dismissal endpoints are tested, including idempotent resolution. No UI is required by the brief. |
| README architectural trade-offs and 1,000 conversations/day | Included: bounded grammar, customer transaction locks, inference outside locks, pagination, measurement, retries, authentication and observability priorities. |
| README honest AI-use paragraph and optional-extra instructions | Included, with tested-versus-unverified limitations and example commands for both extras. |
| Send a GitHub repository | Outstanding. Implementation is local and uncommitted; nothing was pushed or submitted. This follows the user's local-only scope. |
| 48-hour / approximately six active-hour timebox; 80/20 execution | Process guidance, not a software acceptance test. This audit cannot certify total active time. No further architecture or UI was added for the audit. |

## Gaps corrected during this audit

1. Negative outbound availability could be mistaken for confirmation. It now leaves the product unresolved; no partial draft is persisted.
2. A separate request containing an unknown extra item could silently create only its recognized item. Separate requests now reuse the extraction validator and require a fully resolved single product.
3. Multiple quantity revisions in one message could select the first revision. They now require clarification before any change.

Seven new tests cover these cases, exact API acceptance across the entire sequence, and distinct repeat requests that create later routing ambiguity.

## Verification and limits

`npm test` passed **48 tests: 30 unit and 18 PostgreSQL/API integration tests**, with zero failures or skipped tests. Tests ran sequentially against the dedicated local test database. Raw output: `output/test-results.log` (ignored by Git).

The API tests call real route handlers directly; they do not exercise a running Next.js HTTP server. No build, standalone typecheck, lint, browser or deployment was run. The optional model adapter uses controlled responses in tests; no live model was evaluated. The initial grammar and follow-up routing are intentionally bounded to the assignment vocabulary and supported patterns. The tests establish the documented scenarios and regressions, not comprehensive language understanding. Production authentication, general review editing/reprocessing and operational tooling remain outside this assignment scope.
