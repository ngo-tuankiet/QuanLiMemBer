/**
 * KIỂM THỬ: HUY HIỆU MENU "Cổ tức".
 *
 *   - số = số MÃ có mục ghi được (không tính mục chờ tiền về), cùng phạm vi trang cổ tức
 *   - theo vai trò: người thực thi chỉ tài khoản của mình; admin tất cả
 *   - ghi nhận xong một mã thì số giảm (bản sao: đánh dấu đã xử lý mọi mục của một mã)
 *
 * Dùng: npm run test:dividend-badge
 */

import { prisma } from '@/lib/prisma';
import { EVENT_RESOLUTION, ROLE, USER_STATUS, type RoleCode } from '@/lib/enums';
import { computePendingCorporateEvents, demCoTucChoGhi } from '@/dividends/pending';
import { phamViCoTuc } from '@/dividends/scope';
import { resolvePermissions } from '@/domain/permissions';

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

async function nguoiXem(role: string) {
  const u = await prisma.user.findFirstOrThrow({
    where: { role: { code: role }, status: USER_STATUS.ACTIVE, teamId: { not: null } },
    select: { id: true, teamId: true, fullName: true },
  });
  return { ...u, roleCode: role, permissions: resolvePermissions(role as RoleCode) };
}

async function main(): Promise<void> {
  const admin = await nguoiXem(ROLE.ADMIN);
  const pvAdmin = phamViCoTuc(admin);
  const muc = await computePendingCorporateEvents(pvAdmin);
  const ma = new Set(muc.filter((m) => !m.choTienVe).map((m) => m.symbol));
  const dem = await demCoTucChoGhi(pvAdmin);
  console.log(`  (admin: ${dem.soMa} mã, ${dem.soMuc} mục, ${dem.soMaChoTienVe} mã chờ tiền về)`);
  kiem(dem.soMa === ma.size, 'số trên huy hiệu = số mã ghi được trên trang cổ tức');
  kiem(dem.soMuc === muc.filter((m) => !m.choTienVe).length, 'chú thích đếm đúng số mục');

  const thucThi = await nguoiXem(ROLE.EXECUTION);
  const demTT = await demCoTucChoGhi(phamViCoTuc(thucThi));
  const mucTT = await computePendingCorporateEvents(phamViCoTuc(thucThi));
  kiem(mucTT.every((m) => m.ownerId === thucThi.id), 'người thực thi: chỉ mục của tài khoản mình');
  kiem(demTT.soMa <= dem.soMa, `người thực thi thấy ${demTT.soMa} mã (≤ admin ${dem.soMa})`);

  if (ma.size > 0) {
    const mot = [...ma][0]!;
    const cuaMa = muc.filter((m) => m.symbol === mot && !m.choTienVe);
    for (const m of cuaMa) {
      await prisma.corporateEventResolution.create({
        data: {
          eventId: m.eventId,
          brokerAccountId: m.accountId,
          status: EVENT_RESOLUTION.DISMISSED,
          reason: 'kiểm thử huy hiệu',
          resolvedById: admin.id,
        },
      });
    }
    const sau = await demCoTucChoGhi(pvAdmin);
    kiem(sau.soMa === dem.soMa - 1, `xử lý xong ${mot} → huy hiệu ${dem.soMa} → ${sau.soMa}`);
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
