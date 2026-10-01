# Xác thực & Phân quyền — Phase 02

Tài liệu này giải thích các quyết định thiết kế của tầng auth. Code nằm ở
[`src/auth/`](../src/auth) và [`src/domain/permissions.ts`](../src/domain/permissions.ts).

---

## 1. Phiên đăng nhập: token opaque, không dùng JWT

Đây là quyết định quan trọng nhất của Phase 02, và nó đi ngược mặc định phổ biến.

| | JWT tự chứa | Token opaque + tra DB *(đang dùng)* |
|---|---|---|
| Số truy vấn mỗi request | 0 | 1 (có index) |
| **Thu hồi trước khi hết hạn** | **Không được** | **Được, có hiệu lực ngay** |
| Dùng được trong middleware/edge | Có | Không |
| Cần quản lý secret ký | Có | Không |

Với một hệ thống quản lý vốn, khả năng thu hồi không phải tính năng cho đẹp — nó
là yêu cầu. Khi Admin khoá một tài khoản hoặc rút quyền của ai đó, người đó phải
mất truy cập **ngay lập tức**, không phải "sau khi token hết hạn". JWT không làm
được điều đó mà không kèm thêm một danh sách thu hồi trong database — và khi đã
phải tra database mỗi request thì lợi thế duy nhất của JWT cũng mất.

Cách lưu:

```
Cookie                          Database (bảng sessions)
┌──────────────────────────┐    ┌────────────────────────────────┐
│ vn_session = <32 byte     │    │ tokenHash = SHA-256(token)     │
│              ngẫu nhiên,  │───▶│ userId, expiresAt, revokedAt   │
│              base64url>   │    │ ipAddress, userAgent           │
│ httpOnly, sameSite=lax    │    └────────────────────────────────┘
│ secure (production)       │
└──────────────────────────┘
```

Chỉ **hash** của token được lưu. Kẻ đọc được database vẫn không mạo danh được ai,
vì không dựng lại được token gốc từ hash.

Hệ quả: hệ thống **không cần biến môi trường secret nào** cho auth. Không có
`JWT_SECRET` để rò rỉ hay để quên xoay vòng.

### Khi nào phiên bị thu hồi

| Sự kiện | Thu hồi |
|---|---|
| Người dùng đăng xuất | phiên hiện tại |
| Người dùng đổi mật khẩu | **toàn bộ**, kể cả phiên đang dùng |
| Admin khoá tài khoản | toàn bộ |
| Admin từ chối tài khoản | toàn bộ |
| Admin đổi vai trò / phòng ban / nhóm | toàn bộ |
| Admin cấp hoặc chặn một quyền | toàn bộ |
| Admin bấm "Thu hồi phiên" | toàn bộ |

#### Ba dòng giữa KHÔNG bắt buộc về mặt an toàn — và đây là một sửa lại

Tài liệu này trước đây viết: *"đổi quyền mà không thu hồi phiên thì người dùng vẫn
giữ quyền cũ cho tới khi phiên hết hạn"*. **Câu đó sai với kiến trúc ở đây.**

Nó đúng với JWT — nơi quyền nằm trong chính token. Nhưng hệ này dùng token opaque:
`getCurrentUser()` đọc lại **vai trò, phòng ban, nhóm và mọi quyền ghi đè từ database
ở MỖI request**. Đổi vai trò của ai thì request tiếp theo của họ đã dùng vai trò mới,
dù phiên vẫn còn.

Vậy vẫn thu hồi để làm gì? **Phòng thủ theo lớp.** Nếu sau này ai đó thêm cache cho
`getCurrentUser()` vì lý do hiệu năng, việc thu hồi trở lại thành bắt buộc — và lúc
đó không ai nhớ để thêm lại. Giữ nó là chọn cái giá nhỏ (phải đăng nhập lại) để không
phụ thuộc vào một chi tiết triển khai có thể đổi.

Cái giá đó là thật, nên nó phải được NÓI TRƯỚC.

#### Cảnh báo phải nói đúng ai bị ảnh hưởng

Đã xảy ra thật: một Admin tự gán mình vào nhóm "Cá nhân", bị đá về trang đăng nhập,
và tưởng Dashboard bị lỗi. Nhật ký kiểm toán ghi *"Gán lại vai trò và tổ chức, thu hồi
11 phiên"* — đúng thiết kế, nhưng người bấm không có cách nào biết trước.

Form lúc đó **đã có** cảnh báo, nhưng viết là *"toàn bộ phiên đăng nhập của **người
này** sẽ bị thu hồi"* và hộp xác nhận nói *"**Người dùng** sẽ phải đăng nhập lại"*.
Khi đối tượng là chính mình, cả hai câu đều đọc ra là chuyện của ai khác.

