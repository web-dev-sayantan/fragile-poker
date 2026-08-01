import { createForm } from "@tanstack/solid-form";
import { useNavigate } from "@tanstack/solid-router";
import { createSignal, For, onMount, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
	DECK_LABELS,
	type DeckType,
	deckTypeSchema,
	roomNameSchema,
} from "~/lib/room-protocol";
import { createRoom } from "~/server/rooms";

const DECK_OPTIONS = Object.keys(DECK_LABELS) as DeckType[];

export function CreateRoomForm() {
	const navigate = useNavigate();
	const [submitError, setSubmitError] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);
	// SSR HTML is static; only flip after client handlers are live.
	const [clientReady, setClientReady] = createSignal(false);

	onMount(() => {
		setClientReady(true);
	});

	const form = createForm(() => ({
		defaultValues: {
			roomName: "",
			deckType: "fibonacci" as DeckType,
		},
		onSubmit: async ({ value }) => {
			setSubmitError(null);
			setSubmitting(true);
			try {
				const roomName = roomNameSchema.parse(value.roomName);
				const deckType = deckTypeSchema.parse(value.deckType);
				const room = await createRoom({ data: { roomName, deckType } });
				await navigate({
					to: "/room/$roomId",
					params: { roomId: room.roomId },
				});
			} catch (error) {
				setSubmitError(
					error instanceof Error
						? error.message
						: "Could not create room. Try again.",
				);
			} finally {
				setSubmitting(false);
			}
		},
	}));

	const startSession = () => {
		if (!clientReady() || submitting()) {
			return;
		}
		void form.handleSubmit();
	};

	return (
		<form
			// Prevent native navigation if JS handlers are not yet hydrated.
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				startSession();
			}}
			class="mx-auto flex w-full max-w-sm flex-col gap-8"
			data-client-ready={clientReady() ? "true" : "false"}
		>
			<header class="space-y-3">
				<div class="space-y-2">
					<h1 class="text-[2rem] font-semibold leading-none tracking-tight text-foreground sm:text-[2.25rem]">
						Fragile Poker
					</h1>
					<p class="max-w-[28ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
						Create a room, share the link, vote in under a minute.
					</p>
				</div>
			</header>

			<div class="space-y-5">
				<form.Field
					name="roomName"
					validators={{
						onChange: ({ value }) => {
							const result = roomNameSchema.safeParse(value);
							return result.success
								? undefined
								: result.error.issues[0]?.message || "Invalid room name";
						},
					}}
				>
					{(field) => (
						<label class="flex flex-col gap-2 text-left" for="create-room-name">
							<span class="text-sm font-medium text-foreground">Room name</span>
							<input
								id="create-room-name"
								class="field-control"
								name={field().name}
								value={field().state.value}
								onBlur={field().handleBlur}
								onInput={(event) =>
									field().handleChange(event.currentTarget.value)
								}
								placeholder="e.g. Mobile app estimates"
								maxLength={60}
								autocomplete="off"
								disabled={!clientReady()}
							/>
							<Show when={field().state.meta.errors[0]}>
								{(error) => (
									<span class="text-xs text-destructive">
										{String(error())}
									</span>
								)}
							</Show>
						</label>
					)}
				</form.Field>

				<form.Field name="deckType">
					{(field) => (
						<label class="flex flex-col gap-2 text-left" for="create-deck-type">
							<span class="text-sm font-medium text-foreground">Card deck</span>
							<select
								id="create-deck-type"
								class="field-control"
								name={field().name}
								value={field().state.value}
								onBlur={field().handleBlur}
								onChange={(event) =>
									field().handleChange(event.currentTarget.value as DeckType)
								}
								disabled={!clientReady()}
							>
								<For each={DECK_OPTIONS}>
									{(option) => (
										<option value={option}>{DECK_LABELS[option]}</option>
									)}
								</For>
							</select>
						</label>
					)}
				</form.Field>
			</div>

			<div class="space-y-3">
				{/* type=button avoids native form GET before Solid hydrates */}
				<Button
					type="button"
					size="lg"
					disabled={!clientReady() || submitting()}
					class="w-full"
					onClick={startSession}
				>
					<Show when={!submitting()} fallback={<span>Creating…</span>}>
						<span>Start a session</span>
					</Show>
				</Button>

				<Show when={submitError()}>
					{(message) => (
						<p class="text-sm text-destructive" role="alert">
							{message()}
						</p>
					)}
				</Show>

				<p class="text-xs leading-relaxed text-muted-foreground">
					No signup · Works on phone and desktop
				</p>
			</div>
		</form>
	);
}
