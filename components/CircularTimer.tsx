import React from 'react';
import { formatTime } from '@/utils/timeUtils';

interface CircularTimerProps {
  timeLeft: number;
  totalTime: number;
  status: string;
}

const CircularTimer: React.FC<CircularTimerProps> = ({ timeLeft, totalTime, status }) => {
  const radius = 120;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  
  const progress = totalTime > 0 ? timeLeft / totalTime : 0;
  const strokeDashoffset = circumference - progress * circumference;

  let strokeColor = 'stroke-blue-500';
  if (status === 'waiting') strokeColor = 'stroke-purple-500';
  else if (status === 'paused') strokeColor = 'stroke-gray-500';
  else if (status === 'alert_active') strokeColor = 'stroke-green-500';
  else if (timeLeft < 60) strokeColor = 'stroke-red-500';
  else if (timeLeft < totalTime * 0.25) strokeColor = 'stroke-orange-500';

  const getStatusText = (s: string) => {
    switch(s) {
      case 'idle': return '空闲';
      case 'running': return '运行中';
      case 'paused': return '已暂停';
      case 'waiting': return '等待时段';
      case 'alert_active': return '待确认';
      default: return s;
    }
  };

  const timeString = formatTime(timeLeft);
  const isLongText = timeString.length > 5;

  return (
    <div className="relative flex items-center justify-center">
      <svg
        height={radius * 2}
        width={radius * 2}
        className="rotate-[-90deg] transition-all duration-500"
      >
        <circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className="text-gray-200 dark:text-slate-800 transition-colors duration-300"
        />
        <circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className={`${strokeColor} transition-all duration-1000 ease-linear`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`${isLongText ? 'text-3xl' : 'text-4xl'} font-bold font-mono text-slate-800 dark:text-slate-100 tabular-nums transition-colors duration-300`}>
          {timeString}
        </span>
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-2 uppercase tracking-widest transition-colors duration-300">
            {getStatusText(status)}
        </span>
      </div>
    </div>
  );
};

export default CircularTimer;