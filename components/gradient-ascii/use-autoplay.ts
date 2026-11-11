// Copyright (c) 2026 Bruno Delorence. MIT License.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * When a demo may play on its own: while part of it is on screen and the tab is visible, never
 * under reduced motion, and never again once the reader has used it. `take()` hands it to the
 * reader for good (until the component mounts again).
 */
export function useAutoplay<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [taken, setTaken] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let onScreen = false;
    const update = () => setVisible(onScreen && !document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        update();
      },
      { threshold: 0.3 },
    );
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const readMotion = () => setReduced(motion.matches);
    readMotion();
    motion.addEventListener('change', readMotion);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
      motion.removeEventListener('change', readMotion);
    };
  }, []);

  const take = useCallback(() => setTaken(true), []);

  return { ref, take, playing: visible && !reduced && !taken };
}
