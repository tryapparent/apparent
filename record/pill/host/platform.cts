import { existsSync } from "node:fs";

type App = {
  disableHardwareAcceleration(): void;
  setActivationPolicy(policy: "accessory"): void;
};

export function prepareApp(app: App) {
  const platform = process.platform;
  if (platform === "darwin") {
    app.setActivationPolicy("accessory");
    return;
  }
  if (platform !== "linux") process.exit(1);

  const acceleratorDevices = ["/dev/dri", "/dev/nvidiactl", "/dev/dxg"];
  if (!acceleratorDevices.some(existsSync)) app.disableHardwareAcceleration();
}
