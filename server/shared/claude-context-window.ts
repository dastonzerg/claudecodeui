/**
 * Maps a Claude model identifier to its real context-window size in tokens.
 *
 * The token-usage indicators (the live SDK stream in claude-sdk.js and the
 * JSONL-reading REST endpoint in index.js) otherwise fall back to a flat
 * 160k window, which badly understates "% context left" for 1M-context
 * models such as Opus 4.8 / Sonnet with the 1M beta. Returns null when the
 * model can't be identified so callers keep their existing env/default
 * fallback rather than guessing.
 */
const CLAUDE_MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];

/**
 * Returns the model family (`opus`, `sonnet`, …) named in a model string, or
 * null when none is present.
 *
 * Used to check that a globally-configured default model actually refers to
 * the same model a given session ran on before borrowing its 1M flag.
 */
export function getClaudeModelFamily(model: string | null | undefined): string | null {
  const normalized = String(model ?? '').toLowerCase();
  return CLAUDE_MODEL_FAMILIES.find((family) => normalized.includes(family)) ?? null;
}

export function getClaudeContextWindow(model: string | null | undefined): number | null {
  const normalized = String(model ?? '').toLowerCase();
  const isClaudeModel = getClaudeModelFamily(normalized) !== null || normalized.includes('claude');
  if (!isClaudeModel) {
    return null;
  }

  // Fable ships 1M natively — it is the maximum and the default, with no
  // smaller variant to select, so the window does not depend on the beta
  // suffix. That matters because the suffix does not survive: the picker
  // offers `claude-fable-5[1m]`, but transcripts record the bare
  // `claude-fable-5` (and the SDK reports `fable`), which the check below
  // would read as 200k and understate every Fable session by 5x.
  if (getClaudeModelFamily(normalized) === 'fable') {
    return 1_000_000;
  }

  // The 1M context beta is opted into per model (e.g. `opus[1m]`,
  // `claude-opus-4-8[1m]`, `sonnet[1m]`); everything else is 200k.
  if (normalized.includes('1m')) {
    return 1_000_000;
  }

  return 200_000;
}
