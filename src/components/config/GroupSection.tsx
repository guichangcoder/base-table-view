import { Button, Input, Popconfirm, Select, Tag } from '@douyinfe/semi-ui';
import type { FieldMetaLite, PluginData } from '../../types';
import {
  addGroup,
  assignField,
  moveFieldInGroup,
  moveGroup,
  removeGroup,
  unassignField,
  updateGroup,
} from '../../utils/configOps';
import { GROUP_COLORS } from '../../utils/palette';

interface Props {
  config: PluginData;
  fields: FieldMetaLite[];
  onChange: (next: PluginData) => void;
}

/** 分组与分组内字段排序 */
export function GroupSection({ config, fields, onChange }: Props) {
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const labelOf = (fieldId: string): string => {
    const cfg = config.fields.find((f) => f.fieldId === fieldId);
    if (cfg?.label?.trim()) return cfg.label.trim();
    return fieldMap.get(fieldId)?.name ?? fieldId;
  };

  const grouped = new Set(config.groups.flatMap((g) => g.fieldIds));
  const ungrouped = fields.filter((f) => !grouped.has(f.id) && !f.unsupported);

  const groupNameOf = (fieldId: string): string =>
    config.groups.find((g) => g.fieldIds.includes(fieldId))?.name ?? '';

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <h2>2. 分组与布局</h2>
        <Button size="small" onClick={() => onChange(addGroup(config))}>
          添加分组
        </Button>
      </div>
      <p className="cfg-hint">
        每个分组是一个独立区块，区块颜色用于区分。分组内字段按顺序展示；未分组的字段不会出现在前端页面。
      </p>

      {config.groups.length === 0 ? (
        <div className="cfg-empty">还没有分组，点击「添加分组」开始配置</div>
      ) : (
        <div className="group-list">
          {config.groups.map((group, gi) => {
            // 可移入本组的字段：所有不在本组内的受支持字段（含其它分组里的）
            const candidates = fields.filter((f) => !f.unsupported && !group.fieldIds.includes(f.id));
            return (
              <div className="group-card" key={group.id} style={{ borderLeftColor: group.color }}>
                <div className="group-head">
                  <Input
                    value={group.name}
                    onChange={(v) => onChange(updateGroup(config, group.id, { name: v }))}
                    className="group-name"
                    size="small"
                  />
                  <div className="group-colors">
                    {GROUP_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`color-dot${c === group.color ? ' active' : ''}`}
                        style={{ background: c }}
                        onClick={() => onChange(updateGroup(config, group.id, { color: c }))}
                        title="设置区块颜色"
                      />
                    ))}
                  </div>
                  <Select
                    size="small"
                    value={group.columns}
                    onChange={(v) => onChange(updateGroup(config, group.id, { columns: v as 1 | 2 | 3 }))}
                    className="group-columns"
                    optionList={[
                      { label: '1 列', value: 1 },
                      { label: '2 列', value: 2 },
                      { label: '3 列', value: 3 },
                    ]}
                  />
                  <div className="group-actions">
                    <Button
                      size="small"
                      theme="borderless"
                      disabled={gi === 0}
                      onClick={() => onChange(moveGroup(config, group.id, -1))}
                    >
                      ↑
                    </Button>
                    <Button
                      size="small"
                      theme="borderless"
                      disabled={gi === config.groups.length - 1}
                      onClick={() => onChange(moveGroup(config, group.id, 1))}
                    >
                      ↓
                    </Button>
                    <Popconfirm
                      title={`删除分组「${group.name}」？`}
                      content="组内字段会变为未分组（不再展示）"
                      onConfirm={() => onChange(removeGroup(config, group.id))}
                    >
                      <Button size="small" theme="borderless" type="danger">
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </div>

                <div className="group-fields">
                  {group.fieldIds.length === 0 ? (
                    <span className="cfg-hint">该分组暂无字段</span>
                  ) : (
                    group.fieldIds.map((fid, fi) => (
                      <div className="field-chip" key={fid}>
                        <span className="field-chip-name">{labelOf(fid)}</span>
                        <span className="field-chip-ops">
                          <button
                            type="button"
                            disabled={fi === 0}
                            onClick={() => onChange(moveFieldInGroup(config, group.id, fid, -1))}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={fi === group.fieldIds.length - 1}
                            onClick={() => onChange(moveFieldInGroup(config, group.id, fid, 1))}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => onChange(unassignField(config, fid))}
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {candidates.length ? (
                  <div className="group-add">
                    <Select
                      size="small"
                      placeholder="选择字段移入本组（可跨组调整）"
                      value={undefined}
                      onChange={(v) => v && onChange(assignField(config, String(v), group.id))}
                      optionList={candidates.map((f) => {
                        const from = groupNameOf(f.id);
                        return { label: from ? `${f.name}（${from}）` : f.name, value: f.id };
                      })}
                      filter
                      className="group-add-select"
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {ungrouped.length ? (
        <div className="ungrouped">
          <div className="ungrouped-title">
            <span>未分组字段</span>
            <Tag color="grey" size="small">
              {ungrouped.length}
            </Tag>
          </div>
          <div className="ungrouped-list">
            {ungrouped.map((f) => (
              <span className="field-chip muted" key={f.id}>
                {f.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}