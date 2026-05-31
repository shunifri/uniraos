import { describe, it, expect } from "vitest";
import { resolveParams, injectCalculateContext } from "../../src/skills/meta-skills.js";

describe("resolveParams", () => {
  const originalInput = { name: "Alice", age: 30, nested: { city: "Beijing" } };
  const results = {
    step1: { success: true, data: { lat: 39.9, lng: 116.4 } },
    step2: { success: true, data: { temp: 25, weather: "sunny" } },
    weather: { temp: 28, humidity: 60 },
  };

  // ─── $input references ───
  it("should resolve $input to entire original input", () => {
    const resolved = resolveParams({ body: "$input" }, results, originalInput);
    expect(resolved.body).toEqual(originalInput);
  });

  it("should resolve $input.field to nested field", () => {
    const resolved = resolveParams({ name: "$input.name", age: "$input.age" }, results, originalInput);
    expect(resolved.name).toBe("Alice");
    expect(resolved.age).toBe(30);
  });

  it("should resolve $input.nested.field to deeply nested value", () => {
    const resolved = resolveParams({ city: "$input.nested.city" }, results, originalInput);
    expect(resolved.city).toBe("Beijing");
  });

  it("should return undefined for missing $input.field", () => {
    const resolved = resolveParams({ missing: "$input.nonexistent" }, results, originalInput);
    expect(resolved.missing).toBeUndefined();
  });

  // ─── $steps references ───
  it("should resolve $steps.stepKey to result value", () => {
    const resolved = resolveParams({ lat: "$steps.step1" }, results, originalInput);
    expect(resolved.lat).toEqual(results.step1);
  });

  it("should resolve $steps.stepKey.field to nested value", () => {
    const resolved = resolveParams({ lat: "$steps.step1.data.lat", lng: "$steps.step1.data.lng" }, results, originalInput);
    expect(resolved.lat).toBe(39.9);
    expect(resolved.lng).toBe(116.4);
  });

  it("should resolve $steps with multiple path segments", () => {
    const resolved = resolveParams({ temp: "$steps.step2.data.temp" }, results, originalInput);
    expect(resolved.temp).toBe(25);
  });

  it("should return undefined for missing $steps path", () => {
    const resolved = resolveParams({ missing: "$steps.nonexistent" }, results, originalInput);
    expect(resolved.missing).toBeUndefined();
  });

  it("should return undefined for missing nested $steps path", () => {
    const resolved = resolveParams({ missing: "$steps.step1.nonexistent.deep" }, results, originalInput);
    expect(resolved.missing).toBeUndefined();
  });

  // ─── String interpolation (embedded $refs) ───
  it("should interpolate $steps references inside strings", () => {
    const resolved = resolveParams(
      { body: '{"lat": $steps.step1.data.lat, "lng": $steps.step1.data.lng}' },
      results,
      originalInput,
    );
    expect(resolved.body).toBe('{"lat": 39.9, "lng": 116.4}');
  });

  it("should interpolate $input references inside strings", () => {
    const resolved = resolveParams({ greeting: "Hello, $input.name!" }, results, originalInput);
    expect(resolved.greeting).toBe("Hello, Alice!");
  });

  it("should interpolate string values directly without quotes", () => {
    const strResults = { step1: { data: { city: "Shanghai" } } };
    const resolved = resolveParams({ body: "City: $steps.step1.data.city" }, strResults, originalInput);
    expect(resolved.body).toBe("City: Shanghai");
  });

  it("should JSON-stringify non-string interpolated values", () => {
    const resolved = resolveParams({ body: "Age: $input.age" }, results, originalInput);
    expect(resolved.body).toBe("Age: 30");
  });

  it("should handle multiple interpolations in one string", () => {
    const resolved = resolveParams(
      { query: "$input.name lives in $input.nested.city" },
      results,
      originalInput,
    );
    expect(resolved.query).toBe("Alice lives in Beijing");
  });

  it("should leave plain strings without $refs unchanged", () => {
    const resolved = resolveParams({ msg: "Hello world" }, results, originalInput);
    expect(resolved.msg).toBe("Hello world");
  });

  // ─── Array values ───
  it("should resolve $refs inside arrays", () => {
    const resolved = resolveParams({ items: ["$input.name", "$steps.step1.data.lat"] }, results, originalInput);
    expect(resolved.items).toEqual(["Alice", 39.9]);
  });

  it("should leave non-$ref array items unchanged", () => {
    const resolved = resolveParams({ items: ["static", 42, true] }, results, originalInput);
    expect(resolved.items).toEqual(["static", 42, true]);
  });

  // ─── Nested objects ───
  it("should recursively resolve nested objects", () => {
    const resolved = resolveParams(
      { config: { url: "$steps.step1.data.lat", name: "$input.name" } },
      results,
      originalInput,
    );
    expect(resolved.config).toEqual({ url: 39.9, name: "Alice" });
  });

  it("should handle deeply nested objects with interpolations", () => {
    const resolved = resolveParams(
      { outer: { inner: { body: '{"lat": $steps.step1.data.lat}' } } },
      results,
      originalInput,
    );
    expect(resolved.outer).toEqual({ inner: { body: '{"lat": 39.9}' } });
  });

  // ─── Edge cases ───
  it("should handle empty param template", () => {
    const resolved = resolveParams({}, results, originalInput);
    expect(resolved).toEqual({});
  });

  it("should handle null and undefined values in results", () => {
    const nullResults = { step1: null, step2: undefined };
    const resolved = resolveParams({ a: "$steps.step1", b: "$steps.step2" }, nullResults, originalInput);
    expect(resolved.a).toBeNull();
    expect(resolved.b).toBeUndefined();
  });

  it("should handle special characters in interpolated strings", () => {
    const specialInput = { text: 'hello "world"' };
    const resolved = resolveParams({ body: "$input.text" }, results, specialInput);
    expect(resolved.body).toBe('hello "world"');
  });

  it("should not interfere with strings containing $ but not as refs", () => {
    const resolved = resolveParams({ price: "$100", code: "USD $50" }, results, originalInput);
    expect(resolved.price).toBe("$100");
    expect(resolved.code).toBe("USD $50");
  });

  it("should handle $refs that resolve to objects", () => {
    const resolved = resolveParams({ data: "$steps.step1.data" }, results, originalInput);
    expect(resolved.data).toEqual({ lat: 39.9, lng: 116.4 });
  });

  it("should handle boolean and number values correctly", () => {
    const resolved = resolveParams(
      { active: "$input.age", flag: "$steps.weather.temp" },
      results,
      originalInput,
    );
    expect(resolved.active).toBe(30);
    expect(resolved.flag).toBe(28);
  });

  it("should NOT interpolate $refs inside expression field", () => {
    // expression 是代码/表达式，不应被 resolveParams 预处理
    const resolved = resolveParams(
      { expression: "$steps.step1.data.lat + $input.name" },
      results,
      originalInput,
    );
    expect(resolved.expression).toBe("$steps.step1.data.lat + $input.name");
  });

  it("should still interpolate $refs in non-expression string fields", () => {
    const resolved = resolveParams(
      { query: "$steps.step1.data.lat", expression: "$steps.step1.data.lat" },
      results,
      originalInput,
    );
    expect(resolved.query).toBe(39.9);
    expect(resolved.expression).toBe("$steps.step1.data.lat");
  });
});

