# Bé Vẽ 🎨

Bảng vẽ cho bé, chạy trên iPad (Safari) dạng web app — **không cần Mac, iPhone hay tài khoản Apple Developer**. Tranh được lưu trên thiết bị và có thể dùng offline sau lần mở đầu tiên.

Có 12 loại cọ mô phỏng chất liệu (bút chì, bút dạ, màu nước, sáp, sơn dầu, bút bi, pastel, phấn, than, pha màu, ánh kim và sơn nổi 3D). Nét phản hồi lực nhấn/tốc độ; có tẩy với đầu cọ riêng, lấy màu, đổ màu, làm mờ, vẽ hình học, pixel và đối xứng. Apple Pencil được hỗ trợ.

Các tính năng khác gồm bảng màu tuỳ chỉnh, chỉnh màu HSB/RGB, opacity/flow/texture, nhiều loại giấy, zoom/pan/xoay, độ phân giải thích ứng, layer có mask/blend/opacity/filter/biến đổi, thư viện tranh, tự lưu và tối đa 3 bản sao lưu gần nhất, nhập ảnh, sao chép/dán ảnh qua clipboard, xuất PNG/PSD nhiều layer/tệp dự án JSON, cùng giao diện tối và tương phản cao.

Đây là bộ công cụ vẽ độc lập lấy cảm hứng từ các ứng dụng vẽ, không phải bản sao Art Set. Một số tính năng native/pro như hàng trăm đầu cọ, mô phỏng màu nước/vật lý nâng cao, không gian màu Wide Color P3, nhập PSD và ghi/phát lại nét vẽ chưa có.

## Chạy thử

Cần Node.js 18+.

```bash
npm install
npm run dev
```

Terminal sẽ in 2 địa chỉ:

- `http://localhost:5173` — mở trên máy tính
- `http://192.168.x.x:5173` — **mở cái này trên iPad** (iPad và máy tính chung Wi-Fi)

Sửa code → iPad tự reload. Nếu không vào được từ iPad: kiểm tra Windows Firewall cho phép Node.js trong mạng Private.

> Lúc dev, service worker (offline) bị tắt có chủ đích để tránh cache code cũ.

## Đưa lên iPad (bản dùng thật)

```bash
npm run build      # ra thư mục dist/
```

Host thư mục `dist/` lên bất kỳ chỗ nào có **HTTPS** (bắt buộc để chạy offline):

- **Netlify Drop**: kéo thả thư mục `dist/` vào https://app.netlify.com/drop — nhanh nhất
- **GitHub Pages**: push code lên nhánh `main`; GitHub Actions tự build và deploy tại
  https://lannguyenthe.github.io/be-ve/
- **Cloudflare Pages / Vercel**: miễn phí, có thể tự deploy khi push code

Trên iPad:

1. Mở link bằng **Safari** (không phải Chrome)
2. Nút Chia sẻ → **Thêm vào MH chính**
3. Mở app từ icon **2 lần khi có mạng** → từ đó dùng được offline

### Khoá bé trong app (khuyên dùng)

Cài đặt → Trợ năng → **Truy cập được hướng dẫn** → bật. Mở Bé Vẽ, bấm nút sườn/Home **3 lần** để khoá. Bé không thoát ra được, không vào app khác.

## Cấu trúc

```
src/
  main.ts       khởi tạo, chặn zoom/cử chỉ, đăng ký service worker
  drawing.ts    engine vẽ, layer, nhập/xuất và lưu tranh
  toolbar.ts    thanh công cụ, layer, thư viện và định dạng xuất
  storage.ts    thư viện tranh và bản sao lưu IndexedDB
  psd.ts        bộ ghi PSD nhiều layer
  config.ts     ← màu & cỡ bút — chỉnh ở đây
  icons.ts      icon SVG inline
  save.ts       lưu tranh (bảng Chia sẻ → Lưu hình ảnh)
  style.css     giao diện
public/
  manifest.webmanifest   thông tin PWA (tên, icon)
  sw.js                  service worker cho offline
  icons/                 icon app
```

## Ghi chú kỹ thuật

- **Undo lưu dạng vector** chứ không chụp ảnh canvas: iPad 2018 chỉ có 2GB RAM, chụp `ImageData` mỗi bước (~12MB) sẽ khiến Safari reload trang.
- Canvas được giới hạn khoảng 2 triệu pixel để tránh quá tải Safari trên iPad đời cũ.
- Ảnh nhập được giảm kích thước tối đa 4096 px/cạnh và 8 triệu pixel; tệp ảnh nguồn tối đa 15 MB.
- Canvas giới hạn 8 layer; PSD giới hạn 2 triệu pixel và 8 layer. PSD có thể xuất nhưng chưa hỗ trợ nhập PSD.
- Chỉ nhận **1 ngón tay** cùng lúc → bé tì tay lên màn hình không làm loạn nét.
- Apple Pencil: nhấn mạnh nét to, nhấn nhẹ nét nhỏ; dùng `getCoalescedEvents()` cho nét mượt.
- Nút dùng `pointerup` thay vì `click` để phản hồi tức thì.
- "Xoá hết" phải bấm 2 lần (lần đầu nút rung đỏ).

- Ghi/phát lại quá trình vẽ không được triển khai theo yêu cầu.
