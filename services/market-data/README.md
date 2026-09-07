# Market Data Service — Phase 07

Nguồn giá thị trường cho hệ thống. Đọc từ [`vnstock`](https://github.com/thinh-vu/vnstock)
rồi nạp vào database qua cổng nội bộ của app.

```
vnstock  →  service này  →  POST /api/market-data/ingest  →  database
                                                               ↓
                                                     Portfolio Engine
                                                               ↓
                                                          Dashboard
```

Trình duyệt **không bao giờ** gọi vnstock trực tiếp (§23).

---

## Điều đầu tiên cần biết

**vnstock không phải một REST API có endpoint và API key để dán vào.** Nó là một
**thư viện Python** bọc các nguồn dữ liệu công khai (VCI, KBS, DNSE...).

Vì vậy không có ô "API URL" hay "API key" cho giá. Thứ bạn cấu hình là:

| Biến trong `.env` | Ý nghĩa |
|---|---|
| `MARKET_DATA_PROVIDER` | nguồn con: `vci` (khuyến nghị), `kbs`, `dnse` |
| `MARKET_DATA_INGEST_TOKEN` | shared secret giữa service và app — **phải giống nhau hai phía** |
| `MARKET_DATA_INGEST_URL` | địa chỉ cổng nạp dữ liệu của app |
| `MARKET_DATA_INTERVAL_SECONDS` | chu kỳ lấy giá trong giờ giao dịch |
| `MARKET_CLOSE_DELAY_SECONDS` | chờ bao lâu sau giờ đóng cửa rồi mới chốt giá |
| `MARKET_DATA_INDICES` | chỉ số để tính Alpha, mặc định `VNINDEX` |
| `VNSTOCK_API_KEY` | **tuỳ chọn**, chỉ cần nếu mua gói Insiders của vnstock |

Gói [Insiders](https://vnstocks.com/insiders-program) là tuỳ chọn: nó tăng giới hạn
truy cập và tắt banner quảng cáo trong log. Không có nó thì thư viện vẫn chạy.

Ngưỡng "giá đã cũ" **không** nằm ở đây — nó là tham số nghiệp vụ trong bảng
`system_settings` (§19), đổi bằng `npx tsx scripts/set-setting.ts`.

### API key và hạn mức

Key của vnstock có nhiều tier. `sync.py check` in ra **tier thật** do thư viện báo,
không suy đoán từ việc có key hay không — key miễn phí và key tài trợ đều là "có
key" nhưng hạn mức khác nhau:

```
API key vnstock      : vnstock_18f09cd...
Tier                 : free
Hạn mức              : 60 req/phút · 3600 req/giờ
```

Key được lưu vào `~/.vnstock/api_key.json` bởi chính thư viện. Service chỉ gọi
`change_api_key()` khi key trong `.env` KHÁC key đã lưu, để không ghi lại file mỗi
60 giây khi chạy vòng lặp.

**Điều tiết tốc độ.** `quotes` gộp nhiều mã vào một request `price_board` nên một
lần đồng bộ chỉ tốn 1 request. Nhưng `history` và `index` gọi **một request mỗi
mã** — với 84 mã và hạn mức 60 req/phút sẽ bị chặn giữa đường, và tệ hơn là chặn
im lặng (chỉ thấy vài mã "không có dữ liệu"). Service tự nghỉ giữa các request theo
hạn mức mà nguồn báo, chừa 20% biên an toàn.

---

## Cài đặt

Cần Python 3.10+.

```bash
python -m venv services/market-data/.venv
```

```bash
services/market-data/.venv/Scripts/python.exe -m pip install -r services/market-data/requirements.txt
```

Trên macOS/Linux dùng `services/market-data/.venv/bin/python`.

Sinh token và đặt vào `.env` ở gốc repo (dùng chung file với app Next.js — hai nơi
cấu hình riêng là nguồn gốc của lỗi "app chạy được nhưng service trỏ sai"):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Sử dụng

Kiểm tra cấu hình và kết nối, không ghi gì vào database:

```bash
python sync.py check
```

Lấy giá một lần:

```bash
python sync.py quotes
```

Chạy liên tục theo chu kỳ (tự nghỉ ngoài giờ giao dịch):

```bash
python sync.py quotes --loop
```

Lấy lịch sử OHLCV cho biểu đồ hiệu suất:

```bash
python sync.py history --days 90
```

Lấy lịch sử chỉ số để tính Alpha (§13):

```bash
python sync.py index --days 365
```

---

## Bẫy đơn vị giá — phần quan trọng nhất

vnstock trả giá ở **hai đơn vị khác nhau tuỳ hàm**. Đây là lỗi làm số liệu sai
1000 lần mà không có exception nào được ném ra:

| Hàm | Đơn vị | MBB |
|---|---|---|
| `Trading.price_board()` | **đồng** | `20750` |
| `Quote.history()` | **nghìn đồng** | `20.75` |

Đã kiểm chứng trực tiếp với vnstock 4.0.7, nguồn `vci`, phiên 24/08/2026.

Hệ thống lưu tiền bằng số nguyên VNĐ, nên mọi giá từ `history()` **phải nhân 1000**.
Chỉ số thì lưu ×100 (VN-Index 1788,78 → 178878).

Toàn bộ phép quy đổi nằm trong [`vnstock_source.py`](vnstock_source.py). Không nơi
nào khác được phép nhân chia đơn vị giá.

---

## Vài chi tiết đã xử lý

**Ngoài giờ giao dịch `match_price = 0`.** Lấy 0 làm giá sẽ khiến Portfolio Value
về 0. Service tự lùi về giá tham chiếu (`ref_price`), và ĐẾM số mã phải lùi như vậy
— nếu lần chốt phiên báo phần lớn mã dùng giá tham chiếu thì độ trễ sau giờ đóng
cửa còn quá ngắn.

**Giá đóng cửa không bị bỏ mất.** Với chu kỳ dài (60 phút), các lần gọi rơi vào
09:00, 10:00, … 14:00 — lần 15:00 bị coi là ngoài giờ nên bỏ qua, và giá đóng cửa
không bao giờ được lấy dù đó là giá quan trọng nhất trong ngày để định giá danh mục.
Vì vậy service lấy thêm ĐÚNG MỘT lần mỗi ngày ở mốc
`giờ đóng cửa + MARKET_CLOSE_DELAY_SECONDS` (mặc định 15:00:30). Chỉ đánh dấu đã
chốt khi nạp THÀNH CÔNG — một lần lỗi mạng không làm mất giá đóng cửa của cả ngày.

**Ngủ theo mốc sự kiện, không polling.** Ngoài giờ, service tính chính xác thời
điểm cần thức (mốc chốt phiên hoặc giờ mở phiên kế tiếp) rồi ngủ tới đó. Polling
thô mỗi 5 phút sẽ làm lần chốt phiên lệch vài phút so với mốc mong muốn.

**Log ghi theo dòng, mã hoá UTF-8.** Python đệm stdout khi bị chuyển hướng vào file,
nên chạy dưới Task Scheduler thì log rỗng hàng giờ. Trên Windows stdout còn mặc định
dùng bảng mã hệ thống nên tiếng Việt thành ký tự rác. Cả hai đã xử lý trong code,
không cần nhớ thêm cờ `-u` hay `PYTHONIOENCODING`.

**Chỉ lấy mã cần thiết.** Service hỏi app xem cần những mã nào
(`GET /api/market-data/ingest`) — mặc định là các mã đã có giao dịch, không kéo cả
3.500 mã của thị trường mỗi phút. Thêm `?all=1` nếu muốn toàn bộ master data.

**Mã lạ bị từ chối.** App chỉ nhận giá cho mã có trong master data (§7). Nguồn ngoài
không được phép tạo mã mới, nếu không danh mục chuẩn sẽ bị làm loãng.

**Tiền truyền dạng chuỗi, không phải number.** JSON number là double 64-bit, chỉ
chính xác tới 2^53. Giá trị giao dịch của danh mục nghìn tỷ đồng vượt ngưỡng đó và
sẽ sai âm thầm.

**Mỗi lần nạp ghi một dòng `market_data_syncs`.** Đó là nguồn dữ liệu cho ô trạng
thái "Market Data ● Connected / Delayed" ở §10.

---

## Chạy nền

Chạy trong thư mục `services/market-data`:

```powershell
.\run.ps1 start
```

```powershell
.\run.ps1 status
```

```powershell
.\run.ps1 log
```

```powershell
.\run.ps1 stop
```

Log ghi vào `logs/market-data.log` ở gốc repo (đã gitignore).

**Nếu Dashboard báo "Market Data trễ N phút", việc đầu tiên cần kiểm tra là service
có đang chạy hay không** — `.\run.ps1 status`. Nguyên nhân phổ biến nhất không phải
lỗi nguồn dữ liệu mà là không có tiến trình nào sống.

Trên Windows, `.venv\Scripts\python.exe` chỉ là launcher nên MỘT service xuất hiện
thành HAI tiến trình. `status` gộp lại để không gây hiểu nhầm là có hai service
chạy song song.

`run.ps1` phải được lưu **UTF-8 có BOM**. Windows PowerShell 5.1 đọc file `.ps1`
không BOM theo bảng mã ANSI, làm mọi ký tự Unicode trong chuỗi và regex bị hỏng âm
thầm — bộ lọc log của chính script này từng lỗi vì lý do đó.

### Phạm vi lấy giá: đang đầu tư ∪ VN100

Service không tự quyết định lấy mã nào. Nó hỏi `GET /api/market-data/ingest`, và cổng
đó trả về **hợp của hai nhóm**:

| Nhóm | Điều kiện | Thiếu thì sao |
|---|---|---|
| Đang đầu tư | `trades: { some: {} }` | `computePositions` tính giá trị thị trường bằng 0 → Portfolio Value của cả danh mục bị hụt |
| Rổ VN100 | `isVn100: true` | bảng giá chỉ nói về quá khứ — không so được mã đang giữ với mã đang cân nhắc |

Hiện là **101 mã**: 100 mã VN100 cộng DGC — mã đang được nắm giữ nhưng đã rời VN100.
Đúng lý do phải dùng HỢP chứ không phải GIAO: một vị thế đang mở mà mất giá thì mất
luôn giá trị.

Vì sao không lấy hết ~1.600 mã của thị trường: mỗi lần gọi tốn hạn mức của nguồn (tier
free), và giá của một mã không ai định mua thì không trả lời câu hỏi nào. VN100 là ranh
giới có nghĩa — thanh khoản đủ để mua thật.

`?all=1` vẫn lấy toàn bộ master data (117 mã), dùng cho việc nạp lịch sử một lần.

#### 33 mã phải thêm vào master data trước

VN100 có 100 mã nhưng master data chỉ có 67 mã trong đó. Nếu chỉ mở phạm vi mà không
thêm mã, **33 mã kia sẽ bị cổng nạp từ chối** theo §7 ("không tự tạo mã mới từ dữ liệu
ngoài, nếu không danh mục chuẩn sẽ bị nguồn ngoài làm loãng") — mỗi lần đồng bộ đều ghi
`PARTIAL` và 33 mã đó không bao giờ có giá.

Nên 33 mã đã được khai vào `STOCK_SEED`, với tên công ty lấy từ `Listing().all_symbols()`
và phân ngành suy từ ICB level 4 của `Listing().symbols_by_industries()`. Bảng ánh xạ
ICB → ngành của app được viết tay và viết rõ, không suy tự động: cùng một nhãn ICB có
thể rơi vào hai ngành khác nhau của app. Một ngoại lệ có lý do — SIP là khu công nghiệp
nhưng ICB gộp chung "Bất động sản", nên nó được đặt vào `INDUSTRIAL_RE` thay vì
`RESIDENTIAL_RE`.

#### Rổ chỉ số là DANH SÁCH, không phải cờ trên từng dòng

Trước đây `isVn30` là tham số thứ sáu của `s()`, rải trên 29 dòng nằm cách nhau cả trăm
dòng trong `master-data.ts`. Rổ được cơ cấu lại mỗi kỳ, mà sửa 29 chỗ rải rác thì lần
nào cũng sót — và đã sót thật: khi đối chiếu với rổ thật, danh sách cũ **lệch 11 mã**
(thừa TPB BVH BCM PLX POW, thiếu BSR LPB MCH TCX VIB VPL). Không ai phát hiện, vì một
cờ sai trông y hệt một cờ đúng — và `isVn30` được dùng thật ở báo cáo lưu trữ lẫn thứ
tự mã trên form nhập lệnh.

Tư cách thành viên là thuộc tính của **rổ**, không phải của công ty. Nay là hai danh
sách `VN30_SEED` / `VN100_SEED`; seeder đọc cờ từ đó. Mỗi kỳ cơ cấu chỉ phải thay đúng
một chỗ, và `prisma/seed.ts` **dừng với lỗi** nếu rổ khai một mã chưa có trong
`STOCK_SEED` — thay vì để phát hiện qua việc "thiếu giá" mấy tuần sau.

```bash
npm run check:index
```

Đối chiếu hai danh sách với rổ thật (`python sync.py groups`). Không có mạng hay chưa
cài venv thì nó thoát sạch với thông báo, **không báo khớp** — "không kiểm được" khác
"kiểm rồi và khớp". Đã thử làm lệch có ý (bỏ ACB khỏi VN30, thêm mã bịa vào VN100): nó
báo đúng cả hai chiều và thoát mã 1.

Lệnh `groups` ghi kết quả ra file qua `--out` chứ không để bên gọi đọc stdout: `vnstock`
in banner quảng cáo ra chính stdout mỗi lần import, nên "JSON ở stdout" là hợp đồng
không đứng vững.

#### Một lỗi đếm mà việc mở phạm vi làm lộ ra

Trang Market Data lấy bảng giá với `take: 100` rồi dùng `quotes.length` làm "số mã có
giá". Hai con số đó trùng nhau khi hệ thống theo dõi 12 mã, và lệch ngay khi phạm vi mở
ra 101 mã — ô "Data Status" báo **100** trong khi thực tế là **101**. Nay đếm bằng
`count()` riêng, còn bảng nói rõ "Hiện 100 mã mới cập nhật nhất trong 101 mã".
### Khi nào giá được tự lấy: 120 phút, và nút bấm tay được tính vào

Vòng lặp **không** gọi nguồn theo đồng hồ. Mỗi lần thức dậy nó hỏi app "giá đang cũ
bao nhiêu phút" và chỉ gọi VNStock khi đã quá ngưỡng:

```
thức dậy (mỗi 300s)
   │
   ├─ GET /api/market-data/ingest  →  ageMinutes, refreshAfterMinutes
   │
   ├─ ageMinutes < 120?  →  ngủ tiếp, KHÔNG gọi nguồn
   └─ ageMinutes ≥ 120?  →  lấy giá 101 mã
```

**`ageMinutes` tính từ lần đồng bộ THÀNH CÔNG gần nhất, bất kể ai kích hoạt.** Đây là
điểm khiến nút bấm tay và vòng lặp phối hợp được: bấm nút xong thì lượt tự động kế
tiếp tự lùi lại, không gọi nguồn hai lần cho cùng một khoảng thời gian. Chỉ database
biết "ai đó vừa bấm 5 phút trước" — tiến trình nền không thấy được lượt của người
khác, nên nó phải hỏi app.

Log khi bỏ qua nói rõ vì sao, kèm ai đã chạy lượt gần nhất:

```
[13:08:18] giá mới 94/120 phút (lượt gần nhất: MANUAL) — chưa cần lấy, ngủ 300s
```

#### Hai ngưỡng, hai việc — và thứ tự giữa chúng là một bất biến

| Tham số | Ở đâu | Giá trị | Việc của nó |
|---|---|---|---|
| `market_data.refresh_after_minutes` | `system_settings` | 120 | khi nào ĐI LẤY giá mới |
| `market_data.stale_after_minutes` | `system_settings` | 150 | khi nào BÁO ĐỘNG giá đã cũ |
| `MARKET_DATA_INTERVAL_SECONDS` | `.env` | 300 | bao lâu THỨC DẬY hỏi một lần |

Ngưỡng báo động **phải cao hơn** ngưỡng làm mới. Bằng nhau thì đúng lúc trước mỗi lần
làm mới, chỉ báo lại nhảy sang "Market Data trễ" — báo động nổ theo nhịp bình thường
của hệ thống, và mất luôn khả năng phân biệt *"đang chờ tới lượt"* với *"tiến trình đã
chết"*. Báo động nổ thường xuyên là báo động bị bỏ qua.

Biên 30 phút = một lượt làm mới bị bỏ lỡ **hẳn** thì mới báo.

```bash
npm run audit:pages
```

Phần 10 của phép kiểm này canh bất biến đó, vì cả hai số đều sửa được ở trang Settings
lúc đang chạy nên không có gì chặn người ta đặt chúng bằng nhau. Đã thử đặt bằng nhau:
phép kiểm chuyển đỏ với thông báo "báo động sẽ nổ mỗi chu kỳ, không còn nghĩa".

#### Lượt chốt phiên KHÔNG bị ngưỡng này chặn

Giá đóng cửa là giá quan trọng nhất trong ngày. Nếu 14:05 vừa có một lượt thì tới
15:00:30 tuổi dữ liệu mới 55 phút — phép kiểm ở trên sẽ bỏ qua và **mất giá đóng cửa
của cả ngày**. Nên `closing_run` được loại khỏi phép kiểm.

#### Vì sao ngưỡng nằm ở `system_settings`, không ở `.env`

Nguyên tắc của dự án (xem `src/data/master-data.ts`): quy tắc nghiệp vụ ở
`system_settings`, tham số triển khai ở `.env`, và **mỗi tham số chỉ có một nơi**.

"Giá được phép cũ tới mức nào" là quy tắc nghiệp vụ — cùng loại với ngưỡng báo trễ.
Tiến trình Python không giữ bản riêng; nó đọc số này từ app qua chính request đã dùng
để hỏi danh sách mã, nên không thêm lượt gọi nào. Sửa ở Settings là đổi hành vi ngay ở
lượt kế tiếp.

Đây từng là một cái bẫy thật trong dự án: `market_data.sync_interval_seconds` tồn tại
ở cả hai nơi mà **không dòng code nào đọc bản trong database** — người sửa qua giao
diện thấy không có gì thay đổi. Nó đã bị xoá. Lần này khác vì Python thật sự đọc số từ
app, không phải từ bản sao của mình.

`MARKET_DATA_INTERVAL_SECONDS` vẫn ở `.env` nhưng đã **đổi nghĩa**: chu kỳ *thức dậy*,
không phải chu kỳ *gọi nguồn*. Đặt nhỏ hơn không làm giá tươi hơn, chỉ làm tiến trình
hỏi app dày hơn.

#### Đã kiểm cả hai đường

| Tình huống | Kết quả |
|---|---|
| tuổi 94 phút, ngưỡng 120 | bỏ qua, ngủ 300s — không gọi VNStock lần nào |
| tuổi 94 phút, ngưỡng 60 | gọi nguồn, `SUCCESS — cập nhật 101/101 mã` |

Đường thứ hai kiểm bằng cách tạm hạ ngưỡng xuống 60 rồi trả về 120, chứ không chờ 26
phút — nhưng nó đi qua đúng nhánh code mà lượt thật sẽ đi.
### Nút "Cập nhật giá" trên trang Market Data

Không cần mở PowerShell nữa cho một lần lấy giá. Trang **Market Data** có nút
**Cập nhật giá** ở góc trên phải; bấm là chạy đúng `sync.py quotes` một lần rồi
thoát.

Chuỗi gọi:

```
trình duyệt → server action → python sync.py quotes → VNStock
                                       ↓
                     POST /api/market-data/ingest → database
```

**Đây không phải vi phạm §23** ("frontend không bao giờ gọi VNStock trực tiếp").
Trình duyệt không hề biết VNStock tồn tại; nó chỉ gọi một server action, và mọi quy
tắc schema vẫn nằm đúng một chỗ ở cổng nạp. Nếu action tự `fetch` VNStock thì mới là
vi phạm — mà cũng không làm được, vì `vnstock` là thư viện Python.

**Một lần rồi thoát, không `--loop`.** Người bấm nút muốn giá mới ngay, không muốn
dựng thêm một tiến trình nền thứ hai chạy song song với cái do `run.ps1` quản lý.
Chạy một lần cũng bỏ qua được chốt giờ giao dịch trong `sync.py` (`if loop and not
in_trading_hours`) — bấm chiều thứ Bảy vẫn lấy được giá đóng cửa phiên thứ Sáu, đúng
cái người dùng cần khi thấy "trễ 7871 phút".

#### Một dòng nhật ký, ghi đúng ai bấm

`market_data_syncs` có sẵn hai cột `triggeredBy` và `triggeredById`, nhưng cổng nạp
trước đây luôn TẠO dòng mới với `triggeredBy = 'CRON'` — nên `triggeredById` chưa
bao giờ có dữ liệu, và mỗi lần bấm nút sẽ sinh ra HAI dòng (một RUNNING của app,
một CRON của route).

Cách nối:

| Bước | Ai làm | Việc |
|---|---|---|
| 1 | server action | tạo dòng `RUNNING`, `triggeredBy = MANUAL`, `triggeredById = <người bấm>` |
| 2 | server action | truyền id đó cho Python qua biến `MARKET_DATA_SYNC_ID` |
| 3 | `push()` trong `sync.py` | thấy biến thì gắn `syncId` vào payload |
| 4 | cổng nạp | có `syncId` thì **cập nhật** dòng ấy; không có thì tạo mới như cũ |

`push()` là chỗ đặt đúng ở bước 3: mọi lệnh (`quotes`, `history`, `index`) đều đi qua
nó, nên một chỗ là đủ và không lệnh nào bị bỏ sót.

Bước 4 dùng `updateMany` chứ không `update`: id không tồn tại thì `update` **ném**,
và cả lần nạp dữ liệu vừa thành công sẽ mất sạch nhật ký. Với `updateMany` nó trả về
count = 0 và route tạo dòng mới — dữ liệu đã vào database rồi, nhật ký không được
phép biến mất vì một cái id sai.

`startedAt` không bị ghi đè khi cập nhật: mốc bắt đầu thật là lúc người bấm, sớm hơn
lúc route nhận request đúng bằng thời gian Python khởi động và gọi VNStock. Ghi đè sẽ
làm thời lượng hiện ra ngắn hơn thực tế và giấu đi chính phần chậm nhất.

#### Ba chốt

| Chốt | Ngăn |
|---|---|
| `requirePermission('market_data.sync')` | người chỉ có `market_data.view` gọi nguồn ngoài — hiện chỉ Admin có quyền này |
| dòng `RUNNING` trong `market_data_syncs` | hai người bấm cùng lúc, hoặc một người bấm hai lần |
| dọn dòng `RUNNING` quá `MARKET_DATA_SYNC_TIMEOUT` giây | **chốt trên tự khoá nút vĩnh viễn** |

Chốt thứ ba là cái bẫy của chính thiết kế "dùng dòng RUNNING làm khoá": một lần chạy
bị giết giữa đường (đóng tab, restart server, hết giờ) để lại dòng RUNNING mãi mãi.
Không dọn thì nút chết hẳn và không có gì trên giao diện nói vì sao. Mốc dọn dùng
đúng `MARKET_DATA_SYNC_TIMEOUT` (mặc định 180 giây) vì quá mốc đó tiến trình đã bị
kill, nên chắc chắn không còn ai cập nhật dòng ấy nữa.

Nút bị vô hiệu trong lúc chờ nhờ `useFormStatus`, nhưng đó chỉ là tiện dụng cho một
trình duyệt — hai người dùng khác nhau thì hai trình duyệt không biết gì về nhau, nên
chốt thật phải nằm ở server.

#### Kiểm thử

`npm run test:sync-market-data` — 12 phép kiểm, chạy trên bản sao database và **không
gọi VNStock lần nào**: nó chỉ kiểm những đường trả về sớm (quyền, chạy trùng, dọn dòng
treo). Đường thành công không kiểm được trên bản sao, vì Python POST vào dev server mà
server đó ghi vào `dev.db` — `syncId` sẽ không tồn tại và bài kiểm thử sẽ đo một thứ
khác với thứ chạy thật.

Đường thành công đã kiểm end-to-end trên `dev.db` (có sao lưu trước): **12/12 mã trong
2,3 giây, đúng một dòng nhật ký, `triggeredBy = MANUAL`, `triggeredById` = người bấm**.
Chỉ báo đổi từ "trễ 7871 phút" sang "Connected · chậm 0 phiên".

#### Vẫn nên chạy nền

Nút này là để chữa cháy và để lấy giá theo yêu cầu, **không thay được `run.ps1 start`**.
Không có tiến trình nền thì giá chỉ mới vào lúc có người bấm — nghĩa là Dashboard của
mọi người khác vẫn hiện giá cũ cho tới lần bấm kế tiếp.
### Tự khởi động cùng Windows — HAI tiến trình, không phải một

Đây là chỗ dễ hiểu sai nhất. Tiến trình lấy giá POST vào `http://127.0.0.1:3000`,
nên **app Next.js cũng phải đang chạy**. Tự động hoá riêng tiến trình lấy giá là làm
một nửa: nó thức dậy, gọi vào chỗ trống, ghi lỗi, rồi ngủ lại.

```
dang nhap Windows
   │
   ├─ Startup\VN Investment.cmd  →  scripts\startup.cmd
   │                                  ├─ scripts\task-app.cmd          (npm start)
   │                                  └─ scripts\task-market-data.cmd  (sync.py quotes --loop)
   │
   └─ hai cua so console nam duoi taskbar
```

| File | Ở đâu | Việc |
|---|---|---|
| `VN Investment.cmd` | thư mục Startup của người dùng | một dòng, trỏ vào repo |
| `scripts/startup.cmd` | repo | khởi động cả hai, `/min` |
| `scripts/task-app.cmd` | repo | `npm start`, log ra `logs/app.log` |
| `scripts/task-market-data.cmd` | repo | vòng lặp lấy giá, log ra `logs/market-data.log` |

File trong Startup chỉ là một dòng `call` trỏ vào repo. Mọi logic nằm trong
`scripts/` và được git theo dõi — sửa hành vi thì sửa trong repo, không sửa file
ngoài git.

**Bỏ tự chạy:** xoá `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\VN Investment.cmd`.

#### Vì sao Startup folder mà không phải Task Scheduler

Đã thử Task Scheduler trước. `Register-ScheduledTask` trả về **`Access is denied`**:
đăng ký task ở thư mục gốc cần quyền nâng cao, mà shell không elevated.

Startup folder chạy dưới chính tài khoản đang đăng nhập, **không cần quyền nâng cao
và không cần lưu mật khẩu ở đâu**. Đánh đổi: không có sẵn cơ chế tự khởi động lại khi
tiến trình chết, và không chạy khi chưa ai đăng nhập.

Muốn dùng Task Scheduler thì mở PowerShell **với quyền Administrator** rồi chạy:

```powershell
$repo = 'C:\Users\admin\Documents\Dashboard CKVN'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'VN Investment - App' -Force -Principal $principal -Settings $settings ``
  -Action (New-ScheduledTaskAction -Execute (Join-Path $repo 'scripts\task-app.cmd') -WorkingDirectory $repo) ``
  -Trigger (New-ScheduledTaskTrigger -AtLogOn)

Register-ScheduledTask -TaskName 'VN Investment - Market Data' -Force -Principal $principal -Settings $settings ``
  -Action (New-ScheduledTaskAction -Execute (Join-Path $repo 'scripts\task-market-data.cmd') -WorkingDirectory $repo) ``
  -Trigger (New-ScheduledTaskTrigger -AtLogOn)
```

Nếu làm vậy thì xoá file trong Startup, không thì cả hai cùng chạy và `npm start` thứ
hai sẽ chết vì cổng 3000 đã bị chiếm.

**Chạy cả khi chưa đăng nhập** thì thêm `-LogonType Password` — Windows sẽ hỏi mật
khẩu tài khoản và lưu lại. Đó là việc phải tự làm.

#### `npm start` từng phục vụ SAI thư mục

Trước khi giao cho task, `npm start` là `next start` trần. `next.config.ts` đặt
`distDir: process.env.NEXT_DIST_DIR ?? '.next'` và chỉ `scripts/build.mjs` đặt biến đó,
nên `next start` rơi về `.next` — thư mục của **dev server**.

Nó không báo lỗi. `.next` có sẵn `BUILD_ID` từ một lần build cũ nên server khởi động
bình thường và trả HTTP 200. Đo lúc phát hiện:

```
.next/BUILD_ID        25/08   (cu 9 ngay)
.next-build/BUILD_ID  03/09   (ban vua build)
```

Nghĩa là build rồi khởi động lại sẽ phục vụ code của chín ngày trước, không dấu hiệu
gì. `npm start` nay là `node scripts/serve.mjs`: đặt đúng `NEXT_DIST_DIR`, dừng hẳn nếu
chưa có build, và cảnh báo nếu build cũ hơn `package.json` / `next.config.ts` /
`schema.prisma`.

**Sau mỗi lần sửa code phải build lại** rồi khởi động lại app — `npm start` phục vụ
build tĩnh, không tự biên dịch như `next dev`.

#### Xem trạng thái và tắt

```powershell
# App con song khong
Get-NetTCPConnection -LocalPort 3000 -State Listen

# Tien trinh lay gia
./run.ps1 status
```

Tắt: đóng cửa sổ console tương ứng dưới taskbar, hoặc `./run.ps1 stop` cho tiến trình
lấy giá. Với app thì `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess`.

#### Không cần đợi giữa hai tiến trình

`startup.cmd` khởi động cả hai gần như cùng lúc, không chèn độ trễ. Nếu vòng lặp hỏi
app trước khi app kịp lên thì `fetch_watchlist` bắt lỗi và thử lại sau
`MARKET_DATA_INTERVAL_SECONDS` giây (300s) — mà ngưỡng làm mới là 120 **phút**, nên trễ
5 phút ở lần đăng nhập không ảnh hưởng gì.

#### Đã kiểm bằng cách chạy chính file trong Startup

| Kiểm | Kết quả |
|---|---|
| app trả lời cổng 3000 | HTTP 200 |
| app phục vụ build nào | trang chứa `BUILD_ID` của `.next-build`, không phải `.next` |
| vòng lặp nối được app | `giá mới 30/120 phút (lượt gần nhất: CRON) — chưa cần lấy, ngủ 300s` |
| log | `logs/app.log` và `logs/market-data.log` đều có nội dung |
### `run.ps1` vẫn không tạo scheduled task — và không cần nữa

`run.ps1 start` chỉ khởi động một tiến trình cho phiên hiện tại; khởi động lại máy là
phải chạy lại. Việc tự chạy cùng Windows nay do thư mục Startup lo — xem mục
**Tự khởi động cùng Windows** ở trên, gồm cả câu lệnh Task Scheduler nếu bạn muốn
dùng cách đó thay thế.

`run.ps1` vẫn là cách gọn nhất để **bật/tắt/xem log** tiến trình lấy giá bằng tay.

### Việc còn lại

Cảnh báo chủ động khi service ngừng: hiện chỉ biết qua ô "Market Data trễ" trên
Dashboard, không có thông báo đẩy. Thuộc Phase 09 (Risk Engine) — bảng `risk_rules`
đã có sẵn quy tắc `MARKET_DATA_DELAY_15` chờ engine quét định kỳ.
