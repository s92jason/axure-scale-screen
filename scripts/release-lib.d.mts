export interface ParsedCommit {
  type: string;
  scope: string | null;
  breaking: boolean;
  description: string;
}

export type ReleaseBump = 'patch' | 'minor' | 'major';

export const MANIFEST_PATH: string;
export const CHANGELOG_PATH: string;
export const XCODE_PROJECT_PATH: string;
export const USER_FACING_TYPES: string[];

export function parseCommit(subject: string, body?: string): ParsedCommit | null;
export function inferBump(commits: ParsedCommit[], currentVersion: string): ReleaseBump;
export function compareVersions(a: string, b: string): number;
export function bumpVersion(version: string, bump: string): string;
export function renderChangelogSection(version: string, date: string, commits: ParsedCommit[]): string;
export function insertChangelogSection(changelog: string, section: string): string;
export function readVersion(rootDir: string): string;
export function lastReleaseCommit(rootDir: string): string | null;
export function committedVersion(rootDir: string): string | null;
export function commitsSince(rootDir: string, ref: string | null): Array<ParsedCommit & { hash: string; subject: string }>;
export function pendingRelease(rootDir: string): { version: string; count: number } | null;
export function changedSince(rootDir: string, ref: string, path: string): boolean;
export function hasUncommittedChanges(rootDir: string): boolean;
export function writeVersion(rootDir: string, version: string): string[];
