"use client";

type Props = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({ message, onConfirm, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-[var(--bg)] rounded-lg shadow-lg p-5 w-80 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-[var(--text)]">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)]"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm rounded bg-red-500 hover:bg-red-600 text-white"
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}
