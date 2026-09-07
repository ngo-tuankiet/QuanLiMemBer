# Chuyển từ SQLite sang PostgreSQL

Phase 01 chạy trên SQLite để không cần cài đặt gì. Schema được thiết kế sẵn cho
việc chuyển đổi: **không có quan hệ nào phải thay đổi**, chỉ đổi kiểu của một số
cột và bật thêm vài ràng buộc mà SQLite không làm được.

Thời điểm nên chuyển: **trước Phase 08 (Dashboard)**. Lúc đó dữ liệu bắt đầu có
khối lượng thật và cần đến index/aggregate của Postgres. Chuyển sớm hơn cũng
được, không có gì cản.

---

## 1. Những gì KHÔNG cần thay đổi

Đây là phần quan trọng nhất, và là kết quả của các quyết định ở Phase 01:

| | Vì sao không đổi |
|---|---|
| Toàn bộ cột tiền `BigInt` | `INTEGER` 64-bit trên SQLite ↔ `BIGINT` trên Postgres. Giá trị giống nhau từng đồng. |
| Toàn bộ cột tỷ lệ `Int` (bps) | `INTEGER` cả hai bên. |
| Mọi quan hệ, khoá ngoại, index | Prisma sinh ra tương đương. |
| Mọi code nghiệp vụ | Vì nguồn sự thật của enum là `src/lib/enums.ts`, không phải database. |
| `src/lib/money.ts`, `serialize.ts`, `validation.ts`, `permissions.ts` | Không chạm tới. |

Nếu bạn đã từng lưu tiền bằng `Float` thì bước chuyển đổi này sẽ là một cuộc đối
chiếu số liệu đau đớn. Đó chính là lý do Phase 01 không làm vậy.

---

## 2. Các bước

### Bước 1 — Dựng Postgres

```bash
docker run -d --name vn-investment-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vn_investment postgres:17-alpine
```

Cập nhật `.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vn_investment?schema=public"
```

### Bước 2 — Đổi provider

Trong `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Bước 3 — Đổi `String` thành `enum`

SQLite không có enum nên các cột này đang là `String`. Danh sách giá trị hợp lệ
đã có sẵn trong [`src/lib/enums.ts`](../src/lib/enums.ts) — chỉ việc chép sang.

Thêm vào schema:

```prisma
enum UserStatus            { PENDING ACTIVE SUSPENDED REJECTED }
enum PermissionEffect      { GRANT DENY }
enum Exchange              { HOSE HNX UPCOM }
enum StockStatus           { ACTIVE SUSPENDED DELISTED WATCHLIST }
enum PortfolioStatus       { ACTIVE CLOSED ARCHIVED }
enum AccessLevel           { VIEW TRADE MANAGE }
enum CapitalFlowType       { CONTRIBUTION WITHDRAWAL DIVIDEND INTEREST OTHER_INCOME OTHER_EXPENSE }
enum CapitalFlowStatus     { PENDING CONFIRMED CANCELLED }
enum TransactionType       { BUY SELL }
enum TradeStatus           { DRAFT PENDING_APPROVAL APPROVED EXECUTED REJECTED CANCELLED }
enum SyncKind              { QUOTE HISTORY INDEX STOCK_MASTER }
enum SyncStatus            { RUNNING SUCCESS PARTIAL FAILED }
enum SyncTrigger           { CRON MANUAL STARTUP }
enum RiskScope             { STOCK SECTOR STRATEGY PORTFOLIO MARKET_DATA APPROVAL }
enum RiskMetric            { WEIGHT_BPS PNL_BPS CASH_BPS DATA_DELAY_MINUTES PENDING_COUNT }
enum Comparator            { GT GTE LT LTE }
enum Severity              { INFO WARNING HIGH CRITICAL }
enum AlertStatus           { OPEN ACKNOWLEDGED RESOLVED }
enum ApprovalStatus        { PENDING APPROVED REJECTED CANCELLED }
enum SettingValueType      { STRING INT BIGINT BOOL JSON }
enum SettingGroup          { GENERAL TRADING MARKET_DATA RISK }
```

Rồi đổi kiểu cột tương ứng, ví dụ:

```prisma
model User {
  status UserStatus @default(PENDING)   // trước: String @default("PENDING")
}

model Trade {
  transactionType TransactionType       // trước: String
  status          TradeStatus @default(DRAFT)
}
```

Các cột `action` / `entityType` của `audit_logs` **nên giữ nguyên `String`**: danh
mục hành động và loại thực thể sẽ còn mở rộng theo từng phase, và một bảng chỉ
ghi thêm thì không nên bị ràng buộc bởi enum phải migrate mỗi lần thêm giá trị.

### Bước 4 — Đổi `String` thành `Jsonb`

Các cột JSON text (tên kết thúc bằng `Json`):

```prisma
model AuditLog {
  beforeJson        Json?   // trước: String?
  afterJson         Json?
  changedFieldsJson Json?
}

