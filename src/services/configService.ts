/**
 * 应用模式配置读写（硬契约 #3 / #4 / #5 / #6）。
 *
 * - 配置随 baseToken / baseId 持久化，读取侧丢弃别的 base 串入的配置
 * - dataConditions 只声明主表一条
 * - saveConfig 单次 + 有界重试（3 次 / 500ms），真实宿主下失败必须向上抛
 * - customConfig 保存前瘦身并校验 10240 字节上限
 */
import {
  emptyConfig,
  type PluginData,
  type TableMetaLite,
} from '../types';
import {
  getBase,
  getBridge,
  getDashboard,
  getBoundDashboard,
  getBaseToken,
  hasSelectedBase,
  selectBase,
} from './appContext';
import { hydrateConfig, serializeConfig, estimateConfigBytes } from './configSize';
import { listTables } from './baseService';
import { HOST_TIMEOUT, SAVE_TIMEOUT, withTimeout } from '../utils/timeout';

export type HostState = 'Create' | 'Config' | 'View' | 'FullScreen' | 'Unknown';
export type ConfigSource = 'dashboard' | 'bridge' | 'local' | 'none';

const CONFIG_KEY = 'bitable-record-view-plugin:config';
const LOCAL_PREFIX = 'bitable-record-view-plugin:backup';
/** customConfig 字节上限（宿主硬约束） */
export const MAX_CUSTOM_CONFIG_BYTES = 10240;

