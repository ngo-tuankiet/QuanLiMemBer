# ĐẶC TẢ DỰ ÁN — Vietnam Securities Investment Management Dashboard

> Đây là bản đặc tả gốc, lưu trong repo để làm hợp đồng tham chiếu. Các chú thích
> trong `prisma/schema.prisma` và `docs/DATA-MODEL.md` dẫn chiếu tới số mục của
> tài liệu này (§1, §6, §23...).

---

## 1. Mục tiêu

Xây dựng một hệ thống quản lý danh mục đầu tư chứng khoán Việt Nam theo mô hình
phân tầng, phục vụ:

- Quản lý tổng nguồn vốn.
- Theo dõi vốn đã sử dụng / chưa sử dụng.
- Quản lý danh mục cổ phiếu.
- Quản lý giao dịch mua/bán.
- Theo dõi hiệu quả đầu tư.
- Phân tích theo ngành.
- Phân tích theo Strategy.
- Theo dõi hiệu suất từng nhóm thực thi.
- Tự động cập nhật giá thị trường thông qua VNStock API.
- Tính lời/lỗ và tỷ trọng danh mục.
- Phân quyền người dùng.
- Kiểm soát và lưu lịch sử thay đổi dữ liệu.

Mục tiêu cuối cùng là tạo ra một **Investment Control Center**, không đơn thuần
là một dashboard thống kê.

---

## 2. Cấu trúc tổ chức

```
ADMIN / SENIOR MANAGEMENT
│
├── Investment Management
│   │
│   ├── Execution Team
│   │
│   ├── Portfolio Management
│   │
│   └── Supporting Execution Team
│
└── Members
```

**Điểm quan trọng:** User không bị gán cố định vào Strategy.

User thuộc: Role → Department → Team.
Còn Strategy được xác định ở **từng Trade**.

---

## 3. Role & Permission

### Admin

Có toàn quyền:

- Quản lý user
- Duyệt tài khoản
- Tạo/sửa/xoá team
- Quản lý permission
- Quản lý vốn
- Xem toàn bộ danh mục
- Xem toàn bộ giao dịch
- Xem audit log
- Cấu hình hệ thống

### Senior Manager

Có thể:

- Xem toàn bộ vốn
- Xem toàn bộ danh mục
- Xem hiệu suất
- Xem Strategy
- Xem ngành
- Xem nhóm thực thi
- Duyệt giao dịch nếu quy trình yêu cầu
- Xem báo cáo

### Team / Execution

Có thể:

- Nhập giao dịch
- Xem giao dịch của nhóm
- Xem danh mục được phân quyền
- Xem Strategy liên quan
- Theo dõi hiệu suất nhóm

### Supporting Execution

Quyền hạn thấp hơn Execution.

### Member

Chỉ được thao tác trong phạm vi được Admin/Manager phân quyền.

---

## 4. User Registration Flow

```
Register
   ↓
Pending
   ↓
Admin Review
   ↓
Assign Role
   ↓
Assign Department
   ↓
Assign Team
   ↓
Active
```

Không có bước:

```
Assign Strategy cho User
```

vì một người có thể thực hiện giao dịch thuộc nhiều Strategy.

---

## 5. Investment Strategy

Hệ thống ban đầu gồm:

1. **Value** — Định giá rẻ
2. **Signal** — Indicator Xanh/Đỏ
3. **Accumulation** — Tích sản
4. **Sector Rotation** — Sóng ngành
5. **Other** — Khác

Có thể thêm Strategy sau này mà không cần thay đổi kiến trúc.

---

## 6. Mô hình quan trọng nhất: Trade có nhiều Strategy

Một giao dịch có thể phân bổ cho nhiều Strategy. Ví dụ:

```
BUY MBB

Giá:        25,300
Khối lượng: 10,000
Giá trị:    253,000,000

Strategy:

Value             50%
Signal            30%
Accumulation      20%
```

Hệ thống phải đảm bảo: **Tổng allocation = 100%**.

Database nên có:

```
TRADE
├── trade_id
├── stock_id
├── user_id
├── team_id
├── transaction_type
├── quantity
├── price
├── fees
├── executed_at
└── ...

TRADE_STRATEGY
├── trade_id
├── strategy_id
├── allocation_percent
└── allocation_amount
```

Đây là cấu trúc cốt lõi của hệ thống.

---

## 7. Stock Master

