import { Fragment, useState, type DragEvent } from 'react';
import { Button, Input, Popconfirm, Select, Tag } from '@douyinfe/semi-ui';
import type { FieldMetaLite, GroupConfig, PluginData } from '../../types';
import {
  addGroup,
  assignField,
  moveGroup,
  removeGroup,
  reorderFieldInGroup,
  unassignField,
  updateGroup,
} from '../../utils/configOps';
import { GROUP_COLORS } from '../../utils/palette';

interface Props {
  config: PluginData;
  fields: FieldMetaLite[];
  onChange: (next: PluginData) => void;
}

interface DragState {
  groupId: string;
  fieldId: string;
}

interface DropHint {
  groupId: string;
  /** 插入间隙，0 ~ 该组字段数 */
  gap: number;
}

/** 分组与分组内字段排序 */
export function GroupSection({ config, fields, onChange }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  const resetDrag = () => {
    setDrag(null);
    setDropHint(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, group: GroupConfig) => {
    if (!drag) return;
    if (drag.groupId !== group.id) {
      // 拖到别的分组时不支持跨组移动，清掉原组的落点提示
      setDropHint(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // 按鼠标位置找最近的插入间隙：逐行比较，行内按左右半区判断
    const chips = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-chip]'));
    let gap = chips.length;
    for (let i = 0; i < chips.length; i += 1) {
      const rect = chips[i].getBoundingClientRect();
      const inRow = e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (e.clientY < rect.top || (inRow && e.clientX < rect.left + rect.width / 2)) {
        gap = i;
        break;
      }
    }
    setDropHint((prev) =>
      prev && prev.groupId === group.id && prev.gap === gap ? prev : { groupId: group.id, gap },
    );
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, group: GroupConfig) => {
    e.preventDefault();
    const gap = dropHint?.groupId === group.id ? dropHint.gap : group.fieldIds.length;
    if (drag && drag.groupId === group.id) {
      onChange(reorderFieldInGroup(config, group.id, drag.fieldId, gap));
    }
    resetDrag();
  };

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
        每个分组是一个独立区块，区块颜色用于区分。按住字段卡片拖动即可自由调整组内顺序；未分组的字段不会出现在前端页面。
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

                <div
                  className={`group-fields${dropHint?.groupId === group.id ? ' is-drop-target' : ''}`}
                  onDragOver={(e) => handleDragOver(e, group)}
                  onDrop={(e) => handleDrop(e, group)}
                >
                  {group.fieldIds.length === 0 ? (
                    <span className="cfg-hint">该分组暂无字段</span>
                  ) : (
                    group.fieldIds.map((fid, fi) => (
                      <Fragment key={fid}>
                        {dropHint?.groupId === group.id && dropHint.gap === fi ? (
                          <span className="field-drop-line" />
                        ) : null}
                        <span
                          className={`field-chip draggable${
                            drag?.groupId === group.id && drag.fieldId === fid ? ' dragging' : ''
                          }`}
                          draggable
                          data-chip
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', fid);
                            setDrag({ groupId: group.id, fieldId: fid });
                          }}
                          onDragEnd={resetDrag}
                        >
                          <span className="field-chip-grip" aria-hidden>
                            ⠿
                          </span>
                          <span className="field-chip-name">{labelOf(fid)}</span>
                          <span className="field-chip-ops">
                            <button
                              type="button"
                              className="danger"
                              title="移出分组"
                              onClick={() => onChange(unassignField(config, fid))}
                            >
                              ×
                            </button>
                          </span>
                        </span>
                      </Fragment>
                    ))
                  )}
                  {dropHint?.groupId === group.id && dropHint.gap === group.fieldIds.length ? (
                    <span className="field-drop-line" />
                  ) : null}
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