"use client";
/* eslint-disable react-hooks/refs -- dnd-kit exposes reactive drop state and a callback ref from this hook. */

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { Stage, WorkCardData } from "@/src/components/board/types";
import { WorkCard } from "@/src/components/board/WorkCard";

const labels: Record<Stage, string> = { backlog: "Backlog", planning: "Planning", building: "Building", review: "Review", done: "Done" };

export function BoardColumn({ stage, cards, onOpen }: Readonly<{
  stage: Stage; cards: readonly WorkCardData[]; onOpen: (card: WorkCardData) => void;
}>) {
  const droppable = useDroppable({ id: stage, data: { stage }, disabled: stage === "done" });
  return (
    <section ref={droppable.setNodeRef} className={`board-column${droppable.isOver ? " over" : ""}`} aria-labelledby={`column-${stage}`}>
      <header><h2 id={`column-${stage}`}>{labels[stage]}</h2><span>{cards.length}</span></header>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <div className="card-list">
          {cards.length ? cards.map((card) => <WorkCard key={card.id} card={card} onOpen={() => onOpen(card)} />) : <p className="empty-column">Nothing here</p>}
        </div>
      </SortableContext>
    </section>
  );
}
