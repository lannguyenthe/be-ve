/**
 * Engine vẽ.
 *
 * Mỗi nét được lưu dạng vector (danh sách điểm) thay vì chụp ảnh canvas.
 * Undo = bỏ nét cuối rồi vẽ lại toàn bộ. Cách này tốn rất ít RAM —
 * quan trọng vì iPad 2018 chỉ có 2GB RAM, chụp ImageData mỗi bước
 * (~12MB/lần) sẽ làm Safari reload trang.
 */
import { encodePsd } from './psd';
import { saveArtwork } from './storage';

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
  opacity: number;
  flow: number;
  grain: number;
  tool: DrawingTool;
  pixel: boolean;
  symmetry: boolean;
  alphaLock: boolean;
  layerId: string;
  points: Point[];
}

export type BrushType =
  | 'pencil'
  | 'marker'
  | 'watercolor'
  | 'crayon'
  | 'oil'
  | 'biro'
  | 'pastel'
  | 'chalk'
  | 'charcoal'
  | 'blender'
  | 'metallic'
  | 'paint3d';
export type DrawingTool = 'brush' | 'line' | 'rectangle' | 'ellipse' | 'fill' | 'blur' | 'pan' | 'picker';
export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  alphaLocked: boolean;
  transform: { x: number; y: number; scale: number; rotation: number; flipX: boolean; flipY: boolean };
  filters: { hue: number; saturation: number; brightness: number; contrast: number; blur: number; invert: number };
  image?: string;
  mask?: string;
  strokes: Stroke[];
}

type HistoryAction =
  | { kind: 'stroke'; stroke: Stroke; index: number }
  | { kind: 'layer'; layer: Layer; index: number };

export interface ArtworkDocument {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  layers: Layer[];
  paper?: PaperType;
  view?: { zoom: number; x: number; y: number; rotation: number };
  symmetry?: boolean;
  resolutionScale?: number;
}

export type PaperType = 'plain' | 'canvas' | 'cardboard' | 'graph' | 'squared' | 'isometric';

export interface BrushState {
  color: string;
  size: number;
  eraser: boolean;
  brush: BrushType;
  opacity: number;
  flow: number;
  grain: number;
  tool: DrawingTool;
  symmetry: boolean;
  pixel: boolean;
}

const MAX_DPR = 2;
const MAX_CANVAS_PIXELS = 2_000_000;
const MAX_LAYERS = 8;

export class DrawingBoard {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layers: Layer[] = [newLayer('Layer 1')];
  private activeLayerId = this.layers[0].id;
  private undoStack: HistoryAction[] = [];
  private redoStack: HistoryAction[] = [];
  private current: Stroke | null = null;
  private activePointer: number | null = null;
  private dpr = 1;
  private artworkId: string = crypto.randomUUID();
  private artworkName = 'Tranh chưa đặt tên';
  private createdAt = Date.now();
  private symmetry = false;
  private paper: PaperType = 'plain';
  private view = { zoom: 1, x: 0, y: 0, rotation: 0 };
  private resolutionScale = 1;
  private panStart: { x: number; y: number; viewX: number; viewY: number } | null = null;
  private lastSave = 0;
  private persistTimer = 0;
  private layerSurfaces = new Map<string, HTMLCanvasElement>();
  private imageCache = new Map<string, HTMLImageElement>();
  private pendingLayerRenders: Promise<void>[] = [];

