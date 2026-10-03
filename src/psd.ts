import type { Layer } from './drawing';

const MAX_PIXELS = 2_000_000;
const MAX_LAYERS = 8;

export interface PsdLayer {
  layer: Layer;
  pixels: ImageData;
}

export function encodePsd(width: number, height: number, layers: PsdLayer[], merged: ImageData): Blob {
  if (width * height > MAX_PIXELS) {
    throw new Error('Canvas quá lớn để xuất PSD trên iPad; hãy giảm độ phân giải trước.');
  }
  if (layers.length > MAX_LAYERS) {
    throw new Error(`PSD hiện hỗ trợ tối đa ${MAX_LAYERS} layer để tránh hết bộ nhớ.`);
  }

  const records: number[] = [];
  const channelData: Uint8Array[] = [];
  for (const { layer, pixels } of [...layers].reverse()) {
    writeI32(records, 0);
    writeI32(records, 0);
    writeI32(records, height);
    writeI32(records, width);
    writeU16(records, 4);
    for (const [channel, offset] of [[-1, 3], [0, 0], [1, 1], [2, 2]] as const) {
      writeI16(records, channel);
      writeU32(records, width * height + 2);
      const raw = new Uint8Array(width * height + 2);
      raw[0] = 0;
      raw[1] = 0;
      for (let pixel = 0; pixel < width * height; pixel++) {
        raw[pixel + 2] = pixels.data[pixel * 4 + offset];
      }
      channelData.push(raw);
    }
    records.push(0x38, 0x42, 0x49, 0x4d);
    records.push(...ascii(blendKey(layer.blendMode)));
    records.push(Math.round(layer.opacity * 255), 0, layer.visible ? 0 : 2, 0);
    const name = new TextEncoder().encode(layer.name.slice(0, 120));
    const extra: number[] = [0, 0, 0, 0, 0, 0, 0, 0, name.length, ...name];
    while (extra.length % 4 !== 0) extra.push(0);
    writeU32(records, extra.length);
    records.push(...extra);
  }

  const layerInfo = [...u16Bytes(layers.length), ...records, ...concat(channelData)];
  if (layerInfo.length % 2) layerInfo.push(0);
  const layerMask = [...u32Bytes(layerInfo.length), ...layerInfo, 0, 0, 0, 0];
  const header = [
    ...ascii('8BPS'),
    0, 1,
    0, 0, 0, 0, 0, 0,
    0, 4,
    ...u32Bytes(height),
    ...u32Bytes(width),
    0, 8,
    0, 3,
  ];
  const pixelCount = width * height;
  const mergedRgb = new Uint8Array(pixelCount * 3 + 2);
  for (let i = 0; i < width * height; i++) {
    mergedRgb[2 + i] = merged.data[i * 4];
    mergedRgb[2 + pixelCount + i] = merged.data[i * 4 + 1];
    mergedRgb[2 + pixelCount * 2 + i] = merged.data[i * 4 + 2];
  }

  return new Blob([
    new Uint8Array(header),
    new Uint8Array([0, 0, 0, 0]),
    new Uint8Array([0, 0, 0, 0]),
    new Uint8Array(u32Bytes(layerMask.length)),
    new Uint8Array(layerMask),
    mergedRgb,
  ], { type: 'image/vnd.adobe.photoshop' });
}

function ascii(value: string): number[] {
  return [...value].map((char) => char.charCodeAt(0));
}

function writeU16(target: number[], value: number): void {
  target.push((value >>> 8) & 255, value & 255);
}

function writeI16(target: number[], value: number): void {
  writeU16(target, value & 0xffff);
}

function writeI32(target: number[], value: number): void {
  writeU32(target, value >>> 0);
}

function writeU32(target: number[], value: number): void {
  target.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function u16Bytes(value: number): number[] {
  return [(value >>> 8) & 255, value & 255];
}

function u32Bytes(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function concat(values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }

  return output;
}

function blendKey(mode: Layer['blendMode']): string {
  switch (mode) {
    case 'multiply': return 'mul ';
    case 'screen': return 'scrn';
    case 'overlay': return 'over';
    case 'darken': return 'dark';
    case 'lighten': return 'lite';
    default: return 'norm';
  }
}
