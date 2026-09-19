/**
 * SOÁT BẢO MẬT — mọi cửa vào hệ thống có chốt quyền không.
 *
 * Ba loại cửa, mỗi loại một chốt riêng:
 *
 *   TRANG        `requirePagePermission('x')` ở dòng đầu
 *   SERVER ACTION `requirePermission('x')` hoặc `requireUser()` ở dòng đầu
 *   API ROUTE    kiểm phiên rồi trả 401/403, hoặc token máy-với-máy
 *
 * Bài này ĐỌC MÃ NGUỒN chứ không chạy — mục đích là tìm cửa nào KHÔNG có chốt, chứ không
 * phải kiểm chốt chạy đúng (việc đó thuộc các bài `test:*`). Một cửa thiếu chốt là lỗ
 * hổng kể cả khi giao diện không hiện đường dẫn tới nó: URL gõ tay được, form gửi tay
 * được.
 *
 * Chỉ ĐỌC. Dùng: npm run audit:security
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

let ok = 0;
let canXem = 0;
const canhBao: string[] = [];

function check(dieuKien: boolean, nhan: string, chiTiet = ''): void {
  if (dieuKien) {
    ok++;
    console.log(`  OK    ${nhan}`);
  } else {
    canXem++;
    console.log(`  XEM   ${nhan}${chiTiet ? ` — ${chiTiet}` : ''}`);
    canhBao.push(`${nhan}${chiTiet ? ` — ${chiTiet}` : ''}`);
  }
}

function header(t: string): void {
  console.log(`\n${'─'.repeat(88)}\n ${t}\n${'─'.repeat(88)}`);
}

/** Mọi file khớp `ten` dưới `goc`, đệ quy. */
function tim(goc: string, ten: string): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) di(p);
      else if (e === ten) ra.push(p);
    }
  };
  di(goc);
  return ra;
}

function doc(p: string): string {
  return readFileSync(p, 'utf8');
}

// ===========================================================================
header('1 — Trang: mọi page.tsx trong khu vực đăng nhập phải có chốt quyền');
// ===========================================================================
{
  const trang = tim('app', 'page.tsx');

  /*
   * Trang NGOÀI khu đăng nhập không cần chốt: đăng nhập, đăng ký, chờ duyệt, đổi mật
   * khẩu, trang gốc. Liệt kê tường minh thay vì đoán theo đường dẫn — thêm một trang
   * công khai mới phải là một quyết định có ý thức, không phải hệ quả của một mẫu khớp.
   */
  const CONG_KHAI = new Set(
    [
      'app/page.tsx',
      'app/login/page.tsx',
      'app/register/page.tsx',
      'app/pending/page.tsx',
      'app/change-password/page.tsx',
    ].map((x) => path.normalize(x)),
  );

  let thieu = 0;
  for (const t of trang) {
    const rel = path.normalize(t);
    if (CONG_KHAI.has(rel)) continue;

    const s = doc(t);
    const coChot =
      s.includes('requirePagePermission(') || s.includes('requireUser(') || s.includes('getCurrentUser(');
    if (!coChot) {
      thieu++;
      console.log(`        THIẾU CHỐT: ${rel}`);
    }
  }

  check(thieu === 0, `${trang.length} trang · ${CONG_KHAI.size} công khai · tất cả còn lại có chốt`);
}

// ===========================================================================
header('2 — Server action: mọi hàm export trong file "use server" phải có chốt');
// ===========================================================================
{
  const nguon: string[] = [];
  const di = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) di(p);
      else if (e.endsWith('.ts')) nguon.push(p);
    }
  };
  di('src');

  const fileAction = nguon.filter((p) => doc(p).startsWith("'use server'"));
  let tongAction = 0;
  let thieu = 0;

  for (const f of fileAction) {
    const s = doc(f);

    /*
     * Cắt theo từng hàm export để kiểm CHỐT NẰM TRONG CHÍNH HÀM ĐÓ. Tìm chuỗi trên cả
     * file sẽ cho một hàm không có chốt "mượn" chốt của hàm bên cạnh — đúng kiểu lỗ hổng
     * bài kiểm này sinh ra để tìm.
     */
    const viTri = [...s.matchAll(/export async function (\w+)/g)];
    for (let i = 0; i < viTri.length; i++) {
      const m = viTri[i]!;
      const dau = m.index!;
      const cuoi = i + 1 < viTri.length ? viTri[i + 1]!.index! : s.length;
      const than = s.slice(dau, cuoi);
      const ten = m[1]!;

      tongAction++;

      const coChot =
        than.includes('requirePermission(') ||
        than.includes('requireUser(') ||
        than.includes('requirePagePermission(');

      if (!coChot) {
        thieu++;
        console.log(`        THIẾU CHỐT: ${path.normalize(f)} → ${ten}()`);
      }
    }
  }

  check(
    thieu === 0,
    `${fileAction.length} file 'use server' · ${tongAction} hàm export · tất cả có chốt`,
  );
}

// ===========================================================================
header('3 — API route');
// ===========================================================================
{
  const routes = tim(path.join('app', 'api'), 'route.ts');

  for (const r of routes) {
    const s = doc(r);
    const rel = path.normalize(r);

    const coPhien = s.includes('getCurrentUser(') || s.includes('requireUser(');
    const coToken = /INGEST_TOKEN|CRON_SECRET|API_KEY/.test(s);
    const co401 = s.includes('401');
    const co403 = s.includes('403');

    check(
      (coPhien && co401) || coToken,
      `${rel}`,
      coToken ? 'token máy-với-máy' : `phiên+401${co403 ? '+403' : ''}`,
    );
  }
}

