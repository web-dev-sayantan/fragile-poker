import { z } from "zod";

/** Room time-to-live: 24 hours. */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** Cap participants to bound broadcast cost. */
export const MAX_PARTICIPANTS = 100;

/** Bounded in-session history. */
export const MAX_HISTORY = 100;

/** Max inbound WebSocket frame size. */
export const MAX_MESSAGE_BYTES = 8 * 1024;

/** Actions allowed per socket within the rate-limit window. */
export const RATE_LIMIT_ACTIONS_PER_WINDOW = 60;

/** Rate-limit window duration. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Close sockets that never send join within this window. */
export const JOIN_TIMEOUT_MS = 30_000;

/**
 * Human-shareable, URL-safe alphabet without ambiguous characters
 * (no 0/O, 1/I/l).
 */
export const ROOM_CODE_ALPHABET = "abcdefghjkmnpqrstvwxyz23456789";

/** Room codes are generated server-side with this length. */
export const ROOM_CODE_LENGTH = 12;

/** Participant ids are browser-local nanoids. */
export const PARTICIPANT_ID_LENGTH = 16;

export const DECK_PRESETS = {
	fibonacci: ["0", "1", "2", "3", "5", "8", "13", "21", "34", "?", "☕"],
	tshirt: ["XS", "S", "M", "L", "XL", "XXL", "?", "☕"],
	sequential: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "?", "☕"],
} as const;

export type DeckType = keyof typeof DECK_PRESETS;

export const DECK_LABELS: Record<DeckType, string> = {
	fibonacci: "Fibonacci",
	tshirt: "T-shirt sizes",
	sequential: "1–10",
};

export const roomCodeSchema = z
	.string()
	.min(10)
	.max(32)
	.regex(/^[a-z0-9-]+$/, "Invalid room code");

export const deckTypeSchema = z.enum(["fibonacci", "tshirt", "sequential"]);

export const participantIdSchema = z
	.string()
	.min(10)
	.max(40)
	.regex(/^[a-zA-Z0-9_-]+$/);

export const displayNameSchema = z
	.string()
	.transform((value) => sanitizeName(value))
	.pipe(z.string().min(1, "Name is required").max(30, "Name is too long"));

export const roomNameSchema = z
	.string()
	.transform((value) => sanitizeName(value))
	.pipe(
		z.string().min(1, "Room name is required").max(60, "Room name is too long"),
	);

export const cardValueSchema = z.string().min(1).max(8);

export const joinMessageSchema = z.object({
	type: z.literal("join"),
	participantId: participantIdSchema,
	name: displayNameSchema,
});

export const renameMessageSchema = z.object({
	type: z.literal("rename"),
	name: displayNameSchema,
});

export const renameRoomMessageSchema = z.object({
	type: z.literal("renameRoom"),
	roomName: roomNameSchema,
});

export const voteMessageSchema = z.object({
	type: z.literal("vote"),
	value: cardValueSchema,
});

export const revealMessageSchema = z.object({
	type: z.literal("reveal"),
});

export const resetMessageSchema = z.object({
	type: z.literal("reset"),
});

export const leaveMessageSchema = z.object({
	type: z.literal("leave"),
});

export const deleteRoundMessageSchema = z.object({
	type: z.literal("deleteRound"),
	roundNumber: z.number().int().positive(),
});

export const clearHistoryMessageSchema = z.object({
	type: z.literal("clearHistory"),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
	joinMessageSchema,
	renameMessageSchema,
	renameRoomMessageSchema,
	voteMessageSchema,
	revealMessageSchema,
	resetMessageSchema,
	deleteRoundMessageSchema,
	clearHistoryMessageSchema,
	leaveMessageSchema,
]);

export type DeleteRoundMessage = z.infer<typeof deleteRoundMessageSchema>;
export type ClearHistoryMessage = z.infer<typeof clearHistoryMessageSchema>;

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type JoinMessage = z.infer<typeof joinMessageSchema>;

