/**
 * 应用模式数据源上下文（硬契约 #1）。
 *
 * 应用插件与多维表格是一对多关系，Workspace 是所有 JSSDK 接口的唯一入口；
 * dashboard / base / ui / bridge 四个实例都与「指定多维表格」绑定，
 * 必须通过 workspace.getBitable(baseToken) 获取，不能混用全局默认实例。
 * 业务代码统一从这里取实例，禁止直接 import 全局 bitable 后调用。
 */
import { workspace, bitable, dashboard } from '@lark-base-open/js-sdk';

/** Workspace.getBitable 返回的形态（IBitableApp 未从包根导出，自定义） */
export interface BitableAppInstance {
  base: typeof bitable.base;
  bridge: typeof bitable.bridge;
  ui: typeof bitable.ui;
  dashboard: typeof dashboard;
  util?: unknown;
}

let currentApp: BitableAppInstance | null = null;
let currentBaseToken = '';
let currentBaseName = '';

const listeners = new Set<() => void>();
export function onAppChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emitAppChange() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* 单个订阅者异常不影响其他 */
    }
  });
}

/** Workspace 模块是否可用（仅应用插件点位可用） */
export function isWorkspaceAvailable(): boolean {
  try {
    const w = workspace as any;
    return !!w && typeof w.getBaseList === 'function' && typeof w.getBitable === 'function';
  } catch {
    return false;
  }
}

/** 拉取可选多维表格列表（支持搜索与分页） */
export async function listBases(query?: string, cursor?: string): Promise<any> {
  if (!isWorkspaceAvailable()) return { base_list: [], page: { cursor: '', hasMore: false } };
  const params: { query?: string; page?: { cursor?: string } } = {};
  if (query) params.query = query;
  if (cursor) params.page = { cursor };
  return await (workspace as any).getBaseList(params);
}

/** 选中一个多维表格：通过 Workspace 获取该 base 的完整实例并设为当前上下文 */
export async function selectBase(baseToken: string, baseName?: string): Promise<boolean> {
  if (!baseToken) return false;
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const app = await (workspace as any).getBitable(baseToken);
      if (!app || !app.base) {
        lastErr = new Error('getBitable 返回空实例');
      } else {
        currentApp = app as BitableAppInstance;
        currentBaseToken = baseToken;
        currentBaseName = baseName ?? currentBaseName;
        emitAppChange();
        return true;
      }
    } catch (e) {
      lastErr = e;
    }
    // 浏览态首次加载时宿主可能尚未就绪，短暂重试
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500));
  }
  console.warn('[appContext] getBitable 失败:', lastErr);
  return false;
}

export function getBaseToken(): string {
  return currentBaseToken;
}
export function getBaseName(): string {
  return currentBaseName;
}
export function hasSelectedBase(): boolean {
  return !!currentApp;
}

/**
 * 当前 base 实例。已选 base 用 Workspace 实例；否则回退全局 bitable.base。
 * 宿主运行时未注册时，读取全局实例会同步抛错（"not registered"），这里兜成 null，
 * 由调用方的异步 catch 处理，避免异常冒泡到渲染层。
 */
export function getBase(): typeof bitable.base {
  try {
    return (currentApp?.base ?? bitable.base) as typeof bitable.base;
  } catch {
    return null as unknown as typeof bitable.base;
  }
}
/** 全局默认 base 实例（Workspace 实例被宿主门禁时的降级路径） */
export function getGlobalBase(): typeof bitable.base {
  try {
    return bitable.base as typeof bitable.base;
  } catch {
    return null as unknown as typeof bitable.base;
  }
}
export function getBridge(): typeof bitable.bridge {
  try {
    return (currentApp?.bridge ?? bitable.bridge) as typeof bitable.bridge;
  } catch {
    return null as unknown as typeof bitable.bridge;
  }
}
export function getUi(): typeof bitable.ui {
  try {
    return (currentApp?.ui ?? bitable.ui) as typeof bitable.ui;
  } catch {
    return null as unknown as typeof bitable.ui;
  }
}
export function getDashboard(): typeof dashboard {
  try {
    return (currentApp?.dashboard ?? dashboard) as typeof dashboard;
  } catch {
    return null as unknown as typeof dashboard;
  }
}

/** 仅供内存回归测试：直接注入 mock base 实例（生产代码不要调用） */
export function __setAppForTest(app: Partial<BitableAppInstance> | null): void {
  currentApp = (app as BitableAppInstance) ?? null;
  currentBaseToken = app ? 'test-base-token' : '';
}

export function diagnoseAppContext(): Record<string, unknown> {
  return {
    workspaceAvailable: isWorkspaceAvailable(),
    hasSelectedBase: hasSelectedBase(),
    baseToken: currentBaseToken ? `...${currentBaseToken.slice(-6)}` : '',
    baseName: currentBaseName,
  };
}

export type { IBaseInfo } from '@lark-base-open/js-sdk';