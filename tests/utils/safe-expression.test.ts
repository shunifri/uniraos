import { describe, it, expect } from "vitest";
import { safeEvaluateExpression, safeEvaluateBoolean } from "../../src/utils/safe-expression.js";

describe("safeEvaluateExpression", () => {
  // ─── Basic Arithmetic ───
  it("should evaluate basic arithmetic", () => {
    expect(safeEvaluateExpression("1 + 2")).toBe(3);
    expect(safeEvaluateExpression("10 - 3 * 2")).toBe(4);
    expect(safeEvaluateExpression("(1 + 2) * 3")).toBe(9);
    expect(safeEvaluateExpression("10 / 2")).toBe(5);
    expect(safeEvaluateExpression("10 % 3")).toBe(1);
  });

  it("should handle unary operators", () => {
    expect(safeEvaluateExpression("-5")).toBe(-5);
    expect(safeEvaluateExpression("+5")).toBe(5);
    expect(safeEvaluateExpression("--5")).toBe(5);
    expect(safeEvaluateExpression("+-5")).toBe(-5);
    expect(safeEvaluateExpression("!true")).toBe(false);
    expect(safeEvaluateExpression("!false")).toBe(true);
    expect(safeEvaluateExpression("!0")).toBe(true);
    expect(safeEvaluateExpression("!1")).toBe(false);
  });

  // ─── String Operations ───
  it("should evaluate string concatenation", () => {
    expect(safeEvaluateExpression("'hello' + ' ' + 'world'")).toBe("hello world");
    expect(safeEvaluateExpression('"hello" + "world"')).toBe("helloworld");
  });

  it("should handle string escapes", () => {
    expect(safeEvaluateExpression("'hello\\nworld'")).toBe("hello\nworld");
    expect(safeEvaluateExpression("'hello\\tworld'")).toBe("hello\tworld");
    expect(safeEvaluateExpression("'hello\\\\world'")).toBe("hello\\world");
    expect(safeEvaluateExpression('"hello\\"world"')).toBe('hello"world');
  });

  // ─── Context Variables ───
  it("should access context variables", () => {
    expect(safeEvaluateExpression("a + b", { a: 1, b: 2 })).toBe(3);
    expect(safeEvaluateExpression("name", { name: "Alice" })).toBe("Alice");
    expect(safeEvaluateExpression("obj.nested.value", { obj: { nested: { value: 42 } } })).toBe(42);
  });

  it("should access context variables with bracket notation", () => {
    expect(safeEvaluateExpression('obj["key"]', { obj: { key: 99 } })).toBe(99);
    expect(safeEvaluateExpression("arr[0]", { arr: [10, 20, 30] })).toBe(10);
    expect(safeEvaluateExpression("arr[index]", { arr: [10, 20, 30], index: 1 })).toBe(20);
  });

  it("should throw on unknown identifiers", () => {
    expect(() => safeEvaluateExpression("unknownVar")).toThrow("Unknown identifier: unknownVar");
    expect(() => safeEvaluateExpression("a + b")).toThrow("Unknown identifier: a");
  });

  // ─── Ternary Expressions ───
  it("should evaluate ternary expressions", () => {
    expect(safeEvaluateExpression("a > 5 ? 'big' : 'small'", { a: 10 })).toBe("big");
    expect(safeEvaluateExpression("a > 5 ? 'big' : 'small'", { a: 3 })).toBe("small");
  });

  it("should handle nested ternary expressions", () => {
    expect(safeEvaluateExpression("a > 5 ? (a > 10 ? 'huge' : 'big') : 'small'", { a: 15 })).toBe("huge");
    expect(safeEvaluateExpression("a > 5 ? (a > 10 ? 'huge' : 'big') : 'small'", { a: 7 })).toBe("big");
    expect(safeEvaluateExpression("a > 5 ? (a > 10 ? 'huge' : 'big') : 'small'", { a: 3 })).toBe("small");
  });

  // ─── Comparison Operators ───
  it("should evaluate comparison operators", () => {
    expect(safeEvaluateExpression("a == 5", { a: 5 })).toBe(true);
    expect(safeEvaluateExpression("a === 5", { a: 5 })).toBe(true);
    expect(safeEvaluateExpression("a != 5", { a: 3 })).toBe(true);
    expect(safeEvaluateExpression("a !== 5", { a: 3 })).toBe(true);
    expect(safeEvaluateExpression("a >= 5", { a: 5 })).toBe(true);
    expect(safeEvaluateExpression("a > 5", { a: 6 })).toBe(true);
    expect(safeEvaluateExpression("a <= 5", { a: 5 })).toBe(true);
    expect(safeEvaluateExpression("a < 5", { a: 3 })).toBe(true);
  });

  it("should handle loose vs strict equality", () => {
    expect(safeEvaluateExpression("a == '5'", { a: 5 })).toBe(true);
    expect(safeEvaluateExpression("a === '5'", { a: 5 })).toBe(false);
    expect(safeEvaluateExpression("a != '5'", { a: 5 })).toBe(false);
    expect(safeEvaluateExpression("a !== '5'", { a: 5 })).toBe(true);
  });

  // ─── Logical Operators ───
  it("should evaluate logical operators", () => {
    expect(safeEvaluateExpression("true && true")).toBe(true);
    expect(safeEvaluateExpression("true && false")).toBe(false);
    expect(safeEvaluateExpression("false || true")).toBe(true);
    expect(safeEvaluateExpression("false || false")).toBe(false);
  });

  it("should short-circuit logical operators", () => {
    expect(safeEvaluateExpression("false && unknown")).toBe(false);
    expect(safeEvaluateExpression("true || unknown")).toBe(true);
  });

  // ─── Math Functions ───
  it("should use Math functions", () => {
    expect(safeEvaluateExpression("Math.abs(-5)")).toBe(5);
    expect(safeEvaluateExpression("Math.max(1, 5, 3)")).toBe(5);
    expect(safeEvaluateExpression("Math.min(1, 5, 3)")).toBe(1);
    expect(safeEvaluateExpression("Math.round(3.7)")).toBe(4);
    expect(safeEvaluateExpression("Math.floor(3.7)")).toBe(3);
    expect(safeEvaluateExpression("Math.ceil(3.2)")).toBe(4);
    expect(safeEvaluateExpression("Math.sqrt(16)")).toBe(4);
    expect(safeEvaluateExpression("Math.PI")).toBe(Math.PI);
  });

  // ─── Array & Object Literals ───
  it("should evaluate array literals", () => {
    expect(safeEvaluateExpression("[1, 2, 3]")).toEqual([1, 2, 3]);
    expect(safeEvaluateExpression("[1, 'two', true]")).toEqual([1, "two", true]);
    expect(safeEvaluateExpression("arr[0] + arr[1]", { arr: [10, 20] })).toBe(30);
  });

  it("should evaluate object literals", () => {
    expect(safeEvaluateExpression("{a: 1, b: 'x'}")).toEqual({ a: 1, b: "x" });
    expect(safeEvaluateExpression("obj.a + obj.b", { obj: { a: 1, b: 2 } })).toBe(3);
  });

  it("should handle array methods", () => {
    expect(safeEvaluateExpression("[1, 2, 3].length")).toBe(3);
    expect(safeEvaluateExpression("arr.length", { arr: [1, 2, 3, 4] })).toBe(4);
    expect(safeEvaluateExpression("Array.isArray(arr)", { arr: [1, 2] })).toBe(true);
    expect(safeEvaluateExpression("Array.isArray(arr)", { arr: "not array" })).toBe(false);
  });

  // ─── Null & Boolean ───
  it("should handle null and boolean literals", () => {
    expect(safeEvaluateExpression("null")).toBe(null);
    expect(safeEvaluateExpression("true")).toBe(true);
    expect(safeEvaluateExpression("false")).toBe(false);
    expect(safeEvaluateExpression("a == null", { a: null })).toBe(true);
    expect(safeEvaluateExpression("a === null", { a: null })).toBe(true);
  });

  // ─── Division by Zero ───
  it("should handle division by zero", () => {
    expect(safeEvaluateExpression("1 / 0")).toBe(Infinity);
    expect(safeEvaluateExpression("-1 / 0")).toBe(-Infinity);
    expect(safeEvaluateExpression("0 / 0")).toBeNaN();
    expect(safeEvaluateExpression("1 % 0")).toBeNaN();
  });

  // ─── Empty & Whitespace ───
  it("should throw on empty expression", () => {
    expect(() => safeEvaluateExpression("")).toThrow();
  });

  it("should handle whitespace-only expressions", () => {
    expect(() => safeEvaluateExpression("   ")).toThrow();
  });

  // ─── Security: Blocked Expressions ───
  it("should throw on dangerous expressions", () => {
    expect(() => safeEvaluateExpression("process.exit(1)")).toThrow("Unknown identifier: process");
    expect(() => safeEvaluateExpression("require('fs')")).toThrow("Unknown identifier: require");
    expect(() => safeEvaluateExpression("eval('1+1')")).toThrow("Unknown identifier: eval");
    expect(() => safeEvaluateExpression("this.value")).toThrow("Unknown identifier: this");
    expect(() => safeEvaluateExpression("window.alert(1)")).toThrow("Unknown identifier: window");
    expect(() => safeEvaluateExpression("document.title")).toThrow("Unknown identifier: document");
    expect(() => safeEvaluateExpression("global.value")).toThrow("Unknown identifier: global");
    expect(() => safeEvaluateExpression("console.log(1)")).toThrow("Unknown identifier: console");
  });

  it("should block .constructor prototype chain escape", () => {
    expect(() => safeEvaluateExpression("Math.max.constructor('return process')()")).toThrow('Access to "constructor" is not allowed');
    expect(() => safeEvaluateExpression("Array.from.constructor('return globalThis')()")).toThrow('Access to "constructor" is not allowed');
    expect(() => safeEvaluateExpression("JSON.parse.constructor('return console')()")).toThrow('Access to "constructor" is not allowed');
    expect(() => safeEvaluateExpression("'hello'.constructor('return 1')()")).toThrow('Access to "constructor" is not allowed');
  });

  it("should block __proto__ access", () => {
    expect(() => safeEvaluateExpression("{}.__proto__")).toThrow('Access to "__proto__" is not allowed');
    expect(() => safeEvaluateExpression("[].__proto__")).toThrow('Access to "__proto__" is not allowed');
    expect(() => safeEvaluateExpression("obj.__proto__", { obj: {} })).toThrow('Access to "__proto__" is not allowed');
  });

  it("should block prototype access", () => {
    expect(() => safeEvaluateExpression("Math.prototype")).toThrow('Access to "prototype" is not allowed');
    expect(() => safeEvaluateExpression("Array.prototype")).toThrow('Access to "prototype" is not allowed');
    expect(() => safeEvaluateExpression("obj.prototype", { obj: {} })).toThrow('Access to "prototype" is not allowed');
  });

  it("should block bracket notation prototype escape", () => {
    expect(() => safeEvaluateExpression('Math["constructor"]')).toThrow('Access to "constructor" is not allowed');
    expect(() => safeEvaluateExpression('Math["__proto__"]')).toThrow('Access to "__proto__" is not allowed');
    expect(() => safeEvaluateExpression('Math["prototype"]')).toThrow('Access to "prototype" is not allowed');
    expect(() => safeEvaluateExpression("Math[ctor]", { ctor: "constructor" })).toThrow('Access to "constructor" is not allowed');
  });

  // ─── Context Shadowing ───
  it("should prioritize GLOBAL_WHITELIST over context for Math/Array/etc", () => {
    // Math in GLOBAL_WHITELIST takes precedence over context.Math
    expect(safeEvaluateExpression("Math.PI", { Math: 42 })).toBe(Math.PI);
    expect(safeEvaluateExpression("Array.isArray", { Array: "not array" })).toBe(Array.isArray);
  });

  // ─── Calling Non-Functions ───
  it("should throw when calling non-functions", () => {
    expect(() => safeEvaluateExpression("a()", { a: 42 })).toThrow("Callee is not a function");
    expect(() => safeEvaluateExpression("null()")).toThrow("Callee is not a function");
  });

  // ─── Property Access on Null/Undefined ───
  it("should throw on property access of null or undefined", () => {
    expect(() => safeEvaluateExpression("a.b", { a: null })).toThrow("Cannot read properties of null");
    expect(() => safeEvaluateExpression("a.b", { a: undefined })).toThrow("Cannot read properties of undefined");
  });

  // ─── Deep Nesting ───
  it("should handle deeply nested expressions", () => {
    expect(safeEvaluateExpression("(((((1 + 2)))))")).toBe(3);
    expect(safeEvaluateExpression("a.b.c.d.e", { a: { b: { c: { d: { e: 99 } } } } })).toBe(99);
  });

  // ─── Complex Real-World Expressions ───
  it("should handle complex real-world expressions", () => {
    const ctx = { price: 100, quantity: 3, discount: 0.1, threshold: 200 };
    expect(safeEvaluateExpression("price * quantity * (1 - discount)", ctx)).toBe(270);
    expect(safeEvaluateExpression("price * quantity > threshold ? 'expensive' : 'cheap'", ctx)).toBe("expensive");

    const weather = { temp: 35, humidity: 80 };
    expect(safeEvaluateExpression("temp > 30 && humidity > 70 ? 'hot_humid' : 'ok'", weather)).toBe("hot_humid");
  });

  // ─── Depth Limits ───
  it("should throw on excessively nested parenthesized expressions", () => {
    const deep = "(".repeat(55) + "1" + ")".repeat(55);
    expect(() => safeEvaluateExpression(deep)).toThrow("max parse depth");
  });

  it("should throw on deeply nested binary operations", () => {
    // 110 chained additions exceeds MAX_EVAL_DEPTH (100)
    const deepExpr = "a" + " + a".repeat(110);
    expect(() => safeEvaluateExpression(deepExpr, { a: 1 })).toThrow("max eval depth");
  });

  // ─── JSON Functions ───
  it("should support JSON functions", () => {
    expect(safeEvaluateExpression('JSON.parse(\'{"a":1}\')')).toEqual({ a: 1 });
    expect(safeEvaluateExpression('JSON.stringify({a:1})')).toBe('{"a":1}');
  });

  // ─── String/Number/Date Constructors ───
  it("should support whitelisted constructor methods", () => {
    expect(safeEvaluateExpression("String(123)")).toBe("123");
    expect(safeEvaluateExpression("Number('42')")).toBe(42);
    expect(safeEvaluateExpression("Date.now()")).toEqual(expect.any(Number));
    expect(safeEvaluateExpression("Object.keys({a:1,b:2})")).toEqual(["a", "b"]);
  });

  // ─── undefined, NaN, Infinity ───
  it("should support undefined, NaN, Infinity", () => {
    expect(safeEvaluateExpression("undefined")).toBe(undefined);
    expect(safeEvaluateExpression("NaN")).toBeNaN();
    expect(safeEvaluateExpression("Infinity")).toBe(Infinity);
    expect(safeEvaluateExpression("-Infinity")).toBe(-Infinity);
    expect(safeEvaluateExpression("x === undefined ? 'missing' : 'present'", { x: undefined })).toBe("missing");
  });

  // ─── Method chaining on objects ───
  it("should support Math and JSON method chaining", () => {
    expect(safeEvaluateExpression("JSON.stringify({a:1})")).toBe('{"a":1}');
    expect(safeEvaluateExpression("Math.abs(-5) + Math.round(3.7)")).toBe(9);
    expect(safeEvaluateExpression("Array.isArray([1,2]) && Array.isArray('x')")).toBe(false);
  });

  // ─── Empty and edge expressions ───
  it("should handle empty arrays and objects", () => {
    expect(safeEvaluateExpression("[]")).toEqual([]);
    expect(safeEvaluateExpression("{}")).toEqual({});
    expect(safeEvaluateExpression("[1, 2, 3].length")).toBe(3);
    expect(safeEvaluateExpression("Object.keys({})")).toEqual([]);
  });

  // ─── Nested ternary with complex conditions ───
  it("should handle deeply nested ternary expressions", () => {
    expect(safeEvaluateExpression("a > 5 ? (a > 10 ? 'huge' : 'big') : 'small'", { a: 15 })).toBe("huge");
    expect(safeEvaluateExpression("a > 5 ? (a > 10 ? 'huge' : 'big') : 'small'", { a: 7 })).toBe("big");
    expect(safeEvaluateExpression("a > 5 ? (a > 10 ? 'huge' : 'big') : 'small'", { a: 3 })).toBe("small");
  });

  // ─── Short-circuit edge cases ───
  it("should short-circuit logical operators with falsy values", () => {
    expect(safeEvaluateExpression("0 && unknown")).toBe(0);
    expect(safeEvaluateExpression("'' && unknown")).toBe("");
    expect(safeEvaluateExpression("null && unknown")).toBe(null);
    expect(safeEvaluateExpression("undefined && unknown")).toBe(undefined);
    expect(safeEvaluateExpression("1 || unknown")).toBe(1);
    expect(safeEvaluateExpression("'x' || unknown")).toBe("x");
  });

  // ─── Bracket access edge cases ───
  it("should handle bracket access with variables", () => {
    expect(safeEvaluateExpression("obj[key]", { obj: { a: 1, b: 2 }, key: "a" })).toBe(1);
    expect(safeEvaluateExpression("arr[index]", { arr: [10, 20, 30], index: 2 })).toBe(30);
  });
});

