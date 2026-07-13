import { getPublicIndexEntries } from "../../lib/community";
import { getPublicSiteUrl } from "../../lib/db";

export async function GET() {
  const baseUrl = getPublicSiteUrl();
  const threads = await getPublicIndexEntries(500);
  const lines = [
    "# tscircuit Community Index",
    "",
    "> Server-rendered discussions from the tscircuit support and contributor Discord channels.",
    "",
    "The index excludes AnswerOverflow-authored content and refreshes every 15 minutes.",
    "Each discussion has an HTML page and a plain-text representation at /thread/{id}/raw.",
    "",
    "## Discussions",
    "",
    ...threads.flatMap((thread) => [
      "- [" + thread.title + "](" + baseUrl + "/thread/" + thread.id + ")",
      "  Channel: #" + thread.parent_name,
      "  " + (thread.excerpt || "Community discussion"),
    ]),
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=900, stale-while-revalidate=86400",
    },
  });
}