Nay hai form nhận `laChinhMinh` và đổi lời:

| Nơi | Sửa người khác | Sửa chính mình |
|---|---|---|
| `AssignForm` | "phiên của người này bị thu hồi, họ phải đăng nhập lại" | khung vàng: "**bạn sẽ bị đăng xuất ngay**" |
| Hộp xác nhận | "Người dùng sẽ phải đăng nhập lại." | "**BẠN** sẽ bị đăng xuất ngay…" |
| `PermissionEditor` | *(trước đây KHÔNG có cảnh báo nào)* | khung vàng, kèm gợi ý nhờ quản trị viên khác |

`PermissionEditor` là chỗ tệ hơn: mỗi ô Cấp / Chặn / Bỏ ghi đè là một form riêng, bấm
là gửi ngay, **không qua hộp xác nhận nào** — một cú bấm đá người đó ra khỏi hệ thống.

Cố tình KHÔNG thêm hộp xác nhận cho từng ô: bảng có hàng chục dòng và việc điều chỉnh
quyền thường là bấm nhiều ô liên tiếp. Một hộp thoại mỗi lần bấm sẽ thành thứ bấm-Yes-
theo-phản-xạ, tức là mất tác dụng. Một câu nói rõ đặt ngay TRÊN bảng, đọc một lần
trước khi bắt đầu, hợp với cách dùng thật hơn.

Mọi action trong [`src/admin/actions.ts`](../src/admin/actions.ts) vẫn gọi
`revokeAllSessions()` như cũ — lựa chọn ở đây là **giữ hành vi, sửa lời cảnh báo**.

---

## 2. Hai tầng kiểm tra, và tầng nào mới thật

```
Request
   │
   ├─▶ proxy.ts ────────── KIỂM TRA LẠC QUAN
   │                       Chỉ xem cookie có tồn tại hay không.
   │                       Chạy trên edge → không truy cập được database.
   │                       KHÔNG biết cookie còn hiệu lực hay người dùng có quyền gì.
   │                       Xoá file này đi thì app vẫn an toàn, chỉ kém mượt.
   │
   └─▶ requireUser() / requirePagePermission() ───── LỚP BẢO VỆ THẬT
                           Tra database mỗi request.
                           Tính lại tập quyền từ Role + override.
                           Nằm ở layout, page, và MỌI server action.
```

Đây là khuyến nghị chính thức của Next.js: middleware (Next 16 gọi là `proxy`)
dùng cho chuyển hướng, còn xác thực phải nằm ở tầng gần dữ liệu nhất.

**Quy tắc cho các phase sau:** layout chạy trước page, nhưng Next.js không bảo
đảm layout luôn re-render khi điều hướng phía client. Vì vậy mọi page hiển thị dữ
liệu nhạy cảm phải **tự gọi** `requirePagePermission()`, không dựa vào layout.

---

## 3. Vì sao có hai hàm kiểm quyền

| Hàm | Dùng ở | Khi thiếu quyền |
|---|---|---|
| `requirePagePermission(code)` | page, layout | gọi `forbidden()` → **HTTP 403** + `app/forbidden.tsx` |
| `requirePermission(code)` | server action | ném `ForbiddenError` → action trả thông báo kèm mã quyền |

Lý do tách: nếu để lỗi thiếu quyền lan ra error boundary thì phản hồi mang mã
**500**, và hệ thống giám sát không phân biệt được "bị chặn đúng luật" với "server
sập". Ngược lại, `forbidden()` không mang theo dữ liệu nên không hiển thị được mã
quyền cụ thể trong form — đó là việc của `ForbiddenError`.

Trang 403 cố tình **không** hiện mã quyền còn thiếu; mã đó được ghi vào log phía
server (`console.warn('[403] …')`) để quản trị viên tra được.

---

## 4. Phân giải quyền

```
                 DENY của user
                      │  thắng tất cả
                      ▼
                GRANT của user
                      │  thắng Role
                      ▼
              Quyền của Role
```

Cài đặt ở `resolvePermissions()`. Ba điểm cần nhớ:

1. **DENY được xử lý sau cùng** nên luôn thắng, kể cả khi cùng lúc có GRANT.
2. **Override có thể hết hạn** (`expiresAt`) — hết hạn thì tự động bị bỏ qua.
3. **User không ACTIVE có tập quyền rỗng**, dù Role là gì. PENDING / SUSPENDED /
   REJECTED giữ được danh tính để hiện thông báo phù hợp, nhưng không có quyền nào.

