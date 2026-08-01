import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { RoomState, ServerMessage } from "../../src/lib/room-protocol";
import type { RoomDurableObject } from "../../src/server/durable-objects/room";

function roomStub(name: string) {
	return env.ROOM_DO.getByName(name);
}

async function openSocket(roomId: string): Promise<WebSocket> {
	const stub = roomStub(roomId);
	const response = await stub.fetch(
		new Request(`https://example.com/room/${roomId}/ws`, {
			headers: { Upgrade: "websocket" },
		}),
	);
	expect(response.status).toBe(101);
	const ws = response.webSocket;
	expect(ws).toBeTruthy();
	ws!.accept();
	return ws!;
}

/**
 * Wait for the next matching state snapshot.
 * Always register before the send() that should produce the message.
 */
function waitForState(
	ws: WebSocket,
	predicate: (state: RoomState) => boolean,
	timeoutMs = 5000,
): Promise<RoomState> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for room state"));
		}, timeoutMs);

		const onMessage = (event: MessageEvent) => {
			if (typeof event.data !== "string") {
				return;
			}
			let message: ServerMessage;
			try {
				message = JSON.parse(event.data) as ServerMessage;
			} catch {
				return;
			}
			if (message.type !== "state") {
				return;
			}
			if (predicate(message)) {
				cleanup();
				resolve(message);
			}
		};

		const cleanup = () => {
			clearTimeout(timer);
			ws.removeEventListener("message", onMessage);
		};

		ws.addEventListener("message", onMessage);
	});
}

function send(ws: WebSocket, payload: unknown) {
	ws.send(JSON.stringify(payload));
}

