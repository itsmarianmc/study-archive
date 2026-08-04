import { getDocuments } from "./db";
import { formatUploadDate } from "./search";

export interface DigestEntry {
    id: number;
    folder: string;
    title: string;
    summary: string;
    tags: string[];
    detectedAt: string;
}

export interface DigestFolderGroup {
    folder: string;
    entries: DigestEntry[];
}

function parseTags(tags: string | null): string[] {
    if (!tags) return [];
    try {
        const parsed = JSON.parse(tags);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

export function getDigestEntries(days: number): DigestFolderGroup[] {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const docs = getDocuments().filter((doc) => new Date(doc.detected_at) >= since);

    const groups = new Map<string, DigestFolderGroup>();
    for (const doc of docs) {
        let group = groups.get(doc.folder);
        if (!group) {
            group = { folder: doc.folder, entries: [] };
            groups.set(doc.folder, group);
        }
        group.entries.push({
            id: doc.id,
            folder: doc.folder,
            title: doc.title,
            summary: doc.summary,
            tags: parseTags(doc.tags),
            detectedAt: doc.detected_at,
        });
    }

    return Array.from(groups.values()).sort((a, b) => a.folder.localeCompare(b.folder));
}

export function buildDigestMarkdown(days: number, baseUrl = ""): string {
    const groups = getDigestEntries(days);
    const totalDocs = groups.reduce((sum, g) => sum + g.entries.length, 0);

    let md = `# Study Archive Digest\n\n`;
    md += `_${totalDocs} document(s) archived in the last ${days} day(s)._\n\n`;

    if (totalDocs === 0) {
        md += `No new documents in this period.\n`;
        return md;
    }

    for (const group of groups) {
        md += `## ${group.folder}\n\n`;
        for (const entry of group.entries) {
            const url = `${baseUrl}/${entry.folder}/${entry.id}`;
            md += `- **${entry.title}** (${formatUploadDate(entry.detectedAt)}) - ${entry.summary}\n`;
            if (entry.tags.length) md += `  Tags: ${entry.tags.join(", ")}\n`;
            md += `  ${url}\n\n`;
        }
    }

    return md;
}
