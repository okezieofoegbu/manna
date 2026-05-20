// app/robots.js
// Next.js App Router robots convention. Blocks all crawlers from indexing
// the Manna page while it is publicly deployed without an auth gate.
// Replace with proper allowlist once the auth gate lands in v0.1.6.

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
