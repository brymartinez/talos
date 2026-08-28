import { getConfigResult } from "@/src/config/env";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const configuration = getConfigResult();

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Personal engineering queue</p>
          <h1>Engineering Work Board</h1>
        </div>
      </header>
      {configuration.ok ? (
        <section className="loading-panel" aria-live="polite">
          <p>Loading your board...</p>
        </section>
      ) : (
        <section className="configuration-panel" aria-labelledby="configuration-title">
          <p className="eyebrow">Setup required</p>
          <h2 id="configuration-title">Check your environment</h2>
          <p>The worker will stay stopped until these values are fixed.</p>
          <ul>
            {configuration.errors.map((error) => (
              <li key={`${error.field}-${error.message}`}>
                <code>{error.field}</code> {error.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
