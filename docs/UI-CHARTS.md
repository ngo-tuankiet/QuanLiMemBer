# Giao diện & biểu đồ

Tài liệu này ghi lại các quyết định thiết kế, để người sửa sau không phá vỡ chúng
mà không biết.

---

## Hai chế độ sáng/tối

### Thang `ink-*` xếp theo VAI TRÒ, không theo độ tối

Đây là điều dễ hiểu sai nhất trong hệ màu:

| Token | Vai trò | Tối | Sáng |
|---|---|---|---|
| `ink-950` | nền trang | `#0a0d13` | `#f6f7f9` |
| `ink-900` | mặt thẻ | `#111621` | `#ffffff` |
| `ink-850` | ô nhập, dòng hover | `#161c28` | `#f2f4f7` |
| `ink-800` | chip, vùng nổi | `#1c2432` | `#e8ecf2` |
| `ink-700` | đường kẻ mảnh | `#263043` | `#dbe1ea` |
| `ink-600` | đường kẻ đậm | `#33415a` | `#c3ccd9` |
| `ink-500` | chữ mờ nhất | `#77889f` | `#64707e` |

`bg-ink-900` luôn nghĩa là "mặt thẻ" ở cả hai chế độ. Ở chế độ tối thang đi từ tối
lên sáng, ở chế độ sáng nó đảo chiều. Nhờ vậy toàn bộ component viết một lần dùng
được cả hai chế độ — không có class nào phải nhân đôi.

Chữ dùng `text-strong` / `text-slate-soft` / `text-slate-muted` / `text-ink-500`.
`text-white` chỉ còn dùng cho nhãn trên nền màu đặc (nút xanh, nút đỏ), nơi chữ
phải trắng ở cả hai chế độ.

### Chế độ tối không phải phép đảo tự động

Từng bậc được chọn riêng và **kiểm tra tương phản riêng** trên đúng mặt nền của
nó. Mọi màu chữ đạt WCAG AA (≥ 4.5:1) — đã tính bằng script, không ước lượng.

Một ví dụ vì sao phải tính: giá trị `faint` ban đầu ở chế độ sáng chỉ đạt 2.56:1,
trong khi nó đang mang nội dung thật ở 81 chỗ. Phải đổi sang `#64707e` (5.05:1).

### Lưu bằng cookie, đọc ở server

Lựa chọn chủ đề lưu trong cookie `vn-theme`, được root layout đọc và ghi thành
`data-theme` **ngay trong HTML đầu tiên**.

Cách phổ biến hơn là nhét một `<script>` đồng bộ đọc `localStorage`. Trong App
Router cách đó có ba vấn đề thật:

1. `<script>` không được là con trực tiếp của `<html>` — HTML không hợp lệ, React
   báo lỗi và hydration thất bại.
2. Script sửa thuộc tính của `<html>` khiến HTML server khác client, buộc phải bật
   `suppressHydrationWarning` — tắt đúng cái cảnh báo đang cần nghe.
3. Thêm một đoạn JS chặn render vào đường tải tới hạn.

Đọc cookie ở server giải quyết cả ba. Đánh đổi: layout thành động — ở app này
không mất gì vì mọi trang đều đã động do xác thực.

Ba trạng thái: Sáng / Tối / **Theo hệ thống**. Trạng thái thứ ba là mặc định và là
lựa chọn thật — người đặt máy tự đổi màu theo giờ thì app đi theo.

---

## Biểu đồ

SVG render ở **server**, không thư viện, không JavaScript phía client. Tooltip
dùng thẻ `<title>` gốc của SVG nên hoạt động cả khi tắt JS và trình đọc màn hình
đọc được.

Lý do không dùng thư viện biểu đồ: tiền tệ trong hệ thống là `bigint`, mọi thư
viện đều nhận `number` — phải quy đổi ở biên, đúng chỗ dễ mất chính xác nhất.

### Bảng màu phân loại — đã kiểm chứng bằng script

8 slot, **thứ tự cố định, không bao giờ xoay vòng**. Thứ tự chính là cơ chế an
toàn cho người mù màu, không phải trang trí.

| Slot | Sắc | Sáng | Tối |
|---|---|---|---|
| 1 | xanh dương | `#2a78d6` | `#3987e5` |
| 2 | cam | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | vàng | `#eda100` | `#c98500` |
| 5 | hồng | `#e87ba4` | `#d55181` |
| 6 | xanh lá | `#008300` | `#008300` |
| 7 | tím | `#4a3aa7` | `#9085e9` |
| 8 | đỏ | `#e34948` | `#e66767` |

Đã chạy validator trên đúng mặt nền của dự án — mọi kiểm tra PASS ở cả hai chế độ.
Ở chế độ sáng, ba slot (aqua, vàng, hồng) dưới 3:1 nên **mọi biểu đồ dùng chúng
bắt buộc có chú giải kèm số liệu chính xác**. Đó là lý do `DonutLegend` không phải
trang trí — nó là kênh thông tin bắt buộc.

**Không có slot thứ 9.** Phần dư gộp vào "Khác" (`foldSlices`). Sinh thêm sắc màu
là sai: sắc thứ 9 không phân biệt được với sắc đã có dưới mắt người mù màu.

### Màu theo THỰC THỂ, không theo thứ hạng

`SectorExposure.colorIndex` và `StrategyAllocation.colorIndex` lấy từ `sortOrder`
của master data, không phải vị trí trong mảng kết quả. Mảng được sắp theo giá trị,
nên gán màu theo vị trí sẽ **sơn lại các chuỗi còn lại mỗi khi lọc** — người đã
học "Tài chính màu xanh" bị dẫn sai.

### Chọn dạng biểu đồ theo việc người đọc phải làm

| Việc | Dạng dùng | Ở đâu |
|---|---|---|
| Phần trên tổng thể, nhìn tổng quan | **donut**, tối đa 6 phần | Capital / Strategy / Sector Allocation |
| So sánh độ lớn, mọi giá trị cùng dấu | **thanh xếp hạng** | Top Positions, Vốn theo nhóm |
| So sánh có CẢ ÂM VÀ DƯƠNG | **thanh hai chiều** quanh đường gốc giữa | Lãi/lỗ theo nhóm |
| Diễn biến theo thời gian, 2 chuỗi | **đường**, chuẩn hoá về 100 | hiện không dùng — xem ghi chú `LineChart` |
| Một con số hiện tại | **ô KPI**, không phải biểu đồ | §12 KPI, Alpha vs VNINDEX |

Donut chỉ để đọc tổng quan. Khi cần so các giá trị gần nhau thì con số trong chú
giải mới đáng tin — mắt so chiều dài chính xác hơn nhiều so với so diện tích cung.

### Dấu của con số phải nằm ở HÌNH DẠNG, không chỉ ở màu

Thanh xếp hạng neo mọi thanh vào lề trái. Với lãi/lỗ thì một khoản lỗ và một khoản
lãi cùng độ lớn vẽ ra **y như nhau** và chỉ khác màu — người mù màu đỏ/xanh đọc
sai hoàn toàn, và ngay cả người đọc bình thường cũng phải dừng lại để nhận ra.

Vì vậy `DivergingBars` đặt đường gốc ở **giữa**: lỗ chạy sang trái, lãi chạy sang
phải. Dấu trở thành thông tin đọc được từ hình dạng, màu chỉ là lớp củng cố. Thang
đối xứng theo giá trị tuyệt đối lớn nhất nên so một khoản lỗ với một khoản lãi là
so trực tiếp được.

Màu ở đây dùng bộ **trạng thái** `--up` / `--down` theo quy ước bảng giá Việt Nam,
KHÔNG dùng slot màu chuỗi dữ liệu: lãi/lỗ là cực tính, không phải phân loại.

### Phần chia nhỏ phải cộng lại đúng bằng tổng

Biểu đồ theo nhóm từng thiếu **₫253 triệu** so với toàn danh mục, vì có một lệnh do
Admin nhập với `teamId = null` — nó không thuộc nhóm nào nên rơi khỏi mọi thanh.
Biểu đồ vẫn trông hoàn chỉnh; chỉ có tổng là sai.

Cách sửa không phải gán tạm lệnh đó cho một nhóm, mà là thêm một hàng
**"Không thuộc nhóm"** vào chính phép chia. Giờ `computeTeamPerformance()` luôn
cộng lại đúng bằng `computePortfolioSummary()` tới từng đồng, và phần chưa gán
nhóm là thứ **nhìn thấy được** thay vì âm thầm biến mất.

Quy tắc rút ra: mỗi khi chia một con số tổng theo chiều nào đó, phải có một phép
kiểm cộng dồn. Nếu chiều đó cho phép giá trị null thì null là một hàng, không phải
một trường hợp bị bỏ qua.

### Không bao giờ hai trục y

