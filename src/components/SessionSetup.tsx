import { useState } from 'react';

interface SessionSetupProps {
  scannedBy: string;
  onStart: (receiptRef: string) => void;
  onEditName: () => void;
}

/** Start a capture session: just a receipt / PO reference. */
export function SessionSetup({ scannedBy, onStart, onEditName }: SessionSetupProps) {
  const [receiptRef, setReceiptRef] = useState('');
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

      <p className="text-sm text-slate-500">
        Scan or manually enter cartons; the app tallies the running kg total and carton
        count, then exports to Excel.
      </p>

      <button
        type="button"
        data-testid="start-session"
        disabled={!canStart}
        onClick={() => onStart(receiptRef.trim())}
        className="mt-auto rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
      >
        Start session
      </button>
    </div>
  );
}
