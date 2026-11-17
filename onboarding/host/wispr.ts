export type WisprResult = {
  status: "disabled" | "running" | "closed" | "refused" | "unknown";
};
export type WisprContext = {
  platform?: string;
  step?: string;
  fix?: boolean;
  shortcutChosen?: boolean;
  wisprFlowEnabled?: boolean;
};
export type WisprProvider = (
  operation: "read" | "quit",
  signal: AbortSignal,
) => Promise<WisprResult>;
export const wisprExperiment = "onboardingWisprFlow";
export function eligibleWispr(context: WisprContext | null): boolean {
  return (
    context?.platform === "macos" &&
    context.wisprFlowEnabled === true &&
    context.step === "shortcut" &&
    context.fix !== true &&
    context.shortcutChosen !== true
  );
}
export class WisprOnboarding {
  private active: AbortController | null = null;
  private revision = 0;
  private context: () => WisprContext | null;
  private enabled: () => Promise<boolean>;
  private provider: WisprProvider;
  private platform: string;
  constructor(
    context: () => WisprContext | null,
    enabled: () => Promise<boolean>,
    provider: WisprProvider,
    platform: string = process.platform,
  ) {
    this.context = context;
    this.enabled = enabled;
    this.provider = provider;
    this.platform = platform;
  }
  close() {
    this.revision++;
    this.active?.abort();
    this.active = null;
  }
  async request(operation: unknown): Promise<WisprResult> {
    if (operation !== "read" && operation !== "quit")
      throw Error("Forbidden Wispr operation");
    if (this.active) return { status: "unknown" };
    const revision = this.revision;
    if (
      this.platform !== "darwin" ||
      !eligibleWispr(this.context()) ||
      !(await this.enabled()) ||
      revision !== this.revision ||
      !eligibleWispr(this.context())
    )
      return { status: "disabled" };
    if (this.active) return { status: "unknown" };
    const controller = new AbortController();
    this.active = controller;
    try {
      const result = await this.provider(operation, controller.signal);
      return revision === this.revision && eligibleWispr(this.context())
        ? result
        : { status: "disabled" };
    } catch {
      return { status: "unknown" };
    } finally {
      if (this.active === controller) this.active = null;
    }
  }
}
