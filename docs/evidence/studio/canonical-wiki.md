# Canonical repository wiki evidence

The screenshot shows the running Studio source/wiki region with synthetic QA data.
Application aggregate: `312f1924e7fe39bc6af35052f25ce83a9f142bc3` (source UI
`17f977ed`, source API `5a1fd9c5`, host receipt fix `25564a99`). The subsequent
artifact commit changes evidence only.

The browser and API run locally. The API uses real PostgreSQL, the canonical
Sunrise bridge and a real local Ollama embedding model. No source RPC is mocked.
A committed synthetic repository was registered by the operator, connected from
the UI, scanned and embedded. After a second repository commit, individual-source
Refresh updated the persisted binding. Wiki list/read displays the new commit,
canonical snapshot, current freshness and `README.md:5-8` citation. Reloading the
Studio page preserved the binding and wiki access.

This proves repository connection, resync and cited wiki reading. It does not
prove model task execution, hosted CI, a refreshed combined Docker image,
production/private source authorization configuration, or human acceptance.
