import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mock-first front end. Prisma + Anthropic extraction attach behind the
  // data layer later (plan U3 / U5) without changing the UI.

  // A stray lockfile in the home directory makes Next infer the wrong
  // workspace root; pin tracing to this project.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
