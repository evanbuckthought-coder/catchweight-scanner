import { useState } from 'react';

interface SettingsMenuProps {
  scannedBy: string;
  poRef: string;
  onChangeName: (name: string) => void;
  onEndSession: () => void;
  onClose: () => void;
}

/** Small settings sheet: edit operator name, end the current session. */
export function SettingsMenu({
  scannedBy,
  poRef,
  onChangeName,
  onEndSession,
  onClose,
}: SettingsMenuProps) {
  const [name, setName] = useState(scannedBy);
  const [confirmEnd, setConfirmEnd] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="rounded-t-3xl bg-slate-900 p-5 pb-8 ring-1 ring-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-600" />
        <h2 className="text-lg font-bold">Settings</h2>
        <p className="text-xs text-slate-400">PO: {poRef}</p>

        <label className="mt-4 block text-sm font-medium text-slate-300">
          Operator name
          <div className="mt-1 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-600 focus:outline-none"
            />
            <button
              type="button"
              disabled={!name.trim() || name.trim() === scannedBy}
              onClick={() => onChangeName(name.trim())}
              className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </label>

        <div className="mt-6">
          {!confirmEnd ? (
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              className="w-full rounded-xl bg-rose-500/20 py-3 text-base font-semibold text-rose-300 ring-1 ring-rose-500/40"
            >
              End session
            </button>
          ) : (
            <div className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
              <p className="text-sm text-rose-200">
                End and clear this session? Export first if you need the data.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmEnd(false)}
                  className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-medium text-slate-200"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={onEndSession}
                  className="flex-1 rounded-lg bg-rose-500 py-2 text-sm font-bold text-slate-900"
                >
                  End session
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-slate-700 py-3 text-base font-semibold text-slate-200"
        >
          Close
        </button>
      </div>
    </div>
  );
}
