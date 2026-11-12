import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Empty, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldMetaLite, PluginData, DocSource } from '../../types';
import { uid, visibleFieldIds } from '../../utils/configOps';
import { fieldLabel } from '../../utils/validator';
import {
  buildFieldValue,
  formatCellValue,
  formatDateTime,
  isEmptyValue,
  toFormValue,
  type FormValue,
} from '../../utils/valueConverter';
import {
  isEditableType,
  isLinkType,
  listSelectOptions,
  type SelectOptionLite,
} from '../../services/baseService';
import {
  addRecord,
  deleteRecord,
  listUserCandidates,
  type UserCandidate,
} from '../../services/recordService';
import {
  collectAuto,
  docReady,
  fetchDocFillData,
  loadDocMeta,
  resolveMapping,
  subTargets,
  type DocMeta,
  type DocSourceData,
  type DocSubMeta,
  type ResolvedMap,
  type SourceFields,
} from '../../services/docService';
import { FieldEditor } from './FieldEditor';
import { LinkFieldSelect } from './LinkFieldSelect';

const FT = FieldType as any;
const COLS = 2;

interface SubRowState {
  key: string;
  /** 用户填写的值 */
  values: Record<string, FormValue>;
}

interface MainRowState {
  key: string;
  /** 合同关联字段值（单选一条合同） */
  contractId: string;
  /** 用户填写的值 */
  values: Record<string, FormValue>;
  /** 合同/客户带出的原始单元格值（只读，提交时以系统带出值为准） */
  auto: Record<string, unknown>;
  /** 两级来源记录原始值（供子表按来源取数） */
  sourceData: DocSourceData | null;
  loading: boolean;
  fillError: string;
  /** 子表 tableId → 行列表 */
  subs: Record<string, SubRowState[]>;
}

