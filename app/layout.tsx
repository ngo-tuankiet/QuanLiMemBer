import type { Metadata, Viewport } from 'next';
import { getTheme, themeAttribute } from '@/components/theme';
import './globals.css';
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';

export const metadata: Metadata = {
  title: {
    default: `${BRAND_NAME} · ${BRAND_TAGLINE}`,
    template: `%s · ${BRAND_NAME}`,
  },
  description: 'Hệ thống quản lý danh mục đầu tư chứng khoán Việt Nam.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Hai màu cho hai chế độ: thanh địa chỉ trên mobile đi theo, không lệch tông.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0d13' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * Chủ đề nằm sẵn trong HTML đầu tiên, đọc từ cookie ở server.
   *
   * Không có script chặn, không có `suppressHydrationWarning`: HTML của server và
   * của client khớp nhau tuyệt đối, nên nếu sau này thật sự có lệch hydration thì
   * ta vẫn nhận được cảnh báo. Xem src/components/theme.ts để biết vì sao không
   * dùng cách đọc localStorage bằng script.
   */
  const theme = await getTheme();

  return (
    <html lang="vi" data-theme={themeAttribute(theme)}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
