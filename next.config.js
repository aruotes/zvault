/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ── Turbopack configuration (Next.js 16 default bundler) ─────────────────
  turbopack: {
    resolveAlias: {
      // Stub out @coinbase/cdp-sdk x402 transitive deps that are server-only
      // Coinbase payment protocol modules — they don't belong in the browser
      // bundle and break the build when @wagmi/connectors → @base-org/account
      // → @coinbase/cdp-sdk tries to resolve them.
      '@x402/core':             './src/stubs/empty.js',
      '@x402/core/client':      './src/stubs/empty.js',
      '@x402/evm':              './src/stubs/empty.js',
      '@x402/evm/exact/client': './src/stubs/empty.js',
      '@x402/evm/upto/client':  './src/stubs/empty.js',
      '@x402/svm/exact/client': './src/stubs/empty.js',
    },
  },
};

module.exports = nextConfig;
