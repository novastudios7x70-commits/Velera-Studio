"use client";

import { Check } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2400);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="nova-fade-in fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl flex items-center gap-2 bg-panel border border-violet text-text text-[13px]">
          <Check size={14} className="text-violet" /> {toast}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
