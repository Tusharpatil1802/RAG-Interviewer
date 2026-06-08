export function InterviewQuestion({question, answer, setAnswer, currentTurn, maxTurns, runningScore, loading, onSubmit, sources}) {
  if (!question) return null;
  const sourceNames = (sources || []).map(source => source.source).filter(Boolean);
  return <section className="card question-card">
    <div className="question-meta">
      <span>Question {currentTurn} of {maxTurns}</span>
      <span>Running score: {runningScore == null ? '—' : `${runningScore}/10`}</span>
    </div>
    <h2>Interview question</h2>
    <p className="question-text">{question}</p>
    <p className="sources"><b>Question grounding:</b> {sourceNames.join(', ') || 'Resume-aware fallback mode. Add KB files and run ingestion for textbook-grounded questions.'}</p>
    <textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Type a clear answer with examples, trade-offs, and failure modes..." />
    <div className="action-row">
      <small>{Math.max(0, 10 - answer.trim().length)} more characters required</small>
      <button disabled={answer.trim().length < 10 || loading} onClick={onSubmit}>{loading ? 'Evaluating...' : 'Submit answer'}</button>
    </div>
  </section>;
}
