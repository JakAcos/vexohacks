import type { Store } from "../src/server/store.js";
// Existing business-rule tests wait for background work before checking derived facts.
// async-intake.test.ts tests the actual immediate HTTP response and pending snapshots.
export async function settle(response: Response, store: Store) {
  if (response.status !== 202) return response;
  const body = await response.json();
  await store.idle();
  const incident = await store.get(body.incident?.id ?? body.id);
  return new Response(JSON.stringify(body.incident ? {...body,incident} : incident), {status:202,headers:{"Content-Type":"application/json"}});
}