Không cho người dùng nhập mã tự do. Hệ thống có danh mục mã chuẩn:

```
Stock
├── Symbol
├── Company Name
├── Exchange
├── Sector
├── Industry
└── Status
```

Ví dụ:

```
MBB
Ngân hàng TMCP Quân Đội
HOSE
Financials
Banks
```

Ngành/phân ngành nên được chuẩn hoá để phục vụ dashboard.

---

## 8. Transaction Management

Mỗi giao dịch lưu:

```
Transaction ID
Stock
Buy / Sell
Quantity
Price
Fees
Tax
Execution Time
User
Team
Portfolio
Strategy Allocation
Created Time
Updated Time
Status
```

Có thể bổ sung:

```
Order ID
Broker
Execution Note
Investment Thesis
Attachment
```

nếu cần ở giai đoạn sau.

---

## 9. Position Engine

Hệ thống **không nên lưu thủ công** P&L. Từ Transaction → hệ thống tự tính:

```
Current Quantity
Average Cost
Total Cost
Market Value
Current Price
Unrealized P&L
Realized P&L
Total P&L
Return %
Portfolio Weight
```

Ví dụ:

```
MBB

Quantity          100,000
Average Cost       25,300
Current Price      26,150

Market Value      2.615B
Cost              2.530B
Unrealized P&L   +85M
Return             +3.36%
Weight              12.8%
```

---

## 10. VNStock Market Data

Kiến trúc:

```
VNStock API
     ↓
Market Data Service
     ↓
Cache / Database
     ↓
Portfolio Engine
     ↓
Dashboard
```

Không nên để frontend gọi trực tiếp VNStock.

Hệ thống cần thể hiện trạng thái dữ liệu:

```
Market Data
● Connected

Last Updated
14:45:12

Data Status
● Normal
```

Nếu API gặp lỗi:

```
Market Data Delayed
Last successful update: 14:31:04
```

---

## 11. Dashboard Tầng 1 — Executive Control Center

Đây là màn hình quan trọng nhất.

**Header**

```
BEN THANH INVESTMENT
Executive Control Center

Search Stock

Portfolio
Team
Strategy
Sector
Time

Market Status
Admin
```

Bộ lọc phải là **global filter** — chọn một lần và toàn bộ dashboard thay đổi
theo.

---

## 12. KPI chính

Hàng đầu tiên:

- **Portfolio Value** — Tổng giá trị danh mục hiện tại.
- **Invested Capital** — Tổng vốn đang đầu tư.
- **Available Cash** — Vốn chưa sử dụng.
- **Total P&L** — Tổng lời/lỗ.

Ví dụ:

```
Portfolio Value     ₫10.485B

Invested Capital    ₫6.800B
64.9%

Available Cash      ₫3.200B
30.5%

Total P&L           +₫485M
+7.13%
```

---

## 13. Portfolio Performance

Biểu đồ hiệu suất:

```
1W
1M
3M
6M
YTD
ALL
```

Hiển thị:

```
Portfolio       +7.13%
VN-Index        +5.82%
Alpha           +1.31%
```

Mục tiêu là biết danh mục đang tốt hay xấu so với thị trường.

---

## 14. Capital Allocation

Phân bổ nguồn vốn:

```
Invested
64.9%

Cash
30.5%

Reserve
4.6%
```

Có thể click từng phần để drill-down.

---

## 15. Sector Exposure

Đây là phần rất quan trọng. Ví dụ:

```
BANKING          22.4%
REAL ESTATE      18.7%
TECHNOLOGY       14.2%
SECURITIES       11.6%
STEEL             8.5%
OIL & GAS         6.4%
OTHER            18.2%
```

Click **BANKING** → hiển thị:

```
VCB
MBB
TCB
ACB
CTG
```

Click tiếp **MBB** → thông tin chi tiết MBB.

---

## 16. Strategy Allocation

Dashboard phải tính Strategy từ `TRADE_STRATEGY`. Ví dụ:

```
VALUE
₫2.50B
36.8%

SIGNAL
₫1.80B
26.5%

ACCUMULATION
₫1.20B
17.6%

SECTOR ROTATION
₫0.90B
13.2%

OTHER
₫0.40B
5.9%
```

**Không được cộng trùng vốn khi một Trade có nhiều Strategy.**

---

## 17. Top Positions

Hiển thị các mã chiếm tỷ trọng lớn:

