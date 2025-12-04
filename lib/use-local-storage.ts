import { useEffect, useState } from "react";

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(key);
    if (stored !== null) {
      try {
        setValue(JSON.parse(stored));
      } catch {
        // If a legacy plain string was stored (non-JSON), keep it instead of wiping.
        setValue(stored as unknown as T);
      }
    }
    setHasLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasLoaded) return; // avoid overwriting existing storage on first mount
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value, hasLoaded]);

  return [value, setValue] as const;
}
