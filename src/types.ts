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
  /**
   * 是否按「按钮」渲染。undefined = 自动识别，true/false = 用户手动指定。
   * 数据表里的按钮字段由宿主返回的元信息可能不带可识别类型，手动指定是保底开关。
   */
  asButton?: boolean;
}

/** 分组配置 */
export interface GroupConfig {
  id: string;
  name: string;
  /** 区块主题色（左侧色条 + 浅底色） */
  color: string;
  columns: 1 | 2 | 3;
  collapsed?: boolean;
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

/**
 * 单据字段来源：
 * - main：主表当前记录（含带出值）
 * - hop1：主表关联的合同记录
 * - hop2：合同关联的客户记录
 */
export type DocSource = 'main' | 'hop1' | 'hop2';

/** 单个目标字段的带出配置；from 为空串表示该字段不带出 */
export interface DocMapItem {
  /** 目标字段 id */
  to: string;
  /** 来源 */
  src: DocSource;
  /** 来源字段 id（空串 = 不带出） */
  from?: string;
}

/** 目标字段 → 来源字段 的映射（缺省按同名字段自动匹配默认来源） */
export interface DocMapping {
  items: DocMapItem[];
}

/** 单张子表配置 */
export interface DocSubConfig {
  /** 子表 id */
  tableId: string;
  /** 子表上指向主表的关联字段 */
  linkFieldId: string;
  /** 子表必填字段 */
  required?: string[];
  /** 子表目标字段 → 来源字段 映射 */
  mapping?: DocMapping;
}

/**
 * 主子表单据（如「项目立项单」）新增页配置。
 * 合同字段按映射自动带出到主表并置只读；可配置多张子表，各自指定带出字段与来源。
 */
export interface DocConfig {
  enabled: boolean;
  /** 单据名称，作为新增页标题与入口按钮文案 */
  name?: string;
  /** 主表上指向合同表的关联字段：选中合同后据此带出字段 */
  contractFieldId?: string;
  /** 合同表上指向客户表的关联字段：客户信息取自该关联记录 */
  customerFieldId?: string;
  /** 合同/客户 → 主表 字段映射 */
  main?: DocMapping;
  /** 子表列表（可多张） */
  subs: DocSubConfig[];
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
  /** 主子表单据新增配置（未启用时不落盘） */
  doc?: DocConfig;
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
  /** 是否「按钮」类型字段：前端渲染成可点击按钮，点击执行数据表内的按钮动作 */
  isButton?: boolean;
  /** 按钮文案（字段 property.title） */
  buttonTitle?: string;
  /** 按钮配色索引（字段 property.color） */
  buttonColor?: number;
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