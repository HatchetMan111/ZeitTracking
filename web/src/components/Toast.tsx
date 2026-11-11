export default function Toast({
  message,
  actionLabel,
  onAction,
  onClose,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="toast" role="status" data-testid="toast">
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>{actionLabel}</button>
      ) : null}
      <button type="button" onClick={onClose} aria-label="Hinweis schließen">×</button>
    </div>
  );
}
