/**
 * ⚠️  SERVER-ONLY MODULE — DATABASE OPERATIONS
 *
 * Imports `server-only` to enforce that no code within `src/lib/db` can ever
 * be bundled into the client-side JavaScript bundle.
 */
import 'server-only';

export { connectToDatabase } from './mongodb';
export { default as FileModel } from './models/File';
export type { IFile } from './models/File';
export { default as UserModel } from './models/User';
export type { IUser } from './models/User';
