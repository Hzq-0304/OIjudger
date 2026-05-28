import type { RuntimeErrorSummary } from './runtimeErrorExplainer';

export type SampleSourceType = 'managed' | 'external';
export type CheckerType = 'none' | 'testlib' | 'plain';
export type JudgeMode = 'normal' | 'checker';
export type IoMode = 'stdio' | 'fileio';
export type TestlibMode = 'auto' | 'managed' | 'custom';
export type PlainCheckerVerdictPosition = 'firstLine' | 'lastLine';

export type ProblemStatementType = 'markdown' | 'pdf' | 'text' | 'unknown';

export type ProblemStatement = {
  path: string;
  type: ProblemStatementType;
  sourceType?: SampleSourceType;
};

export type ProblemSource = {
  path: string;
  name?: string;
  lastUsedAt?: string;
};

export type SampleConfig = {
  id: string;
  index: number;
  name: string;
  input: string;
  answer: string;
  actualOutput?: string;
  expectedOutput?: string;
  sourceType?: SampleSourceType;
};

export type CheckerConfig = {
  enabled: boolean;
  type: CheckerType;
  source?: string;
  exe?: string;
  timeLimitMs?: number;
  testlib?: {
    mode: TestlibMode;
    path?: string | null;
  };
  plain?: PlainCheckerConfig;
};

export type PlainCheckerConfig = {
  protocolVersion?: 1;
  verdictPosition?: PlainCheckerVerdictPosition;
  acceptedToken?: string;
  wrongAnswerToken?: string;
};

export type FileIoConfig = {
  inputFileName: string;
  outputFileName: string;
};

export interface SetterConfig {
  stdProgram?: string;
  dataCases?: SetterDataCaseConfig[];
  generator?: SetterGeneratorConfig;
}

export interface SetterDataCaseConfig {
  id: string;
  name: string;
  sampleId?: string;
  sampleIndex?: number;
  role?: 'sample' | 'test';
  generator?: {
    enabled?: boolean;
    generatorId?: string;
    args?: string[];
    seed?: string;
  };
}

export interface SetterGeneratorConfig {
  enabled?: boolean;
  generators?: SetterGeneratorItem[];
}

export interface SetterGeneratorItem {
  id: string;
  name: string;
  source?: string;
  command?: string;
  args?: string[];
}

export type OITestConfig = {
  version: 1;
  compile?: {
    command: string;
    args: string[];
  };
  compiler: {
    command: string;
    args: string[];
  };
  limits: {
    timeMs: number;
    memoryMb: number;
  };
  stack?: StackConfig;
  judgeMode?: JudgeMode;
  ioMode?: IoMode;
  fileIo?: FileIoConfig;
  checker?: CheckerConfig;
  setter?: SetterConfig;
  samples: SampleConfig[];
};

export type StackConfig = {
  auto: boolean;
  sizeMb?: number | null;
};

export type ProblemConfig = OITestConfig & {
  id: string;
  name: string;
  source?: string;
  defaultSource?: string;
  statement?: ProblemStatement;
  sources?: ProblemSource[];
  standard: string;
};

export type ProblemsConfig = {
  version: 1;
  problems: ProblemConfig[];
};

export type ProcessResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  killedByTimeout: boolean;
  stdinError?: string;
  stdoutError?: string;
  stderrError?: string;
  timeMs: number;
  elapsedMs: number;
};

export type CompileReport = {
  status: 'OK';
  timeMs: number;
  stack?: CompileStackReport;
};

export type CompileResult = CompileReport & {
  executablePath: string;
};

export type CompileStackReport = {
  enabled: boolean;
  sizeMb?: number;
  sizeBytes?: number;
  flag?: string;
  compilerFamily?: string;
  unsupported?: boolean;
};

export type SampleStatus = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'ERR' | 'Checker Error' | 'Scored' | 'Skipped' | 'Missing' | 'Output Missing';

export type CheckerSampleReport = {
  enabled: boolean;
  type: CheckerType;
  source?: string;
  exe?: string;
  testlibPath?: string;
  exitCode?: number | null;
  exitCodeHex?: string;
  signal?: NodeJS.Signals | null;
  timeMs?: number;
  output?: string;
  stdout?: string;
  stderr?: string;
  finalLine?: string;
  verdictLine?: string;
  verdictPosition?: PlainCheckerVerdictPosition;
  acceptedToken?: string;
  wrongAnswerToken?: string;
  verdict?: 'AC' | 'WA' | 'Score' | 'Invalid' | 'CheckerError';
  errorKind?: RuntimeErrorSummary['kind'] | 'CheckerError';
  errorName?: string;
  score?: number;
  scoreText?: string;
  message?: string;
};

export type SampleReport = {
  id: string;
  index: number;
  name: string;
  status: SampleStatus;
  timeMs: number;
  compareTimeMs?: number;
  elapsedMs: number;
  input: string;
  answer: string;
  actualOutput: string;
  output?: string;
  stderr?: string;
  runResult?: string;
  diff?: string;
  sampleSourceType?: SampleSourceType;
  ioMode?: IoMode;
  fileIo?: FileIoConfig & {
    runDir?: string;
    inputPath?: string;
    outputPath?: string;
    outputCreated?: boolean;
  };
  source?: string;
  exe?: string;
  sourcePath?: string;
  exePath?: string;
  cwd?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  killedByTimeout?: boolean;
  stdinError?: string;
  stdoutError?: string;
  stderrError?: string;
  stderrPreview?: string;
  spawnError?: string;
  runnerError?: string;
  compareError?: string;
  runtimeError?: RuntimeErrorSummary;
  score?: number;
  checker?: CheckerSampleReport;
  message?: string;
};

export type JudgeReport = {
  version: 1;
  generatedAt: string;
  source: string;
  sourceName?: string;
  compile?: CompileReport;
  totalTimeMs?: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  judgeMode?: JudgeMode | 'testlib' | 'plain';
  checkerType?: Exclude<CheckerType, 'none'>;
  ioMode?: IoMode;
  fileIo?: FileIoConfig;
  checker?: CheckerConfig;
  summary: {
    accepted: number;
    total: number;
    wrongAnswer?: number;
    scored?: number;
    checkerError?: number;
  };
  score?: {
    earned: number;
    total: number;
  };
  results?: SampleReport[];
  samples: SampleReport[];
};
