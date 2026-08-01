import { For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import type { ParticipantSnapshot } from "~/lib/room-protocol";
import { averageVotes, medianVotes } from "~/lib/room-protocol";
import { cn } from "~/lib/utils";

type Props = {
	participants: ParticipantSnapshot[];
	onReset: () => void;
};

function formatStat(value: number | null): string {
	if (value == null) {
		return "—";
	}
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function RevealResults(props: Props) {
	const votes = () =>
		props.participants
			.map((p) => p.vote)
			.filter((v): v is string => typeof v === "string");

	const average = () => averageVotes(votes());
	const median = () => medianVotes(votes());

	const numericVotes = () =>
		votes()
			.map((v) => Number(v))
			.filter((n) => Number.isFinite(n));

	const minVote = () => {
		const nums = numericVotes();
		return nums.length ? Math.min(...nums) : null;
	};
	const maxVote = () => {
		const nums = numericVotes();
		return nums.length ? Math.max(...nums) : null;
	};

	return (
		<section aria-label="Reveal results" class="space-y-5">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 class="text-sm font-medium tracking-tight text-foreground">
						Results
					</h2>
				</div>
				<div class="flex gap-5 text-sm tabular-nums">
					<div class="space-y-0.5">
						<p class="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
							Avg
						</p>
						<p class="font-semibold text-foreground">{formatStat(average())}</p>
					</div>
					<div class="space-y-0.5">
						<p class="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
							Median
						</p>
						<p class="font-semibold text-foreground">{formatStat(median())}</p>
					</div>
				</div>
			</div>

			<ul class="divide-y divide-border/80 border-y border-border/80">
				<For each={props.participants}>
					{(participant) => {
						const voteNum = () =>
							participant.vote != null &&
							Number.isFinite(Number(participant.vote))
								? Number(participant.vote)
								: null;
						const isMin = () =>
							voteNum() != null &&
							minVote() != null &&
							voteNum() === minVote() &&
							minVote() !== maxVote();
						const isMax = () =>
							voteNum() != null &&
							maxVote() != null &&
							voteNum() === maxVote() &&
							minVote() !== maxVote();

						return (
							<li class="flex items-center justify-between gap-3 py-3">
								<span class="min-w-0 truncate text-sm font-medium tracking-tight">
									{participant.name}
								</span>
								<span class="flex shrink-0 items-center gap-2">
									<Show when={isMin()}>
										<span class="text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
											Low
										</span>
									</Show>
									<Show when={isMax()}>
										<span class="text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
											High
										</span>
									</Show>
									<span
										class={cn(
											"min-w-8 text-right text-sm font-semibold tabular-nums text-foreground",
										)}
									>
										{participant.vote ?? "—"}
									</span>
								</span>
							</li>
						);
					}}
				</For>
			</ul>

			<Button class="w-full sm:w-auto" onClick={() => props.onReset()}>
				Reset for next round
			</Button>
		</section>
	);
}
