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
  /** Tốc độ tương đối 0..1, dùng để làm nét thay đổi tự nhiên khi rê nhanh/chậm. */
  speed: number;
  time: number;
}

export interface Stroke {
  color: string;
  size: number;
  eraser: boolean;
  brush: BrushType;
  points: Point[];
}

export type BrushType = 'pencil' | 'marker' | 'watercolor' | 'crayon';

export interface BrushState {
  color: string;
  size: number;
  eraser: boolean;
  brush: BrushType;
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

  resize(): void {
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
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const points = this.current?.points;
    const previous = points ? points[points.length - 1] : undefined;
    const time = e.timeStamp;
    const elapsed = previous ? Math.max(1, time - previous.time) : 1;
    const distance = previous ? Math.hypot(x - previous.x, y - previous.y) : 0;
    const speed = Math.min(1, distance / elapsed / 1.5);
    return { x, y, p, speed, time };
  }

  private handleDown = (e: PointerEvent): void => {
    // Chỉ nhận 1 ngón cùng lúc → bé đặt tay lên màn hình không làm loạn nét
    if (this.activePointer !== null) return;
    e.preventDefault();
    this.activePointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);

    const b = this.brush();
    this.current = {
      color: b.color,
      size: b.size,
      eraser: b.eraser,
      brush: b.brush,
      points: [this.toPoint(e)],
    };
    this.redoStack = [];
    // Một lần chạm vẫn tạo dấu bằng đúng chất liệu của cọ đang chọn.
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
    c.globalAlpha = 1;
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
  }

  private opacity(s: Stroke, p: Point): number {
    switch (s.brush) {
      case 'marker':
        return 1;
      case 'watercolor':
        return 0.04 + p.p * 0.05;
      case 'crayon':
        return 0.58 + p.p * 0.3;
      default:
        return 0.62 + p.p * 0.38 - p.speed * 0.12;
    }
  }

  private widthAt(s: Stroke, p: Point): number {
    const pressure = 0.65 + p.p * 0.65;
    switch (s.brush) {
      case 'marker':
        return s.size * 1.35 * pressure * (1 - p.speed * 0.14);
      case 'watercolor':
        return s.size * 1.5 * pressure * (1 - p.speed * 0.28);
      case 'crayon':
        return s.size * 1.2 * pressure * (1 - p.speed * 0.2);
      default:
        return s.size * (0.28 + p.p * 1.02) * (1 - p.speed * 0.35);
    }
  }

  private drawDot(s: Stroke, p: Point): void {
    this.setupCtx(s);
    this.ctx.globalAlpha = s.eraser ? 1 : this.opacity(s, p);
    const width = this.widthAt(s, p);
    if (s.brush === 'watercolor' && !s.eraser) {
      this.ctx.globalAlpha *= 0.65;
      this.drawStamp(p, width * 1.5);
      this.ctx.globalAlpha *= 1.5;
    }
    this.drawStamp(p, width);
    if (!s.eraser) this.drawTexture(s, p, p, p);
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
    const c = this.ctx;
    const drawCurve = (width: number, alpha: number, offset = 0): void => {
      c.globalAlpha = alpha;
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(start.x, start.y + offset);
      c.quadraticCurveTo(p1.x, p1.y + offset, end.x, end.y + offset);
      c.stroke();
    };

    const width = this.widthAt(s, p1);
    const alpha = s.eraser ? 1 : this.opacity(s, p1);
    if (s.brush === 'watercolor' && !s.eraser) {
      // Layer a faint wash and a soft edge without allocating a full-canvas texture.
      drawCurve(width * 1.4, alpha * 0.5);
      drawCurve(width, alpha);
      drawCurve(width * 0.62, alpha * 0.32, Math.sin(p1.x * 0.11 + p1.y * 0.07) * width * 0.1);
    } else {
      drawCurve(width, alpha);
      if (s.brush === 'pencil' && !s.eraser) {
        drawCurve(Math.max(0.7, width * 0.42), alpha * 0.2, Math.sin(p1.x * 0.13) * width * 0.18);
      }
    }
    if (!s.eraser) this.drawTexture(s, p1, p2, start);
  }

  private drawStamp(p: Point, width: number): void {
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawTexture(s: Stroke, from: Point, to: Point, start: Point): void {
    if (s.brush !== 'crayon' && s.brush !== 'pencil') return;
    const c = this.ctx;
    const distance = Math.hypot(to.x - start.x, to.y - start.y);
    const marks = Math.min(4, Math.max(1, Math.ceil(distance / 8)));
    const angle = Math.atan2(to.y - start.y, to.x - start.x) + Math.PI / 2;
    const width = this.widthAt(s, from);
    c.save();
    c.globalAlpha = s.brush === 'crayon' ? 0.2 : 0.12;
    c.lineWidth = s.brush === 'crayon' ? 1 : 0.7;
    for (let i = 1; i <= marks; i++) {
      const t = i / (marks + 1);
      const x = start.x + (to.x - start.x) * t;
      const y = start.y + (to.y - start.y) * t;
      const seed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const fraction = seed - Math.floor(seed);
      const side = (fraction - 0.5) * width * 0.8;
      const length = s.brush === 'crayon' ? 2 + fraction * 3 : 1 + fraction * 1.5;
      const centerX = x + Math.cos(angle) * side;
      const centerY = y + Math.sin(angle) * side;
      c.beginPath();
      c.moveTo(centerX - Math.cos(angle) * length, centerY - Math.sin(angle) * length);
      c.lineTo(centerX + Math.cos(angle) * length, centerY + Math.sin(angle) * length);
      c.stroke();
    }
    c.restore();
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
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    p: (a.p + b.p) / 2,
    speed: (a.speed + b.speed) / 2,
    time: (a.time + b.time) / 2,
  };
}
