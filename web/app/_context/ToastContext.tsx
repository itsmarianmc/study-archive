"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";

export interface ToastItem {
    msg: string;
    cls?: "toast-success" | "toast-error" | "toast-warning";
    duration?: number;
}

interface ToastContextValue {
    toastQueue: ToastItem[];
    showToast: (msg: string, cls?: ToastItem["cls"], duration?: number) => void;
    consumeToast: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toastQueue, setToastQueue] = useState<ToastItem[]>([]);

    const showToast = useCallback((msg: string, cls?: ToastItem["cls"], duration?: number) => {
        setToastQueue((q) => [...q, { msg, cls, duration }]);
    }, []);

    const consumeToast = useCallback(() => {
        setToastQueue((q) => q.slice(1));
    }, []);

    return (
        <ToastContext.Provider value={{ toastQueue, showToast, consumeToast }}>
            {children}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used within a ToastProvider");
    return ctx;
}
