/**
 * Printing to a NIIMBOT label printer over Web Bluetooth, via
 * {@link https://github.com/MultiMote/niimbluelib | @mmote/niimbluelib} — the
 * library behind NiimBlue.
 *
 * The library is loaded with a dynamic import so that it is only fetched when
 * you actually print, and so that a problem with it (it is alpha, and pinned
 * exactly for that reason) can never stop the rest of the app from loading.
 */

export interface PrintOptions {
  /** A key of the library's `printTasks`, or empty to detect from the printer. */
  printTask: string;
  density: number;
  quantity: number;
}

export type PrintStatus = (message: string) => void;

/**
 * Every browser on iOS is Safari underneath — Chrome included — so no amount of
 * https will produce Web Bluetooth there. Worth saying plainly, or you spend an
 * afternoon setting up certificates for something that cannot work.
 */
const isIOS = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Web Bluetooth exists only in a secure context: https, or localhost. */
export function bluetoothAvailable(): { ok: boolean; reason?: string } {
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
    return {
      ok: false,
      reason: isIOS()
        ? 'iPhones and iPads have no Web Bluetooth in any browser — Chrome on iOS is Safari underneath. Print from the machine the printer is paired with; "Print sheet" and "Save PNG" still work here.'
        : window.isSecureContext
          ? 'This browser has no Web Bluetooth. Chrome, Edge or Opera on desktop or Android will work; Safari and Firefox will not.'
          : `Web Bluetooth needs a secure context, and this page is on ${window.location.origin}. Open the app at http://localhost:5178 on the machine the printer is paired with, or serve it over https.`,
    };
  }
  return { ok: true };
}

/** Print task names the library knows about, for the settings dropdown. */
export async function printTaskNames(): Promise<string[]> {
  const lib = await import('@mmote/niimbluelib');
  return [...lib.printTaskNames];
}

/**
 * Connect, print every canvas, disconnect. Each canvas is one label; the whole
 * batch goes out in a single connection so the printer is only woken once.
 */
export async function printLabels(
  canvases: HTMLCanvasElement[],
  options: PrintOptions,
  onStatus: PrintStatus = () => {}
): Promise<void> {
  if (!canvases.length) return;

  const check = bluetoothAvailable();
  if (!check.ok) throw new Error(check.reason);

  onStatus('Loading printer library…');
  const lib = await import('@mmote/niimbluelib');

  const client = new lib.NiimbotBluetoothClient();
  onStatus('Choose your printer in the browser prompt…');
  await client.connect();

  try {
    const meta = client.getModelMetadata();
    const taskName =
      (options.printTask as never) ||
      (meta ? lib.findPrintTask(meta.model) : undefined) ||
      ('D110' as never);

    onStatus(`Printing ${canvases.length} label${canvases.length === 1 ? '' : 's'}…`);

    // Print direction is a property of the printhead, not of the label.
    const direction = meta?.printDirection ?? 'left';
    const encoded = canvases.map((c) => lib.ImageEncoder.encodeCanvas(c, direction));

    const task = client.abstraction.newPrintTask(taskName, {
      totalPages: encoded.length * options.quantity,
      density: options.density,
      labelType: lib.LabelType.WithGaps,
    });

    await task.printInit();
    for (let i = 0; i < encoded.length; i++) {
      onStatus(`Printing label ${i + 1} of ${encoded.length}…`);
      await task.printPage(encoded[i], options.quantity);
      await task.waitForPageFinished();
    }
    await task.waitForFinished();
    await task.printEnd();
    onStatus('Done.');
  } finally {
    // Always hand the printer back, even if a page failed halfway through.
    try {
      await client.disconnect();
    } catch {
      /* already gone */
    }
  }
}
