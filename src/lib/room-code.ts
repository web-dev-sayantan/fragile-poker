import { customAlphabet } from "nanoid";
import {
	ROOM_CODE_ALPHABET,
	ROOM_CODE_LENGTH,
	roomCodeSchema,
} from "./room-protocol";

const generate = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

/** Server-only room code generator. */
export function generateRoomCode(): string {
	return generate();
}

export function isValidRoomCode(roomId: string): boolean {
	return roomCodeSchema.safeParse(roomId).success;
}
