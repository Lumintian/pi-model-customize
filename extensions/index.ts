import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.ts";
import { ModelCustomizer } from "../src/customizer.ts";
import { hasCliThinkingOverride, resolveCustomization, type CustomizeConfig } from "../src/rules.ts";

export default function modelCustomize(pi: ExtensionAPI): void {
  let config: CustomizeConfig = {};
  let customizer = new ModelCustomizer(config);

  pi.on("session_start", (event, ctx) => {
    customizer.restoreAll();
    const loaded = loadConfig({
      agentDir: getAgentDir(),
      cwd: ctx.cwd,
      projectConfigDir: CONFIG_DIR_NAME,
      projectTrusted: ctx.isProjectTrusted(),
    });
    config = loaded.config;
    customizer = new ModelCustomizer(config);
    for (const warning of loaded.warnings) {
      const message = `[pi-model-customize] Ignoring invalid config file: ${warning}`;
      if (ctx.hasUI) ctx.ui.notify(message, "warning");
      else console.error(message);
    }

    // De-duplicate because ctx.model is usually already present in the registry.
    const models = new Set(ctx.modelRegistry.getAll());
    if (ctx.model) models.add(ctx.model);
    for (const model of models) customizer.apply(model);
    if (!ctx.model?.reasoning) return;

    if ((event.reason === "startup" || event.reason === "new") && !hasCliThinkingOverride(process.argv.slice(2))) {
      const level = resolveCustomization(config, ctx.model)?.defaultThinkingLevel;
      if (level !== undefined) {
        pi.setThinkingLevel(level);
        return;
      }
    }
    // Resume, fork and reload retain the current level, clamped to supported levels.
    pi.setThinkingLevel(pi.getThinkingLevel());
  });

  pi.on("model_select", (event) => {
    customizer.apply(event.model);
    if (event.source === "restore" || !event.model.reasoning) return;
    pi.setThinkingLevel(resolveCustomization(config, event.model)?.defaultThinkingLevel ?? pi.getThinkingLevel());
  });

  pi.on("session_shutdown", () => customizer.restoreAll());
}
