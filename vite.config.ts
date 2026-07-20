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
        // Drain the body, then reply after a realistic delay with a canned result.
        req.resume();
        req.on('end', () => {
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
