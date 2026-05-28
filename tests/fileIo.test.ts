import { describe, expect, it } from 'vitest';
import { getFileIoRuntimePaths, isValidFileIoName } from '../src/fileIo';

describe('File IO file name validation', () => {
  it.each([
    'problem.in',
    'problem.out',
    'input.txt',
    'output.txt',
    'a_b-1.in',
    'case.001.out',
    'A.in',
    '123.out'
  ])('accepts %s', (name) => {
    expect(isValidFileIoName(name)).toBe(true);
  });

  it.each([
    '',
    '.',
    '..',
    '../a.in',
    '..\\a.in',
    'data/a.in',
    'data\\a.in',
    'C:\\data\\a.in',
    '/tmp/a.in',
    'a?.in',
    'a*.in',
    'a:b.in',
    'a|b.in',
    'a"b.in',
    '<a>.in'
  ])('rejects %s', (name) => {
    expect(isValidFileIoName(name)).toBe(false);
  });
});

describe('File IO runtime paths', () => {
  it('generates per-sample run directory and input/output paths', () => {
    const paths = getFileIoRuntimePaths('A', 7, 'problem.in', 'problem.out');
    expect(paths.runDirRel).toBe('.oitest/problems/A/outputs/sample-7/run');
    expect(paths.inputRel).toBe('.oitest/problems/A/outputs/sample-7/run/problem.in');
    expect(paths.outputRel).toBe('.oitest/problems/A/outputs/sample-7/run/problem.out');
  });
});
