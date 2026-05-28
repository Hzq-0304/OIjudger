import { describe, expect, it } from 'vitest';
import {
  parsePlainCheckerOutput,
  validatePlainCheckerProtocol
} from '../src/plainCheckerParser';

describe('parsePlainCheckerOutput', () => {
  it('uses the legacy default protocol: last non-empty line AC', () => {
    expect(parsePlainCheckerOutput('debug\nAC\n')).toMatchObject({
      type: 'AC',
      verdictLine: 'AC'
    });
  });

  it('parses default WA from the last non-empty line', () => {
    expect(parsePlainCheckerOutput('some details\nWA\n')).toMatchObject({
      type: 'WA',
      verdictLine: 'WA'
    });
  });

  it('parses default numeric score from the last non-empty line', () => {
    expect(parsePlainCheckerOutput('matched 7 cases\n37.5\n')).toMatchObject({
      type: 'Score',
      score: 37.5,
      scoreText: '37.5'
    });
  });

  it('treats 0 as a score, not WA', () => {
    expect(parsePlainCheckerOutput('0\n')).toMatchObject({
      type: 'Score',
      score: 0,
      scoreText: '0'
    });
  });

  it('treats 100 as a score, not AC', () => {
    expect(parsePlainCheckerOutput('100\n')).toMatchObject({
      type: 'Score',
      score: 100,
      scoreText: '100'
    });
  });

  it('supports firstLine with custom accepted token', () => {
    expect(parsePlainCheckerOutput('OK\ndetails here\n', {
      verdictPosition: 'firstLine',
      acceptedToken: 'OK',
      wrongAnswerToken: 'NG'
    })).toMatchObject({
      type: 'AC',
      verdictLine: 'OK'
    });
  });

  it('supports firstLine with custom wrong answer token', () => {
    expect(parsePlainCheckerOutput('NG\nwrong answer details\n', {
      verdictPosition: 'firstLine',
      acceptedToken: 'OK',
      wrongAnswerToken: 'NG'
    })).toMatchObject({
      type: 'WA',
      verdictLine: 'NG'
    });
  });

  it('supports firstLine numeric score', () => {
    expect(parsePlainCheckerOutput('70\nmatched 7 cases\n', {
      verdictPosition: 'firstLine',
      acceptedToken: 'OK',
      wrongAnswerToken: 'NG'
    })).toMatchObject({
      type: 'Score',
      score: 70,
      scoreText: '70'
    });
  });

  it('rejects invalid output', () => {
    const result = parsePlainCheckerOutput('Accepted\n');
    expect(result.type).toBe('Invalid');
    expect(result.message).toContain('AC');
    expect(result.message).toContain('WA');
  });

  it('rejects empty output', () => {
    const result = parsePlainCheckerOutput('\n  \n');
    expect(result.type).toBe('Invalid');
    expect(result.message).toContain('Invalid Plain Checker output');
  });

  it.each(['75%', 'score: 75', 'NaN', 'Infinity', '-1'])('rejects invalid numeric output %s', (stdout) => {
    expect(parsePlainCheckerOutput(`${stdout}\n`)).toMatchObject({
      type: 'Invalid',
      verdictLine: stdout
    });
  });
});

describe('validatePlainCheckerProtocol', () => {
  it.each([
    [{ acceptedToken: '', wrongAnswerToken: 'WA' }, 'acceptedTokenEmpty'],
    [{ acceptedToken: 'AC', wrongAnswerToken: '' }, 'wrongAnswerTokenEmpty'],
    [{ acceptedToken: 'AC', wrongAnswerToken: 'AC' }, 'tokensSame'],
    [{ acceptedToken: '100', wrongAnswerToken: 'WA' }, 'acceptedTokenNumeric'],
    [{ acceptedToken: 'AC', wrongAnswerToken: '0' }, 'wrongAnswerTokenNumeric']
  ] as const)('rejects invalid protocol %#', (protocol, issue) => {
    expect(validatePlainCheckerProtocol(protocol)).toEqual({ ok: false, issue });
  });

  it('accepts non-numeric distinct tokens', () => {
    expect(validatePlainCheckerProtocol({ acceptedToken: 'OK', wrongAnswerToken: 'NG' })).toEqual({ ok: true });
  });
});
