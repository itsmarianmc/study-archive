import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");
const MATERIAL_ROOT = path.join(DATA_ROOT, "material");

function sanitizeFolderName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export async function GET() {
    if (!fs.existsSync(MATERIAL_ROOT)) {
        return NextResponse.json([]);
    }

    const folders = fs
        .readdirSync(MATERIAL_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

    return NextResponse.json(folders);
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null);
    const folder = sanitizeFolderName(typeof body?.name === "string" ? body.name : "");

    if (!folder) {
        return NextResponse.json({ error: "Invalid subject name" }, { status: 400 });
    }

    const materialDir = path.join(MATERIAL_ROOT, folder);
    const generatedDir = path.join(DATA_ROOT, "generated", folder);

    if (fs.existsSync(materialDir) || fs.existsSync(generatedDir)) {
        return NextResponse.json({ error: "A subject with this name already exists" }, { status: 409 });
    }

    fs.mkdirSync(materialDir, { recursive: true });
    fs.mkdirSync(generatedDir, { recursive: true });

    return NextResponse.json({ ok: true, folder });
}
