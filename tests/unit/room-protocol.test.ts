import { describe, expect, it } from "vitest";
import { generateRoomCode, isValidRoomCode } from "../../src/lib/room-code";
import {
	averageVotes,
	clientMessageSchema,
	DECK_PRESETS,
	displayNameSchema,
	isNumericVote,
	isValidCardForDeck,
	medianVotes,
	sanitizeName,
} from "../../src/lib/room-protocol";

describe("sanitizeName", () => {
	it("trims and strips control characters", () => {
		expect(sanitizeName("  Ada\u0001 Lovelace  ")).toBe("Ada Lovelace");
	});
});

describe("displayNameSchema", () => {
	it("accepts valid names", () => {
		expect(displayNameSchema.parse("Alex")).toBe("Alex");
	});

	it("rejects empty names", () => {
		expect(() => displayNameSchema.parse("   ")).toThrow();
	});
});

describe("vote stats", () => {
	it("computes average and median for all-numeric votes", () => {
		const votes = ["1", "2", "3", "5"];
		expect(averageVotes(votes)).toBe(2.75);
		expect(medianVotes(votes)).toBe(2.5);
	});

	it("returns null when any vote is non-numeric", () => {
		expect(averageVotes(["1", "?", "3"])).toBeNull();
		expect(medianVotes(["1", "☕"])).toBeNull();
	});

	it("handles single vote median", () => {
		expect(medianVotes(["8"])).toBe(8);
	});
});

describe("isNumericVote", () => {
	it("rejects special cards", () => {
		expect(isNumericVote("?")).toBe(false);
		expect(isNumericVote("☕")).toBe(false);
		expect(isNumericVote("XS")).toBe(false);
	});

	it("accepts numeric strings", () => {
		expect(isNumericVote("13")).toBe(true);
		expect(isNumericVote("0")).toBe(true);
	});
});

describe("deck validation", () => {
	it("validates cards against presets", () => {
		expect(isValidCardForDeck("13", "fibonacci")).toBe(true);
		expect(isValidCardForDeck("XS", "tshirt")).toBe(true);
		expect(isValidCardForDeck("13", "tshirt")).toBe(false);
		expect(DECK_PRESETS.sequential).toContain("10");
	});
});

describe("client messages", () => {
	it("parses join messages", () => {
		const result = clientMessageSchema.parse({
			type: "join",
			participantId: "abcdefghijklmnop",
			name: "Sam",
		});
		expect(result.type).toBe("join");
	});

	it("rejects unknown types", () => {
		expect(() => clientMessageSchema.parse({ type: "explode" })).toThrow();
	});
});

describe("room codes", () => {
	it("generates valid codes", () => {
		const code = generateRoomCode();
		expect(code.length).toBeGreaterThanOrEqual(10);
		expect(isValidRoomCode(code)).toBe(true);
	});
});
