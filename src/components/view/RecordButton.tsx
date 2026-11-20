import { useEffect, useState } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldMetaLite } from '../../types';
import { getBaseToken, getUi } from '../../services/appContext';
import { BUTTON_TYPE, getTableCached, listFieldsCached } from '../../services/baseService';
import { getRecordById } from '../../services/recordService';
import { formatCellValue } from '../../utils/valueConverter';
import { HOST_TIMEOUT, METADATA_TIMEOUT, withTimeout } from '../../utils/timeout';

/**
 * 数据表「按钮」字段在前端的呈现。
 *
 * JSSDK 没有触发按钮动作的接口，按钮绑定的自动化/工作流只能由数据表执行。
 * 因此按优先级把点击落到「真实按钮」上：
 *   1. 配置了「自动化 Webhook 地址」时，读出本记录各字段的值并 POST 到该地址
 *      （自动化触发条件选「接收到 webhook 时」，即可在流程里引用这些字段）；
 *   2. 未配置时尝试调用宿主原生 UI（showFieldValueEditor / showRecordDetailDialog），在其中点真实按钮；
 *   3. 宿主不支持时给出明确提示，不跳转数据表，也不静默失败。
 * 宿主未实现某个 UI 接口时会抛 NotSupportedError 或 Promise 永不 settle，故调用带超时兜底。
 */

const FT = FieldType as any;

/** 文本化会丢信息的字段类型：除文本外再透传一份原始结构 */
const RAW_KEEP_TYPES = new Set<number>([FT.User, FT.CreatedUser, FT.ModifiedUser, FT.Attachment]);

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

/** webhook 触发结果：ok=宿主返回成功；sent=已发出但读不到响应；failed=发不出去 */
type TriggerResult = 'ok' | 'sent' | 'failed';

/**
 * POST 数据表自动化的 webhook（自动化触发条件选「接收到 webhook 时」）。
 *
 * 先用 JSON 请求：跨域时浏览器会先发预检，预检不通过则请求根本不会发出（不会误触发），
 * 此时再退化为 no-cors 简单请求（一定发得出去，但读不到响应），因此不会重复触发。
 */
async function postWebhook(url: string, payload: Record<string, unknown>): Promise<TriggerResult> {
  const body = JSON.stringify(payload);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return res.ok ? 'ok' : 'failed';
  } catch {
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body,
      });
      return 'sent';
    } catch {
      return 'failed';
    }
  }
}

interface RecordPayload {
  /** 字段名 → 展示文本 */
  fields: Record<string, string>;
  /** 字段名 → 原始结构（仅人员/附件类字段） */
  raw: Record<string, unknown>;
}

/** 附件字段：在原始结构（name/size/type/token）上追加临时下载链接，拿不到链接时留空字符串 */
async function withAttachmentUrls(
  tableId: string,
  recordId: string,
  fieldId: string,
  value: unknown,
): Promise<unknown> {
  const items = Array.isArray(value) ? value : [value];
  const tokens = items.map((it: any) => String(it?.token ?? '')).filter(Boolean);
  let urls: string[] = [];
  if (tokens.length) {
    try {
      const table: any = await getTableCached(tableId);
      urls = await withTimeout(
        Promise.resolve(table.getCellAttachmentUrls(tokens, fieldId, recordId)),
        METADATA_TIMEOUT,
        'getCellAttachmentUrls',
      );
    } catch {
      urls = [];
    }
  }
  return items.map((it: any, i: number) =>
    it && typeof it === 'object' ? { ...it, url: urls[i] ?? '' } : it,
  );
}

/**
 * 读取本记录的值：`fields` 为「字段名 → 文本」；人员/附件类字段另外在 `raw` 里透传原始结构。
 * 按钮字段本身没有值，跳过。读取失败不阻塞触发，退化为只发送记录标识，由自动化侧按 recordId 自行查找。
 */
