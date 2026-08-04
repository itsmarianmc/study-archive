import { NextRequest, NextResponse } from "next/server";
import { getAppSettings } from "@/lib/db";

interface OllamaTagModel {
    name: string;
    model?: string;
    capabilities?: string[];
}

export async function GET(request: NextRequest) {
    const requestedBaseUrl = request.nextUrl.searchParams.get("baseUrl")?.trim();
    const baseUrl = requestedBaseUrl || getAppSettings().ollamaBaseUrl;

    if (!baseUrl) {
        return NextResponse.json({ error: "No Ollama Base URL configured." }, { status: 400 });
    }

    let url: URL;
    try {
        url = new URL("/api/tags", baseUrl);
    } catch {
        return NextResponse.json({ error: "Ollama Base URL is not a valid URL." }, { status: 400 });
    }

    try {
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
            return NextResponse.json({ error: `Ollama responded with ${res.status}` }, { status: 502 });
        }

        const data = await res.json();
        const models: OllamaTagModel[] = Array.isArray(data?.models) ? data.models : [];

        const result = models
            .map((m) => ({
                name: m.name ?? m.model ?? "",
                isVision: Array.isArray(m.capabilities) && m.capabilities.includes("vision"),
            }))
            .filter((m) => m.name)
            .sort((a, b) => a.name.localeCompare(b.name));

        return NextResponse.json({ models: result });
    } catch (err) {
        return NextResponse.json(
            { error: `Could not reach Ollama at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}` },
            { status: 502 }
        );
    }
}
