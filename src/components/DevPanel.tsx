import { useState } from 'react';
import { SAMPLE_LABELS } from '../lib/testData';

interface DevPanelProps {
  /** Feed a GS1 string into the same pipeline a real scan uses. */
  onSimulate: (code: string) => void;
  /** Feed a fake OCR read into the same pipeline the camera OCR uses. */
  onSimulateOcr: (text: string, confidence: number) => void;
}

/**
 * Collapsible "simulated scan" panel. Lets the loop be exercised without a
 * physical carton (handy for testing on the phone too), plus a manual paste box
 * for arbitrary GS1-128 strings.
 */
export function DevPanel({ onSimulate, onSimulateOcr }: DevPanelProps) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState('');
  const [ocrText, setOcrText] = useState('');

  return (
    <div className="rounded-xl bg-slate-800/50 ring-1 ring-slate-700">
      <button
        type="button"
        data-testid="dev-toggle"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-300"
      >
        <span>🧪 Simulated scan (dev)</span>
        <span className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {SAMPLE_LABELS.map((s, i) => (
            <button
              key={s.code}
              type="button"
              data-testid={`sim-${i}`}
              onClick={() => onSimulate(s.code)}
              className="rounded-lg bg-slate-700 px-3 py-2 text-left text-sm text-slate-200 active:bg-slate-600"
            >
              <div className="font-medium">{s.label}</div>
              <div className="truncate font-mono text-[11px] text-slate-400">{s.code}</div>
            </button>
          ))}

          <div className="mt-1 flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Paste a GS1-128 string"
              className="min-w-0 flex-1 rounded-lg bg-slate-900 px-2 py-2 font-mono text-xs text-slate-200 ring-1 ring-slate-600 focus:outline-none"
            />
            <button
              type="button"
              data-testid="dev-feed"
              disabled={!manual.trim()}
              onClick={() => {
                onSimulate(manual.trim());
                setManual('');
              }}
              className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-40"
            >
              Feed
            </button>
          </div>

          {/* Simulated OCR read (exercises the OCR gating without a camera). */}
          <div className="mt-1 flex gap-2">
            <input
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              placeholder="Simulate OCR text, e.g. 18.64 kg"
              className="min-w-0 flex-1 rounded-lg bg-slate-900 px-2 py-2 font-mono text-xs text-slate-200 ring-1 ring-slate-600 focus:outline-none"
            />
            <button
              type="button"
              data-testid="dev-ocr-feed"
              disabled={!ocrText.trim()}
              onClick={() => onSimulateOcr(ocrText.trim(), 92)}
              className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              OCR
            </button>
            <button
              type="button"
              data-testid="dev-ocr-feed-low"
              disabled={!ocrText.trim()}
              onClick={() => onSimulateOcr(ocrText.trim(), 40)}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 disabled:opacity-40"
              title="Feed with low confidence"
            >
              low
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
