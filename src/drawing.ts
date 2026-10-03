/**
 * Engine vẽ.
 *
 * Mỗi nét được lưu dạng vector (danh sách điểm) thay vì chụp ảnh canvas.
 * Undo = bỏ nét cuối rồi vẽ lại toàn bộ. Cách này tốn rất ít RAM —
 * quan trọng vì iPad 2018 chỉ có 2GB RAM, chụp ImageData mỗi bước
 * (~12MB/lần) sẽ làm Safari reload trang.
 */

export interface Point {
  x: number;
  y: number;
  /** 0..1, lấy từ Apple Pencil; ngón tay luôn ~0.5 */
  p: number;
}

export interface Stroke {
  color: string;
  size: number;
  eraser: boolean;
  points: Point[];
}

export interface BrushState {
  color: string;
  size: number;
  eraser: boolean;
}

const MAX_DPR = 2; // giới hạn độ phân giải để tiết kiệm RAM

export class DrawingBoard {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private current: Stroke | null = null;
  private activePointer: number | null = null;
  private dpr = 1;

  /** Gọi mỗi khi số nét thay đổi (để bật/tắt nút Undo) */
  onChange: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, private brush: () => BrushState) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D không được hỗ trợ');
    this.ctx = ctx;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    canvas.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('pointercancel', this.handleUp);
    canvas.addEventListener('pointerleave', this.handleUp);
  }

  get canUndo(): boolean {
    return this.strokes.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get isEmpty(): boolean {
    return this.strokes.length === 0;
  }

  undo(): void {
    const s = this.strokes.pop();
    if (!s) return;
    this.redoStack.push(s);
    this.redraw();
    this.onChange();
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.strokes.push(s);
    this.redraw();
    this.onChange();
  }

  clear(): void {
    this.strokes = [];
    this.redoStack = [];
    this.redraw();
    this.onChange();
  }

  /** Xuất tranh ra PNG nền trắng (canvas gốc nền trong suốt vì có tẩy) */
  async toPngBlob(): Promise<Blob> {
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const octx = out.getContext('2d')!;
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(this.canvas, 0, 0);
    return new Promise((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob thất bại'))), 'image/png'),
    );
  }

  // ---------------------------------------------------------------------------

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.redraw();
  }

  private toPoint(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    // Ngón tay báo pressure = 0.5 (hoặc 0 trên vài máy) → coi như lực trung bình
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, p };
  }

  private handleDown = (e: PointerEvent): void => {
    // Chỉ nhận 1 ngón cùng lúc → bé đặt tay lên màn hình không làm loạn nét
    if (this.activePointer !== null) return;
    e.preventDefault();
    this.activePointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);

    const b = this.brush();
    this.current = { color: b.color, size: b.size, eraser: b.eraser, points: [this.toPoint(e)] };
    this.redoStack = [];
    // Vẽ 1 chấm ngay để chạm nhẹ cũng thấy
    this.drawDot(this.current, this.current.points[0]);
  };

  private handleMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer || !this.current) return;
    e.preventDefault();

    // getCoalescedEvents cho nét mượt hơn với Apple Pencil (240Hz)
    const events =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = events.length > 0 ? events : [e];
    for (const ev of list) {
      const pts = this.current.points;
      const pt = this.toPoint(ev);
      const last = pts[pts.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1) continue; // bỏ điểm trùng
      pts.push(pt);
      this.drawLastSegment(this.current);
    }
  };

  private handleUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    if (this.current) {
      this.strokes.push(this.current);
      this.current = null;
      this.onChange();
    }
  };

  // --- render ---------------------------------------------------------------

  private setupCtx(s: Stroke): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
  }

  private widthAt(s: Stroke, p: Point): number {
    // pressure 0.5 → đúng size; Pencil nhấn mạnh/nhẹ → to/nhỏ hơn
    return s.size * (0.5 + p.p);
  }

  private drawDot(s: Stroke, p: Point): void {
    this.setupCtx(s);
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, this.widthAt(s, p) / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  /** Vẽ đoạn cuối bằng đường cong qua trung điểm → nét mềm, không gãy khúc */
  private drawLastSegment(s: Stroke): void {
    const pts = s.points;
    const n = pts.length;
    if (n < 2) return;
    const p0 = pts[Math.max(0, n - 3)];
    const p1 = pts[n - 2];
    const p2 = pts[n - 1];
    const start = n >= 3 ? mid(p0, p1) : p1;
    const end = mid(p1, p2);

    this.setupCtx(s);
    this.ctx.lineWidth = this.widthAt(s, p1);
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.quadraticCurveTo(p1.x, p1.y, end.x, end.y);
    this.ctx.stroke();
  }

  private drawStroke(s: Stroke): void {
    const pts = s.points;
    this.drawDot(s, pts[0]);
    for (let i = 2; i <= pts.length; i++) {
      // tái sử dụng logic vẽ từng đoạn để kết quả giống hệt lúc vẽ tay
      this.drawLastSegment({ ...s, points: pts.slice(Math.max(0, i - 3), i) });
    }
  }

  private redraw(): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.strokes) this.drawStroke(s);
  }
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 };
}
