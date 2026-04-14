
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppSettings, AppStatus, TimeRange, SoundProfile, CustomReminder, ReminderType, UpdateStatus, UpdateInfo } from '@/types';
import { isWithinActiveHours, generateId, updateHolidays, isWorkDay } from '@/utils/timeUtils';
import { saveAudioFile, getAudioFile, deleteAudioFile } from '@/utils/audioStorage';

// Helper to safely access Electron IPC
const ipcRenderer = typeof window !== 'undefined' && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

// Helper to check if we are in a notification window
const isNotificationMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'notification';

interface TimerState {
  timeLeft: number;
  endTime: number | null;
}

interface AppContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  status: AppStatus;
  toggleTimer: () => void;
  timeLeft: number;
  totalTime: number;
  customTimersStatus: Array<{ 
      id: string; 
      title: string; 
      timeLeft: number; 
      totalTime: number; 
      enabled: boolean; 
      type: ReminderType; 
      targetDateTime?: number 
  }>;
  activeAlerts: Set<string>;
  dismissNotification: (id: string, fromIpc?: boolean) => void;
  handleAudioUpload: (file: File) => Promise<void>;
  deleteCustomAudio: (id: string) => Promise<void>;
  selectAudio: (id: string) => Promise<void>;
  previewAudio: (id: string) => void;
  stopPreviewAudio: () => void;
  previewingId: string | null; 
  isMiniMode: boolean;
  toggleMiniMode: () => void;
  showNotification: boolean;
  notificationTitle: string;
  notificationMessage: string;
  
  // Update related
  updateStatus: UpdateStatus;
  updateProgress: number;
  updateVersionInfo: UpdateInfo | null;
  updateErrorMsg: string;
  isUpdateModalOpen: boolean;
  isPortableUpdate: boolean; 
  closeUpdateModal: () => void;
  checkUpdates: (manual?: boolean) => void;
  startDownload: () => void;
  downloadPortable: () => void;
  restartApp: () => void;
  skipUpdate: (version: string) => void;
  remindLater: () => void;

  // Auto Start
  autoStartEnabled: boolean;
  toggleAutoStart: () => void;
}

const SYSTEM_SOUND_ID = 'system_default';
const DEFAULT_AUDIO_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';
const SILENT_AUDIO_URL = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

const defaultSettings: AppSettings = {
  theme: 'light', 
  intervalUnit: 'minutes',
  intervalValue: '',
  messagePrefix: '',
  messageSuffix: '',
  soundEnabled: true,
  activeHoursEnabled: false,
  activeHoursRanges: [
      { id: 'default-1', start: "09:00", end: "12:00" },
      { id: 'default-2', start: "13:00", end: "18:00" }
  ],
  workMode: 'everyday',
  isBigWeek: false, 
  skipHolidays: true,
  customReminders: [],
  audioVolume: 1,
  selectedSoundId: SYSTEM_SOUND_ID,
  soundList: [
      { id: SYSTEM_SOUND_ID, name: '默认提示音', type: 'system' }
  ],
  isMiniMode: false,
  globalShortcut: ''
};

const AppContext = createContext<AppContextType | undefined>(undefined);

