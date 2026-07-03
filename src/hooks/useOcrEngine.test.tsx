// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Controllable stand-in for the engine load.
let resolveLoad: (v: unknown) => void;
let rejectLoad: (e: Error) => void;
let progressListener: ((msg: string) => void) | null = null;

vi.mock('../lib/ocr', () => ({
  preloadOcr: vi.fn(
    () =>
      new Promise((res, rej) => {
        resolveLoad = res;
        rejectLoad = rej;
      }),
  ),
  onOcrProgress: vi.fn((l: ((msg: string) => void) | null) => {
    progressListener = l;
  }),
}));

import { useOcrEngine } from './useOcrEngine';

beforeEach(() => {
  progressListener = null;
  vi.clearAllMocks();
});

describe('useOcrEngine', () => {
  it('REGRESSION: reaches "ready" when the engine load resolves', async () => {
    // The shipped bug: a single effect that depended on the status AND set it
    // cancelled itself on the idle->loading transition, so the resolved load
    // was ignored and the UI showed "Loading OCR engine…" forever — even
    // though the engine (verified by on-device diagnostics) had loaded fine.
    const { result } = renderHook(() => useOcrEngine(true));
    await waitFor(() => expect(result.current.status).toBe('loading'));

    await act(async () => {
      resolveLoad({});
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('stays idle while disabled, loads once enabled', async () => {
    const { result, rerender } = renderHook(({ on }) => useOcrEngine(on), {
      initialProps: { on: false },
    });
    expect(result.current.status).toBe('idle');

    rerender({ on: true });
    await waitFor(() => expect(result.current.status).toBe('loading'));
  });

  it('surfaces progress messages while loading', async () => {
    const { result } = renderHook(() => useOcrEngine(true));
    await waitFor(() => expect(result.current.status).toBe('loading'));

    act(() => progressListener?.('loading tesseract core 40%'));
    await waitFor(() => expect(result.current.message).toBe('loading tesseract core 40%'));
  });

  it('reports errors with the message, and retry() restarts the load', async () => {
    const { result } = renderHook(() => useOcrEngine(true));
    await waitFor(() => expect(result.current.status).toBe('loading'));

    await act(async () => {
      rejectLoad(new Error('boom'));
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.message).toBe('boom');

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('loading'));
  });

  it('fail() forces the error state (scan-loop backoff)', async () => {
    const { result } = renderHook(() => useOcrEngine(true));
    await waitFor(() => expect(result.current.status).toBe('loading'));
    await act(async () => {
      resolveLoad({});
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.fail('recognition kept failing'));
    expect(result.current.status).toBe('error');
    expect(result.current.message).toBe('recognition kept failing');
  });
});
