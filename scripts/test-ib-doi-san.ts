/**
 * KIỂM THỬ ĐỔI SÀN CỦA MỘT IB ĐANG CÓ TÀI KHOẢN.
 *
 * VÌ SAO CHỐT CŨ PHẢI NỚI. Bản trước chặn cứng: IB có tài khoản thì không đổi sàn.
 * Lý do đúng — đổi sàn biến mọi tài khoản đang gắn thành khác sàn cùng lúc, âm thầm.
 * Nhưng nó chặn luôn ca cần sửa nhất, và ca đó đã xảy ra thật: migration thêm cột
 * `broker` mà không mang dữ liệu cũ theo, nên 9 IB trên máy chủ mất sàn thật. Lúc đó
 * mọi IB có tài khoản đều mắc kẹt — sàn sai, không sửa được, và cũng không chuyển tài
 * khoản đi đâu được vì ô chọn IB đã lọc theo đúng cái sàn sai đó.
 *
 * Phép kiểm đúng không phải "có tài khoản hay không" mà là "sàn mới có khớp với tài
 * khoản hay không". Bài này canh CẢ HAI CHIỀU:
 *
 *   khớp hết  → cho đổi (đây là việc SỬA)
 *   lệch một  → vẫn chặn, và nêu tên tài khoản cản
 *
 * Thiếu chiều thứ hai thì "nới chốt" chỉ là bỏ chốt.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:ib-doi-san
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { saveIbAction } from '@/admin/ib-actions';
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

const P = process.pid;

function fd(v: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
  await createSession(admin.id);

  const sanCuaIb = async (id: string) =>
    (await prisma.introducingBroker.findUniqueOrThrow({
      where: { id },
      select: { broker: true },
    })).broker;

  /** IB khai SAI sàn (VPS) trong khi tài khoản gắn vào đều ở TCBS — đúng tình huống thật. */
  const ib = await prisma.introducingBroker.create({
    data: { code: `DS_${P}`, name: 'TCBS - ai đó', broker: 'VPS' },
    select: { id: true, code: true },
  });
  for (const no of ['105C000001', '105C000002']) {
    await prisma.brokerAccount.create({
      data: { userId: admin.id, broker: 'TCBS', accountNo: `${no}_${P}`, ibId: ib.id },
    });
  }

  const chung = { id: ib.id, code: ib.code, name: 'TCBS - ai đó', sortOrder: '0' };

  console.log('\n1. Sàn mới KHỚP mọi tài khoản đang gắn → cho đổi');
  {
    const kq = await saveIbAction(null, fd({ ...chung, broker: 'TCBS' }));
    kiem(kq.ok, 'đổi được VPS → TCBS', kq.message ?? JSON.stringify(kq.fieldErrors));
    kiem((await sanCuaIb(ib.id)) === 'TCBS', 'database đã ghi TCBS', await sanCuaIb(ib.id));
  }

  console.log('\n2. Sàn mới LỆCH với tài khoản → vẫn chặn, và nêu tên tài khoản');
  {
    const truocKhi = await sanCuaIb(ib.id);
    const kq = await saveIbAction(null, fd({ ...chung, broker: 'SSI' }));

    kiem(!kq.ok, 'bị chặn');
    kiem(!!kq.fieldErrors?.broker, 'lỗi gắn vào ô sàn');
    const loi = kq.fieldErrors?.broker?.[0] ?? '';
    kiem(loi.includes('2/2'), 'nói rõ bao nhiêu tài khoản cản', loi);
    kiem(loi.includes('105C000001'), 'nêu ĐÚNG số tài khoản cản', loi);
    kiem((await sanCuaIb(ib.id)) === truocKhi, 'sàn KHÔNG bị đổi', await sanCuaIb(ib.id));
  }

  console.log('\n3. Chỉ MỘT tài khoản lệch cũng đủ để chặn');
  {
    /*
     * Ca biên đáng canh nhất: phần lớn khớp, một cái không. Nếu cài đặt kiểm bằng "đa
     * số" hay chỉ xem tài khoản đầu tiên thì ca này lọt, và một tài khoản bị bỏ lại ở
     * trạng thái khác sàn mà không ai thấy.
     */
    const le = await prisma.brokerAccount.create({
      data: { userId: admin.id, broker: 'VPBANKS', accountNo: `116C9${P}`, ibId: ib.id },
      select: { id: true, accountNo: true },
    });

    /*
     * ĐƯA IB VỀ VPS TRƯỚC, nếu không thì `broker` mới trùng `broker` cũ và chốt không
     * kích hoạt — đúng như bản đầu của mục này: nó "trượt" vì không tạo ra thay đổi
     * nào để mà chặn, chứ không vì chốt hỏng.
     */
    await prisma.introducingBroker.update({ where: { id: ib.id }, data: { broker: 'VPS' } });

    const kq = await saveIbAction(null, fd({ ...chung, broker: 'TCBS' }));
    kiem(!kq.ok, 'bị chặn dù 2/3 tài khoản vẫn khớp');
    kiem(
      kq.fieldErrors?.broker?.[0]?.includes('1/3') === true,
      'nói rõ 1/3 tài khoản cản',
      kq.fieldErrors?.broker?.[0],
    );
    kiem(
      kq.fieldErrors?.broker?.[0]?.includes(le.accountNo) === true,
      'nêu đúng tài khoản lệch',
      kq.fieldErrors?.broker?.[0],
    );

    await prisma.brokerAccount.delete({ where: { id: le.id } });
  }

  console.log('\n4. IB CHƯA có tài khoản → đổi sàn tự do');
  {
    const trong = await prisma.introducingBroker.create({
      data: { code: `DS_TRONG_${P}`, name: 'IB chưa dùng', broker: 'VPS' },
      select: { id: true, code: true },
    });
    const kq = await saveIbAction(
      null,
      fd({ id: trong.id, code: trong.code, name: 'IB chưa dùng', broker: 'MBS', sortOrder: '0' }),
    );
    kiem(kq.ok, 'đổi được sang MBS', kq.message ?? JSON.stringify(kq.fieldErrors));
    kiem((await sanCuaIb(trong.id)) === 'MBS', 'đã ghi MBS');
  }

  console.log('\n5. Sàn "Khác": phải khớp cả TÊN công ty, không chỉ mã OTHER');
  {
    const ibKhac = await prisma.introducingBroker.create({
      data: { code: `DS_K_${P}`, name: 'IB ngoài', broker: 'OTHER', brokerOther: 'Chứng khoán Alpha' },
      select: { id: true, code: true },
    });
    await prisma.brokerAccount.create({
      data: {
        userId: admin.id,
        broker: 'OTHER',
        brokerOther: 'Chứng khoán Alpha',
        accountNo: `AL${P}`,
        ibId: ibKhac.id,
      },
    });

    const nen = { id: ibKhac.id, code: ibKhac.code, name: 'IB ngoài', sortOrder: '0' };

    /*
     * Cả hai bên đều là mã OTHER, nên phép so chỉ dựa vào `broker` sẽ cho qua — và một
     * IB của "Chứng khoán Beta" quản lý tài khoản ở "Chứng khoán Alpha".
     */
    const doiTen = await saveIbAction(
      null,
      fd({ ...nen, broker: 'OTHER', brokerOther: 'Chứng khoán Beta' }),
    );
    kiem(!doiTen.ok, 'đổi tên công ty sang "Beta" bị chặn', doiTen.message);

    // Giữ đúng tên, chỉ khác hoa/thường và khoảng trắng → phải cho qua.
    const giuTen = await saveIbAction(
      null,
      fd({ ...nen, broker: 'OTHER', brokerOther: '  chứng khoán ALPHA ' }),
    );
    kiem(giuTen.ok, 'cùng tên (khác hoa/thường) thì cho qua', giuTen.message ?? JSON.stringify(giuTen.fieldErrors));
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
