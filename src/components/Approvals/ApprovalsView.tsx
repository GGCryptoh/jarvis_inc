import { ClipboardCheck } from 'lucide-react';

export default function ApprovalsView() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <ClipboardCheck size={36} className="text-emerald-400" />
          </div>
        </div>
        <h2 className="font-pixel text-[14px] tracking-wider text-emerald-400 mb-3">
          APPROVALS
        </h2>
        <p className="font-pixel text-[9px] tracking-wider text-zinc-400 leading-relaxed mb-6">
          REVIEW AND APPROVE AGENT ACTIONS
          <br />
          BEFORE THEY EXECUTE. HUMAN-IN-THE-LOOP
          <br />
          SAFETY WITH FUTURE TELEGRAM INTEGRATION.
        </p>
        <div className="inline-block font-pixel text-[8px] tracking-widest text-zinc-600 border border-zinc-700/50 rounded px-4 py-2 bg-zinc-800/30">
          COMING SOON
        </div>
      </div>
    </div>
  );
}
