import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteInputSchema } from '../src/server/quotes/schemas';
import { validateInterpretation } from '../src/server/interpretation/validate';
import { createInterpreter } from '../src/server/interpretation/interpreter';
import { INTERPRETATION_PROMPT } from '../src/server/interpretation/prompt';
import { ingestSchema, eventSchema } from '../src/server/pipeline/contracts';
import { initial, events, catalog, context } from './fixtures';

const good = () => ({ items: [{ sku: catalog[0].sku, quantity: 20, sourceMessageIndexes: [0] }], unresolved: [] });
test('structured interpretation is ready only after catalog and provenance validation', () => {
  assert.equal(validateInterpretation(good(), context).status, 'ready');
});
for (const quantity of [0, -1, 1.5, 2147483648, Infinity, '5']) {
  test(`reject invalid quantity ${quantity}`, () => {
    const value = good(); (value.items[0] as any).quantity = quantity;
    assert.throws(() => validateInterpretation(value, context));
  });
}
for (const indexes of [[], [-1], [4], [0, 0], [1.2]]) {
  test(`reject invalid provenance ${JSON.stringify(indexes)}`, () => {
    const value = good(); value.items[0].sourceMessageIndexes = indexes;
    assert.throws(() => validateInterpretation(value, context));
  });
}
test('unknown SKUs, extra fields, and repeated SKUs are rejected', () => {
  assert.throws(() => validateInterpretation({ ...good(), quote_id: 'invented' }, context));
  const unknown = good(); unknown.items[0].sku = 'UNKNOWN';
  assert.throws(() => validateInterpretation(unknown, context));
  const duplicate = good(); duplicate.items.push(duplicate.items[0]);
  assert.throws(() => validateInterpretation(duplicate, context));
});
test('partial and empty interpretations require clarification', () => {
  assert.equal(validateInterpretation({ ...good(), unresolved: [{ description: 'red acrylic', reason: 'not in catalog', sourceMessageIndexes: [0] }] }, context).status, 'needs_clarification');
  assert.equal(validateInterpretation({ items: [], unresolved: [] }, context).status, 'needs_clarification');
});
test('quote creation contract rejects empty identity, no lines, duplicate SKU and extra status', () => {
  const valid = { customerId: 'C1', lines: [{ sku: catalog[0].sku, quantity: 2 }] };
  assert.equal(createQuoteInputSchema.parse(valid).lines.length, 1);
  for (const value of [{ ...valid, customerId: ' ' }, { ...valid, lines: [] }, { ...valid, lines: [...valid.lines, ...valid.lines] }, { ...valid, status: 'approved' }]) assert.equal(createQuoteInputSchema.safeParse(value).success, false);
});
test('request contracts reject malformed timestamps, direction and out of order histories', () => {
  assert.equal(eventSchema.safeParse({ ...events[0], timestamp: 'yesterday' }).success, false);
  assert.equal(eventSchema.safeParse({ ...events[0], direction: 'system' }).success, false);
  assert.equal(ingestSchema.safeParse({ ...initial, conversation_history: [...initial.conversation_history].reverse() }).success, false);
});
test('model receives prompt, numbered history and catalog then validates output', async () => {
  const history = [{ ...initial.conversation_history[0], text: 'Por favor prepara lo acordado: dos piezas del acrílico blanco de tres milímetros' }];
  let calls = 0;
  const interpreter = createInterpreter({ url: 'http://localhost:1234/v1/chat/completions', model: 'test', fetch: async (_url, options) => {
    calls++;
    const body = JSON.parse(options!.body as string);
    assert.equal(body.messages[0].content, INTERPRETATION_PROMPT);
    const data = JSON.parse(body.messages[1].content);
    assert.equal(data.conversation[0].index, 0);
    assert.equal(data.catalog.length, 4);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ sku: catalog[3].sku, quantity: 2, sourceMessageIndexes: [0] }], unresolved: [] }) } }] });
  } });
  assert.equal((await interpreter(history, catalog)).status, 'ready');
  assert.equal(calls, 1);
});
test('model hallucinations, errors and invalid JSON cannot become quotes', async () => {
  const history = [{ ...initial.conversation_history[0], text: 'Interpret this unclear request' }];
  for (const response of [Response.json({ choices: [{ message: { content: 'not json' } }] }), Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ sku: 'invented', quantity: 1, sourceMessageIndexes: [0] }], unresolved: [] }) } }] }), new Response('error', { status: 500 })]) {
    const interpreter = createInterpreter({ url: 'http://localhost:1234/v1/chat/completions', model: 'test', fetch: async () => response });
    await assert.rejects(interpreter(history, catalog));
  }
});
test('optional model configuration refuses remote endpoints', () => {
  assert.throws(() => createInterpreter({ url: 'https://example.com/v1/chat/completions', model: 'test' }));
  assert.throws(() => createInterpreter({ url: 'http://localhost:1234/v1/chat/completions' }));
});

