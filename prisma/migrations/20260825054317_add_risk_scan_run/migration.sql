-- AlterTable
ALTER TABLE "risk_alerts" ADD COLUMN "targetRef" TEXT;

-- CreateTable
CREATE TABLE "risk_scan_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "rulesEvaluated" INTEGER NOT NULL DEFAULT 0,
    "alertsOpened" INTEGER NOT NULL DEFAULT 0,
    "alertsUpdated" INTEGER NOT NULL DEFAULT 0,
    "alertsResolved" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "triggeredById" TEXT,
    CONSTRAINT "risk_scan_runs_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "risk_scan_runs_startedAt_idx" ON "risk_scan_runs"("startedAt");

-- CreateIndex
CREATE INDEX "risk_scan_runs_status_idx" ON "risk_scan_runs"("status");

-- CreateIndex
CREATE INDEX "risk_alerts_ruleId_targetRef_status_idx" ON "risk_alerts"("ruleId", "targetRef", "status");
