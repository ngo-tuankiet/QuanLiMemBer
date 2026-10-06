import 'server-only';

/**
 * Ghi `BaoCaoTaiKhoan` ra .xlsx — ĐÚNG BỐ CỤC mẫu `baocaoChungKhoan_2026.xlsx`:
 *
 *   hàng 1      G1:K1 = SUBTOTAL(109, …) — tổng theo bộ lọc của Excel
 *   hàng 2      tiêu đề A:L, và "Bảng vốn" ở N2
 *   hàng 3…     mỗi tài khoản một dòng; bảng vốn (N:Q) chạy song song bên phải
 *
 * Profit, Tỷ lệ sinh lời, Nâng vốn, Cộng gộp và các dòng tổng là CÔNG THỨC, không phải
 * số tính sẵn: người dùng sửa một ô trong Excel thì các ô phụ thuộc tự đổi theo, như
 * trong file mẫu của họ.
 */

import writeXlsxFile, { type Sheet } from 'write-excel-file/node';
import type { BaoCaoTaiKhoan } from '@/reports/account-pnl';

const TIEN = '#,##0;[Red]-#,##0';
const PHAN_TRAM = '0.00%;[Red]-0.00%';
const NGAY = 'dd/mm/yyyy';

type O = Record<string, unknown> | null;

const chu = (value: string, them: Record<string, unknown> = {}): O =>
  value === '' ? null : { value, type: String, ...them };
const so = (value: bigint, them: Record<string, unknown> = {}): O => ({
  value: Number(value),
  type: Number,
  format: TIEN,
  ...them,
});
/**
 * Ô công thức. Viết công thức kèm dấu "=" cho dễ đọc, nhưng BỎ nó trước khi ghi:
 * write-excel-file tự thêm "=", và để nguyên thì Excel nhận "==J3-G3…" — một công thức lỗi.
 */
const cong = (value: string, format = TIEN, them: Record<string, unknown> = {}): O => ({
  value: value.replace(/^=/, ''),
  type: 'Formula',
  format,
  ...them,
});
const ngay = (d: string): O => ({ value: new Date(`${d}T00:00:00.000Z`), type: Date, format: NGAY });

const TIEU_DE = { fontWeight: 'bold', backgroundColor: '#DDEBF7', align: 'center', wrap: true };
const TONG = { fontWeight: 'bold', backgroundColor: '#FFF2CC' };

/** "2026-Thang9" khi kỳ là trọn một tháng, như tên sheet trong mẫu. */
export function tenKy(tu: string, den: string): string {
  const [y, m] = tu.split('-');
  const cuoiThang = new Date(Date.UTC(Number(y), Number(m), 0)).toISOString().slice(0, 10);
  if (tu.endsWith('-01') && den === cuoiThang) return `${y}-Thang${Number(m)}`;
  return `${tu} den ${den}`;
}

