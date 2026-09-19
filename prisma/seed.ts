/**
 * Seed MASTER DATA.
 *
 * Chạy:  npm run db:seed
 *
 * Toàn bộ dùng `upsert` theo khoá tự nhiên (code/symbol/key) nên chạy lại nhiều
 * lần là an toàn — không tạo bản ghi trùng, chỉ cập nhật nội dung. Đây là điều
 * kiện để master data được coi là "nguồn sự thật trong code, DB chỉ là bản sao".
 *
 * Seed KHÔNG tạo giao dịch. Dữ liệu giao dịch minh hoạ nằm ở prisma/seed-demo.ts
 * để môi trường thật không bao giờ lẫn số liệu giả.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  ROLE_SEED,
  DEPARTMENT_SEED,
  TEAM_SEED,
  STRATEGY_SEED,
  SECTOR_SEED,
  STOCK_SEED,
  VN30_SEED,
  VN100_SEED,
  RISK_RULE_SEED,
  SETTING_SEED,
} from '../src/data/master-data';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/domain/permissions';
import { ROLE, USER_STATUS, AUDIT_ACTION, ENTITY_TYPE } from '../src/lib/enums';
import { BRAND_NAME } from '@/lib/brand';

const prisma = new PrismaClient();

function step(message: string): void {
  console.log(`  ${message}`);
}

async function seedRoles(): Promise<Map<string, string>> {
  console.log('\n[1/9] Vai trò');
  const ids = new Map<string, string>();
  for (const role of ROLE_SEED) {
    const row = await prisma.role.upsert({
      where: { code: role.code },
      create: { ...role, isSystem: true },
      update: { name: role.name, nameVi: role.nameVi, level: role.level, description: role.description },
    });
    ids.set(role.code, row.id);
  }
  step(`${ids.size} vai trò`);
  return ids;
}

async function seedPermissions(roleIds: Map<string, string>): Promise<void> {
  console.log('\n[2/9] Quyền hạn & ma trận Role → Permission');

  const permissionIds = new Map<string, string>();
  for (const perm of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { code: perm.code },
      create: perm,
      update: { name: perm.name, nameVi: perm.nameVi, description: perm.description },
    });
    permissionIds.set(perm.code, row.id);
  }
  step(`${permissionIds.size} quyền`);

  // Ghi lại ma trận: xoá sạch rồi ghi lại để bản đồ trong code luôn là sự thật —
  // nếu một quyền bị bỏ khỏi ROLE_PERMISSIONS thì nó cũng phải mất trong DB.
  await prisma.rolePermission.deleteMany({});

  let linkCount = 0;
  for (const [roleCode, codes] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleIds.get(roleCode);
    if (!roleId) continue;

    const data = codes
      .map((code) => permissionIds.get(code))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId, permissionId }));

    if (data.length !== codes.length) {
      const missing = codes.filter((c) => !permissionIds.has(c));
      throw new Error(
        `Role ${roleCode} tham chiếu quyền không tồn tại trong danh mục PERMISSIONS: ${missing.join(', ')}`,
      );
    }

    await prisma.rolePermission.createMany({ data });
    linkCount += data.length;
    step(`${roleCode.padEnd(22)} → ${data.length} quyền`);
  }
  step(`${linkCount} liên kết role-permission`);
}

async function seedOrganisation(): Promise<{
  departmentIds: Map<string, string>;
  teamIds: Map<string, string>;
}> {
  console.log('\n[3/9] Phòng ban & nhóm');

  const departmentIds = new Map<string, string>();
  // Sắp theo sortOrder để cha luôn được tạo trước con.
  for (const dept of [...DEPARTMENT_SEED].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const parentId = dept.parentCode ? departmentIds.get(dept.parentCode) ?? null : null;
    const row = await prisma.department.upsert({
      where: { code: dept.code },
      create: {
        code: dept.code,
        name: dept.name,
        nameVi: dept.nameVi,
        parentId,
        sortOrder: dept.sortOrder,
      },
      update: { name: dept.name, nameVi: dept.nameVi, parentId, sortOrder: dept.sortOrder },
    });
    departmentIds.set(dept.code, row.id);
  }
  step(`${departmentIds.size} phòng ban`);

  const teamIds = new Map<string, string>();
  for (const team of TEAM_SEED) {
    const departmentId = departmentIds.get(team.departmentCode);
    if (!departmentId) throw new Error(`Không tìm thấy phòng ban ${team.departmentCode}`);

    const row = await prisma.team.upsert({
      where: { code: team.code },
      create: {
        code: team.code,
        name: team.name,
        nameVi: team.nameVi,
        description: team.description,
        departmentId,
      },
      update: { name: team.name, nameVi: team.nameVi, description: team.description, departmentId },
    });
    teamIds.set(team.code, row.id);
  }
  step(`${teamIds.size} nhóm`);

  return { departmentIds, teamIds };
}

async function seedStrategies(): Promise<Map<string, string>> {
  console.log('\n[4/9] Chiến lược đầu tư');
  const ids = new Map<string, string>();
  for (const strategy of STRATEGY_SEED) {
    const row = await prisma.strategy.upsert({
      where: { code: strategy.code },
      create: strategy,
      update: {
        name: strategy.name,
        nameVi: strategy.nameVi,
        description: strategy.description,
        colorHex: strategy.colorHex,
        sortOrder: strategy.sortOrder,
      },
    });
    ids.set(strategy.code, row.id);
    step(`${strategy.code.padEnd(17)} ${strategy.nameVi}`);
  }
  return ids;
}

async function seedSectors(): Promise<{
  sectorIds: Map<string, string>;
  industryIds: Map<string, string>;
}> {
  console.log('\n[5/9] Ngành & phân ngành');

  const sectorIds = new Map<string, string>();
  const industryIds = new Map<string, string>();

  for (const sector of SECTOR_SEED) {
    const row = await prisma.sector.upsert({
      where: { code: sector.code },
      create: {
        code: sector.code,
        name: sector.name,
        nameVi: sector.nameVi,
        colorHex: sector.colorHex,
        sortOrder: sector.sortOrder,
      },
      update: {
        name: sector.name,
        nameVi: sector.nameVi,
        colorHex: sector.colorHex,
        sortOrder: sector.sortOrder,
      },
    });
    sectorIds.set(sector.code, row.id);

    let order = 0;
    for (const industry of sector.industries) {
      order += 1;
      const child = await prisma.industry.upsert({
        where: { code: industry.code },
        create: {
          code: industry.code,
          name: industry.name,
          nameVi: industry.nameVi,
          sectorId: row.id,
          sortOrder: order,
        },
        update: { name: industry.name, nameVi: industry.nameVi, sectorId: row.id, sortOrder: order },
      });
      industryIds.set(industry.code, child.id);
    }
  }

  step(`${sectorIds.size} ngành, ${industryIds.size} phân ngành`);
  return { sectorIds, industryIds };
}

async function seedStocks(
  sectorIds: Map<string, string>,
  industryIds: Map<string, string>,
): Promise<number> {
  console.log('\n[6/9] Danh mục mã chứng khoán');

  /*
   * Tra tư cách thành viên rổ bằng Set, không bằng `Array.includes` trong vòng lặp.
   * 117 mã × 2 rổ × 100 phần tử là 23.400 phép so mỗi lần seed — không chết ai, nhưng
   * Set nói rõ ý hơn: đây là một phép "có thuộc rổ không", không phải một phép tìm.
   */
  const trongVn30 = new Set(VN30_SEED);
  const trongVn100 = new Set(VN100_SEED);

  for (const stock of STOCK_SEED) {
    const sectorId = sectorIds.get(stock.sectorCode);
    const industryId = industryIds.get(stock.industryCode);
    if (!sectorId) throw new Error(`${stock.symbol}: không tìm thấy ngành ${stock.sectorCode}`);
    if (!industryId) throw new Error(`${stock.symbol}: không tìm thấy phân ngành ${stock.industryCode}`);

    await prisma.stock.upsert({
      where: { symbol: stock.symbol },
      create: {
        symbol: stock.symbol,
        companyName: stock.companyName,
        companyNameVi: stock.companyName,
        exchange: stock.exchange,
        sectorId,
        industryId,
        isVn30: trongVn30.has(stock.symbol),
        isVn100: trongVn100.has(stock.symbol),
      },
      update: {
        companyName: stock.companyName,
        companyNameVi: stock.companyName,
        exchange: stock.exchange,
        sectorId,
        industryId,
        isVn30: trongVn30.has(stock.symbol),
        isVn100: trongVn100.has(stock.symbol),
      },
    });
  }

  const byExchange = await prisma.stock.groupBy({ by: ['exchange'], _count: true });
  for (const group of byExchange) step(`${group.exchange.padEnd(6)} ${group._count} mã`);
  const vn30 = await prisma.stock.count({ where: { isVn30: true } });
  const vn100 = await prisma.stock.count({ where: { isVn100: true } });
  step(`VN30   ${vn30} mã`);
  step(`VN100  ${vn100} mã`);

  /*
   * Rổ khai trong seed mà không có mã tương ứng trong STOCK_SEED thì mã đó KHÔNG
   * được lấy giá, dù danh sách rổ nói là có. Báo ngay tại đây thay vì để phát hiện
   * qua việc "thiếu giá" mấy tuần sau.
   */
  const coTrongSeed = new Set(STOCK_SEED.map((x) => x.symbol));
  const thieu = [...VN100_SEED, ...VN30_SEED].filter((x) => !coTrongSeed.has(x));
  if (thieu.length > 0) {
    throw new Error(
      `Rổ chỉ số có ${thieu.length} mã chưa khai trong STOCK_SEED: ${[...new Set(thieu)].join(', ')}`,
    );
  }

  return STOCK_SEED.length;
}

