import { createProviderMcpHttpServer } from "./server.js";
const service = createProviderMcpHttpServer({
  token: process.env.MANAGED_PROVIDER_MCP_TOKEN ?? "",
  host: process.env.MANAGED_PROVIDER_MCP_HOST ?? "127.0.0.1",
  port: Number(process.env.MANAGED_PROVIDER_MCP_PORT ?? 3180),
});
await service.listen();
console.log("managed provider MCP server listening");
