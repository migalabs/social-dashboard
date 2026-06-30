## Impressions extraction

impressions = first finite value from:

1. metrics.impression_count
2. metrics.view_count
3. rawTweet.impression_count
4. rawTweet.view_count
5. rawTweet.viewCount
6. rawTweet.impressions

If none are present, use 0.

## Tweet engagement

X engagement rate:

engagement_rate = (total_engagements / impressions) * 100

total_engagements =
  likes + replies + reposts + link_clicks + profile_clicks + media_clicks + follows_from_post

Current implementation uses available official fields in this codebase:

total_engagements_available = likes + replies + reposts

Follower growth:

follower_growth = current_followers - previous_followers

follower_growth_percent = ((current_followers - previous_followers) / previous_followers) * 100

When previous_followers <= 0, follower_growth_percent = null.

score_legacy = likes + 2 * replies + 2 * retweets + 2 * quotes + bookmarks

weighted_engagement =
  (1.0 * likes)
  + (4.0 * replies)
  + (3.5 * retweets)
  + (4.0 * quotes)
  + (4.5 * bookmarks)
  + (4.0 * log(1 + impressions))

## Time decay

half_life_hours = 48
lambda = ln(2) / half_life_hours

age_hours = max(0, (now - published_at) / 3600)
recency_multiplier = exp(-lambda * age_hours)

weighted_trend_score = weighted_engagement * recency_multiplier

## Entity aggregation

For each hashtag, keyword, and topic:

mention_count += 1
weighted_engagement_sum += weighted_engagement
weighted_trend_sum += weighted_trend_score
recency_sum += recency_multiplier

Deduplicate mentions per tweet before counting.

## Momentum score

The window is split into previous half and recent half.

recent_weighted_trend_sum = sum(weighted_trend_score in recent half)
previous_weighted_trend_sum = sum(weighted_trend_score in previous half)

if previous_weighted_trend_sum > 0:
  acceleration_raw = (recent_weighted_trend_sum - previous_weighted_trend_sum) / previous_weighted_trend_sum
else:
  acceleration_raw = 1 if recent_weighted_trend_sum > 0 else 0

acceleration_normalized = (clamp(acceleration_raw, -1, 3) + 1) / 4

avg_weighted_engagement = weighted_engagement_sum / mention_count
avg_recency = recency_sum / mention_count

volume_component = log(1 + mention_count)
engagement_component = log(1 + avg_weighted_engagement)
recency_component = clamp(avg_recency, 0, 1)

momentum_score = 100 * (
  0.35 * volume_component +
  0.35 * engagement_component +
  0.20 * recency_component +
  0.10 * acceleration_normalized
)

Ranking: momentum_score desc, then weighted_trend_sum desc.

## Unified trend list

unifiedTrendingEntities = ranked topics + hashtags + keywords, sorted by momentum_score.

## Other statistics

Most engaged tweets: sort by weighted_trend_score desc.

Daily volume: count tweets per YYYY-MM-DD bucket.

Overview totals: sum the latest snapshot per post for likes, comments, impressions, saves/bookmarks, and shares.

Sync window rule:

tracking_enabled = (tweet_published_at >= collected_at - tracking_window_days)
