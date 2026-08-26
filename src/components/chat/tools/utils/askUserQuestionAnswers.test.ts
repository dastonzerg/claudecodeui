import { describe, expect, it } from 'vitest';

import { parseAnswersFromResult } from './askUserQuestionAnswers';

const result = (body: string) =>
  `Your questions have been answered: ${body} You can now continue with these answers in mind.`;

describe('parseAnswersFromResult', () => {
  it('reads the answer for a single question', () => {
    const questions = [{ question: 'Which fix?' }];
    expect(parseAnswersFromResult(result('"Which fix?"="Stabilize identity (Recommended)".'), questions))
      .toEqual({ 'Which fix?': 'Stabilize identity (Recommended)' });
  });

  it('reads every answer when several questions were asked', () => {
    const questions = [
      { question: 'How should the three items be removed from the sidebar footer?' },
      { question: "The 'restart required' banner is separate. Include it?" },
    ];
    const content = result(
      '"How should the three items be removed from the sidebar footer?"="Collapsible section (Recommended)", '
      + '"The \'restart required\' banner is separate. Include it?"="Keep it visible (Recommended)".',
    );
    expect(parseAnswersFromResult(content, questions)).toEqual({
      'How should the three items be removed from the sidebar footer?': 'Collapsible section (Recommended)',
      "The 'restart required' banner is separate. Include it?": 'Keep it visible (Recommended)',
    });
  });

  it('keeps a comma-joined multi-select answer intact', () => {
    const questions = [{ question: 'Which features?' }];
    expect(parseAnswersFromResult(result('"Which features?"="Alpha, Beta, Gamma".'), questions))
      .toEqual({ 'Which features?': 'Alpha, Beta, Gamma' });
  });

  it('treats question text literally rather than as a pattern', () => {
    const questions = [{ question: 'Use .* (regex) for matching?' }];
    expect(parseAnswersFromResult(result('"Use .* (regex) for matching?"="Yes".'), questions))
      .toEqual({ 'Use .* (regex) for matching?': 'Yes' });
  });

  it('omits questions the result does not mention', () => {
    const questions = [{ question: 'Answered?' }, { question: 'Skipped?' }];
    expect(parseAnswersFromResult(result('"Answered?"="Yes".'), questions))
      .toEqual({ 'Answered?': 'Yes' });
  });

  it('returns nothing for a missing, non-string, or unrelated result', () => {
    const questions = [{ question: 'Which fix?' }];
    expect(parseAnswersFromResult(undefined, questions)).toEqual({});
    expect(parseAnswersFromResult({ nested: true }, questions)).toEqual({});
    expect(parseAnswersFromResult('The user rejected the tool call.', questions)).toEqual({});
  });

  it('returns nothing when the questions list is malformed', () => {
    expect(parseAnswersFromResult(result('"Which fix?"="Yes".'), undefined)).toEqual({});
    expect(parseAnswersFromResult(result('"Which fix?"="Yes".'), [{ header: 'no question' }] as never))
      .toEqual({});
  });

  it('reads text out of a block-array result', () => {
    const questions = [{ question: 'Which fix?' }];
    const content = [{ type: 'text', text: result('"Which fix?"="Yes".') }];
    expect(parseAnswersFromResult(content, questions)).toEqual({ 'Which fix?': 'Yes' });
  });
});
