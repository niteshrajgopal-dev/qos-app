type JsonSchemaNode = Record<string, unknown>;

/**
 * Converts Zod draft-07 JSON Schema into a shape compatible with OpenAI
 * Chat Completions `response_format.json_schema` strict mode.
 */
export function toOpenAiStrictJsonSchema(schema: JsonSchemaNode): JsonSchemaNode {
  const normalized = normalizeNode(schema) as JsonSchemaNode;
  return enforceStrictObjects(normalized);
}

function normalizeNode(node: unknown): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return node;
  }

  const obj = node as JsonSchemaNode;

  if (Array.isArray(obj.anyOf)) {
    const nullable = nullableFromAnyOf(obj.anyOf);
    if (nullable) {
      return normalizeNode(nullable);
    }
  }

  if ("const" in obj) {
    return normalizeNode({
      type: "string",
      enum: [obj.const],
    });
  }

  const next: JsonSchemaNode = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "$schema" || key === "anyOf") {
      continue;
    }
    next[key] = normalizeNode(value);
  }

  if (next.type === "object" && next.properties && typeof next.properties === "object") {
    const properties = next.properties as Record<string, JsonSchemaNode>;
    for (const key of Object.keys(properties)) {
      properties[key] = normalizeNode(properties[key]) as JsonSchemaNode;
    }
    next.additionalProperties = false;
    next.required = Object.keys(properties);
  }

  if (next.type === "array" && next.items) {
    next.items = normalizeNode(next.items);
  }

  return next;
}

function nullableFromAnyOf(branches: unknown[]): JsonSchemaNode | null {
  if (!Array.isArray(branches) || branches.length !== 2) {
    return null;
  }
  const typed = branches.filter(
    (branch): branch is JsonSchemaNode =>
      Boolean(branch) && typeof branch === "object" && !Array.isArray(branch),
  );
  if (typed.length !== 2) {
    return null;
  }
  const hasNull = typed.some((branch) => branch.type === "null");
  if (!hasNull) {
    return null;
  }
  const valueBranch = typed.find((branch) => branch.type !== "null");
  if (!valueBranch) {
    return null;
  }
  const valueType = valueBranch.type;
  const merged: JsonSchemaNode = { ...valueBranch };
  delete merged.type;
  merged.type = Array.isArray(valueType) ? [...valueType, "null"] : [valueType, "null"];
  return merged;
}

function enforceStrictObjects(node: unknown): JsonSchemaNode {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return {};
  }
  const obj = { ...(node as JsonSchemaNode) };
  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    const properties = obj.properties as Record<string, JsonSchemaNode>;
    for (const key of Object.keys(properties)) {
      properties[key] = enforceStrictObjects(properties[key]);
    }
    obj.properties = properties;
    obj.additionalProperties = false;
    obj.required = Object.keys(properties);
  }
  if (obj.type === "array" && obj.items) {
    obj.items = enforceStrictObjects(obj.items);
  }
  return obj;
}

export function assertOpenAiStrictJsonSchema(schema: JsonSchemaNode) {
  const issues: string[] = [];
  walk(schema, "$", issues);
  if (issues.length > 0) {
    throw new Error(`OpenAI strict schema invalid:\n${issues.join("\n")}`);
  }
}

function walk(node: unknown, path: string, issues: string[]) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return;
  }
  const obj = node as JsonSchemaNode;
  if ("anyOf" in obj || "oneOf" in obj || "allOf" in obj) {
    issues.push(`${path}: combinator (anyOf/oneOf/allOf) is not allowed in OpenAI strict mode`);
  }
  if (obj.type === "object") {
    if (obj.additionalProperties !== false) {
      issues.push(`${path}: additionalProperties must be false`);
    }
    const properties = obj.properties as Record<string, unknown> | undefined;
    const required = Array.isArray(obj.required) ? obj.required.map(String).sort() : [];
    const keys = properties ? Object.keys(properties).sort() : [];
    if (properties && JSON.stringify(required) !== JSON.stringify(keys)) {
      issues.push(`${path}: required must list every property key`);
    }
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        walk(value, `${path}.${key}`, issues);
      }
    }
  }
  if (obj.type === "array" && obj.items) {
    walk(obj.items, `${path}[]`, issues);
  }
}
