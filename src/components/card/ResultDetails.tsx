import type { AgentResult } from "@/src/agents/types";

export function ResultDetails({ result }: Readonly<{ result: AgentResult | null }>) {
  if (!result) return null;
  return <>
    {result.questions.length ? <div className="run-section"><h4>Questions</h4><ul>{result.questions.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
    {result.blockers.length ? <div className="run-section"><h4>Blockers</h4><ul>{result.blockers.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
    {result.plan.length ? <div className="run-section"><h4>Plan</h4><ul>{result.plan.map((item, i) => <li key={i}><code>{item.file}</code> {item.change}</li>)}</ul></div> : null}
    {result.changedFiles.length ? <div className="run-section"><h4>Changed files</h4><ul>{result.changedFiles.map((file, i) => <li key={i}><code>{file}</code></li>)}</ul></div> : null}
    {result.checks.length ? <div className="run-section"><h4>Checks</h4><ul>{result.checks.map((check, i) => <li key={i}><code>{check.command}</code> {check.result}</li>)}</ul></div> : null}
    {result.findings.length ? <div className="run-section"><h4>Review findings</h4><ul>{result.findings.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
    {result.verdict ? <div className="run-section"><h4>Verdict</h4><p>{result.verdict}</p></div> : null}
  </>;
}
