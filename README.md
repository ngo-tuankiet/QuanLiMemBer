# Vietnam Securities Investment Management Dashboard

Hệ thống quản lý danh mục đầu tư chứng khoán Việt Nam theo mô hình phân tầng —
một **Investment Control Center**, không phải một dashboard thống kê.

Đặc tả đầy đủ: [`docs/SPEC.md`](docs/SPEC.md)

---

## Trạng thái

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **01** | **Database & Data Model** | **Xong** |
| **02** | **Authentication + User + Role + Permission** | **Xong** |
| **03** | **Stock Master + Sector** | **Xong** |
| **04** | **Portfolio + Transaction** | **Xong** |
| **05** | **Multi-Strategy Trade** | **Xong** |
| **06** | **Position + P&L Engine** | **Xong** |
| **07** | **VNStock Market Data** | **Xong** — service Python + vnstock đã nạp giá thật |
| **08** | **Dashboard Tầng 1** | **Xong** |
| **09** | **Risk Engine + Alert** | **Xong** — quét định kỳ, tự mở và tự đóng cảnh báo |
| **10** | **Reports + Settings + Audit** | **Xong** — 9 báo cáo CSV, giao diện Settings, Audit Log có bộ lọc |

**Phase 01** — schema 29 bảng, migration, master data (11 ngành / 31 phân ngành /
84 mã / 5 chiến lược / 63 quyền), lớp tiền tệ và validation, cùng một script kiểm
chứng mô hình chạy được.

**Phase 02** — app Next.js chạy được: đăng ký, đăng nhập, phiên lưu trong database
(thu hồi được ngay), buộc đổi mật khẩu lần đầu, luồng Admin duyệt tài khoản, gán
Role/Department/Team, override quyền GRANT/DENY cho từng người, ma trận quyền, và
trang Audit Log hiển thị Before/After.

**Phase 03–06, 08** — hệ thống dùng được thật: quản lý mã chứng khoán và ngành,
nhập giao dịch với phân bổ đa chiến lược (chặn ngay khi tổng ≠ 100%), luồng duyệt
theo nguyên tắc bốn mắt, Portfolio Engine tính vị thế / giá vốn TB / P&L / tỷ
trọng hoàn toàn từ giao dịch, và Executive Control Center với KPI, Sector
Exposure, Strategy Allocation, Top Positions, Recent Activity, Risk Alerts.

**Phase 07** — Market Data Service bằng Python + `vnstock`, nạp giá thật vào
database qua cổng nội bộ có xác thực. Hướng dẫn và cấu hình nguồn giá:
[services/market-data/](services/market-data/README.md).

**Phase 09** — Risk Engine đo tám ngưỡng trên mọi danh mục rồi lưu vào
`risk_alerts`: tự mở cảnh báo mới, tự đóng cảnh báo hết điều kiện, và giữ
`triggeredAt` để trả lời "vi phạm này có từ khi nào". Ba đường kích hoạt —
bộ hẹn giờ ngoài, quét lười khi mở trang, và bấm tay. Chi tiết:
[docs/RISK-ENGINE.md](docs/RISK-ENGINE.md).

**Phase 10** — 9 báo cáo xuất CSV cộng **một tệp tổng Excel để lưu trữ**, giao
diện Settings có ràng buộc theo từng tham số, và Audit Log lọc được theo hành động
/ đối tượng / người thực hiện / khoảng ngày kèm nút xuất theo đúng bộ lọc. Mọi lần
xuất đều vào Audit Log.

Tệp tổng (`/api/reports/archive`) là một workbook 19 sheet: 9 báo cáo số liệu,
9 bảng master data, và một sheet "Thông tin xuất". Có master data thì tệp còn giải
mã được về sau — thiếu nó thì phần số liệu chỉ còn là một mớ mã không tra được.
Chín sheet số liệu dựng từ ĐÚNG các builder mà bản CSV dùng, nên tệp tổng không
thể lệch với tệp lẻ.

Còn lại trước khi dùng thật: chuyển sang PostgreSQL để khoá `audit_logs`
(xem [docs/POSTGRES-MIGRATION.md](docs/POSTGRES-MIGRATION.md)), và `portfolio_snapshots`
vẫn chưa có tiến trình ghi cuối ngày.

