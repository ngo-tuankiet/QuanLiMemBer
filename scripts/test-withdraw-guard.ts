/**
 * KIỂM THỬ CHỐT "KHÔNG RÚT QUÁ SỐ TIỀN CÒN LẠI".
 *
 * Người dùng rút 354.000.000 ₫ từ một tài khoản còn 223.291.000 ₫ và hệ thống cho qua,
 * để lại số dư âm. Số dư âm ở tài khoản chứng khoán không có thật, và nó lan vào tiền
 * của cả danh mục.
 *
 * HAI CON SỐ DỄ LẪN, và chốt phải dùng đúng con số thứ hai:
 *
 *     vốn ròng đã nạp = Σ nạp − Σ rút
 *     tiền còn lại    = vốn ròng đã nạp − Σ chi mua + Σ thu bán
 *
 * Bài này kiểm:
 *
 *   1. rút ĐÚNG BẰNG số còn lại → nhận yêu cầu (biên phải mở, không phải đóng)
 *   2. rút hơn số còn lại 1 đồng → TỪ CHỐI, không ghi dòng vốn nào
 *   3. thông báo nêu đúng con số còn lại
 *   4. rút khi phần còn rút được đã hết → từ chối
 *   5. NẠP vốn không bị chốt này chạm tới
 *   6. chốt đo theo TIỀN CÒN LẠI, không theo vốn ròng đã nạp — dựng một tài khoản mà
 *      hai con số khác nhau rõ rệt, rồi rút theo con số sai để xem có bị chặn không
 *
 * BÀI NÀY CHỈ KIỂM TRẦN LÚC GỬI YÊU CẦU. Vòng đời duyệt — PENDING, ai được duyệt, bốn
 * mắt, kiểm lại số dư lúc duyệt — nằm ở `test-withdraw-approval.ts`. Vì lệnh rút nay
 * phải chờ duyệt, một yêu cầu được NHẬN không làm số dư giảm; số dư chỉ đổi sau khi có
 * người đồng ý.
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:withdraw-guard
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { depositCapitalAction, withdrawCapitalAction } from '@/accounts/actions';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import { ROLE, USER_STATUS, CAPITAL_FLOW_SIGN, type CapitalFlowType } from '@/lib/enums';

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
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });
  await createSession(admin.id);

  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  /** Tiền còn lại của một tài khoản, đọc lại từ engine. */
  const conLai = async (accountId: string): Promise<bigint> =>
    (await computeAccountBalances(portfolio.id, admin.id)).find((b) => b.accountId === accountId)
      ?.available ?? 0n;

  /** Vốn ròng đã nạp — con số DỄ LẪN với tiền còn lại. */
  const vonRong = async (accountId: string): Promise<bigint> => {
    const flows = await prisma.capitalFlow.findMany({
      where: { brokerAccountId: accountId, status: 'CONFIRMED' },
      select: { flowType: true, amount: true },
    });
    return flows.reduce(
      (s, f) => s + BigInt(CAPITAL_FLOW_SIGN[f.flowType as CapitalFlowType]) * f.amount,
      0n,
    );
  };

  const form = (accountId: string, amount: bigint): FormData => {
    const f = new FormData();
    f.set('brokerAccountId', accountId);
    f.set('amount', String(amount));
    f.set('occurredAt', new Date().toISOString());
    return f;
  };

  const demFlow = (accountId: string) =>
    prisma.capitalFlow.count({ where: { brokerAccountId: accountId } });

  /** Tổng các yêu cầu rút đang chờ duyệt của một tài khoản. */
  const dangCho = async (accountId: string): Promise<bigint> =>
    (
      await prisma.capitalFlow.findMany({
        where: { brokerAccountId: accountId, flowType: 'WITHDRAWAL', status: 'PENDING' },
        select: { amount: true },
      })
    ).reduce((t, f) => t + f.amount, 0n);

  /**
   * PHẦN CÒN RÚT ĐƯỢC — mốc thật của chốt, không phải số dư.
   *
   * Bài kiểm bản trước lấy `conLai()` làm mốc và trượt ngay khi dữ liệu thật có một
   * yêu cầu rút 10 triệu đang chờ: số dư vẫn 300 triệu nhưng chỉ rút thêm được 290
   * triệu. Mốc sai làm bài kiểm báo lỗi cho một chốt đang chạy đúng.
   */
  const rutDuoc = async (accountId: string): Promise<bigint> =>
    (await conLai(accountId)) - (await dangCho(accountId));

  /*
   * TỰ DỰNG ĐIỀU KIỆN, KHÔNG PHỤ THUỘC TRẠNG THÁI DATABASE.
   *
   * Bản đầu đi tìm một tài khoản đã sẵn có tiền dương và có tiền-còn-lại khác vốn-ròng.
   * Nó bỏ qua toàn bộ bài kiểm ngay lần chạy đầu, vì đúng lúc đó dev.db không còn tài
   * khoản nào dương — chính lệnh rút quá số dư đã làm âm hết. Một bài kiểm chỉ chạy khi
   * dữ liệu tình cờ thuận là bài kiểm sẽ im lặng vào đúng lúc cần nó nhất.
   *
   * Nay: chọn tài khoản CÓ LỆNH (để tiền còn lại chắc chắn khác vốn ròng đã nạp — đó là
   * điều kiện của phép kiểm 3), rồi tự nạp cho đủ 300 triệu và bắt đầu từ đó.
   */
  const tk = await prisma.brokerAccount.findMany({
    where: { userId: admin.id, isActive: true },
    select: {
      id: true,
      broker: true,
      accountNo: true,
      _count: { select: { trades: true } },
    },
  });

  for (const a of tk) {
    const [cl, vr] = await Promise.all([conLai(a.id), vonRong(a.id)]);
    console.log(
      `${a.broker} ${a.accountNo}: còn lại ${formatVnd(cl)} · vốn ròng ${formatVnd(vr)} · ` +
        `${a._count.trades} lệnh`,
    );
  }

  const chon = [...tk].sort((a, b) => b._count.trades - a._count.trades)[0];

  if (!chon || chon._count.trades === 0) {
    console.log('\n  BOQUA: admin khong co tai khoan nao co lenh — tien con lai se bang von rong');
    return;
  }

  const MUC = 300_000_000n;
  const truocNap = await conLai(chon.id);

  if (truocNap < MUC) {
    const kqNap = await depositCapitalAction(null, form(chon.id, MUC - truocNap));
    if (kqNap.ok !== true) {
      console.log(`\n  LOI: khong nap duoc von de dung dieu kien: ${JSON.stringify(kqNap)}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `\nTài khoản kiểm: ${chon.broker} ${chon.accountNo} — nạp thêm ` +
      `${formatVnd(MUC - truocNap)} để còn lại ${formatVnd(await conLai(chon.id))}`,
  );

  kiem(
    (await conLai(chon.id)) !== (await vonRong(chon.id)),
    'nền: tiền còn lại KHÁC vốn ròng đã nạp — phép kiểm 3 có tác dụng thật',
    `${formatVnd(await conLai(chon.id))} vs ${formatVnd(await vonRong(chon.id))}`,
  );

  // =========================================================================
  // 1. Rút hơn 1 đồng → từ chối
  // =========================================================================
  console.log('\n1. Rút hơn phần còn rút được 1 đồng → từ chối');
  {
    const rd = await rutDuoc(chon.id);
    const truocSo = await demFlow(chon.id);

    const kq = await withdrawCapitalAction(null, form(chon.id, rd + 1n));

    kiem(kq.ok === false, `từ chối rút ${formatVnd(rd + 1n)} khi rút được ${formatVnd(rd)}`);
    kiem((await demFlow(chon.id)) === truocSo, 'không dòng vốn nào được ghi');
    kiem(
      kq.fieldErrors?.amount?.some((m) => m.includes(rd.toLocaleString('vi-VN'))) === true,
      'thông báo nêu đúng con số rút được',
      JSON.stringify(kq.fieldErrors),
    );
    console.log(`        thông báo: ${kq.fieldErrors?.amount?.[0]}`);
  }

  // =========================================================================
  // 2. Rút quá nhiều như tình huống thật (354 triệu) → từ chối
  // =========================================================================
  console.log('\n2. Đúng tình huống đã xảy ra: rút 354.000.000 ₫');
  {
    const cl = await conLai(chon.id);
    const truocSo = await demFlow(chon.id);
    const kq = await withdrawCapitalAction(null, form(chon.id, 354_000_000n));

    if (cl >= 354_000_000n) {
      console.log(`  BOQUA: tai khoan con ${formatVnd(cl)}, 354 trieu khong con la qua nhieu`);
    } else {
      kiem(kq.ok === false, 'bị từ chối');
      kiem((await demFlow(chon.id)) === truocSo, 'không ghi gì — số dư không thể âm');
      kiem((await conLai(chon.id)) >= 0n, 'tiền còn lại vẫn không âm sau khi thử');
    }
  }

  // =========================================================================
  // 3. Chốt đo theo TIỀN CÒN LẠI, không theo vốn ròng đã nạp
  // =========================================================================
  console.log('\n3. Chốt đo theo tiền còn lại, không theo vốn ròng đã nạp');
  {
    const [cl, vr] = await Promise.all([conLai(chon.id), vonRong(chon.id)]);
    console.log(`        còn lại ${formatVnd(cl)} · vốn ròng ${formatVnd(vr)}`);

    /*
     * Rút một số nằm GIỮA hai con số. Nếu chốt lấy con số lớn hơn làm trần thì lệnh này
     * qua được, và đó chính là lỗi cần bắt.
     */
    const nho = cl < vr ? cl : vr;
    const lon = cl < vr ? vr : cl;
    const giua = nho + (lon - nho) / 2n;

    if (giua <= nho || giua >= lon) {
      console.log('  BOQUA: hai con so quá gần nhau, không dựng được số ở giữa');
    } else {
      const truocSo = await demFlow(chon.id);
      const kq = await withdrawCapitalAction(null, form(chon.id, giua));
      const quaDuoc = kq.ok === true;

      if (cl < vr) {
        kiem(!quaDuoc, `từ chối ${formatVnd(giua)} — dưới vốn ròng nhưng TRÊN tiền còn lại`);
        kiem((await demFlow(chon.id)) === truocSo, 'không ghi gì');
      } else {
        kiem(quaDuoc, `cho qua ${formatVnd(giua)} — dưới tiền còn lại là hợp lệ`);
      }
      console.log(`        kết quả: ${quaDuoc ? 'cho qua' : (kq.fieldErrors?.amount?.[0] ?? kq.message)}`);
    }
  }

  // =========================================================================
  // 4. Rút ĐÚNG BẰNG số còn lại → cho qua (biên mở)
  // =========================================================================
  console.log('\n4. Rút đúng bằng phần còn rút được → NHẬN yêu cầu, số dư chưa đổi');
  {
    const rd = await rutDuoc(chon.id);
    const clTruoc = await conLai(chon.id);

    if (rd <= 0n) {
      console.log(`  BOQUA: chi rut duoc ${formatVnd(rd)}`);
    } else {
      const kq = await withdrawCapitalAction(null, form(chon.id, rd));
      kiem(
        kq.ok === true,
        `nhận yêu cầu rút hết phần còn lại ${formatVnd(rd)}`,
        JSON.stringify(kq.fieldErrors),
      );

      /*
       * BIÊN PHẢI MỞ: rút đúng bằng phần còn rút được là hợp lệ, không phải vượt. Và
       * số dư KHÔNG đổi — yêu cầu còn đang chờ duyệt, tiền chưa ra.
       */
      kiem(
        (await conLai(chon.id)) === clTruoc,
        'số dư CHƯA đổi — yêu cầu còn chờ duyệt',
        `${formatVnd(clTruoc)} → ${formatVnd(await conLai(chon.id))}`,
      );
      kiem((await rutDuoc(chon.id)) === 0n, 'phần còn rút được về 0', formatVnd(await rutDuoc(chon.id)));
    }
  }

  // =========================================================================
  // 5. Rút khi đã hết tiền → từ chối
  // =========================================================================
  console.log('\n5. Phần còn rút được đã hết vì có yêu cầu chờ → từ chối');
  {
    /*
     * Mục 4 vừa gửi một yêu cầu rút HẾT số dư. Nó chưa được duyệt nên số dư vẫn nguyên,
     * nhưng phần CÒN RÚT ĐƯỢC đã bằng 0 — nếu không trừ khoản đang chờ thì hai yêu cầu
     * cùng rút hết đều qua được, rồi cả hai được duyệt và số dư âm.
     */
    const cl = await conLai(chon.id);
    const treo = await dangCho(chon.id);

    kiem(
      treo >= cl && cl > 0n,
      'nền: khoản đang chờ đã bằng cả số dư',
      `còn ${formatVnd(cl)}, chờ ${formatVnd(treo)}`,
    );

    const truocSo = await demFlow(chon.id);
    const kq = await withdrawCapitalAction(null, form(chon.id, 1_000_000n));

    kiem(kq.ok === false, 'bị từ chối');
    kiem((await demFlow(chon.id)) === truocSo, 'không ghi gì');
    kiem(
      kq.fieldErrors?.amount?.[0]?.includes('chờ duyệt') === true,
      'thông báo nêu rõ có khoản đang chờ duyệt',
      JSON.stringify(kq.fieldErrors),
    );
    console.log(`        thông báo: ${kq.fieldErrors?.amount?.[0]}`);
  }

  // =========================================================================
  // 6. NẠP vốn không bị chốt này chạm tới
  // =========================================================================
  console.log('\n6. Nạp vốn vẫn bình thường — chốt chỉ áp cho lệnh rút');
  {
    const truocSo = await demFlow(chon.id);
    const truocNapThem = await conLai(chon.id);
    const kq = await depositCapitalAction(null, form(chon.id, 500_000_000n));

    kiem(kq.ok === true, 'nạp 500.000.000 ₫ được', JSON.stringify(kq.fieldErrors));
    kiem((await demFlow(chon.id)) === truocSo + 1, 'ghi đúng một dòng vốn');
    kiem(
      (await conLai(chon.id)) === truocNapThem + 500_000_000n,
      'tiền còn lại tăng đúng 500.000.000 ₫ — nạp có hiệu lực NGAY',
      `${formatVnd(truocNapThem)} → ${formatVnd(await conLai(chon.id))}`,
    );

    /*
     * Và giờ gửi được yêu cầu rút đúng số vừa nạp: khoản chờ cũ chiếm hết số dư CŨ,
     * còn 500 triệu mới nạp là phần rút được thêm.
     */
    const kqRut = await withdrawCapitalAction(null, form(chon.id, 500_000_000n));
    kiem(kqRut.ok === true, 'gửi được yêu cầu rút đúng số vừa nạp', JSON.stringify(kqRut.fieldErrors));
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
