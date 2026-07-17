'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Form primitives.
 *
 * The two exported class strings below are the whole button/input design. They
 * are exported because the styling had already been copy-pasted into five other
 * files (the new-project form, the goals panel, the danger zone), which is how
 * the three inputs on the new-project page ended up subtly out of step with
 * every other input in the app. A component can't always be used — a controlled
 * <select> needs its own element — but the string can.
 */

export const inputShell =
  // Placeholder uses the raw ramp, not text-muted: a placeholder that passes AA
  // is indistinguishable from a filled-in value.
  'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-ink-400 transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none disabled:opacity-50';

export const buttonStyles = {
  primary: 'bg-brand-500 text-white shadow-sm shadow-brand-500/25 hover:bg-brand-600',
  ghost: 'border border-border-strong bg-surface text-text-muted hover:bg-surface-sunken hover:text-text',
  danger: 'border border-danger-600/30 bg-danger-500/10 text-danger-700 hover:bg-danger-500/20',
} as const;

export const buttonBase =
  'rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-text-subtle">{hint}</p> : null}
    </div>
  );
}

export function SubmitButton({
  children,
  variant = 'primary',
  ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'danger';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // Disabling while pending is the cheapest defense against a double-submit
  // creating two projects or two revenue rows.
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      {...rest}
      className={`${buttonBase} ${buttonStyles[variant]} ${rest.className ?? ''}`}
    >
      {pending ? 'Saving…' : children}
    </button>
  );
}

export function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger-600/25 bg-danger-500/8 px-3 py-2 text-xs text-danger-700">
      {error}
    </p>
  );
}

export function OkNote({ show, children }: { show?: boolean; children?: ReactNode }) {
  if (!show) return null;
  return (
    <p role="status" className="rounded-lg border border-positive-600/25 bg-positive-500/8 px-3 py-2 text-xs text-positive-700">
      {children ?? 'Saved.'}
    </p>
  );
}

export function Toggle({
  name,
  label,
  hint,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong bg-surface text-brand-500 focus:ring-brand-500"
      />
      <span className="min-w-0">
        <span className="block text-sm text-text">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-text-subtle">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Select({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select name={name} defaultValue={defaultValue} className={inputShell}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputShell} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputShell} font-mono text-xs ${props.className ?? ''}`} />;
}
