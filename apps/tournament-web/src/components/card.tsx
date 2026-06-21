/**
 * Card primitive — a surfaced section using the shared `.card` class (token
 * background/border/radius/shadow/padding). Replaces per-page inline
 * border/radius/padding objects so every framed block reads the same.
 */
import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  style,
  className,
  ...rest
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`} style={style} {...rest}>
      {children}
    </section>
  );
}
