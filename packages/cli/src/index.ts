import { Command } from "commander";

export function createCliProgram(): Command {
  const program = new Command("openfrost");

  program
    .description("OpenFrost local AI operating system CLI")
    .version("0.0.0")
    .command("status")
    .description("Show scaffold status")
    .action(() => {
      process.stdout.write("OpenFrost CLI scaffold ready.\n");
    });

  return program;
}
