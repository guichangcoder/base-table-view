import { useEffect } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import type { FieldMetaLite } from '../../types';
import { getBaseToken, getBridge, getUi } from '../../services/appContext';
import { getTableCached } from '../../services/baseService';
import { HOST_TIMEOUT, METADATA_TIMEOUT, withTimeout } from '../../utils/timeout';

/**
 * 数据表「按钮」字段在前端的呈现。
 *
 * JSSDK 没有「触发按钮动作 / 执行工作流」的接口，按钮动作只能由数据表自身执行，
 * 因此点击时调用宿主原生 UI，把用户带到这个真实按钮上：
 *   1. ui.showFieldValueEditor —— 打开该按钮字段的值编辑器，等同于在数据表里点这个按钮；
 *   2. ui.showRecordDetailDialog —— 打开原生记录详情（尽量只显示该按钮字段），在其中点击按钮；
 *   3. bridge.getBitableUrl —— 前两者都不可用时，新标签页打开该记录的真实数据表卡片；
 *   4. 全都不行时给出明确提示，不静默失败。
 * 每一步都带超时与异常兜底：宿主未实现该接口时会抛 NotSupportedError 或 Promise 永不 settle，
 * 否则表现为「点击没反应」。
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

/** 每个数据表的首个视图 id 缓存：宿主 UI 与生成数据表链接都需要 viewId */
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

/** 调用宿主原生 UI，返回 true 表示已经打开真实按钮、用户可在此处点击执行 */
async function tryHostButtonUi(
  tableId: string,
  recordId: string,
  fieldId: string,
  viewId: string,
): Promise<boolean> {
  const ui = getUi() as any;
  if (!ui) return false;

  const call = async (label: string, fn: () => any): Promise<boolean> => {
    try {
      const ok = await withTimeout(Promise.resolve(fn()), HOST_TIMEOUT, label);
      return ok !== false;
    } catch {
      return false;
    }
  };

  // 1) 该按钮字段的值编辑器：最接近「在数据表里点这个按钮」
  if (viewId && typeof ui.showFieldValueEditor === 'function') {
    if (await call('showFieldValueEditor', () => ui.showFieldValueEditor({ tableId, viewId, recordId, fieldId }))) {
      return true;
    }
  }
  // 2) 原生记录详情（只显示该按钮字段），在其中点击真实按钮
  if (typeof ui.showRecordDetailDialog === 'function') {
    if (await call('showRecordDetailDialog', () => ui.showRecordDetailDialog({ tableId, recordId, fieldIdList: [fieldId] }))) {
      return true;
    }
    if (await call('showRecordDetailDialog', () => ui.showRecordDetailDialog({ tableId, recordId }))) {
      return true;
    }
  }
  return false;
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

/** 在新标签页打开该记录在真实多维表格中的卡片（保证可用的一级兜底） */
async function openRealRecord(tableId: string, viewId: string, recordId: string): Promise<boolean> {
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

    const viewId = await firstViewId(tableId);

    // 1) 宿主原生按钮 UI：点它等同于在数据表里点这个按钮
    if (await tryHostButtonUi(tableId, recordId, field.id, viewId)) {
      Toast.info('已打开数据表原生按钮界面，请点击其中的按钮执行');
      return;
    }

    // 2) 兜底：新标签页打开真实数据表中的该记录
    if (await openRealRecord(tableId, viewId, recordId)) {
      Toast.info('已在新标签页打开该记录：请点击其中的按钮执行');
      return;
    }

    Toast.warning('当前宿主无法打开数据表，请手动回到多维表格中点击该按钮');
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
