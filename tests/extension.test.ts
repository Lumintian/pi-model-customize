import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import modelCustomize, { formatDiagnostics } from "../extensions/index.ts";
import { CONFIG_RELATIVE_PATH } from "../src/config.ts";
import type { CustomizableModel } from "../src/rules.ts";

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for asynchronous reconciliation");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("extension lifecycle: startup, new, resume, fork, reload, CLI, selection and teardown", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-model-extension-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldArgv = process.argv;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.argv = ["node", "pi"];
  const path = join(process.env.PI_CODING_AGENT_DIR, CONFIG_RELATIVE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const writeConfig = (config: unknown) => writeFileSync(path, JSON.stringify(config));
  const makeModel = (): CustomizableModel => ({
    id: "gpt-test", provider: "test", name: "Test", api: "openai-responses", baseUrl: "http://localhost",
    reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 16000,
  });
  // Test the real entry point; the harness records host API calls, not provider requests.
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: any) => Promise<void> }>();
  let thinking: ModelThinkingLevel = "high";
  const calls: ModelThinkingLevel[] = [];
  const warnings: string[] = [];
  const pi = {
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
    registerCommand: (name: string, options: any) => commands.set(name, options),
    getThinkingLevel: () => thinking,
    setThinkingLevel: (value: ModelThinkingLevel) => { calls.push(value); thinking = value; },
  } as unknown as ExtensionAPI;
  const m = makeModel();
  const entries: any[] = [];
  const ctx = {
    cwd: join(root, "project"), hasUI: true, model: m,
    modelRegistry: { getAll: () => [m] }, isProjectTrusted: () => true,
    sessionManager: {
      getBranch: () => entries,
      getLeafEntry: () => entries.at(-1),
    },
    ui: {
      notify: (message: string) => warnings.push(message),
      setStatus: () => {},
    },
  } as unknown as ExtensionContext;
  const emit = async (name: string, event: unknown) => { await handlers.get(name)!(event, ctx); };
  const start = async (reason: string) => {
    (ctx as any).model = m;
    thinking = "high";
    calls.length = 0;
    await emit("session_start", { reason });
  };
  try {
    writeConfig({ modelOverrides: { "gpt-test": { defaultThinkingLevel: "low", contextWindow: 512000 } } });
    modelCustomize(pi);
    for (const reason of ["startup", "new"]) {
      await start(reason);
      assert.deepEqual(calls, ["low"]);
      assert.equal(m.contextWindow, 512000);
    }
    for (const reason of ["resume", "fork", "reload"]) {
      await start(reason);
      assert.deepEqual(calls, ["high"]);
    }
    process.argv = ["node", "pi", "--thinking=high"];
    await start("startup");
    assert.deepEqual(calls, ["high"]);
    process.argv = ["node", "pi"];

    for (const source of ["set", "cycle"]) {
      thinking = "high";
      calls.length = 0;
      const dynamic = makeModel();
      (ctx as any).model = dynamic;
      await emit("model_select", { model: dynamic, source });
      assert.equal(dynamic.contextWindow, 512000);
      assert.deepEqual(calls, ["low"]);
    }
    calls.length = 0;
    const restored = makeModel();
    (ctx as any).model = restored;
    await emit("model_select", { model: restored, source: "restore" });
    assert.deepEqual(calls, []);
    const nonReasoning = { ...makeModel(), reasoning: false };
    (ctx as any).model = nonReasoning;
    await emit("model_select", { model: nonReasoning, source: "set" });
    assert.deepEqual(calls, []);
    const other = { ...makeModel(), id: "other" };
    (ctx as any).model = other;
    await emit("model_select", { model: other, source: "set" });
    assert.deepEqual(calls, [thinking]);
    (ctx as any).model = m;

    // A trusted project's file overrides the same global exact rule by field.
    const projectPath = join(ctx.cwd, ".pi", CONFIG_RELATIVE_PATH);
    mkdirSync(dirname(projectPath), { recursive: true });
    writeFileSync(projectPath, '{"modelOverrides":{"gpt-test":{"contextWindow":256000}}}');
    await start("reload");
    assert.equal(m.contextWindow, 256000);

    // Verify diagnostic command execution
    assert.ok(commands.has("model-customize"));
    assert.ok(commands.has("mc"));
    const initialWarnCount = warnings.length;
    await commands.get("model-customize")!.handler("", ctx as any);
    assert.equal(warnings.length, initialWarnCount + 1);
    const diag = warnings[warnings.length - 1];
    assert.ok(diag.includes("[pi-model-customize] Status:"));
    assert.ok(diag.includes("• Current Model: test/gpt-test"));
    assert.ok(diag.includes("Context Window: 256,000"));

    rmSync(projectPath);

    // Teardown is what makes both config removal and new extension instances reversible.
    await emit("session_shutdown", { reason: "reload" });
    assert.equal(m.contextWindow, 128000);
    writeConfig({});
    modelCustomize(pi);
    await start("reload");
    assert.equal(m.contextWindow, 128000);
    assert.deepEqual(calls, ["high"]);

    writeConfig({ modelOverrides: { "gpt-test": { maxTokens: 0 } } });
    warnings.length = 0;
    await start("reload");
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(path));
    assert.equal(m.maxTokens, 16000);
    await emit("session_shutdown", { reason: "quit" });
  } finally {
    await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
    process.argv = oldArgv;
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test("reconciles silent model replacement and same-model selection without model_select", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-model-reconcile-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldArgv = process.argv;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.argv = ["node", "pi"];
  const path = join(process.env.PI_CODING_AGENT_DIR, CONFIG_RELATIVE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    modelOverrides: {
      "gpt-test": { defaultThinkingLevel: "low", contextWindow: 512000 },
    },
  }));

  const makeModel = (): CustomizableModel => ({
    id: "gpt-test", provider: "test", name: "Test", api: "openai-responses", baseUrl: "http://localhost",
    reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 16000,
  });
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  let thinking: ModelThinkingLevel = "high";
  const calls: ModelThinkingLevel[] = [];
  let renders = 0;
  let activeModel = makeModel();
  const initialModel = activeModel;
  const entries: any[] = [{
    type: "model_change", id: "initial-model", parentId: null, timestamp: new Date().toISOString(),
    provider: "test", modelId: "gpt-test",
  }];
  const pi = {
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
    registerCommand: () => {},
    getThinkingLevel: () => thinking,
    setThinkingLevel: (value: ModelThinkingLevel) => { calls.push(value); thinking = value; },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: join(root, "project"), hasUI: true,
    get model() { return activeModel; },
    modelRegistry: { getAll: () => [initialModel] },
    isProjectTrusted: () => true,
    sessionManager: {
      getBranch: () => entries,
      getLeafEntry: () => entries.at(-1),
    },
    ui: {
      notify: () => {},
      setStatus: () => { renders++; },
    },
  } as unknown as ExtensionContext;
  const emit = async (name: string, event: unknown) => { await handlers.get(name)!(event, ctx); };
  let shutdown = false;

  try {
    modelCustomize(pi);
    await emit("session_start", { reason: "startup" });
    assert.equal(initialModel.contextWindow, 512000);
    assert.equal(thinking, "low");

    // Provider/catalog refresh can silently replace the active object without a model_select event.
    const refreshedModel = makeModel();
    activeModel = refreshedModel;
    const rendersBeforeRefresh = renders;
    await waitFor(() => refreshedModel.contextWindow === 512000);
    assert.equal(thinking, "low");
    assert.ok(renders > rendersBeforeRefresh);

    // Selecting the same provider/model appends a model_change entry, but pi suppresses model_select.
    const selectedModel = makeModel();
    entries.push({
      type: "model_change", id: "same-model-selection", parentId: "initial-model",
      timestamp: new Date().toISOString(), provider: "test", modelId: "gpt-test",
    });
    activeModel = selectedModel;
    thinking = "high";
    calls.length = 0;
    await waitFor(() => selectedModel.contextWindow === 512000 && thinking === "low");
    assert.ok(calls.includes("low"));

    // A later manual thinking-level change on the same model remains user-owned.
    thinking = "high";
    calls.length = 0;
    await emit("thinking_level_select", { level: "high", previousLevel: "low" });
    assert.equal(thinking, "high");
    assert.deepEqual(calls, []);

    await emit("session_shutdown", { reason: "quit" });
    shutdown = true;
    assert.equal(initialModel.contextWindow, 128000);
    assert.equal(refreshedModel.contextWindow, 128000);
    assert.equal(selectedModel.contextWindow, 128000);
  } finally {
    if (!shutdown) await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
    process.argv = oldArgv;
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatDiagnostics covers untrusted workspace, missing model, and uncustomized model", () => {
  const meta = {
    globalPath: "/tmp/global.json",
    globalExists: false,
    projectPath: "/tmp/project.json",
    projectTrusted: false,
    projectExists: false,
  };
  const uncustomized = formatDiagnostics({ model: undefined }, {}, meta, "off");
  assert.ok(uncustomized.includes("• Global: /tmp/global.json (not found)"));
  assert.ok(uncustomized.includes("• Project: /tmp/project.json (untrusted workspace, skipped)"));
  assert.ok(uncustomized.includes("• Current Model: none"));

  const nonReasoningModel = {
    id: "gpt-mini",
    provider: "test",
    name: "Mini",
    api: "openai-responses" as const,
    baseUrl: "http://localhost",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64000,
    maxTokens: 4000,
  };
  const withModel = formatDiagnostics({ model: nonReasoningModel }, {}, meta, "off");
  assert.ok(withModel.includes("• Current Model: test/gpt-mini"));
  assert.ok(withModel.includes("Customized: no"));
});

