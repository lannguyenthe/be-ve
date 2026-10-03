import { COLORS, SIZES, DEFAULT_COLOR, DEFAULT_SIZE, CLEAR_CONFIRM_MS } from './config';
import type { BrushState, BrushType, DrawingBoard } from './drawing';
import { icon } from './icons';

const BRUSHES: { value: BrushType; label: string }[] = [
  { value: 'pencil', label: 'Bút chì' },
  { value: 'marker', label: 'Bút dạ' },
  { value: 'watercolor', label: 'Màu nước' },
  { value: 'crayon', label: 'Sáp màu' },
];

/**
 * Thanh công cụ: gần như không có chữ — bé chưa biết đọc vẫn dùng được.
 */
export class Toolbar {
  readonly state: BrushState = {
    color: DEFAULT_COLOR,
    size: DEFAULT_SIZE,
    eraser: false,
    brush: 'pencil',
  };

  private colorBtns: HTMLButtonElement[] = [];
  private sizeBtns: HTMLButtonElement[] = [];
  private brushSelect!: HTMLSelectElement;
  private eraserBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private clearBtn!: HTMLButtonElement;
  private clearTimer: number | undefined;

  constructor(
    private root: HTMLElement,
    private board: DrawingBoard,
    private onSave: () => void,
  ) {
    this.build();
    this.refresh();
  }

  /** Cập nhật trạng thái nút (gọi sau mỗi nét vẽ) */
  refresh(): void {
    for (const b of this.colorBtns) {
      b.classList.toggle('active', !this.state.eraser && b.dataset.color === this.state.color);
    }
    for (const b of this.sizeBtns) {
      b.classList.toggle('active', Number(b.dataset.size) === this.state.size);
      // chấm minh hoạ cỡ bút mang màu đang chọn
      b.style.setProperty('--dot', this.state.eraser ? '#9e9e9e' : this.state.color);
    }
    this.brushSelect.value = this.state.brush;
    this.eraserBtn.classList.toggle('active', this.state.eraser);
    this.undoBtn.disabled = !this.board.canUndo;
    this.redoBtn.disabled = !this.board.canRedo;
    this.clearBtn.disabled = this.board.isEmpty;
  }

  private build(): void {
    const colors = group('colors');
    for (const c of COLORS) {
      const b = button('swatch', '');
      b.dataset.color = c;
      b.style.setProperty('--swatch', c);
      b.setAttribute('aria-label', `Màu ${c}`);
      tap(b, () => {
        this.state.color = c;
        this.state.eraser = false;
        this.refresh();
      });
      this.colorBtns.push(b);
      colors.append(b);
    }

    const sizes = group('sizes');
    SIZES.forEach((s, i) => {
      const b = button('size', '');
      b.dataset.size = String(s);
      b.style.setProperty('--dot-size', `${10 + i * 10}px`);
      b.setAttribute('aria-label', `Cỡ bút ${i + 1}`);
      tap(b, () => {
        this.state.size = s;
        this.refresh();
      });
      this.sizeBtns.push(b);
      sizes.append(b);
    });

    const brushes = group('brushes');
    this.brushSelect = document.createElement('select');
    this.brushSelect.className = 'brush-select';
    this.brushSelect.setAttribute('aria-label', 'Chọn loại cọ');
    for (const brush of BRUSHES) {
      const option = document.createElement('option');
      option.value = brush.value;
      option.textContent = brush.label;
      this.brushSelect.append(option);
    }
    this.brushSelect.addEventListener('change', () => {
      const selected = BRUSHES.find((brush) => brush.value === this.brushSelect.value);
      if (!selected) throw new Error(`Loại cọ không hợp lệ: ${this.brushSelect.value}`);
      this.state.brush = selected.value;
      this.state.eraser = false;
      this.refresh();
    });
    brushes.append(this.brushSelect);

    const tools = group('tools');
    this.eraserBtn = button('tool', icon('eraser'), 'Tẩy');
    tap(this.eraserBtn, () => {
      this.state.eraser = !this.state.eraser;
      this.refresh();
    });

    this.undoBtn = button('tool', icon('undo'), 'Quay lại');
    tap(this.undoBtn, () => this.board.undo());

    this.redoBtn = button('tool', icon('redo'), 'Làm lại');
    tap(this.redoBtn, () => this.board.redo());

    const saveBtn = button('tool', icon('save'), 'Lưu tranh');
    tap(saveBtn, () => this.onSave());

    // "Xoá hết" phải bấm 2 lần → tránh bé lỡ tay xoá mất tranh
    this.clearBtn = button('tool danger', icon('trash'), 'Xoá hết');
    tap(this.clearBtn, () => this.handleClear());

    tools.append(this.eraserBtn, this.undoBtn, this.redoBtn, saveBtn, this.clearBtn);
    this.root.append(colors, sizes, brushes, tools);
  }

  private handleClear(): void {
    if (this.clearBtn.classList.contains('confirm')) {
      window.clearTimeout(this.clearTimer);
      this.clearBtn.classList.remove('confirm');
      this.board.clear();
      return;
    }
    this.clearBtn.classList.add('confirm');
    this.clearTimer = window.setTimeout(
      () => this.clearBtn.classList.remove('confirm'),
      CLEAR_CONFIRM_MS,
    );
  }
}

// --- helpers -----------------------------------------------------------------

function group(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = `group ${cls}`;
  return d;
}

function button(cls: string, html: string, label?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.innerHTML = html;
  if (label) b.setAttribute('aria-label', label);
  return b;
}

/** pointerup thay vì click: phản hồi nhanh hơn trên iPad, không bị trễ 300ms */
function tap(el: HTMLElement, fn: () => void): void {
  el.addEventListener('pointerup', (e) => {
    e.preventDefault();
    if ((el as HTMLButtonElement).disabled) return;
    fn();
  });
}
