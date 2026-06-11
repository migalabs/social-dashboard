require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectToDatabase = require('./config/db');
const Post = require('./models/Post');
const MetricSnapshot = require('./models/MetricSnapshot');
const { twitterApiGet } = require('./services/twitterApi');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
	res.json({ status: 'ok' });
});

app.get('/api/posts', async (_req, res) => {
	try {
		const posts = await Post.find().sort({ publishedAt: -1 }).lean();
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

		res.json(
			totals[0] || {
				likes: 0,
				comments: 0,
				impressions: 0,
				savesOrBookmarks: 0,
				shares: 0,
			}
		);
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
