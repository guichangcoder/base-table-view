import { FieldType } from '@lark-base-open/js-sdk';
import { diagnoseAppContext, getBase, getBaseToken, getGlobalBase } from './appContext';
import type { FieldMetaLite, TableMetaLite } from '../types';

const FT = FieldType as any;

/** SDK 已建模的数值类型值，用于识别「SDK 未认知的新类型」 */
const KNOWN_TYPE_VALUES = new Set<number>(
  Object.values(FT).filter((v) => typeof v === 'number') as number[],
);

const pick = (names: string[]): number[] =>
  names.map((n) => FT[n]).filter((v) => typeof v === 'number') as number[];

/** 只读类型：配置阶段直接排除，不进入可录入/可编辑列表 */
export const READONLY_TYPES = pick([
  'Formula',
  'Lookup',
  'CreatedTime',
  'ModifiedTime',
  'CreatedUser',
  'ModifiedUser',
  'AutoNumber',
  'Barcode',
]);

/** 结构不支持（按文本写入会产生脏数据） */
export const UNSUPPORTED_TYPES = pick(['GroupChat', 'Location']);

/** 可编辑类型 */
export const EDITABLE_TYPES = pick([
  'Text',
  'Number',
  'SingleSelect',
  'MultiSelect',
  'DateTime',
  'Checkbox',
  'User',
  'Phone',
  'Url',
  'Email',
  'Currency',
  'Progress',
  'Rating',
]);

/** 文本类，可用于关键词搜索 */
export const TEXT_TYPES = pick(['Text', 'Phone', 'Url', 'Email']);

/**
 * 「按钮」字段：SDK 的数值枚举里没有 Button（只在 FieldUIType 里有 "Button"），
 * 与多维表格开放接口一致取 3001。点击由数据表执行按钮绑定的动作（工作流/打开链接）。
 */
export const BUTTON_TYPE = 3001;

/**
 * 「按钮」字段判定（按类型值）。
 * - 多维表格字段类型里 3001 = 按钮；
 * - JSSDK 的数值枚举里没有 Button 成员，宿主也可能直接返回字符串 "Button"。
 */
export function isButtonType(type: unknown): boolean {
  if (String(type) === 'Button') return true;
  const n = Number(type);
  return Number.isFinite(n) && n === BUTTON_TYPE;
}

/**
 * 「按钮」字段判定（多信号）。
 * 依次判断：
 * 1. property 为 `{ color: number, title: string }` —— 按钮字段独有，最可靠；
 * 2. 类型值是 3001 或字符串 "Button"；
 * 3. 类型值是 SDK 未建模的非 0 数值（宿主可能用与开放接口不同的类型值）。
 */
function detectButton(rawType: unknown, prop: any): boolean {
  if (prop && (typeof prop.title === 'string' || typeof prop.color === 'number')) return true;
  if (isButtonType(rawType)) return true;
  const n = Number(rawType);
  if (!Number.isFinite(n) || n === 0 || KNOWN_TYPE_VALUES.size < 5) return false;
  return !KNOWN_TYPE_VALUES.has(n);
}

export function isReadonlyType(type: number): boolean {
  return READONLY_TYPES.includes(type);
}
export function isUnsupportedType(type: number): boolean {
  return UNSUPPORTED_TYPES.includes(type);
}
export function isEditableType(type: number): boolean {
  return EDITABLE_TYPES.includes(type) && !isReadonlyType(type) && !isUnsupportedType(type);
}
export function isLinkType(type: number): boolean {
  return type === FT.SingleLink || type === FT.DuplexLink;
}
export function isTextType(type: number): boolean {
  return TEXT_TYPES.includes(type);
}

export async function listTables(): Promise<TableMetaLite[]> {
  const base = getBase() as any;
  const metas: any[] = await base.getTableMetaList();
  return (metas || []).map((m) => ({ id: String(m.id), name: String(m.name ?? m.id) }));
}

function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

/** 候选 base：Workspace 实例优先，其次全局默认实例（浏览态降级路径） */
function basesToTry(): Array<{ label: string; base: any }> {
  const primary = getBase() as any;
  const global = getGlobalBase() as any;
  const list: Array<{ label: string; base: any }> = [];
  if (primary) list.push({ label: 'workspace', base: primary });
  if (global && global !== primary) list.push({ label: 'global', base: global });
  return list;
}

/**
 * 取表对象。只调用「表级」接口（getTableById），不做 base 级表枚举。
 * Workspace 实例取不到时降级到全局实例，两次都失败则返回 null 并累积错误。
 */
async function resolveTable(tableId: string, errors: string[]): Promise<any | null> {
  for (const { label, base } of basesToTry()) {
    try {
      const t = await base.getTableById(tableId);
      if (t) return t;
      errors.push(`${label}.getTableById 返回空`);
    } catch (e) {
      errors.push(`${label}.getTableById → ${errMsg(e)}`);
    }
  }
  return null;
}

