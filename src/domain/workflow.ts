import type { Card, ItemType, MatchReason, Stage } from "@/src/domain/types";

const fullWorkflow = [
  "backlog",
  "planning",
  "building",
  "review",
  "done",
] as const satisfies readonly Stage[];

const reviewWorkflow = ["backlog", "planning", "review", "done"] as const satisfies readonly Stage[];

type WorkflowInput = Readonly<{
  itemType: ItemType;
  matchReasons: readonly MatchReason[];
}>;

export function getWorkflow(input: WorkflowInput): readonly Stage[] {
  if (input.itemType === "issue") {
    return fullWorkflow;
  }
  const implementationWork = input.matchReasons.some(
    (reason) => reason === "authored" || reason === "assigned",
  );
  return implementationWork ? fullWorkflow : reviewWorkflow;
}

export function canMoveCard(card: Card, destination: Stage): boolean {
  if (
    destination === "done" ||
    card.stage === "done" ||
    card.activeRunState === "queued" ||
    card.activeRunState === "running"
  ) {
    return false;
  }

  const workflow = getWorkflow(card);
  const currentIndex = workflow.indexOf(card.stage);
  const destinationIndex = workflow.indexOf(destination);
  return currentIndex >= 0 && destinationIndex >= 0 && Math.abs(destinationIndex - currentIndex) === 1;
}

export function isForwardMove(card: Card, destination: Stage): boolean {
  const workflow = getWorkflow(card);
  return workflow.indexOf(destination) > workflow.indexOf(card.stage);
}
