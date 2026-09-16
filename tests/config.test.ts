import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { CONFIG_RELATIVE_PATH, loadConfig, mergeConfigs, parseConfig } from "../src/config.ts";
import { resolveCustomization } from "../src/rules.ts";

const current = { id: "gpt-test", provider: "test" };

test("migrated example preserves all original active rules", () => {
  const config = parseConfig(readFileSync(new URL("../examples/pi-model-customize.json", import.meta.url), "utf8"));
  assert.deepEqual(resolveCustomization(config, { ...current, id: "gpt-5.6-luna" }), {
    allowedThinkingLevels: ["low", "max"], contextWindow: 512000,
  });
  assert.deepEqual(resolveCustomization(config, { ...current, id: "gpt-6-astra" }), {
    allowedThinkingLevels: ["low", "medium", "xhigh", "max"], contextWindow: 512000, defaultThinkingLevel: "medium",
  });
  assert.equal(resolveCustomization(config, { ...current, id: "gpt-5.6-sol" })?.defaultThinkingLevel, "xhigh");
});

test("strict validation rejects invalid files with precise source paths", () => {
  const cases = [
    "null", "[]", "{", '{"version":2}', '{"extra":true}',
    '{"patternRules":null}', '{"patternRules":[{}]}',
    '{"patternRules":[{"pattern":"","config":{}}]}',
    '{"patternRules":[{"pattern":{"regex":"["},"config":{}}]}',
    '{"patternRules":[{"pattern":{"regex":"a","flags":"ii"},"config":{}}]}',
    '{"patternRules":[{"pattern":{"regex":"a","flags":null},"config":{}}]}',
    ...[null, [], { contextWindow: 0 }, { maxTokens: -1 }, { maxTokens: 1.2 }, { maxTokens: 1e20 },
      { defaultThinkingLevel: "extreme" }, { allowedThinkingLevels: "low" }, { allowedThinkingLevels: ["no"] },
      { thinkingLevelMap: { high: 1 } }, { thinkingLevelMap: { high: "" } }, { thinkingLevelMap: { typo: null } },
      { thinkingLevelMap: null }, { contextwindow: 100 },
    ].map((rule) => JSON.stringify({ modelOverrides: { x: rule } })),
  ];
  for (const text of cases) assert.throws(() => parseConfig(text, "example.json"), /example\.json/, text);
  assert.deepEqual(parseConfig("{}"), {});
  assert.doesNotThrow(() => parseConfig('{"patternRules":[{"pattern":{"regex":"gpt","flags":"i"},"config":{}}]}'));
});

test("project patterns precede global; exact entries merge fields, arrays and maps replace", () => {
  const global = parseConfig(JSON.stringify({
    patternRules: [{ pattern: "*", config: { contextWindow: 100 } }],
    modelOverrides: { "gpt-test": { allowedThinkingLevels: ["low"], thinkingLevelMap: { low: "small" }, maxTokens: 10 } },
  }));
  const project = parseConfig(JSON.stringify({
    patternRules: [{ pattern: "gpt-*", config: { contextWindow: 200 } }],
    modelOverrides: { "gpt-test": { allowedThinkingLevels: ["high"], thinkingLevelMap: { high: "big" } } },
  }));
  const merged = mergeConfigs(global, project);
  assert.deepEqual(resolveCustomization(merged, current), {
    contextWindow: 200, allowedThinkingLevels: ["high"], thinkingLevelMap: { high: "big" }, maxTokens: 10,
  });
  assert.equal(resolveCustomization(merged, { ...current, id: "claude" })?.contextWindow, 100);
  assert.equal(global.modelOverrides?.["gpt-test"].thinkingLevelMap?.low, "small");
  assert.equal(mergeConfigs(global, {}).patternRules?.length, 1);
});

test("unusual model IDs cannot access or modify object prototypes", () => {
  const config = mergeConfigs({}, parseConfig('{"modelOverrides":{"__proto__":{"maxTokens":123},"constructor":{"maxTokens":456}}}'));
  assert.equal(resolveCustomization(config, { ...current, id: "__proto__" })?.maxTokens, 123);
  assert.equal(resolveCustomization(config, { ...current, id: "constructor" })?.maxTokens, 456);
  assert.equal(resolveCustomization(config, { ...current, id: "toString" }), undefined);
  assert.equal(Object.getPrototypeOf(config.modelOverrides), null);
});

test("global/project paths, trust gating, missing files and independent invalid-file fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-model-config-"));
  try {
    const options = { agentDir: join(root, "agent"), cwd: join(root, "project"), projectConfigDir: ".pi", projectTrusted: true };
    const globalPath = join(options.agentDir, CONFIG_RELATIVE_PATH);
    const projectPath = join(options.cwd, ".pi", CONFIG_RELATIVE_PATH);
    assert.deepEqual(loadConfig(options).warnings, []);
    for (const path of [globalPath, projectPath]) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(globalPath, '{"modelOverrides":{"gpt-test":{"maxTokens":100}}}');
    writeFileSync(projectPath, '{"modelOverrides":{"gpt-test":{"maxTokens":200}}}');
    assert.equal(resolveCustomization(loadConfig(options).config, current)?.maxTokens, 200);
    assert.equal(resolveCustomization(loadConfig({ ...options, projectTrusted: false }).config, current)?.maxTokens, 100);
    writeFileSync(projectPath, "invalid");
    assert.deepEqual(loadConfig({ ...options, projectTrusted: false }).warnings, []);
    const fallback = loadConfig(options);
    assert.equal(fallback.warnings.length, 1);
    assert.ok(fallback.warnings[0].includes(projectPath));
    assert.equal(resolveCustomization(fallback.config, current)?.maxTokens, 100);
    writeFileSync(globalPath, '{"modelOverrides":{"gpt-test":{"maxTokens":0}}}');
    writeFileSync(projectPath, '{"modelOverrides":{"gpt-test":{"maxTokens":200}}}');
    const projectOnly = loadConfig(options);
    assert.equal(projectOnly.warnings.length, 1);
    assert.equal(resolveCustomization(projectOnly.config, current)?.maxTokens, 200);
    // Not ENOENT: attempting to read a directory is reported instead of silently ignored.
    rmSync(projectPath);
    mkdirSync(projectPath);
    assert.equal(loadConfig(options).warnings.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
