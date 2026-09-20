import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — keep it outside the server bundle
  // (the run API routes are its first import into the Next build graph).
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
