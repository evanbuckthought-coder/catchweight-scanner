import { useMemo, useRef, useState } from 'react';
import { analyseBarcode, compressLabelImage, TeachError, type CompressedLabelImage } from '../lib/teach';
import {
  coerceBarcodeMap,
  markMapConfirmed,
  saveBarcodeMap,
  validateProposedMap,
  type BarcodeFormatMap,
  type DecodedBarcode,
  type SavedBarcodeMap,
} from '../lib/barcodeMaps';
import { roundKg } from '../lib/units';

interface BarcodeTeachFlowProps {
  /** The EXACT string the scanner read — the only source of counted digits. */
  raw: string;
  /** Why the parser couldn't read it (shown so the operator has context). */
  reason?: string;
  /** Saved + confirmed: the caller counts this carton from `decoded`. */
  onSaved: (decoded: DecodedBarcode, map: SavedBarcodeMap) => void;
  /** Switch to keying the weight by hand (always available, works offline). */
  onManual: () => void;
  onCancel: () => void;
}

type Step = 'offer' | 'photo' | 'review' | 'analysing' | 'confirm';

/**
 * Teach the app a non-GS1 barcode format.
 *
 * The AI is shown the label photo AND the exact scanned string, and returns a
 * FORMAT MAP (which positions mean what). That map is then re-applied to the
 * scanner's own digits IN CODE — if the re-decode fails any guard (weight out
 * of carton range, impossible date, low confidence, the AI's own cross-check
 * failing) nothing is saved. What the human confirms on the last screen is
 * the ON-DEVICE decode, not the AI's reading.
 */
