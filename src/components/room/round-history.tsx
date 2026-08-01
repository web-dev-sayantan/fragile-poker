import { createSignal, For, Show } from "solid-js";
import type { HistoryEntry } from "~/lib/room-protocol";

type Props = {
	history: HistoryEntry[];
};

function formatStat(value: number | null): string {
	if (value == null) {
		return "—";
	}
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function RoundHistory(props: Props) {
	const [open, setOpen] = createSignal(false);

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
				<span class="text-xs text-muted-foreground">
					{open() ? "Hide" : "Show"}
				</span>
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
											<span class="text-xs tabular-nums text-muted-foreground">
												avg {formatStat(entry.average)}
												<span class="mx-1.5 text-border" aria-hidden="true">
													·
												</span>
												median {formatStat(entry.median)}
											</span>
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
					</Show>
				</div>
			</Show>
		</section>
	);
}
