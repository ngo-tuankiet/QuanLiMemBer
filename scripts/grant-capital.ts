/**
 * CẤP VỐN CHO NHÓM — gắn `teamId` cho một dòng trong `capital_flows`.
 *
 * VÌ SAO LÀ SCRIPT CHỨ KHÔNG PHẢI MỘT TRANG. Đặc tả (§1–§24) không có mục nào về
 * quản lý dòng vốn, và ứng dụng cũng chưa có form nào tạo `capital_flows` — tới nay
 * chúng chỉ do `seed-demo.ts` sinh ra. Dựng một trang quản lý vốn nghĩa là tự đặt ra
 * luật nghiệp vụ (ai được nạp/rút, có cần duyệt hai mắt không, hạn mức mỗi nhóm) —
 * những thứ phải do người dùng quyết, không phải do code đoán.
 *
 * Script này vì vậy chỉ làm ĐÚNG MỘT VIỆC AN TOÀN: chuyển một khoản vốn ĐÃ CÓ sang
 * cho một nhóm, hoặc trả nó về quỹ chung. Tổng vốn của danh mục KHÔNG đổi — nó không
 * tạo tiền, không xoá tiền.
 *
 * CÁCH DÙNG
 *
 *   # xem hiện trạng
 *   npx tsx scripts/grant-capital.ts list
 *
 *   # cấp một khoản cho nhóm (theo mã nhóm)
 *   npx tsx scripts/grant-capital.ts set <flowId> <teamCode>
 *
 *   # trả về quỹ chung
 *   npx tsx scripts/grant-capital.ts clear <flowId>
 *
 * LƯU Ý VỀ CỔ TỨC VÀ LÃI. Chúng về danh mục chứ không về nhóm nào, và bảng cũng
 * không có `stockId` để suy ra. Script cảnh báo nếu bạn gắn nhóm cho một dòng
 * DIVIDEND/INTEREST, nhưng vẫn cho làm — có thể bạn thật sự muốn ghi nhận như vậy.
 */

import { PrismaClient } from '@prisma/client';
import {
  CAPITAL_FLOW_AFFECTS_CONTRIBUTED,
  CAPITAL_FLOW_LABEL_VI,
  CAPITAL_FLOW_SIGN,
  type CapitalFlowType,
} from '../src/lib/enums';

const prisma = new PrismaClient();

const vnd = (v: bigint) => {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  return (neg ? '-' : '') + (Number(abs) / 1e6).toFixed(3) + ' tr';
};

async function list() {
  const flows = await prisma.capitalFlow.findMany({
    orderBy: [{ occurredAt: 'asc' }],
    select: {
      id: true,
      flowType: true,
      amount: true,
      status: true,
      occurredAt: true,
      reference: true,
      team: { select: { code: true, nameVi: true } },
    },
  });

  if (flows.length === 0) {
    console.log('Chưa có dòng vốn nào.');
    return;
  }

  console.log('DÒNG VỐN HIỆN CÓ\n');
  for (const f of flows) {
    const type = f.flowType as CapitalFlowType;
    const signed = BigInt(CAPITAL_FLOW_SIGN[type]) * f.amount;
    console.log(
      `  ${f.id}`,
      `\n    ${CAPITAL_FLOW_LABEL_VI[type].padEnd(14)} ${vnd(signed).padStart(14)}`,
      `  ${f.occurredAt.toISOString().slice(0, 10)}`,
      `  ${f.status}`,
      `\n    nhóm: ${f.team ? `${f.team.nameVi} (${f.team.code})` : '— quỹ chung —'}`,
      f.reference ? `\n    ref : ${f.reference}` : '',
    );
  }

  // Số dư theo nhóm, tính đúng như engine
  const teams = await prisma.team.findMany({
    orderBy: { nameVi: 'asc' },
    select: { id: true, code: true, nameVi: true },
  });

  console.log('\nVỐN ĐƯỢC CẤP THEO NHÓM');
  for (const t of [...teams, { id: null, code: '—', nameVi: 'Quỹ chung (chưa gán)' }]) {
    const rows = await prisma.capitalFlow.findMany({
      where: { teamId: t.id, status: 'CONFIRMED' },
      select: { flowType: true, amount: true },
    });
    const total = rows.reduce(
      (s, r) => s + BigInt(CAPITAL_FLOW_SIGN[r.flowType as CapitalFlowType]) * r.amount,
      0n,
    );
    console.log(`  ${t.nameVi.padEnd(24)} ${vnd(total).padStart(14)}  (${rows.length} dòng)`);
  }
}

async function set(flowId: string, teamCode: string | null) {
  const flow = await prisma.capitalFlow.findUnique({
    where: { id: flowId },
    select: { id: true, flowType: true, amount: true, team: { select: { nameVi: true } } },
  });
  if (!flow) throw new Error(`Không tìm thấy dòng vốn ${flowId}`);

  let teamId: string | null = null;
  let teamName = '— quỹ chung —';

  if (teamCode !== null) {
    const team = await prisma.team.findUnique({
      where: { code: teamCode },
      select: { id: true, nameVi: true },
    });
    if (!team) {
      const all = await prisma.team.findMany({ select: { code: true, nameVi: true } });
      throw new Error(
        `Không có nhóm mã "${teamCode}". Các mã hiện có: ` +
          all.map((t) => `${t.code} (${t.nameVi})`).join(', '),
      );
    }
    teamId = team.id;
    teamName = `${team.nameVi} (${teamCode})`;
  }

  const type = flow.flowType as CapitalFlowType;
  if (teamId !== null && !CAPITAL_FLOW_AFFECTS_CONTRIBUTED[type]) {
    console.warn(
      `  ! CẢNH BÁO: "${CAPITAL_FLOW_LABEL_VI[type]}" thường về danh mục chứ không về` +
        ` một nhóm (cổ tức đến từ một mã, lãi đến từ số dư chung). Vẫn tiếp tục.`,
    );
  }

  await prisma.capitalFlow.update({ where: { id: flowId }, data: { teamId } });

  console.log(
    `Đã chuyển ${vnd(BigInt(CAPITAL_FLOW_SIGN[type]) * flow.amount)}` +
      ` từ "${flow.team?.nameVi ?? '— quỹ chung —'}" sang "${teamName}".`,
  );
  console.log('Tổng vốn của danh mục KHÔNG đổi — đây là phép chuyển, không phải phép cộng.');
}

const [cmd, a, b] = process.argv.slice(2);

const run = async () => {
  switch (cmd) {
    case 'list':
      return list();
    case 'set':
      if (!a || !b) throw new Error('Cú pháp: set <flowId> <teamCode>');
      return set(a, b);
    case 'clear':
      if (!a) throw new Error('Cú pháp: clear <flowId>');
      return set(a, null);
    default:
      console.log('Lệnh: list | set <flowId> <teamCode> | clear <flowId>');
      console.log('Xem chú thích đầu file để biết vì sao đây là script chứ không phải một trang.');
  }
};

run()
  .catch((e) => {
    console.error('\nLỖI:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
