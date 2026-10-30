#!/usr/bin/env node
// 复用普通 opaque 回归，追加真实 SW 停止、505 次导航淘汰及真实 session 配额耗尽恢复。
process.argv.push('--recovery=all');
await import('./smoke-opaque-frames.mjs');