Quyền của từng Role được định nghĩa trong **code**
([`ROLE_PERMISSIONS`](../src/domain/permissions.ts)), không phải trong database.
Seed ghi bản đồ đó vào bảng `role_permissions`, và **ghi lại toàn bộ** mỗi lần
chạy — nên một quyền bị xoá khỏi code cũng mất trong database, không để lại quyền
"mồ côi". Lợi ích: mọi thay đổi phân quyền cấp Role đều có lịch sử trong git.

Ngoại lệ cho từng người thì dùng override ở trang chi tiết người dùng — và mỗi
lần điều chỉnh đều ghi Audit Log kèm Before/After.

---

## 5. Chống leo thang đặc quyền

Đây là lỗ hổng kinh điển của mọi hệ thống RBAC: người có quyền `user.assign_role`
tự nâng mình lên ADMIN. Ba chốt trong [`src/admin/actions.ts`](../src/admin/actions.ts):

| Chốt | Ngăn |
|---|---|
| `assertCanAssignRole` | gán vai trò **cao hơn vai trò của chính mình** |
| kiểm `role.level > actor.roleLevel` | thao tác lên tài khoản **cấp cao hơn mình** |
| `assertNotSelf` | tự khoá hoặc tự từ chối chính mình |

Giao diện cũng lọc sẵn danh sách vai trò, nhưng đó chỉ là tiện dụng — **kiểm tra
thật nằm ở server action**, vì form có thể bị sửa từ phía client.

---

## 6. Bảo vệ đăng nhập

| Cơ chế | Cài đặt |
|---|---|
| Băm mật khẩu | bcrypt cost 12 |
| Chống dò email qua thời gian phản hồi | `fakeVerifyDelay()` — email không tồn tại vẫn tiêu tốn đúng một lần bcrypt |
| Tạm khoá sau nhiều lần sai | 5 lần trong 15 phút, **đếm từ chính Audit Log** nên không cần bảng riêng và số lần luôn khớp với nhật ký Admin xem được |
| Buộc đổi mật khẩu lần đầu | `mustChangePassword` — mật khẩu do hệ thống khởi tạo không được tồn tại lâu dài |
| Từ chối mật khẩu quá phổ biến | danh sách chặn, gồm cả chính mật khẩu seed |
| Không ghi mật khẩu vào nhật ký | Audit Log chỉ ghi `passwordChanged: true`, không ghi giá trị hay hash |

---

## 7. Ghi Audit Log

Mọi hành động của Phase 02 đều để lại dấu vết: đăng ký, đăng nhập, **đăng nhập
thất bại**, đăng xuất, đổi mật khẩu, duyệt, từ chối, khoá, mở khoá, đổi vai trò,
cấp/chặn quyền, thu hồi phiên.

`writeAudit()` cố tình **không bao giờ ném lỗi** — một lỗi khi ghi nhật ký không
được phép làm thất bại nghiệp vụ đã hoàn thành. Nhưng nó ghi ra console để lỗi
không bị chôn im lặng.

Khi cần nguyên tử "hoặc cả nghiệp vụ và nhật ký, hoặc không gì cả", truyền `tx`
là Prisma transaction client — `approveUserAction` làm đúng như vậy.

---

## 8. Những gì Phase 02 chưa làm

| Chưa có | Ghi chú |
|---|---|
| Đặt lại mật khẩu qua email | cần dịch vụ gửi mail; hiện Admin thu hồi phiên và cấp mật khẩu mới |
| Xác thực hai lớp (2FA/TOTP) | nên bổ sung trước khi chạy thật với vốn thật |
| Đăng nhập bằng SSO / OAuth | tuỳ hạ tầng của tổ chức |
| Giới hạn tần suất theo IP | hiện chỉ giới hạn theo email |
| Sửa quyền của Role trên giao diện | có chủ đích: quyền cấp Role sống trong git, không sửa trực tiếp trên production |
| Tạo/sửa Team và Department trên giao diện | trang Teams hiện chỉ đọc |

### Vai trò: đổi tên và thêm "Quản lý nhóm"

| Mã | Cấp | Nhãn cũ | Nhãn nay |
|---|---|---|---|
| `ADMIN` | 100 | Quản trị hệ thống | — |
| `SENIOR_MANAGER` | 80 | Quản lý cấp cao | — |
| **`TEAM_MANAGER`** | **60** | *(chưa có)* | **Quản lý nhóm** |
| `EXECUTION` | 50 | Thực thi | **Trade** |
| `SUPPORTING_EXECUTION` | 40 | Hỗ trợ thực thi | **Hỗ trợ Trade** |
| `MEMBER` | 10 | Thành viên | — |

Mã (`code`) **không đổi** — chỉ nhãn tiếng Việt đổi. Đổi mã sẽ làm mọi dòng
`audit_logs` cũ trỏ vào một vai trò không còn tồn tại.

