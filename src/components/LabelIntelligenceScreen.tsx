import { useState } from 'react';
import type { GtinProfile } from '../types';
import { loadOcrProfiles, removeOcrProfile, type OcrLabelProfile } from '../lib/ocrProfiles';
import { TeachLabelFlow } from './TeachLabelFlow';

interface LabelIntelligenceScreenProps {
  /** Saved GTIN profiles (App owns this state so capture prefills stay fresh). */
  profiles: Record<string, GtinProfile>;
  onDeleteProfile: (gtin: string) => void;
  /** Create/update a GTIN profile (used by Teach a new label). */
  onUpsertProfile: (profile: GtinProfile) => void;
  onBack: () => void;
  /** Open straight into a sub-view (the OCR teach gate jumps to 'teach'). */
  initialSub?: 'menu' | 'teach';
  /**
   * Set when launched from the in-session OCR gate: teach save/cancel returns
   * straight to the capture screen instead of the Label Intelligence menu
   * (savedName present = a profile was saved).
   */
  onCaptureReturn?: (savedName?: string) => void;
}

type SubView = 'menu' | 'teach' | 'gtin' | 'ocr';

/**
 * Label Intelligence: the home for everything that teaches the app about
 * labels — a between-receivals activity, never part of the capture path.
 * "Teach a new label" photographs a carton label once and has the vision AI
 * learn its layout (see TeachLabelFlow); profiles are managed below it.
 */
