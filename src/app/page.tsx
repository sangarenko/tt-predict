'use client'

import { useEffect, useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Trophy, Activity, TrendingUp, TrendingDown, Clock, Users, Target,
  DollarSign, Brain, Zap, Search, RefreshCw, Play, CheckCircle2,
  XCircle, AlertTriangle, Eye, BarChart3, ArrowUpRight,
  ArrowDownRight, Minus, Flame, Shield, Timer, CircleDot,
  Loader2, Wallet, Bot, History, LayoutDashboard, UserCircle,
  ChevronRight, Landmark, Signal, Download, Cpu
} from 'lucide-react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Area, AreaChart } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { useTTStore, type Match, type AiBet, type AiProfile } from '@/lib/store'

// ============================================================
// HELPERS
// ============================================================

function fmtMoney(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(0) + '₽'
}

function fmtMoneyPlain(v: number): string {
  return v.toFixed(0) + '₽'
}

function fmtPct(v: number): string {
  return v.toFixed(1) + '%'
}

function fmtOdds(v: number): string {
  return v.toFixed(2)
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'won': case 'live': return 'text-emerald-400'
    case 'lost': return 'text-red-400'
    case 'pending': return 'text-amber-400'
    case 'void': case 'skipped': return 'text-zinc-500'
    case 'finished': return 'text-zinc-400'
    case 'upcoming': return 'text-sky-400'
    default: return 'text-zinc-400'
  }
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'won': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    case 'lost': return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'pending': return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    case 'void': return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
    case 'skipped': return 'bg-zinc-500/20 text-zinc-500 border-zinc-500/30'
    case 'live': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    case 'upcoming': return 'bg-sky-500/20 text-sky-400 border-sky-500/30'
    case 'finished': return 'bg-zinc-600/20 text-zinc-400 border-zinc-600/30'
    default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  }
}

// ============================================================
// ANIMATION VARIANTS
// ============================================================

const fadeSlideUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

const staggerContainer = {
  animate: { transition: { staggerChildren: 0.04 } },
}

const staggerItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
}

// ============================================================
// SHARED UI: STATUS BADGE
// ============================================================

