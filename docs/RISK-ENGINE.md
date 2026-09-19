# Risk Engine (§19) — Phase 09

Ghi lại các quyết định thiết kế của Risk Engine. Code ở
[`src/domain/risk-engine.ts`](../src/domain/risk-engine.ts) (đo) và
[`src/risk/scan.ts`](../src/risk/scan.ts) (ghi).

---

## Tách đo khỏi ghi

| Tệp | Việc | Chạm database? |
|---|---|---|
| `src/domain/risk-engine.ts` | đo, sinh phát hiện | **không** |
| `src/risk/scan.ts` | đối chiếu, lưu `risk_alerts` | có |

Nhờ tách vậy, câu hỏi "MBB chiếm 12% thì có bắn cảnh báo không" trả lời được bằng
cách gọi `evaluatePortfolioRules()` với một danh mục giả — không cần dựng
database. Nếu trộn cả hai vào một hàm thì mọi phép kiểm chứng đều phải đi qua
lớp lưu trữ.

---

## Ba việc mỗi lượt quét

```
MỞ        phát hiện mới, chưa có cảnh báo tương ứng   → tạo bản ghi OPEN
CẬP NHẬT  cảnh báo đã có, điều kiện vẫn đúng          → ghi lại số đo hiện tại
ĐÓNG      cảnh báo đã có, điều kiện không còn đúng    → RESOLVED
```

**Việc "đóng" là việc quan trọng nhất và cũng dễ bị bỏ nhất.** Không có nó thì
danh sách cảnh báo chỉ dài ra mãi, mọi thứ trong đó đều đã cũ, và người dùng học
được rằng cảnh báo là thứ nên bỏ qua — lúc đó hệ thống cảnh báo tệ hơn là không
có gì.

Khi cập nhật, `triggeredAt` và `status` **giữ nguyên**. `triggeredAt` là "vi phạm
này bắt đầu từ khi nào", thông tin quản trị quan trọng nhất của một cảnh báo đang
mở; ghi đè nó mỗi lượt quét sẽ làm mọi cảnh báo trông như vừa mới xảy ra và một
vi phạm kéo dài ba tuần không còn cách nào nhận ra.

Chỉ đóng cảnh báo của rule **đang hoạt động**. Cảnh báo của rule vừa bị tắt được
giữ nguyên ở trạng thái mở: người tắt rule cần thấy hậu quả việc mình vừa làm,
không nên thấy mọi cảnh báo tự biến mất như thể vấn đề đã được giải quyết.

---

## Khoá chống trùng

```
(ruleId, portfolioId, targetRef)
```

Cả **ba** thành phần, xem `findingKey()`. Chỉ dùng `(ruleId, targetRef)` thì hai
danh mục cùng vi phạm `PORTFOLIO_DRAWDOWN_10` sẽ đè lên nhau — cảnh báo của danh
mục thứ hai bị coi là bản trùng và không bao giờ xuất hiện.

`targetRef` là cột thêm ở Phase 09 (migration `add_risk_scan_run`). Một rule như
"mã vượt 10%" bắn cho nhiều mã cùng lúc, nên `ruleId` một mình không trả lời được
"cảnh báo này đã tồn tại chưa".

---

## Hai vòng đánh giá

**Cấp hệ thống** (`evaluateGlobalRules`) — độ trễ dữ liệu giá, hàng chờ duyệt
chung. `portfolioId = null`.

Tách riêng vì độ trễ dữ liệu giá là **một** sự việc duy nhất. Đánh giá nó bên
trong vòng lặp danh mục thì năm danh mục sinh năm cảnh báo cho cùng một nguồn giá
bị treo, và người trực phải xác nhận năm lần.

**Cấp danh mục** (`evaluatePortfolioRules`) — tập trung mã / ngành / chiến lược,
hiệu suất, tiền khả dụng, mã thiếu giá. Chạy cho **mọi** danh mục ACTIVE.

