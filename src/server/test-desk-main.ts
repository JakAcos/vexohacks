import { createTestDesk } from "./test-desk.js";
const { app } = createTestDesk(process.env.TEST_DESK_DATA_DIR ?? "./test-desk-data", {
  a: process.env.RELAY_TEST_DISPATCH_A_TOKEN ?? "", b: process.env.RELAY_TEST_DISPATCH_B_TOKEN ?? "",
});
const port = Number(process.env.TEST_DESK_PORT ?? 14318);
const server = app.listen(port, "127.0.0.1", () => console.log(`Relay Test Desk listening at http://127.0.0.1:${port}. Synthetic requests only.`));
process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
