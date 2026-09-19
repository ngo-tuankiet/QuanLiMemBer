/*
  Warnings:

  - Added the required column `broker` to the `introducing_brokers` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_introducing_brokers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "broker" TEXT NOT NULL,
    "brokerOther" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "buyFeeRateBps" INTEGER,
    "sellFeeRateBps" INTEGER,
    "sellTaxRateBps" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_introducing_brokers" ("buyFeeRateBps", "code", "createdAt", "id", "isActive", "name", "note", "sellFeeRateBps", "sellTaxRateBps", "sortOrder", "updatedAt") SELECT "buyFeeRateBps", "code", "createdAt", "id", "isActive", "name", "note", "sellFeeRateBps", "sellTaxRateBps", "sortOrder", "updatedAt" FROM "introducing_brokers";
DROP TABLE "introducing_brokers";
ALTER TABLE "new_introducing_brokers" RENAME TO "introducing_brokers";
CREATE UNIQUE INDEX "introducing_brokers_code_key" ON "introducing_brokers"("code");
CREATE INDEX "introducing_brokers_broker_idx" ON "introducing_brokers"("broker");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
