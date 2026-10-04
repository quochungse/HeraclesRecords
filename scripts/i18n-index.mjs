// npm run i18n:index
//
// Writes src/i18n/messages/<locale>/index.ts for every language from the
// namespaces English has (messages/en/index.ts). A namespace is added to
// English by hand; this puts it in every other language's index, so a
// translation file that exists is never left unloaded.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const messages = path.join(root, "src", "i18n", "messages");
const english = fs.readFileSync(path.join(messages, "en", "index.ts"), "utf8");
const namespaces = [...english.matchAll(/^import (\w+) from "\.\/(\w+)\.ts";$/gm)].map((m) => m[2]);
const locales = fs.readFileSync(path.join(root, "src", "i18n", "locales.ts"), "utf8");
const names = Object.fromEntries(
  [...locales.matchAll(/^\s{2}(\w+): \{ nativeName: "([^"]+)"/gm)].map((m) => [m[1], m[2]])
);

let missing = 0;
for (const locale of Object.keys(names)) {
  if (locale === "en") continue;
  const dir = path.join(messages, locale);
  for (const ns of namespaces) {
    if (!fs.existsSync(path.join(dir, `${ns}.ts`))) {
      console.error(`missing: ${locale}/${ns}.ts`);
      missing += 1;
    }
  }
  const body =
    namespaces.map((ns) => `import ${ns} from "./${ns}.ts";`).join("\n") +
    `\n\n/** ${names[locale]}. Written by scripts/i18n-index.mjs. */\nexport default {\n` +
    namespaces.map((ns) => `  ...${ns},`).join("\n") +
    "\n};\n";
  fs.writeFileSync(path.join(dir, "index.ts"), body);
}
console.log(`${namespaces.length} namespaces × ${Object.keys(names).length - 1} languages${missing ? `, ${missing} files missing` : ""}`);
process.exitCode = missing ? 1 : 0;
