import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Spin, Switch, Tag } from '@douyinfe/semi-ui';
import type {
  DocMapping,
  DocSource,
  DocSubConfig,
  FieldMetaLite,
  PluginData,
  TableMetaLite,
} from '../../types';
import { emptyDocConfig, updateDoc } from '../../utils/configOps';
import { isEditableType, isLinkType, isReadonlyType, listFields } from '../../services/baseService';

interface Props {
  config: PluginData;
  fields: FieldMetaLite[];
  tables: TableMetaLite[];
  onChange: (next: PluginData) => void;
}

const AUTO = '';
const NONE = '__none__';

interface SourceGroup {
  src: DocSource;
  label: string;
  fields: FieldMetaLite[];
}

function isSource(v: string): v is DocSource {
  return v === 'main' || v === 'hop1' || v === 'hop2';
}

/** 更新单个目标字段的带出来源：自动同名 / 指定来源字段 / 不带出 */
function setMapping(
  mapping: DocMapping | undefined,
  targetId: string,
  value: string,
  defaultSrc: DocSource,
): DocMapping {
  const items = (mapping?.items ?? []).filter((it) => it.to !== targetId);
  if (value === NONE) {
    items.push({ to: targetId, src: defaultSrc, from: '' });
  } else if (value && value !== AUTO) {
    const [src, from] = value.split('|');
    if (from && isSource(src)) items.push({ to: targetId, src, from });
  }
  return { items };
}

function currentSource(mapping: DocMapping | undefined, targetId: string): string {
  const item = mapping?.items?.find((it) => it.to === targetId);
  if (!item) return AUTO;
  return item.from ? `${item.src}|${item.from}` : NONE;
}

/** 可带出的来源字段：含查找引用 / 公式等只读字段（值可被引用），排除关联与按钮 */
function sourceCandidates(list: FieldMetaLite[], excludeId?: string): FieldMetaLite[] {
  return list.filter(
    (f) =>
      f.id !== excludeId &&
      !f.unsupported &&
      !f.isButton &&
      !isLinkType(f.type) &&
      (isEditableType(f.type) || isReadonlyType(f.type)),
  );
}

/** 可写入的带出目标字段：仅可编辑、非关联 */
function targetCandidates(list: FieldMetaLite[], excludeId?: string): FieldMetaLite[] {
  return list.filter(
    (f) =>
      f.id !== excludeId && !f.unsupported && isEditableType(f.type) && !isLinkType(f.type),
  );
}

/**
 * 主子表单据（如「项目立项单」）新增配置：
 * 指定合同关联字段、合同表上的客户关联字段，并可配置多张子表；
 * 每张子表可单独指定关联字段、必填字段，以及每个字段的带出来源（主表 / 合同 / 客户）。
 */
