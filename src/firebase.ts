import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  ActivityCategory,
  ActivityItem,
  ActivitySource,
  DeviceType,
  NewActivityInput,
} from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

const ALLOWED_CATEGORIES: ActivityCategory[] = [
  'site',
  'video',
  'search',
  'document',
  'social',
  'shopping',
  'dev',
];

const ALLOWED_SOURCES: ActivitySource[] = [
  'chrome_history',
  'youtube_watch',
  'google_search',
  'takeout_import',
  'manual_log',
  'sample_demo',
];

const ALLOWED_DEVICES: DeviceType[] = [
  'Desktop Chrome',
  'Android Chrome',
  'iOS Chrome',
  'Web Sync',
];

export function detectCurrentDevice(): {
  deviceType: DeviceType;
  deviceName: string;
  userAgentSummary: string;
} {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Desktop Chrome';
  if (/android/i.test(ua)) {
    const modelMatch = ua.match(/Android\s+[0-9.]+;\s*([^;)]+)/i);
    const model = modelMatch?.[1]?.trim() || 'Android Phone';
    return {
      deviceType: 'Android Chrome',
      deviceName: `${model} (Android Chrome)`.slice(0, 100),
      userAgentSummary: ua.slice(0, 200),
    };
  }
  if (/iphone|ipad|ipod/i.test(ua)) {
    return {
      deviceType: 'iOS Chrome',
      deviceName: 'iPhone / iOS Chrome',
      userAgentSummary: ua.slice(0, 200),
    };
  }
  return {
    deviceType: 'Desktop Chrome',
    deviceName: 'Computer / Desktop Chrome',
    userAgentSummary: ua.slice(0, 200),
  };
}

