import {useEffect, useRef, useState} from "react";
import {Button} from "@apparent/ui/button";
import {ErrorDialog} from "@apparent/ui/error-dialog";
import {Switch} from "@apparent/ui/switch";
import {Input} from "@apparent/ui/input";
import {Check, Cloud, HardDrive, Laptop, Monitor, MoreHorizontal, PcCase, Plus, Server, Terminal} from "lucide-react";
import policy from "../pure/t3-settings.mjs";
import type {T3Environment, T3Facts, T3PairingPreview, T3SettingsBridge} from "./t3-contract";
import "./t3.css";

const machineIcons = { server: Server, cloud: Cloud, linux: Terminal, desktop: Monitor, laptop: Laptop, "mac-mini": HardDrive, "mac-studio": PcCase };
const statuses = ["Checking connection…", "Connected", "Disconnected", "Pairing expired"];
const refreshSending = "Refresh to check whether sending to T3 Code is enabled, then try again.";

export function T3Settings({bridge, artwork}: {bridge: T3SettingsBridge; artwork: string}) {
  const [facts, setFacts] = useState<T3Facts>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [setup, setSetup] = useState<{name?: string}>();
  const [preview, setPreview] = useState<T3PairingPreview>();
  const [server, setServer] = useState("");
  const [environments, setEnvironments] = useState<T3Environment[]>();
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [managedOrigin, setManagedOrigin] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const manualButton = useRef<HTMLButtonElement>(null);
  const preferenceRow = useRef<HTMLDivElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const restoreToggle = useRef(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const live = useRef(false);
  const pending = useRef(false);
  const previewRevision = useRef(0);
  const known = Boolean(facts && !facts.error);
  const enabled = policy.show_computers(facts?.t3Saved === true, known);
  const computers = facts?.t3Connections ?? (facts?.t3Origin && facts.t3ExpiresAt !== undefined
    ? [{origin: facts.t3Origin, expiresAt: facts.t3ExpiresAt}]
    : []);
  const computerKey = JSON.stringify(computers);

  async function request(value?: boolean, reportError = true) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      const result = value === undefined ? await bridge.read() : await bridge.saveT3(value);
      if (live.current) {
        setFacts(result);
        setError(result.error && reportError ? refreshSending : "");
      }
    } catch {
      if (live.current) {
        setFacts(undefined);
        setError(reportError ? refreshSending : "");
      }
    } finally {
      pending.current = false;
      if (live.current) setSaving(false);
    }
  }

  useEffect(() => {
    if (known && !saving && restoreToggle.current) {
      restoreToggle.current = false;
      preferenceRow.current?.querySelector("button")?.focus();
    }
  }, [known, saving]);

  useEffect(() => {
    live.current = true;
    const unsubscribe = bridge.subscribe(value => {
      if (!pending.current) {
        setFacts(value);
        if (!value.error) setError("");
      }
    });
    void request(undefined, false);
    return () => {
      live.current = false;
      ++previewRevision.current;
      void bridge.cancelT3().catch(() => {});
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => {
    if (!enabled) {
      setCopyState("idle");
      setManagedOrigin(undefined);
      return;
    }
    let active = true;
    setEnvironments(undefined);
    void bridge.t3Environments().then(
      value => { if (active) setEnvironments(value); },
      () => { if (active) setEnvironments([]); },
    );
    return () => { active = false; };
  }, [bridge, enabled, computerKey]);

  useEffect(() => {
    if (copyState !== "copied") return;
    const timeout = setTimeout(() => setCopyState("idle"), 2500);
    return () => clearTimeout(timeout);
  }, [copyState]);

  useEffect(() => {
    if (!setup) return;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      const trigger = dialogTrigger.current;
      if (trigger?.isConnected) trigger.focus();
      else manualButton.current?.focus();
    };
  }, [setup]);

  function closeSetup() {
    ++previewRevision.current;
    setSetup(undefined);
    setPreview(undefined);
    setConnectionError("");
    void bridge.cancelT3().catch(() => {});
  }

  function openSetup(trigger: HTMLElement, origin?: string, name?: string) {
    dialogTrigger.current = trigger;
    setConnectionError("");
    setServer(origin ?? (facts?.t3Configured ? "" : "http://127.0.0.1:3773"));
    setSetup({name});
  }

  function changeServer(value: string) {
    ++previewRevision.current;
    setServer(value);
    setPreview(undefined);
    setConnectionError("");
    void bridge.cancelT3().catch(() => {});
  }

  async function copySetup() {
    if (copyState === "copying") return;
    setCopyState("copying");
    try {
      await bridge.copyT3Setup();
      if (live.current) setCopyState("copied");
    } catch {
      if (live.current) setCopyState("failed");
    }
  }

  async function pasteLink() {
    const revision = ++previewRevision.current;
    setConnectionError("");
    setPreview(undefined);
    try {
      const result = await bridge.previewT3(server);
      if (!live.current || revision !== previewRevision.current) return;
      if (result.error) setConnectionError(result.error);
      else setPreview(result.preview);
    } catch {
      if (live.current && revision === previewRevision.current)
        setConnectionError("Unable to read the pairing link. Copy it in T3 Code, then try again.");
    }
  }

  async function updateConnection(origin?: string) {
    if (connecting || (origin === undefined && !preview)) return;
    setConnecting(true);
    setConnectionError("");
    try {
      if (origin) {
        const result = await bridge.disconnectT3(origin);
        if (!live.current) return;
        setFacts(result);
        setManagedOrigin(undefined);
        if (result.error) setConnectionError("Disconnection was not confirmed. Refresh to check the connection.");
        else manualButton.current?.focus();
        return;
      }
      const result = await bridge.connectT3(preview!.id);
      if (!live.current) return;
      if (result.reason) {
        setConnectionError({
          cancelled: "Connection cancelled. Copy a fresh link to try again.",
          unavailable: "Couldn’t connect. Check the address and copy a fresh link in T3 Code.",
          unconfirmed: "The app didn’t confirm the saved connection. Refresh before trying again.",
        }[result.reason]);
        if (result.reason === "unconfirmed") void request();
      } else {
        setFacts(result.facts);
        if (result.facts.error) setConnectionError("The app didn’t confirm the saved connection. Refresh before trying again.");
        else closeSetup();
      }
    } catch {
      if (live.current) setConnectionError(origin
        ? "Disconnection was not confirmed. Refresh to check the connection."
        : "Couldn’t connect. Copy a fresh T3 Code link and try again.");
    } finally {
      if (live.current) {
        setConnecting(false);
        setPreview(undefined);
      }
    }
  }

  return <section className="settings-t3 settings-agents" aria-labelledby="agent-t3-label">
    <div className="agent-preference-row" ref={preferenceRow}>
      <h2 id="agent-t3-label" tabIndex={-1}>Send recordings to T3 Code</h2>
      <Switch id="agent-t3-control" className="agent-switch" checked={enabled}
        aria-labelledby="agent-t3-label" aria-describedby="agent-t3-help"
        aria-busy={saving} aria-disabled={saving || connecting}
        disabled={!known} onCheckedChange={value => {
          if (!saving && !connecting) void request(value);
        }} />
    </div>
    <p id="agent-t3-help">Choose a T3 Code thread from the recording controls.</p>
    {!known && <p id="agent-t3-unconfirmed" role="status">{saving ? "Checking the T3 sending preference…" : "The saved T3 sending preference is unconfirmed."}</p>}
    {!known && !error && <Button ref={refreshButton} variant="secondary" aria-describedby="agent-t3-unconfirmed" aria-disabled={saving}
      onClick={() => {restoreToggle.current = true; void request();}}>Refresh T3 sending</Button>}
    {enabled && <section className="settings-t3-computers" aria-labelledby="t3-computers-label">
      <h3 id="t3-computers-label">Computers</h3>
      {computers.length ? <ul className="settings-t3-list">{computers.map(computer => {
        const metadata = environments?.find(environment => environment.origin === computer.origin);
        const host = new URL(computer.origin).host;
        const name = metadata?.name || host;
        const Glyph = machineIcons[metadata?.icon as keyof typeof machineIcons] ?? Server;
        const status = policy.computer_status(computer.expiresAt <= Date.now(), environments !== undefined, Boolean(metadata));
        return <li key={computer.origin} className="settings-t3-computer">
          <Glyph aria-hidden="true" className="settings-t3-glyph" />
          <div className="settings-t3-identity"><p>{name}</p><span>{statuses[status]}</span></div>
          <div className="settings-t3-row-actions">
            {status >= 2 && <Button variant="link" className="t3-text-action" disabled={connecting} aria-label={`Reconnect ${name}`} onClick={event => openSetup(event.currentTarget, computer.origin, name)}>Reconnect</Button>}
            <Button variant="ghost" aria-label={`Manage ${name}`} aria-expanded={managedOrigin === computer.origin}
              disabled={connecting} onClick={() => setManagedOrigin(managedOrigin === computer.origin ? undefined : computer.origin)}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </div>
          {managedOrigin === computer.origin && <div className="settings-t3-details">
            <p>{host}</p>
            <Button variant="link" className="t3-text-action" disabled={connecting} aria-label={`Disconnect ${name}`} onClick={() => void updateConnection(computer.origin)}>Disconnect</Button>
          </div>}
        </li>;
      })}</ul> : <p>No computers paired.</p>}
      <div className="settings-t3-actions">
        <Button aria-describedby="t3-setup-help" aria-disabled={copyState === "copying"} onClick={() => void copySetup()}>
          {copyState === "copied" ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {copyState === "copied" ? "Copied" : "Copy setup prompt"}
        </Button>
        <Button ref={manualButton} variant="link" className="t3-text-action" disabled={connecting} onClick={event => openSetup(event.currentTarget)}>Pair with a link</Button>
      </div>
      <p id="t3-setup-help">Paste the prompt into an agent on the computer you want to add.</p>
      <span role="status" className="sr-only">{copyState === "copied" ? "Setup prompt copied" : ""}</span>
    </section>}
    {setup && <dialog ref={dialog} className="settings-t3-dialog" aria-labelledby="t3-setup-title"
      onCancel={event => {event.preventDefault(); if (!connecting) closeSetup();}}>
      <h2 id="t3-setup-title">{setup.name ? `Reconnect ${setup.name}` : "Pair with a link"}</h2>
      <p>In T3 Code Settings, open <strong>Authorized clients</strong> and create a link with <strong>View environment</strong> and <strong>Operate tasks</strong>. Copy the full link.</p>
      <details className="settings-t3-server"><summary>Use a code instead</summary>
        <label htmlFor="t3-server">MCP URL or server address</label>
        <Input id="t3-server" type="url" value={server} maxLength={2048} autoComplete="url" spellCheck={false}
          aria-describedby="t3-server-help" disabled={connecting} onChange={event => changeServer(event.target.value)} />
        <p id="t3-server-help" className="settings-metadata">In T3 Code Settings → Environments, copy the computer’s MCP URL and paste it here. Then copy the pairing code and choose Paste link or code.</p>
      </details>
      {preview && <div className="settings-t3-preview"><p>Connect to</p><strong>{preview.origin}</strong><p>Apparent can read threads and send recordings you choose.</p></div>}
      {connecting && <p role="status">Connecting…</p>}
      {connectionError && <p role="alert">{connectionError}</p>}
      <div className="settings-t3-dialog-actions">
        {preview && <Button disabled={connecting} onClick={() => void updateConnection()}>Connect</Button>}
        <Button variant={preview ? "outline" : "default"} className={preview ? "settings-decision-alternative" : undefined}
          disabled={connecting} onClick={() => void pasteLink()}>{preview ? "Paste another" : "Paste link or code"}</Button>
        <Button variant="outline" className="settings-decision-alternative" disabled={connecting} onClick={closeSetup}>Cancel</Button>
      </div>
    </dialog>}
    <ErrorDialog open={Boolean(error)} title={facts?.error === "config_write_failed" ? "Unable to save T3 sending preference" : "T3 sending preference unconfirmed"} description={error} artwork={<img src={artwork} alt="" />}
      recoveryLabel="Refresh T3 sending" busy={saving} restoreFocus={() => (known ? preferenceRow.current?.querySelector("button") : refreshButton.current)?.focus()}
      onRecover={() => void request()} onClose={() => setError("")} />
    <ErrorDialog open={Boolean(connectionError) && !setup} title="T3 connection not confirmed" description={connectionError}
      recoveryLabel="Refresh connection" busy={saving || connecting} artwork={<img src={artwork} alt="" />}
      onRecover={() => {setConnectionError(""); void request();}} onClose={() => setConnectionError("")} />
    <ErrorDialog open={copyState === "failed"} title="Couldn’t copy the setup prompt"
      description="Try copying again, or choose Pair with a link to set up manually." artwork={<img src={artwork} alt="" />}
      recoveryLabel="Try again" onRecover={() => void copySetup()} onClose={() => setCopyState("idle")} />
  </section>;
}
