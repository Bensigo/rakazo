import { Axiom } from "@axiomhq/js";
import { createServiceLogger } from "./env.js";
import { installLogger } from "./logger.js";
import { guardedFlush, guardedWrite, reportSinkError } from "./sink-guard.js";
import type { LogEvent, Logger, LogSink } from "./types.js";

export interface AxiomIngestClient {
  ingest(dataset: string, events: object[]): void;
  flush(): Promise<void>;
}

export interface AxiomSinkOptions {
  dataset: string;
  token?: string;
  edge?: string;
  edgeUrl?: string;
  client?: AxiomIngestClient;
}

export type AxiomFromEnv =
  | { sink: LogSink; warning?: undefined }
  | { sink?: undefined; warning: string }
  | { sink?: undefined; warning?: undefined };

export function createAxiomSink(options: AxiomSinkOptions): LogSink {
  const client =
    options.client ??
    new Axiom({
      token: options.token ?? "",
      ...(options.edge ? { edge: options.edge } : {}),
      ...(options.edgeUrl ? { edgeUrl: options.edgeUrl } : {}),
      onError: reportSinkError,
    });
  const dataset = options.dataset;
  return {
    write(event: LogEvent) {
      guardedWrite(() => {
        client.ingest(dataset, [event]);
      }, event);
    },
    flush() {
      return guardedFlush(() => client.flush());
    },
  };
}

export function createAxiomSinkFromEnv(
  source: NodeJS.ProcessEnv = process.env,
  client?: AxiomIngestClient,
): AxiomFromEnv {
  const token = source.AXIOM_TOKEN?.trim();
  const dataset = source.AXIOM_DATASET?.trim();
  const edge = source.AXIOM_EDGE?.trim() || undefined;
  const edgeUrl = source.AXIOM_EDGE_URL?.trim() || undefined;
  const partial = Boolean(token || dataset || edge || edgeUrl);
  if (token && dataset) {
    return {
      sink: createAxiomSink({
        token,
        dataset,
        edge,
        edgeUrl,
        client,
      }),
    };
  }
  if (partial) {
    return {
      warning: "Axiom logging is disabled; AXIOM_TOKEN and AXIOM_DATASET must both be set.",
    };
  }
  return {};
}

export function createRootLogger(service: string, env: NodeJS.ProcessEnv = process.env): Logger {
  const axiom = createAxiomSinkFromEnv(env);
  const logger = createServiceLogger({
    service,
    env,
    extraSinks: axiom.sink ? [axiom.sink] : [],
  });
  if (axiom.warning) logger.warn(axiom.warning);
  installLogger(logger);
  return logger;
}
