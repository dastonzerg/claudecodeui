import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

/**
 * Prism themes with legible comments.
 *
 * One Dark ships comments at hsl(220, 10%, 40%) on an hsl(220, 13%, 18%)
 * background — roughly 2.4:1, well under the 4.5:1 needed to read comfortably,
 * and One Light is no better the other way (64% grey on a 98% background).
 * Comments carry the explanation in most snippets, so they are the last thing
 * that should disappear.
 *
 * Both are lifted to about 4.5:1 while staying dimmer than the surrounding
 * code, which in One Dark sits at 71% lightness — comments stay secondary,
 * they just stop vanishing.
 */

type PrismTheme = Record<string, Record<string, string> | undefined>;

// `doctype` is deliberately absent: One Dark already renders it at 71%.
const COMMENT_TOKENS = ['comment', 'prolog', 'cdata'];

function withReadableComments(theme: PrismTheme, color: string): PrismTheme {
  const next: PrismTheme = { ...theme };
  for (const token of COMMENT_TOKENS) {
    const existing = next[token];
    if (existing) {
      next[token] = { ...existing, color };
    }
  }
  return next;
}

export const codeThemeDark = withReadableComments(oneDark as PrismTheme, 'hsl(220, 12%, 60%)');
export const codeThemeLight = withReadableComments(oneLight as PrismTheme, 'hsl(230, 5%, 45%)');
