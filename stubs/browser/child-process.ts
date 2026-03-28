export function spawn(): never {
  throw new Error("child_process is not available in browser builds.");
}

export function exec(
  _command: string,
  callback?: (error: Error | null, stdout: string, stderr: string) => void,
): void {
  callback?.(new Error("child_process is not available in browser builds."), "", "");
}

const childProcess = { spawn, exec };

export default childProcess;
