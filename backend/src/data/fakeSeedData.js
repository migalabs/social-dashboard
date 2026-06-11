function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildSnapshots(postId, days, base) {
  const snapshots = [];
  let likes = base.likes;
  let comments = base.comments;
  let impressions = base.impressions;
  let savesOrBookmarks = base.savesOrBookmarks;
  let shares = base.shares;

  for (let day = days - 1; day >= 0; day -= 1) {
    likes += randomInt(1, 25);
    comments += randomInt(0, 8);
    impressions += randomInt(20, 350);
    savesOrBookmarks += randomInt(0, 6);
    shares += randomInt(0, 4);

    const collectedAt = new Date();
    collectedAt.setUTCHours(0, 0, 0, 0);
    collectedAt.setUTCDate(collectedAt.getUTCDate() - day);

    snapshots.push({
      post: postId,
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

  return [
    {
      platform: 'linkedin',
      externalPostId: 'li-post-001',
      accountName: 'MigaLabs',
      content: 'Launching our social analytics beta this month.',
      isReply: false,
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 18),
      baseline: {
        likes: 30,
        comments: 3,
        impressions: 300,
        savesOrBookmarks: 4,
        shares: 2,
      },
    },
    {
      platform: 'linkedin',
      externalPostId: 'li-post-002',
      accountName: 'MigaLabs',
      content: 'How we measure engagement quality beyond likes.',
      isReply: true,
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 12),
      baseline: {
        likes: 18,
        comments: 2,
        impressions: 220,
        savesOrBookmarks: 3,
        shares: 1,
      },
    },
    {
      platform: 'x',
      externalPostId: 'x-post-001',
      accountName: 'MigaLabsHQ',
      content: 'Post-level analytics trends matter more than one-day spikes.',
      isReply: false,
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 9),
      baseline: {
        likes: 25,
        comments: 6,
        impressions: 700,
        savesOrBookmarks: 5,
        shares: 3,
      },
    },
    {
      platform: 'x',
      externalPostId: 'x-post-002',
      accountName: 'MigaLabsHQ',
      content: 'Which metric predicts campaign outcomes best? We are testing.',
      isReply: true,
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 6),
      baseline: {
        likes: 40,
        comments: 8,
        impressions: 920,
        savesOrBookmarks: 9,
        shares: 6,
      },
    },
  ];
}

function generateSeedPayload(postDocuments, days = 14) {
  const snapshots = postDocuments.flatMap((post) =>
    buildSnapshots(post._id, days, post.baseline)
  );

  return snapshots;
}

module.exports = {
  generateFakePosts,
  generateSeedPayload,
};