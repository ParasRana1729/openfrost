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

export interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  footer?: ReactNode;
  className?: string;
}

export function ModalDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'md',
  initialFocusRef,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  footer,
  className = '',
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const titleId = useId();
  const descId = useId();

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
    const isInsideContent =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width;

    if (!isInsideContent) {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  const classes = [
    'modal-dialog',
    `modal-${maxWidth}`,
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
      aria-describedby={description ? descId : undefined}
      onCancel={handleCancel}
      onClick={handleClick}
      {...({ closedby: closeOnBackdropClick ? 'any' : 'closerequest' } as HTMLAttributes<HTMLDialogElement>)}
    >
      <div className="modal-header">
        <div className="modal-header-text">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="modal-description">
              {description}
            </p>
          ) : null}
        </div>
        {showCloseButton ? (
          <Button
            variant="ghost"
            size="sm"
            className="modal-close-btn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ✕
          </Button>
        ) : null}
      </div>

      <div className="modal-body">{children}</div>

      {footer ? <div className="modal-footer">{footer}</div> : null}
    </dialog>
  );
}
