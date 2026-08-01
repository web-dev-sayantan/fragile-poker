import { DurableObject } from "cloudflare:workers";
import {
	averageVotes,
	type ClientMessage,
	clientMessageSchema,
	type DeckType,
	deckTypeSchema,
	type HistoryEntry,
	isValidCardForDeck,
	JOIN_TIMEOUT_MS,
	MAX_HISTORY,
	MAX_MESSAGE_BYTES,
	MAX_PARTICIPANTS,
	medianVotes,
	type ProtocolError,
	type ProtocolErrorCode,
	RATE_LIMIT_ACTIONS_PER_WINDOW,
	RATE_LIMIT_WINDOW_MS,
	ROOM_TTL_MS,
	type RoomMetadata,
	type RoomState,
	roomNameSchema,
	sanitizeName,
} from "../../lib/room-protocol";

type ParticipantRow = {
	id: string;
	name: string;
	vote: string | null;
	joined_at: number;
	last_seen_at: number;
};

type RoomRow = {
	id: string;
	room_name: string;
	deck_type: string;
	revealed: number;
	round_number: number;
	created_at: number;
	last_activity_at: number;
};

type SocketAttachment = {
	participantId?: string;
	actionCount: number;
	windowStart: number;
	/** When the socket was accepted (for unattached join timeout). */
	connectedAt: number;
};

type HistoryRow = {
	round_number: number;
	revealed_at: number;
	results_json: string;
	average: number | null;
	median: number | null;
};

