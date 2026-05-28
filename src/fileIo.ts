import * as path from 'path';

export type FileIoRuntimePaths = {
  runDirRel: string;
  inputRel: string;
  outputRel: string;
};

export function isValidFileIoName(value: string): boolean {
  return validateFileIoName(value).ok;
}

export function validateFileIoName(value: string): { ok: boolean; message?: string } {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    path.isAbsolute(trimmed) ||
    /[\\/]/u.test(trimmed) ||
    trimmed.includes('..') ||
    !/^[A-Za-z0-9_.-]+$/u.test(trimmed)
  ) {
    return { ok: false, message: 'Invalid file name.' };
  }
  return { ok: true };
}

export function getFileIoRuntimePaths(
  problemId: string,
  sampleIndex: number,
  inputFileName: string,
  outputFileName: string
): FileIoRuntimePaths {
  const runDirRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `sample-${sampleIndex}`, 'run'));
  return {
    runDirRel,
    inputRel: toPosixPath(path.join(runDirRel, inputFileName)),
    outputRel: toPosixPath(path.join(runDirRel, outputFileName))
  };
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
