import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THINKING_LEVELS, type CustomizeConfig, type ModelCustomRule } from "./rules.ts";

export const CONFIG_RELATIVE_PATH = join("extensions", "pi-model-customize.json");

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown field");
  }
}
function level(value: unknown, path: string): void {
  if (typeof value !== "string" || !(THINKING_LEVELS as readonly string[]).includes(value)) {
    fail(path, `expected one of ${THINKING_LEVELS.join(", ")}`);
  }
}
function rule(value: unknown, path: string): void {
  const item = object(value, path);
  keys(item, ["allowedThinkingLevels", "defaultThinkingLevel", "thinkingLevelMap", "contextWindow", "maxTokens"], path);
  if (Object.hasOwn(item, "allowedThinkingLevels")) {
    if (!Array.isArray(item.allowedThinkingLevels)) fail(`${path}.allowedThinkingLevels`, "expected an array");
    item.allowedThinkingLevels.forEach((entry, i) => level(entry, `${path}.allowedThinkingLevels[${i}]`));
  }
  if (Object.hasOwn(item, "defaultThinkingLevel")) level(item.defaultThinkingLevel, `${path}.defaultThinkingLevel`);
  if (Object.hasOwn(item, "thinkingLevelMap")) {
    const map = object(item.thinkingLevelMap, `${path}.thinkingLevelMap`);
    keys(map, THINKING_LEVELS, `${path}.thinkingLevelMap`);
    for (const [key, value] of Object.entries(map)) {
      if (value !== null && (typeof value !== "string" || !value.trim())) {
        fail(`${path}.thinkingLevelMap.${key}`, "expected a non-empty string or null");
      }
    }
  }
  for (const key of ["contextWindow", "maxTokens"]) {
    if (Object.hasOwn(item, key) && (typeof item[key] !== "number" || !Number.isSafeInteger(item[key]) || item[key] <= 0)) {
      fail(`${path}.${key}`, "expected a positive safe integer");
    }
  }
}

/** Validate the entire file before any model is mutated. Unknown keys are errors. */
export function parseConfig(text: string, source = "config"): CustomizeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(source, "invalid JSON (comments and trailing commas are not supported)");
  }
  const config = object(parsed, source);
  keys(config, ["version", "patternRules", "modelOverrides"], source);
  if (Object.hasOwn(config, "version") && config.version !== 1) fail(`${source}.version`, "expected 1");
  if (Object.hasOwn(config, "patternRules")) {
    if (!Array.isArray(config.patternRules)) fail(`${source}.patternRules`, "expected an array");
    config.patternRules.forEach((value, i) => {
      const path = `${source}.patternRules[${i}]`;
      const entry = object(value, path);
      keys(entry, ["pattern", "config"], path);
      if (typeof entry.pattern === "string") {
        if (!entry.pattern.trim()) fail(`${path}.pattern`, "must not be empty");
      } else {
        const pattern = object(entry.pattern, `${path}.pattern`);
        keys(pattern, ["regex", "flags"], `${path}.pattern`);
        if (typeof pattern.regex !== "string" || !pattern.regex) fail(`${path}.pattern.regex`, "expected a non-empty string");
        if (Object.hasOwn(pattern, "flags") && typeof pattern.flags !== "string") fail(`${path}.pattern.flags`, "expected a string");
        try {
          new RegExp(pattern.regex, pattern.flags as string | undefined);
        } catch {
          fail(`${path}.pattern`, "invalid regular expression or flags");
        }
      }
      rule(entry.config, `${path}.config`);
    });
  }
  if (Object.hasOwn(config, "modelOverrides")) {
    const overrides = object(config.modelOverrides, `${source}.modelOverrides`);
    for (const [key, value] of Object.entries(overrides)) {
      if (!key.trim()) fail(`${source}.modelOverrides`, "model ID must not be empty");
      rule(value, `${source}.modelOverrides[${JSON.stringify(key)}]`);
    }
  }
  return config as CustomizeConfig;
}

/** Project patterns are searched first. Exact entries merge by field, not recursively. */
export function mergeConfigs(global: CustomizeConfig, project: CustomizeConfig): CustomizeConfig {
  const overrides: Record<string, ModelCustomRule> = Object.create(null);
  for (const config of [global, project]) {
    for (const [key, value] of Object.entries(config.modelOverrides ?? {})) {
      overrides[key] = { ...overrides[key], ...value };
    }
  }
  return {
    version: 1,
    patternRules: [...(project.patternRules ?? []), ...(global.patternRules ?? [])],
    modelOverrides: overrides,
  };
}

function readConfig(path: string, warnings: string[]): CustomizeConfig {
  try {
    return parseConfig(readFileSync(path, "utf8"), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(error instanceof Error ? error.message : `${path}: could not read configuration`);
    }
    return {};
  }
}

export function loadConfig(options: {
  agentDir: string;
  cwd: string;
  projectConfigDir: string;
  projectTrusted: boolean;
}): { config: CustomizeConfig; warnings: string[] } {
  const warnings: string[] = [];
  const global = readConfig(join(options.agentDir, CONFIG_RELATIVE_PATH), warnings);
  // Never even read a project file before pi has granted project trust.
  const project = options.projectTrusted
    ? readConfig(join(options.cwd, options.projectConfigDir, CONFIG_RELATIVE_PATH), warnings) : {};
  return { config: mergeConfigs(global, project), warnings };
}
