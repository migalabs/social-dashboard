require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectToDatabase = require('./config/db');
const Post = require('./models/Post');
const MetricSnapshot = require('./models/MetricSnapshot');
const TwitterResearchSnapshot = require('./models/TwitterResearchSnapshot');
const TwitterAccountSnapshot = require('./models/TwitterAccountSnapshot');
const LinkedInMonthlySnapshot = require('./models/LinkedInMonthlySnapshot');
const { twitterApiGet } = require('./services/twitterApi');
const { syncTwitterHistory } = require('./services/twitterSync');
const { buildContentGapRecommendations, getCryptoTrendAnalysis } = require('./services/twitterResearch');
const { runLinkedInRetentionJob } = require('./services/linkedinRetention');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

function calculateXTotalEngagements({ likes = 0, replies = 0, reposts = 0, linkClicks = 0, profileClicks = 0, mediaClicks = 0, follows = 0 }) {
	return likes + replies + reposts + linkClicks + profileClicks + mediaClicks + follows;
}

function calculateEngagementRate(totalEngagements, impressions) {
	const safeImpressions = Number(impressions) || 0;
	if (safeImpressions <= 0) {
		return 0;
	}

	return Number(((Number(totalEngagements) / safeImpressions) * 100).toFixed(2));
}

const barcelonaDayFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Madrid',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

function getSnapshotDay(snapshotDate) {
	return barcelonaDayFormatter.format(new Date(snapshotDate));
}

function buildDailyTimeseries(snapshots) {
	const latestSnapshotByDay = new Map();

	for (const snapshot of snapshots) {
		latestSnapshotByDay.set(getSnapshotDay(snapshot.collectedAt), snapshot);
	}

	return Array.from(latestSnapshotByDay.values()).map((snapshot) => ({
		totalEngagements: calculateXTotalEngagements({
			likes: snapshot.likesCount,
			replies: snapshot.commentsCount,
			reposts: snapshot.sharesCount,
		}),
		engagementRate: calculateEngagementRate(
			calculateXTotalEngagements({
				likes: snapshot.likesCount,
				replies: snapshot.commentsCount,
				reposts: snapshot.sharesCount,
			}),
			snapshot.impressionsCount
		),
		date: snapshot.collectedAt,
		likes: snapshot.likesCount,
		comments: snapshot.commentsCount,
		impressions: snapshot.impressionsCount,
		savesOrBookmarks: snapshot.savesOrBookmarksCount,
		shares: snapshot.sharesCount,
	}));
}

app.get('/health', (_req, res) => {
	res.json({ status: 'ok' });
});

app.get('/api/posts', async (_req, res) => {
	try {
		const posts = await Post.find({
			content: { $not: /^RT\s+@/i },
		}).sort({ publishedAt: -1 }).lean();
		res.json(posts);
	} catch (error) {
		res.status(500).json({ error: 'Failed to fetch posts' });
	}
});

app.get('/api/posts/:postId/timeseries', async (req, res) => {
	const { postId } = req.params;

	try {
		const snapshots = await MetricSnapshot.find({ post: postId })
			.sort({ collectedAt: 1 })
			.lean();

		res.json(buildDailyTimeseries(snapshots));
	} catch (error) {
		res.status(500).json({ error: 'Failed to fetch time series data' });
	}
});

app.get('/api/overview', async (_req, res) => {
	try {
		const totals = await MetricSnapshot.aggregate([
			{
				$lookup: {
					from: 'posts',
					localField: 'post',
					foreignField: '_id',
					as: 'postDoc',
				},
			},
			{ $unwind: '$postDoc' },
			{ $match: { 'postDoc.content': { $not: /^RT\s+@/i } } },
			{ $sort: { collectedAt: -1 } },
			{
				$group: {
					_id: '$post',
					likes: { $first: '$likesCount' },
					comments: { $first: '$commentsCount' },
					impressions: { $first: '$impressionsCount' },
					savesOrBookmarks: { $first: '$savesOrBookmarksCount' },
					shares: { $first: '$sharesCount' },
				},
			},
			{
				$group: {
					_id: null,
					likes: { $sum: '$likes' },
					comments: { $sum: '$comments' },
					impressions: { $sum: '$impressions' },
					savesOrBookmarks: { $sum: '$savesOrBookmarks' },
					shares: { $sum: '$shares' },
				},
			},
		]);

		const overview = totals[0] || {
			likes: 0,
			comments: 0,
			impressions: 0,
			savesOrBookmarks: 0,
			shares: 0,
		};

		const totalEngagements = calculateXTotalEngagements({
			likes: overview.likes,
			replies: overview.comments,
			reposts: overview.shares,
		});

		res.json({
			...overview,
			totalEngagements,
			engagementRate: calculateEngagementRate(totalEngagements, overview.impressions),
		});
	} catch (error) {
		res.status(500).json({ error: 'Failed to fetch overview data' });
	}
});

