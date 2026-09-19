/*
  Warnings:

  - You are about to drop the column `ibName` on the `broker_accounts` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "introducing_brokers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_broker_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "broker" TEXT NOT NULL,
    "brokerOther" TEXT,
    "accountNo" TEXT NOT NULL,
    "ibId" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "broker_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "broker_accounts_ibId_fkey" FOREIGN KEY ("ibId") REFERENCES "introducing_brokers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_broker_accounts" ("accountNo", "broker", "brokerOther", "createdAt", "id", "isActive", "note", "updatedAt", "userId") SELECT "accountNo", "broker", "brokerOther", "createdAt", "id", "isActive", "note", "updatedAt", "userId" FROM "broker_accounts";
DROP TABLE "broker_accounts";
ALTER TABLE "new_broker_accounts" RENAME TO "broker_accounts";
CREATE INDEX "broker_accounts_userId_idx" ON "broker_accounts"("userId");
CREATE INDEX "broker_accounts_ibId_idx" ON "broker_accounts"("ibId");
CREATE UNIQUE INDEX "broker_accounts_broker_accountNo_key" ON "broker_accounts"("broker", "accountNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "introducing_brokers_code_key" ON "introducing_brokers"("code");
