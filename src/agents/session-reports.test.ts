import { afterEach, expect, test } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseEnvironment } from "@/src/config/env";
import { moveCard, retryCard, updateCard } from "@/src/services/cards";
import { prepareContinuation } from "@/src/services/continuation";
import { boardSnapshot } from "@/src/services/board";
import { displayedRunStatus, type BoardData } from "@/src/components/board/types";
import { migrateDatabase } from "@/src/db/migrate";
import type { Database } from "@/src/db/sqlite";
import { prepareSessionReporter, importSessionReports, latestSessionReport, continuationInstructions, continuationCommand } from "./session-reports";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
function fixture(version: 4 | 5 = 5) {
  const directory = mkdtempSync(join(tmpdir(), "board-reports-"));
  const database = new BunDatabase(join(directory, "board.db")) as unknown as Database;
  const schema = readFileSync("src/db/schema.sql", "utf8");
  database.exec(version === 4
    ? schema.slice(0, schema.indexOf("CREATE TABLE session_reporters (")).replace(", 'blocked'", "") + "PRAGMA user_version = 4;"
    : schema);
  const cardId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  database.exec(`INSERT INTO repositories VALUES ('repo','o','r','o/r','','','main',NULL,NULL,'t','t');
    INSERT INTO source_items (id,repository_id,github_number,item_type,title,html_url,state,author_login,github_created_at,github_updated_at,created_at,updated_at) VALUES ('source','repo',1,'issue','title','','open','a','t','t','t','t');`);
  database.query("INSERT INTO cards (id,source_item_id,stage,position,work_agent,created_at,updated_at) VALUES (?,'source','planning',1,'codex','t','t')").run(cardId);
  database.query("INSERT INTO agent_sessions VALUES (?,?,'codex','work','provider-session','t','t')").run(sessionId,cardId);
  database.query("INSERT INTO agent_runs (id,card_id,session_id,stage,provider,status,created_at,updated_at) VALUES (?,?,?,'planning','codex','needs_input','2026-01-01','2026-01-01')").run(runId,cardId,sessionId);
  cleanup.push(() => { database.close(); rmSync(directory,{recursive:true,force:true}); });
  const configResult = parseEnvironment({NODE_ENV:"test",ENG_GITHUB_TOKEN:"test",GITHUB_REPOS:"o/r",WORK_AGENT:"codex",APP_DATA_DIR:directory});
  if (!configResult.ok) throw new Error("Invalid fixture config");
  database.query("INSERT INTO workspaces (id,card_id,repository_path,worktree_path,base_commit,checkout_mode,created_at,updated_at) VALUES (?,?,?,?,'base','detached','t','t')")
    .run(crypto.randomUUID(),cardId,directory,join(directory,"worktree's $(literal)"));
  return { database, cardId, runId, sessionId, config:configResult.config, guardDirectory: join(directory,"guard-bin") };
}
async function report(command: string, outcome = "ready", summary = "Plan complete", details = '{}') {
  const child = Bun.spawn(["/bin/sh","-c",`${command} "$1" "$2" "$3"`,"report",outcome,summary,details], { stdout:"pipe", stderr:"pipe", cwd:tmpdir() });
  const exit = await child.exited;
  if (exit !== 0) throw new Error(await new Response(child.stderr).text());
}

test("a real helper saves offline reports, imports once, and leaves phase and process status intact", async () => {
  const f = fixture();
  const reporter = prepareSessionReporter(f);
  await report(reporter.command,"ready","Questions answered",'{"changeType":"fix","checks":[{"command":"bun test","result":"pass"}]}');
  expect(latestSessionReport(f.database,f.runId)).toBeNull();
  expect(importSessionReports(f.database,f.guardDirectory)).toEqual({imported:1,rejected:0});
  expect(importSessionReports(f.database,f.guardDirectory)).toEqual({imported:0,rejected:0});
  expect(latestSessionReport(f.database,f.runId)?.result.outcome).toBe("succeeded");
  expect(f.database.query<{stage:string; change_type:string},[]>("SELECT stage, change_type FROM cards").get()).toEqual({stage:"planning",change_type:"fix"});
  expect(f.database.query<{status:string},[]>("SELECT status FROM agent_runs").get()?.status).toBe("needs_input");
});

