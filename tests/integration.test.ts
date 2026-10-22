import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { QuotePipeline } from '../src/server/pipeline/service';
import { initial, events, catalog } from './fixtures';
import { mockModelFetch } from './mock-model';

try { loadEnvFile('.env.test'); } catch { /* CI may supply TEST_DATABASE_URL explicitly. */ }
const url = new URL(process.env.TEST_DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/axial_quote_ingestion_test') {
  throw new Error('Integration tests require the dedicated local axial_quote_ingestion_test database.');
}
process.env.DATABASE_URL = url.href;
delete process.env.LOCAL_LLM_URL;
delete process.env.LOCAL_LLM_MODEL;
process.env.LLM_PROVIDER = 'groq';
process.env.LLM_MODEL = 'mock-model';
process.env.LLM_API_KEY = 'test-key';
const originalFetch = globalThis.fetch;
globalThis.fetch = mockModelFetch;
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
const pipeline = new QuotePipeline(db);
beforeEach(async () => {
  await db.$transaction([
    db.quoteActivityMessage.deleteMany(), db.quoteActivity.deleteMany(), db.quoteConversation.deleteMany(),
    db.quoteLine.deleteMany(), db.quote.deleteMany(), db.message.deleteMany(), db.conversation.deleteMany(),
  ]);
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
const quantities = (quote: any) => Object.fromEntries(quote.line_items.map((l: any) => [l.sku, l.qty]));
async function complete() {
  await pipeline.ingest(initial);
  for (const event of events.slice(0, 4)) await pipeline.message(event);
}

test('catalog migration inserts exactly the required four products', async () => {
  const items = await db.catalogItem.findMany({ orderBy: { sku: 'asc' } });
  assert.deepEqual(items, [...catalog].sort((a,b) => a.sku.localeCompare(b.sku)));
});
test('assignment sequence persists correct state after every event and survives a new process', async () => {
  const first = await pipeline.ingest(initial) as any;
  assert.equal(first.status, 'draft');
  assert.equal(first.document_type, 'Oferta_de_Venta');
  assert.deepEqual(quantities(first), { [catalog[0].sku]: 20, [catalog[1].sku]: 5, [catalog[2].sku]: 5 });
  assert.deepEqual(first.conversations, ['wa-thread-411']);
  await pipeline.message(events[0]);
  let state = await pipeline.quotes(initial.customer_id);
  assert.deepEqual(quantities(state.quotes[0]), { [catalog[0].sku]: 15, [catalog[1].sku]: 5, [catalog[2].sku]: 5 });
  await pipeline.message(events[1]);
  state = await pipeline.quotes(initial.customer_id);
  assert.deepEqual(state.quotes[0].conversations, ['wa-thread-411', 'wa-thread-662']);
  assert.equal(state.quotes.length, 1);
  assert.deepEqual(quantities(state.quotes[0]), { [catalog[0].sku]: 15, [catalog[1].sku]: 5, [catalog[2].sku]: 5 });
  await pipeline.message(events[2]);
  state = await pipeline.quotes(initial.customer_id);
  assert.equal(state.quotes.length, 2);
  assert.deepEqual(quantities(state.quotes[1]), { [catalog[3].sku]: 2 });
  assert.deepEqual(state.quotes[1].conversations, ['wa-thread-411']);
  await pipeline.message(events[3]);
  state = await pipeline.quotes(initial.customer_id);
  assert.deepEqual(quantities(state.quotes[1]), { [catalog[3].sku]: 4 });
  assert.deepEqual(state.quotes[1].conversations, ['wa-thread-411', 'wa-thread-662']);
  assert.deepEqual(quantities(state.quotes[0]), { [catalog[0].sku]: 15, [catalog[1].sku]: 5, [catalog[2].sku]: 5 });
  const freshProcess = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'tests/read-quotes.ts'], { env: { ...process.env, DATABASE_URL: url.href }, encoding: 'utf8' }));
  assert.deepEqual(freshProcess, state);
  const history = await pipeline.history(state.quotes[1].quote_id, initial.customer_id);
  const revision = history.activities.find(a => a.action === 'quantity_changed')!;
  assert.deepEqual(revision.beforeState, { sku: catalog[3].sku, quantity: 2 });
  assert.deepEqual(revision.afterState, { sku: catalog[3].sku, quantity: 4 });
  assert.equal(revision.sources[0].message.externalId, events[3].message_id);
  const originalHistory = await pipeline.history(first.quote_id, initial.customer_id);
  assert.equal(originalHistory.activities.find(a => a.action === 'quote_created')!.sources.length, 4);
});
test('same event ID replays without changes; distinct IDs remain real messages', async () => {
  await complete();
  const before = await pipeline.quotes(initial.customer_id);
  const counts = [await db.message.count(), await db.quoteActivity.count(), await db.quoteConversation.count()];
  const once = await pipeline.message(events[3]);
  assert.deepEqual(await pipeline.message(events[3]), once);
  assert.deepEqual(await pipeline.quotes(initial.customer_id), before);
  assert.deepEqual([await db.message.count(), await db.quoteActivity.count(), await db.quoteConversation.count()], counts);
  await pipeline.message({ ...events[3], message_id: 'different-id' });
  assert.equal(await db.message.count(), counts[0] + 1);
  assert.equal(await db.quoteActivity.count(), counts[1] + 1);
  await assert.rejects(pipeline.message({ ...events[3], text: 'different content' }), (e: any) => e.status === 409);
});
test('bootstrap replay is idempotent; replacing ingested history conflicts', async () => {
  const first = await pipeline.ingest(initial);
  assert.deepEqual(await pipeline.ingest(initial), first);
  assert.equal(await db.quote.count(), 1);
  assert.equal(await db.message.count(), 4);
  await assert.rejects(pipeline.ingest({ ...initial, conversation_history: [{ ...initial.conversation_history[0], text: 'other request' }] }), (e: any) => e.status === 409);
});
test('duplicate creation event cannot create another quote', async () => {
  await pipeline.ingest(initial);
  await pipeline.message(events[2]);
  const count = await db.quoteActivity.count();
  await pipeline.message(events[2]);
  assert.equal(await db.quote.count(), 2);
  assert.equal(await db.quoteActivity.count(), count);
});
test('overlapping duplicate deliveries serialize within one customer transaction', async () => {
  await pipeline.ingest(initial);
  const [first, replay] = await Promise.all([pipeline.message(events[2]), pipeline.message(events[2])]);
  assert.deepEqual(first, replay);
  assert.equal(await db.quote.count(), 2);
  assert.equal(await db.message.count({ where: { externalId: events[2].message_id } }), 1);
});
test('partial interpretations persist evidence but create no partial quote', async () => {
  const input = { ...initial, conversation_history: [{ ...initial.conversation_history[0], text: 'cotizame 2 acrilicos blancos de 3mm y 3 tornillos' }] };
  const result = await pipeline.ingest(input) as any;
  assert.equal(result.status, 'needs_clarification');
  assert.equal(await db.quote.count(), 0);
  assert.equal(await db.message.count(), 1);
});
test('ambiguous cancellation is visible with both candidates and only explicit resolution changes a quote', async () => {
  await complete();
  const before = await pipeline.quotes(initial.customer_id);
  const result = await pipeline.message(events[4]) as any;
  assert.equal(result.status, 'needs_clarification');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(await pipeline.quotes(initial.customer_id), before);
  const queue = await pipeline.unresolved(initial.customer_id);
  assert.equal(queue.messages.length, 1);
  assert.equal(queue.messages[0].candidates.length, 2);
  const input = { customer_id: initial.customer_id, action: 'cancel_quote', quote_id: before.quotes[1].quote_id };
  const resolved = await pipeline.resolve(result.message_id, input);
  assert.deepEqual(await pipeline.resolve(result.message_id, input), resolved);
  const state = await pipeline.quotes(initial.customer_id);
  assert.equal(state.quotes[0].status, 'draft');
  assert.equal(state.quotes[1].status, 'cancelled');
  assert.equal((await pipeline.unresolved(initial.customer_id)).messages.length, 0);
  await assert.rejects(pipeline.resolve(result.message_id, { ...input, quote_id: before.quotes[0].quote_id }), (e: any) => e.status === 409);
});
test('customer boundaries apply to routing, reads, chat ownership and foreign keys', async () => {
  const first = await pipeline.ingest(initial) as any;
  await assert.rejects(pipeline.message({ ...events[0], customer_id: 'other' }), (e: any) => e.status === 409);
  const other = await pipeline.message({ ...events[3], customer_id: 'other', conversation_id: 'other-chat' }) as any;
  assert.equal(other.status, 'needs_clarification');
  assert.deepEqual(other.candidates, []);
  assert.deepEqual(await pipeline.quotes('other'), { quotes: [] });
  await assert.rejects(pipeline.history(first.quote_id, 'other'), (e: any) => e.status === 404);
  await assert.rejects(db.quoteConversation.create({ data: { quoteId: first.quote_id, conversationId: 'other-chat', customerId: initial.customer_id } }));
});
test('database rejects unknown SKU, invalid quantities, repeated lines and cross-customer provenance', async () => {
  const first = await pipeline.ingest(initial) as any;
  await assert.rejects(db.quoteLine.create({ data: { quoteId: first.quote_id, sku: 'UNKNOWN', quantity: 1 } }));
  await assert.rejects(db.quoteLine.create({ data: { quoteId: first.quote_id, sku: catalog[0].sku, quantity: 1 } }));
  for (const quantity of [0, -1]) await assert.rejects(db.quoteLine.update({ where: { quoteId_sku: { quoteId: first.quote_id, sku: catalog[0].sku } }, data: { quantity } }));
  const conv = await db.conversation.create({ data: { id: 'other-chat', customerId: 'other' } });
  const msg = await db.message.create({ data: { conversationId: conv.id, customerId: 'other', direction: 'inbound', text: 'x', timestamp: new Date() } });
  const activity = await db.quoteActivity.findFirstOrThrow();
  await assert.rejects(db.quoteActivityMessage.create({ data: { activityId: activity.id, messageId: msg.id, customerId: initial.customer_id } }));
});
test('failed nested write rolls back quote, messages, conversation and history', async () => {
  const invalid = new QuotePipeline(db, async () => ({ status: 'ready', interpretation: { items: [{ sku: 'UNKNOWN', quantity: 2, sourceMessageIndexes: [0] }], unresolved: [] } }));
  await assert.rejects(invalid.ingest(initial));
  assert.equal(await db.quote.count(), 0);
  assert.equal(await db.message.count(), 0);
  assert.equal(await db.conversation.count(), 0);
  assert.equal(await db.quoteActivity.count(), 0);
});
test('interpreter failure preserves source messages for review without partial quotes', async () => {
  const failed = new QuotePipeline(db, async () => { throw new Error('provider unavailable'); });
  const result = await failed.ingest(initial) as any;
  assert.equal(result.status, 'needs_clarification');
  assert.equal(await db.quote.count(), 0);
  assert.equal(await db.message.count(), 4);
  assert.equal((await failed.unresolved(initial.customer_id)).messages.length, 4);
});
test('outbound messages never mutate lines; late revisions are held for review', async () => {
  await complete();
  const before = await pipeline.quotes(initial.customer_id);
  await pipeline.message({ ...events[3], message_id: 'outbound', direction: 'outbound' });
  const late = await pipeline.message({ ...events[3], message_id: 'late', timestamp: '2026-02-01T00:00:00Z' }) as any;
  assert.equal(late.status, 'needs_clarification');
  assert.deepEqual(await pipeline.quotes(initial.customer_id), before);
});
test('API route handlers validate JSON, create and retrieve quotes, history and review items', async () => {
  const ingest = await import('../src/app/api/conversations/ingest/route');
  const messages = await import('../src/app/api/messages/route');
  const quotes = await import('../src/app/api/quotes/route');
  const history = await import('../src/app/api/quotes/[id]/history/route');
  const unresolved = await import('../src/app/api/unresolved/route');
  const resolve = await import('../src/app/api/messages/[id]/resolve/route');
  const health = await import('../src/app/api/health/route');
  const catalogRoute = await import('../src/app/api/catalog/route');
  assert.equal((await health.GET().json()).status, 'ok');
  assert.equal((await (await catalogRoute.GET()).json()).items.length, 4);
  const request = (value: unknown) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(value) });
  assert.equal((await ingest.POST(new Request('http://localhost/api', { method: 'POST', body: '{' }))).status, 400);
  assert.equal((await ingest.POST(request({}))).status, 422);
  const firstResponse = await ingest.POST(request(initial));
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  for (const event of events) assert.equal((await messages.POST(request(event))).status, 200);
  const listed = await quotes.GET(new Request('http://localhost/api/quotes?customer=C-10029'));
  assert.equal((await listed.json()).quotes.length, 2);
  assert.equal((await quotes.GET(new Request('http://localhost/api/quotes'))).status, 422);
  assert.equal((await history.GET(new Request('http://localhost/api?customer=C-10029'), { params: Promise.resolve({ id: first.quote_id }) })).status, 200);
  const queue = await (await unresolved.GET(new Request('http://localhost/api?customer=C-10029'))).json();
  assert.equal(queue.messages.length, 1);
  assert.equal((await resolve.POST(request({ action: 'dismiss', customer_id: 'C-10029' }), { params: Promise.resolve({ id: queue.messages[0].message_id }) })).status, 200);
  const { db: routeDb } = await import('../src/server/db');
  await routeDb.$disconnect();
});

