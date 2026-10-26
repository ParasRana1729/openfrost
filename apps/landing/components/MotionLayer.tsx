'use client';

import { useEffect } from 'react';

export function MotionLayer() {
  useEffect(() => {
    const targets = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('IntersectionObserver' in window)) return;

    for (const target of targets) {
      if (target.getBoundingClientRect().top > window.innerHeight * 0.9) {
        target.dataset.motionPending = 'true';
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = 'true';
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );

    for (const target of targets) {
      if (target.dataset.motionPending) observer.observe(target);
    }
    return () => observer.disconnect();
  }, []);

  return null;
}
