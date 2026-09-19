/**
 * HAI Ô KPI PHẢI TỰ GIẢI THÍCH ĐƯỢC CON SỐ CỦA MÌNH.
 *
 * Người dùng báo hai ô "không chạy đúng". Đo ra thì CON SỐ đều đúng:
 *
 *   Available Cash 120M = 600M tiền − 480M quỹ dự phòng đang giữ.
 *   Alpha "—"           = chưa có vị thế nào để dựng chuỗi theo phiên.
 *
 * Cái sai là LỜI GIẢI THÍCH. Thẻ tiền không nói ra khoản đang bị giữ, nên người có
 * 600 triệu trong tài khoản thấy 120 triệu và kết luận hệ thống tính sai. Thẻ Alpha
 * thì in "thiếu dữ liệu giá theo phiên" trong khi chỉ số VNINDEX có đủ 264 phiên —
 * câu đó chỉ người đọc đi sửa đúng thứ không hỏng.
 *
 * BÀI KIỂM PHẢI PHÂN BIỆT ĐƯỢC CÁC TRƯỜNG HỢP, không chỉ xác nhận trường hợp đang
 * gặp. Một phép kiểm chỉ chạy trên trạng thái hiện tại sẽ vẫn xanh nếu ai đó hard-code
 * lại đúng câu chữ đó cho mọi trường hợp — tức là đúng lỗi vừa sửa.
 *
 * Chạy trên BẢN SAO: npm run test:kpi-explains
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS, TRANSACTION_TYPE } from '@/lib/enums';
import DashboardPage from '../app/(app)/dashboard/page';

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

function ketXuat(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const phan: Buffer[] = [];
    let xong = false;
    const { pipe } = renderToPipeableStream(el, {
      onAllReady() {
        pipe({
          write(c: unknown) {
            phan.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
            return true;
          },
          end() {
            if (!xong) {
              xong = true;
              resolve(Buffer.concat(phan).toString('utf8'));
            }
          },
          on() {}, once() {}, emit() {}, removeListener() {},
        } as never);
      },
      onError(e: unknown) {
        if (!xong) {
          xong = true;
          reject(e);
        }
      },
    });
  });
}

type TrangCoQuery = (p: {
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<ReactElement>;

async function xemDashboard(): Promise<string> {
  const el = await (DashboardPage as unknown as TrangCoQuery)({
    searchParams: Promise.resolve({}),
  });
  return ketXuat(el);
}

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
  await createSession(admin.id);

  const tk = await prisma.brokerAccount.create({
    data: { userId: admin.id, broker: 'SSI', accountNo: 'KPI00001' },
    select: { id: true },
  });
  await prisma.capitalFlow.create({
    data: {
      portfolioId: portfolio.id,
      brokerAccountId: tk.id,
      flowType: 'CONTRIBUTION',
      status: 'CONFIRMED',
      amount: 600_000_000n,
      occurredAt: new Date(),
      createdById: admin.id,
    },
  });

  // =========================================================================
  console.log('\nA — Ô tiền nói ra khoản quỹ dự phòng đang giữ');
  // =========================================================================
  await prisma.portfolio.update({
    where: { id: portfolio.id },
    data: { reserveAmount: 480_000_000n },
  });
  const coQuy = await xemDashboard();
  /* Chỉ khớp DÒNG PHỤ của thẻ. Chữ "quỹ dự phòng" còn nằm trong chú thích ⓘ luôn
     hiện, nên so cả trang sẽ đúng kể cả khi dòng phụ không nói gì. */
  const DONG_PHU = /giữ [^<]*quỹ dự phòng/;
  kiem(DONG_PHU.test(coQuy), 'có quỹ dự phòng → dòng phụ nói ra');
  kiem(/giữ [^<]*480[^<]*quỹ dự phòng/.test(coQuy), 'nói đúng số tiền đang giữ');

  /*
   * VẾ ĐỐI CHỨNG. Không có bước này thì phép kiểm trên vẫn xanh kể cả khi ai đó gắn
   * cứng chữ "quỹ dự phòng" vào mọi thẻ.
   */
  await prisma.portfolio.update({
    where: { id: portfolio.id },
    data: { reserveAmount: 0n },
  });
  const khongQuy = await xemDashboard();
  kiem(!DONG_PHU.test(khongQuy), 'quỹ = 0 → dòng phụ KHÔNG thêm chữ thừa');

  // =========================================================================
  console.log('\nB — Ô Alpha nói đúng thứ đang thiếu');
  // =========================================================================

  // B1. Chưa có vị thế nào — dữ liệu chỉ số vẫn đầy đủ.
  /*
   * DỰNG TRẠNG THÁI, KHÔNG GIẢ ĐỊNH NÓ.
   *
   * Bản sao mang theo dữ liệu thật, và ở đó danh mục ĐANG giữ ACB — nên "chưa có vị
   * thế nào" là một trạng thái bài kiểm phải tự tạo ra. Bản đầu bỏ qua bước này và
   * trượt ngay khi người dùng nhập lệnh đầu tiên: phép kiểm đang mô tả một tình
   * huống nó chưa hề dựng.
   *
   * Huỷ lệnh thay vì xoá: `computePositions` chỉ đếm lệnh EXECUTED, và huỷ thì khôi
   * phục lại được nguyên trạng cho các phần sau.
   */
  const lenhCu = await prisma.trade.findMany({
    where: { status: 'EXECUTED' },
    select: { id: true },
  });
  await prisma.trade.updateMany({
    where: { id: { in: lenhCu.map((x) => x.id) } },
    data: { status: 'CANCELLED' },
  });

  const soChiSo = await prisma.marketIndexHistory.count();
  const chuaCoViThe = await xemDashboard();
  kiem(
    chuaCoViThe.includes('chưa có vị thế nào'),
    `chưa có vị thế → nói đúng lý do (chỉ số vẫn có ${soChiSo} phiên)`,
  );
  kiem(
    !chuaCoViThe.includes('thiếu dữ liệu giá theo phiên'),
    'KHÔNG còn đổ lỗi cho dữ liệu giá',
  );

  // Khôi phục lại các lệnh vừa huỷ để hai phần sau chạy trên dữ liệu đầy đủ.
  await prisma.trade.updateMany({
    where: { id: { in: lenhCu.map((x) => x.id) } },
    data: { status: 'EXECUTED' },
  });

  // B2. Có vị thế nhưng KHÔNG có chuỗi chỉ số.
  const maCoLichSu = await prisma.priceHistory.findFirstOrThrow({
    select: { stockId: true, closePrice: true },
    orderBy: { tradingDate: 'desc' },
  });
  await prisma.trade.create({
    data: {
      code: 'KPITEST0001',
      portfolioId: portfolio.id,
      stockId: maCoLichSu.stockId,
      brokerAccountId: tk.id,
      userId: admin.id,
      createdById: admin.id,
      transactionType: TRANSACTION_TYPE.BUY,
      status: 'EXECUTED',
      quantity: 1000,
      price: maCoLichSu.closePrice,
      fees: 0n,
      tax: 0n,
      executedAt: new Date('2026-01-05'),
    },
  });

  await prisma.marketIndexHistory.deleteMany({});
  const thieuChiSo = await xemDashboard();
  kiem(
    thieuChiSo.includes('thiếu chuỗi'),
    'có vị thế nhưng mất chuỗi chỉ số → nói đúng lý do',
  );
  kiem(
    !thieuChiSo.includes('chưa có vị thế nào'),
    'KHÔNG còn báo nhầm là chưa có vị thế',
  );

  // B3. CÓ vị thế nhưng lịch sử giá không có phiên nào từ ngày mua.
  /*
   * Đây là trạng thái ĐANG GẶP trên dữ liệu thật: danh mục có 4.000 ACB, ACB có 174
   * phiên lịch sử, nhưng phiên cuối là 25/08 còn lệnh mua ghi 09/09. Bản đầu của
   * khối lý do gộp trạng thái này vào "chưa có vị thế nào" — sai, và chỉ người đọc
   * đi tìm nhầm chỗ.
   */
  const phienCuoi = await prisma.priceHistory.aggregate({
    where: { stockId: maCoLichSu.stockId },
    _max: { tradingDate: true },
  });
  const sauPhienCuoi = new Date(phienCuoi._max.tradingDate!);
  sauPhienCuoi.setDate(sauPhienCuoi.getDate() + 30);

  await prisma.trade.updateMany({
    where: { code: 'KPITEST0001' },
    data: { executedAt: sauPhienCuoi },
  });

  const muaSauPhienCuoi = await xemDashboard();
  kiem(
    muaSauPhienCuoi.includes('thiếu lịch sử giá từ ngày mua'),
    'có vị thế nhưng mua sau phiên giá cuối → nói đúng lý do',
  );
  kiem(
    !muaSauPhienCuoi.includes('chưa có vị thế nào'),
    'KHÔNG báo nhầm là chưa có vị thế trong khi đang giữ 1.000 CP',
  );

  console.log('\n' + '='.repeat(76));
  console.log(` KẾT QUẢ: ${dat} đạt · ${truot} sai`);
  console.log('='.repeat(76) + '\n');

  await prisma.$disconnect();
  process.exit(truot === 0 ? 0 : 1);
}

void main();