Danh mục tính bằng đồng, VN-Index tính bằng điểm. Đặt hai thang cạnh nhau là tự
bịa ra một mối tương quan không có trong dữ liệu. Cách đúng: **chuẩn hoá cả hai về
100 tại mốc đầu kỳ**, vẽ trên một trục.

### Component không dùng tới ≠ cấu hình không dùng tới

`LineChart` hiện không trang nào gọi, và nó được giữ lại có chủ ý. Một biểu đồ
không được dùng thì **không nói dối ai**. Một quyền hay một tham số bị bỏ rơi thì
khác: chúng vẫn hiện trên giao diện và khiến người dùng tin rằng chúng đang có tác
dụng — nên chúng phải bị xoá, xem `scripts/prune-permissions.ts` và
`scripts/prune-settings.ts`.

### Chi tiết dấu vẽ

- Đường 2px, đầu bo tròn. Điểm mốc ≥ 8px, có vòng nền 2px.
- Khe 2px giữa các phần donut, bằng chính màu nền — **không vẽ viền**.
- Lưới và trục là nét **liền** mảnh. Nét đứt đọc thành "ngưỡng" hoặc "dự phóng"
  trong khi nó chỉ là lưới.
- Nhãn trực tiếp **chọn lọc**: chỉ ở điểm cuối mỗi đường, không ghi số ở mọi điểm.
  Nhãn cuối tự đẩy tách nhau tối thiểu 13px khi hai đường kết thúc quá gần.
- Chú giải luôn có khi từ 2 chuỗi trở lên, để danh tính không chỉ dựa vào màu.
- Vùng hover rộng hơn dấu vẽ — không bắt người dùng nhắm chính xác.
- Số lớn đứng một mình dùng `.hero-figure` (chữ số tỷ lệ); chỉ bảng và nhãn trục
  dùng `.tabular` (chữ số đẳng khoảng).

### Một cái bẫy đã mất thời gian truy

React yêu cầu `children` của `<title>` là **một chuỗi duy nhất**. Viết
`<title>{a}: {b} · {c}</title>` tạo ra mảng node — React **bỏ qua khi render ở
server** nhưng vẫn render ở client, gây lệch hydration mà thông báo lỗi không hề
nhắc tới `<title>`. Luôn dùng template string.

## Bố cục Dashboard

### Một lưới, các thẻ tự xếp — và vì sao không còn hai cột

```
┌─ KPI ×5 ──────────────────────────────────────────────────┐  hết bề ngang
├───────────────────────────────────────────────────────────┤
│  Vốn & lãi/lỗ theo nhóm            (span 3, nếu có quyền) │
│  Sector Exposure │ Top 10          │ Tài khoản & vốn IB   │
│  Risk & Alerts   │ Strategy Alloc. │ Recent Activity      │
│  Giao dịch gần nhất       (span 2) │ Thành viên lãi/lỗ    │
└───────────────────────────────────────────────────────────┘
   grid-cols-1 · sm:grid-cols-2 · xl:grid-cols-3
```

Bản đầu là **cột trái `1fr` + cột phải `23rem`**, rồi một hàng chạy hết bề ngang ở
dưới. Bố cục đó cân bằng được đúng **một** bộ thẻ — mà số thẻ ở đây thay đổi theo
quyền của người xem. Đo ở khổ 1600px:

| Vai trò | Cột trái | Cột phải | Lỗ trống |
|---|---|---|---|
| Quản trị hệ thống | 973px | 1031px | 57px |
| **Quản lý nhóm** | **287px** | **932px** | **644px** |

Quản lý nhóm không có `position.view_all` nên mất thẻ "Vốn & lãi/lỗ theo nhóm"
(498px) khỏi cột trái, còn cột phải không đổi. Chiều cao một hàng lưới bằng ô cao
nhất, nên toàn bộ phần chênh dồn thành **một lỗ 644px** — bằng 40% chiều cao trang.

Và nó ở **giữa** trang chứ không ở cuối, vì phía dưới còn một hàng nữa. Đó là điểm
quyết định: một khoảng trống ở cuối cột cuối cùng chỉ đọc ra là "trang hết"; cùng
khoảng trống đó nằm giữa hai khối nội dung thì đọc ra là "hỏng".

Thành viên thường còn mất thêm "Risk & Alerts" và thẻ IB — nên không phải hai dạng
bố cục mà là nhiều dạng. Đã thử ba cách chia tay khác nhau (dồn hàng cuối vào cột
trái; xếp dọc; giữ 45/55 bên trong cột trái): cách nào cũng lệch khoảng 500px cho
một vai trò khác, đúng bằng thẻ chênh nhau. **Cân tay không giải được bài này.**

Nay mọi thẻ là con trực tiếp của một lưới. Hàng tự hình thành theo số thẻ thực có,
và phần chênh chiều cao bị hấp thụ **ngay trong hàng** — thẻ ngắn giãn cho bằng thẻ
cao nhất, các thẻ thẳng hàng đáy. Kết quả đo lại, cả ba vai trò:

| Vai trò | Số thẻ | Số hàng | Ô lưới bỏ trống | Chênh cao trong hàng |
|---|---|---|---|---|
| Quản trị hệ thống | 9 | 4 | 0 | 0px |
| Quản lý nhóm | 8 | 3 | 0 | 0px |
| Thành viên | 8 | 3 | 0 | 0px |

Trang của Quản lý nhóm ngắn đi 211px (1591 → 1380).

#### Giãn thẻ, không để hở lưới

Hàng "Risk & Alerts / Strategy / Recent Activity" cao 422px vì Risk có 8 cảnh báo;
Recent Activity tự nó chỉ 175px nên giãn thêm 247px. Đó là khoảng trắng **trong**
thẻ, khác hẳn khoảng trống của lưới:

- `items-stretch` (mặc định): thẻ giãn, đáy các thẻ thẳng hàng → đọc ra là có chủ ý.
- `items-start`: thẻ giữ chiều cao thật, đáy so le, khoảng hở lộ nền trang → đọc ra
  là thiếu nội dung.

Có thể giảm phần giãn bằng cách xen thẻ cao với thẻ thấp, nhưng **không làm**: cách
nhóm hiện tại có lý do thông tin đã ghi rõ (donut ngành nằm cạnh Top 10 để mắt đi từ
hình sang số). Đổi thứ tự để tiết kiệm 100px khoảng trắng là đổi cái quan trọng lấy
cái ít quan trọng.

#### Hai thẻ khai `col-span`, và cả hai đều có lý do đo được

| Thẻ | Span | Vì sao |
|---|---|---|
| Vốn & lãi/lỗ theo nhóm | `sm:2 xl:3` (hết bề ngang) | bên trong nó đã chia hai cột |
| Giao dịch gần nhất | `sm:2` | bảng cần 608px; một cột ở xl chỉ ~429px |

**Thứ tự hai thẻ cuối bị đảo có chủ ý**: "Giao dịch gần nhất" (span 2) đứng TRƯỚC
"Thành viên". Ở khổ hai cột, một thẻ span-2 không chia hàng được với thẻ một cột —
đặt "Thành viên" trước thì nó chiếm một ô rồi để trống ô còn lại, tạo một lỗ
329×255px giữa trang. Đặt sau thì ô trống rơi về ô cuối cùng của trang. Ở khổ ba cột
thì hai thẻ này lấp đúng một hàng (2 + 1), không dư ô nào.

### Không xếp ba donut liên tiếp trong một cột

Donut ngành nằm **cùng hàng** với hai bảng, không xếp dưới donut chiến lược. Ba hình
tròn nối nhau theo chiều dọc đọc thành "cùng một thứ lặp ba lần" chứ không thành ba
câu trả lời khác nhau — mắt phải đọc nhãn mới phân biệt được, đúng thứ mà hình lẽ ra
phải làm thay.

Hàng ba thẻ là **hình → số → số**: donut cho hình dạng tổng thể, Top 10 cho con số
theo mã, thẻ IB cho con số theo đầu mối.

### Mốc ba cột: từ 2xl xuống xl, và con số đó là kết quả đo

Ban đầu hàng ba thẻ đặt ở `lg:grid-cols-3`. Đo ở khổ ngoài 1280px: cột trái còn
610px, chia ba thành **195px mỗi thẻ** — hẹp hơn cả bảng ngành (291px), nên bảng
**đẩy rộng cả ô lưới** thay vì tự cuộn. Chú giải donut lúc đó co còn **34px**, hiển
thị "Hàng tiêu…". Mốc phải dời lên `2xl` (1536px), nơi cột trái đủ ~930px.

Sau khi bỏ cột phải, lưới dùng cả bề ngang nên ba cột ở `xl` (1280px) đã được
**~429px mỗi thẻ** — rộng hơn cả mốc 2xl cũ. Mốc trả về `xl`.

