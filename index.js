require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  EmbedBuilder, 
  PermissionFlagsBits, 
  ActivityType,
  REST,
  Routes,
} = require('discord.js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Public appeal-response page — same static HTML for any slug, the page's
// own JS reads the slug out of the URL and fetches the right form.
app.get('/appeal/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'appeal.html'));
});

// Direct-navigation dashboard tab URLs (e.g. /livechat, /moderation) — all
// serve the same index.html; the page's own JS reads the path and opens
// the matching tab. Keeps a normal page refresh / typed URL / shared link
// landing on the right tab instead of always resetting to the Dashboard.
const DASHBOARD_TAB_SLUGS = [
  'dashboard', 'livechat', 'automod', 'moderation', 'remotemod', 'gamemanager',
  'bypasses', 'analytics', 'audit', 'logging', 'welcome', 'commands', 'announcer', 'economy',
  'tickets', 'database', 'webhooks', 'developer', 'landingpage', 'joinroles',
  'applications', 'appeals', 'staffmanagement', 'bindings', 'groupmanager', 'loa'
];
DASHBOARD_TAB_SLUGS.forEach(slug => {
  app.get(`/${slug}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
});

const server = http.createServer(app);
const io = new Server(server);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
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
    customBadWords: [
      // Exploiting / cheating
      'exploit', 'exploiting', 'hack', 'hacking', 'hacker', 'aimbot', 'autoclicker',
      'auto clicker', 'cheat engine', 'cheating', 'script kiddie', 'inject', 'injector',
      'dll injection', 'wallhack', 'speedhack', 'fly hack', 'noclip exploit',
      'dupe glitch', 'duplication glitch', 'esp hack',
      // Scams / phishing / account theft
      'free robux', 'robux generator', 'robux scam', 'gift card scam', 'nitro scam',
      'free nitro', 'account generator', 'password grabber', 'phishing link',
      'fake giveaway', 'giveaway scam', 'steal account', 'account theft', 'ip grabber',
      'ip logger', 'grabify', 'doxx', 'dox', 'swat you', 'swatting',
      // Self-harm harassment bait — telling someone to hurt themselves
      'kys', 'kill yourself', 'kill urself', 'end your life', 'go die', 'off yourself',
      'unalive yourself', 'neck yourself', 'rope yourself', 'cut yourself',
      // Predatory / grooming red flags
      'send pics', 'add me on snap', 'whats your age', 'how old are you dm',
      'meet up irl', 'add my snapchat', 'private chat with me',
      'dont tell your parents', 'keep this secret', 'our little secret',
      // Raid / harassment coordination
      'raid this server', 'mass report', 'brigade', 'brigading', 'ddos',
      'nuke the server', 'spam raid', 'join my raid', 'raid party',
      'coordinated harassment',
      // Toxicity / low-effort harassment fillers
      'touch grass', 'ratio', 'cope harder', 'skill issue', 'ur trash',
      'uninstall the game', 'get good scrub', 'cry about it', 'mald', 'seethe',
      // Real-money-trading / economy abuse
      'rmt', 'real money trading', 'sell robux', 'buy robux cheap',
      'limited item scam', 'trade scam', 'middleman scam', 'item duplication',
      'robux hack', 'unlimited robux',
      // Spam / unsolicited ads
      'join my discord', 'sub 4 sub', 'subscribe to my', 'check out my channel',
      'dm to order', 'selling accounts', 'buy followers', 'view bot', 'self bot',
      'token grabber'
    ],
    bypassRoles: [],
    bypassChannels: [],
    roastTargets: [] // Discord user IDs who get a savage roast instead of the normal strike message
  },
  economy: {
    enabled: true,
    startingBalance: 500,
    dailyReward: 100,
    currencyName: 'coins',
    shopPrices: {} // itemId -> price override; falls back to each item's default price when unset
  },
  gifResponder: {
    enabled: true,
    targetUserId: '1117598669013786665', // Jackluke010798
    gifUrl: '' // set this from the AutoMod tab — a direct GIF link or a Tenor/Giphy page link
  },
  logging: {
    enabled: false,
    channelId: null,
    events: {
      messageDelete: true,
      messageEdit: true,
      memberJoin: true,
      memberLeave: true,
      memberBan: true,
      memberUnban: true,
      roleCreate: true,
      roleDelete: true,
      channelCreate: true,
      channelDelete: true
    }
  },
  welcome: {
    enabled: false,
    channelId: null,
    autoRoleId: null,
    joinMessage: 'Welcome {user} to {server}! We now have {membercount} members.',
    leaveEnabled: true,
    leaveMessage: '{username} has left {server}.'
  }
};

const HARDCODED_PROFANITY = [
  'nigger', 'nigga', 'faggot', 'kike', 'chink', 'cunt', 'whore', 'slut', 'bastard', 'retard'
];

// Savage-but-harmless roast lines for the AutoMod "Roast Targets" feature.
// Keep these playful, not genuinely hateful — no slurs, no attacks on
// protected characteristics, just classic exaggerated roast-comedy.
const ROAST_LINES = [
  "did the automod really have to stop you from embarrassing yourself further? mercy.",
  "bro really typed that with confidence 💀",
  "not you getting caught by a bot with a word list from 2015",
  "imagine getting filtered. couldn't be me. couldn't be most people actually.",
  "the AI thinks faster than you type, and that's genuinely concerning for you",
  "certified L moment. get filtered, get humbled.",
  "you had one job: don't say the banned word. you failed spectacularly.",
  "this is the equivalent of tripping over a curb in front of your crush",
  "the bot deleted that faster than your last three relationships",
  "sir/ma'am this is a Wendy's, not a place to say unhinged things",
  "even autocorrect wouldn't save that sentence",
  "you set the bar so low a rollerskate could clear it",
  "someone check on this man, he just lost a fight with a chat filter",
  "legendary. truly the main character of getting owned by software.",
  "that message had main character energy but villain-arc consequences",
  "the AutoMod really said 'not today' and meant it",
  "bro's out here speedrunning a timeout",
  "this you? because the logs say this is absolutely you",
  "ratio + you got filtered + that's embarrassing",
  "the bot has more rizz than that sentence did",
  "certified chat-crime. do not pass go, do not collect 200 robux.",
  "that was a bold strategy, let's see if it works out for the ban list",
  "you played yourself, then the bot played you too",
  "history will remember this message. unfortunately, so will the audit log.",
  "skill issue. filter issue. word choice issue. it's all issues.",
  "the bot really said 'absolutely not' with its whole chest",
  "we've all made mistakes but wow, this one's framed and on the wall",
  "that's not rizz, that's a rules violation with extra steps",
  "somewhere a moderator felt a great disturbance in the force",
  "10/10 confidence, -10/10 execution"
];

// Bigger general-purpose roast pool for the manual "Roast Them" button —
// not tied to AutoMod context, just savage-but-playful insult comedy.
const MANUAL_ROAST_LINES = [
  "you have the rizz of a expired parking ticket",
  "certified NPC behavior, and not even the interesting kind",
  "if confidence was currency you'd still be in debt",
  "the main character energy of a background extra",
  "you're the reason the tutorial has extra steps",
  "built like a participation trophy",
  "your personality has a loading screen that never finishes",
  "you bring the same energy as a Wi-Fi signal with one bar",
  "the human equivalent of a buffering icon",
  "you peaked the moment you joined this server, it's been downhill since",
  "if being average was a sport you'd still finish 2nd",
  "you have main-character delusions and side-character results",
  "the type to trip on flat ground and blame the ground",
  "certified L rizz, W denial",
  "you're proof that not everyone gets a redemption arc",
  "the energy of a phone at 1% brightness in direct sunlight",
  "you're not the plot twist, you're the filler episode",
  "history's greatest example of unearned confidence",
  "you have the aura of a participation sticker",
  "even your shadow is embarrassed to be seen with you",
  "the human version of a 404 error — something's clearly missing",
  "you're what happens when the tutorial boss becomes playable",
  "certified extra in your own story",
  "you bring nothing to the table but somehow still pull up a chair",
  "the audacity is impressive, the results less so"
];

// ===================================================================
// LIVE CHAT PERSISTENCE — chatHistory is saved to disk so it survives
// a bot restart, not just a browser refresh. Cleared only via the
// "Clear Log" button on the dashboard (or deleting the file by hand).
// ===================================================================
const DATA_DIR = path.join(__dirname, 'data');
const CHAT_LOG_FILE = path.join(DATA_DIR, 'chatlog.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let chatHistory = [];
try {
  if (fs.existsSync(CHAT_LOG_FILE)) {
    chatHistory = JSON.parse(fs.readFileSync(CHAT_LOG_FILE, 'utf8'));
    console.log(`[CHATLOG] Loaded ${chatHistory.length} saved message(s) from disk.`);
  }
} catch (err) {
  console.error('[CHATLOG] Failed to load saved chat log, starting fresh:', err.message);
  chatHistory = [];
}

function saveChatHistory() {
  try {
    fs.writeFileSync(CHAT_LOG_FILE, JSON.stringify(chatHistory));
  } catch (err) {
    console.error('[CHATLOG] Failed to save chat log to disk:', err.message);
  }
}

// ===================================================================
// APPEALS — staff build a form (title, description, custom questions),
// publish it, and get a shareable /appeal/<slug> URL anyone can visit
// to submit a response. Forms + responses persist to disk.
// ===================================================================
const APPEALS_FILE = path.join(DATA_DIR, 'appeals.json');

let appealForms = [];
let appealResponses = [];
try {
  if (fs.existsSync(APPEALS_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(APPEALS_FILE, 'utf8'));
    appealForms = loaded.forms || [];
    appealResponses = loaded.responses || [];
    console.log(`[APPEALS] Loaded ${appealForms.length} form(s) and ${appealResponses.length} response(s) from disk.`);
  }
} catch (err) {
  console.error('[APPEALS] Failed to load saved appeals, starting fresh:', err.message);
}

function saveAppeals() {
  try {
    fs.writeFileSync(APPEALS_FILE, JSON.stringify({ forms: appealForms, responses: appealResponses }));
  } catch (err) {
    console.error('[APPEALS] Failed to save appeals to disk:', err.message);
  }
}

function slugify(title) {
  const base = (title || 'appeal')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'appeal';
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

// ===================================================================
// ECONOMY — virtual currency game. /work and /daily earn it legitimately,
// /rob is a themed "hack their wallet" steal-from-another-player command
// with a cooldown, a success/fail chance, and a penalty on failure.
// All of this is fictional in-bot currency, not real money.
// ===================================================================
const ECONOMY_FILE = path.join(DATA_DIR, 'economy.json');

let economyBalances = {};   // { userId: number }
let economyCooldowns = {};  // { userId: { rob: ts, work: ts, daily: ts, steal: ts } }
let economyShields = {};    // { userId: number } — protection charges bought from the shop

try {
  if (fs.existsSync(ECONOMY_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(ECONOMY_FILE, 'utf8'));
    economyBalances = loaded.balances || {};
    economyCooldowns = loaded.cooldowns || {};
    economyShields = loaded.shields || {};
    console.log(`[ECONOMY] Loaded ${Object.keys(economyBalances).length} balance(s) from disk.`);
  }
} catch (err) {
  console.error('[ECONOMY] Failed to load saved economy data, starting fresh:', err.message);
}

function saveEconomy() {
  try {
    fs.writeFileSync(ECONOMY_FILE, JSON.stringify({ balances: economyBalances, cooldowns: economyCooldowns, shields: economyShields }));
  } catch (err) {
    console.error('[ECONOMY] Failed to save economy data to disk:', err.message);
  }
}

function getBalance(userId) {
  if (!(userId in economyBalances)) economyBalances[userId] = botState.economy.startingBalance;
  return economyBalances[userId];
}

function setBalance(userId, amount) {
  economyBalances[userId] = Math.max(0, Math.round(amount));
  saveEconomy();
}

function addBalance(userId, delta) {
  setBalance(userId, getBalance(userId) + delta);
}

function getShields(userId) {
  return economyShields[userId] || 0;
}

function addShields(userId, amount) {
  economyShields[userId] = Math.max(0, (economyShields[userId] || 0) + amount);
  saveEconomy();
}

// Consumes one shield charge if the user has any. Returns true if a charge
// was used (meaning an incoming rob/steal attempt should be blocked).
function useShieldCharge(userId) {
  if ((economyShields[userId] || 0) > 0) {
    economyShields[userId] -= 1;
    saveEconomy();
    return true;
  }
  return false;
}

function getCooldown(userId, type) {
  return (economyCooldowns[userId] && economyCooldowns[userId][type]) || 0;
}

function setCooldown(userId, type, ms) {
  if (!economyCooldowns[userId]) economyCooldowns[userId] = {};
  economyCooldowns[userId][type] = Date.now() + ms;
  saveEconomy();
}

function clearCooldown(userId, type) {
  if (economyCooldowns[userId]) {
    delete economyCooldowns[userId][type];
    saveEconomy();
  }
}

// ===================================================================
// LEAVE OF ABSENCE (LOA) SYSTEM
// Staff submit a request via /loa submit -> shows up on the dashboard's
// "LOA Requests" page for accept/decline -> DMs the user either way ->
// on approval, assigns an "On LOA" role and prefixes their nickname ->
// automatically reverts both once the end date passes.
// ===================================================================
const LOA_FILE = path.join(DATA_DIR, 'loa.json');

let loaRequests = [];
let loaRoleId = null;

try {
  if (fs.existsSync(LOA_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(LOA_FILE, 'utf8'));
    loaRequests = loaded.requests || [];
    loaRoleId = loaded.roleId || null;
    console.log(`[LOA] Loaded ${loaRequests.length} request(s) from disk.`);
  }
} catch (err) {
  console.error('[LOA] Failed to load saved LOA data, starting fresh:', err.message);
}

function saveLoa() {
  try {
    fs.writeFileSync(LOA_FILE, JSON.stringify({ requests: loaRequests, roleId: loaRoleId }));
  } catch (err) {
    console.error('[LOA] Failed to save LOA data to disk:', err.message);
  }
}

const LOA_APPROVE_NOTES = [
  "Enjoy your time off — come back refreshed and more! 🌴",
  "Take all the time you need. We'll hold things down here!",
  "Approved! Rest up, we'll see you when you're back. 🙌",
  "Take care of yourself first — everything else can wait.",
  "Go recharge! We appreciate you letting us know in advance."
];

const LOA_DECLINE_NOTES = [
  "This request couldn't be approved as submitted — please reach out to leadership to discuss.",
  "We weren't able to approve this one — feel free to message a senior staff member for details.",
  "This request needs a bit more info — please follow up with the team directly.",
  "Unable to approve at this time — reach out to an admin if you'd like to discuss further."
];

// Optional: if ANTHROPIC_API_KEY is set in .env, this cleans up the staff
// member's raw reason into a short, neutral one-liner for reviewers.
// Entirely optional — if no key is set, the dashboard just shows their
// original text with no AI step at all.
async function summarizeLoaReason(reason) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `Rewrite this staff member's leave-of-absence reason as one short, neutral, professional sentence for a moderator reviewing the request. Don't add judgments or make anything up beyond what's written. Just the sentence, nothing else.\n\nReason: "${reason}"`
        }]
      })
    });
    if (!response.ok) {
      console.error('[LOA AI] Anthropic API returned', response.status);
      return null;
    }
    const data = await response.json();
    const text = data.content && data.content[0] && data.content[0].text;
    return text ? text.trim() : null;
  } catch (err) {
    console.error('[LOA AI] Summarization failed:', err.message);
    return null;
  }
}

