import React from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';

/** Accept finite numbers and decimal numeric strings without coercing missing data to zero. */
export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
const formatNumber = (value: number) => numberFormat.format(value);
const motionQuery = '(prefers-reduced-motion: reduce)';

function subscribeMotion(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function useReducedMotion() {
  return React.useSyncExternalStore(
    subscribeMotion,
    () => typeof window.matchMedia === 'function' && window.matchMedia(motionQuery).matches,
    () => true,
  );
}

function useChangeFlash(identity: string | null, reducedMotion: boolean, duration = 450) {
  const previous = React.useRef(identity);
  const sequence = React.useRef(0);
  const [flash, setFlash] = React.useState<{ identity: string; sequence: number } | null>(null);

  React.useEffect(() => {
    const changed = previous.current !== null && identity !== null && previous.current !== identity;
    previous.current = identity;
    if (!changed || reducedMotion || identity === null) {
      setFlash(null);
      return;
    }
    setFlash({ identity, sequence: ++sequence.current });
    const timer = window.setTimeout(() => setFlash(null), duration);
    return () => window.clearTimeout(timer);
  }, [identity, reducedMotion, duration]);

  return !reducedMotion && flash?.identity === identity ? flash : null;
}

export interface AnimatedNumberProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: unknown;
  format?: (value: number) => string;
  fallback?: React.ReactNode;
  duration?: number;
}

export function AnimatedNumber({
  value, format = formatNumber, fallback = '-', duration = 220, className = '', ...props
}: AnimatedNumberProps) {
  const target = finiteNumber(value);
  const reducedMotion = useReducedMotion();
  const current = React.useRef(target);
  const [displayed, setDisplayed] = React.useState(target);
  const milliseconds = Math.min(600, Math.max(0, finiteNumber(duration) ?? 220));

  React.useEffect(() => {
    const start = current.current;
    if (target === null || start === null || start === target || reducedMotion || milliseconds === 0) {
      current.current = target;
      setDisplayed(target);
      return;
    }
    let frame = 0;
    let started: number | null = null;
    const animate = (now: number) => {
      started ??= now;
      const progress = Math.min(1, (now - started) / milliseconds);
      const eased = 1 - (1 - progress) ** 3;
      // Weighted endpoints avoid overflowing the difference of two finite inputs.
      const next = progress === 1 ? target : start * (1 - eased) + target * eased;
      current.current = next;
      setDisplayed(next);
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [target, reducedMotion, milliseconds]);

  const visible = target === null ? null : reducedMotion || milliseconds === 0 ? target : displayed ?? target;
  return (
    <span {...props} className={`crypto-terminal-number ${className}`.trim()} data-value={target ?? undefined}>
      {visible === null ? fallback : format(visible)}
    </span>
  );
}

export interface TickPriceProps extends AnimatedNumberProps {}

export function TickPrice({ value, className = '', ...props }: TickPriceProps) {
  const number = finiteNumber(value);
  const reducedMotion = useReducedMotion();
  const previous = React.useRef(number);
  const [direction, setDirection] = React.useState<'up' | 'down' | null>(null);
  const flash = useChangeFlash(number === null ? null : String(number), reducedMotion);

  React.useEffect(() => {
    const before = previous.current;
    setDirection(before !== null && number !== null && before !== number ? number > before ? 'up' : 'down' : null);
    previous.current = number;
  }, [number]);

  return (
    <span className={`crypto-terminal-tick-price ${flash && direction ? `crypto-terminal-tick-price--${direction}` : ''} ${className}`.trim()} data-direction={flash ? direction : undefined}>
      {flash && direction && <span key={flash.sequence} aria-hidden="true" className={`crypto-terminal-tick-flash crypto-terminal-tick-flash--${direction}`} />}
      <AnimatedNumber {...props} value={value} />
    </span>
  );
}

export interface DepthLevel {
  price: unknown;
  amount: unknown;
}

export interface DepthRowsProps {
  rows: readonly DepthLevel[];
  side: 'asks' | 'bids';
  limit?: number;
  /** Change with the market to reset row comparison history. */
  marketKey?: string;
  formatPrice?: (value: number) => string;
  formatAmount?: (value: number) => string;
  emptyLabel?: string;
  className?: string;
}

interface NormalizedDepthLevel {
  price: number;
  amount: number;
  cumulative: number | null;
  depth: number;
}

function DepthRow({ row, side, formatPrice, formatAmount }: {
  key?: React.Key;
  row: NormalizedDepthLevel;
  side: DepthRowsProps['side'];
  formatPrice: (value: number) => string;
  formatAmount: (value: number) => string;
}) {
  const reducedMotion = useReducedMotion();
  // A stable price identifies a level; depth movement alone is not a trade/update at this level.
  const flash = useChangeFlash(String(row.amount), reducedMotion);
  const style = { '--crypto-terminal-depth': `${row.depth}%` } as React.CSSProperties;
  return (
    <div role="row" className={`crypto-terminal-depth-row crypto-terminal-depth-row--${side}${flash ? ' crypto-terminal-depth-row--changed' : ''}`} style={style}>
      <span aria-hidden="true" className="crypto-terminal-depth-fill" />
      {flash && <span key={flash.sequence} aria-hidden="true" className="crypto-terminal-depth-flash" />}
      <span role="cell" className="crypto-terminal-depth-price">{formatPrice(row.price)}</span>
      <span role="cell" className="crypto-terminal-depth-amount">{formatAmount(row.amount)}</span>
      <span role="cell" className="crypto-terminal-depth-total">{row.cumulative === null ? '-' : formatAmount(row.cumulative)}</span>
    </div>
  );
}

/** Best prices are selected first; asks display descending so the best ask sits by the spread. */
export function DepthRows({
  rows, side, limit = 7, marketKey = '', formatPrice = formatNumber, formatAmount = formatNumber,
  emptyLabel = 'No order book data', className = '',
}: DepthRowsProps) {
  const count = Math.max(0, Math.floor(finiteNumber(limit) ?? 7));
  const levels = new Map<number, number>();
  for (const row of rows) {
    const price = finiteNumber(row.price);
    const amount = finiteNumber(row.amount);
    if (price !== null && price > 0 && amount !== null && amount > 0) levels.set(price, amount);
  }
  const selected = [...levels].sort(([a], [b]) => side === 'asks' ? a - b : b - a).slice(0, count);
  // Scale before summing so depth percentages remain finite even for very large volumes.
  const scale = selected.reduce((max, [, amount]) => Math.max(max, amount), 0);
  const total = selected.reduce((sum, [, amount]) => sum + amount / scale, 0);
  let cumulative = 0;
  let scaledCumulative = 0;
  const normalized: NormalizedDepthLevel[] = selected.map(([price, amount]) => {
    cumulative += amount;
    scaledCumulative += amount / scale;
    return { price, amount, cumulative: finiteNumber(cumulative), depth: Math.min(100, scaledCumulative / total * 100) };
  });
  if (side === 'asks') normalized.reverse();

  return (
    <div role="rowgroup" aria-label={side === 'asks' ? 'Asks' : 'Bids'} className={`crypto-terminal-depth-rows crypto-terminal-depth-rows--${side} ${className}`.trim()}>
      {normalized.length ? normalized.map((row) => (
        <DepthRow key={JSON.stringify([marketKey, side, row.price])} row={row} side={side} formatPrice={formatPrice} formatAmount={formatAmount} />
      )) : <div role="row"><div role="cell" aria-colspan={3}><EmptyState title={emptyLabel} /></div></div>}
    </div>
  );
}

export type TerminalDecision = 'BUY' | 'SELL' | 'HOLD';

export interface DecisionBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  decision: TerminalDecision | null | undefined;
  decisionId?: string | number | null;
  timestamp?: string | number | null;
  fallback?: string;
}

function decisionIdentityPart(value: string | number | null | undefined): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return typeof value === 'string' && value.trim() ? value : null;
}

