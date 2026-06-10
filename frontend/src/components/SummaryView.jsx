import React, {useState} from 'react';
import {api} from '../services/api';

function getErrorMessage(err) {
  return err?.response?.data?.detail || err?.message || 'Could not download the PDF report.';
}

function filenameFromHeaders(headers, fallback) {
  const header = headers?.['content-disposition'] || headers?.['Content-Disposition'];
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] || fallback;
}

export function SummaryView({summary, onReset, loading, onError}) {
  const [downloading, setDownloading] = useState(false);
  if (!summary) return null;
  const scores = (summary.turns || []).map(t => Number(t.evaluation?.score)).filter(Number.isFinite);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
  const downloadReport = async () => {
    if (!summary?.session_id) return;
    setDownloading(true);
    try {
      const response = await api.get(`/api/interviews/${summary.session_id}/report.pdf`, {
        responseType: 'blob',
      });
      const filename = filenameFromHeaders(response.headers, `interview-report-${summary.session_id}.pdf`);
      const url = window.URL.createObjectURL(new Blob([response.data], {type: 'application/pdf'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      onError?.(getErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };
  return <section className="card summary-card">
    <p className="eyebrow">Final output</p>
    <div className="summary-head">
      <div><h2>Session summary</h2><p className="muted">Created: {summary.created_at ? new Date(summary.created_at).toLocaleString() : '—'}</p></div>
      <div className="score-badge large"><strong>{avg}</strong><span>/10 avg</span></div>
    </div>
    <div className="summary-text">{summary.summary || 'Summary unavailable until all turns are completed.'}</div>
    <div className="summary-actions">
      <button disabled={downloading || loading} onClick={downloadReport}>{downloading ? 'Preparing PDF...' : 'Download PDF report'}</button>
      <button className="secondary" disabled={loading || downloading} onClick={onReset}>Reset this interview</button>
    </div>
  </section>;
}
