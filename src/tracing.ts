/**
 * P1-21 OpenTelemetry 链路追踪初始化
 * 自动采集 HTTP/Express/FS/MySQL 等调用
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { log } from "./utils/logger.js";

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_TRACES_EXPORTER) {
    const exporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });

    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "raos",
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || "1.0.0",
      }),
      traceExporter: exporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          // 降低不必要的噪声
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });

    sdk.start();
    log("info", "tracing_initialized", { exporter: process.env.OTEL_EXPORTER_OTLP_ENDPOINT });

    process.on("SIGTERM", () => {
      sdk?.shutdown().then(() => log("info", "tracing_shutdown")).catch(() => {});
    });
  }
}

export function shutdownTracing(): Promise<void> {
  return sdk?.shutdown() ?? Promise.resolve();
}
