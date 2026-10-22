-- Create QuoteActivityMessage and its constraints/indexes.
CREATE TABLE "QuoteActivityMessage" (
    "activityId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    PRIMARY KEY ("activityId", "messageId"),
    CONSTRAINT "QuoteActivityMessage_activityId_customerId_fkey" FOREIGN KEY ("activityId", "customerId") REFERENCES "QuoteActivity"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "QuoteActivityMessage_messageId_customerId_fkey" FOREIGN KEY ("messageId", "customerId") REFERENCES "Message"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "QuoteActivityMessage_messageId_idx" ON "QuoteActivityMessage"("messageId");
