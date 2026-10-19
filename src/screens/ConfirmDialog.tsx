import { useEffect, useRef } from 'react'

type Props = {
  title: string
  message: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Fenêtre de confirmation pour une action définitive (suppression…). */
export function ConfirmDialog({ title, message, confirmLabel, busy, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  })

  useEffect(() => {
    // Le focus va sur « Annuler » : la touche Entrée ne supprime jamais par accident.
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancelRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        // Ne pas fermer aussi la fiche placée derrière.
        e.stopPropagation()
        onCancel()
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="display small">
          {title}
        </h2>
        <p id="confirm-text" className="muted">
          {message}
        </p>
        <div className="row">
          <button ref={cancelRef} type="button" className="btn ghost grow" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="button" className="btn danger-solid grow" onClick={onConfirm} disabled={busy}>
            {busy ? 'Suppression…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
