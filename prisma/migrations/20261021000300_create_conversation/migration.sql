-- Create Conversation and its constraints/indexes.
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "bootstrapHash" TEXT,
    "bootstrapResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Conversation_id_customerId_key" ON "Conversation"("id", "customerId");
CREATE INDEX "Conversation_customerId_idx" ON "Conversation"("customerId");
