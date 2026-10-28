/**
 * 配置数据的纯函数操作（不依赖 SDK，便于本地回归）。
 * 只处理「用户决策」，字段名/类型等元信息始终由 Base 元信息提供。
 */
import {
  CONFIG_VERSION,
  type FieldConfig,
  type FieldMetaLite,
  type GroupConfig,
  type LinkDisplayConfig,
  type PluginData,
} from '../types';
import { GROUP_COLORS } from './palette';

let seq = 0;
export function uid(prefix = 'g'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function isLink(type: number): boolean {
  // 18 = SingleLink, 21 = DuplexLink
  return type === 18 || type === 21;
}

function defaultFieldConfig(f: FieldMetaLite): FieldConfig {
  return { fieldId: f.id, visible: true };
}

/** 首次进入配置态：普通字段 → 「基本信息」，关联字段 → 「关联信息」 */
export function buildDefaultConfig(
  fields: FieldMetaLite[],
  baseToken?: string,
  tableId?: string,
): PluginData {
  const normal = fields.filter((f) => !isLink(f.type) && !f.unsupported);
  const links = fields.filter((f) => isLink(f.type));

  const groups: GroupConfig[] = [];
  if (normal.length) {
    groups.push({
      id: uid('g'),
      name: '基本信息',
      color: GROUP_COLORS[0],
      columns: 2,
      fieldIds: normal.map((f) => f.id),
    });
  }
  if (links.length) {
    groups.push({
      id: uid('g'),
      name: '关联信息',
      color: GROUP_COLORS[1],
      columns: 1,
      fieldIds: links.map((f) => f.id),
    });
  }

  return {
    version: CONFIG_VERSION,
    baseToken,
    tableId,
    groups,
    fields: fields.filter((f) => !f.unsupported).map(defaultFieldConfig),
    filterFieldIds: normal
      .filter((f) => f.type === 1 || f.type === 2 || f.type === 3 || f.type === 5 || f.type === 11)
      .slice(0, 4)
      .map((f) => f.id),
    searchFieldIds: fields.filter((f) => f.type === 1).slice(0, 3).map((f) => f.id),
    links: links
      .filter((f) => !!f.linkTableId)
      .map<LinkDisplayConfig>((f) => ({
        fieldId: f.id,
        tableId: f.linkTableId as string,
        displayFieldIds: [],
        maxRows: 20,
      })),
  };
}

/**
 * 用最新字段元信息校正配置：
 * - 清理已删除字段的引用
 * - 新字段补进配置并落到第一个分组
 * - 关联字段补齐 links 配置
 */
export function syncConfig(config: PluginData, fields: FieldMetaLite[]): PluginData {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const existing = new Map(config.fields.map((f) => [f.fieldId, f]));

  const nextFields: FieldConfig[] = [];
  fields.forEach((f) => {
    if (f.unsupported) return;
    nextFields.push(existing.get(f.id) ?? defaultFieldConfig(f));
  });

  const groups = config.groups.map((g) => ({
    ...g,
    fieldIds: g.fieldIds.filter((id) => byId.has(id)),
  }));

  const grouped = new Set(groups.flatMap((g) => g.fieldIds));
  // 只把「首次出现的新字段」自动放进第一个分组；用户主动移出分组的字段不自动回流
  const ungrouped = nextFields
    .map((f) => f.fieldId)
    .filter((id) => !grouped.has(id) && !existing.has(id));
  if (ungrouped.length) {
    if (groups.length) {
      groups[0].fieldIds.push(...ungrouped);
    } else {
      groups.push({
        id: uid('g'),
        name: '基本信息',
        color: GROUP_COLORS[0],
        columns: 2,
        fieldIds: ungrouped,
      });
    }
  }

  // 同一个字段只能出现在一个分组，靠后出现的重复项剔除
  const seen = new Set<string>();
  groups.forEach((g) => {
    g.fieldIds = g.fieldIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });

  const linkFields = fields.filter((f) => isLink(f.type) && !!f.linkTableId);
  const linkMap = new Map(config.links.filter((l) => byId.has(l.fieldId)).map((l) => [l.fieldId, l]));
  const links: LinkDisplayConfig[] = linkFields.map((f) => {
    const old = linkMap.get(f.id);
    if (old && old.tableId === f.linkTableId) return old;
    return {
      fieldId: f.id,
      tableId: f.linkTableId as string,
      displayFieldIds: old?.displayFieldIds ?? [],
      maxRows: old?.maxRows ?? 20,
    };
  });

  return {
    ...config,
    fields: nextFields,
    groups,
    links,
    filterFieldIds: config.filterFieldIds.filter((id) => byId.has(id)),
    searchFieldIds: config.searchFieldIds.filter((id) => byId.has(id)),
  };
}

export function setFieldConfig(
  config: PluginData,
  fieldId: string,
  patch: Partial<FieldConfig>,
): PluginData {
  const exists = config.fields.some((f) => f.fieldId === fieldId);
  const fields = exists
    ? config.fields.map((f) => (f.fieldId === fieldId ? { ...f, ...patch } : f))
    : [...config.fields, { fieldId, visible: true, ...patch }];
  return { ...config, fields };
}

export function updateLink(
  config: PluginData,
  fieldId: string,
  patch: Partial<LinkDisplayConfig>,
): PluginData {
  return {
    ...config,
    links: config.links.map((l) => (l.fieldId === fieldId ? { ...l, ...patch } : l)),
  };
}

export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function addGroup(config: PluginData, name?: string): PluginData {
  const idx = config.groups.length % GROUP_COLORS.length;
  const group: GroupConfig = {
    id: uid('g'),
    name: name || `分组 ${config.groups.length + 1}`,
    color: GROUP_COLORS[idx],
    columns: 2,
    fieldIds: [],
  };
  return { ...config, groups: [...config.groups, group] };
}

export function removeGroup(config: PluginData, groupId: string): PluginData {
  return { ...config, groups: config.groups.filter((g) => g.id !== groupId) };
}

export function updateGroup(
  config: PluginData,
  groupId: string,
  patch: Partial<GroupConfig>,
): PluginData {
  return {
    ...config,
    groups: config.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
  };
}

export function moveGroup(config: PluginData, groupId: string, dir: -1 | 1): PluginData {
  const idx = config.groups.findIndex((g) => g.id === groupId);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= config.groups.length) return config;
  const groups = [...config.groups];
  [groups[idx], groups[to]] = [groups[to], groups[idx]];
  return { ...config, groups };
}

