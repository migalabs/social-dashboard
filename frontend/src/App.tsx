import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'

type Post = {
  _id: string
  platform: 'linkedin' | 'x'
  externalPostId: string
  accountName: string
  content: string
  isReply: boolean
  publishedAt: string
}

type TimeseriesPoint = {
  date: string
  likes: number
  comments: number
  impressions: number
  savesOrBookmarks: number
  shares: number
}

type EnrichedPoint = TimeseriesPoint & {
  createdAt: string
  likeCount: number
  retweetCount: number
  replyCount: number
  quoteCount: number
  bookmarkCount: number
  viewCount: number
  engagementRate: number
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'
const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
type Page = 'insights' | 'linkedin' | 'x'

function App() {
  const [activePage, setActivePage] = useState<Page>('insights')
  const [posts, setPosts] = useState<Post[]>([])
  const [allSeriesByPost, setAllSeriesByPost] = useState<Record<string, TimeseriesPoint[]>>({})
  const [selectedPostByPlatform, setSelectedPostByPlatform] = useState<Record<'linkedin' | 'x', string>>({
    linkedin: '',
    x: '',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true)
      setError('')

      try {
        const postsResponse = await fetch(`${API_BASE_URL}/api/posts`)

        if (!postsResponse.ok) {
          throw new Error('Unable to load dashboard data.')
        }

        const postsData = (await postsResponse.json()) as Post[]
        setPosts(postsData)

        const linkedinFirst = postsData.find((post) => post.platform === 'linkedin')
        const xFirst = postsData.find((post) => post.platform === 'x')
        setSelectedPostByPlatform({
          linkedin: linkedinFirst?._id ?? '',
          x: xFirst?._id ?? '',
        })
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [])

  useEffect(() => {
    if (posts.length === 0) {
      return
    }

    async function loadAllSeries() {
      try {
        const responses = await Promise.all(
          posts.map((post) => fetch(`${API_BASE_URL}/api/posts/${post._id}/timeseries`))
        )

        if (responses.some((response) => !response.ok)) {
          throw new Error('Unable to load full series data.')
        }

        const payload = await Promise.all(
          responses.map((response) => response.json() as Promise<TimeseriesPoint[]>)
        )

        const map: Record<string, TimeseriesPoint[]> = {}
        posts.forEach((post, index) => {
          map[post._id] = payload[index]
        })
        setAllSeriesByPost(map)
      } catch (seriesLoadError) {
        setError(seriesLoadError instanceof Error ? seriesLoadError.message : 'Unknown error')
      }
    }

    loadAllSeries()
  }, [posts])

  const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value)

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })

  function enrichSeries(points: TimeseriesPoint[]): EnrichedPoint[] {
    return points.map((point) => {
      const engagement = point.likes + point.comments + point.shares
      const engagementRate =
        point.impressions > 0 ? Number(((engagement / point.impressions) * 100).toFixed(2)) : 0

      return {
        ...point,
        createdAt: point.date,
        likeCount: point.likes,
        retweetCount: point.shares,
        replyCount: point.comments,
        quoteCount: Math.max(1, Math.floor(point.shares * 0.45)),
        bookmarkCount: point.savesOrBookmarks,
        viewCount: point.impressions,
        engagementRate,
      }
    })
  }

  const mixColors = ['#da6b61', '#73c476', '#5590f3', '#e1b75c']

  const activePlatform = activePage === 'linkedin' || activePage === 'x' ? activePage : null

  const platformPosts = useMemo(
    () => (activePlatform ? posts.filter((post) => post.platform === activePlatform) : []),
    [posts, activePlatform]
  )

  const selectedPostId = activePlatform ? selectedPostByPlatform[activePlatform] : ''
  const selectedPost = useMemo(
    () => platformPosts.find((post) => post._id === selectedPostId) ?? null,
    [platformPosts, selectedPostId]
  )

  const selectedSeries = useMemo(
    () => (selectedPostId ? enrichSeries(allSeriesByPost[selectedPostId] ?? []) : []),
    [selectedPostId, allSeriesByPost]
  )
  const latestPoint = selectedSeries[selectedSeries.length - 1]

  const latestByPost = useMemo(() => {
    return platformPosts
      .map((post) => {
        const postSeries = allSeriesByPost[post._id] ?? []
        const latest = postSeries[postSeries.length - 1]
        if (!latest) {
          return null
        }

        return {
          ...post,
          ...enrichSeries([latest])[0],
          createdAt: post.publishedAt,
        }
      })
      .filter((post): post is NonNullable<typeof post> => post !== null)
  }, [platformPosts, allSeriesByPost])

  const overviewForPage = useMemo(() => {
    return latestByPost.reduce(
      (acc, post) => {
        acc.likes += post.likeCount
        acc.comments += post.replyCount
        acc.impressions += post.viewCount
        acc.savesOrBookmarks += post.bookmarkCount
        acc.shares += post.retweetCount
        return acc
      },
      { likes: 0, comments: 0, impressions: 0, savesOrBookmarks: 0, shares: 0 }
    )
  }, [latestByPost])

  const overviewMix = useMemo(
    () => [
      { name: 'Likes', value: overviewForPage.likes },
      { name: 'Comments', value: overviewForPage.comments },
      { name: 'Saves', value: overviewForPage.savesOrBookmarks },
      { name: 'Shares', value: overviewForPage.shares },
    ],
    [overviewForPage]
  )

  const postsByWeekday = useMemo(() => {
    const buckets = new Map<string, { sum: number; count: number }>()
    WEEKDAY_ORDER.forEach((day) => buckets.set(day, { sum: 0, count: 0 }))

    latestByPost.forEach((post) => {
      const day = WEEKDAY_ORDER[new Date(post.createdAt).getDay()]
      const bucket = buckets.get(day)
      if (!bucket) {
        return
      }
      bucket.sum += post.likeCount
      bucket.count += 1
    })

    return WEEKDAY_ORDER.map((day) => {
      const bucket = buckets.get(day)
      const avgLikeCount = bucket && bucket.count > 0 ? Number((bucket.sum / bucket.count).toFixed(1)) : 0
      return { day, avgLikeCount }
    })
  }, [latestByPost])

  const radarMix = useMemo(() => {
    if (!latestPoint) {
      return []
    }

    const metrics = [
      { metric: 'Likes', value: latestPoint.likeCount },
      { metric: 'Retweets', value: latestPoint.retweetCount },
      { metric: 'Replies', value: latestPoint.replyCount },
      { metric: 'Quotes', value: latestPoint.quoteCount },
      { metric: 'Bookmarks', value: latestPoint.bookmarkCount },
    ]
    const maxValue = Math.max(...metrics.map((item) => item.value), 1)

    return metrics.map((item) => ({
      ...item,
      normalized: Number(((item.value / maxValue) * 100).toFixed(1)),
    }))
  }, [latestPoint])

  const scatterViewsLikes = useMemo(
    () =>
      latestByPost.map((post) => ({
        x: post.viewCount,
        y: post.likeCount,
        label: post.externalPostId,
      })),
    [latestByPost]
  )

  const stackedByWeek = useMemo(() => {
    const weekMap = new Map<
      string,
      {
        week: string
        likeCount: number
        retweetCount: number
        replyCount: number
        quoteCount: number
        bookmarkCount: number
      }
    >()

    platformPosts.forEach((post) => {
      const postSeries = allSeriesByPost[post._id] ?? []
      postSeries.forEach((point) => {
        const date = new Date(point.date)
        const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
        const dayOffset = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000)
        const weekNumber = Math.ceil((dayOffset + startOfYear.getUTCDay() + 1) / 7)
        const week = `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`

        const existing = weekMap.get(week) ?? {
          week,
          likeCount: 0,
          retweetCount: 0,
          replyCount: 0,
          quoteCount: 0,
          bookmarkCount: 0,
        }

        const enriched = enrichSeries([point])[0]
        existing.likeCount += enriched.likeCount
        existing.retweetCount += enriched.retweetCount
        existing.replyCount += enriched.replyCount
        existing.quoteCount += enriched.quoteCount
        existing.bookmarkCount += enriched.bookmarkCount
        weekMap.set(week, existing)
      })
    })

    return Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week))
  }, [platformPosts, allSeriesByPost])

  const replyVsOriginal = useMemo(() => {
    let replies = 0
    let originals = 0

    platformPosts.forEach((post) => {
      if (post.isReply) {
        replies += 1
      } else {
        originals += 1
      }
    })

    return [
      { name: 'Replies', value: replies },
      { name: 'Original Posts', value: originals },
    ]
  }, [platformPosts])

  const linkedinCardMetrics = useMemo(() => {
    const clicks = Math.max(0, Math.round(overviewForPage.impressions * 0.07))
    const engagementRate =
      overviewForPage.impressions > 0
        ? ((overviewForPage.likes + overviewForPage.comments + overviewForPage.shares) /
            overviewForPage.impressions) *
          100
        : 0
    const followerGrowth = Math.max(0, Math.round(platformPosts.length * 14 + overviewForPage.comments * 0.65))

    let minTimestamp = Number.POSITIVE_INFINITY
    let maxTimestamp = Number.NEGATIVE_INFINITY

    platformPosts.forEach((post) => {
      const series = allSeriesByPost[post._id] ?? []
      series.forEach((point) => {
        const timestamp = new Date(point.date).getTime()
        if (!Number.isNaN(timestamp)) {
          minTimestamp = Math.min(minTimestamp, timestamp)
          maxTimestamp = Math.max(maxTimestamp, timestamp)
        }
      })
    })

    const followerGrowthDays =
      Number.isFinite(minTimestamp) && Number.isFinite(maxTimestamp)
        ? Math.max(1, Math.round((maxTimestamp - minTimestamp) / 86400000) + 1)
        : 0

    const topPost = latestByPost.reduce(
      (best, post) => {
        const score = post.likeCount + post.replyCount + post.retweetCount * 1.2
        if (score > best.score) {
          return { title: post.content, score }
        }
        return best
      },
      { title: 'No post available', score: -1 }
    )

    return {
      impressions: overviewForPage.impressions,
      engagementRate,
      followerGrowth,
      followerGrowthDays,
      clicks,
      topPostTitle: topPost.title,
    }
  }, [overviewForPage, platformPosts, allSeriesByPost, latestByPost])

  const xCardMetrics = useMemo(() => {
    const engagement =
      overviewForPage.likes +
      overviewForPage.comments +
      overviewForPage.shares +
      overviewForPage.savesOrBookmarks
    const engagementRate =
      overviewForPage.impressions > 0 ? (engagement / overviewForPage.impressions) * 100 : 0

    return {
      impressions: overviewForPage.impressions,
      engagementRate,
      reposts: overviewForPage.shares,
      likes: overviewForPage.likes,
      profileVisits: null as number | null,
    }
  }, [overviewForPage])

  const insightsSummary = useMemo(() => {
    const analyzed = posts
      .map((post) => {
        const rawSeries = allSeriesByPost[post._id] ?? []
        const enriched = enrichSeries(rawSeries)
        if (enriched.length === 0) {
          return null
        }

        const first = enriched[0]
        const last = enriched[enriched.length - 1]
        const firstEngagement = first.likeCount + first.replyCount + first.retweetCount
        const lastEngagement = last.likeCount + last.replyCount + last.retweetCount

        return {
          post,
          first,
          last,
          engagementChange: Math.abs(lastEngagement - firstEngagement),
          currentEngagement: lastEngagement,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

    const totals = analyzed.reduce(
      (acc, item) => {
        acc.impressions += item.last.viewCount
        acc.engagement += item.currentEngagement
        return acc
      },
      { impressions: 0, engagement: 0 }
    )

    const kpiEngagementRate =
      totals.impressions > 0 ? (totals.engagement / totals.impressions) * 100 : 0

    const topPost = analyzed.reduce(
      (best, item) =>
        item.currentEngagement > best.currentEngagement
          ? {
              title: item.post.content,
              platform: item.post.platform,
              currentEngagement: item.currentEngagement,
              content: item.post.content,
            }
          : best,
      {
        title: 'No post available',
        platform: 'linkedin',
        currentEngagement: 0,
        content: 'No data available',
      }
    )

    const worstPost = analyzed.reduce(
      (worst, item) =>
        item.engagementChange < worst.engagementChange
          ? {
              title: item.post.content,
              platform: item.post.platform,
              engagementChange: item.engagementChange,
              content: item.post.content,
            }
          : worst,
      {
        title: 'No post available',
        platform: 'linkedin',
        engagementChange: Number.POSITIVE_INFINITY,
        content: 'No data available',
      }
    )

    return {
      kpiEngagementRate,
      topPost,
      worstPost:
        worstPost.engagementChange === Number.POSITIVE_INFINITY
          ? { ...worstPost, engagementChange: 0 }
          : worstPost,
    }
  }, [posts, allSeriesByPost])

  if (loading) {
    return <main className="app-shell">Loading dashboard...</main>
  }

  if (error && posts.length === 0) {
    return <main className="app-shell">Error: {error}</main>
  }

  const tabButton = (label: string, page: Page) => (
    <button
      type="button"
      className={`nav-link ${activePage === page ? 'is-active' : ''}`}
      onClick={() => setActivePage(page)}
    >
      {label}
    </button>
  )

  const renderInsights = () => (
    <>
      <header className="hero-panel">
        <p className="eyebrow">MigaLabs Social Media</p>
        <h1>Insights</h1>
        <p className="hero-copy">Cross-platform summary with key performance indicators and post-level signal quality.</p>
      </header>

      <section className="overview-grid" aria-label="Insights summary cards">
        <article className="metric-card">
          <h2>KPI</h2>
          <p>{insightsSummary.kpiEngagementRate.toFixed(2)}%</p>
          <small className="metric-subtext">Overall engagement rate</small>
        </article>
      </section>

      <section className="content-grid insights-grid">
        <article className="panel">
          <div className="panel-title-row">
            <h2>Top Post</h2>
            <span>{insightsSummary.topPost.platform.toUpperCase()}</span>
          </div>
          <p className="selected-content">{insightsSummary.topPost.content}</p>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Worst Post</h2>
            <span>{insightsSummary.worstPost.platform.toUpperCase()}</span>
          </div>
          <p className="selected-content">{insightsSummary.worstPost.content}</p>
        </article>

        <article className="panel insights-trends-placeholder">
          <div className="panel-title-row">
            <h2>Tracking Trends</h2>
            <span>coming soon</span>
          </div>
          <p className="selected-content">This section will chart rolling movement across LinkedIn and X over time.</p>
        </article>
      </section>
    </>
  )

  const renderPlatformPage = () => (
    <>
      <header className="hero-panel">
        <p className="eyebrow">MigaLabs Social Media</p>
        <h1>{activePlatform === 'linkedin' ? 'LinkedIn Analytics' : 'X Analytics'}</h1>
        <p className="hero-copy">Platform-specific mock analytics feed with charted trends and engagement composition.</p>
      </header>

      <section
        className={`overview-grid ${activePlatform === 'x' ? 'x-overview-grid' : ''}`}
        aria-label="Overview metrics"
      >
        {activePlatform === 'linkedin' ? (
          <>
            <article className="metric-card">
              <h2>Impressions</h2>
              <p>{formatNumber(linkedinCardMetrics.impressions)}</p>
            </article>
            <article className="metric-card">
              <h2>Engagement Rate</h2>
              <p>{linkedinCardMetrics.engagementRate.toFixed(2)}%</p>
            </article>
            <article className="metric-card">
              <h2>Follower Growth</h2>
              <p>+{formatNumber(linkedinCardMetrics.followerGrowth)}</p>
              <small className="metric-subtext">
                {linkedinCardMetrics.followerGrowthDays > 0
                  ? `Last ${linkedinCardMetrics.followerGrowthDays} days`
                  : 'Time window unavailable'}
              </small>
            </article>
            <article className="metric-card">
              <h2>Clicks</h2>
              <p>{formatNumber(linkedinCardMetrics.clicks)}</p>
            </article>
            <article className="metric-card">
              <h2>Top Post</h2>
              <p className="metric-post-title">{linkedinCardMetrics.topPostTitle}</p>
            </article>
          </>
        ) : (
          <>
            <article className="metric-card">
              <h2>Impressions</h2>
              <p>{formatNumber(xCardMetrics.impressions)}</p>
            </article>
            <article className="metric-card">
              <h2>Engagement Rate</h2>
              <p>{xCardMetrics.engagementRate.toFixed(2)}%</p>
            </article>
            <article className="metric-card">
              <h2>Repost</h2>
              <p>{formatNumber(xCardMetrics.reposts)}</p>
            </article>
            <article className="metric-card">
              <h2>Likes</h2>
              <p>{formatNumber(xCardMetrics.likes)}</p>
            </article>
            <article className="metric-card">
              <h2>Profile Visits</h2>
              <p>{xCardMetrics.profileVisits === null ? '--' : formatNumber(xCardMetrics.profileVisits)}</p>
              <small className="metric-subtext">Unavailable until API integration</small>
            </article>
          </>
        )}
      </section>

      <section className="content-grid">
        <article className="panel post-panel">
          <div className="panel-title-row">
            <h2>Posts</h2>
            <span>{platformPosts.length} records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Account</th>
                  <th>Content</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {platformPosts.map((post) => (
                  <tr
                    key={post._id}
                    className={selectedPostId === post._id ? 'is-selected' : ''}
                    onClick={() =>
                      activePlatform &&
                      setSelectedPostByPlatform((prev) => ({ ...prev, [activePlatform]: post._id }))
                    }
                  >
                    <td>{post.platform.toUpperCase()}</td>
                    <td>{post.accountName}</td>
                    <td>{post.content}</td>
                    <td>{formatDate(post.publishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel chart-panel">
          <div className="panel-title-row">
            <h2>Engagement Over Time</h2>
            <span>{selectedPost?.externalPostId ?? 'No post selected'}</span>
          </div>

          <p className="selected-content">{selectedPost?.content ?? 'Select a post from the table.'}</p>

          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={selectedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3d4354" />
                <XAxis dataKey="createdAt" tickFormatter={formatDate} />
                <YAxis />
                <Tooltip
                  labelFormatter={(value) => formatDate(String(value))}
                  formatter={(value) => formatNumber(Number(value ?? 0))}
                />
                <Legend />
                <Bar dataKey="retweetCount" name="Retweets" fill="#5590f3" barSize={14} />
                <Line type="monotone" dataKey="likeCount" name="Likes" stroke="#fd8b5d" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="replyCount" name="Replies" stroke="#73c476" strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {error && <p className="error-text">{error}</p>}
        </article>
      </section>

      <section className="chart-grid-secondary">
        <article className="panel">
          <div className="panel-title-row">
            <h2>Views vs Engagement Rate</h2>
            <span>per day</span>
          </div>
          <div className="chart-wrap compact">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={selectedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3d4354" />
                <XAxis dataKey="createdAt" tickFormatter={formatDate} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" unit="%" domain={[0, 'auto']} />
                <Tooltip
                  labelFormatter={(value) => formatDate(String(value))}
                  formatter={(value, name) => {
                    if (name === 'engagementRate') {
                      return `${Number(value ?? 0).toFixed(2)}%`
                    }
                    return formatNumber(Number(value ?? 0))
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="viewCount"
                  name="Views"
                  yAxisId="left"
                  stroke="#00aad0"
                  fill="#0e3046"
                  fillOpacity={0.55}
                  strokeWidth={2.25}
                />
                <Area
                  type="monotone"
                  dataKey="engagementRate"
                  name="Engagement Rate"
                  yAxisId="right"
                  stroke="#8c79e0"
                  fill="#2f2f4d"
                  fillOpacity={0.55}
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Posts by Day of Week</h2>
            <span>avg likes</span>
          </div>
          <div className="chart-wrap compact">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={postsByWeekday}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3d4354" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip formatter={(value) => formatNumber(Number(value ?? 0))} />
                <Bar dataKey="avgLikeCount" name="Avg Likes" fill="#00aad0" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Engagement Mix Radar</h2>
            <span>0-100 normalized</span>
          </div>
          <div className="chart-wrap compact">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart outerRadius={88} data={radarMix}>
                <PolarGrid stroke="#3d4354" />
                <PolarAngleAxis dataKey="metric" stroke="#d1d5dc" />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  name="Normalized"
                  dataKey="normalized"
                  stroke="#f69f72"
                  fill="#e05d38"
                  fillOpacity={0.35}
                />
                <Tooltip formatter={(value) => `${Number(value ?? 0).toFixed(1)}%`} />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Views vs Likes Scatter</h2>
            <span>one dot per post</span>
          </div>
          <div className="chart-wrap compact">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#3d4354" />
                <XAxis dataKey="x" name="Views" />
                <YAxis dataKey="y" name="Likes" />
                <Tooltip formatter={(value) => formatNumber(Number(value ?? 0))} />
                <Scatter name="Posts" data={scatterViewsLikes} fill="#5590f3" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Stacked Engagement by Week</h2>
            <span>trend composition</span>
          </div>
          <div className="chart-wrap compact">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedByWeek}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3d4354" />
                <XAxis dataKey="week" />
                <YAxis />
                <Tooltip formatter={(value) => formatNumber(Number(value ?? 0))} />
                <Legend />
                <Bar dataKey="likeCount" name="Likes" stackId="eng" fill="#fd8b5d" />
                <Bar dataKey="retweetCount" name="Retweets" stackId="eng" fill="#5590f3" />
                <Bar dataKey="replyCount" name="Replies" stackId="eng" fill="#73c476" />
                <Bar dataKey="quoteCount" name="Quotes" stackId="eng" fill="#8c79e0" />
                <Bar dataKey="bookmarkCount" name="Bookmarks" stackId="eng" fill="#e1b75c" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Reply vs Original Mix</h2>
            <span>post type split</span>
          </div>
          <div className="chart-wrap compact pie">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={replyVsOriginal}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={88}
                  paddingAngle={4}
                >
                  {replyVsOriginal.map((entry, index) => (
                    <Cell key={entry.name} fill={mixColors[index % mixColors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatNumber(Number(value ?? 0))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Portfolio Mix</h2>
            <span>all posts</span>
          </div>
          <div className="chart-wrap compact pie">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={overviewMix}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={88}
                  paddingAngle={4}
                >
                  {overviewMix.map((entry, index) => (
                    <Cell key={entry.name} fill={mixColors[index % mixColors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatNumber(Number(value ?? 0))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>
    </>
  )

  return (
    <main className="app-shell">
      <nav className="top-nav" aria-label="Main pages">
        {tabButton('LinkedIn', 'linkedin')}
        {tabButton('X', 'x')}
        {tabButton('Insights', 'insights')}
      </nav>

      {activePage === 'insights' ? renderInsights() : renderPlatformPage()}
    </main>
  )
}

export default App
