import { Quantity } from '@/components/money';
import { BROKER, BROKER_LABEL_VI, type Broker } from '@/lib/enums';
import type { HoldingByAccount } from '@/domain/portfolio-engine';

/**
 * VỊ THẾ CỦA MỘT MÃ ĐANG NẰM Ở NHỮNG TÀI KHOẢN NÀO.
 *
 * Dùng chung cho bảng vị thế ở `/portfolio/positions` và ở trang cá nhân — hai bảng
 * trả lời cùng một câu hỏi thì phải trả lời giống hệt nhau. Dán hai lần thì sớm muộn
 * một bên hiện tên sàn còn bên kia hiện số tài khoản.
 *
 * CHỈ HIỆN KHỐI LƯỢNG KHI CÓ TỪ HAI TÀI KHOẢN TRỞ LÊN. Một tài khoản thì khối lượng
 * của nó đúng bằng cột "Khối lượng" ngay bên cạnh, và in lại con số đó chỉ làm mắt
 * phải kiểm tra xem hai số có khác nhau không — một việc vô ích lặp trên mọi dòng.
 */
export function HoldingAccounts({
  accounts,
  className = '',
}: {
  accounts: HoldingByAccount[] | undefined;
  className?: string;
}) {
  if (!accounts || accounts.length === 0) {
    return <span className={`text-tiny text-ink-500 ${className}`}>—</span>;
  }

  const nhieu = accounts.length > 1;

  return (
    <span className={`flex flex-col gap-0.5 ${className}`}>
      {accounts.map((a) => (
        <span key={a.brokerAccountId ?? '__none__'} className="flex items-baseline gap-1.5">
          {a.brokerAccountId === null ? (
            /*
              LỆNH CHƯA GẮN TÀI KHOẢN — nói thẳng, không gộp vào một tài khoản nào.
              Đây là dữ liệu có trước khi trường tài khoản thành bắt buộc. Gán bừa
              nó cho tài khoản đầu tiên sẽ tạo ra một con số trông đúng mà sai.
            */
            <span
              className="text-tiny text-warn-500"
              title="Lệnh cũ chưa gắn tài khoản chứng khoán nào"
            >
              chưa gắn TK
            </span>
          ) : (
            <span className="text-tiny text-slate-soft">
              <span className="text-slate-muted">{tenSan(a)}</span>
              <span className="font-mono"> · {a.accountNo}</span>
            </span>
          )}
          {nhieu ? (
            <Quantity value={a.quantity} className="tabular text-tiny text-ink-500" />
          ) : null}
        </span>
      ))}
    </span>
  );
}

function tenSan(a: HoldingByAccount): string {
  if (a.broker === BROKER.OTHER) return a.brokerOther ?? 'Khác';
  return BROKER_LABEL_VI[a.broker as Broker] ?? a.broker;
}
