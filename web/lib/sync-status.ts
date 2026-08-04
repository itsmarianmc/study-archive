import fs from "fs";
import path from "path";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");
const STATUS_PATH = path.join(DATA_ROOT, "sync-status.json");

export interface SyncStatus {
    lastRunAt: string;
    success: boolean;
    source: "systemd" | "manual";
    durationMs: number;
    total: number;
    created: number;
    updated: number;
    errorCount: number;
    errors: string[];
}

export function writeSyncStatus(status: Omit<SyncStatus, "lastRunAt">): void {
    const payload: SyncStatus = {
        lastRunAt: new Date().toISOString(),
        ...status,
        errors: status.errors.slice(0, 10),
    };

    try {
        fs.mkdirSync(DATA_ROOT, { recursive: true });
        fs.writeFileSync(STATUS_PATH, JSON.stringify(payload, null, 2), "utf-8");
    } catch (err) {
        console.error("Konnte sync-status.json nicht schreiben:", err);
    }
}

export function readSyncStatus(): SyncStatus | null {
    try {
        const raw = fs.readFileSync(STATUS_PATH, "utf-8");
        return JSON.parse(raw) as SyncStatus;
    } catch {
        return null;
    }
}
