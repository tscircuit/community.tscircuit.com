import type { Metadata } from "next";
import Link from "next/link";
import { getIndexData, type ThreadSummary } from "../lib/community";
import { parseJsonList, relativeTime } from "../lib/db";

export const metadata: Metadata = {
  title: "tscircuit Community Index",
  description: "Search practical answers, experiments, and discoveries from the tscircuit Discord community.",
};

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) return <img className="avatar" src={src} alt="" />;
  return (
    <span className="avatar avatarFallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ThreadCard({ thread }: { thread: ThreadSummary }) {
  const tags = parseJsonList(thread.tags_json);
  return (
    <article className="threadCard">
      <Link className="threadCardLink" href={"/thread/" + thread.id}>
        <div className="cardTopline">
          <span className="channelName"># {thread.parent_name}</span>
          <span className="activityDot" aria-hidden="true" />
          <time dateTime={thread.last_activity_at}>{relativeTime(thread.last_activity_at)}</time>
        </div>
        <h3>{thread.title}</h3>
        <p>{thread.excerpt || "Open this discussion to read the community’s notes and replies."}</p>
        <div className="tagRow">
          {tags.slice(0, 3).map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
        <div className="cardFooter">
          <span className="author">
            <Avatar src={thread.creator_avatar} name={thread.creator_name} />
            <span>{thread.creator_name}</span>
          </span>
          <span className="replyCount">
            <span aria-hidden="true">↳</span> {thread.message_count} {thread.message_count === 1 ? "message" : "messages"}
          </span>
        </div>
      </Link>
    </article>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; channel?: string }>;
}) {
  const params = await searchParams;
  const data = await getIndexData({
    query: params.q,
    tag: params.tag,
    parent: params.channel,
  });
  const isFiltered = Boolean(params.q || params.tag || params.channel);

  return (
    <main>
      <header className="siteHeader">
        <Link className="brand" href="/">
          <span className="brandMark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>tscircuit <b>community</b></span>
        </Link>
        <nav aria-label="Primary navigation">
          <a href="https://docs.tscircuit.com">Docs</a>
          <a href="https://github.com/tscircuit/tscircuit">GitHub</a>
          <a className="discordButton" href="https://tscircuit.com/discord">Join Discord <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <section className="hero">
        <div className="heroEyebrow">
          <span className="livePulse" aria-hidden="true" />
          Indexed from the tscircuit Discord
        </div>
        <h1>The community’s circuit knowledge, <em>searchable.</em></h1>
        <p className="heroCopy">
          Find practical answers, working experiments, and hard-won discoveries from people building electronics with React.
        </p>
        <form className="searchBox" action="/" method="get">
          <span className="searchGlyph" aria-hidden="true" />
          <input
            aria-label="Search community discussions"
            defaultValue={params.q ?? ""}
            name="q"
            placeholder="Search footprints, autorouting, React, fabrication…"
          />
          {params.tag && <input type="hidden" name="tag" value={params.tag} />}
          {params.channel && <input type="hidden" name="channel" value={params.channel} />}
          <button type="submit">Search</button>
        </form>
        <div className="quickLinks">
          <span>Popular:</span>
          {["footprints", "autorouting", "KiCad", "React"].map((term) => (
            <Link href={"/?q=" + encodeURIComponent(term)} key={term}>{term}</Link>
          ))}
        </div>
      </section>

      <section className="indexShell">
        <aside className="sidebar">
          <div className="sideBlock">
            <p className="sideLabel">Browse channels</p>
            <Link className={!params.channel ? "sideLink active" : "sideLink"} href="/">
              <span>All discussions</span><b>{data.total}</b>
            </Link>
            {data.parents.map((parent) => (
              <Link
                className={params.channel === parent.name ? "sideLink active" : "sideLink"}
                href={"/?channel=" + encodeURIComponent(parent.name)}
                key={parent.name}
              >
                <span># {parent.name}</span><b>{parent.count}</b>
              </Link>
            ))}
          </div>
          <div className="sideBlock">
            <p className="sideLabel">Topics</p>
            <div className="topicCloud">
              {data.tags.map((tag) => (
                <Link
                  className={params.tag === tag.name ? "topicPill selected" : "topicPill"}
                  href={"/?tag=" + encodeURIComponent(tag.name)}
                  key={tag.name}
                >
                  {tag.name} <span>{tag.count}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="indexStats">
            <span><b>{data.total.toLocaleString()}</b> threads</span>
            <span><b>{data.messageTotal.toLocaleString()}</b> messages</span>
            <span><b>{data.contributors.toLocaleString()}</b> contributors</span>
          </div>
        </aside>

        <div className="feed">
          <div className="feedHeader">
            <div>
              <p className="sectionKicker">{isFiltered ? "Search results" : "Recently active"}</p>
              <h2>
                {params.q ? "Results for “" + params.q + "”" : params.tag ? "Tagged “" + params.tag + "”" : params.channel ? "# " + params.channel : "Fresh from the workbench"}
              </h2>
            </div>
            {isFiltered && <Link className="clearFilter" href="/">Clear filters ×</Link>}
          </div>

          {data.threads.length > 0 ? (
            <div className="threadGrid">
              {data.threads.map((thread) => <ThreadCard thread={thread} key={thread.id} />)}
            </div>
          ) : (
            <div className="emptyState">
              <span className="emptyIcon" aria-hidden="true">⌁</span>
              <h3>{data.total === 0 ? "The index is ready for its first sync" : "No matching discussions yet"}</h3>
              <p>
                {data.total === 0
                  ? "Connect the read-only Discord bot and community threads will begin appearing here automatically."
                  : "Try a broader phrase, another channel, or clear the active filters."}
              </p>
              {isFiltered && <Link href="/">Browse every discussion</Link>}
            </div>
          )}

          <div className="syncLine">
            <span className={data.configuration === "connected" ? "syncDot connected" : "syncDot"} />
            {data.lastSync
              ? "Index refreshed " + relativeTime(data.lastSync) + " · checks every 30 minutes"
              : "Waiting for the first Discord sync · checks every 30 minutes"}
          </div>
        </div>
      </section>

      <footer>
        <p>Built from public community conversations. Authors retain their words.</p>
        <div><a href="https://tscircuit.com">tscircuit.com</a><a href="https://docs.tscircuit.com">Documentation</a><a href="https://tscircuit.com/discord">Discord</a></div>
      </footer>
    </main>
  );
}