Nguyên nhân gốc của lỗi đó vẫn phải sửa riêng, và nó không nằm ở mốc breakpoint:
**bảng không có khung cuộn thì không co lại — nó đẩy rộng thứ chứa nó.** Xem mục
"Ô lưới không co được" ở phần màn hình hẹp: `overflow-x-auto` chỉ có tác dụng khi ô
lưới cũng được phép co (`grid-cols-1` = `minmax(0, 1fr)`).
### Hình trong ô KPI: màu nền lấy theo biểu đồ của chính ô đó

| Ô | Hình | Nền |
|---|---|---|
| Portfolio Value | `trendUp` | tăng |
| Invested Capital | `pie` | nhấn |
| Available Cash | `wallet` | tăng |
| Total P&L | `trendUp`/`trendDown` theo dấu | tăng/giảm theo dấu |
| Alpha | `trendUp`/`trendDown` theo dấu | tăng/giảm theo dấu |

Quy tắc: **nền tô cùng màu với biểu đồ nằm trong chính ô đó.** Nhờ vậy hình và
biểu đồ trong một ô luôn nói cùng một điều, và hai ô đổi dấu đổi màu cùng lúc
với biểu đồ của nó — không có chuyện hình xanh nằm cạnh đường đỏ.

Trước đây năm ô dùng lại icon của **mục menu** tương ứng, nên "Total P&L" đeo
hình khiên của menu Risk — đọc thành "rủi ro" thay vì "lời lỗ". Hình trong ô KPI
phải nói đúng **đại lượng**, không phải nói tên trang.

Tương phản đã đo trên nền thẻ thật: sáng 5.17–6.22, tối 5.38–8.22 — đều trên
ngưỡng 3:1 cho vật thể đồ hoạ.

### Recent Activity không trùng với "Giao dịch gần nhất"

Cùng một mảng `recentTrades` (không thêm truy vấn), nhưng khác việc nên khác cách
trình bày:

| | Recent Activity | Giao dịch gần nhất |
|---|---|---|
| Câu hỏi | "vừa có gì xảy ra" | "đọc kỹ một lệnh" |
| Dòng | nhiều, gọn | ít, đủ cột |
| Thời gian | chỉ giờ:phút | đủ ngày giờ |
| Trạng thái | không | có |

Tên chiến lược trong Recent Activity tô đúng **màu slot** của nó — cùng màu với
donut Strategy Allocation ngay bên cạnh trong cùng hàng, nên mắt nối được hai khối
mà không cần một bảng chú giải thứ hai.

### Danh sách thành viên thay cho khối cảnh báo lặp lại

Ô cuối hàng trước đây là bốn thẻ cảnh báo rủi ro. Nó đã bị thay bằng **lãi/lỗ theo
từng cá nhân**, và việc đó **không mất thông tin**: thẻ "Risk & Alerts" vẫn liệt kê
tới 8 cảnh báo đang mở kèm mức độ, và số cảnh báo vẫn hiện ở phù hiệu đầu trang. Hai khối cũ nói cùng một điều ở hai chỗ
trên cùng một màn hình — khối lặp lại là khối phải đi.

Dùng lại **đúng** component `DivergingBars` mà khối theo nhóm ở trên dùng. Có chủ
đích: cùng một câu hỏi ở mức chi tiết hơn thì phải trông giống nhau, để người đọc
hiểu ngay đây là *"vẫn lãi/lỗ, nhưng theo người"* chứ không phải một đại lượng
mới cần học lại.

#### Màu chấm theo NHÓM, không theo người

Hai người cùng nhóm mang cùng một màu, nên nhìn danh sách cá nhân là thấy ngay
"hai dòng vàng này đều là Tài chính" mà không phải đọc cột nhóm. Cho mỗi người
một màu riêng thì màu không còn nói gì cả — bảng màu chỉ có tám slot phân biệt
được, mười người là hết.

Để hai khối không bao giờ lệch màu, thứ tự nhóm và slot màu được tách thành
`teamBuckets()` + `colorSlots()`, dùng chung bởi `computeTeamPerformance()` và
`computeMemberPerformance()`. Trước đó bảng này nằm trong lòng hàm theo nhóm; nếu
hàm theo cá nhân tự dựng lại thứ tự riêng thì người đọc học "Đá Bóng màu xanh" ở
khối trên rồi thấy nó màu tím ở khối dưới. Đã đo: cả bốn nhóm trùng màu tuyệt đối
giữa hai khối.

#### Sắp theo SỐ TIỀN, tỷ suất in ngay cạnh

Xếp theo tỷ suất một mình sẽ đưa người có 10 triệu vốn lãi 10% lên trên người có
3 tỷ vốn lãi 200 triệu. Xếp theo tiền một mình lại ưu ái người được cấp nhiều
vốn. Hai con số cạnh nhau thì không che được chiều nào.

Số tiền còn có một ưu điểm quyết định: **nó luôn định nghĩa được.** Tỷ suất thì
không — xem dưới.

#### `bps: number | null` — vì "0,00%" là một câu nói sai

`DivergingBar.bps` nhận `null`, và in ra dấu **"—"**.

Trường hợp này xảy ra thật: người đã bán hết mọi mã có giá vốn đang giữ bằng 0,
nên tỷ suất là phép chia cho 0. `ratioToBps()` trả về `0` khi mẫu số bằng 0, nên
nếu cứ in thẳng thì một người vừa chốt lãi 100 triệu sẽ hiện **"+0,00%"** — và
cái sai đó trông y như một con số thật, nên không ai kiểm lại.

`computeMemberPerformance()` vì thế trả `returnBps: null` thay vì 0, buộc nơi hiển
thị phải chọn cách in. Đã kiểm bằng `renderToStaticMarkup`: nhánh `null` in "—",
không in "0,00%"; nhánh có số vẫn in bình thường.

#### Không cắt bớt phần lỗ

Danh sách chạy hết mọi người **có lệnh khớp**, sắp giảm dần, nên người lỗ nặng
nhất nằm ở cuối chứ không bị ẩn. Trung tâm điều hành đầu tư mà chỉ hiện người
lãi thì vô dụng. Chỉ cắt khi quá 10 người, và lúc đó có dòng ghi rõ còn bao nhiêu
người chưa hiện — cắt im lặng thì bảng trông như đã đủ.

Người **chưa** giao dịch không xuất hiện. Họ không có lãi/lỗ bằng 0 — họ *không
có* lãi/lỗ, và xếp họ ở mức 0% sẽ đặt họ trên mọi người đang lỗ, đọc thành
"không làm gì thì hơn".

#### Một lỗi bố cục lộ ra khi thay khối

Khối cảnh báo cũ là `{urgentAlerts.length > 0 ? … : null}` — nó **biến mất** khi
không có cảnh báo nào. Lúc đó lưới `45fr/55fr` chỉ còn một con, bảng giao dịch
rơi vào ô 45fr và bỏ trống 55fr còn lại. Lỗi chỉ hiện ra ở đúng cái trạng thái ít
ai kiểm: **khi mọi thứ đang bình thường.**

Nay lưới chỉ chia hai cột khi thật sự có hai khối:

```tsx
className={'mt-3 grid gap-3 ' + (showMembers ? 'lg:grid-cols-[…45fr…55fr]' : '')}
```

#### Phạm vi xem

Theo `dataScope(permissions, 'position')` — cùng quy tắc với `/members/[id]`:

| Phạm vi | Thấy gì |
|---|---|
| `ALL` | mọi người; bộ lọc nhóm ở đầu trang có tác dụng |
| `SCOPED` | chỉ người cùng nhóm |
| `NONE` | không thấy khối này |

Chốt quyền **không** nhân bản trong `computeMemberPerformance()`. Hàm chỉ nhận
`onlyTeamId` là đúng giá trị `EngineFilter.teamId` **sau** `applyScope()`, nên các
chuỗi sentinel (`'__no_access__'`, `'__no_team__'`) tự nhiên không khớp nhóm nào
và trả về danh sách rỗng.

Đã kiểm: người thuộc Đá Bóng ở phạm vi `SCOPED` gõ `?teamId=<Cầu Lông>` vào URL
vẫn **chỉ** thấy người của Đá Bóng. `?teamId=khong-ton-tai` trả về khối rỗng, không
rò rỉ.

#### Đối chiếu số

Tổng lãi/lỗ theo cá nhân khớp **tuyệt đối** với tổng theo nhóm và với toàn danh
mục, và khớp ở **từng nhóm** một chứ không chỉ ở tổng lớn — tổng lớn có thể khớp
trong khi các nhóm bù trừ nhau, nên phép kiểm phải xuống tới từng nhóm.

