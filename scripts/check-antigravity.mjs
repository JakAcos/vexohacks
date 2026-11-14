// Explicit live provider check; never included in npm test.
import { antigravityPlan } from "../build-server/server/antigravity.js";
if (!process.argv.includes("--live")) throw new Error("Add --live to run this synthetic fixture against the paid Antigravity API.");
const state = {id: "antigravity-fixture", version: 1,
  observations: [{id: "fictional-r1", speaker: "Officer A", text: "Two people report injuries after a collision. Both are speaking. No ambulance is on scene.", facts: [], timestamp: new Date().toISOString()}],
  issues: [], actions: []};
const started = Date.now();
try {
  const result = await antigravityPlan(state, "fictional-r1", {onReceipt: receipt => console.error(`${receipt.tool}: ${receipt.summary}`)});
  console.log(JSON.stringify({passed: true, fixture: "synthetic text, not live emergency or physical wearable", elapsedMs: Date.now()-started, ...result}, null, 2));
} catch (error) {
  console.error(JSON.stringify({passed: false, error: error.message, elapsedMs: Date.now()-started}));
  process.exitCode = 1;
}
