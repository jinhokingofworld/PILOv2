const modules = [
  "GitHub sync",
  "Project Kanban",
  "PR review",
  "Voice meeting",
  "Canvas",
  "Calendar"
];

export default function Home() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">PILO MVP</p>
        <h1 id="home-title">Workspace for developer collaboration</h1>
        <p className="summary">
          This scaffold keeps the frontend deployable while the MVP domains are
          built from Project_Planning_Document.md.
        </p>
      </section>

      <section className="module-grid" aria-label="MVP modules">
        {modules.map((module) => (
          <article className="module-card" key={module}>
            <h2>{module}</h2>
            <p>Ready for API integration.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
