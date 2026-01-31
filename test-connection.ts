#!/usr/bin/env bun
/**
 * Quick test script for SpaceMolt server
 */

// For local testing, set SPACEMOLT_URL=ws://localhost:8080/ws
const SERVER_URL = process.env.SPACEMOLT_URL || 'wss://game.spacemolt.com/ws';

async function test() {
  console.log(`Connecting to ${SERVER_URL}...`);

  const ws = new WebSocket(SERVER_URL);
  let testStep = 0;

  const waitTick = (callback: () => void) => {
    console.log('  (waiting 11s for next tick...)');
    setTimeout(callback, 11000);
  };

  ws.onopen = () => {
    console.log('Connected!');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // Skip state_update spam in output
    if (msg.type !== 'state_update') {
      console.log(`[${msg.type}]`, msg.payload ? JSON.stringify(msg.payload).slice(0, 150) : '');
    }

    // After welcome, register
    if (msg.type === 'welcome') {
      console.log('\n--- Step 1: Registering player ---');
      ws.send(JSON.stringify({
        type: 'register',
        payload: { username: 'miner' + Date.now(), empire: 'solarian' }
      }));
    }

    // After logged in (happens automatically after registration)
    if (msg.type === 'logged_in') {
      console.log('\n--- Player Info ---');
      console.log(`Username: ${msg.payload.player.username}`);
      console.log(`Empire: ${msg.payload.player.empire}`);
      console.log(`Credits: ${msg.payload.player.credits}`);
      console.log(`System: ${msg.payload.system.name}`);
      console.log(`POI: ${msg.payload.poi.name}`);
      console.log(`Ship: ${msg.payload.ship.name}`);
      console.log(`Docked: ${msg.payload.player.docked_at_base ? 'Yes' : 'No'}`);

      // Step 2: Undock
      console.log('\n--- Step 2: Undocking ---');
      waitTick(() => {
        ws.send(JSON.stringify({ type: 'undock', payload: {} }));
        testStep = 2;
      });
    }

    // Handle ok responses based on test step
    if (msg.type === 'ok') {
      if (testStep === 2) {
        // Undocked - now get system info to find asteroid belt
        console.log('\n--- Step 3: Getting system info ---');
        waitTick(() => {
          ws.send(JSON.stringify({ type: 'get_system', payload: {} }));
          testStep = 3;
        });
      } else if (testStep === 3 && msg.payload.pois) {
        // Got system info - find asteroid belt
        const asteroidBelt = msg.payload.pois.find((p: any) => p.type === 'asteroid_belt');
        if (asteroidBelt) {
          console.log(`\n--- Step 4: Traveling to ${asteroidBelt.name} (${asteroidBelt.id}) ---`);
          waitTick(() => {
            ws.send(JSON.stringify({ type: 'travel', payload: { target_poi: asteroidBelt.id } }));
            testStep = 4;
          });
        } else {
          console.log('No asteroid belt found in system!');
          ws.close();
          process.exit(1);
        }
      } else if (testStep === 4 && msg.payload.action === 'travel') {
        // Travel started - wait for arrival
        console.log(`  Travel in progress, arriving at tick ${msg.payload.arrival_tick}`);
        testStep = 41; // Waiting for arrival
      } else if (testStep === 41 && msg.payload.action === 'arrived') {
        // Actually arrived - now mine!
        console.log(`\n--- Step 5: Mining at ${msg.payload.poi} ---`);
        waitTick(() => {
          ws.send(JSON.stringify({ type: 'mine', payload: {} }));
          testStep = 5;
        });
      }
    }

    // Handle mining yield
    if (msg.type === 'mining_yield') {
      if (testStep === 5) {
        console.log(`\n=== SUCCESS! Mined: ${msg.payload.quantity}x ${msg.payload.resource_id} ===`);

        // Try one more mine to confirm
        console.log('\n--- Step 6: Mining again ---');
        waitTick(() => {
          ws.send(JSON.stringify({ type: 'mine', payload: {} }));
          testStep = 6;
        });
      } else if (testStep === 6) {
        console.log(`Mined again: ${msg.payload.quantity}x ${msg.payload.resource_id}`);
        console.log('\n=== All Tests Passed! ===');
        ws.close();
        process.exit(0);
      }
    }

    if (msg.type === 'error') {
      console.log(`ERROR: [${msg.payload.code}] ${msg.payload.message}`);
      if (msg.payload.code !== 'rate_limited') {
        // Don't fail on rate limit, but fail on other errors
        // ws.close();
        // process.exit(1);
      }
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    process.exit(1);
  };

  ws.onclose = () => {
    console.log('Connection closed');
  };

  // Timeout after 2 minutes
  setTimeout(() => {
    console.log('Test timeout');
    ws.close();
    process.exit(1);
  }, 120000);
}

test();
