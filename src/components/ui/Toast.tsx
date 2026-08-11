"use client";

import { Check, AlertCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";

type ToastVariant = "success" | "error";

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);

  const showToast = useCallback((message: string, variant: ToastVariant = "success") => {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 2400);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          className={`nova-fade-in fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl flex items-center gap-2 bg-panel border text-text text-[13px] ${
            toast.variant === "error" ? "border-ruby" : "border-line"
          }`}
        >
          {toast.variant === "error" ? (
            <AlertCircle size={14} className="text-ruby shrink-0" />
          ) : (
            <Check size={14} className="text-text shrink-0" />
          )}
          {toast.message}
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
