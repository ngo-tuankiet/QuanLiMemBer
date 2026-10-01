'use client';

import { useEffect, useState } from 'react';
import { addStockAction, suggestStockInfoAction, type GoiYThemMa } from '@/market/actions';
import { ActionForm, FormMessage, SubmitButton, type ActionState } from '@/components/ActionForm';
import { Field, Select } from '@/components/ui';

export interface NganhChon {
  id: string;
  nameVi: string;
  phanNganh: { id: string; nameVi: string }[];
}

/** Dạng mã hợp lệ — giống hệt phép kiểm ở server, để không gọi nguồn một cách vô ích. */
const DANG_MA = /^[A-Z0-9]{3,10}$/;

/** Chờ người dùng gõ xong mới gọi nguồn. Mỗi lần gọi là 25–40 giây của máy chủ. */
const CHO_GO_MS = 700;

/**
 * THÊM MỘT MÃ VÀO DANH MỤC CHUẨN.
 *
 * Đứng ngay dưới ô "Lấy giá theo mã" vì đó là chỗ người dùng đụng tường: gõ một mã
 * ngoài danh mục thì bị từ chối theo §7, và câu trả lời cho "vậy làm sao" phải nằm
 * ngay bên dưới câu từ chối, không nằm ở một trang khác.
 *
 * PHÂN NGÀNH LỌC THEO NGÀNH ĐANG CHỌN. Danh mục có hơn 50 phân ngành; đổ hết vào một
 * ô chọn thì người dùng phải tự biết phân ngành nào thuộc ngành nào, và ghép sai cặp
 * là chuyện gần như chắc chắn. Lọc ở đây là để dễ dùng — phép kiểm thật nằm ở server,
 * vì ô chọn của trình duyệt không chặn được một request tự gửi.
 */
export function AddStockForm({ nganh }: { nganh: NganhChon[] }) {
  return (
    <ActionForm action={addStockAction} className="space-y-3">
      {(state) => <ThanForm state={state} nganh={nganh} />}
    </ActionForm>
  );
}

/**
 * Tách ra làm component riêng vì nó CẦN HOOK.
 *
 * `ActionForm` gọi `children(state)` trong lúc render của chính nó, nên hook viết
 * trong callback đó sẽ gắn vào `ActionForm` — số lượng hook của một component phải
 * cố định giữa các lần render, và đây là cách để điều đó không phụ thuộc vào việc
 * `ActionForm` gọi callback bao nhiêu lần.
 */
