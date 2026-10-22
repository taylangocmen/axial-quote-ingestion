-- Create QuoteConversation and its constraints/indexes.
CREATE TABLE "QuoteConversation" (
    "quoteId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("quoteId", "conversationId"),
    CONSTRAINT "QuoteConversation_quoteId_customerId_fkey" FOREIGN KEY ("quoteId", "customerId") REFERENCES "Quote"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "QuoteConversation_conversationId_customerId_fkey" FOREIGN KEY ("conversationId", "customerId") REFERENCES "Conversation"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "QuoteConversation_conversationId_idx" ON "QuoteConversation"("conversationId");
