import type { AgentClient } from "./agentClient.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { Logger } from "./logger.js";

export interface Deps {
  config: Config;
  db: Db;
  logger: Logger;
  agent: AgentClient;
}
