import { useEffect, useRef } from 'react';

export default function useAutoDismiss(value, dismiss, delay = 10000) {
  const dismissRef = useRef(dismiss);

  useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);

  useEffect(() => {
    if (!value) return undefined;
    const timer = window.setTimeout(() => dismissRef.current?.(), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
}
