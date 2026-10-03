/**
 * Lưu tranh. Trên iPad: mở bảng Chia sẻ → bé/bố mẹ chọn "Lưu hình ảnh"
 * để vào app Ảnh. Trình duyệt máy tính: tải file PNG xuống.
 */
export async function saveImage(blob: Blob): Promise<void> {
  const name = `be-ve-${timestamp()}.png`;
  const file = new File([blob], name, { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      // Người dùng bấm Huỷ → không làm gì
      if ((err as DOMException).name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
