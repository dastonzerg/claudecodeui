/**
 * Recovers AskUserQuestion answers from the tool result.
 *
 * While the question is live, the answers are written back onto the tool input
 * and the panel renders the selection from there. The persisted transcript
 * keeps the tool call as it was issued, so replaying a session yields an input
 * with `questions` and no `answers` — every option then renders unselected and
 * the header reads "Question" instead of "Question — answered".
 *
 * The answers are not lost, only stored elsewhere: the tool result spells them
 * out as `"<question>"="<answer>"` pairs. Reading them back is what lets an
 * answered question still look answered after a reload.
 *
 * Matching is anchored on each known question rather than parsing the sentence
 * generically, so punctuation inside a question cannot desynchronise the pairs.
 */

type QuestionLike = { question?: unknown };

/** Terminators of a value: the next pair, or the end of the sentence. */
const VALUE_TERMINATORS = ['", "', '". '];

function readResultText(resultContent: unknown): string | null {
  if (typeof resultContent === 'string') {
    return resultContent;
  }

  // Provider transcripts sometimes carry the result as content blocks.
  if (Array.isArray(resultContent)) {
    const text = resultContent
      .map((block) =>
        block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : '',
      )
      .join('');
    return text || null;
  }

  return null;
}

export function parseAnswersFromResult(
  resultContent: unknown,
  questions: QuestionLike[] | undefined,
): Record<string, string> {
  const text = readResultText(resultContent);
  if (!text || !Array.isArray(questions)) {
    return {};
  }

  const answers: Record<string, string> = {};

  for (const entry of questions) {
    const question = entry?.question;
    if (typeof question !== 'string' || !question) {
      continue;
    }

    const marker = `"${question}"="`;
    const markerIndex = text.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }

    const valueStart = markerIndex + marker.length;
    let valueEnd = -1;
    for (const terminator of VALUE_TERMINATORS) {
      const index = text.indexOf(terminator, valueStart);
      if (index !== -1 && (valueEnd === -1 || index < valueEnd)) {
        valueEnd = index;
      }
    }

    // A result truncated before its terminator still names the answer; take the
    // rest of the line rather than dropping it.
    const value = valueEnd === -1
      ? text.slice(valueStart).replace(/"[.\s]*$/, '')
      : text.slice(valueStart, valueEnd);

    if (value) {
      answers[question] = value;
    }
  }

  return answers;
}
