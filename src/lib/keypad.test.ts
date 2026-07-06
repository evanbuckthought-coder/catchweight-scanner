import { describe, it, expect } from 'vitest';
import { applyKeypadKey, keypadValue, type KeypadKey } from './keypad';

const type = (keys: string): string =>
  [...keys].reduce((v, k) => applyKeypadKey(v, (k === '<' ? 'back' : k) as KeypadKey), '');

describe('applyKeypadKey', () => {
  it('types a typical carton weight', () => {
    expect(type('14.54')).toBe('14.54');
  });

  it('only one decimal point; leading "." becomes "0."', () => {
    expect(type('14..54')).toBe('14.54');
    expect(type('.5')).toBe('0.5');
  });

  it('backspace corrects', () => {
    expect(type('14.55<4')).toBe('14.54');
    expect(type('1<')).toBe('');
  });

  it('caps decimals at 3 (scale precision) and integer digits at 4', () => {
    expect(type('1.2345')).toBe('1.234');
    expect(type('12345')).toBe('1234');
  });

  it('no leading zeros, but "0.x" works', () => {
    expect(type('05')).toBe('5');
    expect(type('0.5')).toBe('0.5');
  });
});

describe('keypadValue', () => {
  it('parses a usable weight', () => {
    expect(keypadValue('14.54')).toBe(14.54);
    expect(keypadValue('18.')).toBe(18);
  });

  it('is null while the entry is not usable', () => {
    expect(keypadValue('')).toBeNull();
    expect(keypadValue('.')).toBeNull();
    expect(keypadValue('0.')).toBeNull();
  });
});