/** 把字段移入指定分组（自动从其他分组移除） */
export function assignField(config: PluginData, fieldId: string, groupId: string): PluginData {
  const groups = config.groups.map((g) => ({
    ...g,
    fieldIds: g.fieldIds.filter((id) => id !== fieldId),
  }));
  const target = groups.find((g) => g.id === groupId);
  if (!target) return config;
  target.fieldIds = [...target.fieldIds, fieldId];
  return { ...config, groups };
}

/** 从分组中移除（字段变为未分组，不再展示） */
export function unassignField(config: PluginData, fieldId: string): PluginData {
  return {
    ...config,
    groups: config.groups.map((g) => ({
      ...g,
      fieldIds: g.fieldIds.filter((id) => id !== fieldId),
    })),
  };
}

export function moveFieldInGroup(
  config: PluginData,
  groupId: string,
  fieldId: string,
  dir: -1 | 1,
): PluginData {
  return {
    ...config,
    groups: config.groups.map((g) => {
      if (g.id !== groupId) return g;
      const idx = g.fieldIds.indexOf(fieldId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= g.fieldIds.length) return g;
      const fieldIds = [...g.fieldIds];
      [fieldIds[idx], fieldIds[to]] = [fieldIds[to], fieldIds[idx]];
      return { ...g, fieldIds };
    }),
  };
}

/** 分组内字段 id 对应的有效配置（过滤不可见/已删除） */
export function visibleFieldIds(config: PluginData, group: GroupConfig): string[] {
  const hidden = new Set(config.fields.filter((f) => !f.visible).map((f) => f.fieldId));
  return group.fieldIds.filter((id) => !hidden.has(id));
}