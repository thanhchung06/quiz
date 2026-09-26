import { Subject } from '../../../shared/models/domain.model';

export interface CategorySuggestion {
  subject: Subject;
  /** Grades (1–5) where this kind of exercise usually appears. */
  grades: number[];
  name: string;
  /** Typical exercise forms, as a hint for whoever writes the questions. */
  examples: string;
}

/**
 * Common primary-school exercise categories (lớp 1–5), following the
 * knowledge strands of the 2018 general-education curriculum (Chương trình
 * GDPT 2018): Toán — Số và phép tính, Hình học và đo lường, Thống kê và xác
 * suất, with word problems woven through each; Tiếng Việt — đọc hiểu, chính
 * tả, luyện từ và câu. Offered in the import templates (JSON
 * `suggestedCategories`, Excel "Danh mục gợi ý" sheet + dropdown) as
 * suggested category names only — any other name still works.
 */
export const CATEGORY_SUGGESTIONS: CategorySuggestion[] = [
  // --- Toán: Số và phép tính ---
  { subject: 'math', grades: [1, 2, 3, 4, 5], name: 'Đọc, viết, so sánh số', examples: 'Đọc/viết số, cấu tạo số (chục, trăm…), so sánh, sắp xếp thứ tự, làm tròn số' },
  { subject: 'math', grades: [1, 2, 3], name: 'Phép cộng, trừ', examples: 'Cộng trừ không nhớ, có nhớ; tính nhẩm; đặt tính rồi tính' },
  { subject: 'math', grades: [2, 3], name: 'Bảng nhân, bảng chia', examples: 'Bảng nhân/chia 2–9, tính nhẩm, phép chia có dư' },
  { subject: 'math', grades: [3, 4, 5], name: 'Nhân, chia số có nhiều chữ số', examples: 'Đặt tính nhân/chia, nhân chia nhẩm với 10, 100, 1000' },
  { subject: 'math', grades: [2, 3, 4, 5], name: 'Tìm thành phần chưa biết', examples: 'Tìm x: số hạng, số bị trừ, thừa số, số bị chia…' },
  { subject: 'math', grades: [3, 4, 5], name: 'Biểu thức và tính nhanh', examples: 'Thứ tự thực hiện phép tính, biểu thức chứa chữ, tính chất giao hoán/kết hợp, tính nhanh' },
  { subject: 'math', grades: [4], name: 'Dấu hiệu chia hết', examples: 'Chia hết cho 2, 3, 5, 9' },
  { subject: 'math', grades: [3, 4, 5], name: 'Phân số', examples: 'Một phần mấy, rút gọn, quy đồng, so sánh, cộng trừ nhân chia phân số' },
  { subject: 'math', grades: [5], name: 'Số thập phân', examples: 'Đọc viết, so sánh, 4 phép tính với số thập phân, hỗn số' },
  { subject: 'math', grades: [5], name: 'Tỉ số phần trăm', examples: 'Tìm tỉ số phần trăm, tìm giá trị phần trăm của một số' },
  { subject: 'math', grades: [1, 2, 3, 4, 5], name: 'Dãy số và quy luật', examples: 'Điền số còn thiếu, tìm quy luật dãy số/hình' },
  // --- Toán: Hình học và đo lường ---
  { subject: 'math', grades: [1, 2, 3], name: 'Nhận biết hình', examples: 'Hình vuông, tròn, tam giác, chữ nhật, tứ giác; khối lập phương, khối trụ; đếm hình' },
  { subject: 'math', grades: [3, 4, 5], name: 'Chu vi và diện tích', examples: 'Chu vi, diện tích hình chữ nhật, vuông, bình hành, thoi, tam giác, thang, tròn' },
  { subject: 'math', grades: [4, 5], name: 'Góc và đường thẳng', examples: 'Góc nhọn, tù, bẹt, vuông; đường thẳng song song, vuông góc' },
  { subject: 'math', grades: [5], name: 'Hình hộp và thể tích', examples: 'Diện tích xung quanh, toàn phần, thể tích hình hộp chữ nhật, hình lập phương' },
  { subject: 'math', grades: [1, 2, 3, 4, 5], name: 'Đo lường và đổi đơn vị', examples: 'Độ dài, khối lượng, dung tích, diện tích, thể tích; đổi đơn vị đo' },
  { subject: 'math', grades: [1, 2, 3, 4], name: 'Xem đồng hồ, thời gian', examples: 'Xem giờ, ngày trong tuần, tháng, năm, thế kỷ, xem lịch' },
  { subject: 'math', grades: [2, 3], name: 'Tiền Việt Nam', examples: 'Nhận biết tờ tiền, tính tiền mua bán đơn giản' },
  // --- Toán: Thống kê và xác suất ---
  { subject: 'math', grades: [2, 3, 4, 5], name: 'Thống kê và xác suất', examples: 'Đọc bảng số liệu, biểu đồ tranh/cột/hình quạt; có thể, chắc chắn, không thể' },
  // --- Toán: Giải toán có lời văn ---
  { subject: 'math', grades: [1, 2, 3], name: 'Toán có lời văn: thêm, bớt, nhiều hơn, ít hơn', examples: 'Bài toán thêm/bớt, nhiều hơn/ít hơn, gấp/giảm một số lần' },
  { subject: 'math', grades: [4, 5], name: 'Trung bình cộng', examples: 'Tìm số trung bình cộng, tìm số khi biết trung bình cộng' },
  { subject: 'math', grades: [4, 5], name: 'Tổng – hiệu, tổng – tỉ, hiệu – tỉ', examples: 'Tìm hai số khi biết tổng và hiệu, tổng và tỉ, hiệu và tỉ' },
  { subject: 'math', grades: [5], name: 'Chuyển động đều', examples: 'Vận tốc, quãng đường, thời gian; hai vật chuyển động cùng/ngược chiều' },

  // --- Tiếng Việt ---
  { subject: 'language', grades: [1], name: 'Âm, vần, dấu thanh', examples: 'Nhận biết âm, ghép vần, 6 dấu thanh, chữ hoa' },
  { subject: 'language', grades: [1, 2, 3, 4, 5], name: 'Chính tả', examples: 'Phân biệt ch/tr, s/x, l/n, r/d/gi, dấu hỏi/ngã; viết hoa tên riêng' },
  { subject: 'language', grades: [1, 2, 3, 4, 5], name: 'Đọc hiểu', examples: 'Đọc đoạn văn/bài thơ rồi trả lời câu hỏi về chi tiết, nhân vật, ý chính' },
  { subject: 'language', grades: [1, 2, 3, 4, 5], name: 'Mở rộng vốn từ', examples: 'Từ ngữ theo chủ điểm: gia đình, trường học, thiên nhiên, quê hương…' },
  { subject: 'language', grades: [2, 3], name: 'Từ chỉ sự vật, hoạt động, đặc điểm', examples: 'Tìm, xếp nhóm từ chỉ sự vật, hoạt động, đặc điểm' },
  { subject: 'language', grades: [3, 4, 5], name: 'Từ đồng nghĩa, trái nghĩa', examples: 'Tìm từ cùng nghĩa, trái nghĩa; chọn từ thích hợp' },
  { subject: 'language', grades: [4, 5], name: 'Danh từ, động từ, tính từ', examples: 'Nhận biết và phân loại từ loại; danh từ chung, riêng' },
  { subject: 'language', grades: [5], name: 'Đại từ, quan hệ từ', examples: 'Nhận biết đại từ xưng hô, quan hệ từ và cặp quan hệ từ' },
  { subject: 'language', grades: [5], name: 'Từ đồng âm, từ nhiều nghĩa', examples: 'Phân biệt nghĩa gốc, nghĩa chuyển; từ đồng âm' },
  { subject: 'language', grades: [2, 3, 4], name: 'Kiểu câu', examples: 'Câu giới thiệu, nêu hoạt động, nêu đặc điểm; câu hỏi, câu kể, câu cảm, câu khiến' },
  { subject: 'language', grades: [4, 5], name: 'Thành phần câu', examples: 'Chủ ngữ, vị ngữ, trạng ngữ; câu đơn, câu ghép, liên kết câu' },
  { subject: 'language', grades: [2, 3, 4, 5], name: 'Dấu câu', examples: 'Dấu chấm, phẩy, chấm hỏi, chấm than, hai chấm, gạch ngang, ngoặc kép' },
  { subject: 'language', grades: [3, 4, 5], name: 'Biện pháp tu từ', examples: 'So sánh, nhân hóa, điệp từ điệp ngữ' },
  { subject: 'language', grades: [3, 4, 5], name: 'Thành ngữ, tục ngữ', examples: 'Hiểu nghĩa và dùng thành ngữ, tục ngữ quen thuộc' },
];

export function gradesLabel(grades: number[]): string {
  return grades.length > 1 && grades[grades.length - 1] - grades[0] === grades.length - 1
    ? `${grades[0]}–${grades[grades.length - 1]}`
    : grades.join(', ');
}
