/**
 * Safe Expression Evaluator
 *
 * A lightweight, secure expression parser and evaluator that replaces
 * dangerous `new Function()` calls with a whitelist-based AST interpreter.
 *
 * Supported syntax:
 * - Literals: number, string (single/double quotes), boolean, null
 * - Operators: +, -, *, /, %, >, <, >=, <=, ==, ===, !=, !==, &&, ||, !
 * - Grouping: (expr)
 * - Property access: obj.prop, obj["prop"], obj[index]
 * - Function calls: Math.max(a, b), Array.isArray(x), etc.
 * - Arrays: [1, 2, 3]
 * - Objects: {a: 1, b: 2}
 * - Ternary: a ? b : c
 *
 * NOT supported (blocked):
 * - Assignment, increment/decrement
 * - Function definitions, arrow functions
 * - new, delete, typeof, instanceof, void, yield, await
 * - this, window, document, global, process, require, import, export
 */

export interface SafeObject {
  [key: string]: SafeValue;
}
export type SafeValue = string | number | boolean | null | SafeValue[] | SafeObject;

interface Token {
  type:
    | "NUMBER"
    | "STRING"
    | "IDENT"
    | "BOOL"
    | "NULL"
    | "OP"
    | "LPAREN"
    | "RPAREN"
    | "LBRACKET"
    | "RBRACKET"
    | "LBRACE"
    | "RBRACE"
    | "DOT"
    | "COMMA"
    | "COLON"
    | "QUESTION"
    | "EOF";
  value: string;
  pos: number;
}

// ─── AST Nodes ───

type ExprNode =
  | LiteralNode
  | IdentifierNode
  | MemberNode
  | CallNode
  | BinaryNode
  | UnaryNode
  | ArrayNode
  | ObjectNode
  | ConditionalNode;

interface LiteralNode {
  type: "Literal";
  value: SafeValue;
}

interface IdentifierNode {
  type: "Identifier";
  name: string;
}

interface MemberNode {
  type: "Member";
  object: ExprNode;
  property: ExprNode;
  computed: boolean;
}

interface CallNode {
  type: "Call";
  callee: ExprNode;
  args: ExprNode[];
}

interface BinaryNode {
  type: "Binary";
  operator: string;
  left: ExprNode;
  right: ExprNode;
}

interface UnaryNode {
  type: "Unary";
  operator: string;
  argument: ExprNode;
}

interface ArrayNode {
  type: "Array";
  elements: ExprNode[];
}

interface ObjectNode {
  type: "Object";
  properties: { key: string | ExprNode; value: ExprNode }[];
}

interface ConditionalNode {
  type: "Conditional";
  test: ExprNode;
  consequent: ExprNode;
  alternate: ExprNode;
}

// ─── Tokenizer ───

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    // Skip whitespace
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Number
    if (/\d/.test(c) || (c === "." && /\d/.test(input[i + 1] || ""))) {
      let start = i;
      while (i < input.length && (/\d/.test(input[i]) || input[i] === ".")) i++;
      tokens.push({ type: "NUMBER", value: input.slice(start, i), pos: start });
      continue;
    }

    // String
    if (c === '"' || c === "'") {
      const quote = c;
      let start = i;
      i++;
      let value = "";
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\") {
          i++;
          const esc = input[i];
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === "r") value += "\r";
          else if (esc === "\\") value += "\\";
          else if (esc === quote) value += quote;
          else value += esc;
        } else {
          value += input[i];
        }
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: "STRING", value, pos: start });
      continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_$]/.test(c)) {
      let start = i;
      while (i < input.length && /[a-zA-Z0-9_$]/.test(input[i])) i++;
      const word = input.slice(start, i);
      if (word === "true" || word === "false") {
        tokens.push({ type: "BOOL", value: word, pos: start });
      } else if (word === "null") {
        tokens.push({ type: "NULL", value: word, pos: start });
      } else {
        tokens.push({ type: "IDENT", value: word, pos: start });
      }
      continue;
    }

    // Multi-char operators
    const threeChar = input.slice(i, i + 3);
    if (threeChar === "===" || threeChar === "!==") {
      tokens.push({ type: "OP", value: threeChar, pos: i });
      i += 3;
      continue;
    }
    const twoChar = input.slice(i, i + 2);
    if (
      twoChar === ">=" ||
      twoChar === "<=" ||
      twoChar === "==" ||
      twoChar === "!=" ||
      twoChar === "&&" ||
      twoChar === "||"
    ) {
      tokens.push({ type: "OP", value: twoChar, pos: i });
      i += 2;
      continue;
    }

    // Single-char operators / punctuation
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%" || c === ">" || c === "<" || c === "!") {
      tokens.push({ type: "OP", value: c, pos: i });
      i++;
      continue;
    }

    if (c === "(") {
      tokens.push({ type: "LPAREN", value: c, pos: i });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "RPAREN", value: c, pos: i });
      i++;
      continue;
    }
    if (c === "[") {
      tokens.push({ type: "LBRACKET", value: c, pos: i });
      i++;
      continue;
    }
    if (c === "]") {
      tokens.push({ type: "RBRACKET", value: c, pos: i });
      i++;
      continue;
    }
    if (c === "{") {
      tokens.push({ type: "LBRACE", value: c, pos: i });
      i++;
      continue;
    }
    if (c === "}") {
      tokens.push({ type: "RBRACE", value: c, pos: i });
      i++;
      continue;
    }
    if (c === ".") {
      tokens.push({ type: "DOT", value: c, pos: i });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "COMMA", value: c, pos: i });
      i++;
      continue;
    }
    if (c === ":") {
      tokens.push({ type: "COLON", value: c, pos: i });
      i++;
      continue;
    }
    if (c === "?") {
      tokens.push({ type: "QUESTION", value: c, pos: i });
      i++;
      continue;
    }

    throw new Error(`Unexpected character "${c}" at position ${i}`);
  }

  tokens.push({ type: "EOF", value: "", pos: input.length });
  return tokens;
}

