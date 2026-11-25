import { Checkbox, Tag } from '@douyinfe/semi-ui';
import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldMetaLite, PluginData } from '../../types';
import { toggleId } from '../../utils/configOps';
import { isTextType } from '../../services/baseService';

const FT = FieldType as any;

/** 可用于筛选的字段类型（与 recordService.buildCondition 支持的类型保持一致） */
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
  const searchable = usable.filter((f) => isTextType(f.type));
  const filterableIds = new Set(filterable.map((f) => f.id));
  const searchableIds = new Set(searchable.map((f) => f.id));
  const filterCount = config.filterFieldIds.filter((id) => filterableIds.has(id)).length;
  const searchCount = config.searchFieldIds.filter((id) => searchableIds.has(id)).length;

  const setFilter = (fieldId: string) =>
    onChange({ ...config, filterFieldIds: toggleId(config.filterFieldIds, fieldId) });
  const setSearch = (fieldId: string) =>
    onChange({ ...config, searchFieldIds: toggleId(config.searchFieldIds, fieldId) });

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <h2>4. 筛选与搜索</h2>
        <span className="cfg-hint">
          筛选 {filterCount} 个 · 搜索 {searchCount} 个
        </span>
      </div>
      <p className="cfg-hint">
        勾选的字段会出现在浏览页顶部的筛选区。搜索框只支持文本类字段（文本、电话、邮箱、链接），多个搜索字段之间是「或」的关系。已在字段列表中关闭「显示」的字段不会出现在这里。
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
          搜索字段
          <Tag size="small" color="grey">
            文本类
          </Tag>
        </div>
        {searchable.length === 0 ? (
          <div className="cfg-empty">当前数据表没有文本类字段，无法提供关键词搜索</div>
        ) : (
          <div className="pick-list">
            {searchable.map((f) => (
              <div className={`pick-item${config.searchFieldIds.includes(f.id) ? ' active' : ''}`} key={f.id}>
                <Checkbox
                  checked={config.searchFieldIds.includes(f.id)}
                  onChange={() => setSearch(f.id)}
                >
                  <span className="pick-name">{f.name}</span>
                </Checkbox>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}