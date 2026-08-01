import { createFileRoute } from "@tanstack/solid-router";
import { CreateRoomForm } from "~/components/home/create-room-form";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<main class="page-shell flex min-h-dvh flex-col justify-center py-12 sm:py-16">
			<CreateRoomForm />
		</main>
	);
}
