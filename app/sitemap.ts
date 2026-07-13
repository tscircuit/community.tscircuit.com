import type { MetadataRoute } from "next";
import { getPublicIndexEntries } from "../lib/community";
import { getPublicSiteUrl } from "../lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicSiteUrl();
  const threads = await getPublicIndexEntries(5000);
  return [
    {
      url: baseUrl,
      lastModified: threads[0]?.last_activity_at ?? new Date().toISOString(),
      changeFrequency: "hourly",
      priority: 1,
    },
    ...threads.map((thread) => ({
      url: baseUrl + "/thread/" + thread.id,
      lastModified: thread.last_activity_at,
      changeFrequency: "hourly" as const,
      priority: 0.7,
    })),
  ];
}
