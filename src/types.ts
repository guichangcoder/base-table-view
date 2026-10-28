/** 字段强调样式 */
export interface EmphasisStyle {
  bold?: boolean;
  /** 字体颜色，CSS color */
  color?: string;
  /** 区块底色高亮，CSS color */
  highlight?: string;
}

/** 单字段配置（只存用户决策，不存字段名/类型，满足 10240 字节瘦身契约） */
export interface FieldConfig {
  fieldId: string;
  visible: boolean;
  required?: boolean;
  readonly?: boolean;
  /** 展示用别名，留空则用字段原名 */
  label?: string;
  emphasis?: EmphasisStyle;
}

/** 分组配置 */
export interface GroupConfig {
  id: string;
  name: string;
  /** 区块主题色（左侧色条 + 浅底色） */
  color: string;
  columns: 1 | 2 | 3;
  collapsed?: boolean;
  /** 空值字段隐藏（否则显示「—」占位） */
  hideEmpty?: boolean;
  fieldIds: string[];
}

/** 关联字段纵向展开配置 */
export interface LinkDisplayConfig {
  fieldId: string;
  /** 关联目标表 id */
  tableId: string;
  /** 展示的目标表字段 */
  displayFieldIds: string[];
  /** 最多展开行数 */
  maxRows: number;
}

/** 持久化根对象（customConfig） */
export interface PluginData {
  version: number;
  /** 配置所属多维表格 token（应用模式契约 3） */
  baseToken?: string;
  /** 配置所属多维表格 id，读取侧据此丢弃别的 base 串入的配置 */
  baseId?: string;
  /** 主表 id */
  tableId?: string;
  groups: GroupConfig[];
  fields: FieldConfig[];
  /** 允许前端筛选的字段 */
  filterFieldIds: string[];
  /** 允许关键词搜索的字段（一期：文本类） */
  searchFieldIds: string[];
  links: LinkDisplayConfig[];
}

export const CONFIG_VERSION = 1;

export function emptyConfig(): PluginData {
  return {
    version: CONFIG_VERSION,
    groups: [],
    fields: [],
    filterFieldIds: [],
    searchFieldIds: [],
    links: [],
  };
}

/** 展平后的可展示字段（含元信息，运行时从 Base 元信息还原，不落盘） */
export interface FieldMetaLite {
  id: string;
  name: string;
  type: number;
  options?: Array<{ id: string; name: string }>;
  /** 关联字段指向的表 id */
  linkTableId?: string;
  /** 是否主字段（浏览态据此取记录标题，避免额外的 base 级调用） */
  isPrimary?: boolean;
  /** 是否可编辑 */
  editable: boolean;
  /** 是否只读类型 */
  readonlyType: boolean;
  /** 是否结构不支持 */
  unsupported?: boolean;
}

export interface TableMetaLite {
  id: string;
  name: string;
}

export interface RecordRow {
  recordId: string;
  fields: Record<string, unknown>;
}

export interface LoadedRecordPage {
  records: RecordRow[];
  /** getRecordsByPage 的 pageToken 为数字 */
  pageToken?: number;
  hasMore: boolean;
  total?: number;
}

/** 筛选条件（前端态） */
export interface FilterItem {
  fieldId: string;
  operator: 'contains' | 'is' | 'isNotEmpty' | 'isGreater' | 'isLess';
  value: string;
}