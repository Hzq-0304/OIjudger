import { describe, expect, it } from 'vitest';
import { explainRuntimeError } from '../src/runtimeErrorExplainer';

describe('explainRuntimeError', () => {
  it('explains missing runtime DLL', () => {
    const explanation = explainRuntimeError({ exitCode: 3221225781 });
    expect(explanation).toMatchObject({
      kind: 'missingRuntimeDll',
      englishName: 'Missing runtime DLL',
      rawCode: '0xC0000135'
    });
  });

  it('explains stack overflow', () => {
    expect(explainRuntimeError({ exitCode: 3221225725 })).toMatchObject({
      kind: 'stackOverflow',
      englishName: 'Stack overflow'
    });
  });

  it('explains access violation', () => {
    expect(explainRuntimeError({ exitCode: 3221225477 })).toMatchObject({
      kind: 'accessViolation',
      englishName: 'Access violation'
    });
  });

  it('explains integer divide by zero', () => {
    expect(explainRuntimeError({ exitCode: 3221225620 })).toMatchObject({
      kind: 'integerDivideByZero',
      englishName: 'Integer divide by zero'
    });
  });

  it('explains SIGSEGV', () => {
    expect(explainRuntimeError({ signal: 'SIGSEGV' })).toMatchObject({
      kind: 'segmentationFault',
      englishName: 'Segmentation fault'
    });
  });

  it('returns undefined when there is no runtime error data', () => {
    expect(explainRuntimeError({})).toBeUndefined();
  });

  it('explains unknown non-zero exit code', () => {
    expect(explainRuntimeError({ exitCode: 12345 })).toMatchObject({
      kind: 'unknown',
      englishName: 'Unknown runtime error',
      rawExitCode: 12345
    });
  });
});
