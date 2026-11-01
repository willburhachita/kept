"use client";

import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ToastTone = "neutral" | "ok" | "bad";
interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}

const Ctx = createContext<{ toast: (t: { title: string; body?: string; tone?: ToastTone }) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    ({ title, body, tone = "neutral" }: { title: string; body?: string; tone?: ToastTone }) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-3), { id, title, body, tone }]);
      setTimeout(() => dismiss(id), tone === "bad" ? 8000 : 4500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex w-full max-w-md animate-rise items-start gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-lift">
            <span className={cn("mt-0.5", t.tone === "ok" && "text-[#5be3a0]", t.tone === "bad" && "text-[#ff8a70]", t.tone === "neutral" && "text-pp-sky")}>
              {t.tone === "ok" ? <CheckCircle2 className="size-4" /> : t.tone === "bad" ? <CircleAlert className="size-4" /> : <Info className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-white/65">{t.body}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-white/50 hover:text-white">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}
