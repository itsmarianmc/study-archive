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
    dueFlashcards?: number;
}

export default function FolderGroup({ folder, processing, docs, query, dueFlashcards = 0 }: Props) {
    const [open, setOpen] = useState(true);
    const router = useRouter();
    const total = processing.length + docs.length;
    const totalViews = docs.reduce((sum, doc) => sum + (doc.view_count || 0), 0);

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
            <div className={`folder-group-summary ${open ? "folder-group--open" : ""}`}>
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
                    {totalViews > 0 && (
                        <span className="folder-group-views" title="Total times documents in this subject were opened">
                            <i className="fa-regular fa-eye"></i> {totalViews}
                        </span>
                    )}
                    {dueFlashcards > 0 && (
                        <a
                            className="folder-group-due"
                            href={`/review?folder=${encodeURIComponent(folder)}`}
                            title="Flashcards due for review in this subject"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <i className="fa-solid fa-layer-group"></i> {dueFlashcards}
                        </a>
                    )}
                    <OptionsMenu
                        items={[
                            { label: "Rename subject", onClick: renameFolder },
                            { label: "Delete subject", onClick: deleteFolder, danger: true },
                        ]}
                    />
                </div>

                <div className={`folder-group-collapse${open ? " open" : ""}`}>
                    <div className="folder-group-collapse-inner">
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
                                const notesSnippet = query ? getContentSnippet(doc.notes || "", query) : null;
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
                                        {!snippet && notesSnippet && (
                                            <span className="doc-snippet doc-snippet--notes">
                                                <i className="fa-regular fa-note-sticky"></i>{" "}
                                                {notesSnippet.before}
                                                <mark className="doc-highlight">{notesSnippet.match}</mark>
                                                {notesSnippet.after}
                                            </span>
                                        )}
                                        {doc.view_count > 0 && (
                                            <span className="doc-views" title="Times opened">
                                                <i className="fa-regular fa-eye"></i> {doc.view_count}
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
                    </div>
                </div>
            </div>
        </div>
    );
}
