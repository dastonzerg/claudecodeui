/**
 * Rewrites LaTeX's `\[...\]` / `\(...\)` math delimiters to the `$$...$$` form
 * remark-math understands.
 *
 * Models routinely emit the LaTeX delimiters, but remark-math only recognises
 * dollar delimiters. Worse, markdown treats `\[` as an escaped bracket, so the
 * block is not merely left unrendered — the parser eats the backslashes and
 * `\begin{bmatrix}X\\Y\end{bmatrix}` reaches the page as
 * `begin{bmatrix}X\Yend{bmatrix}`.
 *
 * This has to run before parsing, since by mdast time the escapes are gone.
 * Fenced and inline code are stashed behind placeholders first so a `\[` that
 * is genuinely code stays literal. `\(...\)` may not cross a blank line, which
 * keeps a stray escaped parenthesis in prose from swallowing whole paragraphs.
 */
export function normalizeLatexDelimiters(text: string) {
  if (!text || typeof text !== 'string') return text;

  const codeSegments: string[] = [];
  const codePrefix = '__LATEX_SAFE_CODE_';
  const placeholderSuffix = '__';
  const stash = (match: string) => {
    const index = codeSegments.length;
    codeSegments.push(match);
    return `${codePrefix}${index}${placeholderSuffix}`;
  };

  let processedText = text.replace(/```[\s\S]*?```/g, stash).replace(/`[^`\n]+?`/g, stash);

  processedText = processedText
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `$$${body}$$`)
    .replace(/\\\(((?:[^\n]|\n(?!\s*\n))*?)\\\)/g, (_match, body: string) => `$$${body}$$`);

  return processedText.replace(
    new RegExp(`${codePrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (_match, index: string) => codeSegments[parseInt(index, 10)],
  );
}
