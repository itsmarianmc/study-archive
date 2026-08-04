"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "../_context/ToastContext";
import { SettingsSection } from "./SettingsManager";

function formatBytes(bytes: number): string {
    if (!bytes) return "0 MB";
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
}

export default function OfflineSettings() {
    const [open, setOpen] = useState(false);
    const [supported, setSupported] = useState(true);
    const [pageCount, setPageCount] = useState<number | null>(null);
    const [usageBytes, setUsageBytes] = useState<number | null>(null);
    const [clearing, setClearing] = useState(false);
    const { showToast } = useToast();

    const refreshStats = useCallback(async () => {
        if (typeof window === "undefined" || !("caches" in window)) {
            setSupported(false);
            return;
        }
        try {
            const cacheNames = await caches.keys();
            let count = 0;
            for (const name of cacheNames) {
                if (!name.startsWith("study-archive-")) continue;
                const cache = await caches.open(name);
                count += (await cache.keys()).length;
            }
            setPageCount(count);

            if ("storage" in navigator && "estimate" in navigator.storage) {
                const estimate = await navigator.storage.estimate();
                setUsageBytes(estimate.usage ?? 0);
            }
        } catch {
            setSupported(false);
        }
    }, []);

    useEffect(() => {
        if (open) refreshStats();
    }, [open, refreshStats]);

    async function clearOfflineData() {
        if (!window.confirm("Remove all offline-cached pages and data from this device? You'll need a connection to reload them.")) return;
        setClearing(true);
        try {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.filter((name) => name.startsWith("study-archive-")).map((name) => caches.delete(name))
            );
            const reg = await navigator.serviceWorker?.getRegistration();
            reg?.active?.postMessage("study-archive:clear-cache");
            showToast("Offline cache cleared.", "toast-success");
            await refreshStats();
        } catch {
            showToast("Could not clear the offline cache.", "toast-error");
        } finally {
            setClearing(false);
        }
    }

    return (
        <SettingsSection
            title="Offline access"
            description="Pages and data you open while online are cached automatically, so this archive still works with no connection. Notion sync, Ollama processing, and uploads need a network."
            open={open}
            onToggle={() => setOpen((v) => !v)}
        >
            {!supported ? (
                <p className="settings-section-description">Offline caching isn't supported in this browser.</p>
            ) : (
                <div className="settings-stack">
                    <p className="settings-section-description" style={{ margin: 0 }}>
                        {pageCount === null
                            ? "Loading offline storage info…"
                            : `${pageCount} cached item${pageCount === 1 ? "" : "s"}${
                                  usageBytes !== null ? ` · ${formatBytes(usageBytes)} on this device` : ""
                              }`}
                    </p>
                    <div className="settings-actions">
                        <button type="button" className="danger" onClick={clearOfflineData} disabled={clearing}>
                            {clearing ? "Clearing…" : "Clear offline data"}
                        </button>
                    </div>
                </div>
            )}
        </SettingsSection>
    );
}
