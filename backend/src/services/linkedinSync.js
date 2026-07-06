const Post = require('../models/Post');
const MetricSnapshot = require('../models/MetricSnapshot');
const { getLinkedInAccessToken, linkedinApiGet } = require('./linkedinApi');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrn(input) {
  return String(input || '').trim();
}

function parseShareUrnFromActivity(activity) {
  const value = String(activity || '');
  const marker = ':activity:';
  const index = value.lastIndexOf(marker);

  if (index < 0) {
    return '';
  }

  const activityId = value.slice(index + marker.length).trim();
  return activityId ? `urn:li:share:${activityId}` : '';
}

function extractShareStatRows(payload) {
  if (Array.isArray(payload?.elements)) {
    return payload.elements;
  }

  if (Array.isArray(payload?.data?.elements)) {
    return payload.data.elements;
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  return [];
}

function extractUgcRows(payload) {
  if (Array.isArray(payload?.elements)) {
    return payload.elements;
  }

  if (Array.isArray(payload?.data?.elements)) {
    return payload.data.elements;
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  return [];
}

function normalizeShareStatRow(row) {
  const stats = row?.totalShareStatistics || row?.shareStatistics || {};
  const shareUrn = normalizeUrn(row?.ugcPost || row?.share || parseShareUrnFromActivity(row?.shareActivity));

  if (!shareUrn) {
    return null;
  }

  return {
    shareUrn,
    likesCount: toNumber(stats.likeCount || stats.likes || 0),
    commentsCount: toNumber(stats.commentCount || stats.comments || 0),
    impressionsCount: toNumber(
      stats.impressionCount || stats.impressionsCount || stats.uniqueImpressionsCount || 0
    ),
    savesOrBookmarksCount: toNumber(stats.clickCount || stats.clicks || 0),
    sharesCount: toNumber(stats.shareCount || stats.shares || 0),
    raw: row,
  };
}

function parsePublishedAt(ugc) {
  const created = ugc?.created || ugc?.lifecycleStateInfo?.created || null;
  const epochMs =
    created?.time ||
    created?.createdAt ||
    created?.created ||
    ugc?.createdAt ||
    ugc?.publishedAt ||
    null;

  const date = epochMs ? new Date(Number(epochMs)) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function extractTextContent(ugc) {
  const text =
    ugc?.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text ||
    ugc?.specificContent?.shareCommentary?.text ||
    ugc?.commentary ||
    ugc?.text ||
    '';

  return String(text || '').trim();
}

function normalizeUgcRow(row) {
  const ugcUrn = normalizeUrn(row?.id || row?.entity || row?.ugcPost);
  const shareUrn = normalizeUrn(row?.id || row?.ugcPost || row?.shareUrn);
  const publishedAt = parsePublishedAt(row);
  const content = extractTextContent(row);

  const externalPostId = ugcUrn || shareUrn;
  if (!externalPostId || !publishedAt) {
    return null;
  }

  return {
    externalPostId,
    content: content || 'LinkedIn post',
    publishedAt,
    isReply: false,
    raw: row,
  };
}

function mergeRows(ugcRows, shareStatRows) {
  const ugcById = new Map();
  const statsById = new Map();

  ugcRows
    .map(normalizeUgcRow)
    .filter(Boolean)
    .forEach((row) => {
      ugcById.set(row.externalPostId, row);
      const shareUrn = normalizeUrn(row.raw?.id || row.raw?.ugcPost || row.externalPostId);
      if (shareUrn && shareUrn !== row.externalPostId) {
        ugcById.set(shareUrn, row);
      }
    });

  shareStatRows
    .map(normalizeShareStatRow)
    .filter(Boolean)
    .forEach((row) => {
      statsById.set(row.shareUrn, row);
    });

  const ids = new Set([...ugcById.keys(), ...statsById.keys()]);
  const merged = [];

  ids.forEach((id) => {
    const postMeta = ugcById.get(id) || null;
    const stats = statsById.get(id) || null;
    if (!postMeta && !stats) {
      return;
    }

    if (!postMeta) {
      return;
    }

    merged.push({
      externalPostId: postMeta.externalPostId,
      content: postMeta.content,
      publishedAt: postMeta.publishedAt,
      isReply: postMeta.isReply,
      likesCount: stats?.likesCount || 0,
      commentsCount: stats?.commentsCount || 0,
      impressionsCount: stats?.impressionsCount || 0,
      savesOrBookmarksCount: stats?.savesOrBookmarksCount || 0,
      sharesCount: stats?.sharesCount || 0,
      raw: {
        ugc: postMeta.raw,
        stats: stats?.raw || null,
      },
    });
  });

  return merged.sort((a, b) => b.publishedAt - a.publishedAt);
}

async function fetchOrganizationShareStats({ organizationUrn, count = 50 }) {
  const tokenResult = await getLinkedInAccessToken({ allowRefresh: true });
  if (!tokenResult.accessToken) {
    const error = new Error('LinkedIn account is not connected. Complete OAuth before running LinkedIn sync.');
    error.status = 401;
    throw error;
  }

  const query = {
    q: 'organizationalEntity',
    organizationalEntity: organizationUrn,
    count,
  };

  const payload = await linkedinApiGet('/organizationalEntityShareStatistics', {
    accessToken: tokenResult.accessToken,
    query,
  });

  return {
    tokenSource: tokenResult.source,
    rows: extractShareStatRows(payload),
    raw: payload,
  };
}

async function fetchOrganizationUgcPosts({ organizationUrn, count = 50 }) {
  const tokenResult = await getLinkedInAccessToken({ allowRefresh: true });
  if (!tokenResult.accessToken) {
    const error = new Error('LinkedIn account is not connected. Complete OAuth before running LinkedIn sync.');
    error.status = 401;
    throw error;
  }

  const query = {
    q: 'authors',
    authors: `List(${organizationUrn})`,
    count,
    sortBy: 'LAST_MODIFIED',
  };

  const payload = await linkedinApiGet('/ugcPosts', {
    accessToken: tokenResult.accessToken,
    query,
  });

  return {
    tokenSource: tokenResult.source,
    rows: extractUgcRows(payload),
    raw: payload,
  };
}

async function upsertLinkedInHistory({ organizationUrn, accountName, accountHandle, trackingWindowDays = 120, count = 50 }) {
  const normalizedOrgUrn = normalizeUrn(organizationUrn);
  if (!normalizedOrgUrn) {
    throw new Error('Missing organization URN. Set LINKEDIN_ORGANIZATION_URN in backend environment.');
  }

  const collectedAt = new Date();
  const cutoff = new Date(collectedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - trackingWindowDays);

  const [statsResult, ugcResult] = await Promise.all([
    fetchOrganizationShareStats({ organizationUrn: normalizedOrgUrn, count }),
    fetchOrganizationUgcPosts({ organizationUrn: normalizedOrgUrn, count }),
  ]);

  const mergedRows = mergeRows(ugcResult.rows, statsResult.rows);
  let upsertedPosts = 0;
  let insertedSnapshots = 0;

  for (const row of mergedRows) {
    const trackingEnabled = row.publishedAt >= cutoff;

    const post = await Post.findOneAndUpdate(
      { externalPostId: row.externalPostId },
      {
        $set: {
          platform: 'linkedin',
          source: 'linkedinapi',
          accountName: accountName || 'LinkedIn Organization',
          accountHandle: accountHandle || normalizedOrgUrn,
          content: row.content,
          isReply: row.isReply,
          publishedAt: row.publishedAt,
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

    upsertedPosts += 1;

    const snapshotWrite = await MetricSnapshot.updateOne(
      { post: post._id, collectedAt },
      {
        $set: {
          likesCount: row.likesCount,
          commentsCount: row.commentsCount,
          impressionsCount: row.impressionsCount,
          savesOrBookmarksCount: row.savesOrBookmarksCount,
          sharesCount: row.sharesCount,
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
      platform: 'linkedin',
      source: 'linkedinapi',
      accountHandle: accountHandle || normalizedOrgUrn,
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
    runAt: collectedAt,
    organizationUrn: normalizedOrgUrn,
    trackingWindowDays,
    fetchedShareStats: statsResult.rows.length,
    fetchedUgcPosts: ugcResult.rows.length,
    mergedRows: mergedRows.length,
    upsertedPosts,
    insertedSnapshots,
    tokenSources: {
      shareStats: statsResult.tokenSource,
      ugcPosts: ugcResult.tokenSource,
    },
  };
}

module.exports = {
  upsertLinkedInHistory,
};