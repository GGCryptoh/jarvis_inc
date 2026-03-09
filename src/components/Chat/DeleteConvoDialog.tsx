interface DeleteConvoDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConvoDialog({ onConfirm, onCancel }: DeleteConvoDialogProps) {
  return (
    <div className="px-3 py-2 bg-red-500/[0.06] border-t border-red-500/20">
      <div className="font-pixel text-[7px] tracking-wider text-red-400 mb-2">
        Delete this conversation?
      </div>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 font-pixel text-[7px] tracking-wider py-1.5 border border-red-500/40 rounded text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
        >
          DELETE
        </button>
        <button
          onClick={onCancel}
          className="flex-1 font-pixel text-[7px] tracking-wider py-1.5 border border-zinc-700/50 rounded text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}
