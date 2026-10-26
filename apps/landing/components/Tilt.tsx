'use client';

import { type HTMLAttributes, type PointerEvent, type ReactNode, useRef } from 'react';

/**
 * Adapted from Tilt by Julien Thibeaut (ibelick), surfaced on 21st.dev.
 * MIT license, as listed on the component page: https://21st.dev/@ibelick/components/tilt
 * Keeps its pointer-to-perspective interaction, with CSS variables and no runtime dependency.
 */
export function Tilt({ children, className, ...attributes }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  const updateTilt = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    ref.current?.style.setProperty('--tilt-x', `${-y * 5}deg`);
    ref.current?.style.setProperty('--tilt-y', `${x * 5}deg`);
  };

  const resetTilt = () => {
    ref.current?.style.setProperty('--tilt-x', '0deg');
    ref.current?.style.setProperty('--tilt-y', '0deg');
  };

  return <div {...attributes} ref={ref} className={className} onPointerMove={updateTilt} onPointerLeave={resetTilt}>{children}</div>;
}
