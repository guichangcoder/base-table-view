import { useEffect, useState } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { FieldType } from '@lark-base-open/js-sdk';
import type { ButtonHttpConfig, FieldMetaLite, HttpBodyFormat } from '../../types';
import { getBaseToken } from '../../services/appContext';
import { BUTTON_TYPE, getTableCached, listFieldsCached } from '../../services/baseService';
import { getRecordById } from '../../services/recordService';
import { formatCellValue } from '../../utils/valueConverter';
import { METADATA_TIMEOUT, withTimeout } from '../../utils/timeout';

/**
 * 数据表「按钮」字段在前端的呈现。
 *
 * JSSDK 没有触发按钮动作的接口，按钮绑定的自动化/工作流只能由数据表执行。
 * 因此点击按钮时按配置的 HTTP 请求发出触发（配置见「字段配置」的按钮动作弹窗）：
 *   1. 配置了按钮动作：读取本记录字段并按配置的方法/地址/参数/请求头/请求体发送；
 *   2. 未配置：给出明确提示，引导到配置页；
 * 不调用宿主的字段编辑器/记录详情弹窗——在应用模式插件里这类接口会让宿主容器渲染失败（整页白屏）。
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

/** 请求结果：ok=宿主返回成功；sent=已发出但读不到响应；failed=发不出去 */
type TriggerResult = 'ok' | 'sent' | 'failed';

interface SendOutcome {
  result: TriggerResult;
  /** 降级成 no-cors 简单请求：自定义请求头被浏览器丢弃 */
  degraded: boolean;
}

const CONTENT_TYPE: Record<HttpBodyFormat, string> = {
  json: 'application/json',
  urlencoded: 'application/x-www-form-urlencoded',
  text: 'text/plain',
};

/** 模板变量的取值上下文 */
interface TemplateContext {
  /** 字段名 → 展示文本 */
  fields: Record<string, string>;
  /** 字段名 → 原始结构（人员/附件类字段） */
  raw: Record<string, unknown>;
  /** 字段 id → 展示文本 */
  byId: Record<string, string>;
  /** 字段 id → 原始结构 */
  rawById: Record<string, unknown>;
  /** 展示别名 → 字段 id */
  aliasToId: Record<string, string>;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name);
}

/** 请求参数拼到地址上（地址自带 ? 时用 & 续接） */
function buildUrl(url: string, params?: Array<{ k: string; v: string }>): string {
  const pairs = (params ?? []).filter((p) => p.k.trim());
  if (!pairs.length) return url;
  const qs = pairs
    .map((p) => `${encodeURIComponent(p.k.trim())}=${encodeURIComponent(p.v ?? '')}`)
    .join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

/** 按请求体格式转义占位符的值，避免 JSON 被引号/换行破坏 */
function escapeValue(text: string, format: HttpBodyFormat): string {
  if (format === 'json') return JSON.stringify(text).slice(1, -1);
  if (format === 'urlencoded') return encodeURIComponent(text);
  return text;
}

/** 渲染 {{字段名}} / {{字段别名}}；未匹配的占位符原样保留 */
function renderTemplate(template: string, format: HttpBodyFormat, ctx: TemplateContext): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, token: string) => {
    const key = token.trim();
    let fieldId = '';
    if (key in ctx.fields) {
      fieldId = '';
    } else if (ctx.aliasToId[key]) {
      fieldId = ctx.aliasToId[key];
    } else {
      return all;
    }
    const raw = fieldId ? ctx.rawById[fieldId] : ctx.raw[key];
    if (raw !== undefined && raw !== null) {
      return escapeValue(JSON.stringify(raw), format);
    }
    const text = fieldId ? ctx.byId[fieldId] : ctx.fields[key];
    return text === undefined ? all : escapeValue(text, format);
  });
}

/**
 * 按配置发送 HTTP 请求（对齐工作流「发送 HTTP 请求」节点）。
 *
 * 浏览器限制：带自定义请求头或非简单 Content-Type 时会先发跨域预检，
 * 预检不通过则请求根本不会发出（不会误触发），此时退化为 no-cors 简单请求
 * （一定发得出去，但读不到响应、自定义头会被丢弃）。
 */
