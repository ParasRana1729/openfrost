'use client';

import React, {
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { Button } from './Button';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  children,
  size = 'lg',
  footer,
  initialFocusRef,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = '',
}: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    if (!isOpen) {
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute('open', '');
    }

    if (initialFocusRef?.current) {
      initialFocusRef.current.focus();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, initialFocusRef]);

  const handleCancel = (e: SyntheticEvent<HTMLDialogElement, Event>) => {
    if (!closeOnEscape) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    onClose();
  };

  const handleClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (!closeOnBackdropClick) return;
    const dialog = dialogRef.current;
    if (!dialog || e.target !== dialog) return;

    const rect = dialog.getBoundingClientRect();
    const isInside =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width;

    if (!isInside) {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  const classes = [
    'drawer-dialog',
    `drawer-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <dialog
      ref={dialogRef}
      className={classes}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={handleCancel}
      onClick={handleClick}
      {...({ closedby: closeOnBackdropClick ? 'any' : 'closerequest' } as HTMLAttributes<HTMLDialogElement>)}
    >
      <div className="drawer-panel">
        <header className="drawer-header">
          <div className="drawer-header-content">
            <div className="drawer-title-row">
              <h2 id={titleId} className="drawer-title">
                {title}
              </h2>
              {badge ? <div className="drawer-badge">{badge}</div> : null}
            </div>
            {subtitle ? (
              <p id={subtitleId} className="drawer-subtitle">
                {subtitle}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="drawer-close-btn"
            aria-label="Close drawer"
            onClick={onClose}
          >
            ✕
          </Button>
        </header>

        <div className="drawer-body">{children}</div>

        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
