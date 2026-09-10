import type { NextConfig } from 'next';

process.env.TZ = process.env.TZ ?? 'Asia/Ho_Chi_Minh';

const nextConfig: NextConfig = {
  /*
   * Build production ghi ra thư mục RIÊNG, không dùng chung `.next` với dev server.
   *
   * Lý do: `next dev` và `next build` đều ghi vào cùng thư mục output. Trên Windows,
   * việc khoá file khiến dev server đang chạy bị crash ngay khi có ai chạy build —
   * và triệu chứng là mọi trang cùng lúc "không vào được", rất dễ bị chẩn đoán sai
   * thành lỗi của trang.
   *
   * `npm run build` tự đặt NEXT_DIST_DIR=.next-build nên hai tiến trình không còn
   * đụng nhau.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  // bcryptjs và Prisma là mã Node thuần — không được để bundler kéo vào client.
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],

  // Ẩn header tiết lộ framework.
  poweredByHeader: false,

  experimental: {
    // Cho phép dùng forbidden() / unauthorized() để trả đúng mã HTTP 403/401
    // thay vì để lỗi thiếu quyền biến thành 500. Xem app/forbidden.tsx và
    // requirePagePermission() trong src/auth/guards.ts.
    authInterrupts: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
