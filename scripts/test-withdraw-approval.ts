/**
 * KIỂM THỬ DUYỆT YÊU CẦU RÚT VỐN.
 *
 * Yêu cầu: lệnh rút phải được cấp QUẢN LÝ NHÓM trở lên chấp nhận. Nạp vốn thì không —
 * nạp làm tăng tiền, khai sai thấy ngay ở số dư; rút làm tiền ra khỏi hệ thống.
 *
 * Bài này kiểm:
 *
 *   1. rút → ghi PENDING, số dư CHƯA đổi
 *   2. nạp → ghi CONFIRMED ngay, số dư đổi ngay
 *   3. người KHÔNG có `capital.approve` không duyệt được
 *   4. bốn mắt (§8): không tự duyệt yêu cầu của chính mình, kể cả khi có quyền
 *   5. quản lý nhóm duyệt được → số dư giảm đúng số đã duyệt
 *   6. từ chối → CANCELLED, số dư KHÔNG đổi
 *   7. duyệt lần hai một yêu cầu đã xử lý → từ chối
 *   8. hai yêu cầu chờ cùng lúc không vượt được số dư (chống rút hai lần một khoản)
 *   9. số dư đổi giữa lúc gửi và lúc duyệt → duyệt bị chặn
 *
 * Gọi ĐÚNG các server action. Chạy trên BẢN SAO database.
 * Dùng: npm run test:withdraw-approval
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import {
  approveWithdrawalAction,
  depositCapitalAction,
  rejectWithdrawalAction,
  withdrawCapitalAction,
} from '@/accounts/actions';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { ROLE_PERMISSIONS } from '@/domain/permissions';
import { formatVnd } from '@/lib/money';
import { ROLE, USER_STATUS, CAPITAL_FLOW_STATUS } from '@/lib/enums';

let dat = 0;
let truot = 0;

function kiem(dieuKien: boolean, nhan: string, chiTiet = ''): void {
  if (dieuKien) {
    dat++;
    console.log(`  DAT   ${nhan}`);
  } else {
    truot++;
    console.log(`  TRUOT ${nhan}${chiTiet ? ` -> ${chiTiet}` : ''}`);
  }
}

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  // =========================================================================
  // 0. Quyền: quản lý nhóm phải có capital.approve
  // =========================================================================
  console.log('0. Ma trận quyền');
  {
    const tm = ROLE_PERMISSIONS[ROLE.TEAM_MANAGER];
    const sm = ROLE_PERMISSIONS[ROLE.SENIOR_MANAGER];
    const ex = ROLE_PERMISSIONS[ROLE.EXECUTION];

    kiem(tm.includes('capital.approve'), 'Quản lý nhóm CÓ capital.approve');
    kiem(sm.includes('capital.approve'), 'Quản lý cấp cao CÓ capital.approve');
    kiem(!ex.includes('capital.approve'), 'Nhóm thực thi KHÔNG có capital.approve');
  }

  // ---- Người gửi yêu cầu: một người có tài khoản và cùng nhóm với một trưởng nhóm ----
  const truongNhom = await prisma.user.findFirst({
    where: { role: { code: ROLE.TEAM_MANAGER }, status: USER_STATUS.ACTIVE, teamId: { not: null } },
    select: { id: true, fullName: true, teamId: true },
  });

  if (!truongNhom) {
    console.log('\n  BOQUA: khong co truong nhom nao dang hoat dong va thuoc mot nhom');
    return;
  }

  /*
   * TỰ DỰNG NỀN, KHÔNG PHỤ THUỘC DỮ LIỆU CÓ SẴN.
   *
   * Bản đầu đi tìm một người cùng nhóm với trưởng nhóm VÀ đã có tài khoản chứng khoán.
   * Nó bỏ qua toàn bộ bài kiểm ngay lần chạy đầu, vì trong dữ liệu thật nhóm của trưởng
   * nhóm đó không có ai khác đã khai tài khoản. Một bài kiểm chỉ chạy khi dữ liệu tình
   * cờ thuận thì sẽ im lặng vào đúng lúc cần nó.
   *
   * Tạo tài khoản chứng khoán bằng `prisma` trực tiếp là CỐ Ý: nó là NỀN, không phải
   * thứ đang được kiểm. Phần đang kiểm — gửi yêu cầu rút, duyệt, từ chối — vẫn đi qua
   * đúng các server action.
   */
  let nguoiGui = await prisma.user.findFirst({
    where: {
      teamId: truongNhom.teamId,
      id: { not: truongNhom.id },
      status: USER_STATUS.ACTIVE,
      brokerAccounts: { some: { isActive: true } },
    },
    select: { id: true, fullName: true, teamId: true },
  });

  if (!nguoiGui) {
    nguoiGui = await prisma.user.findFirst({
      where: {
        teamId: truongNhom.teamId,
        id: { not: truongNhom.id },
        status: USER_STATUS.ACTIVE,
      },
      select: { id: true, fullName: true, teamId: true },
    });

    if (!nguoiGui) {
      console.log(`\n  BOQUA: nhom cua ${truongNhom.fullName} khong co thanh vien nao khac`);
      return;
    }

    await prisma.brokerAccount.create({
      data: {
        userId: nguoiGui.id,
        broker: 'SSI',
        accountNo: `KT${String(Date.now()).slice(-6)}`,
        isActive: true,
        note: 'Tài khoản dựng cho bài kiểm duyệt rút vốn',
      },
    });
    console.log(`  (đã dựng tài khoản chứng khoán cho ${nguoiGui.fullName})`);
  }

  const tk = await prisma.brokerAccount.findFirstOrThrow({
    where: { userId: nguoiGui.id, isActive: true },
    select: { id: true, broker: true, accountNo: true },
  });

  const idNguoiGui = nguoiGui.id;

  const conLai = async (): Promise<bigint> =>
    (await computeAccountBalances(portfolio.id, idNguoiGui)).find((b) => b.accountId === tk.id)
      ?.available ?? 0n;

  const form = (amount: bigint): FormData => {
    const f = new FormData();
    f.set('brokerAccountId', tk.id);
    f.set('amount', String(amount));
    f.set('occurredAt', new Date().toISOString());
    return f;
  };

  const formQuyet = (flowId: string, comment?: string): FormData => {
    const f = new FormData();
    f.set('flowId', flowId);
    if (comment) f.set('comment', comment);
    return f;
  };

  console.log(
    `\nNgười gửi: ${nguoiGui.fullName} · ${tk.broker} ${tk.accountNo}\n` +
      `Người duyệt: ${truongNhom.fullName} (quản lý nhóm, cùng nhóm)`,
  );

  // =========================================================================
  // 2. Nạp vốn → CONFIRMED ngay
  // =========================================================================
  console.log('\n2. Nạp vốn ghi thẳng, không chờ duyệt');
  await createSession(nguoiGui.id);
  {
    const truoc = await conLai();
    const kq = await depositCapitalAction(null, form(1_000_000_000n));

    kiem(kq.ok === true, 'nạp 1.000.000.000 ₫ được ngay', JSON.stringify(kq));
    kiem(
      (await conLai()) === truoc + 1_000_000_000n,
      'số dư tăng ngay',
      `${formatVnd(await conLai())}`,
    );

    const flow = await prisma.capitalFlow.findFirst({
      where: { brokerAccountId: tk.id, flowType: 'CONTRIBUTION' },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    kiem(flow?.status === CAPITAL_FLOW_STATUS.CONFIRMED, 'trạng thái CONFIRMED');
  }

  // =========================================================================
  // 1. Rút vốn → PENDING, số dư chưa đổi
  // =========================================================================
  console.log('\n1. Rút vốn chỉ tạo yêu cầu, số dư chưa đổi');
  let flowId = '';
  {
    const truoc = await conLai();
    const kq = await withdrawCapitalAction(null, form(200_000_000n));

    kiem(kq.ok === true, 'gửi yêu cầu rút 200.000.000 ₫', JSON.stringify(kq));
    kiem(
      kq.message?.includes('Chờ cấp quản lý nhóm') === true,
      'thông báo nói rõ đang chờ duyệt',
      kq.message,
    );

    const flow = await prisma.capitalFlow.findFirst({
      where: { brokerAccountId: tk.id, flowType: 'WITHDRAWAL' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, amount: true },
    });

    kiem(flow?.status === CAPITAL_FLOW_STATUS.PENDING, 'trạng thái PENDING', flow?.status);
    kiem(
      (await conLai()) === truoc,
      'SỐ DƯ CHƯA ĐỔI — tiền chưa ra khi chưa ai đồng ý',
      `${formatVnd(truoc)} → ${formatVnd(await conLai())}`,
    );

    flowId = flow?.id ?? '';
  }

  // =========================================================================
  // 3. Người không có quyền không duyệt được
  // =========================================================================
  console.log('\n3. Không có capital.approve thì không duyệt được');
  {
    const thucThi = await prisma.user.findFirst({
      where: { role: { code: ROLE.EXECUTION }, status: USER_STATUS.ACTIVE },
      select: { id: true, fullName: true },
    });

    if (!thucThi) {
      console.log('  BOQUA: khong co nguoi thuoc nhom thuc thi');
    } else {
      await createSession(thucThi.id);
      let bịChan = false;
      try {
        const kq = await approveWithdrawalAction(null, formQuyet(flowId));
        bịChan = kq.ok === false;
      } catch {
        // requirePermission ném lỗi / chuyển hướng — cũng là bị chặn.
        bịChan = true;
      }
      kiem(bịChan, `${thucThi.fullName} (thực thi) không duyệt được`);

      const sau = await prisma.capitalFlow.findUniqueOrThrow({
        where: { id: flowId },
        select: { status: true },
      });
      kiem(sau.status === CAPITAL_FLOW_STATUS.PENDING, 'yêu cầu vẫn đang chờ');
    }
  }

  // =========================================================================
  // 4. Bốn mắt: không tự duyệt yêu cầu của chính mình
  // =========================================================================
  console.log('\n4. Bốn mắt — không tự duyệt yêu cầu của chính mình');
  {
    /*
     * ĐÂY LÀ PHÉP KIỂM QUAN TRỌNG NHẤT VỀ AN TOÀN, nên nó phải CHẠY.
     *
     * Bản trước bỏ qua vì trưởng nhóm chưa khai tài khoản chứng khoán — tức là chốt
     * chống tự duyệt chưa từng được chạy thử lần nào. Dựng nền cho nó, giống như đã
     * dựng cho người gửi ở trên.
     */
    let tkTruong = await prisma.brokerAccount.findFirst({
      where: { userId: truongNhom.id, isActive: true },
      select: { id: true },
    });

    if (!tkTruong) {
      tkTruong = await prisma.brokerAccount.create({
        data: {
          userId: truongNhom.id,
          broker: 'VPS',
          accountNo: `KT${String(Date.now()).slice(-6)}T`,
          isActive: true,
          note: 'Tài khoản dựng cho bài kiểm bốn mắt',
        },
        select: { id: true },
      });
      console.log(`  (đã dựng tài khoản chứng khoán cho ${truongNhom.fullName})`);
    }

    {
      await createSession(truongNhom.id);
      const f = new FormData();
      f.set('brokerAccountId', tkTruong.id);
      f.set('amount', '1000000');
      f.set('occurredAt', new Date().toISOString());
      await depositCapitalAction(null, f);
      await withdrawCapitalAction(null, f);

      const cua = await prisma.capitalFlow.findFirstOrThrow({
        where: { brokerAccountId: tkTruong.id, flowType: 'WITHDRAWAL', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      const kq = await approveWithdrawalAction(null, formQuyet(cua.id));
      kiem(kq.ok === false, 'trưởng nhóm KHÔNG tự duyệt được yêu cầu của mình');
      kiem(
        kq.message?.includes('chính bạn') === true,
        'thông báo nói rõ lý do',
        kq.message,
      );
      console.log(`        thông báo: ${kq.message}`);
    }
  }

  // =========================================================================
  // 8. Hai yêu cầu chờ cùng lúc không vượt được số dư
  // =========================================================================
  console.log('\n8. Hai yêu cầu chờ cùng lúc không vượt được số dư');
  {
    await createSession(nguoiGui.id);
    const cl = await conLai();
    const treo = 200_000_000n; // yêu cầu ở mục 1 vẫn đang chờ

    // Gửi thêm một yêu cầu vượt phần còn rút được.
    const kq = await withdrawCapitalAction(null, form(cl - treo + 1n));
    kiem(kq.ok === false, `từ chối yêu cầu thứ hai vượt phần còn rút được`);
    kiem(
      kq.fieldErrors?.amount?.[0]?.includes('chờ duyệt') === true,
      'thông báo nêu rõ có khoản đang chờ duyệt',
      JSON.stringify(kq.fieldErrors),
    );
    console.log(`        thông báo: ${kq.fieldErrors?.amount?.[0]}`);

    // Còn trong hạn thì vẫn gửi được.
    const kq2 = await withdrawCapitalAction(null, form(1_000_000n));
    kiem(kq2.ok === true, 'yêu cầu nhỏ trong hạn vẫn gửi được', JSON.stringify(kq2));
  }

  // =========================================================================
  // 6. Từ chối → CANCELLED, số dư không đổi
  // =========================================================================
  console.log('\n6. Từ chối yêu cầu');
  {
    const nho = await prisma.capitalFlow.findFirstOrThrow({
      where: { brokerAccountId: tk.id, flowType: 'WITHDRAWAL', status: 'PENDING', amount: 1_000_000n },
      select: { id: true },
    });

    await createSession(truongNhom.id);
    const truoc = await conLai();
    const kq = await rejectWithdrawalAction(null, formQuyet(nho.id, 'Chưa cần rút'));

    kiem(kq.ok === true, 'từ chối được', JSON.stringify(kq));
    const sau = await prisma.capitalFlow.findUniqueOrThrow({
      where: { id: nho.id },
      select: { status: true, approvedById: true },
    });
    kiem(sau.status === CAPITAL_FLOW_STATUS.CANCELLED, 'trạng thái CANCELLED');
    kiem(sau.approvedById === truongNhom.id, 'ghi lại ai đã quyết định');
    kiem((await conLai()) === truoc, 'số dư KHÔNG đổi');
  }

  // =========================================================================
  // 5. Duyệt → số dư giảm đúng số đã duyệt
  // =========================================================================
  console.log('\n5. Quản lý nhóm chấp nhận yêu cầu');
  {
    await createSession(truongNhom.id);
    const truoc = await conLai();
    const kq = await approveWithdrawalAction(null, formQuyet(flowId, 'Đồng ý'));

    kiem(kq.ok === true, 'duyệt được', JSON.stringify(kq));
    kiem(kq.message?.includes('200.000.000') === true, 'thông báo nêu số tiền', kq.message);

    const sau = await prisma.capitalFlow.findUniqueOrThrow({
      where: { id: flowId },
      select: { status: true, approvedById: true, approvedAt: true },
    });
    kiem(sau.status === CAPITAL_FLOW_STATUS.CONFIRMED, 'trạng thái CONFIRMED');
    kiem(sau.approvedById === truongNhom.id && sau.approvedAt !== null, 'ghi lại người và thời điểm');
    kiem(
      (await conLai()) === truoc - 200_000_000n,
      'số dư giảm đúng 200.000.000 ₫',
      `${formatVnd(truoc)} → ${formatVnd(await conLai())}`,
    );
  }

  // =========================================================================
  // 7. Duyệt lần hai → từ chối
  // =========================================================================
  console.log('\n7. Duyệt lại yêu cầu đã xử lý → từ chối');
  {
    const kq = await approveWithdrawalAction(null, formQuyet(flowId));
    kiem(kq.ok === false, 'không duyệt được lần hai');
    kiem(kq.message?.includes('đã được chấp nhận') === true, 'nói rõ đã xử lý', kq.message);
    console.log(`        thông báo: ${kq.message}`);
  }

  // =========================================================================
  // 9. Số dư đổi giữa lúc gửi và lúc duyệt → duyệt bị chặn
  // =========================================================================
  console.log('\n9. Số dư đổi sau khi gửi yêu cầu → duyệt bị chặn');
  {
    await createSession(nguoiGui.id);
    const cl = await conLai();

    if (cl <= 0n) {
      console.log(`  BOQUA: tai khoan con ${formatVnd(cl)}`);
    } else {
      // Gửi yêu cầu rút hết.
      const kqGui = await withdrawCapitalAction(null, form(cl));
      kiem(kqGui.ok === true, `gửi yêu cầu rút hết ${formatVnd(cl)}`, JSON.stringify(kqGui));

      const yc = await prisma.capitalFlow.findFirstOrThrow({
        where: { brokerAccountId: tk.id, flowType: 'WITHDRAWAL', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      /*
       * Rồi tiền đi chỗ khác: ghi một dòng CHI KHÁC làm giảm số dư. Đây là mô phỏng
       * cho việc tiền đã dùng mua cổ phiếu giữa hai thời điểm.
       */
      await prisma.capitalFlow.create({
        data: {
          portfolioId: portfolio.id,
          brokerAccountId: tk.id,
          flowType: 'OTHER_EXPENSE',
          amount: cl / 2n,
          occurredAt: new Date(),
          status: 'CONFIRMED',
          createdById: nguoiGui.id,
          note: 'Mô phỏng tiền đã dùng sau khi gửi yêu cầu',
        },
      });

      await createSession(truongNhom.id);
      const kq = await approveWithdrawalAction(null, formQuyet(yc.id));

      kiem(kq.ok === false, 'duyệt bị chặn vì số dư đã đổi');
      kiem(
        kq.message?.includes('Số dư đã đổi') === true,
        'nói rõ số dư đã đổi từ lúc gửi',
        kq.message,
      );
      kiem(
        (await prisma.capitalFlow.findUniqueOrThrow({ where: { id: yc.id }, select: { status: true } }))
          .status === CAPITAL_FLOW_STATUS.PENDING,
        'yêu cầu vẫn đang chờ, không bị đóng oan',
      );
      kiem((await conLai()) >= 0n, 'số dư không âm', formatVnd(await conLai()));
      console.log(`        thông báo: ${kq.message}`);
    }
  }

  console.log(`\n===== ${dat} đạt, ${truot} trượt =====`);
  if (truot > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('\nLOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
