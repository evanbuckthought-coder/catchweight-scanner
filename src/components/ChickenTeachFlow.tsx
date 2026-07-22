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
  /** Pre-decided product type (the first-scan prompt already knows it's set). */
  initialType?: 'set' | 'random';
  onSaved: (profile: ChickenPackProfile) => void;
  onCancel: () => void;
}

type Step = 'type' | 'scan' | 'photo' | 'review' | 'analysing' | 'confirm';

/**
 * Teach a chicken product: choose its TYPE first, then identify it.
 *
 *  - SET weight: every carton identical — the set weight is entered by the
 *    user ONCE and lives on the profile; scanning then counts cartons and kg
 *    is derived. The AI photo read only suggests the description/pack size.
 *  - RANDOM weight: the barcode carries each carton's weight; nothing to
 *    enter beyond the description.
 *
 * The GTIN ALWAYS comes from a real barcode scan — never from the AI. Reading
 * barcode digits off a photo is the model's weakest skill (it fumbled a digit
 * on 2 of 3 test labels), and a profile keyed by a wrong GTIN would simply
 * never match when scanning.
 */
export function ChickenTeachFlow({ initialGtin, initialParsed, initialType, onSaved, onCancel }: ChickenTeachFlowProps) {
  const [type, setType] = useState<'set' | 'random'>(initialType ?? 'set');
  const [step, setStep] = useState<Step>(initialGtin ? 'photo' : 'type');
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

  /** Whether the scanned barcode carried its own weight (random-weight sign). */
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
      if (type === 'set' && r.weight.nominalPackKg != null) {
        setPackKg(String(r.weight.nominalPackKg));
      }
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
      type,
      // The set weight is the USER-ENTERED value (AI only pre-filled the
      // field); a random-weight product stores none — its barcode wins.
      packKg: type === 'set' && Number.isFinite(kg) && kg > 0 ? kg : null,
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

  // ---- 0. Choose the product type -------------------------------------------
  if (step === 'type') {
    return shell(
      'Teach a chicken product',
      <>
        <p className="mt-1 text-sm text-slate-400">
          First: does every carton of this product weigh the same?
        </p>
        <button
          type="button"
          data-testid="chicken-teach-type-set"
          onClick={() => {
            setType('set');
            setStep('scan');
          }}
          className="mt-4 w-full rounded-xl bg-emerald-500 p-3.5 text-left active:bg-emerald-400"
        >
          <span className="block text-base font-bold text-slate-900">📦 Set weight</span>
          <span className="block text-xs font-medium text-emerald-950/80">
            Every carton identical (e.g. 10 kg wings). Scanning COUNTS CARTONS — you enter the set
            weight once and kg is worked out from the count.
          </span>
        </button>
        <button
          type="button"
          data-testid="chicken-teach-type-random"
          onClick={() => {
            setType('random');
            setStep('scan');
          }}
          className="mt-2 w-full rounded-xl bg-sky-500 p-3.5 text-left active:bg-sky-400"
        >
          <span className="block text-base font-bold text-slate-900">⚖️ Random weight</span>
          <span className="block text-xs font-medium text-sky-950/80">
            Weight varies per carton and the barcode carries it — each scan captures the carton’s
            actual weight.
          </span>
        </button>
      </>,
    );
  }

  // ---- 1. Scan for the exact GTIN -------------------------------------------
  if (step === 'scan') {
    return shell(
      type === 'set' ? 'Scan a set-weight carton' : 'Scan a random-weight carton',
      <>
        <p className="mt-1 text-sm text-slate-400">
          Scan the carton’s barcode — that gives the exact product code.
        </p>
        <div className="mt-3">
          <ScannerView active paused={false} mode="barcode" onDecode={handleScan} onOcrRead={() => {}} />
        </div>
        {errorBox}
      </>,
    );
  }

  // The scan tells us whether the type choice matches the barcode.
  const typeMismatch =
    type === 'random' && !barcodeHasWeight ? (
      <div className="mt-3 rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-500/40">
        <p className="text-sm text-amber-200">
          This barcode carries <span className="font-bold">no weight</span> — random-weight cartons
          normally do. If every carton of this product is the same weight, it’s a set-weight line.
        </p>
        <button
          type="button"
          data-testid="chicken-teach-switch-set"
          onClick={() => setType('set')}
          className="mt-2 h-10 w-full rounded-lg bg-amber-500 text-sm font-bold text-slate-900"
        >
          Switch to set weight
        </button>
      </div>
    ) : type === 'set' && barcodeHasWeight ? (
      <p className="mt-3 rounded-xl bg-slate-800/70 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-700">
        Note: this barcode also carries a weight ({roundKg(parsed!.weightKg!).toFixed(2)} kg), but as
        a set-weight product every carton will count at your set weight.
      </p>
    ) : null;

  // ---- 2. Photograph the label (optional — AI fills the details) -------------
  if (step === 'photo') {
    return shell(
      'Photograph the label',
      <>
        <p className="mt-1 text-sm text-slate-400">
          Barcode read — <span className="font-mono text-slate-200">GTIN {gtin}</span>. Photograph the
          label and the AI fills in the description{type === 'set' ? ' and suggests the set weight' : ''},
          or skip and type it yourself.
        </p>
        {typeMismatch}
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
        <button
          type="button"
          data-testid="chicken-teach-skip-photo"
          onClick={() => setStep('confirm')}
          className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-base font-semibold text-slate-200 ring-1 ring-slate-600"
        >
          ⌨️ Skip — type it in myself
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
        {result
          ? 'Check what the AI read, correct anything, then save. This is what shows when you scan.'
          : 'Enter the product details — this is what shows when you scan.'}
      </p>

      <div className="mt-3 rounded-xl bg-slate-800/70 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-700">
        GTIN <span className="font-mono text-slate-200">{gtin}</span> (from the scan — exact) ·{' '}
        {type === 'set' ? 'set weight — counted by carton' : 'random weight — weighed per carton'}
      </div>
      {typeMismatch}

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

      {type === 'random' ? (
        <p className="mt-3 rounded-xl bg-sky-500/10 px-3 py-2 text-sm text-sky-200 ring-1 ring-sky-500/40">
          Random weight — every scan captures the carton’s actual weight from its barcode. Nothing
          else to enter.
        </p>
      ) : (
        <label className="mt-3 block text-sm font-medium text-slate-300">
          Set weight (kg per carton) *
          <input
            data-testid="chicken-teach-packkg"
            value={packKg}
            onChange={(e) => setPackKg(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 10"
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-2xl font-bold tabular-nums text-slate-100 ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <span className="mt-1 block text-xs text-slate-500">
            {result
              ? result.weight.nominalPackKg != null
                ? `AI read the pack size as ${result.weight.nominalPackKg} kg — confirm it’s right.`
                : 'AI found no pack size on the label — enter it from the description.'
              : 'The nominal size printed on the label (the 10 in “WINGS 10KG”).'}
            {printedNet ? ` · printed net on this carton: ${printedNet}` : ''}
          </span>
          <span className="mt-1 block text-xs text-slate-500">
            Saved once, used for every carton — edit later in Label Intelligence. Leave blank to
            count cartons with no kg.
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