test('PDF persistence acceptance with mocked model: exact API quote state after initial ingestion and each separate event', async () => {
  const ingest = await import('../src/app/api/conversations/ingest/route');
  const messages = await import('../src/app/api/messages/route');
  const quotes = await import('../src/app/api/quotes/route');
  const request = (payload: unknown) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(payload) });
  const firstResponse = await ingest.POST(request(initial));
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  const expected = (id: string, conversations: string[], lines: [string, number][]) => ({
    document_type: 'Oferta_de_Venta', quote_id: id, status: 'draft', conversations,
    line_items: lines.map(([sku, qty]) => ({ sku, qty })).sort((a, b) => a.sku.localeCompare(b.sku)),
  });
  assert.deepEqual(first, expected(first.quote_id, ['wa-thread-411'], [[catalog[0].sku, 20], [catalog[1].sku, 5], [catalog[2].sku, 5]]));
  const snapshots: unknown[] = [];
  let secondId = '';
  for (const [index, event] of events.slice(0, 4).entries()) {
    const response = await messages.POST(request(event));
    assert.equal(response.status, 200);
    const result = await response.json();
    if (index === 2) secondId = result.quote.quote_id;
    const responseState = await quotes.GET(new Request('http://localhost/api/quotes?customer=C-10029'));
    assert.equal(responseState.status, 200);
    const state = await responseState.json();
    snapshots.push(state);
    const expectedQuotes = [expected(first.quote_id, index === 0 ? ['wa-thread-411'] : ['wa-thread-411', 'wa-thread-662'], [[catalog[0].sku, 15], [catalog[1].sku, 5], [catalog[2].sku, 5]])];
    if (index >= 2) expectedQuotes.push(expected(secondId, index === 2 ? ['wa-thread-411'] : ['wa-thread-411', 'wa-thread-662'], [[catalog[3].sku, index === 2 ? 2 : 4]]));
    assert.deepEqual(state, { quotes: expectedQuotes });
  }
  const counts = [await db.quote.count(), await db.message.count(), await db.quoteActivity.count(), await db.quoteConversation.count()];
  await messages.POST(request(events[3]));
  assert.deepEqual(await (await quotes.GET(new Request('http://localhost/api/quotes?customer=C-10029'))).json(), snapshots[3]);
  assert.deepEqual([await db.quote.count(), await db.message.count(), await db.quoteActivity.count(), await db.quoteConversation.count()], counts);
  const cancellation = await (await messages.POST(request(events[4]))).json();
  assert.equal(cancellation.status, 'needs_clarification');
  assert.deepEqual(new Set(cancellation.candidates), new Set([first.quote_id, secondId]));
  assert.deepEqual(await (await quotes.GET(new Request('http://localhost/api/quotes?customer=C-10029'))).json(), snapshots[3]);
  const history = await pipeline.history(first.quote_id, initial.customer_id);
  const revision = history.activities.find(a => a.action === 'quantity_changed')!;
  assert.deepEqual(revision.beforeState, { sku: catalog[0].sku, quantity: 20 });
  assert.deepEqual(revision.afterState, { sku: catalog[0].sku, quantity: 15 });
  assert.equal(revision.sources[0].message.externalId, events[0].message_id);
  const marioLink = history.activities.find(a => a.action === 'conversation_linked' && (a.afterState as any).conversationId === 'wa-thread-662')!;
  assert.equal(marioLink.sources[0].message.externalId, events[1].message_id);
  const { db: routeDb } = await import('../src/server/db');
  await routeDb.$disconnect();
});
test('negative availability preserves conversation for review and creates no partial draft', async () => {
  const history = initial.conversation_history.map((message, index) => index === 2
    ? { ...message, text: 'No tenemos disponible de 1.37x50' } : message);
  const result = await pipeline.ingest({ ...initial, conversation_history: history }) as any;
  assert.equal(result.status, 'needs_clarification');
  assert.equal(await db.quote.count(), 0);
  assert.equal(await db.message.count(), 4);
});
test('mixed separate request cannot create a partial quote or change existing lines', async () => {
  await pipeline.ingest(initial);
  const before = await pipeline.quotes(initial.customer_id);
  const historyCount = await db.quoteActivity.count();
  const result = await pipeline.message({ ...events[2], text: 'y aparte cotizame 2 acrilicos blancos de 3mm y 3 tornillos' }) as any;
  assert.equal(result.status, 'needs_clarification');
  assert.deepEqual(await pipeline.quotes(initial.customer_id), before);
  assert.equal(await db.quoteActivity.count(), historyCount);
});
test('same text with a new ID creates a real separate quote and makes later acrylic routing ambiguous', async () => {
  await pipeline.ingest(initial);
  await pipeline.message(events[2]);
  await pipeline.message({ ...events[2], message_id: 'second-real-acrylic-request' });
  const before = await pipeline.quotes(initial.customer_id);
  assert.equal(before.quotes.length, 3);
  const result = await pipeline.message(events[3]) as any;
  assert.equal(result.status, 'needs_clarification');
  assert.deepEqual(new Set(result.candidates), new Set(before.quotes.slice(1).map(q => q.quote_id)));
  assert.deepEqual(await pipeline.quotes(initial.customer_id), before);
  assert.equal(await db.quoteConversation.count({ where: { conversationId: events[3].conversation_id } }), 0);
});

test('follow-up model failure is stored for review without changing quotes', async () => {
  await pipeline.ingest(initial);
  const before = await pipeline.quotes(initial.customer_id);
  const failed = new QuotePipeline(db, undefined, async () => { throw new Error('provider failed'); });
  const response = await failed.message(events[0]) as any;
  assert.equal(response.status, 'needs_clarification');
  assert.deepEqual(await pipeline.quotes(initial.customer_id), before);
  assert.equal((await failed.unresolved(initial.customer_id)).messages.length, 1);
});

test('replayed histories and messages do not call the model again', async () => {
  await pipeline.ingest(initial);
  await pipeline.message(events[0]);
  const before = await pipeline.quotes(initial.customer_id);
  let calls = 0;
  const unexpected = async (): Promise<never> => { calls++; throw new Error('must not call'); };
  const replay = new QuotePipeline(db, unexpected, unexpected);
  await replay.ingest(initial);
  await replay.message(events[0]);
  assert.equal(calls, 0);
  assert.deepEqual(await pipeline.quotes(initial.customer_id), before);
});
