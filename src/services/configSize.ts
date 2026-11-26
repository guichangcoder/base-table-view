import {
  CONFIG_VERSION,
  emptyConfig,
  type ButtonDisableRule,
  type ButtonHttpConfig,
  type DocConfig,
  type DocMapItem,
  type DocMapping,
  type DocSource,
  type DocSubConfig,
  type HttpBodyFormat,
  type HttpPair,
  type PluginData,
  type FieldConfig,
  type GroupConfig,
  type LinkDisplayConfig,
} from '../types';

/**
 * 契约 6：customConfig 有 10240 字节上限。
 * 本工程的配置结构天然只保存 fieldId + 用户决策（不存字段名/类型/选项），
 * 这里再做一次剥空处理，并给出字节估算用于保存前诊断。
 */

export function estimateConfigBytes(data: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(data)).length;
  } catch {
    return 0;
  }
}

const HTTP_BODY_FORMATS: HttpBodyFormat[] = ['json', 'urlencoded', 'text'];

/** 禁用条件支持的运算符（复用筛选条件集合） */
const DISABLE_OPERATORS: ButtonDisableRule['operator'][] = [
  'contains',
  'is',
  'isNotEmpty',
  'isGreater',
  'isLess',
];

function isDisableOperator(v: unknown): v is ButtonDisableRule['operator'] {
  return DISABLE_OPERATORS.includes(v as ButtonDisableRule['operator']);
}

/** 禁用条件瘦身：丢弃字段为空的项，非法运算符回退 is，值统一成字符串 */
function compactDisableRules(rules?: ButtonDisableRule[]): ButtonDisableRule[] {
  return (rules ?? [])
    .filter((r) => !!r && String(r.fieldId ?? '').trim())
    .map((r) => {
      const operator = isDisableOperator(r.operator) ? r.operator : 'is';
      return {
        fieldId: String(r.fieldId).trim(),
        operator,
        value: operator === 'isNotEmpty' ? '' : String(r.value ?? ''),
      };
    });
}

function compactPairs(pairs?: HttpPair[]): HttpPair[] {
  return (pairs ?? [])
    .filter((p) => !!p && String(p.k ?? '').trim())
    .map((p) => ({ k: String(p.k).trim(), v: String(p.v ?? '') }));
}

/** 按钮 HTTP 配置瘦身：地址为空视为未配置，整块丢弃 */
function compactHttp(h?: ButtonHttpConfig): ButtonHttpConfig | undefined {
  const url = (h?.url ?? '').trim();
  if (!url) return undefined;
  const template = h?.bodyMode === 'template';
  const out: ButtonHttpConfig = {
    method: (h?.method || 'POST').toUpperCase(),
    url,
    bodyMode: template ? 'template' : 'auto',
  };
  const params = compactPairs(h?.params);
  if (params.length) out.params = params;
  const headers = compactPairs(h?.headers);
  if (headers.length) out.headers = headers;
  if (template) {
    out.bodyFormat = HTTP_BODY_FORMATS.includes(h?.bodyFormat as HttpBodyFormat)
      ? (h?.bodyFormat as HttpBodyFormat)
      : 'json';
    out.body = String(h?.body ?? '');
  }
  const rules = compactDisableRules(h?.disableRules);
  if (rules.length) out.disableRules = rules;
  const hint = (h?.disableHint ?? '').trim();
  if (hint) out.disableHint = hint;
  if (h?.confirmBeforeSend) out.confirmBeforeSend = true;
  const confirmText = (h?.confirmText ?? '').trim();
  if (confirmText) out.confirmText = confirmText;
  return out;
}

function compactField(f: FieldConfig): FieldConfig {
  const out: FieldConfig = { fieldId: f.fieldId, visible: !!f.visible };
  if (f.required) out.required = true;
  if (f.readonly) out.readonly = true;
  if (f.label && f.label.trim()) out.label = f.label.trim();
  if (f.asButton !== undefined) out.asButton = !!f.asButton;
  const http = compactHttp(f.http);
  if (http) out.http = http;
  if (f.emphasis) {
    const e: FieldConfig['emphasis'] = {};
    if (f.emphasis.bold) e.bold = true;
    if (f.emphasis.color) e.color = f.emphasis.color;
    if (f.emphasis.highlight) e.highlight = f.emphasis.highlight;
    if (Object.keys(e).length) out.emphasis = e;
  }
  return out;
}

