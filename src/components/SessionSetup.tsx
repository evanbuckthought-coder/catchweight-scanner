import { useState } from 'react';
import type { ReceiptExpectation } from '../types';

interface SessionSetupProps {
  scannedBy: string;
  onStart: (receiptRef: string, expectation: ReceiptExpectation) => void;
  onEditName: () => void;
}

/** Start a counting session: receipt ref + optional expected totals + tolerance. */
export function SessionSetup({ scannedBy, onStart, onEditName }: SessionSetupProps) {
  const [receiptRef, setReceiptRef] = useState('');
  const [expectedKg, setExpectedKg] = useState('');
  const [expectedCartons, setExpectedCartons] = useState('');
  const [tolerance, setTolerance] = useState('0');

  const parseNum = (s: string): number | undefined => {
    const t = s.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };

  const canStart = receiptRef.trim().length > 0;

  return (
    <div className="flex min-h-screen flex-col gap-5 p-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">New session</h1>
        <button
          type="button"
          onClick={onEditName}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 ring-1 ring-slate-600"
        >
          {scannedBy || 'Set name'} ✎
        </button>
      </header>

      <label className="block text-sm font-medium text-slate-300">
        Receipt / PO reference *
        <input
          value={receiptRef}
          onChange={(e) => setReceiptRef(e.target.value)}
          placeholder="e.g. GR-2026-0042"
          autoFocus
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none"
        />
      </label>

      <fieldset className="rounded-xl bg-slate-800/50 p-3 ring-1 ring-slate-700">
        <legend className="px-1 text-xs uppercase tracking-wide text-slate-400">
          Expected (optional — drives variance / HOLD)
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-slate-300">
            Expected kg
            <input
              inputMode="decimal"
              value={expectedKg}
              onChange={(e) => setExpectedKg(e.target.value)}
              placeholder="—"
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2.5 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Expected cartons
            <input
              inputMode="numeric"
              value={expectedCartons}
              onChange={(e) => setExpectedCartons(e.target.value)}
              placeholder="—"
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2.5 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none"
            />
          </label>
          <label className="col-span-2 block text-sm text-slate-300">
            Tolerance (± kg)
            <input
              inputMode="decimal"
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2.5 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none"
            />
          </label>
        </div>
      </fieldset>

      <button
        type="button"
        data-testid="start-session"
        disabled={!canStart}
        onClick={() =>
          onStart(receiptRef.trim(), {
            expectedKg: parseNum(expectedKg),
            expectedCartons: parseNum(expectedCartons),
            toleranceKg: parseNum(tolerance) ?? 0,
          })
        }
        className="mt-auto rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
      >
        Start scanning
      </button>
    </div>
  );
}
