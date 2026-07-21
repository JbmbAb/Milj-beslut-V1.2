import { useEffect, useRef } from 'react';

/**
 * Hook to get the previous value of a prop or state
 * Useful for comparing prev vs current values
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  // eslint-disable-next-line react-hooks/refs -- this hook intentionally exposes the last committed value.
  return ref.current;
}
