/**
 * 主子表单据（如「项目立项单」）的数据编排：
 * - 主表字段按映射从合同记录 / 客户记录带出
 * - 每张子表的字段按映射从主表值 / 合同记录 / 客户记录带出
 * 只做「读合同 → 读客户」两级取值与映射解析，写库由调用方按「先主后子」顺序执行。
 */
import type {
  DocConfig,
  DocMapping,
  DocSource,
  DocSubConfig,
  FieldMetaLite,
} from '../types';
import { getTableName, isEditableType, isLinkType, listFieldsCached } from './baseService';
import { extractLinkIds, getRecordById, getRecordsByIds } from './recordService';
import { isEmptyValue } from '../utils/valueConverter';

function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

/** 单据配置是否足以启用新增页 */
export function docReady(doc?: DocConfig): boolean {
  return !!(
    doc?.enabled &&
    doc.contractFieldId &&
    (doc.subs ?? []).some((s) => s.tableId && s.linkFieldId)
  );
}

export interface DocSubMeta {
  tableId: string;
  /** 数据表名称，用作子表区块标题 */
  tableName: string;
  linkFieldId: string;
  fields: FieldMetaLite[];
  mapping?: DocMapping;
  required: string[];
}

export interface DocMeta {
  /** 主表上的合同关联字段 id */
  contractFieldId: string;
  /** 合同表上的客户关联字段 id */
  customerFieldId: string;
  contractTableId: string;
  customerTableId: string;
  contractFields: FieldMetaLite[];
  customerFields: FieldMetaLite[];
  subMetas: DocSubMeta[];
  /** 元信息/映射异常提示（EX1）：只提示，不阻断子表新增行 */
  warnings: string[];
}

/**
 * 读取单据涉及的所有表字段元信息。
 * 合同表/客户表能读到才谈得上带出；读不到时进 warnings，新增页仍可手动填写。
 */
export async function loadDocMeta(
  doc: DocConfig | undefined,
  mainFields: FieldMetaLite[],
): Promise<DocMeta> {
  const warnings: string[] = [];
  const contractFieldId = doc?.contractFieldId ?? '';
  const customerFieldId = doc?.customerFieldId ?? '';
  const contractField = mainFields.find((f) => f.id === contractFieldId);
  const contractTableId = contractField?.linkTableId ?? '';
  if (contractFieldId && !contractTableId) {
    warnings.push('主表的合同关联字段读不到目标表，合同字段无法自动带出');
  }

  let contractFields: FieldMetaLite[] = [];
  if (contractTableId) {
    try {
      contractFields = await listFieldsCached(contractTableId);
    } catch (e) {
      warnings.push(`合同表字段读取失败：${errMsg(e)}`);
    }
  }

  const customerField = contractFields.find((f) => f.id === customerFieldId);
  const customerTableId = customerField?.linkTableId ?? '';
  if (customerFieldId && !customerTableId) {
    warnings.push('合同表上的客户关联字段读不到目标表，客户信息无法自动带出');
  }

  let customerFields: FieldMetaLite[] = [];
  if (customerTableId) {
    try {
      customerFields = await listFieldsCached(customerTableId);
    } catch (e) {
      warnings.push(`客户表字段读取失败：${errMsg(e)}`);
    }
  }

  const subMetas: DocSubMeta[] = [];
  for (const sub of doc?.subs ?? []) {
    if (!sub.tableId || !sub.linkFieldId) continue;
    let fields: FieldMetaLite[] = [];
    try {
      fields = await listFieldsCached(sub.tableId);
    } catch (e) {
      warnings.push(`子表字段读取失败：${errMsg(e)}`);
    }
    const tableName = (await getTableName(sub.tableId)) || '';
    subMetas.push({
      tableId: sub.tableId,
      tableName,
      linkFieldId: sub.linkFieldId,
      fields,
      mapping: sub.mapping,
      required: sub.required ?? [],
    });
  }
  if (!subMetas.length) warnings.push('未配置可用的子表，新增页无法生成子表记录');

  return {
    contractFieldId,
    customerFieldId,
    contractTableId,
    customerTableId,
    contractFields,
    customerFields,
    subMetas,
    warnings,
  };
}

/** 三类来源可用的字段集合 */
export interface SourceFields {
  main: FieldMetaLite[];
  hop1: FieldMetaLite[];
  hop2: FieldMetaLite[];
}

