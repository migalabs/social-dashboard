const Post = require('../models/Post');
const MetricSnapshot = require('../models/MetricSnapshot');
const TwitterAccountSnapshot = require('../models/TwitterAccountSnapshot');
const { twitterApiGet } = require('./twitterApi');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateFollowerGrowth(currentFollowers, previousFollowers) {
  const current = toNumber(currentFollowers, 0);
  const previous = toNumber(previousFollowers, 0);
  const growth = current - previous;

  if (previous <= 0) {
    return {
      absolute: growth,
      percent: null,
    };
  }

  return {
    absolute: growth,
    percent: Number((((current - previous) / previous) * 100).toFixed(2)),
  };
}

function normalizeHandleInput(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return '';
  }

  const withoutUrl = raw
    .replace(/^https?:\/\/(www\.)?x\.com\//i, '')
    .replace(/^https?:\/\/(www\.)?twitter\.com\//i, '');

  return withoutUrl.replace(/^@/, '').split('/')[0].trim();
}

function buildUserLookupQueries(handleInput) {
  const handle = normalizeHandleInput(handleInput);
  if (!handle) {
    return [];
  }

  const isNumericId = /^\d+$/.test(handle);
  if (isNumericId) {
    return [
      { userId: handle },
      { user_id: handle },
      { id: handle },
    ];
  }

  return [
    { userName: handle },
    { username: handle },
    { screen_name: handle },
    { userName: `@${handle}` },
  ];
}

function pickFirstObject(payload) {
  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    return payload[0] || null;
  }

  const candidates = [
    payload.data,
    payload.result,
    payload.user,
    payload.profile,
    payload.value,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (Array.isArray(candidate)) {
      return candidate[0] || null;
    }
    if (typeof candidate === 'object') {
      return candidate;
    }
  }

  return typeof payload === 'object' ? payload : null;
}