describe("safeEvaluateBoolean", () => {
  it("should evaluate boolean expressions", () => {
    expect(safeEvaluateBoolean("a > 5", { a: 10 })).toBe(true);
    expect(safeEvaluateBoolean("a > 5", { a: 3 })).toBe(false);
  });

  it("should handle logical operators", () => {
    expect(safeEvaluateBoolean("a > 5 && b < 10", { a: 10, b: 5 })).toBe(true);
    expect(safeEvaluateBoolean("a > 5 || b > 10", { a: 3, b: 15 })).toBe(true);
    expect(safeEvaluateBoolean("a > 5 && b > 10", { a: 3, b: 15 })).toBe(false);
  });

  it("should coerce non-boolean results", () => {
    expect(safeEvaluateBoolean("a", { a: 1 })).toBe(true);
    expect(safeEvaluateBoolean("a", { a: 0 })).toBe(false);
    expect(safeEvaluateBoolean("a", { a: "hello" })).toBe(true);
    expect(safeEvaluateBoolean("a", { a: "" })).toBe(false);
    expect(safeEvaluateBoolean("a", { a: null })).toBe(false);
    expect(safeEvaluateBoolean("a", { a: undefined })).toBe(false);
    expect(safeEvaluateBoolean("[1,2]")).toBe(true);
    expect(safeEvaluateBoolean("[]")).toBe(true); // arrays are truthy in JS
  });

  it("should throw on invalid expressions", () => {
    expect(() => safeEvaluateBoolean("process.exit(1)")).toThrow();
    expect(() => safeEvaluateBoolean("Math.max.constructor('return 1')()")).toThrow();
  });
});