test("newer reports replace ready, without late worker snapshots overwriting them", async () => {
  const f=fixture(); const reporter=prepareSessionReporter(f);
  await report(reporter.command); importSessionReports(f.database,f.guardDirectory);
  await report(reporter.command,"blocked","Missing dependency"); importSessionReports(f.database,f.guardDirectory);
  f.database.exec("UPDATE agent_runs SET status='succeeded',summary='Old worker response'");
  expect(latestSessionReport(f.database,f.runId)?.result.outcome).toBe("blocked");
});

test.each(["done","backlog","cancelled","interrupted","old_run","old_session"])("retains but does not apply %s reports", async (state) => {
  const f=fixture(); const reporter=prepareSessionReporter(f);
  await report(reporter.command);
  if(state==='done'||state==='backlog') f.database.query("UPDATE cards SET stage=?").run(state);
  if(state==='cancelled'||state==='interrupted') f.database.query("UPDATE agent_runs SET status=?").run(state);
  if(state==='old_run') f.database.query("INSERT INTO agent_runs (id,card_id,stage,provider,status,created_at,updated_at) VALUES (?,?,'planning','codex','succeeded','2026-02-01','t')").run(crypto.randomUUID(),f.cardId);
  if(state==='old_session') f.database.exec("UPDATE agent_runs SET session_id=NULL");
  expect(importSessionReports(f.database,f.guardDirectory).imported).toBe(1);
  expect(latestSessionReport(f.database,f.runId)).toBeNull();
  expect(f.database.query<{applied:number},[]>("SELECT applied FROM session_reports").get()?.applied).toBe(0);
});

test("helper rejects invalid outcomes and identity fields without creating reports", async () => {
  const f=fixture(); const reporter=prepareSessionReporter(f);
  await expect(report(reporter.command,"working")).rejects.toThrow();
  await expect(report(reporter.command,"ready","",'{}')).rejects.toThrow();
  await expect(report(reporter.command,"ready","Ok",'{"cardId":"other"}')).rejects.toThrow();
  expect(readdirSync(reporter.reportsDirectory)).toEqual([]);
});

test("helper rejects reports exceeding the importer's byte limit", async () => {
  const f = fixture();
  const reporter = prepareSessionReporter(f);
  await expect(report(reporter.command, "blocked", "Missing dependency", JSON.stringify({blockers:["界".repeat(90_000)]})))
    .rejects.toThrow("Report details are too large");
  expect(readdirSync(reporter.reportsDirectory)).toEqual([]);
});

test("continuation shell arguments preserve literal paths, sessions and prompts", async () => {
  const directory=mkdtempSync(join(tmpdir(),"board-shell-")); cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
  const instructions=continuationInstructions({stage:"planning",command:"'/tmp/it's $(bad)'"});
  expect(instructions).toContain("needs_input");
  expect(instructions).toContain("Do not edit");
  const command=continuationCommand({provider:"codex",sessionId:"sess' $(touch BAD)",worktreePath:directory,instructions});
  const child=Bun.spawn(["/bin/sh","-c",`codex() { printf '%s\\n' "$@"; }; ${command}`],{stdout:"pipe"});
  expect(await child.exited).toBe(0);
  const output=await new Response(child.stdout).text();
  expect(output).toContain("sess' $(touch BAD)"); expect(output).toContain(instructions);
});

test("version 4 migration preserves runs, events and queued work and accepts blocked", () => {
  const f=fixture(4);
  expect(() => f.database.exec("UPDATE agent_runs SET status='blocked'")).toThrow();
  f.database.exec("INSERT INTO run_events (run_id,kind,payload_json,created_at) SELECT id,'text','{}','t' FROM agent_runs");
  f.database.query("INSERT INTO queue_jobs (id,kind,card_id,run_id,state,created_at,updated_at) VALUES (?,'run_stage',?,?,'completed','t','t')").run(crypto.randomUUID(),f.cardId,f.runId);
  migrateDatabase(f.database);
  f.database.exec("UPDATE agent_runs SET status='blocked'");
  expect(f.database.query<{count:number},[]>("SELECT COUNT(*) AS count FROM run_events").get()?.count).toBe(1);
  expect(f.database.query<{count:number},[]>("SELECT COUNT(*) AS count FROM queue_jobs").get()?.count).toBe(1);
  expect(f.database.query<unknown,[]>("PRAGMA foreign_key_check").all()).toEqual([]);
});


