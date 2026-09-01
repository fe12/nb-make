import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // mathjax-full ships CommonJS with dynamic internal requires. Keeping it
  // external stops the server bundler from trying to statically analyse it.
  serverExternalPackages: ['mathjax-full'],
};

export default nextConfig;
