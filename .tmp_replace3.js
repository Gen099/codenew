const fs = require('fs');
function fix(path, pairs) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to] of pairs) text = text.split(from).join(to);
  fs.writeFileSync(path, text, 'utf8');
}
fix('frontend/js/screens.js', [
  ['ĐÃ lÃ m má»›i Dashboard', 'Đã làm mới Dashboard'],
  ['ÄÃ£ lÃ m má»›i Dashboard', 'Đã làm mới Dashboard'],
  ['Lỗi khÃ´ng xÃ¡c Ä‘á»‹nh', 'Lỗi không xác định'],
  ['Đang có ${p1Count} key trÃªn server. DÃ¡n FULL danh sÃ¡ch key má»›i, mỗi dòng 1 key Ä‘á»ƒ replace.', 'Đang có ${p1Count} key trên server. Dán FULL danh sách key mới, mỗi dòng 1 key để replace.'],
  ['Không có mục nÃ o', 'Không có mục nào'],
  ['Chá» QC', 'Chờ QC'],
  ['Lá»—i', 'Lỗi']
]);
fix('js/screens.js', [
  ['ĐÃ lÃ m má»›i Dashboard', 'Đã làm mới Dashboard'],
  ['ÄÃ£ lÃ m má»›i Dashboard', 'Đã làm mới Dashboard'],
  ['Lỗi khÃ´ng xÃ¡c Ä‘á»‹nh', 'Lỗi không xác định'],
  ['Đang có ${p1Count} key trÃªn server. DÃ¡n FULL danh sÃ¡ch key má»›i, mỗi dòng 1 key Ä‘á»ƒ replace.', 'Đang có ${p1Count} key trên server. Dán FULL danh sách key mới, mỗi dòng 1 key để replace.'],
  ['Không có mục nÃ o', 'Không có mục nào'],
  ['Chá» QC', 'Chờ QC'],
  ['Lá»—i', 'Lỗi']
]);
fix('frontend/js/app.js', [
  ['Báº¡n khÃ´ng cÃ³ quyá»n truy cáº­p mÃ n hÃ¬nh nÃ y', 'Bạn không có quyền truy cập màn hình này'],
  ['Username vÃ  máº­t kháº©u lÃ  báº¯t buá»™c', 'Username và mật khẩu là bắt buộc'],
  ['Để táº¡o video sáº£n pháº©m Ä‘áº¹p, báº¡n nÃªn dÃ¹ng prompt:', 'Để tạo video sản phẩm đẹp, bạn nên dùng prompt:'],
  ['Kling 2.5 Turbo Pro cÃ³ CFG tá»« 0.3-0.7 cho chuyá»ƒn Ä‘á»™ng mÆ°á»£t. Vá»›i sáº£n pháº©m nÃªn dÃ¹ng 0.5.', 'Kling 2.5 Turbo Pro có CFG từ 0.3-0.7 cho chuyển động mượt. Với sản phẩm nên dùng 0.5.'],
  ['Batch editing tip: dÃ¹ng preset "Product Pro" + prompt thÃªm "consistent lighting" Ä‘á»ƒ Ä‘á»“ng Ä‘á»u giá»¯a cÃ¡c ảnh.', 'Batch editing tip: dùng preset "Product Pro" + prompt thêm "consistent lighting" để đồng đều giữa các ảnh.'],
  ['Để first-last frame to video hiá»‡u quáº£: frame Ä‘áº§u vÃ  cuá»‘i nÃªn cÃ³ cÃ¹ng background, chá»‰ thay Ä‘á»•i vá»‹ trÃ­/gÃ³c nhÃ¬n.', 'Để first-last frame to video hiệu quả: frame đầu và cuối nên có cùng background, chỉ thay đổi vị trí/góc nhìn.'],
  ['QC pass rate tháº¥p thÆ°á»ng do: ảnh nguá»“n Ä‘á»™ phÃ¢n giáº£i tháº¥p, prompt quÃ¡ dÃ i, hoáº·c CFG quÃ¡ cao.', 'QC pass rate thấp thường do: ảnh nguồn độ phân giải thấp, prompt quá dài, hoặc CFG quá cao.'],
  ['Xin chÃ o! TÃ´i giÃºp báº¡n táº¡o prompt, phÃ¢n tÃ­ch ảnh, tÆ° váº¥n quy trÃ¬nh', 'Xin chào! Tôi giúp bạn tạo prompt, phân tích ảnh, tư vấn quy trình'],
  ['Upload ảnh Ä‘á»ƒ tÃ´i phÃ¢n tÃ­ch + gá»£i Ã½ prompt!', 'Upload ảnh để tôi phân tích + gợi ý prompt!'],
  ['Đã xÃ³a lá»‹ch sá»­ chat', 'Đã xóa lịch sử chat'],
  ['Sáº£n pháº©m trÃªn ná»n tráº¯ng, Ã¡nh sÃ¡ng studio', 'Sản phẩm trên nền trắng, ánh sáng studio'],
  ['Sáº£n pháº©m má»¹ pháº©m, tone áº¥m', 'Sản phẩm mỹ phẩm, tone ấm'],
  ['Thiáº¿t bá»‹ cÃ´ng nghá»‡, ná»n tá»‘i', 'Thiết bị công nghệ, nền tối'],
  ['Thá»±c pháº©m, setup chá»¥p ảnh', 'Thực phẩm, setup chụp ảnh'],
  ['Thá»i trang, phong cÃ¡ch tá»‘i giáº£n', 'Thời trang, phong cách tối giản'],
  ['Nháº­n diá»‡n:', 'Nhận diện:'],
  ['ðŸ” <strong>', '<strong>'],
  ['âœ¨ <strong>Prompt gợi ý:</strong>', '<strong>Prompt gợi ý:</strong>'],
  ['áº¢nh nÃày khÃ´ng cÃ²n file gá»‘c trong phiÃªn hiá»‡n táº¡i, hÃ£y upload láº¡i Ä‘á»ƒ gá»i API analyze.', 'Ảnh này không còn file gốc trong phiên hiện tại, hãy upload lại để gọi API analyze.'],
  ['âœ… Đã đổi tên', 'Đã đổi tên'],
  ["label:'áº¢nh'", "label:'Ảnh'"]
]);
fix('js/app.js', [
  ['Báº¡n khÃ´ng cÃ³ quyá»n truy cáº­p mÃ n hÃ¬nh nÃ y', 'Bạn không có quyền truy cập màn hình này'],
  ['Username vÃà máº­t kháº©u lÃà báº¯t buá»™c', 'Username và mật khẩu là bắt buộc'],
  ['Username vÃà máº­t kháº©u lÃ  báº¯t buá»™c', 'Username và mật khẩu là bắt buộc'],
  ['Username vÃà máº­t kháº©u lÃà báº¯t buá»™c', 'Username và mật khẩu là bắt buộc'],
  ['Xin chÃào! TÃ´i giÃºp báº¡n táº¡o prompt, phÃ¢n tÃ­ch ảnh, tÆ° váº¥n quy trÃ¬nh', 'Xin chào! Tôi giúp bạn tạo prompt, phân tích ảnh, tư vấn quy trình'],
  ['Upload ảnh Ä‘á»ƒ tÃ´i phÃ¢n tÃ­ch + gá»£i Ã½ prompt!', 'Upload ảnh để tôi phân tích + gợi ý prompt!'],
  ['Đã xÃ³a lá»‹ch sá»­ chat', 'Đã xóa lịch sử chat'],
  ['Nháº­n diá»‡n:', 'Nhận diện:'],
  ['áº¢nh nÃày khÃ´ng cÃ²n file gá»‘c trong phiÃªn hiá»‡n táº¡i, hÃ£y upload láº¡i Ä‘á»ƒ gá»i API analyze.', 'Ảnh này không còn file gốc trong phiên hiện tại, hãy upload lại để gọi API analyze.'],
  ['âœ… Đã đổi tên', 'Đã đổi tên'],
  ["label:'áº¢nh'", "label:'Ảnh'"]
]);
console.log('FINAL_FONT_PASS');
