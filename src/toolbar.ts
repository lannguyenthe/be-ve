import { COLORS, SIZES, DEFAULT_COLOR, DEFAULT_SIZE, CLEAR_CONFIRM_MS } from './config';
import type { BrushState, BrushType, DrawingBoard } from './drawing';
import { icon } from './icons';

const BRUSHES: { value: BrushType; label: string }[] = [
  { value: 'pencil', label: 'Bút chì' },
  { value: 'marker', label: 'Bút dạ' },
  { value: 'watercolor', label: 'Màu nước' },
  { value: 'crayon', label: 'Sáp màu' },
];

const BRUSH_TIPS: Record<BrushType, string> = {
  pencil: '<path d="M16 3 23 22l-7-4-7 4L16 3Z"/><path d="m13.2 17.4 2.8-1.5 2.8 1.5" fill="none" stroke="white" stroke-width="1.3"/>',
  marker: '<path d="M10 5h12v12l-6 10-6-10V5Z"/><path d="M10 10h12" fill="none" stroke="white" stroke-width="1.4"/>',
  watercolor: '<path d="M16 3C13 9 7 14 8 20a8 8 0 0 0 16 0c1-6-5-11-8-17Z"/><path d="M12 21c.4 2 1.7 3 3 3" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round"/>',
  crayon: '<path d="m11 4 10 1 3 15-8 8-8-8 3-16Z"/><path d="m11 4 5 7 5-6M8 20l8-2 8 2" fill="none" stroke="white" stroke-width="1.4"/>',
};

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
      b.dataset.brushType = this.state.eraser ? 'eraser' : this.state.brush;
      b.innerHTML = this.state.eraser ? eraserTip() : brushTip(this.state.brush);
      b.style.color = this.state.eraser ? '#777' : this.state.color;
      const index = SIZES.indexOf(Number(b.dataset.size));
      b.style.setProperty('--tip-width', `${20 + index * 6}px`);
      b.style.setProperty('--tip-height', `${18 + index * 6}px`);
      b.setAttribute(
        'aria-label',
        `${this.state.eraser ? 'Đầu tẩy' : BRUSHES.find((brush) => brush.value === this.state.brush)?.label}, cỡ ${index + 1}`,
      );
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
    SIZES.forEach((s) => {
      const b = button('size', '');
      b.dataset.size = String(s);
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

function brushTip(brush: BrushType): string {
  return `<svg viewBox="0 0 32 32" aria-hidden="true">${BRUSH_TIPS[brush]}</svg>`;
}

function eraserTip(): string {
  return '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m7 18 10-12a3 3 0 0 1 4-.4l5 4a3 3 0 0 1 .5 4.2L17 25H11l-4-3a3 3 0 0 1 0-4Z"/><path d="m12 25 8-10" fill="none" stroke="white" stroke-width="1.5"/></svg>';
}

/** pointerup thay vì click: phản hồi nhanh hơn trên iPad, không bị trễ 300ms */
function tap(el: HTMLElement, fn: () => void): void {
  el.addEventListener('pointerup', (e) => {
    e.preventDefault();
    if ((el as HTMLButtonElement).disabled) return;
    fn();
  });
}
