function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function simulateLinkedInElement(previous, organizationUrn) {
  const uniqueImpressionsCount = previous.uniqueImpressionsCount + randomInt(1, 5);
  const clickCount = previous.clickCount + randomInt(0, 2);
  const likeCount = previous.likeCount + randomInt(0, 2);
  const commentCount = previous.commentCount + randomInt(0, 1);
  const shareCount = previous.shareCount + randomInt(0, 1);
  const impressionCount = previous.impressionCount + randomInt(8, 32);

  const engagement = Number(
    ((likeCount + commentCount + shareCount + clickCount) / Math.max(impressionCount, 1)).toFixed(6)
  );

  return {
    totalShareStatistics: {
      uniqueImpressionsCount,
      clickCount,
      engagement,
      likeCount,
      commentCount,
      shareCount,
      commentMentionsCount: randomInt(0, 3),
      impressionCount,
      shareMentionsCount: randomInt(0, 3),
    },
    organizationalEntity: organizationUrn,
  };
}

function simulateXMetrics(previous) {
  const view_count = previous.view_count + randomInt(60, 500);
  const like_count = previous.like_count + randomInt(1, 22);
  const retweet_count = previous.retweet_count + randomInt(0, 5);
  const reply_count = previous.reply_count + randomInt(0, 7);
  const quote_count = previous.quote_count + randomInt(0, 3);
  const bookmark_count = previous.bookmark_count + randomInt(0, 6);

  return {
    view_count,
    like_count,
    retweet_count,
    reply_count,
    quote_count,
    bookmark_count,
  };
}

function buildSnapshots(post, days) {
  const snapshots = [];

  let linkedinState = {
    uniqueImpressionsCount: post.baseline.uniqueImpressionsCount,
    clickCount: post.baseline.clickCount,
    likeCount: post.baseline.likeCount,
    commentCount: post.baseline.commentCount,
    shareCount: post.baseline.shareCount,
    impressionCount: post.baseline.impressionCount,
  };

  let xState = {
    view_count: post.baseline.view_count,
    like_count: post.baseline.like_count,
    retweet_count: post.baseline.retweet_count,
    reply_count: post.baseline.reply_count,
    quote_count: post.baseline.quote_count,
    bookmark_count: post.baseline.bookmark_count,
  };

  for (let day = days - 1; day >= 0; day -= 1) {
    let likes = 0;
    let comments = 0;
    let impressions = 0;
    let savesOrBookmarks = 0;
    let shares = 0;

    if (post.platform === 'linkedin') {
      const linkedinElement = simulateLinkedInElement(linkedinState, post.organizationalEntity);
      linkedinState = {
        uniqueImpressionsCount: linkedinElement.totalShareStatistics.uniqueImpressionsCount,
        clickCount: linkedinElement.totalShareStatistics.clickCount,
        likeCount: linkedinElement.totalShareStatistics.likeCount,
        commentCount: linkedinElement.totalShareStatistics.commentCount,
        shareCount: linkedinElement.totalShareStatistics.shareCount,
        impressionCount: linkedinElement.totalShareStatistics.impressionCount,
      };

      likes = linkedinElement.totalShareStatistics.likeCount;
      comments = linkedinElement.totalShareStatistics.commentCount;
      impressions = linkedinElement.totalShareStatistics.impressionCount;
      shares = linkedinElement.totalShareStatistics.shareCount;
      savesOrBookmarks = Math.max(0, Math.floor(linkedinElement.totalShareStatistics.clickCount * 0.06));
    } else {
      const xMetrics = simulateXMetrics(xState);
      xState = xMetrics;

      likes = xMetrics.like_count;
      comments = xMetrics.reply_count;
      impressions = xMetrics.view_count;
      shares = xMetrics.retweet_count;
      savesOrBookmarks = xMetrics.bookmark_count;
    }

    const collectedAt = new Date();
    collectedAt.setUTCHours(0, 0, 0, 0);
    collectedAt.setUTCDate(collectedAt.getUTCDate() - day);

    snapshots.push({
      post: post._id,
      collectedAt,
      likesCount: likes,
      commentsCount: comments,
      impressionsCount: impressions,
      savesOrBookmarksCount: savesOrBookmarks,
      sharesCount: shares,
    });
  }

  return snapshots;
}

function generateFakePosts() {
  const now = new Date();
  const seedPosts = [
    {
      platform: 'linkedin',
      externalPostId: 'li-post-001',
      accountName: 'MigaLabs',
      content: 'Launching our social analytics beta this month.',
      isReply: false,
      organizationalEntity: 'urn:li:organization:151279',
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 18),
      baseline: {
        uniqueImpressionsCount: 18,
        clickCount: 8,
        likeCount: 6,
        commentCount: 3,
        shareCount: 1,
        impressionCount: 64,
      },
    },
    {
      platform: 'linkedin',
      externalPostId: 'li-post-002',
      accountName: 'MigaLabs',
      content: 'How we measure engagement quality beyond likes.',
      isReply: true,
      organizationalEntity: 'urn:li:organization:151279',
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 12),
      baseline: {
        uniqueImpressionsCount: 14,
        clickCount: 6,
        likeCount: 4,
        commentCount: 2,
        shareCount: 1,
        impressionCount: 52,
      },
    },
  ];

  const linkedinTopics = [
    'Building a weekly analytics ritual for social teams.',
    'What changed in our audience retention this quarter.',
    'How to compare post performance with confidence intervals.',
    'Reducing reporting noise with cleaner engagement signals.',
    'A better way to monitor campaign quality in one dashboard.',
    'How our team aligns content strategy with performance data.',
    'Measuring post momentum instead of one-off spikes.',
    'Practical benchmarks for B2B social media teams.',
    'Why trend direction can matter more than raw totals.',
    'A simple scoring model for content prioritization.',
  ];

  linkedinTopics.forEach((content, index) => {
    const n = index + 3;
    seedPosts.push({
      platform: 'linkedin',
      externalPostId: `li-post-${String(n).padStart(3, '0')}`,
      accountName: 'MigaLabs',
      content,
      isReply: index % 3 === 0,
      organizationalEntity: 'urn:li:organization:151279',
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * (5 + index * 2)),
      baseline: {
        uniqueImpressionsCount: 12 + index * 3 + randomInt(0, 4),
        clickCount: 8 + index * 2 + randomInt(0, 3),
        likeCount: 3 + index * 1 + randomInt(0, 3),
        commentCount: 1 + Math.floor(index / 2) + randomInt(0, 1),
        shareCount: 1 + Math.floor(index / 4) + randomInt(0, 1),
        impressionCount: 54 + index * 18 + randomInt(0, 14),
      },
    });
  });

  return seedPosts;
}

function generateSeedPayload(postDocuments, days = 14) {
  const snapshots = postDocuments.flatMap((post) => buildSnapshots(post, days));

  return snapshots;
}

module.exports = {
  generateFakePosts,
  generateSeedPayload,
};