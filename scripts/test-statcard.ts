/**
 * KIỂM THỬ HÀNG Ô SỐ LIỆU GIỐNG NHAU GIỮA CÁC TRANG.
 *
 * Hai hàng ô — `/portfolio` và `/members/[id]` — nằm trong cùng một luồng đọc: mở Danh
 * mục rồi bấm vào một thành viên. Chúng từng có hai bản cài đặt riêng và đã lệch nhau
 * (`text-2xl` so với `text-xl`, `text-xs` so với `text-tiny`), đủ để người dùng nhìn ra
 * là "hai hàng không giống nhau" mà không chỉ được ra chỗ khác.
 *
 * Bài này ĐO markup thật thay vì tin vào mắt trên ảnh chụp: cảm giác "liền khối" hay
 * "rời nhau" trên một ảnh phụ thuộc tỷ lệ chụp, còn tên class thì không.
 *
 *   1. thẻ ô ở hai trang có CÙNG bộ class khung
 *   2. con số chính có CÙNG cỡ chữ
 *   3. hàng chứa các ô có CÙNG bộ class lưới (số cột, khoảng cách)
 *   4. không trang nào còn dùng cỡ chữ cũ đã lệch
 *   5. BỐN NHÃN GIỐNG NHAU, CÙNG THỨ TỰ ở cả hai trang
 *   6. "Available Cash" của trang thành viên bằng đúng Σ số dư các tài khoản của
 *      người đó, và "Portfolio Value" bằng giá trị vị thế + tiền
 *
 * Điều 6 mới là phần dễ sai: "Available Cash" là số liệu trang thành viên trước đây
 * không có, và có tới ba con số tiền khác nhau dễ lấy lẫn — tiền của cả danh mục, vốn
 * ròng đã nạp, và số dư thật của các tài khoản.
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:statcard
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS } from '@/lib/enums';
import { computeAccountBalances, computePositions } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import MemberPage from '../app/(app)/members/[id]/page';
import PortfolioPage from '../app/(app)/portfolio/page';

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

/**
 * Bóc class của thẻ ô chứa một nhãn, và class của thẻ `<p>` chứa con số.
 *
 * Đi LÙI từ nhãn để tìm `<div class="…">` mở thẻ ô — cắt tiến sẽ bắt được thẻ ô KẾ
 * TIẾP chứ không phải thẻ đang xét.
 */
