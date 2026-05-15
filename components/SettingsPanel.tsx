import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { generateId, formatDateTime, formatTime, getAbsoluteWeekNumber } from '@/utils/timeUtils';
import { CustomReminder, IntervalUnit, ReminderType, AppSettings, WorkMode } from '@/types';

// Helper to access IPC
const ipcRenderer = typeof window !== 'undefined' && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

// Helper to get current local time in ISO format for input min attribute
const getCurrentLocalISO = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// --- 通用组件：自定义数字输入框 (带可置灰的上下箭头) ---
const CustomNumberInput = ({
    value,
    onChange,
    min = -Infinity,
    max = Infinity,
    step = 1,
    className,
    placeholder,
    onKeyDown
}: {
    value: number | '';
    onChange: (val: number | '') => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    placeholder?: string;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) => {

    const numericValue = value === '' ? NaN : parseInt(String(value), 10);
    const isMin = value === '' || (!isNaN(numericValue) && numericValue <= min);
    const isMax = !isNaN(numericValue) && numericValue >= max;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;

        // 1. 处理空值
        if (val === '') {
            onChange('');
            return;
        }

        // 2. 正则校验：只允许纯数字
        if (/^\d+$/.test(val)) {
            const num = parseInt(val, 10);

            if (!isNaN(num)) {
                // 如果输入值为 0，直接置空
                if (num === 0) {
                    onChange('');
                    return;
                }

                // 禁止输入超过 5 位数 (或者超过 max)
                if (num > 99999) { 
                    return; 
                }

                // 正常更新
                onChange(num);
            }
        }
    };

    // 物理拦截按键
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (onKeyDown) {
            onKeyDown(e);
        }

        if (['.', 'e', '+', '-'].includes(e.key)) {
            e.preventDefault();
        }
    };

    const adjustValue = (delta: number) => {
        if (value === '') {
            if (delta > 0) {
                const startValue = min > -Infinity ? min : 1;
                onChange(startValue);
            }
            return;
        }

        let current = parseInt(String(value), 10);
        if (isNaN(current)) current = 0;
        
        let next = current + Math.round(delta);
        
        if (next < min) next = min;
        if (next > max) next = max;
        
        if (next === 0) {
             onChange('');
             return;
        }

        if (next > 99999) {
            next = 99999;
        }

        onChange(next);
    };

    return (
        <div className={`relative group flex items-center bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded focus-within:border-blue-500 overflow-hidden ${className}`}>
            <input
                type="number"
                value={value}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown} 
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                placeholder={placeholder}
                step={1} 
                className="w-full h-full bg-transparent border-none focus:ring-0 px-3 text-sm focus:outline-none placeholder-slate-400 no-spinners text-slate-800 dark:text-white"
                style={{ paddingRight: '1.8rem' }}
            />
            
            <div className="absolute right-0 top-0 bottom-0 w-5 flex flex-col border-l border-gray-200 dark:border-slate-700">
                <button
                    onClick={(e) => { e.preventDefault(); adjustValue(step); }}
                    disabled={isMax}
                    className={`flex-1 flex items-center justify-center text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors rounded-tr-sm ${isMax ? 'opacity-30 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent' : ''}`}
                    tabIndex={-1}
                >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                </button>
                <div className="h-[1px] bg-gray-200 dark:bg-slate-700"></div>
                <button
                    onClick={(e) => { e.preventDefault(); adjustValue(-step); }}
                    disabled={isMin}
                    className={`flex-1 flex items-center justify-center text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors rounded-br-sm ${isMin ? 'opacity-30 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent' : ''}`}
                    tabIndex={-1}
                >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
            </div>
        </div>
    );
};

// --- 通用组件：自定义下拉选择器 (替代原生 <select>) ---
interface Option { label: string; value: string | number }

