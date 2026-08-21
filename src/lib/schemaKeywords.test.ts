import { describe, it, expect } from 'vitest';
import { TEACH_OUTPUT_SCHEMA } from './teachShared';
import { BARCODE_OUTPUT_SCHEMA, CARTON_READ_SCHEMA } from './barcodeTeachShared';

/**
 * The structured-output schema subset is narrower than JSON Schema. Numeric
 * constraints are rejected outright:
 *
 *   400 output_config.format.schema: For 'integer' type, property 'minimum'
 *       is not supported
 *
 * That took barcode analysis down in the field while label teaching (which
 * never used them) kept working. Bounds belong in code — coerceBarcodeMap and
 * validateProposedMap enforce them — so this test keeps them out of schemas.
 */
const UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'format',
  'default',
];

/** Every keyword used anywhere in a schema, with the path it appears at. */
function keywordPaths(node: unknown, path = '$'): { key: string; path: string }[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => keywordPaths(n, `${path}[${i}]`));
  if (typeof node !== 'object' || node === null) return [];
  const out: { key: string; path: string }[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.push({ key, path: `${path}.${key}` });
    // Don't descend into `properties`/`required` NAMES — a field legitimately
    // called "format" or "pattern" is not a schema keyword.
    if (key === 'required') continue;
    if (key === 'properties') {
      for (const [prop, sub] of Object.entries(value as Record<string, unknown>)) {
        out.push(...keywordPaths(sub, `${path}.properties.${prop}`).filter((k) => k.path !== `${path}.properties.${prop}`));
      }
      continue;
    }
    out.push(...keywordPaths(value, `${path}.${key}`));
  }
  return out;
}

const SCHEMAS: [string, unknown][] = [
  ['TEACH_OUTPUT_SCHEMA', TEACH_OUTPUT_SCHEMA],
  ['BARCODE_OUTPUT_SCHEMA', BARCODE_OUTPUT_SCHEMA],
  ['CARTON_READ_SCHEMA', CARTON_READ_SCHEMA],
];

describe('AI output schemas stay inside the supported subset', () => {
  it.each(SCHEMAS)('%s uses no unsupported keyword', (_name, schema) => {
    const offenders = keywordPaths(schema).filter((k) => UNSUPPORTED.includes(k.key));
    expect(
      offenders.map((o) => `${o.path} (${o.key})`),
      'These are rejected with HTTP 400 by the structured-output API — enforce the constraint in code instead',
    ).toEqual([]);
  });

  it.each(SCHEMAS)('%s declares a type and locks additionalProperties', (_name, schema) => {
    const s = schema as Record<string, unknown>;
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    expect(Array.isArray(s.required)).toBe(true);
  });

  it('catches a reintroduced numeric constraint', () => {
    const bad = { type: 'object', properties: { n: { type: 'integer', minimum: 0 } } };
    expect(keywordPaths(bad).filter((k) => UNSUPPORTED.includes(k.key))).toHaveLength(1);
  });
});
