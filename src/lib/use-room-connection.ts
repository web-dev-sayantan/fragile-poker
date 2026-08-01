import { createSignal, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { ensureIdentity, updateStoredName } from "./identity";
import type { RoomState, ServerMessage } from "./room-protocol";
import { serverMessageSchema } from "./room-protocol";

export type ConnectionStatus =
	| "idle"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "closed"
	| "error";

export type RoomConnection = {
	status: () => ConnectionStatus;
	state: () => RoomState | null;
	error: () => string | null;
	joined: () => boolean;
	vote: (value: string) => void;
	reveal: () => void;
	reset: () => void;
	rename: (name: string) => void;
	renameRoom: (roomName: string) => void;
	leave: () => void;
	join: (name: string) => void;
};

const MAX_BACKOFF_MS = 10_000;
const BASE_BACKOFF_MS = 500;

export function useRoomConnection(roomId: () => string): RoomConnection {
	const [status, setStatus] = createSignal<ConnectionStatus>("idle");
	const [error, setError] = createSignal<string | null>(null);
	const [joined, setJoined] = createSignal(false);
	const [store, setStore] = createStore<{ snapshot: RoomState | null }>({
		snapshot: null,
	});

	let socket: WebSocket | null = null;
	let disposed = false;
	let intentionalClose = false;
	let reconnectAttempt = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingName: string | null = null;

	const clearReconnectTimer = () => {
		if (reconnectTimer != null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	};

	const send = (payload: unknown) => {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(JSON.stringify(payload));
	};

	const sendJoin = () => {
		const identity = ensureIdentity(pendingName ?? undefined);
		if (!identity.name) {
			// Wait for the UI join dialog to supply a name.
			return;
		}
		send({
			type: "join",
			participantId: identity.participantId,
			name: identity.name,
		});
	};

	const handleMessage = (event: MessageEvent) => {
		if (typeof event.data !== "string") {
			return;
		}
		let json: unknown;
		try {
			json = JSON.parse(event.data);
		} catch {
			return;
		}
		const parsed = serverMessageSchema.safeParse(json);
		if (!parsed.success) {
			return;
		}
		const message: ServerMessage = parsed.data;
		if (message.type === "error") {
			setError(message.message);
			if (message.code === "ROOM_NOT_FOUND") {
				setStatus("error");
			}
			return;
		}
		setError(null);
		setStore("snapshot", message);
		setJoined(true);
		setStatus("connected");
		reconnectAttempt = 0;
	};

	const connect = () => {
		if (disposed) {
			return;
		}
		clearReconnectTimer();

		const id = roomId();
		if (!id) {
			return;
		}

		if (socket) {
			try {
				socket.close();
			} catch {
				// ignore
			}
			socket = null;
		}

		setStatus(reconnectAttempt > 0 ? "reconnecting" : "connecting");
		intentionalClose = false;

		const protocol = window.location.protocol === "https:" ? "wss" : "ws";
		const url = `${protocol}://${window.location.host}/api/rooms/${encodeURIComponent(id)}/socket`;
		const ws = new WebSocket(url);
		socket = ws;

		ws.addEventListener("open", () => {
			if (disposed || socket !== ws) {
				return;
			}
			setStatus("connected");
			sendJoin();
		});

		ws.addEventListener("message", handleMessage);

		ws.addEventListener("close", () => {
			if (disposed || socket !== ws) {
				return;
			}
			socket = null;
			setJoined(false);
			if (intentionalClose) {
				setStatus("closed");
				return;
			}
			scheduleReconnect();
		});

		ws.addEventListener("error", () => {
			// close handler performs reconnect
		});
	};

	const scheduleReconnect = () => {
		if (disposed || intentionalClose) {
			return;
		}
		setStatus("reconnecting");
		const delay = Math.min(
			MAX_BACKOFF_MS,
			BASE_BACKOFF_MS * 2 ** reconnectAttempt,
		);
		reconnectAttempt += 1;
		clearReconnectTimer();
		reconnectTimer = setTimeout(() => {
			connect();
		}, delay);
	};

	onMount(() => {
		connect();
	});

	onCleanup(() => {
		disposed = true;
		clearReconnectTimer();
		intentionalClose = true;
		if (socket) {
			try {
				socket.close(1000, "unmount");
			} catch {
				// ignore
			}
			socket = null;
		}
	});

	return {
		status,
		state: () => store.snapshot,
		error,
		joined,
		vote: (value: string) => send({ type: "vote", value }),
		reveal: () => send({ type: "reveal" }),
		reset: () => send({ type: "reset" }),
		rename: (name: string) => {
			updateStoredName(name);
			send({ type: "rename", name });
		},
		renameRoom: (roomName: string) => {
			send({ type: "renameRoom", roomName });
		},
		leave: () => {
			intentionalClose = true;
			send({ type: "leave" });
			if (socket) {
				socket.close(1000, "leave");
			}
			setStatus("closed");
		},
		join: (name: string) => {
			pendingName = name;
			updateStoredName(name);
			if (socket && socket.readyState === WebSocket.OPEN) {
				sendJoin();
				return;
			}
			// Already connecting — join is sent from the open handler via pendingName.
			if (socket && socket.readyState === WebSocket.CONNECTING) {
				return;
			}
			connect();
		},
	};
}
