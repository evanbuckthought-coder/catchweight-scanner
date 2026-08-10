import { useEffect, useRef, useState } from 'react';
import { onSignal, type FlashKind } from '../lib/feedback';

/** Total on-screen life of one flash. Short enough not to slow the next carton. */
const FLASH_MS = 500;

/**
 * Big peripheral-vision confirmation over the camera view.
 *
 * On the pallet the operator is looking at the carton, not the screen, so the
 * tally and toast text are effectively invisible. This paints a very large
 * translucent tick (success) or cross (failure) across the whole camera area
 * for about half a second — catchable out of the corner of the eye, and
 * distinct enough that a miss can never be mistaken for "I blinked".
 *
 * It listens on the same channel as the capture beep, so audio and visual
 * always fire together. Purely decorative: pointer-events-none, no state
 * outside itself, and a new flash RESTARTS rather than queues, so rapid
 * scanning gets one clean pulse per carton.
 */
export function ScanFlash() {
  const [flash, setFlash] = useState<{ kind: FlashKind; id: number } | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const seqRef = useRef(0);

  useEffect(() => {
    const off = onSignal((kind) => {
      // Restart, never queue: the newest scan owns the overlay.
      window.clearTimeout(timerRef.current);
      seqRef.current += 1;
      setFlash({ kind, id: seqRef.current });
      timerRef.current = window.setTimeout(() => setFlash(null), FLASH_MS);
    });
    return () => {
      off();
      window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!flash) return null;
  const ok = flash.kind === 'success';

  return (
    <div
      // `key` restarts the CSS animation from frame 0 on back-to-back scans.
      key={flash.id}
      data-testid="scan-flash"
      data-flash={flash.kind}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
      style={{ animation: `cw-flash-fade ${FLASH_MS}ms ease-out forwards` }}
    >
      {/* Wash of colour so the signal reads even in peripheral vision. */}
      <div className={`absolute inset-0 ${ok ? 'bg-emerald-400/25' : 'bg-rose-500/30'}`} />
      <svg
        viewBox="0 0 100 100"
        className={`relative h-3/5 w-3/5 ${ok ? 'text-emerald-300' : 'text-rose-300'}`}
        style={{ filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.65))' }}
      >
        {/* Dark disc keeps the stroke high-contrast over a pale carton. */}
        <circle cx="50" cy="50" r="46" fill="rgba(2,6,23,0.45)" />
        {ok ? (
          <path
            d="M26 52 L43 69 L75 33"
            fill="none"
            stroke="currentColor"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <g fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round">
            <path d="M32 32 L68 68" />
            <path d="M68 32 L32 68" />
          </g>
        )}
      </svg>
    </div>
  );
}
