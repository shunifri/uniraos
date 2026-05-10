import { describe, it, expect } from "vitest";
import { httpRequestDuration, httpRequestsTotal } from "../../src/metrics/http-metrics.js";

describe("http-metrics", () => {
  it("should have correct histogram configuration", () => {
    expect(httpRequestDuration.name).toBe("http_request_duration_seconds");
    expect(httpRequestDuration.labelNames).toContain("method");
    expect(httpRequestDuration.labelNames).toContain("route");
    expect(httpRequestDuration.labelNames).toContain("status_code");
  });

  it("should have correct counter configuration", () => {
    expect(httpRequestsTotal.name).toBe("http_requests_total");
    expect(httpRequestsTotal.labelNames).toContain("method");
    expect(httpRequestsTotal.labelNames).toContain("status_code");
  });
});
