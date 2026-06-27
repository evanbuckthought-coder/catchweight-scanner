/**
 * Capture feedback: a crisp "RF-gun" beep + a short haptic on a successful
 * capture, and a distinct lower error tone when a scan can't be parsed.
 *
 * All synthesised with the Web Audio API (no audio files to load) and guarded
 * so it can never break the app — on a browser without AudioContext, on a
 * silenced phone, or on an iOS version without the haptic trick, it just does
 * nothing.
 *
 * iOS note: audio is blocked until a user gesture "unlocks" the AudioContext.
 * primeAudioUnlock() arms a one-time listener so the very first tap (the
 * passcode / start-session tap) resumes the context, and the beep works from
 * the first scan onward.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Resume the context + play a near-silent blip to satisfy iOS's gesture rule. */
export function unlockAudio(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.00001; // effectively silent
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch {
    /* ignore */
  }
}

let primed = false;
/** Arm a one-time global listener that unlocks audio on the first user tap. */
export function primeAudioUnlock(): void {
  if (primed || typeof window === 'undefined') return;
  primed = true;
  const handler = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('touchend', handler);
    window.removeEventListener('click', handler);
  };
  window.addEventListener('pointerdown', handler);
  window.addEventListener('touchend', handler);
  window.addEventListener('click', handler);
}

/** Play one oscillator tone with a short click-free envelope. */
function tone(freq: number, durationMs: number, peakGain = 0.15, type: OscillatorType = 'square'): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try {
    const now = ctx.currentTime;
    const dur = durationMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // Fast attack + release so the beep is sharp but doesn't click.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
    gain.gain.setValueAtTime(peakGain, now + Math.max(0.01, dur - 0.01));
    gain.gain.linearRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch {
    /* ignore */
  }
}

// --- haptics --------------------------------------------------------------

let hapticLabel: HTMLLabelElement | null = null;

/**
 * iOS Safari has no navigator.vibrate. The known workaround: an off-screen
 * <label> wrapping a non-standard <input type="checkbox" switch>; toggling the
 * switch fires the Taptic engine on iOS 17.4+. On anything that doesn't support
 * it, this just toggles a hidden checkbox — harmless and silent.
 */
function iosHaptic(): void {
  if (typeof document === 'undefined') return;
  try {
    if (!hapticLabel) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      Object.assign(label.style, {
        position: 'absolute',
        left: '-9999px',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
      } as CSSStyleDeclaration);
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', ''); // non-standard iOS attribute
      label.appendChild(input);
      document.body.appendChild(label);
      hapticLabel = label;
    }
    hapticLabel.click(); // toggle -> haptic tap on supported iOS
  } catch {
    /* ignore */
  }
}

/** Best-effort short vibrate: navigator.vibrate where supported, iOS trick otherwise. */
function vibrate(ms: number): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    /* ignore */
  }
  iosHaptic();
}

// --- public signals -------------------------------------------------------

/** Successful capture: crisp high beep + short haptic. */
export function signalSuccess(): void {
  tone(1100, 70, 0.15, 'square');
  vibrate(40);
}

/** Failed/unreadable scan: distinct lower two-tone "buzz", no haptic. */
export function signalError(): void {
  tone(380, 90, 0.16, 'square');
  setTimeout(() => tone(220, 140, 0.16, 'square'), 100);
}