export function BarcodeTeachFlow({ raw, reason, onSaved, onManual, onCancel }: BarcodeTeachFlowProps) {
  const [step, setStep] = useState<Step>('offer');
  const [image, setImage] = useState<CompressedLabelImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<BarcodeFormatMap | null>(null);
  const [decoded, setDecoded] = useState<DecodedBarcode | null>(null);
  /** Operator corrections on the confirm screen (kg / production date). */
  const [weightEdit, setWeightEdit] = useState('');
  const [dateEdit, setDateEdit] = useState('');
  const inFlightRef = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(
    () => (image ? `data:${image.mediaType};base64,${image.base64}` : null),
    [image],
  );

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setImage(await compressLabelImage(file));
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo — try again.');
    }
  };

  const analyse = async () => {
    if (!image || inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setStep('analysing');
    try {
      const proposed = coerceBarcodeMap(await analyseBarcode(image, raw.trim()));
      if (!proposed) {
        setError('The AI didn’t return a usable barcode format — try a sharper photo of the whole label.');
        setStep('review');
        return;
      }
      // The map is only a proposal until the SCANNER's digits, decoded here,
      // survive every guard. The AI's own verification flags are checked too,
      // but they are never sufficient on their own.
      const check = validateProposedMap(proposed, raw.trim());
      if (!check.ok) {
        setError(check.reason);
        setStep('review');
        return;
      }
      setMap(proposed);
      setDecoded(check.decoded);
      setWeightEdit(roundKg(check.decoded.weightKg).toFixed(2));
      setDateEdit(check.decoded.productionDate ?? '');
      setStep('confirm');
    } catch (err) {
      setError(err instanceof TeachError ? err.message : 'Analysis failed — try again.');
      setStep('review');
    } finally {
      inFlightRef.current = false;
    }
  };

  const save = () => {
    if (!map || !decoded) return;
    const kg = Number(weightEdit);
    const corrected: DecodedBarcode = {
      ...decoded,
      // An operator correction applies to THIS carton only — the saved map is
      // unchanged, so a wrong map can't be blessed by editing its output.
      ...(Number.isFinite(kg) && kg > 0 ? { weightKg: kg, netWeight: decoded.unit === 'kg' ? kg : decoded.netWeight } : {}),
      ...(dateEdit ? { productionDate: dateEdit } : {}),
    };
    const saved = saveBarcodeMap(map, raw.trim());
    markMapConfirmed(saved.id); // human just checked it against the carton
    onSaved(corrected, saved);
  };

  const shell = (title: string, body: React.ReactNode) => (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div
        data-testid="barcode-teach-sheet"
        className="max-h-[94vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />
        <h2 className="text-lg font-bold text-slate-100">{title}</h2>
        {body}
        <button
          type="button"
          data-testid="barcode-teach-cancel"
          onClick={onCancel}
          className="mt-3 h-12 w-full rounded-xl bg-slate-800 text-sm font-medium text-slate-400 ring-1 ring-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const scannedBox = (
    <div className="mt-3 rounded-xl bg-slate-800/70 px-3 py-2 ring-1 ring-slate-700">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">Scanned barcode</div>
      <div className="break-all font-mono text-sm text-slate-200">{raw}</div>
    </div>
  );

  const errorBox = error && (
    <div data-testid="barcode-teach-error" className="mt-3 rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
      <p className="text-sm text-rose-200">{error}</p>
      <p className="mt-1 text-xs text-rose-300/70">Nothing was saved — you can retry or enter the weight by hand.</p>
    </div>
  );

  // ---- 1. Offer: AI analysis or manual --------------------------------------
  if (step === 'offer') {
    return shell(
      'Barcode not recognised',
      <>
        <p className="mt-1 text-sm text-slate-400">
          {reason ?? 'This isn’t a GS1 barcode the app can read.'} If the carton’s weight is printed
          on the label, the AI can work out how this barcode is laid out — once per format, then it
          scans normally offline.
        </p>
        {scannedBox}
        <button
          type="button"
          data-testid="barcode-teach-start"
          onClick={() => setStep('photo')}
          className="mt-4 h-14 w-full rounded-xl bg-indigo-500 text-base font-bold text-white active:bg-indigo-400"
        >
          🤖 Analyse barcode with AI
          <span className="block text-[11px] font-medium text-indigo-100/80">
            needs internet · once per barcode format
          </span>
        </button>
        <button
          type="button"
          data-testid="barcode-teach-manual"
          onClick={onManual}
          className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-base font-semibold text-slate-200 ring-1 ring-slate-600"
        >
          ⌨️ Enter the weight by hand
        </button>
      </>,
    );
  }

  // ---- 2. Photograph the label ----------------------------------------------
  if (step === 'photo') {
    return shell(
      'Photograph the whole label',
      <>
        <p className="mt-1 text-sm text-slate-400">
          Capture the <span className="font-semibold text-slate-200">whole label</span> so the printed
          net weight, dates and product code are readable. The AI matches those printed values against
          the scanned digits to work out the format.
        </p>
        {scannedBox}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={galleryRef}
          data-testid="barcode-teach-file"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          data-testid="barcode-teach-camera"
          onClick={() => cameraRef.current?.click()}
          className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-base font-bold text-slate-900 active:bg-emerald-400"
        >
          📷 Take a photo of the label
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-base font-semibold text-slate-200 ring-1 ring-slate-600"
        >
          🖼 Choose an existing photo
        </button>
        {errorBox}
      </>,
    );
  }

  // ---- 3. Review + analyse ---------------------------------------------------
  if (step === 'review' || step === 'analysing') {
    const analysing = step === 'analysing';
    return shell(
      analysing ? 'Working out the format…' : 'Use this photo?',
      <>
        {previewUrl && (
          <img src={previewUrl} alt="Label" className="mt-3 max-h-64 w-full rounded-xl object-contain ring-1 ring-slate-700" />
        )}
        {errorBox}
        <button
          type="button"
          data-testid="barcode-teach-analyse"
          disabled={analysing}
          onClick={() => void analyse()}
          className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-base font-bold text-slate-900 disabled:opacity-60"
        >
          {analysing ? '🤖 Matching printed values to the digits…' : error ? '↻ Retry analysis' : '🤖 Analyse the barcode'}
        </button>
        {analysing && (
          <p className="mt-2 text-center text-xs text-slate-500">Needs connectivity · 15–30 seconds…</p>
        )}
        {!analysing && (
          <>
            <button
              type="button"
              onClick={() => {
                setImage(null);
                setError(null);
                setStep('photo');
              }}
              className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-sm font-semibold text-slate-200 ring-1 ring-slate-600"
            >
              ‹ Retake photo
            </button>
            <button
              type="button"
              data-testid="barcode-teach-manual-2"
              onClick={onManual}
              className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-sm font-semibold text-slate-200 ring-1 ring-slate-600"
            >
              ⌨️ Enter the weight by hand instead
            </button>
          </>
        )}
      </>,
    );
  }

  // ---- 4. Human confirm (nothing saves without this) -------------------------
  const kgValid = Number(weightEdit) > 0;
  return shell(
    'Check this against the label',
    <>
      <p className="mt-1 text-sm text-slate-400">
        Decoded from the <span className="font-semibold text-slate-200">scanned digits</span> using the
        format the AI worked out. Check each value against what’s printed on the carton.
      </p>
      {scannedBox}

      <div className="mt-3 rounded-xl bg-slate-800/70 p-3 ring-1 ring-slate-700">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">{map?.formatName}</div>
        <dl className="mt-1 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">Product code</dt>
            <dd data-testid="barcode-teach-product" className="font-mono text-slate-100">
              {decoded?.productCode ?? '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">Serial</dt>
            <dd className="font-mono text-slate-100">{decoded?.serial ?? '—'}</dd>
          </div>
        </dl>
      </div>

      <label className="mt-3 block text-sm font-medium text-slate-300">
        Net weight (kg) *
        <input
          data-testid="barcode-teach-weight"
          value={weightEdit}
          onChange={(e) => setWeightEdit(e.target.value)}
          inputMode="decimal"
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-3xl font-bold tabular-nums text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        <span className="mt-1 block text-xs text-slate-500">
          Decoded {roundKg(decoded?.weightKg ?? 0).toFixed(2)} kg
          {decoded?.unit === 'lb' ? ` (${decoded.netWeight.toFixed(2)} lb on the label)` : ''}
          {map?.fields.netWeight?.printedValueSeen ? ` · AI read "${map.fields.netWeight.printedValueSeen}" printed` : ''}
        </span>
      </label>

      <label className="mt-3 block text-sm font-medium text-slate-300">
        Production date
        <input
          data-testid="barcode-teach-date"
          type="date"
          value={dateEdit}
          onChange={(e) => setDateEdit(e.target.value)}
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
      </label>

      {errorBox}

      <button
        type="button"
        data-testid="barcode-teach-save"
        disabled={!kgValid}
        onClick={save}
        className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-lg font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
      >
        ✓ Matches the label — save format &amp; count
      </button>
      <p className="mt-2 text-xs text-slate-500">
        Saved formats are listed in Label Intelligence, where you can delete one to relearn it. Every
        later scan is decoded on-device and re-checked before it counts.
      </p>
      <button
        type="button"
        data-testid="barcode-teach-reject"
        onClick={onManual}
        className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-sm font-semibold text-slate-200 ring-1 ring-slate-600"
      >
        ✕ Doesn’t match — enter by hand instead
      </button>
    </>,
  );
}
