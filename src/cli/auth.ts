import { Command } from "commander";
import pc from "picocolors";
import {
  configPath,
  deleteProfile,
  detectEnvironment,
  loadConfig,
  maskKey,
  resolveCredentials,
  setActiveProfile,
  upsertProfile,
} from "../core/config.js";
import type { Environment, Profile } from "../core/config.js";
import { MidtransClient } from "../core/client.js";
import { confirm, promptSecret, promptText } from "./prompt.js";
import { printError } from "./ui.js";

export const loginCommand = new Command("login")
  .description("Store your Midtrans server/client keys in ~/.midtrans/config.toml (validated live first)")
  .option("--profile <name>", "profile name to save as", "default")
  .option("--server-key <key>", "server key (skips the prompt; useful in scripts)")
  .option("--client-key <key>", "client key (optional, public — used by snap.js)")
  .option("--environment <env>", "force sandbox|production (by default detected from the key prefix)")
  .option("--no-validate", "skip the live key validation call")
  .action(runLogin);

async function runLogin(options: {
  profile: string;
  serverKey?: string;
  clientKey?: string;
  environment?: string;
  validate: boolean;
}): Promise<void> {
  try {
    console.error(pc.bold("Midtrans login"));
    console.error(
      pc.dim("Get your keys: Midtrans Dashboard → Settings → Configuration → Access Keys."),
    );
    console.error(pc.dim(`Sandbox keys start with "SB-Mid-server-", production keys with "Mid-server-".\n`));

    const serverKey = options.serverKey ?? (await promptSecret("Server key")).trim();
    if (!serverKey) {
      console.error(pc.red("✗ A server key is required."));
      process.exitCode = 1;
      return;
    }

    let environment = detectEnvironment(serverKey);
    if (!environment) {
      if (options.environment === "sandbox" || options.environment === "production") {
        environment = options.environment;
      } else {
        const answer = (
          await promptText("Could not detect environment from the key. Is this (1) sandbox or (2) production?", "1")
        ).trim();
        environment = answer === "2" ? "production" : "sandbox";
      }
    } else if (
      (options.environment === "sandbox" && environment === "production") ||
      (options.environment === "production" && environment === "sandbox")
    ) {
      console.error(
        pc.yellow(
          `⚠ --environment says ${options.environment} but the key prefix says ${environment}. Going with the key prefix (${environment}).`,
        ),
      );
    }

    if (options.validate) {
      console.error(pc.dim(`\nValidating key against ${environment}…`));
      const client = new MidtransClient({ serverKey, environment });
      const result = await client.validateCredentials();
      if (result.valid) {
        console.error(pc.green(`✓ ${result.message}`));
      } else {
        console.error(pc.red(`✗ ${result.message}`));
        const saveAnyway = await confirm("Save this key anyway?", false);
        if (!saveAnyway) {
          process.exitCode = 1;
          return;
        }
      }
    }

    let clientKey = options.clientKey;
    if (clientKey === undefined) {
      clientKey = (await promptSecret("Client key (optional — press Enter to skip)")).trim();
    }

    const config = loadConfig();
    const existing = config.profiles[options.profile];
    if (existing) {
      const overwrite = await confirm(`Profile "${options.profile}" already exists. Overwrite?`, true);
      if (!overwrite) {
        console.error("Aborted — nothing saved.");
        return;
      }
    }

    const profile: Profile = {
      environment,
      serverKey,
      ...(clientKey ? { clientKey } : {}),
      createdAt: new Date().toISOString(),
    };
    upsertProfile(options.profile, profile, true);

    console.error(pc.green(`\n✓ Saved profile "${options.profile}" → ${configPath()} (chmod 600)`));
    console.error(`  Environment : ${environment === "production" ? pc.red("production") : pc.green("sandbox")}`);
    console.error(`  Server key  : ${maskKey(serverKey)}`);
    if (clientKey) console.error(`  Client key  : ${maskKey(clientKey)}`);
    console.error(pc.dim(`\nNext steps:`));
    console.error(pc.dim(`  midtrans snap:create --amount 10000   # create a test payment`));
    console.error(pc.dim(`  midtrans doctor                       # check your setup`));
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }
}

export const whoamiCommand = new Command("whoami")
  .description("Show which credentials are currently in use and where they come from")
  .action(() => {
    try {
      const creds = resolveCredentials();
      const sourceLabels: Record<string, string> = {
        "flag-profile": `--profile ${creds.profileName}`,
        env: "environment variables (MIDTRANS_SERVER_KEY)",
        config: `active profile in ${configPath()}`,
      };
      console.error(pc.bold("Current credentials"));
      console.error(`  Source       : ${sourceLabels[creds.source] ?? creds.source}`);
      if (creds.profileName) console.error(`  Profile      : ${creds.profileName}`);
      console.error(
        `  Environment  : ${creds.environment === "production" ? pc.red("production") : pc.green("sandbox")}`,
      );
      console.error(`  Server key   : ${maskKey(creds.serverKey)}`);
      if (creds.clientKey) console.error(`  Client key   : ${maskKey(creds.clientKey)}`);
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });

export const profilesCommand = new Command("profiles")
  .description("List saved merchant profiles")
  .action(() => {
    const config = loadConfig();
    const names = Object.keys(config.profiles);
    if (names.length === 0) {
      console.error(pc.dim("No profiles saved yet. Run `midtrans login` to add one."));
      return;
    }
    console.error(pc.bold("Saved profiles"));
    for (const name of names) {
      const p = config.profiles[name]!;
      const active = config.activeProfile === name ? pc.green(" ← active") : "";
      const env = p.environment === "production" ? pc.red("production") : pc.green("sandbox");
      console.error(`  ${pc.bold(name)}  (${env})${active}`);
      console.error(pc.dim(`    server ${maskKey(p.serverKey)}  ·  saved ${p.createdAt.slice(0, 10)}`));
    }
  });

export const useCommand = new Command("use")
  .description("Switch the active profile")
  .argument("<name>", "profile name")
  .action((name: string) => {
    try {
      setActiveProfile(name);
      console.error(pc.green(`✓ Active profile is now "${name}".`));
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });

export const logoutCommand = new Command("logout")
  .description("Remove a saved profile (default: the active one)")
  .option("--profile <name>", "profile to remove")
  .option("--all", "remove every profile")
  .action((options: { profile?: string; all?: boolean }) => {
    const config = loadConfig();
    const names = options.all ? Object.keys(config.profiles) : [options.profile ?? config.activeProfile];
    const existing = names.filter((n): n is string => Boolean(n && config.profiles[n]));
    if (existing.length === 0) {
      console.error(pc.dim("Nothing to remove."));
      return;
    }
    let current = config;
    for (const name of existing) current = deleteProfile(name);
    console.error(pc.green(`✓ Removed ${existing.join(", ")}.`));
  });
