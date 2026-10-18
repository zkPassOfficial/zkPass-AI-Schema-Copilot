# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Clarified implemented capture/replay scope, storage lifetime, AI input boundaries, and documentation verification limits; aligned formatting guidance and translated two diagram labels. No runtime behavior changed.
- Prepared the repository for open-source release: added MIT license, contributing and security guides, expanded README (tech stack, development, permissions, privacy), and package metadata.
- Removed committed build artifacts and unused reference fixtures from the repository.

## [2.0.0]

### Added
- Deep Agent workflow: a supervisor coordinates lookup, capture, AI analysis, schema building, confirmation gates, and verification.
- Lookup-first field selection via the public zkPass lookup service.
- In-extension zkTLS verification through `@zkpass/transgate-extension-sdk` running in the background service worker.
- Side panel chat UI with schema preview, captured-API export, and verification controls.
- Options page for configuring Claude-compatible or OpenAI-compatible providers with a connection test.
