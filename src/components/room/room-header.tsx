import { createSignal, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { CopyLinkButton } from "~/components/ui/copy-link-button";
import {
	DECK_LABELS,
	type DeckType,
	roomNameSchema,
} from "~/lib/room-protocol";
import type { ConnectionStatus } from "~/lib/use-room-connection";

type Props = {
	roomId: string;
	roomName: string;
	deckType: DeckType;
	roundNumber: number;
	status: ConnectionStatus;
	shareUrl: string;
	onRenameRoom: (roomName: string) => void;
};

function statusLabel(status: ConnectionStatus): string {
	switch (status) {
		case "connected":
			return "Connected";
		case "connecting":
			return "Connecting…";
		case "reconnecting":
			return "Reconnecting…";
		case "closed":
			return "Disconnected";
		case "error":
			return "Error";
		default:
			return "Idle";
	}
}

function statusDotClass(status: ConnectionStatus): string {
	switch (status) {
		case "connected":
			return "bg-success";
		case "reconnecting":
		case "connecting":
			return "bg-warning";
		case "error":
		case "closed":
			return "bg-destructive";
		default:
			return "bg-muted-foreground";
	}
}

export function RoomHeader(props: Props) {
	const [editing, setEditing] = createSignal(false);
	const [draftName, setDraftName] = createSignal(props.roomName);
	const [nameError, setNameError] = createSignal<string | null>(null);

	const saveRoomName = () => {
		const result = roomNameSchema.safeParse(draftName());
		if (!result.success) {
			setNameError(result.error.issues[0]?.message || "Invalid room name");
			return;
		}
		props.onRenameRoom(result.data);
		setNameError(null);
		setEditing(false);
	};

	return (
		<header class="space-y-4 border-b border-border pb-5">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0 flex-1 space-y-1.5">
					<Show
						when={editing()}
						fallback={
							<div class="flex items-start gap-1">
								<h1 class="min-w-0 text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
									{props.roomName}
								</h1>
								{/* Accessible name kept for e2e: Rename */}
								<Button
									variant="ghost"
									size="icon"
									class="-mt-1 shrink-0 text-muted-foreground"
									aria-label="Rename"
									onClick={() => {
										setDraftName(props.roomName);
										setNameError(null);
										setEditing(true);
									}}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.75"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
										<path d="m15 5 4 4" />
									</svg>
								</Button>
							</div>
						}
					>
						<form
							class="flex flex-col gap-2 sm:flex-row sm:items-center"
							onSubmit={(event) => {
								event.preventDefault();
								saveRoomName();
							}}
						>
							<label class="sr-only" for="room-name">
								Room name
							</label>
							<input
								id="room-name"
								class="field-control h-10 min-w-0 flex-1 sm:max-w-xs"
								value={draftName()}
								onInput={(event) => setDraftName(event.currentTarget.value)}
								maxLength={60}
								autofocus
							/>
							<div class="flex gap-2">
								<Button type="submit" size="sm">
									Save
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => {
										setEditing(false);
										setNameError(null);
									}}
								>
									Cancel
								</Button>
							</div>
						</form>
					</Show>

					<Show when={nameError()}>
						{(message) => <p class="text-xs text-destructive">{message()}</p>}
					</Show>

					<p class="text-sm text-muted-foreground">
						{DECK_LABELS[props.deckType]} · Round {props.roundNumber}
					</p>
				</div>

				<div class="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
					<div
						class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
						aria-live="polite"
					>
						<span
							class={`inline-block size-1.5 rounded-full ${statusDotClass(props.status)}`}
							aria-hidden="true"
						/>
						<span>{statusLabel(props.status)}</span>
					</div>
					<CopyLinkButton url={props.shareUrl} />
				</div>
			</div>
		</header>
	);
}
