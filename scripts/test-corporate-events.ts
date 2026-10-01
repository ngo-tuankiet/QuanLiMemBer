/**
 * KIỂM THỬ SỰ KIỆN QUYỀN — quét cổ tức, danh sách chờ, ghi nhận, ghi hộ, bỏ qua.
 *
 * Mỗi mục dưới đây canh một cách tính sai MÀ KHÔNG AI THẤY: kết quả vẫn là một con số
 * hợp lý, chỉ là sai. Nên phần lớn phép kiểm đi kèm một ĐỐI CHỨNG chứng minh phép kiểm
 * có khả năng đỏ.
 *
 *   1. Phân loại — "phát hành cho CBCNV" không được thành cổ phiếu thưởng.
 *   2. Cổng nạp — lưu đúng, không trùng khi quét lại, không tạo mã lạ (§7).
 *   3. Độ tươi của giá — lần quét cổ tức không được làm giá trông như vừa lấy.
 *   4. Danh sách chờ — ai được hưởng, bao nhiêu, từ khi nào.
 *   5. Ghi nhận — bản ghi và dấu "đã xong" đi cùng một transaction.
 *   6. Phạm vi — ai thấy, ai ghi hộ được.
 *
 * KHÔNG GỌI RA MẠNG. Sự kiện được dựng tay rồi đưa qua ĐÚNG cổng nạp mà Python dùng.
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:corporate-events
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import {
  phanLoaiSuKien,
  soCoPhieuNhan,
  tyLeSangE9,
} from '@/dividends/classify';
import { computePendingCorporateEvents } from '@/dividends/pending';
import { ghiDuoc, phamViCoTuc, type NguoiXem } from '@/dividends/scope';
import {
  dismissCorporateEventAction,
  undoDismissCorporateEventAction,
} from '@/dividends/actions';
import { recordDividendAction } from '@/trading/dividend-actions';
import { getMarketDataStatus } from '@/domain/portfolio-engine';
import { PORTFOLIO_STATUS, ROLE, SYNC_KIND, USER_STATUS } from '@/lib/enums';
import { GET, POST } from '../app/api/market-data/ingest/route';

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

const P = process.pid;
const TOKEN = `tok-${P}`;
process.env.MARKET_DATA_INGEST_TOKEN = TOKEN;

function form(v: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
}

async function napSuKien(events: unknown[], scannedSymbols: string[]) {
  const res = await POST(
    new NextRequest('http://localhost/api/market-data/ingest', {
      method: 'POST',
      headers: { 'x-market-data-token': TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'VNSTOCK',
        provider: 'vci',
        tradingDate: '2026-09-30',
        events,
        scannedSymbols,
        failedSymbols: [],
      }),
    }),
  );
  return (await res.json()) as { ok: boolean; status: string; updated: number; unknownSymbols: string[] };
}

async function main(): Promise<void> {
  // =========================================================================
  console.log('\n1. Phân loại sự kiện của VCI');
  // =========================================================================
  {
    const ca: [string, Parameters<typeof phanLoaiSuKien>[0], string | null][] = [
      ['DIV → tiền mặt', { event_code: 'DIV' }, 'CASH_DIVIDEND'],
      ['Stock dividend', { event_code: 'ISS', event_title_en: 'Share Issue - Stock dividend ratio 26.0%' }, 'STOCK_DIVIDEND'],
      ['Bonus Issue', { event_code: 'ISS', event_title_en: 'Share Issue - Bonus Issue ratio 10.0%' }, 'BONUS_SHARES'],
      ['Rights issue', { event_code: 'ISS', event_title_en: 'Share Issue - Rights issue ratio 10.0%' }, 'RIGHTS_ISSUE'],
      ['chỉ có tiếng Việt: cổ tức cổ phiếu', { event_code: 'ISS', event_title_vi: 'Phát hành cổ phiếu - Trả Cổ tức bằng Cổ phiếu tỉ lệ 30.0%' }, 'STOCK_DIVIDEND'],
      ['chỉ có tiếng Việt: quyền mua', { event_code: 'ISS', event_title_vi: 'Phát hành cổ phiếu - Quyền mua CP cho Cổ đông hiện hữu tỉ lệ 25%' }, 'RIGHTS_ISSUE'],
      ['ESOP (tiếng Việt) → bỏ', { event_code: 'ISS', event_title_vi: 'Phát hành cổ phiếu - Phát hành cho CBCNV tỉ lệ 0.5%' }, null],
      ['riêng lẻ → bỏ', { event_code: 'ISS', event_title_vi: 'Phát hành cổ phiếu - Phát hành riêng lẻ tỉ lệ 3.8%' }, null],
      /*
       * BẪY THỨ TỰ: chứa cả "bonus" lẫn "employee". Kiểm "bonus" trước thì thành cổ
       * phiếu thưởng cho CỔ ĐÔNG — một khoản cổ phiếu không có thật.
       */
      ['"bonus for employees" → bỏ, không phải cổ phiếu thưởng', { event_code: 'ISS', event_title_en: 'Share Issue - Bonus shares for employees 1%' }, null],
      ['ISS lạ → bỏ, không đoán', { event_code: 'ISS', event_title_en: 'Share Issue - Something new' }, null],
      ['mã khác (AIS niêm yết bổ sung) → bỏ', { event_code: 'AIS', event_title_en: 'Additional Listing' }, null],
    ];
    for (const [nhan, e, mong] of ca) {
      const kq = phanLoaiSuKien(e);
      kiem(kq === mong, nhan, String(kq));
    }

    kiem(tyLeSangE9(0.2604104) === 260_410_400n, 'tỷ lệ 0,2604104 → 260.410.400 (không lệch vì dấu phẩy động)', String(tyLeSangE9(0.2604104)));
    kiem(tyLeSangE9(0.1) === 100_000_000n, 'tỷ lệ 0,1 → 100.000.000');
    kiem(tyLeSangE9(0) === null && tyLeSangE9(null) === null, 'tỷ lệ 0 hoặc trống → null');
    kiem(soCoPhieuNhan(2750, 260_410_400n) === 716, 'VPB: 2.750 × 26,04% = 716 CP (làm tròn xuống)', String(soCoPhieuNhan(2750, 260_410_400n)));
    kiem(soCoPhieuNhan(1, 260_410_400n) === 0, '1 CP × 26% = 0 CP');
    kiem(soCoPhieuNhan(3632, 100_000_000n) === 363, 'FPT: 3.632 × 10% = 363 CP');
  }

  // -------------------------------------------------------------------------
  // Dữ liệu dựng riêng
  // -------------------------------------------------------------------------
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });
  const vaiTro = async (code: string) =>
    (await prisma.role.findFirstOrThrow({ where: { code }, select: { id: true } })).id;
  const phong = await prisma.department.findFirstOrThrow({ select: { id: true } });
  const taoNhom = (ma: string) =>
    prisma.team.create({
      data: { code: `${ma}_${P}`, name: ma, nameVi: ma, departmentId: phong.id },
      select: { id: true },
    });
  const nhomA = await taoNhom('CE_A');
  const nhomB = await taoNhom('CE_B');

  let soNguoi = 0;
  const taoNguoi = async (role: string, teamId: string | null) => {
    soNguoi += 1;
    return prisma.user.create({
      data: {
        email: `ce-${P}-${soNguoi}@example.com`,
        passwordHash: 'x',
        fullName: `Nguoi CE ${soNguoi}`,
        status: USER_STATUS.ACTIVE,
        roleId: await vaiTro(role),
        teamId,
      },
      select: { id: true, fullName: true },
    });
  };

  const an = await taoNguoi(ROLE.EXECUTION, nhomA.id); // chủ tài khoản chính
  const binh = await taoNguoi(ROLE.EXECUTION, nhomA.id); // cùng nhóm với An
  const chi = await taoNguoi(ROLE.EXECUTION, nhomB.id); // nhóm khác
  const quanLyA = await taoNguoi(ROLE.TEAM_MANAGER, nhomA.id);
  const capCao = await taoNguoi(ROLE.SENIOR_MANAGER, null);

  const chienLuoc = await prisma.strategy.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });

  // Hai mã chưa có lệnh nào — để dữ liệu thật không trộn vào.
  const [ma1, ma2] = await prisma.stock.findMany({
    where: { status: 'ACTIVE', trades: { none: {} } },
    take: 2,
    select: { id: true, symbol: true },
  });
  if (!ma1 || !ma2) throw new Error('can 2 ma chua co lenh');

  /** Tài khoản với NGÀY VÀO HỆ THỐNG đặt tay. */
  const taoTk = (userId: string, so: string, vao: string) =>
    prisma.brokerAccount.create({
      data: { userId, broker: 'SSI', accountNo: `CE${P}${so}`, isActive: true, createdAt: new Date(`${vao}T09:00:00+07:00`) },
      select: { id: true },
    });

  let stt = 0;
  /** Lệnh với NGÀY GIỜ VIỆT NAM đặt tay. */
  const lenh = (accountId: string, userId: string, stockId: string, loai: 'BUY' | 'SELL', kl: number, luc: string) => {
    stt += 1;
    return prisma.trade.create({
      data: {
        code: `CE${P}${stt}`,
        portfolioId: portfolio.id,
        stockId,
        brokerAccountId: accountId,
        userId,
        createdById: userId,
        transactionType: loai,
        status: 'EXECUTED',
        quantity: kl,
        price: 10_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(luc),
        strategies: { create: [{ strategyId: chienLuoc.id, allocationBps: 10_000, allocationAmount: 0n }] },
      },
      select: { id: true },
    });
  };

  const tkAn = await taoTk(an.id, '1', '2026-09-01');
  const tkBinh = await taoTk(binh.id, '2', '2026-09-01');
  const tkChi = await taoTk(chi.id, '3', '2026-09-01');
  // Vào hệ thống SAU các ngày GDKHQ bên dưới.
  const tkMuon = await taoTk(an.id, '4', '2026-09-28');

  await lenh(tkAn.id, an.id, ma1.id, 'BUY', 1000, '2026-09-10T10:00:00+07:00');
  await lenh(tkAn.id, an.id, ma1.id, 'SELL', 200, '2026-09-15T10:00:00+07:00');
  // Mua ĐÚNG ngày GDKHQ 21/09, khai giờ 00:00 — lưu thành 20/09 17:00 UTC.
  await lenh(tkAn.id, an.id, ma1.id, 'BUY', 500, '2026-09-21T00:00:00+07:00');
  await lenh(tkBinh.id, binh.id, ma1.id, 'BUY', 1, '2026-09-10T10:00:00+07:00');
  await lenh(tkChi.id, chi.id, ma1.id, 'BUY', 300, '2026-09-10T10:00:00+07:00');
  await lenh(tkMuon.id, an.id, ma1.id, 'BUY', 1000, '2026-08-01T10:00:00+07:00');
  await lenh(tkAn.id, an.id, ma2.id, 'BUY', 400, '2026-09-10T10:00:00+07:00');

  const id = (x: string) => `ce-${P}-${x}`;

  // =========================================================================
  console.log('\n2. Cổng nạp: lưu đúng, quét lại không trùng, không tạo mã lạ');
  // =========================================================================
  const suKien = [
    // Thưởng 10%, GDKHQ 21/09.
    { id: id('thuong'), ticker: ma1.symbol, event_code: 'ISS', event_title_en: 'Share Issue - Bonus Issue ratio 10.0%', event_title_vi: `${ma1.symbol} thưởng 10%`, exright_date: '2026-09-21', record_date: '2026-09-22', exercise_ratio: 0.1 },
    // Tiền mặt 1.000đ, đã trả.
    { id: id('tien'), ticker: ma1.symbol, event_code: 'DIV', event_title_vi: `${ma1.symbol} tiền 1.000`, exright_date: '2026-09-21', payout_date: '2026-09-25T00:00:00', value_per_share: 1000, exercise_ratio: 0.1 },
    // Tiền mặt, ngày trả CÒN Ở TƯƠNG LAI.
    { id: id('tien-sau'), ticker: ma2.symbol, event_code: 'DIV', event_title_vi: `${ma2.symbol} tiền 500`, exright_date: '2026-09-22', payout_date: '2026-12-01', value_per_share: 500 },
    // Quyền mua 20%.
    { id: id('quyen'), ticker: ma2.symbol, event_code: 'ISS', event_title_en: 'Share Issue - Rights issue ratio 20.0%', exright_date: '2026-09-23', exercise_ratio: 0.2 },
    // GDKHQ ở TƯƠNG LAI — chưa được hiện.
    { id: id('tuong-lai'), ticker: ma1.symbol, event_code: 'DIV', event_title_vi: 'tương lai', exright_date: '2026-12-15', value_per_share: 700 },
    // Phải bị bỏ:
    { id: id('esop'), ticker: ma1.symbol, event_code: 'ISS', event_title_vi: 'Phát hành cho CBCNV tỉ lệ 1%', exright_date: '2026-09-21', exercise_ratio: 0.01 },
    { id: id('thieu-tien'), ticker: ma1.symbol, event_code: 'DIV', event_title_vi: 'không có số tiền', exright_date: '2026-09-21', value_per_share: null },
    { id: id('ma-la'), ticker: 'ZZZQ', event_code: 'DIV', event_title_vi: 'mã lạ', exright_date: '2026-09-21', value_per_share: 100 },
  ];

  {
    const kq = await napSuKien(suKien, [ma1.symbol, ma2.symbol]);
    const luu = await prisma.corporateEvent.findMany({
      where: { sourceId: { startsWith: `ce-${P}-` } },
      select: { sourceId: true, kind: true, cashPerShare: true, ratioE9: true, payoutDate: true },
    });
    const co = (x: string) => luu.find((e) => e.sourceId === id(x));

    kiem(kq.ok && kq.updated === 5, 'lưu đúng 5 sự kiện hợp lệ', JSON.stringify(kq));
    kiem(co('thuong')?.kind === 'BONUS_SHARES' && co('thuong')?.ratioE9 === 100_000_000n, 'thưởng: đúng loại và tỷ lệ');
    kiem(co('tien')?.cashPerShare === 1000n && co('tien')?.ratioE9 === null, 'tiền mặt: có số tiền, KHÔNG lưu tỷ lệ');
    kiem(co('tien')?.payoutDate?.toISOString() === '2026-09-25T00:00:00.000Z', 'ngày trả dạng "2026-09-25T00:00:00" → đúng ngày');
    kiem(!co('esop'), 'phát hành cho CBCNV KHÔNG được lưu');
    kiem(!co('thieu-tien'), 'cổ tức tiền mặt thiếu số tiền KHÔNG được lưu');
    kiem(kq.unknownSymbols.includes('ZZZQ'), 'mã lạ bị báo, không được tạo (§7)');
    kiem((await prisma.stock.count({ where: { symbol: 'ZZZQ' } })) === 0, 'bảng stocks không có ZZZQ');

    const nhatKy = await prisma.marketDataSync.findFirst({ orderBy: { startedAt: 'desc' }, select: { kind: true, symbolsRequested: true } });
    kiem(nhatKy?.kind === SYNC_KIND.EVENTS, 'nhật ký đồng bộ mang loại EVENTS', String(nhatKy?.kind));
    kiem(nhatKy?.symbolsRequested === 2, 'đếm theo MÃ đã quét (2), không theo sự kiện', String(nhatKy?.symbolsRequested));

    // Quét lại — nguồn sửa số tiền.
    const sua = suKien.map((e) => (e.id === id('tien') ? { ...e, value_per_share: 1200 } : e));
    await napSuKien(sua, [ma1.symbol, ma2.symbol]);
    const sau = await prisma.corporateEvent.count({ where: { sourceId: { startsWith: `ce-${P}-` } } });
    kiem(sau === 5, 'quét lại không tạo bản trùng', String(sau));
    const tien = await prisma.corporateEvent.findUniqueOrThrow({ where: { sourceId: id('tien') } });
    kiem(tien.cashPerShare === 1200n, 'quét lại CẬP NHẬT khi nguồn sửa số liệu', String(tien.cashPerShare));
    // Trả lại 1.000 cho các mục sau.
    await napSuKien(suKien, [ma1.symbol, ma2.symbol]);
  }

  // =========================================================================
  console.log('\n3. Lần quét cổ tức KHÔNG làm giá trông như vừa lấy');
  // =========================================================================
  {
    /*
     * So với LẦN LẤY GIÁ THẬT MỚI NHẤT trong bản sao, không với một dòng tự dựng: bản
     * đầu của bài này dựng một lần lấy giá "5 giờ trước" và đỏ, vì bản sao có sẵn một
     * lần lấy giá thật mới hơn thế — đúng là số service phải thấy.
     *
     * CHỈ LƯỢT `QUOTE` (giá hiện tại). Lượt nạp chỉ số / lịch sử giá cũng không làm mới
     * giá đang khớp — bản sao có sẵn một lượt INDEX lúc 23:00 ngày 30/09, mới hơn lượt
     * QUOTE 19:57, nên phép kiểm dưới cũng chặn luôn trường hợp đó.
     */
    const giaMoiNhat = await prisma.marketDataSync.findFirst({
      where: { status: 'SUCCESS', kind: SYNC_KIND.QUOTE },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });
    const cu =
      giaMoiNhat?.finishedAt ??
      (
        await prisma.marketDataSync.create({
          data: {
            kind: SYNC_KIND.QUOTE,
            status: 'SUCCESS',
            startedAt: new Date(Date.now() - 5 * 3_600_000),
            finishedAt: new Date(Date.now() - 5 * 3_600_000),
            triggeredBy: 'CRON',
          },
          select: { finishedAt: true },
        })
      ).finishedAt!;

    const lucQuet = new Date(Date.now() + 60_000);
    await prisma.marketDataSync.create({
      data: { kind: SYNC_KIND.EVENTS, status: 'SUCCESS', startedAt: lucQuet, finishedAt: lucQuet, triggeredBy: 'CRON' },
    });
    // Đối chứng: dòng quét PHẢI mới hơn lần lấy giá, không thì hai phép kiểm dưới xanh rỗng.
    kiem(lucQuet > cu, 'đối chứng: lần quét sự kiện mới hơn lần lấy giá gần nhất');

    const res = await GET(
      new NextRequest('http://localhost/api/market-data/ingest', { headers: { 'x-market-data-token': TOKEN } }),
    );
    const body = (await res.json()) as { lastSuccessAt: string; eventsDue: boolean; eventSymbols: string[] };
    kiem(body.lastSuccessAt === cu.toISOString(), 'service thấy mốc của lần lấy GIÁ, không phải lần quét sự kiện', body.lastSuccessAt);
    kiem(body.eventsDue === false, 'vừa quét xong → chưa đến hạn quét lại');
    kiem(body.eventSymbols.includes(ma1.symbol), 'danh sách quét gồm mã từng có lệnh');

    const st = await getMarketDataStatus();
    kiem(
      st.lastSuccessAt?.getTime() === cu.getTime(),
      'ô trạng thái Market Data cũng đọc lần lấy GIÁ',
      String(st.lastSuccessAt?.toISOString()),
    );
  }

  const mucCua = async (u: NguoiXem | { id: string }, accountId?: string) => {
    const nguoi = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { id: true, teamId: true, role: { select: { code: true } } },
    });
    const quyen = await prisma.rolePermission.findMany({
      where: { role: { code: nguoi.role?.code ?? '' } },
      select: { permission: { select: { code: true } } },
    });
    const xem: NguoiXem = {
      id: nguoi.id,
      roleCode: nguoi.role?.code ?? null,
      teamId: nguoi.teamId,
      permissions: new Set(quyen.map((q) => q.permission.code)),
    };
    const ds = await computePendingCorporateEvents(phamViCoTuc(xem), accountId ? { onlyAccountId: accountId } : {});
    return { xem, ds: ds.filter((m) => m.titleVi && [ma1.id, ma2.id].includes(m.stockId)) };
  };
  const tim = (ds: Awaited<ReturnType<typeof mucCua>>['ds'], acc: string, x: string) =>
    ds.find((m) => m.accountId === acc && m.eventId === evId.get(x));

  const evId = new Map(
    (await prisma.corporateEvent.findMany({ where: { sourceId: { startsWith: `ce-${P}-` } }, select: { id: true, sourceId: true } }))
      .map((e) => [e.sourceId.replace(`ce-${P}-`, ''), e.id]),
  );

  // =========================================================================
  console.log('\n4. Danh sách chờ: ai được hưởng, bao nhiêu');
  // =========================================================================
  {
    const { ds } = await mucCua(an, tkAn.id);
    const thuong = tim(ds, tkAn.id, 'thuong');
    /*
     * 1.000 mua 10/09 − 200 bán 15/09 = 800. Lệnh 500 khai "21/09 00:00" KHÔNG được
     * tính: đó là ngày GDKHQ. So thời điểm thay vì so ngày Việt Nam thì lệnh này lọt
     * vào (20/09 17:00 UTC < 21/09 00:00 UTC) và ra 1.300.
     */
    kiem(thuong?.eligibleQuantity === 800, 'KL hưởng = 1.000 − 200 = 800; lệnh mua ĐÚNG ngày GDKHQ không tính', String(thuong?.eligibleQuantity));
    kiem(thuong?.expectedShares === 80, 'thưởng 10% → 80 CP', String(thuong?.expectedShares));
    kiem(tim(ds, tkAn.id, 'tien')?.expectedCash === 800_000n, 'tiền mặt 800 × 1.000 = 800.000 ₫', String(tim(ds, tkAn.id, 'tien')?.expectedCash));
    kiem(tim(ds, tkAn.id, 'tien')?.choTienVe === false, 'đã qua ngày trả → ghi được ngay');
    kiem(tim(ds, tkAn.id, 'tien-sau')?.choTienVe === true, 'ngày trả ở tương lai → đánh dấu chờ tiền về');
    kiem(tim(ds, tkAn.id, 'quyen')?.expectedShares === 80, 'quyền mua 20% × 400 = 80 CP được quyền mua', String(tim(ds, tkAn.id, 'quyen')?.expectedShares));
    kiem(!tim(ds, tkAn.id, 'tuong-lai'), 'chưa tới ngày GDKHQ → chưa hiện');

    const binhDs = (await mucCua(binh, tkBinh.id)).ds;
    kiem(!tim(binhDs, tkBinh.id, 'thuong'), 'giữ 1 CP × 10% = 0 CP → không hiện');
    kiem(!!tim(binhDs, tkBinh.id, 'tien'), 'nhưng cổ tức tiền mặt 1 CP vẫn hiện (1.000 ₫)');

    /*
     * Tài khoản vào hệ thống 28/09, SAU ngày GDKHQ 21/09: số lượng khai đã gồm đợt
     * thưởng → không được gợi ý, nếu không cổ phiếu bị cộng hai lần.
     */
    const muon = (await mucCua(an, tkMuon.id)).ds;
    kiem(muon.length === 0, 'tài khoản vào hệ thống SAU ngày GDKHQ → không có mục nào', String(muon.length));
  }

  // =========================================================================
  console.log('\n5. Phạm vi: ai thấy, ai ghi hộ được');
  // =========================================================================
  {
    const sl = async (u: { id: string }) => new Set((await mucCua(u)).ds.map((m) => m.accountId));
    const anThay = await sl(an);
    const qlThay = await sl(quanLyA);
    const ccThay = await sl(capCao);

    kiem(anThay.has(tkAn.id) && !anThay.has(tkBinh.id), 'cá nhân chỉ thấy tài khoản của mình');
    kiem(qlThay.has(tkAn.id) && qlThay.has(tkBinh.id) && !qlThay.has(tkChi.id), 'quản lý nhóm A thấy nhóm A, không thấy nhóm B');
    kiem(ccThay.has(tkAn.id) && ccThay.has(tkChi.id), 'quản lý cấp cao thấy mọi nhóm');

    const x = async (u: { id: string }) => (await mucCua(u)).xem;
    const chuAn = { id: an.id, teamId: nhomA.id };
    kiem(ghiDuoc(await x(an), chuAn), 'chính chủ ghi được');
    kiem(!ghiDuoc(await x(binh), chuAn), 'thành viên cùng nhóm KHÔNG ghi hộ được');
    kiem(ghiDuoc(await x(quanLyA), chuAn), 'quản lý nhóm ghi hộ được thành viên nhóm mình');
    kiem(!ghiDuoc(await x(quanLyA), { id: chi.id, teamId: nhomB.id }), 'quản lý nhóm A KHÔNG ghi hộ nhóm B');
    const cc = await x(capCao);
    kiem(!cc.permissions.has('transaction.create'), 'đối chứng: quản lý cấp cao KHÔNG có transaction.create');
    kiem(ghiDuoc(cc, chuAn), 'nhưng vẫn ghi hộ được — đúng quyết định của người dùng');
  }

  // =========================================================================
  console.log('\n6. Ghi nhận qua form, và ghi hộ');
  // =========================================================================
  {
    // Quản lý nhóm ghi hộ An đợt tiền mặt.
    await createSession(quanLyA.id);
    const truocFlow = await prisma.capitalFlow.count();
    const kq = await recordDividendAction(
      null,
      form({
        portfolioId: portfolio.id,
        brokerAccountId: tkAn.id,
        stockId: ma1.id,
        occurredAt: '2026-09-25',
        eligibleQuantity: '800',
        cashPerShare: '1000',
        corporateEventId: evId.get('tien')!,
      }),
    );
    kiem(kq.ok, 'quản lý ghi hộ thành công', JSON.stringify(kq));
    kiem(kq.message?.includes('ghi hộ') ?? false, 'thông báo nói rõ là ghi hộ');

    const d = await prisma.corporateEventResolution.findUnique({
      where: { eventId_brokerAccountId: { eventId: evId.get('tien')!, brokerAccountId: tkAn.id } },
      select: { status: true, resolvedById: true, capitalFlowId: true },
    });
    kiem(d?.status === 'RECORDED' && !!d.capitalFlowId, 'mục được đánh dấu RECORDED, trỏ vào dòng tiền vừa tạo');
    kiem(d?.resolvedById === quanLyA.id, 'ghi nhận người bấm là quản lý');
    kiem((await prisma.capitalFlow.count()) === truocFlow + 1, 'đúng MỘT dòng tiền mới');
    kiem(!tim((await mucCua(an)).ds, tkAn.id, 'tien'), 'mục biến khỏi danh sách của An');

    // Bấm lại lần nữa — không được ghi trùng.
    const lai = await recordDividendAction(
      null,
      form({
        portfolioId: portfolio.id,
        brokerAccountId: tkAn.id,
        stockId: ma1.id,
        occurredAt: '2026-09-25',
        eligibleQuantity: '800',
        cashPerShare: '1000',
        corporateEventId: evId.get('tien')!,
      }),
    );
    kiem(!lai.ok, 'ghi lại cùng mục → từ chối', JSON.stringify(lai));
    kiem((await prisma.capitalFlow.count()) === truocFlow + 1, 'vẫn đúng một dòng tiền — không ghi trùng');

    // Ghi hộ cổ phiếu thưởng: lệnh phải mang tên CHỦ tài khoản.
    const kq2 = await recordDividendAction(
      null,
      form({
        portfolioId: portfolio.id,
        brokerAccountId: tkAn.id,
        stockId: ma1.id,
        occurredAt: '2026-09-21',
        eligibleQuantity: '800',
        shareQuantity: '80',
        corporateEventId: evId.get('thuong')!,
      }),
    );
    kiem(kq2.ok, 'ghi hộ cổ phiếu thưởng thành công', JSON.stringify(kq2));
    const lenhThuong = await prisma.trade.findFirst({
      where: { brokerAccountId: tkAn.id, isStockDividend: true },
      select: { userId: true, createdById: true, teamId: true, quantity: true },
    });
    kiem(lenhThuong?.userId === an.id, 'lệnh cổ phiếu thưởng thuộc về AN (chủ tài khoản), không phải quản lý');
    kiem(lenhThuong?.createdById === quanLyA.id, 'người tạo là quản lý');
    kiem(lenhThuong?.teamId === nhomA.id, 'nhóm là nhóm của An');

    // Quản lý nhóm A ghi hộ nhóm B → chặn.
    const sai = await recordDividendAction(
      null,
      form({
        portfolioId: portfolio.id,
        brokerAccountId: tkChi.id,
        stockId: ma1.id,
        occurredAt: '2026-09-25',
        eligibleQuantity: '300',
        cashPerShare: '1000',
        corporateEventId: evId.get('tien')!,
      }),
    );
    kiem(!sai.ok && (sai.message ?? '').includes('phạm vi'), 'quản lý nhóm A ghi hộ nhóm B → bị chặn', JSON.stringify(sai));

    // Tiền chưa về → chặn.
    await createSession(an.id);
    const som = await recordDividendAction(
      null,
      form({
        portfolioId: portfolio.id,
        brokerAccountId: tkAn.id,
        stockId: ma2.id,
        occurredAt: '2026-09-30',
        eligibleQuantity: '400',
        cashPerShare: '500',
        corporateEventId: evId.get('tien-sau')!,
      }),
    );
    kiem(!som.ok && (som.message ?? '').includes('01/12/2026'), 'tiền chưa về → chưa ghi được, nói rõ ngày về', JSON.stringify(som));

    // Quyền mua qua form cổ tức → chặn.
    const quyen = await recordDividendAction(
      null,
      form({
        portfolioId: portfolio.id,
        brokerAccountId: tkAn.id,
        stockId: ma2.id,
        occurredAt: '2026-09-30',
        eligibleQuantity: '400',
        shareQuantity: '80',
        corporateEventId: evId.get('quyen')!,
      }),
    );
    kiem(!quyen.ok, 'quyền mua không ghi được qua form cổ tức — phải nộp tiền', JSON.stringify(quyen));
  }

  // =========================================================================
  console.log('\n7. Xoá bản ghi cổ tức → mục quay lại danh sách');
  // =========================================================================
  {
    const d = await prisma.corporateEventResolution.findUniqueOrThrow({
      where: { eventId_brokerAccountId: { eventId: evId.get('tien')!, brokerAccountId: tkAn.id } },
      select: { capitalFlowId: true },
    });
    await prisma.capitalFlow.delete({ where: { id: d.capitalFlowId! } });
    const conDau = await prisma.corporateEventResolution.count({
      where: { eventId: evId.get('tien')!, brokerAccountId: tkAn.id },
    });
    kiem(conDau === 0, 'dấu "đã ghi" bị xoá theo (cascade)');
    kiem(!!tim((await mucCua(an)).ds, tkAn.id, 'tien'), 'mục hiện lại trong danh sách chờ');
  }

  // =========================================================================
  console.log('\n8. Bỏ qua và hoàn tác');
  // =========================================================================
  {
    await createSession(an.id);
    const khongLyDo = await dismissCorporateEventAction(
      null,
      form({ eventId: evId.get('quyen')!, accountId: tkAn.id, reason: '' }),
    );
    kiem(!khongLyDo.ok, 'bỏ qua mà không có lý do → từ chối');

    const bq = await dismissCorporateEventAction(
      null,
      form({ eventId: evId.get('quyen')!, accountId: tkAn.id, reason: 'Không thực hiện quyền mua' }),
    );
    kiem(bq.ok, 'bỏ qua có lý do → được', JSON.stringify(bq));
    kiem(!tim((await mucCua(an)).ds, tkAn.id, 'quyen'), 'mục biến khỏi danh sách');

    await createSession(binh.id);
    const r = await prisma.corporateEventResolution.findUniqueOrThrow({
      where: { eventId_brokerAccountId: { eventId: evId.get('quyen')!, brokerAccountId: tkAn.id } },
      select: { id: true },
    });
    const binhHoanTac = await undoDismissCorporateEventAction(null, form({ resolutionId: r.id }));
    kiem(!binhHoanTac.ok, 'thành viên khác KHÔNG hoàn tác được mục của An');

    await createSession(an.id);
    const ht = await undoDismissCorporateEventAction(null, form({ resolutionId: r.id }));
    kiem(ht.ok, 'chính chủ hoàn tác được', JSON.stringify(ht));
    kiem(!!tim((await mucCua(an)).ds, tkAn.id, 'quyen'), 'mục quay lại danh sách');

    // Mục đã GHI thì không hoàn tác ở đây.
    const daGhi = await prisma.corporateEventResolution.findUniqueOrThrow({
      where: { eventId_brokerAccountId: { eventId: evId.get('thuong')!, brokerAccountId: tkAn.id } },
      select: { id: true },
    });
    const khongDuoc = await undoDismissCorporateEventAction(null, form({ resolutionId: daGhi.id }));
    kiem(!khongDuoc.ok, 'mục ĐÃ GHI không hoàn tác bằng nút này');
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