#### `TEAM_MANAGER` không có bất kỳ quyền `*.view_all` nào

Đó là điểm phân biệt duy nhất với Quản lý cấp cao, và nó quan trọng: người này quản
**một** nhóm, nên `dataScope()` trả về `SCOPED` và `applyScope()` ép mọi con số về nhóm
của họ. Cấp `view_all` sẽ cho họ thấy vốn và lãi/lỗ của cả ba nhóm còn lại.

`approval.decide` là lý do vai trò này tồn tại — trưởng nhóm duyệt lệnh của nhóm mình.
Nguyên tắc bốn mắt (§8) vẫn chặn tự duyệt lệnh do chính mình nhập.

Đã kiểm trên ma trận quyền: **20 quyền, có Duyệt, không có `view_all` nào.**

#### Một chỗ TypeScript không bắt được

`ROLE_LABEL_VI`, `ROLE_LEVEL`, `ROLE_PERMISSIONS` đều là `Record<RoleCode, …>` nên
thêm vai trò mà quên một cái là lỗi biên dịch ngay. Nhưng `approveUserSchema.roleCode`
là một **mảng gõ tay** trong `z.enum([...])` — nó chạy lúc runtime, TypeScript im lặng.
Hậu quả nếu bỏ sót: ô chọn vai trò có "Quản lý nhóm" (đọc từ database) nhưng zod từ
chối khi bấm lưu.

Đã sửa để suy thẳng từ `ROLE`:

```ts
const ROLE_CODES = Object.values(ROLE) as [RoleCode, ...RoleCode[]];
```

Cùng loại lỗi với `TRADE_STATUSES_COUNTED_IN_POSITION` từng được khai báo mà không nơi
nào dùng: một danh sách phải tự suy ra, không được chép tay lần thứ hai.

`assertCanAssignRole` thì tự đúng vì nó so `ROLE_LEVEL`, không liệt kê mã.

#### Ghi vào database bằng `npm run db:seed`

Nhãn hiển thị đọc từ `ROLE_LABEL_VI` (theo mã) nên đổi tên là thấy ngay, nhưng
`roles.nameVi` trong database cũng được dùng ở vài chỗ (`AuthUser.roleNameVi`), và
dòng `TEAM_MANAGER` thì phải có thật. Seed dùng `upsert` theo `code` và giữ nguyên mật
khẩu admin đã tồn tại.

Đã đối chiếu trước/sau: **20 người dùng, 15 lệnh, 8 dòng vốn, 6 tài khoản, 4 quyền
riêng, 7 cảnh báo** — không đụng tới dữ liệu thật. Tên nhóm cũng giữ nguyên.

#### Về quy tắc đặt tên vai trò

Chú thích cũ trong `enums.ts` viết "KHÔNG dùng chữ Nhóm". Quy tắc chính xác là không
**trùng tên** một nhóm hay phòng ban có thật — "Quản lý nhóm" dùng chữ đó theo nghĩa
mô tả và không trùng Đá Bóng / Cầu Lông / Tài chính / Cá nhân. Đã sửa lại chú thích cho
đúng thay vì để nó mâu thuẫn với chính dữ liệu.

### Kiểm luồng: hai lỗ hổng do vai trò "Quản lý nhóm" làm lộ ra

Vai trò mới không tạo ra hai lỗi này — nó chỉ là vai trò **SCOPED đầu tiên** có
`approval.view`, nên nó chạm vào những chỗ chưa từng được chạm.

#### 1. Vai trò sinh ra để duyệt lệnh, mà không duyệt được

`TEAM_MANAGER` được cấp `approval.decide`. Nhưng cổng thật của việc duyệt một lệnh là
**`transaction.approve`** — dùng ở 6 chỗ, còn `approval.decide` **không được kiểm ở đâu
cả**.

Kết quả: người quản trị gán vai trò, tin rằng trưởng nhóm duyệt được, rồi không hiểu vì
sao nút duyệt không hiện.

Không ai phát hiện sớm hơn vì `SENIOR_MANAGER` có **cả hai** quyền — nó chạy được nhờ
`transaction.approve`, còn `approval.decide` chỉ đi kèm cho vui.

Đã sửa: cấp `transaction.approve` cho `TEAM_MANAGER`, và **xoá hẳn** `approval.decide`
khỏi danh mục — một quyền không gác gì là cái bẫy.

#### 2. Hàng chờ duyệt không giới hạn phạm vi

```ts
where: { status: TRADE_STATUS.PENDING_APPROVAL }   // không lọc gì
```

