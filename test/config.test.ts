import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import {
  deleteProfile,
  detectEnvironment,
  loadConfig,
  maskKey,
  resolveCredentials,
  saveConfig,
  upsertProfile,
} from "../src/core/config.js";
import { MissingCredentialsError } from "../src/core/errors.js";

const home = mkdtempSync(join(tmpdir(), "midtrans-kit-test-"));

beforeEach(() => {
  process.env.MIDTRANS_KIT_HOME = home;
  delete process.env.MIDTRANS_SERVER_KEY;
  delete process.env.MIDTRANS_CLIENT_KEY;
  delete process.env.MIDTRANS_IS_PRODUCTION;
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.MIDTRANS_KIT_HOME;
});

describe("detectEnvironment", () => {
  it("recognizes sandbox and production prefixes", () => {
    assert.equal(detectEnvironment("SB-Mid-server-abc123"), "sandbox");
    assert.equal(detectEnvironment("Mid-server-abc123"), "production");
    assert.equal(detectEnvironment("not-a-key"), null);
  });
});

describe("maskKey", () => {
  it("hides the middle of the key", () => {
    assert.equal(maskKey("SB-Mid-server-abcdef1234"), "SB-Mid-server***1234");
    assert.equal(maskKey(""), "(empty)");
  });
});

describe("profile store", () => {
  it("saves, reloads, and deletes profiles with 0600 permissions", () => {
    upsertProfile("sandbox-main", {
      environment: "sandbox",
      serverKey: "SB-Mid-server-test",
      clientKey: "SB-Mid-client-test",
      createdAt: new Date().toISOString(),
    });

    const config = loadConfig();
    assert.equal(config.activeProfile, "sandbox-main");
    assert.equal(config.profiles["sandbox-main"]?.serverKey, "SB-Mid-server-test");

    const mode = statSync(join(home, "config.toml")).mode & 0o777;
    assert.equal(mode, 0o600);

    deleteProfile("sandbox-main");
    assert.equal(loadConfig().profiles["sandbox-main"], undefined);
  });
});

describe("resolveCredentials precedence", () => {
  it("throws a helpful error with nothing configured", () => {
    assert.throws(() => resolveCredentials(), MissingCredentialsError);
  });

  it("falls back to the active profile", () => {
    saveConfig({
      version: 1,
      activeProfile: "shop",
      profiles: {
        shop: {
          environment: "sandbox",
          serverKey: "SB-Mid-server-profile-key",
          createdAt: new Date().toISOString(),
        },
      },
    });
    const creds = resolveCredentials();
    assert.equal(creds.serverKey, "SB-Mid-server-profile-key");
    assert.equal(creds.environment, "sandbox");
    assert.equal(creds.source, "config");
  });

  it("prefers env vars over the active profile", () => {
    saveConfig({
      version: 1,
      activeProfile: "shop",
      profiles: {
        shop: { environment: "sandbox", serverKey: "SB-Mid-server-profile-key", createdAt: "2026-01-01" },
      },
    });
    process.env.MIDTRANS_SERVER_KEY = "Mid-server-env-key";
    const creds = resolveCredentials();
    assert.equal(creds.serverKey, "Mid-server-env-key");
    assert.equal(creds.environment, "production"); // detected from key prefix
    assert.equal(creds.source, "env");
  });

  it("explicit --profile wins over env vars", () => {
    process.env.MIDTRANS_SERVER_KEY = "Mid-server-env-key";
    saveConfig({
      version: 1,
      activeProfile: "other",
      profiles: {
        shop: { environment: "sandbox", serverKey: "SB-Mid-server-profile-key", createdAt: "2026-01-01" },
        other: { environment: "sandbox", serverKey: "SB-Mid-server-other", createdAt: "2026-01-01" },
      },
    });
    const creds = resolveCredentials({ profile: "shop" });
    assert.equal(creds.serverKey, "SB-Mid-server-profile-key");
    assert.equal(creds.source, "flag-profile");
  });

  it("MIDTRANS_IS_PRODUCTION is respected when the key has no recognizable prefix", () => {
    process.env.MIDTRANS_SERVER_KEY = "custom-gateway-key";
    process.env.MIDTRANS_IS_PRODUCTION = "true";
    assert.equal(resolveCredentials().environment, "production");
  });
});
