import { describe, expect, it } from 'vitest';

import { unescapeWithMathProtection } from './chatFormatting';

describe('unescapeWithMathProtection', () => {
  it('preserves LaTeX control words inside a bracket math block', () => {
    const input =
      '\\[\nf_{\\text{linear}}(c)=\n\\begin{cases}\nc/12.92, & c\\le0.04045\n\\end{cases}\n\\tag{5.18}\n\\]';
    expect(unescapeWithMathProtection(input)).toBe(input);
  });

  it('preserves LaTeX control words inside paren inline math', () => {
    const input = 'the angle \\(\\theta\\) and the set \\(\\nabla f\\)';
    expect(unescapeWithMathProtection(input)).toBe(input);
  });

  it('preserves LaTeX control words inside dollar math', () => {
    const input = '$$\n\\text{x}\\tag{1}\n$$';
    expect(unescapeWithMathProtection(input)).toBe(input);
  });

  it('still unescapes literal escape sequences in prose', () => {
    expect(unescapeWithMathProtection('line one\\nline two')).toBe('line one\nline two');
  });

  it('still leaves escape sequences inside code spans alone', () => {
    const input = 'the path `C:\\temp\\new` stays literal';
    expect(unescapeWithMathProtection(input)).toBe(input);
  });
});
