import ReviewSession from "../components/ReviewSession";
import PageHeader from "../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
    const params = await searchParams;
    const folder = params?.folder;

    return (
        <>
            <PageHeader
                title={`Review${folder ? `: ${folder}` : ""}`}
                actions={
                    <a className="icon-button" href="/" aria-label="Back to overview" title="Back to overview">
                        <i className="fa-solid fa-arrow-left"></i>
                    </a>
                }
            />

            <main>
                <ReviewSession folder={folder} />
            </main>
        </>
    );
}