// ===========================================================================
header('4 — Phạm vi dữ liệu: trang đọc tiền phải đi qua applyScope');
// ===========================================================================
{
  const trang = tim('app', 'page.tsx');
  const docTien = trang.filter((t) => {
    const s = doc(t);
    return /computePortfolioSummary|computePositions|computeCash|computeTeamPerformance/.test(s);
  });

  let thieu = 0;
  for (const t of docTien) {
    const s = doc(t);
    const rel = path.normalize(t);

    /*
     * `/members/[id]` và `/profile` lọc theo `userId` của chính người được xem chứ không
     * theo nhóm — chúng có chốt riêng (`isSelf`/`sameTeam`) nên không đòi `applyScope`.
     */
    const tuLoc = /isSelf|sameTeam|userId: (person|user)\.id/.test(s);
    if (s.includes('applyScope(') || tuLoc) continue;

    thieu++;
    console.log(`        KHÔNG THẤY applyScope: ${rel}`);
  }

  check(thieu === 0, `${docTien.length} trang đọc số tiền · tất cả có ép phạm vi`);
}

// ===========================================================================
header('5 — Phiên đăng nhập');
// ===========================================================================
{
  const s = doc(path.join('src', 'auth', 'session.ts'));

  check(s.includes('httpOnly: true'), 'cookie httpOnly — JavaScript không đọc được token');
  check(/sameSite:\s*'(lax|strict)'/.test(s), 'cookie sameSite chặn gửi kèm từ site khác');
  check(s.includes('secure:'), 'cookie có cấu hình secure');
  check(s.includes('hashToken'), 'token lưu dạng BĂM, không lưu nguyên văn');
  check(s.includes('timingSafeEqual'), 'so sánh chống timing attack');
  check(s.includes('revokedAt'), 'có cơ chế thu hồi phiên');
  check(s.includes('expiresAt'), 'phiên có hạn dùng');
}

// ===========================================================================
header('6 — Mật khẩu');
// ===========================================================================
{
  const s = doc(path.join('src', 'auth', 'password.ts'));

  check(/bcrypt|argon2|scrypt/.test(s), 'dùng hàm băm chuyên cho mật khẩu');
  const rounds = s.match(/,\s*(\d{1,2})\s*\)/)?.[1];
  check(Number(rounds ?? 0) >= 10, `số vòng băm đủ lớn`, `${rounds ?? '?'} vòng`);

  // Không được có mật khẩu nào ghi thẳng trong mã nguồn.
  const nguon = tim('src', 'actions.ts').concat(tim('app', 'page.tsx'));
  const loMatKhau = nguon.filter((f) =>
    /password\s*[:=]\s*['"][^'"]{6,}['"]/i.test(doc(f)),
  );
  check(loMatKhau.length === 0, 'không có mật khẩu ghi cứng trong mã nguồn', loMatKhau.join(', '));
}

// ===========================================================================
header('7 — Bí mật và cấu hình');
// ===========================================================================
{
  const gitignore = doc('.gitignore');
  check(/^\.env$/m.test(gitignore), '.env bị git bỏ qua');
  check(/prisma\/\*\.db/.test(gitignore), 'database bị git bỏ qua');

  // Không được có khoá API ghi cứng.
  const tatCa = [...tim('src', 'actions.ts'), ...tim('app', 'route.ts')];
  const nghiNgo = tatCa.filter((f) => /(sk-|AKIA|-----BEGIN)/.test(doc(f)));
  check(nghiNgo.length === 0, 'không có khoá bí mật ghi cứng', nghiNgo.join(', '));
}

// ===========================================================================
header('8 — Nhật ký kiểm toán: hành động ghi dữ liệu phải để lại dấu vết');
// ===========================================================================
{
  const nguon: string[] = [];
  const di = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) di(p);
      else if (e.endsWith('.ts')) nguon.push(p);
    }
  };
  di('src');

  const fileAction = nguon.filter((p) => doc(p).startsWith("'use server'"));
  let thieu = 0;
  let tong = 0;

  for (const f of fileAction) {
    const s = doc(f);
    const viTri = [...s.matchAll(/export async function (\w+)/g)];

    for (let i = 0; i < viTri.length; i++) {
      const m = viTri[i]!;
      const than = s.slice(m.index!, i + 1 < viTri.length ? viTri[i + 1]!.index! : s.length);
      const ten = m[1]!;

      // Chỉ xét hàm THAY ĐỔI dữ liệu.
      const ghi = /prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)/.test(than);
      if (!ghi) continue;

      tong++;
      if (!than.includes('writeAudit(')) {
        thieu++;
        console.log(`        KHÔNG GHI NHẬT KÝ: ${path.normalize(f)} → ${ten}()`);
      }
    }
  }

  check(thieu === 0, `${tong} action ghi dữ liệu · tất cả có writeAudit`);
}

// ===========================================================================
console.log(`\n${'='.repeat(88)}`);
console.log(` KẾT QUẢ: ${ok} đạt · ${canXem} cần xem lại`);
if (canhBao.length > 0) {
  console.log('\n Cần xem lại:');
  for (const c of canhBao) console.log(`   • ${c}`);
}
console.log('='.repeat(88));

if (canXem > 0) process.exitCode = 1;
