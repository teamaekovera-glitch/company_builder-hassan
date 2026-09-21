/**
 * Stage detail builder (T9) — assembles the full tab history for one stage
 * from real store rows: drafts A/B/C, merged, per-round critiques, improved
 * iterations with the winning round resolved, judge verbatims with the
 * reconciler's rationale, translations, the HTML mockup artifact, and the
 * loop history (per call: attempts, tokens, duration).
 *
 * Pure read path — no store writes, no provider calls. The shape is the
 * dashboard's `StageDetailData` wire type; every text is quoted verbatim from
 * the store (spec: the tabs show the artifact for the selected iteration).
 */

import { languageLabel, type StageDetailData, type StageStatus as DashboardStageStatus } from "../dashboard/types";
import type { Language } from "../pipeline/graph/plan";
import { GENERATOR_ROLES, JUDGE_ROLES } from "../pipeline/graph/roles";
import { STAGE_NODES, type StageId, type StageNode } from "../pipeline/graph/stages";
import type { StageArtifactRow, StageStatus as StoreStageStatus } from "../store/schema";
import type { RunStore } from "../store/store";

/** Critic display order matches the spec's panel: VC, enterprise buyer, engineer. */
const CRITIC_INDEXES = new Map(
  ["critic:pessimistic-vc", "critic:enterprise-buyer", "critic:senior-engineer"].map((role, i) => [role, i + 1]),
);

/** `improved:r3` → { base: "improved", round: 3 }; plain `improved` → null. */
function parseRoundKind(kind: string): { base: string; round: number } | null {
  const match = /^(.*):r(\d+)$/.exec(kind);
  if (!match) return null;
  return { base: match[1] ?? "", round: Number(match[2]) };
}

/** Operator-facing label for a generator/critic/judge role. */
function roleLabel(role: string): string {
  if (role.startsWith("gen-")) {
    const letter = role.slice(4).toUpperCase();
    return `Generator ${letter}`;
  }
  const criticIndex = CRITIC_INDEXES.get(role);
  if (criticIndex !== undefined) return `Critic ${criticIndex} — ${role.slice("critic:".length)}`;
  const judgeMatch = /^judge:(.+)$/.exec(role);
  if (judgeMatch) {
    const index = JUDGE_ROLES.indexOf(role as (typeof JUDGE_ROLES)[number]);
    return `Judge ${(index === -1 ? 0 : index) + 1} — ${judgeMatch[1]}`;
  }
  return role;
}

/** Store stage status → the dashboard card vocabulary (pending renders as queued). */
function dashboardStatus(status: StoreStageStatus | undefined): DashboardStageStatus {
  switch (status) {
    case "pending":
    case undefined:
      return "queued";
    default:
      return status;
  }
}

/**
 * Resolves which critique round produced the deliverable. The executor writes
 * the winning text under kind `improved` (score = best round's reconciled
 * score); round rows live under `improved:rN`. The winner is the FIRST round
 * that strictly beat every earlier round, so on a score tie the earliest
 * round wins — matching the executor's `score > best.score` update rule.
 */
export function resolveWinningRound(
  winner: StageArtifactRow | undefined,
  rows: readonly StageArtifactRow[],
): number | null {
  if (!winner) return null;
  const roundImproved = rows
    .map((row) => ({ row, parsed: parseRoundKind(row.kind) }))
    .filter(({ parsed }) => parsed?.base === "improved")
    .sort((a, b) => (a.parsed?.round ?? 0) - (b.parsed?.round ?? 0));
  const byText = roundImproved.find(({ row }) => row.text === winner.text);
  if (byText) return byText.parsed?.round ?? null;
  // Fallback when round rows are absent: earliest reconciler row matching the
  // winner's recorded score.
  const byScore = rows
    .map((row) => ({ row, parsed: parseRoundKind(row.kind) }))
    .filter(({ row, parsed }) => parsed?.base === "reconciler" && row.score !== null && row.score === winner.score)
    .sort((a, b) => (a.parsed?.round ?? 0) - (b.parsed?.round ?? 0));
  return byScore[0]?.parsed?.round ?? null;
}

