// Run: node scripts/get-telegram-chats.js
// Shows all chats where the CarTracker bot has been added.

const BOT_TOKEN = '7601539426:AAGBKuGbr9Na7L3-uwCfhMNJFvNpgmvuaZs';

async function main() {
  // Step 1: Get pending updates
  console.log('Fetching Telegram updates...\n');
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`;
  const response = await fetch(url);
  const data = await response.json();

  if (!data.ok) {
    console.error('Error:', data);
    return;
  }

  if (!data.result || data.result.length === 0) {
    console.log('No updates found. Make sure:');
    console.log('  1. The bot (@CarTrackerTrial_bot or similar) has been added to a group');
    console.log('  2. Someone sent a message in that group');
    console.log('  3. Then re-run this script');
    console.log('\nAlternatively, use this URL to see the bot username:');
    const meUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
    const meRes = await fetch(meUrl);
    const meData = await meRes.json();
    if (meData.ok) {
      console.log(`Bot username: @${meData.result.username}`);
    }
    return;
  }

  const seen = new Set();
  for (const update of data.result) {
    let chat = null;
    if (update.message) {
      chat = update.message.chat;
    } else if (update.my_chat_member) {
      chat = update.my_chat_member.chat;
    } else if (update.channel_post) {
      chat = update.channel_post.chat;
    }

    if (chat && !seen.has(chat.id)) {
      seen.add(chat.id);
      const type = chat.type || 'unknown';
      const title = chat.title || chat.first_name || 'Unknown';
      console.log(`Chat: "${title}"`);
      console.log(`  ID: ${chat.id}`);
      console.log(`  Type: ${type}`);
      console.log('');
    }
  }

  if (seen.size === 0) {
    console.log('No recognizable chat updates found.');
  }
}

main().catch(console.error);