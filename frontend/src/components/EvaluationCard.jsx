function list(values) {
  if (!values?.length) return <li>No details returned.</li>;
  return values.map((value, i) => <li key={i}>{value}</li>);
}

export function EvaluationCard({evaluation}) {
  if (!evaluation) return null;
  const score = Number(evaluation.score ?? 0);
  return <div className="evaluation-card">
    <div className="score-badge"><strong>{Number.isFinite(score) ? score : '—'}</strong><span>/10</span></div>
    <div>
      <h4>Evaluation</h4>
      <div className="eval-grid">
        <div><b>Strengths</b><ul>{list(evaluation.strengths)}</ul></div>
        <div><b>Gaps</b><ul>{list(evaluation.gaps)}</ul></div>
      </div>
      {evaluation.follow_up && <p className="follow-up"><b>Suggested follow-up:</b> {evaluation.follow_up}</p>}
    </div>
  </div>;
}
