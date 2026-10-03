# Bé Vẽ 🎨

Bảng vẽ đơn giản cho bé, chạy trên iPad (Safari) dạng web app — **không cần Mac, iPhone hay tài khoản Apple Developer**.

Có 4 loại cọ để chọn: bút chì, bút dạ, màu nước và sáp màu. Cỡ nét và lực Apple Pencil được áp dụng khi vẽ.

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
  drawing.ts    engine vẽ: lưu nét dạng vector, undo/redo, Apple Pencil
  toolbar.ts    thanh công cụ (màu, cỡ bút, tẩy, undo, lưu, xoá)
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
- Độ phân giải canvas giới hạn `devicePixelRatio ≤ 2` cũng vì RAM.
- Chỉ nhận **1 ngón tay** cùng lúc → bé tì tay lên màn hình không làm loạn nét.
- Apple Pencil: nhấn mạnh nét to, nhấn nhẹ nét nhỏ; dùng `getCoalescedEvents()` cho nét mượt.
- Nút dùng `pointerup` thay vì `click` để phản hồi tức thì.
- "Xoá hết" phải bấm 2 lần (lần đầu nút rung đỏ).

## Ý tưởng làm tiếp

- [ ] Tự lưu tranh đang vẽ (IndexedDB) để lỡ thoát app không mất
- [ ] Thư viện tranh đã vẽ
- [ ] Tranh tô màu (đường viền có sẵn, bé tô vào) + công cụ đổ màu (flood fill)
- [ ] Bút sticker / con dấu hình ngôi sao, trái tim
- [ ] Bút cầu vồng, bút lấp lánh
- [ ] Âm thanh khi chọn màu
- [ ] Khoá "khu vực bố mẹ" (nhấn giữ 3 giây mới vào) cho nút Xoá / cài đặt
