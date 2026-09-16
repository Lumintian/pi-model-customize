import { applyCustomization, resolveCustomization, type CustomizableModel, type CustomizeConfig } from "./rules.ts";

const FIELDS = ["thinkingLevelMap", "contextWindow", "maxTokens"] as const;

/** Undo only values still owned by us, so reload/removal does not leave stale limits. */
export class ModelCustomizer {
  private readonly undo = new Map<CustomizableModel, (() => void)[]>();

  constructor(private readonly config: CustomizeConfig) {}

  apply(model: CustomizableModel): void {
    this.restore(model);
    const rule = resolveCustomization(this.config, model);
    if (!rule) return;
    const before = FIELDS.map((key) => this.snapshot(model, key));
    applyCustomization(model, rule);
    this.undo.set(model, before.map((capture) => capture()));
  }

  private snapshot<K extends (typeof FIELDS)[number]>(model: CustomizableModel, key: K): () => () => void {
    const hadOwn = Object.hasOwn(model, key);
    const original = model[key];
    return () => {
      const applied = model[key];
      return () => {
        if (applied === original || model[key] !== applied) return;
        if (hadOwn) model[key] = original;
        else Reflect.deleteProperty(model, key);
      };
    };
  }

  private restore(model: CustomizableModel): void {
    this.undo.get(model)?.forEach((restore) => restore());
    this.undo.delete(model);
  }

  restoreAll(): void {
    for (const model of this.undo.keys()) this.restore(model);
  }
}
