/**
 * Kiểu biểu phí dùng chung cho CẢ server và client.
 *
 * Phải nằm riêng khỏi `fee-rates.ts`: file đó có `import 'server-only'` nên form nhập
 * lệnh (Client Component) import vào sẽ lỗi build. Cùng lý do và cùng cách làm với
 * `components/theme.shared.ts`.
 */

export interface TradeRates {
  buyFeeRateBps: number;
  sellFeeRateBps: number;
  sellTaxRateBps: number;
}