async function submitLoaRequest({ userId, userTag, startDate, endDate, reason }) {
  const reasonSummary = await summarizeLoaReason(reason);
  const request = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId, userTag, startDate, endDate, reason, reasonSummary,
    status: 'pending',
    reviewedBy: null,
    reviewNote: null,
    originalNickname: null,
    submittedAt: Date.now(),
    reviewedAt: null,
    revertedAt: null
  };
  loaRequests.unshift(request);
  saveLoa();
  addAuditLog('LOA_SUBMITTED', `${userTag} submitted an LOA request (${startDate} → ${endDate})`);
  return request;
}

async function getOrCreateLoaRole(guild) {
  if (loaRoleId) {
    const existing = guild.roles.cache.get(loaRoleId);
    if (existing) return existing;
  }
  const created = await guild.roles.create({
    name: 'On LOA',
    color: '#f59e0b',
    reason: 'Apex LOA system — auto-created'
  });
  loaRoleId = created.id;
  saveLoa();
  return created;
}

async function applyLoaApproval(request) {
  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('No guild connected.');
  const member = await guild.members.fetch(request.userId).catch(() => null);

  if (member) {
    try {
      const role = await getOrCreateLoaRole(guild);
      await member.roles.add(role);

      const originalNick = member.nickname || member.user.username;
      request.originalNickname = originalNick;
      let newNick = `[LOA] ${originalNick}`;
      if (newNick.length > 32) newNick = newNick.slice(0, 32);
      await member.setNickname(newNick).catch(err => console.log('[LOA] Could not set nickname (hierarchy?):', err.message));
    } catch (err) {
      console.error('[LOA] Failed to apply role/nickname:', err.message);
    }
  }

  const note = LOA_APPROVE_NOTES[Math.floor(Math.random() * LOA_APPROVE_NOTES.length)];
  request.status = 'approved';
  request.reviewNote = note;
  request.reviewedAt = Date.now();
  saveLoa();
  addAuditLog('LOA_APPROVED', `Approved LOA for ${request.userTag} (${request.startDate} → ${request.endDate})`);

  if (member) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('✅ LOA Request Approved')
        .setDescription(`Your leave of absence from **${request.startDate}** to **${request.endDate}** has been approved.`)
        .addFields({ name: 'Note from staff', value: note })
        .setColor('#10b981')
        .setTimestamp();
      await member.send({ embeds: [embed] });
    } catch (e) { /* DMs closed */ }
  }
}