async function seedAdmin(
  roleIds: Map<string, string>,
  departmentIds: Map<string, string>,
): Promise<string> {
  console.log('\n[7/9] Tài khoản quản trị');

  const email = (process.env.ADMIN_EMAIL ?? 'admin@vninvest.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe@2026';
  const fullName = process.env.ADMIN_FULL_NAME ?? 'System Administrator';

  const adminRoleId = roleIds.get(ROLE.ADMIN);
  if (!adminRoleId) throw new Error('Thiếu vai trò ADMIN');

  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = existing ? existing.passwordHash : await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      fullName,
      status: USER_STATUS.ACTIVE,
      roleId: adminRoleId,
      departmentId: departmentIds.get('SENIOR_MANAGEMENT') ?? null,
      employeeCode: 'ADMIN-001',
      approvedAt: new Date(),
      // Buộc đổi mật khẩu ở lần đăng nhập đầu — mật khẩu seed nằm trong .env,
      // không được phép tồn tại lâu dài trong hệ thống quản lý vốn.
      mustChangePassword: true,
    },
    update: { status: USER_STATUS.ACTIVE, roleId: adminRoleId },
  });

  if (existing) {
    step(`${email} (đã tồn tại, giữ nguyên mật khẩu)`);
  } else {
    step(`${email} — mật khẩu lấy từ ADMIN_PASSWORD, phải đổi khi đăng nhập lần đầu`);
  }

  return admin.id;
}

