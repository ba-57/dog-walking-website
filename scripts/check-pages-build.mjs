import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { JSDOM } from "jsdom";
import {
  PAGES_BASE_PATH,
  PUBLIC_BUILD_VARIABLES,
  validateProductionConfig,
} from "./release-config.mjs";

export function credentialFindings(text) {
  const findings = [];
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text))
    findings.push("Supabase secret key");
  if (/\b0x[A-Za-z0-9_-]{33}\b/.test(text))
    findings.push("possible Turnstile Secret Key");
  if (/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/.test(text))
    findings.push("GitHub credential");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    findings.push("private key");
  for (const token of text.match(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  ) || []) {
    let claims;
    try {
      claims = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );
    } catch {
      continue;
    }
    if (claims.role && claims.role !== "anon")
      findings.push("privileged or user JWT");
  }
  return [...new Set(findings)];
}

export function verifyPagesBuild(root, env) {
  const config = validateProductionConfig(env);
  const dist = join(root, "dist");
  if (!existsSync(join(dist, "index.html")))
    throw new Error("Missing dist/index.html. Run the Pages build first.");
  const walk = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : [join(directory, entry.name)],
    );
  const files = walk(dist);
  const failures = [];
  const bundleText = [];
  for (const file of files) {
    const name = relative(dist, file);
    if (
      /(^|\/)(?:\.env(?:\..*)?|\.git|node_modules|supabase|work)(?:\/|$)/.test(
        name,
      ) ||
      name.endsWith(".map")
    )
      failures.push(`${name}: forbidden deployment file`);
    if (!/\.(?:html|js|css|json|txt|svg|map)$/i.test(name)) continue;
    const text = readFileSync(file, "utf8");
    bundleText.push(text);
    for (const finding of credentialFindings(text))
      failures.push(`${name}: ${finding}`);
    if (/TURNSTILE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(text))
      failures.push(`${name}: server-only configuration in browser artifact`);
  }
  const combined = bundleText.join("\n");
  for (const name of PUBLIC_BUILD_VARIABLES) {
    if (!combined.includes(config[name]))
      failures.push(`Build did not embed ${name}`);
  }
  const dom = new JSDOM(readFileSync(join(dist, "index.html"), "utf8"), {
    url: `https://ba-57.github.io${PAGES_BASE_PATH}`,
  });
  for (const node of dom.window.document.querySelectorAll("[src],link[href]")) {
    const raw = node.getAttribute("src") || node.getAttribute("href");
    const url = new URL(raw, `https://ba-57.github.io${PAGES_BASE_PATH}`);
    if (url.origin !== "https://ba-57.github.io") continue;
    if (!url.pathname.startsWith(PAGES_BASE_PATH)) {
      failures.push(`Asset outside Pages base path: ${url.pathname}`);
      continue;
    }
    const asset = resolve(
      dist,
      decodeURIComponent(url.pathname.slice(PAGES_BASE_PATH.length)),
    );
    if (
      !asset.startsWith(`${resolve(dist)}/`) ||
      !existsSync(asset) ||
      !statSync(asset).isFile()
    )
      failures.push(`Missing Pages asset: ${url.pathname}`);
  }
  dom.window.close();
  let tracked;
  try {
    tracked = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
    )
      .toString()
      .split("\0")
      .filter(Boolean);
  } catch {
    tracked = null;
  }
  if (tracked) {
    for (const name of tracked) {
      if (/(^|\/)\.env(?:\..*)?$/.test(name) && name !== ".env.example")
        failures.push(`${name}: environment file in Git source`);
      const file = join(root, name);
      if (
        !existsSync(file) ||
        !statSync(file).isFile() ||
        !/\.(?:html|js|mjs|ts|json|md|yml|yaml|sql|toml|txt)$/.test(name)
      )
        continue;
      for (const finding of credentialFindings(readFileSync(file, "utf8")))
        failures.push(`${name}: ${finding}`);
    }
    if (existsSync(join(root, ".env.local"))) {
      try {
        execFileSync("git", ["check-ignore", "-q", ".env.local"], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        failures.push(".env.local is not ignored by Git");
      }
    }
  }
  if (failures.length)
    throw new Error(
      `Release checks failed:\n${[...new Set(failures)].join("\n")}`,
    );
  console.log(
    `Pages checks passed: ${files.length} deployment files, correct base path, public configuration present, no private credentials detected.${tracked ? " Git environment-file check passed." : " No Git metadata: artifact check only."}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  verifyPagesBuild(root, {
    ...loadEnv("production", root, "VITE_"),
    ...process.env,
  });
}
