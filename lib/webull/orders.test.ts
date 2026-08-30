import { beforeEach, describe, expect, it, vi } from 'vitest';

const brokerOrder = {
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
};

vi.mock('@/lib/prisma', () => ({ prisma: { brokerOrder, brokerOrderFill: { create: vi.fn() } } }));
vi.mock('@/lib/python-runner', () => ({ runPython: vi.fn(), runWebull: vi.fn() }));
vi.mock('./audit', () => ({ getKillSwitch: vi.fn(), writeBrokerAudit: vi.fn() }));
vi.mock('./journal-sync', () => ({ syncLiveFill: vi.fn() }));

const { runPython, runWebull } = await import('@/lib/python-runner');
const { getKillSwitch } = await import('./audit');
const { enforceRiskLimits, parseTicket, placeOrder, replaceOrder, cancelOrder, ticketReferencePrice } =
  await import('./orders');

const baseTicket = {
  accountId: 'acct-1',
  symbol: 'AAPL',
  side: 'BUY' as const,
  qty: 10,
  session: 'CORE' as const,
  tif: 'DAY' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEBULL_APP_KEY = 'key';
  process.env.WEBULL_APP_SECRET = 'secret';
  process.env.WEBULL_ENVIRONMENT = 'sandbox';
  process.env.WEBULL_TRADING_ENABLED = 'true';
  process.env.WEBULL_MAX_NOTIONAL_USD = '5000';
  process.env.WEBULL_MAX_QTY = '100';
  vi.mocked(getKillSwitch).mockResolvedValue(false);
});

describe('notional cap', () => {
  it('prices MARKET orders from the server quote instead of the client', async () => {
    vi.mocked(runPython).mockResolvedValue({ price: 600 });

    await expect(
      enforceRiskLimits({ ...baseTicket, orderType: 'MARKET', lastPrice: 0 }),
    ).rejects.toThrow(/exceeds WEBULL_MAX_NOTIONAL_USD/);

    expect(runPython).toHaveBeenCalledWith(['ticker', 'AAPL']);
  });

  it('ignores a client lastPrice that would understate the notional', async () => {
    vi.mocked(runPython).mockResolvedValue({ price: 600 });

    await expect(
      enforceRiskLimits({ ...baseTicket, orderType: 'MARKET', lastPrice: 0.01 }),
    ).rejects.toThrow(/exceeds WEBULL_MAX_NOTIONAL_USD/);
  });

  it('refuses to send an order it cannot price', async () => {
    vi.mocked(runPython).mockResolvedValue({ price: 0 });

    await expect(
      enforceRiskLimits({ ...baseTicket, orderType: 'MARKET' }),
    ).rejects.toMatchObject({ code: 'quote_unavailable', status: 503 });
  });

  it('uses stopPrice for STOP orders without fetching a quote', async () => {
    await expect(
      enforceRiskLimits({ ...baseTicket, orderType: 'STOP_LOSS', stopPrice: 900 }),
    ).rejects.toThrow(/exceeds WEBULL_MAX_NOTIONAL_USD/);

    expect(runPython).not.toHaveBeenCalled();
  });

  it('allows a priced order inside the cap', async () => {
    const result = await enforceRiskLimits({ ...baseTicket, orderType: 'LIMIT', limitPrice: 100 });
    expect(result.referencePrice).toBe(100);
    expect(runPython).not.toHaveBeenCalled();
  });

  it('never derives a reference price from lastPrice', () => {
    expect(ticketReferencePrice({ ...baseTicket, orderType: 'MARKET', lastPrice: 250 })).toBe(0);
  });
});

