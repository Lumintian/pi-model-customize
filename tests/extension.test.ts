import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import modelCustomize from "../extensions/index.ts";
import { CONFIG_RELATIVE_PATH } from "../src/config.ts";
import type { CustomizableModel } from "../src/rules.ts";

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
  let thinking: ModelThinkingLevel = "high";
  const calls: ModelThinkingLevel[] = [];
  const warnings: string[] = [];
  const pi = {
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
    getThinkingLevel: () => thinking,
    setThinkingLevel: (value: ModelThinkingLevel) => { calls.push(value); thinking = value; },
  } as unknown as ExtensionAPI;
  const m = makeModel();
  const ctx = {
    cwd: join(root, "project"), hasUI: true, model: m,
    modelRegistry: { getAll: () => [m] }, isProjectTrusted: () => true,
    ui: { notify: (message: string) => warnings.push(message) },
  } as unknown as ExtensionContext;
  const emit = async (name: string, event: unknown) => { await handlers.get(name)!(event, ctx); };
  const start = async (reason: string) => {
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
      await emit("model_select", { model: dynamic, source });
      assert.equal(dynamic.contextWindow, 512000);
      assert.deepEqual(calls, ["low"]);
    }
    calls.length = 0;
    await emit("model_select", { model: makeModel(), source: "restore" });
    assert.deepEqual(calls, []);
    await emit("model_select", { model: { ...makeModel(), reasoning: false }, source: "set" });
    assert.deepEqual(calls, []);
    await emit("model_select", { model: { ...makeModel(), id: "other" }, source: "set" });
    assert.deepEqual(calls, [thinking]);

    // A trusted project's file overrides the same global exact rule by field.
    const projectPath = join(ctx.cwd, ".pi", CONFIG_RELATIVE_PATH);
    mkdirSync(dirname(projectPath), { recursive: true });
    writeFileSync(projectPath, '{"modelOverrides":{"gpt-test":{"contextWindow":256000}}}');
    await start("reload");
    assert.equal(m.contextWindow, 256000);
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
    await start("reload");
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(path));
    assert.equal(m.maxTokens, 16000);
    await emit("session_shutdown", { reason: "quit" });
  } finally {
    process.argv = oldArgv;
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDir;
    rmSync(root, { recursive: true, force: true });
  }
});
