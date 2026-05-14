import React, { useState, useEffect, useRef } from 'react';
import { AppProvider, useApp } from '@/context/AppContext';
import CircularTimer from '@/components/CircularTimer';
import { SettingsPanel } from '@/components/SettingsPanel';
import { NotificationOverlay } from '@/components/NotificationOverlay';
import { UpdateStatus } from '@/types';

// Helper to access IPC
const ipcRenderer = typeof window !== 'undefined' && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

// --- 更新提示模态框组件 ---
interface UpdateModalProps {
    isOpen: boolean;
    status: UpdateStatus;
    versionInfo?: { version: string; releaseNotes?: string | Array<{ note: string }>; };
    errorMsg?: string;
    progress?: number;
    isPortable?: boolean;
    onClose: () => void;
    onDownload: () => void;
    onDownloadPortable: () => void;
    onRestart: () => void;
    onSkip: (version: string) => void;
    onRemindLater: () => void;
}

const UpdateModal: React.FC<UpdateModalProps> = ({ 
    isOpen, 
    status, 
    versionInfo, 
    errorMsg, 
    progress, 
    isPortable, 
    onClose, 
    onDownload, 
    onDownloadPortable,
    onRestart, 
    onSkip,
    onRemindLater 
}) => {
    // Add local state to debounce click and show loading immediately
    const [isStarting, setIsStarting] = useState(false);

    useEffect(() => {
        if (status !== 'available') {
            setIsStarting(false);
        }
    }, [status]);

    if (!isOpen || !status) return null;

    const handleConfirmUpdate = () => {
        setIsStarting(true);
        if (isPortable) {
            onDownloadPortable();
        } else {
            onDownload();
        }
    };

    // Render logic for different statuses
    const renderIcon = () => {
        if (status === 'error') return (
            <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/20 text-red-500 flex items-center justify-center mx-auto mb-4 shrink-0">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
        );
        if (status === 'available') {
            // Portable 用 info 图标，普通版用 download 图标
            if (isPortable) {
                return (
                    <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 flex items-center justify-center mx-auto mb-4 shrink-0">
                        <span className="text-3xl font-bold">i</span>
                    </div>
                );
            }
            return (
                <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 flex items-center justify-center mx-auto mb-4 shrink-0">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                </div>
            );
        }
        // Downloading / Downloaded - Changed to Blue to match app theme
        return (
            <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 flex items-center justify-center mx-auto mb-4 shrink-0">
                 <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            </div>
        );
    };

    const renderTitle = () => {
        if (status === 'error') return '更新出错';
        if (status === 'available') return `发现新版本 v${versionInfo?.version || ''}`;
        if (status === 'downloaded') return '下载完成';
        if (status === 'downloading') return '正在下载...';
        return '更新提示';
    };

    // Helper to strip HTML tags for cleaner text display
    const stripHtml = (html: string) => {
        try {
            const tmp = document.createElement("DIV");
            tmp.innerHTML = html;
            return tmp.textContent || tmp.innerText || "";
        } catch (e) {
            return "";
        }
    };

    const renderContent = () => {
        if (status === 'available') {
            // Portable Specific Text
            if (isPortable) {
                return (
                    <div className="mt-2 text-left w-full text-center">
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                            便携版(Portable)无法自动覆盖更新，请前往下载最新版本。
                        </p>
                    </div>
                );
            }

            const notes = versionInfo?.releaseNotes;
            let displayNotes = '';

            try {
                if (typeof notes === 'string') {
                    displayNotes = notes;
                } else if (Array.isArray(notes)) {
                    displayNotes = notes.map(n => {
                        if (typeof n === 'string') return n;
                        // Check if object and has note property
                        if (n && typeof n === 'object' && 'note' in n) return (n as any).note;
                        return ''; 
                    }).filter(n => n && typeof n === 'string' && n.trim() !== '').join('\n');
                }
            } catch (e) {
                displayNotes = '';
            }
            
            // Clean up HTML tags if present
            let cleanNotes = stripHtml(displayNotes || '');

            // Double check for stringified object or empty
            if (!cleanNotes || cleanNotes.trim() === '' || cleanNotes.includes('[object Object]')) {
                cleanNotes = '';
            }

            return (
                <div className="mt-2 text-left w-full">
                    {cleanNotes && cleanNotes.trim() !== '' && (
                        <div className="w-full">
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1.5 pl-1">更新内容：</p>
                            <div className="bg-white border border-gray-100 dark:bg-slate-900 dark:border-slate-700 rounded-lg p-3 max-h-40 overflow-y-auto custom-scrollbar">
                                <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-sans break-words leading-relaxed">
                                    {cleanNotes}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }
        if (status === 'downloading') {
            const pct = Math.round(progress || 0);
            return (
                <div className="w-full mt-4 px-2">
                    <div className="flex justify-between mb-1">
                        <span className="text-xs font-medium text-blue-700 dark:text-blue-400">下载中</span>
                        <span className="text-xs font-medium text-blue-700 dark:text-blue-400">{pct}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }}></div>
                    </div>
                </div>
            );
        }
        if (status === 'downloaded') {
            return (
                 <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed px-2 mt-2 text-center">
                    新版本已下载完毕，重启应用即可生效。
                </p>
            );
        }
        if (status === 'error') {
            return (
                <div className="mt-2 text-left bg-red-50 dark:bg-red-900/10 rounded-lg p-3 border border-red-100 dark:border-red-900/20 w-full">
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium mb-1">错误详情：</p>
                    <div className="max-h-32 overflow-y-auto custom-scrollbar">
                        <p className="text-[10px] font-mono text-slate-600 dark:text-slate-400 break-all whitespace-pre-wrap">
                            {errorMsg || '未知错误'}
                        </p>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-slate-700 animate-slide-up transform transition-all flex flex-col max-h-[90vh]">
                <div className="p-6 text-center flex-1 overflow-y-auto custom-scrollbar flex flex-col items-center">
                    {renderIcon()}
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2 shrink-0">
                        {renderTitle()}
                    </h3>
                    {renderContent()}
                </div>
                
                <div className="flex flex-col gap-2 p-4 bg-gray-50 dark:bg-slate-900/50 shrink-0 border-t border-gray-100 dark:border-slate-800">
                    {status === 'available' && (
                        <>
                            <button 
                                onClick={handleConfirmUpdate}
                                disabled={isStarting}
                                className={`w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors focus:outline-none focus:ring-0 active:scale-[0.98] flex items-center justify-center gap-2 ${isStarting ? 'opacity-70 cursor-not-allowed' : ''}`}
                            >
                                {isStarting ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        请稍候...
                                    </>
                                ) : (
                                    isPortable ? '去下载' : '立即更新'
                                )}
                            </button>
                            
                            {isPortable ? (
                                <div className="flex gap-2">
                                <button 
                                    onClick={onRemindLater}
                                    className="flex-1 py-2 px-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl text-sm font-medium transition-colors focus:outline-none focus:ring-0"
                                >
                                        下次提醒
                                </button>
                                    <button 
                                        onClick={() => versionInfo && onSkip(versionInfo.version)}
                                        className="flex-1 py-2 px-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm font-medium transition-colors focus:outline-none focus:ring-0"
                                    >
                                        跳过此版本
                                    </button>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <button 
                                        onClick={onRemindLater}
                                        className="flex-1 py-2 px-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl text-sm font-medium transition-colors focus:outline-none focus:ring-0"
                                    >
                                        下次提醒
                                    </button>
                                    <button 
                                        onClick={() => versionInfo && onSkip(versionInfo.version)}
                                        className="flex-1 py-2 px-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm font-medium transition-colors focus:outline-none focus:ring-0"
                                    >
                                        跳过此版本
                                    </button>
                                </div>
                            )}
                        </>
                    )}

                    {status === 'downloading' && (
                         <button 
                            className="w-full py-2.5 px-4 bg-gray-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-xl font-medium cursor-not-allowed opacity-70"
                            disabled
                        >
                            下载中...
                        </button>
                    )}

                    {status === 'downloaded' && (
                        <>
                            <button 
                                onClick={onRestart}
                                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors focus:outline-none focus:ring-0 active:scale-[0.98]"
                            >
                                立即重启更新
                            </button>
                            <button 
                                onClick={onClose}
                                className="w-full py-2 px-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm font-medium transition-colors focus:outline-none focus:ring-0"
                            >
                                稍后重启
                            </button>
                        </>
                    )}

                    {status === 'error' && (
                        <button 
                            onClick={onClose}
                            className="w-full py-2.5 px-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-xl font-medium transition-colors focus:outline-none focus:ring-0 active:scale-[0.98]"
                        >
                            我知道了
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// ... (CloseConfirmModal and StandaloneNotification remain unchanged) ...
const CloseConfirmModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    const handleMinimize = () => { if (ipcRenderer) ipcRenderer.send('confirm-minimize'); onClose(); };
    const handleQuit = () => { if (ipcRenderer) ipcRenderer.send('confirm-quit'); onClose(); };
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-slate-700 animate-slide-up transform transition-all">
                <div className="p-6 text-center">
                    <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="text-3xl">🤔</span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">您想要如何处理？</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">最小化后，倒计时后台继续运行，不会中断提醒。</p>
                </div>
                <div className="flex flex-col gap-2 p-4 bg-gray-50 dark:bg-slate-900/50 border-t border-gray-100 dark:border-slate-800">
                    <button onClick={handleMinimize} className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors focus:outline-none focus:ring-0 active:scale-[0.98]">最小化到托盘</button>
                    <button onClick={handleQuit} className="w-full py-2.5 px-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-xl font-medium transition-colors focus:outline-none focus:ring-0 active:scale-[0.98]">直接退出</button>
                    <button onClick={onClose} className="w-full py-2 px-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm font-medium transition-colors focus:outline-none focus:ring-0">取消</button>
                </div>
            </div>
        </div>
    );
};

const StandaloneNotification: React.FC = () => {
    const [notificationId, setNotificationId] = useState<string>('');
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [type, setType] = useState<'main' | 'interval' | 'onetime'>('main');
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [isClosing, setIsClosing] = useState(false);
    const [animationKey, setAnimationKey] = useState(0);
    const [isReady, setIsReady] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');
        if (id && ipcRenderer) {
            setNotificationId(id);
            ipcRenderer.send('request-notification-data', id);
            const handler = (_: any, data: any) => {
                setTitle(data.title || '提醒');
                setMessage(data.message || '');
                if (data.type) setType(data.type);
                if (data.theme) setTheme(data.theme);
                setIsClosing(false);
                setIsReady(true); 
                setAnimationKey(prev => prev + 1);
            };
            ipcRenderer.on('notification-data-response', handler);
            return () => { ipcRenderer.removeListener('notification-data-response', handler); };
        }
    }, []);

    useEffect(() => { document.body.style.backgroundColor = 'transparent'; return () => { document.body.style.backgroundColor = ''; }; }, []);

    useEffect(() => {
        const handleGlobalMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            if (ipcRenderer) {
                const newX = e.screenX - dragOffset.current.x;
                const newY = e.screenY - dragOffset.current.y;
                ipcRenderer.send('window-move', { x: newX, y: newY });
            }
        };
        const handleGlobalMouseUp = () => { setIsDragging(false); };
        if (isDragging) { window.addEventListener('mousemove', handleGlobalMouseMove); window.addEventListener('mouseup', handleGlobalMouseUp); }
        return () => { window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp); };
    }, [isDragging]);

    const handleDismiss = () => {
        setIsClosing(true);
        // setAnimationKey(prev => prev + 1); // 防止关闭时重新挂载导致动画闪回
        setTimeout(() => { if (ipcRenderer) { ipcRenderer.send('dismiss-notification', { id: notificationId }); } }, 300);
    };
    
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.target instanceof Element && e.target.closest('button')) return;
        if (e.button !== 0) return;
        setIsDragging(true);
        dragOffset.current = { x: e.clientX, y: e.clientY };
    };

    if (!isReady) return null;
    const isDark = theme === 'dark';
    const isMain = type === 'main';

    return (
        <div className="flex items-center justify-center min-h-screen p-4 select-none outline-none overflow-hidden">
             <style>{`
                html, body, #root { background: transparent !important; overflow: hidden; }
                *, *::before, *::after { outline: none !important; border-image: none !important; -webkit-tap-highlight-color: transparent !important; }
                :focus, :focus-visible, :focus-within { outline: none !important; box-shadow: none !important; }
                @keyframes patrol { 0% { left: 1.5rem; transform: scaleX(-1); } 49% { left: calc(100% - 6.5rem); transform: scaleX(-1); } 50% { left: calc(100% - 6.5rem); transform: scaleX(1); } 99% { left: 1.5rem; transform: scaleX(1); } 100% { left: 1.5rem; transform: scaleX(-1); } }
                @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
                @keyframes slideFadeIn { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
                @keyframes slideFadeOut { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(20px); } }
                @keyframes slide-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                @keyframes pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.5); } 70% { box-shadow: 0 0 0 15px rgba(37, 99, 235, 0); } 100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); } }
                .animate-fade-in { animation: slideFadeIn 0.3s cubic-bezier(0.2, 0.0, 0.2, 1) forwards; will-change: transform, opacity; }
                .notification-pulse { animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
                .animate-fade-out { animation: slideFadeOut 0.25s cubic-bezier(0.2, 0.0, 0.2, 1) forwards; will-change: transform, opacity; }
                .animate-slide-up { animation: slide-up 0.3s ease-out forwards; }
                @keyframes ring { 0% { transform: rotate(0); } 10% { transform: rotate(15deg); } 20% { transform: rotate(-15deg); } 30% { transform: rotate(15deg); } 40% { transform: rotate(-15deg); } 50% { transform: rotate(0); } 100% { transform: rotate(0); } }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.5); border-radius: 2px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
            `}</style>
            <div 
                key={animationKey} // 仅在数据更新时重置动画，关闭时不重置
                className={`rounded-3xl w-full h-full relative flex flex-col outline-none shadow-2xl border-2 ${isClosing ? 'animate-fade-out' : 'animate-fade-in notification-pulse'} ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-100'}`}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' } as React.CSSProperties}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onMouseDown={handleMouseDown}
            >
                <button 
                    onClick={handleDismiss}
                    className={`absolute top-3 right-3 z-50 p-2 rounded-full cursor-pointer transition-colors focus:outline-none focus:ring-0 ${isDark ? 'text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700' : 'text-slate-400 hover:text-slate-600 bg-gray-100 hover:bg-gray-200'}`}
                    title="关闭"
                    onMouseDown={(e) => e.stopPropagation()} 
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                {isMain ? (
                    <>
                        <div className={`relative h-28 w-full overflow-hidden flex items-center justify-center shrink-0 rounded-t-3xl`}>
                            <div className="absolute bottom-4 flex justify-center items-center" style={{ animation: 'patrol 10s linear infinite', width: '5rem' }}>
                                <div className="text-6xl filter drop-shadow-lg leading-none select-none" style={{ animation: 'bounce 0.6s ease-in-out infinite' }}>🚶</div>
                            </div>
                        </div>
                        <div className="flex-1 flex flex-col items-center justify-center p-6 pt-0 text-center w-full min-h-0">
                             <h3 className={`text-xl font-bold mb-2 shrink-0 ${isDark ? 'text-white' : 'text-slate-800'}`}>{title}</h3>
                             <div className="w-full relative max-h-32 overflow-y-auto custom-scrollbar break-all px-2" onMouseDown={(e) => e.stopPropagation()}>
                                <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{message.replace(/\\n/g, '\n')}</p>
                             </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className={`relative h-28 w-full overflow-hidden flex items-center justify-center shrink-0 rounded-t-3xl`}>
                            <div className="absolute bottom-4 flex justify-center items-center">
                                <div className="text-6xl select-none filter drop-shadow-lg" style={{ animation: 'ring 1s ease-in-out infinite' }}>⏰</div>
                            </div>
                        </div>
                        <div className="flex-1 flex flex-col items-center justify-center p-6 pt-0 text-center w-full min-h-0">
                             <h3 className={`text-xl font-bold mb-2 shrink-0 ${isDark ? 'text-white' : 'text-slate-800'}`}>{title}</h3>
                             <div className="w-full relative max-h-32 overflow-y-auto custom-scrollbar break-all px-2" onMouseDown={(e) => e.stopPropagation()}>
                                <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{message.replace(/\\n/g, '\n')}</p>
                             </div>
                        </div>
                    </>
                )}
                <div className="p-6 pt-2 flex justify-center shrink-0 rounded-b-3xl">
                    <button 
                        onClick={handleDismiss}
                        className={`text-white text-sm font-medium py-2 px-10 rounded-xl transition-colors shadow-lg focus:outline-none focus:ring-0 ${isDark ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/50' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'}`}
                        onMouseDown={(e) => e.stopPropagation()} 
                    >
                        我知道了
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- 主界面组件 ---
const MainView: React.FC = () => {
  const { 
      status, 
      toggleTimer, 
      timeLeft, 
      totalTime, 
      settings,
      // Update Context
      updateStatus,
      updateProgress,
      updateVersionInfo,
      updateErrorMsg,
      isUpdateModalOpen,
      isPortableUpdate,
      closeUpdateModal,
      startDownload,
      downloadPortable,
      restartApp,
      skipUpdate,
      remindLater
  } = useApp();
  const [activeTab, setActiveTab] = useState<'timer' | 'settings'>('timer');
  const [showCloseModal, setShowCloseModal] = useState(false);

  useEffect(() => {
      if (ipcRenderer) {
          const closeHandler = () => { setShowCloseModal(true); };
          ipcRenderer.on('show-close-confirm', closeHandler);
          return () => { 
              ipcRenderer.removeAllListeners('show-close-confirm');
          };
      }
  }, []);

  return (
    <div className="h-screen overflow-hidden flex items-center justify-center p-4 transition-colors duration-300 bg-gray-50 text-slate-900 dark:bg-[#0f172a] dark:text-e2e8f0">
      <div className="max-w-5xl w-full h-[90vh] md:h-[85vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-gray-200 dark:border-slate-800 flex flex-col md:flex-row transition-colors duration-300">
        <div className="w-full md:w-24 bg-gray-50 dark:bg-slate-950 border-b md:border-r border-gray-200 dark:border-slate-800 flex md:flex-col items-center justify-center md:justify-start p-4 gap-6 flex-shrink-0 transition-colors duration-300">
            <button 
                onClick={() => setActiveTab('timer')} 
                className={`p-3 rounded-xl transition-all outline-none focus:outline-none ${activeTab === 'timer' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 dark:shadow-blue-900/50' : 'text-slate-500 hover:bg-gray-200 dark:hover:bg-slate-900 hover:text-slate-700 dark:hover:text-slate-300'}`} 
                title="计时仪表盘"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
            <button 
                onClick={() => setActiveTab('settings')} 
                className={`p-3 rounded-xl transition-all outline-none focus:outline-none ${activeTab === 'settings' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 dark:shadow-blue-900/50' : 'text-slate-500 hover:bg-gray-200 dark:hover:bg-slate-900 hover:text-slate-700 dark:hover:text-slate-300'}`} 
                title="设置"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
        </div>
        <div className="flex-1 flex flex-col relative overflow-hidden bg-white dark:bg-slate-900 transition-colors duration-300">
           {/* Main Content Area - Hidden Overflow to let children handle scrolling */}
           <div className="flex-1 overflow-hidden p-2 md:p-6 relative">
              
              {/* Timer Tab */}
              <div className={`h-full w-full overflow-y-auto custom-scrollbar ${activeTab === 'timer' ? 'block' : 'hidden'}`}>
                  <div className="min-h-full flex flex-col items-center justify-center gap-8 md:gap-16 fade-in">
                      <div className="transform scale-90 md:scale-100 transition-transform duration-300"><CircularTimer timeLeft={timeLeft} totalTime={totalTime} status={status} /></div>
                      {!settings.activeHoursEnabled && (
                          <div className={`flex flex-col items-center gap-4 z-10 transition-opacity duration-300 ${status === 'alert_active' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                              <button onClick={toggleTimer} className={`px-10 py-3 rounded-2xl font-semibold text-lg shadow-xl transition-all transform hover:scale-105 active:scale-95 ${(status === 'running' || status === 'alert_active') ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-blue-500/30'}`}>{(status === 'running' || status === 'alert_active') ? '暂停' : (status === 'paused' ? '继续' : '启动')}</button>
                          </div>
                      )}
                      {settings.activeHoursEnabled && (<div className="text-sm text-slate-400 dark:text-slate-500 animate-pulse">已启用时段托管，正在自动运行中...</div>)}
                  </div>
              </div>

              {/* Settings Tab - Kept mounted to preserve scroll position */}
              <div className={`h-full w-full ${activeTab === 'settings' ? 'block' : 'hidden'}`}>
                  <SettingsPanel />
              </div>

           </div>
           {!ipcRenderer && <NotificationOverlay />}
        </div>
      </div>
      
      {/* Moved UpdateModal to use Context values */}
      <UpdateModal 
          isOpen={isUpdateModalOpen} 
          status={updateStatus} 
          versionInfo={updateVersionInfo || undefined}
          errorMsg={updateErrorMsg}
          progress={updateProgress}
          isPortable={isPortableUpdate}
          onClose={closeUpdateModal}
          onDownload={startDownload}
          onDownloadPortable={downloadPortable}
          onRestart={restartApp}
          onSkip={skipUpdate}
          onRemindLater={remindLater}
      />
      
      {/* Z-Index raised to 200 */}
      <CloseConfirmModal isOpen={showCloseModal} onClose={() => setShowCloseModal(false)} />
    </div>
  );
};

const AppContent: React.FC = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const isNotificationMode = searchParams.get('mode') === 'notification';
    if (isNotificationMode) return <StandaloneNotification />;
    return <MainView />;
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default App;