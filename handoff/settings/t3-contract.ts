export const t3SetupPrompt = `Help me add this T3 Code environment to apparent so I can send recordings to its threads. Confirm which environment I mean if it is ambiguous. Use a T3 CLI that matches the running server. If t3 is missing from PATH, look for the CLI bundled with the running T3 Code desktop app. Use a route the computer running apparent can already reach, with loopback only when both apps are on the same computer. Create a short-lived pairing link with only orchestration:read and orchestration:operate. Run apparent t3 pair on the computer where I use apparent, passing the full link privately on stdin. Never print the link or token in chat. If CLI pairing is unavailable, guide me through Authorized clients in T3 Code and Pair with a link in apparent Settings → Agents. Verify the expected origin appears in apparent t3 status. Keep other connections and sending preferences intact.`;

export type T3Computer = { origin: string; expiresAt: number };
export type T3Environment = { origin: string; name: string; icon: string };
export type T3PairingPreview = { id: string; origin: string };
export type T3Facts = {
  t3Saved?: boolean | null;
  t3Configured?: boolean;
  t3Origin?: string;
  t3ExpiresAt?: number;
  t3Connections?: T3Computer[];
  error?: "config_read_failed" | "config_write_failed";
};

export type T3SettingsBridge = {
  read(): Promise<T3Facts>;
  saveT3(enabled: boolean): Promise<T3Facts>;
  previewT3(server: string): Promise<{ preview: T3PairingPreview; error?: never } | { error: string; preview?: never }>;
  connectT3(id: string): Promise<{ facts: T3Facts; reason?: never } | { reason: "cancelled" | "unavailable" | "unconfirmed"; facts?: never }>;
  cancelT3(): Promise<void>;
  disconnectT3(origin: string): Promise<T3Facts>;
  copyT3Setup(): Promise<void>;
  t3Environments(): Promise<T3Environment[]>;
  subscribe(callback: (facts: T3Facts) => void): () => void;
};
