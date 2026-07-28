import { ActivityIcon } from 'lucide-react';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  onClick?: () => void;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Matches the low-context warning colors native Claude Code / Codex use.
const percentLeftColorClass = (percentLeft: number) => {
  if (percentLeft <= 20) {
    return 'text-red-500 dark:text-red-400';
  }

  if (percentLeft <= 50) {
    return 'text-amber-500 dark:text-amber-400';
  }

  return 'text-foreground';
};

export default function TokenUsageSummary({ usage, onClick }: TokenUsageSummaryProps) {
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const totalTokens = readUsageNumber(usage?.total);
  const percentLeft = totalTokens > 0
    ? Math.max(0, Math.min(100, Math.round(((totalTokens - usedTokens) / totalTokens) * 100)))
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={`${usedTokens.toLocaleString()} / ${totalTokens.toLocaleString()} tokens used${percentLeft !== null ? ` · ${percentLeft}% context left` : ''}`}
      aria-label="Show token usage"
    >
      <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
        <ActivityIcon className="h-3.5 w-3.5" />
      </span>
      <span className="font-medium text-foreground">{formatTokenCount(usedTokens)}</span>
      <span className="hidden text-muted-foreground/70 sm:inline">tokens</span>
      {percentLeft !== null && (
        <span className={`font-semibold ${percentLeftColorClass(percentLeft)}`}>
          {percentLeft}% left
        </span>
      )}
    </button>
  );
}
