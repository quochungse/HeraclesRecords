// What a published release offers for download, read from GitHub, and the
// README blocks that state it. The README (scripts/update-readme-release.mjs)
// and the website (site/) both read the release through here, so the version,
// the links and the sizes they show cannot disagree.
//
// The source is the GitHub release, never package.json: between releases
// main carries the next version, and nothing should offer it for download
// before its installers exist. `releases/latest` already leaves out drafts and
// pre-releases.
//
// Installer names come from the release's own assets, matched by shape; they
// are never rebuilt from the artifactName patterns (test:release-artifacts
// holds those against updaterService.ts).

import https from "node:https";

export const REPOSITORY = "quochungse/HeraclesRecords";
const REPO_URL = `https://github.com/${REPOSITORY}`;

const windowsLogo = encodeURIComponent(
  `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M3 5.6l7.6-1.1v7H3zM11.6 4.4L21 3v8.5h-9.4zM3 12.5h7.6v7L3 18.4zM11.6 12.5H21V21l-9.4-1.3z"/></svg>',
  ).toString("base64")}`,
);

// The Windows logo is drawn white already, so it takes no logoColor.
const badge = (message, logo, logoColor = "white") =>
  `https://img.shields.io/badge/${message}-1f2328?style=for-the-badge&logo=${logo}${logoColor ? `&logoColor=${logoColor}` : ""}`;

/**
 * The installers, in the order every list shows them. An `optional` one may be
 * absent from a release (the deb first shipped after 1.0.0) and is then left
 * out of every list; the others must be there.
 */
export const PLATFORMS = [
  {
    id: "mac-arm64",
    os: "macOS",
    variant: "Apple Silicon",
    match: /-arm64\.dmg$/,
    readmeLabel: "**macOS** · Apple Silicon (M1 and later)",
    badgeSrc: badge("macOS-Apple%20Silicon", "apple"),
    badgeAlt: "Download for macOS, Apple Silicon",
  },
  {
    id: "mac-x64",
    os: "macOS",
    variant: "Intel",
    match: /-x64\.dmg$/,
    readmeLabel: "**macOS** · Intel",
    badgeSrc: badge("macOS-Intel", "apple"),
    badgeAlt: "Download for macOS, Intel",
  },
  {
    id: "windows",
    os: "Windows",
    variant: "10 / 11, 64-bit",
    match: /-Setup-[^/]*\.exe$/,
    readmeLabel: "**Windows** 10 / 11 · 64-bit",
    badgeSrc: badge("Windows-10%20%2F%2011", windowsLogo, null),
    badgeAlt: "Download for Windows",
  },
  {
    id: "linux",
    os: "Linux",
    variant: "AppImage, x86-64",
    match: /\.AppImage$/,
    readmeLabel: "**Linux** · AppImage, any distribution",
    badgeSrc: badge("Linux-AppImage", "linux"),
    badgeAlt: "Download for Linux",
  },
  {
    id: "linux-deb",
    os: "Linux",
    variant: "Debian / Ubuntu, x86-64",
    match: /\.deb$/,
    optional: true,
    readmeLabel: "**Linux** · Debian / Ubuntu (.deb)",
    badgeSrc: badge("Linux-.deb", "debian"),
    badgeAlt: "Download for Debian or Ubuntu",
  },
];

/** Bytes as the README has always written them: decimal megabytes, whole. */
export function formatSize(bytes) {
  return `${Math.round(bytes / 1e6)} MB`;
}

/**
 * The parts of a `GET /repos/{repo}/releases/latest` answer that anything
 * here shows. Throws when an installer is missing, so a half-published release
 * fails the job that reads it instead of shipping a README with a dead link.
 */
