'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

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
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink-300">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{hint}</p> : null}
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

  const styles = {
    primary: 'bg-pulse-500 text-ink-950 hover:bg-pulse-400',
    ghost: 'border border-ink-800 bg-ink-850 text-ink-200 hover:bg-ink-800',
    danger: 'border border-danger-500/40 bg-danger-500/10 text-danger-400 hover:bg-danger-500/20',
  };

  return (
    <button
      type="submit"
      disabled={pending}
      {...rest}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${rest.className ?? ''}`}
    >
      {pending ? 'Saving…' : children}
    </button>
  );
}

export function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/5 px-3 py-2 text-xs text-danger-400">
      {error}
    </p>
  );
}

export function OkNote({ show, children }: { show?: boolean; children?: ReactNode }) {
  if (!show) return null;
  return (
    <p role="status" className="rounded-lg border border-pulse-600/30 bg-pulse-600/5 px-3 py-2 text-xs text-pulse-400">
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
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-700 bg-ink-900 text-pulse-500 focus:ring-pulse-500"
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink-200">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-600">{hint}</span> : null}
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
    <select
      name={name}
      defaultValue={defaultValue}
      className="w-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-pulse-600 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-700 focus:border-pulse-600 focus:outline-none ${props.className ?? ''}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 font-mono text-xs text-ink-100 placeholder:text-ink-700 focus:border-pulse-600 focus:outline-none ${props.className ?? ''}`}
    />
  );
}
