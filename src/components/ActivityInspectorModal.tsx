import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  Copy,
  Check,
  Bookmark,
  Trash2,
  Play,
  Globe,
  Clock,
  Save,
} from 'lucide-react';
import { ActivityCategory, ActivityItem } from '../types';
import { deleteActivityRecord, updateActivityDetails } from '../firebase';

interface ActivityInspectorModalProps {
  item: ActivityItem | null;
  onClose: () => void;
  lang: 'si' | 'en';
  isDemoMode: boolean;
  onDemoUpdate?: (updated: ActivityItem) => void;
  onDemoDelete?: (id: string) => void;
}

export const ActivityInspectorModal: React.FC<ActivityInspectorModalProps> = ({
  item,
  onClose,
  lang,
  isDemoMode,
  onDemoUpdate,
  onDemoDelete,
}) => {
  if (!item) return null;

  const [title, setTitle] = useState(item.title);
  const [category, setCategory] = useState<ActivityCategory>(item.category);
  const [notes, setNotes] = useState(item.notes || '');
  const [isBookmarked, setIsBookmarked] = useState(item.isBookmarked);
  const [visitCount, setVisitCount] = useState(item.visitCount);
  const [durationSec, setDurationSec] = useState(item.durationSec);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(item.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      if (isDemoMode && onDemoUpdate) {
        onDemoUpdate({
          ...item,
          title: title.trim() || item.title,
          category,
          notes: notes.trim(),
          isBookmarked,
          visitCount,
          durationSec,
        });
      } else {
        await updateActivityDetails(item, {
          title,
          category,
          notes,
          isBookmarked,
          visitCount,
          durationSec,
          visitedAt: item.visitedAt,
        });
      }
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update activity');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setErrorMsg(null);
    try {
      if (isDemoMode && onDemoDelete) {
        onDemoDelete(item.id);
      } else {
        await deleteActivityRecord(item.id);
      }
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete activity');
      setDeleting(false);
    }
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      return `${hrs}h ${mins % 60}m`;
    }
    return mins > 0 ? `${mins}m ${remSec}s` : `${remSec}s`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-slate-300">
            {item.videoId ? (
              <Play className="h-4 w-4 text-sky-400" />
            ) : (
              <Globe className="h-4 w-4 text-sky-400" />
            )}
            <span>
              {lang === 'si'
                ? 'ක්‍රියාකාරකම් විස්තර සහ වීඩියෝ ප්ලේයරය'
                : 'Activity Inspector & Media Player'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-6">
          {/* Embedded YouTube Player if videoId exists */}
          {item.videoId && (
            <div className="overflow-hidden rounded-lg border border-slate-800 bg-black aspect-video w-full">
              <iframe
                src={`https://www.youtube.com/embed/${item.videoId}?rel=0`}
                title={item.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          {/* Unboxed Metadata Line */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span className="text-slate-200 font-medium">{item.domain}</span>
            <span aria-hidden="true">·</span>
            <span>{new Date(item.visitedAt).toLocaleString()}</span>
            <span aria-hidden="true">·</span>
            <span>{item.device}</span>
            <span aria-hidden="true">·</span>
            <span>
              {visitCount} {visitCount === 1 ? 'visit' : 'visits'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatDuration(durationSec)}</span>
            {item.channelName && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-sky-400">{item.channelName}</span>
              </>
            )}
          </div>

          {/* Full URL Bar with Copy & Open Actions */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5">
            <span className="truncate font-mono text-xs text-slate-300">{item.url}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? (lang === 'si' ? 'පිටපත් විය' : 'Copied') : 'Copy URL'}</span>
              </button>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
              >
                <span>{lang === 'si' ? 'වෙබ් අඩවියට යන්න' : 'Open Site'}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Edit Form */}
          <form id="inspector-form" onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {lang === 'si' ? 'මාතෘකාව (Title)' : 'Page or Video Title'}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={300}
                required
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {lang === 'si' ? 'වර්ගය (Category)' : 'Category'}
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ActivityCategory)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value="site">Website / Page</option>
                  <option value="video">Watched Video</option>
                  <option value="search">Search Query</option>
                  <option value="dev">Developer / Code</option>
                  <option value="document">Document / Drive</option>
                  <option value="social">Social Network</option>
                  <option value="shopping">Shopping</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {lang === 'si' ? 'ගිය වාර ගණන (Visits)' : 'Visit Count'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={visitCount}
                  onChange={(e) => setVisitCount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {lang === 'si' ? 'ගත කළ කාලය (තත්පර)' : 'Duration (Seconds)'}
                </label>
                <div className="relative flex items-center">
                  <Clock className="h-3.5 w-3.5 text-slate-500 absolute left-3" />
                  <input
                    type="number"
                    min={0}
                    max={864000}
                    value={durationSec}
                    onChange={(e) => setDurationSec(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {lang === 'si' ? 'පුද්ගලික සටහන් (Notes)' : 'Personal Notes'}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                placeholder={
                  lang === 'si'
                    ? 'මෙම වීඩියෝව හෝ වෙබ් අඩවිය ගැන සටහනක් එක් කරන්න...'
                    : 'Add timestamp notes, summary, or why you visited this page...'
                }
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setIsBookmarked(!isBookmarked)}
                className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isBookmarked
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Bookmark className={`h-3.5 w-3.5 ${isBookmarked ? 'fill-amber-400 text-amber-400' : ''}`} />
                <span>
                  {isBookmarked
                    ? lang === 'si'
                      ? 'Bookmark කර ඇත'
                      : 'Bookmarked'
                    : lang === 'si'
                    ? 'Bookmark කරන්න'
                    : 'Bookmark Item'}
                </span>
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3.5 py-2 text-xs text-red-300">
                {errorMsg}
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-6 py-3.5">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg border border-red-900/40 bg-red-950/30 px-3.5 py-2 text-xs font-medium text-red-300 hover:bg-red-900/40 transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{deleting ? 'Deleting...' : lang === 'si' ? 'ඉවත් කරන්න' : 'Delete Entry'}</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {lang === 'si' ? 'අවලංගු කරන්න' : 'Cancel'}
            </button>
            <button
              type="submit"
              form="inspector-form"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving...' : lang === 'si' ? 'සුරකින්න' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
