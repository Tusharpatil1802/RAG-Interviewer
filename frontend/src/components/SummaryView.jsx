export function SummaryView({summary, onReset, loading}) {
  if (!summary) return null;
  const scores = (summary.turns || []).map(t => Number(t.evaluation?.score)).filter(Number.isFinite);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
  return <section className="card summary-card">
    <p className="eyebrow">Final output</p>
    <div className="summary-head">
      <div><h2>Session summary</h2><p className="muted">Created: {summary.created_at ? new Date(summary.created_at).toLocaleString() : '—'}</p></div>
      <div className="score-badge large"><strong>{avg}</strong><span>/10 avg</span></div>
    </div>
    <div className="summary-text">{summary.summary || 'Summary unavailable until all turns are completed.'}</div>
    <button className="secondary" disabled={loading} onClick={onReset}>Reset this interview</button>
  </section>;
}