model RiskAlert       { contextJson Json? }
model ApprovalRequest { payloadJson Json? }
```

Sau đó bỏ `stringifyForAudit()` / `parseJsonField()` ở các chỗ ghi/đọc — nhưng
**vẫn phải giữ `jsonify()`** để chuyển `bigint` thành string trước khi đưa vào
cột Json, vì `bigint` không phải kiểu JSON hợp lệ.

### Bước 5 — Tạo migration mới

Migration SQLite cũ không dùng lại được. Xoá và sinh lại từ đầu:

```bash
rm -rf prisma/migrations prisma/dev.db
npx prisma migrate dev --name init_postgres
npm run db:seed
```

Nếu **đã có dữ liệu thật** trên SQLite, xem phần 4 bên dưới.

### Bước 6 — Bật các ràng buộc mà SQLite không làm được

Tạo một migration thủ công:

```bash
npx prisma migrate dev --create-only --name hardening
```

rồi thêm vào file `.sql` vừa sinh:

> **Chú ý về cách đặt tên cột.** Schema chỉ dùng `@@map` cho tên bảng
> (`snake_case`), còn **tên cột giữ nguyên camelCase** như trong Prisma:
> bảng là `trade_strategies` nhưng cột là `"allocationBps"`, `"tradeId"`.
> Vì camelCase, mọi tên cột trong SQL viết tay **bắt buộc phải nằm trong dấu
> ngoặc kép** — không có ngoặc kép, Postgres tự hạ về chữ thường và báo
> `column "allocationbps" does not exist`.

```sql
-- ---------------------------------------------------------------------------
-- 1. Audit Log bất biến ở tầng database (§20 "không sửa mất dấu vết")
--    Ứng dụng chỉ được INSERT và SELECT. Không ai — kể cả code có lỗi — sửa
--    hay xoá được một bản ghi audit.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
-- Thay app_user bằng role thật mà ứng dụng dùng để kết nối:
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

-- ---------------------------------------------------------------------------
-- 2. Ràng buộc miền giá trị
-- ---------------------------------------------------------------------------
ALTER TABLE trade_strategies
  ADD CONSTRAINT chk_allocation_bps_range
  CHECK ("allocationBps" > 0 AND "allocationBps" <= 10000);

ALTER TABLE trades
  ADD CONSTRAINT chk_trade_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT chk_trade_price_positive    CHECK (price > 0),
  ADD CONSTRAINT chk_trade_fees_nonneg       CHECK (fees >= 0 AND tax >= 0);

ALTER TABLE capital_flows
  ADD CONSTRAINT chk_capital_amount_positive CHECK (amount > 0);

ALTER TABLE portfolios
  ADD CONSTRAINT chk_reserve_nonneg CHECK ("reserveAmount" >= 0);

-- ---------------------------------------------------------------------------
-- 3. Σ allocationBps của một trade phải bằng 10000
--    CHECK không biểu diễn được ràng buộc liên-dòng, nên dùng constraint
--    trigger chạy ở cuối transaction (DEFERRABLE INITIALLY DEFERRED) —
--    nhờ vậy việc chèn từng dòng phân bổ trong cùng transaction vẫn hợp lệ.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_trade_allocation_total()
RETURNS TRIGGER AS $$
DECLARE
  target_trade_id TEXT;
  total_bps       INTEGER;
BEGIN
  target_trade_id := COALESCE(NEW."tradeId", OLD."tradeId");

  SELECT COALESCE(SUM("allocationBps"), 0) INTO total_bps
  FROM trade_strategies WHERE "tradeId" = target_trade_id;

  -- 0 nghĩa là toàn bộ phân bổ đã bị xoá cùng với trade (ON DELETE CASCADE).
  IF total_bps NOT IN (0, 10000) THEN
    RAISE EXCEPTION
      'Trade % co tong phan bo % bps, phai bang 10000 bps (100%%)',
      target_trade_id, total_bps;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_trade_allocation_total
  AFTER INSERT OR UPDATE OR DELETE ON trade_strategies
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_trade_allocation_total();
```

> Trigger này là lớp bảo vệ **thứ tư**, sau zod, sau `buildTradeStrategyRows()`,
> và sau `verify:model`. Với một hệ thống quản lý vốn thì mức dư thừa đó là hợp lý:
> nó chặn cả trường hợp có người sửa dữ liệu trực tiếp bằng SQL.

Sau đó:

```bash
npx prisma migrate dev
```

### Bước 7 — Index cho khối lượng dữ liệu lớn

Khi `price_history` vượt vài triệu dòng:

```sql
-- Truy vấn thường xuyên nhất của Portfolio Engine
CREATE INDEX idx_trades_portfolio_status_date
  ON trades ("portfolioId", status, "executedAt" DESC);

-- Tổng hợp theo chiến lược
CREATE INDEX idx_trade_strategies_strategy_trade
  ON trade_strategies ("strategyId", "tradeId");

