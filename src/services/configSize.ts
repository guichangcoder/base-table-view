import { CONFIG_VERSION, emptyConfig, type PluginData, type FieldConfig, type GroupConfig, type LinkDisplayConfig } from '../types';

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

function compactField(f: FieldConfig): FieldConfig {
  const out: FieldConfig = { fieldId: f.fieldId, visible: !!f.visible };
  if (f.required) out.required = true;
  if (f.readonly) out.readonly = true;
  if (f.label && f.label.trim()) out.label = f.label.trim();
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
          .map((f) => ({
            fieldId: String(f.fieldId),
            visible: f.visible !== false,
            required: !!f.required,
            readonly: !!f.readonly,
            label: f.label ? String(f.label) : undefined,
            emphasis: f.emphasis && typeof f.emphasis === 'object' ? { ...f.emphasis } : undefined,
          }))
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
  };
}