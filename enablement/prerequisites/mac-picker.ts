import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';

// Disposable hosted-Mac CI driver, not application behavior or native proof.
// Readiness callbacks may poll read-only state; mutation callbacks run once.
// Hosted-Mac receipts show AppKit ownership checks taking ~3s before the first
// AX query. Give the complete picker command a finite allowance for that startup;
// the caller still clips every call to the original 95s overall test deadline.
export const pickerCommandMs = 5000;
export type PickerDriver = {
  storageIdle: () => Promise<void>;
  change: () => Promise<void>;
  picker: () => Promise<string>;
  openGo: () => Promise<void>;
  goSheet: () => Promise<string>;
  enterPath: (path: string) => Promise<void>;
  pathReady: (path: string) => Promise<string>;
  wait: (ms: number) => Promise<void>;
  navigate: (path: string) => Promise<void>;
};
export type PickerPreparation = Partial<{
  beforeGo: string; openGoReturned: boolean; goSheet: string; beforeChoose: string;
  pathEntered: boolean; pathReadback: string;
}>;
export async function prepareStorageChange(driver: PickerDriver, path: string, receipt: PickerPreparation = {}) {
  await driver.storageIdle();
  await driver.change();
  const beforeGo = await driver.picker();
  receipt.beforeGo = beforeGo;
  await driver.openGo();
  receipt.openGoReturned = true;
  const goSheet = await driver.goSheet();
  receipt.goSheet = goSheet;
  // AX writes and their asynchronous readback must not consume the same bounded
  // osascript call as autocomplete and Return. Never retry either mutation.
  await driver.enterPath(path);
  receipt.pathEntered = true;
  receipt.pathReadback = await driver.pathReady(path);
  await driver.wait(1000);
  await driver.navigate(path);
  const beforeChoose = await driver.picker();
  receipt.beforeChoose = beforeChoose;
  return {beforeGo, goSheet, beforeChoose};
}

