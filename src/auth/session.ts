/**
 * Quản lý phiên đăng nhập.
 *
 * QUYẾT ĐỊNH THIẾT KẾ: token opaque + tra database, KHÔNG dùng JWT tự chứa.
 *
 * JWT rất tiện cho middleware nhưng có một nhược điểm không thể chấp nhận với hệ
 * thống quản lý vốn: **không thu hồi được trước khi hết hạn**. Nếu Admin khoá một
 * tài khoản hoặc rút quyền, người đó vẫn giao dịch được tới khi token tự hết hạn.
 *
 * Cách làm ở đây:
 *   - Cookie chứa 32 byte ngẫu nhiên (token opaque, không mang thông tin gì).
 *   - Database chỉ lưu SHA-256 của token. Rò rỉ DB không cho phép mạo danh.
 *   - Mỗi request đọc dữ liệu đều tra bảng `sessions` → thu hồi có hiệu lực NGAY.
 *
 * Cái giá phải trả là một truy vấn mỗi request. Với SQLite/Postgres có index thì
 * đó là chi phí không đáng kể so với việc mất khả năng thu hồi phiên.
 */

import 'server-only';

import { cookies } from 'next/headers';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';

export const SESSION_COOKIE = 'vn_session';

/** Thời hạn tuyệt đối của một phiên. */
const SESSION_TTL_HOURS = 12;

/** Chỉ ghi lại `lastSeenAt` khi đã quá mốc này, để không ghi DB mỗi lần render. */
const LAST_SEEN_THROTTLE_MINUTES = 5;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Tạo phiên mới và đặt cookie.
 * Chỉ gọi được từ Server Action hoặc Route Handler (nơi được phép ghi cookie).
 */
export async function createSession(
  userId: string,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Đọc và xác thực phiên hiện tại.
 * Trả null nếu không có cookie, phiên đã hết hạn, hoặc đã bị thu hồi.
 */
export async function readSession(): Promise<SessionRecord | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true, lastSeenAt: true, tokenHash: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;

  // So sánh chống timing attack. Tra cứu ở trên đã dùng chính hash này nên về mặt
  // logic là dư, nhưng nó chặn khả năng suy luận qua thời gian phản hồi nếu sau
  // này ai đó đổi truy vấn sang dạng quét.
  const expected = Buffer.from(session.tokenHash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  // Cập nhật lastSeenAt có tiết chế.
  const staleAfter = Date.now() - LAST_SEEN_THROTTLE_MINUTES * 60_000;
  if (session.lastSeenAt.getTime() < staleAfter) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined); // không để việc ghi nhật ký làm sập request
  }

  return { sessionId: session.id, userId: session.userId, expiresAt: session.expiresAt };
}

/** Đăng xuất phiên hiện tại và xoá cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session
      .updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  store.delete(SESSION_COOKIE);
}

/**
 * Thu hồi TOÀN BỘ phiên của một người dùng.
 *
 * Bắt buộc gọi khi: Admin khoá/từ chối tài khoản, người dùng đổi mật khẩu, hoặc
 * quyền của người dùng bị thay đổi. Nếu quên, người bị rút quyền vẫn dùng được
 * quyền cũ tới khi phiên hết hạn.
 */
/**
 * Thu hồi mọi phiên của một người.
 *
 * `keepSessionId` GIỮ LẠI ĐÚNG MỘT PHIÊN — dùng khi người ta tự sửa tài khoản của
 * chính mình. Không có tuỳ chọn này thì admin đổi nhóm cho bản thân sẽ bị đá ra trang
 * đăng nhập ngay khi lưu, và từ phía họ việc lưu trông y như thất bại: không thông
 * báo, không thay đổi nào nhìn thấy được, chỉ có màn hình đăng nhập.
 *
 * GIỮ PHIÊN KHÔNG TẠO RA LỖ HỔNG. `getCurrentUser()` đọc lại vai trò, phòng ban, nhóm
 * và quyền riêng từ database ở MỌI request — không có gì được nhớ trong phiên. Một
 * phiên sống sót qua lần đổi vai trò lập tức chạy theo quyền mới, kể cả khi quyền vừa
 * bị hạ. Thu hồi chỉ là lớp phòng xa, và nó không đáng đánh đổi bằng việc người dùng
 * không thấy được kết quả thao tác của mình.
 *
 * Mọi phiên KHÁC vẫn bị thu hồi — thiết bị khác, trình duyệt khác đều phải đăng nhập lại.
 */
export async function revokeAllSessions(
  userId: string,
  revokedById?: string,
  keepSessionId?: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedById: revokedById ?? null },
  });
  return result.count;
}

/** Dọn phiên đã hết hạn. Gọi định kỳ, hoặc sau mỗi lần đăng nhập thành công. */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } })
    .catch(() => undefined);
}
