import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "@/src/db/sqlite";
import { agentResultSchema, type AgentResult } from "./types";
import { reportFileSchema, reportResult } from "./report-input";
import { cardIdSchema, runIdSchema, type AgentProvider, type Stage } from "@/src/domain/types";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

type ReporterRow = { run_id: string; session_id: string; provider_session_id: string | null; token: string };
type RunBinding = {
  card_id: string; session_id: string | null; stage: string; status: string;
  provider_session_id: string | null; card_stage: string; archived: number; current_run_id: string;
};
function binding(database: Database, runId: string): RunBinding | undefined {
  return database.query<RunBinding, [string]>(`SELECT r.card_id,r.session_id,r.stage,r.status,s.provider_session_id,
    c.stage AS card_stage,c.archived,
    (SELECT id FROM agent_runs WHERE card_id=c.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS current_run_id
    FROM agent_runs r JOIN cards c ON c.id=r.card_id LEFT JOIN agent_sessions s ON s.id=r.session_id WHERE r.id=?`).get(runId);
}
function ignoredReason(run: RunBinding | undefined, reporter: ReporterRow): string | null {
  if (!run || run.current_run_id !== reporter.run_id) return "A newer run owns this card";
  if (run.archived || run.card_stage !== run.stage) return "The card has left this stage";
  if (["cancelled", "interrupted"].includes(run.status)) return "The run was cancelled or interrupted";
  if (run.session_id !== reporter.session_id || (reporter.provider_session_id !== null && run.provider_session_id !== reporter.provider_session_id)) return "The session has changed";
  return null;
}

export function prepareSessionReporter(input: Readonly<{ database: Database; guardDirectory: string; runId: string }>) {
  const runId = runIdSchema.parse(input.runId);
  const run = binding(input.database, runId);
  if (!run?.session_id) throw new Error("Run has no session");
  const previous = input.database.query<ReporterRow, [string]>("SELECT * FROM session_reporters WHERE run_id=?").get(runId);
  const token = previous && previous.session_id === run.session_id &&
    (previous.provider_session_id === null || previous.provider_session_id === run.provider_session_id)
    ? previous.token : crypto.randomUUID();
  input.database.query("INSERT INTO session_reporters (run_id,session_id,provider_session_id,token) VALUES (?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET session_id=excluded.session_id,provider_session_id=excluded.provider_session_id,token=excluded.token")
    .run(runId,run.session_id,run.provider_session_id,token);
  const directory = join(input.guardDirectory, "runs", runId);
  const reportsDirectory = join(directory, "reports");
  mkdirSync(reportsDirectory, {recursive: true, mode: 0o700});
  const helperPath = join(directory, "report.ts");
  const schemaPath = join(process.cwd(), "src/agents/report-input.ts");
  const bun = execFileSync("/usr/bin/which", ["bun"], {encoding:"utf8"}).trim();
  const helper = `import { sessionReportInputSchema } from ${JSON.stringify(schemaPath)};
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
try {
  if (process.argv.length < 4 || process.argv.length > 5) throw new Error("Usage: report OUTCOME SUMMARY [DETAILS_JSON]");
  const raw = process.argv[4] ?? "{}";
  if (raw.length > 200000) throw new Error("Report details are too large");
  const report = sessionReportInputSchema.parse({outcome:process.argv[2],summary:process.argv[3],details:JSON.parse(raw)});
  const id = crypto.randomUUID();
  const event = {id,runId:${JSON.stringify(runId)},token:${JSON.stringify(token)},createdAt:new Date().toISOString(),report};
  const serialized = JSON.stringify(event);
  if (Buffer.byteLength(serialized) > 256000) throw new Error("Report details are too large");
  const path = join(${JSON.stringify(reportsDirectory)}, id + ".json");
  writeFileSync(path + ".tmp", serialized, {flag:"wx",mode:0o600,flush:true});
  renameSync(path + ".tmp", path);
  console.log("Saved board report: " + report.outcome);
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; }
`;
  writeFileSync(helperPath + ".tmp", helper, {mode:0o700});
  renameSync(helperPath + ".tmp", helperPath);
  return { command: `${shellQuote(bun)} ${shellQuote(helperPath)}`, reportsDirectory };
}

export function bindReporterSession(database: Database, runId: string, providerSessionId: string): void {
  database.query("UPDATE session_reporters SET provider_session_id=? WHERE run_id=? AND provider_session_id IS NULL").run(providerSessionId,runId);
}