export async function ghiAccountPnlXlsx(
  bc: BaoCaoTaiKhoan,
  meta: { nguoiXuat: string; phamVi: string },
): Promise<{ buffer: Buffer; filename: string; sheetName: string }> {
  const n = bc.dong.length;
  const dau = 3;
  const cuoi = Math.max(dau, dau + n - 1);
  const vungG = (c: string) => `${c}${dau}:${c}${cuoi}`;

  const hang: O[][] = [];

  // Hàng 1 — tổng SUBTOTAL(109) như mẫu: lọc trong Excel thì tổng chạy theo.
  const h1: O[] = Array(17).fill(null);
  for (const [i, c] of [[6, 'G'], [7, 'H'], [8, 'I'], [9, 'J'], [10, 'K']] as const) {
    h1[i] = cong(`=SUBTOTAL(109,${vungG(c)})`, TIEN, TONG);
  }
  h1[11] = cong('=IF((G1+H1)=0,"",K1/(G1+H1))', PHAN_TRAM, TONG);
  hang.push(h1);

  // Hàng 2 — tiêu đề.
  const tieuDe = [
    'Nhánh', 'Từ Ngày', 'Đến Ngày', 'Sàn', 'Số Tài Khoản', 'Tên', 'Vốn Ròng Từ Ngày', 'Nộp',
    'Rút', ' Vốn Ròng Đến Ngày', 'Profit', 'Tỷ lệ sinh lời',
  ];
  const h2: O[] = Array(17).fill(null);
  tieuDe.forEach((t, i) => (h2[i] = chu(t, TIEU_DE)));
  h2[13] = chu('Bảng vốn', { fontWeight: 'bold' });
  hang.push(h2);

  // Bảng vốn bên phải: tiêu đề ở hàng 3, người từ hàng 4, Grand Total sau cùng.
  const ben: O[][] = [];
  ben.push([chu('Họ tên', TIEU_DE), chu('Vốn ban đầu', TIEU_DE), chu('Nâng vốn', TIEU_DE), chu('Cộng gộp', TIEU_DE)]);
  bc.vonNguoi.forEach((p, i) => {
    const r = dau + 1 + i;
    ben.push([
      chu(p.ten),
      so(p.vonBanDau),
      cong(`=SUMIFS($H$${dau}:$H$${cuoi},$F$${dau}:$F$${cuoi},N${r})-SUMIFS($I$${dau}:$I$${cuoi},$F$${dau}:$F$${cuoi},N${r})`),
      cong(`=O${r}+P${r}`),
    ]);
  });
  const rTongBen = dau + 1 + bc.vonNguoi.length;
  ben.push([
    chu('Grand Total', TONG),
    cong(`=SUM(O${dau + 1}:O${rTongBen - 1})`, TIEN, TONG),
    cong(`=SUM(P${dau + 1}:P${rTongBen - 1})`, TIEN, TONG),
    cong(`=SUM(Q${dau + 1}:Q${rTongBen - 1})`, TIEN, TONG),
  ]);

  const soHang = Math.max(n, ben.length);
  for (let i = 0; i < soHang; i += 1) {
    const r = dau + i;
    const d = bc.dong[i];
    const row: O[] = Array(17).fill(null);
    if (d) {
      row[0] = chu(d.nhanh);
      row[1] = ngay(bc.tu);
      row[2] = ngay(bc.den);
      row[3] = chu(d.san);
      row[4] = chu(d.soTaiKhoan);
      row[5] = chu(d.ten);
      row[6] = so(d.vonTu);
      row[7] = so(d.nop);
      row[8] = so(d.rut);
      row[9] = so(d.vonDen);
      row[10] = cong(`=J${r}-G${r}-H${r}+I${r}`);
      row[11] = cong(`=IF((G${r}+H${r})=0,"",K${r}/(G${r}+H${r}))`, PHAN_TRAM);
    }
    const b = ben[i];
    if (b) b.forEach((c, j) => (row[13 + j] = c));
    hang.push(row);
  }

  // Sheet ghi chú: cách tính, giá dùng ngày nào, mã thiếu giá.
  const thieu = bc.dong.filter((d) => d.thieuGia.length > 0);
  const ghiChu: O[][] = [
    [chu('Báo cáo vốn & lợi nhuận theo tài khoản', { fontWeight: 'bold' }), null],
    [chu('Kỳ'), chu(`${bc.tu} → ${bc.den}`)],
    [chu('Phạm vi'), chu(meta.phamVi)],
    [chu('Người xuất'), chu(meta.nguoiXuat)],
    [chu('Thời điểm xuất'), chu(new Date().toISOString())],
    [null, null],
    [chu('Cách tính', { fontWeight: 'bold' }), null],
    [chu('Vốn Ròng Từ Ngày'), chu('Tài sản ròng cuối ngày trước "Từ Ngày": cổ phiếu đang giữ × giá đóng cửa + tiền mặt trong tài khoản.')],
    [chu('Vốn Ròng Đến Ngày'), chu('Tài sản ròng cuối ngày "Đến Ngày", cùng cách tính.')],
    [chu('Nộp / Rút'), chu('Nạp / rút vốn đã xác nhận trong kỳ. Cổ tức, lãi tiền gửi không tính là nộp — chúng nằm trong Profit.')],
    [chu('Profit'), chu('= Vốn Ròng Đến Ngày − Vốn Ròng Từ Ngày − Nộp + Rút')],
    [chu('Tỷ lệ sinh lời'), chu('= Profit / (Vốn Ròng Từ Ngày + Nộp); để trống khi mẫu số bằng 0.')],
    [chu('Nhánh'), chu('Nhóm hiện tại của chủ tài khoản.')],
    [chu('Bảng vốn'), chu('Vốn ban đầu = nạp − rút trước kỳ. Nâng vốn = Nộp − Rút trong kỳ (công thức từ bảng chính). Cộng gộp = tổng hai cột.')],
    [chu('Giá đầu kỳ'), chu(bc.ngayGiaTu ? `phiên gần nhất tới ${bc.ngayGiaTu}` : 'không có giá')],
    [chu('Giá cuối kỳ'), chu(bc.ngayGiaDen ? `phiên gần nhất tới ${bc.ngayGiaDen}` : 'không có giá')],
    [null, null],
    [chu('Mã thiếu giá (tính bằng 0)', { fontWeight: 'bold' }), chu(thieu.length === 0 ? 'Không có' : '')],
    ...thieu.map((d) => [chu(`${d.ten} · ${d.san} ${d.soTaiKhoan}`), chu(d.thieuGia.join(', '))]),
  ];

  const sheetName = tenKy(bc.tu, bc.den);
  const sheets = [
    {
      sheet: sheetName,
      stickyRowsCount: 2,
      columns: [
        { width: 12 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 14 }, { width: 24 },
        { width: 17 }, { width: 15 }, { width: 15 }, { width: 18 }, { width: 16 }, { width: 11 },
        { width: 3 }, { width: 24 }, { width: 17 }, { width: 15 }, { width: 17 },
      ],
      data: hang,
    },
    { sheet: 'Ghi chú', columns: [{ width: 30 }, { width: 90 }], data: ghiChu },
  ] as unknown as Sheet<Buffer>[];

  const buffer = await writeXlsxFile(sheets, { fontFamily: 'Arial', fontSize: 10 }).toBuffer();
  return { buffer, filename: `baocaoChungKhoan_${sheetName.replace(/\s+/g, '_')}.xlsx`, sheetName };
}