Ai có `approval.view` cũng thấy lệnh chờ duyệt của **mọi nhóm** và **mọi danh mục**.
Trước đây chỉ Quản trị và Quản lý cấp cao có quyền đó, mà cả hai đều có
`transaction.view_all` — nên đúng ra vẫn thấy hết. Vai trò mới có `approval.view` mà
**không** có `view_all` nào, nên lỗ hổng mới lộ.

Đã sửa ở **hai tầng**:

| Tầng | Làm gì |
|---|---|
| Trang `/approvals` | lọc theo `dataScope(…, 'transaction')` — SCOPED chỉ thấy nhóm mình |
| `approveTradeAction` / `rejectTradeAction` | kiểm lại `trade.teamId` trước khi quyết |

Chốt server là bắt buộc: `tradeId` là một trường ẩn trong form, sửa được. Lọc ở trang
chỉ để người ta không phải nhìn thứ không dùng được.

Đã kiểm bằng cách mô phỏng đúng chuỗi trang + action:

```
vai trò          phạm vi   hàng chờ thấy gì
ADMIN            ALL       toàn hệ thống
SENIOR_MANAGER   ALL       toàn hệ thống
TEAM_MANAGER     SCOPED    chỉ nhóm mình
EXECUTION        —         không vào được trang

trưởng nhóm A quyết định trên   lệnh nhóm A → cho phép
                                lệnh nhóm B → CHẶN
                                lệnh chưa gán nhóm → CHẶN
```

### Phép kiểm "quyền bẫy" — và hai lần nó tự sai trước khi đúng

Ý tưởng: một quyền được **cấp cho vai trò** mà **không nơi nào kiểm** là cái bẫy. Phân
biệt với quyền chỉ ADMIN có — đó là tính năng chưa dựng, vô hại.

Bản đầu quét thiếu (`src/components/` không nằm trong danh sách) nên báo nhầm
`stock.view` là chết, trong khi nó gác mục menu Market.

Bản thứ hai quét toàn bộ `src/` và `app/` — và **báo xanh một cách vô nghĩa**, vì nó
đọc cả `src/domain/permissions.ts`, nơi mọi mã đều xuất hiện trong danh sách của từng
vai trò. `approval.decide` cũng sẽ lọt qua chính phép kiểm sinh ra để bắt nó.

Bản thứ ba loại file khai báo ra khỏi phạm vi quét. Lúc đó nó tìm ra **4 quyền bẫy còn
lại**:

| Quyền | Cấp cho | Vì sao nó không gác gì |
|---|---|---|
| `capital.view` | 3 vai trò | `dataScope()` chưa bao giờ được gọi với `'capital'` |
| `capital.view_all` | Quản lý cấp cao | như trên |
| `capital.approve` | Quản lý cấp cao | không có luồng duyệt dòng vốn — nạp tiền ghi thẳng `CONFIRMED` |
| `department.view` | 2 vai trò | không trang nào kiểm |

Bốn cái này **chưa gây hỏng gì** (khác `approval.decide`, vốn chặn một vai trò làm đúng
việc của nó), nên để lại thành phép kiểm ĐỎ chứ không âm thầm xoá: sửa chúng là quyết
định nghiệp vụ — hoặc nối vào chỗ cần gác, hoặc bỏ khỏi vai trò.

> Một phép kiểm sai theo hướng "luôn xanh" nguy hiểm hơn không có phép kiểm nào. Cả
> `check(true, …)` trong `verify-model` lẫn hai bản đầu của phép kiểm này đều mắc đúng
> lỗi đó.

---

## 9. Phòng ban và nhóm là HAI câu hỏi khác nhau

Form duyệt tài khoản có ba ô: Vai trò, Phòng ban, Nhóm. Ban đầu ô Nhóm bị lọc theo
Phòng ban đang chọn, và server từ chối nếu `team.departmentId !== user.departmentId`,
với lý do "nếu không thì cây tổ chức §2 vô nghĩa".

Lý do đó sai, và nó chặn một trường hợp thật.

### Trường hợp bị chặn

Một Quản lý cấp cao thuộc phòng **Ban lãnh đạo** vẫn giao dịch dưới nhóm **Cá nhân**.
Nhưng "Ban lãnh đạo" **không có nhóm nào** — và đó là đúng thiết kế:

| Phòng ban | Số nhóm |
|---|---|
| Quản lý đầu tư | 4 (Đá Bóng, Cầu Lông, Tài chính, Cá nhân) |
| Ban lãnh đạo | 0 |
| Thành viên | 0 |

Nên dropdown rỗng và hiện "Phòng ban này chưa có nhóm" — người duyệt **không có cách
nào** gán nhóm cho người đó. Chữ "chưa" còn làm nó trông như một thiếu sót dữ liệu
cần đi khắc phục, trong khi nó là trạng thái vĩnh viễn và đúng.

