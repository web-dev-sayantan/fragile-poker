import { createForm } from "@tanstack/solid-form";
import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { displayNameSchema } from "~/lib/room-protocol";

type Props = {
	initialName: string;
	onJoin: (name: string) => void;
	busy?: boolean;
	error?: string | null;
};

export function JoinDialog(props: Props) {
	const form = createForm(() => ({
		defaultValues: {
			name: props.initialName,
		},
		onSubmit: ({ value }) => {
			const parsed = displayNameSchema.safeParse(value.name);
			if (!parsed.success) {
				return;
			}
			props.onJoin(parsed.data);
		},
	}));

	return (
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="join-dialog-title"
		>
			<form
				class="w-full max-w-md space-y-6 border-t border-border bg-background px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:rounded-xl sm:border sm:px-6 sm:pb-6 sm:pt-6"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<div class="space-y-1.5">
					<p class="section-label">Almost there</p>
					<h2
						id="join-dialog-title"
						class="text-xl font-semibold tracking-tight text-foreground"
					>
						Join room
					</h2>
					<p class="text-sm leading-relaxed text-muted-foreground">
						Enter a display name. No account needed.
					</p>
				</div>

				<form.Field
					name="name"
					validators={{
						onChange: ({ value }) => {
							const result = displayNameSchema.safeParse(value);
							return result.success
								? undefined
								: result.error.issues[0]?.message || "Invalid name";
						},
					}}
				>
					{(field) => (
						<label class="flex flex-col gap-2" for="join-display-name">
							<span class="text-sm font-medium text-foreground">
								Display name
							</span>
							<input
								id="join-display-name"
								class="field-control"
								name={field().name}
								value={field().state.value}
								onBlur={field().handleBlur}
								onInput={(event) =>
									field().handleChange(event.currentTarget.value)
								}
								maxLength={30}
								autocomplete="nickname"
								autofocus
							/>
							<Show when={field().state.meta.errors[0]}>
								{(err) => (
									<span class="text-xs text-destructive">{String(err())}</span>
								)}
							</Show>
						</label>
					)}
				</form.Field>

				<Show when={props.error}>
					{(message) => (
						<p class="text-sm text-destructive" role="alert">
							{message()}
						</p>
					)}
				</Show>

				<Button type="submit" class="w-full" disabled={props.busy}>
					Join session
				</Button>
			</form>
		</div>
	);
}
