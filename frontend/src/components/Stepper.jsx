export function Stepper({currentTurn, maxTurns, done}) {
  const steps = Array.from({length: maxTurns || 5}, (_, i) => i + 1);
  return <div className="stepper" aria-label="Interview progress">
    {steps.map(step => <div key={step} className={`step ${step < currentTurn || done ? 'complete' : ''} ${step === currentTurn && !done ? 'active' : ''}`}>
      <span>{step}</span>
      <small>{step < currentTurn || done ? 'Done' : step === currentTurn ? 'Current' : 'Pending'}</small>
    </div>)}
  </div>;
}
