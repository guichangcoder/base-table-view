import { useEffect } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import type { FieldMetaLite } from '../../types';
import { getBaseToken, getBridge } from '../../services/appContext';
import { getTableCached } from '../../services/baseService';
import { HOST_TIMEOUT, METADATA_TIMEOUT, withTimeout } from '../../utils/timeout';

/**
 * 数据表「按钮」字段在前端的呈现。
 *
 * JSSDK 没有「触发按钮动作」的接口，按钮绑定的工作流只能由数据表自身执行。
 * 应用模式宿主不支持 ui.showRecordDetailDialog / ui.switchToTable 这类 UI 能力
 * （宿主未实现时默认实现直接抛 NotSupportedError），此前点击会触发这些宿主 UI 调用，
 * 实测会导致插件 iframe 被重建而整页白屏。因此这里不再调用任何宿主 UI 接口，
 * 只做一件事：在新标签页打开该记录在真实多维表格中的卡片，让用户点真实按钮。
 */

/** 按钮配色索引（与数据表按钮调色板一致：1 红 2 橙 3 黄 4 绿 5 蓝 6 紫） */
const BUTTON_COLORS: Record<number, string> = {
  1: '#d83931',
  2: '#f59a23',
  3: '#d9990c',
  4: '#2ea121',
  5: '#3370ff',
  6: '#7f3bf5',
};

const DEFAULT_BUTTON_COLOR = '#3370ff';

function buttonColor(color?: number): string {
  if (!color) return DEFAULT_BUTTON_COLOR;
  return BUTTON_COLORS[color] ?? DEFAULT_BUTTON_COLOR;
}

/** 每个数据表的首个视图 id 缓存：生成数据表链接需要 tableId + viewId */
const viewIdCache = new Map<string, string>();

async function firstViewId(tableId: string): Promise<string> {
  const cached = viewIdCache.get(tableId);
  if (cached !== undefined) return cached;
  let id = '';
  try {
    const table = await getTableCached(tableId);
    const views = await withTimeout(
      Promise.resolve(table.getViewMetaList()),
      METADATA_TIMEOUT,
      'getViewMetaList',
    );
    id = String((views as any[])?.[0]?.id ?? '');
  } catch {
    id = '';
  }
  viewIdCache.set(tableId, id);
  return id;
}

/** 兜底：getBitableUrl 不可用时，用 baseToken + 宿主域名自行拼一个数据表链接 */
function manualUrl(tableId: string, viewId: string, recordId: string): string {
  const baseToken = getBaseToken();
  if (!baseToken) return '';
  let origin = '';
  try {
    origin = new URL(document.referrer).origin;
  } catch {
    origin = '';
  }
  if (!origin) return '';
  const query = new URLSearchParams({ table: tableId });
  if (viewId) query.set('view', viewId);
  if (recordId) query.set('record', recordId);
  return `${origin}/base/${baseToken}?${query.toString()}`;
}

/**
 * 在新标签页打开该记录在真实多维表格中的卡片。
 * 成功返回 true（此时用户可在原表中点击真实按钮）。
 */
async function openRealRecord(tableId: string, recordId: string): Promise<boolean> {
  const viewId = await firstViewId(tableId);
  let url = '';
  try {
    const bridge = getBridge() as any;
    if (bridge && typeof bridge.getBitableUrl === 'function') {
      url = String(
        (await withTimeout(
          Promise.resolve(bridge.getBitableUrl({ tableId, viewId, recordId })),
          HOST_TIMEOUT,
          'getBitableUrl',
        )) || '',
      );
    }
  } catch {
    url = '';
  }
  if (!url) url = manualUrl(tableId, viewId, recordId);
  if (!url) return false;
  const win = window.open(url, '_blank');
  if (!win) {
    Toast.warning('浏览器拦截了新窗口，请允许弹出窗口后重试');
    return false;
  }
  win.opener = null;
  return true;
}

interface Props {
  tableId?: string;
  /** 记录 id（新增态还没有记录，无法执行按钮动作） */
  recordId?: string;
  field: FieldMetaLite;
  /** 按钮文案：优先用配置里的展示别名 */
  title?: string;
}

export function RecordButton({ tableId, recordId, field, title }: Props) {
  const text = title || field.buttonTitle || field.name || '按钮';
  const bg = buttonColor(field.buttonColor);

  // 提前取好 viewId，缩短点击后的等待，避免新标签页被浏览器拦截
  useEffect(() => {
    if (tableId) void firstViewId(tableId);
  }, [tableId]);

  const handleClick = async () => {
    if (!tableId) {
      Toast.warning('尚未配置数据表，无法执行按钮动作');
      return;
    }
    if (!recordId) {
      Toast.info('请先保存记录，保存后即可点击按钮执行');
      return;
    }
    if (await openRealRecord(tableId, recordId)) {
      Toast.info('已在新标签页打开该记录：请点击其中的按钮执行');
      return;
    }
    Toast.warning('无法生成数据表链接，请手动回到多维表格中点击该按钮');
  };

  return (
    <Button
      className="record-button"
      theme="solid"
      style={{ background: bg, borderColor: bg, color: '#fff' }}
      onClick={() => void handleClick()}
    >
      {text}
    </Button>
  );
}
