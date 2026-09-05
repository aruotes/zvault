/**
 * Pinata SDK Initializer
 *
 * Instantiates the Pinata V3 SDK using the server's master PINATA_JWT.
 *
 * ⚠️  SERVER-ONLY — the PINATA_JWT credential MUST never reach the browser.
 * This module is imported exclusively by Route Handlers and Server Actions.
 */
import 'server-only';
import { PinataSDK } from 'pinata';
import { serverEnv } from '@/env/server';

/**
 * Singleton Pinata SDK instance.
 * Instantiated lazily (inside the function) to avoid capturing credentials
 * in cold-start module scope snapshots in some serverless runtimes.
 */
let _pinata: PinataSDK | null = null;

export function getPinata(): PinataSDK {
  if (!_pinata) {
    _pinata = new PinataSDK({
      pinataJwt: serverEnv.PINATA_JWT,
    });
  }
  return _pinata;
}