function StatusBadge({ status, pulse }: { status: string; pulse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(status)} ${pulse ? 'animate-pulse' : ''}`}>
      {status === 'live' && <CircleDot className="size-3" />}
      {status === 'won' && <CheckCircle2 className="size-3" />}
      {status === 'lost' && <XCircle className="size-3" />}
      {status === 'pending' && <Timer className="size-3" />}
      {status === 'void' && <Eye className="size-3" />}
      {status === 'skipped' && <Minus className="size-3" />}
      {status === 'upcoming' && <Clock className="size-3" />}
      {status === 'finished' && <CheckCircle2 className="size-3" />}
      {status}
    </span>
  )
}

// ============================================================
// SHARED UI: STAT CARD
// ============================================================

function StatCard({ icon: Icon, label, value, sub, color = 'text-zinc-100' }: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <Card className="gap-3 bg-zinc-900/80 border-zinc-800 py-4">
      <CardContent className="flex items-start gap-3 p-0 px-4">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 ${color}`}>
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
          <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
          {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// SHARED UI: SKELETON GRID
// ============================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="bg-zinc-900/80 border-zinc-800 py-4">
            <CardContent className="px-4 py-0 space-y-2">
              <Skeleton className="h-4 w-16 bg-zinc-800" />
              <Skeleton className="h-6 w-24 bg-zinc-800" />
              <Skeleton className="h-3 w-20 bg-zinc-800" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-zinc-900/80 border-zinc-800 py-4">
          <CardContent className="px-4 py-0 space-y-3">
            <Skeleton className="h-5 w-32 bg-zinc-800" />
            <Skeleton className="h-48 w-full bg-zinc-800 rounded-lg" />
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/80 border-zinc-800 py-4 lg:col-span-2">
          <CardContent className="px-4 py-0 space-y-3">
            <Skeleton className="h-5 w-32 bg-zinc-800" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full bg-zinc-800" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ============================================================
// TAB: OVERVIEW
// ============================================================

function OverviewTab() {
  const { matches, aiBets, stats, aiBankroll, collectionLogs, loading } = useTTStore()

  const matchStatusData = useMemo(() => {
    const counts: Record<string, number> = { live: 0, upcoming: 0, finished: 0, void: 0 }
    matches.forEach(m => {
      if (m.status in counts) counts[m.status]++
    })
    return [
      { status: 'live', value: counts.live },
      { status: 'upcoming', value: counts.upcoming },
      { status: 'finished', value: counts.finished },
      { status: 'void', value: counts.void },
    ].filter(d => d.value > 0)
  }, [matches])

  const statusConfig: ChartConfig = {
    live: { label: 'Live', color: 'hsl(142, 76%, 36%)' },
    upcoming: { label: 'Upcoming', color: 'hsl(199, 89%, 48%)' },
    finished: { label: 'Finished', color: 'hsl(215, 20%, 45%)' },
    void: { label: 'Void', color: 'hsl(0, 0%, 40%)' },
  }

  const statusColors: Record<string, string> = {
    live: 'hsl(142, 76%, 36%)',
    upcoming: 'hsl(199, 89%, 48%)',
    finished: 'hsl(215, 20%, 45%)',
    void: 'hsl(0, 0%, 40%)',
  }

  const recentBets = aiBets.slice(0, 12)

  const wonBets = aiBets.filter(b => b.status === 'won').length
  const lostBets = aiBets.filter(b => b.status === 'lost').length
  const pendingBets = aiBets.filter(b => b.status === 'pending').length

  const liveMatches = matches.filter(m => m.status === 'live')

  return (
    <motion.div {...fadeSlideUp} transition={{ duration: 0.3 }} className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Trophy} label="Matches" value={String(stats?.totalMatches ?? matches.length)} sub="total tracked" />
        <StatCard icon={Brain} label="AI Bets" value={String(stats?.totalBets ?? aiBets.length)} sub={`${wonBets}W ${lostBets}L`} color="text-emerald-400" />
        <StatCard icon={Target} label="Win Rate" value={stats ? fmtPct(stats.winRate) : aiBets.length > 0 ? fmtPct((wonBets / (wonBets + lostBets)) * 100) : '—'} sub="AI accuracy" color="text-amber-400" />
        <StatCard icon={Wallet} label="AI Bankroll" value={aiBankroll ? fmtMoneyPlain(aiBankroll.currentAmount) : '—'} sub={aiBankroll ? fmtPct(aiBankroll.yield) + ' yield' : ''} color={aiBankroll && aiBankroll.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        <StatCard icon={DollarSign} label="Profit" value={stats ? fmtMoney(stats.totalProfit) : aiBankroll ? fmtMoney(aiBankroll.totalProfit) : '—'} sub="total P&L" color={(stats?.totalProfit ?? aiBankroll?.totalProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        <StatCard icon={Signal} label="Live" value={String(liveMatches.length)} sub={pendingBets > 0 ? `${pendingBets} bets pending` : 'no live matches'} color="text-sky-400" />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Match Status Distribution */}
        <Card className="bg-zinc-900/80 border-zinc-800 py-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <BarChart3 className="size-4 text-zinc-500" />
              Match Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {matchStatusData.length > 0 ? (
              <ChartContainer config={statusConfig} className="mx-auto aspect-square max-h-[200px]">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie data={matchStatusData} dataKey="value" nameKey="status" innerRadius={45} outerRadius={75} strokeWidth={2} stroke="rgba(9,9,11,0.8)">
                    {matchStatusData.map((entry, index) => (
                      <Cell key={index} fill={statusColors[entry.status] || 'hsl(0, 0%, 40%)'} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-zinc-600 text-sm">No match data</div>
            )}
            <div className="flex flex-wrap justify-center gap-3 mt-3">
              {matchStatusData.map(d => (
                <div key={d.status} className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="size-2 rounded-full" style={{ backgroundColor: statusColors[d.status] }} />
                  {d.status} ({d.value})
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent AI Bets */}
        <Card className="bg-zinc-900/80 border-zinc-800 py-4 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Zap className="size-4 text-amber-500" />
              Recent AI Bets
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ScrollArea className="max-h-[380px]">
              <div className="px-4 space-y-1.5">
                {recentBets.length > 0 ? recentBets.map(bet => (
                  <div key={bet.id} className="flex items-center gap-3 rounded-lg bg-zinc-800/50 px-3 py-2.5 hover:bg-zinc-800 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">
                        <span className={bet.predictedWinner === bet.player1 ? 'text-emerald-400 font-medium' : ''}>{bet.player1}</span>
                        <span className="text-zinc-600 mx-1.5">vs</span>
                        <span className={bet.predictedWinner === bet.player2 ? 'text-emerald-400 font-medium' : ''}>{bet.player2}</span>
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {bet.profileName} · @ {fmtOdds(bet.odds)} · {fmtPct(bet.confidence)} conf
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <StatusBadge status={bet.status} />
                      <p className={`text-xs mt-1 font-medium tabular-nums ${bet.profit > 0 ? 'text-emerald-400' : bet.profit < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                        {bet.profit > 0 ? '+' : ''}{bet.profit.toFixed(0)}₽
                      </p>
                    </div>
                  </div>
                )) : (
                  <div className="flex items-center justify-center h-[200px] text-zinc-600 text-sm">No bets yet</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Live Matches Ticker */}
      {liveMatches.length > 0 && (
        <Card className="bg-zinc-900/80 border-emerald-500/30 py-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
              <Play className="size-4" />
              Live Matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {liveMatches.map(m => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                  <CircleDot className="size-3 text-emerald-400 animate-pulse shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200 truncate">
                      {m.player1} <span className="text-zinc-600">vs</span> {m.player2}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {m.league || m.tournament || ''} · {m.score1 ?? 0}–{m.score2 ?? 0}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </motion.div>
  )
}

// ============================================================
// TAB: MATCHES
// ============================================================

function MatchesTab() {
  const { matches, loading } = useTTStore()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = useMemo(() => {
    let result = matches
    if (statusFilter !== 'all') {
      result = result.filter(m => m.status === statusFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(m =>
        m.player1.toLowerCase().includes(q) ||
        m.player2.toLowerCase().includes(q) ||
        (m.league && m.league.toLowerCase().includes(q)) ||
        (m.tournament && m.tournament.toLowerCase().includes(q))
      )
    }
    return result
  }, [matches, statusFilter, searchQuery])

  const statuses = ['all', 'live', 'upcoming', 'finished', 'void']

  return (
    <motion.div {...fadeSlideUp} transition={{ duration: 0.3 }} className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {statuses.map(s => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? 'default' : 'outline'}
              className={statusFilter === s ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}
              onClick={() => setStatusFilter(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              <span className="ml-1 text-xs opacity-60">
                {s === 'all' ? matches.length : matches.filter(m => m.status === s).length}
              </span>
            </Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
          <Input
            placeholder="Search players..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 bg-zinc-800/50 border-zinc-700 text-zinc-200 placeholder:text-zinc-600 focus-visible:border-emerald-500/50"
          />
        </div>
      </div>

      {/* Match Count */}
      <p className="text-xs text-zinc-500">{filtered.length} matches found</p>

      {/* Match List */}
      <ScrollArea className="max-h-[600px]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pr-3">
          {filtered.length > 0 ? filtered.map(match => (
            <MatchCard key={match.id} match={match} />
          )) : (
            <div className="col-span-2 flex items-center justify-center h-[200px] text-zinc-600 text-sm rounded-lg border border-zinc-800 bg-zinc-900/50">
              No matches found
            </div>
          )}
        </div>
      </ScrollArea>
    </motion.div>
  )
}

function MatchCard({ match }: { match: Match }) {
  const isLive = match.status === 'live'
  return (
    <div className={`rounded-lg border px-4 py-3 transition-colors hover:bg-zinc-800/50 ${isLive ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/80'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200 truncate">
            {match.player1}
            <span className="text-zinc-600 mx-1.5">vs</span>
            {match.player2}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {match.league && <span className="text-xs text-zinc-500 truncate">{match.league}</span>}
            {match.tournament && !match.league && <span className="text-xs text-zinc-500 truncate">{match.tournament}</span>}
          </div>
        </div>
        <StatusBadge status={match.status} pulse={isLive} />
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-zinc-500">
        <div className="flex items-center gap-3">
          {match.score1 != null && match.score2 != null && (
            <span className="font-mono font-medium text-zinc-300">
              {match.score1} – {match.score2}
            </span>
          )}
          {match.odds1 && match.odds2 && (
            <span className="text-zinc-600">
              @ {fmtOdds(match.odds1)} / {fmtOdds(match.odds2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Clock className="size-3" />
          {timeAgo(match.startTime)}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TAB: AI BETS
// ============================================================

function AiBetsTab() {
  const { aiBets, loading } = useTTStore()
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return aiBets
    return aiBets.filter(b => b.status === statusFilter)
  }, [aiBets, statusFilter])

  const won = aiBets.filter(b => b.status === 'won')
  const lost = aiBets.filter(b => b.status === 'lost')
  const pending = aiBets.filter(b => b.status === 'pending')
  const skipped = aiBets.filter(b => b.status === 'skipped')
  const voided = aiBets.filter(b => b.status === 'void')

  const totalProfit = aiBets.reduce((acc, b) => acc + b.profit, 0)

  const statuses = ['all', 'pending', 'won', 'lost', 'skipped', 'void']

  return (
    <motion.div {...fadeSlideUp} transition={{ duration: 0.3 }} className="space-y-4">
      {/* Filter Bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {statuses.map(s => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? 'default' : 'outline'}
            className={statusFilter === s ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1 text-xs opacity-60">
              {s === 'all' ? aiBets.length : aiBets.filter(b => b.status === s).length}
            </span>
          </Button>
        ))}
      </div>

      {/* Stats Summary Row */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-2 text-center">
          <p className="text-xs text-zinc-500">Total</p>
          <p className="text-sm font-bold text-zinc-200">{aiBets.length}</p>
        </div>
        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-center">
          <p className="text-xs text-emerald-500/70">Won</p>
          <p className="text-sm font-bold text-emerald-400">{won.length}</p>
        </div>
        <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2 text-center">
          <p className="text-xs text-red-500/70">Lost</p>
          <p className="text-sm font-bold text-red-400">{lost.length}</p>
        </div>
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-center">
          <p className="text-xs text-amber-500/70">Pending</p>
          <p className="text-sm font-bold text-amber-400">{pending.length}</p>
        </div>
        <div className="rounded-lg bg-zinc-500/5 border border-zinc-700/50 px-3 py-2 text-center">
          <p className="text-xs text-zinc-500">Skipped</p>
          <p className="text-sm font-bold text-zinc-400">{skipped.length}</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-center ${totalProfit >= 0 ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
          <p className={`text-xs ${totalProfit >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>P&L</p>
          <p className={`text-sm font-bold ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtMoney(totalProfit)}</p>
        </div>
      </div>

      {/* Bet List */}
      <ScrollArea className="max-h-[600px]">
        <div className="space-y-1.5 pr-3">
          {filtered.length > 0 ? filtered.map(bet => (
            <AiBetCard key={bet.id} bet={bet} />
          )) : (
            <div className="flex items-center justify-center h-[200px] text-zinc-600 text-sm rounded-lg border border-zinc-800 bg-zinc-900/50">
              No bets found
            </div>
          )}
        </div>
      </ScrollArea>
    </motion.div>
  )
}

function AiBetCard({ bet }: { bet: AiBet }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 py-3 hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Players */}
          <p className="text-sm text-zinc-200 truncate">
            <span className={bet.predictedWinner === bet.player1 ? 'text-emerald-400 font-semibold' : ''}>{bet.player1}</span>
            <span className="text-zinc-600 mx-1.5">vs</span>
            <span className={bet.predictedWinner === bet.player2 ? 'text-emerald-400 font-semibold' : ''}>{bet.player2}</span>
          </p>
          {/* Meta */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Bot className="size-3" />
              {bet.profileName}
            </span>
            <span>@ {fmtOdds(bet.odds)}</span>
            <span>Ставка: {bet.stake.toFixed(0)}₽</span>
            <span>Выигрыш: {bet.potentialWin.toFixed(0)}₽</span>
          </div>
          {/* Confidence Bar */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs text-zinc-500 w-16 shrink-0">Confidence</span>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden max-w-[120px]">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${bet.confidence}%`,
                  backgroundColor: bet.confidence >= 70 ? 'hsl(142, 76%, 36%)' : bet.confidence >= 50 ? 'hsl(45, 93%, 47%)' : 'hsl(0, 72%, 51%)',
                }}
              />
            </div>
            <span className="text-xs text-zinc-400 tabular-nums">{fmtPct(bet.confidence)}</span>
          </div>
          {/* Reasoning Snippet */}
          {bet.reasoning && (
            <p className="text-xs text-zinc-600 mt-1.5 line-clamp-2">{bet.reasoning}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StatusBadge status={bet.status} />
          <p className={`text-sm font-semibold tabular-nums ${bet.profit > 0 ? 'text-emerald-400' : bet.profit < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
            {bet.profit > 0 ? '+' : ''}{bet.profit.toFixed(0)}₽
          </p>
          <p className="text-xs text-zinc-600">{timeAgo(bet.createdAt)}</p>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TAB: AI PROFILES
// ============================================================

function AiProfilesTab() {
  const { aiProfiles } = useTTStore()

  return (
    <motion.div {...fadeSlideUp} transition={{ duration: 0.3 }} className="space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-zinc-500" />
        <p className="text-sm text-zinc-400">{aiProfiles.length} AI profiles</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {aiProfiles.length > 0 ? aiProfiles.map(profile => (
          <AiProfileCard key={profile.id} profile={profile} />
        )) : (
          <div className="col-span-3 flex items-center justify-center h-[200px] text-zinc-600 text-sm rounded-lg border border-zinc-800 bg-zinc-900/50">
            No AI profiles
          </div>
        )}
      </div>
    </motion.div>
  )
}

function AiProfileCard({ profile }: { profile: AiProfile }) {
  const profitColor = (profile.totalProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
  const profitBg = (profile.totalProfit ?? 0) >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
  const borderColor = profile.color ? `border-l-[3px]` : ''
  const borderLeftColor = profile.color ? `border-l-[${profile.color}]` : ''

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900/80 overflow-hidden hover:bg-zinc-800/50 transition-colors ${borderColor}`}
      style={profile.color ? { borderLeftColor: profile.color } : undefined}
    >
      <div className="px-4 pt-4 pb-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none">{profile.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-100 truncate">{profile.name}</h3>
              {profile.isActive ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400 font-medium">
                  Active
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-zinc-700/50 px-1.5 py-0.5 text-[10px] text-zinc-500 font-medium">
                  Inactive
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{profile.strategy}</p>
          </div>
        </div>

        {/* Description */}
        {profile.description && (
          <p className="text-xs text-zinc-500 mt-2 line-clamp-2">{profile.description}</p>
        )}

        <Separator className="my-3 bg-zinc-800" />

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <MetricItem label="Bankroll" value={fmtMoneyPlain(profile.currentAmount)} />
          <MetricItem label="P&L" value={fmtMoney(profile.totalProfit ?? 0)} color={profitColor} />
          <MetricItem label="Win Rate" value={profile.winRate != null ? fmtPct(profile.winRate) : `${profile.wonBets}/${profile.totalBets}`} />
          <MetricItem label="Yield" value={profile.yieldPct != null ? fmtPct(profile.yieldPct) : '—'} />
          <MetricItem label="Bets" value={`${profile.wonBets}W ${profile.lostBets}L ${profile.pendingBets}P`} />
          <MetricItem label="Turnover" value={profile.turnover != null ? fmtMoneyPlain(profile.turnover) : '—'} />
        </div>

        {/* Stop-loss warning */}
        {profile.stopLossActive && (
          <div className="flex items-center gap-1.5 mt-3 rounded-md bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
            <AlertTriangle className="size-3 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-400">
              Stop-loss active {profile.drawdownPct != null ? `(${fmtPct(profile.drawdownPct)} drawdown)` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className={`text-sm font-medium tabular-nums ${color || 'text-zinc-300'}`}>{value}</p>
    </div>
  )
}

// ============================================================
// TAB: BANKROLL
// ============================================================

function BankrollTab() {
  const { aiBankroll, aiProfiles } = useTTStore()

  const profileChartData = useMemo(() => {
    return aiProfiles
      .filter(p => p.totalProfit != null)
      .sort((a, b) => (b.totalProfit ?? 0) - (a.totalProfit ?? 0))
      .map(p => ({
        name: p.name,
        profit: Number((p.totalProfit ?? 0).toFixed(2)),
        fill: p.color || 'hsl(142, 76%, 36%)',
      }))
  }, [aiProfiles])

  const profileBarConfig: ChartConfig = {
    profit: { label: 'Profit', color: 'hsl(142, 76%, 36%)' },
  }

  const settledBets = aiProfiles.flatMap(p => p.recentBets || []).slice(0, 15)

  return (
    <motion.div {...fadeSlideUp} transition={{ duration: 0.3 }} className="space-y-4">
      {/* Main Bankroll Display */}
      <Card className="bg-zinc-900/80 border-zinc-800 py-4 overflow-hidden">
        <CardContent className="relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-amber-500/5 pointer-events-none" />
          <div className="relative text-center py-6">
            <p className="text-xs uppercase tracking-widest text-zinc-500 mb-2">AI Bankroll</p>
            {aiBankroll ? (
              <>
                <p className={`text-4xl md:text-5xl font-bold tabular-nums ${aiBankroll.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtMoneyPlain(aiBankroll.currentAmount)}
                </p>
                <p className={`text-lg font-medium mt-1 ${aiBankroll.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {aiBankroll.totalProfit >= 0 ? <ArrowUpRight className="inline size-4" /> : <ArrowDownRight className="inline size-4" />}
                  {fmtMoney(aiBankroll.totalProfit)} total P&L
                </p>
              </>
            ) : (
              <p className="text-zinc-600 text-lg">No bankroll data</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics Grid */}
      {aiBankroll && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard icon={Target} label="Win Rate" value={fmtPct(aiBankroll.winRate)} />
          <MetricCard icon={TrendingUp} label="Yield" value={fmtPct(aiBankroll.yield)} color={aiBankroll.yield >= 0 ? 'text-emerald-400' : 'text-red-400'} />
          <MetricCard icon={BarChart3} label="Turnover" value={fmtMoneyPlain(aiBankroll.turnover)} />
          <MetricCard icon={TrendingDown} label="Drawdown" value={fmtPct(aiBankroll.drawdownPct)} color="text-amber-400" />
        </div>
      )}

      {/* Additional Metrics */}
      {aiBankroll && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard icon={Flame} label="Peak" value={fmtMoneyPlain(aiBankroll.peakAmount)} />
          <MetricCard icon={Wallet} label="Flat Stake" value={fmtMoneyPlain(aiBankroll.flatAmount)} />
          <MetricCard icon={CheckCircle2} label="Won" value={`${aiBankroll.wonBets} / ${aiBankroll.totalBets}`} color="text-emerald-400" />
          <MetricCard icon={XCircle} label="Lost" value={`${aiBankroll.lostBets} / ${aiBankroll.totalBets}`} color="text-red-400" />
        </div>
      )}

      {/* Stop-loss Indicator */}
      {aiBankroll?.stopLossActive && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <Shield className="size-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-400">Stop-Loss Protection Active</p>
            <p className="text-xs text-amber-400/70">Betting paused to protect bankroll. Drawdown at {fmtPct(aiBankroll.drawdownPct)}.</p>
          </div>
        </div>
      )}

      {/* Profile Profits Bar Chart */}
      {profileChartData.length > 0 && (
        <Card className="bg-zinc-900/80 border-zinc-800 py-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <BarChart3 className="size-4 text-zinc-500" />
              Profile P&L Comparison
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={profileBarConfig} className="h-[250px] w-full">
              <BarChart data={profileChartData} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.3)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={(v) => `${v}₽`} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} width={100} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="profit" radius={[0, 4, 4, 0]}>
                  {profileChartData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </motion.div>
  )
}

function MetricCard({ icon: Icon, label, value, color = 'text-zinc-200' }: {
  icon: React.ElementType
  label: string
  value: string
  color?: string
}) {
  return (
    <Card className="gap-2 bg-zinc-900/80 border-zinc-800 py-3">
      <CardContent className="flex items-center gap-3 p-0 px-4">
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 ${color}`}>
          <Icon className="size-4" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</p>
          <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// COLLECTION FOOTER
// ============================================================

function CollectionFooter() {
  const { collectionLogs, lastFetch } = useTTStore()

  const recentLogs = collectionLogs.slice(0, 5)

  return (
    <div className="mt-6 border-t border-zinc-800 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="size-3.5 text-zinc-600" />
          <span className="text-xs text-zinc-500">Collection Logs</span>
        </div>
        {lastFetch && (
          <span className="text-xs text-zinc-600">Last refresh: {timeAgo(new Date(lastFetch).toISOString())}</span>
        )}
      </div>
      {recentLogs.length > 0 ? (
        <div className="flex flex-wrap gap-2 mt-2">
          {recentLogs.map(log => (
            <div key={log.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
              log.status === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
              log.status === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
              'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}>
              <span>{log.source}</span>
              <span className="text-zinc-600">·</span>
              <span>{log.matchesCollected} matches</span>
              <span className="text-zinc-600">·</span>
              <span>{timeAgo(log.createdAt)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-600 mt-1">No collection logs yet</p>
      )}
    </div>
  )
}

// ============================================================
// MAIN DASHBOARD
// ============================================================

export default function Dashboard() {
  const { activeTab, setActiveTab, fetchAll, loading } = useTTStore()
  const [now, setNow] = useState(new Date())
  const [collecting, setCollecting] = useState(false)
  const [predicting, setPredicting] = useState(false)
  const [lastAction, setLastAction] = useState<string>('')

  const handleCollect = async () => {
    setCollecting(true)
    setLastAction('')
    try {
      const res = await fetch('/api/collect/trigger', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setLastAction(`Собрано: ${data.created} новых, ${data.updated} обновлено. Предсказаний: ${data.predictions?.betsPlaced ?? 0}`)
      } else {
        setLastAction(`Ошибка: ${data.error || 'unknown'}`)
      }
      await fetchAll()
    } catch (e) {
      setLastAction('Ошибка сети при сборе')
    }
    setCollecting(false)
  }

  const handlePredict = async () => {
    setPredicting(true)
    setLastAction('')
    try {
      const res = await fetch('/api/predict', { method: 'POST' })
      const data = await res.json()
      if (data.betsPlaced !== undefined) {
        setLastAction(`Предсказаний: ${data.betsPlaced} ставок, ${data.betsSkipped} пропущено`)
      } else {
        setLastAction(`Результат: ${JSON.stringify(data)}`)
      }
      await fetchAll()
    } catch (e) {
      setLastAction('Ошибка сети при предсказании')
    }
    setPredicting(false)
  }

  // Force dark theme
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  // Clock
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Initial fetch & auto-refresh
  useEffect(() => {
    fetchAll()
    const interval = setInterval(() => fetchAll(), 60000)
    return () => clearInterval(interval)
  }, [fetchAll])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Logo & Title */}
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-600/20">
                <Trophy className="size-4 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-zinc-100 tracking-tight">TT Predict</h1>
                <p className="text-[10px] text-zinc-600 -mt-0.5">Table Tennis AI Dashboard</p>
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">
              {/* Action buttons */}
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-zinc-700 text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-xs"
                onClick={handleCollect}
                disabled={collecting}
              >
                {collecting ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                <span className="hidden sm:inline">Собрать</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5 text-xs"
                onClick={handlePredict}
                disabled={predicting}
              >
                {predicting ? <Loader2 className="size-3 animate-spin" /> : <Cpu className="size-3" />}
                <span className="hidden sm:inline">Предсказать</span>
              </Button>
              <div className="w-px h-5 bg-zinc-800" />
              {/* Refresh indicator */}
              {loading && (
                <Loader2 className="size-3.5 text-emerald-400 animate-spin" />
              )}
              {/* Clock */}
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500">
                <Clock className="size-3" />
                <span className="font-mono tabular-nums">{formatTime(now)}</span>
              </div>
              {/* Date */}
              <span className="hidden md:block text-xs text-zinc-600">{formatDate(now)}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {loading && !useTTStore.getState().lastFetch ? (
          <LoadingSkeleton />
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* Tab Navigation */}
            <div className="overflow-x-auto pb-2">
              <TabsList className="bg-zinc-900 border border-zinc-800 h-10 p-1">
                <TabsTrigger value="overview" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm text-zinc-400">
                  <LayoutDashboard className="size-3.5" />
                  <span className="hidden sm:inline">Overview</span>
                </TabsTrigger>
                <TabsTrigger value="matches" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm text-zinc-400">
                  <Trophy className="size-3.5" />
                  <span className="hidden sm:inline">Matches</span>
                </TabsTrigger>
                <TabsTrigger value="ai-bets" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm text-zinc-400">
                  <Zap className="size-3.5" />
                  <span className="hidden sm:inline">AI Bets</span>
                </TabsTrigger>
                <TabsTrigger value="ai-profiles" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm text-zinc-400">
                  <UserCircle className="size-3.5" />
                  <span className="hidden sm:inline">AI Profiles</span>
                </TabsTrigger>
                <TabsTrigger value="bankroll" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm text-zinc-400">
                  <Landmark className="size-3.5" />
                  <span className="hidden sm:inline">Bankroll</span>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Tab Contents */}
            <TabsContent value="overview">
              <OverviewTab />
            </TabsContent>
            <TabsContent value="matches">
              <MatchesTab />
            </TabsContent>
            <TabsContent value="ai-bets">
              <AiBetsTab />
            </TabsContent>
            <TabsContent value="ai-profiles">
              <AiProfilesTab />
            </TabsContent>
            <TabsContent value="bankroll">
              <BankrollTab />
            </TabsContent>
          </Tabs>
        )}

        {/* Action feedback */}
        {lastAction && (
          <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300">{lastAction}</p>
          </div>
        )}

        {/* Collection Footer */}
        <CollectionFooter />
      </main>

      {/* Bottom Bar */}
      <footer className="sticky bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2">
          <div className="flex items-center justify-between text-[10px] text-zinc-600">
            <span>TT Predict v1.0 — AI-Powered Table Tennis Predictions</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {loading ? 'Syncing...' : 'Connected'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}
