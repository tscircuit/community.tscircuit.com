import { getThread } from "../../../../lib/community";
import { getPublicSiteUrl } from "../../../../lib/db";

function attachmentLines(value: string): string[] {
  try {
    const attachments = JSON.parse(value) as Array<{ filename: string; url: string }>;
    return attachments.map((attachment) => {
      const url = attachment.url.startsWith("/")
        ? getPublicSiteUrl() + attachment.url
        : attachment.url;
      return "Attachment: " + attachment.filename + " — " + url;
    });
  } catch {
    return [];
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { thread, messages } = await getThread(id);
  if (!thread) return new Response("Discussion not found.\n", { status: 404 });

  const lines = [
    "# " + thread.title,
    "",
    "Channel: #" + thread.parent_name,
    "Source: " + thread.discord_url,
    "Started: " + thread.created_at,
    "Last activity: " + thread.last_activity_at,
    "",
    ...messages.flatMap((message) => {
      const attachments = attachmentLines(message.attachments_json);
      return [
        "## " + message.author_name + " — " + message.created_at,
        "",
        message.content || (attachments.length ? "[attachment]" : ""),
        ...attachments,
        "",
      ];
    }),
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=900, stale-while-revalidate=86400",
    },
  });
}
