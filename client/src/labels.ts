import QRCode from 'qrcode';

/** What goes on one label. */
export interface LabelSpec {
  title: string;
  /** Where it lives, e.g. `Workshop › Double Door Closet`. */
  path?: string;
  /** Its address in its parent, e.g. `R3·C2`. */
  address?: string;
  /** Encoded into the QR — scanning it should open this container. */
  qrUrl?: string;
}

export interface LabelStyle {
  widthMm: number;
  heightMm: number;
  /** Niimbot printers are 203 dpi, which is exactly 8 dots per millimetre. */
  dpi: number;
  showPath: boolean;
  showAddress: boolean;
  showQr: boolean;
}

/**
 * Common NIIMBOT label stock, named the way the packet is — tape width first.
 * `w`/`h` are the canvas in reading orientation, so the long side is across.
 * Rotate in the dialog if your roll feeds the other way.
 */
export const LABEL_PRESETS: { name: string; w: number; h: number }[] = [
  { name: '12 × 30 mm', w: 30, h: 12 },
  { name: '12 × 22 mm', w: 22, h: 12 },
  { name: '12 × 40 mm', w: 40, h: 12 },
  { name: '14 × 28 mm', w: 28, h: 14 },
  { name: '15 × 30 mm', w: 30, h: 15 },
  { name: '15 × 50 mm', w: 50, h: 15 },
  { name: '20 × 30 mm', w: 30, h: 20 },
  { name: '25 × 25 mm', w: 25, h: 25 },
  { name: '30 × 40 mm', w: 40, h: 30 },
  { name: '40 × 60 mm', w: 60, h: 40 },
  { name: '50 × 30 mm', w: 50, h: 30 },
  { name: '50 × 80 mm', w: 80, h: 50 },
];

export const mmToPx = (mm: number, dpi: number): number => Math.round((mm / 25.4) * dpi);

/**
 * The address a QR code should send a phone to. Falls back to wherever this
 * page is, which is only right when that is somewhere the phone can also
 * reach — hence the override.
 */
export function labelOrigin(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (!trimmed) return window.location.origin;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * Draw one label onto a fresh canvas at printer resolution. Pure black on pure
 * white — a thermal printer has no greys, so anything mid-tone would dither
 * into noise.
 */
export async function renderLabel(spec: LabelSpec, style: LabelStyle): Promise<HTMLCanvasElement> {
  const w = mmToPx(style.widthMm, style.dpi);
  const h = mmToPx(style.heightMm, style.dpi);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  // On a 12 mm tape there is only room for the name and its address; the full
  // path would shrink the title to something you cannot read at arm's length.
  const roomForPath = style.heightMm >= 16;
  const showPath = style.showPath && !!spec.path && roomForPath;

  const pad = Math.round(h * 0.06);
  let textRight = w - pad;

  if (style.showQr && spec.qrUrl) {
    const side = Math.min(h - pad * 2, Math.round(w * 0.4));
    const qr = document.createElement('canvas');
    await QRCode.toCanvas(qr, spec.qrUrl, {
      margin: 0,
      width: side,
      color: { dark: '#000000ff', light: '#ffffffff' },
    });
    ctx.drawImage(qr, w - pad - side, Math.round((h - side) / 2), side, side);
    textRight = w - pad * 2 - side;
  }

  const textWidth = textRight - pad;
  let y = pad;

  if (style.showAddress && spec.address) {
    const size = Math.max(10, Math.round(h * 0.13));
    ctx.font = `${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(clip(ctx, spec.address, textWidth), pad, y);
    y += Math.round(size * 1.25);
  }

  // The name is the thing you read from across the room: give it every pixel
  // left over, then shrink only as far as needed to fit two lines.
  const remaining = h - pad - y - (showPath ? Math.round(h * 0.16) : 0);
  const titleSize = fitTitle(ctx, spec.title, textWidth, remaining);
  ctx.font = `700 ${titleSize}px "Segoe UI", system-ui, sans-serif`;
  for (const line of wrap(ctx, spec.title, textWidth, 2)) {
    ctx.fillText(line, pad, y);
    y += Math.round(titleSize * 1.1);
  }

  if (showPath && spec.path) {
    const size = Math.max(9, Math.round(h * 0.1));
    ctx.font = `${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(clip(ctx, spec.path, textWidth), pad, h - pad - size);
  }

  return canvas;
}

/** Largest font size at which the title fits the box in at most two lines. */
function fitTitle(ctx: CanvasRenderingContext2D, text: string, width: number, height: number): number {
  for (let size = Math.round(height * 0.75); size > 8; size -= 1) {
    ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    // Measure the *unclipped* lines: asking whether the already-truncated text
    // fits would say yes at every size, and the largest one would always win.
    const lines = wrap(ctx, text, width, 2, false);
    if (lines.length * size * 1.1 <= height && lines.every((l) => ctx.measureText(l).width <= width)) {
      return size;
    }
  }
  return 9;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  maxLines: number,
  clipLast = true
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (!lines.length) return [text];
  if (clipLast) lines[lines.length - 1] = clip(ctx, lines[lines.length - 1], width);
  return lines;
}

function clip(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Canvas to a PNG blob, for downloading or dropping into another tool. */
export const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

/**
 * Hand a batch of labels to the browser's own print dialogue, laid out at their
 * true physical size. The fallback for when the Niimbot is not to hand.
 */
export function printSheet(canvases: HTMLCanvasElement[], style: LabelStyle): void {
  const win = window.open('', '_blank');
  if (!win) return;
  const imgs = canvases
    .map(
      (c) =>
        `<img src="${c.toDataURL('image/png')}" style="width:${style.widthMm}mm;height:${style.heightMm}mm">`
    )
    .join('');
  win.document.write(
    `<!doctype html><title>Labels</title><style>
      @page { margin: 8mm; }
      body { margin: 0; font-family: sans-serif; }
      .sheet { display: flex; flex-wrap: wrap; gap: 3mm; }
      img { border: 1px solid #ddd; }
     </style><div class="sheet">${imgs}</div>
     <script>window.onload=()=>window.print()<\/script>`
  );
  win.document.close();
}
