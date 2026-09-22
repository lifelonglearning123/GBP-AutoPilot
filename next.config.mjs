/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['node:sqlite'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.googleusercontent.com' }] },
};
export default nextConfig;
