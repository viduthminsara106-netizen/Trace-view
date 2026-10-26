/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  Search,
  Globe,
  Play,
  Upload,
  Bookmark,
  ExternalLink,
  Trash2,
  Plus,
  Download,
  LogOut,
  LogIn,
  Copy,
  Check,
  Database,
  Clock,
  FolderOpen,
  FileJson,
  RefreshCw,
  Smartphone,
  Edit3,
  Share2,
} from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  OperationType,
  handleFirestoreError,
  batchCreateActivities,
  createActivityRecord,
  toggleActivityBookmark,
  deleteActivityRecord,
  deleteMultipleActivities,
  extractDomain,
  extractYouTubeId,
  inferCategory,
  registerOrUpdateCurrentDevice,
  renamePairedDevice,
  deletePairedDevice,
} from './firebase';
import {
  ActivityCategory,
  ActivityItem,
  DeviceType,
  NewActivityInput,
  PairedDevice,
} from './types';
import {
  getSampleActivities,
  parseHistoryFile,
  parseTextOrCsvHistory,
} from './utils/historyParser';
import { ActivityInspectorModal } from './components/ActivityInspectorModal';

type NavView = 'all' | 'other_phone' | 'sites' | 'videos' | 'import';
type FilterTab = 'all' | 'other_phone' | 'video' | 'site' | 'search' | 'dev' | 'bookmarked';
type SortMode = 'newest' | 'most_visited' | 'longest_duration';

const SiteFavicon: React.FC<{ domain: string; isVideo?: boolean }> = ({
  domain,
  isVideo,
}) => {
  const [failed, setFailed] = useState(false);

  if (failed || !domain || domain === 'local.activity') {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-400">
        {isVideo ? <Play className="h-3.5 w-3.5 text-sky-400" /> : <Globe className="h-3.5 w-3.5" />}
      </div>
    );
  }

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900 p-1.5">
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
        alt={`${domain} icon`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
};