function compactGroup(g: GroupConfig): GroupConfig {
  const out: GroupConfig = {
    id: g.id,
    name: g.name.trim() || '未命名分组',
    color: g.color,
    columns: g.columns,
    fieldIds: g.fieldIds.filter(Boolean),
  };
  if (g.collapsed) out.collapsed = true;
  return out;
}

function compactLink(l: LinkDisplayConfig): LinkDisplayConfig {
  return {
    fieldId: l.fieldId,
    tableId: l.tableId,
    displayFieldIds: l.displayFieldIds.filter(Boolean).slice(0, 8),
    maxRows: Math.min(Math.max(l.maxRows || 20, 1), 100),
  };
}

function isSource(v: unknown): v is DocSource {
  return v === 'main' || v === 'hop1' || v === 'hop2';
}

function compactMapping(m?: DocMapping): DocMapping | undefined {
  if (!m) return undefined;
  const items: DocMapItem[] = [];
  (m.items ?? []).forEach((it) => {
    if (!it || !it.to) return;
    const src: DocSource = isSource(it.src) ? it.src : 'hop1';
    items.push(it.from ? { to: it.to, src, from: it.from } : { to: it.to, src });
  });
  return items.length ? { items } : undefined;
}

function compactSub(s: DocSubConfig): DocSubConfig | undefined {
  if (!s || !s.tableId) return undefined;
  const out: DocSubConfig = { tableId: s.tableId, linkFieldId: s.linkFieldId || '' };
  const required = Array.from(new Set((s.required ?? []).filter(Boolean)));
  if (required.length) out.required = required;
  const mapping = compactMapping(s.mapping);
  if (mapping) out.mapping = mapping;
  return out;
}

/** 单据配置瘦身：未启用且没做过任何选择时整个丢弃 */
function compactDoc(d?: DocConfig): DocConfig | undefined {
  if (!d) return undefined;
  const subs = (d.subs ?? []).map(compactSub).filter((s): s is DocSubConfig => !!s);
  const hasBody = !!(d.contractFieldId || subs.length);
  if (!d.enabled && !hasBody) return undefined;
  const out: DocConfig = { enabled: !!d.enabled, subs };
  if (d.name && d.name.trim()) out.name = d.name.trim();
  if (d.contractFieldId) out.contractFieldId = d.contractFieldId;
  if (d.customerFieldId) out.customerFieldId = d.customerFieldId;
  const main = compactMapping(d.main);
  if (main) out.main = main;
  return out;
}

function hydratePairs(raw: unknown): HttpPair[] {
  if (!Array.isArray(raw)) return [];
  const out: HttpPair[] = [];
  raw.forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const p = it as Partial<HttpPair>;
    const k = typeof p.k === 'string' ? p.k.trim() : '';
    if (!k) return;
    out.push({ k, v: typeof p.v === 'string' ? p.v : String(p.v ?? '') });
  });
  return out;
}

/** 读取禁用条件；字段为空或结构非法时丢弃，旧配置没有该字段时返回 undefined */
function hydrateDisableRules(raw: unknown): ButtonDisableRule[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ButtonDisableRule[] = [];
  raw.forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const r = it as Partial<ButtonDisableRule>;
    const fieldId = typeof r.fieldId === 'string' ? r.fieldId.trim() : '';
    if (!fieldId) return;
    const operator = isDisableOperator(r.operator) ? r.operator : 'is';
    out.push({
      fieldId,
      operator,
      value: operator === 'isNotEmpty' ? '' : String(r.value ?? ''),
    });
  });
  return out.length ? out : undefined;
}

