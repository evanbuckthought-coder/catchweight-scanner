import { useState } from 'react';

interface SetupScreenProps {
  initialName?: string;
  onSave: (name: string) => void;
}

/**
 * First-run setup: capture the operator's name once and persist it.
 *
 * In a future native / SSO build this identity comes from the login. A browser
 * PWA cannot read the device user, so set-once-persist is the pragmatic approach
 * — the name auto-fills every scan thereafter and is editable in Settings.
 */
export function SetupScreen({ initialName = '', onSave }: SetupScreenProps) {
  const [name, setName] = useState(initialName);

  return (
    <div className="flex min-h-screen flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="text-4xl">📦</div>
        <h1 className="mt-2 text-2xl font-bold">Catchweight Scanner</h1>
        <p className="mt-1 text-sm text-slate-400">
          Scan random-weight cartons, tally the pallet, export to Excel.
        </p>
      </div>

      <label className="block text-sm font-medium text-slate-300">
        Your name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Evan B"
          autoFocus
          className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none"
        />
      </label>

      <button
        type="button"
        disabled={!name.trim()}
        onClick={() => onSave(name.trim())}
        className="rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
      >
        Continue
      </button>
      <p className="text-center text-xs text-slate-500">
        Stored on this device only. No account, no cloud.
      </p>
    </div>
  );
}
