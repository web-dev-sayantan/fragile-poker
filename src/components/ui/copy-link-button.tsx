import { createSignal, onCleanup, Show } from "solid-js";
import { Button } from "./button";

type Props = {
	url: string;
	class?: string;
};

export function CopyLinkButton(props: Props) {
	const [copied, setCopied] = createSignal(false);
	let resetTimer: ReturnType<typeof setTimeout> | null = null;

	onCleanup(() => {
		if (resetTimer) {
			clearTimeout(resetTimer);
		}
	});

	const absoluteUrl = () => {
		if (/^https?:\/\//i.test(props.url)) {
			return props.url;
		}
		if (typeof window === "undefined") {
			return props.url;
		}
		return new URL(props.url, window.location.origin).toString();
	};

	const copy = async () => {
		const url = absoluteUrl();
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			if (resetTimer) {
				clearTimeout(resetTimer);
			}
			resetTimer = setTimeout(() => setCopied(false), 1600);
		} catch {
			// Fallback for older browsers / denied permissions.
			window.prompt("Copy room link:", url);
		}
	};

	return (
		<Button
			variant="secondary"
			size="sm"
			class={props.class}
			onClick={() => void copy()}
			aria-live="polite"
		>
			<Show when={copied()} fallback={<span>Copy link</span>}>
				<span>Copied</span>
			</Show>
		</Button>
	);
}