test("external Planning ready preserves session and chosen type when moving into Building", async () => {
  const f=fixture(); const reporter=prepareSessionReporter(f);
  updateCard(f.database,f.cardId,{changeType:"feat"});
  await report(reporter.command,"ready","Plan approved",'{"changeType":"fix"}');
  importSessionReports(f.database,f.guardDirectory);
  moveCard(f.database,f.cardId,{destination:"building"});
  expect(f.database.query<{stage:string;change_type:string},[]>("SELECT stage,change_type FROM cards").get()).toEqual({stage:"building",change_type:"feat"});
  expect(f.database.query<{provider_session_id:string},[]>("SELECT provider_session_id FROM agent_sessions").get()?.provider_session_id).toBe("provider-session");
  expect(f.database.query<{stage:string;status:string},[]>("SELECT stage,status FROM agent_runs ORDER BY rowid DESC LIMIT 1").get()).toEqual({stage:"building",status:"queued"});
  expect(latestSessionReport(f.database,f.runId)).toBeNull();
});

test("reports received during board activity preserve locks and appear after the run ends", async () => {
  const f=fixture(); f.database.exec("UPDATE agent_runs SET status='running'");
  const reporter=prepareSessionReporter(f); await report(reporter.command);
  importSessionReports(f.database,f.guardDirectory);
  const snapshot=boardSnapshot(f.database,f.config) as BoardData;
  expect(displayedRunStatus(snapshot.cards[0]!.runs[0]!)).toBe("running");
  expect(() => moveCard(f.database,f.cardId,{destination:"backlog"})).toThrow("not allowed");
  expect(() => retryCard(f.database,f.cardId)).toThrow("already has");
  expect(() => prepareContinuation(f.database,f.config,f.cardId)).toThrow("Wait for");
  f.database.exec("UPDATE agent_runs SET status='failed'");
  const finished=boardSnapshot(f.database,f.config) as BoardData;
  expect(displayedRunStatus(finished.cards[0]!.runs[0]!)).toBe("succeeded");
});

test("continuation prepares repeatable instructions and refuses a leased run or old stage", () => {
  const f=fixture();
  const first=prepareContinuation(f.database,f.config,f.cardId);
  expect(prepareContinuation(f.database,f.config,f.cardId)).toEqual(first);
  expect(first.command).toContain("provider-session"); expect(first.instructions).toContain("blocked");
  f.database.query("INSERT INTO queue_jobs (id,kind,card_id,run_id,state,created_at,updated_at) VALUES (?,'run_stage',?,?,'leased','t','t')").run(crypto.randomUUID(),f.cardId,f.runId);
  expect(() => prepareContinuation(f.database,f.config,f.cardId)).toThrow("Wait for");
  f.database.exec("UPDATE queue_jobs SET state='completed'; UPDATE cards SET stage='done'");
  expect(() => prepareContinuation(f.database,f.config,f.cardId)).toThrow("no current session");
});

test("importer rejects corrupt or forged files, while valid reports keep importing", async () => {
  const f=fixture(); const reporter=prepareSessionReporter(f);
  writeFileSync(join(reporter.reportsDirectory,"corrupt.json"),"not json");
  await report(reporter.command);
  const file=readdirSync(reporter.reportsDirectory).find(name => name !== "corrupt.json")!;
  const forged=JSON.parse(readFileSync(join(reporter.reportsDirectory,file),"utf8"));
  forged.id=crypto.randomUUID(); forged.runId=crypto.randomUUID();
  writeFileSync(join(reporter.reportsDirectory,"forged.json"),JSON.stringify(forged));
  expect(importSessionReports(f.database,f.guardDirectory)).toEqual({imported:1,rejected:2});
  expect(importSessionReports(f.database,f.guardDirectory)).toEqual({imported:0,rejected:0});
});

test("an applied report stops being current after its session changes or run is cancelled", async () => {
  const f=fixture(); const reporter=prepareSessionReporter(f); await report(reporter.command);
  importSessionReports(f.database,f.guardDirectory);
  f.database.exec("UPDATE agent_sessions SET provider_session_id='another-session'");
  expect(latestSessionReport(f.database,f.runId)).toBeNull();
  f.database.exec("UPDATE agent_sessions SET provider_session_id='provider-session'; UPDATE agent_runs SET status='cancelled'");
  expect(latestSessionReport(f.database,f.runId)).toBeNull();
});
