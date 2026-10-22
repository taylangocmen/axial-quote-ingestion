# Configuring an LLM

Every new initial conversation and inbound follow-up uses the configured LLM. There is no pattern parser or fallback mode; the old `LLM_MODE` setting is no longer used. Replayed messages return their saved responses and outbound follow-ups are recorded without inference. Catalog/quantity/source validation and eligible-quote checks remain deterministic. Missing configuration or invalid/failed model output leaves messages for review without quote mutations.

## Groq free tier

Groq is the hosted inference service; Grok is xAI's different product.

1. Sign up at [Groq Console](https://console.groq.com).
2. Create an API key at [API Keys](https://console.groq.com/keys). Keep it in your local `.env`, which Git ignores.
3. Choose an available text model from [Groq's models](https://console.groq.com/docs/models) that supports JSON mode. Check your account's [free-plan limits](https://console.groq.com/docs/rate-limits); availability and quotas vary by model.
4. Add the following to `.env`, replacing both placeholders, then restart the application when running:

```dotenv
LLM_PROVIDER=groq
LLM_MODEL=YOUR_GROQ_MODEL_ID
LLM_API_KEY=YOUR_GROQ_API_KEY
```

The endpoint is selected automatically. No SDK installation or model download is needed. Stay on the free plan for free-tier use; this configuration does not create an account, enable billing or grant additional quota. The original assignment conversation calls the model on its first ingestion. Use fresh customer/conversation IDs when repeating a live evaluation; an already-ingested history replays its stored result.

## Switching providers

Change provider, model and key together in `.env`; no application code changes are needed for these supported APIs:

| `LLM_PROVIDER` | Model/key | Endpoint |
| --- | --- | --- |
| `none` | Not needed | No inference; new messages require review |
| `groq` | Groq model ID and Groq API key | Automatic |
| `openai` | OpenAI Chat Completions model ID and OpenAI API key | Automatic |
| `anthropic` | Claude model ID and Anthropic API key | Automatic, native Messages API |
| `openai-compatible` | Provider model ID and API key | Set `LLM_URL` to the full HTTPS chat-completions endpoint |
| `local` | Local model ID; optional key | Set `LLM_URL` to the full localhost endpoint |

For example, OpenAI uses `LLM_PROVIDER=openai`; Claude uses `LLM_PROVIDER=anthropic`. Both also require `LLM_MODEL` and `LLM_API_KEY`. Their API billing is separate from consumer chat subscriptions. A key alone cannot select the provider or model reliably.

For another OpenAI-compatible service:

```dotenv
LLM_PROVIDER=openai-compatible
LLM_MODEL=YOUR_MODEL_ID
LLM_API_KEY=YOUR_API_KEY
LLM_URL=https://your-provider.example/v1/chat/completions
```

The service must support bearer authentication, system/user chat messages and `response_format: {"type":"json_object"}`. Arbitrary APIs are not automatically compatible: services with different authentication or request formats need another adapter. Named providers ignore `LLM_URL` and use their fixed endpoints. Remote endpoints require HTTPS and redirects are rejected. Calls time out after 20 seconds; Claude responses are capped at 4,096 output tokens. Truncated responses are rejected.

Legacy `LOCAL_LLM_URL` and `LOCAL_LLM_MODEL` remain supported when `LLM_PROVIDER` is unset. An explicit `LLM_PROVIDER=none` disables the model even if legacy variables exist. Credentials and configuration stay on the server. Hosted inference sends the initial conversation and catalog, or a follow-up message with catalog and current customer drafts, to the selected provider; the application and database still run locally.

## Verification status

Mocked tests cover provider authentication, payloads, mandatory inference, output validation and persistence. They have been updated for LLM-only extraction and routing but not run. They are not language evaluations.

Before removing the pattern parser, a live HTTP check on October 22, 2026 explicitly forced Groq `openai/gpt-oss-120b`: the exact assignment conversation text (under isolated customer/chat IDs) returned HTTP 200 with frontlit 20, mesh 5, vinyl 5, and a subsequent GET confirmed persistence. Groq request ID: `req_01m5hvdczbe7s9p6b58prmj7rx`. That earlier check covered Phase 1 only; the subsequent Phase 2 live evaluation is recorded below. Other providers have not been live-tested; the original 48-test result predates these changes.

API references: [Groq](https://console.groq.com/docs/openai), [OpenAI](https://developers.openai.com/api/reference/resources/chat), [Claude](https://platform.claude.com/docs/en/api/messages/create).

## Phase 1 prompt regression evaluation

The prompt now explicitly distinguishes availability inquiries from purchase requests, with generic contrasting examples and a final check of every unresolved item's evidence. No product-specific pattern parser was reintroduced.

On October 22, 2026 the final live evaluation against Groq `openai/gpt-oss-120b` passed **5/5 cases** through the running HTTP API:

- Three independent calls with the exact assignment conversation: frontlit 20, mesh 5, vinyl 5, with saved state verified by GET.
- Paraphrased conversation with changed quantities: frontlit 7, mesh 3, vinyl 2, with saved state verified.
- Explicit additional order for three rolls of the unavailable 1.50 m width: held for clarification mentioning that width, with no partial quote saved.

The first prompt revision passed 4/5 cases; one original example still misinterpreted the availability inquiry. A later batch encountered provider 429 responses, so the final batch spaced calls 15 seconds apart and passed all five. This small evaluation demonstrates these cases, not guaranteed model reliability. The full unit/integration suite was not run in that check; the subsequent Phase 2 live evaluation is recorded below.

To repeat deliberately against a running local server: `node --import tsx scripts/evaluate-phase1.ts`. This makes five real model calls and creates isolated development records under fresh `eval-*` customer IDs; it is not part of `npm test`. The latest detailed results are written to `/tmp/axial-phase1-evaluation.json`.

## Phase 2 live evaluation

On October 22, 2026, `scripts/evaluate-phase2.ts` completed **8/8 HTTP checks** against Groq `openai/gpt-oss-120b`, using isolated customer `phase2-eval-17c053de`:

1. Bootstrap: expected three-line draft (20, 5, 5).
2. Event 1: frontlit 20 → 15, all other lines unchanged.
3. Event 2: Mario's chat associated with Q-001, no line changes.
4. Event 3: separate acrylic quote at 2, linked to Alice.
5. Event 4: acrylic 2 → 4 from Mario's chat, both quotes linked to both chats.
6. Duplicate event 4: identical saved response, unchanged quote state and history, no new model call.
7. Ambiguous cancellation: both candidates visible in the review queue, unchanged quote state and history.
8. Different wording with written-out "siete": acrylic becomes 7, original quote unchanged.

Stored state was checked after every step, with source-linked history checked for all four required events. Server logs confirmed seven successful Groq calls; duplicate delivery bypassed inference. There were no 429 responses in the final sequence. Each POST began at least 60 seconds after the preceding response (measured gaps: 60.001–60.023 seconds). GET verification requests do not invoke the model.

The first attempt failed Event 1 because the model ignored the explicitly stated old quantity when distinguishing two product-family matches. The prompt was clarified to combine product evidence with the old quantity before declaring ambiguity, with a generic example using other products and quantities. No phrase-specific parsing or SKU-specific routing branches were added. Expected fixture values exist only in evaluation assertions.

Repeat deliberately with `node --import tsx scripts/evaluate-phase2.ts` against a running local server. Both live evaluation scripts now wait one minute between test requests. Results are written to `/tmp/axial-phase2-evaluation.json`; failed first-attempt evidence was retained at `/tmp/axial-phase2-evaluation-first-pass.json`. This run verifies the listed scenarios, not general model accuracy; the revised unit/integration suite was not run as part of this live evaluation.
