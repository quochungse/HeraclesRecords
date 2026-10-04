import { syncReleaseVersion } from "./sync-release-version.mjs";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: npm run release:prepare -- v0.1.4");
  process.exit(1);
}

const version = tag.replace(/^v/i, "");
syncReleaseVersion({ fromTag: tag, sync: true });

console.log(`Prepared ${version} in package.json and package-lock.json.`);
console.log(`Before tagging: CHANGELOG.md needs a "## [${version}]" section (it is the release text, and the release fails without it),`);
console.log(`and docs/readme/*.webp should still match the app (the README and the website both show them).`);
console.log(`After the release is published, release.yml rewrites the README's downloads on main and redeploys the website.`);
console.log(`Next: git commit -am "chore: release v${version}" && git tag ${tag} && git push origin main ${tag}`);
