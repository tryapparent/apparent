import {
  dictationApps,
  type DictationApp,
  type WisprResult,
} from "./dictation.ts";
export type { WisprResult } from "./dictation.ts";

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
  apps: readonly DictationApp[],
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
  private detected: readonly DictationApp[] = [];
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
    this.detected = [];
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
    if (operation === "quit" && this.detected.length === 0)
      return { status: "unknown" };
    if (operation === "read") this.detected = [];
    const controller = new AbortController();
    this.active = controller;
    try {
      const result = await this.provider(
        operation,
        controller.signal,
        this.detected,
      );
      if (revision !== this.revision || !eligibleWispr(this.context()))
        return { status: "disabled" };
      if (operation === "read" && result.status === "running")
        this.detected = dictationApps.filter((app) =>
          result.apps.includes(app),
        );
      if (result.status === "closed") this.detected = [];
      return result;
    } catch {
      return { status: "unknown" };
    } finally {
      if (this.active === controller) this.active = null;
    }
  }
}
