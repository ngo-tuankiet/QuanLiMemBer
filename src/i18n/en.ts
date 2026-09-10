/**
 * BẢN TIẾNG ANH.
 *
 * `const en: Dict` — thiếu một khoá là lỗi biên dịch. Đừng đổi thành `as const` hay bỏ
 * chú thích kiểu: làm vậy là gỡ đúng cái chốt khiến bản dịch không thể thiếu sót.
 *
 * SỐ NHIỀU LÀ LÝ DO CÁC KHOÁ CÓ SỐ ĐỀU LÀ HÀM. Tiếng Việt không đổi dạng từ theo số
 * lượng, tiếng Anh thì có — "1 group" và "3 groups". Ghép chuỗi từ một danh từ cố định
 * sẽ ra tiếng Anh sai ở mọi số khác 1.
 */

import type { Dict } from '@/i18n/vi';

export const en: Dict = {
  nav: {
    dashboard: 'Dashboard',
    portfolio: 'Portfolio',
    overview: 'Overview',
    positions: 'Positions',
    allocation: 'Allocation',
    transactions: 'Transactions',
    allTransactions: 'All Transactions',
    buy: 'Buy',
    sell: 'Sell',
    dividend: 'Dividends',
    strategies: 'Strategies',
    market: 'Market',
    sectors: 'Sectors',
    marketData: 'Market Data',
    risk: 'Risk',
    teams: 'Teams',
    members: 'Members',
    approvals: 'Approvals',
    reports: 'Reports',
    auditLog: 'Audit Log',
    settings: 'Settings',
    adminSection: 'ADMIN',
    organization: 'Organisation',
    manageStrategies: 'Manage strategies',
    usersApprovals: 'Users & approvals',
    permissionMatrix: 'Permission matrix',
    logout: 'Sign out',
    priceSession: (ngay: string) => `Prices ${ngay}`,
  },

  kpi: {
    portfolioValue: 'Portfolio Value',
    portfolioValueSub: 'positions + cash',
    investedCapital: 'Invested Capital',
    availableCash: 'Available Cash',
    teamCash: 'Team cash',
    totalPnl: 'Total P&L',
    alphaVs: (chiSo: string) => `Alpha vs ${chiSo}`,
    ofPortfolio: (pct: string) => `${pct} of portfolio`,
    onCost: (pct: string) => `${pct} on cost`,
    holdingReserve: (tien: string) => `${tien} held in reserve`,
    notFiltered: 'not affected by filters',
    noCapitalYet: 'no capital deployed',
    settled: (tien: string) => `realised ${tien}`,
    positionValue: 'Position value',
    cost: 'Cost basis',
    notIncludingCash: 'cash not included',
    spentOnHeld: 'spent on current holdings',
    noGrantYet: 'no capital granted',
    remainingOfGrant: (pct: string) => `${pct} of grant left`,

    hintValueFiltered: (pv: string, tienONhom: boolean) =>
      `Market value of positions within the current filter (${pv}) only — cash NOT included. ` +
      (tienONhom
        ? 'Team cash sits in the card to the right and is a separate figure.'
        : 'Cash sits in the Available Cash card and belongs to the whole portfolio — filtering by sector or strategy cannot split it.'),
    hintValueWhole: 'Market value of positions plus the cash balance (§12). ',
    hintWindow: (n: number, tu: string, den: string, khoang: string) =>
      ` The change is rebuilt from ${n} closing prices, ${tu} to ${den} — the period you picked (${khoang}) may be longer than the price data available.`,
    hintNoStrategySeries:
      ' No time series when filtering by strategy: the per-session series needs each trade’s money split by its allocation (§16), which is not built for a single strategy yet. Clear the strategy filter to see it.',
    hintNoSeries: ' Not enough per-session price data to measure change over time.',

    hintCostFiltered: (pv: string) =>
      `What was actually paid for the positions held within the current filter (${pv}) — fees and tax included. The card on the left is the market value of the same holdings; the difference between them is unrealised P&L.`,
    hintInvestedWhole: 'Market value of the positions currently held.',

    hintCash: 'Cash balance MINUS the reserve — not the cash balance (§14).',
    hintCashNotFiltered:
      ' Filtering by sector or strategy does not change this figure: capital is granted to teams, not to sectors.',
    hintTeamNoGrant: (daRut: string) =>
      `This team has NO capital flow of its own, so there is no "team cash" to show. It is drawing on the shared pool and has withdrawn ${daRut} net so far. Tag capital flows with a team (capital_flows.teamId) to make this figure meaningful.`,
    hintTeamCash: (cap: string, daDung: string) =>
      `Capital granted to this team minus what it has spent: granted ${cap}, net used ${daDung}. The reserve is NOT deducted — that belongs to the whole portfolio, and deducting it per team would deduct it four times.`,

    hintPnl: 'Realised plus unrealised P&L, measured against the cost actually paid.',
    hintPnlNoCost:
      ' No positions held, so there is no cost to divide by — the rate shows "—", not 0%.',

    hintAlpha: (khoang: string) =>
      `Ahead of or behind the market over the SAME window ${khoang}. Making 5% while the index gains 8% is a poor result.`,
    hintAlphaNoStrategy:
      'Not measurable for a single strategy: the per-session series needs each trade’s money split by its allocation (§16). Showing whole-portfolio alpha here would be read as the strategy’s alpha.',
    alphaNotForStrategy: 'not applicable to a single strategy',
    alphaSub: (dm: string, ma: string, cs: string) => `portfolio ${dm} · ${ma} ${cs}`,

    alphaNoPositions: 'no positions yet',
    alphaNoPositionsHint:
      'Not measurable because the portfolio holds no positions to build a per-session ' +
      'series from. Index data is not missing — this appears as soon as you record a trade.',
    alphaNoPriceHistory: 'no price history since the purchase date',
    alphaNoPriceHistoryHint:
      'The portfolio DOES hold positions, but no per-session series can be built: the ' +
      'price history table has no session on or after the purchase date. Run the market ' +
      'data sync to load the missing sessions.',
    alphaNoBenchmark: (ma: string) => `no ${ma} series`,
    alphaNoBenchmarkHint: (ma: string) =>
      `Not measurable because there is no ${ma} data for this window. ` +
      'Run the market data sync to load the index history.',
    alphaMismatch: 'the two sides cover different windows',
    alphaMismatchHint:
      'Not measurable: portfolio performance and the index move currently cover ' +
      'different windows, so the difference between them is meaningless.',

    fromSessions: (tu: string, n: number) => `from ${tu} · ${n} sessions`,
    unsettled: (tien: string) => `unrealised ${tien}`,
  },

  filter: {
    portfolio: 'Portfolio',
    team: 'Team',
    strategy: 'Strategy',
    sector: 'Sector',
    period: 'Period',
    all: 'All',
  },

  period: {
    '1W': '1 week',
    '1M': '1 month',
    '3M': '3 months',
    '6M': '6 months',
    YTD: 'Year to date',
    ALL: 'All time',
  },

  dash: {
    noPortfolio: 'No portfolio yet',
    noPortfolioHint: 'Run npm run db:seed to create the default portfolio.',
    positionCount: (n: number) => `${n} position${n === 1 ? '' : 's'}`,
    scopeTeam: (ten: string) => `scoped to ${ten}`,
    noTeam: 'unassigned',
    filtering: (ds: string) => `filtered by: ${ds}`,

    pendingTrades: (n: number) => `${n} trade${n === 1 ? '' : 's'}`,
    pendingWithdrawals: (n: number) =>
      `${n} withdrawal request${n === 1 ? '' : 's'}`,
    pendingUsers: (n: number) => `${n} account${n === 1 ? '' : 's'}`,
    awaitingApproval: 'awaiting approval',
    and: ' and ',
    viewQueue: 'Open queue',

    teamPnlTitle: 'Capital & P&L by team',
    teamPnlSub: 'Each team computed from its own chain of trades',
    deployedCapital: 'Capital deployed',
    pnlOnCost: 'P&L on cost',
    colTeam: 'Team',
    colRealized: 'Realised',
    colUnrealized: 'Unrealised',
    colOrders: 'Trades',
    colSymbols: 'Symbols',
    unassigned: 'unassigned',
    unassignedTitle: 'Trades not linked to a team — still counted in the portfolio',
    unassignedNote:
      '"Unassigned" means the executing user belongs to no team — an admin entering on ' +
      'someone’s behalf, for instance. Including this row makes the team totals add up to ' +
      'the whole portfolio. Assign teams in ',
    usersLink: 'Users & approvals',

    noPositions: 'No open positions.',
    noHoldings: 'No holdings yet.',
    noTrades: 'No trades yet.',
    sectorCenter: 'sectors',
    strategyCenter: 'strategies',

    sectorExposure: 'Sector Exposure',
    riskAlerts: 'Risk & Alerts',
    strategyAllocation: 'Strategy Allocation',
    top10Title: 'Top 10 holdings',
    colValue: 'Value',

    ibTitle: 'Accounts & capital by IB',
    ibSub: (n: number) =>
      `${n} account${n === 1 ? '' : 's'} · net confirmed capital`,
    ibNoPermission: 'You do not have permission to view capital data.',
    ibNoAccounts: 'No broker accounts yet',
    ibInScope: ' in the current scope',
    ibDeclareAt: '. Members declare their own at ',
    myAccounts: 'My account',
    ibTotalVia: (n: number) =>
      ` across ${n} introducer${n === 1 ? '' : 's'} · deposits minus withdrawals, confirmed flows only.`,
    ibClosed: (n: number) =>
      ` ${n} closed account${n === 1 ? '' : 's'} still counted — deposit history is kept.`,
    ibDirect: 'Direct, no IB',
    ibOther: (n: number) => `Other (${n} introducers)`,

    noAlerts: 'No open alerts',
    acknowledged: ' · acknowledged',
    openAlerts: (n: number) => `${n} open alert${n === 1 ? '' : 's'}`,

    recentActivity: 'Recent Activity',
    recentTrades: 'Recent trades',
    viewAllTrades: 'View all trades',
    colTime: 'Time',
    colType: 'Type',
    colStock: 'Symbol',
    colStrategy: 'Strategy',
    colStatus: 'Status',

    topMembers: 'Top performers',
    topMembersSub: 'Ranked by P&L; each person computed from their own trades',
    viewAllMembers: 'View all members',
    noMembers: 'Nobody has traded within the current scope.',
    moreMembers: (n: number) => `${n} more — `,
    fullList: 'see the full list',
    memberCount: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
    orderCount: (n: number) => `${n} trade${n === 1 ? '' : 's'}`,

    teamLocked: (ten: string) =>
      `You can only see ${ten} — position.view_all is required to pick another team`,
    ibTotalPrefix: 'Total ',
    alertAgo: ' · ',
    footerNote:
      'Every number on this page is computed from trades, market prices and capital ' +
      'flows — no table stores P&L. Realised P&L ',
    footerUnrealized: ' · unrealised ',
  },
  page: {
    portfolioOverview: 'Portfolio Overview',
    topPositions: 'Top Positions',
    capitalAllocation: 'Capital Allocation',
    lastUpdated: 'Last Updated',
    dataStatus: 'Data Status',
    before: 'BEFORE',
    after: 'AFTER',
    next: 'Next →',
    prev: '← Previous',
  },

  common: {
    details: 'Details',
    viewAll: 'View all',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    edit: 'Edit',
    confirm: 'Confirm',
    saving: 'Saving…',
    noData: 'No data yet',
    symbol: 'Symbol',
    sector: 'Sector',
    quantity: 'Quantity',
    avgCost: 'Avg cost',
    currentPrice: 'Price',
    cost: 'Cost',
    marketValue: 'Market value',
    pnl: 'P&L',
    pricePnl: 'Price P&L',
    dividend: 'Dividends',
    total: 'Total',
    ret: 'Return',
    retPct: 'Return %',
    weight: 'Weight',
  },
};
