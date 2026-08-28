import BetterSqlite3 from "better-sqlite3";

export type RunResult = Readonly<{ changes: number; lastInsertRowid: number | bigint }>;

export type Statement<Result, Parameters extends readonly unknown[]> = Readonly<{
  get(...parameters: Parameters): Result | undefined;
  all(...parameters: Parameters): Result[];
  run(...parameters: Parameters): RunResult;
}>;

export interface Database {
  query<Result, Parameters extends readonly unknown[]>(sql: string): Statement<Result, Parameters>;
  run(sql: string): RunResult;
  exec(sql: string): void;
  transaction<Result>(operation: () => Result): () => Result;
  close(): void;
}

export class NodeDatabase implements Database {
  readonly #database: BetterSqlite3.Database;

  constructor(path: string) {
    this.#database = new BetterSqlite3(path);
  }

  query<Result, Parameters extends readonly unknown[]>(sql: string): Statement<Result, Parameters> {
    const statement = this.#database.prepare(sql);
    return {
      get: (...parameters) => statement.get(...parameters) as Result | undefined,
      all: (...parameters) => statement.all(...parameters) as Result[],
      run: (...parameters) => statement.run(...parameters),
    };
  }

  run(sql: string): RunResult {
    return this.#database.prepare(sql).run();
  }

  exec(sql: string): void {
    this.#database.exec(sql);
  }

  transaction<Result>(operation: () => Result): () => Result {
    return this.#database.transaction(operation);
  }

  close(): void {
    this.#database.close();
  }
}
