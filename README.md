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
3. A worker loop picks it up, extracts text (PDF text layer, or vision-model OCR for images and scans whose text layer turns out to be broken), and asks a local LLM to generate a title, tags, and a summary.
4. A static HTML page is generated for the document.
5. The website lists every document, live status included, letting you open the generated page for any finished one.

## Features

- **Automatic ingestion** - a file watcher picks up new documents the moment they appear on disk, no manual trigger needed
- **OCR for scans and photos** - handled through a local vision model, with an automatic fallback to rasterize-and-OCR for PDFs whose text layer turns out to be broken or unusable
- **PDF text extraction** - PDFs with a real text layer skip OCR entirely and are parsed directly
- **AI-generated metadata** - title, subject tags, and a summary are generated per document
- **Manual overrides** - optionally set your own title/summary at upload time instead of the AI-generated ones, plus a free-form Notes field that's entirely independent of the AI content and editable any time
- **Static page per document** - each processed file becomes a clean, linkable HTML page using a fixed template. A regeneration script re-renders every existing page after a template/styling change, without sending anything back through the model
- **Offline-tolerant queue** - if the Ollama Host is off, documents stay queued and are retried automatically once it's back
- **Drag-and-drop upload** - add new documents and even new subjects directly from the website, with a proper dropzone and live upload progress
- **Live processing status** - documents still in the queue show up in the UI immediately, distinct from finished ones
- **Full-text search** - across title, tags, summary, extracted content, notes, and upload date, with matching snippets highlighted in results
- **Manage documents & subjects** - rename or delete individual documents or whole subject folders from a "…" menu; this cleans up both the database rows and the underlying files
- **Dark theme** - the whole site, including generated document pages, is dark by default
- **Fully containerized** - both the processing pipeline and the website run as Docker services with `restart: unless-stopped`
- **Optional one-way Notion sync** - mirror your archive into a Notion database, so it's linkable from wherever you already take notes

## Tech stack

| Component | Technology |
|---|---|
| File watching | chokidar |
| Queue & metadata storage | SQLite (via `better-sqlite3`) |
| PDF text extraction | `pdf-parse` |
| Vision OCR & text structuring | Ollama (local LLM) |
| Website | Next.js (App Router) |
| Deployment | Docker Compose |
| Notion sync (optional) | `@notionhq/client` |

## Prerequisites

