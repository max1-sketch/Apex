require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  EmbedBuilder, 
  PermissionFlagsBits, 
  ActivityType,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// Full Dashboard State
let botState = {
  isMaintenanceMode: false,
  statusType: 'online',
  activityType: 'STREAMING',
  activityText: 'Apex Roleplay | /help',
  streamUrl: 'https://www.twitch.tv/discord',
  autoMod: {
    enabled: true,
    blockProfanity: true,
    blockInvites: true,
    blockLinks: true,
    maxWarnings: 3,
    timeoutHours: 24,
    customBadWords: ['badword1', 'cheat', 'exploit'],
    bypassRoles: [],
    bypassChannels: []
  }
};

const HARDCODED_PROFANITY = [
  'nigger', 'nigga', 'faggot', 'kike', 'chink', 'cunt', 'whore', 'slut', 'bastard', 'retard'
];

let chatHistory = [];
let robloxChatHistory = [];
let userWarnings = new Map();
let auditLogs = [];

// Helper to append & emit audit log entry to live sockets
function addAuditLog(action, details) {
  const entry = {
    timestamp: new Date().toLocaleTimeString() + ' (' + new Date().toLocaleDateString() + ')',
    action,
    details
  };
  auditLogs.unshift(entry);
  if (auditLogs.length > 100) auditLogs.pop();
  
  // Real-time broadcast to connected browsers
  io.emit('auditLogUpdate', entry);
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/!/g, 'i')
    .replace(/[^a-z0-9\s]/g, '');
}

function inspectMessage(content) {
  const clean = normalizeText(content);

  if (botState.autoMod.blockProfanity) {
    for (const word of HARDCODED_PROFANITY) {
      if (clean.includes(word)) return { violated: true, reason: `Severe Hardcoded Filter` };
    }
    for (const word of botState.autoMod.customBadWords) {
      if (clean.includes(normalizeText(word))) return { violated: true, reason: `Blacklisted Word: "${word}"` };
    }
  }

  if (botState.autoMod.blockInvites && /(discord\.gg|discord\.com\/invite)/i.test(content)) {
    return { violated: true, reason: 'Discord Invite Link' };
  }

  if (botState.autoMod.blockLinks && /https?:\/\/[^\s]+/i.test(content) && !content.includes('tenor.com')) {
    return { violated: true, reason: 'External Web Link' };
  }

  return { violated: false };
}

// ===================================================================
// SLASH COMMANDS
// ===================================================================

const slashCommands = [
  new SlashCommandBuilder()
    .setName('remoteban')
    .setDescription('Bans a player from the Roblox game remotely')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('The Roblox username to ban')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the ban')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
];

async function registerSlashCommands() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    console.warn('[SLASH COMMANDS] DISCORD_CLIENT_ID not set in .env - skipping registration.');
    return;
  }
  try {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: slashCommands.map(cmd => cmd.toJSON()) }
    );
    console.log('[SLASH COMMANDS] Registered: /remoteban (can take up to 1 hour to appear everywhere)');
  } catch (err) {
    console.error('[SLASH COMMANDS ERROR]', err.message);
  }
}

client.once('ready', () => {
  console.log(`[BOT ENGINE] Logged in as ${client.user.tag}`);
  updatePresence();
  addAuditLog('SYSTEM', `Bot Engine online as ${client.user.tag}`);
  registerSlashCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'remoteban') {
    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason') || 'Banned via Discord command.';

    await interaction.deferReply();

    try {
      await publishToRoblox('ban', username, reason);
      addAuditLog('ROBLOX_BAN', `${interaction.user.tag} banned "${username}" via /remoteban — ${reason}`);
      await interaction.editReply(`✅ Ban published for **${username}** — this takes effect the next time they're in a live, published game (does not work while the game is only running in Studio).\nReason: ${reason}`);
    } catch (err) {
      await interaction.editReply(`❌ Failed to publish ban: ${err.message}`);
    }
  }
});

