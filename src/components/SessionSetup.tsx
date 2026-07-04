import { useState } from 'react';

interface SessionSetupProps {
  scannedBy: string;
  onStart: (poRef: string, supplier: string, brand: string | undefined) => void;
  onEditName: () => void;
  onBack: () => void;
}

/** Start a PO session: PO reference + supplier (compulsory) + brand (optional). */
export function SessionSetup({ scannedBy, onStart, onEditName, onBack }: SessionSetupProps) {
  const [poRef, setPoRef] = useState('');
  const [supplier, setSupplier] = useState('');
  const [brand, setBrand] = useState('');

  const canStart = poRef.trim().length > 0 && supplier.trim().length > 0;

  return (
    <div className="flex min-h-screen flex-col gap-5 p-5">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-slate-600"
        >
          ‹ Home
        </button>
        <h1 className="text-xl font-bold">New receival</h1>
        <button
          type="button"
          onClick={onEditName}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 ring-1 ring-slate-600"
        >
          {scannedBy || 'Set name'} ✎
        </button>
      </header>

      <label className="block text-sm font-medium text-slate-300">
        PO Reference *
        <input
          value={poRef}
          onChange={(e) => setPoRef(e.target.value)}
          placeholder="e.g. PO-2026-0042"
          autoFocus
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none"
        />
      </label>

      <label className="block text-sm font-medium text-slate-300">
        Supplier *
        <input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Supplier name"
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none"
        />
      </label>

      <label className="block text-sm font-medium text-slate-300">
        Brand <span className="text-slate-500">(if different from supplier — optional)</span>
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Brand name"
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none"
        />
      </label>

      <p className="text-sm text-slate-500">
        Scan or manually enter cartons per product. Tap “Next product” to start another
        product under the same PO; review and export at the end.
      </p>

      <button
        type="button"
        data-testid="start-session"
        disabled={!canStart}
        onClick={() => onStart(poRef.trim(), supplier.trim(), brand.trim() || undefined)}
        className="mt-auto rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
      >
        Start session
      </button>
    </div>
  );
}
