import { PrismaClient } from '@prisma/client';

/**
 * Prisma client dùng chung.
 *
 * Giữ một instance duy nhất trên globalThis để hot-reload của Next.js (Phase 02+)
 * không tạo hàng chục connection pool tới database.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
