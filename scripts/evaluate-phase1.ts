// Explicit live evaluation: calls the running local API and its configured model.
// Creates isolated development records; never included in the default unit test suite.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const original = JSON.parse(readFileSync('examples/initial-conversation.json', 'utf8'));
const baseUrl = 'http://127.0.0.1:3000';
const initialLines = [
  { sku: 'ALFBTC-013-320100', qty: 20 },
  { sku: 'ALMCLC-0909-320100', qty: 5 },
  { sku: 'AVMICS-1A-137050', qty: 5 },
];
const changed = structuredClone(original);
changed.conversation_history[0].text = 'Buen día, cotízame 7 rollos de lona 3.20 x 100 y 3 rollos de mesh 3.20 x 100. ¿Tienen microperforado de 1.37 o 1.50 m?';
changed.conversation_history[1].text = '¿Cuántos rollos de microperforado necesitas?';
changed.conversation_history[2].text = 'Por ahora tenemos disponible el de 1.37x50.';
changed.conversation_history[3].text = 'De ese que tienen, mándame 2 rollos.';
const insist = structuredClone(original);
insist.conversation_history.push({ direction: 'inbound', timestamp: '2026-02-10T09:47:00Z', text: 'Además necesito 3 rollos de microperforado de 1.50 m. Los de 1.37 no sustituyen estos tres; sigo necesitando los de 1.50.' });
const cases = [
  ...[1, 2, 3].map(n => ({ name: `exact-example-${n}`, input: original, lines: initialLines })),
  { name: 'paraphrased-changed-quantities', input: changed, lines: initialLines.map((line, i) => ({ ...line, qty: [7, 3, 2][i] })) },
  { name: 'explicit-unavailable-width-request', input: insist, lines: null },
];
async function main() {
const results: unknown[] = [];
let failures = 0;
for (const entry of cases) {
  // Pace the opt-in evaluation to stay within hosted free-tier token limits.
  await delay(60000);
  const suffix = randomUUID().slice(0, 8);
  const input = { ...entry.input, customer_id: `eval-${suffix}`, conversation_id: `eval-chat-${suffix}` };
  const started = Date.now();
  let output: unknown;
  try {
    const response = await fetch(`${baseUrl}/api/conversations/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(40000) });
    output = await response.json();
    assert.equal(response.status, 200);
    const result = output as any;
    const storedResponse = await fetch(`${baseUrl}/api/quotes?customer=${input.customer_id}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(storedResponse.status, 200);
    const stored = await storedResponse.json();
    if (entry.lines) {
      assert.equal(result.document_type, 'Oferta_de_Venta');
      assert.equal(result.status, 'draft');
      assert.deepEqual(result.line_items, entry.lines);
      assert.deepEqual(result.conversations, [input.conversation_id]);
      assert.deepEqual(stored.quotes, [result]);
    } else {
      assert.equal(result.status, 'needs_clarification');
      assert.ok(result.unresolved.some((item: any) => `${item.description} ${item.reason}`.includes('1.50')));
      assert.deepEqual(stored.quotes, []);
    }
    results.push({ name: entry.name, passed: true, customer: input.customer_id, milliseconds: Date.now() - started, output });
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failures++;
    results.push({ name: entry.name, passed: false, customer: input.customer_id, output, error: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
writeFileSync('/tmp/axial-phase1-evaluation.json', JSON.stringify(results, null, 2));
console.log(`${cases.length - failures}/${cases.length} live cases passed. Results: /tmp/axial-phase1-evaluation.json`);
if (failures) process.exitCode = 1;

}
main().catch(error => { console.error(error); process.exitCode = 1; });
