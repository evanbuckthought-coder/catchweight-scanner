import { markMapConfirmed, type DecodedBarcode, type SavedBarcodeMap } from '../lib/barcodeMaps';
import { roundKg } from '../lib/units';

interface BarcodeConfirmSheetProps {
  decoded: DecodedBarcode;
  map: SavedBarcodeMap;
  /** Accepted: count this carton and trust the format for the rest of the run. */
  onAccept: () => void;
  /** Rejected: don't count, don't trust — fall back to manual entry. */
  onReject: () => void;
}

/**
 * First scan of a saved custom format in this app run: the operator eyeballs
 * the on-device decode against the carton once before the format is trusted
 * for the rest of the session. A format taught in an earlier session has
 * never been checked on THIS run's cartons, so it asks again after a launch.
 */
export function BarcodeConfirmSheet({ decoded, map, onAccept, onReject }: BarcodeConfirmSheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div
        data-testid="barcode-confirm-sheet"
        className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-900 p-4 pb-8 ring-1 ring-slate-700"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

        <h2 className="text-lg font-bold text-slate-100">Check the first carton</h2>
        <p className="mt-1 text-sm text-slate-400">
          Using the saved format{' '}
          <span className="font-semibold text-slate-200">{map.formatName}</span>. Confirm this matches
          the printed label — asked once per session, then it counts straight away.
        </p>

        <div className="mt-4 rounded-2xl bg-slate-800/80 p-4 text-center ring-1 ring-slate-700">
          <div data-testid="barcode-confirm-weight" className="font-mono text-5xl font-bold tabular-nums text-emerald-400">
            {roundKg(decoded.weightKg).toFixed(2)}
            <span className="ml-2 text-2xl text-slate-400">kg</span>
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {decoded.productCode ? `Product ${decoded.productCode}` : 'No product code'}
            {decoded.serial ? ` · #${decoded.serial}` : ''}
          </div>
          {decoded.productionDate && (
            <div className="text-xs text-slate-500">Production {decoded.productionDate}</div>
          )}
        </div>

        <button
          type="button"
          data-testid="barcode-confirm-accept"
          onClick={() => {
            markMapConfirmed(map.id);
            onAccept();
          }}
          className="mt-4 h-14 w-full rounded-xl bg-emerald-500 text-lg font-bold text-slate-900 active:bg-emerald-400"
        >
          ✓ Matches the label — count it
        </button>
        <button
          type="button"
          data-testid="barcode-confirm-reject"
          onClick={onReject}
          className="mt-2 h-12 w-full rounded-xl bg-slate-800 text-base font-semibold text-slate-200 ring-1 ring-slate-600"
        >
          ✕ Doesn’t match — don’t count
        </button>
      </div>
    </div>
  );
}
