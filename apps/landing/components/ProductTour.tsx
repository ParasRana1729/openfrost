'use client';

import Image from 'next/image';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { tuiScreens } from '../lib/content';

type ScreenId = (typeof tuiScreens)[number]['id'];

export function ProductTour() {
  const [selectedId, setSelectedId] = useState<ScreenId>('assistant');
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectByIndex(index: number) {
    const normalized = (index + tuiScreens.length) % tuiScreens.length;
    const next = tuiScreens[normalized];
    if (!next) return;
    setSelectedId(next.id);
    const btn = tabRefs.current[normalized];
    btn?.focus();
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectByIndex(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectByIndex(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectByIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectByIndex(tuiScreens.length - 1);
    }
  }

  return (
    <div className="product-tour" data-ui>
      <div className="tour-controls" role="tablist" aria-label="Control Center TUI screens">
        {tuiScreens.map((screen, index) => {
          const selected = screen.id === selectedId;
          return (
            <button
              key={screen.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`${baseId}-tab-${screen.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                setSelectedId(screen.id);
                tabRefs.current[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              }}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {screen.tabLabel}
            </button>
          );
        })}
      </div>

      <div className="tour-panels">
        {tuiScreens.map((screen) => {
          const selected = screen.id === selectedId;
          return (
            <div
              key={screen.id}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${screen.id}`}
              hidden={!selected}
              tabIndex={selected ? 0 : undefined}
              className="tour-panel"
            >
              <figure className="tour-shot-figure">
                <div className="tour-shot-frame">
                  <Image
                    src={screen.imageSrc}
                    alt={screen.imageAlt}
                    width={1908}
                    height={1212}
                    unoptimized
                  />
                </div>
                <figcaption className="tour-shot-caption">
                  <strong>{screen.title}</strong>
                  <span>{screen.caption}</span>
                </figcaption>
              </figure>
            </div>
          );
        })}
      </div>
    </div>
  );
}
