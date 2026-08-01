/**
 * Minimal worker entry for Durable Object tests.
 * Avoids importing the TanStack Start app shell (Solid SSR).
 */
export { RoomDurableObject } from "../../src/server/durable-objects/room";

export default {
	async fetch(): Promise<Response> {
		return new Response("test-worker", { status: 200 });
	},
};
