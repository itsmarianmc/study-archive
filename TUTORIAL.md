# Study Archive - Implementation Plan

<p align="center">
    <a href="https://github.com/itsmarianmc/study-archive/">
        <img alt="github" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/available/github_vector.svg">
    </a>
    &nbsp;
    <a href="">
        <img alt="kofi-singular" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/donate/kofi-singular_vector.svg">
    </a>
    &nbsp;
    <a href="https://github.com/itsmarianmc/study-archive/blob/main/TUTORIAL.md">
        <img src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/compact/documentation/generic_vector.svg" alt="Documentation" height="56">
    </a>
</p>

---

Architecture: an App Server (hosts the website, database, and files) talks over HTTP to an Ollama Host running the vision/text models. These can be the exact same machine, or two separate machines connected over a LAN or a VPN like Tailscale, whatever fits your hardware.

---

## Phase 1: Folder Structure & File Watcher

**Goal:** Reliably detect new files in the study material folder without reacting to files that are still being written.

**Where:** Everything on the **App Server**.

```
/home/marian/study-archive/
├── data/
│   └── material/
│       ├── math/
│       ├── history/
│       └── ethics/
├── src/
│   ├── watcher/
│   │   ├── index.ts
│   │   └── types.ts
│   ├── db/
│   ├── pipeline/
│   └── server/
├── package.json
└── tsconfig.json
```

### Setup

```bash
mkdir -p ~/study-archive/data/material/{math,history,ethics}
cd ~/study-archive
npm init -y
npm install chokidar@^3.6.0 better-sqlite3@^11.3.0 express@^4.19.2 dotenv@^16.4.5 pdf-parse@^2.1.0
npm install -D typescript@^5.5.4 tsx@^4.19.0 @types/node@^22.5.4 @types/express@^4.17.21 @types/better-sqlite3@^7.6.11
```

Pinning to these specific major versions matters more than it might look: `better-sqlite3` ships a native binary that must match the Node.js version it runs under (see the `NODE_MODULE_VERSION` note in Phase 6), and `chokidar` behaves differently across major versions (see below). Letting `npm install` pick whatever the latest tag happens to be at setup time can silently produce a different, harder-to-debug environment than the one this tutorial was written against.

Add convenience scripts to `package.json`:

```json
"scripts": {
    "watch": "tsx src/watcher/index.ts",
    "worker": "tsx src/pipeline/worker-loop.ts",
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts"
}
```

`start` runs the combined entry point from Phase 6 directly with `tsx`, useful for a quick local test without Docker. `dev` adds `tsx watch`, which restarts the process automatically on file changes, convenient while actively editing pipeline code. `watch` and `worker` run the two halves independently, handy for isolating which one is misbehaving during debugging (see the various "Watch out for" sections throughout this tutorial where separating them mattered).

### `tsconfig.json` (root, for the `src` folder)

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "node16",
        "moduleResolution": "node16",
        "types": ["node"],
        "esModuleInterop": true,
        "strict": true,
        "skipLibCheck": true,
        "outDir": "dist",
        "rootDir": "src"
    },
    "include": ["src/**/*.ts"],
    "exclude": ["node_modules", "web"]
}
```

`"module"` and `"moduleResolution"` must be set to the same value, TypeScript requires that. `"node16"` is currently the recommended choice for regular Node.js projects. `"exclude": ["web"]` matters because it keeps this tsconfig from conflicting with the separate Next.js config in `web/tsconfig.json`, since both projects are open in the same editor workspace.

Note on imports: use plain `"fs"` and `"path"` rather than the `"node:fs"` / `"node:path"` prefixed form. The prefixed form requires `moduleResolution: "node16"` or `"nodenext"` to resolve correctly under older TypeScript defaults, and skipping it avoids an entire category of "cannot find name" errors.

### `src/watcher/types.ts`

```typescript
export type FileStatus = "pending" | "processing" | "done" | "failed";

export interface WatchedFile {
    path: string;
    folder: string;
    filename: string;
    detectedAt: Date;
}
```

### `src/watcher/index.ts`

```typescript
import chokidar from "chokidar";
import path from "path";
import fs from "fs";
import { enqueueFile } from "../db/queue";

const WATCH_ROOT = path.resolve(__dirname, "../../data/material");

function sidecarPath(filePath: string): string {
    return path.join(path.dirname(filePath), `.${path.basename(filePath)}.meta.json`);
}

