import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

process.chdir("candidate");
const images = readdirSync("dist").filter((name) =>
  /^Apparent-[0-9.]+-linux-x86_64\.AppImage$/.test(name),
);
if (images.length !== 1) throw Error("Expected one x86-64 AppImage");
const [name] = images;
execFileSync("sha256sum", ["--check", "--", name + ".sha256"], {
  cwd: "dist",
  stdio: "inherit",
});
const image = join("dist", name);
chmodSync(image, 0o755);
const builder = "composition/enablement/release/amazon-linux-cli/build.ts";
if (existsSync(builder)) {
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", builder, "dist", image, "cli"],
    {
      stdio: "inherit",
    },
  );
}
appendFileSync(process.env.GITHUB_OUTPUT!, `name=${name}\n`);