app.get('/api/twitter/user/info', async (req, res) => {
	try {
		const result = await twitterApiGet('/twitter/user/info', req.query);
		res.json(result);
	} catch (error) {
		res.status(error.status || 500).json({
			error: 'Failed to fetch Twitter user info',
			details: error.message,
			upstream: error.upstream || null,
		});
	}
});

app.get('/api/twitter/user/last_tweets', async (req, res) => {
	try {
		const result = await twitterApiGet('/twitter/user/last_tweets', req.query);
		res.json(result);
	} catch (error) {
		res.status(error.status || 500).json({
			error: 'Failed to fetch Twitter user last tweets',
			details: error.message,
			upstream: error.upstream || null,
		});
	}
});

app.get('/api/twitter/list/tweets_timeline', async (req, res) => {
	try {
		const result = await twitterApiGet('/twitter/list/tweets_timeline', req.query);
		res.json(result);
	} catch (error) {
		res.status(error.status || 500).json({
			error: 'Failed to fetch Twitter list timeline',
			details: error.message,
			upstream: error.upstream || null,
		});
	}
});

app.get('/api/twitter/research/trends', async (req, res) => {
	try {
		const listId = req.query.listId || process.env.TWITTER_RESEARCH_LIST_ID;
		if (!String(listId || '').trim()) {
			return res.status(400).json({
				error: 'Missing list ID. Set TWITTER_RESEARCH_LIST_ID or pass ?listId=...',
			});
		}

		const forceRefresh = ['1', 'true', 'yes'].includes(
			String(req.query.forceRefresh || '').trim().toLowerCase()
		);

		const latestSnapshot = await TwitterResearchSnapshot.findOne({ listId: String(listId).trim() })
			.sort({ generatedAt: -1 })
			.lean();
		const latestHasTopicTweets =
			Array.isArray(latestSnapshot?.topicTweets) && latestSnapshot.topicTweets.length > 0;
		const latestHasContentGapRecommendations = Array.isArray(
			latestSnapshot?.contentGapRecommendations
		);
		const latestHasContentGapKeywords =
			!latestHasContentGapRecommendations ||
			latestSnapshot.contentGapRecommendations.length === 0 ||
			Array.isArray(latestSnapshot.contentGapRecommendations[0]?.missingKeywords);

		if (
			latestSnapshot &&
			latestHasTopicTweets &&
			latestHasContentGapRecommendations &&
			latestHasContentGapKeywords &&
			!forceRefresh
		) {
			return res.json(latestSnapshot);
		}

		const windowDays = Number(req.query.windowDays || 7);
		const topLimit = Number(req.query.topLimit || 12);
		const result = await getCryptoTrendAnalysis({ listId, windowDays, topLimit });
		const ownPosts = await Post.find({
			publishedAt: {
				$gte: new Date(result.window.from),
				$lte: new Date(result.window.to),
			},
			content: { $not: /^RT\s+@/i },
		})
			.select({ content: 1, platform: 1, publishedAt: 1 })
			.lean();
		const contentGapRecommendations = buildContentGapRecommendations({
			topicBreakdown: result.topicBreakdown,
			topicTweets: result.topicTweets,
			ownPosts,
			limit: Number(req.query.gapLimit || 6),
		});
		const responsePayload = {
			...result,
			contentGapRecommendations,
		};
		await TwitterResearchSnapshot.create({
			listId: responsePayload.listId,
			queryUsed: responsePayload.queryUsed,
			window: responsePayload.window,
			fetchedTweets: responsePayload.fetchedTweets,
			analyzedTweets: responsePayload.analyzedTweets,
			topHashtags: responsePayload.topHashtags,
			topKeywords: responsePayload.topKeywords,
			topicBreakdown: responsePayload.topicBreakdown,
			dailyVolume: responsePayload.dailyVolume,
			mostEngagedTweets: responsePayload.mostEngagedTweets,
			topicTweets: responsePayload.topicTweets,
			contentGapRecommendations: responsePayload.contentGapRecommendations,
			generatedAt: new Date(),
		});
		return res.json(responsePayload);
	} catch (error) {
		return res.status(error.status || 500).json({
			error: 'Failed to analyze Twitter research trends',
			details: error.message,
			attempts: error.attempts || [],
			upstream: error.upstream || null,
		});
	}
});

app.get('/api/twitter/research/latest', async (_req, res) => {
	try {
		const latestSnapshot = await TwitterResearchSnapshot.findOne()
			.sort({ generatedAt: -1 })
			.lean();

		if (latestSnapshot) {
			return res.json(latestSnapshot);
		}

		return res.status(404).json({
			error: 'No research snapshot available yet',
		});
	} catch (error) {
		return res.status(error.status || 500).json({
			error: 'Failed to fetch latest Twitter research snapshot',
			details: error.message,
			upstream: error.upstream || null,
		});
	}
});