describe('replace', () => {
  const workingOrder = {
    id: 'row-1',
    accountId: 'acct-1',
    symbol: 'AAPL',
    side: 'BUY',
    orderType: 'LIMIT',
    tif: 'DAY',
    session: 'CORE',
    qty: 1,
    limitPrice: 100,
    stopPrice: null,
    instrumentType: 'EQUITY',
  };

  it('rejects a replace that grows past the qty cap', async () => {
    brokerOrder.findFirst.mockResolvedValue(workingOrder);

    await expect(replaceOrder('user-1', 'coid-1', { quantity: 5000 })).rejects.toThrow(
      /exceeds WEBULL_MAX_QTY/,
    );
    expect(runWebull).not.toHaveBeenCalled();
  });

  it('rejects a replace that grows past the notional cap', async () => {
    brokerOrder.findFirst.mockResolvedValue(workingOrder);

    await expect(replaceOrder('user-1', 'coid-1', { quantity: 90, limitPrice: 400 })).rejects.toThrow(
      /exceeds WEBULL_MAX_NOTIONAL_USD/,
    );
    expect(runWebull).not.toHaveBeenCalled();
  });

  it('allows shrinking an order while the kill switch is on', async () => {
    brokerOrder.findFirst.mockResolvedValue({ ...workingOrder, qty: 10 });
    brokerOrder.update.mockResolvedValue({
      ...workingOrder,
      qty: 4,
      environment: 'sandbox',
      clientOrderId: 'coid-1',
      webullOrderId: null,
      status: 'SUBMITTED',
      filledQty: 0,
      avgFillPrice: null,
      fees: 0,
      source: 'ticket',
      thesis: null,
      personalTradeId: null,
      previewId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(getKillSwitch).mockResolvedValue(true);
    vi.mocked(runWebull).mockResolvedValue({ result: { ok: true } });

    await expect(replaceOrder('user-1', 'coid-1', { quantity: 4 })).resolves.toMatchObject({
      order: { qty: 4 },
    });
  });

  it('blocks growing an order while the kill switch is on', async () => {
    brokerOrder.findFirst.mockResolvedValue(workingOrder);
    vi.mocked(getKillSwitch).mockResolvedValue(true);

    await expect(replaceOrder('user-1', 'coid-1', { quantity: 20 })).rejects.toMatchObject({
      code: 'trading_disabled',
    });
    expect(runWebull).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  it('still works while the kill switch is on', async () => {
    vi.mocked(getKillSwitch).mockResolvedValue(true);
    brokerOrder.findFirst.mockResolvedValue({ id: 'row-1', accountId: 'acct-1' });
    brokerOrder.update.mockResolvedValue({
      id: 'row-1',
      accountId: 'acct-1',
      environment: 'sandbox',
      clientOrderId: 'coid-1',
      webullOrderId: null,
      symbol: 'AAPL',
      side: 'BUY',
      orderType: 'LIMIT',
      tif: 'DAY',
      session: 'CORE',
      qty: 1,
      limitPrice: 100,
      stopPrice: null,
      status: 'CANCELLED',
      filledQty: 0,
      avgFillPrice: null,
      fees: 0,
      source: 'ticket',
      thesis: null,
      personalTradeId: null,
      previewId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(runWebull).mockResolvedValue({ result: { ok: true } });

    await expect(cancelOrder('user-1', 'coid-1')).resolves.toMatchObject({
      order: { status: 'CANCELLED' },
    });
  });
});

describe('preview consumption', () => {
  const preview = {
    id: 'row-1',
    accountId: 'acct-1',
    clientOrderId: 'coid-1',
    payloadHash: '',
    previewConsumed: false,
    previewExpiresAt: new Date(Date.now() + 60_000),
  };

  const ticket = () =>
    parseTicket({
      accountId: 'acct-1',
      symbol: 'AAPL',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 1,
      limitPrice: 100,
      previewId: 'preview-1',
    });

  it('rejects the loser of a concurrent place race', async () => {
    const { hashPayload } = await import('./orders');
    brokerOrder.findFirst
      .mockResolvedValueOnce({ ...preview, payloadHash: hashPayload(ticket()) })
      .mockResolvedValueOnce({ previewConsumed: true });
    brokerOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(placeOrder('user-1', ticket())).rejects.toMatchObject({
      code: 'preview_consumed',
      status: 409,
    });
    expect(runWebull).not.toHaveBeenCalled();
  });

  it('claims the preview atomically before sending', async () => {
    const { hashPayload } = await import('./orders');
    brokerOrder.findFirst.mockResolvedValue({ ...preview, payloadHash: hashPayload(ticket()) });
    brokerOrder.updateMany.mockResolvedValue({ count: 1 });
    brokerOrder.update.mockResolvedValue({
      id: 'row-1',
      accountId: 'acct-1',
      environment: 'sandbox',
      clientOrderId: 'coid-1',
      webullOrderId: 'wb-1',
      symbol: 'AAPL',
      side: 'BUY',
      orderType: 'LIMIT',
      tif: 'DAY',
      session: 'CORE',
      qty: 1,
      limitPrice: 100,
      stopPrice: null,
      status: 'SUBMITTED',
      filledQty: 0,
      avgFillPrice: null,
      fees: 0,
      source: 'ticket',
      thesis: null,
      personalTradeId: null,
      previewId: 'preview-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(runWebull).mockResolvedValue({ result: { order_id: 'wb-1' } });

    await expect(placeOrder('user-1', ticket())).resolves.toMatchObject({
      order: { status: 'SUBMITTED' },
    });

    expect(brokerOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ previewConsumed: false }),
      }),
    );
  });
});