export function importSessionReports(database: Database, guardDirectory: string): { imported: number; rejected: number } {
  let imported = 0;
  let rejected = 0;
  for (const reporter of database.query<ReporterRow, []>("SELECT * FROM session_reporters").all()) {
    const directory = join(guardDirectory,"runs",reporter.run_id,"reports");
    let files: string[];
    try { files = readdirSync(directory).filter(name => name.endsWith(".json")); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") continue; throw error; }
    for (const file of files) {
      const path = join(directory,file);
      let parsed: ReturnType<typeof reportFileSchema.parse>;
      try {
        if (statSync(path).size > 256_000) throw new Error("Report too large");
        parsed = reportFileSchema.parse(JSON.parse(readFileSync(path,"utf8")));
        if (parsed.runId !== reporter.run_id || parsed.token !== reporter.token) throw new Error("Report does not match its run");
      } catch {
        renameSync(path,path + ".rejected"); rejected++; continue;
      }
      imported += database.transaction(() => {
        const run = binding(database,reporter.run_id);
        const reason = ignoredReason(run,reporter);
        const result = reportResult(parsed.report);
        const inserted = database.query(`INSERT OR IGNORE INTO session_reports (id,run_id,token,result_json,reported_at,imported_at,applied,ignored_reason) VALUES (?,?,?,?,?,?,?,?)`)
          .run(parsed.id,reporter.run_id,reporter.token,JSON.stringify(result),parsed.createdAt,new Date().toISOString(),reason ? 0 : 1,reason).changes;
        if (inserted && !reason && run?.stage === "planning" && result.outcome === "succeeded") {
          database.query("UPDATE cards SET change_type=COALESCE(change_type,?),updated_at=? WHERE id=? AND stage='planning'")
            .run(result.changeType,new Date().toISOString(),cardIdSchema.parse(run.card_id));
        }
        return inserted;
      })();
      unlinkSync(path);
    }
  }
  return { imported, rejected };
}

export type SessionReport = Readonly<{ id: string; result: AgentResult; reportedAt: string; applied: boolean; ignoredReason: string | null }>;
export function sessionReportHistory(database: Database, runId: string): SessionReport[] {
  return database.query<{id:string;result_json:string;reported_at:string;applied:number;ignored_reason:string|null},[string]>(
    "SELECT id,result_json,reported_at,applied,ignored_reason FROM session_reports WHERE run_id=? ORDER BY reported_at DESC,id DESC",
  ).all(runId).map(row => ({id:row.id,result:agentResultSchema.parse(JSON.parse(row.result_json)),reportedAt:row.reported_at,applied:row.applied === 1,ignoredReason:row.ignored_reason}));
}
export function latestSessionReport(database: Database, runId: string): SessionReport | null {
  const reporter = database.query<ReporterRow,[string]>("SELECT * FROM session_reporters WHERE run_id=?").get(runId);
  if (!reporter || ignoredReason(binding(database,runId),reporter)) return null;
  const row = database.query<{id:string;result_json:string;reported_at:string},[string,string]>(
    "SELECT id,result_json,reported_at FROM session_reports WHERE run_id=? AND token=? AND applied=1 ORDER BY reported_at DESC,id DESC LIMIT 1",
  ).get(runId,reporter.token);
  return row ? {id:row.id,result:agentResultSchema.parse(JSON.parse(row.result_json)),reportedAt:row.reported_at,applied:true,ignoredReason:null} : null;
}

export function continuationInstructions(input: Readonly<{stage: Exclude<Stage,"backlog"|"done">;command:string}>): string {
  const policy = input.stage === "building" ? "Implementation edits are authorized. Do not commit, push, or create a PR." : "Do not edit files. Discuss and inspect only; stage changes require the board.";
  return `Continue this ${input.stage} session. ${policy}
After each substantive reply, run this local command to update the Engineering Work Board:
${input.command} OUTCOME 'Short reason' 'OPTIONAL_DETAILS_JSON'
Replace OUTCOME with exactly ready (this stage is complete), needs_input (you need an answer), blocked (you cannot proceed), or changes_requested (review found changes to make). The optional JSON object can include changeType, questions, blockers, plan, changedFiles, checks, findings, verdict, prTitle and prDescription. Omit the third argument when no details apply. Use shell quoting for all values. Report only current unresolved questions and blockers. A later reply must report a new outcome if readiness changes.
This command is bound to this run and stage. Use this command instead of any older board reporting command in this conversation. Reports work while the board is closed and never move its columns. Do not restart completed work. If the command fails, say so; do not claim the board was updated.`;
}
export function continuationCommand(input: Readonly<{provider:AgentProvider;sessionId:string;worktreePath:string;instructions:string}>): string {
  const args = input.provider === "codex" ? ["codex","resume",input.sessionId,input.instructions] : ["claude","--resume",input.sessionId,input.instructions];
  return `cd ${shellQuote(input.worktreePath)} && ${args.map(shellQuote).join(" ")}`;
}
