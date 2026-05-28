export function mergeCheckerOutput(stdout: string, stderr: string): string {
  if (stdout.trim() && stderr.trim()) {
    return `[stdout]\n${stdout.trimEnd()}\n\n[stderr]\n${stderr.trimEnd()}\n`;
  }
  if (stdout) {
    return stdout;
  }
  return stderr;
}
