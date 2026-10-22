import assert from 'node:assert/strict';
import { catalog, initial, events } from './fixtures';
import type { QuoteCandidate } from '../src/server/pipeline/routing';

// Scripted provider responses for persistence/HTTP tests, NOT a language interpreter.
// Unrecognized test inputs fail: tests must explicitly define expected model output.
export const mockModelFetch: typeof fetch = async (url, init) => {
  assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions');
  const payload = JSON.parse(init!.body as string);
  const input = JSON.parse(payload.messages[1].content);
  let output: unknown;
  if (input.conversation) {
    const texts = input.conversation.map((m: { text: string }) => m.text);
    if (JSON.stringify(texts) === JSON.stringify(initial.conversation_history.map(m => m.text))) {
      output = { items: catalog.slice(0, 3).map((item, i) => ({ sku: item.sku, quantity: i === 0 ? 20 : 5, sourceMessageIndexes: i === 2 ? [0, 1, 2, 3] : [0] })), unresolved: [] };
    } else {
      assert.ok(texts.includes('No tenemos disponible de 1.37x50') || texts.includes('cotizame 2 acrilicos blancos de 3mm y 3 tornillos'), 'Add an explicit model response for this test');
      output = { items: [], unresolved: [{ description: 'Test request', reason: 'Scripted unresolved model response', sourceMessageIndexes: [0] }] };
    }
  } else {
    const quotes = input.quotes as QuoteCandidate[];
    const candidates = quotes.map(q => q.id);
    const clarify = (ids = candidates) => ({ action: 'clarify', reason: 'Scripted ambiguous model response', candidates: ids });
    const acrylic = quotes.filter(q => q.lines.some(l => l.sku === catalog[3].sku));
    if (input.text === events[0].text) output = { action: 'revise', quoteId: quotes[0].id, sku: catalog[0].sku, quantity: 15 };
    else if (input.text === events[1].text) output = { action: 'inspect', quoteId: quotes[0].id };
    else if (input.text === events[2].text) output = { action: 'create', sku: catalog[3].sku, quantity: 2 };
    else if (input.text === events[3].text) output = acrylic.length === 1 ? { action: 'revise', quoteId: acrylic[0].id, sku: catalog[3].sku, quantity: 4 } : clarify(acrylic.map(q => q.id));
    else {
      assert.ok([events[4].text, 'y aparte cotizame 2 acrilicos blancos de 3mm y 3 tornillos'].includes(input.text), 'Add an explicit routing response for this test');
      output = clarify();
    }
  }
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] });
};
