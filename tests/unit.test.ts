import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteInputSchema } from '../src/server/quotes/schemas';
import { validateInterpretation } from '../src/server/interpretation/validate';
import { interpretWithRules } from '../src/server/interpretation/rules';
import { createInterpreter } from '../src/server/interpretation/interpreter';
import { INTERPRETATION_PROMPT } from '../src/server/interpretation/prompt';
import { routeMessage } from '../src/server/pipeline/routing';
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
test('initial Spanish example combines both speakers and resolves unavailable width', () => {
  const result = interpretWithRules(initial.conversation_history, catalog);
  assert.deepEqual(result.items.map(i => [i.sku, i.quantity]), catalog.slice(0, 3).map((p, i) => [p.sku, i === 0 ? 20 : 5]));
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.items[2].sourceMessageIndexes, [0, 1, 2, 3]);
});
test('local extraction parses changed quantities instead of matching the fixture text', () => {
  const history = [{ direction: 'inbound' as const, timestamp: events[0].timestamp, text: 'Cotizame 7 acrilicos blancos de 3mm porfa' }];
  assert.equal(interpretWithRules(history, catalog).items[0].quantity, 7);
});
test('unsupported dimensions and unknown requested products require clarification', () => {
  for (const text of ['cotizame 2 acrilicos blancos de 5mm', 'cotizame 3 rollos de papel', 'cotizame 4 microperforados de 1.50']) {
    const result = interpretWithRules([{ ...initial.conversation_history[0], text }], catalog);
    assert.ok(result.unresolved.length > 0, text);
    assert.equal(result.items.length, 0, text);
  }
});
test('negative and fractional quantities, negated requests and unsupported extra items cannot silently become a complete quote', async () => {
  for (const text of ['cotizame -2 acrilicos blancos de 3mm', 'cotizame 2.5 acrilicos blancos de 3mm', 'no quiero 2 acrilicos blancos de 3mm', 'cotizame 2 acrilicos blancos de 3mm y 3 tornillos']) {
    const result = await createInterpreter()([{ ...initial.conversation_history[0], text }], catalog);
    assert.equal(result.status, 'needs_clarification', text);
  }
});
const quotes = [{ id: 'Q1', lines: [{ sku: catalog[0].sku, quantity: 20 }, { sku: catalog[1].sku, quantity: 5 }] }, { id: 'Q2', lines: [{ sku: catalog[3].sku, quantity: 2 }] }];
test('revision uses old quantity to distinguish the two lona lines', () => {
  assert.deepEqual(routeMessage(events[0].text, quotes, catalog), { action: 'revise', quoteId: 'Q1', sku: catalog[0].sku, quantity: 15 });
});
test('question links a quote, separate request creates, acrylic reference crosses chats', () => {
  assert.deepEqual(routeMessage(events[1].text, quotes, catalog), { action: 'inspect', quoteId: 'Q1' });
  assert.deepEqual(routeMessage(events[2].text, quotes, catalog), { action: 'create', sku: catalog[3].sku, quantity: 2 });
  assert.deepEqual(routeMessage(events[3].text, quotes, catalog), { action: 'revise', quoteId: 'Q2', sku: catalog[3].sku, quantity: 4 });
});
test('ambiguous cancellation and duplicate product candidates never guess', () => {
  assert.equal(routeMessage(events[4].text, quotes, catalog).action, 'clarify');
  assert.equal(routeMessage(events[3].text, [...quotes, { ...quotes[1], id: 'Q3' }], catalog).action, 'clarify');
  assert.equal(routeMessage('de las lonas mejor que sean 9', quotes, catalog).action, 'clarify');
  assert.equal(routeMessage('de los acrilicos mejor que sean 4.5', quotes, catalog).action, 'clarify');
});
test('simple initial requests avoid all model calls', async () => {
  const interpreter = createInterpreter({ url: 'http://127.0.0.1:1234/v1/chat/completions', model: 'test', fetch: async () => { throw new Error('must not call'); } });
  assert.equal((await interpreter(initial.conversation_history, catalog)).status, 'ready');
});
test('local model fallback receives prompt, numbered history and catalog then validates output', async () => {
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

test('negative availability must not supply a product for a later quantity reply', () => {
  const history = initial.conversation_history.map((message, index) => index === 2
    ? { ...message, text: 'No tenemos disponible de 1.37x50' } : message);
  const result = validateInterpretation(interpretWithRules(history, catalog), context);
  assert.equal(result.status, 'needs_clarification');
  assert.equal(result.interpretation.items.some(item => item.sku === catalog[2].sku), false);
});
test('separate requests cannot silently omit an unknown or unresolved extra item', () => {
  for (const text of [
    'y aparte cotizame 2 acrilicos blancos de 3mm y 3 tornillos',
    'y aparte cotizame 2 acrilicos blancos de 3mm y 3 microperforados de 1.50',
  ]) assert.equal(routeMessage(text, quotes, catalog).action, 'clarify');
});
test('multiple revisions in one message are held rather than taking the first quantity', () => {
  assert.equal(routeMessage('de los acrilicos mejor que sean 4 y mejor que sean 6', quotes, catalog).action, 'clarify');
});