-- Chỉ đánh index phần CHƯA ĐÓNG của cảnh báo.
-- Phải gồm cả ACKNOWLEDGED: Risk Engine và mọi trang hiển thị đều truy vấn
-- status IN ('OPEN','ACKNOWLEDGED'), nên một partial index chỉ có 'OPEN' sẽ
-- không được planner dùng tới.
CREATE INDEX idx_risk_alerts_live
  ON risk_alerts ("triggeredAt" DESC)
  WHERE status IN ('OPEN', 'ACKNOWLEDGED');

-- Khoá chống trùng mà mỗi lượt quét tra cứu
CREATE INDEX idx_risk_alerts_dedupe
  ON risk_alerts ("ruleId", "portfolioId", "targetRef", status);

-- Lượt quét gần nhất — đọc mỗi lần mở Dashboard hoặc trang Risk
CREATE INDEX idx_risk_scan_runs_recent
  ON risk_scan_runs ("startedAt" DESC);

-- Audit log tra cứu theo người thực hiện và thời gian.
-- Bộ lọc trên UI tìm theo BẢN CHỤP actorName/actorEmail chứ không theo
-- actorUserId (để dòng của tài khoản đã xoá vẫn tìm được), nên cần index riêng
-- cho cột đó — trgm để `contains` dùng được index.
CREATE INDEX idx_audit_actor_time
  ON audit_logs ("actorUserId", "occurredAt" DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_audit_actor_email_trgm
  ON audit_logs USING gin ("actorEmail" gin_trgm_ops);
CREATE INDEX idx_audit_actor_name_trgm
  ON audit_logs USING gin ("actorName" gin_trgm_ops);

-- Lọc theo loại đối tượng + thời gian (chip lọc trên trang Audit Log)
CREATE INDEX idx_audit_entity_time
  ON audit_logs ("entityType", "occurredAt" DESC);
```

Cân nhắc **phân vùng theo thời gian** cho `price_history` và `audit_logs` khi
chúng vượt ~50 triệu dòng.

---

## 3. Kiểm tra sau khi chuyển

```bash
npm run db:seed
npm run db:seed:demo
npm run verify:model
```

`verify:model` phải in ra **đúng từng đồng** như trên SQLite. Nếu có sai khác, đó
là dấu hiệu một cột tiền đã bị đổi kiểu sai — kiểm tra lại xem có cột nào vô tình
thành `Decimal` hoặc `Float` không.

Thử thêm một phép kiểm tra tiêu cực để chắc chắn trigger đã hoạt động:

```sql
BEGIN;
INSERT INTO trade_strategies (id, "tradeId", "allocationBps", "allocationAmount", "strategyId", "createdAt")
VALUES ('test', '<một tradeId có thật>', 5000, 0, '<một strategyId>', now());
COMMIT;   -- phải thất bại: tổng thành 15000 bps
```

---

## 4. Nếu đã có dữ liệu thật trên SQLite

Đừng dùng công cụ chuyển đổi tự động — chúng thường xử lý sai `BigInt` và
`DateTime`. Cách an toàn:

1. Viết script `scripts/export-sqlite.ts` dùng Prisma client trỏ vào SQLite, đọc
   từng bảng theo **thứ tự phụ thuộc** và ghi ra JSON (dùng `jsonify()` để
   `bigint` thành string).
2. Dựng schema Postgres rỗng bằng `prisma migrate deploy`.
3. Viết `scripts/import-postgres.ts` đọc JSON, `BigInt(...)` các chuỗi số tiền,
   và `createMany` theo đúng thứ tự đó.
4. Chạy `verify:model` trên cả hai database rồi **so sánh output từng dòng**.
   Giống nhau tuyệt đối thì mới coi là chuyển thành công.

Thứ tự phụ thuộc:

```
roles → permissions → role_permissions
departments → teams → users → user_permissions
sectors → industries → stocks
portfolios → portfolio_accesses → capital_flows
strategies → trades → trade_strategies → trade_attachments
market_quotes / price_history / market_index_history / market_data_syncs
portfolio_snapshots
risk_rules → risk_alerts
risk_scan_runs
approval_requests
audit_logs
system_settings
```

---

## 5. Lưu ý khi triển khai production

- **Connection pool**: Next.js serverless mở nhiều kết nối. Dùng PgBouncer ở chế
  độ transaction, hoặc thêm `?pgbouncer=true&connection_limit=1` vào
  `DATABASE_URL`.
- **Múi giờ**: đặt server ở UTC, chỉ đổi sang `Asia/Ho_Chi_Minh` khi hiển thị.
  Ngày giao dịch chốt theo giờ Việt Nam — đã có sẵn ở setting
  `general.timezone`.
- **Backup**: `pg_dump` hằng ngày là mức tối thiểu. Với hệ thống quản lý vốn nên
  bật WAL archiving để có point-in-time recovery.
- **Quyền của app user**: cấp `SELECT, INSERT, UPDATE, DELETE` trên các bảng
  nghiệp vụ nhưng **chỉ `SELECT, INSERT`** trên `audit_logs`. Đây là điểm khác
  biệt lớn nhất so với SQLite và là lý do chính đáng để chuyển sang Postgres
  trước khi hệ thống chạy thật.