// ─── Parser (Pratt) ───

class Parser {
  tokens: Token[];
  pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  current(): Token {
    return this.tokens[this.pos];
  }

  advance(): Token {
    return this.tokens[this.pos++];
  }

  expect(type: Token["type"], value?: string): Token {
    const tok = this.current();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(
        `Expected ${type}${value ? ` "${value}"` : ""} but got ${tok.type} "${tok.value}" at position ${tok.pos}`
      );
    }
    return this.advance();
  }

  parseExpression(precedence = 0): ExprNode {
    let left = this.parsePrefix();

    while (this.current().type !== "EOF") {
      const op = this.current();
      const opPrec = getPrecedence(op);
      if (opPrec === null || opPrec < precedence) break;
      this.advance();
      const right = this.parseExpression(opPrec + 1);
      left = { type: "Binary", operator: op.value, left, right };
    }

    return left;
  }

  parsePrefix(): ExprNode {
    const tok = this.current();

    switch (tok.type) {
      case "NUMBER": {
        this.advance();
        let node: ExprNode = { type: "Literal", value: parseFloat(tok.value) };
        node = this.parsePostfix(node);
        return node;
      }
      case "STRING": {
        this.advance();
        let node: ExprNode = { type: "Literal", value: tok.value };
        node = this.parsePostfix(node);
        return node;
      }
      case "BOOL": {
        this.advance();
        let node: ExprNode = { type: "Literal", value: tok.value === "true" };
        node = this.parsePostfix(node);
        return node;
      }
      case "NULL": {
        this.advance();
        let node: ExprNode = { type: "Literal", value: null };
        node = this.parsePostfix(node);
        return node;
      }
      case "IDENT": {
        this.advance();
        let node: ExprNode = { type: "Identifier", name: tok.value };
        node = this.parsePostfix(node);
        return node;
      }
      case "LPAREN": {
        this.advance();
        const expr = this.parseExpression();
        this.expect("RPAREN");
        let node: ExprNode = expr;
        node = this.parsePostfix(node);
        return node;
      }
      case "LBRACKET": {
        this.advance();
        const elements: ExprNode[] = [];
        if (this.current().type !== "RBRACKET") {
          do {
            elements.push(this.parseExpression());
          } while (this.current().type === "COMMA" && this.advance());
        }
        this.expect("RBRACKET");
        let node: ExprNode = { type: "Array", elements };
        node = this.parsePostfix(node);
        return node;
      }
      case "LBRACE": {
        this.advance();
        const properties: { key: string | ExprNode; value: ExprNode }[] = [];
        if (this.current().type !== "RBRACE") {
          do {
            const keyTok = this.current();
            let key: string | ExprNode;
            if (keyTok.type === "IDENT" || keyTok.type === "STRING") {
              key = keyTok.value;
              this.advance();
            } else if (keyTok.type === "NUMBER") {
              key = keyTok.value;
              this.advance();
            } else {
              key = this.parseExpression();
            }
            this.expect("COLON");
            const value = this.parseExpression();
            properties.push({ key, value });
          } while (this.current().type === "COMMA" && this.advance());
        }
        this.expect("RBRACE");
        let node: ExprNode = { type: "Object", properties };
        node = this.parsePostfix(node);
        return node;
      }
      case "OP": {
        if (tok.value === "!" || tok.value === "-" || tok.value === "+") {
          this.advance();
          const argument = this.parsePrefix();
          return { type: "Unary", operator: tok.value, argument };
        }
        break;
      }
    }

    throw new Error(`Unexpected token ${tok.type} "${tok.value}" at position ${tok.pos}`);
  }

  parsePostfix(node: ExprNode): ExprNode {
    while (true) {
      const tok = this.current();
      if (tok.type === "DOT") {
        this.advance();
        const prop = this.expect("IDENT");
        node = { type: "Member", object: node, property: { type: "Identifier", name: prop.value }, computed: false };
      } else if (tok.type === "LBRACKET") {
        this.advance();
        const prop = this.parseExpression();
        this.expect("RBRACKET");
        node = { type: "Member", object: node, property: prop, computed: true };
      } else if (tok.type === "LPAREN") {
        this.advance();
        const args: ExprNode[] = [];
        if (this.current().type !== "RPAREN") {
          do {
            args.push(this.parseExpression());
          } while (this.current().type === "COMMA" && this.advance());
        }
        this.expect("RPAREN");
        node = { type: "Call", callee: node, args };
      } else if (tok.type === "QUESTION") {
        // Ternary operator is handled at expression level via low precedence
        break;
      } else {
        break;
      }
    }
    return node;
  }
}

