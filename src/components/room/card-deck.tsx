import { For } from "solid-js";
import { type DeckType, deckCards } from "~/lib/room-protocol";
import { cn } from "~/lib/utils";

type Props = {
	deckType: DeckType;
	selected?: string;
	disabled?: boolean;
	onVote: (value: string) => void;
};

export function CardDeck(props: Props) {
	const cards = () => deckCards(props.deckType);

	return (
		<section aria-label="Card deck" class="space-y-3">
			<div class="flex items-baseline justify-between gap-3">
				<h2 class="section-label">Your estimate</h2>
				<p class="text-xs text-muted-foreground">
					{props.disabled ? "Locked" : "Private until reveal"}
				</p>
			</div>

			<div
				class="grid gap-2"
				style={{
					"grid-template-columns":
						"repeat(auto-fill, minmax(min(4.25rem, 22vw), 1fr))",
				}}
			>
				<For each={[...cards()]}>
					{(value) => {
						const selected = () => props.selected === value;
						return (
							<button
								type="button"
								disabled={props.disabled}
								aria-pressed={selected()}
								onClick={() => props.onVote(value)}
								class={cn(
									"flex min-h-14 items-center justify-center rounded-md border text-base font-semibold tabular-nums tracking-tight transition-colors duration-150",
									"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
									"disabled:cursor-not-allowed disabled:opacity-40",
									selected()
										? "border-primary bg-primary text-primary-foreground"
										: "border-border bg-transparent text-foreground hover:border-foreground/25 hover:bg-accent/60 active:bg-accent",
								)}
							>
								{value}
							</button>
						);
					}}
				</For>
			</div>
		</section>
	);
}
