#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { createRequire } from "node:module";

import { loginCommand, logoutCommand, profilesCommand, useCommand, whoamiCommand } from "./auth.js";
import {
  approveCommand,
  cancelCommand,
  denyCommand,
  expireCommand,
  refundCommand,
  snapCreateCommand,
  statusCommand,
} from "./ops.js";
import { webhookTestCommand, webhookVerifyCommand } from "./webhook.js";
import { doctorCommand } from "./doctor.js";
import { docsCommand } from "./docs.js";
import { initCommand } from "./init.js";

const require = createRequire(import.meta.url);
const version = (() => {
  try {
    return require("../../package.json").version as string;
  } catch {
    return "0.0.0-dev";
  }
})();

const program = new Command();

program
  .name("midtrans")
  .description(
    "Midtrans payment toolkit for developers — create payments, check status,\n" +
      "test webhooks locally, and scaffold integrations. Safe by default (sandbox-first).",
  )
  .version(version);

program.addCommand(loginCommand);
program.addCommand(whoamiCommand);
program.addCommand(profilesCommand);
program.addCommand(useCommand);
program.addCommand(logoutCommand);

program.addCommand(snapCreateCommand);
program.addCommand(statusCommand);
program.addCommand(approveCommand);
program.addCommand(denyCommand);
program.addCommand(cancelCommand);
program.addCommand(expireCommand);
program.addCommand(refundCommand);

program.addCommand(webhookTestCommand);
program.addCommand(webhookVerifyCommand);

program.addCommand(initCommand);
program.addCommand(doctorCommand);
program.addCommand(docsCommand);

program
  .command("mcp", { hidden: false })
  .description("Start the midtrans-kit MCP server (stdio) for AI coding agents")
  .action(async () => {
    const { runMcpServer } = await import("../mcp/server.js");
    await runMcpServer();
  });

program.action((_args, command) => {
  // No subcommand given → show help with the getting-started hint.
  command.outputHelp();
  console.error(
    pc.dim(
      "\nQuickstart:\n" +
        "  midtrans login                    # save your sandbox keys\n" +
        "  midtrans snap:create --amount 10000 --open   # create + open a test payment\n" +
        "  midtrans webhook:test --url http://localhost:3000/api/payment/webhook\n",
    ),
  );
});

program.parseAsync(process.argv).catch((error) => {
  console.error(pc.red(`✗ ${(error as Error).message}`));
  process.exit(1);
});
