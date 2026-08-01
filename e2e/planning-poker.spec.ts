import { expect, type Page, test } from "@playwright/test";

async function joinRoom(page: Page, name: string) {
	const dialog = page.getByRole("dialog", { name: /join room/i });
	await expect(dialog).toBeVisible({ timeout: 15_000 });

	const nameInput = page.getByLabel(/display name/i);
	await nameInput.click();
	await nameInput.fill("");
	// Solid controlled inputs need real input events.
	await nameInput.pressSequentially(name, { delay: 20 });
	await expect(nameInput).toHaveValue(name);

	await page.getByRole("button", { name: /join session/i }).click();

	// Dialog closes once the server confirms join.
	await expect(dialog).toBeHidden({ timeout: 15_000 });
	await expect(
		page.getByRole("listitem").filter({ hasText: name }).first(),
	).toBeVisible({ timeout: 15_000 });
}

test("two participants can vote, reveal, and reset", async ({ browser }) => {
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();

	alice.on("console", (msg) => {
		if (msg.type() === "error") {
			console.log("alice console error:", msg.text());
		}
	});
	bob.on("console", (msg) => {
		if (msg.type() === "error") {
			console.log("bob console error:", msg.text());
		}
	});
	alice.on("pageerror", (err) => console.log("alice pageerror", err.message));
	bob.on("pageerror", (err) => console.log("bob pageerror", err.message));

	await alice.goto("/");
	await expect(
		alice.getByRole("heading", { name: /fragile poker/i }),
	).toBeVisible();

	// Wait until Solid onMount flips client-ready (SSR alone is not enough).
	await alice.waitForSelector('form[data-client-ready="true"]', {
		timeout: 30_000,
	});
	const startButton = alice.getByRole("button", { name: /start a session/i });
	await expect(startButton).toBeEnabled();

	await alice.getByLabel(/room name/i).fill("Mobile app estimates");
	await alice.getByLabel(/card deck/i).selectOption("fibonacci");
	await Promise.all([
		alice.waitForURL(/\/room\//, { timeout: 20_000 }),
		startButton.click(),
	]);

	const roomUrl = alice.url();
	await joinRoom(alice, "Alice");

	await bob.goto(roomUrl);
	await joinRoom(bob, "Bob");

	await expect(
		alice.getByRole("heading", { name: "Mobile app estimates" }),
	).toBeVisible();
	await alice.getByRole("button", { name: "Rename" }).click();
	await alice.getByLabel("Room name").fill("Release planning");
	await alice.getByRole("button", { name: "Save" }).click();
	await expect(
		bob.getByRole("heading", { name: "Release planning" }),
	).toBeVisible();

	await expect(alice.getByText("Bob")).toBeVisible({ timeout: 15_000 });
	await expect(bob.getByText("Alice")).toBeVisible();

	await alice.getByRole("button", { name: "5", exact: true }).click();
	await expect(alice.getByText("Voted").first()).toBeVisible();
	// Bob should see that Alice voted without seeing the value in participant chips
	await expect(bob.getByText("Voted").first()).toBeVisible();

	await bob.getByRole("button", { name: "8", exact: true }).click();
	await alice.getByRole("button", { name: /reveal votes/i }).click();

	await expect(alice.getByText("Results")).toBeVisible({ timeout: 10_000 });
	await expect(bob.getByText("Results")).toBeVisible();
	await expect(alice.getByText("5").first()).toBeVisible();
	await expect(alice.getByText("8").first()).toBeVisible();

	await bob.getByRole("button", { name: /reset for next round/i }).click();
	await expect(alice.getByLabel(/card deck/i)).toBeVisible({ timeout: 10_000 });
	await expect(alice.getByText(/round history \(1\)/i)).toBeVisible();

	// Reload keeps local identity and auto-rejoins without the join dialog.
	await alice.reload();
	await expect(alice.getByRole("dialog", { name: /join room/i })).toHaveCount(
		0,
	);
	await expect(
		alice.getByRole("listitem").filter({ hasText: "Alice" }).first(),
	).toBeVisible({ timeout: 15_000 });
	await expect(bob.getByText("Alice")).toBeVisible({ timeout: 15_000 });

	await aliceContext.close();
	await bobContext.close();
});
