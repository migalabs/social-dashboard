const Post = require('../models/Post');
const MetricSnapshot = require('../models/MetricSnapshot');
const LinkedInMonthlySnapshot = require('../models/LinkedInMonthlySnapshot');

const RETENTION_MONTHS = 6;

function getRetentionCutoff() {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  cutoff.setUTCDate(1);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

function calculateEngagementRate(totalEngagements, impressions) {
  const safeImpressions = Number(impressions) || 0;
  if (safeImpressions <= 0) {
    return 0;
  }
  return Number(((Number(totalEngagements) / safeImpressions) * 100).toFixed(2));
}

// Groups a flat array of snapshots by YYYY-MM key.
function groupByMonth(snapshots) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    const d = new Date(snapshot.collectedAt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(snapshot);
  }
  return groups;
}

// Produces a monthly rollup record from a sorted array of snapshots for one month.
// LinkedIn metrics are cumulative, so we take end-of-month values from the last snapshot.
function buildMonthlyRollup(postId, year, month, snapshots) {
  const sorted = snapshots.slice().sort((a, b) => new Date(a.collectedAt) - new Date(b.collectedAt));
  const last = sorted[sorted.length - 1];

  const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const likes = last.likesCount || 0;
  const comments = last.commentsCount || 0;
  const shares = last.sharesCount || 0;
  const savesOrBookmarks = last.savesOrBookmarksCount || 0;
  const impressions = last.impressionsCount || 0;
  const totalEngagements = likes + comments + shares + savesOrBookmarks;

  return {
    post: postId,
    year,
    month,
    periodStart,
    periodEnd,
    likesCount: likes,
    commentsCount: comments,
    impressionsCount: impressions,
    savesOrBookmarksCount: savesOrBookmarks,
    sharesCount: shares,
    totalEngagements,
    engagementRate: calculateEngagementRate(totalEngagements, impressions),
    snapshotCount: snapshots.length,
  };
}

/**
 * Rolls up raw LinkedIn MetricSnapshots older than RETENTION_MONTHS into monthly
 * summaries in LinkedInMonthlySnapshot. Safe to call repeatedly — uses upsert.
 *
 * Returns a summary of how many rollups were created or updated.
 */
async function rollUpLinkedInMonthlySnapshots() {
  const cutoff = getRetentionCutoff();

  const linkedinPostIds = await Post.distinct('_id', { platform: 'linkedin' });

  if (linkedinPostIds.length === 0) {
    return { rolledUp: 0, posts: 0 };
  }

  const rawSnapshots = await MetricSnapshot.find({
    post: { $in: linkedinPostIds },
    collectedAt: { $lt: cutoff },
  })
    .sort({ collectedAt: 1 })
    .lean();

  if (rawSnapshots.length === 0) {
    return { rolledUp: 0, posts: 0 };
  }

  // Group by post then by month
  const byPost = new Map();
  for (const snapshot of rawSnapshots) {
    const postKey = String(snapshot.post);
    if (!byPost.has(postKey)) {
      byPost.set(postKey, []);
    }
    byPost.get(postKey).push(snapshot);
  }

  let rolledUp = 0;

  for (const [postKey, postSnapshots] of byPost.entries()) {
    const monthGroups = groupByMonth(postSnapshots);

    for (const [, monthSnapshots] of monthGroups.entries()) {
      const d = new Date(monthSnapshots[0].collectedAt);
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;

      const rollup = buildMonthlyRollup(postKey, year, month, monthSnapshots);

      await LinkedInMonthlySnapshot.findOneAndUpdate(
        { post: postKey, year, month },
        { $set: rollup },
        { upsert: true }
      );

      rolledUp += 1;
    }
  }

  return { rolledUp, posts: byPost.size };
}

/**
 * Purges raw LinkedIn MetricSnapshots older than RETENTION_MONTHS, but only
 * for months that already have a LinkedInMonthlySnapshot rollup recorded.
 *
 * Marks each monthly snapshot as rawPurged after deletion.
 *
 * Returns a count of deleted raw snapshots.
 */
async function purgeLinkedInRawSnapshots() {
  const cutoff = getRetentionCutoff();

  const linkedinPostIds = await Post.distinct('_id', { platform: 'linkedin' });

  if (linkedinPostIds.length === 0) {
    return { deleted: 0 };
  }

  // Only purge months that have already been rolled up
  const rolledUpMonthly = await LinkedInMonthlySnapshot.find({
    post: { $in: linkedinPostIds },
    rawPurged: false,
  }).lean();

  if (rolledUpMonthly.length === 0) {
    return { deleted: 0 };
  }

  let deleted = 0;

  for (const monthly of rolledUpMonthly) {
    const result = await MetricSnapshot.deleteMany({
      post: monthly.post,
      collectedAt: {
        $gte: monthly.periodStart,
        $lte: monthly.periodEnd,
        $lt: cutoff,
      },
    });

    deleted += result.deletedCount;

    await LinkedInMonthlySnapshot.updateOne(
      { _id: monthly._id },
      { $set: { rawPurged: true, rawPurgedAt: new Date() } }
    );
  }

  return { deleted };
}

/**
 * Runs the full LinkedIn retention job:
 * 1. Roll up raw snapshots into monthly summaries.
 * 2. Purge raw snapshots that have been rolled up and are past retention window.
 */
async function runLinkedInRetentionJob() {
  const cutoff = getRetentionCutoff();
  const rollupResult = await rollUpLinkedInMonthlySnapshots();
  const purgeResult = await purgeLinkedInRawSnapshots();

  return {
    retentionWindowMonths: RETENTION_MONTHS,
    cutoff,
    rollup: rollupResult,
    purge: purgeResult,
  };
}

module.exports = {
  runLinkedInRetentionJob,
  rollUpLinkedInMonthlySnapshots,
  purgeLinkedInRawSnapshots,
  RETENTION_MONTHS,
};
