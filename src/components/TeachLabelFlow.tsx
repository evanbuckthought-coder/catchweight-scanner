import { useMemo, useRef, useState } from 'react';
import type { GtinProfile } from '../types';
import type { WeightUnit } from '../lib/units';
import { uid } from '../lib/storage';
import { upsertOcrProfile } from '../lib/ocrProfiles';
import { analyseLabel, compressLabelImage, TeachError, type CompressedLabelImage } from '../lib/teach';
import type { TeachResult } from '../lib/teachShared';

interface TeachLabelFlowProps {
  /** Existing GTIN profiles, to preserve a known fingerprint on update. */
  gtinProfiles: Record<string, GtinProfile>;
  onUpsertGtinProfile: (profile: GtinProfile) => void;
  /** A profile was saved — return to the Label Intelligence menu. */
  onSaved: (profileName: string) => void;
  onCancel: () => void;
}

type Step = 'pick' | 'review' | 'analysing' | 'confirm';

/** Editable state on the confirm screen, seeded from the AI result. */
interface ConfirmFields {
  name: string; // manufacturer else supplier — keys the OCR profile
  product: string;
  gtin: string;
  unit: WeightUnit | '';
  decimalPlaces: string;
  weightRegion: string;
  anchorText: string;
}

function seedFields(r: TeachResult): ConfirmFields {
  return {
    name: r.manufacturer.value?.trim() || r.supplier.value?.trim() || '',
    product: r.product.value?.trim() ?? '',
    gtin: (r.gtin.value ?? '').replace(/\D/g, ''),
    unit: r.weight.unit ?? '',
    decimalPlaces: r.weight.decimalPlaces === null ? '' : String(r.weight.decimalPlaces),
    weightRegion: r.weight.region ?? '',
    anchorText: r.weight.anchorText ?? '',
  };
}

const confidenceDot: Record<string, string> = {
  high: 'text-emerald-400',
  medium: 'text-amber-400',
  low: 'text-rose-400',
};

/**
 * "Teach a new label": photograph a whole carton label once, have the vision
 * AI read it server-side (/api/teach-label), verify/correct every field on
 * the confirm screen, then save the layout as an OCR label profile (and the
 * GTIN profile when a barcode number was identified).
 *
 * Non-negotiables enforced here:
 *  - nothing is saved without explicit confirmation (analyse failure saves
 *    nothing; Cancel saves nothing);
 *  - the profile stores LAYOUT/FORMAT only — never a weight value;
 *  - one AI call per explicit tap, double-submits blocked while in flight.
 */
