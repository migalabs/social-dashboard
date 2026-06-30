const { twitterApiGet } = require('./twitterApi');

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_TOP_LIMIT = 12;

const TREND_HALF_LIFE_HOURS = 48;
const TREND_DECAY_LAMBDA = Math.log(2) / TREND_HALF_LIFE_HOURS;

const ENGAGEMENT_WEIGHTS = {
  likes: 1,
  replies: 4,
  retweets: 3.5,
  quotes: 4,
  bookmarks: 4.5,
  impressions: 4,
};

const MOMENTUM_WEIGHTS = {
  volume: 0.35,
  engagement: 0.35,
  recency: 0.2,
  acceleration: 0.1,
};

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could',
  'did', 'do', 'does', 'doing', 'down', 'during',
  'each',
  'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just',
  'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'to', 'too',
  'under', 'until', 'up',
  'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'rt', 'im', 'amp', 'via', 'https', 'http', 'co', 'u', 'us',
]);

const CRYPTO_TOPIC_RULES = [
  {
    name: 'Ethereum protocol updates',
    keywords: [
      'ethereum',
      'eth',
      'protocol',
      'upgrade',
      'upgrades',
      'eip',
      'fork',
      'forks',
      'pectra',
      'dencun',
      'cancun',
      'deneb',
      'verkle',
      'proto-danksharding',
      'danksharding',
      'blob',
      'blobs',
      'EOF',
    ],
  },
  {
    name: 'Staking and validators',
    keywords: [
      'staking',
      'stake',
      'validator',
      'validators',
      'restaking',
      'slashing',
      'attestation',
      'attestations',
      'solo staking',
      'home staking',
      'lido',
      'rocketpool',
      'eigenlayer',
    ],
  },
  {
    name: 'Decentralization',
    keywords: [
      'decentralization',
      'decentralized',
      'censorship resistance',
      'censorship-resistance',
      'client diversity',
      'liveness',
      'neutrality',
      'permissionless',
      'self-custody',
      'self custody',
      'distributed',
      'solo stakers',
    ],
  },
  {
    name: 'Institutional ETH adoption',
    keywords: [
      'institutional',
      'institutions',
      'adoption',
      'etf',
      'spot etf',
      'blackrock',
      'fidelity',
      'treasury',
      'corporate treasury',
      'balance sheet',
      'fund',
      'funds',
      'allocations',
      'etp',
    ],
  },
  {
    name: 'Layer 2 ecosystem',
    keywords: [
      'layer 2',
      'layer2',
      'l2',
      'rollup',
      'rollups',
      'base',
      'arbitrum',
      'optimism',
      'zksync',
      'starknet',
      'scroll',
      'linea',
      'manta',
      'op stack',
      'superchain',
    ],
  },
  {
    name: 'Cybersecurity and blockchain infrastructure',
    keywords: [
      'cybersecurity',
      'security',
      'hack',
      'hacked',
      'exploit',
      'exploit',
      'audit',
      'audits',
      'bug bounty',
      'bridge',
      'bridges',
      'infrastructure',
      'infra',
      'node',
      'nodes',
      'rpc',
      'client',
      'clients',
      'relayer',
      'sequencer',
    ],
  },
];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeListId(input) {
  return String(input || '').trim();
}