app.get('/api/twitter/followers/growth', async (req, res) => {
	try {
		const requestedDays = Number(req.query.days || 30);
		const days = Number.isFinite(requestedDays)
			? Math.min(365, Math.max(1, Math.round(requestedDays)))
			: 30;

		const requestedHandles = String(req.query.handles || '')
			.split(',')
			.map((handle) => handle.trim().replace(/^@/, '').toLowerCase())
			.filter(Boolean);

		const handles =
			requestedHandles.length > 0
				? Array.from(new Set(requestedHandles))
				: await Post.distinct('accountHandle', {
					platform: 'x',
					accountHandle: { $ne: '' },
				});

		if (handles.length === 0) {
			return res.json({
				days,
				totalGrowth: 0,
				from: null,
				to: null,
				handles: [],
			});
		}

		const now = new Date();
		const startBound = new Date(now);
		startBound.setUTCDate(startBound.getUTCDate() - days);

		const handleRows = [];

		for (const handle of handles) {
			const windowSnapshots = await TwitterAccountSnapshot.find({
				accountHandle: handle,
				collectedAt: { $gte: startBound, $lte: now },
			})
				.sort({ collectedAt: 1 })
				.lean();

			if (windowSnapshots.length < 2) {
				continue;
			}

			const baselineSnapshot = windowSnapshots[0];
			const latestSnapshot = windowSnapshots[windowSnapshots.length - 1];

			const growth = Number(latestSnapshot.followersCount || 0) - Number(baselineSnapshot.followersCount || 0);
			const observedDays = Math.max(
				1,
				Math.round(
					(new Date(latestSnapshot.collectedAt).getTime() -
						new Date(baselineSnapshot.collectedAt).getTime()) /
						86400000
				) + 1
			);

			handleRows.push({
				handle,
				growth,
				previousFollowers: Number(baselineSnapshot.followersCount || 0),
				latestFollowers: Number(latestSnapshot.followersCount || 0),
				from: baselineSnapshot.collectedAt,
				to: latestSnapshot.collectedAt,
				days: observedDays,
			});
		}

		if (handleRows.length === 0) {
			return res.json({
				days,
				totalGrowth: 0,
				from: null,
				to: null,
				handles: [],
			});
		}

		const totalGrowth = handleRows.reduce((sum, row) => sum + row.growth, 0);
		const from = handleRows
			.map((row) => new Date(row.from).getTime())
			.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
		const to = handleRows
			.map((row) => new Date(row.to).getTime())
			.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
		const observedDays =
			Number.isFinite(from) && Number.isFinite(to)
				? Math.max(1, Math.round((to - from) / 86400000) + 1)
				: 0;

		return res.json({
			days,
			totalGrowth,
			from: Number.isFinite(from) ? new Date(from).toISOString() : null,
			to: Number.isFinite(to) ? new Date(to).toISOString() : null,
			observedDays,
			handles: handleRows,
		});
	} catch (error) {
		return res.status(500).json({
			error: 'Failed to fetch Twitter follower growth',
			details: error.message,
		});
	}
});

app.post('/api/twitter/sync', async (req, res) => {
	try {
		const bodyHandles = Array.isArray(req.body?.handles) ? req.body.handles : [];
		const envHandles = String(process.env.TWITTER_SYNC_USERS || '')
			.split(',')
			.map((handle) => handle.trim())
			.filter(Boolean);
		const handles = bodyHandles.length > 0 ? bodyHandles : envHandles;

		if (handles.length === 0) {
			return res.status(400).json({
				error: 'No handles provided. Set TWITTER_SYNC_USERS or pass { handles: [...] } in request body.',
			});
		}

		const trackingWindowDays = Number(
			req.body?.trackingWindowDays || process.env.TWITTER_TRACKING_WINDOW_DAYS || 120
		);
		const summary = await syncTwitterHistory({ handles, trackingWindowDays });
		return res.json(summary);
	} catch (error) {
		return res.status(error.status || 500).json({
			error: 'Failed to sync Twitter history',
			details: error.message,
			upstream: error.upstream || null,
		});
	}
});

app.post('/api/linkedin/retention/run', async (_req, res) => {
	try {
		const result = await runLinkedInRetentionJob();
		return res.json(result);
	} catch (error) {
		return res.status(500).json({
			error: 'LinkedIn retention job failed',
			details: error.message,
		});
	}
});

app.get('/api/linkedin/monthly-snapshots', async (req, res) => {
	try {
		const { postId, year, month } = req.query;
		const filter = {};

		if (postId) {
			filter.post = postId;
		} else {
			const linkedinPostIds = await Post.distinct('_id', { platform: 'linkedin' });
			filter.post = { $in: linkedinPostIds };
		}

		if (year) filter.year = Number(year);
		if (month) filter.month = Number(month);

		const snapshots = await LinkedInMonthlySnapshot.find(filter)
			.sort({ year: -1, month: -1 })
			.lean();

		return res.json(snapshots);
	} catch (error) {
		return res.status(500).json({
			error: 'Failed to fetch LinkedIn monthly snapshots',
			details: error.message,
		});
	}
});

async function startServer() {
	await connectToDatabase();

	app.listen(PORT, () => {
		console.log(`Backend listening on http://localhost:${PORT}`);
	});
}

startServer().catch((error) => {
	console.error('Failed to start server:', error.message);
	process.exit(1);
});