function mapFieldMeta(m: any): FieldMetaLite {
  const type = Number(m.type);
  let prop = m.property ?? {};
  if (typeof prop === 'string') {
    try {
      prop = JSON.parse(prop);
    } catch {
      prop = {};
    }
  }
  const isButton = detectButton(m.type, prop);
  if (!isButton && !KNOWN_TYPE_VALUES.has(type)) {
    // 宿主返回了 SDK 未建模的类型：把原始元信息打出来，便于定位（如按钮字段）
    console.info('[baseService] 未识别的字段类型', { name: m.name, rawType: m.type, meta: m });
  }
  return {
    id: String(m.id),
    name: String(m.name ?? m.id),
    type,
    options: Array.isArray(prop.options)
      ? prop.options.map((o: any) => ({ id: String(o.id), name: String(o.name) }))
      : undefined,
    linkTableId: prop.tableId ? String(prop.tableId) : undefined,
    isPrimary: !!m.isPrimary,
    editable: isEditableType(type),
    readonlyType: isReadonlyType(type),
    unsupported: isUnsupportedType(type),
    isButton,
    buttonTitle: isButton && typeof prop.title === 'string' ? prop.title : undefined,
    buttonColor: isButton && typeof prop.color === 'number' ? prop.color : undefined,
  };
}

async function readFields(table: any): Promise<FieldMetaLite[]> {
  const metas: any[] = await table.getFieldMetaList();
  return (metas || []).map(mapFieldMeta);
}

export async function listFields(tableId: string): Promise<FieldMetaLite[]> {
  const errors: string[] = [];
  const table = await resolveTable(tableId, errors);
  if (!table) throw new Error(errors.join('；'));
  const fields = await readFields(table);
  fieldCache.set(cacheKey(tableId), { at: Date.now(), fields });
  return fields;
}

/* ---------------------------------------------------------------- 宿主对象缓存
 * 大表（万级记录）下，每次读写都重新 getTableById / getFieldMetaList 会产生大量
 * 宿主 IPC；并发用户多时是主要瓶颈。表对象与字段元信息都按 baseToken+tableId
 * 缓存，跨 base 天然隔离（key 不同），切换 base 不会读到旧数据。
 */
const CACHE_TTL = 60 * 1000;
const tableCache = new Map<string, { at: number; table: any }>();
const fieldCache = new Map<string, { at: number; fields: FieldMetaLite[] }>();

function cacheKey(tableId: string): string {
  return `${getBaseToken()}|${tableId}`;
}

export function clearMetaCache(): void {
  tableCache.clear();
  fieldCache.clear();
}

/** 取表对象（workspace → 全局实例兜底 + 缓存），失败抛出带诊断的异常 */
export async function getTableCached(tableId: string): Promise<any> {
  const key = cacheKey(tableId);
  const hit = tableCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL) return hit.table;

  const errors: string[] = [];
  const table = await resolveTable(tableId, errors);
  if (!table) {
    throw new Error(`${errors.join('；') || '数据表不存在或无权访问'}（${JSON.stringify(diagnoseAppContext())}）`);
  }
  tableCache.set(key, { at: now, table });
  return table;
}

/** 字段元信息（展示用）：短时间内复用，避免关联字段每次切换记录都重读 */
export async function listFieldsCached(tableId: string): Promise<FieldMetaLite[]> {
  const key = cacheKey(tableId);
  const hit = fieldCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL) return hit.fields;
  return await listFields(tableId);
}

/** 表名：读单表拿名字，失败降级为空串（表名不是关键路径） */
export async function getTableName(tableId: string, table?: any): Promise<string> {
  try {
    const t = table ?? (await resolveTable(tableId, []));
    if (!t || typeof t.getName !== 'function') return '';
    const name = await t.getName();
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

export interface ViewMeta {
  fields: FieldMetaLite[];
  primaryId: string;
  tableName: string;
}

/**
 * 浏览态元信息。
 *
 * 只调用「表级」接口：getTableById / getFieldMetaList / getName。
 * 绝不能调 base 级表枚举（getTableMetaList）——浏览态会被宿主拒绝并返回
 * "this api is only supported in config mode"。
 * 失败时把每一步的错误与上下文状态拼进异常，便于定位被门禁的具体接口。
 */
export async function loadViewMeta(tableId: string): Promise<ViewMeta> {
  const errors: string[] = [];
  const table = await resolveTable(tableId, errors);
  if (!table) {
    throw new Error(`${errors.join('；')}（${JSON.stringify(diagnoseAppContext())}）`);
  }

  let fields: FieldMetaLite[];
  try {
    fields = await readFields(table);
  } catch (e) {
    errors.push(`getFieldMetaList → ${errMsg(e)}`);
    throw new Error(`${errors.join('；')}（${JSON.stringify(diagnoseAppContext())}）`);
  }

  const primary = fields.find((f) => f.isPrimary) ?? fields[0];
  const tableName = await getTableName(tableId, table);
  return { fields, primaryId: primary?.id ?? '', tableName };
}