async function sendRequest(
  cfg: ButtonHttpConfig,
  autoPayload: Record<string, unknown>,
  ctx: TemplateContext,
): Promise<SendOutcome> {
  const method = (cfg.method || 'POST').toUpperCase();
  const url = buildUrl(cfg.url.trim(), cfg.params);
  const headers: Record<string, string> = {};
  (cfg.headers ?? []).forEach((h) => {
    const key = (h.k ?? '').trim();
    if (key) headers[key] = h.v ?? '';
  });
  const customHeader = Object.keys(headers).some((k) => k.toLowerCase() !== 'content-type');

  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (cfg.bodyMode === 'template') {
      const format = cfg.bodyFormat ?? 'json';
      body = renderTemplate(cfg.body ?? '', format, ctx);
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = CONTENT_TYPE[format];
    } else {
      body = JSON.stringify(autoPayload);
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    }
  }

  try {
    const res = await fetch(url, { method, headers, body });
    return { result: res.ok ? 'ok' : 'failed', degraded: false };
  } catch {
    // no-cors 只允许简单方法与简单 Content-Type，其余自定义头会被浏览器丢弃
    const simpleHeaders: Record<string, string> = {};
    const ctKey = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
    const ct = ctKey ? headers[ctKey] : '';
    if (ct === 'text/plain' || ct === 'application/x-www-form-urlencoded') {
      simpleHeaders['Content-Type'] = ct;
    }
    try {
      await fetch(url, { method, mode: 'no-cors', headers: simpleHeaders, body });
      return { result: 'sent', degraded: customHeader };
    } catch {
      return { result: 'failed', degraded: false };
    }
  }
}

interface RecordPayload {
  /** 字段名 → 展示文本 */
  fields: Record<string, string>;
  /** 字段名 → 原始结构（仅人员/附件类字段） */
  raw: Record<string, unknown>;
  /** 字段 id → 展示文本（模板用别名引用时需要） */
  byId: Record<string, string>;
  /** 字段 id → 原始结构 */
  rawById: Record<string, unknown>;
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
  const byId: Record<string, string> = {};
  const rawById: Record<string, unknown> = {};
  try {
    const [metas, record] = await Promise.all([
      listFieldsCached(tableId),
      getRecordById(tableId, recordId),
    ]);
    const cells = record.fields ?? {};
    for (const meta of metas) {
      if (meta.isButton || meta.type === BUTTON_TYPE) continue;
      const value = cells[meta.id];
      const text = formatCellValue(value, meta);
      fields[meta.name] = text;
      byId[meta.id] = text;
      if (RAW_KEEP_TYPES.has(meta.type) && value !== null && value !== undefined) {
        const kept =
          meta.type === FT.Attachment
            ? await withAttachmentUrls(tableId, recordId, meta.id, value)
            : value;
        raw[meta.name] = kept;
        rawById[meta.id] = kept;
      }
    }
  } catch (e) {
    console.warn('[RecordButton] 读取记录字段失败，仅发送记录标识:', e);
  }
  return { fields, raw, byId, rawById };
}

interface Props {
  tableId?: string;
  /** 记录 id（新增态还没有记录，无法执行按钮动作） */
  recordId?: string;
  field: FieldMetaLite;
  /** 按钮文案：优先用配置里的展示别名 */
  title?: string;
  /** 按钮动作配置（配置在「字段配置」的按钮动作弹窗） */
  http?: ButtonHttpConfig;
  /** 展示别名映射（字段 id → 别名），模板里用 {{别名}} 引用字段时需要 */
  fieldLabels?: Record<string, string>;
}

export function RecordButton({ tableId, recordId, field, title, http, fieldLabels }: Props) {
  const text = title || field.buttonTitle || field.name || '按钮';
  const bg = buttonColor(field.buttonColor);
  const [busy, setBusy] = useState(false);

  // 提前取好 viewId，缩短点击后的等待
  useEffect(() => {
    if (tableId) void firstViewId(tableId);
  }, [tableId]);

  const fireRequest = async (cfg: ButtonHttpConfig): Promise<boolean> => {
    const viewId = tableId ? await firstViewId(tableId) : '';
    const payload: RecordPayload =
      tableId && recordId
        ? await collectRecordPayload(tableId, recordId)
        : { fields: {}, raw: {}, byId: {}, rawById: {} };
    const autoPayload = {
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
      fields: payload.fields,
      raw: payload.raw,
    };
    const aliasToId: Record<string, string> = {};
    Object.entries(fieldLabels ?? {}).forEach(([id, alias]) => {
      if (alias) aliasToId[alias] = id;
    });
    const { result, degraded } = await sendRequest(cfg, autoPayload, {
      ...payload,
      aliasToId,
    });
    if (result === 'ok') {
      Toast.success('已发送请求');
      return true;
    }
    if (result === 'sent') {
      Toast.info(
        degraded
          ? '已发送请求（跨域限制下无法读取结果，自定义请求头未生效）'
          : '已发送请求（跨域限制下无法读取响应结果）',
      );
      return true;
    }
    Toast.error('按钮触发失败：无法访问该请求地址，请检查地址与跨域设置');
    return false;
  };

  const handleClick = async () => {
    try {
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
        if (http && http.url.trim()) {
          await fireRequest(http);
          return;
        }
        Toast.warning('该按钮尚未配置动作，请在配置页「3. 字段配置」中点击「配置」后使用');
      } finally {
        setBusy(false);
      }
    } catch (e) {
      // 任何异常都只在本组件内消化，避免冒泡到宿主容器导致整页渲染失败
      console.error('[RecordButton] 按钮执行异常:', e);
      setBusy(false);
      Toast.error('按钮执行出现异常，请检查按钮动作配置（详见控制台日志）');
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
