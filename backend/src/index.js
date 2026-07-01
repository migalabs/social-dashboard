require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectToDatabase = require('./config/db');
const Post = require('./models/Post');
const MetricSnapshot = require('./models/MetricSnapshot');
const TwitterResearchSnapshot = require('./models/TwitterResearchSnapshot');
const LinkedInMonthlySnapshot = require('./models/LinkedInMonthlySnapshot');
const { twitterApiGet } = require('./services/twitterApi');
const { syncTwitterHistory } = require('./services/twitterSync');
const { getCryptoTrendAnalysis } = require('./services/twitterResearch');
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

		res.json(
			snapshots.map((snapshot) => ({
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
			}))
		);
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

		const latestSnapshot = await TwitterResearchSnapshot.findOne({ listId: String(listId).trim() })
			.sort({ generatedAt: -1 })
			.lean();

		if (latestSnapshot) {
			return res.json(latestSnapshot);
		}

		const windowDays = Number(req.query.windowDays || 7);
		const topLimit = Number(req.query.topLimit || 12);
		const result = await getCryptoTrendAnalysis({ listId, windowDays, topLimit });
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
			generatedAt: new Date(),
		});
		return res.json(result);
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