const pickerScript = `
use framework "AppKit"
use scripting additions
on run argv
  set targetPID to (item 1 of argv) as integer
  set operation to item 3 of argv
  set expectedExecutable to item 4 of argv
  set goMode to operation is "inspect-go" or operation is "enter-go-path" or operation is "inspect-go-path" or operation is "navigate-go"
  set nativeApp to my ownedApplication(targetPID, expectedExecutable)
  if ((nativeApp's bundleIdentifier()) as text) is not (item 5 of argv) then error "Owned Electron bundle identity differs"
  tell application "System Events"
    set owned to first application process whose unix id is targetPID
    -- Materialize the remote property before comparison. Comparing a System
    -- Events object property directly can retain an unresolved object specifier.
    set observedPID to (unix id of owned) as integer
    if observedPID is not targetPID then error "Owned AX process identifier differs; expectedPID=" & targetPID & ";observedPID=" & observedPID & ";expectedBundle=" & (item 5 of argv)
    tell owned
      if (count of windows) is 0 then error "Owned process has no AX windows; frontmost=" & (frontmost as text)
      set outerWindow to window 1
      if operation is "focus-change" then
        if (count of windows) is not 1 then error "Change focus requires one owned window"
        if (role of outerWindow as text) is not "AXWindow" or (name of outerWindow as text) is not "Apparent — UI foundation" then error "Change focus requires Foundation"
        if (count of sheets of outerWindow) is not 0 then error "Change focus refuses an existing modal"
        my activateOwned(nativeApp, targetPID, expectedExecutable)
        return "native-focus-pid=" & targetPID & ";title=Apparent — UI foundation"
      end if
      set picker to outerWindow
      set depth to 0
      set goParent to missing value
      set trace to ""
      repeat
        set panelName to ""
        try
          if name of picker is not missing value then set panelName to name of picker as text
        end try
        set panelRole to role of picker as text
        set labels to name of every button of picker
        set trace to trace & "depth=" & depth & ";role=" & panelRole & ";title=" & panelName & ";buttons="
        repeat with labelText in labels
          set trace to trace & (labelText as text) & "|"
        end repeat
        set trace to trace & linefeed
        set childSheets to sheets of picker
        if (count of childSheets) is 0 then exit repeat
        if (count of childSheets) is not 1 or depth is 4 then error "Unsupported owned AX sheet tree: " & trace
        set goParent to picker
        set picker to item 1 of childSheets
        set depth to depth + 1
      end repeat
      -- Failure diagnostics must not depend on the recursive selector succeeding.
      if operation is "diagnose" then
        set directChildren to UI elements of picker
        set trace to trace & "immediate-child-count=" & (count of directChildren) & linefeed
        set childLimit to count of directChildren
        if childLimit > 16 then set childLimit to 16
        repeat with childIndex from 1 to childLimit
          set directChild to item childIndex of directChildren
          set trace to trace & "child-role=" & (role of directChild as text) & ";next-roles="
          set nextRoles to role of every UI element of directChild
          if (count of nextRoles) > 32 then
            set trace to trace & "over-32"
          else
            repeat with nextRole in nextRoles
              set trace to trace & (nextRole as text) & "|"
            end repeat
          end if
          set trace to trace & linefeed
        end repeat
        return trace
      end if
      if goMode then
        if depth is 0 or goParent is missing value then error "Owned Go to Folder sheet not ready: " & trace
        -- One attached sheet is the picker itself, not a Go sheet. Do not pop
        -- it and misclassify the application's root window as a picker.
        if depth is 1 and (name of outerWindow as text) is "Apparent — UI foundation" then error "Owned Go to Folder sheet not ready: " & trace
        set goSheet to picker
        if (role of goSheet as text) is not "AXSheet" then error "Unexpected owned Go to Folder role: " & trace
        set picker to goParent
        set depth to depth - 1
        set panelRole to role of picker as text
        set panelName to ""
        if name of picker is not missing value then set panelName to name of picker as text
      end if
      if depth > 0 and (name of outerWindow as text) is not "Apparent — UI foundation" then error "Picker has unexpected parent: " & trace
      if panelRole is not "AXSheet" and panelRole is not "AXWindow" then error "Unexpected picker role: " & trace
      -- A sheet can have no title. A named picker must expose the shipped title.
      if panelName is not "" and panelName is not "Choose capture location" then error "Unexpected picker title: " & trace
      -- Observed macOS 26 NSOpenPanel: one AXSplitGroup immediately under the
      -- sheet, with the footer buttons directly under that group. Do not walk
      -- the file-browser descendants (which can expose an entire volume).
      set controls to picker
      if (count of buttons of controls) is 0 then
        set containers to UI elements of picker
        if (count of containers) > 16 then error "Oversized picker control containers: " & trace
        set footerContainers to {}
        repeat with candidateContainer in containers
          set containerRole to role of candidateContainer as text
          if containerRole is "AXSplitGroup" then
            set end of footerContainers to contents of candidateContainer
          else if not goMode or containerRole is not "AXSheet" then
            error "Unsupported picker control container role: " & trace
          end if
        end repeat
        if (count of footerContainers) is not 1 then error "Unsupported picker control containers: " & trace
        set controls to item 1 of footerContainers
      end if
      set chooseMatches to {}
      set cancelMatches to {}
      set trace to trace & "footer-buttons="
      set footerButtons to buttons of controls
      if (count of footerButtons) > 16 then error "Oversized picker footer: " & trace
      repeat with foundButton in footerButtons
        set buttonName to name of foundButton
        if buttonName is not missing value then
          set trace to trace & (buttonName as text) & "|"
          if buttonName is "Choose" then set end of chooseMatches to contents of foundButton
          if buttonName is "Cancel" then set end of cancelMatches to contents of foundButton
        end if
      end repeat
      set trace to trace & linefeed
      if (count of chooseMatches) is not 1 or (count of cancelMatches) is not 1 then error "Owned native picker controls missing or ambiguous: " & trace
      set chooseButton to item 1 of chooseMatches
      set cancelButton to item 1 of cancelMatches
      if not goMode and not (enabled of chooseButton) then error "Native Choose not enabled: " & trace
      set xy to position of outerWindow
      set wh to size of outerWindow
      if goMode then
        my requireNativeFocus(nativeApp, targetPID, expectedExecutable)
        set goSheets to sheets of picker
        if (count of goSheets) is not 1 then error "Owned Go to Folder sheet missing or ambiguous"
        set goSheet to item 1 of goSheets
        set pathFields to text fields of goSheet
        if (count of pathFields) is not 1 then error "Owned Go to Folder path field missing or ambiguous"
        set pathField to item 1 of pathFields
        if not (enabled of pathField) then error "Owned Go to Folder path field not ready"
        if operation is "enter-go-path" then
          -- argv, not script interpolation: spaces, quotes and accents remain data.
          set value of pathField to (item 2 of argv)
        else if operation is "inspect-go-path" then
          if (value of pathField as text) is not (item 2 of argv) then error "Go to Folder path readback differs"
        else if operation is "navigate-go" then
          -- The TypeScript driver waited for readback and autocomplete separately.
          -- This call contains exactly one Return and no path-entry mutation.
          my requireNativeFocus(nativeApp, targetPID, expectedExecutable)
          -- Recheck the exact owned modal before Return. Never let a vanished
          -- Go sheet turn a navigation key into the parent picker's Choose.
          set currentGoSheets to sheets of picker
          if (count of currentGoSheets) is not 1 then error "Owned Go to Folder sheet disappeared before navigation"
          set currentFields to text fields of item 1 of currentGoSheets
          if (count of currentFields) is not 1 then error "Owned Go to Folder field changed before navigation"
          if (value of item 1 of currentFields as text) is not (item 2 of argv) then error "Go to Folder path changed before navigation"
          key code 36
        end if
      else if operation is "open-go" or operation is "choose" or operation is "cancel" then
        -- AX frontmost can disagree with AppKit for the same owned process.
        -- Activate once, then observe actual native ownership before input.
        my activateOwned(nativeApp, targetPID, expectedExecutable)
        set trace to trace & "native-focus-pid=" & targetPID & linefeed
        if operation is "open-go" then
          if (count of sheets of picker) is not 0 then error "Owned picker changed before Go shortcut"
          keystroke "g" using {command down, shift down}
        else if operation is "choose" then
          click chooseButton
        else
          click cancelButton
        end if
      end if
      return trace & "bounds=" & (item 1 of xy) & "," & (item 2 of xy) & "," & (item 1 of wh) & "," & (item 2 of wh)
    end tell
  end tell
end run

on ownedApplication(targetPID, expectedExecutable)
  -- Numeric observations only, before any activation/input. A later diagnostic
  -- can succeed after this lookup failed; retain the actual lookup argument.
  log ("Owned AppKit lookup pid=" & targetPID)
  set nativeApp to current application's NSRunningApplication's runningApplicationWithProcessIdentifier:targetPID
  if nativeApp is missing value then error "Owned Electron process is absent; expected=" & targetPID
  log ("Owned AppKit result pid=" & ((nativeApp's processIdentifier()) as integer))
  my assertOwnedApplication(nativeApp, targetPID, expectedExecutable)
  return nativeApp
end ownedApplication

on assertOwnedApplication(nativeApp, targetPID, expectedExecutable)
  if ((nativeApp's processIdentifier()) as integer) is not targetPID then error "Owned AppKit process identifier differs"
  if ((nativeApp's isTerminated()) as boolean) then error "Owned Electron process exited; expected=" & targetPID
  if ((nativeApp's executableURL()'s |path|()) as text) is not expectedExecutable then error "Owned Electron executable changed"
end assertOwnedApplication

on hasNativeFocus(nativeApp, targetPID, expectedExecutable)
  -- Retain the verified app instance across activation. Re-discovery by PID can
  -- return missing during activation even while this instance remains alive.
  -- AppKit's time-varying properties refresh on the main run loop, so service
  -- that loop before checking termination and focus. The caller's deadline and
  -- one-second focus allowance still bound every observation.
  current application's NSRunLoop's currentRunLoop()'s runUntilDate:(current application's NSDate's dateWithTimeIntervalSinceNow:0.001)
  my assertOwnedApplication(nativeApp, targetPID, expectedExecutable)
  set frontApp to current application's NSWorkspace's sharedWorkspace()'s frontmostApplication()
  if frontApp is missing value then return false
  return ((nativeApp's isActive()) as boolean) and ((frontApp's processIdentifier()) as integer) is targetPID
end hasNativeFocus

on requireNativeFocus(nativeApp, targetPID, expectedExecutable)
  if not (my hasNativeFocus(nativeApp, targetPID, expectedExecutable)) then error "Focus left owned Electron process"
end requireNativeFocus

on activateOwned(nativeApp, targetPID, expectedExecutable)
  my assertOwnedApplication(nativeApp, targetPID, expectedExecutable)
  if not ((nativeApp's activateWithOptions:(current application's NSApplicationActivateIgnoringOtherApps)) as boolean) then error "Owned Electron activation refused"
  set focusDeadline to ((current application's NSProcessInfo's processInfo()'s systemUptime()) as real) + 1
  repeat
    if my hasNativeFocus(nativeApp, targetPID, expectedExecutable) then return
    if ((current application's NSProcessInfo's processInfo()'s systemUptime()) as real) >= focusDeadline then error "Owned native focus readiness expired"
    delay 0.05
  end repeat
end activateOwned
`;