/** 读取按钮 HTTP 配置；旧版 webhookUrl 自动升级成 POST + 自动全集 */
function hydrateHttp(raw: unknown, legacyUrl?: unknown): ButtonHttpConfig | undefined {
  if (raw && typeof raw === 'object') {
    const h = raw as Partial<ButtonHttpConfig>;
    const url = typeof h.url === 'string' ? h.url.trim() : '';
    if (!url) return undefined;
    const template = h.bodyMode === 'template';
    return {
      method: typeof h.method === 'string' && h.method.trim() ? h.method.trim().toUpperCase() : 'POST',
      url,
      params: hydratePairs(h.params),
      headers: hydratePairs(h.headers),
      bodyMode: template ? 'template' : 'auto',
      bodyFormat: HTTP_BODY_FORMATS.includes(h.bodyFormat as HttpBodyFormat)
        ? (h.bodyFormat as HttpBodyFormat)
        : 'json',
      body: template ? String(h.body ?? '') : undefined,
      disableRules: hydrateDisableRules(h.disableRules),
      disableHint: typeof h.disableHint === 'string' && h.disableHint.trim() ? h.disableHint.trim() : undefined,
      confirmBeforeSend: h.confirmBeforeSend === true,
      confirmText: typeof h.confirmText === 'string' && h.confirmText.trim() ? h.confirmText.trim() : undefined,
    };
  }
  if (typeof legacyUrl === 'string' && legacyUrl.trim()) {
    return { method: 'POST', url: legacyUrl.trim(), bodyMode: 'auto' };
  }
  return undefined;
}

/** 旧版（overrides/excludes）映射结构，读取时迁移成 items */
function hydrateLegacyMapping(raw: unknown, src: DocSource): DocMapping | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { overrides?: unknown; excludes?: unknown };
  const items: DocMapItem[] = [];
  if (Array.isArray(r.overrides)) {
    r.overrides.forEach((o) => {
      const it = o as { from?: unknown; to?: unknown };
      if (it && typeof it === 'object' && it.to && it.from) {
        items.push({ to: String(it.to), src, from: String(it.from) });
      }
    });
  }
  if (Array.isArray(r.excludes)) {
    r.excludes.forEach((id) => {
      if (id) items.push({ to: String(id), src, from: '' });
    });
  }
  return items.length ? { items } : undefined;
}

function hydrateMapping(raw: unknown, legacySrc: DocSource): DocMapping | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { items?: unknown };
  if (!Array.isArray(r.items)) return hydrateLegacyMapping(raw, legacySrc);
  const items: DocMapItem[] = [];
  r.items.forEach((it) => {
    const v = it as { to?: unknown; src?: unknown; from?: unknown };
    if (!v || typeof v !== 'object' || !v.to) return;
    items.push({
      to: String(v.to),
      src: isSource(v.src) ? v.src : legacySrc,
      from: typeof v.from === 'string' ? v.from : '',
    });
  });
  return { items };
}

function hydrateSub(raw: unknown): DocSubConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Partial<DocSubConfig>;
  if (!s.tableId) return undefined;
  return {
    tableId: String(s.tableId),
    linkFieldId: typeof s.linkFieldId === 'string' ? s.linkFieldId : '',
    required: Array.isArray(s.required) ? s.required.map(String).filter(Boolean) : [],
    mapping: hydrateMapping(s.mapping, 'main'),
  };
}

function hydrateDoc(raw: unknown): DocConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Partial<DocConfig> & {
    subTableId?: string;
    subLinkFieldId?: string;
    subRequired?: string[];
    sub?: unknown;
  };
  // 旧版单子表配置迁移成 subs[0]
  let subs: DocSubConfig[] = Array.isArray(d.subs)
    ? d.subs.map(hydrateSub).filter((s): s is DocSubConfig => !!s)
    : [];
  if (!subs.length && d.subTableId) {
    subs = [
      {
        tableId: String(d.subTableId),
        linkFieldId: typeof d.subLinkFieldId === 'string' ? d.subLinkFieldId : '',
        required: Array.isArray(d.subRequired) ? d.subRequired.map(String).filter(Boolean) : [],
        mapping: hydrateMapping(d.sub, 'hop2'),
      },
    ];
  }
  return {
    enabled: !!d.enabled,
    name: typeof d.name === 'string' ? d.name : undefined,
    contractFieldId: typeof d.contractFieldId === 'string' ? d.contractFieldId : undefined,
    customerFieldId: typeof d.customerFieldId === 'string' ? d.customerFieldId : undefined,
    main: hydrateMapping(d.main, 'hop1'),
    subs,
  };
}