- Docker + Docker Compose (or Node.js 22+ if you'd rather run it without containers)
- [Ollama](https://ollama.com) running somewhere reachable from the App Server, with:
  - a vision-capable model for OCR (e.g. `qwen3.5:9b` or similar)
  - a text model for structuring/summarizing (can be the same model)
- (Optional) A [Notion](https://notion.so) account, if you want the sync feature

## Project structure

```
study-archive/
├── data/
│   ├── material/<subject>/     # dropped-in or uploaded source files
│   ├── generated/<subject>/    # generated HTML pages
│   └── study-archive.db        # SQLite database
├── src/
│   ├── watcher/                # file detection
│   ├── db/                     # schema and queue logic
│   ├── pipeline/                # OCR, LLM calls, HTML generation
│   ├── scripts/
│   │   ├── regenerate-html.ts  # re-render all pages after a template change
│   │   └── notion-sync.ts      # one-way sync to Notion
│   └── index.ts                # entry point, starts the watcher + worker loop together
├── web/                        # Next.js frontend
├── deploy/                     # systemd unit files for the Notion sync
├── Dockerfile                  # pipeline container
├── docker-compose.yml
└── TUTORIAL.md                 # full step-by-step build guide
```

## Setup

The complete, annotated build walkthrough, including every configuration detail and the reasoning behind it, lives in [`TUTORIAL.md`](./TUTORIAL.md). Short version:

```bash
git clone <this-repo>
cd study-archive
```

Create a `.env` (or set these however you manage secrets):

```bash
OLLAMA_URL=http://<your-ollama-host>:11434

# Only needed for the optional Notion sync
NOTION_TOKEN=
NOTION_DATABASE_ID=
STUDY_ARCHIVE_BASE_URL=       # public/local URL where the dashboard is reachable
```

> `.env` is what `notion-sync.ts` and the systemd timer read from, and it's what `docker-compose.yml` substitutes `NOTION_TOKEN`/`NOTION_DATABASE_ID`/`STUDY_ARCHIVE_BASE_URL` from via `${VAR}`. `OLLAMA_URL` is the one exception: the pipeline service in `docker-compose.yml` currently hardcodes it directly in the `environment:` block rather than substituting it from `.env`, so if your Ollama Host isn't reachable at that hardcoded address, edit `docker-compose.yml` itself, not just `.env`.

Build and run:

```bash
docker build -t study-archive-pipeline:latest .
docker build -t study-archive-web:latest ./web
docker compose up -d
```

There are no `build:` keys in `docker-compose.yml` on purpose, it only ever consumes the two image tags built above (handy for a Portainer-managed stack, which builds or pulls images separately from the deployed stack itself). Rerun both `docker build` commands after any code change, then `docker compose up -d` again to pick up the new images, `docker compose restart` alone just restarts the existing ones.

The dashboard listens on port `3000` inside the web container - map it to whatever host port you like in `docker-compose.yml` (the example config maps it to `1920`). Make sure the vision/text model you intend to use is pulled on your Ollama host, e.g. `ollama pull qwen3.5:9b`.

## Notion sync (optional)

If you'd like your archive to show up as linkable entries in Notion, there's a one-way sync script plus a matching "Sync" button in the dashboard. See Phase 10 of [`TUTORIAL.md`](./TUTORIAL.md) for the full reasoning behind the property mapping and the dedup logic.

### Setting up the Notion side

1. Create an internal integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) and copy its secret.
2. Share the database you want to sync into with that integration (database → `•••` → Connections).
3. Copy the database ID out of its URL.

### Table structure

Create a database with these properties:

| Property | Type | Notes |
|---|---|---|
| **Titel** | Title | The document title (AI-generated, or your manual override) |
| **Typ** | Select | Derived from file type (PDF, Scan, Dokument) |
| **Subject** | Select | The folder/subject the document belongs to |
| **Tags** | Multi-select | AI-generated tags |
| **URL** | URL | Link back to the document's page in your dashboard |
| **Processed** | Checkbox | Whether AI processing has finished yet |
| **Notes** | Text | Your own notes, independent of the AI-generated content |
| **Archive ID** | Text | Internal ID used to avoid duplicate entries on repeated syncs |
| **Last Synced** | Date | Timestamp of the most recent sync |

Documents sync immediately on upload (with a placeholder title and `Processed` unchecked), then get updated automatically once processing finishes.

### Running the sync

Either click the sync button in the dashboard header, or automate it:

```bash
npm run sync:notion
```

Ready-to-use systemd service + timer files are included under `deploy/` if you want it running on a schedule (every 30 minutes is plenty) without any manual triggering.

## Usage

- **Drop a file:** copy a PDF, JPG, or PNG into `data/material/<subject>/`. It's picked up and processed automatically.
- **Upload from the browser:** open the website, go to the upload page, drag a file onto the dropzone (or click to browse), optionally set a title/summary/notes override, pick or create a subject, and submit.
- **Browse:** the homepage lists all documents grouped by subject in collapsible sections, newest first, with in-progress uploads shown separately from finished ones.
- **Search:** find documents by title, tags, summary, full text, notes, or upload date; matching snippets are highlighted in the results.
- **Rename or delete:** use the "…" menu on a document or a whole subject. Deleting removes the database entry and the files on disk, not just the listing.
- **Regenerate pages:** after changing the HTML template or styles, run `npx tsx src/scripts/regenerate-html.ts` to re-render every existing document without reprocessing through Ollama.

## Known limitations

- Handwriting OCR accuracy varies significantly by handwriting style; test with real samples before relying on it.
- Ollama has no built-in authentication - keep it on a trusted network only, never expose it directly to the internet.
- SQLite tolerates only one writer at a time, fine at personal-project volume, not designed for concurrent multi-user write load.
- The rename/delete/upload API routes have no auth of their own. Put something in front of the site (a reverse proxy with basic auth, Cloudflare Access, Tailscale, etc.) before exposing this beyond your own network.

## License

MIT - see the [LICENSE](./LICENSE) file for details.

<h1></h1>
<p align="center">
    <span>&copy; 2026 <a href="https://github.com/itsmarianmc/">itsmarian</a> | All rights reserved.</span>
</p>