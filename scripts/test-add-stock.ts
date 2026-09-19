/**
 * KIỂM THỬ `addStockAction` — ô "Thêm mã vào danh mục chuẩn".
 *
 * Chạy trên BẢN SAO database. Mọi ca đều dừng TRƯỚC khi gọi nguồn: hoặc bị chốt từ
 * chối, hoặc — ở ca thành công — có sẵn một dòng đồng bộ RUNNING chặn lại. Nhờ vậy
 * không có request nào ra VNStock.
 *
 * ĐIỀU BÀI NÀY THỰC SỰ CANH. Thêm mã là đường ghi thẳng vào master data, thứ mà §7
 * dựng lên để bảo vệ. Nên mỗi phép kiểm đều hỏi cùng một câu: sau khi bị từ chối,
 * bảng `stocks` có đúng bằng lúc trước không. Một action hỏng luôn cũng "từ chối"
 * được, nhưng nó không giữ được số đó nếu đã kịp ghi.
 *
 * Dùng: npm run test:add-stock
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { addStockAction } from '@/market/actions';
import { ROLE, USER_STATUS, SYNC_STATUS, SYNC_TRIGGER, SYNC_KIND } from '@/lib/enums';

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

function form(v: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });

  const vaiTro = await prisma.role.findMany({ select: { id: true, code: true } });
  const idVaiTro = (code: string): string => {
    const r = vaiTro.find((x) => x.code === code);
    if (!r) throw new Error(`thieu vai tro ${code}`);
    return r.id;
  };

  // Hai ngành khác nhau, mỗi ngành một phân ngành — đủ để dựng ca ghép sai cặp.
  const nganh = await prisma.sector.findMany({
    where: { industries: { some: {} } },
    orderBy: { sortOrder: 'asc' },
    take: 2,
    select: { id: true, nameVi: true, industries: { take: 1, select: { id: true, nameVi: true } } },
  });
  const nganhA = nganh[0];
  const nganhB = nganh[1];
  const pnA = nganhA?.industries[0];
  const pnB = nganhB?.industries[0];
  if (!nganhA || !nganhB || !pnA || !pnB) {
    throw new Error('can it nhat 2 nganh co phan nganh de kiem thu');
  }

  const hopLe = {
    symbol: 'ZZKT',
    companyName: 'Cong ty kiem thu them ma',
    exchange: 'HOSE',
    sectorId: nganhA.id,
    industryId: pnA.id,
  };

  console.log('\n1. Không có quyền `stock.create` → ForbiddenError');
  {
    /*
     * Quản lý cấp cao có `stock.view` (thấy danh sách mã) nhưng không có
     * `stock.create`. Nếu hai quyền đó bị lẫn thì ai xem được master data cũng ghi
     * được vào nó.
     */
    const nguoi = await prisma.user.create({
      data: {
        email: `khongquyen.addstock-${process.pid}@example.invalid`,
        passwordHash: 'x'.repeat(60),
        fullName: 'Kiem thu khong quyen',
        status: USER_STATUS.ACTIVE,
        roleId: idVaiTro(ROLE.SENIOR_MANAGER),
      },
    });
    await createSession(nguoi.id);

    const truocMa = await prisma.stock.count();
    let daNem = false;
    try {
      await addStockAction(null, form(hopLe));
    } catch (e) {
      daNem = e instanceof Error && e.name === 'ForbiddenError';
    }
    kiem(daNem, 'ném ForbiddenError');
    kiem((await prisma.stock.count()) === truocMa, 'không thêm mã nào');
  }

  await createSession(admin.id);

  console.log('\n2. Dữ liệu sai dạng → từ chối, master data không đổi');
  {
    const ca: [string, Record<string, string>][] = [
      ['mã có dấu phẩy', { ...hopLe, symbol: 'ZZK,VCB' }],
      ['mã quá ngắn', { ...hopLe, symbol: 'ZZ' }],
      ['thiếu tên công ty', { ...hopLe, companyName: '' }],
      ['sàn không hợp lệ', { ...hopLe, exchange: 'NASDAQ' }],
      ['thiếu ngành', { ...hopLe, sectorId: '' }],
      ['thiếu phân ngành', { ...hopLe, industryId: '' }],
    ];

    for (const [nhan, du] of ca) {
      const truocMa = await prisma.stock.count();
      const kq = await addStockAction(null, form(du));
      kiem(kq.ok === false, `từ chối: ${nhan}`, kq.message);
      kiem((await prisma.stock.count()) === truocMa, `${nhan} → không ghi gì`);
    }
  }

  console.log('\n3. Phân ngành không thuộc ngành đã chọn → từ chối');
  {
    /*
     * Ô chọn trên trang đã lọc phân ngành theo ngành, nhưng phép lọc đó ở trình
     * duyệt. Ca này mô phỏng một request gửi thẳng: ngành A, phân ngành của ngành B.
     * Để lọt thì `sectorId` và `industryId` của cùng một mã sẽ chỉ về hai ngành khác
     * nhau, và hai biểu đồ đọc hai trường đó sẽ xếp mã này vào hai chỗ.
     */
    const truocMa = await prisma.stock.count();
    const kq = await addStockAction(
      null,
      form({ ...hopLe, sectorId: nganhA.id, industryId: pnB.id }),
    );

    kiem(kq.ok === false, 'bị từ chối');
    kiem(!!kq.fieldErrors?.industryId, 'lỗi gắn vào ô phân ngành');
    kiem(
      kq.fieldErrors?.industryId?.[0]?.includes(nganhB.nameVi) === true,
      'nói rõ phân ngành đó thuộc ngành nào',
      JSON.stringify(kq.fieldErrors),
    );
    kiem((await prisma.stock.count()) === truocMa, 'không ghi gì');
  }

  console.log('\n4. Mã hợp lệ → được thêm, đúng ngành, có nhật ký kiểm toán');
  {
    /*
     * Dòng RUNNING đặt trước để action dừng ngay sau khi ghi mã: phần lấy giá sẽ bị
     * chốt chống chạy chồng chặn, nên không có request nào ra VNStock. Đây cũng là ca
     * đo một hành vi đã chọn có chủ đích — lấy giá hỏng KHÔNG được làm việc thêm mã
     * thất bại theo.
     */
    const chan = await prisma.marketDataSync.create({
      data: {
        kind: SYNC_KIND.QUOTE,
        status: SYNC_STATUS.RUNNING,
        triggeredBy: SYNC_TRIGGER.MANUAL,
        triggeredById: admin.id,
      },
      select: { id: true },
    });

    const truocMa = await prisma.stock.count();
    const kq = await addStockAction(null, form(hopLe));

    kiem(kq.ok === true, 'báo thành công dù lấy giá bị chặn', kq.message);
    kiem((await prisma.stock.count()) === truocMa + 1, 'đúng một mã được thêm');

    const ma = await prisma.stock.findUnique({
      where: { symbol: hopLe.symbol },
      select: {
        symbol: true, companyName: true, exchange: true, status: true,
        sectorId: true, industryId: true, isVn30: true, isVn100: true,
      },
    });
    kiem(ma?.exchange === 'HOSE', 'ghi đúng sàn');
    kiem(ma?.status === 'ACTIVE', 'trạng thái ACTIVE');
    kiem(ma?.sectorId === nganhA.id && ma?.industryId === pnA.id, 'đúng cặp ngành');
    kiem(
      ma?.isVn30 === false && ma?.isVn100 === false,
      'KHÔNG tự đặt cờ rổ chỉ số (nguồn sự thật là seed)',
    );

    const nk = await prisma.auditLog.findFirst({
      where: { entityType: 'STOCK', entityLabel: { contains: hopLe.symbol } },
      orderBy: { occurredAt: 'desc' },
      select: { action: true, afterJson: true, actorUserId: true },
    });
    kiem(nk?.action === 'CREATE', 'có dòng nhật ký kiểm toán CREATE');
    kiem(nk?.actorUserId === admin.id, 'ghi đúng người thêm');
    kiem(
      typeof nk?.afterJson === 'string' && nk.afterJson.includes(pnA.nameVi),
      'nhật ký ghi lại ngành đã khai',
      String(nk?.afterJson),
    );

    // Vẫn chưa có giá: chốt chống chạy chồng đã chặn phần gọi nguồn.
    const gia = await prisma.marketQuote.findFirst({
      where: { stock: { symbol: hopLe.symbol } },
      select: { id: true },
    });
    kiem(gia === null, 'không có giá — đúng như mong đợi khi nguồn bị chặn');
    kiem(
      kq.message?.includes('chưa lấy được giá') === true,
      'thông báo nói rõ là chưa có giá, không im lặng',
      kq.message,
    );

    await prisma.marketDataSync.delete({ where: { id: chan.id } });
  }

  console.log('\n5. Thêm lại mã đã có → từ chối, không tạo bản trùng');
  {
    const truocMa = await prisma.stock.count();
    const kq = await addStockAction(null, form(hopLe));

    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.fieldErrors?.symbol?.[0]?.includes('đã có') === true,
      'nói rõ mã đã tồn tại',
      JSON.stringify(kq.fieldErrors),
    );
    kiem((await prisma.stock.count()) === truocMa, 'không tạo bản trùng');
  }

  console.log('\n6. Mã đã có sẵn trong seed cũng bị chặn (không ghi đè dữ liệu thật)');
  {
    const maThat = await prisma.stock.findFirstOrThrow({
      select: { symbol: true, companyName: true },
      orderBy: { symbol: 'asc' },
    });

    const kq = await addStockAction(
      null,
      form({ ...hopLe, symbol: maThat.symbol, companyName: 'Ten bi ghi de' }),
    );
    kiem(kq.ok === false, `từ chối ${maThat.symbol}`);

    const sau = await prisma.stock.findUnique({
      where: { symbol: maThat.symbol },
      select: { companyName: true },
    });
    kiem(sau?.companyName === maThat.companyName, 'tên công ty cũ KHÔNG bị ghi đè');
  }

  console.log(`\n${dat} dat / ${truot} truot`);
  if (truot > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
