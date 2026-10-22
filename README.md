# Axial — Quote & State Engine

A headless TypeScript API using Next.js, Zod, Prisma and PostgreSQL. It turns the supplied WhatsApp conversation into a draft sales quote and processes the four follow-up events, preserving state across restarts. Quotes contain catalog SKUs and quantities; pricing stays with the ERP.

## Run the pipeline

Requires Node 22.12+ within Node 22 (`.nvmrc` selects 22) and a running local PostgreSQL server; development used PostgreSQL 17. Run commands from the repository root. On a fresh checkout:

```sh
npm ci
cp .env.example .env
```

Preserve an existing `.env`. Before continuing:

- Set `DATABASE_URL` to your local PostgreSQL connection, replacing `YOUR_LOCAL_USER` with your database role and adding a password if required. The template uses `127.0.0.1:5432`; the role must be able to create the database and its tables.
- Uncomment and set `LLM_PROVIDER`, `LLM_MODEL` and `LLM_API_KEY` using [LLM setup](LLM_SETUP.md). These are commented out in the template; without a configured provider, new requests are held for review instead of producing quotes.

Use the same PostgreSQL role, host and port for database creation (replace `YOUR_LOCAL_USER` below):

```sh
createdb -h 127.0.0.1 -p 5432 -U YOUR_LOCAL_USER axial_quote_ingestion
npm run db:generate
npm run db:deploy
npm run dev
```

Skip `createdb` if the database already exists. `db:deploy` applies local database migrations, including the four-product mock catalog; it does not deploy the application. The API binds to `127.0.0.1:3000` and has no homepage. Keep the server running and execute the following in a second terminal. `GET /api/health` checks server liveness; `GET /api/catalog` checks database access and should return four catalog items.

```sh
curl -sS http://127.0.0.1:3000/api/conversations/ingest -H 'Content-Type: application/json' --data-binary @examples/initial-conversation.json
for n in 1 2 3 4; do
  sleep 60 # Space hosted model calls to reduce rate-limit pressure.
  curl -sS http://127.0.0.1:3000/api/messages -H 'Content-Type: application/json' --data-binary @examples/event-$n.json
  curl -sS 'http://127.0.0.1:3000/api/quotes?customer=C-10029'
done
```

Initial quantities are frontlit 20, mesh 5 and vinyl 5. The events revise frontlit to 15, link Mario's chat, create a separate acrylic quote at 2, then revise acrylic to 4 from Mario's chat. Both final drafts link to both conversations. Quote IDs are generated; events 2–5 have synthetic IDs/timestamps around the brief's text.

