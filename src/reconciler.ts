import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ModelCustomizer } from "./customizer.ts";
import type { CustomizableModel } from "./rules.ts";

export interface ModelReconcileOptions {
  force?: boolean;
  forceSelectionScan?: boolean;
}

export interface ModelReconcileResult {
  model: CustomizableModel | undefined;
  identityChanged: boolean;
  selected: boolean;
  applied: boolean;
  shouldHandle: boolean;
}

function findLatestModelChangeId(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "model_change") return branch[i].id;
  }
  return undefined;
}

/** Track active model identity and explicit model-change entries across silent registry replacements. */
export class ModelReconciler {
  private customizedModels = new WeakSet<CustomizableModel>();
  private activeModel: CustomizableModel | undefined;
  private lastModelChangeId: string | undefined;

  constructor(private readonly customizer: ModelCustomizer) {}

  initialize(ctx: ExtensionContext, models: Iterable<CustomizableModel>): void {
    this.lastModelChangeId = findLatestModelChangeId(ctx);
    for (const model of models) this.applyOnce(model);
    this.activeModel = ctx.model as CustomizableModel | undefined;
  }

  reconcile(ctx: ExtensionContext, options: ModelReconcileOptions = {}): ModelReconcileResult {
    const model = ctx.model as CustomizableModel | undefined;
    if (!model) {
      const identityChanged = this.activeModel !== undefined;
      this.activeModel = undefined;
      return { model, identityChanged, selected: false, applied: false, shouldHandle: identityChanged };
    }

    const identityChanged = model !== this.activeModel;
    const selected = this.consumeModelSelection(
      ctx,
      options.forceSelectionScan === true || identityChanged || options.force === true,
    );
    const shouldHandle = identityChanged || selected || options.force === true;
    if (!shouldHandle) {
      return { model, identityChanged, selected, applied: false, shouldHandle: false };
    }

    const applied = this.applyOnce(model);
    this.activeModel = model;
    return { model, identityChanged, selected, applied, shouldHandle: true };
  }

  private applyOnce(model: CustomizableModel): boolean {
    if (this.customizedModels.has(model)) return false;
    this.customizer.apply(model);
    this.customizedModels.add(model);
    return true;
  }

  private consumeModelSelection(ctx: ExtensionContext, forceScan: boolean): boolean {
    const leaf = ctx.sessionManager.getLeafEntry();
    const latestId = leaf?.type === "model_change"
      ? leaf.id
      : forceScan
        ? findLatestModelChangeId(ctx)
        : undefined;
    if (latestId === undefined || latestId === this.lastModelChangeId) return false;
    this.lastModelChangeId = latestId;
    return true;
  }
}
