/**
 * Chuyển dữ liệu từ các nhóm đặt tên theo VAI TRÒ sang nhóm làm việc thật.
 *
 *   npx tsx scripts/migrate-teams.ts          xem trước, không ghi gì
 *   npx tsx scripts/migrate-teams.ts --apply  thực hiện
 *
 * BỐI CẢNH. Ba nhóm ban đầu tên là "Nhóm thực thi", "Nhóm hỗ trợ thực thi",
 * "Quản lý danh mục" — tức là tên vai trò. Trang Members vì thế in cùng một chữ
 * ở cả cột Vai trò và cột Nhóm. Nhóm thật của tổ chức là Đá Bóng, Cầu Lông,
 * Tài chính và Cá nhân; xem `TEAM_SEED` trong src/data/master-data.ts.
 *
 * `prisma/seed.ts` chỉ upsert theo `code` nên chạy lại seed sẽ TẠO THÊM bốn nhóm
 * mới mà vẫn để ba nhóm cũ nằm đó cùng toàn bộ người và giao dịch trỏ vào chúng.
 * Script này làm phần seed không làm được: dời tham chiếu rồi xoá nhóm cũ.
 *
 * GIAO DỊCH ĐI THEO NGƯỜI THỰC HIỆN, không theo nhóm cũ. `trade.teamId` trả lời
 * "lệnh này thuộc nhóm nào", và câu trả lời đúng là nhóm của người đã đặt lệnh.
 * Đây là quy tắc, không phải một phép gán tuỳ ý — nên kết quả không phụ thuộc
 * vào việc ai chạy script hay chạy lúc nào.
 */

import { PrismaClient } from '@prisma/client';
import { TEAM_SEED } from '../src/data/master-data';
import { AUDIT_ACTION, ENTITY_TYPE } from '../src/lib/enums';

const prisma = new PrismaClient();

/** Nhóm cũ → nhóm mới, cho những người không suy được từ nơi khác. */
const TEAM_REMAP: Record<string, string> = {
  EXECUTION_TEAM: 'DA_BONG',
  PORTFOLIO_MANAGEMENT: 'TAI_CHINH',
  SUPPORTING_EXECUTION_TEAM: 'TAI_CHINH',
};

/**
 * Ghi đè theo từng người, ưu tiên hơn `TEAM_REMAP`.
 *
 * Có mục này để dữ liệu minh hoạ trải ra cả bốn nhóm — nếu dồn hết vào một nhóm
 * thì bộ lọc theo nhóm trên Dashboard không bao giờ được thử thật.
 */
const USER_OVERRIDE: Record<string, string> = {
  'trader1@vninvest.local': 'DA_BONG',
  'trader2@vninvest.local': 'CAU_LONG',
  'pm@vninvest.local': 'TAI_CHINH',
  'support1@vninvest.local': 'TAI_CHINH',
  'pending@vninvest.local': 'CA_NHAN',
};

const NEW_CODES = new Set(TEAM_SEED.map((t) => t.code));

