import { applyCustomization, resolveCustomization, type CustomizableModel, type CustomizeConfig } from "./rules.ts";

const FIELDS = ["thinkingLevelMap", "contextWindow", "maxTokens"] as const;

interface PropertySnapshot {
  key: (typeof FIELDS)[number];
  hadOwn: boolean;
  original: unknown;
  applied: unknown;
}

/** Undo only values still owned by us, so reload/removal does not leave stale limits. */
export class ModelCustomizer {
  private readonly undo = new Map<CustomizableModel, PropertySnapshot[]>();

  constructor(private readonly config: CustomizeConfig) {}

  apply(model: CustomizableModel): void {
    this.restore(model);
    const rule = resolveCustomization(this.config, model);
    if (!rule) return;

    const snapshots: PropertySnapshot[] = FIELDS.map((key) => ({
      key,
      hadOwn: Object.hasOwn(model, key),
      original: model[key],
      applied: undefined,
    }));

    applyCustomization(model, rule);

    for (const snap of snapshots) {
      snap.applied = model[snap.key];
    }
    this.undo.set(model, snapshots);
  }

  private restore(model: CustomizableModel): void {
    const snapshots = this.undo.get(model);
    if (!snapshots) return;
    for (const snap of snapshots) {
      if (model[snap.key] === snap.applied && snap.applied !== snap.original) {
        if (snap.hadOwn) {
          model[snap.key] = snap.original as never;
        } else {
          Reflect.deleteProperty(model, snap.key);
        }
      }
    }
    this.undo.delete(model);
  }

  restoreAll(): void {
    for (const model of this.undo.keys()) this.restore(model);
  }
}
