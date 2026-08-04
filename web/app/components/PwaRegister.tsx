"use client";

import { useEffect, useState } from "react";
import { useToast } from "../_context/ToastContext";

export default function PwaRegister() {
    const [isOffline, setIsOffline] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

        navigator.serviceWorker
            .register("/sw.js")
            .catch((err) => console.error("Service worker registration failed:", err));
    }, []);

    useEffect(() => {
        if (typeof navigator === "undefined") return;

        setIsOffline(!navigator.onLine);

        function handleOnline() {
            setIsOffline(false);
            showToast("Back online.", "toast-success");
            setTimeout(() => {
                location.reload();
            }, 1000);
        }
        function handleOffline() {
            setIsOffline(true);
            showToast("You're offline - showing cached pages.", "toast-warning");
        }

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    if (!isOffline) return null;

    return (
        <div className="offline-pill" role="status">
            <i className="fa-solid fa-wifi-slash" aria-hidden="true"></i>
            Offline mode
        </div>
    );
}
