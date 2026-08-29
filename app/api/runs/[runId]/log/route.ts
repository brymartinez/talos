import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { runIdSchema } from "@/src/domain/types";
import { apiError, runtime, ServiceError } from "@/src/services/runtime";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  try {
    const { runId } = await context.params;
    const { config, database } = runtime(request);
    const row = database.query<{ log_path: string | null }, [string]>(
      "SELECT log_path FROM agent_runs WHERE id = ?",
    ).get(runIdSchema.parse(runId));
    if (!row?.log_path) throw new ServiceError("log_not_found", "Run log not found.", 404);
    const root = `${resolve(config.paths.logsDirectory)}/`;
    const path = resolve(row.log_path);
    if (!path.startsWith(root)) throw new ServiceError("unsafe_log_path", "Run log path is invalid.", 500);
    return new Response(await readFile(path), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
