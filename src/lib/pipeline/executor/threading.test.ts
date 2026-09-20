import { describe, expect, it } from "vitest";

import { RunStore } from "../../store/store";
import { loopStageNode } from "../graph/stages";
import { createScriptedAdapter } from "./fixtures";
import { runLoopStage } from "./stage";

const IDEA = "Byte-for-byte threading check: café ☕ — `code`, <xml>, \"quotes\", \\backslash\\";
const NODE = loopStageNode("market-analysis");
const RUN = "r-threading";

const store = new RunStore(":memory:");
store.createRun({ id: RUN, idea: IDEA, config: { scoreThreshold: 9.0 } });

const adapter = createScriptedAdapter({ scores: [8.0, 9.5] });

const result = await runLoopStage({
  runId: RUN,
  node: NODE,
  idea: IDEA,
  config: { depth: "extreme", languages: ["en"], scoreThreshold: 9.0 },
  adapter,
  store,
  retry: { sleep: async () => {} },
});

describe("context threading (verification row 3)", () => {
  it("runs two rounds for 8.0 then 9.5", () => {
    expect(result.rounds).toBe(2);
  });

  it("contains every prior artifact byte-for-byte in every later prompt", async () => {
    // Each completed call persists exactly one artifact row, in the same
    // order: gen-a, gen-b, gen-c, merger, then per round critics/improver/
    // judges/reconciler — plus the final best-iteration winner row with no
    // call of its own.
    const artifacts = store.listRunArtifacts(RUN);
    const responses = adapter.calls.map((c) => c.response);

    expect(artifacts).toHaveLength(adapter.calls.length + 1);
    expect(artifacts.length).toBe(3 + 1 + 2 * 8 + 1);
    expect(artifacts[artifacts.length - 1].kind).toBe("improved");

    // Sibling calls of a parallel phase complete in nondeterministic order,
    // so the number of artifacts a prompt can quote is a function of the
    // call's ROLE (its phase start), not its completion position:
    //   gens: 0 · merger: 3 · then per round r (1-based, base = 4 + 8·(r−1)):
    //   critics +0 · improver +3 · judges +4 · reconciler +7.
    const ROUND_BASE = 4;
    let completedRounds = 0;
    for (let j = 0; j < adapter.calls.length; j++) {
      const role = adapter.calls[j].role;
      let expected: number;
      if (role.startsWith("gen-")) expected = 0;
      else if (role === "merger") expected = 3;
      else {
        const r = completedRounds + 1;
        const offset =
          role === "improver" ? 3 : role === "reconciler" ? 7 : role.startsWith("judge:") ? 4 : 0;
        expected = ROUND_BASE + 8 * (r - 1) + offset;
        if (role === "reconciler") completedRounds = r;
      }
      const prompt = adapter.calls[j].user;
      expect(prompt.split("<<<ARTIFACT ").length - 1).toBe(expected);
      for (let i = 0; i < expected; i++) {
        // Byte-for-byte: the full stored artifact text appears verbatim —
        // no summarization, truncation, or normalization. Unicode, markup,
        // quotes, and backslashes survive intact (see IDEA and longBody).
        expect(prompt).toContain(artifacts[i].text);
        // The stored artifact is the verbatim adapter response (T3).
        expect(artifacts[i].text).toBe(responses[i]);
      }
    }
  });

  it("threads the idea and every dependency-free first call gets an empty context", () => {
    for (const call of adapter.calls) {
      expect(call.user).toContain(IDEA);
    }
    // The very first calls (three parallel generators) start from nothing.
    const generators = adapter.calls.filter((c) => c.role.startsWith("gen-"));
    expect(generators).toHaveLength(3);
    for (const gen of generators) {
      expect(gen.user).toContain("none yet");
      expect(gen.user).not.toContain("<<<ARTIFACT ");
    }
    // The merger sees all three drafts; a round-2 critic sees the round-1
    // reconciler response (artifacts thread ACROSS rounds and phases).
    const merger = adapter.calls.find((c) => c.role === "merger");
    expect(merger?.user.split("<<<ARTIFACT ").length).toBe(4);
    const round2Critics = adapter.calls.filter((c) => c.role.startsWith("critic:")).slice(3);
    for (const critic of round2Critics) {
      const reconciler = store
        .listRunArtifacts(RUN)
        .find((a) => a.kind === "reconciler:r1");
      expect(reconciler).toBeDefined();
      expect(critic.user).toContain(reconciler?.text ?? "MISSING");
    }
  });
});