export async function registerOrUpdateCurrentDevice(
  userId: string,
  customName?: string
): Promise<string> {
  const storageKey = `traceview_device_id_${userId.slice(0, 24)}`;
  let deviceId = localStorage.getItem(storageKey);
  if (!deviceId || !/^[a-zA-Z0-9_-]{4,64}$/.test(deviceId)) {
    const randomVals = new Uint32Array(8);
    crypto.getRandomValues(randomVals);
    deviceId = `dev_${Array.from(randomVals)
      .map((n) => (n % 36).toString(36))
      .join('')}`;
    localStorage.setItem(storageKey, deviceId);
  }

  const syncKey = `traceview_sync_code_${userId.slice(0, 24)}`;
  let syncCode = localStorage.getItem(syncKey);
  if (!syncCode || syncCode.length < 6) {
    const num = Math.floor(100000 + Math.random() * 900000);
    syncCode = `${String(num).slice(0, 3)}-${String(num).slice(3, 6)}`;
    localStorage.setItem(syncKey, syncCode);
  }

  const detected = detectCurrentDevice();
  const deviceName = (customName || detected.deviceName).trim().slice(0, 100);
  const path = `devices/${deviceId}`;

  try {
    await setDoc(doc(db, 'devices', deviceId), {
      userId: userId.slice(0, 128),
      deviceName,
      deviceType: detected.deviceType,
      userAgentSummary: detected.userAgentSummary,
      syncCode: syncCode.slice(0, 12),
      lastSyncedAt: new Date().toISOString().slice(0, 64),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return deviceId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function renamePairedDevice(
  deviceId: string,
  newName: string
): Promise<void> {
  const path = `devices/${deviceId}`;
  try {
    await updateDoc(doc(db, 'devices', deviceId), {
      deviceName: newName.trim().slice(0, 100) || 'My Phone (Chrome)',
      lastSyncedAt: new Date().toISOString().slice(0, 64),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deletePairedDevice(deviceId: string): Promise<void> {
  const path = `devices/${deviceId}`;
  try {
    await deleteDoc(doc(db, 'devices', deviceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function extractDomain(rawUrl: string): string {
  try {
    const normalized = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(normalized);
    return parsed.hostname.replace(/^www\./, '').slice(0, 255) || 'unknown.local';
  } catch {
    return 'local.activity';
  }
}

export function extractYouTubeId(rawUrl: string): string | undefined {
  try {
    const normalized = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(normalized);
    if (parsed.hostname.includes('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v.slice(0, 64);
      const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{6,20})/);
      if (shortsMatch) return shortsMatch[1];
    }
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.replace('/', '');
      if (id) return id.slice(0, 64);
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function inferCategory(url: string, title: string): ActivityCategory {
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();
  if (
    lowerUrl.includes('youtube.com/watch') ||
    lowerUrl.includes('youtu.be/') ||
    lowerUrl.includes('youtube.com/shorts') ||
    lowerUrl.includes('vimeo.com') ||
    lowerUrl.includes('netflix.com') ||
    lowerUrl.includes('twitch.tv') ||
    lowerUrl.includes('tiktok.com') ||
    lowerTitle.includes('watched ')
  ) {
    return 'video';
  }
  if (
    lowerUrl.includes('google.com/search') ||
    lowerUrl.includes('bing.com/search') ||
    lowerUrl.includes('duckduckgo.com/?q=') ||
    lowerTitle.startsWith('searched for ')
  ) {
    return 'search';
  }
  if (
    lowerUrl.includes('github.com') ||
    lowerUrl.includes('stackoverflow.com') ||
    lowerUrl.includes('npmjs.com') ||
    lowerUrl.includes('developer.mozilla.org') ||
    lowerUrl.includes('console.cloud.google.com') ||
    lowerUrl.includes('firebase.google.com')
  ) {
    return 'dev';
  }
  if (
    lowerUrl.includes('docs.google.com') ||
    lowerUrl.includes('drive.google.com') ||
    lowerUrl.includes('notion.so') ||
    lowerUrl.includes('.pdf')
  ) {
    return 'document';
  }
  if (
    lowerUrl.includes('facebook.com') ||
    lowerUrl.includes('instagram.com') ||
    lowerUrl.includes('x.com') ||
    lowerUrl.includes('twitter.com') ||
    lowerUrl.includes('linkedin.com') ||
    lowerUrl.includes('reddit.com') ||
    lowerUrl.includes('whatsapp.com')
  ) {
    return 'social';
  }
  if (
    lowerUrl.includes('daraz.lk') ||
    lowerUrl.includes('amazon.com') ||
    lowerUrl.includes('ebay.com') ||
    lowerUrl.includes('aliexpress.com') ||
    lowerUrl.includes('ikman.lk')
  ) {
    return 'shopping';
  }
  return 'site';
}

export function sanitizeActivityPayload(userId: string, input: NewActivityInput) {
  const rawUrl = (input.url || 'https://google.com').trim();
  const normalizedUrl = (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).slice(0, 2000);
  const domain = extractDomain(normalizedUrl);
  const rawTitle = (input.title || domain || 'Visited Page').trim().slice(0, 300);
  const category =
    input.category && ALLOWED_CATEGORIES.includes(input.category)
      ? input.category
      : inferCategory(normalizedUrl, rawTitle);
  const source =
    input.source && ALLOWED_SOURCES.includes(input.source) ? input.source : 'manual_log';
  const device =
    input.device && ALLOWED_DEVICES.includes(input.device) ? input.device : 'Android Chrome';

  const visitCount = Math.max(1, Math.min(100000, Math.round(Number(input.visitCount) || 1)));
  const durationSec = Math.max(0, Math.min(864000, Math.round(Number(input.durationSec) || 120)));
  const visitedAt = (input.visitedAt || new Date().toISOString()).slice(0, 64);

  const payload: Record<string, unknown> = {
    userId: userId.slice(0, 128),
    title: rawTitle.length > 0 ? rawTitle : 'Untitled Activity',
    url: normalizedUrl,
    domain,
    category,
    source,
    visitedAt,
    visitCount,
    durationSec,
    device,
    isBookmarked: Boolean(input.isBookmarked),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.phoneLabel && input.phoneLabel.trim()) {
    payload.phoneLabel = input.phoneLabel.trim().slice(0, 100);
  }

  const ytId = input.videoId || extractYouTubeId(normalizedUrl);
  if (ytId) {
    payload.videoId = ytId.slice(0, 64);
  }
  if (input.channelName && input.channelName.trim()) {
    payload.channelName = input.channelName.trim().slice(0, 150);
  }
  if (input.searchQuery && input.searchQuery.trim()) {
    payload.searchQuery = input.searchQuery.trim().slice(0, 300);
  }
  if (input.notes && input.notes.trim()) {
    payload.notes = input.notes.trim().slice(0, 500);
  }

  return payload;
}

function generateSafeId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  let result = 'act_';
  const randomValues = new Uint32Array(20);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 20; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

export async function createActivityRecord(
  userId: string,
  input: NewActivityInput
): Promise<string> {
  const id = generateSafeId();
  const path = `activities/${id}`;
  try {
    const payload = sanitizeActivityPayload(userId, input);
    await setDoc(doc(db, 'activities', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function batchCreateActivities(
  userId: string,
  inputs: NewActivityInput[]
): Promise<number> {
  const chunks: NewActivityInput[][] = [];
  for (let i = 0; i < inputs.length; i += 200) {
    chunks.push(inputs.slice(i, i + 200));
  }

  let totalSaved = 0;
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const item of chunk) {
      const id = generateSafeId();
      const ref = doc(collection(db, 'activities'), id);
      batch.set(ref, sanitizeActivityPayload(userId, item));
      totalSaved++;
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'activities');
    }
  }
  return totalSaved;
}

export async function toggleActivityBookmark(activity: ActivityItem): Promise<void> {
  const path = `activities/${activity.id}`;
  try {
    await updateDoc(doc(db, 'activities', activity.id), {
      isBookmarked: !activity.isBookmarked,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateActivityDetails(
  activity: ActivityItem,
  updates: {
    title: string;
    category: ActivityCategory;
    notes: string;
    isBookmarked: boolean;
    visitCount: number;
    durationSec: number;
    visitedAt: string;
  }
): Promise<void> {
  const path = `activities/${activity.id}`;
  try {
    await updateDoc(doc(db, 'activities', activity.id), {
      title: updates.title.trim().slice(0, 300) || activity.title,
      category: ALLOWED_CATEGORIES.includes(updates.category)
        ? updates.category
        : activity.category,
      notes: updates.notes.trim().slice(0, 500),
      isBookmarked: Boolean(updates.isBookmarked),
      visitCount: Math.max(1, Math.min(100000, Math.round(updates.visitCount))),
      durationSec: Math.max(0, Math.min(864000, Math.round(updates.durationSec))),
      visitedAt: updates.visitedAt.slice(0, 64),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteActivityRecord(activityId: string): Promise<void> {
  const path = `activities/${activityId}`;
  try {
    await deleteDoc(doc(db, 'activities', activityId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteMultipleActivities(activityIds: string[]): Promise<void> {
  const chunks: string[][] = [];
  for (let i = 0; i < activityIds.length; i += 200) {
    chunks.push(activityIds.slice(i, i + 200));
  }
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const id of chunk) {
      batch.delete(doc(db, 'activities', id));
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'activities');
    }
  }
}
