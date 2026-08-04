import { getDigestEntries } from "@/lib/digest";
import { formatUploadDate } from "@/lib/search";
import PageHeader from "../components/PageHeader";

export const dynamic = "force-dynamic";

const DAY_OPTIONS = [7, 14, 30];

export default async function DigestPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
    const params = await searchParams;
    const requestedDays = Number(params?.days);
    const days = DAY_OPTIONS.includes(requestedDays) ? requestedDays : 7;

    const groups = getDigestEntries(days);
    const totalDocs = groups.reduce((sum, g) => sum + g.entries.length, 0);

    return (
        <>
            <PageHeader
                title="Digest"
                actions={
                    <>
                        <a className="icon-button" href="/" aria-label="Back to overview" title="Back to overview">
                            <i className="fa-solid fa-arrow-left"></i>
                        </a>
                        <a
                            className="icon-button"
                            href={`/api/digest?days=${days}`}
                            aria-label="Download as Markdown"
                            title="Download as Markdown"
                        >
                            <i className="fa-solid fa-download"></i>
                        </a>
                    </>
                }
            >
                <div className="digest-range-tabs">
                    {DAY_OPTIONS.map((d) => (
                        <a key={d} href={`/digest?days=${d}`} className={`digest-range-tab${d === days ? " digest-range-tab--active" : ""}`}>
                            Last {d} days
                        </a>
                    ))}
                </div>
            </PageHeader>

            <main>
                <p className="digest-summary">
                    {totalDocs} document{totalDocs === 1 ? "" : "s"} archived in the last {days} days.
                </p>

                {groups.map((group) => (
                    <div key={group.folder} className="digest-folder">
                        <h2 className="digest-folder-name">{group.folder}</h2>
                        <ul className="digest-list">
                            {group.entries.map((entry) => (
                                <li key={entry.id} className="digest-entry">
                                    <div className="digest-entry-head">
                                        <a href={`/${entry.folder}/${entry.id}`} className="digest-entry-title">
                                            {entry.title}
                                        </a>
                                        <span className="digest-entry-date">{formatUploadDate(entry.detectedAt)}</span>
                                    </div>
                                    <p className="digest-entry-summary">{entry.summary}</p>
                                    {entry.tags.length > 0 && (
                                        <ul className="digest-entry-tags">
                                            {entry.tags.map((tag) => (
                                                <li key={tag}>{tag}</li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}

                {totalDocs === 0 && <p className="no-results">No documents archived in this period.</p>}
            </main>
        </>
    );
}
