import { useState } from 'react';
import { ScannerView } from './ScannerView';
import { loadOcrProfiles, taughtFormatHint, type OcrLabelProfile } from '../lib/ocrProfiles';
import { getOcrMinConfidence, parseWeightTaught, regionFromProfile, type OcrRead } from '../lib/ocr';
import { weightWarnings } from '../lib/guardrails';
import { roundKg, toKg } from '../lib/units';

interface TrialRead {
  id: number;
  seen: string;
  confidence: number;
  /** Human verdict line, e.g. "would auto-count 14.54 kg". */
  verdict: string;
  warnings: string[];
  ok: boolean;
}

interface OcrTrialScreenProps {
  /** Jump to the teach flow (no taught labels yet). */
  onTeach: () => void;
}

/**
 * OCR weight capture, EXPERIMENTAL — demoted off the capture screen (field
 * testing found tap-OCR slower than the manual keypad on real labels). This
 * trial harness keeps the whole read pipeline alive: pick a taught label,
 * tap-capture reads, and see exactly what OCR saw and what WOULD have
 * happened — nothing here counts into any receival.
 */
export function OcrTrialScreen({ onTeach }: OcrTrialScreenProps) {
  const [profiles] = useState<OcrLabelProfile[]>(() => loadOcrProfiles().filter((p) => !!p.data));
  const [selected, setSelected] = useState<OcrLabelProfile | null>(null);
  const [reads, setReads] = useState<TrialRead[]>([]);

  const handleRead = ({ text, confidence }: OcrRead) => {
    const map = selected?.data;
    if (!map) return;
    const seen = text.trim().replace(/\s+/g, ' ') || '(nothing)';
    const w = parseWeightTaught(text, map);
    let read: Omit<TrialRead, 'id' | 'seen' | 'confidence'>;
    if (!w) {
      read = { verdict: 'no weight read', warnings: [], ok: false };
    } else if (confidence < getOcrMinConfidence()) {
      read = {
        verdict: `read ${w.value} ${w.unit} but confidence ${Math.round(confidence)}% is below the gate (${getOcrMinConfidence()}%)`,
        warnings: [],
        ok: false,
      };
    } else {
      const kg = toKg(w.value, w.unit);
      const warnings = [
        ...(w.unitExplicit ? [] : [`Unit not read — would assume ${w.unit} and ask to confirm.`]),
        ...weightWarnings({ weightKg: kg, hasDecimal: w.hasDecimal, requireDecimal: true }),
      ];
      read = {
        verdict:
          `${w.value} ${w.unit}${w.unit === 'lb' ? ` → ${roundKg(kg).toFixed(2)} kg` : ''} · ` +
          (warnings.length ? 'would ask to confirm' : 'would auto-count'),
        warnings,
        ok: warnings.length === 0,
      };
    }
    setReads((prev) => [{ id: Date.now(), seen, confidence: Math.round(confidence), ...read }, ...prev].slice(0, 5));
  };

  // ---- No taught labels yet -------------------------------------------------
  if (profiles.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          OCR needs a taught label profile to trial against — teach one first.
        </p>
        <button
          type="button"
          data-testid="trial-teach"
          onClick={onTeach}
          className="rounded-xl bg-emerald-500 py-3 text-base font-bold text-slate-900"
        >
          🤖 Teach a label
        </button>
      </div>
    );
  }

  // ---- Profile picker -------------------------------------------------------
  if (!selected) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-500">
          Pick the taught label to trial. Reads here show exactly what OCR saw and what would have
          happened — <span className="font-semibold text-slate-400">nothing is counted anywhere</span>.
        </p>
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`trial-profile-${p.id}`}
            onClick={() => setSelected(p)}
            className="rounded-xl bg-slate-800 px-4 py-3 text-left ring-1 ring-slate-600 active:bg-slate-700"
          >
            <span className="block text-base font-semibold text-slate-200">{p.name}</span>
            <span className="block text-xs text-slate-500">{p.data ? taughtFormatHint(p.data) : ''}</span>
          </button>
        ))}
      </div>
    );
  }

  // ---- Trial capture ----------------------------------------------------------
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => {
          setSelected(null);
          setReads([]);
        }}
        className="self-start rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 ring-1 ring-slate-600"
      >
        ‹ Pick another label
      </button>

      <ScannerView
        active
        paused={false}
        mode="ocr"
        onDecode={() => {}}
        onOcrRead={handleRead}
        ocrRegion={regionFromProfile(selected.data)}
        ocrProfileName={selected.name}
        ocrHint={selected.data ? taughtFormatHint(selected.data) : undefined}
      />

      <p className="text-center text-xs text-slate-500">
        Trial only — reads are shown below, never counted into a receival.
      </p>

      <ul data-testid="trial-reads" className="flex flex-col gap-2">
        {reads.map((r) => (
          <li
            key={r.id}
            className={`rounded-xl px-3 py-2 ring-1 ${
              r.ok ? 'bg-emerald-500/10 ring-emerald-500/40' : 'bg-slate-800/70 ring-slate-700'
            }`}
          >
            <div className={`text-sm font-semibold ${r.ok ? 'text-emerald-300' : 'text-slate-200'}`}>
              {r.ok ? '✓ ' : ''}
              {r.verdict}
            </div>
            {r.warnings.map((w) => (
              <div key={w} className="text-xs text-amber-300">
                ⚠ {w}
              </div>
            ))}
            <div className="text-xs text-slate-500">
              saw “{r.seen.slice(0, 60)}” · confidence {r.confidence}%
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
