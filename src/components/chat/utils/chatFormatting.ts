export function decodeHtmlEntities(text: string) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeInlineCodeFences(text: string) {
  if (!text || typeof text !== 'string') return text;
  try {
    return text.replace(/```[ \t]*([^\n\r]+?)[ \t]*```/g, '`$1`');
  } catch {
    return text;
  }
}

export function unescapeWithMathProtection(text: string) {
  if (!text || typeof text !== 'string') return text;

  const codeBlocks: string[] = [];
  const inlineCodeSpans: string[] = [];
  const mathBlocks: string[] = [];
  const codeBlockPrefix = '__CODE_BLOCK_';
  const inlineCodePrefix = '__INLINE_CODE_';
  const mathBlockPrefix = '__MATH_BLOCK_';
  const placeholderSuffix = '__';

  // Fenced/inline code often contains literal \n, \t, \r sequences (Windows
  // paths, escape-sequence examples, regex literals) that are the actual
  // content, not double-escaped prose - protect them first, same technique
  // already used below for LaTeX math.
  let processedText = text.replace(/```[\s\S]*?```/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `${codeBlockPrefix}${index}${placeholderSuffix}`;
  });

  processedText = processedText.replace(/`[^`\n]+?`/g, (match) => {
    const index = inlineCodeSpans.length;
    inlineCodeSpans.push(match);
    return `${inlineCodePrefix}${index}${placeholderSuffix}`;
  });

  processedText = processedText.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match) => {
    const index = mathBlocks.length;
    mathBlocks.push(match);
    return `${mathBlockPrefix}${index}${placeholderSuffix}`;
  });

  processedText = processedText.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

  processedText = processedText.replace(
    new RegExp(`${mathBlockPrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (match, index) => mathBlocks[parseInt(index, 10)],
  );

  processedText = processedText.replace(
    new RegExp(`${inlineCodePrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (match, index) => inlineCodeSpans[parseInt(index, 10)],
  );

  processedText = processedText.replace(
    new RegExp(`${codeBlockPrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (match, index) => codeBlocks[parseInt(index, 10)],
  );

  return processedText;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatUsageLimitText(text: string) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (match, ts) => {
      let timestampMs = parseInt(ts, 10);
      if (!Number.isFinite(timestampMs)) return match;
      if (timestampMs < 1e12) timestampMs *= 1000;
      const reset = new Date(timestampMs);

      const timeStr = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(reset);

      const offsetMinutesLocal = -reset.getTimezoneOffset();
      const sign = offsetMinutesLocal >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutesLocal);
      const offH = Math.floor(abs / 60);
      const offM = abs % 60;
      const gmt = `GMT${sign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const cityRaw = tzId.split('/').pop() || '';
      const city = cityRaw
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
      const tzHuman = city ? `${gmt} (${city})` : gmt;

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateReadable = `${reset.getDate()} ${months[reset.getMonth()]} ${reset.getFullYear()}`;

      return `Claude usage limit reached. Your limit will reset at **${timeStr} ${tzHuman}** - ${dateReadable}`;
    });
  } catch {
    return text;
  }
}
