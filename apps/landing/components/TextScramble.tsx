'use client';

import { useEffect, useState } from 'react';

/** Adapted from Motion Primitives' Text Scramble by Julien Thibeaut (ibelick), listed on 21st.dev. MIT license. */
export function TextScramble({ children, label }: { children: string; label: string }) {
  const [displayText, setDisplayText] = useState(children);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const speed = 32;
    const totalSteps = 27;
    let step = 0;
    const timer = window.setInterval(() => {
      const progress = step / totalSteps;
      setDisplayText(
        [...children].map((character, index) => {
          if (character === '\n' || character === ' ' || progress * children.length > index) return character;
          return chars[Math.floor(Math.random() * chars.length)];
        }).join(''),
      );
      step += 1;
      if (step > totalSteps) {
        window.clearInterval(timer);
        setDisplayText(children);
      }
    }, speed);

    return () => window.clearInterval(timer);
  }, [children]);

  return <span className="text-scramble" aria-label={label} aria-live="off">{displayText}</span>;
}
