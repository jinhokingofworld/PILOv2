import { execFile } from "node:child_process";
import { Injectable } from "@nestjs/common";

const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 120_000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export interface GithubGitCommandResult {
  stdout: string;
  stderr: string;
}

export class GithubGitCommandError extends Error {
  constructor(
    readonly exitCode: string | number | null,
    readonly stdout: string,
    readonly stderr: string,
    readonly timedOut: boolean
  ) {
    super("Git command failed");
    this.name = "GithubGitCommandError";
  }
}

@Injectable()
export class GithubGitCommandRunner {
  run(input: {
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<GithubGitCommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        input.args,
        {
          cwd: input.cwd,
          encoding: "utf8",
          env: {
            ...process.env,
            ...input.env
          },
          maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
          timeout: input.timeoutMs ?? DEFAULT_GIT_COMMAND_TIMEOUT_MS,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ stdout, stderr });
            return;
          }

          const commandError = error as NodeJS.ErrnoException & {
            killed?: boolean;
          };
          reject(
            new GithubGitCommandError(
              commandError.code ?? null,
              stdout,
              stderr,
              commandError.killed === true
            )
          );
        }
      );
    });
  }
}
