"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../_context/ToastContext";

export default function SyncButton() {
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const router = useRouter();

    async function handleSync() {
        setLoading(true);
        try {
            const res = await fetch("/api/sync", { method: "POST" });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error ?? "Sync failed", "toast-error");
            } else {
                const parts = [`${data.created} new`, `${data.updated} updated`];
                if (data.errors.length) parts.push(`${data.errors.length} error(s)`);
                showToast(parts.join(", "), data.errors.length ? "toast-warning" : "toast-success");
                router.refresh();
            }
        } catch {
            showToast("Sync failed", "toast-error");
        } finally {
            setLoading(false);
        }
    }

    return (
        <button
            type="button"
            className="sync-button"
            onClick={handleSync}
            disabled={loading}
            aria-label="Sync with Notion"
            title="Sync with Notion"
        >
            <i className={`fas fa-sync-alt${loading ? " fa-spin" : ""}`}></i>
        </button>
    );
}
