import { createNativeHostPort } from '@apparent/native-host';
import { createNativePenPort } from '@apparent/native-host/pen';
import { createNativeClipboardPort, createNativeClipboardTextReadbackPort, MAX_UTF8_TEXT_BYTES } from '@apparent/native-host/clipboard';
import {
  createRecordLocalClipboardPort,
  createRecordLocalClipboardTextReadbackPort,
  createRecordNativePort,
  createRecordPenConfigPort,
  type RecordLocalHandoffResolution,
} from '@apparent/record/host/native';
import { createRecordPenColorConfig } from '@apparent/config-host';

export interface RecordNativeBindingOptions {
  /** Permission policy is supplied by trusted Record composition, never a renderer. */
  requiredPermissionIds: readonly string[];
  /** Resolves only an authenticated, already-saved capture/artifact pair. */
  resolveHandoff(identity: Readonly<{ captureId: string; artifactId: string }>): Promise<RecordLocalHandoffResolution | null>;
  /** The admitted executable and config path for Record's sole existing writer. */
  config: { executable: string; executableSha256: string; configPath: string };
  /** Explicit proof contract; no automatic fallback between clipboard guarantees. */
  clipboardProof?: 'ownership-readback' | 'submission-readback';
}

interface SharedRecordNativeBindings {
  native: ReturnType<typeof createRecordNativePort>;
  penConfig: ReturnType<typeof createRecordPenConfigPort>;
  /** Closes only the config backend created by this binding. Safe to call repeatedly. */
  close(): Promise<void>;
}
export type RecordNativeBindings = SharedRecordNativeBindings & (
  | { clipboard: ReturnType<typeof createRecordLocalClipboardPort>; clipboardTextReadback?: never }
  | { clipboard?: never; clipboardTextReadback: ReturnType<typeof createRecordLocalClipboardTextReadbackPort> }
);

/**
 * Binds the public native/config producers to Record's public owner adapters.
 * This is privileged main-process composition; no options originate in a renderer.
 */
export async function createRecordNativeBindings(options: RecordNativeBindingOptions): Promise<RecordNativeBindings> {
  if (!options || !Array.isArray(options.requiredPermissionIds)
    || options.requiredPermissionIds.some(id => typeof id !== 'string')
    || typeof options.resolveHandoff !== 'function' || !options.config
    || typeof options.config.executable !== 'string'
    || typeof options.config.executableSha256 !== 'string'
    || typeof options.config.configPath !== 'string'
    || (options.clipboardProof !== undefined && !['ownership-readback', 'submission-readback'].includes(options.clipboardProof))) {
    throw new TypeError('Invalid Record native binding options');
  }

  // Snapshot all caller-controlled values before config setup yields.
  const requiredPermissionIds = Object.freeze([...options.requiredPermissionIds]);
  const resolveHandoff = options.resolveHandoff;
  const clipboardProof = options.clipboardProof ?? 'ownership-readback';
  const configOptions = Object.freeze({
    executable: options.config.executable,
    executableSha256: options.config.executableSha256,
    configPath: options.config.configPath,
  });

  const nativeHost = createNativeHostPort();
  const nativePen = createNativePenPort();

  let config: Awaited<ReturnType<typeof createRecordPenColorConfig>> | undefined;
  try {
    config = await createRecordPenColorConfig(configOptions);
    const native = createRecordNativePort(nativeHost, { requiredPermissionIds });
    const penConfig = createRecordPenConfigPort({ config, nativePen, nativeHost });
    const clipboardPorts = clipboardProof === 'submission-readback'
      ? { clipboardTextReadback: createRecordLocalClipboardTextReadbackPort({ clipboard: createNativeClipboardTextReadbackPort(),
          nativeHost, resolveHandoff, maximumTextBytes: MAX_UTF8_TEXT_BYTES }) }
      : { clipboard: createRecordLocalClipboardPort({ clipboard: createNativeClipboardPort(),
          nativeHost, resolveHandoff, maximumTextBytes: MAX_UTF8_TEXT_BYTES }) };

    let closing: Promise<void> | undefined;
    return {
      native,
      penConfig,
      ...clipboardPorts,
      close() {
        closing ??= Promise.resolve().then(() => config!.close());
        return closing;
      },
    };
  } catch (error) {
    if (config) {
      try { await config.close(); }
      catch (closeError) {
        throw new AggregateError([error, closeError], 'Record native binding setup and config cleanup failed');
      }
    }
    throw error;
  }
}