async function seedRiskAndSettings(adminId: string): Promise<void> {
  console.log('\n[8/9] Ngưỡng rủi ro & cấu hình hệ thống');

  for (const rule of RISK_RULE_SEED) {
    await prisma.riskRule.upsert({
      where: { code: rule.code },
      create: {
        code: rule.code,
        name: rule.name,
        nameVi: rule.nameVi,
        scope: rule.scope,
        metric: rule.metric,
        comparator: rule.comparator,
        threshold: BigInt(rule.threshold),
        severity: rule.severity,
        description: rule.description,
        createdById: adminId,
      },
      update: {
        name: rule.name,
        nameVi: rule.nameVi,
        threshold: BigInt(rule.threshold),
        severity: rule.severity,
        description: rule.description,
      },
    });
  }
  step(`${RISK_RULE_SEED.length} ngưỡng rủi ro`);

  for (const setting of SETTING_SEED) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      create: { ...setting, updatedById: adminId },
      // Cố tình KHÔNG ghi đè `value`: cấu hình người dùng đã sửa trong app phải
      // được giữ lại khi seed chạy lại. Chỉ cập nhật phần mô tả.
      update: {
        name: setting.name,
        nameVi: setting.nameVi,
        description: setting.description,
        group: setting.group,
        valueType: setting.valueType,
      },
    });
  }
  step(`${SETTING_SEED.length} tham số cấu hình`);
}

