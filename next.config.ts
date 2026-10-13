import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The leaderboard reads directly from the local sync database on every
   * request (force-dynamic), so React cache components / partial prefetching
   * are disabled: a prefetched ranking would show pools and APR values that
   * the collector has already superseded.
   */
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
