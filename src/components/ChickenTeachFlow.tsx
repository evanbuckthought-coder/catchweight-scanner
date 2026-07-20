import { useMemo, useRef, useState } from 'react';
import { ScannerView } from './ScannerView';
import { parseGS1, type ParsedCarton } from '../lib/gs1';
import { analyseLabel, compressLabelImage, TeachError, type CompressedLabelImage } from '../lib/teach';
import type { TeachResult } from '../lib/teachShared';
import { upsertChickenPack, type ChickenPackProfile } from '../lib/chicken';
import { roundKg } from '../lib/units';

interface ChickenTeachFlowProps {
  /** Known GTIN (when launched from a scan that already identified it). */
  initialGtin?: string;
  /** The scan that triggered it — tells us if the barcode carries a weight. */
  initialParsed?: ParsedCarton;
  onSaved: (profile: ChickenPackProfile) => void;
  onCancel: () => void;
}

type Step = 'scan' | 'photo' | 'review' | 'analysing' | 'confirm';

/**
 * Teach a chicken label with the AI, so counting is fast and named later.
 *
 * The GTIN ALWAYS comes from a real barcode scan — never from the AI. Reading
 * barcode digits off a photo is the model's weakest skill (it fumbled a digit
 * on 2 of 3 test labels), and a profile keyed by a wrong GTIN would simply
 * never match when scanning. The AI is used for what it reads reliably: the
 * product description and the nominal pack size.
 */