function readUrlState(): HostState {
  try {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    // 飞书把视图标记放在 URL 的 hash 查询段（SDK 的 dashboard.state 同样只解析 hash），
    // search 与 hash 都要看，否则会把真宿主误判成调试页。
    const all = `${search}&${hash}`;
    if (/(?:^|[?&#])isCreate=1/.test(all)) return 'Create';
    if (/(?:^|[?&#])isFullScreen=1/.test(all)) return 'FullScreen';
    if (/(?:^|[?&#])isConfig=1/.test(all)) return 'Config';
  } catch {
    /* ignore */
  }
  return 'Unknown';
}

/**
 * 是否运行在飞书应用模式宿主内。
 *
 * 判定口径与 SDK 的 dashboard.state 对齐：宿主容器会往 URL 注入
 * isCreate / isConfig / isFullScreen 标记（在 hash 查询段），插件运行在宿主 iframe 内。
 *
 * 注意：不能依赖「全局 dashboard 可读写」来判断——应用模式下全局 dashboard 的
 * base 是未绑定的全局 base，接口存在但调用会挂住，据此判断会把宿主误判为调试页，
 * 转而只写本地备份，宿主永远等不到 saveConfig，配置弹窗就停在「加载中」。
 */
export function isDashboardHost(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (readUrlState() !== 'Unknown') return true;
    return window.self !== window.top;
  } catch {
    return false;
  }
}

/** 当前宿主状态：优先 dashboard.state，其次 URL 标记兜底（宿主未就绪时返回 Unknown，由调用方重试） */
export function getHostState(): HostState {
  try {
    const d = getDashboard() as any;
    const s = d?.state;
    if (s === 'Create' || s === 'Config' || s === 'View' || s === 'FullScreen') return s;
  } catch {
    /* 运行时尚未注册时读取会同步抛错，交给调用方重试 */
  }
  return readUrlState();
}

export function isConfigState(state: HostState): boolean {
  return state === 'Create' || state === 'Config';
}

/** 当前 base 的稳定标识：优先 token，回退 name:xxx */
export async function getBaseId(): Promise<string> {
  const token = getBaseToken();
  if (token) return token;
  // 非宿主（浏览器直开调试）或尚未绑定 base 时没有 base 上下文：直接返回空标识，
  // 避免调用全局 base 接口（应用模式下会一直等不到回包）
  if (!isDashboardHost() || !hasSelectedBase()) return '';
  try {
    const name = await withTimeout(
      Promise.resolve((getBase() as any).getBaseName()),
      HOST_TIMEOUT,
      'getBaseName',
    );
    if (name) return `name:${name}`;
  } catch {
    /* 取不到 base 名时走空标识 */
  }
  return '';
}

function readBaseTokenFrom(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const r = raw as Record<string, any>;
  return typeof r.baseToken === 'string' ? r.baseToken : '';
}

function pickDashboardConfigBaseToken(cfg: any): string {
  const custom = cfg?.customConfig;
  const fromCustom = readBaseTokenFrom(custom);
  if (fromCustom) return fromCustom;
  const cond = Array.isArray(cfg?.dataConditions) ? cfg.dataConditions[0] : null;
  return cond && typeof cond.baseToken === 'string' ? cond.baseToken : '';
}

/**
 * 跨 base 污染防线：配置里记了 baseId / baseToken，且与当前 base 不一致 → 丢弃。
 * 老配置无标记时放行（兼容）。
 */
function isForeignConfig(parsed: PluginData, currentBaseId: string): boolean {
  const token = getBaseToken();
  if (parsed.baseToken && token && parsed.baseToken !== token) return true;
  if (parsed.baseId && currentBaseId && parsed.baseId !== currentBaseId) return true;
  return false;
}

/**
 * 配置是否「可用」：连数据表、分组、字段都没有，说明这是一份残缺配置
 * （旧版本写入、中途异常、宿主侧被清空）。此时不能采用，否则会呈现空白界面。
 */
function isUsableConfig(c: PluginData): boolean {
  return !!c.tableId || c.groups.length > 0 || c.fields.length > 0;
}

async function readBridge(): Promise<unknown> {
  try {
    const v = await withTimeout(getBridge().getData(CONFIG_KEY));
    return v ?? null;
  } catch {
    return null;
  }
}

function readLocal(baseId: string): unknown {
  try {
    const raw = localStorage.getItem(`${LOCAL_PREFIX}:${baseId || 'default'}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeBackup(config: PluginData, baseId: string): Promise<void> {
  // bridge 只在宿主内可用；非宿主下调用会挂着等不到回包，直接跳过
  if (isDashboardHost()) {
    try {
      await withTimeout(Promise.resolve(getBridge().setData(CONFIG_KEY, config)), HOST_TIMEOUT, 'bridge.setData');
    } catch {
      /* bridge 不可用时忽略，localStorage 仍可用 */
    }
  }
  try {
    localStorage.setItem(`${LOCAL_PREFIX}:${baseId || 'default'}`, JSON.stringify(config));
  } catch {
    /* 隐私模式 / 配额不足时忽略 */
  }
}

export interface LoadConfigResult {
  config: PluginData;
  source: ConfigSource;
  /** 是否检测到别的 base 串入的配置并丢弃 */
  droppedForeign: boolean;
}

/** 配置里带了 baseToken 但当前还没绑定 base 时，先用它完成 Workspace 绑定 */
async function bindBaseIfNeeded(config: PluginData): Promise<void> {
  if (config.baseToken && !hasSelectedBase()) {
    await selectBase(config.baseToken);
  }
}

/**
 * 读取配置：dashboard → bridge → localStorage 依次尝试。
 * 任一路径命中后立即做 baseId / baseToken 归属校验。
 */
export async function loadConfig(): Promise<LoadConfigResult> {
  let droppedForeign = false;

  // 1) 宿主配置：顺带用 dataConditions.baseToken 绑定 base
  if (isDashboardHost()) {
    try {
      const hostCfg: any = await withTimeout<any>((getDashboard() as any).getConfig());
      const hint = pickDashboardConfigBaseToken(hostCfg);
      if (hint && !hasSelectedBase()) {
        await selectBase(hint);
      }
      const custom = hostCfg?.customConfig ?? null;
      if (custom) {
        const parsed = hydrateConfig(custom);
        if (!isUsableConfig(parsed)) {
          console.warn('[configService] 宿主配置缺少数据表 / 分组 / 字段，按无效处理并回落到备份');
        } else {
          const currentBaseId = await getBaseId();
          if (isForeignConfig(parsed, currentBaseId)) {
            droppedForeign = true;
          } else {
            await bindBaseIfNeeded(parsed);
            return { config: parsed, source: 'dashboard', droppedForeign };
          }
        }
      }
    } catch (e) {
      console.warn('[configService] dashboard.getConfig 不可用:', e);
    }
  }

  const currentBaseId = await getBaseId();

  // 2) bridge 备份（仅宿主内可用；非宿主直接跳过，避免挂在永不回包的宿主接口）
  const bridgeData = isDashboardHost() ? await readBridge() : null;
  if (bridgeData) {
    const parsed = hydrateConfig(bridgeData);
    if (isUsableConfig(parsed)) {
      if (isForeignConfig(parsed, currentBaseId)) droppedForeign = true;
      else {
        await bindBaseIfNeeded(parsed);
        return { config: parsed, source: 'bridge', droppedForeign };
      }
    }
  }

  // 3) localStorage 备份
  const localData = readLocal(currentBaseId);
  if (localData) {
    const parsed = hydrateConfig(localData);
    if (isUsableConfig(parsed)) {
      if (!isForeignConfig(parsed, currentBaseId)) {
        await bindBaseIfNeeded(parsed);
        return { config: parsed, source: 'local', droppedForeign };
      }
      droppedForeign = true;
    }
  }

  return { config: emptyConfig(), source: 'none', droppedForeign };
}

function buildDataConditions(tableId: string, baseToken: string): any[] {
  if (!tableId) return [];
  const cond: Record<string, unknown> = {
    tableId,
    dataRange: { type: 'ALL' },
    groups: [],
    series: 'COUNTA',
  };
  if (baseToken) cond.baseToken = baseToken;
  return [cond];
}

/**
 * 主子表必须同 Base（硬契约 #4）。
 *
 * 元信息读取失败（宿主未就绪 / 超时）时只告警不拦截：
 * 拦截会让我们在调用宿主 saveConfig 之前就抛错，宿主配置弹窗会一直停在「加载中」。
 */
async function assertTablesInBase(config: PluginData): Promise<void> {
  let list: TableMetaLite[] = [];
  try {
    list = await listTables();
  } catch (e) {
    console.warn('[configService] 读取表列表失败，跳过归属校验:', e);
    return;
  }
  if (!list.length) {
    console.warn('[configService] 表列表为空，跳过归属校验');
    return;
  }
  const inBase = new Set(list.map((t) => t.id));
  const used = new Set<string>();
  if (config.tableId) used.add(config.tableId);
  config.links.forEach((l) => l.tableId && used.add(l.tableId));

  const missing = Array.from(used).filter((id) => !inBase.has(id));
  if (missing.length) {
    throw new Error('配置引用的数据表不属于当前多维表格，请重新选择数据表');
  }
}

export interface SaveResult {
  bytes: number;
  /**
   * host：写入宿主配置，所有用户刷新后都能看到；
   * local：仅写入本机备份（浏览器直开调试），其他人看不到，不能当作保存成功。
   */
  persisted: 'host' | 'local';
}

/**
 * 保存配置。
 *
 * 关键约束：真实宿主里必须调用 Workspace 绑定实例的 dashboard.saveConfig，
 * 且 saveConfig 必须 resolve —— 飞书收到成功回包后才会关闭配置弹窗、把插件切入展示态。
 * 因此这里绝不吞错、也不在调用宿主前做「可能失败又非必要」的阻塞校验。
 */
export async function saveConfig(input: PluginData): Promise<SaveResult> {
  const inputToken = typeof input.baseToken === 'string' ? input.baseToken : '';
  const baseToken = inputToken || getBaseToken();
  const baseId = baseToken || (await getBaseId());

  const thin = serializeConfig({ ...input, baseToken, baseId });
  if (!thin.tableId) throw new Error('请先选择数据表');

  const bytes = estimateConfigBytes(thin);
  if (bytes > MAX_CUSTOM_CONFIG_BYTES) {
    throw new Error(`配置体积 ${bytes} 字节，超过 ${MAX_CUSTOM_CONFIG_BYTES} 字节上限，请精简分组或字段配置`);
  }

  const payload = {
    dataConditions: buildDataConditions(thin.tableId as string, baseToken),
    customConfig: thin as unknown as Record<string, unknown>,
  };

  // 非宿主（浏览器直开调试）：只写本地备份，不做宿主侧校验，避免调用永不回包的宿主接口
  if (!isDashboardHost()) {
    await writeBackup(thin, baseId);
    console.info('[configService] 非宿主环境，仅写入本地备份，配置字节数:', bytes);
    return { bytes, persisted: 'local' };
  }

  // 应用模式下数据源必须由 Workspace 绑定，否则全局 dashboard.saveConfig 内部会去读
  // 未绑定的全局 base 表列表，Promise 永不回包 → 宿主弹窗一直「加载中」。
  if (!baseToken) {
    throw new Error('请先选择多维表格，再保存配置');
  }
  if (!hasSelectedBase() || getBaseToken() !== baseToken) {
    const ok = await selectBase(baseToken);
    if (!ok) {
      throw new Error('无法绑定所选多维表格（可能没有权限或已被删除），请重新选择后保存');
    }
  }
  const hostDashboard = getBoundDashboard();
  if (!hostDashboard || typeof (hostDashboard as any).saveConfig !== 'function') {
    throw new Error('飞书宿主上下文未就绪，请关闭配置面板后重新打开');
  }

  await assertTablesInBase(thin);

  const MAX_ATTEMPTS = 3;
  let saved = false;
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await withTimeout<any>(
        (hostDashboard as any).saveConfig(payload),
        SAVE_TIMEOUT,
        'dashboard.saveConfig',
      );
      if (r === false) lastErr = 'dashboard.saveConfig 返回 false';
      else {
        saved = true;
        break;
      }
    } catch (e) {
      lastErr = String((e as Error)?.message ?? e);
      // 超时说明宿主始终不回包，重试无意义，立即失败而不是让按钮一直转圈
      if (lastErr.includes('超时')) break;
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500));
  }

  if (!saved) {
    throw new Error(`保存失败（已尝试 ${MAX_ATTEMPTS} 次）：${lastErr || '未知错误'}`);
  }

  await writeBackup(thin, baseId);
  console.info('[configService] 配置已保存，字节数:', bytes);
  return { bytes, persisted: 'host' };
}

/**
 * 通知宿主「插件已渲染完成」。
 *
 * 开发指南要求：插件渲染完成后调用 dashboard.setRendered()，
 * 宿主据此解除插件容器的加载占位，并允许自动化流程截图。
 */
export function markRendered(): void {
  if (!isDashboardHost()) return;
  try {
    const d = (getBoundDashboard() ?? getDashboard()) as any;
    const r = d?.setRendered?.();
    if (r && typeof r.catch === 'function') r.catch(() => undefined);
  } catch {
    /* setRendered 不可用时忽略 */
  }
}

/** 宿主侧配置变更（切到 View 后宿主会推送） */
export function onHostConfigChange(cb: (config: unknown) => void): () => void {
  if (!isDashboardHost()) return () => undefined;
  try {
    const d = getDashboard() as any;
    if (typeof d.onConfigChange !== 'function') return () => undefined;
    return d.onConfigChange((ctx: any) => cb(ctx?.data));
  } catch {
    return () => undefined;
  }
}