  /** Gọi mỗi khi số nét thay đổi (để bật/tắt nút Undo) */
  onChange: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, private brush: () => BrushState) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D không được hỗ trợ');
    this.ctx = ctx;

    this.resize();
    this.canvas.dataset.paper = this.paper;
    window.addEventListener('resize', () => this.resize());

    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    canvas.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('pointercancel', this.handleUp);
    canvas.addEventListener('pointerleave', this.handleUp);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get isEmpty(): boolean {
    return this.layers.every((layer) => layer.strokes.length === 0 && !layer.image);
  }

  get layerList(): readonly Layer[] {
    return this.layers;
  }

  get currentLayer(): Layer {
    return this.layers.find((layer) => layer.id === this.activeLayerId) ?? this.layers[0];
  }

  get saveTime(): number {
    return this.lastSave;
  }

  get paperType(): PaperType {
    return this.paper;
  }

  get symmetryEnabled(): boolean {
    return this.symmetry;
  }

  get resolution(): number {
    return this.resolutionScale;
  }

  get viewport(): Readonly<typeof this.view> {
    return this.view;
  }

  setPaper(paper: PaperType): void {
    this.paper = paper;
    this.canvas.dataset.paper = paper;
    this.persist();
    this.onChange();
  }

  setViewport(change: Partial<typeof this.view>): void {
    this.view = { ...this.view, ...change };
    this.canvas.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom}) rotate(${this.view.rotation}deg)`;
    this.persist();
    this.onChange();
  }

  setSymmetry(enabled: boolean): void {
    this.symmetry = enabled;
    this.persist();
  }

  setResolutionScale(scale: number): void {
    if (![1, 1.5, 2].includes(scale)) throw new Error('Độ phân giải không hợp lệ');
    this.resolutionScale = scale;
    this.resize();
    this.persist();
  }

  createLayer(): void {
    if (this.layers.length >= MAX_LAYERS) throw new Error(`Tối đa ${MAX_LAYERS} layer trên canvas này.`);
    const layer = newLayer(`Layer ${this.layers.length + 1}`);
    this.layers.push(layer);
    this.undoStack.push({ kind: 'layer', layer, index: this.layers.length - 1 });
    this.redoStack = [];
    this.activeLayerId = layer.id;
    this.redraw();
    this.onChange();
  }

  duplicateLayer(id: string): void {
    if (this.layers.length >= MAX_LAYERS) throw new Error(`Tối đa ${MAX_LAYERS} layer trên canvas này.`);
    const sourceIndex = this.layers.findIndex((layer) => layer.id === id);
    if (sourceIndex < 0) throw new Error('Không tìm thấy layer');
    const clone = structuredClone(this.layers[sourceIndex]);
    clone.id = crypto.randomUUID();
    clone.name = `${clone.name} bản sao`;
    this.layers.splice(sourceIndex + 1, 0, clone);
    this.activeLayerId = clone.id;
    this.undoStack.push({ kind: 'layer', layer: clone, index: sourceIndex + 1 });
    this.redoStack = [];
    this.redraw();
    this.onChange();
  }

  selectLayer(id: string): void {
    if (!this.layers.some((layer) => layer.id === id)) throw new Error('Không tìm thấy layer');
    this.activeLayerId = id;
    this.onChange();
  }

  updateLayer(
    id: string,
    change: Partial<Pick<Layer, 'name' | 'visible' | 'opacity' | 'blendMode' | 'alphaLocked'>> & {
      transform?: Partial<Layer['transform']>;
      filters?: Partial<Layer['filters']>;
    },
  ): void {
    const layer = this.layers.find((item) => item.id === id);
    if (!layer) throw new Error('Không tìm thấy layer');
    const { transform, filters, ...properties } = change;
    Object.assign(layer, properties);
    if (transform) layer.transform = { ...layer.transform, ...transform };
    if (filters) layer.filters = { ...layer.filters, ...filters };
    this.redraw();
    this.onChange();
  }

  moveLayer(id: string, direction: -1 | 1): void {
    const index = this.layers.findIndex((layer) => layer.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= this.layers.length) return;
    [this.layers[index], this.layers[next]] = [this.layers[next], this.layers[index]];
    this.redraw();
    this.onChange();
  }

  reorderLayer(id: string, targetId: string): void {
    const from = this.layers.findIndex((layer) => layer.id === id);
    const target = this.layers.findIndex((layer) => layer.id === targetId);
    if (from < 0 || target < 0 || from === target) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(target, 0, layer);
    this.redraw();
    this.onChange();
  }

  removeLayer(id: string): void {
    if (this.layers.length === 1) throw new Error('Cần giữ lại ít nhất một layer');
    this.layers = this.layers.filter((layer) => layer.id !== id);
    this.undoStack = this.undoStack.filter((action) =>
      action.kind === 'layer' ? action.layer.id !== id : action.stroke.layerId !== id);
    this.redoStack = this.redoStack.filter((action) =>
      action.kind === 'layer' ? action.layer.id !== id : action.stroke.layerId !== id);
    if (this.activeLayerId === id) this.activeLayerId = this.layers[this.layers.length - 1].id;
    this.redraw();
    this.onChange();
  }

  async importImage(dataUrl: string, name = 'Ảnh nhập'): Promise<void> {
    if (this.layers.length >= MAX_LAYERS) throw new Error(`Tối đa ${MAX_LAYERS} layer trên canvas này.`);
    if (dataUrl.length > 30 * 1024 * 1024) throw new Error('Ảnh vượt quá giới hạn 30 MB.');
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, 4096 / image.width, 4096 / image.height, Math.sqrt(8_000_000 / (image.width * image.height)));
    const resized = document.createElement('canvas');
    resized.width = Math.max(1, Math.round(image.width * scale));
    resized.height = Math.max(1, Math.round(image.height * scale));
    const context = resized.getContext('2d');
    if (!context) throw new Error('Không thu nhỏ được ảnh nhập');
    context.drawImage(image, 0, 0, resized.width, resized.height);
    dataUrl = resized.toDataURL('image/png');
    if (dataUrl.length > 30 * 1024 * 1024) throw new Error('Ảnh sau khi chuẩn hoá vượt quá giới hạn 30 MB.');
    const layer = newLayer(name);
    layer.image = dataUrl;
    this.layers.push(layer);
    this.undoStack.push({ kind: 'layer', layer, index: this.layers.length - 1 });
    this.redoStack = [];
    this.activeLayerId = layer.id;
    this.redraw();
    this.onChange();
  }

  async createLayerMask(id: string): Promise<void> {
    const layer = this.layers.find((item) => item.id === id);
    if (!layer) throw new Error('Không tìm thấy layer');
    const mask = document.createElement('canvas');
    mask.width = this.canvas.width;
    mask.height = this.canvas.height;
    const context = mask.getContext('2d');
    if (!context) throw new Error('Không tạo được layer mask');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, mask.width, mask.height);
    layer.mask = mask.toDataURL('image/png');
    this.redraw();
    this.onChange();
  }

  async importLayerMask(id: string, dataUrl: string): Promise<void> {
    if (dataUrl.length > 30 * 1024 * 1024) throw new Error('Ảnh mask vượt quá giới hạn 30 MB.');
    const image = await loadImage(dataUrl);
    const mask = document.createElement('canvas');
    mask.width = this.canvas.width;
    mask.height = this.canvas.height;
    const context = mask.getContext('2d');
    if (!context) throw new Error('Không tạo được ảnh mask');
    context.drawImage(image, 0, 0, mask.width, mask.height);
    const pixels = context.getImageData(0, 0, mask.width, mask.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const luminance = (pixels.data[i] * 0.2126 + pixels.data[i + 1] * 0.7152 + pixels.data[i + 2] * 0.0722) / 255;
      pixels.data[i] = 255;
      pixels.data[i + 1] = 255;
      pixels.data[i + 2] = 255;
      pixels.data[i + 3] = Math.round(pixels.data[i + 3] * luminance);
    }
    context.putImageData(pixels, 0, 0);
    const layer = this.layers.find((item) => item.id === id);
    if (!layer) throw new Error('Không tìm thấy layer');
    layer.mask = mask.toDataURL('image/png');
    this.redraw();
    this.onChange();
  }

  exportDocument(): ArtworkDocument {
    return structuredClone({
      id: this.artworkId,
      name: this.artworkName,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      layers: this.layers,
      paper: this.paper,
      view: this.view,
      symmetry: this.symmetry,
      resolutionScale: this.resolutionScale,
    }) as ArtworkDocument;
  }

  loadDocument(document: ArtworkDocument): void {
    if (!document.layers?.length) throw new Error('Tệp tranh không có layer hợp lệ');
    if (document.layers.length > MAX_LAYERS) throw new Error(`Tệp tranh vượt quá giới hạn ${MAX_LAYERS} layer.`);
    const resolution = document.resolutionScale ?? 1;
    if (![1, 1.5, 2].includes(resolution)) throw new Error('Độ phân giải trong tệp dự án không hợp lệ');
    let strokeCount = 0;
    let pointCount = 0;
    let imageDataSize = 0;
    for (const rawLayer of document.layers) {
      if (!rawLayer || typeof rawLayer !== 'object') throw new Error('Layer trong tệp tranh không hợp lệ.');
      if (rawLayer.strokes !== undefined && !Array.isArray(rawLayer.strokes)) {
        throw new Error('Danh sách nét vẽ trong tệp tranh không hợp lệ.');
      }
      strokeCount += rawLayer.strokes?.length ?? 0;
      if (strokeCount > 100_000) throw new Error('Tệp tranh có quá nhiều nét vẽ.');
      for (const stroke of rawLayer.strokes ?? []) {
        if (!Array.isArray(stroke.points)) throw new Error('Nét vẽ trong tệp tranh không hợp lệ.');
        pointCount += stroke.points.length;
        if (pointCount > 500_000) throw new Error('Tệp tranh có quá nhiều điểm vẽ.');
        if (stroke.points.some((point) =>
          !point || typeof point !== 'object' || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          Math.abs(point.x) > 100_000 || Math.abs(point.y) > 100_000)) {
          throw new Error('Tệp tranh có tọa độ nét vẽ không hợp lệ.');
        }
      }
      if ((rawLayer.image !== undefined && typeof rawLayer.image !== 'string') ||
          (rawLayer.mask !== undefined && typeof rawLayer.mask !== 'string')) {
        throw new Error('Ảnh trong tệp tranh không hợp lệ.');
      }
      if ([rawLayer.image, rawLayer.mask].some((source) =>
        source !== undefined && !/^data:image\/(?:png|jpeg|webp);base64,/i.test(source))) {
        throw new Error('Tệp tranh chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP được nhúng.');
      }
      imageDataSize += (rawLayer.image?.length ?? 0) + (rawLayer.mask?.length ?? 0);
      if ((rawLayer.image?.length ?? 0) > 30 * 1024 * 1024 ||
          (rawLayer.mask?.length ?? 0) > 30 * 1024 * 1024 ||
          imageDataSize > 60 * 1024 * 1024) {
        throw new Error('Ảnh trong tệp tranh vượt quá giới hạn dung lượng.');
      }
    }
    this.artworkId = document.id;
    this.artworkName = document.name;
    this.createdAt = document.createdAt;
    this.layers = document.layers.map((rawLayer, index) => {
      const id = rawLayer.id || crypto.randomUUID();
      const cloned = structuredClone(rawLayer);
      const layer: Layer = Object.assign(newLayer(rawLayer.name || `Layer ${index + 1}`), cloned, {
        id,
        transform: Object.assign({ x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false }, rawLayer.transform),
        filters: Object.assign({ hue: 0, saturation: 100, brightness: 100, contrast: 100, blur: 0, invert: 0 }, rawLayer.filters),
      });
      layer.strokes = (rawLayer.strokes ?? []).map((stroke) =>
        Object.assign({
          opacity: 1, flow: 1, grain: 0.4, tool: 'brush' as DrawingTool,
          pixel: false, symmetry: false, alphaLock: false, layerId: id,
        }, stroke),
      );
      return layer;
    });
    this.undoStack = this.layers.flatMap((layer, layerIndex) => [
      ...(layerIndex > 0 ? [{ kind: 'layer' as const, layer, index: layerIndex }] : []),
      ...layer.strokes.map((stroke, index) => ({ kind: 'stroke' as const, stroke, index })),
    ]);
    this.redoStack = [];
    this.activeLayerId = this.layers[this.layers.length - 1].id;
    this.paper = document.paper ?? 'plain';
    this.canvas.dataset.paper = this.paper;
    this.symmetry = document.symmetry ?? false;
    this.resolutionScale = resolution;
    this.view = document.view ?? { zoom: 1, x: 0, y: 0, rotation: 0 };
    this.resize();
    this.setViewport(this.view);
    this.redraw();
    this.onChange();
  }

  newDocument(name = 'Tranh chưa đặt tên'): void {
    this.artworkId = crypto.randomUUID();
    this.artworkName = name;
    this.createdAt = Date.now();
    this.layers = [newLayer('Layer 1')];
    this.activeLayerId = this.layers[0].id;
    this.paper = 'plain';
    this.resolutionScale = 1;
    this.canvas.dataset.paper = this.paper;
    this.resize();
    this.setViewport({ zoom: 1, x: 0, y: 0, rotation: 0 });
    this.undoStack = [];
    this.redoStack = [];
    this.redraw();
    this.onChange();
  }

  undo(): void {
    const action = this.undoStack.pop();
    if (!action) return;
    if (action.kind === 'stroke') {
      const layer = this.layers.find((item) => item.id === action.stroke.layerId);
      if (!layer) throw new Error('Layer của nét vẽ không còn tồn tại');
      layer.strokes.splice(action.index, 1);
    } else {
      this.layers.splice(this.layers.indexOf(action.layer), 1);
      if (!this.layers.length) this.layers.push(newLayer('Layer 1'));
      if (!this.layers.some((layer) => layer.id === this.activeLayerId)) {
        this.activeLayerId = this.layers[this.layers.length - 1].id;
      }
    }
    this.redoStack.push(action);
    this.redraw();
    this.onChange();
  }

  redo(): void {
    const action = this.redoStack.pop();
    if (!action) return;
    if (action.kind === 'stroke') {
      const layer = this.layers.find((item) => item.id === action.stroke.layerId);
      if (!layer) throw new Error('Layer của nét vẽ không còn tồn tại');
      layer.strokes.splice(action.index, 0, action.stroke);
    } else {
      this.layers.splice(action.index, 0, action.layer);
      this.activeLayerId = action.layer.id;
    }
    this.undoStack.push(action);
    this.redraw();
    this.onChange();
  }

  clear(): void {
    this.layers = [newLayer('Layer 1')];
    this.activeLayerId = this.layers[0].id;
    this.undoStack = [];
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
    paintPaper(octx, out.width, out.height, this.paper);
    octx.drawImage(this.canvas, 0, 0);
    return new Promise((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob thất bại'))), 'image/png'),
    );
  }

  async toPsdBlob(): Promise<Blob> {
    if (this.canvas.width * this.canvas.height > 2_000_000) {
      throw new Error('Canvas quá lớn để xuất PSD trên iPad; hãy giảm độ phân giải.');
    }
    if (this.layers.length > 8) {
      throw new Error('PSD hiện hỗ trợ tối đa 8 layer để tránh hết bộ nhớ.');
    }
    const imageLayers = this.layers.filter((layer) => layer.image);
    await Promise.all(imageLayers.map(async (layer) => {
      if (layer.image && !this.imageCache.has(layer.image)) {
        this.imageCache.set(layer.image, await loadImage(layer.image));
      }
    }));
    this.redraw();
    await Promise.all(this.pendingLayerRenders);
    const layers = this.layers.map((layer) => {
      const surface = this.layerSurfaces.get(layer.id);
      if (!surface) throw new Error(`Không render được layer ${layer.name}`);
      const filtered = document.createElement('canvas');
      filtered.width = surface.width;
      filtered.height = surface.height;
      const context = filtered.getContext('2d');
      if (!context) throw new Error('Không đọc được pixel layer');
      context.filter = `hue-rotate(${layer.filters.hue}deg) saturate(${layer.filters.saturation}%) brightness(${layer.filters.brightness}%) contrast(${layer.filters.contrast}%) invert(${layer.filters.invert}%) blur(${layer.filters.blur}px)`;
      context.drawImage(surface, 0, 0);
      return { layer, pixels: context.getImageData(0, 0, filtered.width, filtered.height) };
    });
    const mergedCanvas = document.createElement('canvas');
    mergedCanvas.width = this.canvas.width;
    mergedCanvas.height = this.canvas.height;
    const mergedContext = mergedCanvas.getContext('2d');
    if (!mergedContext) throw new Error('Không tạo được ảnh PSD');
    paintPaper(mergedContext, mergedCanvas.width, mergedCanvas.height, this.paper);
    mergedContext.drawImage(this.canvas, 0, 0);
    return encodePsd(mergedCanvas.width, mergedCanvas.height, layers, mergedContext.getImageData(0, 0, mergedCanvas.width, mergedCanvas.height));
  }

  // ---------------------------------------------------------------------------

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = this.canvas.clientWidth || rect.width;
    const height = this.canvas.clientHeight || rect.height;
    const requestedDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * this.resolutionScale;
    this.dpr = Math.min(requestedDpr, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.redraw();
  }

  private persist(): void {
    window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      void this.saveDocument().catch((error: unknown) => console.error('Không tự lưu được tranh:', error));
    }, 400);
  }

  async saveDocument(): Promise<void> {
    await saveArtwork(this.exportDocument());
    this.lastSave = Date.now();
  }

  private toPoint(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    // Ngón tay báo pressure = 0.5 (hoặc 0 trên vài máy) → coi như lực trung bình
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const radians = (this.view.rotation * Math.PI) / 180;
    const x = (dx * Math.cos(radians) + dy * Math.sin(radians)) / this.view.zoom + this.canvas.clientWidth / 2;
    const y = (-dx * Math.sin(radians) + dy * Math.cos(radians)) / this.view.zoom + this.canvas.clientHeight / 2;
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
    if (b.tool === 'pan') {
      this.panStart = { x: e.clientX, y: e.clientY, viewX: this.view.x, viewY: this.view.y };
      return;
    }
    if (b.tool === 'picker') {
      const point = this.toPoint(e);
      const pixel = this.ctx.getImageData(Math.round(point.x * this.dpr), Math.round(point.y * this.dpr), 1, 1).data;
      b.color = pixel[3] < 16
        ? '#ffffff'
        : `#${[pixel[0], pixel[1], pixel[2]].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
      b.tool = 'brush';
      this.activePointer = null;
      this.onChange();
      return;
    }
    if (b.tool === 'fill') {
      this.fillAt(this.toPoint(e), b.color);
      this.activePointer = null;
      return;
    }
    this.current = {
      color: b.color,
      size: b.size,
      eraser: b.eraser,
      brush: b.brush,
      opacity: b.opacity,
      flow: b.flow,
      grain: b.grain,
      tool: b.tool,
      pixel: b.pixel,
      symmetry: b.symmetry || this.symmetry,
      alphaLock: this.currentLayer.alphaLocked,
      layerId: this.activeLayerId,
      points: [this.toPoint(e)],
    };
    this.redoStack = [];
    if (b.tool === 'brush' || b.tool === 'blur') {
      this.withLayerContext(this.currentLayer, () => this.drawDot(this.current!, this.current!.points[0]));
      this.renderComposite();
    }
  };

  private handleMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    if (this.panStart) {
      this.setViewport({
        x: this.panStart.viewX + e.clientX - this.panStart.x,
        y: this.panStart.viewY + e.clientY - this.panStart.y,
      });
      return;
    }
    if (!this.current) return;
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
      if (this.current.tool === 'brush' || this.current.tool === 'blur') {
        this.withLayerContext(this.currentLayer, () => this.drawLastSegment(this.current!));
        this.renderComposite();
      } else {
        this.redraw();
      }
    }
  };

  private handleUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    if (this.panStart) {
      this.panStart = null;
      this.persist();
      return;
    }
    if (this.current) {
      if (this.current.tool !== 'brush' && this.current.tool !== 'blur') {
        this.withLayerContext(this.currentLayer, () => this.drawStroke(this.current!));
      }
      this.currentLayer.strokes.push(this.current);
      this.undoStack.push({
        kind: 'stroke',
        stroke: this.current,
        index: this.currentLayer.strokes.length - 1,
      });
      this.current = null;
      this.redraw();
      this.persist();
      this.onChange();
    }
  };

  // --- render ---------------------------------------------------------------

  private setupCtx(s: Stroke): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const layer = this.layers.find((item) => item.id === s.layerId);
    if (layer) applyLayerTransform(c, layer, this.canvas.clientWidth, this.canvas.clientHeight);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalCompositeOperation = s.eraser
      ? 'destination-out'
      : s.alphaLock
        ? 'source-atop'
        : 'source-over';
    c.globalAlpha = 1;
    if (s.brush === 'metallic') {
      const gradient = c.createLinearGradient(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.24, shade(s.color, 42));
      gradient.addColorStop(0.5, s.color);
      gradient.addColorStop(0.76, shade(s.color, -38));
      gradient.addColorStop(1, '#ffffff');
      c.strokeStyle = gradient;
      c.fillStyle = gradient;
    } else {
      c.strokeStyle = s.color;
      c.fillStyle = s.color;
    }
    c.filter = s.tool === 'blur' || s.brush === 'blender'
      ? `blur(${Math.max(2, s.size / 3)}px)`
      : 'none';
    if (s.brush === 'paint3d') {
      c.shadowColor = s.color;
      c.shadowBlur = Math.max(2, s.size * 0.3);
    } else {
      c.shadowBlur = 0;
    }
  }

  private opacity(s: Stroke, p: Point): number {
    switch (s.brush) {
      case 'marker':
        return s.opacity * s.flow;
      case 'watercolor':
        return s.opacity * s.flow * (0.04 + p.p * 0.05);
      case 'crayon':
        return s.opacity * s.flow * (0.58 + p.p * 0.3);
      case 'biro':
        return s.opacity * s.flow * 0.58;
      case 'chalk':
      case 'charcoal':
        return s.opacity * s.flow * 0.65;
      case 'oil':
        return s.opacity * s.flow * 0.9;
      case 'pastel':
        return s.opacity * s.flow * 0.75;
      case 'blender':
        return s.opacity * s.flow * 0.35;
      case 'metallic':
      case 'paint3d':
        return s.opacity * s.flow;
      default:
        return s.opacity * s.flow * (0.62 + p.p * 0.38 - p.speed * 0.12);
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
      case 'oil':
        return s.size * 1.3 * pressure;
      case 'biro':
        return s.size * 0.45 * pressure;
      case 'pastel':
      case 'chalk':
        return s.size * 1.25 * pressure;
      case 'charcoal':
        return s.size * 1.45 * pressure;
      case 'blender':
        return s.size * 1.6 * pressure;
      case 'metallic':
      case 'paint3d':
        return s.size * 1.35 * pressure;
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
    if (!['crayon', 'pencil', 'chalk', 'charcoal', 'pastel'].includes(s.brush)) return;
    const c = this.ctx;
    const distance = Math.hypot(to.x - start.x, to.y - start.y);
    const marks = Math.min(4, Math.max(1, Math.ceil(distance / 8)));
    const angle = Math.atan2(to.y - start.y, to.x - start.x) + Math.PI / 2;
    const width = this.widthAt(s, from);
    c.save();
    c.globalAlpha = s.grain * (s.brush === 'crayon' ? 0.45 : 0.3);
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
    this.drawStrokeAt(s);
    if (s.symmetry) {
      this.ctx.save();
      this.ctx.translate(this.canvas.width / this.dpr, 0);
      this.ctx.scale(-1, 1);
      this.drawStrokeAt(s);
      this.ctx.restore();
    }
  }

  private drawStrokeAt(s: Stroke): void {
    if (s.pixel) {
      const unit = Math.max(2, Math.round(s.size / 5));
      for (const point of s.points) {
        this.setupCtx(s);
        this.ctx.globalAlpha = this.opacity(s, point);
        this.ctx.fillRect(Math.round(point.x / unit) * unit, Math.round(point.y / unit) * unit, unit, unit);
      }
      return;
    }
    if (s.tool === 'line' || s.tool === 'rectangle' || s.tool === 'ellipse') {
      this.drawShape(s);
      return;
    }
    this.drawDot(s, s.points[0]);
    for (let i = 2; i <= s.points.length; i++) {
      this.drawLastSegment({ ...s, points: s.points.slice(Math.max(0, i - 3), i) });
    }
  }

  private drawShape(s: Stroke): void {
    const first = s.points[0];
    const last = s.points[s.points.length - 1];
    this.setupCtx(s);
    this.ctx.globalAlpha = this.opacity(s, last);
    this.ctx.lineWidth = this.widthAt(s, last);
    this.ctx.beginPath();
    if (s.tool === 'line') {
      this.ctx.moveTo(first.x, first.y);
      this.ctx.lineTo(last.x, last.y);
    } else if (s.tool === 'rectangle') {
      this.ctx.rect(first.x, first.y, last.x - first.x, last.y - first.y);
    } else {
      this.ctx.ellipse(
        (first.x + last.x) / 2,
        (first.y + last.y) / 2,
        Math.max(1, Math.abs(last.x - first.x) / 2),
        Math.max(1, Math.abs(last.y - first.y) / 2),
        0, 0, Math.PI * 2,
      );
    }
    this.ctx.stroke();
  }

  private redraw(): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.layerSurfaces.clear();
    this.pendingLayerRenders = [];
    for (const layer of this.layers) {
      const surface = document.createElement('canvas');
      surface.width = this.canvas.width;
      surface.height = this.canvas.height;
      const surfaceCtx = surface.getContext('2d');
      if (!surfaceCtx) throw new Error('Không tạo được canvas cho layer');
      this.ctx = surfaceCtx;
      for (const stroke of layer.strokes) this.drawStroke(stroke);
      this.layerSurfaces.set(layer.id, surface);
      if (layer.image || layer.mask) this.pendingLayerRenders.push(this.renderLayerImages(layer, surface, surfaceCtx));
    }
    this.ctx = c;
    this.renderComposite();
  }

  private async renderLayerImages(
    layer: Layer,
    surface: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
  ): Promise<void> {
    if (layer.image) {
      const image = await this.cachedImage(layer.image);
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      applyLayerTransform(context, layer, this.canvas.clientWidth, this.canvas.clientHeight);
      drawImageContained(context, image, this.canvas.clientWidth, this.canvas.clientHeight);
    }
    if (layer.mask) {
      const mask = await this.cachedImage(layer.mask);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(mask, 0, 0, surface.width, surface.height);
      context.globalCompositeOperation = 'source-over';
    }
    this.renderComposite();
  }

  private async cachedImage(source: string): Promise<HTMLImageElement> {
    const cached = this.imageCache.get(source);
    if (cached) return cached;
    const image = await loadImage(source);
    this.imageCache.set(source, image);
    return image;
  }

  private withLayerContext(layer: Layer, draw: () => void): void {
    let surface = this.layerSurfaces.get(layer.id);
    if (!surface) {
      surface = document.createElement('canvas');
      surface.width = this.canvas.width;
      surface.height = this.canvas.height;
      this.layerSurfaces.set(layer.id, surface);
    }
    const context = surface.getContext('2d');
    if (!context) throw new Error('Không mở được canvas layer');
    const main = this.ctx;
    this.ctx = context;
    draw();
    this.ctx = main;
  }

  private renderComposite(): void {
    const main = this.ctx;
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const layer of this.layers) {
      const surface = this.layerSurfaces.get(layer.id);
      if (!surface || !layer.visible) continue;
      main.globalAlpha = layer.opacity;
      main.globalCompositeOperation = layer.blendMode;
      main.filter = `hue-rotate(${layer.filters.hue}deg) saturate(${layer.filters.saturation}%) brightness(${layer.filters.brightness}%) contrast(${layer.filters.contrast}%) invert(${layer.filters.invert}%) blur(${layer.filters.blur}px)`;
      main.drawImage(surface, 0, 0);
    }
    main.globalAlpha = 1;
    main.globalCompositeOperation = 'source-over';
    main.filter = 'none';
  }

  private fillAt(point: Point, color: string): void {
    if (this.layers.length >= MAX_LAYERS) throw new Error(`Tối đa ${MAX_LAYERS} layer trên canvas này.`);
    const width = this.canvas.width;
    const height = this.canvas.height;
    const x = Math.round(point.x * this.dpr);
    const y = Math.round(point.y * this.dpr);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixels = this.ctx.getImageData(0, 0, width, height);
    const start = (y * width + x) * 4;
    const target = Array.from(pixels.data.slice(start, start + 4));
    const rgb = parseColor(color);
    const visited = new Uint8Array(width * height);
    const fillPixels = new ImageData(width, height);
    const stack = [x, y];
    while (stack.length) {
      const fy = stack.pop()!;
      const fx = stack.pop()!;
      if (fx < 0 || fy < 0 || fx >= width || fy >= height) continue;
      const pixel = fy * width + fx;
      if (visited[pixel]) continue;
      visited[pixel] = 1;
      const index = pixel * 4;
      const difference = Math.abs(pixels.data[index] - target[0]) +
        Math.abs(pixels.data[index + 1] - target[1]) +
        Math.abs(pixels.data[index + 2] - target[2]) +
        Math.abs(pixels.data[index + 3] - target[3]);
      if (difference > 42) continue;
      fillPixels.data[index] = rgb[0];
      fillPixels.data[index + 1] = rgb[1];
      fillPixels.data[index + 2] = rgb[2];
      fillPixels.data[index + 3] = 255;
      stack.push(fx + 1, fy, fx - 1, fy, fx, fy + 1, fx, fy - 1);
    }
    const fillCanvas = document.createElement('canvas');
    fillCanvas.width = width;
    fillCanvas.height = height;
    const fillCtx = fillCanvas.getContext('2d');
    if (!fillCtx) throw new Error('Không tạo được layer tô màu');
    fillCtx.putImageData(fillPixels, 0, 0);
    const layer = newLayer('Tô màu');
    layer.image = fillCanvas.toDataURL('image/png');
    this.layers.push(layer);
    this.undoStack.push({ kind: 'layer', layer, index: this.layers.length - 1 });
    this.redoStack = [];
    this.activeLayerId = layer.id;
    this.redraw();
    this.persist();
    this.onChange();
  }
}

