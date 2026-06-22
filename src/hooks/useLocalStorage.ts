import { useCallback, useEffect, useState } from 'react';
import { loadJSON, saveJSON } from '../lib/storage';

/**
 * useState mirror that persists to localStorage. Reads once on mount, writes on
 * every change. Used for the scanner name and the in-flight session so a
 * refresh / app reopen doesn't lose a half-counted pallet.
 */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => loadJSON<T>(key, initial));

  useEffect(() => {
    saveJSON(key, value);
  }, [key, value]);

  const reset = useCallback(() => setValue(initial), [initial]);

  return [value, setValue, reset] as const;
}
