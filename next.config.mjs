import path from 'node:path';

const root = (import.meta.dirname ?? process.cwd()).split(path.sep).join('/');
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['node:sqlite'],
  // Dev only: keep compiled pages in memory instead of dropping them after 60s (the default keeps 5),
  // so moving around this ~15-route app does not recompile it over and over.
  onDemandEntries: { maxInactiveAge: 24 * 60 * 60 * 1000, pagesBufferLength: 100 },
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.googleusercontent.com' }] },
  webpack: (config, { dev }) => {
    if (dev) {
      // The dev watcher also watched data/ and output/, so every database write (nearly every click,
      // every scheduler tick) and every saved report rebuilt the app. A request that arrived mid-rebuild
      // could read a half-written build manifest and fail with "Unexpected end of JSON input".
      // Next's own defaults (.git, .next, node_modules) are kept; the watcher tests paths with forward slashes.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: new RegExp(`/(\\.git|\\.next|node_modules)(/|$)|^${escape(root)}/(data|output)(/|$)|\\.tsbuildinfo$`),
      };
    }
    return config;
  },
};
export default nextConfig;
