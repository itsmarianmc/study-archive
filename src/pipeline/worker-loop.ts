import { getNextPending, markProcessing, markDone, markFailed } from "../db/queue";
import { isOllamaReachable } from "./ollama-client";
import { processDocument } from "./process-document";
import { touchHeartbeat } from "./heartbeat";

const POLL_INTERVAL_MS = 30_000;

async function tick() {
    touchHeartbeat();

    const reachable = await isOllamaReachable();
    if (!reachable) {
        console.log("[worker] Ollama unreachable, waiting...");
        return;
    }

    const job = getNextPending() as any;
    if (!job) return;

    markProcessing(job.id);
    try {
        const result = await processDocument(job);
        markDone(job.id, result);
        console.log(`[worker] processed: ${job.filename}`);
    } catch (err: any) {
        markFailed(job.id, err.message ?? String(err));
        console.error(`[worker] error for ${job.filename}:`, err.message, err.cause);
    }
}

setInterval(tick, POLL_INTERVAL_MS);
tick();
