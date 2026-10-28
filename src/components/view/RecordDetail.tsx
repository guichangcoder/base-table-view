import type { CSSProperties } from 'react';
import { Empty } from '@douyinfe/semi-ui';
import type { FieldMetaLite, PluginData, RecordRow } from '../../types';
import { isButtonField, visibleFieldIds } from '../../utils/configOps';
import { formatCellValue } from '../../utils/valueConverter';
import { hexToRgba, toneOf } from '../../utils/palette';
import { fieldLabel } from '../../utils/validator';
import { LinkBlock } from './LinkBlock';
import { RecordButton } from './RecordButton';

interface Props {
  config: PluginData;
  fields: FieldMetaLite[];
  record: RecordRow | null;
}

function valueStyle(emphasis: { bold?: boolean; color?: string } | undefined): CSSProperties {
  const style: CSSProperties = {};
  if (emphasis?.bold) style.fontWeight = 600;
  if (emphasis?.color) style.color = emphasis.color;
  return style;
}

/** 单条记录的详情：按配置分组渲染，关联字段纵向展开 */
export function RecordDetail({ config, fields, record }: Props) {
  if (!record) {
    return (
      <div className="detail-empty">
        <Empty title="选择左侧记录查看详情" description="或者点击「新增记录」录入一条新数据" />
      </div>
    );
  }

  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const cfgMap = new Map(config.fields.map((c) => [c.fieldId, c]));
  const linkMap = new Map(config.links.map((l) => [l.fieldId, l]));

  const blocks = config.groups
    .map((group) => {
      const ids = visibleFieldIds(config, group).filter((id) => fieldMap.has(id));
      const plainIds = ids.filter((id) => !linkMap.has(id));
      const linkIds = ids.filter((id) => linkMap.has(id));
      return { group, plainIds, linkIds, count: ids.length };
    })
    .filter((b) => b.count > 0);

  if (!blocks.length) {
    return (
      <div className="detail-empty">
        <Empty title="还没有配置展示字段" description="请在配置面板中把字段加入分组并保存" />
      </div>
    );
  }

  return (
    <div className="detail">
      {blocks.map(({ group, plainIds, linkIds }) => {
        const tone = toneOf(group.color);
        return (
          <section
            className="group-block"
            key={group.id}
            style={{ background: tone.bg, borderColor: tone.border }}
          >
            <header className="group-block-head">
              <i className="group-block-bar" style={{ background: tone.color }} />
              <h3 style={{ color: tone.color }}>{group.name}</h3>
              <span className="group-block-count">{plainIds.length + linkIds.length} 个字段</span>
            </header>

            {plainIds.length ? (
              <div className={`field-grid cols-${group.columns}`}>
                {plainIds.map((id) => {
                  const field = fieldMap.get(id);
                  if (!field) return null;
                  const cfg = cfgMap.get(id);
                  const text = formatCellValue(record.fields[id], field);
                  const highlight = cfg?.emphasis?.highlight;
                  const hlColor = cfg?.emphasis?.color ?? group.color;
                  return (
                    <div className="field-item" key={id}>
                      <div className="field-label">
                        {fieldLabel(field, cfg)}
                        {cfg?.required ? <i className="field-required">*</i> : null}
                      </div>
                      {isButtonField(field, cfg) ? (
                        <RecordButton
                          tableId={config.tableId}
                          recordId={record.recordId}
                          field={field}
                          title={cfg?.label || field.buttonTitle || field.name}
                        />
                      ) : (
                        <div
                          className={`field-value${text ? '' : ' empty'}`}
                          style={{
                            ...valueStyle(cfg?.emphasis),
                            ...(highlight ? { background: hexToRgba(hlColor, 0.14) } : null),
                          }}
                        >
                          {text || '—'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {linkIds.map((id) => {
              const field = fieldMap.get(id);
              const link = linkMap.get(id);
              if (!field || !link) return null;
              return (
                <LinkBlock
                  key={id}
                  link={link}
                  value={record.fields[id]}
                  fieldName={fieldLabel(field, cfgMap.get(id))}
                />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}