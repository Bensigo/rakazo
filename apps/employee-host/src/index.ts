import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HttpEmployeeHostControlPlaneClient, LocalEmployeeHostCompanion, LocalEmployeeHostReceiptSpool, runEmployeeHostCompanion } from "@rakazo/adapters";

const configPath = process.env.RAKAZO_EMPLOYEE_HOST_CONFIG?.trim() || path.join(os.homedir(), ".config", "rakazo", "employee-host.json");
const configStat = await stat(configPath);
if ((configStat.mode & 0o077) !== 0) throw new Error("employee host config must be readable only by its owner");
const config = JSON.parse(await readFile(configPath, "utf8")) as { hostId: string; enrollmentToken: string; controlPlaneUrl: string; workspaceRoot: string };
if (!config.hostId || !config.enrollmentToken || !config.controlPlaneUrl || !config.workspaceRoot) throw new Error("employee host config is incomplete");
const controlPlane = new URL(config.controlPlaneUrl);
const local = ["localhost", "127.0.0.1", "::1"].includes(controlPlane.hostname);
if (controlPlane.protocol !== "https:" && !local) throw new Error("employee host control plane must use HTTPS");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
await runEmployeeHostCompanion({ hostId: config.hostId, enrollmentToken: config.enrollmentToken, companion: new LocalEmployeeHostCompanion(config.workspaceRoot), client: new HttpEmployeeHostControlPlaneClient(config.controlPlaneUrl), signal: controller.signal, spool: new LocalEmployeeHostReceiptSpool(`${path.resolve(configPath)}.receipts`) });
