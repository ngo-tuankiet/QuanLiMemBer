'use client';

import { createIndustryAction, createSectorAction } from '@/market/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field, Select } from '@/components/ui';

export function SectorForms({ sectors }: { sectors: { id: string; label: string }[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-accent-400">NGÀNH CẤP 1</h3>
        <ActionForm action={createSectorAction} className="space-y-3">
          {(state) => (
            <>
              <FormMessage state={state} />
              <Field
                label="Mã ngành"
                name="code"
                required
                placeholder="UTILITIES"
                hint="Chữ in hoa, số và gạch dưới"
                errors={state?.fieldErrors?.code}
              />
              <Field
                label="Tên tiếng Anh"
                name="name"
                required
                placeholder="Utilities"
                errors={state?.fieldErrors?.name}
              />
              <Field
                label="Tên tiếng Việt"
                name="nameVi"
                required
                placeholder="Tiện ích công cộng"
                hint="Tên này hiện trực tiếp trên Sector Exposure"
                errors={state?.fieldErrors?.nameVi}
              />
              <Field
                label="Màu hiển thị"
                name="colorHex"
                placeholder="#0369a1"
                hint="Dạng #RRGGBB, dùng cho biểu đồ tỷ trọng"
                errors={state?.fieldErrors?.colorHex}
              />
              <SubmitButton>Thêm ngành</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-accent-400">
          PHÂN NGÀNH CẤP 2
        </h3>
        <ActionForm action={createIndustryAction} className="space-y-3">
          {(state) => (
            <>
              <FormMessage state={state} />
              <Select
                label="Thuộc ngành"
                name="sectorId"
                required
                placeholder="Chọn ngành cha"
                options={sectors.map((s) => ({ value: s.id, label: s.label }))}
                errors={state?.fieldErrors?.sectorId}
              />
              <Field
                label="Mã phân ngành"
                name="code"
                required
                placeholder="WATER"
                errors={state?.fieldErrors?.code}
              />
              <Field
                label="Tên tiếng Anh"
                name="name"
                required
                placeholder="Water & Environment"
                errors={state?.fieldErrors?.name}
              />
              <Field
                label="Tên tiếng Việt"
                name="nameVi"
                required
                placeholder="Nước và môi trường"
                errors={state?.fieldErrors?.nameVi}
              />
              <SubmitButton>Thêm phân ngành</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </div>
  );
}
