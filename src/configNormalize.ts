import { CheckerConfig, FileIoConfig, IoMode, JudgeMode, StackConfig } from './types';

export function normalizeStackConfig(stack: StackConfig | undefined): StackConfig {
  return {
    auto: stack?.auto ?? true,
    sizeMb: stack?.sizeMb ?? null
  };
}

export function normalizeCheckerConfig(checker: CheckerConfig | undefined): CheckerConfig {
  if (!checker?.enabled || checker.type === 'none') {
    return { enabled: false, type: 'none' };
  }

  return {
    enabled: true,
    type: checker.type,
    source: checker.source,
    exe: checker.exe,
    timeLimitMs: checker.timeLimitMs ?? 5000,
    testlib: {
      mode: checker.testlib?.mode ?? 'auto',
      path: checker.testlib?.path ?? null
    },
    plain: {
      protocolVersion: checker.plain?.protocolVersion ?? 1,
      verdictPosition: checker.plain?.verdictPosition === 'firstLine' ? 'firstLine' : 'lastLine',
      acceptedToken: checker.plain?.acceptedToken || 'AC',
      wrongAnswerToken: checker.plain?.wrongAnswerToken || 'WA'
    }
  };
}

export function normalizeJudgeMode(
  judgeMode: JudgeMode | undefined,
  checker: CheckerConfig | undefined
): JudgeMode {
  if (judgeMode === 'normal' || judgeMode === 'checker') {
    return judgeMode;
  }
  return checker?.enabled && checker.type !== 'none' ? 'checker' : 'normal';
}

export function normalizeIoMode(ioMode: IoMode | undefined): IoMode {
  return ioMode === 'fileio' ? 'fileio' : 'stdio';
}

export function normalizeFileIoConfig(fileIo: FileIoConfig | undefined): FileIoConfig {
  return {
    inputFileName: fileIo?.inputFileName || 'input.txt',
    outputFileName: fileIo?.outputFileName || 'output.txt'
  };
}
