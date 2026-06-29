import { useState } from 'react';
import type { ParsedCarton } from '../lib/gs1';
import { roundKg } from '../lib/units';

export interface PendingConfirm {
  parsed: ParsedCarton;
  /** Product name pre-filled from the GTIN profile (if known). */
  product: string;
  /** True if this GTIN has never been seen before (no saved profile). */
  isNewGtin: boolean;
  /** Weight sanity warnings to surface for confirmation (empty = none). */
  weightWarnings: string[];
}

interface ConfirmSheetProps {
  pending: PendingConfirm;
  /** Supplier/brand are PO-level — shown read-only for context. */
  supplier: string;
  brand?: string;
  onConfirm: (product: string) => void;
  onCancel: () => void;
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 border-b border-slate-700/60 py-1 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-100 break-all">{value}</span>
    </div>
  );
}

/**
 * First carton of a new product. The operator eyeballs the box and confirms the
 * product name (pre-filled from the GTIN profile when known) before counting —
 * a deliberate fail-safe applied to every new product, since the same GTIN can
 * hold a different product if packaging changes.
 */
export function ConfirmSheet({ pending, supplier, brand, onConfirm, onCancel }: ConfirmSheetProps) {
  const { parsed } = pending;
  const [product, setProduct] = useState(pending.product);
  const canConfirm = product.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <div className="mb-3 rounded-xl bg-sky-500/15 px-3 py-2 text-sm text-sky-200 ring-1 ring-sky-500/40">
          First carton of a new product — eyeball the box and confirm the product.
          {pending.isNewGtin ? ' (New GTIN — not seen before.)' : ''}
        </div>

        {pending.weightWarnings.length > 0 && (
          <div className="mb-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/40">
            {pending.weightWarnings.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
          </div>
        )}

        <div className="rounded-xl bg-slate-800/70 px-3 py-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-slate-400">Parsed</span>
            <span className="font-mono text-2xl font-bold text-emerald-400">
              {roundKg(parsed.weightKg ?? 0).toFixed(2)} kg
            </span>
          </div>
          <Field label="Supplier (PO)" value={brand ? `${supplier} · ${brand}` : supplier} />
          <Field label="GTIN" value={parsed.gtin} />
          <Field
            label="Net weight"
            value={
              parsed.netWeight !== undefined
                ? `${parsed.netWeight} ${parsed.weightUnit}${
                    parsed.weightUnit === 'lb'
                      ? ` (→ ${roundKg(parsed.weightKg ?? 0).toFixed(2)} kg)`
                      : ''
                  }`
                : undefined
            }
          />
          <Field label="Batch (10)" value={parsed.batch} />
          <Field label="Serial (21)" value={parsed.serial} />
          <Field label="Production date" value={parsed.productionDate} />
          <Field label="Packaging date" value={parsed.packagingDate} />
          <Field label="Best before" value={parsed.bestBefore} />
          <Field label="Use by" value={parsed.useBy} />
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-300">
          Product
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="e.g. Beef striploin"
            autoFocus
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none"
          />
        </label>

        {parsed.raw && (
          <details className="mt-3 text-xs text-slate-400">
            <summary className="cursor-pointer">Raw GS1 string</summary>
            <code className="mt-1 block break-all rounded bg-slate-800 p-2 text-slate-300">
              {parsed.raw.replace(/\x1d/g, '{GS}')}
            </code>
          </details>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-200 active:bg-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-count"
            disabled={!canConfirm}
            onClick={() => onConfirm(product.trim())}
            className="flex-1 rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
          >
            Confirm & count
          </button>
        </div>
      </div>
    </div>
  );
}
