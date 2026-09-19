/**
 * ĐẶT MỨC QUỸ DỰ PHÒNG CỦA DANH MỤC.
 *
 * VÌ SAO CẦN SCRIPT NÀY. `portfolios.reserveAmount` trừ thẳng vào "Available Cash" —
 * con số người dùng nhìn để biết còn bao nhiêu tiền mua được. Vậy mà không có chỗ nào
 * trong giao diện sửa được nó: cả mã nguồn chỉ ĐỌC cột này. Giá trị 480.000.000 do bản
 * seed demo đặt đã im lặng giữ 79% tài sản của người dùng thật.
 *
 * GHI AUDIT LOG. Đây là thay đổi làm đổi một con số tiền trên mọi màn hình, nên nó phải
 * để lại dấu vết như mọi thay đổi khác (§20) — kể cả khi được thực hiện bằng script.
 *
 * Dùng:  npx tsx --tsconfig tsconfig.scripts.json scripts/set-reserve.ts <số tiền>
 * Ví dụ: npx tsx --tsconfig tsconfig.scripts.json scripts/set-reserve.ts 0
 */

import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { formatVnd } from '@/lib/money';
import { AUDIT_ACTION, ENTITY_TYPE, PORTFOLIO_STATUS, ROLE } from '@/lib/enums';

async function main(): Promise<void> {
  const tho = process.argv[2];
  if (tho === undefined || !/^\d+$/.test(tho.replace(/[.,\s]/g, ''))) {
    console.error('Thiếu hoặc sai tham số. Ví dụ: scripts/set-reserve.ts 0');
    process.exit(2);
  }
  const muc = BigInt(tho.replace(/[.,\s]/g, ''));

  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true, nameVi: true, name: true, reserveAmount: true },
  });

  if (portfolio.reserveAmount === muc) {
    console.log(`Quỹ dự phòng đã là ${formatVnd(muc)}, không có gì để đổi.`);
    await prisma.$disconnect();
    return;
  }

  const actor = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN } },
    select: { id: true, email: true, fullName: true, role: { select: { code: true } } },
  });

  const after = await prisma.portfolio.update({
    where: { id: portfolio.id },
    data: { reserveAmount: muc },
    select: { reserveAmount: true },
  });

  await writeAudit({
    actor: {
      id: actor.id,
      email: actor.email,
      fullName: actor.fullName,
      roleCode: actor.role?.code ?? null,
    } as never,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.PORTFOLIO,
    entityId: portfolio.id,
    entityLabel: portfolio.nameVi ?? portfolio.name,
    before: { reserveAmount: portfolio.reserveAmount.toString() },
    after: { reserveAmount: after.reserveAmount.toString() },
    note: 'Đặt mức quỹ dự phòng bằng scripts/set-reserve.ts',
  });

  console.log(
    `Quỹ dự phòng ${portfolio.code}: ${formatVnd(portfolio.reserveAmount)} → ${formatVnd(after.reserveAmount)}`,
  );
  await prisma.$disconnect();
}

void main();
