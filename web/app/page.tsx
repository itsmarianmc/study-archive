import { getDocuments, getProcessingDocuments, getDueCountsByFolder, getAppSettings, DocumentRow, ProcessingDocumentRow } from "@/lib/db";
import { formatUploadDate } from "@/lib/search";
import FolderGroup from "./components/FolderGroup";
import PageHeader from "./components/PageHeader";
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
    dueFlashcards: number;
}

function groupByFolder(
    processingDocs: ProcessingDocumentRow[],
    docs: DocumentRow[],
    dueCounts: { folder: string; due: number }[]
): FolderGroupData[] {
    const groups = new Map<string, FolderGroupData>();

    const getGroup = (folder: string) => {
        let group = groups.get(folder);
        if (!group) {
            group = { folder, processing: [], docs: [], dueFlashcards: 0 };
            groups.set(folder, group);
        }
        return group;
    };

    for (const doc of processingDocs) getGroup(doc.folder).processing.push(doc);
    for (const doc of docs) getGroup(doc.folder).docs.push(doc);
    for (const { folder, due } of dueCounts) getGroup(folder).dueFlashcards = due;

    return Array.from(groups.values()).sort((a, b) => a.folder.localeCompare(b.folder));
}

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const params = await searchParams;
    const query = params?.q || "";

    const { notionEnabled } = getAppSettings();
    const allDocs = getDocuments();
    const processingDocs = getProcessingDocuments();
    const dueCounts = getDueCountsByFolder();
    const totalDue = dueCounts.reduce((sum, c) => sum + c.due, 0);
    const filteredDocs = filterDocuments(allDocs, query);
    const folderGroups = groupByFolder(processingDocs, filteredDocs, dueCounts).filter(
        (g) => g.processing.length + g.docs.length > 0
    );
    const noResults = query && filteredDocs.length === 0 && processingDocs.length === 0;

    return (
        <>
            <PageHeader
                title="Study Archive"
                actions={
                    <>
                        <a className="icon-button" href="/digest" aria-label="Digest" title="Digest of recently archived documents">
                            <i className="fa-solid fa-file-lines"></i>
                        </a>
                        <a className="icon-button icon-button--badge" href="/review" aria-label="Review flashcards" title="Review due flashcards">
                            <i className="fa-solid fa-layer-group"></i>
                            {totalDue > 0 && <span className="icon-button-badge">{totalDue}</span>}
                        </a>
                        <div style={ { background: 'var(--surface2)', height: '42px', width: '1px'}}></div>
                        <a className="icon-button" href="/upload" aria-label="Add document" title="Add document">
                            <i className="fa-solid fa-plus"></i>
                        </a>
                        {notionEnabled && <SyncButton />}
                        <a className="icon-button" href="/settings" aria-label="Settings" title="Settings">
                            <i className="fa-solid fa-gear"></i>
                        </a>
                    </>
                }
            >
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
            </PageHeader>

            <main>
                {folderGroups.length === 0 && !noResults && (
                    <p className="no-results">
                        No documents have been added yet. 
                        <br />
                        Start by <a href="/upload" className="underline">
                           adding a Document
                        </a>
                    </p>
                )}

                {folderGroups.map((group) => (
                    <FolderGroup
                        key={group.folder}
                        folder={group.folder}
                        processing={group.processing}
                        docs={group.docs}
                        query={query}
                        dueFlashcards={group.dueFlashcards}
                    />
                ))}

                {noResults && <p className="no-results">No results for "{query}"</p>}
            </main>
        </>
    );
}
