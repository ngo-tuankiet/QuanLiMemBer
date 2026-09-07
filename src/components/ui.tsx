/**
 * Các thành phần hiển thị dùng chung.
 * Toàn bộ là Server Component — không có state, không cần 'use client'.
 */

import type { ReactNode } from 'react';
import {
  USER_STATUS,
  USER_STATUS_LABEL_VI,
  ROLE_LABEL_VI,
  TRADE_STATUS_LABEL_VI,
  type RoleCode,
  type TradeStatus,
} from '@/lib/enums';

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Tag className={`rounded-xl border border-ink-700 bg-ink-900 ${className}`}>{children}</Tag>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-strong">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    [USER_STATUS.ACTIVE]: 'border-up-500/30 bg-up-500/10 text-up-500',
    [USER_STATUS.PENDING]: 'border-warn-500/30 bg-warn-500/10 text-warn-500',
    [USER_STATUS.SUSPENDED]: 'border-down-500/30 bg-down-500/10 text-down-500',
    [USER_STATUS.REJECTED]: 'border-ink-600 bg-ink-800 text-slate-muted',
  };
  const label = USER_STATUS_LABEL_VI[status as keyof typeof USER_STATUS_LABEL_VI] ?? status;

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? 'border-ink-600 bg-ink-800 text-slate-muted'
      }`}
    >
      {label}
    </span>
  );
}

export function RoleBadge({ roleCode }: { roleCode: string | null }) {
  if (!roleCode) {
    return (
      <span className="inline-flex items-center rounded-md border border-dashed border-ink-600 px-2 py-0.5 text-xs text-slate-muted">
        chưa gán
      </span>
    );
  }

  const styles: Record<string, string> = {
    ADMIN: 'border-ceiling-500/30 bg-ceiling-500/10 text-ceiling-500',
    SENIOR_MANAGER: 'border-accent-500/30 bg-accent-500/10 text-accent-400',
    TEAM_MANAGER: 'border-warn-500/30 bg-warn-500/10 text-warn-500',
    EXECUTION: 'border-up-500/25 bg-up-500/10 text-up-500',
    SUPPORTING_EXECUTION: 'border-ink-500 bg-ink-800 text-slate-soft',
    MEMBER: 'border-ink-600 bg-ink-850 text-slate-muted',
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
        styles[roleCode] ?? 'border-ink-600 bg-ink-800 text-slate-muted'
      }`}
      title={roleCode}
    >
      {ROLE_LABEL_VI[roleCode as RoleCode] ?? roleCode}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
      <p className="text-sm font-medium text-slate-soft">{title}</p>
      {hint ? <p className="max-w-md text-xs text-slate-muted">{hint}</p> : null}
    </div>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  placeholder,
  autoComplete,
  errors,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  autoComplete?: string;
  errors?: string[];
  hint?: string;
}) {
  const invalid = Boolean(errors?.length);
  return (
    <div>
      <label htmlFor={name} className="field-label">
        {label}
        {required ? <span className="ml-1 text-down-500">*</span> : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className={`field ${invalid ? 'border-down-500' : ''}`}
      />
      {hint && !invalid ? (
        <p id={`${name}-hint`} className="mt-1 text-xs text-slate-muted">
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p id={`${name}-error`} className="mt-1 text-xs text-down-500">
          {errors!.join(' ')}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  required,
  errors,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  /** `readonly` để nhận được cả hằng số khai báo `as const` / `readonly[]`. */
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  required?: boolean;
  errors?: string[];
  placeholder?: string;
  hint?: string;
}) {
  const invalid = Boolean(errors?.length);
  return (
    <div>
      <label htmlFor={name} className="field-label">
        {label}
        {required ? <span className="ml-1 text-down-500">*</span> : null}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ''}
        aria-invalid={invalid}
        className={`field ${invalid ? 'border-down-500' : ''}`}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && !invalid ? <p className="mt-1 text-xs text-slate-muted">{hint}</p> : null}
      {invalid ? <p className="mt-1 text-xs text-down-500">{errors!.join(' ')}</p> : null}
    </div>
  );
}

/** Nhãn cho các mục menu thuộc phase chưa triển khai. */
export function PhaseTag({ phase }: { phase: string }) {
  return (
    <span className="ml-auto rounded border border-ink-600 px-1.5 py-px text-micro font-medium tracking-wide text-slate-muted">
      {phase}
    </span>
  );
}

/** Nhãn trạng thái giao dịch. Dùng ở danh sách, chi tiết, và hàng chờ duyệt. */
export function TradeStatusChip({ status }: { status: TradeStatus }) {
  const tones: Record<TradeStatus, string> = {
    DRAFT: 'border-ink-600 bg-ink-800 text-slate-muted',
    PENDING_APPROVAL: 'border-warn-500/30 bg-warn-500/10 text-warn-500',
    APPROVED: 'border-accent-500/30 bg-accent-500/10 text-accent-400',
    EXECUTED: 'border-up-500/30 bg-up-500/10 text-up-500',
    REJECTED: 'border-down-500/30 bg-down-500/10 text-down-500',
    CANCELLED: 'border-ink-600 bg-ink-850 text-ink-500',
  };
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-tiny font-medium ${tones[status]}`}
    >
      {TRADE_STATUS_LABEL_VI[status]}
    </span>
  );
}

/** Nhãn MUA / BÁN theo quy ước màu bảng giá Việt Nam. */
export function TradeTypeChip({ type }: { type: string }) {
  return (
    <span
      className={`rounded px-1.5 py-px text-tiny font-semibold ${
        type === 'BUY' ? 'bg-up-500/15 text-up-500' : 'bg-down-500/15 text-down-500'
      }`}
    >
      {type}
    </span>
  );
}