export function DecisionBadge({ decision, decisionId, timestamp, fallback = '-', className = '', ...props }: DecisionBadgeProps) {
  const valid = decision === 'BUY' || decision === 'SELL' || decision === 'HOLD';
  const id = decisionIdentityPart(decisionId);
  const time = decisionIdentityPart(timestamp);
  const identity = valid && (id !== null || time !== null) ? JSON.stringify([id, time]) : null;
  const reducedMotion = useReducedMotion();
  const flash = useChangeFlash(identity, reducedMotion, 500);

  return (
    <span {...props} className={`crypto-terminal-decision-badge crypto-terminal-decision-badge--blue${flash ? ' crypto-terminal-decision-badge--pulse' : ''} ${className}`.trim()} data-decision={valid ? decision : undefined}>
      {flash && <span key={flash.sequence} aria-hidden="true" className="crypto-terminal-decision-pulse" />}
      <span className="crypto-terminal-decision-label">{valid ? decision : fallback}</span>
    </span>
  );
}

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, icon: Icon = Inbox, action, className = '', ...props }: EmptyStateProps) {
  return (
    <div {...props} className={`crypto-terminal-empty-state ${className}`.trim()}>
      <Icon className="crypto-terminal-empty-icon" size={20} aria-hidden="true" />
      <div className="crypto-terminal-empty-title">{title}</div>
      {description != null && <div className="crypto-terminal-empty-description">{description}</div>}
      {action != null && <div className="crypto-terminal-empty-action">{action}</div>}
    </div>
  );
}
