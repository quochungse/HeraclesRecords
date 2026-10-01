// Run by Electron itself (not as Node): decrypts one `safeStorage` ciphertext
// passed as the last argument, in base64, and prints the plain value.
// See open-secret-setting.mjs for why the probes need this.
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

// The OS keyring entry is named after the app, so it has to be the app's name
// before `ready`, or the key that opens the value is not the one asked for.
const { name } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")
);
app.setName(name);

app.whenReady().then(() => {
  try {
    const cipher = Buffer.from(process.argv[process.argv.length - 1], "base64");
    process.stdout.write(safeStorage.decryptString(cipher));
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    app.exit(1);
  }
});
