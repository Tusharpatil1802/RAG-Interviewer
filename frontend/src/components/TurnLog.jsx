import {EvaluationCard} from './EvaluationCard';

export function TurnLog({profile, sources, turns}) {
  return <section className="timeline">
    {profile && <div className="card profile-card">
      <p className="eyebrow">Stage 2</p>
      <h3>Extracted profile</h3>
      <div className="profile-grid">
        <div><span>Name</span><b>{profile.name || 'Unknown'}</b></div>
        <div><span>Experience</span><b>{profile.years_experience || 'Not stated'}</b></div>
        <div><span>Domains</span><b>{(profile.domains || []).join(', ') || 'Not inferred'}</b></div>
      </div>
      <div className="chips">{(profile.skills || []).slice(0, 16).map(skill => <span key={skill}>{skill}</span>)}</div>
      <p className="sources"><b>Initial retrieved sources:</b> {(sources || []).map(s => s.source).filter(Boolean).join(', ') || 'Add KB files and run ingestion'}</p>
    </div>}
    {turns.map((item, i) => <article className="card turn-card" key={i}>
      <p className="eyebrow">Turn {i + 1}</p>
      <h3>{item.question}</h3>
      <p className="sources"><b>Grounding for this question:</b> {(item.context_sources || []).map(s => s.source).filter(Boolean).join(', ') || 'Resume-aware fallback mode'}</p>
      <p className="answer"><b>Candidate answer:</b> {item.answer}</p>
      <EvaluationCard evaluation={item.evaluation}/>
    </article>)}
  </section>;
}
