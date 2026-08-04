import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAllDocumentsByFolder, updateDocumentFolderAndPaths, deleteFolderRows } from "@/lib/db";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");
const MATERIAL_ROOT = path.join(DATA_ROOT, "material");
const GENERATED_ROOT = path.join(DATA_ROOT, "generated");

function sanitizeFolderName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ folder: string }> }) {
    const { folder: oldFolder } = await params;

    const body = await request.json().catch(() => null);
    const newFolder = sanitizeFolderName(typeof body?.name === "string" ? body.name : "");

    if (!newFolder) {
        return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
    }
    if (newFolder === oldFolder) {
        return NextResponse.json({ ok: true, folder: newFolder });
    }

    const oldMaterialDir = path.join(MATERIAL_ROOT, oldFolder);
    const newMaterialDir = path.join(MATERIAL_ROOT, newFolder);

    if (fs.existsSync(newMaterialDir)) {
        return NextResponse.json({ error: "A folder with this name already exists" }, { status: 409 });
    }

    if (fs.existsSync(oldMaterialDir)) {
        fs.renameSync(oldMaterialDir, newMaterialDir);
    }

    const oldGeneratedDir = path.join(GENERATED_ROOT, oldFolder);
    const newGeneratedDir = path.join(GENERATED_ROOT, newFolder);
    if (fs.existsSync(oldGeneratedDir)) {
        fs.renameSync(oldGeneratedDir, newGeneratedDir);
    }

    const docs = getAllDocumentsByFolder(oldFolder);
    for (const doc of docs) {
        const newFilePath = doc.file_path.replace(oldMaterialDir, newMaterialDir);
        const newHtmlPath = doc.html_path ? doc.html_path.replace(`/${oldFolder}/`, `/${newFolder}/`) : doc.html_path;
        updateDocumentFolderAndPaths(doc.id, newFolder, newFilePath, newHtmlPath);
    }

    return NextResponse.json({ ok: true, folder: newFolder });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ folder: string }> }) {
    const { folder } = await params;

    deleteFolderRows(folder);

    const materialDir = path.join(MATERIAL_ROOT, folder);
    if (fs.existsSync(materialDir)) fs.rmSync(materialDir, { recursive: true, force: true });

    const generatedDir = path.join(GENERATED_ROOT, folder);
    if (fs.existsSync(generatedDir)) fs.rmSync(generatedDir, { recursive: true, force: true });

    return NextResponse.json({ ok: true });
}