The fixtures use fixed IDs: sending them again replays saved responses, including any earlier unresolved result. For a fresh evaluation after changing configuration or prompts, use the [live evaluation scripts](LLM_SETUP.md#running-live-evaluations), which generate isolated IDs. If a request needs clarification, inspect `/api/unresolved?customer=C-10029` before continuing the sequence.

## Data model and message routing

```text
Conversation 1 ── * Message
Quote        1 ── * QuoteLine * ── 1 CatalogItem
Quote        * ── * Conversation    via QuoteConversation
Quote        1 ── * QuoteActivity
QuoteActivity * ── * Message        via QuoteActivityMessage
```

The join table lets one chat feed several quotes and several chats feed one quote. Messages can exist before they are assigned. Activities record before/after changes and their source messages, available at `GET /api/quotes/{id}/history?customer=C-10029`. Customer-scoped foreign keys prevent links across customers; catalog foreign keys, unique quote/SKU pairs and positive-quantity constraints protect quote lines.

A new message is validated and checked for replay by message ID. Inside a customer-scoped transaction lock, the LLM receives the message, catalog and **all draft quotes for that customer**, and proposes a create, revise, inspect or clarify action. Code validates the action, catalog SKU, target quote/line and quantity before applying it. “No 20” identifies the frontlit line in event 1; “aparte” creates a new quote in event 3. In event 4, “los acrilicos” selects Q-002 even though Mario's chat previously linked only to Q-001. The chat records context but does not determine the target. Updates, chat associations, history and the replay response commit together. The prompt requires clarification for ambiguous matches; code independently holds stale revisions for review. Structural checks cannot establish semantic certainty.

## When the customer says “mejor cancelalo”

With two open quotes, the system stores the message as `needs_clarification`, exposes both candidate quote IDs, and changes neither quote. A human reads `GET /api/unresolved?customer=C-10029` and explicitly selects a quote or dismisses the request. To cancel, POST `{"customer_id":"C-10029","action":"cancel_quote","quote_id":"<candidate>"}` to `/api/messages/{internalMessageId}/resolve`; use `"action":"dismiss"` without a quote ID to leave quotes unchanged. Ownership and draft status are rechecked before applying a cancellation and recording its source.

## Architecture and trade-offs

Every new initial conversation and inbound follow-up is interpreted by the configured LLM. There are no keyword or regex extraction/routing shortcuts. Select Groq, OpenAI, Claude, or a compatible endpoint through `LLM_PROVIDER`, `LLM_MODEL` and `LLM_API_KEY` in `.env`; see [LLM setup](LLM_SETUP.md). Initial output must pass catalog, quantity and source-reference validation; follow-up actions must target eligible customer quotes and existing lines. Failed or unresolved interpretations enter review without partial mutations. These checks prevent invented SKUs and invalid targets, but cannot prove the model understood the message correctly.

This trades additional latency, cost and model variability for less dependence on handwritten language patterns. Duplicate deliveries return saved results and outbound follow-ups are recorded without inference. PostgreSQL transactions and an activity log provide durable state without event sourcing or a queue. Initial inference happens outside the transaction; follow-up inference currently holds the customer lock so the model sees the state being updated (20-second model timeout, 30-second transaction timeout). This serializes slow requests for the same customer. Customer identity is trusted upstream input; production authentication and general review editing/reprocessing remain outside scope.

At 1,000 conversations/day, average throughput alone does not justify distributed infrastructure. First measure burst traffic, messages per conversation, model latency/cost and the unresolved-review backlog. Move follow-up inference outside database locks with version checks and retry on concurrent changes, add pagination as histories grow, and introduce a durable queue with retries if processing latency warrants it. Authentication, observability and broader language evaluation come before production use.

## Extra credit

- **Duplicate delivery:** resend `examples/event-4.json` to `/api/messages`; the same message ID replays its result without another mutation, while different IDs with identical text remain real requests.
- **Cancellation review:** send `examples/event-5.json` to `/api/messages`, then inspect `/api/unresolved?customer=C-10029` and resolve it explicitly using the endpoint above.

## Tests and AI use

For unit/provider/routing tests only, run `npm run test:unit`; these need neither PostgreSQL nor a live LLM. For the full suite, create `.env.test` with the following line, replacing the role and adding a password if your local server requires one:

```dotenv
TEST_DATABASE_URL="postgresql://YOUR_LOCAL_USER@127.0.0.1:5432/axial_quote_ingestion_test?schema=public"
```

Then create and migrate the dedicated test database using the same connection details:

```sh
createdb -h 127.0.0.1 -p 5432 -U YOUR_LOCAL_USER axial_quote_ingestion_test
DATABASE_URL='postgresql://YOUR_LOCAL_USER@127.0.0.1:5432/axial_quote_ingestion_test?schema=public' npm run db:deploy
npm test
```

Skip creation if it already exists. The migration command overrides the development URL for that command only; Prisma does not automatically load `.env.test`. Integration tests load `TEST_DATABASE_URL` from `.env.test`, require the exact local database name above, and clear its quote/conversation data between cases. Tests run sequentially with mocked LLM responses and do not require a running API server or real provider key.

The last executed automated suite passed **50 tests**: 30 unit/provider/routing tests and 20 PostgreSQL/API integration tests using mocked model responses. A fresh live Groq evaluation passed five Phase 1 cases and eight full-sequence checks, including all four events, duplicate delivery, cancellation ambiguity and a paraphrased revision. Human cancellation and persistence across an actual server restart also passed. Live model calls were one minute apart; no rate-limit errors occurred. Mocked tests and limited live examples do not establish general language accuracy. See [LLM setup](LLM_SETUP.md#running-live-evaluations) to repeat the live evaluations.

The subsequent code-quality refactor adds HTTP body-limit and review-queue regression tests; the updated suite has not yet been run.

AI assistance was substantial: Codex helped analyze the brief, explore the design, write the extraction prompt and implementation, and create tests and documentation. Development proceeded through user-directed stages followed by implementation and testing. Tests and static review exposed defects in transaction writes, replay comparison and parser ambiguity, which were corrected. Generated code and mocked model responses do not establish general language accuracy; that remains a limitation requiring broader evaluation.
