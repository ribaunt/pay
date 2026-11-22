/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async headers() {
    // Operators who terminate TLS and set HSTS at the proxy can disable the
    // app header to avoid duplicate/conflicting HSTS policies.
    const headers = process.env.HSTS_HEADER === "0"
      ? securityHeaders
      : [
          ...securityHeaders,
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ];
    return [{ source: "/(.*)", headers }];
  },
};

export default nextConfig;
