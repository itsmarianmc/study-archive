# Study Archive

<p>
  <a href="https://github.com/itsmarianmc/study-archive">
    <img alt="GitHub" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/compact/available/github_vector.svg">
  </a>
  &nbsp;
  <a href="https://ko-fi.com/itsmarian">
    <img alt="kofi-singular" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/donate/kofi-singular_vector.svg">
  </a>
  &nbsp;
  <a href="https://github.com/itsmarianmc/study-archive/blob/main/TUTORIAL.md">
    <img alt="generic" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/documentation/generic_vector.svg">
  </a>
</p>

A self-hosted pipeline that turns scanned notes and PDFs into a searchable, browsable study archive in a simple, clean and minimalistic design. Drop a file into a folder (or upload it through the browser), and it gets OCR'd, summarized, tagged, and rendered as a clean static page automatically - no manual data entry, no cloud AI, your files never leave your network.
Additionally supports a one-way sync to Notion, so your archive can be linkable from wherever you already take notes.

> **Building this yourself?** This README covers what the project does and how to run it. For the full annotated build walkthrough - every file, every decision, and the reasoning behind it, phase by phase - see [`TUTORIAL.md`](./TUTORIAL.md).

## How it works

The project is split into two pieces that talk to each other over HTTP:

```
┌───────────────────────────────┐
│  App Server                   │
│  - File watcher (chokidar)    │
│  - SQLite (queue + metadata)  │
│  - Next.js website            │
└──────────────┬────────────────┘
               │ HTTP (same machine, LAN, or VPN)
               ▼
┌───────────────────────────────┐
│  Ollama Host                  │
│  - Ollama (vision + text LLM) │
└───────────────────────────────┘
```

- **App Server** - runs the file watcher, the processing queue, and the Next.js website. This is the always-on part.
- **Ollama Host** - runs the actual models. It can be the exact same machine as the App Server, a second machine on your LAN, or anything reachable over a VPN like Tailscale - the app only needs a URL and a port.

You only need one machine to run this. Splitting the two apart just lets you put a GPU-heavy model on beefier hardware while the lightweight app stays on something small and always-on. Everything keeps working if the Ollama Host is turned off or unreachable: new uploads simply queue up as `pending` and get processed automatically once it's back.

### What happens when you add a document

1. A file lands in `data/material/<subject>/`, either dropped there directly or uploaded through the browser.
2. A file watcher detects it and adds it to a SQLite-backed queue.
3. A worker loop picks it up, extracts text (PDF text layer, or vision-model OCR for images), and asks a local LLM to generate a title, tags, a summary, and a topic date.
4. A static HTML page is generated for the document.
5. The website lists every document, live status included, and lets you open the generated page for any finished one.

Everything keeps working if the GPU machine is turned off: new uploads simply queue up as `pending` and get processed automatically once Ollama is reachable again.

## Features

- **Automatic ingestion** - a file watcher picks up new documents the moment they appear on disk, no manual trigger needed.
- **OCR for scans and photos** - handwritten or printed pages are transcribed through a local vision model, with an automatic fallback to rasterize-and-OCR for PDFs whose text layer turns out to be broken or unusable.
- **PDF text extraction** - PDFs with a real text layer skip OCR entirely and are parsed directly.
- **AI-generated metadata** - title, subject tags, a short summary, and a topic date are generated per document, with a prompt tuned to avoid confusing example content inside a document for its actual topic.
- **Static page per document** - each processed file becomes a clean, linkable HTML page using a fixed template, not model-generated markup. A regeneration script lets you re-render every existing page after a template/styling change, without sending anything back through Ollama.
- **Offline-tolerant queue** - if the machine running Ollama is off, documents stay queued and are retried automatically once it's back, no manual intervention required.
- **Browser upload** - add new documents and even new subjects directly from the website, without touching the filesystem.
- **Live processing status** - documents still in the queue show up in the UI immediately, distinct from finished ones, and the real detection date is shown rather than the model-guessed topic date.
- **Search** - server-rendered search across title, tags, summary, full text, and upload date, with the matching snippet highlighted in results.
- **Manage documents & subjects** - rename or delete individual documents or whole subject folders from a "…" menu; this cleans up both the database rows and the underlying files on disk.
- **Dark theme** - the whole site, including generated document pages, uses a dark UI.
- **Fully containerized** - both the processing pipeline and the website run as Docker services with `restart: unless-stopped`, surviving reboots without manual restarts.
- **Remote access** - sits behind a Cloudflare Tunnel with Cloudflare Access in front, so the site can be reached from outside the LAN without exposing it directly.

