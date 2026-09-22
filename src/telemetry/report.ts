import os from "node:os";
import path from "node:path";
import { readMetrics, summarizeMetrics } from "./summary.js";

const directory = path.join(
  process.env.ALPHAOPTIMIZER_DATA_DIR ??
    path.join(os.homedir(), ".local/share/alphaoptimizer"),
  "metrics",
);
try {
  const { events, skipped, dropCounters } = await readMetrics(directory);
  console.log(
    JSON.stringify(
      {
        ...summarizeMetrics(events),
        skippedFilesOrRecords: skipped,
        observedDroppedRecords: dropCounters,
        completeness:
          "Best effort: rotation, retention, queue overflow, write failures or abrupt termination can remove records. Drop counters are lower bounds.",
        ...(process.argv.includes("--recent")
          ? { recent: events.slice(-10) }
          : {}),
      },
      null,
      2,
    ),
  );
} catch {
  process.stderr.write(
    "Unable to read local metrics; check directory permissions.\n",
  );
  process.exitCode = 1;
}