/** Builds the full stage-detail wire object, or undefined for an unknown run/stage. */
export function buildStageDetail(store: RunStore, runId: string, stageId: string): StageDetailData | undefined {
  if (!store.getRun(runId)) return undefined;
  const node = STAGE_NODES.find((n) => n.id === (stageId as StageId)) as StageNode | undefined;
  if (!node) return undefined;

  const status = store.getStageStatus(runId, stageId);
  const rows = store.listStageArtifacts(runId, stageId);
  const calls = store.getStageCalls(runId, stageId);

  // --- drafts + merged -------------------------------------------------------
  const generatorKinds = new Set<string>(GENERATOR_ROLES);
  const drafts = rows
    .filter((row) => generatorKinds.has(row.kind))
    .map((row) => ({ generator: roleLabel(row.kind), text: row.text }));
  const merged = rows.find((row) => row.kind === "merger")?.text ?? "";

  // --- critique rounds -------------------------------------------------------
  const critiques = rows
    .map((row) => ({ row, parsed: parseRoundKind(row.kind) }))
    .filter(({ parsed }) => parsed?.base.startsWith("critic:") === true)
    .sort((a, b) => (a.parsed?.round ?? 0) - (b.parsed?.round ?? 0))
    .map(({ row, parsed }) => ({
      critic: roleLabel(parsed?.base ?? row.kind),
      role: parsed?.base ?? row.kind,
      round: parsed?.round ?? 0,
      text: row.text,
    }));

  // --- improved iterations + winner ------------------------------------------
  const winner = rows.find((row) => row.kind === "improved");
  const winningRound = resolveWinningRound(winner, rows);
  const improved = rows
    .map((row) => ({ row, parsed: parseRoundKind(row.kind) }))
    .filter(({ parsed }) => parsed?.base === "improved")
    .sort((a, b) => (a.parsed?.round ?? 0) - (b.parsed?.round ?? 0))
    .map(({ row, parsed }) => ({
      round: parsed?.round ?? 0,
      text: row.text,
      score: row.score,
      winning: parsed?.round === winningRound,
    }));

  // --- score rounds: judge verbatims + reconciler rationale -------------------
  const rounds = new Set<number>();
  for (const { parsed } of rows.map((row) => ({ row, parsed: parseRoundKind(row.kind) }))) {
    if (parsed && (parsed.base.startsWith("critic:") || parsed.base === "improved" || parsed.base.startsWith("judge:") || parsed.base === "reconciler")) {
      rounds.add(parsed.round);
    }
  }
  const scoreRounds = [...rounds]
    .sort((a, b) => a - b)
    .map((round) => {
      const judges = rows
        .map((row) => ({ row, parsed: parseRoundKind(row.kind) }))
        .filter(({ parsed }) => parsed?.base.startsWith("judge:") === true && parsed.round === round)
        .map(({ row, parsed }) => ({
          judge: roleLabel(parsed?.base ?? row.kind),
          role: parsed?.base ?? row.kind,
          text: row.text,
        }));
      const reconciler = rows
        .map((row) => ({ row, parsed: parseRoundKind(row.kind) }))
        .find(({ parsed }) => parsed?.base === "reconciler" && parsed.round === round);
      return {
        round,
        judges,
        reconciled: reconciler?.row.score ?? null,
        reconcilerRationale: reconciler?.row.text ?? null,
      };
    });

  // --- translations: one entry per non-English language (latest row wins) -----
  // Store convention (schema.ts): translated documents are kind-encoded —
  // `translation:<lang>` on the same stage — with the language column "en".
  const byLanguage = new Map<string, StageArtifactRow>();
  for (const row of rows) {
    const match = /^translation:([a-z-]+)$/.exec(row.kind);
    if (match) byLanguage.set(match[1], row);
  }
  const translations = [...byLanguage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, row]) => ({ code: code as Language, label: languageLabel(code as Language), text: row.text }));

  // --- mockup: the single-file HTML mockup artifact, sandboxed downstream -----
  const mockup = rows.find((row) => row.kind.startsWith("screen-mockup"));

  // --- loop history: per (loop, role), first-appearance order ------------------
  const history = new Map<string, { loop: number; role: string; attempts: number; tokens: number; ms: number }>();
  for (const call of calls) {
    const key = `${call.loop}:${call.role}`;
    const entry = history.get(key) ?? { loop: call.loop, role: call.role, attempts: 0, tokens: 0, ms: 0 };
    entry.attempts += 1;
    entry.tokens += (call.input_tokens ?? 0) + (call.output_tokens ?? 0);
    entry.ms += call.ms ?? 0;
    history.set(key, entry);
  }

  return {
    stageId,
    title: node.title,
    status: dashboardStatus(status?.status),
    rounds: Math.max(0, ...rounds),
    winningRound,
    drafts,
    merged,
    critiques,
    improved,
    scoreRounds,
    translations,
    mockupHtml: mockup?.text ?? null,
    loopHistory: [...history.values()],
  };
}