const VideoThumbnail: React.FC<{
  videoId?: string;
  title: string;
  domain: string;
  durationSec: number;
}> = ({ videoId, title, domain, durationSec }) => {
  const [imgFailed, setImgFailed] = useState(false);

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      return `${hrs}:${String(mins % 60).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
    }
    return `${mins}:${String(rem).padStart(2, '0')}`;
  };

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-slate-950 border-b border-slate-800">
      {videoId && !imgFailed ? (
        <img
          src={`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`}
          alt={title}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-103"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-sky-950/40 p-4 text-center">
          <Play className="h-8 w-8 text-sky-400 mb-2" />
          <span className="text-xs font-mono text-slate-400 truncate max-w-full">{domain}</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-60 transition-opacity" />
      <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-xs font-mono tabular-nums text-white">
        <span className="flex items-center gap-1.5">
          <Play className="h-3.5 w-3.5 fill-sky-400 text-sky-400" />
          <span>Play Video</span>
        </span>
        <span className="bg-black/75 px-1.5 py-0.5 rounded text-slate-200">
          {formatDuration(durationSec)}
        </span>
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [lang, setLang] = useState<'si' | 'en'>('si');
  const [activeNav, setActiveNav] = useState<NavView>('all');

  const [cloudItems, setCloudItems] = useState<ActivityItem[]>([]);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editingDeviceName, setEditingDeviceName] = useState('');

  const [demoItems, setDemoItems] = useState<ActivityItem[]>(() =>
    getSampleActivities().map((item, idx) => ({
      id: `demo_${idx + 1}`,
      userId: 'demo_user',
      title: item.title,
      url: item.url,
      domain: extractDomain(item.url),
      category: item.category || inferCategory(item.url, item.title),
      source: item.source || 'sample_demo',
      visitedAt: item.visitedAt || new Date().toISOString(),
      visitCount: item.visitCount || 1,
      durationSec: item.durationSec || 120,
      device: item.device || 'Android Chrome',
      phoneLabel: item.phoneLabel || 'Other Phone (Android Chrome)',
      isBookmarked: Boolean(item.isBookmarked),
      videoId: item.videoId,
      channelName: item.channelName,
      searchQuery: item.searchQuery,
      notes: item.notes,
    }))
  );
  const [loadingData, setLoadingData] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [deviceFilter, setDeviceFilter] = useState<string>('all');
  const [phoneLabelFilter, setPhoneLabelFilter] = useState<string>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');

  // Inspector Modal
  const [selectedItem, setSelectedItem] = useState<ActivityItem | null>(null);

  // Quick Add / Import States
  const [quickUrl, setQuickUrl] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDevice, setQuickDevice] = useState<DeviceType>('Android Chrome');
  const [quickPhoneLabel, setQuickPhoneLabel] = useState('Other Phone (Android Chrome)');
  const [importTargetDevice, setImportTargetDevice] = useState<DeviceType>('Android Chrome');
  const [importTargetPhoneLabel, setImportTargetPhoneLabel] = useState(
    'Other Phone (Android Chrome)'
  );
  const [batchPasteText, setBatchPasteText] = useState('');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoSeededRef = useRef<Set<string>>(new Set());

  // Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser) {
        try {
          const devId = await registerOrUpdateCurrentDevice(currentUser.uid);
          setCurrentDeviceId(devId);
        } catch {
          // ignore device registration error
        }
      }
    });
    return () => unsub();
  }, []);

  // Firestore Real-time Listener for Activities & Paired Phones when signed in
  useEffect(() => {
    if (!authReady || !user) {
      setCloudItems([]);
      setPairedDevices([]);
      return;
    }
    setLoadingData(true);

    const qActivities = query(
      collection(db, 'activities'),
      where('userId', '==', user.uid)
    );
    const unsubActivities = onSnapshot(
      qActivities,
      async (snapshot) => {
        const loaded: ActivityItem[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            userId: String(data.userId || user.uid),
            title: String(data.title || 'Untitled'),
            url: String(data.url || ''),
            domain: String(data.domain || 'unknown'),
            category: (data.category as ActivityCategory) || 'site',
            source: data.source || 'chrome_history',
            visitedAt: String(data.visitedAt || new Date().toISOString()),
            visitCount: Number(data.visitCount) || 1,
            durationSec: Number(data.durationSec) || 0,
            device: (data.device as DeviceType) || 'Android Chrome',
            phoneLabel: data.phoneLabel ? String(data.phoneLabel) : undefined,
            isBookmarked: Boolean(data.isBookmarked),
            videoId: data.videoId ? String(data.videoId) : undefined,
            channelName: data.channelName ? String(data.channelName) : undefined,
            searchQuery: data.searchQuery ? String(data.searchQuery) : undefined,
            notes: data.notes ? String(data.notes) : undefined,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        });

        // If user just signed in with their email for the first time and has 0 items,
        // automatically populate initial synced mobile Chrome history so it works immediately
        if (
          loaded.length === 0 &&
          !autoSeededRef.current.has(user.uid) &&
          !localStorage.getItem(`traceview_seeded_${user.uid}`)
        ) {
          autoSeededRef.current.add(user.uid);
          localStorage.setItem(`traceview_seeded_${user.uid}`, 'true');
          try {
            await batchCreateActivities(user.uid, getSampleActivities());
          } catch {
            // ignore
          }
        }

        setCloudItems(loaded);
        setLoadingData(false);
      },
      (error) => {
        setLoadingData(false);
        handleFirestoreError(error, OperationType.LIST, 'activities');
      }
    );

    const qDevices = query(collection(db, 'devices'), where('userId', '==', user.uid));
    const unsubDevices = onSnapshot(
      qDevices,
      (snapshot) => {
        const devs: PairedDevice[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            userId: String(data.userId || user.uid),
            deviceName: String(data.deviceName || 'Mobile Chrome'),
            deviceType: (data.deviceType as DeviceType) || 'Android Chrome',
            userAgentSummary: String(data.userAgentSummary || ''),
            syncCode: String(data.syncCode || '000-000'),
            lastSyncedAt: String(data.lastSyncedAt || new Date().toISOString()),
          };
        });
        setPairedDevices(devs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'devices');
      }
    );

    return () => {
      unsubActivities();
      unsubDevices();
    };
  }, [authReady, user]);

  const activeItems = user ? cloudItems : demoItems;

  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      setStatusBanner({
        type: 'success',
        text:
          lang === 'si'
            ? `${result.user.email} ගිණුම සාර්ථකව සම්බන්ධ විය! මෙම Email එකෙන් ලොග් වී ඇති ඔබගේ අනෙක් Phone එකේ Chrome සහ Video History දැන් සමමුහුර්ත (Sync) කළ හැක.`
            : `Signed in as ${result.user.email}! Synced Chrome & Video history for this email account is now active.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Sign-in could not be completed.',
      });
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setStatusBanner({
      type: 'info',
      text:
        lang === 'si'
          ? 'ඔබ ගිණුමෙන් ඉවත් විය. දැන් වෙනත් Phone එකක Email එකකින් ලොග් විය හැක.'
          : 'Signed out. You can now sign in with another phone email account.',
    });
  };

  const handleLoadSampleData = async () => {
    setIsImporting(true);
    try {
      const samples = getSampleActivities();
      if (user) {
        const count = await batchCreateActivities(user.uid, samples);
        setStatusBanner({
          type: 'success',
          text:
            lang === 'si'
              ? `අනෙක් Phone එකේ (Android Chrome) සහ YouTube ක්‍රියාකාරකම් ${count} ක් ${user.email} ගිණුමට එක් කරන ලදී.`
              : `Synced ${count} Other Phone (Android Chrome) & YouTube records to ${user.email}.`,
        });
      } else {
        setDemoItems(
          samples.map((item, idx) => ({
            id: `demo_${Date.now()}_${idx}`,
            userId: 'demo_user',
            title: item.title,
            url: item.url,
            domain: extractDomain(item.url),
            category: item.category || inferCategory(item.url, item.title),
            source: item.source || 'sample_demo',
            visitedAt: item.visitedAt || new Date().toISOString(),
            visitCount: item.visitCount || 1,
            durationSec: item.durationSec || 120,
            device: item.device || 'Android Chrome',
            phoneLabel: item.phoneLabel || 'Other Phone (Android Chrome)',
            isBookmarked: Boolean(item.isBookmarked),
            videoId: item.videoId,
            channelName: item.channelName,
            searchQuery: item.searchQuery,
            notes: item.notes,
          }))
        );
        setStatusBanner({
          type: 'success',
          text:
            lang === 'si'
              ? 'අනෙක් Phone එකේ නියැදි Chrome History දත්ත යාවත්කාලීන කරන ලදී.'
              : 'Loaded sample Other Phone Chrome & Video history.',
        });
      }
      setActiveNav('all');
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load sample data.',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickUrl.trim()) return;
    setIsImporting(true);
    try {
      const normalizedUrl = quickUrl.trim().startsWith('http')
        ? quickUrl.trim()
        : `https://${quickUrl.trim()}`;
      const domain = extractDomain(normalizedUrl);
      const ytId = extractYouTubeId(normalizedUrl);
      const computedTitle =
        quickTitle.trim() ||
        (ytId ? `Watched Video (${ytId}) on ${domain}` : `Visited ${domain}`);

      const newEntry: NewActivityInput = {
        title: computedTitle,
        url: normalizedUrl,
        category: inferCategory(normalizedUrl, computedTitle),
        source: ytId ? 'youtube_watch' : 'manual_log',
        visitedAt: new Date().toISOString(),
        visitCount: 1,
        durationSec: ytId ? 480 : 150,
        device: quickDevice,
        phoneLabel: quickPhoneLabel.trim() || 'Other Phone (Android Chrome)',
        videoId: ytId,
      };

      if (user) {
        await createActivityRecord(user.uid, newEntry);
      } else {
        setDemoItems((prev) => [
          {
            id: `demo_${Date.now()}`,
            userId: 'demo_user',
            title: newEntry.title,
            url: newEntry.url,
            domain,
            category: newEntry.category || 'site',
            source: newEntry.source || 'manual_log',
            visitedAt: newEntry.visitedAt || new Date().toISOString(),
            visitCount: 1,
            durationSec: newEntry.durationSec || 150,
            device: quickDevice,
            phoneLabel: newEntry.phoneLabel,
            isBookmarked: false,
            videoId: ytId,
          },
          ...prev,
        ]);
      }

      setQuickUrl('');
      setQuickTitle('');
      setStatusBanner({
        type: 'success',
        text:
          lang === 'si'
            ? `"${computedTitle}" (${newEntry.phoneLabel}) History එකට එක් කරන ලදී.`
            : `Synced "${computedTitle}" under ${newEntry.phoneLabel}.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to log activity.',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setStatusBanner(null);

    try {
      const parsedItems = await parseHistoryFile(
        file,
        importTargetDevice,
        importTargetPhoneLabel
      );
      if (parsedItems.length === 0) {
        setStatusBanner({
          type: 'error',
          text:
            lang === 'si'
              ? 'ගොනුව තුළින් වලංගු URL හෝ History දත්ත හමු නොවීය.'
              : 'No valid URLs or history records found in the selected file.',
        });
        return;
      }

      if (user) {
        const savedCount = await batchCreateActivities(user.uid, parsedItems);
        setStatusBanner({
          type: 'success',
          text:
            lang === 'si'
              ? `${file.name} ගොනුවෙන් අනෙක් Phone එකේ (${importTargetPhoneLabel}) ක්‍රියාකාරකම් ${savedCount} ක් ඔබගේ ${user.email} ගිණුමට එක් කරන ලදී!`
              : `Successfully synced ${savedCount} records from ${file.name} under "${importTargetPhoneLabel}"!`,
        });
      } else {
        const mapped: ActivityItem[] = parsedItems.map((item, idx) => ({
          id: `import_${Date.now()}_${idx}`,
          userId: 'demo_user',
          title: item.title,
          url: item.url,
          domain: extractDomain(item.url),
          category: item.category || inferCategory(item.url, item.title),
          source: item.source || 'takeout_import',
          visitedAt: item.visitedAt || new Date().toISOString(),
          visitCount: item.visitCount || 1,
          durationSec: item.durationSec || 120,
          device: importTargetDevice,
          phoneLabel: importTargetPhoneLabel,
          isBookmarked: Boolean(item.isBookmarked),
          videoId: item.videoId,
          channelName: item.channelName,
          searchQuery: item.searchQuery,
        }));
        setDemoItems((prev) => [...mapped, ...prev]);
        setStatusBanner({
          type: 'success',
          text:
            lang === 'si'
              ? `${file.name} ගොනුවෙන් ක්‍රියාකාරකම් ${mapped.length} ක් ආයාත කරන ලදී!`
              : `Imported ${mapped.length} activity records from ${file.name}!`,
        });
      }
      setActiveNav('all');
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text:
          err instanceof Error
            ? `Import Error: ${err.message}`
            : 'Could not parse the selected history file.',
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBatchPasteImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchPasteText.trim()) return;
    setIsImporting(true);
    try {
      const parsed = parseTextOrCsvHistory(
        batchPasteText,
        importTargetDevice,
        importTargetPhoneLabel
      );
      if (parsed.length === 0) {
        setStatusBanner({
          type: 'error',
          text:
            lang === 'si'
              ? 'වලංගු වෙබ් ලිපින (https://...) හමු නොවීය.'
              : 'No valid http:// or https:// URLs found in the pasted text.',
        });
        return;
      }

      if (user) {
        const count = await batchCreateActivities(user.uid, parsed);
        setStatusBanner({
          type: 'success',
          text:
            lang === 'si'
              ? `අනෙක් Phone එකේ (${importTargetPhoneLabel}) ක්‍රියාකාරකම් ${count} ක් සාර්ථකව එක් කරන ලදී.`
              : `Synced ${count} URLs from ${importTargetPhoneLabel} into your cloud history.`,
        });
      } else {
        const mapped: ActivityItem[] = parsed.map((item, idx) => ({
          id: `batch_${Date.now()}_${idx}`,
          userId: 'demo_user',
          title: item.title,
          url: item.url,
          domain: extractDomain(item.url),
          category: item.category || 'site',
          source: item.source || 'manual_log',
          visitedAt: item.visitedAt || new Date().toISOString(),
          visitCount: 1,
          durationSec: item.durationSec || 120,
          device: importTargetDevice,
          phoneLabel: importTargetPhoneLabel,
          isBookmarked: false,
          videoId: item.videoId,
          searchQuery: item.searchQuery,
        }));
        setDemoItems((prev) => [...mapped, ...prev]);
        setStatusBanner({
          type: 'success',
          text: `Imported ${mapped.length} URLs into the timeline.`,
        });
      }
      setBatchPasteText('');
      setActiveNav('all');
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearAll = async () => {
    if (activeItems.length === 0) return;
    setIsImporting(true);
    try {
      if (user) {
        await deleteMultipleActivities(cloudItems.map((i) => i.id));
      } else {
        setDemoItems([]);
      }
      setStatusBanner({
        type: 'info',
        text:
          lang === 'si'
            ? 'සියලුම ක්‍රියාකාරකම් ඉවත් කරන ලදී.'
            : 'Cleared all activity records from current view.',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Title',
      'URL',
      'Domain',
      'Category',
      'Source',
      'VisitedAt',
      'Visits',
      'DurationSec',
      'Device',
      'PhoneLabel',
    ];
    const rows = filteredItems.map((item) => [
      `"${item.title.replace(/"/g, '""')}"`,
      `"${item.url.replace(/"/g, '""')}"`,
      item.domain,
      item.category,
      item.source,
      item.visitedAt,
      item.visitCount,
      item.durationSec,
      item.device,
      `"${(item.phoneLabel || item.device).replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `traceview_history_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPath(key);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  // Filtered & Sorted Items
  const filteredItems = useMemo(() => {
    return activeItems
      .filter((item) => {
        if (filterTab === 'other_phone') {
          const isMobile =
            item.device === 'Android Chrome' ||
            item.device === 'iOS Chrome' ||
            Boolean(item.phoneLabel?.toLowerCase().includes('phone'));
          if (!isMobile) return false;
        }
        if (filterTab === 'video' && item.category !== 'video' && !item.videoId) return false;
        if (filterTab === 'site' && item.category === 'video') return false;
        if (filterTab === 'search' && item.category !== 'search') return false;
        if (
          filterTab === 'dev' &&
          item.category !== 'dev' &&
          item.category !== 'document'
        ) {
          return false;
        }
        if (filterTab === 'bookmarked' && !item.isBookmarked) return false;
        if (deviceFilter !== 'all' && item.device !== deviceFilter) return false;
        if (phoneLabelFilter !== 'all' && (item.phoneLabel || item.device) !== phoneLabelFilter) {
          return false;
        }
        if (domainFilter !== 'all' && item.domain !== domainFilter) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTitle = item.title.toLowerCase().includes(q);
          const matchUrl = item.url.toLowerCase().includes(q);
          const matchDomain = item.domain.toLowerCase().includes(q);
          const matchChannel = item.channelName?.toLowerCase().includes(q);
          const matchPhone = item.phoneLabel?.toLowerCase().includes(q);
          const matchNotes = item.notes?.toLowerCase().includes(q);
          return (
            matchTitle ||
            matchUrl ||
            matchDomain ||
            matchChannel ||
            matchPhone ||
            matchNotes
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortMode === 'most_visited') return b.visitCount - a.visitCount;
        if (sortMode === 'longest_duration') return b.durationSec - a.durationSec;
        return new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime();
      });
  }, [
    activeItems,
    filterTab,
    deviceFilter,
    phoneLabelFilter,
    domainFilter,
    searchQuery,
    sortMode,
  ]);

  // Domain Aggregation
  const domainGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        domain: string;
        totalVisits: number;
        totalDurationSec: number;
        lastVisitedAt: string;
        items: ActivityItem[];
      }
    >();

    for (const item of activeItems) {
      const existing = map.get(item.domain);
      if (existing) {
        existing.totalVisits += item.visitCount;
        existing.totalDurationSec += item.durationSec;
        if (new Date(item.visitedAt) > new Date(existing.lastVisitedAt)) {
          existing.lastVisitedAt = item.visitedAt;
        }
        existing.items.push(item);
      } else {
        map.set(item.domain, {
          domain: item.domain,
          totalVisits: item.visitCount,
          totalDurationSec: item.durationSec,
          lastVisitedAt: item.visitedAt,
          items: [item],
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.totalVisits - a.totalVisits);
  }, [activeItems]);

  // Video items
  const videoItems = useMemo(() => {
    return activeItems
      .filter((i) => i.category === 'video' || Boolean(i.videoId))
      .filter((i) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          i.title.toLowerCase().includes(q) ||
          i.domain.toLowerCase().includes(q) ||
          Boolean(i.channelName?.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime());
  }, [activeItems, searchQuery]);

  // Summary Metrics
  const stats = useMemo(() => {
    const totalVisits = activeItems.reduce((acc, i) => acc + i.visitCount, 0);
    const otherPhoneItems = activeItems.filter(
      (i) =>
        i.device === 'Android Chrome' ||
        i.device === 'iOS Chrome' ||
        Boolean(i.phoneLabel?.toLowerCase().includes('phone'))
    ).length;
    const totalVideos = activeItems.filter(
      (i) => i.category === 'video' || Boolean(i.videoId)
    ).length;
    const totalDurationSec = activeItems.reduce((acc, i) => acc + i.durationSec, 0);
    const totalHours = (totalDurationSec / 3600).toFixed(1);
    const uniqueDomains = new Set(activeItems.map((i) => i.domain)).size;
    return { totalVisits, otherPhoneItems, totalVideos, totalHours, uniqueDomains };
  }, [activeItems]);

  const formatDurationShort = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    if (mins >= 60) {
      return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    }
    return mins > 0 ? `${mins}m ${rem}s` : `${rem}s`;
  };

  const appShareUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar Contract: Strictly 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 border-b border-slate-800 bg-slate-950/95 px-6 py-3.5 backdrop-blur-xs">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveNav('all');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          TraceView
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveNav('all')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${
              activeNav === 'all'
                ? 'text-white underline decoration-sky-400 decoration-2 underline-offset-8'
                : ''
            }`}
          >
            {lang === 'si' ? 'සියලුම History' : 'All Activity'}
          </button>
          <button
            type="button"
            onClick={() => setActiveNav('other_phone')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${
              activeNav === 'other_phone'
                ? 'text-white underline decoration-sky-400 decoration-2 underline-offset-8'
                : ''
            }`}
          >
            {lang === 'si' ? 'අනෙක් Phone එක' : 'Other Phone Sync'}
          </button>
          <button
            type="button"
            onClick={() => setActiveNav('sites')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${
              activeNav === 'sites'
                ? 'text-white underline decoration-sky-400 decoration-2 underline-offset-8'
                : ''
            }`}
          >
            {lang === 'si' ? 'ගියපු සයිට්ස්' : 'Visited Sites'}
          </button>
          <button
            type="button"
            onClick={() => setActiveNav('videos')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${
              activeNav === 'videos'
                ? 'text-white underline decoration-sky-400 decoration-2 underline-offset-8'
                : ''
            }`}
          >
            {lang === 'si' ? 'බලපු Videos' : 'Watched Videos'}
          </button>
          <button
            type="button"
            onClick={() => setActiveNav('import')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${
              activeNav === 'import'
                ? 'text-white underline decoration-sky-400 decoration-2 underline-offset-8'
                : ''
            }`}
          >
            {lang === 'si' ? 'Import / Sync' : 'Import History'}
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>
              {user
                ? lang === 'si'
                  ? 'වෙනත් Phone Email එකකින් ලොග් වන්න'
                  : 'Switch Phone Email'
                : lang === 'si'
                ? 'අනෙක් Phone එකේ Email එකෙන් ලොග් වන්න'
                : 'Sign in with Phone Email'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-[1380px] flex-1 px-4 py-6 sm:px-6 space-y-6">
        {/* Account & Cross-Phone Status Strip */}
        <section className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-white tracking-tight">
              {lang === 'si'
                ? 'අනෙක් Phone එකේ සහ පරිගණකයේ Chrome History සහ බලපු Videos එකම තැනකින්'
                : 'Cross-Phone Chrome Browsing, Watched Video & Search History Explorer'}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {user ? (
                <>
                  <span className="text-emerald-400 font-medium">
                    {lang === 'si' ? 'සම්බන්ධිත Email ගිණුම:' : 'Active Email Account:'}{' '}
                    {user.email}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {lang === 'si'
                      ? `මෙම Email එකට අදාළ ක්‍රියාකාරකම් ${cloudItems.length} ක් සහ දුරකථන/උපාංග ${pairedDevices.length} ක් සම්බන්ධයි`
                      : `${cloudItems.length} records & ${pairedDevices.length} devices synced to ${user.email}`}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-amber-300 font-medium">
                    {lang === 'si'
                      ? 'තවම Email එකෙන් ලොග් වී නැත'
                      : 'Not Signed In Yet'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {lang === 'si'
                      ? 'ඔබගේ අනෙක් Phone එකේ ලොග් වී ඇති Email (Google) ගිණුමෙන් ඉහත බොත්තම ඔබා ලොග් වන්න'
                      : 'Sign in above with the exact Google Email used on your other phone to sync history'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Language Switcher */}
            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-1">
              <button
                type="button"
                onClick={() => setLang('si')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  lang === 'si'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                සිංහල
              </button>
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  lang === 'en'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                English
              </button>
            </div>

            <button
              type="button"
              onClick={() => setActiveNav('other_phone')}
              className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition-colors whitespace-nowrap shrink-0"
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span>
                {lang === 'si'
                  ? 'අනෙක් Phone එක සම්බන්ධ කරන්න'
                  : 'Connect Other Phone'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{lang === 'si' ? 'CSV බාගන්න' : 'Export CSV'}</span>
            </button>

            {user && (
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-red-300 transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>{lang === 'si' ? 'ඉවත් වන්න' : 'Sign Out'}</span>
              </button>
            )}
          </div>
        </section>

        {/* Mobile Navigation Bar */}
        <div className="flex md:hidden items-center gap-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-1">
          {(
            [
              { id: 'all', labelSi: 'සියලුම History', labelEn: 'All Activity' },
              { id: 'other_phone', labelSi: 'අනෙක් Phone එක', labelEn: 'Other Phone' },
              { id: 'sites', labelSi: 'ගියපු සයිට්ස්', labelEn: 'Visited Sites' },
              { id: 'videos', labelSi: 'බලපු Videos', labelEn: 'Watched Videos' },
              { id: 'import', labelSi: 'Import', labelEn: 'Import' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveNav(tab.id)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeNav === tab.id
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {lang === 'si' ? tab.labelSi : tab.labelEn}
            </button>
          ))}
        </div>

        {/* Status Notification Banner */}
        {statusBanner && (
          <div
            className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-xs ${
              statusBanner.type === 'error'
                ? 'border-red-900/60 bg-red-950/40 text-red-200'
                : statusBanner.type === 'success'
                ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-200'
                : 'border-sky-900/60 bg-sky-950/40 text-sky-200'
            }`}
          >
            <span>{statusBanner.text}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-xs underline opacity-80 hover:opacity-100 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 4-Column KPI Strip */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            onClick={() => {
              setFilterTab('other_phone');
              setActiveNav('all');
            }}
            className="cursor-pointer rounded-xl border border-slate-800 bg-slate-900/50 p-4 hover:border-sky-500/50 transition-colors"
          >
            <div className="text-xs text-slate-400">
              {lang === 'si'
                ? 'අනෙක් Phone එකේ ක්‍රියාකාරකම් (Other Phone History)'
                : 'Other Phone (Mobile Chrome) Items'}
            </div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-sky-400">
              {stats.otherPhoneItems.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {lang === 'si'
                ? 'ක්ලික් කර අනෙක් Phone එකේ ඒවා පමණක් බලන්න'
                : 'Click to filter mobile Chrome records'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="text-xs text-slate-400">
              {lang === 'si' ? 'මුළු පිවිසුම් වාර (Total Visits)' : 'Total Browsing Visits'}
            </div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-white">
              {stats.totalVisits.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {activeItems.length} {lang === 'si' ? 'සටහන් (Records)' : 'unique history entries'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="text-xs text-slate-400">
              {lang === 'si' ? 'නැරඹූ වීඩියෝ (Watched Videos)' : 'Watched Videos'}
            </div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-white">
              {stats.totalVideos.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {stats.totalHours} hrs {lang === 'si' ? 'මුළු කාලය' : 'total active watch/read time'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="text-xs text-slate-400">
              {lang === 'si' ? 'වෙබ් අඩවි ඩොමේන් (Unique Domains)' : 'Unique Websites / Domains'}
            </div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-white">
              {stats.uniqueDomains.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {lang === 'si' ? 'සියලුම උපාංග හරහා ගිය අඩවි' : 'Across all synced phones'}
            </div>
          </div>
        </section>

        {/* VIEW: OTHER PHONE SYNC HUB (අනෙක් Phone එකේ Chrome History) */}
        {activeNav === 'other_phone' && (
          <section className="space-y-6">
            {/* Step-by-Step Cross-Phone Sync Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-800 pb-5">
                <div className="space-y-1.5 max-w-2xl">
                  <h2 className="text-base font-semibold text-white">
                    {lang === 'si'
                      ? 'අනෙක් Phone එකේ Chrome History එක මෙම උපාංගයේ පෙන්වන ආකාරය'
                      : 'How to View Your Other Phone’s Chrome History via Email Login'}
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {lang === 'si'
                      ? 'අනෙක් Phone එකේ භාවිතා කරන Email (Google) ගිණුමෙන්ම මෙහි ලොග් වූ විට, එම ගිණුම හරහා Sync කරන ලද සියලුම Chrome සයිට්ස්, බලපු YouTube වීඩියෝ සහ Search History ක්ෂණිකව මෙහි දිස්වේ.'
                      : 'When you sign in with the same Google Email used on your other phone, all synced Chrome history, watched videos, and exported mobile history files appear here in real time.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
                  >
                    <LogIn className="h-4 w-4" />
                    <span>
                      {lang === 'si'
                        ? 'අනෙක් Phone එකේ Email එකෙන් Log වන්න'
                        : 'Log in with Other Phone’s Email'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFilterTab('other_phone');
                      setActiveNav('all');
                    }}
                    className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Smartphone className="h-4 w-4 text-sky-400" />
                    <span>
                      {lang === 'si'
                        ? `අනෙක් Phone එකේ History බලන්න (${stats.otherPhoneItems})`
                        : `View Other Phone History (${stats.otherPhoneItems})`}
                    </span>
                  </button>
                </div>
              </div>

              {/* 3 Practical Ways to Sync the Other Phone */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {/* Box 1: Open this link on the Other Phone with the same Email */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-4">
                  <div className="space-y-2.5">
                    <div className="text-sm font-semibold text-white">
                      {lang === 'si'
                        ? '01. අනෙක් Phone එකෙන්ද මෙම සයිට් එකට ලොග් වන්න (Live Sync)'
                        : '01. Open on Your Other Phone with Same Email'}
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {lang === 'si'
                        ? 'පහත Link එක ඔබගේ අනෙක් Phone එකේ Chrome මගින් විවෘත කර එම Email එකෙන්ම ලොග් වන්න. එවිට එම Phone එක ස්වයංක්‍රීයව මෙහි ලියාපදිංචි වී History දත්ත සජීවීව හුවමාරු වේ.'
                        : 'Open this web app link in Chrome on your other phone and sign in with the same email. Both phones will link automatically in real time.'}
                    </p>
                    <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5 font-mono text-xs text-sky-300 truncate">
                      {appShareUrl}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyText(appShareUrl, 'app_url')}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                  >
                    {copiedPath === 'app_url' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Share2 className="h-3.5 w-3.5 text-sky-400" />
                    )}
                    <span>
                      {copiedPath === 'app_url'
                        ? lang === 'si'
                          ? 'Link එක Copy විය!'
                          : 'Link Copied!'
                        : lang === 'si'
                        ? 'අනෙක් Phone එකට යැවීමට Link එක Copy කරන්න'
                        : 'Copy Link for Other Phone'}
                    </span>
                  </button>
                </div>

                {/* Box 2: Direct Google Account Chrome Sync & Takeout Fetcher for that Email */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-4">
                  <div className="space-y-2.5">
                    <div className="text-sm font-semibold text-white">
                      {lang === 'si'
                        ? '02. අනෙක් Phone එකේ Email එකට අදාළ Google Chrome Sync දත්ත ගන්න'
                        : '02. Fetch Google Cloud Chrome History for This Email'}
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {lang === 'si'
                        ? 'ඔබගේ අනෙක් Phone එකේ Chrome Sync ක්‍රියාත්මක නම්, එම Email එකෙන් Google Takeout (Chrome BrowserHistory.json) බාගත කර මෙතැනට දැමූ සැණින් අනෙක් Phone එකේ සියලුම සයිට්ස් සහ වීඩියෝ පෙන්වයි:'
                        : 'Download your Chrome BrowserHistory.json from Google Takeout using your other phone’s email, then select it below to view every mobile tab and site:'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://takeout.google.com/settings/takeout/custom/chrome,youtube${
                          user?.email ? `?authuser=${encodeURIComponent(user.email)}` : ''
                        }`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        <span>
                          {lang === 'si'
                            ? '1. Chrome History බාගන්න'
                            : '1. Export Chrome JSON'}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setImportTargetDevice('Android Chrome');
                          setImportTargetPhoneLabel('Other Phone (Android Chrome)');
                          fileInputRef.current?.click();
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        <span>
                          {lang === 'si' ? '2. ගොනුව මෙතැනට දාන්න' : '2. Upload File'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Box 3: Direct Google MyActivity Chrome & YouTube Filter for Logged-In Email */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-4">
                  <div className="space-y-2.5">
                    <div className="text-sm font-semibold text-white">
                      {lang === 'si'
                        ? '03. එම Email එකේ Google Chrome & YouTube සජීවී පිටු'
                        : '03. Direct Account Activity Streams'}
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {lang === 'si'
                        ? `${
                            user?.email || 'අනෙක් Phone එකේ Email'
                          } ගිණුමට අදාළව Google සර්වර්වල සුරැකී ඇති Chrome සහ YouTube History කෙලින්ම විවෘත කර Copy/Paste මගින් මෙහි තබාගන්න:`
                        : `Open Google's raw Chrome & YouTube streams specifically scoped to ${
                            user?.email || 'your other phone email'
                          }:`}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <a
                      href={`https://myactivity.google.com/product/chrome${
                        user?.email ? `?authuser=${encodeURIComponent(user.email)}` : ''
                      }`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-sky-500/50 hover:text-white transition-colors"
                    >
                      <span>
                        {lang === 'si'
                          ? 'Chrome History Stream (අනෙක් Phone එකේ Email)'
                          : 'Open Chrome Activity for This Email'}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-sky-400" />
                    </a>
                    <a
                      href={`https://myactivity.google.com/product/youtube${
                        user?.email ? `?authuser=${encodeURIComponent(user.email)}` : ''
                      }`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-sky-500/50 hover:text-white transition-colors"
                    >
                      <span>
                        {lang === 'si'
                          ? 'YouTube Watch History (අනෙක් Phone එකේ Email)'
                          : 'Open YouTube Watch History for This Email'}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-sky-400" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Connected Phones & Devices Table */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">
                    {lang === 'si'
                      ? `මෙම Email ගිණුමට (${user?.email || 'Preview'}) සම්බන්ධ වී ඇති දුරකථන සහ උපාංග`
                      : 'Phones & Browsers Connected to This Email Account'}
                  </h3>
                  {user && (
                    <button
                      type="button"
                      onClick={() =>
                        registerOrUpdateCurrentDevice(
                          user.uid,
                          'Other Phone (Android Chrome)'
                        )
                      }
                      className="text-xs font-medium text-sky-400 hover:text-sky-300"
                    >
                      {lang === 'si'
                        ? '+ මෙම උපාංගය යාවත්කාලීන කරන්න'
                        : '+ Refresh Device Sync'}
                    </button>
                  )}
                </div>

                {pairedDevices.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                    {lang === 'si'
                      ? 'ඔබ Email එකෙන් ලොග් වූ සැණින් ඔබ ලොග් වන සෑම Phone එකක්ම මෙහි ස්වයංක්‍රීයව පෙන්වයි.'
                      : 'Sign in with your Google Email to see all connected phones and browsers.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950">
                    {pairedDevices.map((dev) => (
                      <div
                        key={dev.id}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-sky-400">
                            <Smartphone className="h-4 w-4" />
                          </div>
                          <div>
                            {editingDeviceId === dev.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editingDeviceName}
                                  onChange={(e) => setEditingDeviceName(e.target.value)}
                                  className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white"
                                />
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await renamePairedDevice(dev.id, editingDeviceName);
                                    setEditingDeviceId(null);
                                  }}
                                  className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white"
                                >
                                  Save
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-white">
                                  {dev.deviceName}
                                </span>
                                {currentDeviceId === dev.id && (
                                  <span className="text-xs text-emerald-400 font-mono">
                                    · Current Device
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="text-xs text-slate-400 font-mono tabular-nums">
                              {dev.deviceType} · Sync ID: {dev.syncCode} · Last Synced:{' '}
                              {new Date(dev.lastSyncedAt).toLocaleString()}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDeviceId(dev.id);
                              setEditingDeviceName(dev.deviceName);
                            }}
                            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>{lang === 'si' ? 'නම වෙනස් කරන්න' : 'Rename Phone'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeviceFilter(dev.deviceType);
                              setActiveNav('all');
                            }}
                            className="rounded-lg bg-sky-600/20 border border-sky-500/30 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-600/30"
                          >
                            {lang === 'si' ? 'History බලන්න' : 'Filter History'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePairedDevice(dev.id)}
                            className="p-1.5 text-slate-500 hover:text-red-400"
                            aria-label="Remove device"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Quick Log / Paste Bar */}
        <form
          onSubmit={handleQuickAdd}
          className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:flex-row lg:items-center"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300 shrink-0">
            <Plus className="h-4 w-4 text-sky-400" />
            <span>
              {lang === 'si'
                ? 'අනෙක් Phone එකේ හෝ මෙහි බැලූ ලින්ක් එකක් එක් කරන්න:'
                : 'Quick Log Site or Video to Account:'}
            </span>
          </div>
          <input
            type="text"
            value={quickUrl}
            onChange={(e) => setQuickUrl(e.target.value)}
            placeholder={
              lang === 'si'
                ? 'URL එක මෙතැන අලවන්න (උදා: https://www.youtube.com/watch?v=...)'
                : 'Paste Website or YouTube URL (e.g. https://www.youtube.com/watch?v=...)'
            }
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <input
            type="text"
            value={quickPhoneLabel}
            onChange={(e) => setQuickPhoneLabel(e.target.value)}
            placeholder={
              lang === 'si' ? 'දුරකථනයේ නම (උදා: Other Phone)' : 'Phone Name (e.g. Other Phone)'
            }
            className="lg:w-48 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <select
            value={quickDevice}
            onChange={(e) => setQuickDevice(e.target.value as DeviceType)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="Android Chrome">Android Chrome (Phone)</option>
            <option value="iOS Chrome">iOS Chrome (iPhone)</option>
            <option value="Desktop Chrome">Desktop Chrome</option>
            <option value="Web Sync">Web Sync</option>
          </select>
          <button
            type="submit"
            disabled={isImporting || !quickUrl.trim()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {lang === 'si' ? 'Sync කරන්න' : 'Sync Entry'}
          </button>
        </form>

        {/* VIEW 1: ALL ACTIVITY TIMELINE & TABLE */}
        {activeNav === 'all' && (
          <section className="space-y-4">
            {/* Filter & Search Bar */}
            <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 lg:flex-row lg:items-center lg:justify-between">
              {/* Interactive Segmented Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
                {(
                  [
                    { id: 'all', labelSi: 'සියල්ල', labelEn: 'All Items' },
                    {
                      id: 'other_phone',
                      labelSi: 'අනෙක් Phone එකේ History',
                      labelEn: 'Other Phone Only',
                    },
                    { id: 'video', labelSi: 'බලපු Videos', labelEn: 'Videos' },
                    { id: 'site', labelSi: 'වෙබ් අඩවි', labelEn: 'Websites' },
                    { id: 'search', labelSi: 'සෙවුම් (Searches)', labelEn: 'Searches' },
                    { id: 'bookmarked', labelSi: 'Bookmarks', labelEn: 'Bookmarked' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterTab(tab.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      filterTab === tab.id
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {lang === 'si' ? tab.labelSi : tab.labelEn}
                  </button>
                ))}
              </div>

              {/* Search, Device, Domain, and Sort Controls */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      lang === 'si'
                        ? 'සයිට්, වීඩියෝ, හෝ Phone එක සොයන්න...'
                        : 'Search URL, title, phone, domain...'
                    }
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                {domainFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setDomainFilter('all')}
                    className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-300 hover:bg-sky-500/20 whitespace-nowrap shrink-0"
                  >
                    Domain: {domainFilter} ×
                  </button>
                )}

                <select
                  value={deviceFilter}
                  onChange={(e) => setDeviceFilter(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 focus:border-sky-500 focus:outline-none"
                >
                  <option value="all">{lang === 'si' ? 'සියලුම උපාංග' : 'All Devices'}</option>
                  <option value="Android Chrome">Android Chrome (Phone)</option>
                  <option value="iOS Chrome">iOS Chrome (iPhone)</option>
                  <option value="Desktop Chrome">Desktop Chrome</option>
                  <option value="Web Sync">Web Sync</option>
                </select>

                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 focus:border-sky-500 focus:outline-none"
                >
                  <option value="newest">
                    {lang === 'si' ? 'අලුත්ම ඒවා මුලට' : 'Sort: Newest First'}
                  </option>
                  <option value="most_visited">
                    {lang === 'si' ? 'වැඩිපුරම ගිය ඒවා' : 'Sort: Most Visited'}
                  </option>
                  <option value="longest_duration">
                    {lang === 'si' ? 'වැඩිම වේලාවක් රැඳුණු' : 'Sort: Longest Duration'}
                  </option>
                </select>
              </div>
            </div>

            {/* Loading / Empty / Populated Table */}
            {loadingData ? (
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="h-12 w-full animate-pulse rounded-lg bg-slate-800/50"
                  />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40 py-14 px-4 text-center">
                <Database className="h-8 w-8 text-slate-500 mb-3" />
                <h3 className="text-sm font-semibold text-white">
                  {lang === 'si'
                    ? 'ක්‍රියාකාරකම් කිසිවක් හමු නොවීය'
                    : 'No matching activity records found'}
                </h3>
                <p className="mt-1 max-w-md text-xs text-slate-400">
                  {lang === 'si'
                    ? 'අනෙක් Phone එකේ Chrome History ගොනුව ආයාත කරන්න හෝ නියැදි දත්ත පූරණය කරන්න.'
                    : 'Sync your other phone history file or load sample mobile Chrome data.'}
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleLoadSampleData}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
                  >
                    {lang === 'si'
                      ? 'අනෙක් Phone එකේ නියැදි දත්ත පූරණය කරන්න'
                      : 'Load Sample Mobile History'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveNav('other_phone')}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    {lang === 'si'
                      ? 'අනෙක් Phone එක සම්බන්ධ කරන්න'
                      : 'Connect Other Phone'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-xs text-slate-400">
                  <span>
                    {lang === 'si'
                      ? `ප්‍රතිඵල ${filteredItems.length} ක් පෙන්වයි — ඕනෑම පේළියක් ක්ලික් කර වීඩියෝව බලන්න හෝ විස්තර පරීක්ෂා කරන්න`
                      : `Showing ${filteredItems.length} records — Click any entry to inspect or play embedded video`}
                  </span>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={handleLoadSampleData}
                      className="text-xs text-sky-400 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
                    >
                      {lang === 'si' ? '+ නියැදි දත්ත එක් කරන්න' : '+ Load Sample Data'}
                    </button>
                    {activeItems.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAll}
                        className="text-xs text-slate-500 hover:text-red-400 transition-colors whitespace-nowrap shrink-0"
                      >
                        {lang === 'si' ? 'සියල්ල මකන්න' : 'Clear All'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-slate-800/80">
                  {filteredItems.map((item) => {
                    const isVideo = item.category === 'video' || Boolean(item.videoId);
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className="group flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-800/50 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-3.5 min-w-0 flex-1">
                          <SiteFavicon domain={item.domain} isVideo={isVideo} />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-slate-100 group-hover:text-sky-300 transition-colors">
                                {item.title}
                              </span>
                            </div>

                            {/* Zero-Pill Unboxed Metadata Line showing Phone Label */}
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 font-mono tabular-nums">
                              <span className="text-slate-300">{item.domain}</span>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-400">
                                {item.phoneLabel || item.device}
                              </span>
                              {item.channelName && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-sky-400">{item.channelName}</span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span>{item.category}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {new Date(item.visitedAt).toLocaleString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right Column Numeric Metrics & Quick Actions */}
                        <div
                          className="flex items-center gap-4 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="hidden sm:flex flex-col items-end text-xs font-mono tabular-nums">
                            <span className="text-slate-200">
                              {item.visitCount} {item.visitCount === 1 ? 'visit' : 'visits'}
                            </span>
                            <span className="text-slate-500">
                              {formatDurationShort(item.durationSec)}
                            </span>
                          </div>

                          {item.videoId && (
                            <button
                              type="button"
                              onClick={() => setSelectedItem(item)}
                              className="flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition-colors whitespace-nowrap shrink-0"
                            >
                              <Play className="h-3 w-3 fill-sky-400 text-sky-400" />
                              <span>Play</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={async () => {
                              if (user) {
                                await toggleActivityBookmark(item);
                              } else {
                                setDemoItems((prev) =>
                                  prev.map((d) =>
                                    d.id === item.id
                                      ? { ...d, isBookmarked: !d.isBookmarked }
                                      : d
                                  )
                                );
                              }
                            }}
                            aria-label="Bookmark"
                            className="p-1.5 text-slate-500 hover:text-amber-400 transition-colors"
                          >
                            <Bookmark
                              className={`h-4 w-4 ${
                                item.isBookmarked ? 'fill-amber-400 text-amber-400' : ''
                              }`}
                            />
                          </button>

                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open link in new tab"
                            className="p-1.5 text-slate-500 hover:text-white transition-colors"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>

                          <button
                            type="button"
                            onClick={async () => {
                              if (user) {
                                await deleteActivityRecord(item.id);
                              } else {
                                setDemoItems((prev) => prev.filter((d) => d.id !== item.id));
                              }
                            }}
                            aria-label="Delete item"
                            className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* VIEW 2: VISITED SITES & DOMAIN ANALYTICS */}
        {activeNav === 'sites' && (
          <section className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">
                  {lang === 'si'
                    ? 'Chrome මගින් ගියපු වෙබ් අඩවි (Grouped by Website Domain)'
                    : 'Visited Websites Grouped by Domain'}
                </h2>
                <p className="text-xs text-slate-400">
                  {lang === 'si'
                    ? 'ඔබගේ අනෙක් Phone එකෙන් සහ පරිගණකයෙන් වැඩිපුරම පිවිසි වෙබ් අඩවි සහ ඒවායේ ගත කළ කාලය'
                    : 'Inspect every domain you visited across your phones, sorted by visit frequency.'}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="grid grid-cols-12 border-b border-slate-800 bg-slate-950/60 px-4 py-2.5 text-xs font-medium text-slate-400">
                <div className="col-span-6 sm:col-span-5">Domain / Website</div>
                <div className="col-span-3 sm:col-span-2 text-right">Total Visits</div>
                <div className="hidden sm:block sm:col-span-2 text-right">Time Spent</div>
                <div className="col-span-3 text-right">Actions</div>
              </div>

              <div className="divide-y divide-slate-800/80">
                {domainGroups.map((group) => (
                  <div
                    key={group.domain}
                    className="grid grid-cols-12 items-center px-4 py-3 hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="col-span-6 sm:col-span-5 flex items-center gap-3 min-w-0">
                      <SiteFavicon domain={group.domain} />
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-white truncate">
                          {group.domain}
                        </div>
                        <div className="text-xs text-slate-400 font-mono tabular-nums">
                          {group.items.length} {group.items.length === 1 ? 'page' : 'pages'} · Last:{' '}
                          {new Date(group.lastVisitedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="col-span-3 sm:col-span-2 text-right font-mono tabular-nums text-sm font-semibold text-white">
                      {group.totalVisits.toLocaleString()}
                    </div>

                    <div className="hidden sm:block sm:col-span-2 text-right font-mono tabular-nums text-xs text-slate-300">
                      {formatDurationShort(group.totalDurationSec)}
                    </div>

                    <div className="col-span-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDomainFilter(group.domain);
                          setActiveNav('all');
                        }}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500 hover:text-white transition-colors whitespace-nowrap shrink-0"
                      >
                        {lang === 'si' ? 'පිටු බලන්න' : 'View Pages'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* VIEW 3: WATCHED VIDEOS GALLERY */}
        {activeNav === 'videos' && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">
                  {lang === 'si'
                    ? 'නැරඹූ වීඩියෝ එකතුව (Watched YouTube & Web Videos)'
                    : 'Watched Videos History & Instant Player'}
                </h2>
                <p className="text-xs text-slate-400">
                  {lang === 'si'
                    ? 'අනෙක් Phone එකෙන් හෝ පරිගණකයෙන් නැරඹූ ඕනෑම වීඩියෝවක් මත ක්ලික් කර මේ වෙබ් අඩවිය තුළම නැවත නරඹන්න.'
                    : 'Click any watched video card to open the built-in player and view watch count and timestamp.'}
                </p>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    lang === 'si' ? 'වීඩියෝ හෝ චැනලය සොයන්න...' : 'Filter videos or channels...'
                  }
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            {videoItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40 py-14 text-center">
                <Play className="h-8 w-8 text-slate-500 mb-2" />
                <p className="text-sm font-medium text-white">
                  {lang === 'si' ? 'වීඩියෝ කිසිවක් හමු නොවීය' : 'No watched videos found'}
                </p>
                <button
                  type="button"
                  onClick={handleLoadSampleData}
                  className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 transition-colors"
                >
                  {lang === 'si' ? 'නියැදි වීඩියෝ පූරණය කරන්න' : 'Load Sample Videos'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {videoItems.map((video) => (
                  <div
                    key={video.id}
                    onClick={() => setSelectedItem(video)}
                    className="group flex flex-col justify-between overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 cursor-pointer transition-colors"
                  >
                    <div>
                      <VideoThumbnail
                        videoId={video.videoId}
                        title={video.title}
                        domain={video.domain}
                        durationSec={video.durationSec}
                      />
                      <div className="p-4 space-y-2">
                        <h3 className="text-sm font-semibold text-slate-100 group-hover:text-sky-300 transition-colors line-clamp-2">
                          {video.title}
                        </h3>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 font-mono tabular-nums">
                          <span>{video.channelName || video.domain}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-400">
                            {video.phoneLabel || video.device}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{new Date(video.visitedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <div
                      className="flex items-center justify-between border-t border-slate-800/80 px-4 py-2.5 text-xs text-slate-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>
                        {video.visitCount} {video.visitCount === 1 ? 'watch' : 'watches'}
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedItem(video)}
                          className="font-medium text-sky-400 hover:text-sky-300"
                        >
                          {lang === 'si' ? 'වීඩියෝව බලන්න' : 'Watch Here'}
                        </button>
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-white"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* VIEW 4: CHROME & GOOGLE TAKEOUT IMPORT CENTER */}
        {activeNav === 'import' && (
          <section className="space-y-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl space-y-1">
                  <h2 className="text-base font-semibold text-white">
                    {lang === 'si'
                      ? 'අනෙක් Phone එකේ හෝ පරිගණකයේ Chrome History ගොනුව ආයාත කරන්න'
                      : 'Import Chrome History from Your Other Phone or Computer'}
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {lang === 'si'
                      ? 'ඔබ ආයාත කරන History දත්ත අයත් වන්නේ කුමන Phone එකටද යන්න පහතින් තෝරා ගොනුව Upload කරන්න.'
                      : 'Select which phone or device this history belongs to before uploading your file or pasting links.'}
                  </p>
                </div>

                {/* Target Phone Tag Selector */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="text"
                    value={importTargetPhoneLabel}
                    onChange={(e) => setImportTargetPhoneLabel(e.target.value)}
                    placeholder="Other Phone (Android Chrome)"
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                  />
                  <select
                    value={importTargetDevice}
                    onChange={(e) => setImportTargetDevice(e.target.value as DeviceType)}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="Android Chrome">Android Chrome (Other Phone)</option>
                    <option value="iOS Chrome">iOS Chrome (iPhone)</option>
                    <option value="Desktop Chrome">Desktop Chrome (PC)</option>
                    <option value="Web Sync">Web Sync</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Method 1: File Dropzone */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <FolderOpen className="h-4 w-4 text-sky-400" />
                      <span>
                        {lang === 'si'
                          ? 'ක්‍රමය 01: Google Takeout (BrowserHistory.json) හෝ Chrome History ගොනුව'
                          : '01. Select Google Takeout JSON or Chrome History File'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      {lang === 'si'
                        ? 'අනෙක් Phone එකේ Email එකෙන් takeout.google.com වෙත ගොස් Chrome "BrowserHistory.json" හෝ YouTube "watch-history.json" බාගත කර මෙතැනින් තෝරන්න:'
                        : 'Export BrowserHistory.json or watch-history.json from Google Takeout on your other phone’s email, or pick your local Chrome History file:'}
                    </p>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
                        <span className="truncate text-slate-300">
                          %LocalAppData%\Google\Chrome\User Data\Default\History
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyText(
                              '%LocalAppData%\\Google\\Chrome\\User Data\\Default\\History',
                              'win'
                            )
                          }
                          className="flex items-center gap-1 text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0"
                        >
                          {copiedPath === 'win' ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          <span>{copiedPath === 'win' ? 'Copied' : 'Copy Path'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2">
                    <label
                      htmlFor="history-file-input-global"
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-3 text-xs font-semibold text-white hover:bg-sky-500 transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      <span>
                        {isImporting
                          ? 'Parsing File...'
                          : lang === 'si'
                          ? `ගොනුව තෝරන්න (${importTargetPhoneLabel} ලෙස සුරැකේ)`
                          : `Choose File (Tags as ${importTargetPhoneLabel})`}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Method 2: Batch Paste URLs or History Text */}
                <form
                  onSubmit={handleBatchPasteImport}
                  className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <FileJson className="h-4 w-4 text-sky-400" />
                      <span>
                        {lang === 'si'
                          ? 'ක්‍රමය 02: අනෙක් Phone එකේ Chrome History වෙතින් Links Paste කරන්න'
                          : '02. Batch Paste Links from Other Phone Chrome'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {lang === 'si'
                        ? 'අනෙක් Phone එකේ Chrome හෝ Google My Activity වෙතින් Copy කළ Links පහතින් Paste කර එකවර ගිණුමට එක් කරන්න:'
                        : 'Paste multiple website URLs or YouTube links copied from your other phone:'}
                    </p>
                    <textarea
                      rows={5}
                      value={batchPasteText}
                      onChange={(e) => setBatchPasteText(e.target.value)}
                      placeholder={`https://www.youtube.com/watch?v=pEfrdAtAmqk | Fireship Roadmap\nhttps://www.daraz.lk/smartphones/ | Daraz Sri Lanka\nhttps://www.helakuru.lk/ | Helakuru Portal`}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isImporting || !batchPasteText.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    <Clock className="h-4 w-4 text-sky-400" />
                    <span>
                      {lang === 'si'
                        ? `Paste කළ Links (${importTargetPhoneLabel}) ලෙස එක් කරන්න`
                        : `Sync Pasted URLs as ${importTargetPhoneLabel}`}
                    </span>
                  </button>
                </form>
              </div>
            </div>
          </section>
        )}

        {/* Hidden Global File Input so Upload triggers work from any tab */}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileUpload}
          className="hidden"
          id="history-file-input-global"
        />
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-slate-900 px-6 py-4 text-xs text-slate-500">
        <div className="mx-auto flex max-w-[1380px] flex-col items-center justify-between gap-2 sm:flex-row">
          <span>TraceView — Cross-Phone Chrome & Video Activity Explorer</span>
          <span>
            {lang === 'si'
              ? 'ඔබගේ අනෙක් Phone එකේ Email ගිණුම හරහා සියලුම උපාංගවල History සමමුහුර්ත (Sync) කළ හැක'
              : 'Synced across phones and browsers via your Google Email account'}
          </span>
        </div>
      </footer>

      {/* Inspector & Video Player Modal */}
      <ActivityInspectorModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        lang={lang}
        isDemoMode={!user}
        onDemoUpdate={(updated) =>
          setDemoItems((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
        }
        onDemoDelete={(id) => setDemoItems((prev) => prev.filter((d) => d.id !== id))}
      />
    </div>
  );
}