function newLayer(name: string): Layer {
  return {
    id: crypto.randomUUID(),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    alphaLocked: false,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false },
    filters: { hue: 0, saturation: 100, brightness: 100, contrast: 100, blur: 0, invert: 0 },
    strokes: [],
  };
}

function applyLayerTransform(
  context: CanvasRenderingContext2D,
  layer: Layer,
  width: number,
  height: number,
): void {
  context.translate(width / 2 + layer.transform.x, height / 2 + layer.transform.y);
  context.rotate((layer.transform.rotation * Math.PI) / 180);
  context.scale(layer.transform.scale * (layer.transform.flipX ? -1 : 1), layer.transform.scale * (layer.transform.flipY ? -1 : 1));
  context.translate(-width / 2, -height / 2);
}

function drawImageContained(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
): void {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không đọc được ảnh'));
    image.src = src;
  });
}

function parseColor(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) throw new Error(`Màu không hợp lệ: ${color}`);
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
}

function shade(color: string, amount: number): string {
  const channels = parseColor(color).map((channel) => Math.max(0, Math.min(255, channel + amount)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function paintPaper(ctx: CanvasRenderingContext2D, width: number, height: number, paper: PaperType): void {
  ctx.fillStyle = paper === 'cardboard' ? '#dfc6a1' : paper === 'canvas' ? '#faf7f0' : '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = paper === 'cardboard' ? 'rgb(90 60 30 / 0.05)' : 'rgb(95 130 160 / 0.22)';
  ctx.lineWidth = 1;
  const step = paper === 'squared' ? 48 : 24;
  if (paper === 'graph' || paper === 'squared') {
    for (let x = 0; x < width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
  } else if (paper === 'isometric') {
    ctx.strokeStyle = 'rgb(95 130 160 / 0.22)';
    for (let x = -height; x < width + height; x += 48) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height * 0.58, height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - height * 0.58, height); ctx.stroke();
    }
  } else if (paper === 'canvas' || paper === 'cardboard') {
    for (let y = 3; y < height; y += 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
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
