-- Create QuoteLine and its constraints/indexes.
CREATE TABLE "QuoteLine" (
    "quoteId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    PRIMARY KEY ("quoteId", "sku"),
    CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuoteLine_sku_fkey" FOREIGN KEY ("sku") REFERENCES "CatalogItem"("sku") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuoteLine_quantity_check" CHECK (
        "quantity" > 0 AND "quantity" <= 2147483647
    )
);
