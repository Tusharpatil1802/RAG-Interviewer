import React, {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api} from './services/api';
import {CandidateEntry} from './components/CandidateEntry';
import {ErrorBanner} from './components/ErrorBanner';
import {InterviewQuestion} from './components/InterviewQuestion';
import {Stepper} from './components/Stepper';
import {SummaryView} from './components/SummaryView';
import {TurnLog} from './components/TurnLog';
import './style.css';

function getErrorMessage(err) {
  return err?.response?.data?.detail || err?.message || 'Something went wrong. Please try again.';
}

function App(){
  const [role,setRole]=useState('AI/ML Engineer');
  const [file,setFile]=useState(null);
  const [session,setSession]=useState(null);
  const [profile,setProfile]=useState(null);
  const [sources,setSources]=useState([]);
  const [currentSources,setCurrentSources]=useState([]);
  const [question,setQuestion]=useState('');
  const [answer,setAnswer]=useState('');
  const [turns,setTurns]=useState([]);
  const [summary,setSummary]=useState(null);
  const [maxTurns,setMaxTurns]=useState(5);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  const runningScore = useMemo(() => {
    const scores = turns.map(t => Number(t.evaluation?.score)).filter(Number.isFinite);
    if (!scores.length) return null;
    return (scores.reduce((a,b) => a + b, 0) / scores.length).toFixed(1);
  }, [turns]);
  const currentTurn = Math.min(turns.length + 1, maxTurns);

  const start=async()=>{
    setLoading(true); setError('');
    try {
      const form=new FormData(); form.append('role',role); form.append('resume',file);
      const {data}=await api.post('/api/interviews/start',form);
      setSession(data.session_id); setQuestion(data.question); setProfile(data.profile); setSources(data.context_sources || []); setCurrentSources(data.context_sources || []); setMaxTurns(data.max_turns || 5); setTurns([]); setSummary(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const submit=async()=>{
    setLoading(true); setError('');
    const current=question;
    const currentAnswer=answer.trim();
    try {
      const {data}=await api.post(`/api/interviews/${session}/answer`,{answer: currentAnswer});
      setTurns(l=>[...l,{question:current, answer: currentAnswer, evaluation:data.evaluation, context_sources: currentSources}]);
      setAnswer('');
      setMaxTurns(data.max_turns || maxTurns);
      if(data.done){
        const res=await api.get(`/api/interviews/${session}`);
        setSummary(res.data); setQuestion(''); setCurrentSources([]);
      } else {
        setQuestion(data.next_question);
        setCurrentSources(data.context_sources || []);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const reset=async()=>{
    if(!session) return;
    setLoading(true); setError('');
    try {
      const {data}=await api.post(`/api/interviews/${session}/reset`);
      setQuestion(data.question); setCurrentSources(data.context_sources || []); setTurns([]); setSummary(null); setAnswer('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return <main>
    <header className="hero">
      <div>
        <p className="eyebrow">AI/ML & Backend Intern Assignment</p>
        <h1>RoleRAG Interviewer</h1>
        <p>Resume-aware, role-based technical screening with RAG retrieval, adaptive questions, answer evaluation, and session traceability.</p>
      </div>
      {session && <button className="secondary" onClick={reset} disabled={loading}>Reset</button>}
    </header>
    <ErrorBanner message={error} onClose={() => setError('')}/>
    {session && <Stepper currentTurn={currentTurn} maxTurns={maxTurns} done={Boolean(summary)}/>} 
    {!session && <CandidateEntry role={role} setRole={setRole} file={file} setFile={setFile} loading={loading} onStart={start}/>}    
    <InterviewQuestion question={question} answer={answer} setAnswer={setAnswer} currentTurn={currentTurn} maxTurns={maxTurns} runningScore={runningScore} loading={loading} onSubmit={submit} sources={currentSources}/>
    <TurnLog profile={profile} sources={sources} turns={turns}/>
    <SummaryView summary={summary} onReset={reset} loading={loading}/>
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
