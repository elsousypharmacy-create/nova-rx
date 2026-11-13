// Build/version info (N95). BUILD_SHA is injected at deploy time via a Worker var; default 'dev'.
export const VERSION = '0.1.0';

export function getVersionInfo(env) {
  const sha = String((env && env.BUILD_SHA) || 'dev').slice(0, 40);
  return { version: VERSION, sha, env: String((env && env.NOVA_ENV) || 'dev') };
}

// Compare dotted numeric versions; returns -1, 0 or 1.
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
