export function ErrorBanner({message, onClose}) {
  if (!message) return null;
  return <div className="error" role="alert">
    <span>{message}</span>
    <button type="button" onClick={onClose}>Dismiss</button>
  </div>;
}
