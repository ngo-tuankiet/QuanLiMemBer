-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_stocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyNameVi" TEXT,
    "exchange" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "industryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "listedShares" BIGINT,
    "isin" TEXT,
    "website" TEXT,
    "note" TEXT,
    "isVn30" BOOLEAN NOT NULL DEFAULT false,
    "isVn100" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "stocks_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stocks_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_stocks" ("companyName", "companyNameVi", "createdAt", "exchange", "id", "industryId", "isVn30", "isin", "listedShares", "note", "sectorId", "status", "symbol", "updatedAt", "website") SELECT "companyName", "companyNameVi", "createdAt", "exchange", "id", "industryId", "isVn30", "isin", "listedShares", "note", "sectorId", "status", "symbol", "updatedAt", "website" FROM "stocks";
DROP TABLE "stocks";
ALTER TABLE "new_stocks" RENAME TO "stocks";
CREATE UNIQUE INDEX "stocks_symbol_key" ON "stocks"("symbol");
CREATE INDEX "stocks_sectorId_idx" ON "stocks"("sectorId");
CREATE INDEX "stocks_industryId_idx" ON "stocks"("industryId");
CREATE INDEX "stocks_exchange_idx" ON "stocks"("exchange");
CREATE INDEX "stocks_status_idx" ON "stocks"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