export function releaseFromApi(json) {
  if (!json || typeof json.tag_name !== "string") {
    throw new Error(`Not a GitHub release: ${JSON.stringify(json)?.slice(0, 200)}`);
  }
  if (json.draft || json.prerelease) {
    throw new Error(`${json.tag_name} is a draft or a pre-release`);
  }
  const tag = json.tag_name;
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const installers = PLATFORMS.flatMap((platform) => {
    const found = assets.filter((asset) => platform.match.test(asset.name));
    if (found.length === 0 && platform.optional) return [];
    if (found.length !== 1) {
      throw new Error(`${tag}: expected one ${platform.id} installer, found ${found.length}`);
    }
    const [asset] = found;
    return {
      id: platform.id,
      os: platform.os,
      variant: platform.variant,
      name: asset.name,
      size: asset.size,
      sizeLabel: formatSize(asset.size),
      url: `${REPO_URL}/releases/download/${tag}/${asset.name}`,
      sha256: typeof asset.digest === "string" && asset.digest.startsWith("sha256:") ? asset.digest.slice(7) : null,
    };
  });
  return {
    tag,
    version: tag.replace(/^v/, ""),
    publishedAt: json.published_at,
    notesUrl: `${REPO_URL}/releases/tag/${tag}`,
    allReleasesUrl: `${REPO_URL}/releases`,
    installers,
  };
}

// node:https rather than fetch: on Windows, Node 24 aborts with a libuv
// assertion when a process that used fetch exits while undici still holds the
// keep-alive socket (Astro's build ends with process.exit).
function httpsGet(url, { headers }) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers, agent: false }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () =>
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json: async () => JSON.parse(body),
        }),
      );
    });
    request.on("error", reject);
    request.setTimeout(20_000, () => request.destroy(new Error(`Timed out reading ${url}`)));
  });
}

/** Reads the latest published release. GITHUB_TOKEN, when set, lifts the rate limit. */
export async function fetchLatestRelease({ token = process.env.GITHUB_TOKEN, fetchImpl = httpsGet } = {}) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "HeraclesRecords-release-data" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for the latest release`);
  }
  return releaseFromApi(await response.json());
}

// README blocks. Each sits between a pair of markers, and only what is between
// them is ever rewritten.

export function renderReadmeBadges(release) {
  const lines = PLATFORMS.flatMap((platform) => {
    const installer = release.installers.find((entry) => entry.id === platform.id);
    if (!installer) return [];
    return `  <a href="${installer.url}"><img src="${platform.badgeSrc}" alt="${platform.badgeAlt}" /></a>`;
  });
  return ['<p align="center">', ...lines, "</p>"].join("\n");
}

export function renderReadmeDownloads(release) {
  const rows = PLATFORMS.flatMap((platform) => {
    const installer = release.installers.find((entry) => entry.id === platform.id);
    if (!installer) return [];
    return `| ${platform.readmeLabel} | [${installer.name}](${installer.url}) | ${installer.sizeLabel} |`;
  });
  return [
    "| Platform | Installer | Size |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `Version ${release.version} · [What's new](${release.notesUrl}) · [All releases](${release.allReleasesUrl}). The app tells you when a new version is out.`,
  ].join("\n");
}

const BLOCKS = {
  badges: renderReadmeBadges,
  downloads: renderReadmeDownloads,
};

/** Rewrites every release block in a README. Throws when a marker is missing or doubled. */
export function updateReadme(readme, release) {
  const eol = readme.includes("\r\n") ? "\r\n" : "\n";
  let text = readme.replace(/\r\n/g, "\n");
  for (const [name, render] of Object.entries(BLOCKS)) {
    const start = `<!-- release:${name}:start -->`;
    const end = `<!-- release:${name}:end -->`;
    const from = text.indexOf(start);
    const to = text.indexOf(end);
    if (from < 0 || to < from || text.indexOf(start, from + 1) >= 0) {
      throw new Error(`README needs exactly one ${start} … ${end} pair`);
    }
    text = `${text.slice(0, from + start.length)}\n${render(release)}\n${text.slice(to)}`;
  }
  return text.replace(/\n/g, eol);
}
