// test_api.js
// Run with: node test_api.js
// Make sure server is running on port 3000 and SKIP_STELLAR=true

const BASE_URL = 'http://localhost:3000';

async function test() {
  console.log('🔍 Starting API tests...\n');

  // 1. Health
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = await healthRes.json();
  console.log('1. Health:', healthData.ok ? '✅ OK' : '❌ FAIL');

  // 2. Create pool
  const poolRes = await fetch(`${BASE_URL}/api/pools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Pool',
      total_members: 3,
      contribution_amount: 500,
    cycle_duration_days: 7,
      max_members: 3,
      contract_address: 'CC6I4QOTWH3T42IFYWXX4BXECEGCOKBDAJHYIWQVNOC5XGTLVBJ37466',
    }),
  });
  const poolData = await poolRes.json();
  if (poolRes.ok && poolData.id) {
    console.log(`2. Create pool: ✅  poolId = ${poolData.id}`);
  } else {
    console.log('2. Create pool: ❌', poolData.error);
    return;
  }

  const POOL_ID = poolData.id; // from response (or use hardcoded dd784192-6fb4-4574-b0f9-28c395df062f)

  // 3. Join pool – using the user you already inserted
  const USER_ID = '570da116-d6c5-4a75-b013-8992084f58d6'; // your test user
  const joinRes = await fetch(`${BASE_URL}/api/pools/${POOL_ID}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: USER_ID, sequence: 1 }),
  });
  const joinData = await joinRes.json();
  if (joinRes.ok && joinData.id) {
    console.log(`3. Join pool: ✅  memberId = ${joinData.id}`);
  } else {
    console.log('3. Join pool: ❌', joinData.error);
  }

  // 4. Contribute (should be skipped on-chain, only DB)
  const contribRes = await fetch(`${BASE_URL}/api/pools/${POOL_ID}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: USER_ID }),
  });
  const contribData = await contribRes.json();
  if (contribRes.ok && contribData.success) {
    console.log('4. Contribute: ✅ success');
  } else {
    console.log('4. Contribute: ❌', contribData.error);
  }

  // 5. Payout (should also be skipped or will fail because missing contributions)
  const payoutRes = await fetch(`${BASE_URL}/api/pools/${POOL_ID}/payout`, {
    method: 'POST',
  });
  const payoutData = await payoutRes.json();
  if (payoutRes.ok && payoutData.success) {
    console.log('5. Payout: ✅ success');
  } else {
    console.log('5. Payout: ❌', payoutData.error);
  }

  // 6. Get pool state
  const stateRes = await fetch(`${BASE_URL}/api/pools/${POOL_ID}/state`);
  const stateData = await stateRes.json();
  if (stateRes.ok && !stateData.error) {
    console.log('6. Get state: ✅', JSON.stringify(stateData).substring(0, 80), '...');
  } else {
    console.log('6. Get state: ❌', stateData.error);
  }

  console.log('\n✅ Tests completed.');
}

test().catch(err => console.error('Unexpected error:', err));