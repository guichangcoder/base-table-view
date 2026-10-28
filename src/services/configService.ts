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
} from '../types';
import {
  getBase,
  getBridge,
  getDashboard,
  getBaseToken,
  hasSelectedBase,
  selectBase,
} from './appContext';
import { hydrateConfig, serializeConfig, estimateConfigBytes } from './configSize';
import { listTables } from './baseService';

export type HostState = 'Create' | 'Config' | 'View' | 'FullScreen' | 'Unknown';
export type ConfigSource = 'dashboard' | 'bridge' | 'local' | 'none';

const CONFIG_KEY = 'bitable-record-view-plugin:config';
const LOCAL_PREFIX = 'bitable-record-view-plugin:backup';
const MAX_CUSTOM_CONFIG_BYTES = 10240;
const HOST_CALL_TIMEOUT = 3000;

/** 给宿主调用加超时，避免浏览器直开时 SDK Promise 永不 resolve */
function withTimeout<T>(p: Promise<T>, ms = HOST_CALL_TIMEOUT): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('宿主接口超时')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 是否运行在飞书应用模式宿主内 */
export function isDashboardHost(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const d = getDashboard() as any;
    if (!d || typeof d.getConfig !== 'function' || typeof d.saveConfig !== 'function') return false;
    return window.self !== window.top;
  } catch {
    return false;
  }
}

function readUrlState(): HostState {
  try {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    const all = `${search}&${hash}`;
    if (/(?:^|[?&#])isCreate=1/.test(all)) return 'Create';
    if (/(?:^|[?&#])isConfig=1/.test(all)) return 'Config';
  } catch {
    /* ignore */
  }
  return 'Unknown';
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
  try {
    const name = await (getBase() as any).getBaseName();
    if (name) return `name:${name}`;
  } catch {
    /* ignore */
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
  try {
    await getBridge().setData(CONFIG_KEY, config);
  } catch {
    /* bridge 不可用时忽略，localStorage 仍可用 */
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
        const currentBaseId = await getBaseId();
        const parsed = hydrateConfig(custom);
        if (isForeignConfig(parsed, currentBaseId)) {
          droppedForeign = true;
        } else {
          await bindBaseIfNeeded(parsed);
          return { config: parsed, source: 'dashboard', droppedForeign };
        }
      }
    } catch (e) {
      console.warn('[configService] dashboard.getConfig 不可用:', e);
    }
  }

  const currentBaseId = await getBaseId();

  // 2) bridge 备份
  const bridgeData = await readBridge();
  if (bridgeData) {
    const parsed = hydrateConfig(bridgeData);
    if (isForeignConfig(parsed, currentBaseId)) droppedForeign = true;
    else {
      await bindBaseIfNeeded(parsed);
      return { config: parsed, source: 'bridge', droppedForeign };
    }
  }

  // 3) localStorage 备份
  const localData = readLocal(currentBaseId);
  if (localData) {
    const parsed = hydrateConfig(localData);
    if (!isForeignConfig(parsed, currentBaseId)) {
      await bindBaseIfNeeded(parsed);
      return { config: parsed, source: 'local', droppedForeign };
    }
    droppedForeign = true;
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

/** 主子表必须同 Base（硬契约 #4） */
async function assertTablesInBase(config: PluginData): Promise<void> {
  const inBase = new Set((await listTables()).map((t) => t.id));
  const used = new Set<string>();
  if (config.tableId) used.add(config.tableId);
  config.links.forEach((l) => l.tableId && used.add(l.tableId));

  const missing = Array.from(used).filter((id) => !inBase.has(id));
  if (missing.length) {
    throw new Error('配置引用的数据表不属于当前多维表格，请重新选择数据表');
  }
}

/**
 * 保存配置。真实宿主下失败会抛错（飞书据此关闭配置弹窗）；
 * 仅在明确非宿主环境（浏览器直开调试）时只写本地备份。
 */
export async function saveConfig(input: PluginData): Promise<number> {
  const baseToken = getBaseToken();
  const baseId = await getBaseId();

  const thin = serializeConfig({ ...input, baseToken, baseId });
  if (!thin.tableId) throw new Error('请先选择数据表');

  await assertTablesInBase(thin);

  const bytes = estimateConfigBytes(thin);
  if (bytes > MAX_CUSTOM_CONFIG_BYTES) {
    throw new Error(`配置体积 ${bytes} 字节，超过 ${MAX_CUSTOM_CONFIG_BYTES} 字节上限，请精简分组或字段配置`);
  }

  const payload = {
    dataConditions: buildDataConditions(thin.tableId as string, baseToken),
    customConfig: thin as unknown as Record<string, unknown>,
  };

  if (!isDashboardHost()) {
    await writeBackup(thin, baseId);
    console.info('[configService] 非宿主环境，仅写入本地备份，配置字节数:', bytes);
    return bytes;
  }

  const MAX_ATTEMPTS = 3;
  let saved = false;
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await (getDashboard() as any).saveConfig(payload);
      if (r === false) lastErr = 'dashboard.saveConfig 返回 false';
      else {
        saved = true;
        break;
      }
    } catch (e) {
      lastErr = String((e as Error)?.message ?? e);
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500));
  }

  if (!saved) {
    throw new Error(`保存失败（已尝试 ${MAX_ATTEMPTS} 次）：${lastErr || '未知错误'}`);
  }

  await writeBackup(thin, baseId);
  console.info('[configService] 配置已保存，字节数:', bytes);
  return bytes;
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