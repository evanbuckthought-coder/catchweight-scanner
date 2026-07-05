// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadCustomSuppliers, rememberSupplier, searchSuppliers, SUPPLIER_NAMES } from './suppliers';

beforeEach(() => localStorage.clear());

describe('searchSuppliers', () => {
  it('matches anywhere in the name, case-insensitive', () => {
    expect(searchSuppliers('silver')).toContain('Silver Fern Farms');
    expect(searchSuppliers('jbs')).toContain('JBS USA / Swift');
    expect(searchSuppliers('hellaby')).toEqual(
      expect.arrayContaining(['Wilson Hellaby', 'Auckland Meat Processors (AMP / Wilson Hellaby)']),
    );
  });

  it('ranks prefix matches ahead of contains-matches', () => {
    // "wilson" prefixes "Wilson Hellaby" but is only contained in
    // "Ken Wilson Meats" / "Auckland Meat Processors (... Wilson Hellaby)".
    const results = searchSuppliers('wilson');
    expect(results[0]).toBe('Wilson Hellaby');
    expect(results.length).toBeGreaterThan(1);
  });

  it('puts an exact match first', () => {
    rememberSupplier('Tegel Foods');
    expect(searchSuppliers('tegel')[0]).toBe('Tegel');
  });

  it('returns nothing for an empty query and caps the result count', () => {
    expect(searchSuppliers('')).toEqual([]);
    expect(searchSuppliers('e').length).toBeLessThanOrEqual(8);
  });
});

describe('rememberSupplier', () => {
  it('remembers a new free-typed supplier and surfaces it in search', () => {
    rememberSupplier('Prime Range Meats');
    expect(loadCustomSuppliers()).toEqual(['Prime Range Meats']);
    expect(searchSuppliers('prime range')).toContain('Prime Range Meats');
  });

  it('never duplicates seed or already-remembered names (case-insensitive)', () => {
    rememberSupplier('silver fern farms'); // seed
    rememberSupplier('Prime Range Meats');
    rememberSupplier('PRIME RANGE MEATS');
    expect(loadCustomSuppliers()).toEqual(['Prime Range Meats']);
  });

  it('ignores blank input', () => {
    rememberSupplier('   ');
    expect(loadCustomSuppliers()).toEqual([]);
  });
});

describe('SUPPLIER_NAMES seed list', () => {
  it('has no duplicate entries', () => {
    const lower = SUPPLIER_NAMES.map((n) => n.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });
});
