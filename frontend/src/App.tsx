import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
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

type TrendTopic = {
  topic: string
  mentionCount: number
  avgEngagementScore: number
  trendScore: number
}

type TrendTagCount = {
  hashtag: string
  count: number
}

type TrendKeywordCount = {
  keyword: string
  count: number
}

type TrendDailyVolume = {
  day: string
  tweetCount: number
}

type TrendTweet = {
  id: string
  author: string | null
  publishedAt: string
  text: string
  topics: string[]
  hashtags: string[]
  engagement: {
    likes: number
    replies: number
    retweets: number
    quotes: number
    bookmarks: number
    impressions: number
    score: number
  }
}

type TopicTweetBucket = {
  topic: string
  tweets: TrendTweet[]
}

type ResearchTrendsResponse = {
  listId: string
  queryUsed?: unknown
  generatedAt?: string
  createdAt?: string
  updatedAt?: string
  fetchedTweets: number
  analyzedTweets: number
  topHashtags: TrendTagCount[]
  topKeywords: TrendKeywordCount[]
  topicBreakdown: TrendTopic[]
  topicTweets: TopicTweetBucket[]
  dailyVolume: TrendDailyVolume[]
  mostEngagedTweets: TrendTweet[]
  window: {
    days: number
    from: string
    to: string
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'
const POSTS_PER_PAGE = 6
type Page = 'insights' | 'linkedin' | 'x' | 'research'
type Theme = 'dark' | 'light'

function normalizeTrendTweet(tweet: Partial<TrendTweet> | null | undefined): TrendTweet {
  return {
    id: String(tweet?.id ?? ''),
    author: tweet?.author ? String(tweet.author) : null,
    publishedAt: String(tweet?.publishedAt ?? new Date().toISOString()),
    text: String(tweet?.text ?? ''),
    topics: Array.isArray(tweet?.topics) ? tweet.topics.map((topic) => String(topic)) : [],
    hashtags: Array.isArray(tweet?.hashtags) ? tweet.hashtags.map((hashtag) => String(hashtag)) : [],
    engagement: {
      likes: Number(tweet?.engagement?.likes ?? 0),
      replies: Number(tweet?.engagement?.replies ?? 0),
      retweets: Number(tweet?.engagement?.retweets ?? 0),
      quotes: Number(tweet?.engagement?.quotes ?? 0),
      bookmarks: Number(tweet?.engagement?.bookmarks ?? 0),
      impressions: Number(tweet?.engagement?.impressions ?? 0),
      score: Number(tweet?.engagement?.score ?? 0),
    },
  }
}

function normalizeResearchData(payload: Partial<ResearchTrendsResponse> | null): ResearchTrendsResponse | null {
  if (!payload) {
    return null
  }

  return {
    listId: String(payload.listId ?? ''),
    queryUsed: payload.queryUsed,
    generatedAt: payload.generatedAt,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    fetchedTweets: Number(payload.fetchedTweets ?? 0),
    analyzedTweets: Number(payload.analyzedTweets ?? 0),
    topHashtags: Array.isArray(payload.topHashtags) ? payload.topHashtags : [],
    topKeywords: Array.isArray(payload.topKeywords) ? payload.topKeywords : [],
    topicBreakdown: Array.isArray(payload.topicBreakdown) ? payload.topicBreakdown : [],
    topicTweets: Array.isArray(payload.topicTweets)
      ? payload.topicTweets.map((entry) => ({
          topic: String(entry?.topic ?? ''),
          tweets: Array.isArray(entry?.tweets)
            ? entry.tweets.map((tweet) => normalizeTrendTweet(tweet))
            : [],
        }))
      : [],
    dailyVolume: Array.isArray(payload.dailyVolume) ? payload.dailyVolume : [],
    mostEngagedTweets: Array.isArray(payload.mostEngagedTweets)
      ? payload.mostEngagedTweets.map((tweet) => normalizeTrendTweet(tweet))
      : [],
    window: {
      days: Number(payload.window?.days ?? 7),
      from: String(payload.window?.from ?? new Date().toISOString()),
      to: String(payload.window?.to ?? new Date().toISOString()),
    },
  }
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') {
      return 'dark'
    }

    const storedTheme = window.localStorage.getItem('dashboard-theme')
    if (storedTheme === 'dark' || storedTheme === 'light') {
      return storedTheme
    }

    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const [activePage, setActivePage] = useState<Page>('insights')
  const [posts, setPosts] = useState<Post[]>([])
  const [allSeriesByPost, setAllSeriesByPost] = useState<Record<string, TimeseriesPoint[]>>({})
  const [selectedPostByPlatform, setSelectedPostByPlatform] = useState<Record<'linkedin' | 'x', string>>({
    linkedin: '',
    x: '',
  })
  const [postPageByPlatform, setPostPageByPlatform] = useState<Record<'linkedin' | 'x', number>>({
    linkedin: 1,
    x: 1,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [researchData, setResearchData] = useState<ResearchTrendsResponse | null>(null)
  const [selectedResearchTopic, setSelectedResearchTopic] = useState('')
  const [researchLoading, setResearchLoading] = useState(false)
  const [researchError, setResearchError] = useState('')
  const analyticsPanelRef = useRef<HTMLDivElement | null>(null)
  const chartGridColor = theme === 'dark' ? '#3d4354' : '#d7dfeb'
  const graphBlue = '#0052CC'
  const graphGreen = '#00D084'
  const graphViolet = '#8812FF'
  const chartPalette = theme === 'dark'
    ? {
        impressionsBar: graphBlue,
        engagementLine: graphGreen,
        impressionsAreaStroke: graphBlue,
        impressionsAreaFill: 'rgba(0, 82, 204, 0.32)',
        erAreaLine: graphGreen,
        trendScoreBar: graphViolet,
        mentionsBar: graphBlue,
        tweetVolumeStroke: graphViolet,
        tweetVolumeFill: 'rgba(136, 18, 255, 0.28)',
        repostBar: graphBlue,
        likesLine: graphViolet,
        repliesLine: graphGreen,
        viewsAreaStroke: graphBlue,
        viewsAreaFill: 'rgba(0, 82, 204, 0.28)',
        erAreaStroke: graphViolet,
        erAreaFill: 'rgba(136, 18, 255, 0.22)',
      }
    : {
        impressionsBar: graphBlue,
        engagementLine: graphGreen,
        impressionsAreaStroke: graphBlue,
        impressionsAreaFill: 'rgba(0, 82, 204, 0.18)',
        erAreaLine: graphGreen,
        trendScoreBar: graphViolet,
        mentionsBar: graphBlue,
        tweetVolumeStroke: graphViolet,
        tweetVolumeFill: 'rgba(136, 18, 255, 0.14)',
        repostBar: graphBlue,
        likesLine: graphViolet,
        repliesLine: graphGreen,
        viewsAreaStroke: graphBlue,
        viewsAreaFill: 'rgba(0, 82, 204, 0.16)',
        erAreaStroke: graphViolet,
        erAreaFill: 'rgba(136, 18, 255, 0.14)',
      }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('dashboard-theme', theme)
  }, [theme])

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
    if (!researchData) {
      setSelectedResearchTopic('')
      return
    }

    const availableTopics = researchData.topicBreakdown.map((entry) => entry.topic)
    if (availableTopics.length === 0) {
      setSelectedResearchTopic('')
      return
    }

    setSelectedResearchTopic((previous) =>
      previous && availableTopics.includes(previous) ? previous : ''
    )
  }, [researchData])

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

  useEffect(() => {
    let isActive = true

    async function loadResearchTrends(showLoading = false) {
      if (showLoading) {
        setResearchLoading(true)
      }
      setResearchError('')

      try {
        const latestResponse = await fetch(
          `${API_BASE_URL}/api/twitter/research/latest?ts=${Date.now()}`,
          {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache',
            },
          }
        )

        const response = latestResponse.ok
          ? latestResponse
          : await fetch(`${API_BASE_URL}/api/twitter/research/trends?ts=${Date.now()}`, {
              cache: 'no-store',
              headers: {
                'Cache-Control': 'no-cache',
              },
            })

        if (!response.ok) {
          throw new Error('Unable to load research trend analysis.')
        }

        const payload = (await response.json()) as ResearchTrendsResponse
        if (isActive) {
          setResearchData(normalizeResearchData(payload))
        }
      } catch (loadError) {
        if (isActive) {
          setResearchError(loadError instanceof Error ? loadError.message : 'Unknown error')
        }
      } finally {
        if (isActive && showLoading) {
          setResearchLoading(false)
        }
      }
    }

    loadResearchTrends(true)
    const intervalId = window.setInterval(() => {
      loadResearchTrends(false)
    }, 60000)

    return () => {
      isActive = false
      window.clearInterval(intervalId)
    }
  }, [])

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

  const activePlatform = activePage === 'linkedin' || activePage === 'x' ? activePage : null

  const platformPosts = useMemo(
    () => (activePlatform ? posts.filter((post) => post.platform === activePlatform) : []),
    [posts, activePlatform]
  )

  const currentPostPage = activePlatform ? postPageByPlatform[activePlatform] : 1
  const totalPostPages = Math.max(1, Math.ceil(platformPosts.length / POSTS_PER_PAGE))
  const clampedPostPage = Math.min(currentPostPage, totalPostPages)

  const paginatedPosts = useMemo(() => {
    const startIndex = (clampedPostPage - 1) * POSTS_PER_PAGE
    return platformPosts.slice(startIndex, startIndex + POSTS_PER_PAGE)
  }, [platformPosts, clampedPostPage])

  const selectedPostId = activePlatform ? selectedPostByPlatform[activePlatform] : ''
  const selectedPost = useMemo(
    () => platformPosts.find((post) => post._id === selectedPostId) ?? null,
    [platformPosts, selectedPostId]
  )

  const selectedSeries = useMemo(
    () => (selectedPostId ? enrichSeries(allSeriesByPost[selectedPostId] ?? []) : []),
    [selectedPostId, allSeriesByPost]
  )
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

  const linkedinCardMetrics = useMemo(() => {
    const clicks = Math.max(0, Math.round(overviewForPage.impressions * 0.07))
    const engagementRate =
      overviewForPage.impressions > 0
        ? ((overviewForPage.likes + overviewForPage.comments + overviewForPage.shares + clicks) /
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
          return { title: post.content, score, postId: post._id }
        }
        return best
      },
      { title: 'No post available', score: -1, postId: '' }
    )

    return {
      impressions: overviewForPage.impressions,
      engagementRate,
      followerGrowth,
      followerGrowthDays,
      clicks,
      topPostTitle: topPost.title,
      topPostId: topPost.postId,
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
    const followerGrowth = Math.max(0, Math.round(platformPosts.length * 9 + overviewForPage.comments * 0.9))

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

    return {
      impressions: overviewForPage.impressions,
      engagementRate,
      followerGrowth,
      followerGrowthDays,
      likes: overviewForPage.likes,
    }
  }, [overviewForPage, platformPosts, allSeriesByPost])

  const displayedPosts = useMemo(() => {
    if (activePlatform !== 'linkedin' || !linkedinCardMetrics.topPostId) {
      return paginatedPosts
    }

    const topPost = platformPosts.find((post) => post._id === linkedinCardMetrics.topPostId)
    if (!topPost) {
      return paginatedPosts
    }

    const remainingPosts = platformPosts.filter((post) => post._id !== linkedinCardMetrics.topPostId)

    if (clampedPostPage === 1) {
      return [topPost, ...remainingPosts.slice(0, POSTS_PER_PAGE - 1)]
    }

    const remainingStart = POSTS_PER_PAGE - 1 + (clampedPostPage - 2) * POSTS_PER_PAGE
    return remainingPosts.slice(remainingStart, remainingStart + POSTS_PER_PAGE)
  }, [
    activePlatform,
    clampedPostPage,
    linkedinCardMetrics.topPostId,
    paginatedPosts,
    platformPosts,
  ])

  const latestAcrossPosts = useMemo(() => {
    return posts
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
  }, [posts, allSeriesByPost])

  const insightsPlatformBreakdown = useMemo(() => {
    const seed = {
      linkedin: {
        platform: 'linkedin' as const,
        label: 'LinkedIn',
        posts: 0,
        impressions: 0,
        engagement: 0,
        engagementRate: 0,
      },
      x: {
        platform: 'x' as const,
        label: 'X',
        posts: 0,
        impressions: 0,
        engagement: 0,
        engagementRate: 0,
      },
    }

    latestAcrossPosts.forEach((post) => {
      const row = seed[post.platform]
      const engagement = post.likeCount + post.replyCount + post.retweetCount + post.bookmarkCount
      row.posts += 1
      row.impressions += post.viewCount
      row.engagement += engagement
    })

    return (Object.values(seed) as Array<(typeof seed)[keyof typeof seed]>).map((row) => ({
      ...row,
      engagementRate: row.impressions > 0 ? (row.engagement / row.impressions) * 100 : 0,
    }))
  }, [latestAcrossPosts])

  const insightsDailyTotals = useMemo(() => {
    const dateMap = new Map<string, { date: string; impressions: number; engagement: number }>()

    posts.forEach((post) => {
      const postSeries = enrichSeries(allSeriesByPost[post._id] ?? [])
      postSeries.forEach((point) => {
        const day = point.createdAt.slice(0, 10)
        const existing = dateMap.get(day) ?? { date: day, impressions: 0, engagement: 0 }
        existing.impressions += point.viewCount
        existing.engagement += point.likeCount + point.replyCount + point.retweetCount + point.bookmarkCount
        dateMap.set(day, existing)
      })
    })

    return Array.from(dateMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        engagementRate: row.impressions > 0 ? Number(((row.engagement / row.impressions) * 100).toFixed(2)) : 0,
      }))
  }, [posts, allSeriesByPost])

  const insightsTopPerformers = useMemo(() => {
    return [...latestAcrossPosts]
      .sort((a, b) => {
        const aScore = a.likeCount + a.replyCount + a.retweetCount * 1.15 + a.bookmarkCount * 1.2
        const bScore = b.likeCount + b.replyCount + b.retweetCount * 1.15 + b.bookmarkCount * 1.2
        return bScore - aScore
      })
      .slice(0, 4)
  }, [latestAcrossPosts])

  const insightsWatchlist = useMemo(() => {
    return [...latestAcrossPosts]
      .sort((a, b) => a.engagementRate - b.engagementRate)
      .slice(0, 4)
  }, [latestAcrossPosts])

  const insightsExecutiveMetrics = useMemo(() => {
    const totalImpressions = insightsPlatformBreakdown.reduce((sum, row) => sum + row.impressions, 0)
    const totalEngagement = insightsPlatformBreakdown.reduce((sum, row) => sum + row.engagement, 0)
    const totalPosts = insightsPlatformBreakdown.reduce((sum, row) => sum + row.posts, 0)
    const engagementRate = totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0

    const latestWindow = insightsDailyTotals.slice(-7)
    const previousWindow = insightsDailyTotals.slice(-14, -7)

    const average = (arr: number[]) => {
      if (arr.length === 0) {
        return 0
      }
      return arr.reduce((sum, value) => sum + value, 0) / arr.length
    }

    const avgLatestImpressions = average(latestWindow.map((item) => item.impressions))
    const avgPreviousImpressions = average(previousWindow.map((item) => item.impressions))
    const avgLatestEngagementRate = average(latestWindow.map((item) => item.engagementRate))
    const avgPreviousEngagementRate = average(previousWindow.map((item) => item.engagementRate))

    const calcDelta = (current: number, previous: number) => {
      if (previous === 0) {
        return current > 0 ? 100 : 0
      }
      return ((current - previous) / previous) * 100
    }

    const impressionDelta = calcDelta(avgLatestImpressions, avgPreviousImpressions)
    const engagementDelta = calcDelta(avgLatestEngagementRate, avgPreviousEngagementRate)

    const strongestPlatform = [...insightsPlatformBreakdown].sort(
      (a, b) => b.engagementRate - a.engagementRate
    )[0]

    return {
      totalImpressions,
      totalEngagement,
      totalPosts,
      engagementRate,
      impressionDelta,
      engagementDelta,
      strongestPlatform,
    }
  }, [insightsPlatformBreakdown, insightsDailyTotals])

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
      <header className="hero-panel insights-hero">
        <div>
          <h1>Insights</h1>
          <p className="hero-copy">
            A broad performance read across LinkedIn and X with momentum tracking, channel efficiency, and narrative pressure.
          </p>
        </div>
      </header>

      <div className="insights-hero-badge-grid" aria-label="Executive pulse">
        <article className="insights-hero-badge">
          <h2>Posts Tracked</h2>
          <p>{formatNumber(insightsExecutiveMetrics.totalPosts)}</p>
        </article>
        <article className="insights-hero-badge">
          <h2>Net Reach</h2>
          <p>{formatNumber(insightsExecutiveMetrics.totalImpressions)}</p>
        </article>
        <article className="insights-hero-badge">
          <h2>Net Engagement</h2>
          <p>{formatNumber(insightsExecutiveMetrics.totalEngagement)}</p>
        </article>
        <article className="insights-hero-badge">
          <h2>Best Channel</h2>
          <p>{insightsExecutiveMetrics.strongestPlatform?.label ?? '--'}</p>
        </article>
      </div>

      <section className="overview-grid insights-impact-grid" aria-label="Insights summary cards">
        <article className="metric-card insights-impact-card">
          <h2>Overall Engagement Rate</h2>
          <p>{insightsExecutiveMetrics.engagementRate.toFixed(2)}%</p>
          <small className="metric-subtext">Across LinkedIn + X</small>
        </article>
        <article className="metric-card insights-impact-card">
          <h2>7-Day Reach Momentum</h2>
          <p>{insightsExecutiveMetrics.impressionDelta >= 0 ? '+' : ''}{insightsExecutiveMetrics.impressionDelta.toFixed(1)}%</p>
          <small className="metric-subtext">Vs previous 7-day period</small>
        </article>
        <article className="metric-card insights-impact-card">
          <h2>7-Day Engagement Momentum</h2>
          <p>{insightsExecutiveMetrics.engagementDelta >= 0 ? '+' : ''}{insightsExecutiveMetrics.engagementDelta.toFixed(1)}%</p>
          <small className="metric-subtext">ER trend acceleration</small>
        </article>
        <article className="metric-card insights-impact-card">
          <h2>Top Performing Post</h2>
          <p className="metric-post-title">{insightsSummary.topPost.content}</p>
          <small className="metric-subtext">{insightsSummary.topPost.platform.toUpperCase()}</small>
        </article>
      </section>

      <section className="content-grid insights-grid">
        <article className="panel">
          <div className="panel-title-row">
            <h2>Channel Efficiency</h2>
            <span>engagement rate by platform</span>
          </div>
          <div className="chart-wrap compact">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={insightsPlatformBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="label" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" unit="%" domain={[0, 'auto']} />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'engagementRate') {
                      return `${Number(value ?? 0).toFixed(2)}%`
                    }
                    return formatNumber(Number(value ?? 0))
                  }}
                />
                <Legend />
                <Bar yAxisId="left" dataKey="impressions" name="Impressions" fill={chartPalette.impressionsBar} radius={[6, 6, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="engagementRate"
                  name="Engagement Rate"
                  stroke={chartPalette.engagementLine}
                  strokeWidth={2.4}
                  dot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Audience Momentum</h2>
            <span>daily reach + ER</span>
          </div>
          <div className="chart-wrap compact">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={insightsDailyTotals}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="date" tickFormatter={formatDate} />
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
                  dataKey="impressions"
                  name="Impressions"
                  yAxisId="left"
                  stroke={chartPalette.impressionsAreaStroke}
                  fill={chartPalette.impressionsAreaFill}
                  fillOpacity={0.55}
                  strokeWidth={2.2}
                />
                <Line
                  type="monotone"
                  dataKey="engagementRate"
                  name="Engagement Rate"
                  yAxisId="right"
                  stroke={chartPalette.erAreaLine}
                  strokeWidth={2.25}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Winning Posts</h2>
            <span>strongest engagement signals</span>
          </div>
          <div className="insights-post-list" role="list" aria-label="Top cross-platform posts">
            {insightsTopPerformers.map((post) => (
              <article key={post._id} className="insights-post-item" role="listitem">
                <div className="compact-post-meta">
                  <span>{post.platform.toUpperCase()}</span>
                  <span>{formatDate(post.publishedAt)}</span>
                </div>
                <p className="selected-content">{post.content}</p>
                <div className="compact-post-stats">
                  <span>{formatNumber(post.viewCount)} views</span>
                  <span>{formatNumber(post.likeCount)} likes</span>
                  <span>{post.engagementRate.toFixed(2)}% ER</span>
                </div>
              </article>
            ))}
            {insightsTopPerformers.length === 0 && (
              <p className="selected-content">No posts available to rank yet.</p>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h2>Risk Watchlist</h2>
            <span>low-performing posts</span>
          </div>
          <div className="insights-post-list" role="list" aria-label="Posts needing optimization">
            {insightsWatchlist.map((post) => (
              <article key={`${post._id}-risk`} className="insights-post-item" role="listitem">
                <div className="compact-post-meta">
                  <span>{post.platform.toUpperCase()}</span>
                  <span>{formatDate(post.publishedAt)}</span>
                </div>
                <p className="selected-content">{post.content}</p>
                <div className="compact-post-stats">
                  <span>{formatNumber(post.viewCount)} views</span>
                  <span>{formatNumber(post.likeCount + post.replyCount + post.retweetCount)} interactions</span>
                  <span>{post.engagementRate.toFixed(2)}% ER</span>
                </div>
              </article>
            ))}
            {insightsWatchlist.length === 0 && (
              <p className="selected-content">No watchlist candidates available yet.</p>
            )}
          </div>
        </article>
      </section>
    </>
  )

  const renderResearch = () => {
    const trendRows = researchData?.topicBreakdown ?? []
    const topicTweets = researchData?.topicTweets ?? []
    const dailyVolumeRows = researchData?.dailyVolume ?? []
    const engagedTweets = researchData?.mostEngagedTweets ?? []
    const selectedTopicSummary = trendRows.find((entry) => entry.topic === selectedResearchTopic) ?? null
    const selectedTopicTweets =
      topicTweets.find((entry) => entry.topic === selectedResearchTopic)?.tweets ?? []

    return (
      <>
        <header className="hero-panel">
          <h1>Ethereum Trends</h1>
          <p className="hero-copy">
            Curated-list analysis for Ethereum conversations over the past week, including topic momentum, engagement,
            and narrative density.
          </p>
        </header>

        <section className="overview-grid research-overview-grid" aria-label="Research overview cards">
          <article className="metric-card research-kpi-card">
            <h2>Analyzed Tweets</h2>
            <p>{formatNumber(researchData?.analyzedTweets ?? 0)}</p>
            <small className="metric-subtext">From curated list feed</small>
          </article>
          <article className="metric-card research-kpi-card">
            <h2>Window</h2>
            <p>{researchData?.window?.days ?? 7}d</p>
            <small className="metric-subtext">
              {researchData?.window?.from ? `${formatDate(researchData.window.from)} to ${formatDate(researchData.window.to)}` : 'Last 7 days'}
            </small>
          </article>
          <article className="metric-card research-narrative-card">
            <h2>Top ETH Narrative</h2>
            <p className="metric-post-title">{trendRows[0]?.topic ?? 'No topic found'}</p>
            <small className="metric-subtext">
              {trendRows[0]
                ? `${formatNumber(trendRows[0].mentionCount)} mentions • trend score ${trendRows[0].trendScore.toFixed(2)}`
                : 'Narrative ranking will appear once trends are available'}
            </small>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel">
            <div className="panel-title-row">
              <h2>Topic Momentum (Ethereum)</h2>
              <span>trend score</span>
            </div>
            <div className="chart-wrap compact">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="topic" hide />
                  <YAxis />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'trendScore') {
                        return Number(value ?? 0).toFixed(2)
                      }
                      return formatNumber(Number(value ?? 0))
                    }}
                  />
                  <Legend />
                  <Bar dataKey="trendScore" name="Trend Score" fill={chartPalette.trendScoreBar} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="mentionCount" name="Mentions" fill={chartPalette.mentionsBar} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="panel">
            <div className="panel-title-row">
              <h2>Tweet Volume Over Time</h2>
              <span>daily count</span>
            </div>
            <div className="chart-wrap compact">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyVolumeRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="day" tickFormatter={formatDate} />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) => formatDate(String(value))}
                    formatter={(value) => formatNumber(Number(value ?? 0))}
                  />
                  <Area
                    type="monotone"
                    dataKey="tweetCount"
                    name="Tweet Count"
                    stroke={chartPalette.tweetVolumeStroke}
                    fill={chartPalette.tweetVolumeFill}
                    fillOpacity={0.55}
                    strokeWidth={2.25}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>
        </section>

        <section>
          <article className="panel">
            <div className="panel-title-row">
              <h2>Narrative Opportunities</h2>
              <span>topics ranked by momentum + engagement</span>
            </div>
            <div className="research-topic-opportunities" role="list" aria-label="Top narrative opportunities">
              {trendRows.slice(0, 8).map((topic, index) => (
                <button
                  key={topic.topic}
                  type="button"
                  className={`research-topic-opportunity research-topic-button ${selectedResearchTopic === topic.topic ? 'is-active' : ''}`}
                  role="listitem"
                  onClick={() => setSelectedResearchTopic(topic.topic)}
                >
                  <div className="panel-title-row">
                    <h2>
                      #{index + 1} {topic.topic}
                    </h2>
                    <span>{topic.trendScore.toFixed(2)} trend score</span>
                  </div>
                  <div className="compact-post-stats">
                    <span>{formatNumber(topic.mentionCount)} mentions</span>
                    <span>{topic.avgEngagementScore.toFixed(2)} avg engagement score</span>
                  </div>
                </button>
              ))}
              {trendRows.length === 0 && <p className="selected-content">No topic opportunities found in the selected window.</p>}
            </div>
          </article>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <h2>Most Engaged Tweets</h2>
            <span>engagement-ranked</span>
          </div>
          <div className="research-tweet-list">
            {engagedTweets.slice(0, 8).map((tweet) => (
              <article key={tweet.id} className="research-tweet-card">
                <div className="compact-post-meta">
                  <span>{tweet.author ? `@${tweet.author}` : 'Unknown author'}</span>
                  <span>{formatDate(tweet.publishedAt)}</span>
                </div>
                <p className="selected-content">{tweet.text}</p>
                <p className="metric-subtext">
                  Narrative: <strong>{tweet.topics[0] ?? 'Unclassified'}</strong>
                </p>
                <div className="compact-post-stats">
                  <span>{formatNumber(tweet.engagement.likes)} likes</span>
                  <span>{formatNumber(tweet.engagement.retweets)} reposts</span>
                  <span>{formatNumber(tweet.engagement.replies)} replies</span>
                  <span>score {formatNumber(tweet.engagement.score)}</span>
                </div>
                <div className="research-topic-tags">
                  {tweet.topics.slice(0, 4).map((topic) => (
                    <span key={`${tweet.id}-${topic}`} className="research-chip">
                      {topic}
                    </span>
                  ))}
                </div>
              </article>
            ))}
            {engagedTweets.length === 0 && <p className="selected-content">No tweets qualified for engagement ranking in the selected window.</p>}
          </div>
        </section>

        {(researchLoading || researchError) && (
          <section className="panel">
            {researchLoading && <p className="selected-content">Loading Ethereum trend analysis...</p>}
            {researchError && <p className="error-text">{researchError}</p>}
          </section>
        )}

        {selectedResearchTopic && (
          <div
            className="research-modal-overlay"
            role="presentation"
            onClick={() => setSelectedResearchTopic('')}
          >
            <section
              className="research-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Tweets for ${selectedResearchTopic}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="panel-title-row">
                <h2>Tweets for {selectedResearchTopic}</h2>
                <span>
                  {selectedTopicSummary ? formatNumber(selectedTopicSummary.mentionCount) : formatNumber(selectedTopicTweets.length)} mentions
                </span>
              </div>
              <button
                type="button"
                className="research-modal-close"
                onClick={() => setSelectedResearchTopic('')}
                aria-label="Close topic tweets"
              >
                Close
              </button>
              <div className="research-tweet-list research-modal-list">
                {selectedTopicTweets.map((tweet) => (
                  <article key={`${selectedResearchTopic}-${tweet.id}`} className="research-tweet-card">
                    <div className="compact-post-meta">
                      <span>{tweet.author ? `@${tweet.author}` : 'Unknown author'}</span>
                      <span>{formatDate(tweet.publishedAt)}</span>
                    </div>
                    <p className="selected-content">{tweet.text}</p>
                    <p className="metric-subtext">
                      Narrative: <strong>{tweet.topics[0] ?? 'Unclassified'}</strong>
                    </p>
                    <div className="compact-post-stats">
                      <span>{formatNumber(tweet.engagement.likes)} likes</span>
                      <span>{formatNumber(tweet.engagement.retweets)} reposts</span>
                      <span>{formatNumber(tweet.engagement.replies)} replies</span>
                      <span>score {formatNumber(tweet.engagement.score)}</span>
                    </div>
                    <div className="research-topic-tags">
                      {tweet.topics.slice(0, 4).map((topic) => (
                        <span key={`${tweet.id}-${topic}`} className="research-chip">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
                {selectedTopicTweets.length === 0 && (
                  <p className="selected-content">
                    No tweets found for {selectedResearchTopic} in the current analysis window.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}
      </>
    )
  }

  const renderPlatformPage = () => (
    <>
      <header className="hero-panel">
        <h1>{activePlatform === 'linkedin' ? 'LinkedIn Analytics' : 'X Analytics'}</h1>
        <p className="hero-copy">Analytics feed with charted trends and engagement composition.</p>
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
              <h2>Follower Growth</h2>
              <p>+{formatNumber(xCardMetrics.followerGrowth)}</p>
              <small className="metric-subtext">
                {xCardMetrics.followerGrowthDays > 0
                  ? `Last ${xCardMetrics.followerGrowthDays} days`
                  : 'Time window unavailable'}
              </small>
            </article>
            <article className="metric-card">
              <h2>Likes</h2>
              <p>{formatNumber(xCardMetrics.likes)}</p>
            </article>
          </>
        )}
      </section>

      <section className="content-grid">
        <article className="panel post-panel">
          <div className="panel-title-row">
            <h2>Posts</h2>
            <span>
              {platformPosts.length} records | Page {clampedPostPage} of {totalPostPages}
            </span>
          </div>
          <div className="compact-post-list" role="list" aria-label={`${activePlatform === 'linkedin' ? 'LinkedIn' : 'X'} posts`}>
            {displayedPosts.map((post) => {
              const postSeries = allSeriesByPost[post._id] ?? []
              const latest = postSeries.length > 0 ? enrichSeries([postSeries[postSeries.length - 1]])[0] : null
              const isTopLinkedinPost =
                activePlatform === 'linkedin' && post._id === linkedinCardMetrics.topPostId

              return (
                <button
                  key={post._id}
                  type="button"
                  className={`compact-post-card ${selectedPostId === post._id ? 'is-selected' : ''}`}
                  onClick={() => {
                    if (!activePlatform) {
                      return
                    }
                    setSelectedPostByPlatform((prev) => ({ ...prev, [activePlatform]: post._id }))
                    if (window.matchMedia('(max-width: 1024px)').matches) {
                      requestAnimationFrame(() => {
                        analyticsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      })
                    }
                  }}
                >
                  <div className="compact-post-meta">
                    <span>{isTopLinkedinPost ? `📌 ${formatDate(post.publishedAt)}` : formatDate(post.publishedAt)}</span>
                    <span>{latest ? `${formatNumber(latest.viewCount)} views` : 'No metrics yet'}</span>
                  </div>
                  <p className="compact-post-preview">{post.content}</p>
                  <div className="compact-post-stats" aria-hidden="true">
                    <span>{latest ? `${formatNumber(latest.likeCount)} likes` : '-- likes'}</span>
                    <span>{latest ? `${formatNumber(latest.retweetCount)} reposts` : '-- reposts'}</span>
                    <span>{latest ? `${latest.engagementRate.toFixed(2)}% ER` : '-- ER'}</span>
                  </div>
                  {isTopLinkedinPost && <span className="table-pill compact-post-pill">Top Post</span>}
                </button>
              )
            })}
          </div>
          <div className="posts-pagination" aria-label="Posts pagination controls">
            <button
              type="button"
              className="pagination-button"
              disabled={clampedPostPage <= 1 || !activePlatform}
              onClick={() => {
                if (!activePlatform) {
                  return
                }
                setPostPageByPlatform((prev) => ({ ...prev, [activePlatform]: Math.max(1, clampedPostPage - 1) }))
              }}
            >
              Previous
            </button>
            <button
              type="button"
              className="pagination-button"
              disabled={clampedPostPage >= totalPostPages || !activePlatform}
              onClick={() => {
                if (!activePlatform) {
                  return
                }
                setPostPageByPlatform((prev) => ({
                  ...prev,
                  [activePlatform]: Math.min(totalPostPages, clampedPostPage + 1),
                }))
              }}
            >
              Next
            </button>
          </div>
        </article>

        <div className="analytics-right-column" ref={analyticsPanelRef}>
          <article className="panel chart-panel">
            <div className="panel-title-row">
              <h2>Engagement Over Time</h2>
              <span>{selectedPost?.externalPostId ?? 'No post selected'}</span>
            </div>

            <p className="selected-content">{selectedPost?.content ?? 'Select a post from the list.'}</p>

            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={selectedSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="createdAt" tickFormatter={formatDate} />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) => formatDate(String(value))}
                    formatter={(value) => formatNumber(Number(value ?? 0))}
                  />
                  <Legend />
                  <Bar dataKey="retweetCount" name="Reposts" fill={chartPalette.repostBar} barSize={14} />
                  <Line type="monotone" dataKey="likeCount" name="Likes" stroke={chartPalette.likesLine} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="replyCount" name="Replies" stroke={chartPalette.repliesLine} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {error && <p className="error-text">{error}</p>}
          </article>

          <article className="panel">
            <div className="panel-title-row">
              <h2>Views vs Engagement Rate</h2>
              <span>per day</span>
            </div>
            <div className="chart-wrap compact">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={selectedSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
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
                    stroke={chartPalette.viewsAreaStroke}
                    fill={chartPalette.viewsAreaFill}
                    fillOpacity={0.55}
                    strokeWidth={2.25}
                  />
                  <Area
                    type="monotone"
                    dataKey="engagementRate"
                    name="Engagement Rate"
                    yAxisId="right"
                    stroke={chartPalette.erAreaStroke}
                    fill={chartPalette.erAreaFill}
                    fillOpacity={0.55}
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>

        </div>
      </section>

    </>
  )

  return (
    <main className="app-shell">
      <button
        type="button"
        className="theme-fab"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
      >
        <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
      </button>

      <nav className="top-nav" aria-label="Main pages">
        {tabButton('LinkedIn', 'linkedin')}
        {tabButton('X', 'x')}
        {tabButton('Trends', 'research')}
        {tabButton('Insights', 'insights')}
      </nav>

      {activePage === 'insights' ? renderInsights() : activePage === 'research' ? renderResearch() : renderPlatformPage()}
    </main>
  )
}

export default App