Quét nền không có "người dùng hiện tại" nên **không áp `applyScope()`** — engine
phải thấy toàn bộ, còn ai được xem cảnh báo nào là chuyện của trang hiển thị.
Trộn hai tầng đó lại sẽ khiến rủi ro của một nhóm không bao giờ được phát hiện
chỉ vì người mở trang không thuộc nhóm đó.

---

## Đơn vị: một cột, ba loại

`threshold` và `measuredValue` đều là `BigInt` nhưng mang ba đơn vị khác nhau tuỳ
`metric`:

| metric | đơn vị | ví dụ |
|---|---|---|
| `WEIGHT_BPS`, `PNL_BPS`, `CASH_BPS` | basis point | `1000` = 10,00% |
| `DATA_DELAY_MINUTES` | phút | `15` = 15 phút |
| `PENDING_COUNT`, `MISSING_PRICE_COUNT` | số đếm | `5` = 5 lệnh |

`RISK_METRIC_UNIT` trong [`src/lib/enums.ts`](../src/lib/enums.ts) là nơi **duy
nhất** giữ bản đồ đó. Mọi chỗ hiển thị tra qua `formatMeasure()`; in thô con số ra
là mời người đọc hiểu `1000` thành một nghìn thay vì 10%.

---

## `measured = null` nghĩa là gì

Không phải "bằng 0", mà là **không đo được nhưng điều kiện vẫn đúng**. Trường hợp
duy nhất hiện nay: chưa từng có lần đồng bộ giá nào. Độ trễ lúc đó là vô hạn chứ
không phải một số phút, nên ghi `null` là cách trung thực — không bịa ra một con
số để so sánh cho có.

Bỏ qua trường hợp này thì service giá chết ngay từ đầu sẽ không bị phát hiện,
đúng cái mà ngưỡng đó tồn tại để bắt.

---

## Ba đường kích hoạt

| trigger | ai gọi | khi nào |
|---|---|---|
| `SCHEDULE` | bộ hẹn giờ ngoài → `POST /api/risk/scan` | theo chu kỳ, kể cả không ai đăng nhập |
| `LAZY` | `ensureRecentScan()` khi mở Dashboard / Risk | nếu lượt gần nhất đã cũ hơn `RISK_SCAN_MAX_AGE_SECONDS` |
| `MANUAL` | nút "Quét lại ngay", hoặc sau khi sửa ngưỡng | ngay lập tức |

Quét lười để hệ thống **tự đứng được** mà không cần bộ hẹn giờ. Nhưng nó chỉ chạy
khi có người mở trang, còn rủi ro không chờ ai đăng nhập — một danh mục vượt
ngưỡng lúc 21h thứ Bảy phải được ghi nhận vào lúc 21h thứ Bảy, không phải sáng
thứ Hai. Vì vậy `SCHEDULE` vẫn là đường nên dùng cho môi trường thật:

```bash
npm run risk:scan
```

