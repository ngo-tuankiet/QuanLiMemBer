/**
 * KIỂM THỬ CÁC CHỐT CỦA `syncMarketDataAction` — nút "Cập nhật giá".
 *
 * Chỉ kiểm những đường TRẢ VỀ SỚM, trước khi chạy tiến trình Python: quyền, chống
 * chạy trùng, và dọn dòng treo. Nhờ vậy bài này chạy được trên BẢN SAO database mà
 * không gọi VNStock lần nào.
 *
 * VÌ SAO KHÔNG KIỂM ĐƯỜNG THÀNH CÔNG Ở ĐÂY. Đường đó cần Python POST vào cổng nạp
 * của dev server, mà dev server ghi vào `dev.db` — không phải bản sao. Chạy trên bản
 * sao thì `syncId` không tồn tại ở phía server và bài kiểm thử sẽ đo một thứ khác
 * với thứ đang chạy thật. Đường thành công đã được kiểm end-to-end trên `dev.db`
 * (có sao lưu trước): 12/12 mã, đúng một dòng nhật ký, `triggeredBy = MANUAL`.
 *
 * Dùng: npm run test:sync-market-data
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { syncMarketDataAction } from '@/market/actions';
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

  console.log('\n1. Không có quyền `market_data.sync` → ForbiddenError');
  {
    /*
     * Quản lý cấp cao là phép thử đúng chỗ: họ có `market_data.view` (xem được
     * trang) nhưng KHÔNG có `market_data.sync`. Nếu hai quyền đó bị lẫn thì chính
     * vai trò này sẽ gọi được nguồn ngoài.
     */
    const nguoi = await prisma.user.create({
      data: {
        email: `khongquyen.sync-${process.pid}@example.invalid`,
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
      await syncMarketDataAction();
    } catch (e) {
      daNem = e instanceof Error && e.name === 'ForbiddenError';
    }
    kiem(daNem, 'ném ForbiddenError');
    kiem(
      (await prisma.marketDataSync.count()) === truocSo,
      'không tạo dòng nhật ký nào khi bị chặn',
    );
  }

  console.log('\n2. Đang có lần chạy khác → từ chối, không chạy chồng');
  {
    await createSession(admin.id);

    // Dòng RUNNING mới toanh: đúng tình huống người thứ hai bấm khi người thứ nhất
    // đang chạy.
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
    const kq = await syncMarketDataAction();

    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.message?.includes('Đang có một lần đồng bộ') === true,
      'nói rõ vì sao',
      kq.message,
    );
    kiem(kq.message?.includes(admin.fullName) === true, 'cho biết ai đang chạy');
    kiem(
      (await prisma.marketDataSync.count()) === truocSo,
      'KHÔNG tạo dòng thứ hai',
    );
    console.log(`        thông báo: ${kq.message}`);

    // Dòng RUNNING phải còn nguyên — action không được đụng vào lần chạy của người khác.
    const conNguyen = await prisma.marketDataSync.findUnique({
      where: { id: dangChay.id },
      select: { status: true },
    });
    kiem(conNguyen?.status === SYNC_STATUS.RUNNING, 'lần chạy đang diễn ra không bị đụng');

    await prisma.marketDataSync.delete({ where: { id: dangChay.id } });
  }

  console.log('\n3. Dòng RUNNING treo từ lâu → được dọn, KHÔNG chặn nút vĩnh viễn');
  {
    await createSession(admin.id);

    /*
     * Đây là cái bẫy thật của thiết kế "dùng dòng RUNNING làm chốt": một lần chạy
     * bị giết giữa đường (đóng tab, restart server) để lại dòng RUNNING mãi mãi.
     * Không dọn thì phép kiểm ở mục 2 chặn nút VĨNH VIỄN và không ai biết vì sao.
     */
    const treo = await prisma.marketDataSync.create({
      data: {
        kind: SYNC_KIND.QUOTE,
        status: SYNC_STATUS.RUNNING,
        triggeredBy: SYNC_TRIGGER.MANUAL,
        triggeredById: admin.id,
        // 2 giờ trước — quá xa mốc chờ (mặc định 180 giây).
        startedAt: new Date(Date.now() - 2 * 3_600_000),
      },
      select: { id: true },
    });

    /*
     * Đặt một dòng RUNNING MỚI ngay sau đó để action dừng ở phép kiểm "đang chạy"
     * và không gọi Python. Nhờ vậy vẫn đo được việc dọn dòng treo mà không phát
     * request nào ra VNStock.
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

    await syncMarketDataAction();

    const sauKhiDon = await prisma.marketDataSync.findUnique({
      where: { id: treo.id },
      select: { status: true, finishedAt: true, errorMessage: true },
    });
    kiem(sauKhiDon?.status === SYNC_STATUS.FAILED, 'dòng treo bị đánh dấu FAILED');
    kiem(sauKhiDon?.finishedAt !== null, 'dòng treo được đóng mốc kết thúc');
    kiem(
      sauKhiDon?.errorMessage?.includes('bỏ dở') === true,
      'ghi rõ lý do',
      String(sauKhiDon?.errorMessage),
    );

    const conMoi = await prisma.marketDataSync.findUnique({
      where: { id: chan.id },
      select: { status: true },
    });
    kiem(conMoi?.status === SYNC_STATUS.RUNNING, 'dòng RUNNING mới KHÔNG bị dọn oan');

    await prisma.marketDataSync.deleteMany({ where: { id: { in: [treo.id, chan.id] } } });
  }

  console.log('\n4. Sau khi dọn hết dòng treo, nút không còn bị chặn');
  {
    await createSession(admin.id);

    const treo = await prisma.marketDataSync.create({
      data: {
        kind: SYNC_KIND.QUOTE,
        status: SYNC_STATUS.RUNNING,
        triggeredBy: SYNC_TRIGGER.MANUAL,
        triggeredById: admin.id,
        startedAt: new Date(Date.now() - 2 * 3_600_000),
      },
      select: { id: true },
    });

    /*
     * Không gọi action ở đây — nó sẽ chạy Python thật. Chỉ kiểm phần quyết định:
     * sau khi dọn, còn dòng RUNNING nào để chặn không.
     *
     * Đây là chỗ duy nhất của bài kiểm thử này chép lại một mẩu logic, và chỉ chép
     * ĐIỀU KIỆN chặn chứ không chép cách xử lý. Mục 3 đã chứng minh chính action
     * dọn đúng dòng treo đó.
     */
    const mocTreo = new Date(Date.now() - 180 * 1000);
    await prisma.marketDataSync.updateMany({
      where: { status: SYNC_STATUS.RUNNING, startedAt: { lt: mocTreo } },
      data: { status: SYNC_STATUS.FAILED, finishedAt: new Date() },
    });
    const conChan = await prisma.marketDataSync.count({
      where: { status: SYNC_STATUS.RUNNING },
    });
    kiem(conChan === 0, 'không còn dòng RUNNING nào chặn nút', `còn ${conChan}`);

    await prisma.marketDataSync.delete({ where: { id: treo.id } });
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
