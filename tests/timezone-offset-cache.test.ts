import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisguise } from '../src/injected/disguise';
import { createSignalSpoof } from '../src/injected/signal-spoof';

/**
 * 偏移量缓存的边界：一个 UTC 小时里可能发生两次 DST 偏移。
 *
 * 这一组测试的来历：缓存键原来是 `Math.floor(time / 3600000)`。夏令时切换点按
 * **本地**时刻定义（各地普遍是本地 02:00），换算成 UTC 不一定落在整点 ——
 * Australia/Lord_Howe 的 +10:30→+11:00 在 UTC 15:30，Pacific/Chatham 的
 * +12:45→+13:45 落在 :45。小时桶一旦被切换前的调用填过，切换后那半小时内
 * getTimezoneOffset / getHours / toString 会一起沿用旧偏移。
 *
 * 真值来自原生 `Intl.DateTimeFormat`：这个文件只装 Date 原型上的方法，不装 Intl，
 * 所以 `Intl` 还是未打补丁的原生实现，可以当 oracle 用。
 */

const current: { timezone: string | null } = { timezone: 'UTC' };

const disguise = createDisguise();
const signals = createSignalSpoof({
  timezone: () => current.timezone,
  language: () => null,
  languages: () => null,
  disguise
});
signals.installDateMethods();

function useZone(zone: string): void {
  current.timezone = zone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** 原生 Intl 推出的 offset（getTimezoneOffset 语义：UTC − 本地，分钟） */
function trueOffset(time: number, zone: string): number {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    formatters.set(zone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(time)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((time - asUTC) / 60000);
}

/** 原生 Intl 推出的本地小时（0–23） */
function trueHour(time: number, zone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit'
  });
  return Number(formatter.format(time)) % 24;
}

test('UTC 小时内跨 DST 切换：两个时刻各自拿到自己的 offset（Lord Howe）', () => {
  useZone('Australia/Lord_Howe');
  // 2026-10-04 本地 02:00 / +10:30 → UTC 2026-10-03 15:30
  const before = Date.UTC(2026, 9, 3, 15, 0);
  const after = Date.UTC(2026, 9, 3, 15, 30);
  assert.equal(trueOffset(before, 'Australia/Lord_Howe'), -630, '切换前应为 +10:30');
  assert.equal(trueOffset(after, 'Australia/Lord_Howe'), -660, '切换后应为 +11:00');

  assert.equal(new Date(before).getTimezoneOffset(), -630);
  assert.equal(new Date(after).getTimezoneOffset(), -660);
});

test('同一小时内先查切换前、再查切换后：缓存不能串味', () => {
  useZone('Australia/Lord_Howe');
  const before = Date.UTC(2026, 9, 3, 15, 0);
  const after = Date.UTC(2026, 9, 3, 15, 45);
  assert.equal(new Date(before).getTimezoneOffset(), -630);
  assert.equal(new Date(after).getTimezoneOffset(), -660);
});

test('反序查询同样正确（先切换后，再切换前）', () => {
  useZone('Australia/Lord_Howe');
  const before = Date.UTC(2026, 9, 3, 15, 20);
  const after = Date.UTC(2026, 9, 3, 15, 40);
  assert.equal(new Date(after).getTimezoneOffset(), -660);
  assert.equal(new Date(before).getTimezoneOffset(), -630);
});

test('逐分钟扫过切换点：offset 与本地小时都跟原生 Intl 一致', () => {
  // 覆盖三类切换点：非整点 UTC（Lord Howe :30、Chatham :45）、整点 UTC（纽约）
  const windows: Array<{ zone: string; around: number; label: string }> = [
    { zone: 'Australia/Lord_Howe', around: Date.UTC(2026, 9, 3, 15, 30), label: '2026-10-04 +10:30→+11:00' },
    { zone: 'Pacific/Chatham', around: Date.UTC(2026, 8, 26, 14, 0), label: '2026-09-27 +12:45→+13:45' },
    { zone: 'America/New_York', around: Date.UTC(2026, 2, 8, 7, 0), label: '2026-03-08 -05:00→-04:00' },
    { zone: 'Australia/Eucla', around: Date.UTC(2026, 5, 1, 0, 0), label: '无 DST 的 +08:45 对照' }
  ];

  for (const { zone, around, label } of windows) {
    useZone(zone);
    const seen = new Set<number>();
    for (let delta = -90; delta <= 90; delta += 5) {
      const time = around + delta * 60000;
      const expected = trueOffset(time, zone);
      seen.add(expected);
      assert.equal(
        new Date(time).getTimezoneOffset(),
        expected,
        `${zone} ${label} @ ${new Date(time).toISOString()}`
      );
      assert.equal(
        new Date(time).getHours(),
        trueHour(time, zone),
        `${zone} ${label} 本地小时 @ ${new Date(time).toISOString()}`
      );
    }
    if (zone === 'Australia/Eucla') {
      assert.equal(seen.size, 1, 'Eucla 不该出现第二个偏移');
    } else {
      assert.ok(seen.size >= 2, `${zone} 的窗口应该覆盖切换两侧`);
    }
  }
});

test('换时区之后旧偏移立刻作废', () => {
  const time = Date.UTC(2026, 6, 1, 12, 0);
  useZone('Asia/Tokyo');
  assert.equal(new Date(time).getTimezoneOffset(), -540);
  useZone('America/New_York');
  assert.equal(new Date(time).getTimezoneOffset(), 240);
  useZone('Asia/Tokyo');
  assert.equal(new Date(time).getTimezoneOffset(), -540);
});