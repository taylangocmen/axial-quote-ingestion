import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, validateRoute } from '../src/server/pipeline/routing';
import { catalog, events } from './fixtures';
const quotes = [
  { id: 'Q1', lines: [{ sku: catalog[0].sku, quantity: 20 }] },
  { id: 'Q2', lines: [{ sku: catalog[3].sku, quantity: 2 }] },
];

test('routing sends all customer quotes to the LLM and validates its selected target', async () => {
  let calls = 0;
  const route = createRouter({ provider: 'groq', model: 'test', apiKey: 'key', fetch: async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string);
    assert.deepEqual(JSON.parse(body.messages[1].content), { text: events[3].text, quotes, catalog });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ action: 'revise', quoteId: 'Q2', sku: catalog[3].sku, quantity: 4 }) } }] });
  } });
  assert.deepEqual(await route(events[3].text, quotes, catalog), { action: 'revise', quoteId: 'Q2', sku: catalog[3].sku, quantity: 4 });
  assert.equal(calls, 1);
});

test('model cannot invent a quote, line, SKU, quantity or automatic cancellation', () => {
  for (const value of [
    { action: 'inspect', quoteId: 'other-customer-quote' },
    { action: 'create', sku: 'invented', quantity: 1 },
    { action: 'create', sku: catalog[0].sku, quantity: -1 },
    { action: 'revise', quoteId: 'Q1', sku: catalog[3].sku, quantity: 4 },
    { action: 'revise', quoteId: 'Q1', sku: catalog[0].sku, quantity: 1.5 },
    { action: 'clarify', reason: 'unclear', candidates: ['invented'] },
    { action: 'clarify', reason: 'unclear', candidates: ['Q1', 'Q1'] },
    { action: 'cancel', quoteId: 'Q1' },
  ]) assert.throws(() => validateRoute(value, quotes, catalog));
});

test('ambiguous model output preserves every candidate without a mutation', () => {
  const decision = { action: 'clarify', reason: 'Which quote?', candidates: ['Q1', 'Q2'] };
  assert.deepEqual(validateRoute(decision, quotes, catalog), decision);
});
