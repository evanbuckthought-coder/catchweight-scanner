import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Guard against the ESM extension trap that has now taken the teach endpoint
 * down twice.
 *
 * The project is ESM ("type": "module"), and Node's ESM resolver — which the
 * Vercel serverless runtime uses — does NOT add file extensions. An
 * extensionless relative import ANYWHERE in the module graph reachable from
 * api/ kills the function at cold start with FUNCTION_INVOCATION_FAILED,
 * surfacing as an unexplained HTTP 500 for every mode the endpoint serves.
 *
 * Vite/TS resolve '.js' specifiers back to the '.ts' source, so requiring the
 * extension costs the client build nothing.
 */

const ROOT = resolve(__dirname, '../..');
const API_DIR = join(ROOT, 'api');

/** Every relative import/export specifier in a source file. */
function relativeSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"](\.[^'"]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

/** Walk the graph from every api/ entry point. */
function serverModuleGraph(): { file: string; specifier: string }[] {
  const found: { file: string; specifier: string }[] = [];
  const seen = new Set<string>();
  const queue = readdirSync(API_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(API_DIR, f));

  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const spec of relativeSpecifiers(source)) {
      found.push({ file: file.slice(ROOT.length + 1).replace(/\\/g, '/'), specifier: spec });
      // Follow it: '.js' specifiers map back to the '.ts' source on disk.
      const asTs = join(dirname(file), spec.replace(/\.js$/, '.ts'));
      if (existsSync(asTs)) queue.push(asTs);
      else if (existsSync(`${asTs}.ts`)) queue.push(`${asTs}.ts`);
    }
  }
  return found;
}

describe('serverless module graph (api/ and everything it imports)', () => {
  it('reaches more than just the entry point (the walker actually follows imports)', () => {
    const graph = serverModuleGraph();
    expect(graph.length).toBeGreaterThan(1);
    // teachShared is imported by barcodeTeachShared, so it is only reachable
    // if the walk followed at least two hops.
    expect(graph.some((g) => g.file.includes('barcodeTeachShared'))).toBe(true);
  });

  it('every relative import carries a .js extension (Node ESM adds none)', () => {
    const offenders = serverModuleGraph().filter((g) => !g.specifier.endsWith('.js'));
    expect(
      offenders,
      `Extensionless relative import(s) in the serverless graph — these crash the ` +
        `Vercel function at cold start (HTTP 500 / FUNCTION_INVOCATION_FAILED):\n` +
        offenders.map((o) => `  ${o.file}: '${o.specifier}'`).join('\n'),
    ).toEqual([]);
  });
});
