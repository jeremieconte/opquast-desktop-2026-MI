# Opquast Desktop 2026 Firefox Extension

This WebExtension was generated from the archived Opquast Desktop sources.

It embeds the Opquast checklist JSON files, RGAA 4.1.2 criteria/tests from the
official DINUM repository, and axe-core 4.11.4 for automated DOM accessibility
checks on the final rendered page.

## Development install

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click `Load Temporary Add-on`.
3. Select `manifest.json` in this directory, or select the generated `.xpi`.

The generated XPI is unsigned. Permanent installation in standard Firefox requires signing through Mozilla Add-ons.

## Report

Use `Analyser la page`, then `Rapport HTML`.

The report separates:

- automated axe-core and DOM findings;
- official RGAA 4.1.2 criteria and test methodologies;
- Opquast rules that can be checked from the rendered page;
- rules that are not applicable because the inspected DOM has no matching target;
- rules that still require human judgement.

OCR is intentionally not enabled by default. It can help detect text embedded in
images, but it adds a large WebAssembly OCR payload and is slower than DOM and
axe-core checks.

## Build

From the project root:

```bash
zip -r ../dist/opquast-desktop-2026-firefox.xpi .
```

Run that command inside `firefox-extension/`.
