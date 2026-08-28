import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type AppPaths = Readonly<{
  dataDirectory: string;
  databaseFile: string;
  repositoriesDirectory: string;
  worktreesDirectory: string;
  logsDirectory: string;
}>;

export function expandPath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return isAbsolute(value) ? value : resolve(value);
}

export function deriveAppPaths(appDataDirectory: string): AppPaths {
  const dataDirectory = expandPath(appDataDirectory);
  return {
    dataDirectory,
    databaseFile: join(dataDirectory, "board.sqlite"),
    repositoriesDirectory: join(dataDirectory, "repos"),
    worktreesDirectory: join(dataDirectory, "worktrees"),
    logsDirectory: join(dataDirectory, "logs"),
  };
}
