import { For, Show } from "solid-js";
import type { ParticipantSnapshot } from "~/lib/room-protocol";
import { cn } from "~/lib/utils";

type Props = {
	participants: ParticipantSnapshot[];
	revealed: boolean;
	selfId?: string;
};

function stateLabel(
	participant: ParticipantSnapshot,
	revealed: boolean,
): string {
	if (!participant.connected) {
		return "Away";
	}
	// When votes are public, the results section owns the numbers.
	if (revealed) {
		return "Online";
	}
	if (participant.hasVoted) {
		return "Voted";
	}
	return "Waiting";
}

export function ParticipantList(props: Props) {
	const onlineCount = () =>
		props.participants.filter((p) => p.connected).length;

	return (
		<section aria-label="Participants" class="space-y-3">
			<div class="flex items-baseline justify-between gap-3">
				<h2 class="section-label">Participants</h2>
				<span class="text-xs tabular-nums text-muted-foreground">
					{onlineCount()} online
				</span>
			</div>

			<Show
				when={props.participants.length > 0}
				fallback={
					<p class="py-2 text-sm text-muted-foreground">
						Waiting for teammates to join…
					</p>
				}
			>
				<ul class="divide-y divide-border/70 border-y border-border/70">
					<For each={props.participants}>
						{(participant) => {
							const isSelf = () => participant.id === props.selfId;
							const votedQuiet = () =>
								participant.hasVoted &&
								!props.revealed &&
								participant.connected;

							return (
								<li
									class={cn(
										"flex items-center justify-between gap-3 py-3",
										!participant.connected && "opacity-50",
									)}
								>
									<p class="min-w-0 truncate text-sm font-medium tracking-tight text-foreground">
										{participant.name}
										<Show when={isSelf()}>
											<span class="font-normal text-muted-foreground">
												{" "}
												(you)
											</span>
										</Show>
									</p>
									<span
										class={cn(
											"shrink-0 text-xs tabular-nums",
											votedQuiet()
												? "font-medium text-success"
												: "text-muted-foreground",
										)}
									>
										{stateLabel(participant, props.revealed)}
									</span>
								</li>
							);
						}}
					</For>
				</ul>
			</Show>
		</section>
	);
}
