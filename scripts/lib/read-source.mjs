// Reading a source file in order to assert something about its text.
//
// A dozen suites check invariants TypeScript cannot see — an argument passed
// across the IPC bridge, a guard in JSX, a field rebuilt by hand — by matching
// a regex against the file. Those regexes are written with `\n`, because that
// is what the authors' editors show.
//
// The repository has no `.gitattributes`, so on a Windows checkout with
// `core.autocrlf=true` every one of those files arrives with CRLF endings, and
// a pattern spelling `\);\n\s*if \(` no longer matches the `\);\r\n  if (` on
// disk. The suite then fails claiming the code has lost a guard it still has —
// a false report, and a loud one: `test:coach-analysis-lifecycle` said the
// conversation was opened without checking it still existed, which was never
// true.
//
// So a suite reading source for its *content* reads it through here. The line
// ending is a property of the checkout, not of the code, and no assertion in
// this repo is about it.

import { readFileSync } from "node:fs";
import path from "node:path";

/** Read a file and normalize its line endings to `\n`. */
export function readSource(...parts) {
  return readFileSync(path.join(...parts), "utf8").replace(/\r\n/g, "\n");
}

/** A `readSource` bound to a root, for suites that name files relative to it. */
export function sourceReader(root) {
  return (...parts) => readSource(root, ...parts);
}
