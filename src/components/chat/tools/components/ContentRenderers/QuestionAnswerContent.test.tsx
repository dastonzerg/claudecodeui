import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { QuestionAnswerContent } from './QuestionAnswerContent';

// Regression coverage for the chat-interface crash where an AskUserQuestion
// payload loaded from a session transcript arrives with a non-array `questions`
// or a question missing its `options` array. Rendering must degrade gracefully
// instead of throwing "TypeError: e.map is not a function".

describe('QuestionAnswerContent', () => {
  it('renders without throwing when questions is a non-array value', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          // Malformed: object instead of an array
          questions: { 0: { question: 'q?', options: [{ label: 'a' }] } } as never,
          answers: {},
        }),
      ),
    ).not.toThrow();
  });

  it('renders without throwing when a question is missing options[]', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          questions: [{ question: 'Pick one?', header: 'H' } as never],
          answers: { 'Pick one?': 'X' },
        }),
      ),
    ).not.toThrow();
  });

  it('renders without throwing when options[] contains malformed entries', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          questions: [{ question: 'Pick one?', options: [null, 'oops', { label: 'A' }] } as never],
          answers: { 'Pick one?': 'A, Custom' },
        }),
      ),
    ).not.toThrow();
  });

  it('renders without throwing when a questions entry is null/non-object', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          questions: [null, 'oops', { question: 'Ok?', options: [{ label: 'A' }] }] as never,
          answers: {},
        }),
      ),
    ).not.toThrow();
  });

  it('renders without throwing when an answer is a non-string value', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          questions: [{ question: 'Pick one?', options: [{ label: 'A' }] }],
          // Malformed: answer is an object instead of the expected string
          answers: { 'Pick one?': { unexpected: true } } as never,
        }),
      ),
    ).not.toThrow();
  });

  it('still renders a well-formed question + answer', () => {
    const html = renderToStaticMarkup(
      React.createElement(QuestionAnswerContent, {
        questions: [{ question: 'Pick one?', header: 'H', options: [{ label: 'A' }, { label: 'B' }] }],
        answers: { 'Pick one?': 'A' },
      }),
    );
    expect(html).toContain('Pick one?');
  });
});
