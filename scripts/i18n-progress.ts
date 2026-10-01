/**
 * CÒN BAO NHIÊU CHỮ CHƯA QUA TỪ ĐIỂN?
 *
 * Dịch 72 file không xong trong một lượt, nên câu hỏi thật không phải "đã dịch chưa"
 * mà là "còn bao nhiêu, ở đâu". Không đo được thì việc này sẽ dừng giữa chừng mà
 * không ai biết nửa nào còn lại.
 *
 * BẢN ĐẦU CHỈ ĐẾM CHỮ TIẾNG VIỆT — VÀ ĐÓ LÀ MỘT LỖ HỔNG THẬT.
 *
 * App này vốn lẫn hai thứ tiếng: menu tiếng Anh, nội dung tiếng Việt. Một bộ đếm chỉ
 * nhìn dấu tiếng Việt sẽ báo "Dashboard đã sạch" trong khi ba tiêu đề thẻ vẫn ghi cứng
 * "Sector Exposure", "Risk & Alerts", "Strategy Allocation" — hiện y như vậy ở CẢ HAI
 * chế độ. Người dùng nhìn thấy ngay điều mà bộ đếm không thấy.
 *
 * Trong một app song ngữ, chuỗi tiếng Anh ghi cứng sai đúng bằng chuỗi tiếng Việt ghi
 * cứng. Nên nay đếm HAI THỨ:
 *
 *   A. Chuỗi trong các thuộc tính giao diện (`title=`, `label=`, `hint=`…). Đây là
 *      phép đo CHÍNH XÁC — không phụ thuộc ngôn ngữ, gần như không báo nhầm.
 *   B. Dòng có ký tự tiếng Việt có dấu, ngoài chú thích. Đây là ƯỚC LƯỢNG cho phần
 *      chữ nằm thẳng trong JSX.
 *
 * Cả hai đều không bắt được: chuỗi tiếng Việt KHÔNG DẤU, và chữ tiếng Anh nằm thẳng
 * trong JSX (`<span>Save</span>`) — muốn bắt cái sau thì phải phân tích cú pháp JSX
 * thật, không phải so chuỗi. Nói ra giới hạn là cố ý: một con số xấp xỉ mà được đọc
 * như con số chính xác sẽ khiến người ta tin là xong khi chưa xong.
 *
 * Chỉ đọc. Dùng: npm run i18n:progress
 */

import fs from 'node:fs';
import path from 'node:path';

const CO_DAU =
  /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯ]/;

/**
 * Thuộc tính mang chữ NGƯỜI DÙNG ĐỌC. Một chuỗi literal ở đây là chưa dịch, bất kể
 * ngôn ngữ nào.
 *
 * `aria-label` và `title` cũng tính: trình đọc màn hình và tooltip cũng là giao diện.
 */
const THUOC_TINH_CHU =
  /\b(title|label|sub|subtitle|hint|hrefLabel|placeholder|centerLabel|aria-label|emptyText)="[^"]{2,}"/;

/** Thư mục chứa giao diện. Không quét `src/i18n` — đó chính là từ điển. */
const GOC = ['app', 'src'];
const BO_QUA = ['src/i18n', 'node_modules', '.next', '.next-build'];

interface Dem {
  thuocTinh: number;
  tiengViet: number;
}

/** Đếm ngoài chú thích, có theo dõi cả khối chú thích nhiều dòng. */
function dem(dong: readonly string[]): Dem {
  let trongKhoi = false;
  const ra: Dem = { thuocTinh: 0, tiengViet: 0 };

  for (const d of dong) {
    const t = d.trim();

    if (trongKhoi) {
      if (t.includes('*/')) trongKhoi = false;
      continue;
    }

    const dong1 = t.startsWith('//');
    const mo = t.indexOf('/*');
    if (!dong1 && mo >= 0 && t.indexOf('*/', mo) < 0) trongKhoi = true;
    if (dong1 || mo === 0 || t.startsWith('{/*')) continue;

    if (THUOC_TINH_CHU.test(d)) ra.thuocTinh += 1;
    else if (CO_DAU.test(d)) ra.tiengViet += 1;
  }

  return ra;
}

function quet(thuMuc: string, ra: string[]): void {
  for (const ten of fs.readdirSync(thuMuc)) {
    const duong = path.join(thuMuc, ten).replace(/\\/g, '/');
    if (BO_QUA.some((b) => duong.startsWith(b))) continue;
    const st = fs.statSync(duong);
    if (st.isDirectory()) quet(duong, ra);
    else if (duong.endsWith('.tsx')) ra.push(duong);
  }
}

const files: string[] = [];
for (const g of GOC) if (fs.existsSync(g)) quet(g, files);

const ketQua: { file: string; d: Dem; tong: number }[] = [];
let tongThuocTinh = 0;
let tongTiengViet = 0;

for (const f of files) {
  const d = dem(fs.readFileSync(f, 'utf8').split(/\r?\n/));
  const tong = d.thuocTinh + d.tiengViet;
  if (tong > 0) ketQua.push({ file: f, d, tong });
  tongThuocTinh += d.thuocTinh;
  tongTiengViet += d.tiengViet;
}

ketQua.sort((a, b) => b.tong - a.tong);

console.log('');
console.log('='.repeat(80));
console.log(' CHỮ CHƯA QUA TỪ ĐIỂN');
console.log('='.repeat(80));
console.log(
  ` ${files.length} file .tsx · ${ketQua.length} file còn chữ · ${tongThuocTinh + tongTiengViet} dòng`,
);
console.log(`   ${String(tongThuocTinh).padStart(4)} thuộc tính giao diện (đo chính xác, mọi ngôn ngữ)`);
console.log(`   ${String(tongTiengViet).padStart(4)} dòng chữ tiếng Việt trong JSX (ước lượng)`);
console.log('');
console.log('  thuộc-tính  tiếng-Việt  file');

for (const r of ketQua.slice(0, 20)) {
  console.log(
    `  ${String(r.d.thuocTinh).padStart(10)}  ${String(r.d.tiengViet).padStart(10)}  ${r.file}`,
  );
}
if (ketQua.length > 20) console.log(`  … còn ${ketQua.length - 20} file nữa`);

console.log('');
console.log(` Đã sạch: ${files.length - ketQua.length}/${files.length} file`);
console.log('');
console.log(' KHÔNG bắt được: chuỗi tiếng Việt không dấu, và chữ tiếng Anh nằm thẳng');
console.log(' trong JSX. Chốt chắc chắn duy nhất là `npm run typecheck`: thiếu khoá');
console.log(' trong en.ts là lỗi biên dịch.');
console.log('');
