import React, {
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'panel' | 'raised' | 'inset' | 'interactive';
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: 'div' | 'article' | 'section';
}

export function Card({
  variant = 'default',
  interactive = false,
  padding = 'md',
  as: Component = 'div',
  className = '',
  children,
  onClick,
  onKeyDown,
  ...rest
}: CardProps) {
  const isInteractive = interactive || variant === 'interactive';

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (isInteractive && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick?.(e as unknown as MouseEvent<HTMLDivElement>);
    }
    onKeyDown?.(e);
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (isInteractive) {
      const target = e.target as HTMLElement | null;
      const interactiveChild = target?.closest(
        'button, a, input, select, textarea, [role="button"]',
      );
      if (interactiveChild && interactiveChild !== e.currentTarget) {
        return;
      }
    }
    onClick?.(e);
  };

  const classes = [
    'polar-card',
    `card-${variant}`,
    isInteractive && variant !== 'interactive' ? 'card-interactive' : '',
    `card-p-${padding}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Component
      className={classes}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </Component>
  );
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  action?: ReactNode;
}

export function CardHeader({
  action,
  className = '',
  children,
  ...rest
}: CardHeaderProps) {
  return (
    <div className={`card-header ${className}`} {...rest}>
      <div className="card-header-main">{children}</div>
      {action ? <div className="card-header-action">{action}</div> : null}
    </div>
  );
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'div';
  accent?: boolean;
}

export function CardTitle({
  as: Heading = 'h3',
  accent = false,
  className = '',
  children,
  ...rest
}: CardTitleProps) {
  const classes = [
    'card-title',
    accent ? 'card-title-accent' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Heading className={classes} {...rest}>
      {children}
    </Heading>
  );
}

export function CardDescription({
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`card-description ${className}`} {...rest}>
      {children}
    </p>
  );
}

export function CardBody({
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card-body ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card-footer ${className}`} {...rest}>
      {children}
    </div>
  );
}
