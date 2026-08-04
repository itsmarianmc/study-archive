export type FileStatus = "pending" | "processing" | "done" | "failed";

export interface WatchedFile {
    path: string;
    folder: string;
    filename: string;
    detectedAt: Date;
}
