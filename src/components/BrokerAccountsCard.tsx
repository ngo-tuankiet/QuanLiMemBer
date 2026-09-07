import { Card } from '@/components/ui';
import { Money } from '@/components/money';
import { Icon } from '@/components/icons';
import { prisma } from '@/lib/prisma';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { whoCanApproveWithdrawals } from '@/approvals/queue';
import { kiemDongTaiKhoan, lyDoChuaDong } from '@/accounts/close-rules';
import { PORTFOLIO_STATUS } from '@/lib/enums';
import {
  AddBrokerAccountForm,
  CapitalFlowForm,
  ToggleAccountButton,
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
  className,
}: {
  userId: string;
  /** Chỉ chính chủ thấy form. Chốt thật nằm trong server action, đây chỉ là giao diện. */
  isSelf: boolean;
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
    isSelf
      ? prisma.introducingBroker.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve([]),
  ]);

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
        {isSelf ? <AddBrokerAccountForm strategies={strategies} ibs={ibs} /> : null}
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
                  {isSelf ? 'Nạp / rút tiền' : null}
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
                      {isSelf ? (
                        <span className="flex items-center justify-end gap-1">
                          {a.isActive ? (
                            <CapitalFlowForm
                              accountId={a.id}
                              label={`${a.brokerLabel} · ${a.accountNo}`}
                              available={(conLaiTheoTK.get(a.id) ?? 0n).toString()}
                            />
                          ) : null}
                          <ToggleAccountButton
                            accountId={a.id}
                            isActive={a.isActive}
                            blockedReason={lyDoTheoTK.get(a.id) ?? null}
                          />
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
