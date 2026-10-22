# Axial — Quote & State Engine

A headless TypeScript API using Next.js, Zod, Prisma and PostgreSQL. It turns the supplied WhatsApp conversation into a draft sales quote and processes the four follow-up events, preserving state across restarts. Quotes contain catalog SKUs and quantities; pricing stays with the ERP.

## Run the pipeline

Requires Node 22.12+ within Node 22 and local PostgreSQL. On a fresh checkout:

```sh
npm ci
cp .env.example .env
# Set YOUR_LOCAL_USER in .env to your PostgreSQL role.
createdb -h 127.0.0.1 axial_quote_ingestion
npm run db:generate
npm run db:deploy
npm run dev
```

Preserve an existing `.env`. `db:deploy` applies local database migrations, including the four-product mock catalog; it does not deploy the application. The API binds to `127.0.0.1:3000`.

```sh
curl -sS http://127.0.0.1:3000/api/conversations/ingest -H 'Content-Type: application/json' --data-binary @examples/initial-conversation.json
for n in 1 2 3 4; do
  curl -sS http://127.0.0.1:3000/api/messages -H 'Content-Type: application/json' --data-binary @examples/event-$n.json
  curl -sS 'http://127.0.0.1:3000/api/quotes?customer=C-10029'
done
```

Initial quantities are frontlit 20, mesh 5 and vinyl 5. The events revise frontlit to 15, link Mario's chat, create a separate acrylic quote at 2, then revise acrylic to 4 from Mario's chat. Both final drafts link to both conversations. Quote IDs are generated; events 2–5 have synthetic IDs/timestamps around the brief's text.

## Data model and message routing

```text
Conversation 1 ── * Message
Quote        1 ── * QuoteLine * ── 1 CatalogItem
Quote        * ── * Conversation    via QuoteConversation
Quote        1 ── * QuoteActivity
QuoteActivity * ── * Message        via QuoteActivityMessage
```

The join table lets one chat feed several quotes and several chats feed one quote. Messages can exist before they are assigned. Activities record before/after changes and their source messages, available at `GET /api/quotes/{id}/history?customer=C-10029`. Customer-scoped foreign keys prevent links across customers; catalog foreign keys, unique quote/SKU pairs and positive-quantity constraints protect quote lines.

A new message is validated and checked for replay by message ID. Inside a customer-scoped transaction lock, routing examines **all draft quotes for that customer**, matching product references and quantity evidence. “No 20” identifies the frontlit line in event 1; “aparte” creates a new quote in event 3. In event 4, “los acrilicos” selects Q-002 even though Mario's chat previously linked only to Q-001. The chat records context but does not determine the target. Updates, chat associations, history and the replay response commit together. Multiple matches or stale revisions are held for review.

## When the customer says “mejor cancelalo”

With two open quotes, the system stores the message as `needs_clarification`, exposes both candidate quote IDs, and changes neither quote. A human reads `GET /api/unresolved?customer=C-10029` and explicitly selects a quote or dismisses the request. To cancel, POST `{"customer_id":"C-10029","action":"cancel_quote","quote_id":"<candidate>"}` to `/api/messages/{internalMessageId}/resolve`; use `"action":"dismiss"` without a quote ID to leave quotes unchanged. Ownership and draft status are rechecked before applying a cancellation and recording its source.

## Architecture and trade-offs

Deterministic rules handle the supplied vocabulary, both speaker directions and contextual quantity replies, avoiding model calls for simple work. Initial unqualified “lona” follows the brief's frontlit convention. An optional localhost OpenAI-compatible model can handle unresolved initial extraction through `LOCAL_LLM_URL` and `LOCAL_LLM_MODEL`. Its output must pass catalog, quantity and source-reference validation before persistence. These checks prevent invented SKUs; they cannot prove that a model understood the message correctly.

The bounded grammar keeps the exercise understandable and testable, but is not a general Spanish sales assistant. PostgreSQL transactions and an activity log provide durable state without event sourcing or a queue. Customer identity is trusted upstream input; production authentication and general review editing/reprocessing are outside this implementation.

At 1,000 conversations/day, average throughput alone does not justify distributed infrastructure. First measure burst traffic, messages per conversation, model latency/cost and the unresolved-review backlog. Keep inference outside database locks, add pagination as histories grow, and introduce a durable queue with retries if processing latency warrants it. Authentication, observability and broader language evaluation come before production use.

## Extra credit

- **Duplicate delivery:** resend `examples/event-4.json` to `/api/messages`; the same message ID replays its result without another mutation, while different IDs with identical text remain real requests.
- **Cancellation review:** send `examples/event-5.json` to `/api/messages`, then inspect `/api/unresolved?customer=C-10029` and resolve it explicitly using the endpoint above.

## Tests and AI use

Create the dedicated `axial_quote_ingestion_test` database and a `.env.test` containing its localhost `TEST_DATABASE_URL`. Apply migrations with `DATABASE_URL` set to that test URL, then run `npm test`. Integration tests clear only the dedicated test database; tests run sequentially.

The latest run passed **48 tests**: 30 unit and 18 PostgreSQL/API integration tests, covering every intermediate state, a fresh-process read, history, isolation, rollback and both extras. API tests call route handlers directly; a running HTTP server, build and live model were not verified. See [the requirements audit](REQUIREMENTS_AUDIT.md) for detailed evidence.

AI assistance was substantial: Codex helped analyze the brief, explore the design, write the extraction prompt and implementation, and create tests and documentation. Development proceeded through user-directed stages followed by implementation and testing. Tests and static review exposed defects in transaction writes, replay comparison and parser ambiguity, which were corrected. Generated code and mocked model responses do not establish general language accuracy; that remains a limitation requiring broader evaluation.
