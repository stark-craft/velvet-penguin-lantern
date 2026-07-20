import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const clientRoot = resolve(projectRoot, "dist", "client");
const serverEntry = resolve(projectRoot, "dist", "server", "index.js");

async function render(pathname = "/") {
  const { default: worker } = await import(serverEntry);
  return worker.fetch(
    new Request(`http://signalroom.test${pathname}`, {
      headers: { host: "signalroom.test" },
    }),
    {},
    {},
  );
}

function localAssetPaths(html) {
  const matches = html.matchAll(/(?:href|src)="(\/[^"?#]+)(?:[?#][^"]*)?"/g);
  return [...new Set([...matches].map((match) => match[1]))].filter((path) =>
    path.startsWith("/assets/") || path.startsWith("/images/"),
  );
}

test("the production worker renders the Signalroom application shell", async () => {
  const response = await render();
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en" data-theme="light" data-profile="default">/);
  assert.match(html, /<title>Signalroom — AI News Intelligence<\/title>/);
  assert.match(html, /AI News Intelligence/);
  assert.match(html, /Morning briefing/);
  assert.match(html, /Analyst/);
  assert.doesNotMatch(html, /vinext-starter/i);

  const assets = localAssetPaths(html);
  assert.ok(assets.length >= 2, "rendered HTML should reference built local assets");
  await Promise.all(
    assets.map((assetPath) => access(resolve(clientRoot, `.${assetPath}`))),
  );
});

test("the production bundle contains a deployable client manifest", async () => {
  const manifestPath = resolve(clientRoot, ".vite", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const browserEntry = manifest["virtual:vinext-app-browser-entry"];
  const signalroomEntry = manifest["components/SignalroomApp.tsx"];

  assert.equal(browserEntry?.isEntry, true);
  assert.equal(signalroomEntry?.isDynamicEntry, true);
  await access(resolve(clientRoot, browserEntry.file));
  await access(resolve(clientRoot, signalroomEntry.file));
});

test("unknown application routes fail closed", async () => {
  const response = await render("/this-route-does-not-exist");
  assert.equal(response.status, 404);
});
