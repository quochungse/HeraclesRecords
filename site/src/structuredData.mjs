// What search engines are told about the app (schema.org SoftwareApplication,
// written as JSON-LD by Base.astro). The version, date and download links come
// from the same release data as the rest of the site.

export function softwareApplication(release, site) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Heracles Records",
    description:
      "A free desktop app for COROS athletes: every session read in depth, an AI coach that has read all of it, and a hall for every record you set.",
    applicationCategory: "SportsApplication",
    operatingSystem: "macOS, Windows, Linux",
    url: new URL("/", site).href,
    image: new URL("/og/home.jpg", site).href,
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@type": "Person", name: "quochungse", url: "https://github.com/quochungse" },
    codeRepository: "https://github.com/quochungse/HeraclesRecords",
    ...(release
      ? {
          softwareVersion: release.version,
          datePublished: release.publishedAt?.slice(0, 10),
          downloadUrl: release.installers.map((entry) => entry.url),
          releaseNotes: release.notesUrl,
        }
      : {}),
  };
}
