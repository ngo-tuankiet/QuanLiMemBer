import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/guards';

/** Trang gốc chỉ điều hướng — không có nội dung riêng. */
export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? '/dashboard' : '/login');
}
