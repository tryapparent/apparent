import { registerHooks } from "node:module";

export const clientFixture = new URL(process.env.CONNECT_MCP_FIXTURE ?? "");
const endpoint = new URL("endpoint.integration.ts", import.meta.url).href;
const prefix = "../../../client/typescript/";

registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === endpoint && specifier.startsWith(prefix)) {
      return next(
        new URL(specifier.slice(prefix.length), clientFixture).href,
        context,
      );
    }
    return next(specifier, context);
  },
});
