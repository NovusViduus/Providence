import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Returns `true` when the user has been idle for `timeoutMs` milliseconds.
 * Resets on mouse, keyboard, scroll, or touch events.
 */
export function useIdleTimer(timeoutMs = 180_000): boolean {
  const [idle, setIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const reset = useCallback(() => {
    setIdle(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIdle(true), timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    // Start the timer immediately
    reset();
    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      clearTimeout(timerRef.current);
    };
  }, [reset]);

  return idle;
}
