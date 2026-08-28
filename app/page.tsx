export default function HomePage() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Personal engineering queue</p>
          <h1>Engineering Work Board</h1>
        </div>
      </header>
      <section className="loading-panel" aria-live="polite">
        <p>Loading your board...</p>
      </section>
    </main>
  );
}
