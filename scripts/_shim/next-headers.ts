/**
 * GIẢ LẬP `next/headers` ĐỂ CHẠY SERVER ACTION THẬT NGOÀI NEXT.JS.
 *
 * Vì sao cần: `deleteUserAction` gọi `requirePermission` → `readSession` →
 * `cookies()`. Ngoài request của Next, hàm đó ném lỗi, nên không cách nào chạy
 * được code thật trong một script.
 *
 * Vì sao không viết lại logic vào script kiểm thử: đầu phiên này đã có một bài
 * học đắt — `verify-model.ts` từng chứa công thức Alpha RIÊNG của nó, sai lệch so
 * với ứng dụng (−20.70% so với +6.29%), và vẫn "pass" suốt. Một bài kiểm thử chép
 * lại logic chỉ kiểm thử bản chép. Cho nên ở đây thay môi trường, giữ nguyên code.
 *
 * Shim này chỉ được trỏ tới qua `tsconfig.test.json`. `tsconfig.json` của ứng dụng
 * không đổi, nên build thật vẫn dùng `next/headers` thật.
 */

const cookieJar = new Map<string, string>();
const headerJar = new Map<string, string>([['user-agent', 'test-runner']]);

export function datCookie(name: string, value: string): void {
  cookieJar.set(name, value);
}

export function xoaCookie(name: string): void {
  cookieJar.delete(name);
}

export async function cookies() {
  return {
    get(name: string) {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name: string, value: string) {
      cookieJar.set(name, value);
    },
    delete(name: string) {
      cookieJar.delete(name);
    },
  };
}

export async function headers() {
  return {
    get(name: string) {
      return headerJar.get(name.toLowerCase()) ?? null;
    },
  };
}