function extractTweets(payload) {
  if (!payload) {
    return [];
  }

  const candidates = [
    payload.tweets,
    payload.data?.tweets,
    payload.data,
    payload.result?.tweets,
    payload.result,
    payload.items,
    payload,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function parseTweetDate(rawTweet) {
  const rawDate = rawTweet.created_at || rawTweet.createdAt || rawTweet.tweet_created_at || rawTweet.time;
  if (!rawDate) {
    return null;
  }
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractTweetText(rawTweet) {
  return String(rawTweet.full_text || rawTweet.text || rawTweet.note_tweet?.text || '').trim();
}

function extractEngagement(rawTweet) {
  const metrics = rawTweet.public_metrics || rawTweet.metrics || rawTweet.legacy || {};
  const likes = toNumber(metrics.like_count || rawTweet.like_count || rawTweet.likeCount || rawTweet.favorite_count, 0);
  const replies = toNumber(metrics.reply_count || rawTweet.reply_count || rawTweet.replyCount, 0);
  const retweets = toNumber(metrics.retweet_count || rawTweet.retweet_count || rawTweet.retweetCount, 0);
  const quotes = toNumber(metrics.quote_count || rawTweet.quote_count || rawTweet.quoteCount, 0);
  const bookmarks = toNumber(metrics.bookmark_count || rawTweet.bookmark_count || rawTweet.bookmarkCount, 0);
  const impressions = toNumber(
    metrics.impression_count || metrics.view_count || rawTweet.impression_count || rawTweet.view_count || rawTweet.viewCount,
    0
  );

  const weightedEngagement =
    likes * ENGAGEMENT_WEIGHTS.likes +
    replies * ENGAGEMENT_WEIGHTS.replies +
    retweets * ENGAGEMENT_WEIGHTS.retweets +
    quotes * ENGAGEMENT_WEIGHTS.quotes +
    bookmarks * ENGAGEMENT_WEIGHTS.bookmarks +
    Math.log1p(impressions) * ENGAGEMENT_WEIGHTS.impressions;

  return {
    likes,
    replies,
    retweets,
    quotes,
    bookmarks,
    impressions,
    score: likes + replies * 2 + retweets * 2 + quotes * 2 + bookmarks,
    weightedEngagement: Number(weightedEngagement.toFixed(4)),
  };
}

function extractHashtags(text) {
  const matches = text.match(/#[a-z0-9_]+/gi) || [];
  return matches.map((tag) => tag.slice(1).toLowerCase()).filter(Boolean);
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][a-z0-9_]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function incrementCount(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toIsoDay(date) {
  return date.toISOString().slice(0, 10);
}

function createEntityStats() {
  return {
    mentionCount: 0,
    weightedEngagementSum: 0,
    weightedTrendSum: 0,
    recencySum: 0,
    recentWeightedTrendSum: 0,
    previousWeightedTrendSum: 0,
  };
}

function addEntityObservation(store, entityName, observation) {
  if (!entityName) {
    return;
  }

  const current = store.get(entityName) || createEntityStats();
  current.mentionCount += 1;
  current.weightedEngagementSum += observation.weightedEngagement;
  current.weightedTrendSum += observation.weightedTrend;
  current.recencySum += observation.recencyMultiplier;

  if (observation.isRecent) {
    current.recentWeightedTrendSum += observation.weightedTrend;
  } else {
    current.previousWeightedTrendSum += observation.weightedTrend;
  }

  store.set(entityName, current);
}

function rankEntitiesByMomentum(store, entityType, limit) {
  return Array.from(store.entries())
    .map(([name, stats]) => {
      const mentionCount = stats.mentionCount;
      const avgWeightedEngagement = mentionCount > 0 ? stats.weightedEngagementSum / mentionCount : 0;
      const avgRecency = mentionCount > 0 ? stats.recencySum / mentionCount : 0;

      const recent = stats.recentWeightedTrendSum;
      const previous = stats.previousWeightedTrendSum;
      const accelerationRaw = previous > 0 ? (recent - previous) / previous : recent > 0 ? 1 : 0;
      const accelerationNormalized = clamp((clamp(accelerationRaw, -1, 3) + 1) / 4, 0, 1);

      const volumeComponent = Math.log1p(mentionCount);
      const engagementComponent = Math.log1p(avgWeightedEngagement);
      const recencyComponent = clamp(avgRecency, 0, 1);

      const momentumScore = Number(
        (
          100 *
          (volumeComponent * MOMENTUM_WEIGHTS.volume +
            engagementComponent * MOMENTUM_WEIGHTS.engagement +
            recencyComponent * MOMENTUM_WEIGHTS.recency +
            accelerationNormalized * MOMENTUM_WEIGHTS.acceleration)
        ).toFixed(2)
      );

      return {
        entityType,
        name,
        mentionCount,
        weightedMentions: Number(stats.weightedTrendSum.toFixed(2)),
        avgWeightedEngagement: Number(avgWeightedEngagement.toFixed(2)),
        recencyScore: Number(avgRecency.toFixed(4)),
        accelerationScore: Number(accelerationRaw.toFixed(4)),
        momentumScore,
      };
    })
    .sort((a, b) => b.momentumScore - a.momentumScore || b.weightedMentions - a.weightedMentions)
    .slice(0, limit);
}

function classifyTopics(tokens, hashtags, textLower) {
  const tokenSet = new Set(tokens);
  const hashtagSet = new Set(hashtags);
  const topics = [];

  for (const rule of CRYPTO_TOPIC_RULES) {
    const matched = rule.keywords.some((keyword) => {
      const normalized = keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        tokenSet.has(normalized) ||
        hashtagSet.has(normalized) ||
        textLower.includes(` ${keyword.toLowerCase()} `) ||
        textLower.startsWith(`${keyword.toLowerCase()} `) ||
        textLower.endsWith(` ${keyword.toLowerCase()}`)
      );
    });

    if (matched) {
      topics.push(rule.name);
    }
  }

  return topics;
}

async function fetchResearchListTweets(listIdInput) {
  const listId = normalizeListId(listIdInput);
  if (!listId) {
    throw new Error('Missing list ID. Provide TWITTER_RESEARCH_LIST_ID or pass listId in request query.');
  }

  const queries = [
    { listId },
    { list_id: listId },
    { id: listId },
  ];

  const attempts = [];

  for (const query of queries) {
    try {
      const payload = await twitterApiGet('/twitter/list/tweets_timeline', query);
      const tweets = extractTweets(payload);
      if (tweets.length > 0) {
        return { tweets, queryUsed: query };
      }
      attempts.push({ query, message: 'Response returned zero tweets' });
    } catch (error) {
      attempts.push({ query, message: error.message, upstream: error.upstream || null });
    }
  }

  const error = new Error(`Unable to fetch tweets_timeline for list ID "${listId}"`);
  error.attempts = attempts;
  throw error;
}

function analyzeTweetsForCryptoTrends(rawTweets, { windowDays = DEFAULT_WINDOW_DAYS, topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - windowDays);
  const midpointMs = from.getTime() + (now.getTime() - from.getTime()) / 2;
  const midpoint = new Date(midpointMs);

  const hashtagStats = new Map();
  const keywordStats = new Map();
  const topicStats = new Map();

  const analyzedTweets = [];

  for (const rawTweet of rawTweets) {
    const publishedAt = parseTweetDate(rawTweet);
    if (!publishedAt || publishedAt < from || publishedAt > now) {
      continue;
    }

    const text = extractTweetText(rawTweet);
    if (!text) {
      continue;
    }

    const textLower = ` ${text.toLowerCase()} `;
    const hashtags = extractHashtags(text);
    const tokens = tokenize(text);
    const engagement = extractEngagement(rawTweet);
    const topics = classifyTopics(tokens, hashtags, textLower);

    const ageHours = Math.max(0, (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60));
    const recencyMultiplier = Math.exp(-TREND_DECAY_LAMBDA * ageHours);
    const weightedTrendScore = engagement.weightedEngagement * recencyMultiplier;
    const isRecent = publishedAt >= midpoint;
    const observation = {
      weightedEngagement: engagement.weightedEngagement,
      weightedTrend: weightedTrendScore,
      recencyMultiplier,
      isRecent,
    };

    const uniqueHashtags = Array.from(new Set(hashtags));
    const uniqueTokens = Array.from(new Set(tokens));
    const uniqueTopics = Array.from(new Set(topics));

    uniqueHashtags.forEach((tag) => addEntityObservation(hashtagStats, tag, observation));
    uniqueTokens.forEach((token) => addEntityObservation(keywordStats, token, observation));
    uniqueTopics.forEach((topic) => addEntityObservation(topicStats, topic, observation));

    analyzedTweets.push({
      id: String(rawTweet.id_str || rawTweet.id || rawTweet.tweet_id || rawTweet.rest_id || ''),
      text,
      author: rawTweet.user?.screen_name || rawTweet.user?.username || rawTweet.author?.username || null,
      publishedAt,
      hashtags,
      topics,
      engagement: {
        ...engagement,
        recencyMultiplier: Number(recencyMultiplier.toFixed(4)),
        weightedTrendScore: Number(weightedTrendScore.toFixed(4)),
      },
    });
  }

  const rankedHashtags = rankEntitiesByMomentum(hashtagStats, 'hashtag', topLimit);
  const rankedKeywords = rankEntitiesByMomentum(keywordStats, 'keyword', topLimit);
  const rankedTopics = rankEntitiesByMomentum(topicStats, 'topic', topLimit);

  const topHashtags = rankedHashtags.map((entry) => ({
    hashtag: entry.name,
    count: entry.mentionCount,
    weightedMentions: entry.weightedMentions,
    avgWeightedEngagement: entry.avgWeightedEngagement,
    recencyScore: entry.recencyScore,
    accelerationScore: entry.accelerationScore,
    momentumScore: entry.momentumScore,
  }));

  const topKeywords = rankedKeywords.map((entry) => ({
    keyword: entry.name,
    count: entry.mentionCount,
    weightedMentions: entry.weightedMentions,
    avgWeightedEngagement: entry.avgWeightedEngagement,
    recencyScore: entry.recencyScore,
    accelerationScore: entry.accelerationScore,
    momentumScore: entry.momentumScore,
  }));

  const topicBreakdown = rankedTopics.map((entry) => ({
    topic: entry.name,
    mentionCount: entry.mentionCount,
    weightedMentions: entry.weightedMentions,
    avgWeightedEngagement: entry.avgWeightedEngagement,
    recencyScore: entry.recencyScore,
    accelerationScore: entry.accelerationScore,
    trendScore: entry.momentumScore,
    momentumScore: entry.momentumScore,
  }));

  const unifiedTrendingEntities = [...rankedTopics, ...rankedHashtags, ...rankedKeywords]
    .sort((a, b) => b.momentumScore - a.momentumScore || b.weightedMentions - a.weightedMentions)
    .slice(0, topLimit)
    .map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));

  const mostEngagedTweets = analyzedTweets
    .slice()
    .sort((a, b) => b.engagement.weightedTrendScore - a.engagement.weightedTrendScore)
    .slice(0, 8)
    .map((tweet) => ({
      id: tweet.id,
      author: tweet.author,
      publishedAt: tweet.publishedAt,
      text: tweet.text,
      topics: tweet.topics,
      hashtags: tweet.hashtags,
      engagement: tweet.engagement,
    }));

  const dailyVolumeMap = new Map();
  analyzedTweets.forEach((tweet) => {
    const dayKey = toIsoDay(tweet.publishedAt);
    incrementCount(dailyVolumeMap, dayKey, 1);
  });

  const dailyVolume = Array.from(dailyVolumeMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, tweetCount]) => ({ day, tweetCount }));

  return {
    window: {
      days: windowDays,
      from,
      to: now,
    },
    fetchedTweets: rawTweets.length,
    analyzedTweets: analyzedTweets.length,
    topHashtags,
    topKeywords,
    topicBreakdown,
    unifiedTrendingEntities,
    dailyVolume,
    mostEngagedTweets,
  };
}

async function getCryptoTrendAnalysis({ listId, windowDays = DEFAULT_WINDOW_DAYS, topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const resolvedListId = normalizeListId(listId || process.env.TWITTER_RESEARCH_LIST_ID);
  const { tweets, queryUsed } = await fetchResearchListTweets(resolvedListId);
  const analysis = analyzeTweetsForCryptoTrends(tweets, {
    windowDays: Number(windowDays) > 0 ? Number(windowDays) : DEFAULT_WINDOW_DAYS,
    topLimit: Number(topLimit) > 0 ? Number(topLimit) : DEFAULT_TOP_LIMIT,
  });

  return {
    listId: resolvedListId,
    queryUsed,
    ...analysis,
  };
}

module.exports = {
  analyzeTweetsForCryptoTrends,
  fetchResearchListTweets,
  getCryptoTrendAnalysis,
};
