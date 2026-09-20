/**
 * Process-singleton wiring for the API routes: one SQLite store, one SSE
 * hub, one orchestrator per Node process. Construction is lazy — importing
 * this module never touches the filesystem; the first route invocation
 * opens the database and applies boot semantics (a run found `running` is
 * marked `interrupted`; the operator re-runs).
 *
 * The store path is `RUN_DB_PATH` (set in deployments) or `.data/runs.sqlite3`
 * under the process working directory — SQLite is the only persistence.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createAdapterFromEnv } from "../llm/factory";
import { toPublishable } from "./events";
import { EventedRunStore } from "./evented-store";
import { SSEHub } from "./hub";
import { Orchestrator } from "./orchestrator";
import type { OrchestratorServices } from "./api";

export function configuredStorePath(): string {
  return process.env.RUN_DB_PATH ?? join(process.cwd(), ".data", "runs.sqlite3");
}

let services: OrchestratorServices | undefined;

/** Lazily wired singleton: store → hub bridge → orchestrator → boot sweep. */
export function getServices(): OrchestratorServices {
  if (services) return services;

  const hub = new SSEHub();
  const path = configuredStorePath();
  mkdirSync(dirname(path), { recursive: true });
  const store = new EventedRunStore(path, {
    onEvent: (event) => {
      hub.publish(event.runId, toPublishable(event));
    },
  });
  const orchestrator = new Orchestrator({
    store,
    // Transport is resolved lazily at confirm time so a missing key only
    // fails the confirm action, never run creation.
    adapterFactory: () => createAdapterFromEnv(),
  });
  orchestrator.markInterruptedRuns();

  services = { orchestrator, hub };
  return services;
}

/** Test seam: forget the singleton so a fresh wiring can be built. */
export function resetServicesForTests(): void {
  services = undefined;
}