async function applyLoaDecline(request) {
  const guild = client.guilds.cache.first();
  const member = guild ? await guild.members.fetch(request.userId).catch(() => null) : null;

  const note = LOA_DECLINE_NOTES[Math.floor(Math.random() * LOA_DECLINE_NOTES.length)];
  request.status = 'declined';
  request.reviewNote = note;
  request.reviewedAt = Date.now();
  saveLoa();
  addAuditLog('LOA_DECLINED', `Declined LOA for ${request.userTag} (${request.startDate} → ${request.endDate})`);

  if (member) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('❌ LOA Request Declined')
        .setDescription(`Your leave of absence request from **${request.startDate}** to **${request.endDate}** was not approved.`)
        .addFields({ name: 'Note from staff', value: note })
        .setColor('#ef4444')
        .setTimestamp();
      await member.send({ embeds: [embed] });
    } catch (e) { /* DMs closed */ }
  }
}

// Reverts the role/nickname for any approved LOA whose end date has passed.
// Runs on a timer plus once shortly after startup (to catch anything that
// expired while the bot was offline).
async function revertExpiredLoas() {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;

  for (const request of loaRequests) {
    if (request.status !== 'approved' || request.endDate > today) continue;

    const member = await guild.members.fetch(request.userId).catch(() => null);
    if (member) {
      try {
        if (loaRoleId) {
          const role = guild.roles.cache.get(loaRoleId);
          if (role) await member.roles.remove(role).catch(() => {});
        }
        if (request.originalNickname) {
          await member.setNickname(request.originalNickname).catch(() => {});
        }
        await member.send({
          embeds: [new EmbedBuilder().setTitle('👋 Welcome Back!').setDescription('Your leave of absence period has ended — welcome back!').setColor('#3b82f6')]
        }).catch(() => {});
      } catch (err) {
        console.error('[LOA] Failed to revert for', request.userTag, ':', err.message);
      }
    }

    request.status = 'completed';
    request.revertedAt = Date.now();
    addAuditLog('LOA_COMPLETED', `LOA ended for ${request.userTag} — role/nickname reverted.`);
    changed = true;
  }

  if (changed) saveLoa();
}

