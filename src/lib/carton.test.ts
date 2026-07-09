import { describe, it, expect } from 'vitest';
import { toManualCartonRecord } from './carton';

const ctx = {
  scannedBy: 'Evan',
  poRef: 'PO-1',
  supplier: 'Taylor Preston',
  product: 'Boneless beef striploins',
  gtin: '',
};

describe('toManualCartonRecord', () => {
  it('inherits the manual product start dates onto the carton', () => {
    const rec = toManualCartonRecord(
      { netWeight: 14.54, unit: 'kg' },
      { ...ctx, productionDate: '2026-05-22', bestBefore: '2026-08-20' },
    );
    expect(rec.productionDate).toBe('2026-05-22');
    expect(rec.bestBefore).toBe('2026-08-20');
    expect(rec.entry).toBe('manual');
    expect(rec.weightKg).toBeCloseTo(14.54, 3);
  });

  it('leaves dates undefined when none were captured (no-date-available start)', () => {
    const rec = toManualCartonRecord({ netWeight: 8.2, unit: 'kg' }, ctx);
    expect(rec.productionDate).toBeUndefined();
    expect(rec.bestBefore).toBeUndefined();
  });

  it('converts lb entries to kg for the tally', () => {
    const rec = toManualCartonRecord({ netWeight: 32.06, unit: 'lb' }, ctx);
    expect(rec.unit).toBe('lb');
    expect(rec.weightKg).toBeCloseTo(14.54, 2);
  });
});