export function TeachLabelFlow({ gtinProfiles, onUpsertGtinProfile, onSaved, onCancel }: TeachLabelFlowProps) {
  const [step, setStep] = useState<Step>('pick');
  const [image, setImage] = useState<CompressedLabelImage | null>(null);
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TeachResult | null>(null);
  const [fields, setFields] = useState<ConfirmFields | null>(null);
  /** AI-proposed values, kept to compute provenance (what the human changed). */
  const aiSeedRef = useRef<ConfirmFields | null>(null);
  const inFlightRef = useRef(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

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

  const runAnalysis = async () => {
    if (!image || inFlightRef.current) return; // block accidental double-taps
    inFlightRef.current = true;
    setError(null);
    setStep('analysing');
    try {
      const r = await analyseLabel(image, hint);
      const seed = seedFields(r);
      aiSeedRef.current = seed;
      setResult(r);
      setFields(seed);
      setStep('confirm');
    } catch (err) {
      // Nothing saved on failure — back to review with a clear error + retry.
      setError(err instanceof TeachError ? err.message : 'Analysis failed — try again.');
      setStep('review');
    } finally {
      inFlightRef.current = false;
    }
  };

  const save = () => {
    if (!result || !fields || !fields.name.trim()) return;
    const now = new Date().toISOString();
    const seed = aiSeedRef.current;
    // Provenance: fields the operator accepted from the AI unedited.
    const aiFields = seed
      ? (Object.keys(fields) as (keyof ConfirmFields)[]).filter((k) => fields[k] === seed[k])
      : [];

    const dp = fields.decimalPlaces.trim() === '' ? null : Number(fields.decimalPlaces);
    upsertOcrProfile({
      id: uid(),
      name: fields.name.trim(),
      description: fields.product.trim() || undefined,
      updatedAt: now,
      data: {
        unit: fields.unit === '' ? null : fields.unit,
        decimalPlaces: dp !== null && Number.isFinite(dp) ? dp : null,
        weightRegion: fields.weightRegion.trim() || null,
        anchorText: fields.anchorText.trim() || null,
        barcodeType: result.gtin.barcodeType,
        dateFormats: result.dates.map((d) => `${d.kind}: ${d.printedFormat}`),
        batchPresent: !!result.batch.value,
        serialPresent: !!result.serial.value,
        aiFields,
        taughtAt: now,
      },
    });

    // A usable GTIN also creates/updates the barcode profile (8–14 digits).
    const gtin = fields.gtin.replace(/\D/g, '');
    if (gtin.length >= 8 && gtin.length <= 14) {
      onUpsertGtinProfile({
        gtin,
        productName: fields.product.trim() || fields.name.trim(),
        supplierName: result.supplier.value?.trim() || fields.name.trim(),
        fingerprint: gtinProfiles[gtin]?.fingerprint ?? '',
        updatedAt: now,
        source: 'ai-teach',
        taughtAt: now,
      });
    }
    onSaved(fields.name.trim());
  };

  const field = (
    label: string,
    key: keyof ConfirmFields,
    opts?: { placeholder?: string; inputMode?: 'numeric' },
  ) => (
    <label className="block text-sm font-medium text-slate-300">
      {label}
      <input
        data-testid={`teach-${key}`}
        value={fields?.[key] ?? ''}
        inputMode={opts?.inputMode}
        placeholder={opts?.placeholder}
        onChange={(e) => setFields((f) => (f ? { ...f, [key]: e.target.value } : f))}
        className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-2.5 text-base text-slate-100 ring-1 ring-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none"
      />
    </label>
  );

  // ---- Step: pick a photo ---------------------------------------------------
  if (step === 'pick') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-400">
          Photograph the <strong className="text-slate-200">whole carton label</strong> straight-on and
          well lit — the AI learns where the weight, batch and dates live on this supplier’s design.
        </p>

        <input
          ref={cameraInputRef}
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
          ref={galleryInputRef}
          data-testid="teach-file-input"
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
          data-testid="teach-take-photo"
          onClick={() => cameraInputRef.current?.click()}
          className="rounded-xl bg-emerald-500 py-4 text-base font-bold text-slate-900 active:bg-emerald-400"
        >
          📷 Take a photo of the label
        </button>
        <button
          type="button"
          data-testid="teach-choose-photo"
          onClick={() => galleryInputRef.current?.click()}
          className="rounded-xl bg-slate-800 py-3 text-base font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700"
        >
          🖼 Choose an existing photo
        </button>

        {error && (
          <p data-testid="teach-error" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-500/40">
            {error}
          </p>
        )}

        <p className="text-xs text-slate-500">
          Analysing a label uses a paid AI call (a few cents) and needs internet. One teach per label
          design is all that’s needed — daily capture stays fully on-device.
        </p>
      </div>
    );
  }

  // ---- Step: review photo + optional hint -----------------------------------
  if (step === 'review' || step === 'analysing') {
    const analysing = step === 'analysing';
    return (
      <div className="flex flex-col gap-4">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Label to analyse"
            className="max-h-72 w-full rounded-xl object-contain ring-1 ring-slate-700"
          />
        )}
        {image && (
          <p className="text-center text-xs text-slate-500">
            {image.width}×{image.height} · ~{Math.max(1, Math.round(image.bytes / 1024))} KB (compressed on-device)
          </p>
        )}

        <label className="block text-sm font-medium text-slate-300">
          Hint for the AI <span className="text-slate-500">(optional)</span>
          <textarea
            data-testid="teach-hint"
            value={hint}
            disabled={analysing}
            onChange={(e) => setHint(e.target.value.slice(0, 500))}
            placeholder="e.g. the weight is in the boxed grid at the bottom"
            rows={2}
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-2.5 text-base text-slate-100 ring-1 ring-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none"
          />
        </label>

        {error && (
          <div data-testid="teach-error" className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
            <p className="text-sm text-rose-200">{error}</p>
            <p className="mt-1 text-xs text-rose-300/70">Nothing was saved. Fix the issue and retry.</p>
          </div>
        )}

        <button
          type="button"
          data-testid="teach-analyse"
          disabled={analysing}
          onClick={() => void runAnalysis()}
          className="rounded-xl bg-emerald-500 py-4 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-60"
        >
          {analysing ? '🤖 Analysing label…' : error ? '↻ Retry analysis' : '🤖 Analyse label'}
        </button>
        {analysing && (
          <p className="text-center text-xs text-slate-500">
            Sending to the AI — needs connectivity, typically 15–30 seconds…
          </p>
        )}

        <button
          type="button"
          data-testid="teach-retake"
          disabled={analysing}
          onClick={() => {
            setImage(null);
            setError(null);
            setStep('pick');
          }}
          className="rounded-xl bg-slate-800 py-3 text-sm font-semibold text-slate-200 ring-1 ring-slate-600 disabled:opacity-50"
        >
          ‹ Retake / choose another photo
        </button>

        {!analysing && (
          <p className="text-xs text-slate-500">Analysing uses one paid AI call — tap once and wait.</p>
        )}
      </div>
    );
  }

  // ---- Step: confirm + save --------------------------------------------------
  if (step === 'confirm' && result && fields) {
    const conf = (c: string) => <span className={`${confidenceDot[c] ?? ''}`}>●</span>;
    const canSave = fields.name.trim().length > 0;
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-400">
          Check every field against the carton — correct anything the AI got wrong, then save.
          <span className="block text-xs text-slate-500">
            ● confidence: <span className="text-emerald-400">high</span> ·{' '}
            <span className="text-amber-400">medium</span> · <span className="text-rose-400">low</span>
          </span>
        </p>

        {field('Supplier / manufacturer * (keys this label profile)', 'name')}
        <p className="-mt-2 text-xs text-slate-500">
          AI read — supplier: {result.supplier.value ?? '—'} {conf(result.supplier.confidence)}, manufacturer:{' '}
          {result.manufacturer.value ?? '—'} {conf(result.manufacturer.confidence)}
        </p>

        {field('Product description', 'product')}
        {field('GTIN / barcode number', 'gtin', { inputMode: 'numeric', placeholder: 'digits only' })}
        <p className="-mt-2 text-xs text-slate-500">
          Barcode type: <span className="text-slate-300">{result.gtin.barcodeType}</span>{' '}
          {conf(result.gtin.confidence)}
          {result.gtin.barcodeType === 'gs1-128-weight'
            ? ' — barcode scanning captures the weight for this label.'
            : result.gtin.barcodeType === 'plain' || result.gtin.barcodeType === 'gs1-128'
              ? ' — no weight in the barcode; OCR/manual capture applies.'
              : ''}
        </p>

        <div className="rounded-xl bg-slate-800/60 p-3 ring-1 ring-slate-700">
          <p className="text-sm font-semibold text-slate-200">
            Net weight layout {conf(result.weight.confidence)}
          </p>
          {result.weight.printedExample && (
            <p className="mt-1 text-xs text-slate-500">
              Printed example on this carton: “{result.weight.printedExample}” — shown only so you can
              verify. The app never stores or reuses a weight value; every carton is read fresh.
            </p>
          )}
          <div className="mt-2 flex flex-col gap-3">
            <label className="block text-sm font-medium text-slate-300">
              Unit printed on the label
              <select
                data-testid="teach-unit"
                value={fields.unit}
                onChange={(e) => setFields((f) => (f ? { ...f, unit: e.target.value as ConfirmFields['unit'] } : f))}
                className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-2.5 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none"
              >
                <option value="">(not printed / unsure)</option>
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </label>
            {field('Decimal places (e.g. 21.652 → 3)', 'decimalPlaces', { inputMode: 'numeric' })}
            {field('Where on the label', 'weightRegion', { placeholder: 'e.g. bottom-right, in the boxed grid' })}
            {field('Text printed next to it', 'anchorText', { placeholder: 'e.g. NET WEIGHT' })}
          </div>
        </div>

        <div className="rounded-xl bg-slate-800/60 px-3 py-2 ring-1 ring-slate-700 text-sm">
          <p className="font-semibold text-slate-200">Also identified</p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-slate-400">
            {result.dates.length > 0 ? (
              result.dates.map((d, i) => (
                <li key={i}>
                  📅 {d.kind}
                  {d.label ? ` (“${d.label}”)` : ''}: format {d.printedFormat} {conf(d.confidence)}
                </li>
              ))
            ) : (
              <li>📅 no dates found</li>
            )}
            <li>
              🏷 batch/lot: {result.batch.value ?? 'not found'} {result.batch.value && conf(result.batch.confidence)}
            </li>
            <li>
              #️⃣ serial: {result.serial.value ?? 'not found'} {result.serial.value && conf(result.serial.confidence)}
            </li>
            {result.notes && <li>📝 {result.notes}</li>}
          </ul>
        </div>

        <p className="text-xs text-slate-500">
          Saving teaches layout only. All capture guardrails (OCR confidence gate, 1–40 kg range,
          missed-decimal check, first-carton confirm, label-change warning) stay fully active.
        </p>

        <button
          type="button"
          data-testid="teach-save"
          disabled={!canSave}
          onClick={save}
          className="rounded-xl bg-emerald-500 py-4 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
        >
          ✓ Save label profile
        </button>
        <button
          type="button"
          data-testid="teach-cancel"
          onClick={onCancel}
          className="rounded-xl bg-slate-800 py-3 text-sm font-semibold text-slate-200 ring-1 ring-slate-600"
        >
          Cancel — save nothing
        </button>
      </div>
    );
  }

  return null;
}