### Hai ô, hai câu hỏi

| Ô | Trả lời câu | Ảnh hưởng tới |
|---|---|---|
| **Phòng ban** | người này ngồi ở đâu trong cây tổ chức (§2) | báo cáo tổ chức, hiển thị |
| **Nhóm** | giao dịch của người này thuộc nhóm nào | `trades.teamId`, phạm vi `dataScope` khi SCOPED, cách cộng lãi/lỗ theo nhóm |

Nhóm là đơn vị **giao dịch**, không phải đơn vị **tổ chức**. Ràng buộc cũ gộp hai câu
đó thành một, nên bất kỳ ai ngồi ngoài "Quản lý đầu tư" đều không thể có nhóm.

### Đã đổi những gì

| Chỗ | Trước | Sau |
|---|---|---|
| `ApproveForm`, `AssignForm` | lọc nhóm theo phòng ban, `disabled` khi chưa chọn phòng ban | liệt kê MỌI nhóm, gom bằng `optgroup` theo phòng ban |
| `approveUserAction`, `assignUserAction` | từ chối nếu nhóm khác phòng ban | chỉ kiểm nhóm **tồn tại** và **đang hoạt động** |

`optgroup` là phần quan trọng: nó giữ quan hệ tổ chức **nhìn thấy được**. Người duyệt
vẫn đọc ra "Cá nhân thuộc Quản lý đầu tư", nên biết mình đang gán ra ngoài phòng ban
của người đó — đó là một quyết định có ý thức, không phải một tai nạn.

Hai form dùng **chung một hàm** `nhomTheoPhongBan()` xuất từ `ApproveForm`. Dựng riêng
mỗi form một bản thì sớm muộn hai chỗ sẽ hiện hai danh sách khác nhau.

Chốt còn lại ở server vẫn cần: `teamId` đến từ form nên không được tin — nhóm không
tồn tại, hoặc nhóm đã ngừng hoạt động, đều bị từ chối.

### Kiểm thử

`npm run test:approve-team` — 16 phép kiểm, gọi đúng `approveUserAction` và
`assignUserAction` trên bản sao database:

| Tình huống | Mong đợi |
|---|---|
| Quản lý cấp cao · Ban lãnh đạo · nhóm Cá nhân | duyệt được, nhóm được ghi đúng |
| không chọn nhóm | duyệt được, `teamId = null` |
| id nhóm bịa | từ chối, và tài khoản **vẫn ở PENDING** (không kích hoạt nửa vời) |
| nhóm đã tắt | từ chối, nói rõ lý do |
| đổi nhóm sau khi duyệt, sang phòng ban khác | đổi được |

Bài kiểm thử chạy trên **bản sao**, không đụng `dev.db`: duyệt ai với vai trò nào là
quyết định nghiệp vụ, không phải việc của một bài kiểm thử.

---
## 10. Quên mật khẩu: không có email, nên phục hồi qua quản trị viên

Trang đăng nhập trước đây không có mục "Quên mật khẩu", và đó không chỉ là thiếu một
link: **không có đường phục hồi nào cả** — không tự phục vụ, cũng không có action nào
cho quản trị viên đặt lại. Ai quên mật khẩu là mất tài khoản.

### Vì sao không làm luồng tự phục vụ qua email

Luồng "nhập email → nhận link đặt lại" cần gửi được email. Hệ thống này **không có
hạ tầng email nào** — không thư viện, không SMTP, không khoá dịch vụ trong `.env`.
Thêm nó nghĩa là thêm một dịch vụ bên ngoài và gửi địa chỉ email người dùng ra khỏi
máy này. Đó là một quyết định hạ tầng, không phải một hàm.

Và một ô "nhập email để nhận link" khi không có email là **lời hứa suông**: người dùng
gõ email, chờ thư không bao giờ tới, tìm trong hộp thư rác, rồi mới nghĩ tới việc gọi
quản trị viên. Một câu nói thẳng ngay trên trang đăng nhập tiết kiệm đúng khoảng thời
gian đó.

Với một hệ nội bộ vài chục người, phục hồi qua quản trị viên còn **kín hơn**: mật khẩu
tạm được đọc trực tiếp cho người cần, không đi qua hộp thư nào.

### Cỗ máy đã có sẵn, chưa ai bật

`mustChangePassword` tồn tại trong schema và **đã được `requireUser()` cưỡng chế** —
ai có cờ này bị đá về `/change-password` ở mọi trang. Nhưng trước đây **không chỗ nào
đặt nó thành `true`**: một cỗ máy hoàn chỉnh không ai dùng.

