/**
 * BIỂU PHÍ THEO TỪNG IB — con số form hiện phải BẰNG con số server ghi.
 *
 * Phí và thuế nay khai theo IB (`introducing_brokers.buyFeeRateBps` / `sellFeeRateBps`
 * / `sellTaxRateBps`), để trống thì lấy mức chung trong `system_settings`.
 *
 * BA THỨ PHẢI ĐÚNG, và cái thứ ba mới là cái dễ hỏng:
 *
 *   1. Mức của IB được ÁP THẬT khi ghi lệnh, mua và bán khác nhau.
 *   2. Để trống = theo mức chung; đổi mức chung thì IB để trống đổi theo, còn IB đã
 *      khai riêng thì KHÔNG đổi. Không có bước "đổi mức chung" thì phép kiểm chỉ
 *      chứng minh được "đọc ra một con số", chưa chứng minh nó đọc đúng nguồn.
 *   3. 0% KHÁC để trống. Nếu code dùng `||` thay cho `??` thì "IB miễn phí" âm thầm
 *      biến thành "IB theo mức chung" — số tiền sai mà không có gì báo.
 *
 * Và cuối cùng: bảng "Tiền thu về" trên form nhập lệnh phải khớp lệnh đã ghi, vì đó
 * là con số người dùng nhìn để quyết định.
 *
 * Chạy trên BẢN SAO: npm run test:ib-fee-rates
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { createTradeAction } from '@/trading/actions';
import { ratesForAccount, defaultRates } from '@/trading/fee-rates';
import { ROLE, USER_STATUS, TRANSACTION_TYPE } from '@/lib/enums';

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
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
  await createSession(admin.id);

  const stock = await prisma.stock.findFirstOrThrow({
    where: { quote: { isNot: null } },
    select: { id: true, symbol: true, quote: { select: { price: true } } },
  });
  const gia = stock.quote!.price;

  const chienLuoc = await prisma.strategy.findFirstOrThrow({
    where: { isActive: true },
    select: { id: true },
  });

  /*
   * BA IB, khác nhau đúng ở biểu phí — biến duy nhất cần cô lập.
   *   RIENG : khai đủ phí mua / phí bán, thuế để trống
   *   TRONG : để trống hết  → theo mức chung
   *   MIENPHI: phí mua = 0  → phải ra 0 đồng, không phải mức chung
   */
  const ibRieng = await prisma.introducingBroker.create({
    data: { code: 'TEST_RIENG', name: 'IB khai riêng', buyFeeRateBps: 15, sellFeeRateBps: 20 },
  });
  const ibTrong = await prisma.introducingBroker.create({
    data: { code: 'TEST_TRONG', name: 'IB để trống' },
  });
  const ibMienPhi = await prisma.introducingBroker.create({
    data: { code: 'TEST_MIENPHI', name: 'IB miễn phí mua', buyFeeRateBps: 0 },
  });

  const taoTk = async (ibId: string | null, accountNo: string) =>
    prisma.brokerAccount.create({
      data: { userId: admin.id, broker: 'SSI', accountNo, ibId },
      select: { id: true },
    });

  const tkRieng = await taoTk(ibRieng.id, 'FEE0001');
  const tkTrong = await taoTk(ibTrong.id, 'FEE0002');
  const tkMienPhi = await taoTk(ibMienPhi.id, 'FEE0003');
  const tkTrucTiep = await taoTk(null, 'FEE0004');

  // Vốn cho mọi tài khoản, để lệnh mua không bị chặn vì thiếu tiền.
  for (const tk of [tkRieng, tkTrong, tkMienPhi, tkTrucTiep]) {
    await prisma.capitalFlow.create({
      data: {
        portfolioId: portfolio.id,
        brokerAccountId: tk.id,
        flowType: 'CONTRIBUTION',
        status: 'CONFIRMED',
        amount: 10_000_000_000n,
        occurredAt: new Date(),
        createdById: admin.id,
      },
    });
  }

  const KL = 1000;
  const gross = BigInt(KL) * gia;

  async function ghiLenh(tkId: string, loai: string): Promise<{ fees: bigint; tax: bigint }> {
    const f = new FormData();
    f.set('portfolioId', portfolio.id);
    f.set('symbol', stock.symbol);
    f.set('transactionType', loai);
    f.set('quantity', String(KL));
    f.set('price', String(gia));
    f.set('brokerAccountId', tkId);
    f.set('executedAt', new Date().toISOString());
    // Ô `alloc_` nhận PHẦN TRĂM (100 = 100%), không phải bps — xem `readAllocations`.
    f.set(`alloc_${chienLuoc.id}`, '100');
    if (loai === TRANSACTION_TYPE.SELL) f.set(`qty_${chienLuoc.id}`, String(KL));

    const kq = await createTradeAction(null, f);
    if (!kq.ok) throw new Error(`không ghi được lệnh ${loai}: ${JSON.stringify(kq)}`);

    const t = await prisma.trade.findFirstOrThrow({
      where: { brokerAccountId: tkId, transactionType: loai },
      orderBy: { createdAt: 'desc' },
      select: { fees: true, tax: true },
    });
    return t;
  }

  const chung = await defaultRates();
  console.log(
    `\nMức chung: phí ${chung.buyFeeRateBps / 100}% · thuế ${chung.sellTaxRateBps / 100}%\n`,
  );

  // -------------------------------------------------------------------------
  console.log('1. Mức của IB được áp thật, mua và bán khác nhau');
  // -------------------------------------------------------------------------
  const muaRieng = await ghiLenh(tkRieng.id, TRANSACTION_TYPE.BUY);
  const banRieng = await ghiLenh(tkRieng.id, TRANSACTION_TYPE.SELL);

  kiem(muaRieng.fees === (gross * 15n) / 10_000n, 'phí MUA theo mức IB (0,15%)', `${muaRieng.fees}`);
  kiem(banRieng.fees === (gross * 20n) / 10_000n, 'phí BÁN theo mức IB (0,20%)', `${banRieng.fees}`);
  kiem(muaRieng.fees !== banRieng.fees, 'phí mua và phí bán THỰC SỰ khác nhau');
  kiem(muaRieng.tax === 0n, 'lệnh mua không có thuế');
  kiem(
    banRieng.tax === (gross * BigInt(chung.sellTaxRateBps)) / 10_000n,
    'thuế để trống → lấy mức chung',
    `${banRieng.tax}`,
  );

  // -------------------------------------------------------------------------
  console.log('\n2. Để trống = theo mức chung, và ĐỔI THEO khi mức chung đổi');
  // -------------------------------------------------------------------------
  const muaTrong = await ghiLenh(tkTrong.id, TRANSACTION_TYPE.BUY);
  kiem(
    muaTrong.fees === (gross * BigInt(chung.buyFeeRateBps)) / 10_000n,
    'IB để trống dùng mức chung',
    `${muaTrong.fees}`,
  );

  await prisma.systemSetting.update({
    where: { key: 'trading.default_fee_rate_bps' },
    data: { value: '30' },
  });

  const sauDoi = await ratesForAccount(tkTrong.id);
  const rieng = await ratesForAccount(tkRieng.id);
  kiem(sauDoi.buyFeeRateBps === 30, 'đổi mức chung → IB để trống đổi theo', `${sauDoi.buyFeeRateBps}`);
  kiem(rieng.buyFeeRateBps === 15, 'đổi mức chung → IB khai riêng KHÔNG đổi', `${rieng.buyFeeRateBps}`);

  await prisma.systemSetting.update({
    where: { key: 'trading.default_fee_rate_bps' },
    data: { value: String(chung.buyFeeRateBps) },
  });

  // -------------------------------------------------------------------------
  console.log('\n3. 0% KHÁC để trống');
  // -------------------------------------------------------------------------
  const mienPhi = await ratesForAccount(tkMienPhi.id);
  kiem(mienPhi.buyFeeRateBps === 0, 'IB khai 0% thì đúng là 0, không rơi về mức chung');

  const muaMienPhi = await ghiLenh(tkMienPhi.id, TRANSACTION_TYPE.BUY);
  kiem(muaMienPhi.fees === 0n, 'lệnh mua qua IB miễn phí có phí = 0 đồng', `${muaMienPhi.fees}`);

  // -------------------------------------------------------------------------
  console.log('\n4. Tài khoản mở trực tiếp (không IB) dùng mức chung');
  // -------------------------------------------------------------------------
  const trucTiep = await ratesForAccount(tkTrucTiep.id);
  kiem(
    trucTiep.buyFeeRateBps === chung.buyFeeRateBps &&
      trucTiep.sellTaxRateBps === chung.sellTaxRateBps,
    'không IB → toàn bộ mức chung',
  );

  // -------------------------------------------------------------------------
  console.log('\n5. Con số form hiện = con số server ghi');
  // -------------------------------------------------------------------------
  /*
   * Form dựng bảng "Giá trị · Phí · Thuế · Tiền thu về" bằng chính `TradeRates` mà
   * trang cha gửi xuống, và trang cha lấy nó từ `ratesForAccount` — cùng hàm server
   * dùng lúc ghi. Phép kiểm này đo lại chuỗi đó đầu-cuối: nếu ai đó sau này cho form
   * tự tính mức, hai vế sẽ lệch và dòng dưới đây đỏ.
   */
  const rateForm = await ratesForAccount(tkRieng.id);
  const phiFormMua = (gross * BigInt(rateForm.buyFeeRateBps)) / 10_000n;
  const phiFormBan = (gross * BigInt(rateForm.sellFeeRateBps)) / 10_000n;
  kiem(phiFormMua === muaRieng.fees, 'phí MUA form hiện = phí đã ghi', `${phiFormMua} vs ${muaRieng.fees}`);
  kiem(phiFormBan === banRieng.fees, 'phí BÁN form hiện = phí đã ghi', `${phiFormBan} vs ${banRieng.fees}`);

  console.log('\n' + '='.repeat(76));
  console.log(` KẾT QUẢ: ${dat} đạt · ${truot} sai`);
  console.log('='.repeat(76) + '\n');

  await prisma.$disconnect();
  process.exit(truot === 0 ? 0 : 1);
}

void main();
