import type { Writable } from "node:stream";
export function parentChannel(
  output: Writable,
  onLost: (error: Error) => void,
) {
  let connected = true;
  const lost = (error: Error) => {
    if (connected) {
      connected = false;
      onLost(error);
    }
  };
  output.on("error", lost);
  return {
    send(action: unknown) {
      if (!connected) return false;
      try {
        output.write(
          JSON.stringify(typeof action === "string" ? { action } : action) +
            "\n",
          (error) => {
            if (error) lost(error);
          },
        );
        return true;
      } catch (error) {
        lost(error instanceof Error ? error : Error("Parent write failed"));
        return false;
      }
    },
    close() {
      connected = false;
    },
  };
}
