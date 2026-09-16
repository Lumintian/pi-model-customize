import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelCustomizer } from "../src/customizer.ts";
import { applyCustomization, buildThinkingLevelMap, compilePattern, hasCliThinkingOverride, matchesPattern, resolveCustomization, type CustomizableModel } from "../src/rules.ts";

export function model(patch: Partial<CustomizableModel> = {}): CustomizableModel {
  return {
    id: "gpt-test", provider: "test", name: "Test", api: "openai-responses", baseUrl: "http://localhost",
    reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 16000, ...patch,
  };
}

test("string patterns escape regexp syntax, support * and match both IDs case-insensitively", () => {
  assert.ok(matchesPattern("GPT-*", model()));
  assert.ok(matchesPattern("test/*", model()));
  assert.ok(matchesPattern("gpt-test", model()));
  assert.ok(matchesPattern("a.b+[x](y)?$^{}|\\", model({ id: "a.b+[x](y)?$^{}|\\" })));
  assert.equal(matchesPattern("gpt.test", model()), false);
  assert.equal(matchesPattern("test", model()), false);
});

test("JSON regexp supports flags and resets state between candidates and calls", () => {
  const pattern = { regex: "^TEST/", flags: "gi" };
  for (let i = 0; i < 3; i++) assert.ok(matchesPattern(pattern, model()));
  assert.ok(matchesPattern({ regex: "^test/", flags: "y" }, model()));
  assert.equal(matchesPattern({ regex: "^TEST/" }, model()), false);
  assert.strictEqual(compilePattern(pattern), compilePattern(pattern));
  assert.strictEqual(compilePattern("gpt-*"), compilePattern("gpt-*"));
});

test("precedence is first pattern, bare ID, then provider/ID; maps replace as fields", () => {
  const result = resolveCustomization({
    patternRules: [
      { pattern: "*", config: { contextWindow: 100, maxTokens: 10, thinkingLevelMap: { low: "a" } } },
      { pattern: "*", config: { maxTokens: 99 } },
    ],
    modelOverrides: {
      "gpt-test": { contextWindow: 200, thinkingLevelMap: { high: "b" } },
      "test/gpt-test": { contextWindow: 300 },
    },
  }, model());
  assert.deepEqual(result, { contextWindow: 300, maxTokens: 10, thinkingLevelMap: { high: "b" } });
  assert.equal(resolveCustomization({}, model({ id: "toString" })), undefined);
  assert.equal(resolveCustomization({ modelOverrides: {} }, model({ id: "constructor" })), undefined);
});

test("whitelist only narrows capabilities and preserves provider values", () => {
  const map = buildThinkingLevelMap(["low", "medium", "xhigh", "max"], { low: "small", medium: null, max: "huge" });
  assert.equal(map.xhigh, undefined);
  assert.deepEqual(map, { off: null, minimal: null, low: "small", medium: null, high: null, max: "huge" });
  assert.equal(buildThinkingLevelMap(["medium"]).medium, "medium");
  assert.ok(Object.values(buildThinkingLevelMap([])).every((value) => value === null));
});

test("explicit map wins over whitelist, merges native map, and can enable extended levels", () => {
  const m = model({ thinkingLevelMap: { low: "small", max: null } });
  applyCustomization(m, { allowedThinkingLevels: ["high"], thinkingLevelMap: { max: "huge" }, maxTokens: 300 });
  assert.deepEqual(m.thinkingLevelMap, { low: "small", max: "huge" });
  assert.equal(m.maxTokens, 300);
  assert.equal(m.contextWindow, 128000);
});

test("non-reasoning models only get token overrides", () => {
  const m = model({ reasoning: false });
  applyCustomization(m, { allowedThinkingLevels: ["low"], thinkingLevelMap: { high: "x" }, contextWindow: 500 });
  assert.equal(m.thinkingLevelMap, undefined);
  assert.equal(m.contextWindow, 500);
});

test("repeated application is stable, shutdown restores original values and optional property absence", () => {
  const m = model();
  const baseline = structuredClone(m);
  const customizer = new ModelCustomizer({ patternRules: [{ pattern: "*", config: { allowedThinkingLevels: ["low"], contextWindow: 500, maxTokens: 200 } }] });
  customizer.apply(m);
  const applied = structuredClone(m);
  customizer.apply(m);
  assert.deepEqual(m, applied);
  customizer.restoreAll();
  assert.deepEqual(m, baseline);
  assert.equal(Object.hasOwn(m, "thinkingLevelMap"), false);
  customizer.restoreAll();
});

test("restoration preserves later modifications made by other extensions", () => {
  const originalMap = { low: "small" };
  const m = model({ thinkingLevelMap: originalMap });
  const customizer = new ModelCustomizer({ modelOverrides: { "gpt-test": { thinkingLevelMap: { low: "tiny" }, contextWindow: 500, maxTokens: 200 } } });
  customizer.apply(m);
  m.contextWindow = 999;
  const otherMap = { high: "big" };
  m.thinkingLevelMap = otherMap;
  customizer.restoreAll();
  assert.equal(m.contextWindow, 999);
  assert.equal(m.thinkingLevelMap, otherMap);
  assert.equal(m.maxTokens, 16000);
});

test("CLI thinking flags and suffixes, but not ordinary colon model IDs", () => {
  for (const argv of [["-t", "high"], ["--thinking=low"], ["--thinking", "max"], ["-m", "test/gpt-test:high"], ["--model=gpt-test:max"]]) {
    assert.equal(hasCliThinkingOverride(argv), true, argv.join(" "));
  }
  for (const argv of [[], ["--model", "llama:8b"], ["--model=llama:8b"], ["--", "--thinking=high"], ["-m"]]) {
    assert.equal(hasCliThinkingOverride(argv), false, argv.join(" "));
  }
});
