/** @type {import('next').NextConfig} */
const nextConfig = {
  // Railway runs this as a long-running Node server (`next start`), which
  // is what the reconcile pass needs - it fans out dozens of ZenHR calls
  // and would outlive a serverless function's budget.
  // This app lives beside the dashboard project in the same repo, each with
  // its own lockfile - point Next at this directory so it doesn't infer the
  // repo root as the workspace.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
