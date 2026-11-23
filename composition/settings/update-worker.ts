import { readFileSync } from "node:fs";
import { needsChannelRelease, selectRelease } from "./update-policy.ts";

const request = JSON.parse(readFileSync(0, "utf8"));
switch (request.operation) {
  case "selectRelease":
    process.stdout.write(
      JSON.stringify(
        selectRelease(request.channel, request.arch, request.releases),
      ),
    );
    break;
  case "needsChannelRelease":
    process.stdout.write(JSON.stringify(needsChannelRelease(request)));
    break;
  default:
    throw Error("Invalid update policy operation");
}