let robloxChatHistory = [];
let userWarnings = new Map();
let auditLogs = [];
let botOnline = false;

function broadcastBotStatus() {
  io.emit('botStatus', { online: botOnline, tag: client.user ? client.user.tag : 'Offline' });
}

// ===================================================================
// UNIFIED MODERATION CENTER — tracks bans/mutes/warnings/kicks across
// both Discord and Roblox in one list, powering the "Moderation" tab.
// ===================================================================
let moderationActions = [];

function addModerationAction(record) {
  const action = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'active',
    timestamp: Date.now(),
    ...record
  };
  moderationActions.unshift(action);
  if (moderationActions.length > 500) moderationActions.pop();
  return action;
}

// Parses "5m", "1h", "7d" etc into milliseconds. Returns null for blank/invalid (permanent).
function parseDurationToMs(str) {
  if (!str) return null;
  const match = String(str).trim().match(/^(\d+)\s*(m|h|d)$/i);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 'm') return amount * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
  return null;
}

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
// SLASH COMMAND LOADER — pulls every command from the commands/ folder.
// Each file in commands/ can export either:
//   - a single { data, execute } object, or
//   - an array of { data, execute } objects (like fun.js / moderation.js)
// Add a new file to commands/ and it is picked up automatically on
// the next restart — nothing in this file needs to change.
// ===================================================================

client.commands = new Map();

function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  if (!fs.existsSync(commandsPath)) {
    console.warn('[COMMANDS] No commands/ folder found — skipping load.');
    return;
  }

  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    delete require.cache[require.resolve(path.join(commandsPath, file))];
    const loaded = require(path.join(commandsPath, file));
    const entries = Array.isArray(loaded) ? loaded : [loaded];

    for (const entry of entries) {
      if (!entry || !entry.data || typeof entry.execute !== 'function') {
        console.warn(`[COMMANDS] Skipped a malformed export in ${file} (missing data/execute).`);
        continue;
      }
      client.commands.set(entry.data.name, entry);
    }
  }

  console.log(`[COMMANDS] Loaded ${client.commands.size} command(s) from ${commandFiles.length} file(s): ${commandFiles.join(', ')}`);
}

async function registerSlashCommands() {
  const clientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID;
  if (!clientId) {
    console.warn('[SLASH COMMANDS] Neither DISCORD_CLIENT_ID nor CLIENT_ID set in .env - skipping registration.');
    return;
  }
  try {
    const body = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(clientId),
      { body }
    );
    console.log(`[SLASH COMMANDS] Registered ${body.length} command(s) (can take up to 1 hour to appear everywhere).`);
  } catch (err) {
    console.error('[SLASH COMMANDS ERROR]', err.message);
  }
}

client.once('ready', () => {
  console.log(`[BOT ENGINE] Logged in as ${client.user.tag}`);
  botOnline = true;
  updatePresence();
  addAuditLog('SYSTEM', `Bot Engine online as ${client.user.tag}`);
  loadCommands();
  registerSlashCommands();
  broadcastBotStatus();

  revertExpiredLoas().catch(err => console.error('[LOA] Startup revert check failed:', err.message));
  setInterval(() => {
    revertExpiredLoas().catch(err => console.error('[LOA] Scheduled revert check failed:', err.message));
  }, 30 * 60 * 1000);
});

client.on('shardDisconnect', () => {
  botOnline = false;
  addAuditLog('SYSTEM', 'Bot disconnected from Discord gateway.');
  broadcastBotStatus();
});

client.on('shardReconnecting', () => {
  botOnline = false;
  broadcastBotStatus();
});

client.on('shardResume', () => {
  botOnline = true;
  addAuditLog('SYSTEM', 'Bot reconnected to Discord gateway.');
  broadcastBotStatus();
});

