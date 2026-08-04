import chokidar from "chokidar";
import path from "path";
import fs from "fs";
import { enqueueFile } from "../db/queue";

const WATCH_ROOT = path.resolve(__dirname, "../../data/material");

function sidecarPath(filePath: string): string {
    return path.join(path.dirname(filePath), `.${path.basename(filePath)}.meta.json`);
}

const watcher = chokidar.watch(WATCH_ROOT, {
    ignored: (filePath: string, stats?: fs.Stats) => {
        if (!stats?.isFile()) return false;
        return /(^|[/\\])\.|\.tmp$|\.part$/.test(filePath);
    },
    persistent: true,
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: {
        stabilityThreshold: 3000,
        pollInterval: 200,
    },
});

watcher.on("add", (filePath) => {
    const folder = path.basename(path.dirname(filePath));
    const filename = path.basename(filePath);

    let userTitle: string | undefined;
    let userSummary: string | undefined;
    let notes: string | undefined;

    const metaPath = sidecarPath(filePath);
    if (fs.existsSync(metaPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            userTitle = typeof meta.title === "string" ? meta.title : undefined;
            userSummary = typeof meta.summary === "string" ? meta.summary : undefined;
            notes = typeof meta.notes === "string" ? meta.notes : undefined;
        } catch (err) {
            console.error(`[watcher] failed to read sidecar meta for ${filename}:`, err);
        } finally {
            fs.unlinkSync(metaPath);
        }
    }

    enqueueFile({ path: filePath, folder, filename, detectedAt: new Date(), userTitle, userSummary, notes });
    console.log(`[watcher] new file detected: ${folder}/${filename}`);
});

watcher.on("error", (err) => console.error("[watcher] error:", err));

console.log(`[watcher] watching ${WATCH_ROOT}`);
