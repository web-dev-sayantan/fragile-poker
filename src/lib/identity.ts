import { customAlphabet } from "nanoid";
import {
	PARTICIPANT_ID_LENGTH,
	ROOM_CODE_ALPHABET,
	sanitizeName,
} from "./room-protocol";

const STORAGE_KEY = "fragile-poker:identity";

const generateParticipantId = customAlphabet(
	ROOM_CODE_ALPHABET + "ABCDEFGHJKLMNPQRSTUVWXYZ",
	PARTICIPANT_ID_LENGTH,
);

export type StoredIdentity = {
	participantId: string;
	name: string;
};

function canUseStorage(): boolean {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function readIdentity(): StoredIdentity | null {
	if (!canUseStorage()) {
		return null;
	}
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as Partial<StoredIdentity>;
		if (
			typeof parsed.participantId !== "string" ||
			parsed.participantId.length < 10
		) {
			return null;
		}
		return {
			participantId: parsed.participantId,
			name: typeof parsed.name === "string" ? sanitizeName(parsed.name) : "",
		};
	} catch {
		return null;
	}
}

export function ensureIdentity(name?: string): StoredIdentity {
	const existing = readIdentity();
	const next: StoredIdentity = {
		participantId: existing?.participantId ?? generateParticipantId(),
		name: sanitizeName(name ?? existing?.name ?? ""),
	};
	writeIdentity(next);
	return next;
}

export function writeIdentity(identity: StoredIdentity): void {
	if (!canUseStorage()) {
		return;
	}
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({
			participantId: identity.participantId,
			name: sanitizeName(identity.name),
		}),
	);
}

export function updateStoredName(name: string): StoredIdentity {
	const identity = ensureIdentity(name);
	const next = { ...identity, name: sanitizeName(name) };
	writeIdentity(next);
	return next;
}