interface Props {
  open: boolean;
  config: PluginData;
  fields: FieldMetaLite[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}

function isBlank(v: FormValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return Number.isNaN(v);
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

/** 带出字段的展示文本：靠原始单元格值渲染，选项类字段再按原生选项翻译成名称 */
function autoText(raw: unknown, field: FieldMetaLite, options: SelectOptionLite[]): string {
  const optionsText = (): string => {
    if (field.type !== FT.SingleSelect && field.type !== FT.MultiSelect) return '';
    if (!options.length) return '';
    const items = Array.isArray(raw) ? raw : [raw];
    const names = items
      .map((item) => {
        const id = typeof item === 'string' ? item : String((item as any)?.id ?? (item as any)?.text ?? '');
        return options.find((o) => o.id === id || o.name === id)?.name ?? '';
      })
      .filter(Boolean);
    return names.join('、');
  };
  return optionsText() || formatCellValue(raw, field);
}

/** 表单值（可能来自主表/来源表）按目标字段渲染成展示文本 */
function displayText(
  value: FormValue | undefined,
  field: FieldMetaLite,
  options: SelectOptionLite[],
  users: UserCandidate[],
): string {
  if (value === undefined || value === null || value === '') return '';
  const pick = (id: string) =>
    options.find((o) => o.id === id || o.name === id)?.name ??
    users.find((u) => u.id === id)?.name ??
    id;
  if (field.type === FT.SingleSelect) return pick(String(value));
  if (field.type === FT.MultiSelect || field.type === FT.User) {
    return (Array.isArray(value) ? value : [value])
      .map((x) => pick(String(x)))
      .filter(Boolean)
      .join('、');
  }
  if (field.type === FT.DateTime) return formatDateTime(Number(value));
  if (field.type === FT.Checkbox) return value === true ? '是' : '';
  return formatCellValue(value, field) || String(value);
}

function sourceTag(src: DocSource): string {
  if (src === 'main') return '主表带出';
  if (src === 'hop1') return '合同带出';
  return '客户带出';
}

/**
 * 主子表单据新增页（如「项目立项单」）：
 * 选择合同 → 合同/客户字段带出到主表并置只读；每张子表自动新增 1 行，
 * 子表字段可按配置从主表值 / 合同记录 / 客户记录带出，其余字段由用户录入。
 * 支持逐条累加多条主表记录，保存时先主后子，任一步失败则补偿回滚。
 */
export function DocForm({ open, config, fields, onCancel, onSaved }: Props) {
  const doc = config.doc;
  const ready = docReady(doc);

  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [rows, setRows] = useState<MainRowState[]>([]);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<Record<string, string>>({});

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const cfgMap = useMemo(() => new Map(config.fields.map((c) => [c.fieldId, c])), [config.fields]);
  /** 主表上的合同关联字段（合同选择器 + 保存时写关联值） */
  const contractField = doc?.contractFieldId ? fieldMap.get(doc.contractFieldId) : undefined;

  /** 主表可填字段：按分组顺序展开，去掉合同关联字段与其它关联字段 */
  const mainDisplay = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    config.groups.forEach((g) =>
      visibleFieldIds(config, g).forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }),
    );
    return ids
      .filter((id) => id !== doc?.contractFieldId)
      .map((id) => fieldMap.get(id))
      .filter((f): f is FieldMetaLite => !!f && isEditableType(f.type) && !isLinkType(f.type));
  }, [config, fieldMap, doc?.contractFieldId]);

  /** 每张子表的可填字段 */
  const subTargetMap = useMemo(() => {
    const m = new Map<string, FieldMetaLite[]>();
    meta?.subMetas.forEach((sm) => m.set(sm.tableId, subTargets(sm, sm.fields)));
    return m;
  }, [meta]);

  /** 可作为「主表来源」的字段：与配置面板口径一致（去掉合同关联字段与关联字段） */
  const mainSourceFields = useMemo(
    () =>
      fields.filter(
        (f) =>
          f.id !== doc?.contractFieldId &&
          !f.unsupported &&
          isEditableType(f.type) &&
          !isLinkType(f.type),
      ),
    [fields, doc?.contractFieldId],
  );

  /** 三类来源可用字段 */
  const sourceFields = useMemo<SourceFields>(
    () => ({
      main: mainSourceFields,
      hop1: meta?.contractFields ?? [],
      hop2: meta?.customerFields ?? [],
    }),
    [mainSourceFields, meta],
  );

  const mainPairs = useMemo(
    () => (meta ? resolveMapping(mainDisplay, sourceFields, doc?.main, 'hop1') : []),
    [meta, mainDisplay, sourceFields, doc?.main],
  );

  /** 子表 tableId → (目标字段 id → 来源解析) */
  const subResolved = useMemo(() => {
    const m = new Map<string, Map<string, ResolvedMap>>();
    meta?.subMetas.forEach((sm) => {
      const targets = subTargetMap.get(sm.tableId) ?? [];
      const pairs = resolveMapping(targets, sourceFields, sm.mapping, 'main');
      m.set(sm.tableId, new Map(pairs.map((p) => [p.to.id, p])));
    });
    return m;
  }, [meta, subTargetMap, sourceFields]);

  /** 是否有子表字段配置为从客户记录带出（用于客户信息缺失提示） */
  const hasHop2Mapping = useMemo(() => {
    for (const map of subResolved.values()) {
      for (const p of map.values()) if (p.src === 'hop2') return true;
    }
    return false;
  }, [subResolved]);

  /** 全部子表可填字段，用于加载选项/人员候选 */
  const allSubFields = useMemo(() => {
    const list: Array<[string, FieldMetaLite]> = [];
    meta?.subMetas.forEach((sm) =>
      (subTargetMap.get(sm.tableId) ?? []).forEach((f) => list.push([sm.tableId, f])),
    );
    return list;
  }, [meta, subTargetMap]);

  // 选项/人员候选：单选多选走原生选项，人员字段取列内已有人员
  const [options, setOptions] = useState<Record<string, SelectOptionLite[]>>({});
  const [users, setUsers] = useState<Record<string, UserCandidate[]>>({});

  useEffect(() => {
    if (!open || !meta) return;
    let alive = true;
    const targets: Array<[string, FieldMetaLite]> = [];
    if (config.tableId) mainDisplay.forEach((f) => targets.push([config.tableId as string, f]));
    allSubFields.forEach(([t, f]) => targets.push([t, f]));
    targets.forEach(([tableId, f]) => {
      const key = `${tableId}:${f.id}`;
      if (f.type === FT.SingleSelect || f.type === FT.MultiSelect) {
        if (options[key]) return;
        listSelectOptions(tableId, f.id)
          .then((list) => {
            if (alive) setOptions((prev) => ({ ...prev, [key]: list }));
          })
          .catch(() => undefined);
      } else if (f.type === FT.User) {
        if (users[key]) return;
        listUserCandidates(tableId, f.id)
          .then((list) => {
            if (alive) setUsers((prev) => ({ ...prev, [key]: list }));
          })
          .catch(() => undefined);
      }
    });
    return () => {
      alive = false;
    };
  }, [open, meta, config.tableId, mainDisplay, allSubFields, options, users]);

  // 元信息：合同表 / 客户表 / 各子表字段
  useEffect(() => {
    if (!open || !ready) return;
    let alive = true;
    setMetaLoading(true);
    setMetaError('');
    loadDocMeta(doc, fields)
      .then((m) => {
        if (alive) setMeta(m);
      })
      .catch((e) => {
        if (alive) setMetaError(`读取单据配置失败：${errMsg(e)}`);
      })
      .finally(() => {
        if (alive) setMetaLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, doc, fields]);

  const newSubRow = (): SubRowState => ({ key: uid('s'), values: {} });

  /** 每张配置的子表各生成 1 行（E1/A7、E2/A3） */
  const emptySubs = (): Record<string, SubRowState[]> => {
    const out: Record<string, SubRowState[]> = {};
    meta?.subMetas.forEach((sm) => {
      out[sm.tableId] = [newSubRow()];
    });
    return out;
  };

  const newMainRow = (): MainRowState => ({
    key: uid('m'),
    contractId: '',
    values: {},
    auto: {},
    sourceData: null,
    loading: false,
    fillError: '',
    subs: emptySubs(),
  });

  // 打开即给一行空白主表记录（E0/E2：每次只追加一条，由用户逐条新增）
  useEffect(() => {
    if (!open || !meta) return;
    setRows([newMainRow()]);
    setMissing({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meta]);

  if (!open) return null;

  const patchRow = (key: string, patch: Partial<MainRowState>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const patchSubValues = (
    rowKey: string,
    tableId: string,
    subKey: string,
    values: Record<string, FormValue>,
  ) =>
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? {
              ...r,
              subs: {
                ...r.subs,
                [tableId]: (r.subs[tableId] ?? []).map((s) =>
                  s.key === subKey ? { ...s, values } : s,
                ),
              },
            }
          : r,
      ),
    );

  const mainValueOf = (row: MainRowState, field: FieldMetaLite): FormValue =>
    row.auto[field.id] !== undefined ? toFormValue(row.auto[field.id], field) : row.values[field.id];

  /** 子表字段有效值：有映射且来源有值 → 自动带出（只读）；否则取用户输入 */
  const subValueOf = (
    row: MainRowState,
    sub: SubRowState,
    field: FieldMetaLite,
    resolved: ResolvedMap | undefined,
  ): { value: FormValue | undefined; auto: boolean } => {
    if (!resolved) return { value: sub.values[field.id], auto: false };
    if (resolved.src === 'hop1' || resolved.src === 'hop2') {
      const rawRow = resolved.src === 'hop1' ? row.sourceData?.hop1 : row.sourceData?.hop2;
      const raw = rawRow?.[resolved.from.id];
      if (!isEmptyValue(raw)) return { value: toFormValue(raw, field), auto: true };
      return { value: sub.values[field.id], auto: false };
    }
    // main：取主表当前记录的生效值（含主表带出值）
    const mv = mainValueOf(row, resolved.from);
    if (!isBlank(mv)) return { value: mv, auto: true };
    return { value: sub.values[field.id], auto: false };
  };

  const optionsOf = (tableId: string | undefined, field: FieldMetaLite): SelectOptionLite[] =>
    tableId ? options[`${tableId}:${field.id}`] ?? [] : [];

  const userOptionsOf = (tableId: string | undefined, field: FieldMetaLite): UserCandidate[] =>
    tableId ? users[`${tableId}:${field.id}`] ?? [] : [];

  /** E1：选择合同后按配置带出主表字段，并为每张子表强制新增 1 行 */
  const handleContractChange = async (rowKey: string, contractId: string) => {
    patchRow(rowKey, { contractId, loading: !!contractId, fillError: '' });
    if (!contractId || !meta) {
      patchRow(rowKey, { auto: {}, sourceData: null, subs: emptySubs(), loading: false });
      return;
    }
    try {
      const data = await fetchDocFillData(meta, contractId);
      patchRow(rowKey, {
        auto: collectAuto(mainPairs, data),
        sourceData: data,
        subs: emptySubs(),
        loading: false,
        fillError:
          hasHop2Mapping && !data.hasHop2
            ? '未查询到合同关联的客户信息，相关字段请手动填写'
            : '',
      });
    } catch (e) {
      // EX1/EX3：带出失败不阻断，保留待手动填写的行
      patchRow(rowKey, {
        auto: {},
        sourceData: null,
        subs: emptySubs(),
        loading: false,
        fillError: `合同信息带出失败：${errMsg(e)}，请手动填写`,
      });
    }
  };

  /** E3 + V6：校验 → 先主后子逐条写入 → 失败补偿回滚 */
  const handleSubmit = async () => {
    const miss: Record<string, string> = {};
    const tips: string[] = [];
    const requiredMain = config.fields
      .filter((c) => c.required && mainDisplay.some((f) => f.id === c.fieldId))
      .map((c) => mainDisplay.find((f) => f.id === c.fieldId))
      .filter((f): f is FieldMetaLite => !!f);

    rows.forEach((row, i) => {
      const label = `第 ${i + 1} 条主表记录`;
      if (!row.contractId) miss[`${row.key}:contract`] = '合同';
      requiredMain.forEach((f) => {
        if (isBlank(mainValueOf(row, f))) miss[`${row.key}:${f.id}`] = f.name;
      });
      meta?.subMetas.forEach((sm) => {
        const targets = subTargetMap.get(sm.tableId) ?? [];
        const tableLabel = sm.tableName || '子表';
        const subs = row.subs[sm.tableId] ?? [];
        if (!subs.length) tips.push(`${label}缺少「${tableLabel}」记录`);
        const requiredFields = sm.required
          .map((id) => targets.find((f) => f.id === id))
          .filter((f): f is FieldMetaLite => !!f);
        subs.forEach((sub) => {
          requiredFields.forEach((f) => {
            const resolved = subResolved.get(sm.tableId)?.get(f.id);
            if (isBlank(subValueOf(row, sub, f, resolved).value)) {
              miss[`${row.key}:${sm.tableId}:${sub.key}:${f.id}`] = `${tableLabel}·${f.name}`;
            }
          });
        });
      });
    });

    if (Object.keys(miss).length || tips.length) {
      setMissing(miss);
      const detail = [...Object.values(miss).map((n) => `「${n}」未填写`), ...tips].slice(0, 5);
      Toast.error(`提交前请先补全：${detail.join('、')}`);
      return;
    }

    if (!meta) return;
    setSaving(true);
    const createdMain: string[] = [];
    const createdSub: Array<{ tableId: string; id: string }> = [];
    const tableId = config.tableId as string;

    try {
      for (const row of rows) {
        // 主表：带出字段以系统值为准，其余取用户输入
        const mainPayload: Record<string, unknown> = {};
        mainDisplay.forEach((f) => {
          const built = buildFieldValue(f.type, mainValueOf(row, f), f.linkTableId);
          if (built !== undefined) mainPayload[f.id] = built;
        });
        if (contractField && row.contractId) {
          const link = buildFieldValue(contractField.type, [row.contractId], contractField.linkTableId);
          if (link !== undefined) mainPayload[contractField.id] = link;
        }
        const mainRecordId = await addRecord(tableId, mainPayload);
        createdMain.push(mainRecordId);

        // 子表：逐张写入，关联字段固定指向刚建好的主表记录（V4）
        for (const sm of meta.subMetas) {
          const targets = subTargetMap.get(sm.tableId) ?? [];
          const linkType = sm.fields.find((f) => f.id === sm.linkFieldId)?.type ?? FT.DuplexLink;
          for (const sub of row.subs[sm.tableId] ?? []) {
            const payload: Record<string, unknown> = {};
            targets.forEach((f) => {
              const resolved = subResolved.get(sm.tableId)?.get(f.id);
              const built = buildFieldValue(f.type, subValueOf(row, sub, f, resolved).value, f.linkTableId);
              if (built !== undefined) payload[f.id] = built;
            });
            payload[sm.linkFieldId] = buildFieldValue(linkType, [mainRecordId], tableId);
            const subRecordId = await addRecord(sm.tableId, payload);
            createdSub.push({ tableId: sm.tableId, id: subRecordId });
          }
        }
      }
      onSaved(`已新增 ${createdMain.length} 条记录、${createdSub.length} 条子表记录`);
    } catch (e) {
      // EX5：先删子表再删主表，逆序补偿，避免留下半成品
      for (const s of [...createdSub].reverse()) {
        try {
          await deleteRecord(s.tableId, s.id);
        } catch {
          /* 回滚失败只在提示里体现，不覆盖原始错误 */
        }
      }
      for (const id of [...createdMain].reverse()) {
        try {
          await deleteRecord(tableId, id);
        } catch {
          /* 同上 */
        }
      }
      Toast.error(`保存失败，已回滚本次新增：${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const title = doc?.name?.trim() || '业务单据';

  const addSubRow = (rowKey: string, tableId: string) =>
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? { ...r, subs: { ...r.subs, [tableId]: [...(r.subs[tableId] ?? []), newSubRow()] } }
          : r,
      ),
    );

  const removeSubRow = (rowKey: string, tableId: string, subKey: string) =>
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? { ...r, subs: { ...r.subs, [tableId]: (r.subs[tableId] ?? []).filter((s) => s.key !== subKey) } }
          : r,
      ),
    );

  const renderSubRow = (
    row: MainRowState,
    sm: DocSubMeta,
    sub: SubRowState,
    index: number,
    targets: FieldMetaLite[],
  ) => {
    const tableLabel = sm.tableName || '子表';
    const resolvedMap = subResolved.get(sm.tableId);
    const autoCount = targets.filter(
      (f) => subValueOf(row, sub, f, resolvedMap?.get(f.id)).auto,
    ).length;
    return (
      <div className="doc-sub-row" key={sub.key}>
        <div className="doc-sub-head">
          <span className="doc-sub-title">
            {tableLabel} #{index + 1}
          </span>
          {autoCount > 0 ? (
            <Tag size="small" color="green">
              自动带出 {autoCount} 项
            </Tag>
          ) : (
            <Tag size="small" color="grey">
              待手动填写
            </Tag>
          )}
          {(row.subs[sm.tableId] ?? []).length > 1 ? (
            <Button
              theme="borderless"
              type="danger"
              size="small"
              disabled={saving}
              onClick={() => removeSubRow(row.key, sm.tableId, sub.key)}
            >
              删除本行
            </Button>
          ) : null}
        </div>
        <div className={`form-grid cols-${COLS}`}>
          {targets.map((field) => {
            const resolved = resolvedMap?.get(field.id);
            const { value, auto } = subValueOf(row, sub, field, resolved);
            const isMissing = !!missing[`${row.key}:${sm.tableId}:${sub.key}:${field.id}`];
            const required = sm.required.includes(field.id);
            return (
              <div className={`form-item${isMissing ? ' missing' : ''}`} key={field.id}>
                <label className="form-label">
                  {fieldLabel(field, cfgMap.get(field.id))}
                  {required ? <i className="field-required">*</i> : null}
                </label>
                {auto ? (
                  <div className="form-readonly">
                    {displayText(
                      value,
                      field,
                      optionsOf(sm.tableId, field),
                      userOptionsOf(sm.tableId, field),
                    ) || '—'}
                    <Tag size="small" color="green">
                      {sourceTag(resolved?.src ?? 'main')}
                    </Tag>
                  </div>
                ) : (
                  <FieldEditor
                    field={field}
                    value={sub.values[field.id]}
                    onChange={(v) =>
                      patchSubValues(row.key, sm.tableId, sub.key, {
                        ...sub.values,
                        [field.id]: v,
                      })
                    }
                    options={optionsOf(sm.tableId, field)}
                    userOptions={userOptionsOf(sm.tableId, field)}
                    linkTableId={field.linkTableId}
                    label={fieldLabel(field, cfgMap.get(field.id))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      className="form-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="form-panel doc-panel">
        <header className="form-head">
          <div>
            <h2>{title}新增</h2>
            <span className="cfg-hint">
              选择合同后自动带出合同与关联信息（只读）；每张子表会自动新增 1 行，其余字段请逐条录入。
            </span>
          </div>
          <Button theme="borderless" onClick={onCancel}>
            关闭
          </Button>
        </header>

        <div className="form-body">
          {!ready ? (
            <div className="cfg-empty">
              单据新增尚未配置完成：请在配置面板「主子表单据」中选择合同关联字段，并至少配置一张子表及其关联字段后保存。
            </div>
          ) : metaLoading ? (
            <div className="doc-loading">
              <Spin />
            </div>
          ) : metaError ? (
            <Banner type="danger" description={metaError} closeIcon={null} />
          ) : !meta ? (
            <Empty title="暂无单据配置" />
          ) : (
            <>
              {meta.warnings.length ? (
                <Banner
                  type="warning"
                  description={meta.warnings.join('；')}
                  closeIcon={null}
                  style={{ marginBottom: 12 }}
                />
              ) : null}

              {rows.map((row, i) => (
                <section className="doc-row" key={row.key}>
                  <div className="doc-row-head">
                    <h3>主表记录 #{i + 1}</h3>
                    {rows.length > 1 ? (
                      <Button
                        theme="borderless"
                        type="danger"
                        size="small"
                        disabled={saving}
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      >
                        删除本行
                      </Button>
                    ) : null}
                  </div>

                  <div
                    className={`form-item doc-contract${missing[`${row.key}:contract`] ? ' missing' : ''}`}
                  >
                    <label className="form-label">
                      合同
                      <i className="field-required">*</i>
                    </label>
                    {meta.contractTableId ? (
                      <LinkFieldSelect
                        single
                        tableId={meta.contractTableId}
                        value={row.contractId ? [row.contractId] : []}
                        onChange={(ids) => handleContractChange(row.key, ids[0] ?? '')}
                      />
                    ) : (
                      <div className="form-readonly">合同关联字段不可用，请检查配置</div>
                    )}
                  </div>

                  {row.loading ? (
                    <div className="doc-loading">
                      <Spin size="small" /> 正在带出合同信息…
                    </div>
                  ) : null}
                  {row.fillError ? (
                    <Banner type="warning" description={row.fillError} closeIcon={null} />
                  ) : null}

                  <div className={`form-grid cols-${COLS}`}>
                    {mainDisplay.map((field) => {
                      const auto = row.auto[field.id] !== undefined;
                      const isMissing = !!missing[`${row.key}:${field.id}`];
                      const required = config.fields.some(
                        (c) => c.fieldId === field.id && c.required,
                      );
                      return (
                        <div className={`form-item${isMissing ? ' missing' : ''}`} key={field.id}>
                          <label className="form-label">
                            {fieldLabel(field, cfgMap.get(field.id))}
                            {required ? <i className="field-required">*</i> : null}
                          </label>
                          {auto ? (
                            <div className="form-readonly">
                              {autoText(row.auto[field.id], field, optionsOf(config.tableId, field)) || '—'}
                              <Tag size="small" color="green">
                                自动带出
                              </Tag>
                            </div>
                          ) : (
                            <FieldEditor
                              field={field}
                              value={row.values[field.id]}
                              onChange={(v) =>
                                patchRow(row.key, { values: { ...row.values, [field.id]: v } })
                              }
                              options={optionsOf(config.tableId, field)}
                              userOptions={userOptionsOf(config.tableId, field)}
                              linkTableId={field.linkTableId}
                              label={fieldLabel(field, cfgMap.get(field.id))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {meta.subMetas.map((sm) => {
                    const targets = subTargetMap.get(sm.tableId) ?? [];
                    const tableLabel = sm.tableName || '子表';
                    const subs = row.subs[sm.tableId] ?? [];
                    return (
                      <div className="doc-sub" key={sm.tableId}>
                        <div className="doc-sub-head-bar">
                          <h4>{tableLabel}</h4>
                          <Button size="small" disabled={saving} onClick={() => addSubRow(row.key, sm.tableId)}>
                            + 新增{tableLabel}行
                          </Button>
                        </div>
                        {subs.length ? (
                          subs.map((sub, j) => renderSubRow(row, sm, sub, j, targets))
                        ) : (
                          <div className="form-error">每张子表至少需要 1 行记录</div>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}

              <Button
                theme="outline"
                disabled={saving || !meta.contractTableId}
                onClick={() => setRows((prev) => [...prev, newMainRow()])}
              >
                + 新增一条主表记录
              </Button>
            </>
          )}
        </div>

        <footer className="form-foot">
          <span className="cfg-hint" style={{ marginRight: 'auto' }}>
            保存时先写主表、再逐张写子表；任一步失败会回滚本次全部新增。
          </span>
          <Button onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button
            theme="solid"
            type="primary"
            loading={saving}
            disabled={!ready || metaLoading || !!metaError || !rows.length}
            onClick={handleSubmit}
          >
            提交新增
          </Button>
        </footer>
      </div>
    </div>
  );
}
