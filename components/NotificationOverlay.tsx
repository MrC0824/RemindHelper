import React, { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';

export const NotificationOverlay: React.FC = () => {
  const { showNotification, dismissNotification, notificationMessage, notificationTitle, activeAlerts } = useApp();
  const [shouldRender, setShouldRender] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  
  const [displayTitle, setDisplayTitle] = useState('');
  const [displayMessage, setDisplayMessage] = useState('');

  useEffect(() => {
    if (showNotification) {
      setShouldRender(true);
      setIsClosing(false);
      if (notificationTitle) setDisplayTitle(notificationTitle);
      if (notificationMessage) setDisplayMessage(notificationMessage);
    } else {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 600); 
      return () => clearTimeout(timer);
    }
  }, [showNotification, notificationTitle, notificationMessage]);

  const handleDismiss = () => {
      const id = Array.from(activeAlerts).pop();
      if (id) dismissNotification(id);
  };

  if (!shouldRender) return null;

  const isMainReminder = displayTitle === '起身走走';

  return (
    <div className="fixed bottom-6 right-6 z-[9999] pointer-events-none flex flex-col items-end gap-2">
      <style>{`
         @keyframes fadeIn { 0% { opacity: 0; transform: translateY(30px) scale(0.9); filter: blur(10px); } 100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); } }
         @keyframes fadeOut { 0% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); } 100% { opacity: 0; transform: translateY(30px) scale(0.95); filter: blur(10px); } }
         @keyframes patrol { 0% { left: 1rem; transform: scaleX(-1); } 49% { left: calc(100% - 4rem); transform: scaleX(-1); } 50% { left: calc(100% - 4rem); transform: scaleX(1); } 99% { left: 1rem; transform: scaleX(1); } 100% { left: 1rem; transform: scaleX(-1); } }
         @keyframes ring { 0% { transform: rotate(0); } 10% { transform: rotate(15deg); } 20% { transform: rotate(-15deg); } 30% { transform: rotate(15deg); } 40% { transform: rotate(-15deg); } 50% { transform: rotate(0); } 100% { transform: rotate(0); } }
         .animate-fade-in { animation: fadeIn 0.6s cubic-bezier(0.19, 1, 0.22, 1) forwards; }
         .animate-fade-out { animation: fadeOut 0.5s ease-in forwards; }
         .custom-scrollbar::-webkit-scrollbar { width: 4px; }
         .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.5); border-radius: 2px; }
         .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div 
        className={`pointer-events-auto border border-gray-200 dark:border-slate-700 rounded-3xl shadow-2xl w-80 sm:w-96 transform transition-all ${isClosing ? 'animate-fade-out' : 'animate-fade-in'} relative bg-white dark:bg-slate-800`}
        style={{ boxShadow: '0 20px 50px -12px rgba(0, 0, 0, 0.25)' }}
      >
        <button 
            onClick={handleDismiss}
            className="absolute top-3 right-3 z-50 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 p-1.5 rounded-full hover:bg-white/50 dark:hover:bg-black/20 transition-colors"
            title="关闭"
         >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
         </button>

        {isMainReminder ? (
            <div className="w-full flex flex-col">
                <div className="relative h-28 w-full overflow-hidden rounded-t-3xl">
                     <div className="absolute bottom-3" style={{ animation: 'patrol 10s linear infinite', width: '3rem' }}>
                          <div className="text-5xl filter drop-shadow-md animate-bounce leading-none">🚶</div>
                     </div>
                </div>
                
                <div className="p-6 pt-0 flex flex-col items-center text-center w-full">
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{displayTitle}</h3>
                    <div className="w-full px-2 mb-6 relative max-h-32 overflow-y-auto custom-scrollbar break-all">
                        <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed font-medium whitespace-pre-wrap">
                           {(displayMessage || "").replace(/\\n/g, '\n')}
                        </p>
                    </div>
                    <button 
                        onClick={handleDismiss}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-8 py-2.5 rounded-xl transition-colors shadow-lg shadow-blue-500/30 active:scale-95 w-full sm:w-auto"
                    >
                        我知道了
                    </button>
                </div>
            </div>
        ) : (
            <div className="p-6 flex flex-col items-center justify-center text-center pt-8 w-full">
                 <div className="text-6xl mb-4 select-none filter drop-shadow-md" style={{ animation: 'ring 1s ease-in-out infinite' }}>⏰</div>
                 <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{displayTitle}</h3>
                 <div className="w-full px-2 mb-6 relative max-h-32 overflow-y-auto custom-scrollbar break-all">
                     <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed font-medium whitespace-pre-wrap">
                        {displayMessage.replace(/\\n/g, '\n')}
                     </p>
                 </div>
                 <button 
                    onClick={handleDismiss}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-8 py-2.5 rounded-xl transition-colors shadow-lg shadow-blue-500/30 active:scale-95 w-full sm:w-auto"
                 >
                    我知道了
                 </button>
            </div>
        )}
      </div>
    </div>
  );
};