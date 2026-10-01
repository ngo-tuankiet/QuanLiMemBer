/**
 * DỌN DỮ LIỆU THỬ NGHIỆM ĐỂ NẠP DỮ LIỆU THẬT.
 *
 * Không dùng `prisma migrate reset` vì lệnh đó xoá TẤT CẢ — kể cả 2.088 dòng lịch sử
 * giá và 264 dòng VN-Index lấy từ vnstock. Đó là dữ liệu THẬT, mất đi thì biểu đồ hiệu
 * suất theo phiên trống cho tới khi tích lại đủ, mất vài tuần.
 *
 * XOÁ:
 *   giao dịch · phân bổ chiến lược của lệnh · tệp đính kèm
 *   dòng vốn · tài khoản chứng khoán
 *   yêu cầu duyệt · cảnh báo rủi ro · lượt quét rủi ro · ảnh chụp danh mục
 *   phiên đăng nhập · quyền cấp riêng cho người dùng
 *   nhật ký kiểm toán
 *   MỌI người dùng trừ admin
 *
 * GIỮ:
 *   dữ liệu chuẩn — phòng ban, nhóm, vai trò, quyền, ngành, 117 mã, chiến lược,
 *   quy tắc rủi ro, danh mục, quyền truy cập danh mục, cấu hình hệ thống
 *   lịch sử giá · VN-Index · giá hiện tại · lịch sử lấy giá
 *   tài khoản admin@vninvest.local
 *
 * TÀI KHOẢN ADMIN được giữ nhưng ĐƯA VỀ TRẠNG THÁI SẠCH: mật khẩu đặt lại theo
 * `ADMIN_PASSWORD` trong `.env`, và bật cờ bắt đổi mật khẩu ở lần đăng nhập đầu. Script
 * KHÔNG in mật khẩu ra màn hình hay nhật ký.
 *
 * VÌ SAO KHÔNG XOÁ LUÔN ADMIN RỒI SEED LẠI: `portfolios`, `risk_rules`, `system_settings`
 * đều trỏ về admin qua `createdById`. Xoá người đó là làm hỏng khoá ngoại của dữ liệu
 * chuẩn — thứ ta đang cố giữ.
 *
 *     npm run reset:real           xem trước, KHÔNG xoá gì
 *     npm run reset:real -- --yes  xoá thật (tự sao lưu prisma/dev.db trước)
 */

import { copyFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/prisma';
import { USER_STATUS } from '@/lib/enums';

const THAT = process.argv.includes('--yes');
const EMAIL_ADMIN = 'admin@vninvest.local';

async function main(): Promise<void> {
  const admin = await prisma.user.findUnique({
    where: { email: EMAIL_ADMIN },
    select: { id: true, fullName: true },
  });

  if (!admin) {
    console.error(
      `Dừng: không tìm thấy ${EMAIL_ADMIN}.\n` +
        'Script này giữ lại đúng tài khoản đó — không có nó thì không biết giữ ai.',
    );
    process.exitCode = 1;
    return;
  }

  // ---- Đếm trước ----------------------------------------------------------
  const truoc = {
    'giao dịch': await prisma.trade.count(),
    'phân bổ chiến lược của lệnh': await prisma.tradeStrategy.count(),
    'tệp đính kèm lệnh': await prisma.tradeAttachment.count(),
    'dòng vốn': await prisma.capitalFlow.count(),
    'tài khoản chứng khoán': await prisma.brokerAccount.count(),
    'yêu cầu duyệt': await prisma.approvalRequest.count(),
    'cảnh báo rủi ro': await prisma.riskAlert.count(),
    'lượt quét rủi ro': await prisma.riskScanRun.count(),
    'ảnh chụp danh mục': await prisma.portfolioSnapshot.count(),
    'phiên đăng nhập': await prisma.session.count(),
    'quyền cấp riêng': await prisma.userPermission.count(),
    'nhật ký kiểm toán': await prisma.auditLog.count(),
    'người dùng (trừ admin)': await prisma.user.count({ where: { id: { not: admin.id } } }),
  };

  const giu = {
    'lịch sử giá': await prisma.priceHistory.count(),
    'VN-Index': await prisma.marketIndexHistory.count(),
    'giá hiện tại': await prisma.marketQuote.count(),
    'lịch sử lấy giá': await prisma.marketDataSync.count(),
    'mã chứng khoán': await prisma.stock.count(),
    'ngành': await prisma.sector.count(),
    'chiến lược': await prisma.strategy.count(),
    'quy tắc rủi ro': await prisma.riskRule.count(),
    'nhóm': await prisma.team.count(),
    'phòng ban': await prisma.department.count(),
    'danh mục': await prisma.portfolio.count(),
    'cấu hình hệ thống': await prisma.systemSetting.count(),
  };

  console.log('SẼ XOÁ');
  for (const [k, v] of Object.entries(truoc)) {
    console.log(`  ${k.padEnd(30)} ${String(v).padStart(6)}`);
  }

  console.log('\nGIỮ NGUYÊN');
  for (const [k, v] of Object.entries(giu)) {
    console.log(`  ${k.padEnd(30)} ${String(v).padStart(6)}`);
  }

  console.log(`\nGIỮ tài khoản: ${EMAIL_ADMIN} (${admin.fullName})`);
  console.log('  → mật khẩu đặt lại theo ADMIN_PASSWORD, bật cờ bắt đổi ở lần đăng nhập đầu');

  if (!THAT) {
    console.log('\nXem trước. Chạy lại với  --yes  để xoá thật.');
    return;
  }

  // ---- Sao lưu ------------------------------------------------------------
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const goc = path.join('prisma', 'dev.db');
  const banSao = path.join('prisma', `dev.db.backup-truoc-reset-${stamp}`);
  copyFileSync(goc, banSao);
  console.log(`\nĐã sao lưu: ${banSao}`);

  const matKhau = process.env.ADMIN_PASSWORD;
  if (!matKhau) {
    console.error('Dừng: thiếu ADMIN_PASSWORD trong .env — không đặt lại mật khẩu admin được.');
    process.exitCode = 1;
    return;
  }

  /*
   * XOÁ THEO ĐÚNG THỨ TỰ KHOÁ NGOẠI, trong MỘT transaction.
   *
   * Con trước cha: `trade_strategies` trước `trades`, `trades` trước `broker_accounts`.
   * Nửa chừng thất bại mà không có transaction sẽ để lại một database vừa không sạch
   * vừa không dùng được.
   */
  await prisma.$transaction(async (tx) => {
    await tx.tradeStrategy.deleteMany();
    await tx.tradeAttachment.deleteMany();
    await tx.approvalRequest.deleteMany();
    await tx.trade.deleteMany();

    await tx.capitalFlow.deleteMany();
    await tx.brokerAccount.deleteMany();

    await tx.riskAlert.deleteMany();
    await tx.riskScanRun.deleteMany();
    await tx.portfolioSnapshot.deleteMany();

    await tx.session.deleteMany();
    await tx.userPermission.deleteMany();
    await tx.auditLog.deleteMany();

    /*
     * `portfolio_access` của người khác phải đi trước khi xoá họ. Của admin thì giữ —
     * đó là quyền truy cập danh mục thuộc dữ liệu chuẩn.
     */
    await tx.portfolioAccess.deleteMany({ where: { userId: { not: admin.id } } });

    /*
     * GỠ MỌI KHOÁ NGOẠI TỪ BẢNG ĐƯỢC GIỮ SANG NGƯỜI SẮP XOÁ.
     *
     * Đây là phần dễ sót nhất của một lần dọn có chọn lọc: bốn bảng nằm trong nhóm
     * GIỮ LẠI vẫn trỏ về người dùng. Không gỡ trước thì `deleteMany` trên `users` vỡ vì
     * ràng buộc khoá ngoại — hoặc tệ hơn, trên SQLite nó có thể để lại con trỏ mồ côi.
     *
     * Chuyển về admin thay vì để trống ở những chỗ con số vẫn cần một người chịu trách
     * nhiệm (quy tắc rủi ro, cấu hình, quyền truy cập danh mục). Để `null` ở chỗ chỉ là
     * dấu vết vận hành (ai bấm lấy giá, ai làm trưởng nhóm).
     */
    await tx.team.updateMany({ where: { leaderId: { not: null } }, data: { leaderId: null } });

    await tx.marketDataSync.updateMany({
      where: { triggeredById: { not: null } },
      data: { triggeredById: null },
    });

    await tx.riskRule.updateMany({
      where: { createdById: { not: admin.id } },
      data: { createdById: admin.id },
    });

    await tx.systemSetting.updateMany({
      where: { updatedById: { not: admin.id } },
      data: { updatedById: admin.id },
    });

    await tx.portfolioAccess.updateMany({
      where: { grantedById: { not: admin.id } },
      data: { grantedById: admin.id },
    });

    /*
     * `users.approvedById` trỏ giữa các người dùng với nhau. Xoá cả loạt mà không gỡ
     * trước thì thứ tự xoá quyết định thành bại — một thứ không nên phụ thuộc vào.
     */
    await tx.user.updateMany({
      where: { approvedById: { not: null } },
      data: { approvedById: null },
    });

    await tx.user.deleteMany({ where: { id: { not: admin.id } } });

    /*
     * ĐƯA ADMIN VỀ TRẠNG THÁI SẠCH. Băm lại từ `.env` bằng đúng hàm mà seed dùng
     * (bcrypt, 12 vòng). Không gán nhóm: dữ liệu thật sẽ tự quyết định.
     */
    await tx.user.update({
      where: { id: admin.id },
      data: {
        passwordHash: await bcrypt.hash(matKhau, 12),
        mustChangePassword: true,
        status: USER_STATUS.ACTIVE,
        teamId: null,
        departmentId: null,
        lastLoginAt: null,
        approvedById: null,
      },
    });
  });

  // ---- Soát lại -----------------------------------------------------------
  console.log('\nSAU KHI XOÁ');
  const sau = {
    'giao dịch': await prisma.trade.count(),
    'dòng vốn': await prisma.capitalFlow.count(),
    'tài khoản chứng khoán': await prisma.brokerAccount.count(),
    'người dùng': await prisma.user.count(),
    'phiên đăng nhập': await prisma.session.count(),
    'nhật ký kiểm toán': await prisma.auditLog.count(),
    'lịch sử giá (giữ)': await prisma.priceHistory.count(),
    'VN-Index (giữ)': await prisma.marketIndexHistory.count(),
    'mã chứng khoán (giữ)': await prisma.stock.count(),
    'chiến lược (giữ)': await prisma.strategy.count(),
    'nhóm (giữ)': await prisma.team.count(),
  };
  for (const [k, v] of Object.entries(sau)) {
    console.log(`  ${k.padEnd(30)} ${String(v).padStart(6)}`);
  }

  const conLai = await prisma.user.findMany({ select: { email: true, mustChangePassword: true } });
  console.log(`\nNgười dùng còn lại: ${conLai.map((u) => u.email).join(', ')}`);

  const ok =
    sau['giao dịch'] === 0 &&
    sau['dòng vốn'] === 0 &&
    sau['tài khoản chứng khoán'] === 0 &&
    sau['người dùng'] === 1 &&
    conLai[0]?.email === EMAIL_ADMIN &&
    conLai[0]?.mustChangePassword === true &&
    sau['lịch sử giá (giữ)'] === giu['lịch sử giá'] &&
    sau['mã chứng khoán (giữ)'] === giu['mã chứng khoán'];

  console.log(ok ? '\nĐúng như dự kiến.' : '\nLỖI: kết quả không khớp dự kiến.');
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('LOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
