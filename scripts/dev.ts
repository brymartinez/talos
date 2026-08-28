export {};

const children = [
  Bun.spawn(["bun", "run", "dev:web"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn(["bun", "run", "worker"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
];

const stop = (signal: NodeJS.Signals): void => {
  for (const child of children) {
    child.kill(signal);
  }
};

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const exitCode = await Promise.race(children.map((child) => child.exited));
stop("SIGTERM");
await Promise.allSettled(children.map((child) => child.exited));
process.exit(exitCode);
