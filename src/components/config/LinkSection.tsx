import { useEffect, useState } from 'react';
import { InputNumber, Select, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import type { FieldMetaLite, PluginData } from '../../types';
import { updateLink } from '../../utils/configOps';
import { listFields } from '../../services/baseService';

const MAX_DISPLAY_FIELDS = 8;

interface Props {
  config: PluginData;
  fields: FieldMetaLite[];
  onChange: (next: PluginData) => void;
}

/** 关联字段展示配置：选择关联表中的展示列 + 最多展示行数 */
export function LinkSection({ config, fields, onChange }: Props) {
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const [targetFields, setTargetFields] = useState<Record<string, FieldMetaLite[]>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const tableIds = Array.from(new Set(config.links.map((l) => l.tableId).filter(Boolean)));
  const missingKey = tableIds.filter((t) => !targetFields[t] && !failed[t]).join(',');

  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    const need = missingKey.split(',');
    setLoading(true);
    Promise.all(
      need.map((tableId) =>
        listFields(tableId)
          .then((list) => ({ tableId, list }))
          .catch(() => ({ tableId, list: [] as FieldMetaLite[] })),
      ),
    )
      .then((pairs) => {
        if (!alive) return;
        setTargetFields((prev) => {
          const next = { ...prev };
          const fail: Record<string, boolean> = {};
          pairs.forEach((p) => {
            if (p.list.length) next[p.tableId] = p.list.filter((f) => !f.unsupported);
            else fail[p.tableId] = true;
          });
          if (Object.keys(fail).length) setFailed((prevFail) => ({ ...prevFail, ...fail }));
          return next;
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [missingKey]);

  const grouped = new Set(config.groups.flatMap((g) => g.fieldIds));

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <h2>5. 关联字段展示</h2>
        <span className="cfg-hint">共 {config.links.length} 个关联字段</span>
      </div>
      <p className="cfg-hint">
        关联字段在前端会以「纵向展开的表格」展示。选择要展示的关联表字段（最多 {MAX_DISPLAY_FIELDS} 个），不选则默认展示关联表第一列。
      </p>

      {config.links.length === 0 ? (
        <div className="cfg-empty">当前数据表没有关联字段</div>
      ) : (
        <div className="link-list">
          {config.links.map((link) => {
            const field = fieldMap.get(link.fieldId);
            const options = targetFields[link.tableId] ?? [];
            const inGroup = grouped.has(link.fieldId);

            return (
              <div className="link-card" key={link.fieldId}>
                <div className="link-head">
                  <span className="link-name">{field?.name ?? link.fieldId}</span>
                  <Tag size="small" color="light-blue">
                    关联
                  </Tag>
                  {inGroup ? (
                    <Tag size="small" color="green">
                      已放入分组
                    </Tag>
                  ) : (
                    <Tag size="small" color="orange">
                      未放入分组，不会展示
                    </Tag>
                  )}
                  <span className="link-target">目标表 …{link.tableId.slice(-6)}</span>
                </div>

                <div className="link-body">
                  <div className="link-row">
                    <span className="link-label">展示字段</span>
                    {loading && options.length === 0 ? (
                      <Spin size="small" />
                    ) : options.length === 0 ? (
                      <span className="cfg-hint">读取关联表字段失败或该表无可用字段</span>
                    ) : (
                      <Select
                        multiple
                        size="small"
                        placeholder="默认展示关联表第一列"
                        value={link.displayFieldIds}
                        maxTagCount={4}
                        filter
                        optionList={options.map((f) => ({ label: f.name, value: f.id }))}
                        onChange={(v) => {
                          const ids = Array.isArray(v) ? v.map(String) : [];
                          if (ids.length > MAX_DISPLAY_FIELDS) {
                            Toast.warning(`最多选择 ${MAX_DISPLAY_FIELDS} 个展示字段`);
                            return;
                          }
                          onChange(updateLink(config, link.fieldId, { displayFieldIds: ids }));
                        }}
                        className="link-select"
                      />
                    )}
                  </div>

                  <div className="link-row">
                    <span className="link-label">最多展示行数</span>
                    <InputNumber
                      size="small"
                      min={1}
                      max={100}
                      value={link.maxRows}
                      onChange={(v) => {
                        const n = typeof v === 'number' ? v : Number(v);
                        if (!Number.isFinite(n)) return;
                        onChange(updateLink(config, link.fieldId, { maxRows: n }));
                      }}
                      className="link-number"
                    />
                    <span className="cfg-hint">超出部分不展示，避免详情页被撑开</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}