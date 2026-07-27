#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("pi-cli")
  .description("Pi Studio CLI — Node.js CLI template")
  .version("0.0.0")
  .parse();