/** 落盘前的瘦身序列化：只留用户决策字段 */
export function serializeConfig(data: PluginData): PluginData {
  const out: PluginData = {
    version: CONFIG_VERSION,
    groups: data.groups.map(compactGroup).filter((g) => g.fieldIds.length > 0),
    fields: data.fields.map(compactField),
    filterFieldIds: Array.from(new Set(data.filterFieldIds.filter(Boolean))),
    searchFieldIds: Array.from(new Set(data.searchFieldIds.filter(Boolean))),
    links: data.links.map(compactLink).filter((l) => l.fieldId && l.tableId),
  };
  if (data.baseToken) out.baseToken = data.baseToken;
  if (data.baseId) out.baseId = data.baseId;
  if (data.tableId) out.tableId = data.tableId;
  const doc = compactDoc(data.doc);
  if (doc) out.doc = doc;
  return out;
}

/** 读取时的结构还原与容错（字段名等元信息运行时由 Base 元信息补回，不落盘） */
export function hydrateConfig(raw: unknown): PluginData {
  if (!raw || typeof raw !== 'object') return emptyConfig();
  const r = raw as Partial<PluginData>;
  const base = emptyConfig();
  return {
    ...base,
    baseToken: typeof r.baseToken === 'string' ? r.baseToken : undefined,
    baseId: typeof r.baseId === 'string' ? r.baseId : undefined,
    tableId: typeof r.tableId === 'string' ? r.tableId : undefined,
    groups: Array.isArray(r.groups)
      ? r.groups
          .filter((g): g is GroupConfig => !!g && typeof g === 'object')
          .map((g) => ({
            id: String(g.id ?? `g_${Math.random().toString(36).slice(2, 8)}`),
            name: String(g.name ?? '未命名分组'),
            color: String(g.color ?? '#3370ff'),
            columns: g.columns === 1 || g.columns === 3 ? g.columns : 2,
            collapsed: !!g.collapsed,
            fieldIds: Array.isArray(g.fieldIds) ? g.fieldIds.map(String) : [],
          }))
      : [],
    fields: Array.isArray(r.fields)
      ? r.fields
          .filter((f): f is FieldConfig => !!f && typeof f === 'object' && !!f.fieldId)
          .map((f) => {
            const legacy = (f as FieldConfig & { webhookUrl?: unknown }).webhookUrl;
            return {
              fieldId: String(f.fieldId),
              visible: f.visible !== false,
              required: !!f.required,
              readonly: !!f.readonly,
              label: f.label ? String(f.label) : undefined,
              asButton: typeof f.asButton === 'boolean' ? f.asButton : undefined,
              http: hydrateHttp(f.http, legacy),
              emphasis: f.emphasis && typeof f.emphasis === 'object' ? { ...f.emphasis } : undefined,
            };
          })
      : [],
    filterFieldIds: Array.isArray(r.filterFieldIds) ? r.filterFieldIds.map(String) : [],
    searchFieldIds: Array.isArray(r.searchFieldIds) ? r.searchFieldIds.map(String) : [],
    links: Array.isArray(r.links)
      ? r.links
          .filter((l): l is LinkDisplayConfig => !!l && typeof l === 'object' && !!l.fieldId)
          .map((l) => ({
            fieldId: String(l.fieldId),
            tableId: String(l.tableId ?? ''),
            displayFieldIds: Array.isArray(l.displayFieldIds) ? l.displayFieldIds.map(String) : [],
            maxRows: typeof l.maxRows === 'number' ? l.maxRows : 20,
          }))
      : [],
    doc: hydrateDoc(r.doc),
  };
}