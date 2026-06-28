import { roundKg } from '../lib/units';

interface ReadoutProps {
  /** Active product name, or undefined when between products. */
  activeProductName?: string;
  productKg: number;
  productCount: number;
  /** Overall PO totals. */
  poKg: number;
  poCount: number;
  poProducts: number;
  mixedUnits: boolean;
}

/** Big current-product subtotal up top, overall PO total underneath. */
export function Readout({
  activeProductName,
  productKg,
  productCount,
  poKg,
  poCount,
  poProducts,
  mixedUnits,
}: ReadoutProps) {
  return (
    <div className="rounded-2xl bg-slate-800/80 p-4 text-center shadow-lg ring-1 ring-slate-700">
      {activeProductName ? (
        <>
          <div className="truncate text-xs font-medium uppercase tracking-widest text-slate-400">
            {activeProductName}
          </div>
          <div className="mt-1 font-mono text-5xl font-bold tabular-nums text-emerald-400">
            {roundKg(productKg).toFixed(2)}
            <span className="ml-2 text-2xl text-slate-400">kg</span>
          </div>
          <div className="mt-1 text-sm text-slate-300">
            <span className="font-semibold text-slate-100">{productCount}</span> carton
            {productCount === 1 ? '' : 's'} in this product
          </div>
        </>
      ) : (
        <div className="py-3 text-sm text-slate-300">
          Scan the first carton to start a product.
        </div>
      )}

      <div className="mt-3 border-t border-slate-700 pt-2 text-sm text-slate-400">
        PO total:{' '}
        <span className="font-mono font-semibold text-slate-100">{roundKg(poKg).toFixed(2)} kg</span>{' '}
        · {poCount} carton{poCount === 1 ? '' : 's'} · {poProducts} product
        {poProducts === 1 ? '' : 's'}
      </div>

      {mixedUnits && (
        <div className="mt-3 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/40">
          ⚠ MIXED UNITS (kg + lb) — total normalised to kg, flag for supervisor review
        </div>
      )}
    </div>
  );
}