Lưu ý về cách tính: `computePositions()` được gọi với `userId` mà **không** lọc
thêm theo nhóm. Nhóm của một lệnh là nhóm lúc đặt lệnh; nếu người đó đã chuyển
nhóm thì lệnh cũ vẫn thuộc nhóm cũ. Lọc cả hai điều kiện sẽ làm biến mất chính
những lệnh cần tính, và tổng theo cá nhân không còn khớp tổng theo nhóm.

### Hiệu suất theo khoảng: ba nguồn

Ô **Portfolio Value** và ô **Alpha** đều đọc `computePerformance()`. Hàm này xét
ba nguồn theo thứ tự độ tin cậy, và trả về `source` để giao diện biết con số có
nghĩa gì:

| `source` | Lấy từ | Ý nghĩa |
|---|---|---|
| `snapshots` | `portfolio_snapshots` | chính xác nhất, có tính dòng vốn |
| `series` | dựng lại từng phiên từ `price_history` | biến động giá trong khoảng |
| `current` | lãi/lỗ trên giá vốn toàn thời gian | **không phải** hiệu suất theo khoảng |

#### Lỗi mà nó sửa

Trước đây chỉ có hai nguồn: `snapshots`, hoặc rơi về `current`. Bảng snapshot chưa
từng được ghi, nên nhánh dự phòng **luôn** được dùng. Hậu quả đo được:

| Khoảng | Danh mục (cũ) | VNINDEX | Alpha (cũ) | Danh mục (mới) | Alpha (mới) |
|---|---|---|---|---|---|
| 1 tuần | −3,17% | +1,17% | −4,34% | **+5,37%** | **+4,20%** |
| 1 tháng | −3,17% | +6,44% | −9,61% | **+18,36%** | **+11,92%** |
| 3 tháng | −3,17% | −4,02% | +0,85% | **+8,58%** | **+12,60%** |
| 6 tháng | −3,17% | −3,10% | −0,07% | **+10,07%** | **+13,17%** |
| Từ đầu năm | −3,17% | +0,02% | −3,19% | **+8,27%** | **+6,29%** |
| Toàn bộ | −3,17% | +17,05% | −20,22% | **+8,27%** | **+6,29%** |

Hai điều sai, không phải một:

1. **Vế danh mục đứng yên.** Sáu khoảng, một con số, trong khi nhãn bên cạnh đổi
   theo khoảng. Người đọc không có cách nào biết.
2. **Alpha trừ hai khoảng khác nhau.** Vế chỉ số *có* lọc theo `period`, vế danh
   mục *không*. Nhìn cột Alpha cũ: nó nhảy từ +0,85% xuống −20,22% hoàn toàn do vế
   chỉ số đổi. Đây là chỗ nặng nhất — Alpha là con số dùng để đánh giá con người,
   và nó đang báo *kém thị trường 3,19%* trong khi thực tế là *hơn 6,29%*.

#### Hai vế lấy từ CÙNG một điểm

`portfolioIndex` và `benchmarkIndex` đều được chuẩn hoá về 100 tại **cùng** phiên
đầu, và cả hai được đọc tại **cùng** phiên cuối — cụ thể là phiên cuối *có* dòng
VN-Index. Nhờ vậy Alpha là hiệu của hai số cùng gốc, cùng đích.

Chi tiết nhỏ nhưng thật: phiên cuối của chuỗi là 25/08 còn phiên cuối *có chỉ số*
là 24/08. Đọc danh mục ở 25/08 và chỉ số ở 24/08 lệch nhau một phiên — đủ để
con số đổi (108,59 so với 108,27). Vì vậy cả hai vế đều đọc ở 24/08.

#### Nhãn in ngày THẬT, không in tên khoảng

`price_history` không phủ hết khoảng người dùng chọn. Chọn "Từ đầu năm" nhưng dữ
liệu giá chỉ có từ 10/02 — và điều đó đúng với **mọi** khoảng đã kiểm:

```
khoảng   người chọn từ   số liệu từ
1W       20/08           21/08
YTD      31/12/2025      10/02/2026
ALL      (toàn bộ)       10/02/2026
```

Nên nhãn không nhắc lại tên khoảng nữa. Nó in `từ 10/02/2026 · 133 phiên`. Không
cần một dòng cảnh báo nào: nhãn tự nói đúng phạm vi của chính con số. Tên khoảng
người dùng chọn vẫn nằm trong tooltip `ⓘ`, kèm câu nói rõ khoảng đó có thể dài hơn
phần đang có dữ liệu giá.

#### `comparable: false` thì Alpha in "—"

Khi không có phiên nào (`source === 'current'`), hai vế không cùng khoảng nên hiệu
của chúng vô nghĩa. Lúc đó:

- ô Portfolio Value **không hiện dòng delta** — thà không có gì còn hơn hiện lãi/lỗ
  toàn thời gian dưới một cái nhãn nói về thời gian;
- ô Alpha in **"—"**, không in con số;
- icon chuyển sang hình **không chỉ hướng** (`wallet` / `shield`) — một mũi tên lên
  hay xuống là một tuyên bố về diễn biến, và lúc đó ta chưa đo được diễn biến nào.

Lãi/lỗ trên giá vốn toàn thời gian **không mất đi**: nó là ô **Total P&L**, nơi nhãn
nói đúng nó là gì ("−3,17% trên giá vốn").

#### Dấu delta và hướng đường giờ đồng thuận theo cấu trúc

`portfolioIndex` của phiên đầu luôn bằng 100, nên "đường kết thúc trên mốc xuất
phát" và "delta ≥ 0" là **cùng một điều** — không còn cảnh mũi tên xanh đi lên nằm
cạnh dòng đỏ −3,17% như trước.

Còn đúng một ngoại lệ hẹp: delta đọc ở phiên cuối *có* chỉ số, còn đường vẽ hết mọi
phiên. Nếu phiên cuối thiếu dòng chỉ số **và** đường vượt mốc 100 đúng ở phiên đó,
màu đường và dấu delta sẽ ngược nhau. Chấp nhận có chủ ý: màu đường phải nói đúng
đường đang vẽ, delta phải nói đúng khoảng đo được — ép chúng bằng nhau thì một
trong hai sẽ nói sai.

#### Nhánh `snapshots` chưa kiểm được

Bảng đang rỗng, nên nhánh này chưa chạy lần nào trên dữ liệu thật. Nó giữ nguyên
công thức cũ, chỉ thêm phần ghép vế chỉ số từ `benchmarkClose` của chính ảnh chụp
(cột đó tồn tại đúng để hai vế cùng gốc). **Phải kiểm lại nhánh này trước khi tin
nó**, ngay khi có tiến trình chốt cuối ngày.

### KPI khi có bộ lọc: tiền không chia được, hiệu suất thì chia được

Lọc sang nhóm **"Cá nhân"** — nhóm không có vị thế nào — mà bốn trong năm ô KPI vẫn
hiện số của toàn danh mục:

| Ô | Hiện ra | Thực tế |
|---|---|---|
| Portfolio Value | ₫2,232 tỷ | 0 vị thế + **toàn bộ tiền danh mục** |
| Available Cash | ₫1,752 tỷ · "78,50% danh mục" | tiền toàn danh mục, mẫu số là con số trộn ở trên |
| Total P&L | "0,00% trên giá vốn" | chưa bỏ vốn — không có tỷ suất |
| Alpha | +6,29% · "danh mục +8,27%" | hiệu suất **toàn danh mục** |

Ba nguyên nhân khác nhau, phải sửa khác nhau.

#### 1. Tiền: ban đầu là đại lượng cấp danh mục, nay chia được theo nhóm

