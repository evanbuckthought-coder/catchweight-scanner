import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// iOS Safari only grants camera access in a secure context. localhost counts as
// secure, but a phone hitting the dev machine over the LAN does not — so for
// on-device testing run `HTTPS=1 npm run dev -- --host` to serve over https with
// a self-signed cert (accept the warning once on the phone). Plain http is kept
// as the default so localhost dev / automated preview keeps working.
const useHttps = !!process.env.HTTPS;

// Visible build stamp (UTC time + commit when built on Vercel) so a device's
// running version is verifiable at a glance — stale-PWA debugging.
const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const buildId = `${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z${sha ? ` · ${sha.slice(0, 7)}` : ''}`;

/**
 * DEV-ONLY mock of the Vercel serverless function /api/teach-label, so the
 * "Teach a new label" flow can be exercised under `vite dev` without an AI
 * key. Production traffic hits the real function in /api (deployed by
 * Vercel); this plugin only applies to the dev server.
 */
function mockTeachApi(): Plugin {
  return {
    name: 'mock-teach-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/teach-label', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { error: 'POST only' });
        if (!req.headers['x-teach-secret']) return send(401, { error: 'Unauthorised' });
        // Collect the body so the barcode mock can answer for the actual
        // scanned digits (the real model derives positions the same way).
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', () => {
          const body = (() => {
            try {
              return JSON.parse(raw || '{}') as { mode?: string; digits?: string };
            } catch {
              return {} as { mode?: string; digits?: string };
            }
          })();

          // --- UNSCANNABLE carton read mock (mode: 'carton') ----------------
          if (body.mode === 'carton') {
            setTimeout(() => {
              send(200, {
                ok: true,
                result: {
                  netWeightPrinted: '17.54 KG (MOCK)',
                  netWeightValue: 17.54,
                  unit: 'kg',
                  productionDate: '2026-06-30',
                  bestBefore: null,
                  useBy: '2026-11-17',
                  product: 'POINT END BRISKET GRAIN FED-MSA (MOCK)',
                  productCode: '35176',
                  batch: '26181',
                  serial: '425305',
                  confidence: 0.93,
                  notes: null,
                },
              });
            }, 1200);
            return;
          }

          // --- barcode FORMAT MAP mock (mode: 'barcode') --------------------
          if (body.mode === 'barcode') {
            const digits = body.digits ?? '';
            setTimeout(() => {
              send(200, {
                ok: true,
                result: {
                  formatName: 'NZ legacy 20-digit meat carton (MOCK)',
                  totalLength: digits.length,
                  fields: {
                    netWeight: {
                      start: 6,
                      length: 3,
                      encoding: 'integer',
                      multiplier: 0.1,
                      unit: 'kg',
                      printedValueSeen: '15.3 kg',
                      confidence: 0.95,
                    },
                    productionDate: {
                      start: 9,
                      length: 5,
                      encoding: 'yy-dayofyear',
                      printedValueSeen: '08 Mar 24',
                      confidence: 0.9,
                    },
                    productCode: { start: 1, length: 5, printedValueSeen: '07-800', confidence: 0.9 },
                    serial: { start: 14, length: 4, printedValueSeen: '1371', confidence: 0.8 },
                    bestBefore: null,
                  },
                  signature: {
                    length: digits.length,
                    prefix: digits.slice(0, 1) || null,
                    prefixLength: 1,
                  },
                  verification: {
                    weightMatchesPrinted: true,
                    dateMatchesPrinted: true,
                    notes: 'Mock response from the vite dev server — production calls Claude.',
                  },
                },
              });
            }, 1200);
            return;
          }

          setTimeout(() => {
            send(200, {
              ok: true,
              result: {
                supplier: { value: 'Fribin Meats S.L. (MOCK)', confidence: 'high' },
                manufacturer: { value: null, confidence: 'low' },
                product: { value: 'Pork shoulder boneless', confidence: 'high' },
                gtin: { value: '98411314000123', barcodeType: 'gs1-128-weight', confidence: 'medium' },
                weight: {
                  printedExample: '21.652 kg',
                  unit: 'kg',
                  decimalPlaces: 3,
                  region: 'bottom-right, inside the boxed grid',
                  anchorText: 'NET WEIGHT',
                  nominalPackKg: 10,
                  confidence: 'high',
                },
                dates: [
                  { kind: 'packaging', printedFormat: 'DD/MM/YYYY', label: 'PKD', confidence: 'high' },
                  { kind: 'best-before', printedFormat: 'DD/MM/YYYY', label: 'BEST BEFORE', confidence: 'medium' },
                ],
                batch: { value: 'L24170', confidence: 'high' },
                serial: { value: null, confidence: 'low' },
                notes: 'Mock response from the vite dev server — production calls Claude.',
              },
            });
          }, 1200);
        });
      });
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    tailwindcss(),
    mockTeachApi(),
    ...(useHttps ? [basicSsl()] : []),
  ],
  // Keep the zbar wasm out of the dep pre-bundler; we load the .wasm explicitly
  // via a `?url` import + locateFile (see src/lib/scanner.ts).
  optimizeDeps: {
    exclude: ['@undecaf/zbar-wasm'],
  },
  server: {
    // Allow Cloudflare quick-tunnel hostnames (random *.trycloudflare.com) to
    // reach the dev server. Without this, Vite blocks the foreign Host header.
    allowedHosts: ['.trycloudflare.com'],
  },
});
