# Catchweight Scanner

A standalone mobile web app (PWA) that scans **GS1-128** barcodes on random-weight
(catchweight) meat cartons with an iPhone camera, parses the weight + traceability
data, tallies a running pallet total in **kg**, checks it against an expected receipt,
and exports the captured data to **Excel**. Everything is client-side — no backend,
no SAP, no cloud. A proof-of-loop to run on a single iPhone.

## Stack

- **Vite + React + TypeScript**
- **Tailwind CSS v4** (via `@tailwindcss/vite`)
- **ZBar compiled to WebAssembly** (`@undecaf/zbar-wasm`) for decoding — *not* the
  browser `BarcodeDetector` API (unimplemented in Safari/WebKit, silently fails on
  iOS) and *not* a pure-JS decoder (too slow/flaky on dense Code 128).
- **SheetJS** (`xlsx`, community edition) for the client-side Excel export
  (lazy-loaded on first export to keep the initial bundle small).
- `localStorage` for the scanner name, GTIN profiles, and the in-flight session.
- Installable PWA (manifest + app-shell service worker).

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173  (localhost is a secure context)
npm run build        # type-check + production build to dist/
npm test             # parser, session/variance, and Excel-export unit tests
npm run parser:check # just the GS1 parser tests, verbose (prints parsed cartons + kg total)
```

### Testing on a real iPhone

iOS Safari only grants camera access in a **secure (HTTPS)** context, and only after
a user gesture (tapping into the app). `localhost` is exempt, but a phone hitting your
dev machine over the LAN is not — so serve over HTTPS:

```bash
HTTPS=1 npm run dev -- --host
```

This enables a self-signed cert (via `@vitejs/plugin-basic-ssl`). On the phone, open
`https://<your-machine-ip>:5173`, accept the certificate warning once, then **Add to
Home Screen** to install. The first camera use prompts for permission; if denied,
the app shows how to re-enable it.

> Self-signed certs are fine for a proof-of-loop. For a shared demo, host the built
> `dist/` on any static HTTPS host instead.

## How it works

1. **Setup** — enter your name once (persisted; auto-fills every scan). *In a future
   native/SSO build this comes from the login; a browser PWA can't read the device
   user, so set-once-persist is the approach.*
2. **Start session** — Receipt/PO ref (required) + optional expected kg, expected
   carton count, and tolerance (default 0).
3. **Scan loop** — live rear camera, continuous decode. On a valid GS1-128:
   - **First carton of the session** *(always)*, a **new GTIN**, or a GTIN whose
     **label format changed** → a confirm sheet (pre-filled product/supplier, supplier
     suggested from the GTIN prefix). The first-carton confirm is a deliberate,
     non-negotiable fail-safe — a person eyeballs the first box every session.
   - Otherwise → counted straight to the tally with product/supplier auto-filled from
     the saved GTIN profile.
   - Identical re-scans (same GTIN + batch/serial) are de-duped and warned.
4. **Readout** — big scale-style total in kg, carton count, last carton; a prominent
   **MIXED UNITS** flag if a session mixes kg + lb cartons.
5. **Variance** — received vs expected kg/cartons → `MATCH` (within tolerance) or
   `HOLD (SHORT/OVER)` (outside tolerance, or any carton-count mismatch).
6. **Export** — a two-sheet `.xlsx` downloaded to the phone.

## GS1-128 parsing

Handles both raw scanner output (variable-length fields terminated by the FNC1/GS
separator, ASCII 29) and the human-readable parenthesised form `(01)...(3102)...`.

| AI     | Meaning            | Length / decode                              |
|--------|--------------------|----------------------------------------------|
| `01`   | GTIN               | 14, as-is                                    |
| `310n` | Net weight, **kg** | 6; value = int / 10ⁿ (n = 4th digit)         |
| `320n` | Net weight, **lb** | 6; value = int / 10ⁿ → also normalised to kg |
| `10`   | Batch / Lot        | variable (FNC1)                              |
| `21`   | Serial             | variable (FNC1)                              |
| `11/13/15/17` | Production / Packaging / Best-before / Use-by | 6, YYMMDD → 20YY-MM-DD |
| `00`   | SSCC               | 18, as-is (optional)                         |
| `37`   | Count              | variable (optional)                          |

- `1 lb = 0.45359237 kg` (exact). The total is always in kg.
- Traceability id = batch (10) if present, otherwise serial (21).
- Every date present is captured and labelled correctly — production date is *not*
  assumed to exist.
- The raw scanned string is kept on every record (audit trail).
- Format fingerprint per carton = `{weightAI, traceAI}` + GTIN company prefix.

Missing fields or unknown AIs are surfaced as errors rather than guessed.

## Excel export

- **Cartons** — one row per scan: Scan time · Scanned by · Receipt/PO ref · Supplier ·
  Product · GTIN · Net weight · Unit · Weight (kg) · Batch/Lot · Serial · Production
  date · Packaging date · Best before · Use by · Raw GS1 string.
- **Receipt summary** — one row per session: Receipt/PO ref · Date/time · Scanned by ·
  Supplier · Carton count · Total kg · Expected kg · Variance kg · Expected ctns ·
  Variance ctns · Status.

This field set is intentionally the same shape that would later map to an **SAP EWM
inbound delivery** (handling units / delivery items + the GR header). The xlsx is just
today's endpoint — the data model doesn't change when SAP integration lands.

## Sample labels

Five real labels are wired in as "simulated scan" buttons (dev panel) so the whole loop
is testable without a physical carton. The Smithfield label is in pounds (AI `3202`)
and normalises to kg, proving unit handling. Across all five the total is **64.86 kg**.

## Non-goals

No backend, no auth server, no SAP/EWM integration, no cloud sync. Operational data
only; nothing sensitive is stored.
