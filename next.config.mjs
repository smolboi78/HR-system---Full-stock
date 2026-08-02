/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfkit reads its .afm font metrics from disk at runtime using paths
  // relative to its own package - webpack bundling breaks that. Keeping it
  // external makes Next.js require() it normally instead of bundling it.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
