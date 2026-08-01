import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { isValidRoomCode } from "../../../../lib/room-code";

export const Route = createFileRoute("/api/rooms/$roomId/socket")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const roomId = params.roomId;

				if (!isValidRoomCode(roomId)) {
					return new Response("Invalid room code", { status: 400 });
				}

				if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
					return new Response("Expected WebSocket upgrade", { status: 426 });
				}

				// Prefer same-origin browser connections; allow local tooling without Origin.
				const origin = request.headers.get("Origin");
				if (origin) {
					const requestUrl = new URL(request.url);
					const originUrl = new URL(origin);
					if (originUrl.host !== requestUrl.host) {
						return new Response("Forbidden", { status: 403 });
					}
				}

				const stub = env.ROOM_DO.getByName(roomId);
				const meta = await stub.getRoom();
				if (!meta) {
					return new Response("Room not found", { status: 404 });
				}

				return stub.fetch(request);
			},
		},
	},
});
