import './style.css';
import { DrawingBoard } from './drawing';
import { Toolbar } from './toolbar';
import { saveImage } from './save';
import { listArtworks } from './storage';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const toolbarEl = document.querySelector<HTMLElement>('#toolbar')!;

// toolbar được tạo sau board, nên board đọc trạng thái bút qua closure
let toolbar: Toolbar;
const board = new DrawingBoard(canvas, () => toolbar.state);
toolbar = new Toolbar(toolbarEl, board, async () => saveImage(await board.toPngBlob()));
// Fit again after the toolbar is populated and takes its final layout space.
board.resize();
let saveTimer = 0;
board.onChange = () => {
  toolbar.refresh();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void board.saveDocument().catch((error: unknown) => {
      console.error('Không thể lưu tranh vào thư viện:', error);
    });
  }, 500);
};

const savedTheme = localStorage.getItem('be-ve-theme');
if (savedTheme === 'dark' || savedTheme === 'contrast') {
  document.documentElement.classList.add(savedTheme === 'dark' ? 'dark' : 'high-contrast');
}
void listArtworks()
  .then((artworks) => {
    if (artworks[0]) board.loadDocument(artworks[0]);
  })
  .catch((error: unknown) => console.error('Không tải được thư viện tranh:', error));

// --- Chặn các cử chỉ hệ thống làm phiền bé -----------------------------------

// Pinch-zoom của Safari (iOS bỏ qua user-scalable=no trong một số trường hợp)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault());
}
// Double-tap zoom
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);
// Menu khi nhấn giữ
document.addEventListener('contextmenu', (e) => e.preventDefault());

// --- PWA: chạy offline sau lần mở đầu tiên ------------------------------------
// Service worker chỉ chạy trên HTTPS hoặc localhost, và chỉ bật ở bản build
// (khi dev mà bật SW thì sửa code sẽ không thấy thay đổi do bị cache).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Không đăng ký được service worker:', err);
    });
  });
}
