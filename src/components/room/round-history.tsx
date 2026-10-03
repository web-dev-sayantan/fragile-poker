import { ChevronDown, Trash, Trash2 } from "lucide-solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import type { HistoryEntry } from "~/lib/room-protocol";

type Props = {
	history: HistoryEntry[];
	onDeleteRound: (roundNumber: number) => void;
	onClearHistory: () => void;
};

function formatStat(value: number | null): string {
	if (value == null) {
		return "—";
	}
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function RoundHistory(props: Props) {
	const [open, setOpen] = createSignal(false);
	const [confirmAction, setConfirmAction] = createSignal<{
		type: "deleteRound" | "clearHistory";
		roundNumber?: number;
	} | null>(null);
	let lastFocused: HTMLElement | null = null;

	const handleDeleteRound = (roundNumber: number) => {
		if (document.activeElement instanceof HTMLElement) {
			lastFocused = document.activeElement;
		}
		setConfirmAction({ type: "deleteRound", roundNumber });
	};

	const handleClearHistory = () => {
		if (document.activeElement instanceof HTMLElement) {
			lastFocused = document.activeElement;
		}
		setConfirmAction({ type: "clearHistory" });
	};

	const closeConfirm = () => {
		setConfirmAction(null);
		lastFocused?.focus();
		lastFocused = null;
	};

	const confirmDelete = () => {
		const action = confirmAction();
		if (!action) return;
		if (action.type === "deleteRound") {
			if (action.roundNumber != null) {
				props.onDeleteRound(action.roundNumber);
			}
		} else {
			props.onClearHistory();
		}
		closeConfirm();
	};

	return (
		<section class="border-t border-border pt-1">
			<button
				type="button"
				class="flex w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
				aria-expanded={open()}
				onClick={() => setOpen((value) => !value)}
			>
				<span class="text-sm font-medium tracking-tight text-foreground">
					Round history ({props.history.length})
				</span>
				<ChevronDown
					size={16}
					strokeWidth={1.75}
					aria-hidden="true"
					class={`shrink-0 text-muted-foreground transition-transform duration-150 ${
						open() ? "rotate-180" : ""
					}`}
				/>
			</button>

			<Show when={open()}>
				<div class="pb-2">
					<Show
						when={props.history.length > 0}
						fallback={
							<p class="pb-2 text-sm text-muted-foreground">
								Revealed rounds will appear here for this session.
							</p>
						}
					>
						<ul class="space-y-4 pb-2">
							<For each={props.history}>
								{(entry) => (
									<li class="space-y-1.5 text-sm">
										<div class="flex flex-wrap items-baseline justify-between gap-2">
											<span class="font-medium tracking-tight text-foreground">
												Round {entry.roundNumber}
											</span>
											<div class="flex items-center gap-1">
												<span class="text-xs tabular-nums text-muted-foreground">
													avg {formatStat(entry.average)}
													<span class="mx-1.5 text-border" aria-hidden="true">
														·
													</span>
													median {formatStat(entry.median)}
												</span>
												<Button
													variant="ghost"
													size="icon"
													class="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
													aria-label={`Delete round ${entry.roundNumber}`}
													onClick={() => handleDeleteRound(entry.roundNumber)}
												>
													<Trash
														size={16}
														strokeWidth={1.75}
														aria-hidden="true"
													/>
												</Button>
											</div>
										</div>
										<p class="text-xs leading-relaxed text-muted-foreground">
											{entry.results
												.map((result) => `${result.name}: ${result.vote}`)
												.join(" · ")}
										</p>
									</li>
								)}
							</For>
						</ul>
						<div class="pt-2 border-t border-border">
							<Button
								variant="ghost"
								size="sm"
								class="w-full text-destructive hover:bg-destructive/10"
								onClick={handleClearHistory}
							>
								<Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
								<span>Clear all history</span>
							</Button>
						</div>
					</Show>
				</div>
			</Show>

			<Show when={confirmAction()}>
				{(actionAccessor) => {
					const action = actionAccessor();
					let dialogRef: HTMLDialogElement | undefined;
					createEffect(() => {
						dialogRef?.showModal();
					});
					return (
						<dialog
							ref={dialogRef}
							class="fixed left-1/2 top-1/2 m-0 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border-none bg-background p-6 shadow-lg backdrop:bg-black/50"
							aria-labelledby="confirm-dialog-title"
							onClick={(e) => {
								if (e.target === dialogRef) {
									closeConfirm();
								}
							}}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									e.preventDefault();
									closeConfirm();
								}
							}}
						>
							<h3
								id="confirm-dialog-title"
								class="text-lg font-semibold text-foreground"
							>
								{action.type === "deleteRound"
									? `Delete round ${action.roundNumber}?`
									: "Clear all history?"}
							</h3>
							<p class="mt-2 text-sm text-muted-foreground">
								{action.type === "deleteRound"
									? "This will permanently remove this round from history. This action cannot be undone."
									: "This will permanently remove all rounds from history. This action cannot be undone."}
							</p>
							<div class="mt-4 flex justify-end gap-2">
								<Button variant="ghost" size="sm" onClick={closeConfirm}>
									Cancel
								</Button>
								<Button variant="danger" size="sm" onClick={confirmDelete}>
									{action.type === "deleteRound" ? "Delete" : "Clear all"}
								</Button>
							</div>
						</dialog>
					);
				}}
			</Show>
		</section>
	);
}