function extractUserInfo(payload) {
  const raw = pickFirstObject(payload);
  if (!raw) {
    return null;
  }

  const stats = raw.public_metrics || raw.metrics || raw.legacy || {};

  return {
    accountHandle: String(raw.screen_name || raw.username || raw.userName || raw.handle || '').replace(/^@/, ''),
    accountName: raw.name || raw.user_name || raw.displayName || '',
    followersCount: toNumber(stats.followers_count || raw.followers_count || raw.followersCount || raw.followers, 0),
    followingCount: toNumber(stats.following_count || raw.friends_count || raw.followingCount || raw.following, 0),
    tweetCount: toNumber(stats.tweet_count || raw.statuses_count || raw.tweetCount || raw.statusesCount, 0),
    listedCount: toNumber(stats.listed_count || raw.listed_count || raw.listedCount, 0),
    profileVisitsCount: Number.isFinite(Number(raw.profile_visits_count))
      ? Number(raw.profile_visits_count)
      : Number.isFinite(Number(raw.profileVisitsCount))
        ? Number(raw.profileVisitsCount)
        : null,
    raw,
  };
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

function isRetweetContent(content) {
  return /^RT\s+@/i.test(String(content || '').trim());
}

function normalizeTweet(rawTweet) {
  const metrics = rawTweet.public_metrics || rawTweet.metrics || rawTweet.legacy || {};
  const id = String(rawTweet.id_str || rawTweet.id || rawTweet.tweet_id || rawTweet.rest_id || '').trim();
  const content = (rawTweet.full_text || rawTweet.text || rawTweet.note_tweet?.text || '').trim();
  const publishedAtRaw = rawTweet.created_at || rawTweet.createdAt || rawTweet.tweet_created_at;
  const publishedAt = publishedAtRaw ? new Date(publishedAtRaw) : null;

  if (!id || !content || !publishedAt || Number.isNaN(publishedAt.getTime())) {
    return null;
  }

  if (isRetweetContent(content)) {
    return null;
  }

  return {
    externalPostId: id,
    content,
    publishedAt,
    isReply: Boolean(
      rawTweet.isReply ||
        rawTweet.in_reply_to_status_id ||
        rawTweet.inReplyToStatusId ||
        rawTweet.in_reply_to_user_id ||
        rawTweet.inReplyToId
    ),
    likesCount: toNumber(metrics.like_count || rawTweet.like_count || rawTweet.likeCount || rawTweet.favorite_count || rawTweet.likes, 0),
    commentsCount: toNumber(metrics.reply_count || rawTweet.reply_count || rawTweet.replyCount || rawTweet.replies, 0),
    impressionsCount: toNumber(
      metrics.impression_count ||
        metrics.view_count ||
        rawTweet.impression_count ||
        rawTweet.view_count ||
        rawTweet.viewCount ||
        rawTweet.impressions,
      0
    ),
    savesOrBookmarksCount: toNumber(
      metrics.bookmark_count || rawTweet.bookmark_count || rawTweet.bookmarkCount || rawTweet.bookmarks,
      0
    ),
    sharesCount: toNumber(metrics.retweet_count || rawTweet.retweet_count || rawTweet.retweetCount || rawTweet.shares, 0),
  };
}

async function fetchUserInfo(handleInput) {
  const queries = buildUserLookupQueries(handleInput);
  const attempts = [];

  for (const query of queries) {
    try {
      const payload = await twitterApiGet('/twitter/user/info', query);
      const user = extractUserInfo(payload);
      if (user) {
        return { user, queryUsed: query };
      }
      attempts.push({ query, message: 'Response did not include a recognizable user object' });
    } catch (error) {
      attempts.push({ query, message: error.message, upstream: error.upstream || null });
    }
  }

  const error = new Error(`Unable to resolve user for input "${handleInput}"`);
  error.attempts = attempts;
  throw error;
}

async function fetchLastTweets(handleInput) {
  const queries = buildUserLookupQueries(handleInput);
  const attempts = [];

  for (const query of queries) {
    try {
      const payload = await twitterApiGet('/twitter/user/last_tweets', query);
      const tweets = extractTweets(payload);
      if (tweets.length > 0) {
        return { tweets, queryUsed: query };
      }
      attempts.push({ query, message: 'Response returned zero tweets' });
    } catch (error) {
      attempts.push({ query, message: error.message, upstream: error.upstream || null });
    }
  }

  const error = new Error(`Unable to fetch tweets for input "${handleInput}"`);
  error.attempts = attempts;
  throw error;
}

async function upsertTweetHistory({ handle, collectedAt, trackingWindowDays, accountInfo, rawTweets }) {
  const cutoff = new Date(collectedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - trackingWindowDays);

  const normalizedTweets = rawTweets.map(normalizeTweet).filter(Boolean);
  const seenPostIds = new Set();
  let upsertedPosts = 0;
  let insertedSnapshots = 0;

  for (const tweet of normalizedTweets) {
    const trackingEnabled = tweet.publishedAt >= cutoff;

    const post = await Post.findOneAndUpdate(
      { externalPostId: tweet.externalPostId },
      {
        $set: {
          platform: 'x',
          source: 'twitterapi',
          accountName: accountInfo.accountName || handle,
          accountHandle: accountInfo.accountHandle || handle,
          content: tweet.content,
          isReply: tweet.isReply,
          publishedAt: tweet.publishedAt,
          trackingEnabled,
          trackingDisabledAt: trackingEnabled ? null : collectedAt,
          lastSeenInSourceAt: collectedAt,
        },
        $setOnInsert: {
          createdAt: collectedAt,
        },
      },
      { upsert: true, new: true }
    ).lean();

    seenPostIds.add(String(post._id));
    upsertedPosts += 1;

    const snapshotWrite = await MetricSnapshot.updateOne(
      { post: post._id, collectedAt },
      {
        $set: {
          likesCount: tweet.likesCount,
          commentsCount: tweet.commentsCount,
          impressionsCount: tweet.impressionsCount,
          savesOrBookmarksCount: tweet.savesOrBookmarksCount,
          sharesCount: tweet.sharesCount,
        },
      },
      { upsert: true }
    );

    if (snapshotWrite.upsertedCount > 0) {
      insertedSnapshots += 1;
    }
  }

  await Post.updateMany(
    {
      platform: 'x',
      source: 'twitterapi',
      accountHandle: accountInfo.accountHandle || handle,
      publishedAt: { $lt: cutoff },
      trackingEnabled: true,
    },
    {
      $set: {
        trackingEnabled: false,
        trackingDisabledAt: collectedAt,
      },
    }
  );

  return {
    handle,
    fetchedTweets: rawTweets.length,
    usableTweets: normalizedTweets.length,
    upsertedPosts,
    insertedSnapshots,
    activeTrackedPosts: seenPostIds.size,
  };
}

async function syncTwitterHistory({ handles, trackingWindowDays = 120 }) {
  const collectedAt = new Date();
  const uniqueHandles = Array.from(
    new Set(
      handles
        .map((handle) => normalizeHandleInput(handle))
        .filter(Boolean)
    )
  );

  const summary = {
    runAt: collectedAt,
    handles: uniqueHandles,
    trackingWindowDays,
    usersProcessed: 0,
    usersFailed: 0,
    postsUpserted: 0,
    snapshotsInserted: 0,
    results: [],
  };

  for (const handle of uniqueHandles) {
    try {
      const { user: accountInfo, queryUsed: userQueryUsed } = await fetchUserInfo(handle);

      const previousAccountSnapshot = await TwitterAccountSnapshot.findOne({
        accountHandle: accountInfo.accountHandle || handle,
        collectedAt: { $lt: collectedAt },
      })
        .sort({ collectedAt: -1 })
        .lean();

      const followerGrowth = calculateFollowerGrowth(
        accountInfo.followersCount,
        previousAccountSnapshot?.followersCount
      );

      await TwitterAccountSnapshot.updateOne(
        { accountHandle: accountInfo.accountHandle || handle, collectedAt },
        {
          $set: {
            accountName: accountInfo.accountName || handle,
            followersCount: accountInfo.followersCount,
            followingCount: accountInfo.followingCount,
            tweetCount: accountInfo.tweetCount,
            listedCount: accountInfo.listedCount,
            profileVisitsCount: accountInfo.profileVisitsCount,
            raw: accountInfo.raw,
          },
        },
        { upsert: true }
      );

      const { tweets: rawTweets, queryUsed: tweetsQueryUsed } = await fetchLastTweets(
        accountInfo.accountHandle || handle
      );
      const result = await upsertTweetHistory({
        handle,
        collectedAt,
        trackingWindowDays,
        accountInfo,
        rawTweets,
      });

      summary.usersProcessed += 1;
      summary.postsUpserted += result.upsertedPosts;
      summary.snapshotsInserted += result.insertedSnapshots;
      summary.results.push({
        ...result,
        status: 'ok',
        followersCount: accountInfo.followersCount,
        previousFollowersCount: toNumber(previousAccountSnapshot?.followersCount, 0),
        followerGrowth,
        userQueryUsed,
        tweetsQueryUsed,
      });
    } catch (error) {
      summary.usersFailed += 1;
      summary.results.push({
        handle,
        status: 'error',
        message: error.message,
        attempts: error.attempts || [],
      });
    }
  }

  return summary;
}

module.exports = {
  syncTwitterHistory,
};
