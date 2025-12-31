import { TimeRange, WorkMode } from "@/types";

// --- 格式化工具函数 ---

export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds > 359999) {
    return ">99h";
  }

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const formatDateTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

// --- 节假日数据管理逻辑 (升级版) ---

const holidaysCache: Set<string> = new Set();
// 记录已经成功获取过数据的年份 (Set<number>)
const fetchedYears: Set<number> = new Set(); 
let isFetching: boolean = false; 

/**
 * 内部辅助函数：获取特定年份的节假日并追加到缓存
 */
const fetchSpecificYear = async (year: number) => {
  // 如果该年份已经成功获取过，直接跳过
  if (fetchedYears.has(year)) return;

  console.log(`[TimeUtils] Fetching holidays for year ${year}...`);
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`);
    
    // 如果网络错误或文件不存在(例如明年数据尚未发布)，抛出错误以便后续重试
    if (!res.ok) throw new Error(`Network response was not ok for year ${year}`);
    
    const data = await res.json();
    
    if (data && data.days && Array.isArray(data.days)) {
      // 升级点：不再 clear()，而是追加数据，实现多年份数据共存
      data.days.forEach((d: any) => {
        if (d.isOffDay) holidaysCache.add(d.date);
      });
      
      // 标记该年份已成功获取
      fetchedYears.add(year);
      console.log(`[TimeUtils] Updated holidays for ${year}. Total cache size: ${holidaysCache.size}`);
    }
  } catch (e) {
    console.warn(`[TimeUtils] Failed to fetch holidays for ${year} (might not be released yet):`, e);
    // 失败时不加入 fetchedYears，这样下次循环还会尝试获取
  }
};

/**
 * 更新节假日数据 (包含预加载逻辑)
 */
export const updateHolidays = async () => {
   if (isFetching) return;
   
   isFetching = true;
   try {
       const now = new Date();
       const currentYear = now.getFullYear();

       // 1. 优先获取当年的数据
       await fetchSpecificYear(currentYear);

       // 2. 预加载策略：如果是 12 月 (getMonth() 返回 11)，尝试预加载明年数据
       if (now.getMonth() === 11) {
           await fetchSpecificYear(currentYear + 1);
       }
   } finally {
       isFetching = false;
   }
}

export const isWorkDay = (mode: WorkMode, skipHolidays: boolean, isBigWeek: boolean): boolean => {
    const now = new Date();
    const currentYear = now.getFullYear();

    // 0. 自动更新检查
    // 如果当前年份还没有在“已获取列表”中，触发更新
    if (!fetchedYears.has(currentYear)) {
        updateHolidays();
    }
    
    // 1. Check Holidays
    if (skipHolidays) {
        // Generate today's date string in YYYY-MM-DD format
        const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
        
        // --- 验证测试区 START (已保留) ---
        // 想要验证“跳过法定节假日”功能时，请取消下面这行代码的注释。
        // 这会强制把“今天”加入缓存，让应用认为今天是节假日。
        
        // holidaysCache.add(dateStr); // <--- 测试时取消此行注释，测试完记得注释回去
        
        // --- 验证测试区 END ---

        if (holidaysCache.has(dateStr)) {
            // It is a holiday, so it is NOT a work day
            return false;
        }
    }

    const day = now.getDay(); // 0 is Sunday, 6 is Saturday
    
    // 2. Check Work Mode
    if (mode === 'everyday') return true;
    
    if (mode === 'weekend') {
        // Only run on Sat (6) and Sun (0)
        return day === 0 || day === 6;
    }
    
    if (mode === 'big-small') {
        // Sunday is rest
        if (day === 0) return false;
        // Saturday depends on Big/Small week setting
        if (day === 6) return isBigWeek; // If big week, work on Sat; if small week, rest
        // Mon-Fri are work days
        return true;
    }
    
    return true;
}

// --- 其他判断逻辑 ---

export const isWithinActiveHours = (ranges: TimeRange[]): boolean => {
  if (!ranges || ranges.length === 0) return true;

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  return ranges.some(range => {
    if (!range.start || !range.end) return false;

    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);

    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;

    if (endTime > startTime) {
      return currentTime >= startTime && currentTime < endTime;
    } else {
      // Cross-midnight range (e.g., 22:00 - 06:00)
      return currentTime >= startTime || currentTime < endTime;
    }
  });
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 9);
};