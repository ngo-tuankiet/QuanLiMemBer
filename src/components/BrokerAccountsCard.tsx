import { Card } from '@/components/ui';
import { Money } from '@/components/money';
import { Icon } from '@/components/icons';
import { prisma } from '@/lib/prisma';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { whoCanApproveWithdrawals } from '@/approvals/queue';
import { AccountValueBars, type AccountValueRow } from '@/components/AccountValueBars';
import { kiemDongTaiKhoan, lyDoChuaDong } from '@/accounts/close-rules';
import { SuaDongVonForm, XoaDongVonForm, type DongVon } from '@/components/CapitalFlowAdmin';
import { PORTFOLIO_STATUS } from '@/lib/enums';
import {
  AddBrokerAccountForm,
  CapitalFlowForm,
  ChangeIbForm,
  ToggleAccountButton,
  type IbOption,
} from '@/components/BrokerAccountForms';
import {
  BROKER,
  BROKER_LABEL_VI,
  CAPITAL_FLOW_SIGN,
  type Broker,
  type CapitalFlowType,
} from '@/lib/enums';

/**
 * THẺ TÀI KHOẢN CHỨNG KHOÁN — dùng ở CẢ HAI trang.
 *
 * Ban đầu thẻ này chỉ nằm inline trong `/members/[id]`, và hậu quả là không ai tìm
 * ra: muốn khai tài khoản của chính mình thì phải vào Members → tự tìm tên mình →
 * bấm vào, trong khi `/profile` ("Tài khoản của tôi") — chỗ tự nhiên nhất — lại
 * không có gì. Tách ra thành component để hai trang dùng CÙNG MỘT bản cài đặt; dán
 * hai lần thì sớm muộn hai chỗ sẽ khác nhau.
 *
 * Component TỰ TRUY VẤN thay vì nhận dữ liệu từ trang. Đổi lấy một lượt truy vấn
 * riêng: nơi gọi không phải biết cần select những cột nào, và tổng "vốn ròng đã nạp"
 * chỉ được tính ở một chỗ.
 */
