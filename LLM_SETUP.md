# Configuring an LLM

Every new initial conversation and inbound follow-up uses the configured LLM. Replayed messages return their saved responses and outbound follow-ups are recorded without inference. Catalog/quantity/source validation and eligible-quote checks remain deterministic. Missing configuration or invalid/failed model output leaves messages for review without quote mutations.

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

## Running live evaluations

With the local server running and `.env` configured, run these sequentially:

```sh
node --import tsx scripts/evaluate-phase1.ts
sleep 60
node --import tsx scripts/evaluate-phase2.ts
```

These scripts make real provider calls and create isolated development records with fresh customer IDs. They are separate from `npm test` and wait at least one minute between requests that may invoke the model.

- **Phase 1:** five cases covering the assignment conversation, changed wording/quantities, and an explicit request for an unavailable size. Results: `/tmp/axial-phase1-evaluation.json`.
- **Phase 2:** eight checks covering initial ingestion, all four events in order, duplicate delivery, ambiguous cancellation and a paraphrased revision. Results: `/tmp/axial-phase2-evaluation.json`.

The latest evaluation passed 5/5 Phase 1 cases and 8/8 Phase 2 checks using Groq `openai/gpt-oss-120b`. All 50 automated tests also passed with mocked model responses. Other providers have adapter tests but have not been live-tested. These examples do not establish general language accuracy; provider quotas and model responses can vary.