---

## Kiến trúc

```
   bộ hẹn giờ ────POST /api/risk/scan───┐
                                        ▼
                        ┌─────────────────────────┐
                        │   Next.js (App Router)  │   Phase 02–10
                        │   UI + Server Actions   │
                        │   Risk Engine · Reports │
                        └───────────┬─────────────┘
                                    │  Prisma
                        ┌───────────▼─────────────┐
                        │   PostgreSQL / SQLite   │   Phase 01
                        └───────────▲─────────────┘
                                    │  ghi giá qua /api/market-data/ingest
                        ┌───────────┴─────────────┐
                        │  Market Data Service    │   Phase 07
                        │  Python + vnstock       │
                        └───────────▲─────────────┘
                                    │
                              VNStock API
```

Frontend **không bao giờ** gọi VNStock trực tiếp (§23). Market Data Service là
một tiến trình Python riêng — `vnstock` là thư viện Python nên đây là cách gọi
đúng bản chất của nó thay vì bọc qua nhiều lớp.

Risk Engine chạy **trong** app chứ không thành một service riêng: nó chỉ đọc lại
những gì Portfolio Engine đã tính, nên tách ra sẽ phải nhân đôi toàn bộ logic
tính vị thế sang một tiến trình thứ hai — và hai bản đó sẽ lệch nhau. Bộ hẹn giờ
bên ngoài chỉ cần gõ vào một endpoint.

---

## Bắt đầu

