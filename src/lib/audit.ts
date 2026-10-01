/**
 * Ghi Audit Log (§20).
 *
 * Mọi hành động thay đổi dữ liệu phải đi qua đây. Hàm này cố tình **không bao giờ
 * ném lỗi**: một lỗi khi ghi nhật ký không được phép làm thất bại nghiệp vụ đã
 * hoàn thành. Nhưng nó ghi ra console để lỗi không bị chôn im lặng.
 *
 * Khi cần đảm bảo "hoặc cả nghiệp vụ và nhật ký đều thành công, hoặc không gì
 * cả", truyền `tx` là Prisma transaction client — lúc đó nhật ký nằm cùng
 * transaction và sẽ rollback theo.
 */

import 'server-only';

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { stringifyForAudit } from '@/lib/serialize';

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditActor {
  id?: string | null;
  email?: string | null;
  fullName?: string | null;
  roleCode?: string | null;
}

export interface AuditInput {
  actor: AuditActor | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Truyền vào để nhật ký nằm cùng transaction với nghiệp vụ. */
  tx?: Db;
}

/**
 * Danh sách field đã đổi giữa before và after.
 * Chỉ so sánh các khoá có mặt ở cả hai bên để tránh báo sai khi hai object khác
 * hình dạng.
 */
export function diffFields(before: unknown, after: unknown): string[] {
  if (
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    before === null ||
    after === null
  ) {
    return [];
  }

  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const changed: string[] = [];

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[key];
    const vb = b[key];
    if (va instanceof Date && vb instanceof Date) {
      if (va.getTime() !== vb.getTime()) changed.push(key);
    } else if (va !== vb) {
      changed.push(key);
    }
  }

  return changed.sort();
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const db = input.tx ?? prisma;
  const changed = diffFields(input.before, input.after);

  try {
    await db.auditLog.create({
      data: {
        actorUserId: input.actor?.id ?? null,
        // Lưu bản chụp danh tính để nhật ký vẫn đọc được sau khi user bị xoá.
        actorEmail: input.actor?.email ?? null,
        actorName: input.actor?.fullName ?? null,
        actorRole: input.actor?.roleCode ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel ?? null,
        beforeJson: input.before === undefined ? null : stringifyForAudit(input.before),
        afterJson: input.after === undefined ? null : stringifyForAudit(input.after),
        changedFieldsJson: changed.length > 0 ? JSON.stringify(changed) : null,
        note: input.note ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    // Không ném ra ngoài: nghiệp vụ đã xong, chặn nó lúc này còn tệ hơn.
    console.error('[audit] không ghi được nhật ký:', input.action, input.entityType, error);
  }
}
