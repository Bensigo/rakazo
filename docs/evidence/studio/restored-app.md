# Isolated restored application verification

Verified 2026-09-05 using synthetic QA data. App source:
`dccac8c2d28d1d2d521ab54dc4afae85772c5085`; parent distribution source:
`a518e760d5e0585fcaf365434058c921c301c47a`. Backup implementation:
`948f5c145f118e3f5e593016c3c60c1a4bf345dd`.

The task-owned API and supervisor were stopped; the worker was already stopped.
Copies of both QA databases were restored into a unique disposable Compose
PostgreSQL project. The actual `studio backup` command then captured both databases
and durable data, and `studio restore` created fresh `full_app_check_app` and
`full_app_check_knowledge` databases plus a separate data directory. No original
database, data directory or production service was overwritten.

The API was started against the restored databases and data directory, retaining
its separately protected application encryption/authentication configuration.
The real browser could read the authenticated Studio workspace, two persisted
specialists, the unaccepted assignment, and its completed model response. The
restored wiki retained the original immutable snapshot, repository commit and
README line citation. All 365 restored durable files matched the backup manifest
checksums. Chromium singleton runtime locks were excluded by the documented policy.

The screenshots show actual restored app responses, not mocked RPCs. The model
response was read from the restored conversation; the model was not rerun and the
assignment was not accepted. The dedicated provider MCP service also started with
no configured Composio/Pipedream credentials; its health reported both disabled.

This proves an isolated local restored app read path. It is not production
cutover, disaster-recovery timing, a newly executed restored worker assignment,
physical-device verification or human acceptance.
