import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");

export async function GET() {
    try {
        const db = new Database(path.join(DATA_ROOT, "study-archive.db"), {
            readonly: true,
            fileMustExist: true,
        });
        db.prepare("SELECT 1").get();
        db.close();

        return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() }, { status: 200 });
    } catch (err) {
        return NextResponse.json(
            { status: "error", message: err instanceof Error ? err.message : String(err) },
            { status: 503 }
        );
    }
}
