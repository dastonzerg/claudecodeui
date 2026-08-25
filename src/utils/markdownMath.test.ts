import { describe, expect, it } from 'vitest';

import { normalizeLatexDelimiters } from './markdownMath';

describe('normalizeLatexDelimiters', () => {
  it('converts a bracket display block to $$...$$', () => {
    const input = '书中定义：\n\n\\[\n\\begin{bmatrix}X\\\\Y\\\\Z\\end{bmatrix}\n\\]\n';
    expect(normalizeLatexDelimiters(input)).toBe(
      '书中定义：\n\n$$\n\\begin{bmatrix}X\\\\Y\\\\Z\\end{bmatrix}\n$$\n',
    );
  });

  it('converts paren inline math to $$...$$', () => {
    expect(normalizeLatexDelimiters('the term \\(Y = 1R\\) is luminance')).toBe(
      'the term $$Y = 1R$$ is luminance',
    );
  });

  it('leaves delimiters inside a fenced code block alone', () => {
    const input = 'before\n\n```tex\n\\[ x = 1 \\]\n```\n\nafter';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('leaves delimiters inside an inline code span alone', () => {
    const input = 'write `\\(x\\)` to get a paren';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('does not let inline math run across a blank line', () => {
    const input = 'a \\( b\n\nc \\) d';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('leaves text without LaTeX delimiters untouched', () => {
    const input = 'plain text with $$x = 1$$ already normalized';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });
});