// Preserve the last AX query in subprocess stderr when a hosted runner stalls.
// Elapsed wall-clock seconds distinguish cumulative selector cost from the last
// reached query. AppleScript's local date arithmetic adds no AX request. This is
// coarse diagnostic timing, not evidence that a reached query completed.
// Ownership checks, queries, mutations and the caller's deadline are unchanged.
let inRun = false;
export const panelScript = pickerScript.split('\n').flatMap((line, index) => {
  if (line === 'on run argv') { inRun = true; return [line, '  set axProbeStartedAt to current date']; }
  if (line === 'end run') inRun = false;
  const query = inRun && /^\s*(set|if)\b/.test(line) &&
    /\b(application process|windows?|name|role|buttons|sheets|UI elements|position|size|enabled|frontmost|text fields|value)\b/.test(line);
  return query ? [`${line.match(/^\s*/)![0]}log ("AX probe source-line=${index + 1} elapsedSeconds=" & (my axProbeElapsed(axProbeStartedAt)))`, line] : [line];
}).join('\n') + `
-- Explicit script target: never ask System Events to supply the clock.
on axProbeElapsed(startedAt)
  return (current date) - startedAt
end axProbeElapsed
`;

// One owned interpreter amortizes AppKit initialization. Commands remain separate,
// bounded and one-shot; no command is replayed after an ambiguous outcome.
export const persistentPanelScript = panelScript
  .replace('use scripting additions', 'use scripting additions\nproperty pickerApplication : missing value')
  .replace('on run argv', 'on pickerRequest(argv)')
  .replace('end run', 'end pickerRequest')
  .replace("  set nativeApp to current application's NSRunningApplication's runningApplicationWithProcessIdentifier:targetPID",
    `  if pickerApplication is missing value then
    set pickerApplication to current application's NSRunningApplication's runningApplicationWithProcessIdentifier:targetPID
  end if
  set nativeApp to pickerApplication
  current application's NSRunLoop's currentRunLoop()'s runUntilDate:(current application's NSDate's dateWithTimeIntervalSinceNow:0.001)`)
  + `
on run argv
  set inputHandle to current application's NSFileHandle's fileHandleWithStandardInput()
  set outputHandle to current application's NSFileHandle's fileHandleWithStandardOutput()
  set newlineData to (current application's NSString's stringWithString:linefeed)'s dataUsingEncoding:(current application's NSUTF8StringEncoding)
  set buffer to current application's NSMutableData's data()
  repeat
    set nextByte to inputHandle's readDataOfLength:1
    if (nextByte's |length|() as integer) is 0 then exit repeat
    if (nextByte's isEqualToData:newlineData) as boolean then
      set request to current application's NSJSONSerialization's JSONObjectWithData:buffer options:0 |error|:(missing value)
      if request is missing value then error "Invalid picker request"
      set reply to current application's NSMutableDictionary's dictionary()
      reply's setObject:(request's objectForKey:"id") forKey:"id"
      try
        set resultText to my pickerRequest((request's objectForKey:"args") as list)
        reply's setObject:(current application's NSNumber's numberWithBool:true) forKey:"ok"
        reply's setObject:(resultText as text) forKey:"value"
      on error messageText number errorNumber
        reply's setObject:(current application's NSNumber's numberWithBool:false) forKey:"ok"
        reply's setObject:messageText forKey:"error"
      end try
      set encoded to current application's NSJSONSerialization's dataWithJSONObject:reply options:0 |error|:(missing value)
      if encoded is missing value then error "Cannot encode picker reply"
      outputHandle's writeData:encoded
      outputHandle's writeData:newlineData
      buffer's setLength:0
    else
      if (buffer's |length|() as integer) >= 8192 then error "Oversized picker request"
      buffer's appendData:nextByte
    end if
  end repeat
  return
end run
`;

