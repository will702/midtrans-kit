import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { MissingCredentialsError } from "./errors.js";

export type Environment = "sandbox" | "production";

export interface Profile {
  environment: Environment;
  serverKey: string;
  clientKey?: string;
  /** Display label for the merchant, defaults to the profile name. */
  merchantName?: string;
  createdAt: string;
}

export interface KitConfig {
  version: 1;
  activeProfile?: string;
  profiles: Record<string, Profile>;
}

export interface ResolvedCredentials {
  serverKey: string;
  clientKey?: string;
  environment: Environment;
  /** Where the credentials came from — for `whoami`/`doctor` output. */
  source: "flag-profile" | "env" | "config";
  profileName?: string;
}

/** Directory holding config.toml. Override for tests via MIDTRANS_KIT_HOME. */
export function kitHome(): string {
  return process.env.MIDTRANS_KIT_HOME ?? join(homedir(), ".midtrans");
}

export function configPath(): string {
  return join(kitHome(), "config.toml");
}

/**
 * Midtrans keys carry the environment in their prefix:
 *   SB-Mid-server-… / SB-Mid-client-… → sandbox
 *   Mid-server-…     / Mid-client-…     → production
 */
export function detectEnvironment(serverKey: string): Environment | null {
  if (serverKey.startsWith("SB-Mid-server-")) return "sandbox";
  if (serverKey.startsWith("Mid-server-")) return "production";
  return null;
}

/** Mask a key for display: `SB-Mid-server-***a1b2`. */
export function maskKey(key: string): string {
  if (!key) return "(empty)";
  const head = key.slice(0, 13);
  const tail = key.slice(-4);
  return `${head}***${tail}`;
}

export function loadConfig(): KitConfig {
  const path = configPath();
  if (!existsSync(path)) return { version: 1, profiles: {} };
  const raw = readFileSync(path, "utf8");
  const parsed = parse(raw) as unknown as KitConfig;
  return {
    version: 1,
    activeProfile: parsed.activeProfile,
    profiles: parsed.profiles ?? {},
  };
}

export function saveConfig(config: KitConfig): void {
  const dir = kitHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = configPath();
  writeFileSync(path, stringify(config), { mode: 0o600 });
  // stringify/write can land on a pre-existing file — force permissions.
  chmodSync(path, 0o600);
}

export function upsertProfile(name: string, profile: Profile, makeActive = true): KitConfig {
  const config = loadConfig();
  config.profiles[name] = profile;
  if (makeActive || !config.activeProfile) config.activeProfile = name;
  saveConfig(config);
  return config;
}

export function deleteProfile(name: string): KitConfig {
  const config = loadConfig();
  delete config.profiles[name];
  if (config.activeProfile === name) {
    config.activeProfile = Object.keys(config.profiles)[0];
  }
  saveConfig(config);
  return config;
}

export function setActiveProfile(name: string): void {
  const config = loadConfig();
  if (!config.profiles[name]) {
    throw new Error(`Profile "${name}" does not exist. Run \`midtrans profiles\` to list them.`);
  }
  config.activeProfile = name;
  saveConfig(config);
}

/**
 * Resolve credentials with a clear precedence:
 *   1. explicit `--profile` selection
 *   2. environment variables (same names used by production Midtrans codebases:
 *      MIDTRANS_SERVER_KEY, MIDTRANS_CLIENT_KEY, MIDTRANS_IS_PRODUCTION)
 *   3. the active profile in ~/.midtrans/config.toml
 */
export function resolveCredentials(options: { profile?: string } = {}): ResolvedCredentials {
  const envServerKey = process.env.MIDTRANS_SERVER_KEY;

  if (options.profile) {
    const config = loadConfig();
    const profile = config.profiles[options.profile];
    if (!profile) {
      throw new Error(
        `Profile "${options.profile}" does not exist. Run \`midtrans profiles\` to list them.`,
      );
    }
    return {
      serverKey: profile.serverKey,
      clientKey: profile.clientKey,
      environment: profile.environment,
      source: "flag-profile",
      profileName: options.profile,
    };
  }

  if (envServerKey) {
    const envFlag = process.env.MIDTRANS_IS_PRODUCTION;
    const fromKey = detectEnvironment(envServerKey);
    const environment: Environment =
      fromKey ??
      (envFlag === "true" ? "production" : envFlag === "false" ? "sandbox" : "sandbox");
    return {
      serverKey: envServerKey,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
      environment,
      source: "env",
    };
  }

  const config = loadConfig();
  const activeName = config.activeProfile;
  const profile = activeName ? config.profiles[activeName] : undefined;
  if (profile) {
    return {
      serverKey: profile.serverKey,
      clientKey: profile.clientKey,
      environment: profile.environment,
      source: "config",
      profileName: activeName,
    };
  }

  throw new MissingCredentialsError();
}
