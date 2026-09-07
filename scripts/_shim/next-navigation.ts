/**
 * GIẢ LẬP `next/navigation` ĐỂ KẾT XUẤT MỘT TRANG THẬT NGOÀI NEXT.JS.
 *
 * Vì sao cần: trang dashboard chứa component client dùng `useRouter` /
 * `useSearchParams`. Ngoài app router của Next, những hook đó ném
 * "invariant expected app router to be mounted" và cả trang không kết xuất được.
 *
 * `redirect` / `forbidden` / `notFound` VẪN NÉM, không trả về rỗng. Đây là điểm dễ
 * làm sai nhất của một shim: cho chúng trả về undefined thì code sau lời gọi vẫn
 * chạy tiếp, và bài kiểm thử sẽ báo "trang kết xuất được" cho đúng cái trang mà
 * thực tế người dùng bị đá về `/login`. Ném lỗi giữ nguyên luồng điều khiển thật.
 *
 * Chỉ được trỏ tới qua `tsconfig.test.json`; `tsconfig.json` của ứng dụng không đổi.
 */

export class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT ${url}`);
    this.name = 'RedirectError';
  }
}

export class ForbiddenPageError extends Error {
  constructor() {
    super('FORBIDDEN');
    this.name = 'ForbiddenPageError';
  }
}

export class NotFoundError extends Error {
  constructor() {
    super('NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export function redirect(url: string): never {
  throw new RedirectError(url);
}

export function permanentRedirect(url: string): never {
  throw new RedirectError(url);
}

export function forbidden(): never {
  throw new ForbiddenPageError();
}

export function notFound(): never {
  throw new NotFoundError();
}

export function unauthorized(): never {
  throw new ForbiddenPageError();
}

/** Đường dẫn và query mà lượt kết xuất này coi là "trang hiện tại". */
let duongDan = '/dashboard';
let truyVan = new URLSearchParams();

export function datDuongDan(path: string, query: Record<string, string> = {}): void {
  duongDan = path;
  truyVan = new URLSearchParams(query);
}

export function usePathname(): string {
  return duongDan;
}

export function useSearchParams(): URLSearchParams {
  return truyVan;
}

export function useParams(): Record<string, string> {
  return {};
}

export function useSelectedLayoutSegment(): string | null {
  return null;
}

export function useSelectedLayoutSegments(): string[] {
  return [];
}

/**
 * Router không làm gì — kết xuất tĩnh không có điều hướng.
 *
 * Ghi lại lời gọi để bài kiểm thử soi được nếu cần; không im lặng bỏ qua.
 */
export const dieuHuongDaGoi: string[] = [];

export function useRouter() {
  return {
    push: (url: string) => void dieuHuongDaGoi.push(`push ${url}`),
    replace: (url: string) => void dieuHuongDaGoi.push(`replace ${url}`),
    refresh: () => void dieuHuongDaGoi.push('refresh'),
    back: () => void dieuHuongDaGoi.push('back'),
    forward: () => void dieuHuongDaGoi.push('forward'),
    prefetch: () => undefined,
  };
}
