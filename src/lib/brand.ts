/**
 * TÊN THƯƠNG HIỆU — MỘT NGUỒN DUY NHẤT.
 *
 * VÌ SAO CÓ FILE NÀY. Tên công ty từng nằm rải rác ở 6 file: logo thanh bên, logo menu
 * di động, ba trang ngoài (đăng nhập / đăng ký / đổi mật khẩu), và tiêu đề tab trình
 * duyệt. Đổi tên một lần phải sửa đủ 6 chỗ — sót một chỗ là giao diện hiện hai tên khác
 * nhau, và người phát hiện ra sẽ là người dùng chứ không phải người sửa.
 *
 * DẠNG CHỮ HOA ĐƯỢC SUY RA, KHÔNG KHAI RIÊNG. Khai hai hằng số `BRAND_NAME` và
 * `BRAND_NAME_UPPER` là lại tạo ra đúng vấn đề vừa giải quyết ở quy mô nhỏ hơn: hai
 * chuỗi có thể lệch nhau. `.toUpperCase()` thì không lệch được.
 *
 * KHÔNG DÙNG CSS `uppercase` THAY THẾ: chữ hoa ở đây là một phần của NỘI DUNG, không
 * phải cách trình bày. Trình đọc màn hình và phần chọn-sao chép của trình duyệt lấy
 * chuỗi thật, nên nó phải đúng dạng ngay trong DOM.
 *
 * `docs/SPEC.md` vẫn viết tên dạng chữ — tài liệu không import được hằng số. Đó là chỗ
 * duy nhất còn phải sửa tay khi đổi tên.
 */

/** Tên công ty, dạng tiêu đề. Dùng cho tiêu đề tab và mọi câu văn xuôi. */
export const BRAND_NAME = 'Ben Thanh Investment';

/** Dòng phụ dưới tên công ty. */
export const BRAND_TAGLINE = 'Executive Control Center';

/** Tên công ty dạng chữ hoa — dùng cho logo. Suy ra từ `BRAND_NAME`, không khai riêng. */
export const BRAND_NAME_UPPER = BRAND_NAME.toUpperCase();
