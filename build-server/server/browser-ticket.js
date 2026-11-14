import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { ticketReceiptSchema } from "../shared/test-dispatch.js";
const execute = promisify(execFile);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function browserTicketExecutor(config) {
    let active = Promise.resolve();
    // One owned browser, one submission at a time, even across different missions.
    return input => {
        const task = active.catch(() => { }).then(() => submit(input));
        active = task;
        return task;
    };
    async function submit(input) {
        ticketReceiptSchema.shape.runId.parse(input.runId);
        ticketReceiptSchema.shape.missionId.parse(input.missionId);
        const url = new URL(config.origin);
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.origin !== config.origin)
            throw new Error("Browser destination must be an explicit loopback origin.");
        // Reconcile only this logical agent, never a global browser inventory.
        await execute(join(homedir(), "Desktop/tools/agent-pov-monitor/agent-session"), ["allocate", config.agentId], { timeout: 90000 });
        const registry = JSON.parse(await readFile(join(homedir(), ".codex/agent-pov-monitor/sessions.json"), "utf8"));
        const owned = registry.sessions?.[config.agentId];
        const expectedProfile = join(homedir(), ".codex/agent-browser-sessions", config.agentId);
        if (!owned || owned.agent_id !== config.agentId || owned.ownership !== "agent" || owned.status !== "ready" || owned.profile_dir !== expectedProfile || !owned.window_id || !Number.isInteger(owned.debug_port))
            throw new Error("No verified agent-owned browser. Allocate this agent's session first.");
        const processInfo = await execute("/bin/ps", ["-p", String(owned.browser_pid), "-o", "command="]);
        if (!processInfo.stdout.includes(`--user-data-dir=${expectedProfile}`) || !processInfo.stdout.includes(`--remote-debugging-port=${owned.debug_port}`))
            throw new Error("Browser process ownership changed.");
        const windowInfo = await execute(join(homedir(), ".codex/agent-pov-monitor/window-for-pid"), [String(owned.browser_pid)]);
        if (Number(windowInfo.stdout.trim()) !== owned.window_id)
            throw new Error("Agent browser window no longer matches its registry.");
        const moduleName = config.modulePath ?? "playwright-core";
        const { chromium } = await import(moduleName);
        let browser, page;
        const directory = resolve(config.directory, input.missionId, input.runId);
        try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${owned.debug_port}`);
            // Only the allocated profile is inspected; never discover arbitrary browsers.
            page = await browser.contexts()[0].newPage();
            page.setDefaultTimeout(15000);
            await page.setViewportSize({ width: 1120, height: 900 });
            await page.route("**/*", async (route) => {
                const request = route.request(), requested = new URL(request.url());
                const permitted = requested.origin === config.origin && !requested.search &&
                    ((requested.pathname === "/computer/tickets" && request.method() === "GET") ||
                        (requested.pathname === "/tickets" && request.method() === "POST"));
                if (!permitted)
                    return route.abort();
                let response;
                try {
                    // Fetch the browser-initiated request without following redirects. Never
                    // pass a redirect or Location header back to Chrome with credentials.
                    response = await route.fetch({
                        headers: { ...request.headers(), authorization: `Bearer ${config.aToken}` },
                        maxRedirects: 0, maxRetries: 0, timeout: 10000,
                    });
                    if (response.status() >= 300 && response.status() < 400) {
                        await route.fulfill({ status: 502, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ error: "Browser destination redirects are blocked." }) });
                    }
                    else {
                        await route.fulfill({ response });
                    }
                }
                catch {
                    // No upstream error text or credential-bearing headers reach the page.
                    await route.abort().catch(() => { });
                }
                finally {
                    await response?.dispose().catch(() => { });
                }
            });
            await mkdir(directory, { recursive: true });
            await page.goto(`${config.origin}/computer/tickets`, { waitUntil: "networkidle" });
            await page.getByRole("heading", { name: "Submit a test ticket" }).waitFor();
            await page.getByLabel("Request ID", { exact: true }).fill(input.runId);
            await page.getByLabel("Mission", { exact: true }).fill(input.missionId);
            await page.getByLabel("Request", { exact: true }).fill(input.title);
            const before = await page.screenshot({ path: join(directory, "before.png"), fullPage: true });
            const [response] = await Promise.all([
                page.waitForResponse((r) => r.url() === `${config.origin}/tickets` && r.request().method() === "POST"),
                page.getByRole("button", { name: "Submit ticket", exact: true }).click(),
            ]);
            if (!response.ok())
                throw new Error(`Browser submission returned HTTP ${response.status()}.`);
            const receipt = ticketReceiptSchema.parse(await response.json());
            if (receipt.runId !== input.runId || receipt.missionId !== input.missionId || receipt.title !== input.title)
                throw new Error("Browser receipt does not match the requested action.");
            await page.getByText(receipt.id, { exact: true }).waitFor();
            await page.getByRole("heading", { name: "Ticket accepted" }).waitFor();
            const after = await page.screenshot({ path: join(directory, "after.png"), fullPage: true });
            const actualWindow = await execute(join(homedir(), ".codex/agent-pov-monitor/window-for-pid"), [String(owned.browser_pid)]);
            const windowId = Number(actualWindow.stdout.trim());
            if (!Number.isInteger(windowId) || windowId <= 0)
                throw new Error("Execution window could not be verified.");
            const evidence = { method: "browser_form", agentId: config.agentId, browserPid: owned.browser_pid, windowId, capturedAt: new Date().toISOString(), beforeSha256: sha(before), afterSha256: sha(after), receiptId: receipt.id };
            await writeFile(join(directory, "evidence.json"), JSON.stringify({ input, receipt, evidence }, null, 2), { mode: 0o600 });
            return { receipt, evidence };
        }
        finally {
            try {
                await page?.close();
            }
            finally {
                await browser?.close();
            }
        }
    }
}
