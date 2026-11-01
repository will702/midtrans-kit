import { Command } from "commander";
import pc from "picocolors";
import { DOC_TOPICS, listTopics, searchDocs } from "../core/docs.js";

export const docsCommand = new Command("docs")
  .description("Offline Midtrans quick-reference (test cards, statuses, signature, webhook, …)")
  .argument("[topic]", "topic name or search words")
  .action((topic?: string) => {
    if (!topic) {
      console.error(pc.bold("Available topics — `midtrans docs <topic>`\n"));
      console.error(listTopics());
      console.error(pc.dim(`\nYou can also search freely: midtrans docs qris`));
      return;
    }

    const exact = DOC_TOPICS.find((t) => t.name === topic.toLowerCase());
    const matches = exact ? [exact] : searchDocs(topic);
    if (matches.length === 0) {
      console.error(pc.yellow(`No topic matches "${topic}". Available topics:\n`));
      console.error(listTopics());
      return;
    }
    for (const doc of matches.slice(0, 3)) {
      console.error(pc.bold(`${doc.title}`) + pc.dim(`  (midtrans docs ${doc.name})`));
      console.error(doc.body);
      console.error("");
    }
  });