function getPrecedence(tok: Token): number | null {
  if (tok.type !== "OP" && tok.type !== "QUESTION") return null;
  switch (tok.value) {
    case "||":
      return 10;
    case "&&":
      return 20;
    case "==":
    case "===":
    case "!=":
    case "!==":
      return 30;
    case ">":
    case "<":
    case ">=":
    case "<=":
      return 40;
    case "+":
    case "-":
      return 50;
    case "*":
    case "/":
    case "%":
      return 60;
    case "?":
      return 5; // Ternary is very low
    default:
      return null;
  }
}

// Override parseExpression to handle ternary specially
function parseWithTernary(tokens: Token[]): ExprNode {
  const parser = new Parser(tokens);
  return parseTernary(parser);
}

function parseTernary(parser: Parser): ExprNode {
  let test = parser.parseExpression(10); // parse up to &&/||

  if (parser.current().type === "QUESTION") {
    parser.advance();
    const consequent = parseTernary(parser);
    parser.expect("COLON");
    const alternate = parseTernary(parser);
    return { type: "Conditional", test, consequent, alternate };
  }

  return test;
}

// ─── Evaluator ───

const GLOBAL_WHITELIST: Record<string, unknown> = {
  Math,
  String,
  Number,
  Date,
  Array,
  Object,
  JSON,
};

function evaluate(node: ExprNode, context: Record<string, unknown>): unknown {
  switch (node.type) {
    case "Literal":
      return node.value;
    case "Identifier": {
      if (node.name in GLOBAL_WHITELIST) {
        return GLOBAL_WHITELIST[node.name];
      }
      if (node.name in context) {
        return context[node.name];
      }
      throw new Error(`Unknown identifier: ${node.name}`);
    }
    case "Member": {
      const obj = evaluate(node.object, context);
      const prop = node.computed ? evaluate(node.property, context) : (node.property as IdentifierNode).name;
      if (obj === null || obj === undefined) {
        throw new Error(`Cannot read properties of ${obj === null ? "null" : "undefined"}`);
      }
      return (obj as Record<string | number, unknown>)[prop as string | number];
    }
    case "Call": {
      const callee = evaluate(node.callee, context);
      const args = node.args.map((a) => evaluate(a, context));
      if (typeof callee !== "function") {
        throw new Error("Callee is not a function");
      }
      return (callee as (...args: unknown[]) => unknown).apply(undefined, args);
    }
    case "Binary": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const left = evaluate(node.left, context) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const right = evaluate(node.right, context) as any;
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "%":
          return left % right;
        case ">":
          return left > right;
        case "<":
          return left < right;
        case ">=":
          return left >= right;
        case "<=":
          return left <= right;
        case "==":
          return left == right;
        case "===":
          return left === right;
        case "!=":
          return left != right;
        case "!==":
          return left !== right;
        case "&&":
          return left && right;
        case "||":
          return left || right;
        default:
          throw new Error(`Unknown operator: ${node.operator}`);
      }
    }
    case "Unary": {
      const arg = evaluate(node.argument, context);
      switch (node.operator) {
        case "!":
          return !arg;
        case "-":
          return -(arg as number);
        case "+":
          return +(arg as number);
        default:
          throw new Error(`Unknown unary operator: ${node.operator}`);
      }
    }
    case "Array":
      return node.elements.map((e) => evaluate(e, context));
    case "Object": {
      const obj: Record<string, unknown> = {};
      for (const prop of node.properties) {
        const key = typeof prop.key === "string" ? prop.key : String(evaluate(prop.key, context));
        obj[key] = evaluate(prop.value, context);
      }
      return obj;
    }
    case "Conditional": {
      const test = evaluate(node.test, context);
      return test ? evaluate(node.consequent, context) : evaluate(node.alternate, context);
    }
    default:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unknown node type: ${(node as any).type}`);
  }
}

// ─── Public API ───

/**
 * Safely evaluate an expression string within a given context.
 * Replaces dangerous `new Function()` calls.
 */
export function safeEvaluateExpression(expression: string, context: Record<string, unknown> = {}): unknown {
  const tokens = tokenize(expression);
  const ast = parseWithTernary(tokens);
  return evaluate(ast, context);
}

/**
 * Safely evaluate a boolean expression.
 */
export function safeEvaluateBoolean(expression: string, context: Record<string, unknown> = {}): boolean {
  const result = safeEvaluateExpression(expression, context);
  return Boolean(result);
}
