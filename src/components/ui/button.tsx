import { type JSX, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};

const variantClass: Record<ButtonVariant, string> = {
	primary:
		"bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
	secondary:
		"bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent/80",
	ghost:
		"bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80",
	danger: "bg-destructive text-white hover:opacity-90 active:opacity-85",
};

const sizeClass: Record<ButtonSize, string> = {
	sm: "h-9 min-h-9 px-3 text-sm",
	md: "h-11 min-h-11 px-4 text-sm",
	lg: "h-12 min-h-12 px-5 text-[0.9375rem]",
	icon: "size-10 min-h-10 min-w-10 p-0",
};

export function Button(props: ButtonProps) {
	const [local, rest] = splitProps(props, [
		"class",
		"variant",
		"size",
		"type",
		"disabled",
	]);

	return (
		<button
			{...rest}
			type={local.type ?? "button"}
			disabled={local.disabled}
			class={cn(
				"inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium tracking-tight transition-colors duration-150",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				"disabled:pointer-events-none disabled:opacity-40",
				variantClass[local.variant ?? "primary"],
				sizeClass[local.size ?? "md"],
				local.class,
			)}
		/>
	);
}
