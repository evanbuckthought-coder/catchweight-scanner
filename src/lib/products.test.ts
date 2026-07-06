// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSupplierProducts, rememberProduct, searchSupplierProducts } from './products';

beforeEach(() => localStorage.clear());

describe('rememberProduct', () => {
  it('remembers per supplier, most-recent first, no duplicates', () => {
    rememberProduct('Taylor Preston', 'Striploins VP');
    rememberProduct('Taylor Preston', 'Ribeye VP');
    rememberProduct('Taylor Preston', 'striploins vp'); // dup (case-insensitive)
    expect(loadSupplierProducts('Taylor Preston')).toEqual(['Ribeye VP', 'Striploins VP']);
  });

  it('keys by supplier (case-insensitive) and ignores blanks', () => {
    rememberProduct('Alliance Group', 'Lamb legs');
    rememberProduct('  ', 'Nothing');
    rememberProduct('Alliance', '   ');
    expect(loadSupplierProducts('alliance group')).toEqual(['Lamb legs']);
    expect(loadSupplierProducts('Alliance')).toEqual([]);
  });
});

describe('searchSupplierProducts', () => {
  beforeEach(() => {
    rememberProduct('Taylor Preston', 'Boneless beef striploins');
    rememberProduct('Taylor Preston', 'Beef ribeye');
  });

  it('matches anywhere, ranks prefix ahead of contains', () => {
    const r = searchSupplierProducts('Taylor Preston', 'beef');
    expect(r[0]).toBe('Beef ribeye'); // prefix
    expect(r).toContain('Boneless beef striploins'); // contains
  });

  it('folds in current-session names not yet remembered', () => {
    const r = searchSupplierProducts('Taylor Preston', 'lamb', ['Lamb shoulder']);
    expect(r).toEqual(['Lamb shoulder']);
  });

  it('empty query lists recent (deduped)', () => {
    const r = searchSupplierProducts('Taylor Preston', '', ['Beef ribeye']);
    expect(r).toContain('Beef ribeye');
    expect(new Set(r).size).toBe(r.length);
  });

  it('returns nothing for an unknown supplier + no extras', () => {
    expect(searchSupplierProducts('Nobody', 'beef')).toEqual([]);
  });
});
