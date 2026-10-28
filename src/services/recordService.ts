/**
 * 记录读写与筛选（全部走 getRecordsByPage / getRecordsByIds 等分页接口，
 * 不用已废弃、最多 200 条的 getRecordList）。
 */
import { FieldType } from '@lark-base-open/js-sdk';
import { getBridge } from './appContext';
import { getTableCached } from './baseService';
import type { FieldMetaLite, FilterItem, LoadedRecordPage, RecordRow } from '../types';

const FT = FieldType as any;
const MAX_PAGE_SIZE = 200;

/** 取表对象：workspace/全局实例兜底 + 复用缓存，减少高并发下的宿主 IPC */
async function getTable(tableId: string): Promise<any> {
  return await getTableCached(tableId);
}

function toNumber(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toTimestamp(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function optionIdOf(field: FieldMetaLite | undefined, value: string): string {
  if (!field?.options) return value;
  const hit = field.options.find((o) => o.name === value || o.id === value);
  return hit ? hit.id : value;
}

/** 单条前端筛选 → SDK 筛选条件 */
function buildCondition(item: FilterItem, field?: FieldMetaLite): any | null {
  if (!field) return null;
  const type = field.type;
  const op = item.operator;
  const base = { fieldId: item.fieldId, fieldType: type };

  if (op === 'isNotEmpty' || (op as string) === 'isEmpty') {
    // 单选字段的 isEmpty/isNotEmpty 变体要求 value 为 string[]（不能为 null），其余类型用 null
    const emptyValue = type === FT.SingleSelect ? [] : null;
    return { ...base, operator: op, value: emptyValue };
  }

  // 复选框：只支持 is + boolean，其它写法会被宿主判定为非法条件
  if (type === FT.Checkbox) {
    if (op !== 'is') return null;
    return { ...base, operator: 'is', value: item.value === 'true' };
  }

  if (type === FT.Number || type === FT.Currency || type === FT.Progress || type === FT.Rating) {
    const n = toNumber(item.value);
    if (n === null) return null;
    const operator =
      op === 'isGreater' ? 'isGreater' : op === 'isLess' ? 'isLess' : op === 'contains' ? 'is' : 'is';
    return { ...base, operator, value: n };
  }

  if (type === FT.DateTime || type === FT.CreatedTime || type === FT.ModifiedTime) {
    const ts = toTimestamp(item.value);
    if (ts === null) return null;
    const operator = op === 'isGreater' ? 'isGreater' : op === 'isLess' ? 'isLess' : 'is';
    return { ...base, operator, value: ts };
  }

  if (type === FT.SingleSelect) {
    const id = optionIdOf(field, item.value);
    if (op === 'contains') return { ...base, operator: 'contains', value: id };
    return { ...base, operator: 'is', value: id };
  }

  if (type === FT.MultiSelect) {
    const id = optionIdOf(field, item.value);
    return { ...base, operator: 'contains', value: [id] };
  }

  if (type === FT.User) {
    return { ...base, operator: 'contains', value: [item.value] };
  }

  // 文本类
  if (op === 'is') return { ...base, operator: 'is', value: item.value };
  if (op === 'isGreater' || op === 'isLess') {
    return { ...base, operator: 'is', value: item.value };
  }
  return { ...base, operator: 'contains', value: item.value };
}

/** 组合筛选：显式条件 AND，关键词在指定字段间 OR */
export function buildServerFilter(
  items: FilterItem[],
  fields: FieldMetaLite[],
  keyword?: string,
  searchFieldIds?: string[],
): any | undefined {
  const byId = new Map(fields.map((f) => [f.id, f]));

  const conds = items
    .filter((it) => it.fieldId && (it.value !== '' || it.operator === 'isNotEmpty'))
    .map((it) => buildCondition(it, byId.get(it.fieldId)))
    .filter(Boolean);

  const kw = (keyword ?? '').trim();
  const searchConds = kw
    ? (searchFieldIds ?? [])
        .map((id) => byId.get(id))
        .filter((f): f is FieldMetaLite => !!f)
        .map((f) => buildCondition({ fieldId: f.id, operator: 'contains', value: kw }, f))
        .filter(Boolean)
    : [];

  if (!conds.length && !searchConds.length) return undefined;
  if (!searchConds.length) return { conjunction: 'and', conditions: conds };
  if (!conds.length) return { conjunction: 'or', conditions: searchConds };
  return {
    conjunction: 'and',
    conditions: [
      { conjunction: 'and', conditions: conds },
      { conjunction: 'or', conditions: searchConds },
    ],
  };
}

export interface ListRecordsOptions {
  pageSize?: number;
  pageToken?: number;
  filterItems?: FilterItem[];
  keyword?: string;
  searchFieldIds?: string[];
  fields?: FieldMetaLite[];
}

/** 分页读取记录（万级数据只取当前页） */
export async function listRecords(
  tableId: string,
  options: ListRecordsOptions = {},
): Promise<LoadedRecordPage> {
  const table = await getTable(tableId);
  const params: any = {
    pageSize: Math.min(Math.max(options.pageSize ?? 100, 1), MAX_PAGE_SIZE),
  };
  if (typeof options.pageToken === 'number') params.pageToken = options.pageToken;

  const filter = buildServerFilter(
    options.filterItems ?? [],
    options.fields ?? [],
    options.keyword,
    options.searchFieldIds,
  );
  if (filter) params.filter = filter;

  const res: any = await table.getRecordsByPage(params);
  const records: RecordRow[] = (res?.records ?? []).map((r: any) => ({
    recordId: String(r.recordId),
    fields: r.fields ?? {},
  }));

  return {
    records,
    pageToken: typeof res?.pageToken === 'number' ? res.pageToken : undefined,
    hasMore: !!res?.hasMore,
    total: typeof res?.total === 'number' ? res.total : undefined,
  };
}

export async function getRecordById(tableId: string, recordId: string): Promise<RecordRow> {
  const table = await getTable(tableId);
  const res: any = await table.getRecordById(recordId);
  return { recordId, fields: res?.fields ?? {} };
}

/** 批量读取（≤1000）。返回顺序与入参对齐；长度不一致时退化为逐条读取 */
export async function getRecordsByIds(tableId: string, recordIds: string[]): Promise<RecordRow[]> {
  if (!recordIds.length) return [];
  const table = await getTable(tableId);
  const ids = recordIds.slice(0, 1000);
  try {
    const list: any[] = await table.getRecordsByIds(ids, true);
    if (Array.isArray(list) && list.length === ids.length) {
      return list.map((r, i) => ({ recordId: ids[i], fields: r?.fields ?? {} }));
    }
  } catch (e) {
    console.warn('[recordService] getRecordsByIds 失败，退化为逐条读取:', e);
  }

  const out: RecordRow[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(
      batch.map((id) =>
        getRecordById(tableId, id).catch(() => ({ recordId: id, fields: {} }) as RecordRow),
      ),
    );
    out.push(...rows);
  }
  return out;
}

export async function addRecord(
  tableId: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const table = await getTable(tableId);
  const res = await table.addRecord({ fields });
  return String(res);
}

export async function updateRecord(
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const table = await getTable(tableId);
  await table.setRecord(recordId, { fields });
}

export async function deleteRecord(tableId: string, recordId: string): Promise<boolean> {
  const table = await getTable(tableId);
  return !!(await table.deleteRecord(recordId));
}

/** 关联字段取关联记录 id（兼容 recordIds / record_ids / 字符串等形态） */
export function extractLinkIds(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((v) => extractLinkIds(v));
  if (typeof value === 'string') return value ? [value] : [];
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const ids = v.recordIds ?? v.record_ids ?? v.recordId ?? v.id;
    if (Array.isArray(ids)) return ids.map(String);
    if (typeof ids === 'string' && ids) return [ids];
  }
  return [];
}

export function extractLinkTableId(value: unknown): string {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const tid = v.tableId ?? v.table_id;
    if (typeof tid === 'string') return tid;
  }
  return '';
}