export function ChickenTeachFlow({ initialGtin, initialParsed, onSaved, onCancel }: ChickenTeachFlowProps) {
  const [step, setStep] = useState<Step>(initialGtin ? 'photo' : 'scan');
  const [gtin, setGtin] = useState(initialGtin ?? '');
  const [parsed, setParsed] = useState<ParsedCarton | undefined>(initialParsed);
  const [image, setImage] = useState<CompressedLabelImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TeachResult | null>(null);
  const [product, setProduct] = useState('');
  const [packKg, setPackKg] = useState('');
  const inFlightRef = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  /** A barcode that carries its own weight needs no learned carton weight. */
  const barcodeHasWeight = parsed?.weightKg != null;

  const previewUrl = useMemo(
    () => (image ? `data:${image.mediaType};base64,${image.base64}` : null),
    [image],
  );

  const handleScan = (raw: string) => {
    const p = parseGS1(raw);
    if (!p.gtin) {
      setError('Not the GS1 barcode — scan the one starting (01)');
      return;
    }
    setError(null);
    setGtin(p.gtin);
    setParsed(p);
    setStep('photo');
  };

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
      const r = await analyseLabel(image, 'This is a chicken carton label. I need the product description and the nominal carton/pack size.');
      setResult(r);
      setProduct(r.product.value?.trim() ?? '');
      setPackKg(r.weight.nominalPackKg != null ? String(r.weight.nominalPackKg) : '');
      setStep('confirm');
    } catch (err) {
      setError(err instanceof TeachError ? err.message : 'Analysis failed — try again.');
      setStep('review');
    } finally {
      inFlightRef.current = false;
    }
  };

  const save = () => {
    const kg = Number(packKg);
    const profile: ChickenPackProfile = {
      gtin,
      product: product.trim(),
      // A weight-bearing barcode always wins at scan time, so no pack weight
      // is stored for it; a set-weight line keeps the confirmed figure.
      packKg: barcodeHasWeight ? null : Number.isFinite(kg) && kg > 0 ? kg : null,
      updatedAt: new Date().toISOString(),
    };
    upsertChickenPack(profile);
    onSaved(profile);
  };

  const shell = (title: string, body: React.ReactNode) => (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div className="max-h-[94vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />
        <h2 className="text-lg font-bold text-slate-100">{title}</h2>
        {body}
        <button
          type="button"
          data-testid="chicken-teach-cancel"
          onClick={onCancel}
          className="mt-3 h-12 w-full rounded-xl bg-slate-800 text-sm font-medium text-slate-400 ring-1 ring-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const errorBox = error && (
    <div data-testid="chicken-teach-error" className="mt-3 rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
      <p className="text-sm text-rose-200">{error}</p>
      <p className="mt-1 text-xs text-rose-300/70">Nothing was saved.</p>
    </div>
  );

  // ---- 1. Scan for the exact GTIN -------------------------------------------
  if (step === 'scan') {
    return shell(
      'Teach a chicken label',
      <>
        <p className="mt-1 text-sm text-slate-400">
          First scan the carton’s barcode — that gives the exact product code. Then photograph the
          label and the AI reads its description and pack size.
        </p>
        <div className="mt-3">
          <ScannerView active paused={false} mode="barcode" onDecode={handleScan} onOcrRead={() => {}} />
        </div>
        {errorBox}
      </>,
    );
  }

  // ---- 2. Photograph the label ----------------------------------------------
  if (step === 'photo') {
    return shell(
      'Photograph the label',
      <>
        <p className="mt-1 text-sm text-slate-400">
          Barcode read — <span className="font-mono text-slate-200">GTIN {gtin}</span>
          {barcodeHasWeight && (
            <span className="text-emerald-300"> · carries its own weight ({roundKg(parsed!.weightKg!).toFixed(2)} kg)</span>
          )}
          . Now photograph the whole label.
        </p>
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
          data-testid="chicken-teach-file"
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
          data-testid="chicken-teach-camera"
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
        <p className="mt-2 text-xs text-slate-500">
          Analysing uses a paid AI call (a few cents) and needs internet — once per product.
        </p>
        {errorBox}
      </>,
    );
  }

  // ---- 3. Review + analyse ---------------------------------------------------
  if (step === 'review' || step === 'analysing') {
    const analysing = step === 'analysing';
    return shell(
      analysing ? 'Analysing label…' : 'Use this photo?',
      <>
        {previewUrl && (
          <img src={previewUrl} alt="Label" className="mt-3 max-h-64 w-full rounded-xl object-contain ring-1 ring-slate-700" />
        )}
        {errorBox}
        <button
          type="button"
          data-testid="chicken-teach-analyse"
          disabled={analysing}
          onClick={() => void analyse()}
          className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-base font-bold text-slate-900 disabled:opacity-60"
        >
          {analysing ? '🤖 Reading the label…' : error ? '↻ Retry analysis' : '🤖 Read the label'}
        </button>
        {analysing && (
          <p className="mt-2 text-center text-xs text-slate-500">Needs connectivity · 15–30 seconds…</p>
        )}
        {!analysing && (
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
        )}
      </>,
    );
  }

  // ---- 4. Confirm + save ------------------------------------------------------
  const printedNet = result?.weight.printedExample;
  return shell(
    'Confirm the product',
    <>
      <p className="mt-1 text-sm text-slate-400">
        Check what the AI read, correct anything, then save. This is what shows when you scan.
      </p>

      <div className="mt-3 rounded-xl bg-slate-800/70 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-700">
        GTIN <span className="font-mono text-slate-200">{gtin}</span> (from the scan — exact)
      </div>

      <label className="mt-3 block text-sm font-medium text-slate-300">
        Product description *
        <input
          data-testid="chicken-teach-product"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          placeholder="e.g. FS FDSERV WINGS 10KG"
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
      </label>

      {barcodeHasWeight ? (
        <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 ring-1 ring-emerald-500/40">
          This barcode carries its own weight, so every carton counts at its exact scanned weight —
          no carton weight needed.
        </p>
      ) : (
        <label className="mt-3 block text-sm font-medium text-slate-300">
          Carton weight (kg) — set-weight line
          <input
            data-testid="chicken-teach-packkg"
            value={packKg}
            onChange={(e) => setPackKg(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 10"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-2xl font-bold tabular-nums text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <span className="mt-1 block text-xs text-slate-500">
            {result?.weight.nominalPackKg != null
              ? `AI read the pack size as ${result.weight.nominalPackKg} kg`
              : 'AI found no pack size on the label — enter it from the description.'}
            {printedNet ? ` · printed net weight on this carton: ${printedNet}` : ''}
          </span>
          <span className="mt-1 block text-xs text-slate-500">
            Leave blank to count these cartons without adding kg.
          </span>
        </label>
      )}

      <button
        type="button"
        data-testid="chicken-teach-save"
        disabled={!product.trim()}
        onClick={save}
        className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-lg font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
      >
        ✓ Save — ready to scan
      </button>
    </>,
  );
}
