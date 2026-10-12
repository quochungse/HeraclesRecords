// electron-builder `mac.sign` for a release signed with the project's own
// self-signed certificate. release.yml passes it with `-c.mac.sign=` only when
// that certificate is set up; every other build signs as electron-builder does.
//
// Why an identity of our own, when there is no Apple Developer ID: an ad-hoc
// signature's designated requirement is the build's cdhash, so no two builds
// satisfy each other's. That one fact is behind every macOS update complaint —
//   - Squirrel.Mac refuses an update that does not satisfy the running app's
//     requirement, so ad-hoc builds cannot update in place at all and the app
//     sends the athlete to a DMG in the browser instead (isMacAdHocSigned in
//     updaterService.ts);
//   - that DMG arrives quarantined, so Gatekeeper asks again ("Open Anyway");
//   - the keychain ties "Always Allow" on the app's Safe Storage key to the
//     requirement, so every build asks for the keychain password again.
// Signed with one certificate, the requirement becomes
// `identifier "app.heraclesrecords" and certificate leaf = H"<sha1>"`, which
// every later build satisfies: Squirrel installs it in place, nothing is
// downloaded through a browser, and the keychain answer sticks.
//
// electron-builder only picks an identity `security find-identity -v` lists,
// and a self-signed certificate is never "valid" there without a trust setting
// a CI runner cannot make. So the build asks for ad-hoc (`identity=-`) and this
// swaps in the certificate by its SHA-1 — codesign itself signs with an
// untrusted certificate without complaint (checked 2026-10-12, macOS 15).
// `identityValidation: false` is already set by electron-builder.
const { signAsync } = require("@electron/osx-sign");

module.exports = async function macSign(opts) {
  const identity = process.env.HERACLES_MAC_SIGN_IDENTITY?.trim();
  if (!identity) {
    throw new Error(
      "scripts/mac-sign.cjs needs HERACLES_MAC_SIGN_IDENTITY (the certificate's SHA-1)."
    );
  }

  await signAsync({ ...opts, identity, identityValidation: false });
};
