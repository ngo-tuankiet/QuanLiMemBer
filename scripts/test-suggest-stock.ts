/**
 * KIỂM THỬ GỢI Ý THÔNG TIN MÃ TỪ VNSTOCK.
 *
 * Hai thứ được canh, và thứ nhất quan trọng hơn hẳn:
 *
 *   1. BẢNG QUY ĐỔI ICB → MASTER DATA (`src/market/icb.ts`) có khớp với master data
 *      thật hay không. Bảng đó viết bằng mã ngành dạng chữ (`INDUSTRIALS`,
 *      `AVIATION`); một mã viết sai, hoặc một phân ngành bị xếp sang ngành khác, sẽ
 *      tạo ra gợi ý mà `addStockAction` từ chối ngay khi gửi — người dùng bấm "dùng"
 *      rồi bấm "Thêm" và nhận một câu báo lỗi về cặp ngành không thuộc nhau.
 *
 *   2. CÁC CHỐT CỦA `suggestStockInfoAction`: quyền, dạng mã, mã đã có sẵn.
 *
 * KHÔNG CA NÀO GỌI RA MẠNG. Mọi ca đều dừng trước lúc chạy Python — hoặc bị chốt từ
 * chối, hoặc chỉ gọi hàm quy đổi thuần. Một bài kiểm phụ thuộc VNStock sẽ đỏ vào
 * đúng hôm nguồn sập, và rồi không ai tin nó nữa.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:suggest-stock
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { suggestStockInfoAction } from '@/market/actions';
import {
  ICB_SANG_MASTER,
  quyDoiIcb,
  quyDoiSan,
  tachKhaNang,
  type CapIcb,
} from '@/market/icb';
import { ROLE, USER_STATUS } from '@/lib/enums';

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

/** Dựng payload ICB đúng dạng `sync.py info` ghi ra. */
function icb(cap: Record<number, [string, string]>): Record<string, CapIcb> {
  const out: Record<string, CapIcb> = {};
  for (const [k, [ma, ten]] of Object.entries(cap)) out[k] = { ma, ten };
  return out;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });

  console.log('\n1. Bảng quy đổi phải khớp master data thật');
  {
    const nganh = await prisma.sector.findMany({
      select: {
        code: true,
        isActive: true,
        industries: { select: { code: true, isActive: true } },
      },
    });
    const theoNganh = new Map(nganh.map((s) => [s.code, s]));
    /** Mọi mã phân ngành đang bật, để phân biệt "không có thật" với "sai ngành". */
    const moiPhanNganh = new Set(
      nganh.flatMap((s) => s.industries.filter((i) => i.isActive).map((i) => i.code)),
    );

    const thieuNganh: string[] = [];
    const thieuPhanNganh: string[] = [];
    const saiNganh: string[] = [];
    const trung: string[] = [];

    for (const [maIcb, q] of Object.entries(ICB_SANG_MASTER)) {
      const s = theoNganh.get(q.sectorCode);
      if (!s || !s.isActive) {
        thieuNganh.push(`${maIcb}→${q.sectorCode}`);
        continue;
      }

      /*
       * PHÂN NGÀNH PHẢI THUỘC ĐÚNG NGÀNH ĐÃ KHAI — phép kiểm đáng giá nhất của cả
       * bài. `addStockAction` từ chối cặp không thuộc nhau, nên một dòng sai ở đây
       * biến nút "dùng" thành cái bẫy: điền xong không thêm được.
       *
       * Gợi ý phụ có thể khai NGÀNH KHÁC (`INDUSTRIALS/AVIATION`), nên phải tách ra
       * rồi mới kiểm cặp — chính bản đầu của bảng thiếu bước này và có 7 dòng sai.
       */
      const cap = [
        ...(q.industryCode
          ? [{ sectorCode: q.sectorCode, industryCode: q.industryCode }]
          : []),
        ...(q.cungKhaNang ?? []).map((c) => tachKhaNang(c, q.sectorCode)),
      ];

      for (const c of cap) {
        if (!moiPhanNganh.has(c.industryCode)) {
          thieuPhanNganh.push(`${maIcb}→${c.industryCode}`);
          continue;
        }
        const nganhCuaNo = theoNganh.get(c.sectorCode);
        const thuoc = nganhCuaNo?.industries.some(
          (i) => i.isActive && i.code === c.industryCode,
        );
        if (!thuoc) saiNganh.push(`${maIcb}→${c.sectorCode}/${c.industryCode}`);
      }

      const maPhu = (q.cungKhaNang ?? []).map((c) => tachKhaNang(c, q.sectorCode).industryCode);
      if (q.industryCode && maPhu.includes(q.industryCode)) trung.push(maIcb);
    }

    console.log(`        ${Object.keys(ICB_SANG_MASTER).length} nhóm ICB trong bảng`);
    kiem(thieuNganh.length === 0, 'mọi mã ngành trong bảng đều có thật và đang bật', thieuNganh.join(', '));
    kiem(thieuPhanNganh.length === 0, 'mọi mã phân ngành đều có thật', thieuPhanNganh.join(', '));
    kiem(saiNganh.length === 0, 'mọi phân ngành đều thuộc đúng ngành đã map', saiNganh.join(', '));
    kiem(trung.length === 0, 'không nhóm nào vừa gợi ý chính vừa gợi ý phụ cùng một phân ngành', trung.join(', '));
  }

  console.log('\n2. Lớp đỡ cấp 3 phải phủ hết nhóm cấp 4 đã khai');
  {
    /*
     * Bất biến suy ra được, nên không cần danh sách cố định: mã ICB cấp 3 là mã cấp 4
     * với chữ số cuối bằng 0 (5751 → 5750). Nhóm cấp 4 nào có trong bảng mà thiếu
     * nhóm cha thì lớp đỡ hở đúng chỗ đó — và nó chỉ hở khi nguồn đổi phân ngành, tức
     * là lúc không ai đang nhìn.
     */
    const thieuCha: string[] = [];
    for (const maIcb of Object.keys(ICB_SANG_MASTER)) {
      if (maIcb.endsWith('0')) continue;
      const cha = `${maIcb.slice(0, 3)}0`;
      if (!ICB_SANG_MASTER[cha]) thieuCha.push(`${maIcb} thiếu cha ${cha}`);
    }
    kiem(thieuCha.length === 0, 'mọi nhóm cấp 4 đều có nhóm cấp 3 làm lớp đỡ', thieuCha.join(', '));

    const soCap3 = Object.keys(ICB_SANG_MASTER).filter((m) => m.endsWith('0')).length;
    kiem(soCap3 >= 37, 'có đủ 37 nhóm cấp 3 đang niêm yết', `đếm được ${soCap3}`);
  }

  console.log('\n3. Chọn cấp chi tiết nhất — ca SCS đo được thật');
  {
    /*
     * CA NÀY LÀ LÝ DO CÓ TOÀN BỘ PHẦN QUY ĐỔI THEO CẤP 4.
     *
     * VCI xếp SCS (dịch vụ hàng hoá sân bay) vào `5750 Du lịch & Giải trí` ở cấp 3 —
     * gợi ý theo cấp đó sẽ ra "Khách sạn và giải trí". Cấp 4 nói `5751 Hàng không`,
     * và đó mới là câu trả lời đúng.
     */
    const scs = quyDoiIcb(
      icb({
        2: ['5700', 'Du lịch và Giải trí'],
        3: ['5750', 'Du lịch & Giải trí'],
        4: ['5751', 'Hàng không'],
      }),
    );
    kiem(scs?.sectorCode === 'INDUSTRIALS', 'SCS → ngành Công nghiệp', String(scs?.sectorCode));
    kiem(scs?.industryCode === 'AVIATION', 'SCS → phân ngành Hàng không', String(scs?.industryCode));
    kiem(scs?.capDaDung === 4, 'dùng ICB cấp 4', String(scs?.capDaDung));

    /*
     * ĐỐI CHỨNG: cùng mã đó, bỏ cấp 4 đi thì kết quả PHẢI khác. Thiếu phép kiểm này
     * thì ca trên vẫn xanh kể cả khi hàm bỏ qua cấp 4 hoàn toàn — vì nhiều nhóm cấp 3
     * và cấp 4 ra cùng một ngành.
     */
    const chiCap3 = quyDoiIcb(icb({ 2: ['5700', 'Du lịch và Giải trí'], 3: ['5750', 'Du lịch & Giải trí'] }));
    kiem(chiCap3?.capDaDung === 3, 'không có cấp 4 thì lùi về cấp 3', String(chiCap3?.capDaDung));
    kiem(
      chiCap3?.sectorCode === 'CONSUMER_DISCRETIONARY',
      'và cấp 3 cho ra ngành KHÁC — hai cấp thật sự khác nhau',
      String(chiCap3?.sectorCode),
    );
    kiem(
      chiCap3?.industryCode === undefined,
      'cấp 3 mơ hồ thì KHÔNG gợi ý phân ngành nào',
      String(chiCap3?.industryCode),
    );
    kiem(
      (chiCap3?.cungKhaNang ?? []).length > 1,
      'mà liệt kê các khả năng để người dùng chọn',
      (chiCap3?.cungKhaNang ?? []).join(', '),
    );
  }

  console.log('\n4. Nhóm ICB lạ và payload rỗng');
  {
    kiem(quyDoiIcb(undefined) === null, 'không có ICB → null');
    kiem(quyDoiIcb({}) === null, 'ICB rỗng → null');
    kiem(
      quyDoiIcb(icb({ 4: ['9999', 'Nhóm chưa từng có'] })) === null,
      'nhóm lạ hoàn toàn → null, không đoán',
    );
    /*
     * Nhóm cấp 4 lạ nhưng cấp 3 quen: vẫn phải gợi ý được ngành. Đây chính là việc
     * của lớp đỡ khi nguồn tách thêm phân ngành mới.
     */
    const lai = quyDoiIcb(icb({ 3: ['8350', 'Ngân hàng'], 4: ['8359', 'Nhóm mới của nguồn'] }));
    kiem(lai?.sectorCode === 'FINANCIALS', 'cấp 4 lạ + cấp 3 quen → vẫn ra Tài chính', String(lai?.sectorCode));
    kiem(lai?.capDaDung === 3, 'và nói rõ là đã lùi xuống cấp 3', String(lai?.capDaDung));
    /*
     * Cấp 1 KHÔNG được dùng: `5000 Dịch vụ Tiêu dùng` gom bán lẻ, khách sạn, truyền
     * thông — gợi ý từ đó không giúp ai chọn đúng.
     */
    kiem(
      quyDoiIcb(icb({ 1: ['8000', 'Tài chính'] })) === null,
      'chỉ có cấp 1 → không gợi ý (quá thô)',
    );
  }

  console.log('\n5. Gợi ý phụ thuộc ngành khác');
  {
    kiem(
      tachKhaNang('RUBBER', 'MATERIALS').sectorCode === 'MATERIALS',
      'không có dấu / → thuộc ngành của chính dòng đó',
    );
    const q = tachKhaNang('INDUSTRIALS/AVIATION', 'CONSUMER_DISCRETIONARY');
    kiem(
      q.sectorCode === 'INDUSTRIALS' && q.industryCode === 'AVIATION',
      'có dấu / → tách đúng ngành và phân ngành',
      `${q.sectorCode}/${q.industryCode}`,
    );

    /*
     * ĐỐI CHỨNG CHO CẢ CƠ CHẾ NÀY: phải thật sự có dòng khai ngành khác trong bảng.
     * Thiếu phép kiểm này thì hai phép kiểm trên vẫn xanh kể cả khi ai đó xoá hết
     * dạng viết đầy đủ khỏi bảng — và gợi ý "Hàng không" cho SCS lại biến mất.
     */
    const coCheoNganh = Object.entries(ICB_SANG_MASTER).filter(([, x]) =>
      (x.cungKhaNang ?? []).some((c) => tachKhaNang(c, x.sectorCode).sectorCode !== x.sectorCode),
    );
    kiem(
      coCheoNganh.length >= 7,
      'bảng có ít nhất 7 nhóm khai gợi ý phụ ở ngành khác',
      `đếm được ${coCheoNganh.length}: ${coCheoNganh.map(([m]) => m).join(',')}`,
    );
    kiem(
      (ICB_SANG_MASTER['5750']?.cungKhaNang ?? []).includes('INDUSTRIALS/AVIATION'),
      'nhóm 5750 vẫn gợi ý được Công nghiệp / Hàng không (ca SCS)',
    );
  }

  console.log('\n6. Quy đổi sàn');
  {
    kiem(quyDoiSan('HSX') === 'HOSE', 'HSX của nguồn → HOSE của form');
    kiem(quyDoiSan('hose') === 'HOSE', 'chữ thường cũng nhận');
    kiem(quyDoiSan('HNX') === 'HNX', 'HNX giữ nguyên');
    kiem(quyDoiSan('UPCOM') === 'UPCOM', 'UPCOM giữ nguyên');
    kiem(quyDoiSan('DELISTED') === null, 'đã huỷ niêm yết → không gợi ý sàn');
    kiem(quyDoiSan('BOND') === null, 'trái phiếu → không gợi ý sàn');
    kiem(quyDoiSan('') === null, 'rỗng → null');
  }

  console.log('\n7. Chốt quyền — không có `stock.create` thì không tra được');
  {
    const vaiTro = await prisma.role.findFirstOrThrow({
      where: { code: ROLE.SENIOR_MANAGER },
      select: { id: true },
    });
    const nguoi = await prisma.user.create({
      data: {
        email: `kiem-goi-y-${Date.now()}@example.com`,
        passwordHash: 'x',
        fullName: 'Nguoi kiem thu goi y',
        status: USER_STATUS.ACTIVE,
        roleId: vaiTro.id,
      },
    });
    await createSession(nguoi.id);

    let daNem = false;
    try {
      await suggestStockInfoAction('SCS');
    } catch (e) {
      daNem = e instanceof Error && e.name === 'ForbiddenError';
    }
    kiem(daNem, 'ném ForbiddenError trước khi gọi nguồn');
  }

  await createSession(admin.id);

  console.log('\n8. Dạng mã sai → từ chối, không chạy Python');
  {
    for (const [nhan, ma] of [
      ['rỗng', ''],
      ['quá ngắn', 'ZZ'],
      ['quá dài', 'ABCDEFGHIJK'],
      ['có dấu phẩy', 'SCS,FPT'],
      ['có khoảng trắng', 'SCS FPT'],
      ['có dấu gạch', 'SCS-FPT'],
      ['chữ có dấu', 'SCSĐ'],
    ] as [string, string][]) {
      const kq = await suggestStockInfoAction(ma);
      kiem(!kq.ok, `${nhan}: từ chối`, JSON.stringify(kq).slice(0, 80));
    }
    /*
     * Dấu phẩy là ca đáng canh nhất: nó là ký tự tách mã của `--symbols`. Để lọt thì
     * một ô nhập thành nhiều mã trên dòng lệnh của tiến trình con.
     */
    const phay = await suggestStockInfoAction('SCS,FPT');
    kiem(
      !phay.ok && phay.message.includes('chữ in hoa'),
      'dấu phẩy bị chặn bởi phép kiểm dạng, không phải bởi nguồn',
      phay.ok ? '' : phay.message,
    );
  }

  console.log('\n9. Mã đã có trong danh mục chuẩn → nói rõ, không tra nguồn');
  {
    const co = await prisma.stock.findFirstOrThrow({
      select: { symbol: true, companyName: true },
    });
    const kq = await suggestStockInfoAction(co.symbol.toLowerCase());
    kiem(!kq.ok, `${co.symbol} (gõ chữ thường) → từ chối`);
    kiem(
      !kq.ok && kq.message.includes('đã có trong danh mục chuẩn'),
      'thông báo nói đúng lý do',
      kq.ok ? '' : kq.message,
    );
    kiem(
      !kq.ok && kq.message.includes(co.companyName),
      'và nhắc luôn tên công ty đang lưu',
      kq.ok ? '' : kq.message,
    );
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
