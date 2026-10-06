/**
 * KIỂM THỬ: VỐN BAN ĐẦU THỰC TẾ — LỖ ĐÃ CHỐT TRƯỚC KHI VÀO HỆ THỐNG.
 *
 * Quyết định của người dùng: nhập vốn ban đầu thực tế cho TỪNG tài khoản; lỗ đã chốt
 * trước = vốn thực tế − vốn đầu kỳ (giá vốn + tiền mặt lúc vào); vốn ban đầu tăng, lỗ
 * đã chốt hiện ra, tiền mặt và vị thế giữ nguyên.
 *
 * Bất biến cần giữ khi ghi khoản lỗ L:
 *   vốn góp ròng        +L
 *   lãi/lỗ đã chốt      −L   (danh mục, nhóm, người)
 *   tiền mặt            không đổi (danh mục, người, tài khoản)
 *   giá trị danh mục    không đổi
 *   lọc theo chiến lược không đổi — khoản lỗ không thuộc chiến lược nào
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:initial-capital
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS } from '@/lib/enums';
import {
  computeAccountBalances,
  computeCash,
  computeIbExposure,
  computeMemberPerformance,
  computePortfolioSummary,
  computeTeamPerformance,
} from '@/domain/portfolio-engine';
import { setInitialCapitalAction, updateCapitalFlowAction } from '@/accounts/actions';
import { maVonBanDau, TIEN_TO_DAU_KY } from '@/accounts/initial-capital';
import MemberPage from '../app/(app)/members/[id]/page';

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

type TrangTV = (p: { params: Promise<{ id: string }> }) => Promise<ReactElement>;
async function moTrang(viewerId: string, id: string): Promise<string> {
  await createSession(viewerId);
  return ketXuat(await (MemberPage as unknown as TrangTV)({ params: Promise.resolve({ id }) }));
}

function form(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

async function main(): Promise<void> {
  const pf = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });

  // Tài khoản có đúng một dòng "Vốn đầu kỳ", chủ có nhóm và có IB.
  const dauKy = await prisma.capitalFlow.findFirstOrThrow({
    where: {
      note: { startsWith: TIEN_TO_DAU_KY },
      status: 'CONFIRMED',
      brokerAccount: { user: { teamId: { not: null } }, ibId: { not: null } },
    },
    orderBy: { amount: 'desc' },
    select: {
      amount: true,
      teamId: true,
      brokerAccount: { select: { id: true, userId: true, ibId: true, accountNo: true } },
    },
  });
  const tk = dauKy.brokerAccount!;
  const chu = await prisma.user.findUniqueOrThrow({
    where: { id: tk.userId },
    select: { id: true, fullName: true, teamId: true },
  });
  const L = 50_000_000n;
  console.log(`Tài khoản ${tk.accountNo} của ${chu.fullName}, vốn đầu kỳ ${dauKy.amount}`);

  const chup = async () => {
    const [dm, dmCl, tienNguoi, tks, tv, nhom, ib] = await Promise.all([
      computePortfolioSummary({ portfolioId: pf.id }),
      prisma.strategy
        .findFirstOrThrow({ where: { isActive: true }, select: { id: true } })
        .then((s) => computePortfolioSummary({ portfolioId: pf.id, strategyId: s.id })),
      computeCash(pf.id, { userId: chu.id }),
      computeAccountBalances(pf.id, chu.id),
      computeMemberPerformance(pf.id, { onlyUserId: chu.id }),
      computeTeamPerformance(pf.id, { onlyTeamId: dauKy.teamId ?? undefined }),
      computeIbExposure(pf.id),
    ]);
    return {
      von: dm.cash.contributedCapital,
      tien: dm.cash.cashBalance,
      giaTri: dm.portfolioValue,
      chot: dm.realizedPnl,
      truoc: dm.priorRealizedPnl,
      chotCl: dmCl.realizedPnl,
      tienNguoi: tienNguoi.cashBalance,
      tienTk: tks.find((x) => x.accountId === tk.id)!.available,
      chotNguoi: tv[0]?.realizedPnl ?? 0n,
      chotNhom: nhom.find((n) => n.teamId === (dauKy.teamId ?? ''))?.realizedPnl ?? 0n,
      vonIb: ib.find((x) => x.key === tk.ibId)?.netCapital ?? 0n,
    };
  };

  const goc = await chup();

  console.log('\n1. Ghi vốn ban đầu thực tế = đầu kỳ + 50 triệu');
  await createSession(admin.id);
  {
    const kq = await setInitialCapitalAction(
      null,
      form({ accountId: tk.id, amount: (dauKy.amount + L).toString(), reason: 'kiểm thử' }),
    );
    kiem(kq.ok, 'action thành công', kq.message ?? JSON.stringify(kq.fieldErrors));
    const dong = await prisma.capitalFlow.findMany({ where: { reference: maVonBanDau(tk.id) } });
    kiem(dong.length === 2, 'ghi đúng một cặp dòng', String(dong.length));
    kiem(
      dong.every((d) => d.amount === L) &&
        dong.some((d) => d.flowType === 'CONTRIBUTION') &&
        dong.some((d) => d.flowType === 'PRIOR_LOSS'),
      'CONTRIBUTION 50tr + PRIOR_LOSS 50tr',
    );
    const sau = await chup();
    kiem(sau.von === goc.von + L, 'vốn góp ròng +50tr', `${goc.von} → ${sau.von}`);
    kiem(sau.tien === goc.tien, 'tiền mặt danh mục không đổi');
    kiem(sau.giaTri === goc.giaTri, 'giá trị danh mục không đổi');
    kiem(sau.chot === goc.chot - L, 'lãi/lỗ đã chốt −50tr', `${goc.chot} → ${sau.chot}`);
    kiem(sau.truoc === goc.truoc - L, 'priorRealizedPnl −50tr');
    kiem(sau.chotCl === goc.chotCl, 'lọc theo chiến lược: đã chốt KHÔNG đổi');
    kiem(sau.tienNguoi === goc.tienNguoi, 'tiền của chủ tài khoản không đổi');
    kiem(sau.tienTk === goc.tienTk, 'số dư tài khoản không đổi (rút được đúng như cũ)');
    kiem(sau.chotNguoi === goc.chotNguoi - L, 'đã chốt của người −50tr (trang thành viên)');
    kiem(sau.chotNhom === goc.chotNhom - L, 'đã chốt của nhóm −50tr');
    kiem(sau.vonIb === goc.vonIb + L, 'vốn theo IB +50tr');
  }

  console.log('\n2. Sửa thành +20 triệu, rồi các trường hợp bị từ chối');
  {
    const kq = await setInitialCapitalAction(
      null,
      form({ accountId: tk.id, amount: (dauKy.amount + 20_000_000n).toString(), reason: 'sửa' }),
    );
    kiem(kq.ok, 'sửa thành công');
    const dong = await prisma.capitalFlow.findMany({ where: { reference: maVonBanDau(tk.id) } });
    kiem(dong.length === 2 && dong.every((d) => d.amount === 20_000_000n), 'vẫn một cặp, mỗi dòng 20tr');
    kiem((await chup()).chot === goc.chot - 20_000_000n, 'đã chốt −20tr');

    const thap = await setInitialCapitalAction(
      null,
      form({ accountId: tk.id, amount: (dauKy.amount - 1n).toString(), reason: 'x' }),
    );
    kiem(!thap.ok && Boolean(thap.fieldErrors?.amount), 'thấp hơn vốn đầu kỳ → từ chối');

    const thieuLyDo = await setInitialCapitalAction(
      null,
      form({ accountId: tk.id, amount: dauKy.amount.toString(), reason: '' }),
    );
    kiem(!thieuLyDo.ok && Boolean(thieuLyDo.fieldErrors?.reason), 'thiếu lý do → từ chối');

    const sua = await updateCapitalFlowAction(
      null,
      form({
        id: dong.find((d) => d.flowType === 'CONTRIBUTION')!.id,
        amount: '1',
        occurredAt: '2026-01-01',
        reason: 'x',
      }),
    );
    kiem(!sua.ok, 'form sửa nạp/rút chung KHÔNG sửa lẻ được dòng của cặp', sua.message);

    const moi = await prisma.brokerAccount.findFirst({
      where: { capitalFlows: { none: { note: { startsWith: TIEN_TO_DAU_KY } } } },
      select: { id: true },
    });
    if (moi) {
      const kqMoi = await setInitialCapitalAction(
        null,
        form({ accountId: moi.id, amount: '100000000', reason: 'x' }),
      );
      kiem(!kqMoi.ok, 'tài khoản mở mới (không có vốn đầu kỳ) → từ chối', kqMoi.message);
    }

    const thucThi = await prisma.user.findFirstOrThrow({
      where: { role: { code: ROLE.EXECUTION }, status: USER_STATUS.ACTIVE },
      select: { id: true },
    });
    await createSession(thucThi.id);
    let biChan = false;
    try {
      await setInitialCapitalAction(null, form({ accountId: tk.id, amount: '1', reason: 'x' }));
    } catch {
      biChan = true;
    }
    kiem(biChan, 'người không có capital.update → bị chặn');
    await createSession(admin.id);
  }

  console.log('\n3. Hiển thị');
  {
    await prisma.user.update({ where: { id: chu.id }, data: { mustChangePassword: false } });
    const html = await moTrang(admin.id, chu.id);
    kiem(html.includes('Vốn ban đầu thực tế — lỗ đã chốt trước khi vào hệ thống'), 'admin thấy mục nhập');
    kiem(html.includes('lỗ trước khi vào hệ thống'), 'trang thành viên ghi rõ phần lỗ trước khi vào');
    const htmlChu = await moTrang(chu.id, chu.id);
    kiem(!htmlChu.includes('Nhập vốn ban đầu') && !htmlChu.includes('>Sửa<'), 'chủ tài khoản KHÔNG có ô nhập');
    kiem(htmlChu.includes('trước khi vào hệ thống'), 'chủ tài khoản vẫn thấy khoản đã ghi');
    await createSession(admin.id);
  }

  console.log('\n4. Để trống = bỏ khoản đã ghi');
  {
    const kq = await setInitialCapitalAction(null, form({ accountId: tk.id, amount: '', reason: 'bỏ' }));
    kiem(kq.ok, 'bỏ thành công', kq.message);
    kiem(
      (await prisma.capitalFlow.count({ where: { reference: maVonBanDau(tk.id) } })) === 0,
      'không còn dòng nào của cặp',
    );
    const sau = await chup();
    kiem(
      sau.von === goc.von && sau.chot === goc.chot && sau.tien === goc.tien && sau.vonIb === goc.vonIb,
      'mọi con số về đúng như ban đầu',
    );
    const nk = await prisma.auditLog.count({ where: { entityId: tk.id, entityLabel: { startsWith: 'Vốn ban đầu thực tế' } } });
    kiem(nk === 3, `ghi nhật ký mỗi lần thay đổi (${nk}/3)`);
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
