export function CandidateEntry({role, setRole, file, setFile, loading, onStart}) {
  return <section className="card entry-card">
    <div>
      <p className="eyebrow">Stage 1</p>
      <h2>Candidate entry</h2>
      <p className="muted">Upload a PDF/TXT resume and choose the role. The backend extracts the profile, builds RAG queries, and creates the first grounded question.</p>
    </div>
    <label>Target role
      <select value={role} onChange={e => setRole(e.target.value)}>
        <option>AI/ML Engineer</option>
        <option>Backend Engineer</option>
        <option>Data Science / Applied ML</option>
      </select>
    </label>
    <label>Resume
      <input type="file" accept=".pdf,.txt" onChange={e => setFile(e.target.files[0])}/>
    </label>
    {file && <p className="file-chip">Selected: {file.name}</p>}
    <button disabled={!file || loading} onClick={onStart}>{loading ? 'Starting...' : 'Start interview'}</button>
  </section>;
}