function ThanForm({ state, nganh }: { state: ActionState | null; nganh: NganhChon[] }) {
  const [ma, setMa] = useState('');
  const [ten, setTen] = useState('');
  const [san, setSan] = useState('');
  const [idNganh, setIdNganh] = useState('');
  const [idPhanNganh, setIdPhanNganh] = useState('');

  /** Mã đang được tra — chuỗi rỗng là "không tra gì". */
  const [dangTra, setDangTra] = useState('');
  /** Kết quả tra, KÈM MÃ nó thuộc về. Xem `cuaMaNay` bên dưới. */
  const [ketQua, setKetQua] = useState<{
    ma: string;
    goiY: GoiYThemMa | null;
    loi: string;
  } | null>(null);

  const maChuan = ma.trim().toUpperCase();
  const phanNganh = nganh.find((n) => n.id === idNganh)?.phanNganh ?? [];

  /*
   * THÊM XONG THÌ DỌN Ô, để cú bấm tiếp theo không ghi trùng chính mã vừa thêm.
   *
   * Điều chỉnh state NGAY TRONG LÚC RENDER, không dùng `useEffect`. Đây là cách React
   * chỉ dẫn cho việc "đổi state khi prop đổi": React thấy state mới trước khi kịp vẽ
   * ra màn hình, nên không có một khung hình nào hiện ô cũ. Làm bằng effect thì vẽ
   * một lần với dữ liệu cũ rồi vẽ lại — và `react-hooks/set-state-in-effect` báo lỗi
   * đúng chỗ đó.
   */
  const [stateTruoc, setStateTruoc] = useState(state);
  if (state !== stateTruoc) {
    setStateTruoc(state);
    if (state?.ok) {
      setMa('');
      setTen('');
      setSan('');
      setIdNganh('');
      setIdPhanNganh('');
      setKetQua(null);
      setDangTra('');
    }
  }

  /*
   * GỌI NGUỒN SAU KHI NGƯỜI DÙNG NGỪNG GÕ.
   *
   * Gõ "SCS" là ba lần đổi state; gọi ngay mỗi lần là ba tiến trình Python cho một
   * mã, mà hai trong ba là cho mã chưa gõ xong ("S", "SC").
   *
   * `huy` CHẶN CÂU TRẢ LỜI CŨ ghi vào state. Gõ SCS rồi sửa thành FPT: hai lời gọi
   * chạy song song và không có gì bảo đảm chúng về đúng thứ tự.
   */
  useEffect(() => {
    if (!DANG_MA.test(maChuan)) return;

    let huy = false;
    const hen = setTimeout(async () => {
      if (huy) return;
      setDangTra(maChuan);
      try {
        const kq = await suggestStockInfoAction(maChuan);
        if (huy) return;
        setKetQua({
          ma: maChuan,
          goiY: kq.ok ? kq.goiY : null,
          loi: kq.ok ? '' : kq.message,
        });
      } catch {
        if (!huy) {
          setKetQua({
            ma: maChuan,
            goiY: null,
            loi: 'Không gọi được VNStock. Vẫn nhập tay được đầy đủ.',
          });
        }
      } finally {
        if (!huy) setDangTra('');
      }
    }, CHO_GO_MS);

    return () => {
      huy = true;
      clearTimeout(hen);
    };
  }, [maChuan]);

  /*
   * CHỈ HIỆN KẾT QUẢ CỦA ĐÚNG MÃ ĐANG NẰM TRONG Ô.
   *
   * Suy ra khi render thay vì xoá bằng effect. Người dùng xoá một ký tự thì gợi ý cũ
   * tự biến mất ngay trong khung hình đó — không cần ai đi dọn, nên cũng không có
   * khung hình nào hiện gợi ý của một mã đã bị sửa.
   */
  const cuaMaNay = ketQua && ketQua.ma === maChuan ? ketQua : null;

  /*
   * PHẢI SO CẢ "CÓ ĐANG TRA GÌ KHÔNG", không chỉ so hai chuỗi bằng nhau.
   *
   * `dangTra === maChuan` là ĐÚNG khi cả hai đều rỗng — tức là form vừa mở, chưa ai
   * gõ gì, không có lời gọi nào chạy — và ô "Đang tra VNStock…" hiện ngay lúc đó.
   * Lỗi này đã xảy ra thật và thấy được ngay trên trang: vòng xoay chờ nằm sẵn dưới
   * một cái form trắng.
   */
  const dangTraMaNay = dangTra !== '' && dangTra === maChuan;

  const goiY = cuaMaNay?.goiY ?? null;

  /** Đặt phân ngành thì đặt luôn ngành của nó — ô phân ngành lọc theo ngành. */
  const dungPhanNganh = (id: string, idNganhCuaNo: string) => {
    setIdNganh(idNganhCuaNo);
    setIdPhanNganh(id);
  };

  const dungTatCa = () => {
    if (!goiY) return;
    setTen(goiY.tenCongTy);
    if (goiY.san) setSan(goiY.san);
    /*
     * Phân ngành đi trước: nó mang theo ngành của chính nó, và cặp đó là cặp đã được
     * kiểm ở server. Lấy ngành từ `goiY.nganh` rồi phân ngành từ chỗ khác là cách tạo
     * ra cặp lệch — đúng thứ `addStockAction` từ chối.
     */
    if (goiY.phanNganh) {
      setIdNganh(goiY.phanNganh.idNganh);
      setIdPhanNganh(goiY.phanNganh.id);
    } else if (goiY.nganh) {
      setIdNganh(goiY.nganh.id);
      setIdPhanNganh('');
    }
  };

  return (
    <>
      <FormMessage state={state} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Mã"
          name="symbol"
          required
          placeholder="SCS"
          value={ma}
          onChange={(e) => setMa(e.target.value.toUpperCase())}
          errors={state?.fieldErrors?.symbol}
        />
        <div className="lg:col-span-2">
          <Field
            label="Tên công ty"
            name="companyName"
            required
            placeholder="CTCP Dịch vụ Hàng hoá Sài Gòn"
            value={ten}
            onChange={(e) => setTen(e.target.value)}
            errors={state?.fieldErrors?.companyName}
          />
        </div>
        <Select
          label="Sàn niêm yết"
          name="exchange"
          required
          placeholder="Chọn sàn"
          value={san}
          onChange={(e) => setSan(e.target.value)}
          options={[
            { value: 'HOSE', label: 'HOSE' },
            { value: 'HNX', label: 'HNX' },
            { value: 'UPCOM', label: 'UPCOM' },
          ]}
          errors={state?.fieldErrors?.exchange}
        />
        <Select
          label="Ngành"
          name="sectorId"
          required
          placeholder="Chọn ngành"
          value={idNganh}
          onChange={(e) => {
            setIdNganh(e.target.value);
            // Phân ngành cũ thuộc ngành cũ — giữ lại là gửi lên một cặp sai.
            setIdPhanNganh('');
          }}
          options={nganh.map((n) => ({ value: n.id, label: n.nameVi }))}
          errors={state?.fieldErrors?.sectorId}
        />
        <Select
          label="Phân ngành"
          name="industryId"
          required
          placeholder={idNganh ? 'Chọn phân ngành' : 'Chọn ngành trước'}
          value={idPhanNganh}
          onChange={(e) => setIdPhanNganh(e.target.value)}
          options={phanNganh.map((p) => ({ value: p.id, label: p.nameVi }))}
          errors={state?.fieldErrors?.industryId}
        />
      </div>

      <KhoiGoiY
        dangTra={dangTraMaNay}
        loiTra={cuaMaNay?.loi ?? ''}
        goiY={goiY}
        onDungTen={(v) => setTen(v)}
        onDungSan={(v) => setSan(v)}
        onDungNganh={(id) => {
          setIdNganh(id);
          setIdPhanNganh('');
        }}
        onDungPhanNganh={dungPhanNganh}
        onDungTatCa={dungTatCa}
      />

      <SubmitButton>Thêm mã rồi lấy giá</SubmitButton>
    </>
  );
}