const CustomSelect = ({ 
    value, 
    onChange, 
    options, 
    className, 
    align = 'center'
}: { 
    value: string | number; 
    onChange: (val: any) => void; 
    options: Option[]; 
    className?: string;
    align?: 'left' | 'center'; 
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && listRef.current) {
            const el = listRef.current.querySelector(`[data-value="${value}"]`) as HTMLElement;
            if (el) {
                requestAnimationFrame(() => {
                    el.scrollIntoView({ block: 'center' });
                });
            }
        }
    }, [isOpen, value]);

    const currentLabel = options.find(o => o.value === value)?.label || value;

    return (
        <div ref={containerRef} className={`relative ${className || ''}`}>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full h-[38px] flex items-center cursor-pointer select-none bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-1.5 sm:px-3 hover:border-blue-400 transition-colors ${align === 'left' ? 'justify-start' : 'justify-center'}`}
            >
                <span className={`font-medium text-sm truncate ${isOpen ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-white'}`}>
                    {currentLabel}
                </span>
            </div>

            {isOpen && (
                <div className="absolute top-[calc(100%+4px)] left-0 w-full min-w-fit bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-xl rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                    <div ref={listRef} className="max-h-48 overflow-y-auto no-scrollbar overscroll-contain py-1">
                        {options.map(opt => (
                            <div 
                                key={opt.value}
                                data-value={opt.value}
                                onClick={() => { onChange(opt.value); setIsOpen(false); }}
                                className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors whitespace-nowrap ${align === 'left' ? 'text-left' : 'text-center'} ${opt.value === value ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}
                            >
                                {opt.label}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- 组件：自定义时间选择器 (HH:mm) ---
const CustomTimePicker = ({ value, onChange, className }: { value: string; onChange: (val: string) => void; className?: string }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const hourRef = useRef<HTMLDivElement>(null);
    const minuteRef = useRef<HTMLDivElement>(null);

    const [currentHour, currentMinute] = (value || '00:00').split(':');
    const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
    const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            const scrollToElement = (container: HTMLDivElement | null, targetValue: string) => {
                if (container) {
                    const el = container.querySelector(`[data-value="${targetValue}"]`) as HTMLElement;
                    if (el) el.scrollIntoView({ block: 'center' });
                }
            };
            requestAnimationFrame(() => {
                scrollToElement(hourRef.current, currentHour);
                scrollToElement(minuteRef.current, currentMinute);
            });
        }
    }, [isOpen]);

    const handleSelect = (type: 'hour' | 'minute', val: string) => {
        if (type === 'hour') onChange(`${val}:${currentMinute}`);
        else onChange(`${currentHour}:${val}`);
    };

    return (
        <div ref={containerRef} className={`relative ${className || ''}`}>
            <div onClick={() => setIsOpen(!isOpen)} className="w-full h-[38px] flex items-center justify-center cursor-pointer select-none group">
                <span className={`font-mono text-sm font-medium tracking-wide ${isOpen ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-white'}`}>{value || '--:--'}</span>
            </div>
            {isOpen && (
                <div className="absolute top-[calc(100%+4px)] left-0 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-xl rounded-lg z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
                   <div className="flex items-center border-b border-gray-100 dark:border-slate-700/50 bg-gray-50/50 dark:bg-slate-900/50 text-[10px] text-slate-400 py-1">
                       <div className="flex-1 text-center">时</div>
                       <div className="w-[1px]"></div>
                       <div className="flex-1 text-center">分</div>
                   </div>
                   <div className="flex h-40">
                       <div ref={hourRef} className="flex-1 overflow-y-auto no-scrollbar overscroll-contain relative">
                           {hours.map(h => (
                               <div key={h} data-value={h} onClick={() => handleSelect('hour', h)} className={`text-center py-1.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors ${h === currentHour ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>{h}</div>
                           ))}
                       </div>
                       <div className="w-[1px] bg-gray-100 dark:bg-slate-700/50 h-full"></div>
                       <div ref={minuteRef} className="flex-1 overflow-y-auto no-scrollbar overscroll-contain relative">
                           {minutes.map(m => (
                               <div key={m} data-value={m} onClick={() => handleSelect('minute', m)} className={`text-center py-1.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors ${m === currentMinute ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>{m}</div>
                           ))}
                       </div>
                   </div>
                </div>
            )}
        </div>
    );
};

// --- 自定义日期时间选择器 ---
const CustomDateTimePicker = ({ 
    value, 
    onChange, 
    min, 
    className,
    onKeyDown 
}: { 
    value: string; 
    onChange: (val: string) => void; 
    min?: string; 
    className?: string;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const yearRef = useRef<HTMLDivElement>(null);
    const monthRef = useRef<HTMLDivElement>(null);
    const dayRef = useRef<HTMLDivElement>(null);
    const hourRef = useRef<HTMLDivElement>(null);
    const minuteRef = useRef<HTMLDivElement>(null);

    const now = new Date();
    const currentVal = value ? new Date(value) : now;
    
    const curY = currentVal.getFullYear();
    const curM = currentVal.getMonth() + 1;
    const curD = currentVal.getDate();
    const curH = currentVal.getHours().toString().padStart(2, '0');
    const curMin = currentVal.getMinutes().toString().padStart(2, '0');

    const startYear = new Date().getFullYear();
    const years = Array.from({ length: 101 }, (_, i) => startYear + i);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const daysInMonth = new Date(curY, curM, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
    const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            const scrollToElement = (container: HTMLDivElement | null, targetValue: string | number) => {
                if (container) {
                    const el = container.querySelector(`[data-value="${targetValue}"]`) as HTMLElement;
                    if (el) el.scrollIntoView({ block: 'center' });
                }
            };
            requestAnimationFrame(() => {
                scrollToElement(yearRef.current, curY);
                scrollToElement(monthRef.current, curM);
                scrollToElement(dayRef.current, curD);
                scrollToElement(hourRef.current, curH);
                scrollToElement(minuteRef.current, curMin);
            });
        }
    }, [isOpen, curY, curM, curD, curH, curMin]);

    const handleUpdate = (type: 'year' | 'month' | 'day' | 'hour' | 'minute', val: number | string) => {
        let y = curY, m = curM, d = curD, h = parseInt(curH), min = parseInt(curMin);

        if (type === 'year') y = Number(val);
        if (type === 'month') m = Number(val);
        if (type === 'day') d = Number(val);
        if (type === 'hour') h = Number(val);
        if (type === 'minute') min = Number(val);

        const maxDays = new Date(y, m, 0).getDate();
        if (d > maxDays) d = maxDays;

        const newDate = new Date(y, m - 1, d, h, min);
        const Y_str = newDate.getFullYear();
        const M_str = (newDate.getMonth() + 1).toString().padStart(2, '0');
        const D_str = newDate.getDate().toString().padStart(2, '0');
        const H_str = newDate.getHours().toString().padStart(2, '0');
        const min_str = newDate.getMinutes().toString().padStart(2, '0');

        onChange(`${Y_str}-${M_str}-${D_str}T${H_str}:${min_str}`);
    };

    const displayValue = value ? (() => {
        const d = new Date(value);
        const Y = d.getFullYear();
        const M = (d.getMonth() + 1).toString().padStart(2, '0');
        const D = d.getDate().toString().padStart(2, '0');
        const H = d.getHours().toString().padStart(2, '0');
        const m = d.getMinutes().toString().padStart(2, '0');
        return `${Y}-${M}-${D} ${H}:${m}`;
    })() : null;

    return (
        <div ref={containerRef} className={`relative flex-1 ${className || ''}`}>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        if (onKeyDown) onKeyDown(e);
                        setIsOpen(false);
                    }
                }}
                className={`w-full h-[38px] flex items-center cursor-pointer select-none group bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg px-3 hover:border-blue-400 transition-colors justify-start focus:outline-none`}
            >
                <span className={`text-sm tracking-wide ${value ? 'font-mono font-medium text-blue-600 dark:text-blue-400' : 'text-slate-400'}`}>
                    {displayValue || '选择日期时间'}
                </span>
            </div>

            {isOpen && (
                <div 
                   onMouseDown={(e) => e.preventDefault()}
                   className="absolute top-[calc(100%+4px)] left-0 w-full h-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-xl rounded-lg z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
                >
                   {/* ... 表头部分 ... */}
                   <div className="flex items-center border-b border-gray-100 dark:border-slate-700/50 bg-gray-50/50 dark:bg-slate-900/50 text-[10px] text-slate-400 py-1.5 font-bold">
                       <div className="flex-[1.3] text-center">年</div>
                       <div className="flex-1 text-center">月</div>
                       <div className="flex-1 text-center">日</div>
                       <div className="w-[1px] bg-gray-200 dark:bg-slate-700 h-3 mx-0.5"></div>
                       <div className="flex-1 text-center">时</div>
                       <div className="w-[1px]"></div>
                       <div className="flex-1 text-center">分</div>
                   </div>
                   
                   <div className="flex flex-1 min-h-0 text-xs">
                       <div ref={yearRef} className="flex-[1.3] overflow-y-auto no-scrollbar overscroll-contain relative border-r border-gray-100 dark:border-slate-700/50">
                           {years.map(y => (
                               <div key={y} data-value={y} onClick={() => handleUpdate('year', y)} className={`text-center py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs ${y === curY ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>{y}</div>
                           ))}
                       </div>
                       <div ref={monthRef} className="flex-1 overflow-y-auto no-scrollbar overscroll-contain relative border-r border-gray-100 dark:border-slate-700/50">
                           {months.map(m => (
                               <div key={m} data-value={m} onClick={() => handleUpdate('month', m)} className={`text-center py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs ${m === curM ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>{m}月</div>
                           ))}
                       </div>
                       <div ref={dayRef} className="flex-1 overflow-y-auto no-scrollbar overscroll-contain relative border-r border-gray-100 dark:border-slate-700/50">
                           {days.map(d => (
                               <div key={d} data-value={d} onClick={() => handleUpdate('day', d)} className={`text-center py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs ${d === curD ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>{d}日</div>
                           ))}
                       </div>
                       
                       <div ref={hourRef} className="flex-1 overflow-y-auto no-scrollbar overscroll-contain relative border-r border-gray-100 dark:border-slate-700/50">
                           {hours.map(h => (
                               <div key={h} data-value={h} onClick={() => handleUpdate('hour', h)} className={`text-center py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs ${h === curH ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>{h}</div>
                           ))}
                       </div>
                       <div ref={minuteRef} className="flex-1 overflow-y-auto no-scrollbar overscroll-contain relative">
                           {minutes.map(m => (
                               <div key={m} data-value={m} onClick={() => handleUpdate('minute', m)} className={`text-center py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs ${m === curMin ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>{m}</div>
                           ))}
                       </div>
                   </div>
                </div>
            )}
        </div>
    );
};

export const SettingsPanel: React.FC = () => {
  const { 
      settings, 
      updateSettings, 
      handleAudioUpload, 
      deleteCustomAudio, 
      selectAudio, 
      previewAudio, 
      stopPreviewAudio, 
      previewingId,
      customTimersStatus,
      checkUpdates,
      updateStatus,
      autoStartEnabled,
      toggleAutoStart
  } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State for new/edit reminder form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderType, setNewReminderType] = useState<ReminderType>('interval');
  const [newReminderValue, setNewReminderValue] = useState<number | ''>(''); 
  const [newReminderUnit, setNewReminderUnit] = useState<IntervalUnit>('minutes');
  const [newReminderDateTime, setNewReminderDateTime] = useState('');
  const [minDateTime, setMinDateTime] = useState(getCurrentLocalISO);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');

  // 控制“系统设置”的折叠状态
  const [isSystemSettingsOpen, setIsSystemSettingsOpen] = useState(false);

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  
  // === 全局 CSS 注入 (Persistent & Aggressive) ===
  useEffect(() => {
      const styleId = 'global-ui-fix';
      const cssContent = `
          /* 强制移除所有元素的焦点边框/阴影/Ring，并禁止过渡动画以防止闪烁 */
          *, *::before, *::after {
             outline: none !important;
             --tw-ring-offset-width: 0px !important;
             --tw-ring-color: transparent !important;
             --tw-ring-shadow: none !important;
             -webkit-tap-highlight-color: transparent;
          }

          /* 针对聚焦状态的加强清除 */
          *:focus, *:focus-visible, *:active {
              outline: none !important;
              outline-style: none !important;
              outline-width: 0px !important;
              box-shadow: none !important;
              -webkit-focus-ring-color: transparent !important;
          }

          /* 修复 Electron/Chrome 默认行为 */
          body {
            -webkit-font-smoothing: antialiased;
          }

          .custom-time-input::-webkit-calendar-picker-indicator {
              position: absolute; top: 0; left: 0; right: 0; bottom: 0;
              width: 100%; height: 100%; opacity: 0; cursor: pointer; background: transparent;
          }
          /* 隐藏滚动条 */
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          /* 隐藏数字输入框箭头 */
          .no-spinners::-webkit-outer-spin-button,
          .no-spinners::-webkit-inner-spin-button {
              -webkit-appearance: none; margin: 0;
          }
          .no-spinners { -moz-appearance: textfield; }
      `;

      let styleEl = document.getElementById(styleId);
      
      // 如果标签已存在，更新内容（处理开发环境热更新导致旧样式残留的问题）
      // 如果标签不存在，创建并追加
      if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = styleId;
          document.head.appendChild(styleEl);
      }
      
      // 始终更新内容以确保最新规则生效
      if (styleEl.innerHTML !== cssContent) {
          styleEl.innerHTML = cssContent;
      }

      // 注意：这里有意不返回 cleanup 函数，确保样式在 SettingsPanel 卸载后依然保留
  }, []);

  useEffect(() => {
    return () => {
        const ranges = settingsRef.current.activeHoursRanges;
        const cleaned = ranges.filter(r => r.start.trim() !== '' && r.end.trim() !== '');
        if (cleaned.length !== ranges.length) {
            updateSettings({ activeHoursRanges: cleaned });
        }
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => { setMinDateTime(getCurrentLocalISO()); }, 60000); 
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
      if (editingId) {
          const exists = settings.customReminders.some(r => r.id === editingId);
          if (!exists) {
              setEditingId(null);
              setNewReminderTitle('');
              setNewReminderValue('');
              setNewReminderDateTime('');
              setNewReminderType('interval');
              setAlertMsg(null);
          }
      }
  }, [settings.customReminders, editingId]);

  useEffect(() => {
      if (ipcRenderer) {
          ipcRenderer.invoke('get-app-version')
            .then((ver: string) => setAppVersion(ver))
            .catch((err: any) => console.warn('Failed to get app version:', err));
      }
  }, []);
  
  const sortedReminders = useMemo(() => {
      return [...settings.customReminders].sort((a, b) => {
          if (a.type !== b.type) return a.type === 'interval' ? -1 : 1;
          
          if (a.type === 'interval') {
              const getDur = (r: CustomReminder) => {
                  let m = 60;
                  if (r.intervalUnit === 'hours') m = 3600;
                  if (r.intervalUnit === 'seconds') m = 1;
                  return (r.intervalValue || 0) * m;
              };
              return getDur(a) - getDur(b);
          }
          
          return (a.targetDateTime || Infinity) - (b.targetDateTime || Infinity);
      });
  }, [settings.customReminders]);
  
  const handleDateFocus = () => { setMinDateTime(getCurrentLocalISO()); };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let finalValue: any = value;

    if (type === 'checkbox') {
      finalValue = (e.target as HTMLInputElement).checked;
    } else if (type === 'number') {
      finalValue = value === '' ? '' : Number(value);
    } else if (type === 'range') {
      finalValue = Number(value);
    }

    if (name === 'intervalValue') {
        if (finalValue !== '') {
             if (finalValue < 1) finalValue = 1;
             if (finalValue > 99999) finalValue = 99999;
        }
        updateSettings({ [name]: finalValue } as Partial<AppSettings>);
    } 
    else if (name === 'intervalUnit') {
        updateSettings({ [name]: value as IntervalUnit });
    } 
    else {
        updateSettings({ [name]: finalValue } as Partial<AppSettings>);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        handleAudioUpload(e.target.files[0]);
        e.target.value = '';
    }
  };

  const startEditing = (id: string) => {
      const r = settings.customReminders.find(item => item.id === id);
      if (!r) return;
      if (editingId === id) {
          cancelEdit();
          return;
      }
      setEditingId(id);
      setNewReminderTitle(r.title);
      setNewReminderType(r.type);
      setAlertMsg(null);
      if (r.type === 'interval') {
          setNewReminderValue(r.intervalValue ?? '');
          setNewReminderUnit(r.intervalUnit ?? 'minutes');
          setNewReminderDateTime(''); 
      } else {
          setNewReminderValue('');
          if (r.targetDateTime) {
              const d = new Date(r.targetDateTime);
              const Y = d.getFullYear();
              const M = (d.getMonth()+1).toString().padStart(2, '0');
              const D = d.getDate().toString().padStart(2, '0');
              const h = d.getHours().toString().padStart(2, '0');
              const m = d.getMinutes().toString().padStart(2, '0');
              setNewReminderDateTime(`${Y}-${M}-${D}T${h}:${m}`);
          } else {
              setNewReminderDateTime('');
          }
      }
  };

  const cancelEdit = () => {
      setEditingId(null);
      setNewReminderTitle('');
      setNewReminderValue('');
      setNewReminderDateTime('');
      setNewReminderType('interval');
      setAlertMsg(null);
  };

  const saveCustomReminder = () => {
      setAlertMsg(null);
      if (!newReminderTitle.trim()) return;
      
      let targetTime: number | undefined;
      const intervalVal = newReminderValue === '' ? 0 : newReminderValue;

      if (newReminderType === 'onetime') {
          if (!newReminderDateTime) return;
          targetTime = new Date(newReminderDateTime).getTime();
          if (targetTime < Date.now()) {
              setAlertMsg('请选择一个未来的时间');
              return;
          }
      } else {
          if (intervalVal <= 0) {
              setAlertMsg('间隔时间必须大于0');
              return;
          }
      }

      let nextTriggerTime: number | undefined;
      if (newReminderType === 'interval' && intervalVal > 0) {
          let multiplier = 60;
          if (newReminderUnit === 'hours') multiplier = 3600;
          if (newReminderUnit === 'seconds') multiplier = 1;
          nextTriggerTime = Date.now() + intervalVal * multiplier * 1000;
      }

      if (editingId) {
          const updatedReminders = settings.customReminders.map(r => {
              if (r.id === editingId) {
                  return {
                      ...r,
                      title: newReminderTitle,
                      type: newReminderType,
                      intervalValue: newReminderType === 'interval' ? intervalVal : undefined,
                      intervalUnit: newReminderType === 'interval' ? newReminderUnit : undefined,
                      targetDateTime: targetTime,
                      nextTriggerTime: newReminderType === 'interval' ? nextTriggerTime : undefined,
                      pausedRemainingTime: undefined,
                      enabled: true 
                  };
              }
              return r;
          });
          updateSettings({ customReminders: updatedReminders });
          cancelEdit();
      } else {
          const newReminder: CustomReminder = {
              id: generateId(),
              title: newReminderTitle,
              type: newReminderType,
              enabled: true,
              intervalValue: newReminderType === 'interval' ? intervalVal : undefined,
              intervalUnit: newReminderType === 'interval' ? newReminderUnit : undefined,
              targetDateTime: targetTime,
              nextTriggerTime,
              pausedRemainingTime: undefined
          };
          updateSettings({ customReminders: [...settings.customReminders, newReminder] });
          setNewReminderTitle('');
          setNewReminderValue('');
          setNewReminderDateTime('');
          setAlertMsg(null);
      }
  };

  const deleteCustomReminder = (id: string) => {
      if (id === editingId) cancelEdit();
      updateSettings({ customReminders: settings.customReminders.filter(r => r.id !== id) });
  };
  
  const toggleCustomReminder = (id: string) => {
       const reminder = settings.customReminders.find(r => r.id === id);
       if (!reminder) return;
       
       const nextEnabled = !reminder.enabled;
       let nextTriggerTime: number | undefined = reminder.nextTriggerTime;

       if (nextEnabled) {
           if (reminder.type === 'onetime' && reminder.targetDateTime) {
               if (reminder.targetDateTime <= Date.now()) {
                   updateSettings({ customReminders: settings.customReminders.filter(r => r.id !== id) });
                   return;
               }
           }

           if (reminder.type === 'interval') {
               if (!nextTriggerTime) {
                   let multiplier = 60;
                   if (reminder.intervalUnit === 'hours') multiplier = 3600;
                   if (reminder.intervalUnit === 'seconds') multiplier = 1;
                   const val = reminder.intervalValue || 0;
                   nextTriggerTime = Date.now() + val * multiplier * 1000;
               }
           } else {
               nextTriggerTime = reminder.nextTriggerTime; 
           }
       } else {
           if (reminder.type === 'interval') {
               nextTriggerTime = reminder.nextTriggerTime;
           } else {
               nextTriggerTime = undefined;
           }
       }

       updateSettings({
          customReminders: settings.customReminders.map(r => 
            r.id === id ? { 
                ...r, 
                enabled: nextEnabled, 
                nextTriggerTime, 
                pausedRemainingTime: undefined
            } : r
          )
      });
  };

  const addTimeRange = () => {
    const newRange = { id: generateId(), start: '', end: '' };
    updateSettings({ activeHoursRanges: [...settings.activeHoursRanges, newRange] });
  };

  const removeTimeRange = (id: string) => {
    const updatedRanges = settings.activeHoursRanges.filter(range => range.id !== id);
    updateSettings({ activeHoursRanges: updatedRanges });
  };

  const updateTimeRange = (id: string, field: 'start' | 'end', value: string) => {
    const updatedRanges = settings.activeHoursRanges.map(range => 
        range.id === id ? { ...range, [field]: value } : range
    );
    updateSettings({ activeHoursRanges: updatedRanges });
  };
  
  // Shortcut Recording
  const [isRecording, setIsRecording] = useState(false);
  const shortcutInputRef = useRef<HTMLInputElement>(null);
  const ignoreBlurRef = useRef(false);

  useEffect(() => {
    if (isRecording) {
        shortcutInputRef.current?.focus();
        const timer = setTimeout(() => {
            ignoreBlurRef.current = false;
        }, 300);
        return () => clearTimeout(timer);
    }
  }, [isRecording]);

  const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
      if (!isRecording) return;
      e.preventDefault();

      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      if (e.metaKey) keys.push('Super');

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      
      let key = e.key.toUpperCase();
      if (key === ' ') key = 'Space';
      
      keys.push(key);
      const shortcutStr = keys.join('+');
      
      updateSettings({ globalShortcut: shortcutStr });
      setIsRecording(false);
  };
  
  const clearShortcut = () => {
      updateSettings({ globalShortcut: '' });
      setIsRecording(false);
  };

  // 统一校验逻辑
  const isFormValid = useMemo(() => {
      if (!newReminderTitle.trim()) return false;
      if (newReminderType === 'interval') {
          return newReminderValue !== '' && Number(newReminderValue) > 0;
      } else {
          return newReminderDateTime !== '';
      }
  }, [newReminderTitle, newReminderType, newReminderValue, newReminderDateTime]);

  // 处理回车键事件
  const handleEnterKey = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          if (!isFormValid) return; 
          saveCustomReminder();
      }
  };

  // --- 抽取出来的编辑/添加表单渲染函数 ---
  const renderReminderForm = () => (
    <div className={`p-3 rounded-lg space-y-3 border transition-colors ${editingId ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800' : 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700'}`}>
        {editingId && (
            <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">正在编辑:</span>
                <button onClick={cancelEdit} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">取消</button>
            </div>
        )}
        <div className="flex rounded-md bg-white dark:bg-slate-900 p-1 mb-2 border border-gray-200 dark:border-slate-700 h-[38px]">
            <button 
                onClick={() => setNewReminderType('interval')}
                className={`flex-1 h-full flex items-center justify-center text-sm rounded ${newReminderType === 'interval' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-500'}`}
            >
                周期提醒
            </button>
            <button 
                onClick={() => setNewReminderType('onetime')}
                className={`flex-1 h-full flex items-center justify-center text-sm rounded ${newReminderType === 'onetime' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-500'}`}
            >
                定点提醒
            </button>
        </div>
        
        <div>
            <input 
                    type="text" 
                    placeholder="提醒内容 (支持 \n 换行)"
                    value={newReminderTitle}
                    onChange={(e) => setNewReminderTitle(e.target.value)}
                    onKeyDown={handleEnterKey}
                    className="w-full h-[38px] bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 text-sm focus:outline-none focus:border-blue-500 text-slate-800 dark:text-white"
            />
        </div>
        
        {newReminderType === 'interval' ? (
            <div className="flex gap-2 w-full">
                <CustomNumberInput 
                    value={newReminderValue}
                    onChange={(val) => {
                        let finalVal = val;
                        if (finalVal !== '' && finalVal < 1) finalVal = 1;
                        if (finalVal !== '' && finalVal > 99999) finalVal = 99999;
                        setNewReminderValue(finalVal);
                    }}
                    onKeyDown={handleEnterKey}
                    min={1}
                    max={99999}
                    placeholder="间隔时长"
                    className="flex-[3] min-w-[90px] h-[38px]"
                />
                <div className="flex gap-2 shrink-0 flex-[2]">
                    <CustomSelect 
                        value={newReminderUnit}
                        onChange={(val) => setNewReminderUnit(val as IntervalUnit)}
                        options={[
                            { label: '秒', value: 'seconds' },
                            { label: '分钟', value: 'minutes' },
                            { label: '小时', value: 'hours' },
                        ]}
                        className="flex-1 min-w-[64px]"
                    />
                    <button 
                            onClick={saveCustomReminder}
                            disabled={!isFormValid}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 h-[38px] rounded text-sm font-medium shrink-0 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-sm min-w-[54px]"
                    >
                        {editingId ? '保存' : '添加'}
                    </button>
                </div>
            </div>
        ) : (
            <div className="flex gap-2">
                <CustomDateTimePicker 
                    value={newReminderDateTime}
                    onChange={(val) => setNewReminderDateTime(val)}
                    min={minDateTime}
                    onKeyDown={handleEnterKey}
                />
                <button 
                        onClick={saveCustomReminder}
                        disabled={!isFormValid}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {editingId ? '保存' : '添加'}
                </button>
            </div>
        )}
        {alertMsg && (
                <div className="text-red-500 text-xs mt-1 animate-pulse">
                    ⚠️ {alertMsg}
                </div>
        )}
    </div>
  );

  const themes = [
      { id: 'light', name: '浅色模式', icon: '☀️' },
      { id: 'dark', name: '深色模式', icon: '🌙' }
  ];

  const workModes: {id: WorkMode, label: string}[] = [
      { id: 'everyday', label: '每天' },
      { id: 'big-small', label: '大小周' },
      { id: 'weekend', label: '周末' },
  ];

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700/50 h-full flex flex-col overflow-hidden transition-colors duration-300">
        <div className="p-6 border-b border-gray-200 dark:border-slate-700/50 bg-white dark:bg-slate-800 flex-shrink-0 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <span>⚙️</span> 设置
            </h2>
            <div className="flex items-center gap-3">
                 {ipcRenderer && updateStatus === 'checking' && <span className="text-xs text-slate-500 animate-pulse">正在检查...</span>}
                 {ipcRenderer && updateStatus === 'not-available' && <span className="text-xs text-green-600 dark:text-green-400">已是最新版本</span>}
                 {appVersion && <span className="text-xs text-slate-400 font-mono bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">{`v${appVersion}`}</span>}
                 {ipcRenderer && (
                    <button 
                        onClick={() => checkUpdates(true)} 
                        disabled={updateStatus === 'checking' || updateStatus === 'downloading'} 
                        className="p-1.5 text-slate-400 hover:text-blue-500 rounded-full transition-colors disabled:opacity-50"
                    >
                        <svg className={`w-4 h-4 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                 )}
            </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-8 pb-10">
            
            {/* 1. 系统 (合并了原外观、自启动、快捷键) */}
            <div className="space-y-4">
                {/* 标题栏 - 点击可切换折叠状态 */}
                <div 
                    onClick={() => setIsSystemSettingsOpen(!isSystemSettingsOpen)}
                    className="flex items-center justify-between cursor-pointer group border-b border-gray-200 dark:border-slate-700 pb-2 select-none"
                >
                    <label className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        系统项
                    </label>
                    <div className={`text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-transform duration-200 ${isSystemSettingsOpen ? 'rotate-180' : ''}`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
                
                {/* 内容区域 - 根据状态显示/隐藏 */}
                {isSystemSettingsOpen && (
                    <div className="bg-gray-50/50 dark:bg-slate-900/30 rounded-xl border border-gray-200 dark:border-slate-700/50 p-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        
                        {/* 1.1 开机自启动 (仅 Electron 环境显示) */}
                        {ipcRenderer && (
                            <>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">开机自启动</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">登录系统后自动运行应用</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" checked={autoStartEnabled} onChange={toggleAutoStart} className="sr-only peer" />
                                        <div className="w-11 h-6 bg-gray-300 dark:bg-slate-600 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                                    </label>
                                </div>
                                <div className="h-[1px] bg-gray-200 dark:bg-slate-700/50"></div>
                            </>
                        )}

                        {/* 1.2 外观 (通用) */}
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">外观风格</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">切换应用显示的色彩主题</p>
                            </div>
                            <div className="flex gap-2">
                                {themes.map(t => (
                                    <button
                                            key={t.id}
                                            onClick={() => updateSettings({ theme: t.id as any })}
                                            className={`py-1.5 px-3 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${
                                                settings.theme === t.id 
                                                ? 'bg-blue-50 border-blue-500 text-blue-600 dark:bg-blue-900/30 dark:border-blue-500 dark:text-blue-400' 
                                                : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                                            }`}
                                    >
                                        <span>{t.icon}</span>
                                        <span>{t.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 1.3 全局快捷键 (仅 Electron 环境显示) */}
                        {ipcRenderer && (
                            <>
                                <div className="h-[1px] bg-gray-200 dark:bg-slate-700/50"></div>
                                
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">全局快捷键</span>
                                        <span className="text-[10px] text-slate-400">一键显示/隐藏主界面</span>
                                    </div>
                                    
                                    <div className="flex gap-2">
                                        <div className={`relative flex-1 bg-white dark:bg-slate-900 border rounded-lg flex items-center px-3 py-2 transition-colors ${isRecording ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-300 dark:border-slate-600'}`}>
                                            <input
                                                ref={shortcutInputRef}
                                                type="text"
                                                readOnly
                                                value={isRecording ? '请按下快捷键组合...' : (settings.globalShortcut || '未设置')}
                                                onKeyDown={handleShortcutKeyDown}
                                                onBlur={(e) => {
                                                    if (ignoreBlurRef.current) {
                                                        e.target.focus();
                                                        return;
                                                    }
                                                    setIsRecording(false);
                                                }}
                                                className={`w-full bg-transparent outline-none text-sm cursor-default ${isRecording ? 'text-blue-500' : (settings.globalShortcut ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400')}`}
                                            />
                                            {settings.globalShortcut && !isRecording && (
                                                <button onClick={clearShortcut} className="ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                </button>
                                            )}
                                        </div>
                                        <div 
                                            onMouseDown={(e) => isRecording && e.preventDefault()}
                                        >
                                            <button 
                                                onClick={() => {
                                                    ignoreBlurRef.current = true;
                                                    setIsRecording(true);
                                                }}
                                                disabled={isRecording}
                                                className={`h-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isRecording ? 'bg-gray-100 text-slate-500 pointer-events-none' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                                            >
                                                {isRecording ? '录制中...' : '设置'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* 2. 主提醒 */}
            <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">主提醒 (循环)</label>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-slate-500 mb-1 block font-medium">间隔时长</label>
                        <CustomNumberInput 
                            value={settings.intervalValue} 
                            onChange={(val) => {
                                let finalVal = val;
                                if (finalVal !== '' && finalVal < 1) finalVal = 1;
                                if (finalVal !== '' && finalVal > 99999) finalVal = 99999;
                                updateSettings({ intervalValue: finalVal });
                            }} 
                            min={1} 
                            max={99999} 
                            className="w-full h-[38px]" 
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 mb-1 block font-medium">时间单位</label>
                        <CustomSelect 
                            value={settings.intervalUnit}
                            onChange={(val) => updateSettings({ intervalUnit: val as IntervalUnit })}
                            align="left"
                            options={[
                                { label: '秒', value: 'seconds' },
                                { label: '分钟', value: 'minutes' },
                                { label: '小时', value: 'hours' },
                            ]}
                        />
                    </div>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs text-slate-500 mb-1 block font-medium">文案前缀</label>
                        <input type="text" name="messagePrefix" value={settings.messagePrefix} onChange={handleChange} className="w-full h-[38px] bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 mb-1 block font-medium">文案后缀</label>
                        <input type="text" name="messageSuffix" value={settings.messageSuffix} onChange={handleChange} className="w-full h-[38px] bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500" />
                    </div>
                </div>
            </div>

            {/* 3. 自定义内容提醒 */}
            <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">自定义内容提醒</label>
                <div className="space-y-3">
                    {/* Render Reminder List */}
                    {sortedReminders.map(reminder => {
                        const timerStatus = customTimersStatus.find(s => s.id === reminder.id);
                        const isEditingThis = editingId === reminder.id;
                        
                        return (
                            <React.Fragment key={reminder.id}>
                                <div className={`flex items-center gap-3 bg-white dark:bg-slate-800 p-3 rounded-lg border shadow-sm transition-colors ${isEditingThis ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 dark:border-slate-700/50'}`}>
                                    <input 
                                            type="checkbox"
                                            checked={reminder.enabled}
                                            onChange={() => toggleCustomReminder(reminder.id)}
                                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{reminder.title}</div>
                                        <div className="text-xs text-slate-500 mt-1 flex items-center flex-wrap gap-2">
                                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${reminder.type === 'interval' ? 'bg-blue-50 border-blue-100 text-blue-600 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400' : 'bg-amber-50 border-amber-100 text-amber-600 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400'}`}>
                                                {reminder.type === 'interval' ? '🔄' : '📅'}
                                                <span>{reminder.type === 'interval' ? '周期' : '定点'}</span>
                                            </span>
                                            <span className="truncate max-w-[200px]">
                                                {reminder.type === 'interval' 
                                                    ? `每 ${reminder.intervalValue} ${reminder.intervalUnit === 'hours' ? '小时' : (reminder.intervalUnit === 'seconds' ? '秒' : '分钟')}` 
                                                    : (reminder.targetDateTime ? formatDateTime(reminder.targetDateTime) : 'N/A')}
                                            </span>
                                            {reminder.enabled && timerStatus && timerStatus.timeLeft > 0 && (
                                                <>
                                                    <span className={`font-mono font-bold text-xs truncate max-w-[260px] ${reminder.type === 'interval' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                                        剩 {formatTime(timerStatus.timeLeft)}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                            <button 
                                                onClick={() => startEditing(reminder.id)}
                                                className={`p-1 shrink-0 transition-colors focus:outline-none ${isEditingThis ? 'text-blue-600 dark:text-blue-400' : 'text-blue-400 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300'}`}
                                                title={isEditingThis ? "取消编辑" : "编辑"}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                            </button>
                                            <button 
                                                onClick={() => deleteCustomReminder(reminder.id)}
                                                className="text-red-400 hover:text-red-500 dark:text-red-300 dark:hover:text-red-200 p-1 shrink-0 transition-colors focus:outline-none"
                                                title="删除"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                    </div>
                                </div>
                                {/* 如果正在编辑当前项，在下方显示编辑框 */}
                                {isEditingThis && (
                                    <div id={`editing-reminder-${reminder.id}`} className="mt-2">
                                        {renderReminderForm()}
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}

                    {/* 如果没有正在编辑的项目，则在底部显示添加框 */}
                    {!editingId && renderReminderForm()}
                </div>
            </div>
            
            {/* 4. 时段启停 */}
            <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">时段启停 (工作时段)</label>
                <div className="bg-gray-50/50 dark:bg-slate-900/30 rounded-xl border border-gray-200 dark:border-slate-700/50 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">启用托管模式</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">仅在下列指定时间段内运行</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" name="activeHoursEnabled" checked={settings.activeHoursEnabled} onChange={handleChange} className="sr-only peer" />
                            <div className="w-11 h-6 bg-gray-300 dark:bg-slate-600 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                        </label>
                    </div>

                    {settings.activeHoursEnabled && (
                        <div className="space-y-4 animate-fade-in">
                            <div>
                                <label className="text-[11px] text-slate-400 mb-1.5 block font-medium">工作模式</label>
                                <div className="flex items-center gap-3">
                                    <CustomSelect 
                                        value={settings.workMode}
                                        onChange={(val) => updateSettings({ workMode: val as WorkMode })}
                                        options={workModes.map(m => ({ label: m.label, value: m.id }))}
                                        className="flex-1"
                                    />
                                    <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                                        <input type="checkbox" checked={settings.skipHolidays} onChange={(e) => updateSettings({ skipHolidays: e.target.checked })} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                                        <span className="text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">跳过法定节假日</span>
                                    </label>
                                </div>
                            </div>

                            {settings.workMode === 'big-small' && (
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2 sm:gap-3 h-auto sm:h-[42px] px-2 sm:px-3 py-1.5 sm:py-0 bg-white dark:bg-slate-800 rounded border border-gray-200 dark:border-slate-700/50 shadow-sm overflow-hidden">
                                        <span className="text-[11px] sm:text-xs text-slate-500 font-medium shrink-0">当前周状态</span>
                                        <div className="flex gap-1 sm:gap-2 ml-auto min-w-0 flex-1 justify-end">
                                            <button 
                                                onClick={() => {
                                                    updateSettings({ 
                                                        isBigWeek: true,
                                                        lastWeekNumber: getAbsoluteWeekNumber()
                                                    });
                                                }} 
                                                className={`flex-1 sm:flex-none py-1.5 px-2 sm:px-3 rounded-lg border text-[10px] sm:text-xs font-medium transition-all min-w-0 ${
                                                    settings.isBigWeek 
                                                    ? 'bg-blue-50 border-blue-500 text-blue-600 dark:bg-blue-900/30 dark:border-blue-500 dark:text-blue-400' 
                                                    : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                                                }`}
                                            >
                                                <span className="truncate block">大周 (周六班)</span>
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    updateSettings({ 
                                                        isBigWeek: false,
                                                        lastWeekNumber: getAbsoluteWeekNumber()
                                                    });
                                                }} 
                                                className={`flex-1 sm:flex-none py-1.5 px-2 sm:px-3 rounded-lg border text-[10px] sm:text-xs font-medium transition-all min-w-0 ${
                                                    !settings.isBigWeek 
                                                    ? 'bg-blue-50 border-blue-500 text-blue-600 dark:bg-blue-900/30 dark:border-blue-500 dark:text-blue-400' 
                                                    : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                                                }`}
                                            >
                                                <span className="truncate block">小周 (周六休)</span>
                                            </button>
                                        </div>
                                    </div>
                                    <label className="hidden items-center gap-2 px-1 cursor-pointer w-max group mt-1">
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 rounded-sm border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 focus:ring-offset-0 bg-transparent dark:border-slate-600 dark:bg-slate-800"
                                            checked={settings.autoToggleBigSmallWeek}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                updateSettings({ 
                                                    autoToggleBigSmallWeek: checked,
                                                    lastWeekNumber: checked ? getAbsoluteWeekNumber() : undefined
                                                });
                                            }}
                                        />
                                        <span className="text-xs text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">自动轮询大小周</span>
                                    </label>
                                </div>
                            )}

                            {/* Time range list below the gray settings card */}
                            <div className="space-y-4 pt-2">
                                {settings.activeHoursRanges.map((range, index) => (
                                    <div key={range.id} className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-3 space-y-1.5">
                                        <div className="flex justify-between items-center px-1">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">开始 {index + 1}</label>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-10">结束 {index + 1}</label>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {/* 使用全新的自定义 TimePicker 组件 */}
                                            <CustomTimePicker 
                                                value={range.start} 
                                                onChange={(val) => updateTimeRange(range.id, 'start', val)} 
                                                className="flex-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg h-[38px] hover:border-blue-400 transition-colors"
                                            />
                                            <span className="text-slate-400 text-lg">→</span>
                                            {/* 使用全新的自定义 TimePicker 组件 */}
                                            <CustomTimePicker 
                                                value={range.end} 
                                                onChange={(val) => updateTimeRange(range.id, 'end', val)} 
                                                className="flex-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg h-[38px] hover:border-blue-400 transition-colors"
                                            />
                                            <button onClick={() => removeTimeRange(range.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                                        </div>
                                    </div>
                                ))}
                                <button onClick={addTimeRange} className="w-full py-2.5 border-2 border-dashed border-gray-300 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-blue-400 hover:text-blue-500 rounded-xl text-xs font-semibold transition-all">+ 添加时间段</button>
                                {settings.activeHoursRanges.length === 0 && <p className="text-[9px] text-center text-slate-400 mt-2 whitespace-nowrap px-1">未设置时间段时，将在工作模式允许的所有时间内运行。</p>}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 5. 声音设置 */}
            <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">声音</label>
                <div className="bg-gray-50/50 dark:bg-slate-900/30 rounded-xl border border-gray-200 dark:border-slate-700/50 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">开启声音提醒</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" name="soundEnabled" checked={settings.soundEnabled} onChange={handleChange} className="sr-only peer" />
                            <div className="w-11 h-6 bg-gray-300 dark:bg-slate-600 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                        </label>
                    </div>
                    {settings.soundEnabled && (
                        <div className="space-y-4 pt-2 animate-fade-in">
                            <div>
                                <div className="flex justify-between mb-2 px-1">
                                    <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">音量调节</label>
                                    <span className="text-xs font-mono text-slate-500">{Math.round(settings.audioVolume * 100)}%</span>
                                </div>
                                <input type="range" name="audioVolume" min="0" max="1" step="0.05" value={settings.audioVolume} onChange={handleChange} className="w-full h-1.5 bg-gray-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                            </div>
                            <div>
                                <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-2 block px-1">选择提示音</label>
                                <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700/50 divide-y divide-gray-100 dark:divide-slate-700/50 overflow-hidden">
                                    {settings.soundList.map((sound) => (
                                        <div key={sound.id} className={`flex items-center p-3 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors ${settings.selectedSoundId === sound.id ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
                                            <input type="radio" name="soundSelection" checked={settings.selectedSoundId === sound.id} onChange={() => selectAudio(sound.id)} className="w-4 h-4 text-blue-600 cursor-pointer focus:ring-0" />
                                            <span className="ml-3 text-sm text-slate-700 dark:text-slate-200 flex-1 truncate cursor-pointer" onClick={() => selectAudio(sound.id)}>
                                                {sound.name}
                                                {sound.type === 'system' && <span className="ml-2 text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded-md font-bold uppercase">系统</span>}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => previewingId === sound.id ? stopPreviewAudio() : previewAudio(sound.id)} className={`p-1.5 rounded-full ${previewingId === sound.id ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/40' : 'text-slate-400 hover:text-blue-500'}`}>
                                                    {previewingId === sound.id ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                                                </button>
                                                {sound.type === 'custom' && <button onClick={() => deleteCustomAudio(sound.id)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3">
                                    <input type="file" ref={fileInputRef} onChange={onFileChange} accept="audio/*" className="hidden" />
                                    <button onClick={() => fileInputRef.current?.click()} className="w-full py-2.5 border-2 border-dashed border-gray-300 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-blue-400 hover:text-blue-500 rounded-xl text-xs font-semibold transition-all">
                                        + 上传自定义提示音
                                    </button>
                                    <p className="text-[10px] text-slate-400 mt-2 text-center uppercase tracking-wide">支持 MP3, WAV, OGG 等格式，建议时长不超过 30 秒</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    </div>
  );
};