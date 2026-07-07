require('dotenv').config();

const mongoose = require('mongoose');

const connectToDatabase = require('../config/db');
const TwitterResearchSnapshot = require('../models/TwitterResearchSnapshot');
const { getCryptoTrendAnalysis } = require('../services/twitterResearch');

async function run() {
  const listId = String(process.env.TWITTER_RESEARCH_LIST_ID || '').trim();
  if (!listId) {
    throw new Error('Set TWITTER_RESEARCH_LIST_ID in backend .env before running research trend sync.');
  }

  const retentionDays = 30;

  await connectToDatabase();

  const result = await getCryptoTrendAnalysis({ listId });

  await TwitterResearchSnapshot.create({
    listId: result.listId,
    queryUsed: result.queryUsed,
    window: result.window,
    fetchedTweets: result.fetchedTweets,
    analyzedTweets: result.analyzedTweets,
    topHashtags: result.topHashtags,
    topKeywords: result.topKeywords,
    topicBreakdown: result.topicBreakdown,
    dailyVolume: result.dailyVolume,
    mostEngagedTweets: result.mostEngagedTweets,
    topicTweets: result.topicTweets,
    generatedAt: new Date(),
  });

  let deletedOldSnapshots = 0;
  if (Number.isFinite(retentionDays) && retentionDays > 0) {
    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);

    const cleanupResult = await TwitterResearchSnapshot.deleteMany({
      generatedAt: { $lt: cutoffDate },
    });
    deletedOldSnapshots = cleanupResult.deletedCount || 0;
  }

  const summary = {
    listId: result.listId,
    windowDays: result.window.days,
    fetchedTweets: result.fetchedTweets,
    analyzedTweets: result.analyzedTweets,
    topTopic: result.topicBreakdown[0] || null,
    generatedAt: new Date().toISOString(),
    retentionDays,
    deletedOldSnapshots,
  };

  console.log('Twitter research trend sync complete');
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error('Twitter research trend sync failed:', error.message);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.connection.close();
});
