"use client";

import { closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BoardColumn } from "@/src/components/board/BoardColumn";
import { FilterBar } from "@/src/components/board/FilterBar";
import type { BoardData, Stage, WorkCardData } from "@/src/components/board/types";
import { WorkCardPreview } from "@/src/components/board/WorkCardPreview";
import { CardDrawer } from "@/src/components/card/CardDrawer";

const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

async function readBoard(): Promise<BoardData> {
  const response = await fetch("/api/board", { cache: "no-store" });
  if (!response.ok) throw new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? "Board could not load");
  return response.json() as Promise<BoardData>;
}

export function BoardClient() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<WorkCardData | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const repository = params.get("repository") ?? "";
  const query = params.get("query") ?? "";
  const itemType = params.get("type") ?? "";
  const reason = params.get("reason") ?? "";
  const status = params.get("status") ?? "";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const refresh = useCallback(async () => {
    try { setBoard(await readBoard()); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Board could not load"); }
  }, []);
  useEffect(() => {
    void readBoard().then((data) => { setBoard(data); setError(""); }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Board could not load");
    });
  }, []);
  const active = board?.syncPending || board?.refresh?.status === "running" || board?.cards.some((card) => ["queued", "running"].includes(card.runs[0]?.status ?? ""));
  useEffect(() => { if (!active) return; const timer = window.setInterval(() => void refresh(), 2_000); return () => window.clearInterval(timer); }, [active, refresh]);
  const visible = useMemo(() => board?.cards.filter((card) =>
    (!repository || card.repository === repository) &&
    (!itemType || card.itemType === itemType) &&
    (!reason || card.matchReasons.includes(reason)) &&
    (!status || card.runs[0]?.status === status) &&
    (!query || `${card.title} ${card.repository}`.toLowerCase().includes(query.toLowerCase())),
  ) ?? [], [board, itemType, query, reason, repository, status]);
  const repositories = useMemo(() => [...new Set(board?.cards.map((card) => card.repository) ?? [])].sort(), [board]);
  const setFilter = (name: string, value: string): void => { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); router.replace(`?${next.toString()}`); };
  const request = async (url: string, body?: unknown): Promise<void> => {
    const response = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? "Request failed");
    await refresh();
  };
  const dragStart = (event: DragStartEvent): void => {
    setActiveCard(board?.cards.find((candidate) => candidate.id === event.active.id) ?? null);
  };
  const dragEnd = async (event: DragEndEvent): Promise<void> => {
    setActiveCard(null);
    if (!board || !event.over) return;
    const card = board.cards.find((candidate) => candidate.id === event.active.id);
    if (!card) return;
    const overCard = board.cards.find((candidate) => candidate.id === event.over?.id);
    const destination = (overCard?.stage ?? event.over.data.current?.stage) as Stage | undefined;
    try {
      if (destination && destination !== card.stage) await request(`/api/cards/${card.id}/move`, { destination });
      else if (overCard && overCard.id !== card.id) await request(`/api/cards/${card.id}/order`, { position: overCard.position - 0.5 });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Move failed"); }
  };
  if (!board && !error) return <section className="loading-panel" aria-live="polite"><p>Loading your board...</p></section>;
  if (!board) return <section className="configuration-panel"><h2>Board unavailable</h2><p>{error}</p><button type="button" onClick={() => void refresh()}>Try again</button></section>;
  const selected = board.cards.find((card) => card.id === selectedId) ?? null;
  return (
    <>
      <FilterBar repositories={repositories} repository={repository} query={query} itemType={itemType} reason={reason} status={status} busy={board.syncPending || board.refresh?.status === "running"} onFilter={setFilter} onSync={() => void request("/api/sync").catch((reason: Error) => setError(reason.message))} />
      <div className="board-summary"><span>{board.config.organization}</span><span>{visible.length} open items</span><span>Agent limit {board.config.concurrency}</span>{board.refresh?.finishedAt ? <span>Updated {new Date(board.refresh.finishedAt).toLocaleTimeString()}</span> : <span>Not synced yet</span>}</div>
      {error ? <p className="board-error" role="alert">{error}</p> : null}
      {board.refresh?.errors.length ? <details className="refresh-errors"><summary>{board.refresh.errors.length} refresh warnings</summary><ul>{board.refresh.errors.map((item) => <li key={`${item.scope}-${item.code}`}>{item.scope}: {item.message}</li>)}</ul></details> : null}
      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={dragStart} onDragEnd={(event) => void dragEnd(event)} onDragCancel={() => setActiveCard(null)}>
        <section className="board" aria-label="Engineering work stages">
          {board.columns.map((stage) => <BoardColumn key={stage} stage={stage} cards={visible.filter((card) => card.stage === stage)} onOpen={(card: WorkCardData) => setSelectedId(card.id)} />)}
        </section>
        <DragOverlay>{activeCard ? <WorkCardPreview card={activeCard} /> : null}</DragOverlay>
      </DndContext>
      {selected ? <CardDrawer card={selected} onClose={() => setSelectedId(null)} onChanged={() => void refresh()} /> : null}
    </>
  );
}