describe("injectCalculateContext", () => {
  const results = {
    step1: { success: true, data: { lat: 39.9 } },
    step2: { temp: 25 },
    $input: { name: "Alice" },
  };

  it("should inject context for calculate skill", () => {
    const params = { expression: "lat + 10" };
    const final = injectCalculateContext("calculate", params, results);
    expect(final.context).toBeDefined();
    expect(final.context).toEqual({
      input: { name: "Alice" },
      step1: { lat: 39.9 },
      step2: { temp: 25 },
    });
  });

  it("should unwrap .data from result objects", () => {
    const final = injectCalculateContext("calculate", { expression: "1+1" }, results);
    expect(final.context.step1).toEqual({ lat: 39.9 });
  });

  it("should pass through non-result values as-is", () => {
    const final = injectCalculateContext("calculate", { expression: "1+1" }, results);
    expect(final.context.step2).toEqual({ temp: 25 });
  });

  it("should skip $input metadata", () => {
    const final = injectCalculateContext("calculate", { expression: "1+1" }, results);
    expect(final.context.$input).toBeUndefined();
  });

  it("should not inject context when params already has context", () => {
    const params = { expression: "x + 1", context: { x: 99 } };
    const final = injectCalculateContext("calculate", params, results);
    expect(final.context).toEqual({ x: 99 });
  });

  it("should pass through unchanged for non-calculate skills", () => {
    const params = { url: "https://example.com" };
    const final = injectCalculateContext("http_call", params, results);
    expect(final).toEqual(params);
    expect(final.context).toBeUndefined();
  });

  it("should handle empty results", () => {
    const final = injectCalculateContext("calculate", { expression: "1+1" }, {});
    expect(final.context).toEqual({});
  });

  it("should preserve other params when injecting context", () => {
    const params = { expression: "lat + temp", timeout: 5000 };
    const final = injectCalculateContext("calculate", params, results);
    expect(final.expression).toBe("lat + temp");
    expect(final.timeout).toBe(5000);
    expect(final.context).toBeDefined();
  });
});
