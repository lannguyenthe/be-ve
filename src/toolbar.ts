import { COLORS, SIZES, DEFAULT_COLOR, DEFAULT_SIZE, CLEAR_CONFIRM_MS } from './config';
import type { BrushState, BrushType, DrawingBoard, DrawingTool, Layer } from './drawing';
import { icon } from './icons';
import { deleteArtwork, listArtworks, listBackups } from './storage';

const BRUSHES: { value: BrushType; label: string }[] = [
  { value: 'pencil', label: 'Bút chì' },
  { value: 'marker', label: 'Bút dạ' },
  { value: 'watercolor', label: 'Màu nước' },
  { value: 'crayon', label: 'Sáp màu' },
  { value: 'oil', label: 'Sơn dầu' },
  { value: 'biro', label: 'Bút bi' },
  { value: 'pastel', label: 'Pastel' },
  { value: 'chalk', label: 'Phấn' },
  { value: 'charcoal', label: 'Than' },
  { value: 'blender', label: 'Pha màu' },
  { value: 'metallic', label: 'Ánh kim' },
  { value: 'paint3d', label: 'Sơn nổi 3D' },
];

const BRUSH_TIPS: Record<BrushType, string> = {
  pencil: '<path d="M16 3 23 22l-7-4-7 4L16 3Z"/><path d="m13.2 17.4 2.8-1.5 2.8 1.5" fill="none" stroke="white" stroke-width="1.3"/>',
  marker: '<path d="M10 5h12v12l-6 10-6-10V5Z"/><path d="M10 10h12" fill="none" stroke="white" stroke-width="1.4"/>',
  watercolor: '<path d="M16 3C13 9 7 14 8 20a8 8 0 0 0 16 0c1-6-5-11-8-17Z"/><path d="M12 21c.4 2 1.7 3 3 3" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round"/>',
  crayon: '<path d="m11 4 10 1 3 15-8 8-8-8 3-16Z"/><path d="m11 4 5 7 5-6M8 20l8-2 8 2" fill="none" stroke="white" stroke-width="1.4"/>',
  oil: '<path d="M11 3h10v15l-5 9-5-9V3Z"/><path d="M10 8h12" fill="none" stroke="white" stroke-width="1.4"/>',
  biro: '<path d="M12 3h8v18l-4 7-4-7V3Z"/><path d="m13 6 6 1" fill="none" stroke="white" stroke-width="1.2"/>',
  pastel: '<path d="m9 5 14 3-4 18-13-5L9 5Z"/><path d="m8 10 14 4" fill="none" stroke="white" stroke-width="1.3"/>',
  chalk: '<path d="M8 6h15v17H8z"/><path d="m6 10 2-2m-2 8 2-2m-2 8 2-2" fill="none" stroke="white" stroke-width="1.5"/>',
  charcoal: '<path d="M11 3h8l4 22-7 4-8-4 3-22Z"/><path d="m10 9 11 2" fill="none" stroke="white" stroke-width="1.2"/>',
  blender: '<path d="M9 4h14v4H9zM11 8h10l-2 17h-6L11 8Z"/><path d="M10 12h12" fill="none" stroke="white" stroke-width="1.4"/>',
  metallic: '<path d="M7 24 16 5l9 19H7Z"/><path d="m12 19 4-8 4 8" fill="none" stroke="white" stroke-width="1.4"/>',
  paint3d: '<path d="M16 3 27 9v13l-11 7L5 22V9l11-6Z"/><path d="m5 9 11 7 11-7M16 16v13" fill="none" stroke="white" stroke-width="1.4"/>',
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
    opacity: 1,
    flow: 1,
    grain: 0.4,
    tool: 'brush',
    symmetry: false,
    pixel: false,
  };

  private colorBtns: HTMLButtonElement[] = [];
  private sizeBtns: HTMLButtonElement[] = [];
  private brushSelect!: HTMLSelectElement;
  private eraserBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private clearBtn!: HTMLButtonElement;
  private clearTimer: number | undefined;
  private colorInput!: HTMLInputElement;
  private brushSize!: HTMLInputElement;
  private opacityInput!: HTMLInputElement;
  private flowInput!: HTMLInputElement;
  private grainInput!: HTMLInputElement;
  private toolSelect!: HTMLSelectElement;
  private symmetryInput!: HTMLInputElement;
  private pixelInput!: HTMLInputElement;
  private paperSelect!: HTMLSelectElement;
  private resolutionSelect!: HTMLSelectElement;
  private layersDetails!: HTMLDetailsElement;
  private layersList!: HTMLElement;
  private galleryDialog!: HTMLDialogElement;
  private customColors = readCustomColors();
  private colorModel!: HTMLSelectElement;
  private colorChannels: HTMLInputElement[] = [];
  private colorChannelLabels: HTMLSpanElement[] = [];
  private layerSignature = '';

  constructor(
    private root: HTMLElement,
    private board: DrawingBoard,
    private onSave: () => void | Promise<void>,
  ) {
    this.build();
    this.refresh();
  }

  /** Cập nhật trạng thái nút (gọi sau mỗi nét vẽ) */
  refresh(): void {
    for (const b of this.colorBtns) {
      b.classList.toggle('active', !this.state.eraser && b.dataset.color === this.state.color);
    }
    this.root.querySelectorAll<HTMLButtonElement>('.custom-swatch').forEach((button) => {
      button.classList.toggle('active', !this.state.eraser && button.dataset.color === this.state.color);
    });
    for (const b of this.sizeBtns) {
      const selectedSize = SIZES.reduce((closest, size) =>
        Math.abs(size - this.state.size) < Math.abs(closest - this.state.size) ? size : closest, SIZES[0]);
      b.classList.toggle('active', Number(b.dataset.size) === selectedSize);
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
    this.colorInput.value = this.state.color;
    this.brushSize.value = String(this.state.size);
    this.opacityInput.value = String(this.state.opacity * 100);
    this.flowInput.value = String(this.state.flow * 100);
    this.grainInput.value = String(this.state.grain * 100);
    this.toolSelect.value = this.state.tool;
    this.symmetryInput.checked = this.state.symmetry;
    this.pixelInput.checked = this.state.pixel;
    this.state.symmetry = this.board.symmetryEnabled;
    this.symmetryInput.checked = this.state.symmetry;
    this.paperSelect.value = this.board.paperType;
    this.resolutionSelect.value = String(this.board.resolution);
    this.refreshColorChannels();
    this.renderLayers();
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
    this.brushSelect.value = this.state.brush;
    this.brushSelect.addEventListener('change', () => {
      const selected = BRUSHES.find((brush) => brush.value === this.brushSelect.value);
      if (!selected) throw new Error(`Loại cọ không hợp lệ: ${this.brushSelect.value}`);
      this.state.brush = selected.value;
      this.state.eraser = false;
      this.refresh();
    });
    brushes.append(this.brushSelect);

    const colorControls = group('color-controls');
    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.className = 'color-picker';
    this.colorInput.setAttribute('aria-label', 'Vòng màu');
    this.colorInput.value = this.state.color;
    this.colorInput.addEventListener('input', () => this.setColor(this.colorInput.value));
    colorControls.append(labelled('Chọn màu', this.colorInput));

    const addColor = button('mini-control', '+', 'Thêm màu vào bảng màu');
    tap(addColor, () => {
      this.customColors = [...new Set([...this.customColors, this.state.color])];
      localStorage.setItem('be-ve-colors', JSON.stringify(this.customColors));
      this.renderCustomColors(colors);
    });
    colors.append(addColor);
    this.renderCustomColors(colors);

    const colorEditor = group('color-editor');
    this.colorModel = document.createElement('select');
    this.colorModel.className = 'blend-select';
    this.colorModel.setAttribute('aria-label', 'Mô hình màu');
    this.colorModel.add(new Option('HSB', 'hsb'));
    this.colorModel.add(new Option('RGB', 'rgb'));
    this.colorModel.addEventListener('change', () => this.refreshColorChannels());
    const channelGroup = group('color-channels');
    for (let index = 0; index < 3; index++) {
      const input = range(0, 100, 0, `Kênh màu ${index + 1}`);
      const label = document.createElement('span');
      input.addEventListener('input', () => this.applyColorChannel());
      this.colorChannels.push(input);
      this.colorChannelLabels.push(label);
      channelGroup.append(labelled('', input));
      channelGroup.lastElementChild?.prepend(label);
    }
    colorEditor.append(this.colorModel, channelGroup);

    const controls = group('adjustments');
    this.brushSize = range(2, 72, this.state.size, 'Cỡ cọ');
    this.brushSize.addEventListener('input', () => {
      this.state.size = Number(this.brushSize.value);
      this.refresh();
    });
    this.opacityInput = range(10, 100, this.state.opacity * 100, 'Độ mờ');
    this.opacityInput.addEventListener('input', () => {
      this.state.opacity = Number(this.opacityInput.value) / 100;
    });
    this.flowInput = range(10, 100, this.state.flow * 100, 'Lượng màu');
    this.flowInput.addEventListener('input', () => {
      this.state.flow = Number(this.flowInput.value) / 100;
    });
    this.grainInput = range(0, 100, this.state.grain * 100, 'Hạt chất liệu');
    this.grainInput.addEventListener('input', () => {
      this.state.grain = Number(this.grainInput.value) / 100;
    });
    controls.append(labelled('Cỡ', this.brushSize), labelled('Mờ', this.opacityInput),
      labelled('Màu', this.flowInput), labelled('Hạt', this.grainInput));

    this.toolSelect = document.createElement('select');
    this.toolSelect.className = 'brush-select';
    this.toolSelect.setAttribute('aria-label', 'Công cụ vẽ');
    const toolsList: [DrawingTool, string][] = [
      ['brush', 'Tự do'], ['line', 'Đường thẳng'], ['rectangle', 'Chữ nhật'],
      ['ellipse', 'Elip'], ['fill', 'Đổ màu'], ['blur', 'Làm mờ'],
      ['picker', 'Lấy màu'], ['pan', 'Kéo canvas'],
    ];
    for (const [value, label] of toolsList) this.toolSelect.add(new Option(label, value));
    this.toolSelect.addEventListener('change', () => {
      this.state.tool = this.toolSelect.value as DrawingTool;
    });

    this.symmetryInput = checkbox('Đối xứng');
    this.symmetryInput.addEventListener('change', () => {
      this.state.symmetry = this.symmetryInput.checked;
      this.board.setSymmetry(this.state.symmetry);
    });
    this.pixelInput = checkbox('Pixel');
    this.pixelInput.addEventListener('change', () => (this.state.pixel = this.pixelInput.checked));
    const toolOptions = group('tool-options');
    toolOptions.append(this.toolSelect, labelled('Đối xứng', this.symmetryInput), labelled('Pixel art', this.pixelInput));

    this.paperSelect = document.createElement('select');
    this.paperSelect.className = 'brush-select';
    this.paperSelect.setAttribute('aria-label', 'Chất liệu giấy');
    for (const [value, label] of [
      ['plain', 'Giấy trắng'], ['canvas', 'Canvas'], ['cardboard', 'Bìa giấy'],
      ['graph', 'Giấy ô vuông'], ['squared', 'Giấy kẻ ô'], ['isometric', 'Giấy isometric'],
    ]) this.paperSelect.add(new Option(label, value));
    this.paperSelect.addEventListener('change', () => {
      this.board.setPaper(this.paperSelect.value as 'plain' | 'canvas' | 'cardboard' | 'graph' | 'squared' | 'isometric');
    });

    const viewControls = group('view-controls');
    const zoomOut = button('mini-control', '−', 'Thu nhỏ canvas');
    const zoomIn = button('mini-control', '+', 'Phóng to canvas');
    const rotate = button('mini-control', '↻', 'Xoay canvas');
    const resetView = button('mini-control', '1:1', 'Đặt lại canvas');
    this.resolutionSelect = document.createElement('select');
    this.resolutionSelect.className = 'blend-select';
    this.resolutionSelect.setAttribute('aria-label', 'Độ phân giải canvas');
    this.resolutionSelect.add(new Option('Độ phân giải 1×', '1'));
    this.resolutionSelect.add(new Option('Độ phân giải 1.5×', '1.5'));
    this.resolutionSelect.add(new Option('Độ phân giải 2×', '2'));
    this.resolutionSelect.addEventListener('change', () => this.board.setResolutionScale(Number(this.resolutionSelect.value)));
    tap(zoomOut, () => this.board.setViewport({ zoom: Math.max(0.4, this.board.viewport.zoom - 0.1) }));
    tap(zoomIn, () => this.board.setViewport({ zoom: Math.min(3, this.board.viewport.zoom + 0.1) }));
    tap(rotate, () => this.board.setViewport({ rotation: (this.board.viewport.rotation + 15) % 360 }));
    tap(resetView, () => this.board.setViewport({ zoom: 1, x: 0, y: 0, rotation: 0 }));
    viewControls.append(zoomOut, zoomIn, rotate, resetView, this.paperSelect, this.resolutionSelect);

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

    const layers = group('layer-controls');
    this.layersDetails = document.createElement('details');
    this.layersDetails.className = 'layers-details';
    const layerSummary = document.createElement('summary');
    layerSummary.textContent = 'Layers';
    this.layersList = document.createElement('div');
    this.layersList.className = 'layers-list';
    const addLayer = button('mini-control', '+', 'Thêm layer');
    tap(addLayer, () => this.board.createLayer());
    this.layersDetails.append(layerSummary, this.layersList, addLayer);
    layers.append(this.layersDetails);

    const actions = group('actions');
    const galleryBtn = button('text-control', 'Tranh của bé', 'Mở thư viện tranh');
    tap(galleryBtn, () => this.openGallery());
    const newBtn = button('text-control', 'Tranh mới', 'Tạo tranh mới');
    tap(newBtn, () => {
      const name = window.prompt('Tên tranh mới', 'Tranh của bé');
      if (name !== null) this.board.newDocument(name.trim() || 'Tranh của bé');
    });
    const exportBtn = button('text-control', 'Xuất', 'Xuất tranh');
    tap(exportBtn, () => this.exportCurrent());
    const importBtn = button('text-control', 'Nhập', 'Nhập ảnh hoặc tệp tranh');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,.json,.beve';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      void this.importFile(fileInput).catch(showError);
    });
    tap(importBtn, () => fileInput.click());
    const copyBtn = button('text-control', 'Sao chép', 'Sao chép ảnh vào clipboard');
    tap(copyBtn, () => this.copyToClipboard());
    const pasteBtn = button('text-control', 'Dán', 'Dán ảnh từ clipboard thành layer');
    tap(pasteBtn, () => this.pasteFromClipboard());
    const helpBtn = button('text-control', 'Hướng dẫn', 'Mở hướng dẫn sử dụng');
    tap(helpBtn, () => this.openHelp());
    actions.append(galleryBtn, newBtn, exportBtn, importBtn, copyBtn, pasteBtn, helpBtn, fileInput);

    const appearance = button('mini-control', '◐', 'Chuyển giao diện sáng/tối/tương phản cao');
    appearance.addEventListener('pointerup', () => {
      const root = document.documentElement;
      const next = root.classList.contains('dark') ? 'contrast' :
        root.classList.contains('high-contrast') ? 'light' : 'dark';
      root.classList.remove('dark', 'high-contrast');
      if (next === 'dark') root.classList.add('dark');
      if (next === 'contrast') root.classList.add('high-contrast');
      localStorage.setItem('be-ve-theme', next);
    });

    this.galleryDialog = document.createElement('dialog');
    this.galleryDialog.className = 'gallery-dialog';
    this.galleryDialog.addEventListener('click', (event) => {
      if (event.target === this.galleryDialog) this.galleryDialog.close();
    });
    this.root.append(colors, sizes, brushes, colorControls, colorEditor, controls, toolOptions, tools,
      viewControls, layers, actions, appearance, this.galleryDialog);
    this.root.insertBefore(actions, tools);
    this.root.insertBefore(fileInput, this.galleryDialog);
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

  private setColor(color: string): void {
    this.state.color = color;
    this.state.eraser = false;
    this.refresh();
  }

  private renderCustomColors(root: HTMLElement): void {
    root.querySelectorAll('.custom-swatch').forEach((element) => element.remove());
    for (const color of this.customColors) {
      const wrapper = document.createElement('span');
      wrapper.className = 'palette-item';
      const swatch = button('swatch custom-swatch', '');
      swatch.dataset.color = color;
      swatch.style.setProperty('--swatch', color);
      swatch.setAttribute('aria-label', `Màu tuỳ chọn ${color}`);
      tap(swatch, () => this.setColor(color));
      const remove = button('palette-remove', '×', `Xoá màu ${color}`);
      tap(remove, () => {
        this.customColors = this.customColors.filter((item) => item !== color);
        localStorage.setItem('be-ve-colors', JSON.stringify(this.customColors));
        wrapper.remove();
      });
      wrapper.append(swatch, remove);
      root.insertBefore(wrapper, root.querySelector('.mini-control'));
    }
  }

  private refreshColorChannels(): void {
    const rgb = hexToRgb(this.state.color);
    const values = this.colorModel.value === 'rgb' ? rgb : rgbToHsb(...rgb);
    const labels = this.colorModel.value === 'rgb' ? ['R', 'G', 'B'] : ['H', 'S', 'B'];
    const max = this.colorModel.value === 'rgb' ? [255, 255, 255] : [360, 100, 100];
    this.colorChannels.forEach((input, index) => {
      input.max = String(max[index]);
      input.value = String(Math.round(values[index]));
      this.colorChannelLabels[index].textContent = labels[index];
    });
  }

  private applyColorChannel(): void {
    const channels = this.colorChannels.map((input) => Number(input.value));
    const rgb = this.colorModel.value === 'rgb'
      ? channels as [number, number, number]
      : hsbToRgb(channels[0], channels[1], channels[2]);
    this.setColor(rgbToHex(...rgb));
  }

  private renderLayers(): void {
    const signature = JSON.stringify({
      active: this.board.currentLayer.id,
      layers: this.board.layerList.map(({ id, name, visible, opacity, blendMode, alphaLocked }) =>
        [id, name, visible, opacity, blendMode, alphaLocked]),
    });
    if (signature === this.layerSignature) return;
    this.layerSignature = signature;
    this.layersList.replaceChildren();
    for (const layer of [...this.board.layerList].reverse()) {
      this.layersList.append(this.layerRow(layer));
    }
  }

  private layerRow(layer: Layer): HTMLElement {
    const row = document.createElement('div');
    row.className = 'layer-row';
    const select = button(
      `layer-name${this.board.currentLayer.id === layer.id ? ' active' : ''}`,
      `${layer.visible ? '◉' : '○'} ${escapeHtml(layer.name)}`,
      `Chọn layer ${layer.name}`,
    );
    tap(select, () => this.board.selectLayer(layer.id));
    select.addEventListener('dblclick', () => {
      const name = window.prompt('Tên layer', layer.name)?.trim();
      if (name) this.board.updateLayer(layer.id, { name: name.slice(0, 40) });
    });
    select.draggable = true;
    select.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', layer.id);
    });
    select.addEventListener('dragover', (event) => event.preventDefault());
    select.addEventListener('drop', (event) => {
      event.preventDefault();
      const source = event.dataTransfer?.getData('text/plain');
      if (source) this.board.reorderLayer(source, layer.id);
    });
    const visibility = button('mini-control', layer.visible ? '◉' : '○', 'Hiện/ẩn layer');
    tap(visibility, () => this.board.updateLayer(layer.id, { visible: !layer.visible }));
    const up = button('mini-control', '↑', 'Đưa layer lên trên');
    tap(up, () => this.board.moveLayer(layer.id, 1));
    const down = button('mini-control', '↓', 'Đưa layer xuống dưới');
    tap(down, () => this.board.moveLayer(layer.id, -1));
    const alpha = checkbox('Khoá alpha');
    alpha.checked = layer.alphaLocked;
    alpha.addEventListener('change', () => this.board.updateLayer(layer.id, { alphaLocked: alpha.checked }));
    const opacity = range(0, 100, layer.opacity * 100, 'Độ mờ layer');
    opacity.addEventListener('change', () => this.board.updateLayer(layer.id, { opacity: Number(opacity.value) / 100 }));
    const blend = document.createElement('select');
    blend.className = 'blend-select';
    blend.setAttribute('aria-label', 'Chế độ hoà trộn');
    for (const [value, label] of [
      ['source-over', 'Bình thường'], ['multiply', 'Multiply'], ['screen', 'Screen'],
      ['overlay', 'Overlay'], ['darken', 'Tối'], ['lighten', 'Sáng'],
    ]) blend.add(new Option(label, value));
    blend.value = layer.blendMode;
    blend.addEventListener('change', () => this.board.updateLayer(layer.id, { blendMode: blend.value as Layer['blendMode'] }));
    const remove = button('mini-control', '×', 'Xoá layer');
    tap(remove, () => {
      if (this.board.layerList.length > 1) this.board.removeLayer(layer.id);
    });
    const move = (x: number, y: number, scale: number, rotation: number): void => {
      this.board.updateLayer(layer.id, {
        transform: {
          x: layer.transform.x + x,
          y: layer.transform.y + y,
          scale: Math.max(0.1, Math.min(5, layer.transform.scale + scale)),
          rotation: layer.transform.rotation + rotation,
        },
      });
    };
    const left = button('mini-control', '←', 'Dịch layer sang trái');
    const right = button('mini-control', '→', 'Dịch layer sang phải');
    const scaleDown = button('mini-control', '−', 'Thu nhỏ layer');
    const scaleUp = button('mini-control', '+', 'Phóng to layer');
    const layerRotate = button('mini-control', '↻', 'Xoay layer');
    const flipX = button('mini-control', '↔', 'Lật layer ngang');
    const flipY = button('mini-control', '↕', 'Lật layer dọc');
    const duplicate = button('mini-control', '▣', 'Nhân đôi layer');
    tap(left, () => move(-10, 0, 0, 0));
    tap(right, () => move(10, 0, 0, 0));
    tap(scaleDown, () => move(0, 0, -0.1, 0));
    tap(scaleUp, () => move(0, 0, 0.1, 0));
    tap(layerRotate, () => move(0, 0, 0, 15));
    tap(flipX, () => this.board.updateLayer(layer.id, { transform: { flipX: !layer.transform.flipX } }));
    tap(flipY, () => this.board.updateLayer(layer.id, { transform: { flipY: !layer.transform.flipY } }));
    tap(duplicate, () => this.board.duplicateLayer(layer.id));
    const addMask = button('text-control', layer.mask ? 'Mask ✓' : 'Thêm mask', 'Tạo mặt nạ layer');
    addMask.disabled = Boolean(layer.mask);
    tap(addMask, () => this.board.createLayerMask(layer.id));
    const maskInput = document.createElement('input');
    maskInput.type = 'file';
    maskInput.accept = 'image/*';
    maskInput.hidden = true;
    maskInput.addEventListener('change', () => {
      const file = maskInput.files?.[0];
      maskInput.value = '';
      if (file) {
        if (file.size > 15 * 1024 * 1024) {
          showError(new Error('Ảnh mask lớn hơn 15 MB; hãy giảm dung lượng rồi thử lại.'));
          return;
        }
        void fileToDataUrl(file).then((data) => this.board.importLayerMask(layer.id, data)).catch(showError);
      }
    });
    const importMask = button('text-control', 'Nạp mask', 'Nhập ảnh mask grayscale');
    tap(importMask, () => maskInput.click());
    const hue = range(0, 360, layer.filters.hue, 'Hue layer');
    hue.addEventListener('change', () => this.board.updateLayer(layer.id, { filters: { hue: Number(hue.value) } }));
    const saturation = range(0, 200, layer.filters.saturation, 'Saturation layer');
    saturation.addEventListener('change', () => this.board.updateLayer(layer.id, { filters: { saturation: Number(saturation.value) } }));
    const brightness = range(0, 200, layer.filters.brightness, 'Brightness layer');
    brightness.addEventListener('change', () => this.board.updateLayer(layer.id, { filters: { brightness: Number(brightness.value) } }));
    const contrast = range(0, 200, layer.filters.contrast, 'Contrast layer');
    contrast.addEventListener('change', () => this.board.updateLayer(layer.id, { filters: { contrast: Number(contrast.value) } }));
    const blur = range(0, 20, layer.filters.blur, 'Blur layer');
    blur.addEventListener('change', () => this.board.updateLayer(layer.id, { filters: { blur: Number(blur.value) } }));
    const invert = range(0, 100, layer.filters.invert, 'Invert layer');
    invert.addEventListener('change', () => this.board.updateLayer(layer.id, { filters: { invert: Number(invert.value) } }));
    const filters = group('layer-filters');
    filters.append(labelled('Hue', hue), labelled('Màu', saturation), labelled('Sáng', brightness),
      labelled('Tương phản', contrast), labelled('Đảo', invert), labelled('Mờ', blur));
    row.append(select, visibility, up, down, labelled('Alpha', alpha), opacity, blend,
      left, right, scaleDown, scaleUp, layerRotate, flipX, flipY, duplicate, addMask, importMask, maskInput, remove, filters);
    return row;
  }

  private async openGallery(): Promise<void> {
    this.galleryDialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Thư viện tranh';
    const close = button('text-control', 'Đóng', 'Đóng thư viện');
    tap(close, () => this.galleryDialog.close());
    const save = button('text-control', 'Lưu ngay', 'Lưu tranh hiện tại');
    tap(save, () => {
      void this.board.saveDocument().then(() => this.openGallery()).catch(showError);
    });
    const list = document.createElement('div');
    list.className = 'artwork-list';
    const artworks = await listArtworks();
    if (artworks.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Chưa có tranh lưu. App tự lưu sau mỗi nét vẽ.';
      list.append(empty);
    }
    for (const artwork of artworks) {
      const card = document.createElement('article');
      const open = button('text-control', `${escapeHtml(artwork.name)} · ${new Date(artwork.updatedAt).toLocaleString()}`, 'Mở tranh đã lưu');
      tap(open, () => {
        this.board.loadDocument(artwork);
        this.galleryDialog.close();
      });
      const remove = button('mini-control', '×', 'Xoá tranh đã lưu');
      tap(remove, () => {
        void deleteArtwork(artwork.id).then(() => this.openGallery()).catch(showError);
      });
      const backups = button('text-control', 'Bản sao', 'Mở các bản sao lưu tự động');
      tap(backups, () => this.openBackups(artwork.id));
      card.append(open, backups, remove);
      list.append(card);
    }
    this.galleryDialog.append(heading, close, save, list);
    this.galleryDialog.showModal();
  }

  private async openBackups(id: string): Promise<void> {
    this.galleryDialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Bản sao lưu gần đây';
    const back = button('text-control', 'Quay lại thư viện', 'Quay lại thư viện tranh');
    tap(back, () => this.openGallery());
    this.galleryDialog.append(heading, back);
    for (const backup of await listBackups(id)) {
      const restore = button(
        'text-control',
        new Date(backup.updatedAt).toLocaleString(),
        'Khôi phục bản sao lưu này',
      );
      tap(restore, () => {
        this.board.loadDocument(backup);
        this.galleryDialog.close();
      });
      this.galleryDialog.append(restore);
    }
    this.galleryDialog.showModal();
  }

  private openHelp(): void {
    this.galleryDialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Hướng dẫn Bé Vẽ';
    const content = document.createElement('p');
    content.textContent =
      'Chọn cọ, màu và cỡ rồi vẽ trên giấy. Dùng Đường thẳng/Chữ nhật/Elip để tạo hình; Đổ màu để tô vùng; Kéo canvas rồi rê để di chuyển. Thêm layer để tách phần tranh, dùng nút mắt để ẩn và thanh Mờ để chỉnh độ trong. Nhập ảnh để thêm vào layer; Xuất hỗ trợ PNG, PSD nhiều layer và tệp dự án JSON. Tranh tự lưu trên thiết bị này trong thư viện. Trên iPad, mở Safari ở chế độ Split View với ảnh tham khảo nếu cần.';
    const close = button('text-control', 'Đóng', 'Đóng hướng dẫn');
    tap(close, () => this.galleryDialog.close());
    this.galleryDialog.append(heading, content, close);
    this.galleryDialog.showModal();
  }

  private async exportCurrent(): Promise<void> {
    const format = window.prompt('Xuất định dạng: png, psd, json hoặc clipboard', 'png')?.toLowerCase();
    if (!format) return;
    let blob: Blob;
    let extension: string;
    if (format === 'json' || format === 'beve') {
      blob = new Blob([JSON.stringify(this.board.exportDocument())], { type: 'application/json' });
      extension = 'beve.json';
    } else if (format === 'clipboard') {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Safari trên thiết bị này chưa hỗ trợ sao chép ảnh vào clipboard');
      }
      const png = await this.board.toPngBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return;
    } else if (format === 'png') {
      blob = await this.board.toPngBlob();
      extension = 'png';
    } else if (format === 'psd') {
      blob = await this.board.toPsdBlob();
      extension = 'psd';
    } else {
      throw new Error(`Định dạng xuất không hỗ trợ: ${format}`);
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `be-ve-${Date.now()}.${extension}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  private async copyToClipboard(): Promise<void> {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Safari trên thiết bị này chưa hỗ trợ sao chép ảnh');
    }
    const blob = await this.board.toPngBlob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  private async pasteFromClipboard(): Promise<void> {
    if (!navigator.clipboard?.read) throw new Error('Safari trên thiết bị này chưa hỗ trợ dán ảnh');
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((mime) => mime.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const data = await fileToDataUrl(new File([blob], 'clipboard.png', { type }));
      await this.board.importImage(data, 'Ảnh từ clipboard');
      return;
    }
    throw new Error('Clipboard không có ảnh');
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.type.startsWith('image/')) {
      if (file.size > 15 * 1024 * 1024) throw new Error('Ảnh lớn hơn 15 MB; hãy giảm dung lượng rồi nhập lại.');
      const dataUrl = await fileToDataUrl(file);
      await this.board.importImage(dataUrl, file.name);
      return;
    }
    if (file.size > 30 * 1024 * 1024) throw new Error('Tệp tranh lớn hơn 30 MB; hãy giảm dung lượng rồi nhập lại.');
    const parsed: unknown = JSON.parse(await file.text());
    if (!isArtwork(parsed)) throw new Error('Tệp dự án không đúng định dạng');
    this.board.loadDocument(parsed);
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

function labelled(text: string, input: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field-label';
  label.append(document.createTextNode(text), input);
  return label;
}

function range(min: number, max: number, value: number, name: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.setAttribute('aria-label', name);
  return input;
}

function checkbox(name: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('aria-label', name);
  return input;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Không đọc được tệp'));
    reader.onerror = () => reject(reader.error ?? new Error('Không đọc được tệp ảnh'));
    reader.readAsDataURL(file);
  });
}

function isArtwork(value: unknown): value is Parameters<DrawingBoard['loadDocument']>[0] {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { id?: unknown; name?: unknown; layers?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && Array.isArray(candidate.layers);
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function readCustomColors(): string[] {
  const stored = localStorage.getItem('be-ve-colors');
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !/^#[0-9a-f]{6}$/i.test(item))) {
    throw new Error('Bảng màu đã lưu không hợp lệ');
  }
  return parsed;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsb(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, max === 0 ? 0 : (delta / max) * 100, max * 100];
}

function hsbToRgb(hue: number, saturation: number, brightness: number): [number, number, number] {
  const s = saturation / 100;
  const v = brightness / 100;
  const chroma = v * s;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r, g, b] = segment < 1 ? [chroma, x, 0] :
    segment < 2 ? [x, chroma, 0] :
      segment < 3 ? [0, chroma, x] :
        segment < 4 ? [0, x, chroma] :
          segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = v - chroma;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** pointerup thay vì click: phản hồi nhanh hơn trên iPad, không bị trễ 300ms */
function tap(el: HTMLElement, fn: () => void | Promise<void>): void {
  el.addEventListener('pointerup', (e) => {
    e.preventDefault();
    if ((el as HTMLButtonElement).disabled) return;
    try {
      void Promise.resolve(fn()).catch(showError);
    } catch (error) {
      showError(error);
    }
  });
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  window.alert(`Không thể hoàn tất thao tác: ${message}`);
}