export function DocSection({ config, fields, tables, onChange }: Props) {
  const doc = config.doc ?? emptyDocConfig();
  const enabled = !!doc.enabled;
  const subs = doc.subs ?? [];

  const [contractFields, setContractFields] = useState<FieldMetaLite[]>([]);
  const [customerFields, setCustomerFields] = useState<FieldMetaLite[]>([]);
  const [subFieldMap, setSubFieldMap] = useState<Record<string, FieldMetaLite[]>>({});
  const [loading, setLoading] = useState(false);

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const linkFields = fields.filter((f) => isLinkType(f.type));
  const contractField = doc.contractFieldId ? fieldMap.get(doc.contractFieldId) : undefined;
  const contractTableId = contractField?.linkTableId ?? '';
  const customerField = contractFields.find((f) => f.id === doc.customerFieldId);
  const customerTableId = customerField?.linkTableId ?? '';

  // 合同表字段
  useEffect(() => {
    if (!contractTableId) {
      setContractFields([]);
      return;
    }
    let alive = true;
    setLoading(true);
    listFields(contractTableId)
      .then((list) => {
        if (alive) setContractFields(list.filter((f) => !f.unsupported));
      })
      .catch(() => {
        if (alive) setContractFields([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [contractTableId]);

  // 客户表字段
  useEffect(() => {
    if (!customerTableId) {
      setCustomerFields([]);
      return;
    }
    let alive = true;
    setLoading(true);
    listFields(customerTableId)
      .then((list) => {
        if (alive) setCustomerFields(list.filter((f) => !f.unsupported));
      })
      .catch(() => {
        if (alive) setCustomerFields([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [customerTableId]);

  // 各子表字段（按已配置的子表 id 批量读取）
  const subTableKey = subs.map((s) => s.tableId).filter(Boolean).join('|');
  useEffect(() => {
    const ids = Array.from(new Set(subTableKey.split('|').filter(Boolean)));
    if (!ids.length) {
      setSubFieldMap({});
      return;
    }
    let alive = true;
    setLoading(true);
    Promise.all(
      ids.map((id) =>
        listFields(id)
          .then((list) => [id, list.filter((f) => !f.unsupported)] as const)
          .catch(() => [id, [] as FieldMetaLite[]] as const),
      ),
    )
      .then((entries) => {
        if (alive) setSubFieldMap(Object.fromEntries(entries));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [subTableKey]);

  const patchSubs = (next: DocSubConfig[]) => onChange(updateDoc(config, { subs: next }));
  const updateSub = (index: number, patch: Partial<DocSubConfig>) =>
    patchSubs(subs.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const addSub = () => patchSubs([...subs, { tableId: '', linkFieldId: '' }]);
  const removeSub = (index: number) => patchSubs(subs.filter((_, i) => i !== index));

  /** 可被带出的主表目标字段：去掉合同关联字段本身与其它关联字段 */
  const mainTargets = targetCandidates(fields, doc.contractFieldId);
  const mainSources = sourceCandidates(fields, doc.contractFieldId);
  const hop1Sources = sourceCandidates(contractFields);
  const hop2Sources = sourceCandidates(customerFields);

  const mainGroups: SourceGroup[] = [
    { src: 'hop1', label: '合同', fields: hop1Sources },
    { src: 'hop2', label: '客户', fields: hop2Sources },
  ];

  const renderMappingRows = (
    targets: FieldMetaLite[],
    groups: SourceGroup[],
    defaultSrc: DocSource,
    defaultLabel: string,
    mapping: DocMapping | undefined,
    onMapping: (next: DocMapping) => void,
  ) =>
    targets.map((target) => {
      const defaultFields = groups.find((g) => g.src === defaultSrc)?.fields ?? [];
      const sameName = defaultFields.find((f) => f.name === target.name);
      return (
        <div className="doc-map-row" key={target.id}>
          <span className="doc-map-target">{target.name}</span>
          <Select
            size="small"
            filter
            className="doc-map-select"
            value={currentSource(mapping, target.id)}
            optionList={[
              {
                label: `自动（${defaultLabel}同名）：${sameName ? sameName.name : '无同名字段'}`,
                value: AUTO,
              },
              { label: '不带出', value: NONE },
              ...groups.flatMap((g) =>
                g.fields.map((f) => ({
                  label: `${g.label}：${f.name}${isReadonlyType(f.type) ? '（只读）' : ''}`,
                  value: `${g.src}|${f.id}`,
                })),
              ),
            ]}
            onChange={(v) => onMapping(setMapping(mapping, target.id, String(v ?? AUTO), defaultSrc))}
          />
        </div>
      );
    });

  const allTables = tables.filter((t) => t.id !== config.tableId);

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <h2>6. 主子表单据新增</h2>
        {loading ? <Spin size="small" /> : null}
        <Switch checked={enabled} onChange={(v) => onChange(updateDoc(config, { enabled: !!v }))} />
      </div>
      <p className="cfg-hint">
        启用后浏览页出现「新增{config.doc?.name?.trim() || '单据'}」入口：选择合同后，合同字段按映射自动带出到主表记录并置为只读；
        子表以「字段做列、记录做行」的表格录入，字段可按配置从主表 / 合同 / 客户带出（可选查找引用等只读字段）。
        来源为多值（查找引用 / 多选）且目标为单选时，每个值生成一行（如合同产品线）。
        保存时先写主表再逐张写子表，任一步失败会回滚本次全部新增。
      </p>

      {!enabled ? (
        <div className="cfg-empty">未启用，浏览页不显示单据新增入口</div>
      ) : (
        <>
          <div className="doc-cfg-row">
            <span className="doc-cfg-label">单据名称</span>
            <Input
              size="small"
              className="doc-cfg-input"
              value={doc.name ?? ''}
              placeholder="项目立项单"
              onChange={(v) => onChange(updateDoc(config, { name: v }))}
            />
            <span className="cfg-hint">用于入口按钮与页面标题</span>
          </div>

          <div className="doc-cfg-row">
            <span className="doc-cfg-label">合同关联字段</span>
            {linkFields.length ? (
              <Select
                size="small"
                className="doc-cfg-input"
                value={doc.contractFieldId ?? ''}
                placeholder="主表上指向合同表的关联字段"
                optionList={linkFields.map((f) => ({ label: f.name, value: f.id }))}
                onChange={(v) =>
                  onChange(updateDoc(config, { contractFieldId: String(v ?? ''), customerFieldId: '' }))
                }
              />
            ) : (
              <span className="cfg-hint">主表没有关联字段，无法选合同</span>
            )}
            {contractField && !contractTableId ? (
              <Tag size="small" color="orange">
                读不到合同表
              </Tag>
            ) : null}
          </div>

          <div className="doc-cfg-row">
            <span className="doc-cfg-label">客户关联字段</span>
            <Select
              size="small"
              className="doc-cfg-input"
              disabled={!contractTableId}
              value={doc.customerFieldId ?? ''}
              placeholder={contractTableId ? '合同表上指向客户表的关联字段' : '请先选择合同关联字段'}
              optionList={contractFields
                .filter((f) => isLinkType(f.type))
                .map((f) => ({ label: f.name, value: f.id }))}
              onChange={(v) => onChange(updateDoc(config, { customerFieldId: String(v ?? '') }))}
            />
            <span className="cfg-hint">客户信息从该字段关联的记录带出</span>
          </div>

          <div className="doc-map">
            <div className="doc-map-head">
              <h3>合同 / 客户 → 主表 带出字段</h3>
              <span className="cfg-hint">
                默认按合同字段同名自动带出，可逐项改为指定来源或不带出；
                已指定来源但未加入展示分组的字段，也会出现在单据表单中按来源带出（只读）
              </span>
            </div>
            {!contractTableId ? (
              <div className="cfg-empty">请先选择可用的合同关联字段</div>
            ) : mainTargets.length === 0 ? (
              <div className="cfg-empty">主表暂无可带出的字段</div>
            ) : (
              renderMappingRows(mainTargets, mainGroups, 'hop1', '合同', doc.main, (next) =>
                onChange(updateDoc(config, { main: next })),
              )
            )}
          </div>

          <div className="doc-sub-cfg-list">
            <div className="doc-map-head">
              <h3>子表（可多张）</h3>
              <span className="cfg-hint">每张子表在新增页按表格录入且至少保留 1 行，字段来源可逐项配置</span>
            </div>
            {subs.map((sub, idx) => {
              const subFields = subFieldMap[sub.tableId] ?? [];
              const tableOpts = allTables
                .filter(
                  (t) =>
                    t.id === sub.tableId ||
                    !subs.some((s, i) => i !== idx && s.tableId === t.id),
                )
                .map((t) => ({ label: t.name, value: t.id }));
              const linkCandidates = subFields.filter(
                (f) => isLinkType(f.type) && (!f.linkTableId || f.linkTableId === config.tableId),
              );
              const targets = targetCandidates(subFields, sub.linkFieldId);
              const tableName = tables.find((t) => t.id === sub.tableId)?.name ?? '未选择';
              return (
                <div className="doc-sub-cfg" key={sub.tableId || `sub-${idx}`}>
                  <div className="doc-sub-cfg-head">
                    <h3>
                      子表 {idx + 1}：{tableName}
                    </h3>
                    <Button
                      theme="borderless"
                      type="danger"
                      size="small"
                      onClick={() => removeSub(idx)}
                    >
                      删除
                    </Button>
                  </div>

                  <div className="doc-cfg-row">
                    <span className="doc-cfg-label">子表</span>
                    <Select
                      size="small"
                      filter
                      className="doc-cfg-input"
                      value={sub.tableId || ''}
                      placeholder="选择子表数据表（名称按数据表名称显示）"
                      optionList={tableOpts}
                      onChange={(v) =>
                        updateSub(idx, { tableId: String(v ?? ''), linkFieldId: '' })
                      }
                    />
                  </div>

                  <div className="doc-cfg-row">
                    <span className="doc-cfg-label">子表关联字段</span>
                    <Select
                      size="small"
                      className="doc-cfg-input"
                      disabled={!sub.tableId}
                      value={sub.linkFieldId || ''}
                      placeholder={sub.tableId ? '子表上指回主表的关联字段' : '请先选择子表'}
                      optionList={linkCandidates.map((f) => ({ label: f.name, value: f.id }))}
                      onChange={(v) => updateSub(idx, { linkFieldId: String(v ?? '') })}
                    />
                    <span className="cfg-hint">保存时自动写入对应的主表记录</span>
                  </div>

                  <div className="doc-cfg-row">
                    <span className="doc-cfg-label">子表必填字段</span>
                    <Select
                      multiple
                      filter
                      size="small"
                      className="doc-cfg-input"
                      maxTagCount={4}
                      value={sub.required ?? []}
                      placeholder={sub.tableId ? '提交时校验这些字段非空' : '请先选择子表'}
                      disabled={!sub.tableId}
                      optionList={targets.map((f) => ({ label: f.name, value: f.id }))}
                      onChange={(v) =>
                        updateSub(idx, { required: Array.isArray(v) ? v.map(String) : [] })
                      }
                    />
                  </div>

                  <div className="doc-map">
                    <div className="doc-map-head">
                      <h3>带出字段</h3>
                      <span className="cfg-hint">
                        默认按主表字段同名自动带出，可逐项改为主表 / 合同 / 客户字段（含查找引用等只读字段）或不带出；
                        多值来源配到单选目标时，每个值生成一行
                      </span>
                    </div>
                    {!sub.tableId ? (
                      <div className="cfg-empty">请先选择子表</div>
                    ) : targets.length === 0 ? (
                      <div className="cfg-empty">该子表暂无可带出的字段</div>
                    ) : (
                      renderMappingRows(
                        targets,
                        [
                          { src: 'main', label: '主表', fields: mainSources },
                          { src: 'hop1', label: '合同', fields: hop1Sources },
                          { src: 'hop2', label: '客户', fields: hop2Sources },
                        ],
                        'main',
                        '主表',
                        sub.mapping,
                        (next) => updateSub(idx, { mapping: next }),
                      )
                    )}
                  </div>
                </div>
              );
            })}
            <Button
              theme="outline"
              size="small"
              disabled={!allTables.length}
              onClick={addSub}
              style={{ marginTop: 8 }}
            >
              + 新增子表
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
