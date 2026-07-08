// test_pool_api.js
// Run with: node test_pool_api.js
// Make sure server is running on port 3000
// Requires 1 user_id that already went through /api/auth/register
// (so it has stellar_secret set and a funded/trustlined Stellar account)

const BASE_URL = "http://localhost:3000";
const CONTRACT_ADDRESS = "CBWDSBRH2HUEK6CHLTTI7HVJOAT4QGYSQKGVERFSUKBWR2MK3Z2ICEYM";

// Replace with your one registered user's id
const USER_ID = "66494b42-6061-40d2-878e-daec2bd256aa";

async function test() {
  console.log("🔍 Starting Pool API tests (single-member pool)...\n");

  if (USER_ID.startsWith("REPLACE_")) {
    console.log("❌ Please set USER_ID to a real registered user id before running.");
    return;
  }

  // 1. Health
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = await healthRes.json();
  console.log("1. Health:", healthData.ok ? "✅ OK" : "❌ FAIL");

  // 2. Create pool with total_members = 1 (matches our single test user)
  const poolRes = await fetch(`${BASE_URL}/api/pools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Solo Test Pool",
      total_members: 1,
      contribution_amount: 500,
      cycle_duration_days: 7,
      max_members: 1,
      contract_address: CONTRACT_ADDRESS,
    }),
  });
  const poolData = await poolRes.json();
  if (poolRes.ok && poolData.id) {
    console.log(`2. Create pool: ✅  poolId = ${poolData.id}`);
  } else {
    console.log("2. Create pool: ❌", poolData.error);
    return;
  }
  const POOL_ID = poolData.id;

  // 3. Join
  const joinRes = await fetch(`${BASE_URL}/api/pools/${POOL_ID}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: USER_ID, sequence: 1 }),
  });
  const joinData = await joinRes.json();
  if (joinRes.ok && joinData.id) {
    console.log(`3. Join pool: ✅  memberId = ${joinData.id}`);
  } else {
    console.log("3. Join pool: ❌", joinData.error);
  }

  // 4. Contribute
  const contribRes = await fetch(`${BASE_URL}/api/pools/${POOL_ID}/contribute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: USER_ID }),
  });
  const contribData = await contribRes.json();
  if (contribRes.ok && contribData.success) {
    console.log("4. Contribute: ✅ success");
  } else {
    console.log("4. Contribute: ❌", contribData.error);
  }

  // 5. Payout
  const payoutRes = await fetch(`${BASE_URL}/api/pools/${POOL_ID}/payout`, {
    method: "POST",
  });
  const payoutData = await payoutRes.json();
  if (payoutRes.ok && payoutData.success) {
    console.log("5. Payout: ✅ success");
  } else {
    console.log("5. Payout: ❌", payoutData.error);
  }

  // 6. Get pool state
  const stateRes = await fetch(`${BASE_URL}/api/pools/${POOL_ID}/state`);
  const stateData = await stateRes.json();
  if (stateRes.ok && !stateData.error) {
    console.log("6. Get state: ✅", JSON.stringify(stateData));
  } else {
    console.log("6. Get state: ❌", stateData.error);
  }

  console.log("\n✅ Tests completed.");
}

test().catch((err) => console.error("Unexpected error:", err));