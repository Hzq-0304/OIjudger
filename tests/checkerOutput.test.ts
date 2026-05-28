import { describe, expect, it } from 'vitest';
import { mergeCheckerOutput } from '../src/checkerOutput';

describe('mergeCheckerOutput', () => {
  it('keeps stdout only output simple', () => {
    expect(mergeCheckerOutput('ok\n', '')).toBe('ok\n');
  });

  it('keeps stderr only output visible', () => {
    expect(mergeCheckerOutput('', 'wrong answer\n')).toBe('wrong answer\n');
  });

  it('labels stdout and stderr when both are present', () => {
    const merged = mergeCheckerOutput('debug\n', 'wrong answer\n');
    expect(merged).toContain('[stdout]\ndebug');
    expect(merged).toContain('[stderr]\nwrong answer');
  });

  it('returns an empty string when both streams are empty', () => {
    expect(mergeCheckerOutput('', '')).toBe('');
  });
});
