/**
 * Mongoose Global Connection Singleton
 *
 * Uses a global cache to survive Next.js hot-reloads in development and to
 * reuse warm connections across serverless invocations in production.
 *
 * Rules:
 *  - NEVER call mongoose.connection.close() — keep the connection warm.
 *  - bufferCommands: false — fail immediately if not connected (no silent queuing).
 *  - Promise deduplication — concurrent cold-start requests share one connect().
 */
import 'server-only';
import mongoose from 'mongoose';
import { serverEnv } from '@/env/server';

// ── Global Cache Type ─────────────────────────────────────────────────────────

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// Augment Node.js global so the cache survives hot-reloads in development.
declare global {
  var __mongooseCache: MongooseCache | undefined;
}

if (!global.__mongooseCache) {
  global.__mongooseCache = { conn: null, promise: null };
}

const cache = global.__mongooseCache;

// ── Connection ────────────────────────────────────────────────────────────────

/**
 * Returns a live Mongoose connection, establishing one if needed.
 *
 * Call this at the top of every Route Handler or Server Action that needs the DB:
 *   await connectToDatabase();
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  // 1. Warm path — return existing connection immediately
  if (cache.conn) return cache.conn;

  // 2. Cold path — deduplicate concurrent connection attempts
  if (!cache.promise) {
    cache.promise = mongoose.connect(serverEnv.MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    // Reset promise so the next request can retry cleanly
    cache.promise = null;
    throw err;
  }

  return cache.conn;
}