Endpoint dùng lại `MARKET_DATA_INGEST_TOKEN` — cùng một mức tin cậy ("tiến trình
nền của chính hệ thống này được phép ghi"), không thêm secret mới để rồi quên
xoay vòng.

---

## `risk_scan_runs` — vì sao cần thêm một bảng

Không có nó thì không trả lời được câu hỏi đầu tiên mà bất kỳ ai cũng hỏi khi
thấy danh sách cảnh báo trống: **engine có chạy không, hay nó chết rồi?**

Một cảnh báo không xuất hiện có hai nguyên nhân hoàn toàn khác nhau — không có gì
vượt ngưỡng, hoặc không ai đo cả — và cái thứ hai nguy hiểm hơn nhiều. Vì vậy
trang Risk đặt khối trạng thái engine **lên trên** danh sách cảnh báo.

Bảng này cũng là nguồn cho cơ chế điều tiết của quét lười, và giữ `errorMessage`
của lượt thất bại. Lượt `RUNNING` quá 5 phút bị đánh dấu treo để một tiến trình
chết không chặn quét mãi.

---

## Tiếp nhận ≠ đóng

Người dùng chỉ chuyển được cảnh báo sang `ACKNOWLEDGED` ("tôi đã thấy, đang xử
lý"). Chỉ engine chuyển sang `RESOLVED`, và chỉ khi đo lại thấy điều kiện không
còn đúng.

Nếu cho người dùng tự đóng thì cảnh báo trở thành thứ bấm cho hết việc, còn vi
phạm thật vẫn nguyên đó — đúng thứ mà §19 tồn tại để ngăn.

---

## Ngưỡng sống ở `risk_rules`, không ở `system_settings`

Phase 09 đã **xoá** `risk.max_stock_weight_bps` và `risk.max_sector_weight_bps`
khỏi `SETTING_SEED`. Chúng trùng với `STOCK_CONCENTRATION_10` và
`SECTOR_CONCENTRATION_20`.

`risk_rules` được chọn làm nơi duy nhất vì nó mang đủ thông tin: ngưỡng, mức
nghiêm trọng, phép so sánh, bật/tắt, và ghi đè theo từng danh mục hoặc từng mã.
`system_settings` chỉ giữ được một con số.

Giữ cả hai thì Admin sửa bản trong Settings sẽ thấy cảnh báo không đổi — lặp lại
đúng cái bẫy đã gặp với `market_data.sync_interval_seconds`.

**Quy ước: mỗi tham số chỉ tồn tại ở một nơi.**

| loại | nơi | sửa ở đâu |
|---|---|---|
| ngưỡng rủi ro | `risk_rules` | trang Risk |
| quy tắc nghiệp vụ | `system_settings` | trang Settings |
| tham số triển khai | `.env` | máy chủ, cần khởi động lại |

---

## Không ghi Audit Log cho lượt quét

`risk_scan_runs` chính là nhật ký của việc quét, và mỗi cảnh báo đã là một bản
ghi có thời điểm. Đổ thêm vào `audit_logs` mỗi 5 phút sẽ nhấn chìm những thứ thật
sự cần soi — hành động của con người.

Audit Log chỉ ghi khi **con người** tiếp nhận cảnh báo hoặc sửa ngưỡng.

---

## Sắp xếp: vì sao không dùng `ORDER BY severity`

`severity` là chuỗi, nên theo bảng chữ cái thì `CRITICAL` đứng trước `INFO` (đúng
do tình cờ) nhưng `HIGH` đứng trước `WARNING` (sai). Danh sách trông như có sắp
xếp mà thứ tự sai — kiểu lỗi rất khó nhìn ra bằng mắt. Dùng `SEVERITY_RANK`.

Kéo theo: `listOpenAlerts(limit)` phải **đọc rộng rồi mới cắt**. Truyền thẳng
`limit` vào `take` thì với `limit = 6` trên Dashboard, database chọn 6 cảnh báo
mới nhất rồi mới sắp theo mức nghiêm trọng — một cảnh báo CRITICAL đã tồn tại một
tuần sẽ bị sáu cảnh báo INFO vừa xuất hiện đẩy ra khỏi màn hình.

---

## Màu: thang có thứ tự, không phải bảng phân loại

Bốn mức nghiêm trọng là một **thang ordinal**, nên màu cũng phải có thứ tự:

```
INFO      màu chữ thường     🟢
WARNING   --warn    #a15c07 / #f0b90b   🟡
HIGH      --serious #bf360c / #f98b3d   🟠
CRITICAL  --down    #c1121f / #f2555f   🔴
```

(sáng / tối)

Đây là ba bậc trên **cùng một dải ấm** vàng → cam → đỏ, không phải bốn màu phân
loại chọn cho dễ phân biệt. Người đọc hiểu ngay cái nào gấp hơn mà không cần tra
chú giải.

`INFO` cố tình không có màu riêng: tô màu cho thông tin không cần hành động sẽ làm
loãng chính hai màu cần được để ý.

Đã đo trên đúng mặt nền của dự án — mọi mức đạt WCAG AA:

| | trên card | trên body |
|---|---|---|
| sáng `--warn` | 5.19 | 4.84 |
| sáng `--serious` | 5.60 | 5.23 |
| sáng `--down` | 6.22 | 5.81 |
| tối `--warn` | 10.04 | 10.79 |
| tối `--serious` | 7.57 | 8.14 |
| tối `--down` | 5.38 | 5.78 |

Màu trạng thái **không bao giờ** dùng làm slot màu chuỗi dữ liệu trong biểu đồ —
xem [UI-CHARTS.md](UI-CHARTS.md). 🔴 phải luôn có nghĩa là nghiêm trọng ở mọi nơi.
Và vì mỗi cảnh báo luôn có đèn emoji cùng nhãn chữ, mức nghiêm trọng không bao giờ
chỉ được truyền tải bằng màu.

---

## Tám ngưỡng mặc định

| code | scope | metric | mặc định | mức |
|---|---|---|---|---|
| `STOCK_CONCENTRATION_10` | STOCK | WEIGHT_BPS | > 10,00% | HIGH |
| `SECTOR_CONCENTRATION_20` | SECTOR | WEIGHT_BPS | > 20,00% | WARNING |
| `STRATEGY_CONCENTRATION_40` | STRATEGY | WEIGHT_BPS | > 40,00% | WARNING |
| `PORTFOLIO_DRAWDOWN_10` | PORTFOLIO | PNL_BPS | < −10,00% | CRITICAL |
| `CASH_BELOW_5` | PORTFOLIO | CASH_BPS | < 5,00% | WARNING |
| `MISSING_PRICE_ANY` | PORTFOLIO | MISSING_PRICE_COUNT | > 0 | HIGH |
| `MARKET_DATA_DELAY_15` | MARKET_DATA | DATA_DELAY_MINUTES | > 15 phút | HIGH |
| `PENDING_APPROVAL_5` | APPROVAL | PENDING_COUNT | > 5 | INFO |

`MISSING_PRICE_ANY` khác các ngưỡng còn lại: nó không đo rủi ro thị trường mà đo
**độ tin của chính số liệu**. Một mã đang giữ mà thiếu giá làm Portfolio Value nhỏ
hơn thực tế, nên mọi tỷ trọng và mọi ngưỡng tập trung tính từ đó đều lệch. Ngưỡng
là `0` với `GT`: chỉ cần một mã thiếu giá là đã phải báo — số liệu sai thì sai,
không có mức chấp nhận được.

---

## Sửa ngưỡng: chỉ ba trường

Giao diện chỉ cho sửa `threshold`, `severity`, `isActive`.

`scope`, `metric`, `comparator` **không** sửa được: chúng quyết định engine chạy
nhánh code nào, nên đổi chúng là đổi ý nghĩa của rule chứ không phải đổi cấu
hình. Đổi `metric` của `STOCK_CONCENTRATION_10` sang `DATA_DELAY_MINUTES` sẽ để
lại một rule mang tên tập trung mã nhưng đo độ trễ dữ liệu — và mọi cảnh báo lịch
sử của nó thành vô nghĩa. Cần rule khác thì tạo rule mới.

Sau khi sửa, hệ thống **quét lại ngay**. Nếu không, người vừa hạ ngưỡng từ 10%
xuống 5% sẽ thấy danh sách cảnh báo không đổi và kết luận rằng việc sửa không có
tác dụng.

---

## Đã kiểm chứng

Vòng đời đầy đủ, chạy trên dữ liệu thật của `db:seed:demo`:

```
quét lần 1   8 ngưỡng · mở 7 · cập nhật 0 · đóng 0
quét lần 2   8 ngưỡng · mở 0 · cập nhật 7 · đóng 0     ← không sinh bản trùng
nâng ngưỡng mã lên 20%
quét lần 3   8 ngưỡng · mở 0 · cập nhật 2 · đóng 5     ← tự đóng
hạ ngưỡng mã về 10%
quét lần 4   8 ngưỡng · mở 5 · cập nhật 2 · đóng 0     ← mở lại
```

Hai ví dụ trong đặc tả §19 đều bắn đúng: `MBB concentration > 10%` (16,64%) và
`Banking exposure > 20%` (Tài chính 50,69%).
