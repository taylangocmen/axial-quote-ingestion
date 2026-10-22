-- Create QuoteActivity and its constraints/indexes.
CREATE TABLE "QuoteActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteActivity_quoteId_customerId_fkey" FOREIGN KEY ("quoteId", "customerId") REFERENCES "Quote"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "QuoteActivity_action_check" CHECK ("action" IN ('quote_created', 'quantity_changed', 'conversation_linked', 'quote_cancelled'))
);

CREATE UNIQUE INDEX "QuoteActivity_id_customerId_key" ON "QuoteActivity"("id", "customerId");
CREATE INDEX "QuoteActivity_quoteId_createdAt_idx" ON "QuoteActivity"("quoteId", "createdAt");