// Define useApp hook
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const merged: AppSettings = { ...defaultSettings, ...parsed };
        if (!Array.isArray(merged.soundList)) merged.soundList = defaultSettings.soundList;
        else if (!merged.soundList.some(s => s.id === SYSTEM_SOUND_ID)) {
             merged.soundList = [{ id: SYSTEM_SOUND_ID, name: '默认提示音', type: 'system' }, ...merged.soundList];
        }
        if (!merged.soundList.some(s => s.id === merged.selectedSoundId)) merged.selectedSoundId = SYSTEM_SOUND_ID;
        if (!Array.isArray(merged.activeHoursRanges)) merged.activeHoursRanges = defaultSettings.activeHoursRanges;
        if (!Array.isArray(merged.customReminders)) merged.customReminders = defaultSettings.customReminders;
        else {
             // Init nextTriggerTime for interval reminders if missing to ensure they have a start point
             const now = Date.now();
             merged.customReminders = merged.customReminders.map(r => {
                 const mapped = { ...r, type: r.type || 'interval', intervalValue: r.intervalValue || 30, intervalUnit: r.intervalUnit || 'minutes' };
                 if (mapped.type === 'interval' && mapped.enabled && !mapped.nextTriggerTime) {
                     let multiplier = 60;
                     if (mapped.intervalUnit === 'hours') multiplier = 3600;
                     if (mapped.intervalUnit === 'seconds') multiplier = 1;
                     mapped.nextTriggerTime = now + (mapped.intervalValue || 30) * multiplier * 1000;
                 }
                 return mapped;
             });
        }
        if (typeof merged.isMiniMode !== 'boolean') merged.isMiniMode = defaultSettings.isMiniMode;
        if (!merged.workMode) merged.workMode = 'everyday';
        if (typeof merged.isBigWeek !== 'boolean') merged.isBigWeek = true;
        if (typeof merged.skipHolidays !== 'boolean') merged.skipHolidays = true;
        if (!merged.theme || merged.theme === 'system' as any) merged.theme = 'dark';
        if (!merged.globalShortcut) merged.globalShortcut = '';
        delete (merged as any).autoStartOnLaunch;
        return merged;
      } catch (e) { return defaultSettings; }
    }
    return defaultSettings;
  });

  const [status, setStatus] = useState<AppStatus>('idle');
  
  // Update State
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateVersionInfo, setUpdateVersionInfo] = useState<UpdateInfo | null>(null);
  const [updateErrorMsg, setUpdateErrorMsg] = useState('');
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isPortableUpdate, setIsPortableUpdate] = useState(false);
  
  // Auto Start State
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  
  // Ref to track if the current check is manual (initiated by user)
  const isManualCheckRef = useRef(false);

  // Track system resume time for reliable hibernate detection
  const lastResumeTimeRef = useRef<number>(0);
  
  // Track last tick time globally to survive re-renders/useEffect cleanups
  const lastTickRef = useRef<number>(Date.now());

  const [skippedVersions, setSkippedVersions] = useState<string[]>(() => {
      const saved = localStorage.getItem('skipped_versions');
      return saved ? JSON.parse(saved) : [];
  });

  const calculateTotalSeconds = useCallback((val?: number | '', unit?: string) => {
    const v = (val === undefined) ? settings.intervalValue : val;
    const u = unit ?? settings.intervalUnit;
    
    // 如果值为空字符串或者是NaN，返回0防止错误
    if ((v as any) === '' || isNaN(Number(v))) return 0;
    
    let multiplier = 60;
    if (u === 'hours') multiplier = 3600;
    if (u === 'seconds') multiplier = 1;
    return Number(v) * multiplier;
  }, [settings.intervalUnit, settings.intervalValue]);

  const [endTime, setEndTime] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(() => calculateTotalSeconds());
  const [totalTime, setTotalTime] = useState(() => calculateTotalSeconds());
  
  const [customTimerStates, setCustomTimerStates] = useState<Record<string, TimerState>>({});
  // Use a Ref to track custom timer states synchronously for the setInterval loop
  const customTimerStatesRef = useRef<Record<string, TimerState>>({});

  const [activeAlerts, setActiveAlerts] = useState<Set<string>>(new Set());
  const [notificationSnapshots, setNotificationSnapshots] = useState<Record<string, {title: string, message: string}>>({});

  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [currentAudioSrc, setCurrentAudioSrc] = useState<string>(DEFAULT_AUDIO_URL);

  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null); 
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewRequestIdRef = useRef(0);
  const activePreviewUrlRef = useRef<string | null>(null);
  
  const prevActiveHoursEnabled = useRef(settings.activeHoursEnabled);
  const prevRemindersRef = useRef(settings.customReminders);
  
  // Ref to access latest settings inside setInterval/timeouts
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
      // Sync Global Shortcut to Main Process
      if (ipcRenderer && !isNotificationMode) {
          ipcRenderer.send('update-global-shortcut', settings.globalShortcut || '');
      }
  }, [settings.globalShortcut]);

  // IPC Event Listeners for System Power and Updates
  useEffect(() => {
    if (!ipcRenderer || isNotificationMode) return;

    const onUpdateAvailable = (_: any, info: UpdateInfo) => {
        if (updateStatus !== 'checking' && skippedVersions.includes(info.version)) return;
        setUpdateVersionInfo(info);
        setIsPortableUpdate(!!info.portable);
        setUpdateStatus('available');
        setIsUpdateModalOpen(true);
    };

    const onUpdateNotAvailable = () => {
        if (!isManualCheckRef.current) return;
        setUpdateStatus('not-available');
        setTimeout(() => {
            setUpdateStatus(null);
        }, 3000);
    };

    const onDownloadProgress = (_: any, progress: number) => {
        setUpdateStatus('downloading');
        setUpdateProgress(progress);
        if (!isUpdateModalOpen) setIsUpdateModalOpen(true);
    };

    const onUpdateDownloaded = (_: any, info: UpdateInfo) => {
        setUpdateStatus('downloaded');
        setUpdateProgress(100);
        setIsUpdateModalOpen(true);
    };

    const onUpdateError = (_: any, message: string) => {
        if (!isManualCheckRef.current) return;
        setUpdateStatus('error');
        setUpdateErrorMsg(message);
        setIsUpdateModalOpen(true);
    };

    // System Power Events
    const onSystemResume = () => {
        // Record the time when system resumed.
        // This allows us to ignore alerts that might trigger immediately after waking up.
        console.log("System Resumed - Suppressing alerts for 10s");
        lastResumeTimeRef.current = Date.now();
    };

    ipcRenderer.on('update-available', onUpdateAvailable);
    ipcRenderer.on('update-not-available', onUpdateNotAvailable);
    ipcRenderer.on('download-progress', onDownloadProgress);
    ipcRenderer.on('update-downloaded', onUpdateDownloaded);
    ipcRenderer.on('update-error', onUpdateError);
    ipcRenderer.on('system-resume', onSystemResume);

    // Initial check for auto-start status
    ipcRenderer.invoke('get-auto-start-status')
        .then((enabled: boolean) => setAutoStartEnabled(enabled))
        .catch((err: any) => console.warn('Failed to get auto-start status:', err));

    return () => {
        ipcRenderer.removeListener('update-available', onUpdateAvailable);
        ipcRenderer.removeListener('update-not-available', onUpdateNotAvailable);
        ipcRenderer.removeListener('download-progress', onDownloadProgress);
        ipcRenderer.removeListener('update-downloaded', onUpdateDownloaded);
        ipcRenderer.removeListener('update-error', onUpdateError);
        ipcRenderer.removeListener('system-resume', onSystemResume);
    };
  }, [skippedVersions, updateStatus]);

  const closeUpdateModal = () => setIsUpdateModalOpen(false);
  const checkUpdates = (manual: boolean = false) => {
      if (!ipcRenderer) return;
      isManualCheckRef.current = manual;
      if (manual) setUpdateStatus('checking');
      ipcRenderer.send('check-for-updates', manual);
  };
  const startDownload = () => {
      setUpdateStatus('downloading');
      setUpdateProgress(0);
      if (ipcRenderer) ipcRenderer.send('start-download');
  };
  const downloadPortable = () => {
      if (ipcRenderer) ipcRenderer.send('open-url', 'https://github.com/MrC0824/RemindHelper/releases/latest');
      setIsUpdateModalOpen(false);
  };
  const restartApp = () => {
      if (ipcRenderer) ipcRenderer.send('restart_app');
  };
  const skipUpdate = (version: string) => {
      const newSkipped = [...skippedVersions, version];
      setSkippedVersions(newSkipped);
      localStorage.setItem('skipped_versions', JSON.stringify(newSkipped));
      setIsUpdateModalOpen(false);
  };
  const remindLater = () => {
      if (updateVersionInfo) {
          const newSkipped = skippedVersions.filter(v => v !== updateVersionInfo.version);
          if (newSkipped.length !== skippedVersions.length) {
              setSkippedVersions(newSkipped);
              localStorage.setItem('skipped_versions', JSON.stringify(newSkipped));
          }
      }
      setIsUpdateModalOpen(false);
      setUpdateStatus(null);
  };

  const toggleAutoStart = useCallback(() => {
      if (!ipcRenderer) return;
      const newValue = !autoStartEnabled;
      setAutoStartEnabled(newValue);
      ipcRenderer.send('toggle-auto-start', newValue);
  }, [autoStartEnabled]);

  useEffect(() => {
      if (isNotificationMode) return;
      silentAudioRef.current = new Audio(SILENT_AUDIO_URL);
      silentAudioRef.current.loop = true;
      silentAudioRef.current.volume = 0.01; 
  }, []);

  useEffect(() => {
      if (isNotificationMode) return;
      updateHolidays();
      if (ipcRenderer) {
        checkUpdates(false);
      }
  }, []);

  useEffect(() => {
      if (isNotificationMode) return;
      if (status === 'running') {
          silentAudioRef.current?.play().catch(() => {});
      } else {
          silentAudioRef.current?.pause();
      }
  }, [status]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (settings.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [settings.theme]);

  useEffect(() => {
    if (isNotificationMode) return; 
    localStorage.setItem('app_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
      if (isNotificationMode) return;
      const newTotal = calculateTotalSeconds();
      setTotalTime(newTotal);

      if (status === 'running') {
           setEndTime(Date.now() + newTotal * 1000);
           setTimeLeft(newTotal);
      } 
      else if (status === 'waiting' || status === 'paused' || status === 'idle') {
           setTimeLeft(newTotal);
           setEndTime(null);
      }
  }, [settings.intervalValue, settings.intervalUnit, calculateTotalSeconds]);

  useEffect(() => {
    if (isNotificationMode) return;
    if (status === 'waiting' && settings.activeHoursEnabled) {
        setTimeLeft(calculateTotalSeconds());
    }
  }, [settings.activeHoursRanges, status, settings.activeHoursEnabled, calculateTotalSeconds]);

  const loadAudioSource = async (id: string): Promise<string> => {
      if (id === SYSTEM_SOUND_ID) return DEFAULT_AUDIO_URL;
      try { const file = await getAudioFile(id); return file ? URL.createObjectURL(file) : DEFAULT_AUDIO_URL; } catch (e) { return DEFAULT_AUDIO_URL; }
  };

  useEffect(() => {
      if (isNotificationMode) return;
      let activeUrl: string | null = null;
      const initAudio = async () => {
          const url = await loadAudioSource(settings.selectedSoundId);
          activeUrl = url;
          setCurrentAudioSrc(url);
          if (!audioRef.current) audioRef.current = new Audio(url); else { audioRef.current.src = url; audioRef.current.load(); }
          audioRef.current.volume = settings.audioVolume;
      };
      initAudio();
      return () => { if (activeUrl && activeUrl.startsWith('blob:')) URL.revokeObjectURL(activeUrl); };
  }, [settings.selectedSoundId]);

  useEffect(() => {
    if (isNotificationMode) return;
    if (audioRef.current) audioRef.current.volume = settings.audioVolume;
    if (previewAudioRef.current) previewAudioRef.current.volume = settings.audioVolume;
  }, [settings.audioVolume]);

  const handleAudioUpload = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) return;
    if (file.size > 100 * 1024 * 1024) return;
    if (settings.soundList.some(s => s.name === file.name)) return; 
    const newId = generateId();
    const newProfile: SoundProfile = { id: newId, name: file.name, type: 'custom' };
    try { 
        await saveAudioFile(newId, file); 
        setSettings(prev => ({ ...prev, soundList: [...prev.soundList, newProfile] }));
    } catch (error) {}
  };

  const stopPreviewAudio = useCallback(() => {
      previewRequestIdRef.current++;
      if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
      setPreviewingId(null);
      if (activePreviewUrlRef.current) { if (activePreviewUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(activePreviewUrlRef.current); activePreviewUrlRef.current = null; }
  }, []);

  const deleteCustomAudio = async (id: string) => {
      if (id === SYSTEM_SOUND_ID) return;
      if (previewingId === id) stopPreviewAudio();
      try { 
          await deleteAudioFile(id); 
          setSettings(prev => { 
              const newList = prev.soundList.filter(s => s.id !== id); 
              let newSelectedId = prev.selectedSoundId; 
              if (newSelectedId === id) {
                   if (newList.length > 0) newSelectedId = newList[newList.length - 1].id;
                   else newSelectedId = SYSTEM_SOUND_ID;
              }
              return { ...prev, soundList: newList, selectedSoundId: newSelectedId }; 
          }); 
      } catch (e) {}
  };
  const selectAudio = async (id: string) => { setSettings(prev => ({ ...prev, selectedSoundId: id })); };
  
  const previewAudio = async (id: string) => {
      if (isNotificationMode) return;
      stopPreviewAudio();
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
      const currentRequestId = previewRequestIdRef.current;
      const url = await loadAudioSource(id);
      if (currentRequestId !== previewRequestIdRef.current) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
      const audio = new Audio(url);
      audio.volume = settings.audioVolume;
      audio.onended = () => { setPreviewingId(null); };
      audio.onpause = () => { if (previewAudioRef.current === audio) setPreviewingId(null); };
      previewAudioRef.current = audio;
      activePreviewUrlRef.current = url;
      setPreviewingId(id);
      try { await audio.play(); } catch (e: any) {}
  };

  const startTimers = () => {
      if (isNotificationMode) return;
      const now = Date.now();
      const mainTotal = calculateTotalSeconds();
      setEndTime(now + mainTotal * 1000);
      setTimeLeft(mainTotal);
      setStatus('running');

      if (silentAudioRef.current) silentAudioRef.current.play().catch(() => {});
      if (audioRef.current) audioRef.current.load();
  };

  const pauseTimers = () => {
      setStatus('paused');
      setEndTime(null); 
  };

  const resumeTimers = () => {
      if (isNotificationMode) return;
      const now = Date.now();
      if (timeLeft > 0) setEndTime(now + timeLeft * 1000);
      else {
        const total = calculateTotalSeconds();
        setEndTime(now + total * 1000);
        setTimeLeft(total);
      }
      setStatus('running');
      if (silentAudioRef.current) silentAudioRef.current.play().catch(() => {});
  };

  const triggerAlert = useCallback((sourceId: string): boolean => {
    if (sourceId === 'main') {
        const { intervalValue, messagePrefix, messageSuffix } = settingsRef.current;
        
        // 校验：如果两个文案都为空，不允许触发提醒
        const hasText = (messagePrefix || '').trim().length > 0 || (messageSuffix || '').trim().length > 0;
        
        const val = intervalValue;
        const hasInterval = (val as any) !== '' && !isNaN(Number(val)) && Number(val) > 0;
        
        if (!hasInterval || !hasText) {
            return false;
        }
    }

    stopPreviewAudio(); 

    let msg = '';
    let title = '';
    let type: 'main' | 'interval' | 'onetime' = 'main'; 
    
    if (sourceId === 'main') {
        type = 'main';
        let unitText = '分钟';
        if (settings.intervalUnit === 'hours') unitText = '小时';
        if (settings.intervalUnit === 'seconds') unitText = '秒';
        const durationStr = `${settings.intervalValue} ${unitText}`;
        title = '起身走走';
        msg = `${settings.messagePrefix} ${durationStr} ${settings.messageSuffix}`;
        
        setStatus('alert_active');
        setEndTime(null); 
    } else {
        const reminder = settings.customReminders.find(r => r.id === sourceId);
        if (reminder) {
            type = reminder.type; 
            if (reminder.type === 'interval') title = '周期提醒';
            else if (reminder.type === 'onetime') title = '定点提醒';
            msg = reminder.title;
        } else {
            type = 'interval'; // Fallback
            title = '定时提醒';
            msg = '自定义提醒';
        }
    }

    setNotificationSnapshots(prev => ({
        ...prev,
        [sourceId]: { title, message: msg }
    }));

    setActiveAlerts(prev => {
        const newSet = new Set(prev);
        newSet.add(sourceId);
        return newSet;
    });

    if (ipcRenderer) {
        ipcRenderer.send('trigger-notification', { 
            id: sourceId,
            title, 
            message: msg, 
            type, 
            theme: settings.theme 
        });
    } else {
        if (settings.soundEnabled && audioRef.current) {
            audioRef.current.loop = true;
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(e => console.error(`Audio playback failed: ${e}`));
        }
    }
    return true;
  }, [settings, stopPreviewAudio]);

  const dismissNotification = useCallback((id: string, fromIpc?: boolean) => {
    const skipIpc = fromIpc === true;
    const now = Date.now();
    
    const reminder = settings.customReminders.find(r => r.id === id);
    if (reminder && reminder.type === 'onetime') {
        if (reminder.targetDateTime && reminder.targetDateTime <= now + 1000) {
            setSettings(prev => ({
                ...prev,
                customReminders: prev.customReminders.filter(r => r.id !== id)
            }));
        }
    }

    setNotificationSnapshots(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
    });

    setActiveAlerts(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        
        if (newSet.size === 0) {
             if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.loop = false;
            }
        }
        return newSet;
    });

    if (!skipIpc && ipcRenderer) {
        ipcRenderer.send('dismiss-notification', { id });
    }
    
    if (id === 'main') {
        const total = calculateTotalSeconds();
        setTotalTime(total);
        
        if (settings.activeHoursEnabled) {
            const isWork = isWorkDay(settings.workMode, settings.skipHolidays, settings.isBigWeek);
            if (!isWork || !isWithinActiveHours(settings.activeHoursRanges)) {
                 setStatus('waiting');
                 setEndTime(null);
                 setTimeLeft(total); 
                 return;
            }
        }
        
        setStatus('running');
        setEndTime(now + total * 1000);
        setTimeLeft(total);
    } 
  }, [calculateTotalSeconds, settings]);


  useEffect(() => {
    if (isNotificationMode) return;
    const prevReminders = prevRemindersRef.current;
    
    // Calculate new states logic...
    const nextStates: Record<string, TimerState> = { ...customTimerStatesRef.current };
    let changed = false;
    const now = Date.now();

    // 1. Clean up removed reminders from state
    Object.keys(nextStates).forEach(id => {
        if (!settings.customReminders.find(r => r.id === id)) { 
            delete nextStates[id]; 
            changed = true; 
        }
    });

    // 2. Initialize or Update states for current reminders
    settings.customReminders.forEach(r => {
        const prevR = prevReminders.find(pr => pr.id === r.id);
        const isNew = !prevR;
        const wasDisabled = prevR && !prevR.enabled && r.enabled;
        const configChanged = prevR && (
            prevR.intervalValue !== r.intervalValue ||
            prevR.intervalUnit !== r.intervalUnit ||
            prevR.targetDateTime !== r.targetDateTime ||
            prevR.type !== r.type ||
            prevR.nextTriggerTime !== r.nextTriggerTime 
        );
        
        if (r.enabled) {
            if (isNew || wasDisabled || configChanged || !nextStates[r.id] || (r.type === 'interval' && nextStates[r.id].endTime === null && nextStates[r.id].timeLeft === 0)) {
                 if (r.type === 'onetime' && r.targetDateTime) {
                     const tLeft = Math.max(0, Math.ceil((r.targetDateTime - now) / 1000));
                     nextStates[r.id] = { timeLeft: tLeft, endTime: r.targetDateTime ?? null };
                 } else {
                     let endTime = 0;
                     let timeLeft = 0;
                     
                     if (r.nextTriggerTime) {
                         endTime = r.nextTriggerTime;
                         timeLeft = Math.max(0, Math.ceil((endTime - now) / 1000));
                     } else {
                         let multiplier = 60;
                         if (r.intervalUnit === 'hours') multiplier = 3600;
                         if (r.intervalUnit === 'seconds') multiplier = 1;
                         const total = (r.intervalValue || 0) * multiplier;
                         endTime = now + total * 1000;
                         timeLeft = total;
                     }

                     nextStates[r.id] = { timeLeft, endTime };
                 }
                 changed = true;
            }
        } else {
            if (nextStates[r.id] && nextStates[r.id].endTime !== null) {
                nextStates[r.id] = { timeLeft: 0, endTime: null };
                changed = true;
            }
        }
    });

    if (changed) {
        setCustomTimerStates(nextStates);
        customTimerStatesRef.current = nextStates;
    }
    
    prevRemindersRef.current = settings.customReminders;
  }, [settings.customReminders]);

  useEffect(() => {
    if (isNotificationMode) return;
    Array.from(activeAlerts).forEach(id => {
        if (id === 'main') return;
        const stillExists = settings.customReminders.some(r => r.id === id);
        if (!stillExists) {
             dismissNotification(id);
        }
    });
  }, [settings.customReminders, activeAlerts, dismissNotification]);

  // Main Logic Loop
  useEffect(() => {
    if (isNotificationMode) return;

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    
    if (settings.activeHoursEnabled && !prevActiveHoursEnabled.current) {
         const isWork = isWorkDay(settings.workMode, settings.skipHolidays, settings.isBigWeek);
         const isActive = isWithinActiveHours(settings.activeHoursRanges);
         if (isWork && isActive) startTimers();
         else {
             setStatus('waiting');
             setEndTime(null);
             setTimeLeft(calculateTotalSeconds());
         }
    } else if (!settings.activeHoursEnabled && prevActiveHoursEnabled.current) {
         if (status === 'waiting') setStatus('idle');
    }
    prevActiveHoursEnabled.current = settings.activeHoursEnabled;

    // Use persisted ref instead of local variable
    // This prevents sleep detection from breaking when useEffect re-runs on wake
    // but ensures we don't start with a stale timestamp from the previous mount if unintended
    // However, for sleep detection, we WANT to compare against the last actual execution time.
    
    // NOTE: We don't reset lastTickRef here. It persists its value from the last render/tick.
    // This is crucial for detecting sleep across re-renders.

    timerRef.current = window.setInterval(() => {
        const now = Date.now();
        // Calculate delta using the persisted ref
        const delta = now - lastTickRef.current;
        lastTickRef.current = now; // Update immediately

        // --- System Sleep Detection ---
        // 1. Tick Delta Check (Backup): If timer loop was paused for > 1000ms
        const tickDelaySlept = delta > 1000;
        
        // 2. PowerMonitor Resume Check (Primary): Check if we are within 10s of a system resume event
        const resumeTimeDiff = now - lastResumeTimeRef.current;
        const powerMonitorJustResumed = resumeTimeDiff < 10000; // 10s grace period

        const systemSlept = tickDelaySlept || powerMonitorJustResumed;

        // --- Safety: Stop all audio if system slept ---
        if (systemSlept) {
             if (audioRef.current) {
                 audioRef.current.pause();
                 audioRef.current.currentTime = 0;
             }
             if (silentAudioRef.current) {
                 silentAudioRef.current.pause();
             }
             stopPreviewAudio();
        }

        const alertsToTrigger: string[] = [];
        const remindersToUpdate: {id: string, nextTime: number}[] = [];
        const remindersToRemove: string[] = []; // To collect IDs of expired one-time reminders that were skipped

        // Custom Reminders Logic
        // Use synchronous Ref instead of async state update
        const prevStates = customTimerStatesRef.current;
        const nextStates = { ...prevStates };
        let stateChanged = false;

        settings.customReminders.forEach(r => {
            if (!r.enabled) return;
            const st = nextStates[r.id];
            if (!st || !st.endTime) return;
            const diff = Math.ceil((st.endTime - now) / 1000);
            
            if (diff <= 0) {
                let shouldAlert = true;
                
                // Sleep/Hibernate Check Logic:
                // If the timer expired while the system was sleeping, do NOT alert.
                // Instead, silently skip this cycle (and if it's one-time, remove it).
                
                // Fix: 增加严重过期检测 (例如 > 3秒)
                // 如果用户早上打开电脑，发现 diff 是负数且很大（比如 -30000秒），说明是昨天的任务，不应该立即响铃
                const isOverdue = diff < -3;

                if (systemSlept || isOverdue) {
                    shouldAlert = false;
                    console.log(`[Timer] Skipping alert for ${r.title} (Slept: ${systemSlept}, Overdue: ${diff}s)`);
                }
                
                if (shouldAlert) {
                    alertsToTrigger.push(r.id);
                } else {
                    // Logic: If it was a one-time reminder and we decided to SKIP alerting (due to sleep),
                    // it is effectively "expired and missed". We should remove it from the list
                    // so it doesn't just sit there forever (or reappear unexpectedly).
                    if (r.type === 'onetime') {
                        remindersToRemove.push(r.id);
                    }
                }

                if (r.type === 'interval') {
                    let multiplier = 60;
                    if (r.intervalUnit === 'hours') multiplier = 3600;
                    if (r.intervalUnit === 'seconds') multiplier = 1;
                    const totalMs = (r.intervalValue || 0) * multiplier * 1000;
                    
                    // Fix: 优化下一次时间的计算，防止周期漂移
                    // 旧逻辑：const nextTime = now + totalMs; (会导致每天的执行时间根据唤醒时间后延)
                    // 新逻辑：基于上一次的预期时间 (endTime) 累加，保持节奏（例如总是 10:40）
                    // 如果错过太多（比如电脑关机了3天），需要累加多次直到追赶到未来时间
                    let nextTime = st.endTime || now;
                    // 安全防护：如果 endTime 异常小（比如数据错误），重置为 now
                    if (nextTime < now - (totalMs * 100)) nextTime = now;

                    // 核心修改：确保下一次时间一定要在未来，防止死循环或立即重发
                    // 使用 while (nextTime <= now + 1000) 确保至少有1秒的缓冲
                    while (nextTime <= now + 1000) {
                        nextTime += totalMs;
                    }
                    
                    nextStates[r.id] = { timeLeft: Math.ceil((nextTime - now) / 1000), endTime: nextTime };
                    remindersToUpdate.push({ id: r.id, nextTime });
                } else {
                    nextStates[r.id] = { timeLeft: 0, endTime: null };
                }
                stateChanged = true;
            } else {
                if (nextStates[r.id].timeLeft !== diff) { nextStates[r.id].timeLeft = diff; stateChanged = true; }
            }
        });
        
        if (stateChanged) {
            setCustomTimerStates(nextStates);
            customTimerStatesRef.current = nextStates;
        }
        
        // Execute Side Effects
        if (alertsToTrigger.length > 0 || remindersToUpdate.length > 0 || remindersToRemove.length > 0) {
            setTimeout(() => {
                 // 1. Trigger alerts
                 alertsToTrigger.forEach(id => triggerAlert(id));

                 // 2. Batch update settings (Update next times OR Remove expired/skipped onetime reminders)
                 if (remindersToUpdate.length > 0 || remindersToRemove.length > 0) {
                     setSettings(prev => {
                         let currentReminders = [...prev.customReminders];
                         let changed = false;

                         // Handle Removals (Skipped One-time)
                         if (remindersToRemove.length > 0) {
                             const initialLen = currentReminders.length;
                             currentReminders = currentReminders.filter(r => !remindersToRemove.includes(r.id));
                             if (currentReminders.length !== initialLen) changed = true;
                         }

                         // Handle Updates (Interval Next Time)
                         if (remindersToUpdate.length > 0) {
                             currentReminders = currentReminders.map(r => {
                                 const update = remindersToUpdate.find(u => u.id === r.id);
                                 if (update) {
                                     changed = true;
                                     return { ...r, nextTriggerTime: update.nextTime };
                                 }
                                 return r;
                             });
                         }
                         
                         return changed ? { ...prev, customReminders: currentReminders } : prev;
                     });
                 }
            }, 0);
        }

        // Main Timer Logic
        let shouldTickMainTimer = status === 'running';

        if (settings.activeHoursEnabled) {
             const isWork = isWorkDay(settings.workMode, settings.skipHolidays, settings.isBigWeek);
             const isActive = isWithinActiveHours(settings.activeHoursRanges);

             if (!isWork) {
                 if (status !== 'waiting' && status !== 'alert_active') {
                     setStatus('waiting');
                     setEndTime(null);
                     setTimeLeft(calculateTotalSeconds());
                 }
                 shouldTickMainTimer = false;
             } else {
                 if (isActive) {
                     if (status !== 'running' && status !== 'alert_active') {
                         startTimers(); 
                     }
                 } else {
                     if (status !== 'waiting' && status !== 'alert_active') {
                         setStatus('waiting');
                         setEndTime(null);
                         setTimeLeft(calculateTotalSeconds());
                     }
                     shouldTickMainTimer = false;
                 }
             }
        } 

        if (shouldTickMainTimer) {
            const { intervalValue, intervalUnit, messagePrefix, messageSuffix } = settingsRef.current;
            const hasText = (messagePrefix || '').trim().length > 0 || (messageSuffix || '').trim().length > 0;
            const hasInterval = (intervalValue as any) !== '' && !isNaN(Number(intervalValue)) && Number(intervalValue) > 0;

            if (!hasInterval) {
                // 3个值都没维护（或仅间隔没维护），运行中状态，显示00:00:00
                setTimeLeft(0);
                setEndTime(null);
            } else if (!hasText) {
                // 提醒间隔有值，但两个文案都没值，运行中状态，显示具体间隔数值，但不倒计时
                let multiplier = 60;
                if (intervalUnit === 'hours') multiplier = 3600;
                if (intervalUnit === 'seconds') multiplier = 1;
                const total = Number(intervalValue) * multiplier;
                setTimeLeft(total);
                setEndTime(null); // 不设置 endTime，防止倒计时
            } else {
                // 正常配置，进行倒计时
                if (endTime) {
                    const diff = Math.ceil((endTime - now) / 1000);
                    if (diff <= 0) { 
                        // Main Timer Sleep/Wake Check
                        let shouldAlertMain = true;
                        const isHeavilyOverdueMain = diff < -10;
                        
                        if (systemSlept || isHeavilyOverdueMain) {
                            shouldAlertMain = false;
                        }
                        if (Math.abs(diff) > 5 && !shouldAlertMain) {
                            shouldAlertMain = false;
                        }

                        if (shouldAlertMain) {
                            if (activeAlerts.has('main')) {
                                // Pause
                            } else {
                                // triggerAlert 内部已经做了校验，如果还是漏网之鱼，这里不需额外判断
                                triggerAlert('main');
                            }
                            setTimeLeft(0);
                        } else {
                            // Reset main timer silently (Sleep case)
                            const total = calculateTotalSeconds();
                            const nextMainEnd = now + total * 1000;
                            setEndTime(nextMainEnd);
                            setTimeLeft(total);
                        }
                    } else {
                        setTimeLeft(diff);
                    }
                } else {
                    // 如果从无文案状态切换到有文案状态（且未暂停），需要重新开始计时
                    // 使用当前 timeLeft 作为剩余时间继续
                    const diff = timeLeft;
                    if (diff > 0) {
                        setEndTime(now + diff * 1000);
                    }
                }
            }
        }
    }, 100); 

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status, endTime, settings, triggerAlert, calculateTotalSeconds, activeAlerts]);

  const toggleTimer = () => {
    if (settings.activeHoursEnabled) return; 
    if (status === 'idle') startTimers();
    else if (status === 'paused') resumeTimers();
    else if (status === 'running' || status === 'waiting') pauseTimers();
  };

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };
  
  const toggleMiniMode = () => {
      const newMode = !settings.isMiniMode;
      updateSettings({ isMiniMode: newMode });
      if (ipcRenderer) {
          if (newMode) ipcRenderer.send('resize-window', { width: 400, height: 600 });
          else ipcRenderer.send('resize-window', { width: 1024, height: 800 });
      }
  };

  useEffect(() => {
    if (isNotificationMode || !ipcRenderer) return;

    const handleNotificationClosed = (_: any, id: string) => {
        dismissNotification(id, true);
    };

    ipcRenderer.on('notification-closed', handleNotificationClosed);
    return () => {
        ipcRenderer.removeListener('notification-closed', handleNotificationClosed);
    };
  }, [dismissNotification]);

  useEffect(() => {
      if (ipcRenderer && !isNotificationMode) {
          const handlePlayAlarm = () => {
              if (settings.soundEnabled && audioRef.current) {
                  audioRef.current.loop = true;
                  audioRef.current.currentTime = 0;
                  audioRef.current.play().catch(e => console.error(`音频播放失败: ${e}`));
              }
          };
          const handleStopAlarm = () => {
             if (audioRef.current) {
                 audioRef.current.pause();
                 audioRef.current.loop = false;
             }
          };
          ipcRenderer.on('play-alarm', handlePlayAlarm);
          ipcRenderer.on('stop-alarm', handleStopAlarm);
          return () => {
              ipcRenderer.removeAllListeners('play-alarm');
              ipcRenderer.removeAllListeners('stop-alarm');
          };
      }
  }, [settings.soundEnabled]);
  
  const customTimersStatus = settings.customReminders.map(r => {
      let multiplier = 60;
      if (r.intervalUnit === 'hours') multiplier = 3600;
      if (r.intervalUnit === 'seconds') multiplier = 1;
      return {
          id: r.id,
          title: r.title,
          type: r.type,
          targetDateTime: r.targetDateTime,
          timeLeft: customTimerStates[r.id]?.timeLeft ?? 0,
          totalTime: (r.intervalValue||0) * multiplier,
          enabled: r.enabled
      };
  });

  const activeAlertId = (Array.from(activeAlerts) as string[]).pop();
  
  const getAlertDetails = (id?: string) => {
      if (!id) return { title: '', message: '' };
      
      if (notificationSnapshots[id]) {
          return notificationSnapshots[id];
      }

      if (id === 'main') {
           let unitText = '分钟';
           if (settings.intervalUnit === 'hours') unitText = '小时';
           if (settings.intervalUnit === 'seconds') unitText = '秒';
           const durationStr = `${settings.intervalValue} ${unitText}`;
           return {
               title: '起身走走',
               message: `${settings.messagePrefix} ${durationStr} ${settings.messageSuffix}`
           };
      }
      
      const reminder = settings.customReminders.find(r => r.id === id);
      if (reminder) {
           let title = '定时提醒';
           if (reminder.type === 'interval') title = '周期提醒';
           else if (reminder.type === 'onetime') title = '定点提醒';
           return { title, message: reminder.title };
      }
      return { title: '提醒', message: '自定义提醒' };
  };

  const { title: notificationTitle, message: notificationMessage } = getAlertDetails(activeAlertId);

  return (
    <AppContext.Provider
      value={{
        settings,
        updateSettings,
        status,
        toggleTimer,
        timeLeft,
        totalTime,
        customTimersStatus,
        activeAlerts,
        showNotification: activeAlerts.size > 0, 
        dismissNotification,
        notificationMessage,
        notificationTitle,
        handleAudioUpload,
        deleteCustomAudio,
        selectAudio,
        previewAudio,
        stopPreviewAudio,
        previewingId,
        isMiniMode: settings.isMiniMode,
        toggleMiniMode,
        // Update related
        updateStatus,
        updateProgress,
        updateVersionInfo,
        updateErrorMsg,
        isUpdateModalOpen,
        isPortableUpdate, 
        closeUpdateModal,
        checkUpdates,
        startDownload,
        downloadPortable, 
        restartApp,
        skipUpdate,
        remindLater,
        // Auto Start
        autoStartEnabled,
        toggleAutoStart
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
