-- Sự kiện quyền (cổ tức, cổ phiếu thưởng, quyền mua) quét từ VNStock.
-- Viết tay từ `prisma migrate diff` thay vì `migrate dev`: migrate dev đòi reset database
-- vì migration 20260916004352_ib_broker bị sửa sau khi đã chạy. Chỉ gồm hai bảng mới.

-- CreateTable
CREATE TABLE "corporate_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'VNSTOCK:VCI',
    "stockId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "titleVi" TEXT NOT NULL,
    "exRightDate" DATETIME NOT NULL,
    "recordDate" DATETIME,
    "payoutDate" DATETIME,
    "publicDate" DATETIME,
    "cashPerShare" BIGINT,
    "ratioE9" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "corporate_events_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "corporate_event_resolutions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "capitalFlowId" TEXT,
    "tradeId" TEXT,
    "reason" TEXT,
    "resolvedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "corporate_event_resolutions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "corporate_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "corporate_event_resolutions_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "broker_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "corporate_event_resolutions_capitalFlowId_fkey" FOREIGN KEY ("capitalFlowId") REFERENCES "capital_flows" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "corporate_event_resolutions_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "corporate_event_resolutions_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);


-- CreateIndex
CREATE UNIQUE INDEX "corporate_events_sourceId_key" ON "corporate_events"("sourceId");

-- CreateIndex
CREATE INDEX "corporate_events_exRightDate_idx" ON "corporate_events"("exRightDate");

-- CreateIndex
CREATE INDEX "corporate_events_stockId_idx" ON "corporate_events"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_event_resolutions_capitalFlowId_key" ON "corporate_event_resolutions"("capitalFlowId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_event_resolutions_tradeId_key" ON "corporate_event_resolutions"("tradeId");

-- CreateIndex
CREATE INDEX "corporate_event_resolutions_brokerAccountId_idx" ON "corporate_event_resolutions"("brokerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_event_resolutions_eventId_brokerAccountId_key" ON "corporate_event_resolutions"("eventId", "brokerAccountId");