export interface ResolvedMap {
  to: FieldMetaLite;
  src: DocSource;
  from: FieldMetaLite;
}

/** 目标字段是否可以写入带出值 */
function writableTarget(f: FieldMetaLite): boolean {
  return !f.unsupported && (isEditableType(f.type) || isLinkType(f.type));
}

function byName(fields: FieldMetaLite[]): Map<string, FieldMetaLite> {
  const m = new Map<string, FieldMetaLite>();
  fields.forEach((f) => {
    if (!m.has(f.name)) m.set(f.name, f);
  });
  return m;
}

/**
 * 解析带出映射：人工配置 → 默认来源的同名匹配。
 * 目标字段可显式指定来源（main/hop1/hop2）；未配置时按 defaultSrc 同名匹配。
 * 关联类来源只能落到关联类目标，避免把关联值写进文本字段。
 */
export function resolveMapping(
  targets: FieldMetaLite[],
  sources: SourceFields,
  mapping: DocMapping | undefined,
  defaultSrc: DocSource,
  skipTargetIds: string[] = [],
): ResolvedMap[] {
  const skip = new Set(skipTargetIds);
  const items = new Map(
    (mapping?.items ?? []).filter((it) => it && it.to).map((it) => [it.to, it]),
  );
  const named: Record<DocSource, Map<string, FieldMetaLite>> = {
    main: byName(sources.main),
    hop1: byName(sources.hop1),
    hop2: byName(sources.hop2),
  };

  const out: ResolvedMap[] = [];
  targets.forEach((to) => {
    if (skip.has(to.id) || !writableTarget(to)) return;
    const item = items.get(to.id);
    let src: DocSource;
    let from: FieldMetaLite | undefined;
    if (item) {
      if (!item.from) return; // 显式不带出
      src = item.src;
      from = (sources[src] ?? []).find((f) => f.id === item.from);
    } else {
      src = defaultSrc;
      from = named[defaultSrc].get(to.name);
    }
    if (!from) return;
    if (isLinkType(from.type) !== isLinkType(to.type)) return;
    out.push({ to, src, from });
  });
  return out;
}

/** 合同/客户两级记录原始字段值 */
export interface DocSourceData {
  hop1?: Record<string, unknown>;
  hop2?: Record<string, unknown>;
  /** 是否取到合同关联的客户记录 */
  hasHop2: boolean;
}

/**
 * 读取合同记录及其关联的客户记录字段原始值。
 * 合同记录读不到会抛出（合同无效/无权限）；客户信息取不到只置 hasHop2=false（EX2/EX3）。
 */
export async function fetchDocFillData(
  meta: DocMeta,
  contractRecordId: string,
): Promise<DocSourceData> {
  const contract = await getRecordById(meta.contractTableId, contractRecordId);
  const hop1 = contract.fields;

  const customerIds =
    meta.customerFieldId && meta.customerTableId
      ? extractLinkIds(contract.fields[meta.customerFieldId])
      : [];
  if (!customerIds.length) return { hop1, hasHop2: false };

  try {
    const rows = await getRecordsByIds(meta.customerTableId, [customerIds[0]]);
    const customer = rows[0];
    if (!customer) return { hop1, hasHop2: false };
    return { hop1, hop2: customer.fields, hasHop2: true };
  } catch {
    return { hop1, hasHop2: false };
  }
}

/** 按解析结果从来源记录取值（用于主表带出；子表在表单内按来源实时计算） */
export function collectAuto(
  pairs: ResolvedMap[],
  data: DocSourceData,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  pairs.forEach((p) => {
    const row = p.src === 'hop1' ? data.hop1 : p.src === 'hop2' ? data.hop2 : undefined;
    if (!row) return;
    const raw = row[p.from.id];
    if (!isEmptyValue(raw)) out[p.to.id] = raw;
  });
  return out;
}

/** 子表可填字段：去掉指向主表的关联字段与其它关联字段 */
export function subTargets(sub: DocSubConfig | DocSubMeta, fields: FieldMetaLite[]): FieldMetaLite[] {
  return fields.filter(
    (f) =>
      f.id !== sub.linkFieldId && !f.unsupported && isEditableType(f.type) && !isLinkType(f.type),
  );
}
