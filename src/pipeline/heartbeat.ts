import fs from "fs";
import path from "path";

const HEARTBEAT_PATH = path.resolve(__dirname, "../../data/pipeline-heartbeat.txt");

export function touchHeartbeat() {
    try {
        fs.writeFileSync(HEARTBEAT_PATH, new Date().toISOString(), "utf-8");
    } catch (err) {
        console.error("[worker] Konnte Heartbeat nicht schreiben:", err);
    }
}
