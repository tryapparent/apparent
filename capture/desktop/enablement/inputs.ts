// Desktop build/proof dependencies. Central coordination applies these facts.
export const desktopPackagingInputs = new Set([
  'capture/desktop/enablement/packaging/install-app.sh',
  'capture/desktop/enablement/packaging/frontend/stage.ts',
]);
export const linuxDrivers = new Set(['capture-smoke.py', 'gui-vm.py', 'gui-vm-reaper.py',
  'test-capture-smoke.py', 'test-gui-vm.py'].map(name => 'capture/desktop/enablement/linux/gui/' + name));
