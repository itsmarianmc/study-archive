"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "../_context/ToastContext";

type AppSettings = {
    ollamaBaseUrl: string;
    visionModel: string;
    textModel: string;
    notionToken: string;
    apiPassword: string;
    notionEnabled: boolean;
};

type OllamaModel = {
    name: string;
    isVision: boolean;
};

const EMPTY_SETTINGS: AppSettings = {
    ollamaBaseUrl: "",
    visionModel: "",
    textModel: "",
    notionToken: "",
    apiPassword: "",
    notionEnabled: true,
};

export function SettingsSection({
    title,
    description,
    children,
    open,
    onToggle,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="folder-group settings-section">
            <div className="folder-group-summary settings-section-summary">
                <div
                    className={ `folder-group-header settings-section-header ${open ? "folder-group--open" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={onToggle}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onToggle();
                        }
                    }}
                >
                    <span className={`folder-group-arrow ${open ? "folder-group-arrow--open" : ""}`}>
                        <i className="fa-solid fa-chevron-right"></i>
                    </span>
                    <span className="folder-group-name">{title}</span>
                </div>

                <div className={`folder-group-collapse${open ? " open" : ""}`}>
                    <div className="folder-group-collapse-inner settings-section-inner">
                        <p className="settings-section-description">{description}</p>
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}

function FolderRow({
    folder,
    onRename,
    onDelete,
}: {
    folder: string;
    onRename: (oldName: string, nextName: string) => void;
    onDelete: (folder: string) => void;
}) {
    const [draft, setDraft] = useState(folder);

    useEffect(() => {
        setDraft(folder);
    }, [folder]);

    return (
        <li className="settings-folder-row">
            <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="settings-folder-actions">
                <button type="button" onClick={() => onRename(folder, draft)}>
                    Rename
                </button>
                <button type="button" className="danger" onClick={() => onDelete(folder)}>
                    Delete
                </button>
            </div>
        </li>
    );
}

function SecretField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
}) {
    const [visible, setVisible] = useState(false);
    const { showToast } = useToast();

    async function copyValue() {
        if (!value) {
            showToast("Nothing to copy.", "toast-error");
            return;
        }
        try {
            await navigator.clipboard.writeText(value);
            showToast(`${label} copied.`, "toast-success");
        } catch {
            showToast("Copy failed.", "toast-error");
        }
    }

    return (
        <label>
            {label}
            <div className="settings-secret-field">
                <input
                    type={visible ? "text" : "password"}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    autoComplete="off"
                />
                <button
                    type="button"
                    className="settings-secret-button"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? `Hide ${label}` : `Show ${label}`}
                    title={visible ? "Hide" : "Show"}
                >
                    <i className={`fa-solid ${visible ? "fa-eye-slash" : "fa-eye"}`}></i>
                </button>
                <button
                    type="button"
                    className="settings-secret-button"
                    onClick={copyValue}
                    aria-label={`Copy ${label}`}
                    title="Copy"
                >
                    <i className="fa-solid fa-copy"></i>
                </button>
            </div>
        </label>
    );
}

function ModelSelect({
    label,
    value,
    onChange,
    options,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    options: string[];
    placeholder?: string;
}) {
    const knownOptions = value && !options.includes(value) ? [value, ...options] : options;

    return (
        <label>
            {label}
            <select value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">{placeholder ?? "Select a model"}</option>
                {knownOptions.map((name) => (
                    <option key={name} value={name}>
                        {name}
                    </option>
                ))}
            </select>
        </label>
    );
}

export default function SettingsManager() {
    const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
    const [folders, setFolders] = useState<string[]>([]);
    const [newFolderName, setNewFolderName] = useState("");
    const [openSections, setOpenSections] = useState({ ollama: true, folders: true, access: true });
    const [savingSettings, setSavingSettings] = useState<Partial<Record<keyof AppSettings, boolean>>>({});
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [models, setModels] = useState<OllamaModel[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const { showToast } = useToast();

    const loadModels = useCallback(
        async (baseUrl: string, { silent }: { silent?: boolean } = {}) => {
            if (!baseUrl) return;
            setLoadingModels(true);
            try {
                const res = await fetch(`/api/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`);
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    if (!silent) showToast(data?.error ?? "Could not load models from Ollama.", "toast-error");
                    setModels([]);
                    return;
                }
                setModels(Array.isArray(data.models) ? data.models : []);
            } catch {
                if (!silent) showToast("Could not reach Ollama.", "toast-error");
                setModels([]);
            } finally {
                setLoadingModels(false);
            }
        },
        [showToast]
    );

    useEffect(() => {
        Promise.all([fetch("/api/settings").then((res) => res.json()), fetch("/api/folders").then((res) => res.json())])
            .then(([settingsData, foldersData]) => {
                const merged = { ...EMPTY_SETTINGS, ...settingsData };
                setSettings(merged);
                setFolders(Array.isArray(foldersData) ? foldersData : []);
                if (merged.ollamaBaseUrl) loadModels(merged.ollamaBaseUrl, { silent: true });
            })
            .catch(() => showToast("Could not load settings.", "toast-error"));
    }, [showToast]);

    async function saveSettings(partial: Partial<AppSettings>, successMessage: string) {
        setSavingSettings((current) => {
            const next = { ...current };
            for (const key of Object.keys(partial) as (keyof AppSettings)[]) {
                next[key] = true;
            }
            return next;
        });
        try {
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(partial),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                showToast(data?.error ?? "Save failed.", "toast-error");
                return;
            }
            setSettings((current) => ({ ...current, ...data.settings }));
            showToast(successMessage, "toast-success");
        } finally {
            setSavingSettings((current) => {
                const next = { ...current };
                for (const key of Object.keys(partial) as (keyof AppSettings)[]) {
                    delete next[key];
                }
                return next;
            });
        }
    }

    async function toggleNotionEnabled(next: boolean) {
        setSettings((current) => ({ ...current, notionEnabled: next }));
        await saveSettings({ notionEnabled: next }, next ? "Notion sync enabled." : "Notion sync disabled.");
    }

    async function createFolder() {
        const name = newFolderName.trim();
        if (!name) return;

        setCreatingFolder(true);
        try {
            const res = await fetch("/api/folders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                showToast(data?.error ?? "Could not create subject.", "toast-error");
                return;
            }
            setFolders((current) => [...current, data.folder].sort());
            setNewFolderName("");
            showToast(`Created subject \"${data.folder}\"`, "toast-success");
        } finally {
            setCreatingFolder(false);
        }
    }

    async function renameFolder(oldName: string, nextName: string) {
        const name = nextName.trim();
        if (!name || name === oldName) return;

        const res = await fetch(`/api/folders/${oldName}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            showToast(data?.error ?? "Rename failed.", "toast-error");
            return;
        }
        setFolders((current) => current.map((folder) => (folder === oldName ? data.folder : folder)).sort());
        showToast(`Renamed subject to \"${data.folder}\"`, "toast-success");
    }

    async function deleteFolder(folder: string) {
        if (!window.confirm(`Really delete subject \"${folder}\" and all documents in it?`)) return;

        const res = await fetch(`/api/folders/${folder}`, { method: "DELETE" });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            showToast(data?.error ?? "Delete failed.", "toast-error");
            return;
        }
        setFolders((current) => current.filter((item) => item !== folder));
        showToast(`Deleted subject \"${folder}\"`, "toast-success");
    }

    const visionModels = models.filter((m) => m.isVision).map((m) => m.name);
    const allModelNames = models.map((m) => m.name);
    const visionOptions = visionModels.length > 0 ? visionModels : allModelNames;

    return (
        <div className="settings-stack">
            <SettingsSection
                title="Ollama"
                description="Set the Ollama endpoint and the models used for vision OCR and text processing."
                open={openSections.ollama}
                onToggle={() => setOpenSections((current) => ({ ...current, ollama: !current.ollama }))}
            >
                <div className="settings-grid">
                    <label>
                        Ollama Base URL
                        <input
                            type="text"
                            value={settings.ollamaBaseUrl}
                            onChange={(e) => setSettings((current) => ({ ...current, ollamaBaseUrl: e.target.value }))}
                            onBlur={() => loadModels(settings.ollamaBaseUrl, { silent: true })}
                            placeholder="http://localhost:11434"
                        />
                    </label>
                    <ModelSelect
                        label="Vision model"
                        value={settings.visionModel}
                        onChange={(next) => setSettings((current) => ({ ...current, visionModel: next }))}
                        options={visionOptions}
                        placeholder={loadingModels ? "Loading models…" : "Select a vision model"}
                    />
                    <ModelSelect
                        label="Text model"
                        value={settings.textModel}
                        onChange={(next) => setSettings((current) => ({ ...current, textModel: next }))}
                        options={allModelNames}
                        placeholder={loadingModels ? "Loading models…" : "Select a text model"}
                    />
                </div>
                <div className="settings-actions settings-actions--split">
                    <button
                        type="button"
                        className="settings-refresh-button"
                        onClick={() => loadModels(settings.ollamaBaseUrl)}
                        disabled={loadingModels || !settings.ollamaBaseUrl}
                    >
                        <i className={`fa-solid fa-rotate${loadingModels ? " fa-spin" : ""}`}></i>
                        {loadingModels ? "Loading…" : "Refresh models"}
                    </button>
                    <button
                        type="button"
                        onClick={() => saveSettings({ ollamaBaseUrl: settings.ollamaBaseUrl, visionModel: settings.visionModel, textModel: settings.textModel }, "Saved Ollama settings.")}
                        disabled={Boolean(savingSettings.ollamaBaseUrl || savingSettings.visionModel || savingSettings.textModel)}
                    >
                        Save Ollama settings
                    </button>
                </div>
            </SettingsSection>

            <SettingsSection
                title="Subjects"
                description="Create, rename, or delete study subjects. The layout matches the subject groups on the overview page."
                open={openSections.folders}
                onToggle={() => setOpenSections((current) => ({ ...current, folders: !current.folders }))}
            >
                <div className="settings-create-row">
                    <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="New subject name"
                    />
                    <button type="button" onClick={createFolder} disabled={creatingFolder}>
                        Create subject
                    </button>
                </div>

                <ul className="settings-folder-list">
                    {folders.map((folder) => (
                        <FolderRow key={folder} folder={folder} onRename={renameFolder} onDelete={deleteFolder} />
                    ))}
                </ul>
            </SettingsSection>

            <SettingsSection
                title="Notion and API"
                description="Store the Notion token for syncs and the API password for secure access outside of your environment."
                open={openSections.access}
                onToggle={() => setOpenSections((current) => ({ ...current, access: !current.access }))}
            >
                <div className="settings-toggle-row">
                    <div className="settings-toggle-label">
                        <span>Notion sync</span>
                        <span className="settings-section-description settings-toggle-description">
                            When disabled, the sync button on the overview page is hidden and manual syncs are blocked.
                        </span>
                    </div>
                    <label className="settings-toggle" aria-label="Enable Notion sync">
                        <input
                            type="checkbox"
                            checked={settings.notionEnabled}
                            onChange={(e) => toggleNotionEnabled(e.target.checked)}
                            disabled={Boolean(savingSettings.notionEnabled)}
                        />
                        <span className="settings-toggle-slider"></span>
                    </label>
                </div>

                <div className="settings-grid">
                    <SecretField
                        label="Notion token"
                        value={settings.notionToken}
                        onChange={(next) => setSettings((current) => ({ ...current, notionToken: next }))}
                        placeholder="ntn_..."
                    />
                    <SecretField
                        label="API password"
                        value={settings.apiPassword}
                        onChange={(next) => setSettings((current) => ({ ...current, apiPassword: next }))}
                        placeholder="Used by the share shortcut"
                    />
                </div>
                <div className="settings-actions">
                    <button
                        type="button"
                        onClick={() => saveSettings({ notionToken: settings.notionToken, apiPassword: settings.apiPassword }, "Saved access settings.")}
                        disabled={Boolean(savingSettings.notionToken || savingSettings.apiPassword)}
                    >
                        Save access settings
                    </button>
                </div>
            </SettingsSection>
        </div>
    );
}