export function LabelIntelligenceScreen({
  profiles,
  onDeleteProfile,
  onUpsertProfile,
  onBack,
  initialSub,
  onCaptureReturn,
}: LabelIntelligenceScreenProps) {
  const [sub, setSub] = useState<SubView>(initialSub ?? 'menu');
  const [openGtin, setOpenGtin] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [ocrProfiles, setOcrProfiles] = useState<OcrLabelProfile[]>(() => loadOcrProfiles());
  const [confirmOcrDelete, setConfirmOcrDelete] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const gtinList = Object.values(profiles).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const header = (title: string, back: () => void) => (
    <header className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={back}
        className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-slate-600"
      >
        ‹ Back
      </button>
      <h1 className="text-lg font-bold">{title}</h1>
      <span className="w-14" />
    </header>
  );

  // ---- Teach a new label (AI vision — one call per label design) -----------
  if (sub === 'teach') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
        {header('Teach a new label', () => setSub('menu'))}
        <TeachLabelFlow
          gtinProfiles={profiles}
          onUpsertGtinProfile={onUpsertProfile}
          onSaved={(name) => {
            if (onCaptureReturn) {
              onCaptureReturn(name);
              return;
            }
            setOcrProfiles(loadOcrProfiles());
            setSavedNote(name);
            setSub('menu');
          }}
          onCancel={() => (onCaptureReturn ? onCaptureReturn() : setSub('menu'))}
        />
      </div>
    );
  }

  // ---- Barcode (GTIN) profiles --------------------------------------------
  if (sub === 'gtin') {
    const open = openGtin ? profiles[openGtin] : undefined;

    if (open) {
      return (
        <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
          {header('Barcode profile', () => setOpenGtin(null))}
          <div className="rounded-xl bg-slate-800/70 px-3 py-2 ring-1 ring-slate-700">
            {[
              ['Product', open.productName],
              ['Supplier', open.supplierName || '—'],
              ['GTIN', open.gtin],
              ['Format fingerprint', open.fingerprint || '—'],
              ['Last confirmed', new Date(open.updatedAt).toLocaleString()],
              ...(open.source === 'ai-teach'
                ? [['Source', `Teach a new label (AI) · ${new Date(open.taughtAt ?? open.updatedAt).toLocaleDateString()}`]]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-slate-700/60 py-2 text-sm last:border-b-0">
                <span className="shrink-0 text-slate-400">{label}</span>
                <span className="break-all text-right font-medium text-slate-100">{value}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500">
            Deleting this profile is how you re-teach it: the next scan of this GTIN raises the
            first-carton confirm from scratch.
          </p>

          {confirmDelete === open.gtin ? (
            <div className="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-500/40">
              <p className="text-sm text-rose-200">Delete this profile? The next scan will re-confirm.</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-medium text-slate-200"
                >
                  Keep
                </button>
                <button
                  type="button"
                  data-testid="gtin-delete-confirm"
                  onClick={() => {
                    onDeleteProfile(open.gtin);
                    setConfirmDelete(null);
                    setOpenGtin(null);
                  }}
                  className="flex-1 rounded-lg bg-rose-500 py-2 text-sm font-bold text-slate-900"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="gtin-delete"
              onClick={() => setConfirmDelete(open.gtin)}
              className="rounded-xl bg-rose-500/20 py-3 text-sm font-semibold text-rose-300 ring-1 ring-rose-500/40"
            >
              Delete / relearn this label
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
        {header('Barcode profiles', () => setSub('menu'))}
        <p className="text-xs text-slate-500">
          Saved from first-carton confirms: product + supplier per GTIN, so later scans auto-fill.
        </p>
        {gtinList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
            No barcode profiles yet — confirm a carton in a receival to create one.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {gtinList.map((p) => (
              <li key={p.gtin}>
                <button
                  type="button"
                  data-testid={`gtin-profile-${p.gtin}`}
                  onClick={() => setOpenGtin(p.gtin)}
                  className="flex w-full items-center gap-3 rounded-xl bg-slate-800/70 px-3 py-3 text-left ring-1 ring-slate-700 active:bg-slate-700"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-100">{p.productName}</div>
                    <div className="truncate text-xs text-slate-400">
                      {p.supplierName || '(no supplier)'} · GTIN {p.gtin}
                    </div>
                  </div>
                  <span className="shrink-0 text-slate-500">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ---- OCR (supplier/manufacturer) label profiles --------------------------
  if (sub === 'ocr') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
        {header('OCR label profiles', () => setSub('menu'))}
        <p className="text-xs text-slate-500">
          Per-supplier label layouts for OCR weight capture (where the weight/batch/dates are
          printed).
        </p>
        {ocrProfiles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
            No OCR label profiles yet — use “Teach a new label” to create one from a photo.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {ocrProfiles.map((p) => (
              <li key={p.id} className="rounded-xl bg-slate-800/70 px-3 py-3 ring-1 ring-slate-700">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-100">{p.name}</div>
                    <div className="truncate text-xs text-slate-400">
                      {p.description || '—'} · {new Date(p.updatedAt).toLocaleString()}
                    </div>
                    {p.data && (
                      <div className="mt-1 text-xs text-slate-500">
                        {[
                          p.data.unit ? `unit ${p.data.unit}` : null,
                          p.data.decimalPlaces !== null ? `${p.data.decimalPlaces} dp` : null,
                          p.data.weightRegion ? `weight: ${p.data.weightRegion}` : null,
                          p.data.anchorText ? `anchor “${p.data.anchorText}”` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'layout taught'}
                        <span className="block text-slate-600">
                          AI-taught {new Date(p.data.taughtAt).toLocaleDateString()} · delete to relearn
                        </span>
                      </div>
                    )}
                  </div>
                  {confirmOcrDelete === p.id ? (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setConfirmOcrDelete(null)}
                        className="rounded-lg bg-slate-700 px-2 py-2 text-xs font-medium text-slate-200"
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOcrProfiles(removeOcrProfile(p.id));
                          setConfirmOcrDelete(null);
                        }}
                        className="rounded-lg bg-rose-500 px-2 py-2 text-xs font-bold text-slate-900"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmOcrDelete(p.id)}
                      className="shrink-0 rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-rose-300"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ---- Section menu ---------------------------------------------------------
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
      {header('Label Intelligence', onBack)}
      <p className="text-xs text-slate-500">
        Everything that teaches the app about labels. Done between receivals — never in the
        capture flow.
      </p>

      {savedNote && (
        <p
          data-testid="teach-saved-note"
          className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 ring-1 ring-emerald-500/40"
        >
          ✓ Label profile saved for “{savedNote}”.
        </p>
      )}

      <button
        type="button"
        data-testid="labels-teach"
        onClick={() => {
          setSavedNote(null);
          setSub('teach');
        }}
        className="rounded-xl bg-slate-800 px-4 py-4 text-left ring-1 ring-slate-600 active:bg-slate-700"
      >
        <span className="flex items-center justify-between text-base font-semibold text-slate-200">
          🤖 Teach a new label
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-300 ring-1 ring-indigo-500/40">
            AI
          </span>
        </span>
        <span className="block text-xs font-normal text-slate-500">
          Photograph a carton label once — the AI learns its layout
        </span>
      </button>

      <button
        type="button"
        data-testid="labels-gtin"
        onClick={() => setSub('gtin')}
        className="rounded-xl bg-slate-800 px-4 py-4 text-left text-base font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700"
      >
        ▮▯ Barcode (GTIN) profiles
        <span className="block text-xs font-normal text-slate-500">
          {gtinList.length} saved · view, delete / relearn
        </span>
      </button>

      <button
        type="button"
        data-testid="labels-ocr"
        onClick={() => setSub('ocr')}
        className="rounded-xl bg-slate-800 px-4 py-4 text-left text-base font-semibold text-slate-200 ring-1 ring-slate-600 active:bg-slate-700"
      >
        🔤 OCR label profiles
        <span className="block text-xs font-normal text-slate-500">
          {ocrProfiles.length} saved · created by Teach a new label
        </span>
      </button>
    </div>
  );
}
