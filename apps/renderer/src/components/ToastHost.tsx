import { X, Info, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToastStore } from '../store/toastStore';
import type { ToastKind } from '../store/toastStore';
import { cn } from '../lib/utils';

const KIND_ICON: Record<ToastKind, React.ReactNode> = {
  info: <Info size={13} className="text-th-accent shrink-0" />,
  success: <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />,
  error: <AlertTriangle size={13} className="text-red-400 shrink-0" />,
};

/** Fixed bottom-right stack for in-app transient notifications. Mounted once in App. */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-3 right-3 z-[300] flex flex-col gap-2 w-72 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 px-3 py-2.5 rounded-lg border shadow-xl',
            'bg-th-surface border-th-line animate-toast-in',
          )}
        >
          <span className="mt-0.5">{KIND_ICON[t.kind]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-th-hi text-[11px] font-medium leading-snug">{t.title}</p>
            {t.body && <p className="text-th-3 text-[10px] leading-snug mt-0.5">{t.body}</p>}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="text-th-ghost hover:text-th-hi transition-colors shrink-0 p-0.5"
            title="Dismiss"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
