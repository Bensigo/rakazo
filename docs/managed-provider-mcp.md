# Managed provider MCP boundary

Composio and Pipedream run in the dedicated `@rakazo/provider-mcp` process. Only that process receives `COMPOSIO_API_KEY`, `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID`, `PIPEDREAM_ENVIRONMENT`, and `ENCRYPTION_KEY`.

API and worker configure `MANAGED_PROVIDER_MCP_URL` and a separate random `MANAGED_PROVIDER_MCP_TOKEN`. They inject `ManagedProviderMcpClient` into the existing `ManagedConnectorProvider` slots, preserving the actor-scoped connection routes and connector registry. Provider credentials never cross the MCP boundary or enter browser, core, executor, or connection rows. API and worker retain their own `ENCRYPTION_KEY` for application secrets; the provider service may use a distinct `PIPEDREAM_IDENTITY_SECRET` for its external-user HMAC.

The endpoint is an explicitly configured internal Streamable HTTP MCP endpoint at `/mcp`. Loopback HTTP is allowed for local development. Private Compose hostnames over HTTP require the explicit `MANAGED_PROVIDER_MCP_ALLOW_INTERNAL_HTTP=true` opt-in; public/non-loopback deployments should use HTTPS. The service validates bearer authentication, provider identity, bounded context and call payloads, and bounded serialized results. User-installed MCP sources continue to use their existing HTTPS/public-DNS and encrypted per-user credential policy.

Start the service with `pnpm --filter @rakazo/provider-mcp start`. Provider credentials should be supplied through the service's private environment or secret manager, never through API/worker Compose environment entries.
