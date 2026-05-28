import { describe, expect, it } from 'vitest';
import {
  normalizeCheckerConfig,
  normalizeFileIoConfig,
  normalizeIoMode,
  normalizeJudgeMode
} from '../src/configNormalize';

describe('judgeMode and ioMode compatibility defaults', () => {
  it('defaults old configs without checker to normal judge mode', () => {
    expect(normalizeJudgeMode(undefined, undefined)).toBe('normal');
    expect(normalizeCheckerConfig(undefined)).toEqual({ enabled: false, type: 'none' });
  });

  it('treats old enabled checker configs as checker mode', () => {
    expect(normalizeJudgeMode(undefined, {
      enabled: true,
      type: 'testlib',
      source: 'checker.cpp'
    })).toBe('checker');
  });

  it('keeps explicit normal judge mode even when checker config exists', () => {
    expect(normalizeJudgeMode('normal', {
      enabled: true,
      type: 'plain',
      source: 'checker.cpp'
    })).toBe('normal');
  });

  it('defaults missing ioMode to stdio', () => {
    expect(normalizeIoMode(undefined)).toBe('stdio');
  });

  it('fills default File IO names when fileIo is missing', () => {
    expect(normalizeFileIoConfig(undefined)).toEqual({
      inputFileName: 'input.txt',
      outputFileName: 'output.txt'
    });
  });

  it('fills old Plain Checker protocol defaults', () => {
    expect(normalizeCheckerConfig({
      enabled: true,
      type: 'plain',
      plain: { protocolVersion: 1 }
    }).plain).toEqual({
      protocolVersion: 1,
      verdictPosition: 'lastLine',
      acceptedToken: 'AC',
      wrongAnswerToken: 'WA'
    });
  });
});
