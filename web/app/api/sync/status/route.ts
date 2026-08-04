import { NextResponse } from "next/server";
import { readSyncStatus } from "@/lib/sync-status";

const STALE_AFTER_MS = 90 * 60 * 1000;

export async function GET() {
    const status = readSyncStatus();

    if (!status) {
        return NextResponse.json(
            { status: "unknown", message: "Noch kein Sync-Lauf protokolliert." },
            { status: 200 }
        );
    }

    const ageMs = Date.now() - new Date(status.lastRunAt).getTime();
    const isStale = ageMs > STALE_AFTER_MS;

    const health = status.success && !isStale ? "ok" : status.success && isStale ? "stale" : "error";

    return NextResponse.json(
        {
            status: health,
            ...status,
            ageMs,
        },
        { status: health === "error" ? 503 : 200 }
    );
}
