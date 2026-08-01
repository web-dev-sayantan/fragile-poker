import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/solid-start";
import { generateRoomCode } from "../lib/room-code";
import {
	createRoomInputSchema,
	type DeckType,
	getRoomInputSchema,
	type RoomMetadata,
	roomCodeSchema,
} from "../lib/room-protocol";

const MAX_CREATE_ATTEMPTS = 5;

function getRoomStub(roomId: string) {
	return env.ROOM_DO.getByName(roomId);
}

export const createRoom = createServerFn({ method: "POST" })
	.validator((data: unknown) => createRoomInputSchema.parse(data))
	.handler(async ({ data }): Promise<RoomMetadata> => {
		const deckType = data.deckType as DeckType;
		const roomName = data.roomName;

		for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
			const roomId = generateRoomCode();
			const stub = getRoomStub(roomId);
			const existing = await stub.getRoom();
			if (existing) {
				continue;
			}
			return await stub.createRoom(roomId, roomName, deckType);
		}

		throw new Error("Could not allocate a unique room code");
	});

export const getRoom = createServerFn({ method: "GET" })
	.validator((data: unknown) => getRoomInputSchema.parse(data))
	.handler(async ({ data }): Promise<RoomMetadata | null> => {
		const roomId = roomCodeSchema.parse(data.roomId);
		const stub = getRoomStub(roomId);
		return await stub.getRoom();
	});
