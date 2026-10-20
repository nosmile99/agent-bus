// Toast Notifications in hono/jsx
import { escapeHtml } from '../utils.js';

export interface ToastProps {
  title: string;
  subtitle?: string;
  tone?: 'ink' | 'green' | 'red';
}

export function ToastItem({ title, subtitle = '', tone = 'ink' }: ToastProps) {
  const toneClasses =
    tone === 'red'
      ? 'bg-vermilion text-white border-ink'
      : tone === 'green'
      ? 'bg-forest text-white border-ink'
      : 'bg-charcoal text-paper border-ink';

  return (
    <div
      class={`${toneClasses} border-2 rounded-xl px-3.5 py-2.5 shadow-[0_4px_0_#161615] flex items-center justify-between gap-2 pointer-events-auto transition-all duration-200`}
    >
      <div class="min-w-0">
        <div class="font-sans text-sm font-bold truncate">{escapeHtml(title)}</div>
        {subtitle && <div class="font-sans text-xs opacity-90 truncate">{escapeHtml(subtitle)}</div>}
      </div>
      <i class="ph-bold ph-check-circle text-lg shrink-0 opacity-90"></i>
    </div>
  );
}

export function showToast(title: string, subtitle = '', tone: 'ink' | 'green' | 'red' = 'ink'): void {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.innerHTML = String(<ToastItem title={title} subtitle={subtitle} tone={tone} />);
  const child = el.firstElementChild as HTMLElement | null;
  if (!child) return;

  container.appendChild(child);
  setTimeout(() => {
    child.style.opacity = '0';
    child.style.transform = 'translateY(-6px)';
    setTimeout(() => child.remove(), 200);
  }, 2500);
}
