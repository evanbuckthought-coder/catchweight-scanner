import { defineConfig } from 'vite';
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

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    tailwindcss(),
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