client.on('error', (err) => {
  console.error('[CLIENT ERROR]', err.message);
  botOnline = false;
  broadcastBotStatus();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    return interaction.reply({ content: '❌ Unknown command (it may not be loaded — restart the bot).', ephemeral: true }).catch(() => {});
  }

  const ctx = {
    addAuditLog, userWarnings, botState, publishToRoblox,
    getBalance, setBalance, addBalance, getCooldown, setCooldown, clearCooldown,
    getAllBalances: () => economyBalances,
    getShields, addShields, useShieldCharge,
    submitLoaRequest
  };

  try {
    await command.execute(interaction, ctx);
  } catch (err) {
    console.error(`[COMMAND ERROR] /${interaction.commandName}:`, err);
    const payload = { content: `❌ Something went wrong running that command: ${err.message}`, ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
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

// ===================================================================
// LOGGING — full server event log posted to a configured channel.
// Each event type can be toggled independently from the Logging tab.
// ===================================================================

async function sendLogEvent(eventKey, embed) {
  if (!botState.logging.enabled) return;
  if (!botState.logging.events[eventKey]) return;
  if (!botState.logging.channelId) return;

  try {
    const channel = await client.channels.fetch(botState.logging.channelId).catch(() => null);
    if (!channel) return;
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[LOGGING] Failed to send log event:', err.message);
  }
}

client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message Deleted')
    .addFields(
      { name: 'Author', value: `${message.author?.tag || 'Unknown'} (${message.author?.id || '?'})` },
      { name: 'Channel', value: `<#${message.channel.id}>` },
      { name: 'Content', value: message.content ? message.content.slice(0, 1000) : '*(no cached content)*' }
    )
    .setColor('#ef4444')
    .setTimestamp();
  await sendLogEvent('messageDelete', embed);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return; // ignore embed-only updates, pins, etc.
  const embed = new EmbedBuilder()
    .setTitle('✏️ Message Edited')
    .addFields(
      { name: 'Author', value: `${newMessage.author?.tag || 'Unknown'} (${newMessage.author?.id || '?'})` },
      { name: 'Channel', value: `<#${newMessage.channel.id}>` },
      { name: 'Before', value: oldMessage.content ? oldMessage.content.slice(0, 500) : '*(no cached content)*' },
      { name: 'After', value: newMessage.content ? newMessage.content.slice(0, 500) : '*(empty)*' }
    )
    .setColor('#fbbf24')
    .setTimestamp();
  await sendLogEvent('messageEdit', embed);
});

function fillWelcomePlaceholders(template, member) {
  return (template || '')
    .replace(/{user}/g, `<@${member.id}>`)
    .replace(/{username}/g, member.user.username)
    .replace(/{server}/g, member.guild.name)
    .replace(/{membercount}/g, member.guild.memberCount);
}

client.on('guildMemberAdd', async (member) => {
  const embed = new EmbedBuilder()
    .setTitle('📥 Member Joined')
    .setDescription(`${member.user.tag} (${member.id})`)
    .addFields({ name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` })
    .setColor('#34d399')
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();
  await sendLogEvent('memberJoin', embed);

  // Welcome message + autorole
  if (botState.welcome.enabled && botState.welcome.channelId) {
    try {
      const channel = await client.channels.fetch(botState.welcome.channelId).catch(() => null);
      if (channel) await channel.send(fillWelcomePlaceholders(botState.welcome.joinMessage, member));
    } catch (err) {
      console.error('[WELCOME] Failed to send join message:', err.message);
    }
  }
  if (botState.welcome.autoRoleId) {
    try {
      await member.roles.add(botState.welcome.autoRoleId);
    } catch (err) {
      console.error('[WELCOME] Failed to assign autorole:', err.message);
    }
  }
});

client.on('guildMemberRemove', async (member) => {
  const embed = new EmbedBuilder()
    .setTitle('📤 Member Left')
    .setDescription(`${member.user.tag} (${member.id})`)
    .setColor('#9aa1ac')
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();
  await sendLogEvent('memberLeave', embed);

  if (botState.welcome.enabled && botState.welcome.leaveEnabled && botState.welcome.channelId) {
    try {
      const channel = await client.channels.fetch(botState.welcome.channelId).catch(() => null);
      if (channel) await channel.send(fillWelcomePlaceholders(botState.welcome.leaveMessage, member));
    } catch (err) {
      console.error('[WELCOME] Failed to send leave message:', err.message);
    }
  }
});

client.on('guildBanAdd', async (ban) => {
  const embed = new EmbedBuilder()
    .setTitle('🔨 Member Banned')
    .setDescription(`${ban.user.tag} (${ban.user.id})`)
    .setColor('#ef4444')
    .setTimestamp();
  await sendLogEvent('memberBan', embed);
});

client.on('guildBanRemove', async (ban) => {
  const embed = new EmbedBuilder()
    .setTitle('✅ Member Unbanned')
    .setDescription(`${ban.user.tag} (${ban.user.id})`)
    .setColor('#34d399')
    .setTimestamp();
  await sendLogEvent('memberUnban', embed);
});

client.on('roleCreate', async (role) => {
  const embed = new EmbedBuilder()
    .setTitle('➕ Role Created')
    .setDescription(`**${role.name}** (${role.id})`)
    .setColor('#4f8ef7')
    .setTimestamp();
  await sendLogEvent('roleCreate', embed);
});

client.on('roleDelete', async (role) => {
  const embed = new EmbedBuilder()
    .setTitle('➖ Role Deleted')
    .setDescription(`**${role.name}** (${role.id})`)
    .setColor('#ef4444')
    .setTimestamp();
  await sendLogEvent('roleDelete', embed);
});

client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder()
    .setTitle('➕ Channel Created')
    .setDescription(`**#${channel.name}** (${channel.id})`)
    .setColor('#4f8ef7')
    .setTimestamp();
  await sendLogEvent('channelCreate', embed);
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder()
    .setTitle('➖ Channel Deleted')
    .setDescription(`**#${channel.name}** (${channel.id})`)
    .setColor('#ef4444')
    .setTimestamp();
  await sendLogEvent('channelDelete', embed);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // GIF Responder — independent of AutoMod. Fires for a specific configured
  // user, in every channel, every message. Toggle with /gifresponder.
  if (
    botState.gifResponder.enabled &&
    botState.gifResponder.gifUrl &&
    message.author.id === botState.gifResponder.targetUserId
  ) {
    message.channel.send(botState.gifResponder.gifUrl).catch(err => console.error('[GIF RESPONDER] Failed to send:', err.message));
  }

  // Figure out up front whether this message would be flagged, so the
  // Live Chat feed can show it even though the message may get deleted
  // a moment later by the AutoMod block below.
  const isExempt = !botState.autoMod.enabled
    || botState.isMaintenanceMode
    || botState.autoMod.bypassChannels.includes(message.channel.id)
    || message.member.roles.cache.some(r => botState.autoMod.bypassRoles.includes(r.id));

  const precheck = isExempt ? { violated: false } : inspectMessage(message.content);

  const chatMsg = {
    id: message.id,
    author: message.author.tag,
    authorId: message.author.id,
    content: message.content,
    channelName: message.channel.name,
    channelId: message.channel.id,
    timestamp: new Date().toLocaleTimeString(),
    flagged: precheck.violated,
    flagReason: precheck.violated ? precheck.reason : null
  };

  chatHistory.push(chatMsg);
  saveChatHistory();
  io.emit('discordMessage', chatMsg);

  if (isExempt) return;

  const result = precheck;
  if (result.violated) {
    try {
      await message.delete();
      io.emit('discordMessageDeleted', { id: message.id, reason: result.reason });

      const currentStrikes = (userWarnings.get(message.author.id) || 0) + 1;
      userWarnings.set(message.author.id, currentStrikes);

      addAuditLog('AUTOMOD_VIOLATION', `Deleted message from ${message.author.tag} (${result.reason})`);

      const isRoastTarget = (botState.autoMod.roastTargets || []).includes(message.author.id);
      const roastLine = isRoastTarget ? ROAST_LINES[Math.floor(Math.random() * ROAST_LINES.length)] : null;

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
          if (isRoastTarget) {
            message.channel.send(`⛔ **${message.author.tag}** just got timed out for ${botState.autoMod.timeoutHours}h. ${roastLine}`);
          } else {
            message.channel.send(`⛔ **${message.author.tag}** was timed out for ${botState.autoMod.timeoutHours}h (Exceeded warning limit).`);
          }
        }
      } else if (isRoastTarget) {
        message.channel.send(`🔥 **${message.author.tag}** — ${roastLine}\n*(Strike ${currentStrikes}/${botState.autoMod.maxWarnings} — Reason: ${result.reason})*`)
          .then(m => setTimeout(() => m.delete().catch(() => {}), 15000));
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
    botInfo: { tag: client.user ? client.user.tag : 'Offline', id: client.user ? client.user.id : null, online: botOnline },
    botState,
    rolesList: roles,
    channelsList: channels,
    warningsList: warningsArr,
    auditLogs,
    analytics: {
      ramUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
      uptime: uptimeStr
    },
    commandsList: Array.from(client.commands.keys()).sort()
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

// 3B. UPDATE ECONOMY SETTINGS
app.post('/api/economy/update', (req, res) => {
  const { enabled, startingBalance, dailyReward, currencyName } = req.body;
  if (enabled !== undefined) botState.economy.enabled = !!enabled;
  if (startingBalance !== undefined) botState.economy.startingBalance = Math.max(0, parseInt(startingBalance) || 0);
  if (dailyReward !== undefined) botState.economy.dailyReward = Math.max(0, parseInt(dailyReward) || 0);
  if (currencyName !== undefined && currencyName.trim()) botState.economy.currencyName = currencyName.trim();
  addAuditLog('ECONOMY_CONFIG', 'Updated Economy settings.');
  res.json({ success: true, message: 'Economy settings saved!', payload: getPayload() });
});

// 3C. UPDATE GIF RESPONDER CONFIG
app.post('/api/gif-responder/update', (req, res) => {
  const { enabled, targetUserId, gifUrl } = req.body;
  if (enabled !== undefined) botState.gifResponder.enabled = !!enabled;
  if (targetUserId !== undefined && targetUserId.trim()) botState.gifResponder.targetUserId = targetUserId.trim();
  if (gifUrl !== undefined) botState.gifResponder.gifUrl = gifUrl.trim();
  addAuditLog('GIF_RESPONDER_CONFIG', 'Updated GIF Responder settings.');
  res.json({ success: true, message: 'GIF Responder settings saved!', payload: getPayload() });
});

// 3D. UPDATE LOGGING CONFIG
app.post('/api/logging/update', (req, res) => {
  const { enabled, channelId, events } = req.body;
  if (enabled !== undefined) botState.logging.enabled = !!enabled;
  if (channelId !== undefined) botState.logging.channelId = channelId || null;
  if (events !== undefined) botState.logging.events = { ...botState.logging.events, ...events };
  addAuditLog('LOGGING_CONFIG', 'Updated Logging settings.');
  res.json({ success: true, message: 'Logging settings saved!', payload: getPayload() });
});

// 3E. UPDATE WELCOME/GOODBYE CONFIG
app.post('/api/welcome/update', (req, res) => {
  const { enabled, channelId, autoRoleId, joinMessage, leaveEnabled, leaveMessage } = req.body;
  if (enabled !== undefined) botState.welcome.enabled = !!enabled;
  if (channelId !== undefined) botState.welcome.channelId = channelId || null;
  if (autoRoleId !== undefined) botState.welcome.autoRoleId = autoRoleId || null;
  if (joinMessage !== undefined) botState.welcome.joinMessage = joinMessage;
  if (leaveEnabled !== undefined) botState.welcome.leaveEnabled = !!leaveEnabled;
  if (leaveMessage !== undefined) botState.welcome.leaveMessage = leaveMessage;
  addAuditLog('WELCOME_CONFIG', 'Updated Welcome/Goodbye settings.');
  res.json({ success: true, message: 'Welcome settings saved!', payload: getPayload() });
});

// 4. UPDATE BYPASS ROLES & CHANNELS
app.post('/api/bypass/update', (req, res) => {
  const { roles, channels } = req.body;
  botState.autoMod.bypassRoles = roles || [];
  botState.autoMod.bypassChannels = channels || [];
  addAuditLog('BYPASS_UPDATE', 'Updated AutoMod role/channel bypass lists.');
  res.json({ success: true, message: 'Bypass settings saved!', payload: getPayload() });
});

// 4B. ADD ROAST TARGET
app.post('/api/automod/roast-targets/add', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: 'No Discord user ID provided.' });
  if (!/^\d+$/.test(userId)) return res.status(400).json({ success: false, error: 'That doesn\'t look like a valid Discord user ID.' });

  if (!botState.autoMod.roastTargets.includes(userId)) {
    botState.autoMod.roastTargets.push(userId);
  }

  // Try to resolve a tag for a nicer audit log line — non-fatal if it fails.
  let label = userId;
  try {
    const guild = client.guilds.cache.first();
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (member) label = member.user.tag;
  } catch (e) { /* ignore */ }

  addAuditLog('ROAST_TARGET_ADD', `Added ${label} to the AutoMod roast list.`);
  res.json({ success: true, message: `${label} will now get roasted instead of a boring warning!`, payload: getPayload() });
});

// 4C. REMOVE ROAST TARGET
app.post('/api/automod/roast-targets/remove', (req, res) => {
  const { userId } = req.body;
  botState.autoMod.roastTargets = botState.autoMod.roastTargets.filter(id => id !== userId);
  addAuditLog('ROAST_TARGET_REMOVE', `Removed user ID ${userId} from the AutoMod roast list.`);
  res.json({ success: true, message: 'Removed from roast list.', payload: getPayload() });
});

// 4D. SEND A ONE-OFF ROAST — pings the user in the chosen channel right now
app.post('/api/automod/send-roast', async (req, res) => {
  const { userId, channelId } = req.body;
  if (!userId || !channelId) return res.status(400).json({ success: false, error: 'Need both a user ID and a channel.' });

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return res.status(400).json({ success: false, error: 'Channel not found.' });

    const line = MANUAL_ROAST_LINES[Math.floor(Math.random() * MANUAL_ROAST_LINES.length)];
    await channel.send(`<@${userId}> ${line}`);

    addAuditLog('MANUAL_ROAST', `Sent a manual roast to user ID ${userId} in #${channel.name}`);
    res.json({ success: true, message: `Roasted! Sent to #${channel.name}.` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
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

// 10B. CLEAR CHATLOG BACKLOG
app.post('/api/chatlogs/clear', (req, res) => {
  chatHistory = [];
  saveChatHistory();
  addAuditLog('CHATLOG_CLEAR', 'Live Chat backlog cleared from dashboard.');
  res.json({ success: true, message: 'Live Chat log cleared!' });
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
    saveChatHistory();
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

// ===================================================================
// APPEALS ROUTES
// ===================================================================

const APPEAL_QUESTION_TYPES = ['short_text', 'long_text', 'dropdown'];

// 22B. LIST FORMS (admin)
app.get('/api/appeals/forms', (req, res) => {
  const forms = appealForms.map(f => ({
    ...f,
    responseCount: appealResponses.filter(r => r.formId === f.id).length
  }));
  res.json({ forms });
});

// 22C. CREATE FORM (admin)
app.post('/api/appeals/forms', (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'A title is required.' });

  const form = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description: description || '',
    slug: slugify(title),
    status: 'draft',
    questions: [],
    createdAt: Date.now()
  };
  appealForms.unshift(form);
  saveAppeals();
  addAuditLog('APPEAL_FORM_CREATE', `Created appeal form "${title}"`);
  res.json({ success: true, form });
});

// 22D. UPDATE FORM (admin) — title/description/questions/status
app.put('/api/appeals/forms/:id', (req, res) => {
  const form = appealForms.find(f => f.id === req.params.id);
  if (!form) return res.status(404).json({ success: false, error: 'Form not found.' });

  const { title, description, questions, status } = req.body;
  if (title !== undefined) form.title = title;
  if (description !== undefined) form.description = description;
  if (questions !== undefined) {
    if (!Array.isArray(questions)) return res.status(400).json({ success: false, error: 'Questions must be a list.' });
    for (const q of questions) {
      if (!APPEAL_QUESTION_TYPES.includes(q.type)) return res.status(400).json({ success: false, error: `Invalid question type: ${q.type}` });
    }
    form.questions = questions;
  }
  if (status !== undefined) {
    if (!['draft', 'published'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status.' });
    form.status = status;
  }

  saveAppeals();
  addAuditLog('APPEAL_FORM_UPDATE', `Updated appeal form "${form.title}" (${form.status})`);
  res.json({ success: true, form });
});

// 22E. DELETE FORM (admin) — also removes its responses
app.delete('/api/appeals/forms/:id', (req, res) => {
  const form = appealForms.find(f => f.id === req.params.id);
  if (!form) return res.status(404).json({ success: false, error: 'Form not found.' });

  appealForms = appealForms.filter(f => f.id !== req.params.id);
  appealResponses = appealResponses.filter(r => r.formId !== req.params.id);
  saveAppeals();
  addAuditLog('APPEAL_FORM_DELETE', `Deleted appeal form "${form.title}"`);
  res.json({ success: true });
});

// 22F. VIEW RESPONSES FOR A FORM (admin)
app.get('/api/appeals/forms/:id/responses', (req, res) => {
  const form = appealForms.find(f => f.id === req.params.id);
  if (!form) return res.status(404).json({ success: false, error: 'Form not found.' });
  const responses = appealResponses.filter(r => r.formId === req.params.id).sort((a, b) => b.submittedAt - a.submittedAt);
  res.json({ form, responses });
});

// 22G. PUBLIC — fetch a published form by slug (for the /appeal/:slug page)
app.get('/api/appeals/public/:slug', (req, res) => {
  const form = appealForms.find(f => f.slug === req.params.slug);
  if (!form) return res.status(404).json({ success: false, error: 'This appeal form does not exist.' });
  if (form.status !== 'published') return res.status(403).json({ success: false, error: 'This appeal form is not currently accepting responses.' });

  // Don't leak internal fields (id, createdAt) to the public page.
  res.json({ success: true, form: { title: form.title, description: form.description, slug: form.slug, questions: form.questions } });
});

// 22H. PUBLIC — submit a response
app.post('/api/appeals/public/:slug/submit', (req, res) => {
  const form = appealForms.find(f => f.slug === req.params.slug);
  if (!form) return res.status(404).json({ success: false, error: 'This appeal form does not exist.' });
  if (form.status !== 'published') return res.status(403).json({ success: false, error: 'This appeal form is not currently accepting responses.' });

  const { answers } = req.body;
  if (!answers || typeof answers !== 'object') return res.status(400).json({ success: false, error: 'No answers provided.' });

  for (const q of form.questions) {
    if (q.required && !String(answers[q.id] || '').trim()) {
      return res.status(400).json({ success: false, error: `"${q.label}" is required.` });
    }
  }

  const response = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    formId: form.id,
    answers,
    submittedAt: Date.now()
  };
  appealResponses.push(response);
  saveAppeals();
  addAuditLog('APPEAL_SUBMITTED', `New response submitted to "${form.title}"`);
  res.json({ success: true, message: 'Your appeal has been submitted!' });
});

// ===================================================================
// LOA ROUTES
// ===================================================================

// LIST ALL LOA REQUESTS (admin)
app.get('/api/loa/requests', (req, res) => {
  res.json({ requests: loaRequests });
});

// APPROVE A REQUEST
app.post('/api/loa/requests/:id/approve', async (req, res) => {
  const request = loaRequests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found.' });
  if (request.status !== 'pending') return res.status(400).json({ success: false, error: 'This request has already been reviewed.' });

  try {
    await applyLoaApproval(request);
    res.json({ success: true, message: `Approved ${request.userTag}'s LOA request!`, request });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DECLINE A REQUEST
app.post('/api/loa/requests/:id/decline', async (req, res) => {
  const request = loaRequests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found.' });
  if (request.status !== 'pending') return res.status(400).json({ success: false, error: 'This request has already been reviewed.' });

  try {
    await applyLoaDecline(request);
    res.json({ success: true, message: `Declined ${request.userTag}'s LOA request.`, request });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ===================================================================
// MODERATION CENTER ROUTES
// ===================================================================

// 23. MODERATION OVERVIEW (stats + filtered activity list)
app.get('/api/moderation/overview', (req, res) => {
  const platform = req.query.platform || 'all';
  const search = (req.query.search || '').toLowerCase();

  const stats = {
    bans: moderationActions.filter(a => a.type === 'ban' && a.status === 'active').length,
    mutes: moderationActions.filter(a => a.type === 'mute' && a.status === 'active').length,
    warnings: moderationActions.filter(a => a.type === 'warn' && a.status === 'active').length,
    kicks: moderationActions.filter(a => a.type === 'kick').length
  };

  let actions = moderationActions;
  if (platform !== 'all') actions = actions.filter(a => a.platform === platform);
  if (search) {
    actions = actions.filter(a =>
      (a.targetLabel || '').toLowerCase().includes(search) ||
      (a.target || '').toLowerCase().includes(search)
    );
  }

  res.json({ stats, actions });
});

// 24. CREATE MODERATION ACTION (ban/mute/warn/kick on discord or roblox)
app.post('/api/moderation/create', async (req, res) => {
  const { type, platform, target, reason, duration, evidence } = req.body;
  if (!target) return res.status(400).json({ success: false, error: 'No target provided.' });
  if (!['ban', 'mute', 'warn', 'kick'].includes(type)) return res.status(400).json({ success: false, error: 'Invalid action type.' });
  if (!['discord', 'roblox'].includes(platform)) return res.status(400).json({ success: false, error: 'Invalid platform.' });

  try {
    let targetLabel = target;

    if (platform === 'discord') {
      const guild = client.guilds.cache.first();
      if (!guild) return res.status(400).json({ success: false, error: 'No guild connected.' });
      const member = await guild.members.fetch(target).catch(() => null);
      if (!member) return res.status(400).json({ success: false, error: 'Discord member not found.' });
      targetLabel = member.user.tag;

      let dmSent = false;
      const sendDm = async (actionName, details) => {
        try {
          const embed = new EmbedBuilder()
            .setTitle(`🛡️ Apex Moderation: ${actionName}`)
            .setDescription(reason || 'Staff action executed.')
            .addFields({ name: 'Details', value: details })
            .setColor('#ef4444')
            .setTimestamp();
          await member.send({ embeds: [embed] });
          return true;
        } catch (e) {
          return false; // DMs closed — action still proceeds
        }
      };

      if (type === 'ban') {
        if (!member.bannable) return res.status(400).json({ success: false, error: 'Bot cannot ban this member (role hierarchy).' });
        dmSent = await sendDm('BAN', `Reason: ${reason || 'No reason provided.'}`); // sent BEFORE the ban — can't DM after removal
        await member.ban({ reason });
      } else if (type === 'kick') {
        if (!member.kickable) return res.status(400).json({ success: false, error: 'Bot cannot kick this member (role hierarchy).' });
        dmSent = await sendDm('KICK', `Reason: ${reason || 'No reason provided.'}`); // sent BEFORE the kick — can't DM after removal
        await member.kick(reason);
      } else if (type === 'mute') {
        if (!member.moderatable) return res.status(400).json({ success: false, error: 'Bot cannot timeout this member (role hierarchy).' });
        const ms = parseDurationToMs(duration) || (60 * 60 * 1000); // default 1h
        dmSent = await sendDm('MUTE / TIMEOUT', `Duration: ${duration || '1 hour (default)'}\nReason: ${reason || 'No reason provided.'}`);
        await member.timeout(ms, reason);
      } else if (type === 'warn') {
        const current = (userWarnings.get(target) || 0) + 1;
        userWarnings.set(target, current);
        dmSent = await sendDm('WARNING', `Reason: ${reason || 'No reason provided.'}`);
      }

      req._dmSent = dmSent; // stashed for the response message below
    } else {
      // Roblox — dispatched over MessagingService. warn has no native Roblox
      // equivalent, so it's logged here only (no in-game effect).
      if (type === 'ban') await publishToRoblox('ban', target, reason);
      else if (type === 'kick') await publishToRoblox('kick', target, reason);
      else if (type === 'mute') await publishToRoblox('mute', target, reason);
      // 'warn' on Roblox: no-op, log only.
    }

    const record = addModerationAction({ type, platform, target, targetLabel, reason, duration: duration || null, evidence: evidence || null, issuedBy: 'Dashboard' });
    addAuditLog(`MOD_${type.toUpperCase()}`, `${platform === 'discord' ? 'Discord' : 'Roblox'} ${type} issued to ${targetLabel} — ${reason || 'No reason'}`);

    const dmNote = platform === 'discord'
      ? (req._dmSent ? ' ✅ (DM delivered)' : ' ⚠️ (DM failed — user has DMs closed)')
      : '';
    res.json({ success: true, message: `${type[0].toUpperCase() + type.slice(1)} applied to ${targetLabel}!${dmNote}`, action: record });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 25. REVOKE MODERATION ACTION
app.delete('/api/moderation/actions/:id', async (req, res) => {
  const { id } = req.params;
  const action = moderationActions.find(a => a.id === id);
  if (!action) return res.status(404).json({ success: false, error: 'Action not found.' });
  if (action.status !== 'active') return res.status(400).json({ success: false, error: 'Action is already revoked.' });
  if (action.type === 'kick') return res.status(400).json({ success: false, error: 'Kicks cannot be revoked.' });

  try {
    if (action.platform === 'discord') {
      const guild = client.guilds.cache.first();
      if (!guild) return res.status(400).json({ success: false, error: 'No guild connected.' });

      if (action.type === 'ban') {
        await guild.members.unban(action.target).catch(() => {});
      } else if (action.type === 'mute') {
        const member = await guild.members.fetch(action.target).catch(() => null);
        if (member) await member.timeout(null).catch(() => {});
      }
      // 'warn' revocation is record-only, nothing to undo on Discord's side.
    } else {
      if (action.type === 'ban') await publishToRoblox('unban', action.target, null);
      else if (action.type === 'mute') await publishToRoblox('unmute', action.target, null);
    }

    action.status = 'revoked';
    addAuditLog(`MOD_REVOKE`, `Revoked ${action.type} on ${action.targetLabel} (${action.platform})`);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
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