Yêu cầu: Node.js ≥ 20. Không cần cài database — mặc định dùng SQLite.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npx prisma migrate dev
```

```bash
npm run db:seed
```

Nạp thêm dữ liệu minh hoạ rồi kiểm chứng mô hình:

```bash
npm run db:seed:demo && npm run verify:model
```

Chạy app:

```bash
npm run dev
```

Mở http://localhost:3000

### Tài khoản khởi tạo

| Tài khoản | Vai trò | Nguồn mật khẩu |
|---|---|---|
| `admin@vninvest.local` | ADMIN | biến `ADMIN_PASSWORD` trong `.env` |
| `manager@vninvest.local` | SENIOR_MANAGER | `Demo@2026Pass` (chỉ có sau `db:seed:demo`) |
| `pm@vninvest.local` | EXECUTION | `Demo@2026Pass` |
| `trader1@`, `trader2@` | EXECUTION | `Demo@2026Pass` |
| `support1@vninvest.local` | SUPPORTING_EXECUTION | `Demo@2026Pass` |
| `pending@vninvest.local` | *chưa gán* — trạng thái PENDING | `Demo@2026Pass` |

Mọi tài khoản đều có `mustChangePassword = true`: lần đăng nhập đầu bị buộc sang
trang đổi mật khẩu, và mật khẩu do hệ thống khởi tạo không dùng tiếp được. Đổi mật
khẩu sẽ thu hồi mọi phiên, kể cả phiên đang dùng, nên phải đăng nhập lại.

Auth **không cần secret nào** trong `.env` — hệ thống dùng token opaque tra
database, không dùng JWT. Xem [docs/AUTH.md](docs/AUTH.md).

---

## Lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy app ở http://localhost:3000 |
| `npm run build` | Build production ra `.next-build/` (kèm `prisma generate`) |
| `npm run build:app` | Như trên nhưng bỏ `prisma generate` — dùng khi schema chưa đổi |
| `npm run db:migrate` | Tạo và áp dụng migration mới |
| `npm run db:reset` | Xoá sạch database, chạy lại migration + seed |
| `npm run db:seed` | Nạp master data (an toàn khi chạy lại) |
| `npm run db:seed:demo` | Nạp dữ liệu minh hoạ — **chỉ dùng khi phát triển** |
| `npm run verify:model` | Kiểm chứng mô hình; thoát mã 1 nếu có bất biến bị vi phạm |
| `npm run risk:scan` | Chạy một lượt quét rủi ro (app phải đang chạy) |
| `npx tsx scripts/migrate-teams.ts` | Dời dữ liệu sang cơ cấu nhóm mới (`--apply` để ghi) |
| `npx tsx scripts/prune-permissions.ts` | Dọn quyền đã bỏ khỏi code (`--apply` để xoá) |
| `npm run risk:scan -- --check` | Xem trạng thái Risk Engine, không quét |
| `npm run db:studio` | Mở Prisma Studio |
| `npm run typecheck` | `tsc --noEmit` |

Phụ thuộc thời gian chạy duy nhất được thêm ngoài Next/Prisma/zod:
**`write-excel-file`** (1,8 MB, MIT, một phụ thuộc con) để sinh tệp tổng .xlsx.
Chọn nó thay `exceljs` (21,8 MB, chín phụ thuộc con — và là thư viện đọc-ghi khi
ở đây chỉ cần ghi); bản `xlsx` trên npm đứng ở 0.18.5 kèm cảnh báo bảo mật nên bị
loại.

Market Data Service — chạy trong thư mục `services/market-data` bằng Python của venv:

| Lệnh | Tác dụng |
|---|---|
| `python sync.py check` | Kiểm tra cấu hình và kết nối, không ghi gì vào database |
| `python sync.py quotes` | Lấy giá một lần |
| `python sync.py quotes --loop` | Chạy liên tục, tự nghỉ ngoài giờ giao dịch |
| `python sync.py history --days 90` | Lấy OHLCV lịch sử |
| `python sync.py index --days 365` | Lấy lịch sử VN-Index để tính Alpha |

---

## Cấu trúc

```
.
├── app/                          Next.js App Router
│   ├── login/ register/          công khai
│   ├── pending/                  tài khoản chờ duyệt / bị khoá
│   ├── change-password/          buộc đổi mật khẩu lần đầu
│   ├── forbidden.tsx             trang 403
│   └── (app)/                    khu vực đã đăng nhập
│       ├── layout.tsx            requireUser() — chốt chặn thật
│       ├── dashboard/ portfolio/ transactions/ strategies/
│       ├── market/sectors/ market/market-data/
│       ├── risk/ reports/ settings/ audit/
│       ├── teams/ members/ approvals/ profile/
│       └── admin/users/ admin/permissions/
│
├── proxy.ts                      kiểm tra lạc quan (Next 16 đổi tên từ middleware)
│
├── prisma/
│   ├── schema.prisma             29 bảng, chú thích theo từng mục của đặc tả
│   ├── migrations/               migration đã sinh
│   ├── seed.ts                   master data — chạy lại được, dùng upsert
│   └── seed-demo.ts              giao dịch minh hoạ, đi qua đúng đường ghi thật
│
├── src/
│   ├── auth/
│   │   ├── session.ts            token opaque + bảng sessions, thu hồi được ngay
│   │   ├── guards.ts             requireUser / requirePagePermission / requirePermission
│   │   ├── password.ts           bcrypt cost 12, chống dò email qua thời gian
│   │   └── actions.ts            đăng ký / đăng nhập / đăng xuất / đổi mật khẩu
│   ├── admin/
│   │   └── actions.ts            duyệt, khoá, gán vai trò, override quyền
│   ├── market/
│   │   └── actions.ts            ngành, phân ngành, nhập giá thủ công
│   ├── trading/
│   │   └── actions.ts            ĐƯỜNG GHI DUY NHẤT vào trades + trade_strategies
│   ├── lib/
│   │   ├── enums.ts              nguồn sự thật cho mọi giá trị enum
│   │   ├── money.ts              BigInt VNĐ, basis point, allocateAmount()
│   │   ├── audit.ts              ghi Audit Log, tính diff Before/After
│   │   ├── serialize.ts          bigint → JSON an toàn
│   │   └── prisma.ts             client dùng chung
│   ├── domain/
│   │   ├── permissions.ts        63 quyền + ma trận Role → Permission
│   │   ├── portfolio-engine.ts   tính vị thế / P&L / tỷ trọng / ngành / chiến lược
│   │   ├── risk-engine.ts        ĐO ngưỡng rủi ro — thuần tính, không chạm DB
│   │   └── validation.ts         zod; cưỡng chế Σ phân bổ = 100%
│   ├── risk/
│   │   ├── scan.ts               GHI risk_alerts: mở / cập nhật / tự đóng
│   │   └── actions.ts            tiếp nhận cảnh báo, sửa ngưỡng, quét tay
│   ├── reports/
│   │   ├── catalog.ts            danh mục 9 báo cáo, dùng chung UI và route
│   │   ├── build.ts              dựng dữ liệu — tính lại, không đọc số lưu sẵn
│   │   ├── csv.ts                BOM + CRLF + chống CSV injection
│   │   └── archive.ts            tệp tổng .xlsx 19 sheet, gồm cả master data
│   ├── settings/
│   │   ├── bounds.ts             ràng buộc từng tham số, dùng chung UI và action
│   │   └── actions.ts            sửa cấu hình, ghi Before/After vào Audit Log
│   ├── components/               AppShell, ActionForm, charts, theme, ui
│   └── data/
│       └── master-data.ts        ngành, mã CK, chiến lược, ngưỡng rủi ro, cấu hình
│
├── services/market-data/         Phase 07 — nguồn giá
│   ├── config.py                 NƠI KHAI BÁO NGUỒN GIÁ
│   ├── vnstock_source.py         bọc vnstock, chuẩn hoá đơn vị giá
│   └── sync.py                   CLI: check / quotes / history / index
│
├── scripts/
│   ├── build.mjs                 build ra thư mục riêng, không đụng dev server
│   ├── risk-scan.mjs             gọi /api/risk/scan — lệnh cho bộ hẹn giờ
│   ├── migrate-teams.ts          dời người và lệnh sang cơ cấu nhóm mới
│   ├── prune-permissions.ts      dọn quyền đã bị loại khỏi code
│   ├── set-setting.ts            xem/sửa system_settings từ dòng lệnh
│   ├── prune-settings.ts         dọn tham số đã bị bỏ khỏi code
│   └── verify-model.ts           bằng chứng mô hình đáp ứng đặc tả
│
└── docs/
    ├── SPEC.md                   đặc tả gốc
    ├── DATA-MODEL.md             vì sao schema có hình dạng như vậy
    ├── AUTH.md                   quyết định thiết kế của tầng auth
    ├── RISK-ENGINE.md            đo/ghi, chống trùng, tự đóng, thang màu mức
    ├── UI-CHARTS.md              hệ màu hai chế độ + quy tắc biểu đồ
    └── POSTGRES-MIGRATION.md     quy trình chuyển sang Postgres
