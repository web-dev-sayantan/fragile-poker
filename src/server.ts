import handler from "@tanstack/solid-start/server-entry";

export { RoomDurableObject } from "./server/durable-objects/room";

export default {
	fetch: handler.fetch,
};
