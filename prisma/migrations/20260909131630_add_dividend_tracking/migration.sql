-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_capital_flows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "flowType" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "stockId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "teamId" TEXT,
    "brokerAccountId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "capital_flows_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "capital_flows_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "capital_flows_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "broker_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "capital_flows_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "capital_flows_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "capital_flows_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_capital_flows" ("amount", "approvedAt", "approvedById", "brokerAccountId", "createdAt", "createdById", "flowType", "id", "note", "occurredAt", "portfolioId", "reference", "status", "teamId", "updatedAt") SELECT "amount", "approvedAt", "approvedById", "brokerAccountId", "createdAt", "createdById", "flowType", "id", "note", "occurredAt", "portfolioId", "reference", "status", "teamId", "updatedAt" FROM "capital_flows";
DROP TABLE "capital_flows";
ALTER TABLE "new_capital_flows" RENAME TO "capital_flows";
CREATE INDEX "capital_flows_portfolioId_occurredAt_idx" ON "capital_flows"("portfolioId", "occurredAt");
CREATE INDEX "capital_flows_flowType_idx" ON "capital_flows"("flowType");
CREATE INDEX "capital_flows_portfolioId_teamId_status_idx" ON "capital_flows"("portfolioId", "teamId", "status");
CREATE INDEX "capital_flows_brokerAccountId_idx" ON "capital_flows"("brokerAccountId");
CREATE TABLE "new_trades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" BIGINT NOT NULL,
    "fees" BIGINT NOT NULL DEFAULT 0,
    "tax" BIGINT NOT NULL DEFAULT 0,
    "executedAt" DATETIME NOT NULL,
    "isStockDividend" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "brokerAccountId" TEXT,
    "orderId" TEXT,
    "broker" TEXT,
    "executionNote" TEXT,
    "investmentThesis" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "cancelledById" TEXT,
    "cancelledAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "trades_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "trades_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "trades_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "trades_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trades_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "broker_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trades_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "trades_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trades_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trades_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_trades" ("approvedAt", "approvedById", "broker", "brokerAccountId", "cancelledAt", "cancelledById", "code", "createdAt", "createdById", "executedAt", "executionNote", "fees", "id", "investmentThesis", "orderId", "portfolioId", "price", "quantity", "status", "stockId", "tax", "teamId", "transactionType", "updatedAt", "updatedById", "userId", "version") SELECT "approvedAt", "approvedById", "broker", "brokerAccountId", "cancelledAt", "cancelledById", "code", "createdAt", "createdById", "executedAt", "executionNote", "fees", "id", "investmentThesis", "orderId", "portfolioId", "price", "quantity", "status", "stockId", "tax", "teamId", "transactionType", "updatedAt", "updatedById", "userId", "version" FROM "trades";
DROP TABLE "trades";
ALTER TABLE "new_trades" RENAME TO "trades";
CREATE UNIQUE INDEX "trades_code_key" ON "trades"("code");
CREATE INDEX "trades_portfolioId_executedAt_idx" ON "trades"("portfolioId", "executedAt");
CREATE INDEX "trades_stockId_executedAt_idx" ON "trades"("stockId", "executedAt");
CREATE INDEX "trades_status_idx" ON "trades"("status");
CREATE INDEX "trades_userId_idx" ON "trades"("userId");
CREATE INDEX "trades_teamId_idx" ON "trades"("teamId");
CREATE INDEX "trades_brokerAccountId_idx" ON "trades"("brokerAccountId");
CREATE INDEX "trades_transactionType_idx" ON "trades"("transactionType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
