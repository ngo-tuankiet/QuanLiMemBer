/**
 * KIỂM THỬ `fetchQuoteForSymbolAction` — nút "Lấy giá từ VNStock" theo mã.
 *
 * Như `test-sync-market-data.ts`, bài này chỉ đi những đường TRẢ VỀ SỚM — trước khi
 * tiến trình Python được chạy. Nhờ vậy nó chạy trên BẢN SAO database và không phát
 * một request nào ra VNStock.
 *
 * MỖI PHÉP KIỂM ĐỀU CÓ CẶP ĐỐI CHỨNG. "Bị từ chối" một mình là phép kiểm rỗng: một
 * action hỏng luôn, từ chối tất cả, vẫn qua. Nên mỗi lần từ chối đều kèm hai câu hỏi
 * "có tạo dòng nhật ký đồng bộ nào không" và "có tạo mã mới nào không" — đúng hai
 * hậu quả mà các chốt này sinh ra để ngăn.
 *
 * DẤU PHẨY LÀ PHÉP KIỂM QUAN TRỌNG NHẤT Ở ĐÂY. Mã người dùng gõ được nối vào
 * `--symbols a,b,c` của `sync.py`, nên nếu ô nhập nhận dấu phẩy thì một ô thành
 * nhiều mã. Mục 3 chặn đúng chỗ đó.
 *
 * Dùng: npm run test:fetch-quote-symbol
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { fetchQuoteForSymbolAction } from '@/market/actions';
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

/** FormData một trường — đúng thứ `<ActionForm>` gửi lên. */
function form(symbol: string): FormData {
  const fd = new FormData();
  fd.set('symbol', symbol);
  return fd;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });

  const vaiTro = await prisma.role.findMany({ select: { id: true, code: true } });
  const idVaiTro = (code: string): string => {
    const r = vaiTro.find((x) => x.code === code);
    if (!r) throw new Error(`thieu vai tro ${code}`);
    return r.id;
  };

  const maCoThat = await prisma.stock.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { symbol: true },
    orderBy: { symbol: 'asc' },
  });

  console.log('\n1. Không có quyền `market_data.sync` → ForbiddenError');
  {
    /*
     * Quản lý cấp cao xem được trang Market Data (`market_data.view`) nhưng không
     * được gọi nguồn ngoài. Nếu hai quyền đó bị lẫn, chính vai trò này sẽ dựng được
     * tiến trình Python.
     */
    const nguoi = await prisma.user.create({
      data: {
        email: `khongquyen.fetch-${process.pid}@example.invalid`,
        passwordHash: 'x'.repeat(60),
        fullName: 'Kiem thu khong quyen',
        status: USER_STATUS.ACTIVE,
        roleId: idVaiTro(ROLE.SENIOR_MANAGER),
      },
    });
    await createSession(nguoi.id);

    const truocSo = await prisma.marketDataSync.count();
    let daNem = false;
    try {
      await fetchQuoteForSymbolAction(null, form(maCoThat.symbol));
    } catch (e) {
      daNem = e instanceof Error && e.name === 'ForbiddenError';
    }
    kiem(daNem, 'ném ForbiddenError');
    kiem(
      (await prisma.marketDataSync.count()) === truocSo,
      'không tạo dòng nhật ký nào khi bị chặn',
    );
  }

  await createSession(admin.id);

  console.log('\n2. Bỏ trống mã → báo lỗi ở đúng ô, không chạy gì');
  {
    const truocSo = await prisma.marketDataSync.count();
    const kq = await fetchQuoteForSymbolAction(null, form('   '));

    kiem(kq.ok === false, 'bị từ chối');
    kiem(!!kq.fieldErrors?.symbol, 'lỗi gắn vào ô "symbol", không phải thông báo chung');
    kiem((await prisma.marketDataSync.count()) === truocSo, 'không tạo dòng nhật ký');
  }

  console.log('\n3. Chuỗi có ký tự lạ → chặn TRƯỚC khi tới dòng lệnh');
  {
    /*
     * `MBB,VCB` là ca đáng lo nhất: nó KHÔNG phải mã bịa — cả hai vế đều là mã thật
     * trong master data. Nếu chốt chỉ hỏi "mã có tồn tại không" theo kiểu tách chuỗi
     * thì ca này lọt, và một ô nhập trở thành hai mã gửi cho tiến trình Python.
     * Chốt đúng phải từ chối ngay ở dạng chuỗi.
     */
    const xau = ['MBB,VCB', 'MBB VCB', 'MB-B', 'MB', 'ABCDEFGHIJK', 'MBB;ls'];
    for (const s of xau) {
      const truocSo = await prisma.marketDataSync.count();
      const kq = await fetchQuoteForSymbolAction(null, form(s));
      kiem(kq.ok === false && !!kq.fieldErrors?.symbol, `từ chối "${s}"`, kq.message);
      kiem(
        (await prisma.marketDataSync.count()) === truocSo,
        `"${s}" không tạo dòng nhật ký`,
      );
    }

    /*
     * ĐỐI CHỨNG: một mã hợp lệ phải ĐI QUA được phép kiểm dạng, nếu không thì phép
     * kiểm trên chỉ đang chặn tất cả.
     *
     * Dòng RUNNING đặt trước là bắt buộc: không có nó, mã hợp lệ sẽ đi hết đường và
     * DỰNG TIẾN TRÌNH PYTHON GỌI VNSTOCK THẬT — từ một bài kiểm thử chạy trên bản
     * sao database. Dòng này khiến action dừng ngay sau hai chốt cần đo.
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

    const kqTot = await fetchQuoteForSymbolAction(null, form(maCoThat.symbol));
    kiem(
      !kqTot.fieldErrors?.symbol,
      `mã thật ${maCoThat.symbol} KHÔNG bị phép kiểm dạng chặn`,
      kqTot.message,
    );

    await prisma.marketDataSync.delete({ where: { id: chan.id } });
  }

  console.log('\n4. Mã không có trong master data → từ chối theo §7, không tạo mã mới');
  {
    const maBia = 'ZZQX';
    const daCo = await prisma.stock.findUnique({ where: { symbol: maBia } });
    kiem(daCo === null, `mã ${maBia} chưa tồn tại trước khi thử`);

    const truocSo = await prisma.marketDataSync.count();
    const truocMa = await prisma.stock.count();

    const kq = await fetchQuoteForSymbolAction(null, form(maBia));

    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.fieldErrors?.symbol?.[0]?.includes('danh mục chuẩn') === true,
      'nói rõ lý do: không có trong danh mục chuẩn',
      JSON.stringify(kq.fieldErrors),
    );
    kiem((await prisma.stock.count()) === truocMa, '§7: KHÔNG tự tạo mã mới');
    kiem(
      (await prisma.stock.findUnique({ where: { symbol: maBia } })) === null,
      `${maBia} vẫn không tồn tại`,
    );
    kiem(
      (await prisma.marketDataSync.count()) === truocSo,
      'không gọi nguồn (không có dòng nhật ký nào)',
    );
  }

  console.log('\n5. Đang có lần đồng bộ khác → lấy một mã cũng phải chờ');
  {
    /*
     * Chốt chống chạy chồng phải áp cho CẢ HAI nút. Nếu đường theo mã bỏ qua nó, hai
     * tiến trình Python sẽ cùng gọi nguồn và cùng ghi vào `market_quotes`.
     */
    const dangChay = await prisma.marketDataSync.create({
      data: {
        kind: SYNC_KIND.QUOTE,
        status: SYNC_STATUS.RUNNING,
        triggeredBy: SYNC_TRIGGER.MANUAL,
        triggeredById: admin.id,
      },
      select: { id: true },
    });

    const truocSo = await prisma.marketDataSync.count();
    const kq = await fetchQuoteForSymbolAction(null, form(maCoThat.symbol));

    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.message?.includes('Đang có một lần đồng bộ') === true,
      'nói rõ vì sao',
      kq.message,
    );
    kiem(kq.message?.includes(admin.fullName) === true, 'cho biết ai đang chạy');
    kiem((await prisma.marketDataSync.count()) === truocSo, 'KHÔNG tạo dòng thứ hai');

    const conNguyen = await prisma.marketDataSync.findUnique({
      where: { id: dangChay.id },
      select: { status: true },
    });
    kiem(conNguyen?.status === SYNC_STATUS.RUNNING, 'lần chạy đang diễn ra không bị đụng');

    await prisma.marketDataSync.delete({ where: { id: dangChay.id } });
  }

  console.log('\n6. Chữ thường được chấp nhận, tự viết hoa');
  {
    /*
     * Người dùng gõ "mbb" là chuyện thường. Viết hoa giúp họ, nhưng chỉ đúng nếu làm
     * TRƯỚC phép kiểm dạng — làm sau thì "mbb" trượt phép kiểm `[A-Z0-9]` và bị báo
     * lỗi sai chỗ.
     */
    const dangChay = await prisma.marketDataSync.create({
      data: {
        kind: SYNC_KIND.QUOTE,
        status: SYNC_STATUS.RUNNING,
        triggeredBy: SYNC_TRIGGER.MANUAL,
        triggeredById: admin.id,
      },
      select: { id: true },
    });

    // Dòng RUNNING ở trên khiến action dừng ngay trước khi chạy Python, nên đo được
    // hai chốt đầu mà không gọi nguồn.
    const kq = await fetchQuoteForSymbolAction(null, form(maCoThat.symbol.toLowerCase()));
    kiem(!kq.fieldErrors?.symbol, 'không báo lỗi dạng cho chữ thường', JSON.stringify(kq.fieldErrors));
    kiem(
      kq.message?.includes('Đang có một lần đồng bộ') === true,
      'đi được tới chốt chống chạy chồng (tức là đã qua tra cứu mã)',
      kq.message,
    );

    await prisma.marketDataSync.delete({ where: { id: dangChay.id } });
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
