-- Create Message and its constraints/indexes.
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStatus" TEXT NOT NULL DEFAULT 'pending',
    "processingReason" TEXT,
    "requestHash" TEXT,
    "result" JSONB,
    "candidateQuoteIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "resolution" JSONB,
    CONSTRAINT "Message_conversationId_customerId_fkey" FOREIGN KEY ("conversationId", "customerId") REFERENCES "Conversation"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "Message_direction_check" CHECK ("direction" IN ('inbound', 'outbound')),
    CONSTRAINT "Message_processingStatus_check" CHECK ("processingStatus" IN ('pending', 'processed', 'needs_clarification'))
);

CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");
CREATE UNIQUE INDEX "Message_id_customerId_key" ON "Message"("id", "customerId");
CREATE INDEX "Message_conversationId_timestamp_idx" ON "Message"("conversationId", "timestamp");
CREATE INDEX "Message_customerId_processingStatus_idx" ON "Message"("customerId", "processingStatus");