export class RoomDurableObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.blockConcurrencyWhile(async () => {
			this.migrate();
		});
	}

	private migrate(): void {
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS room (
				id TEXT PRIMARY KEY,
				room_name TEXT NOT NULL DEFAULT 'Untitled room',
				deck_type TEXT NOT NULL,
				revealed INTEGER NOT NULL,
				round_number INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				last_activity_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS participant (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				vote TEXT,
				joined_at INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS round_history (
				round_number INTEGER PRIMARY KEY,
				revealed_at INTEGER NOT NULL,
				results_json TEXT NOT NULL,
				average REAL,
				median REAL
			);
		`);

		const columns = this.ctx.storage.sql
			.exec<{ name: string }>("PRAGMA table_info(room)")
			.toArray();
		if (!columns.some((column) => column.name === "room_name")) {
			this.ctx.storage.sql.exec(
				"ALTER TABLE room ADD COLUMN room_name TEXT NOT NULL DEFAULT 'Untitled room'",
			);
		}
	}

	/** Idempotent room creation used by the homepage server function. */
	async createRoom(
		roomId: string,
		roomName: string,
		deckType: DeckType,
	): Promise<RoomMetadata> {
		const parsedRoomName = roomNameSchema.parse(roomName);
		const parsedDeck = deckTypeSchema.parse(deckType);
		const existing = this.getRoomRow();
		if (existing) {
			if (existing.id !== roomId) {
				throw new Error("Room already initialized with a different id");
			}
			return {
				roomId: existing.id,
				roomName: existing.room_name,
				deckType: existing.deck_type as DeckType,
				createdAt: existing.created_at,
			};
		}

		const now = Date.now();
		this.ctx.storage.sql.exec(
			`INSERT INTO room (id, room_name, deck_type, revealed, round_number, created_at, last_activity_at)
			 VALUES (?, ?, ?, 0, 1, ?, ?)`,
			roomId,
			parsedRoomName,
			parsedDeck,
			now,
			now,
		);
		await this.scheduleCleanup(now);
		return {
			roomId,
			roomName: parsedRoomName,
			deckType: parsedDeck,
			createdAt: now,
		};
	}

	async getRoom(): Promise<RoomMetadata | null> {
		const row = this.getRoomRow();
		if (!row) {
			return null;
		}
		return {
			roomId: row.id,
			roomName: row.room_name,
			deckType: row.deck_type as DeckType,
			createdAt: row.created_at,
		};
	}

	async fetch(request: Request): Promise<Response> {
		const upgrade = request.headers.get("Upgrade");
		if (upgrade?.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const room = this.getRoomRow();
		if (!room) {
			return new Response("Room not found", { status: 404 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		const now = Date.now();
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({
			actionCount: 0,
			windowStart: now,
			connectedAt: now,
		} satisfies SocketAttachment);

		// Ensure an alarm runs soon enough to sweep unattached sockets.
		await this.scheduleCleanup(room.last_activity_at);

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		if (typeof message !== "string") {
			this.sendError(
				ws,
				"MALFORMED_MESSAGE",
				"Binary frames are not supported",
			);
			return;
		}

		if (message.length > MAX_MESSAGE_BYTES) {
			this.sendError(ws, "MESSAGE_TOO_LARGE", "Message exceeds size limit");
			ws.close(1009, "Message too large");
			return;
		}

		if (!this.consumeRateLimit(ws)) {
			this.sendError(ws, "RATE_LIMITED", "Too many actions; slow down");
			ws.close(1008, "Rate limited");
			return;
		}

		let parsedJson: unknown;
		try {
			parsedJson = JSON.parse(message);
		} catch {
			this.sendError(ws, "MALFORMED_MESSAGE", "Invalid JSON");
			return;
		}

		const parsed = clientMessageSchema.safeParse(parsedJson);
		if (!parsed.success) {
			this.sendError(ws, "INVALID_MESSAGE", "Message failed validation");
			return;
		}

		try {
			await this.handleClientMessage(ws, parsed.data);
		} catch (error) {
			if (error instanceof ProtocolClientError) {
				this.sendError(ws, error.code, error.message);
				return;
			}
			console.error(
				JSON.stringify({
					event: "room_handler_error",
					error: error instanceof Error ? error.message : "unknown",
				}),
			);
			this.sendError(ws, "INTERNAL_ERROR", "Unexpected server error");
		}
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		_wasClean: boolean,
	): Promise<void> {
		try {
			ws.close(code, reason);
		} catch {
			// already closed
		}
		// Connection status is derived from open sockets; broadcast so peers update.
		if (this.getRoomRow()) {
			this.broadcastState();
		}
	}

	async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
		try {
			ws.close(1011, "WebSocket error");
		} catch {
			// ignore
		}
	}

	async alarm(): Promise<void> {
		const room = this.getRoomRow();
		if (!room) {
			await this.ctx.storage.deleteAll();
			return;
		}

		const now = Date.now();
		this.closeStaleUnattachedSockets(now);

		const sockets = this.ctx.getWebSockets();
		if (sockets.length > 0) {
			// Keep room while sockets remain; reschedule for TTL / join sweeps.
			await this.scheduleCleanup(room.last_activity_at);
			return;
		}

		if (now - room.last_activity_at >= ROOM_TTL_MS) {
			console.log(
				JSON.stringify({
					event: "room_expired",
					roomIdHash: hashId(room.id),
				}),
			);
			await this.ctx.storage.deleteAll();
			// Recreate empty schema so RPC helpers (getRoom) stay safe on this instance.
			this.migrate();
			return;
		}

		await this.scheduleCleanup(room.last_activity_at);
	}

	private async handleClientMessage(
		ws: WebSocket,
		message: ClientMessage,
	): Promise<void> {
		const room = this.getRoomRow();
		if (!room) {
			this.sendError(ws, "ROOM_NOT_FOUND", "This room no longer exists");
			ws.close(1008, "Room not found");
			return;
		}

		const attachment = this.getAttachment(ws);

		if (message.type === "join") {
			await this.handleJoin(ws, message.participantId, message.name);
			return;
		}

		if (!attachment.participantId) {
			this.sendError(ws, "UNATTACHED", "Send a join message first");
			return;
		}

		const participantId = attachment.participantId;

		switch (message.type) {
			case "rename":
				this.handleRename(participantId, message.name);
				break;
			case "renameRoom":
				this.handleRoomRename(message.roomName);
				break;
			case "vote":
				this.handleVote(
					participantId,
					message.value,
					room.deck_type as DeckType,
				);
				break;
			case "reveal":
				this.handleReveal();
				break;
			case "reset":
				this.handleReset();
				break;
			case "deleteRound":
				this.handleDeleteRound(message.roundNumber);
				break;
			case "clearHistory":
				this.handleClearHistory();
				break;
			case "leave":
				this.handleLeave(participantId);
				this.touchActivity();
				this.broadcastState();
				this.closeParticipantSockets(participantId);
				return;
			default:
				this.sendError(ws, "INVALID_MESSAGE", "Unsupported message type");
				return;
		}

		this.touchActivity();
		this.broadcastState();
	}

	private async handleJoin(
		ws: WebSocket,
		participantId: string,
		name: string,
	): Promise<void> {
		const attachment = this.getAttachment(ws);
		if (
			attachment.participantId &&
			attachment.participantId !== participantId
		) {
			this.sendError(
				ws,
				"DUPLICATE_JOIN",
				"This connection is already joined as another participant",
			);
			return;
		}

		const room = this.getRoomRow();
		if (!room) {
			this.sendError(ws, "ROOM_NOT_FOUND", "This room no longer exists");
			return;
		}

		const existing = this.getParticipant(participantId);
		const participants = this.listParticipants();
		if (!existing && participants.length >= MAX_PARTICIPANTS) {
			this.sendError(ws, "PARTICIPANT_LIMIT", "This room is full");
			ws.close(1008, "Room full");
			return;
		}

		const now = Date.now();
		const safeName = sanitizeName(name);
		if (!safeName) {
			this.sendError(ws, "INVALID_MESSAGE", "Name is required");
			return;
		}

		if (existing) {
			this.ctx.storage.sql.exec(
				`UPDATE participant SET name = ?, last_seen_at = ? WHERE id = ?`,
				safeName,
				now,
				participantId,
			);
		} else {
			this.ctx.storage.sql.exec(
				`INSERT INTO participant (id, name, vote, joined_at, last_seen_at)
				 VALUES (?, ?, NULL, ?, ?)`,
				participantId,
				safeName,
				now,
				now,
			);
		}

		this.setAttachment(ws, {
			...attachment,
			participantId,
		});

		this.touchActivity();
		console.log(
			JSON.stringify({
				event: "join",
				roomIdHash: hashId(room.id),
				participantIdHash: hashId(participantId),
			}),
		);
		this.broadcastState();
	}

	private handleRename(participantId: string, name: string): void {
		const safeName = sanitizeName(name);
		if (!safeName) {
			throw new ProtocolClientError("INVALID_MESSAGE", "Name is required");
		}
		this.ctx.storage.sql.exec(
			`UPDATE participant SET name = ?, last_seen_at = ? WHERE id = ?`,
			safeName,
			Date.now(),
			participantId,
		);
	}

	private handleRoomRename(roomName: string): void {
		const parsedRoomName = roomNameSchema.parse(roomName);
		this.ctx.storage.sql.exec(
			`UPDATE room SET room_name = ?, last_activity_at = ?`,
			parsedRoomName,
			Date.now(),
		);
	}

	private handleVote(
		participantId: string,
		value: string,
		deckType: DeckType,
	): void {
		const room = this.getRoomRow();
		if (!room) {
			return;
		}
		if (room.revealed === 1) {
			// Ignore votes after reveal until reset; client should disable the deck.
			return;
		}
		if (!isValidCardForDeck(value, deckType)) {
			throw new ProtocolClientError(
				"INVALID_CARD",
				"That card is not in the current deck",
			);
		}
		this.ctx.storage.sql.exec(
			`UPDATE participant SET vote = ?, last_seen_at = ? WHERE id = ?`,
			value,
			Date.now(),
			participantId,
		);
	}

	private handleReveal(): void {
		const room = this.getRoomRow();
		if (!room || room.revealed === 1) {
			// Idempotent: already revealed.
			return;
		}

		const now = Date.now();
		const participants = this.listParticipants();
		const results = participants
			.filter((p) => p.vote != null)
			.map((p) => ({
				participantId: p.id,
				name: p.name,
				vote: p.vote as string,
			}));
		const votes = results.map((r) => r.vote);
		const average = averageVotes(votes);
		const median = medianVotes(votes);

		this.ctx.storage.sql.exec(
			`UPDATE room SET revealed = 1, last_activity_at = ?`,
			now,
		);
		this.ctx.storage.sql.exec(
			`INSERT INTO round_history (round_number, revealed_at, results_json, average, median)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(round_number) DO NOTHING`,
			room.round_number,
			now,
			JSON.stringify(results),
			average,
			median,
		);

		// Bound history size.
		this.ctx.storage.sql.exec(
			`DELETE FROM round_history
			 WHERE round_number NOT IN (
			   SELECT round_number FROM round_history
			   ORDER BY round_number DESC
			   LIMIT ?
			 )`,
			MAX_HISTORY,
		);

		console.log(
			JSON.stringify({
				event: "reveal",
				roomIdHash: hashId(room.id),
				roundNumber: room.round_number,
			}),
		);
	}

	private handleReset(): void {
		const room = this.getRoomRow();
		if (!room) {
			return;
		}
		const now = Date.now();
		this.ctx.storage.sql.exec(
			`UPDATE room
			 SET revealed = 0,
			     round_number = round_number + 1,
			     last_activity_at = ?
			 WHERE id = ?`,
			now,
			room.id,
		);
		this.ctx.storage.sql.exec(`UPDATE participant SET vote = NULL`);
		console.log(
			JSON.stringify({
				event: "reset",
				roomIdHash: hashId(room.id),
				fromRound: room.round_number,
			}),
		);
	}

	private handleDeleteRound(roundNumber: number): void {
		const room = this.getRoomRow();
		if (!room) {
			return;
		}
		this.ctx.storage.sql.exec(
			`DELETE FROM round_history WHERE round_number = ?`,
			roundNumber,
		);
		this.ctx.storage.sql.exec(
			`UPDATE room
			 SET round_number = COALESCE(
				(SELECT MAX(round_number) + 1 FROM round_history),
				1
			 )
			 WHERE id = ?`,
			room.id,
		);
		this.touchActivity();
		console.log(
			JSON.stringify({
				event: "delete_round",
				roomIdHash: hashId(room.id),
				roundNumber,
			}),
		);
	}

	private handleClearHistory(): void {
		const room = this.getRoomRow();
		if (!room) {
			return;
		}
		this.ctx.storage.sql.exec(`DELETE FROM round_history`);
		this.ctx.storage.sql.exec(
			`UPDATE room SET round_number = 1 WHERE id = ?`,
			room.id,
		);
		this.touchActivity();
		console.log(
			JSON.stringify({
				event: "clear_history",
				roomIdHash: hashId(room.id),
			}),
		);
	}

	private handleLeave(participantId: string): void {
		this.ctx.storage.sql.exec(
			`DELETE FROM participant WHERE id = ?`,
			participantId,
		);
		console.log(
			JSON.stringify({
				event: "leave",
				roomIdHash: hashId(this.getRoomRow()?.id ?? "unknown"),
				participantIdHash: hashId(participantId),
			}),
		);
	}

	private closeParticipantSockets(participantId: string): void {
		for (const socket of this.ctx.getWebSockets()) {
			if (this.getAttachment(socket).participantId !== participantId) {
				continue;
			}
			try {
				socket.close(1000, "Left room");
			} catch {
				// already closed
			}
		}
	}

	private broadcastState(): void {
		const sockets = this.ctx.getWebSockets();
		for (const ws of sockets) {
			const attachment = this.getAttachment(ws);
			const state = this.buildState(attachment.participantId);
			if (!state) {
				continue;
			}
			try {
				ws.send(JSON.stringify(state));
			} catch {
				// drop broken sockets
			}
		}
	}

	private buildState(viewerId?: string): RoomState | null {
		const room = this.getRoomRow();
		if (!room) {
			return null;
		}

		const connectedIds = this.connectedParticipantIds();
		const participants = this.listParticipants().map((p) => {
			const base = {
				id: p.id,
				name: p.name,
				connected: connectedIds.has(p.id),
				hasVoted: p.vote != null,
			};
			if (room.revealed === 1) {
				return {
					...base,
					vote: p.vote ?? undefined,
				};
			}
			return base;
		});

		const history = this.listHistory();
		const viewer = viewerId ? this.getParticipant(viewerId) : null;
		const selfVote =
			room.revealed === 0 && viewer?.vote != null ? viewer.vote : undefined;

		return {
			type: "state",
			roomId: room.id,
			roomName: room.room_name,
			deckType: room.deck_type as DeckType,
			revealed: room.revealed === 1,
			roundNumber: room.round_number,
			participants,
			selfVote,
			history,
		};
	}

	private listHistory(): HistoryEntry[] {
		const rows = this.ctx.storage.sql
			.exec<HistoryRow>(
				`SELECT round_number, revealed_at, results_json, average, median
				 FROM round_history
				 ORDER BY round_number DESC
				 LIMIT ?`,
				MAX_HISTORY,
			)
			.toArray();

		return rows.map((row) => ({
			roundNumber: row.round_number,
			revealedAt: row.revealed_at,
			average: row.average,
			median: row.median,
			results: JSON.parse(row.results_json) as HistoryEntry["results"],
		}));
	}

	private connectedParticipantIds(): Set<string> {
		const ids = new Set<string>();
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = this.getAttachment(ws);
			if (attachment.participantId) {
				ids.add(attachment.participantId);
			}
		}
		return ids;
	}

	private getRoomRow(): RoomRow | null {
		const rows = this.ctx.storage.sql
			.exec<RoomRow>(
				`SELECT id, room_name, deck_type, revealed, round_number, created_at, last_activity_at
				 FROM room LIMIT 1`,
			)
			.toArray();
		return rows[0] ?? null;
	}

	private listParticipants(): ParticipantRow[] {
		return this.ctx.storage.sql
			.exec<ParticipantRow>(
				`SELECT id, name, vote, joined_at, last_seen_at
				 FROM participant
				 ORDER BY joined_at ASC`,
			)
			.toArray();
	}

	private getParticipant(id: string): ParticipantRow | null {
		const rows = this.ctx.storage.sql
			.exec<ParticipantRow>(
				`SELECT id, name, vote, joined_at, last_seen_at
				 FROM participant WHERE id = ?`,
				id,
			)
			.toArray();
		return rows[0] ?? null;
	}

	private touchActivity(): void {
		const now = Date.now();
		this.ctx.storage.sql.exec(
			`UPDATE room SET last_activity_at = ? WHERE id IS NOT NULL`,
			now,
		);
		void this.scheduleCleanup(now);
	}

	/**
	 * Schedule the next alarm at the earlier of:
	 * - room TTL from last activity
	 * - join-timeout sweep for any still-unattached sockets
	 */
	private async scheduleCleanup(fromActivityAt: number): Promise<void> {
		const ttlAt = fromActivityAt + ROOM_TTL_MS;
		const joinSweepAt = this.earliestJoinSweepAt(Date.now());
		const next = joinSweepAt == null ? ttlAt : Math.min(ttlAt, joinSweepAt);
		await this.ctx.storage.setAlarm(next);
	}

	private earliestJoinSweepAt(now: number): number | null {
		let earliest: number | null = null;
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = this.getAttachment(ws);
			if (attachment.participantId) {
				continue;
			}
			const due = (attachment.connectedAt || now) + JOIN_TIMEOUT_MS;
			if (earliest == null || due < earliest) {
				earliest = due;
			}
		}
		return earliest;
	}

	private closeStaleUnattachedSockets(now: number): void {
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = this.getAttachment(ws);
			if (attachment.participantId) {
				continue;
			}
			const age = now - (attachment.connectedAt || 0);
			if (age >= JOIN_TIMEOUT_MS) {
				try {
					this.sendError(
						ws,
						"UNATTACHED",
						"Join timed out; reconnect and send join",
					);
					ws.close(1008, "Join timeout");
				} catch {
					// ignore
				}
			}
		}
	}

	private getAttachment(ws: WebSocket): SocketAttachment {
		const raw = ws.deserializeAttachment() as SocketAttachment | null;
		if (!raw) {
			const now = Date.now();
			return { actionCount: 0, windowStart: now, connectedAt: now };
		}
		return {
			actionCount: raw.actionCount ?? 0,
			windowStart: raw.windowStart ?? Date.now(),
			connectedAt: raw.connectedAt ?? Date.now(),
			participantId: raw.participantId,
		};
	}

	private setAttachment(ws: WebSocket, attachment: SocketAttachment): void {
		ws.serializeAttachment(attachment);
	}

	private consumeRateLimit(ws: WebSocket): boolean {
		const now = Date.now();
		const attachment = this.getAttachment(ws);
		let { actionCount, windowStart } = attachment;
		if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
			actionCount = 0;
			windowStart = now;
		}
		actionCount += 1;
		this.setAttachment(ws, {
			...attachment,
			actionCount,
			windowStart,
		});
		return actionCount <= RATE_LIMIT_ACTIONS_PER_WINDOW;
	}

	private sendError(
		ws: WebSocket,
		code: ProtocolErrorCode,
		message: string,
	): void {
		const error: ProtocolError = { type: "error", code, message };
		try {
			ws.send(JSON.stringify(error));
		} catch {
			// ignore
		}
	}
}

/** Typed client-facing protocol failure (mapped to error frames, not 500s). */
class ProtocolClientError extends Error {
	readonly code: ProtocolErrorCode;

	constructor(code: ProtocolErrorCode, message: string) {
		super(message);
		this.name = "ProtocolClientError";
		this.code = code;
	}
}

function hashId(value: string): string {
	// Lightweight non-crypto fingerprint for logs (avoid PII/display names).
	let hash = 0;
	for (let i = 0; i < value.length; i += 1) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
