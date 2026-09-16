import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, type ConfigMeta } from "../src/config.ts";
import { ModelCustomizer } from "../src/customizer.ts";
import { hasCliThinkingOverride, resolveCustomization, type CustomizeConfig } from "../src/rules.ts";

export function formatDiagnostics(
  ctx: Pick<ExtensionContext, "model">,
  config: CustomizeConfig,
  meta: ConfigMeta,
  thinkingLevel: string,
): string {
  const lines: string[] = ["[pi-model-customize] Status:"];
  lines.push(`• Global: ${meta.globalPath} (${meta.globalExists ? "loaded" : "not found"})`);
  lines.push(
    `• Project: ${meta.projectPath} (${
      !meta.projectTrusted
        ? "untrusted workspace, skipped"
        : meta.projectExists
          ? "loaded"
          : "not found"
    })`,
  );

  const patternCount = config.patternRules?.length ?? 0;
  const overrideCount = config.modelOverrides ? Object.keys(config.modelOverrides).length : 0;
  lines.push(`• Active Rules: ${patternCount} pattern(s), ${overrideCount} override(s)`);

  if (ctx.model) {
    const appliedRule = resolveCustomization(config, ctx.model);
    lines.push(`• Current Model: ${ctx.model.provider}/${ctx.model.id}`);
    if (appliedRule) {
      lines.push("  - Customized: yes");
      if (appliedRule.contextWindow !== undefined) {
        lines.push(`  - Context Window: ${appliedRule.contextWindow.toLocaleString()}`);
      }
      if (appliedRule.maxTokens !== undefined) {
        lines.push(`  - Max Tokens: ${appliedRule.maxTokens.toLocaleString()}`);
      }
      if (ctx.model.reasoning) {
        if (appliedRule.defaultThinkingLevel) {
          lines.push(`  - Default Thinking: ${appliedRule.defaultThinkingLevel}`);
        }
        if (appliedRule.allowedThinkingLevels) {
          lines.push(`  - Allowed Thinking: [${appliedRule.allowedThinkingLevels.join(", ")}]`);
        }
      }
    } else {
      lines.push("  - Customized: no");
    }
    lines.push(`  - Active Thinking Level: ${thinkingLevel}`);
  } else {
    lines.push("• Current Model: none");
  }

  return lines.join("\n");
}

export default function modelCustomize(pi: ExtensionAPI): void {
  let config: CustomizeConfig = {};
  let customizer = new ModelCustomizer(config);
  let lastMeta: ConfigMeta = {
    globalPath: "",
    globalExists: false,
    projectPath: "",
    projectTrusted: false,
    projectExists: false,
  };

  const handleDiagnostic = async (_args: string, cmdCtx: ExtensionCommandContext): Promise<void> => {
    const report = formatDiagnostics(cmdCtx, config, lastMeta, pi.getThinkingLevel());
    if (cmdCtx.hasUI) {
      cmdCtx.ui.notify(report, "info");
    } else {
      console.log(report);
    }
  };

  pi.registerCommand("model-customize", {
    description: "Show pi-model-customize configuration status and active model customizations",
    handler: handleDiagnostic,
  });

  pi.registerCommand("mc", {
    description: "Show pi-model-customize status (alias for /model-customize)",
    handler: handleDiagnostic,
  });

  pi.on("session_start", (event, ctx) => {
    customizer.restoreAll();
    const loaded = loadConfig({
      agentDir: getAgentDir(),
      cwd: ctx.cwd,
      projectConfigDir: CONFIG_DIR_NAME,
      projectTrusted: ctx.isProjectTrusted(),
    });
    config = loaded.config;
    lastMeta = loaded.meta;
    customizer = new ModelCustomizer(config);
    for (const warning of loaded.warnings) {
      const message = `[pi-model-customize] Ignoring invalid config file: ${warning}`;
      if (ctx.hasUI) ctx.ui.notify(message, "warning");
      else console.error(message);
    }

    // De-duplicate because ctx.model is usually already present in the registry.
    const hasRules = Boolean(
      (config.patternRules && config.patternRules.length > 0)
      || (config.modelOverrides && Object.keys(config.modelOverrides).length > 0),
    );
    if (hasRules) {
      const models = new Set(ctx.modelRegistry.getAll());
      if (ctx.model) models.add(ctx.model);
      for (const model of models) customizer.apply(model);
    }
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
