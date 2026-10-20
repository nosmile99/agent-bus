import { escapeHtml } from '../utils.js';

/********************************************************************
 * TOAST NOTIFICATIONS
 ********************************************************************/

export function showToast(title, subtitle = '', tone = 'ink') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  const toneClasses = tone === 'red'
    ? 'bg-vermilion text-white border-ink'
    : tone === 'green'
      ? 'bg-forest text-white border-ink'
      : 'bg-charcoal text-paper border-ink';

  el.className = `${toneClasses} border-2 rounded-xl px-3.5 py-2.5 shadow-[0_4px_0_#161615] flex items-center justify-between gap-2 pointer-events-auto transition-all duration-200`;
  el.innerHTML = `
    <div class="min-w-0">
      <div class="font-sans text-sm font-bold truncate">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="font-sans text-xs opacity-90 truncate">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    <i class="ph-bold ph-check-circle text-lg shrink-0 opacity-90"></i>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 200);
  }, 2500);
}
