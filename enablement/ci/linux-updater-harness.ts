import { execFileSync } from "node:child_process";

const gui = "capture/desktop/scripts/linux/gui/";
const updater = "capture/desktop/scripts/linux/updater/";
const suites = [
  updater + "test-updater-gui.py",
  gui + "test-gui-vm.py",
  gui + "test-capture-smoke.py",
];

for (const suite of suites) {
  execFileSync("python3", [suite], { stdio: "inherit" });
}
execFileSync(
  "python3",
  [
    "-m",
    "py_compile",
    ...suites.slice(1),
    gui + "gui-vm.py",
    gui + "gui-vm-reaper.py",
    gui + "capture-smoke.py",
    updater + "updater-gui.py",
    updater + "updater-fixture.py",
  ],
  { stdio: "inherit" },
);
execFileSync("bash", ["-n", updater + "updater-gui-scenario.sh"], {
  stdio: "inherit",
});
