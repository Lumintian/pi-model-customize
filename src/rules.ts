import type { Api, Model, ModelThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface ModelCustomRule {
  allowedThinkingLevels?: readonly ModelThinkingLevel[];
  defaultThinkingLevel?: ModelThinkingLevel;
  thinkingLevelMap?: ThinkingLevelMap;
  contextWindow?: number;
  maxTokens?: number;
}

/** JSON equivalent of a JavaScript RegExp. Strings use literal matching plus '*'. */
export type ModelPattern = string | { regex: string; flags?: string };
export interface PatternRule {
  pattern: ModelPattern;
  config: ModelCustomRule;
}
export interface CustomizeConfig {
  version?: 1;
  patternRules?: readonly PatternRule[];
  modelOverrides?: Readonly<Record<string, ModelCustomRule>>;
}
export type CustomizableModel = Model<Api>;

const stringPatternCache = new Map<string, RegExp>();
const objectPatternCache = new WeakMap<object, RegExp>();

export function compilePattern(pattern: ModelPattern): RegExp {
  if (typeof pattern === "string") {
    let cached = stringPatternCache.get(pattern);
    if (!cached) {
      cached = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
      stringPatternCache.set(pattern, cached);
    }
    return cached;
  }
  let cached = objectPatternCache.get(pattern);
  if (!cached) {
    cached = new RegExp(pattern.regex, pattern.flags);
    objectPatternCache.set(pattern, cached);
  }
  return cached;
}

export function matchesPattern(pattern: ModelPattern, model: Pick<CustomizableModel, "id" | "provider">): boolean {
  const candidates = [model.id, `${model.provider}/${model.id}`];
  const regex = compilePattern(pattern);
  return candidates.some((candidate) => {
    regex.lastIndex = 0;
    const matched = regex.test(candidate);
    regex.lastIndex = 0;
    return matched;
  });
}

/** Shallow field merge, matching the original extension (maps/arrays replace as fields). */
export function resolveCustomization(
  config: CustomizeConfig,
  model: Pick<CustomizableModel, "id" | "provider">,
): ModelCustomRule | undefined {
  const pattern = config.patternRules?.find((rule) => matchesPattern(rule.pattern, model))?.config;
  const own = (key: string) => config.modelOverrides && Object.hasOwn(config.modelOverrides, key)
    ? config.modelOverrides[key] : undefined;
  const exact = own(model.id);
  const provider = own(`${model.provider}/${model.id}`);
  if (!pattern && !exact && !provider) return undefined;
  return { ...pattern, ...exact, ...provider };
}

export function buildThinkingLevelMap(
  allowedLevels: readonly ModelThinkingLevel[],
  existingMap?: ThinkingLevelMap,
): ThinkingLevelMap {
  const allowed = new Set(allowedLevels);
  const result: ThinkingLevelMap = {};
  for (const level of THINKING_LEVELS) {
    const existing = existingMap?.[level];
    const isExtendedLevel = level === "xhigh" || level === "max";
    const nativelySupported = existing !== undefined;
    if (!allowed.has(level) || existing === null) {
      result[level] = null;
    } else if (!isExtendedLevel || nativelySupported) {
      result[level] = existing ?? level;
    }
  }
  return result;
}

export function applyCustomization(model: CustomizableModel, config: ModelCustomRule): void {
  if (model.reasoning) {
    if (config.thinkingLevelMap) {
      model.thinkingLevelMap = { ...model.thinkingLevelMap, ...config.thinkingLevelMap };
    } else if (config.allowedThinkingLevels) {
      model.thinkingLevelMap = buildThinkingLevelMap(config.allowedThinkingLevels, model.thinkingLevelMap);
    }
  }
  if (config.contextWindow !== undefined) model.contextWindow = config.contextWindow;
  if (config.maxTokens !== undefined) model.maxTokens = config.maxTokens;
}

/** Detect thinking suffixes without mistaking model IDs such as llama:8b for a level. */
export function hasCliThinkingOverride(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") break;
    if (arg === "-t" || arg === "--thinking" || arg.startsWith("--thinking=")) return true;
    const model = arg === "-m" || arg === "--model" ? argv[++i]
      : arg.startsWith("--model=") ? arg.slice("--model=".length) : undefined;
    if (model && THINKING_LEVELS.some((level) => model.endsWith(`:${level}`))) return true;
  }
  return false;
}
