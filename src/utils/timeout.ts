/**
 * 宿主调用超时护栏。
 *
 * 浏览器直开（npm run dev / preview）或宿主运行时尚未注册时，JSSDK 部分接口
 * 返回的 Promise 可能永不 settle（等不到父窗口回包）。没有超时就会出现
 * 永久「加载中」，因此所有元信息级宿主调用都要包一层超时。
 */
export const HOST_TIMEOUT = 3000;
export const METADATA_TIMEOUT = 8000;
/** 保存配置：宿主 saveConfig 可能需要落盘，给更宽的窗口，但仍必须有上限 */
export const SAVE_TIMEOUT = 10000;

export function withTimeout<T>(p: Promise<T>, ms = HOST_TIMEOUT, label = '宿主接口'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms），请确认是否在飞书多维表格内打开`)), ms);
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
