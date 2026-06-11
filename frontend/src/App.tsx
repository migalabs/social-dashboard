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

type Overview = {
  likes: number
  comments: number
  impressions: number
  savesOrBookmarks: number
  shares: number
}

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

function App() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [series, setSeries] = useState<TimeseriesPoint[]>([])
  const [allSeriesByPost, setAllSeriesByPost] = useState<Record<string, TimeseriesPoint[]>>({})
  const [selectedPostId, setSelectedPostId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingSeries, setLoadingSeries] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true)
      setError('')

      try {
        const [overviewResponse, postsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/overview`),
          fetch(`${API_BASE_URL}/api/posts`),
        ])

        if (!overviewResponse.ok || !postsResponse.ok) {
          throw new Error('Unable to load dashboard data.')
        }

        const overviewData = (await overviewResponse.json()) as Overview
        const postsData = (await postsResponse.json()) as Post[]

        setOverview(overviewData)
        setPosts(postsData)

        if (postsData.length > 0) {
          setSelectedPostId(postsData[0]._id)
        }
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
      setAllSeriesByPost({})
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

  useEffect(() => {
    if (!selectedPostId) {
      setSeries([])
      return
    }

    const cachedSeries = allSeriesByPost[selectedPostId]
    if (cachedSeries) {
      setSeries(cachedSeries)
      return
    }

    async function loadSeriesForSelectedPost() {
      setLoadingSeries(true)
      setError('')

      try {
        const response = await fetch(`${API_BASE_URL}/api/posts/${selectedPostId}/timeseries`)

        if (!response.ok) {
          throw new Error('Unable to load post trend data.')
        }

        const data = (await response.json()) as TimeseriesPoint[]
        setSeries(data)
        setAllSeriesByPost((previous) => ({ ...previous, [selectedPostId]: data }))
      } catch (seriesError) {
        setError(seriesError instanceof Error ? seriesError.message : 'Unknown error')
      } finally {
        setLoadingSeries(false)
      }
    }

    loadSeriesForSelectedPost()
  }, [selectedPostId, allSeriesByPost])

  const selectedPost = useMemo(
    () => posts.find((post) => post._id === selectedPostId) ?? null,
    [posts, selectedPostId]
  )

  const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value)

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })

  const selectedSeries: EnrichedPoint[] = useMemo(
    () =>
      series.map((point) => {
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
      }),
    [series]
  )

  const latestPoint = selectedSeries[selectedSeries.length - 1]

  const overviewMix = useMemo(() => {
    if (!overview) {
      return []
    }

    return [
      { name: 'Likes', value: overview.likes },
      { name: 'Comments', value: overview.comments },
      { name: 'Saves', value: overview.savesOrBookmarks },
      { name: 'Shares', value: overview.shares },
    ]
  }, [overview])

  const mixColors = ['#da6b61', '#73c476', '#5590f3', '#e1b75c']

  const latestByPost = useMemo(() => {
    return posts
      .map((post) => {
        const postSeries = allSeriesByPost[post._id] ?? []
        const latest = postSeries[postSeries.length - 1]
        if (!latest) {
          return null
        }

        return {
          ...post,
          likeCount: latest.likes,
          retweetCount: latest.shares,
          replyCount: latest.comments,
          quoteCount: Math.max(1, Math.floor(latest.shares * 0.45)),
          bookmarkCount: latest.savesOrBookmarks,
          viewCount: latest.impressions,
          createdAt: post.publishedAt,
        }
      })
      .filter((post): post is NonNullable<typeof post> => post !== null)
  }, [posts, allSeriesByPost])

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

    Object.values(allSeriesByPost).forEach((postSeries) => {
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

        existing.likeCount += point.likes
        existing.retweetCount += point.shares
        existing.replyCount += point.comments
        existing.quoteCount += Math.max(1, Math.floor(point.shares * 0.45))
        existing.bookmarkCount += point.savesOrBookmarks
        weekMap.set(week, existing)
      })
    })

    return Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week))
  }, [allSeriesByPost])

  const replyVsOriginal = useMemo(() => {
    let replies = 0
    let originals = 0

    posts.forEach((post) => {
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
  }, [posts])

  if (loading) {
    return <main className="app-shell">Loading dashboard...</main>
  }

  if (error && posts.length === 0) {
    return <main className="app-shell">Error: {error}</main>
  }

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <p className="eyebrow">MigaLabs Social Media</p>
        <h1>Social Media Statistics</h1>
        <p className="hero-copy">
          This is currently just a whole bunch of mock data for LinkedIn + X.
        </p>
      </header>

      <section className="overview-grid" aria-label="Overview metrics">
        <article className="metric-card">
          <h2>Total Likes</h2>
          <p>{formatNumber(overview?.likes ?? 0)}</p>
        </article>
        <article className="metric-card">
          <h2>Total Comments</h2>
          <p>{formatNumber(overview?.comments ?? 0)}</p>
        </article>
        <article className="metric-card">
          <h2>Total Impressions</h2>
          <p>{formatNumber(overview?.impressions ?? 0)}</p>
        </article>
        <article className="metric-card">
          <h2>Saves + Bookmarks</h2>
          <p>{formatNumber(overview?.savesOrBookmarks ?? 0)}</p>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel post-panel">
          <div className="panel-title-row">
            <h2>Posts</h2>
            <span>{posts.length} records</span>
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
                {posts.map((post) => (
                  <tr
                    key={post._id}
                    className={selectedPostId === post._id ? 'is-selected' : ''}
                    onClick={() => setSelectedPostId(post._id)}
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

          {loadingSeries ? (
            <p>Loading trend series...</p>
          ) : (
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
          )}

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
    </main>
  )
}

export default App
