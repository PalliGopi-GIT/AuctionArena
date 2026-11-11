import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuctionAnnouncer } from '../../apps/web/src/auction-announcements';
import { createRoom } from '../../packages/engine/src/index';
import { settingsSchema } from '../../packages/shared/src/index';

function fixture() {
  const room = createRoom('ANNOUNCE', { id: 'host', name: 'Host' }, settingsSchema.parse({}), 100000);
  room.status = 'LIVE'; room.currentPlayerIndex = 0; room.players[0]!.status = 'open'; room.deadline = 130000;
  room.teams[0]!.ownerId = 'host';
  const messages: { lane: string; text: string; at: number }[] = [];
  const announcer = createAuctionAnnouncer((lane, text) => { if (text) messages.push({ lane, text, at: Date.now() }); });
  return { room, messages, announcer };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => vi.useRealTimers());

describe('auction assistive announcements', () => {
  it('coalesces competing bid updates into the final shared state of a one-second window', () => {
    const { room, messages, announcer } = fixture();
    announcer.update(room, true, 100000);
    for (const amount of [100, 110, 120]) { vi.advanceTimersByTime(200); room.leadingTeamId = 't1'; room.currentBid = amount; announcer.update(room, true, Date.now()); }
    vi.advanceTimersByTime(400);
    expect(messages).toHaveLength(1); expect(messages[0]!.text).toContain('120 lakh');
    announcer.update(room, true, Date.now()); vi.advanceTimersByTime(1000); expect(messages).toHaveLength(1);
  });
  it('announces countdown thresholds once, without narrating the clock each second', () => {
    const { room, messages, announcer } = fixture();
    for (let seconds = 30; seconds >= 1; seconds--) { announcer.update(room, true, room.deadline! - seconds * 1000); vi.advanceTimersByTime(1000); }
    const warnings = messages.filter(message => message.text.includes('seconds remaining'));
    expect(warnings.map(message => message.text.match(/\d+ seconds remaining/)?.[0])).toEqual(['10 seconds remaining', '5 seconds remaining']);
    expect(messages.filter(message => message.lane === 'polite')).toHaveLength(3);
  });
  it('spaces critical pause/result announcements and drops obsolete transient connection warnings', () => {
    const { room, messages, announcer } = fixture();
    announcer.update(room, true, 100000); vi.advanceTimersByTime(1000);
    announcer.update(room, false, Date.now()); vi.advanceTimersByTime(200); announcer.update(room, true, Date.now());
    vi.advanceTimersByTime(1000); expect(messages.some(message => message.text.includes('Connection lost'))).toBe(false);
    room.status = 'PAUSED'; announcer.update(room, true, Date.now()); vi.advanceTimersByTime(1000);
    room.status = 'RESULT'; room.players[0]!.status = 'sold'; room.players[0]!.soldTo = 't1'; room.players[0]!.soldPrice = 100;
    announcer.update(room, true, Date.now()); vi.advanceTimersByTime(2000);
    const urgent = messages.filter(message => message.lane === 'urgent');
    expect(urgent).toHaveLength(2); expect(urgent[1]!.at - urgent[0]!.at).toBeGreaterThanOrEqual(2000);
    expect(urgent[1]!.text).toContain('Sold.');
  });
  it('cancels private queued messages on room exit and cancels timers on disposal', () => {
    const { room, messages, announcer } = fixture();
    announcer.update(room, true, 100000); announcer.update(null, false, 100001); vi.advanceTimersByTime(3000);
    expect(messages).toEqual([]);
    announcer.update(room, true, Date.now()); announcer.dispose(); vi.advanceTimersByTime(3000); expect(messages).toEqual([]);
  });
  it('does not announce an obsolete queued bid after the host pauses', () => {
    const { room, messages, announcer } = fixture();
    announcer.update(room, true, Date.now()); vi.advanceTimersByTime(200);
    room.status = 'PAUSED'; announcer.update(room, true, Date.now()); vi.advanceTimersByTime(2000);
    expect(messages).toHaveLength(1); expect(messages[0]!.text).toContain('Auction paused');
  });
  it('announces the current paused state when reconnecting to a paused room', () => {
    const { room, messages, announcer } = fixture();
    room.status = 'PAUSED'; announcer.update(room, false, Date.now());
    vi.advanceTimersByTime(200); announcer.update(room, true, Date.now()); vi.advanceTimersByTime(1000);
    expect(messages.at(-1)?.text).toContain('Auction paused');
  });
  it('clears a spoken connection warning when the room reconnects', () => {
    const { room } = fixture();
    const alerts: string[] = [];
    const announcer = createAuctionAnnouncer((lane, text) => { if (lane === 'urgent') alerts.push(text); });
    announcer.update(room, true, Date.now()); vi.advanceTimersByTime(1000);
    announcer.update(room, false, Date.now()); vi.advanceTimersByTime(1000);
    expect(alerts.at(-1)).toContain('Connection lost');
    announcer.update(room, true, Date.now()); expect(alerts.at(-1)).toBe('');
  });
  it('preserves the critical-message rate limit across a brief dialog or room exit', () => {
    const { room, messages, announcer } = fixture();
    room.status = 'PAUSED'; announcer.update(room, true, Date.now()); vi.advanceTimersByTime(1000);
    announcer.update(null, false, Date.now()); vi.advanceTimersByTime(100);
    announcer.update(room, true, Date.now()); vi.advanceTimersByTime(1899);
    expect(messages.filter(message => message.lane === 'urgent')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const urgent = messages.filter(message => message.lane === 'urgent');
    expect(urgent).toHaveLength(2); expect(urgent[1]!.at - urgent[0]!.at).toBe(2000);
  });
});