export async function BrokerAccountsCard({
  userId,
  isSelf,
  canManageIb = false,
  canEditFlows = false,
  canDeleteFlows = false,
  className,
}: {
  userId: string;
  /** Chỉ chính chủ thấy form. Chốt thật nằm trong server action, đây chỉ là giao diện. */
  isSelf: boolean;
  /**
   * Người xem có quyền `ib.manage` — được đổi IB cho tài khoản của NGƯỜI KHÁC.
   *
   * Đây là ngoại lệ duy nhất của quy tắc "tài khoản chỉ chính chủ đụng vào", và nó
   * hẹp đúng bằng một trường `ibId`: số tài khoản, sàn, đóng/mở vẫn chỉ chính chủ.
   * Lý do có ngoại lệ: khi một IB nghỉ việc, toàn bộ tài khoản của họ phải sang IB
   * khác, và chờ từng chủ tài khoản tự sửa là không xong.
   */
  canManageIb?: boolean;
  /**
   * Người xem sửa được dòng nạp/rút của NGƯỜI KHÁC (`capital.update`).
   *
   * Mục đích là sửa lỗi nhập của thành viên. Không mở cho chính chủ: sửa một khoản
   * rút ĐÃ DUYỆT thành số lớn hơn là rút thêm tiền mà không ai duyệt — đi vòng qua
   * đúng cái chốt bốn mắt mà §8 dựng lên.
   */
  canEditFlows?: boolean;
  /** Xoá hẳn dòng nạp/rút (`capital.delete`). */
  canDeleteFlows?: boolean;
  className?: string;
}) {
  /*
   * Chiến lược nạp cùng lượt với tài khoản, chỉ khi có form.
   *
   * Người xem trang của người khác không có form nên không cần danh sách này —
   * không truy vấn thừa.
   */
  /*
   * TIỀN CÒN LẠI ≠ VỐN RÒNG ĐÃ NẠP. Hai con số khác nhau, và cột trong bảng là con
   * số thứ hai:
   *
   *   vốn ròng đã nạp = Σ nạp − Σ rút
   *   tiền còn lại    = vốn ròng đã nạp − Σ chi mua + Σ thu bán
   *
   * Form rút vốn cần con số THỨ HAI — đó mới là tiền rút ra được. Đọc cột đầu rồi
   * rút theo nó là rút quá số dư: tài khoản nạp 100 triệu, mua hết 100 triệu cổ
   * phiếu thì vốn ròng vẫn 100 triệu nhưng tiền còn lại bằng 0.
   */
  const portfolio = await prisma.portfolio.findFirst({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const [accounts, strategies, balances, pendingWithdrawals, ibs] = await Promise.all([
    prisma.brokerAccount.findMany({
      where: { userId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        broker: true,
        brokerOther: true,
        accountNo: true,
        ibId: true,
        ib: { select: { code: true, name: true } },
        note: true,
        isActive: true,
        capitalFlows: {
          where: { status: 'CONFIRMED' },
          orderBy: { occurredAt: 'desc' },
          select: { id: true, flowType: true, amount: true, occurredAt: true },
        },
      },
    }),

    isSelf
      ? prisma.strategy.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, nameVi: true },
        })
      : Promise.resolve([]),

    portfolio && isSelf
      ? computeAccountBalances(portfolio.id, userId)
      : Promise.resolve([]),

    /*
     * YÊU CẦU RÚT ĐANG CHỜ — truy vấn riêng, không gộp vào `capitalFlows`.
     *
     * `capitalFlows` lọc `CONFIRMED` vì nó dùng để tính "vốn ròng đã nạp". Gộp yêu cầu
     * đang chờ vào đó là trừ tiền trước khi có ai đồng ý — đúng thứ mà trạng thái
     * PENDING sinh ra để tránh. Nhưng chủ tài khoản vẫn cần thấy yêu cầu của mình đang
     * ở đâu, nên nó có chỗ riêng.
     */
    prisma.capitalFlow.findMany({
      where: {
        brokerAccount: { userId },
        flowType: 'WITHDRAWAL',
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        amount: true,
        brokerAccountId: true,
        occurredAt: true,
        teamId: true,
        createdById: true,
        brokerAccount: { select: { userId: true } },
      },
    }),

    /*
     * DANH MỤC IB cho ô chọn trong form khai tài khoản.
     *
     * CHỈ IB ĐANG BẬT. IB đã tắt vẫn hiện đúng tên ở những tài khoản đã gắn nó (đọc
     * qua quan hệ `ib` phía trên), nhưng không được khai MỚI theo nó nữa — server
     * cũng từ chối, xem `kiemIb` trong accounts/actions.ts.
     *
     * Chỉ nạp khi người xem là chính chủ: người khác không có form để mà chọn.
     */
    isSelf || canManageIb
      ? prisma.introducingBroker.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          select: { id: true, code: true, name: true, broker: true, brokerOther: true },
        })
      : Promise.resolve([]),
  ]);

  /*
   * DANH SÁCH TỪNG DÒNG NẠP/RÚT — chỉ nạp khi có người sửa được.
   *
   * Bảng phía trên chỉ hiện TỔNG ("2 lượt nạp/rút"), đủ để đọc nhưng không đủ để
   * sửa: muốn sửa một khoản nhập sai thì phải nhìn thấy đúng dòng đó.
   *
   * CHỈ NẠP VÀ RÚT. `capital_flows` còn chứa cổ tức và thu/chi khác; chúng có đường
   * ghi riêng, và cho màn hình này đụng vào dòng cổ tức là sửa được số tiền doanh
   * nghiệp đã trả mà không đụng gì tới vị thế tương ứng.
   */
  const dongVon =
    canEditFlows || canDeleteFlows
      ? await prisma.capitalFlow.findMany({
          where: {
            brokerAccount: { userId },
            flowType: { in: ['CONTRIBUTION', 'WITHDRAWAL'] },
          },
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            flowType: true,
            status: true,
            amount: true,
            occurredAt: true,
            note: true,
            brokerAccountId: true,
          },
        })
      : [];

  /*
   * Prisma trả `broker` kiểu `string` — SQLite không có enum. Ép kiểu MỘT LẦN ở đây
   * thay vì rải `as Broker` ở từng chỗ dùng: rải ra thì chỗ nào quên là chỗ đó lọt
   * một chuỗi bất kỳ vào phép so sánh sàn.
   */
  const ibOptions: IbOption[] = ibs.map((x) => ({ ...x, broker: x.broker as Broker }));

  /*
   * AI DUYỆT ĐƯỢC — để thẻ nói "chờ ai" thay vì chỉ "chờ duyệt".
   *
   * Trường hợp danh sách RỖNG mới là thứ đáng hiện nhất: yêu cầu đã ghi, không ai
   * đủ điều kiện quyết, và trước đây không chỗ nào nói ra — người gửi cứ chờ.
   */
  const nguoiDuyet = await whoCanApproveWithdrawals(
    pendingWithdrawals.map((w) => ({
      id: w.id,
      teamId: w.teamId,
      createdById: w.createdById,
      brokerAccountUserId: w.brokerAccount?.userId ?? null,
    })),
  );

  const choTheoTK = new Map<string, { soLuot: number; tong: bigint; duyetDuoc: Set<string> }>();
  for (const w of pendingWithdrawals) {
    if (!w.brokerAccountId) continue;
    const cu = choTheoTK.get(w.brokerAccountId) ?? {
      soLuot: 0,
      tong: 0n,
      duyetDuoc: new Set<string>(),
    };
    for (const ten of nguoiDuyet.get(w.id) ?? []) cu.duyetDuoc.add(ten);
    choTheoTK.set(w.brokerAccountId, {
      soLuot: cu.soLuot + 1,
      tong: cu.tong + w.amount,
      duyetDuoc: cu.duyetDuoc,
    });
  }

  /*
   * VÌ SAO CHƯA ĐÓNG ĐƯỢC — tính sẵn cho từng tài khoản ĐANG MỞ.
   *
   * Gọi đúng hàm mà `toggleBrokerAccountAction` dùng, nên nút và chốt không thể nói
   * hai điều khác nhau. Chỉ tính cho tài khoản đang mở và khi có form (`isSelf`):
   * tài khoản đã đóng thì nút là "Mở lại" và không cần điều kiện gì.
   */
  const lyDoTheoTK = new Map<string, string>();
  if (portfolio && isSelf) {
    for (const a of accounts) {
      if (!a.isActive) continue;
      const loi = lyDoChuaDong(await kiemDongTaiKhoan(portfolio.id, userId, a.id));
      if (loi) lyDoTheoTK.set(a.id, loi);
    }
  }

  const conLaiTheoTK = new Map(balances.map((b) => [b.accountId, b.available]));

  /*
   * Cộng dòng vốn THEO DẤU của `flowType`, không cộng thẳng `amount`.
   *
   * `capital_flows.amount` luôn dương; chiều tiền nằm ở `CAPITAL_FLOW_SIGN`. Cộng
   * thẳng thì một lần rút 100 triệu sẽ làm "đã nạp" tăng thêm 100 triệu.
   */
  const rows = accounts.map((a) => ({
    ...a,
    net: a.capitalFlows.reduce(
      (sum, f) => sum + BigInt(CAPITAL_FLOW_SIGN[f.flowType as CapitalFlowType]) * f.amount,
      0n,
    ),
    brokerLabel:
      a.broker === BROKER.OTHER
        ? (a.brokerOther ?? 'Khác')
        : (BROKER_LABEL_VI[a.broker as Broker] ?? a.broker),
  }));

  const total = rows.reduce((s, a) => s + a.net, 0n);

  /*
   * DỮ LIỆU BIỂU ĐỒ lấy từ `balances`, không dựng lại từ `rows`.
   *
   * `rows` mang VỐN RÒNG ĐÃ NẠP (tiền đã bỏ vào), còn biểu đồ nói về GIÁ TRỊ ĐANG
   * CÓ (vị thế theo giá thị trường + tiền mặt). Hai đại lượng khác nhau và lệch
   * nhau đúng bằng phần lãi/lỗ — trộn vào một chỗ là cách chắc chắn để sau này ai
   * đó đọc nhầm cái này thành cái kia.
   */
  const bieuDo: AccountValueRow[] = balances.map((b) => ({
    key: b.accountId,
    broker:
      b.broker === BROKER.OTHER
        ? (b.brokerOther ?? 'Khác')
        : (BROKER_LABEL_VI[b.broker as Broker] ?? b.broker),
    accountNo: b.accountNo,
    positionValue: b.positionValue,
    cash: b.available,
    heldSymbols: b.heldSymbols,
    symbolsMissingPrice: b.symbolsMissingPrice,
    isActive: b.isActive,
  }));

  return (
    <Card className={`p-5 ${className ?? ''}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-accent-400">
            <Icon name="wallet" />
          </span>
          <h2 className="text-sm font-semibold text-strong">Tài khoản chứng khoán</h2>
          <span className="text-tiny text-ink-500">
            {rows.length === 0 ? (
              'chưa khai tài khoản nào'
            ) : (
              <>
                {rows.length} tài khoản · vốn ròng đã nạp{' '}
                <Money value={total} className="text-slate-soft" />
              </>
            )}
          </span>
        </div>
        {isSelf ? <AddBrokerAccountForm strategies={strategies} ibs={ibOptions} /> : null}
      </div>

      {rows.length === 0 ? (
        /*
          TRẠNG THÁI RỖNG NÓI RÕ HAI BƯỚC.
          Nút "Nạp vốn" nằm trên DÒNG của một tài khoản, nên khi chưa có tài khoản
          nào thì nó chưa tồn tại — và người dùng đi tìm nó. Bản đầu chỉ có một dòng
          chữ mờ, không đủ.
        */
        <div className="rounded-lg border border-dashed border-ink-700 px-4 py-4">
          {isSelf ? (
            <>
              <p className="text-xs text-slate-soft">Bạn chưa khai tài khoản nào. Hai bước:</p>
              <ol className="mt-2 space-y-1 text-xs text-slate-muted">
                <li>
                  <span className="mr-1.5 text-accent-400">1.</span>
                  Bấm{' '}
                  <span className="rounded border border-ink-700 px-1.5 py-0.5 text-tiny text-slate-soft">
                    + Thêm tài khoản
                  </span>{' '}
                  ở trên — điền sàn, số tài khoản, IB.
                </li>
                <li>
                  <span className="mr-1.5 text-accent-400">2.</span>
                  Tài khoản hiện thành một dòng, trên đó có nút{' '}
                  <span className="rounded border border-up-500/40 px-1.5 py-0.5 text-tiny text-up-500">
                    Nạp vốn
                  </span>{' '}
                  và{' '}
                  <span className="rounded border border-ink-700 px-1.5 py-0.5 text-tiny text-slate-muted">
                    Rút
                  </span>{' '}
                  để ghi nhận tiền — nạp/rút được nhiều lần.
                </li>
              </ol>
            </>
          ) : (
            <p className="text-xs text-ink-500">Người này chưa khai tài khoản chứng khoán nào.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-xs">
            <thead>
              <tr className="border-b border-ink-800 text-left text-slate-muted">
                <th className="pb-2 font-medium">Sàn</th>
                <th className="pb-2 font-medium">Số tài khoản</th>
                <th className="pb-2 font-medium">IB</th>
                <th className="pb-2 text-right font-medium">Vốn ròng đã nạp</th>
                <th className="pb-2 text-right font-medium">Lần gần nhất</th>
                <th className="pb-2 text-right font-medium">
                  {isSelf ? 'Nạp / rút tiền' : canManageIb ? 'IB' : null}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {rows.map((a) => {
                const last = a.capitalFlows[0] ?? null;
                return (
                  <tr key={a.id} className={a.isActive ? undefined : 'opacity-55'}>
                    <td className="py-2.5">
                      <span className="font-medium text-strong">{a.brokerLabel}</span>
                      {!a.isActive ? (
                        <span className="ml-2 rounded bg-ink-800 px-1.5 py-px text-micro text-ink-500">
                          đã đóng
                        </span>
                      ) : null}
                      {a.note ? (
                        <span className="block text-tiny text-ink-500">{a.note}</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 font-mono text-slate-soft">{a.accountNo}</td>
                    <td className="py-2.5 text-slate-muted">
                      {a.ib ? `${a.ib.code} · ${a.ib.name}` : 'Mở trực tiếp'}
                    </td>
                    <td className="tabular py-2.5 text-right">
                      <Money value={a.net} className="text-strong" />
                      <span className="block text-tiny text-ink-500">
                        {a.capitalFlows.length} lượt nạp/rút
                      </span>
                      {/*
                        Chờ duyệt hiện Ở ĐÂY, cạnh con số vốn, chứ không phải một thông báo
                        riêng: người vừa bấm rút sẽ nhìn vào đúng chỗ này để hỏi "tiền đã
                        ra chưa". Câu trả lời là chưa, và phải thấy được ngay.
                      */}
                      {choTheoTK.has(a.id) ? (
                        <span className="block text-tiny text-warn-500">
                          chờ duyệt rút{' '}
                          <Money
                            value={choTheoTK.get(a.id)!.tong}
                            className="text-warn-500"
                          />
                          {choTheoTK.get(a.id)!.soLuot > 1
                            ? ` (${choTheoTK.get(a.id)!.soLuot} yêu cầu)`
                            : ''}
                        </span>
                      ) : null}

                      {/*
                        CHỜ AI — không phải chỉ "chờ".

                        Danh sách rỗng nghĩa là yêu cầu đã ghi nhưng KHÔNG AI đủ điều
                        kiện quyết định: hoặc chưa ai có quyền duyệt vốn trong phạm vi
                        đó, hoặc người duy nhất có lại chính là chủ tài khoản và bị
                        chốt bốn mắt chặn. Trước đây trường hợp này im lặng hoàn toàn.
                      */}
                      {choTheoTK.has(a.id) ? (
                        choTheoTK.get(a.id)!.duyetDuoc.size > 0 ? (
                          <span className="block text-tiny text-ink-500">
                            chờ {[...choTheoTK.get(a.id)!.duyetDuoc].join(', ')} duyệt
                          </span>
                        ) : (
                          <span className="block text-tiny text-down-500">
                            chưa ai duyệt được yêu cầu này — báo quản trị cấp quyền duyệt vốn
                          </span>
                        )
                      ) : null}
                    </td>
                    <td className="tabular py-2.5 text-right text-slate-muted">
                      {last ? dateOnly(last.occurredAt) : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      {/*
                        HAI NHÓM THAO TÁC, HAI NHÓM NGƯỜI.

                        Chính chủ: nạp/rút, đóng/mở, và đổi IB.
                        Người có `ib.manage` xem tài khoản của người khác: CHỈ đổi IB.

                        "Đổi IB" chỉ hiện trên tài khoản CÒN MỞ. Tài khoản đã đóng thì
                        không còn ai quản lý để mà chuyển, và đổi IB cho nó chỉ làm sai
                        lệch biểu đồ vốn theo IB mà không phục vụ việc gì.
                      */}
                      {isSelf || canManageIb ? (
                        <span className="flex items-center justify-end gap-1">
                          {isSelf && a.isActive ? (
                            <CapitalFlowForm
                              accountId={a.id}
                              label={`${a.brokerLabel} · ${a.accountNo}`}
                              available={(conLaiTheoTK.get(a.id) ?? 0n).toString()}
                            />
                          ) : null}
                          {a.isActive ? (
                            <ChangeIbForm
                              accountId={a.id}
                              accountLabel={`${a.brokerLabel} · ${a.accountNo}`}
                              currentIbId={a.ibId}
                              ibs={ibOptions}
                              broker={a.broker as Broker}
                              brokerOther={a.brokerOther}
                              boiQuanTri={!isSelf}
                            />
                          ) : null}
                          {isSelf ? (
                            <ToggleAccountButton
                              accountId={a.id}
                              isActive={a.isActive}
                              blockedReason={lyDoTheoTK.get(a.id) ?? null}
                            />
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        SỬA LỖI NHẬP CỦA THÀNH VIÊN — mở sẵn thì không, vì đây không phải việc hằng ngày.

        Đặt ngay dưới bảng tài khoản chứ không ở một trang quản trị riêng: người đi sửa
        một khoản nhập sai đang đứng ở đúng trang của người nhập sai, nhìn đúng con số
        sai. Bắt họ sang trang khác rồi tự tìm lại dòng đó là thêm một chỗ để nhầm.
      */}
      {dongVon.length > 0 ? (
        <details className="mt-4 rounded-lg border border-ink-700">
          <summary className="cursor-pointer px-3 py-2 text-xs text-slate-muted hover:text-slate-soft">
            Sửa / xoá từng lượt nạp rút ({dongVon.length})
          </summary>
          <div className="border-t border-ink-700 p-3">
            <p className="mb-3 text-tiny leading-relaxed text-slate-muted">
              Dùng khi thành viên nhập sai. Mọi thay đổi ghi vào{' '}
              <span className="text-slate-soft">Nhật ký</span> kèm lý do; tiền của danh mục và
              của nhóm được tính lại ngay vì không bảng nào lưu sẵn số dư.
            </p>

            <ul className="space-y-2">
              {dongVon.map((f) => {
                const laNap = f.flowType === 'CONTRIBUTION';
                const tk = rows.find((r) => r.id === f.brokerAccountId);
                const duLieu: DongVon = {
                  id: f.id,
                  flowType: f.flowType,
                  status: f.status,
                  amount: f.amount.toString(),
                  occurredAt: f.occurredAt.toISOString().slice(0, 10),
                  note: f.note,
                };
                return (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-800 pb-2 last:border-0"
                  >
                    <span className="tabular text-tiny text-slate-muted">
                      {dateOnly(f.occurredAt)}
                    </span>
                    <span
                      className={`text-tiny font-medium ${laNap ? 'text-up-500' : 'text-down-500'}`}
                    >
                      {laNap ? 'Nạp' : 'Rút'}
                    </span>
                    <Money value={f.amount} className="text-xs text-strong" />
                    {tk ? (
                      <span className="text-tiny text-ink-500">
                        {tk.brokerLabel} · {tk.accountNo}
                      </span>
                    ) : null}
                    {/*
                      TRẠNG THÁI HIỆN RÕ. Một khoản rút đang CHỜ DUYỆT chưa trừ tiền;
                      sửa nó và sửa một khoản đã duyệt là hai việc có hậu quả khác nhau,
                      nên người bấm cần thấy mình đang đụng vào cái nào.
                    */}
                    {f.status !== 'CONFIRMED' ? (
                      <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                        {f.status === 'PENDING' ? 'chờ duyệt' : 'đã huỷ'}
                      </span>
                    ) : null}
                    {f.note ? (
                      <span className="text-tiny text-ink-500">{f.note}</span>
                    ) : null}
                    <span className="ml-auto flex items-center gap-1">
                      {canEditFlows ? <SuaDongVonForm flow={duLieu} /> : null}
                      {canDeleteFlows ? <XoaDongVonForm flow={duLieu} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      ) : null}

      {/*
        BIỂU ĐỒ ĐẶT SAU BẢNG, không thay bảng.

        Bảng trả lời "tài khoản này đã nạp bao nhiêu, lần cuối khi nào" — số liệu để
        tra. Biểu đồ trả lời "tiền của tôi đang nằm ở đâu, bao nhiêu còn là tiền mặt"
        — hình để nhìn. Bỏ bảng đi thì mất phần tra cứu; bỏ biểu đồ thì phải tự cộng
        vị thế với tiền mặt trong đầu cho từng tài khoản.

        Chỉ hiện khi có tài khoản: một khối chú giải trống không nói được gì.
      */}
      {bieuDo.length > 0 ? (
        <div className="mt-5 border-t border-ink-800 pt-4">
          <p className="mb-3 text-xs font-medium text-strong">Giá trị từng tài khoản</p>
          <AccountValueBars rows={bieuDo} />
        </div>
      ) : null}

      <p className="mt-3 text-tiny text-ink-500">
        Mỗi lần nạp/rút là một dòng trong <span className="text-slate-soft">capital_flows</span> —
        cùng bảng mà Dashboard dùng để tính số dư tiền, nên tiền chỉ được ghi ở một chỗ. Vốn nạp
        cũng được gắn nhóm của bạn tại thời điểm nạp, nên nó vào đúng “Tiền của nhóm”.
      </p>
    </Card>
  );
}

/**
 * Ngày không kèm giờ.
 *
 * KHÔNG dùng `absoluteVi().slice(0, 10)`: định dạng vi-VN đặt GIỜ lên trước, nên cắt
 * 10 ký tự đầu cho ra "07:00 28/0" — vừa mất năm vừa hiện một cái giờ vô nghĩa với
 * một trường chỉ có ngày.
 */
function dateOnly(d: Date): string {
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
