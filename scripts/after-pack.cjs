const fs = require("node:fs");
const path = require("node:path");
const { listPackage } = require("@electron/asar");

const CLAUDE_WIN32_X64_BINARY =
  "/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe";

function assertClaudeAgentSdkBinaryExcluded(resourcesDir, platform) {
  if (platform !== "win32") {
    return;
  }

  const archivePath = path.join(resourcesDir, "app.asar");
  if (fs.existsSync(archivePath)) {
    const packagedBinary = listPackage(archivePath).find((entry) =>
      entry.replaceAll("\\", "/").endsWith(CLAUDE_WIN32_X64_BINARY)
    );
    if (packagedBinary) {
      throw new Error(
        `Redundant Claude Agent SDK binary was packaged in app.asar: ${packagedBinary}`
      );
    }
  }

  const unpackedBinary = path.join(
    `${archivePath}.unpacked`,
    "node_modules",
    "@anthropic-ai",
    "claude-agent-sdk-win32-x64",
    "claude.exe"
  );
  if (fs.existsSync(unpackedBinary)) {
    throw new Error(
      `Redundant Claude Agent SDK binary was packaged outside app.asar: ${unpackedBinary}`
    );
  }
}

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const resourcesDir =
    platform === "darwin"
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources"
        )
      : path.join(context.appOutDir, "resources");

  assertClaudeAgentSdkBinaryExcluded(resourcesDir, platform);
};

exports.assertClaudeAgentSdkBinaryExcluded =
  assertClaudeAgentSdkBinaryExcluded;