export class PickerProcess {
  private child?: ChildProcessWithoutNullStreams;
  private retired = false;
  private serial = 0;
  private buffer = '';
  private stderr = '';
  private pending?: {id: number; finish: (error: Error | null, value?: string) => void};
  private readonly launch: () => ChildProcessWithoutNullStreams;
  readonly stats = {starts: 0, requests: 0};
  constructor(launch: () => ChildProcessWithoutNullStreams = () =>
    spawn('/usr/bin/osascript', ['-e', persistentPanelScript], {stdio: 'pipe'})) { this.launch = launch; }

  private abort(message: string) {
    this.retired = true;
    const error = Object.assign(new Error(message), {stderr: this.stderr, signal: this.child?.signalCode});
    const pending = this.pending;
    this.pending = undefined;
    pending?.finish(error);
    this.child?.kill('SIGKILL');
  }
  private receive(chunk: string) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 65536) { this.abort('Oversized picker response'); return; }
    while (this.buffer.includes('\n')) {
      const end = this.buffer.indexOf('\n'), line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let reply;
      try { reply = JSON.parse(line); } catch { this.abort('Malformed picker response'); return; }
      const pending = this.pending;
      if (!pending || reply?.id !== pending.id || typeof reply.ok !== 'boolean' ||
          (reply.ok ? typeof reply.value !== 'string' : typeof reply.error !== 'string')) {
        this.abort('Unexpected picker response identity or shape'); return;
      }
      this.pending = undefined;
      pending.finish(reply.ok ? null : Object.assign(new Error(reply.error), {stderr: this.stderr}), reply.value);
    }
    if (!this.pending && this.buffer.length) this.abort('Unsolicited picker response bytes');
  }
  request(args: string[], timeout: number): Promise<string> {
    if (this.retired) return Promise.reject(new Error('Picker driver is retired; no replay'));
    if (this.pending) return Promise.reject(new Error('Concurrent picker command refused'));
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > pickerCommandMs ||
        args.length !== 5 || !args.every(arg => typeof arg === 'string')) {
      return Promise.reject(new Error('Invalid picker request or deadline'));
    }
    const id = ++this.serial, frame = JSON.stringify({id, args}) + '\n';
    if (Buffer.byteLength(frame) > 8192) return Promise.reject(new Error('Oversized picker request'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.abort('Native picker command timed out; outcome unknown'), timeout);
      this.stderr = '';
      this.pending = {id, finish: (error, value) => {
        clearTimeout(timer);
        if (error) reject(error); else resolve(value!);
      }};
      try {
        if (!this.child) {
          this.child = this.launch(); this.stats.starts++;
          this.child.stdout.setEncoding('utf8');
          this.child.stderr.setEncoding('utf8');
          this.child.stdout.on('data', chunk => this.receive(chunk));
          this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-8192); });
          this.child.on('error', error => this.abort(`Picker process failed: ${error.message}`));
          this.child.stdin.on('error', error => this.abort(`Picker input failed: ${error.message}`));
          this.child.once('exit', () => this.abort('Picker process exited'));
        }
        this.stats.requests++;
        this.child.stdin.write(frame);
      } catch (error) { this.abort(`Cannot dispatch picker command: ${error}`); }
    });
  }
  async close() {
    this.retired = true;
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      if (this.pending) this.abort('Picker closed with an unresolved command');
      await new Promise<void>((resolve, reject) => {
        const kill = setTimeout(() => child.kill('SIGKILL'), 500);
        const hard = setTimeout(() => reject(new Error('Owned picker driver did not exit')), 1500);
        child.once('exit', () => { clearTimeout(kill); clearTimeout(hard); resolve(); });
        child.stdin.end();
      });
    }
    return {pid: child?.pid, exitCode: child?.exitCode, signalCode: child?.signalCode, ...this.stats};
  }
}