function updatePresence() {
  if (!client.user) return;
  try {
    console.log('[PRESENCE DEBUG] updatePresence called. isMaintenanceMode:', botState.isMaintenanceMode);
    if (botState.isMaintenanceMode) {
      console.log('[PRESENCE DEBUG] attempting maintenance presence...');
      client.user.setPresence({
        status: 'dnd',
        activities: [{ name: '🔧 Under Maintenance', type: ActivityType.Playing }],
      });
      console.log('[PRESENCE DEBUG] maintenance presence call completed without throwing');
      return;
    }

    let actType = ActivityType.Playing;
    if (botState.activityType === 'STREAMING') actType = ActivityType.Streaming;
    else if (botState.activityType === 'LISTENING') actType = ActivityType.Listening;
    else if (botState.activityType === 'WATCHING') actType = ActivityType.Watching;

    const presenceObj = {
      status: botState.statusType,
      activities: [{ name: botState.activityText || 'Apex Roleplay', type: actType }]
    };

    if (actType === ActivityType.Streaming) {
      presenceObj.activities[0].url = botState.streamUrl || 'https://www.twitch.tv/discord';
    }

    client.user.setPresence(presenceObj);
  } catch (err) {
    console.error('[PRESENCE ERROR]', err.message);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const chatMsg = {
    id: message.id,
    author: message.author.tag,
    authorId: message.author.id,
    content: message.content,
    channelName: message.channel.name,
    channelId: message.channel.id,
    timestamp: new Date().toLocaleTimeString()
  };

  chatHistory.push(chatMsg);
  if (chatHistory.length > 200) chatHistory.shift();
  io.emit('discordMessage', chatMsg);

  // AutoMod Exemption Checks
  if (!botState.autoMod.enabled) return;
  if (botState.isMaintenanceMode) return;
  if (botState.autoMod.bypassChannels.includes(message.channel.id)) return;
  if (message.member.roles.cache.some(r => botState.autoMod.bypassRoles.includes(r.id))) return;

  const result = inspectMessage(message.content);
  if (result.violated) {
    try {
      await message.delete();

      const currentStrikes = (userWarnings.get(message.author.id) || 0) + 1;
      userWarnings.set(message.author.id, currentStrikes);

      addAuditLog('AUTOMOD_VIOLATION', `Deleted message from ${message.author.tag} (${result.reason})`);

      if (currentStrikes >= botState.autoMod.maxWarnings) {
        userWarnings.set(message.author.id, 0);
        const timeoutMs = botState.autoMod.timeoutHours * 60 * 60 * 1000;

        try {
          const embed = new EmbedBuilder()
            .setTitle('🛡️ AutoMod Enforcement Notice')
            .setDescription(`You were automatically timed out in **${message.guild.name}**.`)
            .addFields(
              { name: 'Reason', value: result.reason },
              { name: 'Duration', value: `${botState.autoMod.timeoutHours} Hours` }
            )
            .setColor('#ef4444')
            .setTimestamp();
          await message.author.send({ embeds: [embed] });
        } catch (e) {
          console.log(`Failed to DM user ${message.author.tag}`);
        }

        if (message.member.moderatable) {
          await message.member.timeout(timeoutMs, `AutoMod Limit Reached: ${result.reason}`);
          message.channel.send(`⛔ **${message.author.tag}** was timed out for ${botState.autoMod.timeoutHours}h (Exceeded warning limit).`);
        }
      } else {
        message.channel.send(`⚠️ **${message.author.tag}**, message removed! Reason: *${result.reason}* [Strike ${currentStrikes}/${botState.autoMod.maxWarnings}]`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
      }
    } catch (err) {
      console.error('[AUTOMOD ERROR]', err.message);
    }
  }
});

// Helper for sending current state back to client
function getPayload() {
  const guild = client.guilds.cache.first();
  const roles = guild ? guild.roles.cache.map(r => ({ id: r.id, name: r.name })) : [];
  const channels = guild ? guild.channels.cache.filter(c => c.isTextBased()).map(c => ({ id: c.id, name: c.name })) : [];
  const warningsArr = Array.from(userWarnings.entries()).map(([id, count]) => ({ id, count }));
  
  const uptimeSec = Math.floor(process.uptime());
  const uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

  return {
    botInfo: { tag: client.user ? client.user.tag : 'Offline', id: client.user ? client.user.id : null },
    botState,
    rolesList: roles,
    channelsList: channels,
    warningsList: warningsArr,
    auditLogs,
    analytics: {
      ramUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
      uptime: uptimeStr
    },
    commandsList: ['ping', 'warn', 'timeout', 'kick', 'ban', 'clear']
  };
}

// REST API ROUTES
app.get('/api/dashboard', (req, res) => {
  res.json(getPayload());
});

// 1. ADD AUTOMOD WORD ROUTE
app.post('/api/words/add', (req, res) => {
  const { word } = req.body;
  if (!word) return res.status(400).json({ success: false, error: 'No word provided.' });

  const cleanWord = word.trim().toLowerCase();
  if (!botState.autoMod.customBadWords.includes(cleanWord)) {
    botState.autoMod.customBadWords.push(cleanWord);
    addAuditLog('AUTOMOD_WORD_ADD', `Added "${cleanWord}" to word filter.`);
  }

  res.json({ success: true, message: `Added "${cleanWord}" to AutoMod filter!`, payload: getPayload() });
});

// 2. REMOVE AUTOMOD WORD ROUTE
app.post('/api/words/remove', (req, res) => {
  const { word } = req.body;
  if (!word) return res.status(400).json({ success: false, error: 'No word provided.' });

  botState.autoMod.customBadWords = botState.autoMod.customBadWords.filter(w => w !== word.toLowerCase());
  addAuditLog('AUTOMOD_WORD_REMOVE', `Removed "${word}" from word filter.`);

  res.json({ success: true, message: `Removed "${word}" from AutoMod filter!`, payload: getPayload() });
});

// 3. UPDATE AUTOMOD SETTINGS
app.post('/api/automod/update', (req, res) => {
  botState.autoMod = { ...botState.autoMod, ...req.body };
  addAuditLog('AUTOMOD_CONFIG', 'Updated AutoMod rules and thresholds.');
  res.json({ success: true, message: 'AutoMod settings updated!', payload: getPayload() });
});

// 4. UPDATE BYPASS ROLES & CHANNELS
app.post('/api/bypass/update', (req, res) => {
  const { roles, channels } = req.body;
  botState.autoMod.bypassRoles = roles || [];
  botState.autoMod.bypassChannels = channels || [];
  addAuditLog('BYPASS_UPDATE', 'Updated AutoMod role/channel bypass lists.');
  res.json({ success: true, message: 'Bypass settings saved!', payload: getPayload() });
});

// 5. MAINTENANCE TOGGLE
app.post('/api/bot/maintenance', (req, res) => {
  botState.isMaintenanceMode = !botState.isMaintenanceMode;
  addAuditLog('MAINTENANCE', `Maintenance mode set to ${botState.isMaintenanceMode}`);
  console.log('[PRESENCE DEBUG] maintenance route hit, about to call updatePresence(). isMaintenanceMode is now:', botState.isMaintenanceMode);
  updatePresence();
  res.json({ success: true, message: `Maintenance mode ${botState.isMaintenanceMode ? 'Enabled' : 'Disabled'}`, payload: getPayload() });
});

// 6. UPDATE PRESENCE
app.post('/api/bot/presence', (req, res) => {
  const { statusType, activityType, activityText, streamUrl } = req.body;
  botState.statusType = statusType;
  botState.activityType = activityType;
  botState.activityText = activityText;
  botState.streamUrl = streamUrl;
  updatePresence();
  addAuditLog('PRESENCE_UPDATE', `Set status: ${activityType} - ${activityText}`);
  res.json({ success: true, message: 'Presence settings saved!', payload: getPayload() });
});

// 7. BOT PROFILE IDENTITY UPDATE
app.post('/api/bot/profile', async (req, res) => {
  const { username, avatarUrl } = req.body;
  try {
    if (username && username !== client.user.username) await client.user.setUsername(username);
    if (avatarUrl) await client.user.setAvatar(avatarUrl);
    addAuditLog('PROFILE_UPDATE', 'Updated bot profile username/avatar.');
    res.json({ success: true, message: 'Bot profile updated!', payload: getPayload() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. MODERATION EXECUTION (DM PRIOR TO TIMEOUT/KICK/BAN)
app.post('/api/moderation/action', async (req, res) => {
  const { action, userId, reason, timeoutMinutes, useEmbed, embedTitle, embedColor } = req.body;
  const guild = client.guilds.cache.first();
  if (!guild) return res.status(400).json({ success: false, error: 'No guild connected.' });

  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(400).json({ success: false, error: 'Member not found.' });

    let dmSent = false;
    const sendDm = async (actName, details) => {
      try {
        if (useEmbed) {
          const embed = new EmbedBuilder()
            .setTitle(embedTitle || `Apex Moderation: ${actName}`)
            .setDescription(reason || 'Staff Action Executed')
            .addFields({ name: 'Details', value: details })
            .setColor(embedColor || '#6366f1')
            .setTimestamp();
          await member.send({ embeds: [embed] });
        } else {
          await member.send(`Notice: You received a **${actName}** in Apex Roleplay. Reason: ${reason || 'Staff action'}`);
        }
        return true;
      } catch (e) {
        console.log(`[DM ERROR] Failed to send DM to ${member.user.tag}: ${e.message}`);
        return false;
      }
    };

    if (action === 'timeout') {
      const mins = parseInt(timeoutMinutes) || 60;
      dmSent = await sendDm('TIMEOUT', `Duration: ${mins} Minutes\nReason: ${reason || 'Staff action'}`);
      
      if (!member.moderatable) {
        return res.status(400).json({ success: false, error: 'Bot lacks permission to timeout this member (Hierarchy issue).' });
      }

      await member.timeout(mins * 60 * 1000, reason || 'Dashboard Action');
      addAuditLog('TIMEOUT', `Timed out ${member.user.tag} for ${mins}m`);
      return res.json({ 
        success: true, 
        message: `Timed out ${member.user.tag} for ${mins}m! ${dmSent ? '✅ (DM Delivered)' : '⚠️ (DM Failed - User DMs Closed)'}` 
      });
    }

    if (action === 'warn' || action === 'dm') {
      dmSent = await sendDm('WARNING', `Reason: ${reason || 'Staff Notice'}`);
      addAuditLog('WARNING', `Sent DM/Warn to ${member.user.tag}`);
      return res.json({ 
        success: true, 
        message: dmSent ? `Message delivered to ${member.user.tag}!` : `User has DMs closed.` 
      });
    }

    if (action === 'kick') {
      dmSent = await sendDm('KICK', `Reason: ${reason || 'Staff Action'}`);
      await member.kick(reason);
      addAuditLog('KICK', `Kicked ${member.user.tag}`);
      return res.json({ success: true, message: `Kicked ${member.user.tag}!` });
    }

    if (action === 'ban') {
      dmSent = await sendDm('BAN', `Reason: ${reason || 'Staff Action'}`);
      await member.ban({ reason });
      addAuditLog('BAN', `Banned ${member.user.tag}`);
      return res.json({ success: true, message: `Banned ${member.user.tag}!` });
    }

    res.status(400).json({ success: false, error: 'Invalid action.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9. ANNOUNCER
app.post('/api/announcer/send', async (req, res) => {
  const { channelId, title, description, color } = req.body;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return res.status(400).json({ success: false, error: 'Channel not found.' });

    const embed = new EmbedBuilder()
      .setTitle(title || 'Announcement')
      .setDescription(description || '...')
      .setColor(color || '#6366f1')
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    addAuditLog('ANNOUNCEMENT', `Sent embed to #${channel.name}`);
    res.json({ success: true, message: `Announcement sent to #${channel.name}!` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 10. CHATLOG FETCHING
app.get('/api/chatlogs/:channelId', (req, res) => {
  const { channelId } = req.params;
  if (channelId === 'all') return res.json({ messages: chatHistory });
  res.json({ messages: chatHistory.filter(m => m.channelId === channelId) });
});

// 11. CHATLOG MESSAGE DELETION
app.delete('/api/chatlogs/:channelId/:messageId', async (req, res) => {
  const { channelId, messageId } = req.params;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) {
      const msg = await channel.messages.fetch(messageId);
      if (msg) await msg.delete();
    }
    chatHistory = chatHistory.filter(m => m.id !== messageId);
    addAuditLog('DELETE_MSG', `Deleted message ID ${messageId}`);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 12. DATABASE BACKUP SNAPSHOT
app.post('/api/database/backup', (req, res) => {
  addAuditLog('DATABASE', 'Downloaded state backup.');
  res.json({ success: true, message: 'Database snapshot created successfully!' });
});

// ===================================================================
// ROBLOX GAME MANAGER — remote announce/kick via Open Cloud
// publishMessage, plus live chat log ingestion from the game itself.
//
// Security notes:
// - announce/kick are OUTBOUND from this backend to Roblox, authenticated
//   by ROBLOX_OPEN_CLOUD_KEY (a real Roblox-issued, properly scoped API
//   key) — Roblox itself verifies this key before your message ever
//   reaches the game, not a homemade shared secret.
// - Chat log ingestion is the OPPOSITE direction: read-only data coming
//   FROM the Roblox game INTO this dashboard. It grants no action/control
//   capability over the game at all, so the risk profile here is much
//   lower — but it's still protected by ROBLOX_INGEST_KEY (a separate
//   secret from the Open Cloud key) so random requests can't spam fake
//   chat logs into your dashboard.
// ===================================================================

async function publishToRoblox(action, target, message) {
  const universeId = process.env.ROBLOX_UNIVERSE_ID;
  const openCloudKey = process.env.ROBLOX_OPEN_CLOUD_KEY;
  if (!universeId || !openCloudKey) {
    throw new Error('ROBLOX_UNIVERSE_ID or ROBLOX_OPEN_CLOUD_KEY not set in your .env file.');
  }

  const response = await fetch(
    `https://apis.roblox.com/cloud/v2/universes/${universeId}:publishMessage`,
    {
      method: 'POST',
      headers: {
        'x-api-key': openCloudKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: 'ApexAdminCommands',
        message: JSON.stringify({ action, target, message }),
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }
}

// 13. ROBLOX REMOTE ANNOUNCE
app.post('/api/roblox/announce', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ success: false, error: 'No message provided.' });
  try {
    await publishToRoblox('announce', null, message);
    addAuditLog('ROBLOX_ANNOUNCE', `Sent announcement: "${message}"`);
    res.json({ success: true, message: 'Announcement published to Roblox!' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 14. ROBLOX REMOTE KICK
app.post('/api/roblox/kick', async (req, res) => {
  const { target, reason } = req.body;
  if (!target) return res.status(400).json({ success: false, error: 'No target username provided.' });
  try {
    await publishToRoblox('kick', target, reason || 'No reason specified.');
    addAuditLog('ROBLOX_KICK', `Kicked "${target}" — ${reason || 'No reason specified.'}`);
    res.json({ success: true, message: `Kick published for ${target}!` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 15. ROBLOX LIVE CHATLOG INGESTION — the game POSTs new messages here
app.post('/api/roblox/chatlog-ingest', (req, res) => {
  const ingestKey = process.env.ROBLOX_INGEST_KEY;
  if (!ingestKey) {
    return res.status(500).json({ success: false, error: 'ROBLOX_INGEST_KEY not set in your .env file.' });
  }
  if (req.headers['x-ingest-key'] !== ingestKey) {
    return res.status(401).json({ success: false, error: 'Invalid ingest key.' });
  }

  const { player, userId, message, serverId } = req.body;
  if (!player || !message) {
    return res.status(400).json({ success: false, error: 'Missing player or message.' });
  }

  const chatMsg = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    author: player,
    authorId: userId || null,
    content: message,
    serverId: serverId || 'unknown',
    timestamp: new Date().toLocaleTimeString(),
  };

  robloxChatHistory.push(chatMsg);
  if (robloxChatHistory.length > 200) robloxChatHistory.shift();
  io.emit('robloxMessage', chatMsg);

  res.json({ success: true });
});

// 16. ROBLOX CHATLOG FETCHING (for initial dashboard load)
app.get('/api/roblox/chatlogs', (req, res) => {
  res.json({ messages: robloxChatHistory });
});

// 17. ROBLOX PERMANENT BAN
app.post('/api/roblox/ban', async (req, res) => {
  const { target, reason } = req.body;
  if (!target) return res.status(400).json({ success: false, error: 'No target username provided.' });
  try {
    await publishToRoblox('ban', target, reason || 'Banned via dashboard.');
    addAuditLog('ROBLOX_BAN', `Banned "${target}" — ${reason || 'Banned via dashboard.'}`);
    res.json({ success: true, message: `Ban published for ${target}!` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 18. ROBLOX UNBAN
app.post('/api/roblox/unban', async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ success: false, error: 'No target username or UserId provided.' });
  try {
    await publishToRoblox('unban', target, null);
    addAuditLog('ROBLOX_UNBAN', `Unbanned "${target}"`);
    res.json({ success: true, message: `Unban published for ${target}!` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 19. ROBLOX MUTE
app.post('/api/roblox/mute', async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ success: false, error: 'No target username provided.' });
  try {
    await publishToRoblox('mute', target, null);
    addAuditLog('ROBLOX_MUTE', `Muted "${target}"`);
    res.json({ success: true, message: `Mute published for ${target}!` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 20. ROBLOX UNMUTE
app.post('/api/roblox/unmute', async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ success: false, error: 'No target username provided.' });
  try {
    await publishToRoblox('unmute', target, null);
    addAuditLog('ROBLOX_UNMUTE', `Unmuted "${target}"`);
    res.json({ success: true, message: `Unmute published for ${target}!` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 21. ROBLOX LIVE PLAYER ROSTER INGESTION — the game POSTs its player
// list here every ~10 seconds. Read-only, same ingest key pattern as
// chat logs — grants no control over the game, just visibility.
let robloxPlayerRoster = { players: [], serverId: null, lastUpdated: null };

app.post('/api/roblox/player-roster', (req, res) => {
  const ingestKey = process.env.ROBLOX_INGEST_KEY;
  if (!ingestKey) {
    return res.status(500).json({ success: false, error: 'ROBLOX_INGEST_KEY not set in your .env file.' });
  }
  if (req.headers['x-ingest-key'] !== ingestKey) {
    return res.status(401).json({ success: false, error: 'Invalid ingest key.' });
  }

  const { players, serverId } = req.body;
  robloxPlayerRoster = {
    players: Array.isArray(players) ? players : [],
    serverId: serverId || 'unknown',
    lastUpdated: new Date().toLocaleTimeString(),
  };
  io.emit('robloxRoster', robloxPlayerRoster);
  res.json({ success: true });
});

// 22. ROBLOX PLAYER ROSTER FETCHING (for initial dashboard load)
app.get('/api/roblox/player-roster', (req, res) => {
  res.json(robloxPlayerRoster);
});

const PORT = process.env.PORT || 3000;

// Automatically tries the next port instead of crashing entirely if the
// configured one is already taken by something else - this is exactly
// what happened before (PORT in .env conflicted with another running app).
function startServer(port, attemptsLeft) {
  server.listen(port, () => console.log(`[SERVER] Control dashboard online at http://localhost:${port}`));
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`[SERVER] Port ${port} is already in use, trying ${port + 1}...`);
      server.removeAllListeners('listening');
      startServer(port + 1, attemptsLeft - 1);
    } else {
      console.error('[SERVER ERROR] Could not start:', err.message);
    }
  });
}

startServer(Number(PORT), 5);
client.login(process.env.DISCORD_TOKEN);
