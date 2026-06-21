/**
 * Button primitive — the one way to make a button in tournament-web.
 *
 * Renders `data-skip-base-style` so the global base `<button>` rule (index.css)
 * opts out, then applies `.btn .btn-<variant>` so the variant fully controls
 * appearance (incl. a real destructive `danger` variant — red background, not
 * red-text-on-green). All variants inherit the 48px tap-target floor.
 *
 * Forwards every native button prop (onClick, disabled, type, aria-*,
 * data-testid, style), so existing call sites and tests keep working.
 */
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  variant = 'primary',
  className,
  type,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type ?? 'button'}
      data-skip-base-style
      className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}
