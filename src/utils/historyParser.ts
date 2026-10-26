import { extractDomain, extractYouTubeId, inferCategory } from '../firebase';
import { DeviceType, NewActivityInput } from '../types';

/**
 * Parses Google Takeout JSON (BrowserHistory.json, watch-history.json, MyActivity.json),
 * Google Takeout HTML (MyActivity.html, Chrome Bookmarks HTML),
 * CSV history exports, or raw Chrome SQLite 'History' binary files directly in the browser.
 */
export async function parseHistoryFile(
  file: File,
  targetDevice: DeviceType = 'Android Chrome',
  targetPhoneLabel: string = 'Other Phone (Chrome Mobile)'
): Promise<NewActivityInput[]> {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.json')) {
    const text = await file.text();
    return parseJsonHistory(text, targetDevice, targetPhoneLabel);
  }

  if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
    const text = await file.text();
    return parseHtmlHistory(text, targetDevice, targetPhoneLabel);
  }

  if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
    const text = await file.text();
    return parseTextOrCsvHistory(text, targetDevice, targetPhoneLabel);
  }

  const buffer = await file.arrayBuffer();
  return parseSqliteBinaryHistory(buffer, targetDevice, targetPhoneLabel);
}

function parseJsonHistory(
  jsonText: string,
  targetDevice: DeviceType,
  targetPhoneLabel: string
): NewActivityInput[] {
  const results: NewActivityInput[] = [];
  const parsed = JSON.parse(jsonText);

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed['Browser History'])
    ? parsed['Browser History']
    : Array.isArray(parsed.history)
    ? parsed.history
    : [];

  for (const item of list.slice(0, 600)) {
    if (!item || typeof item !== 'object') continue;

    if (item.url && (item.time_usec || item.lastVisitTime)) {
      const url = String(item.url);
      const title = String(item.title || extractDomain(url));
      let visitedAt = new Date().toISOString();
      if (item.time_usec) {
        visitedAt = new Date(Math.floor(Number(item.time_usec) / 1000)).toISOString();
      } else if (item.lastVisitTime) {
        visitedAt = new Date(Number(item.lastVisitTime)).toISOString();
      }
      const ytId = extractYouTubeId(url);
      results.push({
        title,
        url,
        category: inferCategory(url, title),
        source: ytId ? 'youtube_watch' : 'chrome_history',
        visitedAt,
        visitCount: Number(item.visitCount) || 1,
        durationSec: ytId ? 420 : 140,
        device: targetDevice,
        phoneLabel: targetPhoneLabel,
        videoId: ytId,
      });
      continue;
    }

    if (item.titleUrl || item.title) {
      const rawTitle = String(item.title || 'Activity');
      const cleanedTitle = rawTitle
        .replace(/^Watched\s+/i, '')
        .replace(/^Visited\s+/i, '')
        .replace(/^Searched for\s+/i, '');
      const url = String(
        item.titleUrl ||
          `https://www.google.com/search?q=${encodeURIComponent(cleanedTitle)}`
      );
      const ytId = extractYouTubeId(url);
      const channelName =
        Array.isArray(item.subtitles) && item.subtitles[0]?.name
          ? String(item.subtitles[0].name)
          : undefined;
      const isSearch = rawTitle.toLowerCase().startsWith('searched for ');
      const visitedAt = item.time ? new Date(item.time).toISOString() : new Date().toISOString();

      results.push({
        title: cleanedTitle || extractDomain(url),
        url,
        category: isSearch ? 'search' : inferCategory(url, cleanedTitle),
        source: ytId
          ? 'youtube_watch'
          : isSearch
          ? 'google_search'
          : 'takeout_import',
        visitedAt,
        visitCount: 1,
        durationSec: ytId ? 480 : 120,
        device: targetDevice,
        phoneLabel: targetPhoneLabel,
        videoId: ytId,
        channelName,
        searchQuery: isSearch ? cleanedTitle : undefined,
      });
    }
  }

  return deduplicateActivities(results);
}

function parseHtmlHistory(
  htmlText: string,
  targetDevice: DeviceType,
  targetPhoneLabel: string
): NewActivityInput[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  const results: NewActivityInput[] = [];

  for (const a of anchors.slice(0, 500)) {
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('http')) continue;
    const text = (a.textContent || '').trim() || extractDomain(href);
    const addDate = a.getAttribute('add_date');
    const visitedAt = addDate
      ? new Date(Number(addDate) * 1000).toISOString()
      : new Date().toISOString();
    const ytId = extractYouTubeId(href);

    results.push({
      title: text.replace(/^Watched\s+/i, '').slice(0, 300),
      url: href,
      category: inferCategory(href, text),
      source: ytId ? 'youtube_watch' : 'takeout_import',
      visitedAt,
      visitCount: 1,
      durationSec: ytId ? 360 : 95,
      device: targetDevice,
      phoneLabel: targetPhoneLabel,
      videoId: ytId,
    });
  }

  return deduplicateActivities(results);
}