> **Đã thay đổi.** Khi viết mục này, `capital_flows` chưa có `teamId` nên tiền
> không chia được. Cột đó nay đã có — xem
> [mục cuối tài liệu này](#tiền-theo-nhóm-sau-khi-có-capital_flowsteamid). Phần dưới
> đây giữ lại vì nó giải thích vì sao ô KPI thứ nhất vẫn không cộng tiền.

Lúc đó `capital_flows` **không có `teamId`**, và `reserveAmount` là một cột của
`portfolios`. Vốn được nạp vào *danh mục*, không nạp vào nhóm. Nên không có căn cứ
nào để nói ₫1,75 tỷ tiền mặt "thuộc" nhóm Đá Bóng bao nhiêu — và `computeCash()`
nhận `portfolioId` chứ không nhận `EngineFilter` chính là vì thế.

Sửa bằng cách **đổi câu hỏi của ô**, không bằng cách bịa ra phép chia:

- Khi lọc, ô thứ nhất thành **"Giá trị vị thế"** và **không cộng tiền**.
- Ô "Available Cash" giữ số toàn danh mục nhưng nói rõ `· toàn danh mục`.

Đo lại sau khi sửa: vị thế từng nhóm cộng lại **khớp tuyệt đối** với danh mục.

```
Cá nhân      0.0000 B      0.00%
Cầu Lông     1.2376 B     11.98%
Tài chính    1.4752 B     14.28%
Đá Bóng      5.1745 B     50.09%
Không nhóm   0.2105 B      2.04%
             ────────     ──────
tổng         8.0978 B     78.39%   = vị thế toàn danh mục (phần còn lại là tiền)
```

Cách cũ cộng tiền vào từng nhóm cho tổng **₫19,26 tỷ** — vượt ₫8,93 tỷ so với danh
mục thật ₫10,33 tỷ, đúng bằng bốn bản sao thừa của số dư tiền.

#### 2. Mẫu số "% danh mục" phải là danh mục THẬT

Đang lọc thì `summary` là của phần đã lọc, nên chia cho chính nó ra số vô nghĩa —
tiền hiện "78,50% danh mục" trong đó "danh mục" chỉ là *(0 vị thế + toàn bộ tiền)*.
Trang nay lấy thêm một `computePortfolioSummary()` không lọc (đo được 5 ms) làm mẫu
số, nên "Đá Bóng chiếm 50,09% danh mục" mới là câu nói đúng. Không lọc thì dùng lại
chính `summary`, không truy vấn thêm.

#### 3. `computePerformanceSeries()` nay nhận bộ lọc

Trước đây nó chỉ nhận `portfolioId`, nên KPI và Alpha luôn là của toàn danh mục bất
kể người dùng lọc gì. Nay dùng chung `tradeWhere()` với `computePositions()` — một
điều kiện lọc, một chỗ định nghĩa. Kết quả:

| Nhóm | Hiệu suất | Alpha | Phiên |
|---|---|---|---|
| Đá Bóng | +19,18% | +17,20% | 133 |
| Tài chính | +18,30% | +12,76% | 101 |
| Cầu Lông | −19,11% | −15,27% | 129 |
| Cá nhân | — | — | 0 |

Trước khi sửa: cả bốn nhóm đều hiện +8,27% / +6,29%.

#### Chiều CHIẾN LƯỢC cố ý không vào chuỗi

Lọc theo chiến lược phải nhân tiền theo `allocationBps` của **từng lệnh** (§16,
không đếm trùng vốn), và phép nhân đó tạo khối lượng lẻ nên `computePositions()`
giữ khối lượng ở đơn vị micro. Vòng lặp trong `computePerformanceSeries()` chạy trên
khối lượng nguyên. Lọc lệnh mà **không** nhân tỷ lệ sẽ cho một con số quá cao trông
hoàn toàn bình thường.

Nên khi lọc theo chiến lược, trang **không hiện gì** thay vì hiện số của phạm vi
khác: không delta, không đường sparkline, Alpha in "—", và tooltip nói rõ lý do.
Đây là lý do có hai cờ riêng biệt:

```ts
perf.comparable   // hai vế cùng khoảng THỜI GIAN
perfInScope       // ... VÀ chuỗi thuộc đúng PHẠM VI đang lọc
```

Mọi chỗ hiển thị đều gác bằng `perfInScope`. Chỉ `comparable` là không đủ: nó không
biết gì về phạm vi.

#### Khi lọc, ô 2 đổi sang "Giá vốn"

Không lọc thì "Portfolio Value" = vị thế + tiền, còn ô 2 = vị thế — hai số khác
nhau. Nhưng khi lọc, ô 1 chỉ còn phần vị thế nên **hai ô hiện y hệt một con số**
(₫1,237 tỷ ở cả hai). Hai thẻ nói cùng một điều là mất không một ô KPI.

Đổi ô 2 sang giá vốn thì cả hàng đọc thành một câu: *bỏ vào bao nhiêu → giờ đáng
bao nhiêu → tiền còn lại → lãi/lỗ → hơn kém thị trường.*

Tooltip nói hiệu hai ô đầu là lãi/lỗ **chưa thực hiện** — không phải Total P&L. Đã
kiểm với mọi nhóm: Cầu Lông có hiệu −₫699,3 tr nhưng Total P&L −₫676,4 tr, lệch
đúng bằng ₫22,9 tr đã chốt.

#### "chưa bỏ vốn" thay cho "0,00% trên giá vốn"

Cùng loại lỗi đã sửa ở `MemberPerformance.returnBps`: `ratioToBps()` trả `0` khi mẫu
số bằng 0, nên một phạm vi chưa giữ gì sẽ hiện "0,00% trên giá vốn" — một con số
trông hoàn toàn bình thường. Không có giá vốn thì không có tỷ suất.

#### Đối chiếu chéo giữa hai đường tính độc lập

Giá trị khi lọc theo ngành khớp **tuyệt đối** với dòng ngành đó trong bảng "Phân bổ
theo ngành" — hai đường tính khác nhau (`computePositions` với `sectorId` so với
`computeSectorExposure` trên toàn bộ vị thế), cả 7 ngành đều khớp và tổng lại đúng
₫8,097 tỷ.

### Available Cash: công thức đúng, nhưng thanh tỷ trọng thì không

Công thức đã đối chiếu với dữ liệu thô, tính tay khớp tuyệt đối:

```
góp vốn (CONTRIBUTION − WITHDRAWAL)       +10 500,000 tr
dòng khác (DIVIDEND, INTEREST, …)             +96,400 tr
chi mua  (net, đã gồm phí + thuế)          −8 652,179 tr
thu bán  (net, đã trừ phí + thuế)            +288,277 tr
                                          ─────────────
số dư tiền                                  2 232,498 tr
quỹ dự phòng                                 −480,000 tr
                                          ─────────────
Available Cash                              1 752,498 tr
```

Chỉ lấy `capital_flows` ở trạng thái `CONFIRMED` và `trades` ở trạng thái `EXECUTED`.
Khớp §14: ba phần **Invested 78,39% + Cash 16,96% + Reserve 4,65% = 100,00%** đúng
tròn. Mẫu số là `portfolioValue` (vị thế + **số dư** tiền), còn tử số của Cash là
phần **khả dụng** — chính vì vậy ba phần mới cộng đủ 100%.

#### Lỗi thật nằm ở `Bar`, không ở phép tính

```tsx
// cũ
width: `${Math.min(100, Math.max(1, bps / 100))}%`   // luôn tô màu caller truyền
```

`Math.max(1, …)` kẹp mọi số âm thành 1% và **giữ nguyên màu xanh của caller**. Tiền
khả dụng âm xảy ra thật — khi số dư tụt xuống dưới quỹ dự phòng, tức danh mục đã
tiêu vào phần để dành. Lúc đó ô hiện `−₫980tr` ở dòng số nhưng kèm một vạch **xanh**
nhỏ, đọc thành "còn một chút". Con số đúng, cái vạch nói ngược lại nó.

| bps | Cũ | Mới |
|---|---|---|
| +16,96% | 16,96% xanh | 16,96% xanh |
| **0,00%** | **1,00% xanh** | **0% — không vẽ** |
| +0,12% | 1,00% xanh | 1,00% xanh (sàn) |
| **−9,49%** | **1,00% xanh** | **9,49% đỏ** |
| **−45,00%** | **1,00% xanh** | **45,00% đỏ** |
| +125% | 100% xanh | 100% xanh |

Bề rộng nay lấy theo **độ lớn**, màu lấy theo **dấu** — âm thì luôn `--down`, bất kể
caller truyền màu gì. *Dấu của con số không phải chuyện caller được quyết.*

Đúng 0 thì không vẽ gì: sàn 1% tồn tại để một tỷ trọng rất nhỏ vẫn thấy được, dùng
nó cho 0 là vẽ ra một phần không tồn tại.

#### Điều công thức KHÔNG tính: lệnh mua đang chờ duyệt

`Available Cash` không trừ tiền của các lệnh `BUY` đang ở `PENDING_APPROVAL`. Hiện
không lệch vì cả 15 lệnh đều đã `EXECUTED`, nhưng đây là khoảng trống có thật: một
lệnh mua chờ duyệt đã **cam kết** phần tiền đó, nên "khả dụng" đang lạc quan hơn
thực tế. Đổi định nghĩa này là quyết định nghiệp vụ (§14 chỉ nói Invested / Cash /
Reserve), không phải sửa lỗi — nên để nguyên và ghi ra đây.

#### Một lỗi khác tìm được lúc kiểm quanh ô này

`pendingCount` đếm lệnh chờ duyệt **không lọc `portfolioId`**, rồi hiện trên một
trang nói về đúng một danh mục. Hiện chỉ có một danh mục nên chưa lệch; nó sẽ lệch
ngay ở danh mục thứ hai, và lúc đó không có gì trên trang gợi ý vì sao. Đã thêm
`portfolioId` vào điều kiện.

### Tiền theo nhóm, sau khi có `capital_flows.teamId`

