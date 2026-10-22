import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterpreter } from '../src/server/interpretation/interpreter';
import { llmOptionsFromEnv, resolveLlm } from '../src/server/interpretation/config';
import { catalog, initial } from './fixtures';

const history = [{ ...initial.conversation_history[0], text: 'Por favor prepara dos piezas del acrílico blanco de tres milímetros' }];
const output = { items: [{ sku: catalog[3].sku, quantity: 2, sourceMessageIndexes: [0] }], unresolved: [] };

for (const [provider, endpoint] of [
  ['groq', 'https://api.groq.com/openai/v1/chat/completions'],
  ['openai', 'https://api.openai.com/v1/chat/completions'],
  ['openai-compatible', 'https://example.com/v1/chat/completions'],
] as const) {
  test(`${provider} sends credentials and validates extraction through the shared contract`, async () => {
    const interpreter = createInterpreter({ provider, model: 'chosen-model', apiKey: 'test-key', url: endpoint, fetch: async (url, init) => {
      assert.equal(url, endpoint);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(init?.body as string);
      assert.equal(body.model, 'chosen-model');
      assert.equal(body.response_format.type, 'json_object');
      assert.equal(JSON.parse(body.messages[1].content).catalog.length, 4);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] });
    } });
    assert.equal((await interpreter(history, catalog)).status, 'ready');
  });
}

test('Claude uses its native Messages format and validates text output', async () => {
  const interpreter = createInterpreter({ provider: 'anthropic', model: 'chosen-claude-model', apiKey: 'test-key', fetch: async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-api-key'), 'test-key');
    assert.equal(headers.get('anthropic-version'), '2023-06-01');
    const body = JSON.parse(init?.body as string);
    assert.equal(typeof body.system, 'string');
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.messages[0].role, 'user');
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }] });
  } });
  assert.equal((await interpreter(history, catalog)).status, 'ready');
});

test('configuration supports explicit disabling and legacy local settings', () => {
  assert.equal(resolveLlm(llmOptionsFromEnv({ LLM_PROVIDER: 'none', LOCAL_LLM_URL: 'http://localhost:1234' })), undefined);
  assert.equal(resolveLlm(llmOptionsFromEnv({ LOCAL_LLM_URL: 'http://localhost:1234/v1/chat/completions', LOCAL_LLM_MODEL: 'local-model' }))?.provider, 'local');
  assert.equal(resolveLlm(llmOptionsFromEnv({ LLM_PROVIDER: 'groq', LLM_MODEL: 'model', LLM_API_KEY: 'key' }))?.provider, 'groq');
  for (const env of [
    { LLM_PROVIDER: 'unknown' }, { LLM_PROVIDER: 'groq', LLM_MODEL: 'model' },
    { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'key' },
    { LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'model', LLM_API_KEY: 'key', LLM_URL: 'http://example.com/v1/chat/completions' },
  ]) assert.throws(() => resolveLlm(llmOptionsFromEnv(env)));
});

test('provider failures, truncation and hallucinated SKUs fail closed', async () => {
  for (const provider of ['groq', 'anthropic'] as const) {
    const invalid = { ...output, items: [{ ...output.items[0], sku: 'invented' }] };
    const responses = provider === 'groq' ? [
      Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(output) } }] }),
      Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(invalid) } }] }),
    ] : [
      Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: JSON.stringify(output) }] }),
      Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(invalid) }] }),
    ];
    for (const response of [...responses, new Response('private provider details', { status: 429 })]) {
      const interpreter = createInterpreter({ provider, model: 'model', apiKey: 'key', fetch: async () => response });
      await assert.rejects(interpreter(history, catalog), error => error instanceof Error && !error.message.includes('private provider details'));
    }
  }
});

test('the exact assignment conversation always calls the model', async () => {
  let calls = 0;
  const interpreter = createInterpreter({ provider: 'groq', model: 'model', apiKey: 'key', fetch: async () => {
    calls++;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] });
  } });
  await interpreter(initial.conversation_history, catalog);
  assert.equal(calls, 1);
});

test('missing provider cannot silently parse with local patterns', async () => {
  await assert.rejects(createInterpreter()(initial.conversation_history, catalog), /Configure an LLM/);
});
