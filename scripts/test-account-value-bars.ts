/**
 * GIÁ TRỊ VỊ THẾ + TIỀN MẶT THEO TỪNG TÀI KHOẢN.
 *
 * `computeAccountBalances` nay trả thêm `positionValue`, `heldSymbols`,
 * `symbolsMissingPrice` để thẻ tài khoản vẽ được thanh "vị thế | tiền mặt" cho mỗi
 * tài khoản.
 *
 * PHÉP KIỂM ĐỐI CHIẾU HAI ĐƯỜNG ĐỘC LẬP. Phép cộng mới nằm gọn trong vòng lặp của
 * `computeAccountBalances`; đối chứng là `computeStrategyHoldings(portfolio, user,
 * accountId)` — hàm đã có, đi từ dữ liệu thô theo đường khác. Tự đối chiếu với chính
 * mình thì chỉ chứng minh được "hàm chạy hai lần ra cùng kết quả".
 *
 * BỐN TÌNH HUỐNG phải phân biệt được, và mỗi cái từng là một lỗi thật ở đâu đó:
 *
 *   1. Cổ phiếu nằm ở ĐÚNG tài khoản mua nó, không rơi sang tài khoản khác.
 *   2. Mã đã bán hết KHÔNG còn trong danh sách (khối lượng 0, không phải "giữ 0 cổ").
 *   3. Mã THIẾU GIÁ đóng góp 0 đồng và được NÓI RA, không âm thầm làm thanh ngắn đi.
 *   4. Tiền mặt của tài khoản = `available`, không phải vốn đã nạp.
 *
 * Chạy trên BẢN SAO: npm run test:account-value-bars
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { computeAccountBalances, computeStrategyHoldings } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import { ROLE, USER_STATUS, TRANSACTION_TYPE } from '@/lib/enums';
import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';
import ProfilePage from '../app/(app)/profile/page';

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

/*
 * Kết xuất theo LUỒNG: trang Profile có ranh giới Suspense, bản đồng bộ ném
 * "A component suspended while responding to synchronous input" thay vì trả HTML.
 */
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

  // Hai mã CÓ giá, một mã KHÔNG có giá — tình huống 3.
  const coGia = await prisma.stock.findMany({
    where: { quote: { isNot: null } },
    take: 2,
    select: { id: true, symbol: true, quote: { select: { price: true } } },
  });
  const khongGia = await prisma.stock.findFirstOrThrow({
    where: { quote: { is: null } },
    select: { id: true, symbol: true },
  });
  if (coGia.length < 2) throw new Error('cần ít nhất 2 mã có giá trong bản sao');

  const [maA, maB] = coGia as [(typeof coGia)[number], (typeof coGia)[number]];

  const taoTk = async (accountNo: string) =>
    prisma.brokerAccount.create({
      data: { userId: admin.id, broker: 'SSI', accountNo },
      select: { id: true },
    });

  const tk1 = await taoTk('BAR00001');
  const tk2 = await taoTk('BAR00002');

  for (const tk of [tk1, tk2]) {
    await prisma.capitalFlow.create({
      data: {
        portfolioId: portfolio.id,
        brokerAccountId: tk.id,
        flowType: 'CONTRIBUTION',
        status: 'CONFIRMED',
        amount: 5_000_000_000n,
        occurredAt: new Date(),
        createdById: admin.id,
      },
    });
  }

  let seq = 0;
  const ghi = async (
    tkId: string,
    stockId: string,
    loai: string,
    qty: number,
    gia: bigint,
  ): Promise<void> => {
    seq += 1;
    await prisma.trade.create({
      data: {
        code: `BARTEST${String(seq).padStart(4, '0')}`,
        portfolioId: portfolio.id,
        stockId,
        brokerAccountId: tkId,
        userId: admin.id,
        createdById: admin.id,
        transactionType: loai,
        status: 'EXECUTED',
        quantity: qty,
        price: gia,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(),
      },
    });
  };

  const giaA = maA.quote!.price;
  const giaB = maB.quote!.price;

  // Tài khoản 1: giữ A, và mua rồi bán hết B (tình huống 2).
  await ghi(tk1.id, maA.id, TRANSACTION_TYPE.BUY, 1000, giaA);
  await ghi(tk1.id, maB.id, TRANSACTION_TYPE.BUY, 500, giaB);
  await ghi(tk1.id, maB.id, TRANSACTION_TYPE.SELL, 500, giaB);

  // Tài khoản 2: giữ B, và giữ một mã CHƯA CÓ GIÁ.
  await ghi(tk2.id, maB.id, TRANSACTION_TYPE.BUY, 700, giaB);
  await ghi(tk2.id, khongGia.id, TRANSACTION_TYPE.BUY, 300, 20_000n);

  const balances = await computeAccountBalances(portfolio.id, admin.id);
  const b1 = balances.find((b) => b.accountId === tk1.id)!;
  const b2 = balances.find((b) => b.accountId === tk2.id)!;

  console.log('');
  for (const [ten, b] of [
    ['TK1', b1],
    ['TK2', b2],
  ] as const) {
    console.log(
      `  ${ten}  vị thế ${formatVnd(b.positionValue).padStart(16)} · tiền ${formatVnd(b.available).padStart(16)}` +
        `  giữ [${b.heldSymbols.join(', ')}]` +
        (b.symbolsMissingPrice.length ? ` · thiếu giá [${b.symbolsMissingPrice.join(', ')}]` : ''),
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n1. Khớp với computeStrategyHoldings — hai đường độc lập');
  // -------------------------------------------------------------------------
  for (const [ten, b] of [
    ['TK1', b1],
    ['TK2', b2],
  ] as const) {
    const kho = await computeStrategyHoldings(portfolio.id, admin.id, b.accountId);
    const doiChung = kho.reduce((s, h) => s + BigInt(h.quantity) * h.quotePrice, 0n);
    kiem(
      b.positionValue === doiChung,
      `${ten}: giá trị vị thế khớp đối chứng`,
      `${b.positionValue} vs ${doiChung}`,
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n2. Cổ phiếu nằm ở đúng tài khoản mua nó');
  // -------------------------------------------------------------------------
  kiem(b1.heldSymbols.includes(maA.symbol), `TK1 giữ ${maA.symbol}`);
  kiem(!b2.heldSymbols.includes(maA.symbol), `TK2 KHÔNG giữ ${maA.symbol}`, b2.heldSymbols.join(','));
  kiem(b2.heldSymbols.includes(maB.symbol), `TK2 giữ ${maB.symbol}`);
  kiem(b1.positionValue === BigInt(1000) * giaA, 'TK1 chỉ tính phần đang giữ', `${b1.positionValue}`);

  // -------------------------------------------------------------------------
  console.log('\n3. Mã đã bán hết không còn trong danh sách');
  // -------------------------------------------------------------------------
  kiem(
    !b1.heldSymbols.includes(maB.symbol),
    `TK1 mua rồi bán hết ${maB.symbol} → không còn trong danh sách`,
    b1.heldSymbols.join(','),
  );

  // -------------------------------------------------------------------------
  console.log('\n4. Mã thiếu giá: đóng góp 0 và được NÓI RA');
  // -------------------------------------------------------------------------
  kiem(
    b2.symbolsMissingPrice.includes(khongGia.symbol),
    `${khongGia.symbol} bị đánh dấu thiếu giá`,
    b2.symbolsMissingPrice.join(','),
  );
  kiem(
    b2.positionValue === BigInt(700) * giaB,
    'mã thiếu giá đóng góp 0 đồng, không bịa giá',
    `${b2.positionValue}`,
  );
  kiem(b2.heldSymbols.includes(khongGia.symbol), 'nhưng vẫn nằm trong danh sách mã đang giữ');

  // -------------------------------------------------------------------------
  console.log('\n5. Tiền mặt là số dư còn lại, không phải vốn đã nạp');
  // -------------------------------------------------------------------------
  const daTieuTk1 = BigInt(1000) * giaA; // mua B rồi bán lại B ở đúng giá → hoà
  kiem(
    b1.available === 5_000_000_000n - daTieuTk1,
    'TK1: tiền mặt = vốn nạp − đã mua + đã bán',
    `${b1.available}`,
  );
  kiem(b1.available !== b1.granted, 'tiền mặt KHÁC vốn ròng đã nạp', `${b1.available} vs ${b1.granted}`);

  // -------------------------------------------------------------------------
  console.log('\n6. Biểu đồ THẬT SỰ được vẽ ra trên trang');
  // -------------------------------------------------------------------------
  /*
   * Năm phần trên chứng minh CON SỐ đúng. Phần này chứng minh nó ĐẾN ĐƯỢC MẮT
   * người dùng — một hàm trả về số đúng mà trang không gọi tới thì người dùng vẫn
   * không thấy gì, và đó đúng là thứ họ đang thiếu.
   */
  const html = await ketXuat(
    await (ProfilePage as unknown as () => Promise<ReactElement>)(),
  );

  kiem(html.includes('Giá trị từng tài khoản'), 'khối biểu đồ có mặt trên trang');
  kiem(html.includes('giá trị vị thế') && html.includes('tiền mặt'), 'có chú giải hai đoạn');
  kiem(
    html.includes('BAR00001') && html.includes('BAR00002'),
    'cả hai tài khoản đều có thanh',
  );
  kiem(
    html.includes(`${khongGia.symbol}`) && html.includes(`chưa có giá`),
    'cảnh báo mã thiếu giá hiện ra, không im lặng',
  );

  console.log('\n' + '='.repeat(76));
  console.log(` KẾT QUẢ: ${dat} đạt · ${truot} sai`);
  console.log('='.repeat(76) + '\n');

  await prisma.$disconnect();
  process.exit(truot === 0 ? 0 : 1);
}

void main();