Cột `teamId` (nullable) đã được thêm vào `capital_flows`. Từ đó số dư tiền của một
nhóm là số **thật**, không phải phép chia bịa:

```
tiền của nhóm = vốn được cấp riêng cho nhóm  −  chi mua của nhóm  +  thu bán của nhóm
```

`computeCash(portfolioId, { teamId })` nay nhận phạm vi. Ba trạng thái, cùng quy ước
với `EngineFilter.teamId`: không truyền = toàn danh mục, `"<id>"` = nhóm đó, `null` =
phần vốn **chưa** gắn nhóm.

#### `null` là quỹ chung, và là mặc định

Mọi dòng vốn có trước cột này đều `null`. **Không chia hồi tố** — chia ₫10,5 tỷ cho
bốn nhóm theo tỷ lệ họ đã tiêu chính là phương án "bịa số" đã bị loại. Vì vậy ngay
sau migration, "vốn được cấp" của mỗi nhóm bằng 0.

Nullable còn là bắt buộc về nghiệp vụ: **cổ tức và lãi tiền gửi về danh mục**, không
về nhóm nào. Bảng cũng không có `stockId` nên cổ tức cũng không suy ra được ngành.

#### Nhóm chưa được cấp vốn: `noGrant`

Nhóm chưa được cấp mà đã tiêu thì `cashBalance` **âm**, bằng đúng phần đã rút từ quỹ
chung. Con số đúng, nhưng nó không phải "tiền còn lại" — in `−₫1,914 tỷ` dưới nhãn
"Tiền của nhóm" sẽ bị đọc thành nhóm đang nợ.

Nên `CashBreakdown` trả thêm cờ `noGrant`, và ô KPI in **"—"** kèm `chưa cấp vốn
riêng`; số đã rút từ quỹ chung nằm trong tooltip. Cùng nguyên tắc với `returnBps:
null` và `Alpha` khi không so sánh được: **không có số thì đừng in số.**

#### Quỹ dự phòng KHÔNG trừ ở phạm vi nhóm

`portfolios.reserveAmount` là một cột của danh mục. Trừ ₫480 triệu dự phòng vào số
dư của từng nhóm là trừ **cùng một khoản bốn lần**. Vì vậy `scope === 'TEAM'` thì
`reserveAmount = 0n`.

#### Đã kiểm: tổng các nhóm khớp danh mục

```
nhóm             được cấp    đã dùng ròng     số dư     noGrant
Cá nhân             0,000          0,000       0,000      true
Cầu Lông            0,000      1 914,021  −1 914,021     true
Tài chính           0,000      1 368,420  −1 368,420     true
Đá Bóng             0,000      4 828,081  −4 828,081     true
Chưa gán nhóm  10 596,400        253,380  10 343,021     false
                                         ────────────
tổng                                        2 232,498   = số dư toàn danh mục ✓
```

Và sau khi cấp thử ₫8 tỷ cho Đá Bóng: ô hiện **₫3,171 tỷ · "còn 39,65% vốn được
cấp"** (8 000 − 4 828,081), trong khi ô không lọc vẫn ₫1,752 tỷ. Đã hoàn nguyên sau
khi kiểm.

#### Chưa có form — và vì sao

Đặc tả không có mục nào về nạp/rút vốn, và ứng dụng chưa có form nào tạo
`capital_flows` (tới nay chỉ `seed-demo.ts` sinh ra). Dựng một trang quản lý vốn
nghĩa là tự đặt luật nghiệp vụ: ai được nạp/rút, có cần duyệt hai mắt không (bảng đã
có sẵn `approvedById`/`approvedAt`/`status` cho việc đó), hạn mức mỗi nhóm.

Tạm thời dùng [`scripts/grant-capital.ts`](../scripts/grant-capital.ts). Nó chỉ
**chuyển** một khoản đã có sang cho nhóm, không tạo tiền mới, nên tổng vốn của danh
mục không đổi.

### Chế độ sáng: phong cách private banking tối giản

Chỉ khối `:root` đổi. Khối `@media (prefers-color-scheme: dark)` và
`:root[data-theme='dark']` **không đổi một ký tự** — đã đối chiếu bằng `diff`.

#### Bề mặt: ngà ấm, không phải xám xanh

| Token | Cũ | Nay |
|---|---|---|
| `--ink-950` nền trang | `#f6f7f9` xám ngả xanh | `#faf9f6` **ngà ấm** |
| `--ink-900` mặt thẻ | `#ffffff` | `#ffffff` |
| `--ink-700` đường kẻ | `#dbe1ea` | `#e4e0d6` |
| `--fg-strong` | `#0d1420` đen ngả xanh | `#1c1b18` **nâu-đen ấm** |

Nền xám ngả xanh là ngôn ngữ của phần mềm SaaS; giấy ngà ấm là ngôn ngữ của bản sao
kê. Cùng một cấu trúc thẻ, đổi nhiệt độ nền là đổi hẳn cảm giác. Thẻ vẫn **trắng tinh
trên nền ngà** nên nó nổi lên mà không cần viền đậm hay bóng đổ — *giấy đặt trên giấy*
— và đường kẻ vì thế được kéo xuống mức chỉ vừa đủ thấy (1,32:1).

#### Màu nhấn: xanh hải quân thay cho xanh dương tươi

`#2563eb` là màu nút "Đăng ký" của mọi trang web. `#1e3a5f` là màu bìa một bản báo cáo
danh mục. Cùng là xanh, nhưng một cái mời gọi bấm còn một cái nói rằng con số bên trong
đã được kiểm.

Xanh = tăng, đỏ = giảm vẫn theo quy ước bảng giá VN, chỉ trầm lại (`#047857` → `#1b6b50`,
`#c1121f` → `#a01722`): sắc độ cao gắt làm cả trang trông như bảng điện.

#### Bảng màu phân loại trầm hơn — và dễ đọc HƠN

Đây là chỗ dễ đoán sai. Chạy `scripts/validate_palette.js` trên đúng mặt nền của dự án:

```
cũ   4 PASS + 1 WARN   aqua/vàng/hồng dưới 3:1, phải có nhãn bù
mới  5 PASS            cả 8 slot đều ≥ 3:1
```

**Không phải cứ trầm là mờ.** Hạ sắc độ *kèm* hạ độ sáng thì tương phản với nền trắng
tăng lên. Cặp sát nhau khó nhất là lục lam ↔ đất nung, ΔE 9,5 (protan) — trên ngưỡng 8.

| Slot | Cũ | Nay |
|---|---|---|
| 1 | `#2a78d6` xanh dương | `#2d6396` xanh hải quân |
| 2 | `#eb6834` cam | `#c25f33` đất nung |
| 3 | `#1baf7a` aqua | `#1f8f70` lục lam |
| 4 | `#eda100` vàng | `#b4860f` vàng đồng |
| 5 | `#e87ba4` hồng | `#c06b8c` hồng khô |
| 6 | `#008300` xanh lá | `#2e7d43` xanh lá trầm |
| 7 | `#4a3aa7` tím | `#5b4a9e` tím |
| 8 | `#e34948` đỏ | `#b04440` đỏ gạch |

`--ceiling` đổi sang `#6a3fa8` để **không trùng** `--series-7`: màu trạng thái trùng
màu phân loại thì một lát bánh trong biểu đồ sẽ đọc thành "giá trần".

#### Hai chỗ dùng SAI thang màu — tìm được nhờ đo, không nhờ nhìn

Bảng phân loại được kiểm ở ngưỡng **3:1 dành cho dấu vẽ**. Hai nơi lại dùng nó làm
**màu chữ**, vốn cần 4,5:1:

| Ở đâu | Chữ | Đo được |
|---|---|---|
| Dashboard · Recent Activity | "Sóng ngành" (vàng đồng, 11px) | **3,30:1** |
| Dashboard · Recent Activity | "Tín hiệu Xanh/Đỏ" (đất nung, 11px) | **4,22:1** |
| Portfolio · Positions | tên ngành tô màu ngành | cùng loại |

Bản cũ còn tệ hơn (`#eda100` chỉ 2,17:1) — bảng màu mới đã kéo lên nhưng vẫn chưa đủ
cho chữ. Sửa đúng cách: **chấm màu mang danh tính, chữ mặc áo chữ.** Chấm vẫn nối khối
với donut Strategy Allocation phía trên, mà chữ thì luôn đọc được.

#### Kết quả đo trên trang thật

Quét mọi phần tử có chữ trong `<main>`, tính nền bằng cách **chồng các lớp trong suốt**
(bg-warn-500/5 …) chứ không lấy nền tổ tiên gần nhất:

```
/dashboard             946 phần tử   0 dưới ngưỡng
/portfolio/positions                 0
/portfolio/allocation                0
/strategies                          0
/risk                                0
chế độ tối · /dashboard              0
```

