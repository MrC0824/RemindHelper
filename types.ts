
export type IntervalUnit = 'seconds' | 'minutes' | 'hours';

export type ThemeMode = 'light' | 'dark';

export type ReminderType = 'interval' | 'onetime';

export type WorkMode = 'everyday' | 'big-small' | 'weekend';

export interface TimeRange {
  id: string;
  start: string; // Format "HH:MM"
  end: string;   // Format "HH:MM"
}

export interface SoundProfile {
  id: string;
  name: string;
  type: 'system' | 'custom';
}

export interface CustomReminder {
  id: string;
  title: string;
  type: ReminderType;
  enabled: boolean;

  // For Interval
  intervalValue?: number;
  intervalUnit?: IntervalUnit;
  nextTriggerTime?: number; // Added for persistence
  pausedRemainingTime?: number; // Stores remaining milliseconds when disabled

  // For One-time
  targetDateTime?: number; // Timestamp
}

export interface AppSettings {
  theme: ThemeMode;
  intervalUnit: IntervalUnit;
  intervalValue: number;
  messagePrefix: string;
  messageSuffix: string;
  soundEnabled: boolean;
  
  // Active Hours / Work Mode
  activeHoursEnabled: boolean;
  activeHoursRanges: TimeRange[];
  workMode: WorkMode;
  isBigWeek: boolean; // true = Big Week (Work Sat), false = Small Week (Rest Sat)
  skipHolidays: boolean;

  audioVolume: number;
  
  // Custom Reminders
  customReminders: CustomReminder[];

  // Audio List Management
  selectedSoundId: string;
  soundList: SoundProfile[];
  
  isMiniMode: boolean;
  
  // Global Shortcut
  globalShortcut?: string;
}

export type AppStatus = 'idle' | 'running' | 'paused' | 'waiting' | 'alert_active';

// --- Update Related Types ---
export type UpdateStatus = 'available' | 'downloading' | 'downloaded' | 'error' | 'checking' | 'not-available' | null;

export interface UpdateInfo {
    version: string;
    releaseNotes?: string | Array<{ note: string }>;
    portable?: boolean; // 标识是否为便携版
}