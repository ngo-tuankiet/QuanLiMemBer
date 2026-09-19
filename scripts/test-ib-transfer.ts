/**
 * KIỂM THỬ CHUYỂN TÀI KHOẢN GIỮA CÁC IB — `changeAccountIbAction`.
 *
 * Quy tắc nghiệp vụ đang canh: IB trong CÙNG một công ty chứng khoán chuyển tài khoản
 * qua lại được; khác công ty thì không.
 *
 * VÌ SAO CÓ CA "SÀN KHÁC" RIÊNG. Mã sàn `OTHER` gom mọi công ty không nằm trong danh
 * sách có sẵn, nên nếu chốt chỉ so mã thì một IB ở "Công ty A" sẽ quản lý được tài
 * khoản ở "Công ty B" — cả hai đều là OTHER. Đó là lỗ thủng duy nhất của phép so mã,
 * và mục 4 đo đúng nó.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:ib-transfer
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { changeAccountIbAction } from '@/accounts/actions';
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

function form(id: string, ibId: string): FormData {
  const fd = new FormData();
  fd.set('id', id);
  fd.set('ibId', ibId);
  return fd;
}

const P = process.pid;

async function ibCuaTaiKhoan(id: string): Promise<string | null> {
  const a = await prisma.brokerAccount.findUnique({ where: { id }, select: { ibId: true } });
  return a?.ibId ?? null;
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

  // --- Dàn cảnh ----------------------------------------------------------
  const ib = async (code: string, broker: string, brokerOther?: string) =>
    prisma.introducingBroker.create({
      data: { code: `${code}_${P}`, name: `IB ${code}`, broker, brokerOther: brokerOther ?? null },
      select: { id: true, code: true },
    });

  const ssiA = await ib('SSI_A', 'SSI');
  const ssiB = await ib('SSI_B', 'SSI');
  const vpsC = await ib('VPS_C', 'VPS');
  const khacX = await ib('KHAC_X', 'OTHER', 'Chứng khoán Alpha');
  const khacY = await ib('KHAC_Y', 'OTHER', 'Chứng khoán Beta');
  const daTat = await prisma.introducingBroker.create({
    data: { code: `SSI_TAT_${P}`, name: 'IB đã tắt', broker: 'SSI', isActive: false },
    select: { id: true },
  });

  const chuTk = await prisma.user.create({
    data: {
      email: `chutk.ibtransfer-${P}@example.invalid`,
      passwordHash: 'x'.repeat(60),
      fullName: 'Chu tai khoan',
      status: USER_STATUS.ACTIVE,
      roleId: idVaiTro(ROLE.EXECUTION),
    },
    select: { id: true, fullName: true },
  });

  const nguoiLa = await prisma.user.create({
    data: {
      email: `nguoila.ibtransfer-${P}@example.invalid`,
      passwordHash: 'x'.repeat(60),
      fullName: 'Nguoi khong lien quan',
      status: USER_STATUS.ACTIVE,
      roleId: idVaiTro(ROLE.EXECUTION),
    },
    select: { id: true },
  });

  const tk = await prisma.brokerAccount.create({
    data: { userId: chuTk.id, broker: 'SSI', accountNo: `IBT${P}`, ibId: ssiA.id },
    select: { id: true },
  });

  const tkKhac = await prisma.brokerAccount.create({
    data: {
      userId: chuTk.id,
      broker: 'OTHER',
      brokerOther: 'Chứng khoán Alpha',
      accountNo: `IBTO${P}`,
      ibId: khacX.id,
    },
    select: { id: true },
  });

  console.log('\n1. Chủ tài khoản chuyển sang IB CÙNG SÀN → được');
  {
    await createSession(chuTk.id);
    const kq = await changeAccountIbAction(null, form(tk.id, ssiB.id));

    kiem(kq.ok === true, 'chuyển thành công', kq.message);
    kiem((await ibCuaTaiKhoan(tk.id)) === ssiB.id, 'ibId đã đổi trong database');
    kiem(
      kq.message?.includes(ssiB.code) === true,
      'thông báo nêu tên IB mới',
      kq.message,
    );

    // Chuyển ngược lại — "qua lại lẫn nhau" nghĩa là hai chiều, không phải một chiều.
    const nguoc = await changeAccountIbAction(null, form(tk.id, ssiA.id));
    kiem(nguoc.ok === true, 'chuyển ngược lại cũng được', nguoc.message);
    kiem((await ibCuaTaiKhoan(tk.id)) === ssiA.id, 'về đúng IB ban đầu');
  }

  console.log('\n2. Chuyển sang IB KHÁC SÀN → từ chối');
  {
    await createSession(chuTk.id);
    const truoc = await ibCuaTaiKhoan(tk.id);
    const kq = await changeAccountIbAction(null, form(tk.id, vpsC.id));

    kiem(kq.ok === false, 'bị từ chối');
    kiem(!!kq.fieldErrors?.ibId, 'lỗi gắn vào ô chọn IB');
    kiem(
      kq.fieldErrors?.ibId?.[0]?.includes('VPS') === true,
      'nói rõ IB đó ở sàn nào',
      JSON.stringify(kq.fieldErrors),
    );
    kiem((await ibCuaTaiKhoan(tk.id)) === truoc, 'ibId KHÔNG đổi');
  }

  console.log('\n3. Chuyển sang IB đã tắt → từ chối (dù cùng sàn)');
  {
    await createSession(chuTk.id);
    const truoc = await ibCuaTaiKhoan(tk.id);
    const kq = await changeAccountIbAction(null, form(tk.id, daTat.id));

    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.fieldErrors?.ibId?.[0]?.includes('ngừng dùng') === true,
      'nói rõ IB đã ngừng dùng',
      JSON.stringify(kq.fieldErrors),
    );
    kiem((await ibCuaTaiKhoan(tk.id)) === truoc, 'ibId KHÔNG đổi');
  }

  console.log('\n4. Sàn "Khác": cùng mã OTHER nhưng KHÁC công ty → từ chối');
  {
    /*
     * Đây là ca mà phép so mã sàn một mình sẽ để lọt: `khacY` cũng là OTHER, nên nếu
     * chốt chỉ so `broker` thì IB của "Chứng khoán Beta" quản lý được tài khoản mở tại
     * "Chứng khoán Alpha".
     */
    await createSession(chuTk.id);
    const kq = await changeAccountIbAction(null, form(tkKhac.id, khacY.id));

    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.fieldErrors?.ibId?.[0]?.includes('Beta') === true,
      'nêu đúng tên công ty của IB kia',
      JSON.stringify(kq.fieldErrors),
    );
    kiem((await ibCuaTaiKhoan(tkKhac.id)) === khacX.id, 'ibId KHÔNG đổi');

    /*
     * ĐỐI CHỨNG cho chính phép so đó: một IB thứ hai ở ĐÚNG "Chứng khoán Alpha" phải
     * chuyển được. Thiếu ca này thì mục 4 chỉ chứng minh "OTHER luôn bị chặn", không
     * chứng minh phép so tên hoạt động.
     */
    const khacX2 = await prisma.introducingBroker.create({
      data: {
        code: `KHAC_X2_${P}`,
        name: 'IB Alpha thứ hai',
        broker: 'OTHER',
        // Hoa/thường và khoảng trắng thừa phải được bỏ qua khi so.
        brokerOther: '  chứng khoán ALPHA ',
      },
      select: { id: true },
    });
    const kqTot = await changeAccountIbAction(null, form(tkKhac.id, khacX2.id));
    kiem(kqTot.ok === true, 'IB khác cùng công ty "Alpha" thì chuyển được', kqTot.message);
    kiem((await ibCuaTaiKhoan(tkKhac.id)) === khacX2.id, 'ibId đã đổi');
  }

  console.log('\n5. Người không liên quan → từ chối');
  {
    await createSession(nguoiLa.id);
    const truoc = await ibCuaTaiKhoan(tk.id);
    const kq = await changeAccountIbAction(null, form(tk.id, ssiB.id));

    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.message?.includes('Chỉ chủ tài khoản') === true,
      'nói rõ vì sao',
      kq.message,
    );
    kiem((await ibCuaTaiKhoan(tk.id)) === truoc, 'ibId KHÔNG đổi');
  }

  console.log('\n6. Người có quyền ib.manage chuyển hộ tài khoản người khác → được');
  {
    await createSession(admin.id);
    const kq = await changeAccountIbAction(null, form(tk.id, ssiB.id));

    kiem(kq.ok === true, 'chuyển được', kq.message);
    kiem((await ibCuaTaiKhoan(tk.id)) === ssiB.id, 'ibId đã đổi');

    const nk = await prisma.auditLog.findFirst({
      where: { entityType: 'BROKER_ACCOUNT', entityId: tk.id },
      orderBy: { occurredAt: 'desc' },
      select: { note: true, beforeJson: true, afterJson: true, actorUserId: true },
    });
    kiem(nk?.actorUserId === admin.id, 'nhật ký ghi đúng người thao tác');
    kiem(
      nk?.note?.includes(chuTk.fullName) === true,
      'nhật ký phân biệt "quản trị đổi hộ" với "chính chủ tự đổi"',
      String(nk?.note),
    );
    kiem(
      typeof nk?.beforeJson === 'string' && nk.beforeJson.includes(ssiA.code),
      'nhật ký lưu IB CŨ',
      String(nk?.beforeJson),
    );
  }

  console.log('\n7. Bỏ IB, về "mở trực tiếp" → được; và chọn lại đúng IB cũ → từ chối');
  {
    await createSession(chuTk.id);
    const veTrucTiep = await changeAccountIbAction(null, form(tk.id, ''));
    kiem(veTrucTiep.ok === true, 'bỏ IB được', veTrucTiep.message);
    kiem((await ibCuaTaiKhoan(tk.id)) === null, 'ibId về null');

    /*
     * Chọn lại đúng thứ đang có là thao tác thừa, không phải lỗi dữ liệu — nhưng nếu
     * để nó chạy thì nhật ký kiểm toán đầy những dòng "đổi từ A sang A".
     */
    const laiLan2 = await changeAccountIbAction(null, form(tk.id, ''));
    kiem(laiLan2.ok === false, 'chọn lại đúng IB đang có thì từ chối');
    kiem(
      laiLan2.message?.includes('không thay đổi') === true,
      'nói rõ là không có gì thay đổi',
      laiLan2.message,
    );
  }

  console.log('\n8. Tài khoản mở trực tiếp gắn vào IB cùng sàn → được');
  {
    await createSession(chuTk.id);
    const kq = await changeAccountIbAction(null, form(tk.id, ssiA.id));
    kiem(kq.ok === true, 'gắn IB cho tài khoản đang mở trực tiếp', kq.message);
    kiem((await ibCuaTaiKhoan(tk.id)) === ssiA.id, 'ibId đã đổi');
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
