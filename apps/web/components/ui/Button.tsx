'use client';

import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  href?: string;
  asExternalLink?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    type = 'button',
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingText,
    iconLeft,
    iconRight,
    disabled = false,
    className = '',
    children,
    href,
    asExternalLink,
    onClick,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const classes = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    loading ? 'btn-loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {loading ? (
        <span className="btn-spinner" aria-hidden="true">
          <span className="dot dot-running" />
        </span>
      ) : iconLeft ? (
        <span className="btn-icon-left" aria-hidden="true">
          {iconLeft}
        </span>
      ) : null}
      <span className="btn-text">
        {loading && loadingText ? loadingText : children}
      </span>
      {!loading && iconRight ? (
        <span className="btn-icon-right" aria-hidden="true">
          {iconRight}
        </span>
      ) : null}
    </>
  );

  if (href && !isDisabled) {
    if (asExternalLink) {
      return (
        <a
          href={href}
          className={classes}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
          {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {content}
        </a>
      );
    }
    return (
      <Link
        href={href}
        className={classes}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
        {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-disabled={isDisabled ? 'true' : undefined}
      aria-busy={loading ? 'true' : undefined}
      onClick={isDisabled ? undefined : onClick}
      {...rest}
    >
      {content}
    </button>
  );
});