async function main() {
  const apply = process.argv.includes('--apply');
  const tag = apply ? '' : '  [xem trước]';

  // -------------------------------------------------------------------------
  // Kiểm tra tiền đề
  // -------------------------------------------------------------------------
  const teams = await prisma.team.findMany({
    select: { id: true, code: true, nameVi: true },
  });
  const byCode = new Map(teams.map((t) => [t.code, t]));

  const missing = [...NEW_CODES].filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    console.error(`Chưa có các nhóm mới: ${missing.join(', ')}`);
    console.error('Chạy `npm run db:seed` trước rồi chạy lại script này.');
    process.exit(1);
  }

  const legacy = teams.filter((t) => !NEW_CODES.has(t.code));
  if (legacy.length === 0) {
    console.log('Không còn nhóm cũ nào. Dữ liệu đã khớp với code.');
    return;
  }

  console.log(`${legacy.length} nhóm cũ cần dời:${tag}`);
  for (const t of legacy) console.log(`  ${t.code.padEnd(26)} "${t.nameVi}"`);

  const target = (code: string): string => {
    const id = byCode.get(code)?.id;
    if (!id) throw new Error(`không tìm thấy nhóm ${code}`);
    return id;
  };

  // -------------------------------------------------------------------------
  // 1. Người dùng
  // -------------------------------------------------------------------------
  const legacyIds = legacy.map((t) => t.id);
  const users = await prisma.user.findMany({
    where: { teamId: { in: legacyIds } },
    select: { id: true, email: true, fullName: true, teamId: true },
  });

  const moves: { userId: string; email: string; from: string; toCode: string }[] = [];
  for (const u of users) {
    const fromCode = legacy.find((t) => t.id === u.teamId)!.code;
    const toCode = USER_OVERRIDE[u.email] ?? TEAM_REMAP[fromCode] ?? 'CA_NHAN';
    moves.push({ userId: u.id, email: u.email, from: fromCode, toCode });
  }

  console.log(`\n${moves.length} người dùng:`);
  for (const m of moves) {
    console.log(`  ${m.email.padEnd(30)} ${m.from.padEnd(26)} → ${m.toCode}`);
  }

  // -------------------------------------------------------------------------
  // 2. Giao dịch — đi theo người thực hiện
  // -------------------------------------------------------------------------
  const trades = await prisma.trade.findMany({
    where: { teamId: { in: legacyIds } },
    select: { id: true, code: true, userId: true },
  });

  // Nhóm mới của từng người, gồm cả người đã ở nhóm mới từ trước.
  const finalTeamOf = new Map<string, string>(moves.map((m) => [m.userId, target(m.toCode)]));
  const already = await prisma.user.findMany({
    where: { teamId: { in: [...NEW_CODES].map(target) } },
    select: { id: true, teamId: true },
  });
  for (const u of already) if (u.teamId) finalTeamOf.set(u.id, u.teamId);

  /*
   * Lệnh mà người thực hiện KHÔNG thuộc nhóm nào (ví dụ Admin nhập hộ) được đưa
   * về "Cá nhân" thay vì để null. Để null thì lệnh đó biến mất khỏi mọi bộ lọc
   * theo nhóm — kể cả với người có quyền xem toàn bộ, vì họ vẫn phải chọn một
   * nhóm để lọc. "Cá nhân" là câu trả lời trung thực: không thuộc nhóm nào.
   */
  const fallback = target('CA_NHAN');
  const tradeMoves = trades.map((t) => ({
    id: t.id,
    code: t.code,
    toTeamId: finalTeamOf.get(t.userId) ?? fallback,
  }));

  const tradeCount = new Map<string, number>();
  for (const t of tradeMoves) tradeCount.set(t.toTeamId, (tradeCount.get(t.toTeamId) ?? 0) + 1);
  console.log(`\n${tradeMoves.length} giao dịch (theo người thực hiện):`);
  for (const [teamId, n] of tradeCount) {
    const code = teams.find((t) => t.id === teamId)?.code ?? teamId;
    console.log(`  → ${code.padEnd(12)} ${n} lệnh`);
  }

  // -------------------------------------------------------------------------
  // 3. Danh mục do nhóm cũ sở hữu
  // -------------------------------------------------------------------------
  const portfolios = await prisma.portfolio.findMany({
    where: { ownerTeamId: { in: legacyIds } },
    select: { id: true, code: true },
  });
  if (portfolios.length > 0) {
    console.log(`\n${portfolios.length} danh mục sẽ chuyển sang KHÔNG thuộc nhóm nào:`);
    for (const p of portfolios) console.log(`  ${p.code} → ownerTeamId = null`);
  }

  // -------------------------------------------------------------------------
  // 4. Quyền truy cập danh mục
  // -------------------------------------------------------------------------
  const accesses = await prisma.portfolioAccess.findMany({
    where: { teamId: { in: legacyIds } },
    select: { id: true, portfolioId: true, accessLevel: true },
  });
  const affectedPortfolios = [...new Set(accesses.map((a) => a.portfolioId))];
  if (accesses.length > 0) {
    console.log(
      `\n${accesses.length} bản cấp quyền của nhóm cũ sẽ bị xoá (cascade khi xoá nhóm),`,
    );
    console.log(
      `  và ${affectedPortfolios.length} danh mục sẽ được cấp TRADE cho cả bốn nhóm mới.`,
    );
  }

  if (!apply) {
    console.log('\nChạy lại với --apply để thực hiện.\n');
    return;
  }

  // -------------------------------------------------------------------------
  // Thực hiện
  // -------------------------------------------------------------------------
  const admin = await prisma.user.findFirst({
    where: { role: { code: 'ADMIN' } },
    select: { id: true, email: true, fullName: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const m of moves) {
      await tx.user.update({ where: { id: m.userId }, data: { teamId: target(m.toCode) } });
    }

    // Gom theo nhóm đích để dùng updateMany thay vì một lệnh mỗi giao dịch.
    const byTarget = new Map<string, string[]>();
    for (const t of tradeMoves) {
      const list = byTarget.get(t.toTeamId) ?? [];
      list.push(t.id);
      byTarget.set(t.toTeamId, list);
    }
    for (const [teamId, ids] of byTarget) {
      await tx.trade.updateMany({ where: { id: { in: ids } }, data: { teamId } });
    }

    await tx.portfolio.updateMany({
      where: { ownerTeamId: { in: legacyIds } },
      data: { ownerTeamId: null },
    });

    for (const portfolioId of affectedPortfolios) {
      for (const code of NEW_CODES) {
        const teamId = target(code);
        await tx.portfolioAccess.upsert({
          where: { portfolioId_teamId: { portfolioId, teamId } },
          create: { portfolioId, teamId, accessLevel: 'TRADE', grantedById: admin?.id ?? null },
          update: { accessLevel: 'TRADE' },
        });
      }
    }

    /*
     * Xoá nhóm cũ. Chỉ an toàn vì mọi tham chiếu ở trên đã được dời trong CÙNG
     * transaction này: `users.teamId`, `trades.teamId`, `portfolios.ownerTeamId`.
     * `portfolio_accesses` và `teams.leaderId` tự đi theo nhờ onDelete.
     *
     * Kiểm lại trước khi xoá thay vì tin rằng các bước trên đã đủ — nếu sau này
     * có thêm một bảng trỏ tới `teams`, chỗ này phải nổ chứ không được xoá âm thầm.
     */
    for (const t of legacy) {
      const [stillUsers, stillTrades, stillPortfolios] = await Promise.all([
        tx.user.count({ where: { teamId: t.id } }),
        tx.trade.count({ where: { teamId: t.id } }),
        tx.portfolio.count({ where: { ownerTeamId: t.id } }),
      ]);
      if (stillUsers || stillTrades || stillPortfolios) {
        throw new Error(
          `${t.code} vẫn còn tham chiếu (users=${stillUsers} trades=${stillTrades} ` +
            `portfolios=${stillPortfolios}) — không xoá, toàn bộ transaction bị hoàn tác.`,
        );
      }

      await tx.auditLog.create({
        data: {
          actorUserId: admin?.id ?? null,
          actorEmail: admin?.email ?? null,
          actorName: admin?.fullName ?? 'CLI',
          actorRole: 'ADMIN',
          action: AUDIT_ACTION.DELETE,
          entityType: ENTITY_TYPE.TEAM,
          entityId: t.id,
          entityLabel: `${t.code} · ${t.nameVi}`,
          beforeJson: JSON.stringify({ code: t.code, nameVi: t.nameVi }),
          note:
            'Nhóm đặt tên theo vai trò — đã dời người và giao dịch sang nhóm làm ' +
            'việc thật bằng scripts/migrate-teams.ts',
        },
      });

      await tx.team.delete({ where: { id: t.id } });
    }
  });

  console.log('\nXong. Đã dời dữ liệu, xoá nhóm cũ và ghi Audit Log.\n');
}

main().finally(() => prisma.$disconnect());
