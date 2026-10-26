export type ActivityCategory =
  | 'site'
  | 'video'
  | 'search'
  | 'document'
  | 'social'
  | 'shopping'
  | 'dev';

export type ActivitySource =
  | 'chrome_history'
  | 'youtube_watch'
  | 'google_search'
  | 'takeout_import'
  | 'manual_log'
  | 'sample_demo';

export type DeviceType =
  | 'Desktop Chrome'
  | 'Android Chrome'
  | 'iOS Chrome'
  | 'Web Sync';

export interface ActivityItem {
  id: string;
  userId: string;
  title: string;
  url: string;
  domain: string;
  category: ActivityCategory;
  source: ActivitySource;
  visitedAt: string;
  visitCount: number;
  durationSec: number;
  device: DeviceType;
  phoneLabel?: string;
  isBookmarked: boolean;
  videoId?: string;
  channelName?: string;
  searchQuery?: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NewActivityInput {
  title: string;
  url: string;
  category?: ActivityCategory;
  source?: ActivitySource;
  visitedAt?: string;
  visitCount?: number;
  durationSec?: number;
  device?: DeviceType;
  phoneLabel?: string;
  isBookmarked?: boolean;
  videoId?: string;
  channelName?: string;
  searchQuery?: string;
  notes?: string;
}

export interface PairedDevice {
  id: string;
  userId: string;
  deviceName: string;
  deviceType: DeviceType;
  userAgentSummary: string;
  syncCode: string;
  lastSyncedAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
