-- Create Quote and its constraints/indexes.
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quote_status_check" CHECK ("status" IN ('draft', 'cancelled'))
);

CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");
CREATE UNIQUE INDEX "Quote_id_customerId_key" ON "Quote"("id", "customerId");