> Lần quét đầu báo 11 lỗi ở 1,91:1. Đó là **lỗi trong phép đo**: regex đọc
> `oklab(0.53 0.016 0.10 / 0.05)` rồi lấy ba số đầu làm RGB, ra một nền gần đen. Sửa
> hàm đo rồi mới có hai lỗi thật ở trên.

### Ô nhập số lớn: hiện dấu chấm, gửi số thuần

`200000000` gõ vào thì hiện `200.000.000`. Không có dấu ngăn, một dãy chín chữ số là
thứ không ai đọc được: người nhập phải đếm bằng mắt để biết mình vừa gõ hai trăm triệu
hay hai tỷ.

#### Hai ô, một trường — và đây là điều bắt buộc

`src/components/MoneyInput.tsx`: ô nhìn thấy **không có `name`** nên nó không được gửi
đi; một ô ẩn mang `name` thật và giá trị **số thuần**.

Không phải để cho gọn. Hai lý do cứng:

| Trường | Kiểu kiểm | Nếu dấu chấm lọt xuống |
|---|---|---|
| số tiền | `vndAmount` = `^\d+$` | báo lỗi, người dùng thấy ngay |
| **khối lượng** | `z.coerce.number()` | **`"10.000"` → `10`** — sai một nghìn lần, **không lỗi nào được ném ra** |

Cái thứ hai mới là cái đáng sợ: một dấu chấm biến mười nghìn cổ phiếu thành mười, và
hệ thống ghi nhận bình thường. Đã kiểm bằng test, đúng như vậy.

#### Con trỏ

Định dạng lại làm độ dài chuỗi đổi, nên nếu không xử lý thì con trỏ nhảy về cuối mỗi
lần thêm một dấu chấm — sửa số ở giữa thành ra không làm được. Cách xử lý: đếm số **chữ
số** nằm trước con trỏ *trên chuỗi vừa gõ*, rồi sau khi định dạng lại đặt con trỏ sau
đúng số chữ số đó.

#### Áp ở đâu

| Nơi | Trường |
|---|---|
| Nạp / rút vốn | số tiền |
| Khai số dư đầu kỳ | khối lượng · giá vốn · tiền mặt còn |
| Nhập giao dịch | khối lượng · giá |

Form nhập giao dịch **không có lỗi từ trước**: `createTradeAction` đã lọc dấu ngăn
(`replace(/[.,\s]/g, '')`) trước khi parse. Thêm `MoneyInput` ở đó là để đồng bộ hiển
thị, và giờ có hai lớp cùng hướng — server không bao giờ thấy dấu chấm.

`fees` / `tax` để nguyên: chúng là ô ghi đè tuỳ chọn, giá trị mặc định do hệ thống tính
và hiện ở placeholder.

### Thay "Phân bổ theo ngành" bằng "Tài khoản & vốn theo IB"

Thẻ cũ là một **bảng lặp lại đúng dữ liệu của donut "Sector Exposure" nằm ngay bên
trái nó**: cùng ngành, cùng tỷ trọng, cùng giá trị. Hai cách vẽ một con số đặt cạnh
nhau không cho biết thêm gì, mà chiếm mất một ô lưới ở hàng ba thẻ.

Chỗ đó giờ trả lời một câu chưa có nơi nào trả lời: **mỗi IB đang mang về bao nhiêu
tài khoản và bao nhiêu vốn** (`broker_accounts.ibId` — ô "Dưới IB nào", chọn từ danh
mục IB do quản trị khai ở Cơ cấu tổ chức).

#### Hai đại lượng, một trục

