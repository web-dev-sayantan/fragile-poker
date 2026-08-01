import { createFileRoute, Link } from "@tanstack/solid-router";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { CardDeck } from "~/components/room/card-deck";
import { JoinDialog } from "~/components/room/join-dialog";
import { ParticipantList } from "~/components/room/participant-list";
import { RevealResults } from "~/components/room/reveal-results";
import { RoomHeader } from "~/components/room/room-header";
import { RoundHistory } from "~/components/room/round-history";
import { Button } from "~/components/ui/button";
import { readIdentity } from "~/lib/identity";
import { useRoomConnection } from "~/lib/use-room-connection";
import { getRoom } from "~/server/rooms";

export const Route = createFileRoute("/room/$roomId")({
	loader: async ({ params }) => {
		const room = await getRoom({ data: { roomId: params.roomId } });
		return { room };
	},
	component: RoomPage,
});

function RoomPage() {
	const loaderData = Route.useLoaderData();
	const params = Route.useParams();

	return (
		<Show
			when={loaderData().room}
			fallback={<RoomNotFound roomId={params().roomId} />}
		>
			{(room) => (
				<RoomSession
					roomId={room().roomId}
					roomName={room().roomName}
					deckType={room().deckType}
				/>
			)}
		</Show>
	);
}

function RoomNotFound(props: { roomId: string }) {
	return (
		<main class="page-shell flex min-h-dvh flex-col justify-center">
			<div class="max-w-sm space-y-5">
				<div class="space-y-2">
					<p class="section-label">Unavailable</p>
					<h1 class="text-2xl font-semibold tracking-tight">Room not found</h1>
					<p class="text-sm leading-relaxed text-muted-foreground">
						<code class="rounded bg-muted px-1.5 py-0.5 text-[0.85em]">
							{props.roomId}
						</code>{" "}
						does not exist or has expired.
					</p>
				</div>
				<Link
					to="/"
					class="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
				>
					Create a new session
				</Link>
			</div>
		</main>
	);
}

function RoomSession(props: {
	roomId: string;
	roomName: string;
	deckType: "fibonacci" | "tshirt" | "sequential";
}) {
	const connection = useRoomConnection(() => props.roomId);
	// Identity lives in localStorage — only available after client mount (not SSR).
	const [localName, setLocalName] = createSignal("");
	// Keep dialog open until the server confirms join (state snapshot arrives).
	const [nameSubmitted, setNameSubmitted] = createSignal(false);
	const [selfId, setSelfId] = createSignal<string | undefined>(undefined);

	onMount(() => {
		const identity = readIdentity();
		if (identity?.participantId) {
			setSelfId(identity.participantId);
		}
		if (identity?.name) {
			setLocalName(identity.name);
			setNameSubmitted(true);
		}
	});

	const state = createMemo(() => connection.state());
	const needsName = createMemo(
		() =>
			!connection.joined() && (!nameSubmitted() || Boolean(connection.error())),
	);
	const selectedVote = createMemo(() => {
		const snapshot = state();
		if (!snapshot) {
			return undefined;
		}
		if (snapshot.revealed) {
			const me = snapshot.participants.find((p) => p.id === selfId());
			return me?.vote;
		}
		return snapshot.selfVote;
	});

	// Path-only share target keeps SSR/client markup aligned; button absolutizes on click.
	const shareUrl = createMemo(() => `/room/${props.roomId}`);

	const votedCount = createMemo(() => {
		const snapshot = state();
		if (!snapshot) {
			return 0;
		}
		return snapshot.participants.filter((p) => p.hasVoted).length;
	});

	const liveAnnouncement = createMemo(() => {
		const snapshot = state();
		if (!snapshot) {
			return "";
		}
		if (snapshot.revealed) {
			return "Votes revealed";
		}
		return `${votedCount()} of ${snapshot.participants.length} voted`;
	});

	return (
		<main class="page-shell safe-pb min-h-dvh space-y-8 pb-10 sm:space-y-10 sm:pb-14">
			<RoomHeader
				roomId={props.roomId}
				roomName={state()?.roomName ?? props.roomName}
				deckType={state()?.deckType ?? props.deckType}
				roundNumber={state()?.roundNumber ?? 1}
				status={connection.status()}
				shareUrl={shareUrl()}
				onRenameRoom={(roomName) => connection.renameRoom(roomName)}
			/>

			<div class="sr-only" aria-live="polite" aria-atomic="true">
				{liveAnnouncement()}
			</div>

			<Show when={connection.status() === "reconnecting"}>
				<p class="text-sm text-warning" aria-live="polite">
					Connection lost — reconnecting…
				</p>
			</Show>

			<Show when={connection.error()}>
				{(message) => (
					<div class="text-sm text-destructive" role="alert">
						{message()}
					</div>
				)}
			</Show>

			<Show
				when={state()}
				fallback={
					<p class="py-8 text-sm text-muted-foreground">
						{connection.status() === "error"
							? "Unable to load this room."
							: "Connecting to room…"}
					</p>
				}
			>
				{(snapshot) => (
					<div class="space-y-8 sm:space-y-10">
						<ParticipantList
							participants={snapshot().participants}
							revealed={snapshot().revealed}
							selfId={selfId()}
						/>

						<Show
							when={snapshot().revealed}
							fallback={
								<div class="space-y-5">
									<CardDeck
										deckType={snapshot().deckType}
										selected={selectedVote()}
										disabled={!connection.joined()}
										onVote={(value) => connection.vote(value)}
									/>

									{/* Sticky action bar on small screens keeps primary actions reachable */}
									<div class="sticky bottom-0 z-10 -mx-[var(--space-page-x)] border-t border-border/80 bg-background/95 px-[var(--space-page-x)] py-3 backdrop-blur-sm supports-[backdrop-filter]:bg-background/85 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
										<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
											<p class="order-2 text-sm tabular-nums text-muted-foreground sm:order-1">
												{votedCount()} / {snapshot().participants.length} voted
											</p>
											<div class="order-1 flex gap-2 sm:order-2">
												<Button
													class="min-w-0 flex-1 sm:flex-none"
													onClick={() => connection.reveal()}
													disabled={!connection.joined() || votedCount() === 0}
												>
													Reveal votes
												</Button>
												<Button
													variant="ghost"
													class="min-w-0 flex-1 sm:flex-none"
													onClick={() => connection.reset()}
													disabled={!connection.joined()}
												>
													Reset
												</Button>
											</div>
										</div>
									</div>
								</div>
							}
						>
							<RevealResults
								participants={snapshot().participants}
								onReset={() => connection.reset()}
							/>
						</Show>

						<RoundHistory
							history={snapshot().history}
							onDeleteRound={(roundNumber) => connection.deleteRound(roundNumber)}
							onClearHistory={() => connection.clearHistory()}
						/>
					</div>
				)}
			</Show>

			<Show when={needsName()}>
				<JoinDialog
					initialName={localName()}
					busy={
						connection.status() === "connecting" ||
						connection.status() === "reconnecting" ||
						(nameSubmitted() && !connection.joined() && !connection.error())
					}
					error={connection.error()}
					onJoin={(name) => {
						setLocalName(name);
						setNameSubmitted(true);
						setSelfId(readIdentity()?.participantId);
						connection.join(name);
					}}
				/>
			</Show>
		</main>
	);
}
