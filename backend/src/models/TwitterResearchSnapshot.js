const mongoose = require('mongoose');

const researchTopicSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    mentionCount: { type: Number, required: true, default: 0 },
    avgEngagementScore: { type: Number, required: true, default: 0 },
    trendScore: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const researchCountSchema = new mongoose.Schema(
  {
    hashtag: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const researchKeywordSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const researchDailyVolumeSchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    tweetCount: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const researchTweetSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    author: { type: String, default: null },
    publishedAt: { type: Date, required: true },
    text: { type: String, required: true },
    topics: [{ type: String }],
    hashtags: [{ type: String }],
    engagement: {
      likes: { type: Number, default: 0 },
      replies: { type: Number, default: 0 },
      retweets: { type: Number, default: 0 },
      quotes: { type: Number, default: 0 },
      bookmarks: { type: Number, default: 0 },
      impressions: { type: Number, default: 0 },
      score: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

const researchTopicTweetsSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    tweets: {
      type: [researchTweetSchema],
      default: [],
    },
  },
  { _id: false }
);

const researchContentGapSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    status: { type: String, required: true, enum: ['uncovered', 'under-covered', 'covered'] },
    priorityScore: { type: Number, required: true, default: 0 },
    trendScore: { type: Number, required: true, default: 0 },
    externalMentions: { type: Number, required: true, default: 0 },
    avgEngagementScore: { type: Number, required: true, default: 0 },
    ownPostsCount: { type: Number, required: true, default: 0 },
    coverageRatio: { type: Number, required: true, default: 0 },
    latestCoveredAt: { type: Date, default: null },
    coveredPlatforms: { type: [String], default: [] },
    missingKeywords: { type: [researchKeywordSchema], default: [] },
    recommendation: { type: String, required: true, default: '' },
  },
  { _id: false }
);

const twitterResearchSnapshotSchema = new mongoose.Schema(
  {
    listId: {
      type: String,
      required: true,
      index: true,
    },
    queryUsed: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    window: {
      days: { type: Number, required: true, default: 7 },
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    fetchedTweets: {
      type: Number,
      required: true,
      default: 0,
    },
    analyzedTweets: {
      type: Number,
      required: true,
      default: 0,
    },
    topHashtags: {
      type: [researchCountSchema],
      default: [],
    },
    topKeywords: {
      type: [researchKeywordSchema],
      default: [],
    },
    topicBreakdown: {
      type: [researchTopicSchema],
      default: [],
    },
    dailyVolume: {
      type: [researchDailyVolumeSchema],
      default: [],
    },
    mostEngagedTweets: {
      type: [researchTweetSchema],
      default: [],
    },
    topicTweets: {
      type: [researchTopicTweetsSchema],
      default: [],
    },
    contentGapRecommendations: {
      type: [researchContentGapSchema],
      default: [],
    },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

twitterResearchSnapshotSchema.index({ listId: 1, generatedAt: -1 });

module.exports = mongoose.model('TwitterResearchSnapshot', twitterResearchSnapshotSchema);