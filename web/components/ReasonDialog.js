
'use client';

import { useEffect, useRef, useState } from 'react';

export default function ReasonDialog({
  open,
  title = 'Reason required',
  description = 'Please provide a reason to continue.',
  onConfirm,
  onCancel,
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const cancelRef = useRef(null);
  const callbacksRef = useRef({ onCancel, onConfirm });

  callbacksRef.current = { onCancel, onConfirm };

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement;
    setReason('');
    setError('');

    const frame = requestAnimationFrame(() => inputRef.current?.focus());

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        callbacksRef.current.onCancel();
        return;
      }

      if (event.key !== 'Tab') return;

      const elements = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (!elements?.length) {
        event.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function submit(event) {
    event.preventDefault();
    const trimmed = reason.trim();

    if (!trimmed) {
      setError('Enter a reason before continuing.');
      inputRef.current?.focus();
      return;
    }

    callbacksRef.current.onConfirm(trimmed);
  }

  return (
    <div className="reason-dialog-backdrop">
      <section
        ref={dialogRef}
        className="reason-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-dialog-title"
        aria-describedby="reason-dialog-description"
      >
        <h2 id="reason-dialog-title">{title}</h2>
        <p id="reason-dialog-description">{description}</p>

        <form onSubmit={submit}>
          <label htmlFor="reason-dialog-input">Reason</label>
          <textarea
            ref={inputRef}
            id="reason-dialog-input"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError('');
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'reason-dialog-error' : undefined}
            rows={4}
          />

          {error && (
            <p id="reason-dialog-error" role="alert">
              {error}
            </p>
          )}

          <div className="reason-dialog-actions">
            <button ref={cancelRef} type="button" onClick={() => callbacksRef.current.onCancel()}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Continue
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
