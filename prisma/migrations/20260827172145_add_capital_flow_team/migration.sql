-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_capital_flows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "flowType" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "teamId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "capital_flows_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "capital_flows_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "capital_flows_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "capital_flows_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_capital_flows" ("amount", "approvedAt", "approvedById", "createdAt", "createdById", "flowType", "id", "note", "occurredAt", "portfolioId", "reference", "status", "updatedAt") SELECT "amount", "approvedAt", "approvedById", "createdAt", "createdById", "flowType", "id", "note", "occurredAt", "portfolioId", "reference", "status", "updatedAt" FROM "capital_flows";
DROP TABLE "capital_flows";
ALTER TABLE "new_capital_flows" RENAME TO "capital_flows";
CREATE INDEX "capital_flows_portfolioId_occurredAt_idx" ON "capital_flows"("portfolioId", "occurredAt");
CREATE INDEX "capital_flows_flowType_idx" ON "capital_flows"("flowType");
CREATE INDEX "capital_flows_portfolioId_teamId_status_idx" ON "capital_flows"("portfolioId", "teamId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