## Tech stack

| Component | Technology |
|---|---|
| File watching | chokidar |
| Queue & metadata storage | SQLite (via `better-sqlite3`) |
| PDF text extraction | `pdf-parse` |
| Vision OCR & text structuring | Ollama (local LLM, LAN-accessible) |
| Website | Next.js (App Router) |
| Deployment | Docker Compose |
| Notion sync (optional) | `@notionhq/client` |

## Prerequisites

- A machine to run the pipeline and website continuously (the "24/7 Server" in this setup)
- A second machine (or if your 24/7 Server has a GPU, the current machine) with a GPU running [Ollama](https://ollama.com), reachable over the LAN (the "Ollama Server")
- Node.js 22+ and Docker on the 24/7 Server
- A vision-capable Ollama model pulled on the Ollama Server (this project uses `qwen3.5:9b-q8_0`, any vision-capable model works)

## Project structure

```
study-archive/
├── data/
│   ├── material/<subject>/     # dropped-in or uploaded source files
│   │                           #   (plus .<filename>.meta.json sidecars for upload-time overrides)
│   ├── generated/<subject>/    # generated HTML pages
│   ├── study-archive.db        # SQLite database (documents, flashcards, app_settings)
│   ├── pipeline-heartbeat.txt  # worker-loop heartbeat, used by the Docker HEALTHCHECK
│   └── sync-status.json        # last Notion sync run result
├── src/
│   ├── watcher/                # file detection
│   ├── db/                     # schema and queue logic
│   ├── pipeline/               # OCR, LLM calls, HTML generation
│   └── scripts/
│       └── regenerate-html.ts  # re-render all pages after a template change
├── web/                        # Next.js frontend
├── Dockerfile                  # pipeline container
├── docker-compose.yml
└── TUTORIAL.md                 # full step-by-step build guide
```

## Setup

The complete, annotated build walkthrough, including every configuration detail and the reasoning behind it, lives in [`TUTORIAL.md`](./TUTORIAL.md). Short version:

```bash
git clone <this-repo>
cd study-archive
npm install

# On the Ollama Server: make Ollama reachable on the LAN and pull a vision-capable model
docker exec ollama ollama pull qwen3.5:9b-q8_0

# Back on the 24/7 Server: point the pipeline at the Ollama Server and start everything
cd study-archive
docker compose up -d --build
```

## Build yourself

For a detailed tutorial on building this project from scratch, see [`tutorial.md`](./tutorial.md).

## Configuration

Set via environment variables (see `docker-compose.yml`):

| Variable | Used by | Purpose |
|---|---|---|
| `OLLAMA_URL` | pipeline | LAN address of the machine running Ollama, e.g. `http://192.168.X.XX:11434` |
| `DATA_ROOT` | website | Path to the shared `data` folder inside the container, e.g. `/app/data` |

## Usage

- **Drop a file:** copy a PDF, JPG, or PNG into `data/material/<subject>/`. It's picked up and processed automatically.
- **Upload from the browser:** open the website, go to the upload page, pick or create a subject, and select a file. It's written to the same `data/material/` folder the watcher monitors, so the rest of the pipeline behaves identically either way.
- **Browse:** the homepage lists all documents grouped by subject in collapsible sections, newest first, with in-progress uploads shown separately from finished ones. Click a finished document to open its generated page.
- **Search:** find documents by title, tags, summary, full text, or upload date; matching snippets are highlighted in the results.
- **Rename or delete:** use the "…" menu on a document or a whole subject to rename or delete it. Deleting removes the database entry and the files on disk, not just the listing.

## Known limitations

- Handwriting OCR accuracy varies significantly by handwriting style; test with real samples before relying on it.
- Ollama has no built-in authentication - keep it on a trusted network only, never expose it directly to the internet.
- SQLite tolerates only one writer at a time, fine at personal-project volume, not designed for concurrent multi-user write load.
- The rename/delete API routes have no auth of their own, they rely entirely on Cloudflare Access sitting in front of the site. Fine for a single-user archive, would need real auth before opening this up more broadly.

## License

MIT - see the [LICENSE](./LICENSE) file for details.

<h1></h1>
<p align="center">
    <span>&copy; 2026 <a href="https://github.com/itsmarianmc/">itsmarian</a> | All rights reserved.</span>
</p>