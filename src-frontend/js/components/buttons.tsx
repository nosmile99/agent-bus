// Argon Hardware Keycap Buttons and Tab Controls in hono/jsx
import type { Child } from 'hono/jsx';

export interface HwButtonProps {
  variant?: 'primary' | 'secondary' | 'forest' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  className?: string;
  onClick?: string | (() => void);
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  id?: string;
  children: Child;
}

export function HwButton({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
  onClick,
  disabled = false,
  type = 'button',
  id,
  children,
}: HwButtonProps) {
  const baseClasses =
    'hw-btn tap-44 font-mono font-bold inline-flex items-center justify-center gap-1.5 transition-all select-none cursor-pointer';

  const sizeClasses = {
    sm: 'text-[11px] px-2.5 py-1 rounded-lg',
    md: 'text-xs px-3.5 py-2 rounded-xl',
    lg: 'text-sm px-5 py-2.5 rounded-2xl',
  }[size];

  const variantClasses = {
    primary: 'bg-ink text-paper border-2 border-ink active:translate-y-[2px]',
    secondary: 'bg-card text-ink border-2 border-ink active:translate-y-[2px]',
    forest: 'bg-forest text-white border-2 border-forest active:translate-y-[2px]',
    danger: 'bg-vermilion text-white border-2 border-vermilion active:translate-y-[2px]',
    ghost: 'bg-transparent text-ink border border-transparent hover:bg-stone-200/50',
  }[variant];

  const widthClass = fullWidth ? 'w-full' : '';
  const disabledClass = disabled ? 'opacity-50 pointer-events-none' : '';

  return (
    <button
      id={id}
      type={type}
      onclick={typeof onClick === 'string' ? onClick : undefined}
      disabled={disabled}
      class={`${baseClasses} ${sizeClasses} ${variantClasses} ${widthClass} ${disabledClass} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

export interface FilterPillProps {
  label: string;
  active: boolean;
  count?: number;
  onClick?: string | (() => void);
  className?: string;
}

export function FilterPill({ label, active, count, onClick, className = '' }: FilterPillProps) {
  const activeClass = active
    ? 'bg-ink text-paper border-ink shadow-[0_2px_0_#161615]'
    : 'bg-card text-muted hover:text-ink border-border-subtle';

  return (
    <button
      type="button"
      onclick={typeof onClick === 'string' ? onClick : undefined}
      class={`px-3 py-1 rounded-full font-mono text-[11px] font-bold border transition-all flex items-center gap-1.5 whitespace-nowrap ${activeClass} ${className}`.trim()}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          class={`px-1.5 py-0.2 rounded-full text-[9px] ${
            active ? 'bg-paper text-ink' : 'bg-recessed text-muted'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