async function seedDefaultPortfolio(
  adminId: string,
  teamIds: Map<string, string>,
): Promise<void> {
  console.log('\n[9/9] Danh mục mặc định');

  const portfolio = await prisma.portfolio.upsert({
    where: { code: 'MAIN' },
    create: {
      code: 'MAIN',
      name: 'Main Portfolio',
      nameVi: 'Danh mục chính',
      description: 'Danh mục đầu tư chính của tổ chức.',
      /*
       * KHÔNG gán danh mục chính cho một nhóm nào.
       *
       * MAIN là danh mục của cả tổ chức; Đá Bóng, Cầu Lông, Tài chính và Cá nhân
       * đều giao dịch trên đó. Gán `ownerTeamId` cho một nhóm sẽ nói sai rằng ba
       * nhóm còn lại là khách. Nhóm nào sở hữu danh mục RIÊNG thì lúc tạo danh
       * mục đó mới đặt `ownerTeamId`.
       */
      ownerTeamId: null,
      inceptionDate: new Date(),
    },
    update: {},
  });
  step(`MAIN — ${portfolio.id}`);

  /*
   * Mọi nhóm đều được TRADE trên danh mục chính — CÙNG MỘT MỨC.
   *
   * Trước đây ba nhóm được cấp ba mức khác nhau (MANAGE / TRADE / VIEW) vì lúc
   * đó tên nhóm chính là tên vai trò. Bây giờ nhóm chỉ nói "làm việc với ai",
   * nên phân biệt mức truy cập theo nhóm là sai chỗ: khả năng làm gì đến từ VAI
   * TRÒ. Một MEMBER trong nhóm Đá Bóng vẫn không nhập được lệnh vì thiếu quyền
   * `transaction.create`, dù nhóm của họ có TRADE.
   *
   * Nhóm nào cần quyền khác trên một danh mục cụ thể thì cấp riêng cho danh mục
   * đó, không phải bằng cách đặt tên nhóm theo vai trò.
   */
  const grants: [string, string][] = [
    ['DA_BONG', 'TRADE'],
    ['CAU_LONG', 'TRADE'],
    ['TAI_CHINH', 'TRADE'],
    ['CA_NHAN', 'TRADE'],
  ];
  for (const [teamCode, accessLevel] of grants) {
    const teamId = teamIds.get(teamCode);
    if (!teamId) continue;
    await prisma.portfolioAccess.upsert({
      where: { portfolioId_teamId: { portfolioId: portfolio.id, teamId } },
      create: { portfolioId: portfolio.id, teamId, accessLevel, grantedById: adminId },
      update: { accessLevel },
    });
    step(`${teamCode.padEnd(26)} → ${accessLevel}`);
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(75));
  console.log(` SEED MASTER DATA — ${BRAND_NAME} Management Dashboard`);
  console.log('='.repeat(75));

  const roleIds = await seedRoles();
  await seedPermissions(roleIds);
  const { departmentIds, teamIds } = await seedOrganisation();
  await seedStrategies();
  const { sectorIds, industryIds } = await seedSectors();
  await seedStocks(sectorIds, industryIds);
  const adminId = await seedAdmin(roleIds, departmentIds);
  await seedRiskAndSettings(adminId);
  await seedDefaultPortfolio(adminId, teamIds);

  // Chính seed cũng phải để lại dấu vết (§20).
  await prisma.auditLog.create({
    data: {
      actorUserId: adminId,
      actorName: 'system',
      action: AUDIT_ACTION.CREATE,
      entityType: ENTITY_TYPE.SETTING,
      entityLabel: 'Seed master data',
      note: 'Nạp master data khởi tạo hệ thống (Phase 01).',
    },
  });

  console.log('\n' + '='.repeat(75));
  console.log(' HOÀN TẤT');
  console.log('='.repeat(75));
  console.log(' Bước tiếp theo:');
  console.log('   npm run db:seed:demo    Nạp giao dịch minh hoạ để kiểm chứng mô hình');
  console.log('   npm run verify:model    Kiểm tra tính đúng đắn của mô hình dữ liệu');
  console.log('   npm run db:studio       Mở Prisma Studio xem dữ liệu\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nSEED THẤT BẠI:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

