import { Checkbox, Tag } from '@douyinfe/semi-ui';
import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldMetaLite, PluginData } from '../../types';
import { toggleId } from '../../utils/configOps';
import { isSearchableType } from '../../services/baseService';

const FT = FieldType as any;

/** 可用于筛选的字段类型（与 Workbench、recordService.buildCondition 支持的类型保持一致） */
const FILTERABLE_TYPES = [
  FT.Text,
  FT.Number,
  FT.SingleSelect,
  FT.MultiSelect,
  FT.DateTime,
  FT.User,
  FT.Phone,
  FT.Email,
  FT.Url,
  FT.Checkbox,
  FT.SingleLink,
  FT.DuplexLink,
].filter((v) => typeof v === 'number');

interface Props {
  config: PluginData;
  fields: FieldMetaLite[];
  onChange: (next: PluginData) => void;
}

/** 筛选字段 / 关键词搜索字段配置 */
export function SettingsSection({ config, fields, onChange }: Props) {
  // 候选取全表可用字段：不要求字段已加入展示分组，否则无分组时无从勾选
  // 但关闭「显示」的字段前端不可见、也不可阅读，不再作为筛选/搜索候选
  const visibleIds = new Set(config.fields.filter((c) => c.visible !== false).map((c) => c.fieldId));
  const usable = fields.filter((f) => !f.unsupported && !f.isButton && visibleIds.has(f.id));

  const filterable = usable.filter((f) => FILTERABLE_TYPES.includes(f.type));
  const searchable = usable.filter((f) => isSearchableType(f.type));
  const filterableIds = new Set(filterable.map((f) => f.id));
  const filterCount = config.filterFieldIds.filter((id) => filterableIds.has(id)).length;

  const setFilter = (fieldId: string) =>
    onChange({ ...config, filterFieldIds: toggleId(config.filterFieldIds, fieldId) });

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <h2>4. 筛选与搜索</h2>
        <span className="cfg-hint">筛选 {filterCount} 个</span>
      </div>
      <p className="cfg-hint">
        勾选的字段会出现在浏览页顶部的筛选区，关联字段按关联记录筛选。关键词搜索会检索下方「搜索范围」里所有字段中包含输入内容的记录；已在字段列表中关闭「显示」的字段不参与搜索。
      </p>

      <div className="pick-block">
        <div className="pick-title">筛选字段</div>
        {filterable.length === 0 ? (
          <div className="cfg-empty">当前数据表没有可用于筛选的字段</div>
        ) : (
          <div className="pick-list">
            {filterable.map((f) => (
              <div className={`pick-item${config.filterFieldIds.includes(f.id) ? ' active' : ''}`} key={f.id}>
                <Checkbox
                  checked={config.filterFieldIds.includes(f.id)}
                  onChange={() => setFilter(f.id)}
                >
                  <span className="pick-name">{f.name}</span>
                </Checkbox>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pick-block">
        <div className="pick-title">
          搜索范围
          <Tag size="small" color="grey">
            自动
          </Tag>
        </div>
        {searchable.length === 0 ? (
          <div className="cfg-empty">当前数据表没有可用于关键词搜索的字段</div>
        ) : (
          <div className="cfg-hint">
            按「包含相关字」检索以下字段：{searchable.map((f) => f.name).join('、')}
          </div>
        )}
      </div>
    </section>
  );
}