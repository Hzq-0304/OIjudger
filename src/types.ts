import type { RuntimeErrorSummary } from './runtimeErrorExplainer';

export type SampleSourceType = 'managed' | 'external';

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

export type SampleStatus = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'ERR' | 'Skipped' | 'Missing';

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
  diff?: string;
  sampleSourceType?: SampleSourceType;
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
  summary: {
    accepted: number;
    total: number;
  };
  results?: SampleReport[];
  samples: SampleReport[];
};