Ô này có hai con số cho mỗi IB. Vẽ cả hai thành hai trục y là đúng cái lỗi mục
[Không bao giờ hai trục y](#không-bao-giờ-hai-trục-y) đã nói. Cách chia:

| Đại lượng | Mã hoá | Vì sao |
|---|---|---|
| Số tiền | **độ dài thanh** | đại lượng cần so sánh giữa các IB |
| Số tài khoản | **chữ bên cạnh tên** | đi kèm để đọc, không để so |

Dùng `RankedBars` — thanh ngang, vì tên IB là tên người Việt và hàng ngang mới đủ
chỗ. Chữ "N tk" mang **màu chữ** `text-ink-500`, không mang màu chuỗi dữ liệu: ở cỡ
11px màu chuỗi không đạt 4,5:1, và ô màu cạnh tên đã lo phần nhận diện.

#### Bốn quyết định trong `computeIbExposure`

1. **Gộp theo tên chuẩn hoá, hiện theo tên gõ sớm nhất.** `ibName` là ô tự gõ, nên
   "Bùi Hải", "bùi hải" và " Bùi Hải " chắc chắn sẽ cùng xuất hiện. Gộp theo chuỗi
   thô sẽ tách một IB thành ba dòng, mỗi dòng một phần vốn.
2. **`ibName` rỗng không bị bỏ** — nó thành dòng "Không qua IB". Đó là một câu trả
   lời thật, không phải dữ liệu thiếu; bỏ đi thì tổng theo IB nhỏ hơn tổng thật mà
   không có gì báo.
3. **Tiền cộng theo dấu của `flowType`, và lọc theo `portfolioId`.** `amount` luôn
   dương; cộng thẳng thì một lần rút lại làm *tăng* số tiền của IB.
4. **Slot màu theo lần khai đầu tiên** — không theo thứ hạng (đổi thứ tự là đổi
   màu) và không theo bảng chữ cái (thêm một IB tên "An" là sơn lại toàn bộ).

#### Ai được xem — và lần đầu `capital.view` có tác dụng

Ô này hiện **số tiền của tài khoản người khác**, nên không thể dùng chung cổng với
`dashboard.view`: một Thành viên xem được dashboard sẽ thấy vốn của cả công ty. Cổng
là `capital.view` / `capital.view_all`, qua `dataScope(…, 'capital')`.

Đây là **lần đầu `dataScope` được gọi với `'capital'`**. Trước đó `capital.view` là
một *quyền bẫy* — đã cấp cho 3 vai trò mà không gác gì, và `npm run audit:pages` báo
đỏ nó cùng ba quyền khác. Dùng ở đây **không cấp thêm quyền cho ai**; nó chỉ làm
quyền đã cấp bắt đầu có tác dụng đúng như tên gọi. Danh sách quyền bẫy giảm từ 4
xuống 2 (`capital.approve` và `department.view` vẫn còn, vẫn cần quyết định nghiệp vụ).

Phạm vi nhóm đi qua `applyScope` **một lần riêng** với `capitalScope`, không dùng lại
`filter.teamId` của trang: người có `portfolio.view_all` nhưng chỉ `capital.view` sẽ
thấy vốn IB của mọi nhóm nếu dùng chung — bảng `user_permissions` cho phép hai module
lệch nhau, nên mượn phạm vi của module khác là nới quyền mà không ai chủ ý.

| Vai trò | Thấy gì |
|---|---|
| Quản trị hệ thống, Quản lý cấp cao (`capital.view_all`) | mọi IB |
| Quản lý nhóm, Trade (`capital.view`) | chỉ IB của nhóm mình |
| Thành viên, Hỗ trợ Trade (không có) | "Bạn không có quyền xem dữ liệu vốn" |

Hai trạng thái rỗng **không được gộp**: nói "chưa có tài khoản nào" với người thiếu
quyền là báo sai hiện trạng hệ thống.

#### Hai lỗi tìm ra khi xem bằng mắt

Số liệu đã đối chiếu khớp từ trước, nhưng chỉ khi kết xuất ra ảnh mới thấy:

- **`RankedBars` vẽ một vạch màu cho giá trị bằng 0.** `Math.max(1, …)` áp cho mọi
  giá trị nên hai tài khoản mới khai chưa nạp vốn đều hiện một vạch — người đọc hiểu
  thành "có một ít". Nay `bps === 0` thì không vẽ gì; sàn 1% vẫn giữ cho giá trị khác
  0 nhưng quá nhỏ, vì ở đó vạch mảnh là đúng. Sửa trong component nên `/teams` cũng
  được sửa theo — cùng một lỗi ở đó.
- **Nhãn "Mở trực tiếp — không qua IB" bị cắt** ở khổ một phần ba hàng. Đổi thành
  "Không qua IB": ngắn hơn mà nói chính xác hơn.

#### Gộp đuôi thành "Khác"

Số IB không có trần — mỗi thành viên tự gõ tên đầu mối của mình — nên danh sách sẽ
vượt 8 slot màu. Không dùng thẳng `foldSlices` vì nó gộp `DonutSlice`, loại chỉ mang
được **một** đại lượng; ở đây phải cộng cả tiền lẫn số tài khoản, thiếu vế thứ hai
thì dòng "Khác" hiện tiền của mười đầu mối kèm số tài khoản của một đầu mối.

Đã kiểm với 11 IB giả: vẽ đúng 6 dòng, dòng "Khác (6 đầu mối) · 12 tk · ₫70M" cộng
khớp cả hai đại lượng.

#### Kiểm thử: kết xuất trang thật

`npm run test:dashboard-ib` — 23 phép kiểm, **kết xuất chính trang dashboard** dưới
danh nghĩa từng vai trò rồi đọc HTML. Kết xuất cả trang thay vì gọi riêng
`computeIbExposure` vì câu cần trả lời là "ai NHÌN THẤY gì", và câu đó đi qua cả
engine, `dataScope`, `applyScope` lẫn nhánh trạng thái rỗng trong JSX — lỗ hổng phạm
vi ở `/approvals` trước đây nằm đúng ở mắt trang, không ở engine.

Phép kiểm số 3 là phép chống giả mạo: một Quản lý nhóm gắn `?teamId=<nhóm khác>` vào
URL vẫn chỉ thấy nhóm mình, vì `applyScope` chạy sau cùng.

> Hai phép kiểm đầu tiên của bài này **trượt oan**: hàm bóc thẻ cắt cứng 3000 ký tự,
> mà thẻ dài 4641 — hai IB cuối rơi ra ngoài ("thiếu IB" cho một thẻ đủ), còn khi thẻ
> ngắn thì lát cắt tràn sang thẻ kế tiếp và bắt được ký hiệu ₫ của thẻ đó ("lộ số
> tiền" cho một thẻ không có số nào). Nay cắt theo mốc class thật của `Card`. Trước
> khi kết luận sản phẩm sai, phải loại trừ khả năng công cụ đo sai.

---

## Màn hình hẹp (điện thoại)

Đo bằng thiết bị ảo 375×812, trên **trang thật đã hydrate**, không phải trên bản kết
xuất tĩnh. Ba nhóm vấn đề, ba mức nghiêm trọng khác nhau.

### Trước và sau

| Phép đo (Dashboard, 375px) | Trước | Sau |
|---|---|---|
| Điểm nội dung tràn ra ngoài | 4 (thẻ 650px trong khung 351px) | **0** |
| Vùng cuộn ngang hoạt động | 0 | **2** |
| Mục điều hướng dùng được | 1 (thẻ avatar) | **23** |
| Thanh trên tràn ngang | có, cắt nút "Đăng xuất" | **không** |
| Vùng bấm dưới 44px | 43/44 | **0/10** |
| Chữ dưới 12px | 121 phần tử | **0** |
| Ô nhập dưới 16px (iOS tự phóng) | 5/5 | **0/5** |

### 1. Điều hướng: sidebar ẩn mà không có gì thay thế

Sidebar là `hidden lg:flex`. Dưới 1024px nó biến mất — và **23 mục menu vẫn được gửi
xuống điện thoại rồi bị `display:none`**, thanh trên còn đúng một link (thẻ avatar).
Nghĩa là mở app trên điện thoại rồi thì không có đường nào sang Portfolio,
Transactions, Market Data… trừ khi tình cờ có link trong nội dung trang.

`MobileNav` là drawer bấm từ thanh trên. Điểm quan trọng của nó không phải giao diện
mà là **chỉ có một cây menu**: bảng `MENU` vẫn ở `AppShell` (Server Component), vẫn
lọc theo `user.permissions` ở server, rồi kết xuất sẵn được truyền vào drawer qua
`children`. Dựng menu thứ hai trong component client sẽ tạo hai bảng chắc chắn lệch
nhau — và lệch nguy hiểm nhất ở phần lọc quyền, tức là hiện cho người dùng một mục họ
không được vào.

#### `backdrop-blur` làm `position: fixed` mất tác dụng

Đây là lỗi đọc code không thấy được. Nút mở nằm trong `<header>`, mà header có
`backdrop-blur`. `backdrop-filter` **tạo một containing block mới**, nên `fixed
inset-0` của panel neo vào HEADER chứ không vào viewport:

| Panel đặt ở | Chiều cao panel | Vùng nav thấy được | Nội dung nav |
|---|---|---|---|
| trong `<header>` | 66px | **17px** | 1078px |
| portal ra `<body>` | **812px** | 743px | 1078px, cuộn được |

22 mục menu bị nén về chiều cao 17px. `fixed inset-0` trông hoàn toàn đúng và nó đúng
ở mọi chỗ khác — chỉ đo mới ra. Sửa bằng `createPortal` ra `document.body` để panel
nằm ngoài mọi containing block. Cách khác là bỏ `backdrop-blur` khỏi header, nhưng đó
là đổi thiết kế để chữa một lỗi kỹ thuật.

### 2. Ô lưới không co được: vùng cuộn có mà vô hiệu

Đây là lỗi nặng nhất, và nó **không phải "quên làm responsive"**. Các
`overflow-x-auto` đã có sẵn quanh mọi bảng rộng. Chúng vô hiệu vì:

```
ô lưới có min-width: auto  →  không co dưới min-content của nội dung
bảng min-w-[38rem] bên trong →  kéo giãn vùng cuộn LẪN thẻ chứa nó lên 650px
main có overflow-x-hidden    →  CẮT phần dôi thay vì cho cuộn
```

Kết quả: 259px nội dung mất hẳn, không cuộn tới được. Trên Dashboard đó là cột lãi/lỗ
của "Thành viên lợi nhuận cao nhất" và cột Chiến lược của "Giao dịch gần nhất".

Sửa: thêm `grid-cols-1` ở khổ gốc cho **33 lưới** — Tailwind sinh
`repeat(1, minmax(0, 1fr))`, tức là cột được phép co về 0. Cộng thêm **6 giá trị**
`grid-cols-[1fr_...]` đổi thành `minmax(0,1fr)`: `1fr` trần cũng không giới hạn
min-width, nên cùng lỗi đó sẽ nổ ở khổ rộng khi có bảng rộng bên trong.

> **Bộ dò theo từng dòng có điểm mù.** Nó tìm ra 33 lưới nhưng bỏ sót đúng cái lưới
> đang gây lỗi trên Dashboard, vì `className` ở đó được nối chuỗi qua nhiều dòng.
> Tương tự với `DashboardFilters`, nơi class nằm trong template literal. Cả hai đều do
> **phép đo trong trình duyệt** bắt được, không phải do grep. Grep để tìm diện rộng;
> kết luận thì phải đo.

### 3. Cỡ chữ và vùng bấm

| Sửa | Chi tiết |
|---|---|
| `text-micro` / `text-tiny` | thay 203 chỗ `text-[10px]`/`text-[11px]`; dưới 640px cả hai về 12px |
| `field` 16px ở màn hẹp | **chống Safari iOS tự phóng trang** — xem dưới |
| `button`/`select`/`input` ≥ 44px | một quy tắc `@media` chung, không sửa từng nút |
| `label:has([type=checkbox])` ≥ 44px | vùng bấm thật của ô tick là cái nhãn, đo được 30px |
| `.nav-touch a` ≥ 44px | chỉ trong drawer; sidebar desktop giữ 36px cho gọn |

**Safari iOS phóng cả trang** khi người dùng bấm vào ô nhập có cỡ chữ dưới 16px, và
không tự thu lại — sau đó trang rộng hơn màn hình và phải kéo ngang mới thấy nút gửi.
`field` đang là 14px, nên mọi form của app đều gây ra cú giật đó.

Năm ô lọc trên Dashboard còn khó hơn: chúng dùng `!text-xs`, mà `!important` đè cả quy
tắc `@media`. Đo được: cao đúng 44px nhưng cỡ chữ vẫn 12px. Đổi thành `sm:!text-xs`
để desktop giữ thanh lọc gọn còn điện thoại lấy 16px từ `field`.

Hai cỡ chữ nhỏ nhất nay khai ở **đúng một chỗ** trong `globals.css`. Trước đây rải
trên 203 chỗ, nên muốn đổi thì trên thực tế sẽ không ai đổi.

### Đã kiểm tương tác thật

Drawer được bấm thử trên `/dashboard` thật, đã hydrate: `aria-expanded` chuyển
`false → true`, panel portal ra body cao đúng 812px, cuộn được (743px thấy / 1078px
nội dung), 22 link đều ≥ 44px, trang bị khoá cuộn. Bấm "Positions" → điều hướng đúng,
panel tự đóng, cuộn trang được trả lại, `aria-expanded` về `false`.

Còn lại một điểm chưa đạt chuẩn và **để nguyên có chủ ý**: ô tick vẫn cao 20px. Kéo
chính cái ô lên 44px sẽ thành một hình vuông to bất thường giữa dòng — nhãn bao quanh
nó đã là vùng bấm 44px.
