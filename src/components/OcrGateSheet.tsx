interface OcrGateSheetProps {
  /** Session supplier — names whose label is missing a profile. */
  supplier: string;
  /** Manual entry needs an active product (same rule as the main manual button). */
  canManual: boolean;
  onTeach: () => void;
  onManual: () => void;
  onClose: () => void;
}

/**
 * The OCR teach gate: OCR weight mode is only allowed for labels with a
 * taught profile — blind OCR on an unknown layout reads the wrong numbers.
 * This sheet appears instead of enabling OCR and never dead-ends: teach the
 * label now (AI, needs connectivity) or fall back to manual entry.
 */
export function OcrGateSheet({ supplier, canManual, onTeach, onManual, onClose }: OcrGateSheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        data-testid="ocr-gate"
        className="rounded-t-3xl bg-slate-900 p-5 pb-8 ring-1 ring-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-600" />
        <h2 className="text-lg font-bold">🔤 This label hasn’t been taught yet</h2>
        <p className="mt-1 text-sm text-slate-400">
          OCR needs a label profile to read accurately — no taught profile matches{' '}
          <span className="font-semibold text-slate-200">{supplier}</span> (or this product’s
          barcode). Teach it once and OCR configures itself to this label.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            data-testid="ocr-gate-teach"
            onClick={onTeach}
            className="rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-slate-900 active:bg-emerald-400"
          >
            🤖 Teach this label now
            <span className="block text-xs font-medium text-emerald-950/80">
              photograph it once — needs internet, ~30 seconds
            </span>
          </button>

          {canManual ? (
            <button
              type="button"
              data-testid="ocr-gate-manual"
              onClick={onManual}
              className="rounded-xl bg-slate-800 py-3.5 text-base font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700"
            >
              ✎ Enter weights manually for now
            </button>
          ) : (
            <p className="rounded-xl bg-slate-800/60 px-3 py-2.5 text-xs text-slate-500 ring-1 ring-slate-700">
              Manual entry unlocks after the first carton starts a product (scan its barcode, or
              teach the label and OCR the first carton).
            </p>
          )}

          <button
            type="button"
            data-testid="ocr-gate-close"
            onClick={onClose}
            className="rounded-xl bg-slate-800 py-3 text-sm font-medium text-slate-400 ring-1 ring-slate-700"
          >
            Keep scanning barcodes
          </button>
        </div>
      </div>
    </div>
  );
}
