// Opt-in live HTTP/LLM evaluation. Creates isolated development data.
// The expected values below are test assertions, never production routing rules.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const base = 'http://127.0.0.1:3000';
const suffix = randomUUID().slice(0, 8);
const customer = `phase2-eval-${suffix}`;
const alice = `alice-${suffix}`;
const mario = `mario-${suffix}`;
const initial = { ...JSON.parse(readFileSync('examples/initial-conversation.json', 'utf8')), customer_id: customer, conversation_id: alice };
const events = [1, 2, 3, 4, 5].map(n => {
  const event = JSON.parse(readFileSync(`examples/event-${n}.json`, 'utf8'));
  return { ...event, customer_id: customer, conversation_id: event.conversation_id === 'wa-thread-411' ? alice : mario, message_id: `eval-${suffix}-${n}` };
});
const sku = ['ALFBTC-013-320100', 'ALMCLC-0909-320100', 'AVMICS-1A-137050', 'ARACBL-03-122244'];
const results: unknown[] = [];
let lastFinished = Date.now();
const save = () => writeFileSync('/tmp/axial-phase2-evaluation.json', JSON.stringify({ customer, results }, null, 2));
async function get(path: string) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  return response.json();
}
async function post(name: string, path: string, payload: unknown) {
  if (lastFinished) {
    const wait = Math.max(0, 60000 - (Date.now() - lastFinished));
    console.log(`WAIT ${name}: ${Math.ceil(wait / 1000)}s (one minute between POSTs)`);
    await delay(wait);
  }
  const started = new Date().toISOString();
  console.log(`RUN ${name} ${started}`);
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(40000) });
  const output = await response.json();
  lastFinished = Date.now();
  results.push({ name, started, finished: new Date(lastFinished).toISOString(), httpStatus: response.status, output });
  save();
  assert.equal(response.status, 200);
  return output;
}
const state = () => get(`/api/quotes?customer=${customer}`);
const history = (id: string) => get(`/api/quotes/${id}/history?customer=${customer}`);
function quote(id: string, chats: string[], lines: [string, number][]) {
  return { document_type: 'Oferta_de_Venta', quote_id: id, status: 'draft', conversations: [...chats].sort(), line_items: lines.map(([sku, qty]) => ({ sku, qty })).sort((a,b) => a.sku.localeCompare(b.sku)) };
}
function pass(name: string) { console.log(`PASS ${name}`); }
async function main() {
  console.log(`Live customer: ${customer}`);
  const first = await post('phase1-bootstrap', '/api/conversations/ingest', initial);
  assert.equal(first.status, 'draft', JSON.stringify(first));
  const q1 = first.quote_id;
  assert.deepEqual(first, quote(q1, [alice], [[sku[0],20],[sku[1],5],[sku[2],5]]));
  assert.deepEqual(await state(), { quotes: [first] });
  pass('phase1-bootstrap');
  let q2 = '';
  let event4Result: unknown;
  let finalState: any;
  for (const [index, event] of events.slice(0, 4).entries()) {
    const result = await post(`event-${index + 1}`, '/api/messages', event);
    assert.equal(result.status, 'processed', JSON.stringify(result));
    assert.equal(result.action, ['revise','inspect','create','revise'][index]);
    if (index === 2) q2 = result.quote.quote_id;
    const expected = [quote(q1, index === 0 ? [alice] : [alice,mario], [[sku[0],15],[sku[1],5],[sku[2],5]])];
    if (index >= 2) expected.push(quote(q2, index === 2 ? [alice] : [alice,mario], [[sku[3],index === 2 ? 2 : 4]]));
    const saved = await state();
    assert.deepEqual(saved, { quotes: expected });
    const target = index >= 2 ? q2 : q1;
    const audit = await history(target);
    assert.ok(audit.activities.some((a: any) => a.sources.some((s: any) => s.message.externalId === event.message_id)), 'Missing event source in history');
    if (index === 3) { event4Result = result; finalState = saved; }
    pass(`event-${index + 1}: exact state and source history`);
  }
  const beforeHistory = [await history(q1), await history(q2)];
  const duplicate = await post('duplicate-event-4', '/api/messages', events[3]);
  assert.deepEqual(duplicate, event4Result);
  assert.deepEqual(await state(), finalState);
  assert.deepEqual([await history(q1), await history(q2)], beforeHistory);
  pass('duplicate: unchanged state and history');
  const cancellation = await post('ambiguous-cancellation', '/api/messages', events[4]);
  assert.equal(cancellation.status, 'needs_clarification');
  assert.deepEqual([...cancellation.candidates].sort(), [q1,q2].sort());
  assert.deepEqual(await state(), finalState);
  assert.deepEqual([await history(q1), await history(q2)], beforeHistory);
  const queue = await get(`/api/unresolved?customer=${customer}`);
  assert.equal(queue.messages.length, 1);
  assert.equal(queue.messages[0].external_id, events[4].message_id);
  assert.deepEqual(queue.messages[0].candidates.map((q: any) => q.quote_id).sort(), [q1,q2].sort());
  pass('cancellation: visible with both candidates, no mutation');
  // Different wording and a written-out quantity; checks more than the supplied phrase.
  const variation = { ...events[3], message_id: `eval-${suffix}-variation`, timestamp: '2026-02-11T10:19:00Z', text: 'Actualiza la oferta de las placas de acrílico blanco de 3 mm: necesitamos siete en total. Conserva la otra oferta sin cambios.' };
  const revised = await post('paraphrased-revision-seven', '/api/messages', variation);
  assert.equal(revised.status, 'processed', JSON.stringify(revised));
  assert.equal(revised.action, 'revise');
  assert.equal(revised.quote.quote_id, q2);
  assert.deepEqual(await state(), { quotes: [finalState.quotes[0], quote(q2, [alice,mario], [[sku[3],7]])] });
  pass('paraphrased revision: acrylic 7, other quote unchanged');
  results.push({ allPassed: true }); save();
  console.log('PASS all 8 POST checks; results: /tmp/axial-phase2-evaluation.json');
}
main().catch(error => {
  results.push({ allPassed: false, error: error instanceof Error ? error.message : String(error) }); save();
  console.error(error); process.exitCode = 1;
});
