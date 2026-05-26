# OpenNum SEO Notes

Last updated: 2026-05-26

## Primary Search Intent

OpenNum should be optimized for developers, wallet teams, and Ordinals users searching for a Bitcoin-native identity or resolver layer.

Primary phrases:

- Bitcoin Ordinals identity protocol
- Bitcoin inscription number identity
- Ordinals identity registry
- Bitcoin wallet address resolver
- inscription number to wallet address

Secondary phrases:

- Bitcoin identity layer
- Open Bitcoin identity protocol
- AI agent Bitcoin identity
- Ordinals profile registry
- Bitcoin inscription marketplace
- Bitcoin identity profile

## Implemented

- Added `/robots.txt` with a sitemap reference.
- Added `/sitemap.xml` with canonical public URLs and `lastmod`, including `/market`.
- Added canonical tags to homepage, Explorer, Register, and whitepaper pages.
- Added Open Graph and Twitter Card metadata.
- Added JSON-LD structured data for homepage, Explorer, and Register.
- Added `hreflang` alternates between English and Chinese whitepapers.
- Added `/llms.txt` for AI crawler and answer-engine discovery.
- Aligned homepage title around "Bitcoin Ordinals Identity Protocol".
- Replaced homepage live identity cards with aggregate indexed-number metrics so the homepage does not imply a tiny network.
- Added `/market` metadata and JSON-LD for external marketplace discovery.
- Added profile guestbook and payment-resolution surfaces that strengthen long-tail `/n/:number` identity pages.

## Next SEO Tasks

- Add a 1200x630 social preview image instead of reusing the logo.
- Add Search Console and submit `https://opennum.org/sitemap.xml`.
- Add Bing Webmaster Tools and submit the same sitemap.
- Publish one canonical explainer article: "Bitcoin Ordinals Identity Protocol: What OpenNum Does".
- Add a developer docs page targeting "inscription number to wallet address API".
- Add stable profile metadata for `/n/:number` pages after profile fields are finalized.
- Add dynamic sitemap generation for registered `/n/:number` profile pages once the registry is larger.

## Official Guidance Used

- Google recommends crawlable pages/resources, canonical URLs, sitemap discovery, and structured data where it clarifies page content.
- Google supports the `Sitemap:` directive in `robots.txt`.
- Google treats sitemap URLs as canonical hints, not absolute commands; page-level canonical tags should still be present.
