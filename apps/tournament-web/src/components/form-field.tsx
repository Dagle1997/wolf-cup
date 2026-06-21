/**
 * FormField primitive — a label + control unit (flex column, token spacing).
 * Wraps the control in its `<label>` for implicit association and zeroes the
 * base control margin via the `.form-field` class, so forms stop hand-rolling
 * `fieldStyle`/`inputStyle` inline objects.
 */
import type { CSSProperties, ReactNode } from 'react';

export function FormField({
  label,
  children,
  style,
}: {
  label: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label className="form-field" style={style}>
      <span className="form-field__label">{label}</span>
      {children}
    </label>
  );
}
