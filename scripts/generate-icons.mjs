import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build");
const sourceArg = process.argv[2];
const defaultSource = path.join(buildDir, "icon.png");
const sourcePath = path.resolve(sourceArg ?? defaultSource);

if (!fs.existsSync(sourcePath)) {
  console.error(`Icon source not found: ${sourcePath}`);
  process.exit(1);
}

// sips and iconutil ship with macOS and exist nowhere else, so off-macOS fall
// back to the Pillow writer, which emits the same ic07-ic14 chunk set.
function hasMacIconTools() {
  try {
    execFileSync("which", ["sips", "iconutil"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasMacIconTools()) {
  execFileSync("python3", [path.join(__dirname, "generate-icons.py"), sourcePath], {
    stdio: "inherit"
  });
  process.exit(0);
}

const iconPngPath = path.join(buildDir, "icon.png");
execFileSync("sips", ["-s", "format", "png", sourcePath, "--out", iconPngPath, "-z", "1024", "1024"], {
  stdio: "inherit"
});

const iconsetDir = path.join(buildDir, "icon.iconset");
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

for (const size of [16, 32, 128, 256, 512]) {
  const double = size * 2;
  execFileSync(
    "sips",
    ["-z", String(size), String(size), iconPngPath, "--out", path.join(iconsetDir, `icon_${size}x${size}.png`)],
    { stdio: "ignore" }
  );
  execFileSync(
    "sips",
    [
      "-z",
      String(double),
      String(double),
      iconPngPath,
      "--out",
      path.join(iconsetDir, `icon_${size}x${size}@2x.png`)
    ],
    { stdio: "ignore" }
  );
}

execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(buildDir, "icon.icns")], {
  stdio: "inherit"
});
fs.rmSync(iconsetDir, { recursive: true, force: true });

console.log(`Generated ${path.join(buildDir, "icon.png")}`);
console.log(`Generated ${path.join(buildDir, "icon.icns")}`);
