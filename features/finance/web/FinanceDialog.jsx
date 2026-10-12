import React, { useEffect, useRef, useId } from 'react';

export default function FinanceDialog({ title, busy, onClose, onSubmit, children, error, disabled, footer, titleId }) {
  const panel = useRef(null);
  const autoId = useId();
  const headingId = titleId || `finance-dialog-${autoId}`;
  useEffect(() => {
    const prior = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => [...panel.current.querySelectorAll('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),[tabindex="0"]')];
    (controls()[0] || panel.current).focus();
    function key(event) {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    panel.current.addEventListener('keydown', key);
    const element = panel.current;
    return () => { element.removeEventListener('keydown', key); document.body.style.overflow = overflow; if (prior?.isConnected) prior.focus(); };
  }, [busy, onClose]);
  return <div className="finance-backdrop"><section ref={panel} tabIndex={-1} className="finance-dialog card" role="dialog" aria-modal="true" aria-labelledby={headingId}>
    <form onSubmit={onSubmit || ((e) => e.preventDefault())}><div className="card-header"><h3 id={headingId}>{title}</h3></div>
      <fieldset disabled={disabled} className="card-body">{children}</fieldset>
      {error && <div className="alert alert-danger finance-dialog-error" role="alert">{error}</div>}
      <div className="card-footer finance-dialog-footer">{footer || <><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={disabled}>{busy ? 'Saving…' : 'Confirm and save'}</button></>}</div>
    </form></section></div>;
}
