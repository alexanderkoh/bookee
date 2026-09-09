/**
 * Finding likely spam, and acting on it.
 *
 * Kept apart from spam.ts for the same reason rules.ts and apply-rules.ts are
 * split: the judgement stays pure and directly testable, and this module owns
 * the database side.
 *
 * Marking spam writes a *rule* rather than annotating the rows in front of you.
 * A dust sender that has sent forty payments will send a forty-first, and an
 * airdropped token arrives in one burst but reappears next month. A rule covers
 * both, re-applies after every sync, and stays visible and reversible on the
 * Rules screen instead of being an invisible bulk edit nobody can audit later.
 */
import type { Repositories } from "../db/repositories";
import type { UnnamedCounterparty } from "../db/repositories/contact-repository";
import { assessSpam, type SpamAssessment } from "./spam";
import { reapplyRules } from "./apply-rules";
import { createLogger } from "../lib/log";

const log = createLogger("spam");

export interface SpamCandidate extends UnnamedCounterparty {
  assessment: SpamAssessment;
}

/**
 * Counterparties worth a second look, most suspicious first.
 *
 * Only ever a suggestion list: nothing here is excluded until the user says so.
 */
export async function findSpamCandidates(
  repositories: Repositories,
  workspaceId: string,
): Promise<SpamCandidate[]> {
  const [parties, familiar] = await Promise.all([
    repositories.contacts.unnamedCounterparties(workspaceId, 500),
    repositories.contacts.familiarAssetCodes(workspaceId),
  ]);

  return parties
    .map((party) => ({
      ...party,
      assessment: assessSpam({
        address: party.address,
        memo: party.memo,
        network: party.network,
        entryCount: party.entryCount,
        incomingCount: party.incomingCount,
        outgoingCount: party.outgoingCount,
        distinctAmountCount: party.distinctAmountCount,
        largestAmount: party.largestAmount,
        assetCodes: party.assetCodes,
        onlyUnfamiliarAssets: party.assetCodes.every((code) => !familiar.has(code)),
        memoSamples: party.memoSamples,
      }),
    }))
    .filter((candidate) => candidate.assessment.verdict !== "unremarkable")
    .toSorted(
      (a, b) =>
        rank(a.assessment.verdict) - rank(b.assessment.verdict) || b.entryCount - a.entryCount,
    );
}

/** Certain suggestions first; within a tier, the noisiest counterparty first. */
function rank(verdict: SpamAssessment["verdict"]): number {
  return verdict === "likely" ? 0 : 1;
}

/** Short label for the rule a marking creates, so the Rules screen reads sensibly. */
function ruleName(subject: string): string {
  return `Spam: ${subject}`;
}

/**
 * Marks everything from one counterparty as spam.
 *
 * Scoped by memo when the group had one, so marking a customer's sub-account on
 * a shared custodial address cannot silently swallow the whole address.
 */
export async function markCounterpartyAsSpam(
  repositories: Repositories,
  workspaceId: string,
  party: { address: string; memo: string | null },
): Promise<number> {
  const conditions = [
    { field: "counterparty_address" as const, operator: "equals" as const, value: party.address },
    ...(party.memo
      ? [{ field: "memo" as const, operator: "equals" as const, value: party.memo }]
      : []),
  ];

  await repositories.rules.create({
    workspaceId,
    name: ruleName(`${party.address.slice(0, 8)}…${party.memo ? ` (memo ${party.memo})` : ""}`),
    conditions,
    actions: [{ type: "set_spam", value: "true" }],
    // Below the default, so a rule the user wrote by hand always wins.
    priority: 200,
  });

  const result = await reapplyRules(repositories, workspaceId);
  log.info("counterparty marked as spam", { address: party.address, changed: result.changed });
  return result.changed;
}

/**
 * Marks an entire asset as spam.
 *
 * The bigger lever of the two: an airdropped token arrives as hundreds of
 * entries from many addresses, and no per-counterparty marking would ever catch
 * up with it.
 */
export async function markAssetAsSpam(
  repositories: Repositories,
  workspaceId: string,
  asset: { assetId: string; assetCode: string },
): Promise<number> {
  await repositories.rules.create({
    workspaceId,
    name: ruleName(asset.assetCode),
    conditions: [{ field: "asset", operator: "equals", value: asset.assetId }],
    actions: [{ type: "set_spam", value: "true" }],
    priority: 200,
  });

  const result = await reapplyRules(repositories, workspaceId);
  log.info("asset marked as spam", { asset: asset.assetCode, changed: result.changed });
  return result.changed;
}
