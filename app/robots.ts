import type { MetadataRoute } from "next";
import { getPublicSiteUrl } from "../lib/db";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: baseUrl + "/sitemap.xml",
  };
}
