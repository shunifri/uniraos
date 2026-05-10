import type { WorkflowInstance, WorkflowTask } from "./types.js";

export interface ServiceContext {
  instance: WorkflowInstance;
  task?: WorkflowTask;
  config: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export type ServiceHandler = (context: ServiceContext) => Promise<unknown>;

export class ServiceTaskRegistry {
  private handlers = new Map<string, ServiceHandler>();

  register(name: string, handler: ServiceHandler): void {
    this.handlers.set(name, handler);
  }

  get(name: string): ServiceHandler | undefined {
    return this.handlers.get(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }
}

export async function echoHandler(context: ServiceContext): Promise<unknown> {
  return { echoed: context.config };
}

export async function httpRequestHandler(context: ServiceContext): Promise<unknown> {
  const {
    url,
    method = "GET",
    headers = {},
    body,
    timeout = 30000,
  } = context.config as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    timeout?: number;
  };

  if (!url || typeof url !== "string") {
    throw new Error("http_request requires a valid url");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const fetchBody =
      body !== undefined
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined;

    const response = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const responseBody = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseBody}`);
    }

    try {
      return JSON.parse(responseBody);
    } catch {
      return { status: response.status, body: responseBody };
    }
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

export const defaultRegistry = new ServiceTaskRegistry();
defaultRegistry.register("echo", echoHandler);
defaultRegistry.register("http_request", httpRequestHandler);
