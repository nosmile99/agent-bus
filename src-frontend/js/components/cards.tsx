// Argon Tactile Cards, Inset Wells, and Agent Badges in hono/jsx
import type { Child } from 'hono/jsx';
import { getAgentStyle } from '../utils.js';

export interface HwCardProps {
  elevated?: boolean;
  className?: string;
  id?: string;
  onClick?: string | (() => void);
  children: Child;
}

export function HwCard({ elevated = true, className = '', id, onClick, children }: HwCardProps) {
  const shadowClass = elevated ? 'shadow-[0_2px_0_#161615]' : '';
  return (
    <div
      id={id}
      onclick={typeof onClick === 'string' ? onClick : undefined}
      class={`bg-card border-2 border-ink rounded-2xl ${shadowClass} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export interface WellBoxProps {
  className?: string;
  id?: string;
  children: Child;
}

export function WellBox({ className = '', id, children }: WellBoxProps) {
  return (
    <div
      id={id}
      class={`bg-recessed border border-border-subtle rounded-xl p-3 ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export interface CautionStripeProps {
  type: 'blocked' | 'stale';
  className?: string;
}

export function CautionStripe({ type, className = '' }: CautionStripeProps) {
  const stripeClass = type === 'blocked' ? 'caution-stripe-red' : 'caution-stripe-amber';
  return (
    <div class={`h-2.5 w-full rounded-t-xl ${stripeClass} border-b border-ink/10 ${className}`.trim()} />
  );
}

export interface AgentBadgeProps {
  agent: string;
  showDot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function AgentBadge({ agent, showDot = true, size = 'sm', className = '' }: AgentBadgeProps) {
  const style = getAgentStyle(agent);
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';

  return (
    <span
      class={`inline-flex items-center gap-1.5 rounded-full font-mono font-bold border ${style.bg} ${style.text} ${style.border} ${sizeClass} ${className}`.trim()}
    >
      {showDot && <span class={`w-1.5 h-1.5 rounded-full ${style.dot}`} />}
      <span>@{agent}</span>
    </span>
  );
}