/**
 * KHỐI GỢI Ý TỪ VNSTOCK.
 *
 * GỢI Ý, KHÔNG ĐIỀN — đúng yêu cầu của người dùng, và có lý do kỹ thuật đứng sau:
 * nguồn xếp ngành sai một cách rất thuyết phục. Đo được trên chính mã SCS trong ví
 * dụ: ICB cấp 3 xếp nó vào "Du lịch & Giải trí". Một ô đã điền sẵn thì không ai đọc
 * lại; một dòng gợi ý phải đọc mới bấm được.
 *
 * Mỗi dòng có nút "dùng" riêng, và có nút "Dùng tất cả" cho trường hợp gợi ý đã
 * đúng hết. Không có đường nào tự đặt giá trị vào ô mà thiếu một cú bấm.
 */
function KhoiGoiY({
  dangTra,
  loiTra,
  goiY,
  onDungTen,
  onDungSan,
  onDungNganh,
  onDungPhanNganh,
  onDungTatCa,
}: {
  dangTra: boolean;
  loiTra: string;
  goiY: GoiYThemMa | null;
  onDungTen: (v: string) => void;
  onDungSan: (v: string) => void;
  onDungNganh: (id: string) => void;
  onDungPhanNganh: (id: string, idNganh: string) => void;
  onDungTatCa: () => void;
}) {
  if (dangTra) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-muted" role="status">
        <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Đang tra VNStock…
      </p>
    );
  }

  if (loiTra) {
    return (
      <p className="text-xs text-warn-500" role="status">
        {loiTra}
      </p>
    );
  }

  if (!goiY) return null;

  /*
   * Rút ra biến cục bộ để không phải viết `goiY.nganh!` trong JSX. Dấu `!` ở đây sẽ
   * là lời hứa suông: `goiY` là prop, TypeScript không biết nó không đổi giữa lúc
   * kiểm và lúc dùng, và một ngày nào đó nó đúng là đổi.
   */
  const { san: gySan, nganh: gyNganh, phanNganh: gyPhanNganh } = goiY;

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800/40 p-3" role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-slate-soft">
          VNStock gợi ý cho {goiY.symbol}
          {goiY.nhomIcb ? <span className="text-slate-muted"> · {goiY.nhomIcb}</span> : null}
        </p>
        <button
          type="button"
          onClick={onDungTatCa}
          className="rounded border border-ink-500 px-2 py-0.5 text-xs text-slate-soft transition hover:border-accent-500 hover:text-strong"
        >
          Dùng tất cả
        </button>
      </div>

      <dl className="mt-2 space-y-1.5">
        <DongGoiY nhan="Tên công ty" giaTri={goiY.tenCongTy} onDung={() => onDungTen(goiY.tenCongTy)} />
        {gySan ? (
          <DongGoiY nhan="Sàn niêm yết" giaTri={gySan} onDung={() => onDungSan(gySan)} />
        ) : (
          <DongGoiY nhan="Sàn niêm yết" giaTri={`nguồn ghi "${goiY.sanNguon}"`} />
        )}
        {gyNganh ? (
          <DongGoiY
            nhan="Ngành"
            giaTri={gyNganh.nameVi}
            onDung={() => onDungNganh(gyNganh.id)}
          />
        ) : null}
        {gyPhanNganh ? (
          <DongGoiY
            nhan="Phân ngành"
            giaTri={gyPhanNganh.nameVi}
            onDung={() => onDungPhanNganh(gyPhanNganh.id, gyPhanNganh.idNganh)}
          />
        ) : null}
        {goiY.phanNganhKhac.length > 0 ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <dt className="w-24 shrink-0 text-xs text-slate-muted">
              {gyPhanNganh ? 'Hoặc' : 'Phân ngành'}
            </dt>
            {goiY.phanNganhKhac.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onDungPhanNganh(p.id, p.idNganh)}
                className="rounded border border-ink-500 px-2 py-0.5 text-xs text-slate-soft transition hover:border-accent-500 hover:text-strong"
              >
                {p.nameVi}
                {/*
                 * Ghi kèm ngành khi gợi ý phụ thuộc NGÀNH KHÁC với gợi ý chính. Bấm
                 * nút này đổi luôn ô Ngành, nên phải nói trước — không thì người dùng
                 * thấy ô Ngành tự nhảy sang thứ khác mà không hiểu vì sao.
                 */}
                {gyNganh && p.idNganh !== gyNganh.id ? (
                  <span className="text-slate-muted"> · {p.tenNganh}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </dl>

      {goiY.canhBao.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border-t border-ink-700 pt-2">
          {goiY.canhBao.map((c) => (
            <li key={c} className="text-xs text-warn-500">
              {c}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-xs text-slate-muted">
        Gợi ý chỉ để đối chiếu — kiểm lại trước khi thêm. Phân ngành của nguồn không
        luôn khớp cách phân ngành của danh mục.
      </p>
    </div>
  );
}

function DongGoiY({
  nhan,
  giaTri,
  onDung,
}: {
  nhan: string;
  giaTri: string;
  onDung?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <dt className="w-24 shrink-0 text-xs text-slate-muted">{nhan}</dt>
      <dd className="text-xs text-strong">{giaTri}</dd>
      {onDung ? (
        <button
          type="button"
          onClick={onDung}
          className="rounded border border-ink-500 px-2 py-0.5 text-xs text-slate-soft transition hover:border-accent-500 hover:text-strong"
        >
          dùng
        </button>
      ) : null}
    </div>
  );
}