`resetUserPasswordAction` bật nó, nên mật khẩu tạm chỉ dùng được đúng một lần để vào
đổi mật khẩu thật.

### Luồng

```
nguoi dung quen mat khau
   │
   ├─ trang /login → mo "Quen mat khau?" → doc huong dan (lien he quan tri vien)
   │
   └─ quan tri vien: /admin/users/<id> → "Dat lai mat khau…"
        ├─ sinh mat khau tam, hien MOT LAN tren man hinh
        ├─ mustChangePassword = true
        ├─ thu hoi TOAN BO phien cua nguoi do
        └─ ghi audit PASSWORD_RESET (KHONG ghi mat khau)
```

### Bốn quyết định đáng nói

**1. Mật khẩu tạm không bao giờ được ghi xuống.** Không audit log, không console,
không file log. Audit chỉ ghi *đã đặt lại*, không ghi *đặt thành gì*. Nó hiện đúng một
lần trên màn hình; tải lại trang là mất và phải đặt lại lần nữa. Một mật khẩu còn đọc
lại được ở đâu đó thì không còn là mật khẩu.

**2. Sinh bằng `crypto.randomBytes`, không phải `Math.random()`.** `Math.random()`
không phải nguồn ngẫu nhiên mật mã — dùng được cho hoạt ảnh, không dùng được cho thứ
bảo vệ một tài khoản. Phép rút cũng loại bỏ phần dư gây lệch phân phối: `byte % len`
làm các ký tự đầu bảng xuất hiện nhiều hơn, một sai lệch nhỏ nhưng thật, và nó giảm
entropy thực tế.

**3. Bỏ ký tự dễ đọc lẫn:** `0/O`, `1/l/I`, `5/S`, `8/B`. Mật khẩu này được **đọc cho
nhau qua điện thoại**, không copy-paste từ email — vì không có email. Một ký tự đọc sai
là một lần đăng nhập thất bại và một cuộc gọi lại.

**4. Không tự đặt lại mật khẩu của mình.** Đổi mật khẩu của mình đi qua
`/change-password`, nơi phải nhập mật khẩu hiện tại. Cho phép ở đây sẽ tạo một đường
đổi mật khẩu **không cần biết mật khẩu cũ** — ai chiếm được phiên của một quản trị viên
sẽ chiếm hẳn tài khoản.

### Quyền và chốt

| Chốt | Ngăn |
|---|---|
| `user.reset_password` | chỉ **ADMIN** có (không vai trò nào khác được cấp) |
| `assertNotSelf` | tự đặt lại mật khẩu của mình — xem quyết định 4 |
| `role.level >= actor.roleLevel` | với tới người ngang hoặc cao hơn mình |
| `revokeAllSessions` | phiên tạo bằng mật khẩu CŨ vẫn sống |

Quyền tách riêng khỏi `user.update` vì đây là thao tác **duy nhất** cho phép một người
chiếm được quyền truy cập tài khoản của người khác. Gộp vào `user.update` sẽ khiến "sửa
số điện thoại" và "chiếm tài khoản" cùng một mã quyền.

`AUDIT_ACTION.PASSWORD_RESET` cũng tách khỏi `UPDATE` cùng lý do: ai soát nhật ký phải
lọc ra được nó mà không phải đọc từng dòng UPDATE.

`revokeAllSessions` ở đây là **bắt buộc thật**, khác với trường hợp đổi vai trò (xem
§1): mật khẩu cũ vừa bị thay, nên mọi phiên tạo bằng nó phải chết — nếu không, người
giữ phiên cũ vẫn dùng tài khoản bình thường và bỏ qua được cả bước buộc đổi mật khẩu.

### Kiểm thử

`npm run test:reset-password` — 23 phép kiểm trên bản sao database. Hai phép quan trọng
nhất:

| Kiểm | Vì sao quan trọng |
|---|---|
| `verifyPassword(matKhauTam, hash)` khớp | sinh một chuỗi rồi băm chuỗi KHÁC vẫn trả về "ok" mà người dùng không vào được — và lúc đó không ai biết lỗi ở đâu |
| audit log không chứa mật khẩu | quét TOÀN BỘ dòng audit dưới dạng JSON, không chỉ vài cột đã biết, nên nếu sau này ai thêm mật khẩu vào `note` hay `afterJson` thì phép kiểm bắt được |

Còn lại: đủ quy tắc (≥12 ký tự, có hoa/thường/số), không ký tự dễ lẫn, hai lần gọi cho
hai mật khẩu khác nhau, tự đặt lại bị từ chối, người ngang cấp bị từ chối, thiếu quyền
ném `ForbiddenError` **trước khi** đổi gì.

