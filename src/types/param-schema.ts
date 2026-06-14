/** Single parameter property definition */
export interface ParamProperty {
  type: "string" | "number" | "boolean" | "object" | "array" | ("string" | "number" | "boolean" | "object" | "array")[];
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: ParamProperty;
  properties?: Record<string, ParamProperty>;
}

/** Complete parameter schema for a Skill */
export interface ParamSchema {
  properties: Record<string, ParamProperty>;
  required?: string[];
}
