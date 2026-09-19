/**
 * Chuyển bigint sang dạng an toàn cho JSON.
 *
 * `JSON.stringify` ném lỗi khi gặp bigint. Vì toàn bộ tiền tệ trong hệ thống là
 * bigint (xem src/lib/money.ts), mọi biên giới ra ngoài — API response, Server
 * Component → Client Component, ghi Audit Log — đều phải đi qua đây.
 *
 * Quy ước: bigint → string, KHÔNG phải number. Number chỉ an toàn tới 2^53;
 * một danh mục nghìn tỷ đồng vượt ngưỡng đó và sẽ bị sai âm thầm.
 */

export type Jsonify<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? Jsonify<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonify<T[K]> }
        : T;

/** Đệ quy chuyển bigint → string, Date → ISO string. */
export function jsonify<T>(value: T): Jsonify<T> {
  if (typeof value === 'bigint') return value.toString() as Jsonify<T>;
  if (value instanceof Date) return value.toISOString() as Jsonify<T>;
  if (Array.isArray(value)) return value.map(jsonify) as Jsonify<T>;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonify(v);
    return out as Jsonify<T>;
  }
  return value as Jsonify<T>;
}

/** JSON.stringify an toàn với bigint — dùng cho beforeJson/afterJson của Audit Log. */
export function stringifyForAudit(value: unknown): string {
  return JSON.stringify(jsonify(value));
}

/** Đọc lại JSON text từ DB (contextJson, payloadJson, beforeJson...). */
export function parseJsonField<T = unknown>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