---
## 11. Xoá tài khoản: quyền `user.delete`

Admin xoá được tài khoản, nhưng **chỉ tài khoản chưa phát sinh gì**. Đây là hệ thống
ghi sổ: một lệnh phải mãi mãi trả lời được câu "ai đặt". Xoá người đặt lệnh sẽ hoặc
phá chuỗi giao dịch, hoặc để lại tham chiếu mồ côi — cả hai làm mọi con số phía sau
mất căn cứ.

Chính sách đó **đã nằm trong `schema.prisma` từ trước**, ở dạng ràng buộc khoá ngoại:

| Cột | Hành vi | Nghĩa |
|---|---|---|
| `trades.userId`, `trades.createdById` | `RESTRICT` | có lệnh → database chặn xoá |
| `capital_flows.createdById` | `RESTRICT` | có dòng vốn → chặn |
| `broker_accounts.userId` | `RESTRICT` | có tài khoản chứng khoán → chặn |
| `approval_requests.requestedById` | `RESTRICT` | có đề nghị duyệt → chặn |
| `trade_attachments.uploadedById` | `RESTRICT` | có tệp đính kèm → chặn |
| `sessions`, `user_permissions`, `portfolio_access` | `CASCADE` | tự dọn theo |
| `audit_logs.actorUserId` | `SET NULL` | **nhật ký được giữ lại** |

`audit_logs` là chỗ đáng nói. Nó cố ý cho phép xoá, vì mỗi dòng đã lưu sẵn ảnh chụp
`actorEmail` / `actorName` / `actorRole`. Nhật ký vẫn đọc được nguyên vẹn sau khi
người đó không còn trong bảng `users` — đúng §20.

Nên `deleteUserAction` **không nới lỏng gì**. Nó chỉ làm hai việc database không làm
được: kiểm TRƯỚC để trả về một câu tiếng Việt thay vì lỗi khoá ngoại tiếng Anh, và
ghi audit trong cùng transaction **trước** khi bản ghi biến mất.

### Bốn lớp chặn

| Lớp | Chặn kiểu sai nào |
|---|---|
| Khối giao diện gập lại, nằm cuối trang chi tiết | bấm nhầm khi đang làm việc khác |
| Gõ lại đúng email | xoá nhầm người |
| `requirePermission` + `assertNotSelf` + `role.level` | thiếu quyền, tự xoá mình, xoá người cấp cao hơn |
| Đếm lịch sử → từ chối, chỉ sang "Khoá" | xoá người còn dữ liệu |

Chỉ lớp thứ ba và thứ tư là bảo vệ thật; hai lớp đầu giảm sai sót của người đang thao
tác. Nút đặt ở **trang chi tiết**, không đặt cạnh nút "Khoá" trong bảng 20 dòng — một
thao tác không hoàn nguyên được thì không nên nằm cách một thao tác hoàn nguyên được
đúng vài pixel.

**Dùng "Khoá" cho mọi trường hợp khác.** Khoá thu hồi mọi phiên đăng nhập ngay và giữ
nguyên toàn bộ lịch sử — đó mới là thao tác đúng cho một người đã nghỉ việc.

### Kiểm thử: chạy code thật, không chạy bản chép

`npm run test:delete-user` — 26 phép kiểm, gọi **đúng** `deleteUserAction` mà ứng dụng
gọi. Hai thứ làm được điều đó:

- [`scripts/_shim/`](../scripts/_shim/) giả lập `next/headers` và `next/cache`, hai
  module duy nhất buộc phải có request của Next. `tsconfig.test.json` trỏ đường dẫn
  sang shim; `tsconfig.json` của ứng dụng không đổi.
- [`scripts/run-test-copy.mjs`](../scripts/run-test-copy.mjs) sao `dev.db` sang một
  file tạm rồi mới chạy. Việc sao chép nằm trong code, không nằm ở biến môi trường
  phải nhớ đặt — script này XOÁ dữ liệu, nên không được có đường nào chạy thẳng vào
  `dev.db`.

Phép kiểm đáng giá nhất là số 7: sau khi xác nhận action từ chối, nó **bỏ qua lớp ứng
dụng** và gọi thẳng `prisma.user.delete()` lên một người có lệnh. Database phải chặn —
và có chặn. Nếu chỉ kiểm qua action, ta không biết `RESTRICT` còn nguyên hay không.

> Lý do không chép logic vào script kiểm thử: đầu phiên này `verify-model.ts` từng
> chứa công thức Alpha RIÊNG của nó, lệch hẳn so với ứng dụng (−20.70% so với
> +6.29%), mà vẫn "pass" suốt. Một bài kiểm thử chép lại logic chỉ kiểm thử bản chép.