async function collectRecordPayload(tableId: string, recordId: string): Promise<RecordPayload> {
  const fields: Record<string, string> = {};
  const raw: Record<string, unknown> = {};
  try {
    const [metas, record] = await Promise.all([
      listFieldsCached(tableId),
      getRecordById(tableId, recordId),
    ]);
    const cells = record.fields ?? {};
    for (const meta of metas) {
      if (meta.isButton || meta.type === BUTTON_TYPE) continue;
      const value = cells[meta.id];
      fields[meta.name] = formatCellValue(value, meta);
      if (RAW_KEEP_TYPES.has(meta.type) && value !== null && value !== undefined) {
        raw[meta.name] =
          meta.type === FT.Attachment
            ? await withAttachmentUrls(tableId, recordId, meta.id, value)
            : value;
      }
    }
  } catch (e) {
    console.warn('[RecordButton] 读取记录字段失败，仅发送记录标识:', e);
  }
  return { fields, raw };
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

  if (viewId && typeof ui.showFieldValueEditor === 'function') {
    if (await call('showFieldValueEditor', () => ui.showFieldValueEditor({ tableId, viewId, recordId, fieldId }))) {
      return true;
    }
  }
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

interface Props {
  tableId?: string;
  /** 记录 id（新增态还没有记录，无法执行按钮动作） */
  recordId?: string;
  field: FieldMetaLite;
  /** 按钮文案：优先用配置里的展示别名 */
  title?: string;
  /** 自动化 Webhook 地址（配置在「字段配置」的按钮触发列） */
  webhookUrl?: string;
}

export function RecordButton({ tableId, recordId, field, title, webhookUrl }: Props) {
  const text = title || field.buttonTitle || field.name || '按钮';
  const bg = buttonColor(field.buttonColor);
  const [busy, setBusy] = useState(false);

  // 提前取好 viewId，缩短点击后的等待
  useEffect(() => {
    if (tableId) void firstViewId(tableId);
  }, [tableId]);

  const fireWebhook = async (url: string): Promise<boolean> => {
    const viewId = tableId ? await firstViewId(tableId) : '';
    const { fields, raw } =
      tableId && recordId
        ? await collectRecordPayload(tableId, recordId)
        : { fields: {}, raw: {} };
    const result = await postWebhook(url, {
      plugin: 'base-table-view',
      event: 'button.click',
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      baseToken: getBaseToken(),
      tableId,
      viewId,
      recordId,
      fieldId: field.id,
      buttonTitle: text,
      timestamp: new Date().toISOString(),
      fields,
      raw,
    });
    if (result === 'ok') {
      Toast.success('已触发该按钮对应的自动化流程');
      return true;
    }
    if (result === 'sent') {
      Toast.info('已发送触发请求（跨域限制下无法读取执行结果）');
      return true;
    }
    Toast.error('按钮触发失败：无法访问该 Webhook 地址，请检查地址是否正确');
    return false;
  };

  const handleClick = async () => {
    if (!tableId) {
      Toast.warning('尚未配置数据表，无法执行按钮动作');
      return;
    }
    if (!recordId) {
      Toast.info('请先保存记录，保存后即可点击按钮执行');
      return;
    }

    setBusy(true);
    try {
      // 1) 配置了自动化 webhook：直接在插件内触发，等同于点数据表里的按钮
      const url = (webhookUrl ?? '').trim();
      if (url) {
        await fireWebhook(url);
        return;
      }

      const viewId = await firstViewId(tableId);

      // 2) 未配置 webhook：调用宿主原生按钮 UI（不跳转数据表）
      if (await tryHostButtonUi(tableId, recordId, field.id, viewId)) {
        Toast.info('已打开数据表原生按钮界面，请点击其中的按钮执行');
        return;
      }

      Toast.warning('该按钮尚未配置「自动化 Webhook 地址」，请在配置页「3. 字段配置」中填写后使用');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      className="record-button"
      theme="solid"
      loading={busy}
      style={{ background: bg, borderColor: bg, color: '#fff' }}
      onClick={() => void handleClick()}
    >
      {text}
    </Button>
  );
}
