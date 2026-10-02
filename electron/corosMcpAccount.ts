import { getTrainingHubStatus } from "./trainingHubService";
import type { CorosMcpAccount, CorosMcpRegion } from "./types";

// Training Hub hosts whose account region has its own COROS MCP server.
// Singapore accounts (teamsgapi) have none known, so they keep the current
// endpoint rather than being moved somewhere that may not hold their data.
const TRAINING_HUB_REGIONS: Record<string, CorosMcpRegion> = {
  "teamapi.coros.com": "us",
  "teameuapi.coros.com": "eu",
  "teamcnapi.coros.com": "cn"
};

/**
 * The COROS account this app is signed in with, offered to connect COROS MCP.
 * The email is there only when the login was remembered; the region only while
 * a session is live.
 */
export function getCorosMcpAccount(): CorosMcpAccount {
  const trainingHub = getTrainingHubStatus();
  return {
    email: trainingHub.email,
    region:
      trainingHub.authenticated && trainingHub.baseUrl
        ? TRAINING_HUB_REGIONS[hostname(trainingHub.baseUrl)]
        : undefined
  };
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
