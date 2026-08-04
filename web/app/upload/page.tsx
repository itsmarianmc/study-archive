"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../_context/ToastContext";
import PageHeader from "../components/PageHeader";

const CREATE_NEW_SENTINEL = "__create_new_subject__";

function capitalize(name: string): string {
    return name.length ? name[0].toUpperCase() + name.slice(1) : name;
}

export default function UploadPage() {
    const [folders, setFolders] = useState<string[]>([]);
    const [selectedFolder, setSelectedFolder] = useState("");
    const [newFolder, setNewFolder] = useState("");
    const [files, setFiles] = useState<File[]>([]);
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
    }, []);

    function addFiles(nextFiles: FileList | File[]) {
        setFiles((current) => {
            const seen = new Set(current.map((file) => `${file.name}-${file.size}-${file.lastModified}`));
            const merged = [...current];
            for (const file of Array.from(nextFiles)) {
                const key = `${file.name}-${file.size}-${file.lastModified}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(file);
                }
            }
            return merged;
        });
    }

    function removeFile(index: number) {
        setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
    }

    function handleDrop(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        const isCreatingNew = selectedFolder === CREATE_NEW_SENTINEL;
        const folder = isCreatingNew ? newFolder.trim() : selectedFolder;

        if (!folder) {
            showToast(isCreatingNew ? "Please enter a name for the new subject." : "Please select a subject.", "toast-error");
            return;
        }
        if (files.length === 0) {
            showToast("Please choose at least one file.", "toast-error");
            return;
        }

        const formData = new FormData();
        formData.append("folder", folder);
        for (const file of files) {
            formData.append("files", file);
        }
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
            }

            if (xhr.status < 200 || xhr.status >= 300) {
                showToast(data?.error ?? "Upload failed.", "toast-error");
                return;
            }

            const uploadedFiles = Array.isArray(data?.files) ? data.files : [];
            showToast(
                uploadedFiles.length > 1
                    ? `${uploadedFiles.length} files saved to "${data.folder}"`
                    : `"${data.filename ?? uploadedFiles[0]?.filename}" saved to "${data.folder}"`,
                "toast-success"
            );
            setFiles([]);
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
        <>
            <PageHeader
                title="Add new document"
                actions={
                    <>
                        <a className="icon-button" href="/" aria-label="Back to overview" title="Back to overview">
                            <i className="fa-solid fa-arrow-left"></i>
                        </a>
                        <a className="icon-button" href="/settings" aria-label="Settings" title="Settings">
                            <i className="fa-solid fa-gear"></i>
                        </a>
                    </>
                }
            >
                <p className="header-summary">Queue multiple PDFs or images here, then remove any unwanted files before uploading.</p>
            </PageHeader>

            <main>
                <form onSubmit={handleSubmit}>
                    <label>
                        Title <span className="label-optional">(optional, overrides the AI-generated title)</span>
                        <input type="text" placeholder="e.g. Chapter 4 notes" value={title} onChange={(e) => setTitle(e.target.value)} />
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
                        <select value={selectedFolder} onChange={(e) => setSelectedFolder(e.target.value)}>
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

                    <div className="file-picker-field">
                        <span>
                            Files (PDF, JPG, PNG)
                        </span>
                        <input
                            ref={fileInputRef}
                            id="file-input"
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            multiple
                            onChange={(e) => {
                                if (e.target.files?.length) {
                                    addFiles(e.target.files);
                                }
                                requestAnimationFrame(() => {
                                    if (fileInputRef.current) fileInputRef.current.value = "";
                                });
                            }}
                            className="sr-only-input"
                        />
                        <div
                            role="button"
                            tabIndex={0}
                            className={`dropzone${dragActive ? " dropzone--active" : ""}${files.length ? " dropzone--filled" : ""}`}
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    fileInputRef.current?.click();
                                }
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragActive(true);
                            }}
                            onDragLeave={() => setDragActive(false)}
                            onDrop={handleDrop}
                        >
                            {files.length ? (
                                <>
                                    <i className="fa-solid fa-layer-group"></i>
                                    <span className="dropzone-filename">{files.length} file{files.length === 1 ? "" : "s"} selected</span>
                                    <span className="dropzone-hint">Click or drop to add more</span>
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-cloud-arrow-up"></i>
                                    <span>Drag & drop files here, or click to browse</span>
                                    <span className="dropzone-hint">PDF, JPG or PNG</span>
                                </>
                            )}
                        </div>
                    </div>

                    {files.length > 0 && (
                        <ul className="upload-queue">
                            {files.map((file, index) => (
                                <li key={`${file.name}-${file.size}-${file.lastModified}`} className="upload-queue-item">
                                    <div className="upload-queue-meta">
                                        <i className="fa-regular fa-file-lines"></i>
                                        <span className="upload-queue-name">{file.name}</span>
                                    </div>
                                    <button type="button" className="upload-queue-remove" onClick={() => removeFile(index)}>
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

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
        </>
    );
}