const watcher = chokidar.watch(WATCH_ROOT, {
    ignored: (filePath, stats) => {
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
```

> This already includes the Phase 11 sidecar-override handling (`.filename.meta.json`) so the final file matches what's actually in the repo - see Phase 11 for why it's there. The watcher itself was still built first, before the upload form and its overrides existed.

### Watch out for:

- **`stabilityThreshold` set too low.** Many tutorials default to 200ms, which is fine for small text files but not for a 15MB scan arriving in several chunks via AirDrop or a sync tool. Use 3000ms for photo/scan files, better too cautious than too early.
- **Forgetting `ignoreInitial: true`.** Leaving this out means the watcher fires an `add` event for every already-existing file on first start, and the system processes everything again.
- **Linux inotify limit.** With many subfolders/files you can hit `ENOSPC`. Fix: `echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p`
- **Chokidar version.** From v4 there is no glob support in `ignored` anymore, from v5 it is ESM-only. This project pins `"chokidar": "^3.6.0"` in `package.json` for exactly that reason, v3.x has full CommonJS compatibility with `"module": "node16"` and `"type": "commonjs"`, and there's no functional need to chase a newer major version for what this watcher does.
- The actual iPad-to-server transfer (AirDrop, Syncthing, etc.) is outside the scope of this plan, but note: some sync tools first write a `.tmp` file and rename it afterward. That produces extra events, which are already filtered out by the `ignored` pattern above.

---

## Phase 2: SQLite Schema & Offline Queue

**Goal:** Every detected file gets a status. If Ollama on the Ollama Host is unreachable, the file stays `pending` and is automatically retried once it's back online. No Redis, no message broker needed, at this volume (a handful of files per day) SQLite is entirely sufficient as a queue.

**Where:** App Server, `src/db/`

### `src/db/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    title TEXT,
    doc_date TEXT,
    tags TEXT,
    summary TEXT,
    raw_text TEXT,
    html_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    detected_at TEXT NOT NULL,
    processed_at TEXT,
    user_title TEXT,
    user_summary TEXT,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder);
```

> `user_title`, `user_summary`, and `notes` are shown here already even though they're not needed until Phase 11's manual overrides. Since `schema.sql` only runs `CREATE TABLE IF NOT EXISTS`, it never touches a table that already exists, existing installs need the migration in `queue.ts` below to pick up the new columns, that's exactly what it's for.

`detected_at` is set the moment the watcher sees the file, before anything is sent to Ollama. This column is the actual upload timestamp and stays fixed for the lifetime of the row. `doc_date`, by contrast, is filled in later by the model itself (Phase 3) and reflects whatever date it thinks the study material is *about* - not when it arrived. The frontend (Phase 5) needs to read from `detected_at` for anything labeled "upload date"; reading `doc_date` there instead is a common mix-up since both are dates on the same row, but they answer different questions.

### `src/db/queue.ts`

> This already includes the migration and the `user_title`/`user_summary`/`notes` handling from Phase 11's manual overrides, and `markDone()`'s `COALESCE` preference for them, so this matches the final file in the repo. They're pointed out again where they're actually motivated, in Phase 11.

```typescript
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { WatchedFile } from "../watcher/types";

const DB_PATH = path.resolve(__dirname, "../../data/study-archive.db");
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const schema = fs.readFileSync(path.resolve(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// Migration for databases created before these columns existed.
const existingColumns = new Set(
    (db.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[]).map((c) => c.name)
);
for (const col of ["user_title", "user_summary", "notes"]) {
    if (!existingColumns.has(col)) {
        db.exec(`ALTER TABLE documents ADD COLUMN ${col} TEXT`);
    }
}

export function enqueueFile(file: WatchedFile & { userTitle?: string; userSummary?: string; notes?: string }) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO documents (folder, filename, file_path, status, detected_at, user_title, user_summary, notes)
        VALUES (@folder, @filename, @path, 'pending', @detectedAt, @userTitle, @userSummary, @notes)
    `);
    stmt.run({
        folder: file.folder,
        filename: file.filename,
        path: file.path,
        detectedAt: file.detectedAt.toISOString(),
        userTitle: file.userTitle ?? null,
        userSummary: file.userSummary ?? null,
        notes: file.notes ?? null,
    });
}

export function getNextPending() {
    return db
        .prepare(`SELECT * FROM documents WHERE status = 'pending' AND attempts < 5 ORDER BY detected_at ASC LIMIT 1`)
        .get();
}

export function markProcessing(id: number) {
    db.prepare(`UPDATE documents SET status = 'processing', attempts = attempts + 1 WHERE id = ?`).run(id);
}

export function markDone(id: number, data: { title: string; docDate: string; tags: string[]; summary: string; rawText: string; htmlPath: string }) {
    db.prepare(`
        UPDATE documents
        SET status = 'done',
            title = COALESCE(NULLIF(user_title, ''), @title),
            doc_date = @docDate, tags = @tags,
            summary = COALESCE(NULLIF(user_summary, ''), @summary),
            raw_text = @rawText, html_path = @htmlPath,
            processed_at = @processedAt
        WHERE id = @id
    `).run({
        id,
        title: data.title,
        docDate: data.docDate,
        tags: JSON.stringify(data.tags),
        summary: data.summary,
        rawText: data.rawText,
        htmlPath: data.htmlPath,
        processedAt: new Date().toISOString(),
    });
}

export function markFailed(id: number, error: string) {
    db.prepare(`UPDATE documents SET status = 'pending', last_error = ? WHERE id = ?`).run(error, id);
}
```

### `src/pipeline/worker-loop.ts` (retry mechanism)

```typescript
import { getNextPending, markProcessing, markDone, markFailed } from "../db/queue";
import { isOllamaReachable } from "./ollama-client";
import { processDocument } from "./process-document";

const POLL_INTERVAL_MS = 30_000;

async function tick() {
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
```

### Watch out for:

- **Don't forget SQLite WAL mode** (`journal_mode = WAL`). Without it, write and read access (pipeline writing, website reading) block each other, which leads to `SQLITE_BUSY` errors.
- **Set an `attempts` limit.** Without a ceiling (5 here) the system will hammer a broken file forever, e.g. a corrupted PDF that can never be processed successfully.
- **Never run two worker processes at the same time.** Since SQLite only cleanly tolerates one writer at a time, a single `worker-loop` process is enough. If needed later, `BEGIN IMMEDIATE` transactions could allow more concurrency, but that's unnecessary at this volume.
- The worker runs best as its own systemd service or Docker container on the App Server, separate from the web server, so that a pipeline crash doesn't take the website down with it.
- Log `err.cause` alongside `err.message` in the catch block. Generic errors like "fetch failed" hide the actual reason (DNS failure, connection refused, timeout) in the `cause` field, which is otherwise invisible.
- **A document sitting at `status = 'pending'` or `'processing'` is not an error state**, it's simply not finished yet. The frontend (Phase 5 and Phase 8) reads these rows separately from `'done'` rows so the person uploading a file can see it's in the queue instead of wondering whether the upload even worked.

---

## Phase 3: Ollama LAN Access & Vision Pipeline

**Goal:** The App Server can reach the Ollama Host over its local IP, reliably and safely enough for a home network.

**Where:** `ollama-host/docker-compose.yml` and `ollama-host/README.md` live in their own folder inside the repo, but only ever get copied to and run on the **Ollama Host**. Client code (`ollama-client.ts`) stays on the **App Server**, in the main `src/pipeline/` tree. Keeping the two docker-compose files in clearly separate folders (this one, and the root one from Phase 6) avoids ever accidentally running the wrong compose file on the wrong machine.

### `ollama-host/docker-compose.yml`

```yaml
services:
    ollama:
        image: ollama/ollama:latest
        container_name: ollama
        restart: unless-stopped
        ports:
            - "0.0.0.0:11434:11434"
        volumes:
            - ollama_data:/root/.ollama
        environment:
            - OLLAMA_HOST=0.0.0.0:11434
            - OLLAMA_KEEP_ALIVE=10m
            - OLLAMA_NUM_PARALLEL=1
            - OLLAMA_MAX_LOADED_MODELS=1
        deploy:
            resources:
                reservations:
                    devices:
                        - driver: nvidia
                          count: all
                          capabilities: [gpu]

volumes:
    ollama_data:
```

Pull the model (if not already present):

```bash
cd ollama-host
docker compose up -d
docker exec ollama ollama pull qwen3.5:9b-q8_0
```

`ollama-host/README.md` covers this same startup sequence plus the LAN and firewall notes below, condensed into a copy-pasteable form for whoever is sitting at the Ollama Host, so the full reasoning doesn't need to be re-read every time Ollama needs restarting.

`qwen3.5:9b-q8_0` takes on both roles in this project (vision OCR and text structuring), since its capabilities include both vision and text/tools, and at roughly 10GB it fits comfortably into a 16GB VRAM card. A larger, text-only model would be unnecessarily heavy for the structuring task alone and could end up partially offloaded to CPU/RAM, which slows requests down noticeably and can trigger timeout errors.

### Making Ollama reachable on the LAN

`OLLAMA_HOST=0.0.0.0` inside the container is only half the story. Three layers all need to line up:

1. **Container bind:** `OLLAMA_HOST=0.0.0.0:11434` (set above)
2. **Port publish:** `ports: ["0.0.0.0:11434:11434"]`, not just `"11434:11434"` (usually behaves the same, but explicit is safer)
3. **Host firewall:**
    - Linux: `sudo ufw allow from 192.168.0.0/24 to any port 11434 proto tcp` (only open it to your own LAN subnet, not the entire world)
    - Windows: add an inbound rule for port 11434/TCP in Windows Defender Firewall, scoped to "Private network"

### Security note (important)

Ollama has **no built-in authentication**. Anyone on the same network can use the open API, including deleting models. That's acceptable on a home network as long as:
- the router/Wi-Fi is secured with WPA2/3
- the firewall rule truly only allows your LAN subnet, not `0.0.0.0/0`
- Ollama is never exposed through the Cloudflare Tunnel (only the actual website goes through Cloudflare, Ollama stays strictly LAN-only)

If remote access is ever needed (App Server and Ollama Host not on the same network), Tailscale is the cleaner solution over router port forwarding: encrypted, no open port facing the internet, both devices see each other through a fixed Tailscale IP.

### `src/pipeline/ollama-client.ts` (App Server)

```typescript
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

export async function isOllamaReachable(): Promise<boolean> {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch {
        return false;
    }
}

export async function runVisionOCR(imageBase64: string): Promise<string> {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        body: JSON.stringify({
            model: "qwen3.5:9b-q8_0",
            messages: [
                {
                    role: "user",
                    content: "Transcribe all the text in this image verbatim. Return only the recognized text, no comments.",
                    images: [imageBase64],
                },
            ],
            think: false,
            stream: false,
        }),
        signal: AbortSignal.timeout(600_000),
    });
    const data = await res.json();
    return data.message.content as string;
}

export async function structureText(rawText: string): Promise<{
    title: string;
    docDate: string;
    tags: string[];
    summary: string;
}> {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        body: JSON.stringify({
            model: "qwen3.5:9b-q8_0",
            messages: [
                {
                    role: "user",
                    content: `Analyze the following text from school study material. The text may contain bullet points, tables, or example content that is NOT the actual topic, but only practice or example material. Pay attention to the overarching heading and the actual subject being taught, not individual bullet points within the text.

Return ONLY a JSON object with the fields:
- title: the actual study topic (usually the first heading in the text)
- docDate (YYYY-MM-DD, if recognizable, otherwise today's date)
- tags (array of 2-5 keywords about the study topic, not about example content)
- summary (2-3 sentences describing what this study material teaches)

Text:\n${rawText}`,
                },
            ],
            think: false,
            format: "json",
            stream: false,
        }),
        signal: AbortSignal.timeout(600_000),
    });
    const data = await res.json();
    return JSON.parse(data.message.content);
}
```

**Why `/api/chat` instead of `/api/generate`, and `think: false`:** `qwen3.5:9b-q8_0` is a thinking model. On the `/api/generate` route, `think: false` is currently ignored for qwen3.5 models (a known Ollama bug), so the model burns its entire output budget on internal "thinking" tokens, the actual `response` field stays empty, and `JSON.parse("")` fails with "Unexpected end of JSON input", without Ollama itself returning an error (HTTP 200). On `/api/chat`, with `think: false` as a top-level parameter (not nested inside `options`), disabling the thinking mode works reliably, and the answer lives in `data.message.content` instead of `data.response`.

**Why the prompt explicitly calls out example content:** models can latch onto vivid bullet points (e.g. a list of debate examples inside a lesson about argumentation technique) and mistake them for the actual topic of the document. Spelling out that bullet points may be example material, and that the real subject is the overarching heading, noticeably reduces this kind of misclassification.

**On `docDate` specifically:** this field is the model's best guess at what date the *content* of the document refers to, extracted from whatever text is in the file itself. It's inherently unreliable, plenty of study material has no date in it at all, and the model then falls back to "today". This is fine for display *inside* the generated document page (Phase 4) as supplementary metadata, but it must never be treated as the upload date. The two are unrelated: a scan uploaded today could contain notes dated three months ago.

### Vision model choice: the handwriting reality

There is currently **no dedicated benchmark specifically for handwriting recognition** across these models in the target language, the major OCR benchmarks mostly test printed/digital text or English handwriting. What can be summarized from available sources:

- Smaller general-purpose vision models are a solid starting point for structured documents, layouts, and tables, and multiple community comparisons rate them as noticeably more reliable than some alternative vision models marketed specifically for handwriting.
- Models advertised as handwriting-specialized don't always live up to that in practice; real-world reports are often mixed to disappointing.
- Larger vision models tend to perform more reliably on complex content like formulas or diagrams, at the cost of noticeably higher latency.

**Practical takeaway:** `qwen3.5:9b-q8_0` (already installed, about 10GB, with vision capability) is the model used throughout this project. The underlying handwriting uncertainty applies to any vision model regardless of brand: testing 5-10 real pages of your own handwriting before scaling this up is mandatory. If the error rate is too high, the fallback is either writing more clearly, or leaving handwriting out for now and only auto-processing digital/typed notes.

### Watch out for:

- **Windows + `OLLAMA_HOST` bug.** There is a known, currently unresolved bug where Windows Ollama installations remain reachable only via `localhost` despite `OLLAMA_HOST=0.0.0.0` being set correctly, the host IP or `0.0.0.0` simply doesn't respond. If the Ollama Host runs Windows and the App Server still gets "connection refused" after correct configuration: run Ollama inside Docker on Windows instead (as in the compose file above), since the port mapping there sidesteps the issue, or try WSL2.
- **CORS usually isn't an issue here**, because the App Server backend (Node.js) makes the request, not a browser directly. `OLLAMA_ORIGINS` is only needed if a browser ever talks to Ollama directly.
- **The model stays loaded, consumes VRAM.** `OLLAMA_KEEP_ALIVE=10m` keeps the model in memory for 10 minutes after the last request. Convenient for processing several files in a row, but if you're gaming at the same time, that can compete for VRAM, consider lowering it to `5m` or `0` (unload immediately).
- **Test with `curl` before debugging the whole pipeline:** `curl http://localhost:11434/api/tags` from the App Server. If that already fails, it's a network/firewall issue, not a code issue.

---

## Phase 4: HTML Template Generator

**Goal:** A clean, consistent static HTML page per document, with the model filling in content only, never the structure.

**Where:** App Server, `src/pipeline/`

### `src/pipeline/templates/document.html` (template with placeholders)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>{{title}} - Study Archive</title>
    <link rel="stylesheet" href="https://static.itsmarian.dev/fonts/font-awesome-v7.2.0/css/all.min.css">
    <link rel="stylesheet" href="/static/document.css">
</head>
<body>
    <article>
        <header>
            <h1>{{title}}</h1>
            <div class="meta">
                <span class="folder">{{folder}}</span>
                <time datetime="{{uploadDate}}">{{uploadDateFormatted}}</time>
            </div>
            <ul class="tags">{{tagsHtml}}</ul>
        </header>
        <section class="summary">
            <p>{{summary}}</p>
        </section>
        <section class="notes">
            <h2>Notes</h2>
            <textarea id="notes-input" placeholder="Your own notes for this document (not AI-generated)…"></textarea>
            <button id="notes-save-btn" class="option-btn" type="button">Save notes</button>
            <span id="notes-status" class="notes-status"></span>
        </section>
        <section class="content">
            {{contentHtml}}
        </section>
        <footer>
            <button class="option-btn">
                <a href="/"><i class="fa-solid fa-arrow-left"></i> Back To Overview</a>
            </button>
            <div class="footer-notification">
                <p class="ai-disclaimer">
                    NOTE: The content in this file was generated using Artificial Intelligence
                    and may contain inaccuracies, including but not limited to those
                    especially for handwritten source material.
                    Always verify against the original document before relying on this content.
                    No liability is assumed for any errors or omissions in the content of this file.
                </p>
            </div>
        </footer>
    </article>
    <script>
        (function () {
            const docId = "{{id}}";
            const textarea = document.getElementById("notes-input");
            const saveBtn = document.getElementById("notes-save-btn");
            const status = document.getElementById("notes-status");

            fetch(`/api/documents/${docId}`)
                .then((res) => res.json())
                .then((data) => { textarea.value = data.notes || ""; })
                .catch(() => { status.textContent = "Could not load notes."; });

            saveBtn.addEventListener("click", () => {
                status.textContent = "Saving…";
                fetch(`/api/documents/${docId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ notes: textarea.value }),
                })
                    .then((res) => {
                        if (!res.ok) throw new Error();
                        status.textContent = "Saved.";
                        setTimeout(() => { status.textContent = ""; }, 2000);
                    })
                    .catch(() => { status.textContent = "Save failed."; });
            });
        })();
    </script>
</body>
</html>

```

The `<script>` block is what makes the Notes section (Phase 11) work on a page that's otherwise static generated HTML, not a live React component: it fetches the current notes for `{{id}}` from the same `GET /api/documents/[id]` route the sidebar overrides use, and `PATCH`es them back on save, via `updateDocumentNotes()` (Phase 9's writable DB connection).

### `src/pipeline/generate-html.ts`

```typescript
import fs from "fs";
import path from "path";

const TEMPLATE_PATH = path.resolve(__dirname, "templates/document.html");
const OUTPUT_DIR = path.resolve(__dirname, "../../data/generated");

interface DocumentData {
    id: number;
    title: string;
    folder: string;
    uploadDate: string;
    tags: string[];
    summary: string;
    rawText: string;
}

export function generateDocumentHtml(doc: DocumentData): string {
    const template = fs.readFileSync(TEMPLATE_PATH, "utf-8");

    const tagsHtml = doc.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    const contentHtml = escapeHtml(doc.rawText)
        .split("\n\n")
        .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("\n");

    const html = template
        .replaceAll("{{id}}", String(doc.id))
        .replaceAll("{{title}}", escapeHtml(doc.title))
        .replaceAll("{{folder}}", escapeHtml(doc.folder))
        .replaceAll("{{uploadDate}}", doc.uploadDate)
        .replaceAll("{{uploadDateFormatted}}", formatDate(doc.uploadDate))
        .replaceAll("{{tagsHtml}}", tagsHtml)
        .replaceAll("{{summary}}", escapeHtml(doc.summary))
        .replaceAll("{{contentHtml}}", contentHtml);

    const outPath = path.join(OUTPUT_DIR, doc.folder, `${doc.id}.html`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, "utf-8");

    return path.join("generated", doc.folder, `${doc.id}.html`);
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" });
}
```

**Why this takes `uploadDate` instead of `docDate`:** earlier versions of this project passed the model's guessed content date (`structured.docDate`, Phase 3) straight into the generated page. That field is inherently unreliable, plenty of study material has no date in it at all, and it answers "what date is this content about", not "when was this uploaded". The generated page now receives the real upload timestamp (`detected_at`, set once by the watcher in Phase 1/2) instead, labeled `uploadDate` throughout this function and the template, so what's shown on the page matches what's shown in the website's document list (Phase 5). `doc_date` still exists as a column in the database (Phase 2) and is still returned by `structureText()`, it's just no longer rendered anywhere.

**Why the function returns a relative path** (`generated/<folder>/<id>.html`) rather than an absolute one: the pipeline eventually runs inside a Docker container (Phase 6) with its own root directory (`/app/...`), while the Next.js site runs directly on the host. An absolute path from the container's point of view simply would not exist on the host. A relative path lets each environment resolve it against its own data root.

### `src/pipeline/process-document.ts` (ties everything together)

For PDFs with a real text layer, `pdf-parse` is needed (already installed in Phase 1's setup step, `pdf-parse@^2.1.0`).

`pdf-parse` changed its API starting with version 2: no more default export, instead a `PDFParse` class as a named export. The code below already targets the current v2 API.

```typescript
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFParse } from "pdf-parse";
import { runVisionOCR, structureText } from "./ollama-client";
import { generateDocumentHtml } from "./generate-html";

const execFileAsync = promisify(execFile);

function looksLikeRealText(text: string, minLetters = 20): boolean {
    const letters = text.replace(/[^\p{L}]/gu, "");
    return letters.length >= minLetters;
}

async function renderPdfFirstPageBase64(pdfPath: string): Promise<string> {
    const outPrefix = path.join(os.tmpdir(), `pdf-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await execFileAsync("pdftoppm", ["-png", "-r", "200", "-f", "1", "-l", "1", pdfPath, outPrefix]);

    const outPath = `${outPrefix}-1.png`;
    const buffer = fs.readFileSync(outPath);
    fs.unlinkSync(outPath);

    return buffer.toString("base64");
}

export async function processDocument(job: any) {
    const isImage = /\.(jpg|jpeg|png)$/i.test(job.file_path);
    const isPdf = /\.pdf$/i.test(job.file_path);

    let rawText: string;

    if (isImage) {
        const base64 = fs.readFileSync(job.file_path).toString("base64");
        rawText = await runVisionOCR(base64);
    } else if (isPdf) {
        const buffer = fs.readFileSync(job.file_path);
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        rawText = result.text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "").trim();

        if (!looksLikeRealText(rawText)) {
            const imageBase64 = await renderPdfFirstPageBase64(job.file_path);
            rawText = (await runVisionOCR(imageBase64)).trim();

            if (!looksLikeRealText(rawText)) {
                throw new Error("PDF contains no extractable text, neither via text layer nor vision OCR fallback");
            }
        }
    } else {
        throw new Error(`Unsupported file type: ${job.file_path}`);
    }

    const structured = await structureText(rawText);
    const finalTitle = (job.user_title && job.user_title.trim()) || structured.title;
    const finalSummary = (job.user_summary && job.user_summary.trim()) || structured.summary;

    const htmlPath = generateDocumentHtml({
        id: job.id,
        title: finalTitle,
        folder: job.folder,
        uploadDate: job.detected_at,
        tags: structured.tags,
        summary: finalSummary,
        rawText,
    });

    return {
        title: finalTitle,
        docDate: structured.docDate,
        tags: structured.tags,
        summary: finalSummary,
        rawText,
        htmlPath,
    };
}
```

> The `finalTitle`/`finalSummary` fallback here overlaps with `markDone()`'s own `COALESCE` (Phase 2): this is the value actually baked into the generated HTML page at processing time, the `COALESCE` in SQL is a second, independent safety net for the database row itself. Both exist because `job.user_title`/`job.user_summary` come from the sidecar file (Phase 11) and could in theory still be empty strings rather than `null` depending on how the form was submitted.

**Note on the footer strip:** `pdf-parse` sometimes extracts page-footer artifacts like page counters along with the real content. The regex above strips that out before the text ever reaches the model or the generated HTML page.

**Why there's a second extraction path now:** some PDFs (observed so far: notes exported from an iOS app under "iOS Version 26.5 ... Quartz PDFContext") embed body text under a font tag (`C1`/`C2`) that references the `Adobe-Korea1` CID collection without a working `ToUnicode` CMap. The text *looks* fine when opened normally, but neither `pdf-parse` nor `pdftotext` (independently verified, same failure) can map those glyphs back to characters, only unrelated glyphs like bullet points come through. `looksLikeRealText()` catches this: a wall of bullets and whitespace passes the old `length < 20` check easily, but has almost no actual letters. When that happens, the first PDF page is rasterized with `pdftoppm` (same tool `pdftoppm -png` from `poppler-utils`, see the Dockerfile note above) and run through the exact same `runVisionOCR()` used for JPG/PNG uploads.

**Where this still fails:** for some of these broken PDFs, the missing font isn't just unreadable in the text layer, `pdftoppm` can't paint the glyphs onto the raster image at all, the rendered PNG comes out visually blank except for bullets/lines. In that case OCR has nothing to read either, and the final `looksLikeRealText()` check throws a clear error instead of silently saving garbage. There's no code-level fix for this specific case since the source PDF itself never contained recoverable glyphs, the practical workaround is to re-export the source document as an image instead (handled natively by the `isImage` branch above) or re-save the PDF through a different exporter (e.g. print-to-PDF) that flattens fonts properly.

### Watch out for:

- **XSS through generated content.** Since the model fills in the text content, always run `escapeHtml()` on anything that goes into the template. Otherwise a stray OCR output could in theory inject HTML/JS into your own page.
- **Avoid template drift.** Never let the model generate the full HTML, only the values (title, tags, summary), as implemented here. As soon as the model is allowed to shape the structure, every page ends up looking slightly different.
- PDFs with a text layer need `pdf-parse` as shown above, that's its own small building block separate from the vision pipeline.
- **Font Awesome is self-hosted here** (`https://static.itsmarian.dev/fonts/font-awesome-v7.2.0/css/all.min.css`), not loaded from a public CDN. If a Cloudflare Tunnel or the public internet is ever unavailable, icons on generated pages would fail to load unless this URL points somewhere reachable from wherever the page is viewed, either self-host on the same domain the site itself runs on, or swap back to a public CDN URL if fully offline resilience for icons specifically isn't a priority.
- The `<footer>` with a "Back To Overview" button uses the same `.option-btn` class defined in `document.css` (below), keeping it visually consistent with any other buttons added to document pages later.

### Utility: regenerating HTML after a template change

Editing `document.html` or `generate-html.ts` only affects newly processed documents, existing rows in the database already have their structured data (title, tags, summary, raw text) but their HTML file on disk still reflects the old template. Re-running everything through Ollama again would be wasteful, all the data needed is already sitting in SQLite.

`src/scripts/regenerate-html.ts`:

```typescript
import { db } from "../db/queue";
import { generateDocumentHtml } from "../pipeline/generate-html";

const docs = db.prepare(`
    SELECT id, folder, filename, title, doc_date, tags, summary, raw_text, detected_at
    FROM documents
    WHERE status = 'done'
`).all() as any[];

for (const doc of docs) {
    const tags = JSON.parse(doc.tags);
    const htmlPath = generateDocumentHtml({
        id: doc.id,
        title: doc.title,
        folder: doc.folder,
        uploadDate: doc.detected_at,
        tags,
        summary: doc.summary,
        rawText: doc.raw_text,
    });
    db.prepare(`UPDATE documents SET html_path = ? WHERE id = ?`).run(htmlPath, doc.id);
    console.log(`Regenerated ${doc.folder}/${doc.id}`);
}
```

Run it with:

```bash
npx tsx src/scripts/regenerate-html.ts
```

This re-reads every `done` document straight from the database and calls `generateDocumentHtml` again, skipping the OCR and LLM steps entirely since `raw_text`, `title`, `tags`, and `summary` are already stored. Useful any time the template, the CSS, or the HTML structure changes and existing documents should pick up the new look without a full reprocess. It writes to the same `html_path` the document already had, so no database migration is needed alongside a template change, only a rerun of this script.

---

## Phase 5: Next.js Frontend

**Goal:** A publicly reachable overview of all documents, with search/filter, behind Cloudflare Access.

**Where:** App Server, its own Next.js project (can live in the same repo as a separate folder)

```
/home/marian/study-archive/
├── web/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── upload/
│   │   │   └── page.tsx
│   │   ├── api/
│   │   │   ├── documents/route.ts
│   │   │   ├── folders/route.ts
│   │   │   └── upload/route.ts
│   │   └── [folder]/[id]/route.ts
│   └── lib/
│       └── db.ts
```

### Setting up the project

From the `study-archive` root folder:

```bash
cd ~/study-archive
npx create-next-app@latest web
```

Answer the interactive prompts to match the code in this tutorial:

```
Would you like to use TypeScript?         -> Yes
Would you like to use ESLint?             -> Yes
Would you like to use Tailwind CSS?       -> optional, doesn't matter for the base setup
Would you like to use `src/` directory?   -> No   (app/ lives directly inside web/)
Would you like to use App Router?         -> Yes  (the code below is App Router)
Customize the default import alias (@/*)? -> Yes, keep the standard @/*
```

Then add the DB library the frontend needs to read the SQLite database:

```bash
cd web
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

Create the files from this chapter (`lib/db.ts`, `app/page.tsx`, `app/[folder]/[id]/route.ts`) at the appropriate locations inside the structure generated by `create-next-app`. Quick functional check:

```bash
npm run dev
```

Reachable at `http://localhost:3000`, but only shows content once the watcher/pipeline from Phases 1-4 has written at least one document with status `done` into the `documents` table.

### `web/package.json`

`create-next-app` prompts (above) plus the `npm install` step produce this. Listed here explicitly, same reasoning as the version-pinning note in Phase 1: `npx create-next-app@latest` resolves to whatever the latest Next.js/React versions happen to be on the day it's run, which drifts over time and can silently change behavior (App Router conventions, the `params`-as-`Promise` change relied on throughout this tutorial is a Next.js 15 behavior). Writing this file directly instead of re-running the interactive scaffolding reproduces the exact set of versions this tutorial was built and tested against.

```json
{
    "name": "study-archive-web",
    "version": "1.0.0",
    "private": true,
    "scripts": {
        "dev": "next dev",
        "build": "next build",
        "start": "next start",
        "lint": "eslint"
    },
    "dependencies": {
        "@notionhq/client": "^2.2.15",
        "better-sqlite3": "^11.3.0",
        "next": "^15.4.0",
        "react": "^19.0.0",
        "react-dom": "^19.0.0"
    },
    "devDependencies": {
        "@types/better-sqlite3": "^7.6.11",
        "@types/node": "^22.5.4",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "eslint": "^9.0.0",
        "eslint-config-next": "^15.4.0",
        "typescript": "^5.5.4"
    }
}
```

After writing it, `npm install` inside `web/` to actually install these into `node_modules` before the `npm run dev` check above.

> `@notionhq/client` isn't needed yet at this point in the tutorial, it's only used by `web/app/api/sync/route.ts` (Phase 10's on-demand sync button), which runs the same sync logic as `src/scripts/notion-sync.ts` directly inside the web container so a manual sync doesn't need shell access. It's listed here because this is the final `package.json` from the repo; installing it now doesn't hurt anything, it just sits unused until Phase 10.

### `web/tsconfig.json`

```json
{
    "compilerOptions": {
        "target": "ES2017",
        "lib": ["dom", "dom.iterable", "esnext"],
        "allowJs": true,
        "skipLibCheck": true,
        "strict": true,
        "noEmit": true,
        "esModuleInterop": true,
        "module": "esnext",
        "moduleResolution": "bundler",
        "resolveJsonModule": true,
        "isolatedModules": true,
        "jsx": "preserve",
        "incremental": true,
        "plugins": [
            {
                "name": "next"
            }
        ],
        "paths": {
            "@/*": ["./*"]
        }
    },
    "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    "exclude": ["node_modules"]
}
```

### `web/lib/db.ts`

```typescript
import Database from "better-sqlite3";
import path from "path";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");

let dbInstance: Database.Database | null = null;
let writableDbInstance: Database.Database | null = null;

function getDb(): Database.Database {
    if (!dbInstance) {
        dbInstance = new Database(path.join(DATA_ROOT, "study-archive.db"), { readonly: true, fileMustExist: true });
        dbInstance.pragma("journal_mode = WAL");
    }
    return dbInstance;
}

function getWritableDb(): Database.Database {
    if (!writableDbInstance) {
        writableDbInstance = new Database(path.join(DATA_ROOT, "study-archive.db"), { fileMustExist: true });
        writableDbInstance.pragma("journal_mode = WAL");
    }
    return writableDbInstance;
}

export interface DocumentRow {
    id: number;
    folder: string;
    filename: string;
    file_path: string;
    title: string;
    doc_date: string;
    tags: string;
    summary: string;
    raw_text: string;
    html_path: string;
    status: string;
    detected_at: string;
    notes: string | null;
}

export interface ProcessingDocumentRow {
    id: number;
    folder: string;
    filename: string;
    status: string;
    detected_at: string;
}

export function getDocuments(folder?: string): DocumentRow[] {
    const db = getDb();
    if (folder) {
        return db.prepare(`SELECT * FROM documents WHERE status = 'done' AND folder = ? ORDER BY detected_at DESC`).all(folder) as DocumentRow[];
    }
    return db.prepare(`SELECT * FROM documents WHERE status = 'done' ORDER BY detected_at DESC`).all() as DocumentRow[];
}

export function getAllDocuments(): DocumentRow[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM documents ORDER BY detected_at DESC`).all() as DocumentRow[];
}

export function getProcessingDocuments(folder?: string): ProcessingDocumentRow[] {
    const db = getDb();
    if (folder) {
        return db.prepare(`SELECT * FROM documents WHERE status IN ('pending', 'processing') AND folder = ? ORDER BY detected_at DESC`).all(folder) as ProcessingDocumentRow[];
    }
    return db.prepare(`SELECT * FROM documents WHERE status IN ('pending', 'processing') ORDER BY detected_at DESC`).all() as ProcessingDocumentRow[];
}

export function getDocumentById(id: number): DocumentRow | undefined {
    const db = getDb();
    return db.prepare(`SELECT * FROM documents WHERE id = ? AND status = 'done'`).get(id) as DocumentRow | undefined;
}

export function getAnyDocumentById(id: number): DocumentRow | undefined {
    const db = getDb();
    return db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined;
}

export function getAllDocumentsByFolder(folder: string): DocumentRow[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM documents WHERE folder = ?`).all(folder) as DocumentRow[];
}

export function renameDocument(id: number, title: string): void {
    getWritableDb().prepare(`UPDATE documents SET title = ? WHERE id = ?`).run(title, id);
}

export function updateDocumentNotes(id: number, notes: string): void {
    getWritableDb().prepare(`UPDATE documents SET notes = ? WHERE id = ?`).run(notes, id);
}

export function deleteDocumentRow(id: number): void {
    getWritableDb().prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

export function updateDocumentFolderAndPaths(id: number, folder: string, filePath: string, htmlPath: string | null): void {
    getWritableDb()
        .prepare(`UPDATE documents SET folder = ?, file_path = ?, html_path = ? WHERE id = ?`)
        .run(folder, filePath, htmlPath, id);
}

export function deleteFolderRows(folder: string): void {
    getWritableDb().prepare(`DELETE FROM documents WHERE folder = ?`).run(folder);
}
```

**Why the connection is lazy:** `new Database(...)` sits inside a function (`getDb()`) instead of running at the top level of the module. This matters once the site is built inside Docker (Phase 6): `next build` statically analyzes route handlers as part of its build step, which means it imports `db.ts`. At build time the `data` folder doesn't exist yet inside the image, it only appears at runtime through the volume mount. A top-level `new Database(...)` call would try to open a database that isn't there yet and fail the build. Wrapping it in a function means the connection is only attempted the first time a request actually comes in, by which point the container is running and the volume is mounted.

**Why `detected_at`, and not `doc_date`, is used for both queries:** `getDocuments` and `getProcessingDocuments` both order by, and expose, `detected_at`, the true upload timestamp set by the watcher in Phase 2. `doc_date` still exists on the row and is still readable, but it answers "what date does the material talk about", not "when was this uploaded". A page listing uploaded documents by upload date needs the former.

**Why `DocumentRow` includes `raw_text`:** the search feature added to `page.tsx` and `/api/documents/route.ts` (below) matches against the full extracted text of a document, not just its title and tags, so a query for a term buried in the body of a page still finds it. `raw_text` was always a column in `documents` (Phase 2), it just wasn't part of this interface until search needed it.

> `notes`, `getAllDocuments()`, and `updateDocumentNotes()` are also already here even though nothing in Phase 5 uses them yet. `getAllDocuments()` (unfiltered by `status`) is what `web/app/api/sync/route.ts` needs in Phase 10, so a freshly uploaded, still-`pending` document also gets mirrored into Notion right away instead of only appearing once processing finishes. `updateDocumentNotes()` is Phase 11's manual notes field.

**`getProcessingDocuments`:** documents with `status` `pending` or `processing` haven't been through `structureText()` yet (Phase 3), so they have no `title`, `tags`, or `summary` yet, only `filename` and `detected_at` are guaranteed to exist. The interface reflects that: `ProcessingDocumentRow` only exposes the columns that are actually populated at that stage.

### `web/app/page.tsx`

```typescript
import { getDocuments, getProcessingDocuments, DocumentRow, ProcessingDocumentRow } from "@/lib/db";
import { formatUploadDate } from "@/lib/search";
import FolderGroup from "./components/FolderGroup";
import SyncButton from "./components/SyncButton";

export const dynamic = "force-dynamic";

function filterDocuments(docs: DocumentRow[], query: string): DocumentRow[] {
    if (!query) return docs;
    const q = query.toLowerCase();
    return docs.filter((doc) => {
        const tagsString = doc.tags || "";
        const dateString = formatUploadDate(doc.detected_at).toLowerCase();
        const content = doc.raw_text || "";
        const notes = doc.notes || "";
        const haystack = `${doc.title} ${doc.summary} ${tagsString} ${content} ${notes} ${dateString}`.toLowerCase();
        return haystack.includes(q);
    });
}

interface FolderGroupData {
    folder: string;
    processing: ProcessingDocumentRow[];
    docs: DocumentRow[];
}

function groupByFolder(processingDocs: ProcessingDocumentRow[], docs: DocumentRow[]): FolderGroupData[] {
    const groups = new Map<string, FolderGroupData>();

    const getGroup = (folder: string) => {
        let group = groups.get(folder);
        if (!group) {
            group = { folder, processing: [], docs: [] };
            groups.set(folder, group);
        }
        return group;
    };

    for (const doc of processingDocs) getGroup(doc.folder).processing.push(doc);
    for (const doc of docs) getGroup(doc.folder).docs.push(doc);

    return Array.from(groups.values()).sort((a, b) => a.folder.localeCompare(b.folder));
}

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const params = await searchParams;
    const query = params?.q || "";

    const allDocs = getDocuments();
    const processingDocs = getProcessingDocuments();
    const filteredDocs = filterDocuments(allDocs, query);
    const folderGroups = groupByFolder(processingDocs, filteredDocs).filter(
        (g) => g.processing.length + g.docs.length > 0
    );
    const noResults = query && filteredDocs.length === 0 && processingDocs.length === 0;

    return (
        <>
            <header className="page-header">
                <div className="page-header-top">
                    <h1>Study Archive</h1>
                    <div className="page-header-actions">
                        <a className="icon-button" href="/upload" aria-label="Add document" title="Add document">
                            <i className="fa-solid fa-plus"></i>
                        </a>
                        <SyncButton />
                    </div>
                </div>
                <form method="GET" className="search-form">
                    <input
                        type="text"
                        name="q"
                        className="search-input"
                        placeholder="Search by title, tags, content, date …"
                        defaultValue={query}
                    />
                    <button type="submit" className="search-submit"><i className="fa fa-search"></i></button>
                </form>
            </header>

            <main>
                {folderGroups.map((group) => (
                    <FolderGroup
                        key={group.folder}
                        folder={group.folder}
                        processing={group.processing}
                        docs={group.docs}
                        query={query}
                    />
                ))}

                {noResults && <p className="no-results">No results for "{query}"</p>}
            </main>
        </>
    );
}
```

> This is the Phase 11-final version of the page: the header was pulled out of `<main>` into its own `<header className="page-header">` so `layout.tsx`'s sticky footer (below) can make `<main>` grow to fill the remaining space, the "+ Add document" text link became an icon button, and a `<SyncButton />` (Phase 10) sits next to it for the on-demand Notion sync. `filterDocuments` also matches against `doc.notes` now, so a note typed on a document's own page becomes searchable too, same reasoning as `raw_text`.

**Why `export const dynamic = "force-dynamic"` matters:** the lazy database connection in `lib/db.ts` only prevents `new Database(...)` from running the moment `db.ts` is imported. It does not stop Next.js from trying to statically prerender this page during `next build`, which executes `getDocuments()` and `getProcessingDocuments()` once at build time regardless. Since the `data` folder doesn't exist yet inside the image at that point, this would fail the build even with a lazy connection. `force-dynamic` tells Next.js to skip prerendering entirely for this page and always render it live, once a real request comes in after the container is running. The two fixes solve different halves of the same problem: the lazy connection avoids failures triggered by mere imports, `force-dynamic` avoids failures triggered by build-time prerendering.

**Why documents-in-progress are shown separately, above the finished ones:** without this, a freshly uploaded file simply doesn't appear anywhere until the worker loop (Phase 2) picks it up and finishes processing, which can take anywhere from seconds to minutes depending on Ollama's load. That gap looks exactly like a failed upload from the outside. Each folder group renders `processingDocs` first, using only `filename` (since `title` doesn't exist yet) with a clock icon in front of it, gives immediate visual confirmation that the file arrived and is in the queue.

**Why search is a server-rendered `?q=` query param instead of client-side JavaScript:** the page is already a Server Component reading straight from SQLite (see `force-dynamic` above), so re-running the same `getDocuments()` call with a filter on every form submission needs no client-side state, no extra API round-trip, and works even with JavaScript disabled, it's a plain GET form. `filterDocuments` matches against title, summary, tags, the full extracted text, and the formatted upload date, so a query for a term buried in the middle of a scanned page, or for a specific month, still finds the right document. Documents still in the queue (`processingDocs`) are deliberately excluded from filtering, since they have no `title`, `summary`, or `raw_text` yet to search against, they're always shown as-is at the top.

**Why this `page.tsx` is now thin:** it only fetches, filters, and groups data, all the actual rendering (search-result snippets, the collapsible per-subject block, the rename/delete menu) lives in `FolderGroup` (Phase 9), a Client Component. Grouping and filtering stay server-side here because they only touch data already fetched from SQLite; nothing about them needs interactivity. `groupByFolder` buckets both `processingDocs` and the already-filtered `docs` by their `folder` column into one array per subject, sorted alphabetically, so each subject gets exactly one collapsible block regardless of how many pending vs. finished documents it has.

### `web/app/[folder]/[id]/route.ts` (document display)

The files generated in Phase 4 are complete, standalone HTML documents (their own `<!DOCTYPE html>`, `<head>`, etc). That rules out a normal `page.tsx` with React rendering, a **route handler** instead serves the finished file untouched as `text/html`, which avoids nested `<html>` tags.

```typescript
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDocumentById } from "@/lib/db";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ folder: string; id: string }> }
) {
    const { folder, id } = await params;
    const doc = getDocumentById(Number(id));

    if (!doc || doc.folder !== folder) {
        return new NextResponse("Not found", { status: 404 });
    }

    const absolutePath = path.join(DATA_ROOT, doc.html_path);

    if (!fs.existsSync(absolutePath)) {
        return new NextResponse("HTML file missing on disk", { status: 500 });
    }

    const html = fs.readFileSync(absolutePath, "utf-8");
    return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}
```

**Important:** `params` is a `Promise` as of Next.js 15/16, not a plain object anymore, hence `await params` instead of reading `params.folder` directly.

**Important:** `DATA_ROOT` uses the same environment-variable pattern as `lib/db.ts`. Locally, without Docker, `process.env.DATA_ROOT` is unset and the code falls back to the relative path based on `process.cwd()`. Inside Docker (Phase 6), `DATA_ROOT` is set explicitly to the container's mount point, so the same code works correctly in both environments without branching logic.

### `web/app/api/documents/route.ts` (JSON API for search/filter)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDocuments } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatUploadDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" });
}

export async function GET(request: NextRequest) {
    const folder = request.nextUrl.searchParams.get("folder") ?? undefined;
    const q = request.nextUrl.searchParams.get("q")?.toLowerCase();

    let docs = getDocuments(folder);

    if (q) {
        docs = docs.filter((doc) => {
            const tagsString = doc.tags || "";
            const dateString = formatUploadDate(doc.detected_at).toLowerCase();
            const content = doc.raw_text || "";
            const haystack = `${doc.title} ${doc.summary} ${tagsString} ${content} ${dateString}`.toLowerCase();
            return haystack.includes(q);
        });
    }

    return NextResponse.json(docs);
}
```

A thin JSON endpoint on top of `getDocuments`, useful for any client outside the server-rendered homepage itself, a future mobile shortcut, a browser extension, or a client-side widget that wants results without a full page reload. The filtering logic mirrors `filterDocuments` in `page.tsx` exactly (title, summary, tags, full text, and formatted date), so both surfaces agree on what counts as a match. `folder` filters at the database level, `q` filters against the already-fetched rows since the dataset at this scale (a handful of documents per day) is far too small to justify a full-text search index. Consider extracting the shared filtering logic into one function imported by both files if it drifts out of sync again after a future edit.

### Watch out for:

- **`readonly: true` on the frontend DB connection**, so the frontend can never accidentally write to the database, that stays strictly the pipeline's job.
- **Next.js reads directly from SQLite server-side here** (no API layer strictly required, which keeps things simple), this only works because Next.js and the database file live on the same machine.
- **Configure Cloudflare Access separately**, that's pure Cloudflare dashboard configuration (Zero Trust -> Access -> Application), not part of the code here.
- If multiple devices/instances ever read and write concurrently, `better-sqlite3` with WAL mode still holds up well; under genuinely high concurrency an API layer instead of direct DB access would be cleaner, but that's not needed at this scale.

---

## Phase 6: Automation & Docker Deployment

**Goal:** Both the processing pipeline and the website run continuously in the background, start automatically after a reboot, and no longer require manually running commands in a terminal.

**Where:** App Server, project root and `web/`

### Combine watcher and worker into a single process

`src/index.ts` (new file):

```typescript
import "./watcher/index";
import "./pipeline/worker-loop";
```

Both modules start running as soon as they're imported (the watcher registers itself, the worker starts its `setInterval` loop), so this single entry point is enough to run both.

### `.dockerignore` (project root)

```
node_modules
dist
.git
web
```

Without this file, `COPY . .` in the Dockerfile below also copies the local `node_modules` folder into the image, overwriting the one that was just correctly compiled inside the container for the container's own Node.js version. That produces a `NODE_MODULE_VERSION mismatch` / `ERR_DLOPEN_FAILED` error from `better-sqlite3`, since its native binary is version-specific to the exact Node.js build it was compiled against.

> **This file isn't actually present in the repo right now.** The images currently get built manually (see "Starting everything" below) from a plain `docker build .` in the project root, which means the risk above is real any time `node_modules` or `dist` happen to exist locally at build time. Add it back before running a local build from a working copy that already has dependencies installed; it's harmless either way, and building from a fresh `git clone` (no local `node_modules` at all) sidesteps the issue too, just less robustly.

### `Dockerfile` (project root, pipeline)

```dockerfile
FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm install
COPY . .
CMD ["npx", "tsx", "src/index.ts"]
```

**Why `poppler-utils`:** provides `pdftoppm`, used later (Phase 9) as a fallback to rasterize a PDF page and OCR it with the vision model when the PDF's text layer turns out to be unusable.

**Why `python3 make g++`:** `better-sqlite3` ships as a native addon and needs to compile from source for whatever platform/Node version the image actually runs on if a prebuilt binary isn't available for it (`node-gyp`'s build toolchain). Without these three packages, `npm install` fails inside the container with a `gyp: No Xcode or CLT version detected` / `make: not found`-style error even though the exact same `npm install` works fine on a dev machine that already has a C++ toolchain installed globally.

### `web/.dockerignore`

```
node_modules
.next
.git
```

Same reasoning as above, applied to the Next.js project.

### `web/next.config.ts`

```typescript
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
    output: "standalone",
    turbopack: {
        root: path.resolve(__dirname),
    },
};

export default nextConfig;
```

`output: "standalone"` produces a minimal, self-contained build output that's ideal for Docker, it only includes the files actually needed at runtime instead of the full `node_modules` tree. `turbopack.root` fixes a separate, harmless but noisy warning: since both the project root (`~/study-archive/package-lock.json`) and `web/` (`web/package-lock.json`) contain a lockfile, Turbopack cannot automatically tell which directory is the actual workspace root and picks the outer one by default, which is wrong for this setup. Pointing `root` explicitly at the `web` folder itself resolves the ambiguity.

### `web/Dockerfile` (multi-stage build)

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV DATA_ROOT=/app/data
EXPOSE 3000
CMD ["node", "server.js"]
```

The build stage compiles the project with all dev dependencies present, the runner stage only keeps the compiled standalone output, keeping the final image small. `ENV DATA_ROOT=/app/data` is what makes `lib/db.ts` and `route.ts` resolve paths correctly inside the container, matching the volume mount defined below. The same `python3 make g++` toolchain as the pipeline's `Dockerfile` is needed here too, for the exact same reason: `web/package.json` also depends on `better-sqlite3` (Phase 5), and the build stage is where it gets compiled.

### `docker-compose.yml` (project root, combining both services)

```yaml
services:
    study-archive-pipeline:
        image: study-archive-pipeline:latest
        container_name: study-archive-pipeline
        restart: unless-stopped
        environment:
            - OLLAMA_URL=http://localhost:11434
            - NOTION_TOKEN=${NOTION_TOKEN}
            - NOTION_DATABASE_ID=${NOTION_DATABASE_ID}
            - STUDY_ARCHIVE_BASE_URL=${STUDY_ARCHIVE_BASE_URL}
        volumes:
            - /home/marian/study-archive/data:/app/data

    study-archive-web:
        image: study-archive-web:latest
        container_name: study-archive-web
        restart: unless-stopped
        ports:
            - "1920:3000"
        environment:
            - NOTION_TOKEN=${NOTION_TOKEN}
            - NOTION_DATABASE_ID=${NOTION_DATABASE_ID}
            - STUDY_ARCHIVE_BASE_URL=${STUDY_ARCHIVE_BASE_URL}
        volumes:
            - /home/marian/study-archive/data:/app/data
        depends_on:
            - study-archive-pipeline
```

Four details worth noting:
- **No `build:` keys.** Earlier versions of this file had `build: .` and `build: ./web` here, so `docker compose up --build` could build both images directly. The final setup instead builds each image explicitly with a plain `docker build` command (see "Starting everything" below) and only ever references the resulting tags here. This matters for a Portainer-managed stack in particular: Portainer's own "build from repository" flow, or a manually pushed/loaded image, both expect `docker-compose.yml` to just consume an existing `image:`, not try to build one itself from a build context Portainer doesn't have local access to.
- The `image:` field gives each build a stable, predictable tag (`study-archive-pipeline:latest`, `study-archive-web:latest`). Even without a `build:` key, this is what lets Compose (or Portainer) find the right already-built image by name.
- The volume mounts use an **absolute path** (`/home/marian/study-archive/data`) instead of a relative one (`./data`). Relative paths in a bind mount are resolved relative to wherever `docker compose` happens to be invoked from, which is normally the file's own directory but can silently break if the same compose file is ever triggered from a different working directory (a cron job, a Portainer-managed stack, a systemd unit). An absolute path removes that ambiguity entirely.
- The external port is `1920` rather than `3000`. This is purely a host-side choice, the container still listens on `3000` internally (`EXPOSE 3000` in `web/Dockerfile`, matched by `next start`'s default port), only the mapping on the left side of `"1920:3000"` changed. Useful if port 3000 on the host is already used by something else, or simply a personal preference for which port the site should answer on.

Two further details carried over from earlier:
- The pipeline service always gets a normal read-write mount, since it's the component writing the database and generated HTML files.
- The web service's mount used to be read-only (`:ro`) in earlier versions of this plan, on the reasoning that the website should only ever read the database and generated files. That still holds for the database: `web/lib/db.ts` opens the SQLite connection with `readonly: true` at the code level regardless of filesystem permissions. But Phase 7 adds an upload page that writes new files into `data/material/`, which needs the web container to have write access to that path. The mount was changed to read-write for that reason; the database itself stays protected by the code-level readonly flag either way.
- `depends_on` only controls startup order, it doesn't guarantee Ollama or the database are already populated by the time the website starts, that's fine since an empty database just renders an empty list rather than crashing.

`NOTION_TOKEN`, `NOTION_DATABASE_ID`, and `STUDY_ARCHIVE_BASE_URL` (Phase 10) are passed into *both* containers here: the pipeline needs them for the scheduled `npm run sync:notion` run (or its systemd timer, see Phase 10), the web container needs them for the on-demand `web/app/api/sync/route.ts`. Both read from the same `.env` file sitting next to `docker-compose.yml`, via Compose's `${VAR}` substitution, unlike `OLLAMA_URL` above, which is still hardcoded directly instead of substituted, an inconsistency carried over from Phase 6 that never got cleaned up once the Notion vars were added following the recommended pattern.

### Starting everything

```bash
cd ~/study-archive
docker build -t study-archive-pipeline:latest .
docker build -t study-archive-web:latest ./web
docker compose up -d
docker compose logs -f
```

Since `docker-compose.yml` no longer has `build:` keys, `docker compose up --build` has nothing to build and Compose will just start whatever the `image:` tags currently point to (or fail to start at all, if they were never built once). Build both images explicitly first, then bring the stack up. A Portainer-managed deployment does the equivalent by building each image separately (or pulling them from wherever they're pushed) before deploying the stack.

From here on, dropping a new file into `data/material/<subject>/` is picked up automatically, gets processed automatically, and shows up on the website automatically, no manual status resets or restarts required. Failed or pending jobs are retried automatically by the worker loop once Ollama is reachable again, that logic was already built in during Phase 2.

### Watch out for:

- **Build context size.** If `docker build` reports transferring hundreds of MB of build context, the `.dockerignore` isn't being picked up, double-check it sits directly next to the relevant `Dockerfile`.
- **Rebuild after code changes, not just restart.** `docker compose restart` reuses the existing image; after editing source files, rerun the two `docker build` commands above and then `docker compose up -d` again to actually pick up the new image.
- **The `bindings.js` / `NODE_MODULE_VERSION` error** almost always traces back to a missing or incomplete `.dockerignore` (or, per the note above, a missing native build toolchain), not a real dependency problem, check both before reinstalling anything.
- Development with hot reload (`npm run dev` inside `web/`) remains useful while actively coding; the containerized build here is for the "just keeps running" production setup.
- **A `.env` file next to `docker-compose.yml`** is what actually supplies `NOTION_TOKEN`, `NOTION_DATABASE_ID`, and `STUDY_ARCHIVE_BASE_URL` via `${VAR}` substitution. `OLLAMA_URL` in the `environment:` block is still hardcoded rather than substituted from `.env`, so changing it means editing `docker-compose.yml` directly, not the `.env` file, that's a known inconsistency, not a mistake to "fix" by adding `${OLLAMA_URL}` without also confirming nothing else depends on the current hardcoded behavior. Likewise, `dotenv` being listed as a dependency doesn't load anything by itself, that only happens if some file explicitly calls `import "dotenv/config"` (used by `src/scripts/notion-sync.ts`, useful for running scripts directly with `npx tsx` outside Docker, where Compose's own `.env` handling doesn't apply).
- **The Ollama setup now lives in its own `ollama-host/` folder** (its `docker-compose.yml` and a dedicated `README.md`) rather than being documented only inline here, see the note at the start of Phase 3. Keep both README files honest about which machine each `docker compose up` command is meant to run on, since a `docker-compose.yml` copied to the wrong machine will fail confusingly (no GPU passthrough on the App Server, no exposed website port on the Ollama Host).

---

## Phase 7: Uploading Documents From the Website

**Goal:** Add new study material through a form in the browser instead of only through the filesystem, without touching the database directly and without breaking the watcher-based pipeline.

**Where:** App Server, `web/app/`

The key idea is to make the upload endpoint do exactly what a manual file copy would do: write a file into `data/material/<subject>/`. Everything downstream (the watcher detecting it, the queue, the worker, the OCR pipeline) stays completely unchanged, the website never talks to the pipeline directly, it only ever touches the shared `data/material` folder.

### `web/app/api/folders/route.ts` (lists existing subjects)

```typescript
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");
const MATERIAL_ROOT = path.join(DATA_ROOT, "material");

export async function GET() {
    if (!fs.existsSync(MATERIAL_ROOT)) {
        return NextResponse.json([]);
    }

    const folders = fs
        .readdirSync(MATERIAL_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

    return NextResponse.json(folders);
}
```

Reads the actual folder names on disk rather than keeping a separate hardcoded list anywhere, so any subject folder created in Phase 1 (or created later through the upload form itself) shows up automatically.

### `web/app/api/upload/route.ts` (receives the file)

```typescript
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");
const MATERIAL_ROOT = path.join(DATA_ROOT, "material");

const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

function sanitizeFolderName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function sanitizeFileName(name: string): string {
    return path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function POST(request: NextRequest) {
    const formData = await request.formData();
    const file = formData.get("file");
    const rawFolder = formData.get("folder");
    const title = formData.get("title");
    const summary = formData.get("summary");
    const notes = formData.get("notes");

    if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file was submitted" }, { status: 400 });
    }

    if (typeof rawFolder !== "string" || !rawFolder.trim()) {
        return NextResponse.json({ error: "No subject was selected" }, { status: 400 });
    }

    const folder = sanitizeFolderName(rawFolder);
    if (!folder) {
        return NextResponse.json({ error: "Invalid subject name" }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return NextResponse.json(
            { error: `File type "${ext}" is not supported (allowed: ${ALLOWED_EXTENSIONS.join(", ")})` },
            { status: 400 }
        );
    }

    const targetDir = path.join(MATERIAL_ROOT, folder);
    fs.mkdirSync(targetDir, { recursive: true });

    let filename = sanitizeFileName(file.name);
    let targetPath = path.join(targetDir, filename);

    if (fs.existsSync(targetPath)) {
        const { name, ext: fileExt } = path.parse(filename);
        filename = `${name}-${Date.now()}${fileExt}`;
        targetPath = path.join(targetDir, filename);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(targetPath, buffer);

    const meta: Record<string, string> = {};
    if (typeof title === "string" && title.trim()) meta.title = title.trim();
    if (typeof summary === "string" && summary.trim()) meta.summary = summary.trim();
    if (typeof notes === "string" && notes.trim()) meta.notes = notes.trim();

    if (Object.keys(meta).length > 0) {
        const metaPath = path.join(targetDir, `.${filename}.meta.json`);
        fs.writeFileSync(metaPath, JSON.stringify(meta));
    }

    return NextResponse.json({ ok: true, folder, filename });
}
```

**`sanitizeFolderName` and `sanitizeFileName` both matter for the same reason:** `path.basename()` strips any directory components a malicious or malformed filename might contain, and the subsequent character whitelist blocks path traversal sequences like `../../etc`. Without this, a crafted folder or file name from the form data could in principle write outside `data/material/`. Everything not in the whitelist is replaced rather than rejected outright, since dropping a scan named with umlauts or spaces is a common, entirely legitimate case, not an attack.

**The extension whitelist mirrors `process-document.ts` from Phase 4** (`.pdf`, `.jpg`, `.jpeg`, `.png`), on purpose: there is no point accepting a file type the pipeline can't process anyway, better to reject it immediately with a clear message than have it sit forever in the `material` folder without ever being picked up cleanly.

**The `title`/`summary`/`notes` sidecar block (Phase 11) is written *after* `fs.writeFileSync(targetPath, buffer)`,** deliberately: it must exist before the watcher's `awaitWriteFinish` fires an `add` event for the real file, but writing it first (before the real file exists) would risk the watcher's own dotfile-ignore pattern racing against a sidecar with nothing to attach to yet. Writing the real file first, then the tiny sidecar right after, keeps the ordering safe in practice since the real file's `stabilityThreshold` (3000ms, Phase 1) gives more than enough headroom for this second, near-instant write to land first.

**Filename collisions** are resolved by appending a timestamp rather than overwriting silently, since `file_path` is `UNIQUE` in the schema (Phase 2) and a silent overwrite of an already-processed file would leave stale data in the database pointing at a file that no longer matches it.

### `web/app/upload/page.tsx` (the form)

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../_context/ToastContext";

// Unique sentinel value so a real subject folder can never accidentally collide
// with the "create new" option (sanitizeFolderName on the server only ever
// produces lowercase a-z0-9- strings, so this dunder value is always safe).
const CREATE_NEW_SENTINEL = "__create_new_subject__";

function capitalize(name: string): string {
    return name.length ? name[0].toUpperCase() + name.slice(1) : name;
}

export default function UploadPage() {
    const [folders, setFolders] = useState<string[]>([]);
    const [selectedFolder, setSelectedFolder] = useState("");
    const [newFolder, setNewFolder] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [title, setTitle] = useState("");
    const [summary, setSummary] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [progress, setProgress] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const { showToast } = useToast();

    useEffect(() => {
        fetch("/api/folders")
            .then((res) => res.json())
            .then((data: string[]) => {
                setFolders(data);
                setSelectedFolder(data.length > 0 ? data[0] : CREATE_NEW_SENTINEL);
            })
            .catch(() => showToast("Could not load subjects.", "toast-error"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function pickFile(f: File | null) {
        setFile(f);
    }

    function handleDrop(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setDragActive(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) pickFile(dropped);
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        const isCreatingNew = selectedFolder === CREATE_NEW_SENTINEL;
        const folder = isCreatingNew ? newFolder.trim() : selectedFolder;

        if (!folder) {
            showToast(isCreatingNew ? "Please enter a name for the new subject." : "Please select a subject.", "toast-error");
            return;
        }
        if (!file) {
            showToast("Please choose a file.", "toast-error");
            return;
        }

        const formData = new FormData();
        formData.append("folder", folder);
        formData.append("file", file);
        if (title.trim()) formData.append("title", title.trim());
        if (summary.trim()) formData.append("summary", summary.trim());
        if (notes.trim()) formData.append("notes", notes.trim());

        setSubmitting(true);
        setProgress(0);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");

        xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
                setProgress(Math.round((event.loaded / event.total) * 100));
            }
        });

        xhr.addEventListener("load", () => {
            setSubmitting(false);
            let data: any = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch {
                /* ignore */
            }

            if (xhr.status < 200 || xhr.status >= 300) {
                showToast(data?.error ?? "Upload failed.", "toast-error");
                return;
            }

            showToast(`"${data.filename}" saved to "${data.folder}"`, "toast-success");
            setFile(null);
            setNewFolder("");
            setTitle("");
            setSummary("");
            setNotes("");
            setSelectedFolder(data.folder);
            setFolders((prev) => (prev.includes(data.folder) ? prev : [...prev, data.folder].sort()));
            if (fileInputRef.current) fileInputRef.current.value = "";
            router.refresh();
        });

        xhr.addEventListener("error", () => {
            setSubmitting(false);
            showToast("Upload failed.", "toast-error");
        });

        xhr.send(formData);
    }

    const isCreatingNew = selectedFolder === CREATE_NEW_SENTINEL;

    return (
        <main>
            <a className="back-link" href="/"><i className="fa-solid fa-arrow-left"></i> Back To Overview</a>
            <h1>Add new document</h1>

            <form onSubmit={handleSubmit}>
                <label>
                    Title <span className="label-optional">(optional, overrides the AI-generated title)</span>
                    <input
                        type="text"
                        placeholder="e.g. Chapter 4 notes"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />
                </label>

                <label>
                    Summary <span className="label-optional">(optional, overrides the AI-generated summary)</span>
                    <textarea
                        placeholder="A short custom summary…"
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        rows={3}
                    />
                </label>

                <label>
                    Notes <span className="label-optional">(optional, your own notes, not AI-generated)</span>
                    <textarea
                        placeholder="Anything you want to remember about this document…"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                    />
                </label>

                <label>
                    Subject
                    <select
                        value={selectedFolder}
                        onChange={(e) => setSelectedFolder(e.target.value)}
                    >
                        <option value={CREATE_NEW_SENTINEL}>+ Create New Subject...</option>
                        {folders.map((folder) => (
                            <option key={folder} value={folder}>
                                {capitalize(folder)}
                            </option>
                        ))}
                    </select>
                </label>

                {isCreatingNew && (
                    <label className="new-subject-field">
                        New subject name
                        <input
                            type="text"
                            placeholder="e.g. Chemistry"
                            value={newFolder}
                            onChange={(e) => setNewFolder(e.target.value)}
                            autoFocus
                        />
                    </label>
                )}

                <label>
                    File (PDF, JPG, PNG)
                    <input
                        ref={fileInputRef}
                        id="file-input"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                        className="sr-only-input"
                    />
                    <div
                        className={`dropzone${dragActive ? " dropzone--active" : ""}${file ? " dropzone--filled" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragActive(true);
                        }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={handleDrop}
                    >
                        {file ? (
                            <>
                                <i className="fa-solid fa-file-circle-check"></i>
                                <span className="dropzone-filename">{file.name}</span>
                                <span className="dropzone-hint">Click or drop to replace</span>
                            </>
                        ) : (
                            <>
                                <i className="fa-solid fa-cloud-arrow-up"></i>
                                <span>Drag & drop a file here, or click to browse</span>
                                <span className="dropzone-hint">PDF, JPG or PNG</span>
                            </>
                        )}
                    </div>
                </label>

                <button type="submit" disabled={submitting}>
                    {submitting ? `Uploading… ${progress}%` : "Upload"}
                </button>

                {submitting && (
                    <div className="upload-progress">
                        <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
                    </div>
                )}
            </form>
        </main>
    );
}
```

> This is already the Phase 11 version (drag-and-drop dropzone, upload progress via `XMLHttpRequest`, the title/summary/notes override fields, the "Create New Subject" sentinel merged into the dropdown, and toasts instead of inline status text) rather than the plain bare-bones form Phase 7 originally shipped. The reasoning for each of those additions is covered where they're actually motivated, in Phase 11.

**Why the subject list comes from `/api/folders` instead of being hardcoded:** the three example subjects from Phase 1 (`math`, `history`, `ethics`) are just a starting point, not a fixed schema. Fetching the real folder list on mount means a subject created through this same form (via "Create New Subject...") shows up as a normal dropdown option the next time the page loads, without editing any code.

**Why "create new subject" ended up as a sentinel option inside the dropdown, not a separate always-visible field (a Phase 11 revision of the original Phase 7 design):** the first version of this form kept them apart, on the reasoning that mixing "pick an existing folder" and "type a new name" into one control would be ambiguous. In practice that meant a second text field sitting there unused on every single upload, for the rare case of adding a subject, worse UX for the common path to slightly simplify the rare one. `CREATE_NEW_SENTINEL` solves the ambiguity a different way: it's a value `sanitizeFolderName()` (Phase 7's upload route) can never produce from real input, so selecting it can never be confused with a real subject, and the extra name field only appears once it's actually needed.

### Update `web/app/page.tsx`

The "+ Add document" entry point sits in `page.tsx`'s header, already shown in full in Phase 5, that file already reflects everything through Phase 11: an icon button (`<i className="fa-solid fa-plus">`) linking to `/upload`, next to the `<SyncButton />` from Phase 10. An earlier revision of this tutorial had it as a plain text link (`<a className="upload-link" href="/upload">+ Add document</a>`); the icon button and the surrounding `page-header`/`page-header-actions` layout came later, alongside the sync button, so the two controls could sit together without crowding the search bar.

### Watch out for:

- **The web container needs write access to `data/material`.** See the updated `docker-compose.yml` in Phase 6, the `:ro` flag was removed from the web service's volume mount for exactly this reason. The database stays protected regardless, since `web/lib/db.ts` opens it with `readonly: true` at the code level, independent of what the filesystem itself allows.
- **The upload route never touches the database.** It only writes a file (and, since Phase 11, an optional sidecar). The watcher (Phase 1) and worker (Phase 2) pick it up exactly like any other manually dropped file, there's no special-cased "uploaded via web" path in the pipeline, which keeps the two systems decoupled.
- **File size limits.** Next.js Route Handlers using `request.formData()` don't impose a low default body size limit the way Server Actions do, but very large scans can still be slow over a mobile connection. The `XMLHttpRequest`-based progress bar (Phase 11) exists for exactly that reason, giving feedback during a slow upload, not because a hard size limit was hit. If uploads of multi-hundred-MB files are ever needed, that would still be the point to add an explicit limit.

---

## Phase 8: Dark Theme & Processing Status

**Goal:** A dark, minimalist visual style across both the overview page and the generated document pages, plus a clear visual indicator for documents that are still in the queue, and a corrected date (upload date, not the model's guessed content date).

**Where:** App Server, `web/app/globals.css`, `web/public/static/document.css`, `web/app/layout.tsx`

### Color system

Three flat layers are used consistently across the whole site:

| Purpose | Color |
|---|---|
| Page background | `#0f0f10` |
| Surface (cards, buttons, list items) | `#1c1c1e` |
| Surface on surface (inputs inside a form, tags inside a card) | `#2c2c2e` |

No gradients, no shadows, borders only where a surface needs to be visually separated from the background behind it (`1px solid #2c2c2e` on top of a `#1c1c1e` surface reads as a subtle outline, not a heavy border).

### `web/app/layout.tsx`

```typescript
import "./globals.css";
import { ToastProvider } from "./_context/ToastContext";
import Toast from "./components/Toast";

export const metadata = {
    title: "Study Archive",
    description: "Local-first study material archive",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <link rel="stylesheet" href="https://static.itsmarian.dev/fonts/font-awesome-v7.2.0/css/all.min.css" />
            </head>
            <body>
                <ToastProvider>
                    <div className="page-shell">
                        {children}
                        <footer className="site-footer">
                            <p>Study Archive by itsmarian</p>
                            <p><a href="https://github.com/itsmarianmc/study-archive" target="_blank" rel="noopener noreferrer"><i className="fa-brands fa-github"></i> View on GitHub</a></p>
                        </footer>
                    </div>
                    <Toast />
                </ToastProvider>
            </body>
        </html>
    );
}
```

Font Awesome is loaded once, globally, self-hosted from `static.itsmarian.dev` rather than a public CDN (see the note in Phase 4), so the clock icon used for in-progress documents (`fa-regular fa-clock`) and every other icon used across the site keep working even if the public internet or a third-party CDN is briefly unreachable, as long as `static.itsmarian.dev` itself stays up. `ToastProvider` (Phase 11) wraps everything so `useToast()` is available from any client component on any page, and `<Toast />` is mounted exactly once here rather than per-page, since it renders whichever single toast is currently active regardless of which page fired it. `page-shell` and `site-footer` (Phase 8's dark theme pass, styled in `globals.css` below) push the small "Study Archive by itsmarian" footer to the bottom of the viewport even on pages with little content, instead of it floating awkwardly right under a short list of documents.

### `web/app/globals.css`

```css
:root,[data-theme=dark] {
    --accent: #e4a10f;
    --bg: #0f0f10;
    --border: #ffffff14;
    --ease: cubic-bezier(.5, 0, 1, .5);
    --radius: 20px;
    --radius-sm: 12px;
    --shadow: 0 8px 32px #0006;
    --surface: #1c1c1e;
    --surface2: #2c2c2e;
    --surface3: #3a3a3c;
    --text: #fff;
    --text-muted: #888;
    --text2: #ffffff8c;
    --text3: #ffffff40
}

* {
    box-sizing: border-box;
    transition: all 0.15s ease;
}

.toast {
    -webkit-backdrop-filter: blur(24px);
    backdrop-filter: blur(24px);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    opacity: 0;
    pointer-events: none;
    white-space: nowrap;
    z-index: 10001;
    background: #2c2c2e40;
    border-radius: 50px;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    transition: all .15s cubic-bezier(.34,1.56,.64,1);
    display: flex;
    position: fixed;
    top: 30px;
    left: 50%;
    transform: translate(-50%) translateY(-40px) scale(.9);
    color: var(--text);
}

.toast.show {
    opacity: 1;
    transform: translate(-50%) translateY(0) scale(1);
}

.toast.toast-success {
    color: #52b472;
    background: #52b47340;
    border: 1px solid #397d4f;
}

.toast.toast-error {
    color: #fff;
    background: #ff453a40;
    border: 1px solid #ff453a;
}

.toast.toast-warning {
    color: #fff;
    background: #e4840f40;
    border: 1px solid #e4840f;
}

body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
}

html, body {
    height: 100%;
}

.page-shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
}

.page-shell > main {
    flex: 1 0 auto;
}

.site-footer {
    flex-shrink: 0;
    padding: 20px;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-muted);
    border-top: 1px solid var(--surface2);
}

.site-footer p {
    margin-block-start: 0.25rem;
    margin-block-end: 0.25rem;
}

.site-footer a {
    color: var(--text-muted);
    text-decoration: none;
}

.site-footer a:hover {
    text-decoration: underline;
}

main {
    max-width: 760px;
    margin: 0 auto;
    padding: 10px 20px 40px;
    transition: all 0.15s ease;
    width: 100%;
}

h1 {
    font-size: 1.8rem;
    margin-bottom: 24px;
}

ul {
    list-style: none;
    margin: 0;
    padding: 0;
}

li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--surface2);
    border-radius: 8px;
    margin-bottom: 10px;
}

li a {
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
}

li a:hover {
    text-decoration: underline;
}

li span {
    color: var(--text-muted);
    font-size: 0.85rem;
}

li.processing a {
    color: var(--text-muted);
    cursor: default;
    display: flex;
    align-items: center;
    gap: 8px;
}

li.processing a:hover {
    text-decoration: none;
}

li.processing i {
    color: var(--accent);
}

.back-link {
    display: inline-block;
    margin-bottom: 16px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.9rem;
}

.back-link:hover {
    text-decoration: underline;
}

.page-header {
    max-width: 760px;
    min-width: 400px;
    margin: 0 auto;
    padding: 40px 20px 0;
    width: 100%;
}

.page-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
}

.page-header-top h1 {
    margin: 0;
}

.page-header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
}

.icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    color: var(--text);
    text-decoration: none;
    background: var(--surface);
    border: 1px solid var(--surface2);
    border-radius: 8px;
    font-size: 1.1rem;
    cursor: pointer;
}

.icon-button:hover {
    background: var(--surface2);
}

form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--surface);
    border: 1px solid var(--surface2);
    border-radius: 8px;
    padding: 24px;
}

form label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.9rem;
    font-weight: 600;
}

form select,
form input[type="text"],
form input[type="file"],
form textarea {
    font: inherit;
    color: var(--text);
    padding: 10px 12px;
    border: 1px solid var(--surface2);
    border-radius: 6px;
    background: var(--surface2);
    resize: vertical;
}

form button {
    font: inherit;
    font-weight: 600;
    padding: 12px 16px;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--surface2);
    color: var(--text);
    cursor: pointer;
}

form button:hover:not(:disabled) {
    background: var(--surface2);
}

form button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.label-optional {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 0.8rem;
}

.new-subject-field {
    animation: field-in 0.2s ease;
}

@keyframes field-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
}

.sr-only-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

.dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
    padding: 32px 16px;
    border: 2px dashed var(--surface2);
    border-radius: 8px;
    background: var(--surface2);
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.dropzone i {
    font-size: 1.6rem;
}

.dropzone:hover {
    border-color: var(--accent, #e4a10f);
    color: var(--text);
}

.dropzone--active {
    border-color: var(--accent, #e4a10f);
    background: var(--surface3);
    color: var(--text);
}

.dropzone--filled {
    border-style: solid;
    border-color: var(--surface3);
    color: var(--text);
}

.dropzone-filename {
    font-weight: 600;
    word-break: break-all;
}

.dropzone-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
}

.upload-progress {
    margin-top: 4px;
    height: 6px;
    border-radius: 999px;
    background: var(--surface2);
    overflow: hidden;
}

.upload-progress-bar {
    height: 100%;
    background: var(--accent, #e4a10f);
    border-radius: 999px;
    transition: width 0.15s ease;
}

.status {
    margin-top: 16px;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 0.9rem;
}

.status.success {
    background: var(--surface3);
    color: #7bc98d;
}

.status.error {
    background: var(--surface3);
    color: #d97b7b;
}

.sync-button {
    padding: 10px;
    background: var(--surface);
    border: 1px solid var(--surface2);
    border-radius: 8px;
    color: var(--text);
    font-size: 1.1rem;
    cursor: pointer;
}

.sync-button:hover:not(:disabled) {
    background: var(--surface2);
}

.sync-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.search-form {
    flex-direction: row;
    padding: 0;
    background: none;
    border: none;
    width: 100%;
    margin-bottom: 24px;
}

.search-input {
    width: 100%;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--surface2);
    border-radius: 8px;
    color: var(--text);
    font-size: 1rem;
}

.search-submit {
    padding: 8px 9px;
    background: var(--surface);
    border: 1px solid var(--surface2);
    border-radius: 8px;
    color: var(--text);
    font-size: 1.25rem;
    cursor: pointer;
}

.folder-group {
    margin-bottom: 20px;
}

.folder-group-list {
    list-style: none;
    margin: 0;
    padding: 12px;
    background: var(--surface);
    border-top: 1px solid var(--surface2);
}

.folder-group-list li:last-child {
    margin-bottom: 0;
}

.folder-group-summary {
    background: var(--surface);
    border: 1px solid var(--surface2);
    border-radius: 8px;
}

.folder-group-collapse {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.folder-group-collapse.open {
    grid-template-rows: 1fr;
}

.folder-group-collapse-inner {
    overflow: hidden;
    min-height: 0;
}

.folder-group-header {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
    padding: 10px 16px;
    transition: background 0.15s ease;
}

.folder-group-header:hover {
    background: var(--surface2);
}

.folder-group-arrow {
    display: inline-flex;
    color: var(--text-muted);
    font-size: 0.75rem;
    transition: transform 0.15s ease;
}

.folder-group-arrow--open {
    transform: rotate(90deg);
}

.folder-group-name {
    flex: 1;
    font-weight: 600;
    font-size: 1.1rem;
    text-transform: capitalize;
}

.folder-group-count {
    color: var(--text-muted);
    font-weight: 400;
    font-size: 0.8rem;
    background: var(--surface2);
    border-radius: 999px;
    padding: 2px 9px;
}

.doc-item {
    justify-content: flex-start;
    gap: 12px;
}

.doc-title {
    white-space: nowrap;
}

.doc-snippet {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-muted);
    font-size: 0.85rem;
}

.doc-highlight {
    background: #5a4a1e;
    color: var(--text);
    padding: 0 2px;
    border-radius: 3px;
}

.doc-date {
    flex-shrink: 0;
    white-space: nowrap;
    margin-left: auto;
}

.no-results {
    color: var(--text-muted);
    font-style: italic;
}

.options-menu {
    min-width: 28px;
    min-height: 28px;
    position: relative;
    left: auto;
    flex-shrink: 0;
}

.options-menu-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
}

.options-menu-trigger:hover {
    background: var(--surface2);
    color: var(--text);
}

.options-menu-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 10;
    min-width: 160px;
    background: var(--surface2);
    border: 1px solid var(--surface3);
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.options-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    padding: 8px 10px;
    border-radius: 5px;
    cursor: pointer;
}

.options-menu-item:hover {
    background: var(--surface3);
}

.options-menu-item--danger {
    color: #d97b7b;
}

@media (max-width: 522px) {
    main {
        padding: 20px 12px;
    }

    .header-elements {
        flex-direction: column;
        align-items: flex-start;
    }

    .upload-link {
        width: 100%;
    }

    .search-form {
        padding: 0;
        border: none !important;
        width: 100%;
    }

    .doc-date {
        display: none;
    }

    .folder-group {
        border-top: 1px solid var(--surface2);
        padding-top: 1rem;
    }

    .folder-group-count {
        margin-top: 4px;
    }

    .doc-title {
        white-space: inherit;
    }

    .options-menu {
        margin-left: auto;
    }
}
```

> This is the final `globals.css`, including additions from later phases beyond the Phase 8 dark theme pass shown here: the `.toast` styles and `.page-shell`/`.site-footer` sticky-footer layout (Phase 11/Phase 8 layout revision), `.page-header`/`.page-header-actions`/`.icon-button`/`.sync-button` for the restructured header with the sync button (Phase 10), and `.dropzone`/`.upload-progress`/`.label-optional`/`.new-subject-field`/`.sr-only-input` for the drag-and-drop upload form (Phase 11). The core dark theme tokens (`--bg`, `--surface`, `--text`, etc.) and the original folder/document list styling described below are unchanged from Phase 8.


**`li.processing`** is the visual state for documents still queued or being handled by the worker (Phase 2). The icon color (`#d9a441`, a muted amber) is the only non-neutral color on the page, deliberately, so an in-progress document stands out against the otherwise monochrome list without needing a badge or animation. The link inside it has no `href` and `cursor: default`, since there's no document page to open yet, only the filename and upload timestamp exist at that stage (see `ProcessingDocumentRow` in Phase 5).

**Form inputs use `#2c2c2e`, one level lighter than the `#1c1c1e` card they sit in**, which is the "surface on surface" rule applied directly: the form itself is a surface on the page background, the inputs inside it are a surface on that surface.

### `web/public/static/document.css`

```css
:root {
    --surface: #121212;
    --surface2: #1c1c1e;
    --surface3: #2c2c2e;
    --border: #3a3a3c;
    --text: #f2f2f2;
    --text2: #9a9a9c;
    --radius-sm: 6px;
    --ease: cubic-bezier(0.4, 0, 0.2, 1);
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--surface);
    color: #f2f2f2;
}

article {
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 20px 80px;
}

header h1 {
    font-size: 1.8rem;
    margin-bottom: 8px;
}

header .meta {
    display: flex;
    gap: 10px;
    color: #9a9a9c;
    font-size: 0.9rem;
    margin-bottom: 12px;
}

header .meta .folder {
    text-transform: capitalize;
    font-weight: 600;
    color: #f2f2f2;
}

ul.tags {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0;
    margin: 0 0 24px;
}

ul.tags li {
    background: var(--surface3);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 0.8rem;
}

section.summary {
    background: var(--surface2);
    border: 1px solid var(--surface3);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 24px;
    font-style: italic;
    color: #c9c9ca;
}

section.notes {
    background: var(--surface2);
    border: 1px solid var(--surface3);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 24px;
}

section.notes h2 {
    font-size: 1rem;
    margin: 0 0 10px;
    color: var(--text2);
}

section.notes textarea {
    width: 100%;
    min-height: 90px;
    resize: vertical;
    background: var(--surface3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    padding: 10px 12px;
    box-sizing: border-box;
    transition: border-color .15s var(--ease);
}

section.notes textarea:focus {
    outline: none;
    border-color: var(--text2);
}

section.notes .option-btn {
    margin-top: 10px;
    color: var(--text2);
    font-family: DM Sans, sans-serif;
    font-size: 14px;
}

.notes-status {
    margin-left: 10px;
    font-size: 0.85rem;
    color: var(--text2);
}

section.content {
    background: var(--surface2);
    border: 1px solid var(--surface3);
    border-radius: 8px;
    padding: 24px;
    line-height: 1.6;
}

section.content p {
    margin: 0 0 1em;
}

.option-btn {
    background: var(--surface3);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    height: 100%;
    margin-top: 1rem;
    transition: all .15s var(--ease);
    padding: 7px 13px;
}

.option-btn a {
    color: var(--text2);
    font-family: DM Sans,sans-serif;
    font-size: 15px;
    font-weight: 500;
    line-height: 1;
    text-decoration: none !important;
}

.footer-notification {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--surface2);
}

.ai-disclaimer {
    padding: 12px 16px;
    font-size: 0.85rem;
    color: var(--text2);
    font-size: 0.75rem;
    border-radius: 8px;
    background: var(--surface3);
    color: #888;
    margin: 0rem;
}
```

This is the stylesheet the generated document pages link to (`{{title}}`'s template in Phase 4, `<link rel="stylesheet" href="/static/document.css">`). The tag pills (`ul.tags li`) use `#2c2c2e`, the same "surface on surface" level as form inputs, since a tag sits visually inside the document card the same way an input sits inside a form.

> `section.notes` and `.notes-status` (styling the Notes section and its inline `<script>`, both from Phase 11) are also already included here, they weren't part of the original Phase 8 dark theme pass, but this is the final file as it exists in the repo.

### The upload-date fix

Two independent changes together fix the "wrong date shown" issue:

1. **`web/lib/db.ts`** (Phase 5) now orders and exposes `detected_at` instead of `doc_date` in both `getDocuments()` and `getProcessingDocuments()`. `detected_at` is set once, by the watcher, at the moment the file first appears on disk (Phase 1/2), it never changes afterward.
2. **`web/app/page.tsx`** (Phase 5) renders `formatUploadDate(doc.detected_at)` for every list item, both the in-progress ones and the finished ones, rather than the model-guessed `doc_date` used in earlier versions of this page.

`doc_date` (Phase 3) still exists in the schema and is still shown on the individual document page itself (Phase 4's `<time datetime="{{docDate}}">`), where "what date is this study material about" is legitimately useful context. It's simply no longer used anywhere the word "upload" applies.

### Watch out for:

- **`li.processing` has no `href` on its `<a>` on purpose.** Adding one pointing at a document page that doesn't exist yet (Phase 4/Phase 5's `[folder]/[id]/route.ts` looks up `status = 'done'` rows only) would produce a 404 the moment someone clicks it while it's still processing.
- **The amber clock color is the only accent color in the whole palette.** Adding more accent colors elsewhere would dilute what it's signaling; if a "failed" state is added later (the schema already resets failed jobs back to `pending` in `markFailed`, Phase 2, so there currently is no separate failed visual state), it should get its own distinct color rather than reusing amber.
- **Font Awesome loads from a public CDN.** For a fully offline-capable homelab setup, the icon font could be self-hosted instead, not necessary at this scale but worth knowing if the Cloudflare Tunnel (Phase 6) is ever unavailable and the site needs to keep working purely on the LAN.

---

## Phase 9: Content Search Highlighting, Subject Grouping & Document Management

**Goal:** Search results show *where* the match was found, not just that it matched. Documents are grouped by subject in collapsible sections instead of one flat list. Titles and subjects can be renamed, documents and whole subjects can be deleted, all from a "…" menu, without touching the filesystem or SQLite by hand.

**Where:** App Server, `web/`

### `web/lib/search.ts`

Pulled out of `page.tsx` (Phase 5) into its own module because it's now needed both server-side (`page.tsx`, filtering) and client-side (`FolderGroup.tsx` below, snippet highlighting), a Server Component can't import from a `"use client"` file's local functions and vice versa, a plain shared module works for both.

```typescript
export function formatUploadDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" });
}

export interface Snippet {
    before: string;
    match: string;
    after: string;
}

export function getContentSnippet(rawText: string, query: string, contextChars = 60): Snippet | null {
    if (!query || !rawText) return null;

    const lowerText = rawText.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return null;

    const start = Math.max(0, index - contextChars);
    const end = Math.min(rawText.length, index + query.length + contextChars);

    let snippetStart = start;
    if (start > 0) {
        const spaceIndex = rawText.indexOf(" ", start);
        if (spaceIndex !== -1 && spaceIndex < index) snippetStart = spaceIndex + 1;
    }
    let snippetEnd = end;
    if (end < rawText.length) {
        const spaceIndex = rawText.lastIndexOf(" ", end);
        if (spaceIndex !== -1 && spaceIndex > index + query.length) snippetEnd = spaceIndex;
    }

    let before = rawText.slice(snippetStart, index).replace(/\s+/g, " ");
    const match = rawText.slice(index, index + query.length);
    let after = rawText.slice(index + query.length, snippetEnd).replace(/\s+/g, " ");

    if (snippetStart > 0) before = "…" + before;
    if (snippetEnd < rawText.length) after = after + "…";

    return { before, match, after };
}
```

**How the snippet is built:** `getContentSnippet` finds the first case-insensitive match of the query inside `raw_text`, then expands ~60 characters in each direction, snapped outward to the nearest word boundary so it doesn't start or end mid-word. Leading/trailing "…" mark where the snippet was cut. It returns `null` when the query only matched the title/tags/summary/date, not the body text, so `FolderGroup` only renders a snippet when there's actually something to show from the content itself.

### `web/app/components/OptionsMenu.tsx`

A small reusable "…" dropdown, used both per-document and per-subject below. Deliberately its own component rather than inlined into `FolderGroup`, both need the exact same open/close-on-outside-click behavior.

```typescript
"use client";

import { useEffect, useRef, useState } from "react";

export interface OptionsMenuItem {
    label: string;
    onClick: () => void;
    danger?: boolean;
}

export default function OptionsMenu({ items }: { items: OptionsMenuItem[] }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="options-menu" ref={ref}>
            <button
                type="button"
                className="options-menu-trigger"
                aria-label="Options"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen((o) => !o);
                }}
            >
                <i className="fa-solid fa-ellipsis"></i>
            </button>

            {open && (
                <div className="options-menu-dropdown">
                    {items.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            className={`options-menu-item${item.danger ? " options-menu-item--danger" : ""}`}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpen(false);
                                item.onClick();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
```

**Why `e.stopPropagation()` everywhere:** the trigger button and each menu item sit inside larger clickable elements (the subject header toggles open/closed on click, see below), without stopping propagation, opening the menu or clicking an item would also toggle the collapse state or follow a link underneath it.

### `web/app/components/FolderGroup.tsx`

Replaces the flat `<ul>` that used to live directly in `page.tsx`. One `FolderGroup` per subject, each with its own open/closed state, its own rename/delete menu, and a nested list of that subject's documents (each with their own rename/delete menu).

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentRow, ProcessingDocumentRow } from "@/lib/db";
import { formatUploadDate, getContentSnippet } from "@/lib/search";
import OptionsMenu from "./OptionsMenu";

interface Props {
    folder: string;
    processing: ProcessingDocumentRow[];
    docs: DocumentRow[];
    query: string;
}

export default function FolderGroup({ folder, processing, docs, query }: Props) {
    const [open, setOpen] = useState(true);
    const router = useRouter();
    const total = processing.length + docs.length;

    async function renameDocument(id: number, currentTitle: string) {
        const newTitle = window.prompt("New name for the document:", currentTitle);
        if (!newTitle || !newTitle.trim() || newTitle.trim() === currentTitle) return;

        const res = await fetch(`/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newTitle.trim() }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            window.alert(data?.error ?? "Rename failed.");
            return;
        }
        router.refresh();
    }

    async function deleteDocument(id: number, label: string) {
        if (!window.confirm(`Really delete "${label}"? This also removes the original file.`)) return;

        const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            window.alert(data?.error ?? "Delete failed.");
            return;
        }
        router.refresh();
    }

    async function renameFolder() {
        const newName = window.prompt("New name for the subject:", folder);
        if (!newName || !newName.trim() || newName.trim() === folder) return;

        const res = await fetch(`/api/folders/${folder}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName.trim() }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            window.alert(data?.error ?? "Rename failed.");
            return;
        }
        router.refresh();
    }

    async function deleteFolder() {
        if (
            !window.confirm(
                `Really delete subject "${folder}" with all ${total} documents? This also removes all original files.`
            )
        )
            return;

        const res = await fetch(`/api/folders/${folder}`, { method: "DELETE" });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            window.alert(data?.error ?? "Delete failed.");
            return;
        }
        router.refresh();
    }

    return (
        <div className="folder-group">
            <div className="folder-group-summary">
                <div
                    className="folder-group-header"
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpen((o) => !o)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpen((o) => !o);
                        }
                    }}
                >
                    <span className={`folder-group-arrow${open ? " folder-group-arrow--open" : ""}`}>
                        <i className="fa-solid fa-chevron-right"></i>
                    </span>
                    <span className="folder-group-name">{folder}</span>
                    <span className="folder-group-count">{total}</span>
                    <OptionsMenu
                        items={[
                            { label: "Rename subject", onClick: renameFolder },
                            { label: "Delete subject", onClick: deleteFolder, danger: true },
                        ]}
                    />
                </div>

                {open && (
                    <ul className="folder-group-list">
                        {processing.map((doc) => (
                            <li key={`processing-${doc.id}`} className="processing doc-item">
                                <a className="doc-title">
                                    <i className="fa-regular fa-clock"></i> {doc.filename}
                                </a>
                                <span className="doc-date">{formatUploadDate(doc.detected_at)}</span>
                                <OptionsMenu
                                    items={[
                                        {
                                            label: "Delete",
                                            onClick: () => deleteDocument(doc.id, doc.filename),
                                            danger: true,
                                        },
                                    ]}
                                />
                            </li>
                        ))}
                        {docs.map((doc) => {
                            const snippet = query ? getContentSnippet(doc.raw_text, query) : null;
                            return (
                                <li key={doc.id} className="doc-item">
                                    <a href={`/${doc.folder}/${doc.id}`} className="doc-title">
                                        {doc.title}
                                    </a>
                                    {snippet && (
                                        <span className="doc-snippet">
                                            {snippet.before}
                                            <mark className="doc-highlight">{snippet.match}</mark>
                                            {snippet.after}
                                        </span>
                                    )}
                                    <span className="doc-date">{formatUploadDate(doc.detected_at)}</span>
                                    <OptionsMenu
                                        items={[
                                            { label: "Rename", onClick: () => renameDocument(doc.id, doc.title) },
                                            {
                                                label: "Delete",
                                                onClick: () => deleteDocument(doc.id, doc.title),
                                                danger: true,
                                            },
                                        ]}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
```

**Why this is a Client Component (`"use client"`) while `page.tsx` stays a Server Component:** the collapse toggle (`useState`) and the rename/delete `fetch()` calls both need to run in the browser. `page.tsx` still does all the data fetching and grouping server-side (Phase 5), then passes plain serializable props (`folder`, `processing`, `docs`, `query`) down into this component, the usual Server-Component-fetches / Client-Component-interacts split.

**Structure, deliberately nested this way:**

```
folder-group
└── folder-group-summary        (bordered card, the whole clickable unit)
    ├── folder-group-header     (arrow, name, count, subject options menu - click toggles open)
    └── folder-group-list       (only rendered while open, one <li> per document)
```

`folder-group-list` sits *inside* `folder-group-summary`, not next to it, so the whole card (header + list) reads as one visual unit rather than a floating header with an unrelated list underneath.

**Why the native `<details>`/`<summary>` elements were rejected in favor of a plain `<div>` + `useState`:** `<details>`'s built-in disclosure triangle is a `::marker`/`::-webkit-details-marker` pseudo-element that renders inconsistently across browsers and is hard to restyle cleanly. A controlled `open` boolean with a normal `<div role="button">` gives full control over the arrow icon (a rotating Font Awesome chevron here) and lets a options menu sit in the same header row without fighting the native widget's own click targets.

**Why delete confirmation uses `window.confirm`/`window.prompt` instead of a custom modal:** keeps the amount of new UI surface small, both are fine for a single-user local tool. Swap in a proper dialog component later if this ever gets multi-user.

### `web/app/api/documents/[id]/route.ts` (rename & delete a single document)

```typescript
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAnyDocumentById, renameDocument, deleteDocumentRow } from "@/lib/db";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const docId = Number(id);

    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";

    if (!title) {
        return NextResponse.json({ error: "Title must not be empty" }, { status: 400 });
    }

    const doc = getAnyDocumentById(docId);
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    renameDocument(docId, title);
    return NextResponse.json({ ok: true, title });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const docId = Number(id);

    const doc = getAnyDocumentById(docId);
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    deleteDocumentRow(docId);

    if (doc.file_path && fs.existsSync(doc.file_path)) {
        fs.unlinkSync(doc.file_path);
    }
    if (doc.html_path) {
        const absoluteHtmlPath = path.join(DATA_ROOT, doc.html_path);
        if (fs.existsSync(absoluteHtmlPath)) fs.unlinkSync(absoluteHtmlPath);
    }

    return NextResponse.json({ ok: true });
}
```

### `web/app/api/folders/[folder]/route.ts` (rename & delete a whole subject)

```typescript
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAllDocumentsByFolder, updateDocumentFolderAndPaths, deleteFolderRows } from "@/lib/db";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");
const MATERIAL_ROOT = path.join(DATA_ROOT, "material");
const GENERATED_ROOT = path.join(DATA_ROOT, "generated");

function sanitizeFolderName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ folder: string }> }) {
    const { folder: oldFolder } = await params;

    const body = await request.json().catch(() => null);
    const newFolder = sanitizeFolderName(typeof body?.name === "string" ? body.name : "");

    if (!newFolder) {
        return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
    }
    if (newFolder === oldFolder) {
        return NextResponse.json({ ok: true, folder: newFolder });
    }

    const oldMaterialDir = path.join(MATERIAL_ROOT, oldFolder);
    const newMaterialDir = path.join(MATERIAL_ROOT, newFolder);

    if (fs.existsSync(newMaterialDir)) {
        return NextResponse.json({ error: "A folder with this name already exists" }, { status: 409 });
    }

    if (fs.existsSync(oldMaterialDir)) {
        fs.renameSync(oldMaterialDir, newMaterialDir);
    }

    const oldGeneratedDir = path.join(GENERATED_ROOT, oldFolder);
    const newGeneratedDir = path.join(GENERATED_ROOT, newFolder);
    if (fs.existsSync(oldGeneratedDir)) {
        fs.renameSync(oldGeneratedDir, newGeneratedDir);
    }

    const docs = getAllDocumentsByFolder(oldFolder);
    for (const doc of docs) {
        const newFilePath = doc.file_path.replace(oldMaterialDir, newMaterialDir);
        const newHtmlPath = doc.html_path ? doc.html_path.replace(`/${oldFolder}/`, `/${newFolder}/`) : doc.html_path;
        updateDocumentFolderAndPaths(doc.id, newFolder, newFilePath, newHtmlPath);
    }

    return NextResponse.json({ ok: true, folder: newFolder });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ folder: string }> }) {
    const { folder } = await params;

    deleteFolderRows(folder);

    const materialDir = path.join(MATERIAL_ROOT, folder);
    if (fs.existsSync(materialDir)) fs.rmSync(materialDir, { recursive: true, force: true });

    const generatedDir = path.join(GENERATED_ROOT, folder);
    if (fs.existsSync(generatedDir)) fs.rmSync(generatedDir, { recursive: true, force: true });

    return NextResponse.json({ ok: true });
}
```

**Why folder rename moves directories first, then updates the database:** `data/material/<folder>` and `data/generated/<folder>` are renamed on disk with `fs.renameSync` before any row is touched, using `getAllDocumentsByFolder` (not the readonly `getDocuments`, which filters to `status = 'done'`) to also catch documents still `pending`/`processing`, their `file_path` still needs to follow the moved directory even though they don't have an `html_path` yet. Each row's `file_path` and `html_path` are then rewritten by substituting the old directory/segment for the new one, not regenerated from scratch, so no data is lost if a path had unexpected characters.

**Why folder rename checks `fs.existsSync(newMaterialDir)` before doing anything:** without this guard, renaming into an existing subject's folder would silently merge files (some overwritten, most just orphaned in the DB with stale paths). A `409 Conflict` forces the person to pick a name that doesn't collide instead.

**Why document delete removes files, not just the database row:** the DB row is only ever a pointer to `file_path` (original upload) and `html_path` (generated page), see `data/study-archive.db` in Phase 2. Deleting only the row would leave orphaned files on disk that the watcher (Phase 1) would never touch again (they already exist, so no `add` event fires) and that would just sit there forever.

### Updating `web/lib/db.ts`: a second, writable database connection

Phase 5 deliberately opened the frontend's database connection as `{ readonly: true }`, "so the frontend can never accidentally write to the database, that stays strictly the pipeline's job." Rename/delete break that assumption on purpose, the frontend now needs to write. Rather than loosening the existing connection, `db.ts` gets a **second** connection, `getWritableDb()`, used only by the four new mutation functions (`renameDocument`, `deleteDocumentRow`, `updateDocumentFolderAndPaths`, `deleteFolderRows`). Every read path (`getDocuments`, `getProcessingDocuments`, `getDocumentById`, ...) still goes through the original readonly `getDb()`, so a bug in a page that only ever reads still can't write, only the four functions that are explicitly about mutation can.

`DocumentRow` also gained a `file_path` field here, needed so the delete route knows which original file to remove from `data/material/`.

### Watch out for:

- **Container rebuild required for new routes.** `web/Dockerfile` (Phase 6) is a multi-stage build ending in `.next/standalone`, new route files (`api/documents/[id]/route.ts`, `api/folders/[folder]/route.ts`) get compiled into that standalone output at build time. A plain `docker compose restart` or Portainer stack redeploy without rebuilding the image first will keep 404ing on the new endpoints, `next build` has to actually run again.
- **Route folder names need the literal brackets.** `[id]` and `[folder]` are directory names, not placeholders to fill in, Next.js's file-based routing depends on the exact `app/api/documents/[id]/route.ts` path.
- **`OptionsMenu` items call `e.stopPropagation()`**, but the *trigger* button itself also needs it (see above), forgetting it on either one reintroduces the "clicking the menu also toggles the subject collapsed" bug.
- **No auth on the mutation routes.** This whole project already assumes a trusted local network + Cloudflare Access in front of it (Phase 5), same assumption carries over here, anyone who can reach `/api/documents/*` or `/api/folders/*` can rename or delete. Fine for a single-user local archive, would need real auth before exposing this more broadly.
- **Double-check which `route.ts` ended up where.** `documents/[id]/route.ts` and `folders/[folder]/route.ts` are similar enough (same PATCH/DELETE shape, same error-response pattern) that copy-pasting one into the other's file is an easy mistake. Symptom: renaming a *folder* fails with `"Title must not be empty"`, that string only exists in the documents route, so seeing it from a `/api/folders/...` call means the wrong file's content landed in that route folder. Fix is just re-checking the file contents match the path it's in (`folders/[folder]/route.ts` should reference `sanitizeFolderName`/`MATERIAL_ROOT`, never `title`).

---

## Phase 10: Optional Notion Sync

**Goal:** Mirror every document into a Notion database as a one-way sync, so the archive is linkable from wherever notes are already being taken, without turning Notion into a second source of truth.

**Where:** App Server, `src/scripts/` (scheduled sync) and `web/app/api/sync/` (manual sync button)

### Notion-side setup

1. Create an internal integration at [notion.so/my-integrations](https://www.notion.so/my-integrations), copy its secret.
2. Create a database with these properties, and share it with the integration (database → `•••` → Connections):

| Property | Type | Purpose |
|---|---|---|
| Titel | Title | Document title (AI-generated, or the manual override from Phase 11) |
| Typ | Select | Derived from file extension (PDF / Scan / Document) |
| Subject | Select | The subject/folder the document lives in |
| Tags | Multi-select | AI-generated tags |
| URL | URL | Link back to the document's page on the website |
| Processed | Checkbox | Whether the AI pipeline has finished this document yet |
| Notes | Text | The manual notes field from Phase 11, independent of the AI content |
| Archive ID | Text | The document's row ID, used to avoid duplicate pages on repeated syncs |
| Last Synced | Date | Timestamp of the most recent successful sync |

3. Copy the database ID out of its URL (the 32-character segment right before `?v=`).

### `src/scripts/notion-sync.ts`

```typescript
import "dotenv/config";
import { Client } from "@notionhq/client";
import Database from "better-sqlite3";
import path from "path";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const BASE_URL = process.env.STUDY_ARCHIVE_BASE_URL ?? "http://localhost:1920";

if (!NOTION_TOKEN || !DATABASE_ID) {
    console.error("NOTION_TOKEN and NOTION_DATABASE_ID must be set.");
    process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const DB_PATH = path.resolve(__dirname, "../../data/study-archive.db");
const db = new Database(DB_PATH, { readonly: true });

interface DocRow {
    id: number;
    folder: string;
    filename: string;
    title: string | null;
    tags: string | null;
    status: string;
    notes: string | null;
}

function getDocType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "PDF";
    if (["jpg", "jpeg", "png", "heic"].includes(ext)) return "Scan";
    return "Document";
}

async function findExistingPage(archiveId: string) {
    const res = await notion.databases.query({
        database_id: DATABASE_ID!,
        filter: { property: "Archive ID", rich_text: { equals: archiveId } },
    });
    return res.results[0] ?? null;
}

async function syncDocument(doc: DocRow) {
    const archiveId = String(doc.id);
    const isProcessed = doc.status === "done";
    const tags: string[] = isProcessed && doc.tags ? JSON.parse(doc.tags) : [];
    const url = `${BASE_URL}/${doc.folder}/${doc.id}`;
    // While a document is still queued: filename as a placeholder title.
    // Once processed: the real, AI-generated (or manually overridden) title.
    const title = isProcessed ? (doc.title?.trim() || doc.filename) : doc.filename;

    const properties = {
        Titel: { title: [{ text: { content: title } }] },
        Typ: { select: { name: getDocType(doc.filename) } },
        Subject: { select: { name: doc.folder } },
        Tags: { multi_select: tags.map((t) => ({ name: t })) },
        URL: { url },
        Processed: { checkbox: isProcessed },
        Notes: { rich_text: doc.notes ? [{ text: { content: doc.notes.slice(0, 2000) } }] : [] },
        "Archive ID": { rich_text: [{ text: { content: archiveId } }] },
        "Last Synced": { date: { start: new Date().toISOString() } },
    };

    const existing = await findExistingPage(archiveId);
    if (existing) {
        await notion.pages.update({ page_id: existing.id, properties });
    } else {
        await notion.pages.create({ parent: { database_id: DATABASE_ID! }, properties });
    }
}

async function main() {
    // Every document syncs regardless of status, so a freshly uploaded file
    // shows up immediately (Processed unchecked) instead of only once it's done.
    const docs = db.prepare(`SELECT id, folder, filename, title, tags, status, notes FROM documents`).all() as DocRow[];
    for (const doc of docs) {
        try {
            await syncDocument(doc);
        } catch (err) {
            console.error(`Sync failed for ${doc.filename}:`, err);
        }
    }
}

main();
```

### Two ways to run it

**On a schedule**, so the archive stays in sync without anyone remembering to trigger it. A systemd timer works well here (see `deploy/` in the repo for ready-to-use unit files), running every 30 minutes is plenty since Notion isn't needed in real time:

```bash
npm run sync:notion
```

**On demand**, via a sync button in the dashboard header. This calls a matching API route (`web/app/api/sync/route.ts`) that runs the exact same logic directly inside the web container, so a manual sync doesn't need shell access to the server at all.

### `web/app/api/sync/route.ts`

```typescript
import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";
import { getAllDocuments } from "@/lib/db";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const BASE_URL = process.env.STUDY_ARCHIVE_BASE_URL ?? "http://localhost:1920";

function getDocType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "PDF";
    if (["jpg", "jpeg", "png", "heic"].includes(ext)) return "Scan";
    return "Dokument";
}

async function findExistingPage(notion: Client, archiveId: string) {
    const res = await notion.databases.query({
        database_id: DATABASE_ID!,
        filter: {
            property: "Archive ID",
            rich_text: { equals: archiveId },
        },
    });
    return res.results[0] ?? null;
}

export async function POST() {
    if (!NOTION_TOKEN || !DATABASE_ID) {
        return NextResponse.json(
            { error: "NOTION_TOKEN oder NOTION_DATABASE_ID fehlt in der Umgebung." },
            { status: 500 }
        );
    }

    const notion = new Client({ auth: NOTION_TOKEN });
    const docs = getAllDocuments();

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const doc of docs) {
        try {
            const archiveId = String(doc.id);
            const isProcessed = doc.status === "done";
            const tags: string[] = isProcessed && doc.tags ? JSON.parse(doc.tags) : [];
            const url = `${BASE_URL}/${doc.folder}/${doc.id}`;
            // Solange nicht fertig verarbeitet: Dateiname als Platzhalter-Titel.
            // Nach Verarbeitung: echter, von Ollama generierter Titel + Tags.
            const title = isProcessed ? (doc.title?.trim() || doc.filename) : doc.filename;

            const properties = {
                Titel: { title: [{ text: { content: title } }] },
                Typ: { select: { name: getDocType(doc.filename) } },
                Subject: { select: { name: doc.folder } },
                Tags: { multi_select: tags.map((t) => ({ name: t })) },
                URL: { url },
                Processed: { checkbox: isProcessed },
                Notes: { rich_text: doc.notes ? [{ text: { content: doc.notes.slice(0, 2000) } }] : [] },
                "Archive ID": { rich_text: [{ text: { content: archiveId } }] },
                "Last Synced": { date: { start: new Date().toISOString() } },
            };

            const existing = await findExistingPage(notion, archiveId);

            if (existing) {
                await notion.pages.update({ page_id: existing.id, properties });
                updated++;
            } else {
                await notion.pages.create({ parent: { database_id: DATABASE_ID }, properties });
                created++;
            }
        } catch (err) {
            errors.push(`${doc.filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return NextResponse.json({
        total: docs.length,
        created,
        updated,
        errors,
    });
}
```

This is a near-duplicate of `syncDocument`/`buildProperties` from `notion-sync.ts`, deliberately, rather than importing the script from the API route. Route handlers run inside the Next.js server runtime; `notion-sync.ts` is meant to run standalone under `tsx` or as a systemd timer, sharing code between the two would mean either bundling the script's dependencies into the web build or adding an internal HTTP hop for no real benefit at this scale. The response reports `created`/`updated`/`errors` counts (rather than exiting the process on failure like the script does), since `SyncButton` needs something to show the person as a toast.

### `web/app/components/SyncButton.tsx`

```typescript
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
```

A spinning sync icon while `loading`, a toast with the created/updated/error counts on completion (see Phase 11 for the toast system itself), and `router.refresh()` so the page's server-rendered data picks up anything Notion-side that could plausibly have looped back (it doesn't, this is one-way, but refreshing is cheap and keeps the UI honest about "sync just ran").

### Watch out for:

- **Dedup relies entirely on the "Archive ID" property.** If it's ever deleted or renamed in Notion, every subsequent sync will create duplicate pages instead of updating existing ones.
- **Select vs. Multi-select matters.** `Subject` and `Typ` must be created as **Select**, not **Multi-select** - Notion's API rejects a `select` payload against a `multi_select` property (and vice versa) with a fairly opaque error message.
- **Rich text has a length limit.** Notes longer than 2000 characters are truncated before syncing; Notion's rich_text blocks have their own limits per API call.
- **The API route and the script duplicate `buildProperties`/`getDocType` logic.** A change to the Notion property mapping (a renamed column, a new field) needs to be applied in both `src/scripts/notion-sync.ts` and `web/app/api/sync/route.ts`, they will silently drift apart otherwise.

---

## Phase 11: Manual Overrides, Notes, and Upload UX

**Goal:** Let a person correct or add to what the AI generates, independently of it, and make the upload flow itself feel less like a bare HTML form.

**Where:** App Server, spanning `src/db/`, `src/watcher/`, `web/app/upload/`, `web/app/components/`

### Optional title/summary overrides and a separate Notes field

Three new columns on `documents`: `user_title`, `user_summary`, `notes`. The first two override the AI-generated title/summary once processing finishes; `notes` is never touched by the AI pipeline at all, purely a place for the person's own remarks.

Since a document's database row doesn't exist yet at the moment of upload (the watcher creates it), any overrides typed into the upload form are written to a small **sidecar file** next to the uploaded document - `.filename.meta.json`, hidden so the watcher's own ignore pattern (`/(^|[/\\])\./`) skips it as a source file. The watcher reads it, if present, the moment it detects the real file, folds the values into the same `enqueueFile()` call, and deletes the sidecar (see the full updated `src/watcher/index.ts` in Phase 1, this is the same code, shown here again for context):

```typescript
// inside the watcher's "add" handler
const metaPath = sidecarPath(filePath); // .${filename}.meta.json, next to the real file
if (fs.existsSync(metaPath)) {
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        userTitle = typeof meta.title === "string" ? meta.title : undefined;
        userSummary = typeof meta.summary === "string" ? meta.summary : undefined;
        notes = typeof meta.notes === "string" ? meta.notes : undefined;
    } catch (err) {
        console.error(`[watcher] failed to read sidecar meta for ${filename}:`, err);
    } finally {
        fs.unlinkSync(metaPath); // always remove it, even if it failed to parse
    }
}
```

The `try/catch/finally` matters here specifically: a half-written or malformed sidecar (e.g. the upload route crashed after creating it but before finishing the JSON) should never permanently block the real file from being enqueued, and it should never leave the sidecar sitting around to be picked up again on a future watcher restart. `enqueueFile()`'s signature also grows to accept the optional `userTitle`/`userSummary`/`notes` fields shown here (see Phase 2's updated `src/db/queue.ts`).

`markDone()` then prefers the override over the AI value if one was provided:

```sql
title = COALESCE(NULLIF(user_title, ''), @title),
summary = COALESCE(NULLIF(user_summary, ''), @summary)
```

Notes are independent of processing entirely and editable any time, both from the upload form and later directly on a document's own page (a small fetch-based textarea, since the generated page is static HTML rather than a live React component).

### Subject dropdown: creating a new subject inline

Rather than a separate always-visible "new subject" text field, the dropdown itself gets a `+ Create New Subject...` option using a sentinel value that can never collide with a real, sanitized folder name:

```typescript
const CREATE_NEW_SENTINEL = "__create_new_subject__";
```

Selecting it reveals a second input for the new name; selecting an existing subject hides that input again. Existing subjects are shown capitalized in the dropdown for readability, the underlying folder name on disk stays lowercase and unchanged.

### Drag-and-drop upload with progress

The native `<input type="file">` is visually hidden (not `display: none`, which breaks keyboard accessibility, but the usual screen-reader-only clipping technique) and replaced with a dashed-border dropzone that accepts both click-to-browse and drag-and-drop.

Upload progress needs `XMLHttpRequest` rather than `fetch`, since `fetch` doesn't expose upload progress events:

```typescript
const xhr = new XMLHttpRequest();
xhr.open("POST", "/api/upload");
xhr.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
    }
});
xhr.send(formData);
```

### A shared toast system

Success/error feedback (upload results, sync results) shows as a small toast notification instead of inline status text that pushes layout around. A simple React Context (`ToastContext`) holds a queue of pending toasts; a single `<Toast />` component, mounted once in the root layout, renders whichever one is currently active.

### `web/app/_context/ToastContext.tsx`

```typescript
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
```

### `web/app/components/Toast.tsx`

```typescript
"use client";

import { useEffect, useState } from "react";
import { useToast } from "../_context/ToastContext";

export default function Toast() {
    const { toastQueue, consumeToast } = useToast();
    const [visible, setVisible] = useState(false);
    const [current, setCurrent] = useState<{ msg: string; cls?: string } | null>(null);

    useEffect(() => {
        if (toastQueue.length === 0) return;
        const item = toastQueue[0];
        setCurrent({ msg: item.msg, cls: item.cls });
        setVisible(true);
        const t = setTimeout(() => {
            setVisible(false);
            setTimeout(() => {
                setCurrent(null);
                consumeToast();
            }, 300);
        }, item.duration || 2500);
        return () => clearTimeout(t);
    }, [toastQueue, consumeToast]);

    if (!current) return (
        <div id="toast" className="toast" style={{ display: "none", visibility: "hidden" }} />
    );

    return (
        <div id="toast" className={`toast${visible ? " show" : ""}${current.cls ? " " + current.cls : ""}`}>
            {current.msg}
        </div>
    );
}
```

`showToast()` only ever appends to the queue, it's `<Toast />`'s own `useEffect` that pulls the front item, shows it, waits `duration` (2.5s default), fades it out, then calls `consumeToast()` to advance to the next one, so toasts fired in quick succession (e.g. several validation errors) queue up and play one at a time instead of overlapping or replacing each other. `<Toast />` is mounted once in `layout.tsx` (below), and any client component wraps its own logic in `useToast()` to fire one, `SyncButton` and the upload form (Phase 11) both do this instead of managing their own local status text.

### Watch out for:

- **The sidecar file must be written *after* the real file finishes uploading**, and its filename must exactly match (including any `-<timestamp>` suffix appended on a name collision), otherwise the watcher never finds it and the overrides are silently lost.
- **The sentinel value must stay outside the range `sanitizeFolderName()` can ever produce.** Since that function only ever outputs lowercase `a-z0-9-` strings, a value containing underscores and a double-leading-underscore is guaranteed safe, but changing the sanitizer later without re-checking this assumption could theoretically create a collision.
- **`XMLHttpRequest` progress events fire based on bytes sent, not bytes processed.** A 100% progress bar means the upload finished, not that OCR/processing has, that distinction is what the "still processing" indicator (Phase 8) is for.

---

## Build Order

1. Get the watcher running, first just logging to the console instead of the database (Phase 1)
2. Create the SQLite schema, connect the watcher to the queue (Phase 2)
3. Set up `ollama-host/` on the GPU machine, make Ollama reachable on the LAN, verify with `curl` from the App Server (Phase 3, networking part)
4. Run real handwriting test pages through `qwen3.5:9b-q8_0`, evaluate the error rate (Phase 3, model test)
5. Build the worker loop with retry logic, run one test file through the full pipeline end to end (Phases 2+3 combined)
6. Build the HTML template and generator (Phase 4)
7. Build the Next.js frontend for display (Phase 5)
8. Containerize both the pipeline and the website, wire them into one `docker-compose.yml` (Phase 6)
9. Put a Cloudflare Tunnel and Cloudflare Access in front of the website
10. Add the browser upload page and its API routes, adjust the web container's volume mount to allow writes (Phase 7)
11. Apply the dark theme, add the in-progress indicator, and switch the displayed date from the model-guessed `doc_date` to the real `detected_at`, on both the website and the generated document pages (Phase 8)
12. Add server-rendered search across title, tags, summary, full text, and upload date, and its matching `/api/documents` endpoint (Phase 5 addendum)
13. Keep `src/scripts/regenerate-html.ts` handy for any future template or styling change, so existing documents don't need reprocessing through Ollama to pick it up (Phase 4 addendum)
14. Detect PDFs with an unusable text layer (broken font embedding) and fall back to rasterizing the page + vision OCR instead of silently saving garbage (Phase 4 addendum)
15. Group documents by subject into collapsible sections, highlight the matched snippet in search results, and add rename/delete for both documents and whole subjects via a "…" menu (Phase 9)
16. Set up a Notion database and internal integration, add the sync script and a matching API route/button for on-demand syncing (Phase 10)
17. Add optional title/summary overrides and a manual Notes field via a sidecar file mechanism, an inline "create new subject" flow, a drag-and-drop dropzone with real upload progress, and a shared toast notification system (Phase 11)