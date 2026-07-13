import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getThread } from "../../../lib/community";
import { parseJsonList, relativeTime } from "../../../lib/db";

function avatarInitial(name: string) {
  return name.slice(0, 1).toUpperCase();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { thread } = await getThread(id);
  if (!thread) return { title: "Discussion not found" };
  return {
    title: thread.title + " · tscircuit Community",
    description: thread.excerpt,
  };
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { thread, messages } = await getThread(id);
  if (!thread) notFound();
  const tags = parseJsonList(thread.tags_json);

  return (
    <main className="detailPage">
      <header className="siteHeader">
        <Link className="brand" href="/">
          <span className="brandMark" aria-hidden="true"><i /><i /><i /></span>
          <span>tscircuit <b>community</b></span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/">Browse index</Link>
          <a className="discordButton" href={thread.discord_url}>Open in Discord <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <div className="detailShell">
        <Link className="backLink" href="/">← Back to community index</Link>
        <article className="threadDetail">
          <div className="detailEyebrow">
            <span># {thread.parent_name}</span>
            <span>·</span>
            <span>{thread.archived ? "Archived" : "Active"}</span>
          </div>
          <h1>{thread.title}</h1>
          <p className="detailExcerpt">{thread.excerpt}</p>
          <div className="detailMeta">
            <span>Started by <b>{thread.creator_name}</b></span>
            <span>{new Date(thread.created_at).toLocaleDateString("en", { dateStyle: "medium" })}</span>
            <span>{thread.message_count} messages</span>
          </div>
          <div className="tagRow detailTags">
            {tags.map((tag) => <Link className="tag" href={"/?tag=" + encodeURIComponent(tag)} key={tag}>{tag}</Link>)}
          </div>
        </article>

        <section className="conversation" aria-label="Discussion messages">
          <div className="conversationHeader">
            <h2>Discussion</h2>
            <span>Last active {relativeTime(thread.last_activity_at)}</span>
          </div>
          {messages.map((message, index) => {
            let attachments: Array<{ id: string; filename: string; url: string }> = [];
            try { attachments = JSON.parse(message.attachments_json); } catch {}
            return (
              <article className={index === 0 ? "message starterMessage" : "message"} key={message.id}>
                {message.author_avatar ? (
                  <img className="messageAvatar" src={message.author_avatar} alt="" />
                ) : (
                  <span className="messageAvatar avatarFallback" aria-hidden="true">{avatarInitial(message.author_name)}</span>
                )}
                <div className="messageBody">
                  <div className="messageMeta">
                    <b>{message.author_name}</b>
                    {index === 0 && <span className="starterBadge">thread author</span>}
                    <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</time>
                  </div>
                  <div className="messageContent">{message.content || <i>Shared an attachment</i>}</div>
                  {attachments.length > 0 && (
                    <div className="attachments">
                      {attachments.map((attachment) => (
                        <a href={attachment.url} key={attachment.id}>↗ {attachment.filename}</a>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
          {messages.length === 0 && <div className="emptyConversation">Messages will appear after the next index refresh.</div>}
        </section>
        <div className="discordCta">
          <div>
            <p>Want to add to the conversation?</p>
            <span>Reply in Discord so your notes stay connected to the source.</span>
          </div>
          <a href={thread.discord_url}>Continue in Discord ↗</a>
        </div>
      </div>
    </main>
  );
}
