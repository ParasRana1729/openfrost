'use client';

import React, {
  useId,
  useState,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

export interface DisclosureProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
  variant?: 'default' | 'card' | 'subtle';
  name?: string;
  badge?: ReactNode;
  headingLevel?: 'h2' | 'h3' | 'h4' | 'none';
  className?: string;
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  isOpen: controlledIsOpen,
  onToggle,
  variant = 'default',
  name,
  badge,
  headingLevel = 'none',
  className = '',
}: DisclosureProps) {
  const isControlled = controlledIsOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isControlled ? controlledIsOpen : internalOpen;

  const contentId = useId();
  const buttonId = useId();

  const handleControlledToggle = () => {
    const next = !open;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onToggle?.(next);
  };

  const handleSummaryClick = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const nextOpen = !open;
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    onToggle?.(nextOpen);
  };

  const handleNativeToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    const isNowOpen = e.currentTarget.open;
    if (isNowOpen !== open) {
      if (!isControlled) {
        setInternalOpen(isNowOpen);
      }
      onToggle?.(isNowOpen);
    }
  };

  const classes = [
    'disclosure',
    `disclosure-${variant}`,
    open ? 'disclosure-open' : 'disclosure-closed',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Controlled mode or Heading-wrapped mode
  if (isControlled || headingLevel !== 'none') {
    const trigger = (
      <button
        id={buttonId}
        type="button"
        className="disclosure-trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={handleControlledToggle}
      >
        <span className="disclosure-chevron" aria-hidden="true">
          ▶
        </span>
        <span className="disclosure-title-text">{title}</span>
        {badge ? <span className="disclosure-badge">{badge}</span> : null}
      </button>
    );

    const Heading = headingLevel !== 'none' ? headingLevel : null;

    return (
      <div className={classes}>
        {Heading ? <Heading className="disclosure-heading">{trigger}</Heading> : trigger}
        <div
          id={contentId}
          role="region"
          aria-labelledby={buttonId}
          className="disclosure-content"
          hidden={!open}
        >
          {open ? children : null}
        </div>
      </div>
    );
  }

  // Native <details> / <summary> mode
  return (
    <details
      className={classes}
      open={open}
      name={name}
      onToggle={handleNativeToggle}
    >
      <summary className="disclosure-summary" onClick={handleSummaryClick}>
        <span className="disclosure-chevron" aria-hidden="true">
          ▶
        </span>
        <span className="disclosure-title-text">{title}</span>
        {badge ? <span className="disclosure-badge">{badge}</span> : null}
      </summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}