export interface UserCandidate {
  id: string;
  name: string;
}

/** 人员候选值最多扫描的行数与去重结果数：万级大表不能整列拉取 */
const USER_SCAN_PAGES = 5;
const USER_SCAN_PAGE_SIZE = 200;
const USER_MAX = 200;

/** 人员字段候选值：分页扫描前若干行去重，并补上当前用户 */
export async function listUserCandidates(
  tableId: string,
  fieldId: string,
): Promise<UserCandidate[]> {
  const map = new Map<string, string>();
  try {
    const table = await getTable(tableId);
    const field = await table.getFieldById(fieldId);
    const collect = (val: any) => {
      const arr = Array.isArray(val) ? val : [val];
      arr.forEach((u: any) => {
        if (u && typeof u === 'object' && u.id) {
          map.set(String(u.id), String(u.name ?? u.enName ?? u.en_name ?? u.id));
        }
      });
    };

    if (typeof field?.getFieldValueListByPage === 'function') {
      let pageToken: number | undefined;
      for (let i = 0; i < USER_SCAN_PAGES && map.size < USER_MAX; i += 1) {
        const res: any = await field.getFieldValueListByPage({
          pageSize: USER_SCAN_PAGE_SIZE,
          ...(typeof pageToken === 'number' ? { pageToken } : null),
        });
        (res?.fieldValues ?? []).forEach((it: any) => collect(it?.value));
        if (!res?.hasMore || typeof res.pageToken !== 'number') break;
        pageToken = res.pageToken;
      }
    } else {
      const list: any[] = await field.getFieldValueList();
      (list || []).forEach((item) => collect(item?.value));
    }
  } catch (e) {
    console.warn('[recordService] 人员候选值读取失败:', e);
  }

  try {
    const uid = await getBridge().getUserId();
    if (uid && !map.has(uid)) map.set(uid, '我');
  } catch {
    /* 取不到当前用户时忽略 */
  }

  return Array.from(map, ([id, name]) => ({ id, name }));
}