```
MBB       12.8%       +15.2%
VCB        9.6%        +8.4%
FPT        8.7%       +11.7%
HPG        7.9%        -2.1%
SSI        6.4%        +6.8%
```

Có thể sort theo: Weight · P&L · Return · Market Value · Sector

---

## 18. Recent Activity

Không cần đưa toàn bộ giao dịch lên Dashboard. Chỉ hiển thị giao dịch gần nhất:

```
14:32   BUY   MBB   ₫253M   Value
14:18   BUY   FPT   ₫180M   Signal
13:47   BUY   VCB   ₫120M   Accumulation
```

Có nút: **View All Transactions**

---

## 19. Risk & Alerts

Nên có ngay từ phiên bản đầu tiên của Dashboard. Ví dụ:

```
🟠 MBB concentration > 10%

🟡 Banking exposure > 20%

🟢 No critical alerts
```

Các ngưỡng phải cấu hình được.

Sau này có thể bổ sung:

- Một mã vượt tỷ trọng tối đa.
- Một ngành vượt tỷ trọng.
- Một Strategy vượt giới hạn.
- P&L giảm quá mức.
- Dữ liệu thị trường bị trễ.
- Giao dịch chờ duyệt.

---

## 20. Audit Log

Bắt buộc đối với hệ thống quản lý vốn. Mỗi thay đổi phải lưu:

```
Who
When
What
Before
After
```

Ví dụ:

```
24/08/2026 22:41

Nguyễn A

BUY MBB
10,000 shares
25,300

Strategy:
Value 50%
Signal 30%
Accumulation 20%
```

Nếu sửa:

```
Quantity
10,000 → 12,000

Modified by:
Manager B

Time:
22:46
```

**Không được phép "sửa mất dấu vết".**

---

## 21. Cấu trúc menu cuối cùng

```
BEN THANH INVESTMENT
│
├── Dashboard
│
├── Portfolio
│   ├── Overview
│   ├── Positions
│   └── Allocation
│
├── Transactions
│   ├── All Transactions
│   ├── Buy
│   └── Sell
│
├── Strategies
│   ├── Value
│   ├── Signal
│   ├── Accumulation
│   ├── Sector Rotation
│   └── Other
│
├── Market
│   ├── Stocks
│   ├── Sectors
│   └── Market Data
│
├── Performance
│
├── Risk
│
├── Teams
│
├── Members
│
├── Approvals
│
├── Reports
│
├── Audit Log
│
└── Settings
```

---

## 22. Luồng dữ liệu tổng thể

```
USER
 ↓
ROLE / TEAM
 ↓
TRANSACTION
 ↓
TRADE STRATEGY
 ↓
PORTFOLIO ENGINE
 ↓
MARKET DATA
 ↓
POSITION
 ↓
P&L / WEIGHT / PERFORMANCE
 ↓
RISK ENGINE
 ↓
EXECUTIVE DASHBOARD
```

Đây là xương sống của toàn bộ dự án.

---

## 23. Nguyên tắc thiết kế cần giữ

**Không làm Dashboard chỉ để "đẹp"**
Mọi component phải trả lời được một câu hỏi quản trị.

**Không để dữ liệu nhập trùng**
Stock, User, Team, Strategy phải có master data.

**Không gán Strategy cố định cho User**
Strategy thuộc Trade.

**Không lưu P&L thủ công**
P&L phải được tính từ Transaction + Market Data.

**Không gọi API thị trường trực tiếp từ frontend**
Có Market Data Service ở giữa.

**Không cho sửa giao dịch không để lại lịch sử**
Audit Log bắt buộc.

**Không hiển thị quá nhiều thông tin ở Dashboard Tầng 1**
Tầng 1 chỉ là Control Center. Click vào mới drill-down.

---

## 24. Thứ tự triển khai thực tế

Không code Dashboard trước. Thứ tự:

```
PHASE 01
Database & Data Model
        ↓
PHASE 02
Authentication + User + Role + Permission
        ↓
PHASE 03
Stock Master + Sector
        ↓
PHASE 04
Portfolio + Transaction
        ↓
PHASE 05
Multi-Strategy Trade
        ↓
PHASE 06
Position + P&L Engine
        ↓
PHASE 07
VNStock Market Data
        ↓
PHASE 08
Dashboard Tầng 1
        ↓
PHASE 09
Risk + Alert
        ↓
PHASE 10
Audit + Reports
```
