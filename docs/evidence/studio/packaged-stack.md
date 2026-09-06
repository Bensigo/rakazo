# Final packaged Studio and update evidence

Local synthetic QA on 2026-09-05. Final application source:
`e99f188af88420f830ef2ed871db0534a6c38e71`. Full parent Dockerfile build produced
`sha256:fee954a3a38d3ba2f28886446a59b148faac442ac4dfa2551e30133299f826c9`.

A unique fresh Compose project first booted app `5b2cb3eb`, applied all 78 database
migrations and initialized the separate canonical knowledge database. Real Chrome
signup and foundation publication/reload succeeded. A production-only missing
catalog defect was corrected in PR #15 (`8d596df1`), reviewed independently with
exact source/catalog ID equality and successful Lingui compilation for eight locales.

The stack was updated to the final image with the same protected configuration,
database and durable-data mount. API, web, provider MCP, supervisor and PostgreSQL
became healthy; the worker logged ready. All five application services used the
same final image digest and had zero restarts. API health returned the exact source
revision. The existing authenticated account and published foundation revision
survived the update and were read through the actual compiled UI.

A separate clean browser displayed the correct Create your Sunrise Studio account
heading. Onboarding rendered readable model controls and Studio navigation rather
than the previously observed generated translation IDs. The attached screenshots
show actual compiled browser state, not fixtures or generated mockups.

Provider MCP ran authenticated on the private Compose network with no configured
Composio, Pipedream, messaging or SMTP accounts. Local signup remained usable because
capabilities correctly reported delivery disabled. No paid provider action or
external email was sent. This proves local packaged startup/update and service
composition; it is not production deployment, vendor delivery or business acceptance.