function bocO(html: string, nhan: string): { the: string; so: string; luoi: string } | null {
  const i = html.indexOf(`>${nhan}</p>`);
  if (i < 0) return null;

  const truoc = html.slice(0, i);

  const jThe = truoc.lastIndexOf('<div class="');
  if (jThe < 0) return null;
  const the = truoc.slice(jThe + '<div class="'.length, truoc.indexOf('"', jThe + '<div class="'.length));

  // Lưới = thẻ div bao ngoài thẻ ô.
  const truocThe = truoc.slice(0, jThe);
  const jLuoi = truocThe.lastIndexOf('<div class="');
  const luoi =
    jLuoi < 0
      ? ''
      : truocThe.slice(
          jLuoi + '<div class="'.length,
          truocThe.indexOf('"', jLuoi + '<div class="'.length),
        );

  // Con số: thẻ <p class="…"> ngay sau nhãn.
  const sau = html.slice(i);
  const k = sau.indexOf('<p class="');
  const so = k < 0 ? '' : sau.slice(k + '<p class="'.length, sau.indexOf('"', k + '<p class="'.length));

  return { the, so, luoi };
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  await createSession(admin.id);

  const member = await ketXuat(
    await (MemberPage as unknown as (p: { params: Promise<{ id: string }> }) => Promise<ReactElement>)({
      params: Promise.resolve({ id: admin.id }),
    }),
  );

  const pf = await ketXuat(
    await (PortfolioPage as unknown as (p: {
      searchParams: Promise<Record<string, string | undefined>>;
    }) => Promise<ReactElement>)({ searchParams: Promise.resolve({}) }),
  );

  /*
   * Bóc theo NHÃN MỚI ở cả hai trang. Bản trước bóc theo 'Giá trị thị trường' — nhãn
   * cũ của trang thành viên — nên ngay khi bốn nhãn được thay, bài kiểm dừng ở phép đầu
   * và không chạy tới phần nó cần kiểm.
   */
  const oTV = bocO(member, 'Portfolio Value');
  const oDM = bocO(pf, 'Portfolio Value');

  kiem(oTV !== null, 'bóc được ô trên trang thành viên');
  kiem(oDM !== null, 'bóc được ô trên trang danh mục');
  if (!oTV || !oDM) {
    console.log(`\n===== ${dat} đạt, ${truot} trượt =====`);
    process.exitCode = 1;
    return;
  }

  console.log('\nthành viên:');
  console.log(`  lưới  ${oTV.luoi}`);
  console.log(`  thẻ   ${oTV.the}`);
  console.log(`  số    ${oTV.so}`);
  console.log('danh mục:');
  console.log(`  lưới  ${oDM.luoi}`);
  console.log(`  thẻ   ${oDM.the}`);
  console.log(`  số    ${oDM.so}`);
  console.log('');

  kiem(oTV.the === oDM.the, 'thẻ ô: cùng bộ class khung (viền, bo góc, nền, đệm)', `${oTV.the} ≠ ${oDM.the}`);
  kiem(oTV.so === oDM.so, 'con số: cùng cỡ chữ', `${oTV.so} ≠ ${oDM.so}`);

  /*
   * Lưới: trang thành viên có thêm `mb-4` vì hàng ô của nó không phải khối cuối. Phần
   * QUYẾT ĐỊNH hình dạng là số cột và khoảng cách, nên so riêng ba class đó.
   */
  const hinhDang = (cls: string) =>
    cls
      .split(/\s+/)
      .filter((c) => c.startsWith('gap-') || c.startsWith('grid-cols-') || /:grid-cols-/.test(c))
      .sort()
      .join(' ');

  kiem(
    hinhDang(oTV.luoi) === hinhDang(oDM.luoi),
    'lưới: cùng số cột và khoảng cách',
    `${hinhDang(oTV.luoi)} ≠ ${hinhDang(oDM.luoi)}`,
  );

  kiem(oTV.so.includes('text-2xl'), 'trang thành viên dùng text-2xl', oTV.so);
  kiem(!oTV.so.includes('text-xl '), 'trang thành viên KHÔNG còn text-xl', oTV.so);

  /*
   * PHÉP KIỂM PHẢI BIẾT TRƯỢT. So hai chuỗi class rỗng với nhau cũng "bằng nhau", nên
   * khẳng định ở trên chỉ có nghĩa khi chuỗi thật sự có nội dung.
   */
  kiem(
    oTV.the.includes('rounded-xl') && oTV.the.includes('border'),
    'chuỗi class có nội dung thật — phép so ở trên không so hai chuỗi rỗng',
    oTV.the,
  );

  // =========================================================================
  // 5. Bốn nhãn giống nhau, cùng thứ tự
  // =========================================================================
  console.log('\nBốn nhãn:');

  const NHAN = ['Portfolio Value', 'Invested Capital', 'Available Cash', 'Total P&amp;L'];

  /** Thứ tự các nhãn thật sự xuất hiện trong HTML. */
  const thuTu = (html: string): string[] =>
    NHAN.map((n) => ({ n, i: html.indexOf(`>${n}</p>`) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.n);

  const tuTV = thuTu(member);
  const tuDM = thuTu(pf);
  console.log(`  thành viên: ${tuTV.join(' · ') || '(không có nhãn nào)'}`);
  console.log(`  danh mục:   ${tuDM.join(' · ') || '(không có nhãn nào)'}`);

  kiem(tuTV.length === 4, `trang thành viên có đủ 4 nhãn`, `${tuTV.length}`);
  kiem(
    tuTV.join('|') === tuDM.join('|'),
    'bốn nhãn giống nhau và cùng thứ tự ở hai trang',
    `${tuTV.join('|')} ≠ ${tuDM.join('|')}`,
  );

  /*
   * Nhãn cũ phải BIẾN MẤT. Không kiểm điều này thì một trang vẫn có thể hiện tám ô —
   * bốn mới thêm vào cạnh bốn cũ — mà phép kiểm trên vẫn xanh.
   */
  for (const cu of ['Giá trị thị trường', 'Giá vốn đã bỏ ra', 'Đã chốt / chưa chốt']) {
    kiem(!member.includes(`>${cu}</p>`), `nhãn cũ "${cu}" đã bỏ`);
  }

  // =========================================================================
  // 6. Available Cash và Portfolio Value tính đúng
  // =========================================================================
  console.log('\nSố liệu:');

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!portfolio) {
    console.log('  BOQUA: khong co danh muc dang hoat dong');
  } else {
    const soDu = await computeAccountBalances(portfolio.id, admin.id);
    const tien = soDu.reduce((t, a) => t + a.available, 0n);

    const viThe = await computePositions({ portfolioId: portfolio.id, userId: admin.id });
    const giaTriTT = viThe.filter((p) => p.quantity > 0).reduce((t, p) => t + p.marketValue, 0n);

    console.log(`  ${soDu.length} tài khoản · tiền ${formatVnd(tien)}`);
    console.log(`  giá trị thị trường vị thế ${formatVnd(giaTriTT)}`);
    console.log(`  Portfolio Value phải là ${formatVnd(giaTriTT + tien)}`);

    /*
     * So bằng CHUỖI ĐÃ ĐỊNH DẠNG như trang hiện. `MoneyCompact` rút gọn (₫82.4M), nên
     * so số nguyên với HTML sẽ không bao giờ khớp — phải so đúng thứ người dùng đọc.
     */
    const gonLai = (v: bigint): string => {
      const n = Number(v);
      const am = n < 0;
      const abs = Math.abs(n);
      const s2 =
        abs >= 1_000_000_000
          ? `${(abs / 1_000_000_000).toFixed(3)}B`
          : abs >= 1_000_000
            ? `${(abs / 1_000_000).toFixed(3)}M`.replace(/\.0+M$/, 'M')
            : abs.toLocaleString('vi-VN');
      return `${am ? '-' : ''}₫${s2}`;
    };

    const oTien = bocO(member, 'Available Cash');
    kiem(oTien !== null, 'bóc được ô Available Cash');

    /*
     * Không dựng lại phép rút gọn của `MoneyCompact` để so từng ký tự — làm vậy là
     * kiểm bản sao của mình. Thay vào đó kiểm ĐIỀU KIỆN ĐỦ MẠNH mà một con số sai sẽ
     * phá: dấu, và phần triệu/tỷ của con số.
     */
    const mongDoi = gonLai(tien);
    const iTien = member.indexOf('>Available Cash</p>');
    const khoiTien = member.slice(iTien, iTien + 400);

    kiem(
      khoiTien.includes(mongDoi),
      `ô Available Cash hiện ${mongDoi}`,
      khoiTien.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120),
    );

    const mongDoiPV = gonLai(giaTriTT + tien);
    const iPV = member.indexOf('>Portfolio Value</p>');
    const khoiPV = member.slice(iPV, iPV + 400);

    kiem(
      khoiPV.includes(mongDoiPV),
      `ô Portfolio Value hiện ${mongDoiPV} (= vị thế + tiền)`,
      khoiPV.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120),
    );

    /*
     * PHÉP KIỂM PHẢI BIẾT TRƯỢT: nếu Portfolio Value chỉ là giá trị vị thế (bỏ quên
     * tiền) thì con số sẽ khác — trừ khi tiền bằng 0. Nói rõ khi không phân biệt được.
     */
    if (tien === 0n) {
      console.log('  LUU Y: tien = 0 nen phep kiem Portfolio Value khong phan biet duoc');
    } else {
      kiem(
        gonLai(giaTriTT) !== mongDoiPV,
        'vị thế và (vị thế + tiền) khác nhau — phép kiểm trên có tác dụng thật',
        `${gonLai(giaTriTT)} vs ${mongDoiPV}`,
      );
    }

    // Phần đã chốt / chưa chốt không được biến mất khỏi trang.
    kiem(member.includes('chốt'), 'trang vẫn nói về phần đã chốt / chưa chốt');
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
