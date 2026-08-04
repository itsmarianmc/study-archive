import PageHeader from "../components/PageHeader";
import SettingsManager from "../components/SettingsManager";
import OfflineSettings from "../components/OfflineSettings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
    return (
        <>
            <PageHeader
                title="Settings"
                actions={
                    <a className="icon-button" href="/" aria-label="Back to overview" title="Back to overview">
                        <i className="fa-solid fa-arrow-left"></i>
                    </a>
                }
            >
                <p className="header-summary">Configure Ollama, subjects, Notion, and the shortcut API from one place.</p>
            </PageHeader>

            <main>
                <div className="settings-stack">
                    <SettingsManager />
                    <OfflineSettings />
                </div>
            </main>
        </>
    );
}