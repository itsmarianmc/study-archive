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
