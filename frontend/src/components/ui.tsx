import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/format';

export function Button({ className, variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={cx(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('input', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx('input', props.className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('card p-5', className)}>{children}</div>;
}

export function Badge({ tone = 'gray', children }: { tone?: 'green' | 'amber' | 'red' | 'blue' | 'gray'; children: ReactNode }) {
  return <span className={cx('badge', tone === 'green' && 'badge-green', tone === 'amber' && 'badge-amber', tone === 'red' && 'badge-red', tone === 'blue' && 'badge-blue', tone === 'gray' && 'badge-gray')}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: 'hsl(var(--border))' }}>
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm opacity-60">{hint}</p>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider opacity-70">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs opacity-55">{hint}</span>}
    </label>
  );
}