export const participantSnapshotSchema = z.object({
	id: z.string(),
	name: z.string(),
	connected: z.boolean(),
	hasVoted: z.boolean(),
	vote: z.string().optional(),
});

export type ParticipantSnapshot = z.infer<typeof participantSnapshotSchema>;

export const historyEntrySchema = z.object({
	roundNumber: z.number().int().positive(),
	revealedAt: z.number().int().nonnegative(),
	average: z.number().nullable(),
	median: z.number().nullable(),
	results: z.array(
		z.object({
			participantId: z.string(),
			name: z.string(),
			vote: z.string(),
		}),
	),
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const roomStateSchema = z.object({
	type: z.literal("state"),
	roomId: z.string(),
	roomName: roomNameSchema,
	deckType: deckTypeSchema,
	revealed: z.boolean(),
	roundNumber: z.number().int().positive(),
	participants: z.array(participantSnapshotSchema),
	selfVote: z.string().optional(),
	history: z.array(historyEntrySchema),
});

export type RoomState = z.infer<typeof roomStateSchema>;

export const protocolErrorCodeSchema = z.enum([
	"MALFORMED_MESSAGE",
	"INVALID_MESSAGE",
	"ROOM_NOT_FOUND",
	"PARTICIPANT_LIMIT",
	"INVALID_CARD",
	"UNATTACHED",
	"DUPLICATE_JOIN",
	"RATE_LIMITED",
	"MESSAGE_TOO_LARGE",
	"INTERNAL_ERROR",
]);

export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>;

export const protocolErrorSchema = z.object({
	type: z.literal("error"),
	code: protocolErrorCodeSchema,
	message: z.string(),
});

export type ProtocolError = z.infer<typeof protocolErrorSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
	roomStateSchema,
	protocolErrorSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const createRoomInputSchema = z.object({
	roomName: roomNameSchema,
	deckType: deckTypeSchema,
});

export const getRoomInputSchema = z.object({
	roomId: roomCodeSchema,
});

export type RoomMetadata = {
	roomId: string;
	roomName: string;
	deckType: DeckType;
	createdAt: number;
};

/** Strip control characters and trim whitespace. */
export function sanitizeName(input: string): string {
	// C0 controls + DEL — constructed to avoid embedding control literals in source.
	const controlChars = new RegExp(
		`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
		"g",
	);
	return input.replace(controlChars, "").trim();
}

/** True when every vote is a finite number (not ?, coffee, or t-shirt sizes). */
export function isNumericVote(value: string): boolean {
	if (value === "?" || value === "☕") {
		return false;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed);
}

export function parseNumericVote(value: string): number | null {
	if (!isNumericVote(value)) {
		return null;
	}
	return Number(value);
}

/**
 * Average of votes. Returns null unless every vote is numeric.
 */
export function averageVotes(votes: string[]): number | null {
	if (votes.length === 0) {
		return null;
	}
	const numbers: number[] = [];
	for (const vote of votes) {
		const n = parseNumericVote(vote);
		if (n === null) {
			return null;
		}
		numbers.push(n);
	}
	const sum = numbers.reduce((acc, n) => acc + n, 0);
	return sum / numbers.length;
}

/**
 * Median of votes. Returns null unless every vote is numeric.
 */
export function medianVotes(votes: string[]): number | null {
	if (votes.length === 0) {
		return null;
	}
	const numbers: number[] = [];
	for (const vote of votes) {
		const n = parseNumericVote(vote);
		if (n === null) {
			return null;
		}
		numbers.push(n);
	}
	numbers.sort((a, b) => a - b);
	const mid = Math.floor(numbers.length / 2);
	if (numbers.length % 2 === 0) {
		return (numbers[mid - 1]! + numbers[mid]!) / 2;
	}
	return numbers[mid]!;
}

export function isValidCardForDeck(value: string, deckType: DeckType): boolean {
	return (DECK_PRESETS[deckType] as readonly string[]).includes(value);
}

export function deckCards(deckType: DeckType): readonly string[] {
	return DECK_PRESETS[deckType];
}