export function parseTextOrCsvHistory(
  text: string,
  targetDevice: DeviceType = 'Android Chrome',
  targetPhoneLabel: string = 'Other Phone (Chrome Mobile)'
): NewActivityInput[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const results: NewActivityInput[] = [];

  for (const line of lines.slice(0, 400)) {
    const urlMatch = line.match(/https?:\/\/[^\s,"'>]+/i);
    if (!urlMatch) continue;
    const url = urlMatch[0];
    const remainder = line
      .replace(url, '')
      .replace(/^[,|\s-]+|[,|\s-]+$/g, '')
      .replace(/^"|"$/g, '')
      .trim();
    const domain = extractDomain(url);
    const ytId = extractYouTubeId(url);
    let searchQuery: string | undefined;
    try {
      const parsed = new URL(url);
      const q = parsed.searchParams.get('q') || parsed.searchParams.get('search_query');
      if (q) searchQuery = q;
    } catch {
      // ignore
    }

    const title = remainder || searchQuery || (ytId ? `YouTube Video (${ytId})` : domain);
    results.push({
      title,
      url,
      category: inferCategory(url, title),
      source: ytId ? 'youtube_watch' : 'manual_log',
      visitedAt: new Date().toISOString(),
      visitCount: 1,
      durationSec: ytId ? 420 : 120,
      device: targetDevice,
      phoneLabel: targetPhoneLabel,
      videoId: ytId,
      searchQuery,
    });
  }

  return deduplicateActivities(results);
}

function parseSqliteBinaryHistory(
  buffer: ArrayBuffer,
  targetDevice: DeviceType,
  targetPhoneLabel: string
): NewActivityInput[] {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(buffer);
  const urlRegex = /https?:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]{8,400}/g;
  const matches = text.match(urlRegex) || [];
  const results: NewActivityInput[] = [];

  const now = Date.now();
  let index = 0;

  for (const rawUrl of matches) {
    if (results.length >= 300) break;
    if (
      rawUrl.includes('favicons') ||
      rawUrl.includes('.png') ||
      rawUrl.includes('.jpg') ||
      rawUrl.includes('.css') ||
      rawUrl.includes('.js') ||
      rawUrl.includes('googleapis.com/chrome')
    ) {
      continue;
    }

    const ytId = extractYouTubeId(rawUrl);
    const domain = extractDomain(rawUrl);
    let searchQuery: string | undefined;
    try {
      const u = new URL(rawUrl);
      const q = u.searchParams.get('q') || u.searchParams.get('search_query');
      if (q) searchQuery = decodeURIComponent(q);
    } catch {
      // ignore
    }

    const title = searchQuery
      ? `Search: ${searchQuery}`
      : ytId
      ? `YouTube Video — ${ytId}`
      : `${domain} — ${rawUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80)}`;

    const offsetMinutes = index * 18;
    const visitedAt = new Date(now - offsetMinutes * 60 * 1000).toISOString();
    index++;

    results.push({
      title,
      url: rawUrl,
      category: inferCategory(rawUrl, title),
      source: ytId ? 'youtube_watch' : searchQuery ? 'google_search' : 'chrome_history',
      visitedAt,
      visitCount: 1,
      durationSec: ytId ? 450 : 130,
      device: targetDevice,
      phoneLabel: targetPhoneLabel,
      videoId: ytId,
      searchQuery,
    });
  }

  return deduplicateActivities(results);
}

function deduplicateActivities(items: NewActivityInput[]): NewActivityInput[] {
  const map = new Map<string, NewActivityInput>();
  for (const item of items) {
    const key = item.url.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.visitCount = (existing.visitCount || 1) + (item.visitCount || 1);
      existing.durationSec = (existing.durationSec || 120) + (item.durationSec || 60);
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values());
}

export function getSampleActivities(): NewActivityInput[] {
  const now = Date.now();
  const minsAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();

  return [
    {
      title: 'fireship — God-Tier Developer Roadmap (Full Video)',
      url: 'https://www.youtube.com/watch?v=pEfrdAtAmqk',
      category: 'video',
      source: 'youtube_watch',
      visitedAt: minsAgo(8),
      visitCount: 3,
      durationSec: 1012,
      device: 'Android Chrome',
      phoneLabel: 'Other Phone (Android Chrome)',
      videoId: 'pEfrdAtAmqk',
      channelName: 'Fireship',
      isBookmarked: true,
      notes: 'Watched on other phone Chrome browser.',
    },
    {
      title: 'Next.js 15 & React 19 Full Course — Build & Deploy Production App',
      url: 'https://www.youtube.com/watch?v=wm5gMKuwSYk',
      category: 'video',
      source: 'youtube_watch',
      visitedAt: minsAgo(28),
      visitCount: 2,
      durationSec: 2840,
      device: 'Android Chrome',
      phoneLabel: 'Other Phone (Android Chrome)',
      videoId: 'wm5gMKuwSYk',
      channelName: 'JavaScript Mastery',
      isBookmarked: true,
      notes: 'Synced from mobile Google account.',
    },
    {
      title: 'Searched: google my activity not showing all chrome history fix',
      url: 'https://www.google.com/search?q=google+my+activity+not+showing+all+chrome+history+fix',
      category: 'search',
      source: 'google_search',
      visitedAt: minsAgo(64),
      visitCount: 2,
      durationSec: 95,
      device: 'Android Chrome',
      phoneLabel: 'Other Phone (Android Chrome)',
      searchQuery: 'google my activity not showing all chrome history fix',
    },
    {
      title: 'But what is a neural network? | Deep learning chapter 1',
      url: 'https://www.youtube.com/watch?v=aircAruvnKk',
      category: 'video',
      source: 'youtube_watch',
      visitedAt: minsAgo(115),
      visitCount: 2,
      durationSec: 1140,
      device: 'Android Chrome',
      phoneLabel: 'Other Phone (Android Chrome)',
      videoId: 'aircAruvnKk',
      channelName: '3Blue1Brown',
      isBookmarked: true,
    },
    {
      title: 'Daraz Sri Lanka — Mobile Phones & Accessories Deals',
      url: 'https://www.daraz.lk/smartphones/',
      category: 'shopping',
      source: 'chrome_history',
      visitedAt: minsAgo(180),
      visitCount: 6,
      durationSec: 890,
      device: 'Android Chrome',
      phoneLabel: 'Other Phone (Android Chrome)',
      isBookmarked: false,
    },
    {
      title: 'Helakuru Online — Sinhala Typing & News Portal',
      url: 'https://www.helakuru.lk/',
      category: 'site',
      source: 'chrome_history',
      visitedAt: minsAgo(240),
      visitCount: 12,
      durationSec: 640,
      device: 'Android Chrome',
      phoneLabel: 'Other Phone (Android Chrome)',
      isBookmarked: false,
    },
    {
      title: 'Ikman.lk — Vehicles & Electronics Classifieds Sri Lanka',
      url: 'https://ikman.lk/en/ads/sri-lanka/electronics',
      category: 'shopping',
      source: 'chrome_history',
      visitedAt: minsAgo(310),
      visitCount: 4,
      durationSec: 520,
      device: 'Android Chrome',
      phoneLabel: 'Other Phone (Android Chrome)',
      isBookmarked: false,
    },
    {
      title: 'GitHub — facebook/react: The library for web and native user interfaces',
      url: 'https://github.com/facebook/react',
      category: 'dev',
      source: 'chrome_history',
      visitedAt: minsAgo(390),
      visitCount: 8,
      durationSec: 780,
      device: 'Desktop Chrome',
      phoneLabel: 'This Device (Chrome)',
      isBookmarked: true,
    },
    {
      title: 'Blender 4.0 Guru — Complete Donut Tutorial Part 1',
      url: 'https://www.youtube.com/watch?v=B0J27sf9N1Y',
      category: 'video',
      source: 'youtube_watch',
      visitedAt: minsAgo(460),
      visitCount: 5,
      durationSec: 1620,
      device: 'Desktop Chrome',
      phoneLabel: 'This Device (Chrome)',
      videoId: 'B0J27sf9N1Y',
      channelName: 'Blender Guru',
      isBookmarked: false,
    },
    {
      title: 'CS50x 2025 — Lecture 0: Computational Thinking',
      url: 'https://www.youtube.com/watch?v=3LPJfIKxwWc',
      category: 'video',
      source: 'youtube_watch',
      visitedAt: minsAgo(720),
      visitCount: 1,
      durationSec: 3420,
      device: 'Android Chrome',
      phoneLabel: 'Other Phone (Android Chrome)',
      videoId: '3LPJfIKxwWc',
      channelName: 'CS50',
      isBookmarked: false,
    },
  ];
}