```

---

## Nhóm, Vai trò, Chiến lược — ba thứ khác nhau

Đây là chỗ dễ lẫn nhất của mô hình, và đã từng lẫn thật: ba nhóm ban đầu được
đặt tên theo vai trò ("Nhóm thực thi", "Nhóm hỗ trợ thực thi"), nên trang Members
in ra cùng một chữ ở cả cột Vai trò và cột Nhóm.

| Trục | Trả lời | Giá trị | Nằm ở |
|---|---|---|---|
| **Nhóm** | làm việc với ai | Đá Bóng · Cầu Lông · Tài chính · Cá nhân | bảng `teams` |
| **Vai trò** | được làm gì | Thực thi · Hỗ trợ thực thi · Quản lý cấp cao · Thành viên · Quản trị | `ROLE_PERMISSIONS` |
| **Chiến lược** | đang làm gì | Định giá rẻ · Tín hiệu · Tích sản · Sóng ngành · Khác | `trade_strategies` |

Ba điều đi theo:

1. **Đổi nhóm không đổi quyền.** Quyền chỉ đến từ vai trò và từ override trong
   `user_permissions`. Một MEMBER trong nhóm Đá Bóng vẫn không nhập được lệnh.
2. **Chiến lược là quan sát, không phải phân công.** Không có bảng nối người ↔
   chiến lược (§4). Chiến lược của một người được suy từ giao dịch họ đã làm — xem
   trang Teams.
3. **"Cá nhân" là một nhóm thật, không phải chỗ trống.** `applyScope()` ép người
   chỉ có quyền `*.view` về nhóm của họ, nên người không thuộc nhóm nào sẽ không
   thấy gì — kể cả giao dịch của chính mình. Người giao dịch một mình đứng ở nhóm
   "Cá nhân".

Đổi cơ cấu nhóm trên một database đang có dữ liệu:

```bash
npx tsx scripts/migrate-teams.ts
```

Chạy không tham số để xem trước, thêm `--apply` để thực hiện. Giao dịch đi theo
**người thực hiện**, không theo nhóm cũ.

---

## Ba quy ước không được vi phạm

Ai làm tiếp các phase sau cần nắm ba điều này. Chi tiết trong
[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md).

### 1. Tiền là `bigint`, đơn vị VNĐ nguyên

Không `Float`, không `Decimal`, không `number`. Giá cổ phiếu Việt Nam vốn đã là
số nguyên đồng nên `bigint` cho phép cộng/trừ/nhân chính xác tuyệt đối, và lưu
giống nhau trên cả SQLite lẫn Postgres.

Vì `JSON.stringify` không xử lý được `bigint`, mọi biên giới ra ngoài phải đi qua
`jsonify()` trong `src/lib/serialize.ts` — chuyển thành **string**, không phải
number.

### 2. Tỷ lệ là `number` nguyên, đơn vị basis point

`10000 bps = 100.00%`. Nhờ vậy `5000 + 3000 + 2000` bằng đúng `10000`, không
phải `99.99999999999999`.

### 3. Không lưu giá trị tính toán

Position, Average Cost, Market Value, P&L, Weight, Available Cash — **không bảng
nào lưu**. Tất cả tính từ `trades` + `market_quotes` + `capital_flows`.

Hai ngoại lệ, cả hai đều là bản chụp có thể xoá rồi dựng lại:

- `portfolio_snapshots` — ảnh chụp cuối ngày cho biểu đồ hiệu suất lịch sử.
  Hiện **chưa có tiến trình nào ghi bảng này**; biểu đồ đang dựng lại từng phiên
  từ `price_history`.
- `risk_alerts.measuredValue` — số đo tại thời điểm cảnh báo bắn. Nó không phải
  giá trị tính toán được dùng lại ở đâu, mà là **bằng chứng lịch sử**: "lúc 21h
  thứ Bảy, MBB chiếm 16,64%". Tính lại hôm nay sẽ cho số khác và mất đi đúng
  thông tin cần cho việc truy vết.

---

## Điểm cần biết về mô hình đa chiến lược

Yêu cầu khó nhất của đặc tả (§6): một giao dịch phân bổ cho nhiều chiến lược,
tổng luôn đúng 100%, và vốn không được đếm trùng.

```
BUY MBB 40.000 @ 25.300     VALUE 50%  ·  SIGNAL 30%  ·  ACCUMULATION 20%
```

Ba điều được cưỡng chế bằng cấu trúc, không bằng lời nhắc:

1. **`strategyId` không nằm trên bảng `trades`** mà ở bảng nối
   `trade_strategies`. Không thể tạo giao dịch một-chiến-lược-cứng.
2. **`users` không có đường nối trực tiếp tới `strategies`.** Đúng theo §4:
   người dùng không bị gán chiến lược cố định.
3. **Số tiền phân bổ được chốt lúc ghi** bằng thuật toán largest-remainder
   (`allocateAmount()`), nên Σ phân bổ = số tiền lệnh **tuyệt đối**, kể cả khi
   chia 1/3:

   ```
   182.644.206 ₫  →  60.893.578 + 60.875.314 + 60.875.314  =  182.644.206 ₫
   ```

`npm run verify:model` kiểm tra lại toàn bộ database và thoát mã 1 nếu có dòng
nào lệch — dùng được như một health check trong CI.

---

## Hai quy tắc của tầng auth

Chi tiết trong [`docs/AUTH.md`](docs/AUTH.md).

### Phiên phải thu hồi được ngay

Hệ thống dùng **token opaque tra database**, không dùng JWT tự chứa. Lý do: JWT
không thu hồi được trước khi hết hạn, nghĩa là Admin khoá một tài khoản mà người
đó vẫn giao dịch được tới khi token tự hết. Với hệ thống quản lý vốn thì đó không
phải đánh đổi chấp nhận được.

Hệ quả cần nhớ khi làm phase sau: **đổi quyền phải kèm thu hồi phiên**. Mọi action
trong `src/admin/actions.ts` đều gọi `revokeAllSessions()`.

### `proxy.ts` không phải lớp bảo vệ

Nó chạy trên edge, không truy cập được database, và chỉ xem cookie có tồn tại hay
không. Lớp bảo vệ thật là `requireUser()` / `requirePagePermission()` — và **mọi
page phải tự gọi**, không dựa vào layout, vì Next.js không bảo đảm layout luôn
re-render khi điều hướng phía client.

---

## Bước tiếp theo

### Phase 07 — còn lại việc chạy tự động

Service đã hoạt động và nạp được giá thật. Chưa có scheduler: cần Task Scheduler
của Windows hoặc cron gọi `sync.py quotes` trong giờ giao dịch, cùng cảnh báo khi
chuỗi lỗi liên tiếp vượt ngưỡng.

### Phase 09 — Risk Engine

Cảnh báo hiện được tính trực tiếp mỗi lần mở Dashboard từ bảng `risk_rules`. Cần
một tiến trình quét theo chu kỳ, lưu vào `risk_alerts`, và cho phép xác nhận
(`risk.acknowledge_alert`) — nhờ đó cảnh báo có lịch sử thay vì chỉ là ảnh chụp
tức thời.

### Phase 10 — Reports & Settings

Xuất báo cáo (`report.export`), giao diện sửa `system_settings`
(`settings.update`), và bộ lọc/xuất file cho Audit Log.

---

## Lưu ý khi phát triển trên Windows

**Build không dùng chung thư mục với dev server.** `next dev` và `next build` mặc
định cùng ghi vào `.next/`, và trên Windows khoá file khiến dev server đang chạy
**crash ngay** khi có ai chạy build. Triệu chứng rất dễ chẩn đoán sai: mọi trang
cùng lúc "không vào được", trông như lỗi ứng dụng chứ không như lỗi tiến trình.

Vì vậy `npm run build` đi qua [`scripts/build.mjs`](scripts/build.mjs), đặt
`NEXT_DIST_DIR=.next-build` để hai tiến trình không đụng nhau. Chạy build song
song với dev server là an toàn.

**`prisma generate` vẫn xung đột** khi dev server đang giữ file
`query_engine-windows.dll.node`. Khi schema chưa đổi thì dùng `npm run build:app`
để bỏ qua bước đó; khi schema đã đổi thì tắt dev server trước.

---

### Hai mục đã bỏ khỏi hệ thống

| Mục | Vì sao bỏ | Cái gì vẫn còn |
|---|---|---|
| **Performance** (`/performance`) | Phần lớn nội dung trùng với khối "Portfolio Performance" trên Dashboard — cùng Alpha, cùng biểu đồ. | Khối trên Dashboard, và báo cáo CSV "Hiệu suất theo phiên". Hàm `computePerformance` / `computePerformanceSeries` **vẫn ở trong engine** vì hai chỗ đó dùng. |
| **Stocks** (`/market/stocks`) | Giao diện quản trị 84 mã (cờ VN30, số cổ phiếu lưu hành, lọc theo sàn) không phù hợp quy mô dự án. | Bảng `stocks` và `stock.view`. Form nhập lệnh vẫn CHỌN mã từ master data (§23), thêm mã = sửa `STOCK_SEED` rồi `npm run db:seed`. |

Kèm theo, 5 quyền đã trở thành vô nghĩa và được xoá khỏi `PERMISSIONS`:
`performance.view`, `performance.view_all`, `stock.create`, `stock.update`,
`stock.delete`. Dọn phần còn lại trong database:

```bash
npx tsx scripts/prune-permissions.ts --apply
```

Cần thiết vì `prisma/seed.ts` chỉ **upsert** bảng `permissions` — quyền bị bỏ khỏi
code vẫn nằm lại trong database và vẫn hiện trên Ma trận quyền như thể còn tác
dụng, kèm cả các override trong `user_permissions` trỏ vào nó.

---

### Kiểm tính đúng đắn

```bash
npm run verify:model      # mô hình dữ liệu có đủ để tính ra mọi con số không?
npm run audit:formulas    # các hàm engine có tính đúng không?  (66 phép kiểm)
npm run audit:pages       # các trang tự cộng lấy có khớp engine không?
```

Ba lệnh hỏi ba câu khác nhau và **không được gộp** — gộp lại thì phép kiểm sẽ so
engine với chính engine, chỉ chứng minh nó nhất quán với bản thân. Xem
[docs/DATA-MODEL.md §13](docs/DATA-MODEL.md).

### Việc kỹ thuật còn nợ

- **`portfolio_snapshots` chưa được ghi.** Bảng đã có và engine tự dùng khi có dữ
  liệu, nhưng chưa có tiến trình chốt số cuối ngày.

  Trước đây điều này làm Dashboard nói sai: `computePerformance` chỉ có hai đường
  — ảnh chụp cuối ngày, hoặc rơi về lãi/lỗ trên giá vốn toàn thời gian — nên nó
  **luôn** rơi về đường thứ hai. Kết quả đo được: cả sáu khoảng 1W/1M/3M/6M/YTD/ALL
  đều in ra cùng một con số −3,17% trong khi nhãn bên cạnh đổi theo khoảng, và
  Alpha lấy vế danh mục *toàn thời gian* trừ vế chỉ số *có lọc theo khoảng* nên
  nhảy từ +0,85% (3 tháng) xuống −20,22% (toàn bộ) chỉ vì vế chỉ số đổi.

  Đã sửa: engine nay có **ba** nguồn và ưu tiên chuỗi dựng lại từ `price_history`
  khi chưa có ảnh chụp — xem [docs/UI-CHARTS.md](docs/UI-CHARTS.md#hiệu-suất-theo-khoảng-ba-nguồn).
  Snapshot vẫn cần cho **time-weighted return** đúng chuẩn (có tính dòng vốn
  nạp/rút), thứ mà chuỗi dựng lại từ giá đóng cửa không đo được.
- **Nạp/rút vốn chỉ nhập được qua tài khoản của thành viên.** Trang
  `/members/[id]` cho **chính chủ** khai tài khoản chứng khoán và ghi nhận nạp/rút
  vốn cho từng tài khoản; mỗi lần ghi nhận là một dòng `capital_flows` (xem
  [docs/DATA-MODEL.md §11](docs/DATA-MODEL.md)). Nhưng vẫn **chưa có** trang quản lý
  dòng vốn ở cấp danh mục — cổ tức, lãi tiền gửi, và vốn không thuộc tài khoản nào
  vẫn phải nhập bằng seed hoặc script.
- **Vốn của nhóm cấp qua script.** Để chuyển một khoản vốn có sẵn sang cho một nhóm,
  dùng [`scripts/grant-capital.ts`](scripts/grant-capital.ts) (chuyển, không tạo tiền
  mới). Vốn nạp qua tài khoản thành viên thì tự gắn nhóm của người đó.
- **Không ai soát số vốn thành viên tự khai.** Theo lựa chọn nghiệp vụ: chính chủ tự
  quản tài khoản của mình, không cần quản trị, không qua duyệt. Nhật ký kiểm toán là
  chốt duy nhất. Muốn siết thì bật luồng hai mắt — `capital_flows` đã có sẵn
  `status`/`approvedById`/`approvedAt`. Điều này áp cả cho **số dư đầu kỳ**: vị thế và
  giá vốn của tài khoản cũ do chính người đó khai, không ai đối chiếu với sao kê sàn.
- **15 lệnh cũ không gắn tài khoản.** Chúng có trước cột `trades.brokerAccountId` nên
  tiền của chúng không thuộc tài khoản nào. Hệ quả: tổng số dư các tài khoản KHÔNG bằng
  số dư tiền của danh mục cho tới khi những lệnh đó được gán tài khoản. Chênh lệch đúng
  bằng phần vốn và phần lệnh chưa gắn.
- **Quỹ dự phòng vẫn ở cấp danh mục.** `portfolios.reserveAmount` không chia theo
  nhóm, nên "Tiền của nhóm" KHÔNG trừ dự phòng. Nếu cần hạn mức dự phòng riêng cho
  từng nhóm thì phải thêm cột vào `teams`.
- **Hiệu suất theo chiến lược chưa đo được theo thời gian.** Cần nhân tiền theo
  `allocationBps` từng lệnh (§16) nên `computePerformanceSeries()` chưa dựng được
  cho một chiến lược riêng; trang in "—" thay vì hiện số của toàn danh mục.
- **Chuyển sang PostgreSQL** trước khi chạy thật, để khoá `audit_logs` ở tầng
  database. Xem [docs/POSTGRES-MIGRATION.md](docs/POSTGRES-MIGRATION.md).
- **Chưa có 2FA.** Nên bổ sung trước khi hệ thống quản lý vốn thật.
