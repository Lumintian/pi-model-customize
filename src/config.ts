import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THINKING_LEVELS, type CustomizeConfig, type ModelCustomRule } from "./rules.ts";

export const CONFIG_RELATIVE_PATH = join("extensions", "pi-model-customize.json");

/** Strip comments and trailing commas from JSONC text while preserving string literals. */
export function stripJsonCommentsAndTrailingCommas(text: string): string {
  let result = "";
  let i = 0;
  const len = text.length;
  let inString = false;
  let isEscaped = false;

  while (i < len) {
    const ch = text[i];

    if (inString) {
      result += ch;
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === "\\") {
        isEscaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      isEscaped = false;
      result += ch;
      i++;
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < len && text[i] !== "\n" && text[i] !== "\r") i++;
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < len && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      let isTrailing = false;
      while (j < len) {
        const nextChar = text[j];
        if (nextChar === " " || nextChar === "\t" || nextChar === "\n" || nextChar === "\r") {
          j++;
          continue;
        }
        if (nextChar === "/" && text[j + 1] === "/") {
          j += 2;
          while (j < len && text[j] !== "\n" && text[j] !== "\r") j++;
          continue;
        }
        if (nextChar === "/" && text[j + 1] === "*") {
          j += 2;
          while (j < len && !(text[j] === "*" && text[j + 1] === "/")) j++;
          j += 2;
          continue;
        }
        if (nextChar === "}" || nextChar === "]") {
          isTrailing = true;
        }
        break;
      }

      if (isTrailing) {
        i++;
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}

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
    parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(text));
  } catch (error) {
    fail(source, error instanceof Error ? error.message : "invalid JSON");
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

/** Global patterns are applied first so later project matches can override them by field. Exact entries merge by field, not recursively. */
export function mergeConfigs(global: CustomizeConfig, project: CustomizeConfig): CustomizeConfig {
  const overrides: Record<string, ModelCustomRule> = Object.create(null);
  for (const config of [global, project]) {
    for (const [key, value] of Object.entries(config.modelOverrides ?? {})) {
      overrides[key] = { ...overrides[key], ...value };
    }
  }
  return {
    version: 1,
    patternRules: [...(global.patternRules ?? []), ...(project.patternRules ?? [])],
    modelOverrides: overrides,
  };
}

function readConfig(path: string, warnings: string[]): { config: CustomizeConfig; exists: boolean } {
  try {
    return { config: parseConfig(readFileSync(path, "utf8"), path), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: {}, exists: false };
    }
    warnings.push(error instanceof Error ? error.message : `${path}: could not read configuration`);
    return { config: {}, exists: true };
  }
}

export interface ConfigMeta {
  globalPath: string;
  globalExists: boolean;
  projectPath: string;
  projectTrusted: boolean;
  projectExists: boolean;
}

export function loadConfig(options: {
  agentDir: string;
  cwd: string;
  projectConfigDir: string;
  projectTrusted: boolean;
}): { config: CustomizeConfig; warnings: string[]; meta: ConfigMeta } {
  const warnings: string[] = [];
  const globalPath = join(options.agentDir, CONFIG_RELATIVE_PATH);
  const projectPath = join(options.cwd, options.projectConfigDir, CONFIG_RELATIVE_PATH);

  const globalResult = readConfig(globalPath, warnings);
  let projectExists = false;
  let projectConfig: CustomizeConfig = {};

  if (options.projectTrusted) {
    const projectResult = readConfig(projectPath, warnings);
    projectConfig = projectResult.config;
    projectExists = projectResult.exists;
  }

  return {
    config: mergeConfigs(globalResult.config, projectConfig),
    warnings,
    meta: {
      globalPath,
      globalExists: globalResult.exists,
      projectPath,
      projectTrusted: options.projectTrusted,
      projectExists,
    },
  };
}
