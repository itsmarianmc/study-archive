import fs from "fs";
import path from "path";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");
const MATERIAL_ROOT = path.join(DATA_ROOT, "material");

export const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

export function sanitizeFolderName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function sanitizeFileName(name: string): string {
    return path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function saveUploadedFiles(input: {
    folder: string;
    files: File[];
    title?: string;
    summary?: string;
    notes?: string;
}): Promise<{ folder: string; filename: string }[]> {
    const folder = sanitizeFolderName(input.folder);
    if (!folder) {
        throw new Error("Invalid subject name");
    }

    const targetDir = path.join(MATERIAL_ROOT, folder);
    fs.mkdirSync(targetDir, { recursive: true });

    const results: { folder: string; filename: string }[] = [];

    for (const file of input.files) {
        const ext = path.extname(file.name).toLowerCase();
        if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
            throw new Error(`File type \"${ext}\" is not supported (allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")})`);
        }

        let filename = sanitizeFileName(file.name);
        let targetPath = path.join(targetDir, filename);

        if (fs.existsSync(targetPath)) {
            const parsed = path.parse(filename);
            filename = `${parsed.name}-${Date.now()}${parsed.ext}`;
            targetPath = path.join(targetDir, filename);
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(targetPath, buffer);

        const meta: Record<string, string> = {};
        if (input.title?.trim()) meta.title = input.title.trim();
        if (input.summary?.trim()) meta.summary = input.summary.trim();
        if (input.notes?.trim()) meta.notes = input.notes.trim();

        if (Object.keys(meta).length > 0) {
            fs.writeFileSync(path.join(targetDir, `.${filename}.meta.json`), JSON.stringify(meta));
        }

        results.push({ folder, filename });
    }

    return results;
}