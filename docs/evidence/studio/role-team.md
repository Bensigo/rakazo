# Persistent employee specialist team

Captured 2026-09-05 from the implemented Studio page using synthetic QA data.
The UI and API ran locally against PostgreSQL, with no mocked RPC responses.
API and production UI checkpoint: `f1fe5d7ac7a780f7fbfb5ab602dca73003e65c40`.
Subsequent aggregate changes during capture affected test fixtures only.

The administrator created Engineer and Reviewer specialist presets and a Game
developer employee job role. Applying the role provisioned two owned persistent
specialists. Reapplying and reloading retained the same two mappings; the
assignment specialist menu also exposed Engineer and Reviewer. The capture shows
the persisted team after another apply/reload cycle.

Backend slice: `cf97f1d6cdc1acf0b6c3c410ddfd440741ca94cf` (87 real PostgreSQL tests,
including concurrent selection, mapping repair and organization restrictions).
UI controls: `cbe3248326fb0a8178d3fb163283de2542858299` (server membership permissions,
ordered defaults and pending apply controls). All 23 aggregate workspace checks
passed at `f1fe5d7a`; the separate browser fixture regression is tracked in PR #8.

This proves local role/team persistence and rendering. It does not constitute
production roster configuration, employee release, native-device verification or
human acceptance of assignment work.
