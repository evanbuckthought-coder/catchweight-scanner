import { useState, type ReactNode } from 'react';
import { checkPasscode, isUnlocked, setUnlocked } from '../lib/auth';

interface PasscodeGateProps {
  children: ReactNode;
}

/**
 * Renders a single passcode screen on first load; only renders the app once the
 * correct passcode is entered. The unlocked state is remembered per-device in
 * localStorage so it doesn't re-prompt. Lightweight gate only (see lib/auth.ts).
 */
export function PasscodeGate({ children }: PasscodeGateProps) {
  const [unlocked, setUnlockedState] = useState<boolean>(() => isUnlocked());
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = () => {
    if (checkPasscode(value)) {
      setUnlocked();
      setUnlockedState(true);
    } else {
      setError(true);
      setValue('');
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="text-4xl">🔒</div>
        <h1 className="mt-2 text-2xl font-bold">Catchweight Scanner</h1>
        <p className="mt-1 text-sm text-slate-400">Enter the passcode to continue.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          type="password"
          inputMode="text"
          autoFocus
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          placeholder="Passcode"
          aria-label="Passcode"
          className={`w-full rounded-xl bg-slate-800 px-3 py-3 text-center text-lg tracking-wide text-slate-100 ring-1 focus:outline-none focus:ring-2 ${
            error ? 'ring-rose-500 focus:ring-rose-400' : 'ring-slate-600 focus:ring-sky-400'
          }`}
        />
        {error && (
          <p className="mt-2 text-center text-sm text-rose-400">Incorrect passcode — try again.</p>
        )}
        <button
          type="submit"
          disabled={!value.trim()}
          className="mt-4 w-full rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900 active:bg-emerald-400 disabled:opacity-40"
        >
          Unlock
        </button>
      </form>

      <p className="text-center text-xs text-slate-500">
        Access is remembered on this device. Lightweight gate, not secure login.
      </p>
    </div>
  );
}