describe("RoomDurableObject", () => {
	it("creates room metadata and rejects unknown rooms", async () => {
		const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
		const stub = roomStub(id);
		expect(await stub.getRoom()).toBeNull();

		const created = await stub.createRoom(id, "Sprint planning", "fibonacci");
		expect(created.roomId).toBe(id);
		expect(created.roomName).toBe("Sprint planning");
		expect(created.deckType).toBe("fibonacci");

		const again = await stub.createRoom(id, "Other name", "tshirt");
		expect(again.roomName).toBe("Sprint planning");
		expect(again.deckType).toBe("fibonacci");

		const missing = roomStub(
			`m${crypto.randomUUID().replace(/-/g, "").slice(0, 11)}`,
		);
		expect(await missing.getRoom()).toBeNull();
	});

	it("runs join → vote → reveal → reset with private votes", async () => {
		const roomId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
		const stub = roomStub(roomId);
		await stub.createRoom(roomId, "Private voting", "fibonacci");

		const alice = await openSocket(roomId);
		const bob = await openSocket(roomId);

		const aliceJoined = waitForState(alice, (s) =>
			s.participants.some((p) => p.id === "alice-participant"),
		);
		send(alice, {
			type: "join",
			participantId: "alice-participant",
			name: "Alice",
		});
		await aliceJoined;

		const bobJoined = waitForState(
			bob,
			(s) => s.participants.length === 2 && !s.revealed,
		);
		const aliceSawBob = waitForState(alice, (s) => s.participants.length === 2);
		send(bob, {
			type: "join",
			participantId: "bob-participantxx",
			name: "Bob",
		});
		await Promise.all([bobJoined, aliceSawBob]);

		const aliceVoted = waitForState(
			alice,
			(s) =>
				s.selfVote === "5" &&
				s.participants.find((p) => p.id === "alice-participant")?.hasVoted ===
					true,
		);
		const bobSeesAliceVoted = waitForState(bob, (s) => {
			const aliceP = s.participants.find((p) => p.id === "alice-participant");
			const bobP = s.participants.find((p) => p.id === "bob-participantxx");
			return (
				aliceP?.hasVoted === true &&
				aliceP.vote === undefined &&
				bobP?.vote === undefined &&
				s.selfVote === undefined
			);
		});
		send(alice, { type: "vote", value: "5" });
		const [, bobHidden] = await Promise.all([aliceVoted, bobSeesAliceVoted]);

		// Votes stay private while the round is hidden.
		for (const participant of bobHidden.participants) {
			expect(participant.vote).toBeUndefined();
		}
		expect(bobHidden.selfVote).toBeUndefined();

		const bothVotedForAlice = waitForState(
			alice,
			(s) => s.participants.every((p) => p.hasVoted) && !s.revealed,
		);
		const bobVotedSelf = waitForState(bob, (s) => s.selfVote === "8");
		send(bob, { type: "vote", value: "8" });
		await Promise.all([bothVotedForAlice, bobVotedSelf]);

		const revealedForAlice = waitForState(alice, (s) => s.revealed === true);
		const revealedForBob = waitForState(bob, (s) => s.revealed === true);
		send(alice, { type: "reveal" });
		const [aState, bState] = await Promise.all([
			revealedForAlice,
			revealedForBob,
		]);

		expect(
			aState.participants.find((p) => p.id === "alice-participant")?.vote,
		).toBe("5");
		expect(
			bState.participants.find((p) => p.id === "bob-participantxx")?.vote,
		).toBe("8");
		expect(aState.history).toHaveLength(1);
		expect(aState.history[0]?.average).toBe(6.5);
		expect(aState.history[0]?.median).toBe(6.5);

		// Second reveal is a no-op for history but still rebroadcasts state.
		const stillOneHistory = waitForState(
			alice,
			(s) => s.revealed && s.history.length === 1,
		);
		send(alice, { type: "reveal" });
		const afterSecondReveal = await stillOneHistory;
		expect(afterSecondReveal.history).toHaveLength(1);

		const resetState = waitForState(
			alice,
			(s) => !s.revealed && s.roundNumber === 2,
		);
		send(bob, { type: "reset" });
		const afterReset = await resetState;
		expect(afterReset.participants.every((p) => !p.hasVoted)).toBe(true);
		expect(afterReset.history).toHaveLength(1);

		alice.close(1000, "done");
		bob.close(1000, "done");
	});

	it("treats multiple sockets for one participant as one person", async () => {
		const roomId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
		const stub = roomStub(roomId);
		await stub.createRoom(roomId, "Duplicate participant", "sequential");

		const tab1 = await openSocket(roomId);
		const tab2 = await openSocket(roomId);

		const tab1Joined = waitForState(tab1, (s) => s.participants.length === 1);
		send(tab1, {
			type: "join",
			participantId: "same-participant01",
			name: "Casey",
		});
		await tab1Joined;

		const tab2Joined = waitForState(tab2, (s) => s.participants.length === 1);
		send(tab2, {
			type: "join",
			participantId: "same-participant01",
			name: "Casey",
		});
		const state = await tab2Joined;
		expect(state.participants).toHaveLength(1);
		expect(state.participants[0]?.connected).toBe(true);

		const votedOnTab2 = waitForState(tab2, (s) => s.selfVote === "3");
		send(tab1, { type: "vote", value: "3" });
		const voted = await votedOnTab2;
		expect(voted.participants[0]?.hasVoted).toBe(true);

		tab1.close(1000, "close-tab");
		await runInDurableObject(stub, async (_instance: RoomDurableObject) => {
			// allow close handler to run inside the DO isolate
		});

		tab2.close(1000, "done");
	});

	it("cleans up inactive rooms via alarm", async () => {
		const roomId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
		const stub = roomStub(roomId);
		await stub.createRoom(roomId, "Cleanup test", "tshirt");
		expect(await stub.getRoom()).not.toBeNull();

		// Age the room past TTL. runDurableObjectAlarm runs whatever alarm is scheduled.
		await runInDurableObject(stub, async (_instance, state) => {
			state.storage.sql.exec(
				`UPDATE room SET last_activity_at = ?`,
				Date.now() - 25 * 60 * 60 * 1000,
			);
			// Ensure a scheduled alarm exists (past timestamps can be dropped).
			await state.storage.setAlarm(Date.now() + 60_000);
		});

		const ran = await runDurableObjectAlarm(stub);
		expect(ran).toBe(true);
		expect(await stub.getRoom()).toBeNull();
	});
});
