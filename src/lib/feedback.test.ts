// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onSignal, signalError, signalSuccess, type FlashKind } from './feedback';

/**
 * The scan overlay rides on the same channel as the capture beep, so these
 * tests are what guarantee the tick can never drift away from the sound: if a
 * signal fires, a flash is emitted, and it carries the right kind.
 */
describe('capture signal channel', () => {
  let seen: FlashKind[];
  let off: () => void;

  beforeEach(() => {
    seen = [];
    off?.();
    off = onSignal((kind) => seen.push(kind));
  });

  it('a successful capture emits a success flash', () => {
    signalSuccess();
    expect(seen).toEqual(['success']);
  });

  it('a failed scan emits a distinct error flash', () => {
    signalError();
    expect(seen).toEqual(['error']);
  });

  it('rapid successive scans each emit their own flash, in order', () => {
    signalSuccess();
    signalSuccess();
    signalError();
    signalSuccess();
    expect(seen).toEqual(['success', 'success', 'error', 'success']);
  });

  it('unsubscribing stops delivery (screen unmounted)', () => {
    off();
    off = () => {};
    signalSuccess();
    expect(seen).toEqual([]);
  });

  it('a throwing listener can never break capture feedback', () => {
    const offBad = onSignal(() => {
      throw new Error('boom');
    });
    expect(() => signalSuccess()).not.toThrow();
    expect(seen).toEqual(['success']); // the good listener still ran
    offBad();
  });

  it('supports several subscribers (e.g. during a screen transition)', () => {
    const second: FlashKind[] = [];
    const off2 = onSignal((k) => second.push(k));
    signalError();
    expect(seen).toEqual(['error']);
    expect(second).toEqual(['error']);
    off2();
  });

  it('signals never throw without Web Audio (silenced/unsupported device)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => {
      signalSuccess();
      signalError();
    }).not.toThrow();
    spy.mockRestore();
  });
});
