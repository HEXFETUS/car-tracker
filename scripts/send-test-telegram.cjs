// Run: node scripts/send-test-telegram.cjs
// Sends a test message to the CarTrackerTrial Telegram chat

async function main() {
  // Parse .env manually (simple parser)
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '../backend/.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    let key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }

  const { BOT_TOKEN, CHAT_ID } = process.env;
  
  console.log('Telegram Config:');
  console.log(`  Token: ${BOT_TOKEN ? '****' + BOT_TOKEN.slice(-5) : 'NOT SET'}`);
  console.log(`  Chat ID: ${CHAT_ID || 'NOT SET'}`);
  console.log('');

  // Send a test message mimicking the alert format from the tracker
  const message = [
    '🚗 CarTracker Test Alert',
    '',
    'This is a trial message sent from the development environment.',
    'If you can read this, the Telegram integration is working correctly.',
    '',
    `Sent at: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} PHT`,
  ].join('\n');

  console.log('Sending message...');
  console.log('');
  console.log('--- Message Content ---');
  console.log(message);
  console.log('------------------------');

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat_id: CHAT_ID, text: message }),
    });

    const result = await response.json();
    
    if (response.ok && result.ok) {
      console.log('\n✅ Message sent successfully!');
      console.log(`   Chat: "${result.result.chat.title}" (${result.result.chat.id})`);
      console.log(`   Message ID: ${result.result.message_id}`);
    } else {
      console.error('\n❌ Failed to send message');
      console.error(`   Status: ${response.status}`);
      console.error(`   Error: ${result.description || JSON.stringify(result)}`);
    }
  } catch (err) {
    console.error('\n❌ Error:', err.message);
  }
}

main().catch(console.error);