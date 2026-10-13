import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const Notifications = createContext(null);

export function FinanceNotificationProvider({ children }) {
  const [items, setItems] = useState([]);
  const remove = useCallback((id) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const show = useCallback((item) => setItems((current) => [...current.filter((existing) => existing.id !== item.id), item]), []);
  const value = useMemo(() => ({ show, remove }), [show, remove]);
  return <Notifications.Provider value={value}>{children}{createPortal(<div className="finance-toasts finance-no-print" aria-label="Finance notifications">
    {items.map((item) => <Toast key={`${item.id}-${item.message}`} item={item} remove={remove} />)}
  </div>, document.body)}</Notifications.Provider>;
}

function Toast({ item, remove }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const dismiss = useCallback(() => { remove(item.id); item.onDismiss?.(); }, [item, remove]);
  useEffect(() => {
    if (item.tone !== 'success' || hovered || focused) return undefined;
    const timer = setTimeout(dismiss, 6000);
    return () => clearTimeout(timer);
  }, [item.tone, hovered, focused, dismiss]);
  return <div className={`finance-toast alert alert-${item.tone} mb-0`} role={item.tone === 'danger' ? 'alert' : 'status'}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div><strong>{item.tone === 'danger' ? 'Action needs attention' : item.tone === 'warning' ? 'Confirmation needed' : 'Saved'}</strong><p className="mb-0">{item.message}</p>{item.actions}</div>
    {item.dismissible && <button type="button" className="btn-close" aria-label="Dismiss notification" onClick={dismiss} />}
  </div>;
}

// Stable source IDs prevent duplicate page/dialog notifications and clean up on navigation.
export function FinanceNotice({ message, tone = 'success', onDismiss, dismissible = true, children }) {
  const notifications = useContext(Notifications), id = useId(), dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!message || !notifications) return undefined;
    notifications.show({ id, message, tone, dismissible, actions: children, onDismiss: () => dismissRef.current?.() });
    return () => notifications.remove(id);
  }, [notifications, id, message, tone, dismissible, children]);
  return null;
}

export default function FinanceNotifications({ error, notice, onErrorDismiss, onNoticeDismiss, hideError = false }) {
  return <><FinanceNotice message={hideError ? '' : error} tone="danger" onDismiss={onErrorDismiss} />
    <FinanceNotice message={notice} onDismiss={onNoticeDismiss} /></>;
}
